# Quickstart

Start with x64 under QEMU. It boots the complete current system through UEFI
Secure Boot, systemd-boot and a signed kernel package. virt-arm64 uses the same
flow with ARM64 artifacts. Physical cx3576 qualification is a separate step.

## 1. Prerequisites

Use Docker with buildx, Bash, Make and git. Compilers, signing tools and filesystem
makers run in the pinned build containers. The Bun orchestration drivers also
support a pinned container. There is no hosted public image download.

> status: shipped — evidence: `docs/design/build.md`, `build-env/images.env`

## 2. Build the complete image

Follow [the component build sequence](../design/build.md): build the package pool
and BSP kernel, compile native init, compose root, package kernel/support and
firmware, sign two deployment records, and assemble a new factory image.
Supply separate boot/content/metadata signing inputs explicitly. Public factory
defaults are a separate root-composition input. Missing inputs fail; builds do
not generate keys or convert an existing system implicitly.

```sh
MOS_BUILD_PLATFORM=linux/amd64 bash build-env/build.sh
make os-deb-preflight
# See the build guide for the component inputs and architecture-specific steps.
bash build/run.sh --components --help
```

The resulting `disk.img` has ESP, SYSTEM and DATA. Keep its signed deployment
records, public metadata keys, public boot certificate and component directories
with the test evidence. Every test starts from a complete current image.

> status: shipped — evidence: `build/src/component-cli.ts`, `docs/design/build.md`

## 3. Run the QEMU API acceptance suite

```sh
MOS_BOARD=x64 MOS_QEMU_IMAGE=/path/to/image/disk.img \
MOS_QEMU_BOOT_CERT=/path/to/public-boot.cert.pem \
  bash pkgs/mosd/tests/apid-api/run.sh
```

The harness copies the image, seeds its DATA test service units and enrolls
throwaway Secure Boot variables. It boots through firmware and exercises the
HTTPS API. It requires explicit image and certificate paths. Use `--dry-run`
with the same inputs to check prerequisites without starting the guest.

For isolated offline DATA fixtures, `tools/qemu-seed-data.ts` accepts bounded
regular files below `/state` and explicitly enabled seeded service units. Run it
only on a disposable image before boot; its CLI prints the accepted arguments.

> status: shipped — evidence: `pkgs/mosd/tests/apid-api/run.sh`, `tools/qemu-seed-data.ts`

## 4. First contact

The first boot creates a machine identity on DATA before services start. mosd
initializes its device identity and configuration, wired interfaces use DHCP,
and apid serves HTTPS. The UI at `/_ui/` guides administrator setup. SSH is off
by default. See [first run](first-run.md) and [configuration](configuration.md).

> status: shipped — evidence: `pkgs/mos-deploy/src/bin/mos-init.rs`, `docs/design/provisioning.md`, `pkgs/mosd/apid/openapi.json`

## 5. Next steps

- [Installation](install.md) covers complete images and physical boards.
- [Update and rollback](update-rollback.md) describes signed deployments.
- [Applications](applications.md) covers workloads and persistent data.
