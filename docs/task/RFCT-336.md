# RFCT-336 Compose a minimal MOS runtime from explicit payloads

- **status**: in_progress
- **priority**: P1
- **owner**: bkd/8t4ghqi6
- **createdAt**: 2026-09-06 10:54

## Description

Implement the remaining explicit-runtime composition work from PLAN-086 using
locked Debian archives without inheriting Debian's bootstrap package floor. S1,
S2 and S4 shipped. Campaign B owns S3 and S6 through its B1-B7 sequence. The
user rejected S5 on 2026-09-08: general shell/network-tool reduction is not
deferred or owed, and the separate BusyBox startup/shutdown work does not revive
it.

## ActiveForm

Coordinating PLAN-086 S3/S6 through campaign workstream B.

## Dependencies

- **blocked by**: campaign B sequence B1 through B7
- **blocks**: final explicit-runtime and cold-build acceptance

## Notes

- Backward compatibility is not required during development unless explicitly requested by the user.
- Prior read-only investigation measured the current x64 and cx3576 artifacts, package-owned files, and ELF dependencies. Findings and acceptance criteria are recorded in [PLAN-086](../plan/PLAN-086.md).
- The draft passed `make docs-verify`, new-record index/status/link checks, and whitespace checks. Only the task, plan, and their index entries changed; implementation approval remains pending.
- The device-management proposal now retains udev and required rules without any static hwdb sources or compiled database. Runtime udev state and kernel-module indexes remain in scope as required functionality.
- 2026-09-10: S5 remains rejected in meaning: no general shell/network-tool
  reduction, outbound-SSH removal or PAM/NSS/crypto pruning is authorized.
  B's static BusyBox boot and shutdown closure is separate work.

## Acceptance

- The plan records measured baselines, concrete runtime decisions, implementation order, scope, risks, and alternatives.
- Implementation, after approval, separates bootstrap installation from final runtime selection and preserves pinned archive provenance.
- Final acceptance covers both architectures, complete x64 QEMU/API execution, boot/update artifact consistency, and explicit limits on physical-board evidence.

- unclaim: Transferred remaining S3/S6 coordination to campaign workstream B; S5 stays declined.
