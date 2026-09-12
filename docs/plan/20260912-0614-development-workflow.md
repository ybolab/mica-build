# 20260912-0614-development-workflow Simplify development integration and acceptance workflow

- **status**: completed
- **createdAt**: 2026-09-12 06:14
- **approvedAt**: 2026-09-12 06:03 UTC
- **relatedTask**: [20260912-0614-development-workflow](../task/20260912-0614-development-workflow.md)

## Context

Reviewed source, image production and full runtime acceptance were coupled to
repeated coordinator approvals. A 30-minute L1 watchdog and a second 15-minute B
scan duplicated observation. Historical failure classification and artifact
identity checks repeatedly delayed already-approved successors. The user now
requests source integration before workflow refactoring.

## Proposal

1. Integrate reviewed B and D locally, preserving current main research and the
   unrelated uncommitted package-repository proposal. Keep all acceptance gaps.
2. Document a single candidate/owner sequence: complete input preflight, changed
   producers, root and smoke, signing/assembly, then isolated-image scenarios.
3. Separate source review from qualification. Fix evidenced in-scope call chains
   without per-stage approval; review changed code once and rerun only affected
   consumers. Preserve trust, authentication, fresh-image-only behavior and
   actual source identities.
4. Keep the user-requested half-hour L1 watchdog, replace its stale prompt, and
   remove B's duplicate periodic scan. B remains the event-driven reviewer of
   the same B7 execution. Send the exact main/policy/schedule handoff once.

## Verification

- Reviewed-source equality and focused integration checks before main update.
- Documentation structure, status, links and negative fixtures after policy edit.
- API readback verifies the replacement L1 prompt/schedule and removed B cron.
- Existing B7 keeps its issue, worktree, immutable image and active execution.
- Guest, final ARM cold samples and physical-board rows stay pending.

## Scope and limits

This is an operational workflow refactor and runbook update. A unified durable
build executor, automatic per-package cache keys and package repository splitting
are separate implementation work, not claimed delivered here. No toolchain,
signature, release CLI or device-runtime change; no push or done transition.

## Risks

Early source integration does not establish runtime qualification. Record both
facts separately. Event-driven review retains the existing half-hour watchdog
as recovery coverage; resource grants and actual-process checks remain enforced.

## Alternatives

Retaining the old layered per-stage approvals would preserve the demonstrated
waiting overhead. Replacing the entire build system during active x64 acceptance
would invalidate working inputs and is outside this bounded refactor.
