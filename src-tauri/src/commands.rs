use tauri::{State, AppHandle, Manager};
use serde_json::Value;
use sqlx::SqlitePool;
use uuid::Uuid;
use chrono::Utc;

use crate::models::{Bookmark, Setting};
use crate::state::AppState;

// ── TAB NAVIGATION (WebviewWindow control) ───────────────────────────────────────

#[tauri::command]
pub fn navigate_tab(_label: String, _url: String, _app: AppHandle) -> Result<(), String> {
    // Navigation handled client-side via child webview recreation
    Ok(())
}

#[tauri::command]
pub fn tab_go_back(_label: String, _app: AppHandle) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub fn tab_go_forward(_label: String, _app: AppHandle) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub fn tab_reload(_label: String, _app: AppHandle) -> Result<(), String> {
    Ok(())
}



#[tauri::command]
pub fn eval_in_webview(label: String, script: String, app: AppHandle) -> Result<(), String> {
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("Webview '{}' not found", label))?;
    webview.eval(&script).map_err(|e| e.to_string())
}

// ── TABS ──────────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn create_tab(url: String, state: State<'_, AppState>) -> Result<crate::models::Tab, String> {
    let mut manager = state.tab_manager.lock().map_err(|e| e.to_string())?;
    let tab = manager.create_tab(&url);
    Ok(tab)
}

#[tauri::command]
pub fn close_tab(id: String, state: State<'_, AppState>) -> Result<Option<String>, String> {
    let mut manager = state.tab_manager.lock().map_err(|e| e.to_string())?;
    Ok(manager.close_tab(&id))
}

#[tauri::command]
pub fn switch_tab(id: String, state: State<'_, AppState>) -> Result<bool, String> {
    let mut manager = state.tab_manager.lock().map_err(|e| e.to_string())?;
    Ok(manager.switch_tab(&id))
}

#[tauri::command]
pub fn get_tabs(state: State<'_, AppState>) -> Result<Vec<crate::models::Tab>, String> {
    let manager = state.tab_manager.lock().map_err(|e| e.to_string())?;
    Ok(manager.tabs.clone())
}

#[tauri::command]
pub fn update_tab(
    id: String,
    url: Option<String>,
    title: Option<String>,
    is_loading: Option<bool>,
    favicon_url: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut manager = state.tab_manager.lock().map_err(|e| e.to_string())?;
    manager.update_tab(
        &id,
        url.as_deref(),
        title.as_deref(),
        is_loading,
        favicon_url.as_deref(),
    );
    Ok(())
}

#[tauri::command]
pub fn get_active_tab(state: State<'_, AppState>) -> Result<Option<crate::models::Tab>, String> {
    let manager = state.tab_manager.lock().map_err(|e| e.to_string())?;
    Ok(manager.get_active_tab().cloned())
}

// ── BOOKMARKS ─────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn add_bookmark(
    url: String,
    title: String,
    favicon_url: Option<String>,
    db: State<'_, SqlitePool>,
) -> Result<Bookmark, String> {
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();

    sqlx::query(
        "INSERT INTO bookmarks (id, url, title, favicon_url, created_at) VALUES (?, ?, ?, ?, ?)"
    )
    .bind(&id)
    .bind(&url)
    .bind(&title)
    .bind(&favicon_url)
    .bind(&now)
    .execute(db.inner())
    .await
    .map_err(|e| e.to_string())?;

    Ok(Bookmark {
        id,
        url,
        title,
        favicon_url,
        created_at: Utc::now(),
    })
}

#[tauri::command]
pub async fn remove_bookmark(id: String, db: State<'_, SqlitePool>) -> Result<(), String> {
    sqlx::query("DELETE FROM bookmarks WHERE id = ?")
        .bind(&id)
        .execute(db.inner())
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn get_bookmarks(db: State<'_, SqlitePool>) -> Result<Vec<Value>, String> {
    let rows = sqlx::query_as::<_, (String, String, String, Option<String>, String)>(
        "SELECT id, url, title, favicon_url, created_at FROM bookmarks ORDER BY created_at DESC"
    )
    .fetch_all(db.inner())
    .await
    .map_err(|e| e.to_string())?;

    let bookmarks: Vec<Value> = rows
        .into_iter()
        .map(|(id, url, title, favicon_url, created_at)| {
            serde_json::json!({
                "id": id,
                "url": url,
                "title": title,
                "favicon_url": favicon_url,
                "created_at": created_at,
            })
        })
        .collect();

    Ok(bookmarks)
}

#[tauri::command]
pub async fn is_bookmarked(url: String, db: State<'_, SqlitePool>) -> Result<Option<String>, String> {
    let row = sqlx::query_as::<_, (String,)>(
        "SELECT id FROM bookmarks WHERE url = ? LIMIT 1"
    )
    .bind(&url)
    .fetch_optional(db.inner())
    .await
    .map_err(|e| e.to_string())?;

    Ok(row.map(|(id,)| id))
}

// ── HISTORY ───────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn add_history_entry(
    url: String,
    title: String,
    favicon_url: Option<String>,
    db: State<'_, SqlitePool>,
) -> Result<(), String> {
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();

    sqlx::query(
        "INSERT INTO history (id, url, title, favicon_url, visited_at) VALUES (?, ?, ?, ?, ?)"
    )
    .bind(&id)
    .bind(&url)
    .bind(&title)
    .bind(&favicon_url)
    .bind(&now)
    .execute(db.inner())
    .await
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn get_history(db: State<'_, SqlitePool>) -> Result<Vec<Value>, String> {
    let rows = sqlx::query_as::<_, (String, String, String, Option<String>, String)>(
        "SELECT id, url, title, favicon_url, visited_at FROM history ORDER BY visited_at DESC LIMIT 200"
    )
    .fetch_all(db.inner())
    .await
    .map_err(|e| e.to_string())?;

    let entries: Vec<Value> = rows
        .into_iter()
        .map(|(id, url, title, favicon_url, visited_at)| {
            serde_json::json!({
                "id": id,
                "url": url,
                "title": title,
                "favicon_url": favicon_url,
                "visited_at": visited_at,
            })
        })
        .collect();

    Ok(entries)
}

#[tauri::command]
pub async fn search_history(query: String, db: State<'_, SqlitePool>) -> Result<Vec<Value>, String> {
    let pattern = format!("%{}%", query);
    let rows = sqlx::query_as::<_, (String, String, String, Option<String>, String)>(
        "SELECT id, url, title, favicon_url, visited_at FROM history WHERE url LIKE ? OR title LIKE ? ORDER BY visited_at DESC LIMIT 10"
    )
    .bind(&pattern)
    .bind(&pattern)
    .fetch_all(db.inner())
    .await
    .map_err(|e| e.to_string())?;

    let entries: Vec<Value> = rows
        .into_iter()
        .map(|(id, url, title, favicon_url, visited_at)| {
            serde_json::json!({
                "id": id,
                "url": url,
                "title": title,
                "favicon_url": favicon_url,
                "visited_at": visited_at,
            })
        })
        .collect();

    Ok(entries)
}

#[tauri::command]
pub async fn clear_history(db: State<'_, SqlitePool>) -> Result<(), String> {
    sqlx::query("DELETE FROM history")
        .execute(db.inner())
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ── SETTINGS ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_setting(key: String, db: State<'_, SqlitePool>) -> Result<Option<String>, String> {
    let row = sqlx::query_as::<_, (String,)>(
        "SELECT value FROM settings WHERE key = ?"
    )
    .bind(&key)
    .fetch_optional(db.inner())
    .await
    .map_err(|e| e.to_string())?;

    Ok(row.map(|(v,)| v))
}

#[tauri::command]
pub async fn get_all_settings(db: State<'_, SqlitePool>) -> Result<Vec<Setting>, String> {
    let rows = sqlx::query_as::<_, (String, String)>(
        "SELECT key, value FROM settings"
    )
    .fetch_all(db.inner())
    .await
    .map_err(|e| e.to_string())?;

    Ok(rows.into_iter().map(|(key, value)| Setting { key, value }).collect())
}

#[tauri::command]
pub async fn set_setting(key: String, value: String, db: State<'_, SqlitePool>) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    )
    .bind(&key)
    .bind(&value)
    .execute(db.inner())
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}
