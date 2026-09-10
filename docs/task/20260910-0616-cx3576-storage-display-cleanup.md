# 20260910-0616-cx3576-storage-display-cleanup Isolate container storage and finish CX3576 boot presentation fixes

- **status**: completed
- **priority**: P1
- **owner**: worker/cx-storage-display-20260910
- **createdAt**: 2026-09-10 06:16
- **relatedPlan**: [20260910-0616-cx3576-storage-display-cleanup](../plan/20260910-0616-cx3576-storage-display-cleanup.md)

## Description

Implement the user's approved continuation: preserve upstream matched regdb
packaging, separate container storage from variable system data, replace the
board-specific HDMI artwork with YBO - Hub OS, provide an authenticated local
keyboard console, and repair evidenced CX3576 boot configuration mismatches.
All images are fresh installations; no compatibility or migration paths.

## ActiveForm

Completed software implementation, signed-image delivery and runtime/reset acceptance.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

Full PMA tier. User authorization on 2026-09-10 06:16 covers implementation.
Preserve the previous writable-var/regdb changes and concurrent UI/S905X5M work.
The old cleanup task remains with its owner; this continuation records the
implemented subset of its proposal without taking over its hardware qualification.

## Verification

- Rust: 523 unit tests and 8 integration/policy tests; fmt and clippy pass.
- Build: 389 tests; verifier: 646 tests and typecheck pass.
- Layout/seed scripts, host-toolchain and pipefail checks pass. Host enumeration
  includes new files through a temporary index; the user's Git index is unchanged.
- Final signed x64 and ARM64 production-root fixtures each pass two boots,
  service health, DATA growth, /var persistence, Podman graph/run/download paths,
  named-volume writes, byte/inode quota exhaustion and independent reserve writes.
  All four logs pass final exitrd filesystem/loop/DM teardown checks.
- A real child mount under /mos/containers remains outside physical DATA; no
  logical bind propagates into the reset backing tree. Reset retains its strict
  nested-mount rejection instead of exempting the unintended mounts.
- Configuration, application-data and full-factory reset each pass three boots:
  stage intent, interrupt after a successful removal and retry, then prove no
  repeated reset. Container payload follows the selected tier while identity and
  the active signed deployment remain intact.
- Alt+F2 keyboard injection with the CX3576 logind policy selects tty2, starts
  getty and displays an authenticated login prompt; tty1 has no getty. The
  authentication policy is unchanged; the test does not submit a password.
- BSP resolved config/DT and deterministic splash palette conversion pass.
  U-Boot trust insertion/replacement passes twice with identical resulting DTB.
- Evidence: `.tmp/cx-storage-display/`; final boot logs are
  `boot-x64-{1,2}.log` and `boot-virt-arm64-{1,2}.log`. Interrupted-reset evidence
  is `source/_out/reset-runtime.BxKfSL`; console evidence is
  `source/_out/console-test-v2/boot`. `final-source-hashes.json` records the
  implementation snapshot, excluding concurrent unfinished UI/S905X5M work.

## Physical acceptance still required

Flash the complete new image and check HDMI appearance, USB keyboard console,
radio/regdb loading, GPU and reboot/watchdog behavior. Kernel-logo redraw after
returning from tty2 or connecting HDMI late remains a separate display task.
NPU/IOMMU ownership, VENC/VDEC optional resources and closed BL31 diagnostics
remain with the earlier cleanup/hardware qualification tasks. P10 is not closed
by these software and QEMU results. No new board log was supplied during this task.

## Delivered image

- Image: `_out/cx3576-storage-display-20260910/image/mos-cx3576-20260910-072131.img`.
- SHA-256: `0f2a2358eb360222e3ee7c6722a3b178657fbf47553bbff5763e8a31d1c0dd1a`.
- Logical size: 1,362,100,224 bytes (1,299 MiB). SYSTEM remains 1 GiB.
- SYSTEM allocated blocks: 206,319,616 bytes (196.76 MiB), including filesystem metadata.

- Generations 11/12 share the signed kernel/support component
  `66fa494b7abe76f491f76736b004ba84fa7aebb279446f5f8c63656ebc3c55c7`
  and root component
  `4d8f0bb540d4e4f7a32c362c198e84c2303e3a83268ee3d0deada5eac469c776`.
- Kernel Image SHA-256:
  `5e27430dad27ed0c13e14695071a8202eec2add3ac6982bdff0973ee15586267`.
  The current verified native-console U-Boot firmware and unchanged production
  mos-init are reused; the board kernel and all production roots are rebuilt.
- Upstream regulatory database and its original signature are verified against
  the certificates exported from this built kernel before support publication.
- 125 offline image checks, zero skipped; fixed flash geometry, embedded firmware
  control FDT, required FIT signatures and tampered/unsigned/unknown-key negatives
  pass. The delivered copy independently passes SHA256SUMS verification.
- ARM64 factory smoke retains its declared qemu-user crun limitation. The crun
  binary is byte-identical to the one already executed successfully in the prior
  full-system ARM64 acceptance (SHA-256
  `2f8434d2e09ebeb4da4613a3c3f504b9a9a921c9d88bbf2791aa01a0806bd9b2`).
- Final source review: no unresolved findings within this implementation scope.
  Private mount propagation fixes the runtime regression; physical limitations
  above remain explicit. No unrelated changes were committed or pushed.

- complete: Implemented and delivered the signed image; physical board qualification remains in its existing tasks.
