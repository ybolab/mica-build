//! Where effects become I/O, and the daemon's event loop.
//!
//! [`apply`] is the only place a publication reaches a broker and the only
//! place a write reaches the bus, which is what lets the protocol tests
//! drive the production path with a [`Transport`] of their own.
//!
//! [`run`] is the rest: zbus streams, the rumqttc event loop, and the timer.
//! It is kept deliberately thin, because it is the one part of the crate the
//! transport double does not cover.

use std::time::{Duration, Instant};

use futures_util::StreamExt;
use rumqttc::{AsyncClient, Event, MqttOptions, Packet};
use tokio::sync::mpsc;

use crate::bridge::{Bridge, Effects, Write};
use crate::config::{Mode, SERVICE, Timings};
use crate::source::{BusSource, ItemSource, ItemTreeProxy, batch_of, retry_note};
use crate::topic;
use crate::transport::{MqttTransport, Transport};

/// Carry out one event's effects.
///
/// Publications go out first: they are the answer to whatever produced them,
/// and a write's own consequences arrive later as an `ItemsChanged` of their
/// own. A publication that cannot be handed to the broker aborts the batch —
/// it means the client is gone, and the caller reconnects — while a write
/// that the bus refuses is logged and does not: a refused write is an answer,
/// not a failure of this process.
pub async fn apply(
    effects: Effects,
    transport: &dyn Transport,
    source: &dyn ItemSource,
) -> anyhow::Result<()> {
    for publication in &effects.publications {
        transport.publish(publication).await?;
    }
    for Write { path, value } in &effects.writes {
        let outcome = source.set_value(path, value.clone()).await;
        if outcome.accepted() {
            tracing::info!(path, "write request carried through to SetValue");
        } else {
            // Only the outcome travels; the reason stayed inside mosd
            // (`docs/design/bus.md` §3). What a client can still act on is the
            // persist/dispatch distinction, which is a property of the path.
            tracing::warn!(
                path,
                outcome = ?outcome,
                retry = retry_note(path),
                "write request was not carried out"
            );
        }
    }
    Ok(())
}

/// Everything the daemon is told at startup.
pub struct Settings {
    pub broker_host: String,
    pub broker_port: u16,
    pub client_id: String,
    pub mode: Mode,
    pub session_bus: bool,
    pub timings: Timings,
}

/// Capacity of the channel between the caller and rumqttc's event loop.
const REQUEST_CAPACITY: usize = 64;

/// What the event loop feeds the bridge.
enum Incoming {
    /// A message on a subscribed topic.
    Message { topic: String, payload: Vec<u8> },
    /// The broker accepted a connection: every subscription has to be made
    /// again, because this bridge connects with a clean session.
    Connected,
}

/// Connect to the bus and the broker and run until the process is asked to
/// stop.
pub async fn run(settings: Settings) -> anyhow::Result<()> {
    let class = topic::class_of(SERVICE)
        .ok_or_else(|| anyhow::anyhow!("{SERVICE} is not a com.mos.* bus name"))?;
    let connection = if settings.session_bus {
        zbus::Connection::session().await?
    } else {
        zbus::Connection::system().await?
    };
    let source = BusSource::new(connection.clone());

    let mut options = MqttOptions::new(
        settings.client_id.clone(),
        settings.broker_host.clone(),
        settings.broker_port,
    );
    options.set_keep_alive(Duration::from_secs(30));
    let (client, mut eventloop) = AsyncClient::new(options, REQUEST_CAPACITY);
    let transport = MqttTransport::new(client);

    // rumqttc's event loop is not cancel-safe, so it is never a branch of the
    // select below: it owns a task and reports through a channel.
    let (incoming_tx, mut incoming) = mpsc::channel(REQUEST_CAPACITY);
    tokio::spawn(async move {
        loop {
            let event = match eventloop.poll().await {
                Ok(event) => event,
                Err(err) => {
                    tracing::warn!(error = %err, "broker connection lost; rumqttc will retry");
                    continue;
                }
            };
            let forwarded = match event {
                Event::Incoming(Packet::Publish(publish)) => Incoming::Message {
                    topic: publish.topic,
                    payload: publish.payload.to_vec(),
                },
                Event::Incoming(Packet::ConnAck(_)) => Incoming::Connected,
                _ => continue,
            };
            if incoming_tx.send(forwarded).await.is_err() {
                return;
            }
        }
    });

    let tree = ItemTreeProxy::new(&connection).await?;
    let mut changes = tree.receive_items_changed().await?;
    let bus = zbus::fdo::DBusProxy::new(&connection).await?;
    let mut owners = bus
        .receive_name_owner_changed_with_args(&[(0, SERVICE)])
        .await?;

    let mut bridge = Bridge::new(class, settings.mode, settings.timings);
    let mut subscribed: Vec<String> = Vec::new();
    let start = Instant::now();

    // A device that is not on the bus yet is simply an empty mirror: the
    // NameOwnerChanged stream above brings it in when it arrives.
    match source.get_items().await {
        Ok(items) => {
            let effects = bridge.seed(start.elapsed(), items);
            apply(effects, &transport, &source).await?;
        }
        Err(err) => tracing::info!(error = %err, "{SERVICE} is not on the bus yet"),
    }
    resubscribe(&bridge, &transport, &mut subscribed).await?;

    loop {
        let now = start.elapsed();
        let wake = bridge.next_wake(now).map(|wake| start + wake);
        let effects = tokio::select! {
            signal = changes.next() => {
                let Some(signal) = signal else { return Ok(()) };
                let items = signal.args()?.items;
                bridge.on_items_changed(start.elapsed(), batch_of(items))
            }
            change = owners.next() => {
                let Some(change) = change else { return Ok(()) };
                let args = change.args()?;
                if args.new_owner().is_none() {
                    tracing::info!("{SERVICE} left the bus; clearing its retained state");
                    bridge.on_device_vanished(start.elapsed())
                } else {
                    let items = source.get_items().await.unwrap_or_default();
                    bridge.seed(start.elapsed(), items)
                }
            }
            message = incoming.recv() => {
                let Some(message) = message else { return Ok(()) };
                match message {
                    Incoming::Message { topic, payload } => {
                        bridge.on_request(start.elapsed(), &topic, &payload)
                    }
                    Incoming::Connected => {
                        subscribed.clear();
                        Effects::default()
                    }
                }
            }
            () = sleep_until(wake) => bridge.on_tick(start.elapsed()),
            _ = tokio::signal::ctrl_c() => return Ok(()),
        };
        apply(effects, &transport, &source).await?;
        resubscribe(&bridge, &transport, &mut subscribed).await?;
    }
}

/// Bring the broker's subscription set in line with what the bridge needs.
///
/// The set changes when the device id first arrives, when it moves, and after
/// a reconnect drops it.
async fn resubscribe(
    bridge: &Bridge,
    transport: &dyn Transport,
    subscribed: &mut Vec<String>,
) -> anyhow::Result<()> {
    let wanted = bridge.subscriptions();
    if wanted == *subscribed {
        return Ok(());
    }
    for filter in subscribed.iter().filter(|filter| !wanted.contains(filter)) {
        transport.unsubscribe(filter).await?;
    }
    for filter in wanted.iter().filter(|filter| !subscribed.contains(filter)) {
        tracing::info!(filter, "subscribing");
        transport.subscribe(filter).await?;
    }
    *subscribed = wanted;
    Ok(())
}

/// Sleep until `deadline`, or forever when the bridge has nothing due.
async fn sleep_until(deadline: Option<Instant>) {
    match deadline {
        Some(deadline) => tokio::time::sleep_until(deadline.into()).await,
        None => std::future::pending().await,
    }
}
