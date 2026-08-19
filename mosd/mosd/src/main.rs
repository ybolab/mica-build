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
//! - `MOSD_DRY_RUN` — when `1`, first-boot provisioning is skipped and no
//!   reconcilers are constructed, and the live-state root carries
//!   `{"dry_run": true}`; used by tests so the daemon never touches the host
//!   it runs on.

#![forbid(unsafe_code)]

mod bus;
mod identity;
mod provisioning;
mod reconciler;

use std::path::{Path, PathBuf};

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
    let mut settings = store
        .load()
        .with_context(|| format!("load settings from {settings_path}"))?;

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
    tracing::info!(
        settings_path,
        dry_run,
        reconcilers = reconcilers.len(),
        "mosd starting"
    );

    let mut state = serde_json::Map::new();
    if dry_run {
        state.insert("dry_run".to_string(), Value::Bool(true));
    }

    let service = bus::MosdService::new(store, settings, reconcilers, Value::Object(state));
    service.apply_all().await;

    let builder = match bus_kind.as_str() {
        "system" => zbus::connection::Builder::system()?,
        "session" => zbus::connection::Builder::session()?,
        other => anyhow::bail!("MOSD_BUS must be `system` or `session`, got `{other}`"),
    };
    let _connection = builder
        .name(bus::BUS_NAME)?
        .serve_at(bus::OBJECT_PATH, service)?
        .build()
        .await
        .with_context(|| format!("connect to {bus_kind} bus"))?;
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
