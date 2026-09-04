# PLAN-074 Build the x64 kernel in tree, with its own config

- **status**: implemented
- **createdAt**: 2026-09-03 19:21
- **approvedAt**: 2026-09-03 (the request itself; see *Approval boundary* for
  what it does and does not cover)
- **relatedTask**: [RFCT-295](../task/RFCT-295.md)

## Context

### The request

x64 stops shipping Debian's generic kernel and builds its own, with its own
config file, the way `boards/cx3576/bsp` does. Design first; implement only if
the design holds; recommend against with evidence if it does not.

### What x64 is today, measured

Read off the composed x64 root this tree last produced
(`localhost/mos-factory-root:x64`, kernel `6.12.107+deb13-amd64`):

| Fact | Value |
| --- | --- |
| `linux-image-6.12.107+deb13-amd64`, installed | 108 326 KB |
| Whole root, installed | 435 MB (budget 520 MB) |
| Kernel modules shipped | 4 230 `.ko`, 89.3 MiB |
| Exported `vmlinuz` | 11.6 MiB |
| Exported `initrd.img` | 35.5 MiB |
| Boot partition, per slot | 96 MiB, of which 47.1 MiB is kernel + initrd |
| Debian's `.config`, set symbols | 6 673 — 2 647 `=y`, 4 026 `=m` |

The kernel package alone is a quarter of the installed root. The initrd is a
third of a boot partition, twice, and is carried again inside the 298 MB RAUC
bundle.

### The three things this tree built on Debian's kernel being modular

1. **A second implementation of the boot contract.** `dm-mod.create=` on the
   kernel command line is one contract, written once by `rootfs/build.sh`. On
   cx3576 the kernel's own dm-init reads it. On x64 it is *ignored* — an unknown
   `dm_mod` parameter is dropped silently — so `rootfs/initramfs/scripts/mos-verity`,
   a klibc shell script with no `tr`, `sed`, `grep`, `awk` or `cut` available to
   it, re-parses that command line by parameter expansion and calls
   `veritysetup` itself.
2. **An initramfs built during the compose.** `rootfs/compose/10-compose.Dockerfile`
   declares `SOURCE_DATE_EPOCH` in the *environment* specifically because it is
   `linux-image-amd64`'s own postinst that runs `update-initramfs` there, and an
   unset value would bake the build clock and the host's inode numbers into a
   verity-covered root. `compose-install.sh` then asserts the result carries
   `veritysetup` and the local-top script, and `pack-export-boot.sh` asserts it
   again over the exported copy, plus RFCT-281's "no BusyBox in the initrd".
3. **A verification path that reads the artefact instead of the source.**
   `verify/src/checks-kernel.ts` exists because "the Debian config is not in this
   repository", and it accepts `=y` **or** `=m` — a relaxation it justifies as a
   board fact — then separately proves the `.ko` was actually packed.

### The measurement that decides this plan

`boards/common/mos-required.fragment` calls itself "the board-independent
runtime baseline, shared by every board", and says its lines "must be built-in
`=y`, never `=m`". Checked against the Debian config the x64 image actually
ships, of its 23 `=y` lines:

- **10 hold** (`SQUASHFS_ZSTD`, `SQUASHFS_XATTR`, `HUGETLBFS`, `HUGETLB_PAGE`,
  `TRACING`, `AUDIT`, `SECURITY`, `SECURITY_NETWORK`, `SECURITY_SELINUX`,
  `SECURITY_SELINUX_DEVELOP`);
- **12 are `=m`** (`BLK_DEV_DM`, `DM_VERITY`, `SQUASHFS`, `OVERLAY_FS`,
  `WIREGUARD`, `VLAN_8021Q`, `BRIDGE`, `VETH`, `NFT_FIB`, `NFT_FIB_IPV4`,
  `NFT_FIB_IPV6`, `NFT_FIB_INET`);
- **1 is absent entirely** (`DM_INIT`);
- and its `CONFIG_LSM` string — a line the fragment flags as "not covered by the
  `=y` assertion loop" — is a *different string* on Debian
  (`…,apparmor,selinux,smack,tomoyo,bpf,ipe` against the fragment's
  `…,integrity,selinux,bpf`).

**Nothing in the tree checks any of that.** The `=y` assertion loop runs inside
the cx3576 kernel Dockerfile, so it is enforced on exactly one board.
`checks-kernel.ts` covers 7 of the 23 symbols and accepts `=m` for all of them.
The `CONFIG_LSM` line is checked nowhere.

The same holds one level up. Of the 54 options the cx3576 kernel build asserts
`=y` — the USB gadget console, the storage stack, and the whole podman/netavark
netfilter surface — Debian's amd64 kernel has **45 as `=m`**, **1 absent**
(`USB_OTG`), and 8 as `=y`, several of those only because they are booleans
under a tristate parent that is itself `=m` (`NF_TABLES_INET=y` under
`NF_TABLES=m`).

So the shared floor is not shared. It is a cx3576 floor with an x64 sample
check bolted on, and that is a direct consequence of x64 not building its own
kernel.

## Proposal

### 0. Recommendation: build it

Three reasons, in the order they matter.

**The initramfs is a divergent second implementation of the boot contract, and
it has already caused a whole-board outage.** Its own source records the case:
commit `7bc518d` moved the verity format to `--no-superblock` and updated two of
the three consumers — the writer and the verifier — missing this script. "Since
that commit the hash tree begins exactly at `--hash-offset` … so an open without
the flag reads tree bytes as a superblock", and **every x64 image was
unbootable while cx3576 stayed green**, because cx3576's kernel takes the
cmdline directly and never runs this code. That is the shape of defect a second
implementation produces, and the only structural fix is to not have one. An
own kernel with `CONFIG_DM_INIT=y` deletes the file.

**The floor becomes a floor.** With an in-tree x64 kernel, the fragment is
merged before `olddefconfig` and asserted against the final `.config` on *both*
boards, by the same loop, at build time — the mechanism `docs/design/boards.md`
already states as the rule for adding a board. `checks-kernel.ts`'s `=y`-or-`=m`
relaxation expires with the board fact that justified it.

**The size is real and measured, not claimed.** 108 MB of kernel package and
35.5 MiB of initrd, against an image whose total is 435 MB and whose per-slot
boot partition is 96 MiB.

### 1. Where the config lives, and how drift is refused

**A fragment plus a recorded resolved config, both in tree, and the build
refuses a mismatch.**

```
boards/x64/bsp/kernel/config/x64.fragment    the intent   (~150 lines, reviewed line by line)
boards/x64/bsp/kernel/config/x64.config      the input    (the recorded olddefconfig result)
```

The build does: `x86_64_defconfig` → merge `boards/common/mos-required.fragment`
→ merge `x64.fragment` → `make olddefconfig` → **diff the result against
`x64.config` and fail on any difference**, printing the diff and the command
that refreshes it. Then the existing `=y` assertion loops run against the same
file.

Why not either half alone. cx3576's shape — one 216 KB full config — is
reviewable only in the sense that the *result* is in git; nobody reads 6 000
lines, and the reason each symbol is set is nowhere. A bare fragment over a
defconfig is the opposite failure, and the request names it: "a `make
olddefconfig` whose result is not recorded is a build input nobody reviewed."
Recording both makes the fragment the thing a human reviews and the resolved
config the thing a *diff* reviews — on a kernel bump you see exactly which
symbols upstream's defconfig moved underneath you, which is the only review that
scales.

Why a diff rather than a recorded hash. The tree's pin-and-refuse discipline
(`pkgs/rauc`) records a hash because there is nothing else to record about a
source tarball. Here there is: a hash says "something changed", a diff says
which symbol, and every refusal message in this repository is written to name
the cause rather than the symptom.

**Normalisation.** `CONFIG_CC_VERSION_TEXT`, `CONFIG_GCC_VERSION`,
`CONFIG_AS_VERSION`, `CONFIG_LD_VERSION`, `CONFIG_PAHOLE_VERSION` and
`CONFIG_RUSTC_VERSION` are toolchain-derived. The builder image is digest-pinned
so they are stable, but they encode the builder rather than the configuration.
Open question 7.1 decides whether to strip them from the recorded copy or leave
them in and accept that a builder bump moves the file.

### 2. The upstream pin

**Mainline stable, the same 6.12 LTS line Debian 13 ships, fetched by tag from
`git.kernel.org` and verified with `git archive | sha256sum` against a recorded
value — the `pkgs/rauc` discipline, unchanged.**

```
boards/x64/bsp/kernel/versions.env
  KERNEL_VERSION=v6.12.x
  KERNEL_SHA256=<recorded>
```

`PENDING` prints the computed hash and fails, with no environment variable that
softens it. That file is the sole statement of which kernel x64 runs.

Same line as Debian's, for `pkgs/rauc/versions.env`'s reason verbatim: it means
moving off the distribution package "changes exactly one thing at a time" — how
the kernel is built and configured, not which kernel runs. A jump to a newer
mainline at the same moment would make a boot failure ambiguous between the two.

Not cx3576's shape (`git fetch --depth=1 <commit>` plus a `rev-parse` assertion):
that pins a commit in a vendor tree that publishes no tags. A tag can be moved,
so a tag needs the content hash, which is exactly what rauc's discipline is for.
Not a release tarball either — `git archive` of a tag is a deterministic byte
stream over the source that is actually compiled, and a tarball can be re-rolled.

Cost, stated because it is the one unattractive part: a shallow clone of the
Linux tree at one tag is roughly 250–350 MB of fetch. Alternative 3 records what
a `cdn.kernel.org` tarball would buy and what it would cost.

### 3. What the config must contain, derived

Five groups. Every symbol below traces to something in this tree that needs it;
anything not traceable is not in the config.

**(a) The verity boot floor — the reason the initramfs can go.** `BLK_DEV_DM`,
`DM_INIT`, `DM_VERITY`, `SQUASHFS`, `SQUASHFS_ZSTD`, `SQUASHFS_XATTR`,
`OVERLAY_FS`, plus `CRYPTO_SHA256` and the `EFI_PARTITION` GPT support
`PARTUUID=` resolution needs. All `=y`; nothing can load a module before the
root exists. This is `boards/common/mos-required.fragment`, which the build
merges rather than copies.

**(b) The common floor, whatever it currently says.** The fragment is being
extended right now with eBPF, firewall and bridge symbols; this plan takes the
merged list at implementation time rather than a snapshot. §5 adds to it.

**(c) Root device and network for a generic x86_64 machine, built in.** The
storage controllers: `SATA_AHCI`, `BLK_DEV_NVME`, `SCSI` + `BLK_DEV_SD`,
`USB_XHCI_HCD` + `USB_STORAGE`, and `VIRTIO_PCI` + `VIRTIO_BLK`. The network:
`VIRTIO_NET`, `E1000`, `E1000E`, `IGB`, `IGC`, `R8169` — the four families that
cover essentially every industrial x86 board and every QEMU model. Console:
`SERIAL_8250` + `SERIAL_8250_CONSOLE` for `console=ttyS0`, and `VT` +
`FRAMEBUFFER_CONSOLE` + `SYSFB_SIMPLEFB` for `console=tty0`, both of which
`BOARD_CMDLINE_ARGS` names. Filesystems the layout mounts: `EXT4_FS` for META,
STATE, EPHEMERAL and DATA; `VFAT_FS` plus `NLS_CODEPAGE_437`, `NLS_ISO8859_1`
and `NLS_ASCII` for the ESP and the boot partitions.

Built in, not modular, and that is a deliberate reversal of Debian's choice: a
driver costs 50–200 KB built in, twenty of them cost ~2 MB, and building them in
removes the entire "was the `.ko` packed" failure mode that `checks-kernel.ts`'s
second check exists to catch.

**(d) The userland's own requirements.** systemd's floor (cgroup v2, namespaces,
`SECCOMP`, `DEVTMPFS`+`_MOUNT`, `TMPFS_POSIX_ACL`, `TMPFS_XATTR`, `FANOTIFY`,
`INOTIFY_USER`, `NET_NS`, `USER_NS`, `IPV6`, `UNIX`, `AUTOFS_FS`), and podman +
netavark's, which is the 54-option set the cx3576 Dockerfile already enumerates
and `tests/netavark-kernel-config-test.sh` already cites into pinned netavark
source. That list is taken as written, not re-derived.

**What is dropped from Debian's 4 026 modules, and why a generic x64 box still
boots.** Everything with no consumer in this image: sound, DRM and GPU drivers,
the entire wireless stack (`BOARD_RADIOS=""` on this board), media, industrial
I/O, staging, the non-shipping filesystems (btrfs, xfs, f2fs, NFS, CIFS, ZFS
shims), infiniband, SCSI transports beyond AHCI/NVMe/USB, and the long tail of
one-vendor PCI and USB device drivers.

**The claim being made, stated precisely, because it is the one that could be
wrong**: this is a kernel that boots the QEMU q35 machine the harness uses
(OVMF, `virtio-blk-pci`, `virtio-net-pci`, 8250 serial) and an x86 machine whose
root is on AHCI, NVMe or USB mass storage and whose NIC is Intel or Realtek. It
is **not** a kernel that boots an arbitrary x86_64 machine, and unlike Debian's
it never will be. §6 is where that trade is decided.

### 4. The initramfs: none

**Own kernel, no initrd. x64 boots the way cx3576 boots.**

With `CONFIG_DM_INIT=y` and the group-(a) symbols built in, `dm-mod.create=` on
the command line is read by the kernel's own dm-init and the root is assembled
before the mount. The command line does not change — it is already the same
string on both boards, "one boot contract, written once by `rootfs/build.sh`".
What changes is that x64 stops needing a second reader for it.

What that turns each existing assertion into:

| Today | Under an own kernel |
| --- | --- |
| `compose-install.sh` asserts the composed initrd carries `veritysetup` and the local-top script | Deleted. There is no initrd and no hook, so there is nothing whose dpkg ordering could go wrong. |
| `pack-export-boot.sh` asserts the *exported* initrd carries both | Replaced by the inverse: the export stages `vmlinuz` and **asserts no `initrd.img-*` exists in the root**. |
| `pack-export-boot.sh` asserts the initrd carries **no BusyBox** (RFCT-281) | **Must not be left as a vacuous pass.** With no initrd the grep searches nothing and reports green forever. RFCT-281's guarantee restates *stronger* — early boot has no userspace at all — and is asserted as the absence of an initrd, in one message that says so. `verify/src/checks-busybox.ts`'s initramfs-role check keeps its meaning, because the `/etc/initramfs-tools` and `/usr/share/initramfs-tools` trees it scans genuinely stop existing. |
| `checks-board.ts`'s `boot-slot-no-initramfs` is **inverted for x64** ("an x64 slot MUST carry `initrd-a` and `initrd-b`") | The inversion is removed. Both boards' slots must carry no initramfs; the check stops being board-conditional. |
| `boards/x64/grub.cfg` has an `initrd (…)/initrd.img` line per menuentry | Removed. `BOOT_SLOT_REQUIRED_FILES` drops `initrd.img`; `mkimage-x64.ts` and `bundle.ts` stop staging it. |
| `10-compose.Dockerfile` declares `SOURCE_DATE_EPOCH` because `update-initramfs` reads it from the environment | The stated reason expires. `compose-install.sh` requires the variable for other work, so the ARG stays — but its comment must stop claiming a reason that is no longer true. |

**Packages that leave the root**, subject to a closure re-check:
`initramfs-tools` (52 KB), `initramfs-tools-core` (166), `initramfs-tools-bin`
(44), `klibc-utils` (479), `libklibc` (98), `dracut-install` (100),
`cryptsetup-bin` (2 565), `libcryptsetup12` (652) — about 4.2 MB, and more
importantly an entire early-boot userland that no longer exists on the device.
`mos-board-x64`'s `Depends` on `linux-image-amd64`, `initramfs-tools` and
`cryptsetup-bin` becomes a dependency on the new kernel package alone.

### 5. What this removes from the shared floor

Once x64's kernel is ours, the unwritten constraint "the common floor must be
satisfiable by Debian's generic kernel" expires. The deferred list — symbols
cx3576 has that Debian lacks — is §Context's measurement: 45 of the cx3576
build's 54 asserted options are `=m` on Debian and 1 is absent.

**They do not all move to the common floor, and the split is by what kind of
fact each one is** — the rule the fragment already states ("Board-specific
requirements … belong in the board's own config, not here"):

- **Moves to `boards/common/mos-required.fragment`** — the container-engine
  facts, true of every board that ships podman: the netfilter and nftables set
  (`NF_CONNTRACK`, `NF_NAT`, `NF_TABLES`, `NFT_CT`/`MASQ`/`NAT`/`COMPAT`, the
  `NETFILTER_XT_*` matches and targets, the `IP_NF_*` and `IP6_NF_*` tables),
  `BRIDGE_NETFILTER`, and `CGROUP_BPF` — joining `VETH`, `BRIDGE` and the
  `NFT_FIB` family that are already there. These are exactly what
  `tests/netavark-kernel-config-test.sh` cites into netavark's own source, and
  the fragment already argues that case for the `NFT_FIB` set.
- **Stays in the board config** — `USB_OTG`, `USB_DWC3*`, `USB_GADGET`,
  `USB_LIBCOMPOSITE`, `USB_U_SERIAL`, `USB_F_ACM`, `USB_CONFIGFS*`: cx3576 has a
  USB gadget controller and a gadget serial console; a QEMU machine has neither,
  and `boards/x64/board.env` says so. So do `SCSI`, `BLK_DEV_SD` and
  `USB_STORAGE`: which controller finds the root is the definition of a board
  fact. `CONFIGFS_FS`, `USB_HID`, `HID_GENERIC` and `INPUT_EVDEV` follow the
  gadget stack.

Net effect: the fragment grows by roughly 25 lines, the cx3576 Dockerfile's
option loop shrinks by the same set (it stops restating what the fragment now
guarantees), and for the first time both boards enforce the same list by the
same mechanism.

**`checks-kernel.ts` changes meaning rather than being deleted.** Its `=y`-or-
`=m` relaxation and its modprobe-resolution walk both exist because Debian built
the kernel. Under an own kernel the build enforces the floor, so what is left
worth checking off the artefact is *provenance*: that the `/boot/config-<release>`
the image ships is byte-identical to the `x64.config` this tree built from. That
is a real property — it catches an image assembled against a stale kernel
package — and it is not the one the build already proves.

### 6. Where this would have been a recommend-against, and why it is not

The request asks for the honest fallback: if the driver surface for arbitrary
x86 hardware is the reason Debian's kernel is generic, say so and recommend
against.

**The evidence for that reading is one sentence, and it is a budget
justification.** `boards/x64/board.env` sets `BOARD_SIZE_BUDGET_MB=520` and
explains: "Debian's generic kernel carries a module set for all hardware —
which is what an industrial PC of unknown configuration actually needs, so it is
kept rather than trimmed."

**Every other statement in the tree says x64 is not that board.**
`docs/architecture.md`: "generic UEFI x86_64, the **QEMU and CI baseline**".
`docs/design/boards.md`: "QEMU/CI baseline. No `bsp/`, by design, not by
omission." `docs/website/hardware.md` lists it at **bring-up** tier and states
that the "x64 baseline has no dossier at all — so neither is presented as
mos-qualified." `boards/x64/board.env` itself opens by saying what the board is
for: proving in QEMU that a container actually starts, because the arm64 build
cannot. `BOARD_RECOVERY_ACTIONS=""` — x64 implements no physical recovery
action, because there is no physical x64.

So the recommend-against case rests on x64 being a hardware target it is
documented four times over not to be. The budget sentence is a true statement
about *why 520 and not 400*; it is not a commitment to boot arbitrary industrial
PCs, and nothing in the tree qualifies x64 on any hardware at all.

**The trade this plan accepts, stated plainly:** an own kernel narrows x64 from
"boots whatever Debian supports" to "boots QEMU, and x86 machines whose root is
AHCI/NVMe/USB and whose NIC is Intel or Realtek". If x64 is ever promoted from
bring-up to a qualified product tier for unknown hardware, **this decision must
be revisited**, and the revisit is cheap by construction: the answer is one
fragment file, and reverting is re-adding a `Depends`. The board dossier that a
promotion would require (`docs/bsp/board-template.md`) is the natural place for
that gate, and x64 has no dossier today.

### 7. Open questions — not guessed

1. **Recorded-config normalisation.** Strip the six toolchain-derived
   `CONFIG_*_VERSION*` symbols from `x64.config`, or keep them and accept that a
   `build-env/images.env` bump moves the recorded file? Keeping them is more
   honest (the toolchain *is* a build input) and noisier.
2. **`CONFIG_MODULES`.** With the whole boot path and the whole floor built in,
   is there any `=m` symbol left worth having? If the answer is none, does the
   kernel set `CONFIG_MODULES=n` — dropping `depmod`, `/lib/modules` and the
   module-loading surface — or `=y` with an empty module set so that
   `modules_install` still lays down a populated `modules.builtin` for a
   provenance check to read? An "is it resolvable" check over a directory that
   does not exist passes forever.
3. **Where the kernel is installed in the root.** `/boot/vmlinuz-<release>` plus
   `/boot/config-<release>`, which keeps `pack-export-boot.sh`'s existing branch
   and keeps the config readable by verify; or cx3576's
   `/usr/lib/mos/board/<board>/`, which is where the other board's kernel lives.
   This plan assumes the former; it is the smaller diff and the only one that
   leaves a config in the image to check.
4. **Whether the boot partition shrinks.** Removing the initrd frees 35.5 MiB of
   a 96 MiB partition. Shrinking `BOOT_SIZE_MIB` moves every partition start
   offset in `board.env` and every constant derived from them — a separate,
   mechanical, and independently reviewable change. Recommended: **not in this
   task.**
5. **Kernel build time on the pool path.** `board-x64` currently compiles
   nothing. A BSP build in front of it costs an estimated 10–25 minutes per
   architecture on this host, and `make os-debs` walks producers in sequence.
   Measure it before deciding whether the x64 kernel needs the same
   `PREFLIGHT=1` warn-don't-refuse treatment `podman` and `board-cx3576` have.

### 7b. How each one was answered

Recorded here rather than only at the decision sites, because §7 is what the
approval boundary excluded and these are the answers it asked for.

1. **Normalisation: strip.** The recorded `x64.config` carries set symbols and
   explicit `is not set` lines and drops the six toolchain-derived
   `CONFIG_*_VERSION*` symbols. `CONFIG_CC_VERSION_TEXT` is literally gcc's
   `--version` output; leaving it in would make every builder-image bump land
   as a config diff whose every line is about something else. The builder is
   digest-pinned one level up. Result: 4 587 lines, 1 687 built in.
2. **`CONFIG_MODULES=y`, with a tail of three.** The resolved config leaves
   `nf_log_syslog`, `xt_LOG` and `x86_pkg_temp_thermal` loadable and builds
   everything else in, so `modules_install` writes a `modules.builtin` of 395
   entries and a `modules.dep` that is short but not empty. That matters for
   the reason the question was asked: `verify/src/checks-kernel.ts` resolves
   names against those indexes, and an index that did not exist would make
   every lookup an answer about an absent directory. `CONFIG_MODULES=n` was not
   taken — it would have removed the index the check reads.
3. **`/boot`, as assumed.** `/boot/vmlinuz-<release>`, `/boot/config-<release>`
   and `/usr/lib/modules/<release>/`. The config in the image is what lets
   verify assert the floor off the artefact at all, and it is what would go red
   if a distribution kernel returned.
4. **Deferred, and `boards/x64/board.env` says so at `BOOT_SIZE_MIB`.** The
   headroom is now large and stated as deliberate; shrinking it moves every
   partition offset in the file and is its own reviewable change.
5. **~12 minutes cold on this host** (≈80 s shallow fetch, ≈10 s config, ≈10.5
   min compile at `-j$(nproc)`), and a warm rebuild reuses the buildx cache
   down to whichever layer changed. `kernel-x64` takes the same `PREFLIGHT=1`
   treatment as `board-cx3576` — its four artefacts are reported missing by
   name before `make os-debs` starts a container — but as *missing* rather than
   *warned*, because nothing in that run builds a kernel for itself.

### 7b-2. The boot, which is the only thing that could have refuted this

x64 booted in QEMU through OVMF and GRUB with **no initramfs**, and dm-init read
the same `dm-mod.create=` table `rootfs/build.sh` has always written:

```
[    0.000000] Linux version 6.12.107 (mos@mos-build) ... #1 SMP PREEMPT_DYNAMIC @1577836800
[    2.535609] device-mapper: init: waiting for all devices to be available before creating mapped devices
[    2.854721] device-mapper: init: waiting for device PARTUUID=5ac35760-0064-4000-8000-000000000005 ...
[    2.855451] device-mapper: init: all devices available
[    2.862262] device-mapper: verity: sha256 using shash "sha256-generic"
[    2.871008] device-mapper: ioctl: dm-0 (rootfs) is ready
[    2.952924] VFS: Mounted root (squashfs filesystem) readonly on device 252:0.
[    3.231650] Run /sbin/init as init process
```

Three seconds from power-on to `/sbin/init`, under TCG, with no userspace in
between. The `(mos@mos-build) ... @1577836800` in the banner is the pinned build
stamp: this kernel does not carry the wall clock or the builder's hostname.

### 7c. What the implementation changed about this plan

- **§1's diff gate found its first real defect immediately**, though not in a
  config: the first packed kernel carried `#1 SMP … Thu Sep 3 19:43:59 UTC 2026`
  and `root@buildkitsandbox`. `KBUILD_BUILD_TIMESTAMP`, `_USER` and `_HOST` are
  pinned to the 1577836800 the rest of the tree uses. Removing the initrd took
  away the composed-root comparison's one non-reproducible path; an
  unreproducible bzImage would have replaced it.
- **§3's size claim came out the other way round and is better for it.** The
  bzImage is 14.9 MB against Debian's 12.1 MB vmlinuz, because the drivers are
  built in rather than modular. What collapses is everything around it: 276 KB
  of modules against 89.3 MiB, and no 35.5 MiB initrd at all.
- **One claim in §4 was WRONG, and the measurement corrected it.** The table
  said `checks-busybox.ts`'s initramfs-role check "keeps its meaning, because
  the `/etc/initramfs-tools` and `/usr/share/initramfs-tools` trees it scans
  genuinely stop existing" — and a branch was written to state that absence
  categorically rather than report a count of zero. They do not stop existing:
  the composed root still carries five files under
  `/usr/share/initramfs-tools`, shipped by `udev`, `kmod` and `dmsetup`, which
  install hooks there without depending on the package that reads them. The
  branch was dead code justified by a false premise and was reverted; the
  measurement is recorded at the site so the next reader does not re-derive it.
- **A capability was lost, and it is ONE item with PLAN-073's, not two.** The
  shared floor's `CONFIG_LSM` ends in `bpf`; Debian's amd64 kernel set
  `CONFIG_BPF_LSM=y` and neither this kernel nor cx3576's does, so the booted
  machine says `bpf-restrict-fs: BPF LSM hook not enabled`. x64 lost a
  capability and gained agreement with the board that ships. PLAN-073 *Left
  owed* reached the same conclusion from the other side and carries the
  analysis -- the 6.1 dependency chain, why nothing in the image uses the hook,
  and that it is now unblocked on cx3576 by that task's `BPF_JIT`. It is not
  restated here; the flag lives at the LSM assertion in
  `boards/x64/bsp/kernel/Dockerfile` and the decision is PLAN-073's to close.
- **§5's `checks-kernel.ts` rework went further than "provenance".** Requiring
  the shipped config to declare the floor `=y` *is* the provenance check --
  Debian's amd64 config has twelve of those as `=m` and `CONFIG_DM_INIT` nowhere
  -- and it needs no second copy of the normaliser to compare against the
  recorded file. The resolution check tightened from "resolves" to "resolves as
  builtin" in the same move.

### 7d. The merge with PLAN-073, and what it changed here

PLAN-073 (`bkd/yp3us6yw`) landed first with the eBPF, firewall and bridge floor.
Two sessions picked the same identifiers within a minute; this record is
renumbered and theirs keeps PLAN-073/RFCT-294. The merge was semantic, not
textual:

- **`checks-kernel.ts` took the union of both registers.** Theirs is 25 symbols
  with an optional `module`, a `RESOLVABLE` half modprobe is asked about, and a
  `BUILTIN_ONLY` half the modprobe check names as skipped. That mechanism
  subsumes the `CONFIG_ONLY` list this plan had invented for `CONFIG_DM_INIT`,
  so the five boot-floor symbols joined `REQUIRED` in their shape and the
  separate list went away. **30 symbols, 21 resolvable, 9 module-less.** The
  acceptance stayed this plan's: `=y` and `builtin`, not `=y`-or-`=m` and
  "resolves".
- **The modprobe check would have gone hollow, and does not.** With every floor
  symbol builtin, no required name reaches `resolveModule`'s missing-object
  branch -- the sharpest thing that check did. Restricting the walk to the floor
  would have left it green forever having stopped looking. It is applied to the
  WHOLE of `modules.dep` instead, whose subjects are the modules this kernel
  really ships (12 of them). What still distinguishes the two checks is that
  they read different artefacts made by different steps: `/boot/config-*` is
  what the kernel was configured with, `modules.builtin` is what Kbuild
  generated and `modules_install` laid down, and a config that says `=y` beside
  an index that does not name the symbol is a root packed wrong.
- **`boards/common/mos-required.fragment` took THEIRS wholesale.** This plan had
  bulk-moved 34 symbols out of the cx3576 loop; theirs is the narrower, reasoned
  set that deliberately excludes the legacy `IP_NF_*` back-end, the
  per-extension xt matches and targets, and `NF_NAT_MASQUERADE`. Their file also
  records a hazard this plan's block would have tripped: `merge_config.sh` greps
  the whole file for each symbol it merges, so a COMMENT naming a symbol is
  reported as part of that symbol's value.
- **The cx3576 loop was recomputed, not hand-edited.** Keep = the original 54
  minus the merged fragment's set = **35**, so the 22 symbols the floor
  deliberately does not carry stay asserted where they always were. Dropping
  them silently was the regression this reduction could most easily have caused.
- **x64 needed two parents the shared floor does not pin.** The merged floor's
  `CONFIG_BRIDGE_NETFILTER` depends on `NETFILTER_ADVANCED`, which
  `x86_64_defconfig` leaves off -- and olddefconfig then drops the child from the
  config entirely rather than writing `is not set`. The x64 build's own fragment
  loop caught it by name. `CONFIG_NETFILTER` and `CONFIG_NETFILTER_ADVANCED` are
  in the BOARD fragment, not the shared one: they are what this board's starting
  point happens to lack, not something the product requires.

### 7e. Disk-encryption capability in the kernel — capability, not a feature

**Nothing is encrypted at rest after this section.** No volume is encrypted, the
image ships no cryptsetup, no LUKS header is formatted, there is no unlock path
and no policy. `docs/design/storage.md` still marks `encryption` unsupported and
`docs/design/security-model.md` §6 still says at-rest encryption proceeds only
through its own approved plan. **The gate above this is unchanged.** What ships
is three kernel symbols and their accelerated per-board counterpart.

**Why it lands in this task rather than its own.** A kernel symbol costs a
rebuild of every board, and x64's config is now built by *subtraction* — §3
drops the driver classes and filesystems nothing consumes. Debian shipped
`DM_CRYPT=m`; an unnamed symbol here is not merely absent, it is actively
removed. Naming it during a rebuild that was happening anyway costs nothing;
naming it afterwards costs two more kernel builds.

**A finding that changes what "cx3576 already had it" means.** cx3576's vendor
config contains no `CONFIG_DM_CRYPT` line at all — not `=y`, not `is not set`.
That is not a decision: the file also carries `# CONFIG_BLK_DEV_DM is not set`,
and `DM_CRYPT depends on BLK_DEV_DM`, so the symbol was *invisible* when the
config was saved and Kconfig wrote no line for it. The shared floor then merges
`BLK_DEV_DM=y`, which makes it visible at `olddefconfig` time — where, having no
`default`, it resolves to `n`. **So the crypt target was silently off on cx3576
as well, and naming it in the floor is the only thing that turns it on.** There
is no vendor-config line to edit.

**Derived, then corrected by measurement.** LUKS2's default is
`aes-xts-plain64`, so the target asks the crypto API for `xts(aes)`: the XTS
template plus an AES implementation. `plain64` is generated inside the target
and names no symbol; SHA256 is already required for dm-verity; argon2 is
cryptsetup's, in userspace. That reasoning gave three symbols. Regenerating the
config gave **six**: `DM_CRYPT` `select`s `CRYPTO_ESSIV` in 6.12 whether or not
the fragment asks for it — the argument that ESSIV is only needed for the LUKS1
`aes-cbc-essiv:sha256` default is true and irrelevant, because the dependency is
the kernel's — and `CRYPTO_AES_NI_INTEL` selects `CRYPTO_CRYPTD` and
`CRYPTO_SIMD`. The fragment says so at the site rather than keeping the
prediction.

**Generic in the floor, accelerated per board.** `CRYPTO_AES_NI_INTEL` and
`CRYPTO_AES_ARM64_CE_BLK` are the same idea under names that exist on one
architecture each, so a shared floor cannot name either. The floor requires the
generic `xts(aes)`; x64's fragment carries AES-NI and cx3576's board loop
carries CE_BLK, which its vendor config already sets.

**Marked as capability everywhere it appears.** The fragment block is separately
labelled, states that it is the only block whose entries name no consumer, and
carries its own exit condition: each line leaves when a consumer lands in the
image and moves into that consumer's justification, or the whole block is
deleted if the product decision goes the other way. `checks-kernel.ts` marks the
same thing in its register and its header. `docs/user/storage.md` and its
Chinese mirror carry one paragraph so that a reader cannot mistake a symbol list
for a shipped feature.

### 7f. `TRUSTED_KEYS` and `ENCRYPTED_KEYS` — priced, and NOT adopted

Asked for as a recommendation to come back to the user, not a change. **I
recommend against enabling either now.**

| | x64 (this kernel) | cx3576 (vendor 6.1) |
|---|---|---|
| `KEYS` | `=y` | `=y` |
| `ENCRYPTED_KEYS` | not set | not set |
| `TRUSTED_KEYS` | not set | not set |
| TPM stack | **`# CONFIG_TCG_TPM is not set`** — no TPM at all | `TCG_TPM=y`, `TCG_TIS_I2C_INFINEON=y` |

**What each depends on.** `ENCRYPTED_KEYS` needs only `KEYS` and selects HMAC,
AES, CBC, SHA256 and RNG — all cheap, and all but RNG already present. But it is
a key type whose payload is sealed by a *master* key, and its natural master is
a trusted key; alone it buys a container with nothing to lock it with.
`TRUSTED_KEYS` needs `KEYS` plus a backend: the TPM backend additionally wants
`TCG_TPM`, `ASN1_ENCODER` and `OID_REGISTRY`. On cx3576 that is three symbols.
**On x64 it is those plus an entire TPM subsystem and a TIS driver that §3
deliberately dropped.**

**Is it usable on arm64 over I2C, or merely compilable?** Usable in principle:
the trusted-key backend talks through the kernel's TPM chip abstraction, which
is bus-agnostic, and the Infineon part is a TPM 2.0. Two caveats decide the
recommendation. (1) **On x64 it would be compiled and unexercisable** — the QEMU
harness runs `-machine q35` with no `-tpmdev`, so the only x64 machine this
project boots has no TPM, and shipping a key mechanism no gate can execute is
the shape this repository refuses elsewhere. (2) **On cx3576 a trusted key would
bind to the chip but not to the boot state.** Sealing to PCRs needs something to
measure the boot chain, and nothing in this tree does: `CONFIG_FIT_SIGNATURE` is
configured nowhere, U-Boot extends no PCR. A key sealed to an unmeasured TPM
resists chip removal and not a modified boot chain — a materially weaker
guarantee than "device-bound" suggests, and one an unlock design would be likely
to over-read.

**Why waiting is free here and was not free for dm-crypt.** That asymmetry is
the whole argument. dm-crypt had to be decided in this task because the trimming
in §3 *removes* it; these two are already off on both boards and stay off
whether I act or not, so the rebuild-every-board cost is identical whenever it
is paid. Nothing is foreclosed by waiting, and choosing the key-sealing
mechanism before the unlock design exists is choosing the design.

**What I would do instead**, if the user wants to move: settle measured boot
first, because it is what makes a sealed key mean what people assume it means —
and only then pick between a TPM-sealed trusted key and an operator passphrase.

### 7g. Gate results, both boards, after the merge with PLAN-075

Everything below was run on **2026-09-04** against merge commit `8a886ccd`
(`main` at `3e3408fb`, which added the firewall check family), from artefacts
built out of this tree at pool stamp `0.1.0+git8a886ccd5b6d-1`. The earlier
`307/307` and `410/410` were measured before that merge and are superseded;
neither board is verified against a copied image any more.

| gate | result |
|---|---|
| `verify/run.sh --verify --board x64` | PASS 311/311, 0 FAIL, 22 skipped (x64/grub) |
| `verify/run.sh --verify --board cx3576` | PASS 414/414, 0 FAIL, 3 skipped (cx3576/uboot) |
| `pkgs/mosd/tests/apid-api/run.sh` (QEMU boot) | PASS 142/142 |
| `cd verify && bun test` | 1253 pass, 0 fail |
| `cd build && bun test` | 869 pass, 0 fail |
| `make docs-verify` | 43/43 PASS |
| x64 compose | 296 MB of 520 MB; smoke 12/12 |
| cx3576 compose | 384 MB of 400 MB |

The x64 kernel check reads `DM_CRYPT` out of the config the **shipped package**
carries, on the image that booted:

```
PASS: the shipped kernel config builds in BLK_DEV_DM, DM_INIT, DM_VERITY,
      SQUASHFS, OVERLAY_FS, DM_CRYPT, VLAN_8021Q, BRIDGE, WIREGUARD, VETH, ...
[    2.706957] device-mapper: ioctl: dm-0 (rootfs) is ready
[    3.031721] Run /sbin/init as init process
```

**The cx3576 image is now built from this tree.** Until this round it was copied
from the main checkout, so the board's earlier passes described that image and
not this branch. With the encryption kernel in place the copied image failed 7
checks -- 2 of them correctly reporting that `factory` BOOT-A/BOOT-B `Image`
no longer matched the local BSP artefact, which is exactly the staleness the
check exists to catch. Building the missing arm64 inputs here (U-Boot, the
arm64 podman binaries, seven arm64 producers) removed all 7.

### 7h. The netavark gate: a defect I introduced in round 2, and why its 69/69 was not what it looked like

**The defect.** `boards/x64/bsp/kernel/config/x64.config` carried
`# CONFIG_NF_CONNTRACK_MARK is not set`. netavark sets and matches a connection
mark on the dnat path (`src/firewall/nft.rs:286,1090` at the v2.1.0
`pkgs/podman/versions.env` pins), so on x64's own kernel published ports would
have broken the moment it shipped. cx3576 was unaffected: its board loop named
the symbol.

**Where it came from.** In round 2 I replaced my own 59-symbol floor with
PLAN-073's 41-symbol one wholesale. That dropped 22 symbols my floor had named,
and I compensated for them **only in cx3576's board loop** -- the board that
already had them. x64, whose config is decided by subtraction, got nothing. This
is the same failure this plan was written to fix, reintroduced by the merge that
was supposed to consolidate it.

**The fix.** `NF_CONNTRACK_MARK` and `NF_NAT_MASQUERADE` are engine facts, true
wherever netavark runs, so both are now in `boards/common/mos-required.fragment`
and cx3576's board loop no longer restates them. `NF_NAT_MASQUERADE` is
selected by `NFT_MASQ` on 6.12 and was therefore already `=y`; it is named
anyway, because a `select` is a fact about this kernel's Kconfig rather than a
requirement this tree states, and the gate asserts that every symbol netavark
needs is named by a floor that survives `olddefconfig` on every board.
Regenerating x64's config moved exactly one line, plus the two symbols that
`NF_CONNTRACK_MARK` makes visible:

```
-# CONFIG_NF_CONNTRACK_MARK is not set
+CONFIG_NF_CONNTRACK_MARK=y
+# CONFIG_NET_ACT_CONNMARK is not set
+# CONFIG_NET_ACT_CTINFO is not set
```

**Why the round-2 `69/69` cannot be reproduced, measured rather than argued.**
Running the test against each tree with `git archive <commit> | tar -x` and
executing it there:

| tree | result |
|---|---|
| `9ec4facc` (round 2, before the merge with PLAN-073) | **PASS 69/69** |
| `eeb98ca9` (round 2 head, after the rebuild) | **FAIL, 3 of 85** |

The run was real; the commit I attributed it to was not the tree it ran on. Two
things changed between them and both are visible in the number itself. The merge
brought PLAN-073's fourth assertion, which raises the total from 69 to 85 -- so
`69/69` is arithmetically impossible on the tree I reported it against, and the
count was the tell. And the rebuild regenerated `x64.config`, which is when
`NF_CONNTRACK_MARK` flipped to `is not set`. I did not re-run the gate after
either change.

**What that implies for the rest of the round-2 table**, since a wrong number
in it is worth naming precisely: the other gates in that table read artefacts
the commit rebuilt (`verify --board x64`, the QEMU boot, the two bun suites,
`docs-verify`), and every one of them was re-run in round 3 and again in round 4
against the current tree. This gate was the only one that read a *committed
config* rather than a built artefact, and it is the only one I did not re-run
after regenerating that config. The process fix is that it is now in the gate
table for every round.

**The rest of the netavark list, checked the same way.** With this change the
gate is `PASS 87/87`: all 17 symbols are `=y` in both boards' committed configs
and all 17 are named by a floor that both Dockerfiles assert after
`olddefconfig`. Nothing else on the list is missing on either board.

**Beyond the list, for the record and not fixed here.** Of the 22 symbols that
the round-2 floor swap dropped, 11 are still weaker on x64 than on cx3576, which
asserts them in its board loop: `NETFILTER_XT_MARK`,
`NETFILTER_XT_MATCH_ADDRTYPE`, `NETFILTER_XT_TARGET_MASQUERADE` and `IP_NF_NAT`
are `=m` on x64 (present, loadable once the root is up) while cx3576 builds them
in; `IP_NF_RAW`, `IP6_NF_NAT`, `IP6_NF_RAW`, `IP6_NF_TARGET_MASQUERADE`,
`NETFILTER_XT_TARGET_CHECKSUM`, `NETFILTER_XT_TARGET_CT` and
`NETFILTER_XT_TARGET_REDIRECT` are absent on x64 and `=y` on cx3576. netavark
does not use any of them -- it programs nftables directly -- so this is not the
defect above. It is the operator-facing `iptables` front-end that differs:
`iptables -j REDIRECT` works on cx3576 and fails on x64. PLAN-073's floor
excludes them deliberately as policy, so the resolution belongs with the
firewall work rather than here: either cx3576 stops asserting them or the floor
adopts them, but the two boards should not disagree silently.

## Risks

- **The QEMU harness is the only thing that will ever boot this kernel.** A
  missing symbol is found by a nine-minute boot that hangs, not by a compile
  error. Mitigation: the config's `=y` assertion loop runs at build time over
  every fragment line, and the first implementation step is a boot, not a
  package.
- **`x86_64_defconfig` moves between kernel versions.** That is the risk the
  recorded-config diff exists to make visible; it turns a silent drift into a
  refused build with the symbol list printed.
- **Hardware narrowing.** §6. Real, accepted, revisit-gated on a dossier.
- **Build time and fetch size** enter the package pool path. Open question 7.5.
- **The concurrent kernel-floor task moves `mos-required.fragment` underneath
  this work.** Mitigation: merge `main` before landing and take the merged list;
  §5's additions are stated as a delta, not a rewrite.
- **`make os-debs` is not safe against a tree that changes while it runs** — the
  pool version is read per producer. Adding a slow producer widens that window.

## Scope

**In.** A `boards/x64/bsp/` kernel build (Dockerfile, `versions.env`, fragment,
recorded config, Makefile target replacing the current `x64-%` refusal); a
kernel package producer and its control, copyright and licence record;
`mos-board-x64`'s dependency change; deleting `rootfs/initramfs/`; the assertion
changes in `compose-install.sh`, `pack-export-boot.sh`, `checks-board.ts`,
`checks-busybox.ts` and `checks-kernel.ts`; `grub.cfg`, `board.env`,
`mkimage-x64.ts` and `bundle.ts` dropping the initrd; the §5 fragment additions
and the matching cx3576 Dockerfile reduction; the affected design docs and their
Chinese translations.

**Out.** Shrinking `BOOT_SIZE_MIB` (open question 7.4). Any change to cx3576's
kernel, source pin or patch series. Signing the kernel or enabling Secure Boot.
`docs/plan/index.md`, `docs/task/index.md` and `docs/CHANGELOG.md`, which this
session was told not to touch.

## Alternatives

1. **Keep Debian's kernel; do nothing.** Costs nothing today. Leaves the floor
   enforced on one board, the boot contract implemented twice, and 144 MB of
   kernel and initrd in a 435 MB image. Rejected: §0's first reason is a defect
   class, not a preference.
2. **Keep Debian's kernel; extend `checks-kernel.ts` to assert all 23 fragment
   lines and the `CONFIG_LSM` string off the shipped config.** Cheap, and it
   would close the measurement gap in §Context — but it would close it *red*:
   12 lines are `=m` and one is absent, so the check cannot pass until either
   the fragment stops claiming `=y` or the kernel changes. It is a way of
   writing down the problem, not of fixing it. Worth doing as a one-line
   fallback if this plan is rejected.
3. **Pin the source as a `cdn.kernel.org` tarball rather than a git tag.** ~140
   MB instead of ~300, and upstream publishes a detached signature. Rejected for
   now: it is a second pin-and-verify discipline, and the request says not to
   invent one. Revisit if fetch time dominates open question 7.5.
4. **A full config file, cx3576's shape, with no fragment.** One file, one
   mechanism, matches the other board exactly. Rejected: 216 KB of generated
   text is reviewable only as a diff, and without a fragment there is nowhere to
   write down *why* a symbol is set — which is the whole content of §3.
5. **Own kernel, but keep the initramfs.** Would preserve every existing
   assertion unchanged and reduce the diff considerably. Rejected: it keeps the
   second implementation of the boot contract, which is the main thing being
   bought, and pays 35.5 MiB per boot partition for it.

## Approval boundary

The user asked for this work directly and that request is recorded as the
approval for §0's recommendation and for §§1–5 as the design of it. Implementing
those sections needs no further gate.

**What the approval does not cover.** The five open questions in §7 are
decisions, not details; each is answered in the implementation with the answer
and its reason written at the decision site, and 7.4 (shrinking the boot
partition) is explicitly deferred out of this task rather than answered. If the
first QEMU boot shows that a usable generic-x86 config is materially larger than
§3 describes — say, if the driver set needed to keep this board honest
approaches Debian's — that is the §6 fallback firing late, and it is reported
rather than absorbed.

## Implementation backlog

Estimated separately from the design, and ordered so that the risk is retired
first: nothing is packaged until a kernel this tree built has booted.

| # | Step | Verify | Est. |
| --- | --- | --- | --- |
| 1 | `boards/x64/bsp/kernel/` — Dockerfile, `versions.env` with the `PENDING` pin, `x64.fragment`, `make x64-kernel` | the pin refuses `PENDING` and prints the hash; a `bzImage` is produced | 0.5 d |
| 2 | Record `x64.config`; add the olddefconfig diff gate and the fragment `=y` assertion loop | mutate one fragment line and require the build to go red naming it | 0.5 d |
| 3 | Boot it in QEMU by hand against the existing image, with `dm-mod.create=` and no initrd | reaches userspace; `/dev/dm-0` exists; root is squashfs | 0.5–1 d |
| 4 | `kernel-x64` producer → `mos-kernel-x64`, with copyright and licence record; `mos-board-x64` depends on it instead of `linux-image-amd64`/`initramfs-tools`/`cryptsetup-bin` | `make os-deb-kernel-x64`; `os-deb-package-gate`; `os-install-closure-gate` | 1 d |
| 5 | Delete `rootfs/initramfs/`; rework the assertions in `compose-install.sh` and `pack-export-boot.sh`, including RFCT-281's restatement | compose green; the no-initrd assertion goes red when an initrd is planted | 0.5 d |
| 6 | Drop the initrd from `grub.cfg`, `board.env`, `mkimage-x64.ts`, `bundle.ts`; un-invert `checks-board.ts` | `bun test` in `build/` and `verify/`; `--mkimage-x64` | 0.5 d |
| 7 | Repoint `checks-kernel.ts` at config provenance; drop the `=m` relaxation | `verify/run.sh --verify`; a planted wrong config goes red | 0.5 d |
| 8 | §5 fragment additions; shrink the cx3576 option loop by the same set | `make os-netavark-kernel-test`; cx3576 kernel build green | 0.5 d |
| 9 | Full composed image + `os-apid-api-test` + `verify/run.sh --verify` + manifest/SBOM naming the kernel package | all green; record the new installed size against the 520 MB budget | 1 d |
| 10 | `docs/design/boards.md`, `docs/design/ro-root.md`, `docs/architecture.md`, `docs/website/hardware.md` and the `docs/zh/` translations | `make docs-verify` | 0.5 d |

**Total: 6–7 days.** Steps 1–3 are the ones that can invalidate the plan; if
step 3 does not boot, stop and report rather than widening the config until it
does.
