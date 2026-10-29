//! The control channel: how an agent starts and stops a meeting recording in
//! the running app.
//!
//! Recording lives in this process, and the MCP helper is a separate one, so
//! the helper reaches it through a local endpoint published in
//! `mcp-state.json` with a token fresh on every launch. The endpoint opens
//! only once `mcp.meetings` is on. Requests are authorized here, in the
//! trusted process: the switch and the note's grant are checked before
//! anything reaches the frontend, which owns the recording chip, the editor
//! and the transcript, and carries the request out.

use crate::corpus::grants::{self, ControlAddress};
use crate::corpus::{store, tools};
use crate::settings::Kind;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::sync::oneshot;

/// How long the frontend has to carry out a request.
const TIMEOUT: Duration = Duration::from_secs(20);
/// A request is one short JSON line.
const MAX_REQUEST: u64 = 64 * 1024;

#[derive(Default)]
pub struct Control {
    started: AtomicBool,
    token: Mutex<Option<String>>,
    pending: Mutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>,
    next_request: AtomicU64,
}

fn random_hex(bytes: usize) -> Result<String, String> {
    let mut buf = vec![0u8; bytes];
    getrandom::fill(&mut buf).map_err(|e| e.to_string())?;
    Ok(buf.iter().map(|b| format!("{b:02x}")).collect())
}

/// Open the endpoint and publish its address. Does nothing once running, so
/// launch and the Settings switch can both call it.
pub fn start(app: &AppHandle) -> Result<(), String> {
    let control = app.state::<Control>();
    if control.started.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    let roots = crate::app_paths::roots(app)?;
    let endpoint = if cfg!(windows) {
        format!(r"\\.\pipe\asapnotes-control-{}", random_hex(8)?)
    } else {
        roots
            .data
            .join("control.sock")
            .to_string_lossy()
            .into_owned()
    };
    let token = random_hex(16)?;
    *control.token.lock().map_err(|e| e.to_string())? = Some(token.clone());
    grants::publish_control(
        &roots,
        Some(ControlAddress {
            endpoint: endpoint.clone(),
            token,
        }),
    )?;
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = serve(handle, endpoint).await {
            eprintln!("control channel stopped: {e}");
        }
    });
    Ok(())
}

#[cfg(windows)]
async fn serve(app: AppHandle, endpoint: String) -> std::io::Result<()> {
    use tokio::net::windows::named_pipe::ServerOptions;
    // Remote clients are refused by default; the token keeps out local
    // processes that can open the pipe but cannot read this user's app data.
    let mut server = ServerOptions::new()
        .first_pipe_instance(true)
        .reject_remote_clients(true)
        .create(&endpoint)?;
    loop {
        server.connect().await?;
        let conn = std::mem::replace(
            &mut server,
            ServerOptions::new()
                .reject_remote_clients(true)
                .create(&endpoint)?,
        );
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            let _ = connection(app, conn).await;
        });
    }
}

#[cfg(unix)]
async fn serve(app: AppHandle, endpoint: String) -> std::io::Result<()> {
    let _ = std::fs::remove_file(&endpoint);
    let listener = tokio::net::UnixListener::bind(&endpoint)?;
    loop {
        let (conn, _) = listener.accept().await?;
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            let _ = connection(app, conn).await;
        });
    }
}

/// One request line in, one envelope line out, the same envelope the helper
/// prints.
async fn connection<S: AsyncRead + AsyncWrite + Unpin>(
    app: AppHandle,
    conn: S,
) -> std::io::Result<()> {
    let (read, mut write) = tokio::io::split(conn);
    let mut line = String::new();
    BufReader::new(read.take(MAX_REQUEST))
        .read_line(&mut line)
        .await?;
    let reply = match serde_json::from_str::<Value>(&line) {
        Ok(request) => handle(&app, &request).await,
        Err(e) => Err(format!("not a JSON request: {e}")),
    };
    let envelope = match reply {
        Ok(result) => json!({ "ok": true, "result": result }),
        Err(error) => json!({ "ok": false, "error": error }),
    };
    write.write_all(format!("{envelope}\n").as_bytes()).await?;
    write.flush().await
}

async fn handle(app: &AppHandle, request: &Value) -> Result<Value, String> {
    let expected = app
        .state::<Control>()
        .token
        .lock()
        .map_err(|e| e.to_string())?
        .clone();
    if expected.is_none() || request.get("token").and_then(Value::as_str) != expected.as_deref() {
        return Err("not authorized: the token doesn't match this run of the app".into());
    }
    let action = request
        .get("action")
        .and_then(Value::as_str)
        .ok_or("missing \"action\"")?;
    let args = request.get("args").cloned().unwrap_or_else(|| json!({}));

    // Settings straight from the file, as the helper reads them: a switch
    // turned off by hand must not wait for the app's next reload.
    let roots = crate::app_paths::roots(app)?;
    let loaded = store::load(&roots)?;
    if let Some(e) = loaded.error {
        return Err(format!("{e} — fix settings.json first"));
    }
    let s = loaded.settings;
    if !s.mcp.meetings_on() {
        return Err(
            "meeting control is off; Settings > MCP > Meetings in asapnotes turns it on".into(),
        );
    }

    match action {
        "meeting_status" | "stop_meeting" => forward(app, action, args).await,
        "start_meeting" => {
            // Always in the meetings destination; a name that is already a
            // note there is recorded into again.
            let note = tools::new_note_id(
                &roots,
                &s,
                args.get("project").and_then(Value::as_str),
                args.get("name").and_then(Value::as_str).unwrap_or(""),
                &Kind::Meeting,
                "md",
            )?;
            let state = grants::read_state(&roots);
            grants::check_write(&s, &state, &note).map_err(|d| d.to_string())?;
            // A recording an agent starts brings the window up, so it never
            // runs unseen.
            crate::desktop::show_main_window(app);
            let flag = |key: &str| args.get(key).and_then(Value::as_bool).unwrap_or(true);
            forward(
                app,
                action,
                json!({ "note": note, "mic": flag("mic"), "system": flag("system") }),
            )
            .await
        }
        other => Err(format!("unknown action \"{other}\"")),
    }
}

/// Hand a request to the frontend and wait for its reply.
async fn forward(app: &AppHandle, action: &str, args: Value) -> Result<Value, String> {
    let control = app.state::<Control>();
    let id = control.next_request.fetch_add(1, Ordering::SeqCst) + 1;
    let (tx, rx) = oneshot::channel();
    control
        .pending
        .lock()
        .map_err(|e| e.to_string())?
        .insert(id, tx);
    app.emit_to(
        "main",
        "app-control",
        json!({ "id": id, "action": action, "args": args }),
    )
    .map_err(|e| e.to_string())?;
    match tokio::time::timeout(TIMEOUT, rx).await {
        Ok(Ok(reply)) => reply,
        _ => {
            if let Ok(mut pending) = control.pending.lock() {
                pending.remove(&id);
            }
            Err("the app didn't answer in time; its window may be reloading".into())
        }
    }
}

/// The frontend's answer to an `app-control` request.
#[tauri::command]
pub fn control_reply(app: AppHandle, id: u64, ok: bool, value: Value) -> Result<(), String> {
    let control = app.state::<Control>();
    let tx = control
        .pending
        .lock()
        .map_err(|e| e.to_string())?
        .remove(&id);
    if let Some(tx) = tx {
        let reply = if ok {
            Ok(value)
        } else {
            Err(value
                .as_str()
                .map_or_else(|| value.to_string(), str::to_string))
        };
        let _ = tx.send(reply);
    }
    Ok(())
}
