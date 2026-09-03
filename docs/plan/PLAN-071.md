# PLAN-071 Design the update module: off/check/auto with automatic install in a window

- **status**: draft
- **createdAt**: 2026-09-03 11:11
- **approvedAt**: (pending)
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
same-origin with the effective `source.url`, and any additional host is an
explicit operator list.** PLAN-070 gives that list a home now rather than
later — `http.credentialHosts` in the baked `meta/updates/manifest.json`,
empty in the committed `meta.example/` — so the rule and its shape exist before
the first credential does.

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

```toml
[update]
policy               = "check"   # off | check | auto
checkIntervalMinutes = 1440      # was [autoCheck].intervalMinutes
rebootPolicy         = "manual"  # manual | window

[source]
url = "…"        # unchanged; defaulted by baked meta/ (PLAN-070), see 1.1
channel = "stable"
# … the remaining source keys unchanged

[network]  # unchanged
[maintenance] # unchanged in shape; see §3 for the one new validation rule
[rebootGate]  # unchanged
```

| Value | What the device does on its own |
|---|---|
| `off` | Nothing. No timer arms. Manual check, fetch and install stay available behind their existing gates, and so does offline import. `off` is not "updates disabled" — it is "the device initiates nothing" |
| `check` | Metadata checks on `checkIntervalMinutes`, exactly today's `autoCheck`. Never fetches, never installs. **The default**, so the shipped behaviour is unchanged by this plan |
| `auto` | Checks, then fetches, then installs inside a maintenance window, then reboots or does not per `rebootPolicy` — §2 |

#### 1.1 Where each value comes from: baked defaults, and this file on top

PLAN-070 bakes `update.source`, `update.channel`, `update.policy` and
`update.checkIntervalMinutes` into the image at
`/usr/share/mos/meta/updates/manifest.json`. Those are **defaults, not
owners**, and the rule is per key:

- this file names a key → that value wins;
- this file does not name it, or does not exist → the baked value;
- neither → the code default, **except `source.url`, which has none.** Absent
  in both means no online source: check and fetch refuse with the reason they
  refuse with today, and offline import remains. That absence is unchanged by
  PLAN-070 and is the whole of the no-default-server rule as this plan sees it.

**A file that exists and does not parse does not fall back to the baked
values.** Today's fail-closed behaviour is unchanged — every restricted action
refuses while the reboot gate keeps evaluating with defaults — and it must not
become "revert to what was built in", because a typo would then silently move a
device back to the server its operator was in the middle of moving it off. A
parse error is not absence.

**Trust anchors are not on this list.** The RAUC keyring and the pinned TUF
root are baked and no key in this file names either; PLAN-070 §5.1 is the line
— configuration is overridable here, trust is not overridable anywhere. So a
device whose operator has re-pointed `source.url` still verifies against the
anchors its image shipped with, which is what keeps a policy-file edit from
being a trust decision.

The direction matters for `policy` too: `meta.example/` — the committed
statement of the seam's shape, since PLAN-070's `meta/` is itself gitignored —
sets `policy = "check"` and names no source, so the shipped default this plan
preserves is preserved in the image as well as in the code.

`[autoCheck]` is **retired, not migrated.** `deny_unknown_fields` means an
existing file carrying `[autoCheck]` becomes a load error, which fails closed
with a message naming the key — the correct behaviour for a rename on a system
in development, and cheaper than a migration nobody will read. The record says
so rather than leaving a reader to discover it.

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

- **`policy = "auto"` requires at least one maintenance window.** A policy file
  with `auto` and zero windows is a validation error and is refused fail-closed
  with a message naming the rule. Today zero windows means *any time*, which is
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

**Where those controls live is deliberately unchanged: the policy file.**
`docs/design/updates.md` §2 records why the keys are a file rather than settings
— a settings key means a schema bump plus a migration, and a concurrent
workstream owns the next bump. That reasoning has not expired, and the
automatic path does not need an API write surface to work. So the console
renders the policy read-only beside the actions, and folding these keys into the
settings tree stays the follow-up §2 already names. Anyone who wants the switch
to be clickable is asking for that follow-up, not for this plan.

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

- a version whose slot rolled back is recorded, on STATE beside the policy;
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
- **The retired `[autoCheck]` section turns every existing policy file into a
  load error.** That is intended and fails closed, but it means a device
  upgraded across this change refuses check, fetch and install until the file
  is edited — while the reboot gate keeps working, per the existing split. The
  release note owes that sentence.
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

Out of scope: an API write surface for the policy file (the follow-up
`docs/design/updates.md` §2 names); update authentication and the credential
rule of the Context (recorded as a constraint, not built); staged or
percentage-based fleet rollout (PLAN-072 and PLAN-054); a remote kill switch
(rejected, §5); per-application updates (PLAN-069); the baked `meta/`
seam that defaults `source.url` (PLAN-070 — this plan works without it, on an
operator-edited policy file, and §1.1 is the only place the two meet).

### Implementation backlog — estimated separately from approval

| # | Slice | Size | Gate |
|---|---|---|---|
| U1 | The `policy`/`rebootPolicy` enums, `[autoCheck]` retirement, and the `auto`-requires-a-window validation | S | a policy file with `auto` and zero windows is refused naming the rule |
| U2 | The automatic driver: check → fetch → re-check → install, calling the same functions the manual routes call | L | a test asserting the automatic and manual paths meet the same gate set |
| U3 | Reboot under `rebootPolicy`, gate-honoured, with the never-arms-the-override invariant | M | automatic path against a closed gate arms no override |
| U4 | Version suppression on STATE, its clearing action and audit | M | a full bad-bundle cycle; the second automatic pass selects nothing |
| U5 | Deferral facts in the lifecycle, and the channel-has-no-newer-release reason | M | each deferral reason reachable in a test |
| U6 | mosd's own confirmed-boot fact (§7), on which `auto`'s rollback ordering depends | M | dependency, not an extra |
| U7 | Console: make `AutomaticUpdates` real as a read surface, the deferral display, and the "already on the previous system" string | M | — |
| U8 | Audit actor field across the update events | S | — |
| U9 | Design-doc updates: `updates.md` §2, §3, §5, §6 and `remote-management.md` §3 | M | `make docs-verify` |
| U10 | Bench: bad bundle → automatic install → fallback → suppression, observed on serial | — | hardware; blocking for shipping `auto`, not for building it |

U2 and U6 carry the risk. U10 is not optional for a release that offers `auto`.

## Approval boundary

**This plan ends at approved semantics for unattended change.** Approval means
agreeing that:

- `auto` fetches without asking, installs only inside a required window, and
  reboots only under `rebootPolicy = "window"`;
- the health-gated reboot is honoured by automation and the override is
  unreachable from it;
- a rolled-back version is suppressed until an operator clears it;
- an automatic install is deferred while the clock is untrusted;
- the policy stays a file for now.

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
- 2026-09-03: PLAN-070 was revised a second time — `meta/` carries signing
  material, so it is gitignored and only a public subset is baked. Touched here
  only where that makes a sentence false: the baked manifest's path is
  `/usr/share/mos/meta/updates/manifest.json`, the committed default lives in
  `meta.example/` rather than in `meta/`, and the claim that the credential
  host list is reviewable in a diff is withdrawn with PLAN-070 §4.2. Every
  invariant above, including §1.1's precedence and parse-error rules, is
  unchanged.
