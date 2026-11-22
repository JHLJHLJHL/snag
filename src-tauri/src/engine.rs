use crate::model::*;
use async_trait::async_trait;
use serde_json::Value;
use std::{path::PathBuf, process::Stdio, sync::Arc};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, BufReader},
    process::Command,
    sync::watch,
};

pub type ProgressFn = Arc<dyn Fn(Progress, bool) + Send + Sync>;

pub enum Analysis {
    Video(Info),
    Playlist {
        title: String,
        entries: Vec<Input>,
        skipped: usize,
    },
}
impl Analysis {
    pub fn from_ytdlp(input: &Input, value: Value) -> Result<Self, String> {
        if !matches!(value["_type"].as_str(), Some("playlist" | "multi_video")) {
            return Info::from_ytdlp(value).map(Self::Video);
        }
        let raw = value["entries"]
            .as_array()
            .ok_or("재생목록의 영상 목록을 읽지 못했습니다.")?;
        let mut entries = Vec::new();
        let mut skipped = 0;
        for entry in raw {
            let unavailable = matches!(
                entry["availability"].as_str(),
                Some("private" | "premium_only" | "subscriber_only" | "needs_auth" | "unavailable")
            ) || matches!(
                entry["title"].as_str(),
                Some("[Deleted video]" | "[Private video]")
            ) || matches!(
                entry["_type"].as_str(),
                Some("playlist" | "multi_video")
            );
            let url = ["webpage_url", "url"]
                .iter()
                .filter_map(|key| entry[key].as_str())
                .filter_map(|url| http_url(url).ok())
                .map(|url| canonical(&url))
                .find(|url| enqueue_key(url) != enqueue_key(&input.url));
            if unavailable || url.is_none() {
                skipped += 1;
                continue;
            }
            let child = Input::parse(serde_json::json!({
                "url": url.unwrap(),
                "pageUrl": input.page_url.as_ref().unwrap_or(&input.url),
                "title": entry["title"]
            }))?;
            entries.push(child);
        }
        if entries.is_empty() {
            return Err("재생목록에 추가할 수 있는 공개 영상이 없습니다. 비공개·삭제된 영상은 추가할 수 없습니다.".into());
        }
        Ok(Self::Playlist {
            title: value["title"]
                .as_str()
                .unwrap_or("재생목록")
                .chars()
                .take(500)
                .collect(),
            entries,
            skipped,
        })
    }
}
#[async_trait]
pub trait MediaEngine: Send + Sync {
    async fn analyze(&self, input: Input, cancel: watch::Receiver<bool>) -> Result<Info, String>;
    async fn resolve(
        &self,
        input: Input,
        cancel: watch::Receiver<bool>,
    ) -> Result<Analysis, String> {
        self.analyze(input, cancel).await.map(Analysis::Video)
    }
    async fn download(
        &self,
        item: Item,
        directory: PathBuf,
        cancel: watch::Receiver<bool>,
        progress: ProgressFn,
    ) -> Result<String, String>;
}
#[derive(Clone)]
pub struct Engine {
    pub directory: PathBuf,
}

pub fn hidden(command: &mut Command) {
    #[cfg(windows)]
    {
        command.creation_flags(0x08000000);
    }
    #[cfg(not(windows))]
    {
        let _ = command;
    }
}
pub fn base_args(input: &Input) -> Vec<String> {
    let mut args = [
        "--ignore-config",
        "--no-playlist",
        "--no-cache-dir",
        "--no-color",
        "--socket-timeout",
        "20",
        "--retries",
        "3",
        "--fragment-retries",
        "3",
    ]
    .map(String::from)
    .to_vec();
    // Use Windows' trusted roots, including roots installed by network/security software.
    // Certificate verification stays enabled.
    #[cfg(windows)]
    args.extend(["--compat-options".into(), "no-certifi".into()]);
    if let Some(page) = &input.page_url {
        args.extend(["--referer".into(), page.clone()]);
    }
    args
}
fn options_key(item: &Item) -> String {
    // Stable across process restarts, so changed settings cannot resume incompatible bytes.
    let bytes = serde_json::to_vec(&item.options).unwrap_or_default();
    let hash = bytes.into_iter().fold(0xcbf29ce484222325u64, |hash, b| {
        (hash ^ b as u64).wrapping_mul(0x100000001b3)
    });
    format!("{hash:016x}")
}
fn job_key(item: &Item) -> String {
    item.id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .take(32)
        .collect()
}
pub fn download_args(item: &Item, directory: &std::path::Path) -> Result<Vec<String>, String> {
    let mut args = base_args(&item.input);
    let o = item.options.clone().validate()?;
    args.extend(
        [
            "--newline",
            "--progress",
            "--progress-delta",
            "0.3",
            "--no-simulate",
            "--continue",
            "--no-overwrites",
            "--windows-filenames",
            "--trim-filenames",
            "180",
            "--paths",
        ]
        .map(String::from),
    );
    args.push(directory.to_string_lossy().into());
    args.extend([
        "--output".into(),
        format!(
            "%(title).110B [%(id)s] {}-{}-{}.%(ext)s",
            o.mode,
            &job_key(item)[..8.min(job_key(item).len())],
            options_key(item)
        ),
        "--format".into(),
    ]);
    args.push(
        o.selector(
            item.info
                .as_ref()
                .map(|i| i.formats.as_slice())
                .unwrap_or(&[]),
        )?,
    );
    args.extend(
        [
            "--progress-template",
            "download:SD_PROGRESS:%(progress)j",
            "--progress-template",
            "postprocess:SD_PROCESSING:%(progress)j",
            "--print",
            "after_move:SD_RESULT:%(filepath)j",
        ]
        .map(String::from),
    );
    if o.mode == "audio" {
        args.extend(
            [
                "--extract-audio",
                "--audio-format",
                if o.container == "mp3" { "mp3" } else { "best" },
            ]
            .map(String::from),
        );
        if o.container == "mp3" {
            args.extend([
                "--audio-quality".into(),
                if o.audio_quality == "best" {
                    "0".into()
                } else {
                    format!("{}K", o.audio_quality)
                },
            ]);
        }
    } else if o.container == "mp4" {
        args.extend(["--merge-output-format", "mp4", "--recode-video", "mp4"].map(String::from));
    } else {
        args.extend(["--merge-output-format", "mkv"].map(String::from));
    }
    args.extend(["--".into(), http_url(&item.input.url)?]);
    Ok(args)
}
impl Engine {
    pub fn executable(&self) -> PathBuf {
        self.directory.join(if cfg!(windows) {
            "yt-dlp.exe"
        } else {
            "yt-dlp"
        })
    }
    pub fn available(&self) -> bool {
        self.executable().is_file()
            && self
                .directory
                .join(if cfg!(windows) {
                    "ffmpeg.exe"
                } else {
                    "ffmpeg"
                })
                .is_file()
    }
    fn configured(&self, input: &Input) -> Vec<String> {
        let mut args = base_args(input);
        args.extend([
            "--ffmpeg-location".into(),
            self.directory.to_string_lossy().into(),
        ]);
        let deno = self
            .directory
            .join(if cfg!(windows) { "deno.exe" } else { "deno" });
        if deno.exists() {
            args.extend(["--js-runtimes".into(), format!("deno:{}", deno.display())]);
        }
        args
    }
    async fn run(
        &self,
        args: Vec<String>,
        mut cancel: watch::Receiver<bool>,
        progress: Option<ProgressFn>,
    ) -> Result<String, String> {
        if *cancel.borrow() {
            return Err("cancelled".into());
        }
        if !self.executable().is_file() {
            return Err(
                "다운로드 엔진이 없습니다. 프로젝트에서 npm run setup:engine을 실행해 주세요."
                    .into(),
            );
        }
        let mut cmd = Command::new(self.executable());
        hidden(&mut cmd);
        cmd.args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        let mut child = cmd
            .spawn()
            .map_err(|e| format!("다운로드 엔진을 실행하지 못했습니다: {e}"))?;
        let pid = child.id();
        let stdout = child.stdout.take().ok_or("엔진 출력을 읽지 못했습니다.")?;
        let stderr = child.stderr.take().ok_or("엔진 오류를 읽지 못했습니다.")?;
        let err_task = tokio::spawn(async move {
            let mut text = String::new();
            let _ = stderr.take(65536).read_to_string(&mut text).await;
            text
        });
        let timeout = if progress.is_some() { 86400 } else { 120 };
        let output_task = tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            let mut output = String::new();
            while let Some(line) = lines.next_line().await.map_err(|e| e.to_string())? {
                if let Some(data) = line.strip_prefix("SD_PROGRESS:") {
                    if let (Some(callback), Ok(p)) =
                        (&progress, serde_json::from_str::<Value>(data))
                    {
                        let downloaded = p["downloaded_bytes"].as_u64().unwrap_or(0);
                        let total = p["total_bytes"]
                            .as_u64()
                            .or(p["total_bytes_estimate"].as_u64());
                        callback(
                            Progress {
                                percent: total
                                    .filter(|t| *t > 0)
                                    .map(|t| downloaded as f64 / t as f64 * 100.0)
                                    .unwrap_or(0.0)
                                    .clamp(0.0, 100.0),
                                downloaded,
                                total,
                                speed: p["speed"].as_f64(),
                                eta: p["eta"].as_f64(),
                            },
                            p["status"] == "finished",
                        );
                    }
                } else if line.starts_with("SD_PROCESSING:") {
                    if let Some(callback) = &progress {
                        callback(
                            Progress {
                                percent: 100.0,
                                ..Default::default()
                            },
                            true,
                        );
                    }
                } else if line.starts_with("SD_RESULT:") || progress.is_none() {
                    output.push_str(&line);
                    output.push('\n');
                    if output.len() > 32 * 1024 * 1024 {
                        return Err(
                            "영상 정보가 너무 큽니다. 개별 영상 주소를 사용해 주세요.".into()
                        );
                    }
                }
            }
            Ok::<_, String>(output)
        });
        let status = tokio::select! {
            status=child.wait()=>status.map_err(|e|e.to_string()),
            _=cancel.changed()=>{
                #[cfg(windows)] if let Some(pid)=pid {let mut kill=Command::new("taskkill");hidden(&mut kill);let _=kill.args(["/PID",&pid.to_string(),"/T","/F"]).output().await;}
                #[cfg(not(windows))] let _=pid;
                let _=child.kill().await;output_task.abort();err_task.abort();return Err("cancelled".into());
            }
            _=tokio::time::sleep(std::time::Duration::from_secs(timeout))=>{
                #[cfg(windows)] if let Some(pid)=pid {let mut kill=Command::new("taskkill");hidden(&mut kill);let _=kill.args(["/PID",&pid.to_string(),"/T","/F"]).output().await;}
                let _=child.kill().await;output_task.abort();err_task.abort();return Err("영상 서버 응답 시간이 초과됐습니다. 다시 시도해 주세요.".into());
            }
        }?;
        let output = output_task.await.map_err(|e| e.to_string())??;
        let errors = err_task.await.unwrap_or_default();
        if !status.success() {
            return Err(friendly_error(if errors.trim().is_empty() {
                "다운로드 엔진이 비정상 종료됐습니다."
            } else {
                &errors
            }));
        }
        Ok(output)
    }
}
#[async_trait]
impl MediaEngine for Engine {
    async fn resolve(
        &self,
        input: Input,
        cancel: watch::Receiver<bool>,
    ) -> Result<Analysis, String> {
        let mut args = self.configured(&input);
        args.retain(|arg| arg != "--no-playlist");
        args.extend([
            "--yes-playlist".into(),
            "--flat-playlist".into(),
            "--dump-single-json".into(),
            "--skip-download".into(),
            "--".into(),
            input.url.clone(),
        ]);
        let output = self.run(args, cancel, None).await?;
        Analysis::from_ytdlp(
            &input,
            serde_json::from_str(output.trim())
                .map_err(|_| "영상·재생목록 분석 결과를 읽지 못했습니다.")?,
        )
    }
    async fn analyze(&self, input: Input, cancel: watch::Receiver<bool>) -> Result<Info, String> {
        let mut args = self.configured(&input);
        args.extend([
            "--dump-single-json".into(),
            "--skip-download".into(),
            "--".into(),
            input.url.clone(),
        ]);
        let output = self.run(args, cancel, None).await?;
        Info::from_ytdlp(
            serde_json::from_str(output.trim()).map_err(|_| "영상 분석 결과를 읽지 못했습니다.")?,
        )
    }
    async fn download(
        &self,
        item: Item,
        directory: PathBuf,
        mut cancel: watch::Receiver<bool>,
        progress: ProgressFn,
    ) -> Result<String, String> {
        std::fs::create_dir_all(&directory)
            .map_err(|e| format!("저장 폴더를 만들지 못했습니다: {e}"))?;
        let staging = directory.join(".streamdrop").join(format!(
            "{}-{}",
            job_key(&item),
            options_key(&item)
        ));
        std::fs::create_dir_all(&staging).map_err(|e| e.to_string())?;
        let mut args = self.configured(&item.input);
        args.extend(
            download_args(&item, &staging)?
                .into_iter()
                .skip(base_args(&item.input).len()),
        );
        let output = self
            .run(args, cancel.clone(), Some(progress.clone()))
            .await?;
        let file = output
            .lines()
            .filter_map(|l| l.strip_prefix("SD_RESULT:"))
            .last()
            .ok_or("저장된 파일 경로를 확인하지 못했습니다.")?;
        let file: String =
            serde_json::from_str(file).map_err(|_| "저장 경로를 읽지 못했습니다.")?;
        if !std::path::Path::new(&file).is_file() {
            return Err("다운로드된 파일을 찾지 못했습니다.".into());
        }
        if item.options.mode == "video" {
            progress(
                Progress {
                    percent: 100.0,
                    ..Default::default()
                },
                true,
            );
            let source = PathBuf::from(&file);
            let temp = source.with_file_name(format!(
                "{}.video-only.{}",
                source.file_stem().unwrap_or_default().to_string_lossy(),
                source.extension().unwrap_or_default().to_string_lossy()
            ));
            let mut cmd = Command::new(self.directory.join(if cfg!(windows) {
                "ffmpeg.exe"
            } else {
                "ffmpeg"
            }));
            hidden(&mut cmd);
            cmd.args([
                "-y", "-nostdin", "-i", &file, "-map", "0:v:0", "-c:v", "copy", "-an",
            ])
            .arg(&temp)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true);
            let mut child = cmd.spawn().map_err(|e| e.to_string())?;
            let status = tokio::select! {r=child.wait()=>r.map_err(|e|e.to_string())?,_=cancel.changed()=>{let _=child.kill().await;let _=std::fs::remove_file(&temp);return Err("cancelled".into());}};
            if !status.success() {
                let _ = std::fs::remove_file(&temp);
                return Err("영상 전용 파일을 만드는 중 오류가 발생했습니다.".into());
            }
            std::fs::rename(&temp, &source).map_err(|e| e.to_string())?;
        }
        if *cancel.borrow() {
            return Err("cancelled".into());
        }
        let source = PathBuf::from(&file);
        let name = source.file_name().ok_or("파일 이름을 읽지 못했습니다.")?;
        let mut destination = directory.join(name);
        let mut suffix = 2;
        loop {
            match std::fs::hard_link(&source, &destination) {
                Ok(()) => break,
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
                Err(_) => {
                    use std::io::Write;
                    match std::fs::OpenOptions::new()
                        .write(true)
                        .create_new(true)
                        .open(&destination)
                    {
                        Ok(mut target) => {
                            let result = std::fs::File::open(&source)
                                .and_then(|mut source| std::io::copy(&mut source, &mut target))
                                .and_then(|_| target.flush())
                                .and_then(|_| target.sync_all());
                            if let Err(e) = result {
                                drop(target);
                                let _ = std::fs::remove_file(&destination);
                                return Err(format!("완료 파일을 저장하지 못했습니다: {e}"));
                            }
                            break;
                        }
                        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
                        Err(e) => return Err(format!("완료 파일을 저장하지 못했습니다: {e}")),
                    }
                }
            }
            let stem = source.file_stem().unwrap_or_default().to_string_lossy();
            let ext = source.extension().unwrap_or_default().to_string_lossy();
            destination = directory.join(format!("{stem} ({suffix}).{ext}"));
            suffix += 1;
        }
        let _ = std::fs::remove_file(&source);
        let _ = std::fs::remove_dir(&staging);
        Ok(destination.to_string_lossy().into())
    }
}
