# RFCT-287 Document native and container application delivery

- **status**: completed
- **priority**: P1
- **owner**: unassigned
- **createdAt**: 2026-09-01
- **plan**: [PLAN-051](../plan/PLAN-051.md)

## Description

Publish and test the trusted-integrator paths for OS-integrated native programs
and independently delivered OCI/Quadlet applications.

## Acceptance

- The decision guide routes native code into build-time `.deb` composition and
  RAUC lifecycle, and independent apps into pinned OCI/Quadlet delivery.
- Tested examples cover users, startup, state/data, health/logs, named hardware
  access and CPU/memory/PID/I/O limits.
- Container guidance covers registry credentials, digest verification, manual
  rollback and data/schema compatibility.
- Documentation states that signature admission, mandatory ceilings, a secret
  store and automatic app rollback are not currently enforced.
- Managed/untrusted application controls are left to a new conditional plan.

## ActiveForm

Documenting tested native and container delivery paths.

## Dependencies

- **blocked by**: explicit approval of PLAN-051; stable update, persistence and application API contracts
- **blocks**: supported customer application integration

## Notes

- Documentation and tested examples are appropriate for the default trusted
  product integrator; they are not non-bypassable policy.

## Completion (2026-09-03)

All five acceptance clauses are met; the full record, including what is not
closed, is PLAN-051's Completion section.

- Decision guide: `docs/user/applications.md` section 1 — one routing
  question, eight rows of device facts, into
  `docs/design/native-applications.md` and `docs/design/containers.md`.
- Tested examples: three new Quadlet files in `docs/design/containers.md`
  covering users, health and logs, named hardware and the CPU/memory/PID/I-O
  ceilings; startup and state/data were already covered. All nine run through
  the shipped generator in `tests/quadlet-doc-test.sh`, now 35 assertions,
  each new one confirmed to fail when its example is mutated.
- Container guidance: `docs/design/containers.md` section 9 — registry
  credentials, digest pinning with `Pull=never`, digest-flip rollback and its
  dependence on the previous image still being present, and the data/schema
  hazard.
- Limits: `docs/user/applications.md` section 6 — signature admission,
  mandatory ceilings, a secret store and automatic application rollback as a
  grouped `unsupported`, with the native whole-slot rollback stated separately
  as `shipped` so it neither disappears nor reads as more than it is.
- Managed/untrusted: `docs/plan/PLAN-069.md`, conditional, with a trigger.

Verified: `make docs-verify` (five gates), `make docs-verify-test` (five
negative suites, 44 cases) and `bash tests/quadlet-doc-test.sh` (35 checks)
all green. The change touches only `docs/` and `tests/quadlet-doc-test.sh`,
so no other gate applies.

**Not closed:** no native example is executed by a gate — only its file
citations are; nothing was run on hardware; `docs/zh/design/` was not
mirrored; and the index rows in `docs/plan/index.md` and `docs/task/index.md`
are owed, including a row for the new PLAN-069.
