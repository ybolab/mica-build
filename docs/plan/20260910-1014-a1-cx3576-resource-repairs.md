# 20260910-1014-a1-cx3576-resource-repairs CX3576 accelerator and resource repairs

- **status**: completed
- **createdAt**: 2026-09-10 10:14
- **approvedAt**: 2026-09-10 10:14
- **relatedTask**: 20260910-1014-a1-cx3576-resource-repairs

## Context

The approved A1 dispatch identifies historical decoder shared reset/regulator warnings, encoder OPP/devfreq failures and two NPU MMIO claim failures. The branch starts at 5c61f7fbb5589807e931e981b3ef8cb9bdff8b6d. Source evidence and ownership must be established before editing; completed display/regdb/storage repairs are not reopened.

## Proposal

1. Add patch 0005 to skip encoder OPP initialization and teardown only for `rockchip,rkv-encoder-rk3576-core` without an `operating-points-v2` property. Keep an informational fixed-rate diagnostic. A present but invalid property still reaches the existing error path.
2. Compile the actual pinned encoder init/remove functions in a controlled host fixture. Assert the compiled board DT clock/reset contracts and preserve NPU overlap as an explicit open result.
3. Add the existing build script's source-effect assertion for patch 0005. Leave the DTS, config, decoder and NPU drivers unchanged. A4 runs the full coherent build after A3.

## Risks

Skipping DVFS without preserving required clocks or resets can break workloads. Ignoring MMIO reservation conflicts can permit unsafe ownership. Historical logs do not prove current runtime state. Unknown wiring must remain enabled and visible until evidence establishes a defect.

## Scope

Only `boards/cx3576/bsp/kernel/dts/rk3576-cx3576z.dts`, kernel config/configure/build scripts, new narrowly named kernel patches plus series, new kernel resource tests, and this task/plan pair with their own index entries. No vendor pin change or expensive full kernel/root/QEMU build.

## Alternatives

Do not invent OPP voltages or suppress diagnostics globally. Expected optional/fixed-rate behavior, firmware limitations and bench-blocked ambiguities will be documented rather than patched without evidence.

## Annotations

- Approval source: the user-approved full-tier campaign and bounded A1 dispatch, campaignId=mos-open-plans-20260910-100408.
- Fresh newest-image development only; no compatibility or migration work.
- D owns final tracking reconciliation and global history.

## Source-backed disposition

All vendor paths below refer to [armbian/linux-rockchip at c6157104418d012823413c02f9222f3fe123dd25](https://github.com/armbian/linux-rockchip/tree/c6157104418d012823413c02f9222f3fe123dd25).
Only the required source/include closure was retrieved into the task's scratch directory. No vendor pin or source in another worktree was changed.

| Finding | Classification | Consumer and impact evidence | Disposition |
|---|---|---|---|
| Both encoder cores report OPP initialization failures (historical lines 762-771) | Established software defect | `mpp_rkvenc2.c:rkvenc_devfreq_init` unconditionally calls `rockchip_init_opp_table`; `rockchip_opp_select.c:rockchip_init_opp_info` returns `-ENOENT` without a phandle. Both merged RK3576 nodes intentionally have no OPP/supply, but specify normal and assigned ACLK/core rates 400/702 MHz. | Patch 0005 avoids the invalid init/teardown pair only for this configuration. Invalid declared tables, deferred providers and other SoCs retain errors. |
| Decoder missing `shared_niu_a`, `shared_niu_h`, `shared_video_cabac` (745-750) | Expected per-SoC optional-resource behavior | `mpp_common.c:mpp_reset_control_get` tries the exclusive name then `shared_`. RK3576 declares only A/H/core/HEVC CABAC resets. Its selected `rkvdec_rk3576_hw_ops.reset` is `rkvdec_vdpu383_reset`, which resets core/MMU through the link registers; it does not consume those three missing reset handles. | Retain diagnostics and all four declared resets; no invented shared reset names and no removal of recovery paths. |
| Decoder no regulator (751) | Expected fixed-rate behavior | `rkvdec2_devfreq_init` reports no optional `vdec` supply and returns success. `rkvdec2_clk_on` enables five clocks; `rkvdec2_set_freq` programs ACLK/CABAC/HEVC CABAC and `mpp_devfreq_set_core_rate` always sets the core clock even without a devfreq object. Normal rates are 600/0/600/500/1000 MHz, with zero meaning no HCLK rate override. | Keep existing handling and diagnostic. Runtime applied frequencies and decode/reset success are bench-blocked. |
| NPU two MMIO claim failures (887-888) | Bench-blocked ownership ambiguity; DT overlap is established | NPU ranges `[0x27700000,0x27708000)` and `[0x27708000,0x27710000)` each contain two IOMMU ranges: 0x27702000/0x27702100 and 0x2770a000/0x2770a100, each 0x100 bytes. Both nodes are enabled and the NPU references that IOMMU. `rockchip-iommu.c:rk_iommu_probe` reserves these ranges using `devm_ioremap_resource`. `rknpu_drv.c:rknpu_probe` tries exclusive mapping and then maps without reservation on EBUSY. This is a plausible source-level explanation, not observed `/proc/iomem` ownership. | No NPU change. Neither exclusive ownership nor documented legitimate sharing has been established. Capture exact-image iomem, bindings and register access ownership before redesigning reservation. |
| NPU temptation to shorten each range to 0x2000 | Unsafe unproven repair | RK3576 uses counters at offsets 0x2210-0x243c (`rknpu_drv.c` amount tables), and multicore submission writes offset 0x3004 (`rknpu_job.c:rknpu_job_subcore_commit_pc`). These are beyond the IOMMU apertures. | Reject simple truncation. Do not broaden EBUSY bypass or remove the IOMMU. |
| SCMI protocol 22/reset and 17/power inactive | Firmware limitation / unused optional protocols | `arm_scmi/driver.c:scmi_protocol_device_request` reports a requested protocol missing from active protocols. Merged firmware DT exposes only protocol 0x14 clocks. CPU, NPU, DDR and HDCP have SCMI clock consumers; accelerator resets use CRU and power domains use the Rockchip power controller. | Preserve SMC SCMI and clock consumers. Do not disable system-wide firmware services to hide unused protocol requests. |
| PWM IRQ index 1 missing and ATF wakeup unsupported | Expected optional IRQ fallback; firmware limitation for wakeup | `rockchip_pwm_remotectl.c` tries IRQ 1 then IRQ 0. After normal receiver setup, wakeup tries the controller and then SIP; unsupported SIP wakeup is informational and does not fail probe. | Keep receiver and error reporting. Physical IR/wakeup capability requires bench evidence. |
| CPU cache hierarchy warnings | Bench-blocked topology repair | `drivers/base/cacheinfo.c:cache_setup_of_node` needs next-level cache nodes for leaves above L1. The pinned RK3576 CPU DT has no cache nodes/next-level references. Cache reporting cannot populate all leaves. | Missing firmware description is established, but shared topology/geometry has not been independently established. Do not fabricate cache sizes or sharing; collect architectural cache registers and vendor topology evidence. |
| Bluetooth `ext_clock` lookup failure | Bench-blocked wiring ambiguity | `net/rfkill/rfkill-bt.c:bluetooth_platdata_parse_dt` attempts `ext_clock`, logs failure, and continues. Current Bluetooth node has no clock property. The RTC clock is wired only into the SDIO power-sequence node by this board's DTS. | Do not assume the Bluetooth clock uses the same board trace. Keep node and diagnostic; verify module clock wiring and HCI operation. |
| `mtd_vendor_storage` deferred probe | Bench-blocked backend/consumer ambiguity | `drivers/soc/rockchip/mtd_vendor_storage.c:vendor_storage_probe` returns `-EPROBE_DEFER` until the named MTD device exists, then registers the vendor read/write backend. Config enables both MMC and MTD backends; the log's successful MMC backend does not prove every MTD consumer is absent. | Keep config. Requires board storage/backend and vendor-data consumer inventory before removal; no old-package compatibility work. |
| UART4 DMA fallback | Expected fallback with bench-blocked cause/performance | `8250_port.c` reports failed DMA allocation and continues in interrupt mode. UART4 is the enabled Bluetooth HCI transport. | Preserve interrupt fallback. Determine channel/provider failure and HCI throughput on the bench; no removal of DMA declarations without evidence. |
| PHY and AT24 dummy supplies | Bench-blocked board wiring ambiguity | `dwmac-rk.c` requests `phy`; `at24.c` requests `vcc`. The board inherits supplies and fixed rails, but absent consumer properties do not establish which physical rail powers each device. | Do not guess regulator phandles. Ethernet/EEPROM operation and power sequencing remain physical checks. |
| GMAC wake/LPI IRQ messages | Expected optional-resource behavior | `stmmac_platform.c` uses optional IRQ lookups; missing wake IRQ falls back to MAC IRQ and LPI remains optional. | No change; required MAC IRQ errors remain visible. |
| PMIC sleep/reset/DVS pin states, optional USB/FIQ resources, duplicate regulator debugfs entries, RTC correction | Bench-blocked resource/firmware ambiguities | `rk806-core.c` looks up named pinctrl states; this does not prove a board pad assignment. USB/FIQ wiring and duplicate regulator consumer lifetime require their own runtime binding evidence. Historical RTC/journal time shifts do not identify the clock corrector. | Keep nodes and diagnostics. No claim of repair or qualification; exact-image binding, suspend/wake, USB/console and clock evidence are required. |
| Camera/OP-TEE/GPU naming/Mali400/autofs/logo/regdb findings | Previously repaired or owned elsewhere | Current board DTS/config and completed 3579a2cd tracking are the source baseline. No current regression is established by replaying the older serial log. | Not reopened. Display A3, lifecycle/packaging B, shared build/#313 and final reconciliation D remain outside A1. |

## Verification and handoff

- Historical log: 95,919 bytes, SHA256 `f614fb0c15e5263a2f3262b65cefcd3d6305d2544dcacc0b684c452e73adab8f`; it is not an exact-image pass.
- Original encoder source SHA256: `90219d477c71a29c7b329c5a90e42f3bb3d8d122842cb4c8df0c300472d3678f`; patched: `4ca030244b13f6355c802ecc7f941142565650cac85be93a7a74d8c3d5c9fe8f`.
- `rkvenc-devfreq-test.py` compiles the actual init/remove bodies with GCC, using controlled external OPP/monitor services. RED: three fixed-rate init/teardown assertions fail. GREEN: fixed-rate, declared invalid table, provider defer, successful registration/removal, monitor fallback and other-SoC paths pass. It does not compile the full kernel translation unit or execute hardware registers.
- The maintained board DTS plus its pinned include closure compiles with cpp and dtc. `resource-dt-test.py` reads the compiled blob using fdtget. Both encoder and decoder clock/reset assertions pass, and it explicitly prints the open NPU overlap. Dtc emits 46 inherited warning lines; no warnings were suppressed or represented as resolved.
- GNU patch 2.7.6 applies patch 0005 without offsets/fuzz/rejects; the result is byte-identical to git apply. Build script syntax and documentation gates are required before delivery.
- A4 must apply the coherent full series after A3, compile `drivers/video/rockchip/mpp/mpp_rkvenc2.o` and the complete kernel with the resolved config, rerun the function fixture against that patched source, inspect built object/function/string evidence, and run the DT fixture against its newly built `rk3576-cx3576z.dtb`. The build script's new source-effect grep alone is not compiled-function proof.
- Hardware rows remain separately blocked: NPU iomem/bindings and checked repeated inference; each encoder core's encode workload and reset recovery; decoder representative decode, applied clocks and reset recovery; thermal behavior; startup; reboot; watchdog handoff; watchdog expiry; real recovery; connected/late HDMI and VT return; physical power cuts. No confirmed bench endpoint or flashed image is supplied.
- Software-only completion of this record does not close any hardware row, historical task, sibling task or campaign acceptance gate.
