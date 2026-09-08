//! Transcription of a meeting recording through the add-on engine.
//!
//! The engine (`asapnotes-transcribe`, whisper.cpp) and the speech models are
//! downloads the user asks for, into app data: a default install carries none
//! of them, and nothing here opens a connection until a download button is
//! pressed. Each download is checked against a digest this build carries, so
//! the file that ends up running is the one the release built.
//!
//! One transcription at a time, in a child process the app can kill. Progress
//! and completion reach the window as events; the finished transcript waits in
//! memory until the window takes it, so a reload midway loses nothing.

use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager};

struct Model {
    id: &'static str,
    file: &'static str,
    label: &'static str,
    detail: &'static str,
    bytes: u64,
    sha256: &'static str,
}

/// The models offered, all multilingual. Digests were taken from the files
/// the publisher serves; a download that differs is refused.
const MODELS: &[Model] = &[
    Model {
        id: "base",
        file: "ggml-base.bin",
        label: "Base",
        detail: "Fast and rough; enough for a skim",
        bytes: 147_951_465,
        sha256: "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe",
    },
    Model {
        id: "small",
        file: "ggml-small.bin",
        label: "Small",
        detail: "Good accuracy at a pace a laptop keeps up with",
        bytes: 487_601_967,
        sha256: "1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b",
    },
    Model {
        id: "large-v3-turbo-q5_0",
        file: "ggml-large-v3-turbo-q5_0.bin",
        label: "Large v3 turbo",
        detail: "Best accuracy; slow on a CPU",
        bytes: 574_041_195,
        sha256: "394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2",
    },
];
const MODEL_URL: &str = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/";

/// Digest and size of the engine build this app version downloads, set by
/// the release workflow, which builds the engine before the app. Absent in a
/// development build, which finds the engine beside its own executable.
const ENGINE_SHA256: Option<&str> = option_env!("ASAPNOTES_TRANSCRIBE_SHA256");
const ENGINE_BYTES: Option<&str> = option_env!("ASAPNOTES_TRANSCRIBE_BYTES");
const ENGINE_FILE: &str = if cfg!(windows) {
    "asapnotes-transcribe.exe"
} else {
    "asapnotes-transcribe"
};

fn engine_url(app: &AppHandle) -> String {
    format!(
        "https://github.com/Anfifo/asapnotes/releases/download/v{}/asapnotes-transcribe-windows-x64.exe",
        app.package_info().version
    )
}

fn dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("transcribe"))
}

fn model_path(app: &AppHandle, model: &Model) -> Result<PathBuf, String> {
    Ok(dir(app)?.join("models").join(model.file))
}

/// The engine to run: the installed one, else a development build's beside
/// the app executable. The flag says which, because only the first can be
/// removed from Settings.
fn engine(app: &AppHandle) -> Option<(PathBuf, bool)> {
    let installed = dir(app).ok()?.join(ENGINE_FILE);
    if installed.exists() {
        return Some((installed, true));
    }
    let beside = std::env::current_exe().ok()?.parent()?.join(ENGINE_FILE);
    beside.exists().then_some((beside, false))
}

#[derive(Debug, Clone, Serialize)]
pub struct DownloadProgress {
    what: String,
    received: u64,
    total: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct JobProgress {
    note: String,
    line: u32,
    percent: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct TranscriptResult {
    note: String,
    line: u32,
    language: String,
    model: String,
    /// The transcript; None when the run failed, with `error` saying why.
    markdown: Option<String>,
    error: Option<String>,
}

struct Download {
    progress: DownloadProgress,
    cancel: Arc<AtomicBool>,
}

struct Job {
    progress: JobProgress,
    child: Option<Child>,
    cancelled: bool,
}

#[derive(Default)]
struct State {
    download: Option<Download>,
    job: Option<Job>,
    result: Option<TranscriptResult>,
}

fn state() -> &'static Mutex<State> {
    static STATE: OnceLock<Mutex<State>> = OnceLock::new();
    STATE.get_or_init(Mutex::default)
}

fn lock() -> Result<std::sync::MutexGuard<'static, State>, String> {
    state().lock().map_err(|e| e.to_string())
}

#[derive(Serialize)]
pub struct EngineInfo {
    path: String,
    installed: bool,
}

#[derive(Serialize)]
pub struct ModelStatus {
    id: &'static str,
    label: &'static str,
    detail: &'static str,
    bytes: u64,
    installed: bool,
}

#[derive(Serialize)]
pub struct TranscriptionStatus {
    engine: Option<EngineInfo>,
    engine_downloadable: bool,
    engine_bytes: Option<u64>,
    models: Vec<ModelStatus>,
    download: Option<DownloadProgress>,
    job: Option<JobProgress>,
}

#[tauri::command]
pub fn transcription_status(app: AppHandle) -> Result<TranscriptionStatus, String> {
    let models = MODELS
        .iter()
        .map(|m| {
            Ok(ModelStatus {
                id: m.id,
                label: m.label,
                detail: m.detail,
                bytes: m.bytes,
                installed: model_path(&app, m)?.exists(),
            })
        })
        .collect::<Result<_, String>>()?;
    let s = lock()?;
    Ok(TranscriptionStatus {
        engine: engine(&app).map(|(path, installed)| EngineInfo {
            path: path.to_string_lossy().into_owned(),
            installed,
        }),
        engine_downloadable: ENGINE_SHA256.is_some(),
        engine_bytes: ENGINE_BYTES.and_then(|b| b.parse().ok()),
        models,
        download: s.download.as_ref().map(|d| d.progress.clone()),
        job: s.job.as_ref().map(|j| j.progress.clone()),
    })
}

/// Fetch the engine (`what` = "engine") or a model (its id) into app data.
/// Returns once the download thread is running; progress comes as
/// `transcription-download` events and the end as `transcription-download-done`.
#[tauri::command]
pub fn download_transcription(app: AppHandle, what: String) -> Result<(), String> {
    let (url, target, bytes, sha256) = if what == "engine" {
        let sha =
            ENGINE_SHA256.ok_or("This build doesn't know which engine release goes with it")?;
        let bytes = ENGINE_BYTES.and_then(|b| b.parse().ok()).unwrap_or(0);
        (engine_url(&app), dir(&app)?.join(ENGINE_FILE), bytes, sha)
    } else {
        let m = MODELS
            .iter()
            .find(|m| m.id == what)
            .ok_or_else(|| format!("No model called {what}"))?;
        (
            format!("{MODEL_URL}{}", m.file),
            model_path(&app, m)?,
            m.bytes,
            m.sha256,
        )
    };
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut s = lock()?;
        if s.download.is_some() {
            return Err("A download is already running".to_string());
        }
        s.download = Some(Download {
            progress: DownloadProgress {
                what: what.clone(),
                received: 0,
                total: bytes,
            },
            cancel: cancel.clone(),
        });
    }
    std::thread::spawn(move || {
        let outcome = fetch(&app, &what, &url, &target, bytes, sha256, &cancel);
        if let Ok(mut s) = state().lock() {
            s.download = None;
        }
        let _ = app.emit(
            "transcription-download-done",
            serde_json::json!({ "what": what, "error": outcome.err() }),
        );
    });
    Ok(())
}

/// Stream `url` to `target`, hashing as it goes; the file only takes its
/// final name once the digest matches, so a half download or a wrong file
/// never sits where the engine or a model is expected.
fn fetch(
    app: &AppHandle,
    what: &str,
    url: &str,
    target: &std::path::Path,
    expected_bytes: u64,
    sha256: &str,
    cancel: &AtomicBool,
) -> Result<(), String> {
    let parent = target.parent().ok_or("download target has no folder")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let part = target.with_extension("part");
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_connect(Some(Duration::from_secs(30)))
        .build()
        .into();
    let response = agent
        .get(url)
        .call()
        .map_err(|e| format!("couldn't fetch {url}: {e}"))?;
    let total = response
        .headers()
        .get("content-length")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse().ok())
        .unwrap_or(expected_bytes);
    let mut reader = response.into_body().into_reader();
    let mut file = fs::File::create(&part).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 256 * 1024];
    let (mut received, mut reported) = (0u64, 0u64);
    let result = loop {
        if cancel.load(Ordering::Relaxed) {
            break Err("Download cancelled".to_string());
        }
        let n = match reader.read(&mut buf) {
            Ok(0) => break Ok(()),
            Ok(n) => n,
            Err(e) => break Err(format!("download interrupted: {e}")),
        };
        if let Err(e) = file.write_all(&buf[..n]) {
            break Err(e.to_string());
        }
        hasher.update(&buf[..n]);
        received += n as u64;
        // One event per megabyte keeps the progress bar moving without
        // flooding the window.
        if received - reported >= 1 << 20 {
            reported = received;
            let progress = DownloadProgress {
                what: what.to_string(),
                received,
                total,
            };
            if let Ok(mut s) = state().lock() {
                if let Some(d) = s.download.as_mut() {
                    d.progress = progress.clone();
                }
            }
            let _ = app.emit("transcription-download", progress);
        }
    };
    drop(file);
    if let Err(e) = result {
        let _ = fs::remove_file(&part);
        return Err(e);
    }
    let digest = format!("{:x}", hasher.finalize());
    if digest != sha256 {
        let _ = fs::remove_file(&part);
        return Err(
            "The download didn't match its expected digest, so nothing was installed".to_string(),
        );
    }
    if target.exists() {
        fs::remove_file(target).map_err(|e| e.to_string())?;
    }
    fs::rename(&part, target).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn cancel_transcription_download() -> Result<(), String> {
    if let Some(d) = lock()?.download.as_ref() {
        d.cancel.store(true, Ordering::Relaxed);
    }
    Ok(())
}

/// Delete the installed engine ("engine") or a model (its id). Notes and
/// recordings are untouched; a development build's engine beside the
/// executable is not this command's to remove.
#[tauri::command]
pub fn remove_transcription(app: AppHandle, what: String) -> Result<(), String> {
    if lock()?.job.is_some() {
        return Err("A transcription is running; cancel it first".to_string());
    }
    let path = if what == "engine" {
        dir(&app)?.join(ENGINE_FILE)
    } else {
        let m = MODELS
            .iter()
            .find(|m| m.id == what)
            .ok_or_else(|| format!("No model called {what}"))?;
        model_path(&app, m)?
    };
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// One line of the engine's output.
#[derive(Deserialize)]
struct Event {
    event: String,
    track: Option<String>,
    percent: Option<u32>,
    start_ms: Option<u64>,
    end_ms: Option<u64>,
    text: Option<String>,
    message: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Segment {
    pub track: String,
    pub start_ms: u64,
    pub end_ms: u64,
    pub text: String,
}

/// Transcribe the recording a note links on `line`. Returns once the engine
/// is running; progress comes as `transcription-progress` events, and
/// `transcription-finished` says the result is ready to take.
#[tauri::command]
pub fn transcribe_meeting(
    app: AppHandle,
    note: String,
    line: u32,
    language: String,
    model: String,
) -> Result<(), String> {
    let (engine, _) = engine(&app).ok_or("The transcription engine isn't installed")?;
    let m = MODELS
        .iter()
        .find(|m| m.id == model)
        .ok_or_else(|| format!("No model called {model}"))?;
    let model_file = model_path(&app, m)?;
    if !model_file.exists() {
        return Err(format!("The {} model isn't downloaded", m.label));
    }
    if language.trim().is_empty() {
        return Err("Pick the language spoken in the meeting".to_string());
    }
    let tracks = crate::meeting::tracks_on_line(&app, &note, line)?;

    let mut s = lock()?;
    if s.job.is_some() {
        return Err("A transcription is already running".to_string());
    }
    let mut cmd = Command::new(&engine);
    cmd.arg("--model")
        .arg(&model_file)
        .arg("--language")
        .arg(language.trim())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    for (label, file) in &tracks {
        cmd.arg(format!("{label}={}", file.display()));
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // No console window, and below-normal priority: the transcription
        // takes minutes and the app must stay as quick to summon as ever.
        cmd.creation_flags(0x0800_0000 | 0x0000_4000);
    }
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("couldn't start the transcription engine: {e}"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or("engine started without an output pipe")?;
    s.job = Some(Job {
        progress: JobProgress {
            note: note.clone(),
            line,
            percent: 0,
        },
        child: Some(child),
        cancelled: false,
    });
    drop(s);

    let labels: Vec<String> = tracks.iter().map(|(l, _)| l.clone()).collect();
    let model_label = m.label;
    std::thread::spawn(move || {
        let outcome = follow(&app, stdout, &labels);
        let (child, cancelled) = match state().lock() {
            Ok(mut s) => match s.job.take() {
                Some(j) => (j.child, j.cancelled),
                None => (None, true),
            },
            Err(_) => (None, true),
        };
        if let Some(mut c) = child {
            let _ = c.wait();
        }
        if !cancelled {
            let result = match outcome {
                Ok(segments) => TranscriptResult {
                    markdown: Some(render_transcript(
                        &note,
                        &language,
                        model_label,
                        &labels,
                        segments,
                    )),
                    error: None,
                    note: note.clone(),
                    line,
                    language: language.clone(),
                    model: model.clone(),
                },
                Err(e) => TranscriptResult {
                    markdown: None,
                    error: Some(e),
                    note: note.clone(),
                    line,
                    language: language.clone(),
                    model: model.clone(),
                },
            };
            if let Ok(mut s) = state().lock() {
                s.result = Some(result);
            }
        }
        let _ = app.emit("transcription-finished", ());
    });
    Ok(())
}

/// Read the engine's events until it is done. Per-track percentages fold into
/// one figure for the whole run, since the window shows one chip.
fn follow(
    app: &AppHandle,
    stdout: std::process::ChildStdout,
    labels: &[String],
) -> Result<Vec<Segment>, String> {
    let mut segments = Vec::new();
    let mut finished = false;
    let mut last_percent = 0;
    for line in BufReader::new(stdout).lines() {
        let line = line.map_err(|e| e.to_string())?;
        let Ok(ev) = serde_json::from_str::<Event>(&line) else {
            continue;
        };
        match ev.event.as_str() {
            "progress" => {
                let index = ev
                    .track
                    .as_deref()
                    .and_then(|t| labels.iter().position(|l| l == t))
                    .unwrap_or(0) as u32;
                let percent =
                    (index * 100 + ev.percent.unwrap_or(0).min(100)) / labels.len().max(1) as u32;
                if percent != last_percent {
                    last_percent = percent;
                    if let Ok(mut s) = state().lock() {
                        if let Some(j) = s.job.as_mut() {
                            j.progress.percent = percent;
                            let _ = app.emit("transcription-progress", j.progress.clone());
                        }
                    }
                }
            }
            "segment" => segments.push(Segment {
                track: ev.track.unwrap_or_default(),
                start_ms: ev.start_ms.unwrap_or(0),
                end_ms: ev.end_ms.unwrap_or(0),
                text: ev.text.unwrap_or_default(),
            }),
            "done" => finished = true,
            "error" => {
                return Err(ev
                    .message
                    .unwrap_or_else(|| "the engine failed".to_string()))
            }
            _ => {}
        }
    }
    if !finished {
        return Err("The transcription engine stopped before it finished".to_string());
    }
    Ok(segments)
}

#[tauri::command]
pub fn cancel_transcription() -> Result<(), String> {
    if let Some(j) = lock()?.job.as_mut() {
        j.cancelled = true;
        if let Some(c) = j.child.as_mut() {
            let _ = c.kill();
        }
    }
    Ok(())
}

/// The finished transcription nobody has collected yet.
#[tauri::command]
pub fn take_transcript_result() -> Result<Option<TranscriptResult>, String> {
    Ok(lock()?.result.take())
}

/// Segments closer than this, from the same track, read as one paragraph.
const PARAGRAPH_GAP_MS: u64 = 2_500;
/// A paragraph stops growing past this, so its stamp stays near its words.
const PARAGRAPH_MAX_MS: u64 = 60_000;

fn stamp(ms: u64) -> String {
    let s = ms / 1000;
    format!("[{:02}:{:02}:{:02}]", s / 3600, (s / 60) % 60, s % 60)
}

/// Who a track's words belong to. The microphone is the person at the
/// keyboard; the system audio is everyone else on the call.
fn speaker(track: &str) -> &str {
    match track {
        "microphone" => "Me",
        "system audio" => "Them",
        other => other,
    }
}

/// The transcript as markdown: a heading, one line saying where it came
/// from, then paragraphs stamped with when they start. Tracks interleave by
/// time; with one track there is nobody to tell apart, so no speaker labels.
pub(crate) fn render_transcript(
    note: &str,
    language: &str,
    model_label: &str,
    tracks: &[String],
    mut segments: Vec<Segment>,
) -> String {
    segments.sort_by_key(|s| s.start_ms);
    let file = note.rsplit('/').next().unwrap_or(note);
    let stem = file.strip_suffix(".md").unwrap_or(file);
    let labelled = tracks.len() > 1;
    let mut out = format!(
        "# Transcript of {stem}\n\nFrom the meeting recording in [{stem}]({file}). Model: {model_label}. Language: {language}."
    );
    if labelled {
        out.push_str(" **Me** is the microphone; **Them** is the system audio.");
    }
    out.push('\n');
    let mut para: Option<Segment> = None;
    let flush = |out: &mut String, p: &Segment| {
        out.push('\n');
        out.push_str(&stamp(p.start_ms));
        if labelled {
            out.push_str(&format!(" **{}:**", speaker(&p.track)));
        }
        out.push(' ');
        out.push_str(&p.text);
        out.push('\n');
    };
    for s in segments {
        match para.as_mut() {
            Some(p)
                if p.track == s.track
                    && s.start_ms.saturating_sub(p.end_ms) <= PARAGRAPH_GAP_MS
                    && s.end_ms.saturating_sub(p.start_ms) <= PARAGRAPH_MAX_MS =>
            {
                p.text.push(' ');
                p.text.push_str(&s.text);
                p.end_ms = p.end_ms.max(s.end_ms);
            }
            _ => {
                if let Some(p) = para.replace(s) {
                    flush(&mut out, &p);
                }
            }
        }
    }
    if let Some(p) = para {
        flush(&mut out, &p);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seg(track: &str, start: u64, end: u64, text: &str) -> Segment {
        Segment {
            track: track.to_string(),
            start_ms: start,
            end_ms: end,
            text: text.to_string(),
        }
    }

    #[test]
    fn two_tracks_interleave_by_time_with_speakers() {
        let tracks = vec!["microphone".to_string(), "system audio".to_string()];
        let segments = vec![
            seg("microphone", 0, 3_000, "Hello everyone."),
            seg("microphone", 3_200, 4_000, "Let's start."),
            seg(
                "microphone",
                8_000,
                12_000,
                "Yesterday I finished the slice.",
            ),
            seg("system audio", 4_200, 7_500, "Great, thanks."),
            seg("system audio", 3_605_000, 3_606_000, "Bye."),
        ];
        let md = render_transcript("work/standup.md", "en", "Small", &tracks, segments);
        assert!(md.starts_with("# Transcript of standup\n\nFrom the meeting recording in [standup](standup.md). Model: Small. Language: en. **Me** is the microphone; **Them** is the system audio.\n"));
        let body: Vec<&str> = md.lines().skip(3).filter(|l| !l.is_empty()).collect();
        assert_eq!(
            body,
            vec![
                "[00:00:00] **Me:** Hello everyone. Let's start.",
                "[00:00:04] **Them:** Great, thanks.",
                "[00:00:08] **Me:** Yesterday I finished the slice.",
                "[01:00:05] **Them:** Bye.",
            ]
        );
    }

    #[test]
    fn one_track_has_no_speakers_and_long_runs_split() {
        let tracks = vec!["microphone".to_string()];
        let mut segments = Vec::new();
        for i in 0..8u64 {
            segments.push(seg("microphone", i * 10_000, i * 10_000 + 9_000, "words"));
        }
        let md = render_transcript("solo.md", "pt", "Base", &tracks, segments);
        assert!(!md.contains("**Me**"));
        let body: Vec<&str> = md.lines().skip(3).filter(|l| !l.is_empty()).collect();
        // Six segments fit in a minute; the seventh would stretch the paragraph past it.
        assert_eq!(
            body,
            vec![
                "[00:00:00] words words words words words words",
                "[00:01:00] words words",
            ]
        );
    }

    #[test]
    fn stamps_count_hours() {
        assert_eq!(stamp(0), "[00:00:00]");
        assert_eq!(stamp(59_999), "[00:00:59]");
        assert_eq!(stamp(3_723_000), "[01:02:03]");
    }
}
