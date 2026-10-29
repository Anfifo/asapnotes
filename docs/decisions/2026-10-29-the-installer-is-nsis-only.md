# The installer is NSIS only

- Date: 2026-10-29
- Status: Built

## Context

The bundler builds an NSIS installer and an MSI by default. The app installs per user
(`installMode: currentUser`), needs no administrator rights, and registers a startup entry
under `HKCU\...\Run` at runtime. The NSIS uninstaller deletes that entry outside updates;
the MSI uninstaller leaves it behind, pointing at a deleted exe, and the MSI installs per
machine, which asks for administrator rights.

## Decision

Releases ship the NSIS installer only (`bundle.targets: ["nsis"]`). It covers per-user
installs, updates and the startup entry's cleanup, and winget accepts it. An MSI earns its
place where IT departments deploy software centrally through Group Policy or Intune; nothing
here asks for that yet, and it would need its own cleanup of the startup entry.

## Links

- [tauri.conf.json](../../src-tauri/tauri.conf.json)
- [release.yml](../../.github/workflows/release.yml)
