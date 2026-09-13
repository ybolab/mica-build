## Project Development

This repository follows the PMA workflow. The actual rules live in the `/pma`
skill and the stack skills below — do not duplicate them here. If a rule in
this file ever conflicts with `/pma`, treat `/pma` as the source of truth and
update this file.

### Skill stack

- `/pma` — workflow control, three-phase gate, task and plan tracking
- `/pma-bun` — `verify/`, `build/`, `update-server/`, `tests/apid-api/`

The Rust workspaces live in their own repositories (`ybolab/micad`,
`ybolab/mica-deploy`) and arrive here as pinned archives (`deps/packages/`).

Large parts of this tree are bash and Dockerfiles (`rootfs/`, `build-env/`,
`build-env/`, `boot/`, `tests/`); no stack skill covers them, and `/pma`'s
*Delivery* rules apply directly.

### Triggers

Any feature, bug fix, refactor, planning, progress tracking, or multi-agent
execution goes through `/pma` (investigate → proposal → implement). Ceremony
is tiered by complexity per `/pma` *Task Tiers*: only trivial changes take
the fast path; everything else waits for explicit approval such as `proceed`.

### Project-specific facts

- Source dependencies: `build-env/` (`ybolab/mica-build-env`) and `rootfs/debian/` (`ybolab/mica-debian`) are fetched at their pins in `deps/sources/` by `make deps` and are gitignored; a change inside either is committed, pushed and released in its own repository, then pinned here with `make deps-bump DEP=<repository>`

- Primary language / runtime: Rust `1.96` (`micad:Cargo.toml` `rust-version`); Bun `1` pinned by digest as `IMAGE_BUN_1` in `build-env/images.env`
- Database / storage: none — micad persists to `DATA/state` and `DATA/meta` as files (`docs/design/`)
- Dev URL routing: not used; the API is exercised through `tests/apid-api/` against a QEMU guest
- Deployment target: embedded Linux images (signed file deployments, independent kernel/support and root components) for the boards, each a repository of its own (`ybolab/mica-<board>`) whose `board.env` and `evidence.json` are mirrored under `boards/`
- Quality-gate command: `make docs-verify` for documentation; the full gate set is the `make os-*` targets `.github/workflows/check.yml` runs — there is no single aggregate target yet
- Fast path: enabled (default)
- Build resources: do not impose fixed CPU, memory, swap, compiler-job or aggregate build-job quotas unless the user explicitly requests them. Use the available host resources and tool defaults. This supersedes historical task/plan resource envelopes and reservation requirements; apply the same policy to restored build wrappers.

### Local divergences

Any deliberate deviation from a skill rule (Hard Lock relaxation, alternative
library, non-default layout) is recorded in `docs/decisions/<YYYY-MM-DD>-<slug>.md`
with a sunset date. Do not silently override skill rules in this file.

### Documentation entry points

The records of this repository live in `ybolab/mica`, the project management
and documentation repository (`mica:docs/task/index.md`, `mica:docs/plan/index.md`,
`mica:docs/decisions/`, `mica:docs/architecture.md`, `mica:docs/changelog.md`);
a change here lands with its record there. The build harness is described in
`build/HARNESS.md` and the release verification commands in `build/release-verify.md`.
