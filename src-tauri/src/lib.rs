mod models;
mod state;
mod db;
mod commands;

use state::AppState;
use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // Determine the database path in the app data dir
            let app_data_dir = app.path().app_data_dir()
                .expect("Failed to get app data directory");
            std::fs::create_dir_all(&app_data_dir).ok();
            let db_path = app_data_dir.join("nexcape.db");
            let db_path_str = db_path.to_str().unwrap().to_string();

            // Initialize SQLite database synchronously via block_on
            let pool = tauri::async_runtime::block_on(async {
                db::init_db(&db_path_str).await.expect("Failed to initialize database")
            });

            // Register managed state
            app.manage(AppState::new(db_path_str));
            app.manage(pool);

            // Open DevTools in debug builds to inspect JS errors
            #[cfg(debug_assertions)]
            {
                use tauri::Manager;
                if let Some(win) = app.get_webview_window("main") {
                    win.open_devtools();
                }
            }

            Ok(())
        })

        .invoke_handler(tauri::generate_handler![
            // Tab navigation
            commands::navigate_tab,
            commands::tab_go_back,
            commands::tab_go_forward,
            commands::tab_reload,
            // Tab state commands
            commands::create_tab,
            commands::close_tab,
            commands::switch_tab,
            commands::get_tabs,
            commands::update_tab,
            commands::get_active_tab,
            // Webview JS eval
            commands::eval_in_webview,
            // Bookmark commands
            commands::add_bookmark,
            commands::remove_bookmark,
            commands::get_bookmarks,
            commands::is_bookmarked,
            // History commands
            commands::add_history_entry,
            commands::get_history,
            commands::search_history,
            commands::clear_history,
            // Settings commands
            commands::get_setting,
            commands::get_all_settings,
            commands::set_setting,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Nexcape");
}
