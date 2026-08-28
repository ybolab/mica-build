# RFCT-216 rauc-sign root-rotation tooling, before the first ceremony's one-year expiry

- **status**: pending
- **priority**: P1
- **owner**: (unclaimed)
- **createdAt**: 2026-08-28
- **plan**: PLAN-023 (Amendment 1, decision 3)

The key-custody decision (option A: vendor-held offline single root) makes
root rotation load-bearing: without a rotation command, the TUF root's
1-year horizon turns option A's fleet-wide failure mode from a risk into a
certainty on a timer, and a compromised online key ends the repository's
lineage. The signing tool has no command that produces a rotated root today,
and the design records the 1-year horizon as the deadline for building it.

Scope when claimed: `os/pkgs/rauc-sign` — a rotation command producing a new
root signed by the old (the TUF cross-sign), tests over the verifier's
acceptance of the rotated chain, and the ceremony runbook's rotation section
made executable. Delegated roles (option C's prerequisite) are adjacent but
not required here.

## Dependencies

- **blocked by**: (none — claimable any time; the deadline is the first
  production ceremony + 1 year)
- **blocks**: any option-C migration; the first annual root refresh.
