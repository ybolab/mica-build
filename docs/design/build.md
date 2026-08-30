# Design: building the images — x64 and cx3576

> English | [中文](../zh/design/build.md)
>
> The build guide: what a complete build is, the order it runs in, which steps
> cross-compile and which need emulation, and how to tell the three arm64
> capabilities apart before believing an error message. `build-harness.md`
> covers the *checks*; this page covers the *artifacts*.

Everything here runs in docker. The host needs docker with buildx, bash, make
and git, and nothing else: no toolchain is installed on the host, and every
compiler comes out of a builder image pinned by digest in
`os/build-env/images.env`.

## 1. What a build produces

A board build ends with three artifacts under `_out/<board>/`:

| Artifact | Made by | What it is |
|---|---|---|
| `<board>-mos-v2-<epoch>.img` and `<board>-mos-v2-latest.img` | `bash os/build/run.sh --mkimage-v2` (cx3576) or `--mkimage-x64` | the whole-disk A/B image to flash |
| `rootfs-verity.img` + `rootfs-verity.env` | `os/rootfs/build-v2.sh` | one rootfs slot: squashfs with its dm-verity tree, and the parameters the kernel command line needs |
| the RAUC bundle | `bash os/build/run.sh --bundle --board <board>` | the signed update for a device already running mos |

The image names are read from the board definition (`IMAGE_NAME_PREFIX`,
`IMAGE_LATEST_NAME` in `os/boards/<board>/board.env`), never spelled in a
script.

Before the rootfs can be built, four compiled inputs must exist. None of them
is built on demand; each has its own entry point and its own output directory,
and the rootfs build names the one that is missing:

| Input | Built by | Lands in |
|---|---|---|
| builder images `localhost/mos-build-{base,c,go,rust}:<arch>` | `os/build-env/build.sh` | the local docker image store |
| RAUC | `os/pkgs/rauc/build.sh` | `os/pkgs/rauc/out-<arch>/` |
| podman and its six companions | `os/pkgs/podman/build.sh` | `os/pkgs/podman/out-<arch>/` |
| mosd, apid, mos-mqttd, mos-mqtt-broker | `os/pkgs/mosd/hack/build-target.sh` | `_out/<board>/mosd/` (the rootfs build runs this one itself) |

cx3576 additionally needs its BSP: the kernel (`Image`, `modules.tar`,
`rk3576-src.dtb`) and the A/B U-Boot (`u-boot-rockchip.bin`), built by
`os/boards/cx3576/bsp/Makefile` into `os/boards/cx3576/bsp/out/`. x64 has no
BSP: UEFI firmware boots it and Debian's `linux-image-amd64` is installed by
the rootfs chain.

Output directories carry the architecture in their name (`out-amd64`,
`out-arm64`, `:amd64`, `:arm64`) so the two boards' inputs coexist. A build
for one board never overwrites the other's.

## 2. One-time setup

**Builder images, per architecture.** Every component build is `FROM` a
`localhost/mos-build-*:<arch>` tag, and the tag carries the architecture of the
*target*:

```sh
MOS_BUILD_PLATFORM=linux/amd64 bash os/build-env/build.sh   # for x64
MOS_BUILD_PLATFORM=linux/arm64 bash os/build-env/build.sh   # for cx3576
```

`make build-env` builds the host's own family. A family for the other
architecture is a different set of tags, and a component build that finds its
family missing refuses by name (`LOCAL_MOS_BUILD_BASE resolves to
localhost/mos-build-base:amd64, which is not in the local docker image store`)
rather than pulling from a registry called `localhost`.

**Signing keys.** `make os-devkeys` writes a development CA and signer under
`os/pkgs/rauc/.devkeys/` (gitignored). The bundle step signs with them. The
image does *not* trust them unless the keyring is copied to
`os/rootfs/overlay-v2/etc/rauc/keyring.pem` and the rootfs is built with
`MOS_EXPECT_DEV_KEYRING=1` — do that for a bench device that must install
locally signed bundles, and for nothing that leaves the bench.

## 3. x64, end to end

Every step runs natively on an amd64 host. In order:

```sh
MOS_BUILD_PLATFORM=linux/amd64 bash os/build-env/build.sh
bash os/pkgs/rauc/gen-dev-keys.sh
MOS_BOARD=x64 bash os/pkgs/rauc/build.sh
MOS_ARCH=amd64 bash os/pkgs/podman/build.sh
MOS_BOARD=x64 bash os/rootfs/build-v2.sh
bash os/build/run.sh --mkimage-x64
bash os/verify/run.sh --verify --board x64
bash os/build/run.sh --bundle --board x64
```

`make` spellings exist for most of them (`make os-rauc`, `make podman`,
`make os-verify-cx3576-v2`), but their defaults are cx3576 and arm64, so for
x64 the environment variable is not optional. The rootfs build ends with a
smoke run that executes the freshly built binaries inside the packed root;
on x64 that is a native `docker run`, so nothing extra is needed.

Boot the result with the QEMU harness under `os/pkgs/mosd/tests/apid-api/`,
which takes `_out/x64/x64-mos-v2-latest.img` as its input and builds nothing.

## 4. cx3576: what crosses, what emulates, what needs the host

An amd64 host reaches arm64 three different ways, and each step below uses
exactly one of them:

- **cross-compile** — the compiler runs at the host's architecture and emits
  arm64 code. Needs nothing beyond docker.
- **emulate inside buildkit** — a `docker-container` builder whose buildkit
  image bundles QEMU runs arm64 `RUN` steps. Needs nothing on the host either;
  the builder is created on first use as `mos-arm64`.
- **emulate in the daemon** — `docker run --platform linux/arm64` and the
  `default` buildx builder execute arm64 through the host kernel's
  `binfmt_misc`. Needs a one-time registration **on the host**.

| Step | Command | Route | Host binfmt |
|---|---|---|---|
| arm64 builder family | `MOS_BUILD_PLATFORM=linux/arm64 bash os/build-env/build.sh` | emulate inside buildkit | no |
| U-Boot, both variants | `make cx3576-uboot cx3576-uboot-mos` | cross-compile (`CROSS_COMPILE=aarch64-linux-gnu-` in an amd64 Ubuntu stage); the image takes `uboot-mos`, and the verifier compares it against the debug variant to prove the pairing | no |
| kernel | `make cx3576-kernel` | cross-compile, same toolchain | no |
| RAUC | `make os-rauc` (`MOS_BOARD=cx3576` is the default) | `default` builder if the host has binfmt, else `mos-arm64` with the builder images handed over as OCI layouts | no |
| podman | `make podman` (`MOS_ARCH=arm64` is the default) | as RAUC; its source stage runs at the build platform on the amd64 base | no |
| mosd family | run by the rootfs build via `os/pkgs/mosd/hack/build-aarch64.sh` | cross-compile: cargo target `aarch64-unknown-linux-gnu` in `mos-build-rust:amd64` | no |
| rootfs chain | `bash os/rootfs/build-v2.sh` (`MOS_BOARD=cx3576` is the default) | `default` builder if the host has binfmt, else `mos-arm64` chaining the stages by OCI layout (section 4.1) | no |
| smoke run | last step of the rootfs build | `docker run` if the daemon can execute arm64, else one throwaway build per artifact on `mos-arm64` | no |
| disk image | `bash os/build/run.sh --mkimage-v2` | file assembly only | no |
| image verification | `make os-verify-cx3576-v2` | reads files out of the image | no |
| bundle | `make os-bundle-cx3576` | `rauc bundle` in an amd64 container | no |

So the whole of cx3576 builds on an amd64 host with no host-level emulation
at all. In order:

```sh
MOS_BUILD_PLATFORM=linux/arm64 bash os/build-env/build.sh
bash os/pkgs/rauc/gen-dev-keys.sh
make cx3576-uboot cx3576-uboot-mos
make cx3576-kernel
make os-rauc
make podman
bash os/rootfs/build-v2.sh
bash os/build/run.sh --mkimage-v2
make os-verify-cx3576-v2
make os-bundle-cx3576
```

`BOARD_DIR=/path/to/bsp` points the rootfs build and the assembler at
prebuilt BSP artifacts (a directory holding `out/kernel/` and
`out/uboot-mos/`), so a kernel built once can serve many rootfs builds.

### 4.1 How the rootfs chain reaches arm64 without the host

The rootfs is not one Dockerfile but a chain: `os/rootfs/stages/` holds one
file per stage, and every stage after the first opens `FROM ${MOS_STAGE_PREV}`.
The stage driver (`os/build/src/stages-cli.ts`) links that chain one of two
ways, chosen by the builder's driver:

- **tag mode** on the `docker` driver: each stage is a tag in the daemon's
  image store, and the next `FROM` finds it there. That driver executes arm64
  only through the host's `binfmt_misc`, so this is the native route and the
  route on a host that has registered the emulator.
- **layout mode** on a `docker-container` builder: each stage is exported as
  an OCI layout under `_out/<board>/stages/` and handed to the next as a named
  build context under the very tag its `FROM` names. Nothing touches the
  daemon's image store, and the builder's bundled QEMU executes the arm64
  steps.

`build-v2.sh` picks the builder the way RAUC and podman do — `default` when it
reaches the platform, else `mos-<arch>` — and the smoke run at the end, when
the daemon cannot execute the root, executes every register entry inside that
builder instead, one throwaway build per artifact, with the same register and
the same judging. `os/rootfs/stages/README.md` records the measurement and the
cost: one copy of the root's layers over the docker socket per stage.

Before layout mode existed the driver refused any builder but the `docker`
one, so a cross build needed host binfmt; the stage split had removed the
single-Dockerfile fallback to the container builder. Layout mode restores that
capability without a registry in the build path.

## 5. arm64 on an amd64 host: check by executing, never by inspecting

Three questions, three commands, and the answer to one says nothing about the
others. `docker buildx ls` and `docker buildx inspect` under-report on some
hosts — a builder that demonstrably executes arm64 has been seen listed as
`linux/amd64 (+3), linux/386` — so none of these is settled by reading a table.

**Can buildkit emulate?** A throwaway build on the container builder:

```sh
printf 'FROM alpine:3.21\nRUN uname -m\n' | \
  docker buildx build --builder mos-arm64 --platform linux/arm64 --no-cache --progress=plain -
```

`aarch64` in the `RUN` output means RAUC, podman and the arm64 builder family
will build. Create the builder first if `docker buildx ls` does not list it:
`docker buildx create --name mos-arm64 --driver docker-container`.

**Can the daemon execute?** The question tag mode and `docker run` ask; layout
mode and the buildkit smoke executor do not need it:

```sh
docker run --rm --platform linux/arm64 alpine:3.21 uname -m
```

`aarch64` means yes; `exec /bin/uname: exec format error` means no. Run
`docker run --rm alpine:3.21 uname -m` beside it: on a loaded host the
container-create call can time out, and `context canceled` reads like an arm64
verdict when it is a busy daemon.

**Registering emulation on the host** is optional: it makes the rootfs chain
take tag mode on the `default` builder, which is faster than layout mode. Either
of these, run **on the host**, not inside a container that merely mounts the
docker socket — a registration made from inside a container has been observed
to report success and change nothing the daemon can see:

```sh
# any distribution, through docker itself
docker run --privileged --rm tonistiigi/binfmt --install arm64

# Fedora / RHEL family, persistent across reboots
sudo dnf install -y qemu-user-static
sudo systemctl restart systemd-binfmt
```

Then re-run the daemon check above; the `default` builder's platform list
(`docker buildx inspect default`) gains `linux/arm64` at the same time, which is
the exact test `build-v2.sh` applies. Undo with `--uninstall arm64` or by
removing the package.

**What needs no emulator at all.** Reading bytes out of an arm64 image —
`docker create --platform linux/arm64 ... && docker cp` — works everywhere,
which is why image verification and the bundle build run on any host.

## 6. Reading the failures

| Message | Meaning | Do |
|---|---|---|
| `LOCAL_MOS_BUILD_BASE resolves to localhost/mos-build-base:<arch>, which is not in the local docker image store` | the builder family for that architecture was never built, or was built under an older architecture-less tag | `MOS_BUILD_PLATFORM=linux/<arch> bash os/build-env/build.sh` |
| `note: the 'default' builder cannot reach linux/arm64 on this host; using the docker-container builder 'mos-arm64'` | not an error: the rootfs chain is taking layout mode | nothing; register emulation on the host (section 5) only if you want the faster tag mode |
| `exec /bin/sh: exec format error` inside a build | either no emulator, **or** a single-architecture `localhost/` base under `--platform` (the tag has no index to select from, so buildkit serves what it holds and applies no emulator) | check the daemon (section 5); if it executes, the stage's base is the wrong architecture — `build-harness.md` section 5.1 |
| `pull access denied ... localhost/...` from a `docker-container` builder | a local tag handed to a builder that cannot read the image store | use the `default` builder, or hand the image over as an OCI layout (`os/build-env/from.sh --contexts=`) |
| `modules.tar not found` | the cx3576 kernel was not built, or `BOARD_DIR` points elsewhere | `make cx3576-kernel`, or set `BOARD_DIR` |
| `os/pkgs/rauc/out-<arch>/rauc not found` / `os/pkgs/podman/out-<arch>/podman not found` | the component was built for the other architecture, or not at all | `MOS_BOARD=<board> make os-rauc`, `MOS_ARCH=<arch> make podman` |
| `mqttd: the unit runs as 'mos-mqttd' and no such account` (from the verifier) | the `mqtt` feature stage was declined while its units shipped | build with the stage, or decline mosd too |

A build that stops with one of these has written nothing under
`_out/<board>/` it will later trust: every consumer re-checks its inputs by
name.

## 7. Verification

*Measured on this host on 2026-08-30.* The x64 sequence of section 3 was run
as written, in one shell, on an amd64 host with docker 28 and no host binfmt.
`docker run --rm --platform linux/arm64 alpine:3.21 uname -m` answered
`exec /bin/uname: exec format error` on the same host, and registering
emulation from inside the build container was not possible, so the cx3576
rootfs chain was not run here; the cross-compiling and buildkit-emulated rows
of section 4 are taken from the scripts' own builder selection and from the
2026-08-28 buildkit measurement recorded in `build-harness.md` section 5.
