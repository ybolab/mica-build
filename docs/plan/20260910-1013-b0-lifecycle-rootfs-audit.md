# 20260910-1013-b0-lifecycle-rootfs-audit Lifecycle and rootfs closure design

- **status**: completed
- **createdAt**: 2026-09-10 10:13
- **approvedAt**: 2026-09-10 10:13 (prior user approval recorded at execution)
- **relatedTask**: 20260910-1013-b0-lifecycle-rootfs-audit

## Context

### Evidence boundary and decisions

Campaign `mos-open-plans-20260910-100408`; L2 B `8t4ghqi6`; B0 branch
`bkd/e06h4k7c`. Audited on 2026-09-10 UTC against committed source
`5c61f7fbb5589807e931e981b3ef8cb9bdff8b6d`. The branch and clean status were
verified before edits. No main working-tree content, other executor branch,
uncommitted product file, guest, image build or historical artifact directory
was read as current evidence. B0 needs no #313 source synchronization.

The user approved this full-tier bounded audit, downstream charter and local
scoped B0 commit before execution. Completion means this design and its source
checks, not delivery of B1-B7. No compatibility, migration, RAUC, old raw slots
or old-image update path is required. Every runtime acceptance image must be a
fresh complete image built from the newest approved integrated source.

Preserve mos-init as startup PID 1, signatures and dm-verity, component selection,
trial/fallback records, watchdog enforcement and real recovery. Main-system
systemd, udev/device rules and support module indexes remain. SYSTEM is 1 GiB
and holds only current final A/B components/records; acquisition and verification
stage on DATA. Whole /var remains writable and bounded; /mos, /srv and
/mos/containers have unlimited byte and inode quotas. Container storage and tmp
stay underneath the private /mos/containers bind; reset isolation stays intact.
Preserve authenticated tty2 via Alt+F2/Ctrl+Alt+F2 and centered YBO - Hub OS
with gradient branding; no autologin.

PLAN-086 S5 was declined on 2026-09-08. Its older proposal text is not authority
to remove bash, GNU utilities, outbound SSH, curl, iptables or selected
PAM/NSS/network helpers. The independently approved early-userspace BusyBox
work does not change the main root's emergency BusyBox or its unexpanded PATH
policy. S3 and S6 remain applicable without S5.

### Source map: lifecycle

| Committed evidence | Observation and consequence |
|---|---|
| `pkgs/mos-boot/initramfs.sh:7-37` | Copies mos-init to /init, then mount, blkid, losetup, veritysetup, dmsetup and switch_root with ELF closures. Separately copies systemd-shutdown to /exitrd/shutdown; finds regular files for exitrd.files, makes sorted timestamp-normalized newc cpio, and asserts no /bin/sh, /bin/busybox or modules. B1 must replace the early-only assertions deliberately. |
| `pkgs/mos-boot/elf-closure.py:13-47` | Recursive DT_NEEDED and PT_INTERP lookup in fixed target library directories, validates ELF64 little-endian machine 62/183, dereferences with copyfile and sets every mode 0755. No script, symlink, hardlink or xattr preservation; the copied-path set resets per invocation. This is a small boot copier, not the S3 runtime selector. |
| `pkgs/mos-boot/Dockerfile:8-29` | Boot tools include cryptsetup, util-linux and systemd for both architectures. Keep the systemd bootloader/ukify production dependencies even when its retained shutdown closure goes away. |
| `pkgs/mos-deploy/src/bin/mos-init.rs:108-190` | Commands clear the environment, cap runtime at 30 s and output at 16 KiB. verified_mount authenticates signature/size, creates a read-only loop, opens verity, verifies root_hash_sig_key_desc and sysfs read-only status, then mounts squashfs. Preserve these checks. |
| `pkgs/mos-deploy/src/bin/mos-init.rs:192-400` | Arms watchdog before deployment storage; validates selected UEFI/FIT identity, opens SYSTEM read-only, verifies deployment and support release; binds modules/firmware; validates DATA disk/partition identity and binds persistent machine-id. |
| `pkgs/mos-deploy/src/bin/mos-init.rs:411-469` | Retains exitrd on a separate 36 MiB tmpfs; moves SYSTEM, support and dev/proc/sys/run before exec of switch_root /newroot /sbin/init. /run's separate 32 MiB limit is not measured allocation. Records its own VmHWM, excluding tool processes and backing pages. |
| `pkgs/mos-deploy/src/boot.rs:84-118`, `pkgs/mos-deploy/tests/boot.rs:60-103` | copy_exitrd permits only regular members: 8,192 manifest bytes, 128 lines and 32 MiB payload. Creates dev/proc/sys/run/oldroot/etc and initrd-release. Tests cover traversal, absolute path, blank member, leaf symlink, size and mode. Empty manifest, duplicates and ancestor symlinks are not explicitly rejected. |
| `pkgs/mos-deploy/src/bin/mos-init.rs:472-520` | Boot refusal selects recovery/poweroff versus retry/restart, after possible confirmed-record retirement. It calls the reboot syscall without a shared teardown routine. This is a B3 negative case for partial startup, not evidence of graceful teardown. |
| `rootfs/packages-src/system/Dockerfile:182` | Main-system policy sets RuntimeWatchdogSec=90s and RebootWatchdogSec=120s. Neither an inherited environment value nor a tmpfs size proves remaining watchdog time. |

The systemd initrd interface passes the verb first, followed by optional systemd
arguments; a custom exitrd owns final complex-storage release. In v257 shutdown
source, systemd closes its watchdog without disarming before pivot and execs
/shutdown after moving the old root to /oldroot. The replacement must reacquire
and service the armed device, rather than assume an inherited open descriptor.
Sources inspected on 2026-09-10:
[initrd interface](https://systemd.io/INITRD_INTERFACE/) and
[systemd v257 shutdown](https://raw.githubusercontent.com/systemd/systemd/v257/src/shutdown/shutdown.c).
The exact pinned package version still needs confirmation in B1/B3 artifacts.

### Source map: composition and measurements

- `rootfs/packages/resolve.sh` selects common, profile, board, feature, radio and
  scoped component packages. `rootfs/packages/common.pkgs` always selects
  mos-system, mos-deploy, mos-ca-trust and mos-busybox. Preserve this resolver;
  S3 must not introduce another feature solver.
- `rootfs/debian/manifest.ts:44-76` always includes the base consumer and selects
  locked upstream archives by consumer. `rootfs/compose/10-compose.Dockerfile`
  configures the bootstrap floor, then copies the complete root into composed.
  `compose-install.sh:31-80` verifies archive hashes, exact versions and installed
  counts offline; its later steps create public metadata and release identity.
  Installation dependencies are not proof that all their paths should ship.
- `rootfs/compose/90-pack.Dockerfile:74-89` records installed-package inventory
  before pruning; later stages remove hwdb/package management, transform the
  tree, strip userspace debug, measure and pack. It copies the full closed root
  at line 275 and full packed tree into factory-root at line 511. No
  `rootfs/runtime/` selection implementation exists at the baseline.
- `rootfs/scripts/pack-tree-surgery.sh:11` already removes
  `/rootfs/var/cache/ldconfig/aux-cache` with plain `rm`. It no longer relocates
  all /var to /usr/share/factory/var. `mos-seed-var` uses /var as its template;
  `var.mount` binds DATA/var. `pack-export-factory-var.sh` describes the old
  EPHEMERAL model but has no invocation in current 90-pack; do not revive it.
- `pack-export-boot.sh` now requires /boot, /usr/lib/modules and
  /usr/lib/firmware to be empty in the user root. Kernel/support are independent
  components. Historical comments about exporting kernel blobs from rootfs do
  not describe its current executable behavior.
- `rootfs/overlay/usr/lib/mos/mos-data-layout:55-58` assigns unlimited project
  quotas to system and container data, and a bounded variable-data project.
  `mos.mount`, `mos-containers.mount` and `var.mount` make private binds.
- `verify/src/checks-root.ts` already resolves absolute and relative links
  inside the image root. Reuse its resolution semantics/tests for S3; never use
  host realpath to follow a target absolute symlink. `verify/src/elf.ts` is a
  section/build-id reader, not a complete runtime dependency resolver.
- `tools/measure-rootfs.sh` reads factory-root OCI, counts regular data by
  device:inode, and reports naive/deduplicated sums. Its fixed measure-root
  directory is deleted on entry, and tree-stamp comes from the current checkout,
  not independently from the measured artifact. It omits actual mounted exitrd
  allocation and process-tree RSS. B5 must make these boundaries explicit.

### Existing lifecycle wrappers, inspected without execution

`tests/file-ab-x64/runtime-build.sh` extracts a supplied production root and
adds acceptance units before signing a fresh complete disk. `boot.sh` launches
x64 or virt-arm64 with i6300esb/reset and -no-reboot; process exit alone cannot
distinguish poweroff from watchdog reset. `runtime.sh` ends with
`systemctl --no-block poweroff`; its fail path prints FILE_AB_RUNTIME_FAIL and
forces poweroff. That failure cleanup must never be accepted as a successful run.

`shutdown-check.sh` currently requires two systemd text messages and rejects
three failure messages. It does not inspect mounts/devices or requested action.
`acquisition.sh`, `reset.sh`, `offline-clock.sh`, `large-root.sh`, `early-hang.sh`
and `kernel-faults.sh` consume it. `updates.sh` checks update/fallback markers
but does not invoke it; B7 must close that gap. `faults.sh` covers bad signatures,
three-trial fallback, exhaustion and shared SYSTEM/DATA refusal; some refusal
cases deliberately permit timeout, so those results cannot become graceful
shutdown evidence. `early-hang.sh` and `kernel-faults.sh` capture QMP watchdog
and shutdown events through `qmp-boot.py`. Keep their failure classification.
`tests/file-ab-fit/dirty-system.sh` uses real mounts/DM and is not a cheap B0
fixture; source inspection does not prove power-cut behavior.

## Proposal

### B1/B2: exact boot adapter and retained payload contract

Use one separately configured static early BusyBox per target architecture,
installed at /bin/busybox inside startup and exitrd. Keep /init as mos-init.
Invoke applets explicitly; no symlink farm is needed. The main-root
/usr/bin/busybox producer and GNU/PATH contracts remain unchanged.

| Current argv | Proposed early argv and required test |
|---|---|
| `/bin/mount -t TYPE -o OPTS SRC DST` | `/bin/busybox mount -t TYPE -o OPTS SRC DST`; test devtmpfs/proc/sysfs/tmpfs/ext4/squashfs and effective flags, not only exit 0. |
| `/bin/mount --bind SRC DST` | `/bin/busybox mount -o bind SRC DST`; retain separate `mount -o remount,bind,ro,nodev,nosuid[,noexec] DST`, assert resulting readonly bind and required execution where allowed. |
| `/bin/mount --move SRC DST` | `/bin/busybox mount -o move SRC DST`; prove mount ID/dev identity survives each move. |
| `/sbin/losetup --read-only --find --show FILE` | Call `/bin/busybox losetup -f`, validate a nonempty numeric /dev/loopN, then `/bin/busybox losetup -r /dev/loopN FILE`. No --show support is assumed. Check actual loop association and ro=1. On EBUSY re-discover with a bounded retry; never detach another owner's raced loop. |
| `/sbin/blkid -t PARTUUID=UUID -o device` | Retain util-linux blkid and its closure unchanged. BusyBox blkid is not an equivalent selector. Keep empty/multiple/wrong-disk rejection. |
| veritysetup open arguments, dmsetup table | Keep existing binaries and signed verity_args unchanged. No unsigned retry or alternative policy implementation. |
| `/sbin/switch_root /newroot /sbin/init` | Exec `/bin/busybox switch_root /newroot /sbin/init`; PID remains 1. Before exec move all four API/run mounts, SYSTEM and support exactly as today. Assert /newroot is a mountpoint and target init resolves; verify the original initramfs is freed and exitrd remains. |

BusyBox's [manual](https://busybox.net/downloads/BusyBox.html) and inspected
[losetup source](https://raw.githubusercontent.com/mirror/busybox/master/util-linux/losetup.c)
support the applet invocation model and the two-call loop contract. The source
is an unpinned design reference, not a selected production version. B1 must
verify the current stable source, digest, configuration and built help output;
B2 gates run against that exact produced binary, on amd64 and arm64.

Startup closure: mos-init, static BusyBox, util-linux blkid, veritysetup,
dmsetup and their actual ELF dependencies. Retained closure: /shutdown script
with `#!/bin/busybox sh`, /bin/busybox, /sbin/dmsetup and its recursive ELF
closure. Select only required applets: sh/ash, mount, umount, losetup,
switch_root, sync, reboot/poweroff/halt and the actual parser/retry/watchdog
helpers used by B3. No BusyBox init, mdev, networking or login policy is added.
Retain required licenses/source offer outside the executable exitrd budget.

The regular-file manifest remains sufficient with this no-link layout.
Teach packaging to copy the shutdown script directly instead of passing it to
the ELF copier; enumerate regular files deterministically, assert exact required
members, modes and architecture, and reject unexpected members. copy_exitrd
must validate the entire manifest before writes: nonempty, unique canonical
relative names, no NUL/traversal, no leaf or ancestor symlink escapes, readable
regular files, executable script/BusyBox, bounded count/bytes and safe destination
ancestors. Preserve modes; don't accidentally materialize applet copies or
host loader paths. Add negative fixtures for each rule, including a missing
script interpreter, duplicate record and empty manifest. Keep 8 KiB/128/32 MiB
limits until actual measured closure justifies a tighter limit; do not enlarge
them to hide packaging mistakes. Derive tmpfs capacity from rounded allocated
payload plus directories, manifest/storage metadata and bounded scratch headroom.

Capture an internal boot-storage record in retained tmpfs after successful
mapping creation: SYSTEM/DATA major:minor, MOS mapping names/devices, loop
major:minor and backing image identities. Validate it against live kernel state
at shutdown; it is an identity hint, not an authority to skip discovery. Partial
startup failure needs the same incremental ownership state for cleanup.

### B3: safe teardown state machine

The observable contract is `entered -> quiesced -> mounts released -> mappings
released -> loops released -> backing filesystems released -> synced -> action`.
Transitions are contingent on fresh observations; actual dependency order can
interleave mount and device release. No log marker by itself is storage proof.

1. Accept exactly reboot, poweroff or halt as argv[1]. Treat trailing known
   systemd logging options as inert metadata and clamp any timeout option to the
   local ceiling. Reject unknown action, malformed arguments or missing /proc
   and /sys state. Do not eval input or default an unknown verb to reboot.
   Require PID 1, chdir to exitrd /, console stdio, and no executable/library,
   working directory or inherited descriptor on persistent storage.
2. Reopen the validated watchdog device immediately; keep one owner. Confirm
   timeout from the actual device/sysfs and the selected platform, not just
   WATCHDOG_USEC. Service it at most every min(1 s, timeout/4), including during
   child operations. Start one absolute monotonic cleanup deadline, proposed
   60 s for the current 120 s reboot watchdog; reject a configuration that
   cannot leave a watchdog margin. A stalled child must not prevent kicks or
   extend the global deadline. Bound individual operations to 5 s and cleanup
   passes to 12, with at most 1 s between passes. Tests inject a clock; no
   environment variable may disable these production limits.
3. Require main systemd to have stopped services and containers. Re-scan residual
   processes and namespaces; terminate only remaining userspace holders after a
   short TERM grace, then KILL and reap. Never kill PID 1, its active helper or
   watchdog owner. A process stuck in uninterruptible sleep or a namespace/FD
   still pinning storage is failure, not evidence that lazy detach worked.
4. Parse /proc/self/mountinfo into mount ID, parent ID, major:minor, root,
   mountpoint, propagation and filesystem type. Parse before decoding escapes
   (040/011/012/134); preserve whitespace/backslashes as one quoted argv, with
   no shell expansion. Reject malformed/cyclic/oversized input, including any
   path the implementation cannot represent safely. Re-read after every
   mutation. Build dependencies by IDs/device identity, not pathname length or
   /oldroot prefix alone. Cover nested/stacked bind mounts, file binds,
   overlay children, moved SYSTEM/DATA/support and aliases outside /oldroot.
5. Make the exitrd namespace recursively private, then snapshot DM holders and
   slaves, MOS names/devices, active loops and /proc/swaps. Include mounts of
   SYSTEM/DATA reached through any alias. Stop recorded swap users before
   backing unmount; an unhandled block layer such as an unexpected MD mapping
   must be named as nonreleased storage. Preserve /dev, /proc, /sys and the
   memory-only exitrd until the last verification.
6. Repeatedly unmount leaf consumers, including container overlay/bind children,
   state file binds and support module/firmware aliases. Use ordinary umount,
   never -l or -f as proof. A busy failure keeps the node in the graph. Move a
   still-needed SYSTEM/DATA backing mount into a pre-created private exitrd
   directory only when necessary to free its parent root; validate its mount ID
   and device before/after. Keep that directory outside the old root. This
   allows /oldroot to disappear while its root loop backing filesystem survives.
7. Remove MOS mappings in holder-first order only when no mount or DM holder
   uses them. Run `dmsetup remove NAME` without --force/--deferred/--retry or
   remove_all, then verify the recorded device has disappeared from sysfs.
   The normal pair is mos-root and mos-support; never rely on dm-N numbering or
   remove a newly reused name. Unexpected holders remain an explicit failure.
8. Detach recorded MOS loops, and any additional loop whose ownership/backing
   filesystem is positively established by the current graph, only after all
   consumers disappear. Use `busybox losetup -d DEVICE`, then verify no backing
   association or holder remains. Successful LOOP_CLR_FD/autoclear scheduling
   is insufficient: the loop must be released before its backing filesystem.
   Missing devices are idempotent only when the graph confirms disappearance;
   reused device identity, ambiguous backing filename or unknown loop is not.
9. Sync and unmount remaining DATA/SYSTEM/boot filesystem mounts after all
   dependent loops, swap and mappings are gone. Re-scan the entire namespace,
   holder graph and loop backing associations; two unchanged empty observations
   establish completion for persistent storage. A readonly remount alone is
   not completion. Temporary API/exitrd mounts may remain. Sync failures/timeouts
   and outstanding dirty I/O prevent the final success state.
10. Emit bounded structured records containing action, source/deployment identity,
    stage, released device/mount IDs and final remaining counts. Only after
    verified storage completion issue the requested kernel action. BusyBox's
    terminal `reboot -f`, `poweroff -f` or `halt -f` may be used solely to invoke
    the kernel from this PID 1; -f is not an alternate teardown path. Never use
    -n to bypass synchronization. A returned syscall/applet is failure. Tests
    need both cleanup evidence and external guest action evidence.
11. On failure, emit `storage-not-released` plus bounded graph/error details;
    never emit the completion/action success record. Continue watchdog servicing
    only within a bounded diagnostic phase, then allow the armed watchdog's
    emergency reset to enforce recovery. Classify such reset as failed graceful
    shutdown. Unknown action similarly cannot select a substitute graceful verb.
    The physical halt/NOWAYOUT interaction needs explicit board evidence: an
    eventual watchdog reset is not permanent halt or successful poweroff.

Reuse this cleanup contract on post-mount mos-init refusal, using partial
ownership state before trial retirement/recovery action. Do not create a second
forced-reboot escape path or change shared-storage recovery into endless trial
consumption. A shared-data/system failure remains a real recovery requirement.
If a shell-only watchdog/child supervisor cannot prove these bounds, B3 reports
that concrete constraint to L2 for a small native helper decision; it may not
weaken the state machine or add an unbounded background watchdog feeder.

Focused negative fixtures must cover: unknown/empty verb; extra options; absent
interpreter/helper; empty or corrupt mountinfo; escaped spaces, tabs, newlines
and backslashes; moved backing mounts; same-path stacked mounts; nested bind
and overlay; missing/reused MOS DM identity; non-MOS holder; DM EBUSY and
failure; loop autoclear still associated; external namespace FD; sync hang;
operation timeout; no progress; graph changing during cleanup; outstanding swap;
watchdog unavailable/EBUSY/short timeout; returned final action. Every failure
must forbid the terminal action and completion marker. Positive fixtures prove
all three verbs, already-released nodes, busy-then-released progress and the
full root/support -> DM -> loop -> SYSTEM sequence. Real namespace/loop/DM and
watchdog behavior must later pass granted QEMU tests; mocks cannot prove it.

### B4: explicit S3 runtime roots and closure fixtures

Use selected local package ownership as input, with one declarative list per
consumer in new `rootfs/runtime/`. Include upstream runtime entrypoints/resources
and generated-state rules; record each transitive retention reason. Do not
select the whole Debian base or every installed package file by default.

| Runtime root family | Required concrete entrypoints and non-ELF surface |
|---|---|
| mos-system/main init | /sbin/init -> systemd, systemctl, systemd-shutdown for the main transition, udevd/udevadm, kmod/modprobe, selected units/wants/generators, tmpfiles/sysusers definitions and generated configuration. Keep runtime /run/udev and selected rules/helpers; no static hwdb. |
| Storage/lifecycle | /usr/bin/mos-deploy; /usr/lib/mos/mos-data-layout, mos-grow-data, seed-state/var/home/root, shadow-reconcile, provisioning-import, health and boot-failure; every command their scripts call. Keep mount/umount/findmnt/blkid/losetup, ext4 growth/check tools, quota/chattr/setquota and boot-record helpers actually selected. Include every immutable bind destination, /var template and protected state mount unit. |
| Accounts/recovery/SSH | /bin/bash and /bin/sh interpreter chain, GNU coreutils/tar/find/grep/sed/awk and retained tooling; login/agetty, passwd/chage and unix_chkpwd; sshd, host-key generation, ssh/scp/SFTP/ssh-agent and actual helpers. Preserve PAM include chains, NSS configuration/modules, passwd/group, factory locked shadow, account shells, sudo-free policy and authenticated tty2. |
| Network/time/trust | networkd, resolved, timesyncd, ip, nft and iptables alternatives; curl/HTTPS, CA bundle and certificate links, OpenSSL providers, NSS DNS resolution, D-Bus policy/activation, netbase files and timezone/localtime. Keep LDAP/GnuTLS/PAM/SASL branches when selected callers require them. |
| Selected mosd/apid/MQTT | Package-owned executables, units, D-Bus interfaces/policies, compiled-in dynamic helper declarations and generated release/public defaults. Dependencies outside this B0 allowlist need a narrow source handoff if declarations prove incomplete; do not guess away helpers or inspect UI. |
| Selected containers | Podman, Quadlet/generator, crun, conmon, catatonit, netavark, aardvark-dns, nft, selected configs and unit dependencies. Preserve /mos/containers/storage, tmp and networks policy plus /run storage; test real DNS/bridge/namespace operations. |
| Selected board/radio/components | Package-owned hwinit programs/units, udev rules, Wi-Fi/AP, Bluetooth and audio helpers where selected, radio configuration and their interpreters. Firmware/modules/indexes belong to the signed support component and mount closure, not copied into the root. Preserve board console/logind/preset and logo/DTB inputs in their actual component. |
| Generated/identity/legal | release-identity.env, selected public metadata/trust references, licenses/source records, CA outputs, ld.so.cache, alternatives/link graph, service enablement/masks, empty /etc/machine-id, DBus machine-id/random-seed links, tmpfiles mountpoints, factory shadow and account metadata. No host keys, package databases, build caches or randomized seeds ship. |

Closure validation must handle ELF class/machine, PT_INTERP, recursive DT_NEEDED,
target loader search ordering and RUNPATH/RPATH including $ORIGIN where present.
Fail on unresolved/ambiguous dependencies or host fallback. Follow shebangs
recursively, including /usr/bin/env with an explicit selected PATH contract;
reject interpreter loops, absent commands and unsupported env options. Script
static scans are hints: explicit subprocess declarations and behavior tests
cover variable command names, dlopen, PAM/NSS, systemd generators, udev PROGRAM,
D-Bus activation and TLS providers that ELF metadata cannot discover.

Preserve numeric uid/gid/mode, executable bits, setuid/setgid, symlink chains,
hardlink groups and all required xattrs including security.capability through
selection, scratch COPY, OCI export and SquashFS. Validate read-only-root links
against their staged target root; runtime links such as /run/resolve state,
/mnt/data/state/random-seed and /etc/shadow may be deliberately unresolved only
with a named generator, mount ordering and first-boot test. No blanket broken
symlink exemption. Reject path escapes, source/destination ancestor links,
symlink cycles, unsupported node kinds and ambiguous provenance.

Positive fixture: tiny amd64/arm64 ELF pair plus recursive library and loader,
script/interpreter, declared dynamic helper/module, included PAM/NSS config,
generated file, valid absolute/relative links, a hardlinked pair and a file with
capability/xattr. Assert exact selected paths, bytes, metadata and reasons.
Mutation fixtures remove one interpreter/library/helper/PAM module/NSS module,
config/generated file/license/mountpoint at a time; change architecture, execute
bit, ownership, hardlink relation or capability; inject escaping/cyclic links;
leave an unresolved runtime link without its generator; select a feature without
its list; add an unselected feature payload. Each must fail with its own reason.
No fixture may pass by skipping xattr/architecture checks unsupported by its host.

### B5: scratch composition, S6 provenance and measurements

Preserve current offline install/configuration first. Capture package ownership,
archive hashes and generated-file origin before the dpkg purge. Finish existing
required transformations in their present order, then select into an empty
runtime destination before measurement/packing. Change 90-pack's packing and
factory-root export to consume that selected destination; ensure every copied
file is selected and every selected file copied. Keep boot/support separate and
bind-mount directories present. Remove a destructive prune only when selection
fully owns its exclusion; never run package configuration inside the final root.

Extend the existing rootfs report and package/release records rather than invent
an independent inventory authority. Preserve installed-input inventory externally;
make shipped-package inventory reflect actual retained payload contributors.
Record per shipped path: selected consumer/reason, source archive/package or
local generated rule, original digest, transformations, final digest, type,
mode/uid/gid, symlink target, hardlink group and required xattrs/capabilities.
Reconcile stripped binaries with matching build-id debug exports; record the
kernel/support component identities and their module indexes separately.
Reject any retained path with no origin and any selected feature with no payload.

| Measurement | Required method and boundary |
|---|---|
| Input identity | Exact source commit and clean/dirty state, board/arch/profile/features, source date epoch, image/tool digests, upstream/local archive hashes and versions, BusyBox source/config, trust-key IDs, component descriptors and public artifact SHA-256. Never log private keys. |
| Root unpacked data | Final selected root regular-file sum once per device:inode; also report naive sum, inode count, symlink count and per-family union sizes. Do not sum overlapping families or hardlink aliases twice. Separate apparent bytes from st_blocks*512 allocated bytes and directory metadata. |
| Packaged root | factory-root OCI digest/bytes and layer identities, SquashFS bytes/hash, full verity image bytes/hash/root hash/geometry. Bind the OCI/extracted tree to the same actual packed artifact rather than infer identity from checkout version. |
| Startup archive | Uncompressed cpio bytes/hash and unpacked unique-file payload; compressed container bytes where compression exists. Include retained exitrd's embedded copy in archive accounting, but don't add it twice to a total. Record loader aliases/hardlinks explicitly. |
| Retained exitrd | Unique regular data, all inode/page allocation, manifest bytes and temporary working allocation after copy. Read the actual /run/initramfs filesystem usage/inodes in the guest and kernel page size; 36 MiB is capacity only. Report peak temporary allocation during shutdown separately. |
| Startup memory/time | Existing `metrics.py` reports mos-init-only VmHWM and elapsedMs. Keep that scope. Also measure tool children/process-tree peak separately without adding nonconcurrent peaks, boot wall time and retained tmpfs pages; do not label RSS as total early-boot RAM. Record instrumentation overhead and repeated-run spread. |
| DATA/SYSTEM IO | Existing storage-metrics.py counts sampled SYSTEM/ESP filesystem usage and guest block sectors, not physical amplification. Add DATA staging observations and final A/B path inventory for current acquisition. Distinguish sampled peak from guaranteed maximum; no physical wear/power-cut claim. |

`tools/measure-rootfs.sh --board BOARD` needs a safe unique output/artifact input
mode before reuse here; its current entry deletes a fixed directory. Do not run
it against a stale `_out/BOARD` and stamp results with a newer checkout. Retain
source/input metadata and measured outputs together, with evidence filenames
outside tracking docs and no extra repository summary file.

Historical values, not B0 measurements: the 2026-09-10 03:41 feasibility plan
records ARM64 cpio 33,615,872 bytes; exitrd 20 regular files/17,253,688 bytes;
dmsetup closure 4,765,416 bytes/10 paths. It does not identify an artifact hash
sufficient to match a current build, so these are sizing context only.
PLAN-086's 2026-09-07 cx3576/virt-arm64 data (385,524,283/435,604,278 unique
regular bytes) and later S2 deltas describe historical layouts including retired
components. No current size reduction, RSS delta or byte-identical build is
claimed by B0. Current observations are source contracts and the gates below.

### B6: PLAN-913/RFCT-921 residual cold-build variance

The historical aux-cache producer and optional-cache reasoning remain useful;
its old location, EPHEMERAL narrative, build-v2 bridge, live-unpinned runtime apt
assumption and old x64 generated-initrd variance do not define current work.
Current root userland is locked by JSON archives; 90-pack's pack-tool apt layer
and the existing main-root BusyBox harvest still resolve package downloads
without a per-package source snapshot. Capture their actual resolved versions
and hashes when proving equal inputs. A base image digest alone does not pin
those later network transactions.

Minimum remaining source work:

1. Add positive/negative source and packed-root checks for absent
   /var/cache/ldconfig/aux-cache and the retired factory-var copy, while retaining
   /etc/ld.so.cache, ldconfig and valid generated/writable-state policy. No
   duplicate removal is needed. The current plain rm fails if S3 already omitted
   the file; B5/B6 must choose one exclusion owner and test both cache-present and
   already-absent inputs before making that removal idempotent or obsolete.
2. `rootfs/build.sh:514-558` invokes `build/run.sh --build-rootfs` without a
   no-cache option. `build/src/stages-cli.ts` already parses --no-cache and
   stages.ts forwards it to the build, intentionally not the OCI export.
   Add an explicit validated `MOS_ROOTFS_NO_CACHE=1` bridge here, default off,
   with a wrapper argv fixture; do not create or patch build-v2.sh.
3. `build/src/compare-roots-cli.ts` explicitly ignores mtime; its default
   dual-build sanctions allow intentional differences. A cold-build proof must
   not use those as exemptions. Compare equal trees with zero allowed changes,
   covering normalized mtime, all xattrs, hardlink relationships and packed
   bytes in addition to the existing content/type/mode/ownership/capability
   comparison. Do not "fix" its old aux-cache proof-material comment in B0.

Minimum expensive proof after a specific L1 grant: two independently uncached
current rootfs builds for one explicitly named board (s905x5m only after its
current producer selection is committed), same approved source and frozen
inputs/tool identities, disjoint owned output areas, no daemon cache pruning.
Archive each complete output before the next run. Require identical final path
metadata/content, selected-package/provenance records, SquashFS SHA-256, complete
verity image SHA-256 and VERITY_ROOT_HASH. Extract exactly SQUASHFS_BYTES, compare
normalized file times, links and xattrs as well as bytes. If inputs drift, report
input drift; if equal inputs produce a difference, name every differing path
and generation stage. No newly differing path is implicitly sanctioned.

The current signed initramfs is independently assembled by mos-boot with sorted
cpio/timestamps. Compare that current artifact separately; the retired distro
initrd inode/mtime observation cannot be carried forward as a current failure.
At least one-board proof closes the specific reproducibility experiment, not
all-board reproducibility. B7 must carry unbuilt architectures/boards as pending.
No cold build or remote build-host access is authorized to B0.

### Downstream file and check map

Every `new` path/command below is proposed and does not exist yet. L2 provides
its owning L3 with this committed plan and only the named direct call chains.
All behavioral nodes establish meaningful RED first, then minimal GREEN.
Long checks run in the worktree's persistent-shell tmux with command, source
commit, UTC time, log and exitCode metadata. Build/guest jobs need explicit
L1 grants relayed by L2; source fixtures do not consume a build grant.

| Node | Precise proposed changes | Focused checks and required acceptance |
|---|---|---|
| B1 BusyBox packaging | `pkgs/mos-boot/Dockerfile`, `initramfs.sh`, `elf-closure.py` only as needed; new `busybox.config`, source pin file and packaging fixture under `pkgs/mos-boot/`; new `tests/boot-userspace-test.sh`. Preserve bootloader tools and main-root BusyBox producer. | New `timeout 120 bash tests/boot-userspace-test.sh`: missing applet, wrong ELF machine, dynamic early BusyBox, absent script/interpreter, unwanted retained systemd closure, manifest/content mismatch; positive exact payload and reproducible manifest. `bash -n pkgs/mos-boot/initramfs.sh`; `timeout 120 make os-shell-pipefail-lint`. Exact target binaries/ELF closure checks require granted package production, not a root/kernel build. |
| B2 startup adapter | `pkgs/mos-deploy/src/bin/mos-init.rs`, `src/boot.rs`, `tests/boot.rs`; introduce testable command construction/loop validation without replacing signature policy. Coordinate storage record with B3. | In the existing pinned Rust gate container: `timeout 120 cargo test --locked --manifest-path pkgs/mos-deploy/Cargo.toml --test boot`; new argv/race/empty-loop/read-only/manifest tests RED then GREEN. Relevant `pkgs/mos-deploy/hack/check.sh` through existing gate runner; no global Rust install. Granted full-image boot proves move/switch-root and signature/fallback behavior. |
| B3 safe shutdown | New `pkgs/mos-boot/shutdown.sh`, `tests/boot-shutdown-test.sh` and fixture inputs; B1 packaging integration; shared cleanup/partial-boot ownership in mos-init/boot.rs; update `tests/file-ab-x64/shutdown-check.sh` with new `shutdown-check-test.sh`. | New `timeout 120 bash tests/boot-shutdown-test.sh` and `timeout 120 bash tests/file-ab-x64/shutdown-check-test.sh`; shell syntax/lint and B2 Rust gates for changed Rust. Prove all negatives above forbid action, and all supported verbs release storage. Granted guest tests verify real mounts/DM/loop, watchdog and QMP outcome, not wording alone. |
| B4 runtime selection/closure | New `rootfs/runtime/` consumer lists and selector/metadata module; new `build/src/runtime-closure.test.ts`; reuse semantics of `verify/src/checks-root.ts`; new `verify/src/checks-runtime.ts`/`.test.ts` plus registration in `verify/src/checks.ts`. Read only selected producer controls and direct script/helper call chains as lists require. | `timeout 120 make os-rootfs-manifest-test`; new `timeout 120 bash build/run.sh src/runtime-closure.test.ts`; new `timeout 120 bun test --cwd verify src/checks-runtime.test.ts`; ELF/shebang/dlopen/PAM/NSS/generated-state/link/metadata mutation matrix above. All legal selected sets retain S5 tools and board features. |
| B5 scratch/provenance | `rootfs/compose/10-compose.Dockerfile` ownership capture, `compose-install.sh`, `90-pack.Dockerfile`, new `rootfs/runtime/compose.sh`; `rootfs/build.sh`, `tools/measure-rootfs.sh`, `build/src/release-manifest.ts` and related tests only where connecting the existing inventory; `tests/file-ab-x64/metrics.py`/storage metrics. | New `timeout 120 bash tests/runtime-compose-test.sh` and `timeout 120 bash tests/rootfs-measure-test.sh`; `timeout 120 bash build/run.sh src/release-manifest.test.ts`; relevant `timeout 120 make os-verify-test` / `os-build-test`. Assert provenance completeness, cross-stage metadata and inode accounting on fixtures. Real pack/OCI/capability roundtrip and measured artifacts require grants. |
| B6 residual variance | `rootfs/build.sh` no-cache bridge; `pack-tree-surgery.sh` only the selection interaction above; `verify/src/checks-file-root.ts` and `.test.ts`; new `tests/rootfs-cold-build-test.sh`; comparator tests/module only for strict cold equality. | New `timeout 120 bash tests/rootfs-cold-build-test.sh`; `timeout 120 bash build/run.sh src/stages.test.ts src/compare-roots.test.ts`; `timeout 120 bun test --cwd verify src/checks-file-root.test.ts`. Two cold current builds and strict image comparison only after named L1 grant. |
| B7 integrated acceptance | Current `tests/file-ab-x64/{runtime-build,boot,runtime,updates,acquisition,reset,offline-clock,early-hang,kernel-faults,shutdown-check}.sh`, qmp-boot.py and metrics; new `tests/file-ab-x64/lifecycle.sh` plus output-validator fixtures; current FIT wrappers for board evidence only. | New `timeout 120 bash tests/file-ab-x64/lifecycle-test.sh` validates evidence and rejects false success; existing focused package/build/verifier and docs gates. Grant-only runs: runtime-build inputs -> boot/QMP -> updates/acquisition/reset/negative boot -> new lifecycle.sh evidence-directory board. Exact build commands, image hashes and time budgets are selected in the grant, never guessed. |

B7 matrix: x64 and virt-arm64 current full signed images; normal boot and second
boot; signature/corruption refusal; wrong support release/DATA disk; root-only,
kernel-only and combined updates; three attempts and fallback; shared-storage
recovery; actual reboot/poweroff/halt; partial-init cleanup; startup and shutdown
watchdog failures; whole-var persistence/quota; unlimited system/user/container
bytes and inodes; private bind/reset isolation; authenticated SSH/SFTP/tty2;
DNS/time/TLS/MQTT and real container network operations when selected. Require
API reboot entrypoint acceptance from its owner without modifying UI. No hidden
skip can stand in for one of these selected-feature rows. Physical CX3576 and
S905X5M boot, presentation, devices, reset/power-cut and halt/watchdog evidence
remain separate from cross-build/QEMU/fixture evidence.

### #313 handoff and ownership boundaries

B0 has not read #313 issue/source and does not know its final changed-path list.
Do not claim an overlap resolved without that list. Concrete overlap candidates
from the charter and current source are `pkgs/mos-deploy/src/bin/mos-init.rs`
(boot log/command timing/watchdog), `pkgs/mos-boot/{initramfs.sh,kernel.sh,fit.sh}`
(boot arguments/retained payload), board kernel/DTB/logo production under
`boards/cx3576/bsp/`, `boards/cx3576/overlay/etc/systemd/logind.conf.d/50-mos-console.conf`,
`boards/cx3576/overlay/usr/lib/systemd/system-preset/50-mos-getty.preset`, and
`tests/file-ab-x64/{early-hang-init.sh,boot.sh,metrics.py,shutdown-check.sh}`.
The early-hang injector currently matches a literal mos-init log line, so an
approved logging change can invalidate the fixture even without boot behavior
changing. Do not silently restore obsolete logging to satisfy it.

L1 must provide an approved committed #313 SHA and changed paths through L2
before affected B1-B3/B7 edits or final artifact production. Apply only the
explicit upstream merge named in each downstream dispatch; never read live
main or contact #313. Source-fixture development outside those hunks can use
this baseline, but timing/RSS, kernel/DTB/logo identity, tty2 authentication,
watchdog and final lifecycle acceptance must be rerun against the approved
integrated source. Unchanged mock results are not source-handoff proof.
B4/B5 need the final selected board/radio/component package inputs; absence in
this baseline (including a s905x5m package manifest) is a handoff dependency,
not permission to implement another board resolver or drop a selected feature.

## Verification

B0 executes only the three requested documentation/source-fixture gates and
own-document validation. Product behavior is unchanged; RED/GREEN is not
applicable to this node. Logs and source/command/time/exitCode metadata are at
`/tmp/mos-b0-gates.NG7mgE/`; persistent shell session `e06h4k7c-80fa09`.

- `timeout 120 make docs-verify`: exit 0; index 195/195, links 506/506,
  status 718/718, translation coverage 249/249, board dossiers 118/118.
- `timeout 120 make docs-verify-test`: exit 0; all fixture suites pass.
- `timeout 120 make os-rootfs-manifest-test`: exit 0; 41/41 checks,
  17 declared/reachable packages, 192 resolutions, 6 refusals.
- No missing-link baseline failure was observed. B0 does not repair other
  task/plan records or global indexes/changelog. Own record links, index
  uniqueness, status/owner consistency and diff scope are checked separately
  because the broad docs gate does not validate task/plan links.
- No new archive size, runtime allocation, RSS, cold-build or physical evidence
  was produced. Expensive build grant remains zero; no gate was silently skipped
  and labeled passed. B1-B7 source checks are proposed, not B0 executions.

## Risks

Shell teardown can mishandle mount escapes, device reuse and deadline/watchdog
ownership. B3 must prove the negative paths before replacing systemd-shutdown's
retained closure. Main systemd's binary still belongs in the main runtime.
S3 closure inferred solely from ELF misses authentication and on-demand helpers;
static fixtures plus selected-feature operations are both needed. Artifact
identities, filesystem allocation and process RSS are different measurements.
A two-build comparison with moving apt inputs is not a reproducibility proof.

## Scope

B0 changes only its unique task and plan detail files and scoped index rows.
No source implementation, existing status edits, changelog reconciliation,
upstream merge, push, publish, issue transition, new executor or expensive job.
D owns final campaign/global index and changelog reconciliation. Remaining work
is explicitly B1-B7; B0 completion cannot close PLAN-086, PLAN-913, RFCT-921 or
any #313 task.

## Alternatives

Retaining systemd-shutdown until B3 passes is the safe staging order, not a
second supported final implementation. A small native helper may be necessary
if BusyBox shell cannot enforce watchdog/deadline or mount parsing correctly;
its concrete need must be returned to L2 before widening scope. Replacing
systemd/PAM/GNU tooling or adding a compatibility shell boot policy is outside
the approved work and offers no shortcut through selected-feature acceptance.

## Annotations

- 2026-09-10: Prior user approval recorded; B0 starts independently from the
  specified committed baseline. No implementation approval question is pending.
- 2026-09-10: Keep this completed B0 design and task for the required L2/D
  handoff, despite the historical index deletion convention. Task transitions
  use the skill serializer; plan follows its draft/implementing/completed
  format. The serializer supports tasks only, as documented by its usage.

- 2026-09-10: B0 audit/design completed; pma-cr local review PASS with no findings. B1-B7 remain separate delivery work.
