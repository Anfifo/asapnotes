//! Reading and writing `settings.json` from an explicit path.
//!
//! The app used to reach this file through `AppHandle`, which is exactly what
//! the helper binary cannot do. The hazard that makes this worth a module of
//! its own is that it fails *silently*: a helper resolving a different
//! `settings.json` than the app serves a different corpus and nothing looks
//! wrong — no error, no empty result, just a quietly different set of projects.
//! `doctor` on the helper prints the resolved file for that reason alone.

use super::Roots;
use crate::settings::{Project, Settings};
use serde_json::{Map, Value};
use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

/// The store this file absorbed: a name → absolute path map of linked projects.
const LEGACY_FILE: &str = "external_projects.json";

/// Loaded state. A parse failure keeps the caller running on shipped defaults
/// and carries the message, rather than letting one typo in a hand-editable
/// file take everything down; writes are refused while it is set, so the file
/// the user has to fix is never overwritten.
#[derive(Debug, Clone)]
pub struct Loaded {
    pub settings: Settings,
    pub error: Option<String>,
}

/// Write through a temporary file: this one file holds every project mapping,
/// so a half-written one must never be what survives.
pub fn write(path: &Path, settings: &Settings) -> Result<(), String> {
    let data = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, data).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}

/// Read the file, creating it — and migrating `external_projects.json` into it
/// — on first launch. The old file is removed only once the new one is safely
/// written.
pub fn load(roots: &Roots) -> Result<Loaded, String> {
    let path = roots.settings_file();
    fs::create_dir_all(&roots.data).map_err(|e| e.to_string())?;
    if path.exists() {
        let data = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        return Ok(match serde_json::from_str::<Settings>(&data) {
            Ok(mut settings) => {
                // A file still carrying a shipped registry verbatim is upgraded
                // to the current one; any hand-edit means the whole list
                // belongs to the user. A failed write only postpones this —
                // the in-memory upgrade already happened and will be retried.
                let registry = crate::settings::upgrade_registry(&mut settings);
                if crate::settings::upgrade_meeting_folder(&mut settings) || registry {
                    let _ = write(&path, &settings);
                }
                Loaded {
                    settings,
                    error: None,
                }
            }
            Err(e) => Loaded {
                settings: Settings::default(),
                error: Some(format!("settings.json: {e}")),
            },
        });
    }
    let mut settings = Settings::default();
    let legacy = roots.data.join(LEGACY_FILE);
    if legacy.exists() {
        let data = fs::read_to_string(&legacy).map_err(|e| e.to_string())?;
        let map: BTreeMap<String, String> =
            serde_json::from_str(&data).map_err(|e| format!("{LEGACY_FILE}: {e}"))?;
        for (name, path) in map {
            settings.projects.insert(
                name,
                Project {
                    path: Some(path),
                    ..Project::default()
                },
            );
        }
    }
    write(&path, &settings)?;
    let _ = fs::remove_file(&legacy);
    Ok(Loaded {
        settings,
        error: None,
    })
}

/// Settings as the raw document, for a caller that wants to hand it on
/// verbatim. Falls back to the serialized defaults when the file is missing, so
/// there is always something to show.
pub fn read_json(roots: &Roots) -> Result<Value, String> {
    let path = roots.settings_file();
    if !path.exists() {
        return serde_json::to_value(Settings::default()).map_err(|e| e.to_string());
    }
    let data = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&data).map_err(|e| format!("settings.json: {e}"))
}

/// RFC 7386 merge: objects merge recursively, `null` removes a key, and
/// anything else replaces. Chosen over a set-one-key-by-path tool because a
/// path syntax would be a second addressing scheme to specify and get wrong,
/// and because a merge patch is the shape a caller already has when it read the
/// document first.
pub fn merge_patch(target: &mut Value, patch: &Value) {
    let Some(fields) = patch.as_object() else {
        *target = patch.clone();
        return;
    };
    if !target.is_object() {
        *target = Value::Object(Map::new());
    }
    let map = target.as_object_mut().expect("just made an object");
    for (key, value) in fields {
        if value.is_null() {
            map.remove(key);
        } else {
            merge_patch(map.entry(key.clone()).or_insert(Value::Null), value);
        }
    }
}

/// Refuse a patch that would change what the sidecar is allowed to do.
///
/// This is the one rule that would be pointless anywhere else in the stack: a
/// tool that can widen its own grant has no grant. Named as a block rather than
/// checked field by field so that adding a key to `mcp` can never accidentally
/// leave a writable hole.
pub fn guard_mcp_block(patch: &Value) -> Result<(), String> {
    if patch.get("mcp").is_some() {
        return Err(
            "settings.mcp is not writable over MCP — it is what decides this tool's own \
             access. Change it in the app, or by hand in settings.json."
                .into(),
        );
    }
    Ok(())
}

/// Apply a patch to the settings document and write it. Returns the document
/// that landed.
///
/// Two checks before anything is written: the patch may not touch `mcp`, and
/// the result has to parse as [`Settings`] — so a patch that would leave the
/// app unable to read its own configuration is refused with the parse error
/// rather than written and discovered on next launch.
pub fn patch_settings(roots: &Roots, patch: &Value) -> Result<Value, String> {
    guard_mcp_block(patch)?;
    let mut next = read_json(roots)?;
    merge_patch(&mut next, patch);
    let mut parsed: Settings = serde_json::from_value(next.clone())
        .map_err(|e| format!("that patch doesn't leave valid settings: {e}"))?;
    crate::settings::upgrade_meeting_folder(&mut parsed);
    // Belt and braces against a future patch shape that slips `mcp` in some
    // other way: what is written must carry the block that was already there.
    let before = load(roots)?.settings;
    if parsed.mcp != before.mcp {
        return Err("that patch would change settings.mcp, which is not writable here".into());
    }
    write(&roots.settings_file(), &parsed)?;
    serde_json::to_value(&parsed).map_err(|e| e.to_string())
}
