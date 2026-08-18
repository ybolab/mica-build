//! Minimal async facade over the mosd settings/state API.
//!
//! Handlers depend on this trait so tests can substitute an in-memory fake
//! for the D-Bus client.

use serde_json::Value;

/// The three mosd operations webd needs, JSON in and out.
#[async_trait::async_trait]
pub trait SettingsApi: Send + Sync {
    /// Settings subtree at dot-path `path` (`""` = whole tree).
    async fn get_settings(&self, path: &str) -> anyhow::Result<Value>;
    /// Write `value` at dot-path `path`.
    async fn set_settings(&self, path: &str, value: &Value) -> anyhow::Result<()>;
    /// Live-state subtree at dot-path `path` (`""` = whole tree).
    async fn get_state(&self, path: &str) -> anyhow::Result<Value>;
}

/// In-memory [`SettingsApi`] used by the route tests.
#[cfg(test)]
pub struct FakeSettings {
    tree: std::sync::Mutex<Value>,
    state: std::sync::Mutex<Value>,
}

#[cfg(test)]
impl FakeSettings {
    pub fn new(tree: Value) -> Self {
        Self {
            tree: std::sync::Mutex::new(tree),
            state: std::sync::Mutex::new(Value::Object(serde_json::Map::new())),
        }
    }
}

#[cfg(test)]
fn fake_get(root: &Value, path: &str) -> anyhow::Result<Value> {
    if path.is_empty() {
        return Ok(root.clone());
    }
    path.split('.')
        .try_fold(root, |node, segment| node.get(segment))
        .cloned()
        .ok_or_else(|| anyhow::anyhow!("path not found: `{path}`"))
}

#[cfg(test)]
#[async_trait::async_trait]
impl SettingsApi for FakeSettings {
    async fn get_settings(&self, path: &str) -> anyhow::Result<Value> {
        fake_get(&self.tree.lock().unwrap(), path)
    }

    async fn set_settings(&self, path: &str, value: &Value) -> anyhow::Result<()> {
        let mut segments: Vec<&str> = path.split('.').collect();
        let last = segments.pop().expect("split yields at least one segment");
        let mut tree = self.tree.lock().unwrap();
        let mut node = &mut *tree;
        for segment in segments {
            node = node
                .as_object_mut()
                .ok_or_else(|| anyhow::anyhow!("not an object at `{segment}`"))?
                .entry(segment.to_string())
                .or_insert_with(|| Value::Object(serde_json::Map::new()));
        }
        node.as_object_mut()
            .ok_or_else(|| anyhow::anyhow!("not an object at `{last}`"))?
            .insert(last.to_string(), value.clone());
        Ok(())
    }

    async fn get_state(&self, path: &str) -> anyhow::Result<Value> {
        fake_get(&self.state.lock().unwrap(), path)
    }
}
