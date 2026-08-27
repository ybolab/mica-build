# RFCT-018 U-Boot A/B handshake contract for a custom mainline U-Boot

- **status**: completed — analysis complete, contract published, user implements outside this repo
- **priority**: P0 (PLAN-010 M4 critical path)
- **owner**: ai-agent
- **createdAt**: 2026-08-18 03:39
- **claimedAt**: 2026-08-18 03:39
- **completedAt**: 2026-08-18 04:20

## Description

Documentation-only task on the M4 critical path. Produce the requirements
contract that the CX3576-Z U-Boot must satisfy so that layout v2, RAUC's `uboot`
bootloader backend, `/etc/fw_env.config` and the dm-verity no-initramfs boot
path all agree.

Deliverable: `docs/design/uboot-ab-handshake.md`. Nothing under `board/` is
created, modified or deleted — the U-Boot tree lives outside this repository and
the user applies the contract there.

Scope covered by the document:

1. Current-state baseline (env storage, boot framework, raw SPL placement).
2. Mainline RK3576 support status and the gaps that remain vendor-only.
3. Storage contract: redundant env pair at the layout-v2 offsets, as a
   paste-able defconfig fragment plus the matching `/etc/fw_env.config`.
4. Environment variable contract against RAUC's actual `uboot` backend.
5. Slot selection: options weighed, `boot.cmd` source, `mkimage` invocation,
   composition with `extlinux.conf`, handoff to RFCT-020's assembler.
6. machine-id persisted through the U-Boot environment (new M4 scope).
7. Kernel command line / dm-verity contract, verified against the 6.1.115 tree.
8. Bring-up checklist, risks, and the condensed requirements summary.

## Decision log

- **2026-08-18 — pivot from patching the shipped U-Boot to a custom mainline
  build.** The user decided not to carry A/B changes as vendor-tree patches. The
  deliverable changed from an escalation diff against `board/cx3576/uboot/` to a
  build-against-it specification. Rationale: the boot chain is the one component
  layout v2 stores as raw sectors outside any A/B slot, so it must be owned and
  versioned deliberately rather than accumulated as patches.
- **2026-08-18 — recorded correction: the tree being replaced is already
  mainline.** `board/cx3576/uboot/Dockerfile:33-34,43,47` clones upstream
  `u-boot/u-boot` at `v2026.07` and builds `generic-rk3576_defconfig`. The only
  vendor content is the `rkbin` DDR/BL31 blobs, one pending rockusb patch and a
  Dockerfile device-tree append. The pivot is therefore much smaller than the
  brief assumed, and the three existing customisations must be carried forward
  rather than dropped.
- **2026-08-18 — recommend slot selection in `boot.scr` (option A), not in
  U-Boot (option B).** Decisive argument: the boot script constructs the
  `dm-mod.create=` verity table, which must be updatable by an OS update and
  rollback-able with its slot. U-Boot is not. `CONFIG_BOOTMETH_RAUC=y` is
  documented as a verified fallback if hush proves fragile on hardware.
- **2026-08-18 — `CONFIG_SQUASHFS_XATTR` dropped from this task.** L1 approved
  and applied it to `board/common/mos-required.fragment` directly.

## Findings that changed the design

- The current build has **no persistent environment at all**
  (`CONFIG_ENV_IS_NOWHERE=y`, reproduced by configuring upstream `v2026.07` with
  the Dockerfile's own `scripts/config` line). This is the single hard blocker
  for M4, not a tuning issue.
- **extlinux is tried before `boot.scr` in both boot frameworks** — bootstd
  orders bootmeths by numbered driver names (`bootmeth_1extlinux` before
  `bootmeth_2script`), and legacy `scan_dev_for_boot` runs
  `scan_dev_for_extlinux` before `scan_dev_for_scripts`. If v2 boot slots keep
  an `extlinux/extlinux.conf`, the A/B handshake is bypassed with no error.
- The env Kconfig symbols named in the task brief (`CONFIG_SYS_REDUNDAND_ENVIRONMENT`,
  `CONFIG_SYS_MMC_ENV_DEV`, `CONFIG_SYS_MMC_ENV_PART`) no longer exist upstream;
  the current names are `CONFIG_ENV_REDUNDANT`, `CONFIG_ENV_MMC_DEVICE_INDEX`,
  `CONFIG_ENV_MMC_EMMC_HW_PARTITION`. The old spellings are silently ignored.
- RAUC stores `BOOT_x_LEFT` in **hexadecimal**; U-Boot's `setexpr` agrees but
  `test -gt` does not. Contained by constraining `boot-attempts` to 1..9.
- `dm-init` resolves `PARTUUID=` through the `name_to_dev_t()` fallback in
  `dm_get_dev_t()`, so layout v2's fixed partition GUIDs can be used directly in
  the verity table. `dm-mod.waitfor=` exists on 6.1.115 and is **required**,
  because eMMC discovery runs from a delayed workqueue that
  `wait_for_device_probe()` does not cover.
- `mkimage -T script` stamps a wall-clock timestamp unless `SOURCE_DATE_EPOCH`
  is set — a determinism trap for RFCT-020's assembler.
- In Debian bookworm `fw_printenv`/`fw_setenv` come from `libubootenv-tool`, not
  `u-boot-tools`, and no `/etc/fw_env.config` is shipped by default.

## Work checklist

- [x] Current-state baseline, evidence-tagged
- [x] Mainline RK3576 support status and gaps
- [x] Storage contract + defconfig fragment + `/etc/fw_env.config`
- [x] Environment variable contract vs RAUC's backend
- [x] Slot selection recommendation + full `boot.cmd` + `mkimage` invocation
- [x] machine-id via U-Boot env (U-Boot side, Linux side, ownership, status)
- [x] dm-verity / cmdline contract verified against 6.1.115
- [x] Bring-up checklist, risks, requirements summary
- [x] Zero changes under `board/`

## Acceptance

- The document specifies the contract precisely enough to build against without
  follow-up questions; every claim is tagged with file+line evidence or marked
  UNVERIFIED.
- Defconfig fragment, `/etc/fw_env.config`, `boot.cmd` and the bootargs
  construction are all present as copy-pasteable blocks.
- On-hardware acceptance is section 8's bring-up checklist. It is the user's
  hardware acceptance and is never claimed done by agents.

## Verification (2026-08-18)

- `git status` shows zero changes under `board/` — only
  `docs/design/uboot-ab-handshake.md` and `docs/task/RFCT-018.md`.
- No source or build files touched, so the v1 image pipeline is unaffected.
- v1 regression green with the prebuilt BSP artifacts:
  `BOARD_DIR=/srv/ai/mos/board/cx3576 make os-image-cx3576 && make os-verify-cx3576`
  → image 372 MiB assembled, `RESULT: PASS (71/71 checks)`. A bare
  `make os-image-cx3576` fails on this worktree because `board/cx3576/out/` is
  not populated here; `BOARD_DIR` points at the prebuilt artifacts, which is the
  fallback the build script itself documents.
- Upstream evidence was gathered read-only outside the repository: U-Boot
  `v2026.07` cloned to a scratch directory and configured in an `ubuntu:24.04`
  container; `armbian/linux-rockchip` `rk-6.1-rkr5.1` files fetched individually;
  Debian `bookworm-slim` containers used for the systemd and `libubootenv-tool`
  facts. Nothing was installed on the host.

## ActiveForm

Specifying the U-Boot A/B handshake contract for the custom mainline build.

## Dependencies

- **blocked by**: RFCT-020 (layout constants file — absent on this base, so the
  document uses the campaign literals and states that it must be regenerated)
- **blocks**: RFCT-020 (assembler must ship `boot.scr` + `mos-verity.env`),
  RFCT-014 (`/etc/fw_env.config`, `libubootenv-tool`, empty `/etc/machine-id`),
  RFCT-015 (machine-id oneshot), and the user's custom U-Boot build
