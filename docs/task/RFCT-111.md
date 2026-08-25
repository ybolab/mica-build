# RFCT-111 PLAN-014 M5: the rootfs build split into one Dockerfile per stage, driven from TS

- **status**: pending
- **priority**: P1
- **owner**: -
- **createdAt**: 2026-08-25 10:50
- **plan**: PLAN-014 (M5)

Split the 1,798-line `Dockerfile.v2` into the `rootfs/stages/` chain — one
Dockerfile per stage, chained via local image tags, sequenced by the TS
build driver (decision 2: the deliverable is an img, layer duplication is
acceptable, composition wins).

## Scope

- `stages/10-base` (system-essential floor), `20-install` (seed units,
  repart.d), `30-feature-*` (containers, mqtt, radios, ssh — one per
  switchable feature, replacing `WITH_*` args with stage selection),
  `40-board` (board overlay + firmware from `boards/<b>`), `90-pack`
  (squashfs+verity, determinism normalisation).
- Inline shell blobs extracted to `rootfs/scripts/`.
- The `os/health/` byte-identical duplicates collapse into the overlay copy;
  their tests move to `os/tests/`.
- The TS driver sequences the chain and records the stage list per build.

## Acceptance

- Assembled image byte-identical to the single-file build where achievable;
  if apt-layer reordering makes that unattainable, the fallback gate is full
  verifier parity plus an explicitly anchored new-baseline commit — decided
  and recorded, not improvised.
- Negative test: omitting a feature stage turns that feature's verifier
  checks red.
- Both boards build and verify green through the chain.

## Dependencies

- After RFCT-108 (pinned bases) and RFCT-109 (driver foundation).
