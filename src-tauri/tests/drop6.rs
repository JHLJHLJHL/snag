use serde_json::json;
use streamdrop_core::{drop6::{completed_files, allows_navigation}, model::*};

#[test]
fn only_selected_completed_files_are_passed_in_order_without_duplicates() {
    let temp=tempfile::tempdir().unwrap();
    let mut state=State::default();
    for name in ["한국어 파일.mp4", "second.mp3", "pending.mp4"] {
        let file=temp.path().join(name);
        std::fs::write(&file,b"fixture").unwrap();
        let mut item=Item::new(Input::parse(json!("https://example.com/v")).unwrap(),Options::default());
        item.id=name.into(); item.status=if name=="pending.mp4" {"ready"} else {"completed"}.into();
        item.file_path=Some(file.to_string_lossy().into());state.items.push(item);
    }
    let files=completed_files(&state,&["second.mp3".into(),"한국어 파일.mp4".into(),"second.mp3".into()]).unwrap();
    assert_eq!(files.len(),2);
    assert_eq!(files[0].file_name().unwrap(),"second.mp3");
    assert_eq!(files[1].file_name().unwrap(),"한국어 파일.mp4");
    for ids in [vec![],vec!["missing".into()],vec!["pending.mp4".into()],vec!["second.mp3".into(),"missing".into()]] {
        assert!(completed_files(&state,&ids).is_err());
    }
    std::fs::remove_file(temp.path().join("second.mp3")).unwrap();
    assert!(completed_files(&state,&["second.mp3".into()]).is_err());
}

#[test]
fn transfer_window_navigation_stays_on_drop6_https_origin() {
    for address in ["https://drop6.duckdns.org/","https://drop6.duckdns.org/receive","https://drop6.duckdns.org:443/"] {
        assert!(allows_navigation(&address.parse().unwrap()));
    }
    for address in ["http://drop6.duckdns.org/","https://drop6.duckdns.org.evil.test/","https://evil.test/","https://drop6.duckdns.org:444/","https://user:pass@drop6.duckdns.org/","file:///C:/private.mp4"] {
        assert!(!allows_navigation(&address.parse().unwrap()));
    }
}
