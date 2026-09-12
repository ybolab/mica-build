# Building signed component images

## 0. The rule

A build host needs Docker, git, Bash, Make and ordinary shell utilities.
Compilers, signing tools, filesystem makers and target executors run in pinned
containers from `build-env/images.env`. The Bun build/verify drivers support the
pinned container route when the host has no Bun. No globally installed target
toolchain is required.

### 0.1 Classifying tools

A producer changes bytes that ship: compilers, linkers, package builders,
SquashFS/ext4/GPT makers, signing tools and archive assembly belong to the pinned
build environment. Orchestration selects inputs and commands. A judge reads an
artifact to report a result; image judges also use their declared pinned tools.
Do not substitute host filesystem/signing tools merely because they are present.
`tests/host-toolchain-lint.sh` and its negative suite enforce these boundaries.

The Docker daemon may be a sibling-container host. Bind the narrow project or
artifact path using its actual host path. Paths under `/srv` are identical in
the development environment; `/work` and `/root` aliases require translation.
Agent-created test containers carry the project cleanup label. Build output and
private key directories are never added to source control.

## 1. Independent products

| Product | Inputs | Output |
|---|---|---|
| Root | Resolved userspace packages and public factory defaults | `rootfs-verity.img`, exact geometry, manifest/debug/license evidence |
| Kernel/support | BSP kernel/modules/firmware, native init, public policy and explicit signing inputs | Signed UKI/FIT plus signed support image and component metadata |
| Firmware | Patched systemd-boot or cx3576 loader and metadata signer | Independent signed firmware package |
| Deployment | Exact kernel/root descriptors and metadata signer | Signed `mos/deployment/v1` envelope |
| Factory disk | Two deployments, all referenced components and authenticated firmware | Current three-partition full image |
| Offline update | Signed deployment and its exact objects | `.mosupd` archive |

Root owns userspace. It must contain empty modules/firmware mountpoints and no
kernel or loader payload. Kernel-only packaging leaves root bytes unchanged;
root-only packaging leaves kernel/support/firmware unchanged. A new signed
deployment binds the chosen association.

### 1.1 Root composition

The resolver selects package manifests for board, profile and optional features.
Local `.deb` pools are indexed under `_out/debs/<arch>/`; Debian inputs are
snapshot/length/digest pinned. Composition installs the closure in one APT
transaction and the finalizer validates and packs it. The exact packed OCI root
is used for shipped-binary smoke checks.

`MOS_META_DIR` selects a directory containing current public factory defaults.
The root composer copies its explicit public allowlist and rejects private or
unclaimed material. It does not manufacture keys or migrate an existing
configuration. Metadata anchors are embedded in authenticated kernel policy,
not accepted from the user-space update defaults.

## 2. Setup and explicit trust

Build the pinned environments and required package pools through `make help`.
`make os-deb-preflight` reports missing sources and version inputs before a long
build. Generate isolated development inputs only when needed:

```sh
bash pkgs/mos-boot/dev-keys.sh --out /path/to/new-signing-inputs
```

The output must be new. Boot, content and metadata keys are independent. For a
distributed builder, provide public content certificates and public defaults;
private signing material remains on the corresponding signing host. See
[key delivery](key-delivery.md).

BSP kernel compilation requires explicit public content trust through
`VERITY_TRUST_CERT`. Kernel/support packaging separately requires content signing
key/certificate, boot signing key/certificate and metadata public keys. Missing
inputs fail. cx3576 U-Boot must embed the matching public boot key set.

## 3. Component CLI

`bash build/run.sh --components --help` lists the current command arguments.
All output paths must be new. Typical assembly order is:

1. Build the board BSP kernel and native `mos-init` for the target architecture.
2. Compose userspace with `MOS_BOARD=BOARD MOS_META_DIR=PUBLIC_DIR bash rootfs/build.sh`.
3. Package `root`, `kernel` and `firmware` with their explicit signing inputs.
4. Sign two distinct factory `deployment` records with distinct generations.
5. Assemble `image` from those records, their exact directories and firmware.
6. Produce `archive` for a signed update when offline distribution is needed.

The records input to `image` is an array of exactly two objects with
`envelope`, `kernelDirectory` and `rootDirectory`. Each envelope is the original
signed JSON text. The assembler checks trust, board association, component bytes,
verity geometry, destination capacity, GPT and clean filesystem state. It
accounts for seeded DATA quota usage before publishing the image. The CLI names
the complete image `mos-BOARD-YYYYMMDD-HHmmss.img` using UTC completion time,
writes `SHA256SUMS` beside it, and prints the full image path. Use that actual
filename in verification and release commands; the timestamps below are examples.

```sh
bash build/run.sh --components image --board x64 \
  --records /path/to/factory-records.json \
  --public-key BASE64_ED25519_PUBLIC_KEY \
  --firmware /path/to/firmware-package --out /path/to/new-image

bash verify/run.sh --verify --board x64 \
  --image /path/to/new-image/mos-x64-20260909-164233.img --public-key /path/to/public.key
```

The component CLI takes base64 key values; the verifier takes public-key file
paths. Multiple explicit public keys express an overlap set. A factory image
always uses the current layout; there is no update-from-old-layout path.

## 4. Architectures

x64 and virt-arm64 share the UEFI component contract. Their architecture changes
the BSP kernel, native executable, UKI stub and firmware binary. cx3576 uses the
same root/deployment contracts with a signed FIT and a protected raw firmware
partition. Its BSP firmware blobs and regulatory database belong to support.

Cross-compilation and execution are different capabilities. An amd64 compiler
can emit ARM64 binaries without executing them. Root package scripts and binary
smokes may require BuildKit's user-mode emulator. QEMU system emulation boots a
complete ARM64 machine independently of binfmt registration. A crun `fexecve`
limitation in user-mode emulation is explicitly executor-limited, not a version
check pass; real guest execution is separate evidence.

s905x5m's independent BSP is retained. It is not a current MOS system-image
release target and has no old-layout assembly entry point.

## 5. Verification

Use `make os-build-test`, `make os-verify-test`, `make os-layout-lint`, the Rust,
service/frontend and applicable shell gates. `make os-install-closure-gate`
installs both architecture pools into clean roots and checks dependencies,
accounts, unit targets, ELF resolution and versions, including reduced feature
and independent radio roots.

`os-verify` requires explicit image and metadata key files. It authenticates two
factory deployments, component bytes/verity trees, trial entries, firmware
receipt, exact GPT geometry and current root policy. Its result does not prove
UEFI/FIT key enforcement; boot tests establish that separately.

QEMU API acceptance requires a full factory image and the public boot signer:

```sh
MOS_BOARD=x64 MOS_QEMU_IMAGE=/path/to/image/mos-x64-20260909-164233.img \
MOS_QEMU_BOOT_CERT=/path/to/public-boot.cert.pem \
  bash pkgs/mosd/tests/apid-api/run.sh
```

The harness copies the image, enlarges the virtual medium, seeds DATA service
units, enrolls disposable Secure Boot variables and boots through firmware.
It does not edit the signed kernel command line. `tests/file-ab-x64/` covers
runtime/update/fault/shutdown and large-root measurements for current images.
`tests/file-ab-fit/` covers parser, signer and dirty-filesystem behavior.

The DATA growth test uses the actual packed root policy and a disposable loop
disk. Pass board, complete image and matching root image to
`tests/repart-loader-test.sh`; it checks identities and every protected firmware,
counter and SYSTEM byte around growth.

Track exact image/component identities and limitations in the
delivery task (20260908-2229-file-ab-delivery-x64-first). Physical
cx3576 power-cut/watchdog/USB tests cannot be replaced by sandbox or VM evidence.
