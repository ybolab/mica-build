# 20260910-0616-cx3576-storage-display-cleanup Container storage and CX3576 boot presentation

- **status**: completed
- **createdAt**: 2026-09-10 06:16
- **approvedAt**: 2026-09-10 06:16
- **relatedTask**: 20260910-0616-cx3576-storage-display-cleanup

## Context

Container graph storage currently lives at /mos/containers/storage on DATA,
sharing bulk project 100 with /mos and /srv. Variable system data uses project
101 independently. The board disables virtual-console gettys to preserve its
kernel logo; the authoritative bitmap still names RK3576. Latest log findings
are recorded in task 20260910-0350-cx3576-latest-boot-review and the earlier
[cleanup proposal](20260910-0029-cx3576-boot-log-cleanup.md).

## Proposal

1. Resolve container directory/mount and aggregate quota semantics, then update
   layout, engine configuration, reset/status accounting and runtime verification.
2. Replace the bitmap with centered YBO - Hub OS and a surrounding gradient;
   verify its kernel palette conversion and centered display contract.
3. Enable an authenticated keyboard-selected VT while retaining the idle logo;
   verify actual getty startup, switching and login policy.
4. Repair source-proven unused camera/TEE/logo/Mali resources, GPU IRQ naming,
   autofs and FIT descriptions; preserve resources whose hardware intent remains
   unresolved. Rebuild the board kernel and inspect the resolved DT/config/FIT.
5. Run focused gates and current-image x64/ARM64 runtime acceptance, then build
   and verify a timestamped CX3576 image. Physical board-only checks stay open.

## Risks

Ext4 project quotas are not hierarchical: independent full-size limits cannot
be added without compromising the reserved system budget. Keyboard switching
must preserve normal authentication. DT cleanup must not disable shared display,
USB or accelerator resources. A built kernel alone is not peripheral acceptance.

## Scope

DATA layout and its consumers, CX3576 board config/assets, signed FIT metadata,
relevant tests and existing architecture documents. No unrelated UI or S905X5M edits.

## Alternatives

Use standard VT shortcuts when they provide the requested console access without
an input daemon. Keep the upstream signed regulatory pair validated against the
actual kernel, as explicitly selected by the user.

## Annotations

User requested immediate implementation. The implementation uses independent
container project 102: reserve state/meta, allocate bounded variable project 101
and system/user project 100, and give containers the remainder. The optional
capacity preference was asked before implementation; no answer was received,
so the stated proportional default is used. Limits are recomputed after growth.
The initial regdb option remains the upstream database/signature pair checked
against the built kernel trust bundle.

## Progress

- Board kernel rebuilt and resolved DT/config inspected successfully. Removed
  unused EVB camera routes/PHYs, OP-TEE and Mali400; preserved SMC SCMI, HDMI,
  watchdog, USB and Bifrost. GPU IRQ names now match the primary lookup.
- Replaced the splash bitmap and verified deterministic 720×405/223-color
  conversion. Built-in image editing prompt: centered white "YBO - Hub OS",
  a restrained blue/teal radial gradient fading to black in every direction,
  no board names, subtitle, underline or progress bar.
- Added the reserved tty2 logind policy using Alt+F2/Ctrl+Alt+F2 and ordinary
  getty/login authentication. Kernel-logo redraw after switching remains open.
- Container storage, named volumes, networks and image-download temporary files
  use the independent directory. Reset and observation follow its physical path.
- RED tests reproduced missing directory, quota reporting and reset cleanup;
  focused GREEN checks passed. Full package/runtime acceptance is running.
- Both architectures passed two signed production-root boots, including real
  Podman named-volume writes and independent byte/inode quota exhaustion.
  A keyboard-injected Alt+F2 started tty2 getty and displayed its login prompt;
  tty1 remained free of a login service. Password authentication is unchanged.
- Interrupted reset exposed mount propagation into DATA/mos/containers and
  DATA/var/lib/mos. The applier correctly rejected nested backing mounts.
  The logical parent/container binds now use private propagation, and runtime
  checks exercise a child mount and verify that DATA remains free of submounts.
  Rebuilt x64/ARM64 roots each pass two signed boots, including the child-mount
  isolation check. All three reset tiers pass interruption/retry and a further
  boot without repeating the deletion. The delivered CX3576 image passes 125 offline checks, FIT signature negatives,
  flash geometry and SHA256SUMS. Artifact identities are recorded in the task.
- Fixed the existing pipefail gate finding in U-Boot trust embedding: consume
  the full FDT child listing when testing for the signature node. Key insertion
  and firmware bytes are unchanged; the previous early-exiting reader could
  report a failed match when its producer received SIGPIPE.
