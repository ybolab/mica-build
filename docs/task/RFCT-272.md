# RFCT-272 Chain the rootfs stages through OCI layouts so cx3576 builds without host binfmt

- **status**: done
- **completedAt**: 2026-08-31
- **priority**: P1
- **owner**: roy/mqtt-review-fixes-20260830
- **createdAt**: 2026-08-30 12:10
- **plan**: [PLAN-035](../plan/PLAN-035.md)

## Description

The cx3576 rootfs chain is the only step of the cx3576 build that needs the
host's `binfmt_misc`: the stage driver chains stages by local docker tag,
which only the `docker` buildx driver can resolve, and that driver emulates
arm64 only through the host. Every other cx3576 step cross-compiles or
emulates inside buildkit already.

Let the stage driver chain stages through OCI layouts when the builder is a
`docker-container` one, select that builder in `build-v2.sh` the way RAUC and
podman do, and give the smoke run a buildkit executor so the packed root's
binaries are still executed. Prove it by building cx3576 end to end on a host
without binfmt.

## Acceptance

- `bash os/build/run.sh --build-rootfs --builder mos-arm64 --platform linux/arm64 ...`
  builds the chain with no `-t`/`--load` and no tag in the image store; the
  tag mode on the `docker` driver is byte-for-byte what it was.
- `MOS_BOARD=cx3576 bash os/rootfs/build-v2.sh` on a host where
  `docker run --platform linux/arm64` fails with `exec format error` produces
  `_out/cx3576/rootfs-verity.img`, runs the smoke register through buildkit,
  and reports the executor it used.
- `bash os/build/run.sh --mkimage-v2`, `make os-verify-cx3576-v2` and
  `make os-bundle-cx3576` then succeed on the same host.
- `os/build` and `os/verify` suites pass, with RED-first cases for both chain
  modes and for the buildkit executor.
- `os/rootfs/stages/README.md`, `docs/design/build.md` (both languages),
  `build-harness.md` and the changelog describe the two modes and the
  measurement.

## ActiveForm

Chaining the rootfs stages through OCI layouts on the container builder.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

Completed: every acceptance item ran on this binfmt-less host; the smoke
register reports crun as `executor-limited` (its memfd re-exec is the
emulator's limit), a verdict added at 65ea58f under PLAN-035's option A.


Feasibility measured on 2026-08-30: a two-stage probe chained through
`--output type=oci,tar=false` and `--build-context ...=oci-layout://` on
`mos-arm64` at `--platform linux/arm64` printed `aarch64` from the second
stage on a host with no binfmt.
