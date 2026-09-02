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
| `system` | `version`, `package`, `gitStamp`, `buildEpoch`, `buildDate` | the manifest row of `mos-system`, else of `mosd`; the manifest file's mtime |
| `daemon` | `name`, `version`, `commit` (null when the build supplied none) | what `mosd --version` prints, from the same embedded values |
| `packages` | `count`, `mosCount`, `malformedRows`, `truncated`, `entries[]` of `name`, `version`, `architecture`, `mos` | `/usr/share/mos/manifest.tsv` |
| `slot` | `booted`, `bootname`, `bundleVersion`, `bootStatus`, `primary` | RAUC's slot status, through the client mosd already holds |
| `uptime` | `seconds` | `/proc/uptime` |

`system.gitStamp` is the `+git<commit>[.dirty]-<rev>` stamp the mos rows of
the manifest share: `commit`, `dirty`, `revision`, and `consistent` with the
full `stamps` list beside it. A manifest whose mos rows disagree — a
half-rebuilt pool — reports `consistent: false` and every stamp it found,
rather than picking one; `verify`'s `packed-mos-manifest` check refuses such
an image, and this surface is the same fact read on the device.

`system.buildDate` is the manifest file's mtime. That is not a stamp of its
own: the pack step pins every file time in the root to `SOURCE_DATE_EPOCH`,
so the mtime IS the build's reproducible date, and reading it keeps the
surface a reader of the existing seam rather than a second writer.

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
| `interfaces` | `count` and `entries[]`: per interface `name`, `index`, `kind`, `type`, `driver`, `mtu`; `link` (`administrativeState`, `operationalState`, `carrierState`, `carrier`, `onlineState`, `addressState`); `hardwareAddress`; `addresses[]` (`family`, `address`, `prefixLength`, `scope`, `configSource`); `dhcp`; `dns[]`; `wifi` on wireless interfaces |
| `interfaces[].dhcp` | networkd's DHCPv4 client `state` and its `lease` (`address`, `prefixLength`, `server`, `router`, `lifetimeSeconds`); when networkd reports no client object but an address whose `configSource` is `DHCPv4`, the lease is inferred from it and says `inferred: true`; otherwise absent with the reason |
| `defaultRoutes` | `count` and `entries[]` of `family`, `gateway`, `interface`, `interfaceIndex`, `metric`, `protocol`, `table`, `configSource`; a count of zero is evidence ("no default route"), not absence |
| `dns` | `linkServers[]` (what networkd holds per link), `resolverServers[]` (what resolved holds), and `probe`: `name`, `reachable`, `result` (`resolved`, `failed`, `timeout`), `detail` |
| `wifi` | `associations[]`: per wireless interface `state`, `associated`, `ssid`, `bssid`, `frequencyMhz`, `keyManagement`, `rssiDbm`, `linkSpeedMbps`; or absent with the reason (no wireless interface; wpa_supplicant's control directory absent; a socket nobody answered) |
| `capabilities` | `wifi` (`supported`, `interfaces[]`), `bluetooth` (`supported`, `adapters[]`, adapter presence only), `cellular` (`supported: false`, `interfaces[]`) |

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

## 5. The snapshot schema, version 1

A snapshot is one JSON document. `schemaVersion` names its shape and is
bumped when a member changes; a reader that does not know the version it sees
should treat the members it does know as advisory.

| Member | Content |
|---|---|
| `schemaVersion` | `1` |
| `collectedAt` | RFC 3339 UTC as this appliance's clock had it; `time` says whether that clock is disciplined, `boot.uptime` is the monotonic reference |
| `release` | `board`, `release`, `kernel`, as section 2 defines them |
| `system` | the whole section 2 surface |
| `boot` | `slot`, `uptime` (section 2), `reset` (section 4), `update` (mosd's recorded live-state `update` entry: operation, progress, per-slot status, `booted_slot`, `primary`, `pending_not_confirmed`, the last install and mark) |
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

## 6. The redaction schema, version 1

Redaction is a tested security boundary, and it fails closed. It is the
management-API redaction `docs/design/security-model.md` §6 counts among the
confidentiality that does exist. Three passes, in order, in
`apid/src/diagnostics.rs`:

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
operation; there is no other write path into the store, and the root is
created on the first publish, never at start-up.

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

Written by the follow-on subtask against the contract above, not here:

- the collection, privacy, retention and escalation procedures an operator
  follows (how to collect, what a snapshot contains and does not, how long
  it is kept, what to hand to support and how);
- the symptom → evidence → remediation troubleshooting trees, each leaf
  naming the member of sections 2–5 it reads;
- the hardware validation record for section 4's adapters on the supported
  boards, and the built-in UI pages over the routes in section 8.
