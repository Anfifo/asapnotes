//! `asapnotes-transcribe` — the transcription engine, an add-on binary.
//!
//! One run transcribes the tracks of a meeting recording with whisper.cpp and
//! streams what it finds as JSON lines on stdout: progress per track, one
//! event per segment, then `done`. The app merges the tracks into a transcript
//! itself, so this binary knows nothing about notes or markdown.
//!
//! ```text
//! asapnotes-transcribe --model ggml-small.bin --language pt [--threads 8] [--gpu] \
//!     microphone=standup-mic.opus "system audio=standup-system.opus"
//! {"event":"progress","track":"microphone","percent":40}
//! {"event":"segment","track":"microphone","start_ms":1200,"end_ms":3400,"text":"…"}
//! {"event":"done"}
//! ```
//!
//! It is a separate process because whisper.cpp is native code driving a GPU
//! when one is used: a crash in it must not take the resident tray app down,
//! and a transcription in flight must be killable from the app at any moment.
//! It is a separate download because most installs never transcribe, and the
//! CPU and GPU builds of the engine differ.

use asapnotes_lib::meeting::decode_for_whisper;
use serde_json::{json, Value};
use std::io::Write;
use std::path::Path;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

struct Args {
    model: String,
    language: String,
    threads: i32,
    gpu: bool,
    /// (label, path) per track, in the order given.
    tracks: Vec<(String, String)>,
}

const USAGE: &str =
    "asapnotes-transcribe --model FILE --language CODE [--threads N] [--gpu] LABEL=FILE.opus...";

fn parse_args() -> Result<Args, String> {
    let mut args = Args {
        model: String::new(),
        language: String::new(),
        threads: std::thread::available_parallelism()
            .map(|n| n.get().min(8) as i32)
            .unwrap_or(4),
        gpu: false,
        tracks: Vec::new(),
    };
    let mut it = std::env::args().skip(1);
    while let Some(a) = it.next() {
        match a.as_str() {
            "--model" => args.model = it.next().ok_or("--model needs a file")?,
            "--language" => args.language = it.next().ok_or("--language needs a code")?,
            "--threads" => {
                args.threads = it
                    .next()
                    .and_then(|n| n.parse().ok())
                    .filter(|n: &i32| *n > 0)
                    .ok_or("--threads needs a positive number")?
            }
            "--gpu" => args.gpu = true,
            other => {
                let (label, path) = other
                    .split_once('=')
                    .ok_or_else(|| format!("expected LABEL=FILE, got {other}"))?;
                args.tracks.push((label.to_string(), path.to_string()));
            }
        }
    }
    if args.model.is_empty() || args.language.is_empty() || args.tracks.is_empty() {
        return Err(USAGE.to_string());
    }
    Ok(args)
}

/// One line per event, flushed at once: the app reads them as they happen.
fn emit(event: Value) {
    let mut out = std::io::stdout().lock();
    let _ = writeln!(out, "{event}");
    let _ = out.flush();
}

fn main() {
    let args = match parse_args() {
        Ok(a) => a,
        Err(e) => {
            emit(json!({ "event": "error", "message": e }));
            std::process::exit(2);
        }
    };
    if let Err(e) = run(&args) {
        emit(json!({ "event": "error", "message": e }));
        std::process::exit(1);
    }
    emit(json!({ "event": "done" }));
}

fn run(args: &Args) -> Result<(), String> {
    // whisper.cpp and ggml report on stderr by default; the hook routes them
    // to the `log` crate, which nothing here listens to.
    whisper_rs::install_logging_hooks();
    let mut ctx_params = WhisperContextParameters::default();
    ctx_params.use_gpu(args.gpu);
    let ctx = WhisperContext::new_with_params(&args.model, ctx_params)
        .map_err(|e| format!("couldn't load the model {}: {e}", args.model))?;

    for (label, path) in &args.tracks {
        let pcm = decode_for_whisper(Path::new(path))?;
        // A track that is silence throughout (a loopback side with nothing
        // played) has nothing to say, and the model would invent words for it.
        if pcm.iter().all(|s| s.abs() < 1e-4) {
            emit(json!({ "event": "progress", "track": label, "percent": 100 }));
            continue;
        }
        let mut state = ctx.create_state().map_err(|e| e.to_string())?;
        let mut params = FullParams::new(SamplingStrategy::BeamSearch {
            beam_size: 5,
            patience: -1.0,
        });
        params.set_language(Some(&args.language));
        params.set_n_threads(args.threads);
        params.set_print_special(false);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);
        params.set_suppress_blank(true);
        let track = label.clone();
        params.set_progress_callback_safe(move |percent: i32| {
            emit(json!({ "event": "progress", "track": track, "percent": percent }));
        });
        state
            .full(params, &pcm)
            .map_err(|e| format!("transcribing {label} failed: {e}"))?;
        let peak = pcm.iter().fold(0f32, |m, s| m.max(s.abs()));
        for segment in state.as_iter() {
            let text = segment.to_str_lossy().map_err(|e| e.to_string())?;
            let text = text.trim();
            if text.is_empty() {
                continue;
            }
            // whisper.cpp timestamps count centiseconds.
            let (start_ms, end_ms) = trim_to_speech(
                &pcm,
                peak,
                segment.start_timestamp().max(0) as u64 * 10,
                segment.end_timestamp().max(0) as u64 * 10,
            );
            emit(json!({
                "event": "segment",
                "track": label,
                "start_ms": start_ms,
                "end_ms": end_ms,
                "text": text,
            }));
        }
    }
    Ok(())
}

/// Samples per millisecond at the 16 kHz the model reads.
const PER_MS: usize = 16;

/// A segment's stamps pulled in to where its audio is audible. The model
/// stretches a segment over the silence around it, so a sentence spoken four
/// seconds in is otherwise stamped at zero, and that stamp is what orders
/// this track's words against the other track's.
fn trim_to_speech(pcm: &[f32], peak: f32, start_ms: u64, end_ms: u64) -> (u64, u64) {
    let floor = peak * 0.1;
    let from = (start_ms as usize * PER_MS).min(pcm.len());
    let to = (end_ms as usize * PER_MS).min(pcm.len());
    let audible = |w: &[f32]| w.iter().any(|s| s.abs() > floor);
    let windows = pcm[from..to].chunks(10 * PER_MS);
    let first = windows.clone().position(audible);
    let last = windows.clone().rposition(audible);
    match (first, last) {
        (Some(a), Some(b)) => (
            start_ms + a as u64 * 10,
            (start_ms + b as u64 * 10 + 10).min(end_ms),
        ),
        _ => (start_ms, end_ms),
    }
}
