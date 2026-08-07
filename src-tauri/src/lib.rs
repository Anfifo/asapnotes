mod notes;

#[cfg(desktop)]
mod desktop {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
    use tauri::{App, AppHandle, Emitter, Manager};
    use tauri_plugin_global_shortcut::{
        Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState,
    };

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

        // Saved external projects: let the asset protocol serve their images
        // (preview); newly added ones are granted in add_external_projects.
        if let Ok(map) = crate::notes::external_map(app.handle()) {
            for dir in map.values() {
                let _ = app.asset_protocol_scope().allow_directory(dir, true);
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

        let summon = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::Space);
        app.handle().plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, event| {
                    if shortcut == &summon && event.state() == ShortcutState::Pressed {
                        toggle_main_window(app);
                    }
                })
                .build(),
        )?;
        // A failed registration (hotkey taken by another app) shouldn't kill the
        // app — the tray still works. Configurable hotkey comes later.
        if let Err(e) = app.global_shortcut().register(summon) {
            eprintln!("failed to register Ctrl+Alt+Space: {e}");
        }

        let open = MenuItem::with_id(app, "open", "Open", true, None::<&str>)?;
        let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
        let menu = Menu::with_items(app, &[&open, &quit])?;
        // The tray is where the mark matters most — pin its icon to the 32px brand
        // asset rather than inheriting whatever the window icon resource resolves to.
        let tray_icon = tauri::image::Image::from_bytes(include_bytes!("../icons/32x32.png"))?;
        TrayIconBuilder::with_id("main")
            .icon(tray_icon)
            .tooltip("asapnotes (Ctrl+Alt+Space)")
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            quit,
            notes::list_notes,
            notes::list_projects,
            notes::notes_root_path,
            notes::read_note,
            notes::save_note,
            notes::move_note,
            notes::list_drafts,
            notes::read_draft,
            notes::write_draft,
            notes::delete_draft,
            notes::save_asset,
            notes::import_asset,
            notes::scan_projects,
            notes::add_external_projects,
            notes::remove_external_project,
            notes::set_external_path,
            notes::list_external_projects,
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
