# RFCT-336 Compose a minimal MOS runtime from explicit payloads

- **status**: in_progress
- **priority**: P1
- **owner**: maintainer/runtime-minimal-20260906
- **createdAt**: 2026-09-06 10:54

## Description

Plan an OCI-style runtime composition that uses locked Debian archives as inputs without inheriting Debian's bootstrap package floor. Separate debug and boot artifacts, select runtime files and dependencies explicitly, and reduce general-purpose tools while retaining the system's required capabilities. The user requested a reviewable plan; implementation is not yet approved.

## ActiveForm

Awaiting review of the runtime minimization proposal; implementation has not started.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

- Backward compatibility is not required during development unless explicitly requested by the user.
- Prior read-only investigation measured the current x64 and cx3576 artifacts, package-owned files, and ELF dependencies. Findings and acceptance criteria are recorded in [PLAN-086](../plan/PLAN-086.md).
- The draft passed `make docs-verify`, new-record index/status/link checks, and whitespace checks. Only the task, plan, and their index entries changed; implementation approval remains pending.
- The device-management proposal now retains udev and required rules without any static hwdb sources or compiled database. Runtime udev state and kernel-module indexes remain in scope as required functionality.

## Acceptance

- The plan records measured baselines, concrete runtime decisions, implementation order, scope, risks, and alternatives.
- Implementation, after approval, separates bootstrap installation from final runtime selection and preserves pinned archive provenance.
- Final acceptance covers both architectures, complete x64 QEMU/API execution, boot/update artifact consistency, and explicit limits on physical-board evidence.
