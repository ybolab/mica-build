# RFCT-225 The image-freshness guard did not survive the verifier port, and exists in no module today

- **status**: pending
- **priority**: P2
- **owner**: (unclaimed)
- **createdAt**: 2026-08-28
- **plan**: PLAN-013 (M1.1 residue, filed by PLAN-024 M2; routed to PLAN-025-class work)

PLAN-013 M1.1 raised a specific defect in the shell image verifier: an x64
run's freshness was decided by arm64 artifacts. The milestone asked for the
guard to be generalised, not removed.

RFCT-222 measured what the port actually did. The shell verifier was deleted
and rebuilt as the bun/TypeScript package `os/verify/` under PLAN-014 M4's
per-check parity gate, and every other property M1.1 asked for came across.
The freshness comparison did not: there is no freshness or staleness check in
any module of `os/verify` today. The original defect is moot only because the
check it lived in is gone.

**This is filed as a silent loss of coverage, not as a generalisation that was
completed differently.** That distinction is the finding, and it is why
PLAN-013 closes with this named rather than folded into "superseded". A
verifier can now be run against a stale image and will say nothing about it.

## Scope when claimed

First decide whether the guard should exist at all — the parity gate that
governed the port did not flag its absence, which means either the gate's
per-check list never carried it or the loss was accepted without a record.
Establish which, because if the check was deliberately dropped, this task is a
one-line note in `os/verify` and a closing amendment, not a rebuild.

If it should exist, rebuild it board-correctly: an image's freshness is
decided by the artifacts of that image's own board and architecture, never by
another board's. The original defect must not be reintroduced by a
board-agnostic mtime comparison.

## Acceptance criteria

Whichever branch is taken, the outcome is written down where the next reader
finds it rather than left to inference.

If rebuilt:

1. A check in `os/verify` compares the image against the artifacts of its own
   board, and reports staleness as a named result rather than a silent pass.
2. A negative fixture proves the check can fail — the standard this tree holds
   every image assertion to.
3. Running the verifier for one board is unaffected by another board's
   artifacts, asserted by a test that plants the cross-board case PLAN-013
   M1.1 originally reported.

If deliberately dropped:

1. `os/verify` carries a note saying so and why, and the parity record for the
   port is corrected to show the check as intentionally not ported.

## Files it is expected to touch

`os/verify/src/` (check plus fixture and test) or, on the drop branch,
`os/verify` documentation and the port's parity record.

## Dependencies

- **blocked by**: (none — claimable any time)
- **blocks**: nothing. No current gate depends on freshness, which is the
  problem this records.
