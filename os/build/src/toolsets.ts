// The toolsets, one per container the shell runs today, transcribed rather
// than tidied.
//
// EVERY PACKAGE LIST HERE IS A COPY OF A LINE IN THE SHELL, deliberately
// unchanged. M6b, M6c and M6d are gated on producing BYTE-IDENTICAL images and
// bundles against those scripts, and which package provided mkfs.vfat or
// mksquashfs is exactly the kind of thing that decides bytes -- see the note in
// os/mkimage-x64.sh about BOOTX64.EFI being only as reproducible as the
// grub-efi-amd64-bin in its container. So the lists are not merged, not sorted
// and not deduplicated across toolsets: the two assemblers deliberately use
// DIFFERENT base images (alpine for cx3576, debian for x64) and unifying them
// would be a change to the shipped bytes made in the milestone that is supposed
// to prove nothing changed.
//
// EVERY IMAGE IS AN images.env KEY, never a literal reference. R6's sweep
// removed the last floating tag from the shipping path; os/build starts with
// none.

import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { $ } from 'bun'
import { makeWorkDir, OS_DIR } from './paths.ts'
import type { Toolset } from './toolbox.ts'

/**
 * Can THIS host's mke2fs write the filesystems these boards declare?
 *
 * `command -v mke2fs` is not the question. os/mkimage-v2.sh's
 * host_can_assemble() probes instead of guessing, and its comment says why:
 * the layouts ask for `-O ^orphan_file` and `-E hash_seed`, and an e2fsprogs
 * older than 1.47 "silently cannot". This host carries 1.46.5, which is the
 * measured reason pin_seeded_times has always run container-side -- so this
 * probe is not defensive, it is the one that fires.
 *
 * `-n` so nothing is written; the file still has to exist and be big enough for
 * mke2fs to lay a superblock out on paper.
 */
export async function mke2fsCanWriteTheseLayouts(): Promise<{ ok: boolean, why: string }> {
  // Absent and present-but-too-old are different sentences. Rolling them
  // together would say "cannot write these layouts" about a host that has no
  // mke2fs at all, which sends a reader to check a version that is not there.
  if ((await $`sh -c ${'command -v mke2fs >/dev/null 2>&1'}`.nothrow().quiet()).exitCode !== 0) {
    return { ok: false, why: 'there is no mke2fs here at all' }
  }

  const dir = makeWorkDir('mke2fs-probe')
  const probe = join(dir, 'probe.img')
  try {
    writeFileSync(probe, Buffer.alloc(16 * 1024 * 1024))
    const r = await $`mke2fs -q -n -t ext4 -b 4096 -O ${'^orphan_file,^metadata_csum_seed'} -E ${'root_owner=0:0,hash_seed=5ac35760-0002-4000-8000-000000000107'} ${probe}`
      .nothrow().quiet()
    if (r.exitCode === 0) return { ok: true, why: "this host's mke2fs writes the layouts these boards declare" }
    const v = await $`mke2fs -V`.nothrow().quiet()
    const version = `${v.stderr.toString()}${v.stdout.toString()}`.split('\n')[0]?.trim() || 'this mke2fs'
    return {
      ok: false,
      why: `${version} cannot write these layouts (-O ^orphan_file needs e2fsprogs >= 1.47)`,
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * cx3576's assembly toolset.
 *
 * The package list is os/mkimage-v2.sh's, verbatim:
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
  // cp, find and touch are asserted alongside the rest because os/mkimage-v2.sh
  // runs all three INSIDE this container -- `cp -a` to stage the factory /var,
  // `find ... -exec touch -h -d` to pin the staged boot files -- and the port
  // keeps them there rather than doing that work on the host. That is not
  // fastidiousness: `cp -a` is `--preserve=all`, which includes XATTRS, mke2fs
  // -d copies xattrs into the image, and this campaign's host runs SELinux while
  // the alpine container does not. Staging on the host would have put security
  // labels into EPHEMERAL that the shell's image does not carry, and the only
  // thing that would have reported it is the byte-identity gate.
  tools: ['sgdisk', 'mkfs.vfat', 'mcopy', 'mdir', 'minfo', 'mke2fs', 'dumpe2fs', 'debugfs', 'mkimage', 'dd', 'truncate', 'cp', 'find', 'touch'],
  hostProbe: mke2fsCanWriteTheseLayouts,
}

/**
 * x64's assembly toolset.
 *
 * The package list is os/mkimage-x64.sh's, verbatim:
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
  tools: ['sgdisk', 'mkfs.vfat', 'mcopy', 'mmd', 'mdir', 'minfo', 'mke2fs', 'dumpe2fs', 'debugfs', 'grub-mkstandalone', 'dd', 'truncate'],
  hostProbe: mke2fsCanWriteTheseLayouts,
}

/**
 * dm-verity, for the callers that format or verify a hash tree.
 *
 * Its own toolset rather than a package added to an assembler's: neither
 * assembler runs veritysetup. os/rootfs/Dockerfile.v2 formats the hash tree
 * (M5's territory) and os/verify-image-v2.sh verifies it (M4's), and the
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
 * This one usually takes the HOST route, and it is the reason there is a host
 * route at all: every machine has coreutils. It matters that both routes stay
 * live -- a seam with one reachable route is a seam nobody is checking.
 */
export const COREUTILS: Toolset = {
  key: 'coreutils',
  imageKey: 'IMAGE_ALPINE_3_21',
  manager: 'apk',
  packages: ['coreutils'],
  tools: ['dd', 'truncate'],
}

/** Where os/update/rauc/build.sh leaves the rauc this tree ships, per architecture. */
export function shippedRaucPath(arch: string): string {
  return join(OS_DIR, 'update', 'rauc', `out-${arch}`, 'rauc')
}

/**
 * Where the rauc in a bundle toolset came from, and what it is allowed to do.
 *
 * 'shipped'  the binary os/update/rauc/build.sh produced from pinned source.
 * 'distro'   whatever the base image's package manager supplies.
 *
 * The distinction is load-bearing, not documentation. Commit 9a43a59 ("the
 * rauc that builds a bundle must be the rauc that installs it") records the
 * failure: bundle.sh built in bookworm -- rauc 1.8 -- while the image ran 1.13,
 * and 1.8 refused the x64 slot model the first time it was asked to read it. "A
 * format difference would not have announced itself so kindly." So a bundle is
 * written only by a rauc this tree built; src/tools/rauc.ts refuses a
 * bundle-writing call on a distro toolset, by name. Reading a bundle is
 * different -- `rauc info` on a distro rauc tells you what a distro rauc thinks,
 * which is a fair question -- so that side is allowed.
 */
export type RaucProvenance = 'shipped' | 'distro'

export interface BundleToolsetOptions {
  /** The rauc binary to carry in. Defaults to os/update/rauc/out-<arch>/rauc. */
  readonly raucBin?: string
  readonly arch?: string
}

/**
 * The bundle toolset, with the rauc this tree built carried into it.
 *
 * The package list is os/update/bundle.sh's, verbatim -- squashfs-tools,
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
      + `\`MOS_BOARD=<board> make os-rauc\` (os/update/rauc/build.sh), from the version pinned in `
      + `os/update/rauc/versions.env. The distribution's rauc is deliberately not a substitute: `
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
    tools: ['rauc', 'mksquashfs', 'mcopy', 'mkimage', 'jq'],
    carry: [{ from: bin, to: '/usr/local/bin/rauc', mode: '0755' }],
    provenance: 'shipped',
  }
}

/**
 * A bundle toolset whose rauc is the base image's package.
 *
 * EXISTS SO THE rauc WRAPPER CAN BE DRIVEN AGAINST A REAL rauc IN A CLEAN
 * CHECKOUT, where the self-built binary under os/update/rauc has not been
 * produced yet. It is a real
 * rauc and it answers `--version` and `info` truthfully. It is not the rauc
 * that ships, it is marked so, and src/tools/rauc.ts refuses to write a bundle
 * with it -- see RaucProvenance.
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
