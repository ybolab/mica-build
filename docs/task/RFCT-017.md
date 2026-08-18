# RFCT-017 Image contract verification for layout v2 (cx3576)

- **status**: implementation complete — verifier RED on two REPORTED image defects (not verifier bugs)
- **priority**: P1
- **owner**: ai-agent
- **createdAt**: 2026-08-18 03:39
- **claimedAt**: 2026-08-18 03:39
- **completedAt**: 2026-08-18 10:20

## Description

Extend image contract verification to the layout-v2 A/B image. `os/verify-image.sh`
(v1) stays byte-identical and green; v2 is a sibling script, never a rewrite.

Deliverable: NEW `os/verify-image-v2.sh`, run by the existing
`make os-verify-cx3576-v2` target, defaulting to
`_out/cx3576/cx3576-mos-v2-latest.img` and accepting an explicit image path.

Operational contract, identical to v1: one `PASS:`/`FAIL:` line per check,
dynamic totals, a final `RESULT: PASS|FAIL (n/m checks)`, non-zero exit on any
FAIL, and re-exec into `alpine:3.21` when the host lacks a required tool
(v2 adds `unsquashfs`, `veritysetup`, `setcap`/`getcap`, `mlabel` to v1's set).

**No host mutation.** No loop mounts, no `losetup`, no device-mapper, no
`mount(8)`. GPT is read with sgdisk, the FAT slots with mtools at an offset,
the ext4 partitions by `dd`-extracting them and reading them with
debugfs/tune2fs, and the rootfs by `dd`-extracting the slot and running
`unsquashfs` + `veritysetup verify` — a userspace hash-tree walk that never
opens a dm device.

Every layout constant is read from `os/layout/cx3576-v2.env` (RFCT-020).
Nothing is restated: no GUID, no offset, no size. Unit sets are ENUMERATED
from the image rather than hardcoded, because the hwinit set grows and a
hardcoded list is precisely how a newly added unit falls outside coverage
(`mos-mac` and `mos-gadget` shipped disabled once already for that reason).

## Check inventory — 213 checks

| # | Category | Checks |
|---|---|---|
| 0 | Default path is the `-latest` symlink | 1 |
| 1 | GPT: verify, disk GUID, count, per-partition label/typecode/GUID/size/start/attrs (10 x 6), slot A==B, slot floor, image size formula, DATA last + tail slack | 67 |
| 2 | Raw area: uboot-mos match, debug-variant pairing guard, fits below UENV-A | 3 |
| 3 | Boot slots (factory-scoped where noted): FAT32 sig, volume id, volume label, 4 files present, no extlinux, no initramfs, kernel+dtb byte-compare (x2 slots), plus boot.scr A==B, uImage magic, per-slot PARTUUID, A/B differ only by PARTUUID | 27 |
| 4 | Verity / RO: `veritysetup verify`, hash vs `rootfs-verity.env`, salt, `dm-mod.waitfor=`, squashfs magic + zstd, no ext4 superblock, dm table `ro`, boot.scr root args, ROOTFS-B all-zero | 10 |
| 5 | UENV-A / UENV-B all-zero | 2 |
| 6 | META/STATE/EPHEMERAL/DATA: label, UUID, no `orphan_file`, fs fills partition, `e2fsck -fn`, empty at build (4 x 6) | 24 |
| 7 | Packed rootfs contents (see below) | 79 |

Category 7 covers: squashfs unpack; kernel modules and firmware files/symlinks;
base services (ssh, networkd, DHCP, journald `Storage=volatile`); mosd and webd
(aarch64 ELF, units, enablement, D-Bus policy); board hwinit (`/etc/mos/*.conf`
present, every `mos-*.service` in the image also enabled, `hwinit-*` helpers,
gadget getty udev rule, btattach, patchram symlink, bluez hostname plugin);
and the M4 additions — `rauc`/`fw_setenv`/`fw_printenv`, RAUC `system.conf`
slot PARTUUIDs, statusfile and keyring path, `/etc/fw_env.config`, the health
gate and machine-id oneshots, the `/etc/fstab` storage tiers, `fstrim.timer`,
the repart definition set, the wipe-safety binds and the `/var` fill-up
policies.

### Factory-only scope (amendment)

A RAUC bundle carries ONE boot payload, installed into whichever boot slot is
inactive, so nothing in it can be slot-specific. After the first `rauc install`
the written slot legitimately reads FAT label `BOOT` and volume id `1234ABCD`
(the `mkfs.vfat --invariant` default) instead of the pinned `BOOT-A`/`C3576003`.
That is not a defect: nothing resolves a boot slot by label or volume id
(`boot.cmd` uses `mmc 0:${bootpart}` from the BOOT_ORDER walk), and RAUC writes
partition CONTENTS without touching the GPT, so the PARTLABELs and the pinned
partition GUIDs survive an install and remain the real identity.

The pinned values are still asserted; the checks are simply NAMED `factory: ...`
so the scope is visible in the output. They are deliberately NOT relaxed to
accept both spellings under one name — that would weaken the factory assertion
to buy tolerance nothing currently asks for. Relaxing belongs in a future
`--post-update` mode, which is explicitly not built here.

17 checks carry the `factory:` prefix: both slots' FAT label and volume id,
both slots' kernel/dtb match against the LOCAL BSP artifacts, `boot.scr`
identical across slots, the root hash vs the locally built `rootfs-verity.env`,
ROOTFS-B all-zero, both UENV partitions all-zero, and the four ext4 partitions
being empty at build.

The per-slot verity env files are the counter-example and are asserted
UNCONDITIONALLY: `mos-verity-a.env` and `mos-verity-b.env` are present in a
bundle payload by design — that is precisely why the update path works — so
their presence and their own-PARTUUID contents are not factory-scoped.

### Assertions worth naming explicitly

- **extlinux negative assertion.** Neither boot slot may contain `extlinux/`
  or `extlinux.conf`. Both U-Boot boot frameworks try extlinux BEFORE
  `boot.scr` (RFCT-018), so an extlinux config in a v2 slot silently bypasses
  the entire A/B handshake: `BOOT_ORDER` is never honoured, attempt counters
  are never decremented, rollback never happens — and nothing reports an
  error. The FAIL message says exactly that.
- **U-Boot variant pairing.** The blob at sector 64 must MATCH
  `out/uboot-mos/u-boot-rockchip.bin` and must DIFFER from
  `out/uboot/u-boot-rockchip.bin`. Both halves are asserted: the second is
  what catches a debug blob copied into the uboot-mos directory, which would
  otherwise yield a device that boots, looks healthy and never runs the
  handshake.
- **Verity, end to end.** The root hash, block sizes and hash offset are taken
  from the verity table in BOOT-A's own `mos-verity-a.env` — the table the
  bootloader will actually hand the kernel — and the payload is verified
  against it, then cross-checked against `rootfs-verity.env`. Verifying
  against the shipped table rather than the build-time file is what makes this
  an assertion about the artifact instead of about the build.
- **`dm-mod.waitfor=` is required, not optional** on 6.1.115: `dm_init_init()`
  runs at late_initcall and its `wait_for_device_probe()` does not cover eMMC
  card discovery, so without it verity assembly races the eMMC probe and boot
  is flaky rather than broken.
- **Wipe-safety contract.** `/var` is discardable, so the verifier asserts that
  nothing precious is reachable only from it: `/var/lib/mos` and
  `/var/lib/bluetooth` are enabled STATE-backed binds, and RAUC's `statusfile`
  resolves onto META or STATE. This is the second, independent check —
  `os/rauc/render-config.sh` is the first.
- **repart definition set.** Exactly eight definitions, with the single
  `Weight=1000` on `80-data.conf`. systemd-repart pairs definitions with
  partitions by type UUID in disk order, so a miscount silently attaches
  growth to the wrong partition; EPHEMERAL (`/var`) is fixed at `MOS_VAR_MIB`
  and must not grow.
- **Factory-only FAT labels.** The `BOOT-A`/`BOOT-B` volume-label checks are
  named as factory-image assertions. A RAUC-installed boot slot gets the
  neutral label `BOOT`, and nothing addresses a boot slot by label
  (`boot.scr` uses `mmc 0:${bootpart}`), so asserting it unconditionally would
  fail on exactly the post-update images most worth verifying.
- **RAUC keyring.** Only the `path=/etc/rauc/keyring.pem` line is asserted.
  The keyring is deliberately not shipped and not committed; `rauc install`
  fails closed until one is provisioned, and its absence is not a defect.

## Two integration findings — REPORTED, not fixed

Both were carried over from RFCT-015 as "nobody has verified this end to end".
Both were verified here, both FAIL, and both are defects in producers this task
does not own. `os/verify-image-v2.sh` now asserts them, so
`make os-verify-cx3576-v2` is RED until the owners fix them. That is the
intended outcome: a verifier that stays green on a broken artifact is worthless.

### Finding 1 — `rauc status` cannot identify the booted slot (boot path)

`os/health/mos-health` exits 0 early when it cannot read a booted slot, so the
gate silently no-ops, `rauc status mark-good` is never reached, the installed
slot is never confirmed, and U-Boot rolls back once the boot credits are spent.

rauc 1.8 `get_cmdline_bootname()` (`src/context.c`) reads `/proc/cmdline` and
takes the first of `rauc.external`, `rauc.slot=<x>`, the barebox bootstate
(n/a for `bootloader=uboot`), then `root=<x>`. `determine_slot_states()`
(`src/install.c`) matches that string against each slot's `bootname`, its slot
name, or `realpath(device)`, and errors with "Did not find booted slot" if none
match.

A v2 image boots `root=/dev/dm-0`. That is not a bootname (`A`/`B`), not a slot
name (`rootfs.0`/`rootfs.1`), and not the realpath of any slot device
(`/dev/mmcblk0pN`), so the `root=` fallback cannot work and `rauc.slot=` is
REQUIRED. Neither `os/boot/cx3576-boot.cmd` nor the per-slot verity env sets it.

Reproduced against rauc 1.8 driving the shipped `system.conf`, with a booted
root device matching no configured slot:

```
Error retrieving slot status via D-Bus: error calling D-Bus method
"GetSlotStatus": Failed to determine slot states: Did not find booted slot
(matching '/dev/disk/by-uuid/f1e71289-...')
```

`RAUC_SYSTEM_BOOTED_SLOT` lines emitted: 0.

Fix belongs in the boot path (`os/boot/cx3576-boot.cmd`, RFCT-018): append
`rauc.slot=${bootslot}` to `bootargs`, where `bootslot` is already `A`/`B`.

### Finding 2 — the health gate parses a variable rauc never emits

Independent of finding 1, and it survives fixing it. With a slot that DOES
match the booted root device, `rauc status --output-format=shell` under rauc
1.8 and this `system.conf` emits exactly:

```
RAUC_SYSTEM_COMPATIBLE='mos-cx3576'
RAUC_SYSTEM_VARIANT=''
RAUC_SYSTEM_BOOTED_BOOTNAME='/dev/slotA'
RAUC_SYSTEM_SLOTS='rootfs.1 boot.0 rootfs.0 boot.1'
```

plus per-slot `RAUC_SLOT_STATE_n` (the booted one reads `booted`). There is no
`RAUC_SYSTEM_BOOTED_SLOT` in the output under any configuration — but that is
exactly what `mos-health` greps for:

```
BOOTED=$(run rauc status --output-format=shell 2>/dev/null |
    sed -n 's/^RAUC_SYSTEM_BOOTED_SLOT=//p' | head -n1 | tr -d "\"'")
```

So `BOOTED` is always empty, the gate always logs "rauc reports no booted slot"
and exits 0, and `mark-good` is never reached — even on a correctly booting
device. Fix belongs in `os/health/mos-health` (RFCT-015): read
`RAUC_SYSTEM_BOOTED_BOOTNAME`, or derive the slot from
`RAUC_SLOT_STATE_n='booted'`.

### webd health probe — no longer a gap

The amendment expected the webd probe to SKIP because no HTTP client was in the
rootfs allowlist. That premise is stale on this base: commit `4c1180c` ("ship
curl in the v2 rootfs so the webd health probe stops skipping") added `curl`,
and `/usr/bin/curl` is present in the packed image. The check therefore asserts
the probe is LIVE and FAILS if the HTTP client disappears, rather than passing
either way — shipping curl was a deliberate decision, so losing it is a
regression, not a neutral fact.

## Known limitation — squashfs file capabilities

The requirement was to assert that a file known to carry a file capability
still has its `security.capability` xattr inside the squashfs, proving
`CONFIG_SQUASHFS_XATTR` (added to `board/common/mos-required.fragment`) does
real work. **That assertion cannot currently be made, and is not faked.**

This rootfs's package set installs **zero** files with file capabilities:
`getcap -r` over the packed tree returns nothing, and the
`== file capabilities ==` section of `_out/cx3576/rootfs-report-v2.txt`
(captured by `Dockerfile.v2` from the source tree before packing) is empty.
There is no cap-carrying file whose survival could be demonstrated.

What the verifier asserts instead, named so it cannot be misread:

1. The verification environment can round-trip a `security.capability` xattr
   (`setcap` then `getcap` on a probe file). Without this, an empty result
   would be indistinguishable from an environment that silently drops
   `security.*` xattrs, and the check would pass for the wrong reason.
2. The packed capability set equals the source inventory. Today both are
   empty, and the PASS line says so explicitly rather than claiming
   preservation was demonstrated. It becomes a real tripwire the day a
   cap-carrying package is added.

Two weaker checks were considered and rejected:

- Asserting the squashfs `NO_XATTR` superblock flag is clear. It passes here
  only because this build host runs SELinux, so buildkit labelled the tree and
  mksquashfs stored those labels. On a non-SELinux builder the tree would carry
  no xattrs at all, mksquashfs would set `NO_XATTR`, and the check would fail
  for a reason unrelated to correctness. A host-dependent assertion is worse
  than none.
- Packing a throwaway squashfs containing a cap-carrying file and unpacking it.
  That tests mksquashfs on the verifier's host, not the shipped artifact.

**Follow-up (not actioned — outside this task's scope):** the honest fix is on
the producer side, in `os/rootfs/**`, which belongs to RFCT-013: give the image
a cap-carrying file so the tripwire has something to trip on. A verifier must
not edit what it verifies, so this is recorded rather than implemented.

## Work checklist

- [x] `os/verify-image-v2.sh` — 207 checks, dynamic totals, container re-exec
- [x] GPT / raw / boot-slot / verity / uenv / ext4 / rootfs-content categories
- [x] Negative tests for the verity, extlinux and U-Boot-pairing assertions
- [x] v1 regression green and `os/verify-image.sh` byte-untouched
- [x] Task record

## Acceptance / Verification (2026-08-18)

Built and verified against a real artifact on branch head `8178d57`, with
`BOARD_DIR=/srv/ai/mos/board/cx3576 MOS_ROOTFS_SLOT_MIB=256`:

- `make os-image-cx3576-v2` + `make os-verify-cx3576-v2` —
  **RESULT: FAIL (210/213 checks)**, the three FAILs being the two integration
  findings above (slot A and slot B `rauc.slot=`, plus the `mos-health`
  variable-name mismatch). Every other assertion passes. Before the amendment
  added those three checks the same image scored **PASS (207/207)**. Image 1378877440 bytes (1315 MiB apparent,
  ~161 MiB on disk, sparse); ten partitions; rootfs payload 53 MiB in a pinned
  256 MiB slot; verity root hash
  `5c0b6c7ec07594310502437ebe36dcb33cad7fedca4c9d5fcf851ecd2a030be8`.
- `make os-image-cx3576` + `make os-verify-cx3576` (v1) —
  **RESULT: PASS (88/88 checks)**, matching the current v1 baseline.
  `git diff` reports `os/verify-image.sh` untouched.

Negative tests, each run against a COPY of the image, each cleaned up after:

- **Verity.** One byte flipped 1 MiB into the ROOTFS-A payload →
  `FAIL: ROOTFS-A payload FAILED dm-verity verification against BOOT-A's root
  hash 5c0b6c7e...: Verification failed at position 1048576. Verification of
  data area failed.` → `RESULT: FAIL (175/205 checks)`, exit 1. The corruption
  also cascades into the squashfs content checks, as it should.
- **extlinux.** `::/extlinux/extlinux.conf` injected into BOOT-A →
  `FAIL: BOOT-A contains extlinux (...)` → `RESULT: FAIL (205/206 checks)`.
- **U-Boot pairing.** Debug blob written over sector 64 → both halves fire:
  differs-from-uboot-mos AND identical-to-debug →
  `RESULT: FAIL (204/206 checks)`.

A corrupt image completes the full run and ends in `RESULT: FAIL` rather than
aborting part-way; three `set -o pipefail` traps that would have killed the run
on a damaged or missing file were fixed to that end.

Environment note: on this host `/tmp` is namespaced away from the docker
daemon, so a bind-mounted `$TMPDIR` path is invisible inside the container. The
negative-test copies were therefore staged under `_out/cx3576/negative/` (an
allowed write area, inside the tree the verifier already mounts) and removed
afterwards. Nothing was written outside `_out/` and `$TMPDIR`.

## ActiveForm

Verifying the layout-v2 image contract.

## Dependencies

- **blocked by**: RFCT-020 (layout v2 + assembler), RFCT-013 (squashfs rootfs),
  RFCT-014 (RAUC integration), RFCT-015 (health gate)
- **blocks**: -
