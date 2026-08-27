# RFCT-133 mosd emits SettingsChanged and apid's proxy cannot receive it

- **status**: completed
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

## Resolution

**The decision: a cache, not a broadcast channel.** The proxy declares the
`#[zbus(signal)] settings_changed(path, value_json)` member, and the
subscriber does something with every event: `watch_settings_changed`
(`os/pkgs/mosd/apid/src/bus_client.rs:102-152`) pumps the stream for the
daemon's lifetime and feeds RFCT-132's access cache — subscription live
marks it synchronised, a change whose dot-path can touch `access`
(segment-wise overlap) invalidates it, and any lapse drops it back to
unsynchronised and redials after one second. No log-only subscriber exists;
a change-stream API remains unbuilt and is recorded as such (api.md §8.3
item 2, now narrowed to exactly that).

The watcher holds its own connection rather than sharing `BusSettings`'s,
because that client empties its proxy cache on any failed call and a signal
stream must not die of an unrelated request's error. It is spawned in
`main.rs` before the listeners; until the first subscription is live the
gate simply keeps its per-request bus read.

**Tests.** `tests/settings_signal.rs` drives the real proxy member over a
private `dbus-daemon` against a fake mosd that emits the signal exactly as
the real one does (same `#[zbus(signal_emitter)]` shape): subscription
marks synchronised, an `access.webAdmin` write invalidates across the bus,
a `hostname` write does not, and killing the bus is observed as a lapse
that empties and disables the cache. mosd's own emitter was already
covered by `mosd/tests/bus.rs::bus_roundtrip`. These tests are new-API —
their red form is "does not compile" (no signal member existed), so no
behavioural red run was possible for this half.

**Commits.** `d42f31a` (signal member, cache module, watcher, tests),
`5502a4f` (citation re-anchoring).
