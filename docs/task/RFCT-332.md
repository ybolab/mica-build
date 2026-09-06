# RFCT-332 Lock and layer Debian packages and validate the composed system

- **status**: completed
- **priority**: P1
- **owner**: maintainer/deb-lock-20260906
- **createdAt**: 2026-09-06 00:33

## Description

Record exact Debian package versions, URLs and checksums in committed manifests. Cache downloads in Docker-mounted directories, start from a minimal base and add only selected runtime dependencies. Integrate offline dpkg composition and validate the resulting x64 system through QEMU and the complete end-to-end suite. See [PLAN-083](../plan/PLAN-083.md).

## ActiveForm

Completed package locks, minimal-first dpkg composition and full x64 QEMU acceptance.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

- The user's explicit instructions authorize this refinement and its build/QEMU/E2E validation. Existing unrelated working-tree changes remain preserved.

## Acceptance

- Every selected upstream package is pinned by version, architecture, URL and SHA256 in a repository manifest.
- The default cache and install boundary starts with a minimal base; selected features add their own dependency closure.
- Docker cache directories survive rebuilds; completed inputs support disconnected installation without APT.
- The actual composed x64 image passes image checks, QEMU boot and every registered API E2E phase without partial-suite success.

- complete: Verified both package locks and Docker caches; x64 image passed 315 applicable image checks, 12 executable smoke checks and all eight QEMU E2E phases with 137 assertions and zero failures/skips.
