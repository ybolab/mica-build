# RFCT-262 PLAN-029: rebuild the documentation system on the current version

- **status**: completed
- **priority**: P1
- **owner**: roy
- **createdAt**: 2026-08-29
- **plan**: PLAN-029

One record for all five milestones. PLAN-029 removes record proliferation as
one of its goals, so it does not open five records to do it.

## Milestones

- **M1** — strip `path:line` citations and narrative line references from the
  surviving documents; point the API surface at
  `os/pkgs/mosd/apid/openapi.json`, which CI already holds equal to what the
  binary prints.
- **M2** — remove `docs/verify-citations.sh`, its test, its three baselines,
  the two `Makefile` targets and the two CI steps that ran them; reduce
  `docs/verify-index.sh` to the sets that still exist.
- **M3** — delete the 205 completed `RFCT-*` records and the 24 closed
  `PLAN-*` records (23 completed plus PLAN-005, rejected); rewrite both
  indexes to the surviving set.
- **M4** — delete `docs/research/` and the nine `*.zh.md` siblings; create
  `docs/zh/` with Chinese documentation rewritten against the current version;
  rebuild `docs/README.md`.
- **M5** — drop `os-layout-lint-test`; record `test/apid-api` as a manual
  harness.

## Verification

- `bash docs/verify-index.sh` passes after every milestone that moves files or
  index rows, not only at the end.
- No surviving document links to a deleted file.
- No `path:line` citation remains in the surviving documents.
- `make docs-verify docs-verify-test` is green and the citation targets are
  gone from both the `Makefile` and `.github/workflows/check.yml`.

## Outcome

All five milestones landed. Measured against the tree at 47ce188:

| | before | after |
|---|---|---|
| `docs/` markdown files | 276 | 42 |
| `docs/` lines | 77,319 | 17,306 |
| `path:line` citations in documents | 3,843 | 0 |
| doc-gate machinery | 2,569 lines, 2 scripts + 3 baselines | 746 lines, 1 script |
| `RFCT-*` records | 212 | 8 |
| `PLAN-*` records | 28 | 5 |
| CI doc steps | 2 | 1 |

- **M1** — 1,610 `path:line` citations stripped from the design documents and
  `architecture.md`, plus 8 narrative line references. api.md 1.2 (the
  transcribed route table, 204 lines) and 2.3 (the operation inventory, 151
  lines) collapsed to point at `os/pkgs/mosd/apid/openapi.json`; the three
  passages other sections cite by name were kept, de-narrated.
- **M2** — `docs/verify-citations.sh`, its test and its three baselines deleted
  (1,821 lines), with their two `Makefile` targets and the CI step that ran them.
- **M3** — 205 completed `RFCT-*` and 24 closed `PLAN-*` deleted, both indexes
  rewritten. RFCT-257 and RFCT-261 closed as obsoleted: both were scoped
  against the citation gate M2 removed.
- **M4** — `docs/research/` deleted (7 files) and the index gate's now-empty
  research section removed with it; the 8 `*.zh.md` siblings replaced by
  `docs/zh/` written against the current version; `docs/README.md` rebuilt.
  `mosd.md` re-anchored: it claimed schema v4 in one heading and v7 in another
  while the code is at v8, and five reconcilers where seven are registered.
- **M5** — `os-layout-lint-test` removed (a filename filter over a suite
  `os-verify-test` runs whole, invoked by nothing). `test/apid-api`'s
  manual-harness status written into `build-harness.md` section 6. The index
  gate's negative suite kept green at 17/17: its research case was removed with
  the directory, and its plan cases now mint their own completed plan instead of
  borrowing a real one that the M3 rule would prune.

## Left open, deliberately

97 references to deleted records survive in 24 non-docs files (`routes.rs` 33,
`apid/src/tests.rs` 26, `openapi.json` 8, others fewer). They sit mid-sentence
in doc comments, and `openapi.json` is generated from `src/openapi.rs` and held
equal to the binary by CI, so clearing them is a 24-file prose edit plus a
regeneration rather than a substitution. They resolve in the history. Raised
rather than done, because the cost is out of proportion to a dead pointer in a
comment.
