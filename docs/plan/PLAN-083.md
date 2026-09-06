# PLAN-083 Lock and layer Debian packages and validate the composed system

- **status**: completed
- **createdAt**: 2026-09-06 00:33
- **approvedAt**: 2026-09-06 00:33
- **completedAt**: 2026-09-06 01:17
- **relatedTask**: RFCT-332

## Context

PLAN-082 delivered a standalone dpkg bootstrap cache with a broad runtime manifest. Exact package metadata currently lives only in generated cache output, and the image composer still resolves dependencies through APT. The user requested committed version/URL manifests, persistent Docker cache directories, minimal-first layering and acceptance of the actual system through QEMU and full end-to-end tests.

## Proposal

1. Commit exact package locks derived from authenticated snapshot metadata and split the minimal bootstrap floor from selected runtime additions. Verify every cached archive against its lock entry.
2. Run package preparation in Docker with project-scoped persistent caches. Keep downloads separate from disconnected installation and reuse verified package files across sets.
3. Connect the locked base and selected additions to rootfs composition using dpkg. Preserve package maintainer-script ordering, service suppression and the existing finalizer invariants.
4. Rebuild the affected package producers and x64 system, run relevant regression/image checks, boot that artifact in QEMU and execute every registered E2E phase. Record actual results and any unresolved limitation.

## Risks

The minimal base must still satisfy Debian bootstrap ordering. Feature packages and mos-system presets must be unpacked before dependent services configure. Cached components must match current sources. A green download check cannot establish a bootable or API-conformant system. QEMU coverage applies to x64 and does not substitute for physical cx3576 validation.

## Scope

Debian package locks/cache/install tooling, the existing rootfs composer, necessary build/test integration and their existing documentation. No compatibility adapter, forge operation or unrelated feature redesign.

## Alternatives

A broad preinstalled runtime base prevents feature selection from reducing the image. Resolving floating package versions during builds defeats the requested lock manifest. Direct archive extraction without dpkg configuration omits maintainer scripts and triggers.

## Annotations

- The user's explicit action request authorizes implementation and system verification; tracking follows the full PMA tier.

## Progress

- Committed lock manifests cover 172 amd64 and 170 arm64 upstream packages, each with exact version, architecture, SHA256, URL and consuming local package families. The default bootstrap selection is 68 packages on either architecture.
- Docker entry points mount a persistent content-addressed archive directory. A cold minimal cache downloaded 69 archives, including the pinned debootstrap helper. Warm verification, corruption refusals and disconnected bootstrap installation pass.
- The composer now bootstraps the minimal root and adds selected upstream/local payloads with dpkg under `RUN --network=none`. The x64 composition contains 159 locked upstream packages and 13 local packages, with exact installed inventory checks.
- Integration exposed systemd pre-dependencies, duplicate upstream/custom certificate ownership, and debootstrap's replacement of the install helper's exit trap. These were corrected without forced dependency or file-overwrite bypasses; the finalizer confirms no temporary install files remain.
- The current mosd/APID producer was rebuilt before system assembly. The new rootfs passes all 12 executable smoke checks, and the assembled x64 disk passes 315 applicable image checks. The verifier separately identifies 22 checks for other board/boot configurations as inapplicable.
- QEMU boots the newly assembled disk. The E2E default now uses the whole registered phase list. A managed WireGuard fixture exercises real daemon-generated key permissions, replacing the previously skipped observation. All eight phases pass with 137 assertions, zero failures and zero skips; the harness reports 148 checks including setup.

## Verification

- Package cache regressions: 25 passing checks, plus minimal/system/radio selection and custom certificate ownership checks on both architectures.
- Build suite: 920/920 tests. Image-verifier suite: 1,279/1,279 tests. Rootfs package manifests: 39/39 checks across 256 resolutions. API harness typecheck and selftests: 47/47 checks.
- Host-toolchain lint includes the new untracked scripts through a temporary Git index: 106/106 files passed. Shell pipefail lint: 80/80 files. Syntax, whitespace and documentation-index checks passed.
- Actual x64 artifact: `_out/x64/x64-mos-1788656546.img`; rootfs payload 138,412,032 bytes. Raw validation logs are under `_out/debian-lock-validation/`; QEMU serial output and machine-readable results are under `_out/x64/apid-api/`.
- The final guest-test script passed another complete QEMU run: eight phases, 137 assertions, zero failures and zero skips; 148 checks including harness setup. Arm64 package caches are verified; native arm64/cx3576 boot and physical board acceptance are not claimed.

## Outcome

Runtime composition now consumes committed package locks and a reusable Docker-mounted archive cache, starting with the minimal bootstrap floor and adding only selected dependencies. The resulting x64 disk passes image, executable and complete QEMU/API acceptance. The existing compiler and packing tool environments are unchanged. No commit or push was requested or performed.
