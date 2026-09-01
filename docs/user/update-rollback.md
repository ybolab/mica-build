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

## 2. Installing an update today

The honest scope first: **the device does not fetch updates.** There is no
update-discovery client, no channel subscription, and no check/apply control
in the UI or the HTTP API. What ships is the installation half:

1. The bundle is placed on the device by the integrator's own means (over
   SSH, or by an application).
2. The management daemon's `InstallUpdate` operation hands the bundle to
   RAUC, which verifies the signature and writes the inactive slot group;
   installation state, per-slot status and errors are observable in the
   device's live state.
3. A reboot boots the new slot. The health gate confirms it, or the
   bootloader rolls back to the previous slot after the failed attempts.

The update flow — what triggers it, what verifies it, what confirms it — is
recorded in [../design/remote-management.md](../design/remote-management.md);
whatever future trigger lands converges on this same verified path.

> status: shipped — evidence: `pkgs/mosd/mosd/`, `docs/design/remote-management.md`

## 3. Rollback

- **Automatic.** A slot that fails to boot, or boots but fails the health
  gate, never gets its credits refilled; the next resets exhaust them and the
  bootloader returns to the previous slot. When both slots are exhausted the
  cx3576 bootloader refills all counters and resets — the device keeps
  cycling rather than bricking, and the way out is the recovery path
  ([recovery.md](recovery.md)).
- **Manual.** The management daemon exposes a guarded manual mark operation
  (`good`/`bad` on the booted or other slot) for the case the health gate
  cannot decide — for example a failed unit an operator has judged
  acceptable. It is a local administrative action; there is no rollback button
  in the UI today.

One cost worth knowing: settings-schema keys that only a newer release
understands are dropped when an older release boots — the settings store
tolerates a newer document by stripping what it does not know. Prefer
confirming or rolling back promptly rather than running the old slot against
new-schema settings for long.

> status: shipped — evidence: `docs/design/uboot-ab-handshake.md`, `docs/design/mosd.md`

## 4. What the update trust chain is, and is not

A release is signed twice by two unrelated hierarchies: the RAUC bundle
carries a CMS signature verified on the device against
`/etc/rauc/keyring.pem`, and the host-side TUF repository metadata pins the
bundle's digest, length and verity root hash under four role keys with an
offline root. The ceremonies and custody rules are the signing runbook,
[../design/release-signing.md](../design/release-signing.md).

The named gaps: no production keyring ships in an image yet (a build without
provided material generates a loud development-grade root), there is no
keyring rotation channel on deployed devices, and nothing ships the TUF
verifier to devices. See [security.md](security.md).

> status: shipped — evidence: `docs/design/release-signing.md`, `pkgs/rauc-sign/`

## 5. The rest of the update story

Discovery, authenticated resumable download, compatibility gating against
release metadata, maintenance windows, a safe-to-reboot interlock, and
explicit update states in the API and UI are planned as the authenticated
system updates work, on top of the shipped install path.

> status: proposed — evidence: `docs/plan/PLAN-047.md`

TODO(PLAN-047): revisit after this plan merges
