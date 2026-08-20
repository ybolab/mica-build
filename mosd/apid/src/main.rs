//! apid — appliance API daemon; the web dashboard is what it serves.
//!
//! Serves the management web interface over HTTPS with a self-signed
//! certificate and talks to `mosd` exclusively over D-Bus
//! (`com.mos.mosd` / `/com/mos/mosd` / `com.mos.mosd1`).
//!
//! Configuration is taken from the environment:
//!
//! - `APID_HTTPS_ADDR` — HTTPS listen address (default `0.0.0.0:443`).
//! - `APID_HTTP_ADDR` — HTTP listen address, redirect-only (default
//!   `0.0.0.0:80`).
//! - `APID_STATE_DIR` — certificate and key storage (default
//!   `/var/lib/mos/apid`).
//! - `APID_BUS` — `system` (default) or `session`; same semantics as
//!   `MOSD_BUS`.
//!
//! After both listeners are bound the daemon prints exactly one line to
//! stdout — `APID_LISTENING https=<addr> http=<addr>` — and routes all
//! tracing output to stderr.

#![forbid(unsafe_code)]

mod auth;
mod bundle;
mod bus_client;
mod config;
mod routes;
mod session;
mod settings_api;
#[cfg(test)]
mod tests;
mod tls;

use std::sync::Arc;

use anyhow::Context;
use axum_server::tls_rustls::RustlsConfig;
use tokio::signal::unix::{SignalKind, signal};

use crate::settings_api::SettingsApi;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_writer(std::io::stderr)
        .init();
    rustls::crypto::ring::default_provider()
        .install_default()
        .map_err(|_| anyhow::anyhow!("install ring crypto provider"))?;

    let config = config::Config::from_env()?;
    tls::ensure_state_dir(&config.state_dir)
        .with_context(|| format!("create state dir {}", config.state_dir.display()))?;
    let certificate = tls::load_or_generate_certificate(&config.state_dir)?;
    let signing_key = tls::load_or_generate_session_key(&config.state_dir)?;

    let api: Arc<dyn SettingsApi> = Arc::new(bus_client::BusSettings::new(config.bus));
    let state = routes::AppState::new(api, signing_key);

    let https_listener = std::net::TcpListener::bind(&config.https_addr)
        .with_context(|| format!("bind https listener on {}", config.https_addr))?;
    https_listener.set_nonblocking(true)?;
    let https_addr = https_listener.local_addr()?;
    let http_listener = tokio::net::TcpListener::bind(&config.http_addr)
        .await
        .with_context(|| format!("bind http listener on {}", config.http_addr))?;
    let http_addr = http_listener.local_addr()?;

    // The one machine-readable startup marker; everything else goes to stderr.
    println!("APID_LISTENING https={https_addr} http={http_addr}");
    tracing::info!(%https_addr, %http_addr, "apid serving");

    let rustls_config = RustlsConfig::from_pem(
        certificate.cert_pem.into_bytes(),
        certificate.key_pem.into_bytes(),
    )
    .await
    .context("build rustls server config")?;
    let https = axum_server::from_tcp_rustls(https_listener, rustls_config)
        .serve(routes::app(state).into_make_service());
    let http = axum::serve(
        http_listener,
        routes::redirect_app(https_addr.port()).into_make_service(),
    );
    tokio::spawn(async move {
        if let Err(err) = https.await {
            tracing::error!(error = %err, "https server failed");
        }
    });
    tokio::spawn(async move {
        if let Err(err) = http.await {
            tracing::error!(error = %err, "http redirect server failed");
        }
    });

    let mut sigterm = signal(SignalKind::terminate()).context("install SIGTERM handler")?;
    tokio::select! {
        _ = sigterm.recv() => tracing::info!("SIGTERM received, exiting"),
        _ = tokio::signal::ctrl_c() => tracing::info!("SIGINT received, exiting"),
    }
    Ok(())
}
