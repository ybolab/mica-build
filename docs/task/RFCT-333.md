# RFCT-333 Store Debian pins in per-package JSON manifests

- **status**: completed
- **priority**: P1
- **owner**: maintainer/deb-json-20260906
- **createdAt**: 2026-09-06 01:23

## Description

Replace architecture-wide TSV source locks with one JSON file per package, containing explicit target variants. Allow a single package cache refresh without processing unrelated archives. Preserve offline dpkg composition and system acceptance. See [PLAN-084](../plan/PLAN-084.md).

## ActiveForm

Completed per-package JSON manifests, independent cache updates and full x64 system acceptance.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

- This continues the user's authorized runtime-package implementation. Existing unrelated changes are preserved.

## Acceptance

- Each package's exact version, architecture, URL, SHA256 and consumers live in its own JSON file.
- A targeted cache update reads only that package record and reuses all unchanged archives.
- Existing pins and minimal/additive selections survive the format migration exactly.
- Offline composition, image checks and all QEMU E2E phases pass on the resulting x64 image.

- complete: Preserved all 342 target pins; verified isolated one-archive cache updates; x64 image passed 315 applicable image checks, 12 executable checks and all eight QEMU E2E phases with 137 assertions, zero failures and zero skips.
