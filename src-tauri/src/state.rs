use std::sync::Mutex;
use crate::models::Tab;

/// In-memory tab manager
pub struct TabManager {
    pub tabs: Vec<Tab>,
    pub active_tab_id: Option<String>,
}

impl TabManager {
    pub fn new() -> Self {
        TabManager {
            tabs: Vec::new(),
            active_tab_id: None,
        }
    }

    pub fn create_tab(&mut self, url: &str) -> Tab {
        // Deactivate all tabs
        for tab in &mut self.tabs {
            tab.is_active = false;
        }

        let mut tab = Tab::new(url);
        tab.is_active = true;
        self.active_tab_id = Some(tab.id.clone());
        self.tabs.push(tab.clone());
        tab
    }

    pub fn close_tab(&mut self, id: &str) -> Option<String> {
        let pos = self.tabs.iter().position(|t| t.id == id);
        if let Some(pos) = pos {
            let was_active = self.tabs[pos].is_active;
            self.tabs.remove(pos);

            // If we closed the active tab, activate the nearest one
            if was_active && !self.tabs.is_empty() {
                let new_pos = pos.saturating_sub(1).min(self.tabs.len() - 1);
                self.tabs[new_pos].is_active = true;
                let new_id = self.tabs[new_pos].id.clone();
                self.active_tab_id = Some(new_id.clone());
                return Some(new_id);
            } else if self.tabs.is_empty() {
                self.active_tab_id = None;
            }
        }
        self.active_tab_id.clone()
    }

    pub fn switch_tab(&mut self, id: &str) -> bool {
        for tab in &mut self.tabs {
            tab.is_active = tab.id == id;
        }
        if let Some(tab) = self.tabs.iter().find(|t| t.id == id) {
            self.active_tab_id = Some(tab.id.clone());
            true
        } else {
            false
        }
    }

    pub fn update_tab(&mut self, id: &str, url: Option<&str>, title: Option<&str>, is_loading: Option<bool>, favicon: Option<&str>) {
        if let Some(tab) = self.tabs.iter_mut().find(|t| t.id == id) {
            if let Some(u) = url { tab.url = u.to_string(); }
            if let Some(t) = title { tab.title = t.to_string(); }
            if let Some(l) = is_loading { tab.is_loading = l; }
            if let Some(f) = favicon { tab.favicon_url = Some(f.to_string()); }
        }
    }

    pub fn get_active_tab(&self) -> Option<&Tab> {
        self.tabs.iter().find(|t| t.is_active)
    }
}

/// Global shared application state
pub struct AppState {
    pub tab_manager: Mutex<TabManager>,
    #[allow(dead_code)]
    pub db_path: String,
}

impl AppState {
    pub fn new(db_path: String) -> Self {
        AppState {
            tab_manager: Mutex::new(TabManager::new()),
            db_path,
        }
    }
}
