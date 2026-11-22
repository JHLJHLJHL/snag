use crate::model::{friendly_error, timestamp, State};
use std::{fs, path::PathBuf};

pub struct Store {
    pub path: PathBuf,
}
impl Store {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }
    pub fn load(&self) -> Result<State, String> {
        if !self.path.exists() {
            return Ok(State::default());
        }
        let bytes = fs::read(&self.path).map_err(|e| format!("대기열을 읽지 못했습니다: {e}"))?;
        let mut state = match serde_json::from_slice::<State>(&bytes) {
            Ok(state) => state,
            Err(_) => {
                fs::copy(
                    &self.path,
                    self.path
                        .with_extension(format!("corrupt-{}.json", timestamp())),
                )
                .map_err(|e| e.to_string())?;
                return Ok(State::default());
            }
        };
        if state.version < 2 {
            if state.settings.options.mode != "audio" && state.settings.options.container == "original" {
                state.settings.options.container = "mp4".into();
            }
            for item in &mut state.items {
                if item.status != "completed" && item.options.mode != "audio" && item.options.container == "original" {
                    item.options.container = "mp4".into();
                }
            }
            state.version = 2;
        }
        for item in &mut state.items {
            if let Some(error) = &mut item.error {
                *error = friendly_error(error);
            }
            if item.busy() {
                item.status = "paused".into();
                item.start_when_ready = false;
            }
        }
        if state.settings.options.mode == "video" {
            state.settings.options.mode = "both".into();
            state.settings.options.audio_format = "auto".into();
        }
        Ok(state)
    }
    pub fn save(&self, state: &State) -> Result<(), String> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let temp = self.path.with_extension("tmp");
        let bytes = serde_json::to_vec_pretty(state).map_err(|e| e.to_string())?;
        use std::io::Write;
        let mut file = fs::File::create(&temp).map_err(|e| e.to_string())?;
        file.write_all(&bytes)
            .and_then(|_| file.sync_all())
            .map_err(|e| e.to_string())?;
        drop(file);
        fs::rename(temp, &self.path).map_err(|e| format!("대기열을 저장하지 못했습니다: {e}"))
    }
}
