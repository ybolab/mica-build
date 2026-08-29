# RFCT-263 PLAN-029 Amendment 1: code stops citing records, and docs/zh covers design in full

- **status**: completed
- **priority**: P1
- **owner**: roy
- **createdAt**: 2026-08-29
- **plan**: PLAN-029

## Scope

**1. Remove every `docs/task/` and `docs/plan/` reference from non-docs files.**
Measured at 390 references across 125 files — the `docs/task/X.md` path form
(97), bare `RFCT-NNN` / `PLAN-NNN` mentions (154), record-plus-subpart forms
like `PLAN-019 M3` (79), parentheticals (25) and possessives (13).

The reason is a dependency direction, not tidiness. A task record describes
how a thing was implemented; an implementation that cites the record inverts
that, and since records are deleted when they close, every citation is a dead
link waiting to happen.

`os/pkgs/mosd/apid/openapi.json` is the case that matters most: `utoipa`
copies `routes.rs` doc comments into the published document, so a client
reading the API spec is shown `docs/task/RFCT-210.md`. It is fixed in
`routes.rs` and regenerated with `cargo run -p apid -- --openapi`, never
hand-edited — CI diffs the committed document against what the binary prints.

**2. `docs/zh/design/` covers all sixteen design documents**, not the six that
happened to have a `*.zh.md` sibling before.

## Verification

- `git grep -nE '\\b(RFCT|PLAN)-[0-9]+'` outside `docs/` returns nothing.
- `os/pkgs/mosd/apid/openapi.json` equals `apid --openapi` output.
- The Rust gate, the two bun suites and both docs gates stay green.
- Every `docs/design/*.md` has a `docs/zh/design/` counterpart, and
  `docs/zh/README.md` lists them.

## Outcome

**1. Code no longer cites records — 390 references across 125 files removed.**

| shape | count | how |
|---|---|---|
| parentheticals and appositives | ~115 | mechanical, delimiter-anchored |
| `(deleted: PLAN-NNN)` annotations | 98 | normalised to `(deleted)` |
| subject-position prose | 177 | rewritten sentence by sentence |

`git grep -nE '\b(RFCT|PLAN)-[0-9]+' -- . ':!docs/'` now returns **0**.

`os/pkgs/mosd/apid/openapi.json` was **regenerated**, never hand-edited:
`routes.rs`'s doc comments were fixed first and the document rebuilt with
`cargo run -p apid -- --openapi`. Nine description lines changed; the 21 paths
and 26 schemas are unchanged.

**Two further classes surfaced while doing it, and were cleared too.**
RFCT-262's dangling check had required a `.md` suffix, so it missed bare
`RFCT-NNN` mentions:

- **179 record references in the living design documents**, 149 of them to
  deleted records — now 0.
- **94 references to the deleted `docs/research/` documents** across
  `dashboard.md` (81), `api.md` (11), `access.md` and `bus.md` — now 0.

**2. `docs/zh/design/` covers all sixteen design documents**, up from six.
Ten written: `api`, `bus`, `bsp-cx3576-sync`, `build-harness`, `connd`,
`containers`, `dashboard`, `release-signing`, `ro-root`,
`uboot-ab-handshake`. `docs/zh/README.md` lists them all.

## Verification

- `git grep` for record references outside `docs/`: **0**
- record references in `docs/design/` + `architecture.md`: **0**
- references to deleted research documents in living docs: **0**
- `cargo check --workspace --all-targets --locked`: **clean**
- `os/pkgs/mosd/apid/openapi.json` == `apid --openapi`: **yes**, regenerated
- `make docs-verify`: **104/104 PASS**; `make docs-verify-test`: **17/17**
- every `docs/design/*.md` has a `docs/zh/design/` counterpart: **16/16**
- no dangling markdown links in `docs/` apart from the two Usage templates the
  gate itself excludes
