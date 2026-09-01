# PLAN-055 Flatten the os/ directory into the repository root

- **status**: completed
- **completedAt**: 2026-09-02 00:55
- **approvedAt**: 2026-09-01 23:20
- **createdAt**: 2026-09-01 23:05
- **relatedTask**: [RFCT-291](../task/RFCT-291.md)

## Context

The repository root holds `Makefile`, `README.md`, `LICENSE`, `docs/` and
`os/` -- everything that is the operating system lives one level down, and
nothing else lives beside it. The `os/` wrapper dates from when the tree was
expected to hold more than the OS; it never did, so the level carries a name
without carrying a distinction, and every path in the repository pays one
directory of depth for it.

Measured surface: 382 tracked files carry `os/` references, ~3.9k
occurrences. Three classes matter beyond search-and-replace:

- **Self-locating scripts.** `os/build-env/deb/{build,preflight,producers,
  repo,version}.sh` derive the repository root as a fixed number of levels
  above themselves (and say so in their error text); `os/build/src/paths.ts`
  and `os/verify/src/paths.ts` use `ascendTo(SRC_DIR, 3, 'Makefile')`;
  `os/pkgs/mosd/hack/*`, `apid/ui/run.sh`, `tests/apid-api/*`, the cx3576
  BSP Makefile and board render.sh carry the same arithmetic. Each moves up
  by exactly one level. (`resolve.sh` and `rootfs-manifest-test.sh` walk up
  to the Makefile and need no change.)
- **Build-facing paths.** producer.env `BUILD_CONTEXTS`/`VERSION_FROM`
  values, Dockerfile `--mount=source=os/...` binds, the compose driver's
  `--stages-dir`, `.gitignore` entries, and both GitHub workflows (path
  filters and commands).
- **Prose.** Design docs and READMEs cite `os/...` paths throughout; a few
  sentences reference "the os/ tree" as a concept.

## Proposal

1. `git mv os/{boards,build,build-env,pkgs,rootfs,tests,tools,verify} .` --
   no name collides with anything at the root.
2. Mechanical replacement of the eight concrete prefixes (`os/build-env`
   before `os/build`) across tracked files, excluding the historical records
   (`docs/CHANGELOG.md`, `docs/plan/`, `docs/task/` keep the paths they were
   written with). This form cannot touch non-path text such as `macOS/`.
3. Depth fixes in every self-locating script and the two `paths.ts`
   (`ascendTo(..., 2, ...)`), with their error text updated to the new
   arithmetic.
4. A manual pass over the residual `os/` hits (bare "under os/", globs,
   prose) and over the Makefile's comments. **Make target names keep their
   `os-` prefix** (`os-debs`, `os-verify-cx3576`, ...): they are names, not
   paths, CI and habit both call them, and renaming them is a separate
   decision this plan does not take.
5. Acceptance battery, same as PLAN-041's: producers discovered (11),
   `make os-debs` (the pool needs restamping since 851c4fa4 anyway) ->
   `deb-package-gate` -> preflight-test -> rootfs-manifest-test -> compose
   x64 -> mkimage -> verify with the QEMU smoke, plus both bun suites and
   `bash -n` over every moved shell script.

## Risks

- **The concurrent session.** Another task works in this same checkout; a
  tree-wide move under an active writer loses its edits or strands them
  under recreated `os/` paths. The move must not start until that session
  is idle and committed -- the tree is clean at proposal time, but idle has
  to be confirmed by the operator, not inferred from a snapshot.
- Self-locator arithmetic is the class the mechanical pass cannot fix and
  the class that fails strangest when wrong (scripts resolving `/srv` as
  the repository). Each is fixed by hand and the battery exercises all of
  them.
- Docker layer caches key on build-context paths; the first build after the
  move is cold for the producers whose context path changed. Cost, not
  risk.
- In-flight artifacts under `_out/` reference nothing path-dependent; the
  pool must be rebuilt regardless (stamp moved at 851c4fa4).

## Alternatives considered

- Keeping `os/` and moving `docs/` into it: inverts the problem, and the
  root stays a wrapper.
- Also renaming the `os-*` make targets: doubles the blast radius for a
  cosmetic gain; deferred to its own decision.

## Completion

Delivered as proposed. 666 renames, 378 files through the eight-prefix
mechanical pass, and ~30 self-locators moved up one level (the five
build-env/deb scripts, rootfs/build.sh, every tests/ suite, the apid-api
harness in both shell and TypeScript, the mosd hack scripts, the ui runner,
tools/qemu-seed-state.sh, the cx3576 BSP Makefile, and both paths.ts, whose
OS_DIR — now equal to REPO_ROOT — was retired outright). Two classes escaped
the mechanical pass and were swept by their own greps: regex-escaped forms
(`os\/pkgs`, 17 hits) and segmented join components (`join(REPO_ROOT, 'os',
…)`, 15 hits — the latter made verify fail 400 tests at once until found).
Deliberate residues: citations to the deleted os/mkimage-common.sh, one
commit-pinned measurement in api.md (`… os/` at 86cd669), and the historical
records.

Accepted at the flat layout: build 747/747, verify 1132/1132, docs-verify
51/51, rootfs-manifest-test 36/36, shell-pipefail-lint 52/52, preflight 61
inputs over 11 producers, then the heavy battery — `make os-debs` (pool
restamped at git851c4fa4.dirty), deb-package-gate 234/234,
deb-preflight-test 25/25, composed x64 image with QEMU smoke 12/12 and
verify 293/293.
