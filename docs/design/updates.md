# Design: updates — lifecycle state, update policy and safe-to-reboot

> Status: the state model, the policy file and the reboot gate below are
> implemented in mosd/apid and unit-tested; the fault-evidence table in §6
> states, per fault, exactly what is proven where and what still needs bench
> hardware. Companions: `release-signing.md` (trust chain and the
> `rauc-update` client), `mosd.md` §5.4 (the bus surface this builds on),
> `api.md` (HTTP conventions), `uboot-ab-handshake.md` (boot credits),
> `../user/update-rollback.md` (the user-facing journey).

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
| `ready` | machine | A verified bundle is staged; `bundle` is the path `rauc-update` printed — the only path this module ever records. |
| `installing` | mirrored | mosd's existing `InstallUpdate` background task is writing the other slot. |
| `failed` | machine | The last check/fetch failed; `reason` carries the client's stderr tail. Cleared when the next operation starts. |
| `reboot-required` | derived | The bootloader's first pick (`primary`) is not the booted slot: an installed, activated bundle awaits its first boot. |
| `validating` | derived | Booted, and the boot health gate has reported this boot as not (yet) confirmed. |
| `succeeded` | derived | Booted, and the boot health gate reported `ok`. |
| `rolled-back` | derived | A slot we are NOT running has `boot-status: bad`: its boot attempts are exhausted, which is what an automatic fallback leaves behind. |

Precedence, written once in `render_entry`: `installing` over a running
client operation over `failed` over `ready` over the derived boot phase over
`idle`.

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
decision with no restart and no reload verb.

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
reserveDir = "/var/lib/mos/update/reserve"
maxBytes = 500000000

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

- **Automatic**: a slot that exhausts its boot attempts falls back by the
  `uboot-ab-handshake.md` contract with no operator action; the state then
  derives `rolled-back` with the failed slot named in the reason.
- **Manual**: `POST /api/v1/update/mark` with
  `{"state": "bad", "slot": "other"}` condemns the other slot;
  `{"state": "good", "slot": "booted"}` is the escape hatch when the health
  gate cannot decide. The vocabulary is deliberately only `good`/`bad` on
  `booted`/`other` — activation is the installer's job. Then reboot.

### 5.3 Offline import (metered/offline sites)

The lockbox (`release-signing.md` §3.2) is the same repository shape on
removable media. On the device (bench shell or SSH):

```sh
rauc-update import --lockbox /media/usb/lockbox \
  --root /usr/share/mos/uptane/root.json \
  --state /var/lib/mos/update/uptane-state.json \
  --reserve-dir /var/lib/mos/update/reserve --max-bytes 500000000
# last stdout line = verified bundle path
```

then `POST /api/v1/update/install` with `{"bundlePath": "<that path>"}` (or
the bus member `InstallUpdate`). The import verifies the same pinned-root
walk as the online path; there is no flag that skips it.

### 5.4 Support data

A support case wants: `GET /api/v1/update` (the whole document — lifecycle
with reasons, policy as loaded, gate verdict, slots, `install`,
`last_mark`), the audit trail (`update-check`/`update-fetch`/
`update-install`/`update-mark`/`update-reboot-override` events with source
addresses), and the journal (mosd logs every admission, refusal, override
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
| Insufficient space | Fetch refused up front when the filesystem visibly cannot hold it; byte budget never exceeded; failure lands as `failed` with the reason | `pkgs/rauc-sign/tests/update.rs` budget suite; failure recording in `update_lifecycle.rs` tests | Filling STATE/reserve on a real board's storage class |
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
- Provisioning of `/var/lib/mos/update/` (mirror, rollback state, reserve)
  on STATE, and the storage-policy decision behind `maxBytes`.
- `mos-health` reporting `health.boot` after its mark-good, which is what
  lights up `validating`/`succeeded` (§1).
