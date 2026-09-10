# 20260910-0254-cx3576-integrated-image Build the current integrated cx3576 image and reassess boot-log cleanup

- **status**: completed
- **priority**: P1
- **owner**: worker/cx3576-integration-20260910
- **createdAt**: 2026-09-10 02:54

## Description

The user requests one latest complete cx3576 factory image, then a review of
`20260910-0029-cx3576-boot-log-cleanup`. Integrate strict two-deployment A/B,
the completed HDMI command-line repair and the native U-Boot console repair.
Keep SYSTEM at 1 GiB and timestamp the output. No compatibility or migration.
The requested review does not authorize implementing the separate cleanup plan.

## ActiveForm

The integrated image is delivered and the boot-log cleanup proposal has been
reviewed against its actual kernel configuration, DTB, FIT and initramfs.

## Verification

Verify exact reused source/artifact identities, rebuild the FIT with current
init, run current build and firmware checks, verify the assembled image and
required signatures, and exercise DATA-only growth. Review the cleanup plan
against the resulting image inputs; keep physical acceptance explicitly open.

## Notes

Full tier; image generation is explicitly authorized. Preserve the other repairs'
working-tree changes and ownership. Native root/init sources are unchanged since
the clean `0209c4bf462b` acceptance; reuse that current component set, not the
older `97bb466792ca` root used by the separate display/console candidates.

## Delivered image

- Image: `_out/cx3576-integrated-20260910/image/mos-cx3576-20260910-030308.img`.
- Size: 1,362,100,224 bytes (1,299 MiB); SYSTEM remains 1,073,741,824 bytes.
- SHA-256: `b5a4f41800d1901ad08cb6aceebe171f351da607b9a8bc2084d354ef444e1166`.
- Includes current strict A/B root/init, the centered single HDMI logo and hidden
  cursor policy, the one-second native U-Boot console, and the existing watchdog/
  RockUSB recovery repairs. Factory deployments have generations 7 and 8;
  authenticated firmware has generation 5.
- Assembly snapshot: `730ebb31` plus the recorded uncommitted repair inputs.
  Exact file hashes are in `_out/cx3576-integrated-20260910/source-record.json`.
  Other owners' source changes remain uncommitted and untouched in the main tree.
- Root/init reuse clean `0209c4bf462b`. Their sources are unchanged; rendering the
  old/current board runtime storage configuration produces identical output.
  The HDMI BSP matches its recorded source patch, Image and config hashes.
  U-Boot was rebuilt from the snapshot and matches the verified console loader.
  The FIT was repackaged and signed with the current init; archive inspection
  verifies the exact current init binary at `/init`.
- `build-record.json`, component manifests, public metadata key, checksums and
  selected test logs accompany the image. No private keys are distributed.

## Acceptance and limits

The current build suite passes 389 tests with zero failures and TypeScript
checking. Native firmware record and I/O fixtures pass. The U-Boot build passes
the native console/watchdog checks; resolved configuration is `BOOTDELAY=1` and
`BOOTCOMMAND="mosboot"`. Required FIT signatures and changed kernel/DTB/initramfs,
missing-signature and unknown-key rejection all pass against the shipped loader.
All 123 offline checks pass with no skips. Exact flash geometry, real DATA-only
growth and final delivery checksums pass. Host-toolchain lint and docs checks pass.

The existing whole-tree shell lint still fails, independently of the successful
image checks (141/142 files clean; make exit 2):

```text
FAIL: boards/cx3576/bsp/uboot/embed-trust.sh:15: an early-exiting grep on the right of a pipe, in a file that sets pipefail: the pipeline reports failure when the pattern IS found. Use 'grep -c ... >/dev/null'
```

This finding remains open; no complete whole-tree gate pass is claimed. The
initial packaging attempt also failed because copying cached `node_modules`
dereferenced `.bin/tsc`. Preserving the cache symlinks repaired the build setup;
the subsequent build and gates pass as listed above. Initial logs are retained.

Evidence and reproduction scripts: `.tmp/cx3576-integrated-20260910/`.
Frozen source and full component outputs remain under its `source/` directory.
Image evidence is `source/_out/cx3576-integrated-20260910/verify/cx3576-wfopEL`.
No physical board was flashed or booted. UART, display, apid reboot, watchdog
handoff and physical fault qualification remain pending with the parent P10 task.

## Review of the boot-log cleanup proposal

Reviewed the local draft `docs/plan/20260910-0029-cx3576-boot-log-cleanup.md`
after the integrated image was generated. Its classification-based approach is
sound: preserve expected diagnostics and repair established configuration or
driver defects. Its original boot log remains historical and does not validate
this image. The broad repair proposal is still a draft; its approval state and
owner are unchanged by this review.

### Rebase acceptance on the integrated image

Use the image and source identities above for the next physical capture. The
1 GiB layout, strict two-deployment replacement, centered-logo command line and
native console entry are already included. Do not repeat those source repairs
or use the older `97bb466792ca` root as the runtime baseline. Collect the serial
and service log through health confirmation and at least 180 seconds of stable
operation; the old log ends before proving those outcomes.

### Findings still present in the compiled inputs

| Item | Current evidence | Review disposition |
|---|---|---|
| autofs | Neither `CONFIG_AUTOFS_FS` nor `CONFIG_AUTOFS4_FS` is enabled in the exported config | Enable the supported current symbol and verify the resolved config in the first focused repair. |
| Camera graph | Board source still includes the EVB camera graph; merged DT disables IMX415 while `mipi0-csi2` remains enabled | Trace endpoint consumers and retire the orphan route together; avoid deleting shared media resources by name alone. |
| Linux OP-TEE | Config enables OP-TEE/RNG/SCMI transport; compiled `/firmware/optee` is enabled, while active SCMI uses `arm,scmi-smc` | Confirm remaining consumers, then remove unused Linux declarations/options. Vendor BL31 messages require separate firmware evidence. |
| GPU configuration | DT identifies `arm,mali-bifrost` with lowercase `gpu`, `mmu`, `job` names; MALI400 is also enabled | Disable the unused MALI400 path; verify the pinned driver's preferred IRQ names before changing names, preserving numbers/order. |
| Firmware logo reservations | Compiled `drm-logo@0` and `drm-cubic-lut@0` each have zero-length `reg`; display consumers still reference them | Remove unused provider/consumer pairs together, preserving Linux HDMI/logo and the separately tracked late-attachment work. |
| FIT descriptions | Actual signed FIT lacks `description` on kernel, FDT, ramdisk and selected configuration | Add the proposed English descriptions in the producer, then rebuild and sign. Keep load/entry addresses and signature requirements intact. |
| VENC/VDEC/NPU | No new physical workload or MMIO-owner evidence was collected | Keep a separate investigation/functional-acceptance phase; do not invent OPP voltages, bypass ownership or suppress errors. |

Compiled-artifact inspection is under `.tmp/cx3576-integrated-20260910/inspection/`
(`resolved.dts`, `fit.txt`, `initramfs.json`). These are static observations, not
claims that a fresh board reproduced every historical diagnostic.

### Updated initramfs measurement

The new archive is 33,615,872 bytes (about 32.06 MiB), SHA-256
`56e760118410f33ced8632f1dec7ba50a9c03554b77aa99e511230fd8627192c`.
Its 20 regular exitrd files still contain 17,253,688 bytes (about 16.45 MiB), or
17,293,312 bytes rounded per file to 4 KiB. `/run/initramfs` has a 36 MiB tmpfs
limit and retains the shutdown environment by design. These archive measurements
do not establish live RSS; preserve that distinction and measure the actual
mount/usage on the board. Removing the shutdown closure is outside this cleanup.

### Recommended execution order

1. Update the proposal's acceptance baseline, then handle the source-confirmed
   board/config/FIT changes as a focused batch. Include the known trust-helper
   shell-lint correction in its scoped verification.
2. Investigate media/NPU/resource ownership separately with the pinned driver
   sources and actual workloads; retain explicit unresolved results where a
   board, peer or vendor firmware capability is unavailable.
3. Rebuild the affected signed components and complete the proposed current-image
   service, network, radio, watchdog, display and power-cut matrix on the bench.

The focused image-integration plan is consolidated into this task. The separate
boot-log cleanup plan and its implementation approval remain with its owner.

- complete: Delivered the integrated image with component/image acceptance and reviewed the boot-log cleanup proposal; existing shell-lint and physical acceptance limits remain explicit.
