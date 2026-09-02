# Design: updates — lifecycle state, update policy and safe-to-reboot

> Status: the state model, the policy file, the `/mos/updates` workspace
> contract with its readiness probe, and the reboot gate below are
> implemented in mosd/apid/`rauc-update` and unit-tested; the fault-evidence
> table in §6 states, per fault, exactly what is proven where and what still
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

## 2. The policy file

Policy lives in `update-policy.toml` beside the settings store on STATE
(default `/var/lib/mos/update-policy.toml`; `MOSD_UPDATE_POLICY_PATH`
overrides, and tests point it into a tempdir). It is operator-edited and
read fresh on every policy decision, so an edit takes effect on the next
decision with no restart and no reload verb. STATE is the right tier for
it: PLAN-061 keeps small authoritative metadata on STATE and sends only
large bytes to `/mos`, and a few hundred bytes of policy whose loss would
make the workspace ambiguous is exactly that. Where bundles are staged is
not a policy key at all — the workspace is `/mos/updates` (§1.1) and there
is no setting that could point it elsewhere.

**Why not the settings tree.** Settings keys would mean a schema bump plus a
migration, and a concurrent workstream owns the next bump — two bumpers
hand the merge an unresolvable version conflict. The file is the least
invasive storage that exists today; folding these keys into the settings
tree later (one additive bump, one migration, the file retired) is a
straightforward follow-up and is deliberately not done here.

**Fail-closed.** A missing file is the default policy. A file that exists
but does not parse or validate is NOT the default policy: every action the
policy could restrict (`check`, `fetch`, `install`) is refused with a
reason naming the file until it is fixed, because "unreadable" silently
becoming "unrestricted" is how a metered device downloads a 500 MB bundle.
The reboot gate keeps evaluating with defaults — failing closed there would
let a typo brick the reboot button.

The full document, with its defaults:

```toml
[source]
# url has no default; unset = no online source, check/fetch refused,
# the offline import path (§5.3) remains.
url = "http://mirror.example/tuf"
channel = "stable"
repoDir = "/var/lib/mos/update/tuf-mirror"
rootPath = "/usr/share/mos/uptane/root.json"
statePath = "/var/lib/mos/update/uptane-state.json"
maxBytes = 500000000            # budget for /mos/updates as a whole (§1.1)

[network]
mode = "online"              # online | metered | offline
meteredAllowsFetch = false

[autoCheck]
intervalMinutes = 1440       # 0 disables; checks only, never fetch/install

[[maintenance.windows]]      # zero windows = installs any time
days = ["mon", "thu"]        # empty/omitted = every day
start = "02:00"              # HH:MM, UTC
end = "04:00"                # end <= start wraps past midnight

[rebootGate]
blockingStatuses = ["blocking"]
overrideMaxSeconds = 3600    # capped at 3600 whatever the file says
```

Unknown keys are load errors (`deny_unknown_fields`), so a typo fails
loudly instead of configuring nothing.

## 3. What each policy gates

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
- **Auto-check** runs `check` every `intervalMinutes` (default daily,
  `0` disables), production only, subject to the same policy refusals.
  Checks only — nothing is ever fetched or installed automatically; both
  stay operator actions behind their own gates.

Policy refusals cross the bus as `AccessDenied` and reach HTTP as **409**
`policy_refused` with the refusing rule in the message.

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
pure function over the slot list and the primary slot. Its central rule is
that **a rollback goes backward**: the target must be the strictly OLDER of
the two installs, by `installed.timestamp`.

That rule is how `recovery.md` §3 node 2's precondition — "the other slot
holds a system that booted successfully before" — is enforced, by DERIVATION
rather than by reading it. The property is not observable directly: RAUC v1.13
(pinned in `pkgs/rauc/versions.env`) persists no mark history — its slot status
file holds bundle metadata, an install-progress `status`, a checksum and
`installed.*`/`activated.*`, `mark-good` writes none of it, and `boot-status`
over D-Bus is the attempt counter read as exhausted-or-not. What makes the
derivation valid is RAUC's invariant that **an install never writes the running
slot**: a booted slot installed after the target means the device was running
the target at that moment. **If that invariant ever stops holding — a future
install path able to target the booted slot, or an out-of-band flash that also
rewrites `installed.timestamp` — the derivation does not**, and nothing in this
tree goes red, because the invariant is RAUC's and not ours.

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
| `install_order_unknown` | the two install timestamps cannot be ordered (one absent, one unparseable, or equal), so nothing establishes that the alternate is the older system. Equal stamps are the shape of a factory flash that wrote both slots at once, where the alternate has never run. The guard fails CLOSED here on purpose: it refuses a rollback it cannot justify rather than permitting one |
| `booted_slot_not_confirmed` | the booted slot is itself pending-not-confirmed; that window belongs to the attempt counter, and a manual rollback inside it races the boot credit already being spent |

The install-order rule is also only as good as the clock at install time. Time
is UTC everywhere (`docs/design/time.md`), but a device that installed with a
wrong clock can record an order that did not happen. Closing either gap needs
mosd to record its own confirmed-boot fact; that is a separate design and is
named here rather than approximated.

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
  --root /usr/share/mos/uptane/root.json \
  --state /var/lib/mos/update/uptane-state.json \
  --max-bytes 500000000
# last stdout line = verified bundle path, /mos/updates/verified/<name>
# exit 3 = the workspace is not ready; the line names the status and kind
```

then `POST /api/v1/update/install` with `{"bundlePath": "<that path>"}` (or
the bus member `InstallUpdate`). The import verifies the same pinned-root
walk as the online path and stages through the same workspace (§1.1); there
is no flag that skips either, and the bundle on the media itself is not an
installable path.

### 5.4 Support data

A support case wants: `GET /api/v1/update` (the whole document — lifecycle
with reasons, policy as loaded, gate verdict, slots, `install`,
`last_mark`), the audit trail (`update-check`/`update-fetch`/
`update-install`/`update-mark`/`update-rollback`/`update-reboot-override`
events with source addresses; `update-rollback` records the refusal and its
reason as well as the applied rollback, because the guard refuses inside apid
and nothing else would witness it), and the journal (mosd logs every admission, refusal, override
and outcome; the client's stderr tail is in `lifecycle.reason`).

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

## 7. Deployment contract still owed (outside this slice)

- `/usr/bin/rauc-update` in the image (a parallel subtask ships it; its
  absence is reported per §1).
- `/usr/share/mos/release-identity.env` (`BOARD=`/`PROFILE=`/`VERSION=`)
  and the pinned trust anchor at `/usr/share/mos/uptane/root.json` —
  `release-signing.md` records the anchor-provisioning decision as open.
- Provisioning of `/var/lib/mos/update/` (metadata mirror, rollback state)
  on STATE. The workspace itself is provisioned: `mos-data-layout` creates
  `/mos/updates/{downloads,verified,staging}` on DATA (PLAN-063). The quota
  behind `maxBytes` stays PLAN-049's.
- `mos-health` reporting `health.boot` after its mark-good, which is what
  lights up `validating`/`succeeded` (§1).
