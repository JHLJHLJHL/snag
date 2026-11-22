use crate::{model::Input, queue::Queue};
use serde_json::{json, Value};
use std::{
    io::{Read, Write},
    net::TcpStream,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};
use tiny_http::{Header, Method, Response, Server, StatusCode};

pub const HOST_NAME: &str = "com.streamdrop.desktop";
pub const MAX_MESSAGE: usize = 1024 * 1024;
pub fn data_directory() -> PathBuf {
    std::env::var_os("STREAMDROP_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(
                std::env::var_os("LOCALAPPDATA")
                    .or_else(|| std::env::var_os("HOME"))
                    .unwrap_or_default(),
            )
            .join("com.streamdrop.desktop")
        })
}
pub fn read_frame(reader: &mut impl Read) -> Result<Value, String> {
    let mut size = [0u8; 4];
    reader.read_exact(&mut size).map_err(|e| e.to_string())?;
    let size = u32::from_le_bytes(size) as usize;
    if size == 0 || size > MAX_MESSAGE {
        return Err("메시지 크기를 초과했습니다.".into());
    }
    let mut buffer = vec![0; size];
    reader.read_exact(&mut buffer).map_err(|e| e.to_string())?;
    serde_json::from_slice(&buffer).map_err(|e| e.to_string())
}
pub fn write_frame(writer: &mut impl Write, value: &Value) -> Result<(), String> {
    let bytes = serde_json::to_vec(value).map_err(|e| e.to_string())?;
    if bytes.len() > MAX_MESSAGE {
        return Err("메시지 크기를 초과했습니다.".into());
    }
    writer
        .write_all(&(bytes.len() as u32).to_le_bytes())
        .and_then(|_| writer.write_all(&bytes))
        .and_then(|_| writer.flush())
        .map_err(|e| e.to_string())
}
pub fn relay(message: Value, connection: &Path) -> Result<Value, String> {
    let config: Value = serde_json::from_slice(
        &std::fs::read(connection).map_err(|_| "snag 앱을 먼저 실행해 주세요.")?,
    )
    .map_err(|_| "연결 정보를 읽지 못했습니다.")?;
    let port = config["port"]
        .as_u64()
        .filter(|p| *p > 0 && *p <= 65535)
        .ok_or("앱 연결 포트가 올바르지 않습니다.")? as u16;
    let token = config["token"]
        .as_str()
        .filter(|t| t.len() == 32 && t.chars().all(|c| c.is_ascii_hexdigit()))
        .ok_or("앱 연결 정보가 올바르지 않습니다.")?;
    let body = serde_json::to_string(&message).map_err(|e| e.to_string())?;
    if body.len() > MAX_MESSAGE {
        return Err("메시지 크기를 초과했습니다.".into());
    }
    let mut socket =
        TcpStream::connect_timeout(&([127, 0, 0, 1], port).into(), Duration::from_secs(3))
            .map_err(|_| "snag 앱을 먼저 실행해 주세요.")?;
    socket
        .set_read_timeout(Some(Duration::from_secs(8)))
        .map_err(|e| e.to_string())?;
    write!(socket,"POST /bridge HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer {token}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len()).map_err(|e|e.to_string())?;
    let mut response = String::new();
    socket
        .take((MAX_MESSAGE + 8192) as u64)
        .read_to_string(&mut response)
        .map_err(|e| e.to_string())?;
    let (header, body) = response
        .split_once("\r\n\r\n")
        .ok_or("앱 응답을 읽지 못했습니다.")?;
    if !header.starts_with("HTTP/1.1 200") && !header.starts_with("HTTP/1.0 200") {
        return Err("앱 연결 요청이 거부됐습니다.".into());
    }
    serde_json::from_str(body).map_err(|_| "앱 응답을 해석하지 못했습니다.".into())
}
pub fn native_host() -> Result<(), String> {
    let input = read_frame(&mut std::io::stdin().lock())?;
    let response = match relay(input, &data_directory().join("bridge.json")) {
        Ok(v) => v,
        Err(e) => json!({"ok":false,"error":e}),
    };
    write_frame(&mut std::io::stdout().lock(), &response)
}
pub struct Bridge {
    pub port: u16,
    pub connection: PathBuf,
    stop: Arc<AtomicBool>,
}
impl Bridge {
    pub fn start(
        queue: Arc<Queue>,
        directory: &Path,
        runtime: tokio::runtime::Handle,
    ) -> Result<Self, String> {
        let server = Server::http("127.0.0.1:0").map_err(|e| e.to_string())?;
        let port = server.server_addr().to_ip().ok_or("연결 주소 오류")?.port();
        let token = uuid::Uuid::new_v4().simple().to_string();
        std::fs::create_dir_all(directory).map_err(|e| e.to_string())?;
        let connection = directory.join("bridge.json");
        std::fs::write(&connection, json!({"port":port,"token":token}).to_string())
            .map_err(|e| e.to_string())?;
        let stop = Arc::new(AtomicBool::new(false));
        let flag = stop.clone();
        std::thread::spawn(move || {
            while !flag.load(Ordering::SeqCst) {
                let Ok(Some(mut request)) = server.recv_timeout(Duration::from_millis(200)) else {
                    continue;
                };
                let auth = request.headers().iter().any(|h| {
                    h.field.equiv("Authorization") && h.value.as_str() == format!("Bearer {token}")
                });
                let origin = request.headers().iter().any(|h| h.field.equiv("Origin"));
                if request.method() != &Method::Post
                    || request.url() != "/bridge"
                    || !auth
                    || origin
                {
                    let _ = request
                        .respond(Response::from_string("denied").with_status_code(StatusCode(403)));
                    continue;
                }
                let mut body = String::new();
                let result = request
                    .as_reader()
                    .take((MAX_MESSAGE + 1) as u64)
                    .read_to_string(&mut body);
                let response = if result.is_err() || body.len() > MAX_MESSAGE {
                    json!({"ok":false,"error":"메시지 크기를 초과했습니다."})
                } else {
                    let result = (|| -> Result<Value, String> {
                        let value: Value =
                            serde_json::from_str(&body).map_err(|_| "올바른 메시지가 아닙니다.")?;
                        match value["action"].as_str() {
                            Some("status") => Ok(
                                json!({"connected":true,"queued":queue.snapshot().items.len(),"version":env!("CARGO_PKG_VERSION")}),
                            ),
                            Some("enqueue") => {
                                let input = Input::parse(value["data"].clone())?;
                                let _guard = runtime.enter();
                                queue.add(serde_json::to_value(input).unwrap())
                            }
                            _ => Err("지원하지 않는 요청입니다.".into()),
                        }
                    })();
                    match result {
                        Ok(v) => json!({"ok":true,"data":v}),
                        Err(e) => json!({"ok":false,"error":e}),
                    }
                };
                let header =
                    Header::from_bytes("Content-Type", "application/json; charset=utf-8").unwrap();
                let _ = request
                    .respond(Response::from_string(response.to_string()).with_header(header));
            }
        });
        Ok(Self {
            port,
            connection,
            stop,
        })
    }
}
impl Drop for Bridge {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        let _ = std::fs::remove_file(&self.connection);
    }
}
