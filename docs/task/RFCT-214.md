# RFCT-214 PLAN-023 closeout: the api.md citation re-anchor, all three forms

- **status**: in progress
- **priority**: P1
- **owner**: bkd/5n3a7yq1
- **createdAt**: 2026-08-28
- **plan**: PLAN-023 (closeout, the citation census)

The citation census this task closes covers three syntactic forms, and only
the first of them has ever been held by a gate:

1. **Full** — a path and a line together, quoting what is there:
   *"fn api_router() -> Router<AppState> {"* (`os/pkgs/mosd/apid/src/routes.rs:397`).
   `docs/verify-citations.sh` resolves this form, and only this form.
2. **Shorthand** — a bare `` `:120` `` whose file is named by the table header
   or the surrounding prose rather than by the token itself.
3. **Continuation** — a bare `` `:358-359` `` inheriting its file from a full
   citation earlier on the same line.

Forms 2 and 3 are counted against the unquoted ratchet and never resolved, so
a green gate says nothing about them. Every defect this task exists to repair
lives in exactly the forms no gate has held.
