# Installation

Installing mos means writing a whole-disk image onto the device's storage.
The image carries every partition — bootloader area, both A/B slots, and fresh
META, STATE and DATA filesystems — so **installation is destructive: it
replaces everything on the target disk**, including any previous configuration
and data. If the device previously grew its DATA partition, note the disposal
caveat in [recovery.md](recovery.md) before handing the hardware on.

How the image reaches the disk is a board fact. The two shipped boards are
covered below; integrators bringing up their own hardware should start from
the porting manual at [../bsp/porting.md](../bsp/porting.md) and the board
contract in [../design/boards.md](../design/boards.md).

## 1. x64 (generic UEFI)

The x64 image is a plain GPT disk image for any UEFI x86_64 machine. Write it
to the target disk with any raw-image tool (for example `dd` from a live
system), or boot it directly in QEMU — the QEMU route in
[quickstart.md](quickstart.md) is the tested one. The firmware finds the ESP
and GRUB selects the active slot; there is no board-side flashing tool because
there is nothing board-specific to flash.

> status: board-dependent — evidence: `boards/x64/board.env`, `boards/x64/grub.cfg`

## 2. cx3576 (CX3576-Z, Rockchip RK3576)

The cx3576 boots from eMMC, and the image is written over USB using the
Rockchip loader ("rockusb") path:

1. Put the board into loader mode — hold the recovery button while powering
   on, or, on a device that already runs mos U-Boot, boot failure falls
   through to rockusb automatically.
2. With the board connected over USB, write `cx3576-mos-<epoch>.img` to the
   eMMC using the Rockchip host flashing tools.
3. Power-cycle. U-Boot starts from sector 64, runs the A/B boot script, and
   boots slot A.

This same path is the board's last-resort recovery: it sits below the OS and
is reachable when nothing else is. A board previously flashed with a pre-A/B
image may need a maskrom-level reflash once; the bring-up notes in
[../design/uboot-ab-handshake.md](../design/uboot-ab-handshake.md) cover that
case.

> status: board-dependent — evidence: `boards/cx3576/board.env`, `docs/design/uboot-ab-handshake.md`

## 3. What the first boot after flashing does

- **DATA grows to fill the disk.** The image reserves only a small tail;
  `systemd-repart` moves the DATA partition boundary out on first boot and the
  filesystem grows with it. This is exercised by a dedicated test
  (`make os-repart-test`) precisely because growth must never touch the
  bootloader area.
- **The device provisions itself** — identity, hostname, per-device secrets,
  SSH host keys — with no network required. [first-run.md](first-run.md) owns
  that story.

> status: shipped — evidence: `make os-repart-test`, `docs/design/provisioning.md`

## 4. What is not there yet

A single verified customer installation journey per released board/profile —
prerequisites, media selection and verification, status indications, and the
documented return path to recovery, as one tested procedure — is planned but
not shipped; the steps above are the current supported mechanics, not that
finished journey. Factory-side installation (pre-provisioned images, injected
configuration) is part of the same plan.

> status: proposed — evidence: `docs/plan/PLAN-046.md`

TODO(PLAN-046): revisit after this plan merges
