# 20260910-0341-minimal-boot-shutdown Minimize boot and shutdown userspace with BusyBox

- **status**: draft
- **createdAt**: 2026-09-10 03:41
- **approvedAt**: (pending)
- **relatedTask**: 20260910-0338-minimal-boot-shutdown

## Current implementation status (2026-09-11)

This document preserves the original feasibility proposal. B3 already delivered
the reviewed native HYBRID supervisor plus BusyBox/dmsetup retained closure; it
is not an unimplemented native design. The user now explicitly directs the
single-static-executable refinement in [the current B3 plan](20260910-1206-b3-bounded-exitrd-teardown.md).
Its direct syscall/typed DM backend preserves the existing safe state machine.
B7 owns final combined no-Python/static-shutdown image acceptance. The historical
measurements below are not static-artifact or current guest/RSS evidence.

## Context

The user asked whether minimal BusyBox environments could serve both shutdown
and startup. This is a feasibility proposal, not an approved implementation.
Replacing these tools crosses packaging, authenticated init and acceptance tests
and therefore uses the full PMA tier. Preserve concurrent board repairs.

`pkgs/mos-boot/initramfs.sh` currently copies `mos-init`, util-linux tools,
`veritysetup`, `dmsetup` and their ELF dependencies. It also embeds a second
closure containing `systemd-shutdown`, retained at `/run/initramfs` by
`pkgs/mos-deploy/src/bin/mos-init.rs`. Startup currently uses the Rust program
as PID 1; it does not run systemd inside the initramfs.

The integrated ARM64 archive measures 33,615,872 bytes. The retained exitrd has
20 regular files totaling 17,253,688 bytes (16.45 MiB). Its largest members are
`libcrypto.so.3` (6,302,952 bytes) and `libsystemd-shared-257.so` (4,536,888 bytes).
The current 36 MiB tmpfs setting is a limit, not a measurement of allocated RAM.

An ELF dependency walk over the same archive finds the existing ARM64 `dmsetup`
closure is 4,765,416 bytes across ten paths, including both loader paths copied
by the current closure builder. This is a baseline for a proposed replacement;
it is not the size of a built BusyBox exitrd. A sub-MiB total cannot be promised
while carrying this unmodified dynamic closure.

The local BusyBox 1.37.0 help was inspected without invoking any mount, loop or
shutdown operation. Its `blkid` lacks the current `-t PARTUUID=... -o device`
contract, and its `losetup` uses different options from the current
`--read-only --find --show` call. Its applet list has no `dmsetup` or
`veritysetup`. Merely replacing executable paths would break boot.

`mos-init` verifies the signed deployment and its selected identity, requires
kernel dm-verity signatures, opens signed root/support mappings, validates DATA
belongs to the system disk, handles failed boot records and arms the watchdog.
These responsibilities are not supplied by BusyBox applets.

The ARM64 acceptance log at
`.tmp/strict-ab-checkout/_out/file-runtime.mXNi8a/boot/updates/7/boot.log`
shows the storage dependencies remaining busy before the exitrd transition and
all filesystems, loop and DM devices detached afterward. Preserve this outcome.

Primary references:

- [BusyBox manual](https://busybox.net/downloads/BusyBox.html): configurable
  applets provide reduced command interfaces.
- [systemd initrd interface](https://systemd.io/INITRD_INTERFACE/):
  `/run/initramfs/shutdown` may be a custom executable; systemd pivots into its
  environment and passes the shutdown verb followed by optional arguments.

## Proposal

Use one deliberately configured, statically linked BusyBox build per target
architecture for basic early-userspace and shutdown operations. Verify the
latest stable release and pin its source digest before implementation. Build in
project containers and publish the required license/source records.

1. Keep `mos-init` as startup PID 1 and retain its authenticated boot policy.
   Replace the generic mount, loop and switch-root tools where BusyBox supplies
   the required behavior. Adapt invocation arguments deliberately. Retain the
   existing `blkid` PARTUUID lookup, `veritysetup` and `dmsetup` in the initial
   change; replacing them requires more policy and device-mapper code.
2. Replace the exitrd's systemd-shutdown closure with BusyBox, a bounded shutdown
   script and the existing `dmsetup` dependency closure. Main-system systemd
   still stops services and performs the transition into this environment.
   The script processes the requested reboot/poweroff/halt action, releases
   remaining mounts in dependency order, closes MOS DM mappings, detaches their
   loops, unmounts the backing filesystem, syncs, and performs the final action.
   Re-read mount state for nested mounts and moved backing mounts; use bounded
   retries and explicit failure output. Never report lazy unmount or deferred
   DM removal alone as successful teardown. Account for the armed watchdog.
3. Retain only shutdown-required files under `/run/initramfs`; release startup
   tools at switch-root. Adapt the explicit file manifest for the selected
   BusyBox applet layout. Derive the retained tmpfs budget from measured payload
   with documented working headroom. Remove replaced packaging assertions and
   dependencies together, keeping one current implementation with no old path.

Conceptual contents, not an implemented directory listing:

```text
Startup:  mos-init + BusyBox + blkid + veritysetup + dmsetup + required libraries
Shutdown: shutdown script + BusyBox + dmsetup + required libraries
```

## Verification

- Before implementation, add failing acceptance checks for the retained payload
  contract and required shutdown results. Existing ELF-only/no-shell assertions
  must change intentionally to the approved explicit applet/script manifest.
- Verify BusyBox bind/remount/move and loop read-only behavior, along with
  switch-root preservation of `/dev`, `/proc`, `/sys` and `/run`.
- Run x64 and virtual ARM64 signed boot, signature/corruption refusal,
  deployment selection, component upgrades, three-trial fallback, normal
  shutdown and actual reboot. Check clean storage release and completed guest
  actions, rather than expecting systemd-specific wording from the new script.
- Build a newly signed CX3576 FIT/image with the current board repairs; run
  offline signature, layout and growth checks. Verify cold boot, apid reboot,
  poweroff and watchdog behavior on the local board when it is available.
  Do not count QEMU or image inspection as physical acceptance.
- Compare uncompressed archive bytes, retained file payload, mounted tmpfs
  allocation and startup peak RSS on both architectures. Run the relevant Rust,
  packaging, shell and documentation gates. No size claim before measurement.

## Risks

BusyBox command options are not a drop-in replacement for util-linux. A shell
rewrite of signature/A/B policy would enlarge this task and its review burden.
The exitrd receives a mount topology already transformed by systemd, and a
forced final reboot by itself does not prove storage teardown. Watchdog timeouts
must remain bounded across the transition. The main filesystem and firmware
signature contracts must remain intact.

## Scope

`pkgs/mos-boot/` packaging/configuration, the generic tool invocations and exitrd
copy contract in `pkgs/mos-deploy/`, and the relevant build/boot/shutdown tests.
Record the delivered measurements in this task. No board driver cleanup,
main-system init replacement, partition change, compatibility layer or migration.
Coordinate overlap with the separately owned CX3576 boot-log investigation.

## Alternatives

- A custom static shutdown executable can avoid the dynamic `dmsetup` closure,
  but requires implementing and testing mount and device-mapper operations.
  That former budget-only condition is superseded by the explicit 2026-09-11
  user direction recorded in the current B3 plan; 1-2 MiB is a measurement target,
  not permission to weaken safety or claim an unmeasured result.
- Rebuilding a minimal systemd-shutdown is another size experiment, retaining
  its existing teardown implementation but adding build configuration work.
- Replacing all authenticated init logic with shell is not recommended: it
  would still need signature and device-mapper helpers and duplicate validated
  boot policy without an established size or simplicity benefit.

## Annotations

The feasibility assessment was complete at the original handoff. Subsequent
HYBRID delivery and the approved static refinement are tracked in B3 above.
All tests use newly built complete system images; no compatibility is required.

Current acceptance scheduling (2026-09-11 user amendment): the B3 static
refinement and B7 combined image qualify x64 first. ARM compilation and
virt-arm64/CX3576 acceptance are deferred to one consolidated wave after the
actual approved main merge; historical ARM preflight results are not final
backend qualification. See the current B3 plan above for the explicit phases.
