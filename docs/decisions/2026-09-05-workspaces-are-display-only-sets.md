# Workspaces are display-only sets of projects

- Date: 2026-09-05
- Status: Built (the app, Settings, and an explicit scope over MCP)

## Context

Some projects belong together and others do not, and on 2026-08-19 that was written down
as "project layers": a named grouping over projects that is not a folder. Two surfaces
would consume it. The explorer would group project headings by it, and the MCP grant could
take a layer as the unit of access, with a `writeScope: "layer"` beside the current-project
pin. The open questions were whether a project sits in more than one layer, whether layers
nest, where they live, and whether id resolution knows about them. The last was the hinge:
a display grouping is cheap and reversible, and one that note ids depend on is neither. The
idea shipped under the name workspace, which `project-model.md` had reserved for a future
sync unit; that unit is now called a library.

## Decision

**A workspace is a named set of projects and nothing more.** `settings.json` holds
`workspaces` (name to project names) and `currentWorkspace`. They live in the personal
file because the grouping is the person's own. "Default" is every
project, implicit, and refused as a name. A project can sit in any number of sets, and sets
do not nest. Nothing on disk moves and no id changes. Project names are not checked against
the registry, so a project that is unlinked and comes back returns to its sets. A project
created or scanned in while a workspace is on joins it, so it does not vanish the moment it
exists.

**Switching filters what the window shows.** The explorer's project headings, the
palette's note list, search hits and the changes ledger follow the current workspace.
Capture, top-level notes (which belong to every workspace) and the MCP grants do not. The
switcher is a chip before the File menu; Settings > Workspaces edits the table with every
project as a toggle; a project heading's right-click adds it to or removes it from the
current set.

**The sidecar sees workspaces only when asked.** `list_workspaces` reports the sets and
which one the app is on, and `list_projects`, `list_notes`, `find_notes` and
`search_notes` take an optional `workspace`. The filter runs in the helper after the
grants, so a workspace naming an `off` project neither shows it nor names it. "Default"
means everything, an unknown name lists the ones that exist, and `doctor` reports
`currentWorkspace`.

Following the app's current workspace by default was considered. An implicit scope is how
an agent concludes a note does not exist, and the sidecar runs with the app closed, so
"current" would come from the file and could disagree with the screen. A `"current"`
shorthand was dropped with it.

**Access stays per project.** Grants live on the project entry and the write pin stays on
the current project. Granting by set and a `writeScope` over a set were the other half of
the layers idea; neither is built, and both remain open work.

## Links

- [Workspace / project model](../project-model.md), "The workspace level": the model as
  built, and the library rename.
- [MCP tool surface](../mcp-tool-surface.md), "Workspaces (2026-09-05)": the scope and the
  rejected default.
- [`src-tauri/src/settings.rs`](../../src-tauri/src/settings.rs): `workspaces`,
  `current_workspace`, `set_workspaces`, `set_current_workspace`.
- [Config splits by trust](2026-08-10-config-splits-by-trust.md): why personal grouping
  lives in app data.
