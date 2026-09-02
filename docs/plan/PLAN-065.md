# PLAN-065 Generate built-in UI assets during the build

- **status**: completed
- **createdAt**: 2026-09-02 11:55
- **approvedAt**: 2026-09-02 11:55
- **completedAt**: 2026-09-02 12:20
- **relatedTask**: [UI-009](../task/UI-009.md)

## Context

The built-in React/Vite application lives at `pkgs/mosd/apid/ui`, but its
production `dist` tree is currently committed. `pkgs/mosd/apid/build.rs` walks
that fixed source-tree location and emits an `include_bytes!` table. The UI
gate builds into a temporary directory and compares every byte against the
committed copy.

APID is compiled through three repository-owned paths: the local Rust gate in
`pkgs/mosd/hack/check.sh`, the complete target build in
`pkgs/mosd/hack/build-target.sh`, and per-producer packaging in
`pkgs/mosd/hack/build-deb.sh`. The two cross-build scripts run Cargo in the
pinned Rust container, which intentionally does not own the JavaScript
toolchain. CI also invokes the frontend gate independently on a host without
Bun, using the pinned Bun container fallback.

This makes `.gitignore` alone insufficient: a clean checkout would have no
asset tree for Cargo, while the existing quality gate would still require a
repository copy. The frontend must remain a separate producer that finishes
before Rust compilation, and Cargo must consume the resulting directory
explicitly.

## Proposal

1. Add a single frontend production-build script beside the SPA. It resolves
   the repository's pinned Bun image when Bun is absent, accepts an explicit
   output directory, clears only that exact output, runs the normal Vite build,
   and verifies a non-empty `index.html`.
2. Change the UI quality gate to run install, lint, typecheck and tests, then
   invoke that production builder. Remove the committed-tree byte comparison.
3. Ignore `ui/dist/` and remove every file below it from Git tracking.
4. Update each repository-owned Rust build entry to run the frontend builder
   first and export an absolute `MOS_APID_UI_DIST_DIR`. Make `apid/build.rs`
   require that variable, validate the generated tree, copy accepted inputs
   into Cargo's `OUT_DIR`, and generate the same sorted embedded VFS from those
   copies.
5. Add a focused build-contract test that fails while generated assets remain
   tracked or ignored status/build-script wiring is absent. Run it before and
   after implementation, then run the frontend and Rust gates.
6. Update the UI development guide, API design description, CI step wording,
   build documentation, task/plan state and changelog.

## Risks

- A Rust command that bypasses repository build entry points will now fail
  clearly unless it builds the SPA and supplies `MOS_APID_UI_DIST_DIR`.
- Cross-builds need a writable frontend output before entering the Rust
  container. The existing Bun-or-pinned-container fallback keeps this
  independent from host Bun installation.
- Vite empties the selected production directory. The build entry restricts
  output to ignored `ui/dist` or repository `_out/` paths and refuses any
  source ancestor, symlink or arbitrary filesystem directory before invoking
  the toolchain.
- Cargo incremental rebuilds must notice both an environment-path change and
  file changes within that directory. The build script will emit both rerun
  directives.

## Scope

In scope: the APID frontend build and quality scripts, `ui/dist` ignore and
tracking state, APID build-script input handling, local and cross Rust build
entry points, focused build-contract coverage, CI wording, the relevant API,
build and Chinese UI development documentation, PMA records and changelog.

Out of scope: changes to UI behavior or visuals, runtime asset routing, custom
UI package storage, public API contracts, dependency upgrades, historical plan
records, and compatibility with the pre-release committed-output workflow.

## Alternatives

1. **Run Bun from `build.rs`.** Rejected because it couples Cargo metadata and
   cross compilation to a JavaScript toolchain and hides a producer boundary.
2. **Keep a committed placeholder or archive.** Rejected because generated UI
   output would remain source-controlled in another form.
3. **Generate Rust source containing absolute asset paths directly.** Rejected
   in favor of copying accepted assets into `OUT_DIR`, which keeps generated
   Rust independent of checkout paths and narrows `include_bytes!` inputs to
   Cargo-owned output.

## Annotations

- 2026-09-02: The user approved implementation after asking that `ui/dist/` be
  treated as an ignored build artifact.
- 2026-09-02: Delivered the ignored generated-asset contract, guarded Bun build
  entry, explicit Cargo input, local and cross-build wiring, CI and design
  documentation updates. The source-only contract test, frontend lint,
  typecheck, 29 tests with coverage, local and pinned-container builds, APID
  embedded-VFS tests, Rust 1.96 formatting and clippy, shell gate and complete
  documentation gates passed. Review found and fixed unsafe output-directory
  handling and the Rust-only container handoff before completion.
