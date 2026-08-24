# PLAN-013 The x64/QEMU verification vehicle: a whole-system check, an apid API suite, and the cx3576 back-port

- **status**: proposal
- **createdAt**: 2026-08-24 09:10
- **approvedAt**: -
- **completedAt**: -
- **relatedTask**: -
- **milestones**: M1 the x64 image verified statically and at runtime; M2 the apid API test suite, driven over the wire against the booted device; M3 the back-port — cx3576 rebuilt and re-verified against the generalised scripts

## Context

The x64/QEMU board arrived inside PLAN-012 to settle two container questions
the arm64 build cannot answer — whether a container actually starts, and
whether `containers.conf`'s values take effect — and it grew, uncommitted, into
a second full board: `os/layout/x64-v2.env`, `os/mkimage-x64.sh`,
`os/rootfs/overlay-x64/`, `os/rootfs/initramfs/`, `os/boot/x64-grub.cfg`, and a
QEMU harness of three scripts. `os/rootfs/build-v2.sh` is now board-parameterised
end to end, `os/rauc/system.conf.in` takes its bootloader from the layout, and
the cx3576 layout has grown `BOARD_CMDLINE_ARGS`, `RAUC_BOOTLOADER` and
`BOARD_SIZE_BUDGET_MB` so the two boards differ in a file rather than in a
script.

None of it is committed, none of it has a task record, and the parts that
verify it are the parts that did not get generalised with it.

### What is already true, measured today

- **The x64 image boots, all the way through, and shuts down cleanly.**
  `/tmp/qemu-f4.log` (2026-08-24 04:34) is a full run: OVMF → GRUB → kernel →
  verity root → `mosd`, `apid` and `mos-mqttd` started, then an ACPI power
  button and an orderly shutdown with every filesystem unmounted. No failed
  unit. The only red in 983 lines is `regulatory.db` missing (no WiFi
  regulatory database on a machine with no WiFi) and `systemd-ssh-generator`
  exiting 1.
- **The Rust workspace is green**: `cargo test --workspace`, 20 test binaries,
  0 failed.
- **`_out/cx3576/cx3576-mos-v2-latest.img` predates the shared changes.** It
  was built 2026-08-23 19:51; `os/rootfs/build-v2.sh`, `os/rootfs/Dockerfile.v2`,
  `os/rauc/render-config.sh` and the layout file were all edited after it. No
  cx3576 image has been built from the current tree.

### Three defects found while establishing that baseline

1. **`MOS_BOARD` did not survive the verifier's container re-exec.** On a host
   missing any of `unsquashfs`, `veritysetup`, `sgdisk`, … `os/verify-image-v2.sh`
   re-execs itself inside Alpine. It passes `BOARD_DIR` and
   `MOS_EXPECT_DEV_KEYRING` through and not `MOS_BOARD`, so
   `MOS_BOARD=x64 os/verify-image-v2.sh` checked the x64 image against
   cx3576's eleven-partition GPT and reported **191 failures, every one of them
   the harness's own**. This is the failure mode the comment two lines above the
   `docker run` warns about for the dev keyring — "green on a tool-ful host and
   red on a tool-less one" — arriving through the variable that comment does
   not cover. Already fixed in the working tree; it is what made the rest of
   this plan legible.

2. **`os/qemu-journal.sh` cannot ever work.** Its header says "The journal is
   on the EPHEMERAL partition, which is a real partition in the disk file, so
   it survives the guest being killed." It does not. `os/rootfs/Dockerfile.v2`
   writes `/etc/systemd/journald.conf.d/00-volatile.conf` with
   `Storage=volatile`, and the Dockerfile asserts that setting at build time —
   the journal lives in `/run/log/journal` and never lands on disk. Read
   directly out of the EPHEMERAL partition of the disk the last run left
   behind: `/var/log/journal` exists, is mode 42755, and is **empty**. The
   script does not report that honestly either — its own "no /var/log/journal"
   guard passes, because `debugfs rdump` creates the directory it looked for,
   and the failure surfaces as journalctl's `No journal files were found.`
   The tool that the harness offers for reading a failed unit's reason returns
   nothing, from a check that says the guest is at fault.

3. **The package manager's *logs* survive its removal.** RFCT-099 took apt and
   dpkg out of the packed root and RFCT-100 moved it to Debian 13; the seeded
   `/var` still carries `/var/log/dpkg.log` (62 KB), `/var/log/apt/` and
   `/var/log/alternatives.log` onto EPHEMERAL on every first boot.
   `check_no_package_manager`'s `PKGMGR_TREES` lists `/var/lib/dpkg` and
   `/var/lib/apt` and not these. Cosmetic next to the timers that check already
   catches, but it is the same claim — "no package management in the image" —
   and it is not quite true.

### Why the verifier stops on the x64 image

With `MOS_BOARD` propagated, `os/verify-image-v2.sh` gets four checks in and
dies:

```
PASS: default path is a symlink to x64-mos-v2-1787545527.img
PASS: sgdisk --verify reports no problems
PASS: disk GUID is 5AC35760-0064-4000-8000-000000000000
FAIL: found 8 partitions, expected 11
/work/os/verify-image-v2.sh: line 1296: LOADER_PARTNUM: unbound variable
```

The layout indirection stops at the constants. The *shape* of a cx3576 image is
still written into the script:

- `EXPECT_PARTS=11` is a literal, and drives two `seq` loops.
- `part_rows` is an eleven-row literal table whose first three rows are
  `LOADER_*` and `UENV_{A,B}_*` — 23 distinct layout keys x64 deliberately does
  not define, which under `set -u` is a crash rather than a skip.
- `check_boot_slot` requires `Image`, `rk3576-src.dtb` and `${BOOT_SCRIPT_NAME}`
  in every boot slot, and asserts the absence of `extlinux` for a reason
  ("both U-Boot boot frameworks try extlinux before boot.scr") that is a
  statement about U-Boot. An x64 slot holds `EFI/BOOT/BOOTX64.EFI`,
  `EFI/mos/grub.cfg`, `vmlinuz` and `initrd.img`.
- `KERNEL_VERSION="6.1.115"` is the cx3576 BSP kernel, pinned at the top of the
  file and asserted against `/usr/lib/modules`. x64 runs Debian's kernel;
  `_out/x64/modules.tar` is an empty tar because there are no out-of-tree
  modules to carry.
- Three whole sections are U-Boot: the loader-protection checks (§"the reason
  first-boot growth no longer wipes the bootloader", §"the loader is protected
  STRUCTURALLY"), and `fw_printenv`/`fw_setenv`/`/etc/fw_env.config`.
- The default image path is `_out/cx3576/`, and the staleness guard compares
  against `_out/cx3576/rootfs-verity.img` and `os/podman/out-arm64/podman`
  whatever board is being verified — so an x64 run's freshness is decided by
  arm64 artifacts.

### And what nothing checks at all

The boot is read **by eye**. `os/qemu-run.sh` captures 983 lines of console and
no script makes a single assertion about them. Every claim in the first section
of this Context — no failed units, all three daemons up, an orderly shutdown —
was established by a human grepping a log, and will be re-established the same
way after every change, or not at all. `MOS_QEMU_APPEND` exists precisely
because two investigations were already spent on "a daemon that looked silent
and was not".

### What the apid tests do and do not cover

`apid` has 156 test functions and they are good: `src/tests/broken_classes.rs`
enumerates `design/api.md` §6.1's five failure classes and asserts the set it
ran, `startup.rs` proves no hostile bundle store can stop start-up. All of them
drive the axum `Router` in-process. Nothing in the tree has ever spoken to
`apid` over a socket. Untested end to end, therefore: the TLS listener and the
certificate it generates into `StateDirectory`, the `:80`→`:443` redirect as a
real redirect, the session cookie over a real `Set-Cookie`, the login backoff
across a real reconnect, and — the part that matters most — a form post whose
effect has to travel `apid` → system bus → `mosd` → a reconciler → the device.

`apid` binds `0.0.0.0:443` and `0.0.0.0:80` (`APID_HTTPS_ADDR`,
`APID_HTTP_ADDR`). The guest gets DHCP on `eth0` (`80-dhcp.network`, `Name=eth*`,
`net.ifnames=0` on both boards' cmdline). `os/qemu-run.sh` gives QEMU
`-netdev user,id=net0` with **no `hostfwd`**, and runs QEMU inside a container
with no published port, so there are two closed doors between a test and the
daemon.

## Proposal

Three milestones, one per phase of the session directive, each landing as its
own task with its own commit.

### M1 — the x64 image verified, statically and at runtime (RFCT-104)

**M1.1 Finish the layout indirection in `os/verify-image-v2.sh`.**

- Derive `EXPECT_PARTS` from the layout (`grep -c '^[A-Z0-9_]*_PARTNUM='`), so
  eleven and eight are both just what the file says.
- Build `part_rows` by iterating the layout's partition set rather than
  enumerating it, so a board that omits `loader` omits three rows instead of
  crashing on `set -u`.
- Give the U-Boot sections an explicit board predicate keyed on
  `RAUC_BOOTLOADER`, and **report every skip as a named line** —
  `SKIP: <check> (x64 boots through UEFI/GRUB; there is no U-Boot environment
  to check)` — with a skip count in the `RESULT:` summary. A silent skip and a
  passing check are the same green, which is the defect RFCT-096 is open
  against elsewhere in this tree.
- Drive `check_boot_slot`'s required-file list from the layout
  (`BOOT_SLOT_REQUIRED_FILES`), and move the no-extlinux assertion behind the
  same U-Boot predicate.
- Read the kernel version out of the image instead of pinning it, and keep the
  "exactly one" assertion.
- Make the default image path and both staleness inputs follow `MOS_BOARD`,
  with the podman input following the board's architecture. Add `MOS_ARCH` to
  both layout files as the single source for that mapping, which
  `os/rootfs/build-v2.sh` currently keeps in a `case` of its own.
- Add `make os-verify-x64-v2`.

**M1.2 A runtime assertion harness: `os/qemu-boot-test.sh`.**

Boots the image through `os/qemu-run.sh`, captures the console with
`systemd.journald.forward_to_console=1`, and asserts on it in the same
`PASS:`/`FAIL:`/`RESULT:` shape every other check in `os/` uses, so a boot is
evidence rather than a log. The set it must assert, each because nothing else
does:

- No unit reached `[FAILED]`, and the units it *did* fail are named when it did.
- `mosd`, `apid` and `mos-mqttd` all reached active, and all three stopped
  cleanly at shutdown.
- The verity root mounted, from the slot the boot order chose, and the root is
  read-only.
- `systemd-repart` grew DATA into the medium beyond the image — the case the
  4 GiB virtual disk exists to create.
- The container engine is present and **inert**, which is PLAN-012's central
  claim and has never been observed on a running system.
- `apid` reached `APID_LISTENING`.
- The shutdown path unmounted every filesystem.

Wired to `make os-qemu-boot-test`.

**M1.3 `os/qemu-journal.sh`: make it honest.**

It cannot read a volatile journal off a disk, and no kernel command line turns
`Storage=volatile` off. Recommendation: **delete it**, and put what it was
reaching for into `os/qemu-run.sh` as the documented route —
`MOS_QEMU_APPEND="systemd.journald.forward_to_console=1"`, which is what
actually produced the evidence in this plan. Keeping a tool that answers
"no journal files" for every question costs more than not having it.
(Alternative in §Alternatives.)

**M1.4 The `/var/log` package-manager residue.** Extend `PKGMGR_TREES` to the
three log paths and drop them from the seeded `/var`.

### M2 — the apid API test suite (RFCT-105)

**M2.1 Open the two doors.** `hostfwd=tcp:127.0.0.1:$PORT-:443` (and one for
`:80`) on the QEMU `-netdev`, and the matching `-p` on the `docker run`. Both
behind an opt-in variable so the default run stays a closed box.

**M2.2 `os/apid-api-test.sh`** — black-box, over TLS, against the booted
device, in the repo's existing check-script shape. It asserts the things
in-process tests structurally cannot:

- the `:80`→`:443` redirect, as a real 301/302 with a real `Location`;
- the self-signed certificate is generated into `StateDirectory` on first boot,
  is 0600, and survives a reboot rather than being reminted;
- `/healthz` before and after `mosd` is reachable;
- the first-boot `/setup` flow: no password → setup, password set → login, and
  `/setup` closed thereafter;
- login: a real `Set-Cookie`, a real session, `/logout` invalidating it;
- the backoff curve across a genuine TCP reconnect, and that a power cycle does
  not reset it (`access.md` §6, and the persistence RFCT-085 added);
- the reserved `/api/` subtree answering 404 in the documented shape, which is
  today's contract and the thing `design/api.md` §2 will replace;
- the built-in UI at its reserved prefix, and path traversal refused;
- **end-to-end through the bus**: post the hostname form, then assert the
  hostname changed *on the device*, not that the response was 200. Same for
  `container.enabled`, whose whole point is that a switch in apid reaches a
  reconciler.

**M2.3** Wire to `make os-apid-api-test`, and record in `docs/design/api.md`
§10 that the surface now has an over-the-wire suite and where it lives.

### M3 — the back-port to cx3576 (RFCT-106)

The x64 work rewrote shared files. cx3576 has not been built from any of them.

- Rebuild `os/rootfs/build-v2.sh` + `os/mkimage-v2.sh` for cx3576 and diff the
  resulting image's report against the last known-good one, so the layout
  constants that moved out of the build script are proven to have moved
  *without changing the artifact*.
- Re-run the full existing gate: `os-verify-cx3576-v2`, `os-ui-location-test`,
  `os-quadlet-doc-test`, `os-repart-test`, `os-shadow-test`,
  `os-dbus-policy-test`, `os-health-test`, `docs-verify`, and
  `cargo test --workspace`.
- Confirm the `overlay-v2` → `overlay-cx3576` split still delivers
  `10-uenv-a.conf` and `20-uenv-b.conf` into the cx3576 image, since that is
  now a board-overlay layering rather than a shared file.
- Then commit the campaign: the x64 board, the generalised verifier, the QEMU
  harness, the API suite, and the three task records.

## Risks

- **The verifier is 2500 lines of assertions that currently pass on cx3576.**
  Every generalisation is a chance to weaken one silently — a check that
  becomes board-conditional on the wrong predicate stops running on cx3576 too,
  and reports green. Mitigation: the named-skip requirement in M1.1 is not
  cosmetic; it is how a wrongly-skipped check is visible. `os/ui-location-test.sh`
  already drives the verifier against mutated fixtures and diffs the set of
  assertions that ran — the same technique covers this, and M3 re-runs it.
- **A green QEMU run is not evidence about the A/B handshake.** x64 boots
  through UEFI/GRUB; cx3576's U-Boot handshake, its attempt counters and its
  rollback are not exercised by any of this. `os/uboot-handshake-test.sh`
  remains the only thing that covers them, and M1.1's skip lines must say so
  where someone reading a green x64 result would otherwise assume otherwise.
- **Opening a port into the guest.** M2.1 forwards a management daemon to
  loopback on the build host. Default-off, loopback-bound, and the guest has no
  password until the suite sets one — but it is a listening socket on a
  developer machine and should be recorded as such.
- **Runtime assertions on console text are brittle.** systemd's status lines
  carry ANSI and truncate with an ellipsis at narrow widths — `Started
  [0;1;39mapid.service` and `mosd p…ent state` both appear in today's capture.
  The harness must strip ANSI and must not match on a truncated substring;
  where possible it should assert on journal lines forwarded to the console
  rather than on systemd's own status rendering.
- **TCG is slow.** No `/dev/kvm` on this host: the last full boot took 498
  seconds of guest time. An API suite that boots the machine per case is not
  viable; M2 assumes one boot and many requests.

## Scope

- `os/verify-image-v2.sh` — the layout indirection, the board predicates, the
  named skips. The largest single change.
- `os/layout/{cx3576,x64}-v2.env` — `MOS_ARCH`, `BOOT_SLOT_REQUIRED_FILES`.
- `os/rootfs/build-v2.sh` — read `MOS_ARCH` from the layout instead of a local
  `case`.
- `os/qemu-run.sh` — port forwarding, opt-in.
- New: `os/qemu-boot-test.sh`, `os/apid-api-test.sh`.
- Deleted: `os/qemu-journal.sh` (pending the decision in §Alternatives).
- `Makefile` — three targets.
- `os/rootfs/Dockerfile.v2` — the `/var/log` residue.
- `docs/`: PLAN-013, RFCT-104/105/106, index rows, a `design/api.md` §10 note,
  and `design/boards.md` §8's board table, which lists x64 as "upstream Talos
  (sd-boot/GRUB)" and is now wrong in both halves.
- Plus committing the ~24 modified and 10 untracked files already in the tree.

## Alternatives

**On `os/qemu-journal.sh` (M1.3).** Deleting it is one of three:

1. **Delete it.** Console forwarding already covers the need and is what was
   actually used. Simplest, and removes a tool that lies. *Recommended.*
2. **Keep it, pointed at the right place.** Have `os/qemu-boot-test.sh` seed a
   drop-in that sets `Storage=persistent` into the disk copy before boot, so
   the journal does land on EPHEMERAL and the script works. Buys a real
   `journalctl` — filtering by unit, priority and boot — which grep over a
   console capture does not. Costs: the run no longer boots the shipped
   configuration, and `Storage=volatile` is a deliberate design property
   (`/var` is fixed-size and discardable), so the harness would be testing a
   system the device is not.
3. **Keep it and fix only its diagnostics**, so it says "this image keeps the
   journal in RAM by design; use MOS_QEMU_APPEND=…". Honest, but it is then a
   script whose only output is advice.

**On the API suite's shape (M2.2).** A shell script using `curl` matches every
other check in `os/` and needs nothing in the image. The alternative is a Rust
integration test in the `apid` crate behind a feature flag, pointed at the
forwarded port — better assertions and a typed client, at the cost of a test
binary that is meaningless without a booted VM, in a workspace where
`cargo test` currently needs nothing. Recommending the shell script for
consistency with `os/`; worth revisiting when `design/api.md` §2's JSON API
lands and the responses become structured.

**On M3's ordering.** The back-port could come first, on the theory that
cx3576 is the shipping board and should not stay unbuilt while x64 work
continues. Against: the generalisations in M1 change the very scripts the
back-port would have to be re-run through, so doing it first means doing it
twice. Keeping the directive's order.

## Annotations

**2026-08-24, the user, three rulings that change the plan's shape.**

1. *"需要统一板卡定义"* — the board-level definition is adopted as a design
   principle, not left as an M1 implementation detail. §Proposal M1.1 said
   "derive EXPECT_PARTS from the layout"; that is now the small end of a
   larger requirement: **a board is defined by its layout file, and the shared
   scripts read that definition rather than knowing any board's shape.**

   Concretely: each layout declares `LAYOUT_PARTITIONS` (ordered) and a
   `<NAME>_ROLE` per partition, and a new `os/layout/lint.sh` enforces the
   schema — every declared partition carries its role's required keys, and
   **no partition carries keys its role does not use**. That reverse check is
   the one that matters: `BOOT_ATTEMPTS_DEFAULT=3` sat in the x64 layout under
   a comment asserting the U-Boot contract "is identical", and nothing
   objected until RAUC refused to start on the device.

   The linter needs its own conformance test — mutated layouts that it must
   reject — for the reason `os/verify-image-v2.sh` states about itself: an
   assertion only ever observed passing is not evidence.

2. *"需要修复为成功，x64 也是一等公民和 cx3576 一样"* — a failing unit on x64
   is not to be allowlisted into silence. `mos-status-led.service` fails on
   QEMU because there is no `/sys/class/leds/status-blue/brightness`; the fix
   is that a board with no status LED does not ship the unit, which is a board
   fact and therefore belongs in the definition above. Adding it to
   `tolerate-failed` was the alternative and is rejected: it would make the
   health gate's allowlist the place where board differences accumulate.

3. *"我们当前需要基于 x64 跑完所有验证交付，因为有 qemu 很容易测试"* — x64
   becomes the primary verification vehicle, and the milestone order changes
   with it. M1 was scoped as "the x64 image verified statically and at
   runtime"; it is now the campaign's critical path, because **nothing in
   `os/verify-image-v2.sh` has ever run against an x64 image.** Everything
   this plan claims about x64 today rests on booting it. A boot proves runtime
   behaviour; it says nothing about the GPT layout, verity, file capabilities,
   the D-Bus policy, `/etc/shadow` placement or the ssh configuration, which
   are what those ~2500 assertions cover.

   M3 (the cx3576 back-port) is not dropped, and the ordering argument in
   §Alternatives still holds — but it now follows a verifier that has been
   proven on both boards rather than one.

**Status of the original three defects in §Context, as of 2026-08-24 11:30.**
All three are fixed and verified by booting, and the plan's Context is left as
written because it records what was measured at the time:

- `MOS_BOARD` container re-exec — fixed, in this plan's first working session.
- `os/qemu-journal.sh` — still broken, still committed, decision still open
  (§Alternatives M1.3).
- `/var/log` package-manager residue — still present, not yet addressed.

Four further defects were found the same way and fixed on main since:
`boot-attempts` rejected by RAUC's grub backend (7d3c705), no CA bundle in the
image and no `grub-editenv` (95e1ad2), the health gate waiting on a state that
required its own completion (9949bf8), and conmon compiled without journald so
every container start failed (c6b104a). Each was behind the one before it, and
none is visible without a running device.
