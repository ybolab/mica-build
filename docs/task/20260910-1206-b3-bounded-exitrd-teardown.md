# 20260910-1206-b3-bounded-exitrd-teardown B3 bounded exitrd teardown

- **status**: in_progress
- **priority**: P1
- **owner**: b3/8ezwxfy2
- **createdAt**: 2026-09-10 12:06

## Description

Implement the approved BusyBox exitrd teardown and strict retained-payload
contract for campaign `mos-open-plans-20260910-100408`, L2 B `8t4ghqi6`.
Safe storage release, watchdog supervision and partial-startup refusal cleanup
must precede reboot, poweroff or halt. No compatibility is required.

## ActiveForm

Delivering reviewed native lifecycle supervision and measured retained payload for L2 review.

## Dependencies

- **blocked by**: Accepted B0, B1 and B2, merged from approved local L2 HEAD
  `bd2d55da3680900416b0ddc0700d76fcd2f88ea3`.
- **blocks**: B7 integrated lifecycle acceptance.

## Notes

- Full-tier proposal and local scoped commits explicitly approved before dispatch.
  No repeated approval question is required; the native boundary received the
  explicit L1 amendment recorded below before implementation.
- Verified clean branch `bkd/8ezwxfy2` and exact upstream tree
  `227ceb04dcfe2998a7af5b04e5c6930fed732a8a` before edits. Authorized merge:
  `d3ce3acdc6883c0843e5d7e16110477efa7102d0`; upstream ancestry verified.
- [Plan](../plan/20260910-1206-b3-bounded-exitrd-teardown.md). Task transitions use task-state.sh;
  plans follow the documented draft/implementing/completed schema because the
  serializer operates on task records only, as accepted in B0/B1/B2.
- Expensive build grant is zero. No main source, push, global tracking changes,
  other issue communication, workflow or subagent is authorized. D owns final
  campaign indexes/changelog reconciliation. Hardware and guest rows stay pending.

- Historical partial delivery (preserved): structural exitrd preflight and fd-scoped copying implemented;
  5 RED groups reproduced, 19 focused GREEN tests and 61 package tests pass.
  Two pre-existing ignored IO-fault tests and real BusyBox payload checks are
  unrun, not passes. Existing shell UI baseline remains exit 2.
- At the historical partial handoff the native supervisor decision was sent only
  to L2 with HTTP/success guards.
  Source findings, precise proposed extension and all remaining B3/B7 rows are
  recorded in the plan. Shutdown/helper/harness and packaging remain pending;
  the current systemd closure is preserved. No full B3 completion is claimed.
- Evidence: `/tmp/mos-b3-checks.hMNe51/`; tmux `8ezwxfy2-2f3c00`.
  No detached gate remained at that partial handoff. The later approval resolves
  the historical decision hold.

- 2026-09-10 12:21 UTC: L1 approved bounded native supervision, isolated typed
  ioctl member and partial-startup reuse, plus exact binary/input/fingerprint
  wiring and tests. The prior scope hold is resolved. The plan records the full
  allowed file/API/timeout/FFI contract before editing added paths. Continue the
  same `b3/8ezwxfy2` claim; previous partial commit and evidence remain preserved.

- Continuation implemented: one safe native supervisor serves exitrd PID1 and
  partial startup; five isolated typed ioctl wrappers; fresh graph and diskseq
  identity proof; strict native/BusyBox/dmsetup closure; required authenticated
  kernel input/fingerprint and measured tmpfs capacity. No compatibility fallback.
- Final verification: 44 focused tests, 86 package tests (2 pre-existing ignored),
  both native architectures/ABI/actual BusyBox/closure copies, real owned tmpfs
  mount fixtures and Bun typecheck plus 2 tests pass. Host lint 413/413; shell
  lint 157/158 with the sole preserved UI baseline. Docs verification passes.
- Retained selected bytes: x64 8,010,008; aa64 7,316,928. Capacity limits:
  10,551,296 / 10,223,616 bytes. Archive identities and all measurements are in
  the plan and external continuation-artifacts.json; no runtime RSS claim.
- PMA-CR local Rust/FFI/storage and build-input review has no remaining introduced
  finding. L2 independent review is required. B7 owns required shutdown input
  wiring in its final callers and actual signed-image/guest acceptance; A owns
  physical/power-cut evidence. No expensive job or issue done transition.

- complete: Completed approved B3 software implementation and focused verification for L2 review; B7 caller/guest and A physical evidence remain separate. Campaign mos-open-plans-20260910-100408.


## Current user-directed static refinement (2026-09-11)

The prior completion/history above records the delivered HYBRID scope only.
The same issue now implements the explicitly approved single-static-shutdown
refinement under L1 decision `01M28Y5AV9CZR3QMH27NAZBX55`; see the existing plan's
current executable scope/test/input section. Ownership remains b3/8ezwxfy2.
The approved synchronized base is da65dd92ed4680531e0a065f05da24e59dd94866 via
merge 31e7d98896541b3e571462a307772b7a4f96a56f. No-Python composition identity,
prior artifacts, negative evidence and B7 joint acceptance ownership are preserved.

At initial static-refinement preparation, serializer restart was refused: `task-state: claim requires pending status,
found completed`. The exact failure is preserved externally and reported to B;
no manual status rewrite or new tracking node substitutes for a serialized claim.
At that preparation boundary, the static refinement was not complete and
independent preflight/RED work continued under the explicit same-owner approval.
The later x64 delivery and authorized tracking resolution below supersede that
preparation state; the original refusal remains preparation failure, not product RED.

- Current schedule (2026-09-11 explicit user amendment): finish the static
  refinement on x64 only. ARM compilation/fixtures/acceptance are deferred until
  the actual approved main merge; historical ARM preflight evidence remains
  separately identified. No task-owned ARM job was active at the boundary.
  B7 retains combined x64 image/guest ownership. Main merge/push is not authorized.

- Static x64 software delivery: direct rustix/typed DM worker backend, strict
  single-static executable copy/manifest/kernel validation and actual producer
  integration implemented. Final binary is 2,047,144 bytes, SHA-256
  `d2c5c9a6e2473c0125670031c79014c6ee946b834e2e26f32a65f38939e68b35`;
  retained files 2,047,158 bytes, tmpfs limit 3,866,624, packed fixture 21,293,056.
  Full 94-test Rust gate passed before the final strict DM length guard; its
  focused final fmt/clippy/eight parser+descriptor tests passed after RED.
  Actual x64 static/empty/owned-tmpfs/copy/kernel-input negatives pass. Evidence
  `/tmp/mos-b3-static.3ttniist`; full results and limitations are in the plan.
- X64 source is ready for B review/B7 integration. ARM is deferred-by-user until
  approved main integration; guest RSS/storage/watchdog/signatures and physical
  power-cut proof remain separate. The unsupported serializer reopen was
  reported verbatim, so this record's historical completed status was not
  manually bypassed at the source handoff. The authorized reopen below resolves
that tracking limitation; the plan stays implementing for B independent review.


- reopen (2026-09-11, explicit user/L1 direction relayed by B): Continued the
  SAME single-static-shutdown refinement as owner b3/8ezwxfy2 under the same
  exclusive docs/task directory-inode flock as task-state.sh. Asserted the exact
  completed status, owner and unique [x] index row; staged the paired detail/index
  transition with rollback, then changed only this task to in_progress/[-].
  Prior HYBRID completion/history and original serializer-claim.log are preserved.
  No shared serializer or sibling status was modified. All later supported
  transitions must use the original serializer. Campaign mos-open-plans-20260910-100408.
- Current state: x64 static source delivery 36866b47f2647e778ef33d7183fbba88a81a494e
  and its passed gates/artifacts remain unchanged and ready for B independent
  review. This reopen is tracking only; it does not dispatch new implementation,
  rerun source suites, close the static refinement or change B7/ARM ownership.
  ARM remains deferred-by-user until the actual approved main merge.
