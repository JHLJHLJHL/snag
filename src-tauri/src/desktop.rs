use crate::{
    bridge::{self, Bridge},
    engine::Engine,
    queue::Queue,
    store::Store,
};
use serde_json::{json, Value};
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

fn taskbar_icon() -> tauri::image::Image<'static> {
    let source = tauri::include_image!("icons/taskbar.png");
    // Frame the supplied 256px character tightly, retaining its aspect ratio and transparency.
    // The visible character fills 217 of these 220 pixels instead of 217 of 256.
    let (left, top, size) = (18, 22, 220);
    let rgba = source
        .rgba()
        .chunks_exact(source.width() as usize * 4)
        .skip(top)
        .take(size)
        .flat_map(|row| row[left * 4..(left + size) * 4].iter().copied())
        .collect();
    tauri::image::Image::new_owned(rgba, size as u32, size as u32)
}

pub struct AppState {
    queue: Arc<Queue>,
    engine: Engine,
    bridge: Bridge,
    extension: PathBuf,
    data: PathBuf,
    closing: AtomicBool,
}
fn begin_shutdown(app: &tauri::AppHandle, state: &AppState) {
    if state.closing.swap(true, Ordering::SeqCst) {
        return;
    }
    state.queue.shutdown();
    let queue = state.queue.clone();
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        for _ in 0..160 {
            if queue.is_idle() {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(25)).await;
        }
        app.exit(0);
    });
}
fn open_directory(path: &std::path::Path) -> Result<(), String> {
    if !path.is_dir() {
        return Err("저장 폴더가 아직 없습니다. 먼저 영상을 다운로드해 주세요.".into());
    }
    let mut command = std::process::Command::new("explorer.exe");
    let path = dunce::canonicalize(path).map_err(|e| e.to_string())?;
    command.arg(path);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    command.spawn().map(|_| ()).map_err(|e| e.to_string())
}
#[cfg(windows)]
fn reveal_file(file: PathBuf) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows::{
        core::PCWSTR,
        Win32::{
            System::Com::{
                CoInitializeEx, CoTaskMemFree, CoUninitialize, COINIT_APARTMENTTHREADED,
            },
            UI::Shell::{SHOpenFolderAndSelectItems, SHParseDisplayName},
        },
    };
    let path: Vec<u16> = file.as_os_str().encode_wide().chain(Some(0)).collect();
    // This runs on a blocking worker; balance its COM initialization and PIDL allocation.
    unsafe {
        CoInitializeEx(None, COINIT_APARTMENTTHREADED)
            .ok()
            .map_err(|e| e.to_string())?;
        let result = (|| {
            let mut item = std::ptr::null_mut();
            SHParseDisplayName(PCWSTR(path.as_ptr()), None, &mut item, 0, None)?;
            let result = SHOpenFolderAndSelectItems(item, None, 0);
            CoTaskMemFree(Some(item.cast()));
            result
        })();
        CoUninitialize();
        result.map_err(|e: windows::core::Error| format!("파일 위치를 열지 못했습니다: {e}"))
    }
}
fn bridge_install(state: &AppState) -> Result<Value, String> {
    let identity: Value = serde_json::from_str(include_str!("../../extension/identity.json"))
        .map_err(|e| e.to_string())?;
    let executable = std::env::current_exe().map_err(|e| e.to_string())?;
    let manifest = state.data.join("native-host.json");
    std::fs::write(&manifest,serde_json::to_vec_pretty(&json!({"name":bridge::HOST_NAME,"description":"snag local video queue bridge","path":executable,"type":"stdio","allowed_origins":[format!("chrome-extension://{}/",identity["id"].as_str().unwrap_or(""))]})).unwrap()).map_err(|e|e.to_string())?;
    let mut command = std::process::Command::new("reg.exe");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let output = command
        .args([
            "ADD",
            &format!(
                "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\{}",
                bridge::HOST_NAME
            ),
            "/ve",
            "/t",
            "REG_SZ",
            "/d",
        ])
        .arg(&manifest)
        .arg("/f")
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(
            "크롬 연결 등록에 실패했습니다. 사용자 계정의 레지스트리 쓰기 권한을 확인해 주세요."
                .into(),
        );
    }
    Ok(json!({"extensionId":identity["id"],"extensionPath":state.extension}))
}
#[tauri::command]
async fn command(
    action: String,
    payload: Value,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    window: tauri::WebviewWindow,
) -> Result<Value, String> {
    if !["main", "drop"].contains(&window.label()) {
        return Err("이 창에서는 앱 명령을 실행할 수 없습니다.".into());
    }
    let id = payload["id"].as_str().unwrap_or("");
    match action.as_str() {
        "snapshot" => Ok(serde_json::to_value(state.queue.snapshot()).unwrap()),
        "send" => {
            let ids: Vec<String> = serde_json::from_value(payload["ids"].clone())
                .map_err(|_| "보낼 완료 파일을 선택해 주세요.".to_string())?;
            let files = crate::drop6::completed_files(&state.queue.snapshot(), &ids)?;
            crate::drop6::open(&app, files).await?;
            Ok(Value::Null)
        }
        "status" => {
            let versions = std::fs::read(state.engine.directory.join("versions.json"))
                .ok()
                .and_then(|b| serde_json::from_slice::<Value>(&b).ok());
            Ok(
                json!({"engineReady":state.engine.available(),"bridgeInstalled":state.data.join("native-host.json").exists(),"extensionPath":state.extension,"bridgePort":state.bridge.port,"versions":versions}),
            )
        }
        "add" => state.queue.add(payload),
        "update" => {
            state.queue.update(id, payload["options"].clone())?;
            Ok(Value::Null)
        }
        "start" => {
            state.queue.start(id)?;
            Ok(Value::Null)
        }
        "startAll" => {
            state.queue.start_all()?;
            Ok(Value::Null)
        }
        "updateSelected" => {
            let ids: Vec<String> = serde_json::from_value(payload["ids"].clone())
                .map_err(|_| "설정할 항목을 선택해 주세요.".to_string())?;
            let count = state
                .queue
                .configure_selected(&ids, payload["media"].as_str().unwrap_or(""))?;
            Ok(json!({"count":count}))
        }
        "downloadSelected" => {
            let ids: Vec<String> = serde_json::from_value(payload["ids"].clone())
                .map_err(|_| "다운로드할 항목을 선택해 주세요.".to_string())?;
            let count = state.queue.start_selected(&ids)?;
            Ok(json!({"count":count}))
        }
        "removeSelected" => {
            let ids: Vec<String> = serde_json::from_value(payload["ids"].clone())
                .map_err(|_| "제거할 항목을 선택해 주세요.".to_string())?;
            let count = state.queue.remove_selected(&ids)?;
            Ok(json!({"count":count}))
        }
        "deleteCompleted" => {
            let ids: Vec<String> = serde_json::from_value(payload["ids"].clone())
                .map_err(|_| "삭제할 완료 항목을 선택해 주세요.".to_string())?;
            let delete_files = payload["deleteFiles"]
                .as_bool()
                .ok_or("파일도 함께 삭제할지 선택해 주세요.")?;
            let queue = state.queue.clone();
            let result = tauri::async_runtime::spawn_blocking(move || {
                queue.delete_completed(&ids, delete_files)
            })
            .await
            .map_err(|error| error.to_string())??;
            Ok(serde_json::to_value(result).unwrap())
        }
        "cancel" => {
            state.queue.cancel(id, false)?;
            Ok(Value::Null)
        }
        "pause" => {
            state.queue.cancel(id, true)?;
            Ok(Value::Null)
        }
        "pauseAll" => {
            state.queue.pause_all()?;
            Ok(Value::Null)
        }
        "retry" => {
            state.queue.retry(id)?;
            Ok(Value::Null)
        }
        "remove" => {
            state.queue.remove(id)?;
            Ok(Value::Null)
        }
        "reorder" => {
            state
                .queue
                .reorder(id, payload["direction"].as_i64().unwrap_or(1))?;
            Ok(Value::Null)
        }
        "settings" => {
            let mut patch = payload;
            if let Some(object) = patch.as_object_mut() {
                object.remove("directory");
            }
            state.queue.settings(patch)?;
            Ok(Value::Null)
        }
        "pickDirectory" => {
            let folder = tauri::async_runtime::spawn_blocking(|| {
                rfd::FileDialog::new()
                    .set_title("영상 저장 폴더")
                    .pick_folder()
            })
            .await
            .map_err(|e| e.to_string())?;
            if let Some(folder) = folder {
                state
                    .queue
                    .settings(json!({"directory":folder.to_string_lossy()}))?;
            }
            Ok(Value::Null)
        }
        "openDirectory" => {
            let folder = PathBuf::from(state.queue.snapshot().settings.directory);
            std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
            open_directory(&folder)?;
            Ok(Value::Null)
        }
        "openRelease" => {
            // Explorer delegates HTTPS links to the user's default browser.
            let mut command = std::process::Command::new("explorer.exe");
            command.arg("https://jhljhljhl.github.io/release");
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                command.creation_flags(0x08000000);
            }
            command
                .spawn()
                .map_err(|e| format!("웹페이지를 열지 못했습니다: {e}"))?;
            Ok(Value::Null)
        }
        "reveal" => {
            let snapshot = state.queue.snapshot();
            let file = snapshot
                .items
                .iter()
                .find(|i| i.id == id && i.status == "completed")
                .and_then(|i| i.file_path.as_ref())
                .ok_or("완료된 파일이 없습니다.")?;
            if !PathBuf::from(file).is_file() {
                return Err("파일이 이동됐거나 삭제됐습니다.".into());
            }
            let file = dunce::canonicalize(file).map_err(|e| e.to_string())?;
            #[cfg(windows)]
            tauri::async_runtime::spawn_blocking(move || reveal_file(file))
                .await
                .map_err(|e| e.to_string())??;
            #[cfg(not(windows))]
            open_directory(file.parent().ok_or("저장 폴더가 없습니다.")?)?;
            Ok(Value::Null)
        }
        "installBridge" => bridge_install(&state),
        "openExtension" => {
            open_directory(&state.extension)?;
            Ok(Value::Null)
        }
        "showMain" => {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
            Ok(Value::Null)
        }
        "quit" => {
            begin_shutdown(&app, &state);
            Ok(Value::Null)
        }
        "dropWindow" => {
            if let Some(window) = app.get_webview_window("drop") {
                let _ = window.close();
            } else {
                WebviewWindowBuilder::new(
                    &app,
                    "drop",
                    WebviewUrl::App("index.html?window=drop".into()),
                )
                .title("snag · 드롭 창")
                .icon(taskbar_icon())
                .map_err(|e| e.to_string())?
                .inner_size(310.0, 210.0)
                .resizable(false)
                .always_on_top(true)
                .decorations(true)
                .disable_drag_drop_handler()
                .build()
                .map_err(|e| e.to_string())?;
            }
            Ok(Value::Null)
        }
        _ => Err("지원하지 않는 요청입니다.".into()),
    }
}
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .invoke_handler(tauri::generate_handler![command])
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    let state = window.app_handle().state::<AppState>();
                    if !state.closing.load(Ordering::SeqCst) {
                        api.prevent_close();
                        begin_shutdown(window.app_handle(), &state);
                    }
                }
            }
        })
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                window.set_icon(taskbar_icon())?;
            }
            let data = bridge::data_directory();
            let resources = app.path().resource_dir()?;
            let project = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .unwrap()
                .to_path_buf();
            let directory = std::env::var_os("STREAMDROP_ENGINE_DIR")
                .map(PathBuf::from)
                .unwrap_or_else(|| {
                    if resources.join("engine/yt-dlp.exe").exists() {
                        resources.join("engine")
                    } else {
                        project.join("engine")
                    }
                });
            let extension = if resources.join("extension/manifest.json").exists() {
                resources.join("extension")
            } else {
                project.join("extension")
            };
            // Shell/Chrome folder pickers expect conventional Windows paths, not \\?\ device paths.
            let extension = dunce::simplified(&extension).to_path_buf();
            let engine = Engine { directory };
            let handle = app.handle().clone();
            let import_handle = handle.clone();
            let queue = Queue::new(
                Store::new(data.join("queue.json")),
                Arc::new(engine.clone()),
                Arc::new(move |state| {
                    let _ = handle.emit("queue-changed", state);
                }),
                Arc::new(move |result| {
                    let _ = import_handle.emit("playlist-added", result);
                }),
            )?;
            let bridge = Bridge::start(
                queue.clone(),
                &data,
                tauri::async_runtime::handle().inner().clone(),
            )?;
            app.manage(AppState {
                queue,
                engine,
                bridge,
                extension,
                data,
                closing: AtomicBool::new(false),
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("snag could not start")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = &event {
                let state = app.state::<AppState>();
                if !state.closing.load(Ordering::SeqCst) {
                    api.prevent_exit();
                    begin_shutdown(app, &state);
                }
            }
            if let tauri::RunEvent::Exit = event {
                let state = app.state::<AppState>();
                state.queue.shutdown();
            }
        });
}
