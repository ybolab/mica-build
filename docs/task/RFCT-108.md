# RFCT-108 PLAN-014 M2: the pinned build-environment image family

- **status**: completed
- **priority**: P1
- **owner**: ai-agent
- **createdAt**: 2026-08-25 10:50
- **claimedAt**: 2026-08-25 14:05
- **completedAt**: 2026-08-25 19:47
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

- Every image/component build is green from pinned digests — **for amd64
  component and image builds, and for the amd64→aarch64 `mosd` cross build.
  arm64 component and image builds require a binfmt-registered host and are to
  be verified there, where no file change is expected.**

  AMENDED 2026-08-25, at M2 close. **This amendment was applied by L1 on the M2
  gate's recommendation. It is NOT a decision the user took** — the user
  addressed the third clause only. It is therefore revertible: if the user
  objects, this clause returns to its unqualified form and M2 cannot close until
  an arm64-capable host has verified it. Every other statement in this record
  stands either way.

  RATIFIED 2026-08-26, **by the user**, at campaign close and merge into main.
  The question was put explicitly — ratify or revert — with the reason restated
  (a host capability, not an implementation shortfall; the same constraint
  already accepted in the cx3576 CI decision and both dispositions), and the
  user confirmed the close-out package carrying the ratification
  recommendation. The revertibility above is thereby discharged; the clause
  stands as amended, and the arm64 verification remains owed to the first
  binfmt-registered host, where no file change is expected.

  The reason is a host capability, not an implementation shortfall. Three
  measurements, taken by the M2 gate on the machine this milestone was built on:
  `/proc/sys/fs/binfmt_misc` is empty and `binfmt_misc` is not even mounted; NO
  buildx builder advertises `linux/arm64`, including the docker-container builder
  literally named `mos-arm64`, which reports `linux/amd64 (+4), linux/386`; and
  `docker run --platform linux/arm64` exits 255 with `exec format error`.

  What is therefore UNVERIFIED, named rather than implied — and it is not a
  corner, because arm64 is the DEFAULT of both headline component builds:

  | invocation | why it did not run |
  | --- | --- |
  | `make podman` | `MOS_ARCH` defaults to `arm64`; refused by name, rc=2 |
  | `make os-rauc` | `MOS_BOARD` defaults to `cx3576`, i.e. arm64; refused by name, rc=2 |
  | `MOS_BOARD=cx3576 os/rootfs/build-v2.sh` | the cx3576 device root is `linux/arm64` |
  | `make -C board/cx3576 rootfs` / `image` | both are `--platform linux/arm64` |

  So podman and RAUC are verified for amd64 only, and the cx3576 device root is
  verified for neither architecture's assembly — only for its BSP inputs, which
  are `--platform=$BUILDPLATFORM` cross builds and run natively. Both refusals
  name `docker run --privileged --rm tonistiigi/binfmt --install arm64` as the
  fix, and the constraint recorded under M2c (a `LOCAL_` FROM carries one
  architecture, not an index) is why the arm64 chain additionally needs an arm64
  builder family, produced by that same registration.

  **"Green from pinned digests" is not "hermetic", and this clause must not be
  read as claiming it.** A digest pins the base image's FILESYSTEM, not the apt
  or apk archive the build installs on top of it. `mos-build-base`'s five floor
  packages, `mos-build-c`'s entire toolchain and every component `-dev` list
  still resolve against live `deb.debian.org` at build time. That is precisely
  why those images assert version FLOORS rather than exact versions, while the
  sha256-pinned Go and Rust tarballs are asserted exactly — the difference is
  whether the thing being asserted is pinned or merely requested. Closing it
  needs `snapshot.debian.org` and is outside RFCT-108.
- Each builder image asserts its toolchain version internally.
- The mosd cross-build is byte-reproducible with itself from the container, and
  differs from the pre-switchover host build **only in the enumerated `libring` /
  C-toolchain way below**, attributed by name.

  AMENDED 2026-08-25, at M2 close. **This is a direct user decision.** The reason
  is that this clause and PLAN-014's own decision 4 were mutually unsatisfiable,
  not that the implementation fell short. Decision 4 exists to TAKE CONTROL of
  the build environment — to replace the uncontrolled host toolchain with a
  pinned one. This clause, as originally written, required the output of the new
  controlled environment to match the output of the uncontrolled environment
  being replaced. Those cannot both hold: satisfying the clause would have
  required the container to reproduce the very host toolchain decision 4 was
  adopted to stop depending on. No implementation could have satisfied both.

  The measurement that establishes it, made once at switchover (M2c) and not
  re-derived. Both controls held more than literally:

  - The two `rustc` binaries are **the same file** by sha256
    (`3690cc576ede…93e2`), as is the aarch64 `libstd` rlib
    (`42af98a620b4…31fd`) — rustup's channel artifacts and the standalone
    tarball `images.env` pins are the same upstream bytes.
  - `--locked` was passed on both sides.
  - `CARGO_HOME`, the workspace path and `CARGO_TARGET_DIR` were held to
    identical ABSOLUTE paths on both sides.
  - `CARGO_TARGET_DIR` was wiped between runs, so cargo could not hand back the
    first build's output as fresh.

  Under those controls, **220 of the 221 rlibs `rustc` produced are
  byte-identical**. The sole exception is `libring-*.rlib`, whose 40 object files
  carry `GCC: (Ubuntu 11.4.0-1ubuntu1~22.04.3)` host-side and
  `GCC: (Debian 14.2.0-19)` container-side: `ring` compiles C and assembly
  through the `cc` crate with whichever cross compiler is present, and that same
  compiler drives the final link. Containerising therefore did not change what
  `rustc` produced from this source — it changed which C toolchain compiles one
  crate and links the result, which is the container's CONTENTS and not its
  BOUNDARY, and is exactly what decision 4 set out to change.

  It is not nondeterminism. Two independent container runs agree byte-for-byte,
  and a third run by the M2 gate, from a DIFFERENT worktree hours later,
  produced the same four hashes (`64d260ed…`, `0e6bc5f6…`, `514caf20…`,
  `9fc79fb3…`). The original clause cannot be satisfied on any machine whose host
  cross-gcc differs from the pinned builder's, which is every machine not already
  running Debian trixie.

  The allowance is exactly this wide and no wider: a difference in any rlib other
  than `libring`, or a difference between two CONTAINER runs, is a regression and
  is not covered here.

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

## M2b (2026-08-25): mos-build-{c,go,rust}

`make build-env` now builds and tags all four images. The three added here are
`FROM localhost/mos-build-base` and each writes its own
`/etc/mos-build/<name>.env`, which `os/build-env/build.sh` reads back out of the
tagged image -- M2a made that unavoidable by naming the file after the image
rather than fixing it at `base.env`.

Four decisions M2c inherits, recorded because they are choices:

- **Floors for C, exact versions for Go and Rust.** `mos-build-c`'s gcc comes
  from apt against live deb.debian.org, which the base digest does not pin, so
  only a floor can be maintained honestly. Go and Rust arrive as tarballs pinned
  by sha256, so the version is a fact the tree owns and anything else means the
  recorded hash and the installed compiler have come apart. The distinction is
  whether the thing asserted is pinned or merely requested, not house style.
- **Every image asserts by USE, not only by version.** Each compiles and links a
  program and reads the architecture back out of the ELF; Go and Rust also link
  for the other architecture. This is what caught `gcc-aarch64-linux-gnu`
  installed without `libc6-dev-arm64-cross`: rustc 1.98.0 exactly, std present
  for both triples, native link fine, and `cannot find crti.o` on the cross
  link. Every version check passed.
- **`GOTOOLCHAIN=local`, asserted.** Since Go 1.21 the go command downloads and
  runs whatever toolchain a `go.mod` names, so a sha256-pinned Go tarball
  without it is a default that the first forward `go.mod` replaces over the
  network, mid-build, silently. `rustup` is the same hole by a different route
  and is why `mos-build-rust` installs from the standalone tarball instead.
- **Cross-compilation is pinned for Rust and free for Go.** The standalone
  `rust-` tarball ships std for its own triple only, so `RUST_STD_SHA256_<arch>`
  plus a Debian cross linker is what lets `mosd/hack/build-target.sh` run in
  this image at all (M2c's job). Go needs neither.

Two mechanisms M2b had to add to `os/build-env/build.sh`, both because M2a's
table gained rows whose FROM is a local tag:

- **`resolve_sha256`, the sibling of `resolve_digest`.** A tarball hash cannot
  be resolved by a pre-build scan the way a registry digest can, and refusing
  before the fetch leaves an operator holding an instruction with no way to
  follow it. It runs on the HOST architecture inside `IMAGE_DEBIAN_TRIXIE`,
  which is what makes a per-architecture pin recordable from one machine: a
  tarball's sha256 does not depend on the machine that computes it. All six
  hashes here were recorded from one amd64 run and then checked against
  upstream's own published checksums.
- **`--builder default` for native builds.** Three of four images are FROM
  `localhost/mos-build-base`, and only the `docker` driver can resolve a tag in
  the local image store; a `docker-container` builder treats `localhost/` as a
  registry hostname. Inheriting the ambient builder meant a leftover
  `mos-rauc-arm64` broke `make build-env` while blaming a FROM line that was
  correct.

Known gap, recorded rather than left implicit: **cross-building the builder
images is refused by name.** A cross build needs the docker-container driver,
which cannot read a local tag, so `MOS_BUILD_PLATFORM=linux/arm64 make
build-env` stops before building and says why. Closing it means publishing each
image as content rather than as a tag -- `--output type=oci` plus
`--build-context <name>=oci-layout://<dir>` -- which changes how every row in
the table is published and belongs with M2c's rewiring. Nothing in this
repository cross-builds the builder images today, and the per-architecture
hashes did not need it.

## M2c (2026-08-25): every FROM through images.env, and the mosd cross-build inside

No Dockerfile in this repository names a base image any more. All fourteen
`FROM` lines that referenced one take it as a build argument, produced by the
new `os/build-env/from.sh` out of `os/build-env/images.env`, and every one of
them is declared with NO default -- so a caller that forgets the argument is
refused by docker with "base name should not be blank" before any stage runs,
rather than building green against a tag.

The inventory, re-derived rather than taken from the milestone note:

| Dockerfile | stage | was | now |
| --- | --- | --- | --- |
| `os/podman/Dockerfile` | src | `debian:trixie-slim` | `LOCAL_MOS_BUILD_BASE` |
| | c-build | `debian:trixie-slim` | `LOCAL_MOS_BUILD_C` |
| | rust-build | `rust:1.90-trixie` | `LOCAL_MOS_BUILD_RUST` |
| | go-build | `golang:1.25-trixie` | `LOCAL_MOS_BUILD_GO` |
| | verify | `debian:trixie-slim` | `LOCAL_MOS_BUILD_BASE` |
| `os/update/rauc/Dockerfile` | src | `debian:trixie-slim` | `LOCAL_MOS_BUILD_BASE` |
| | build | `debian:trixie-slim` | `LOCAL_MOS_BUILD_C` |
| `os/rootfs/Dockerfile.v2` | certs | `debian:trixie-slim` | `IMAGE_DEBIAN_TRIXIE` |
| | rootfs | `debian:trixie-slim` | `IMAGE_DEBIAN_TRIXIE` |
| | pack | `debian:bookworm-slim` | `IMAGE_DEBIAN_BOOKWORM` |
| `board/cx3576/uboot/Dockerfile` | build | `ubuntu:24.04` | `IMAGE_UBUNTU_2404` |
| `board/cx3576/kernel/Dockerfile` | build | `ubuntu:24.04` | `IMAGE_UBUNTU_2404` |
| `board/cx3576/Dockerfile.alpine` | assemble | `ubuntu:24.04` | `IMAGE_UBUNTU_2404` |
| `board/cx3576/rootfs/alpine/Dockerfile` | rootfs | `ARG ALPINE_IMAGE=alpine:3.24.1@sha256:28bd…` | `IMAGE_ALPINE_3_24_1` |
| | pack | `ubuntu:24.04` | `IMAGE_UBUNTU_2404` |
| `os/tests/handshake-test/Dockerfile` | src | `ubuntu:24.04` | `IMAGE_UBUNTU_2404` |

Three decisions M2d inherits, and one measurement that did not come out green.

- **The rootfs stays on upstream digests; the component builds move onto the
  builder family.** The distinction is what the stage does. `os/podman` and
  `os/update/rauc` COMPILE, so they stand on `mos-build-{base,c,go,rust}` and
  keep only their own components' `-dev` packages. `os/rootfs/Dockerfile.v2`
  assembles the device root, and its package set IS the shipped system -- a
  builder image under it would install git, binutils, xz, gcc and ccache into
  the thing that boots. It gets the digest, which was the only property missing.
  The BSP builders keep `ubuntu:24.04` by the boundary RFCT-108 states, and get
  the digest and nothing else.

- **A LOCAL_ FROM costs the multi-architecture index, and that is now the
  binding constraint on arm64 component builds.** `debian:trixie-slim@sha256:…`
  is an index and docker picks the manifest matching `--platform`;
  `localhost/mos-build-c` is exactly the one architecture `make build-env` last
  produced. So `MOS_ARCH=arm64 make podman` needs an arm64 builder family, and
  producing one needs a builder that can both reach linux/arm64 and read a local
  tag. Only the `docker` driver reads local tags (M2b measured the
  docker-container driver treating `localhost/` as a registry hostname), and the
  `docker` driver reaches linux/arm64 only where the HOST has binfmt registered.
  `os/build-env/from.sh` refuses the mismatch by name and `os/podman/build.sh`
  refuses the unreachable platform by name, both naming the fix. On a host with
  `tonistiigi/binfmt --install arm64` the whole arm64 chain works with no change
  to any file here; on this host, which has no binfmt registration at all
  (`/proc/sys/fs/binfmt_misc` is empty and no buildx builder advertises
  linux/arm64), it cannot run and is refused rather than attempted.

- **MOS_PODMAN_STRICT and MOS_RAUC_STRICT are gone; PENDING now fails.** Both
  defaulted to a warning, justified in comments by "which is what CI sets".
  Nothing in this repository has ever set either one -- not
  `.gitea/workflows/check.yml`, not `privileged.yml`, not the Makefile, not the
  two `build.sh` scripts, which passed `${…:-0}` through. So the release path
  and the developer path were the same warning and the sentence describing the
  difference was the only place the difference existed. The CODE was wrong, not
  the prose: `os/podman/versions.env` has always read "The build prints the hash
  it computed and fails", and `os/build-env/images.env` implements exactly that.
  A build that warns while its documentation says it fails teaches a reader to
  stop believing the documentation.

- **The mosd acceptance clause is NOT satisfied, and the reason is precise.**
  RFCT-108 asks that the containerised cross-build produce "identical binaries
  from the container as the host build did (same rustc, `--locked`)". Both
  controls hold literally: the host's rustc 1.98.0 and `mos-build-rust`'s are
  the SAME FILE (sha256 `3690cc576ede…93e2`), as is the aarch64 `libstd` rlib
  (`42af98a620b4…31fd`), because rustup's channel artifacts and the standalone
  tarball `images.env` pins are the same upstream bytes; `--locked` was passed
  on both sides; `CARGO_HOME`, the workspace path and `CARGO_TARGET_DIR` were
  held to the same absolute paths, and the target directory was wiped between
  runs so cargo could not return the first build's output as fresh.

  All four binaries differ. **220 of the 221 rlibs are byte-identical.** The one
  exception is `libring-*.rlib`, and its 40 object files carry
  `GCC: (Ubuntu 11.4.0-1ubuntu1~22.04.3)` on the host side and
  `GCC: (Debian 14.2.0-19)` in the container: `ring` compiles C and assembly
  through the `cc` crate with whichever cross compiler is present, and that
  compiler also drives the final link. So containerising did not change what
  rustc produced from this source; it changed which C toolchain compiles one
  crate and links the result -- which is not the container boundary but the
  container CONTENTS, and is the thing decision 4 deliberately changed. Two
  independent container runs produce byte-identical binaries, so the difference
  is not nondeterminism.

  The clause as written therefore cannot be satisfied on any machine whose host
  cross-gcc differs from the pinned builder's, which is every machine that does
  not already run Debian trixie. **This is left red for the gate to rule on;
  RFCT-108's acceptance text is not amended here.**

  What IS established, and is arguably the property the clause was reaching for:
  `mosd/hack/build-aarch64.sh` is byte-reproducible with itself. Two independent
  runs with `mosd/target` deleted between them produce identical `mosd`, `apid`,
  `mos-mqttd` and `mos-mqtt-broker`. Before M2c the same question could not be
  asked of the host path at all, because what it produced depended on whichever
  rustup the machine happened to carry.

  A related correction to the record: the machine this ran on DOES have a host
  Rust toolchain. `command -v cargo` is empty because `~/.cargo/bin` is not on
  the ambient PATH -- and the pre-M2c `build-target.sh` prepended it itself, so
  the historical path was runnable. `~/.rustup/toolchains/` holds nine
  toolchains dating from 2026-04-17, of which exactly one (1.96.0) carries the
  `aarch64-unknown-linux-gnu` std the cross build needs. Installing 1.98.0 to
  build the comparison side also set it as rustup's default, overwriting the
  previous setting, which is not recoverable.

What was run, and what was not. Green from pinned digests on this host: the four
builder images; podman's seven binaries for amd64; rauc for amd64; the cx3576
u-boot and kernel BSP builders (both `--platform=$BUILDPLATFORM` cross builds,
so they run natively); the offline U-Boot handshake harness, forced to rebuild
rather than served from its cached `mos-hs-src`; and the x64 rootfs, all the way
to a 241 MB `rootfs-verity.img`, which is the only consumer of
`IMAGE_DEBIAN_BOOKWORM` and therefore the only thing that proves that pin.

NOT run: anything targeting linux/arm64 -- podman, rauc and the rootfs for
cx3576. Not "expensive and skipped": impossible here. `/proc/sys/fs/binfmt_misc`
is empty, no buildx builder on this host advertises linux/arm64 (the
docker-container ones report `linux/amd64, linux/386` only), and
`docker run --platform linux/arm64` gives `exec format error`. The refusals are
named rather than attempted, and the arm64 chain additionally needs an arm64
builder family, per the constraint recorded above.

One observation from re-running the amd64 podman build a second time, recorded
because it is easy to mistake for something this milestone caused and is not:
`crun`, `conmon` and `catatonit` came out byte-identical across the two runs and
`podman`, `quadlet`, `netavark` and `aardvark-dns` did not. Both runs used the
same builder images and the same pinned sources, so this is a property of the Go
and Rust builds themselves, not of the FROM rewiring. It was not investigated --
RFCT-108 asks for reproducible BUILD ENVIRONMENTS, not reproducible engine
binaries -- but anything that later wants to compare an engine binary against a
recorded hash will meet it.

Beyond the switchover, `podman`, `quadlet`, `crun`, `conmon`, `catatonit`,
`netavark`, `aardvark-dns` and `rauc` were each EXECUTED and asked for their
version, in the digest-pinned trixie with the sonames `NEEDED.txt` names
installed, and each reported exactly what `versions.env` pins. `podman info`
(privileged, for the user-namespace re-exec) resolves its own crun and reports
`netavark 2.1.0` as the network backend. What compiled each was read back out of
the artefact rather than assumed: `go version -m` says `go1.26.7` for podman and
quadlet, `.comment` says `GCC (Debian 14.2.0-19)` for the C components and rauc,
and the Rust binaries' std paths name rustc commit `88d9e12ae178…` -- 1.98.0.

Known gap this milestone did not close, recorded rather than left implicit:
three Dockerfiles written as HEREDOCS inside test scripts still name a base
image directly -- `os/tests/mkimage-v2-selftest.sh:280` and
`os/tests/repart-loader-test.sh:79` (`alpine:3.21`) and
`os/tests/quadlet-doc-test.sh:91` (`debian:trixie-slim`) -- as do six
`docker run` base images in `os/tests/repart-loader-test.sh`,
`os/tools/qemu-run.sh`, `os/tools/qemu-journal.sh` and
`.gitea/workflows/privileged.yml`. They are floats of the same kind. They were
left because RFCT-108's scope line is about Dockerfiles' `FROM`, and because the
first of them is a file R5 is live in.

## M2d (2026-08-25): the M2 gate, and the two clauses it could not close itself

The gate verified the milestone **as a whole on the merged tree**, which is the
one thing none of M2a, M2b or M2c could do. It did not re-run the mosd
comparison, did not amend this record, and refused to close on the unamended
text; both amendments in Acceptance above were applied afterwards, on the
authority recorded in each.

**Clause 2 is green, and was driven from the FAILING side.** A green read-back is
not evidence an assertion can fail, so each kind was broken deliberately in
`os/build-env/images.env`, built, and reverted — the tree was clean after every
one, and all six refused by name, in the right image:

| broken | refusal |
| --- | --- |
| `BASE_FLOOR_GIT_MIN=99.0` | `mos-build-base: error: git is 2.47.3, below the floor 99.0` |
| `BASE_FLOOR_CODENAME=bookworm` | `mos-build-base: error: the base resolves to Debian 'trixie'` |
| `C_FLOOR_GCC_MIN=99.0` | `mos-build-c: error: g++ is 14.2.0, below the floor 99.0` |
| `GO_VERSION=1.26.6`, hash left at 1.26.7's | `mos-build-go: error: … hashes to 708effb7…, but … records GO_SHA256_AMD64=ffb5f8de…` |
| `GO_VERSION=1.26.6` with the URL HELD at 1.26.7 | `mos-build-go: error: go is 1.26.7, but … pins GO_VERSION=1.26.6 by sha256` |
| `RUST_VERSION=1.97.1` with the URLs HELD at 1.98.0 | `mos-build-rust: error: rustc is 1.98.0, but … pins RUST_VERSION=1.97.1 by sha256` |

The last two are the ones that matter: holding the tarball and its hash CORRECT
leaves the internal version assertion as the only thing that can fail, so it is
the assertion being tested and not the fetch. All four records were also read
back out of the tagged images and cross-checked against the running images, so
each record describes its image rather than echoing `images.env`.

A seventh case covers the first clause: corrupting `IMAGE_UBUNTU_2404`'s last hex
digit and rebuilding the handshake harness gives `…518: not found`, exit 1. A
warm layer cache did not paper over it, which is the answer to whether a rewired
`FROM` is genuinely exercised or merely resolved.

**The reproducibility observation M2c left open is confirmed, and its cause is an
embedded build timestamp — not toolchain nondeterminism.** Under a full
`--no-cache` amd64 rebuild, `crun`, `conmon` and `catatonit` reproduce
byte-for-byte and `podman`, `quadlet`, `netavark` and `aardvark-dns` do not, as
M2c saw. The cause: `go version -m` on the two `podman` binaries differs in
exactly one field, `define.buildInfo=1787684525` vs `1787686319` — 1794 seconds
apart, which is precisely the gap between the two builds — with identical
`gitCommit` and identical file size; `quadlet` is the same; `netavark` carries
the two literal build times and differs only in `.strtab` (126 bytes), every
other ELF section identical; `aardvark-dns` has identical size and a different
hash. Nothing in `os/podman/Dockerfile` injects a date, so this is podman's and
netavark's own upstream stamping and has nothing to do with the FROM rewiring.
**For M7:** `crun`, `conmon` and `catatonit` can be compared against a recorded
hash today; the other four cannot until a fixed build date (`SOURCE_DATE_EPOCH`
or an explicit argument) is threaded into those two stages.

**The unpinned-reference list above is a subset.** All ten references M2c
recorded were confirmed verbatim, and eight more of the same kind were found —
three of them on the SHIPPING path rather than in test scaffolding:
`os/mkimage-v2.sh:634` (`alpine:3.21`, the cx3576 image assembler),
`os/mkimage-x64.sh:494` (`debian:trixie-slim`, the x64 image assembler) and
`os/update/bundle.sh:545` (`debian:trixie-slim`, the RAUC bundle assembler);
then `os/verify-image-v2.sh:173`, `os/tools/qemu-run.sh:107`,
`os/tools/qemu-seed-state.sh:64`, `os/tests/mkimage-v2-selftest.sh:163` and
`os/tests/mkimage-x64-selftest.sh:123`. A container that writes a release image
is as much a build environment as one that compiles a binary. A thirteenth kind,
pre-existing and out of the same scope line: all twelve Dockerfiles carry
`# syntax=docker/dockerfile:1`, a floating frontend that decides how the file is
parsed. **None of these were closed here** — they belong in a named follow-up,
and several sit in files other tasks are live in.

By contrast the `FROM` scope IS complete: all 33 `FROM` lines across the twelve
Dockerfiles are a build-arg variable, `scratch`, or an earlier stage. Not one
names an image literally.
