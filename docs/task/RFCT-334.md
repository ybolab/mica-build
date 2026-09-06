# RFCT-334 Compose the arm64 rootfs without chrooting into it

- **status**: completed
- **priority**: P0
- **owner**: maintainer/rootfs-arm64-20260906
- **createdAt**: 2026-09-06 08:30

## Description

Unblock the arm64 rootfs composition. Every arm64 compose has failed in `10-compose` since the base moved to an offline dpkg bootstrap: `chroot: failed to run command '/debootstrap/debootstrap': No such file or directory`, about a file that is present. x64 composes and verifies. Remove the cause rather than working around it, and keep the composition offline.

## ActiveForm

Completed the move from an emulated chroot to a build stage whose rootfs is the target root.

## Dependencies

- **blocked by**: (none)
- **blocks**: the arm64 virtual board

## Notes

- The cause is buildkit's emulator, not the file the message names. BuildKit runs a foreign-architecture step by prepending its own x86-64 emulator to the step process; that emulator implements `execve` by re-executing itself through `/proc/self/exe`. `chroot` puts an empty `$ROOT/proc` under that path, the re-exec fails, and the kernel reports ENOENT for the binary being run.
- Measured on this host, in an arm64 buildkit step: bare chroot fails; staging the emulator inside the root fails identically; mounting `/proc` inside the root makes it pass with no emulator staged at all. A RUN step cannot mount `/proc` -- it has no CAP_SYS_ADMIN -- so the chroot has no fix, only a replacement.
- The emulator staging and its `ldd` closure added on the way to this diagnosis are removed. The trivial-exec probe is kept, on the one chroot that remains.

## Acceptance

- `bash rootfs/build.sh` composes cx3576, and the image contract and verification pass at their pre-regression counts.
- x64 still composes and verifies; no board is traded for the other.
- The composition still runs with `--network=none`.
- `tests/debian-base-test.sh` and `tests/debian-lock-test.sh` pass.
- The compose surfaced a SECOND, independent regression from the same commit. `ec24a458` replaced `FROM debian:trixie-slim` with a `FROM scratch` bootstrap, and the slim image's `/etc/dpkg/dpkg.cfg.d/docker` -- not anything in this repository -- was what kept `/usr/share/{doc,man,info,locale,lintian}` out of every dpkg unpack. Diffed against the last successful cx3576 root: near-identical package sets, and the whole 48 MB gap is 3363 paths under those trees. cx3576 came to 434 MB against a 400 MB budget; x64 carried the same weight and stayed green only on headroom. The exclusions are restored in `configure.sh`, before dpkg runs.

- complete: cx3576 composes at 379 MB (budget 400; the last pre-regression build was 384) and verifies 418/418 with 3 named skips; x64 composes at 292 MB (budget 520) and verifies 315/315 with 22 named skips; both smoke runs pass (cx3576 11 pass + 1 executor-limited on crun, x64 12/12); `tests/debian-base-test.sh` 43 checks and `tests/debian-lock-test.sh` pass; every RUN in the composition still carries `--network=none`.
