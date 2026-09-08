pub mod corpus;
mod history;
pub mod meeting;
mod notes;
mod project_config;
mod settings;
mod transcribe;

/// Where this process's two corpus roots are, as `AppHandle` resolves them.
///
/// The one place the app answers that question, so that the helper binary —
/// which answers it without an `AppHandle` — has exactly one thing to agree
/// with. `asapnotes-mcp doctor` prints both sides for the same reason: a
/// mismatch here serves a different corpus and *nothing looks wrong*.
pub(crate) mod app_paths {
    use crate::corpus::Roots;
    use tauri::{AppHandle, Manager};

    pub fn roots(app: &AppHandle) -> Result<Roots, String> {
        let notes = app
            .path()
            .document_dir()
            .map_err(|e| e.to_string())?
            .join("asapnotes");
        let data = app.path().app_data_dir().map_err(|e| e.to_string())?;
        let roots = Roots::new(notes, data);
        roots.ensure()?;
        Ok(roots)
    }
}

#[cfg(desktop)]
mod desktop {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
    use tauri::{App, AppHandle, Emitter, Manager};
    use tauri_plugin_global_shortcut::{
        Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState,
    };

    /// Shipped summon hotkey; `summonHotkey` in settings.json overrides it.
    pub const DEFAULT_SUMMON: &str = "Ctrl+Alt+A";

    fn default_summon() -> Shortcut {
        Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyA)
    }

    /// Toggle the pre-created main window. On summon, the hotkey-press wall-clock
    /// time rides along on the `summoned` event so the frontend can measure
    /// press-to-paint latency — the product's one number.
    pub fn toggle_main_window(app: &AppHandle) {
        let Some(window) = app.get_webview_window("main") else {
            return;
        };
        // Focus-based toggle: hidden, minimized, or buried all count as "not on
        // screen" — only a window the user is actually in gets hidden. On Windows a
        // minimized window still reports is_visible(), which made the old
        // visibility check hide it instead of restoring it.
        if window.is_focused().unwrap_or(false) {
            let _ = window.hide();
        } else {
            let summoned_at_ms = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as f64;
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
            let _ = window.emit("summoned", summoned_at_ms);
        }
    }

    fn show_main_window(app: &AppHandle) {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
        }
    }

    pub fn setup(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
        app.handle().plugin(tauri_plugin_dialog::init())?;
        app.handle().plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))?;

        // Publish the notes root this process resolved, so the MCP helper never
        // has to guess it — a helper guessing a different root serves a
        // different corpus and looks perfectly healthy doing it. Nothing is
        // open yet, so no current project.
        if let Ok(roots) = crate::app_paths::roots(app.handle()) {
            let _ = crate::corpus::grants::publish(&roots, None);
        }

        // Every folder outside the notes root that notes can live in — project
        // locations and mounts — so the asset protocol can serve their images
        // in preview. The grant is runtime state, so it is made again here on
        // every launch, not only when the folder is added. This is also the
        // first settings read, so any migration off external_projects.json
        // happens here.
        let settings = crate::settings::settings(app.handle()).ok();
        if let Some(settings) = &settings {
            let scope = app.asset_protocol_scope();
            for (_, dir) in settings.located_projects() {
                let _ = scope.allow_directory(dir, true);
            }
            for entry in settings.projects.values() {
                for mount in &entry.mounts {
                    let _ = scope.allow_directory(&mount.path, true);
                }
            }
        }
        // Only a release build should register itself to run at login; in dev this
        // would point autostart at target/debug and stick around after the session.
        #[cfg(not(debug_assertions))]
        {
            use tauri_plugin_autostart::ManagerExt;
            let autolaunch = app.autolaunch();
            if !autolaunch.is_enabled().unwrap_or(false) {
                let _ = autolaunch.enable();
            }
        }

        // Default Ctrl+Alt+A ("asapnotes", one-handed): Ctrl+Alt+Space was already
        // taken by another resident app, Ctrl/Shift+Space chords collide with editor
        // completion, and Win-modifier chords proved laggy under repeat (shell
        // intercepts Win). Settings → Keyboard shortcuts can rebind it; a stored
        // chord that doesn't parse falls back to the default rather than losing
        // the summon.
        let (chord, summon) = match settings.as_ref().and_then(|s| s.summon_hotkey.clone()) {
            Some(stored) => match stored.parse::<Shortcut>() {
                Ok(s) => (stored, s),
                Err(e) => {
                    eprintln!("bad summonHotkey \"{stored}\": {e} — using {DEFAULT_SUMMON}");
                    (DEFAULT_SUMMON.to_string(), default_summon())
                }
            },
            None => (DEFAULT_SUMMON.to_string(), default_summon()),
        };
        app.handle().plugin(
            tauri_plugin_global_shortcut::Builder::new()
                // The summon chord is the only shortcut this app ever
                // registers, so any press is it — which is what lets a rebind
                // swap the registration without rebuilding the handler.
                .with_handler(move |app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        toggle_main_window(app);
                    }
                })
                .build(),
        )?;
        // A failed registration (hotkey taken by another app) shouldn't kill the
        // app — the tray still works.
        if let Err(e) = app.global_shortcut().register(summon) {
            eprintln!("failed to register {chord}: {e}");
        }

        let open = MenuItem::with_id(app, "open", "Open", true, None::<&str>)?;
        let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
        let menu = Menu::with_items(app, &[&open, &quit])?;
        // The tray is where the mark matters most — pin its icon to the 32px brand
        // asset rather than inheriting whatever the window icon resource resolves to.
        let tray_icon = tauri::image::Image::from_bytes(include_bytes!("../icons/32x32.png"))?;
        TrayIconBuilder::with_id("main")
            .icon(tray_icon)
            .tooltip(format!("asapnotes ({chord})"))
            .menu(&menu)
            .show_menu_on_left_click(false)
            .on_menu_event(|app, event| match event.id().as_ref() {
                "open" => show_main_window(app),
                "quit" => app.exit(0),
                _ => {}
            })
            .on_tray_icon_event(|tray, event| {
                if let TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } = event
                {
                    toggle_main_window(tray.app_handle());
                }
            })
            .build(app)?;

        Ok(())
    }
}

/// Real exit — the ✕ button only hides to the tray, this is the menu's Quit.
#[tauri::command]
fn quit(app: tauri::AppHandle) {
    app.exit(0);
}

/// Rebind the global summon hotkey: register the new chord live (putting the
/// old one back if the new registration is refused — losing the summon would
/// be worse than refusing the change), retitle the tray, persist.
///
/// The swap runs on the main thread: hotkey (un)registration is thread-bound
/// on Windows, so doing it from the command's worker thread silently fails to
/// unregister and registers a chord whose events never arrive.
#[cfg(desktop)]
#[tauri::command]
fn set_summon_hotkey(app: tauri::AppHandle, hotkey: String) -> Result<(), String> {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};
    let shortcut: Shortcut = hotkey
        .parse()
        .map_err(|e| format!("\"{hotkey}\" isn't a usable shortcut: {e}"))?;
    let previous = settings::settings(&app)
        .ok()
        .and_then(|s| s.summon_hotkey.clone())
        .and_then(|s| s.parse::<Shortcut>().ok());
    let (tx, rx) = std::sync::mpsc::channel();
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let shortcuts = handle.global_shortcut();
        let mut swapped = shortcuts.unregister_all().map_err(|e| e.to_string());
        if swapped.is_ok() {
            if let Err(e) = shortcuts.register(shortcut) {
                if let Some(old) = previous {
                    let _ = shortcuts.register(old);
                }
                swapped = Err(e.to_string());
            }
        }
        let _ = tx.send(swapped);
    })
    .map_err(|e| e.to_string())?;
    rx.recv()
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("couldn't register {hotkey}: {e}"))?;
    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_tooltip(Some(format!("asapnotes ({hotkey})")));
    }
    settings::update(&app, |s| {
        s.summon_hotkey = Some(hotkey);
        Ok(())
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        // Parsed settings live here for the process's lifetime.
        .manage(settings::Cache::default())
        .invoke_handler(tauri::generate_handler![
            quit,
            set_summon_hotkey,
            settings::get_settings,
            settings::set_appearance,
            settings::set_keybinds,
            settings::set_default_note_type,
            settings::set_map_view,
            settings::set_open_files_externally,
            settings::set_mcp_grant,
            settings::set_mcp_write_scope,
            settings::set_mcp_settings_access,
            notes::list_notes,
            notes::list_projects,
            notes::set_mcp_current_project,
            notes::mcp_status,
            notes::project_config_errors,
            notes::search_notes,
            notes::notes_root_path,
            notes::read_note,
            notes::read_file_text,
            notes::note_mtime,
            notes::save_note,
            notes::move_note,
            notes::create_folder,
            notes::delete_folder,
            notes::delete_note,
            notes::reveal_note,
            notes::reveal_path,
            notes::open_external,
            notes::list_drafts,
            notes::read_draft,
            notes::write_draft,
            notes::delete_draft,
            notes::discard_draft,
            notes::save_asset,
            notes::import_asset,
            notes::scan_projects,
            notes::folder_info,
            notes::create_project,
            notes::link_projects,
            notes::unlink_project,
            notes::set_project_path,
            notes::list_mounts,
            history::scan_changes,
            history::recent_changes,
            history::note_lens,
            notes::draft_lens,
            history::set_changes_seen,
            notes::add_mount,
            notes::create_virtual_folder,
            notes::remove_mount,
            notes::delete_mount,
            notes::folder_to_real,
            notes::folder_to_virtual,
            meeting::start_meeting_recording,
            meeting::stop_meeting_recording,
            meeting::meeting_recording_state,
            meeting::list_meeting_recordings,
            transcribe::transcription_status,
            transcribe::download_transcription,
            transcribe::cancel_transcription_download,
            transcribe::remove_transcription,
            transcribe::transcribe_meeting,
            transcribe::cancel_transcription,
            transcribe::take_transcript_result,
            settings::set_meeting_folder,
            settings::set_transcription_defaults,
            settings::set_workspaces,
            settings::set_current_workspace,
        ])
        .setup(|app| {
            #[cfg(desktop)]
            desktop::setup(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // Residency: closing the window hides it; the app lives in the tray.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
