# RFCT-287 Document native and container application delivery

- **status**: pending
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
