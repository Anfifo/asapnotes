//! The sidecar's tool surface: one typed operation per MCP tool, grants
//! enforced, JSON in and JSON out.
//!
//! This lives in the core rather than in the server for one reason: **the
//! server is the untrusted half.** It is a process the agent's own client
//! spawns, so anything it enforced would be enforcement the agent could route
//! around by running the helper binary directly. Grants, the write pin and the
//! id checks all happen here, below anything a client controls.
//!
//! Settings are re-read on every call — a grant the user just revoked must not
//! stay open for the lifetime of a long-running agent process. That is a file
//! read per call; if it ever shows up as latency the fix is an mtime-gated
//! cache, not a longer-lived grant.

use super::{canvas, edits, grants, ids, log, search, sections, store, walk, Roots};
use serde_json::{json, Map, Value};

/// Every wire name this helper answers to, in the order the docs list them.
pub const COMMANDS: [&str; 13] = [
    "doctor",
    "list_projects",
    "list_notes",
    "read_note",
    "outline_note",
    "search_notes",
    "find_notes",
    "write_section",
    "append_to_note",
    "read_canvas",
    "write_canvas",
    "read_settings",
    "write_settings",
];

/// Default note count for an outlined listing, well under the plain one: an
/// outline carries a heading tree per note, so the same limit that is
/// comfortable for names is a very large answer here.
const OUTLINE_LIMIT: usize = 200;

/// And a ceiling on the bytes an outlined listing will accumulate, because
/// note count alone doesn't bound it — a handful of long documents can.
const OUTLINE_MAX_BYTES: usize = 200 * 1024;

fn str_arg<'a>(args: &'a Value, key: &str) -> Result<&'a str, String> {
    args.get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("missing required argument \"{key}\""))
}

fn opt_str<'a>(args: &'a Value, key: &str) -> Option<&'a str> {
    args.get(key).and_then(Value::as_str)
}

fn opt_usize(args: &Value, key: &str) -> Option<usize> {
    args.get(key).and_then(Value::as_u64).map(|n| n as usize)
}

fn opt_u64(args: &Value, key: &str) -> Option<u64> {
    args.get(key).and_then(Value::as_u64)
}

fn opt_bool(args: &Value, key: &str) -> bool {
    args.get(key).and_then(Value::as_bool).unwrap_or(false)
}

/// Settings, freshly read, with a broken file reported rather than silently
/// serving shipped defaults — a sidecar answering from defaults would show an
/// empty corpus and look like it simply had nothing to say.
fn settings(roots: &Roots) -> Result<crate::settings::Settings, String> {
    let loaded = store::load(roots)?;
    match loaded.error {
        Some(e) => Err(format!(
            "{e} — fix settings.json before the sidecar can run"
        )),
        None => Ok(loaded.settings),
    }
}

pub fn dispatch(roots: &Roots, command: &str, args: &Value) -> Result<Value, String> {
    match command {
        "doctor" => doctor(roots),
        "list_projects" => list_projects(roots),
        "list_notes" => list_notes(roots, args),
        "read_note" => read_note(roots, args),
        "outline_note" => outline_note(roots, args),
        "search_notes" => search_notes(roots, args),
        "find_notes" => find_notes(roots, args),
        "write_section" => write_section(roots, args),
        "append_to_note" => append_to_note(roots, args),
        "read_canvas" => read_canvas(roots, args),
        "write_canvas" => write_canvas(roots, args),
        "read_settings" => read_settings(roots),
        "write_settings" => write_settings(roots, args),
        other => Err(format!(
            "unknown command \"{other}\"; this helper answers: {}",
            COMMANDS.join(", ")
        )),
    }
}

/// What this process resolved, so a mismatch with the app is one command away
/// from being visible instead of being a corpus that is quietly wrong.
fn doctor(roots: &Roots) -> Result<Value, String> {
    let loaded = store::load(roots)?;
    let s = &loaded.settings;
    let state = grants::read_state(roots);
    let projects = walk::list_projects(roots, s).unwrap_or_default();
    let grants_by_project: Map<String, Value> = projects
        .iter()
        .map(|p| {
            (
                p.name.clone(),
                json!(grants::grant_for(s, Some(&p.name)).as_str()),
            )
        })
        .collect();
    Ok(json!({
        "notesRoot": roots.notes.to_string_lossy(),
        "appData": roots.data.to_string_lossy(),
        "settingsFile": roots.settings_file().to_string_lossy(),
        "settingsFileExists": roots.settings_file().exists(),
        "settingsError": loaded.error,
        "defaults": {
            "notesRootProjects": s.mcp.notes_root_grant().as_str(),
            "linkedProjects": s.mcp.linked_grant().as_str(),
            "settings": s.mcp.settings_grant().as_str(),
        },
        "writeScope": if s.mcp.pinned_to_current() { "current" } else { "any" },
        "currentProject": state.current_project,
        "grants": grants_by_project,
        "visibleProjects": grants::visible_projects(roots, s)
            .map(|v| v.len())
            .unwrap_or(0),
    }))
}

fn list_projects(roots: &Roots) -> Result<Value, String> {
    let s = settings(roots)?;
    let notes = walk::list_notes(roots, &s, true)?;
    let out: Vec<Value> = grants::visible_projects(roots, &s)?
        .into_iter()
        .map(|(p, grant)| {
            let count = notes
                .iter()
                .filter(|n| ids::project_of(&n.name) == Some(p.name.as_str()))
                .count();
            json!({
                "project": p.name,
                "grant": grant.as_str(),
                "missing": p.missing,
                "notes": count,
            })
        })
        .collect();
    Ok(json!(out))
}

/// Notes the caller may see, optionally with each one's heading tree.
///
/// `outline` is the token-economy move: a listing that carried content would be
/// unusable at any real size, while one that carries heading trees lets a
/// caller find the section it wants and then read only that.
fn list_notes(roots: &Roots, args: &Value) -> Result<Value, String> {
    let s = settings(roots)?;
    let project = opt_str(args, "project");
    let want_outline = opt_bool(args, "outline");
    let limit = opt_usize(args, "limit").unwrap_or(if want_outline { OUTLINE_LIMIT } else { 2000 });
    let mut out = Vec::new();
    let mut truncated = false;
    let mut bytes = 0usize;
    for note in walk::list_notes(roots, &s, true)? {
        if out.len() >= limit {
            truncated = true;
            break;
        }
        if grants::check_read(&s, &note.name).is_err() {
            continue;
        }
        if let Some(project) = project {
            if ids::project_of(&note.name) != Some(project) {
                continue;
            }
        }
        let mut row = json!({ "note": note.name, "mtimeMs": note.modified_ms });
        if want_outline {
            let headings = ids::resolve(roots, &s, &note.name)
                .ok()
                .and_then(|p| std::fs::read_to_string(p).ok())
                .map(|doc| {
                    sections::outline(&doc)
                        .into_iter()
                        .map(|h| json!({ "section": h.path, "depth": h.depth }))
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            row["headings"] = json!(headings);
            bytes += row.to_string().len();
        }
        out.push(row);
        // A heading tree per note over a whole corpus is the one answer here
        // that can outgrow what the caller can hold, so it stops on size too.
        if bytes > OUTLINE_MAX_BYTES {
            truncated = true;
            break;
        }
    }
    Ok(json!({ "notes": out, "truncated": truncated }))
}

/// Read a whole note, or one section of it. The cheap read is the normal read:
/// pass `section` and only that extent comes back.
fn read_note(roots: &Roots, args: &Value) -> Result<Value, String> {
    let s = settings(roots)?;
    let note = str_arg(args, "note")?;
    grants::check_read(&s, note).map_err(|d| d.to_string())?;
    let path = ids::resolve(roots, &s, note)?;
    let doc = std::fs::read_to_string(&path).map_err(|_| format!("no such note: {note}"))?;
    let mtime = super::mtime_ms(&path).unwrap_or(0);
    match opt_str(args, "section") {
        None => Ok(json!({ "note": note, "text": doc, "mtimeMs": mtime })),
        Some(query) => {
            let found = sections::resolve(&doc, query).map_err(|e| e.to_string())?;
            Ok(json!({
                "note": note,
                "section": found.path,
                "depth": found.depth,
                "line": found.line,
                "text": found.text(&doc),
                "mtimeMs": mtime,
            }))
        }
    }
}

fn outline_note(roots: &Roots, args: &Value) -> Result<Value, String> {
    let s = settings(roots)?;
    let note = str_arg(args, "note")?;
    grants::check_read(&s, note).map_err(|d| d.to_string())?;
    let path = ids::resolve(roots, &s, note)?;
    let doc = std::fs::read_to_string(&path).map_err(|_| format!("no such note: {note}"))?;
    let headings: Vec<Value> = sections::outline(&doc)
        .into_iter()
        .map(|h| json!({ "section": h.path, "depth": h.depth, "line": h.line }))
        .collect();
    Ok(json!({
        "note": note,
        "headings": headings,
        "mtimeMs": super::mtime_ms(&path).unwrap_or(0),
    }))
}

/// Content search. Hits name the section they fall under, so a caller can go
/// straight to a section read instead of pulling the whole note.
fn search_notes(roots: &Roots, args: &Value) -> Result<Value, String> {
    let s = settings(roots)?;
    let limit = opt_usize(args, "limit").unwrap_or(50);
    let mut q = search::Query::new(str_arg(args, "query")?);
    q.project = opt_str(args, "project").map(str::to_string);
    // One past what the caller asked for, so a full result and a clipped one
    // can be told apart without guessing from the count.
    q.limit = limit.saturating_add(1);
    q.per_note = opt_usize(args, "perNote").or(Some(10));
    q.sections = true;
    // A project named but not readable must answer like a project that isn't
    // there — the same rule a direct read follows.
    if let Some(project) = &q.project {
        if !grants::grant_for(&s, Some(project)).can_read() {
            return Ok(json!({ "hits": [], "truncated": false }));
        }
    }
    // The grant decides what may be searched, not what survives the search:
    // pass it down so an unreadable note is skipped before it spends a slot.
    let readable = |note: &str| grants::check_read(&s, note).is_ok();
    let mut found = search::search(roots, &s, &q, Some(&readable))?;
    let truncated = found.len() > limit;
    found.truncate(limit);
    let hits: Vec<Value> = found
        .into_iter()
        .map(|h| {
            json!({
                "note": h.note,
                "line": h.line,
                "section": h.section.unwrap_or_default(),
                "text": h.text,
            })
        })
        .collect();
    Ok(json!({ "hits": hits, "truncated": truncated }))
}

/// Name search: no file is opened, so this is the cheap half of finding things.
fn find_notes(roots: &Roots, args: &Value) -> Result<Value, String> {
    let s = settings(roots)?;
    let limit = opt_usize(args, "limit").unwrap_or(30);
    let readable = |note: &str| grants::check_read(&s, note).is_ok();
    let mut found = search::find_notes(
        roots,
        &s,
        str_arg(args, "pattern")?,
        limit.saturating_add(1),
        Some(&readable),
    )?;
    let truncated = found.len() > limit;
    found.truncate(limit);
    let notes: Vec<Value> = found
        .into_iter()
        .map(|f| json!({ "note": f.name, "mtimeMs": f.modified_ms }))
        .collect();
    Ok(json!({ "notes": notes, "truncated": truncated }))
}

fn write_section(roots: &Roots, args: &Value) -> Result<Value, String> {
    let s = settings(roots)?;
    let state = grants::read_state(roots);
    let note = str_arg(args, "note")?;
    let section = str_arg(args, "section")?;
    let content = str_arg(args, "content")?;
    let result = edits::write_section(
        roots,
        &s,
        &state,
        note,
        section,
        content,
        opt_u64(args, "expectUnchanged"),
    )?;
    log::record(
        roots,
        &log::Entry::new(
            "write_section",
            format!("replaced {} lines", result.replaced.lines().count()),
        )
        .on(&result.note, &result.section),
    );
    serde_json::to_value(result).map_err(|e| e.to_string())
}

fn append_to_note(roots: &Roots, args: &Value) -> Result<Value, String> {
    let s = settings(roots)?;
    let state = grants::read_state(roots);
    let note = str_arg(args, "note")?;
    let content = str_arg(args, "content")?;
    let result = edits::append(
        roots,
        &s,
        &state,
        note,
        content,
        opt_str(args, "section"),
        opt_u64(args, "expectUnchanged"),
    )?;
    log::record(
        roots,
        &log::Entry::new(
            "append_to_note",
            if result.created {
                format!("created with {} lines", content.lines().count())
            } else {
                format!("appended {} lines", content.lines().count())
            },
        )
        .on(&result.note, &result.section),
    );
    serde_json::to_value(result).map_err(|e| e.to_string())
}

/// A canvas is a note like any other here — the registry claims `.canvas`, so
/// ids, grants and the walks already work on it. What differs is the shape that
/// comes back: a summary, not the file, because a hand-drawn board carries tens
/// of thousands of stroke coordinates that mean nothing to a reader.
fn read_canvas(roots: &Roots, args: &Value) -> Result<Value, String> {
    let s = settings(roots)?;
    let note = str_arg(args, "note")?;
    grants::check_read(&s, note).map_err(|d| d.to_string())?;
    let path = ids::resolve(roots, &s, note)?;
    let source = std::fs::read_to_string(&path).map_err(|_| format!("no such canvas: {note}"))?;
    let doc = canvas::parse(&source)?;
    let summary = canvas::summarize(&doc);
    let mut out = serde_json::to_value(summary).map_err(|e| e.to_string())?;
    out["note"] = json!(note);
    out["mtimeMs"] = json!(super::mtime_ms(&path).unwrap_or(0));
    // `raw: true` hands over the document itself, for a caller that means to
    // edit it and send it back. Opt-in, because on a drawn board it is huge.
    if opt_bool(args, "raw") {
        out["canvas"] = doc;
    }
    Ok(out)
}

/// Write a whole canvas.
///
/// This is the one whole-file write in the surface, because a canvas has no
/// section addressing to target — so it carries the discipline the note tools
/// use `expect_unchanged` for, and carries it as a **requirement**: overwriting
/// an existing canvas without saying which version you read is exactly the call
/// that silently destroys work nobody looked at. Creating a new one needs no
/// such argument, there being nothing to lose.
fn write_canvas(roots: &Roots, args: &Value) -> Result<Value, String> {
    let s = settings(roots)?;
    let state = grants::read_state(roots);
    let note = str_arg(args, "note")?;
    grants::check_write(&s, &state, note).map_err(|d| d.to_string())?;
    let doc = args
        .get("canvas")
        .ok_or("missing required argument \"canvas\"")?;
    canvas::validate(doc).map_err(|problems| {
        format!(
            "that canvas wouldn't open as a board:\n- {}",
            problems.join("\n- ")
        )
    })?;
    let path = ids::resolve(roots, &s, note)?;
    let existed = path.exists();
    let expect = opt_u64(args, "expectUnchanged");
    if existed {
        let Some(expected) = expect else {
            return Err(format!(
                "{note} already exists — read it first and pass expectUnchanged with the \
                 mtime you got, so this call can't overwrite work you never saw"
            ));
        };
        let actual = super::mtime_ms(&path);
        if actual != Some(expected) {
            return Err(edits::stale(note, expected, actual));
        }
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, canvas::to_text(doc)?).map_err(|e| e.to_string())?;
    let summary = canvas::summarize(doc);
    log::record(
        roots,
        &log::Entry::new(
            "write_canvas",
            format!(
                "{} canvas with {} nodes and {} edges",
                if existed { "rewrote" } else { "created" },
                summary.nodes.len(),
                summary.edges.len()
            ),
        )
        .on(note, ""),
    );
    Ok(json!({
        "note": note,
        "created": !existed,
        "nodes": summary.nodes.len(),
        "edges": summary.edges.len(),
        "mtimeMs": super::mtime_ms(&path).unwrap_or(0),
    }))
}

/// Settings access is off unless the user turns it on, and that default is not
/// timidity: this file names every machine path on the box, plus where every
/// linked project lives. Turning it on is a deliberate act, so the refusal says
/// exactly which key to set.
fn settings_gate(s: &crate::settings::Settings, write: bool) -> Result<(), String> {
    let grant = s.mcp.settings_grant();
    let ok = if write {
        grant.can_write()
    } else {
        grant.can_read()
    };
    if ok {
        return Ok(());
    }
    Err(format!(
        "settings are not {} over MCP (mcp.settings is \"{}\") — set mcp.settings to \"{}\" \
         in settings.json to allow it",
        if write { "writable" } else { "readable" },
        grant.as_str(),
        if write { "write" } else { "read" }
    ))
}

fn read_settings(roots: &Roots) -> Result<Value, String> {
    let s = settings(roots)?;
    settings_gate(&s, false)?;
    store::read_json(roots)
}

fn write_settings(roots: &Roots, args: &Value) -> Result<Value, String> {
    let s = settings(roots)?;
    settings_gate(&s, true)?;
    let patch = args
        .get("patch")
        .ok_or("missing required argument \"patch\"")?;
    let after = store::patch_settings(roots, patch)?;
    log::record(
        roots,
        &log::Entry::new(
            "write_settings",
            format!(
                "patched {}",
                patch
                    .as_object()
                    .map(|o| o.keys().cloned().collect::<Vec<_>>().join(", "))
                    .unwrap_or_else(|| "settings".into())
            ),
        ),
    );
    Ok(after)
}
