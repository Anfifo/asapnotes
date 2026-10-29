//! Tests for the corpus core.
//!
//! These run against a real temp corpus rather than a live app: the access
//! boundary, the id resolution and the walks are the rules worth pinning.

use super::testing::Fixture;
use super::*;
use crate::settings::{Mcp, Mount, Project, Settings};
use serde_json::json;

fn with_projects(entries: Vec<(&str, Project)>) -> Settings {
    let mut s = Settings::default();
    for (name, p) in entries {
        s.projects.insert(name.to_string(), p);
    }
    s
}

// ---------------------------------------------------------------- boundary

/// The core is shared with a binary that has no Tauri in it. A `tauri` import
/// here would compile fine today and break the helper the moment it reached
/// that code path, so the boundary is checked rather than trusted.
#[test]
fn no_tauri_in_the_core() {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/corpus");
    let mut offenders = Vec::new();
    for entry in std::fs::read_dir(&dir).expect("corpus dir") {
        let path = entry.expect("entry").path();
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or_default();
        // This file and its fixtures are `#[cfg(test)]`: never compiled into
        // the helper, and this one necessarily contains the word it looks for.
        if path.extension().and_then(|e| e.to_str()) != Some("rs")
            || name == "tests.rs"
            || name == "testing.rs"
        {
            continue;
        }
        let source = std::fs::read_to_string(&path).expect("read source");
        let code = source
            .lines()
            .filter(|l| !l.trim_start().starts_with("//"))
            .collect::<Vec<_>>()
            .join("\n");
        if code.contains("tauri") {
            offenders.push(path.display().to_string());
        }
    }
    assert!(
        offenders.is_empty(),
        "the corpus core must not depend on Tauri, but these do: {offenders:?}"
    );
}

// ---------------------------------------------------------------- sections

const DOC: &str = "\
preamble line

# Design

design body

## Decisions

first decision

### Detail

detail body

## Notes

notes body

# Other

other body
";

#[test]
fn outline_paths_carry_their_ancestors() {
    let headings = sections::outline(DOC);
    let paths: Vec<&str> = headings.iter().map(|h| h.path.as_str()).collect();
    assert_eq!(
        paths,
        vec![
            "Design",
            "Design/Decisions",
            "Design/Decisions/Detail",
            "Design/Notes",
            "Other"
        ]
    );
    assert_eq!(headings[0].depth, 1);
    assert_eq!(headings[2].depth, 3);
}

#[test]
fn a_section_runs_to_the_next_same_or_shallower_heading() {
    let headings = sections::outline(DOC);
    let decisions = &headings[1];
    let text = &DOC[decisions.start..decisions.end];
    // It contains its subsection…
    assert!(text.contains("### Detail"));
    assert!(text.contains("detail body"));
    // …and stops at the next level-2.
    assert!(!text.contains("## Notes"));
}

#[test]
fn the_preamble_is_addressable_as_the_empty_path() {
    let section = sections::resolve(DOC, "").expect("preamble resolves");
    assert_eq!(section.path, "");
    assert_eq!(section.text(DOC).trim(), "preamble line");
}

#[test]
fn a_note_with_no_headings_is_all_preamble() {
    let doc = "just some text\nand more\n";
    let section = sections::resolve(doc, "").expect("preamble");
    assert_eq!(section.text(doc), doc);
    assert!(sections::outline(doc).is_empty());
}

#[test]
fn a_path_tail_disambiguates_and_a_bare_name_that_is_unique_still_works() {
    assert_eq!(
        sections::resolve(DOC, "Decisions").expect("unique").path,
        "Design/Decisions"
    );
    assert_eq!(
        sections::resolve(DOC, "Design/Decisions")
            .expect("full path")
            .path,
        "Design/Decisions"
    );
    // Case-insensitive, per the addressing rule.
    assert_eq!(
        sections::resolve(DOC, "dEsIgN/dEcIsIoNs")
            .expect("case-insensitive")
            .path,
        "Design/Decisions"
    );
}

#[test]
fn a_tail_must_cut_at_a_segment_boundary() {
    // "isions" is a suffix of the string but not of the path.
    assert!(sections::resolve(DOC, "isions").is_err());
    // And a non-contiguous ancestor is not a tail.
    assert!(sections::resolve(DOC, "Design/Detail").is_err());
}

#[test]
fn ambiguity_is_an_error_that_names_the_candidates() {
    let doc = "# A\n## Notes\nx\n# B\n## Notes\ny\n";
    let err = sections::resolve(doc, "Notes").expect_err("two candidates");
    assert!(matches!(err, sections::SectionError::Ambiguous { .. }));
    assert_eq!(err.candidates(), &["A/Notes".to_string(), "B/Notes".into()]);
    // Naming the parent resolves it.
    assert_eq!(
        sections::resolve(doc, "B/Notes").expect("named").path,
        "B/Notes"
    );
}

#[test]
fn a_miss_lists_what_the_note_does_have() {
    let err = sections::resolve(DOC, "Nonexistent").expect_err("no such section");
    assert!(matches!(err, sections::SectionError::NotFound { .. }));
    assert!(err.candidates().contains(&"Design/Notes".to_string()));
    assert!(err.to_string().contains("Design/Decisions"));
}

#[test]
fn a_hash_inside_a_fence_is_not_a_heading() {
    let doc = "\
# Real

```
# not a heading
```

~~~md
## also not one
~~~

## Also Real
";
    let paths: Vec<String> = sections::outline(doc).into_iter().map(|h| h.path).collect();
    assert_eq!(paths, ["Real", "Real/Also Real"]);
}

#[test]
fn a_longer_fence_run_survives_a_shorter_one_inside_it() {
    let doc = "# A\n````\n```\n# hidden\n```\n````\n# B\n";
    let paths: Vec<String> = sections::outline(doc).into_iter().map(|h| h.path).collect();
    assert_eq!(paths, ["A", "B"]);
}

#[test]
fn atx_edge_cases() {
    let doc = "\
#hashtag not a heading

# Trailing hashes ##

####### seven is too many

###### six is fine
";
    let headings = sections::outline(doc);
    let paths: Vec<&str> = headings.iter().map(|h| h.path.as_str()).collect();
    assert_eq!(
        paths,
        vec!["Trailing hashes", "Trailing hashes/six is fine"]
    );
    assert_eq!(headings[1].depth, 6);
}

#[test]
fn heading_at_names_the_innermost_section_a_line_falls_in() {
    let headings = sections::outline(DOC);
    // Line 1 is the preamble.
    assert_eq!(sections::heading_at(&headings, 1), "");
    let detail_line = DOC.lines().position(|l| l == "detail body").expect("line") as u32 + 1;
    assert_eq!(
        sections::heading_at(&headings, detail_line),
        "Design/Decisions/Detail"
    );
}

// -------------------------------------------------------------------- ids

#[test]
fn ids_that_could_escape_their_base_are_refused() {
    let f = Fixture::new("ids");
    let s = Settings::default();
    for bad in [
        "../outside.md",
        "..\\outside.md",
        "project\\note.md",
        ".hidden.md",
        ".config/note.md",
        "assets/pasted.md",
        "",
        "note.rs",
    ] {
        assert!(
            ids::checked_name(&f.roots, &s, bad).is_err(),
            "should have refused {bad:?}"
        );
    }
    assert!(ids::checked_name(&f.roots, &s, "note.md").is_ok());
    assert!(ids::checked_name(&f.roots, &s, "project/sub/note.md").is_ok());
    // `assets` is only reserved at the top level.
    assert!(ids::checked_name(&f.roots, &s, "project/assets/note.md").is_ok());
}

#[test]
fn an_id_deeper_than_the_limit_is_refused() {
    let f = Fixture::new("depth");
    let s = Settings::default();
    let ok = format!("{}note.md", "a/".repeat(ids::MAX_DEPTH as usize - 1));
    let too_deep = format!("{}note.md", "a/".repeat(ids::MAX_DEPTH as usize));
    assert!(ids::checked_name(&f.roots, &s, &ok).is_ok());
    assert!(ids::checked_name(&f.roots, &s, &too_deep).is_err());
}

#[test]
fn a_project_files_rule_can_make_a_file_a_note() {
    let f = Fixture::new("reinclude");
    let dir = f.roots.notes.join("code");
    std::fs::create_dir_all(&dir).expect("project dir");
    std::fs::write(
        dir.join(".asapnotes.json"),
        r#"{"files": ["!src/**/*.rs"]}"#,
    )
    .expect("config");
    let s = Settings::default();
    assert!(!s.is_note("main.rs"));
    // The rule pulls it past the registry allowlist…
    assert!(ids::checked_name(&f.roots, &s, "code/src/main.rs").is_ok());
    // …but not somewhere the rule doesn't reach, and never an executable type.
    assert!(ids::checked_name(&f.roots, &s, "code/other/main.rs").is_err());
    assert!(ids::checked_name(&f.roots, &s, "code/src/tool.exe").is_err());
}

#[test]
fn an_id_lands_in_its_project_its_mount_or_the_notes_root() {
    let f = Fixture::new("resolve");
    let linked = f.outside("linked");
    let mounted = f.outside("mounted");
    let deeper = f.outside("deeper");
    let s = with_projects(vec![
        (
            "linked",
            Project {
                path: Some(linked.to_string_lossy().into_owned()),
                mounts: vec![
                    Mount {
                        at: "docs".into(),
                        path: mounted.to_string_lossy().into_owned(),
                    },
                    Mount {
                        at: "docs/deep".into(),
                        path: deeper.to_string_lossy().into_owned(),
                    },
                ],
                ..Project::default()
            },
        ),
        ("plain", Project::default()),
    ]);

    // A top-level note, and a project with no entry at all: the notes root.
    assert_eq!(
        ids::base_of(&f.roots, &s, "loose.md"),
        (f.roots.notes.clone(), "loose.md")
    );
    assert_eq!(
        ids::base_of(&f.roots, &s, "unregistered/note.md"),
        (f.roots.notes.clone(), "unregistered/note.md")
    );
    // A registered project with no path still lives under the notes root.
    assert_eq!(
        ids::base_of(&f.roots, &s, "plain/note.md"),
        (f.roots.notes.join("plain"), "note.md")
    );
    // A located project.
    assert_eq!(
        ids::base_of(&f.roots, &s, "linked/note.md"),
        (linked.clone(), "note.md")
    );
    // Its mount…
    assert_eq!(
        ids::base_of(&f.roots, &s, "linked/docs/note.md"),
        (mounted.clone(), "note.md")
    );
    // …and the deepest mount point wins, which is the rule the frontend's
    // inverse also reads. Two readers disagreeing here gives one file two ids.
    assert_eq!(
        ids::base_of(&f.roots, &s, "linked/docs/deep/note.md"),
        (deeper.clone(), "note.md")
    );
}

#[test]
fn a_real_folder_shadows_a_mount_of_the_same_name() {
    let f = Fixture::new("conflict");
    let linked = f.outside("linked");
    let mounted = f.outside("mounted");
    // The project has a real `docs` folder, so its mount is inert: a file that
    // exists on disk must never be invisible behind a mount.
    std::fs::create_dir_all(linked.join("docs")).expect("real docs");
    let s = with_projects(vec![(
        "linked",
        Project {
            path: Some(linked.to_string_lossy().into_owned()),
            mounts: vec![Mount {
                at: "docs".into(),
                path: mounted.to_string_lossy().into_owned(),
            }],
            ..Project::default()
        },
    )]);
    assert_eq!(
        ids::base_of(&f.roots, &s, "linked/docs/note.md"),
        (linked.clone(), "docs/note.md")
    );
}

/// What the virtual/real conversion rests on: a folder converted **in place**
/// keeps its name, and a name is what an id is made of — so the same id is
/// valid and resolves to the files in both shapes. That is why
/// `folder_to_real`/`folder_to_virtual` move no drafts, no history and no tabs.
/// Convert to a *different* name and this stops being true.
#[test]
fn converting_a_folder_in_place_keeps_every_id() {
    let f = Fixture::new("convert");
    let mounted = f.outside("mounted");
    let id = "work/docs/note.md";

    // Virtual: `work/docs` is a mount, so the id lands in the backing folder.
    let virtual_s = with_projects(vec![(
        "work",
        Project {
            mounts: vec![Mount {
                at: "docs".into(),
                path: mounted.to_string_lossy().into_owned(),
            }],
            ..Project::default()
        },
    )]);
    assert_eq!(
        ids::resolve(&f.roots, &virtual_s, id),
        Ok(mounted.join("note.md"))
    );

    // Real: the conversion moved the files into the project and dropped the
    // mount. Same id string, still admitted, now landing on the moved file.
    std::fs::create_dir_all(f.roots.notes.join("work/docs")).expect("real docs");
    let real_s = with_projects(vec![("work", Project::default())]);
    assert_eq!(
        ids::resolve(&f.roots, &real_s, id),
        Ok(f.roots.notes.join("work/docs/note.md"))
    );
}

#[test]
fn project_of_reads_the_first_segment() {
    assert_eq!(ids::project_of("loose.md"), None);
    assert_eq!(ids::project_of("work/note.md"), Some("work"));
    assert_eq!(ids::project_of("work/sub/note.md"), Some("work"));
}

// ------------------------------------------------------------------- walk

#[test]
fn the_walk_lists_notes_and_skips_what_is_not_one() {
    let f = Fixture::new("walk");
    f.note("loose.md", "x");
    f.note("work/note.md", "x");
    f.note("work/sub/deep.md", "x");
    f.note("work/main.rs", "x");
    f.note("work/data.json", "x");
    f.note(".hidden.md", "x");
    let s = Settings::default();
    let names: Vec<String> = walk::list_notes(&f.roots, &s, true)
        .expect("walk")
        .into_iter()
        .map(|f| f.name)
        .collect();
    assert!(names.contains(&"loose.md".to_string()));
    assert!(names.contains(&"work/note.md".to_string()));
    // Not a note type at all.
    assert!(!names.contains(&"work/main.rs".to_string()));
    // A note type, but one that doesn't ask to be listed.
    assert!(!names.contains(&"work/data.json".to_string()));
    assert!(!names.iter().any(|n| n.starts_with('.')));
    // A project's own folders are part of it, wherever the project lives. The
    // depth split is between the shallow first-paint pass and this one, not
    // between a notes-root project and a registered one — see
    // `the_shallow_walk_stops_one_folder_in_and_the_deep_one_does_not`.
    assert!(names.contains(&"work/sub/deep.md".to_string()));
}

#[test]
fn a_linked_project_walks_deep_and_respects_its_files_rules() {
    let f = Fixture::new("deep");
    let dir = f.outside("repo");
    f.file(&dir, "top.md", "x");
    f.file(&dir, "docs/guide.md", "x");
    f.file(&dir, "docs/private/secret.md", "x");
    f.file(&dir, "node_modules/pkg/readme.md", "x");
    f.file(&dir, ".asapnotes.json", r#"{"files": ["docs/private/"]}"#);
    let s = with_projects(vec![(
        "repo",
        Project {
            path: Some(dir.to_string_lossy().into_owned()),
            ..Project::default()
        },
    )]);
    let names: Vec<String> = walk::list_notes(&f.roots, &s, true)
        .expect("walk")
        .into_iter()
        .map(|f| f.name)
        .collect();
    assert!(names.contains(&"repo/top.md".to_string()));
    assert!(names.contains(&"repo/docs/guide.md".to_string()));
    // Excluded by the project's own rules — an access boundary, not a filter.
    assert!(!names.contains(&"repo/docs/private/secret.md".to_string()));
    // Never walked at all.
    assert!(!names.iter().any(|n| n.contains("node_modules")));
}

#[test]
fn a_shallow_walk_skips_the_folders_outside_the_notes_root() {
    let f = Fixture::new("shallow");
    let dir = f.outside("repo");
    f.file(&dir, "top.md", "x");
    f.note("loose.md", "x");
    let s = with_projects(vec![(
        "repo",
        Project {
            path: Some(dir.to_string_lossy().into_owned()),
            ..Project::default()
        },
    )]);
    let shallow: Vec<String> = walk::list_notes(&f.roots, &s, false)
        .expect("walk")
        .into_iter()
        .map(|f| f.name)
        .collect();
    assert_eq!(shallow, vec!["loose.md".to_string()]);
}

#[test]
fn the_shallow_walk_stops_one_folder_in_and_the_deep_one_does_not() {
    // What `deep` costs and buys, in one place. The shallow pass is the first
    // paint: a project's own notes, nothing below them. Anything that has to be
    // complete — search, the note-id map, the sidecar — takes the deep one.
    let f = Fixture::new("depths");
    f.note("top/note.md", "x");
    f.note("top/decisions/2026-08-20-a-choice.md", "x");
    f.note("top/deeper/still/here.md", "x");
    let s = Settings::default();

    let names = |deep: bool| {
        let mut out: Vec<String> = walk::list_notes(&f.roots, &s, deep)
            .expect("walk")
            .into_iter()
            .map(|f| f.name)
            .collect();
        out.sort();
        out
    };
    assert_eq!(names(false), vec!["top/note.md".to_string()]);
    assert_eq!(
        names(true),
        vec![
            "top/decisions/2026-08-20-a-choice.md".to_string(),
            "top/deeper/still/here.md".to_string(),
            "top/note.md".to_string(),
        ]
    );
    // The id map behind search is always the complete one.
    let mapped: Vec<String> = walk::note_paths(&f.roots, &s)
        .expect("paths")
        .into_iter()
        .map(|(id, _)| id)
        .collect();
    assert!(mapped.contains(&"top/deeper/still/here.md".to_string()));
}

#[test]
fn a_missing_linked_folder_is_listed_as_a_missing_project() {
    let f = Fixture::new("missing");
    f.note("here/note.md", "x");
    let s = with_projects(vec![(
        "gone",
        Project {
            path: Some(
                f.outside("nothing")
                    .join("removed")
                    .to_string_lossy()
                    .into_owned(),
            ),
            ..Project::default()
        },
    )]);
    let projects = walk::list_projects(&f.roots, &s).expect("projects");
    let gone = projects.iter().find(|p| p.name == "gone").expect("listed");
    assert!(gone.missing);
    let here = projects.iter().find(|p| p.name == "here").expect("listed");
    assert!(!here.missing);
}

// ----------------------------------------------------------------- search

fn search_fixture() -> (Fixture, Settings) {
    let f = Fixture::new("search");
    f.note(
        "work/meeting.md",
        "# Meeting\n\n## Actions\n\nship the widget\nship it twice\n",
    );
    f.note("work/other.md", "nothing to see\n");
    f.note("personal/diary.md", "# Diary\n\nShip a boat today\n");
    (f, Settings::default())
}

#[test]
fn search_is_case_insensitive_and_says_where_it_landed() {
    let (f, s) = search_fixture();
    let mut q = search::Query::new("SHIP");
    q.sections = true;
    let hits = search::search(&f.roots, &s, &q, None).expect("search");
    assert_eq!(hits.len(), 3);
    let action = hits
        .iter()
        .find(|h| h.text == "ship the widget")
        .expect("found");
    assert_eq!(action.note, "work/meeting.md");
    assert_eq!(action.section.as_deref(), Some("Meeting/Actions"));
    let diary = hits
        .iter()
        .find(|h| h.note == "personal/diary.md")
        .expect("found");
    // A line under a heading with no sub-structure still names its section.
    assert_eq!(diary.section.as_deref(), Some("Diary"));
}

#[test]
fn a_project_filter_keeps_the_search_inside_it() {
    let (f, s) = search_fixture();
    let mut q = search::Query::new("ship");
    q.project = Some("work".into());
    let hits = search::search(&f.roots, &s, &q, None).expect("search");
    assert_eq!(hits.len(), 2);
    assert!(hits.iter().all(|h| h.note.starts_with("work/")));
}

#[test]
fn caps_bound_the_result_both_ways() {
    let (f, s) = search_fixture();
    let mut q = search::Query::new("ship");
    q.per_note = Some(1);
    assert_eq!(
        search::search(&f.roots, &s, &q, None)
            .expect("search")
            .len(),
        2
    );
    let mut q = search::Query::new("ship");
    q.limit = 1;
    assert_eq!(
        search::search(&f.roots, &s, &q, None)
            .expect("search")
            .len(),
        1
    );
}

#[test]
fn an_empty_query_finds_nothing_rather_than_everything() {
    let (f, s) = search_fixture();
    assert!(
        search::search(&f.roots, &s, &search::Query::new("   "), None)
            .expect("search")
            .is_empty()
    );
    assert!(search::find_notes(&f.roots, &s, "  ", 10, None)
        .expect("find")
        .is_empty());
}

#[test]
fn find_notes_ranks_the_file_name_above_the_folder_it_sits_in() {
    let f = Fixture::new("find");
    f.note("meeting/notes.md", "x");
    f.note("work/meeting.md", "x");
    f.note("work/meeting-2026.md", "x");
    let s = Settings::default();
    let found: Vec<String> = search::find_notes(&f.roots, &s, "meeting", 10, None)
        .expect("find")
        .into_iter()
        .map(|f| f.name)
        .collect();
    // Exact stem first, then a partial file-name match, then the folder match.
    assert_eq!(found[0], "work/meeting.md");
    assert_eq!(found[1], "work/meeting-2026.md");
    assert_eq!(found[2], "meeting/notes.md");
}

// ----------------------------------------------------------------- grants

fn granted(mcp: Option<&str>, located: bool, home: &std::path::Path) -> Project {
    Project {
        path: located.then(|| home.to_string_lossy().into_owned()),
        mcp: mcp.map(str::to_string),
        ..Project::default()
    }
}

#[test]
fn the_defaults_split_on_where_a_project_lives() {
    let f = Fixture::new("grant-defaults");
    let dir = f.outside("repo");
    let s = with_projects(vec![
        ("inroot", granted(None, false, &dir)),
        ("linked", granted(None, true, &dir)),
    ]);
    // The notes root is the app's own folder: readable, not writable.
    assert_eq!(grants::grant_for(&s, Some("inroot")), grants::Grant::Read);
    // A top-level note takes the same default.
    assert_eq!(grants::grant_for(&s, None), grants::Grant::Read);
    // A linked project is somebody's repository: absent entirely.
    assert_eq!(grants::grant_for(&s, Some("linked")), grants::Grant::Off);
}

#[test]
fn an_explicit_grant_wins_and_a_typo_fails_closed() {
    let f = Fixture::new("grant-explicit");
    let dir = f.outside("repo");
    let s = with_projects(vec![
        ("open", granted(Some("write"), true, &dir)),
        ("shut", granted(Some("off"), false, &dir)),
        ("typo", granted(Some("raed"), false, &dir)),
    ]);
    assert_eq!(grants::grant_for(&s, Some("open")), grants::Grant::Write);
    assert_eq!(grants::grant_for(&s, Some("shut")), grants::Grant::Off);
    // A misspelling must not silently inherit the permissive default.
    assert_eq!(grants::grant_for(&s, Some("typo")), grants::Grant::Off);
}

#[test]
fn the_global_defaults_are_settable() {
    let mut s = Settings {
        mcp: Mcp {
            notes_root: Some("write".into()),
            linked: Some("read".into()),
            ..Mcp::default()
        },
        ..Settings::default()
    };
    assert_eq!(grants::grant_for(&s, None), grants::Grant::Write);
    let f = Fixture::new("grant-global");
    let dir = f.outside("repo");
    s.projects
        .insert("linked".into(), granted(None, true, &dir));
    assert_eq!(grants::grant_for(&s, Some("linked")), grants::Grant::Read);
}

#[test]
fn an_off_project_does_not_exist_to_the_sidecar() {
    let f = Fixture::new("grant-absent");
    let dir = f.outside("secret");
    f.note("open/note.md", "x");
    f.file(&dir, "note.md", "x");
    let s = with_projects(vec![("secret", granted(Some("off"), true, &dir))]);

    // Not listed…
    let visible = grants::visible_projects(&f.roots, &s).expect("visible");
    assert!(visible.iter().any(|(p, _)| p.name == "open"));
    assert!(!visible.iter().any(|(p, _)| p.name == "secret"));

    // …and a direct read gets what a nonexistent id gets, word for word, so
    // the refusal can't be used to probe for the project's existence.
    let denied = grants::check_read(&s, "secret/note.md").expect_err("refused");
    assert_eq!(denied.to_string(), "no such note: secret/note.md");
    assert_eq!(
        grants::check_read(&s, "secret/nothing-here.md")
            .expect_err("refused")
            .to_string(),
        "no such note: secret/nothing-here.md"
    );
}

#[test]
fn a_read_grant_refuses_writes_and_says_so() {
    let f = Fixture::new("grant-readonly");
    let dir = f.outside("repo");
    let s = with_projects(vec![("repo", granted(Some("read"), true, &dir))]);
    let state = grants::State::default();
    assert!(grants::check_read(&s, "repo/note.md").is_ok());
    let denied = grants::check_write(&s, &state, "repo/note.md").expect_err("refused");
    assert!(matches!(denied, grants::Denied::ReadOnly { .. }));
    // This one names the project: that it exists is already known to the caller.
    assert!(denied.to_string().contains("repo"));
}

#[test]
fn the_write_scope_can_be_pinned_to_the_current_project() {
    let f = Fixture::new("grant-scope");
    let dir = f.outside("repo");
    let mut s = with_projects(vec![
        ("here", granted(Some("write"), false, &dir)),
        ("there", granted(Some("write"), false, &dir)),
    ]);
    let unpinned = grants::State::default();

    // Unpinned, both are writable.
    assert!(grants::check_write(&s, &unpinned, "here/note.md").is_ok());
    assert!(grants::check_write(&s, &unpinned, "there/note.md").is_ok());

    s.mcp.write_scope = Some("current".into());
    // Pinned with nothing current: everything is refused, which is the safe
    // direction for a missing or unreadable state file.
    assert!(matches!(
        grants::check_write(&s, &unpinned, "here/note.md"),
        Err(grants::Denied::NoCurrentProject)
    ));

    let pinned = grants::State {
        current_project: Some("here".into()),
        ..Default::default()
    };
    assert!(grants::check_write(&s, &pinned, "here/note.md").is_ok());
    let denied = grants::check_write(&s, &pinned, "there/note.md").expect_err("out of scope");
    assert!(matches!(denied, grants::Denied::OutOfScope { .. }));
    // A top-level note belongs to no project, so it can never be the current
    // one — under a pin it is out of scope too.
    assert!(grants::check_write(&s, &pinned, "loose.md").is_err());
}

#[test]
fn a_pin_never_widens_a_grant() {
    let f = Fixture::new("grant-scope-order");
    let dir = f.outside("repo");
    let mut s = with_projects(vec![("shut", granted(Some("off"), true, &dir))]);
    s.mcp.write_scope = Some("current".into());
    let pinned = grants::State {
        current_project: Some("shut".into()),
        ..Default::default()
    };
    // Being the current project does not make an `off` project writable, and
    // the refusal still says nothing about it existing.
    let denied = grants::check_write(&s, &pinned, "shut/note.md").expect_err("refused");
    assert_eq!(denied.to_string(), "no such note: shut/note.md");
}

#[test]
fn the_state_file_round_trips_and_a_broken_one_reads_as_nothing_current() {
    let f = Fixture::new("state");
    assert_eq!(f.state().current_project, None);
    f.set_current(Some("work"));
    assert_eq!(f.state().current_project.as_deref(), Some("work"));
    std::fs::write(f.roots.data.join(grants::STATE_FILE), "{ not json").expect("corrupt");
    assert_eq!(f.state().current_project, None);
}

// ------------------------------------------------------------------ edits

fn writable() -> (Fixture, Settings, grants::State) {
    let f = Fixture::new("edits");
    let mut s = Settings::default();
    s.mcp.notes_root = Some("write".into());
    (f, s, grants::State::default())
}

#[test]
fn write_section_replaces_the_body_and_keeps_the_heading() {
    let (f, s, state) = writable();
    f.note("work/note.md", DOC);
    let result = edits::write_section(
        &f.roots,
        &s,
        &state,
        "work/note.md",
        "Decisions",
        "we decided otherwise",
        None,
    )
    .expect("write");
    assert_eq!(result.section, "Design/Decisions");
    assert!(result.replaced.contains("first decision"));
    let after = f.read("work/note.md");
    assert!(after.contains("## Decisions\n\nwe decided otherwise\n"));
    // The extent covered the subsection, so it went with it…
    assert!(!after.contains("### Detail"));
    // …and everything outside the extent is untouched.
    assert!(after.starts_with("preamble line"));
    assert!(after.contains("## Notes\n\nnotes body"));
    assert!(after.contains("# Other"));
}

#[test]
fn a_replaced_section_keeps_a_blank_line_before_what_follows() {
    let (f, s, state) = writable();
    f.note("n.md", "# A\n\nold\n\n# B\n\nb body\n");
    edits::write_section(&f.roots, &s, &state, "n.md", "A", "new", None).expect("write");
    assert_eq!(f.read("n.md"), "# A\n\nnew\n\n# B\n\nb body\n");
}

#[test]
fn the_preamble_can_be_written_without_touching_the_headings() {
    let (f, s, state) = writable();
    f.note("n.md", "old intro\n\n# A\n\nbody\n");
    edits::write_section(&f.roots, &s, &state, "n.md", "", "new intro", None).expect("write");
    assert_eq!(f.read("n.md"), "new intro\n\n# A\n\nbody\n");
}

#[test]
fn an_ambiguous_section_refuses_the_write_rather_than_guessing() {
    let (f, s, state) = writable();
    let doc = "# A\n## Notes\nx\n# B\n## Notes\ny\n";
    f.note("n.md", doc);
    let err = edits::write_section(&f.roots, &s, &state, "n.md", "Notes", "z", None)
        .expect_err("ambiguous");
    assert!(err.contains("A/Notes") && err.contains("B/Notes"));
    // Nothing was written.
    assert_eq!(f.read("n.md"), doc);
}

#[test]
fn expect_unchanged_refuses_a_write_over_a_file_that_moved() {
    let (f, s, state) = writable();
    f.note("n.md", "# A\n\nbody\n");
    let stale_mtime = 1;
    let err = edits::write_section(&f.roots, &s, &state, "n.md", "A", "new", Some(stale_mtime))
        .expect_err("stale");
    assert!(err.contains("changed since you read it"));
    assert_eq!(f.read("n.md"), "# A\n\nbody\n");

    // The mtime a read hands back is the one that works.
    let current = mtime_ms(&f.roots.notes.join("n.md")).expect("mtime");
    edits::write_section(&f.roots, &s, &state, "n.md", "A", "new", Some(current))
        .expect("fresh mtime");
    assert!(f.read("n.md").contains("new"));
}

#[test]
fn append_lands_at_the_end_of_the_note_or_the_end_of_a_section() {
    let (f, s, state) = writable();
    f.note("n.md", "# A\n\na body\n\n# B\n\nb body\n");
    edits::append(&f.roots, &s, &state, "n.md", "added to A", Some("A"), None)
        .expect("append to section");
    let after = f.read("n.md");
    assert_eq!(after, "# A\n\na body\n\nadded to A\n\n# B\n\nb body\n");

    edits::append(&f.roots, &s, &state, "n.md", "at the end", None, None).expect("append to note");
    assert!(f.read("n.md").ends_with("b body\n\nat the end\n"));
}

#[test]
fn append_creates_a_note_that_does_not_exist_yet() {
    let (f, s, state) = writable();
    let result = edits::append(
        &f.roots,
        &s,
        &state,
        "work/new/meeting.md",
        "# Meeting\n\nnotes",
        None,
        None,
    )
    .expect("create");
    assert!(result.created);
    assert_eq!(f.read("work/new/meeting.md"), "# Meeting\n\nnotes\n");
    // A second append is no longer a create.
    let result = edits::append(
        &f.roots,
        &s,
        &state,
        "work/new/meeting.md",
        "more",
        None,
        None,
    )
    .expect("append");
    assert!(!result.created);
}

#[test]
fn a_note_created_in_a_subfolder_is_then_listed_and_searchable() {
    // The folder a note is created in is part of the corpus, not a place it
    // disappears into: this is the half that used to be missing, and it is what
    // `decisions/` and "New folder" both depend on.
    let (f, s, state) = writable();
    edits::append(
        &f.roots,
        &s,
        &state,
        "work/decisions/2026-08-20-a-choice.md",
        "# A choice\n\nbecause of the walk",
        None,
        None,
    )
    .expect("create");

    let listed = walk::list_notes(&f.roots, &s, true).expect("walk");
    assert!(
        listed
            .iter()
            .any(|n| n.name == "work/decisions/2026-08-20-a-choice.md"),
        "a deep walk lists it: {:?}",
        listed.iter().map(|n| &n.name).collect::<Vec<_>>()
    );
    let hits = search::search(
        &f.roots,
        &s,
        &search::Query::new("because of the walk"),
        None,
    )
    .expect("search");
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].note, "work/decisions/2026-08-20-a-choice.md");
}

#[test]
fn creating_a_note_still_has_to_be_an_id_this_corpus_admits() {
    let (f, s, state) = writable();
    for bad in [
        "../escape.md",
        "work/tool.exe",
        "assets/x.md",
        "work/main.rs",
    ] {
        assert!(
            edits::append(&f.roots, &s, &state, bad, "x", None, None).is_err(),
            "should have refused {bad}"
        );
    }
}

#[test]
fn a_write_into_a_project_that_is_off_reports_a_missing_note() {
    let f = Fixture::new("edit-denied");
    let dir = f.outside("secret");
    f.file(&dir, "note.md", "# A\n\nbody\n");
    let s = with_projects(vec![("secret", granted(Some("off"), true, &dir))]);
    let state = grants::State::default();
    let err = edits::append(&f.roots, &s, &state, "secret/note.md", "x", None, None)
        .expect_err("refused");
    assert_eq!(err, "no such note: secret/note.md");
    assert_eq!(
        std::fs::read_to_string(dir.join("note.md")).expect("read"),
        "# A\n\nbody\n"
    );
}

// ------------------------------------------------------------------ store

#[test]
fn a_merge_patch_edits_nested_keys_and_removes_with_null() {
    let mut target = json!({"a": 1, "nested": {"keep": true, "drop": 1}});
    store::merge_patch(
        &mut target,
        &json!({"nested": {"drop": null, "add": 2}, "b": 3}),
    );
    assert_eq!(
        target,
        json!({"a": 1, "b": 3, "nested": {"keep": true, "add": 2}})
    );
}

#[test]
fn the_mcp_block_is_not_writable_over_mcp() {
    // A tool that can widen its own grant has no grant.
    assert!(store::guard_mcp_block(&json!({"appearance": {"theme": "dark"}})).is_ok());
    assert!(store::guard_mcp_block(&json!({"mcp": {"linked": "write"}})).is_err());

    let f = Fixture::new("settings-guard");
    let mut s = Settings::default();
    s.mcp.notes_root = Some("read".into());
    f.save_settings(&s);
    let err = store::patch_settings(&f.roots, &json!({"mcp": {"notesRoot": "write"}}))
        .expect_err("refused");
    assert!(err.contains("not writable"));
    assert_eq!(f.settings().mcp.notes_root.as_deref(), Some("read"));
}

#[test]
fn a_settings_patch_that_would_not_parse_is_refused_before_it_is_written() {
    let f = Fixture::new("settings-parse");
    f.save_settings(&Settings::default());
    let err = store::patch_settings(&f.roots, &json!({"appearance": {"theme": 42}}))
        .expect_err("refused");
    assert!(err.contains("doesn't leave valid settings"));
    // The file still parses, which is the point of checking first.
    assert!(store::load(&f.roots).expect("load").error.is_none());
}

#[test]
fn a_settings_patch_writes_and_keeps_everything_it_did_not_name() {
    let f = Fixture::new("settings-patch");
    let s = Settings {
        summon_hotkey: Some("Ctrl+Alt+A".into()),
        mcp: Mcp {
            notes_root: Some("write".into()),
            ..Mcp::default()
        },
        ..Settings::default()
    };
    f.save_settings(&s);
    store::patch_settings(&f.roots, &json!({"appearance": {"theme": "dark"}})).expect("patch");
    let after = f.settings();
    assert_eq!(after.appearance.theme.as_deref(), Some("dark"));
    assert_eq!(after.summon_hotkey.as_deref(), Some("Ctrl+Alt+A"));
    assert_eq!(after.mcp.notes_root.as_deref(), Some("write"));
}

#[test]
fn an_absent_mcp_block_serializes_away_entirely() {
    // An untouched settings.json must not grow a block just because the type
    // gained one — the file is hand-edited, and noise in it is a cost.
    let data = serde_json::to_string(&Settings::default()).expect("serialize");
    assert!(!data.contains("mcp"));
}

#[test]
fn a_broken_settings_file_keeps_defaults_and_carries_the_message() {
    let f = Fixture::new("settings-broken");
    std::fs::write(f.roots.settings_file(), "{ not json").expect("write");
    let loaded = store::load(&f.roots).expect("load");
    assert!(loaded.error.expect("error").contains("settings.json"));
    assert_eq!(loaded.settings.note_types, Settings::default().note_types);
}

// -------------------------------------------------------------------- log

#[test]
fn the_call_log_appends_and_reads_back_newest_first() {
    let f = Fixture::new("log");
    assert!(log::tail(&f.roots, 10).is_empty());
    log::record(
        &f.roots,
        &log::Entry::new("append_to_note", "added 2 lines").on("work/n.md", "Actions"),
    );
    log::record(
        &f.roots,
        &log::Entry::new("write_section", "replaced").on("work/n.md", ""),
    );
    let entries = log::tail(&f.roots, 10);
    assert_eq!(entries.len(), 2);
    assert!(entries.iter().any(|e| e.tool == "append_to_note"
        && e.section.as_deref() == Some("Actions")
        && e.note.as_deref() == Some("work/n.md")));
    // An empty section is absent rather than an empty string.
    let replaced = entries
        .iter()
        .find(|e| e.tool == "write_section")
        .expect("found");
    assert!(replaced.section.is_none());
}

#[test]
fn a_torn_line_in_the_log_is_skipped_not_fatal() {
    let f = Fixture::new("log-torn");
    log::record(&f.roots, &log::Entry::new("append_to_note", "one"));
    std::fs::OpenOptions::new()
        .append(true)
        .open(f.roots.data.join(log::LOG_FILE))
        .and_then(|mut file| {
            use std::io::Write;
            write!(file, "{{\"at\":")
        })
        .expect("tear the last line");
    assert_eq!(log::tail(&f.roots, 10).len(), 1);
}

// ------------------------------------------------------------------ tools

/// A corpus with one writable project, one read-only, and one that is off.
fn tool_fixture() -> Fixture {
    let f = Fixture::new("tools");
    f.note(
        "work/plan.md",
        "Intro.\n\n# Design\n\ndesign body\n\n## Decisions\n\nwe picked A\n",
    );
    f.note("work/other.md", "unrelated\n");
    f.note("reading/ref.md", "reference material about A\n");
    let secret = f.outside("secret");
    f.file(&secret, "hidden.md", "A secret about A\n");
    let mut s = Settings::default();
    s.projects
        .insert("work".into(), granted(Some("write"), false, &secret));
    s.projects
        .insert("reading".into(), granted(Some("read"), false, &secret));
    s.projects
        .insert("secret".into(), granted(Some("off"), true, &secret));
    // A workspace holding a project the caller may not see, and it is current.
    s.workspaces
        .insert("focus".into(), vec!["work".into(), "secret".into()]);
    s.current_workspace = Some("focus".into());
    f.save_settings(&s);
    f
}

fn call(f: &Fixture, command: &str, args: serde_json::Value) -> Result<serde_json::Value, String> {
    tools::dispatch(&f.roots, command, &args)
}

#[test]
fn doctor_reports_what_this_process_resolved() {
    let f = tool_fixture();
    let out = call(&f, "doctor", json!({})).expect("doctor");
    assert_eq!(out["notesRoot"], json!(f.roots.notes.to_string_lossy()));
    assert_eq!(out["settingsFileExists"], json!(true));
    assert_eq!(out["writeScope"], json!("any"));
    assert_eq!(out["grants"]["work"], json!("write"));
    assert_eq!(out["grants"]["secret"], json!("off"));
    // Three projects exist; the `off` one is not one of the visible ones.
    assert_eq!(out["visibleProjects"], json!(2));
}

#[test]
fn a_workspace_scopes_the_listings_and_never_names_an_off_project() {
    let f = tool_fixture();
    let notes_of = |v: &serde_json::Value, key: &str| -> Vec<String> {
        v[key]
            .as_array()
            .expect("array")
            .iter()
            .map(|n| n["note"].as_str().expect("note").to_string())
            .collect()
    };

    // The workspace holds `secret`, which is off: it is not named.
    let ws = call(&f, "list_workspaces", json!({})).expect("workspaces");
    assert_eq!(ws["current"], json!("focus"));
    assert_eq!(
        ws["workspaces"],
        json!([{ "workspace": "focus", "projects": ["work"] }])
    );

    let projects = call(&f, "list_projects", json!({ "workspace": "focus" })).expect("projects");
    assert_eq!(projects.as_array().expect("array").len(), 1);
    assert_eq!(projects[0]["project"], json!("work"));

    let listed = call(&f, "list_notes", json!({ "workspace": "focus" })).expect("notes");
    let listed = notes_of(&listed, "notes");
    assert!(listed.contains(&"work/plan.md".to_string()));
    assert!(listed.iter().all(|n| n.starts_with("work/")));

    // "about A" is in reading/ and secret/ too; only work/ answers.
    let hits = call(
        &f,
        "search_notes",
        json!({ "query": "a", "workspace": "focus" }),
    )
    .expect("search");
    let hits = notes_of(&hits, "hits");
    assert!(!hits.is_empty());
    assert!(hits.iter().all(|n| n.starts_with("work/")));
    let found = call(
        &f,
        "find_notes",
        json!({ "pattern": ".md", "workspace": "focus" }),
    )
    .expect("find");
    let found = notes_of(&found, "notes");
    assert!(!found.is_empty());
    assert!(found.iter().all(|n| n.starts_with("work/")));

    // "Default" is every visible project; an unknown name lists what exists.
    let all = call(&f, "list_notes", json!({ "workspace": "Default" })).expect("notes");
    assert!(notes_of(&all, "notes").contains(&"reading/ref.md".to_string()));
    let err = call(&f, "list_notes", json!({ "workspace": "nope" })).expect_err("unknown");
    assert!(err.contains("focus"), "{err}");
}

#[test]
fn the_listings_never_mention_a_project_that_is_off() {
    let f = tool_fixture();
    let projects = call(&f, "list_projects", json!({})).expect("projects");
    let names: Vec<&str> = projects
        .as_array()
        .expect("array")
        .iter()
        .map(|p| p["project"].as_str().expect("name"))
        .collect();
    assert_eq!(names, vec!["reading", "work"]);

    let notes = call(&f, "list_notes", json!({})).expect("notes");
    let listed = notes.to_string();
    assert!(listed.contains("work/plan.md"));
    assert!(!listed.contains("secret/"));

    // And it is not searchable either, though the word is in it.
    let out = call(&f, "search_notes", json!({ "query": "A secret" })).expect("search");
    assert_eq!(out["hits"].as_array().expect("array").len(), 0);
}

/// A corpus where the notes a caller may *not* see come first in the walk, so
/// a limit spent on them is visible as a missing answer rather than as luck.
/// The hidden project sits in the notes root and the visible one is linked from
/// outside, which is the one ordering the walk guarantees: notes-root notes are
/// listed before linked ones.
fn starved_fixture() -> Fixture {
    let f = Fixture::new("starve");
    let open = f.outside("open");
    for i in 0..12 {
        f.note(&format!("hidden/note-{i}.md"), "the keyword is here\n");
        f.file(&open, &format!("note-{i}.md"), "the keyword is here\n");
    }
    let mut s = Settings::default();
    s.projects
        .insert("hidden".into(), granted(Some("off"), false, &open));
    s.projects
        .insert("open".into(), granted(Some("read"), true, &open));
    f.save_settings(&s);
    f
}

#[test]
fn a_hidden_project_never_spends_the_result_budget() {
    let f = starved_fixture();
    // Twelve hidden notes match and sort first. Filtering them out after the
    // cap leaves nothing, and an empty result reads as "your corpus has no
    // such thing" rather than as the refusal it really is.
    let out = call(
        &f,
        "search_notes",
        json!({ "query": "keyword", "limit": 5 }),
    )
    .expect("search");
    let hits = out["hits"].as_array().expect("hits");
    assert_eq!(hits.len(), 5);
    assert!(hits
        .iter()
        .all(|h| h["note"].as_str().expect("note").starts_with("open/")));

    // Same rule for the name search, where the cap is a take at the end.
    let out = call(&f, "find_notes", json!({ "pattern": "note", "limit": 5 })).expect("find");
    let notes = out["notes"].as_array().expect("notes");
    assert_eq!(notes.len(), 5);
    assert!(notes
        .iter()
        .all(|n| n["note"].as_str().expect("note").starts_with("open/")));
}

#[test]
fn a_hidden_project_cannot_be_probed_by_raising_the_limit() {
    let f = starved_fixture();
    // The side channel the budget bug opened: if hidden notes consume slots,
    // asking for more returns disproportionately more, which tells a caller
    // something it may not see is there. Twelve visible notes match, so the
    // counts have to be exactly what a corpus without the hidden project gives.
    let count = |limit: usize| {
        let out = call(
            &f,
            "search_notes",
            json!({ "query": "keyword", "limit": limit }),
        )
        .expect("search");
        out["hits"].as_array().expect("hits").len()
    };
    assert_eq!(count(5), 5);
    assert_eq!(count(12), 12);
    assert_eq!(count(50), 12);
}

#[test]
fn a_clipped_result_says_so() {
    let f = starved_fixture();
    let out = call(
        &f,
        "search_notes",
        json!({ "query": "keyword", "limit": 5 }),
    )
    .expect("search");
    assert_eq!(out["truncated"], json!(true));
    // Exactly as many as exist is not a clipped result, and saying it was
    // would send a caller back for a page that isn't there.
    let out = call(
        &f,
        "search_notes",
        json!({ "query": "keyword", "limit": 12 }),
    )
    .expect("search");
    assert_eq!(out["truncated"], json!(false));

    let out = call(&f, "find_notes", json!({ "pattern": "note", "limit": 5 })).expect("find");
    assert_eq!(out["truncated"], json!(true));
    let out = call(&f, "list_notes", json!({ "limit": 5 })).expect("list");
    assert_eq!(out["truncated"], json!(true));
    assert_eq!(out["notes"].as_array().expect("notes").len(), 5);
}

#[test]
fn a_direct_read_of_an_off_project_is_indistinguishable_from_a_missing_note() {
    let f = tool_fixture();
    let real = call(&f, "read_note", json!({ "note": "secret/hidden.md" })).expect_err("refused");
    let fake = call(&f, "read_note", json!({ "note": "secret/nope.md" })).expect_err("refused");
    assert_eq!(real, "no such note: secret/hidden.md");
    assert_eq!(fake, "no such note: secret/nope.md");
    // Same for a project-scoped search: an empty result, not a refusal that
    // would confirm the name.
    let hits = call(
        &f,
        "search_notes",
        json!({ "query": "a", "project": "secret" }),
    )
    .expect("scoped search");
    assert_eq!(hits, json!({ "hits": [], "truncated": false }));
}

#[test]
fn the_listing_carries_heading_trees_only_when_asked() {
    let f = tool_fixture();
    let plain = call(&f, "list_notes", json!({ "project": "work" })).expect("notes");
    assert!(plain["notes"][0].get("headings").is_none());

    let outlined = call(
        &f,
        "list_notes",
        json!({ "project": "work", "outline": true }),
    )
    .expect("notes");
    let plan = outlined["notes"]
        .as_array()
        .expect("array")
        .iter()
        .find(|n| n["note"] == json!("work/plan.md"))
        .expect("plan");
    assert_eq!(plan["headings"][0]["section"], json!("Design"));
    assert_eq!(plan["headings"][1]["section"], json!("Design/Decisions"));
    // A listing must never carry content, whatever else it carries.
    assert!(!outlined.to_string().contains("we picked A"));
}

#[test]
fn a_section_read_brings_back_only_that_section() {
    let f = tool_fixture();
    let whole = call(&f, "read_note", json!({ "note": "work/plan.md" })).expect("read");
    assert!(whole["text"].as_str().expect("text").contains("Intro."));

    let part = call(
        &f,
        "read_note",
        json!({ "note": "work/plan.md", "section": "Decisions" }),
    )
    .expect("read");
    let text = part["text"].as_str().expect("text");
    assert!(text.contains("we picked A"));
    assert!(!text.contains("Intro."));
    assert!(!text.contains("design body"));
    assert_eq!(part["section"], json!("Design/Decisions"));
    // The mtime a later write will need comes back with the read.
    assert!(part["mtimeMs"].as_u64().expect("mtime") > 0);
}

#[test]
fn search_hits_name_the_section_they_fall_under() {
    let f = tool_fixture();
    let out = call(&f, "search_notes", json!({ "query": "picked" })).expect("search");
    assert_eq!(out["hits"][0]["note"], json!("work/plan.md"));
    assert_eq!(out["hits"][0]["section"], json!("Design/Decisions"));
}

#[test]
fn find_notes_answers_by_name_without_opening_anything() {
    let f = tool_fixture();
    let found = call(&f, "find_notes", json!({ "pattern": "plan" })).expect("find");
    assert_eq!(found["notes"][0]["note"], json!("work/plan.md"));
    // The off project stays out of name search too.
    let found = call(&f, "find_notes", json!({ "pattern": "hidden" })).expect("find");
    assert_eq!(found["notes"], json!([]));
}

#[test]
fn a_write_goes_through_and_lands_in_the_call_log() {
    let f = tool_fixture();
    let before = call(
        &f,
        "read_note",
        json!({ "note": "work/plan.md", "section": "Decisions" }),
    )
    .expect("read");
    let mtime = before["mtimeMs"].as_u64().expect("mtime");

    let result = call(
        &f,
        "write_section",
        json!({
            "note": "work/plan.md",
            "section": "Decisions",
            "content": "we picked B instead",
            "expectUnchanged": mtime,
        }),
    )
    .expect("write");
    assert_eq!(result["section"], json!("Design/Decisions"));
    let after = f.read("work/plan.md");
    assert!(after.contains("we picked B instead"));
    assert!(!after.contains("we picked A"));
    assert!(after.starts_with("Intro."));

    let entries = log::tail(&f.roots, 10);
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].tool, "write_section");
    assert_eq!(entries[0].note.as_deref(), Some("work/plan.md"));
    assert_eq!(entries[0].section.as_deref(), Some("Design/Decisions"));
}

#[test]
fn reads_are_never_logged() {
    // A log of every read would be a surveillance record of the user's own
    // corpus, and it answers no question the user asked.
    let f = tool_fixture();
    for (command, args) in [
        ("list_projects", json!({})),
        ("list_notes", json!({ "outline": true })),
        ("read_note", json!({ "note": "work/plan.md" })),
        ("outline_note", json!({ "note": "work/plan.md" })),
        ("search_notes", json!({ "query": "picked" })),
        ("find_notes", json!({ "pattern": "plan" })),
        ("doctor", json!({})),
    ] {
        call(&f, command, args).unwrap_or_else(|e| panic!("{command}: {e}"));
    }
    assert!(log::tail(&f.roots, 10).is_empty());
}

#[test]
fn a_write_into_a_read_only_project_changes_nothing() {
    let f = tool_fixture();
    let err = call(
        &f,
        "append_to_note",
        json!({ "note": "reading/ref.md", "content": "mine now" }),
    )
    .expect_err("refused");
    assert!(err.contains("read-only"));
    assert_eq!(f.read("reading/ref.md"), "reference material about A\n");
    assert!(log::tail(&f.roots, 10).is_empty());
}

#[test]
fn creating_a_note_is_one_call() {
    let f = tool_fixture();
    let result = call(
        &f,
        "append_to_note",
        json!({
            "note": "work/2026-08-19-standup.md",
            "content": "# Standup\n\n- shipped the helper",
        }),
    )
    .expect("create");
    assert_eq!(result["created"], json!(true));
    assert_eq!(
        f.read("work/2026-08-19-standup.md"),
        "# Standup\n\n- shipped the helper\n"
    );
    assert_eq!(log::tail(&f.roots, 1)[0].tool, "append_to_note");
}

#[test]
fn settings_are_off_until_the_user_turns_them_on() {
    let f = tool_fixture();
    let err = call(&f, "read_settings", json!({})).expect_err("refused");
    assert!(err.contains("mcp.settings"));

    let mut s = f.settings();
    s.mcp.settings = Some("read".into());
    f.save_settings(&s);
    let out = call(&f, "read_settings", json!({})).expect("read");
    assert!(out.get("projects").is_some());

    // Read does not imply write.
    let err = call(
        &f,
        "write_settings",
        json!({ "patch": { "appearance": { "theme": "dark" } } }),
    )
    .expect_err("refused");
    assert!(err.contains("not writable"));

    let mut s = f.settings();
    s.mcp.settings = Some("write".into());
    f.save_settings(&s);
    call(
        &f,
        "write_settings",
        json!({ "patch": { "appearance": { "theme": "dark" } } }),
    )
    .expect("write");
    assert_eq!(f.settings().appearance.theme.as_deref(), Some("dark"));

    // Even at `write`, the block that decides all of this stays shut.
    let err = call(
        &f,
        "write_settings",
        json!({ "patch": { "mcp": { "linked": "write" } } }),
    )
    .expect_err("refused");
    assert!(err.contains("not writable"));
    assert_eq!(f.settings().mcp.linked, None);
}

#[test]
fn an_unknown_command_says_what_it_does_answer_to() {
    let f = tool_fixture();
    let err = call(&f, "delete_everything", json!({})).expect_err("unknown");
    assert!(err.contains("unknown command"));
    assert!(err.contains("read_note"));
}

#[test]
fn a_missing_required_argument_names_itself() {
    let f = tool_fixture();
    let err = call(&f, "read_note", json!({})).expect_err("missing");
    assert!(err.contains("\"note\""));
}

#[test]
fn create_note_files_by_the_users_destinations() {
    let f = tool_fixture();
    let mut s = f.settings();
    let work = s.projects.get_mut("work").expect("work");
    work.destinations.meeting = Some("meetings".into());
    work.destinations
        .types
        .insert("markdown".into(), "docs".into());
    // A global destination may point into a project.
    s.destinations.capture = Some("work/inbox".into());
    f.save_settings(&s);

    let made = |args: serde_json::Value| {
        call(&f, "create_note", args).map(|v| v["note"].as_str().expect("note").to_string())
    };
    let meeting = json!({ "name": "standup", "project": "work", "kind": "meeting" });
    assert_eq!(
        made(meeting.clone()).as_deref(),
        Ok("work/meetings/standup.md")
    );
    assert_eq!(
        made(json!({ "name": "idea", "kind": "capture", "content": "# Idea" })).as_deref(),
        Ok("work/inbox/idea.md")
    );
    assert_eq!(f.read("work/inbox/idea.md"), "# Idea\n");
    assert_eq!(
        made(json!({ "name": "spec.md", "project": "work" })).as_deref(),
        Ok("work/docs/spec.md")
    );
    // Never overwrites.
    assert!(made(meeting).expect_err("taken").contains("already exists"));
    // A project without destinations files at its own folder.
    s.projects.get_mut("work").expect("work").destinations = Default::default();
    f.save_settings(&s);
    assert_eq!(
        made(json!({ "name": "flat", "project": "work" })).as_deref(),
        Ok("work/flat.md")
    );

    // The grants still decide.
    let read_only = made(json!({ "name": "x", "project": "reading" })).expect_err("read-only");
    assert!(read_only.contains("read-only"));
    // An off project and an unknown one answer alike, and neither becomes a
    // new folder.
    for project in ["secret", "nope"] {
        let err = made(json!({ "name": "x", "project": project })).expect_err("absent");
        assert!(
            err.starts_with(&format!("no such project: {project} (")),
            "{err}"
        );
    }
    assert!(!f.roots.notes.join("nope").exists());
}

#[test]
fn move_note_checks_both_ends_and_respects_open_edits() {
    let f = tool_fixture();
    let moved = call(
        &f,
        "move_note",
        json!({ "from": "work/other.md", "to": "work/archive/other.md" }),
    );
    assert!(moved.is_ok(), "{moved:?}");
    assert_eq!(f.read("work/archive/other.md"), "unrelated\n");
    assert!(!f.roots.notes.join("work/other.md").exists());

    // Out of a read-only project: refused, the file stays.
    let err = call(
        &f,
        "move_note",
        json!({ "from": "reading/ref.md", "to": "work/ref.md" }),
    )
    .expect_err("read-only source");
    assert!(err.contains("read-only"));
    assert!(f.roots.notes.join("reading/ref.md").exists());

    // The app holds a draft for it: moving would strand those edits.
    let draft = f.roots.data.join("drafts/work/plan.md");
    std::fs::create_dir_all(draft.parent().expect("parent")).expect("drafts");
    std::fs::write(&draft, "unsaved").expect("draft");
    let err = call(
        &f,
        "move_note",
        json!({ "from": "work/plan.md", "to": "work/plan2.md" }),
    )
    .expect_err("open edits");
    assert!(err.contains("unsaved edits"));
}

#[test]
fn moved_to_follows_a_note_through_repeated_moves() {
    let f = tool_fixture();
    for (from, to) in [
        ("work/other.md", "work/a/other.md"),
        ("work/a/other.md", "work/b/other.md"),
    ] {
        let moved = call(&f, "move_note", json!({ "from": from, "to": to }));
        assert!(moved.is_ok(), "{moved:?}");
    }
    assert_eq!(
        log::moved_to(&f.roots, "work/other.md").as_deref(),
        Some("work/b/other.md")
    );
    assert_eq!(log::moved_to(&f.roots, "work/plan.md"), None);
}

#[test]
fn code_folders_list_only_visible_projects() {
    let f = tool_fixture();
    let mut s = f.settings();
    for project in ["work", "secret"] {
        s.projects.get_mut(project).expect("project").code_folders =
            vec![format!("C:/code/{project}")];
    }
    f.save_settings(&s);
    let out = call(&f, "code_folders", json!({})).expect("code folders");
    let projects = out["projects"].as_array().expect("array");
    assert_eq!(projects.len(), 1);
    assert_eq!(projects[0]["project"], json!("work"));
    assert_eq!(projects[0]["codeFolders"], json!(["C:/code/work"]));
    assert_eq!(projects[0]["grant"], json!("write"));
}
