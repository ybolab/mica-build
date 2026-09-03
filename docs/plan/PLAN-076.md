# PLAN-076 Design device state reporting to the fleet plane

- **status**: draft
- **createdAt**: 2026-09-03 20:05
- **relatedTask**: RFCT-297
- **approvedAt**: (pending)

## Context

### What is approved, and what is not

The user asked for this design. **That request is the approval for designing
it, and it is the only approval this record carries.** It authorises writing
down what state reporting would be; it does not approve the design, does not
authorise building any of it, and does not extend PLAN-072's approval to a
larger payload. Like PLAN-070, PLAN-071 and PLAN-072, this record ends at an
explicit approval boundary and an implementation backlog estimated separately
from it.

### Where this sits

PLAN-072 §7b records the user's scope decision in three steps and this plan is
the middle one:

- **A — identity.** The plane knows the device exists, its board, profile and
  version. PLAN-072, unchanged, not re-opened here.
- **B — identity plus state reporting.** The device reports operating state
  outward on a cadence. **This record.**
- **C — remote configuration.** Deferred. PLAN-072 §4 excludes it, that
  exclusion stands, and §9 below says what keeps it excluded once a periodic
  channel exists.

### What is inherited and not renegotiated

From PLAN-072, verbatim in force:

- **The switch is off by default** and its enabling half is baked
  (`fleet.enabled` and `fleet.url` in `meta/updates/manifest.json`, §2).
- **Device-initiated outbound only, no inbound port, ever** (§3).
- **Autonomy during loss of service is a product promise** (§6, and §7a
  answer 4 — the plane *"assists and never gates local execution"*). *"There is
  no device behaviour that degrades as a function of time since last contact."*
- **Trust-on-first-use enrolment keyed on `deviceId`** (§7a answer 6), with its
  two required mitigations: a refused registration must be visible on the
  device, and the plane must have an operator path to release a wrongly claimed
  id.
- **The plane never holds an update signing key and never serves a bundle**
  (§5).
- **No hardware identifiers** — serial and MAC stay unsent (§7a answer 7).

### Why B is the expensive half

PLAN-072 §3 ends its identity list with *"that is the whole list"* and names
what is deliberately not sent. That works because identity is short, fixed, and
answers *who am I*. State answers *what am I doing*, and its field set grows
every time somebody wants one more metric. **A list cannot hold that boundary;
only a rule can.** §1 is the rule, §2 applies it, §3 shows it excluding a field
a reporter would obviously reach for, and §4 says why the redaction rule
already in the tree is not this rule. Everything after §4 is mechanism.

### The sources a reporter would reach for, judged

Each of these already exists and each is judged in §2 rather than assumed:

| Source | What it is | Verdict |
|---|---|---|
| `GET /api/v1/storage/status` | tiers, capacity, pressure, media wear (`pkgs/mosd/mosd/src/storage_status.rs`) | **partly**: capacity, pressure and wear in; device nodes, mountpoints, filesystems out |
| `GET /api/v1/system/telemetry` | thermal, watchdog, reset reason (`pkgs/mosd/mosd/src/telemetry.rs`) | **partly**: readings, watchdog state, reset reason in; pstore record *names* out |
| `GET /api/v1/network/status` | observed carrier, addresses, lease, routes, DNS, association | **almost entirely out** — §3 |
| `GET /api/v1/health` and the `health.<component>` live-state subtree | `{status, detail}` per component (`docs/design/api.md` §1.5) | **partly**: `status` in against a fixed component list, `detail` out, dynamic keys out |
| `GET /api/v1/system/info` | version, kernel, board, machine id, the package manifest | **partly**: version in; machine id, kernel version string and the manifest rows out |
| `GET /api/v1/time/status` | sync state, stratum, server, offset | **partly**: `synchronized` and `stratum` in; the server's name and address out |
| `/usr/share/mos/release-identity.env` | `BOARD`, `PROFILE`, `VERSION`, `COMMIT_DATE` | **already A's**: PLAN-072 §3 sends board, profile and version at registration; only `VERSION` repeats per report (§2) |
| The diagnostic bundle's redaction schema | allowlist, fail-closed, `REDACTION_SCHEMA_VERSION = 2` (`pkgs/mosd/apid/src/diagnostics.rs`) | **mechanism reused, contents not** — §4 |

## Proposal

### 1. The rule: four questions, and a procedural clause

**A field may leave the device in a state report only if all four answers are
yes. A field that fails any one is not reported, and its failure is written
down beside it in the same schema.**

**R1 — Bounded at the source.** Its value comes from a set this repository's
code enumerates: an enum, a boolean, a counter, a byte count, a measurement
with a unit, or a string this repository chose. Free text fails — an
operator-set hostname, a journal line, a `detail` string, a driver's error
message, a container image reference.

*Why this is first.* Free text cannot be filtered fail-closed. The only tool
for it is a substring denylist, and the tree already has one:
`SECRET_MARKERS` in `pkgs/mosd/apid/src/diagnostics.rs` is fifteen substrings
matched case-insensitively. It is fail-open by construction — a secret spelled
in none of those fifteen ways ships — and `pkgs/mosd/apid/src/redact.rs` says
so about its own list in as many words: *"The list is fail-open: a
secret-bearing field under a name it does not carry is served."* A snapshot can
afford that (§4). A channel that runs unattended for the life of the device
cannot.

**R2 — About the device, not about where the device is.** The field describes
the appliance. An IP address, a prefix, a gateway, a route, a DNS server, an
SSID, a BSSID, a MAC, an operator-chosen interface name or hostname, an NTP
server: each of those describes the customer's site. The device is the vendor's
product; the site is the customer's, and the customer did not buy a network
survey.

**R3 — Actionable at the fleet tier.** Name the decision. Some operator
decision, taken across many devices, changes when this value changes. A field
that fails R3 is not telemetry, it is a data-collection habit, and its cost —
bandwidth, disclosure, and a schema that can never shrink — is real whether or
not anyone reads it.

**R4 — Safe as a series.** At the reporting cadence, the sequence of this field
discloses nothing the single value does not. **This question does not exist in
the tree's existing redaction rule, because a snapshot is a moment and a report
is a feed.** It is the question that most often changes an answer: a value that
is innocuous once can be a duty cycle, an occupancy signal or a site map at
ninety-six samples a day for five years.

**The procedural clause.** The rule is only a rule if adding a field is a
visible act:

1. The field set is a **versioned allowlist constant in this repository's own
   source**, on the fail-closed shape §4 describes: a field the schema does not
   name is dropped, not sent.
2. **No dynamic keys.** Every key is a compile-time constant. A dynamic key —
   a unit name, a health component, a slot name — means the field set can grow
   without anyone editing the schema, which defeats the whole clause. The
   snapshot schema permits dynamic keys (`docs/design/diagnostics.md` §6); a
   report must not, and §2's health treatment is where that bites.
3. **Every report carries its schema version**, and the version bumps when the
   set changes.
4. **Adding a field requires four written answers in the same commit** — one
   per question — and the device serves the set it would send (§6), so the
   addition appears on every device that installs it without anyone updating a
   document.

### 2. The first set, by the rule

Restated where it repeats A, so the whole payload is readable in one place.

**Envelope.** `schemaVersion`, `deviceId`, `counter` (PLAN-072 §5's monotonic
anti-replay), `capturedAt`, `cadenceSeconds` (§10), `bufferedSeconds` (how long
this report waited, so the plane can order a flush), `gapReports` (how many
were dropped before this one, §5).

**Identity, per report.** `version` only. `board`, `profile` and the product
labels went to the plane at registration and cannot change without a reflash;
re-sending them every cadence is bytes for nothing. A device whose identity
does change re-registers — PLAN-072 §5 already makes registration idempotent by
`deviceId`, so this is that path, not a new one.

| Field | Source | R1 | R2 | R3 — the decision it changes | R4 |
|---|---|---|---|---|---|
| `version` | `release-identity.env` | ✓ | ✓ | which devices are behind; the whole point of a fleet view | ✓ |
| `update.bootedSlot`, `.primary`, `.pendingNotConfirmed` | `GetUpdateState` | ✓ enums, bool | ✓ | a fleet stuck unconfirmed after a rollout is the failure a rollout must detect | ✓ |
| `update.lastOperation`, `.lastResult` | `GetUpdateState` | ✓ enums | ✓ | stop the rollout | ✓ |
| `update.lastFailureCode` | **does not exist yet** | ✓ once it does | ✓ | which failure, without free text | ✓ |
| `health[].status` | `health.<component>` | ✓ enum | ✓ | dispatch, or don't | ✓ |
| `health.unknownComponents` | derived | ✓ count | ✓ | tells the fleet its schema is behind the device | ✓ |
| `storage.tiers[].{name, present, mounted, usedPercent, pressure}` | storage status | ✓ fixed `TIERS`, numbers, enum | ✓ | a fleet filling its DATA partition | ✓ |
| `storage.media[].{preEol, usedPercentMax}` | eMMC lifetime | ✓ enum, number | ✓ | **flash replacement scheduling** — the strongest R3 on this list | ✓ |
| `storage.media[].model` | sysfs | borderline — see below | ✓ | which hardware batch wears out | ✓ |
| `thermal[].{label, minMilliCelsius, maxMilliCelsius, lastMilliCelsius}` | telemetry | ✓ | ✓ | enclosure and siting faults | **weak — see below** |
| `reset.reason` | telemetry | ✓ enum | ✓ | a fleet-wide reset storm | ✓ |
| `watchdog.{state, nowayout, bootstatusFlags}` | telemetry | ✓ enum, bool, fixed flags | ✓ | same | ✓ |
| `pstore.recordCount` | telemetry | ✓ count | ✓ | a fleet that is panicking | ✓ |
| `time.synchronized`, `time.stratum` | time status | ✓ bool, number | ✓ | a fleet whose TLS is about to fail (§7) | ✓ |
| `failures.unitCount`, `failures.tasksFailed` | failures section | ✓ counts | ✓ | something is wrong here; pull a snapshot | ✓ |
| `interfaces[].{kind, carrierUp, online}` | network status | ✓ closed kind enum, bools | ✓ | a device on its fallback link | ✓ |

**Two calls the rule makes and does not hide.**

*`storage.media[].model` is a close call resolved toward inclusion.* It is a
vendor string chosen by neither this repository nor the site, so R1 is not
clean. It is resolved in because it is **identical on every unit of a board** —
a board fact wearing a per-device field's clothes — and because it is the key
that turns a wear-out number into an action ("this eMMC part in this batch is
at end of life"). It is capped in length and passes the string scrub. Named
here rather than waved through, because the next borderline string will cite
it.

*`thermal` fails R4 weakly and is kept with a mitigation.* A temperature series
at fifteen-minute resolution is a duty-cycle signal, and in some deployments an
occupancy signal, for the customer's site. It is kept because a fleet cannot see
thermal runaway any other way and that is a safety-relevant fault. The
mitigation is a design decision worth stating on its own: **the cadence is not
the sampling rate.** The reporter samples thermal internally on a short
interval and reports `min`/`max`/`last` since the previous report. That keeps
spike fidelity while the *reported* series stays coarse, which is better on all
three of bandwidth, disclosure and fault detection than sampling at the cadence.
It costs a sampler; the cost is in the backlog.

**Health, and why it is an array and not a map.** `health.<component>` in the
live-state tree has **dynamic keys**, written by any caller of `ReportHealth`
(`docs/design/api.md` §1.5; `rootfs/overlay/usr/lib/mos/mos-health` is one
caller, `pkgs/mosd/mosd/src/update_policy.rs` another). If the report carried
that subtree as a map, then **adding a `ReportHealth` caller anywhere in the
tree would add a field to the fleet payload with no review** — the procedural
clause defeated by a one-line change in an unrelated file. So the report
carries a fixed array over a compile-time component enumeration, `status` only,
and counts what it did not recognise in `health.unknownComponents`. The count
is the pressure valve: a fleet that sees it non-zero knows its schema is behind
the device, which is the visible-growth property §1.4 asks for, arriving as a
number instead of as silence.

**`update.lastFailureCode` does not exist and that is a slice, not a
hand-wave.** The update path today reports failure as free text
(`last_error`, `progress.message`, `install.error`, `last_mark.message` in the
snapshot schema). Free text fails R1. The honest consequence is that **B needs
an enumerated failure code on the update path before it can report why an
update failed**, and until that exists the report carries `lastResult: failed`
and nothing more. That is a real gap in what a fleet operator will want on day
one and it is priced in the backlog rather than closed by shipping the string.

**What is not sent.** PLAN-072 §3's exclusions stand unchanged — the
administrator credential, the webAdmin hash, the AP PSK, the device password,
SSH keys, settings, anything under `/srv`, and hardware identifiers. B adds:

- every free-text field, at every depth: journal lines, `detail`, `message`,
  `error`, `reason` strings, unit descriptions (R1);
- the package manifest rows — a few hundred per report for a fact `version`
  already answers, and the full bill of materials of a customer's device (R3,
  then R4);
- `machineId` — a second device identifier that buys no action `deviceId` does
  not already key, which is PLAN-072 §7a answer 7's reasoning applied to the
  identifier it did not name (R3);
- the hostname (R1, R2 — operator-chosen);
- every unit and task **name**; the counts go, the names do not (R1, R2 —
  application units are named by the customer);
- container names, image references and anything about applications (R1, R2);
- every network *value* — §3.

### 3. One field excluded, worked in full

**`network.interfaces[].addresses[].address` — the device's IP address.**

It is the field a reporter reaches for first. `GET /api/v1/network/status`
serves it, the diagnostics snapshot **keeps** it deliberately, and every fleet
UI has a column for it.

- **R1 — passes.** A parsed address, bounded in shape.
- **R2 — fails.** It describes the customer's LAN, not the appliance. The
  device does not choose it; the site's DHCP server does.
- **R3 — fails.** Name the decision it changes at fleet tier: there is none. An
  operator cannot reach `192.168.1.50` from the plane — PLAN-072 §3 makes the
  channel outbound-only and §4 keeps NAT traversal out — so the address is
  displayed and not used. The moment support genuinely needs it, they need the
  routes, the DNS servers and the lease as well, and that is a diagnostic
  snapshot: pulled per case, by the owner, to a recipient the owner verified.
  The surface for this already exists and it is the right one.
- **R4 — fails hardest.** One address is a fact. Ninety-six a day for five
  years is the customer's addressing plan, their re-provisioning events, their
  site moves and their VPN transitions, held by a third party the customer
  enrolled with once.

Three of four fail, so it is out. The same worked answer excludes, from the
same source: `addresses[].prefixLength`, `dhcp.lease.*`, `dns[]`,
`defaultRoutes[]`, `wifi.ssid`, `wifi.bssid` and `hardwareAddress`. The last
three the snapshot schema already marks identifying and ships as a sentinel;
the report does not ship them at all, because a sentinel exists so a *reader*
can tell "redacted" from "absent", and a machine feed has no reader to tell.

**What survives from that source, and why the distinction matters.** The
report carries `interfaces[].{kind, carrierUp, online}` — the device's own link
state, with no name and no address. `kind` is a closed enum this repository
defines in the settings schema; the interface *name* is excluded with the
addresses, because a bridge or VLAN name is operator-chosen (`br-lan`) and
fails R1 and R2 together. That the rule cuts *inside* a single source rather
than accepting or rejecting the whole of it is the property that makes it
usable on the next field.

### 4. Why the diagnostics rule is not this rule

`pkgs/mosd/apid/src/diagnostics.rs` carries `REDACTION_SCHEMA_VERSION = 2` and
a three-pass boundary documented at `docs/design/diagnostics.md` §6: the live
denylist, then an allowlist schema down to the leaf, then a string scrub. It
keeps IP addresses, prefixes, gateways, routes, DNS servers and the machine id;
it drops or sentinels MACs, SSIDs, BSSIDs and hostnames in journal lines.

**The mechanism carries over whole.** The report reuses all four of its
properties: `crate::redact`'s denylist applied first so a schema mistake still
ships a sentinel; an allowlist walked to the leaf, fail-closed; a schema version
that bumps when the set changes; and the two-directional test pair
(`every_planted_secret_is_absent_from_the_produced_snapshot` and
`every_benign_member_survives_the_pass`), because an allowlist that passes by
dropping everything is not a boundary.

**The contents do not carry over, for three reasons the snapshot's own contract
states.**

1. **Consent is per-act there and standing here.** `docs/design/diagnostics.md`
   §6 justifies keeping addresses and the machine id partly because *"the
   operator exporting a snapshot is choosing to hand them over."* That
   justification is a per-act choice. A fleet report is authorised once, by a
   switch, and then executed every cadence for the life of the device. A reason
   that rests on a choice made per bundle cannot be transplanted onto a
   standing one.
2. **The recipient is chosen there and baked here.** §10 of the same document
   instructs the operator to *"verify the recipient and case"* before
   transferring a snapshot. The report's recipient is the baked `fleet.url`,
   verified once at enrolment and never again.
3. **A snapshot is a moment; a report is a series.** §10 again: *"Redaction
   reduces exposure; it does not make the remaining device identity and network
   topology public."* One snapshot's topology is a moment the operator
   disclosed. A cadence of them is a monitoring feed of the customer's network,
   which is R4 and which the snapshot rule never had to ask.

**The invariant that binds the two, and is testable.** *No field the snapshot
schema drops or marks identifying may appear in a report, at any depth.* The
report's set is otherwise derived from sources the snapshot schema already
names, with aggregation (§2's thermal) as the only transformation. This is a
one-directional containment, mechanically checkable at the leaf-name level, and
it means the narrower boundary can never accidentally become the wider one.

**Two versions, not one.** The report's schema version is its own counter, not
`REDACTION_SCHEMA_VERSION`. They change for different reasons, and a shared
counter would make each bump lie about the other.

### 5. Cadence, and what happens when the plane is unreachable

**Cadence.** Default **900 seconds** (15 minutes), from `fleet.reportIntervalSeconds`
in the same baked `meta/updates/manifest.json` block that holds `fleet.enabled`
and `fleet.url` (PLAN-072 §2). **Baked and never plane-supplied** — a cadence
the plane could set is a response the device acts on, which is §9. A code floor
of **60 seconds** clamps any baked value; a build that asks for less gets 60 and
a refusal at build time.

**Change-triggered early send, not a second mechanism.** A small named set of
transitions resets the timer and sends the same payload immediately: a health
component changing status, the booted slot or `pendingNotConfirmed` changing,
and the first report after a reset with a non-`unknown` reason. Coalesced by
the same 60-second floor, so a flapping unit cannot become a report storm. One
payload, one code path, one schedule that can fire early.

**Size, honestly.** The set in §2 is roughly **2 KiB** of JSON — a handful of
scalars plus three small arrays already capped at their sources (`TIERS` is
fixed; `MAX_ENTRIES = 32` bounds thermal). A hard cap of **16 KiB** refuses the
report rather than truncating it, on the snapshot store's rule that a bound is
enforced by refusal, not by trimming. At the default cadence that is 96 reports
a day, about **190 KiB/day** of payload — but the honest number includes the
TLS handshake, and a fresh handshake per report roughly triples it to about
**0.7 MiB/day, 20 MiB/month**. On a metered LTE link that is the difference
between negligible and noticeable, so the reporter reuses its TLS session
across reports where the plane permits it, and the number is stated in the
operator documentation rather than discovered on a bill.

**When the plane is unreachable — the autonomy floor first.** PLAN-072 §6 is
inherited unchanged and B does not weaken it: **a device that cannot reach the
plane degrades to not reporting, and to nothing else.** No lease, no expiry, no
feature that stops, no local decision that consults the plane. Everything B
adds is on the far side of that line.

**What is buffered.** Whole reports, never partial ones.

- **Where.** `/mos/fleet/`, the system-owned DATA namespace, mode `0700`, owned
  by the reporter. The same tier the diagnostic store uses (`DEFAULT_ROOT =
  /mos/diagnostics`) and for the same reason: `/var` is disposable, and a device
  that reboots mid-outage must not lose the outage window. Not STATE — STATE
  holds the enrolment credential (PLAN-072 §3) and per-device secrets; a
  transmission buffer is neither.
- **How much.** **128 reports or 1 MiB, whichever binds first.** At the default
  cadence and size the count binds first, at about **32 hours** of history; the
  byte cap exists for the case where a report is larger than expected. Both are
  enforced, both are tested, and neither is configurable — an unbounded buffer
  is a disk-full defect, and a disk-full defect on the tier that holds `/srv`
  is an autonomy failure caused by the fleet feature, which is precisely the
  shape §6 forbids.
- **What is dropped first: the oldest.** The value of a state report decays —
  an operator resolving a fault wants the state approaching now, and the start
  of the outage is inferable from the last report that did get through.
- **The gap is never silent.** Every dropped report increments a counter
  carried in the next report that does arrive (`gapReports`), and `bufferedSeconds`
  says how long each flushed report waited. A plane must be able to tell a gap
  from a continuous series; a buffer that silently loses the difference turns
  an outage into a wrong history.
- **Steady state writes nothing.** A report is buffered **only when a send
  fails**. A successful send never touches flash. During an outage the cost is
  one append per cadence — 96 appends a day of about 2 KiB — to one
  rotated append-only file, not a file per report.
- **The counter survives a crash without an fsync per report.** PLAN-072 §5
  requires a monotonically increasing counter and a plane that rejects one which
  does not advance. Persisting it before every send would be a durable write per
  report even in steady state. Instead the device persists a **reservation** —
  `counter + 64` — hands out the window from memory, and persists again when it
  is exhausted. A crash resumes at the persisted value and skips the unused
  remainder, which is allowed: the rule is *must advance*, not *must not skip*.
  One small durable write per 64 reports, about every 16 hours at the default
  cadence.

**Retry.** PLAN-072 §6's bounded exponential backoff, with the cap pinned:
doubling from 30 seconds to a cap of **the cadence itself**. Retrying more often
than reports are generated is pointless; a cap above the cadence means the
buffer grows while the retry sleeps.

### 6. What the operator sees and controls

**Two switches, nested.** `fleet.enabled` (inherited, registration) and
`fleet.reporting` (state reporting), with reporting meaningful only when
enabled.

*Why two.* PLAN-072 §7b's own argument for making B a separate plan is the
argument for a separate switch: identity is a promise about a device that states
who it is once, and state is a continuous account of what it is doing. An
operator who wants the first without the second — an inventory record so support
knows what version they run when they call, without a standing telemetry feed —
is a real and ordinary posture, and one switch cannot express it. The reverse
pairing is impossible rather than merely unwanted: reporting without registration
gives the plane nothing to attach a report to. Nested, not parallel.

*Its default, and why it is on.* When `fleet.enabled` is turned on, `fleet.reporting`
defaults **on**. The second switch exists to be turned *off*: a plane with no
state is not the product the user asked B for, and requiring two deliberate
flips to reach the documented behaviour is friction with no security benefit —
the consent that matters was given by the first flip, which is the one that
starts the outbound connection at all.

*Where it lives.* `/mos/config/fleet.json`, the document PLAN-072 §2 already
creates for the administrator's switch, gaining one key. One document per
reconciler is the namespace's rule and fleet is one reconciler. The URL stays
baked and is still not in it.

*The cost, named.* Two switches means four states, and one of them —
enabled, reporting off — the plane must render as a distinct thing rather than
as "device offline". That cost lands on the plane's UI, which makes it §8's
business, and it is stated here because it is a consequence of a device-side
decision.

**Legible on the device, without a network capture.** Two read-only routes on
apid, both authenticated:

- **`GET /api/v1/fleet/status`** — both switch states, the plane URL from the
  baked manifest, registration state (including **registered-and-refused**,
  which PLAN-072 §7a answer 6 requires be visible), last successful report,
  last error and its class, backoff level, buffered report count, cumulative
  `gapReports`, and the report schema version.
- **`GET /api/v1/fleet/report/preview`** — **the exact report that would be
  sent right now.** Not a description of the payload, not a documented field
  list: the bytes. This is the answer to *"what is this device sending"*, and
  it is also the mechanism that makes §1's procedural clause real — a field
  added to the reporter appears in the preview on every device that installs
  the update, with no document to fall behind.

There is one producer, so preview and payload cannot drift: §7 puts the
serializer in mosd, and both apid's preview route and the reporter obtain the
payload from the same bus method. Byte-identity is a property of the structure,
not a test that has to keep up with it.

The console carries the same facts (PLAN-072's C6 already has a console item;
B extends it with the reporting switch, the buffer depth and the last send).

### 7. Where it runs

**A separate unit: `fleetd.service`, sibling to `mosd.service` and
`apid.service`.** Not mosd, not apid.

- **Not mosd.** mosd owns the whole settings and live-state tree and every
  privileged action on the bus (`docs/design/mosd.md` §5.4:
  `SetSettings`, `InstallUpdate`, `Reboot`, `SetTransientRootPassword`).
  Putting the outbound client in it makes the process with the most authority on
  the device also the one that opens connections to the Internet on a schedule.
- **Not apid.** The reuse is tempting — apid already has TLS, a bus client and
  the diagnostics collector — and it is the wrong seam twice over. apid is the
  *inbound* server that terminates untrusted LAN connections; folding the
  outbound client into it blends two directions in one process's compromise
  story. And apid holds the session signing key, the login-backoff counters and
  the audit ring (`pkgs/mosd/dist/apid.service`); adding the enrolment
  credential puts a fleet credential in the process that holds the LAN
  credentials, which is the shape `docs/design/remote-management.md` §4's
  independent-credential-domain invariant exists to prevent.
- **A separate unit, because of what it makes true.** *Does this device dial
  out* becomes answerable by `systemctl is-active fleetd`, and the switch being
  off means the unit is not running — a stopped unit is a stronger and more
  legible statement of "off" than a boolean inside a running daemon. apid stays
  root because it binds 80 and 443; fleetd binds nothing, so it runs as a
  dedicated system user with `ProtectSystem=strict`, `ReadWritePaths=/mos/fleet`,
  `RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6` and the rest of apid's
  hardening set, which apid itself cannot tighten as far. And it fails
  independently: a crash-looping reporter must not take the LAN API down with
  it, which is the autonomy promise in operational form.

**Where the payload is built, and why not in fleetd.** mosd's D-Bus policy is
root-only and tested as such (`pkgs/mosd/tests/dbus-policy-test.sh` asserts
mqttd's uid *cannot* call `ReportHealth`), so a non-root fleetd cannot read the
state tree. Rather than relax that boundary broadly, mosd gains **one**
read-only method, `GetFleetReport`, returning the finished payload, allowed to
exactly one additional uid. The allowlist then lives beside the state it
selects from, and fleetd holds the credential, the socket, the buffer and the
retry — and nothing else. **Neither process holds both the whole state tree and
the outbound credential**, which is the strongest available form of the
credential-domain invariant. The dbus policy's negative test extends to assert
fleetd's uid cannot call `GetSettings`, `ReportHealth`, `InstallUpdate` or
anything else. fleetd's own status (last send, buffer depth, last error) it
writes to `/mos/fleet/status.json`, which apid reads under its existing
read-only view of the filesystem — no new write path for apid, no second bus
method.

**The first periodic outbound connection this product makes, and what an
operator will therefore see.**

- **Recurring, timed failures become normal journal content.** A site with an
  egress firewall, a captive portal or a split-horizon resolver produces one
  failure per cadence, forever. Mitigation: log once per *backoff level*, not
  once per attempt, and put the state in `GET /api/v1/fleet/status` rather than
  in the journal. A feature whose failure mode is log noise gets muted, and a
  muted log is where the real fault hides.
- **The first component that must validate a server certificate against the
  clock.** `docs/design/time.md` §3 gives a trusted-clock *floor*
  (`max(RTC, saved clock)`), not a guarantee. A device whose floor is behind the
  plane certificate's `notBefore` fails TLS in a way that looks exactly like a
  network fault. `fleetd` is ordered after `sysinit.target`, which is what §3
  gives every other TLS and TUF consumer and is the most the tree has to give —
  but that only guarantees the *floor* is in place, not that network time has
  landed, so a device with no RTC and a stale saved clock can still be below the
  certificate's `notBefore` on its first report. The reporter must therefore
  classify a clock-related TLS failure as its own error class in the status
  route rather than counting it as a network failure.
- **A flush burst after a long outage.** Up to 128 reports arrive at once. That
  is a constraint on the plane (§8), and on the device it must not become a
  thundering herd across a fleet that lost connectivity together — the first
  send after recovery is jittered.
- **Beaconing.** A device that dials out on a fixed schedule looks like a beacon
  to an IDS. It must be documented, with the destination and the interval, so
  that it reads as intended behaviour rather than as a finding.

### 8. The wire contract, only as far as it constrains the device

Retention, aggregation, the tenant model and the UI are the server project's
and are not designed here. What is pinned is what a device in the field cannot
change later.

- **Transport.** HTTPS `POST` to a path under the baked `fleet.url`. Two
  endpoints in total across A and B: register (PLAN-072) and report. The report
  endpoint accepts **an array**, so a buffer flush is one request.
- **Versioning: the device declares, the plane adapts, and there is no
  negotiation.** Every report carries `schemaVersion`. The plane must accept
  every version it has ever accepted, **forever**, because a device in the
  field outlives a server schema and there is no mechanism — and by §9 must
  never be one — for the plane to tell a device which version to speak. The
  device never downgrades and never asks.
- **Adding a field is a minor change; removing or redefining one is a version
  bump.** The plane must ignore fields it does not know; the device must never
  require the plane to know a field. That asymmetry is what lets a fleet run
  mixed versions indefinitely.
- **The response set is closed, and the closure is the boundary.** Exactly
  three outcomes: accepted (2xx), retry later (429 or 5xx, with a
  `Retry-After` the device treats as a **lower** bound clamped by its own
  backoff cap and never as a cadence), and permanently refused (a 4xx for a
  revoked, unclaimed or wrongly-claimed device). **Anything outside this set is
  a transport failure, not an instruction.** A response body is not parsed
  beyond these.
- **Idempotency and ordering.** `(deviceId, counter)` is the dedup key.
  `capturedAt` is a **label, not authority** — PLAN-072 §5's rule, and it
  matters more here: a buffer flush delivers old reports late, so **the plane
  must not assume receipt order is capture order**, and must order by the
  counter and use its own receive time for freshness.
- **Refusal must reach the operator.** A permanent 4xx is not just a stopped
  reporter: it is the visible-refusal mitigation PLAN-072 §7a answer 6 requires,
  and it surfaces in `GET /api/v1/fleet/status` with its reason.
- **The device holds nothing on the plane's behalf.** Whatever retention the
  plane chooses, the device's buffer is a transmission buffer, not a store of
  record, and its bound (§5) is not negotiable by the plane.

### 9. What this must not become

Stated as plainly as PLAN-072 §4, because a periodic connection is a better
carrier for C than a one-shot registration ever was.

**The report is one-way. There is no code path from a response body to any
local state change other than "this counter was accepted."**

Specifically excluded, and each of these is a request that will be made:

- a **plane-supplied cadence** — the interval is baked (§5);
- a **plane-supplied field list** ("report these metrics") — the allowlist is in
  the image (§1);
- a **plane-supplied threshold or alarm rule** — the device evaluates nothing on
  the plane's behalf;
- a **request-response**: "fetch now", "collect a snapshot", "restart that
  unit", a job queue drained by the reporter;
- a **configuration write** of any kind, which is C by name;
- an **update trigger**, which additionally collapses PLAN-072 §5's
  separation of the fleet URL from the update trust hierarchy.

**And the one that will not look like C at all: uploading the diagnostic
snapshot.** It is the obvious next step once a channel exists, and it is the
whole of §4 undone in one commit — journal lines, site addresses and the machine
id, on a cadence, to a baked recipient, under a switch that was flipped for
something else. If snapshot upload is wanted it is a **per-act,
operator-initiated push** with its own consent, and that is a new record.

**How the exclusion is enforced rather than promised.** A test feeds the
reporter an adversarial response — extra fields, a command object, a
configuration document, a cadence, a bundle URL — and asserts the device does
nothing but advance its counter. C arriving by accretion then has to delete a
test with a name that says what it is for, which is a visible change instead of
a quiet one.

**And the lease that must never appear.** "The plane needs to know when a
device is missing" is a legitimate plane requirement and must stay a plane-side
inference (§10). It must never become a device-side heartbeat expiry with a
local consequence — that is PLAN-072 §6, and it is the failure that would turn
an assistive plane into a dependency.

### 10. Where this design recommends against B as asked

PLAN-072 §7b describes B as reporting *"reachability, version, storage,
thermal, service health."* Three of those five are delivered as asked. Two are
recommended against, with what replaces them.

1. **Reachability must not be a reported field — it cannot be one.** A device
   that cannot reach the plane cannot report that it cannot reach the plane. A
   `reachable` field is `true` by construction in every report that exists,
   which is a field that fails R3 absolutely: no decision changes on a constant.
   Reachability is a **plane-side inference** from arrival time. What the device
   owes it is one thing, and it is in §2's envelope: `cadenceSeconds`, its own
   declared interval, so the plane can distinguish *late* from *configured
   slowly* without guessing. One field replaces the idea, and the idea as
   stated is not buildable.

2. **Free-text failure detail must not be reported, even though it is the first
   thing a fleet operator will ask for.** Seeing a device red and not why is
   frustrating, and the pressure to ship `health[].detail` and
   `update.last_error` will be immediate and reasonable-sounding. It fails R1,
   and R1 is the question the tree's own code answers against us: the only
   filter available for free text is a fail-open substring denylist
   (`pkgs/mosd/apid/src/redact.rs`: *"a secret-bearing field under a name it
   does not carry is served"*). The substitute is two-part and both parts are
   real work: enumerated failure codes on the update and health paths (§2, and
   priced in the backlog), and — for anything an enumeration cannot cover — the
   diagnostic snapshot, pulled per case by the owner, which is the surface
   built for exactly this and keeps its per-act consent.

3. **Do not let the cadence become fast enough to be a monitor.** A minute-scale
   or sub-minute feed is a different product: it needs a persistent connection,
   which is a different cost envelope, a different failure model, and half of
   the NAT-traversing channel PLAN-072 §4 defers. The 60-second code floor (§5)
   is where that boundary is enforced, and **a request for anything faster is a
   new record, not a configuration change.**

## Risks

- **The rule is only as good as the discipline that applies it.** §1's four
  questions have no compiler. What has a compiler is the fail-closed allowlist,
  the no-dynamic-keys rule and the containment invariant of §4; the questions
  are what a reviewer argues with. The mitigation that is not a hope is §6's
  preview route: a field added without the argument still shows up on every
  device.
- **`health.unknownComponents` is a pressure valve that can be misread as a
  defect.** A fleet seeing it non-zero across a rollout will file it as a bug
  rather than as the schema-behind-device signal it is. It needs a name and an
  explanation in the plane's UI, which is a plane-side obligation created by a
  device-side decision.
- **The thermal series is the field most likely to be regretted.** It is kept on
  a safety argument with an R4 weakness named (§2). If a deployment's threat
  model makes site occupancy sensitive, thermal is the first field to drop, and
  the schema must be able to lose a field — which is why §8 makes removal a
  version bump rather than an impossibility.
- **A separate daemon is a third thing to build, ship and version.** `fleetd`
  costs a package, a unit, a uid, a D-Bus policy change to a tested boundary,
  and a second consumer of mosd's state. The alternative (§7's rejected
  options) costs a worse compromise story. The cost is real and is in the
  backlog, not hidden in §7's argument.
- **The buffer is the one place B can hurt a device that A cannot.** An
  unbounded or badly-bounded buffer fills the tier that holds `/srv`, and that
  is an autonomy failure *caused by the fleet feature* — exactly what PLAN-072
  §6 promises cannot happen. Both bounds are enforced and both need a test that
  drives them, not a constant that documents them.
- **Increment pressure is higher here than in PLAN-072.** A registration
  endpoint is called once; a report endpoint is called every cadence and is
  already open, already authenticated and already carrying structured data. §9
  is the boundary and the adversarial-response test is its evidence.
- **Approving this record could be read as approving telemetry collection.** It
  is not. The approval boundary below says what approval means, and — as in
  PLAN-072 — no slice is authorised by it.

## Scope

**In scope:** the rule that decides what may leave the device, the first field
set derived from it, the exclusions and their reasoning, the relationship to
the diagnostics redaction boundary, the cadence and its floor, the buffer and
its bounds, the operator switch and the device-side visibility surface, the
component that runs it and its privilege posture, and the wire contract's
device-side constraints and versioning rule.

**Out of scope, explicitly:** any implementation; remote configuration or any
command surface (C); changes to registration (PLAN-072 §3 stands); changes to
the update path beyond the enumerated failure code B needs from it; a plane-side
data model, retention policy, aggregation, alerting or UI; NAT-traversing
support reachability (PLAN-072 §4); building or operating the plane.

### Implementation backlog — estimated separately from approval

Approving this design does **not** authorise these. They depend on PLAN-072's
C1–C3 (the switch, the registration client and the enrolment credential) and
through those on PLAN-070 F5.

**Device side** — the only half this repository builds.

| # | Slice | Size | Gate |
|---|---|---|---|
| B1 | The report schema as a fail-closed allowlist constant, its version, and the denylist pass in front of it | M | a planted secret under every name and depth is absent from a produced report; a benign field set survives; **no field the snapshot schema drops or sentinels appears at any depth** |
| B2 | `GetFleetReport` on mosd: the payload built beside the state, fixed component enumeration, `unknownComponents` count | M | a new `ReportHealth` caller adds no field to the payload |
| B3 | The thermal sampler and its min/max/last aggregation | S | spike detected at the sampling interval, not the cadence |
| B4 | Enumerated failure codes on the update and health paths | M | every free-text failure in `GetUpdateState` maps to a code, or is reported as `unknown` — never as its text |
| B5 | `fleetd`: unit, dedicated uid, hardening, the D-Bus policy change, the outbound client | M | the policy's negative test asserts fleetd's uid cannot call `GetSettings`, `ReportHealth` or `InstallUpdate` |
| B6 | Cadence, the 60 s floor, the change-trigger set and its coalescing, jittered recovery | S | a build asking for less than 60 s is refused; a flapping component produces at most one report per minute |
| B7 | The buffer: bounds, oldest-first drop, `gapReports`, the counter reservation | M | both bounds driven to their limit; a crash mid-send does not stall the counter; steady state performs no writes |
| B8 | `fleet.reporting` in `/mos/config/fleet.json`, and off meaning the unit is stopped | S | reporting off with `fleet.enabled` on is a distinct, reported state |
| B9 | `GET /api/v1/fleet/status` and `GET /api/v1/fleet/report/preview` | M | preview and sent payload come from one producer; refused registration is visible |
| B10 | The adversarial-response test (§9) | S | an extra field, a command, a cadence and a bundle URL in a response change nothing but the counter |
| B11 | Clock-class TLS failure classification, and `fleetd` ordered after `sysinit.target` | S | a device below the certificate floor reports a clock error, not a network error |
| B12 | Console: reporting switch, buffer depth, last send, last error | S | — |
| B13 | Design docs: a fleet reporting section, `remote-management.md` §2/§4, `diagnostics.md` §6's relationship to this boundary, `security-model.md`; `docs/zh/` where the coverage table governs the page | M | `make docs-verify` |

**Plane side** — **not this repository, not this backlog, and not estimated
here.** Ingest, batch acceptance, schema-version tolerance, retention,
aggregation, the missing-device inference of §10, the UI that distinguishes
"reporting off" from "offline", and the operator path to release a wrongly
claimed id are the server project's, with its own owner and cost envelope.
PLAN-072's boundary on this is unchanged and B does not soften it.

## Approval boundary

**This plan ends at an approved rule and an approved first field set.** The
user's request approved *designing* this; it did not approve the design.

Approval would mean agreeing that:

- §1's four questions plus the procedural clause are the mechanism that decides
  the next field, and a field is not added without four written answers;
- §2's set is the first application of it, including the two calls it makes
  against the obvious answer (`media[].model` in, `thermal` in with its R4
  weakness named);
- §3's exclusion of every network *value* is right, and the diagnostic snapshot
  — per-case, owner-pulled — remains the surface for the cases that need them;
- §4's containment invariant holds: a report never carries what a snapshot
  drops;
- §5's cadence, floor and bounded buffer are the shape, and the buffer's bound
  is not negotiable by the plane;
- §6's two nested switches are worth their four-state cost, and the preview
  route is the operator's answer to "what is this device sending";
- §7's separate `fleetd` is worth a third daemon, and the payload is built in
  mosd so that no process holds both the state tree and the outbound credential;
- §9's exclusions are the boundary, enforced by the adversarial-response test;
- **§10's three recommendations against B as asked are accepted**: reachability
  is not a device field, free-text detail is not reported, and the cadence floor
  is a boundary rather than a setting.

Approval does **not** authorise B1–B13, does not authorise building or operating
a plane, and does not extend to C. PLAN-054 remains the parent record and its
ownership and cost gate is unchanged.

## Alternatives

1. **One switch instead of two** (§6). Rejected: it makes "an inventory record
   without a telemetry feed" unexpressible, and that posture is the one a
   privacy-conscious customer will ask for first. The cost of rejecting it is
   the four-state rendering problem, which is stated rather than avoided.
2. **Report the whole diagnostic snapshot on a cadence.** Rejected, and named
   because it is the cheapest thing to build: it reuses a finished collector and
   a finished redaction boundary. It is wrong for the three reasons in §4 —
   standing consent, a baked recipient, and a series rather than a moment — and
   §9 names it as the accretion path that will not look like C.
3. **A denylist instead of an allowlist** — send the state tree minus a list of
   forbidden fields. Rejected: `pkgs/mosd/apid/src/redact.rs` states its own
   list's failure mode (*"fail-open"*), and a fail-open filter on a standing
   outbound channel ships the next secret-bearing field somebody adds under a
   name nobody thought of.
4. **Run the reporter inside apid** (§7). Rejected: it blends inbound and
   outbound in one compromise story and puts the enrolment credential in the
   process holding the LAN session key and audit ring. Cheaper by one daemon;
   the credential-domain invariant is what it costs.
5. **Run the reporter as root inside mosd.** Rejected for the stronger form of
   the same objection: the process with every privileged bus method would also
   be the one dialling the Internet on a timer.
6. **Give `fleetd` a read-only apid token instead of a bus method** (§7).
   Rejected: apid tokens are not scoped read-only today, so this needs a new
   token capability *and* puts an apid credential in the fleet process — more
   work than one bus method, for a weaker boundary.
7. **Let the plane set the cadence and the field list.** Rejected: it is the
   most useful-sounding feature in this space and it is C. A device that changes
   behaviour because of a response body is a device the plane configures, and
   the increment from "which fields" to "which settings" is a schema change, not
   a design change.
8. **A push-on-change model with no periodic report.** Rejected: silence then
   means both "nothing changed" and "the device is gone", which forces the plane
   into a lease and the device into a heartbeat — PLAN-072 §6's forbidden shape
   arriving through the back door. The periodic report is what makes absence
   legible without a lease.
9. **Buffer indefinitely, or not at all.** Both rejected. Unbounded is a
   disk-full defect on the tier holding `/srv`; not buffering at all loses the
   entire outage window, which is the one interval an operator most wants after
   the fact.

## Annotations

- 2026-09-03: Created as the B of PLAN-072 §7b's A/B/C scope decision. The user
  asked for this design; that request is the approval for designing it and
  nothing more, and the design itself ends at the approval boundary above.
  PLAN-072's switch, outbound-only direction, autonomy promise and
  trust-on-first-use enrolment are inherited and not renegotiated.
- 2026-09-03: The whole cost of this record is §1's rule and §2's application of
  it. The diagnostics redaction boundary
  (`pkgs/mosd/apid/src/diagnostics.rs`, `docs/design/diagnostics.md` §6) is
  reused as a mechanism and deliberately not as a content policy; §4 gives the
  three reasons, each from that document's own contract.
- 2026-09-03: Three parts of B as the user described it are recommended against
  in §10 — a reachability field, free-text failure detail, and a cadence fast
  enough to be a monitor. Two of the five things PLAN-072 §7b names are
  therefore not delivered as stated, and the substitutes are named.
