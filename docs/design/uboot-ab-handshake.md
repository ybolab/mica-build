# cx3576 signed FIT boot and trial records

The normal cx3576 boot path is compiled C policy in
[`mos-file-boot.c`](../../boards/cx3576/bsp/uboot/mos-file-boot.c).
It reads current three-partition geometry and bounded deployment records, arms
the watchdog before storage discovery, persists a trial decrement, and loads a
required-signature FIT. It does not import commands, boot scripts, environment
variables or an editable root command line.

## Development console policy

During system development, preserve the standard U-Boot serial interaction:
`Hit any key to stop autoboot: 1` waits one second, any key enters the native
command prompt, and timeout executes `bootcmd=mosboot`. At the prompt, `boot`,
`run bootcmd`, or `mosboot` resumes the same signed deployment policy. Disabling
this entry requires an explicit user request; a signed-boot or startup cleanup
change must not silently remove it.

The file-deployment migration previously set `BOOTDELAY=-2` and called the
nonreturning policy before `cli_init()`, bypassing the native countdown and CLI.
The policy is now a registered command in the unmodified native main loop.
Restoring only the delay would not repair the earlier bypass.

The countdown and CLI precede deployment selection, so entering the console
does not consume a trial. Once `mosboot` starts, it disables Control-C, requires
FIT verification, checks the recovery key, arms the watchdog, and performs the
bounded deployment transaction. Hold the recovery key through the countdown to
enter RockUSB. Native console input waits service the cyclic watchdog scheduler.
Persistent environment commands remain disabled; interactive commands are local
development access and are not a locked production console.

The mandatory RK3576 watchdog uses enabled PCLK_WDT0 and TCLK_WDT0 gates.
A probe or start failure reports its error and enters recovery before media
access or attempt consumption. RockUSB recovery runs the cyclic scheduler while
waiting for USB so an armed watchdog remains serviced. The firmware build tests
the pinned watchdog driver and recovery loop and verifies the control-FDT node.
Physical reset and Linux handoff remain bench acceptance requirements.

## Disk contract

[`board.env`](../../boards/cx3576/board.env) is authoritative.

| Partition | Range | Contents |
|---|---|---|
| FIRMWARE | LBA 64 through 36863 | Loader and both trial-record copies |
| SYSTEM | 18 MiB through 1042 MiB | 1 GiB of immutable kernel/support/root objects and signed deployment envelopes |
| DATA | From 1042 MiB, 256 MiB in the factory image | Persistent state, metadata, user data and bounded disposable namespaces |

The loader starts at byte 32768 and is bounded to 16744448 bytes. Two 64 KiB
record copies start at absolute disk offsets 16 MiB and 17 MiB. Those offsets
are relative to the whole disk; native accesses through partition 1 subtract
its 32768-byte start. The complete reserved region is a GPT partition so DATA
expansion cannot discard loader or record bytes.

The assembler writes two independently authenticated factory deployments.
Current records are strict and bounded to two entries. Each binds deployment
ID, kernel ID, generation and confirmed/trial state. CRC and redundant-copy
sequence handling select a complete copy; malformed fields, duplicate identities
and invalid counters are rejected. Counters are not reconstructed from defaults
when both records are unusable.

## Selection and confirmation

A trial begins with three attempts. The firmware decrements and persists an
attempt before loading the candidate. A persistence/readback failure prevents
launch. Exhausted records are not selected. Healthy userspace confirms only its
authenticated running deployment through `mos-deploy`; no early systemd service
silently blesses it.

After bounded failed trials, the retained usable deployment is selected. When
none remains, boot stops for explicit recovery. Shared SYSTEM/DATA failures are
reported as storage recovery failures, not repaired by resetting counters or
trying unsigned content. Confirmation and garbage collection authenticate all
retained descriptors before removing anything they protect.

FIT verification uses the public keys embedded in the shipped U-Boot control
FDT. The signing workflow extracts that FDT from the actual produced loader and
checks required configuration signatures over kernel, DTB and initramfs. The
key set supports explicit overlap and old-key removal. Production policy has no
persistent environment command-import route.

Machine identity is generated once on authenticated physical DATA before
systemd and bound read-only at `/etc/machine-id`. Trial records are not an
identity database.

## Build and recovery

Build the board's signed-policy loader with `make -C boards/cx3576/bsp uboot-mos`
and explicit public boot signing inputs; kernel content trust is supplied
separately. `build/run.sh --components` packages the signed FIT, firmware,
root, deployments and complete factory disk with explicit inputs.

Full-image flash preflight checks the current GPT and loader placement before
any USB write. Readback compares the complete flashed image before reset.
Independent firmware maintenance is an explicit offline operation described in
[release signing](release-signing.md); it does not enter the ordinary deployment
catalog and does not perform irreversible enrollment.

## Acceptance

The current loader, FIT signatures, strict record parser, native transaction
faults, full-image verifier and real DATA growth test have software evidence.
Dirty SYSTEM snapshots were read by the pinned U-Boot sandbox; a missing
uncommitted candidate requires bounded fallback. These results do not establish
physical eMMC durability.

On the local bench, record exact image/component IDs and serial output across
healthy boot, three failed trials, attempt persistence failure, pre-userspace
hang/watchdog reset, shared storage recovery and power cuts at destination
writes, sync, activation, decrement and confirmation. cx3576 physical acceptance
remains open until those observations exist.
