# Install a current development image

Installation uses a complete freshly built MOS system image. The supported image
targets are x64, virt-arm64 and cx3576. There is no conversion or upgrade path
from an earlier partition layout. A full write replaces the target system and
data inside the written image extent; keep any files you need elsewhere first.

> status: shipped — evidence: `build/src/file-image.ts`, `boards/x64/board.env`, `boards/virt-arm64/board.env`, `boards/cx3576/board.env`

## Prepare and identify

Use the exact board's image and obtain its metadata public key from the build's
trusted handover. Run the image verifier with explicit inputs:

```sh
bash verify/run.sh --verify --board x64 \
  --image /path/to/image/disk.img --public-key /path/to/metadata-public.key
```

Substitute `virt-arm64` or `cx3576` only for that board's own image. Verification
checks signed objects and layout; it does not enroll platform boot keys. The
boot signer must be accepted by the corresponding UEFI platform or signed-policy
U-Boot build. Development key generation does not establish production trust.

> status: shipped — evidence: `verify/src/file-image.ts`, `docs/design/key-delivery.md`

## x64 and virt-arm64

Write the complete image to the explicitly identified disposable target medium
using the platform's disk-writing workflow, flush it and compare readback before
booting. Boot through UEFI from its removable-media EFI entry. The disk contains
ESP/SYSTEM/DATA; only DATA grows when the physical medium is larger.

For virtual acceptance, the repository harness uses a fresh disk copy and
explicit public boot certificate:

```sh
MOS_BOARD=x64 MOS_QEMU_IMAGE=/path/to/image/disk.img \
MOS_QEMU_BOOT_CERT=/path/to/boot-signer.cert.pem \
  bash pkgs/mosd/tests/apid-api/run.sh
```

The ARM64 variant selects `MOS_BOARD=virt-arm64` with matching artifacts.
Physical PC/platform enrollment is owned by that platform's operator.

> status: board-dependent — evidence: `pkgs/mosd/tests/apid-api/src/qemu.ts`, `docs/design/release-signing.md`

## cx3576

Use the local bench board's RockUSB loader/maskrom interface and identify the
attached device before writing. The board BSP provides complete-image flashing:

```sh
make -C boards/cx3576/bsp flash-mos MOS_IMAGE=/path/to/image/disk.img
```

Preflight checks the current GPT and loader placement before issuing a device
write. The flashing path reads back and compares every image byte before reset;
a mismatch leaves the board in the recovery interface. Firmware starts at LBA
64, and its reserved partition includes both trial-record copies.

Physical loader/maskrom entry, full flashing, successful boot, watchdog behavior
and power-cut recovery remain bench qualification items. Host stub tests prove
preflight/readback control flow, not that a particular board has been flashed.
Do not treat software evidence as a completed physical installation.

> status: board-dependent — evidence: `boards/cx3576/bsp/Makefile`, `boards/cx3576/bsp/scripts/verify-flash.py`, `docs/task/20260908-2229-file-ab-delivery-x64-first.md`

## First boot and recovery

Healthy boot authenticates the selected deployment, mounts matching signed
root/support, establishes persistent identity on DATA, grows DATA and starts
management services. Health confirmation retains a usable fallback. Use the
[update page](update-rollback.md) for subsequent component updates.

Missing/corrupt shared storage or exhausted boot records requires explicit
recovery. No unsigned retry, old layout, regenerated credentials or silent trial
refill is used. See [recovery](recovery.md) and [storage](storage.md).

> status: shipped — evidence: `pkgs/mos-deploy/src/bin/mos-init.rs`, `rootfs/overlay/usr/lib/mos/mos-health`
