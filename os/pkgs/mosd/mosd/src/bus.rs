//! D-Bus service implementation for `com.mos.mosd`.
//!
//! Exposes the settings tree and the live-state tree on the bus as the
//! `com.mos.mosd1` interface at [`OBJECT_PATH`], owned under [`BUS_NAME`].

use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use mosd_settings::{Settings, SettingsError, Store, json_path_get};
use serde_json::Value;
use tokio::sync::{Mutex, watch};
use zbus::fdo;
use zbus::message::Header;
use zbus::object_server::SignalEmitter;

use crate::power::PowerControl;
use crate::rauc::{self, RaucClient};
use crate::reconciler::Reconciler;
use crate::scan::Registry;
use crate::transient;

/// Well-known bus name owned by the daemon.
pub const BUS_NAME: &str = "com.mos.mosd";
/// Object path the service is registered at.
pub const OBJECT_PATH: &str = "/com/mos/mosd";

/// True when `a` and `b` overlap by dot segments in either direction:
/// one path is a segment-wise prefix of the other. The root path (`""` or
/// `"."`) matches everything.
pub fn paths_overlap(a: &str, b: &str) -> bool {
    let a = if a == "." { "" } else { a };
    let b = if b == "." { "" } else { b };
    if a.is_empty() || b.is_empty() {
        return true;
    }
    let mut a = a.split('.');
    let mut b = b.split('.');
    loop {
        match (a.next(), b.next()) {
            (Some(x), Some(y)) if x == y => {}
            (Some(_), Some(_)) => return false,
            _ => return true,
        }
    }
}

/// Mutable trees guarded by one lock so settings writes and live-state
/// updates stay consistent.
struct Inner {
    settings: Settings,
    state: Value,
}

/// The `com.mos.mosd1` service: settings tree, live-state tree, store,
/// reconcilers, the power control, the update installer client and the shadow
/// file a transient root password is written into.
pub struct MosdService {
    store: Store,
    reconcilers: Vec<Box<dyn Reconciler>>,
    power: Box<dyn PowerControl>,
    /// The update installer (RAUC) client. `Arc` rather than `Box` because a
    /// running install outlives the bus call that started it: the background
    /// task holds its own handle. Defaults to [`rauc::DryRunRauc`]; production
    /// swaps in the real client via [`Self::with_rauc`].
    rauc: Arc<dyn RaucClient>,
    /// True while a bundle install is in flight. `InstallUpdate` refuses a
    /// second install rather than queueing it: RAUC itself answers
    /// `AlreadyInstalling` to a concurrent request, and refusing here keeps
    /// the recorded `update.install` entry describing exactly one operation.
    installing: Arc<AtomicBool>,
    shadow_path: PathBuf,
    /// `Arc` so the install background task can record its outcome into the
    /// live-state tree after the bus call that spawned it has returned.
    inner: Arc<Mutex<Inner>>,
    /// Bumped after every mutation of either tree; the `com.mos.Item1` façade
    /// (`crate::tree`) watches it to project changes onto the bus.
    changed: watch::Sender<u64>,
    /// The service registry the scan task fills ([`crate::scan`]), shared so
    /// that `ForgetService` drops an entry from the same table the scan
    /// publishes from — one table, so the bus surface and the live-state tree
    /// cannot disagree about which services exist.
    ///
    /// `None` when no scan was constructed (dry run), which is the one state
    /// in which `ForgetService` has nothing to act on.
    registry: Option<Arc<Registry>>,
}

impl MosdService {
    /// Build the service around loaded `settings` and an initial live-state
    /// root (an empty object, or `{"dry_run": true}` in dry-run mode).
    ///
    /// `shadow_path` is a parameter for the same reason every reconciler path
    /// is: a test points it at a temporary file and can then drive the real
    /// transient-password method without touching the host's `/etc/shadow`.
    pub fn new(
        store: Store,
        settings: Settings,
        reconcilers: Vec<Box<dyn Reconciler>>,
        power: Box<dyn PowerControl>,
        shadow_path: PathBuf,
        state: Value,
    ) -> Self {
        Self {
            store,
            reconcilers,
            power,
            rauc: Arc::new(rauc::DryRunRauc),
            installing: Arc::new(AtomicBool::new(false)),
            shadow_path,
            inner: Arc::new(Mutex::new(Inner { settings, state })),
            changed: watch::channel(0).0,
            registry: None,
        }
    }

    /// Attach the update installer client.
    ///
    /// A builder step rather than a [`Self::new`] parameter for the same
    /// reason as [`Self::with_service_registry`]: the default —
    /// [`rauc::DryRunRauc`], which never touches the host — is the correct
    /// client for every test, and only `main.rs` ever has a production
    /// [`rauc::Rauc`] to hand over.
    #[must_use]
    pub fn with_rauc(mut self, rauc: Arc<dyn RaucClient>) -> Self {
        self.rauc = rauc;
        self
    }

    /// Attach the service registry this daemon's scan task fills.
    ///
    /// A separate step rather than a [`Self::new`] parameter because the
    /// registry only exists when a scan does: the daemon is built the same way
    /// either way, and a dry-run daemon — which constructs no scan at all —
    /// does not have to name a registry it will never have.
    #[must_use]
    pub fn with_service_registry(mut self, registry: Arc<Registry>) -> Self {
        self.registry = Some(registry);
        self
    }

    /// Write the service registry into the live-state tree under
    /// [`crate::scan::STATE_KEY`], replacing it wholesale.
    ///
    /// The registry is rendered as one value rather than patched key by key so
    /// that `instance_collision`, which is a property of the whole table
    /// rather than of one entry, is never observable half-applied.
    pub async fn publish_services(&self, services: Value) {
        let mut inner = self.inner.lock().await;
        if let Some(root) = inner.state.as_object_mut() {
            root.insert(crate::scan::STATE_KEY.to_string(), services);
        }
        drop(inner);
        self.mark_changed();
    }

    /// Subscribe to tree-change notifications for the item façade. The
    /// receiver coalesces: marks arriving while unread collapse into one wake.
    pub fn subscribe_changes(&self) -> watch::Receiver<u64> {
        self.changed.subscribe()
    }

    /// Clones of the two trees the item façade projects: the settings tree
    /// rendered to JSON, and the live-state tree.
    pub async fn trees(&self) -> (Value, Value) {
        let inner = self.inner.lock().await;
        let settings = inner.settings.get("").unwrap_or(Value::Null);
        (settings, inner.state.clone())
    }

    /// Record that a tree mutation completed; called after the mutation so an
    /// observer that snapshots on the mark always sees the finished write.
    ///
    /// Reachable from [`crate::actions`] as well, whose forced re-zero
    /// (`docs/design/bus.md` §7) is a change no tree write marks.
    pub(crate) fn mark_changed(&self) {
        self.changed.send_modify(|generation| *generation += 1);
    }

    /// Log a power request from `sender` and record it in the live-state tree
    /// under `power`, with `update_warning` — an unconfirmed-slot warning, when
    /// there is one — recorded beside it (absent key when there is none, the
    /// same convention the settings tree uses for optional values).
    ///
    /// Always called BEFORE the action: once systemd starts tearing the
    /// machine down there may be no system left to log on.
    async fn note_power_request(&self, action: &str, sender: &str, update_warning: Option<String>) {
        tracing::warn!(action, sender, "power action requested");
        let mut entry = serde_json::Map::new();
        entry.insert("last_action".into(), Value::String(action.to_string()));
        entry.insert("requested_by".into(), Value::String(sender.to_string()));
        if let Some(warning) = update_warning {
            entry.insert("update_warning".into(), Value::String(warning));
        }
        let mut inner = self.inner.lock().await;
        if let Some(root) = inner.state.as_object_mut() {
            root.insert("power".to_string(), Value::Object(entry));
        }
        drop(inner);
        self.mark_changed();
    }

    /// The unconfirmed-slot warning a reboot should carry, or `None`.
    ///
    /// Read fresh from RAUC rather than from the live-state tree: the recorded
    /// `update` entry is only as new as the last query, and the whole point of
    /// warning is the install that just happened.
    ///
    /// Bounded and non-fatal BY DESIGN: a reboot must go through even when
    /// RAUC is absent (v1 image, container, dry-run), wedged, or slow — a
    /// power action that hangs on an installer is strictly worse than one that
    /// misses a warning. Failures are logged and answered with `None`.
    async fn reboot_update_warning(&self) -> Option<String> {
        const SLOT_QUERY_TIMEOUT: Duration = Duration::from_secs(2);
        let query = async {
            let slots = self.rauc.slot_status().await?;
            let primary = self.rauc.primary().await?;
            anyhow::Ok((slots, primary))
        };
        match tokio::time::timeout(SLOT_QUERY_TIMEOUT, query).await {
            Ok(Ok((slots, primary))) => rauc::unconfirmed_slot_warning(&slots, primary.as_deref()),
            Ok(Err(err)) => {
                tracing::debug!(error = %err, "slot status unavailable before reboot; proceeding");
                None
            }
            Err(_) => {
                tracing::warn!(
                    timeout = ?SLOT_QUERY_TIMEOUT,
                    "rauc did not answer the pre-reboot slot query in time; proceeding"
                );
                None
            }
        }
    }

    /// Reboot the machine on behalf of `sender`.
    ///
    /// Update-aware: the slot status is read first, and a slot that is
    /// installed-but-not-confirmed — a reboot into it burns one of its
    /// boot attempts — is logged and recorded in the `power` live-state entry
    /// BEFORE the reboot fires. A warning, not a refusal: booting the new slot
    /// is exactly what the operator installing an update wants, and the
    /// attempt-burning edge case (rebooting *again* before the health gate
    /// confirms) is one the operator must be able to drive through anyway.
    ///
    /// Split out from the D-Bus method so unit tests can drive it without
    /// forging a message header.
    pub async fn request_reboot(&self, sender: &str) -> fdo::Result<()> {
        let warning = self.reboot_update_warning().await;
        if let Some(warning) = &warning {
            tracing::warn!(warning, "rebooting with an unconfirmed update slot");
        }
        self.note_power_request("reboot", sender, warning).await;
        self.power
            .reboot()
            .await
            .map_err(|err| fdo::Error::Failed(format!("reboot: {err}")))
    }

    /// Power the machine off on behalf of `sender`.
    ///
    /// No unconfirmed-slot warning here, deliberately: a power-off does not
    /// boot anything, so it spends no boot attempt. The attempt is spent by
    /// whatever powers the machine back ON, which is not an event mosd can
    /// see, let alone warn about.
    pub async fn request_power_off(&self, sender: &str) -> fdo::Result<()> {
        self.note_power_request("power_off", sender, None).await;
        self.power
            .power_off()
            .await
            .map_err(|err| fdo::Error::Failed(format!("power off: {err}")))
    }

    /// Install the update bundle at absolute path `bundle_path`, on behalf of
    /// `sender`. Validates the path, refuses a concurrent install, records
    /// `update.install` as `running`, and returns — the install itself runs on
    /// a background task that records `done`/`failed` (plus a fresh status
    /// query) when RAUC reports completion. Neither the service lock nor the
    /// bus dispatcher is held across the install.
    ///
    /// Split out from the D-Bus method so unit tests can drive it without
    /// forging a message header.
    pub async fn request_install(&self, sender: &str, bundle_path: &str) -> fdo::Result<()> {
        let bundle = rauc::validate_bundle_path(bundle_path).map_err(fdo::Error::InvalidArgs)?;
        // The in-flight flag is taken BEFORE anything is recorded, in one
        // compare-exchange, so two racing calls cannot both proceed. It is
        // released only by the background task — including on install failure —
        // so an early return below must not happen after this point without
        // clearing it (there is none: the spawn is infallible).
        if self
            .installing
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            return Err(fdo::Error::Failed(
                "an update install is already running; query GetUpdateState and retry".into(),
            ));
        }
        tracing::warn!(bundle = %bundle.display(), sender, "update install requested");
        let started = serde_json::json!({
            "status": "running",
            "bundle": bundle.to_string_lossy(),
            "requested_by": sender,
        });
        let mut inner = self.inner.lock().await;
        rauc::update_entry(&mut inner.state).insert("install".into(), started);
        drop(inner);
        self.mark_changed();

        let rauc_client = Arc::clone(&self.rauc);
        let inner = Arc::clone(&self.inner);
        let installing = Arc::clone(&self.installing);
        let changed = self.changed.clone();
        let sender = sender.to_string();
        tokio::spawn(async move {
            let result = rauc_client.install_bundle(&bundle).await;
            let outcome = match &result {
                Ok(()) => {
                    tracing::info!(bundle = %bundle.display(), "update install finished");
                    serde_json::json!({
                        "status": "done",
                        "bundle": bundle.to_string_lossy(),
                        "requested_by": sender,
                    })
                }
                Err(err) => {
                    tracing::error!(bundle = %bundle.display(), error = %err, "update install failed");
                    serde_json::json!({
                        "status": "failed",
                        "bundle": bundle.to_string_lossy(),
                        "requested_by": sender,
                        "error": format!("{err:#}"),
                    })
                }
            };
            // Refresh the whole update entry while the outcome is fresh, so
            // the recorded slots show what the install just changed. Best
            // effort: the install outcome above is recorded either way.
            let refreshed = rauc::query(rauc_client.as_ref()).await.ok();
            let mut inner = inner.lock().await;
            let entry = rauc::update_entry(&mut inner.state);
            entry.insert("install".into(), outcome);
            if let Some(refreshed) = &refreshed {
                refreshed.merge_into(entry);
            }
            drop(inner);
            // Release the flag only after the outcome is recorded: a caller
            // admitted at this point sees `done`/`failed`, never a stale
            // `running` beside an idle flag.
            installing.store(false, Ordering::Release);
            changed.send_modify(|generation| *generation += 1);
        });
        Ok(())
    }

    /// Query RAUC's operation, last error, progress, slot statuses and primary
    /// slot; record them under `update` in the live-state tree; return the
    /// recorded entry as JSON.
    ///
    /// The queries run WITHOUT the service lock — a wedged installer must not
    /// stall every other bus method — and the lock is taken only for the
    /// merge. On a query failure nothing is recorded (the last known entry
    /// stays) and the error goes to the caller, who is the one polling and can
    /// tell staleness from absence.
    pub async fn refresh_update_state(&self) -> fdo::Result<String> {
        let query = rauc::query(self.rauc.as_ref())
            .await
            .map_err(|err| fdo::Error::Failed(format!("query rauc: {err:#}")))?;
        let mut inner = self.inner.lock().await;
        let entry = rauc::update_entry(&mut inner.state);
        query.merge_into(entry);
        let rendered = Value::Object(entry.clone()).to_string();
        drop(inner);
        self.mark_changed();
        Ok(rendered)
    }

    /// Manually mark a slot `good` or `bad`, on behalf of `sender`; answers
    /// RAUC's `(slot_name, message)`.
    ///
    /// The operator escape hatch over the boot health gate (`mos-health`),
    /// which owns the automatic confirm — see `crate::rauc`'s module docs for
    /// why mosd never marks anything on its own. `state` is validated down to
    /// `good`/`bad` and `slot` to `booted`/`other` BEFORE RAUC is asked;
    /// activation (`active`) is the installer's job and is not offered.
    pub async fn request_mark(
        &self,
        sender: &str,
        state: &str,
        slot: &str,
    ) -> fdo::Result<(String, String)> {
        rauc::validate_mark(state, slot).map_err(fdo::Error::InvalidArgs)?;
        tracing::warn!(state, slot, sender, "manual slot mark requested");
        let (slot_name, message) = self
            .rauc
            .mark(state, slot)
            .await
            .map_err(|err| fdo::Error::Failed(format!("rauc mark: {err:#}")))?;
        let mut inner = self.inner.lock().await;
        rauc::update_entry(&mut inner.state).insert(
            "last_mark".into(),
            serde_json::json!({
                "state": state,
                "slot": slot,
                "slot_name": slot_name,
                "message": message,
                "requested_by": sender,
            }),
        );
        drop(inner);
        self.mark_changed();
        Ok((slot_name, message))
    }

    /// Write `value` at settings dot-path `path`: validate it against the
    /// typed tree, persist it atomically, then re-apply every reconciler whose
    /// subtree overlaps `path` and record each result in the live-state tree.
    ///
    /// The ONE settings-write path inside the daemon. `SetSettings` below and
    /// the `com.mos.Item1` façade's `SetValue` ([`crate::tree`]) both come
    /// through here, so the two write paths cannot diverge
    /// (`docs/design/bus.md` §1.2). On any error nothing is stored, nothing is
    /// persisted and no reconciler runs.
    ///
    /// # Errors
    ///
    /// Whatever [`Settings::set`](mosd_settings::Settings::set) or
    /// [`Store::save`] rejected the write with.
    pub async fn write_setting(&self, path: &str, value: Value) -> Result<(), SettingsError> {
        let mut inner = self.inner.lock().await;
        let mut candidate = inner.settings.clone();
        candidate.set(path, value)?;
        self.store.save(&candidate)?;
        inner.settings = candidate;
        let settings = inner.settings.clone();
        for reconciler in &self.reconcilers {
            if paths_overlap(path, reconciler.subtree()) {
                let result = reconciler.apply(&settings).await;
                record(&mut inner.state, reconciler.name(), result);
            }
        }
        drop(inner);
        self.mark_changed();
        Ok(())
    }

    /// Run every reconciler against the current settings, recording each
    /// result in the live-state tree. Errors are recorded, never propagated.
    pub async fn apply_all(&self) {
        let mut inner = self.inner.lock().await;
        let settings = inner.settings.clone();
        for reconciler in &self.reconcilers {
            let result = reconciler.apply(&settings).await;
            record(&mut inner.state, reconciler.name(), result);
        }
        drop(inner);
        self.mark_changed();
    }
}

/// Store a reconciler `result` in the live-state tree under `name`; a failure
/// is logged and recorded as `{"error": "..."}`.
fn record(state: &mut Value, name: &str, result: anyhow::Result<Value>) {
    let entry = match result {
        Ok(value) => value,
        Err(err) => {
            tracing::error!(reconciler = name, error = %err, "reconciler apply failed");
            serde_json::json!({ "error": err.to_string() })
        }
    };
    if let Some(map) = state.as_object_mut() {
        map.insert(name.to_string(), entry);
    }
}

/// Unique bus name of the caller, or `"(unknown)"` on an unnamed message.
///
/// Shared with the item façade ([`crate::tree`]), so a power action triggered
/// through `/Actions/<verb>` is attributed exactly as one called through
/// `Reboot`/`PowerOff` is.
pub(crate) fn sender_of<'a>(header: &'a Header<'a>) -> &'a str {
    header.sender().map_or("(unknown)", |name| name.as_str())
}

/// D-Bus error name for a settings dot-path that does not resolve.
pub const NOT_FOUND_ERROR: &str = "com.mos.mosd1.Error.NotFound";
/// D-Bus error name for a settings dot-path that exists but rejects writes.
pub const READ_ONLY_ERROR: &str = "com.mos.mosd1.Error.ReadOnly";

/// Reply error of the settings methods.
///
/// `NotFound` and `ReadOnly` carry interface-scoped error names, because the
/// standard fdo vocabulary has no name that separates "the dot-path does not
/// exist" and "the dot-path rejects writes" from "the value is bad" — mapping
/// all three onto `InvalidArgs` destroyed the distinction at the bus boundary
/// and left apid answering one HTTP status for three conditions. Every other
/// failure keeps the standard fdo name it always had, delegated to
/// [`fdo::Error`] so its replies stay byte-identical.
#[derive(Debug)]
enum SettingsFault {
    /// [`NOT_FOUND_ERROR`], from [`SettingsError::NotFound`].
    NotFound(String),
    /// [`READ_ONLY_ERROR`], from [`SettingsError::ReadOnly`].
    ReadOnly(String),
    /// Everything else, under its standard fdo name.
    Fdo(fdo::Error),
}

impl zbus::DBusError for SettingsFault {
    fn name(&self) -> zbus::names::ErrorName<'_> {
        match self {
            Self::NotFound(_) => zbus::names::ErrorName::from_static_str_unchecked(NOT_FOUND_ERROR),
            Self::ReadOnly(_) => zbus::names::ErrorName::from_static_str_unchecked(READ_ONLY_ERROR),
            Self::Fdo(err) => err.name(),
        }
    }

    fn description(&self) -> Option<&str> {
        match self {
            Self::NotFound(message) | Self::ReadOnly(message) => Some(message),
            Self::Fdo(err) => err.description(),
        }
    }

    fn create_reply(&self, call: &Header<'_>) -> zbus::Result<zbus::message::Message> {
        match self {
            Self::Fdo(err) => err.create_reply(call),
            // The reply body is the description string, the same single-`s`
            // shape every fdo error reply carries.
            _ => zbus::message::Message::error(call, self.name())?
                .build(&self.description().unwrap_or_default()),
        }
    }
}

/// Map settings errors onto D-Bus error names.
fn to_bus_error(err: SettingsError) -> SettingsFault {
    match err {
        SettingsError::NotFound(_) => SettingsFault::NotFound(err.to_string()),
        SettingsError::ReadOnly(_) => SettingsFault::ReadOnly(err.to_string()),
        SettingsError::Validation { .. } => {
            SettingsFault::Fdo(fdo::Error::InvalidArgs(err.to_string()))
        }
        SettingsError::Io(_) => SettingsFault::Fdo(fdo::Error::IOError(err.to_string())),
        SettingsError::Parse(_) | SettingsError::Migration(_) => {
            SettingsFault::Fdo(fdo::Error::Failed(err.to_string()))
        }
    }
}

/// Map a transient-password failure onto a D-Bus error.
///
/// Always `Failed`: the caller cannot distinguish a rejected password from an
/// unwritable shadow file, and neither is worth leaking more detail over. The
/// message is the anyhow chain, which by construction carries lengths and rule
/// names but never the password itself — `transient::validate` never echoes its
/// input.
fn transient_to_fdo(err: anyhow::Error) -> fdo::Error {
    fdo::Error::Failed(format!("set transient root password: {err:#}"))
}

#[zbus::interface(name = "com.mos.mosd1")]
impl MosdService {
    /// JSON-encoded settings value at dot-path `path` (`""` = whole tree).
    async fn get_settings(&self, path: &str) -> Result<String, SettingsFault> {
        let inner = self.inner.lock().await;
        let value = inner.settings.get(path).map_err(to_bus_error)?;
        Ok(value.to_string())
    }

    /// Parse `value_json`, write it at `path`, persist atomically, re-apply
    /// the reconcilers whose subtree overlaps `path`, then emit
    /// [`SettingsChanged`](Self::settings_changed).
    async fn set_settings(
        &self,
        #[zbus(signal_emitter)] emitter: SignalEmitter<'_>,
        path: &str,
        value_json: &str,
    ) -> Result<(), SettingsFault> {
        let value: Value = serde_json::from_str(value_json).map_err(|err| {
            SettingsFault::Fdo(fdo::Error::InvalidArgs(format!("invalid JSON value: {err}")))
        })?;
        self.write_setting(path, value).await.map_err(to_bus_error)?;
        Self::settings_changed(&emitter, path, value_json)
            .await
            .map_err(|err| {
                SettingsFault::Fdo(fdo::Error::Failed(format!("emit SettingsChanged: {err}")))
            })?;
        Ok(())
    }

    /// JSON-encoded live-state subtree at dot-path `path` (`""` = whole tree).
    async fn get_state(&self, path: &str) -> fdo::Result<String> {
        let inner = self.inner.lock().await;
        let value = json_path_get(&inner.state, path)
            .ok_or_else(|| fdo::Error::InvalidArgs(format!("state path not found: `{path}`")))?;
        Ok(value.to_string())
    }

    /// Record a component health report in the live-state tree under
    /// `health.<component>` as `{"status": ..., "detail": ...}`.
    ///
    /// Used by the boot health gate (`mos-health`) to surface non-fatal
    /// pressure — a full `/var`, for example — without failing the gate.
    async fn report_health(&self, component: &str, status: &str, detail: &str) -> fdo::Result<()> {
        // The live-state tree lives in RAM for the life of the daemon, and
        // this is its only write surface that accepts arbitrary keys and
        // strings with no pruning. Callers are root-only, so the caps guard
        // against a wedged or looping reporter, not an attacker — but a root
        // daemon that can be grown without bound by a misbehaving oneshot is
        // still a daemon that eventually takes the device down with it.
        const MAX_COMPONENT_LEN: usize = 64;
        const MAX_STATUS_LEN: usize = 64;
        const MAX_DETAIL_LEN: usize = 1024;
        const MAX_COMPONENTS: usize = 128;
        if component.is_empty() {
            return Err(fdo::Error::InvalidArgs(
                "component must not be empty".into(),
            ));
        }
        if component.len() > MAX_COMPONENT_LEN
            || status.len() > MAX_STATUS_LEN
            || detail.len() > MAX_DETAIL_LEN
        {
            return Err(fdo::Error::InvalidArgs(format!(
                "health report too large: component <= {MAX_COMPONENT_LEN}, \
                 status <= {MAX_STATUS_LEN}, detail <= {MAX_DETAIL_LEN} bytes"
            )));
        }
        let mut inner = self.inner.lock().await;
        if let Some(root) = inner.state.as_object_mut() {
            let health = root
                .entry("health")
                .or_insert_with(|| Value::Object(serde_json::Map::new()));
            if let Some(health) = health.as_object_mut() {
                if !health.contains_key(component) && health.len() >= MAX_COMPONENTS {
                    return Err(fdo::Error::InvalidArgs(format!(
                        "health table already holds {MAX_COMPONENTS} components; \
                         refusing a new one"
                    )));
                }
                health.insert(
                    component.to_string(),
                    serde_json::json!({ "status": status, "detail": detail }),
                );
            }
        }
        drop(inner);
        self.mark_changed();
        tracing::info!(component, status, detail, "health report recorded");
        Ok(())
    }

    /// Drop a DISCONNECTED service from the registry (`crate::scan`).
    ///
    /// Exported as `ForgetService`. Refuses a service that is still connected,
    /// and a name the registry does not carry, with
    /// [`InvalidArgs`](fdo::Error::InvalidArgs).
    ///
    /// # Why retention plus an explicit removal, rather than auto-eviction
    ///
    /// A service that vanishes is kept with `connected: false` instead of
    /// being deleted, because the two states an operator most needs to tell
    /// apart look identical once an entry is gone: a service that was never
    /// installed, and a service that was installed and has stopped appearing.
    /// Auto-eviction turns the second into the first — the registry would look
    /// tidy and correct while quietly withholding the one fact that explains
    /// why a device stopped reporting. So the entry stays, saying exactly what
    /// is true (this service is known and is not here), and it leaves only
    /// when someone who knows it is not coming back says so.
    ///
    /// Refusing to forget a CONNECTED service is the other half of that: the
    /// scan would re-add it on its next event, so accepting the call would be
    /// a removal that silently undoes itself, which is worse than a refusal
    /// that says what happened.
    async fn forget_service(&self, bus_name: &str) -> fdo::Result<()> {
        let registry = self.registry.as_ref().ok_or_else(|| {
            fdo::Error::Failed("no service registry: this daemon runs no scan".to_string())
        })?;
        let snapshot = registry.forget(bus_name)?;
        self.publish_services(snapshot).await;
        tracing::info!(service = bus_name, "service forgotten by request");
        Ok(())
    }

    /// Reboot the appliance through systemd.
    ///
    /// The request is logged and recorded in the live-state tree before the
    /// call is made.
    async fn reboot(&self, #[zbus(header)] header: Header<'_>) -> fdo::Result<()> {
        self.request_reboot(sender_of(&header)).await
    }

    /// Power the appliance off through systemd.
    ///
    /// The request is logged and recorded in the live-state tree before the
    /// call is made.
    async fn power_off(&self, #[zbus(header)] header: Header<'_>) -> fdo::Result<()> {
        self.request_power_off(sender_of(&header)).await
    }

    /// Install the update bundle at absolute path `bundle_path` through RAUC.
    ///
    /// Exported as `InstallUpdate`. Answers as soon as the install has been
    /// validated, recorded and handed to a background task; progress and the
    /// outcome are read back through `GetUpdateState` (or the `update` subtree
    /// of `GetState`). Refuses a relative path, a path that does not name an
    /// existing regular file, and a second install while one runs.
    async fn install_update(
        &self,
        #[zbus(header)] header: Header<'_>,
        bundle_path: &str,
    ) -> fdo::Result<()> {
        self.request_install(sender_of(&header), bundle_path).await
    }

    /// Query RAUC and answer the JSON-encoded `update` live-state entry:
    /// operation, last error, progress, per-slot status, booted slot, primary
    /// slot and the pending-not-confirmed flag, plus whatever `install` /
    /// `last_mark` entries earlier calls recorded.
    ///
    /// Exported as `GetUpdateState`. Unlike `GetState("update")`, which
    /// answers from the tree as last recorded, this asks RAUC first — the
    /// polling surface for a UI watching an install.
    async fn get_update_state(&self) -> fdo::Result<String> {
        self.refresh_update_state().await
    }

    /// Manually mark a slot: `state` is `good` or `bad`, `slot` is `booted`
    /// or `other`. Answers RAUC's `(slot_name, message)`.
    ///
    /// Exported as `MarkUpdate`. The manual escape hatch for the case the
    /// boot health gate cannot decide (its automatic mark-good is the gate's
    /// job, not mosd's); see `crate::rauc` for the split.
    async fn mark_update(
        &self,
        #[zbus(header)] header: Header<'_>,
        state: &str,
        slot: &str,
    ) -> fdo::Result<(String, String)> {
        self.request_mark(sender_of(&header), state, slot).await
    }

    /// Set a TRANSIENT root password, then re-apply every reconciler.
    ///
    /// Exported as `SetTransientRootPassword`. The password lives until the
    /// next boot, when `mos-shadow-reconcile` clears the root hash it wrote;
    /// persistent access is by SSH public key.
    ///
    /// Deliberately not a setting. Nothing is written into the settings tree
    /// and no [`SettingsChanged`](Self::settings_changed) is emitted, because a
    /// password that reached the settings tree would be persisted, re-applied
    /// on the next boot and readable by anything that can call `GetSettings` —
    /// which is the opposite of transient in all three respects.
    ///
    /// The reconcilers are re-run afterwards so the sshd drop-in re-renders
    /// against a device that now has a password to offer, and sshd picks it up.
    async fn set_transient_root_password(&self, password: &str) -> fdo::Result<()> {
        // Two concerns share this shape. Serialization: zbus dispatches `&self`
        // methods concurrently, and two unserialized writers would interleave
        // read-modify-write cycles on one shadow file through one fixed temp
        // name — so the write happens under the same lock every other mutating
        // method takes. Blocking: the bcrypt hash inside costs hundreds of
        // milliseconds of CPU, which must not stall the bus dispatcher, so the
        // whole write runs off the async scheduler while the guard is held.
        let shadow_path = self.shadow_path.clone();
        let password = password.to_string();
        let inner = self.inner.lock().await;
        tokio::task::spawn_blocking(move || {
            transient::set_transient_root_password(&shadow_path, &password)
        })
        .await
        .map_err(|err| fdo::Error::Failed(format!("transient password task: {err}")))?
        .map_err(transient_to_fdo)?;
        drop(inner);
        self.apply_all().await;
        Ok(())
    }

    /// Emitted after a successful `SetSettings` with the changed dot-path and
    /// its new JSON-encoded value.
    #[zbus(signal)]
    async fn settings_changed(
        emitter: &SignalEmitter<'_>,
        path: &str,
        value_json: &str,
    ) -> zbus::Result<()>;
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    use super::{MosdService, paths_overlap};
    use crate::power::MockPower;
    use crate::rauc::{MockRauc, SlotStatus};

    /// Three accounts, nine fields each — the shape of a Debian `/etc/shadow`.
    const SHADOW: &str = "root:!:19000:0:99999:7:::\n\
        daemon:*:19000:0:99999:7:::\n";

    /// A mock's shared call log ([`MockPower::calls`] / [`MockRauc::calls`]).
    type CallLog = Arc<Mutex<Vec<String>>>;

    /// Service backed by a throwaway settings file, a throwaway shadow file,
    /// a recording power mock and the given RAUC mock; the power log and the
    /// RAUC call log are returned alongside.
    fn service_with_rauc(rauc: MockRauc) -> (MosdService, CallLog, CallLog, tempfile::TempDir) {
        let dir = tempfile::tempdir().expect("tempdir");
        let store = mosd_settings::Store::new(dir.path().join("settings.toml"));
        let shadow_path = dir.path().join("shadow");
        std::fs::write(&shadow_path, SHADOW).expect("seed shadow");
        let calls = Arc::new(Mutex::new(Vec::new()));
        let rauc_calls = Arc::clone(&rauc.calls);
        let service = MosdService::new(
            store,
            mosd_settings::Settings::default(),
            Vec::new(),
            Box::new(MockPower {
                calls: Arc::clone(&calls),
            }),
            shadow_path,
            serde_json::json!({}),
        )
        .with_rauc(Arc::new(rauc));
        (service, calls, rauc_calls, dir)
    }

    /// [`service_with_rauc`] over a default (idle, slotless) RAUC mock.
    fn service_with_mock() -> (MosdService, Arc<Mutex<Vec<String>>>, tempfile::TempDir) {
        let (service, calls, _rauc_calls, dir) = service_with_rauc(MockRauc::default());
        (service, calls, dir)
    }

    /// A/B pair with `booted` running from `rootfs.0`; `boot_status` per slot.
    fn ab_slots(booted_status: &str, other_status: &str) -> Vec<SlotStatus> {
        let slot = |name: &str, state: &str, boot_status: &str| SlotStatus {
            name: name.to_string(),
            state: Some(state.to_string()),
            boot_status: Some(boot_status.to_string()),
            ..SlotStatus::default()
        };
        vec![
            slot("rootfs.0", "booted", booted_status),
            slot("rootfs.1", "inactive", other_status),
        ]
    }

    /// Poll `update.install.status` until it reads `want` or ~2s elapse.
    async fn wait_for_install_status(service: &MosdService, want: &str) {
        for _ in 0..200 {
            let state = service
                .get_state("update.install.status")
                .await
                .unwrap_or_default();
            if state == format!("\"{want}\"") {
                return;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        panic!(
            "update.install.status never became \"{want}\"; state: {}",
            service.get_state("").await.unwrap_or_default()
        );
    }

    #[tokio::test]
    async fn reboot_reaches_the_power_control_and_is_recorded_first() {
        let (service, calls, _dir) = service_with_mock();

        service.request_reboot(":1.7").await.expect("reboot");

        assert_eq!(*calls.lock().expect("lock"), vec!["reboot".to_string()]);
        let state = service.get_state("power").await.expect("power state");
        let state: serde_json::Value = serde_json::from_str(&state).expect("json");
        assert_eq!(state["last_action"], "reboot");
        assert_eq!(state["requested_by"], ":1.7");
    }

    #[tokio::test]
    async fn power_off_reaches_the_power_control_and_is_recorded_first() {
        let (service, calls, _dir) = service_with_mock();

        service.request_power_off(":1.9").await.expect("power off");

        assert_eq!(*calls.lock().expect("lock"), vec!["power_off".to_string()]);
        let state = service.get_state("power").await.expect("power state");
        let state: serde_json::Value = serde_json::from_str(&state).expect("json");
        assert_eq!(state["last_action"], "power_off");
        assert_eq!(state["requested_by"], ":1.9");
    }

    #[tokio::test]
    async fn a_reboot_into_a_pending_slot_records_the_warning_first() {
        let (service, calls, _rauc_calls, _dir) = service_with_rauc(MockRauc {
            slots: ab_slots("good", "good"),
            // The bootloader's first pick is not the slot we run from: the
            // exact window in which this reboot burns a boot attempt.
            primary: Some("rootfs.1".to_string()),
            ..MockRauc::default()
        });

        service.request_reboot(":1.4").await.expect("reboot");

        assert_eq!(*calls.lock().expect("lock"), vec!["reboot".to_string()]);
        let power = service.get_state("power").await.expect("power state");
        let power: serde_json::Value = serde_json::from_str(&power).expect("json");
        assert_eq!(power["last_action"], "reboot");
        let warning = power["update_warning"]
            .as_str()
            .expect("a pending slot must put update_warning beside the action");
        assert!(warning.contains("rootfs.1"), "warning: {warning}");
        assert!(warning.contains("boot attempt"), "warning: {warning}");
    }

    #[tokio::test]
    async fn a_converged_system_reboots_without_an_update_warning() {
        let (service, calls, _rauc_calls, _dir) = service_with_rauc(MockRauc {
            slots: ab_slots("good", "good"),
            primary: Some("rootfs.0".to_string()),
            ..MockRauc::default()
        });

        service.request_reboot(":1.4").await.expect("reboot");

        assert_eq!(*calls.lock().expect("lock"), vec!["reboot".to_string()]);
        let power = service.get_state("power").await.expect("power state");
        let power: serde_json::Value = serde_json::from_str(&power).expect("json");
        assert!(
            power.get("update_warning").is_none(),
            "no warning means no key, not an empty one: {power}"
        );
    }

    #[tokio::test]
    async fn an_unreachable_rauc_does_not_block_the_reboot() {
        // A v1 image or a wedged installer: the slot query fails, the reboot
        // still goes through, and no warning is invented.
        let (service, calls, _rauc_calls, _dir) = service_with_rauc(MockRauc {
            queries_fail: true,
            ..MockRauc::default()
        });

        service.request_reboot(":1.4").await.expect("reboot");

        assert_eq!(*calls.lock().expect("lock"), vec!["reboot".to_string()]);
        let power = service.get_state("power").await.expect("power state");
        let power: serde_json::Value = serde_json::from_str(&power).expect("json");
        assert!(power.get("update_warning").is_none(), "got: {power}");
    }

    #[tokio::test]
    async fn an_install_request_validates_the_path_before_touching_rauc() {
        let (service, _calls, rauc_calls, dir) = service_with_rauc(MockRauc::default());

        let relative = service
            .request_install(":1.5", "data/bundle.raucb")
            .await
            .expect_err("a relative path must be refused");
        assert!(relative.to_string().contains("absolute"), "{relative}");

        let missing = dir.path().join("no-such.raucb");
        service
            .request_install(":1.5", missing.to_str().expect("utf-8"))
            .await
            .expect_err("a missing file must be refused");

        service
            .request_install(":1.5", dir.path().to_str().expect("utf-8"))
            .await
            .expect_err("a directory must be refused");

        assert!(
            rauc_calls.lock().expect("lock").is_empty(),
            "no invalid request may reach the installer"
        );
        assert!(
            service.get_state("update").await.is_err(),
            "a refused install must record nothing"
        );
    }

    #[tokio::test]
    async fn an_install_runs_in_the_background_and_records_its_lifecycle() {
        let gate = Arc::new(tokio::sync::Notify::new());
        let (service, _calls, rauc_calls, dir) = service_with_rauc(MockRauc {
            install_gate: Some(Arc::clone(&gate)),
            ..MockRauc::default()
        });
        let bundle = dir.path().join("ok.raucb");
        std::fs::write(&bundle, b"bundle bytes").expect("seed bundle");
        let bundle = bundle.to_str().expect("utf-8");

        // Returns while the install is still gated: the bus call cannot be
        // blocked by a slow installer.
        service
            .request_install(":1.6", bundle)
            .await
            .expect("install");
        wait_for_install_status(&service, "running").await;

        // A second install while one runs is refused, and the refusal names
        // the reason rather than queueing silently.
        let busy = service
            .request_install(":1.7", bundle)
            .await
            .expect_err("concurrent install must be refused");
        assert!(busy.to_string().contains("already running"), "{busy}");

        gate.notify_one();
        wait_for_install_status(&service, "done").await;

        let install = service.get_state("update.install").await.expect("state");
        let install: serde_json::Value = serde_json::from_str(&install).expect("json");
        assert_eq!(install["requested_by"], ":1.6");
        assert_eq!(install["bundle"], bundle);
        assert_eq!(
            *rauc_calls.lock().expect("lock"),
            vec![format!("install {bundle}")],
            "exactly the admitted install reached the installer"
        );
        // The completed install refreshed the whole update entry.
        let update = service.get_state("update").await.expect("state");
        let update: serde_json::Value = serde_json::from_str(&update).expect("json");
        assert_eq!(update["operation"], "idle");

        // The in-flight flag is released: a new install is admitted again.
        gate.notify_one();
        service
            .request_install(":1.8", bundle)
            .await
            .expect("install");
        wait_for_install_status(&service, "done").await;
    }

    #[tokio::test]
    async fn a_failed_install_records_the_error_and_releases_the_flag() {
        let (service, _calls, _rauc_calls, dir) = service_with_rauc(MockRauc {
            install_error: Some("signature verification failed".to_string()),
            ..MockRauc::default()
        });
        let bundle = dir.path().join("bad.raucb");
        std::fs::write(&bundle, b"bundle bytes").expect("seed bundle");
        let bundle = bundle.to_str().expect("utf-8");

        service
            .request_install(":1.9", bundle)
            .await
            .expect("admitted");
        wait_for_install_status(&service, "failed").await;

        let install = service.get_state("update.install").await.expect("state");
        let install: serde_json::Value = serde_json::from_str(&install).expect("json");
        assert!(
            install["error"]
                .as_str()
                .is_some_and(|err| err.contains("signature verification failed")),
            "the failure reason must be recorded, got {install}"
        );
        service
            .request_install(":1.9", bundle)
            .await
            .expect("flag released");
    }

    #[tokio::test]
    async fn update_state_is_queried_recorded_and_returned() {
        let (service, _calls, _rauc_calls, _dir) = service_with_rauc(MockRauc {
            slots: ab_slots("good", "good"),
            primary: Some("rootfs.1".to_string()),
            ..MockRauc::default()
        });

        let rendered = service.refresh_update_state().await.expect("query");
        let rendered: serde_json::Value = serde_json::from_str(&rendered).expect("json");
        assert_eq!(rendered["operation"], "idle");
        assert_eq!(rendered["booted_slot"], "rootfs.0");
        assert_eq!(rendered["primary"], "rootfs.1");
        assert_eq!(rendered["pending_not_confirmed"], true);
        assert_eq!(rendered["slots"]["rootfs.0"]["state"], "booted");

        // What was answered is exactly what was recorded.
        let recorded = service.get_state("update").await.expect("state");
        let recorded: serde_json::Value = serde_json::from_str(&recorded).expect("json");
        assert_eq!(recorded, rendered);
    }

    #[tokio::test]
    async fn an_unreachable_rauc_fails_the_query_and_records_nothing() {
        let (service, _calls, _rauc_calls, _dir) = service_with_rauc(MockRauc {
            queries_fail: true,
            ..MockRauc::default()
        });

        service
            .refresh_update_state()
            .await
            .expect_err("an unreachable installer is the caller's error, not a silent {}");
        assert!(
            service.get_state("update").await.is_err(),
            "a failed query must leave no half-recorded entry"
        );
    }

    #[tokio::test]
    async fn a_mark_is_validated_before_rauc_and_recorded_after() {
        let (service, _calls, rauc_calls, _dir) = service_with_rauc(MockRauc::default());

        // `active` exists in RAUC and is deliberately not offered.
        service
            .request_mark(":1.2", "active", "other")
            .await
            .expect_err("activation is the installer's job");
        // Concrete slot names are RAUC's, not this surface's.
        service
            .request_mark(":1.2", "good", "rootfs.0")
            .await
            .expect_err("slots are addressed as booted/other only");
        assert!(
            rauc_calls.lock().expect("lock").is_empty(),
            "no invalid mark may reach the installer"
        );

        let (slot_name, message) = service
            .request_mark(":1.2", "good", "booted")
            .await
            .expect("a valid mark");
        assert_eq!(slot_name, "rootfs.9");
        assert!(message.contains("good"), "message: {message}");
        assert_eq!(
            *rauc_calls.lock().expect("lock"),
            vec!["mark good booted".to_string()]
        );
        let last = service.get_state("update.last_mark").await.expect("state");
        let last: serde_json::Value = serde_json::from_str(&last).expect("json");
        assert_eq!(last["state"], "good");
        assert_eq!(last["slot"], "booted");
        assert_eq!(last["slot_name"], "rootfs.9");
        assert_eq!(last["requested_by"], ":1.2");
    }

    #[tokio::test]
    async fn power_requests_do_not_touch_the_settings_tree() {
        let (service, _calls, _dir) = service_with_mock();
        let before = service.get_settings("").await.expect("settings");

        service.request_reboot(":1.1").await.expect("reboot");
        service.request_power_off(":1.1").await.expect("power off");

        assert_eq!(service.get_settings("").await.expect("settings"), before);
    }

    /// Every `SettingsError` variant, against the error name it must travel
    /// under: the two conditions the fdo vocabulary cannot separate get
    /// interface-scoped names, everything else keeps its standard fdo name.
    #[test]
    fn each_settings_failure_travels_under_its_own_error_name() {
        use mosd_settings::SettingsError;
        use zbus::DBusError as _;

        for (err, name) in [
            (
                SettingsError::NotFound("a.path".into()),
                "com.mos.mosd1.Error.NotFound",
            ),
            (
                SettingsError::ReadOnly("a.path".into()),
                "com.mos.mosd1.Error.ReadOnly",
            ),
            (
                SettingsError::Validation {
                    path: "a.path".into(),
                    message: "bad".into(),
                },
                "org.freedesktop.DBus.Error.InvalidArgs",
            ),
            (
                SettingsError::Io(std::io::Error::other("disk")),
                "org.freedesktop.DBus.Error.IOError",
            ),
            (
                SettingsError::Parse("mangled".into()),
                "org.freedesktop.DBus.Error.Failed",
            ),
            (
                SettingsError::Migration("stuck".into()),
                "org.freedesktop.DBus.Error.Failed",
            ),
        ] {
            let message = err.to_string();
            let fault = super::to_bus_error(err);
            assert_eq!(fault.name().as_str(), name);
            assert_eq!(
                fault.description(),
                Some(message.as_str()),
                "the description must stay mosd's own words ({name})"
            );
        }
    }

    #[tokio::test]
    async fn a_transient_password_does_not_touch_the_settings_tree() {
        let (service, _calls, dir) = service_with_mock();
        let before = service.get_settings("").await.expect("settings");

        service
            .set_transient_root_password("correct horse battery")
            .await
            .expect("set transient root password");

        assert_eq!(
            service.get_settings("").await.expect("settings"),
            before,
            "a password must never enter the settings tree"
        );
        assert!(
            !before.contains("correct horse"),
            "the fixture itself must not carry the password"
        );
        assert!(
            !dir.path().join("settings.toml").exists(),
            "nothing was persisted, so no settings file was written at all"
        );
        assert!(
            crate::transient::transient_password_active(&dir.path().join("shadow")),
            "the call must still have done its actual job"
        );
    }

    #[tokio::test]
    async fn a_rejected_transient_password_is_an_error_that_does_not_echo_it() {
        let (service, _calls, dir) = service_with_mock();

        let err = service
            .set_transient_root_password("short12")
            .await
            .expect_err("seven bytes is below the floor");

        assert!(
            !err.to_string().contains("short12"),
            "the password leaked into the D-Bus error: {err}"
        );
        assert!(
            !crate::transient::transient_password_active(&dir.path().join("shadow")),
            "a rejected password must leave no marker behind"
        );
    }

    #[test]
    fn root_matches_everything() {
        assert!(paths_overlap("", "network"));
        assert!(paths_overlap("network", ""));
        assert!(paths_overlap("", ""));
        assert!(paths_overlap(".", "hostname"));
        assert!(paths_overlap("hostname", "."));
    }

    #[test]
    fn prefix_matches_both_directions() {
        assert!(paths_overlap("network.eth0.dhcp", "network"));
        assert!(paths_overlap("network", "network.eth0.dhcp"));
        assert!(paths_overlap("hostname", "hostname"));
    }

    #[test]
    fn disjoint_paths_do_not_match() {
        assert!(!paths_overlap("hostname", "network"));
        assert!(!paths_overlap("network.eth0", "network2"));
        assert!(!paths_overlap("net", "network"));
    }
}
