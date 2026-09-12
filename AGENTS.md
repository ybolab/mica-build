## Project Development

This repository follows the PMA workflow. The actual rules live in the `/pma`
skill and the stack skills below — do not duplicate them here. If a rule in
this file ever conflicts with `/pma`, treat `/pma` as the source of truth and
update this file.

### Skill stack

- `/pma` — workflow control, three-phase gate, task and plan tracking
- `/pma-rust` — `pkgs/mosd/` (mosd, apid, mos-mqttd, broker, settings), `pkgs/mos-deploy/`
- `/pma-bun` — `verify/`, `build/`, `update-server/`, `pkgs/mosd/tests/apid-api/`
- `/pma-web` — `pkgs/mosd/apid/ui/` (React + Vite, embedded into apid)

Large parts of this tree are bash and Dockerfiles (`rootfs/`, `build-env/`,
`boards/*/bsp/`, `tests/`); no stack skill covers them, and `/pma`'s
*Delivery* rules apply directly.

### Triggers

Any feature, bug fix, refactor, planning, progress tracking, or multi-agent
execution goes through `/pma` (investigate → proposal → implement). Ceremony
is tiered by complexity per `/pma` *Task Tiers*: only trivial changes take
the fast path; everything else waits for explicit approval such as `proceed`.

### Project-specific facts

- Primary language / runtime: Rust `1.96` (`pkgs/mosd/Cargo.toml` `rust-version`); Bun `1` pinned by digest as `IMAGE_BUN_1` in `build-env/images.env`
- Database / storage: none — mosd persists to `DATA/state` and `DATA/meta` as files (`docs/design/`)
- Dev URL routing: not used; the API is exercised through `pkgs/mosd/tests/apid-api/` against a QEMU guest
- Deployment target: embedded Linux images (signed file deployments, independent kernel/support and root components) for the boards under `boards/`
- Quality-gate command: `make docs-verify` for documentation; the full gate set is the `make os-*` targets `.github/workflows/check.yml` runs — there is no single aggregate target yet
- Fast path: enabled (default)
- Build resources: do not impose fixed CPU, memory, swap, compiler-job or aggregate build-job quotas unless the user explicitly requests them. Use the available host resources and tool defaults. This supersedes historical task/plan resource envelopes and reservation requirements; apply the same policy to restored build wrappers.

### Local divergences

Any deliberate deviation from a skill rule (Hard Lock relaxation, alternative
library, non-default layout) is recorded in `docs/decisions/<YYYY-MM-DD>-<slug>.md`
with a sunset date. Do not silently override skill rules in this file.

### Documentation entry points

- Catalog and ownership rules: `docs/README.md` (product name Mica OS; `mos` prefixes stay in identifiers)
- Board status: `docs/boards/support-tiers.md`
- Docs gates: `tools/docs/` (run through `make docs-verify` and `make docs-verify-test`)
- Tasks: `docs/task/index.md`
- Plans: `docs/plan/index.md`
- Decisions: `docs/decisions/`
- Architecture: `docs/architecture.md`
- Changelog: `docs/changelog.md`
