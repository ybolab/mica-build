//! Notification-fed mirror of mosd's apply-task records.
//!
//! The registry follows the same lockout rule as [`crate::access_cache`]: it
//! serves only while a `TaskChanged` subscription is known live. A lapse
//! clears the mirror and forces callers back to `GetTask`; a generation check
//! prevents a direct read that raced a signal from overwriting the newer
//! record.

use std::collections::BTreeMap;
use std::sync::{Mutex, PoisonError};

/// One queued apply lifecycle, shared by the D-Bus client and HTTP surface.
#[derive(Clone, Debug, PartialEq, Eq, serde::Deserialize, serde::Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TaskRecord {
    pub id: String,
    pub operation: String,
    pub dot_path: String,
    pub source: String,
    pub status: String,
    pub enqueued_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub finished_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub outcome: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    pub folded_count: u64,
}

impl TaskRecord {
    pub fn terminal(&self) -> bool {
        self.status == "finished"
    }
}

#[derive(Default)]
struct Inner {
    synchronised: bool,
    generation: u64,
    tasks: BTreeMap<String, TaskRecord>,
}

#[derive(Default)]
pub struct TaskRegistry {
    inner: Mutex<Inner>,
}

impl TaskRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub fn get(&self, id: &str) -> Option<TaskRecord> {
        let inner = self.lock();
        inner
            .synchronised
            .then(|| inner.tasks.get(id).cloned())
            .flatten()
    }

    pub fn list(&self) -> Option<Vec<TaskRecord>> {
        let inner = self.lock();
        inner
            .synchronised
            .then(|| inner.tasks.values().cloned().collect())
    }

    pub fn generation(&self) -> u64 {
        self.lock().generation
    }

    /// Fill from a direct read only if no signal or subscription transition
    /// happened since `generation` was sampled.
    pub fn fill(&self, generation: u64, task: TaskRecord) {
        let mut inner = self.lock();
        if inner.synchronised && inner.generation == generation {
            inner.tasks.insert(task.id.clone(), task);
        }
    }

    pub fn fill_list(&self, generation: u64, tasks: Vec<TaskRecord>) {
        let mut inner = self.lock();
        if inner.synchronised && inner.generation == generation {
            inner.tasks = tasks
                .into_iter()
                .map(|task| (task.id.clone(), task))
                .collect();
        }
    }

    /// Apply a `TaskChanged` record. Bumping the generation invalidates any
    /// direct read that began before this notification arrived.
    pub fn update(&self, task: TaskRecord) {
        let mut inner = self.lock();
        if inner.synchronised {
            inner.generation += 1;
            inner.tasks.insert(task.id.clone(), task);
        }
    }

    pub fn subscribed(&self) {
        let mut inner = self.lock();
        inner.synchronised = true;
        inner.generation += 1;
        inner.tasks.clear();
    }

    pub fn lapsed(&self) {
        let mut inner = self.lock();
        inner.synchronised = false;
        inner.generation += 1;
        inner.tasks.clear();
    }

    #[cfg(test)]
    pub fn is_synchronised(&self) -> bool {
        self.lock().synchronised
    }
}

#[cfg(test)]
mod tests {
    use super::{TaskRecord, TaskRegistry};

    fn running(id: &str) -> TaskRecord {
        TaskRecord {
            id: id.to_string(),
            operation: "settings-write".to_string(),
            dot_path: "hostname".to_string(),
            source: ":1.7".to_string(),
            status: "running".to_string(),
            enqueued_at: "2026-08-31T00:00:00.000Z".to_string(),
            started_at: Some("2026-08-31T00:00:01.000Z".to_string()),
            finished_at: None,
            outcome: None,
            message: None,
            folded_count: 0,
        }
    }

    #[test]
    fn a_lapse_never_serves_a_stale_running_record() {
        let registry = TaskRegistry::new();
        registry.subscribed();
        registry.update(running("task-1"));
        assert_eq!(
            registry.get("task-1").expect("live record").status,
            "running"
        );

        registry.lapsed();
        assert_eq!(registry.get("task-1"), None);
        assert_eq!(registry.list(), None);
    }

    #[test]
    fn a_fill_that_raced_a_task_signal_is_discarded() {
        let registry = TaskRegistry::new();
        registry.subscribed();
        let generation = registry.generation();
        let mut finished = running("task-1");
        finished.status = "finished".to_string();
        finished.outcome = Some("succeeded".to_string());
        registry.update(finished.clone());
        registry.fill(generation, running("task-1"));

        assert_eq!(registry.get("task-1"), Some(finished));
    }
}
