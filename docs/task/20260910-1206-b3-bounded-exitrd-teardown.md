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

Verifying shutdown supervision and hardening retained-payload copying.

## Dependencies

- **blocked by**: Accepted B0, B1 and B2, merged from approved local L2 HEAD
  `bd2d55da3680900416b0ddc0700d76fcd2f88ea3`.
- **blocks**: B7 integrated lifecycle acceptance.

## Notes

- Full-tier proposal and local scoped commits explicitly approved before dispatch.
  No repeated approval question is required; a native helper beyond the script
  boundary requires the specified L2/L1 decision before implementation.
- Verified clean branch `bkd/8ezwxfy2` and exact upstream tree
  `227ceb04dcfe2998a7af5b04e5c6930fed732a8a` before edits. Authorized merge:
  `d3ce3acdc6883c0843e5d7e16110477efa7102d0`; upstream ancestry verified.
- [Plan](../plan/20260910-1206-b3-bounded-exitrd-teardown.md). Task transitions use task-state.sh;
  plans follow the documented draft/implementing/completed schema because the
  serializer operates on task records only, as accepted in B0/B1/B2.
- Expensive build grant is zero. No main source, push, global tracking changes,
  other issue communication, workflow or subagent is authorized. D owns final
  campaign indexes/changelog reconciliation. Hardware and guest rows stay pending.

- Partial delivery: structural exitrd preflight and fd-scoped copying implemented;
  5 RED groups reproduced, 19 focused GREEN tests and 61 package tests pass.
  Two pre-existing ignored IO-fault tests and real BusyBox payload checks are
  unrun, not passes. Existing shell UI baseline remains exit 2.
- Native supervisor decision was sent only to L2 with HTTP/success guards.
  Source findings, precise proposed extension and all remaining B3/B7 rows are
  recorded in the plan. Shutdown/helper/harness and packaging remain pending;
  the current systemd closure is preserved. No full B3 completion is claimed.
- Evidence: `/tmp/mos-b3-checks.hMNe51/`; tmux `8ezwxfy2-2f3c00`.
  No detached gate remains. Tracking remains claimed pending the L2/L1 decision.
