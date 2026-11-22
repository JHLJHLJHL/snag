use async_trait::async_trait;
use serde_json::json;
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
    time::Duration,
};
use streamdrop_core::{
    engine::{Analysis, MediaEngine, ProgressFn},
    model::*,
    queue::Queue,
    store::Store,
};
use tokio::sync::watch;

fn input(url: &str) -> Input {
    Input::parse(json!(url)).unwrap()
}
fn playlist() -> Analysis {
    Analysis::from_ytdlp(
        &input("https://a.test/list"),
        json!({"_type":"playlist","title":"My list","entries":[
            {"url":"https://a.test/one","title":"One"},
            {"url":"https://a.test/two","title":"Two"},
            {"url":"https://a.test/one","title":"Repeated"},
            null,
            {"url":"https://a.test/private","availability":"private"}
        ]}),
    )
    .unwrap()
}

#[test]
fn parses_playlist_entries_without_losing_signed_urls_or_reentering_parent() {
    let source = input("https://www.youtube.com/playlist?list=PLtest");
    let result = Analysis::from_ytdlp(
        &source,
        json!({"_type":"playlist","entries":[
            {"url":"https://www.youtube.com/watch?v=abc"},
            {"webpage_url":source.url,"url":"https://cdn.test/a.mp4?token=x&expires=2"},
            {"url":source.url},
            {"url":"file:///C:/secret"},
            {"_type":"playlist","url":"https://a.test/nested"},
            {"url":"https://a.test/deleted","title":"[Deleted video]"}
        ]}),
    )
    .unwrap();
    let Analysis::Playlist {
        entries, skipped, ..
    } = result
    else {
        panic!("expected playlist")
    };
    assert_eq!(entries.len(), 2);
    assert_eq!(entries[1].url, "https://cdn.test/a.mp4?token=x&expires=2");
    assert_eq!(skipped, 4);
    assert!(Analysis::from_ytdlp(&source, json!({"_type":"playlist","entries":[]})).is_err());
    assert_ne!(
        enqueue_key("https://youtube.com/watch?v=abc&list=PLtest"),
        enqueue_key("https://youtu.be/abc")
    );
    assert_eq!(
        enqueue_key("https://youtube.com/watch?v=abc&list=PLtest"),
        enqueue_key(&source.url)
    );
}

#[derive(Default)]
struct PlaylistEngine {
    downloads: Mutex<Vec<String>>,
}
#[async_trait]
impl MediaEngine for PlaylistEngine {
    async fn resolve(&self, i: Input, c: watch::Receiver<bool>) -> Result<Analysis, String> {
        if i.url.ends_with("/list") {
            tokio::time::sleep(Duration::from_millis(50)).await;
            Ok(playlist())
        } else {
            self.analyze(i, c).await.map(Analysis::Video)
        }
    }
    async fn analyze(&self, i: Input, _: watch::Receiver<bool>) -> Result<Info, String> {
        tokio::time::sleep(Duration::from_millis(if i.url.ends_with("/one") {
            40
        } else {
            10
        }))
        .await;
        Info::from_ytdlp(
            json!({"title":i.url,"formats":[{"format_id":"av","vcodec":"h264","acodec":"aac"}]}),
        )
    }
    async fn download(
        &self,
        i: Item,
        _: PathBuf,
        _: watch::Receiver<bool>,
        _: ProgressFn,
    ) -> Result<String, String> {
        self.downloads.lock().unwrap().push(i.input.url);
        Ok("D:/video.mp4".into())
    }
}
async fn wait(q: &Queue, done: impl Fn(&State) -> bool) {
    for _ in 0..300 {
        if done(&q.snapshot()) && q.is_idle() {
            return;
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    panic!("timed out: {:?}", q.snapshot());
}
#[tokio::test]
async fn expands_in_place_in_order_deduplicates_and_inherits_current_options() {
    let dir = tempfile::tempdir().unwrap();
    let notices = Arc::new(Mutex::new(Vec::new()));
    let sink = notices.clone();
    let q = Queue::new(
        Store::new(dir.path().join("queue.json")),
        Arc::new(PlaylistEngine::default()),
        Arc::new(|_| {}),
        Arc::new(move |n| sink.lock().unwrap().push(n)),
    )
    .unwrap();
    q.add(json!("https://a.test/one")).unwrap();
    wait(&q, |s| s.items[0].status == "ready").await;
    let result = q.add(json!("https://a.test/list")).unwrap();
    let id = result["id"].as_str().unwrap();
    q.update(
        id,
        json!({"mode":"audio","container":"mp3","audioQuality":"192"}),
    )
    .unwrap();
    q.add(json!("https://a.test/tail")).unwrap();
    wait(&q, |s| {
        s.items.len() == 3 && s.items.iter().all(|i| i.status == "ready")
    })
    .await;
    let state = q.snapshot();
    assert_eq!(
        state
            .items
            .iter()
            .map(|i| i.input.url.as_str())
            .collect::<Vec<_>>(),
        vec![
            "https://a.test/one",
            "https://a.test/two",
            "https://a.test/tail"
        ]
    );
    assert_eq!(state.items[1].options.container, "mp3");
    assert_eq!(state.items[1].options.audio_quality, "192");
    let notice = &notices.lock().unwrap()[0];
    assert_eq!((notice.added, notice.duplicates, notice.skipped), (1, 2, 2));
    assert_eq!(
        Store::new(dir.path().join("queue.json"))
            .load()
            .unwrap()
            .items
            .len(),
        3
    );
}
#[tokio::test]
async fn removed_or_stopped_playlist_does_not_spawn_children() {
    for stop in [false, true] {
        let dir = tempfile::tempdir().unwrap();
        let q = Queue::new(
            Store::new(dir.path().join("queue.json")),
            Arc::new(PlaylistEngine::default()),
            Arc::new(|_| {}),
            Arc::new(|_| {}),
        )
        .unwrap();
        let a = q.add(json!("https://a.test/list")).unwrap();
        if stop {
            q.shutdown();
        } else {
            q.remove(a["id"].as_str().unwrap()).unwrap();
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert!(q
            .snapshot()
            .items
            .iter()
            .all(|i| i.input.url.ends_with("/list")));
        assert!(q.is_idle());
    }
}
#[tokio::test]
async fn start_all_during_playlist_analysis_starts_all_children() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Arc::new(PlaylistEngine::default());
    let q = Queue::new(
        Store::new(dir.path().join("queue.json")),
        engine.clone(),
        Arc::new(|_| {}),
        Arc::new(|_| {}),
    )
    .unwrap();
    q.add(json!("https://a.test/list")).unwrap();
    q.start_all().unwrap();
    wait(&q, |s| {
        s.items.len() == 2 && s.items.iter().all(|i| i.status == "completed")
    })
    .await;
    assert_eq!(
        *engine.downloads.lock().unwrap(),
        vec!["https://a.test/one", "https://a.test/two"]
    );
}
