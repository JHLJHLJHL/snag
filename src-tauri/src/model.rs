use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::{SystemTime, UNIX_EPOCH};
use url::Url;

pub fn timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
pub fn http_url(raw: &str) -> Result<String, String> {
    if raw.len() > 16384 {
        return Err("영상 주소가 너무 깁니다.".into());
    }
    let mut u = Url::parse(raw.trim()).map_err(|_| "http 또는 https 영상 주소를 입력해 주세요.")?;
    if !["http", "https"].contains(&u.scheme())
        || !u.username().is_empty()
        || u.password().is_some()
        || u.host_str().is_none()
    {
        return Err("로그인 정보가 없는 http 또는 https 주소만 지원합니다.".into());
    }
    u.set_fragment(None);
    Ok(u.to_string())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Input {
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub page_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
}
impl Input {
    pub fn parse(raw: Value) -> Result<Self, String> {
        let raw = if let Some(s) = raw.as_str() {
            if let Some(data) = s.trim().strip_prefix("streamdrop:") {
                serde_json::from_str(data).map_err(|_| "영상 정보를 읽을 수 없습니다.")?
            } else {
                json!({"url":s.lines().find(|l|!l.trim().is_empty()&&!l.trim().starts_with('#')).unwrap_or("").trim()})
            }
        } else {
            raw
        };
        let url = http_url(raw["url"].as_str().ok_or("영상 주소가 필요합니다.")?)?;
        let page_url = raw["pageUrl"]
            .as_str()
            .filter(|s| !s.is_empty())
            .map(http_url)
            .transpose()?;
        let title = raw["title"].as_str().map(|s| s.chars().take(500).collect());
        Ok(Self {
            url,
            page_url,
            title,
        })
    }
}
pub fn canonical(raw: &str) -> String {
    let Ok(u) = Url::parse(raw) else {
        return raw.into();
    };
    if [
        "youtube.com",
        "www.youtube.com",
        "m.youtube.com",
        "music.youtube.com",
        "youtu.be",
    ]
    .contains(&u.host_str().unwrap_or(""))
    {
        let id = if u.host_str() == Some("youtu.be") {
            Some(u.path().trim_start_matches('/').to_string())
        } else {
            u.query_pairs()
                .find(|(k, _)| k == "v")
                .map(|(_, v)| v.into_owned())
                .or_else(|| {
                    let p = u.path().split('/').collect::<Vec<_>>();
                    if p.len() > 2 && ["shorts", "embed"].contains(&p[1]) {
                        Some(p[2].into())
                    } else {
                        None
                    }
                })
        };
        if let Some(id) = id {
            return format!("https://www.youtube.com/watch?v={id}");
        }
    }
    http_url(raw).unwrap_or_else(|_| raw.into())
}

// A watch URL with a list identifies the whole playlist when it is enqueued.
// Individual download jobs still use canonical video identities.
pub fn enqueue_key(raw: &str) -> String {
    if let Ok(u) = Url::parse(raw) {
        if [
            "youtube.com",
            "www.youtube.com",
            "m.youtube.com",
            "music.youtube.com",
            "youtu.be",
        ]
        .contains(&u.host_str().unwrap_or(""))
        {
            if let Some((_, list)) = u
                .query_pairs()
                .find(|(key, value)| key == "list" && !value.is_empty())
            {
                let mut key = Url::parse("https://www.youtube.com/playlist").unwrap();
                key.query_pairs_mut().append_pair("list", &list);
                return key.to_string();
            }
        }
    }
    canonical(raw)
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Options {
    pub preset: String,
    pub mode: String,
    pub container: String,
    pub video_format: String,
    pub audio_format: String,
    pub audio_quality: String,
}
impl Default for Options {
    fn default() -> Self {
        Self {
            preset: "best".into(),
            mode: "both".into(),
            container: "mp4".into(),
            video_format: "auto".into(),
            audio_format: "auto".into(),
            audio_quality: "best".into(),
        }
    }
}
impl Options {
    pub fn validate(mut self) -> Result<Self, String> {
        if !["best", "1080", "720", "480"].contains(&self.preset.as_str())
            || !["both", "video", "audio"].contains(&self.mode.as_str())
            || !["original", "mp4", "mp3"].contains(&self.container.as_str())
            || !["best", "320", "256", "192", "128", "96"].contains(&self.audio_quality.as_str())
        {
            return Err("지원하지 않는 품질 설정입니다.".into());
        }
        if self.container == "mp3" {
            self.mode = "audio".into();
        }
        if self.video_format.len() > 200 || self.audio_format.len() > 200 {
            return Err("올바른 포맷을 선택해 주세요.".into());
        }
        Ok(self)
    }
    pub fn selector(&self, formats: &[Format]) -> Result<String, String> {
        let o = self.clone().validate()?;
        let selected = |id: &str, video: bool| -> Result<Option<Format>, String> {
            if id == "auto" {
                return Ok(None);
            }
            if !id
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || "_.:-".contains(c))
            {
                return Err("지원하지 않는 포맷 ID입니다.".into());
            }
            formats
                .iter()
                .find(|f| f.id == id && if video { f.video } else { f.audio })
                .cloned()
                .map(Some)
                .ok_or("선택한 포맷을 사용할 수 없습니다. 다시 분석해 주세요.".into())
        };
        let v = if o.mode != "audio" {
            selected(&o.video_format, true)?
        } else {
            None
        };
        let a = if o.mode != "video" {
            selected(&o.audio_format, false)?
        } else {
            None
        };
        let cap = if o.preset == "best" {
            String::new()
        } else {
            // Direct media URLs can omit every resolution field. Keep measured
            // sources strictly capped, but let an unmeasured source be selected.
            let unmeasured = formats.iter().any(|f| f.video)
                && !formats.iter().any(|f| f.video && f.height.is_some());
            format!(
                "[height<={}{}]",
                if unmeasured { "?" } else { "" },
                o.preset
            )
        };
        if o.mode == "audio" {
            return Ok(a.map(|f| f.id).unwrap_or("bestaudio/best".into()));
        }
        if o.mode == "video" {
            return Ok(v
                .map(|f| f.id)
                .unwrap_or(format!("bestvideo{cap}/best{cap}")));
        }
        match (v,a) {
            (Some(v),Some(_)) if v.audio=>Err("음성이 포함된 영상 포맷은 별도 음질을 선택할 수 없습니다. 영상 전용 포맷을 선택해 주세요.".into()),
            (Some(v),Some(a))=>Ok(format!("{}+{}",v.id,a.id)),
            (Some(v),None) if v.audio=>Ok(v.id),
            (Some(v),None)=>Ok(format!("{}+bestaudio/{}",v.id,v.id)),
            (None,Some(a))=>Ok(format!("bestvideo{cap}+{}/best{cap}",a.id)),
            _=>Ok(format!("bestvideo{cap}+bestaudio/best{cap}"))
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Format {
    pub id: String,
    pub ext: String,
    pub video: bool,
    pub audio: bool,
    pub height: Option<u64>,
    pub width: Option<u64>,
    pub fps: Option<f64>,
    pub abr: Option<f64>,
    pub tbr: Option<f64>,
    pub language: String,
    pub vcodec: String,
    pub acodec: String,
    pub size: Option<u64>,
    pub note: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Info {
    pub id: String,
    pub extractor: String,
    pub title: String,
    pub duration: Option<f64>,
    pub thumbnail: Option<String>,
    pub formats: Vec<Format>,
}
fn text(v: &Value, k: &str) -> String {
    v[k].as_str().unwrap_or("").to_string()
}
impl Info {
    pub fn from_ytdlp(info: Value) -> Result<Self, String> {
        if info["is_live"] == true || info["live_status"] == "is_live" {
            return Err(
                "실시간 방송 저장은 아직 지원하지 않습니다. 종료된 영상을 추가해 주세요.".into(),
            );
        }
        if info["_type"] == "playlist" {
            return Err("재생목록 대신 개별 영상 주소를 추가해 주세요.".into());
        }
        let raw = info["formats"]
            .as_array()
            .filter(|a| !a.is_empty())
            .cloned()
            .unwrap_or_else(|| vec![info.clone()]);
        let formats = raw
            .iter()
            .filter(|f| {
                f["has_drm"] != true
                    && f["vcodec"] != "images"
                    && f["ext"] != "mhtml"
                    && !(f["vcodec"] == "none" && f["acodec"] == "none")
            })
            .map(|f| Format {
                id: f["format_id"].as_str().unwrap_or("direct").into(),
                ext: text(f, "ext"),
                video: f["vcodec"] != "none",
                audio: f["acodec"].is_string() && f["acodec"] != "none",
                height: f["height"].as_u64(),
                width: f["width"].as_u64(),
                fps: f["fps"].as_f64(),
                abr: f["abr"].as_f64(),
                tbr: f["tbr"].as_f64(),
                language: text(f, "language"),
                vcodec: text(f, "vcodec"),
                acodec: text(f, "acodec"),
                size: f["filesize"].as_u64().or(f["filesize_approx"].as_u64()),
                note: text(f, "format_note"),
            })
            .collect::<Vec<_>>();
        if formats.is_empty() {
            return Err(
                "다운로드 가능한 일반 영상 포맷이 없습니다. DRM 보호 여부를 확인해 주세요.".into(),
            );
        }
        Ok(Self {
            id: text(&info, "id"),
            extractor: text(&info, "extractor_key"),
            title: info["title"].as_str().unwrap_or("제목 없는 영상").into(),
            duration: info["duration"].as_f64(),
            thumbnail: info["thumbnail"].as_str().and_then(|s| http_url(s).ok()),
            formats,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Progress {
    pub percent: f64,
    pub downloaded: u64,
    pub total: Option<u64>,
    pub speed: Option<f64>,
    pub eta: Option<f64>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub id: String,
    #[serde(flatten)]
    pub input: Input,
    pub title: String,
    pub status: String,
    pub created_at: u64,
    pub options: Options,
    pub progress: Progress,
    pub info: Option<Info>,
    pub error: Option<String>,
    pub file_path: Option<String>,
    #[serde(default)]
    pub start_when_ready: bool,
}
impl Item {
    pub fn new(mut input: Input, options: Options) -> Self {
        let title = input.title.take().unwrap_or_else(|| {
            Url::parse(&input.url)
                .ok()
                .and_then(|u| u.host_str().map(String::from))
                .unwrap_or("영상".into())
        });
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            input,
            title,
            status: "analyzing".into(),
            created_at: timestamp(),
            options,
            progress: Progress::default(),
            info: None,
            error: None,
            file_path: None,
            start_when_ready: false,
        }
    }
    pub fn busy(&self) -> bool {
        ["analyzing", "queued", "downloading", "processing"].contains(&self.status.as_str())
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    #[serde(flatten)]
    pub options: Options,
    pub directory: String,
    pub auto_start: bool,
}
impl Default for Settings {
    fn default() -> Self {
        let home = std::env::var("USERPROFILE")
            .or_else(|_| std::env::var("HOME"))
            .unwrap_or(".".into());
        Self {
            options: Options::default(),
            directory: format!("{home}/Downloads/snag"),
            auto_start: false,
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct State {
    pub version: u32,
    pub items: Vec<Item>,
    pub settings: Settings,
}
impl Default for State {
    fn default() -> Self {
        Self {
            version: 2,
            items: Vec::new(),
            settings: Settings::default(),
        }
    }
}

pub fn friendly_error(raw: &str) -> String {
    let s = raw.to_lowercase();
    if [
        "certificate_verify_failed",
        "certificate verify failed",
        "certificate has expired",
        "self-signed certificate",
    ]
    .iter()
    .any(|x| s.contains(x))
    {
        return "보안 인증서를 확인하지 못했습니다. Windows 날짜·시간 및 보안 프로그램·프록시의 인증서 설정을 확인한 뒤 다시 시도해 주세요.".into();
    }
    if [
        "login",
        "sign in",
        "cookies",
        "authentication",
        "members-only",
        "private video",
    ]
    .iter()
    .any(|x| s.contains(x))
    {
        return "로그인이 필요한 영상입니다. 이 앱은 로그인 연동을 지원하지 않습니다.".into();
    }
    if s.contains("drm") {
        return "DRM으로 보호된 영상은 지원하지 않습니다.".into();
    }
    if ["403", "expired", "forbidden"]
        .iter()
        .any(|x| s.contains(x))
    {
        return "영상 주소가 만료됐거나 접근이 거부됐습니다. 크롬에서 영상을 다시 추가해 주세요."
            .into();
    }
    if s.contains("unsupported url") {
        return "이 주소에서 영상을 찾지 못했습니다. 크롬 확장 프로그램의 감지 목록에서 영상을 추가해 주세요.".into();
    }
    if s.contains("requested format is not available") {
        return "선택한 화질을 제공하지 않습니다. 품질을 자동으로 변경하거나 다시 분석해 주세요."
            .into();
    }
    raw.chars()
        .rev()
        .take(1200)
        .collect::<String>()
        .chars()
        .rev()
        .collect()
}
