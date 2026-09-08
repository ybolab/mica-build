# 20260908-1702-pma-project-injection Wire the repository into the PMA workflow

- **status**: completed
- **priority**: P1
- **owner**: l1/6rjx4wrt
- **createdAt**: 2026-09-08 17:02

## Description

Bring the repository up to the PMA skill's project baseline as it stands on
2026-09-08 15:42 UTC: a project injection (`AGENTS.md` with `CLAUDE.md` as a
symlink), the lowercase `docs/changelog.md` the skill names, a
`docs/decisions/` directory, the three missing repository-hygiene files
(`.gitattributes`, `.editorconfig`, `.env.example`), and the two records
created under the interim slug-first naming renamed to the current
`<timestamp>-<feature-slug>` shape.

Acceptance: `make docs-verify` green in-tree and from a `git archive` into an
empty directory; `git ls-files -s CLAUDE.md` reports mode `120000`; no
reference to `CHANGELOG.md` or to either old record ID survives under
`docs/`.

## ActiveForm

Wiring the repository into the PMA workflow.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

- Decided by the user on 2026-09-08: changelog goes lowercase; fast path
  stays enabled; the two slug-first records are renamed.
- Plan: [20260908-1702-pma-project-injection](../plan/20260908-1702-pma-project-injection.md).
