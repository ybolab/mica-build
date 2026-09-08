# PLAN-922 Adapt s905x5m to the current mainline contracts

- **status**: completed
- **createdAt**: 2026-09-08 04:32 UTC
- **approvedAt**: 2026-09-08 04:39 UTC
- **completedAt**: 2026-09-08 07:10 UTC
- **relatedTask**: RFCT-942

## Context

### Revisions and integration preview

- Source: `board/s905x5m` / `origin/board/s905x5m` at
  `e53c1cfd`, including RFCT-941's installer-receipt fix.
- Target: `origin/main` at `1d2a5e49`, fetched on 2026-09-08.
- Refreshed target during implementation: `09c384cd`, fetched on 2026-09-08.
  This adds cx3576 boot payload digest checks and their shared bundle/verifier
  consumers. The final port retains those checks and keeps digest generation
  conditional on the board declaring that boot protocol.
- Common ancestor: `15e87d66`. Mainline has 822 unique commits and the
  board branch has 124; this is a larger divergence than the most recent
  fetch's 64 commits relative to the local `main` branch.
- `git merge-tree --write-tree origin/main HEAD` exits 1 and records 94
  conflict messages: 36 content, 38 file location, 19 modify/delete, and one
  add/add. It does not change the index or working tree. The complete preview
  is in `tmp/s905x5m-mainline-merge-tree-20260908.txt`.
- A detached mainline checkout is available at
  `/workspace/miehq/worktrees/mos-mainline-review-20260908` for comparison.

### Contract changes

| Area | Existing port | Current mainline and required adaptation |
| --- | --- | --- |
| Source layout | `os/boards`, `os/pkgs`, `os/rootfs`, `os/build`, `os/verify` | Top-level `boards`, `pkgs`, `rootfs`, `build`, `verify`, and `build-env`; BSP outputs are under `_out/boards/<board>`. Move the board-owned sources and update their consumers. |
| Rootfs composition | `build-v2.sh` plus numbered feature, board, and component Dockerfiles | `rootfs/build.sh`, locked Debian dependency records, local package producers, manifest resolution, `10-compose` and `90-pack`. Add board packages; do not restore the retired stage pipeline. |
| Board payload | Firmware, hwinit, `alsa-utils`, six Bluetooth userland files, and board overlays installed by scripts | Create a `boards/s905x5m/deb/board-s905x5m` producer and `rootfs/packages/board-s905x5m.pkgs`; record payload ownership, dependencies, enablement, and BSP preflight. |
| Boot inputs | SD assembler reaches into BSP output and repository boot templates | Board packages stage boot inputs under `/usr/lib/mos/board/<board>`; `pack-export-boot.sh` exports them to `_out/<board>/boot/` and removes the staging copy from the root. Assemble and bundle from that selected package export. |
| Kernel verification | Kernel artifact exports only `Image`, `modules.tar`, and the DTB | All boards must ship `/boot/config-<release>` for the image contract. Export the resolved `.config`, `kernel.release`, and diagnostic `System.map`, validate their agreement, and package the config. |
| Kernel floor | The earlier shared fragment is merged before `olddefconfig` | The current shared fragment adds 20 required settings, covering eBPF, netfilter compatibility/bridging, and dm-crypt. Merge and assert the current floor against the resolved config; the committed seed alone is not proof of the built result. |
| Board schema | No recovery/release declaration | Declare `BOARD_RECOVERY_ACTIONS` and `BOARD_RELEASE_TARGET` truthfully, and add the board to the explicit kernel test tables and build targets. |
| Bluetooth | Seekwave plugin and vHCI bridge, with `mos-bluetooth.service` | Mainline's `mos-bluetooth` package owns the shared BlueZ dependencies and STATE mount. Its UART unit is conditional on `/etc/mos/bt.conf`. Retain the board's vHCI initializer under `/etc/mos/bluetooth.conf`, avoid duplicating the shared mount, and respect per-radio declines. |
| Optional components | Default-off `mqtt-reference` and `bm201-front-panel` | Keep them default-off and package-owned. The new resolver currently only has default-on features and board-selected radios, so explicit component selection needs a narrow package-resolution extension. |
| Management and time | Branch-specific `time.enabled` / `time.ntpServers` model and reconciler | Mainline has `time.ntp.servers` and timezone support, plus `/mos/config/` documents. Keep mainline's implementation and adapt probes and optional application integration to it. |
| Verification | Board-specific `os/verify` checks and a runtime suite | Port the missing checks into current `verify`, retaining the current kernel, rootfs, feature, and package contracts. `verify/src/runtime.ts` is absent on mainline and must be ported explicitly. |

Mainline's package resolver was exercised with `--board s905x5m --profile dev
--radios 'wifi bluetooth' --without ''`. It refuses the absent
`board-s905x5m.pkgs` by name; copying a board definition alone does not produce
a buildable board.

The existing board's important preserved behavior includes the SD cfgload
bridge, the distinct complete eMMC package and installer image, the fixed
redundant U-Boot environment, slot boot scripts, the boot-source menu, the
installer's environment-backed receipt, Seekwave radio support, HDMI/audio,
USB fixes, and the optional front panel. The raw SD image's reserved partition
is not an eMMC flashing image. Preserve this boundary and its tests.

Mainline's RAUC renderer and image checks still need the board branch's
distinction between a GPT raw loader region and an Amlogic bootloader in the
eMMC hardware boot area. Preserve the offset/size cross-check between
`board.env`, the U-Boot defconfig, and `fw_env.config`.

Mainline stores per-reconciler configuration under `/mos/config/` on DATA,
while the original branch stores one TOML settings tree on STATE. The current
store explicitly has no old migration registry. A new image built from this
port does not by itself establish an upgrade path for an already configured
device; the old NTP field is also structurally different.

## Proposal

Implement on a new `board/s905x5m-mainline` branch based on the reviewed
mainline revision. Keep the existing board branch as the source of board
behavior and hardware history. Port the final board changes selectively rather
than replaying all 124 commits over deleted interfaces.

### 1. BSP and board definition

- Move `os/boards/s905x5m` to `boards/s905x5m` and wire the current top-level
  delegation and build-image pins.
- Keep kernel/U-Boot source pins and vendor patch series, including patches
  0017/0018 for the installer receipt, unless a measured incompatibility
  requires a change.
- Use `_out/boards/s905x5m` for BSP output and update the named build contexts.
- Export the resolved kernel config, release, and System.map; merge the
  mainline shared fragment and assert its required settings after
  `olddefconfig`. Register s905x5m in the netavark/kernel gate.
- Preserve the partition geometry, GUIDs, redundant environment offsets, boot
  attempts, and media-specific installer behavior.
- Declare release eligibility as false until the current release path and
  required evidence are available. Audit the boot menu before declaring any
  OS recovery action: choosing a boot source is not itself a declared reset
  tier or the `mos.recovery` protocol.

### 2. Package composition

- Add the board Debian producer, manifest, controls, preflight/staging hook,
  and dependency declarations using the current producer contract.
- Package firmware, modules, rendered RAUC/fstab/environment configuration,
  board boot inputs, and hwinit facts. Keep shared Wi-Fi/Bluetooth mounts and
  upstream libraries owned by their existing packages.
- Make Seekwave userland and radio initializers compatible with independent
  `wifi` and `bluetooth` declines. Validate dynamic-library closure against the
  selected locked runtime; do not copy a second BlueZ runtime into the image.
- Keep `mqtt-reference` and `bm201-front-panel` explicitly selected packages.
  Add a minimal optional-component manifest path and propagate
  `MOS_ROOTFS_COMPONENTS` to resolution and validation. Preserve refusal of
  unknown components, selection for an incompatible board, and the MQTT
  reference in production.
- Update the component payload tests for package provenance and current
  service/runtime interfaces; do not reintroduce the old rootfs stages.

### 3. Image, bundle, and installer consumers

- Port the SD assembler, CLI, and eMMC payload extractor under `build/src`.
  Use current geometry/toolbox APIs and read selected kernel, DTB, and boot
  scripts from `_out/s905x5m/boot/`.
- Wire targets `os-rootfs-s905x5m`, `os-image-s905x5m-sd`,
  `os-verify-s905x5m-sd`, `os-emmc-package-s905x5m`,
  `os-emmc-installer-s905x5m`, and the RAUC bundle path using current naming.
- Preserve the GPT/partition byte checks and the distinction between the SD
  bridge image, complete eMMC USB package, and installer-card image.
- Retain board-specific environment assertions and raw-loader scoping in the
  shared RAUC/image checks without weakening checks for existing boards.

### 4. Verification and documentation

- Port board behavior tests, the runtime acceptance suite, optional component
  checks, and the required board schema extensions to current `verify`.
- Update the runtime suite for the current time API, management interfaces,
  package manifest, and configuration namespace. Keep optional active probes
  explicitly selected.
- Add a board dossier using `docs/bsp/board-template.md`. Historical hardware
  passes remain attributed to their old images; new-image rows remain
  `not tested` until exercised.
- Preserve the branch's reserved plan/task identifiers and hardware records;
  record the source revision and any intentionally superseded shared changes.

### Verification gates

1. `git diff --check`, board layout lint, package-manifest tests, producer
   preflight tests, shell/host-toolchain lint, and documentation checks.
2. Current `make os-build-test` and `make os-verify-test`, including migrated
   SD geometry, RAUC environment, radio-decline, package selection, and
   optional component cases. Existing cx3576, x64, and virt-arm64 checks stay
   enabled.
3. BSP container tests for U-Boot menu, installer, receipt preservation, and
   Bluetooth transports, followed by kernel/U-Boot/userland builds. Read back
   the resolved kernel config and exported artifact set.
4. Build and inspect the arm64 board packages; run package ownership and
   dependency-closure gates. Build a rootfs and SD image from the new package
   set, then run image and factory-root smoke checks. Record missing external
   build prerequisites explicitly if any prevent this stage.
5. Exercise eMMC package and installer-image generation and manifest checks
   against the newly built artifacts. Device boot, radio peer interaction,
   flashing, and A/B rollback remain separate hardware acceptance results.

## Risks

- A textual merge can retain obsolete rootfs code beside the new pipeline;
  all executable paths must resolve to the mainline layout and package model.
- Old BSP artifacts do not export a config and predate the expanded kernel
  floor. Reusing them cannot prove the new image contract.
- Duplicate package ownership of radio mounts or unconditional radio helpers
  can break installation or feature declines. Test both selected and declined
  cases against the composed payload.
- A wrong Amlogic environment or reserved-area mapping can destroy device
  state. Keep geometry and receipt tests, and generate artifacts without
  writing a device during this source adaptation.
- Existing device settings are not transparently compatible with mainline's
  new document format. Do not claim an in-place upgrade or silently discard
  settings; a deployment retaining old STATE/DATA needs a separately defined
  conversion and rollback procedure.
- Existing hardware evidence applies to old branch artifacts, not the rebuilt
  image. Kernel, USB, HDMI, Wi-Fi/Bluetooth, and rollback still need acceptance
  on the actual board after host-side validation.

## Scope

Board sources, Debian packaging and explicit component selection, image and
bundle consumers, verification, and current board documentation. Shared
management/UI and time implementations remain those of mainline, except for
the optional reference application's required compatibility changes.

This proposal delivers a mainline-based source port and automated build/test
evidence. It does not deploy to hardware, rewrite the existing remote branch,
or migrate an existing device's configuration. A pull request or remote push
can be prepared from the resulting reviewed branch.

## Alternatives

- **Recommended: mainline-based port.** The current layout and shared behavior
  are the baseline. Add only the final board support and its required seams;
  this makes superseded branch infrastructure easy to exclude.
- **Merge mainline into the existing branch.** Preserves ancestry directly,
  but the preview has 94 conflict messages and a substantial risk of retaining
  deleted code or reverting shared contracts during conflict resolution.
- **Rebase all board commits.** Repeatedly resolves intermediate historical
  states against interfaces that no longer exist. It also rewrites the board
  branch history without improving the final port's behavior.

## Annotations

Investigation requested on 2026-09-08 and completed against the revisions
above. Implementation approved on 2026-09-08 04:39 UTC. Working branch:
`board/s905x5m-mainline` in the mainline worktree. Only tracking files have
changed in the original checkout. Build and verification evidence is recorded
in RFCT-942.

Implementation and host-side acceptance completed on 2026-09-08 07:10 UTC.
The BSP, selected packages, rootfs, SD image, signed RAUC bundle, complete eMMC
package and installer image all built and passed their applicable checks.
Hardware qualification and existing-device configuration migration remain
separate, as proposed.
