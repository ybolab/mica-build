# RFCT-223 A scheduled upstream-tag check for the container engine's six pins

- **status**: pending
- **priority**: P2
- **owner**: (unclaimed)
- **createdAt**: 2026-08-28
- **plan**: PLAN-012 (M5 residue, filed by PLAN-024 M2; routed to PLAN-025-class work)

PLAN-012 M5 — supply-chain tracking — is the one milestone of that plan that
was never built. `os/pkgs/podman/versions.env` pins six upstreams in three
languages and nothing in the tree watches any of them. PLAN-012's own Risks
section calls that mitigation not optional, so the plan closes (Amendment 1,
2026-08-28) with this filed rather than with an unticked box left behind.
RFCT-221 is the audit that measured it; nothing here needs re-auditing.

## Scope when claimed

Add a check that reads each pin in `os/pkgs/podman/versions.env`, asks each
upstream for its newest release tag, and fails when a pin is behind.

Three things make this harder than a loop over six URLs:

- The six upstreams do not share a tag convention — some are `v`-prefixed and
  some are not — so the comparison cannot be string equality against a
  normalised guess.
- catatonit's upstream is quiet by nature. The check must distinguish "behind"
  from "unchanged", and must not read a two-year-old newest tag as a failure.
- The check needs network access, which the fast CI lane does not have. Wire
  it into the privileged lane's existing weekly schedule rather than adding a
  second cron.

## Acceptance criteria

1. A run against the current tree is green.
2. A run with any one pin edited backwards is red, and names that component,
   its pinned tag and the newer one.
3. The failure text tells the reader to edit `versions.env` and re-run
   `make podman`.
4. The catatonit case — a quiet upstream that is correctly pinned — is covered
   by a test, not by an assumption.

## Files it is expected to touch

`.github/workflows/privileged.yml`, a new checker under `os/pkgs/podman` or
`os/tools`, `Makefile` if it gets a target, `os/pkgs/podman/README.md`.

## Dependencies

- **blocked by**: (none — claimable any time)
- **blocks**: nothing. The pins are correct today; this is the mechanism that
  keeps them measurable rather than assumed.
