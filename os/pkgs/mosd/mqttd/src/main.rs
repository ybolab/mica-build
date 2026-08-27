//! `mos-mqttd` — the MQTT bridge over the `com.mos.Item1` item tree.
//!
//! Everything the daemon does is in the library ([`mos_mqttd`]); this is the
//! command line, the logger and the call into [`mos_mqttd::runtime::run`].

use clap::Parser;
use mos_mqttd::config::{Mode, Timings};
use mos_mqttd::runtime::{self, Settings};

/// The MQTT data-publishing bridge for the mos item tree.
#[derive(Debug, Parser)]
#[command(name = "mos-mqttd", version)]
struct Args {
    /// Broker host to connect to.
    #[arg(long, default_value = "localhost")]
    broker_host: String,

    /// Broker port.
    #[arg(long, default_value_t = 1883)]
    broker_port: u16,

    /// MQTT client id. Must be unique on the broker.
    #[arg(long, default_value = "mos-mqttd")]
    client_id: String,

    /// Whether write requests reach the bus. Defaults to read-only: a bridge
    /// nobody configured cannot be a control path.
    #[arg(long, value_enum, default_value_t = Mode::ReadOnly)]
    mode: Mode,

    /// Use the session bus instead of the system bus.
    #[arg(long)]
    session_bus: bool,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::INFO)
        .init();
    let args = Args::parse();
    tracing::info!(
        broker = format!("{}:{}", args.broker_host, args.broker_port),
        mode = ?args.mode,
        "starting"
    );
    runtime::run(Settings {
        broker_host: args.broker_host,
        broker_port: args.broker_port,
        client_id: args.client_id,
        mode: args.mode,
        session_bus: args.session_bus,
        timings: Timings::default(),
    })
    .await
}
