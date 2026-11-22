use crate::{
    engine::{Analysis, MediaEngine, ProgressFn},
    model::*,
    store::Store,
};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};
use tokio::sync::{watch, Semaphore};

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistImport {
    pub title: String,
    pub added: usize,
    pub duplicates: usize,
    pub skipped: usize,
}

#[derive(Debug, serde::Serialize)]
pub struct DeleteFailure {
    pub id: String,
    pub title: String,
    pub error: String,
}

#[derive(Debug, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletedDeletion {
    pub removed: usize,
    pub deleted_files: usize,
    pub failures: Vec<DeleteFailure>,
}

fn delete_saved_file(raw: Option<&str>) -> Result<bool, String> {
    let Some(raw) = raw else {
        return Ok(false);
    };
    let file = std::path::Path::new(raw);
    if !file.is_absolute() {
        return Err("저장된 파일 경로를 확인할 수 없습니다.".into());
    }
    let metadata = match std::fs::symlink_metadata(file) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(format!("파일을 확인하지 못했습니다: {error}")),
    };
    if !metadata.file_type().is_file() {
        return Err("일반 파일이 아니어서 삭제하지 않았습니다.".into());
    }
    match std::fs::remove_file(file) {
        Ok(()) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(format!("파일을 삭제하지 못했습니다: {error}")),
    }
}

fn item_key(item: &Item) -> String {
    // Earlier releases analyzed watch+list URLs as individual videos.
    // Their saved metadata must not prevent importing that playlist now.
    if item.info.is_some() {
        canonical(&item.input.url)
    } else {
        enqueue_key(&item.input.url)
    }
}

fn batch_selection<'a>(state: &State, ids: &'a [String]) -> Result<HashSet<&'a str>, String> {
    let selected: HashSet<_> = ids.iter().map(String::as_str).collect();
    if selected.is_empty() {
        return Err("대기열에서 항목을 선택해 주세요.".into());
    }
    let items: Vec<_> = state
        .items
        .iter()
        .filter(|i| selected.contains(i.id.as_str()))
        .collect();
    if items.len() != selected.len() {
        return Err("선택한 항목이 대기열에서 제거됐습니다. 다시 선택해 주세요.".into());
    }
    if items
        .iter()
        .any(|i| ["downloading", "processing", "completed"].contains(&i.status.as_str()))
    {
        return Err("다운로드 중이거나 완료된 항목은 선택에서 제외해 주세요.".into());
    }
    Ok(selected)
}

pub struct Queue {
    state: Mutex<State>,
    store: Store,
    engine: Arc<dyn MediaEngine>,
    controllers: Mutex<HashMap<String, (String, watch::Sender<bool>)>>,
    active: Mutex<Option<String>>,
    notify: Arc<dyn Fn(State) + Send + Sync>,
    import_notify: Arc<dyn Fn(PlaylistImport) + Send + Sync>,
    analysis_limit: Arc<Semaphore>,
    stopped: AtomicBool,
}
impl Queue {
    pub fn new(
        store: Store,
        engine: Arc<dyn MediaEngine>,
        notify: Arc<dyn Fn(State) + Send + Sync>,
        import_notify: Arc<dyn Fn(PlaylistImport) + Send + Sync>,
    ) -> Result<Arc<Self>, String> {
        let state = store.load()?;
        store.save(&state)?;
        Ok(Arc::new(Self {
            state: Mutex::new(state),
            store,
            engine,
            controllers: Mutex::new(HashMap::new()),
            active: Mutex::new(None),
            notify,
            import_notify,
            analysis_limit: Arc::new(Semaphore::new(3)),
            stopped: AtomicBool::new(false),
        }))
    }
    pub fn snapshot(&self) -> State {
        self.state.lock().unwrap().clone()
    }
    pub fn is_idle(&self) -> bool {
        let active = self.active.lock().unwrap();
        active.is_none() && self.controllers.lock().unwrap().is_empty()
    }
    fn release_controller(&self, id: &str, generation: &str) {
        let mut controllers = self.controllers.lock().unwrap();
        if controllers
            .get(id)
            .is_some_and(|(key, _)| key == generation)
        {
            controllers.remove(id);
        }
    }
    fn change<T>(&self, f: impl FnOnce(&mut State) -> Result<T, String>) -> Result<T, String> {
        let (result, snapshot) = {
            let mut state = self.state.lock().unwrap();
            let mut draft = state.clone();
            let result = f(&mut draft)?;
            self.store.save(&draft)?;
            *state = draft;
            (result, state.clone())
        };
        (self.notify)(snapshot);
        Ok(result)
    }
    pub fn add(self: &Arc<Self>, raw: Value) -> Result<Value, String> {
        let _lifecycle = self.active.lock().unwrap();
        if self.stopped.load(Ordering::SeqCst) {
            return Err("앱이 종료 중입니다. 다시 실행한 뒤 추가해 주세요.".into());
        }
        let input = Input::parse(raw)?;
        let key = enqueue_key(&input.url);
        let (result, item) = self.change(|state| {
            if let Some(item) = state.items.iter().find(|i| item_key(i) == key) {
                return Ok((json!({"id":item.id,"duplicate":true}), None));
            }
            let mut item = Item::new(input, state.settings.options.clone());
            item.start_when_ready = state.settings.auto_start;
            let result = json!({"id":item.id,"duplicate":false});
            state.items.push(item.clone());
            Ok((result, Some(item)))
        })?;
        if let Some(item) = item {
            self.analyze(item, true);
        }
        Ok(result)
    }
    fn analyze(self: &Arc<Self>, item: Item, expand_playlist: bool) {
        let (sender, mut receiver) = watch::channel(false);
        let generation = uuid::Uuid::new_v4().to_string();
        self.controllers
            .lock()
            .unwrap()
            .insert(item.id.clone(), (generation.clone(), sender));
        let manager = self.clone();
        tokio::spawn(async move {
            let permit = tokio::select! {p=manager.analysis_limit.clone().acquire_owned()=>p.ok(),_=receiver.changed()=>None};
            if permit.is_none() || *receiver.borrow() {
                manager.release_controller(&item.id, &generation);
                return;
            }
            let result = if expand_playlist {
                manager
                    .engine
                    .resolve(item.input.clone(), receiver.clone())
                    .await
            } else {
                manager
                    .engine
                    .analyze(item.input.clone(), receiver.clone())
                    .await
                    .map(Analysis::Video)
            };
            drop(permit);
            if *receiver.borrow() || manager.stopped.load(Ordering::SeqCst) {
                manager.release_controller(&item.id, &generation);
                return;
            }
            // Keep expansion, child controller registration and shutdown mutually exclusive.
            let lifecycle = manager.active.lock().unwrap();
            if *receiver.borrow() || manager.stopped.load(Ordering::SeqCst) {
                manager.release_controller(&item.id, &generation);
                return;
            }
            let mut children = Vec::new();
            let mut notice = None;
            let applied = manager.change(|state| {
                if let Ok(Analysis::Playlist {
                    title,
                    entries,
                    skipped,
                }) = &result
                {
                    if let Some(index) = state
                        .items
                        .iter()
                        .position(|i| i.id == item.id && i.status == "analyzing")
                    {
                        let parent = state.items.remove(index);
                        let mut seen = state
                            .items
                            .iter()
                            .map(item_key)
                            .collect::<std::collections::HashSet<_>>();
                        let mut duplicates = 0;
                        for input in entries {
                            if !seen.insert(enqueue_key(&input.url)) {
                                duplicates += 1;
                                continue;
                            }
                            let mut child = Item::new(input.clone(), parent.options.clone());
                            child.start_when_ready = parent.start_when_ready;
                            children.push(child);
                        }
                        state.items.splice(index..index, children.clone());
                        notice = Some(PlaylistImport {
                            title: title.clone(),
                            added: children.len(),
                            duplicates,
                            skipped: *skipped,
                        });
                    }
                    return Ok(());
                }
                if let Some(current) = state
                    .items
                    .iter_mut()
                    .find(|i| i.id == item.id && i.status == "analyzing")
                {
                    match result {
                        Ok(Analysis::Video(info)) => {
                            current.title = info.title.clone();
                            current.info = Some(info);
                            current.status = if current.start_when_ready {
                                "queued"
                            } else {
                                "ready"
                            }
                            .into();
                            current.error = None;
                        }
                        Err(e) => {
                            current.status = "failed".into();
                            current.error = Some(friendly_error(&e));
                        }
                        Ok(Analysis::Playlist { .. }) => unreachable!(),
                    }
                }
                Ok(())
            });
            if applied.is_ok() {
                for child in children {
                    manager.analyze(child, false);
                }
            }
            manager.release_controller(&item.id, &generation);
            drop(lifecycle);
            if applied.is_ok() {
                if let Some(notice) = notice {
                    (manager.import_notify)(notice);
                }
            }
            manager.pump();
        });
    }
    pub fn update(&self, id: &str, patch: Value) -> Result<(), String> {
        self.change(|state| {
            let item = state
                .items
                .iter_mut()
                .find(|i| i.id == id)
                .ok_or("대기열에서 영상을 찾지 못했습니다.")?;
            if ["queued", "downloading", "processing"].contains(&item.status.as_str()) {
                return Err("작업을 멈춘 뒤 품질을 변경해 주세요.".into());
            }
            let mut options = serde_json::to_value(&item.options).unwrap();
            if let Some(patch) = patch.as_object() {
                for (k, v) in patch {
                    options[k] = v.clone();
                }
            }
            item.options = serde_json::from_value::<Options>(options)
                .map_err(|_| "품질 설정이 올바르지 않습니다.")?
                .validate()?;
            if let Some(info) = &item.info {
                item.options.selector(&info.formats)?;
            }
            Ok(())
        })
    }
    pub fn configure_selected(&self, ids: &[String], media: &str) -> Result<usize, String> {
        if !["video", "audio"].contains(&media) {
            return Err("영상 또는 음성을 선택해 주세요.".into());
        }
        let lifecycle = self.active.lock().unwrap();
        if self.stopped.load(Ordering::SeqCst) {
            return Err("앱이 종료 중입니다.".into());
        }
        if lifecycle.as_ref().is_some_and(|id| ids.contains(id)) {
            return Err("다운로드 중인 항목은 선택에서 제외해 주세요.".into());
        }
        self.change(|state| {
            let selected = batch_selection(state, ids)?;
            for item in state
                .items
                .iter_mut()
                .filter(|i| selected.contains(i.id.as_str()))
            {
                item.options.mode = if media == "audio" { "audio" } else { "both" }.into();
                item.options.container = if media == "audio" { "mp3" } else { "mp4" }.into();
                item.options.video_format = "auto".into();
                item.options.audio_format = "auto".into();
            }
            Ok(selected.len())
        })
    }

    pub fn start_selected(self: &Arc<Self>, ids: &[String]) -> Result<usize, String> {
        let lifecycle = self.active.lock().unwrap();
        if self.stopped.load(Ordering::SeqCst) {
            return Err("앱이 종료 중입니다.".into());
        }
        if lifecycle.as_ref().is_some_and(|id| ids.contains(id)) {
            return Err("다운로드 중인 항목은 선택에서 제외해 주세요.".into());
        }
        let (count, reanalyze) = self.change(|state| {
            let selected = batch_selection(state, ids)?;
            let mut reanalyze = Vec::new();
            for item in state
                .items
                .iter_mut()
                .filter(|i| selected.contains(i.id.as_str()))
            {
                item.start_when_ready = true;
                item.error = None;
                item.progress = Progress::default();
                if item.status == "analyzing" {
                    continue;
                }
                if item.info.is_none() || item.status == "failed" {
                    item.status = "analyzing".into();
                    reanalyze.push(item.clone());
                } else {
                    item.status = "queued".into();
                }
            }
            Ok((selected.len(), reanalyze))
        })?;
        for item in reanalyze {
            self.analyze(item, true);
        }
        drop(lifecycle);
        self.pump();
        Ok(count)
    }

    pub fn remove_selected(self: &Arc<Self>, ids: &[String]) -> Result<usize, String> {
        let lifecycle = self.active.lock().unwrap();
        if self.stopped.load(Ordering::SeqCst) {
            return Err("앱이 종료 중입니다.".into());
        }
        if lifecycle.as_ref().is_some_and(|id| ids.contains(id)) {
            return Err("다운로드 중인 항목은 선택에서 제외해 주세요.".into());
        }
        let count = self.change(|state| {
            let selected = batch_selection(state, ids)?;
            state.items.retain(|i| !selected.contains(i.id.as_str()));
            Ok(selected.len())
        })?;
        let controllers = self.controllers.lock().unwrap();
        for id in ids {
            if let Some((_, sender)) = controllers.get(id) {
                let _ = sender.send(true);
            }
        }
        drop(controllers);
        drop(lifecycle);
        self.pump();
        Ok(count)
    }

    pub fn start(self: &Arc<Self>, id: &str) -> Result<(), String> {
        let lifecycle = self.active.lock().unwrap();
        if self.stopped.load(Ordering::SeqCst) {
            return Err("앱이 종료 중입니다.".into());
        }
        let reanalyze = self.change(|state| {
            let item = state
                .items
                .iter_mut()
                .find(|i| i.id == id)
                .ok_or("대기열에서 영상을 찾지 못했습니다.")?;
            if ["completed", "downloading", "processing", "queued"].contains(&item.status.as_str())
            {
                return Ok(None);
            }
            item.start_when_ready = true;
            item.error = None;
            if item.status == "analyzing" {
                return Ok(None);
            }
            if item.info.is_none() || item.status == "failed" {
                item.status = "analyzing".into();
                return Ok(Some(item.clone()));
            }
            item.status = "queued".into();
            Ok(None)
        })?;
        if let Some(item) = reanalyze {
            self.analyze(item, true);
        }
        drop(lifecycle);
        self.pump();
        Ok(())
    }
    pub fn start_all(self: &Arc<Self>) -> Result<(), String> {
        for item in self.snapshot().items {
            if ["analyzing", "ready", "paused"].contains(&item.status.as_str()) {
                self.start(&item.id)?;
            }
        }
        Ok(())
    }
    fn pump(self: &Arc<Self>) {
        if self.stopped.load(Ordering::SeqCst) {
            return;
        }
        let mut active = self.active.lock().unwrap();
        if active.is_some() || self.stopped.load(Ordering::SeqCst) {
            return;
        }
        let snapshot = self.snapshot();
        let Some(mut item) = snapshot
            .items
            .into_iter()
            .find(|i| i.status == "queued" || (i.status == "analyzing" && i.start_when_ready))
        else {
            return;
        };
        if item.status == "analyzing" {
            return;
        }
        let (sender, receiver) = watch::channel(false);
        let generation = uuid::Uuid::new_v4().to_string();
        self.controllers
            .lock()
            .unwrap()
            .insert(item.id.clone(), (generation.clone(), sender));
        *active = Some(item.id.clone());
        drop(active);
        let _ = self.change(|state| {
            if let Some(i) = state.items.iter_mut().find(|i| i.id == item.id) {
                i.status = "downloading".into();
            }
            Ok(())
        });
        item.status = "downloading".into();
        let manager = self.clone();
        tokio::spawn(async move {
            let callback_manager = manager.clone();
            let id = item.id.clone();
            let progress_cancel = receiver.clone();
            let progress: ProgressFn = Arc::new(move |progress, processing| {
                if *progress_cancel.borrow() {
                    return;
                }
                let _ = callback_manager.change(|state| {
                    if let Some(i) = state.items.iter_mut().find(|i| {
                        i.id == id && ["downloading", "processing"].contains(&i.status.as_str())
                    }) {
                        i.progress = progress;
                        i.status = if processing {
                            "processing"
                        } else {
                            "downloading"
                        }
                        .into();
                    }
                    Ok(())
                });
            });
            let result = manager
                .engine
                .download(
                    item.clone(),
                    PathBuf::from(snapshot.settings.directory),
                    receiver.clone(),
                    progress,
                )
                .await;
            if !*receiver.borrow() && !manager.stopped.load(Ordering::SeqCst) {
                let _ = manager.change(|state| {
                    if let Some(i) = state.items.iter_mut().find(|i| i.id == item.id) {
                        match result {
                            Ok(file) => {
                                i.status = "completed".into();
                                i.file_path = Some(file);
                                i.progress.percent = 100.0;
                                i.error = None;
                            }
                            Err(e) => {
                                i.status = "failed".into();
                                i.error = Some(friendly_error(&e));
                            }
                        }
                    }
                    Ok(())
                });
            }
            manager.release_controller(&item.id, &generation);
            *manager.active.lock().unwrap() = None;
            manager.pump();
        });
    }
    pub fn cancel(&self, id: &str, paused: bool) -> Result<(), String> {
        self.change(|state| {
            let item = state
                .items
                .iter_mut()
                .find(|i| i.id == id)
                .ok_or("대기열에서 영상을 찾지 못했습니다.")?;
            if item.status == "completed" {
                return Ok(());
            }
            if let Some((_, sender)) = self.controllers.lock().unwrap().get(id) {
                let _ = sender.send(true);
            }
            item.status = if paused { "paused" } else { "cancelled" }.into();
            item.start_when_ready = false;
            Ok(())
        })
    }
    pub fn pause_all(&self) -> Result<(), String> {
        for i in self.snapshot().items {
            if i.busy() {
                self.cancel(&i.id, true)?;
            }
        }
        Ok(())
    }
    pub fn retry(self: &Arc<Self>, id: &str) -> Result<(), String> {
        let snapshot = self.snapshot();
        let item = snapshot
            .items
            .iter()
            .find(|i| i.id == id)
            .ok_or("영상을 찾지 못했습니다.")?;
        if item.busy() {
            return Ok(());
        }
        self.change(|s| {
            if let Some(i) = s.items.iter_mut().find(|i| i.id == id) {
                i.status = "failed".into();
            }
            Ok(())
        })?;
        self.start(id)
    }
    pub fn delete_completed(
        &self,
        ids: &[String],
        delete_files: bool,
    ) -> Result<CompletedDeletion, String> {
        let _lifecycle = self.active.lock().unwrap();
        if self.stopped.load(Ordering::SeqCst) {
            return Err("앱이 종료 중입니다.".into());
        }
        let mut actually_deleted = 0;
        self.change(|state| {
            let selected: HashSet<_> = ids.iter().map(String::as_str).collect();
            if selected.is_empty() { return Err("삭제할 완료 항목을 선택해 주세요.".into()); }
            let items: Vec<_> = state.items.iter().filter(|i| selected.contains(i.id.as_str())).collect();
            if items.len() != selected.len() || items.iter().any(|i| i.status != "completed") {
                return Err("선택한 완료 항목을 찾지 못했습니다. 목록을 확인하고 다시 선택해 주세요.".into());
            }
            let mut result = CompletedDeletion::default();
            let mut removed = HashSet::new();
            for item in items {
                let deletion = if delete_files { delete_saved_file(item.file_path.as_deref()) } else { Ok(false) };
                match deletion {
                    Ok(deleted) => {
                        actually_deleted += usize::from(deleted);
                        removed.insert(item.id.clone());
                    }
                    Err(error) => result.failures.push(DeleteFailure { id: item.id.clone(), title: item.title.clone(), error }),
                }
            }
            result.removed = removed.len();
            result.deleted_files = actually_deleted;
            state.items.retain(|i| !removed.contains(&i.id));
            Ok(result)
        }).map_err(|error| if actually_deleted > 0 {
            format!("파일 {actually_deleted}개는 삭제했지만 완료 기록을 저장하지 못했습니다. 목록을 확인하고 다시 시도해 주세요. {error}")
        } else { error })
    }

    pub fn remove(&self, id: &str) -> Result<(), String> {
        self.cancel(id, false)?;
        self.change(|s| {
            s.items.retain(|i| i.id != id);
            Ok(())
        })
    }
    pub fn reorder(&self, id: &str, direction: i64) -> Result<(), String> {
        self.change(|s| {
            if let Some(index) = s.items.iter().position(|i| i.id == id) {
                let next = index as i64 + if direction < 0 { -1 } else { 1 };
                if next >= 0 && (next as usize) < s.items.len() {
                    s.items.swap(index, next as usize);
                }
            }
            Ok(())
        })
    }
    pub fn settings(&self, patch: Value) -> Result<(), String> {
        self.change(|s| {
            let mut v = serde_json::to_value(&s.settings).unwrap();
            if let Some(patch) = patch.as_object() {
                for (k, value) in patch {
                    v[k] = value.clone();
                }
            }
            let mut settings: Settings =
                serde_json::from_value(v).map_err(|_| "설정 값이 올바르지 않습니다.")?;
            settings.options = settings.options.validate()?;
            if settings.directory.trim().is_empty() {
                return Err("저장 폴더를 선택해 주세요.".into());
            }
            s.settings = settings;
            Ok(())
        })
    }
    pub fn shutdown(&self) {
        let active = self.active.lock().unwrap();
        self.stopped.store(true, Ordering::SeqCst);
        for (_, sender) in self.controllers.lock().unwrap().values() {
            let _ = sender.send(true);
        }
        drop(active);
        let _ = self.change(|s| {
            for i in &mut s.items {
                if i.busy() {
                    i.status = "paused".into();
                    i.start_when_ready = false;
                }
            }
            Ok(())
        });
    }
}
