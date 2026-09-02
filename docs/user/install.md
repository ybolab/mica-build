# Installation

Installing mos means writing a whole-disk image onto the device's storage. The
image carries every partition — bootloader area, both A/B slots, and fresh
META, STATE and DATA filesystems — so **installation is destructive: it
replaces everything on the target disk**, including any previous
configuration, credentials and application data. There is no in-place upgrade
from a running system into a fresh install; the update path for a device that
already runs mos is [update-rollback.md](update-rollback.md), not this page.

This page is the installation journey per board and profile: choosing the
artifact, verifying it, flashing it, reaching first boot, recognising that it
worked, and getting back to recovery when it did not. It is written against
what this repository can prove. **No installation on this page has been
executed on physical hardware** — the cx3576 dossier carries every
hardware-dependent qualification row as `not tested`, and x64 evidence is QEMU
and CI only. Section 7 states that boundary once more, per step, so a reader
who skims cannot come away believing otherwise.

## 1. Choose the artifact

Three axes, all fixed at build time and none selectable afterwards:

- **Board** — an image is built for exactly one board and does not boot on
  another. Two boards exist: `cx3576` (CX3576-Z, Rockchip RK3576, arm64) and
  `x64` (generic UEFI x86_64).
- **Profile** — `dev` or `prod`, written immutably into the verity root. Both
  ship SSH off; a prod image additionally ships no console shell.
- **Version** — images are named by build epoch. [download.md](download.md)
  owns release selection and what a release consists of.

The artifact you want is `_out/<board>/<board>-mos-<epoch>.img`, or the
`<board>-mos-latest.img` symlink beside it.

> status: board-dependent — evidence: `boards/cx3576/board.env`, `boards/x64/board.env`, `rootfs/packages-src/profile`

## 2. Verify it before you write it

There is no published checksum or signature file for an image today
([download.md](download.md) section 4 states that gap). What exists, and what
you should run, is the image contract check: it opens the assembled image and
asserts the partition table, the slot payloads, the verity parameters and the
trust material check by check, naming what it read and what it expected.

```sh
make os-verify-cx3576                        # cx3576
bash verify/run.sh --verify --board x64      # x64
```

Read the keyring verdict rather than skipping past it. A build that found no
signing material generates a development trust root and the verifier reports
the grade it read; **an image on a development keyring is a bench image and
must not be flashed onto a device that leaves your desk**
(`docs/design/manufacturing.md` section 1 makes that a factory rule).

> status: shipped — evidence: `make os-verify-cx3576`, `verify/run.sh`

## 3. Understand what the write destroys

Before the first byte is written, on any board:

- **Every partition on the target disk is replaced.** Settings, the
  administrator credential, SSH host keys, the device identity and every
  per-device secret live on STATE and are gone. Application data and operator
  files live on DATA and are gone. Update bookkeeping lives on META and is
  gone.
- **The device gets a NEW identity.** Identity is drawn on the device at first
  boot and is never re-issued, so the unit that comes back is a different
  device to anything that names it by `deviceId`
  (`docs/design/manufacturing.md` section 5). Fleet-side records must be
  re-linked by hand.
- **A reflash does not erase.** DATA grew past the image's extent on the
  previous first boot; writing the image back covers only its own extent, so
  blocks beyond it keep their old contents unreferenced by the new
  filesystem. A device being disposed of, resold or returned needs the medium
  destroyed, not reflashed — [recovery.md](recovery.md) section 6 is the
  statement of that rule and this is only the pointer to it.
- **Capture evidence first.** If the device still boots, collect what
  [troubleshooting.md](troubleshooting.md) lists before you flash; the flash
  destroys the fault along with everything else.

> status: shipped — evidence: `docs/design/access.md`, `docs/design/manufacturing.md`

## 4. x64 (generic UEFI)

The x64 image is a plain GPT disk image for any UEFI x86_64 machine. The
firmware finds the ESP and GRUB selects the active slot; there is no
board-side flashing tool, because there is nothing board-specific to flash.

**In QEMU — the tested route.** The harness boots the built image with apid's
HTTPS port forwarded and drives the management API over a real socket. It is
both the supported way to boot an x64 image and the API acceptance suite:

```sh
bash pkgs/mosd/tests/apid-api/run.sh --dry-run   # check preconditions only
bash pkgs/mosd/tests/apid-api/run.sh             # boot and run the suite
```

> status: shipped — evidence: `pkgs/mosd/tests/apid-api/run.sh`, `boards/x64/grub.cfg`

**On a physical UEFI machine.** Boot any live medium on the target, write the
image to the whole disk with a raw-image tool (`dd`, or an equivalent), and
power-cycle into the internal disk. mos configures neither the firmware nor
its boot menu: which device the machine boots, and whether Secure Boot admits
this image, are the platform owner's settings and mos states nothing about
them. **This path has never been run on a physical machine from this tree**;
it is the QEMU route with the medium in a different place, and no dossier
records a unit it worked on.

> status: board-dependent — evidence: `boards/x64/board.env`

## 5. cx3576 (CX3576-Z, Rockchip RK3576)

The cx3576 boots from eMMC and is written over USB through the Rockchip loader
("rockusb") path:

1. **Enter loader mode.** Hold the recovery button while powering on. On a
   board already running mos U-Boot, a boot that finds no usable slot falls
   through to rockusb by itself.
2. **Write the image.** With the board attached over USB, write
   `cx3576-mos-<epoch>.img` to the eMMC with `rkdeveloptool`; the flash
   targets in the BSP Makefile are the driven form of that step.
3. **Power-cycle.** U-Boot starts from sector 64, walks `BOOT_ORDER` with the
   per-slot attempt counters, and boots slot A.

If the loader area itself is unbootable — a board flashed with a pre-A/B image,
or an interrupted loader write — the BootROM presents **maskrom** over USB and
`rkdeveloptool` reflashes from there. That is the path of last resort and it
is also the factory flash path.

Both entries into loader mode exist in the tree and neither has been exercised
on a bench unit as part of an installation: the dossier's Recovery method
section describes them and its qualification matrix carries `Recovery` as
`not tested`.

> status: board-dependent — evidence: `boards/cx3576/bsp/Makefile`, `boards/cx3576/boot.cmd`, `docs/bsp/cx3576-example.md`

## 6. First boot, and what "it worked" looks like

The first boot from an empty STATE does three things without any network:

- **DATA grows to fill the disk.** The image reserves only a small tail;
  `systemd-repart` moves the DATA boundary out and the filesystem grows with
  it. Growth is one-way and nothing shrinks it back.
- **The device provisions itself** — device id, hostname, per-device secrets,
  SSH host keys — all minted on the device, none baked into the image.
  [first-run.md](first-run.md) owns that story, including the offline
  provisioning document that can pre-seed configuration before this step.
- **The health gate runs.** It probes systemd, mosd and apid, and only when
  all pass does it confirm the booted slot and refill its boot credits.

A successful installation is observable, in this order:

| Check | Where | What a good result is |
|---|---|---|
| the bootloader chose a slot | serial console (cx3576) or the attached display (x64) | one `mos: booting slot …` line and no repeated resets |
| the boot was confirmed | `journalctl -u mos-health` | every probe passing, and the confirmation running |
| the device named itself | the DHCP server's lease list, or `hostnamectl` on the console | a hostname of the form `mos-xxxxxxxx` |
| the management plane answers | `https://<address>/api/v1/session` | `state: "setup"` on a device nobody has claimed yet |
| the console is reachable | `https://<address>/_ui/` | the setup screen, behind a self-signed-certificate warning that is expected on a first visit |

A device that keeps resetting instead of settling has not installed: go to
[recovery.md](recovery.md) section 2, which reads that symptom.

> status: shipped — evidence: `make os-repart-test`, `rootfs/overlay/usr/lib/mos/mos-health`, `pkgs/mosd/apid/openapi.json`

## 7. Getting back to recovery, and what is not proven

**The way back in, per board**, is the same transport you installed with, and
it sits below the OS:

- **cx3576** — recovery button at power-on, or the automatic rockusb
  fallthrough when no slot boots; maskrom when the loader area is gone. These
  survive a dead rootfs and a corrupt bootloader environment.
- **x64** — there is no in-band loader mode. The way back is the platform's
  own boot menu and another medium, or the disk in another machine's hand.

**What no step above has ever done on hardware.** The install journey is
written from the tree and from QEMU: the x64 QEMU boot and its API suite run
in CI, the repart growth logic and the U-Boot handshake script each have a
host-side test, and none of those is a flashed unit. No dossier row on any
board records an installation, a first boot or a recovery entry that was
performed on physical hardware. Treat every step on this page as a procedure
to be validated on the first bench unit, and record the result in the board's
dossier (`docs/bsp/qualification.md` row 12 is where a recovery entry lands).

> status: board-dependent — evidence: `docs/bsp/qualification.md`, `docs/bsp/cx3576-example.md`

## 8. Factory-side installation

Injecting configuration at manufacture is not a variant of the steps above: it
is the provisioning document, applied on the first boot after the flash, and
[first-run.md](first-run.md) section 4 owns it. The ownership rules around it
— who mints identity, which records a factory keeps, what happens to a unit
that fails a station — are [manufacturing.md](manufacturing.md).

> status: shipped — evidence: `pkgs/mosd/mosd/src/provisioning_doc.rs`, `docs/design/manufacturing.md`
