# Update and rollback

mos updates are whole-image and transactional: the OS, its services and every
native application are one signed artifact, installed into the inactive A/B
slot while the device keeps running, activated by a reboot, and rolled back
automatically if the new slot cannot prove itself healthy. There is no
on-device package manager and no partial update — that is a design position,
not a missing feature.

Configuration and data are never part of an update: the settings tree lives on
STATE and application data on DATA, and the installer writes only the rootfs
and boot slots ([storage.md](storage.md)).

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
- **The health gate.** On every boot, `mos-health` probes systemd's overall
  state, mosd and apid, and only when all pass runs the confirmation that
  refills the booted slot's credits. On failure it deliberately does nothing:
  no confirmation, no remediation — rollback belongs to the bootloader's
  counters, and a health gate that rebooted the device itself would break that
  contract. Tolerated-failure and threshold policy is a config file,
  `/etc/mos/health.conf`.

> status: shipped — evidence: `make os-bundle-cx3576`, `make os-uboot-handshake-test`, `rootfs/overlay/usr/lib/mos/mos-health`

> status: board-dependent — evidence: `boards/cx3576/boot.cmd`, `boards/x64/grub.cfg`

## 2. Installing an update

The device discovers, downloads, verifies and installs updates itself, and
every step is a route on the management API with the whole state one `GET
/api/v1/update` away. The online sequence:

1. `POST /api/v1/update/check` — the device mirrors the release metadata,
   walks it from a pinned trust anchor, and selects a target compatible with
   this board, profile, channel, settings schema and version, or reports that
   nothing compatible exists. An automatic check runs on an interval (daily by
   default, and disableable); it checks only — nothing is ever fetched or
   installed without an operator asking.
2. `POST /api/v1/update/fetch` — a bounded, resumable download into the
   device's own update workspace on DATA. A partial download stays a partial:
   a bundle becomes installable only once its digest and length match the
   signed metadata and it has been renamed into the verified directory.
3. `POST /api/v1/update/install` — hands the staged bundle to RAUC, which
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

Policy is an operator-edited file on STATE, read fresh on every decision: the
source URL and channel, a byte budget, an online/metered/offline network mode,
the auto-check interval, maintenance windows that gate installs and only
installs, and the reboot gate's ceiling. It **fails closed** — a file that
exists but does not parse refuses every action it could restrict, rather than
becoming "unrestricted" and downloading a bundle over a metered link. A
refusal names the rule that refused it.

The built-in UI carries the same check, fetch and install actions on its
System page.

**What a fielded device still needs before any of that reaches a server.** No
image provisions the pinned trust anchor the client verifies metadata against,
and the shipped policy has no source URL, so a device out of the box fetches
nothing until an operator supplies both. That is the anchor-provisioning
decision [../design/release-signing.md](../design/release-signing.md) records
as open, not a gap in the client.

> status: shipped — evidence: `docs/design/updates.md`, `pkgs/mosd/apid/openapi.json`

For a metered or air-gapped site the offline route is the same verification
with a different transport: `rauc-update import` reads a lockbox from
removable media, walks the same pinned root, and stages the bundle into the
same workspace; the install is then an ordinary install of that path. There is
no flag that skips either check, and the bundle sitting on the media is not an
installable path.

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
  decide — a failed unit an operator has judged acceptable: `POST
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

The named gaps: no production keyring ships in an image yet (a build without
provided material generates a loud development-grade root), there is no
keyring rotation channel on deployed devices, and no image provisions the TUF
root anchor the verifier is meant to start from. See [security.md](security.md).

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
- **The pinned trust anchor and the metadata directory on STATE** are
  provisioning that no image performs, per section 2.

> status: unsupported
