# PLAN-089 The boot health gate requires core function instead of forbidding every failure

- **status**: completed
- **createdAt**: 2026-09-08 15:03
- **approvedAt**: 2026-09-08 15:03
- **relatedTask**: RFCT-360

## Context

`mos-regdb-reload.service` failed on a cx3576 on 2026-09-08. On that board's SKU
the unit governs nothing: the Wi-Fi phy is `REGULATORY_WIPHY_SELF_MANAGED` —
`iw reg get` prints `phy#0 (self-managed)` with its own table — so the core
regulatory domain the unit loads is never consulted. Why the unit failed is a
separate question and stays with RFCT-361.

What that failure did is this plan's subject. The gate refuses to confirm the
booted slot if **any** unit is failed and not named in `/etc/mos/health.conf`'s
`tolerate-failed` allowlist, and that allowlist ships **empty**. No `mark-good`
means the slot spends a boot credit every boot; after three the U-Boot handshake
falls to slot B, which on a freshly flashed device is zero-filled. `boot.cmd`
refills both counters and returns to A, so the device does not brick — it loops.

A working system was one non-essential unit away from being unusable.

### The defect, stated precisely

The gate is **deny-by-default over every unit on the system, with an empty
allowlist**. Two consequences, and the second is the one that makes it
indefensible rather than merely strict:

1. **Nobody decided it.** `/etc/mos/health.conf` carries `settle-sec`,
   `probe-timeout-sec` and `var-threshold-pct` and not one `tolerate-failed`
   line. Every unit in the image — and every unit a future change adds — holds a
   veto over the device's boot credits by default, without anyone having judged
   any of them essential. The set grows on its own.
2. **It is simultaneously too lax.** A daemon that is `active (running)` and
   wedged is not a failed unit. The sweep passes a slot whose mosd owns its bus
   name and answers nothing, and fails a slot whose only defect is a oneshot
   that governs nothing. It is the wrong question asked in both directions.

The three existing probes — the systemd state, the mosd bus call, the `/var`
threshold — are the right shape and are kept. Only the blanket sweep is wrong.

## 1. The criterion

**Invert it: a REQUIRED set, not a forbidden set.**

The gate exists to answer one question, and it is not "is this device healthy".
It is: **can this slot be recovered?** A rollback buys back exactly one thing —
a slot an operator or the fleet can reach and update. If the booted slot can be
reached and updated, rolling back gains nothing and costs the boot credits that
protect the device from a genuinely dead update. If it cannot, no amount of
otherwise-correct behaviour matters, because nobody can fix it.

So the gate asserts a small, named, justified set of things the device must be
able to do, and everything else it observes is **reported**, not fatal.

The precedent this generalises is already in the tree and is cited rather than
re-derived: `pkgs/mosd/mosd/src/bus.rs` deliberately does not let `mos-health`'s
`degraded` disk-pressure report block a reboot
(`a_blocking_health_report_refuses_a_reboot_until_overridden` asserts it), and
`docs/design/updates.md` §4 states why — *"a reboot neither worsens nor is
worsened by a full `/var`"*. The same reasoning applied to a failed unit gives
the same answer: a failed `mos-regdb-reload.service` neither worsens nor is
worsened by an A/B rollback, so it must not cause one.

## 2. The required set

Three members, named in `/etc/mos/health.conf` as `require=<member>` lines. The
gate implements exactly this vocabulary and nothing else.

| Member | What it probes | What it proves | What its absence costs |
|---|---|---|---|
| `boot-settled` | `systemctl is-system-running` is `running` or `degraded`; or it is `initializing`/`starting` and this gate is the only job still running | the boot transaction finished — `multi-user.target` was reached | on `maintenance` the system is in the emergency path: no `multi-user.target`, therefore no mosd, no apid, no sshd, no network. There is no route in of any kind, local or remote. Nothing else on this list can even be evaluated. |
| `mosd` | `com.mos.mosd1.GetState("")` answers on the system bus | the only process that can drive a RAUC install is alive and answering | apid's update cluster is a proxy: `install_update`, `get_update_state` and `mark_update` are declared on apid's mosd proxy (`pkgs/mosd/apid/src/bus_client.rs`) and every one of them is a call into mosd. With mosd down, `POST /api/v1/update/install` cannot install anything. The device is reachable and **unfixable** — which is precisely the state rollback exists to escape. |
| `apid` | `GET https://127.0.0.1/healthz` answers | the only *network* route into the device is serving | on the `prod` image profile SSH is seeded **off** (`pkgs/mosd/mosd/src/provisioning.rs`, `prod_profile must not open SSH`), so apid is the whole remote surface. With apid down, mosd would happily take a bundle and there is no way to hand it one without physical access to the serial console. A fleet device that needs a person in the room has not been recovered. |

Each member is probed in that fixed order regardless of the order of the
`require=` lines, because a `boot-settled` failure explains the other two and
should be the sentence a reader sees first.

### The `mosd` and `apid` argument, taken seriously

The dispatch is right that neither is automatically core, and the test it names
is the correct one: what does the device need to be **recovered**, not to be
**useful**?

- **mosd survives that test on the update path, not on the usefulness path.**
  Nothing about settings, networking or the UI is load-bearing here. What is
  load-bearing is that mosd is the only process in the system that talks to
  RAUC's D-Bus installer. Take it away and the recovery story has no last step.
- **apid survives it only because of the `prod` profile.** The counter-argument
  in the dispatch is sound as stated — *a device that boots to a serial console
  and can take a RAUC bundle is maintainable even if the API is down* — and it
  is exactly why apid is **not** required on the grounds of being the management
  API. It is required because on a `prod` device the serial console is the only
  alternative, and requiring physical presence to recover a fielded unit is not
  a recovery path, it is a truck roll. On a `dev`-profile image the argument is
  genuinely weaker; the shipped conf still requires apid, because the conf is
  board-agnostic and one image profile must not silently widen what the gate
  accepts. An integrator who ships an image without apid drops the line — see
  §3.

### What is deliberately not in the set

- **`rauc` itself.** Gate 0 already refuses when `rauc status` fails or cannot
  be parsed, and exits 0 when rauc names no booted slot. Making it a `require=`
  member would be circular: with no booted slot there is no credit to spend and
  nothing to confirm. Gate 0 keeps its own three distinct outcomes.
- **The verity root and the kernel.** The dispatch names them as a minimum, and
  they are — but they are not *falsifiable from inside this gate*. If the
  dm-verity root were not mounted this script would not exist to run. A member
  that can never be red is a member that reports on nothing; the image contract
  (`verify/run.sh --verify`) is where that fact is actually asserted, against
  the assembled image, before it is ever flashed.
- **sshd, connd, mqttd, the hwinit units, any application unit.** Each of them
  can be down on a device that is still reachable and still updatable. That is
  the whole test. `mos-regdb-reload.service` is in this group and this is the
  sentence that would have prevented 2026-09-08.
- **`/var` pressure.** Already a report and already correct. Unchanged.

## 3. The two vacuity guards

An empty required set means "always mark good", which is the same defect as the
empty allowlist read from the other side. Both are guarded, and both guards are
reachable — neither is a fabricated seam.

1. **An empty required set is a REFUSAL.** There is no built-in default set to
   fall back to. If `conf_all require` yields nothing the gate fails and says
   so, naming the conf file. This is reachable in production, not only in a
   test: `/etc/mos/health.conf` absent from the overlay, unreadable, or shipped
   with its `require=` lines deleted all produce it. Choosing refusal over a
   compiled-in default is the point — a gate that silently substitutes its own
   criterion when the image did not supply one is a gate whose criterion nobody
   can read off the image.
2. **An unknown member name is a REFUSAL.** `require=mosdd` names nothing the
   gate implements. Tolerating it would silently shrink the required set toward
   empty one typo at a time, which is the empty-set failure arriving by
   instalments. The refusal names the unknown member and lists the vocabulary.

**The same question is asked one layer earlier, against the assembled image.**
`health-gate-required-set-not-empty` in the verify register reads
`/etc/mos/health.conf` out of the packed root and fails a build whose conf has
no `require=` line. The runtime refusal is the right behaviour and the wrong
place to find out: a root whose conf lost its members refuses to mark-good on
every boot, so the slot loses a credit every boot and the device loops, and
nothing about the image looks wrong. Asked here it is a build that fails;
asked on the device it is a fleet. This is the one check the register gains,
and it is why the count moves from 449 to 450.

A third case falls out of the same rule and is stated because it is a change in
behaviour: **a required member the gate cannot probe is a refusal, not a skip.**
`require=apid` with no `apid.service` installed, or with neither `curl` nor
`wget` in the image, means the gate was told to establish something it has no
way to establish. Today that degrades to a logged `SKIP` and a green gate — a
hole the image contract already complains about
(`health-gate-http-client` exists precisely because probe c can silently vanish).
Under a required set the skip is not available: either the member is required
and provable, or the line is not in the conf. An image that ships without apid
is a build decision and drops `require=apid`; an image that ships apid and
forgot `curl` is a build defect, and the contract catches it before the flash.

## 4. What a genuinely broken slot looks like now

The gate must still roll back, or A/B stops meaning anything and a bad update
becomes permanent. Under the new criterion a broken slot is one where **the
device cannot be recovered remotely**, and there are exactly four shapes:

| Shape | Observed as | Why it is unrecoverable |
|---|---|---|
| The boot never finished | `is-system-running` = `maintenance`, or still `starting`/`initializing` after the settle window with jobs other than this gate running | `multi-user.target` was not reached; nothing that could serve a recovery is up |
| The update path is dead | `GetState` does not answer on `com.mos.mosd1` | no bundle can be installed by any route |
| The remote route is dead | `/healthz` does not answer on `127.0.0.1:443` | no bundle can be *delivered* without physical access |
| The slot cannot be identified or confirmed | `rauc status` fails or is unparseable; `rauc status mark-good` fails | the handshake itself is broken |

Two of these are strictly stronger than the sweep they replace, and that is
worth stating plainly: **a wedged mosd and a wedged apid are not failed units.**
A daemon that owns its bus name and stops answering is `active (running)` to
systemd. The old sweep marked that slot good. The required set does not.

Cases driven from the failing side in `tests/health-test.sh` — each asserts exit
1 **and** that `rauc status mark-good` was never called:

- `maintenance` — the boot never finished.
- `starting` with another job still running after the settle window.
- mosd does not answer the bus (`busctl` non-zero) with **no failed unit at
  all** — the wedged-daemon case the sweep could not see.
- apid does not answer `/healthz`, likewise with no failed unit.
- `require=apid` with `apid.service` not installed — the unprovable member.
- `require=` absent entirely — the empty-set refusal.
- `require=` naming a member the gate does not implement.
- The bad-update case as a whole: a slot where every unit is fine and both
  daemons are wedged, asserting the reason names the required member.

And from the passing side, the case that is the point of the change: a failed
unit outside any list, on a slot whose three required members are all up, is
**confirmed** — and the failed unit is reported.

## 5. Where a failed unit surfaces instead

Losing the sweep must not mean nobody learns a unit failed. One surface, wired,
not four described:

**`ReportHealth("units", …)` into mosd's live-state tree at `health.units`.**

- `status` is `degraded` when any unit is failed and `ok` when none is, and
  `detail` carries the count and a bounded sample of the names.
- It reaches an operator three ways with no further work: `GET
  /api/v1/state/health` reads the live-state subtree; the diagnostic snapshot
  carries it under `failures.health` (`docs/design/diagnostics.md` §3 already
  lists *"`health` (the live-state health map)"*); and the journal carries one
  `note:` line per failed unit from the gate itself.
- **No redaction-allowlist change is needed, and that was checked rather than
  assumed.** `pkgs/mosd/apid/src/diagnostics.rs` allows the `health` member as a
  *map* of arbitrary component keys, and `detail` is one of the two field names
  the walker admits under any object. A new component is therefore visible in a
  support bundle the first time it is reported. (This is the one place where the
  usual "a new live-state member is invisible until the allowlist names it"
  hazard does not apply — because `health` was built as an open map on purpose.)
- `degraded` is deliberately the status, and it inherits the existing
  guarantee: `degraded` is not in the reboot gate's `blockingStatuses`, so a
  reported failed unit cannot block a reboot any more than a full `/var` can.

Chosen over the alternatives for one reason each: `GET /api/v1/system/info`
answers a different question (what this device *is*, not how its boot went);
the console is not readable from a fleet; and the support bundle alone would
only ever show units that are *still* failed at collection time, whereas the
gate's report records what the boot itself saw.

Not attempted here, and still owed: `health.boot` after `mark-good`, which is
what lights `validating`/`succeeded` in the update lifecycle
(`docs/design/updates.md` §7). It is a separate line item and this plan does not
take it.

## 6. Blast radius in the contract docs

This changes **when a device rolls back**, so every published claim that a
failed unit rolls the device back is now false and moves with it:

| Document | Claim that becomes false |
|---|---|
| `docs/design/native-applications.md` §6 | *"refuses to confirm the booted slot if any unit is in the failed state and not named in … `tolerate-failed`"*, *"A crash loop after an update rolls the device back"*, *"The allowlist is a build-time decision"* |
| `docs/design/mosd.md` §5 | `MarkUpdate`'s example — *"a failed unit the operator has judged acceptable"* — an operator no longer has to judge that |
| `pkgs/mosd/mosd/src/rauc.rs` module doc | the same example, in the same words |
| `docs/user/applications.md` | the comparison row *"yes — a failed unit fails the health gate"*, and the crash-loop paragraph |
| `docs/user/update-rollback.md` | the health-gate bullet, and the `MarkUpdate` escape-hatch sentence; **plus the zh mirror** |
| `docs/user/troubleshooting.md` | the boot-health bullet; **plus the zh mirror** |
| `docs/bsp/cx3576-bench.md` | the `regdb-loaded` probe's premise — *"`health.conf` tolerates none: on a device this is a health-gate failure and therefore an A/B rollback"* — is exactly the behaviour being removed, and it is the probe the incident came from |
| `rootfs/overlay/etc/systemd/system/mos-seed-var.service` | its comment about *"any unit outside its allowlist"* |

`docs/design/storage.md` (the `/var` reporter), `docs/design/recovery.md` and
`docs/design/updates.md` §1's `health.boot` paragraph state things that remain
true and are left alone.

**Observed and deliberately not changed:** `docs/design/api.md` §2.1 says apid's
proxy does not declare `InstallUpdate`, `GetUpdateState` or `MarkUpdate`. It
does — all three are in `pkgs/mosd/apid/src/bus_client.rs`. That staleness
predates this work and belongs to whoever owns that section; it is recorded here
because §2 of this plan reasons from the true state of that file.

## 7. What only hardware can settle

No board here. Three rows go to `docs/bsp/cx3576-bench.md`, because each needs a
device that has actually booted:

- **`health-required-set` (stage 1 `firstboot`).** The shipped conf's three
  members all pass on a real boot, and `journalctl -u mos-health` says so
  member by member. The negative half is the one that matters: this is the run
  that would expose a member that is required but unprovable on this board.
- **`health-tolerates-failed-unit` (stage 4 `network`).** With
  `mos-regdb-reload.service` failed — the incident's own state — the gate still
  reaches `mark-good`, the boot credit is **not** spent, and `health.units`
  reports `degraded` naming the unit. This is the incident replayed with the
  fix in.
- **`health-rejects-broken-slot` (stage 8 `update`).** The bad bundle stage
  already exists and already needs *"one that installs and fails its health
  gate"*. Under the new criterion that bundle has to break a **required
  member** — the note now says which, because a bundle that merely breaks some
  unit will now boot, confirm, and measure nothing.

## 8. Verification

| What | How | Result |
|---|---|---|
| The gate's behaviour | `tests/health-test.sh` — offline, every external command faked, no host state read or written | 57 checks -> **94**, green |
| The empty-set refusal | three cases: no `require=` line, the conf absent entirely, and an unrecognised member name. Each requires exit 1 with no `mark-good` | green |
| A broken slot still rolls back | `maintenance`, `starting` with another job, mosd wedged, apid wedged, both wedged, and three unprovable-member cases — every one driven from the failing side and asserting no `mark-good` | green |
| Each `require=` line is what makes ITS member fatal | drop `apid`, break apid, require a confirm; drop `boot-settled`, boot to `maintenance`, require a confirm | green |
| The suite | `verify/run.sh` | 1428 -> **1431** tests, green |
| The image contract | `verify/run.sh --verify --board cx3576` | 449 -> **450** checks; see below |
| The docs | `make docs-verify` from a `git archive` into an empty directory | green |

**The one red, and why it is the check working.** The image available on this
host was built from `main` before this change, so its `/etc/mos/health.conf`
carries no `require=` line and
`health-gate-required-set-not-empty` fails on it — which is exactly the
sentence that check exists to print. There is no board here and no way to
rebuild a cx3576 image without contending for the shared deb pool, so the run
is reported as `449/450` with that one named failure rather than hidden. The
check's own verdicts are driven both ways against a fixture root in
`verify/src/checks-system.test.ts`; the first image built from this branch
turns it green.
