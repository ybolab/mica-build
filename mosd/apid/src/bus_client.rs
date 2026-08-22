//! zbus client for mosd, implementing [`SettingsApi`].
//!
//! Two interfaces on the one connection: `com.mos.mosd1` for the settings,
//! state and transient-password calls, and `com.mos.Item1` for the power
//! actions, which are items under `/Actions/` rather than methods
//! (`docs/design/bus.md` §7).

use serde_json::Value;
use tokio::sync::Mutex;
use zbus::zvariant;

use crate::config::BusKind;
use crate::settings_api::SettingsApi;

#[zbus::proxy(
    interface = "com.mos.mosd1",
    default_service = "com.mos.mosd",
    default_path = "/com/mos/mosd"
)]
trait Mosd {
    fn get_settings(&self, path: &str) -> zbus::Result<String>;
    fn set_settings(&self, path: &str, value_json: &str) -> zbus::Result<()>;
    fn get_state(&self, path: &str) -> zbus::Result<String>;
    fn set_transient_root_password(&self, password: &str) -> zbus::Result<()>;
}

/// `com.mos.Item1` on one item object path. Only the write half is used here:
/// the power pane triggers an action by writing to it.
///
/// No `default_path` — an item proxy is built for an exact path, because mosd
/// serves each item as its own object and an unknown path answers with a
/// D-Bus `UnknownObject` error rather than a result code.
#[zbus::proxy(interface = "com.mos.Item1", default_service = "com.mos.mosd")]
trait Item {
    fn set_value(&self, value: &zvariant::Value<'_>) -> zbus::Result<i32>;
}

/// Object path of the action item behind each power action
/// (`docs/design/bus.md` §7).
const REBOOT_ACTION: &str = "/Actions/reboot";
const POWER_OFF_ACTION: &str = "/Actions/poweroff";

/// The one `SetValue` code that means the write took effect
/// (`docs/design/bus.md` §1.1).
///
/// Deliberately the only code named here. Failure is "not this", not a list:
/// the contract reserves every negative code for a failure and mosd's failure
/// vocabulary is free to grow, so apid stays correct without tracking it.
const SET_OK: i32 = 0;

/// The value written to trigger an action item.
///
/// Arbitrary on purpose: an action item reads a constant `0` and mosd forces
/// it back to `0` after the write, so the write itself is the trigger and the
/// value is ignored (`docs/design/bus.md` §7).
const TRIGGER: u32 = 1;

/// Trigger the action item at `path` on `connection`.
///
/// The return code *is* the dispatch result, and any code but [`SET_OK`] is
/// a failure. It carries no reason — mosd logs why locally and never sends it
/// back — so it becomes an error here, which is what the `Reboot`/`PowerOff`
/// methods used to return, and reaches the caller's existing failure path
/// unchanged. The code is reported verbatim rather than interpreted: apid has
/// no decision to make that distinguishing two failures would change.
async fn trigger(connection: &zbus::Connection, path: &str) -> anyhow::Result<()> {
    let item = ItemProxy::new(connection, path).await?;
    match item.set_value(&zvariant::Value::from(TRIGGER)).await? {
        SET_OK => Ok(()),
        code => Err(anyhow::anyhow!(
            "mosd did not dispatch the action at `{path}`: SetValue returned {code}"
        )),
    }
}

/// Lazily-connected mosd client. The proxy is built on first use and cached;
/// any call error drops the cache so the next request reconnects. mosd not
/// being up yet therefore surfaces as per-request errors (502 pages), never
/// as an apid crash.
pub struct BusSettings {
    bus: BusKind,
    proxy: Mutex<Option<MosdProxy<'static>>>,
}

impl BusSettings {
    /// Client for the given bus; no connection is attempted yet.
    pub fn new(bus: BusKind) -> Self {
        Self {
            bus,
            proxy: Mutex::new(None),
        }
    }

    /// Return the cached proxy, connecting first when necessary.
    async fn proxy(&self) -> anyhow::Result<MosdProxy<'static>> {
        let mut cached = self.proxy.lock().await;
        if let Some(proxy) = cached.as_ref() {
            return Ok(proxy.clone());
        }
        let connection = match self.bus {
            BusKind::System => zbus::Connection::system().await,
            BusKind::Session => zbus::Connection::session().await,
        }?;
        let proxy = MosdProxy::new(&connection).await?;
        *cached = Some(proxy.clone());
        Ok(proxy)
    }

    /// The connection the cached proxy is on, connecting first when
    /// necessary. Item calls ride the same connection, and so inherit the
    /// same "mosd is not up yet" behaviour: a per-request error, never a
    /// crash.
    async fn connection(&self) -> anyhow::Result<zbus::Connection> {
        Ok(self.proxy().await?.inner().connection().clone())
    }

    /// Drop the cached proxy after a failed call.
    async fn reset(&self) {
        *self.proxy.lock().await = None;
    }

    /// Trigger a power action item, with the cache handling every other call
    /// here uses: a failure drops the proxy so the next request reconnects.
    async fn trigger_action(&self, path: &str) -> anyhow::Result<()> {
        let connection = self.connection().await?;
        match trigger(&connection, path).await {
            Ok(()) => Ok(()),
            Err(err) => {
                self.reset().await;
                Err(err)
            }
        }
    }
}

#[cfg(test)]
impl BusSettings {
    /// Client that talks over `connection` instead of dialling for itself, for
    /// the tests that serve a fake mosd on a private bus.
    ///
    /// The proxy cache is seeded, so no connect is ever attempted. A failed
    /// call still empties the cache exactly as in production, and the next
    /// call would then dial for real — a test wanting a second call after a
    /// failure needs a second client.
    pub async fn with_connection(connection: &zbus::Connection) -> anyhow::Result<Self> {
        let client = Self::new(BusKind::Session);
        *client.proxy.lock().await = Some(MosdProxy::new(connection).await?);
        Ok(client)
    }
}

#[async_trait::async_trait]
impl SettingsApi for BusSettings {
    async fn get_settings(&self, path: &str) -> anyhow::Result<Value> {
        let proxy = self.proxy().await?;
        match proxy.get_settings(path).await {
            Ok(json) => Ok(serde_json::from_str(&json)?),
            Err(err) => {
                self.reset().await;
                Err(err.into())
            }
        }
    }

    async fn set_settings(&self, path: &str, value: &Value) -> anyhow::Result<()> {
        let proxy = self.proxy().await?;
        match proxy.set_settings(path, &value.to_string()).await {
            Ok(()) => Ok(()),
            Err(err) => {
                self.reset().await;
                Err(err.into())
            }
        }
    }

    async fn get_state(&self, path: &str) -> anyhow::Result<Value> {
        let proxy = self.proxy().await?;
        match proxy.get_state(path).await {
            Ok(json) => Ok(serde_json::from_str(&json)?),
            Err(err) => {
                self.reset().await;
                Err(err.into())
            }
        }
    }

    /// Written as an item rather than called as a method: mosd logs the
    /// request and records it in live state before the power call either way,
    /// attributed to apid, because the item write carries the same sender.
    async fn reboot(&self) -> anyhow::Result<()> {
        self.trigger_action(REBOOT_ACTION).await
    }

    async fn power_off(&self) -> anyhow::Result<()> {
        self.trigger_action(POWER_OFF_ACTION).await
    }

    async fn set_transient_root_password(&self, password: &str) -> anyhow::Result<()> {
        let proxy = self.proxy().await?;
        match proxy.set_transient_root_password(password).await {
            Ok(()) => Ok(()),
            // The error is returned as mosd raised it. mosd's own contract is
            // that no message it raises here carries the password, and nothing
            // is added to it on the way back.
            Err(err) => {
                self.reset().await;
                Err(err.into())
            }
        }
    }
}
