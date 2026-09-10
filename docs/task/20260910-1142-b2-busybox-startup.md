# 20260910-1142-b2-busybox-startup B2 explicit BusyBox startup semantics

- **status**: completed
- **priority**: P1
- **owner**: b2/js1slhab
- **createdAt**: 2026-09-10 11:42

## Description

Adapt mos-init startup to the approved static BusyBox producer while preserving
PID 1, authenticated deployment and disk selection, signed read-only verity,
watchdog, support mounts, persistent machine identity and the existing exitrd.

## ActiveForm

Adapting and verifying explicit BusyBox startup commands.

## Dependencies

- **blocked by**: Accepted B0 `20260910-1013-b0-lifecycle-rootfs-audit` and B1
  `20260910-1038-b1-pinned-static-busybox`, integrated through approved L2 HEAD
  `d910d456bd3345f12c96d36927afe37826d82318`.
- **blocks**: B3 shutdown and B7 integrated acceptance.

## Notes

- Campaign `mos-open-plans-20260910-100408`; owner session B2 `js1slhab`.
- Full tier, explicitly approved by the user before dispatch, including scoped
  local commits. No additional proposal approval is pending.
- Verified branch `bkd/js1slhab` and clean status before the authorized merge
  `ef28a3ec82ef1a4a0cc027c605fb1fa2c991e114`; approved upstream is an ancestor.
- Inspected #313 `5d0dca577a782aa707d9530779c4b23f2a7eda31`; preserve its board
  field, board-specific boot partition and FIT layout selection.
- No compatibility paths. No main, push, image/kernel/rootfs/QEMU/cold builds,
  sibling records or global changelog edits. Expensive build grant is zero.
- [Implementation plan](../plan/20260910-1142-b2-busybox-startup.md).

- Implemented explicit BusyBox startup commands, verified read-only loop identity,
  bounded occupied-device retries and target-init validation before moving mounts.
  Signature/verity, PARTUUID disk policy, watchdog, #313 board selection and
  systemd exitrd/manifest protections remain intact.
- RED/GREEN and pma-cr completed; 13 focused tests and 55 existing-suite tests pass.
  Two pre-existing ignored IO-fault tests remain unrun and are documented in the
  plan. Both real BusyBox architectures and startup assembly fixtures pass.
- Host lint (409/409), docs, shell syntax and diff checks pass. Shell-pipefail lint
  retains only the L2-accepted unrelated UI line-82 failure (154/155 clean, exit 2).
- Evidence: `/tmp/mos-b2-checks.FCEP0k/`, tmux `js1slhab-358534`. Exact commands,
  artifact identities, baseline limitations and B3/B7 pending rows are in the plan.

- Implementation commit `92b6f632a3303040e53a1945b6dc0f12351348ba` passes the final
  committed-source Rust, actual BusyBox, startup assembly and documentation gates.

- complete: B2 scoped software acceptance complete; accepted shell baseline and pending B3/B7 evidence are documented.
