# Quickstart

The shortest honest path to a running mos system is the x64 board — a generic
UEFI x86_64 target that boots in QEMU with no hardware, no flashing tool and no
cross toolchain. It is the CI baseline, and everything it proves about the OS
core, the management plane and the API is the same code that ships on real
boards. What it deliberately does not exercise is a bootloader: the A/B U-Boot
handshake is a cx3576 fact, and a green QEMU run says nothing about it.

There is no hosted download today, so the quickstart builds the image from
source. See [download.md](download.md) for what a release consists of and
[install.md](install.md) for real hardware.

## 1. Prerequisites

An amd64 Linux host with docker (with buildx), bash, make and git. Nothing
else: no toolchain is installed on the host, and every compiler comes out of a
builder image pinned by digest.

> status: shipped — evidence: `docs/design/build.md`, `build-env/images.env`

## 2. Build the image

In order, from the repository root:

```sh
MOS_BUILD_PLATFORM=linux/amd64 bash build-env/build.sh   # builder images
make os-debs                                             # the package pool
MOS_BOARD=x64 bash rootfs/build.sh                       # the rootfs slot
bash build/run.sh --mkimage-x64                          # the A/B disk image
bash verify/run.sh --verify --board x64                  # the image contract
```

Notes worth knowing before the first run:

- `make os-debs` builds every mos Debian package. The `rauc` and `podman`
  producers compile their upstreams on first run; podman alone is roughly
  three quarters of an hour. Later runs reuse the build cache.
- A build that finds no signing material generates a development trust root in
  the repository-root `meta/` directory and says so loudly. That image trusts a
  development keyring, and the verifier says so in its verdict.
- Each step refuses missing or stale inputs by name rather than rebuilding
  them silently; the refusal messages name the command to run.

The result is `_out/x64/x64-mos-latest.img`, a whole-disk A/B image.

> status: shipped — evidence: `make os-debs`, `make os-rootfs-x64-composed`, `docs/design/build.md`

## 3. Boot it in QEMU

The QEMU harness under `pkgs/mosd/tests/apid-api/` boots the built image with
apid's HTTPS port forwarded and drives the management API over a real socket —
it is both the supported way to boot the x64 image and the API acceptance
suite. It builds nothing and refuses a missing image by name:

```sh
bash pkgs/mosd/tests/apid-api/run.sh --dry-run   # check preconditions, boot nothing
bash pkgs/mosd/tests/apid-api/run.sh             # boot and run the API suite
```

To pre-seed configuration into the image's STATE partition before a boot —
for example a Quadlet container definition — use
`bash tools/qemu-seed-state.sh`; its header documents the order of operations.

> status: shipped — evidence: `pkgs/mosd/tests/apid-api/run.sh`, `tools/qemu-seed-state.sh`

## 4. First contact

On first boot the device provisions itself with no network input: it mints its
identity, names itself `mos-` followed by the first eight hex characters of its
device id, and brings up DHCP on wired interfaces. The management surface is
apid over HTTPS; the built-in UI is at `/_ui/`, and the first visit runs setup —
creating the administrator credential. SSH ships off by default.

See [first-run.md](first-run.md) for the whole first-boot story and
[configuration.md](configuration.md) for what can be configured afterwards.

> status: shipped — evidence: `docs/design/provisioning.md`, `pkgs/mosd/apid/openapi.json`

## 5. Where to go next

- Real hardware: [install.md](install.md), and for boards mos does not ship,
  the porting manual at [../bsp/porting.md](../bsp/porting.md).
- Updating a running device: [update-rollback.md](update-rollback.md).
- Running applications: [applications.md](applications.md).
