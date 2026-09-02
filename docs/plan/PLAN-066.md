# PLAN-066 Isolate built-in UI build outputs

- **status**: completed
- **createdAt**: 2026-09-02 20:34
- **approvedAt**: 2026-09-02 20:34
- **completedAt**: 2026-09-02 20:49
- **relatedTask**: [UI-010](../task/UI-010.md)

## Context

PLAN-065 correctly removed generated UI assets from Git and made them an
explicit input to `apid/build.rs`, but its producer still defaults to a host
Bun installation and writes the normal result back into `apid/ui/dist`.
Pinned-container target and package builds bind the entire repository
read-write so that both Vite and Cargo can write into source-adjacent output
directories. The UI quality entry repeats the local-versus-container fallback.

The repository already pins the Bun and Rust builder images, keeps build caches
under `_out/`, and has a source-only contract test for the APID UI producer.
No generated UI path is part of the runtime contract: Rust only needs one
validated directory through `MOS_APID_UI_DIST_DIR` before `build.rs` copies it
into Cargo `OUT_DIR`.

## Proposal

1. Replace the UI builder's local fallback and arbitrary output options with a
   fixed container-only build. Bind `apid/ui` at `/source:ro`, bind only
   `_out/apid-ui` writable at `/build`, copy source into a disposable work tree,
   and produce `_out/apid-ui/dist`.
2. Make the UI quality entry invoke the same builder in check mode so install,
   lint, typecheck, tests and production build share one pinned environment and
   one isolated write boundary.
3. Extend the build-contract test first so the current host-Bun fallback,
   source-tree output and writable Rust source mounts fail the gate.
4. Update local Rust checks, target builds, package-producer builds and CI to
   use `_out/apid-ui/dist`. Give Rust containers a read-only repository mount,
   a separate writable Cargo target mount, and a read-only UI asset mount.
5. Update the current build, API and Chinese UI development documentation,
   then run the focused contract, frontend, APID and shell/documentation gates.

## Risks

- Bun tools may generate route metadata or TypeScript build information. The
  disposable writable copy intentionally accepts those writes without
  weakening the source mount.
- A failed build may leave diagnostic files under ignored `_out/apid-ui/work`;
  the next invocation clears that exact fixed work tree before use.
- Concurrent UI builders in one checkout share one fixed output. Repository CI
  jobs use isolated checkouts; same-checkout concurrent builds remain outside
  this single-producer contract.
- Read-only Rust source requires every Cargo output to honor the separately
  mounted `CARGO_TARGET_DIR`; the contract test and real target build cover that
  handoff.

## Scope

In scope: APID UI build/check scripts, Rust check/cross-build/package scripts,
the existing build-contract test, CI paths and descriptions, current API/build
and explicitly Chinese UI development documentation, PMA records and
changelog.

Out of scope: UI behavior or visual changes, runtime routing and VFS behavior,
custom UI bundle storage, dependency upgrades, compatibility with the
development-stage `ui/dist` producer, and unrelated build-system refactors.

## Alternatives

1. **Mount writable subdirectories over a read-only UI source tree.** Rejected
   because TypeScript and TanStack code generation can add or replace files in
   several locations; a disposable copied workspace gives them one explicit
   write boundary.
2. **Keep the host-Bun fast path.** Rejected because it reintroduces an
   unpinned toolchain and makes local and release builds follow different
   producer paths.
3. **Run Bun from `apid/build.rs`.** Rejected because Cargo remains the consumer
   of a completed frontend artifact, not the owner of the JavaScript toolchain.

## Annotations

- 2026-09-02: The user approved the container-only correction with read-only
  source mapping and repository `_out/` build output.
- 2026-09-02: Verification found that the current pinned Bun/Vitest V8
  coverage merge overflows after all 18 test files pass. The failure also
  reproduces through PLAN-065's prior direct source mount, so it is tracked
  separately as UI-011 rather than widening this build-isolation change.
- 2026-09-02: Delivered the fixed pinned-container producer, read-only UI and
  repository mounts, separate writable frontend/Cargo outputs, read-only Cargo
  asset handoff, path hardening and caller-owned output. Consecutive production
  builds produced the same tree hash; the focused contract, APID VFS tests,
  shell gate, workflow YAML parse and complete documentation gates passed.
  Local diff review found and fixed the symlink and root-owned-output risks,
  then passed with no remaining high-confidence findings.
