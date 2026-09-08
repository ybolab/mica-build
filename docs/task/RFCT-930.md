# RFCT-930 Write the s905x5m production RAUC A/B boot script

- **status**: completed — dm-verity and HDMI handoffs observed on hardware
- **priority**: P1
- **owner**: plan-910-s905x5m-bootcmd
- **createdAt**: 2026-08-31 13:53 UTC
- **completedAt**: 2026-09-01 03:01 UTC
- **reopenedAt**: 2026-08-31 20:43 UTC
- **plan**: PLAN-910 M3 follow-up

## Description

Add the missing production `os/boards/s905x5m/boot.cmd` and connect it to the
normal image assembler so an identical compiled `boot.scr` is present in both
boot slots. The script must implement the RAUC `BOOT_ORDER` /
`BOOT_<slot>_LEFT` handshake against the redundant eMMC environment, use the
s905x5m partition numbers and working board load values, and preserve the
slot-suffixed verity metadata and explicit `rauc.slot=` behavior.

Offline acceptance covers source compilation, the partition-number drift
guard, and inspection that both boot filesystems contain identical `boot.scr`
payloads. It does not include a board boot, a successful RAUC health gate, or
any eMMC, boot-area, bootloader, deployment, or remote-repository write.

## ActiveForm

RFCT-930 is complete. Owner-observed hardware confirms both the dm-verity
bootargs handoff and the Amlogic HDMI handoff from the production eMMC boot
script. RFCT-934 retains the separate M5 watchdog evidence.

## Dependencies

- **blocked by**: (none; approval recorded 2026-08-31)
- **blocks**: (none; RFCT-934 retains the separate M5 watchdog evidence)

## Notes

- Claimed for PLAN-910 M3 follow-up investigation on 2026-08-31.
- The first eMMC write remains separately owner-gated and is out of scope.
- Approved on 2026-08-31: implement the script, dual-slot assembler wiring,
  `CONFIG_CMD_SETEXPR`, and the replacement U-Boot p5/p6 boot path. Assert
  every new promise against the built post-`olddefconfig` `.config` with a
  positive control; do not weaken existing section-5 gates.
- Bundle payload naming was not included in this approval and is deferred.
- Completed on 2026-08-31 with an isolated build on `192.168.27.200`; no
  package, deployment, eMMC, boot area, or board was written.
- Reopened on 2026-08-31 after board evidence showed the compiled script and
  eMMC route reach the kernel, but the Amlogic DT merge path truncates the
  quoted dm-verity table when the script restores `/chosen/bootargs`.
- Completed the correction and artifact handoff on 2026-08-31 at commit
  `a5919d39005022fed94e89b8b5a40aab2b832398`; no package was flashed.
- Reopened on 2026-08-31 after the corrected package booted from eMMC to a
  login prompt and `apid /healthz` returned OK, but HDMI remained blank.
- Owner approved the HDMI implementation on 2026-09-01, including post-
  `olddefconfig` assertions for Amlogic VOUT and HDMI prerequisites. No new
  symbol may be enabled and no existing gate may be relaxed.
- Owner-approved coordination: RFCT-930 produces no standalone package.
  RFCT-932 owns the one combined package build after this source commit and
  includes `com.mos.mqttsample.reference`; RFCT-933 consumes that exact package
  as its parameterized installer input. RFCT-930 performs no reboot or slot
  content change.
- HDMI source and focused verification landed at
  `eae91169c4f5efea3ddd709dbed167b48a1f0b3b`. No eMMC package, reboot, slot
  content change, or hardware write was performed by this task.
- Completed on 2026-09-01 after owner observation of the one combined package;
  RFCT-930 performed no flash, eMMC write, reboot, or slot-content change.

## Reopened HDMI correction

### Investigation

The production `boot.cmd` contains neither the Amlogic display environment nor
the kernel display arguments: there is no `vout`, `outputmode`,
`connector0_type`, `display_layer`, `aml_media`, `hdmitx`, or `logo=` token.
The board's working SD bridge has all of them. Its tested pair is `vout output
${outputmode}` before `booti`, followed by `aml_media.vout=${outputmode},disable`
on the kernel command line: U-Boot establishes the mode, then Linux deliberately
reprograms it. A seamless handoff previously produced a duplicated half-width
console on this board.

The bridge also supplies `console=tty1` before `console=ttyS0,921600`; the
serial console is the final `console=` parameter and must remain `/dev/console`
for bench diagnosis. The current production script carries only the serial
console and no framebuffer/display arguments.

The replacement U-Boot's source defconfig already enables `CONFIG_AML_VOUT=y`,
`CONFIG_AML_HDMITX=y`, and `CONFIG_AML_HDMITX21=y`, alongside the existing
generic video settings. The section-5 built-config contract currently asserts
generic video but does not assert those Amlogic prerequisites, so a future
configuration regression could leave a syntactically valid `vout` call without
its display implementation.

### Proposal

Keep the five display facts literal in `boot.cmd`: `HDMI-A-A`, `1080p60hz`,
`444,8bit`, `osd0`, and `0x00300000`; derive `hdmimode` from `outputmode` as in
the SD bridge. They are fixed hardware handoff values used only by this board's
pre-Linux scripts, and hush cannot read `board.env`. Adding board keys without
making both scripts consume them would create a third source of truth; changing
the working SD renderer solely to route five fixed values is unnecessary scope.
The exact literals and their required ordering will instead be asserted against
the production script's display contract. This decision is recorded here and in
PLAN-910.

After the existing RAUC and verity values, set the display environment, add
`console=tty1` before the existing serial console, and include `logo`,
`aml_media.vout=...,disable`, `aml_media.connector0_type`, `hdmitx`, and
`hdmimode` in `${bootargs}`. Preserve the deletion-only `/chosen/bootargs`
handoff, then invoke `vout output ${outputmode}` immediately before `booti`.
The test will require the U-Boot call and `,disable` argument as a pair, reject
a later `console=`, and verify their order before `booti`.

Extend the existing section-5 post-`olddefconfig` built-config contract to
require `CONFIG_AML_VOUT=y`, `CONFIG_AML_HDMITX=y`, and
`CONFIG_AML_HDMITX21=y`; no defconfig symbol will be enabled or existing check
relaxed. Update the U-Boot contract documentation accordingly.

Following focused tests, RFCT-930 will hand its source commit to RFCT-932 for
the sole combined eMMC package build on `192.168.27.200`. That package will
contain this display repair and `com.mos.mqttsample.reference`, then become the
input to RFCT-933's parameterized card producer. RFCT-930 itself performs no
hardware write, flash, deployment, reboot, or slot-content change.

### Implementation and focused verification

Commit `eae91169c4f5efea3ddd709dbed167b48a1f0b3b` adds the hardware-proven
display environment, kernel arguments, paired `vout output`, and serial-console
ordering to `boot.cmd`. It retains the deletion-only Amlogic DT bootargs
handoff. Its source test now rejects loss of any display value, the `,disable`
suffix, the U-Boot call, or the required ordering before `booti`.

An isolated source snapshot on `192.168.27.200` passed
`MOS_BUILD_CONTAINER=1 bash os/build/run.sh src/boot-s905x5m.test.ts` (9/9,
41 expectations). A fresh `SOURCE_DATE_EPOCH=1577836800 mkimage` compile
produced a valid 8,693-byte script payload with SHA-256
`58c4fc2ddb0f233b6735f389641afd5cad5165b0065b106149061a1100db2095`.
The same snapshot's `make s905x5m-uboot` passed the unrelaxed section-5 gate:
the display positive control found `CONFIG_AML_VOUT=y` once, and the built
post-`olddefconfig` `.config` contained `CONFIG_AML_VOUT=y`,
`CONFIG_AML_HDMITX=y`, and `CONFIG_AML_HDMITX21=y` once each. The existing
tree-wide FIT debt remained a warning.

No standalone eMMC package was built by design. RFCT-932 must build and inspect
the sole combined package before RFCT-933 consumes it; its artifact will supply
the only dual-slot `boot.scr` package evidence for this correction.

### Final hardware observation (2026-09-01)

The owner flashed the sole combined artifact,
`/backup/mos-artifacts/rfct-292-combined-0c9deaf6/update.img` (SHA-256
`1c09ad372ee33e2c2c5efc1bc4f1634481894c846ff493df19e363d10fd594e7`), which
contains `eae91169c4f5efea3ddd709dbed167b48a1f0b3b`. The board booted as
`mos-7f600267` at `192.168.27.61`, `apid /healthz` returned HTTP 200, and the
owner observed a picture on a connected HDMI display. HDMI output is therefore
an observed hardware result, not an inference from source or package content.

The earlier owner-flashed dm-verity correction likewise booted from eMMC to a
login prompt rather than stopping at `Waiting for root device`; together the
two observations close RFCT-930's two Amlogic handoff defects.

`CONFIG_AML_VOUT=y`, `CONFIG_AML_HDMITX=y`, and `CONFIG_AML_HDMITX21=y` were
added as required final built-`.config` assertions with a VOUT positive control
in `eae91169`, before this display observation. They are prospective regression
guards for a now-observed board property, not assertions added to fit a passing
result.

Both defects had the same root cause: cx3576 was used beyond its generic RAUC
state-machine role. RK3576 has neither Amlogic's quoted-bootargs merge behavior
nor its `vout`/`aml_media`/`hdmitx` display path. For Amlogic-specific behavior,
`boot-sd.ini.in`, not cx3576's `boot.cmd`, is the production reference; this is
also stated at the top of `boot.cmd`.

### Evidence boundary

The source, built-config, and package checks prove construction. The owner has
now additionally observed the exact combined artifact booting with an intact
dm-verity root handoff and HDMI output. This record does not substitute for the
separate M5 watchdog evidence owned by RFCT-934.

## Reopened correction

### Investigation

The board booted the eMMC `boot.scr` through the replacement U-Boot and reached
the kernel. Manual U-Boot inspection established that `env import`, the
composed `bootargs`, and the DTB property immediately before `booti` all retain
the complete quoted 13-field verity table. The kernel instead receives a
truncated table because Amlogic's `add_kernel_bootargs()` treats the restored
DT property as a merge source, splits it on spaces without respecting the
quotes, and de-duplicates the repeated verity fields.

`boot-sd.ini.in` already carries the hardware-proven workaround: remove the
source property and leave it absent, so the standard bootm FDT fixup copies the
environment's complete `bootargs` value. The production script copied an RK
strategy that restores the property, which is correct on cx3576 but wrong on
this Amlogic board.

### Proposal and approval

The owner explicitly approved a minimal correction: after the existing FDT
resize, retain only `if fdt rm /chosen bootargs; then echo ...; fi`; do not
restore the property and remove the misleading failure warning. A failed
removal is not necessarily unsafe because the desired property may already be
absent, so the production script will match the proven SD bridge rather than
infer that it retained an unsafe value. Add a focused regression assertion that
the source removes the merge input and contains no command that reinstates it.

Rebuild the complete package from the resulting commit on `192.168.27.200`,
publish it under `/backup/mos-artifacts/rfct-290-<commit>/`, and report its
path, size, and SHA-256. This approval excludes flashing, eMMC/boot-area or
bootloader writes, deployment, and any claim that the corrected package boots
until an owner flashes it and observes the board.

### Implementation

Commit `a5919d39005022fed94e89b8b5a40aab2b832398` removes the `fdt set` command
and its misleading `else` warning. After the FDT resize the script now has the
same conditional deletion shape as the hardware-proven SD bridge, retaining
the complete value only in the environment for the standard bootm FDT fixup.
The focused test asserts the deletion command and rejects any command that
restores the DT property.

### Verification and artifact

- `MOS_BUILD_CONTAINER=1 bash os/build/run.sh src/boot-s905x5m.test.ts` passed
  8/8 tests, including the new Amlogic DT merge-input regression.
- An isolated non-Git snapshot of the exact commit on `192.168.27.200` passed
  `make os-emmc-package-s905x5m-v2`. Its normal chain completed the rootfs
  smoke register (12/12), the Amlogic package format check, and the required
  18/18 input round trip. The U-Boot export contract remained in place; the
  existing tree-wide FIT debt stayed a warning.
- An independently checksum-verified pinned packer unpacked the resulting
  package. BOOT-A and BOOT-B each yielded a 7,779-byte `boot.scr`, both
  SHA-256 `89e4d345a808ddc31dc959e92d031d9b60d25fb49fbbdb409eafd8406f0898f5`.
  Each byte-matched a fresh `SOURCE_DATE_EPOCH=1577836800` compilation of
  `boot.cmd`, contained the removal message, and contained neither the removed
  command nor the old failure warning.
- The durable artifact is
  `/backup/mos-artifacts/rfct-290-a5919d3/update.img` (1,369,400,096 bytes,
  SHA-256 `c2955b05d8d85e04bd6109ec042c0755685992923c085c388b20b0aa8c538bec`).
  Its `update.img.sha256` sidecar was generated from the published file and
  passed `sha256sum -c`.

### Result

This proves the corrected artifact no longer reinstates Amlogic's DT merge
input. It does not prove the corrected package boots, reaches userspace, marks
a RAUC slot good, or rolls back: the owner must flash this exact artifact and
observe the board before any of those claims are made.

## Investigation

- `os/boards/s905x5m/board.env` declares `boot.scr` and its missing
  `BOOT_CMD_SOURCE`, but the normal s905x5m assembler neither compiles that
  source nor places a script in boot-a or boot-b. The existing slot-image test
  therefore expects only the kernel, DTB, and slot-specific verity environment.
- The reusable `checkBootCmd()` path already rejects literal `bootpart` and
  `rootpart` values that disagree with board geometry, but the s905x5m
  assembler does not invoke it. For this board the required literal values are
  boot A/B `5`/`6` and rootfs A/B `7`/`8`; the environment backend is eMMC
  device `1`, hardware partition `0`.
- The working cx3576 script establishes the required RAUC contract: choose the
  first eligible slot from `BOOT_ORDER`, decrement its hexadecimal credit with
  `setexpr` before boot, persist it with `saveenv`, load
  `mos-verity-${slotsuffix}.env` before the unsuffixed fallback, and mark a
  returned or incomplete slot bad. Its two documented corrections are required
  here as well: the slot-suffixed verity file and `rauc.slot=${bootslot}`.
- s905x5m's observed boot values are kernel address `0x3000000`, DTB address
  `0x1000000`, DTB `s7d_s905x5m_m100.dtb`, and serial arguments
  `console=ttyS0,921600 earlycon=aml_uart,0xfe07a000`. The SD bridge is
  evidence for those values, not a production-script template.
- A static script alone would be inert on the current replacement U-Boot
  source: the eMMC source selection runs `cfgload emmc` from `mmc 1:1` and
  reads `boot.ini`, not either `boot.scr` in p5/p6. Its defconfig also has
  `CONFIG_CMD_SETEXPR` disabled, although the required handshake must use
  `setexpr` and must keep credits in hexadecimal `1..9`.
- The RAUC bundle path currently hard-codes the cx3576 DTB destination name.
  A s905x5m bundle would consequently omit the DTB name that the proposed
  script loads unless the payload naming is made board-derived.

## Proposal

Recommended end-to-end scope:

1. Add `os/boards/s905x5m/boot.cmd`, compiled once for both boot filesystems.
   It will use eMMC `mmc 1`, literal p5/p6/p7/p8 selection, hexadecimal
   `setexpr` credit handling, pre-boot `saveenv`, slot-suffixed verity loading
   with unsuffixed fallback, explicit `rauc.slot=${bootslot}`, and the board's
   kernel, DTB, and serial values. It will not copy the SD bridge's cfgload or
   display-routing implementation.
2. Make `mkimage-s905x5m-sd.ts` resolve `BOOT_CMD_SOURCE`, run the existing
   boot-command and partition-number guards, compile the source, and copy the
   same `boot.scr` bytes into both boot-a and boot-b. Add focused negative and
   filesystem-extraction tests, including byte equality of the two scripts.
3. Add the minimal replacement-U-Boot configuration and board-source change
   needed for an eMMC selection to source the p5 script (with p6 as a loading
   fallback), while retaining the SD cfgload bridge only for SD compatibility.
   Enable and assert `CONFIG_CMD_SETEXPR`; do not add a pre-Linux environment
   writer outside the script's deliberate `saveenv` calls.
4. Make bundle boot-payload source and DTB destination naming board-derived so
   an inactive-slot RAUC installation contains the script's DTB and both
   slot-suffixed verity metadata files.
5. Verify source compilation, guard failures for every mismatched partition
   number, both boot filesystems' identical legacy `boot.scr`, the U-Boot
   source/config contract, and the generated bundle payload. Run any heavy
   image build only on `192.168.27.200` after implementation approval.

Approval disposition: items 1 through 3 and their focused verification are
approved. Item 4 and bundle-payload verification are deferred; no bundle source
will change in this task.

## Implementation

- Added the production `boot.cmd`. It selects the first credited `BOOT_ORDER`
  slot, decrements hexadecimal `BOOT_<slot>_LEFT` with `setexpr`, saves the
  decrement before booting, and marks an unsuccessful slot bad. It uses eMMC
  `mmc 1`, literal p5/p6 boot and p7/p8 rootfs numbers, the measured kernel and
  DTB addresses, slot-suffixed verity metadata with the legacy unsuffixed
  fallback, and `rauc.slot=${bootslot}`.
- The normal s905x5m assembler now resolves `BOOT_CMD_SOURCE`, refuses a
  partition-number mismatch before opening a toolbox, compiles one reproducible
  legacy `boot.scr`, and copies those same bytes into both boot FAT filesystems.
- The replacement U-Boot leaves `cfgload sd` as the SD bridge and changes its
  eMMC source path to load `boot.scr` from p5, falling back to p6 only when the
  p5 load fails. It never retries after `source` starts, so one returned script
  cannot decrement the persistent A/B state twice.
- The built-config promise now includes `CONFIG_CMD_SETEXPR` for the credit
  decrement; `CONFIG_CMD_SOURCE` and `CONFIG_LEGACY_IMAGE_FORMAT` for the
  compiled script; `CONFIG_CMD_IMPORTENV` for verity metadata; `CONFIG_CMD_FAT`
  plus `CONFIG_FS_FAT` for p5/p6 loads; `CONFIG_CMD_BOOTI` for the ARM64 Image;
  `CONFIG_CMD_FDT` plus `CONFIG_OF_LIBFDT` for removing the Amlogic DT merge
  input before bootm fixes up `/chosen/bootargs`; and
  `CONFIG_HUSH_PARSER` for the script's control flow. Existing `saveenv` and
  redundant-environment assertions remain separate, unchanged requirements.
  The final config also rejects `CONFIG_AML_DISABLE_DEV_CMDS=y`, because that
  source-level switch removes Amlogic's `fatload` command even with `CMD_FAT`.

## Verification

- The isolated remote `make s905x5m-uboot` build completed. The new patch
  applied, its host fallback-contract test passed, and section 5 observed every
  required command/config symbol exactly once in the final built `.config`,
  with `# CONFIG_AML_DISABLE_DEV_CMDS is not set` also matching once; its
  `CONFIG_CMD_SETEXPR=y` positive control matched once.
- The same run retained the existing redundant-environment and bootcount gates.
  The tree-wide FIT/signature debt remained a warning rather than being relaxed
  or hidden.
- `MOS_BUILD_CONTAINER=1 bash os/build/run.sh src/boot-s905x5m.test.ts` passed
  7/7 tests, including all four literal partition-number drift failures.
- `MOS_BUILD_CONTAINER=1 bash os/build/run.sh src/mkimage-s905x5m-sd.test.ts`
  passed 10/10 tests, including boot-script compilation, p5/p6 filesystem
  contents, legacy-image magic, byte equality of both copies, and the
  assembler's pre-toolbox partition guard.

## Evidence boundary

The previously flashed package proved that the predecessor script executes and
reaches the kernel, which is how this defect was isolated. The corrected source
and artifact checks prove construction only. They do not prove the corrected
package boots, that RAUC reaches `mark-good`, or that rollback works; that
requires the owner to flash this exact package and observe the board. Bundle
payload naming remains deferred.

## Risks

- The U-Boot routing change is necessary to remove the eMMC p1 bridge
  dependency, but it cannot be proven on hardware until the separately
  owner-gated first write has happened. Offline checks prove only the artifact
  and source contracts, not a boot, RAUC health gate, or rollback.
- A script/assembler-only change would leave the production script
  unreachable and `setexpr` unavailable. It could satisfy a file-presence
  check while failing the stated operational outcome.
- The package/bundle adjustment expands beyond the two named files, but
  omitting it would let an update install a boot payload lacking the DTB name
  that the script loads.
- RFCT-929's already-built image predates this source and any required U-Boot
  routing change. It cannot acquire them retroactively; a later build would
  need a separately owner-authorized package before any hardware use.

## Scope

- Approved implementation files are the s905x5m boot command, its normal
  assembler and tests, the smallest affected U-Boot config/patch and tests,
  plus task/plan records. Bundle payload code and tests are deferred.
- The reopened correction changes only `boot.cmd` and its focused test, then
  rebuilds and publishes the existing complete package chain without changing
  package topology or any hardware byte.
- Excluded: hardware writes, deployment, flashing any eMMC area or bootloader,
  a first bootloader write, and a claim that the live RAUC handshake is
  verified.

## Alternatives

- **Recommended: end-to-end route and payload integration.** This makes the
  compiled script reachable in a subsequently rebuilt, owner-authorized
  package and keeps RAUC updates self-consistent.
- **Narrow: script and assembler only.** This is smaller, but knowingly leaves
  eMMC boot routed to p1 `boot.ini` and cannot remove the SD bridge dependency.
- **Embed the new script in p1.** Rejected because p1 is vendor-owned on eMMC
  and because it would bypass the two boot-slot filesystems the script must
  inspect.
