//! `mos-mqtt-broker` — the MQTT broker the device serves locally.
//!
//! This is rumqttd used as a library, not as its own daemon. It reads the
//! three-key file mosd renders into `/run/mos/mqtt-broker.toml`, builds a
//! [`rumqttd::Config`] in code, and blocks in [`rumqttd::Broker::start`].
//!
//! Building the config in code rather than handing rumqttd its own TOML is the
//! point: everything below that is not in the mos-owned file is not a knob.
//! There is no HTTP console, no Prometheus listener, no cluster and no bridge,
//! and none of those can be turned on by editing a file on the device.

use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::PathBuf;

use anyhow::{Context, Result};
use clap::Parser;
use rumqttd::{Broker, ConnectionSettings, RouterConfig, ServerSettings};

mod config;

/// The MQTT broker for the mos item tree and its local clients.
#[derive(Debug, Parser)]
#[command(name = "mos-mqtt-broker", version)]
struct Args {
    /// The mos-owned broker configuration, rendered by mosd from the `mqtt`
    /// settings subtree before this unit is started.
    #[arg(long)]
    config: PathBuf,

    /// The credentials file, read only when `auth_enabled` is true. An
    /// argument rather than a constant so tests never read the host's.
    #[arg(long, default_value = "/var/lib/mos/mqtt-broker-users.toml")]
    users: PathBuf,
}

/// How many clients may be connected at once.
///
/// This is an appliance: the bridge, a dashboard or two, and whatever the
/// owner points at it. The router pre-sizes per-connection bookkeeping from
/// this, so it is a memory number as much as a policy one -- a few tens of KiB
/// at 64, against megabytes at rumqttd's demo value of 10010.
const MAX_CONNECTIONS: usize = 64;

/// Outgoing packets the router will hold for one connection before it stops
/// reading more for it. 200 small item-tree publishes is roughly 200 KiB of
/// worst-case backlog per slow client.
const MAX_OUTGOING_PACKET_COUNT: u64 = 200;

/// The commitlog segment size, and how many segments a topic filter keeps.
///
/// Together these bound retained history per filter: 16 KiB x 10 = 160 KiB,
/// and only for filters that actually carry traffic. The item tree publishes
/// small JSON, so 16 KiB is many messages per segment; ten segments is enough
/// history for a client that reconnects, and not enough to matter on a device
/// with 1 GiB of RAM.
const MAX_SEGMENT_SIZE: usize = 16 * 1024;
const MAX_SEGMENT_COUNT: usize = 10;

/// How long a TCP connection has to send its CONNECT before it is dropped.
/// Short, because everything legitimate here is on the same device or the
/// same LAN; the only thing that takes longer is a port scanner holding a slot.
const CONNECTION_TIMEOUT_MS: u16 = 5_000;

/// The largest single publish accepted, in bytes.
///
/// The item tree's payloads are small JSON scalars; 64 KiB is generous for
/// them and still bounds what one client can make the router allocate.
const MAX_PAYLOAD_SIZE: usize = 64 * 1024;

/// Unacknowledged QoS 1/2 messages allowed in flight per connection.
const MAX_INFLIGHT_COUNT: usize = 100;

fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::INFO)
        .init();
    let args = Args::parse();

    let cfg = config::load(&args.config)?;
    let address = cfg
        .address()
        .with_context(|| format!("in broker config {}", args.config.display()))?;
    let listen = SocketAddr::new(address, cfg.listen_port);

    // Authentication is a plain username -> password map. When it is off, the
    // map is absent entirely rather than empty: an empty map means "auth is on
    // and nobody is enrolled", which refuses every login, and the two must not
    // be spelled the same way.
    let auth = if cfg.auth_enabled {
        let users = config::load_users(&args.users)?;
        if users.is_empty() {
            tracing::warn!(
                path = %args.users.display(),
                "authentication is enabled but no credentials are enrolled; \
                 every connection will be refused until this file lists a user"
            );
        }
        Some(users)
    } else {
        None
    };

    // A log, never a gate. Binding off-host with auth off is a configuration
    // the owner is allowed to choose -- on a trusted segment it is the obvious
    // one -- but it is not a configuration anyone should arrive at by
    // accident, so it is stated once, loudly, at startup.
    if config::is_off_host_unauthenticated(address, cfg.auth_enabled) {
        tracing::warn!(
            %address,
            "the broker is listening off-host with authentication disabled: \
             any host that can reach this address can publish and subscribe \
             without a password"
        );
    }

    tracing::info!(%listen, auth = cfg.auth_enabled, "starting");

    let connections = ConnectionSettings {
        connection_timeout_ms: CONNECTION_TIMEOUT_MS,
        max_payload_size: MAX_PAYLOAD_SIZE,
        max_inflight_count: MAX_INFLIGHT_COUNT,
        auth,
        external_auth: None,
        // A subscriber may create a filter the router has not seen published
        // yet. The item tree is discovered at runtime, so a client that
        // subscribes before mosd has published a service cannot be made to
        // wait for it.
        dynamic_filters: true,
    };

    // Both listeners on one port: rumqttd keys them by name, and a v4 client
    // and a v5 client differ only by the protocol level in their CONNECT.
    // Serving both is what lets an old bridge and a new dashboard share a
    // broker without either being told which one this is.
    let v4 = HashMap::from([(
        "mos".to_string(),
        ServerSettings {
            name: "mos".to_string(),
            listen,
            tls: None,
            next_connection_delay_ms: 0,
            connections: connections.clone(),
        },
    )]);
    let v5 = HashMap::from([(
        "mos-v5".to_string(),
        ServerSettings {
            name: "mos-v5".to_string(),
            listen,
            tls: None,
            next_connection_delay_ms: 0,
            connections,
        },
    )]);

    let config = rumqttd::Config {
        id: 0,
        router: RouterConfig {
            max_connections: MAX_CONNECTIONS,
            max_outgoing_packet_count: MAX_OUTGOING_PACKET_COUNT,
            max_segment_size: MAX_SEGMENT_SIZE,
            max_segment_count: MAX_SEGMENT_COUNT,
            custom_segment: None,
            initialized_filters: None,
            shared_subscriptions_strategy: Default::default(),
        },
        v4: Some(v4),
        v5: Some(v5),
        // Everything below is deliberately off. `ws` would be a second wire
        // protocol nobody asked for; `console` and `prometheus` would each
        // open an HTTP listener, and a broker that opened a second network
        // socket on an appliance is a second thing to attack and a second
        // thing to explain. `cluster` and `bridge` have no meaning on a single
        // device -- the bridge in this image is mos-mqttd, which is a client.
        ws: None,
        cluster: None,
        console: None,
        bridge: None,
        prometheus: None,
        metrics: None,
    };

    // `start` owns its own runtime and blocks; there is no async main here and
    // the crate needs no tokio of its own.
    let mut broker = Broker::new(config);
    broker.start().context("the broker exited")?;
    Ok(())
}
