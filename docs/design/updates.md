# Design: updates — lifecycle state, update policy and safe-to-reboot

> Status: the state model, the policy document, the `/mos/updates` workspace
> contract with its readiness probe, and the reboot gate below are
> implemented in mosd/apid/`rauc-update` and unit-tested. The **automatic
> path** of §3.2 is implemented and **has no tests at all** — §6 says so in
> terms rather than leaving it to an absent row — and the **write route** of
> §3.4 is approved design that is not in the tree. The fault-evidence table
> in §6 states, per fault, exactly what is proven where and what still
> needs bench hardware. Companions: `release-signing.md` (trust chain and the
> `rauc-update` client), `mosd.md` §5.4 (the bus surface this builds on),
> `api.md` (HTTP conventions), `uboot-ab-handshake.md` (boot credits),
> `../plan/PLAN-061.md` and `../plan/PLAN-063.md` (the `/mos` namespace and
> the DATA layout the workspace lives on), `../user/update-rollback.md` (the
> user-facing journey).

## 1. The update lifecycle state model

Everything observable lives in the live-state tree under `update` — updates
are actions, not settings; nothing here persists across a reboot and nothing
is reconciled on boot. The existing entry (`operation`, `progress`, `slots`,
`booted_slot`, `primary`, `pending_not_confirmed`, `install`, `last_mark`)
is unchanged; this design adds `update.lifecycle`, one explicit state with a
reason string, recorded by `pkgs/mosd/mosd/src/update_lifecycle.rs`:

| State | Produced by | Meaning |
|---|---|---|
| `idle` | machine | Nothing in flight. `available` beside it names the last check's selection, when there was one. |
| `checking` | machine | `rauc-update sync` + `check` running as a bounded subprocess. |
| `downloading` | machine | `rauc-update fetch` running; resumable, byte-budgeted. |
| `ready` | machine | A verified bundle is staged; `bundle` is the path `rauc-update` printed — the only path this module ever records, and it must be a bundle inside `/mos/updates/verified` (§1.1). |
| `installing` | mirrored | mosd's existing `InstallUpdate` background task is writing the other slot. |
| `update-unavailable` | machine | The `/mos/updates` workspace refused the acquisition before it started (§1.1): `reason` is the probe's verdict, `<status> <kind>: <detail>`, with status `unavailable` (`/mos` not mounted, or not the DATA pool) or `degraded` (the pool, but read-only, exhausted, or the probe failed); `workspace` carries the same fields. Entered by the probe that runs before every check and fetch; cleared by the next probe that passes. |
| `failed` | machine | The last check/fetch failed; `reason` carries the client's stderr tail. Cleared when the next operation starts. |
| `reboot-required` | derived | The bootloader's first pick (`primary`) is not the booted slot: an installed, activated bundle awaits its first boot. |
| `validating` | derived | Booted, and the boot health gate has reported this boot as not (yet) confirmed. |
| `succeeded` | derived | Booted, and the boot health gate reported `ok`. |
| `rolled-back` | derived | A slot we are NOT running has `boot-status: bad`: its boot attempts are exhausted, which is what an automatic fallback leaves behind. |

Precedence, written once in `render_entry`: `installing` over a running
client operation over `update-unavailable` over `failed` over `ready` over
the derived boot phase over `idle`.

**Two members beside the state, and neither is a state.** `deferred` names
why the last automatic pass did not proceed (`reason`, `detail`, `since`,
`at`, `waitedSeconds`, `attempts`) — §3.2's fifteen reasons. `suppressed` is
the list of versions the automatic path refuses after a rollback, with
`suppressed_error` beside it when the store itself could not be read, because
an unreadable store must not render as an empty one. Both describe the
automatic path; the state beside them is still what the device *is*.

### 1.1 The workspace and its readiness probe

Every byte the updater writes goes to the `/mos/updates` workspace that
PLAN-061 reserves and PLAN-063's layout backs: the DATA pool is mounted at
`/mnt/data`, `/mos` is a bind mount of its `mos/` subtree (as `/srv` is of
`srv/`), and `mos-data-layout` creates the three directories before any
writer starts. There is no other place and no fallback — not STATE
(`/var/lib/mos`), not `/var`, not the rootfs, not tmpfs:

| Directory | Holds | Rule |
|---|---|---|
| `/mos/updates/downloads/` | resumable partial downloads, `<name>.part` only | the only directory a partial ever lives in; `--reserve-dir` may name a subdirectory of it and nothing else (anything outside is refused) |
| `/mos/updates/verified/` | complete bundles whose sha256 and length matched the signed metadata | the only path RAUC is ever handed; a file arrives here by one same-filesystem `rename(2)` from its `.part`, so `verified/` holds a whole verified bundle or nothing |
| `/mos/updates/staging/` | transaction-local work: the lockbox import copy, the probe file | never resumed, never installed from |

**Never installable by filename alone.** A `.part`, a file in `downloads/`
or `staging/`, a symbolic link, or a path anywhere else is refused three
times over: `rauc-update --install` checks its own output, mosd records as
`ready` only a fetch output that is a bundle directly inside `verified/`
(anything else is `failed` with the reason), and `InstallUpdate` — the
staged path and an operator's explicit `bundlePath` alike — refuses with
`InvalidArgs` (HTTP **422** `validation_failed`) whatever is not a regular
file inside `verified/`. The offline route is therefore `rauc-update
import` (which lands the bundle in `verified/`) followed by an install of
that path, never an install of a path on the removable media.

**The probe.** `rauc-update probe` is the PLAN-061 readiness check, run by
mosd before every check and fetch (`update-unavailable` is its verdict,
recorded before any acquisition starts) and again by the client itself
inside `fetch`/`import` before the first byte is written. In order:

1. `/mos` exists and is a real directory, not a symbolic link.
2. `/proc/self/mountinfo` lists a mount at `/mos`, and a mount at
   `/mnt/data`, and the two are the same device (`major:minor`): the mount
   source of `/mos` resolves to the DATA pool. An `ext4` on another device —
   the verity root, STATE — is not DATA however it is named.
3. Neither the `/mos` bind, its superblock, nor the pool mount carries `ro`.
4. Nothing foreign is mounted inside `/mos/updates` (a rename could not
   cross it), and `/mos/updates` with its three directories exist, are real
   directories, and share `/mos`'s device.
5. `statvfs` does not report the filesystem read-only.
6. A private file is created with `O_EXCL` in `staging/`, written, fsynced,
   removed, and the directory fsynced. `EROFS` is read-only, `ENOSPC`/
   `EDQUOT` exhausted, anything else a failed probe.
7. Capacity, the pool's and stated once (it is one pool; `/mos` and `/srv`
   are two names for the same free space): the bytes already held under the
   three directories must be below `maxBytes`, and `f_bavail` must cover
   what is asked — the exact bytes still needed for a `fetch`/`import`, the
   unspent budget (`maxBytes − held`) for a standalone probe, i.e. DATA must
   back the reserve it promises.

The verdict vocabulary is PLAN-061's ("a missing, read-only or full DATA
tier is a named degraded/unavailable state"), split the way the storage
status surface splits it, so the two agree about one mount:

| Status | Kinds | Meaning |
|---|---|---|
| `unavailable` | `mount-missing`, `not-data` | look at the mount: `/mos`, `/mnt/data` or a workspace directory is absent, or what is at `/mos` is not the DATA pool (another device, a symlink substitution, a foreign mount inside the workspace) |
| `degraded` | `read-only`, `exhausted`, `probe-failed` | look at the disk: it is the pool, but it cannot take the bytes — mounted read-only, budget spent or free space below what is needed, or the probe itself could not complete |

Both refuse acquisition; neither is a late write failure. PLAN-063 names no
numeric "critical free space" threshold, so the threshold is the one the
operator declares: `maxBytes`. On a passing probe `lifecycle.workspace`
reads `status: ready` with `pool`, `source`, `fs_root`, `free`, `used` and
`budget`; before any probe has run it reads `unprobed`.

The client's exit codes carry the split for scripts: 0 done, 2 nothing
compatible, **3 workspace not ready** (the `<status> <kind>: <detail>` line
on stdout for `probe`, on stderr for `fetch`/`import`), 1 anything else.
For the test suites only, `RAUC_UPDATE_ROOT` relocates the whole workspace
(mosd forwards it to the client, so the two cannot disagree about where
`verified/` is) and `RAUC_UPDATE_MOUNTINFO` substitutes a mount table; the
production default is the contract and the refusal of any other root is
tested against it.

**The honest limit on `validating`/`succeeded`.** RAUC's `boot-status`
cannot carry the confirmed/pending distinction — the U-Boot backend reads
the attempt counter only as exhausted-or-not (the same limit
`mosd.md` §5.4 records for the pre-reboot warning). The two states are
therefore derived from the live-state `health.boot` entry, which the boot
health gate (`rootfs/overlay/usr/lib/mos/mos-health`) is the designated
reporter for: `ReportHealth("boot", "ok", …)` after its `mark-good` is a
confirmed boot; any other status is a boot under judgement. **The gate does
not report that entry yet** — that image-side line is owed (§7), and until
it lands a healthy converged system reports plain `idle`, honest silence
rather than a guessed `succeeded`. The derivation itself is implemented and
unit-tested on both branches.

**Reading it.** The bus member `GetUpdateState` (HTTP: `GET
/api/v1/update`) queries RAUC and re-derives the lifecycle from the same
fresh slots before answering, so a poll is never stale; `GetState("update")`
answers the tree as last recorded. Driving it: `CheckUpdate` and
`FetchUpdate` admit one operation at a time onto a background task — no
service lock is held across a subprocess or an install — and installs stay
on the existing `InstallUpdate(path)`. Verify-before-install stays in
`rauc-update`: mosd never fills in a bundle path of its own, and apid's
install route installs either the staged verified path or an explicit
operator path, nothing else.

**The client.** `rauc-update` is executed as a subprocess at
`/usr/bin/rauc-update` (`MOSD_RAUC_UPDATE_BIN` overrides; sync/check
bounded at 10 minutes, fetch at 4 hours — a fetch killed there resumes from
its `.part`). Its absence is a reported state (`client.available: false`
with the reason, actions refused with the same sentence), never a panic:
the binary is shipped by the image side (§7), and a v1 image without it
still answers every read.

## 2. The policy document

### 2.1 Where it lives, and what it replaced

The operator document is **`/mos/config/updates.json`**: JSON, on the DATA
pool, inside the `/mos/config/` system-configuration namespace
(`mosd.md` §5.1a). It replaces `/var/lib/mos/update-policy.toml` — TOML, on
STATE — and **nothing migrates**: `[autoCheck]`, `source.rootPath` and every
other spelling of the old file are unknown keys under
`deny_unknown_fields`, so a document still carrying one is a load error
rather than a half-read policy. A device holding only the retired path
follows the baked defaults, because nothing reads that path any more.

Three things moved at once and each was a decision (PLAN-070 §5.1, §5.2):

- **The tier: STATE → DATA.** DATA is the pool the `/mos/updates` workspace
  already lives on, so one readiness probe (§1.1) gates the document and the
  bundles it describes rather than two media having to agree. The property
  STATE gave for free — *a configuration reset returns the update channel to
  its default* — is **kept, not lost**: tier 1 re-seeds `/mos/config/` too,
  which is `recovery.md` §2.1's tier-1 `DATA (/mos)` cell and its
  `[^cfg-mos]` footnote. §2.4 is what that costs a reader.
- **The home: a namespace, not a corner.** `/mos/config/` is the device's
  system configuration; `updates.json` is one occupant beside `fleet.json`
  and the seven documents the settings store writes. Its rules are
  `mosd.md` §5.1a's and are not restated here: one writer per document,
  `0700` on the directory and `0600` on every file, and the asymmetry that
  **an absent document is a default while an absent namespace is a
  refusal** — a subsystem nobody configured versus a medium that did not
  mount.
- **The format: TOML → JSON.** The namespace's rule is JSON, for the reason
  `mosd.md` §5.1a gives: these are machine-written documents and JSON is what
  a machine writes without a round-trip formatting problem, while a
  mixed-format namespace would make every reader guess by extension.

It is **not** in the settings tree, and that half of the older argument
survives the document becoming writable: a settings key means a schema
version bump plus a migration, and "not in the settings tree" never implied
"not writable" (PLAN-071 §3).

### 2.2 Two layers, one precedence rule

1. **Layer 1, baked**: `/usr/share/mos/meta/updates/manifest.json`, inside
   the read-only dm-verity root (`MOSD_META_MANIFEST_PATH` overrides). Read
   once at startup, because nothing on the device can write it. Its `update`
   object carries the product's defaults for `source`, `channel`, `policy`
   and `checkIntervalMinutes`, and its `trust` object carries the package
   signing anchors, which no operator document may name (§2.3).
2. **Layer 2, operator**: `/mos/config/updates.json`
   (`MOSD_UPDATE_POLICY_PATH` overrides, and tests point it into a tempdir).
   Read fresh on every policy decision, so an edit — or a write through §3.4
   — takes effect on the next decision with no restart and no reload verb.

Four keys are overridable — `policy`, `checkIntervalMinutes`, `source.url`
and `source.channel` — and for those, an absent key and an explicit `null`
both mean *take the baked default*. The two stay distinguishable on the read
surface (`GET /api/v1/provisioning/status`) because *I cleared my override*
and *I never set one* are different statements about a document. Everything
else in the document is layer 2's outright and takes a code default. Where
bundles are staged is not a policy key at all: the workspace is
`/mos/updates` (§1.1) and there is no setting that could point it elsewhere.

**The address is an operator setting; what the device will accept is not.**
`source.url` is overridable — one deployment's devices can be re-pointed at
another server without an image — and the trust anchors are baked, with no
key in this schema at all. That line is PLAN-070 §5.3's and it is the whole
of the split: changing an anchor is a trust decision and rides a release;
changing an address, a channel or a schedule is an operating decision and
rides one authenticated API call.

**Fail-closed, and on the action rather than on the device.** A missing
document is the baked policy. A document that exists and does not parse or
validate resolves to **no selection at all** — not the baked one, and not the
code default: a device whose configuration is unreadable does not know which
channel it is on, and every action that turns on the answer (`check`,
`fetch`, `install`, and every automatic step) is refused with a reason naming
the file until it is fixed, because "unreadable" silently becoming
"unrestricted" is how a metered device downloads a 500 MB bundle. The reboot
gate and the maintenance windows keep evaluating on their code defaults —
failing closed there would let a typo brick the reboot button.

### 2.3 The document, with every key it accepts

```json
{
  "schema": "mos/update-config/v1",

  "policy": "check",
  "checkIntervalMinutes": 1440,
  "rebootPolicy": "manual",

  "source": {
    "url": "https://mirror.example/mos",
    "channel": "stable",
    "repoDir": "/var/lib/mos/update/tuf-mirror",
    "statePath": "/var/lib/mos/update/uptane-state.json",
    "maxBytes": 500000000
  },

  "network": { "mode": "online", "meteredAllowsFetch": false },

  "maintenance": {
    "windows": [
      { "days": ["mon", "thu"], "start": "02:00", "end": "04:00" }
    ]
  },

  "rebootGate": { "blockingStatuses": ["blocking"], "overrideMaxSeconds": 3600 }
}
```

- `policy` — what the device does on its own: `off` initiates nothing and
  leaves every manual route available; `check` runs metadata checks on the
  cadence and nothing else; `auto` checks, fetches, installs inside a
  maintenance window, then reboots or does not per `rebootPolicy` (§3.2).
  Overridable; the baked value applies when it is absent or `null`.
- `checkIntervalMinutes` — `0` disables automatic checks. Overridable.
- `rebootPolicy` — `manual` stops at `reboot-required` and waits for an
  operator; `window` reboots inside the same window, honouring the
  safe-to-reboot gate and never arming its override. Layer 2 only.
- `source.url` / `source.channel` — overridable. An absent URL on both layers
  is *no online source*: `check`/`fetch` are refused and the offline import
  path (§5.3) remains.
- `maintenance.windows` — zero windows means installs are allowed at any
  time, which is right for a manual install and wrong for an automatic one.
  `days` empty or omitted is every day; `end` at or before `start` wraps past
  midnight; times are `HH:MM` UTC.
- `rebootGate.overrideMaxSeconds` is capped at 3600 whatever the file says.

`schema` is optional — a key a document does not name is a key that takes its
default — but it is checked when present, so a `fleet.json` poured into this
path is refused rather than read.

Unknown keys are load errors (`deny_unknown_fields`), so a typo fails loudly
instead of configuring nothing. `[autoCheck]` was the earlier spelling of
`checkIntervalMinutes`, from when this document was TOML on STATE, and it is
**retired, not migrated**: a document still carrying it is an unknown key and
therefore a load error, which is the intended outcome — PLAN-071 §1.1
migrates nothing, and a device that fails closed on an old document is one
nobody has to guess about.

**Six key names are refused by name, at any depth, before the schema is
applied**: `trust`, `signingKeys`, `signingKeyId`, `signingKeyIds`,
`rootPath` and `keyring` (`ANCHOR_KEYS` in
`pkgs/mosd/mosd-settings/src/configuration.rs`). `deny_unknown_fields`
already rejects every one of them today, so the by-name scan buys nothing
against a typo — what it buys is the refusal surviving somebody *widening*
the schema, which is how the anchors would come back. Its error says so in
terms: *the address this device dials is yours to set; what it will accept is
not.* `source.rootPath` is the retired half of the old `[source]` block and
stays retired for the same reason.

`policy = "auto"` with zero maintenance windows is refused. Zero windows
means *any time*, which is right for a manual install — a device with no
operator-set window must still be updatable by a human who is standing there
— and wrong for an automatic one, where it would mean *install the moment a
bundle lands*. The rule is checked twice because there are two ways in: a
document naming `auto` with no window is a load error and is refused at the
write route with the same sentence (§3.4), and a document that inherits
`auto` from the baked layer (which carries no windows at all) has its
automatic *install* refused while the check cadence and every manual route
keep working.

### 2.4 What a reset does to it

`/mos/config/` is re-seeded by tier 1 and by tier 3, so **both return
`policy`, `checkIntervalMinutes`, the channel and the source address to their
baked defaults**, along with every other document in the namespace. Tier 2
does not open the directory; tier 4 clears it with everything else. That is
`recovery.md` §2.1's table read from this side, and it needs no mechanism of
its own: the disposition was decided for the directory and this document is
an occupant of it.

Two consequences a reader meets here rather than in the design tree:

- **It is a recovery path.** An operator who re-pointed a device at a server
  that is now wrong gets back to the shipped configuration with a tier the
  device already has — no image, no physical access.
- **It is a footgun exactly where the baked default is `null`.** For a build
  whose `meta/` names no server, a tier-1 or tier-3 reset does not return the
  device to *a different* server; it returns it to **no** server, and to
  fleet **off**. `../user/recovery.md` and `../user/update-rollback.md` are
  where an operator is told so.

A reset tier is not the only route back, and the finer-grained one is per
key: setting a key to `null` in `updates.json`, or removing it, returns
**that** key to its baked default and leaves the rest of the document alone
(§2.2). Until the write route of §3.4 exists that is an edit on the device
rather than an API call, which is the practical difference between the two
routes today — a reset needs only an authenticated request.

## 3. What the policy gates, and who may write it

### 3.1 What each key gates

- **Maintenance windows** gate **installs** and only installs: the bundle is
  already local and verified, so a check or fetch outside the window costs
  nothing worth refusing. Windows are UTC — the appliance has no
  trustworthy local-time configuration, and a window that shifted with a
  timezone guess would fire in business hours. Zero windows means
  "any time": a device with no operator-set window must still be updatable.
- **`mode = "metered"`** refuses **fetch** (hundreds of MiB) unless
  `meteredAllowsFetch`, and admits **check** (metadata, KiB-sized, every
  file capped at 1 MiB by the client). Declared by the operator, not
  detected: mosd has no metering signal to read.
- **`mode = "offline"`** is import-only: `check` and `fetch` are refused
  and updates arrive by lockbox (§5.3).
- **`policy`** decides what the device initiates, on the
  `checkIntervalMinutes` cadence (default daily, `0` disables), production
  only, subject to the same policy refusals. `off` initiates nothing;
  `check` runs `check` and nothing else — never fetches, never installs;
  `auto` is §3.2.

Policy refusals cross the bus as `AccessDenied` and reach HTTP as **409**
`policy_refused` with the refusing rule in the message.

### 3.2 What `auto` does, precisely

The driver is `pkgs/mosd/mosd/src/update_auto.rs`, one task spawned by
`main` on a production device, waking on a fixed tick because a maintenance
window is `HH:MM`-precise and may be a single minute long. **Every automatic
step calls the same function the manual route calls**, so no gate here has a
second implementation for automation to pass through. Four steps:

1. **Check**, on `checkIntervalMinutes`, and unchanged from the manual
   check: the workspace probe first, then `network.mode` (`offline` refuses;
   `metered` admits, metadata is KiB-sized). The cadence counts *attempts*,
   not successes — a check the policy refuses must not retry every tick.
2. **Fetch**, when a check names a candidate. Gated by `network.mode`
   (`metered` refuses unless `meteredAllowsFetch`), the readiness probe and
   the `maxBytes` budget — and **not** by the maintenance window, for §3.1's
   reason: the bundle is not installed by arriving.
3. **Install**, only inside a maintenance window, with two additions the
   manual path does not have. `policy = "auto"` **requires** at least one
   window (§2.3). And the driver **re-checks immediately before installing**,
   which is the one place automation is deliberately stricter than a human:
   an operator installing a staged bundle is making a choice; automation must
   not install something the publisher pulled between the fetch and the
   window. The re-check has three outcomes and they are not the same. It
   names the staged bundle — install it. It names **nothing compatible** —
   the bundle was withdrawn, so it is deleted from `verified/` and forgotten.
   It names a **different** bundle — the staged one is `superseded`, not
   provably withdrawn (a check reports the selection, not the whole target
   list), so it is **kept** and the next pass fetches what was named.
4. **Reboot**, per `rebootPolicy`, through the same gate `Reboot` uses (§4).
   **Automation never arms the override.** That is structural rather than
   remembered: the driver is written against a trait that does not carry
   `SetRebootOverride`, so the arming path stays reachable only from the
   authenticated apid route. When the gate is closed the driver defers — the
   lifecycle stays `reboot-required` with the gate's reasons visible — and
   the next window re-attempts.

**An automatic install requires a clock the device believes** (`time.md`'s
floor: timesyncd reporting synchronized, or a floor that has advanced since
boot). A maintenance window is UTC wall-clock, so a device that does not
believe its clock cannot honour one. Checks and fetches are unaffected:
neither is time-keyed, and refusing them would stop a clockless device even
discovering updates.

**A version that rolled back is not selected again.** Without that, `auto` is
a reboot loop — fetch a bad bundle, install, fail to confirm, fall back,
find the same newest version, install it again. `update_suppress.rs` records
the version of a slot that rolled back on STATE, with the evidence (which
slot, when, what the boot status was); the automatic path refuses it; an
operator clears it explicitly through `POST /api/v1/update/clear-suppression`
and the clearing is audited. A **manual** install of a suppressed version is
permitted — the operator has been told and is choosing. Two edges are
deliberate: a manual `MarkUpdate bad other` also suppresses that slot's
version, and a rolled-back slot RAUC names no `bundle_version` for cannot be
suppressed at all, which is logged rather than guessed at. A suppression
store that exists and does not parse reads as an error, never as "nothing is
suppressed" — that reading is the loop the store exists to break.

**Deferral is visible, not silent.** A permanently blocking application
permanently defers the reboot, which is correct and is also
indistinguishable from a stuck update unless the device says so. The
lifecycle's `deferred` fact names why the last automatic pass did not
proceed, with `since`, `at`, `waitedSeconds` and `attempts` beside it. An
operator opening the update page after a week can see that four automatic
attempts were refused and by what. The fifteen reasons, which are the whole
set (`update_auto.rs`):

| Step | Reasons |
|---|---|
| check | `check-refused`, `no-newer-release` |
| fetch | `version-suppressed`, `suppression-unreadable`, `fetch-refused` |
| install | `clock-untrusted`, `outside-window`, `slot-status-unknown`, `reboot-pending`, `workspace-unready`, `recheck-failed`, `recheck-refused`, `superseded`, `version-suppressed`, `suppression-unreadable`, `install-refused` |
| reboot | `outside-window`, `reboot-gate-closed` |

`version-suppressed` appears twice on purpose: the fetch step declines to
download a version it already refuses to install, and the install step asks
again after its re-check, which is the first point at which the version about
to be *written* is known rather than guessed at.

Clearing is deliberate rather than blanket: a step that supersedes exactly
one fact clears exactly that reason (a check that finds a release ends
`no-newer-release` and says nothing about the window), and everything is
cleared only at the two points where a pass ran to its end — the install
started, and the reboot was issued.

A deferral is a fact about the automatic path, not a state of the machine:
the lifecycle beside it still reads `ready` or `reboot-required`, because
that is what the device *is*.

### 3.3 A channel or address change, and what it may select

`source.channel` and `source.url` are read fresh per decision, so a change
takes effect on the next check with no restart. What can then happen, and
what the device says about it:

- **The channel holds nothing newer.** Moving from `beta` to `stable` can
  point the device at a channel whose newest release is *older* than what it
  runs. `rauc-update`'s selection requires a version strictly newer, and the
  automatic path never passes `--allow-downgrade` — an unattended downgrade
  is an unattended rollback to code the device already moved past. The check
  records `no-newer-release` naming the channel, rather than leaving a bare
  `idle` with no candidate, because "up to date" and "the device looked and
  the channel does not carry it" differ in what to do next.
- **The source does not publish the selected channel at all.** The selection
  returns nothing compatible, exactly as above, and the device **records the
  same `no-newer-release`** — the client reports its selection, not the
  target list, so mosd cannot tell "this channel is empty" from "this channel
  exists and has nothing newer". PLAN-071 §4 asks for three states and three
  sentences, because the operator's next action differs each time (wait; wait
  longer; fix the selection); the tree has two. Named here rather than
  written as though it had shipped.
- **The address does not answer.** The check fails and the reason is
  recorded; the baked address is **not** tried instead. That is structural
  rather than a rule somebody enforces — precedence produces one effective
  URL and there is no second one to fall back to — and it is the same
  property as never adopting the baked channel on a parse error: a device
  must not silently talk to a server its operator did not choose.

A change does not shortcut anything. An install after a channel or address
change is an install: same window, same gate, same re-check.

### 3.4 The write route — **[not implemented]**

**Approved design, PLAN-071 §3; not in the tree.** apid declares no write
route for this document today (`pkgs/mosd/apid/openapi.json` carries
`/api/v1/update` and its six action routes and no policy write), so an
operator's only way to change the document is to edit it on the device. What
is written here is the shape the route must have, so that the console's
`AutomaticUpdates` controls — `policy`, `channel`, `checkIntervalMinutes`,
the windows, `rebootPolicy`, and clearing a suppressed version — have one
described surface behind them:

- **One route**, on apid, authenticated as an administrator — the same
  authority every other management write requires, and no new one. There is
  no unauthenticated path and no fleet-derived path to it.
- **mosd owns the file and is its only writer.** apid does not write
  `/mos/config/updates.json`; it asks. One fact, one writer, all the way down
  to the filesystem — which is `mosd.md` §5.1a's rule for the whole
  namespace, not a rule this document invents.
- **Validation happens on write, not at the next check.** A rejected
  document is refused with the offending field named, and the on-disk
  document is never replaced by one that would fail to load. §2.3's
  `auto`-requires-a-window rule moves with it: the operator who selects
  `auto` with no window is told so in the console instead of getting a device
  that fails closed some hours later for a reason they have to go looking
  for. `configuration::validate` is public for exactly this — one rule set,
  two callers, because two spellings of one rule is how they drift.
- **Atomicity follows the discipline the tree already has**: one save, a
  temp file and an atomic rename within the same directory, the shape
  `Store::save` uses for the settings documents. A reader sees the old
  document or the new one and never a partial write; the residue is a torn
  write below the filesystem, which is what §2.2's fail-closed reader is for.
- **Audited like every other management write**, carrying the same actor
  field the update events carry. *Who put this device on `beta`* is a
  question the trail must answer.

`deny_unknown_fields` means something different once there is a machine
writer: a machine never emits an unknown field, so an unknown field is
hand-editing or corruption, and refusing it is right in both cases.

### 3.5 Who did this — attribution today, and the gap

**What holds.** The driver acts under one name, `auto-update`, wherever an
operator's bus name would go, so the `requested_by` field of
`update.install` and `update.last_mark` distinguishes a machine's install
from a human's without anyone having to infer it
(`update_auto.rs`'s `SENDER`).

**What does not — [not implemented].** The audit trail is apid's, and
`update-check`, `update-fetch` and `update-install` are recorded in
`pkgs/mosd/apid/src/update_api.rs` — on the *routes*. The automatic path does
not pass through apid, so **an automatic check, fetch or install writes no
audit event at all**. The trail therefore answers *did a human do this* only
in one direction: an event means yes, and the absence of one means either no
or nobody was asked. PLAN-071 §3 requires the automatic actions to record the
same event names distinguished by an actor field; that is owed, and until it
lands `requested_by` in the live-state document is the only attribution a
support case has.

## 4. The safe-to-reboot gate

mosd's `Reboot` now asks the gate first and **refuses** when it is closed
(`AccessDenied`, the reasons in the message). This is distinct from the
unconfirmed-slot warning of `mosd.md` §5.4, which stays a warning — booting
a freshly installed slot is what an updating operator wants. Two blocks,
deliberately unequal:

- **An update install in flight** closes the gate and **no override lifts
  it**: RAUC is mid-write, the install finishes in minutes, and nothing is
  gained by inviting the interruption.
- **A blocking application** closes it until the application clears its
  report or an administrator overrides. The contract is the existing
  `ReportHealth` surface: a component that must not be interrupted reports
  `ReportHealth(component, "blocking", why)` and reports again (any other
  status) when done. `mos-health`'s `degraded` (disk pressure) deliberately
  does not block — a reboot neither worsens nor is worsened by a full
  `/var`. The status list is the policy's `blockingStatuses`.

**The override** (`SetRebootOverride(seconds)`; HTTP `POST
/api/v1/update/reboot-override`) is the judgement call "I know what this
application is doing and the reboot outranks it": bounded (1 s to the
policy ceiling, never above 3600 s), self-expiring, and audited on both
sides — apid records the event in its audit trail and mosd logs who armed
it and until when. There is deliberately no member that disarms the gate
permanently. The gate's verdict, reasons and any active override are in
`update.lifecycle.reboot_gate`, so a UI can show *why* reboot is refused
before anyone presses the button.

## 5. Operator procedures

All routes are behind the session gate; actions are POST-only and audited.
`jq`-friendly state is one `GET /api/v1/update` away throughout.

### 5.1 Normal online update

1. `POST /api/v1/update/check` (or wait for the auto-check) — poll
   `GET /api/v1/update` until `lifecycle.available` names a candidate or
   the state reads `idle` with no candidate (up to date).
2. `POST /api/v1/update/fetch` — poll until `lifecycle.state` is `ready`
   (`downloading` resumes across interruptions; a failure reads `failed`
   with the client's reason).
3. `POST /api/v1/update/install` with `{}` — installs the staged verified
   bundle; refused outside a configured maintenance window. Poll until
   `lifecycle.state` is `reboot-required`.
4. `POST /api/v1/actions/reboot` — refused while the safe-to-reboot gate
   is closed (§4). The first boot of the new slot spends a boot credit;
   the health gate confirms it or the bootloader falls back.
5. After the reboot, `GET /api/v1/update`: `pending_not_confirmed` false
   and the booted slot's `boot_status` `good` is a completed update
   (`lifecycle` reads `succeeded` once the health gate reports §1's
   `health.boot`; until that lands, confirm via `slots` + `booted_slot`).

Under `policy = "auto"` the device walks those same steps itself, through the
same functions and the same gates (§3.2). The operator's routes stay open
throughout: `auto` never removes a manual action, and the one thing it adds
that a human does not get is the re-check before the install. What to read
when nothing appears to be happening is `lifecycle.deferred` — the automatic
path records why every pass it declined was declined, which is the only place
the answer exists.

### 5.2 Rollback

**Automatic**: a slot that exhausts its boot attempts falls back by the
`uboot-ab-handshake.md` contract with no operator action; the state then
derives `rolled-back` with the failed slot named in the reason.

**Guarded manual rollback**: `POST /api/v1/update/rollback`, for the case the
automatic path never catches — a slot that boots and misbehaves. It takes no
request body: the target is not the caller's to name.

What it does is exactly ONE mark, `bad` on the **booted** slot, which is what
makes the bootloader pick the other one (`uboot-ab-handshake.md` §5.3 walks
`BOOT_ORDER` for a slot that still has credits). It never marks the target,
so it is structurally incapable of confirming a slot no boot has verified;
`RollbackEligibility::mark` in `pkgs/mosd/mosd/src/rauc.rs` is where that is
an invariant with a test over the whole input space rather than a sentence.
The vocabulary stays `validate_mark`'s — `good`/`bad` on `booted`/`other` —
and there is no second slot state machine anywhere in the path.

Whether it is permitted at all is `rollback_eligibility` in the same module, a
pure function over the slot list, the primary slot and mosd's confirmed-boot
record. Its central rule is that **a rollback goes backward**: the target must
be the strictly OLDER of the two installs — **by mosd's own confirmed-boot
record where it has observed both installs run, and by `installed.timestamp`
only where it has not.** The step is literally
`boots.older_install(target, booted).or_else(|| older_install(target, booted))`,
and in the fallback the verdict is bit-for-bit what it was before §5.2a
existed.

#### 5.2a mosd's own confirmed-boot record

`pkgs/mosd/mosd/src/confirmed_boot.rs` keeps
`/var/lib/mos/update/confirmed-boots.json` on STATE — one entry per slot,
written when mosd observes **itself running from that slot**. STATE and not
`/mos/config/`, because "mosd ran here" is what the device observes about
itself rather than what an integrator sets, and an operator document able to
rewrite the order of this device's own boots would be an order nobody
observed.

**The ordering key reads no clock.** It is a `sequence` the store mints — one
higher than any it already holds — so the order of two installs is decided by
mosd's succession of observations. A wrong clock cannot move it, a clock that
jumps backward cannot invert it, and network time arriving later cannot
rewrite it. `firstSeenAt` sits beside it as evidence for a human and is
**never compared**; nothing in the module compares two `installedTimestamp`s
either, which is why they are recorded only as part of an install's identity.

Four properties that decide what it can and cannot answer:

- **An entry is about an install, not about a slot name.** It matches only
  while the slot still carries the same bundle version and install timestamp,
  so an entry about the system a slot used to hold is never read as an
  observation of the one it holds now.
- **First sighting wins.** An install already recorded is left exactly as it
  was; re-stamping it on every poll would walk its sequence forward past
  installs that really are newer.
- **It answers `None` rather than guessing.** Either install unobserved, or
  two equal sequences (which this store never mints, so equal means something
  else wrote the file) — and the caller falls back to the install clock.
- **Nothing here is fatal and nothing here is overwritten.** A store that does
  not parse is left intact for a fixed parser to read later, and a write that
  fails is logged; the guard falls back either way. A daemon that refused to
  serve update state because it could not write a note about its own boot
  would be the worse failure.

**What it does not do: it does not confirm a slot.** The boot health gate owns
the PENDING_CONFIRM → CONFIRMED edge and `rauc status mark-good` with it;
nothing here marks anything and nothing here is read by the bootloader. The
record changes what mosd *knows* about ordering, not who acts on it. It is
also strictly weaker than that gate's verdict — mosd running is necessary for
the gate to pass, not sufficient — which is the same strength the derivation
below had.

**What the record closes, and what it leaves standing.** `recovery.md` §3 node
2's precondition — "the other slot holds a system that booted successfully
before" — was enforced by DERIVATION rather than by reading it, because the
property was not observable: RAUC v1.13 (pinned in `pkgs/rauc/versions.env`)
persists no mark history — its slot status file holds bundle metadata, an
install-progress `status`, a checksum and `installed.*`/`activated.*`,
`mark-good` writes none of it, and `boot-status` over D-Bus is the attempt
counter read as exhausted-or-not. **Where the record holds an entry for the
target, that precondition is now read rather than derived**: the entry exists
only because mosd ran there.

**The premise it does not retire.** Concluding *the target is the older
install* from *mosd saw the target's system running first* still uses RAUC's
invariant that **an install never writes the running slot** — an install is
written into a slot the device is not running from and is booted after it is
written, which is what makes first-boot order the same order as install order.
So the derivation's premise survives the record; what the record removes is
the dependency on a **clock**, and it answers the precondition directly rather
than by implication. **If that invariant ever stops holding — a future install
path able to target the booted slot, or an out-of-band flash that also
rewrites `installed.timestamp` — neither ordering source is sound**, and
nothing in this tree goes red, because the invariant is RAUC's and not ours.

How well that premise is established: RAUC's target-selection code has been
read at the pinned v1.13, so the premise is now a **conjunction with both
halves verified** — RAUC only ever selects a slot it believes is inactive, AND
nothing here tells it that the wrong slot is booted. mosd's half is direct:
`install_bundle` in `pkgs/mosd/mosd/src/rauc.rs` calls `InstallBundle` with the
bundle path and an empty options map and no target argument, so RAUC alone
selects; the D-Bus install API carries no target or boot-slot key to pass in;
and this repository recorded the behaviour independently of this guard, for a
different feature and before it existed (§1's lifecycle table: the install task
"is writing the other slot", authored in 98379d18). RAUC's half is that
selection is restricted to `ST_INACTIVE` slot-class members and the only lever
over it, `--override-boot-slot`, is neither on the install command in this
build nor anywhere in this repository. It remains a **premise**: it is
established at the pinned version, and a pin bump can move it. The underlying
RAUC v1.13 evidence — the verified source pin, the target-selection reading
with the recipe to re-run it, the `r_mark_good`/`r_mark_active` contrast that
proves the mark is bootloader-only, and why `activated.*` cannot substitute —
is recorded once in `recovery.md` §3 node 2 and not repeated here.

Two things that sentence must not be read as saying. "Nor anywhere in this
repository" is about this repository's text: the string `override-boot-slot`
**is** in the shipped `/usr/bin/rauc`, once, with its help text —
`-Dservice=true` compiles it out of the install subcommand, not out of the
binary, and it survives on the daemon's own argv. And the part that can be
asserted about the image is asserted: `rauc-units-never-override-boot-slot`
(`verify/src/checks-rauc-units.ts`) fails any assembled image in which a unit
or drop-in whose `Exec*=` command line starts rauc names the option, and fails
an image in which it finds no rauc command line at all. RAUC's half of the
premise stays a premise; this half is a gate.

Its verdict is recorded
in the state document as `rollback` — `target` (the resolved alternate slot,
or `null`), `permitted`, and `reason` — so the operator reads the decision in
the same `GET /api/v1/update` answer that carries `slots`, `booted_slot`,
`primary` and `pending_not_confirmed`. There is no second read route for slot
state. A refused rollback answers **409** with the reason as its error code;
it is not a 422, because the request is well formed and it is the device state
that says no:

| `reason` | refused because |
| --- | --- |
| `no_alternate_slot` | RAUC names no booted slot, so nothing resolves relative to it: dry-run, a container, or a kernel command line with no `rauc.slot=` |
| `alternate_is_booted_slot` | the booted slot is the only member of its slot class — "the other slot" would be the one already running |
| `alternate_never_installed` | the alternate carries no bundle version and no install timestamp; nothing was ever written there to fall back to |
| `alternate_marked_bad` | the alternate's boot-status is `bad` — the bootloader has already condemned it |
| `alternate_is_newer` | the alternate was installed MORE recently than the running system: a pending or skipped update, not a rollback target — switching to it applies the untested thing |
| `install_order_unknown` | **neither** ordering source could order the two: mosd has not observed both installs running (§5.2a), and the install timestamps are absent, unparseable or equal. Nothing establishes that the alternate is the older system. Equal stamps are the shape of a factory flash that wrote both slots at once, where the alternate has never run — and that case still refuses, because the record has no entry for a slot nothing ever booted. The guard fails CLOSED here on purpose: it refuses a rollback it cannot justify rather than permitting one |
| `booted_slot_not_confirmed` | the booted slot is itself pending-not-confirmed; that window belongs to the attempt counter, and a manual rollback inside it races the boot credit already being spent |

**The clock gap is narrowed, not closed, and the difference is which device
you have.** Where mosd has observed both installs run, the ordering reads no
clock at all and a wrong clock at install time cannot move it (§5.2a). Where
it has not — an alternate whose install this daemon never saw running — the
install timestamps decide, exactly as they did before, and a device that
installed under a wrong clock can still record an order that did not happen.
So: **a device that has taken at least one update under this code is on the
strong story; a device whose only history predates it falls back to exactly
the story it had.**

Making *mosd never saw the target run* a refusal of its own would close the
gap outright. It is deliberately not done: that is a new rule about devices
whose history predates this record, and PLAN-071 §7 does not make that
decision. What is left is named here rather than approximated.

**The reboot contract: this route does not reboot.** A rollback is a boot-order
change; the reboot that realises it is `POST /api/v1/actions/reboot` and goes
through §4's safe-to-reboot gate like every other, with §4's override the only
way past it. Folding an implicit reboot in here would either bypass that gate
or duplicate its override semantics in a second place, and neither is worth
saving one call — so the answer names the next step (`nextStep`) instead of
taking it. The action is audited as `update-rollback`, distinct from
`update-mark`.

**The raw mark** remains beside it, unguarded and deliberately so:
`POST /api/v1/update/mark` with `{"state": "good", "slot": "booted"}` is the
escape hatch when the health gate cannot decide, and
`{"state": "bad", "slot": "other"}` condemns the other slot. Activation
(`active`) and concrete slot names are refused on both surfaces — activation
is the installer's job.

### 5.3 Offline import (metered/offline sites)

The lockbox (`release-signing.md` §3.2) is the same repository shape on
removable media. On the device (bench shell or SSH):

```sh
rauc-update import --lockbox /media/usb/lockbox \
  --state /var/lib/mos/update/uptane-state.json \
  --max-bytes 500000000
# last stdout line = verified bundle path, /mos/updates/verified/<name>
# exit 3 = the workspace is not ready; the line names the status and kind
```

then `POST /api/v1/update/install` with `{"bundlePath": "<that path>"}` (or
the bus member `InstallUpdate`). The import verifies against the same baked
anchors as the online path and stages through the same workspace (§1.1);
there is no flag that skips either, and the bundle on the media itself is not
an installable path.

**There is no `--root`, and its absence is the design.** `rauc-update` and
`rauc-verify` take the trust anchors from the baked manifest's
`trust.signingKeys` (`pkgs/rauc-sign/src/anchor.rs`), which pins
`/usr/share/mos/meta/updates/manifest.json` as a constant: *there is no
environment, argument or operator-document anchor override.* An earlier
revision of this section showed
`--root /usr/share/mos/uptane/root.json`; that flag was removed with the
anchor-file path it named, and an invocation carrying it fails. The reader
starts at the earliest repository root a baked key authenticates and lets the
TUF rotation chain carry it forward, so a rotated repository needs no new
flag either.

### 5.4 The update server has moved

The device that must fetch the new image is pointed at the server being
changed, so this case has to be answered from outside it. **Three routes
back, in the order to try them:**

1. **Re-point the device.** `source.url` is an operator key (§2.2): an
   authenticated administrator writes the new address into
   `/mos/config/updates.json` and the next decision uses it — no image, no
   physical access, no reflash. This is the route that did not exist before
   PLAN-070 §5.3.
2. **Offline import.** A bundle on removable media, verified against the
   baked anchors, needing no server at all (§5.3). This is the route for a
   device whose network cannot reach any server.
3. **Reflash.** A whole-disk write replaces the baked configuration with the
   new image's, which *is* the configuration. It also replaces STATE, so it
   mints a fresh `deviceId` (`access.md` §9.2) — the reason it is third.

**A reset is a fourth route, and it points backwards.** Tiers 1 and 3
re-seed `/mos/config/`, so both return the address and the channel to the
values the image was built with (§2.4). That recovers a device an operator
re-pointed at a server that turned out to be wrong. Where the baked default
is `null` it does the opposite of a recovery: the device is returned to **no
server**, and to fleet **off**, which is a device that has silently stopped
updating.

**What is left, stated in its narrowed form.** A device **nobody can
authenticate to** — no operator credential, no physical access — whose server
has gone away is stranded, and nothing short of a channel this product
deliberately does not have fixes it. That residue is smaller than it was:
before the address became an operator key, every device whose server moved
was in it.

### 5.5 Support data

A support case wants: `GET /api/v1/update` (the whole document — lifecycle
with reasons, `deferred`, `suppressed`, policy as loaded, gate verdict,
slots, `install`, `last_mark`), the audit trail
(`update-check`/`update-fetch`/`update-install`/`update-mark`/
`update-rollback`/`update-reboot-override`/`update-clear-suppression` events
with source addresses; `update-rollback` records the refusal and its reason
as well as the applied rollback, because the guard refuses inside apid and
nothing else would witness it), and the journal (mosd logs every admission,
refusal, override and outcome; the client's stderr tail is in
`lifecycle.reason`).

**The trail covers operator actions only.** Audit events are recorded on
apid's routes, and the automatic path does not pass through them (§3.5), so
an automatic check, fetch or install is absent from the trail. For those,
`lifecycle.deferred` and `install.requested_by` (`auto-update`) are what a
support case reads. A quiet trail on a device running `auto` is the expected
shape, not evidence that nothing happened.

## 6. Fault-test evidence

What each claimed fault behaviour rests on **today**. "Unit" rows run in
CI (`pkgs/mosd/hack/check.sh`, `pkgs/rauc-sign/hack/check.sh`) on x86 with
no hardware; rows marked **bench** are owed to a real board and are not
claimed as proven. No QEMU-level `update-lifecycle-test.sh` ships in this
slice: the x64 verify harness needs a built image and a boot measured in
minutes per phase, which puts an end-to-end update loop outside the
"minutes" budget — the QEMU column is therefore folded into the bench list.

| Fault | Required behaviour | Proven today (unit) | Owed to bench hardware |
|---|---|---|---|
| Power loss during download | `.part` survives; next fetch resumes with a range request; digest still enforced | `pkgs/rauc-sign/tests/update.rs` (fresh/resumed/idempotent fetch, corrupted partial deleted) | Real power cut mid-download on a board |
| Power loss during install | Interrupted slot is never booted (not activated until install completes); old slot boots; re-install succeeds | Install failure recorded and flag released: `pkgs/mosd/mosd/src/bus.rs` tests; activation-at-completion is RAUC's contract (`uboot-ab-handshake.md`) | Real power cut mid-`rauc install`, then reboot + re-install |
| Power loss during first boot | Boot credit spent; remaining attempts retry; exhaustion falls back | Handshake contract + credit arithmetic: `docs/design/uboot-ab-handshake.md`, `build/src/boot-slots.ts` | Pulling power inside the first-boot window on a board |
| Exhausted boot credits | Bootloader falls back; state derives `rolled-back` naming the failed slot | `derive_boot_phase` tests in `pkgs/mosd/mosd/src/update_lifecycle.rs`; warning path in `pkgs/mosd/mosd/src/rauc.rs` tests | A real slot exhausting `BOOT_x_LEFT` end to end |
| Incompatible target | `check` rejects per axis (board/profile/channel/schema/version) with a reason each; exit 2 surfaces as "no compatible target", never an install | `pkgs/rauc-sign/tests/update.rs` selection suite; lifecycle's exit-2 handling in `update_lifecycle.rs` tests | RAUC's own compatible-string refusal on a mismatched board |
| Insufficient space | The probe refuses before the first byte when the DATA pool cannot hold what is still needed or the workspace budget is spent (`degraded exhausted`); the budget is never exceeded; the state reads `update-unavailable` with the reason | `pkgs/rauc-sign/tests/update.rs` probe and budget suites (`the_probe_names_every_unready_kind`, `fetch_refuses_to_exceed_the_byte_budget`); `update_lifecycle.rs` tests (`an_unready_workspace_is_a_named_state_before_any_acquisition`, `a_fetch_the_workspace_refuses_is_the_same_named_state`) | Filling DATA on a real board's storage class |
| DATA workspace absent, not DATA, or read-only | Named `update-unavailable` before acquisition (`unavailable mount-missing`/`not-data`, `degraded read-only`/`probe-failed`); no byte requested, nothing written anywhere else; cleared when the probe passes | `pkgs/rauc-sign/tests/update.rs` (`the_probe_names_every_unready_kind`, `an_unready_workspace_refuses_acquisition_before_any_byte`, `the_cli_reports_readiness_with_its_own_exit_code`); `update_lifecycle.rs` per-kind state test | Unmounting/remounting DATA read-only under a running mosd on a board |
| Interrupted download, partial never installable | The `.part` stays in `downloads/`, `verified/` is untouched, the partial and any path outside `verified/` are refused by `--install`, by the `ready` recording and by `InstallUpdate`; the resumed fetch renames the whole bundle into `verified/` | `pkgs/rauc-sign/tests/update.rs` (`an_interrupted_download_never_reaches_verified`, `only_a_verified_regular_file_is_installable`, `the_reserve_directory_is_inside_downloads_or_refused`); `update_lifecycle.rs` (`a_fetch_path_outside_verified_is_never_recorded_as_ready`, `only_a_verified_regular_file_is_installable`); `bus.rs` install validation test | Power cut mid-download, then resume, on a board |
| Automatic fallback | Device returns to the old slot without operator action; state says so afterwards | Derivation as above; handshake contract | The full loop on a board: bad bundle → install → reboot → fallback observed on serial |

Operator docs (§5 and `../user/update-rollback.md`) claim only the left
two columns; every bench row is an open verification item, not a shipped
behaviour.

**The automatic path has no rows in that table, and the reason is that it has
no unit column to put in one.** `pkgs/mosd/mosd/src/update_auto.rs` and
`pkgs/mosd/mosd/src/update_suppress.rs` carry **no tests**: the driver
compiles, clippy is quiet, and not one line of the loop, the suppression
store, the clock predicate or the deferral facts has been executed. Stated
here rather than left to be inferred from an absent row, because `auto` is
the first capability that reboots a device with nobody watching and the
failure mode is a path that skips a gate — which is exactly what a test would
catch and prose cannot.

What is owed, in the order it should be written:

| Behaviour | Required | Owed |
|---|---|---|
| The loop is closed | A bad bundle installs once: it rolls back, the version is suppressed, and the second automatic pass selects nothing | The full cycle against the trait seam — PLAN-071's own acceptance for the slice, and the one test that proves the loop cannot restart |
| The suppression store | Record, clear, idempotence, and a store that exists and does not parse refusing rather than reading as empty | The unparseable case first: it is the branch whose failure silently restores the loop |
| Automation never arms the override | The automatic path drives against a closed gate and no override is armed | The invariant is structural — `SetRebootOverride` is not on the driver's trait (§3.2) — and a test is what keeps the trait from growing one |
| The clock predicate | Both limbs, and the `clock-untrusted` deferral they produce | The floor limb has never been observed against a device with no STATE bind, which is the case it exists for |
| The deferral facts | Each of §3.2's reasons reachable; `since`/`attempts` surviving a repeat while a changed reason resets them | — |
| The clearing route | The 200, the 422 for a version that is not suppressed, and the audit event | `openapi.json` documents the route; nothing drives the handler |
| The end-to-end bench cycle | `auto` on real hardware: fetch, window, install, reboot, confirm | Blocking for shipping `auto` at all |

## 7. The deployment contract

**What the image now carries.** Three of this section's four items closed;
they are recorded rather than deleted, because each was owed to a claim §1
and §2 make and a reader checking those claims needs to find the answer.

- **`/usr/bin/rauc-update` and `/usr/bin/rauc-verify`** ship in the image, as
  the `mos-rauc-update` package. `verify/src/checks-update.ts` asserts both
  are executable regular files in the packed root, so the absence §1 reports
  as `client.available: false` is a fault rather than the normal state.
- **`/usr/share/mos/release-identity.env`** (`BOARD=`/`PROFILE=`/`VERSION=`)
  is written by `rootfs/compose/compose-install.sh`, and the same verifier
  checks its lines parse and that `VERSION` matches the pool version carried
  by `mos-system`.
- **The trust anchors** are `trust.signingKeys` in
  `/usr/share/mos/meta/updates/manifest.json`, staged by `rootfs/build.sh`'s
  allowlist from `meta/updates/manifest.json` and inside the dm-verity root.
  **There is no `/usr/share/mos/uptane/root.json`**, and the anchor-file path
  this section used to name is retired with the `--root` flag that consumed
  it (§5.3). What `release-signing.md` §2.3 still records as an open decision
  is the *provisioning channel* — how an anchor reaches a device other than
  by being baked into its image — not where a running device reads one.

**Still owed:**

- Provisioning of `/var/lib/mos/update/` (metadata mirror at `repoDir`,
  rollback state at `statePath`) on STATE. Nothing in the image creates
  either; the defaults in §2.3 name paths the client will have to make. The
  workspace itself *is* provisioned: `mos-data-layout` creates
  `/mos/updates/{downloads,verified,staging}` on DATA (PLAN-063), and the
  quota behind `maxBytes` stays PLAN-049's.
- `mos-health` reporting `health.boot` after its mark-good, which is what
  lights up `validating`/`succeeded` (§1). It reports `var` today and
  nothing else, so a healthy converged system reads plain `idle`.
- The write route of §3.4, and the automatic path's audit events (§3.5).
