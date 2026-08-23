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
//! - `APID_STATE_DIR` — certificate and key storage, the persisted
//!   login-backoff counters and the audit ring (default `/var/lib/mos/apid`).
//! - `APID_BUS` — `system` (default) or `session`; same semantics as
//!   `MOSD_BUS`.
//!
//! After both listeners are bound the daemon prints exactly one line to
//! stdout — `APID_LISTENING https=<addr> http=<addr>` — and routes all
//! tracing output to stderr.

#![forbid(unsafe_code)]

mod assets;
mod audit;
mod auth;
mod bundle;
mod bus_client;
mod config;
mod persist;
mod routes;
mod session;
mod settings_api;
mod startup;
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
    // The state dir already exists (ensure_state_dir above) and already holds
    // the TLS material, so the backoff counter and the audit ring go there
    // too: one STATE-backed directory, one set of permissions to reason about.
    let state = routes::AppState::new(api, signing_key).with_persistence(&config.state_dir);

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

    // §6.1, and the ordering is the requirement rather than a detail: bundle
    // discovery and the compatibility re-check happen **after** the listeners
    // bind and after `APID_LISTENING` is printed, and the outcome is a state
    // this function holds rather than an error it returns. Note the absence of
    // `?`: every step above this line propagates, and under
    // `Restart=on-failure` (`mosd/dist/apid.service:9`) a propagated error is
    // a crash loop with no listener bound. A bundle must not be able to stop
    // apid from listening, so `discover` has no error variant to propagate.
    let bundle_state = startup::discover(state.bundles().clone(), state.audit().clone()).await;
    tracing::info!(bundle = %bundle_state, "custom UI state at start-up");

    let rustls_config = RustlsConfig::from_pem(
        certificate.cert_pem.into_bytes(),
        certificate.key_pem.into_bytes(),
    )
    .await
    .context("build rustls server config")?;
    // `with_connect_info` installs the peer address the audit trail reads
    // (`audit::Source`); without it every audit line would say `unknown`.
    let https = axum_server::from_tcp_rustls(https_listener, rustls_config)
        .serve(routes::app(state).into_make_service_with_connect_info::<std::net::SocketAddr>());
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
