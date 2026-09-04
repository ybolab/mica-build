// The toolsets, one per container the shell runs today, transcribed rather
// than tidied.
//
// Every package list here is a copy of a line in the shell, deliberately
// unchanged: the byte-identity gate compares images and bundles against those
// scripts, and which package provided mkfs.vfat or mksquashfs is exactly the
// kind of thing that decides bytes -- the x64 assembly contract notes that BOOTX64.EFI
// is only as reproducible as the grub-efi-amd64-bin in its container. So the
// lists are not merged, not sorted and not deduplicated across toolsets: the
// two assemblers deliberately use different base images (alpine for cx3576,
// debian for x64), and unifying them would change the shipped bytes.
//
// Every image is an images.env key, never a literal reference.
//
// THERE IS NO HOST PROBE HERE ANY MORE. Two of these toolsets used to carry a
// `hostProbe` that asked whether this machine's mke2fs could write the
// layouts, because the boards ask for `-O ^orphan_file` and `-E hash_seed` and
// an e2fsprogs older than 1.47 "silently cannot" -- this host's is 1.46.5,
// which was the measured reason pin_seeded_times always ran container-side. The
// probe went with the host route it guarded (src/toolbox.ts); the measurement
// it was made of is recorded in docs/design/build.md section 0, where a dated
// host fact belongs.

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { REPO_ROOT } from './paths.ts'
import type { Toolset } from './toolbox.ts'

/**
 * cx3576's assembly toolset.
 *
 * The package list is the cx3576 assembly contract's, verbatim:
 *   apk add --no-cache -q bash coreutils sgdisk dosfstools mtools e2fsprogs \
 *       e2fsprogs-extra u-boot-tools
 * `coreutils` is there because alpine's dd and truncate are busybox's, and the
 * assembler uses `conv=notrunc,sparse`. `e2fsprogs-extra` is there because
 * alpine splits debugfs and dumpe2fs out of e2fsprogs -- which is precisely the
 * shape of gap the toolbox's per-tool assertion exists to catch, since `apk add
 * e2fsprogs` alone succeeds and provides neither.
 */
export const CX3576_ASSEMBLY: Toolset = {
  key: 'cx3576-assembly',
  imageKey: 'IMAGE_ALPINE_3_21',
  manager: 'apk',
  packages: ['bash', 'coreutils', 'sgdisk', 'dosfstools', 'mtools', 'e2fsprogs', 'e2fsprogs-extra', 'u-boot-tools'],
  // cp, find and touch are asserted alongside the rest because the cx3576 assembly contract
  // runs all three INSIDE this container -- `cp -a` to stage the factory /var,
  // `find ... -exec touch -h -d` to pin the staged boot files -- and the port
  // keeps them there rather than doing that work on the host. That is not
  // fastidiousness: `cp -a` is `--preserve=all`, which includes XATTRS, mke2fs
  // -d copies xattrs into the image, and this campaign's host runs SELinux while
  // the alpine container does not. Staging on the host would have put security
  // labels into EPHEMERAL that the shell's image does not carry, and the only
  // thing that would have reported it is the byte-identity gate.
  tools: ['sgdisk', 'mkfs.vfat', 'mcopy', 'mdir', 'minfo', 'mke2fs', 'dumpe2fs', 'debugfs', 'mkimage', 'dd', 'truncate', 'cp', 'find', 'touch'],
}

/**
 * x64's assembly toolset.
 *
 * The package list is the x64 assembly contract's, verbatim:
 *   apt-get install -y -qq --no-install-recommends gdisk dosfstools mtools \
 *       e2fsprogs grub-efi-amd64-bin grub-common
 * A different base image from cx3576's ON PURPOSE: that script's header records
 * that BOOTX64.EFI is only as reproducible as the grub-efi-amd64-bin in its
 * container, and grub-efi-amd64-bin is a Debian package.
 */
export const X64_ASSEMBLY: Toolset = {
  key: 'x64-assembly',
  imageKey: 'IMAGE_DEBIAN_TRIXIE',
  manager: 'apt',
  packages: ['gdisk', 'dosfstools', 'mtools', 'e2fsprogs', 'grub-efi-amd64-bin', 'grub-common'],
  // grub-editenv sits beside grub-mkstandalone because the x64 assembly contract runs
  // both, from different packages -- grub-mkstandalone from grub-common, the
  // EFI target from grub-efi-amd64-bin -- so "grub is installed" is not one
  // fact. A grubenv never created is a 0-byte file the size guard catches; an
  // absent grub-editenv is "command not found" against whichever step ran first.
  //
  // cp, find and touch are asserted for the reason they are in CX3576_ASSEMBLY,
  // but the two assemblers stage different things: the x64 assembly contract runs
  // `cp -a` of the factory /var on the host (line 161, outside its docker run)
  // and `cp`, `find ... -exec touch` and the seed stamp inside; the cx3576 assembly contract
  // runs all of it inside. src/mkimage-x64.ts keeps each on its own shell's side
  // because `cp -a` is `--preserve=all`, xattrs included, mke2fs -d copies
  // xattrs into the image, and this host runs SELinux while neither container
  // does; moving that step changes EPHEMERAL's bytes, caught only by that gate.
  tools: [
    'sgdisk', 'mkfs.vfat', 'mcopy', 'mmd', 'mdir', 'minfo', 'mke2fs', 'dumpe2fs', 'debugfs',
    'grub-mkstandalone', 'grub-editenv', 'dd', 'truncate', 'cp', 'find', 'touch',
  ],
}

/**
 * dm-verity, for the callers that format or verify a hash tree.
 *
 * Its own toolset rather than a package added to an assembler's: neither
 * assembler runs veritysetup. rootfs/compose/90-pack.Dockerfile formats the hash tree
 * (M5's territory) and the verify suite verifies it (M4's), and the
 * assemblers only dd the finished image into a slot. Adding cryptsetup to
 * CX3576_ASSEMBLY to make one fewer toolset would put a package into the
 * assembly container that the shell does not install there.
 */
export const VERITY: Toolset = {
  key: 'verity',
  imageKey: 'IMAGE_ALPINE_3_21',
  manager: 'apk',
  packages: ['cryptsetup'],
  tools: ['veritysetup'],
}

/**
 * dd and truncate on their own, for the raw-placement steps.
 *
 * It used to be the toolset that justified the host route -- every machine has
 * coreutils, so it was the one that actually took it. That is exactly why it no
 * longer does: alpine's dd and truncate are BusyBox's unless `coreutils` is
 * installed, which is the same substitution this policy exists to stop, one
 * layer down. The package list below is what makes the answer the same
 * everywhere; the route is no longer a choice.
 */
export const COREUTILS: Toolset = {
  key: 'coreutils',
  imageKey: 'IMAGE_ALPINE_3_21',
  manager: 'apk',
  packages: ['coreutils'],
  tools: ['dd', 'truncate'],
}

/** Where pkgs/rauc/build.sh leaves the rauc this tree ships, per architecture. */
export function shippedRaucPath(arch: string): string {
  return join(REPO_ROOT, 'pkgs', 'rauc', `out-${arch}`, 'rauc')
}

/**
 * Where the rauc in a bundle toolset came from, and what it is allowed to do.
 *
 * 'shipped'  the binary pkgs/rauc/build.sh produced from pinned source.
 * 'distro'   whatever the base image's package manager supplies.
 *
 * The distinction is load-bearing: the rauc that builds a bundle must be the
 * rauc that installs it. A bundle built in bookworm (rauc 1.8) for an image
 * running 1.13 fails -- 1.8 refuses the x64 slot model the first time it is
 * asked to read it, and "A format difference would not have announced itself so
 * kindly." So a bundle is written only by a rauc this tree built, and
 * src/tools/rauc.ts refuses a bundle-writing call on a distro toolset by name.
 * Reading is allowed on either: `rauc info` on a distro rauc is a fair question.
 */
export type RaucProvenance = 'shipped' | 'distro'

export interface BundleToolsetOptions {
  /** The rauc binary to carry in. Defaults to pkgs/rauc/out-<arch>/rauc. */
  readonly raucBin?: string
  readonly arch?: string
}

/**
 * The bundle toolset, with the rauc this tree built carried into it.
 *
 * The package list is the bundle contract's, verbatim -- squashfs-tools,
 * dosfstools, mtools, u-boot-tools, jq and the four libraries the self-built
 * rauc links against -- and `rauc` itself is NOT among them, exactly as there.
 * It arrives as a carried file, which is `install -m0755 "${RAUC_BIN}"
 * /usr/local/bin/rauc` in the shell, written as data here.
 *
 * @throws Error naming `make os-rauc` when the binary is not there. A bundle
 *   toolset that opened without a rauc would fail later inside the container,
 *   as "rauc: not found" -- which reads like a missing package.
 */
export function bundleToolset(options: BundleToolsetOptions = {}): Toolset & { provenance: RaucProvenance } {
  const arch = options.arch ?? 'amd64'
  const bin = options.raucBin ?? shippedRaucPath(arch)
  if (!existsSync(bin)) {
    throw new Error(
      `${bin} does not exist, so there is no rauc to build a bundle with. It is produced by `
      + `\`MOS_BOARD=<board> make os-rauc\` (pkgs/rauc/build.sh), from the version pinned in `
      + `pkgs/rauc/versions.env. The distribution's rauc is deliberately not a substitute: `
      + `commit 9a43a59 records a bundle built by rauc 1.8 that the device's 1.13 refused.`,
    )
  }
  return {
    key: 'bundle',
    imageKey: 'IMAGE_DEBIAN_TRIXIE',
    manager: 'apt',
    packages: [
      'squashfs-tools', 'dosfstools', 'mtools', 'u-boot-tools', 'jq',
      'libglib2.0-0t64', 'libjson-glib-1.0-0', 'libfdisk1', 'libssl3t64',
    ],
    // rauc, mksquashfs, mcopy, mkimage and jq are the shell's own list -- the
    // five it names in host_can_build(). The other five are the coreutils and
    // dosfstools binaries the bundle contract runs INSIDE this container after
    // it has started: `truncate -s <N>M`, `mkfs.vfat --invariant`, two `cp`s of
    // the kernel and the slot image, and `find ... -exec touch -h -d` to pin
    // every staged file to FILE_MTIME. They are asserted for the reason the
    // whole probe exists -- `mcopy -m` takes each entry's mtime from its
    // source, so a missing `touch` is not a missing binary, it is a FAT
    // directory stamped with the wall clock -- and because dosfstools provides
    // mkfs.vfat while the base image provides the rest, so "the packages
    // installed" is not one fact.
    tools: ['rauc', 'mksquashfs', 'mcopy', 'mkimage', 'jq', 'mkfs.vfat', 'truncate', 'cp', 'find', 'touch'],
    carry: [{ from: bin, to: '/usr/local/bin/rauc', mode: '0755' }],
    provenance: 'shipped',
  }
}

/**
 * A bundle toolset whose rauc is the base image's package.
 *
 * Exists so the rauc wrapper can be driven against a real rauc in a clean
 * checkout, where the self-built binary under pkgs/rauc has not been
 * produced. It is a real rauc and answers `--version` and `info` truthfully.
 * It is not the rauc that ships, it is marked so, and src/tools/rauc.ts refuses
 * to write a bundle with it -- see RaucProvenance.
 */
export function distroRaucToolset(): Toolset & { provenance: RaucProvenance } {
  return {
    key: 'rauc-distro',
    imageKey: 'IMAGE_DEBIAN_TRIXIE',
    manager: 'apt',
    packages: ['rauc'],
    tools: ['rauc'],
    provenance: 'distro',
  }
}
