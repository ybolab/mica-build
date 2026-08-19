# RFCT-013 squashfs+dm-verity rootfs pack + RO root wiring (cx3576 layout v2)

- **status**: implementation complete — pending user hardware acceptance
- **priority**: P1
- **owner**: ai-agent
- **createdAt**: 2026-08-18 03:39
- **claimedAt**: 2026-08-18 03:39
- **completedAt**: 2026-08-18 04:30

## Description

The rootfs-image side of PLAN-010 M4 (= PLAN-006 A/B updates on systemd): pack
the root as a squashfs with an appended dm-verity hash tree, generate the
per-slot kernel cmdline that assembles it without an initramfs, and wire up
everything a read-only root needs at runtime.

v1 (`os/rootfs/build.sh`, `os/rootfs/Dockerfile`, `os/mkimage.sh`) is untouched;
v2 is a sibling behind new targets.

Scope / deliverables:

1. **Pack** (`os/rootfs/Dockerfile.v2` pack stage): `mksquashfs -comp zstd
   -Xcompression-level 19 -noappend -all-root -no-exports -mkfs-time/-all-time
   <FILE_MTIME> -processors 1`, then `veritysetup format` against the same file
   with `--hash-offset=<squashfs bytes>`, the pinned `VERITY_SALT` and a pinned
   `--uuid` (derived from `ROOTFS_A_GUID`; veritysetup randomises it by default
   and it lands in the verity superblock). Padded to a whole MiB.
2. **Rootfs content** (`os/rootfs/Dockerfile.v2` rootfs stage): v1's content
   verbatim plus `rauc` and `libubootenv-tool`; sshd host keys removed from the
   image; `squashfs-tools`/`cryptsetup-bin` confined to the pack stage.
3. **Kernel cmdline** (`os/rootfs/build-v2.sh`): `boot-cmdline-a.txt` /
   `-b.txt`, generated from the verity parameters and the slot partition GUIDs.
4. **RO root wiring** (`os/rootfs/overlay-v2/`): fstab (EPHEMERAL `/var`, STATE,
   META, tmpfs `/tmp`, all `noatime`, `x-systemd.growfs` on EPHEMERAL only), the
   repart.d set that grows EPHEMERAL instead of the root, the `/var/lib/mos` and
   `/etc/ssh` binds from STATE, the two first-boot seed oneshots,
   `/etc/fw_env.config`, `fstrim.timer`.
5. **Decision record** (`docs/design/ro-root.md`): cmdline-only vs
   micro-initramfs, with the vendor-tree evidence; the machine-id-via-U-Boot-env
   design; the `/etc` runtime-writer audit.

Work checklist:

- [x] `Dockerfile.v2` rootfs stage (v1 content + rauc + libubootenv-tool)
- [x] `Dockerfile.v2` pack stage (mksquashfs + veritysetup, fully pinned)
- [x] `build-v2.sh` (staging, overlay rendering, cmdline generation, budget)
- [x] `overlay-v2/` mount units, fstab, repart.d, seed oneshots, fw_env.config
- [x] `docs/design/ro-root.md` decision record
- [x] `os/rootfs/README.md` v2 section
- [x] Reproducibility, verity and v1-regression verification

Acceptance:

- `make os-rootfs-cx3576-v2` produces all five outputs; the verity image is a
  whole-MiB multiple; `rootfs-verity.env` is complete.
- Two cache-hot runs produce a byte-identical image and root hash.
- `make os-image-cx3576-v2` assembles a full v2 image end to end.
- `make os-image-cx3576` + `make os-verify-cx3576` (v1) still green.
- On-device boot of the verity root is the user's hardware acceptance — out of
  scope here; never claimed done by agents.

## Key decisions

- **No initramfs.** `dm-mod.create=` on the cmdline is sufficient on 6.1.115.
  Verified against `armbian/linux-rockchip` `rk-6.1-rkr5.1`: `verity` is in
  `dm_allowed_targets[]`; `dm_get_dev_t()` falls back to `name_to_dev_t()`, so
  `PARTUUID=` resolves through `devt_from_partuuid()` (matched with
  `strncasecmp`, case-insensitive); `dm-mod.waitfor=` exists
  (`module_param_array(waitfor, ...)`) and is used, because the eMMC probes
  asynchronously and `dm_init_init()` is only a `late_initcall`. `waitfor` is an
  addition to the cmdline template given in the task spec.
- **Growth target moved to EPHEMERAL**, and all seven `linux-generic`
  partitions get a repart.d file in disk order. systemd-repart matches
  definitions to partitions by type UUID *in order*, so a lone "grow" file would
  have silently attached itself to `uenv-a`. The first six are inert
  (`Weight=0`, no size pinned — the rootfs slot size is resolved by the
  assembler after these files are baked in).
- **`/var` is seeded, not assumed.** EPHEMERAL is created empty, so the built
  `/var` tree moves to `/usr/share/factory/var` (9 MB, a move not a copy) and
  `mos-seed-var.service` restores it on first boot, before
  `systemd-tmpfiles-setup`.
- **sshd host keys are generated per device, not baked.** Baked keys would be a
  private key shared by every device flashing the release, and a random keygen
  would break cold-build reproducibility of the root hash. `mos-seed-state`
  generates them into STATE; `etc-ssh.mount` binds that over `/etc/ssh`.
  Consequence recorded in the design record: binding all of `/etc/ssh` freezes
  `sshd_config` on an already-seeded device.
- **fstab over hand-written `.mount` units** for the three block mounts, so
  `x-systemd.growfs` works through the fstab generator. `PARTUUID=` values are
  lowercased — udev's `by-partuuid` symlinks come from libblkid, which formats
  GUIDs lowercase, and systemd's fstab generator does not normalise case.
- **`/etc/machine-id` via the U-Boot env** (design record only; RFCT-015
  implements the oneshot, RFCT-018 the U-Boot side). Transient per boot until
  that U-Boot ships.
- **`-all-root` changes setgid group ownership** on five binaries
  (`ssh-agent`, `chage`, `expiry`, `unix_chkpwd`,
  `dbus-daemon-launch-helper`). `-all-root` is mandated by the M4 spec, so it
  is kept; the pack stage records the full setuid/setgid and file-capability
  inventory into `rootfs-report-v2.txt` so the effect is visible rather than
  assumed.

## Verification (2026-08-18)

Host: `BOARD_DIR=/srv/ai/mos/board/cx3576` (prebuilt BSP artifacts).

- `make os-rootfs-cx3576-v2` — green. `rootfs-verity.img` 55574528 bytes
  (53 MiB, whole-MiB multiple); squashfs 55078912 B; 13447 data blocks; 107
  hash blocks. `TOTAL_MB 216` against the 400 MB budget (v1: 204).
- **Reproducibility**: two cache-hot runs, `rootfs-verity.img` byte-identical
  (`cmp` clean). Hashes below are from the post-rework build; the pre-rework
  values are superseded by the `-all-root` removal, which legitimately changes
  ownership and therefore the root hash.
- **Verity integrity**: `veritysetup verify` (userspace, no device-mapper) in a
  throwaway container returns OK against the recorded root hash;
  `veritysetup dump` confirms the pinned salt, the pinned UUID
  `5ac35760-0002-4000-8000-000000000005` and sha256/4096/4096.
- **squashfs**: `unsquashfs -s` reports zstd level 19, superblock time
  2020-01-01T00:00:00Z, not exportable via NFS. `/var` is an empty mountpoint,
  `/usr/share/factory/var` holds the tree, `/etc/ssh` carries no host key, and
  the rendered `fstab` / `fw_env.config` contain lowercased GUIDs and no
  placeholder.
- `make os-image-cx3576-v2` — assembled green at the time of the first pass
  (`SLOT_MIB 256`, boot 64+64 MiB, total 803 MiB / 842006528 bytes,
  `sgdisk --verify` "No problems found"). It briefly failed on the then
  case-sensitive GUID assertion; RFCT-020 made that comparison
  case-insensitive in 31e1c06 and the v2 image builds green again.
- `make os-image-cx3576` + `make os-verify-cx3576` (v1 regression) —
  **RESULT: PASS (71/71 checks)**, unchanged.
- `bash mosd/hack/check.sh` not run: no Rust code was touched by this task.
- No host system state was mutated. No `mount`, `losetup`, `modprobe`,
  `systemctl` or `veritysetup open` ran on the host; the pack, the assembly and
  the verity/squashfs inspections all ran inside containers the scripts (or the
  verification step) launched, with the repo bind-mounted.

## Spec amendment (2026-08-18, folded in)

Three additive requirements arrived after the first pass, driven by RFCT-018's
findings and by two commits that landed on the integration branch after this
branch's base (`ee8f0bf` -> `789f514`). All three are satisfied.

1. **`dm-mod.waitfor=` is mandatory, not optional.** Already emitted, and the
   reasoning is now recorded as settled rather than as an open question: the
   `wait_for_device_probe()` inside `dm_init_init()` does not cover eMMC card
   discovery (a delayed workqueue), so without the wait the boot breaks
   intermittently. RFCT-018 reached the same conclusion independently on every
   point — `waitfor` exists, `PARTUUID=` resolves via the `name_to_dev_t()`
   fallback, and dm-verity's SHA-256 is already built in. No disagreement to
   escalate.

2. **Cmdline file shape is now a contract**, because the assembler derives each
   slot's `mos-verity.env` from these files with `sed` and the v2 boot slots no
   longer carry `extlinux.conf`. This exposed a **real defect in the first
   pass**: the cmdline emitted lowercased GUIDs, but the new
   `os/mkimage-v2.sh` cross-checks each slot's table against `ROOTFS_x_GUID`
   with a case-SENSITIVE shell substring test (`[ "${create#*"$4"}" = ... ]`),
   and the layout env holds them uppercase. Integration would have aborted.
   Fixed: the cmdline now uses the env GUID verbatim. `fstab` deliberately
   still lowercases, because udev's `by-partuuid` symlinks come from libblkid.
   The kernel is case-insensitive either way (`strncasecmp`), so on-device
   behaviour is unchanged.

3. **Empty `/etc/machine-id` regular file.** Already shipped by the pack stage;
   re-verified as a 0-byte regular file in the packed squashfs. Without it
   systemd has nothing to bind-mount the transient id over on a read-only
   `/etc`.

Verified by running the **new** `os/mkimage-v2.sh` (from `bkd/n98jlna1`)
against these outputs in a scratch tree, without merging it: it assembled the
803 MiB image, and both boot slots came out holding `Image`, `rk3576-src.dtb`,
a byte-identical `boot.scr` and a per-slot `mos-verity.env` carrying that
slot's own GUID (A -> `...0005`, B -> `...0006`), with no `extlinux` directory.
`rootfs-verity.img` and `VERITY_ROOT_HASH` are unchanged by the fix — the
cmdline is not part of the squashfs.

## Verification after rework (2026-08-18)

- `make os-rootfs-cx3576-v2` — green. `rootfs-verity.img` 55574528 bytes
  (53 MiB, whole-MiB multiple), `TOTAL_MB 216` against the 400 MB budget.
- **Reproducibility**, two cache-hot runs:
  `sha256(rootfs-verity.img)` =
  `f6e37f8791bc12064929040eae5ab89cebb796335679edf4a49fb0691bef732a` both runs,
  `cmp` clean; `VERITY_ROOT_HASH` =
  `b8f6645dbff95b4206991f2eb346e1fef2856f8523abbd95af724587497d6fa7` both runs.
  (Both values differ from the pre-rework build because dropping `-all-root`
  legitimately changes file ownership, which is covered by the hash.)
- Ownership gate: passes on the real build; fails as designed when `-all-root`
  is re-added.
- `veritysetup verify` in a throwaway container (userspace, no device-mapper):
  OK.
- Hostname wiring present in the packed image: `etc-hostname.mount`,
  `mos-apply-hostname.service`, both symlinked into `local-fs.target.wants`,
  `/usr/bin/hostname` present, baked `/etc/hostname` = `mos`.
- `/etc/machine-id` still a 0-byte regular file.
- `make os-image-cx3576` + `make os-verify-cx3576` (v1) — **PASS (71/71)**.
- `make os-image-cx3576-v2` — failed at the time on the then case-sensitive
  GUID assertion, as anticipated by the review, and was deliberately not worked
  around. RFCT-020 has since made the comparison case-insensitive (31e1c06),
  and the image builds green; see the addendum verification below.
- No host state mutated: pack in buildkit stages, inspections in throwaway
  containers with the output directory bind-mounted read-only.

## Rework (2026-08-18, post-merge review of 8b15862)

Two fixes plus one correction, all applied.

### 1. Security: `-all-root` dropped

`-all-root` rewrites ownership but not mode bits, so the shipped image had
`ssh-agent` (was `_ssh`), `chage`, `expiry`, `unix_chkpwd` (were `shadow`) and
`dbus-daemon-launch-helper` (was `messagebus`) all owned root:root — i.e.
**setgid-root** — inside a signed read-only rootfs. It also broke `unix_chkpwd`
the other way: egid `shadow` is what lets it read `/etc/shadow`, and egid root
does not, so non-root PAM password verification would have failed.

The determinism justification for the flag did not hold: mksquashfs carries the
source tree's ownership through, and the source tree comes from a pinned base
image and a pinned package set. Flag removed; every other determinism knob
(`-mkfs-time`/`-all-time`, `-processors 1`, `-noappend`, `-no-exports`, pinned
salt and UUID) is unchanged.

The inventory is now a **build gate**, not just a report section. The pack
stage records the source tree's setuid/setgid inventory
(`find -printf '%M %U %G %P'`), extracts the same from the packed image
(`unsquashfs -lln`, numeric ids so arm64 names need not resolve on the build
platform), and fails the build on any difference. Verified in both directions:
the real build passes, and re-adding `-all-root` fails with
`error: packing changed setuid/setgid ownership or modes`.

Determinism did not regress — see the two-run proof in Verification below.
Ownership in the packed image is now `ssh-agent` gid 106, `chage`/`expiry`/
`unix_chkpwd` gid 42, `dbus-daemon-launch-helper` gid 105, journal gid 999.

### 2. Correction: hostname had a live consumer

The §6 audit previously said "hostname persistence -> known breakage, nothing
in mos sets it today". The second half was wrong.
`mosd/mosd/src/reconciler/hostname.rs` is a merged M2 reconciler calling
`SetStaticHostname` on `org.freedesktop.hostname1`; `systemd-hostnamed`
implements that by writing `/etc/hostname`. It is reachable from the M3
first-run wizard, so on v2 "set the hostname in the web UI" would have failed
EROFS — a user-visible regression, not a latent gap.

Fixed with the existing `/etc/ssh` mechanism rather than a new pattern:
`mos-seed-state` also seeds `/mnt/state/hostname` from the baked value, and
`etc-hostname.mount` binds it over `/etc/hostname`. One extra step was
genuinely required: PID 1 reads `/etc/hostname` and sets the kernel hostname
before any mount unit runs, so `mos-apply-hostname.service` re-applies the
persisted value (`hostname -F /etc/hostname`) once the bind is in place —
without it a hostname set in the UI would persist to STATE and then silently
revert on every reboot. `mosd` is untouched. `docs/design/ro-root.md` §6 now
records this as solved.

### 3. Cmdline PARTUUID case reverted to lowercase

The previous turn had switched the cmdline GUIDs to uppercase to satisfy
`os/mkimage-v2.sh`'s case-sensitive cross-check. Per review, the lowercase
choice is the correct one and the assertion was what needed fixing (RFCT-020,
in parallel). Reverted to lowercase, matching `/etc/fstab` and udev's
`by-partuuid` symlinks. That briefly made `make os-image-cx3576-v2` fail with
`error: the slot-A verity table ... does not reference PARTUUID
5AC35760-0002-4000-8000-000000000005`, which was deliberately not worked around
on this side. RFCT-020 landed the case-insensitive comparison in 31e1c06 and
the image builds green.

### Unchanged, recorded, no action

`/etc/ssh` bound wholesale; cold-build reproducibility tied to bookworm-slim
tool versions; the board console cmdline living in `build-v2.sh`; the Debian
base image's apt-daily/e2scrub_all timers; `CONFIG_SQUASHFS_XATTR` predating
this branch's base with the `getcap -r` tripwire as the response.

## Addendum (2026-08-18): parity with the reworked v1 rootfs

Merged `bkd/n98jlna1` (master 090fde1, "adopt the verified Alpine rootfs, port
its board facts to os/rootfs"). That commit added two hwinit units and a udev
rule to the v1 `Dockerfile`, and `Dockerfile.v2` — a sibling copy — did not
pick them up.

The concrete drift: `hwinit-mac`/`hwinit-gadget` and
`mos-mac.service`/`mos-gadget.service` WERE installed (the existing `hwinit-*`
and `*.service` globs caught them) but NEITHER WAS ENABLED, because the enable
loop was a hardcoded `mos-modules mos-otg mos-can mos-bt`; and
`60-mos-gadget-getty.rules` was not installed at all. Both are silent losses —
a v2 image would have booted fine while getting a fresh random MAC every boot
and no USB debug console.

Fixed:

1. `Dockerfile.v2` now installs `hwinit-*`, `*.service` and `*.rules`, matching
   v1 as it stands on the merged base.
2. The enable list is **enumerated** from `/tmp/hwinit/*.service`, not
   restated, so the next unit added to `os/hwinit/` is picked up automatically.
   The build also asserts at least one unit was enabled, so a glob matching
   nothing fails loudly instead of producing an image with no hwinit.
   Build output confirms `hwinit: enabled 6 unit(s)`.
3. No board fact is encoded in the v2 layer. Verified after the change by
   reading `/etc/mos` back out of the packed squashfs: `bitrate=250000`,
   `fd=off`, `mode=otg`, `aic8800_btlpm`, `proto=h4`, `speed=1500000`, plus the
   new `gadget.conf` and `mac.conf` — all of master's new semantics, none of
   them restated anywhere in `Dockerfile.v2`, `build-v2.sh` or `overlay-v2/`.
4. Nothing else in the v1 `Dockerfile` needed porting. The commit touched it in
   exactly two places (hwinit, +5 lines; CJK guard, +24). Confirmed by diffing
   the two rootfs stages instruction-by-instruction after the fix: every
   remaining difference is an intentional v2 one (rauc/libubootenv-tool, the
   removed host keys, the overlay, the removed v1 repart/fstab). The v1 README
   additions are v1-side documentation of the hwinit units; the v2 README now
   carries its own parity section rather than duplicating the unit table.
5. The CJK guard is the **same mechanism** as v1's, same character ranges, in
   the v2 pack stage, extended with the v2-only mos-owned paths (overlay mount
   units, seed scripts, `repart.d`, `fstab`, `fw_env.config`). Not a second
   check with different shape. Deliberately NOT refactored into a shared script
   used by both Dockerfiles, since that would mean editing the v1 `Dockerfile`
   the user had just written, for no behavioural gain.

New finding while checking the units are read-only-root safe (they are — every
`/etc` reference in all six is a read of its own conf file; writes go to
configfs, sysfs and `ip link`): `hwinit-otg` supports a per-device override at
`/etc/mos/otg-mode`, which cannot be created on a verity-protected `/etc`. The
override is therefore unavailable on v2; defaults from `otg.conf` are
unaffected. Recorded in `docs/design/ro-root.md` §6 with the fix shape
(`/mnt/state` or `/run` with `/etc/mos` as fallback). Not implemented here
because `os/hwinit` is shared with v1 and this is not the task's call to make.

## Verification after the addendum (2026-08-18)

- `make os-rootfs-cx3576-v2` — green, `hwinit: enabled 6 unit(s)`, CJK guard
  clean, ownership gate clean, `TOTAL_MB 216` (budget 400).
- **Reproducibility**, two cache-hot runs:
  `sha256(rootfs-verity.img)` =
  `056a3a792c4fe16735962d666640ab493337ea09432006e9d3e8fbdcefc65381` both runs,
  `cmp` clean; `VERITY_ROOT_HASH` =
  `c4eda6266f5d51fb0e74fd4d71154ae3d80af4b9366893d2adf62520a4f02e53` both runs.
  (Both differ from the pre-merge values because the merge changed rootfs
  content — the two new units, the udev rule and the new board facts.)
- `veritysetup verify` in a container, userspace, no host device-mapper: OK.
- Packed squashfs: all six `mos-*.service` present under
  `/usr/lib/systemd/system` AND symlinked in
  `/etc/systemd/system/multi-user.target.wants`; `60-mos-gadget-getty.rules`
  present in `/usr/lib/udev/rules.d`; all six `/etc/mos/*.conf` staged.
- `make os-image-cx3576-v2` — **green**. RFCT-020's GUID assertion is now
  case-insensitive, so the lowercase cmdline passes. `SLOT_MIB 256`, boot
  64+64 MiB, image 803 MiB, `sgdisk --verify` "No problems found".
- `make os-image-cx3576` + `make os-verify-cx3576` — **RESULT: PASS (88/88)**,
  matching the new baseline.

## Layout revision + /var discardability audit (2026-08-18)

### A. Growth moves from /var to /srv

`/srv` (DATA, p10) now grows to fill the media; `/var` (EPHEMERAL, p9) is
fixed-size and disposable. My half:

- `/etc/repart.d/` becomes **eight** definitions. `80-data.conf` carries
  `Weight=1000`; `70-ephemeral.conf` drops to `Weight=0`/`PaddingWeight=0` like
  its siblings. The count matters for the reason found earlier in this task:
  repart pairs definitions with partitions by type UUID in disk order, so an
  eighth linux-generic partition against seven definitions would attach the
  grow flag to the wrong partition.
- `/srv` mounted from DATA, ext4, `noatime,x-systemd.growfs`, keyed on
  lowercased `PARTUUID=`, same style as the existing three. `/var` keeps its
  mount and loses `x-systemd.growfs`.
- Tier semantics recorded in `docs/design/ro-root.md` §4, including what
  factory reset destroys versus what log cleanup destroys.

**Landing order.** RFCT-020's p10 is NOT on this base — the layout env has no
`DATA_*` and no `MOS_VAR_MIB`, and the assembler still builds nine partitions.
Shipping the eight-definition set against a nine-partition image is actively
harmful (the unmatched definition would make repart CREATE a partition), so
`build-v2.sh` keys off `DATA_GUID`: present → `/srv`, `/var` without growfs,
eight definitions; absent → the previous nine-partition arrangement exactly,
with a warning. It also asserts the definition count matches the mode and that
exactly one definition grows. The DATA path was exercised by supplying
`DATA_GUID` from the environment and verified to render correctly.

### B. Precious-data audit

The `/var`-is-disposable contract is now a **build assertion**, not a claim:
each precious path must have an enabled STATE bind that mounts what it says it
mounts and has a mountpoint in the factory `/var`.

- `/var/lib/mos` — already STATE-backed by design; now proven. webd's
  `StateDirectory=mos/webd` lands inside it, so credentials are covered.
- `/var/lib/bluetooth` — NEW bind to `/mnt/state/bluetooth`, seeded 0700
  (bluez requires it). Pairings survive a `/var` wipe.
- `/var/lib/systemd/random-seed` — left on `/var`, deliberately. The unit path
  escapes to `var-lib-systemd-random\x2dseed.mount`, a file bind needs the file
  to pre-exist at 0600, and `systemd-random-seed` loads at early boot and saves
  at shutdown, either side of the local-fs phase. Payoff is small: a wiped
  `/var` leaves the device where a freshly-flashed one starts.
- **`/var/lib/dbus/machine-id` — found and fixed.** It was a regular file
  holding a build-time id, i.e. the same D-Bus machine id on every device
  flashing the release, on a disposable filesystem. Now a symlink to
  `/etc/machine-id` (the Debian convention), asserted at build time.
- **RAUC statusfile — recommend `statusfile=/mnt/meta/rauc.status`.** RFCT-014
  owns the line. META is update/appliance metadata, which is what slot status
  is; STATE stays purely user-meaningful configuration and identity, which
  matters for describing factory reset. `/mnt/meta` is mounted in the local-fs
  phase, long before RAUC runs. RAUC's own default (`/var/lib/rauc`) is exactly
  the failure this rule prevents.

Standing rule recorded: **identity, credentials, pairings and update state
never live on `/var`.**

### C. Fill-up containment

- journald `Storage=volatile` — confirmed, and now asserted by the same build
  check, so the journal never touches `/var`.
- `/etc/tmpfiles.d/mos-var.conf`: `q /var/tmp 1777 root root 10d` (Debian's own
  rule says 30d; an appliance has no long-lived interactive sessions) and
  `e /var/cache 0755 root root 30d` (regenerable, and no distro rule ages it).
  Applied daily by `systemd-tmpfiles-clean.timer`.

### D. Stale references

All fixed: the layout-v2 task is RFCT-020 (master took the earlier number for
its Alpine-rootfs task), and the tense is corrected — the GUID comparison has
been case-insensitive since 31e1c06 and the v2 image builds green. The
substantive point, that lowercase is correct for udev and fstab and was never
the bug, is kept.

## Verification after the layout revision (2026-08-18)

- `make os-rootfs-cx3576-v2` — green. `layout: 7 repart definitions, 1 of them
  growing` (fallback mode, DATA not yet in the env), `hwinit: enabled 6
  unit(s)`, and the precious assertions:
  `precious: /var/lib/mos -> STATE via var-lib-mos.mount`,
  `precious: /var/lib/bluetooth -> STATE via var-lib-bluetooth.mount`,
  `precious: journald Storage=volatile`. `TOTAL_MB 216` (budget 400).
- **DATA path exercised** by supplying `DATA_GUID` from the environment:
  `layout: DATA present -> /srv grows, /var fixed, 8 repart definitions`,
  `80-data.conf` the only `Weight=1000`, `/srv` rendered with
  `noatime,x-systemd.growfs` and `/var` with plain `noatime`. Artifact
  discarded; the shipped build is the fallback one.
- **Reproducibility**, two cache-hot runs:
  `sha256(rootfs-verity.img)` =
  `e5e59a36161c6e77919a19052aa04f9423dc664779c47861ba30f012846d8607` both runs,
  `cmp` clean; `VERITY_ROOT_HASH` =
  `5dbab5b5f3b1a843d3c312c3e23720cb53a7243b10520903b5ca03bd507c59ee` both runs.
- `veritysetup verify` in a container, userspace, no host device-mapper: OK.
- Packed image: 7 repart definitions (fallback), all seven local-fs binds and
  seeds enabled including `var-lib-bluetooth.mount`, six `mos-*.service`
  enabled including mac and gadget, `60-mos-gadget-getty.rules` installed,
  `/etc/tmpfiles.d/mos-var.conf` present, `/var/lib/dbus/machine-id` a symlink
  to `../../../etc/machine-id`, `/srv` mountpoint present.
- `make os-image-cx3576-v2` — green (nine-partition image, since p10 is
  RFCT-020's half).
- `make os-image-cx3576` + `make os-verify-cx3576` — **RESULT: PASS (88/88)**.

## RAUC config rendering + stale-header cleanup (2026-08-18)

Two handoffs from RFCT-014's escalations, plus the outstanding prose fixes.

### 1. system.conf is rendered, not committed (RFCT-014 E2)

RFCT-014 had to commit `os/rootfs/overlay-v2/etc/rauc/system.conf` because the
overlay renderer lives in `build-v2.sh`, which it could not edit. A rendered
artifact in git can drift from its template, and `os/bundle.sh`'s
`render-config.sh --check` reports drift after the fact rather than preventing
it.

`build-v2.sh` now runs `bash os/rauc/render-config.sh` before staging the
overlay, and asserts the staged file is non-empty. The committed copy was
deleted in the same change and the path added to `.gitignore`, so the tree was
never without one. The renderer writes into the source overlay, which is why it
runs before the staging copy rather than after.

`--check` still passes (`rauc config current: .../system.conf`). Its role
narrows to catching a hand-edit of the generated file after the last build;
committed-copy drift can no longer happen. No ordering hazard: `bundle.sh`
consumes `rootfs-verity.img` as well, so `build-v2.sh` has necessarily run and
the file exists.

### 2. Stale PROVISIONAL header (RFCT-014 E3)

The header in `etc/fw_env.config.in` had already been corrected by RFCT-014 in
the merge — it now records that this is the single `fw_env.config` source and
that `render-config.sh` asserts its structure. What remained was the same
obsolete framing in **my** files, now fixed:

- `os/rootfs/README.md` no longer calls the template provisional.
- `docs/design/ro-root.md` §5 no longer says `/etc/fw_env.config` "is
  provisional — RFCT-014 may replace it"; it records the assertions RFCT-014
  makes about it instead (two device lines, GUID match, offset 0, size
  `UENV_SIZE_BYTES`, and the partition-start cross-check against
  `UENV_A/B_OFFSET_BYTES`).
- The "inert until the custom U-Boot lands" caveat is replaced with the actual
  state, which is more specific than the review's phrasing: the U-Boot half is
  **fully** live — `uboot-mos` is on main, the v2 image carries it, the
  assembler refuses the debug variant, and `os/boot/cx3576-boot.cmd` really
  does append `systemd.machine_id=${machine_id}` behind a `test -n` guard.
  What is still pending is only RFCT-015's oneshot that *populates* the
  variable. So machine-id stays per-boot transient until that lands, and for
  one boot after it, since the value it writes reaches the cmdline on the
  following boot.

### 3. Stale-tense sentences

Fixed in all six locations. The merge conflicted here because the renumber task
had corrected the number on the same lines; resolved in favour of this branch,
which already had both the number and the tense right. Also removed a
self-referential `grep -rn RFCT-012` line from this record that was itself a
hit.

## Verification after the RAUC-rendering change (2026-08-18)

RFCT-020's partition 10 landed in this merge, so this is the first run of the
full ten-partition layout rather than the fallback.

- `make os-rootfs-cx3576-v2` — green.
  `rendered .../etc/rauc/system.conf (compatible=mos-cx3576,
  statusfile=/mnt/meta/rauc.status, boot-attempts=3)` — RFCT-014 adopted the
  META recommendation from the previous turn.
  `layout: DATA present -> /srv grows, /var fixed, 8 repart definitions`.
  `TOTAL_MB 216` (budget 400).
- **Reproducibility**, two cache-hot runs:
  `sha256(rootfs-verity.img)` =
  `cd3c0e9a97ca832109eee77b43c6c9cc79fd8548971878effb468909be06221d` both runs,
  `cmp` clean; `VERITY_ROOT_HASH` =
  `753606747806990ac18375c40c46d3f10d21abd28145b37f3a44c1dbd637ed91` both runs.
- `veritysetup verify` in a container, userspace, no host device-mapper: OK.
- Packed image: **8** repart definitions with `80-data.conf` the only
  `Weight=1000`; `/srv` mounted from `PARTUUID=…0010` with
  `noatime,x-systemd.growfs`; `/var` with plain `noatime`; the rendered
  `system.conf` carrying `statusfile=/mnt/meta/rauc.status`; the rendered
  `fw_env.config` with its two by-partuuid lines.
- `make os-image-cx3576-v2` — green. Ten partitions,
  `meta 16 + state 64 + var 512 + data 64 MiB`, image **1315 MiB**,
  `sgdisk --verify` "No problems found".
- `make os-devkeys && make os-bundle-cx3576` — green. RAUC logs
  `Using central status file /mnt/meta/rauc.status`; bundle verifies against
  the dev keyring; `rauc info` reports `compatible=mos-cx3576` and a rootfs
  image checksum matching the built `rootfs-verity.img`.
- `bash os/rauc/render-config.sh --check` — clean.
- `make os-image-cx3576` + `make os-verify-cx3576` — **RESULT: PASS (88/88)**.

## Fallback retirement (2026-08-18)

Partition 10 has landed, so `build-v2.sh`'s nine-partition fallback became
unreachable in normal operation and has been deleted. The fallback earned its
keep only while the two halves could land in either order.

### A green gate proves the checks are consistent with the artifact, not that the artifact is right

This is the part worth reading, and it generalises well past this change.

"Unreachable code" undersells the risk. The question that matters is: if
`DATA_GUID` had gone missing from the layout env — a bad merge, an editing slip
— what would have caught it? The answer is **nothing**. The build would have
emitted a nine-partition rootfs with `/var` growing and no `/srv`, and then:

| Check | Result with the wrong layout |
|---|---|
| `make os-verify-cx3576` (v1) | PASS, 88/88 — it does not look at v2 |
| `make os-image-cx3576-v2` | green — the assembler builds whatever the layout env describes |
| `make os-bundle-cx3576` | green — the bundle carries the rootfs it was handed |
| two-run byte-identical proof | PASS — the wrong artifact is reproducibly wrong |

Every one of those checks is *consistent with either layout*, so none of them
can distinguish the two. The gate would have been fully green and the first
symptom would have been `/srv` missing on a device.

That is this campaign's recurring failure class stated plainly: **a green gate
proves the checks are consistent with the artifact, not that the artifact is
right.** Every silent-loss bug found in this task has the same shape — the
hardcoded hwinit enable list that installed `mos-mac`/`mos-gadget` but never
enabled them; `-all-root` producing setgid-root binaries; a lone repart
definition attaching the grow flag to `uenv-a`; `/var/lib/dbus/machine-id`
carrying a shared build-time identity. In each case the build was green and the
artifact was wrong. The defence is not more checks of the same kind but checks
that can *only* pass for the intended artifact — which is why the fixes in this
task are build-time assertions (the setuid/setgid diff, the precious-path bind
check, the repart definition count) rather than review notes.

### The required constants

`DATA_GUID`, `DATA_PARTNUM`, `DATA_FS_UUID` and `MOS_VAR_MIB` are now required,
with an error naming `os/layout/cx3576-v2.env` and the missing keys.

All four are demanded even though only `DATA_GUID` is read in `build-v2.sh`.
The hazard is a *partially* edited layout env, and a consumer that validates
only its own reads cannot see that hazard by construction. `build-v2.sh` is also
the first step of `os-image-cx3576-v2`, so failing here costs seconds rather
than a full rootfs build followed by an assembler error — the earliest consumer
is the cheapest place to catch it.

The cost of that choice, named so it is not a surprise later: **if a future
constant is added to the layout env, this list goes stale and will not check
it.** That is a silent gap rather than a break, and the smaller of the two
failure modes. If the list ever grows past a handful, the better shape is a
single shared "required keys" assertion that the layout env's consumers call,
rather than several hand-maintained lists. Deliberately not built now — two
checks over four keys does not justify the machinery.

Both existing assertions are kept — the staged definition count must be eight,
and exactly one definition must carry `Weight=1000`.

## Verification after the fallback retirement (2026-08-18)

- **Negative test**, same shape as the `-all-root` one. `DATA_GUID`,
  `DATA_FS_UUID` and `MOS_VAR_MIB` were removed from the layout env in place
  (backed up first, restored immediately, `git diff --quiet` confirmed clean
  afterwards). The build failed before reaching docker, exit code **1**:

  ```
  error: .../os/layout/cx3576-v2.env is missing: DATA_GUID DATA_FS_UUID MOS_VAR_MIB
  The DATA partition (/srv) and the fixed /var size are part of layout v2;
  a rootfs built without them would silently ship the superseded
  nine-partition arrangement. Restore the constants in .../cx3576-v2.env.
  ```

- `make os-rootfs-cx3576-v2` — green, still the eight-definition DATA shape:
  `layout: DATA present -> /srv grows, /var fixed` and
  `layout: 8 repart definitions, 1 of them growing`. `TOTAL_MB 216`.
- **Reproducibility**, two cache-hot runs:
  `sha256(rootfs-verity.img)` =
  `650b05a10858571c66a4049affe2c19b6bce4cb4e17ad254e72e01283e4670a3` both runs,
  `cmp` clean; `VERITY_ROOT_HASH` =
  `5c0b6c7ec07594310502437ebe36dcb33cad7fedca4c9d5fcf851ecd2a030be8` both runs.
  (Changed from the previous turn because RFCT-015's health and machine-id
  units merged into the overlay.)
- `make os-image-cx3576-v2` — green. Ten partitions,
  `meta 16 + state 64 + var 512 + data 64 MiB`, image 1315 MiB,
  `sgdisk --verify` "No problems found".
- `make os-image-cx3576` + `make os-verify-cx3576` — **RESULT: PASS (88/88)**.

## curl added to the v2 allowlist (2026-08-18, user decision)

RFCT-015's health gate probes systemd, mosd and webd. The webd probe fetches
`https://127.0.0.1/healthz`, preferring `curl` and falling back to `wget`
(`os/health/mos-health`), and SKIPped because neither binary shipped — `rauc`
links libcurl but does not provide the executable.

A probe that skips is the failure class recorded above wearing another hat: the
gate was green and the gate was correct, it simply was not checking one of the
three things it claimed to cover. ~1 MB buys the third component.

Changed: `curl` added to the v2 package allowlist in `os/rootfs/Dockerfile.v2`,
documented in `os/rootfs/README.md` beside the rauc and libubootenv-tool
entries, as that file requires. `os/rootfs/Dockerfile` (v1) is untouched and
`os/health/**` is untouched — the probe already prefers curl, so shipping the
binary is the whole change. One line to revert if the size budget is revisited.

Deliberately not attempted: exercising the probe end to end. webd does not run
in a build container, so a live `/healthz` response is on-device behaviour and
stays with hardware acceptance. The deliverable is that the binary exists so the
probe stops skipping.

### Verification

- `make os-rootfs-cx3576-v2` — green. `TOTAL_MB` **216 -> 217** against the
  400 MB budget, i.e. **+1 MB**, leaving 183 MB of headroom. The curl chain is
  about 1 MB by dpkg Installed-Size: `curl` 537 KB, `libcurl4` 860 KB,
  `libssh2-1` 345 KB, `libnghttp2-14` 228 KB, `libpsl5` 152 KB, `librtmp1`
  142 KB (`libcurl3-gnutls` was already present for rauc).
- **Reproducibility**, two cache-hot runs:
  `sha256(rootfs-verity.img)` =
  `9ec8e97c19e7c4440a21431cd07210b319f1abd276eab74d061eaf5353bdeacd` both runs,
  `cmp` clean; `VERITY_ROOT_HASH` =
  `757e0831a06191412f636bc92fb2ece861b88f6b3d830f66838970cd3171b4a2` both runs.
  Both changed from the previous build, as expected — a new package changes
  rootfs content and the root hash covers it.
- **Binary present in the PACKED squashfs**, not merely in the Dockerfile:
  ```
  -rwxr-xr-x root/root  329888  squashfs-root/usr/bin/curl
  ```
  executable bit set, and `file` reports
  `ELF 64-bit LSB pie executable, ARM aarch64 ... dynamically linked`, with
  `libcurl.so.4 -> libcurl.so.4.8.0` present alongside it. This is the check
  that matters: the package being in the allowlist is not the same as the binary
  being in the image, which is exactly how `mos-mac`/`mos-gadget` shipped
  installed-but-disabled earlier in this task.
- `veritysetup verify` in a container, userspace, no host device-mapper: OK.
- `make os-image-cx3576-v2` — green. Rootfs payload 53 -> **54 MiB**, slot and
  image sizes unchanged (256 MiB slot, 1315 MiB image); `sgdisk --verify`
  "No problems found".
- `make os-devkeys && make os-bundle-cx3576` — green; bundle verifies against
  the dev keyring and its rootfs checksum matches the built image.
- `make os-image-cx3576` + `make os-verify-cx3576` — **RESULT: PASS (88/88)**,
  and `curl` does not appear in the v1 `rootfs-report.txt`, confirming the v1
  allowlist is unchanged.

## rauc-service added to the v2 allowlist (2026-08-18)

Third instance of the same failure shape in two days: an image that builds
clean, passes every check, and cannot do the one thing it exists for.

Confirmed the defect before changing anything rather than taking it on trust:

- The packed image contained `/usr/bin/rauc`, `/etc/rauc/system.conf` and
  nothing else RAUC-related — no `de.pengutronix.rauc.conf`, no
  `system-services/de.pengutronix.rauc.service`.
- `rauc` 1.8-2 `Depends: libc6, libcurl3-gnutls, libfdisk1, libglib2.0-0,
  libjson-glib-1.0-0, libssl3, dbus, systemd` — and has **no `Recommends` line
  at all**, so `--no-install-recommends` is not what dropped it. The dependency
  simply runs the other way: `rauc-service` `Depends: rauc`.

Debian's CLI is built *with* service support, so it never operates locally — it
proxies every call over D-Bus. Without the service package `rauc status` fails
with *"The name de.pengutronix.rauc was not provided by any .service files"*,
the health gate never marks the slot good, and every update rolls back.

`rauc-service` added to the v2 allowlist and documented in
`os/rootfs/README.md`. It is 47 KB.

### Unit ordering: nothing is needed, and here is why

`mos-health.service` calls `rauc status`, so the question is whether it needs an
ordering dependency on the D-Bus service. It does not, and the reasoning is
worth recording so the conclusion can be rechecked rather than re-derived:

- Activation is systemd-mediated, not `Exec`-forked:
  `de.pengutronix.rauc.service` carries `SystemdService=rauc.service`, so
  dbus-daemon asks systemd to start the unit on first call.
- `rauc.service` is `Type=dbus`, `BusName=de.pengutronix.rauc`,
  `After=dbus.service`. It is activated on demand and therefore needs no
  `[Install]` section and no enable step — nothing to wire up.
- `mos-health.service` is `After=multi-user.target` and `WantedBy=multi-user.target`.
  `dbus.service` is long since running by the time `multi-user.target` is
  reached, so the activation path is available whenever the gate runs.

The activation chain was verified to close *inside the packed image*: the
activation file names `rauc.service`, and `/usr/lib/systemd/system/rauc.service`
is present. A dangling `SystemdService=` would have been the same class of
silent gap as an installed-but-not-enabled unit.

`os/health/**`, `os/rauc/**`, `os/boot/**` and `os/mkimage-v2.sh` were not
touched.

### PLAN-006 contradiction — reported, not resolved

PLAN-006 Part F specifies RAUC built CLI-only (`-Dservice=false`, "no D-Bus, no
resident daemon; invoked as a short-lived process"). That does not hold for the
Debian packaging: its CLI *requires* the daemon, so shipping `rauc-service` is a
deviation from the plan, not an implementation of it. Adding the package is the
right call for M4 — building rauc from source to honour the CLI-only model is a
subproject, not a package line — but the plan says otherwise and this must not
be papered over. RFCT-019 owns recording it in PLAN-006's implementation notes.
Not edited here.

### Verification

- `make os-rootfs-cx3576-v2` — green. `TOTAL_MB` **217, unchanged**: at 47 KB
  by dpkg Installed-Size, `rauc-service` is below the megabyte rounding.
  183 MB of headroom against the 400 MB budget.
- **Reproducibility**, two cache-hot runs:
  `sha256(rootfs-verity.img)` =
  `7ea720d59892d2e127e32355edb094b206c2d3cd5bcc265280b9521ec5a25843` both runs,
  `cmp` clean; `VERITY_ROOT_HASH` =
  `fdb10b3d36c7f1946deb381c05e59ab3fdd47bacd764d835436e35ac2b86e8fd` both runs.
- **D-Bus files present in the PACKED squashfs**, paths and sizes quoted from
  `unsquashfs -ll`:
  ```
  -rw-r--r-- root/root  458  usr/share/dbus-1/system.d/de.pengutronix.rauc.conf
  -rw-r--r-- root/root  116  usr/share/dbus-1/system-services/de.pengutronix.rauc.service
  -rw-r--r-- root/root  238  usr/lib/systemd/system/rauc.service
  -rw-r--r-- root/root 4133  usr/share/dbus-1/interfaces/de.pengutronix.rauc.Installer.xml
  -rwxr-xr-x root/root  110  usr/share/rauc/rauc-service.sh
  ```
  The policy grants `own` to root and `send_destination` to default context.
- `veritysetup verify` in a container, userspace, no host device-mapper: OK.
- `make os-image-cx3576-v2` — green. Image 1315 MiB, `sgdisk --verify`
  "No problems found".
- `make os-devkeys && make os-bundle-cx3576` — green; bundle verifies and its
  rootfs checksum matches the built image.
- `make os-image-cx3576` + `make os-verify-cx3576` — **RESULT: PASS (88/88)**,
  and neither `rauc-service` nor `curl` appears in the v1 `rootfs-report.txt`,
  confirming the v1 allowlist is unchanged in content as well as in checks.

Not attempted: running `rauc status` end to end. There is no system bus and no
booted slot in a build container, so a live D-Bus round trip is on-device
behaviour and stays with hardware acceptance. What is verified here is that the
activation chain is complete in the image.

## Escalations

- `board/common/mos-required.fragment` on this branch's base (`fd6233f`) does
  **not** yet contain `CONFIG_SQUASHFS_XATTR`. The campaign brief states L1 has
  approved and applied it on master with the kernel artifact rebuild running on
  the L1 side; this branch predates that change and does not touch `board/**`.
  The image built here therefore packs xattrs that the currently-built kernel
  would ignore. Impact today is nil — `getcap -r` over the packed tree is empty
  — but the assumption must hold before any capability-carrying package is
  added.
- The board console/storage cmdline fragment
  (`console=ttyFIQ0,1500000 earlycon=uart8250,mmio32,0x2ad40000
  storagemedia=emmc net.ifnames=0`) lives in `build-v2.sh`, copied from v1's
  `APPEND`. It is a board fact, not a layout constant, so it does not belong in
  `os/layout/cx3576-v2.env`; a per-board build-time facts file is the right home
  if a second board ever needs a v2 image.

## ActiveForm

Packing the cx3576 root as squashfs+dm-verity and wiring up the read-only root.

## Dependencies

- **blocked by**: RFCT-020 (layout v2 constants + v2 image assembler)
- **blocks**: RFCT-014 (RAUC slot definitions), RFCT-015 (update flow +
  machine-id oneshot), RFCT-017 (v2 image contract verification),
  RFCT-018 (U-Boot A/B handshake)
