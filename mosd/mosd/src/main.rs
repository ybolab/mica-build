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
//! - `MOSD_DRY_RUN` — when `1`, no reconcilers are constructed and the
//!   live-state root carries `{"dry_run": true}`; used by tests so the
//!   daemon never touches the host it runs on.

#![forbid(unsafe_code)]

mod bus;
mod reconciler;

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
    let settings = store
        .load()
        .with_context(|| format!("load settings from {settings_path}"))?;

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
