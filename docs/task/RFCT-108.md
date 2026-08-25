# RFCT-108 PLAN-014 M2: the pinned build-environment image family

- **status**: pending
- **priority**: P1
- **owner**: -
- **createdAt**: 2026-08-25 10:50
- **plan**: PLAN-014 (M2)

Every build environment becomes a decision recorded in the tree: one
`os/build-env/images.env` pinning every base image by digest and every
toolchain by version+sha256, and a self-built `mos-build-{base,c,go,rust}`
image family that all component builds consume.

## Scope

- `os/build-env/` with `images.env` (PENDING flow for bumps, as
  `os/podman/versions.env` established) and the four Dockerfiles:
  `base` (pinned trixie digest + common floor), `c`, `go`, `rust`
  (base + pinned toolchain tarballs, sha256-recorded — decision 4: not the
  official `golang:`/`rust:` images).
- `make build-env` builds and tags `localhost/mos-build-*`.
- All Dockerfiles take `FROM` via build arg injected from `images.env`;
  per-stage apt lists stay separate (the merged-toolchain economy was
  measured and rejected in `os/podman/Dockerfile`).
- `mosd/hack/build-target.sh` moves inside `mos-build-rust`; the host needs
  docker and nothing else.
- BSP builders (u-boot/kernel, ubuntu-based) get digest pins only.

## Acceptance

- Every image/component build is green from pinned digests.
- Each builder image asserts its toolchain version internally.
- The mosd cross-build produces identical binaries from the container as the
  host build did (same rustc, `--locked`), verified once at switchover.

## Dependencies

- After RFCT-107 (paths). Independent of the TS milestones.
