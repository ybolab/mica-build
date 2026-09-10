# 20260910-1014-a2-cx3576-acceptance-matrix Current CX3576 acceptance matrix and evidence baseline

- **status**: completed
- **priority**: P1
- **owner**: bkd/hgla3lpl
- **createdAt**: 2026-09-10 10:14

## Description

Create the current signed-file-system CX3576 board acceptance matrix and a
bounded operator procedure from existing source and evidence. Keep historical,
static, compiled, simulated, and same-image hardware evidence distinct, and
leave unobserved hardware obligations explicitly blocked.

## ActiveForm

Completed the current CX3576 matrix and bounded bench procedure with every
same-image hardware obligation explicitly blocked on its missing evidence.

## Dependencies

- **blocked by**: (none for this documentation deliverable; hardware rows remain blocked by `HW-0`)
- **blocks**: final campaign evidence reconciliation by workstream D

## Current Acceptance Matrix

This matrix is the live result record for the campaign. The reusable procedure
is [cx3576-bench.md](../bsp/cx3576-bench.md); the thirteen dossier rows remain
`not tested` in [cx3576-example.md](../bsp/cx3576-example.md). A software result
below never means that the corresponding physical row passed.

### Evidence identity baseline

| ID | Evidence | Classification and current use |
|---|---|---|
| `SRC-0` | Source commit `5c61f7fbb5589807e931e981b3ef8cb9bdff8b6d` | Clean campaign baseline. No complete CX3576 image bound to this exact source is on file. |
| `IMG-OLD` | `/srv/mos/_out/cx3576-storage-display-20260910/image/mos-cx3576-20260910-072131.img.gz`, 110,037,991 stored bytes and 1,362,100,224 logical image bytes; compressed SHA-256 `7ab37c59ac121e62850214b0f908cd66b3e2f8f440aa4379a8c53f7cb8cf0b1f`; decompressed image SHA-256 `0f2a2358eb360222e3ee7c6722a3b178657fbf47553bbff5763e8a31d1c0dd1a` | Archived candidate. Streaming decompression reproduces the recorded image digest, but package evidence says `gitd64b23a7d92a.dirty-1`; it predates the final unlimited-quota correction, is not relabelled as `SRC-0`, and is not the newest-source flash candidate. |
| `IMG-OLD-META` | `/srv/mos/_out/cx3576-storage-display-20260910/image/SHA256SUMS` SHA-256 `19677835b0da3f35d915da259be024317239f85083778a9f287654e821bfb214`; `/srv/mos/.tmp/cx-storage-display/final-source-hashes.json` SHA-256 `40c0da9f37a5d32e7a84a34a2f6e2454b3f20877cf4dc46224180c7008fddf21` | Read-only metadata for `IMG-OLD`; the snapshot does not turn its dirty build stamp into a clean source revision. |
| `IMG-OLD-COMP` | Kernel/support `66fa494b7abe76f491f76736b004ba84fa7aebb279446f5f8c63656ebc3c55c7`; root `4d8f0bb540d4e4f7a32c362c198e84c2303e3a83268ee3d0deada5eac469c776`; kernel Image SHA-256 `5e27430dad27ed0c13e14695071a8202eec2add3ac6982bdff0973ee15586267` | Component identities recorded by the completed storage/display task. They are useful comparison inputs, not current board observations. |
| `SW-FILE` | [File-deployment delivery](20260908-2229-file-ab-delivery-x64-first.md), `tests/file-ab-fit/`, and `tests/signed-boot-lab/` | Existing host, sandbox and x64/virt-arm64 QEMU evidence for signatures, transactions, trials, fallback, shutdown and recovery. Reused without rerunning; it does not prove CX3576 media or hardware behavior. |
| `SW-CX` | [Storage/display delivery](20260910-0616-cx3576-storage-display-cleanup.md) and `IMG-OLD`'s 125 zero-skip offline checks | Static, compiled-artifact and QEMU evidence for 1 GiB SYSTEM, DATA layout, signed FIT, writable `/var`, private mounts, reset isolation and tty2 policy. It is not same-image board evidence. |
| `SW-QUOTA` | [Unlimited application-data delivery](20260910-0726-unlimited-application-data.md) | Current-source layout tests and a focused real-ext4 fixture prove zero byte/inode limits for projects 100/102 and bounded project 101. No complete CX3576 image was rebuilt, so `IMG-OLD` does not contain this correction. |
| `HIST-0` | `/srv/mos/_out/tio.log`, 95,919 bytes, SHA-256 `f614fb0c15e5263a2f3262b65cefcd3d6305d2544dcacc0b684c452e73adab8f` | Supplied 2026-09-08 historical startup context only. It predates the current source and acceptance image, contains no complete current-image run, and neither qualifies a row nor proves a current regression. |
| `HW-0` | No confirmed board endpoint, flashed-image identity, storage-device identity, power rig or current run directory | The common blocker for every same-image hardware row. No endpoint or disk name is inferred. |

The acceptance vocabulary is deliberately strict: `software-backed / blocked`
means that relevant non-hardware gates exist but the physical obligation is
unobserved; `blocked` means no admissible current result exists; and `known
software gap / blocked` means source documentation already identifies an unmet
behavior and hardware evidence is also absent.

### Identity, startup, power, watchdog and recovery

| ID | Current obligation | Existing evidence | Current result | Exact evidence still required |
|---|---|---|---|---|
| I1 | Bind one newest complete image to a clean source commit, signed release/component identities, exact SHA-256, profile, board revision, eMMC part and readback | `SRC-0`, `IMG-OLD`, `IMG-OLD-META`, `IMG-OLD-COMP` | blocked | L2/A1 must hand off one complete image and public verification inputs bound to its clean source. The operator must identify the authorized RockUSB unit and actual target medium, verify the image, flash with explicit `MOS_IMAGE`, compare full readback, then record the device release/boot receipts. |
| B1 | Install onto a blank/erased development unit and reach a claimable first boot | Flash control flow and image geometry are software-tested in `SW-CX` | software-backed / blocked | After I1, retain the host flash/readback transcript and uninterrupted serial from reset through authenticated root/support, DATA growth, provisioning and required-health confirmation. Run separately for every claimed image profile. |
| B2 | Repeat cold boot and remain healthy for at least 180 seconds | `HIST-0` shows an older startup only | blocked | Five cold cycles on the I1 image; for each, capture required-health members, deployment confirmation, boot ID, failed optional units and an end-of-window snapshot at or after 180 seconds. |
| B3 | Authenticated reboot reaches a new healthy boot and completes exitrd teardown | x64 dispatch/reboot acceptance is recorded in [the reboot task](20260909-1421-apid-reboot.md) | software-backed / blocked | From the confirmed I1 deployment, issue the authenticated board reboot, record admission, serial teardown, new boot ID, retained identities and the 180-second health snapshot; repeat three times. |
| B4 | Authenticated power-off completes teardown; a later physical power-on returns healthy | QEMU shutdown evidence exists in `SW-FILE` | software-backed / blocked | Record authenticated power-off admission and complete serial teardown to loss of power, then independently reapply bench power and capture the new 180-second healthy boot. This is separate from a power cut. |
| W1 | Mandatory watchdog remains active across U-Boot-to-Linux-to-systemd ownership handoff | Static watchdog policy and host/sandbox paths exist; `HIST-0` is old | software-backed / blocked | Capture one continuous I1 serial trace with U-Boot arming, Linux driver takeover, PID 1 ownership and configured timeouts. A4 must supply a supported early-handoff hang point; the current collector has none. |
| W2 | Actual watchdog expiry resets a hung board, persists a spent attempt and exposes the reset cause | QEMU fault paths and FIT persistence tests exist in `SW-FILE` | software-backed / blocked | On the local bench only, trigger the documented post-PID-1 kernel hang, retain external timing/power/serial evidence, then read the reset cause and native records after restart. A reset without a readable cause does not pass. |
| R1 | Authenticated diagnostics, guarded rollback, configuration reset and application-data reset preserve their declared survivors | Reset interruption/retry and QEMU evidence exist in `SW-CX` | software-backed / blocked | Exercise each authenticated operation separately on I1, recording before/after deployment, identity and namespace digests. Credential recovery and full-factory reset must refuse because `BOARD_RECOVERY_ACTIONS` is empty. |
| R2 | Invalid/exhausted records enter real RockUSB recovery; maskrom and complete reflash restore the board without unsigned boot or counter refill | Firmware record refusal is software-tested | software-backed / blocked | Deliberately reach each documented failure state, observe the firmware transport, and restore with the exact I1 complete image. No rescue-SD claim is current. |

### Signed-file deployment and physical durability

| ID | Current obligation | Existing evidence | Current result | Exact evidence still required |
|---|---|---|---|---|
| U1 | Root-only update reuses kernel/support, publishes a signed root and confirms it | Full x64/virt-arm64 sequence in `SW-FILE` | software-backed / blocked | On I1, record authenticated catalog/archive, object hashes, before/after deployment/component IDs, reboot and health confirmation. |
| U2 | Kernel/support-only update reuses root and confirms it | Full x64/virt-arm64 sequence in `SW-FILE` | software-backed / blocked | Same as U1 with unchanged root bytes and identity proven. |
| U3 | Combined update publishes both component files and confirms them | Full x64/virt-arm64 sequence in `SW-FILE` | software-backed / blocked | Same as U1 with both new authenticated component identities proven. |
| U4 | A required-health failure spends exactly three persisted trials and selects the retained confirmed deployment without refill | QEMU and FIT record cases in `SW-FILE` | software-backed / blocked | Install one higher-generation signed candidate that breaks a required member, retain all three boot traces and record copies, then prove the named fallback is selected and the failed ID remains suppressed. |
| U5 | Online or offline acquisition stages only on DATA and publishes no boot-visible partial candidate | Acquisition/archive and transaction matrices in `SW-FILE` | software-backed / blocked | Exercise the chosen current delivery path on I1, recording `/mos/updates/{staging,downloads,verified}`, authenticated lengths/hashes and native state before activation. |
| U6 | Firmware maintenance is separately signed, preserves native records and verifies exact readback | Host-side firmware policy and I/O tests in `SW-FILE` | software-backed / blocked | Use the approved current firmware package on the identified bench unit, record signed receipt and complete readback, and prove both valid native record copies remain. Normal OS update must not write firmware. |
| P1 | Power cut during download or offline import | Syscall/process fault injection only | software-backed / blocked | At least ten externally timed cuts with boundary evidence; after each, prove no incomplete candidate is boot-visible and the prior deployment boots. |
| P2 | Power cut during destination object write and file sync | Syscall/process fault injection only | software-backed / blocked | At least ten identified cuts; prove current/fallback descriptors and all referenced component files remain complete. |
| P3 | Power cut during object/descriptor directory publication | Syscall/process fault injection only | software-backed / blocked | At least ten identified cuts on each publication boundary; every visible object must match its authenticated length and digest. |
| P4 | Power cut during candidate activation | FIT record write/flush/readback logic is software-tested | software-backed / blocked | At least ten identified cuts; the board must select either the previous committed state or the fully durable candidate, never a partial record. |
| P5 | Power cut during trial-attempt decrement | FIT persistence refusal is software-tested | software-backed / blocked | At least fifty randomized redundant-record interruptions; an unpersisted decrement must refuse launch and a spent credit must remain spent. |
| P6 | Power cut during health confirmation | Confirmation fault injection exists in `SW-FILE` | software-backed / blocked | At least ten identified cuts; reconciliation must preserve the authenticated running deployment and retained fallback without refilling trials. |
| P7 | Power cut during garbage collection or redundant-record repair | GC and firmware-I/O fault matrices exist in `SW-FILE` | software-backed / blocked | At least ten identified GC cuts plus the P5 record series; every retained descriptor/object and at least one valid record copy must survive. |

### Storage, presentation, accelerators and board I/O

| ID | Current obligation | Existing evidence | Current result | Exact evidence still required |
|---|---|---|---|---|
| S1 | FIRMWARE remains fixed, SYSTEM is exactly 1 GiB, DATA alone grows, and primary/backup GPT agree | `boards/cx3576/board.env`; offline/QEMU checks in `SW-CX` | software-backed / blocked | Before/after block geometry and byte comparisons from I1, including next-boot GPT scan and the actual eMMC identity/health surface. |
| S2 | Whole `/var` is writable and bounded; `/mos`, `/srv` and `/mos/containers` have zero byte/inode quotas; container bind/storage/tmp remain private and reset-isolated | Mount/reset evidence in `SW-CX`; current quota policy in `SW-QUOTA` | software-backed / blocked | On I1, record mount propagation and project IDs/limits, representative writes across `/var`, zero limits for the three unbounded namespaces, bounded `/var` exhaustion with state/meta still writable, and reset isolation. The current collector's storage prompt is stale and must not determine this row. |
| D1 | HDMI-connected boot shows one centered YBO - Hub OS logo with the approved gradient and no normal login prompt | Palette/image and cmdline checks in `SW-CX` | software-backed / blocked | Photograph/capture the named sink and connector from power-on, record EDID/mode/connector/fb0 state, and observe the screen through the 180-second window. |
| D2 | Alt+F2 and Ctrl+Alt+F2 select tty2, which presents ordinary authenticated getty with no autologin | QEMU keyboard selection reached the tty2 login prompt but did not submit a password | software-backed / blocked | On a connected HDMI/USB-keyboard bench, use both shortcuts, authenticate with a test credential, log out, and prove tty1 has no getty and tty2 has no autologin. |
| D3 | Returning from tty2 restores the centered product presentation | [Display design](../design/display.md) records that no redraw owner exists | known software gap / blocked | Do not manufacture a pass. Record current I1 behavior after logout/VT return; implementation belongs to the existing display follow-up before acceptance can pass. |
| D4 | HDMI attached after a headless boot receives the product presentation without reboot | [Late-HDMI task](20260910-0117-cx3576-late-hdmi-logo.md) records the init-only artwork lifetime gap | known software gap / blocked | Boot I1 without a sink, record absent/present connector and fb0 transitions, attach the named sink, and retain the visual/runtime result. A software owner must resolve any confirmed redraw gap. |
| D5 | A panic is visible on an already connected HDMI sink while serial remains authoritative | Static display/panic policy only | software-backed / blocked | With a sink connected before the fault, trigger the approved crash as part of the watchdog run and record both the screen and serial trace. |
| A1 | NPU completes a representative inference with checked output and stable resources | Compiled node/resources and old probe messages exist; no workload pass | blocked | A4/operator must name a versioned model, runner, input and expected output digest. Run repeated inference on I1 while recording driver binding, IOMMU/MMIO ownership, clocks, power and errors. |
| A2 | Hardware encoder completes a representative encode and exposes required clocks/resets/resources | Compiled resources exist; no functional encode evidence | blocked | A4/operator must name a versioned input, codec/settings and expected output checks. Record hardware-device use, output validity, resource state and repeated operation. |
| A3 | Hardware decoder completes a representative decode and exposes required clocks/resets/resources | Compiled resources exist; no functional decode evidence | blocked | A4/operator must name a versioned bitstream and expected frame/output checks. Record hardware-device use, output validity, resource state and repeated operation. |
| N1 | Both Ethernet ports retain per-topology MAC identities and independently obtain DHCP, DNS and application traffic | Source/host MAC derivation checks; no current board traffic | software-backed / blocked | Record physical-port mapping, topology path, derived MAC, lease, DNS and link-bound transfer for each port across at least three I1 boots. |
| N2 | AIC8800D80 Wi-Fi loads shipped firmware/regdb, associates, obtains addressing and carries DNS/application traffic | Board declaration and packaged regdb checks in `SW-CX` | software-backed / blocked | On the named AIC8800D80 SKU and controlled AP, record global and phy regulatory state, association, DHCP, DNS and link-bound transfer. An early pre-root regdb miss is not by itself a failure; post-service state decides it. |
| N3 | Bluetooth initializes and completes a controlled peer/profile exchange | Board declaration only | blocked | Name the peer and profile, then retain controller identity, pairing/connection and bidirectional operation. Controller enumeration alone does not pass. |
| F1 | USB host, OTG CDC-ACM gadget and local `can0` exchange work under shipped hwinit | Host gadget/config tests only | software-backed / blocked | On the isolated bench interfaces, enumerate a host device and gadget login, then send and receive CAN frames with the declared bitrate and retain counters/errors. |
| F2 | RTC identity and power-loss time behavior are measured | Static AT8563 node/config evidence only | software-backed / blocked | Identify `rtc0`, remove power for ten minutes with network absent, and record either retained time or monotonic saved-floor recovery as specified by qualification row 8. |
| F3 | Sustained load stays inside the board/enclosure thermal envelope and throttles without crash | Static thermal policy only | blocked | Record enclosure/airflow, zones/trips/frequencies, thirty minutes of representative sustained load and five-minute cooldown on I1. |
| F4 | Local management and provisioning remain usable with external network absent | x64 offline QEMU evidence in `SW-FILE` | software-backed / blocked | Start I1 with network physically absent, use the confirmed local management path, and record provisioning, configuration and shutdown without relying on network time or a guessed API endpoint. |

No row is hardware-complete. The acceptance series must stop before destructive
actions until I1 is satisfied and the operator has explicitly identified the
bench device, its system medium, console, API route and power control.

### Collector gaps reported for A4 or a scoped follow-up

The current `cx3576-bench-collect.sh` remains unchanged by this task. Its output
can supplement a future run only after these gaps are addressed or manually
overridden in an auditable wrapper:

1. `API_BASE=https://127.0.0.1` is a default, not a confirmed bench endpoint.
2. Binding, growth, health and MAC probes hard-code `/sys/block/mmcblk0`; the
   actual system medium must be identified before collection.
3. `health_verdict` requires zero failed units, while current policy evaluates
   the named required set and reports optional failures separately.
4. `firstboot` has no explicit 180-second stable-health observation.
5. `storagefill` expects quota refusal in `/mos` and `/srv` plus an unlisted
   `/var` write refusal, both contrary to S2, and omits the independent
   container namespace and mount/reset-isolation checks.
6. `watchdog` covers a post-PID-1 kernel crash only. It has no supported
   U-Boot/Linux handoff hang or early-expiry injection.
7. It does not collect current HDMI/tty2, NPU, encoder, decoder or Bluetooth
   peer results, and its report contains only the legacy thirteen dossier rows.
8. `install` records an operator note but does not itself bind the image to a
   clean source/release handoff or discover the authorized RockUSB target.
9. `recovery` still asks for a rescue SD, which the current recovery contract
   does not claim.

The charter named `docs/design/boot.md`, `docs/design/update.md`,
`boards/cx3576/layout/` and `tests/file-transaction-faults/`, but those paths do
not exist at `SRC-0`. The current equivalents used here are
`docs/design/uboot-ab-handshake.md`, `docs/design/updates.md`,
`boards/cx3576/board.env`, `tests/file-ab-fit/` and `tests/file-ab-faults/`.

## Deferred S905X5M Obligation Inventory

This is an inventory only. It does not reuse S905X5M results as CX3576 evidence,
qualify a current S905X5M image, or authorize work in #313's paths. No S905X5M
implementation or run may start until L1 supplies an exact, L2-routed commit
handoff from #313.

| Current concept to retain | Historical source | Current disposition |
|---|---|---|
| Bind board revision, boot medium/source, signed image, component IDs and readback before mutation | `PLAN-910`, `RFCT-944` | Retain the identity discipline. Discard historical SD/eMMC partition numbers, clones and boot-mode assumptions. |
| Persisted bounded trials, watchdog ownership/expiry, fallback and recovery need separate physical observations | `PLAN-910`, `RFCT-934` | Re-express against signed file deployments and native records only. Old RAUC/raw-slot mechanics and results are inadmissible. |
| Boot time, timekeeping, local authentication, network and container behavior need actual board runtime evidence | `PLAN-911` | Retain as board-functional rows bound to a current exact image; do not carry old package or host-layout results. |
| Bluetooth requires a controlled peer/profile exchange, not controller enumeration | `PLAN-912` | Retain unchanged as an evidence principle; rerun with current firmware and image. |
| Boot memory/capacity limits derive per board from final signed payloads | `PLAN-915` | Retain the measurement obligation; do not reuse S905X5M limits or CX3576 values. |
| A reference MQTT/application package needs signed provenance plus functional publish/subscribe evidence | `PLAN-916`, `RFCT-932` | If still a current product obligation, test the current application artifact and policy. Do not revive old package, slot or card-building flows. |
| Managed Wi-Fi needs association, addressing, DNS and link-bound application traffic as distinct observations | `RFCT-945` | Retain the split evidence. Successful DNS/HTTPS cannot waive a missing gateway/link-path result. |
| Recovery and acceptance stop when the actual boot medium or fallback identity is ambiguous | `RFCT-944` | Retain the stop condition. Wait for the exact #313 source/artifact handoff and identify the bench device before any write or reboot. |

Historical S905X5M hardware results remain historical even when their concept is
still useful. They cannot establish current signed-file behavior, and no old
raw slot, RAUC package, update package or migration support is accepted.

## Validation and Change-History Notes

- Documentation-only scope: executable RED/GREEN testing is not applicable;
  no test framework, build, QEMU or device operation was introduced.
- Evidence metadata was checked read-only with `stat`, `sha256sum` and streamed
  gzip decompression; the values are recorded under Evidence identity baseline.
- `make docs-verify` passes: index 195/195, relative links 510/510,
  truth-status 720/720, Chinese coverage 249/249 and board dossier 118/118.
- The bounded coverage check finds 39 unique matrix rows and all 23 requested
  acceptance concepts. `git diff --check` and the unchanged collector's
  `bash -n` check pass.
- Documentation-focused `pma-cr` review found no actionable issue. No stack
  review pack applies because no Rust, Bun or frontend source changed.
- Executable RED/GREEN: not applicable to this documentation-only task. No
  source, collector, build, QEMU or device test was run.
- Reconciliation note for workstream D: the live matrix adds no physical pass;
  I1 and all same-image rows remain blocked, with known D3/D4 redraw gaps and
  the collector gaps above. No global changelog or sibling status was edited.

## Notes

- Full-tier approval source: the bounded campaign charter
  `mos-open-plans-20260910-100408` supplied by the user on 2026-09-10.
- Development-only scope: newest full image, signed file-based A/B components,
  no backward-compatibility, migrations, raw-slot, RAUC, or old-package support.
- Historical `/srv/mos/_out/tio.log` is read-only context and cannot qualify a
  current exact-image hardware row.

- complete: Completed the evidence-classified CX3576 acceptance matrix and current signed-file bench procedure; all same-image hardware rows remain explicitly blocked.
