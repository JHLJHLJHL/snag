use async_trait::async_trait;
use serde_json::json;
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use streamdrop_core::{
    engine::{MediaEngine, ProgressFn},
    model::*,
    queue::Queue,
    store::Store,
};
use tokio::sync::watch;

#[derive(Default)]
struct TestEngine {
    slow: AtomicBool,
    aborted: AtomicBool,
    running: AtomicUsize,
    max: AtomicUsize,
    downloads: Mutex<Vec<(String, Options)>>,
}
#[async_trait]
impl MediaEngine for TestEngine {
    async fn analyze(&self, input: Input, _: watch::Receiver<bool>) -> Result<Info, String> {
        tokio::time::sleep(Duration::from_millis(
            if input.url.ends_with("/hold-analysis") {
                80
            } else {
                10
            },
        ))
        .await;
        Info::from_ytdlp(
            json!({"title":"Test","formats":[{"format_id":"v","vcodec":"h264","acodec":"aac"}]}),
        )
    }
    async fn download(
        &self,
        item: Item,
        _: PathBuf,
        mut cancel: watch::Receiver<bool>,
        progress: ProgressFn,
    ) -> Result<String, String> {
        self.downloads.lock().unwrap().push((item.id, item.options));
        let n = self.running.fetch_add(1, Ordering::SeqCst) + 1;
        self.max.fetch_max(n, Ordering::SeqCst);
        progress(
            Progress {
                percent: 100.0,
                ..Default::default()
            },
            true,
        );
        if self.slow.load(Ordering::SeqCst) {
            let _ = cancel.changed().await;
            self.aborted.store(true, Ordering::SeqCst);
            self.running.fetch_sub(1, Ordering::SeqCst);
            return Err("cancelled".into());
        }
        tokio::time::sleep(Duration::from_millis(15)).await;
        self.running.fetch_sub(1, Ordering::SeqCst);
        Ok("D:/video.mp4".into())
    }
}
async fn wait_until(q: &Queue, f: impl Fn(&State) -> bool) {
    for _ in 0..200 {
        if f(&q.snapshot()) {
            return;
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    panic!("timed out: {:?}", q.snapshot());
}
fn fixture() -> (tempfile::TempDir, Arc<Queue>, Arc<TestEngine>) {
    let dir = tempfile::tempdir().unwrap();
    let engine = Arc::new(TestEngine::default());
    let q = Queue::new(
        Store::new(dir.path().join("queue.json")),
        engine.clone(),
        Arc::new(|_| {}),
        Arc::new(|_| {}),
    )
    .unwrap();
    (dir, q, engine)
}

#[tokio::test]
async fn analysis_waits_for_start_deduplicates_and_persists() {
    let (dir, q, _) = fixture();
    let a = q.add(json!("https://a.test/v")).unwrap();
    wait_until(&q, |s| s.items[0].status == "ready").await;
    assert_eq!(q.add(json!("https://a.test/v")).unwrap()["duplicate"], true);
    let loaded = Store::new(dir.path().join("queue.json")).load().unwrap();
    assert_eq!(loaded.items[0].id, a["id"].as_str().unwrap());
}
#[tokio::test]
async fn serial_work_completes_and_preserves_result_path() {
    let (_, q, engine) = fixture();
    q.add(json!("https://a.test/1")).unwrap();
    q.add(json!("https://a.test/2")).unwrap();
    wait_until(&q, |s| s.items.iter().all(|i| i.status == "ready")).await;
    q.start_all().unwrap();
    wait_until(&q, |s| s.items.iter().all(|i| i.status == "completed")).await;
    assert_eq!(engine.max.load(Ordering::SeqCst), 1);
    assert_eq!(
        q.snapshot().items[0].file_path.as_deref(),
        Some("D:/video.mp4")
    );
}
#[tokio::test]
async fn cancellation_aborts_work_and_retry_can_complete() {
    let (_, q, engine) = fixture();
    engine.slow.store(true, Ordering::SeqCst);
    let a = q.add(json!("https://a.test/1")).unwrap();
    let id = a["id"].as_str().unwrap();
    wait_until(&q, |s| s.items[0].status == "ready").await;
    q.start(id).unwrap();
    wait_until(&q, |s| s.items[0].status == "processing").await;
    q.cancel(id, false).unwrap();
    for _ in 0..50 {
        if engine.aborted.load(Ordering::SeqCst) {
            break;
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    assert!(engine.aborted.load(Ordering::SeqCst));
    assert_eq!(q.snapshot().items[0].status, "cancelled");
    engine.slow.store(false, Ordering::SeqCst);
    q.retry(id).unwrap();
    wait_until(&q, |s| s.items[0].status == "completed").await;
}
#[tokio::test]
async fn removed_analysis_does_not_resurrect_and_order_and_settings_persist() {
    let (_, q, _) = fixture();
    let a = q.add(json!("https://a.test/1")).unwrap();
    q.remove(a["id"].as_str().unwrap()).unwrap();
    tokio::time::sleep(Duration::from_millis(25)).await;
    assert!(q.snapshot().items.is_empty());
    q.add(json!("https://a.test/2")).unwrap();
    let b = q.add(json!("https://a.test/3")).unwrap();
    q.reorder(b["id"].as_str().unwrap(), -1).unwrap();
    assert_eq!(q.snapshot().items[0].id, b["id"].as_str().unwrap());
    q.settings(json!({"preset":"720","autoStart":true}))
        .unwrap();
    assert_eq!(q.snapshot().settings.options.preset, "720");
    assert!(q.snapshot().settings.auto_start);
    q.shutdown();
}

struct RetryRaceEngine {
    analyses: AtomicUsize,
    downloads: AtomicUsize,
}
#[async_trait]
impl MediaEngine for RetryRaceEngine {
    async fn analyze(&self, _: Input, mut cancel: watch::Receiver<bool>) -> Result<Info, String> {
        if self.analyses.fetch_add(1, Ordering::SeqCst) > 0 {
            tokio::select! {_=tokio::time::sleep(Duration::from_millis(120))=>{},_=cancel.changed()=>return Err("replacement controller was dropped".into())}
        }
        Info::from_ytdlp(
            json!({"title":"Retry","formats":[{"format_id":"v","vcodec":"h264","acodec":"aac"}]}),
        )
    }
    async fn download(
        &self,
        _: Item,
        _: PathBuf,
        mut cancel: watch::Receiver<bool>,
        _: ProgressFn,
    ) -> Result<String, String> {
        if self.downloads.fetch_add(1, Ordering::SeqCst) == 0 {
            let _ = cancel.changed().await;
            tokio::time::sleep(Duration::from_millis(50)).await;
            return Err("cancelled".into());
        }
        Ok("D:/retry.mp4".into())
    }
}
#[tokio::test]
async fn immediate_retry_retains_its_controller_while_old_download_exits() {
    let dir = tempfile::tempdir().unwrap();
    let engine = Arc::new(RetryRaceEngine {
        analyses: AtomicUsize::new(0),
        downloads: AtomicUsize::new(0),
    });
    let q = Queue::new(
        Store::new(dir.path().join("queue.json")),
        engine,
        Arc::new(|_| {}),
        Arc::new(|_| {}),
    )
    .unwrap();
    let a = q.add(json!("https://a.test/race")).unwrap();
    let id = a["id"].as_str().unwrap();
    wait_until(&q, |s| s.items[0].status == "ready").await;
    q.start(id).unwrap();
    wait_until(&q, |s| s.items[0].status == "downloading").await;
    q.cancel(id, false).unwrap();
    q.retry(id).unwrap();
    tokio::time::sleep(Duration::from_millis(250)).await;
    assert_eq!(q.snapshot().items[0].status, "completed");
}
#[tokio::test]
async fn shutdown_waits_for_engine_cancellation_and_retains_paused_work() {
    let (_dir, q, engine) = fixture();
    engine.slow.store(true, Ordering::SeqCst);
    q.add(json!("https://a.test/shutdown")).unwrap();
    wait_until(&q, |s| s.items[0].status == "ready").await;
    q.start_all().unwrap();
    wait_until(&q, |s| s.items[0].status == "processing").await;
    q.shutdown();
    for _ in 0..100 {
        if q.is_idle() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    assert!(engine.aborted.load(Ordering::SeqCst));
    assert!(q.is_idle());
    assert_eq!(q.snapshot().items[0].status, "paused");
}
#[tokio::test]
async fn closing_queue_rejects_new_work_instead_of_spawning_orphan_processes() {
    let (_dir, q, _) = fixture();
    q.shutdown();
    assert!(q.add(json!("https://a.test/late")).is_err());
}

#[tokio::test]
async fn selected_downloads_change_only_chosen_items_and_keep_queue_order() {
    let (_dir, q, engine) = fixture();
    let mut ids = Vec::new();
    for n in 0..3 {
        ids.push(
            q.add(json!(format!("https://a.test/batch-{n}"))).unwrap()["id"]
                .as_str()
                .unwrap()
                .to_string(),
        );
    }
    wait_until(&q, |s| s.items.iter().all(|i| i.status == "ready")).await;
    q.update(
        &ids[0],
        json!({"preset":"720","audioQuality":"192","videoFormat":"v"}),
    )
    .unwrap();
    assert_eq!(
        q.configure_selected(&[ids[1].clone(), ids[0].clone(), ids[1].clone()], "audio")
            .unwrap(),
        2
    );
    tokio::time::sleep(Duration::from_millis(25)).await;
    assert!(q
        .snapshot()
        .items
        .iter()
        .all(|i| i.status == "ready" && !i.start_when_ready));
    assert!(engine.downloads.lock().unwrap().is_empty());
    q.start_selected(&[ids[1].clone(), ids[0].clone()]).unwrap();
    wait_until(&q, |s| s.items[..2].iter().all(|i| i.status == "completed")).await;
    let state = q.snapshot();
    assert!(state.items[..2].iter().all(|i| i.options.mode == "audio"
        && i.options.container == "mp3"
        && i.options.video_format == "auto"
        && i.options.audio_format == "auto"));
    assert_eq!(state.items[0].options.audio_quality, "192");
    assert_eq!(state.items[0].options.preset, "720");
    assert_eq!(state.items[2].status, "ready");
    assert_eq!(state.items[2].options.mode, "both");
    assert_eq!(
        engine
            .downloads
            .lock()
            .unwrap()
            .iter()
            .map(|(id, _)| id.clone())
            .collect::<Vec<_>>(),
        ids[..2]
    );
    assert_eq!(engine.max.load(Ordering::SeqCst), 1);
    q.update(&ids[2], json!({"mode":"audio","container":"mp3"}))
        .unwrap();
    q.configure_selected(&ids[2..], "video").unwrap();
    q.start_selected(&ids[2..]).unwrap();
    wait_until(&q, |s| s.items[2].status == "completed").await;
    assert_eq!(q.snapshot().items[2].options.mode, "both");
    assert_eq!(q.snapshot().items[2].options.container, "mp4");
}

#[tokio::test]
async fn invalid_or_active_batch_is_rejected_atomically() {
    let (_dir, q, engine) = fixture();
    engine.slow.store(true, Ordering::SeqCst);
    let a = q.add(json!("https://a.test/active")).unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string();
    let b = q.add(json!("https://a.test/waiting")).unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string();
    wait_until(&q, |s| s.items.iter().all(|i| i.status == "ready")).await;
    assert!(q.start_selected(&[]).is_err());
    assert!(q.configure_selected(&[b.clone()], "other").is_err());
    assert!(q
        .configure_selected(&[b.clone(), "missing".into()], "audio")
        .is_err());
    assert!(q.start_selected(&[b.clone(), "missing".into()]).is_err());
    q.start(&a).unwrap();
    wait_until(&q, |s| s.items[0].status == "processing").await;
    assert!(q
        .configure_selected(&[b.clone(), a.clone()], "audio")
        .is_err());
    assert!(q.start_selected(&[b.clone(), a.clone()]).is_err());
    assert!(q.remove_selected(&[b.clone(), a.clone()]).is_err());
    assert_eq!(q.snapshot().items[1].options.mode, "both");
    assert_eq!(q.snapshot().items.len(), 2);
    q.configure_selected(&[b.clone()], "audio").unwrap();
    assert_eq!(q.snapshot().items[1].status, "ready");
    q.start_selected(&[b.clone()]).unwrap();
    assert_eq!(q.snapshot().items[1].status, "queued");
    q.configure_selected(&[b.clone()], "video").unwrap();
    assert_eq!(q.snapshot().items[1].options.container, "mp4");
    q.remove_selected(&[b]).unwrap();
    q.cancel(&a, false).unwrap();
}

#[tokio::test]
async fn selected_removal_cancels_analysis_without_deleting_files_or_other_rows() {
    let (dir, q, _) = fixture();
    let file = dir.path().join("saved.mp4");
    std::fs::write(&file, b"keep").unwrap();
    let a = q.add(json!("https://a.test/remove-a")).unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string();
    let b = q.add(json!("https://a.test/remove-b")).unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string();
    q.add(json!("https://a.test/keep")).unwrap();
    assert!(q.remove_selected(&[]).is_err());
    assert!(q.remove_selected(&[a.clone(), "missing".into()]).is_err());
    assert_eq!(q.remove_selected(&[a.clone(), b, a]).unwrap(), 2);
    tokio::time::sleep(Duration::from_millis(60)).await;
    assert_eq!(q.snapshot().items.len(), 1);
    assert_eq!(q.snapshot().items[0].input.url, "https://a.test/keep");
    assert_eq!(std::fs::read(file).unwrap(), b"keep");
    assert_eq!(
        Store::new(dir.path().join("queue.json"))
            .load()
            .unwrap()
            .items
            .len(),
        1
    );
}

#[tokio::test]
async fn removing_analyzing_head_unblocks_selected_downloads() {
    let (_dir, q, _) = fixture();
    let a = q.add(json!("https://a.test/hold-analysis")).unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string();
    let b = q.add(json!("https://a.test/next")).unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string();
    q.configure_selected(&[a.clone(), b.clone()], "audio")
        .unwrap();
    q.start_selected(&[a.clone(), b]).unwrap();
    wait_until(&q, |s| s.items[1].status == "queued").await;
    q.remove_selected(&[a]).unwrap();
    wait_until(&q, |s| {
        s.items.len() == 1 && s.items[0].status == "completed"
    })
    .await;
}
