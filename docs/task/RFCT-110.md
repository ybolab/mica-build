# RFCT-110 PLAN-014 M4: the image-contract verifier ported to TS under a per-check parity gate

- **status**: in progress
- **priority**: P1
- **owner**: ai-agent
- **createdAt**: 2026-08-25 10:50
- **claimedAt**: 2026-08-25 22:04
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

## M4e — the gate, 2026-08-26

**Status stays `in progress`, deliberately.** Acceptance clause 3 —
"tool-less-host container path verified for the full verifier, not just the
lint" — **cannot be satisfied at the current pins**, and closing it is a scope
decision this milestone does not own. Everything else in M4e is done.

### Clause 3, measured rather than reasoned

Running the full verifier inside the pinned `IMAGE_BUN_1` on a host with neither
bun nor the image tools fails, and both sides of the seam fail for the same one
cause — **no docker client in the bun image**:

* the register's own seam: `createToolRuntime` refuses, *"this host has no
  sgdisk, … fdtget and no docker to run the pinned ones in"*;
* the oracle (before deletion): exit 127 at `os/verify-image-v2.sh:185`,
  `docker: command not found`;
* mounting the daemon socket changes neither — the missing thing is the client.

This did **not** close when the oracle was deleted: the full verifier is now the
register, and the register drives docker just as much.

**What would close it, also measured.** Bind-mounting the host's docker client
(a static binary) plus the socket into the pinned bun image, the full verifier
ran to completion on this tool-less host: `PARITY x64: PASS — 312 compared, 0
diverging, 0 unclaimed`, `rc=0`. So "a docker client added to the bun pin" is
**sufficient**, not merely plausible. Bun in that image can also reach the
daemon's HTTP API unaided (`fetch(..., { unix: '/var/run/docker.sock' })` → 200
on `/_ping`), which needs no pin but is a rewrite of `tools.ts`'s process seam.
Either way it is a decision about `os/build-env/images.env`, so it is reported
rather than taken.

### Clauses 1 and 2

**Clause 1** — identical pass/fail sets — was green and is the condition the
deletion was performed under: `cx3576` compared 398, `x64` compared 312, 0
diverging and 0 unclaimed on both, `rc=0`.

**Clause 2** — "the fixture suites fail when their target assertion is weakened"
— **driven, not read**. `checks-shape.ts`'s partition-count check was weakened
from `got === want` to `got >= 0` and the suite went **RED** on exactly the two
negative cases (`RED when the image is one partition short`, `RED when a cx3576
image carries x64's NINE partitions`) — `22 pass / 2 fail`. Restored: `24/24`,
`rc=0`.

### The deletion, and what it replaced

`os/verify-image-v2.sh` (4,637 lines), `os/tests/ui-location-test.sh` (1,612)
and `src/parity-cli.ts` are deleted. The scope sentence is "the shell verifier
it **replaces**", and nothing in the package could verify an image on its own —
the register only ever ran beside the oracle — so `src/verify-cli.ts` landed
with the deletion. It reproduces the oracle's own summary line on both boards:

    x64      RESULT: PASS (290/290 checks, 22 skipped (x64/grub))      rc=0
    cx3576   RESULT: FAIL (387/395 checks, 3 skipped (cx3576/uboot))   rc=1

cx3576's eight FAILs are the BSP byte-compares whose source tree a checkout does
not carry; the oracle failed those identically, and PLAN-014:220-223 puts BSP
builds out of scope.

`make os-verify-parity` and `make os-ui-location-test` are **removed** rather
than kept able to refuse. `os/verify/HARNESS.md` records every defect the
deletion froze, marked SHIPS or GONE — including two that were expected to leave
with the file and did not, because their reproductions live in the port.
