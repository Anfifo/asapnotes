//! The helper's side of the control channel: one request to the running app,
//! at the address it published, and its reply. Authorization happens in the
//! app; this side only presents the token from the state file.

use super::{grants, Roots};
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};

pub fn call(roots: &Roots, action: &str, args: &Value) -> Result<Value, String> {
    let not_running = || {
        "asapnotes isn't running, or meeting control is off (Settings > MCP > Meetings in the \
         app turns it on)"
            .to_string()
    };
    let address = grants::read_state(roots).control.ok_or_else(not_running)?;
    let request = json!({ "token": address.token, "action": action, "args": args });
    let stream = connect(&address.endpoint).map_err(|_| not_running())?;
    (&stream)
        .write_all(format!("{request}\n").as_bytes())
        .map_err(|e| e.to_string())?;
    let mut line = String::new();
    BufReader::new(&stream)
        .read_line(&mut line)
        .map_err(|e| e.to_string())?;
    let envelope: Value =
        serde_json::from_str(&line).map_err(|_| "the app closed the connection".to_string())?;
    if envelope.get("ok").and_then(Value::as_bool) == Some(true) {
        Ok(envelope.get("result").cloned().unwrap_or(Value::Null))
    } else {
        Err(envelope
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or("the app refused without saying why")
            .to_string())
    }
}

/// Every pipe instance can be busy for a moment while the app opens the next
/// one, so a busy pipe is retried briefly.
#[cfg(windows)]
fn connect(endpoint: &str) -> std::io::Result<std::fs::File> {
    const ERROR_PIPE_BUSY: i32 = 231;
    let mut tries = 0;
    loop {
        match std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open(endpoint)
        {
            Err(e) if e.raw_os_error() == Some(ERROR_PIPE_BUSY) && tries < 40 => {
                tries += 1;
                std::thread::sleep(std::time::Duration::from_millis(25));
            }
            other => return other,
        }
    }
}

#[cfg(unix)]
fn connect(endpoint: &str) -> std::io::Result<std::os::unix::net::UnixStream> {
    std::os::unix::net::UnixStream::connect(endpoint)
}
