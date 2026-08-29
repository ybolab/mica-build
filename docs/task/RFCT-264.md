# RFCT-264 PLAN-029 Amendment 2: the published API document describes behaviour only

- **status**: completed
- **priority**: P1
- **owner**: roy
- **createdAt**: 2026-08-29
- **plan**: PLAN-029

## What was measured (2026-08-29)

`os/pkgs/mosd/apid/openapi.json`, regenerated and free of record citations,
still carries **15,179 characters of operation description and 12,007 of
schema description**. Most of it is not a description of the surface.

| operation | chars | what the text is |
|---|---|---|
| `POST /api/v1/setup` | 2,100 | which milestone changed which behaviour, and why the browser wizard was left alone |
| `GET /api/v1/health` | 1,577 | an argument against serving from a cache the route does not use |
| `POST .../rotate-key` | 1,458 | the history of two error names that used to be one |
| `POST .../transient-root-password` | 1,068 | mostly behaviour, some rationale |

Seven operations carry **no description at all**, which is the opposite
failure and is fixed in the same pass.

The document also publishes `§2.4` / `§3.2` cross-references into
`docs/design/api.md`. A client holding only the spec cannot resolve them.

## Approach

`utoipa` publishes `///` and ignores `//`. That is the whole mechanism:

- `///` on a handler — what the operation does, what it takes, what it
  answers, which status codes and on what condition.
- `//` above it — the reasoning worth keeping for the next maintainer.
- Deleted — milestone archaeology ("this is the one behaviour this milestone
  changes rather than documents").

Same rule for `ToSchema` field docs.

The document is **regenerated** with `cargo run -p apid -- --openapi`, never
hand-edited; CI diffs the committed file against what the binary prints.

## Verification

- Every operation in the document has a description.
- No description contains `§`, a `docs/` path, or milestone narration.
- `os/pkgs/mosd/apid/openapi.json` equals `apid --openapi` output.
- 21 paths and 26 schemas unchanged — this is a documentation change, not an
  API change.
- `cargo check --workspace --all-targets` clean; both docs gates green.

## Outcome

The document now describes the surface and nothing else.

| | before | after |
|---|---|---|
| operation descriptions | 15,179 chars | **5,962** |
| operations with no description | 7 of 27 | **0** |
| schema descriptions | 12,007 chars | **9,593** |
| `§` cross-references | present | **0** |
| `docs/` paths | present | **0** |
| internal test names | present | **0** |
| milestone narration | present | **0** |
| document size | 113,959 bytes | **101,500** |
| paths / schemas | 21 / 26 | **21 / 26** — unchanged |

What moved where:

- **`///` now carries behaviour** — what the operation does, what it takes,
  what it answers, which status codes and on what condition. The seven
  operations that had only a one-line summary gained one.
- **`//` carries the reasoning** a maintainer needs and a client does not:
  why `/api/v1/health` must not read `access_cache`, why a duplicate peer is
  409 rather than 422, why the SSH remove route answers 404 where the pane
  answers 422. `utoipa` does not publish it.
- **Deleted**: milestone archaeology ("the one behaviour this milestone
  changes rather than documents"), the meta-paragraphs explaining why the
  comments avoid intra-doc links, and the `§2.4` / `§3.2` pointers into
  `docs/design/api.md` that a client holding only the spec cannot resolve.

`openapi.json` was regenerated with `cargo run -p apid -- --openapi` after
every edit, never hand-edited.

## Verification

- every operation has a description: **27 of 27**
- `§`, `docs/`, internal test names, "milestone" in the document: **0**
- 21 paths and 26 schemas unchanged — a documentation change, not an API change
- `cargo check --workspace --all-targets --locked`: **clean**
- `cargo test --workspace --locked`: **pass**
- `make docs-verify` / `docs-verify-test`: **green**
