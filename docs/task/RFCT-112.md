# RFCT-112 PLAN-014 M6: the assemblers ported to TS under the byte-identity gate

- **status**: in progress
- **priority**: P1
- **owner**: ai-agent
- **createdAt**: 2026-08-25 10:50
- **claimedAt**: 2026-08-25 21:42
- **plan**: PLAN-014 (M6)

Port `mkimage-v2.sh` (cx3576), `mkimage-x64.sh`, `bundle.sh` and build
orchestration to TypeScript in `os/build/` (decision 3). The shell versions
are the comparison oracle: byte-identical output from identical inputs, then
they are deleted. No permanent dual maintenance.

## Scope

- Same external toolset (sgdisk, mtools, dd, mkimage, veritysetup, rauc via
  the pinned containers) driven through Bun.$; geometry typed from
  `boards/<b>/board.env`.
- The guards move with the code: slot-pin strict mode, boot-attempts range,
  stale-partition-number and loader-content refusals, the uboot-mos-only
  rule — each with the selftest coverage `mkimage-v2-selftest.sh` gives
  them today (ported to `os/tests/`).
- Bundle building and dev-key signing (`update/`) included.

## Acceptance

- Shell and TS assemblers produce byte-identical images from identical
  inputs, both boards; byte-identical bundles for cx3576.
- The ported selftest still refuses the deliberately-stale inputs.
- Shell assemblers and selftest deleted afterwards;
  `shell-pipefail-lint` scope shrinks to the remaining device-side shell.

## Dependencies

- After RFCT-109; oracle comparison needs the pre-port shell scripts, so the
  deletion is the last commit of this task.
