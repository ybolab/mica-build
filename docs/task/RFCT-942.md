# RFCT-942 Adapt s905x5m to the current mainline build and runtime contracts

- **status**: completed
- **priority**: P1
- **owner**: s905x5m-mainline-adaptation
- **createdAt**: 2026-09-08 04:32 UTC
- **completedAt**: 2026-09-08 07:10 UTC
- **plan**: [PLAN-922](../plan/PLAN-922.md)

## Description

Investigate the `board/s905x5m` port against the current `origin/main`, then
implement the approved integration while preserving its board support and
using the current mainline layout, rootfs composition, build exports and checks.

## Acceptance

- Record both source revisions, integration conflicts, and affected contracts.
- Define the board-specific changes to retain and the shared changes already
  superseded by mainline.
- Propose an isolated implementation branch and focused verification gates.
- Implement after the proposal is approved; distinguish host-side validation
  from any hardware acceptance that remains to be performed.

## ActiveForm

Completed the mainline source port and host-side build and image validation.

## Dependencies

- **blocked by**: (none for investigation)
- **blocks**: s905x5m integration with current mainline

## Notes

- Tracking uses these repository files.
- Source branch: `e53c1cfd`; target baseline: `1d2a5e49`.
- Final target refreshed to `09c384cd` after mainline advanced during builds.
  The pre-refresh port was retained in a local stash checkpoint. The working
  branch fast-forwarded to mainline before reapplying the port. Package
  builds were restarted for the new source stamp. Fresh regression results
  below cover the changed bundle and bootchain paths.
- Local `main` was fast-forwarded from `3dc96820` to the captured target
  `09c384cd`; it had no divergent commits and was not checked out.
- Common ancestor: `15e87d66`; mainline has 822 unique commits and the
  board branch has 124 unique commits at investigation start.
- The working tree was clean before creating these records. Existing board
  tasks and hardware evidence remain owned by their current records.
- The forge web/API endpoints are unavailable from this environment; SSH
  fetching the configured origin succeeds and supplies both branch trees.
- Investigation used a detached checkout at
  `/workspace/miehq/worktrees/mos-mainline-review-20260908`. The existing
  board branch has no implementation changes.
- A merge-tree preview reports 94 conflict messages: 36 content, 38 file
  location, 19 modify/delete, and one add/add. The report is in
  `tmp/s905x5m-mainline-merge-tree-20260908.txt`.
- Mainline's package resolver refuses `s905x5m` because its board manifest
  and package producer are absent. Kernel config export, package ownership,
  the boot export, the radio contract, optional components, and verification
  registrations are the integration seams recorded in PLAN-922.
- Mainline has replaced the settings document and time API. Its store has no
  migration from the old monolithic document; old device-state compatibility
  must not be claimed from a successful new-image build.
- Investigation and proposal were completed before implementation approval.

- Implementation approved on 2026-09-08 04:39 UTC and delivered on `board/s905x5m-mainline`.

## Implementation progress

- Imported the final BSP, radio transport, SD/eMMC producers and runtime suite
  onto the current mainline directory layout. Existing source revisions and
  vendor patches remain pinned.
- Added package producers, locked ALSA dependencies, independent radio
  selection, default-off application/panel selection, kernel config export,
  package-inventory checks and the current runtime timezone path.
- Adapted SD inputs to the selected package boot export. Fixed the RAUC bundle
  DTB filename to follow the board declaration; a signed bundle readback test
  confirms the s905x5m filename and both slot environment files.
- Kernel, U-Boot and Seekwave userland container builds passed. The exported
  kernel is `6.12.38-m100-arm64`; its config satisfies all 55 shared floor
  declarations. All 20 board package inputs are present, including the
  Seekwave, vHCI and front-panel modules.
- Before the target refresh, the full verifier suite passed all 1,382 tests
  with a 30-second test timeout.
  The front-panel Debian package and optional application Clippy gate passed.
- Before the target refresh, the full build suite passed all 970 tests, including cx3576/x64 byte
  reproducibility, both UEFI toolsets, s905x5m SD assembly and eMMC extraction.
- All five new packages built successfully. Archive readback confirmed their
  architectures, resolved shared-library dependencies, boot payload/config,
  and the declared service enablement links.
- Enabled the target architecture for the x64 GRUB data package, mirroring
  the existing arm64 path. This permits the unchanged x64 image tests to run
  on an arm64 builder without changing their target modules or package pins.
- Passing focused gates include 82 bundle tests, 61 runtime/bootchain tests,
  the optional application unit and D-Bus integration tests, Rust formatting,
  155 kernel-floor assertions, package selection/preflight tests, both panel
  tests, installer/package source contracts, documentation gates, and host
  toolchain/shell pipeline lint.
- The Debian cache verified all 175 selected upstream/helper archives against
  the committed metadata. Newly added ALSA records came from authenticated
  trixie snapshot metadata, with the Packages index hash checked against the
  signed InRelease.
- The unfiltered whitespace check reports 41 imported patch/vendor files;
  their bytes match the source revision exactly. Authored changes pass the
  whitespace check with those inherited paths excluded.
- Earlier broad runs exposed missing host test tools, an ARM-host x64 GRUB
  toolset limitation, and contention-related timeouts. The final full suites
  above passed after correcting the environment and GRUB architecture setup.
- On `09c384cd`, the final verifier passed all 1,391 tests and 20,969 assertions.
  The shared A/B boot-command guards are now distinct from the cx3576-only
  digest guards. The three AIC8800 module-list checks apply only to boards
  declaring the corresponding hwinit, with complementary scope tests.
- The final full build suite on `09c384cd` passed all 982 tests and 4,803
  assertions across 34 files, including both existing image formats, s905x5m
  SD/eMMC paths, real signed bundle readback and byte reproducibility.
- The U-Boot-only Amlogic package built and passed content validation. Its
  `update.img` is 10,267,648 bytes with SHA256
  `724f3e6cc91917f05c540166443a45b63f07c22d2cc44f68e05594191f7131a7`.
  The seven Podman arm64 binaries also built and passed export validation.
- All 19 selected local packages passed archive inspection: 881 non-directory
  paths have unique ownership; architecture, exact local dependency versions,
  copyright, declared enablement and immutable control metadata agree. Every
  archive carries source stamp `09c384cd22de.dirty-1`. The repository-wide
  two-architecture package gate was not run against this board-selected pool;
  it requires unrelated board packages and BSPs.
- The composed rootfs is 329 MB installed (400 MB budget), with a 95 MiB
  padded verity payload. The 1,425 MiB SD image passed 392 image checks;
  ten named checks do not apply to this board/bootloader. All 14 executable
  smoke checks passed, with no failures, unclaimed artifacts or executor limits.
- Docker's classic image store rejected OCI archives at load time. The smoke
  loader now validates the OCI index and manifest before selecting its
  existing BuildKit executor for this exact incompatibility. Other load
  failures remain errors, including unreadable archives; regression cases
  and the real 14-program smoke run passed.
- The validation host required a docker-container builder for OCI export,
  a temporary internal cache network, and a Linux data volume for image
  extraction (the shared host filesystem cannot preserve device nodes or
  case-distinct library names). The cache verified 175 archives with zero
  downloads during composition. The temporary network and volume were removed.
- The generated RAUC bundle passed signing and readback. The complete eMMC
  package passed the Amlogic format check and round-tripped all 18 required
  inputs unchanged. Installer-image generation and content validation passed,
  with a 1,792 MiB FAT partition carrying the validated complete package.

## Delivered artifacts

These development artifacts were built from the reviewed working tree at
`09c384cd22de.dirty-1`, before the delivery commit. Hardware installation,
runtime qualification and migration of existing device settings remain outside
this task. Source review found no remaining blocking integration defect.

| Artifact | Bytes | SHA256 |
| --- | ---: | --- |
| `_out/s905x5m/s905x5m-mos-sd-latest.img` | 1494220800 | `c5b9e361c8f3f174ca4f9d2a87caa00ad2720208457a5fce7441f570aa0e4d4e` |
| `_out/s905x5m/mos-s905x5m-latest.raucb` | 112493935 | `5e81c3f8f40d379c86c6e5d34d9d13bb5d1644042f28d9f3fc88d1ece47c2279` |
| `_out/boards/s905x5m/emmc-package/update.img` | 1369400096 | `9b61c49f49f122568901b3a774aeae41055cff0255177484bfe9fa6a7af9180b` |
| `_out/boards/s905x5m/emmc-installer/disk.img` | 1900019712 | `24e02057beac038458054d5ddc4b6068a223c4864fff46e19cc668ab187c3843` |

The verity root hash is
`402e60bc5d8d73d5278bc1b88867c7a64cceca9f43e07a27f00690041a33757c`.
Build, package, image and smoke logs are retained under the worktree's `tmp/`.
