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

use audiopus::coder::Encoder;
use audiopus::{Application, Bitrate, Channels, SampleRate};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
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

#[cfg(test)]
mod tests {
    use super::*;
    use audiopus::coder::Decoder;
    use ogg::reading::PacketReader;

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
}
