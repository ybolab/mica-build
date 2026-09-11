# 20260910-0341-minimal-boot-shutdown Shrink the retained shutdown payload with a purpose-built mos-shutdown

- **status**: draft
- **createdAt**: 2026-09-10 03:41
- **revisedAt**: 2026-09-11
- **approvedAt**: (pending)
- **relatedTask**: [20260910-0338-minimal-boot-shutdown](../task/20260910-0338-minimal-boot-shutdown.md)

## Context

The user asked whether minimal BusyBox environments could serve both shutdown
and startup. This is a feasibility proposal, not an approved implementation.
Replacing these tools crosses packaging, authenticated init and acceptance tests
and therefore uses the full PMA tier. Preserve concurrent board repairs.

**This record was revised on 2026-09-11.** The measurements below did not change,
but two of them were re-read against the question they actually answer, and the
answer inverts the original proposal. The BusyBox direction is now recorded under
*Alternatives* with the measurement that rejected it. See *What the revision
changed* for the reasoning, so a reader of the original does not have to
reconstruct it.

`pkgs/mos-boot/initramfs.sh` currently copies `mos-init`, util-linux tools,
`veritysetup`, `dmsetup` and their ELF dependencies. It also embeds a second
closure containing `systemd-shutdown`, retained at `/run/initramfs` by
`pkgs/mos-deploy/src/bin/mos-init.rs`. Startup currently uses the Rust program
as PID 1; it does not run systemd inside the initramfs.

### What is actually resident

The integrated ARM64 archive measures 33,615,872 bytes and unpacks to 49 regular
files totaling 33,605,549 bytes. It splits into two halves with different costs:

| Half | Files | Bytes | Lifetime |
|---|---|---|---|
| Startup tools | 29 | 16,351,861 (15.59 MiB) | released at `switch_root` |
| Retained exitrd | 20 | 17,253,688 (16.45 MiB) | resident for the whole uptime |

`switch_root` removes the old root recursively, so the startup half is a boot
peak and not a standing cost. **The exitrd is the only part that occupies RAM
after boot**, and these appliances carry no swap, so its tmpfs pages are
resident rather than reclaimable. The current 36 MiB tmpfs setting
(`pkgs/mos-deploy/src/bin/mos-init.rs`) is a limit, not a measurement of
allocated RAM.

### What the exitrd is made of

Of the 20 retained files, the executable that systemd actually pivots into is
`shutdown` at **67,928 bytes**. The other 19 files are its shared-library
closure at 17,185,760 bytes — **99.6% of the retained payload is libraries for a
68 KB program**. Three of them dominate:

| File | Bytes | Share of exitrd |
|---|---|---|
| `libcrypto.so.3` | 6,302,952 | 36.5% |
| `libsystemd-shared-257.so` | 4,536,888 | 26.3% |
| `libc.so.6` | 1,716,616 | 9.9% |
| (these three) | 12,556,456 | 72.8% |

In the exitrd role that program performs four kinds of operation: `umount`,
`LOOP_CLR_FD`, `DM_DEV_REMOVE` and `reboot(2)`. Each is a direct syscall or
ioctl. `libcrypto` and `libsystemd-shared` are linked for capabilities
`systemd-shutdown` carries in its other roles and does not exercise here; they
are 62.8% of the resident payload and contribute nothing to teardown.

For scale, `mos-init` — a Rust program in this same archive that does strictly
more work than a shutdown binary would, including envelope signature
verification and A/B record handling — is 1,361,744 bytes.

### Why BusyBox does not reach the target

An ELF dependency walk over the same archive finds the existing ARM64 `dmsetup`
closure is 4,765,416 bytes across ten paths, including both loader paths copied
by the current closure builder. BusyBox has no `dmsetup` or `veritysetup`
applet, so a BusyBox exitrd must carry that closure unmodified. **4,765,416
bytes is therefore the floor of the BusyBox route**, before the BusyBox binary
itself.

The original version of this record set exactly this trigger under
*Alternatives*: consider a custom static executable "only if the measured
BusyBox-plus-dmsetup size misses an agreed budget". The measurement is in hand
and the trigger is met — see *What the revision changed*.

The local BusyBox 1.37.0 help was inspected without invoking any mount, loop or
shutdown operation. Its `blkid` lacks the current `-t PARTUUID=... -o device`
contract, and its `losetup` uses different options from the current
`--read-only --find --show` call. Merely replacing executable paths would break
boot. This is why the startup half leaves this record's scope entirely: the
startup tools are released at `switch_root`, so replacing them buys no resident
memory, while the argument-contract risk above is real.

`mos-init` verifies the signed deployment and its selected identity, requires
kernel dm-verity signatures, opens signed root/support mappings, validates DATA
belongs to the system disk, handles failed boot records and arms the watchdog.
These responsibilities are not supplied by BusyBox applets.

The ARM64 acceptance log at
`.tmp/strict-ab-checkout/_out/file-runtime.mXNi8a/boot/updates/7/boot.log`
shows the storage dependencies remaining busy before the exitrd transition and
all filesystems, loop and DM devices detached afterward. Preserve this outcome.
That log is build residue outside version control; re-derive the evidence from a
fresh run rather than treating this path as durable.

Primary references:

- [systemd initrd interface](https://systemd.io/INITRD_INTERFACE/):
  `/run/initramfs/shutdown` may be a custom executable; systemd pivots into its
  environment and passes the shutdown verb followed by optional arguments.
- [BusyBox manual](https://busybox.net/downloads/BusyBox.html): configurable
  applets provide reduced command interfaces. Retained as the reference for the
  rejected alternative.

## What the revision changed

The original proposal replaced both halves of the archive with BusyBox. Three
readings of the existing measurements changed the direction; none of them
required a new build.

1. **The startup half is not resident.** It is released at `switch_root`.
   Shrinking it changes a boot peak, not steady-state RAM, so it does not serve
   the goal and it carries the argument-contract risk above. Removed from scope.
2. **The retained payload is a library closure, not a program.** 99.6% of it is
   dynamic dependencies of a 68 KB binary, and the two largest are unused in this
   role. The size problem is the linkage, so the fix is to remove the linkage
   rather than to swap the program for a different dynamically linked one.
3. **Closing a verity mapping needs no device-mapper library.** Unlike LUKS, a
   verity target holds no key material to tear down; `veritysetup close` reaches
   the kernel as a generic `DM_DEV_REMOVE` ioctl. The `dmsetup` closure that
   sets the BusyBox floor at 4,765,416 bytes is therefore not a fixed cost of the
   job — it is a fixed cost of that route only.

The BusyBox direction is preserved under *Alternatives* with the measurement
that rejects it, so the option is not silently dropped.

## Proposal

Replace the retained `systemd-shutdown` closure with **one purpose-built
executable carrying no shared-library closure**, and leave startup unchanged.

1. **Startup is out of scope.** `mos-init` stays PID 1 with its authenticated
   boot policy, its util-linux invocations and its existing closure. No BusyBox,
   no argument-contract changes, no new startup failure mode.
2. **Add `mos-shutdown`**, a Rust executable implementing the systemd initrd
   shutdown interface: it receives the verb (`reboot`, `poweroff`, `halt`,
   `kexec`) as its first argument, releases remaining mounts in dependency order,
   removes the mos DM mappings, detaches their loops, unmounts the backing
   SYSTEM filesystem, syncs, and performs the requested action. It performs these
   through direct syscalls and ioctls, linking no device-mapper, crypto or
   systemd library. It re-reads mount state for nested and moved backing mounts,
   uses bounded retries, and prints explicit failure output. It never reports a
   lazy unmount or a deferred DM removal as successful teardown. It keeps the
   armed watchdog satisfied across the transition, or completes within its
   timeout; state which, and prove it.
3. **The exitrd becomes one file.** `pkgs/mos-boot/initramfs.sh` stops building
   the second ELF closure and emits `mos-shutdown` alone; the `copy_exitrd`
   manifest contract in `pkgs/mos-deploy/` narrows accordingly. Re-derive the
   `/run/initramfs` tmpfs budget from the measured payload with documented
   headroom. Remove the replaced packaging assertions and dependencies together,
   keeping one current implementation with no old path.

The linkage mechanism — a musl target, or glibc with `+crt-static` — is an
implementation decision. The binding requirement is that the exitrd manifest
lists exactly one regular file; record which mechanism was chosen and why.

Conceptual contents, not an implemented directory listing:

```text
Startup:  mos-init + blkid + losetup + veritysetup + dmsetup + required libraries   (unchanged)
Shutdown: mos-shutdown                                                              (one file)
```

## Verification

- Before implementation, add failing acceptance checks for the retained payload
  contract and the required shutdown results. The existing ELF-only/no-shell
  assertions in `pkgs/mos-boot/initramfs.sh` must change intentionally to a
  single-file exitrd manifest assertion.
- **Rewrite `tests/file-ab-x64/shutdown-check.sh` to assert state, not wording.**
  It currently greps `systemd-shutdown`'s exact sentence, `All filesystems,
  swaps, loop devices, MD devices and DM devices detached.`, which any
  replacement makes red for the wrong reason. Assert the outcome instead: no
  loop device remains attached, no mos DM mapping remains under
  `/sys/class/block`, and the backing filesystem is unmounted. A check that
  passes on the message rather than the teardown has never tested the teardown.
- Prove the teardown is real by mutation: with one of the release steps removed,
  the rewritten check must go red. A gate whose removal changes no result is not
  binding the behaviour it names.
- Run x64 and virtual ARM64 signed boot, signature/corruption refusal,
  deployment selection, component upgrades, three-trial fallback, normal
  shutdown and actual reboot. Check clean storage release and completed guest
  actions.
- Build a newly signed CX3576 FIT/image with the current board repairs; run
  offline signature, layout and growth checks. Verify cold boot, apid reboot,
  poweroff and watchdog behavior on the local board when it is available.
  Do not count QEMU or image inspection as physical acceptance.
- Compare uncompressed archive bytes, retained file payload, mounted tmpfs
  allocation and startup peak RSS on both architectures, against the baselines
  recorded above. **No size claim before measurement**; in particular, do not
  quote a predicted `mos-shutdown` size in this record until one is built. The
  budget it must beat is the BusyBox floor of 4,765,416 bytes, and the payload
  it replaces is 17,253,688 bytes.
- Run the relevant Rust, packaging, shell and documentation gates.

## Risks

Reimplementing teardown means reimplementing its ordering, and the exitrd
receives a mount topology systemd has already transformed; nested mounts, moved
backing mounts and a busy SYSTEM filesystem are the cases that will be wrong
first. A forced final reboot by itself does not prove storage teardown, which is
why the state-based check and its mutation test are prerequisites rather than
follow-ups. Watchdog timeouts must remain bounded across the transition. The
main filesystem and firmware signature contracts must remain intact. `mos-init`
is untouched, so no startup failure mode is introduced by this change.

## Scope

`pkgs/mos-boot/` exitrd construction, the `copy_exitrd` manifest contract in
`pkgs/mos-deploy/`, the new `mos-shutdown` binary, and the relevant
build/boot/shutdown tests. Record the delivered measurements in this record.
No startup tooling replacement, no board driver cleanup, no main-system init
replacement, no partition change, no compatibility layer or migration.
Coordinate overlap with the separately owned CX3576 boot-log investigation.

## Alternatives

- **BusyBox for the exitrd — measured and rejected.** BusyBox supplies no
  `dmsetup` or `veritysetup` applet, so this route carries the existing dynamic
  `dmsetup` closure of 4,765,416 bytes plus the BusyBox binary. That floor is
  roughly 3.5× the size of `mos-init`, a Rust program doing strictly more work,
  and it buys a shell script where the proposal has a compiled program. The
  original record made this option conditional on the measured size missing an
  agreed budget; the measurement is above and the condition is met.
- **BusyBox for the startup half.** Rejected on a different ground: that half is
  released at `switch_root`, so it is not resident, and BusyBox's `blkid` and
  `losetup` argument contracts differ from the current invocations.
- **Rebuilding a minimal `systemd-shutdown`** retains its validated teardown
  implementation and trades the reimplementation risk for build-configuration
  work against Debian packaging. It is the fallback if the teardown ordering in
  the proposal proves harder to get right than estimated; it cannot reach a
  one-file exitrd.
- **Removing the exitrd entirely** is only available if the root stops being
  file-backed, since a partition root leaves no loop device or DM mapping to
  release. That requires abandoning LAYOUT_VERSION 3 signed file deployments and
  is a product-level decision, not a size optimisation. Out of scope here, and
  noted so this record is not read as having considered and rejected it on size.

## Annotations

The feasibility assessment is complete. Implementation approval is pending.
All tests use newly built complete system images; no compatibility is required.
