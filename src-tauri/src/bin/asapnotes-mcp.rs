//! `asapnotes-mcp` — the corpus helper the MCP sidecar shells out to.
//!
//! One command per call: the command name in argv, its arguments as a JSON
//! object on **stdin**, one JSON envelope on stdout. Arguments go through stdin
//! rather than argv because note content is arbitrary text — newlines, quotes,
//! whole markdown documents — and every shell on the way would get a vote on
//! what survived.
//!
//! ```text
//! echo '{"note":"work/plan.md","section":"Decisions"}' | asapnotes-mcp read_note
//! {"ok":true,"result":{ … }}
//! ```
//!
//! The envelope is always emitted, including for refusals, so the server can
//! tell a tool saying no from a helper that crashed. Exit code follows: 0 when
//! `ok`, 1 when not.
//!
//! **Why a binary at all**, rather than the server reading files itself: the
//! project model — the notes root, per-project locations, mounts, and each
//! project's `files` rules — decides what a caller may *see*. A second
//! implementation of that in TypeScript, drifting from this one, would not be a
//! display bug; it would be an access-boundary bug. So the server is protocol
//! plumbing and this is the only thing that touches the corpus.

use asapnotes_lib::corpus::{tools, Roots};
use serde_json::{json, Value};
use std::io::Read;
use std::path::PathBuf;

/// Written by the app beside `settings.json`, and the reason a helper started
/// by some other process still finds the right notes: it carries the notes root
/// *the app itself resolved*, so the two can't drift apart silently.
const STATE_FILE: &str = "mcp-state.json";

fn usage() -> String {
    format!(
        "asapnotes-mcp <command> [--notes-root DIR] [--app-data DIR]\n\n\
         Arguments are a JSON object on stdin; the result is a JSON envelope on stdout.\n\n\
         Commands: {}\n\n\
         Run `doctor` first: it prints the roots this process resolved, which is the one\n\
         thing that can be wrong without looking wrong.",
        tools::COMMANDS.join(", ")
    )
}

/// App data, the same place Tauri puts it: the platform data dir plus the
/// bundle identifier from `tauri.conf.json`.
fn default_app_data() -> Result<PathBuf, String> {
    dirs::data_dir()
        .map(|d| d.join("com.anfifo.asapnotes"))
        .ok_or_else(|| "couldn't find this platform's data directory".to_string())
}

/// The notes root, preferring what the app published over what this process
/// would guess. Both sides go through the same `dirs` version Tauri itself
/// uses, but a guess is still a guess — and a helper resolving a *different*
/// notes root than the app serves a different corpus while looking perfectly
/// healthy. Reading the app's own answer removes that failure mode for the
/// root; `doctor` reports which way it went.
fn default_notes_root(app_data: &std::path::Path) -> Result<(PathBuf, &'static str), String> {
    if let Some(published) = std::fs::read_to_string(app_data.join(STATE_FILE))
        .ok()
        .and_then(|d| serde_json::from_str::<Value>(&d).ok())
        .and_then(|v| {
            v.get("notesRoot")
                .and_then(Value::as_str)
                .map(PathBuf::from)
        })
    {
        return Ok((published, "published by the app"));
    }
    dirs::document_dir()
        .map(|d| {
            (
                d.join("asapnotes"),
                "resolved from this platform's Documents",
            )
        })
        .ok_or_else(|| "couldn't find this platform's Documents directory".to_string())
}

struct Args {
    command: String,
    notes_root: Option<PathBuf>,
    app_data: Option<PathBuf>,
}

fn parse_args(argv: Vec<String>) -> Result<Args, String> {
    let mut command = None;
    let mut notes_root = None;
    let mut app_data = None;
    let mut rest = argv.into_iter();
    while let Some(arg) = rest.next() {
        match arg.as_str() {
            // Overrides for tests and unusual setups. They are also the escape
            // hatch when `doctor` shows the wrong roots.
            "--notes-root" => {
                notes_root = Some(PathBuf::from(
                    rest.next().ok_or("--notes-root needs a directory")?,
                ))
            }
            "--app-data" => {
                app_data = Some(PathBuf::from(
                    rest.next().ok_or("--app-data needs a directory")?,
                ))
            }
            "-h" | "--help" => return Err(usage()),
            other if other.starts_with('-') => return Err(format!("unknown flag {other}")),
            other => command = Some(other.to_string()),
        }
    }
    Ok(Args {
        command: command.ok_or_else(usage)?,
        notes_root,
        app_data,
    })
}

fn run() -> Result<Value, String> {
    let args = parse_args(std::env::args().skip(1).collect())?;
    let app_data = match args.app_data {
        Some(dir) => dir,
        None => default_app_data()?,
    };
    let (notes, source) = match args.notes_root {
        Some(dir) => (dir, "given on the command line"),
        None => default_notes_root(&app_data)?,
    };
    let roots = Roots::new(notes, app_data);
    roots.ensure()?;
    let input = read_stdin()?;
    let mut result = tools::dispatch(&roots, &args.command, &input)?;
    // `doctor` is the one command whose whole job is making resolution
    // visible, so it says where its notes root came from.
    if args.command == "doctor" {
        result["notesRootSource"] = json!(source);
    }
    Ok(result)
}

/// Arguments as JSON. Empty stdin means no arguments — a `doctor` or
/// `list_projects` call shouldn't have to pipe `{}` in to work.
fn read_stdin() -> Result<Value, String> {
    let mut raw = String::new();
    std::io::stdin()
        .read_to_string(&mut raw)
        .map_err(|e| format!("couldn't read arguments from stdin: {e}"))?;
    if raw.trim().is_empty() {
        return Ok(json!({}));
    }
    let value: Value =
        serde_json::from_str(&raw).map_err(|e| format!("arguments are not valid JSON: {e}"))?;
    if !value.is_object() {
        return Err("arguments have to be a JSON object".into());
    }
    Ok(value)
}

fn main() {
    let (envelope, code) = match run() {
        Ok(result) => (json!({ "ok": true, "result": result }), 0),
        Err(error) => (json!({ "ok": false, "error": error }), 1),
    };
    println!("{envelope}");
    std::process::exit(code);
}
