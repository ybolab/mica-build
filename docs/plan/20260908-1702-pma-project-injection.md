# 20260908-1702-pma-project-injection Wire the repository into the PMA workflow

- **status**: completed
- **createdAt**: 2026-09-08 17:02
- **approvedAt**: 2026-09-08 17:02
- **relatedTask**: 20260908-1702-pma-project-injection

## Context

Measured on 2026-09-08 against the PMA skill as updated at 15:42 UTC:

- No `AGENTS.md` or `CLAUDE.md` at the repository root; the skill's
  `project-injection.md` expects both, with `CLAUDE.md` a symlink.
- `docs/CHANGELOG.md` (uppercase) referenced from 18 Markdown files, none
  of them a gate or script; the skill names `docs/changelog.md`.
- No `docs/decisions/`; no `.gitattributes`, `.editorconfig` or
  `.env.example`.
- Two records created under the interim slug-first naming
  (`file-ab-signed-components-20260908T1423Z`, `…T1428Z`) with exactly
  four pointers between them: one index line each, the task's `relatedPlan`,
  the plan's `relatedTask`.
- No single aggregate quality-gate `make` target exists; CI calls the
  `make os-*` targets individually. Four of five `package.json` files
  declare no `engines`.

## Proposal

1. Create `AGENTS.md` from the skill template with the measured values
   (stack skills `/pma-rust`, `/pma-bun`, `/pma-web`; Rust 1.96; Bun 1 by
   digest; fast path enabled) and `CLAUDE.md -> AGENTS.md`.
2. `git mv docs/CHANGELOG.md docs/changelog.md` and rewrite the 18
   references.
3. Rename the two records to `20260908-1423-…` / `20260908-1428-…` and
   rewrite their four pointers and two headings.
4. Add `docs/decisions/README.md`, `.gitattributes` (LF, generated files,
   binary board inputs), `.editorconfig` (rustfmt 4/100, TS 2, Makefile
   tab), `.env.example` (every `MOS_BUILD_*` / `MOSD_*` key the tree reads).
5. Record the renames and the injection in `docs/changelog.md` as a
   `[decision]` entry.

## Risks

- A case-only rename is a trap on case-insensitive filesystems; this tree
  builds on Linux and `git mv` records the rename cleanly. Contributors on
  macOS/Windows should pull rather than merge across the rename.
- `docs/verify-status.sh` still requires a `proposed` task to cite a
  `PLAN-[0-9]+.md`; a timestamp-named plan will not satisfy that regex. Not
  changed here — it is a gate, not a record — and left as the first follow-up.

## Scope

Root: `AGENTS.md`, `CLAUDE.md`, `.gitattributes`, `.editorconfig`,
`.env.example`. Docs: the changelog rename plus 18 references, two record
renames plus four pointers, two index lines, `docs/decisions/README.md`,
this plan and its task.

## Alternatives

- Keep `CHANGELOG.md` and declare it a local divergence in
  `docs/decisions/`: rejected by the user; the rename is 18 prose edits.
- Leave the two slug-first records: the skill protects *numbered* files from
  renaming, not these; the user chose to rename.

## Annotations

- 2026-09-08 17:02: approved by the user with the three values above; implemented in
  the same pass.

## Follow-ups (not in this plan)

- Relax `docs/verify-status.sh:128` to accept `docs/plan/<timestamp>-<slug>.md`.
- An aggregate quality-gate target so `AGENTS.md` can name one command.
- `engines` in the four `package.json` files that lack it.
