//! mosd — management-plane daemon.
//!
//! Owns the settings tree (persisted via `mosd-settings`) and a live-state
//! tree, exposed on D-Bus as `com.mos.mosd` / `/com/mos/mosd` /
//! `com.mos.mosd1`.
//!
//! Configuration is taken from the environment:
//!
//! - `MOSD_SETTINGS_PATH` — settings file location (default
//!   `/var/lib/mos/settings.toml`).
//! - `MOSD_BUS` — `system` (default) or `session`.
//! - `MOSD_SHADOW_PATH` — shadow file a transient root password is written
//!   into (default `/etc/shadow`, which is a symlink onto STATE on the v2
//!   image). The sshd reconciler honours the same variable.
//! - `MOSD_DRY_RUN` — when `1`, first-boot provisioning is skipped, no
//!   reconcilers are constructed, no service scan is constructed, power
//!   actions are routed to a no-op control, and the live-state root carries
//!   `{"dry_run": true}`; used by tests so the daemon never touches the host
//!   it runs on.
//! - `MOSD_SCAN` — when set, decides whether the service scan ([`scan`]) is
//!   constructed: `1` constructs it, any other value does not. Unset — the
//!   production case — means on unless `MOSD_DRY_RUN=1`.
//!
//!   The override exists because dry-run switches off the one thing
//!   `tests/scan.rs` has to exercise, and a registry that is only ever run
//!   unobserved is a registry nobody has measured. It widens nothing that
//!   dry-run protects: the scan is passive, it adds a match rule and read-only
//!   calls on whichever bus `MOSD_BUS` already named and the daemon is already
//!   connected to, and it writes only to the in-RAM live-state tree. It
//!   touches no file, no unit and no host state at all.

#![forbid(unsafe_code)]

mod actions;
mod bus;
mod identity;
mod power;
mod provisioning;
mod reconciler;
mod scan;
mod transient;
mod tree;

use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::Context;
use mosd_settings::Store;
use serde_json::Value;
use tokio::signal::unix::{SignalKind, signal};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt::init();

    let settings_path = std::env::var("MOSD_SETTINGS_PATH")
        .unwrap_or_else(|_| mosd_settings::DEFAULT_PATH.to_string());
    let bus_kind = std::env::var("MOSD_BUS").unwrap_or_else(|_| "system".to_string());
    let dry_run = std::env::var("MOSD_DRY_RUN").is_ok_and(|value| value == "1");

    let store = Store::new(&settings_path);
    let (mut settings, rollback) = store
        .load_with_report()
        .with_context(|| format!("load settings from {settings_path}"))?;
    // The A/B rollback path: the settings file was written by a NEWER schema
    // and was loaded tolerantly instead of crash-looping the daemon
    // (docs/design/api.md §10.3 item 5). Loud on purpose — this is the one
    // place the loss `mosd.md` §5.2 prices is actually paid.
    if let Some(report) = rollback {
        if report.defaulted {
            tracing::error!(
                from_schema = report.from,
                dropped = ?report.dropped_keys,
                "settings file is from a newer, reshaped schema; ALL settings \
                 abandoned and defaults loaded — the device is back in setup mode"
            );
        } else {
            tracing::warn!(
                from_schema = report.from,
                dropped = ?report.dropped_keys,
                "settings file is from a newer schema; unknown keys dropped \
                 (the documented cost of an A/B rollback across a schema bump)"
            );
        }
    }

    // Before the reconcilers exist, so the very first reconcile already sees a
    // seeded tree rather than the built-in defaults. Skipped under dry-run,
    // which must not write to STATE at all.
    if dry_run {
        tracing::info!("dry run: first-boot provisioning skipped");
    } else {
        let state_dir = state_dir_for(&settings_path);
        // Hard failure on purpose: an unwritable STATE means no device identity
        // and no device credential, so there is no usable device to serve. A
        // loud exit is better than a daemon that quietly serves an
        // unprovisioned tree the operator cannot log in to.
        let outcome = provisioning::ensure_provisioned(
            &store,
            &state_dir,
            Path::new(provisioning::DEFAULT_PROFILE_PATH),
            &mut settings,
        )
        .context("first-boot provisioning")?;
        tracing::info!(?outcome, state_dir = %state_dir.display(), "provisioning checked");
    }

    let reconcilers = if dry_run {
        Vec::new()
    } else {
        reconciler::all()
    };
    // Under dry-run the production control is never constructed, so a daemon
    // started by a test cannot reach systemd's manager at all.
    let power: Box<dyn power::PowerControl> = if dry_run {
        Box::new(power::DryRunPower)
    } else {
        Box::new(power::Systemd::new())
    };
    // The service registry exists only when a scan does, so that a daemon
    // running no scan answers `ForgetService` with "there is no registry"
    // rather than with an empty one it would never fill.
    let scan_enabled = std::env::var("MOSD_SCAN").map_or(!dry_run, |value| value == "1");
    let registry = scan_enabled.then(|| Arc::new(scan::Registry::new()));
    tracing::info!(
        settings_path,
        dry_run,
        reconcilers = reconcilers.len(),
        service_scan = scan_enabled,
        "mosd starting"
    );

    let mut state = serde_json::Map::new();
    if dry_run {
        state.insert("dry_run".to_string(), Value::Bool(true));
    }

    let mut service = bus::MosdService::new(
        store,
        settings,
        reconcilers,
        power,
        transient::production_shadow_path(),
        Value::Object(state),
    );
    if let Some(registry) = &registry {
        service = service.with_service_registry(Arc::clone(registry));
    }
    service.apply_all().await;
    let changes = service.subscribe_changes();

    let builder = match bus_kind.as_str() {
        "system" => zbus::connection::Builder::system()?,
        "session" => zbus::connection::Builder::session()?,
        other => anyhow::bail!("MOSD_BUS must be `system` or `session`, got `{other}`"),
    };
    let connection = builder
        .serve_at(bus::OBJECT_PATH, service)?
        .build()
        .await
        .with_context(|| format!("connect to {bus_kind} bus"))?;
    // The com.mos.Item1 façade at the root object path, registered — and its
    // change watcher started — before the well-known name is claimed, so a
    // client never resolves the name without the item tree behind it.
    let object_server = connection.object_server();
    let service_ref = object_server
        .interface::<_, bus::MosdService>(bus::OBJECT_PATH)
        .await
        .context("look up served MosdService")?;
    object_server
        .at(tree::ROOT_PATH, tree::ItemTree::new(service_ref))
        .await
        .context("serve com.mos.Item1")?;
    let service_ref = object_server
        .interface::<_, bus::MosdService>(bus::OBJECT_PATH)
        .await
        .context("look up served MosdService")?;
    let tree_ref = object_server
        .interface::<_, tree::ItemTree>(tree::ROOT_PATH)
        .await
        .context("look up served ItemTree")?;
    // The per-item objects that carry GetValue/SetValue, registered here for
    // the same reason: the name is claimed below, never before an item a
    // client can see is one it can also write.
    let snapshot = tree::install(&tree_ref, &service_ref).await;
    tokio::spawn(tree::run(service_ref, tree_ref, changes, snapshot));
    // The service scan, started before the well-known name is claimed so that
    // its NameOwnerChanged subscription is in place before anything can react
    // to mosd appearing — a service that claims its name in that window is
    // seen by the signal rather than missed between the sweep and the
    // subscription.
    if let Some(registry) = registry {
        let service_ref = object_server
            .interface::<_, bus::MosdService>(bus::OBJECT_PATH)
            .await
            .context("look up served MosdService")?;
        tokio::spawn(scan::run(connection.clone(), registry, service_ref));
    }
    connection
        .request_name(bus::BUS_NAME)
        .await
        .with_context(|| format!("request name {}", bus::BUS_NAME))?;
    tracing::info!(bus = bus_kind, name = bus::BUS_NAME, "serving");

    let mut sigterm = signal(SignalKind::terminate()).context("install SIGTERM handler")?;
    tokio::select! {
        _ = sigterm.recv() => tracing::info!("SIGTERM received, exiting"),
        _ = tokio::signal::ctrl_c() => tracing::info!("SIGINT received, exiting"),
    }
    Ok(())
}

/// Directory holding STATE-backed data for a settings file at `settings_path`.
///
/// The secrets live beside the settings file, so tests that redirect
/// `MOSD_SETTINGS_PATH` into a temporary directory redirect the secrets with
/// it and never touch the host's `/var/lib/mos`.
fn state_dir_for(settings_path: &str) -> PathBuf {
    Path::new(settings_path)
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .map_or_else(
            || PathBuf::from(identity::DEFAULT_STATE_DIR),
            Path::to_path_buf,
        )
}
