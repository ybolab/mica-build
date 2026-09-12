# Decisions

One file per decision, named `<YYYY-MM-DD>-<slug>.md`. Each record states its
`kind`, owner, status and review sunset, then the decision, rationale and
removal condition. Records describe the decision as it stands; history is in
`docs/changelog.md`.

Kinds:

- **skill divergence** — a deliberate deviation from a `/pma` or stack-skill
  rule. `AGENTS.md` links here and does not restate the rationale.
- **engineering decision** — a cross-cutting technical choice that no single
  design record owns.

| Record | Kind | Sunset |
|---|---|---|
| [Bounded lifecycle ioctl boundary](2026-09-10-bounded-lifecycle-ioctl.md) | stack-skill divergence | 2026-12-10 |
