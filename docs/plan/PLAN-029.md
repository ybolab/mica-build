# PLAN-029 Documentation system rebuild: decouple docs from code, prune settled records, re-anchor on the current version

- **status**: completed
- **createdAt**: 2026-08-29
- **approvedAt**: 2026-08-29
- **completedAt**: 2026-08-29
- **relatedTask**: RFCT-262 (M1-M5), RFCT-263 (Amendment 1), RFCT-264 (Amendment 2)
- **milestones**: M1 strip code-location coupling and defer the API surface to OpenAPI; M2 retire the citation gate machinery the coupling required; M3 prune settled PMA records to the open set; M4 compress stale documents and rebuild the index on the current version; M5 drop the tests that guard what M1–M4 delete

## Context

The documentation tree is 276 markdown files and 77,319 lines. Its dominant
cost is not the prose but a coupling: documents cite code by `path:line`, so
every code edit can falsify a document that was never wrong about design. The
campaign that ran through PLAN-020 and PLAN-028 built increasingly precise
machinery to keep those citations fresh, and the machinery is now larger than
most of the documents it guards.

### What was measured (2026-08-29, at 47ce188)

Coupling, by document set:

| set | files | lines | `path:line` citations |
|---|---|---|---|
| `docs/task/` | 213 | 53,683 | 2,044 across 133 files |
| `docs/design/` | 22 | 13,532 | 1,451 across 9 files |
| `docs/plan/` | 29 | 6,666 | 63 across 10 files |
| `docs/research/` | 7 | 2,990 | 284 across 3 files |
| `docs/architecture.md` | 1 | — | 1 |

3,843 `path:line` citations in total, plus 164 narrative line references
(`line N` / `第 N 行`). The three densest documents are
`docs/design/api.md` (811), `docs/design/dashboard.md` (168) and
`docs/research/mos-ui-inventory.md` (155).

The machinery that exists only to keep those citations resolvable:

| file | lines |
|---|---|
| `docs/verify-citations.sh` | 821 |
| `docs/verify-citations-test.sh` | 820 |
| `docs/verify-index.sh` | 352 |
| `docs/verify-index-test.sh` | 396 |
| three citation baselines | 180 |
| **total** | **2,569** |

Wired into `Makefile` as `docs-verify`, `docs-verify-citations` and their
`-test` variants.

The replacement for the largest coupled document already exists and is
generated from the code rather than transcribed from it:
`os/pkgs/mosd/apid/openapi.json` — OpenAPI v1, 21 paths, 26 schemas, 2,758
lines, emitted by `os/pkgs/mosd/apid/src/openapi.rs`. `docs/design/api.md`
spends its §1 and §2 (lines 96–2045 of 4,849) restating that surface in prose
carrying 811 line citations.

### The settled-record backlog

`docs/task/` holds 212 RFCT records; 205 are `completed`. `docs/plan/` holds
28 PLAN records; 23 are `completed` or `completed by supersession`.

Open set to be preserved:

- Tasks: RFCT-005, RFCT-007, RFCT-008 (`in progress`), RFCT-257
  (`in progress` — pass 1 of 2), RFCT-253, RFCT-260, RFCT-261 (`pending`).
- Plans: PLAN-006 (`partially implemented`), PLAN-007 (`implementing`),
  PLAN-008 (`draft`), PLAN-010 (`in progress`).
- PLAN-005 is `rejected (superseded by PLAN-006)` — not implemented, and not
  intended to be. Its disposition is a decision for the approval gate, not a
  default.

Deletion is recoverable: every record is tracked, so the history retains what
the working tree drops.

## Proposal

### M1 — Decouple documents from code

Remove `path:line` citations and narrative line references from
`docs/design/`, `docs/research/` and `docs/architecture.md`. Where a document
needs to name an implementation, it names the module or the contract, never a
line. `docs/design/api.md` §1–§2 collapse into a short surface summary that
points at `os/pkgs/mosd/apid/openapi.json` as the authority for routes,
schemas and status codes; the design rationale in §3–§9 stays, since OpenAPI
does not carry it.

### M2 — Retire the citation gate machinery

With citations gone, `docs/verify-citations.sh`, its test, and the three
baselines have nothing left to assert. Remove them and their two `Makefile`
targets. `docs/verify-index.sh` is kept but reduced: index-to-file agreement
in both directions stays useful and cheap; the status-marker assertions stay
because they guard the records M3 preserves.

### M3 — Prune settled PMA records

Delete the 205 completed RFCT records and the 23 completed PLAN records,
keeping the 7 open tasks and 4 open plans listed above. Rewrite
`docs/task/index.md` and `docs/plan/index.md` to the surviving set.

### M4 — Compress and re-anchor

Fold what the deleted records established, and that is still true of the
current version, into the design documents that own each subject, so the
knowledge survives the record that carried it. Rebuild `docs/README.md` as the
index of the resulting tree.

### M5 — Drop the tests that guard what M1–M4 delete

The test surface was measured before proposing anything, because "remove the
redundant tests" is only safe where redundancy is shown rather than assumed.

| suite | files | lines | runs in CI |
|---|---|---|---|
| `os/verify/src` | 33 | 16,316 | yes (`os-verify-test`) |
| `test/apid-api` | 33 | 11,916 | **no** |
| `os/build/src` | 25 | 8,137 | yes, privileged (`os-build-test`) |
| `os/tests` | 11 | 2,158 | partly |
| doc gates | 2 | 1,216 | yes (`docs-verify-test`, `docs-verify-citations-test`) |
| Rust `#[test]` | 46 files | 402 tests | yes |

What the measurement does NOT support: a broad prune. `os/verify/src` runs a
test-to-source ratio of 0.84 and `os/build/src` 1.06, and both map close to
one test file per module. There is no bloat to cut there, and cutting anyway
would be the "extra workload" this milestone exists to avoid.

What it does support:

1. `docs/verify-citations-test.sh` (820 lines) dies with its subject in M2,
   together with the `docs-verify-citations` and `docs-verify-citations-test`
   steps in `.github/workflows/check.yml`. `docs/verify-index-test.sh` (396)
   shrinks to match the reduced gate.
2. `os-layout-lint-test` is `os/verify/run.sh src/lint.test.ts` — a filename
   filter over a suite `os-verify-test` already runs whole. CI invokes neither
   it nor its sibling; it is an unused convenience target.
3. `make os-apid-api-test` (11,916 lines, the largest single suite) runs
   nowhere in CI, which `check.yml` states outright. That is a standing
   decision to surface, not a defect to fix silently: either it earns a CI job
   or it is acknowledged as a manual harness.

Anything beyond these three is out of scope for this plan.

## Decisions taken at the approval gate (2026-08-29)

1. **PLAN-005 is deleted.** `rejected (superseded by PLAN-006)` is not an open
   plan; keeping it would preserve a record of a road not taken.
2. **The nine `*.zh.md` siblings are deleted, and `docs/zh/` is created in
   their place.** The Chinese documentation is rewritten there against the
   current version rather than carried forward as stale translations. This is
   an explicit request for Chinese documents, so `docs/zh/` is the one part of
   the tree where Chinese is the intended language.
3. **`docs/research/` is deleted in full.** The Venus OS comparison work is no
   longer needed, which removes the reason the directory existed.
4. **`test/apid-api` stays a manual harness.** It boots x64 QEMU; putting it
   in CI would lengthen the feedback loop for a suite that is run
   deliberately. Its manual status gets written down instead of left implicit.

## Risks

- **Knowledge loss.** A completed record can hold the only written account of
  why something is the way it is. M4 runs before M3's deletion, not after, so
  the fold-forward is done while the source is still in the tree.
- **Gate regression.** `docs/verify-index.sh` asserts both indexes in both
  directions; M3 must land the index rewrite and the file deletions together
  or the gate fails between them.
- **Translation drift.** Nine `*.zh.md` siblings exist and are excluded from
  every current gate because their currency was never decided. M4 either
  re-anchors or drops them; leaving them unaddressed reproduces the drift.
- **api.md over-reduction.** §3–§9 carry proposed-but-unbuilt design. Cutting
  by citation density alone would delete the forward-looking half of the
  document.

## Scope

In scope: `docs/` in its entirety, the four `Makefile` doc targets, and the
gate scripts under `docs/`.

Out of scope: `os/verify/` and `test/` (code-level checks, not documentation),
the OpenAPI generator itself, and any change to the API surface.

## Alternatives considered

- **Keep citations, keep the gate.** Rejected by the request; also the status
  quo whose cost this plan measures.
- **Convert `path:line` to `path` only.** Cheaper, and keeps a weaker
  coupling: a moved file still falsifies a document. Viable as a fallback for
  documents where naming the module genuinely helps the reader.
- **Archive rather than delete settled records.** Moving 228 files to
  `docs/archive/` preserves them in the tree at the cost of keeping the tree
  large. Git history already provides this, which is why deletion is proposed.

## Amendment 1 (2026-08-29) — the two things M1 and M4 left short

Raised by the user on review of the M1-M5 outcome.

**1. Code must not reference `docs/task/` or `docs/plan/` at all.** RFCT-262
left 97 such references in place and recorded the cost as the reason. That
measurement was also too small: counting bare `RFCT-NNN` and `PLAN-NNN`
mentions as well as the `docs/task/X.md` path form gives **390 references
across 125 files**. The rule is now stated rather than costed: task and plan
records are the history of how something was implemented, and an
implementation that points back at them inverts the dependency — the record
describes the code, not the code the record. Records are deleted when they
close, so every such pointer is a future dead link by construction.

The sharpest case is `os/pkgs/mosd/apid/openapi.json`: `utoipa` copies the
doc comments from `routes.rs` into the published document, so these
references are **shipped to API clients**. They are fixed at the source and
the document regenerated, never edited in place.

**2. `docs/zh/` covers `design/` in full.** M4 wrote Chinese for the six
documents that previously had a `*.zh.md` sibling, which reproduced an old
subset rather than covering the tree. All sixteen design documents get a
Chinese counterpart.

### Amendment 1 outcome

Both items landed under RFCT-263. Measured after:

| | before | after |
|---|---|---|
| record references outside `docs/` | 390 in 125 files | **0** |
| record references in living design docs | 179 (149 dangling) | **0** |
| references to the deleted `docs/research/` | 94 | **0** |
| `docs/design/` documents with a Chinese counterpart | 6 of 16 | **16 of 16** |

Two of those rows are classes RFCT-262's own dangling check could not see: it
matched `RFCT-NNN.md` and so missed every bare `RFCT-NNN`. The check is the
thing that was wrong, not the judgement made from it — which is why the
verification for this amendment counts the bare form.

`openapi.json` was regenerated from `routes.rs` rather than edited, so the
CI drift check between the committed document and `apid --openapi` still holds.

## Amendment 2 (2026-08-29) — the published API document describes behaviour, not reasoning

Raised by the user: the OpenAPI document is generated from code comments and
should describe **what the endpoint does now**, nothing else.

It does not today. Measured on the regenerated document: **15,179 characters
of operation descriptions and 12,007 of schema descriptions**, and the bulk of
it is design rationale, campaign history and cross-references to
`docs/design/api.md` section numbers (`§2.4`, `§3.2`) that mean nothing to a
client holding only the spec. `POST /api/v1/setup` spends 2,100 characters
explaining which milestone changed which behaviour and why the browser wizard
was deliberately left alone; `GET /api/v1/health` spends 1,577 arguing against
a cache it does not use.

The split is mechanical in Rust and is the fix: `///` is published by
`utoipa`, `//` is not. So the operation's behaviour stays in `///` — what it
does, what it takes, what it answers, which status codes and when — and the
reasoning either becomes a `//` comment for the next maintainer or goes, where
it is pure milestone archaeology.

Scope: the 28 `#[utoipa::path]` handlers and the `ToSchema` field
documentation in `os/pkgs/mosd/apid/src/`. The document is regenerated, never
hand-edited.

### Amendment 2 outcome

Operation descriptions 15,179 -> 5,962 characters, schema descriptions 12,007
-> 9,593, and the seven operations that carried no description at all now have
one. Zero `§` cross-references, zero `docs/` paths, zero internal test names
and zero milestone narration remain in the published document. 21 paths and 26
schemas are unchanged, so this is a documentation change and not an API
change. The reasoning did not vanish — it moved to `//`, which `utoipa` does
not publish.
