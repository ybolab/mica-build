# PLAN-918 Select the MQTT reference application as a component

- **status**: completed
- **createdAt**: 2026-09-01 02:52 UTC
- **approvedAt**: 2026-09-01 02:53 UTC
- **completedAt**: 2026-09-01 03:41 UTC
- **relatedTask**: [RFCT-936](../task/RFCT-936.md)

## Context

The s905x5m board declaration currently puts the reference application's five
runtime files beside six Seekwave Bluetooth files in `BOARD_USERLAND_FILES`.
`os/rootfs/build-v2.sh` stages every path in that board list and
`board-userland-install.sh` installs every staged file unconditionally. This
therefore states that the reference application is required board hardware
support, although it is an optional sample that starts a service, owns a D-Bus
well-known name, enrolls with the MQTT bridge, and publishes MQTT data.

The reference binary and static policy/unit/enrollment files are currently
mixed into `os/boards/s905x5m/bsp/userland/`. The board userland Dockerfile
builds and emits them together with the Bluetooth artifact. The shared Rust
cross-build script also always builds the reference binary. The MQTT image
checks, synthetic packed-root fixture, and smoke register consequently expect
the reference package in every s905x5m root.

The rootfs chain already has reliable stage selection for default-on features:
`--without NAME` omits a `*-feature-NAME` stage and records that decision in
`rootfs-stages.txt`. It has no inverse, default-off component selector.
`MOS_PROFILE` controls the image access profile and defaults to `dev`; using it
as the sole selector would make the sample a profile side effect instead of an
explicit component choice.

The sealed combined package at
`/backup/mos-artifacts/rfct-292-combined-0c9deaf6/update.img` (SHA-256
`1c09ad372ee33e2c2c5efc1bc4f1634481894c846ff493df19e363d10fd594e7`) was
created before this separation. It remains the artifact for the pending HDMI
and MQTT verification. This plan changes only subsequent builds and explicitly
excludes rebuilding, invalidating, deploying, or inspecting that package on
hardware.

## Proposal

1. Add a default-off component selection axis to the rootfs stage driver.
   Component stages will use the `NN-component-NAME.Dockerfile` form and are
   excluded unless the caller passes `--with NAME`; feature stages retain their
   existing default-on/`--without` behavior. Extend the stage planner, CLI,
   manifest, and focused tests so unknown names, duplicate component stages,
   and attempts to use the wrong selector fail before a build can silently use
   the wrong chain.

2. Expose that selector from `build-v2.sh` as the whitespace-separated
   `MOS_ROOTFS_COMPONENTS` list. Its empty default selects no components.
   `MOS_ROOTFS_COMPONENTS=mqtt-reference` will add the reference stage only on
   s905x5m and will refuse if its MQTT/mosd prerequisites are declined. A
   selected reference component in `MOS_PROFILE=prod` will be refused; this is
   a production safety guard, not a profile-based opt-in. Thus both `dev` and
   `prod` default to no sample, while a development/reference build has one
   visible explicit choice.

3. Move the reference application's static files from the board BSP userland
   tree into the `mos-mqtt-reference` package. Remove its binary and four
   static files from the s905x5m userland Dockerfile and from
   `BOARD_USERLAND_FILES`, leaving only the board-required Bluetooth files.
   Keep cx3576 and x64 at `BOARD_USERLAND_FILES=""`.

4. Add a dedicated component stage and installer. `build-v2.sh` will stage the
   selected reference binary and four package-owned static files into a
   component artifact; the installer will require exactly the five allowed
   runtime paths, reject missing or extra staged content, and copy all five as
   one transaction. The core mosd cross-build remains independent, building the
   reference binary only when this component is selected.

5. Change MQTT verification from an unconditional s905x5m presence assertion
   to an all-or-none component contract. A production profile must have none of
   the five paths; a development root may have either none or a complete,
   least-privilege package. Add failing-side tests for each absent/stray path,
   for a reference package in a production root, for component stage selection,
   and for the smoke register selecting the binary only when the stage manifest
   records the component.

6. Update `docs/design/bus.md` to point readers at the package-owned working
   example and give the explicit development selection command. State that the
   sealed pre-separation package remains valid for its already scheduled
   verification and is not rebuilt by this change.

## Risks

- Adding a generic selector can accidentally make an unknown or misspelled
  component look like a successful default build. The driver must reject names
  that match no component stage and must record selected components in the
  stage manifest.
- A component that installs only an enrollment or only its policy fails
  silently at runtime. Exact artifact-count and path checks must run before
  copying anything into the root.
- A selected binary omitted from the smoke register would be shipped without
  execution evidence; conversely, a default root whose register still names it
  would fail all normal builds. The register must derive inclusion from the
  recorded selected-component set.
- The concurrent task/plan renumbering changes old record identifiers. This
  plan avoids links to those moving records and must preserve unrelated tracking
  edits.

## Scope

- Rootfs stage selection and manifest recording, rootfs component staging and
  installation, the s905x5m board userland declaration/build, reference-package
  asset ownership, focused verifier/smoke tests, and bus documentation.
- Excludes MQTT bridge protocol changes, application behavior changes, board
  access, heavy builds, package rebuilds, package invalidation, deployment,
  remote pushes, and changes to cx3576/x64 userland semantics.

## Alternatives

- Use `MOS_PROFILE=dev` as the selector: rejected. A profile describes access
  posture, while the reference application is a separately chosen test/sample
  payload; coupling them would make every development image carry it and would
  not provide a concrete opt-in.
- Add a second optional list to `BOARD_USERLAND_FILES`: rejected. The board
  userland contract is specifically an unconditional hardware allowlist, and
  extending it would repeat the classification error this task removes.
- Keep the files board-local but add a Makefile-only copy switch: rejected.
  The stage chain would not record the decision and the installer could not
  enforce all-or-none package membership.

## Annotations

- Phase 1 findings and the Phase 2 proposal were recorded on 2026-09-01.
- Approved on 2026-09-01. Implementation is limited to post-verification source
  changes; the sealed combined package is not rebuilt, invalidated, deployed,
  or used for hardware access.
- Completed on 2026-09-01. The new `NN-component-NAME` stage axis is default
  off and is recorded as `# components:` in the stage manifest. The
  `mqtt-reference` component is restricted to a development s905x5m build,
  refuses a declined mosd/mqtt prerequisite or `MOS_PROFILE=prod`, and stages
  and installs its exact five-file package as one component.

## Implementation

- Moved the static unit, drop-in, enrollment, and policy from the s905x5m BSP
  into `os/pkgs/mosd/mqtt-reference/dist/`; `BOARD_USERLAND_FILES` now retains
  only the six Seekwave Bluetooth paths. cx3576 and x64 remain explicitly
  empty.
- Added `MOS_ROOTFS_COMPONENTS`, `--with`, component stage selection, manifest
  recording, component-aware source staging, and the dedicated
  `35-component-mqtt-reference` installer stage.
- Made the installer preflight all five regular files and reject extras or
  symlinks before it writes a runtime target. It refuses `prod` independently
  of the top-level build guard.
- Changed image verification to permit no reference package in development,
  require the complete exact contract if present, and fail a production root
  containing any of the five paths. The smoke register reads selected
  components from the stage manifest before it decides whether to execute the
  optional binary.
- Added the working-example source and explicit development selection command
  to `docs/design/bus.md`.

## Verification

- `bun test src/stages.test.ts` in `os/build`: 92 pass.
- Focused `os/verify` stage/smoke/board/lint suites passed, along with the new
  direct installer suite: complete package success; each missing one of the
  five paths, an extra file, and `prod` selection all fail before target
  writes.
- Shell syntax checks passed for `build-v2.sh`, `build-target.sh`, and
  `mqtt-reference-install.sh`; `git diff --check` passed.
- The focused `checks-mqtt.test.ts` component group passed the default-absent,
  complete, partial, and each individual production-path absence cases. The
  broader packed-root MQTT fixture suite requires ownership changes unavailable
  to this unprivileged local environment; no privilege escalation, build,
  package, or hardware action was attempted.
