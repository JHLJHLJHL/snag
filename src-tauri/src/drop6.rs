use crate::model::State;
use std::{collections::HashSet, path::PathBuf};
use url::Url;

pub const URL: &str = "https://drop6.duckdns.org/";

pub fn allows_navigation(url: &Url) -> bool {
    url.scheme()=="https" && url.host_str()==Some("drop6.duckdns.org")
        && url.port_or_known_default()==Some(443) && url.username().is_empty() && url.password().is_none()
}

pub fn completed_files(state: &State, ids: &[String]) -> Result<Vec<PathBuf>, String> {
    if ids.is_empty() { return Err("보낼 완료 파일을 선택해 주세요.".into()); }
    let mut seen=HashSet::new();
    let mut files=Vec::new();
    for id in ids {
        if !seen.insert(id) { continue; }
        let item=state.items.iter().find(|item| &item.id==id && item.status=="completed")
            .ok_or("선택한 항목에 완료된 파일이 없습니다.")?;
        let file=item.file_path.as_ref().map(PathBuf::from)
            .filter(|file| file.is_file()).ok_or("선택한 파일이 이동됐거나 삭제됐습니다.")?;
        files.push(std::fs::canonicalize(file).map_err(|error|format!("파일을 열 수 없습니다: {error}"))?);
    }
    Ok(files)
}

#[cfg(all(feature="desktop",windows))]
async fn cdp(window: &tauri::WebviewWindow, method: &'static str, parameters: serde_json::Value) -> Result<serde_json::Value,String> {
    use std::sync::{Arc,Mutex};
    use windows::core::{HSTRING,PCWSTR};
    use webview2_com::CallDevToolsProtocolMethodCompletedHandler;
    let (sender,receiver)=tokio::sync::oneshot::channel();
    let reply=Arc::new(Mutex::new(Some(sender)));
    window.with_webview(move |webview| unsafe {
        let callback_reply=reply.clone();
        let result=(|| -> windows::core::Result<()> {
            let core=webview.controller().CoreWebView2()?;
            let handler=CallDevToolsProtocolMethodCompletedHandler::create(Box::new(move |status,response| {
                let result=status.map_err(|error|error.to_string()).and_then(|_| {
                    serde_json::from_str::<serde_json::Value>(&response).map_err(|error|error.to_string())
                });
                if let Some(sender)=callback_reply.lock().unwrap().take() { let _=sender.send(result); }
                Ok(())
            }));
            let method=HSTRING::from(method);
            let parameters=HSTRING::from(parameters.to_string());
            core.CallDevToolsProtocolMethod(PCWSTR(method.as_ptr()),PCWSTR(parameters.as_ptr()),&handler)
        })();
        if let Err(error)=result {
            if let Some(sender)=reply.lock().unwrap().take() { let _=sender.send(Err(error.to_string())); }
        }
    }).map_err(|error|error.to_string())?;
    tokio::time::timeout(std::time::Duration::from_secs(10),receiver).await
        .map_err(|_|"DROP6 창이 응답하지 않습니다.".to_string())?
        .map_err(|_|"DROP6 창이 닫혔습니다.".to_string())?
}

#[cfg(all(feature="desktop",windows))]
pub async fn open(app: &tauri::AppHandle, files: Vec<PathBuf>) -> Result<(),String> {
    use serde_json::json;
    use tauri::{WebviewUrl,WebviewWindowBuilder};
    let window=WebviewWindowBuilder::new(app,format!("drop6-{}",uuid::Uuid::new_v4()),WebviewUrl::External(URL.parse().unwrap()))
        .title(format!("DROP6 · {}개 파일 보내기",files.len()))
        .inner_size(800.0,820.0).min_inner_size(480.0,620.0)
        .on_navigation(allows_navigation)
        .on_new_window(|_,_|tauri::webview::NewWindowResponse::Deny)
        .build().map_err(|error|format!("DROP6 창을 열지 못했습니다: {error}"))?;
    let deadline=std::time::Instant::now()+std::time::Duration::from_secs(30);
    let object_id=loop {
        let result=cdp(&window,"Runtime.evaluate",json!({
            "expression":"location.origin === 'https://drop6.duckdns.org' ? document.querySelector('input[type=\"file\"]') : null",
            "objectGroup":"snag-send"
        })).await;
        if let Ok(value)=result {
            if let Some(id)=value["result"]["objectId"].as_str() { break id.to_string(); }
        }
        if std::time::Instant::now()>=deadline {
            return Err("DROP6에 파일을 자동으로 추가하지 못했습니다. 인터넷 연결을 확인하고 다시 보내 주세요.".into());
        }
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    };
    // WebView2 grants only these explicitly selected files to this page's file input.
    // No file bytes are embedded in JavaScript and the remote window receives no native commands.
    let paths:Vec<_>=files.iter().map(|file|dunce::simplified(file).to_string_lossy().into_owned()).collect();
    let result=cdp(&window,"DOM.setFileInputFiles",json!({"files":paths,"objectId":object_id})).await?;
    if result.get("error").is_some() || result.get("code").is_some() {
        return Err("DROP6에 파일을 추가하지 못했습니다. 다시 보내 주세요.".into());
    }
    let _=cdp(&window,"Runtime.releaseObjectGroup",json!({"objectGroup":"snag-send"})).await;
    Ok(())
}

#[cfg(all(feature="desktop",not(windows)))]
pub async fn open(_: &tauri::AppHandle, _: Vec<PathBuf>) -> Result<(),String> {
    Err("DROP6 자동 파일 추가는 Windows에서 지원됩니다.".into())
}
