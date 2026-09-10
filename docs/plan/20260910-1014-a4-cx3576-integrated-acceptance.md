# 20260910-1014-a4-cx3576-integrated-acceptance CX3576 integrated artifact and board acceptance

- **status**: implementing
- **createdAt**: 2026-09-10 11:38
- **approvedAt**: 2026-09-10 11:38 (campaign charter `mos-open-plans-20260910-100408`)
- **relatedTask**: 20260910-1014-a4-cx3576-integrated-acceptance

## Context

The branch now contains the exact reviewed L2 source at
`a39807d8392f0838e6e5438e3e57518f9b1bdd81`, including the approved S905X5M
source, A1 encoder repair, A2 acceptance baseline and A3 late-HDMI/VT repair.
A1 and A3 host fixtures passed, but no coherent ARM64 kernel/object/modpost build
has yet proved their combined result. The A2 matrix identifies nine concrete
collector gaps: guessed API/media defaults, incorrect health and storage policy,
no 180-second observation or early watchdog handoff, missing current display and
accelerator/radio evidence, incomplete install provenance, and stale rescue-SD
recovery wording. No current bench endpoint or flashed image is confirmed.

## Proposal

1. Add focused host tests that reproduce the collector's current-contract gaps,
   then minimally update the collector and bench procedure so identity inputs are
   explicit, required-health and 180-second evidence are distinct, current
   storage/display/accelerator/Bluetooth/watchdog/recovery obligations are
   recorded, and the report never upgrades an unobserved row.
2. Run the cheap mandatory source, shell, watchdog, netavark and documentation
   gates. Apply the complete pinned kernel patch series to a task-owned source
   tree and rerun A1/A3 fixtures against that actual source and new DTB.
3. Commit the coherent source identity, then launch at most one granted CX3576
   kernel build in a persistent tmux shell using the existing recipe and explicit
   trust/artifact inputs. Bind Image, DTB, config, modules/support, FIT and object
   evidence to the committed source, timestamp and hashes. Run only applicable
   negative/readback/offline checks for a newly assembled candidate.
4. Record every physical CX3576 and S905X5M obligation as blocked with exact
   operator prerequisites when no confirmed bench exists. Review the actual diff
   with pma-cr, complete scoped tracking, commit only owned files and report once
   to L2 through the guarded BKD follow-up endpoint.

## Risks

- A collector can create false confidence if defaults are mistaken for device
  discovery or optional failures are treated as required-health failures.
- A successful host fixture or kernel build does not prove boot, watchdog,
  display, accelerator, radio, power-cut or recovery behavior on hardware.
- Existing build recipes may require unavailable signing inputs or collide with
  shared scratch discovery; missing inputs are blockers, not permission to invent
  keys or consume another workstream's outputs.
- The S905X5M artifacts are source-equivalent dirty development builds, not a
  clean-commit rebuild or physical qualification.

## Scope

Write only the unique A4 task/plan and scoped index entries,
`docs/bsp/cx3576-bench.md`, `docs/bsp/cx3576-bench-collect.sh`, and new focused
collector tests under `tests/cx3576-bench/`. Kernel, board, build, rootfs,
lifecycle, packaging, shared verifier, sibling tracking and global history files
are read-only. One expensive CX3576 kernel/root/QEMU job may run at a time; no
full image rebuild is justified by documentation alone.

## Alternatives

Manual wrapper instructions alone would leave the known collector defects
repeatable and unaudited. Reusing historical images or fixture passes as current
hardware evidence is rejected because neither binds a current flashed image to
the named board and physical observations.

## Annotations

- Approval source: user-approved full-tier campaign
  `mos-open-plans-20260910-100408` and final A4 start handoff on 2026-09-10.
- Development-only newest-image delivery; backward compatibility is not required.
- L2 integrates this branch; D owns later changelog/global reconciliation.
- Recovery retry 1 resumes the existing owned work after the prior execution's
  unexplained exit 137 / SIGKILL. No upstream sync is repeated. Scoped review
  reproduced and corrected four evidence-integrity defects with RED/GREEN;
  the checkpoint keeps this plan implementing while the committed-source kernel
  gate is pending. Exact recovery logs and coordination mappings are in the
  paired task.
- A/L2 coordinates CX3576, S905X5M and original-device reboot acceptance; A4
  integrates evidence, but physical operator/device/endpoint inputs remain
  unconfirmed. The available A kernel gate is independent of future reviewed
  B/C integration, which is not imported or treated as source-identical.
