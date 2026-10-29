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

use super::{control, edits, grants, ids, log, search, sections, store, walk, Roots};
use serde_json::{json, Map, Value};
use std::collections::BTreeSet;

/// Every wire name this helper answers to, in the order the docs list them.
pub const COMMANDS: [&str; 18] = [
    "doctor",
    "list_projects",
    "list_workspaces",
    "list_notes",
    "read_note",
    "outline_note",
    "search_notes",
    "find_notes",
    "write_section",
    "append_to_note",
    "create_note",
    "move_note",
    "read_settings",
    "write_settings",
    "start_meeting",
    "stop_meeting",
    "meeting_status",
    "code_folders",
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
        "list_projects" => list_projects(roots, args),
        "list_workspaces" => list_workspaces(roots),
        "list_notes" => list_notes(roots, args),
        "read_note" => read_note(roots, args),
        "outline_note" => outline_note(roots, args),
        "search_notes" => search_notes(roots, args),
        "find_notes" => find_notes(roots, args),
        "write_section" => write_section(roots, args),
        "append_to_note" => append_to_note(roots, args),
        "create_note" => create_note(roots, args),
        "move_note" => move_note(roots, args),
        "read_settings" => read_settings(roots),
        "write_settings" => write_settings(roots, args),
        "start_meeting" | "stop_meeting" | "meeting_status" => meeting(roots, command, args),
        "code_folders" => code_folders(roots),
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
            "meetings": if s.mcp.meetings_on() { "on" } else { "off" },
        },
        "writeScope": if s.mcp.pinned_to_current() { "current" } else { "any" },
        "currentProject": state.current_project,
        "currentWorkspace": s.current_workspace,
        "destinations": s.destinations,
        "grants": grants_by_project,
        "visibleProjects": grants::visible_projects(roots, s)
            .map(|v| v.len())
            .unwrap_or(0),
    }))
}

/// The `workspace` argument, resolved to the project names it holds; `None`
/// when the caller named none — or named "Default", which is every project —
/// and so means everything visible. A name the table doesn't hold is an error
/// that lists the workspaces, never a guess. A workspace is a filter over what
/// the grants already allow and is applied after them, so it never widens what
/// a caller can see.
fn workspace_scope(
    s: &crate::settings::Settings,
    args: &Value,
) -> Result<Option<BTreeSet<String>>, String> {
    let Some(name) = opt_str(args, "workspace") else {
        return Ok(None);
    };
    if name.eq_ignore_ascii_case("default") {
        return Ok(None);
    }
    match s.workspaces.get(name) {
        Some(projects) => Ok(Some(projects.iter().cloned().collect())),
        None if s.workspaces.is_empty() => {
            Err(format!("no workspace named \"{name}\"; none are defined"))
        }
        None => Err(format!(
            "no workspace named \"{name}\"; workspaces: {}",
            s.workspaces.keys().cloned().collect::<Vec<_>>().join(", ")
        )),
    }
}

/// In scope: no workspace named, or the note sits in one of its projects, or
/// it is a top-level note — those belong to every workspace, as in the app.
fn in_scope(scope: Option<&BTreeSet<String>>, note: &str) -> bool {
    match (scope, ids::project_of(note)) {
        (None, _) | (Some(_), None) => true,
        (Some(set), Some(p)) => set.contains(p),
    }
}

/// The workspaces, each with the projects in it this caller may see. A member
/// the grants hide is left out, so a workspace never names a project that does
/// not exist to the sidecar. `current` is the one the app is on; null means
/// Default, which is every visible project and is not listed.
fn list_workspaces(roots: &Roots) -> Result<Value, String> {
    let s = settings(roots)?;
    let visible: BTreeSet<String> = grants::visible_projects(roots, &s)?
        .into_iter()
        .map(|(p, _)| p.name)
        .collect();
    let workspaces: Vec<Value> = s
        .workspaces
        .iter()
        .map(|(name, projects)| {
            let shown: Vec<&String> = projects.iter().filter(|p| visible.contains(*p)).collect();
            json!({ "workspace": name, "projects": shown })
        })
        .collect();
    Ok(json!({ "current": s.current_workspace, "workspaces": workspaces }))
}

fn list_projects(roots: &Roots, args: &Value) -> Result<Value, String> {
    let s = settings(roots)?;
    let scope = workspace_scope(&s, args)?;
    let notes = walk::list_notes(roots, &s, true)?;
    let out: Vec<Value> = grants::visible_projects(roots, &s)?
        .into_iter()
        .filter(|(p, _)| match &scope {
            None => true,
            Some(set) => set.contains(&p.name),
        })
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
                "destinations": s.projects.get(&p.name).map(|e| &e.destinations),
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
    let scope = workspace_scope(&s, args)?;
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
        if grants::check_read(&s, &note.name).is_err() || !in_scope(scope.as_ref(), &note.name) {
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
    let scope = workspace_scope(&s, args)?;
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
    // The workspace rides the same check for the same reason.
    let readable =
        |note: &str| grants::check_read(&s, note).is_ok() && in_scope(scope.as_ref(), note);
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
    let scope = workspace_scope(&s, args)?;
    let limit = opt_usize(args, "limit").unwrap_or(30);
    let readable =
        |note: &str| grants::check_read(&s, note).is_ok() && in_scope(scope.as_ref(), note);
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

/// The id a new note gets: `name` in the destination for its kind, with `ext`
/// added unless the name already carries a note extension. A named project
/// has to be one the caller can see: an unknown name would otherwise create a
/// notes-root folder, which is a new project, and a hidden one answers like
/// one that isn't there.
pub fn new_note_id(
    roots: &Roots,
    s: &crate::settings::Settings,
    project: Option<&str>,
    name: &str,
    kind: &crate::settings::Kind,
    ext: &str,
) -> Result<String, String> {
    let name = name.trim().trim_matches('/');
    if name.is_empty() {
        return Err("a new note needs a name".into());
    }
    if let Some(p) = project {
        let known = grants::visible_projects(roots, s)?
            .iter()
            .any(|(info, _)| info.name == p);
        if !known {
            return Err(format!(
                "no such project: {p} (a project whose AI access is off is hidden; the user \
                 can give it Write access in Settings > MCP > Project access)"
            ));
        }
    }
    let file = if s.type_for(name).is_some() {
        name.to_string()
    } else {
        format!("{name}.{ext}")
    };
    let folder = s.destination(project, kind);
    Ok(if folder.is_empty() {
        file
    } else {
        format!("{folder}/{file}")
    })
}

/// A new note in the folder the user configured for its kind. The caller
/// names the file; the folder comes from `destinations`, so an agent files
/// notes where the user files them without knowing the layout.
fn create_note(roots: &Roots, args: &Value) -> Result<Value, String> {
    use crate::settings::Kind;
    let s = settings(roots)?;
    let state = grants::read_state(roots);
    let name = str_arg(args, "name")?;
    let project = opt_str(args, "project");
    let type_id = match opt_str(args, "type") {
        Some(id) => id,
        None => s.default_note_type.as_deref().unwrap_or("markdown"),
    };
    let kind = match opt_str(args, "kind").unwrap_or("note") {
        "note" => Kind::Type(type_id),
        "capture" => Kind::Capture,
        "meeting" => Kind::Meeting,
        other => {
            return Err(format!(
                "not a kind of note: {other} (note, capture, meeting)"
            ))
        }
    };
    // Captures and meetings are markdown, as they are in the app.
    let type_id = if matches!(kind, Kind::Type(_)) {
        type_id
    } else {
        "markdown"
    };
    let note_type = s
        .note_types
        .iter()
        .find(|t| t.id == type_id)
        .ok_or_else(|| format!("no note type with id \"{type_id}\""))?;
    let ext = note_type.extensions.first().map_or("md", String::as_str);
    let note = new_note_id(roots, &s, project, name, &kind, ext)?;
    let content = opt_str(args, "content").unwrap_or("");
    let result = edits::create(roots, &s, &state, &note, content)?;
    log::record(
        roots,
        &log::Entry::new(
            "create_note",
            format!("created with {} lines", content.lines().count()),
        )
        .on(&result.note, ""),
    );
    serde_json::to_value(result).map_err(|e| e.to_string())
}

fn move_note(roots: &Roots, args: &Value) -> Result<Value, String> {
    let s = settings(roots)?;
    let state = grants::read_state(roots);
    let from = str_arg(args, "from")?;
    let to = str_arg(args, "to")?;
    edits::move_note(roots, &s, &state, from, to)?;
    log::record(
        roots,
        &log::Entry::new("move_note", format!("moved from {from}")).on(to, ""),
    );
    Ok(json!({ "from": from, "to": to }))
}

/// Recording runs in the app, so these go over the control channel, and the
/// app checks the meetings switch and the note's grant. A start or stop is
/// logged with the other writes.
fn meeting(roots: &Roots, command: &str, args: &Value) -> Result<Value, String> {
    let out = control::call(roots, command, args)?;
    if command != "meeting_status" {
        let summary = match command {
            "start_meeting" => "started recording".to_string(),
            _ => format!(
                "stopped recording after {} s",
                out["seconds"].as_u64().unwrap_or(0)
            ),
        };
        let note = out["note"].as_str().unwrap_or("");
        log::record(roots, &log::Entry::new(command, summary).on(note, ""));
    }
    Ok(out)
}

/// The code folders of every project this caller may see, for agent hooks
/// that remind a session these notes exist when it works in one of them. Not
/// an MCP tool: the hook calls the helper directly. Hidden projects are left
/// out, so a project that is off never prompts a reminder.
fn code_folders(roots: &Roots) -> Result<Value, String> {
    let s = settings(roots)?;
    let projects: Vec<Value> = grants::visible_projects(roots, &s)?
        .into_iter()
        .filter_map(|(p, grant)| {
            let folders = &s.projects.get(&p.name)?.code_folders;
            (!folders.is_empty()).then(|| {
                json!({
                    "project": p.name,
                    "grant": grant.as_str(),
                    "codeFolders": folders,
                    "location": ids::project_base(&roots.notes, &s, &p.name).to_string_lossy(),
                })
            })
        })
        .collect();
    Ok(json!({
        "projects": projects,
        "settingsMtimeMs": super::mtime_ms(&roots.settings_file()),
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
