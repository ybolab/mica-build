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
  (`cmp` clean, sha256
  `741aed4eb4e3452d6e13b9259853b22018db65c0cefb84dadeb38bc80d340c25` both
  times), `VERITY_ROOT_HASH` unchanged
  (`bb710ec6090a6acdca98765f0f646a1b89bab0145ab18d92443e4a8fd311acd7`).
- **Verity integrity**: `veritysetup verify` (userspace, no device-mapper) in a
  throwaway container returns OK against the recorded root hash;
  `veritysetup dump` confirms the pinned salt, the pinned UUID
  `5ac35760-0002-4000-8000-000000000005` and sha256/4096/4096.
- **squashfs**: `unsquashfs -s` reports zstd level 19, superblock time
  2020-01-01T00:00:00Z, not exportable via NFS. `/var` is an empty mountpoint,
  `/usr/share/factory/var` holds the tree, `/etc/ssh` carries no host key, and
  the rendered `fstab` / `fw_env.config` contain lowercased GUIDs and no
  placeholder.
- `make os-image-cx3576-v2` — green. Resolved `SLOT_MIB 256` (the pin; the
  53 MiB payload would only have required 80), boot 64+64 MiB, **total image
  803 MiB / 842006528 bytes**. `sgdisk --verify`: "No problems found".
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
