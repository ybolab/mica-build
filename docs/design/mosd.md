# Design: mosd (management plane) — M2 design brief

> English | [中文](mosd.zh.md)
>
> Status: APPROVED 2026-08-18 (user) — D-Bus/zbus IPC and the settings model
> below are the M2 contract.
>
> **Updated for PLAN-010 M5 (2026-08-19):** §5 records the settings tree as it
> stands at schema v3, the reconcilers registered today, and the bus surface
> including the two power methods. §1–§4 are the original M2 decision record and
> are unchanged. The `.zh.md` sibling has not been updated and is stale.

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

## 5. Where this stands after M5 (2026-08-19)

The M2 contract above held: nothing in it needed revisiting to add the access,
provisioning and connd features. This section records what is actually in the
tree, so a reader does not have to reconstruct it from five task records.

### 5.1 The settings tree at schema v3

Persisted as TOML on STATE at `/var/lib/mos/settings.toml`, addressed by
dot-path. `Settings::default()` serializes to exactly this, which is also what a
fresh device writes before first-boot provisioning seeds it:

```toml
schema_version = 3
hostname = "mos"

[network]                        # keyed by interface name, individually addressable

[access.ssh]                     # M5 — see access.md §3
enabled = false
port = 22
permitRootLogin = true
passwordAuthentication = true
listenAddresses = []             # empty = listen on ALL

[access.console]                 # M5 — schema only, no reconciler consumes it yet
shellEnabled = false

[access.device]                  # M5 — credential metadata, never the credential
generation = 0

[provisioning]                   # M5 — see provisioning.md §2
state = "pending"                # pending | complete
seededGeneration = 0

[wifi.client]                    # M5 — see connd.md §3
enabled = false
interface = "wlan0"
networks = []

[wifi.ap]                        # M5 — see connd.md §4
mode = "off"                     # off | provisioning | always
interface = "wlan0"
channel = 6
countryCode = "US"
address = "192.168.4.1/24"
holdDownSeconds = 120            # deliberately unconsumed — connd.md §5
graceSeconds = 60                # deliberately unconsumed — connd.md §5
```

`access.webAdmin` is unchanged from v2 — same serialized path, same
`password_hash` key — because webd already reads and writes it through the bus
by that exact dot-path. It is absent above only because a fresh tree has no web
admin yet.

**Optional values are absent, not empty.** `access.device.passwordHash`,
`provisioning.deviceId`, `wifi.ap.ssid`, `wifi.ap.psk` and a network's `psk` all
carry `skip_serializing_if = "Option::is_none"`, so an unset secret is a missing
key rather than an empty string. **No secret has a non-`None` default**, and that
is load-bearing rather than tidy — see provisioning.md §3.1.

`deny_unknown_fields` is on every struct, so a document carrying a key this
version does not know fails to load rather than silently dropping it.

### 5.2 Migration, and what a rollback costs

The Bottlerocket pattern held: `MigrateV2ToV3` is registered alongside
`MigrateV0ToV1` and `MigrateV1ToV2`, so `Store::load` walks a v0, v1 or v2
document all the way to v3 on first read. `up` stamps the version and inserts the
empty `provisioning` and `wifi` tables; it does not touch `access` at all,
because the v3-only keys inside it are supplied by serde defaults — which is what
keeps `access.webAdmin` byte-identical through the upgrade.

**Rolling back to v2 loses three things, deliberately and irreversibly:** the SSH
policy, the console shell policy, and the device credential hash with its
generation counter. v2 software has no reconciler for any of them, and
`deny_unknown_fields` means keeping the keys would produce a document v2 cannot
deserialize at all. A rolled-back device falls back to v2 behaviour, and rolling
forward again restores the v3 *defaults*, not the values that were there before.

The rule that follows: **anything that must survive a rollback cannot live in a
v3-only key.**

### 5.3 Reconcilers registered today

`reconciler::all()` returns five, in this order:

| Reconciler | Subtree | Executor |
|---|---|---|
| `HostnameReconciler` | `hostname` | systemd-hostnamed |
| `NetworkReconciler` | `network` | networkd units in `/run/systemd/network` |
| `SshdReconciler` | `access.ssh`, `access.device` | sshd drop-in + `/etc/shadow` + `ssh.service` |
| `WifiClientReconciler` | `wifi.client` | wpa_supplicant config + networkd + `wpa_supplicant@<if>.service` |
| `WifiApReconciler` | `wifi.ap` (reads `wifi.client` for the conflict check) | hostapd config + networkd + `hostapd@<if>.service` |

The M2 contract's reconciler shape survived contact with four more subsystems
unchanged, and the M5 reconcilers converged on a common discipline worth stating
as the contract for the next one:

- **pure render, then compare, then write.** The render is a deterministic
  function of the subtree; `apply` re-renders, compares against what is on disk,
  and skips the write when the bytes match. These files live on STATE, so an
  unconditional rewrite costs a flash write on every reconcile.
- **read live state before acting.** Ask systemd for the unit's `ActiveState` and
  unit-file state first, and issue only the calls that change something. A
  converged system produces **zero** bus calls.
- **restart on config change.** The one case that must not be a no-op: a daemon
  that reads its configuration once at start, whose file changed under it, is
  restarted. Otherwise the rewrite silently did not take effect.
- **enablement is runtime-scoped** (`EnableUnitFiles` with `runtime = true`).
  Persistent enablement needs `/etc/systemd/system` to be writable, and on the v2
  read-only root it is not — a persistent enable would fail with EROFS on device
  while passing every test on a normal filesystem. mosd reconciles the whole tree
  at every start, so units return to their configured state each boot anyway.
- **outcomes are named, never boolean** — `applied`, `unchanged`, `idle`,
  `disabled`, `stopped`, `conflict`, `absent`, `plaintext-missing`. Several of
  these are skips, and confusing two of them is how a broken image gets reported
  as a healthy one.
- **secrets reach the config file and nothing else** — not the live-state tree
  (which is served over D-Bus), not a log line, not an error message.

The settings/live-state split the M2 contract called for is what carries all of
this: each reconciler publishes its status onto the live-state tree, which webd
reads over the bus.

### 5.4 Bus surface

`com.mos.mosd1` carries, as of M5:

| Member | Kind | Added |
|---|---|---|
| `GetSettings` / `SetSettings` | method | M2 |
| `GetState` | method | M2 |
| `ReportHealth` | method | M4 |
| `SettingsChanged` | signal | M2 |
| **`Reboot`** | method | **M5** |
| **`PowerOff`** | method | **M5** |

`Reboot` and `PowerOff` forward to `Reboot` / `PowerOff` on
`org.freedesktop.systemd1.Manager`. They are **not reconcilers** and do not live
under `reconciler/`: a power action has no settings subtree, nothing to converge
and nothing to re-apply on boot. `mosd-settings` is untouched by them and
`SCHEMA_VERSION` stays at 3; a request is recorded in the **live-state** tree
under `power` as `{ last_action, requested_by }` — state, not settings, and not
persisted.

Each method resolves the caller's unique bus name and **logs the action and its
source and records it in live state BEFORE invoking the power control**, because
after the call there may be no system left to log on.

The layering the M2 contract set is preserved: webd is the UI and mosd owns
system actions. webd does not spawn processes, does not talk to systemd, and does
not touch `/sbin/reboot`; its only route to a power action is this bus. webd
exposes them as POST-only routes behind the existing session gate and an explicit
confirmation token, answering 202 with a rendered page and handing the D-Bus call
to a detached task — so the operator gets a page rather than a dropped connection
when the machine goes down mid-call.

**Recorded follow-up:** rebooting a slot RAUC has installed but that has not been
marked good **burns a boot attempt**, and the power pane has no update-state
awareness and does not warn about it. Making it warn means giving the power pane
a dependency on update state, which was deliberately not built in M5.

### 5.5 Verification status

Everything above is verified locally: `bash mosd/hack/check.sh` is green
(203 tests, measured 2026-08-19), and both image verifiers assert that the paths,
prefixes and unit names mosd renders are the ones the image actually ships —
reading them **out of the mosd source that owns them** rather than restating
them, because a constant restated in two places drifts and the drift is invisible
from the code side, where every test passes against a mock.

**No behaviour in this document has been observed on hardware.** See PLAN-010 M5
for the separation between what is proven locally and what remains the user's
acceptance.
