# Design: mosd (management plane) — M2 design brief

> English | [中文](mosd.zh.md)
>
> Status: APPROVED 2026-08-18 (user) — D-Bus/zbus IPC and the settings model
> below are the M2 contract.
>
> **Updated for PLAN-010 M5 (2026-08-19):** §5 records the settings tree, the
> reconcilers registered today, and the bus surface including the two power
> methods. §1–§4 are the original M2 decision record; two statements in them
> were stale against the code and now carry inline corrections (§2's transport
> and §3's settings path). The `.zh.md` sibling has not been updated and is
> stale.
>
> **The HTTPS management daemon is `apid`.** It serves the API, and the
> dashboard is one client of it. Documents and task records written before the
> daemon was named that call it `webd`.
>
> **Updated for campaign `sshweb` (2026-08-19):** the tree is at **schema v4**
> (`access.ssh.authorizedKeys`), and the `SshdReconciler` row in §5.3 is
> corrected — it watches `access.ssh` alone and no longer drives `/etc/shadow`.
>
> **Updated for RFCT-084 (2026-08-23):** §5.4 records the update-orchestration
> members (`InstallUpdate`, `GetUpdateState`, `MarkUpdate`), the `update`
> live-state entry, and the resolution of the recorded burns-a-boot-attempt
> follow-up (`Reboot` is now slot-aware). §5.5's measurement is restated for
> the same date.
>
> **Updated for PLAN-022 (2026-08-28):** the tree is at **schema v7** and a
> `network` entry now declares a **kind**. §5.3a records what the network
> reconciler renders for a VLAN, a bridge and a WireGuard tunnel, how a removed
> virtual device is torn down, and where a tunnel's private key lives; §5.4
> gains `RotateWireguardKey`. §5.1's tree, §5.3's table and its count, and
> §5.4's `SCHEMA_VERSION` sentence are the earlier dated records they say they
> are and are not restated here.

## 1. What mosd is

The single Rust service that owns appliance state: a central settings/state
tree, persistence on STATE, reconcilers that apply settings to the execution
layer (systemd units, networkd, RAUC, balena-engine), and the bridge that
UIs (apid/kiosk) and future remote channels consume. Venus OS's D-Bus tree +
Bottlerocket's apiserver, in one scoped service.

## 2. Decision 1 — IPC protocol

Options: D-Bus (zbus) / varlink / gRPC.

**Recommendation: D-Bus via the pure-Rust `zbus` crate.** The deciding fact:
mosd must CONSUME D-Bus regardless — systemd (units/hostname), networkd,
RAUC, wpa_supplicant, bluez all expose D-Bus APIs. Speaking one bus in both
directions (consume system services, expose `com.mos.*` like Venus's
`com.victronenergy.*`) avoids running a second IPC ecosystem. apid bridges
HTTP/WebSocket ↔ D-Bus for browsers; gRPC/MQTT-style remote bridges attach
later at the edge, not in the core (Venus gui-v2 pattern: local bus, remote
bridge). varlink is elegant but its ecosystem is too thin to carry the
integration burden D-Bus removes for free.

> **Correction (2026-08-19): apid is not a WebSocket bridge.** The sentence
> above is the M2 sketch and no longer describes the code. apid renders
> server-side HTML (maud) over plain HTTP and calls mosd's D-Bus methods per
> request; there is no WebSocket, no long-lived subscription and no generic
> HTTP↔D-Bus passthrough. The live-value transport question is open and is
> tracked in `docs/design/dashboard.md`, not here.

## 3. Decision 2 — settings schema & persistence

**Recommendation:**

- Settings modeled as a typed Rust tree (serde), addressed by dot-paths
  (`network.eth0.dhcp`, `access.ssh.enabled`) — Venus-style addressing,
  self-documenting for UI binding.
- Persisted as versioned TOML on STATE (`/var/lib/mos/settings.toml` +
  `schema_version`); committed atomically (write-temp + rename).

  > **Correction (2026-08-19).** This line read `/state/mos/settings.toml`,
  > which is not a path that exists on any image. The real default is
  > `/var/lib/mos/settings.toml` (`mosd-settings/src/store.rs`, `DEFAULT_PATH`),
  > a bind from `/mnt/state/mos` (`ro-root.md` §4), and `mosd/src/main.rs`
  > documents the same. The doc contradicted both the code and §5.1 below.
- Migrations: Bottlerocket migrator pattern — forward AND backward migration
  units shipped with each release (PLAN-006 Part J requires the rollback
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

### 5.1 The settings tree at schema v4

Persisted as TOML on STATE at `/var/lib/mos/settings.toml`, addressed by
dot-path. `Settings::default()` serializes to exactly this, which is also what a
fresh device writes before first-boot provisioning seeds it:

```toml
schema_version = 4
hostname = "mos"

[network]                        # keyed by interface name, individually addressable

[access.ssh]                     # M5 — see access.md §3
enabled = false
port = 22
permitRootLogin = true
passwordAuthentication = true
listenAddresses = []             # empty = listen on ALL
authorizedKeys = []              # v4 — array of tables; see access.md §3.1

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
`password_hash` key — because apid already reads and writes it through the bus
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

**v4 adds `MigrateV3ToV4`**, which inserts an empty `access.ssh.authorizedKeys`
array and stamps the version. Rolling back to v3 **discards the key list**,
deliberately: v3 has no code that renders keys into an `authorized_keys` file,
so carrying them would be a v3 device promising an access path it cannot serve
— and v3's `deny_unknown_fields` would refuse to load the document at all. The
same rule applies, with a sharper consequence: **a rolled-back device loses
every authorized key, which is the only persistent way in.**

**How the rollback is actually carried (2026-08-21, RFCT-082).** The costs
above were written as if the down-migrations run on the device. They do not
and cannot: a rolled-back-to binary cannot carry the down-step a future schema
needs, and until RFCT-082 `Store::load` refused any newer `schema_version`
outright — so the priced, deliberate losses above were in practice a mosd
crash loop (`docs/design/api.md` §10.3 item 5). What runs instead is the
tolerant load: on a newer document, `Store::load_with_report` strips the keys
this schema does not know — mechanically the same loss this section already
prices — and parses the rest; the next save persists the stripped document at
this schema version. A future schema that **reshapes** an existing key
defeats stripping, and the load then falls back to `Settings::default()` with
an `error!`-level report: every setting including the admin credential is
abandoned and the device re-enters setup mode. **That loss is accepted in
writing here**, priced against the crash-loop alternative, and it binds
schema authors: prefer additive bumps; a reshaping bump forfeits settings on
rollback and its migration must say so. The registered down-migrations remain
for staged-downgrade tooling; they are no longer the (unreachable) rollback
story.

### 5.3 Reconcilers registered today

`reconciler::all()` returns five, in this order:

| Reconciler | Subtree | Executor |
|---|---|---|
| `HostnameReconciler` | `hostname` | systemd-hostnamed |
| `NetworkReconciler` | `network` | networkd units in `/run/systemd/network` |
| `SshdReconciler` | `access.ssh` **only** | sshd drop-in + one authorized-keys file per managed account + `ssh.service` |
| `WifiClientReconciler` | `wifi.client` | wpa_supplicant config + networkd + `wpa_supplicant@<if>.service` |
| `WifiApReconciler` | `wifi.ap` (reads `wifi.client` for the conflict check) | hostapd config + networkd + `hostapd@<if>.service` |

**The `SshdReconciler` row is corrected, and both cells were wrong.** It used to
read subtree `access.ssh`, `access.device` and effects "sshd drop-in +
`/etc/shadow` + `ssh.service`". `subtree()` returns `"access.ssh"` and has
returned only that since the reconciler was written; the extra cell was stale by
**supersession**, not by a typo. Under M5 the device credential flowed into
`/etc/shadow` through this reconciler, so a write to `access.device` genuinely
had to re-run it. Under the current access model it does not: nothing derives a
login credential from `access.device` at all (`provisioning.md` §3.6), so
watching it would schedule work with no effect to produce.

**The final subtree contract, stated so the absence reads as a decision:**
`SshdReconciler` watches **`access.ssh` and nothing else**. `access.device` is
**deliberately not watched.** A reader who finds the credential subtree missing
should not reconstruct it as an oversight and add it back.

And the effects cell: this reconciler **no longer writes `/etc/shadow`**. It
reads the marker beside it to decide whether password authentication may be
offered (`access.md` §3.1), but the only writers of that file today are mosd's
transient-password bus method and `mos-shadow-reconcile` at boot.

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
this: each reconciler publishes its status onto the live-state tree, which apid
reads over the bus.

### 5.3a The network reconciler at schema v7 (PLAN-022, 2026-08-28)

Everything above still holds for a physical interface: one `50-mos-<iface>.network`
file, rendered, compared, swept. What PLAN-022 added is a `kind` on each
`network` entry — physical, `vlan`, `bridge` or `wireguard` — and three things
the reconciler has to do that a `.network` file alone cannot express.

**A virtual link needs a `.netdev` as well.** The renderer is a second function
beside the unit renderer: *"Render the `.netdev` unit that creates `iface`, for
a kind that needs one"* (`os/pkgs/mosd/mosd/src/reconciler/network.rs:557`),
answering *"`None` for a physical entry, whose device the kernel already has"*
(`os/pkgs/mosd/mosd/src/reconciler/network.rs:559`). A VLAN's netdev carries
`Kind=vlan` and its `[VLAN] Id=`, a bridge's `Kind=bridge`, and a tunnel's
`Kind=wireguard` plus
*"the `[WireGuard]` and `[WireGuardPeer]` sections of a tunnel's netdev"*
(`os/pkgs/mosd/mosd/src/reconciler/network.rs:528-529`).

**Attachment is a line on the OTHER interface's unit.** A VLAN child is named
by its parent and a bridge port by nothing of its own, because
*"networkd creates a VLAN only when the parent's `.network` names it"*
(`os/pkgs/mosd/mosd/src/reconciler/network.rs:581-582`) — so the child's
existence is a fact the PARENT's unit has to state, and `render_unit` takes the
parent's VLAN children and the bridge that claimed this interface as arguments
rather than reading them off the entry. A port carries no addressing:
*"A port's addressing is the bridge's; validation has already refused an entry
that tried to keep its own"*
(`os/pkgs/mosd/mosd/src/reconciler/network.rs:587-588`). Both relations are
fail-closed before a single file is written — *"an undeclared parent is a VLAN
that would never come up"*
(`os/pkgs/mosd/mosd/src/reconciler/network.rs:444-445`) — which is the same
boundary argument the address validator makes: the settings file is writable
without apid.

**The sweep grew a teardown, because deleting a file is not deleting a device.**
The sweep still deletes every `50-mos-` unit the pass did not write, now over
both suffixes — *"Whether `file_name` is one this reconciler wrote:
`50-mos-<iface>.network` or, for a virtual link, `50-mos-<iface>.netdev`"*
(`os/pkgs/mosd/mosd/src/reconciler/network.rs:607-608`) — and it then asks the
kernel to drop the device, because *"Removing a `.netdev` file and reloading
does not delete the device networkd built from it: networkd creates virtual
devices, it does not reap them"*
(`os/pkgs/mosd/mosd/src/reconciler/network.rs:58-59`). The same delete covers a
netdev whose properties changed: *"Devices whose netdev properties changed. They
apply at creation only, so the device has to go and be built again"*
(`os/pkgs/mosd/mosd/src/reconciler/network.rs:648-649`). The deletes run
*"Before the reload, so networkd builds the recreated devices back on the same
pass that deleted them"* (`os/pkgs/mosd/mosd/src/reconciler/network.rs:698-699`),
and a failed delete in the sweep is logged rather than returned — the unit file
is already gone and failing there would report every converged interface as
unconverged.

**A WireGuard private key never enters the settings tree.** The schema is
explicit that it never will: *"There is no private-key field here and there
never will be"* (`os/pkgs/mosd/mosd-settings/src/model.rs:602`). The key lives
in a file under the STATE directory that holds `settings.toml`, in
`networkd-secrets/` — *"A sibling of `secrets/` rather than anything under it,
and the name says so because the path is load-bearing"*
(`os/pkgs/mosd/mosd/src/wgkeys.rs:38-39`), a sibling and not a child because the
identity module pins `secrets/` to 0700 on every pass and nothing below a 0700
directory is traversable by the `systemd-network` user. The modes follow from
who reads it: *"the key file is `root:systemd-network` 0640 under a sibling
directory of the same ownership at 0750"*
(`os/pkgs/mosd/mosd/src/wgkeys.rs:14-16`). Generation is lazy and idempotent —
*"Idempotent: an interface that already has a key keeps it, so a reconcile pass
never rotates by accident"* (`os/pkgs/mosd/mosd/src/wgkeys.rs:121-122`) — and
each write is the store's usual shape: *"temp file beside the target, fsync,
rename, fsync the directory"* (`os/pkgs/mosd/mosd/src/wgkeys.rs:160-161`), with
mode and group set on the temp file before the rename. The rendered unit names
the file rather than carrying the key: *"`PrivateKeyFile=` names the key rather
than carrying it"* (`os/pkgs/mosd/mosd/src/reconciler/network.rs:531`), which
matters because the netdev sits in networkd's world-readable runtime directory.
Only the public half is ever published, into the live-state entry —
`entry["publicKey"] = json!(self.keys.ensure(iface)?);`
(`os/pkgs/mosd/mosd/src/reconciler/network.rs:670`) — beside the `file`, `dhcp`
and `kind` keys every entry carries: `"kind": kind_name(cfg.kind),`
(`os/pkgs/mosd/mosd/src/reconciler/network.rs:660-664`).

This is the reconciler discipline's *"secrets reach the config file and nothing
else"* rule applied to a secret the config file may not hold either: the key
reaches its own file, and the module carries no logging statement at all.

**Rotation is a bus method, not a settings write.** `RotateWireguardKey(iface)`
answers the new public key, and it is a method for the reason the transient root
password is: *"Deliberately not a setting, for the reason a transient root
password is not one: a key that reached the settings tree would be persisted and
served back out of it"* (`os/pkgs/mosd/mosd/src/bus.rs:851-853`). It refuses an
interface that is not a declared `network` entry of kind `wireguard`, runs under
the same lock every mutating method takes, and then re-reconciles:
*"The reconcilers are re-run afterwards so the tunnel's unit is re-rendered and
networkd builds the device back around the key now on disk"*
(`os/pkgs/mosd/mosd/src/bus.rs:857-859`). The re-run is not optional, because
*"networkd reads `PrivateKeyFile=` when it creates the device and never again"*
(`os/pkgs/mosd/mosd/src/reconciler/network.rs:206-207`) — a rotation that only
rewrote the file would change what the public key says without changing what the
tunnel uses. No `SettingsChanged` is emitted: nothing in the settings tree
changed.

### 5.4 Bus surface

`com.mos.mosd1` carries, as of RFCT-084:

| Member | Kind | Added |
|---|---|---|
| `GetSettings` / `SetSettings` | method | M2 |
| `GetState` | method | M2 |
| `ReportHealth` | method | M4 |
| `SettingsChanged` | signal | M2 |
| `Reboot` | method | M5 |
| `PowerOff` | method | M5 |
| `SetTransientRootPassword` | method | RFCT-033 |
| `ForgetService` | method | RFCT-093 (PLAN-011 M5) |
| **`InstallUpdate`** | method | **RFCT-084** |
| **`GetUpdateState`** | method | **RFCT-084** |
| **`MarkUpdate`** | method | **RFCT-084** |
| **`RotateWireguardKey`** | method | **PLAN-022 M5 (RFCT-204)** — see §5.3a |

(The `com.mos.Item1` façade at `/` is a separate interface with its own
contract; see `docs/design/bus.md`.)

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

The layering the M2 contract set is preserved: apid is the UI and mosd owns
system actions. apid does not spawn processes, does not talk to systemd, and does
not touch `/sbin/reboot`; its only route to a power action is this bus. apid
exposes them as POST-only routes behind the existing session gate and an explicit
confirmation token, answering 202 with a rendered page and handing the D-Bus call
to a detached task — so the operator gets a page rather than a dropped connection
when the machine goes down mid-call.

**Update orchestration (RFCT-084).** The three update members speak to RAUC
(`de.pengutronix.rauc.Installer`) through a `RaucClient` trait
(`os/pkgs/mosd/mosd/src/rauc.rs`) with the same shape as the power control: lazy
per-call bus connection in production, a dry-run client that never touches the
host (constructed under `MOSD_DRY_RUN=1`, so no test can install a bundle on
the build host), and a recording mock for the bus-layer unit tests. Like the
power actions, updates are **actions, not settings** — nothing lands in the
settings tree, nothing is reconciled on boot, and everything observable is
recorded in the **live-state** tree under `update`: `operation`, `last_error`,
`progress`, a curated per-slot `slots` map, `booted_slot`, `primary`, a
`pending_not_confirmed` flag, plus `install` (`running`/`done`/`failed`, the
bundle path, the requesting bus name, the error text on failure) and
`last_mark`. The entry projects into the `com.mos.Item1` tree read-only, like
all live state.

- `InstallUpdate(bundle_path)` validates the path (absolute, existing regular
  file), refuses a second install while one runs, records
  `update.install = running`, and hands the install to a **background task** —
  the service lock and the bus dispatcher are never held across an install,
  which RAUC completes in minutes, not milliseconds. Completion (RAUC's
  `Completed` signal, subscribed before `InstallBundle` is called so a fast
  failure cannot be missed) is recorded together with a fresh status query.
- `GetUpdateState()` runs the status queries **without the service lock**,
  merges the result into `update` field-by-field (so `install`/`last_mark`
  survive a refresh), and answers the recorded entry as JSON.
- `MarkUpdate(state, slot)` is the operator's **manual** escape hatch,
  validated down to `good`/`bad` on `booted`/`other` before RAUC is asked —
  `active` and concrete slot names are deliberately not offered.

**What mosd deliberately does NOT do: confirm the booted slot.** The boot
health gate (`os/rootfs/overlay-v2/usr/lib/mos/mos-health`) owns the automatic
`rauc status mark-good` — it probes systemd, mosd and apid first, and an
automatic mark in mosd would duplicate that gate and could confirm a slot the
gate would have failed. `MarkUpdate` exists for the case the gate cannot
decide (e.g. a failed unit the operator has judged acceptable).

**Resolved follow-up (recorded at M5, closed by RFCT-084):** rebooting a slot
RAUC has installed but that has not completed a confirmed boot **burns a boot
attempt**, and nothing warned about it. `Reboot` (and therefore
`/Actions/reboot`, which dispatches through the same request path) now reads
the slot status first and, when the bootloader's first pick is not the booted
slot, logs the warning and records it as `power.update_warning` beside
`last_action` — before the power call, like the rest of the power record. A
warning, not a refusal: booting the new slot is what an updating operator
wants. The slot query is bounded (2 s) and non-fatal, so a reboot still goes
through when RAUC is absent (v1 image, container) or wedged. Honest limit: the
*other* unconfirmed window — already booted into the new slot, health gate not
yet run — is not visible in RAUC's `boot-status` (the U-Boot backend reads the
attempt counter only as exhausted-or-not), so it is not warned about; closing
it needs the gate to report its confirmation into mosd, which is an `os/`
change recorded as deferred in `docs/task/RFCT-084.md`. The apid power pane
does not yet display `power.update_warning`; that is apid's half and is
likewise recorded there as deferred.

### 5.5 Verification status

Everything above is verified locally: `bash os/pkgs/mosd/hack/check.sh` is green
(203 tests, measured 2026-08-19; the RFCT-084 additions were measured
crate-scoped on 2026-08-23 — `cargo nextest run -p mosd` green, including a
private-bus test that drives the production RAUC call path against a fake
`de.pengutronix.rauc` — because a concurrent workstream held the rest of the
workspace), and both image verifiers assert that the paths,
prefixes and unit names mosd renders are the ones the image actually ships —
reading them **out of the mosd source that owns them** rather than restating
them, because a constant restated in two places drifts and the drift is invisible
from the code side, where every test passes against a mock.

**No behaviour in this document has been observed on hardware.** See PLAN-010 M5
for the separation between what is proven locally and what remains the user's
acceptance.
