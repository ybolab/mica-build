# Design: mosd (management plane) — M2 design brief

> English | [中文](../zh/design/mosd.md)
>
> Status: the D-Bus/zbus IPC choice and the settings model below are the
> standing contract, approved 2026-08-18.
>
> Sections 1-4 are the original decision record and are kept as reasoning.
> Section 5 states where the design stands now: the settings tree is at
> **schema v8**, seven reconcilers are registered, and the bus carries the
> update-orchestration and WireGuard-rotation members alongside the original
> settings, state and power surface.
>
> **The HTTPS management daemon is `apid`.** It serves the API, and the
> dashboard is one client of it. Older material calls it `webd`.

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
- Persisted as versioned documents, committed atomically (write-temp, mode,
  fsync, rename, directory fsync).

  > **Correction (2026-08-19).** This line read `/state/mos/settings.toml`,
  > which is not a path that exists on any image. The real default is
  > `/var/lib/mos/settings.toml` (`pkgs/mosd/mosd-settings/src/store.rs`,
  > `DEFAULT_PATH`), a bind from `/mnt/state/mos` (`docs/design/ro-root.md` §4),
  > and `pkgs/mosd/mosd/src/main.rs`
  > documents the same. The doc contradicted both the code and §5.1 below.

  > **Superseded in part (PLAN-070 §5.2).** "One versioned TOML on STATE" is
  > no longer true and §5.1a below is what is. System configuration moved to
  > `/mos/config/` on DATA as one JSON document per reconciler; what the device
  > mints or observes about itself stays in `settings.toml` on STATE at the
  > path the correction above names. Each document carries its own
  > `schema_version`. The atomic-commit half of the line is unchanged.
- Migrations: Bottlerocket migrator pattern — forward AND backward migration
  units shipped with each release (the A/B design requires the rollback
  direction to work).

  > **Superseded (PLAN-070 §5.2.3).** The registry and the `V0→V12` chain were
  > deleted with the single document they migrated: this tree is in system
  > development and carries no fielded device holding a v12 `settings.toml`, so
  > a split chain would have been code written to convert a document that does
  > not exist. Each document now starts at its own v1. The *discipline* the
  > pattern taught survives as §5.1a's version rules, and the rollback
  > direction is carried at runtime by the tolerant load (§5.2 below), which
  > is what actually runs on a device.
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

### 5.1 The settings tree

Addressed by dot-path, and **stored in several documents** — §5.1a is where
each key lives and why. `Settings::default()` serializes to exactly the tree
below, which is also what a fresh device holds before first-boot provisioning
seeds it. It is shown as one document because that is how every reader
addresses it; the `schema_version` line is gone from it because after
PLAN-070 §5.2.3 there is no tree-wide version to show.

```toml
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

### 5.1a `/mos/config/`: where system configuration lives, and the rules a subsystem inherits

**PLAN-070 §5.2 decided that system configuration lives in `/mos/config/` on
DATA**, so that an integrator can flash a device, pour the configuration in,
and have it work with no provisioning ceremony between the two. This section is
the rule list a subsystem author meets, restated here rather than left in the
plan record, because an author who needs it will be reading this file.

**Where each key lives.** The boundary is not a judgement, it is the tier-1
reset partition (`docs/design/recovery.md` §2.1): *`/mos/config/` holds what an
integrator sets; the settings store on STATE holds what the device mints or
observes about itself, the credential material derived from it, and the intents
it is carrying out.* Tier 1 clears what an integrator set, so the set it clears
**is** the set that lives here — and "is this a document or a settings key?"
is answered by asking whether tier 1 clears it.

| Document | Settings subtree it carries | Reconciler |
|---|---|---|
| `/mos/config/system.json` | `hostname`, `access.console` | hostname |
| `/mos/config/network.json` | `network` | network |
| `/mos/config/wifi.json` | `wifi` | wifiAp, wifiClient |
| `/mos/config/ssh.json` | `access.ssh` | sshd |
| `/mos/config/mqtt.json` | `mqtt` | mqtt |
| `/mos/config/time.json` | `time` | time |
| `/mos/config/container.json` | `container` | container |
| `/var/lib/mos/settings.toml` | `provisioning`, `access.webAdmin`, `access.device`, `access.claim`, `access.apiTokens`, the staged `reset` intent | — |

The unit is the subtree the apply engine already dispatches on, not the
subsystem as a reader might name it, so a write's blast radius is one document
and its apply is one reconciler run. `wifi.json` carries both Wi-Fi reconcilers
because `wifiAp` declares the whole `wifi` subtree rather than `wifi.ap` — a
narrowing that was tried, measured to hide a cross-subtree dependency from the
overlap test, and reverted. Grouping by reconciler keeps that coupling inside
one atomic write.

**The staged `reset` intent stays on STATE and that is not a technicality.**
Tiers 1 and 3 clear `/mos/config/`; put the record that asks for a reset inside
it and the tier would clear the thing that tells it to run, halfway through
running.

**Addressing does not change.** `GET`/`PUT /api/v1/settings/<dot.path>` works
exactly as before: the dot-path selects the document and then the key inside
it. The six-entry write allowlist, the shape check behind it, the refusal
sentence, the redactor, the subtree-overlap dispatch and the task queue all key
on dot-paths and are untouched. Two consequences that are not free:

- **`access` is split across the boundary**, so `GET /api/v1/settings/access`
  no longer names one file — it composes the two stores, because the read
  surface is addressing rather than storage.
- **`schema_version` is no longer a key of the tree.** There is no tree-wide
  version left; `GET /api/v1/meta`'s `settingsSchemaVersion` reports the STATE
  document's.

**The rules a later subsystem inherits.**

- **Naming: `/mos/config/<document>.json`, one flat document per reconciler.**
  A directory per subsystem is rejected: one document means one writer, one
  atomic rename and one parse-error blast radius, while a directory invites
  several files with **no transaction across them**, so a subsystem could
  half-apply a change and have no way to say so. A flat listing of
  `/mos/config/` is also the namespace's own index. A subsystem that genuinely
  needs several documents may take a directory, at that stated cost.
- **JSON.** These are machine-written documents and JSON is what a machine
  writes without a round-trip formatting problem; a mixed-format namespace
  means every reader guesses by extension.
- **Machine-written, never hand-edited.** The writing daemon owns the file's
  shape. A human edits it through an authenticated API; if a human edits it
  with `vi`, the next write overwrites them and that is documented behaviour,
  not a bug. The pour is the one exception and it is bounded: an integrator
  writes these files onto a device that is **not running**, and mosd validates
  what it finds on the next boot exactly as it validates its own output. A pour
  onto a running device is not supported, for the reason
  `docs/design/provisioning.md` gives for having no udev trigger — inserting
  media must not reconfigure a running appliance.
- **Atomic: temp file, mode set before the rename, fsync, rename, directory
  fsync.** An interrupted write leaves the previous document intact, never a
  truncated one.
- **Fail closed on a parse error, with no fallback.** A document that exists
  and does not parse refuses rather than reverting to a schema default. A parse
  error is not absence, and treating it as absence configures a device the way
  nobody chose. **An absent document is a default; an absent
  `/mos/config/` is not** — that is the medium being gone, and mosd refuses to
  start and names the mount (§5.2a).
- **`0700` on the directory, `0600` on every document, and the namespace is
  credential material.** `mos-data-layout` establishes the mode;
  `Store::save` sets each document's mode **before** the rename, so a document
  is never reachable under its final name at a laxer mode. The failure this
  prevents is concrete: an unprivileged local process reading
  `/mos/config/wifi.json` and recovering the site's WPA2 pre-shared key, which
  is offline-crackable from a captured handshake and is a credential the device
  was *given* rather than one it minted. A directory an integrator copies onto
  a device is credential material on the integrator's laptop too, and
  `docs/design/provisioning.md` §4.1.6 already settled what the device owes
  there: `0700`/`0600` on arrival, no read-back, and no value the document
  carried copied into any served record — and nothing about the laptop, because
  claiming that would buy the appearance of erasure.
- **A secret-bearing key is spelled with a name the redactor already carries,
  or the change that adds it adds the name.** The redactor
  (`pkgs/mosd/apid/src/redact.rs`) is a denylist of field names and is
  fail-open by design. The moved schema satisfies the rule with nothing added:
  its only secret-bearing keys are `wifi.ap.psk` and
  `wifi.client.networks[].psk`, both spelled `psk`. The rule exists because the
  alternative is an author who picks `sharedSecret`, ships it, and finds out
  from a support case.
- **One version per document, additive bumps, and no migration that moves a key
  between documents.** §5.2 below is the whole of it.
- **One writer per document, and it is a daemon.** mosd writes; apid holds the
  authenticated route and **asks**. Two processes never write one document,
  which no amount of atomic renaming makes safe.
- **Reset disposition is the directory's.** Tiers 1 and 3 re-seed
  `/mos/config/`, tier 2 leaves it alone, tier 4 clears it with everything else
  (`docs/design/recovery.md` §2.1).

### 5.2 Schema versions, and what a rollback costs

**One version per document, not one for the namespace** (PLAN-070 §5.2.3).
A namespace-wide version is refused on a specific failure: a bump would rewrite
every document, and several atomic renames have **no transaction across them**,
so a power loss halfway would leave documents at mixed versions — a third
state, which is exactly what the staged-intent design of `ResetSettings` exists
to refuse. Per document, each migrates alone under its own rename, so a power
loss leaves each document either old or new.

Every document starts at **v1**, including the STATE remainder: it is a
document too and is not exempt for being what is left over.

**The `V0→V12` chain is not ported; it was deleted with the document it
migrated.** There is no fielded device holding a v12 `settings.toml`, so a
split chain would have been code written to convert a document that does not
exist. What carries forward is the discipline, which is the part that was ever
load-bearing:

- a bump is **additive**, and `skip_serializing_if` keeps a new optional table
  out of a document that does not use it, so two adjacent versions of one
  document differ by the version integer alone;
- every migration has a `down` as well as an `up`, and the `down` states what
  it discards;
- the reason for both is **A/B rollback survivability**: the system slot can go
  backwards and the configuration on DATA does not, so an older binary must be
  able to read a newer document;
- **no migration may move a key from one document to another**, because that is
  the migration with no transaction. A key that has to move is a new key in the
  destination and a deprecation in the source — two independent additive bumps,
  either of which is survivable alone. The same constraint from the other side:
  do not write a validation rule that spans two documents.

**What was lost, named rather than glossed.** The twelve steps of the deleted
chain carried twelve recorded arguments about what a bump may do and what a
`down` may discard. The four rules above are the extract; they are not the
whole of it. That is the price of not writing a migration for a device that
does not exist, and it was paid deliberately.

**How the rollback is actually carried (2026-08-21, per document since
PLAN-070).** The costs above are not paid by down-migrations running on the
device: a rolled-back-to binary cannot carry the down-step a future schema
needs. What runs instead is the tolerant load. On a document whose
`schema_version` is newer than this build writes, `Store::load_with_report`
strips the keys this schema does not know — recursively, by the names serde's
`deny_unknown_fields` rejections give — and parses the rest; the next save
persists the stripped document at this build's version. A future schema that
**reshapes** an existing key defeats stripping, and that document alone falls
back to its schema default with an `error!`-level report naming it.

**The blast radius of that loss is now one document**, which is the second
thing the per-document version buys. Before the split, a reshaped key anywhere
abandoned every setting including the admin credential and put the device back
in setup mode on its LAN. Now a reshaped `wifi.json` costs the Wi-Fi settings
and leaves the network configuration, the ssh policy and the management
credential alone. **The loss is still accepted in writing**, priced against the
crash-loop alternative — refusing the document makes mosd exit, and under
`Restart=on-failure` the rolled-back-to slot becomes a crash loop that also
fails its health gate — and it still binds schema authors: prefer additive
bumps; a reshaping bump forfeits its document's settings on rollback and must
say so.

### 5.2a Fail closed on the medium

System configuration is on DATA, so **a device whose DATA pool does not mount
has no configuration** — and it must not render a different one. PLAN-070
§5.2.6 measured the differential first: STATE and DATA are two partitions on
one medium, so a DATA fault is not an independent failure domain, and apid's
unit already carries `RequiresMountsFor=/var/lib/mos /mos`. What a DATA fault
already costs is the management API and the container and update workspaces;
what the move would additionally cost is the configured network.

The rule: **mosd fails closed.** Its unit carries `RequiresMountsFor=/mos`, and
`Store::load` refuses when `/mos/config/` is not there rather than composing a
tree out of schema defaults — DHCP on every interface, sshd off — which would
be unreachable by anyone relying on the static address they configured, while
looking fine. The refusal names the mount, because that is the fact an operator
at the serial console needs. The recovery route is
`docs/design/recovery.md`'s: the serial console and the reset tiers, not a
silently degraded network.

Note the asymmetry with the paragraph above it, and it is deliberate: **an
absent document is a default, an absent namespace is a refusal.** A document
that was never written is a subsystem that was never configured; a namespace
that is not there is a medium that did not mount.

The alternative — keeping `network` and `hostname` on STATE so a DATA fault
leaves a device reachable on its configured address — is rejected because it
re-creates two homes for configuration and makes "which tier does this
subsystem take" a judgement call rather than a measured boundary. It is
re-openable, and the thing that would re-open it is evidence that a DATA-only
fault is a real failure mode on this hardware rather than a theoretical one.

### 5.3 Reconcilers registered today

`reconciler::all()` returns seven. The first five, in order:

| Reconciler | Subtree | Executor |
|---|---|---|
| `HostnameReconciler` | `hostname` | systemd-hostnamed |
| `NetworkReconciler` | `network` | networkd units in `/run/systemd/network` |
| `SshdReconciler` | `access.ssh` **only** | sshd drop-in + one authorized-keys file per managed account + `ssh.service` |
| `WifiClientReconciler` | `wifi.client` | wpa_supplicant config + networkd + `wpa_supplicant@<if>.service` |
| `WifiApReconciler` | `wifi.ap` (reads `wifi.client` for the conflict check) | hostapd config + networkd + `hostapd@<if>.service` |

The last two, registered since and taking the final positions in the list:

| Reconciler | Subtree | Executor |
|---|---|---|
| `ContainerReconciler` | `container` | the Quadlet directory's STATE bind unit + `daemon-reload` + the units Quadlet generates from it |
| `MqttReconciler` | `mqtt` | broker config file + `mos-mqtt-broker.service` + `mos-mqttd.service` |

Each cell, measured. Both subtrees are the reconciler's own name:
`"container"` (`pkgs/mosd/mosd/src/reconciler/container.rs`) and
`"mqtt"` (`pkgs/mosd/mosd/src/reconciler/mqtt.rs`). The container
executor is not a daemon — the engine is daemonless and the image carries no
podman unit — so what the reconciler operates is the mount that makes Quadlet's
directory readable, `pub const QUADLET_MOUNT_UNIT: &str = "etc-containers-systemd.mount";`
(`pkgs/mosd/mosd/src/reconciler/container.rs`), followed by
`self.control.daemon_reload().await?;`
(`pkgs/mosd/mosd/src/reconciler/container.rs`), without which the mount
is correct, the files are visible and no unit exists. The MQTT executor writes
`const DEFAULT_CONFIG_PATH: &str = "/run/mos/mqtt-broker.toml";`
(`pkgs/mosd/mosd/src/reconciler/mqtt.rs`) and drives two units,
`const BROKER_UNIT: &str = "mos-mqtt-broker.service";`
(`pkgs/mosd/mosd/src/reconciler/mqtt.rs`) and
`const BRIDGE_UNIT: &str = "mos-mqttd.service";`
(`pkgs/mosd/mosd/src/reconciler/mqtt.rs`).

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
  Persistent enablement needs `/etc/systemd/system` to be writable, and on the mos
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

### 5.3a The network reconciler: kinds, netdevs and teardown

Everything above still holds for a physical interface: one `50-mos-<iface>.network`
file, rendered, compared, swept. What schema v7 added is a `kind` on each
`network` entry — physical, `vlan`, `bridge` or `wireguard` — and three things
the reconciler has to do that a `.network` file alone cannot express.

**A virtual link needs a `.netdev` as well.** The renderer is a second function
beside the unit renderer: *"Render the `.netdev` unit that creates `iface`, for
a kind that needs one"* (`pkgs/mosd/mosd/src/reconciler/network.rs`),
answering *"`None` for a physical entry, whose device the kernel already has"*
(`pkgs/mosd/mosd/src/reconciler/network.rs`). A VLAN's netdev carries
`Kind=vlan` and its `[VLAN] Id=`, a bridge's `Kind=bridge`, and a tunnel's
`Kind=wireguard` plus
*"the `[WireGuard]` and `[WireGuardPeer]` sections of a tunnel's netdev"*
(`pkgs/mosd/mosd/src/reconciler/network.rs`).

**Attachment is a line on the OTHER interface's unit.** A VLAN child is named
by its parent and a bridge port by nothing of its own, because
*"networkd creates a VLAN only when the parent's `.network` names it"*
(`pkgs/mosd/mosd/src/reconciler/network.rs`) — so the child's
existence is a fact the PARENT's unit has to state, and `render_unit` takes the
parent's VLAN children and the bridge that claimed this interface as arguments
rather than reading them off the entry. A port carries no addressing:
*"A port's addressing is the bridge's; validation has already refused an entry
that tried to keep its own"*
(`pkgs/mosd/mosd/src/reconciler/network.rs`). Both relations are
fail-closed before a single file is written — *"an undeclared parent is a VLAN
that would never come up"*
(`pkgs/mosd/mosd/src/reconciler/network.rs`) — which is the same
boundary argument the address validator makes: the settings file is writable
without apid.

**The sweep grew a teardown, because deleting a file is not deleting a device.**
The sweep still deletes every `50-mos-` unit the pass did not write, now over
both suffixes — *"Whether `file_name` is one this reconciler wrote:
`50-mos-<iface>.network` or, for a virtual link, `50-mos-<iface>.netdev`"*
(`pkgs/mosd/mosd/src/reconciler/network.rs`) — and it then asks the
kernel to drop the device, because *"Removing a `.netdev` file and reloading
does not delete the device networkd built from it: networkd creates virtual
devices, it does not reap them"*
(`pkgs/mosd/mosd/src/reconciler/network.rs`). The same delete covers a
netdev whose properties changed: *"Devices whose netdev properties changed. They
apply at creation only, so the device has to go and be built again"*
(`pkgs/mosd/mosd/src/reconciler/network.rs`). The deletes run
*"Before the reload, so networkd builds the recreated devices back on the same
pass that deleted them"* (`pkgs/mosd/mosd/src/reconciler/network.rs`),
and a failed delete in the sweep is logged rather than returned — the unit file
is already gone and failing there would report every converged interface as
unconverged.

**A WireGuard private key never enters the settings tree.** The schema is
explicit that it never will: *"There is no private-key field here and there
never will be"* (`pkgs/mosd/mosd-settings/src/model.rs`). The key lives
in a file under the STATE directory that holds `settings.toml`, in
`networkd-secrets/` — *"A sibling of `secrets/` rather than anything under it,
and the name says so because the path is load-bearing"*
(`pkgs/mosd/mosd/src/wgkeys.rs`), a sibling and not a child because the
identity module pins `secrets/` to 0700 on every pass and nothing below a 0700
directory is traversable by the `systemd-network` user. The modes follow from
who reads it: *"the key file is `root:systemd-network` 0640 under a sibling
directory of the same ownership at 0750"*
(`pkgs/mosd/mosd/src/wgkeys.rs`). Generation is lazy and idempotent —
*"Idempotent: an interface that already has a key keeps it, so a reconcile pass
never rotates by accident"* (`pkgs/mosd/mosd/src/wgkeys.rs`) — and
each write is the store's usual shape: *"temp file beside the target, fsync,
rename, fsync the directory"* (`pkgs/mosd/mosd/src/wgkeys.rs`), with
mode and group set on the temp file before the rename. The rendered unit names
the file rather than carrying the key: *"`PrivateKeyFile=` names the key rather
than carrying it"* (`pkgs/mosd/mosd/src/reconciler/network.rs`), which
matters because the netdev sits in networkd's world-readable runtime directory.
Only the public half is ever published, into the live-state entry —
`entry["publicKey"] = json!(self.keys.ensure(iface)?);`
(`pkgs/mosd/mosd/src/reconciler/network.rs`) — beside the `file`, `dhcp`
and `kind` keys every entry carries: `"kind": kind_name(cfg.kind),`
(`pkgs/mosd/mosd/src/reconciler/network.rs`).

This is the reconciler discipline's *"secrets reach the config file and nothing
else"* rule applied to a secret the config file may not hold either: the key
reaches its own file, and the module carries no logging statement at all.

**Rotation is a bus method, not a settings write.** `RotateWireguardKey(iface)`
answers the new public key, and it is a method for the reason the transient root
password is: *"Deliberately not a setting, for the reason a transient root
password is not one: a key that reached the settings tree would be persisted and
served back out of it"* (`pkgs/mosd/mosd/src/bus.rs`). It refuses an
interface that is not a declared `network` entry of kind `wireguard`, runs under
the same lock every mutating method takes, and then re-reconciles:
*"The reconcilers are re-run afterwards so the tunnel's unit is re-rendered and
networkd builds the device back around the key now on disk"*
(`pkgs/mosd/mosd/src/bus.rs`). The re-run is not optional, because
*"networkd reads `PrivateKeyFile=` when it creates the device and never again"*
(`pkgs/mosd/mosd/src/reconciler/network.rs`) — a rotation that only
rewrote the file would change what the public key says without changing what the
tunnel uses. No `SettingsChanged` is emitted: nothing in the settings tree
changed.

### 5.4 Bus surface

`com.mos.mosd1` carries:

| Member | Kind |
|---|---|
| `GetSettings` / `SetSettings` | method |
| `GetTask` | method |
| `GetState` | method |
| `ReportHealth` | method |
| `SettingsChanged` | signal |
| `TaskChanged` | signal |
| `Reboot` | method |
| `PowerOff` | method |
| `SetTransientRootPassword` | method |
| `ForgetService` | method |
| **`InstallUpdate`** | method |
| **`GetUpdateState`** | method |
| **`MarkUpdate`** | method |
| **`CheckUpdate`** | method |
| **`FetchUpdate`** | method |
| **`SetRebootOverride`** | method |
| **`RotateWireguardKey`** | method |

mosd deliberately exports no `com.mos.Item1` façade. System settings, live
state and actions remain on this management interface and are not MQTT
application data. `mos-mqttd` has zero policy access to `com.mos.mosd`; APID
runs as root and reaches the interface through the root-only local policy. mosd
renders the bridge's already-provisioned topic identity to the one-purpose
`/run/mos/mqttd-device.env` runtime file before starting it.

`SetSettings` now ends at persistence plus enqueue and returns a task id. A
single worker owns reconcile execution; pending jobs fold by segment-wise
subtree subsumption, and a bounded task history is mirrored under live-state
`tasks`, exposed by `GetTask`, and pushed through `TaskChanged` on every state
transition. Settings/live-state data uses an `RwLock`; a separate apply mutex
preserves serialization for reconciliation, transient shadow writes and
WireGuard key rotation without blocking reads. Transient-password work queues
only `access.ssh`, and WireGuard rotation applies only `network`; neither
re-applies the whole tree.

`Reboot` and `PowerOff` forward to `Reboot` / `PowerOff` on
`org.freedesktop.systemd1.Manager`. They are **not reconcilers** and do not live
under `reconciler/`: a power action has no settings subtree, nothing to converge
and nothing to re-apply on boot. `mosd-settings` is untouched by them and
a power action does not touch the settings document at all, so it leaves
`SCHEMA_VERSION` wherever it found it. A request is recorded in the
**live-state** tree under `power` as `{ last_action, requested_by }` — state,
not settings, and not persisted.

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

**Update orchestration.** The three update members speak to RAUC
(`de.pengutronix.rauc.Installer`) through a `RaucClient` trait
(`pkgs/mosd/mosd/src/rauc.rs`) with the same shape as the power control: lazy
per-call bus connection in production, a dry-run client that never touches the
host (constructed under `MOSD_DRY_RUN=1`, so no test can install a bundle on
the build host), and a recording mock for the bus-layer unit tests. Like the
power actions, updates are **actions, not settings** — nothing lands in the
settings tree, nothing is reconciled on boot, and everything observable is
recorded in the **live-state** tree under `update`: `operation`, `last_error`,
`progress`, a curated per-slot `slots` map, `booted_slot`, `primary`, a
`pending_not_confirmed` flag, plus `install` (`running`/`done`/`failed`, the
bundle path, the requesting bus name, and on failure the error text together
with a `time` object carrying the device's own clock, its
`GET /api/v1/time/status` state and whether that clock could be the cause) and
`last_mark`. The entry is available through management `GetState`; it is not
projected into an item tree or MQTT.

- `InstallUpdate(bundle_path)` validates the path (absolute, existing regular
  file), refuses a second install while one runs, records
  `update.install = running`, and hands the install to a **background task** —
  the service lock and the bus dispatcher are never held across an install,
  which RAUC completes in minutes, not milliseconds. Completion (RAUC's
  `Completed` signal, subscribed before `InstallBundle` is called so a fast
  failure cannot be missed) is recorded together with a fresh status query.
  A **failure** additionally records the clock, because RAUC verifies a
  signer's validity against the clock of the process doing the verifying and
  `certificate has expired` is the same sentence whether the signer really
  expired or this device's RTC read garbage. The facts are gathered while the
  failure is fresh — a clock read later by a separate query is a different
  clock — and `clock_implicated` is false when the kernel vouches for the
  clock, so the diagnostic does not train readers to discount it
  (`docs/design/release-signing.md` §2.2, `docs/design/time.md` §3).
- `GetUpdateState()` runs the status queries **without the service lock**,
  merges the result into `update` field-by-field (so `install`/`last_mark`
  survive a refresh), and answers the recorded entry as JSON.
- `MarkUpdate(state, slot)` is the operator's **manual** escape hatch,
  validated down to `good`/`bad` on `booted`/`other` before RAUC is asked —
  `active` and concrete slot names are deliberately not offered.

**What mosd deliberately does NOT do: confirm the booted slot.** The boot
health gate (`rootfs/overlay/usr/lib/mos/mos-health`) owns the automatic
`rauc status mark-good` — it probes systemd, mosd and apid first, and an
automatic mark in mosd would duplicate that gate and could confirm a slot the
gate would have failed. `MarkUpdate` exists for the case the gate cannot
decide (e.g. a failed unit the operator has judged acceptable).

**The update lifecycle on top (RFCT-283).** `CheckUpdate` / `FetchUpdate`
drive the device-side client `rauc-update` as bounded subprocesses and record
an explicit state machine under live-state `update.lifecycle` (idle,
checking, downloading, ready, installing, reboot-required, validating,
succeeded, rolled-back, update-unavailable, failed, each with a reason;
`update-unavailable` is the `/mos/updates` workspace's readiness verdict,
probed before every check and fetch, and `InstallUpdate` admits only a
verified bundle inside `/mos/updates/verified`). Policy — maintenance
windows, metered/offline mode, auto-check cadence — lives in a fail-closed
`update-policy.toml` on STATE, and `Reboot` is now interlocked by an
application-aware safe-to-reboot gate with a bounded, audited
`SetRebootOverride`. The whole design, the derivation rules and their honest
limits, the operator procedures and the fault-evidence table are
`docs/design/updates.md`; this section stays the record of the underlying
install/mark surface.

**Resolved follow-up (recorded at M5, closed deliberately):** rebooting a slot
RAUC has installed but that has not completed a confirmed boot **burns a boot
attempt**, and nothing warned about it. `Reboot` now reads
the slot status first and, when the bootloader's first pick is not the booted
slot, logs the warning and records it as `power.update_warning` beside
`last_action` — before the power call, like the rest of the power record. A
warning, not a refusal: booting the new slot is what an updating operator
wants. The slot query is bounded (2 s) and non-fatal, so a reboot still goes
through when RAUC is absent (v1 image, container) or wedged. Honest limit: the
*other* unconfirmed window — already booted into the new slot, health gate not
yet run — is not visible in RAUC's `boot-status` (the U-Boot backend reads the
attempt counter only as exhausted-or-not), so it is not warned about; closing
it needs the gate to report its confirmation into mosd, which is an image-pipeline
change and is deferred. The apid power pane does not yet display
`power.update_warning`; that is apid's half and is deferred with it.

### 5.5 Verification status

Everything above is verified locally: `bash pkgs/mosd/hack/check.sh` is green
(203 tests, measured 2026-08-19; the update-orchestration additions were measured
crate-scoped on 2026-08-23 — `cargo nextest run -p mosd` green, including a
private-bus test that drives the production RAUC call path against a fake
`de.pengutronix.rauc` — because a concurrent workstream held the rest of the
workspace), and both image verifiers assert that the paths,
prefixes and unit names mosd renders are the ones the image actually ships —
reading them **out of the mosd source that owns them** rather than restating
them, because a constant restated in two places drifts and the drift is invisible
from the code side, where every test passes against a mock.

**No behaviour in this document has been observed on hardware.** See the milestone record
for the separation between what is proven locally and what remains the user's
acceptance.
