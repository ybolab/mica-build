//! zbus client for `com.mos.mosd1`, implementing [`SettingsApi`].

use serde_json::Value;
use tokio::sync::Mutex;

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
    fn reboot(&self) -> zbus::Result<()>;
    fn power_off(&self) -> zbus::Result<()>;
}

/// Lazily-connected mosd client. The proxy is built on first use and cached;
/// any call error drops the cache so the next request reconnects. mosd not
/// being up yet therefore surfaces as per-request errors (502 pages), never
/// as a webd crash.
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

    /// Drop the cached proxy after a failed call.
    async fn reset(&self) {
        *self.proxy.lock().await = None;
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

    async fn reboot(&self) -> anyhow::Result<()> {
        let proxy = self.proxy().await?;
        match proxy.reboot().await {
            Ok(()) => Ok(()),
            Err(err) => {
                self.reset().await;
                Err(err.into())
            }
        }
    }

    async fn power_off(&self) -> anyhow::Result<()> {
        let proxy = self.proxy().await?;
        match proxy.power_off().await {
            Ok(()) => Ok(()),
            Err(err) => {
                self.reset().await;
                Err(err.into())
            }
        }
    }
}
