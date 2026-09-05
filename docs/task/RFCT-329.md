# RFCT-329 The documents PLAN-070 F10/F11 and PLAN-071 U9 owe

- **status**: in_progress
- **priority**: P1
- **owner**: plan070-f10-f11-plan071-u9/bkd-eeme30d5
- **createdAt**: 2026-09-05 06:00
- **worktree**: `/srv/bkd/worktrees/33z9aa5q/eeme30d5`, branch `bkd/eeme30d5`

## Description

Three documentation slices, taken as one task because **F10 and U9 both
rewrite `docs/design/updates.md` §2** and two branches on that section would
conflict on the paragraph that matters most.

- **F10** (PLAN-070) — the design tree catches up to the `meta/` seam and the
  `/mos/config/` namespace: `recovery.md` §2.1, `updates.md` §2 and §7,
  `release-signing.md` §2.3/§2.5 plus the custody split of PLAN-070 §6.2,
  `provisioning.md` §4, `manufacturing.md` §1, `security-model.md` §3, and
  `pkgs/rauc-sign/README.md`'s anchor section.
- **U9** (PLAN-071) — `updates.md` §2, §3, §5, §6 and `remote-management.md`
  §3.
- **F11** (PLAN-070) — the operator documentation: which resets return the
  device to its baked defaults, and the residue of §5 consequence 4 in its
  amended form.

## ActiveForm

Writing what the last three weeks made true into the design and operator
trees.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Acceptance

- The three lists complete, each item traceable to the section named.
- `make docs-verify` green — all five gates.
- `docs/zh/` mirrors updated where `docs/zh/verify-coverage.sh` requires it,
  and the ungated lag listed.
