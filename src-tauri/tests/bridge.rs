use serde_json::json;
use streamdrop_core::bridge::{read_frame, write_frame, MAX_MESSAGE};

#[test]
fn native_protocol_roundtrips_korean_messages() {
    let value = json!({"action":"enqueue","data":{"url":"https://a.test/v","title":"한국어 영상"}});
    let mut buffer = Vec::new();
    write_frame(&mut buffer, &value).unwrap();
    assert_eq!(read_frame(&mut buffer.as_slice()).unwrap(), value);
}
#[test]
fn native_protocol_rejects_oversized_and_truncated_frames() {
    let oversized = ((MAX_MESSAGE + 1) as u32).to_le_bytes();
    assert!(read_frame(&mut oversized.as_slice()).is_err());
    assert!(read_frame(&mut [10u8, 0, 0, 0, 1].as_slice()).is_err());
}
#[test]
fn downloader_arguments_ignore_configs_and_do_not_import_login() {
    use streamdrop_core::{engine::download_args, model::*};
    let item = Item::new(
        Input::parse(json!("https://a.test/v")).unwrap(),
        Options {
            mode: "audio".into(),
            container: "mp3".into(),
            ..Default::default()
        },
    );
    let args = download_args(&item, std::path::Path::new("D:/영상")).unwrap();
    assert!(args.contains(&"--ignore-config".into()));
    assert!(args.contains(&"--extract-audio".into()));
    assert!(args.contains(&"mp3".into()));
    assert!(!args.iter().any(|s| s.contains("cookies")));
    assert_eq!(&args[args.len() - 2..], &["--", "https://a.test/v"]);
}

#[test]
fn mp3_quality_is_validated_persisted_and_used_by_the_encoder() {
    use streamdrop_core::{engine::download_args, model::*};
    let input = Input::parse(json!("https://a.test/v")).unwrap();
    let make = |quality: &str, container: &str| Item::new(input.clone(),
        serde_json::from_value(json!({"mode":"audio","container":container,"audioQuality":quality})).unwrap());
    for quality in ["best", "320", "256", "192", "128", "96"] {
        let item = make(quality, "mp3");
        let args = download_args(&item, std::path::Path::new("D:/audio")).unwrap();
        let expected = if quality == "best" { "0".to_string() } else { format!("{quality}K") };
        assert!(args.windows(2).any(|pair| pair[0] == "--audio-quality" && pair[1] == expected), "{quality}: {args:?}");
        assert_eq!(serde_json::to_value(item.options).unwrap()["audioQuality"], quality);
    }
    for invalid in ["", "500", "--exec calc"] {
        assert!(download_args(&make(invalid, "mp3"), std::path::Path::new("D:/audio")).is_err());
    }
    let original = download_args(&make("192", "original"), std::path::Path::new("D:/audio")).unwrap();
    assert!(!original.contains(&"--audio-quality".into()));
    let legacy: Options = serde_json::from_value(json!({"mode":"audio","container":"mp3"})).unwrap();
    assert_eq!(serde_json::to_value(legacy).unwrap()["audioQuality"], "best");
    let temp = tempfile::tempdir().unwrap();
    let store = streamdrop_core::store::Store::new(temp.path().join("queue.json"));
    let mut state = State::default();
    state.settings.options = make("256", "mp3").options;
    state.items.push(make("192", "mp3"));
    store.save(&state).unwrap();
    let restored = store.load().unwrap();
    assert_eq!(serde_json::to_value(restored.settings.options).unwrap()["audioQuality"], "256");
    assert_eq!(serde_json::to_value(&restored.items[0].options).unwrap()["audioQuality"], "192");
}
#[test]
#[cfg(windows)]
fn windows_certificate_store_is_used_without_disabling_verification() {
    use streamdrop_core::{engine::{base_args, download_args}, model::*};
    let input = Input::parse(json!("https://a.test/v")).unwrap();
    let item = Item::new(input.clone(), Options::default());
    for args in [base_args(&input), download_args(&item, std::path::Path::new("D:/video")).unwrap()] {
        assert!(args.windows(2).any(|pair| pair == ["--compat-options", "no-certifi"]));
        assert!(!args.iter().any(|arg| arg.starts_with("--no-check-certificate") || arg == "--prefer-insecure"));
    }
}
