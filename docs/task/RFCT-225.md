# RFCT-225 The image-freshness guard did not survive the verifier port, and exists in no module today

- **status**: completed
- **priority**: P2
- **owner**: bkd/mgxwq4br
- **createdAt**: 2026-08-28
- **completedAt**: 2026-08-28
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

## Outcome, 2026-08-28 — REBUILT (PLAN-027 M5)

Scope asked, before any code, which of two things was true: the parity gate's
per-check list never carried the guard, or the loss was noticed and accepted
without a record. **The first, and structurally so — the guard could not have
been a member of that list.** Nothing was deliberately dropped, so the
one-line-note branch does not apply and the check is rebuilt.

### The decision, with the file and line that shows it

The guard was a **prologue preflight in the shell verifier**, not a check. At
the commit before its deletion it read the image path, compared two build
inputs against it, printed `error:` **on stderr** and `exit 1` — all of it
above the check loop:

    $ git show 6eadc65^:os/verify-image-v2.sh | sed -n '100,115p'
        if [ "${MOS_VERIFY_ALLOW_STALE:-0}" != "1" ]; then
            stale=""
            # Board-derived, not literal. These named cx3576 and out-arm64
            # whatever board was being verified, so an x64 run's freshness was
            # judged by arm64 artefacts -- it would pass on a stale x64 image and
            # refuse a fresh one whenever the arm64 tree happened to be newer.
            for input in "${REPO_ROOT}/_out/${MOS_BOARD}/rootfs-verity.img" \
                         "${REPO_ROOT}/os/podman/out-${MOS_ARCH}/podman"; do
                [ -e "${input}" ] || continue
                [ "${input}" -nt "${IMG}" ] && stale="${stale} ${input##*/}"
            done
            if [ -n "${stale}" ]; then
                echo "error: ${IMG##*/} is OLDER than${stale}. ..." >&2
                exit 1
            fi
        fi
    fi

The parity harness compared **conclusions**. `os/verify/src/parity.ts`'s
`parseShellRun` ingests only lines carrying a verdict prefix and the summary
line — `VERDICT_PREFIX` is `PASS: `, `FAIL: `, `SKIP: `, and the one other
branch is `if (!text.startsWith('RESULT: ')) continue` — and
`src/parity-cli.ts`, deleted at the same commit, fed it `shellOut.stdout` and
nothing else, under a comment reading *"Run the shell oracle. Its stdout IS the
input to the diff"*. A preflight that publishes no conclusion therefore could
not appear as a row, could not diverge, and could not even be counted
`not-ported`/`unclaimed` — the harness's own category for "the shell concluded;
no registered check claims that line" is driven from printed conclusions.

Two further measurements close the question:

- The deleted `src/parity-cli.ts` spawned the oracle with `MOS_BOARD` set and
  `MOS_VERIFY_ALLOW_STALE` unset. The guard was live during every parity
  run: it was a *precondition of the comparison*, never a member of it. Had it
  fired, `parseShellRun` would have thrown its "printed no `RESULT:` line"
  error rather than reporting a divergence.
- The defect ledger written immediately before the deletion —
  `docs/task/RFCT-110.md`'s *"record every defect the deletion would freeze"*
  pass, commit `5dfa880`, `os/verify/HARNESS.md` — mentions staleness nowhere.
  `grep -rn MOS_VERIFY_ALLOW_STALE` over the tree at HEAD returns exactly one
  hit, in `docs/task/RFCT-103.md` — the record that introduced the guard.
  There is no acceptance of the loss anywhere, because nothing observed it.

The brief's premise was re-measured and **held**:
`grep -rniE '\b(freshness|stale|staleness)\b' os/verify/src/` returns 22 hits at
HEAD `c5f7e96`, every one an unrelated comment or an error string about a stale
constant or path. The nearest thing to a freshness check was
`uboot-blob-matches-variant-cx3576`, which byte-compares one bootloader blob on
one board — not a freshness comparison, and cx3576-only.

### What was built

`os/verify/src/checks-freshness.ts`, registered in `src/checks.ts` as
`image-fresher-than-build-inputs`, applying to every board.

- **Board-derived, both inputs.** The packed root from `ctx.outDir`, which is
  `_out/<board>` for the board under test; the container engine from that
  board's own `MOS_ARCH`, as `os/pkgs/podman/out-<arch>/podman`. The literals
  PLAN-013 M1.1 reported appear nowhere. A board declaring no `MOS_ARCH`
  **throws** rather than failing — a missing key is a statement about the board
  definition, not about the image.
- **Every direction named.** Newer input → `FAIL:` naming which. No input
  present → `SKIP:`, because zero comparisons made is the shape a green takes
  when it asserted nothing. `MOS_VERIFY_ALLOW_STALE=1` → a second `SKIP:` that
  says so; the one escape the original offered is carried across rather than
  dropped a second time. Absent inputs are named in the message in every
  direction.
- mtime and not a hash, as the original had it.

### Acceptance

1. **A check comparing the image against its own board's artefacts, staleness a
   named result** — `src/checks-freshness.ts`.
2. **Negative fixtures** — `src/checks-freshness.test.ts`: the packed root
   newer, the engine newer, both newer, and one-present-one-absent, each
   required red and each required to name the input.
3. **The cross-board case, planted** — one tree with x64's own inputs older than
   the image and cx3576's *and* arm64's newer. The x64 run must pass and its
   message must name neither `cx3576` nor `arm64`; the **control** runs the same
   tree as cx3576 and must go red, so a check that simply never looked at the
   other board cannot satisfy the first case.
4. **Written down** — `os/verify/HARNESS.md` §12, which records why the guard was
   a preflight, why that made it invisible to the parity gate, and the
   cross-board case; plus the coverage-table row in §8 and this section.

### Gates

    bash docs/verify-index.sh       863/863 PASS       (unchanged from the base)
    bash docs/verify-citations.sh   2170/2170 PASS rc=0 (unchanged from the base)
    bash os/verify/run.sh           base 1080/1080 across 32 files, rc=0
                                    after 1092/1092 across 33 files, rc=0

The twelve new tests are this check's. `--verify` against a real image is not
run here: no assembled image exists on this host, and building one is out of
this task's scope.

### Residue

- `docs/plan/PLAN-013.md`'s Amendment 1 still lists this as *"filed as
  RFCT-225, pending, routed to PLAN-025-class work"*. That plan is closed and
  this task closes under PLAN-027 M5; the sentence is stale but amending a
  closed plan's closeout was not in this task's scope.
- `docs/task/RFCT-150.md` carries a row describing `os/verify/src/checks.ts`
  line 278 as a register invariant stated at the code that holds it, and that
  line is the `digestOf` doc comment — description and anchor disagree. The
  mismatch predates this task (it is already so at `89fecde`, the last
  re-anchoring pass) and was not introduced here; the anchor was carried
  forward mechanically, not repaired.
