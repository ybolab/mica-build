# Design: diagnostics — system information, observed network state and the support snapshot

> What a device can tell an operator about itself without SSH: one read for
> "what is this device", the network state as the stack actually sees it,
> the board's temperature/watchdog/reset evidence, and a bounded, redacted,
> offline support snapshot that can be exported through the API. Companion
> to api.md, mosd.md, storage.md and time.md. Implements the Rust/API core of
> PLAN-052 / RFCT-288; the built-in UI pages and the operational procedures
> are a follow-on (section 10).

## 1. What ships, and what deliberately does not

Four read-only observations on `com.mos.mosd1`, each behind a trait with an
unavailable default so a dry-run daemon or a test never inspects its host,
and each surfaced authenticated over HTTPS by apid:

| Observation | mosd module | Bus member | Route |
|---|---|---|---|
| System information | `system_info.rs` | `GetSystemInfo` | `GET /api/v1/system/info` |
| Board telemetry | `telemetry.rs` | `GetTelemetry` | `GET /api/v1/system/telemetry` |
| Observed network state | `network_state.rs` | `GetObservedNetwork` | `GET /api/v1/network/status` |
| Failure evidence | `diagnostics.rs` | `GetFailureEvidence` | snapshot only |

And one snapshot, assembled by apid (`apid/src/diagnostics.rs`) from those
four plus the storage and time status surfaces that already exist, redacted
against an allowlist schema, and kept in a bounded store under
`/mos/diagnostics`:

| Route | Verb | Answer |
|---|---|---|
| `/api/v1/diagnostics/snapshots` | `GET` | the stored snapshots and the retention bounds |
| `/api/v1/diagnostics/snapshots` | `POST` | collect, redact and publish one (201) |
| `/api/v1/diagnostics/snapshots/{id}` | `GET` | export one as an attachment |
| `/api/v1/diagnostics/snapshots/{id}` | `DELETE` | remove one (204) |

**What does not ship, by decision.** No fleet upload: nothing here sends a
snapshot anywhere; export is a download by an authenticated client. No
remote shell and no packet capture: the API carries no route for either, and
`the_openapi_document_covers_the_diagnostics_routes` in apid's tests holds
the diagnostics surface to that. No cellular modem support: the observed
network state reports `cellular.supported: false` explicitly, with any
`wwan` interface the kernel shows listed beside it, because a SKU that needs
a modem is a separate selection under PLAN-052's scope.

Two rules govern every member below, the ones storage.md states for its own
surface, because a diagnostic that guesses is worse than one that says
nothing:

1. **Absence is data.** A file that is not there, a daemon that does not
   answer, a board with no sensor — each is reported as an object carrying
   `available: false` and a `detail` naming the reason, never as an empty
   string, a zero, or a missing key that reads like health.
2. **Nothing is restated.** Every fact is read from the seam that already
   carries it (the shipped manifest, `/etc/machine-id`, the kernel's own
   files, RAUC, networkd, wpa_supplicant, resolved, sysfs, the journal),
   and no second copy is written anywhere.

## 2. The system-information surface

`GET /api/v1/system/info` answers device identity in one read. Every member
is an object with `available`; the present shape is:

| Member | Present members | Source |
|---|---|---|
| `machineId` | `id` | `/etc/machine-id`, validated as 32 lowercase hex |
| `board` | `model`, `source` (`devicetree` or `dmi`) | `/sys/firmware/devicetree/base/model`, else DMI product name and board vendor |
| `kernel` | `release`, `version` | `/proc/sys/kernel/osrelease`, `/proc/sys/kernel/version` (what `uname -r` / `uname -v` print) |
| `release` | `name`, `id`, `version`, `versionId`, `prettyName`, `buildId`, `imageId`, `imageVersion` (each only when the file carries it) | `/etc/os-release` |
| `system` | `version`, `package`, `gitStamp`, `commitDate`, `fileEpoch` | the manifest row of `mos-system`, else of `mosd`; `/usr/share/mos/release-identity.env`; the manifest file's mtime |
| `daemon` | `name`, `version`, `commit` (null when the build supplied none) | what `mosd --version` prints, from the same embedded values |
| `packages` | `count`, `mosCount`, `malformedRows`, `truncated`, `entries[]` of `name`, `version`, `architecture`, `mos` | `/usr/share/mos/manifest.tsv` |
| `slot` | `booted`, `bootname`, `bundleVersion`, `bootStatus`, `primary` | RAUC's slot status, through the client mosd already holds |
| `trust` | `grade` (`development`/`production`), and on a development image `developmentDomains` and `marker` | `/usr/share/mos/meta/`: the baked update configuration, and the `GENERATED` marker beside it |
| `uptime` | `seconds` | `/proc/uptime` |

`trust` is what the image says about the signing material it was built from,
and it is not guessed from any certificate: `rootfs/build.sh` bakes
`/usr/share/mos/meta/GENERATED` if and only if the tree's `meta/GENERATED` is
there, and `verify`'s `packed-meta-is-the-public-set` refuses an image in which
those two disagree in either direction. A development image names the domains
its marker covers, so a mixed one — a production RAUC ceremony's output beside
a development package signing key — reports which half.

**Absent is not `production`.** The member reads
`/usr/share/mos/meta/updates/manifest.json` first, because that document is a
required member of the baked set: an image that does not carry it provisions no
trust anchor and has no marker for a different reason than a production image
has none. Such a root reports `available: false` with the reason rather than
claiming a production CA it cannot see.

`system.gitStamp` is the `+git<commit>[.dirty]-<rev>` stamp the mos rows of
the manifest share: `commit`, `dirty`, `revision`, and `consistent` with the
full `stamps` list beside it. A manifest whose mos rows disagree — a
half-rebuilt pool — reports `consistent: false` and every stamp it found,
rather than picking one; `verify`'s `packed-mos-manifest` check refuses such
an image, and this surface is the same fact read on the device.

The surface reports two times and they are different facts, named apart so
that neither can be read as the other.

`system.commitDate` is when the commit the image's git stamp names was
committed — an `available`/`detail` object carrying `date`.
`rootfs/compose/compose-install.sh` writes it into
`/usr/share/mos/release-identity.env` as `COMMIT_DATE` at compose time, from
`git show -s --format=%cI` over the commit *inside the stamp*
`rootfs/build.sh` has already required the pool to carry — not over `HEAD`,
which is a second question with a second answer. So the date and the packages
beside it name one commit, and every reproducible build of that commit reports
the same instant. A `.dirty` stamp means the packaged tree was not exactly
that commit; the field's `detail` says so rather than leaving a bare date to
imply otherwise. A root whose identity states no `COMMIT_DATE` reports
`available: false` with the reason — never a blank, and never the epoch below.

`system.fileEpoch` is the manifest file's mtime: the `SOURCE_DATE_EPOCH` that
`rootfs/scripts/pack-squashfs.sh` pins every file time in the root to. It is
**not** a build date and is deliberately not named as one.
`build/src/geometry.ts` fixes that epoch to a constant so two builds of one
tree are byte-identical, which makes it the same instant — 2020-01-01 — in
every image this repository has ever produced. It is reported because it is
what the filesystem actually says, and it answers "what time do this image's
files carry", not "when was this image made". Reading it keeps the surface a
reader of the existing seam rather than a second writer; naming it `buildDate`
made it answer a question it cannot answer.

`packages` carries at most 4096 rows and says `truncated: true` past that; a
row that is not three tab-separated fields is counted in `malformedRows`
and skipped. A mos row is one whose package name starts with `mos`, the
rule `verify` applies.

The RAUC query behind `slot` is bounded (2 s) and non-fatal: an installer
that is absent, slow or wedged makes `slot` absent with the reason, never the
whole answer. Under `MOSD_DRY_RUN=1` the observer is never attached and the
bus member answers `Failed`, so no test can read the build host's identity.

## 3. The observed network state

`GET /api/v1/network/status` is the OBSERVED state: what networkd,
wpa_supplicant and resolved report right now. It is a distinct type on a
distinct route from `GET /api/v1/network`, which carries the desired map
under `configured` beside a reduced observation, and nothing from the
settings tree appears in it under any name — a configured interface with no
carrier reads as exactly that.

| Member | Content |
|---|---|
| `interfaces` | `count` and `entries[]`: per interface `name`, `index`, `kind`, `type`, `driver`, `mtu`; `link` (`administrativeState`, `operationalState`, `carrierState`, `carrier`, `onlineState`, `addressState`); `hardwareAddress`; `addresses[]` (`family`, `address`, `prefixLength`, `scope` + `scopeId`, `configSource`); `dhcp`; `dns[]`; `wifi` on wireless interfaces |
| `interfaces[].dhcp` | networkd's DHCPv4 client `state` and its `lease` (`address`, `prefixLength`, `server`, `router`, `lifetimeSeconds`); when networkd reports no client object but an address whose `configSource` is `DHCPv4`, the lease is inferred from it and says `inferred: true`; otherwise absent with the reason |
| `defaultRoutes` | `count` and `entries[]` of `family`, `gateway`, `interface`, `interfaceIndex`, `metric`, `protocol` + `protocolId`, `table` + `tableId`, `configSource`; a count of zero is evidence ("no default route"), not absence |
| `dns` | `linkServers[]` (what networkd holds per link), `resolverServers[]` (what resolved holds), and `probe`: `name`, `reachable`, `result` (`resolved`, `failed`, `timeout`), `detail` |
| `wifi` | `associations[]`: per wireless interface `state`, `associated`, `ssid`, `bssid`, `frequencyMhz`, `keyManagement`, `rssiDbm`, `linkSpeedMbps`; or absent with the reason (no wireless interface; wpa_supplicant's control directory absent; a socket nobody answered) |
| `capabilities` | `wifi` (`supported`, `interfaces[]`), `bluetooth` (`supported`, `adapters[]`, adapter presence only), `cellular` (`supported: false`, `interfaces[]`) |

Every rtnetlink enum on this surface is reported as a **name plus the id it
was resolved from** (`protocol`/`protocolId`, `table`/`tableId`,
`scope`/`scopeId`), and an id nothing names reads `unknown` rather than the
number again. networkd's own `ProtocolString` cannot be used for the name: its
JSON writer resolves the id against a three-entry table and then formats the
decimal id, so an ordinary DHCP route describes itself as `"16"`. Neither
mapping is total — protocol ids are assigned to routing daemons at runtime and
route tables are named by configuration — so the pair is what lets a reader
tell "this id has no name" from "this field is broken" (RFCT-298).

Addresses are read from networkd's `Describe` and formatted by family;
`hardwareAddress` is the interface's own. Wi-Fi association is read over
wpa_supplicant's control socket (`STATUS` and `SIGNAL_POLL` under
`/run/wpa_supplicant`, one bounded exchange each, at most four interfaces),
with `/proc/net/wireless` as the fallback for signal level. Nothing here
reads a credential: the `psk=` line never appears in a `STATUS` reply, and
the interface's own MAC in it is not carried (networkd's is).

**DNS reachability is the one thing in this document that touches the
network.** The probe is a single `ResolveHostname` through resolved for
`0.debian.pool.ntp.org` — timesyncd's fallback pool, a name the image already
depends on, so the probe adds no new outbound dependency — bounded at 3 s.
`reachable: false` with `result: failed` names resolved's error;
`result: timeout` means no answer within the bound. Under a fixture root the
observer runs no probe at all.

**A route-shape cost, stated.** `/v1/network/status` is a static segment
declared beside `/v1/network/{iface}`, and the router matches the static
route first: an interface literally named `status` is not addressable through
the per-interface route. No real interface carries that name, and spelling
the three status surfaces alike (`/time/status`, `/storage/status`,
`/network/status`) was judged worth it.

## 4. Board telemetry

`GET /api/v1/system/telemetry` answers three members, each with `available`:

| Member | Content | Source |
|---|---|---|
| `thermal` | `zones[]` and `hwmon[]` of `sensor`, `label`, `milliCelsius` | `/sys/class/thermal/thermal_zone*/{type,temp}`, `/sys/class/hwmon/hwmon*/{name,temp*_input,temp*_label}` |
| `watchdog` | `devices[]` of `device`, `identity`, `state`, `timeoutSeconds`, `timeLeftSeconds`, `bootstatus` (`raw`, `flags[]`), `nowayout` | `/sys/class/watchdog/watchdog*/` |
| `reset` | `reason`, `detail`, `evidence` (`watchdogBootstatus[]`, `pstore`) | the watchdog's `WDIOF_*` boot-status bits; records under `/sys/fs/pstore` |

`reset.reason` is classified from generic kernel evidence only: `watchdog`
when a watchdog reports `WDIOF_CARDRESET`; `kernel-crash` when a `dmesg-*`
pstore record exists (a `console-*` record alone is the previous boot's
console and every ramoops reboot leaves one); otherwise `unknown`. `unknown`
with `available: true` means the sources exist and flagged nothing — a normal
reboot, a power cycle and an external reset are indistinguishable there —
while `unknown` with `available: false` means the board exports no source at
all. Nothing reads a vendor reset register, because a register this code
cannot be tested against is a claim nobody has verified.

Every list is capped at 32 entries. A negative `bootstatus` (a driver error)
is not a bitmask and is reported absent.

**Open validation item.** What these adapters report on the cx3576 and x64
boards has not been validated on hardware by this subtask; the fixture tests
prove the parsing and the absence rules, not the boards. The record of that
validation belongs to section 10.

## 5. The snapshot schema, version 3

A snapshot is one JSON document. `schemaVersion` names its shape and is
bumped when a member changes; a reader that does not know the version it sees
should treat the members it does know as advisory.

| Member | Content |
|---|---|
| `schemaVersion` | `3` |
| `collectedAt` | RFC 3339 UTC as this appliance's clock had it; `time` says whether that clock is disciplined, `boot.uptime` is the monotonic reference |
| `release` | `board`, `release`, `kernel`, as section 2 defines them |
| `system` | the whole section 2 surface |
| `boot` | `slot`, `uptime` (section 2), `reset` (section 4), `update` (mosd's recorded live-state `update` entry: operation, progress, per-slot status, `booted_slot`, `primary`, `pending_not_confirmed`, the last install and mark). Version 3 added `update.install.time` — the clock, the time-status document and a `clock_implicated` reading — so a failed install's `certificate has expired` and the clock that may have caused it are read from one document |
| `journal` | the bounded excerpt: `scope` (`current boot`), `priority` (`warning`), `lineCount`, `sourceLines`, `sourceBytes`, `truncated`, `bounds`, `lines[]` |
| `failures` | `units` (systemd's failed units: `count`, `truncated`, `entries[]` of `name`, `description`, `loadState`, `activeState`, `subState`), `tasks[]` (apply tasks whose outcome was not success), `health` (the live-state health map) |
| `storage` | the `GET /api/v1/storage/status` document, verbatim (storage.md section 2) |
| `time` | the `GET /api/v1/time/status` document, verbatim (time.md section 5) |
| `telemetry` | `thermal`, `watchdog` (section 4) |
| `network` | the section 3 surface, with section 6's redactions applied |
| `collection` | `deadlineSeconds`, `sectionTimeoutSeconds`, `elapsedMillis`, `sections` (per source: `ok`, `unavailable`, `timeout`), `redaction` (`schemaVersion`, `droppedFields`, `redactedFields`) |

A section whose source did not answer is present as an absent object with the
reason, and `collection.sections` says which way it failed; a member picked
out of an absent section (say `boot.slot` when `system` timed out) is absent
and says `not collected: <the section's reason>`.

The journal excerpt is this boot's, at warning and worse, newest first when
the caps cut. journald runs `Storage=volatile` on the image, so there is no
previous boot to ask for; the hostname column is left out of every line.

## 6. The redaction schema, version 5

Redaction is a tested security boundary, and it fails closed. It is the
management-API redaction `docs/design/security-model.md` §6 counts among the
confidentiality that does exist.

This version is its own counter, not section 5's: it is bumped when the
allowlist changes, and each snapshot records the one that produced it in
`collection.redaction.schemaVersion`. The two numbers are expected to differ.

Three passes, in order, in `apid/src/diagnostics.rs`:

1. **The live denylist.** The field-name denylist every read route already
   applies (`psk`, `passwordHash`, `password_hash`, `hash`, `privateKey`)
   replaces those values with `<redacted>` at any depth, so a schema mistake
   below still ships the sentinel and not the value.
2. **The allowlist.** The assembled document is walked against a schema that
   names every member of section 5 down to the leaf. A field the schema does
   not name is dropped; a value of the wrong shape (an object where a scalar
   is named) is dropped; a dynamic key (a unit name, a health component, a
   slot name) is kept only if it is printable, at most 128 characters, and
   not a secret field name. Fields named `token(s)`, `secret(s)`,
   `password`, `passwd`, `passphrase`, `credential(s)`, `authorization`,
   `cookie`, `apiTokens`, `key(s)` are replaced by the sentinel wherever
   they appear. Fields the schema marks identifying — `hardwareAddress`,
   `ssid`, `bssid` — are kept AS the sentinel, so a reader can tell
   "redacted" from "the device had none".
3. **The string scrub.** Every string that survives is scrubbed: a string
   carrying a secret marker (`password`, `passwd`, `passphrase`, `psk`,
   `secret`, `token`, `private key`, `authorization:`, `bearer `,
   `-----begin`, `api key`, in any case) becomes `<redacted line>` whole; a
   hardware-address-shaped token (`aa:bb:cc:dd:ee:ff`) inside a string
   becomes `<mac>`; and the string is cut at 1024 bytes on a character
   boundary. Journal lines are strings and take all three.

What is kept, by decision: IP addresses, prefix lengths, gateways, routes,
DNS server addresses and the machine id. They are the troubleshooting
evidence the snapshot exists to carry, the machine id is how support tells
devices apart, and the operator exporting a snapshot is choosing to hand
them over. What is excluded: credentials, tokens, private keys, Wi-Fi
secrets, registry authentication, user content (nothing under `/srv` or
`/home` is read at all), and the personally identifying network fields —
MAC and BSS addresses, SSIDs, the hostname in journal lines.

The tests are the boundary's evidence, both directions:
`every_planted_secret_is_absent_from_the_produced_snapshot` plants a secret
under every name and at every depth a secret could land — including an
unclassified field, a secret-named dynamic key and a journal line — and
asserts none of them is in the produced bytes;
`every_benign_member_survives_the_pass` asserts the documented benign
evidence is all still there, so the allowlist cannot pass by dropping
everything; and the route test exports a snapshot through the API and
checks the bytes a client receives.

## 7. Collection bounds, atomicity and retention

Bounded means enforced, and each bound has a test that drives it:

| Bound | Value | Enforced by |
|---|---|---|
| Whole collection deadline | 20 s | apid's collector; a source whose turn comes after the deadline is not asked and is recorded `timeout` |
| One source's timeout | 6 s (never past the remaining deadline) | apid's collector, per section |
| One collection at a time | — | a second `POST` while one runs is 409 `diagnostics_busy`, not queued |
| Journal excerpt | 400 lines, 128 KiB, 1 KiB per line, warning and worse, this boot | mosd's `diagnostics.rs`, newest lines kept; `journalctl` killed at 5 s |
| Failed units | 64 listed, the count always reported; 3 s | mosd's `diagnostics.rs` |
| Failed tasks | 32 | apid's collector |
| Manifest rows | 4096 | mosd's `system_info.rs` |
| Telemetry lists | 32 each | mosd's `telemetry.rs` |
| Wireless interfaces asked | 4, two bounded exchanges each (`STATUS`, `SIGNAL_POLL`; 1 s apiece) | mosd's `network_state.rs` |
| One snapshot | 2 MiB; larger is refused whole, nothing written | the store |
| The store | 8 snapshots, 16 MiB total | the store, by removing the oldest first |

**Atomic.** A snapshot is encoded, checked against the size cap, written
once to `<root>/.staging-<id>.json`, fsynced, renamed to `<root>/<id>.json`,
and the directory fsynced. Until the rename the listing shows nothing new; a
failure anywhere leaves at most a staging file, which the next publish
sweeps and which the listing never shows. Nothing else on disk is rewritten
per snapshot — there is no index file — so one collection costs one file
write, which is the flash-wear posture storage.md asks for.

**Retention.** The store lives at `/mos/diagnostics`, in the system-owned
DATA namespace (storage.md section 1), so a snapshot survives a reboot and a
rootfs update; `/var` is disposable and would lose it. Ids are a sequence
(`1`, `2`, ...) and the newest id is one past the highest present. Before a
publish, the oldest snapshots are removed until the count and the total are
under the caps with the newcomer counted. `DELETE` is the explicit
operation. `mos-data-layout` creates the store directory at boot with mode
`0700`. The shipped `apid.service` grants it a specific `ReadWritePaths`
exception under `ProtectSystem=strict`; unrelated DATA paths remain read-only.
The publisher also creates the directory if absent when run outside that unit.

**Offline.** Collection reads the local bus and the local filesystem only.
The DNS probe inside the network section is the single network touch, and
its failure is a `failed`/`timeout` result, not a failed collection.

## 8. API routes

The HTTP contract is `pkgs/mosd/apid/openapi.json`, which CI holds equal to
what the shipped binary prints; the table below is the summary.

| Route | Auth | Answers |
|---|---|---|
| `GET /api/v1/system/info` | bearer or session | 200 the section 2 surface; 401; 500/503/504 as every mosd read; 405 |
| `GET /api/v1/system/telemetry` | bearer or session | 200 the section 4 surface; same failures |
| `GET /api/v1/network/status` | bearer or session | 200 the section 3 surface; same failures |
| `GET /api/v1/diagnostics/snapshots` | bearer or session | 200 `{snapshots[], retention}`; 500 `diagnostics_io` |
| `POST /api/v1/diagnostics/snapshots` | bearer, or session with CSRF | 201 `{snapshot, elapsedMillis, sections, droppedFields, redactedFields}`; 409 `diagnostics_busy`; 500 `diagnostics_io` (unwritable store or over the size cap; nothing written) |
| `GET /api/v1/diagnostics/snapshots/{id}` | bearer or session | 200 the document, `Content-Disposition: attachment; filename="mos-diagnostics-<machine id prefix>-<id>.json"`, `Cache-Control: no-store`; 404 `snapshot_not_found` |
| `DELETE /api/v1/diagnostics/snapshots/{id}` | bearer, or session with CSRF | 204; 404 `snapshot_not_found` |

Every route is read-only over the device except the two that write the
store, and both write only under `/mos/diagnostics`. The three status reads
pass mosd's answer through the live denylist like every other read; the
snapshot export serves stored bytes that were redacted at collection.

## 9. Bus surface

`com.mos.mosd1` gains four read-only members beside the table in mosd.md:
`GetSystemInfo`, `GetTelemetry`, `GetObservedNetwork`, `GetFailureEvidence`.
Each answers a JSON string, each is observed at call time, each is `Failed`
under dry-run because its observer is attached only by `main.rs` on a real
device, and none has a write counterpart. The failure-evidence read is the
one place mosd runs a program to answer a read (`journalctl`, fixed
arguments, killed on timeout); the reason is structural — journald's files
have no pure-Rust reader in the workspace — and it is bounded as section 7
says.

## 10. Operational procedures and troubleshooting trees

### 10.1 Collection procedure

1. Sign in to the built-in console as an authenticated appliance operator.
   Open **System information** and record the machine id, board, image version,
   source commit date and active slot. This is one `GET /api/v1/system/info` read; do
   not assemble an identity from settings or labels on the enclosure.
2. Leave the failing condition in place when it is safe to do so. Open
   **Diagnostics**, select **Generate snapshot**, and wait for the collection
   to finish. Collection takes at most 20 seconds. A 409 response means another
   collection is active: wait for that collection, refresh the listing and do
   not start concurrent retries.
3. Treat a produced snapshot as useful even when one source was unavailable.
   Read `collection.sections` first and record every `unavailable` or `timeout`
   entry; absence is evidence, not a successful check.
4. Download the snapshot from the console. The equivalent authenticated API
   sequence is `POST /api/v1/diagnostics/snapshots`, followed by
   `GET /api/v1/diagnostics/snapshots/{id}`. Record the id and the operator's
   actual UTC collection time separately when `time.status` is not
   `synchronized`.
5. Store the exported file in the case location approved for the device's
   assurance level as defined by the
   [security model](security-model.md). The device never uploads it.
   Collection remains usable without upstream connectivity; only the bounded
   DNS probe can touch the network, and its failure does not fail the snapshot.

If the console is unavailable but the authenticated HTTPS API is reachable,
use the same API sequence from a locally attached service workstation. Do not
enable SSH, run an unrestricted journal export or add packet capture to work
around the console.

### 10.2 Privacy and retention

A snapshot contains the machine id, image and package versions, slot/update
state, warning-and-worse journal lines from this boot, failed services/tasks,
storage and time status, IP addressing/routes/DNS, telemetry and collection
results. IP addresses, gateways, DNS servers and the machine id are retained
because support needs them to correlate the device and diagnose connectivity.
Treat the exported file according to the handling and disclosure rules for the
device's assurance level in the [security model](security-model.md); this
design does not restate or alter those levels.

The versioned redaction boundary removes credentials, tokens, private keys,
Wi-Fi and registry secrets, user content, SSIDs, MAC addresses, BSSIDs and
hostnames in journal lines. Redaction reduces exposure; it does not make the
remaining device identity and network topology public. Before transferring a
snapshot, verify the recipient and case, transfer only the generated file, and
never append passwords, tokens, raw private keys, unrestricted logs or files
from `/srv` or `/home`.

The on-device store retains at most 8 snapshots, 16 MiB in total and 2 MiB per
snapshot. Publishing removes the oldest entries until both store limits are
met. Snapshots live under the system-owned DATA namespace, so they survive a
reboot and rootfs update. They have no time-based expiry: the operator must
delete a snapshot from the Diagnostics page or with
`DELETE /api/v1/diagnostics/snapshots/{id}` when the case is closed or the
evidence is no longer required. Deleting the exported copy follows the case
system's retention policy, not the device's count/size policy.

### 10.3 Escalation

An escalation must include:

- the downloaded snapshot and its id;
- the machine id, board, system version/source commit date and active slot from
  `system` and `boot.slot`;
- the symptom, first observed time, reproduction steps and whether the time
  was independently verified because `time.status` was not synchronized;
- every non-`ok` entry from `collection.sections`, plus actions already taken
  and any configuration change immediately before the symptom.

Do not interpret a missing section as healthy and do not replace it with
unredacted evidence. If collection itself fails, report the HTTP error, the
retention values shown by the listing and the system-information read; preserve
the failing device state for a support-directed next step.

Reset reason, temperature and watchdog data are hardware-dependent. Fixture
tests validate parsing and absence semantics, but the cx3576 and x64 physical
boards have not been validated by RFCT-288. An unavailable or implausible
`boot.reset`, `telemetry.thermal` or `telemetry.watchdog` result must therefore
be escalated with the board identity and snapshot; it must not be marked
healthy or treated as completed board validation.

### 10.4 Troubleshooting trees

Each tree starts with observed evidence. Desired settings may be inspected only
after the observed branch identifies the missing fact.

#### No network

- **Symptom:** the device has no usable network path.
  - **Evidence:** `network.interfaces.available` is false.
    - **Remediation:** preserve its `detail`, check whether networkd answered,
      and escalate if the observer remains unavailable; do not infer state from
      desired settings.
  - **Evidence:** `network.interfaces.entries[]` is empty, or the affected
    interface has `link.carrier: false`.
    - **Remediation:** verify the correct physical port, cable, switch port and
      link partner. Recollect after carrier appears.
  - **Evidence:** carrier is present but `addresses[]` is empty, or
    `dhcp.available` is false / `dhcp.state` is not `bound`.
    - **Remediation:** compare the interface with the desired Network page,
      correct the DHCP/static declaration or DHCP server, then confirm an
      observed address and lease. Configuration alone is not success.
  - **Evidence:** an address exists but `network.defaultRoutes.count` is zero.
    - **Remediation:** correct the DHCP router or static gateway and verify that
      a default route appears for the intended interface.
  - **Evidence:** a default route exists but `network.dns.probe.reachable` is
    false (`failed` or `timeout`).
    - **Remediation:** verify `network.dns.linkServers` and
      `resolverServers`, resolver reachability and upstream routing. If only
      the probe name is blocked by policy, record that policy and validate the
      application name through its approved resolver path.

#### Wrong time

- **Symptom:** displayed time, certificates or scheduled work use the wrong
  time.
  - **Evidence:** `time.status` is `offline-degraded` and the network tree has
    no route or failed DNS.
    - **Remediation:** restore routing/DNS first; the time service continues
      retrying without an operator restart.
  - **Evidence:** `time.status` is `invalid-source`.
    - **Remediation:** verify the configured NTP sources and upstream server;
      replace a source that answers with unusable samples.
  - **Evidence:** `time.status` is `polling` and
    `time.sample.correction` is `step`.
    - **Remediation:** allow the initial large correction to complete, then
      recollect and require `synchronized`. Correlate events with
      `boot.uptime`, not `collectedAt`, until then.
  - **Evidence:** `time.status` is `unknown`, or the section is unavailable.
    `unknown` means a signal the state rests on could not be read, and says
    nothing about the clock: `time.synchronized` is absent there rather than
    false.
    - **Remediation:** preserve `time.detail` and `collection.sections.time`,
      verify the service `time.detail` names is observable (timesyncd or
      timedated), and escalate persistent absence.

#### DATA full

- **Symptom:** writes or update staging fail because DATA is full.
  - **Evidence:** the `data` entry in `storage.tiers[]` has
    `space.usedPercent` at the warning/critical policy and matching `pressure`.
    - **Remediation:** remove no-longer-needed diagnostic snapshots and
      operator-owned data through their supported interfaces. Do not delete
      unknown files from `/mos`; confirm pressure clears after space is freed.
  - **Evidence:** `storage.tiers[data].updateWorkspace.available` is false.
    - **Remediation:** free enough DATA space to restore the reserved update
      workspace before retrying an update.
  - **Evidence:** the DATA tier is read-only/unmounted, or the `/mos` bind in
    `storage.namespaces.binds[]` is degraded/unavailable despite adequate free
    space.
    - **Remediation:** stop writes, preserve its check/readiness evidence and
      escalate for the documented offline repair path; capacity cleanup cannot
      repair a filesystem or bind failure.

#### Failed update or slot rollback

- **Symptom:** an update fails, the new slot is not confirmed, or the device
  boots the previous slot.
  - **Evidence:** `boot.update` records a failed last install/mark operation or
    a failed slot, and `failures.tasks[]` carries the apply failure.
    - **Remediation:** keep the booted known-good slot running, correct the
      recorded bundle/verification/storage cause, collect again, then retry
      through the supported update workflow.
  - **Evidence:** `boot.update.pending_not_confirmed` is true and
    `boot.slot.booted` is the new slot.
    - **Remediation:** do not force confirmation while health failures remain.
      Resolve `failures.units`, `failures.health`, storage and network evidence,
      then let the normal health-confirmation path mark the slot.
  - **Evidence:** `boot.slot.booted` differs from the attempted slot and the
    prior slot is primary, or reset evidence follows the attempted boot.
    - **Remediation:** treat this as rollback, retain both the update and reset
      evidence, and escalate before another attempt if the cause is not an
      explicit bundle or space error.
  - **Evidence:** `storage.tiers[data].updateWorkspace.available` is false.
    - **Remediation:** follow the DATA-full tree before retrying; repeated
      downloads cannot bypass the reservation.

#### Unexpected reboot

- **Symptom:** uptime reset without an intentional reboot.
  - **Evidence:** `boot.uptime.seconds` confirms a recent boot and
    `boot.reset.reason` is `watchdog`.
    - **Remediation:** inspect `telemetry.watchdog.devices[]`, failed units,
      health and the last bounded journal lines. Escalate with the physical
      board because watchdog evidence remains hardware-dependent.
  - **Evidence:** `boot.reset.reason` is `kernel-crash` and
    `boot.reset.evidence.pstore` names a crash record.
    - **Remediation:** preserve the snapshot and escalate the pstore/journal,
      kernel release, image build and reproduction steps; do not reboot again
      merely to reproduce unless support requests it.
  - **Evidence:** temperature readings in `telemetry.thermal` are high near the
    failure, or the thermal section is unavailable on a board expected to
    expose it.
    - **Remediation:** verify cooling, enclosure airflow and ambient limits,
      then escalate the hardware-dependent reading or absence.
  - **Evidence:** `boot.reset.reason` is `unknown`, whether available or not.
    - **Remediation:** distinguish an operator reboot, power interruption and
      external reset from case/site records. Escalate repeated unexplained
      resets with board identity; generic evidence cannot classify them.
