use serde_json::json;
use streamdrop_core::model::*;
use streamdrop_core::store::Store;

#[test]
fn dragged_links_preserve_signed_parameters_and_discard_credentials_fields() {
    let input = Input::parse(json!("# link\nhttps://cdn.example/v.mp4?token=x&expires=2")).unwrap();
    assert_eq!(input.url, "https://cdn.example/v.mp4?token=x&expires=2");
    let input=Input::parse(json!({"url":"https://a.test/v.mp4","pageUrl":"https://a.test/watch","cookies":"secret","headers":{"Cookie":"x"}})).unwrap();
    let value = serde_json::to_value(input).unwrap();
    assert!(value.get("cookies").is_none());
    assert!(value.get("headers").is_none());
}
#[test]
fn rejects_local_files_scripts_blobs_credentials_and_command_strings() {
    for input in [
        "file:///C:/test",
        "javascript:alert(1)",
        "blob:https://a.test/x",
        "https://user:pass@a.test/v",
        "--exec calc",
        "",
    ] {
        assert!(Input::parse(json!(input)).is_err(), "{input}");
    }
}
#[test]
fn canonical_youtube_links_deduplicate_without_changing_other_signed_urls() {
    assert_eq!(
        canonical("https://youtu.be/abc?t=5"),
        canonical("https://www.youtube.com/watch?v=abc&list=123")
    );
    assert_ne!(
        canonical("https://a.test/v?token=a"),
        canonical("https://a.test/v?token=b")
    );
}
#[test]
fn actual_formats_exclude_drm_and_storyboards_and_keep_audio_language() {
    let info = Info::from_ytdlp(json!({"title":"Test","formats":[
        {"format_id":"v","vcodec":"avc1","acodec":"none","height":1080},
        {"format_id":"a","vcodec":"none","acodec":"aac","abr":128,"language":"ko"},
        {"format_id":"protected","vcodec":"avc1","has_drm":true},
        {"format_id":"sb","vcodec":"images","ext":"mhtml"}
    ]}))
    .unwrap();
    assert_eq!(info.formats.len(), 2);
    assert_eq!(info.formats[1].language, "ko");
    assert_eq!(info.formats[1].abr, Some(128.0));
}
#[test]
fn quality_selection_validates_ids_and_limits_resolution() {
    let info=Info::from_ytdlp(json!({"formats":[{"format_id":"v","vcodec":"avc1","acodec":"none"},{"format_id":"a","vcodec":"none","acodec":"aac"}]})).unwrap();
    let options = Options {
        video_format: "v".into(),
        audio_format: "a".into(),
        ..Default::default()
    };
    assert_eq!(options.selector(&info.formats).unwrap(), "v+a");
    assert!(Options {
        video_format: "a".into(),
        ..Default::default()
    }
    .selector(&info.formats)
    .is_err());
    assert!(Options {
        audio_format: "--exec calc".into(),
        mode: "audio".into(),
        ..Default::default()
    }
    .selector(&info.formats)
    .is_err());
    assert!(Options {
        preset: "1080".into(),
        ..Default::default()
    }
    .selector(&[])
    .unwrap()
    .contains("height<=1080"));
}
#[test]
fn live_and_drm_only_media_return_explicit_errors() {
    assert!(Info::from_ytdlp(json!({"is_live":true}))
        .unwrap_err()
        .contains("실시간"));
    assert!(Info::from_ytdlp(json!({"formats":[{"format_id":"x","has_drm":true}]})).is_err());
}

#[test]
fn resolution_presets_accept_unmeasured_direct_video_without_relaxing_known_limits() {
    let unknown = Info::from_ytdlp(
        json!({"formats":[{"format_id":"mp4","ext":"mp4","vcodec":"h264","acodec":"aac"}]}),
    )
    .unwrap();
    let options = Options {
        preset: "720".into(),
        ..Default::default()
    };
    assert!(options
        .selector(&unknown.formats)
        .unwrap()
        .contains("[height<=?720]"));
    let known=Info::from_ytdlp(json!({"formats":[{"format_id":"hd","height":1080,"vcodec":"h264","acodec":"aac"},{"format_id":"sd","height":480,"vcodec":"h264","acodec":"aac"}]})).unwrap();
    assert!(options
        .selector(&known.formats)
        .unwrap()
        .contains("[height<=720]"));
    assert!(!options.selector(&known.formats).unwrap().contains("<=?"));
}
#[test]
fn store_roundtrip_recovers_interrupted_work_as_paused() {
    let temp = tempfile::tempdir().unwrap();
    let store = Store::new(temp.path().join("queue.json"));
    let mut state = State::default();
    let mut item = Item::new(
        Input::parse(json!("https://a.test/v")).unwrap(),
        Options::default(),
    );
    item.status = "downloading".into();
    state.items.push(item);
    store.save(&state).unwrap();
    let restored = store.load().unwrap();
    assert_eq!(restored.items[0].status, "paused");
    assert!(temp.path().join("queue.json").exists());
}
#[test]
fn chrome_title_roundtrips_without_duplicate_fields_or_losing_queue() {
    let temp = tempfile::tempdir().unwrap();
    let store = Store::new(temp.path().join("queue.json"));
    let mut state = State::default();
    state.items.push(Item::new(
        Input::parse(json!({"url":"https://a.test/v","title":"크롬에서 보낸 제목"})).unwrap(),
        Options::default(),
    ));
    store.save(&state).unwrap();
    let restored = store.load().unwrap();
    assert_eq!(restored.items.len(), 1);
    assert_eq!(restored.items[0].title, "크롬에서 보낸 제목");
}
#[test]
fn corrupt_store_is_preserved_for_recovery() {
    let temp = tempfile::tempdir().unwrap();
    let file = temp.path().join("queue.json");
    std::fs::write(&file, "{broken").unwrap();
    let state = Store::new(file).load().unwrap();
    assert!(state.items.is_empty());
    assert!(std::fs::read_dir(temp.path()).unwrap().any(|e| e
        .unwrap()
        .file_name()
        .to_string_lossy()
        .contains("corrupt")));
}

#[test]
fn new_video_downloads_request_mp4_output() {
    use streamdrop_core::engine::download_args;
    let item = Item::new(
        Input::parse(json!("https://a.test/v")).unwrap(),
        Options::default(),
    );
    let args = download_args(&item, std::path::Path::new("D:/영상")).unwrap();
    assert!(args
        .windows(2)
        .any(|p| p == ["--merge-output-format", "mp4"]));
    assert!(args.windows(2).any(|p| p == ["--recode-video", "mp4"]));
}

#[test]
fn removed_video_only_default_uses_video_with_audio_without_rewriting_existing_jobs() {
    let temp = tempfile::tempdir().unwrap();
    let store = Store::new(temp.path().join("queue.json"));
    let mut state = State::default();
    state.settings.options.mode = "video".into();
    state.settings.options.audio_format = "old-track".into();
    let mut item = Item::new(
        Input::parse(json!("https://a.test/v")).unwrap(),
        Options {
            mode: "video".into(),
            ..Default::default()
        },
    );
    item.status = "completed".into();
    state.items.push(item);
    store.save(&state).unwrap();
    let restored = store.load().unwrap();
    assert_eq!(restored.settings.options.mode, "both");
    assert_eq!(restored.settings.options.audio_format, "auto");
    assert_eq!(restored.items[0].options.mode, "video");
}

#[test]
fn old_video_defaults_and_pending_jobs_migrate_once_without_changing_completed_files_or_audio() {
    let temp = tempfile::tempdir().unwrap();
    let store = Store::new(temp.path().join("queue.json"));
    let mut state = State::default();
    state.version = 1;
    state.settings.options.container = "original".into();
    for (status, mode, container) in [
        ("ready", "both", "original"),
        ("completed", "both", "original"),
        ("ready", "audio", "original"),
        ("ready", "audio", "mp3"),
    ] {
        let mut item = Item::new(
            Input::parse(json!("https://a.test/v")).unwrap(),
            Options {
                mode: mode.into(),
                container: container.into(),
                ..Default::default()
            },
        );
        item.status = status.into();
        if status == "completed" {
            item.file_path = Some("D:/기존 영상.mkv".into());
        }
        state.items.push(item);
    }
    store.save(&state).unwrap();
    let mut restored = store.load().unwrap();
    assert_eq!(restored.settings.options.container, "mp4");
    assert_eq!(restored.items[0].options.container, "mp4");
    assert_eq!(restored.items[1].options.container, "original");
    assert_eq!(
        restored.items[1].file_path.as_deref(),
        Some("D:/기존 영상.mkv")
    );
    assert_eq!(restored.items[2].options.container, "original");
    assert_eq!(restored.items[3].options.container, "mp3");
    restored.settings.options.container = "original".into();
    store.save(&restored).unwrap();
    assert_eq!(store.load().unwrap().settings.options.container, "original");
}

#[test]
fn certificate_errors_have_a_short_actionable_message() {
    for raw in [
        "WARNING: [youtube] [SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed: self-signed certificate in certificate chain; please report this issue https://github.com/yt-dlp/yt-dlp/issues",
        "ERROR: certificate verify failed: unable to get local issuer certificate",
        "ERROR: certificate has expired",
        "WARNING: cookies unavailable; ERROR: CERTIFICATE_VERIFY_FAILED",
    ] {
        let message = friendly_error(raw);
        assert!(message.contains("인증서"), "{message}");
        assert!(message.chars().count() < 160, "{message}");
        assert!(!message.contains("github.com"));
        assert_eq!(friendly_error(&message), message);
    }
}

#[test]
fn saved_certificate_failures_are_readable_after_restart_without_losing_queue() {
    let temp = tempfile::tempdir().unwrap();
    let store = Store::new(temp.path().join("queue.json"));
    let mut state = State::default();
    let mut item = Item::new(
        Input::parse(json!("https://a.test/v")).unwrap(),
        Options::default(),
    );
    item.status = "failed".into();
    item.error = Some(
        "ERROR: [SSL: CERTIFICATE_VERIFY_FAILED] self-signed certificate in certificate chain"
            .into(),
    );
    let id = item.id.clone();
    state.items.push(item);
    store.save(&state).unwrap();
    let restored = store.load().unwrap();
    assert_eq!(restored.items.len(), 1);
    assert_eq!(restored.items[0].id, id);
    assert_eq!(restored.items[0].status, "failed");
    assert!(restored.items[0]
        .error
        .as_deref()
        .unwrap()
        .contains("인증서"));
    assert_eq!(restored.settings.directory, state.settings.directory);
}
