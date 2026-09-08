# RFCT-927 Run the s905x5m U-Boot section-5 export measurement

- **status**: completed
- **priority**: P1
- **owner**: plan-910-m2-build-export
- **createdAt**: 2026-08-31 09:18 UTC
- **completedAt**: 2026-08-31 09:27 UTC
- **reopenedAt**: 2026-08-31 09:32 UTC
- **durableCompletedAt**: 2026-08-31 09:41 UTC
- **plan**: PLAN-910 M2 follow-up

## Description

Run the committed s905x5m default U-Boot artifact target at `ec0c70c` on the
approved build host and record what the section-5 contract actually reports.
The measurement must capture the four `section 5:` requirement lines verbatim,
the FIT-debt warning, the terminal result, and, if export succeeds, the artifact
path, byte size, and SHA-256. A failure is a valid result and must identify the
board-owned requirement group and its observed value.

Do not alter the Dockerfile, defconfig, board definition, or board design
document to obtain a passing result. Do not write any device, eMMC boot area,
or `bootloader_a`, and do not deploy to hardware.

## Acceptance

- The default `make -C os/boards/s905x5m/bsp uboot` artifact path is run from
  the committed source, not inferred from a Dockerfile read or a fixture.
- The log records the bootcount, redundant-MMC-environment, FIT,
  FIT-signature, and per-board bootm section-5 evidence exactly as printed.
- The FIT warning is present and explicitly states that s905x5m does not verify
  its kernel.
- The terminal section-5 line distinguishes board-owned success from the
  remaining tree-wide FIT security debt.
- If an artifact is exported, its remote path, size, and SHA-256 are recorded;
  it is described only as an input to the target-generated Amlogic packaging
  path, never as a flashable boot0 image.

## ActiveForm

Running the committed s905x5m U-Boot artifact export and recording section-5 evidence.

## Dependencies

- **blocked by**: (none; the user explicitly authorized the real build on 2026-08-31)
- **blocks**: the first actual PLAN-910 M2 section-5 export measurement

## Investigation

- `os/boards/s905x5m/bsp/Makefile` routes `uboot` to the default Dockerfile
  artifact stage with `-o out/uboot`; it does not select the diagnostic
  `build` target.
- At `ec0c70c`, the contract checks the produced final `.config` for the
  bootcount backend, the redundant MMC environment and built-DTB overrides,
  both FIT symbols, and the exact s905x5m-derived
  `CONFIG_SYS_BOOTM_LEN=0x4000000` value.
- FIT/FIT_SIGNATURE remains intentionally non-blocking, but the Dockerfile
  emits a tree-wide security-debt warning and a final line that says only the
  board-owned requirements pass. RFCT-924's prior isolated run is not a
  substitute for this committed full measurement.
- The local checkout at investigation time has no `out/uboot` directory and
  no tracked U-Boot artifact. The build will use an isolated remote snapshot so
  concurrent users of the shared checkout are not disturbed.

## Proposal

Create an isolated source snapshot of committed `ec0c70c` on
`192.168.27.200`, preserve the full default-build log there, and run the board
artifact target in a tmux session. On completion, inspect only the exported
directory and log for the requested evidence. The user's direct request to run
the build is the explicit authorization for this measurement phase.

## Risks

- The cold emulated build can take substantially longer than a normal local
  check and may fail due to a real source, builder, network, or capacity issue.
- Signed U-Boot image hashes include build-time data and are run evidence, not
  reproducible source identifiers.
- Exporting `u-boot.bin.signed` does not authorize flashing it: boot0 requires
  a target-generated `storage_emmc_boot_info` sector through the package path.

## Scope

- One isolated remote build, its log, and this task record.
- No source, configuration, gate, documentation-contract, hardware, or remote
  repository mutation.

## Alternatives

- Reading the Dockerfile or using a synthetic final config: rejected because
  neither establishes that the real artifact path reaches the gate.
- Running only `--target build`: rejected because it bypasses artifact export
  and therefore cannot answer the section-5 gate question.

## Notes

- Claimed at the start of investigation. The result will be recorded whether
  the build exits successfully or fails.

## Execution

- The first invocation used the requested
  `make -C os/boards/s905x5m/bsp uboot` target from an isolated archive of
  `ec0c70c`. It exited zero and exported files, but every executable Dockerfile
  layer was a BuildKit cache hit; it replayed the contract command definition
  rather than its runtime `echo` output. It is therefore not used as the
  section-5 measurement.
- A second isolated archive of the same commit was built on
  `192.168.27.200` in tmux session `src-baad6e`. It used the Makefile's exact
  artifact command expansion with only `--no-cache` added to force execution:
  `docker buildx build --no-cache -f uboot/Dockerfile $IMG -o out/uboot uboot`.
  The source Dockerfile SHA-256 was
  `df0abd93a854091afc8b41428946c255057dca2a63e38b2002c4d9a877f82aef` and
  the remote runner recorded exit status `0`.

## Verification

The following is the runtime contract output verbatim, including BuildKit's
per-line `#23 <seconds>` transport prefix:

```text
#23 0.249 section 5: bootcount limit=1 backend=1 saveenv=1 observed=CONFIG_CMD_SAVEENV=y
#23 0.249 CONFIG_BOOTCOUNT_LIMIT=y
#23 0.249 CONFIG_BOOTCOUNT_ENV=y
#23 0.269 section 5: redundant MMC environment mmc=1 storage-enabled=0 redundant=1 primary=1 redundant-offset=1 size=1 dev=1 part=1 dtb=/uboot/bl33/v2023/build/arch/arm/dts/amlogic/meson-s7d-bm201.dtb dt-overrides=0 observed=CONFIG_ENV_SIZE=0x10000
#23 0.269 CONFIG_ENV_OFFSET=0x7800000
#23 0.269 CONFIG_ENV_OFFSET_REDUND=0x7C00000
#23 0.269 CONFIG_ENV_IS_IN_MMC=y
#23 0.269 CONFIG_SYS_REDUNDAND_ENVIRONMENT=y
#23 0.269 CONFIG_SYS_MMC_ENV_DEV=1
#23 0.269 CONFIG_SYS_MMC_ENV_PART=0
#23 0.274 WARNING: TREE-WIDE FIT SECURITY DEBT: FIT signature is absent or disabled; CONFIG_FIT=# CONFIG_FIT is not set CONFIG_FIT_SIGNATURE=<absent>
#23 0.274 WARNING: s905x5m does NOT verify its kernel; its U-Boot chain of trust is incomplete. RFCT-925 owns the mainline FIT signing decision.
#23 0.274 section 5: CONFIG_FIT=y matches=0 observed=# CONFIG_FIT is not set
#23 0.274 section 5: CONFIG_FIT_SIGNATURE=y matches=0 observed=<absent>
#23 0.278 section 5: CONFIG_SYS_BOOTM_LEN matches=1 observed=CONFIG_SYS_BOOTM_LEN=0x4000000 bytes=67108864 expected=0x4000000 derived-for=s905x5m
#23 0.278 section 5: board-owned U-Boot requirements pass; tree-wide FIT security debt remains
#23 0.278 WARNING: artifact export continues with the tree-wide FIT security debt above; do not treat this artifact as kernel-verified
```

The default artifact exporter populated
`/tmp/mos-rfct287-nocache-he9rdD/src/os/boards/s905x5m/bsp/out/uboot/`:

| artifact | bytes | SHA-256 |
|---|---:|---|
| `DDR.USB` | 3,321,856 | `c0809bf8cb74194224ca95abf19f2b04014b4efcabf34770423361a38127afa0` |
| `u-boot.bin.sd.bin.signed` | 3,322,368 | `1b1fee8b44e9cf44f377602f670109c87319fce9c8afdd681b2b2299eb4ff358` |
| `u-boot.bin.signed` | 3,321,856 | `b35e0e0f78ce3754219beb49627621f2a058a7137326cf8e879f8c5c91a5f519` |

## Result

The board-owned section-5 requirements passed and the artifact export ran.
FIT/FIT_SIGNATURE remains a loud tree-wide security debt: this board does not
verify its kernel. `u-boot.bin.signed` is only an input to the target-generated
Amlogic package path; no raw boot0 write, eMMC operation, `bootloader_a` write,
deployment, or remote push was performed.

## Reopened Investigation

- The original default exporter did materialize the three files on
  `192.168.27.200`; they remain under the isolated source snapshots
  `/tmp/mos-rfct287-nocache-he9rdD/` and `/tmp/mos-rfct287-YAJWYy/`. This is not
  a BuildKit-stage-only result.
- Those `/tmp` paths are not the shared checkout and were not a durable
  hand-off location. A subsequent scan of the checkout, `/home/alan`, and
  `/backup` therefore correctly found no s905x5m artifact. The initial task
  closure was premature.
- `/backup` was writable with 407 GiB free. Before the durable build, the
  deterministic output path `/backup/mos-artifacts/rfct-287-ec0c70c/` was
  absent and available.

## Reopened Proposal

From a fresh `git archive ec0c70c` snapshot, rerun the same default artifact
export with `--no-cache` and use BuildKit's local exporter directly at
`/backup/mos-artifacts/rfct-287-ec0c70c/`. Do not copy an earlier temporary
artifact into that directory. Verify the finished files by absolute path,
byte count, SHA-256, and a read-only re-scan of `/backup` before closing this
task again. The user's request to re-run with a durable output path is the
explicit authorization for this reopened implementation phase.

## Durable Export Verification

- A fresh `git archive ec0c70c` source snapshot was rebuilt on
  `192.168.27.200` with `--no-cache`. BuildKit's default artifact stage used
  `type=local,dest=/backup/mos-artifacts/rfct-287-ec0c70c` directly; the
  destination was created empty before the build, and no file was copied from
  an earlier `/tmp` result. The build exited `0` after rerunning the contract.
- The durable destination contains exactly these three files:

| artifact | absolute path | bytes | SHA-256 |
|---|---|---:|---|
| `DDR.USB` | `/backup/mos-artifacts/rfct-287-ec0c70c/DDR.USB` | 3,321,856 | `c0809bf8cb74194224ca95abf19f2b04014b4efcabf34770423361a38127afa0` |
| `u-boot.bin.sd.bin.signed` | `/backup/mos-artifacts/rfct-287-ec0c70c/u-boot.bin.sd.bin.signed` | 3,322,368 | `1e34b438d7c7e6f071d61aff8c818888265fdc35b32d5f68dce12eec5ddb00e0` |
| `u-boot.bin.signed` | `/backup/mos-artifacts/rfct-287-ec0c70c/u-boot.bin.signed` | 3,321,856 | `f963bbc98024a4f8f6e4a84b6c1cde0b1fd0bc30b9a9335fc7902d37f7a60277` |

- A direct `find` and SHA-256 re-read of `/backup/mos-artifacts/` found only
  the three files above. A broad read-only `/backup` search also found the two
  U-Boot binaries, but could not traverse unrelated root-owned verification
  trees; that does not affect the direct, complete destination inventory.
- The signed hashes differ from the earlier `/tmp` run because upstream embeds
  a wall-clock build time before compression and signing. The size and the
  independently verified source and contract evidence remain consistent.

## Durable Result

`/backup/mos-artifacts/rfct-287-ec0c70c/` is the durable hand-off location for
the first on-disk s905x5m U-Boot artifact export. The artifact is not flashable
as a raw boot0 write: `u-boot.bin.signed` remains an input to the target-side
package flow that generates `storage_emmc_boot_info`. No device, eMMC boot
area, `bootloader_a`, or deployment was written.
