//! Portable per-project configuration: `.asapnotes.json` at a project's
//! location.
//!
//! The other half of the trust split in [`crate::settings`]: everything in this
//! file arrives on other machines by `git pull`, so it may carry nothing that
//! grants access or names a machine path — see `docs/project-model.md`. Today
//! the app consumes only `files`, an ordered list of `.gitignore`-syntax
//! patterns that overrides which files count as notes. The app never writes
//! this file.
//!
//! Read at walk time, once per project, not cached: the file is a few lines of
//! JSON, and every consumer already walks per project. A broken file falls back
//! to the default rules so one typo can't blank a project's listing;
//! [`errors`] re-collects the parse problems for the frontend to report.

use ignore::gitignore::{Gitignore, GitignoreBuilder};
use serde::Deserialize;
use std::fs;
use std::path::Path;

pub const FILE_NAME: &str = ".asapnotes.json";

/// The portable file's schema. Only `files` is consumed so far; unknown keys
/// are left alone by never writing the file, not by modeling them.
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct ProjectConfig {
    files: Vec<String>,
}

/// What a project's rules say about one path. `Default` means no pattern
/// matched — the code default (registry allowlist, skip dirs) decides.
#[derive(PartialEq, Eq, Clone, Copy, Debug)]
pub enum Verdict {
    Default,
    /// Last matching pattern was a `!` re-include. For a file this also waives
    /// the type allowlist; the floor (executables, oversized files) is the
    /// caller's check, because it needs the filesystem.
    Include,
    Exclude,
}

/// A project's compiled `files` rules. The default value has no opinion about
/// anything, which is exactly the behavior of a project with no config file.
#[derive(Default)]
pub struct Rules {
    matcher: Option<Gitignore>,
}

impl Rules {
    /// Last matching pattern wins, per `.gitignore` semantics. `rel` is the
    /// path relative to the project's location — for a mounted file that is
    /// `<at>/<rest>`, so a mount is not a way around the project's exclusions.
    pub fn verdict(&self, rel: &str, is_dir: bool) -> Verdict {
        let Some(m) = &self.matcher else {
            return Verdict::Default;
        };
        let matched = m.matched(rel, is_dir);
        if matched.is_whitelist() {
            Verdict::Include
        } else if matched.is_ignore() {
            Verdict::Exclude
        } else {
            Verdict::Default
        }
    }
}

/// Compile a pattern list. A pattern the engine rejects is skipped and
/// reported, not fatal: dropping the whole list over one bad line would
/// silently list everything the good lines excluded.
fn compile(patterns: &[String]) -> (Rules, Vec<String>) {
    // Case-insensitive like the rest of the app's path handling (extension
    // matching, the disjoint check) — and like the filesystem underneath.
    let mut builder = GitignoreBuilder::new("");
    builder.case_insensitive(true).ok();
    let mut errors = Vec::new();
    for line in patterns {
        if let Err(e) = builder.add_line(None, line) {
            errors.push(format!("pattern {line}: {e}"));
        }
    }
    match builder.build() {
        Ok(matcher) => (
            Rules {
                matcher: Some(matcher),
            },
            errors,
        ),
        Err(e) => (Rules::default(), vec![e.to_string()]),
    }
}

/// Read and compile the rules at a project's location. No file, or a file with
/// no patterns, is the default rules; a file that can't be parsed is too, with
/// the problem carried for [`errors`] to report.
pub fn rules_for(location: &Path) -> (Rules, Option<String>) {
    let path = location.join(FILE_NAME);
    let Ok(data) = fs::read_to_string(&path) else {
        return (Rules::default(), None);
    };
    match serde_json::from_str::<ProjectConfig>(&data) {
        Ok(cfg) => {
            let (rules, errors) = compile(&cfg.files);
            let error =
                (!errors.is_empty()).then(|| format!("{}: {}", path.display(), errors.join("; ")));
            (rules, error)
        }
        Err(e) => (Rules::default(), Some(format!("{}: {e}", path.display()))),
    }
}

/// Compile the personal pattern layer (`files` in the app-data settings file)
/// alone — what a walk consults where no project file can add to it, the
/// notes root's own files. Same syntax and reporting rules as a project's.
pub fn personal_rules(patterns: &[String]) -> (Rules, Option<String>) {
    let (rules, errors) = compile(patterns);
    (rules, (!errors.is_empty()).then(|| errors.join("; ")))
}

/// The rules a walk consults inside a project: the personal patterns first,
/// the project's own `files` after — one ordered list, last match wins, so
/// the portable project file overrides the personal layer pattern by
/// pattern. Problems are dropped here; [`rules_for`] and [`personal_rules`]
/// re-collect them for the reporting channel.
pub fn walk_rules(personal: &[String], location: &Path) -> Rules {
    let project = fs::read_to_string(location.join(FILE_NAME))
        .ok()
        .and_then(|data| serde_json::from_str::<ProjectConfig>(&data).ok())
        .map(|cfg| cfg.files)
        .unwrap_or_default();
    if personal.is_empty() && project.is_empty() {
        return Rules::default();
    }
    let mut all = personal.to_vec();
    all.extend(project);
    compile(&all).0
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rules(patterns: &[&str]) -> Rules {
        let patterns: Vec<String> = patterns.iter().map(|s| s.to_string()).collect();
        let (rules, errors) = compile(&patterns);
        assert!(errors.is_empty(), "unexpected pattern errors: {errors:?}");
        rules
    }

    #[test]
    fn no_patterns_has_no_opinion() {
        assert_eq!(
            Rules::default().verdict("notes/a.md", false),
            Verdict::Default
        );
        assert_eq!(rules(&[]).verdict("notes/a.md", false), Verdict::Default);
    }

    #[test]
    fn bare_pattern_excludes() {
        let r = rules(&["archive/**", "CHANGELOG.md"]);
        assert_eq!(r.verdict("archive/old.md", false), Verdict::Exclude);
        assert_eq!(r.verdict("CHANGELOG.md", false), Verdict::Exclude);
        assert_eq!(r.verdict("notes/CHANGELOG.md", false), Verdict::Exclude);
        assert_eq!(r.verdict("readme.md", false), Verdict::Default);
    }

    #[test]
    fn negation_includes() {
        let r = rules(&["!src/**/*.rs"]);
        assert_eq!(r.verdict("src/main.rs", false), Verdict::Include);
        assert_eq!(r.verdict("src/notes/mod.rs", false), Verdict::Include);
        assert_eq!(r.verdict("build.rs", false), Verdict::Default);
    }

    #[test]
    fn last_match_wins() {
        let r = rules(&["docs/**", "!docs/keep.md"]);
        assert_eq!(r.verdict("docs/old.md", false), Verdict::Exclude);
        assert_eq!(r.verdict("docs/keep.md", false), Verdict::Include);
        // Same patterns, opposite order: the exclude is last, so it wins.
        let r = rules(&["!docs/keep.md", "docs/**"]);
        assert_eq!(r.verdict("docs/keep.md", false), Verdict::Exclude);
    }

    #[test]
    fn directory_verdicts() {
        let r = rules(&["archive/", "!build/"]);
        assert_eq!(r.verdict("archive", true), Verdict::Exclude);
        assert_eq!(r.verdict("build", true), Verdict::Include);
        assert_eq!(r.verdict("notes", true), Verdict::Default);
        // A dir-only pattern doesn't match a file of the same name.
        assert_eq!(r.verdict("archive", false), Verdict::Default);
    }

    #[test]
    fn matching_is_case_insensitive() {
        let r = rules(&["Archive/**"]);
        assert_eq!(r.verdict("archive/old.md", false), Verdict::Exclude);
    }

    #[test]
    fn anchoring_follows_gitignore() {
        // No slash: matches at any depth. Leading/inner slash: anchored.
        let r = rules(&["draft.md", "/top.md"]);
        assert_eq!(r.verdict("a/b/draft.md", false), Verdict::Exclude);
        assert_eq!(r.verdict("top.md", false), Verdict::Exclude);
        assert_eq!(r.verdict("a/top.md", false), Verdict::Default);
    }

    #[test]
    fn project_patterns_override_the_personal_layer() {
        // walk_rules concatenates personal first, project after — the same
        // list last-match-wins reads, so the project file gets the final say.
        let r = rules(&["*.json", "!data/*.json"]);
        assert_eq!(r.verdict("config.json", false), Verdict::Exclude);
        assert_eq!(r.verdict("data/set.json", false), Verdict::Include);
    }

    #[test]
    fn walk_rules_is_personal_only_without_a_project_file() {
        let personal = vec!["*.json".to_string()];
        let r = walk_rules(&personal, Path::new("Z:/nowhere/definitely-not-here"));
        assert_eq!(r.verdict("a.json", false), Verdict::Exclude);
        assert_eq!(r.verdict("a.md", false), Verdict::Default);
    }

    #[test]
    fn bad_pattern_is_skipped_not_fatal() {
        // `[z-a]` is a glob error (inverted range); most oddities are not —
        // the engine takes e.g. an unclosed `[` literally, as git does.
        let patterns = vec!["ok.md".to_string(), "[z-a]".to_string()];
        let (rules, errors) = compile(&patterns);
        assert_eq!(errors.len(), 1);
        assert_eq!(rules.verdict("ok.md", false), Verdict::Exclude);
    }
}
