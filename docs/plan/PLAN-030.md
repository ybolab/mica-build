# PLAN-030 Consolidate mosd workspace-level test harnesses

- **status**: completed
- **createdAt**: 2026-08-29
- **approvedAt**: 2026-08-29
- **relatedTask**: [RFCT-265](../task/RFCT-265.md)

## Context

The only repository-root test tree, `test/apid-api`, is a standalone Bun
package dedicated to the mosd APID service and the booted OS image around it.
Its runner imports `os/pkgs/mosd/apid/openapi.json`, launches the x64 image,
and exercises APID over the guest boundary. It is therefore owned by the mosd
workspace rather than by the repository as a whole.

The mosd workspace already has another workspace-level black-box test in
`os/pkgs/mosd/hack/dbus-policy-test.sh`. Build helpers belong in `hack/`, but
that policy test does not. Meanwhile, Rust unit tests under `src/` and Cargo
integration tests under each crate's `tests/` are correctly placed for Cargo
discovery and should not be centralized.

The APID harness contains relocation-sensitive repository-root calculations,
container working directories, fixture paths, documentation examples, and
external callers. Moving only the directory would silently break those
contracts.

## Proposal

1. Establish `os/pkgs/mosd/tests/` as the single home for mosd
   workspace-level and black-box test harnesses. Add a short English README
   that documents the boundary: workspace harnesses live here; Rust unit and
   Cargo integration tests remain crate-local.
2. Move `test/apid-api/` wholesale to
   `os/pkgs/mosd/tests/apid-api/`, preserving its independent `package.json`,
   `bun.lock`, executable bits, fixtures, and result conventions. Do not add
   it to a Bun monorepo because it is an isolated test tool with no shared
   TypeScript packages.
3. Repair the APID suite's path contracts: shell and TypeScript repository-root
   discovery, Docker workdirs, mounted fixture paths, Make targets, image
   metadata, verification tools, shell-lint inputs, and current documentation
   or comments.
4. Move `os/pkgs/mosd/hack/dbus-policy-test.sh` to
   `os/pkgs/mosd/tests/dbus-policy-test.sh` and update its Make target and all
   current documentation/comments that name the old path. Keep the remaining
   build and check orchestration in `hack/`.
5. Update the repository layout documentation in `README.md`,
   `docs/architecture.md`, and `docs/design/build-harness.md`. Also make only
   the corresponding path/layout corrections in the specifically affected
   Chinese documents, `docs/zh/architecture.md` and
   `docs/zh/design/build-harness.md`, so they do not retain broken commands.
6. Verify that no current reference to either old path remains, excluding
   historical records in `docs/CHANGELOG.md`. Run the APID harness typecheck,
   self-test, and spec-pin checks; repository shell/index checks; and relevant
   mosd tests. Run the full QEMU suite only if its image prerequisites are
   available, otherwise record that limitation.
7. During the relocation review, audit current repository documentation and
   code comments against the implementation. Repair high-confidence factual
   errors, stale paths, and comments that materially misstate behavior. Keep
   unrelated behavioral findings out of this refactor and record them as
   follow-up tasks when they cannot be fixed safely within the approved scope.
8. Remove source-line citations from current design documentation and replace
   references to deleted shell implementations with current modules or direct
   contract language. Repair the incomplete sentences left by the earlier
   task-record reference cleanup. Verify these classes are absent with
   repository-wide searches rather than relying on visual sampling.

## Risks

- Incorrect parent-depth changes could make shell or TypeScript code resolve a
  plausible but wrong repository root.
- Docker commands use both host paths and `/w/...` container paths; updating
  only one side would fail at runtime.
- Bulk text replacement could rewrite historical changelog statements or
  unrelated OS-level tests. Changes must be limited to current contracts.
- A move could lose executable modes or accidentally regenerate the Bun
  lockfile. Both must remain stable unless verification proves a change is
  required.
- The full APID suite requires a bootable x64 image and may not be runnable in
  the current checkout; the static and self-contained gates remain mandatory.

## Scope

Expected changes include the 33 tracked files moved from `test/apid-api/`, the
D-Bus policy test moved from `os/pkgs/mosd/hack/`, a new
`os/pkgs/mosd/tests/README.md`, and current references in the root Makefile,
root and architecture documentation, image environment metadata, shell lint,
QEMU seed tooling, verification tooling, and mosd source/config comments.

The audit remediation also touches current design documents and comments in
`os/build/`, `os/verify/`, board definitions, rootfs scripts, and the APID
harness where they cite deleted shell predecessors or unstable source-line
positions. These are prose-only edits; executable statements and assertions
remain unchanged.

No service behavior, API schema, dependency version, Rust test ownership, or
OS-level test layout is changed.

## Alternatives

### Move the APID harness into `apid/tests/`

Rejected because the harness is a Bun/QEMU package spanning the built image,
guest fixtures, and APID service. Mixing it into Cargo's crate integration-test
directory would blur both toolchains and ownership conventions.

### Centralize every mosd test under one directory

Rejected because Cargo discovers crate integration tests from each crate's
`tests/` directory, while unit tests belong beside the implementation. Moving
those tests would require bespoke Cargo declarations and make code ownership
less clear.

### Move only the repository-root APID suite

Rejected because leaving the D-Bus policy test under `hack/` preserves the
same scattering problem for another workspace-level black-box test.

## Annotations

- Approved by the user on 2026-08-29 with documentation/comment audit fixes
  included in the implementation scope.
- Approval authorizes the narrowly scoped current-path updates in the two
  Chinese documents named above; it does not authorize broader translation or
  prose rewriting.
- Completed on 2026-08-30. All self-contained gates passed; the full APID QEMU
  run remained unavailable because the checkout has no `_out/x64` image, while
  dry-run path resolution passed up to that prerequisite.
