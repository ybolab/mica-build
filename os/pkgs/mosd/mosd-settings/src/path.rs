//! Dot-path navigation over `serde_json` trees.

use serde_json::{Map, Value};

use crate::error::SettingsError;

/// Resolve a dot-path (e.g. `"network.eth0.dhcp"`) inside a JSON tree.
///
/// `""` or `"."` return `root` itself. Returns `None` when a segment is
/// missing, empty, or traverses a non-object node.
pub fn json_path_get<'a>(root: &'a Value, path: &str) -> Option<&'a Value> {
    if path.is_empty() || path == "." {
        return Some(root);
    }
    let mut node = root;
    for segment in path.split('.') {
        if segment.is_empty() {
            return None;
        }
        node = node.as_object()?.get(segment)?;
    }
    Some(node)
}

/// Split a non-root dot-path into segments, rejecting empty segments.
pub(crate) fn split_path(path: &str) -> Result<Vec<&str>, SettingsError> {
    let segments: Vec<&str> = path.split('.').collect();
    if segments.iter().any(|segment| segment.is_empty()) {
        return Err(SettingsError::NotFound(path.to_string()));
    }
    Ok(segments)
}

/// Write `value` at `segments`, creating missing intermediate objects.
pub(crate) fn json_path_set(
    root: &mut Value,
    segments: &[&str],
    value: Value,
) -> Result<(), SettingsError> {
    let (last, parents) = segments
        .split_last()
        .expect("split_path yields at least one segment");
    let mut node = root;
    let mut walked = String::new();
    for segment in parents {
        let object = node.as_object_mut().ok_or_else(|| not_a_table(&walked))?;
        node = object
            .entry((*segment).to_string())
            .or_insert_with(|| Value::Object(Map::new()));
        if !walked.is_empty() {
            walked.push('.');
        }
        walked.push_str(segment);
    }
    let object = node.as_object_mut().ok_or_else(|| not_a_table(&walked))?;
    object.insert((*last).to_string(), value);
    Ok(())
}

fn not_a_table(path: &str) -> SettingsError {
    SettingsError::Validation {
        path: path.to_string(),
        message: "not a table".to_string(),
    }
}
