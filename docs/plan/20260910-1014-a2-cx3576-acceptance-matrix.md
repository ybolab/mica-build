# 20260910-1014-a2-cx3576-acceptance-matrix Current CX3576 acceptance matrix and evidence baseline

- **status**: completed
- **createdAt**: 2026-09-10 10:14
- **approvedAt**: 2026-09-10 10:14 (campaign charter `mos-open-plans-20260910-100408`)
- **relatedTask**: 20260910-1014-a2-cx3576-acceptance-matrix

## Context

CX3576 already has a bench procedure, historical example, board evidence
records, and source-level qualification gates. The current campaign requires a
fresh baseline for the signed file-based A/B contract without treating earlier
boot logs, simulations, other boards, or expensive software matrices as
same-image board evidence. No current bench endpoint or flashed-image identity
is confirmed.

## Proposal

1. Inventory the current board, boot, update, storage, display, qualification,
   and historical S905X5M acceptance obligations from the bounded read scope.
2. Record one evidence-qualified row per CX3576 obligation in the related task,
   including identity, source, evidence class, current result, blocker, and
   exact remaining operator action.
3. Update `docs/bsp/cx3576-bench.md` so its acceptance procedure reflects only
   the current signed-file contract, links the live matrix, avoids raw-slot and
   old-environment assumptions, and does not invent endpoints or disk paths.
4. Verify references and SHA256 metadata, run `make docs-verify`, and perform a
   local diff review before the scoped commit.

## Risks

- Historical evidence can be over-promoted into a current hardware pass.
- Procedure text can accidentally encode stale raw-slot or package assumptions.
- An unspecified endpoint or block device can make a destructive operator step
  ambiguous; such steps must remain blocked instead of guessed.
- Concurrent #313 work owns related board/build files; those paths remain
  read-only and no current acceptance claim may depend on unapproved sync.

## Scope

- Write: `docs/bsp/cx3576-bench.md`, the related task/plan records, and their
  two scoped index entries.
- Read: only the charter-listed design, board, qualification, task/plan,
  source, manifest, test, and historical log paths needed to classify evidence.
- Exclude from writes: collectors, board source, build/rootfs/lifecycle
  implementation, global status files, sibling records, and
  `docs/changelog.md`. Exclude entirely: image builds, QEMU, Docker, flashing
  and device operation.

## Alternatives

- Keeping the current result matrix on the bench page would mix volatile
  campaign evidence with the reusable operator procedure, so the task record
  remains the matrix source of truth and the bench page links to it.
- Re-running expensive software matrices or using the historical boot log as a
  pass was rejected because neither proves the current exact image on hardware.

## Annotations

- Compatibility is intentionally out of scope during system development unless
  the user explicitly requests it.
- The full-tier proposal gate was satisfied by the user's campaign charter;
  no repeated approval request is required.

## Outcome

- Classified 39 logical rows — 38 current mandatory obligations plus retained
  historical D5 — without promoting any same-image hardware row to pass.
- Bound the archived image, metadata snapshot and historical log to their exact
  hashes and evidence classes; the archived image predates the current
  unlimited-data correction and cannot satisfy the clean-source flash gate.
- Reworked the bench admission gate and operator order for current signed file
  deployments, 180-second health, separate reboot/power-off/watchdog cases,
  seven physical power-cut boundaries, current storage policy, HDMI/tty2,
  accelerators and network/radio evidence.
- Reported nine collector gaps without changing the collector and translated
  the historical S905X5M obligations into a handoff-gated current inventory.

## Review rework 1 (2026-09-10)

- Recorded the L1-approved #313 source commit and L2 integrated-source commit
  while preserving `SRC-0` as the original investigation baseline; A4 through
  L2 owns the exact complete-image handoff.
- Preserved D5 among the 39 logical rows. Commit
  `081b2f286991ec7fd2df5948e84e616817e2ce13` first recorded the inherited
  HDMI-panic requirement as unresolved; L1's 2026-09-10 ruling now classifies it
  as superseded by current console policy, with hardware result `not qualified /
  optional observation`.
- The ruling is bound to completed policy commit
  `3579a2cdac58160779cfa3f02860f15104c5dc96`, approved source
  `5d0dca577a782aa707d9530779c4b23f2a7eda31`, the forced `ttyFIQ0` command line
  and authenticated tty2 recovery. It authorizes no `console=tty1`, panic
  renderer, extra crash or other implementation; a future panic display request
  needs a separate implementation and acceptance boundary.
- No task-state transition was made: the completed documentation deliverable is
  being corrected in place, and all mandatory physical acceptance rows remain
  unpassed.
