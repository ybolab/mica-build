# Update and rollback

mos updates are whole-image and transactional: the OS, its services and every
native application are one signed artifact, installed into the inactive A/B
slot while the device keeps running, activated by a reboot, and rolled back
automatically if the new slot cannot prove itself healthy. There is no
on-device package manager and no partial update — that is a design position,
not a missing feature.

Configuration and data are never part of an update: system configuration and
application data live on DATA, while identity and device state remain on STATE.
The installer writes only the rootfs and boot slots ([storage.md](storage.md)).

## 1. The pieces

- **The bundle.** A RAUC update bundle (`.raucb`): the new rootfs (squashfs +
  dm-verity hash tree) and the new boot-slot payload, CMS-signed. The device
  verifies the signature against its keyring before installing. Built by
  `make os-bundle-cx3576` (or `bash build/run.sh --bundle --board x64` for the
  GRUB branch).
- **Slot selection.** On cx3576, U-Boot walks `BOOT_ORDER` with per-slot
  attempt counters in a redundant environment; every boot attempt spends a
  credit *before* the kernel is loaded, so a slot that cannot boot exhausts
  its credits in a bounded number of resets and the bootloader falls back to
  the other slot. The state machine is exercised against a real U-Boot binary
  by `make os-uboot-handshake-test`. On x64, GRUB reads the equivalent state
  from `grubenv` on the ESP.
- **The health gate.** On every boot, `mos-health` asks one question: **can
  this slot be recovered?** It requires a named set — the boot transaction
  finished, mosd answers on the bus, apid answers on HTTPS — and only when all
  of them pass runs the confirmation that refills the booted slot's credits.
  Anything else it sees, including a unit that failed, is **reported and not
  fatal**: a device you can still reach and still update does not get rolled
  into a slot that may not run. On failure it deliberately does nothing: no
  confirmation, no remediation — rollback belongs to the bootloader's counters,
  and a health gate that rebooted the device itself would break that contract.
  The required set and the thresholds are a config file inside the read-only
  root, `/etc/mos/health.conf`; a conf with no required set is refused rather
  than read as "confirm anything".

> status: shipped — evidence: `make os-bundle-cx3576`, `make os-uboot-handshake-test`, `rootfs/overlay/usr/lib/mos/mos-health`

> status: board-dependent — evidence: `boards/cx3576/boot.cmd`, `boards/x64/grub.cfg`

## 2. Installing an update

The device discovers, downloads, verifies and installs updates itself, and
every step is a route on the management API with the whole state one `GET
/api/v1/update` away. The online sequence:

1. `POST /api/v1/update/check` — the device mirrors the release metadata,
   walks it from the trust anchors baked into its own image, and selects a
   target compatible with this board, profile, channel, settings schema and
   version, or reports that nothing compatible exists.
2. `POST /api/v1/update/fetch` — a bounded, resumable download into the
   device's own update workspace on DATA. A partial download stays a partial:
   a bundle becomes installable only once its digest and length match the
   signed metadata and it has been renamed into the verified directory.
3. `POST /api/v1/update/install` with JSON `{}` — hands the staged bundle to RAUC, which
   verifies its CMS signature and writes the inactive slot group. Nothing
   outside the verified directory is an installable path, an operator's
   explicit `bundlePath` included, and the refusal is the same three times
   over.
4. `POST /api/v1/actions/reboot` — activates the new slot. The reboot is
   **refused** while an install is in flight, and while an application has
   reported that it must not be interrupted. Nothing lifts the first; the
   second is lifted by a bounded, self-expiring, audited override, and the
   gate's verdict and reasons are readable before anyone presses the button.
5. The health gate confirms the new slot, or the bootloader rolls back
   (section 3).

### How much the device does on its own

One setting decides, and it has three values:

- **`off`** — the device starts nothing. Every step above still works when an
  operator asks for it.
- **`check`** — the device checks on an interval (daily by default) and does
  nothing else. It never fetches and never installs. This is the default.
- **`auto`** — the device checks, fetches, and **installs inside a
  maintenance window you name**, then either stops and waits for a human to
  reboot, or reboots inside the same window. Which of those two is a separate
  setting and it waits for a human by default.

**`auto` will not run without a maintenance window.** Selecting it with no
window is refused rather than defaulted, because "no window" means "any
time", and for an automatic install that reads as "the moment a bundle
lands". Naming the hour is the point of the mode.

**`auto` never overrides the reboot gate.** If an application has reported
that it must not be interrupted, the automatic path waits — it does not arm
the override, which is a judgement only a person makes. A device that seems
stuck is telling you why: `GET /api/v1/update` carries a `deferred` entry
naming the reason the last automatic attempt did not proceed and how long it
has been waiting.

**A version that failed is not installed again.** If a new slot rolls back,
the device records that version and the automatic path refuses it until an
operator clears the record. You can still install it by hand: the refusal
binds automation, not you.

> status: shipped — evidence: `pkgs/mosd/mosd/src/update_auto.rs`, `docs/design/updates.md`

`auto` has automated state-machine tests. These do not establish real-board
installation, reboot, or power-loss acceptance; that hardware validation remains
separate from the repository test results.

### Where the settings live, and what a reset does to them

Update settings are one JSON document on the device's data partition,
`/mos/config/updates.json`, read fresh on every decision — the source URL and
channel, the mode above, a byte budget, an online/metered/offline network
mode, the check interval, maintenance windows that gate installs and only
installs, and the reboot gate's ceiling. Every value has a **built-in
default baked into the image**, and the document overrides the ones it names.
It **fails closed**: a document that exists and does not parse refuses every
action it could restrict, rather than becoming "unrestricted" and
downloading a bundle over a metered link. A refusal names the rule that
refused it.

**Changing them is `POST /api/v1/update/config`**, authenticated as an
administrator, and the built-in UI's automatic-updates panel is a client of
it. **Send only the keys you are changing** — the route takes a patch, not a
whole document. Sending back what you read would be actively wrong: what you
read is the *resolved* policy, so returning it would freeze the image's
built-in defaults into your own settings and the device would stop following
its image the next time that image changed. To drop an override, send that
key as `null`.

Three ways it can refuse, and they mean different things: **422** your patch
is wrong (an unknown key, a signing key under any name, `auto` with no
window); **409** the document already on the device does not load, so there is
nothing to change and nothing was written; **500** the device could not store
it. A corrupt document is never blindly overwritten — the way out is the
configuration reset that re-seeds it ([recovery.md](recovery.md) Step 3).

`GET /api/v1/provisioning/status` reports the built-in value, your override
and the effective value separately, which is the answer to *why is this
device on that channel*.

**A configuration reset or a factory reset returns all of it to the built-in
defaults** — including the update server address. That is a recovery route
and, where the image names no server, a way to leave a device with no update
server at all; [recovery.md](recovery.md) Step 3 is the full warning and how
to check which case you are in first.

The built-in UI carries the same check, fetch and install actions on its
System page.

**Changing the update server, and what to do when it moves.** The address is
yours to set; what the device will *accept* is not. An authenticated operator
can re-point a device at another server, and no setting, file or API call can
tell a device to trust a different signing key — that rides an image. So when
a server goes away there are three routes back, in order:

1. **Re-point the device** at the new address. No image, no physical access.
2. **Import offline** from removable media (below). No server needed at all.
3. **Reflash.** It also replaces the device's identity, which is why it is
   last ([recovery.md](recovery.md) Step 7).

What is left with no answer is narrow and worth naming: a device **nobody can
authenticate to** — no working credential and no physical access — whose
server has gone away cannot be reached at all. There is deliberately no
remote channel that would fix that.

> status: shipped — evidence: `docs/design/updates.md`, `pkgs/mosd/apid/openapi.json`

For a metered or air-gapped site the offline route is the same verification
with a different transport: `rauc-update import` reads a lockbox from
removable media, walks it from the same baked anchors, and stages the bundle
into the same workspace; the install is then an ordinary install of that path.
There is no flag that skips either check, and the bundle sitting on the media
is not an installable path.

> status: shipped — evidence: `docs/design/updates.md`, `pkgs/rauc-sign/`

## 3. Rollback

- **Automatic.** A slot that fails to boot, or boots but fails the health
  gate, never gets its credits refilled; the next resets exhaust them and the
  bootloader returns to the previous slot. When both slots are exhausted the
  cx3576 bootloader refills all counters and resets — the device keeps
  cycling rather than bricking, and the way out is the recovery path
  ([recovery.md](recovery.md)).
- **Guarded manual rollback.** `POST /api/v1/update/rollback` is for the case
  the automatic path never catches: a slot that boots and then misbehaves. It
  takes no body — the target is not the caller's to name — and it does exactly
  one thing, marking the **booted** slot bad so the bootloader picks the other
  one. It never marks the target, so it cannot confirm a slot no boot has
  verified, and it does not reboot: realising the rollback is a second,
  explicit reboot through the same safe-to-reboot gate.
- **A rollback goes backward, and is refused when that cannot be
  established.** The target must be the strictly *older* of the two installs.
  The refusals are named, so a "no" says which one it is: there is no
  alternate slot to resolve against; the alternate is the booted slot; the
  alternate was never installed; the bootloader has already marked the
  alternate bad; the alternate is *newer* than the running system, which makes
  it a pending or skipped update rather than a rollback target; the two
  install timestamps cannot be ordered; or the booted slot is itself pending
  and unconfirmed, which races the boot credit already being spent. The
  ordering cases fail **closed** on purpose — equal timestamps are the shape
  of a factory flash that wrote both slots at once, where the alternate has
  never run.
- **The raw mark** remains beside it for the case the health gate cannot
  decide — a slot an operator has judged good or bad on evidence the gate does
  not have, such as an application that is up but wrong: `POST
  /api/v1/update/mark` with `good`/`bad` on the booted or the other slot.
  Activation and concrete slot names are refused on both surfaces; activation
  is the installer's job.

The built-in UI's System page carries the rollback action and shows the
guard's verdict and reason.

One cost worth knowing: settings-schema keys that only a newer release
understands are dropped when an older release boots — the settings store
tolerates a newer document by stripping what it does not know. Prefer
confirming or rolling back promptly rather than running the old slot against
new-schema settings for long.

**Unproven on hardware:** that the bootloader then actually falls back is
bench evidence no board has produced. The guard, its refusals and the credit
arithmetic are tested off hardware.

> status: shipped — evidence: `docs/design/uboot-ab-handshake.md`, `pkgs/mosd/mosd/src/rauc.rs`

## 4. What the update trust chain is, and is not

A release is signed twice by two unrelated hierarchies: the RAUC bundle
carries a CMS signature verified on the device against
`/etc/rauc/keyring.pem`, and the TUF repository metadata pins the bundle's
digest, length and verity root hash under four role keys with an offline root.
The device-side verifier of that metadata ships in the image beside the update
client. The ceremonies and custody rules are the signing runbook,
[../design/release-signing.md](../design/release-signing.md).

**Where each anchor comes from.** Both ride the image. The RAUC keyring is
staged into the read-only root at build time; the trusted package signing keys
are baked inline in the same image and the client will read one from nowhere
else — no file to provision, no flag, and no setting an operator or a fleet
could use to name a different key. That is what makes the update *address* an
ordinary setting and the update *trust* not one.

The named gaps: no production keyring ships in an image yet (a build without
provided material generates a loud development-grade root), and there is no
keyring rotation channel on deployed devices, so a compromised signing CA
still needs a reflash. A build given no package signing key bakes an empty
list and says so — such an image can verify no update package at all. See
[security.md](security.md).

> status: shipped — evidence: `docs/design/release-signing.md`, `pkgs/rauc-sign/`

## 5. What is still owed

- **A confirmed boot is not yet reported as one.** The lifecycle derives
  "validating" and "succeeded" from an entry the boot health gate does not
  write yet, so a healthy converged device reads plain `idle` — honest silence
  rather than a guessed success. Confirm an update from the slot list and the
  booted slot instead. The derivation itself is implemented and tested.
- **None of this has run on hardware.** Power loss during a download or an
  install, exhausted boot credits, a real automatic fallback, an incompatible
  bundle refused by RAUC on a mismatched board, filling DATA on a real medium
  — each has an off-hardware test of the logic and no bench run behind it. The
  design record's fault table names, per fault, exactly what is proven where.
- **`auto` has no tests.** The automatic path is implemented and not one line
  of it has been executed by a test, nor run on a board. It is the first
  capability that reboots a device with nobody watching, so this is the item
  on this list with the most behind it — and the reason is now known: the
  driver's timer cannot be advanced in a test at all, so nobody can make it
  take its next step. Fixing that comes before every test in this bullet.
- **How much of the audit trail is proven.** Every update action now carries
  an `actor` naming who took it — `operator` for a human through the API,
  `policy` for the device's own automatic driver, and `device` for what the
  device did that nobody asked for. A test proves the recorder writes
  `policy`; that the automatic driver *reaches* the recorder at each of its
  steps is read from the code, not proven, for the same reason as above. Said
  plainly because this is the field you would rely on during exactly the
  incident it exists for.
- **The metadata directory on STATE** is provisioning no image performs: the
  client's defaults name `/var/lib/mos/update/` for its metadata mirror and
  rollback state and nothing creates it. The trust anchor is no longer on
  this list — it is baked (section 4).

> status: unsupported
