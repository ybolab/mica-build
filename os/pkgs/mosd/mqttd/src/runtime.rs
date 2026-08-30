//! MQTT and D-Bus I/O around the application-only protocol state machine.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::time::{Duration, Instant};

use futures_util::StreamExt;
use rumqttc::{AsyncClient, Event, MqttOptions, Packet};
use tokio::sync::{mpsc, oneshot};
use tokio::task::JoinHandle;
use zbus::{MatchRule, MessageStream};

use crate::bridge::{Bridge, Effects, Write};
use crate::config::{Mode, Timings};
use crate::enrollment::Enrollment;
use crate::source::{BusSource, ItemSource, ItemTreeProxy, batch_of};
use crate::topic::{self, Application};
use crate::transport::{MqttTransport, Transport};

/// Carry out one event's broker publications and application writes.
pub async fn apply(
    effects: Effects,
    transport: &dyn Transport,
    source: &dyn ItemSource,
) -> anyhow::Result<()> {
    for publication in &effects.publications {
        transport.publish(publication).await?;
    }
    for Write {
        application,
        path,
        value,
    } in &effects.writes
    {
        let outcome = source.set_value(application, path, value.clone()).await;
        if outcome.accepted() {
            tracing::info!(
                application = application.bus_name(),
                path,
                "write request carried through to application SetValue"
            );
        } else {
            tracing::warn!(
                application = application.bus_name(),
                path,
                outcome = ?outcome,
                "application write request was not carried out"
            );
        }
    }
    Ok(())
}

/// Everything the daemon is told at startup.
pub struct Settings {
    pub device_id: String,
    pub applications_dir: PathBuf,
    pub broker_host: String,
    pub broker_port: u16,
    pub client_id: String,
    pub mode: Mode,
    pub session_bus: bool,
    pub timings: Timings,
}

const REQUEST_CAPACITY: usize = 64;
const RECONNECT_BACKOFF_MIN: Duration = Duration::from_secs(1);
const RECONNECT_BACKOFF_MAX: Duration = Duration::from_secs(30);

/// Doubling broker reconnect backoff with a floor and ceiling.
#[derive(Debug, Clone, Copy)]
pub struct ReconnectBackoff {
    next: Duration,
}

impl Default for ReconnectBackoff {
    fn default() -> Self {
        Self {
            next: RECONNECT_BACKOFF_MIN,
        }
    }
}

impl ReconnectBackoff {
    pub fn next_delay(&mut self) -> Duration {
        let delay = self.next;
        self.next = (self.next * 2).min(RECONNECT_BACKOFF_MAX);
        delay
    }

    pub fn reset(&mut self) {
        self.next = RECONNECT_BACKOFF_MIN;
    }
}

enum Incoming {
    Message { topic: String, payload: Vec<u8> },
    Connected,
}

enum ApplicationEvent {
    Items {
        bus_name: String,
        generation: u64,
        items: BTreeMap<String, Option<crate::item::Item>>,
    },
    WatcherStopped {
        bus_name: String,
        generation: u64,
        detail: String,
    },
}

struct ActiveApplication {
    owner: String,
    generation: u64,
    watcher: JoinHandle<()>,
}

impl Drop for ActiveApplication {
    fn drop(&mut self) {
        self.watcher.abort();
    }
}

fn merge(mut left: Effects, right: Effects) -> Effects {
    left.publications.extend(right.publications);
    left.writes.extend(right.writes);
    left
}

fn handle_application_event(
    now: Duration,
    bridge: &mut Bridge,
    active: &mut BTreeMap<String, ActiveApplication>,
    event: ApplicationEvent,
) -> Effects {
    match event {
        ApplicationEvent::Items {
            bus_name,
            generation,
            items,
        } => {
            if active
                .get(&bus_name)
                .is_some_and(|current| current.generation == generation)
            {
                bridge.on_items_changed(now, &bus_name, items)
            } else {
                Effects::default()
            }
        }
        ApplicationEvent::WatcherStopped {
            bus_name,
            generation,
            detail,
        } => {
            if active
                .get(&bus_name)
                .is_some_and(|current| current.generation == generation)
            {
                active.remove(&bus_name);
                tracing::warn!(
                    application = bus_name,
                    error = detail,
                    "application ItemsChanged watcher stopped; withdrawing stale MQTT state"
                );
                bridge.on_service_vanished(now, &bus_name)
            } else {
                Effects::default()
            }
        }
    }
}

/// Match ownership changes in the mos namespace.
///
/// The signal comes from the bus daemon, not from the named service. The
/// runtime checks the exact enrollment before asking for an owner or creating
/// an Item1 proxy, so an unregistered service such as mosd is observed only as
/// a string and is never called or subscribed to.
fn mos_owner_rule() -> zbus::Result<MatchRule<'static>> {
    Ok(MatchRule::builder()
        .msg_type(zbus::message::Type::Signal)
        .sender("org.freedesktop.DBus")?
        .interface("org.freedesktop.DBus")?
        .member("NameOwnerChanged")?
        .arg0ns(mos_busname::PREFIX.trim_end_matches('.'))?
        .build())
}

async fn watch_application(
    connection: zbus::Connection,
    application: Application,
    generation: u64,
    ready: oneshot::Sender<Result<(), String>>,
    tx: mpsc::Sender<ApplicationEvent>,
) -> anyhow::Result<()> {
    let proxy = match ItemTreeProxy::builder(&connection)
        .destination(application.bus_name().to_string())?
        .build()
        .await
    {
        Ok(proxy) => proxy,
        Err(err) => {
            let _ = ready.send(Err(err.to_string()));
            return Err(err.into());
        }
    };
    let mut changes = match proxy.receive_items_changed().await {
        Ok(changes) => changes,
        Err(err) => {
            let _ = ready.send(Err(err.to_string()));
            return Err(err.into());
        }
    };
    let _ = ready.send(Ok(()));
    while let Some(signal) = changes.next().await {
        let items = batch_of(signal.args()?.items);
        if tx
            .send(ApplicationEvent::Items {
                bus_name: application.bus_name().to_string(),
                generation,
                items,
            })
            .await
            .is_err()
        {
            return Ok(());
        }
    }
    anyhow::bail!("ItemsChanged stream ended")
}

#[allow(clippy::too_many_arguments)]
async fn activate_application(
    connection: &zbus::Connection,
    source: &BusSource,
    bridge: &mut Bridge,
    active: &mut BTreeMap<String, ActiveApplication>,
    next_generation: &mut u64,
    changes_tx: &mpsc::Sender<ApplicationEvent>,
    now: Duration,
    application: Application,
    owner: String,
) -> Effects {
    let bus_name = application.bus_name().to_string();
    if active
        .get(&bus_name)
        .is_some_and(|current| current.owner == owner)
    {
        return Effects::default();
    }

    let effects = if active.remove(&bus_name).is_some() {
        bridge.on_service_vanished(now, &bus_name)
    } else {
        Effects::default()
    };

    *next_generation = next_generation.wrapping_add(1);
    let generation = *next_generation;
    let watcher_application = application.clone();
    let watcher_connection = connection.clone();
    let watcher_tx = changes_tx.clone();
    let stopped_tx = changes_tx.clone();
    let stopped_application = application.clone();
    let (ready_tx, ready_rx) = oneshot::channel();
    let watcher = tokio::spawn(async move {
        if let Err(err) = watch_application(
            watcher_connection,
            watcher_application.clone(),
            generation,
            ready_tx,
            watcher_tx,
        )
        .await
        {
            let _ = stopped_tx
                .send(ApplicationEvent::WatcherStopped {
                    bus_name: stopped_application.bus_name().to_string(),
                    generation,
                    detail: err.to_string(),
                })
                .await;
        }
    });

    match ready_rx.await {
        Ok(Ok(())) => {}
        Ok(Err(detail)) => {
            watcher.abort();
            tracing::warn!(
                application = application.bus_name(),
                error = detail,
                "application is present but its ItemsChanged watcher cannot be established"
            );
            return effects;
        }
        Err(_) => {
            watcher.abort();
            tracing::warn!(
                application = application.bus_name(),
                "application ItemsChanged watcher stopped before it became ready"
            );
            return effects;
        }
    }

    match source.get_items(&application).await {
        Ok(items) => {
            active.insert(
                bus_name,
                ActiveApplication {
                    owner,
                    generation,
                    watcher,
                },
            );
            merge(effects, bridge.upsert_service(now, application, items))
        }
        Err(err) => {
            watcher.abort();
            tracing::warn!(
                application = application.bus_name(),
                error = %err,
                "application is present but its Item1 tree is not readable; check its exact-name D-Bus policy grant"
            );
            effects
        }
    }
}

/// Connect to enrolled application services and the broker, then run until
/// the process is asked to stop.
pub async fn run(settings: Settings) -> anyhow::Result<()> {
    if !topic::valid_topic_segment(&settings.device_id) {
        anyhow::bail!("configured device id cannot form an MQTT topic segment");
    }
    let enrollment = Enrollment::load(&settings.applications_dir).await?;
    let connection = if settings.session_bus {
        zbus::Connection::session().await?
    } else {
        zbus::Connection::system().await?
    };
    let source = BusSource::new(connection.clone());

    let owner_rule = mos_owner_rule()?;
    let mut owners = Box::pin(MessageStream::for_match_rule(owner_rule, &connection, None).await?);
    let bus = zbus::fdo::DBusProxy::new(&connection).await?;

    let mut options = MqttOptions::new(
        settings.client_id.clone(),
        settings.broker_host.clone(),
        settings.broker_port,
    );
    options.set_keep_alive(Duration::from_secs(30));
    let (client, mut eventloop) = AsyncClient::new(options, REQUEST_CAPACITY);
    let transport = MqttTransport::new(client);

    let (incoming_tx, mut incoming) = mpsc::channel(REQUEST_CAPACITY);
    tokio::spawn(async move {
        let mut backoff = ReconnectBackoff::default();
        loop {
            let event = match eventloop.poll().await {
                Ok(event) => {
                    backoff.reset();
                    event
                }
                Err(err) => {
                    let delay = backoff.next_delay();
                    tracing::warn!(
                        error = %err,
                        retry_in_s = delay.as_secs(),
                        "broker connection lost; retrying after backoff"
                    );
                    tokio::time::sleep(delay).await;
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

    let (changes_tx, mut changes) = mpsc::channel(REQUEST_CAPACITY);
    let mut active = BTreeMap::new();
    let mut next_generation = 0u64;
    let mut bridge = Bridge::new(settings.device_id, settings.mode, settings.timings);
    let mut subscribed = Vec::new();
    let start = Instant::now();

    // The ownership match is installed before this sweep, so a service that
    // appears during it is either listed or queued as a signal (possibly
    // both; owner equality makes the duplicate harmless).
    for name in bus.list_names().await? {
        let Some(application) = enrollment.application(name.as_str()) else {
            continue;
        };
        let owner = match bus.get_name_owner(name.clone().into()).await {
            Ok(owner) => owner.to_string(),
            Err(_) => continue,
        };
        let effects = activate_application(
            &connection,
            &source,
            &mut bridge,
            &mut active,
            &mut next_generation,
            &changes_tx,
            start.elapsed(),
            application,
            owner,
        )
        .await;
        apply(effects, &transport, &source).await?;
    }
    resubscribe(&bridge, &transport, &mut subscribed).await?;

    loop {
        let now = start.elapsed();
        let wake = bridge.next_wake(now).map(|wake| start + wake);
        let effects = tokio::select! {
            event = changes.recv() => {
                let Some(event) = event else { return Ok(()) };
                handle_application_event(start.elapsed(), &mut bridge, &mut active, event)
            }
            owner = owners.next() => {
                let Some(owner) = owner else { return Ok(()) };
                let owner = owner?;
                let (name, _old_owner, new_owner) =
                    owner.body().deserialize::<(String, String, String)>()?;
                let Some(application) = enrollment.application(&name) else {
                    continue;
                };
                if new_owner.is_empty() {
                    if active.remove(&name).is_some() {
                        tracing::info!(application = name, "application left the bus; clearing retained MQTT state");
                        bridge.on_service_vanished(start.elapsed(), &name)
                    } else {
                        Effects::default()
                    }
                } else {
                    activate_application(
                        &connection,
                        &source,
                        &mut bridge,
                        &mut active,
                        &mut next_generation,
                        &changes_tx,
                        start.elapsed(),
                        application,
                        new_owner,
                    ).await
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

async fn sleep_until(deadline: Option<Instant>) {
    match deadline {
        Some(deadline) => tokio::time::sleep_until(deadline.into()).await,
        None => std::future::pending().await,
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use std::time::Duration;

    use serde_json::json;

    use super::{ActiveApplication, ApplicationEvent, handle_application_event, mos_owner_rule};
    use crate::bridge::Bridge;
    use crate::config::{Mode, Timings};
    use crate::item::Item;

    #[test]
    fn the_bus_filters_discovery_to_the_mos_namespace() {
        let rule = mos_owner_rule().expect("valid mos ownership rule");
        let rendered = rule.to_string();
        assert!(rendered.contains("arg0namespace='com.mos'"), "{rendered}");
        assert!(rendered.contains("member='NameOwnerChanged'"), "{rendered}");
    }

    #[tokio::test]
    async fn a_stopped_current_watcher_withdraws_stale_application_state() {
        let enrollment = crate::enrollment::Enrollment::from_names(["com.mos.sensor.example"])
            .expect("valid enrollment");
        let application = enrollment
            .application("com.mos.sensor.example")
            .expect("enrolled application");
        let mut bridge = Bridge::new("abc123", Mode::Full, Timings::default());
        bridge.upsert_service(
            Duration::ZERO,
            application,
            BTreeMap::from([
                ("/DeviceInstance".to_string(), Item::new(json!(0))),
                ("/Temperature".to_string(), Item::new(json!(21))),
            ]),
        );
        bridge.on_keepalive(Duration::ZERO);

        let mut active = BTreeMap::from([(
            "com.mos.sensor.example".to_string(),
            ActiveApplication {
                owner: ":1.42".to_string(),
                generation: 7,
                watcher: tokio::spawn(std::future::pending()),
            },
        )]);
        let effects = handle_application_event(
            Duration::from_secs(1),
            &mut bridge,
            &mut active,
            ApplicationEvent::WatcherStopped {
                bus_name: "com.mos.sensor.example".to_string(),
                generation: 7,
                detail: "signal stream ended".to_string(),
            },
        );

        assert!(active.is_empty(), "the stale mirror remained active");
        assert!(
            effects.publications.iter().any(|publication| {
                publication.topic == "N/abc123/sensor/0/Temperature"
                    && publication.payload.is_empty()
                    && publication.retain
            }),
            "the stale retained value was not withdrawn"
        );
    }
}
