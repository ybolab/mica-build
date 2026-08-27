# RFCT-133 mosd emits SettingsChanged and apid's proxy cannot receive it

- **status**: in progress
- **priority**: P2
- **owner**: bkd/0fibgdbm
- **createdAt**: 2026-08-26

mosd emits `SettingsChanged(path, value_json)` after every successful
`SetSettings` (`mosd/mosd/src/bus.rs:531-533`, declared at `:728-732`).

apid's proxy declares four methods and no signal member:

```rust
trait Mosd {
    fn get_settings(&self, path: &str) -> zbus::Result<String>;
    fn set_settings(&self, path: &str, value_json: &str) -> zbus::Result<()>;
    fn get_state(&self, path: &str) -> zbus::Result<String>;
    fn set_transient_root_password(&self, password: &str) -> zbus::Result<()>;
}
```

(`mosd/apid/src/bus_client.rs:20-25`) — no `#[zbus(signal)]` anywhere in the
file. The signal is emitted into a subscriber that does not exist.

Two things wait on it. apid cannot cache anything it reads from mosd, because
it has no way to learn the value changed — which is what makes the gate's
per-request read on the unauthenticated path unavoidable ([[RFCT-132]]). And
the API can offer no change stream: every client that wants to know a setting
moved has to poll for it.

Adding the `#[zbus(signal)]` member is small. What it needs beside it is a
decision about what apid does with the events — a cache, a broadcast channel,
or both — because a subscriber that only logs is a third mechanism nobody
invokes.
