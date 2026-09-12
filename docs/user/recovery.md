# Recovery

Recovery on Mica OS is **data-preserving first**: the steps below are ordered so
that each one costs more than the one above it, and an operator who reaches
step *n* has established that steps 1..*n*-1 were not enough. Working down the
order is the procedure. Skipping to the bottom because it is the step everyone
remembers is how devices lose data they did not have to lose.

The page is also blunt about the gap in the middle of that order: two of the
steps are built, tested, and **cannot be performed on any board that exists
today**. Section 7 says which, and why, and what an operator does instead.

## 1. Automatic trial fallback

A newly activated deployment has three attempts. Firmware persists the attempt
before launching the candidate. The health gate confirms a healthy deployment;
failed trial boots exhaust the candidate and select the retained deployment.
Root, kernel and support references switch together. DATA is shared and is not
rolled back. A hang also needs a functioning watchdog; physical cx3576 watchdog
coverage remains a board qualification requirement.

> status: shipped — evidence: `pkgs/mos-deploy/src/boot.rs`, `rootfs/overlay/usr/lib/mos/mos-health`, `tests/file-ab-x64/updates.sh`

## 2. Exhaustion and shared storage failure

When no deployment remains usable, firmware stops in a defined recovery outcome.
It never refills exhausted counters. cx3576 exposes its local rockusb recovery
transport; the UEFI policy stops with an explicit recovery message. SYSTEM or
DATA mount damage is reported as a shared-storage failure before services start,
not blamed repeatedly on different root images.

Capture the complete serial trace, native status if available, and the exact
image/component IDs. Use a full latest-image reflash when shared storage or every
bootable deployment is unusable. Do not edit counters or import boot commands.

> status: board-dependent — evidence: `boards/cx3576/bsp/uboot/mos-file-boot.c`, `pkgs/mos-boot/systemd-boot-persistence.patch`, `tests/file-ab-x64/faults.sh`

## 3. The decision tree

| # | Step | Available today? | Reversible? | What it costs |
|---|---|---|---|---|
| 1 | read-only diagnosis | yes | yes | nothing |
| 2 | guarded manual rollback | yes | yes | one reboot; the condemned deployment stops being a rollback target |
| 3 | configuration reset | yes | **no** | every modelled setting the tier reaches |
| 4 | application-data reset | yes | **no** | all operator data in `/srv` and every application's data under `/mos` |
| 5 | credential recovery | **no** — unsupported in the field | **no** | the previous credential and every API token |
| 6 | full factory reset | **no** — unsupported in the field | **no** | settings, credentials, applications and operator data together |
| 7 | whole-disk reflash | yes, with physical access | **no** | every partition, **and the device's identity** |
| 8 | secure wipe | **no** — unsupported, and not planned | **terminal** | the device, as a configured unit |

**Five of the eight are steps you can take.** Steps 5 and 6 are gated on a
physical presence assertion that **no shipped board can produce**, so both are
refused on every fielded device; step 8 has no implementation at all. Section 7
states each absence and what to do instead. A device whose operator has lost
the credential and every key is recovered by step 7 and by nothing else.

**The line is between steps 2 and 3.** Everything above it can be undone by
rebooting. Everything below it destroys something that was on the device, and
nothing on this page restores it: there is no backup-and-restore contract in
this product, so an unrecoverable step is unrecoverable in the strongest sense
Mica OS currently offers.

> status: shipped — evidence: `docs/design/recovery.md`

## 4. The reversible steps

### Step 1 — Read-only diagnosis

- **Fixes:** nothing. It decides which step below is the right one, and most
  cases stop here.
- **Costs:** nothing.
- **Does not recover:** a device that does not boot far enough to answer —
  that case is section 2's, not this one.
- **What to read:** `GET /api/v1/update` for the update lifecycle, both deployments,
  the running deployment and whether a rollback is permitted; `GET
  /api/v1/storage/status` for tier readiness and media health; the diagnostics
  snapshot and the audit trail. [troubleshooting.md](troubleshooting.md) is
  the diagnosis page proper.

### Step 2 — Guarded manual rollback

Use authenticated `POST /api/v1/update/rollback` with the required CSRF token.
The native backend validates the running receipt and retained authenticated
fallback. It marks the running deployment failed, changes boot selection, and
returns the running/target identities and explicit reboot next step. A repeat
request or unavailable/invalid fallback is refused with a reason.

The action preserves DATA, including configuration, credentials and application
data. It cannot recover a lost credential or undo persistent writes. Reboot is a
separate action. QEMU covers the real action and subsequent fallback; physical
cx3576 execution remains separately qualified.

> status: shipped — evidence: `pkgs/mos-deploy/src/deployments.rs`, `pkgs/mosd/apid/openapi.json`, `pkgs/mosd/tests/apid-api/src/phases/07-update-rollback.ts`

## 5. The destructive steps: resets and credential recovery

Every step in this section is **irreversible**. Each is requested by name —
there is no parameterless reset — and each is audited. A reset **stages** an
intent and mosd carries it out on the next boot, so the operator's step is two
actions, the request and a reboot, and the device is fully pre-reset until
that boot. An interrupted reset is replayable: the next boot finishes it.

### Step 3 — Configuration reset — IRREVERSIBLE

- **Fixes:** a device made unreachable or unusable by its own network, access
  or policy settings, and any settings state too tangled to unpick.
- **Costs irreversibly:** every modelled setting — network, access, time,
  update policy, application settings, all at once. There is no per-subtree
  reset.
- **Does not recover:** a lost credential (the administrator credential is
  kept on purpose — a settings action that dropped it would be a lockout
  wearing a friendlier name), application data, a broken deployment.
- **How:** `POST /api/v1/reset` with `{"tier": "configuration"}`,
  authenticated, no physical presence needed.

**Read this before you run it: the update settings go back too.** A
configuration reset returns the **update channel** and the **update server
address** to the values your device's image was built with, discarding any
change an operator made. Which is a recovery route or a surprise depending on
what those built-in values are, and there are only two cases:

- **The image names a server.** The device goes back to that server and that
  channel. If somebody re-pointed the device at a server that turned out to
  be wrong, this is how you undo it without a reflash and without physical
  access.
- **The image names no server** — which is the case for a build whose
  integrator left the address to be set later. The reset does not move the
  device to a *different* server; it moves it to **no server**. The device
  stops checking for updates, silently, and the only routes left are the
  offline import and a reflash. **Check `GET /api/v1/provisioning/status`
  before the reset**: it reports the built-in address, the operator's
  override and the effective value separately, so you can see which case you
  are in.

The same applies to Step 6 (full factory reset), which re-seeds everything
this tier re-seeds and more. **Step 4 does not touch these settings** — an
application-data reset leaves the update configuration alone.

**If it is only the address you want back, you do not need this tier.**
`POST /api/v1/update/config` with `{"source": {"url": null}}` returns that one
key to the built-in default and leaves everything else configured — a reset
spends every setting to recover one. See
[update-rollback.md](update-rollback.md).

### Step 4 — Application-data reset — IRREVERSIBLE

- **Fixes:** an application whose own state wedges it or the device, a full
  `/srv`, an application layer to be handed over clean.
- **Costs irreversibly:** **all operator data in `/srv`** and every
  application's data under `/mos`. There is no backup contract to fall back
  on.
- **Does not recover:** platform settings, credentials, deployments.
- **How:** the same route with `{"tier": "application-data"}`, on the same
  terms.

### Step 5 — Credential recovery — IRREVERSIBLE, and not reachable today

- **Fixes:** the lockout of an operator who has lost the administrator
  credential and every authorized key — **without losing a byte of operator
  data.** That is why it is ordered here, above the factory reset: it is the
  only step that cures a lockout while preserving everything.
- **Costs irreversibly:** the previous credential stops working at the moment
  the new one is minted, and every API token goes with it. Any automation
  holding one must be re-enrolled.
- **Does not recover:** the previous secret. The flow **mints and never
  reveals** — nothing on this device will hand a stored password back.
- **How, on paper:** `POST /api/v1/recovery/credential`, authorised by
  physical presence and by nothing else. An authenticated caller is refused
  and told to use `POST /api/v1/actions/change-password` instead.
- **Why you cannot do it:** section 7. The flow is implemented and tested, and
  **no shipped board declares a physical recovery action**, so on a fielded
  device it is refused, every time. Treat it as absent when you plan: an
  operator who has lost the administrator credential and every authorized key
  reflashes the whole disk (step 7) and receives a new device identity.

> status: unsupported

### Step 6 — Full factory reset — IRREVERSIBLE, and not reachable today

- **Fixes:** nothing specific. It is the decision that the device's whole
  mutable state is to be abandoned — decommissioning, handover, or a fault
  that survived steps 3 to 5.
- **Costs irreversibly:** settings, the administrator credential, API tokens,
  every application and all operator data, together.
- **Preserves, by design:** the device identity, calibration data, the update
  metadata in DATA/meta and both retained deployments. A reset resets *state*, not the
  installed software version.
- **Also goes back:** the update channel and the update server address, to
  the values the image was built with — Step 3's warning applies here
  unchanged, including the case where the built-in address is *none* and the
  device is left with no update server at all.
- **Does not recover:** a device that cannot boot, since nothing in-band runs;
  a corrupted deployment.
- **How, on paper:** the reset route with `{"tier": "full-factory"}`, gated on
  the same physical presence as step 5 — and refused for the same reason,
  today, on every board. Plan around its absence: a device that has to be
  handed over clean is reflashed (step 7), and the new identity is the price.

> status: unsupported

### A factory reset does not make a device anonymous

This is the sentence a reader most often supplies for themselves, wrongly, and
getting it wrong ends with a linkable device in somebody else's hands.

**A full factory reset PRESERVES the device's identity and its calibration
data. It does so deliberately.** The `deviceId` is drawn once on the device
and is never re-issued, because re-minting it on a serviceable unit would
silently sever every fleet-side, support-side and warranty record that names
that device — an outcome worse than the lockout the reset was answering. The
device that comes back from a factory reset is the *same device*, with the
same identity, the same hostname derived from it, and the same calibration.
It is not a new unit and it is not an anonymous one.

So a factory reset is **not** a disposal operation. **A device leaving the
operator's control — resale, return, RMA, disposal — needs a whole-disk
reflash, or the medium destroyed.** Only a reflash replaces DATA outright and
so causes a fresh identity to be minted on the next first boot, and only
physical destruction of the medium removes the data: a reflash writes just the
image's own extent, so blocks DATA grew into beyond it survive on the medium,
unreferenced by the new filesystem but present on it. `docs/design/access.md`
section 9.2 is the precise statement of what a reflash does and does not
reach, and `docs/design/manufacturing.md` section 5 is the RMA rule this
follows: a returned device's credentials are treated as exposed from the
moment it is received, because DATA is not encrypted and whoever shipped it
could read it.

If the device is going to another party and its data must not go with it,
destroy the medium. Nothing softer is honest today, and section 6 says why.

> status: shipped — evidence: `pkgs/mosd/mosd/src/reset.rs`, `pkgs/mosd/apid/src/routes.rs`, `docs/design/manufacturing.md`

## 6. Below the OS: reflash and disposal

### Step 7 — Whole-disk reflash — IRREVERSIBLE, and it changes the device's identity

The last resort sits below the OS and is reachable when nothing else is: on
cx3576 the Rockchip loader path (recovery button at power-on, the automatic
fallthrough when boot fails, or maskrom when the loader area itself is gone),
followed by writing the full disk image over USB; on x64, boot another medium
and rewrite the disk. [install.md](install.md) is the procedure.

- **Fixes:** everything software can be wrong with the device, both deployments
  included. It needs nothing on the device to work.
- **Costs irreversibly:** every partition — ESP/FIRMWARE, SYSTEM and DATA — **and the
  device's identity**: the next first boot mints a new `deviceId` and new
  secrets, and fleet-side records naming the old one must be re-linked by
  hand.
- **Does not recover:** nothing software-wise. But note what it does **not**
  do: it does not erase. See the paragraph above and step 8.

> status: board-dependent — evidence: `boards/cx3576/bsp/Makefile`, `docs/design/access.md`

### Step 8 — Secure wipe — TERMINAL, and not implemented

There is no secure wipe on mos. The device cannot express the request: the
reset vocabulary has exactly three tiers and no fourth, so `secure-wipe` is
not a body this device can parse. That absence is the position rather than an
oversight — a wipe promises something about the *medium*, which needs a
device-level erase primitive (eMMC sanitize, NVMe format-NVM) whose real
behaviour on these boards nobody has verified.

**The instruction, until a board has that evidence on file, is to destroy the
medium.** Not reflash it, not fill it with zeros, not run a userspace shredder
over a flash translation layer that was free to write somewhere else.

> status: unsupported

## 7. What an operator cannot do today

Stated rather than omitted, because a reader who assumes these work will plan
a recovery that does not exist.

- **Steps 5 and 6 are refused on every fielded device.** Both are gated on a
  physical-presence assertion. The gate ships and is tested, and so does the
  system side that produces an assertion: a board declares the physical
  recovery actions it has — a bootloader menu entry, a button pattern, a USB
  event — and the device maps the one the operator took into an assertion and,
  where the action says so, a reset tier. **No shipped board declares one** —
  not cx3576, not x64, not virt-arm64 — because none has an implemented
  physical action, so the gate
  refuses every request a fielded device can make of it — `403`, with
  `presence_required`, audited, nothing staged, and the refusal says the board
  declares none rather than that nobody is standing at the device. What closes
  this is board support work on a named board, not a change to the flows.
- **The cx3576 recovery button is not a presence assertion.** It drops the
  board into rockusb loader mode and no software recovery flow reads it. There
  is no button-driven recovery in this product.
- **So an operator locked out today has one answer, and it is step 7.** Losing
  the administrator credential and every authorized key still leaves no
  software path back into the appliance: apid is the only thing that can
  enable SSH, add a key or set a password, and it needs the credential; SSH is
  off or keyless; the serial console shows a login prompt with no account that
  accepts one. That is the position `docs/design/access.md` section 9.1
  records, and it is still the shipped truth on every board. The way back is
  the whole-disk reflash, paying the device's identity for a forgotten
  password.
- **Secure wipe does not exist**, per step 8.
- **There is no repair tier at all, offline or otherwise.** Mica OS has no
  dedicated non-destructive repair operation: no repair route, no repair flow,
  no rescue boot entry and no recovery environment. What exists on a device that
  still boots is the boot-time layout convergence and filesystem check that run
  by themselves, and ordinary verified updates — which can also reinstall a
  unreferenced damaged component. A device that cannot be restored that way needs a
  service host with its filesystems unmounted, or step 7; **Mica OS does not promise
  that damaged data survives either route.**

> status: unsupported

## 8. Before you recover: collect the evidence

If the device still boots into a retained deployment, capture what
[troubleshooting.md](troubleshooting.md) lists — the journal, the update
state, the storage status, and the device identity from
`/usr/share/mos/manifest.tsv` — **before** you reset or reflash. Every step
from 3 down destroys the fault along with the state, and a support case opened
after a reflash has nothing in it. [support.md](support.md) section 4 lists
what a report needs.
