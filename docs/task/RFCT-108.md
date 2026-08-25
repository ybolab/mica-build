# RFCT-108 PLAN-014 M2: the pinned build-environment image family

- **status**: in progress
- **priority**: P1
- **owner**: ai-agent
- **createdAt**: 2026-08-25 10:50
- **claimedAt**: 2026-08-25 14:05
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

## M2a (2026-08-25): the foundation

`os/build-env/` exists with `images.env`, `base/Dockerfile` and `build.sh`;
`make build-env` builds `localhost/mos-build-base` from a digest-pinned
`debian:trixie-slim`. The three parts of M2 that are NOT in it -- the
`mos-build-{c,go,rust}` images, the rewiring of the existing Dockerfiles'
`FROM` through `images.env`, `mosd/hack/build-target.sh`, and the BSP digest
pins -- have named places to slot into and are recorded as comments in
`images.env` rather than as empty keys. A pin no build reads is a value nothing
can prove wrong, and a `PENDING` no build reads is worse than that: it looks
recorded and is green until the day something reads it.

Three decisions that the rest of M2 inherits, recorded here because they are
choices and not the only possible ones:

- **The index digest is what gets pinned**, not a per-architecture manifest
  digest. Both are printed by `docker buildx imagetools inspect`; the
  per-architecture one builds on the host that recorded it and refuses every
  cross build afterwards. `board/cx3576/rootfs/alpine/Dockerfile` already pins
  an index digest, so this follows the tree rather than adding a convention.
- **`PENDING` is fatal with no override**, unlike `MOS_PODMAN_STRICT` /
  `MOS_RAUC_STRICT`, which default to a warning. An unhashed SOURCE still fails
  a later hash check; an unpinned BASE IMAGE fails nothing downstream at all, so
  a warning there floats until someone reads a log. `os/podman/versions.env`'s
  own prose already describes the fatal behaviour -- "The build prints the hash
  it computed and fails" -- which its Dockerfile does not implement; the prose is
  the contract worth keeping. `os/build-env/build.sh` scans **every** key, not
  only the ones the current run consumes, so a `PENDING` added for M2b fails M2a's
  build the day it is written.
- **Each image gets a lock filtered to its own key prefix.** The 42-minute
  measurement in `os/podman/Dockerfile` is about one apt list being one cache key
  for five compilers; one shared lock file has the same arithmetic, and M2c's
  ubuntu BSP pin would otherwise invalidate `mos-build-base`.

Known gap, recorded rather than left implicit: a digest pins the base image's
filesystem and **not** the apt archive installed on top of it. `apt-get install
git` against a frozen `debian:trixie-slim` still resolves against live
deb.debian.org. Closing it needs `snapshot.debian.org` and is outside RFCT-108's
scope; until then the asserted floor minimums are what stands between the build
and a silent downgrade, and `/etc/mos-build/base.env` records what each build
actually resolved.
