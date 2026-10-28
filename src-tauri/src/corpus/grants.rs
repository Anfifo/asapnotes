//! Who may see and change what, over MCP.
//!
//! Three rules, and all three are here rather than in the server, because the
//! server is the untrusted half: it is a process an agent's client spawns, and
//! anything it enforces is enforcement an agent can route around by calling the
//! helper directly.
//!
//! 1. **A grant is per project**, `off` / `read` / `write`, re-read from
//!    `settings.json` on every call — a grant revoked in Settings must not stay
//!    open for the lifetime of a long-running agent process.
//! 2. **`off` means the project does not exist.** It is not listed, not
//!    searched, and a direct read of one of its notes gets the same "no such
//!    note" a nonexistent id gets. Refusing with "you lack permission for
//!    project X" would leak the project's name and existence; absent is absent.
//! 3. **The write scope can be pinned to one project.** With
//!    `mcp.writeScope: "current"`, writes land only in whatever project the app
//!    says is current — so an agent working on one thing cannot edit another.
//!
//! What an agent cannot do from here: change any of it. The toggles live in
//! `settings.json`, which the settings write tool refuses to touch under `mcp`
//! ([`crate::corpus::store::guard_mcp_block`]), and the current project comes
//! from a file only the app writes.

use super::ids::project_of;
use super::walk::{list_projects, ProjectInfo};
use super::Roots;
use crate::settings::{Mcp, Settings};
use serde::{Deserialize, Serialize};
use std::fmt;
use std::fs;
use std::path::Path;

/// The file the app keeps the current project in. Deliberately not
/// `settings.json`: this changes every time the user switches tab, and
/// configuration should not churn under a hand-editable file.
pub const STATE_FILE: &str = "mcp-state.json";

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Grant {
    Off,
    Read,
    Write,
}

impl Grant {
    /// Unknown strings read as `Off`. A typo in a hand-edited file must fail
    /// closed — the alternative is a misspelled `"raed"` silently granting
    /// whatever the default was.
    pub fn parse(value: &str) -> Grant {
        match value.trim().to_ascii_lowercase().as_str() {
            "read" => Grant::Read,
            "write" => Grant::Write,
            _ => Grant::Off,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Grant::Off => "off",
            Grant::Read => "read",
            Grant::Write => "write",
        }
    }

    pub fn can_read(self) -> bool {
        self >= Grant::Read
    }

    pub fn can_write(self) -> bool {
        self == Grant::Write
    }
}

/// The defaults, spelled out. They live here rather than beside the fields so
/// that "what a string means" has exactly one home — [`Grant::parse`] and these
/// four together are the entire policy.
impl Mcp {
    pub fn notes_root_grant(&self) -> Grant {
        self.notes_root.as_deref().map_or(Grant::Read, Grant::parse)
    }

    pub fn linked_grant(&self) -> Grant {
        self.linked.as_deref().map_or(Grant::Off, Grant::parse)
    }

    /// Anything other than an explicit `current` leaves writes unpinned — the
    /// pin is a thing the user turns on, so a typo must not turn it on.
    pub fn pinned_to_current(&self) -> bool {
        self.write_scope
            .as_deref()
            .is_some_and(|v| v.trim().eq_ignore_ascii_case("current"))
    }

    pub fn settings_grant(&self) -> Grant {
        self.settings.as_deref().map_or(Grant::Off, Grant::parse)
    }
}

/// State the app publishes for the sidecar: a file rather than a settings key,
/// because this changes every time the user switches tab and configuration
/// should not churn under a file the user hand-edits.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct State {
    /// Project of the note the app is currently on, `None` when the active tab
    /// belongs to no project (a top-level note, a lens, nothing open).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_project: Option<String>,
    /// The notes root **as the app resolved it**. The helper prefers this over
    /// its own guess, which is what keeps the two from silently disagreeing
    /// about which corpus they are serving.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes_root: Option<String>,
    /// The helper binary beside the running app, when it exists. Agent hooks
    /// read it here so they need no path configured.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub helper: Option<String>,
    pub updated_ms: u64,
}

pub fn read_state(roots: &Roots) -> State {
    // A missing or broken file means "the app never said" — which denies every
    // write under a `current` scope, the safe direction.
    fs::read_to_string(roots.data.join(STATE_FILE))
        .ok()
        .and_then(|d| serde_json::from_str(&d).ok())
        .unwrap_or_default()
}

pub fn write_state(roots: &Roots, state: &State) -> Result<(), String> {
    let data = serde_json::to_string_pretty(state).map_err(|e| e.to_string())?;
    fs::create_dir_all(&roots.data).map_err(|e| e.to_string())?;
    fs::write(roots.data.join(STATE_FILE), data).map_err(|e| e.to_string())
}

/// Publish where the app is: which project is current, the notes root this
/// process resolved, and the helper beside it. Called at launch and whenever
/// the active note changes project, so the helper never has to guess either one.
pub fn publish(
    roots: &Roots,
    current_project: Option<String>,
    helper: Option<&Path>,
) -> Result<(), String> {
    write_state(
        roots,
        &State {
            current_project,
            notes_root: Some(roots.notes.to_string_lossy().into_owned()),
            helper: helper
                .filter(|p| p.exists())
                .map(|p| p.to_string_lossy().into_owned()),
            updated_ms: super::now_ms(),
        },
    )
}

/// This project's grant. An explicit `mcp` on the project entry always wins;
/// otherwise the default depends on where the project lives, because those are
/// two different kinds of trust: the notes root is the app's own folder, while
/// a linked project is somebody's repository that the user pointed at.
pub fn grant_for(s: &Settings, project: Option<&str>) -> Grant {
    let Some(name) = project else {
        // Top-level notes: the notes root, so the notes-root default.
        return s.mcp.notes_root_grant();
    };
    let entry = s.projects.get(name);
    if let Some(explicit) = entry.and_then(|p| p.mcp.as_deref()) {
        return Grant::parse(explicit);
    }
    match entry.and_then(|p| p.path.as_deref()) {
        Some(_) => s.mcp.linked_grant(),
        None => s.mcp.notes_root_grant(),
    }
}

/// The grant on a note id, by the project its first segment names.
pub fn grant_for_note(s: &Settings, note: &str) -> Grant {
    grant_for(s, project_of(note))
}

/// Projects the sidecar can see at all, each with its grant. An `off` project
/// is not in this list — that is rule 2, and it is why listing is the only
/// place grants are computed for the whole set.
pub fn visible_projects(roots: &Roots, s: &Settings) -> Result<Vec<(ProjectInfo, Grant)>, String> {
    Ok(list_projects(roots, s)?
        .into_iter()
        .map(|p| {
            let grant = grant_for(s, Some(&p.name));
            (p, grant)
        })
        .filter(|(_, g)| g.can_read())
        .collect())
}

/// Why a call was refused. The distinction matters: [`Denied::Absent`] must be
/// reported as a missing note, and everything else says what it is.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Denied {
    /// The project is `off`. Say nothing about it existing.
    Absent { note: String },
    /// Readable, not writable.
    ReadOnly { project: String },
    /// Writes are pinned to another project.
    OutOfScope { wanted: String, current: String },
    /// Writes are pinned to the current project and the app hasn't named one.
    NoCurrentProject,
}

impl fmt::Display for Denied {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            // Identical to what a nonexistent id gets, on purpose.
            Denied::Absent { note } => write!(f, "no such note: {note}"),
            Denied::ReadOnly { project } => write!(
                f,
                "project \"{project}\" is read-only over MCP; set projects.{project}.mcp to \
                 \"write\" in settings.json to allow edits"
            ),
            Denied::OutOfScope { wanted, current } => write!(
                f,
                "writes are pinned to the current project \"{current}\", so \"{wanted}\" is \
                 out of scope; the pin is mcp.writeScope in settings.json"
            ),
            Denied::NoCurrentProject => write!(
                f,
                "writes are pinned to the current project, but the app hasn't named one — \
                 open a note in the project you want to write to, or set mcp.writeScope to \"any\""
            ),
        }
    }
}

/// May this note be read? `Err` is always [`Denied::Absent`] here — a project
/// that is off has no other answer.
pub fn check_read(s: &Settings, note: &str) -> Result<(), Denied> {
    if grant_for_note(s, note).can_read() {
        Ok(())
    } else {
        Err(Denied::Absent {
            note: note.to_string(),
        })
    }
}

/// May this note be written? Grant first, then the scope pin — in that order,
/// so an `off` project still answers "no such note" rather than admitting it
/// exists but is out of scope.
pub fn check_write(s: &Settings, state: &State, note: &str) -> Result<(), Denied> {
    let project = project_of(note);
    let grant = grant_for(s, project);
    if !grant.can_read() {
        return Err(Denied::Absent {
            note: note.to_string(),
        });
    }
    if !grant.can_write() {
        return Err(Denied::ReadOnly {
            project: project.unwrap_or("(notes root)").to_string(),
        });
    }
    if !s.mcp.pinned_to_current() {
        return Ok(());
    }
    match (&state.current_project, project) {
        (None, _) => Err(Denied::NoCurrentProject),
        (Some(current), Some(wanted)) if current == wanted => Ok(()),
        // A top-level note belongs to no project, so it can never be the
        // current one — under a pin it is always out of scope.
        (Some(current), wanted) => Err(Denied::OutOfScope {
            wanted: wanted.unwrap_or("(notes root)").to_string(),
            current: current.clone(),
        }),
    }
}
