# PLAN-084 Store Debian pins in per-package JSON manifests

- **status**: completed
- **createdAt**: 2026-09-06 01:23
- **approvedAt**: 2026-09-06 01:23
- **completedAt**: 2026-09-06 01:43
- **relatedTask**: RFCT-333

## Context

The runtime uses exact TSV locks, content-addressed Docker caches and offline dpkg installation. The user requested JSON records that can be maintained and replaced independently. The minimal target has no JSON runtime; the existing pinned Bun builder can parse and validate JSON before passing generated installation records into that target.

## Proposal

1. Convert unchanged pins into `packages/<name>.json` with explicit amd64/arm64 variants and a separate JSON bootstrap helper. Verify exact equivalence with the previous records.
2. Validate JSON with the existing Bun tool image and add `--package NAME` for targeted cache, verification and selection. Verify that changing one package downloads exactly one archive and leaves unrelated records and cache files untouched.
3. Render temporary installation rows in the builder and verify cached hashes and package metadata again at the dpkg boundary. No target JSON interpreter or APT is needed.
4. Run package regressions, rebuild the x64 rootfs/image, and execute image verification and every QEMU E2E phase.

## Risks

Updating one package can require other dependency pins to change. Targeted caching is preparation, not an isolated system upgrade; full image composition still checks dependencies and installed inventory. Per-package snapshot URLs may advance independently, while versions remain explicitly pinned.

## Scope

Package metadata, its reader/cache options, composition transport and focused tests/documentation. No package version upgrades, OCI redesign, compatibility adapters or unrelated feature work.

## Progress

- Investigation and implementation are authorized by the ongoing user request.
- Migrated 172 per-package JSON files and the bootstrap helper. Rendering both architectures reproduces all 342 previous version/architecture/hash/URL/consumer records exactly.
- Targeted cache regressions prove that one changed package downloads one archive, retains old cache files, and ignores unrelated package/helper records. Normal warm caching downloads nothing.
- JSON runs only in the pinned Bun builder. The minimal target receives generated records and independently verifies archive bytes and dpkg metadata before installation.
- Strict TypeScript checks pass with the repository's compiler and Bun types. Code review checked manifest validation, targeted cache isolation, offline archive checks and the BuildKit-to-dpkg boundary.
- A real empty Docker-mounted cache fetched exactly one libc6 archive; disconnected targeted verification passed. No helper or unrelated archive was downloaded.
- The first JSON-driven rootfs passed exact inventory checks and all 12 executable smoke checks. Final artifact validation rebuilds after the reader's TypeScript narrowing adjustment.
- Build regressions passed 920/920 tests; verifier regressions passed 1,279/1,279. The archive suite now has 40 passing checks, including malformed line boundaries and empty rendered input.
- Host-toolchain lint passed 107/107 files using a temporary Git index that includes all new scripts. Shell pipefail lint passed 81/81 files; syntax, whitespace and documentation index checks passed.
- Both-architecture minimal/additive selection checks passed. Rootfs manifest validation passed 39/39 checks across 256 resolutions.
- The final source revision produced `_out/x64/x64-mos-1788658729.img` with a 138,412,032-byte rootfs payload. All 12 executable smoke checks and 315 applicable image checks passed; 22 checks for other board/boot configurations are inapplicable. QEMU acceptance passed against this artifact.

## Outcome

Each upstream package now has its own JSON manifest with target-specific pins. A single-package cache refresh reads only that record, downloads only its missing archive and preserves unrelated manifests and cache files. Full selections continue to validate dependency installation and exact inventory with dpkg offline. The existing Bun builder renders temporary installation records; no JSON interpreter is added to the target system.

The final x64 image passed all eight QEMU/API phases: 137 assertions, zero failures and zero skips. The complete harness reports 148/148 checks including setup. Build, verifier, archive, selection and manifest regressions also passed. Raw logs, source/manifest hashes, a real single-package cold cache and the machine-readable E2E result are retained in `_out/debian-json-validation/`. Arm64 package records and caches are verified; physical board acceptance is not claimed. No package pins changed and no commit or push was performed.
