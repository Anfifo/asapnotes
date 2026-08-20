//! A real corpus on disk, for tests.
//!
//! The core exists so this is possible: before the extraction every one of
//! these paths went through `AppHandle`, and `notes.rs` had no tests at all
//! because there was no way to call it. A fixture is a temp directory with a
//! notes root and an app-data folder, torn down when it drops — so a test
//! exercises the actual walks against actual files, not a mock of them.

use super::grants::{self, State};
use super::store;
use super::Roots;
use crate::settings::Settings;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};

static NEXT: AtomicU32 = AtomicU32::new(0);

pub struct Fixture {
    pub roots: Roots,
    home: PathBuf,
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.home);
    }
}

impl Fixture {
    /// `label` only makes the directory name readable when a test leaves one
    /// behind; uniqueness comes from the counter and the process id.
    pub fn new(label: &str) -> Self {
        let home = std::env::temp_dir().join(format!(
            "asapnotes-test-{label}-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let roots = Roots::new(home.join("notes"), home.join("data"));
        roots.ensure().expect("fixture roots");
        Self { roots, home }
    }

    /// Somewhere outside the notes root, for a linked project or a mount.
    pub fn outside(&self, name: &str) -> PathBuf {
        let dir = self.home.join("outside").join(name);
        fs::create_dir_all(&dir).expect("outside dir");
        dir
    }

    /// Write a file by note id, creating parents. Returns its path.
    pub fn note(&self, id: &str, content: &str) -> PathBuf {
        let path = self.roots.notes.join(id);
        write_at(&path, content);
        path
    }

    /// Write a file at an absolute path (a linked project's own folder).
    pub fn file(&self, dir: &Path, rel: &str, content: &str) -> PathBuf {
        let path = dir.join(rel);
        write_at(&path, content);
        path
    }

    pub fn save_settings(&self, s: &Settings) {
        store::write(&self.roots.settings_file(), s).expect("write settings");
    }

    pub fn settings(&self) -> Settings {
        store::load(&self.roots).expect("load settings").settings
    }

    /// The state file the app publishes: which project is current.
    pub fn set_current(&self, project: Option<&str>) {
        grants::publish(&self.roots, project.map(str::to_string)).expect("write state");
    }

    pub fn state(&self) -> State {
        grants::read_state(&self.roots)
    }

    pub fn read(&self, id: &str) -> String {
        fs::read_to_string(self.roots.notes.join(id)).expect("read note")
    }
}

fn write_at(path: &Path, content: &str) {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).expect("parents");
    }
    fs::write(path, content).expect("write");
}
