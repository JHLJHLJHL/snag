use serde_json::{json, Value};
use std::{path::PathBuf, sync::Arc};
use streamdrop_core::{
    engine::{Analysis, Engine, MediaEngine},
    model::*,
};
use tokio::sync::watch;

#[tokio::test]
#[ignore = "requires the local fixture server; run npm run test:engine"]
async fn real_playlist_expands_and_downloads_all_entries_as_mp3() {
    use streamdrop_core::{queue::Queue, store::Store};
    let base = std::env::var("STREAMDROP_FIXTURE_URL").unwrap();
    let dir = tempfile::tempdir().unwrap();
    let engine = Arc::new(Engine {
        directory: PathBuf::from(std::env::var("STREAMDROP_ENGINE_DIR").unwrap()),
    });
    let (_sender, cancel) = watch::channel(false);
    let single = Input::parse(json!(format!("{base}/sample.mp4"))).unwrap();
    assert!(matches!(
        engine.resolve(single, cancel).await.unwrap(),
        Analysis::Video(_)
    ));
    let q = Queue::new(
        Store::new(dir.path().join("queue.json")),
        engine.clone(),
        Arc::new(|_| {}),
        Arc::new(|n| assert_eq!(n.added, 2)),
    )
    .unwrap();
    q.settings(json!({"directory":dir.path().join("output"),"mode":"audio","container":"mp3","audioQuality":"192"})).unwrap();
    q.add(json!(format!("{base}/playlist.html"))).unwrap();
    q.start_all().unwrap();
    tokio::time::timeout(std::time::Duration::from_secs(90), async {
        loop {
            let state = q.snapshot();
            assert!(
                !state.items.iter().any(|i| i.status == "failed"),
                "{state:?}"
            );
            if state.items.len() == 2
                && state.items.iter().all(|i| i.status == "completed")
                && q.is_idle()
            {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }
    })
    .await
    .unwrap();
    let state = q.snapshot();
    assert_eq!(state.items[0].input.url, format!("{base}/sample.mp4"));
    assert_eq!(state.items[1].input.url, format!("{base}/small.mp4"));
    for item in state.items {
        let file = item.file_path.unwrap();
        assert_eq!(std::path::Path::new(&file).extension().unwrap(), "mp3");
        let output = std::process::Command::new(engine.directory.join("ffprobe.exe"))
            .args(["-v", "quiet", "-show_streams", "-of", "json", &file])
            .output()
            .unwrap();
        let info: Value = serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(info["streams"][0]["codec_name"], "mp3");
        assert_eq!(info["streams"][0]["bit_rate"], "192000");
    }
}

#[tokio::test]
#[ignore = "requires the local fixture server; run npm run test:engine"]
async fn real_mp4_hls_audio_and_video_only_downloads() {
    let base = std::env::var("STREAMDROP_FIXTURE_URL").unwrap();
    let output = PathBuf::from(std::env::var("STREAMDROP_FIXTURE_OUTPUT").unwrap());
    let engine = Engine {
        directory: PathBuf::from(std::env::var("STREAMDROP_ENGINE_DIR").unwrap()),
    };
    let (_sender, cancel) = watch::channel(false);
    let mut original_file = None;
    for (mode, container, source) in [
        ("both", "mp4", "sample.webm"),
        ("audio", "mp3", "sample.mp4"),
        ("video", "mp4", "sample.webm"),
        ("both", "original", "sample.mp4"),
        ("video", "original", "sample.mp4"),
    ] {
        let input = Input::parse(json!(format!("{base}/{source}"))).unwrap();
        let info = engine.analyze(input.clone(), cancel.clone()).await.unwrap();
        assert!(!info.formats.is_empty());
        let mut item = Item::new(
            input,
            Options {
                mode: mode.into(),
                container: container.into(),
                audio_quality: "192".into(),
                ..Default::default()
            },
        );
        item.info = Some(info);
        let file = engine
            .download(
                item,
                output.join(if mode == "audio" { "audio" } else { "shared" }),
                cancel.clone(),
                Arc::new(|_, _| {}),
            )
            .await
            .unwrap();
        if container == "mp4" {
            assert_eq!(std::path::Path::new(&file).extension().unwrap(), "mp4");
        }
        if mode == "both" {
            original_file = Some((file.clone(), std::fs::read(&file).unwrap()));
        }
        if mode == "video" {
            let (original, bytes) = original_file.as_ref().unwrap();
            assert_ne!(&file, original);
            assert_eq!(
                &std::fs::read(original).unwrap(),
                bytes,
                "video-only must not modify an existing completed full video"
            );
        }
        let result = std::process::Command::new(engine.directory.join("ffprobe.exe"))
            .args(["-v", "quiet", "-show_streams", "-of", "json", &file])
            .output()
            .unwrap();
        let result: Value = serde_json::from_slice(&result.stdout).unwrap();
        let streams = result["streams"].as_array().unwrap();
        let video = streams
            .iter()
            .filter(|s| s["codec_type"] == "video")
            .count();
        let audio = streams
            .iter()
            .filter(|s| s["codec_type"] == "audio")
            .count();
        assert_eq!(video, if mode == "audio" { 0 } else { 1 });
        assert_eq!(audio, if mode == "video" { 0 } else { 1 });
        if container == "mp3" {
            assert_eq!(streams[0]["codec_name"], "mp3");
            assert_eq!(streams[0]["bit_rate"], "192000");
        }
        println!("PASS: {mode} => {file}");
    }
    let input = Input::parse(json!(format!("{base}/master.m3u8"))).unwrap();
    let info = engine.analyze(input.clone(), cancel.clone()).await.unwrap();
    assert!(info.formats.iter().any(|f| f.height == Some(180)));
    let low = info
        .formats
        .iter()
        .find(|f| f.height == Some(90))
        .unwrap()
        .id
        .clone();
    let mut item = Item::new(
        input,
        Options {
            video_format: low,
            ..Default::default()
        },
    );
    item.info = Some(info);
    let file = engine
        .download(
            item,
            output.join("hls"),
            cancel.clone(),
            Arc::new(|_, _| {}),
        )
        .await
        .unwrap();
    assert_eq!(std::path::Path::new(&file).extension().unwrap(), "mp4");
    let result = std::process::Command::new(engine.directory.join("ffprobe.exe"))
        .args(["-v", "quiet", "-show_streams", "-of", "json", &file])
        .output()
        .unwrap();
    let result: Value = serde_json::from_slice(&result.stdout).unwrap();
    assert!(result["streams"]
        .as_array()
        .unwrap()
        .iter()
        .any(|s| s["height"] == 90));
    println!("PASS: explicit HLS 90p => {file}");
}
