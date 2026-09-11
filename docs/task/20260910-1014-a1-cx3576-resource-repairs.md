# 20260910-1014-a1-cx3576-resource-repairs CX3576 accelerator and resource repairs

- **status**: completed
- **priority**: P1
- **owner**: bkd/954v14y1
- **createdAt**: 2026-09-10 10:14

## Description

Classify remaining CX3576 NPU, decoder, encoder and board resource findings against the merged board DT and vendor kernel c6157104418d012823413c02f9222f3fe123dd25. Repair only established software defects with focused executable RED/GREEN evidence. This is a software delivery; exact-image hardware acceptance stays explicitly blocked until a bench is confirmed.

## ActiveForm

Completed the bounded software repair and classification; handing compiled and hardware acceptance to the coordinator.

## Dependencies

- **blocked by**: No confirmed bench for hardware acceptance.
- **blocks**: A3 patch-series integration and A4 coherent compiled artifact gate.

## Notes

- Campaign: mos-open-plans-20260910-100408; issue: 954v14y1; coordinator: 6064wf7l.
- Full-tier implementation and local scoped commits were approved in the user dispatch. No repeated proposal approval is required. No push, merge or BKD done transition is authorized.
- Scope is the assigned CX kernel DTS/config/scripts, new narrow kernel patches/tests and these unique tracking records/index additions. Shared build, U-Boot, display, rootfs and sibling records are excluded.
- Historical `/srv/mos/_out/tio.log` is supplied evidence only, never a current image pass.
- Change-history notes will be reported to L2 for D; the global changelog is outside this node's write scope.

## Software result

- Patch `0005-mpp-rkvenc2-rk3576-fixed-rate-opp.patch` skips the invalid OPP init/teardown pair only for RK3576 core nodes without an OPP property, with an explicit informational diagnostic. Required clocks/resets, other SoCs and malformed declared tables retain their existing handling.
- `build.sh` checks patch 0005's source effect. New kernel tests compile the actual pinned encoder init/remove functions and inspect the compiled board DT. No config/configure change was necessary, so `make os-netavark-kernel-test` is not applicable to this diff.
- Decoder missing shared resets and no regulator are source-backed optional/fixed-rate behavior. No decoder reset or diagnostic was removed.
- NPU DT overlap with the IOMMU is established, but the live owner and a documented sharing contract are not. No EBUSY bypass was added or broadened. Offsets beyond the IOMMU apertures rule out a simple range truncation.
- The related plan records consumer/impact evidence for remaining SCMI, PWM, cache, Bluetooth, MTD, DMA, supply and board resource findings.

## Verification

Evidence directory: `/srv/station/work/tmp/mos/954v14y1/` (task-owned, outside the repository).

| Check | Result | Log / scope |
|---|---|---|
| `timeout 30 python3 boards/cx3576/bsp/kernel/tests/rkvenc-devfreq-test.py /srv/station/work/tmp/mos/954v14y1/vendor` | RED, exit 1 | `red-reviewed.log`: three fixed-rate init/teardown assertions fail against the unmodified pinned source. |
| Same command with `patched` source | GREEN, exit 0 | `green-reviewed.log`: fixed-rate, invalid OPP, defer, registration/removal, optional monitor and other-SoC paths. |
| GNU `patch -p1 --no-backup-if-mismatch` for patch 0005 | PASS, exit 0 | `patch-reviewed.log`: no offsets/fuzz/rejects; exact match to the independently patched source. |
| cpp + dtc over maintained board DTS and pinned includes | PASS with existing warnings | `dtc.log`: 46 inherited warning lines, kept visible. Scratch DTB only, not a signed artifact. |
| `python3 .../resource-dt-test.py .../board.dtb` in existing DT tools image | PASS, exit 0 | `dt-contract.log`: encoder/decoder clocks/resets; NPU overlap prints OPEN. |
| `bash -n boards/cx3576/bsp/kernel/build.sh` | PASS | No other script changed. |
| `make docs-verify` | PASS, exit 0 | `docs.log`: all five repository documentation checks. |
| Local pma-cr review, shared policy and Python pack | PASS, zero findings | Actual patch, build assertion, fixtures, DT contract and owned tracking diffs reviewed. Full kernel object compilation is deferred, not claimed. |

The initial fixture attempt had a C stub type mismatch (compiler failure, `red.log`); it was corrected before the meaningful behavioral RED. `red-final.log` and `red-reviewed.log` establish the defect independently of that harness error. `of_property_present` is available in the exact pinned `include/linux/of.h`; it distinguishes absence from a present malformed OPP property.

## Outstanding acceptance

| Row | Status | Required owner/evidence |
|---|---|---|
| Coherent full kernel/object/DT compilation after A3 | Deferred | A4; exact source commit, config, object/function evidence and newly built DTB. |
| NPU resource ownership | Blocked | Confirmed bench, exact-image `/proc/iomem`, device bindings and access ownership contract. |
| NPU repeated checked inference | Blocked | Confirmed bench and known model/output; probe success is insufficient. |
| Encoder core 0 and core 1 workload/reset | Blocked | Confirmed bench, checked encoded output, actual clocks and reset recovery per core. |
| Decoder workload/reset | Blocked | Confirmed bench, checked decoded output, clocks and reset timeout/recovery. |
| Accelerator thermal behavior | Blocked | Confirmed bench under sustained workloads. |
| Startup | Blocked | Current flashed-image identity and boot/health trace. |
| Reboot | Blocked | Current board runtime trace; previous x64 evidence is separate. |
| Watchdog handoff | Blocked | Current U-Boot/Linux/systemd handoff evidence. |
| Watchdog expiry | Blocked | Physical reset and reset-cause evidence. |
| Real recovery | Blocked | Identified device and observed recovery path. |
| HDMI and VT return/hotplug | Blocked | A3 plus current-image physical display evidence. |
| Physical power cuts | Blocked | Identified bench and storage power-cut rig/operator evidence. |

## Delivery notes for L2 and D

- Only this task/plan pair and their appended index rows are owned by A1. Do not infer completion of old records or hardware from this software result.
- Suggested change-history note: RK3576 encoders now honor their existing fixed-rate DT contract without attempting missing OPP tables; source-extracted lifecycle regressions and compiled-DT resource fixtures cover the bounded repair. NPU ownership and physical qualification remain open.
- A3 follows patch 0005; A4 receives the compiled-object/function/workload obligations in the plan. No shared/#313, U-Boot, display, lifecycle or packaging path was edited.
- All task containers used exact task names and `--rm`; no server, tmux service, volume or network was created. Scratch source and logs are retained for A4/L2 evidence. No shared cleanup sweep, push, merge or BKD done transition was performed.

- complete: Bounded software repair and source-backed classification complete; all hardware rows remain explicitly blocked and coherent full compilation belongs to A4.
