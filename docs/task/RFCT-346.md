# RFCT-346 PLAN-086 S1 and S4: the runtime baseline, and no static hwdb

- **status**: completed
- **priority**: P1
- **owner**: bkd/a81x79du
- **createdAt**: 2026-09-07 21:00

> `docs/plan/index.md`, `docs/task/index.md` and `docs/changelog.md` are L1's and
> this branch does not touch them. `docs/plan/PLAN-086.md` IS edited here:
> recording what a slice shipped is part of the slice.

## Description

PLAN-086 was approved on 2026-09-07 and dispatched as two tranches. This is the
first: **S1**, the baseline every later slice states its result against, and
**S4**, the removal of the static hardware database.

The order is the argument. S2 strips debug sections and S3 selects an explicit
runtime; both are claims of the form "N MiB smaller", and there is nothing to
subtract from until S1 exists. S4 is in this tranche rather than the next
because its 22 MiB is removed by EXCLUSION -- no shipped binary changes -- so it
can be measured against S1 without waiting for anything S2 does.

## ActiveForm

Measuring the root that ships, then taking the hardware database out of it

## Dependencies

- **blocked by**: (none)
- **blocks**: PLAN-086 S2, S3, S5, S6 -- each states its result as a delta
  against the S1 baseline now in `docs/plan/PLAN-086.md`

## S1: the baseline

`tools/measure-rootfs.sh --board <board>` reads `_out/<board>/factory-root.oci`
-- the packed root the build exports, which is the byte-for-byte input to
mksquashfs -- and counts each inode once. The table is in PLAN-086 under
"S1 baseline, measured 2026-09-07". Four findings that change what a later slice
should expect:

1. **No hard links exist in either root.** Deduplicated and naive sums are equal
   to the byte, so "counting hard links once" is a guard rather than a
   correction, and no future saving may be attributed to link accounting.
2. **The 42.73 MiB of user-space debug data is 13 files, the same 13 on both
   arm64 boards** -- podman (19,305,340 B), netavark, apid, mosd, crun,
   mos-mqttd, mos-mqtt-broker, rauc-update and five more, all built here. The
   other 1,009 user-space ELF files carry zero; Debian ships stripped. The
   identical totals on two different roots looked like a measurement error and
   were broken open rather than trusted: the per-file lists are equal, while the
   kernel-module symbol totals differ by 14x (736,766 vs 10,854,802 bytes), so
   the scan does distinguish the trees.
3. **The plan's cx3576 column reproduces within 0.1% on every row.** The
   residuals -- payload +0.31 MiB, squashfs +104 KiB, image +1 MiB -- are the
   kernel RFCT-343 landed after that measurement; the image moves a whole MiB
   because the pack pads to a MiB boundary and the squashfs crossed one.
4. **The x64 column is not reproduced.** `snapshot.debian.org` answered HTTP 503
   for the whole amd64 base cache throughout, so no x64 root could be composed.
   virt-arm64 is measured in its place and its package counts match the x64
   column's 159/13, but it is a different architecture and not a substitute.

## S4: what was removed, and what was kept

`rootfs/scripts/hwdb-remove.sh`, called from `90-pack.Dockerfile`'s `closed`
stage -- before the package-manager purge, and before `TOTAL_MB` is measured, so
the build report weighs the root that ships.

| Removed | cx3576 | virt-arm64 |
|---|---:|---:|
| `/usr/lib/udev/hwdb.bin` | 13,519,639 B | 13,519,639 B |
| `.hwdb` source files under both `hwdb.d` trees | 34 files, 9,344,101 B | same |
| `/usr/bin/systemd-hwdb` | 67,896 B | same |
| `systemd-hwdb-update.service` + its `sysinit.target.wants` link | 2 paths | 2 paths |
| `IMPORT{builtin}="hwdb ..."` clauses | 33, in 13 files | same |
| `ENV{.HAVE_HWDB_PROPERTIES}="1"` assignments | 4, in 60-evdev.rules | same |
| Rules left with no action at all, dropped | 14 | 14 |
| **Rule FILES deleted** | **0** (41 ship) | **0** (42 ship) |

The edits are token-level: a logical rule is split on its top-level commas, the
hwdb tokens are dropped, and a rule that lost nothing is written back byte for
byte. The private flag goes with the query because 60-evdev.rules sets it in the
same rule as each import and gates `IMPORT{builtin}="keyboard"` on it -- removing
only the imports would leave that flag set unconditionally and turn a dead path
back on. Its `=="1"` consumer is deliberately left in place: nothing sets the
property, so it never fires, which is exactly its behaviour on a root whose
hwdb.bin is missing.

`systemd-udevd.service`'s `After=systemd-sysusers.service
systemd-hwdb-update.service` loses only the second name. systemd drops an
ordering onto a missing unit in silence, so the difference between "no
reference" and "an ineffective reference" is visible nowhere else.

**The update unit is not dead weight -- the removal ARMS it.** Its conditions
include `ConditionPathExists=|!/usr/lib/udev/hwdb.bin`, so deleting the database
is precisely what makes it stop being skipped and start running `systemd-hwdb
update` against a read-only `/usr` on every boot. Removing the data without the
unit is worse than removing neither.

### Size

| | cx3576 | virt-arm64 |
|---|---:|---:|
| Payload, before -> after | 367.66 -> 345.79 MiB | 415.42 -> 393.55 MiB |
| Payload delta, bytes | -22,935,607 | -22,935,607 |
| Regular files | 3,145 -> 3,108 | 4,068 -> 4,031 |
| Squashfs bytes | 118,685,696 -> 115,187,712 | 127,582,208 -> 124,088,320 |
| Rootfs image bytes | 120,586,240 -> 116,391,936 | 128,974,848 -> 125,829,120 |
| `TOTAL_MB` | 380 -> 358 | 430 -> 408 |
| Kernel module indexes | 333,062 (unchanged) | 2,476,993 (unchanged) |

The 37 files and 22,935,607 bytes account exactly: 34 sources + `hwdb.bin` +
`systemd-hwdb` + the unit file. Compressed, that is 3.34 MiB of squashfs.

### The image contract

`verify/src/checks-hwdb.ts` adds four checks, each reporting the size of the
space it searched, with 28 negative tests in `checks-hwdb.test.ts`:

- `packed-hwdb-absent` -- no database, no sources, no tool, and no stray `.hwdb`
  anywhere under `/usr/lib/udev` or `/etc/udev`; refuses to conclude on a root
  with no udev rules or no udevd.
- `packed-hwdb-update-machinery-absent` -- no unit, no enablement link, and no
  `After=`/`Wants=`/`Requires=` naming it; refuses to conclude if its walk never
  reached `systemd-udevd.service`.
- `packed-udev-rules-query-no-hwdb` -- no hwdb import and no flag assignment;
  refuses to conclude if the same scan finds zero `IMPORT{builtin}` clauses of
  any kind, which is what a parser regression looks like.
- `packed-udev-actions-survived-hwdb-removal` -- 15 named actions across 10 rule
  files, covering the four categories the plan lists. Two of those files never
  held an hwdb clause (`80-drivers.rules`, `99-systemd.rules`), because a
  transform pointed at the wrong file is invisible to the edited set.

**Driven red, not asserted green.** On the pre-removal image three of the four
go red naming exact bytes; the fourth passes, correctly, because the actions are
all there. `_out/evidence-verify-cx3576-baseline.log` is that run.

| Board | before | after |
|---|---:|---:|
| cx3576 | 419/419 | **423/423** |
| virt-arm64 | **314/314** | **318/318** |

The rise is +4 on each board, one per check, measured by unregistering the
family and re-running against the same images. **The task's stated virt-arm64
figure of 313 is one short of what this tree produces**: 314 is the pre-change
number here, green, with the family unregistered.

## The boot: what the guest actually looks like

`MOS_BOARD=virt-arm64 bash pkgs/mosd/tests/apid-api/run.sh`, twice -- once on the
image with the database and once on the image without it -- with a throwaway
device-state probe appended to the guest script for both runs and reverted
after. `_out/evidence-console-{baseline,post}-virt-arm64.log`.

apid reached `APID_LISTENING https=0.0.0.0:443 http=0.0.0.0:80` 80 s into the
boot with the database gone. `udevadm trigger --action=add` followed by
`udevadm settle` returned 0, so every device was re-processed through the rules
that survived.

**Every device-state line is identical between the two boots except two
strings.** Interfaces `lo eth0 wg-e2e0`; block devices `vda vda1..vda9 dm-0`;
7 `/dev/disk/by-uuid` links, 9 by-partuuid, 21 by-path; `/dev/ptmx` and
`/dev/tty` `crw-rw-rw- root:tty`; `/dev/vda` `brw-rw---- root:disk`;
`/dev/loop-control` `root:disk` and `/dev/net/tun` 0666 as static nodes; a
hot-plugged `/dev/loop0` arriving `brw-rw---- root:disk`.

The one difference, on the only real NIC:

```
before: ... ID_MODEL_ID=0x1000 ID_VENDOR_FROM_DATABASE=Red Hat, Inc.
            ID_MODEL_FROM_DATABASE=Virtio network device
            ID_NET_NAME_MAC=enx525400123456 ID_NET_NAME_PATH=enp0s2
            ID_PATH=pci-0000:00:02.0 ID_NET_LINK_FILE=.../99-default.link
            ID_NET_NAME=eth0
after:  ... ID_MODEL_ID=0x1000
            ID_NET_NAME_MAC=enx525400123456 ID_NET_NAME_PATH=enp0s2
            ID_PATH=pci-0000:00:02.0 ID_NET_LINK_FILE=.../99-default.link
            ID_NET_NAME=eth0
```

Two descriptive strings, and nothing else. `net_id` still runs and still
computes every candidate name; `ID_NET_NAME_FROM_DATABASE` -- the one hwdb
property that *would* feed naming, through `NamePolicy=... database ...` in
99-default.link -- never appears on either side, because the only entry for it
in the shipped sources is a Dell iDRAC virtual NIC. Every mos board additionally
boots `net.ifnames=0`, which disables the NamePolicy path before hwdb is
consulted at all. So no board-specific rule was needed: there was no
board-specific property to preserve.

Two limits, stated rather than smoothed over:

- **The net-hotplug case did not run.** `ip link add ... type dummy` failed with
  "Device does not exist" -- this kernel has no dummy driver. Block hotplug was
  exercised instead and passed. The whole-database counters at the end of the
  probe (`FROM_DATABASE` occurrences across all devices) were not captured
  either: the probe's output stopped after the hotplug case on both runs.
- **The API suite is red on virt-arm64, before and after, and it is not this
  change.** The baseline image fails all three "parallel enable ... reported as
  succeeded" checks; the post-removal image fails one of the same three. The
  task record reads `container: systemd manager method GetUnitFileState did not
  answer within 5s` -- a D-Bus timeout on a TCG-emulated guest. Everything else
  passes on both.

## Acceptance

- [x] S1 baseline, reproducible by a reader, with the plan's table confirmed
      (cx3576, within 0.1%) or corrected. x64 recorded outstanding with cause.
- [x] S4: no static hwdb in the image, asserted by four checks in the image
      contract and driven red on the pre-removal image.
- [x] `--verify` at 423/423 (cx3576) and 318/318 (virt-arm64), the +4 attributed.
- [x] One board booted with the database gone; guest device state reported and
      diffed against the same board with it.
- [x] `make docs-verify` green from a `git archive` into an empty directory.
- [ ] **Physical cx3576 acceptance: OUTSTANDING.** virt-arm64 is a different
      board on a different kernel (6.12.107 mainline against cx3576's 6.1.115
      vendor tree), and PLAN-085's transfer boundary says driver and boot-chain
      behaviour does not carry. A green virt-arm64 boot is evidence about
      virt-arm64.

## Out of scope, and touched anyway

Two hard-coded `x64`s blocked booting any other board, both left behind by
PLAN-085 slice 5's board parameterisation of `run.sh`:

- `tools/qemu-seed-state.sh` resolved `_out/x64` and `boards/x64/board.env`
  unconditionally, so `MOS_BOARD=virt-arm64` seeded the x64 disk -- at another
  board's STATE offsets -- and the phase that reads the guest script's console
  lines would have reported "the smoke never ran".
- `run.sh`'s `qemu_port()` never passed `MOS_BOARD` into the engine container,
  so `src/qemu.ts` took its own `?? "x64"` default and refused with
  "_out/x64/x64-mos-latest.img not found" on a run that had already passed its
  "image present" precondition for the board actually asked for.

Both are one-line resolutions of a value the surrounding code already claims to
resolve. Without them no board but x64 can be booted, and x64 was unbuildable
here.
