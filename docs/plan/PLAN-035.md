# PLAN-035 Build the cx3576 rootfs chain on a host without binfmt through buildkit

- **status**: implementing
- **createdAt**: 2026-08-30 12:10
- **approvedAt**: 2026-08-30 16:19
- **relatedTask**: [RFCT-272](../task/RFCT-272.md)

## Context

Every cx3576 step except the rootfs chain and its smoke run already builds on
an amd64 host with no host-level emulation: U-Boot, the kernel and the mosd
family cross-compile; the arm64 builder images, RAUC and podman run their
arm64 steps inside the `mos-arm64` docker-container builder, whose buildkit
image bundles QEMU, with the `localhost/mos-build-*` bases handed over as OCI
layouts by `os/build-env/from.sh --contexts=`. (`docs/design/build.md`
section 4.)

The rootfs chain is the exception because `os/build/src/stages-cli.ts`
chains `os/rootfs/stages/*.Dockerfile` by **local tag**: each stage is built
with `-t mos-rootfs-stage:<board>-<n> --load` and the next opens
`FROM ${MOS_STAGE_PREV}` against that tag. Only the `docker` buildx driver can
resolve a tag in the daemon's image store, and the `docker` driver executes
arm64 only through the host's `binfmt_misc`. The driver refuses any other
driver up front (`driverCanChain`), and `os/rootfs/build-v2.sh` refuses when
`default` cannot reach the platform, printing the host binfmt command.
`os/rootfs/stages/README.md` records this as a cost accepted when the single
Dockerfile was split, with a registry in the build path rejected as the way
to close it.

The registry was the wrong alternative to weigh. The tree already has a
registry-free way to hand an image to a container builder — the OCI layout
build context — and buildkit can also *produce* one directly:
`--output type=oci,dest=<dir>,tar=false,name=<tag>`. Measured on this host on
2026-08-30 with two throwaway stages on `mos-arm64`, `--platform linux/arm64`,
the second `FROM ${MOS_STAGE_PREV}` with
`--build-context mos-probe:a=oci-layout://<dir>`: the second stage ran and
wrote `stage-b sees: aarch64 on aarch64`. No tag touched the image store,
and the host has no binfmt (`docker run --platform linux/arm64 alpine uname -m`
answers `exec format error` on the same host). The daemon uses the containerd
image store (`driver-type: io.containerd.snapshotter.v1`), which is what
`from.sh --contexts=` already requires.

The smoke run at the end of `build-v2.sh` is the other consumer of daemon
emulation: `os/verify/src/smoke.ts` loads `factory-root.oci` with
`docker load` and executes each register entry through `docker run`. Its
executor is one seam — `Exec = (argv) => Promise<ExecResult>`, implemented by
`dockerExec` — and `smokeRun` takes it as an option, so a second executor
changes nothing about the register, the judging or the conclusion.

No stage in `os/rootfs/stages/` is `FROM` a `localhost/` tag: the bases are
the digest-pinned `IMAGE_DEBIAN_*` references, which every driver pulls for
itself, and the staged inputs arrive by `COPY` from the build context.

## Proposal

1. **Two chain modes in the stage driver, chosen by the builder's driver.**
   `stages.ts` gains a `layoutDir` option. When set, a non-terminal stage
   exports `--output type=oci,dest=<layoutDir>/<stage>,tar=false,name=<tag>`
   instead of `-t <tag> --load`, and every stage with a predecessor adds
   `--build-context <prevTag>=oci-layout://<layoutDir>/<prevStage>`. The
   terminal `type=local` export and the `factory-root` OCI export are
   unchanged apart from the same build context. `stages-cli.ts` selects
   tag mode for the `docker` driver and layout mode for `docker-container`,
   replacing `driverCanChain`'s refusal; `--plan` prints whichever mode the
   builder implies. The layout directory is `<dest>/stages/` and is removed
   before the chain starts, so a stale layout from an earlier run cannot be
   chained.
2. **Builder selection in `build-v2.sh`, the same block RAUC and podman use.**
   `BUILDX_BUILDER` wins; otherwise `default` when it reaches the platform,
   else `mos-<arch>`, created on first use. The refusal and its binfmt
   message go; the note names the builder chosen and why.
3. **A buildkit executor for the smoke run.** `smoke.ts` gains
   `buildkitExec(layout, builder, platform)`: one `docker buildx build` per
   register entry, from a generated `FROM <ref>` / `RUN --network=none`
   Dockerfile against `--build-context <ref>=oci-layout://<layout>`, writing
   status, stdout and stderr to a `type=local` output the executor reads
   back. `preflight` runs through it unchanged. `smoke-cli.ts` extracts
   `factory-root.oci` into the scratch root and takes this route when the
   daemon cannot execute the platform and a `mos-<arch>` builder exists; the
   log names the executor. The register, `judge` and `conclude` are untouched,
   so a pass still means the same twelve binaries ran.
4. **Records.** `os/rootfs/stages/README.md` replaces "the builder must
   resolve local tags — measured" with the two modes and the new measurement;
   `docs/design/build.md` section 4 moves the rootfs chain and smoke rows to
   "no host binfmt" and drops section 4.1's exception; `build-harness.md`
   section 5 gains the chain measurement; the changelog gets an entry.
5. **RED first.** `stages.test.ts`: layout mode's argv for the first, a middle
   and the terminal stage, and tag mode unchanged. `smoke.test.ts`: the
   buildkit executor's Dockerfile and argv, and the result read-back. Then
   GREEN, then the real proof: `MOS_BOARD=cx3576 bash os/rootfs/build-v2.sh`
   on this host to a packed root with its smoke run, followed by
   `--mkimage-v2`, `make os-verify-cx3576-v2` and `make os-bundle-cx3576`.
   That needs the BSP kernel and U-Boot, the arm64 builder family, RAUC and
   podman built first; all of them cross-compile or emulate inside buildkit
   and are run as part of this plan.

## Risks

- Each stage's layout is written by the client and read back by the builder,
  so a cx3576 chain moves roughly one root's worth of layers per stage over
  the docker socket. buildkit deduplicates blobs by digest on import, so the
  cost is disk and time, not correctness. Measured once the chain runs.
- The arm64 stages run under QEMU user emulation; the Debian install and
  the kernel-module unpack are the slow parts. This is the same cost the
  host-binfmt route pays.
- A `docker-container` builder has its own layer cache, separate from the
  daemon's; the first cx3576 chain is cold regardless of earlier x64 runs.
- The determinism gate in `os/rootfs/README.md` compares extracted trees,
  not archives, and does not depend on which mode produced the root.
- The buildkit smoke executor wraps each command in a Dockerfile `RUN`, so
  a binary that reads stdin or needs a tty behaves differently; none of the
  twelve register entries does (every one is a `--version`).

## Scope

`os/build/src/stages.ts`, `os/build/src/stages-cli.ts` and `stages.test.ts`;
`os/rootfs/build-v2.sh`; `os/verify/src/smoke.ts`, `smoke-cli.ts` and
`smoke.test.ts`; `os/rootfs/stages/README.md`, `os/rootfs/README.md`,
`docs/design/build.md`, `docs/zh/design/build.md`,
`docs/design/build-harness.md`, the changelog and these records. No change
to any stage Dockerfile, to the image contents, or to the x64 route, which
keeps tag mode on the `docker` driver.

## Alternatives

### Register emulation on the host

Works, needs a privileged step on every build host and on the CI runner,
and leaves the chain unable to build anywhere that step is not taken. It
remains the faster route where it is available: the driver keeps tag mode on
the `docker` driver, so a host with binfmt is unaffected.

### A local registry in the build path

The alternative `stages/README.md` weighed and refused: a daemon to run, a
lifetime to manage and a network dependency in a build that has none. OCI
layouts are files under `_out/`, need nothing running, and are the mechanism
RAUC and podman already use.

### One Dockerfile again

Collapsing the stages would restore the pre-split fallback but give up the
per-stage split the README records the reasons for.

## Annotations

- 2026-08-30 16:19: the user replied "start generating the cx3576 image", which approves this plan as the way to produce it on this host.
