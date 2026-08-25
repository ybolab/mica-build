# RFCT-110 PLAN-014 M4: the image-contract verifier ported to TS under a per-check parity gate

- **status**: pending
- **priority**: P1
- **owner**: -
- **createdAt**: 2026-08-25 10:50
- **plan**: PLAN-014 (M4)

Port `verify-image-v2.sh` (4,620 lines, both boards via runtime branches)
into `os/verify/`: board contracts become typed data, checks become
data-driven cases, and the migration is gated check-by-check on parity with
the shell verifier it replaces.

## Scope

- TS helpers for the existing no-host-mutation toolset (sgdisk, mtools at
  offset, dd-extract + debugfs/tune2fs, unsquashfs, userspace
  `veritysetup verify`).
- Check-by-check port; each migrated check lands in the same change as its
  negative-fixture test (the `ui-location-test.sh` suite and friends) —
  a port without its negative test is not done (RFCT-096).
- A parity harness that runs shell and TS verifiers against the same image
  and diffs conclusions per check, both boards, real images and mutated
  fixtures.
- Delete the shell verifier (and its now-ported fixture suites) only at
  full parity.

## Acceptance

- Identical pass/fail sets between shell and TS on both boards' current
  images and on every mutated fixture.
- The fixture suites fail when their target assertion is weakened
  (spot-check by reverting one check).
- Tool-less-host container path verified for the full verifier, not just
  the lint.

## Dependencies

- After RFCT-109. Runs in parallel with RFCT-111/112.
