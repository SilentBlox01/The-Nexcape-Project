use sqlx::{SqlitePool, sqlite::{SqlitePoolOptions, SqliteConnectOptions}};
use std::path::Path;

pub async fn init_db(db_path: &str) -> Result<SqlitePool, sqlx::Error> {
    let path = Path::new(db_path);

    // Ensure the parent directory exists (propagate errors instead of silently ignoring)
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| sqlx::Error::Io(e))?;
    }

    // Use SqliteConnectOptions with explicit path — avoids Windows URL format issues
    let connect_options = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(true);

    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(connect_options)
        .await?;

    // Create tables if they don't exist
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS bookmarks (
            id          TEXT PRIMARY KEY NOT NULL,
            url         TEXT NOT NULL,
            title       TEXT NOT NULL,
            favicon_url TEXT,
            created_at  TEXT NOT NULL
        );
        "#,
    )
    .execute(&pool)
    .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS history (
            id          TEXT PRIMARY KEY NOT NULL,
            url         TEXT NOT NULL,
            title       TEXT NOT NULL,
            favicon_url TEXT,
            visited_at  TEXT NOT NULL
        );
        "#,
    )
    .execute(&pool)
    .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS settings (
            key   TEXT PRIMARY KEY NOT NULL,
            value TEXT NOT NULL
        );
        "#,
    )
    .execute(&pool)
    .await?;

    // Insert default settings if not already present
    sqlx::query(
        r#"
        INSERT OR IGNORE INTO settings (key, value) VALUES
            ('search_engine',      'https://www.startpage.com/search?q='),
            ('new_tab_bg',         'nebula'),
            ('new_tab_clock',      'true'),
            ('new_tab_speeddial',  'true'),
            ('save_history',       'true'),
            ('theme',              'dark');
        "#,
    )
    .execute(&pool)
    .await?;

    Ok(pool)
}
