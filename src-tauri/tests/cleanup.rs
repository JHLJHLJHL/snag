use async_trait::async_trait;
use serde_json::json;
use std::{path::PathBuf, sync::Arc};
use streamdrop_core::{
    engine::{MediaEngine, ProgressFn},
    model::*,
    queue::Queue,
    store::Store,
};
use tokio::sync::watch;

struct NoEngine;
#[async_trait]
impl MediaEngine for NoEngine {
    async fn analyze(&self, _: Input, _: watch::Receiver<bool>) -> Result<Info, String> {
        unreachable!()
    }
    async fn download(
        &self,
        _: Item,
        _: PathBuf,
        _: watch::Receiver<bool>,
        _: ProgressFn,
    ) -> Result<String, String> {
        unreachable!()
    }
}
fn item(id: &str, path: PathBuf, status: &str) -> Item {
    let mut item = Item::new(
        Input::parse(json!("https://example.com/video")).unwrap(),
        Options::default(),
    );
    item.id = id.into();
    item.title = id.into();
    item.status = status.into();
    item.file_path = Some(path.to_string_lossy().into());
    item
}
fn queue(root: &std::path::Path, items: Vec<Item>) -> Arc<Queue> {
    let store = Store::new(root.join("queue.json"));
    store
        .save(&State {
            items,
            ..Default::default()
        })
        .unwrap();
    Queue::new(
        store,
        Arc::new(NoEngine),
        Arc::new(|_| {}),
        Arc::new(|_| {}),
    )
    .unwrap()
}

#[test]
fn history_only_deletion_preserves_files_and_unselected_items() {
    let dir = tempfile::tempdir().unwrap();
    let a = dir.path().join("한글 영상.mp4");
    let b = dir.path().join("keep.mp3");
    std::fs::write(&a, b"video").unwrap();
    std::fs::write(&b, b"audio").unwrap();
    let q = queue(
        dir.path(),
        vec![
            item("a", a.clone(), "completed"),
            item("b", b.clone(), "completed"),
        ],
    );
    let result = q
        .delete_completed(&["a".into(), "a".into()], false)
        .unwrap();
    assert_eq!(result.removed, 1);
    assert_eq!(result.deleted_files, 0);
    assert!(result.failures.is_empty());
    assert_eq!(std::fs::read(a).unwrap(), b"video");
    assert!(b.exists());
    assert_eq!(q.snapshot().items[0].id, "b");
    assert_eq!(
        Store::new(dir.path().join("queue.json"))
            .load()
            .unwrap()
            .items
            .len(),
        1
    );
}

#[test]
fn deletes_selected_files_once_and_cleans_already_missing_files() {
    let dir = tempfile::tempdir().unwrap();
    let a = dir.path().join("selected.mp4");
    let keep = dir.path().join("keep.mp3");
    std::fs::write(&a, b"video").unwrap();
    std::fs::write(&keep, b"audio").unwrap();
    let q = queue(
        dir.path(),
        vec![
            item("a", a.clone(), "completed"),
            item("alias", a.clone(), "completed"),
            item("missing", dir.path().join("gone.mp4"), "completed"),
            item("keep", keep.clone(), "completed"),
        ],
    );
    let result = q
        .delete_completed(&["a".into(), "alias".into(), "missing".into()], true)
        .unwrap();
    assert_eq!(result.removed, 3);
    assert_eq!(result.deleted_files, 1);
    assert!(result.failures.is_empty());
    assert!(!a.exists());
    assert_eq!(std::fs::read(keep).unwrap(), b"audio");
    assert_eq!(q.snapshot().items.len(), 1);
}

#[test]
fn validates_every_selected_id_before_deleting_any_file() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("keep.mp4");
    std::fs::write(&file, b"keep").unwrap();
    let q = queue(
        dir.path(),
        vec![
            item("done", file.clone(), "completed"),
            item("pending", file.clone(), "ready"),
        ],
    );
    for ids in [
        vec![],
        vec!["done".into(), "missing".into()],
        vec!["done".into(), "pending".into()],
    ] {
        assert!(q.delete_completed(&ids, true).is_err());
        assert!(file.exists());
        assert_eq!(q.snapshot().items.len(), 2);
    }
}

#[test]
fn deletion_failures_keep_their_rows_and_never_remove_directories() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("selected.mp4");
    std::fs::write(&file, b"video").unwrap();
    let folder = dir.path().join("folder");
    std::fs::create_dir(&folder).unwrap();
    std::fs::write(folder.join("keep.txt"), b"keep").unwrap();
    let q = queue(
        dir.path(),
        vec![
            item("file", file.clone(), "completed"),
            item("folder", folder.clone(), "completed"),
        ],
    );
    let result = q
        .delete_completed(&["file".into(), "folder".into()], true)
        .unwrap();
    assert_eq!(result.removed, 1);
    assert_eq!(result.deleted_files, 1);
    assert_eq!(result.failures.len(), 1);
    assert_eq!(result.failures[0].id, "folder");
    assert!(!file.exists());
    assert!(folder.join("keep.txt").exists());
    assert_eq!(q.snapshot().items[0].id, "folder");
    q.delete_completed(&["folder".into()], false).unwrap();
    assert!(q.snapshot().items.is_empty());
    assert!(folder.join("keep.txt").exists());
}

#[cfg(windows)]
#[test]
fn locked_files_keep_their_history_until_deletion_can_succeed() {
    use std::os::windows::fs::OpenOptionsExt;
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("locked.mp4");
    std::fs::write(&file, b"keep").unwrap();
    let q = queue(dir.path(), vec![item("locked", file.clone(), "completed")]);
    let handle = std::fs::OpenOptions::new()
        .read(true)
        .share_mode(0)
        .open(&file)
        .unwrap();
    let result = q.delete_completed(&["locked".into()], true).unwrap();
    assert_eq!(result.removed, 0);
    assert_eq!(result.failures.len(), 1);
    assert_eq!(q.snapshot().items.len(), 1);
    drop(handle);
    q.delete_completed(&["locked".into()], true).unwrap();
    assert!(!file.exists());
    assert!(q.snapshot().items.is_empty());
}

#[test]
fn save_failure_reports_files_already_deleted_without_losing_history_in_memory() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("selected.mp4");
    std::fs::write(&file, b"video").unwrap();
    let state_dir = dir.path().join("state");
    std::fs::create_dir(&state_dir).unwrap();
    let q = queue(
        &state_dir,
        vec![item("selected", file.clone(), "completed")],
    );
    std::fs::remove_file(state_dir.join("queue.json")).unwrap();
    std::fs::remove_dir(&state_dir).unwrap();
    std::fs::write(&state_dir, b"block store").unwrap();
    let error = q.delete_completed(&["selected".into()], true).unwrap_err();
    assert!(error.contains("파일 1개는 삭제했지만"));
    assert!(!file.exists());
    assert_eq!(q.snapshot().items.len(), 1);
}
