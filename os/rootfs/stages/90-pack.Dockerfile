# syntax=docker/dockerfile:1@sha256:ecfaec9ed6d810b56388c508f4121597bfbba70d41a6dfeee4d8cad5f295fc32
# stages/90-pack -- close the root, then pack it: squashfs-zstd + dm-verity.
# The last link in the chain (stages/README.md says what the chain is), and the
# only stage file with more than one FROM of its own.

# Four stages in one file:
#   closed        FROM the previous chain tag, on the target platform. The last
#     four things done to the device root: take the package inventory, capture
#     the package-manager logs, remove package management, write the build
#     report. They are here rather than in 10-base because they are ordered
#     last by construction -- dpkg-query has to see every package any feature
#     or board stage installed, and the purge has to be the last step that
#     needs dpkg.
#   pack          FROM bookworm, on the build platform. Packing runs mksquashfs
#     and veritysetup over a tree and never executes anything from it, so it
#     does not want emulation.
#   artifact      FROM scratch, the export surface the driver writes out.
#   factory-root  FROM scratch, on the target platform: the packed root itself
#     as an OCI image, so the smoke runner can execute the self-built binaries
#     in the root that ships them.

# Two export surfaces, not one, because they are different kinds of thing:
# `artifact` is files the assembler consumes, `factory-root` is an image a
# runtime consumes, and buildkit exports one target per invocation. The driver
# builds factory-root second, off the cache the first filled. `closed` is not a
# stage file of its own: closing the root and packing it are one operation with
# one output, nothing else can run between them, and a stage boundary that
# nothing can ever be inserted at only costs a reader a hop.

# The link back up the chain. MOS_STAGE_PREV is the local image tag the
# previous stage was written to; the driver passes it and refuses to build a
# stage that does not declare it. There is no default, so this file cannot be
# built standalone against whatever `FROM` happened to be typed.

# MOS_IMAGE_DEBIAN_BOOKWORM is this file's own base, injected from
# os/build-env/images.env by os/build-env/from.sh exactly as stages/10-base's
# trixie key is, and declared here because the `pack` FROM below is the only
# line in the chain that consumes it. It is pinned because the byte layout of
# the packed image depends on which squashfs-tools and cryptsetup pack it, so
# the pack tools are a decision rather than a build date. No default, for the
# reason 10-base gives.
ARG MOS_STAGE_PREV
ARG MOS_IMAGE_DEBIAN_BOOKWORM

# Close the device root: pin the account dates, inventory, log capture, purge,
# report.
FROM ${MOS_STAGE_PREV} AS closed

# The shadow last-change day, pinned for every account.

# That field is not content anyone chose: it is the BUILD DATE, leaking into a
# signed root through Debian's own maintainer scripts. useradd stamps today
# into it, and the accounts the distribution's postinsts create --
# systemd-network, messagebus, systemd-resolve, sshd -- therefore carry the day
# the image was built. Pinning it to the same epoch the mos accounts already use
# makes the field a function of the tree again.

# It is quieter than the two surfaces beside it and worse for being quiet. The
# value is a DAY, so two builds in one session agree and every same-session test
# passes; only builds straddling midnight differ. A gate that compares two roots
# would go red at random, months from now, for a reason nobody would connect to
# a calendar.

# Here rather than in stages/10-base beside account-mos.sh, because this has to
# run after the LAST apt transaction that can create an account -- the kernel
# install in stages/40-board is the last of them -- and the three mos accounts
# are pinned where they are created because nothing creates them but us. Before
# the purge below, which is what takes the package manager away; `chage` itself
# ships (90-pack's purge notes list it among the setgid binaries that stay).
RUN --mount=type=bind,source=os/rootfs/scripts,target=/mos-scripts \
    sh /mos-scripts/account-pin-shadow-dates.sh

# Package inventory. Split from the size measurement below because the package
# manager is removed in between: dpkg-query needs /var/lib/dpkg, and TOTAL_MB
# has to weigh the root that actually ships.
RUN dpkg-query -W -f='${Package}\t${Installed-Size}\n' > /rootfs-report.pkgs

# The exact RAUC the image will run, recorded so the thing that BUILDS bundles
# can refuse to build one with a different version.
#
# The bundle format and the slot model are a contract between two programs that
# never meet: rauc on a build machine writes the bundle, rauc on the device
# installs it, and nothing else makes them the same version. A bundle builder
# on rauc 1.8 refuses this board's slot model outright.
#
# /rootfs-report.rauc is written where rauc is INSTALLED, further up, from the
# version os/pkgs/rauc/ pinned; there is no rauc package to query.

# The package-manager logs, taken out of the tree before the purge below
# removes them. They are not image content and never were -- the packed root
# ships them only because /var was moved wholesale to /usr/share/factory/var --
# but one of them is EVIDENCE, and that is why this step exists rather than a
# longer `rm -rf` list.
#
# `dpkg.log` records all 694 apt operations in the order they happened. Strip
# its timestamps and two builds are byte-identical, which is how the stage
# arrangement is checked: `../README.md` under "Running the gate", "Check the
# apt order directly", and `README.md` on why 30-feature-radios runs ahead of
# 31-feature-containers. That check compares two builds, so it cannot run
# inside one, and it needs the bytes to survive somewhere a human can reach
# them on both sides.
#
# Here rather than in the image: the tree surgery in `pack` moves this to
# /out/pkg-logs and the `artifact` stage exports it to _out/<board>/pkg-logs/,
# the same lifecycle /rootfs-report.txt already has -- produced in the root,
# moved out of it, never shipped. The comparison reads exactly the same bytes
# it read before; only where it picks them up changed. The purge refuses to run
# if this step did not, so the two cannot come apart.
RUN --mount=type=bind,source=os/rootfs/scripts,target=/mos-scripts \
    sh /mos-scripts/package-manager-logs-capture.sh

# Remove package management from the packed root. Nothing can install a
# package on this device: the root is a read-only dm-verity squashfs and
# updates arrive as whole RAUC slots, so apt, dpkg and the perl-base dpkg
# pre-depends on are build-time tools. Shipping them costs ~21 MB of dead
# weight and hands a working package manager to anyone who reaches a shell on a
# device whose whole security model is that its root cannot change. The
# self-checks below are what make this step able to fail; a purge that silently
# removed too much would surface as a device that does not boot, days later.

# Measured before removing, not assumed. Nothing in overlay-v2, in mosd or in
# apid invokes dpkg or apt at runtime -- the only two mentions in the overlay
# are comments. Every perl script in the image is maintainer-script tooling
# that runs during installation and never after (deb-systemd-helper,
# deb-systemd-invoke, debconf-*, ucf*, and the /usr/sbin set: adduser, deluser,
# update-rc.d, pam-auth-update, pam_getenv, dpkg-fsys-usrunmess), and they are
# removed here too -- a script whose interpreter is gone is a trap, not a
# leftover. dash, grep and gzip declare `Pre-Depends: dpkg`, a packaging-time
# relation their binaries never call; gpgv is reachable only from apt-key.

# The checks test a property, not a package name -- a copyright count, a
# version glob -- because a check pinned to a version of the thing it is
# checking fails on the upgrade it exists to survive. The dangling-interpreter
# check below is a build failure and not a warning, because it is what
# enumerates the /usr/sbin set a hand survey misses. adduser and deluser are
# safe to remove for a second, independent reason: /etc/passwd is inside the
# read-only verity root (only /etc/shadow is symlinked onto STATE), so no
# account can be created on a running device whether or not the tool is there.

# The apt and dpkg timers go too. Removing /usr/bin/apt does not remove
# apt-daily.timer, apt-daily-upgrade.timer or dpkg-db-backup.timer, and all
# three are enabled by their packages into
# /etc/systemd/system/timers.target.wants. On a device with no package manager
# they fire daily and fail daily, and nothing else in the image is wrong enough
# to notice.

# linux-base's four helpers arrive with linux-base, which x64 pulls in through
# linux-image-amd64 and cx3576 never installs. Their callers are not all the
# same: linux-check-removal, linux-run-hooks and linux-update-symlinks are
# called only from the kernel package's preinst/postinst/prerm/postrm, while
# linux-version is called by /usr/sbin/update-initramfs, a runtime tool.
# update-initramfs goes too: on a read-only dm-verity root it cannot write an
# initramfs anywhere that would be used -- the initrd this image boots sits on
# the ESP, outside the verity tree, and is replaced by RAUC as part of the same
# signed bundle as the rootfs.

# /usr/share/doc is kept, deliberately, and this is where the usual "slim
# image" recipe goes wrong: it is 2.75 MB, of which 2.06 MB is 159 `copyright`
# files -- the licence texts Debian ships to satisfy the redistribution terms
# of the GPL and friends. Deleting the directory would save 0.69 MB of
# changelogs and breach those terms to do it. coreutils (17.6 MB) and
# openssh-client (5.7 MB) are kept by decision too: busybox would save most of
# coreutils but every script in the image and in the verifier would then run
# against different tool semantics, and outbound ssh/scp is a field-support
# capability, not packaging residue.
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

# Pack: squashfs-zstd + appended dm-verity hash tree.
FROM --platform=$BUILDPLATFORM ${MOS_IMAGE_DEBIAN_BOOKWORM} AS pack
# ARG is per-stage. BOARD_RADIOS is declared again here because the pack stage
# asserts properties of the assembled root that depend on it -- which board
# state directories are precious, and therefore which mount units must exist.
# Declared only in an earlier stage file it would expand empty here, which
# under `set -u` is a build failure rather than a check that silently reads "no
# radios" on a board that has them.
ARG BOARD_RADIOS=""
RUN apt-get update && apt-get install -y --no-install-recommends \
        squashfs-tools cryptsetup-bin libcap2-bin \
        initramfs-tools-core \
    && rm -rf /var/lib/apt/lists/*
COPY --from=closed / /rootfs/

# Guard the mos-owned files against CJK text (repo rule: code and docs are
# English). The scanned set is the overlay's mount units, seed scripts,
# repart.d definitions and fw_env.config. Only our own paths are scanned;
# vendor packages ship translations and are none of our business.
RUN --mount=type=bind,source=os/rootfs/scripts,target=/mos-scripts \
    sh /mos-scripts/pack-cjk-guard.sh

# Tree surgery that cannot happen in the rootfs stage, either because buildkit
# bind-mounts the file during RUN or because it would break dpkg.
#  - /etc/resolv.conf -> /run, the only writable place with / read-only.
#  - /etc/machine-id must exist and be empty: systemd cannot write it on a
#    read-only /etc, and falls back to bind-mounting a transient id from /run
#    over it. U-Boot passes systemd.machine_id= to make it stable.
#  - /var becomes an empty mountpoint for EPHEMERAL; the built tree moves to
#    /usr/share/factory/var, from where mos-seed-var restores it on first boot.

#  - Except /var/tmp, which is created in that mountpoint on purpose. "Empty
#    mountpoint" is right for everything a running system uses and wrong for
#    the window before the mount: systemd-resolved.service is ordered
#    `Before=sysinit.target`, so it starts ahead of local-fs.target and sees
#    the image's own /var. Its PrivateTmp= mounts a tmpfs on both /tmp and
#    /var/tmp, and a mount point that does not exist cannot be created on a
#    read-only root -- the service dies with 226/NAMESPACE on every boot and
#    every restart.

#    Nothing about that failure names /var/tmp. The console says "[FAILED]
#    Failed to start systemd-resolved.service" and the child's own message
#    never reaches the journal, because it dies during namespace setup. What it
#    costs is all DNS: /etc/resolv.conf is a symlink to resolved's stub, so the
#    device cannot resolve an update server, an MQTT broker or a container
#    registry. /var/tmp is created here and not with the other mountpoints
#    above because this mkdir replaces /var wholesale, so anything an earlier
#    stage put there is gone.
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

# The writable unit directory for third-party extensions. Deliberately NOT
# folded into the loop above: that loop is about /var being disposable and ends
# by requiring a /usr/share/factory template, which is right for /var/lib/mos
# and wrong here -- there is no factory content for this directory and, by
# design, no seed copy at all. What this defends is different too: the bind is
# what makes a third-party unit survive a reboot, and its mountpoint cannot be
# created at runtime on a verity root, so a missing directory here is a mount
# unit that fails at boot rather than a feature that quietly does nothing.
RUN --mount=type=bind,source=os/rootfs/scripts,target=/mos-scripts \
    sh /mos-scripts/pack-assert-extension-dir.sh

# /etc/shadow moves onto STATE. Every device gets its own root password, and
# pam_unix reads it from /etc/shadow -- which on v2 sits on the dm-verity
# squashfs, where nothing can ever write it. The only writable paths under /etc
# are the /etc/hostname and /etc/ssh binds, and a bind-mounted file cannot be
# replaced by rename, which is how mosd writes a credential safely. So the file
# ships as a symlink into /var/lib/mos, the bind target of var-lib-mos.mount,
# whose source is /mnt/state/mos.

# The image copy is retained at /usr/share/factory/etc/shadow -- systemd's
# standard place for a factory template, the same idea this stage already uses
# for /var -- and mos-shadow-reconcile derives the STATE file from it on every
# boot. /etc/passwd and /etc/group deliberately stay in the image, read-only:
# only the secret-bearing file moves, so account definitions remain part of the
# signed, verity-covered root. Done here and not in the rootfs stage because
# every package postinst still needs a real file: a tool like chpasswd would
# follow a symlink laid down earlier and write through it.
RUN --mount=type=bind,source=os/rootfs/scripts,target=/mos-scripts \
    sh /mos-scripts/pack-shadow-relocate.sh

# Assert the whole chain, at build time, so it can only pass for the intended
# artifact. Each of these is a defect that would otherwise be invisible: a
# regular /etc/shadow shadowing the symlink, a factory copy the reconciler
# cannot read, a unit installed but never enabled, an ordering directive naming
# a unit that does not exist (systemd drops those silently), or a real password
# hash baked into a rootfs that is byte-identical across the entire fleet.

# The locked-password test runs over every account in /etc/passwd, not just
# root: an empty field is not a locked marker, it is passwordless, and scoping
# the test to root would leave every other account exposed. root keeps its own
# dedicated case above it because a baked root credential is the single most
# likely way a hash reaches this file, and this assertion is what keeps the
# tree free of a ROOT_PASSWORD build arg; the loop below is the class, not the
# instance. The two failure modes get two messages on purpose: an empty field
# means the account accepts any password, while a usable hash means a
# credential that every device in the fleet shares.
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

# Pack, in three steps so each can carry its own explanation and cache
# independently: squash, assert, then hash.
ARG VERITY_SALT
ARG VERITY_UUID
ARG SQUASHFS_TIME
ARG VERITY_HASH_ALGO=sha256
ARG VERITY_DATA_BLOCK_SIZE=4096
ARG VERITY_HASH_BLOCK_SIZE=4096

# Step 1 -- squash. Every knob that would otherwise vary between builds is
# pinned:
#   -processors 1         multi-threaded mksquashfs is NOT byte-reproducible
#   -mkfs-time/-all-time  no wall clock in the superblock or in any inode
#   -noappend             never merge into a pre-existing image
#   -no-exports           drop the NFS export table (unused, extra bytes)

# There is deliberately no -all-root, and no -force-uid/-force-gid either. They
# rewrite ownership but NOT mode bits, so every setgid binary whose group was
# not root would ship setgid-root: ssh-agent (_ssh), chage / expiry /
# unix_chkpwd (shadow), dbus-daemon-launch-helper (messagebus). That widens a
# privilege boundary inside the one part of the system that is supposed to be
# the trustworthy part. It also breaks unix_chkpwd in the other direction: it
# needs egid shadow to read /etc/shadow, and egid root does not grant that, so
# non-root PAM password verification stops working. Ownership does not need
# forcing to be deterministic -- it comes from a pinned base image and a pinned
# package set, and step 2 is what keeps it honest.
RUN --mount=type=bind,source=os/rootfs/scripts,target=/mos-scripts \
    sh /mos-scripts/pack-squashfs.sh

# Step 2 -- ownership/mode gate. mksquashfs must carry the source tree's
# uid/gid through untouched, and -all-root is exactly what breaks that. Diff
# the packed image's setuid/setgid inventory against the source inventory
# captured before packing, and fail the build on ANY difference, so this class
# of bug is a build error instead of something a reviewer has to spot.
# -lln prints numeric ids, matching how privileged-src.txt was written.
RUN --mount=type=bind,source=os/rootfs/scripts,target=/mos-scripts \
    sh /mos-scripts/pack-assert-privileged.sh

# Step 3 -- dm-verity. veritysetup gets the pinned salt and a pinned UUID: both
# default to random values, and the UUID lands in the verity superblock at the
# hash offset, so leaving it unset alone would make the image differ on every
# run. The hash tree is appended to the squashfs in the same file via
# --hash-offset, and the result is padded to a whole MiB because the image
# assembler dd's it into the slot at a MiB boundary.
RUN --mount=type=bind,source=os/rootfs/scripts,target=/mos-scripts \
    sh /mos-scripts/pack-verity.sh


# The kernel and initramfs, extracted out of the root for boards whose
# bootloader cannot read it. GRUB has no squashfs driver, so on x64 it cannot
# load a kernel from the verity-protected root -- the kernel has to sit on the
# ESP as a plain file. That is the same arrangement cx3576 already has (Image
# on the FAT boot partition, not inside the squashfs) and it carries the same
# property, worth stating rather than discovering: the kernel is not covered by
# dm-verity on either board. What protects it is that RAUC updates the boot
# slot as part of the same signed bundle as the rootfs slot.

# Copied for every architecture and simply absent on arm64, where the board
# supplies its own Image: `cp` of a glob that matches nothing would fail the
# build, so the miss is explicit.
RUN --mount=type=bind,source=os/rootfs/scripts,target=/mos-scripts \
    sh /mos-scripts/pack-export-boot.sh

# The factory /var tree, exported so the image assembler can seed EPHEMERAL at
# assembly instead of copying it out on first boot. Seeding at runtime puts
# mos-seed-var at the same moment as every other unit that writes /var: Debian
# 13's systemd ships systemd-networkd-persistent-storage.service, which creates
# /var/lib/systemd/network as soon as /var appears, the two race, and losing
# the race fails the seed, which fails var-lib-mos.mount, which fails mosd,
# apid and the health gate -- a first boot that looks like a device that will
# not come up. Ordering against that one unit is a list to keep current.

# A filesystem that is already seeded when it is first mounted has nothing to
# race. mos-seed-var stays for the path where EPHEMERAL has been wiped, and its
# ConditionPathExists on the stamp means it does not run otherwise. The tree is
# 390 KB and 93 entries, so carrying it through the build costs nothing.
RUN --mount=type=bind,source=os/rootfs/scripts,target=/mos-scripts \
    sh /mos-scripts/pack-export-factory-var.sh

FROM scratch AS artifact
COPY --from=pack /out/factory-var/ /factory-var/
COPY --from=pack /out/pkg-logs/ /pkg-logs/
COPY --from=pack /out/rootfs-verity.img /
COPY --from=pack /out/rootfs-verity.env /
COPY --from=pack /out/rootfs-report-v2.txt /
COPY --from=pack /out/boot/ /boot/

# The factory root as an OCI image.

# Eleven artifacts in this image are built by this repository -- mosd, apid,
# mos-mqttd, mos-mqtt-broker, rauc, podman, quadlet, crun, conmon, netavark,
# aardvark-dns -- and "it linked" and "it runs" are different claims: a
# wrong-architecture binary, a missing soname, or a version that does not match
# the pin in versions.env all survive to first boot. The smoke runner executes
# each of them before the image ships, and an executor needs a root to execute
# them in. This is that root, in the one form a container runtime can be handed
# directly.

# /rootfs comes from `pack`, not `closed`. `closed` is the cheaper answer -- it
# is already an image, already on the target platform, and exporting it costs a
# tag -- but it is not what ships. Everything between the two, the tree surgery
# and the shadow relocation above, is the difference: /var moves aside to
# /usr/share/factory/var and leaves an empty mountpoint, /etc/shadow becomes a
# symlink to /run/mos/shadow, /etc/resolv.conf becomes a symlink into /run.
# /rootfs at this point is the byte-for-byte input to mksquashfs, so this
# exports the root that ships and nothing adjacent to it.

# It is the last thing in the file for the reader, not for docker: `COPY
# --from=pack` takes pack's final state wherever this stage is written, so its
# position changes nothing docker does. Placed above the surgery it would read
# as a capture of the tree before it, which is the wrong tree and an easy
# mistake to inherit.

# There is no `--platform` flag here, so the stage is built for TARGETPLATFORM
# and the image declares the board's architecture, which is what makes `docker
# run` reach for binfmt/qemu-user on an arm64 image. Nothing in this stage
# executes anything from the root, so producing it needs no emulation even with
# binfmt_misc unmounted. Building the arm64 root is still gated on emulation;
# exporting one is not.
FROM scratch AS factory-root
COPY --from=pack /rootfs/ /
