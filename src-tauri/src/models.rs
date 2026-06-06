use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};
use uuid::Uuid;

/// Represents a browser tab (in-memory state)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tab {
    pub id: String,
    pub label: String, // Tauri webview label
    pub url: String,
    pub title: String,
    pub favicon_url: Option<String>,
    pub is_loading: bool,
    pub is_active: bool,
}

impl Tab {
    pub fn new(url: &str) -> Self {
        let id = Uuid::new_v4().to_string();
        let short_id = &id[..8];
        Tab {
            id: id.clone(),
            label: format!("tab-{}", short_id),
            url: url.to_string(),
            title: "New Tab".to_string(),
            favicon_url: None,
            is_loading: false,
            is_active: false,
        }
    }
}

/// A bookmark entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Bookmark {
    pub id: String,
    pub url: String,
    pub title: String,
    pub favicon_url: Option<String>,
    pub created_at: DateTime<Utc>,
}

/// A history entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryEntry {
    pub id: String,
    pub url: String,
    pub title: String,
    pub favicon_url: Option<String>,
    pub visited_at: DateTime<Utc>,
}

/// App settings stored as key-value pairs
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Setting {
    pub key: String,
    pub value: String,
}
