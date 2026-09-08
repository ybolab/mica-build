# PLAN-071 Design the update module: off/check/auto with automatic install in a window

- **status**: approved
- **createdAt**: 2026-09-03 11:11
- **approvedAt**: 2026-09-04
- **relatedTask**: (none — design only; task records are owed on approval)

## Context

### What exists

The update path is built and unit-tested end to end on the host side, and the
one thing it does not do is act on its own.

- **`rauc-update`** (`pkgs/rauc-sign/`, shipped as `mos-rauc-update`) discovers
  releases from signed TUF metadata — `sync`, `check`, `fetch`, `import`,
  `probe` — selecting on board, profile, channel, manifest schema floor and a
  version strictly newer than the running one, read from
  `/usr/share/mos/release-identity.env`. It stages into
  `/mos/updates/{downloads,verified,staging}` and prints the verified bundle
  path as its last stdout line.
- **`update_lifecycle.rs`** drives it as a bounded subprocess and records one
  explicit state with a reason: `idle`, `checking`, `downloading`, `ready`,
  `installing`, `update-unavailable`, `failed`, plus the derived
  `reboot-required`, `validating`, `succeeded`, `rolled-back`.
- **`update_policy.rs`** holds a fail-closed policy file at
  `/var/lib/mos/update-policy.toml`, read fresh on every decision, with
  `source.{url,channel,…}`, `network.mode`, `autoCheck.intervalMinutes`,
  `maintenance.windows` and `rebootGate`. A file that exists and does not parse
  refuses every restricted action while the reboot gate keeps evaluating with
  defaults.
- **The safe-to-reboot gate** refuses `Reboot` while an install is in flight
  (no override lifts it) or while a component reports a blocking health status
  (an administrator may override, bounded to 3600 s, self-expiring, audited on
  both sides).
- **The rollback guard** `rollback_eligibility` permits a manual rollback only
  toward the strictly older install, with seven named refusal reasons.
- **The console already draws the surface.**
  `pkgs/mosd/apid/ui/src/features/system/system-page.tsx` renders the update
  state, the three actions, the reboot-gate check and a `RollbackPanel` — and
  an `AutomaticUpdates` section carrying a window field and a policy field that
  are **disabled and simulation-backed**, marked with a planned notice.

### The one sentence this plan changes

`docs/design/updates.md` §3: *"Auto-check runs `check` every
`intervalMinutes` … Checks only — nothing is ever fetched or installed
automatically; both stay operator actions behind their own gates."* And §3's
companion: maintenance windows gate **manual** installs.

Automatic fetch, and automatic install inside a window, are the new capability.

### The reference implementation, and where mos must differ

`/srv/dotns/lode` is the named integration model — a static Rust
verify-launch-update loader. Its configuration vocabulary is close enough to
adopt and its mechanism is wrong for mos in three specific ways.

**Adopt the vocabulary and the policy shape:**

| lode | mos | Verdict |
|---|---|---|
| `[update] policy = off \| check \| auto` | new `update.policy` | **Adopt verbatim.** Three words that mean the same three things, and the third is the one this plan is about |
| `[update] channel` | `source.channel`, already present | Already adopted |
| `[update] check_interval` | `autoCheck.intervalMinutes`, already present | Already adopted; §1 renames it under the new section |
| `[trust] require_signature = off \| auto \| enforce` | — | **Do not adopt.** See below |
| `[update] keep_versions`, `pin` | — | **No analogue.** See §6 |
| `[http] headers`, `credential_hosts`, `allow_insecure` | — | **Adopt the rule; PLAN-070 gives the host list a key.** See below |

**`require_signature` is not adoptable, and the reason is a feature.** lode's
three-way setting exists because lode can install unsigned artifacts — `auto`
without configured keys installs **UNVERIFIED** with a warning. mos has no such
mode and must never gain one: RAUC verifies every bundle against
`/etc/rauc/keyring.pem` with `plain` format refused, and the TUF walk is
mandatory in `rauc-update`. There is no flag that skips either, and the
absence is the position. Importing lode's setting would mean building an `off`
that does not exist today.

**The credential rule is adoptable and worth adopting explicitly.** lode
attaches `[http].headers` to an artifact download **only** when its host is
same-origin with the manifest source, so *a tampered manifest cannot redirect a
token to an attacker*. mos does not authenticate to its update source today and
this plan does not add authentication — but the day a private release channel
appears, the rule must already be written down, because the failure it prevents
is silent. Recorded here as a constraint on any future credential support:
**credentials configured for the update source are attached only to hosts
same-origin with the baked `update.source`, and any additional host is an
explicit operator list.** PLAN-070 gives that list a home now rather than later
— `http.credentialHosts` in the baked `meta/updates/manifest.json`, empty in the
committed `meta.example/` — so the rule and its shape exist before the first
credential does.

**The base is the baked value and not the effective one, and the reason for that
changed on 2026-09-04.** This paragraph used to say the distinction did not
matter — *"because PLAN-070 §5 makes the source URL baked-only: there is no
runtime layer that can move the origin a credential is scoped to."* PLAN-070
§5.3 creates exactly such a layer, so the sentence is false and the rule it
protected is now the one doing real work: pinning the base to layer 1 is what
stops an operator-written URL from re-scoping a credential to a host of its
choosing. Same words, and they went from describing the terrain to holding a
line — which is the shape of a rule written before the failure it prevents
became reachable. PLAN-070 §5.3.2 owns it and F6b carries the gate.

`allow_insecure` has no mos analogue: the TUF walk is what establishes trust,
and `docs/design/release-signing.md` §3.1 already mirrors metadata over plain
HTTP deliberately, treating the mirror as unverified input.

**Where the mechanisms diverge, stated once so no later reader re-derives it:**
mos updates are whole-system A/B RAUC slots, not per-app version directories;
the trust chain is TUF metadata plus a RAUC X.509 keyring, not a bare ed25519
key list; and a failed update is answered by bootloader slot fallback, not by
keeping N versions. Adopt the vocabulary and the policy shape. Do not adopt the
mechanism.

## Proposal

### 1. The policy, restated with one enum

The document moves and changes format, per PLAN-070 §5.1: it is
**`/mos/config/updates.json`** on DATA, it is **JSON**, and it is
**machine-written** — mosd is its only writer and a human does not hand-edit
it. `/var/lib/mos/update-policy.toml` goes away. The keys are today's, minus
the two that moved up to the baked layer.

**It is one occupant of `/mos/config/`, and PLAN-070 §5.2 is the namespace's
rules** — flat `<document>.json`, JSON, machine-written by exactly one daemon,
atomic temp-file-plus-rename with the mode set before the rename, fail closed on
a parse error with no fallback, one schema version per document, and the
directory at `0700` with `0600` documents. Those are namespace rules, not this
document's, so this plan inherits rather than restates them. Three consequences
for this plan:

- the write route of §3 is mosd's alone, which is the namespace's one-writer
  rule and not a choice made here;
- PLAN-070 §4.1 decides the reset disposition for the directory — tiers 1 and 3
  both return this document to the baked defaults, tier 2 leaves it alone.
  **Tier 1 re-seeding it means the move off STATE is not a behaviour change**:
  *configuration reset returns the channel to its default* is true today and
  stays true;
- **two of those rules changed after this plan was written and neither changes
  anything here.** The namespace is no longer `0755`-and-secret-free — it is
  `0700` and is credential material, because the settings store's Wi-Fi keys
  moved in beside this document — and it is no longer entered by PLAN-070's
  baked-default rule, which was retired. `updates.json` carries no secret either
  way, so the mode is inherited and not needed; and the retired rule was what
  argued this document's *address*, which §5.1's precedence table now carries on
  its own. **This plan was the reason the baked-default rule existed and it is
  not the reason it is gone**, so nothing in §1's schema, §2's semantics or §3's
  route moves with it.

**And this document is no longer the namespace's only durable tenant**, which
removes a claim this plan used to lean on implicitly: a reader looking at
`/mos/config/` will now find `network.json`, `wifi.json`, `mqtt.json`,
`ssh.json` and the rest beside it. `updates.json` is not special there, and the
only thing that distinguishes it is that its defaults come from the image
(§1.1) rather than from the schema.

```json
{
  "schema": "mos/update-config/v1",

  "policy":               "check",
  "checkIntervalMinutes": 1440,
  "rebootPolicy":         "manual",

  "source": {
    "url":       null,
    "channel":   "stable",
    "repoDir":   "/var/lib/mos/update/tuf-mirror",
    "statePath": "/var/lib/mos/update/uptane-state.json",
    "maxBytes":  500000000
  },

  "network":     { "mode": "online", "meteredAllowsFetch": false },
  "maintenance": { "windows": [ { "days": ["mon","thu"], "start": "02:00", "end": "04:00" } ] },
  "rebootGate":  { "blockingStatuses": ["blocking"], "overrideMaxSeconds": 3600 }
}
```

**`source.url` is present and `source.rootPath` is absent, and 2026-09-04 is
when those two parted company.** This paragraph read *both are absent by design
— PLAN-070 bakes both — and `deny_unknown_fields` means writing either one back
is a load error*. PLAN-070 §5.3 keeps the mechanism and moves the line it holds:

- **`source.url` is an override.** `null` means *take the baked default*, which
  is the same absent-key rule every other overridable key in this document
  follows; a value re-points the device. It is not a fallback — an override that
  does not answer reports the failure and the device does not revert to the
  baked address (PLAN-070 §5.1).
- **`source.rootPath` stays absent**, and with it every anchor-shaped key. There
  is **no `trust` object in this schema at all**, so naming a signing key, a
  keyring or a root path is a load error in exactly the shape the sentence above
  described — asserted by name per key, not only by the generic unknown-key path
  (PLAN-070 §5.3.5). The address is the operator's; what the device will accept
  is not, and this schema is where that is enforced rather than remembered.

| Value | What the device does on its own |
|---|---|
| `off` | Nothing. No timer arms. Manual check, fetch and install stay available behind their existing gates, and so does offline import. `off` is not "updates disabled" — it is "the device initiates nothing" |
| `check` | Metadata checks on `checkIntervalMinutes`, exactly today's `autoCheck`. Never fetches, never installs. **The default**, so the shipped behaviour is unchanged by this plan |
| `auto` | Checks, then fetches, then installs inside a maintenance window, then reboots or does not per `rebootPolicy` — §2 |

#### 1.1 Where each value comes from

PLAN-070 §5.1 is the rule and this plan holds it rather than restating it:
`meta/` bakes the trust anchors and **owns** them; it also bakes the **defaults**
for the source URL, the channel, the policy and the check interval; this
document overrides those four per key; and a key it does not name takes the
baked default, or the code default for the keys `meta/` never carries
(`rebootPolicy`, the windows, the network mode, the reboot-gate keys).
**Amended 2026-09-04**: the source URL moved from the owned list to the default
list; the anchors did not, and §10 is why.

The three consequences this plan is responsible for:

- **`channel` is now genuinely the operator's.** §4's channel-change analysis
  was written for a value an operator edits, and it stays true; what changes is
  that the edit is an API call rather than a text editor, and that the baked
  default is what a never-configured or freshly reset device follows.
- **An absent document is not a malformed one.** Absent → the baked defaults.
  Malformed → refuse every restricted action with a message naming the file,
  keep the reboot gate evaluating with defaults, and **never** silently adopt
  the baked channel. That is today's fail-closed split, unchanged by the move,
  and PLAN-070 §5.1 explains why absence is only reachable as *never
  configured* or *reset*: a DATA pool that is missing or unmounted fails the
  workspace readiness probe first and refuses with `update-unavailable`.
- **The source is the operator's too, on the same terms as the channel
  (2026-09-04).** Everything §4 says about a channel change — that it is a
  deliberate act, audited, and reported rather than silently absorbed — applies
  to an address change, and for a stronger reason: a wrong channel is a wrong
  release, a wrong address is a different party. §10 carries what that costs and
  what it does not.

`[autoCheck]` is **retired, and the move retired it.** The earlier draft of
this plan made it a load error on the old file so that a rename would fail
loudly. There is no longer an old file to fail on: the STATE document goes away
whole, and `checkIntervalMinutes` is a key in a new JSON document that mosd
writes. Nothing migrates, because there is nothing on a device in this tree
that this plan is obliged to carry forward — and a device that has one gets a
document written by the first configuration write, not a parse error it has to
be talked through.

### 2. What `auto` does, precisely

Four steps, each with its own gates, and no step that skips a gate a manual
operator would meet.

**Step 1 — check**, on `checkIntervalMinutes`. Unchanged from today: subject to
`network.mode` (`offline` refuses; `metered` admits, metadata is KiB-sized and
every file is capped at 1 MiB by the client), preceded by the workspace probe.

**Step 2 — fetch**, automatically, when a check names a candidate. Gated by:
`network.mode` (`metered` refuses unless `meteredAllowsFetch`; `offline`
refuses), the workspace readiness probe (`update-unavailable` refuses before
the first byte), and the `maxBytes` budget. **Not** gated by the maintenance
window: `docs/design/updates.md` §3's rule is that the window gates installs and
only installs, because the bundle is already local and verified by then, and a
fetch outside the window costs nothing worth refusing. That rule is unchanged
and now applies to an automatic fetch for the same reason.

**Step 3 — install**, automatically, **only inside a maintenance window**, and
with two additions the manual path does not have.

- **`policy = "auto"` requires at least one maintenance window.** A document
  with `auto` and zero windows is a validation error: refused at the write
  route with a message naming the rule (§3), and refused fail-closed by the
  reader if one reaches the disk any other way. Today zero windows means *any time*, which is
  right for a manual install (a device with no operator-set window must still
  be updatable by a human who is standing there) and wrong for an automatic
  one, where it would mean *install the moment a bundle lands*. Requiring the
  window is what makes "automatic installation inside a time window" literally
  true, and it forces the operator to name the hour rather than inherit one.
  The alternative — defaulting to 02:00–04:00 UTC — is rejected in §8.
- **A re-check immediately before the automatic install.** The automatic path
  installs only a bundle the *current* metadata still names; a staged bundle
  the publisher has withdrawn is deleted from `verified/` and the state says
  so. This is the one place automation is deliberately stricter than a human:
  an operator installing a staged bundle is making a choice, and automation
  must not install something that was pulled between the fetch and the window.
  §5 is the full withdrawal analysis.

**Step 4 — reboot**, and here the rule is a refusal to add anything.

- The automatic path calls the same gate `Reboot` calls, and honours the same
  two blocks: an install in flight, and a component reporting a blocking
  health status.
- **Automation never arms the override.** `SetRebootOverride` means *a human
  judged that this reboot outranks what that application is doing*. A machine
  cannot make that judgement, and an automatic override would silently convert
  every `ReportHealth(component, "blocking", why)` into a no-op — which is the
  same as not having the gate. Stated as an invariant with a place to enforce
  it: the arming path stays reachable only from the authenticated apid route,
  and the automatic path holds no capability to reach it. A unit test that
  drives the automatic path against a closed gate and asserts no override was
  armed is what keeps this from becoming prose.
- **When the gate is closed, automation defers and does not retry outside the
  window.** The lifecycle stays `reboot-required` with the gate's reasons
  visible, exactly as after a manual install. The next window re-attempts.
- **`rebootPolicy` is separate from `policy`, and defaults to `manual`.**
  "Install automatically" and "reboot automatically" are not the same promise:
  an appliance running a machine may well want the new slot written and staged
  while reserving the reboot for a human. `manual` installs and stops at
  `reboot-required`; `window` reboots inside the same window, gate-honoured.
  `manual` is the default because it is the setting that makes `auto` safe to
  recommend to someone who has not read this document.

**Deferral must be visible, not silent.** A permanently blocking application
permanently defers the reboot, which is correct and is also indistinguishable
from a stuck update unless the device says so. The lifecycle gains a
`deferred` fact naming *why* the last automatic attempt did not proceed —
`outside-window`, `reboot-gate-closed` with the gate's reasons, `clock-untrusted`,
`version-suppressed` — and how long the pending slot has been waiting. An
operator opening the update page after a week must be able to see that four
automatic attempts were refused and by what.

### 3. What an operator sees and controls

The surface is already drawn: `AutomaticUpdates` in the console carries a
switch, a window field and a policy field, all disabled and simulation-backed
behind a planned notice. This plan makes them real, and adds nothing to the
information architecture.

**Reads** (all from the one `GET /api/v1/update` document, which is already
the only read route for slot state): the policy as loaded, the next scheduled
check, the deferral fact of §2, how long a `reboot-required` has been pending,
and the suppressed-version record of §6.

**Controls**: `policy`, `channel`, `checkIntervalMinutes`, the windows,
`rebootPolicy`, and clearing a suppressed version.

**These controls are writable, and the earlier draft's argument that they are
not is retired.** That draft said the keys stay a hand-edited file, the console
renders them read-only, and the automatic path needs no write route. The
decision that the channel is operator-selectable ends that: an operator picks a
channel in the console, apid asks mosd, mosd writes the document. The half of
the old argument that survives is the half about the **settings tree** —
`docs/design/updates.md` §2's reason still holds, a settings key means a schema
bump plus a migration and a concurrent workstream owns the next bump — but
"not in the settings tree" never implied "not writable", and this plan stops
treating the two as the same statement.

The write route, stated so it can be built and reviewed:

- **One route**, on apid, authenticated as an administrator — the same
  authority every other management write requires, and no new one. There is no
  unauthenticated path and no fleet-derived path to it (PLAN-072 §5).
- **mosd owns the file and is its only writer.** apid does not write
  `/mos/config/updates.json`; it asks. One fact, one writer, all the way down
  to the filesystem.
- **Validation happens on write, not at the next check.** A rejected document
  is refused with the offending field named, and the on-disk document is never
  replaced by one that would fail to load. §2's `auto`-requires-a-window rule
  moves with it: the operator who selects `auto` with no window is told so in
  the console, instead of getting a device that fails closed some hours later
  for a reason they have to go looking for.
- **Atomicity follows the discipline the tree already has** — one save, a temp
  file and an atomic rename within the same directory, the shape `Store::save`
  uses for settings. This plan invents no second discipline. A reader therefore
  sees the old document or the new one and never a partial write; the residue
  is a torn write below the filesystem, which is what the fail-closed reader of
  §1.1 is for.
- **Audited like every other management write**, carrying the same actor field
  this section adds to the update events. *Who put this device on `beta`* is a
  question the trail must answer.

`deny_unknown_fields` still applies, and it means something different now: a
machine writer never emits an unknown field, so an unknown field is
hand-editing or corruption, and refusing it is right in both cases.

**Audit.** Every automatic action records the same event names the manual ones
do (`update-check`, `update-fetch`, `update-install`), distinguished by an
actor field — `policy` versus an operator's session. The trail must be able to
answer *did a human do this*, and an event set that cannot is a support tool
that lies during exactly the incident it exists for.

### 4. Channel change

`source.channel` is read fresh per decision, so a change takes effect on the
next check with no restart. Two things must be said about it because automation
makes them consequential.

**A channel change can select nothing.** Moving from `beta` to `stable` points
the device at a channel whose newest release may be *older* than what it runs.
`rauc-update`'s selection requires a version strictly newer than the running
one, and a downgrade needs `--allow-downgrade`. **The automatic path never
passes `--allow-downgrade`** — an unattended downgrade is an unattended
rollback to code the device already moved past, and the operator who wants one
can ask for it. So the device stays where it is until the new channel publishes
something newer.

That outcome must not look like "up to date". The check reports a distinct
reason — the selected channel holds no release newer than the running system —
rather than a bare `idle` with no candidate, because those two states differ in
what an operator should do next and the current vocabulary cannot tell them
apart.

**And a third state joins them: the source does not publish the selected
channel at all.** An operator can now select a channel through an API, so
selecting one the source has never carried is reachable in a way it was not
when the value came from a hand-edited file on a device somebody was already
logged into. The rule is PLAN-070 §5.1's: **report that the selected channel
holds nothing, and never fall back to the baked default.** A silent fallback
would put the device on a channel its operator did not choose, which is the
same defect as adopting the baked channel on a parse error. The three states
need three sentences, because the operator's next action differs each time —
wait; wait longer; fix the selection.

**A channel change does not shortcut anything.** An install after a channel
change is an install: same window, same gate, same re-check.

### 5. A withdrawn release

Three moments, three different answers, and one of them is "nothing, and that
is the design".

**Withdrawn before the fetch.** The next check does not select it. `available`
is re-derived per check and never remembered, so a stale candidate cannot
survive into a fetch.

**Withdrawn after the fetch, before the install.** A verified bundle sits in
`verified/`. TUF offers no revocation signal beyond the target's absence from
the current metadata, so the answer is §2's re-check: the automatic path
installs only what the current metadata still names, and deletes what it does
not. A human is not stopped — a manual install of a staged path stays
available, because the human may be installing it deliberately.

**Withdrawn after the install.** Nothing recalls it, and **this plan adds no
remote kill switch.** An endpoint that could make devices roll back is an
endpoint whose compromise rolls back every device it reaches, which is the
inverse of `docs/design/remote-management.md` §4's invariant and the same
argument §3 makes about update triggers. The answers that exist are the ones
that exist: automatic fallback on boot-credit exhaustion, and the guarded
manual rollback.

### 6. Rollback: `keep_versions` has no analogue, and the loop it would hide

**`keep_versions` is not "not adopted" — it is structurally absent.** lode
keeps N version directories and reverts a symlink; mos has exactly two system
slots and the previous system *is* the other slot. The analogue is fixed at two
by the partition table, not by a setting, and no policy key could change it.

**When the new slot fails to confirm, nothing new happens.** The bootloader
spends the boot credits, exhaustion falls back per
`docs/design/uboot-ab-handshake.md`, and the lifecycle derives `rolled-back`
with the failed slot named in the reason. That path is already built and needs
no automatic-mode variant.

**What `auto` must add is a suppression, and it is the single most important
safety property in this plan.** Without it, `auto` is a reboot loop: fetch a
bad bundle, install, fail to confirm, fall back, check finds the same newest
version, install it again, forever. lode's single-strike rollback is the shape
to copy, applied to versions rather than directories:

- a version whose slot rolled back is recorded **on STATE**;
- the automatic path will not select a suppressed version again;
- an operator clears the suppression explicitly, and the clearing is audited;
- a *manual* install of a suppressed version is permitted — the operator has
  been told and is choosing.

The record needs the version and the evidence (which slot, when, what the boot
status was), because "this device refuses 1.5.0" with no reason is a support
case with nothing in it.

**How this interacts with the existing rollback guard, which will surprise
someone.** After an automatic install and an automatic fallback, the booted
slot is the *older* system and the alternate holds the newer, failed one.
`rollback_eligibility` then refuses a manual rollback with
`alternate_is_newer` — correctly, because the device is already on the old
system and switching would re-apply the thing that failed. An operator reading
"rollback refused" immediately after an update failure will otherwise conclude
something is broken. The console must say *you are already on the previous
system* rather than surfacing the raw reason, and this plan owes that string.

### 7. The clock

Automatic behaviour keyed on wall-clock time inherits `docs/design/time.md`'s
trusted-clock floor: `max(RTC, saved clock)` in place before anything reads a
clock, network time only moving it forward from there.

**The maintenance window is UTC wall-clock, so a device that does not believe
its clock cannot honour it.** Rule: **an automatic install requires a clock the
device believes** — timesyncd reporting `synchronized`, or a floor that has
advanced since boot. Under `offline-degraded` with no advance, the automatic
install defers with the reason `clock-untrusted`. Checks and fetches are
unaffected: neither is time-keyed, and refusing them would make a
clockless device stop even discovering updates.

**And the automatic path makes an existing gap load-bearing.**
`docs/design/updates.md` §5.2 already records that the rollback guard's
install-order rule is only as good as the clock at install time, that a device
which installed with a wrong clock can record an order that did not happen, and
that closing the gap needs mosd to record its own confirmed-boot fact — named
there as a separate design rather than approximated.

A manual install has a witness: the human who pressed the button knows when.
**An automatic install has none.** So the gap stops being a footnote and
becomes a dependency: either mosd's confirmed-boot fact ships with the
automatic path, or `auto`'s rollback story is measurably weaker than the manual
one and the documentation must say so. This plan's position is the first —
backlog item U6 — and the second is the fallback if U6 is descoped, not a
silent outcome.

### 8. Rejected shapes, named because they are the obvious ones

- **Default the maintenance window to 02:00–04:00 UTC when `auto` is set.**
  Rejected: 02:00 UTC is business hours somewhere, and a device that reboots at
  an hour nobody chose is worse than a policy file that refuses to load. The
  refusal names the rule; a silent default names nothing.
- **Let automation arm the reboot override after N deferrals.** Rejected: it
  is the same as not having the gate, delayed. A blocking report means an
  application declared it must not be interrupted; a counter does not change
  that.
- **Install outside the window when the bundle is "urgent".** Rejected: it
  needs a signed severity field in the metadata, which makes the publisher able
  to bypass every device's window — a fleet-wide reboot primitive reachable
  from the release pipeline.

### 9. Downgrade restriction — required, 2026-09-03

The user requires a version downgrade restriction in lode's reader. This is not
an optional hardening: PLAN-070 question 6 replaces the TUF repository with
lode's plainer scheme, and version monotonicity is the property that
substitution otherwise loses. A plain signature over a manifest cannot tell a
current release from an old one — every old release was validly signed too, so
a mirror, a cache or anything able to serve stale bytes can hold a device at a
known-vulnerable version indefinitely, and every check will verify green.

**What it is.** The automatic path refuses a candidate whose version is lower
than the floor. Four things have to be pinned down, because each is a decision
and not an implementation detail.

**9.1 The floor is a high-water mark on STATE, not the installed version.**
The obvious floor — "refuse anything older than what is installed" — drops back
exactly when it is needed. After an automatic install and an automatic
fallback (§6) the installed version *is* the older one, so a floor read from
the running system reopens the window the mechanism exists to close. The floor
is therefore the **highest version this device has ever successfully installed**,
persisted **on STATE**, and it does not decrease on fallback.

**"Beside the policy on STATE" is what this sentence said, and after PLAN-070
F6b that phrase points at the wrong store — corrected 2026-09-04.** The policy
document is `/mos/config/updates.json` on DATA; the floor is not, and must not
be. Two independent reasons, either sufficient:

- **The floor is not configuration.** By PLAN-070 §5.2.1's boundary,
  `/mos/config/` holds what an integrator sets and STATE holds what the device
  mints or observes about itself. A high-water mark of what this device has
  installed is squarely the second — nobody sets it, the device records it.
- **§9.3's rule would otherwise become a technicality.** Since PLAN-070 §5.3 the
  operator document is also where the *source URL* lives, so the single write
  that re-points a device at a hostile server would be the same write that could
  lower the floor, if the floor lived there. *A floor a remote party can lower is
  not a floor* — and a floor the redirect itself can lower is worse, because the
  two halves of the attack would arrive in one atomic rename.

The floor stays on STATE, it is **not** a `/mos/config/` document or a key in
one, and lowering it stays §9.3's explicit audited operator action. That is the
same disposition §6's suppression store has, and for the same reason.

**9.2 It binds the automatic path only.** A manual install of an older bundle
stays permitted, consistently with §5 and §6, which both keep the human path
open on the same reasoning: the operator has been told and is choosing, and
that authority is already granted by `docs/design/security-model.md` §1.
Without this the mechanism becomes its own outage — a bad release with no
higher fix would strand every device that took it, with no route back that does
not involve reflashing.

**9.3 The strand case is real and its answer is a release practice, not code.**
With a high-water floor, a fix published *below* the bad version — v5 is bad,
the fix ships as v4.1 — is refused by the automatic path on every device that
took v5. The correct response to a bad release is to publish a **higher**
version, which is ordinary practice; the record states it so that the first
person to hit this does not read the refusal as a defect. The escape hatch, if
it is ever needed, is 9.2's manual install plus an audited clear of the floor —
an operator action, never a value the plane or the manifest can set. A floor a
remote party can lower is not a floor.

**9.4 The ordering must be defined before it can be enforced.** `VERSION` in
`release-identity.env` is of the form `0.1.0-dev.20260903`, and "lower than"
over that string is undefined until a rule says so. Specify the comparison
(semver, where a prerelease sorts below its release, so `0.1.0-dev.20260903` is
lower than `0.1.0`), and specify the behaviour for two versions that do not
compare — **refuse and say so, never guess**. A monotonic check whose ordering
is unspecified is a check whose verdict depends on string luck.

**9.5 Interaction with the suppression list (§6).** They are different
mechanisms and both are needed. Suppression records *this specific version
failed here*; the floor records *this device has moved past this point*.
Suppression is per-version and operator-clearable; the floor is a single value
that only rises. A version can be both suppressed and above the floor, and the
automatic path must refuse it for the reason that applies — the failure message
names which, because "refused" with no reason is the support case §6 already
warns about.

**What this does NOT cover, stated so nobody reads it as complete.** A
downgrade restriction defeats the **rollback** attack — being served an older
release. It does not defeat the **freeze** attack — being served the *current*
release forever, so the device never learns a fix exists. Every check verifies
green and the device simply never moves. Only a freshness bound catches that:
an expiry on the manifest, after which the reader treats the metadata as stale
and says so rather than reporting a successful check. That is a small addition
to the same reader and it is **not yet approved**; it is recorded here as the
remaining half of what the TUF substitution gave up.

**9.6 Freshness bound — APPROVED, 2026-09-03, and the remote side is the
authority for what is current.**

The manifest carries an expiry and the reader enforces it. This closes the
freeze attack the paragraph above leaves open, and it completes what the
substitution of lode's scheme for TUF gave up.

**The remote manifest is authoritative for "what is current."** The device does
not compute or remember a notion of the newest release; each check re-derives
the candidate set from the manifest it just fetched. That is not a new rule —
§5 already states that `available` is re-derived per check and never remembered,
so a stale candidate cannot survive into a fetch — and the freshness bound is
what makes it safe, because re-deriving from stale metadata is re-deriving from
whatever an attacker chose to keep serving.

**What it does not mean, stated because the two questions look alike.** The
remote side is not authoritative for the floor. §9.1 and §9.3 stand unchanged:
the high-water mark rises locally, and no value in a manifest, and nothing the
control plane sends, may lower it. *What is newest* is the server's question;
*what may this device accept* is the device's. A design that lets one answer
both has no downgrade restriction, only the appearance of one.

**And after PLAN-070 §5.3 the reader's subject is the *effective* source.** The
bound is enforced against whatever server the device is actually walking, baked
or overridden — an operator-chosen mirror that stops being re-signed reports
stale on exactly the same terms as a vendor one, because the check is over the
metadata and not over who served it. That is what lets §10 say the freeze attack
stays covered whoever answers.

**Stale metadata is a distinct outcome from up to date, and this is the whole
point.** A device served frozen metadata sees every check verify green and
simply never moves; if that renders as "no update available" it is
indistinguishable from being current, which is exactly the attack. The reader
reports a stale manifest as a **failed check with its own reason**, the
automatic path installs nothing from it, and the operator-visible state says the
metadata is stale rather than that the device is up to date.

**The clock this depends on already exists and was built for it.** An expiry
check is only as good as the device's notion of now, and this project already
binds one: timesyncd's saved clock on STATE, so that `max(RTC, last known good)`
holds **before TLS and TUF** (`docs/design/time.md`, and the record in
`docs/changelog.md`). The freshness check uses that bound, not the raw RTC — a
board with a dead RTC must neither read a valid manifest as expired nor an
expired one as valid. Substituting lode for TUF does not strand that mechanism;
it transfers to it.

**Owed to the release side.** Publishing now has a cadence requirement: metadata
must be re-signed before it expires, or fielded devices start reporting stale
checks against a repository nobody attacked. The expiry window and the re-sign
cadence are one decision and belong with `docs/design/release-artifacts.md`.

### 10. The source URL becomes overridable — amendment, 2026-09-04

The user requires that the update server address be changeable. PLAN-070 §5.3 is
the decision and carries the argument; this section is what it costs *this*
plan, which is the plan that owns what a device does unattended.

**What moved.** `source.url` becomes a key in `/mos/config/updates.json`,
overriding a baked default per PLAN-070 §5.1 — one more overridable key in a
document that already had six, with no new mechanism and no new failure mode
shape. **What did not move**: the trust anchors, which have no key in this
schema and cannot acquire one without a red test (§1's schema note).

**The reason this plan is not where the risk lands.** §9's two mechanisms were
built against *a mirror, a cache or anything able to serve stale bytes* — that
is, against a **substituted** source. A source the operator substitutes
deliberately is the same input arriving by a different route, so the mechanisms
apply unchanged and were never scoped to a baked address:

- **Rollback** — §9.1's floor is local, rises only, and no value in a manifest
  and nothing a server sends may lower it. A new server is *a remote party*, and
  §9.3 already refuses remote parties by name.
- **Freeze** — §9.6's bound is enforced over the metadata, not over who served
  it (§9.6). A stale mirror reads as stale whoever chose it.

**Where the amendment does reach this plan, and it is one sentence in two
places.** §9.1's *"beside the policy on STATE"* and §6's identical phrase were
written when the policy was on STATE. After PLAN-070 F6b the policy is on DATA
and the phrase points at the store the redirect is written to; both are
corrected above, and the correction is not cosmetic — it is the difference
between a floor an attacker must attack separately and one they get for free
with the redirect.

**What the operator gains, which is why the trade is worth making here.** §9.3
records a strand case whose only answer is a release practice: a device that took
a bad version refuses the automatic path until a *higher* version is published,
and the escape hatch is a manual install plus an audited clear of the floor.
After this amendment there is a second, gentler escape for the neighbouring
case — a device whose **server** has gone away rather than whose version is
stuck — and it does not touch the floor at all. Those two cases look alike from
a support queue and now have different answers, which is worth stating so
nobody reaches for the floor's escape hatch when the address is the problem.

**Not changed by this amendment**: `off | check | auto` and its gates, the
window rules, `rebootPolicy`, the suppression store, the deferral facts, the
clock predicate, §4's channel-change analysis (which now also describes an
address change, §1.1), and every backlog slice except U11's gate and U7's
console reading.

## Risks

- **`auto` is the first capability that reboots a device with nobody watching.**
  Every gate in §2 exists because of that, and the failure mode is not a bug in
  one of them but a path that skips one. The mitigation that actually works is
  structural: the automatic path must call the *same* functions the manual
  routes call, so a gate cannot be present on one path and absent on the other.
  A second implementation of the install sequence for automation would be the
  defect.
- **The suppression store is new persistent state on STATE and can be wrong in
  both directions.** Suppressing too eagerly strands a device on an old
  version; suppressing too little restores the reboot loop. It needs a test
  that drives a full bad-bundle cycle and asserts the second automatic pass
  selects nothing.
- **The document moves tier, format and writer in one step.** STATE → DATA,
  TOML → JSON, hand-edited → machine-written. Each is defensible on its own and
  together they are one slice with no half-done state that is safe: a build
  where mosd reads the new path and something still writes the old one is
  exactly the two-files-name-the-channel defect the move exists to remove.
  U1 and U11 ship together.
- **A write route is a new way to break a working device.** The policy file was
  previously changed by somebody who had already got a shell; now it is one
  authenticated API call, and a bad channel selection is reachable in a click.
  Validation-on-write is the mitigation and it has to be as strict as the
  reader, or the console becomes a way to write a document the device will
  refuse to load.
- **Deferral reasons are the whole observability story and are easy to under-
  build.** A `deferred` fact that says only "waiting" reproduces the silence it
  was added to remove.
- **Bench evidence.** `docs/design/updates.md` §6 already marks the full
  bad-bundle-to-fallback loop as owed to real hardware. `auto` is the mode that
  makes that loop reachable without an operator, so the bench row moves from
  "owed" to "blocking" for the automatic path specifically.

## Scope

In scope: the `off | check | auto` policy and `rebootPolicy`; automatic fetch
and automatic install with their gates; the pre-install re-check; the version
suppression and its clearing; the deferral facts and their console rendering;
the clock predicate; the channel-change reason; the audit actor field.

Out of scope: folding these keys into the **settings tree** (the follow-up
`docs/design/updates.md` §2 names, and still deferred for its schema-bump
reason — the write route of §3 is not that follow-up); update authentication and the credential
rule of the Context (recorded as a constraint, not built); staged or
percentage-based fleet rollout (PLAN-072 and PLAN-054); a remote kill switch
(rejected, §5); per-application updates (PLAN-069); the `meta/`
seam that defaults `source.url` (PLAN-070 — this plan works without it, on an
operator-owned document, and §1.1 is the only place the two meet).

### Implementation backlog — estimated separately from approval

| # | Slice | Size | Gate |
|---|---|---|---|
| U1 | The `policy`/`rebootPolicy` enums, `[autoCheck]` retirement, and the `auto`-requires-a-window validation, now enforced on write | S | selecting `auto` with zero windows is refused at the API naming the rule, not at the next check |
| U11 | The document's move: `/mos/config/updates.json` in JSON, mosd as its only writer, the atomic-rename save, and the apid write route with its audit; **`source.url` as an overridable key and no `trust` object in the schema** (§1, §10) | M | the channel **and the source** are each readable from exactly one file; an interrupted write leaves the previous document intact; the document conforms to PLAN-070 §5.2's namespace rules rather than inventing its own; a document naming a signing key, a keyring or a root path is a load error asserted by name; the downgrade floor and the suppression store are on STATE and neither is a key in this document |
| U2 | The automatic driver: check → fetch → re-check → install, calling the same functions the manual routes call | L | a test asserting the automatic and manual paths meet the same gate set |
| U3 | Reboot under `rebootPolicy`, gate-honoured, with the never-arms-the-override invariant | M | automatic path against a closed gate arms no override |
| U4 | Version suppression on STATE, its clearing action and audit | M | a full bad-bundle cycle; the second automatic pass selects nothing |
| U5 | Deferral facts in the lifecycle, and the channel-has-no-newer-release reason | M | each deferral reason reachable in a test |
| U6 | mosd's own confirmed-boot fact (§7), on which `auto`'s rollback ordering depends | M | dependency, not an extra |
| U7 | Console: make `AutomaticUpdates` real — the channel selector and the policy controls as **writes**, the deferral display, the baked-versus-operator-versus-effective reading of PLAN-070 §8 **for the source address as well as the channel** (§10), and the "already on the previous system" string | M | a re-pointed device shows which address it is using and that it is not the baked one |
| U8 | Audit actor field across the update events | S | — |
| U9 | Design-doc updates: `updates.md` §2, §3, §5, §6 and `remote-management.md` §3 | M | `make docs-verify` |
| U10 | Bench: bad bundle → automatic install → fallback → suppression, observed on serial | — | hardware; blocking for shipping `auto`, not for building it |

U2 and U6 carry the risk of the automatic path; U1 and U11 carry the risk of
the move and must not be split. U10 is not optional for a release that offers
`auto`.

## Approval boundary

**This plan ends at approved semantics for unattended change.** Approval means
agreeing that:

- `auto` fetches without asking, installs only inside a required window, and
  reboots only under `rebootPolicy = "window"`;
- the health-gated reboot is honoured by automation and the override is
  unreachable from it;
- a rolled-back version is suppressed until an operator clears it;
- an automatic install is deferred while the clock is untrusted;
- **amended 2026-09-04 (§10)** — the update source address is an operator
  override like the channel, the trust anchors are not and have no key in this
  schema, and §9's floor and §6's suppression store stay on STATE rather than
  moving to DATA with the policy document;
- the policy stays a **file** rather than a settings subtree — a
  machine-written JSON document at `/mos/config/updates.json` with an
  authenticated, audited, validated-on-write route, not a hand-edited one. (This
  clause named `/mos/updates/` until the path was settled, and that was already
  stale; it is corrected here rather than left to be read as a second answer.)
  **Under PLAN-070 §5.2 the distinction it draws has narrowed**: the settings
  store's own configuration content now lives in the same namespace, so "a file
  rather than a settings subtree" no longer names a difference in tier or in
  discipline. What it still names is a difference in *layering* — this document
  overrides baked defaults and the moved subsystems have none — and that is the
  half worth keeping.

Approval does not authorise the backlog. `check` remains the default after this
plan, so approving it does not change what a shipped device does until an
operator writes `auto`.

## Alternatives

1. **Keep checks-only and add nothing.** The status quo, and defensible: the
   operator presses three buttons and nothing surprises anyone. Rejected
   because the product asked for unattended updates, and because an appliance
   whose owner must remember to press a button does not stay patched.
2. **Automatic fetch, never automatic install.** The middle option, and the
   safest thing that is still useful: bandwidth is spent overnight and the
   install is one click. Genuinely close, and it is what `policy = "auto"` with
   `rebootPolicy = "manual"` degrades to if step 3 were dropped. Rejected as
   the whole feature because the requirement names installation inside a
   window, but it is the recommended *first* deployment posture and the
   documentation should say so.
3. **Adopt lode's `require_signature` three-way setting for symmetry.**
   Rejected: it would mean building an unverified-install mode that does not
   exist, to configure it off.
4. **Model `off`/`check`/`auto` as three booleans (`autoCheck`, `autoFetch`,
   `autoInstall`).** More expressive, and rejected: it admits combinations with
   no meaning (install without fetch), it does not match the vocabulary the
   user named as the model, and the one combination worth having —
   fetch-but-not-install — is what `rebootPolicy` plus a deployment
   recommendation covers without eight states.
5. **Put the policy in the settings tree now rather than later.** Rejected for
   `docs/design/updates.md` §2's unchanged reason: a schema bump collides with
   the concurrent workstream that owns the next one.

## Annotations

- 2026-09-03: Created as the second of three records answering the user's
  request. `/srv/dotns/lode` was read as the named integration model; the
  Context table records adopt-versus-differ per key.
- 2026-09-03: `check` stays the shipped default, so this plan changes no
  fielded device's behaviour until an operator opts in.
- 2026-09-03: PLAN-070 was rewritten — its seam is now a `meta/` directory
  baked into the image, not a device record on the META partition. Only the
  source of the defaults changed here: §1.1 states the per-key precedence and
  the parse-error rule the new seam owes, and the credential rule's same-origin
  base is named against the effective URL with `http.credentialHosts` as its
  home. The `off | check | auto` semantics, the window rules, the
  never-arms-the-override invariant, the rolled-back-version suppression, the
  clock predicate and the backlog are unchanged.
- 2026-09-03: **Addendum folded in.** The channel is operator-selectable at
  runtime, so the policy document moves to an operator-owned document on DATA,
  becomes JSON, and becomes machine-written; `/var/lib/mos/update-policy.toml`
  goes away rather than keeping a subset, because two files naming the channel
  is the defect the move exists to remove. §3's "the policy stays a
  hand-edited file and needs no write route" argument is retired and re-argued
  as a write route rather than deleted; §4 gains the third channel state (the
  source does not publish the selection) with the same never-fall-back rule;
  §1.1 defers the layering to PLAN-070 §5.1. The `off | check | auto`
  semantics, the window rules, the never-arms-the-override invariant, the
  suppression, the withdrawal analysis and the clock predicate are unchanged.
- 2026-09-03: PLAN-070 was revised again — `meta/` carries signing material, so
  it is gitignored and only an allowlisted public subset is baked. Touched here
  only where that makes a sentence false: the baked manifest is
  `meta/updates/manifest.json`, its committed default lives in `meta.example/`,
  and the claim that the credential host list is reviewable in a diff is
  withdrawn with PLAN-070 §2. Every invariant above is unchanged — the three
  layers, the `off | check | auto` semantics, the window rules, the write
  route, the third channel state and the backlog.
- 2026-09-03: The document's path is settled as **`/mos/config/updates.json`**,
  the first occupant of a `/mos/config/` namespace PLAN-070 §5.2 establishes for
  every later subsystem. This supersedes an intermediate ruling that kept it
  inside the `/mos/updates/` workspace. Recorded here as §1's pointer to the
  namespace rules and one clause on U11's gate. Two things it changes for this
  plan and nothing else: the one-writer rule is inherited rather than chosen
  here, and reset tier 1 re-seeds the document, so moving off STATE is no
  longer a behaviour change. The write route, the format, the `off | check |
  auto` semantics and every other decision are unchanged.
- 2026-09-03: PLAN-070 revised again, folding in two user decisions. Touched
  here only where a sentence became false. **`/mos/config/` is now the home of
  all system configuration**, not a namespace whose first occupant is this
  document: §1 says so, records that the namespace is `0700` and credential
  material rather than `0755` and secret-free, and records that the
  baked-default boundary rule which used to justify this document's address is
  retired — §5.1's precedence table carries that on its own. The approval
  boundary's stale `/mos/updates/` path is corrected in the same pass. Nothing
  else moves: the `off | check | auto` semantics, the `auto`-requires-a-window
  rule, the never-arms-the-override invariant, the version suppression, the
  withdrawal analysis, the clock predicate, the write route and the U1–U11
  backlog are unchanged. The key-algorithm decision does not reach this plan —
  it verifies no signature itself and calls a client that does.
### Approved — 2026-09-04

The user approved this plan, including §9's downgrade restriction and §9.6's freshness
bound, which are not optional hardening: they are the two properties that replace what
moving off TUF gave up, and an update path shipped without both is a net loss of a
security property rather than a simplification.

Implementation is gated on PLAN-070's seam landing first — the policy document lives in
the namespace that plan defines, and the reader's trust block comes from the manifest it
bakes. That ordering is the 1.0 milestone's Gate A before Gate B (PLAN-037).

### Amended — 2026-09-04: the update source address becomes an operator override

The user requires that the update server address be changeable. PLAN-070 §5.3 is
the decision; §10 above is what it costs this plan, and §9 is why the cost is
small: both of §9's mechanisms were built against a **substituted** source, and
an operator substituting one deliberately is that same input by another route.

**Edited in place**: §1.1's Context credential rule (the base stays the baked
value, and the reason it gave — *there is no runtime layer* — became false the
day the layer was created, which is when the rule started doing real work);
§1's schema, which gains `source.url` and states in terms that it has no `trust`
object; §1.1's precedence restatement and a third consequence; §6 and §9.1,
whose *"beside the policy on STATE"* now points at DATA and is corrected to
STATE with two independent reasons; §9.6, which is enforced over the effective
source; U11's and U7's gates; and one approval-boundary clause.

**Not changed**: the `off | check | auto` semantics, the window and reboot
rules, the suppression mechanism, the deferral facts, the clock predicate, §9's
floor and freshness bound themselves, and every other backlog slice.

