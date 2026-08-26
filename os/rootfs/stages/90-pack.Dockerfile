# syntax=docker/dockerfile:1@sha256:ecfaec9ed6d810b56388c508f4121597bfbba70d41a6dfeee4d8cad5f295fc32
# =============================================================================
# stages/90-pack — close the root, then pack it: squashfs-zstd + dm-verity
#
# THE LAST LINK IN THE CHAIN; stages/README.md says what the chain is. This is
# the only stage file with more than one FROM of its own, and the reason is
# worth stating rather than discovering.
#
# FOUR STAGES IN ONE FILE, AND WHY.
#
#   closed        FROM the previous chain tag, on the TARGET platform. The last
#                 three things done to the device root: take the package
#                 inventory, remove package management, write the build report.
#                 They are here rather than in 10-base because they are ordered
#                 LAST by construction -- dpkg-query has to see every package
#                 any feature or board stage installed, and the purge has to be
#                 the last step that needs dpkg. A "floor" stage cannot hold a
#                 step that must run after everything.
#   pack          FROM bookworm, on the BUILD platform. Packing is a build-host
#                 job: it runs mksquashfs and veritysetup over a tree, never
#                 executes anything from it, and so does not want emulation.
#   artifact      FROM scratch, the export surface the driver writes out.
#   factory-root  FROM scratch, on the TARGET platform: the packed root ITSELF
#                 as an OCI image, so RFCT-113's smoke runner can execute the
#                 self-built binaries in the root that ships them. TWO EXPORT
#                 SURFACES, not one, because they are different kinds of thing:
#                 `artifact` is files the assembler consumes, `factory-root` is
#                 an image a runtime consumes, and buildkit exports one target
#                 per invocation. The driver builds this one second, off the
#                 cache the first filled.
#
# The alternative was a fourth stage FILE between 40-board and this one, for
# `closed` alone. It was not taken: closing the root and packing it are one
# operation with one output, nothing else can run between them, and a stage
# boundary that nothing can ever be inserted at is a file that only costs a
# reader a hop.
# =============================================================================

# THE LINK BACK UP THE CHAIN. MOS_STAGE_PREV is the local image tag the
# previous stage was written to; the driver passes it and refuses to build a
# stage that does not declare it. There is no default, so this file cannot be
# built standalone against whatever `FROM` happened to be typed.
#
# MOS_IMAGE_DEBIAN_BOOKWORM is this file's own base, injected from
# os/build-env/images.env by os/build-env/from.sh exactly as stages/10-base's
# trixie key is, and declared here because the `pack` FROM below is the only
# line in the chain that consumes it. RFCT-108 M2c pinned it: the byte layout
# of the packed image used to depend on whichever squashfs-tools and cryptsetup
# came out of a floating `debian:bookworm-slim`, so the pack tools are now a
# decision rather than a build date. No default, for the reason 10-base gives.
ARG MOS_STAGE_PREV
ARG MOS_IMAGE_DEBIAN_BOOKWORM

# ---------------------------------------------------------------------------
# Close the device root: inventory, purge, report
# ---------------------------------------------------------------------------
FROM ${MOS_STAGE_PREV} AS closed

# Package inventory. Split from the size measurement below because the package
# manager is removed in between: dpkg-query needs /var/lib/dpkg, and TOTAL_MB
# has to weigh the root that actually ships.
RUN dpkg-query -W -f='${Package}\t${Installed-Size}\n' > /rootfs-report.pkgs

# The exact RAUC the image will run, recorded so the thing that BUILDS bundles
# can refuse to build one with a different version.
#
# The bundle format and the slot model are a contract between two programs that
# never meet: rauc on a build machine writes the bundle, rauc on the device
# installs it. Nothing made them the same version. os/update/bundle.sh built in a
# bookworm container (1.8) while the image ran Debian 13's (1.13) -- and 1.8
# would have refused this board's slot model outright had anyone asked it,
# which is how the mismatch was found: not by a check, by a failure.
#
# /rootfs-report.rauc is written where rauc is INSTALLED, further up, from the
# version os/update/rauc/ pinned. It used to be `dpkg-query -W rauc` here; there is no
# rauc package any more.

# ---------------------------------------------------------------------------
# Remove package management from the packed root
# ---------------------------------------------------------------------------
# Nothing can install a package on this device. The root is a read-only
# dm-verity squashfs and updates arrive as whole RAUC slots, so apt, dpkg and
# the perl-base dpkg pre-depends on are BUILD-time tools. Shipping them costs
# ~21 MB of dead weight and hands a working package manager to anyone who
# reaches a shell on a device whose whole security model is that its root
# cannot change.
#
# MEASURED BEFORE REMOVING, not assumed:
#   - Nothing in overlay-v2, in mosd or in apid invokes dpkg or apt at runtime.
#     The only two mentions in the overlay are comments.
#   - Every perl script in the image is maintainer-script tooling that runs
#     during installation and never after: deb-systemd-helper,
#     deb-systemd-invoke, debconf-*, ucf*, and the /usr/sbin set — adduser,
#     deluser, update-rc.d, pam-auth-update, pam_getenv, dpkg-fsys-usrunmess.
#     They are removed here too — a script whose interpreter is gone is a trap,
#     not a leftover.
#
#     TWO OF THESE CHECKS WERE KEYED TO BOOKWORM AND THE TRIXIE UPGRADE FOUND
#     IT: the licence assertion named `gcc-12-base/copyright` (trixie ships
#     gcc-14) and the purge list named `perl5.36.0` (trixie ships 5.40). Both
#     now test the PROPERTY -- a copyright count, a version glob -- rather than
#     a package that happened to be in one release. A check pinned to a version
#     of the thing it is checking fails on the upgrade it exists to survive.
#
#     THE apt AND dpkg TIMERS WERE FOUND BY BOOTING x64, and they were in the
#     SHIPPED arm64 image too. Removing /usr/bin/apt does not remove
#     apt-daily.timer, apt-daily-upgrade.timer or dpkg-db-backup.timer, and all
#     three are enabled by their packages into
#     /etc/systemd/system/timers.target.wants. On a device with no package
#     manager they fire daily and fail daily. Nothing in the image was wrong
#     enough to notice -- it took a console log from a board that had never
#     been booted before.
#
#     linux-base's FOUR HELPERS WERE FOUND THE SAME WAY, ON A DIFFERENT
#     ARCHITECTURE. They arrive with linux-base, which x64 pulls in through
#     linux-image-amd64 and cx3576 never installs, so the first amd64 build
#     failed here. The whole set was enumerated at once rather than one build
#     at a time -- the mistake this comment already records is surveying
#     partially and reading the result as complete.
#
#     Callers measured, not assumed, and they are NOT all the same:
#       linux-check-removal, linux-run-hooks, linux-update-symlinks
#           called only from the kernel package's preinst/postinst/prerm/postrm
#       linux-version
#           called by /usr/sbin/update-initramfs, which is a RUNTIME tool
#
#     update-initramfs goes too, and that is the decision worth stating: on a
#     read-only dm-verity root it cannot write an initramfs anywhere that would
#     be used. The initrd this image boots sits on the ESP, outside the verity
#     tree, and is replaced by RAUC as part of the same signed bundle as the
#     rootfs. A tool that appears to regenerate it would produce a file nothing
#     reads.
#
#     THE /usr/sbin SET WAS FOUND BY THE CHECK BELOW, NOT BY THE SURVEY. The
#     survey that preceded this step listed the /usr/bin ones and was truncated
#     before it reached /usr/sbin; the list was read as complete. The build then
#     failed here and named all six. Recorded because the surveying mistake is
#     the likely one to repeat, and because it is the reason the check is a
#     build failure rather than a warning.
#
#     adduser and deluser are safe to remove for a second, independent reason:
#     /etc/passwd is inside the read-only verity root (only /etc/shadow is
#     symlinked onto STATE), so no account can be created on a running device
#     whether or not the tool is present.
#   - dash, grep and gzip declare `Pre-Depends: dpkg`. That is a packaging-time
#     relation, not a runtime one; their binaries never call it.
#   - gpgv is reachable only from apt-key.
#
# /usr/share/doc IS KEPT, deliberately, and this is where the usual "slim
# image" recipe goes wrong. It is 2.75 MB, of which 2.06 MB is 159 `copyright`
# files — the licence texts Debian ships to satisfy the redistribution terms of
# the GPL and friends. Deleting the directory would save 0.69 MB of changelogs
# and breach those terms to do it.
#
# coreutils and openssh-client are also kept, by decision rather than by
# oversight: coreutils is 17.6 MB and busybox would save most of it, but every
# script in the image and in the verifier would then be running against
# different tool semantics; openssh-client is 5.7 MB and outbound ssh/scp is a
# field-support capability, not packaging residue.
#
# The self-checks below are what make this step able to FAIL. A purge that
# silently removed too much would otherwise surface as a device that does not
# boot, on hardware, days later.
RUN --mount=type=bind,source=os/rootfs/scripts,target=/mos-scripts \
    sh /mos-scripts/package-manager-purge.sh

# Build report (moved out of the tree by the pack stage; never ships in the
# image). TOTAL_MB is measured HERE, after the purge, so the budget gate in
# build-v2.sh weighs the root that ships rather than the one that was built.
RUN { cat /rootfs-report.pkgs; \
      echo; \
      echo "RAUC_VERSION $(cat /rootfs-report.rauc)"; \
      echo "TOTAL_MB $(du -sxm --exclude=/proc --exclude=/sys --exclude=/dev / 2>/dev/null | cut -f1)"; \
    } > /rootfs-report.txt && rm -f /rootfs-report.pkgs /rootfs-report.rauc

# ---------------------------------------------------------------------------
# Pack: squashfs-zstd + appended dm-verity hash tree
# ---------------------------------------------------------------------------
FROM --platform=$BUILDPLATFORM ${MOS_IMAGE_DEBIAN_BOOKWORM} AS pack
# ARG IS PER-STAGE. BOARD_RADIOS is declared again here because the pack stage
# asserts properties of the assembled root that depend on it -- which board
# state directories are precious, and therefore which mount units must exist.
# Declared once in an earlier stage file, it expands EMPTY here, and under
# `set -u`
# that is a build failure rather than a wrong answer. This one failed loudly;
# the dangerous version of the same mistake is a check that silently reads an
# empty value as "no radios" on a board that has them.
ARG BOARD_RADIOS=""
RUN apt-get update && apt-get install -y --no-install-recommends \
        squashfs-tools cryptsetup-bin libcap2-bin \
        initramfs-tools-core \
    && rm -rf /var/lib/apt/lists/*
COPY --from=closed / /rootfs/

# Guard the mos-owned files against CJK text (repo rule: code and docs are
# English). Same mechanism and same character ranges as the v1 pack stage, with
# the v2-only paths added: the overlay's mount units, seed scripts, repart.d
# definitions and fw_env.config. Only our own paths are scanned; vendor
# packages ship translations and are none of our business.
RUN --mount=type=bind,source=os/rootfs/scripts,target=/mos-scripts \
    sh /mos-scripts/pack-cjk-guard.sh

# Tree surgery that cannot happen in the rootfs stage, either because buildkit
# bind-mounts the file during RUN or because it would break dpkg.
#  - /etc/resolv.conf -> /run, the only writable place with / read-only.
#  - /etc/machine-id must EXIST and be empty: systemd cannot write it on a
#    read-only /etc, and falls back to bind-mounting a transient id from /run
#    over it. RFCT-018's U-Boot passes systemd.machine_id= to make it stable.
#  - /var becomes an empty mountpoint for EPHEMERAL; the built tree moves to
#    /usr/share/factory/var, from where mos-seed-var restores it on first boot.
#  - EXCEPT /var/tmp, which is created in that mountpoint on purpose.
#
#    "Empty mountpoint" is right for everything a running system uses, and
#    wrong for the window BEFORE the mount. systemd-resolved.service is ordered
#    `Before=sysinit.target`, so it starts ahead of local-fs.target and sees
#    the image's own /var. Its PrivateTmp= mounts a tmpfs on both /tmp and
#    /var/tmp, and a mount point that does not exist cannot be created on a
#    read-only root -- the service dies with 226/NAMESPACE on every boot and
#    every restart.
#
#    Nothing about that failure names /var/tmp. The console says "[FAILED]
#    Failed to start systemd-resolved.service" and the child's own message
#    never reaches the journal, because it dies during namespace setup. What it
#    costs is ALL DNS: /etc/resolv.conf is a symlink to resolved's stub, so the
#    device cannot resolve an update server, an MQTT broker or a container
#    registry.
#
#    Created HERE and not with the other mountpoints above: this mkdir replaces
#    /var wholesale, so anything an earlier stage put there is gone. The first
#    attempt at this fix did exactly that and changed nothing.
RUN --mount=type=bind,source=os/rootfs/scripts,target=/mos-scripts \
    sh /mos-scripts/pack-tree-surgery.sh

# /var is declared DISPOSABLE (fixed-size EPHEMERAL, wipeable for log
# cleanup), and that contract is only real if nothing that matters lives there.
# Assert it instead of trusting the design: every precious path under /var must
# be redirected onto STATE by a bind mount that is actually ENABLED, and its
# mountpoint must exist in the factory /var that gets restored on first boot.
# A silently-missing bind here would mean losing the apid admin password hash
# or every Bluetooth pairing on a /var wipe.
RUN --mount=type=bind,source=os/rootfs/scripts,target=/mos-scripts \
    sh /mos-scripts/pack-assert-var-disposable.sh

# PLAN-011 D5's writable unit directory. Deliberately NOT folded into the loop
# above: that loop is about /var being disposable and ends by requiring a
# /usr/share/factory template, which is right for /var/lib/mos and wrong here --
# there is no factory content for this directory and, by design, no seed copy at
# all. Bending the loop to skip its last step for one member would make the loop
# say less about the members it was written for.
#
# What this defends is different too. The bind is what makes a third-party unit
# survive a reboot; its mountpoint cannot be created at runtime on a verity root,
# so a missing directory here is a mount unit that FAILS AT BOOT rather than a
# feature that quietly does nothing.
RUN --mount=type=bind,source=os/rootfs/scripts,target=/mos-scripts \
    sh /mos-scripts/pack-assert-extension-dir.sh

# /etc/shadow moves onto STATE. PLAN-010 M5 gives every device its own root
# password, and pam_unix reads it from /etc/shadow -- which on v2 sits on the
# dm-verity squashfs, where nothing can ever write it. The only writable paths
# under /etc are the /etc/hostname and /etc/ssh binds, and a bind-mounted FILE
# cannot be replaced by rename, which is how mosd writes a credential safely.
# So the file ships as a SYMLINK into /var/lib/mos, the bind target of
# var-lib-mos.mount, whose source is /mnt/state/mos. The image copy is retained
# at /usr/share/factory/etc/shadow -- systemd's standard place for a factory
# template, the same idea this stage already uses for /var -- and
# mos-shadow-reconcile derives the STATE file from it on every boot.
#
# /etc/passwd and /etc/group deliberately stay in the image, read-only: only the
# secret-bearing file moves, so account definitions remain part of the signed,
# verity-covered root.
#
# Done here and not in the rootfs stage because every package postinst still
# needs a real file: a tool like chpasswd would follow a symlink laid down
# earlier and write through it.
RUN --mount=type=bind,source=os/rootfs/scripts,target=/mos-scripts \
    sh /mos-scripts/pack-shadow-relocate.sh

# Assert the whole chain, at build time, so it can only pass for the intended
# artifact. Each of these is a defect that would otherwise be invisible: a
# regular /etc/shadow shadowing the symlink, a factory copy the reconciler
# cannot read, a unit installed but never enabled, an ordering directive naming
# a unit that does not exist (systemd drops those silently), or a real password
# hash baked into a rootfs that is byte-identical across the entire fleet.
#
# The locked-password test runs over EVERY account in /etc/passwd, not just
# root. RFCT-024 wrote the rule -- an empty field is not a locked marker, it is
# passwordless -- when root was the only account there was to write it about.
# RFCT-039 adds `mos` as the second, so scoping the test to root would have let
# the rule quietly stop covering the case it exists for, and would leave the
# third account exposed all over again. root keeps its own dedicated case
# above it because a baked root credential is the single most likely way a
# hash reaches this file (v1 still has a ROOT_PASSWORD build arg; v2 does not,
# and this assertion is what keeps it that way); the loop below is the class,
# not the instance.
#
# The two failure modes get two messages on purpose. They are different
# defects: an EMPTY field means the account accepts any password, while a
# USABLE HASH means a credential that every device in the fleet shares. A
# single message would let one be diagnosed as the other.
RUN --mount=type=bind,source=os/rootfs/scripts,target=/mos-scripts \
    sh /mos-scripts/pack-assert-shadow-chain.sh

# Privilege inventory of the SOURCE tree, captured before packing so the packed
# image can be diffed against it. Numeric uid/gid deliberately: the tree is
# arm64 Debian but this stage runs on the build platform, whose /etc/passwd
# cannot resolve ids like _ssh or messagebus, so names would not round-trip.
# %M is the symbolic mode, which is exactly what `unsquashfs -lln` prints, so
# the two inventories are directly comparable.
RUN find /rootfs -xdev -perm /6000 -printf '%M %U %G %P\n' 2>/dev/null \
        | sort > /out/privileged-src.txt

# File capabilities depend on xattrs surviving both the buildkit layer export
# and CONFIG_SQUASHFS_XATTR in the kernel, so they are recorded rather than
# assumed. This is the tripwire for the day a capability-carrying package is
# added to the allowlist.
RUN { echo; \
      echo "== file capabilities =="; \
      getcap -r /rootfs 2>/dev/null | sed 's|^/rootfs||' | sort; \
    } >> /out/rootfs-report-v2.txt

# ---------------------------------------------------------------------------
# Pack, in three steps so each can carry its own explanation and cache
# independently: squash, assert, then hash.
# ---------------------------------------------------------------------------
ARG VERITY_SALT
ARG VERITY_UUID
ARG SQUASHFS_TIME
ARG VERITY_HASH_ALGO=sha256
ARG VERITY_DATA_BLOCK_SIZE=4096
ARG VERITY_HASH_BLOCK_SIZE=4096

# Step 1 — squash. Every knob that would otherwise vary between builds is
# pinned:
#   -processors 1         multi-threaded mksquashfs is NOT byte-reproducible
#   -mkfs-time/-all-time  no wall clock in the superblock or in any inode
#   -noappend             never merge into a pre-existing image
#   -no-exports           drop the NFS export table (unused, extra bytes)
#
# There is deliberately NO -all-root, and no -force-uid/-force-gid either. They
# rewrite ownership but NOT mode bits, so every setgid binary whose group was
# not root would ship setgid-ROOT: ssh-agent (_ssh), chage / expiry /
# unix_chkpwd (shadow), dbus-daemon-launch-helper (messagebus). That widens a
# privilege boundary inside the one part of the system that is supposed to be
# the trustworthy part. It also breaks unix_chkpwd in the other direction: it
# needs egid shadow to read /etc/shadow, and egid root does not grant that, so
# non-root PAM password verification stops working.
#
# Ownership does not need forcing to be deterministic: it comes from a pinned
# base image and a pinned package set. Step 2 is what keeps it honest.
RUN --mount=type=bind,source=os/rootfs/scripts,target=/mos-scripts \
    sh /mos-scripts/pack-squashfs.sh

# Step 2 — ownership/mode gate. mksquashfs is supposed to carry the source
# tree's uid/gid through untouched, and -all-root used to break exactly that.
# Diff the packed image's setuid/setgid inventory against the source inventory
# captured before packing, and fail the build on ANY difference, so this class
# of bug is a build error instead of something a reviewer has to spot.
# -lln prints numeric ids, matching how privileged-src.txt was written.
RUN --mount=type=bind,source=os/rootfs/scripts,target=/mos-scripts \
    sh /mos-scripts/pack-assert-privileged.sh

# Step 3 — dm-verity. veritysetup gets the pinned salt and a pinned UUID: both
# default to random values, and the UUID lands in the verity superblock at the
# hash offset, so leaving it unset alone would make the image differ on every
# run. The hash tree is appended to the squashfs in the same file via
# --hash-offset, and the result is padded to a whole MiB because the image
# assembler dd's it into the slot at a MiB boundary.
RUN --mount=type=bind,source=os/rootfs/scripts,target=/mos-scripts \
    sh /mos-scripts/pack-verity.sh


# The kernel and initramfs, extracted OUT of the root for boards whose
# bootloader cannot read it.
#
# GRUB has no squashfs driver, so on x64 it cannot load a kernel from the
# verity-protected root -- the kernel has to sit on the ESP as a plain file.
# That is the same arrangement cx3576 already has (Image on the FAT boot
# partition, not inside the squashfs) and it carries the same property, worth
# stating rather than discovering: THE KERNEL IS NOT COVERED BY dm-verity on
# either board. What protects it is that RAUC updates the boot slot as part of
# the same signed bundle as the rootfs slot.
#
# Copied for every architecture and simply absent on arm64, where the board
# supplies its own Image: `cp` of a glob that matches nothing would fail the
# build, so the miss is explicit.
RUN --mount=type=bind,source=os/rootfs/scripts,target=/mos-scripts \
    sh /mos-scripts/pack-export-boot.sh

# The factory /var tree, exported so the image assembler can SEED THE EPHEMERAL
# FILESYSTEM AT ASSEMBLY (RFCT-106) instead of copying it out on first boot.
#
# Seeding at runtime meant mos-seed-var ran at the same moment as every other
# unit that writes /var. Debian 13's systemd ships
# systemd-networkd-persistent-storage.service, which creates
# /var/lib/systemd/network as soon as /var appears; the two raced, and losing
# it failed the seed, which failed var-lib-mos.mount, which failed mosd, apid
# and the health gate -- a first boot that looks like a device that will not
# come up. Ordering against that one unit is a list to keep current.
#
# A filesystem that is ALREADY seeded when it is first mounted has nothing to
# race. mos-seed-var stays for the path where EPHEMERAL has been wiped, and its
# ConditionPathExists on the stamp means it does not run otherwise.
#
# 390 KB and 93 entries, measured on the x64 image: this costs nothing to
# carry through the build.
RUN --mount=type=bind,source=os/rootfs/scripts,target=/mos-scripts \
    sh /mos-scripts/pack-export-factory-var.sh

FROM scratch AS artifact
COPY --from=pack /out/factory-var/ /factory-var/
COPY --from=pack /out/rootfs-verity.img /
COPY --from=pack /out/rootfs-verity.env /
COPY --from=pack /out/rootfs-report-v2.txt /
COPY --from=pack /out/boot/ /boot/

# ---------------------------------------------------------------------------
# The factory root as an OCI image (RFCT-113 M7)
# ---------------------------------------------------------------------------
# WHY THIS EXISTS. Eleven artifacts in this image are built by this repository --
# mosd, apid, mos-mqttd, mos-mqtt-broker, rauc, podman, quadlet, crun, conmon,
# netavark, aardvark-dns -- and until now the last thing done to any of them was
# to LINK them. "It linked" and "it runs" are different claims, and the second
# was first made on a device: a wrong-architecture binary, a missing soname, or a
# version that does not match the pin in versions.env all survive to first boot.
# RFCT-113 executes each of them before the image ships, and an executor needs a
# root to execute them IN. This is that root, in the one form a container runtime
# can be handed directly.
#
# WHY /rootfs FROM `pack`, AND NOT `closed`. `closed` is the cheaper answer: it
# is already an image, already on the target platform, and exporting it costs a
# tag. It is also not what ships. Everything between the two -- the tree surgery
# and the shadow relocation above -- is the difference: /var moves aside to
# /usr/share/factory/var and leaves an empty mountpoint, /etc/shadow becomes a
# symlink to /run/mos/shadow, /etc/resolv.conf becomes a symlink into /run.
# A binary smoke-tested in `closed` is a binary tested in a tree that still has
# a populated /var and a real /etc/shadow -- tested, that is, somewhere other
# than the root it will run on. /rootfs at this point is the byte-for-byte input
# to mksquashfs, so this exports the root that ships and nothing adjacent to it.
#
# WHY IT IS THE LAST THING IN THE FILE. `COPY --from=pack` takes pack's FINAL
# state wherever this stage is written, so its position changes nothing that
# docker does -- and everything about how the next reader understands it. Placed
# above the surgery it would read as a capture of the tree before it, which is
# the wrong tree and an easy mistake to inherit.
#
# PLATFORM, AND WHY THE EXPORT ITSELF NEEDS NO EMULATION. There is no
# `--platform` flag here, so the stage is built for TARGETPLATFORM and the image
# DECLARES the board's architecture -- which is what makes `docker run` reach for
# binfmt/qemu-user on an arm64 image, per RFCT-113's scope. Nothing in this
# stage EXECUTES anything from the root, so producing it does not: measured on
# an amd64 host with binfmt_misc unmounted, `--platform linux/arm64` produced an
# `{"architecture":"arm64","os":"linux"}` OCI image with no emulation present.
# Building the arm64 root is still gated on emulation; exporting one is not.
FROM scratch AS factory-root
COPY --from=pack /rootfs/ /
