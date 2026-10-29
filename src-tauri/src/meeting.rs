//! Meeting recording: the microphone and the system playback captured as two
//! mono Opus files in the meeting note's `assets/`.
//!
//! Two tracks, never mixed, because the split is what later attributes a
//! transcript line to the person at the keyboard or to everyone else — the
//! channel a voice arrived on is free speaker attribution.
//!
//! Nothing here runs until a recording starts: no device is opened, no encoder
//! exists, and the module holds no memory beyond one small mutex. Stopping
//! tears it all down again. That keeps the resident footprint flat.

use std::fs;
use std::io::BufWriter;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use audiopus::coder::{Decoder, Encoder};
use audiopus::{Application, Bitrate, Channels, SampleRate};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use ogg::reading::{OggReadError, PacketReader};
use ogg::writing::{PacketWriteEndInfo, PacketWriter};
use serde::Serialize;
use tauri::AppHandle;

/// Opus frames are cut at 48 kHz regardless of what the device delivers, so
/// every track is resampled to this before encoding.
const OPUS_RATE: u32 = 48_000;
/// One packet per 20 ms — Opus's own sweet spot for speech.
const FRAME: usize = 960;
/// Voice on a meeting track is transparent well below this; it keeps an hour
/// of audio around 15 MB per track.
const BITRATE: i32 = 32_000;

/// One side being recorded: its thread and where its file will be linked from.
struct Track {
    side: Side,
    handle: std::thread::JoinHandle<Result<(), String>>,
    rel: String,
}

struct Session {
    stop: Arc<AtomicBool>,
    started: Instant,
    tracks: Vec<Track>,
    note: String,
}

/// The one recording this process will run at a time. A second start while
/// this is `Some` is refused — two meetings at once is a mistake, not a need.
fn session() -> &'static Mutex<Option<Session>> {
    static S: OnceLock<Mutex<Option<Session>>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(None))
}

/// Which end of the call a track captures.
#[derive(Clone, Copy, PartialEq)]
enum Side {
    Mic,
    System,
}

impl Side {
    /// File-name suffix, so a recording's files read as a pair in a listing.
    fn suffix(self) -> &'static str {
        match self {
            Side::Mic => "mic",
            Side::System => "sys",
        }
    }

    fn label(self) -> &'static str {
        match self {
            Side::Mic => "microphone",
            Side::System => "system audio",
        }
    }
}

/// What a finished recording left behind: the asset paths of the sides that
/// were recorded, relative to the note's base the way every asset path is,
/// and how long it ran.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingFiles {
    pub mic: Option<String>,
    pub system: Option<String>,
    pub seconds: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeetingState {
    pub active: bool,
    pub seconds: u64,
    /// The note being recorded into — how a reloaded window finds its way
    /// back to the recording it no longer remembers starting.
    pub note: Option<String>,
}

/// Start recording the chosen sides into the note's `assets/`. Fails — with
/// the reason — if a recording is already running, no side was chosen, or any
/// chosen capture can't open, so a microphone the OS has blocked is a visible
/// error at the moment of starting, not a silent empty file discovered after
/// the meeting.
#[tauri::command]
pub fn start_meeting_recording(
    app: AppHandle,
    note: String,
    mic: bool,
    system: bool,
) -> Result<(), String> {
    let sides: Vec<Side> = [(mic, Side::Mic), (system, Side::System)]
        .into_iter()
        .filter(|(on, _)| *on)
        .map(|(_, s)| s)
        .collect();
    if sides.is_empty() {
        return Err("pick at least one source to record".into());
    }
    let mut slot = session().lock().map_err(|e| e.to_string())?;
    if slot.is_some() {
        return Err("a recording is already running".into());
    }
    let dir = crate::notes::assets_dir_for(&app, Some(&note))?;
    let stem = Path::new(&note)
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or("that note has no name to derive file names from")?
        .to_string();
    let stop = Arc::new(AtomicBool::new(false));
    let started = Instant::now();
    let (ready_tx, ready_rx) = std::sync::mpsc::channel();
    let mut tracks = Vec::new();
    let mut paths = Vec::new();
    for side in sides {
        let (path, rel) =
            crate::notes::unique_asset(&dir, &format!("{stem}-{}", side.suffix()), "opus");
        let job = TrackJob {
            side,
            path: path.clone(),
            stop: stop.clone(),
            started,
        };
        let ready = ready_tx.clone();
        let handle = std::thread::spawn(move || run_track(job, &ready));
        tracks.push(Track { side, handle, rel });
        paths.push(path);
    }
    drop(ready_tx);
    // Every chosen capture must come up before this counts as recording.
    for _ in 0..tracks.len() {
        let up = ready_rx
            .recv_timeout(Duration::from_secs(5))
            .map_err(|_| "a capture didn't start in time".to_string())
            .and_then(|r| r);
        if let Err(e) = up {
            stop.store(true, Ordering::Relaxed);
            for t in tracks {
                let _ = t.handle.join();
            }
            for p in paths {
                let _ = fs::remove_file(p);
            }
            return Err(e);
        }
    }
    *slot = Some(Session {
        stop,
        started,
        tracks,
        note,
    });
    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_tooltip(Some("asapnotes — recording a meeting"));
    }
    Ok(())
}

/// Stop the recording and hand back what it wrote. Encoding errors from any
/// track surface here — stopping is the first moment there is a caller to
/// tell.
#[tauri::command]
pub fn stop_meeting_recording(app: AppHandle) -> Result<MeetingFiles, String> {
    let taken = session().lock().map_err(|e| e.to_string())?.take();
    let Some(s) = taken else {
        return Err("no recording is running".into());
    };
    s.stop.store(true, Ordering::Relaxed);
    let mut files = MeetingFiles {
        mic: None,
        system: None,
        seconds: 0,
    };
    let mut failed = Ok(());
    for t in s.tracks {
        let label = t.side.label();
        let outcome = t
            .handle
            .join()
            .map_err(|_| format!("the {label} capture crashed"))
            .and_then(|r| r.map_err(|e| format!("the {label} capture failed: {e}")));
        match outcome {
            Ok(()) => match t.side {
                Side::Mic => files.mic = Some(t.rel),
                Side::System => files.system = Some(t.rel),
            },
            Err(e) => failed = failed.and(Err(e)),
        }
    }
    if let Some(tray) = app.tray_by_id("main") {
        // Back to the resting tooltip: the app name and its summon chord.
        let chord = crate::settings::settings(&app)
            .ok()
            .and_then(|s| s.summon_hotkey.clone())
            .unwrap_or_else(|| crate::desktop::DEFAULT_SUMMON.to_string());
        let _ = tray.set_tooltip(Some(format!("asapnotes ({chord})")));
    }
    failed?;
    files.seconds = s.started.elapsed().as_secs();
    Ok(files)
}

pub fn recording_active() -> bool {
    session().lock().is_ok_and(|s| s.is_some())
}

/// Close a recording the process is exiting under, so each file ends with its
/// end-of-stream page. The note gets no link line: writing it is the
/// interface's part of a normal stop, which a quit runs first when it can.
pub fn finish_for_exit() {
    let taken = session().lock().ok().and_then(|mut s| s.take());
    if let Some(s) = taken {
        s.stop.store(true, Ordering::Relaxed);
        for t in s.tracks {
            let _ = t.handle.join();
        }
    }
}

/// Whether a recording is running, and for how long — what a freshly loaded
/// window asks to redraw the recording chip after a reload.
#[tauri::command]
pub fn meeting_recording_state() -> Result<MeetingState, String> {
    let slot = session().lock().map_err(|e| e.to_string())?;
    Ok(match slot.as_ref() {
        Some(s) => MeetingState {
            active: true,
            seconds: s.started.elapsed().as_secs(),
            note: Some(s.note.clone()),
        },
        None => MeetingState {
            active: false,
            seconds: 0,
            note: None,
        },
    })
}

/// One recorded side as a meeting note links to it.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct RecordingTrack {
    /// The link's label: "microphone" or "system audio".
    pub label: String,
    /// Absolute path of the Opus file, resolved from the note's folder.
    pub path: String,
    pub exists: bool,
    pub modified_ms: u64,
}

/// One meeting: the line in a note that links its tracks.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct MeetingRecording {
    pub note: String,
    /// 1-based line number, for the jump-to on click.
    pub line: u32,
    /// From the "(m:ss)" the stop line writes; None when hand-edited away.
    pub seconds: Option<u64>,
    pub tracks: Vec<RecordingTrack>,
    /// The transcript note beside the meeting note, when one exists.
    pub transcript: Option<String>,
}

/// Where a transcript of the note's recording lives, when it exists: a note
/// named after the meeting note, beside it. Found by name so that a hand edit
/// to the stop line never orphans it.
pub(crate) fn transcript_note(note: &str, path: &Path) -> Option<String> {
    let stem = path.file_stem()?.to_string_lossy();
    let file = path.with_file_name(format!("{stem}.transcript.md"));
    file.exists()
        .then(|| format!("{}.transcript.md", note.strip_suffix(".md").unwrap_or(note)))
}

/// Every meeting recording the notes link to, newest file first. The notes
/// are the index: a recording is what its meeting note says it is, and one
/// whose link was deleted is no longer a meeting of that note. Files share a
/// root `assets/` and carry no project in their names, so scanning folders
/// could not attribute them.
#[tauri::command]
pub fn list_meeting_recordings(app: AppHandle) -> Result<Vec<MeetingRecording>, String> {
    let mut out = Vec::new();
    for (note, path) in crate::notes::note_paths(&app)? {
        let Ok(content) = fs::read_to_string(&path) else {
            continue;
        };
        let dir = path.parent().unwrap_or(Path::new(""));
        for (i, line) in content.lines().enumerate() {
            let targets = opus_links(line);
            if targets.is_empty() {
                continue;
            }
            let tracks = targets
                .into_iter()
                .map(|(label, target)| {
                    let file = lexical_join(dir, &target);
                    let meta = fs::metadata(&file).ok();
                    RecordingTrack {
                        label,
                        path: file.to_string_lossy().into_owned(),
                        exists: meta.is_some(),
                        modified_ms: meta
                            .and_then(|m| m.modified().ok())
                            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                            .map(|d| d.as_millis() as u64)
                            .unwrap_or(0),
                    }
                })
                .collect();
            out.push(MeetingRecording {
                note: note.clone(),
                line: i as u32 + 1,
                seconds: elapsed_before_link(line),
                tracks,
                transcript: transcript_note(&note, &path),
            });
        }
    }
    out.sort_by_key(|r| std::cmp::Reverse(r.tracks.iter().map(|t| t.modified_ms).max()));
    Ok(out)
}

/// The tracks a note's stop line links, resolved to the files still on disk:
/// what the transcriber is handed.
pub(crate) fn tracks_on_line(
    app: &AppHandle,
    note: &str,
    line: u32,
) -> Result<Vec<(String, PathBuf)>, String> {
    let path = crate::notes::note_paths(app)?
        .into_iter()
        .find(|(id, _)| id == note)
        .map(|(_, p)| p)
        .ok_or_else(|| format!("\"{note}\" isn't a note this app lists"))?;
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let text = content
        .lines()
        .nth(line.saturating_sub(1) as usize)
        .ok_or("The note no longer has that line")?;
    let dir = path.parent().unwrap_or(Path::new(""));
    let tracks: Vec<(String, PathBuf)> = opus_links(text)
        .into_iter()
        .map(|(label, target)| (label, lexical_join(dir, &target)))
        .filter(|(_, file)| file.exists())
        .collect();
    if tracks.is_empty() {
        return Err("That line links no recording that is still on disk".to_string());
    }
    Ok(tracks)
}

/// `dir/target` with the target's `..` and `.` segments folded, so the path
/// shown and copied is the one a file manager would show.
fn lexical_join(dir: &Path, target: &str) -> PathBuf {
    let mut out = dir.to_path_buf();
    for seg in target.split('/') {
        match seg {
            "" | "." => {}
            ".." => {
                out.pop();
            }
            s => out.push(s),
        }
    }
    out
}

/// The `[label](target)` links on a line whose target is an `.opus` file.
/// A target with spaces is wrapped in angle brackets, as the stop line writes
/// it; anything else is left to the markdown parser's stricter reading.
fn opus_links(line: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let mut rest = line;
    while let Some(close) = rest.find("](") {
        let label = rest[..close].rsplit('[').next().unwrap_or("").to_string();
        let after = &rest[close + 2..];
        let (target, used) = if let Some(inner) = after.strip_prefix('<') {
            match inner.find(">)") {
                Some(end) => (&inner[..end], end + 3),
                None => break,
            }
        } else {
            match after.find(')') {
                Some(end) => (&after[..end], end + 1),
                None => break,
            }
        };
        if target.to_ascii_lowercase().ends_with(".opus") {
            out.push((label, target.to_string()));
        }
        rest = &after[used..];
    }
    out
}

/// The "(h:mm:ss)" or "(m:ss)" the stop line puts before its links.
fn elapsed_before_link(line: &str) -> Option<u64> {
    let head = &line[..line.find("](")?];
    let open = head.rfind('(')?;
    let close = head[open..].find(')')? + open;
    let parts: Vec<u64> = head[open + 1..close]
        .split(':')
        .map(|p| p.parse().ok())
        .collect::<Option<_>>()?;
    match parts[..] {
        [m, s] => Some(m * 60 + s),
        [h, m, s] => Some(h * 3600 + m * 60 + s),
        _ => None,
    }
}

/// Everything one capture thread needs to run to completion.
struct TrackJob {
    side: Side,
    path: PathBuf,
    stop: Arc<AtomicBool>,
    started: Instant,
}

/// Open the device for a side. The system side is a loopback capture: an
/// input stream built on the default *output* device, which is how the
/// platform exposes "what the machine is playing".
fn open_device(side: Side) -> Result<(cpal::Device, cpal::SupportedStreamConfig), String> {
    let host = cpal::default_host();
    match side {
        Side::Mic => {
            let d = host
                .default_input_device()
                .ok_or("no microphone found — is one connected and allowed?")?;
            let c = d.default_input_config().map_err(|e| e.to_string())?;
            Ok((d, c))
        }
        Side::System => {
            let d = host
                .default_output_device()
                .ok_or("no playback device found to capture system audio from")?;
            let c = d.default_output_config().map_err(|e| e.to_string())?;
            Ok((d, c))
        }
    }
}

/// Run one track: capture callbacks push interleaved f32 into a channel; this
/// thread drains it, downmixes to mono, resamples to 48 kHz, encodes 20 ms
/// Opus frames and writes them into an Ogg stream on disk.
///
/// The loopback side goes quiet whenever nothing is playing — the platform
/// simply stops delivering buffers — so the drain loop pads with silence
/// whenever a track falls behind the wall clock. That keeps both tracks the
/// same length and lined up with each other within a fraction of a second,
/// which is what lets a transcript interleave them by timestamp.
fn run_track(job: TrackJob, ready: &Sender<Result<(), String>>) -> Result<(), String> {
    type Prepped = (cpal::Stream, Receiver<Vec<f32>>, OggOpus, MonoAt48k);
    let prep = (|| -> Result<Prepped, String> {
        let (device, config) = open_device(job.side)?;
        let channels = config.channels() as usize;
        let src_rate = config.sample_rate().0;
        let (tx, rx): (Sender<Vec<f32>>, Receiver<Vec<f32>>) = std::sync::mpsc::channel();
        let err = |e: cpal::StreamError| eprintln!("meeting capture stream error: {e}");
        let stream = match config.sample_format() {
            cpal::SampleFormat::F32 => device.build_input_stream(
                &config.into(),
                move |data: &[f32], _| {
                    let _ = tx.send(data.to_vec());
                },
                err,
                None,
            ),
            cpal::SampleFormat::I16 => device.build_input_stream(
                &config.into(),
                move |data: &[i16], _| {
                    let _ = tx.send(data.iter().map(|s| f32::from(*s) / 32768.0).collect());
                },
                err,
                None,
            ),
            cpal::SampleFormat::U16 => device.build_input_stream(
                &config.into(),
                move |data: &[u16], _| {
                    let _ = tx.send(
                        data.iter()
                            .map(|s| (f32::from(*s) - 32768.0) / 32768.0)
                            .collect(),
                    );
                },
                err,
                None,
            ),
            other => return Err(format!("unsupported sample format: {other:?}")),
        }
        .map_err(|e| e.to_string())?;
        stream.play().map_err(|e| e.to_string())?;
        let file = fs::File::create(&job.path).map_err(|e| e.to_string())?;
        let sink = OggOpus::create(BufWriter::new(file))?;
        Ok((stream, rx, sink, MonoAt48k::new(channels, src_rate)))
    })();
    let (stream, rx, mut sink, mut mono) = match prep {
        Ok(v) => {
            let _ = ready.send(Ok(()));
            v
        }
        Err(e) => {
            let _ = ready.send(Err(e.clone()));
            return Err(e);
        }
    };
    let mut pcm: Vec<f32> = Vec::new();
    let mut written: u64 = 0; // 48 kHz samples encoded so far

    loop {
        let stopped = job.stop.load(Ordering::Relaxed);
        match rx.recv_timeout(Duration::from_millis(100)) {
            Ok(chunk) => mono.push(&chunk, &mut pcm),
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => break,
        }
        // Pad up to the wall clock when the device goes quiet, staying one
        // frame short so real samples that are merely late still land in
        // order rather than after inserted silence.
        let expected = (job.started.elapsed().as_secs_f64() * f64::from(OPUS_RATE)) as u64;
        let have = written + pcm.len() as u64;
        if expected > have + (FRAME as u64 * 2) {
            pcm.resize(pcm.len() + (expected - have - FRAME as u64) as usize, 0.0);
        }
        while pcm.len() >= FRAME {
            let frame: Vec<f32> = pcm.drain(..FRAME).collect();
            sink.encode(&frame, false)?;
            written += FRAME as u64;
        }
        if stopped {
            break;
        }
    }
    drop(stream);
    // Flush whatever remains as one last zero-padded frame.
    pcm.resize(FRAME, 0.0);
    sink.encode(&pcm, true)?;
    sink.finish()
}

/// Interleaved anything-in, mono 48 kHz out. Downmix averages the channels;
/// the resample is linear, which is fine for speech and keeps this crate-free.
struct MonoAt48k {
    channels: usize,
    src_rate: u32,
    // Fractional read position carried between chunks, in source samples.
    pos: f64,
    prev: f32,
    buf: Vec<f32>,
}

impl MonoAt48k {
    fn new(channels: usize, src_rate: u32) -> Self {
        Self {
            channels,
            src_rate,
            pos: 0.0,
            prev: 0.0,
            buf: Vec::new(),
        }
    }

    fn push(&mut self, interleaved: &[f32], out: &mut Vec<f32>) {
        for frame in interleaved.chunks_exact(self.channels) {
            self.buf
                .push(frame.iter().sum::<f32>() / self.channels as f32);
        }
        if self.src_rate == OPUS_RATE {
            out.append(&mut self.buf);
            return;
        }
        let step = f64::from(self.src_rate) / f64::from(OPUS_RATE);
        while self.pos < self.buf.len() as f64 {
            let i = self.pos as usize;
            let frac = (self.pos - i as f64) as f32;
            let a = if i == 0 { self.prev } else { self.buf[i - 1] };
            let b = self.buf[i.min(self.buf.len() - 1)];
            out.push(a + (b - a) * frac);
            self.pos += step;
        }
        if let Some(last) = self.buf.last() {
            self.prev = *last;
        }
        self.pos -= self.buf.len() as f64;
        self.buf.clear();
    }
}

/// An Opus encoder writing into an Ogg container: the two header packets up
/// front, then one packet per frame, a page boundary about once a second so
/// players can seek.
struct OggOpus {
    encoder: Encoder,
    writer: PacketWriter<'static, BufWriter<fs::File>>,
    serial: u32,
    granule: u64,
    packets: u32,
    out: Vec<u8>,
}

impl OggOpus {
    fn create(file: BufWriter<fs::File>) -> Result<Self, String> {
        let mut encoder = Encoder::new(SampleRate::Hz48000, Channels::Mono, Application::Voip)
            .map_err(|e| e.to_string())?;
        encoder
            .set_bitrate(Bitrate::BitsPerSecond(BITRATE))
            .map_err(|e| e.to_string())?;
        let serial = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.subsec_nanos())
            .unwrap_or(1);
        let mut writer = PacketWriter::new(file);
        let mut head = Vec::with_capacity(19);
        head.extend_from_slice(b"OpusHead");
        head.push(1); // version
        head.push(1); // channel count
        head.extend_from_slice(&312u16.to_le_bytes()); // pre-skip the spec suggests
        head.extend_from_slice(&OPUS_RATE.to_le_bytes());
        head.extend_from_slice(&0u16.to_le_bytes()); // output gain
        head.push(0); // channel mapping: mono/stereo
        writer
            .write_packet(head, serial, PacketWriteEndInfo::EndPage, 0)
            .map_err(|e| e.to_string())?;
        let vendor = b"asapnotes";
        let mut tags = Vec::new();
        tags.extend_from_slice(b"OpusTags");
        tags.extend_from_slice(&(vendor.len() as u32).to_le_bytes());
        tags.extend_from_slice(vendor);
        tags.extend_from_slice(&0u32.to_le_bytes()); // no user comments
        writer
            .write_packet(tags, serial, PacketWriteEndInfo::EndPage, 0)
            .map_err(|e| e.to_string())?;
        Ok(Self {
            encoder,
            writer,
            serial,
            granule: 0,
            packets: 0,
            out: vec![0; 4000],
        })
    }

    fn encode(&mut self, frame: &[f32], last: bool) -> Result<(), String> {
        let n = self
            .encoder
            .encode_float(frame, &mut self.out)
            .map_err(|e| e.to_string())?;
        self.granule += FRAME as u64;
        self.packets += 1;
        let end = if last {
            PacketWriteEndInfo::EndStream
        } else if self.packets.is_multiple_of(50) {
            PacketWriteEndInfo::EndPage
        } else {
            PacketWriteEndInfo::NormalPacket
        };
        self.writer
            .write_packet(self.out[..n].to_vec(), self.serial, end, self.granule)
            .map_err(|e| e.to_string())
    }

    fn finish(self) -> Result<(), String> {
        use std::io::Write;
        self.writer.into_inner().flush().map_err(|e| e.to_string())
    }
}

/// A recorded track decoded to what whisper.cpp reads: 16 kHz mono samples.
/// Every three 48 kHz samples average into one; speech sits well under the
/// 8 kHz that keeps, and the model resamples nothing itself.
pub fn decode_for_whisper(path: &Path) -> Result<Vec<f32>, String> {
    let file =
        fs::File::open(path).map_err(|e| format!("couldn't open {}: {e}", path.display()))?;
    let mut reader = PacketReader::new(file);
    let mut decoder =
        Decoder::new(SampleRate::Hz48000, Channels::Mono).map_err(|e| e.to_string())?;
    // The two header packets carry no audio.
    for _ in 0..2 {
        reader
            .read_packet()
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("{} is not an Ogg Opus file", path.display()))?;
    }
    let mut frame = vec![0f32; FRAME];
    let mut out = Vec::new();
    loop {
        let p = match reader.read_packet() {
            Ok(Some(p)) => p,
            Ok(None) => break,
            // A recording the app could not stop (killed mid-recording) ends
            // partway through a page; the audio before it is intact.
            Err(OggReadError::ReadError(e)) if e.kind() == std::io::ErrorKind::UnexpectedEof => {
                break
            }
            Err(e) => return Err(e.to_string()),
        };
        let n = decoder
            .decode_float(Some(&p.data[..]), &mut frame[..], false)
            .map_err(|e| e.to_string())?;
        out.extend(
            frame[..n]
                .chunks_exact(3)
                .map(|c| (c[0] + c[1] + c[2]) / 3.0),
        );
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    #[test]
    fn stop_line_parses_into_tracks_and_length() {
        let line = "- Meeting recording (1:02:03): [microphone](assets/standup-mic.opus) · [system audio](<../assets/stand up-system.opus>)";
        assert_eq!(
            opus_links(line),
            vec![
                (
                    "microphone".to_string(),
                    "assets/standup-mic.opus".to_string()
                ),
                (
                    "system audio".to_string(),
                    "../assets/stand up-system.opus".to_string()
                ),
            ]
        );
        assert_eq!(elapsed_before_link(line), Some(3723));
        assert_eq!(
            elapsed_before_link("- Meeting recording (4:05): [microphone](a.opus)"),
            Some(245)
        );
        assert_eq!(elapsed_before_link("see [microphone](a.opus)"), None);
        assert!(opus_links("an [image](assets/img-1.png) and a [note](other.md)").is_empty());
        assert_eq!(
            lexical_join(Path::new("C:/root/proj"), "../assets/a b.opus"),
            PathBuf::from("C:/root/assets/a b.opus")
        );
        assert_eq!(
            lexical_join(Path::new("C:/root"), "./assets/a.opus"),
            PathBuf::from("C:/root/assets/a.opus")
        );
    }

    use super::*;

    /// What a decoder finds in a file `OggOpus` wrote: the header packets, then
    /// the audio packets decoded to PCM, with the page layout the Ogg reader saw.
    struct Probe {
        head: Vec<u8>,
        tags: Vec<u8>,
        /// Per audio packet: (ends a page, granule the page carries).
        pages: Vec<(bool, u64)>,
        pcm: Vec<f32>,
        last_in_stream: bool,
    }

    fn probe(path: &Path) -> Probe {
        let file = fs::File::open(path).expect("open");
        let mut reader = PacketReader::new(file);
        let mut decoder = Decoder::new(SampleRate::Hz48000, Channels::Mono).expect("decoder");
        let head = reader.read_packet().expect("read").expect("head").data;
        let tags = reader.read_packet().expect("read").expect("tags").data;
        let mut probe = Probe {
            head,
            tags,
            pages: Vec::new(),
            pcm: Vec::new(),
            last_in_stream: false,
        };
        let mut out = vec![0f32; FRAME];
        while let Some(p) = reader.read_packet().expect("read") {
            let n = decoder
                .decode_float(Some(&p.data[..]), &mut out[..], false)
                .expect("decode");
            assert_eq!(n, FRAME, "every packet is one 20 ms frame");
            probe.pcm.extend_from_slice(&out);
            probe.pages.push((p.last_in_page(), p.absgp_page()));
            probe.last_in_stream = p.last_in_stream();
        }
        probe
    }

    fn rms(s: &[f32]) -> f32 {
        (s.iter().map(|x| x * x).sum::<f32>() / s.len() as f32).sqrt()
    }

    fn temp_opus(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("asapnotes-{name}-{}.opus", std::process::id()))
    }

    #[test]
    fn ogg_opus_file_decodes_and_pages_once_a_second() {
        let path = temp_opus("roundtrip");
        let frames = 125; // 2.5 s: two full pages plus a partial last one
        {
            let file = fs::File::create(&path).expect("create");
            let mut sink = OggOpus::create(BufWriter::new(file)).expect("sink");
            for f in 0..frames {
                let frame: Vec<f32> = (0..FRAME)
                    .map(|i| {
                        let t = (f * FRAME + i) as f32 / OPUS_RATE as f32;
                        0.5 * (2.0 * std::f32::consts::PI * 440.0 * t).sin()
                    })
                    .collect();
                sink.encode(&frame, f + 1 == frames).expect("encode");
            }
            sink.finish().expect("finish");
        }
        let p = probe(&path);
        let _ = fs::remove_file(&path);

        assert!(p.head.starts_with(b"OpusHead"));
        assert_eq!(p.head.len(), 19);
        assert_eq!(p.head[9], 1, "mono");
        assert_eq!(&p.head[12..16], &OPUS_RATE.to_le_bytes());
        assert!(p.tags.starts_with(b"OpusTags"));
        assert_eq!(p.pages.len(), frames);
        // Page boundaries at packets 50 and 100, granule = samples so far,
        // and the stream ends on the last packet with the full sample count.
        let ends: Vec<usize> = p
            .pages
            .iter()
            .enumerate()
            .filter(|(_, (end, _))| *end)
            .map(|(i, _)| i + 1)
            .collect();
        assert_eq!(ends, vec![50, 100, 125]);
        assert_eq!(p.pages[49].1, 50 * FRAME as u64);
        assert_eq!(p.pages[124].1, 125 * FRAME as u64);
        assert!(p.last_in_stream);
        // The decoded signal is the sine back (past the codec's warm-up),
        // not silence and not garbage: a 0.5-amplitude sine has RMS ≈ 0.354.
        let steady = &p.pcm[10 * FRAME..];
        let r = rms(steady);
        assert!((0.3..0.4).contains(&r), "rms {r}");
    }

    #[test]
    fn a_recording_cut_off_mid_page_still_decodes() {
        let path = temp_opus("cutoff");
        {
            let file = fs::File::create(&path).expect("create");
            let mut sink = OggOpus::create(BufWriter::new(file)).expect("sink");
            // Three full pages of 50 packets.
            for _ in 0..150 {
                sink.encode(&[0.1; FRAME], false).expect("encode");
            }
            sink.finish().expect("finish");
        }
        // What a killed process leaves: no end-of-stream page, and the last
        // page only partly written.
        let bytes = fs::read(&path).expect("read");
        fs::write(&path, &bytes[..bytes.len() - 100]).expect("truncate");
        let decoded = decode_for_whisper(&path);
        let _ = fs::remove_file(&path);
        // The two complete pages (100 packets) survive at 16 kHz.
        assert_eq!(decoded.expect("decodes").len(), 100 * FRAME / 3);
    }

    #[test]
    fn mono_at_48k_downmixes_and_keeps_the_sample_count() {
        // Stereo 44.1 kHz, left at 1.0 and right at 0.0 → mono 0.5 at 48 kHz.
        let mut mono = MonoAt48k::new(2, 44_100);
        let mut out = Vec::new();
        let chunk: Vec<f32> = (0..441 * 2)
            .map(|i| if i % 2 == 0 { 1.0 } else { 0.0 })
            .collect();
        for _ in 0..100 {
            mono.push(&chunk, &mut out);
        }
        assert!(
            (out.len() as i64 - 48_000).abs() <= 2,
            "{} samples",
            out.len()
        );
        // The interpolator runs one source sample behind (so both neighbours
        // are always known), so the outputs inside the first source sample
        // ramp up from the silent start; everything after sits on the constant.
        assert!(out[2..].iter().all(|s| (s - 0.5).abs() < 1e-6));

        // At 48 kHz already: straight through, only the downmix applies.
        let mut same = MonoAt48k::new(1, OPUS_RATE);
        let mut out = Vec::new();
        same.push(&[0.25; 960], &mut out);
        assert_eq!(out, vec![0.25; 960]);
    }

    /// Hands-on helper: decode a recorded file and print what's in it.
    /// `ASAPNOTES_PROBE=<path> cargo test probe_recorded -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn probe_recorded_file() {
        let path = std::env::var("ASAPNOTES_PROBE").expect("ASAPNOTES_PROBE=<file.opus>");
        let p = probe(Path::new(&path));
        let seconds = p.pcm.len() as f32 / OPUS_RATE as f32;
        let loud = p.pcm.chunks(FRAME).filter(|f| rms(f) > 0.01).count();
        let peak = p.pcm.iter().fold(0f32, |m, s| m.max(s.abs()));
        println!(
            "{path}: {} packets, {seconds:.2} s, {} pages, rms {:.4}, peak {peak:.4}, {loud} frames above -40 dB, ends stream: {}",
            p.pages.len(),
            p.pages.iter().filter(|(e, _)| *e).count(),
            rms(&p.pcm),
            p.last_in_stream
        );
    }

    /// Hands-on helper: encode a 16-bit PCM WAV into a recording-shaped Opus
    /// file, the way to hand the transcription engine synthesized speech.
    /// `ASAPNOTES_WAV=<in.wav> ASAPNOTES_OPUS=<out.opus> cargo test encode_wav -- --ignored`
    #[test]
    #[ignore]
    fn encode_wav_fixture() {
        let wav = fs::read(std::env::var("ASAPNOTES_WAV").expect("ASAPNOTES_WAV=<in.wav>"))
            .expect("read wav");
        let out = std::env::var("ASAPNOTES_OPUS").expect("ASAPNOTES_OPUS=<out.opus>");
        let u16_at = |i: usize| u16::from_le_bytes([wav[i], wav[i + 1]]) as usize;
        let u32_at = |i: usize| u32::from_le_bytes([wav[i], wav[i + 1], wav[i + 2], wav[i + 3]]);
        // RIFF chunks: "fmt " gives the layout, "data" the samples.
        let (mut channels, mut rate, mut data) = (0usize, 0u32, &wav[..0]);
        let mut at = 12;
        while at + 8 <= wav.len() {
            let len = u32_at(at + 4) as usize;
            match &wav[at..at + 4] {
                b"fmt " => {
                    assert_eq!(u16_at(at + 8), 1, "PCM");
                    channels = u16_at(at + 10);
                    rate = u32_at(at + 12);
                    assert_eq!(u16_at(at + 22), 16, "16-bit");
                }
                b"data" => data = &wav[at + 8..(at + 8 + len).min(wav.len())],
                _ => {}
            }
            at += 8 + len + (len & 1);
        }
        let samples: Vec<f32> = data
            .chunks_exact(2)
            .map(|b| i16::from_le_bytes([b[0], b[1]]) as f32 / 32768.0)
            .collect();
        let mut mono = MonoAt48k::new(channels, rate);
        let mut pcm = Vec::new();
        mono.push(&samples, &mut pcm);
        pcm.resize(pcm.len().div_ceil(FRAME) * FRAME, 0.0);
        let file = fs::File::create(&out).expect("create");
        let mut sink = OggOpus::create(BufWriter::new(file)).expect("sink");
        let frames = pcm.len() / FRAME;
        for (i, frame) in pcm.chunks_exact(FRAME).enumerate() {
            sink.encode(frame, i + 1 == frames).expect("encode");
        }
        sink.finish().expect("finish");
        println!("{out}: {frames} frames, {:.2} s", frames as f32 / 50.0);
    }
}
