# Design: mosd (management plane) — M2 design brief

> English | [中文](mosd.zh.md)
>
> Status: APPROVED 2026-08-18 (user) — D-Bus/zbus IPC and the settings model
> below are the M2 contract.

## 1. What mosd is

The single Rust service that owns appliance state: a central settings/state
tree, persistence on STATE, reconcilers that apply settings to the execution
layer (systemd units, networkd, RAUC, balena-engine), and the bridge that
UIs (webd/kiosk) and future remote channels consume. Venus OS's D-Bus tree +
Bottlerocket's apiserver, in one scoped service.

## 2. Decision 1 — IPC protocol

Options: D-Bus (zbus) / varlink / gRPC.

**Recommendation: D-Bus via the pure-Rust `zbus` crate.** The deciding fact:
mosd must CONSUME D-Bus regardless — systemd (units/hostname), networkd,
RAUC, wpa_supplicant, bluez all expose D-Bus APIs. Speaking one bus in both
directions (consume system services, expose `com.mos.*` like Venus's
`com.victronenergy.*`) avoids running a second IPC ecosystem. webd bridges
HTTP/WebSocket ↔ D-Bus for browsers; gRPC/MQTT-style remote bridges attach
later at the edge, not in the core (Venus gui-v2 pattern: local bus, remote
bridge). varlink is elegant but its ecosystem is too thin to carry the
integration burden D-Bus removes for free.

## 3. Decision 2 — settings schema & persistence

**Recommendation:**

- Settings modeled as a typed Rust tree (serde), addressed by dot-paths
  (`network.eth0.dhcp`, `access.ssh.enabled`) — Venus-style addressing,
  self-documenting for UI binding.
- Persisted as versioned TOML on STATE (`/state/mos/settings.toml` +
  `schema_version`); committed atomically (write-temp + rename).
- Migrations: Bottlerocket migrator pattern — forward AND backward migration
  units shipped with each release (PLAN-006 Part I requires the rollback
  direction to work).
- Reconciler contract: each subsystem reconciler watches a subtree and owns
  rendering to its executor (networkd units, sshd drop-ins, RAUC calls);
  status is published back onto the bus tree (settings vs live-state split,
  like Venus settings vs service paths).

## 4. M2 scope guard

M2 delivers: workspace (pma-rust baseline), bus service with `com.mos.*`
tree, settings persistence + migration skeleton, TWO reconcilers only
(hostname, network/networkd). Everything else (updates, access, connd
integration) lands in its own milestone against this contract.
