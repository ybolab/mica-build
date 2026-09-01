// Batch 4a, the remainder: the small families that read only the unpacked root.
//
// Twenty-six conclusions on cx3576 and twenty-five on x64, grouped because
// they share the same unpacked-root input:
//
//   systemd-networkd enabled                1 / 1
//   the ELF architecture of mosd/apid       2 / 2
//   the bootloader environment tools          5 / 4  (2 SKIPs on grub)
//   the health gate's root-side pair          2 / 2
//   systemd-repart definitions              3 / 3
//   the AuthorizedKeysFile drop-in          3 / 3
//   the boot scripts' external commands     1 / 1
//   the image profile and its SSH default   4 / 4
//   ssh.service's KillMode / ExecReload      2 / 2
//   libcrypt and the crypt(3) format        3 / 3
//
// One module because every one is `packedRoot()` plus a read.
//
// The profile key and default path are read out of `provisioning.rs` and the
// crypt(3) prefix out of `transient.rs`, both the oracle's own reads: mosd fails
// closed on a profile it cannot parse, so an image whose key had drifted would
// self-provision to prod and disable its own sshd with every check still green.
// Reading those sources is in scope under the Scope section -- "No change
// to ... `mosd/` Rust sources" -- and nothing here writes to them.
//
// One defect is reproduced rather than fixed:
// `fwenv_lines="$(grep -cE '^/dev/' "${fwenv}" 2>/dev/null || echo 0)"`.
// On a file that exists with no `^/dev/` line, `grep -c` prints `0` and exits 1,
// so `|| echo 0` fires too and the variable becomes "0\n0" -- a raw newline in
// the middle of a FAIL message, which `parseShellRun`'s self-consistency guard
// would refuse. Neither shipped image reaches it; both have two device lines.
// The behavior is preserved for parity and documented here so a future cleanup
// changes the check and its expectations together.

import { existsSync, lstatSync, readFileSync, readdirSync, readlinkSync, realpathSync, statSync, type Stats } from 'node:fs'
import { join } from 'node:path'
import type { Board } from './board.ts'
import { boardsWhere, isUBoot, SHIPPED } from './board-scope.ts'
import { regularFileFollowingLinks } from './checks-dbus.ts'
import { entry, packedRoot, wantsLink } from './checks-root.ts'
import type { CheckCase } from './checks.ts'
import type { CheckResult } from './parity.ts'
import { REPO_ROOT } from './paths.ts'
import { ToolOutputError } from './tools.ts'
import { skipped, verdict } from './verdict.ts'
import { extractCommands, resolvesInRoot } from './script-commands.ts'

const isGrub = (board: Board): boolean => board.bootloader === 'grub'
const UBOOT_BOARDS = boardsWhere(isUBoot)
const NOT_UBOOT_BOARDS = boardsWhere(b => !isUBoot(b))
const GRUB_BOARDS = boardsWhere(isGrub)

const MOSD_SRC = join(REPO_ROOT, 'pkgs', 'mosd', 'mosd', 'src')
const PROFILE_FILE = '/usr/lib/mos/profile.conf'
const SSHD_DROPIN = '/etc/ssh/sshd_config.d/05-mos-authorized-keys.conf'
const AK_EXPECT = '/etc/ssh/authorized_keys.d/%u'
const SSH_UNIT = '/usr/lib/systemd/system/ssh.service'
const MOS_HEALTH = '/usr/lib/mos/mos-health'

// readers

function text(root: string, path: string): string {
  try {
    return readFileSync(join(root, path), 'utf8')
  }
  catch {
    return ''
  }
}

function lines(root: string, path: string): string[] {
  const t = text(root, path)
  return t === '' ? [] : t.split('\n')
}

/** A `const`/`pub const` `&str` out of one of mosd's own sources. */
function mosdSourceConst(file: string, pattern: RegExp): string {
  let src: string
  try {
    src = readFileSync(join(MOSD_SRC, file), 'utf8')
  }
  catch {
    return ''
  }
  for (const line of src.split('\n')) {
    const m = pattern.exec(line)
    if (m?.[1] !== undefined) return m[1]
  }
  return ''
}

/** `stat -c %a`, or the oracle's literal `none`. */
function modeOf(root: string, path: string): string {
  try {
    return (statSync(join(root, path)).mode & 0o7777).toString(8)
  }
  catch {
    return 'none'
  }
}

// systemd-networkd, and the ELF architecture of the two daemons

const NETWORKD_CHECK: CheckCase = {
  // TWO ways a unit is enabled, and the second is not decoration: Debian's
  // networkd ships an alias at /etc/systemd/system/dbus-org.freedesktop.network1.service,
  // which enables the unit without any *.wants entry.
  id: 'networkd-enabled',
  shell: {
    pass: 'systemd-networkd is enabled',
    fail: 'systemd-networkd enablement symlink missing',
  },
  run: async (ctx): Promise<readonly CheckResult[]> => {
    const root = await packedRoot(ctx)
    const ok = wantsLink(root, ['/etc/systemd/system'], 'systemd-networkd.service') !== undefined
      // `[ -e ]` follows the link, so a DANGLING alias reads as absent.
      || existsSync(join(root, '/etc/systemd/system/dbus-org.freedesktop.network1.service'))
    return [verdict(
      'networkd-enabled',
      ok,
      ok ? 'systemd-networkd is enabled' : 'systemd-networkd enablement symlink missing',
    )]
  },
}

/** `e_machine`, the 16-bit little-endian field at offset 18. */
const ELF_MACHINE: ReadonlyMap<string, string> = new Map([['arm64', 'b700'], ['amd64', '3e00']])

/**
 * The staged binary is THIS board's architecture.
 *
 * The oracle pinned aarch64 once, and the x64 image reported "/usr/bin/mosd is
 * not an aarch64 ELF" -- true, and not a defect: the binary was exactly the
 * architecture that board asks for. The assertion that earns its keep is the
 * one against MOS_ARCH, which catches a host-arch artefact shipping to a device.
 */
function elfArchCheck(board: Board, path: string): CheckCase {
  // One entry per (board, path), generated from the board's own MOS_ARCH.
  //
  // `${path} is a ` alone claims `${path} is a regular file` too -- both
  // binaries are in batch 2a's sq_regular list -- and `${path} is a ` cannot be
  // lengthened without naming an architecture. Naming it per board is not
  // writing it down: `board.arch` IS the declaration, and a third board is
  // covered by whatever its own definition says with nothing here edited.
  const arch = board.arch ?? ''
  const id = `elf-arch-${board.name}${path}`
  return {
    id,
    boards: [board.name],
    shell: { pass: `${path} is a ${arch} ELF`, fail: `${path} is not a ${arch} ELF` },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const want = ELF_MACHINE.get(arch)
      if (want === undefined) {
        throw new ToolOutputError(
          `${ctx.board.path} declares MOS_ARCH='${arch}'; this verifier knows arm64 and amd64. `
          + `Answered as a throw rather than as a failed check: which architectures exist is a fact `
          + `about the board definition, and the oracle exits 1 here rather than concluding.`,
        )
      }
      const root = await packedRoot(ctx)
      // `od -An -tx1 -N20`: TWENTY bytes, forty hex characters, in the order
      // they are on the medium. Not a 32-bit read -- a word read would print
      // e_machine's two bytes reversed on this host.
      let head = ''
      try {
        head = readFileSync(join(root, path)).subarray(0, 20).toString('hex')
      }
      catch { /* absent: the oracle's od prints nothing and the compare fails */ }
      const ok = head.slice(0, 8) === '7f454c46' && head.slice(36, 40) === want
      return [verdict(
        id,
        ok,
        ok ? `${path} is a ${arch} ELF` : `${path} is not a ${arch} ELF (header: '${head.slice(0, 40)}')`,
      )]
    },
  }
}

// the bootloader's environment access from Linux

const BOOTENV_CHECKS: readonly CheckCase[] = [
  {
    // sq_regular, U-Boot only.
    id: 'bootenv-fw-printenv',
    boards: UBOOT_BOARDS,
    shell: {
      pass: '/usr/bin/fw_printenv is a regular file',
      fail: '/usr/bin/fw_printenv missing or not a regular file',
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const st = entry(await packedRoot(ctx), '/usr/bin/fw_printenv')
      const ok = st !== undefined && st.isFile()
      return [verdict('bootenv-fw-printenv', ok,
        ok ? '/usr/bin/fw_printenv is a regular file' : '/usr/bin/fw_printenv missing or not a regular file')]
    },
  },

  {
    // fw_setenv is a SYMLINK to fw_printenv on trixie and was a second regular
    // file on bookworm: libubootenv now ships one multi-call binary. What RAUC
    // needs is a working fw_setenv, so the assertion is that the path RESOLVES
    // -- asserting "regular file" would fail on a correct image and asserting
    // "symlink" would fail on the previous one. TWO pass sentences, one check.
    id: 'bootenv-fw-setenv',
    boards: UBOOT_BOARDS,
    shell: {
      pass: [
        '/usr/bin/fw_setenv resolves to a regular file (symlink -> ',
        '/usr/bin/fw_setenv is a regular file',
      ],
      fail: '/usr/bin/fw_setenv is missing or does not resolve to a regular file;',
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const root = await packedRoot(ctx)
      const id = 'bootenv-fw-setenv'
      const path = '/usr/bin/fw_setenv'
      if (!regularFileFollowingLinks(root, path)) {
        return [verdict(id, false,
          `/usr/bin/fw_setenv is missing or does not resolve to a regular file; RAUC writes the boot `
          + `slot through it and the A/B handover fails on the device`)]
      }
      const st = entry(root, path)
      if (st?.isSymbolicLink() === true) {
        // `readlink`, not `readlink -f`: the RAW target, which is what the
        // oracle prints. On trixie that is `fw_printenv`, the multi-call binary.
        const target = readlinkSync(join(root, path))
        return [verdict(id, true, `/usr/bin/fw_setenv resolves to a regular file (symlink -> ${target})`)]
      }
      return [verdict(id, true, '/usr/bin/fw_setenv is a regular file')]
    },
  },

  {
    // The group's SKIP on a board whose RAUC backend is not U-Boot. Scoped to
    // the complement of `isUBoot`, which is the same predicate the two above
    // are scoped by.
    id: 'bootenv-fw-tools-skipped',
    boards: NOT_UBOOT_BOARDS,
    shell: { skip: 'fw_printenv/fw_setenv (bootloader=' },
    run: async (ctx): Promise<readonly CheckResult[]> => [skipped('bootenv-fw-tools-skipped',
      `fw_printenv/fw_setenv (bootloader=${ctx.board.bootloader ?? ''}): RAUC reaches this board's `
      + `boot state through grub-editenv, which is asserted separately above`)],
  },

  {
    id: 'bootenv-fw-env-config',
    boards: UBOOT_BOARDS,
    shell: {
      pass: '/etc/fw_env.config is a regular file',
      fail: '/etc/fw_env.config missing or not a regular file',
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const st = entry(await packedRoot(ctx), '/etc/fw_env.config')
      const ok = st !== undefined && st.isFile()
      return [verdict('bootenv-fw-env-config', ok,
        ok ? '/etc/fw_env.config is a regular file' : '/etc/fw_env.config missing or not a regular file')]
    },
  },

  {
    // TWO device lines is what marks the environment redundant to libubootenv;
    // with only one side configured, every read from the other fails its CRC.
    //
    // The count is the oracle's, including its defect. See the header: on a file
    // that exists with no `^/dev/` line, `grep -c ... || echo 0` yields the
    // two-line string "0\n0", and the oracle interpolates it into the message.
    id: 'bootenv-fw-env-two-lines',
    boards: UBOOT_BOARDS,
    shell: {
      pass: '/etc/fw_env.config has exactly two device lines',
      fail: ' device lines, expected 2;',
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const root = await packedRoot(ctx)
      const count = devLineCount(root, '/etc/fw_env.config')
      const ok = count === '2'
      return [verdict(
        'bootenv-fw-env-two-lines',
        ok,
        ok
          ? '/etc/fw_env.config has exactly two device lines (this is what marks the environment '
            + 'redundant to libubootenv)'
          : `/etc/fw_env.config has ${count} device lines, expected 2; with only one side configured, `
            + `every read from the other fails its CRC check`,
      )]
    },
  },

  {
    // Both UENV partitions, addressed by PARTUUID at offset 0 with the size the
    // board declares. A config naming one partition twice reads and writes the
    // same side, so the redundancy is a comment rather than a mechanism.
    id: 'bootenv-fw-env-addresses',
    boards: UBOOT_BOARDS,
    shell: {
      pass: '/etc/fw_env.config addresses both UENV partitions at offset 0x0 with size ',
      fail: "/etc/fw_env.config has no '/dev/disk/by-partuuid/",
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const { board } = ctx
      const root = await packedRoot(ctx)
      const sizeRaw = board.get('UENV_SIZE_BYTES')
      const size = sizeRaw === undefined ? Number.NaN : Number(sizeRaw)
      if (!Number.isFinite(size)) {
        throw new ToolOutputError(
          `${board.path} declares no usable UENV_SIZE_BYTES, so there is no size for this check to `
          + `look for in /etc/fw_env.config. A fail here would be a statement about the definition.`,
        )
      }
      const hex = `0x${size.toString(16)}`
      const body = lines(root, '/etc/fw_env.config')
      let bad = ''
      for (const key of ['UENV_A', 'UENV_B']) {
        const guid = (board.partition(key)?.guid ?? '').toLowerCase()
        // `grep -qiE "^/dev/disk/by-partuuid/<guid>[[:space:]]+0x0[[:space:]]+<hex>[[:space:]]*$"`
        const re = new RegExp(`^/dev/disk/by-partuuid/${guid}[ \t]+0x0[ \t]+${hex}[ \t]*$`, 'i')
        if (!body.some(l => re.test(l))) bad = guid
      }
      const ok = bad === ''
      return [verdict(
        'bootenv-fw-env-addresses',
        ok,
        ok
          ? `/etc/fw_env.config addresses both UENV partitions at offset 0x0 with size ${hex}`
          : `/etc/fw_env.config has no '/dev/disk/by-partuuid/${bad} 0x0 ${hex}' line`,
      )]
    },
  },

  {
    id: 'bootenv-fw-env-skipped',
    boards: NOT_UBOOT_BOARDS,
    shell: { skip: '/etc/fw_env.config and its two-device redundancy assertions (' },
    run: async (ctx): Promise<readonly CheckResult[]> => [skipped('bootenv-fw-env-skipped',
      `/etc/fw_env.config and its two-device redundancy assertions `
      + `(bootloader=${ctx.board.bootloader ?? ''}): there is no U-Boot environment on this board, so `
      + `there is nothing for libubootenv to address`)],
  },

  {
    id: 'bootenv-grub-editenv-regular',
    boards: GRUB_BOARDS,
    shell: {
      pass: '/usr/bin/grub-editenv is a regular file',
      fail: '/usr/bin/grub-editenv missing or not a regular file',
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const st = entry(await packedRoot(ctx), '/usr/bin/grub-editenv')
      const ok = st !== undefined && st.isFile()
      return [verdict('bootenv-grub-editenv-regular', ok,
        ok ? '/usr/bin/grub-editenv is a regular file' : '/usr/bin/grub-editenv missing or not a regular file')]
    },
  },

  {
    // The SECOND conclusion about the same file, and it is not a duplicate: a
    // missing helper does not stop rauc.service. The unit starts and then cannot
    // answer anything, reporting only "Failed to start grub-editenv" -- which
    // reads as a RAUC problem rather than as a missing 403 KB file. That is how
    // it was found on x64.
    id: 'bootenv-grub-editenv-present',
    boards: GRUB_BOARDS,
    shell: {
      pass: 'grub-editenv is in the packed root;',
      fail: 'grub-editenv is absent;',
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const root = await packedRoot(ctx)
      const note = `RAUC's grub backend execs it to read and write `
        + `${ctx.board.get('RAUC_GRUBENV') ?? 'the grubenv'}`
      const ok = regularFileFollowingLinks(root, '/usr/bin/grub-editenv')
      return [verdict(
        'bootenv-grub-editenv-present',
        ok,
        ok
          ? `grub-editenv is in the packed root; ${note}`
          : `grub-editenv is absent; ${note}, so the A/B boot order can be neither read nor written `
            + `and rauc.service is up but useless`,
      )]
    },
  },
]

/**
 * `grep -cE '^/dev/' FILE 2>/dev/null || echo 0` -- INCLUDING its defect.
 *
 * On a file that exists with no matching line, `grep -c` prints `0` AND exits 1,
 * so the `|| echo 0` fires too and the value is the two-line string "0\n0". On a
 * MISSING file grep prints nothing and exits 2, so the value is a single "0".
 *
 * Reproduced rather than repaired. A port that emitted `0` in both cases would
 * agree with the oracle on every image where the branch is not taken -- which is
 * both shipped images -- and diverge on the one image where the difference is
 * the whole point. Reported for M4e.
 */
export function devLineCount(root: string, path: string): string {
  const body = text(root, path)
  if (body === '') return '0'
  const n = body.split('\n').filter(l => l.startsWith('/dev/')).length
  return n === 0 ? '0\n0' : String(n)
}

// the health gate's two root-side conclusions

const HEALTH_CHECKS: readonly CheckCase[] = [
  {
    // `rauc status --output-format=shell` emits RAUC_SYSTEM_BOOTED_BOOTNAME and
    // never RAUC_SYSTEM_BOOTED_SLOT -- verified against rauc 1.8 driving this
    // exact system.conf. A gate that greps for the latter always reads empty,
    // always exits 0, and never reaches `rauc status mark-good`, so every update
    // rolls back. Independently of the rauc.slot= problem.
    id: 'health-gate-no-phantom-rauc-var',
    shell: {
      pass: 'mos-health does not depend on the non-existent RAUC_SYSTEM_BOOTED_SLOT variable',
      fail: [
        '/usr/lib/mos/mos-health missing, so its RAUC status parsing cannot be checked',
        'mos-health parses RAUC_SYSTEM_BOOTED_SLOT, which rauc 1.8 NEVER emits.',
      ],
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const root = await packedRoot(ctx)
      const id = 'health-gate-no-phantom-rauc-var'
      if (!regularFileFollowingLinks(root, MOS_HEALTH)) {
        return [verdict(id, false,
          '/usr/lib/mos/mos-health missing, so its RAUC status parsing cannot be checked')]
      }
      if (text(root, MOS_HEALTH).includes('RAUC_SYSTEM_BOOTED_SLOT')) {
        return [verdict(id, false,
          'mos-health parses RAUC_SYSTEM_BOOTED_SLOT, which rauc 1.8 NEVER emits. `rauc status '
          + "--output-format=shell` emits RAUC_SYSTEM_BOOTED_BOOTNAME (plus per-slot "
          + "RAUC_SLOT_STATE_n='booted'); verified against rauc 1.8 driving this exact system.conf. "
          + 'The gate therefore always reads an empty slot, always exits 0 and never reaches `rauc '
          + 'status mark-good`, so every update rolls back. Fix belongs in '
          + 'rootfs/overlay/usr/lib/mos/mos-health, NOT here')]
      }
      return [verdict(id, true,
        'mos-health does not depend on the non-existent RAUC_SYSTEM_BOOTED_SLOT variable')]
    },
  },

  {
    // mos-health probe c calls curl (or wget) against https://127.0.0.1/healthz
    // and logs "SKIP (no curl or wget in the image)" when neither exists -- a
    // silent hole in the gate. curl was added to the rootfs allowlist
    // deliberately, so its absence is a regression rather than a neutral fact.
    id: 'health-gate-http-client',
    shell: {
      pass: 'apid health probe is LIVE: ',
      fail: 'no curl or wget in the image,',
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const root = await packedRoot(ctx)
      const found = ['/usr/bin/curl', '/usr/bin/wget', '/bin/curl', '/bin/wget']
        .find(c => regularFileFollowingLinks(root, c))
      return [verdict(
        'health-gate-http-client',
        found !== undefined,
        found !== undefined
          ? `apid health probe is LIVE: ${found} is in the image (mos-health probe c would SKIP `
            + `without an HTTP client)`
          : `no curl or wget in the image, so mos-health probe c degrades to 'SKIP (no curl or wget `
            + `in the image)' and apid is never actually probed by the health gate`,
      )]
    },
  },
]

// systemd-repart definitions

const REPART_CHECKS: readonly CheckCase[] = [
  {
    // repart pairs definitions with partitions by type UUID in disk order, so
    // the count must match the number of linux-generic partitions exactly: one
    // too few and the grow flag attaches to the wrong partition, one too many
    // and repart CREATES a partition nobody asked for.
    //
    // The expected count is counted in the image's own GPT, which is what makes
    // this an integration check rather than two hardcoded numbers agreeing with
    // each other -- and what proves the loader partition is invisible to repart,
    // since its distinct type keeps it out of the count.
    id: 'repart-definition-count',
    shell: {
      pass: '/etc/repart.d has exactly ',
      fail: ' definitions but the GPT carries ',
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const root = await packedRoot(ctx)
      const want = await linuxGenericCount(ctx)
      const got = countConfFiles(root, '/etc/repart.d')
      const ok = got === want && want > 0
      return [verdict(
        'repart-definition-count',
        ok,
        ok
          ? `/etc/repart.d has exactly ${want} definitions, one per linux-generic partition counted `
            + `in the image's own GPT (the loader is not one of them)`
          : `/etc/repart.d has ${got} definitions but the GPT carries ${want} linux-generic `
            + `partitions; repart matches definitions to partitions by type UUID in disk order, so a `
            + `miscount silently attaches growth to the wrong partition`,
      )]
    },
  },

  {
    // Exactly one definition may grow, and it must be DATA's. A Weight= on the
    // ephemeral definition grows the partition that is wiped by design.
    id: 'repart-one-growing-definition',
    shell: {
      pass: 'exactly one repart definition grows, and it is 80-data.conf',
      fail: 'expected exactly one growing repart definition, 80-data.conf; found ',
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const root = await packedRoot(ctx)
      const growing = confFiles(root, '/etc/repart.d')
        .filter(f => text(root, `/etc/repart.d/${f}`).split('\n').includes('Weight=1000'))
        .sort()
      const ok = growing.length === 1 && growing[0] === '80-data.conf'
      const partnum = ctx.board.partition('DATA')?.partnum ?? ''
      return [verdict(
        'repart-one-growing-definition',
        ok,
        ok
          ? `exactly one repart definition grows, and it is 80-data.conf (DATA / p${partnum}), not ephemeral`
          : `expected exactly one growing repart definition, 80-data.conf; found ${growing.length}: `
            + `${growing.join(' ')}${growing.length > 0 ? ' ' : ''}`,
      )]
    },
  },

  {
    // The loader is protected STRUCTURALLY -- by having a GPT entry of its own
    // type -- and not by a flag. A `--discard=no` drop-in would protect it by
    // turning off first-boot TRIM for the whole disk, which is a different
    // decision wearing the same result.
    id: 'repart-no-discard-override',
    shell: {
      pass: 'no --discard=no override ships in the image;',
      fail: 'a --discard=no override ships in the image (',
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const root = await packedRoot(ctx)
      const hits = discardOverrides(root)
      return [verdict(
        'repart-no-discard-override',
        hits.length === 0,
        hits.length === 0
          ? 'no --discard=no override ships in the image; the loader is protected by its GPT entry '
            + 'and first-boot TRIM stays enabled'
          : `a --discard=no override ships in the image (${hits.join(' ')}`
            + `${hits.length > 0 ? ' ' : ''}); loader protection must come from the partition entry, `
            + `not from disabling discard`,
      )]
    },
  },
]

/** `find "${ROOT}/etc/repart.d" -name '*.conf' | wc -l`. */
function confFiles(root: string, dir: string): string[] {
  try {
    return readdirSync(join(root, dir)).filter(f => f.endsWith('.conf'))
  }
  catch {
    return []
  }
}

function countConfFiles(root: string, dir: string): number {
  return confFiles(root, dir).length
}

/**
 * `LINUX_GENERIC_N` -- partitions of the linux-generic type, counted in the
 * image's own GPT.
 *
 * Read from the TABLE and not from the board definition, on the oracle's own
 * reasoning: a check comparing the definitions to the layout must read the two
 * independently, or it hands itself the same number on both sides.
 */
const LINUX_GENERIC_TYPE = '0fc63daf-8483-4772-8e79-3d69d8477de4'

async function linuxGenericCount(ctx: { gpt: () => Promise<{ partitions: readonly { typeGuid: string }[] }> }): Promise<number> {
  const table = await ctx.gpt()
  return table.partitions.filter(p => p.typeGuid.toLowerCase() === LINUX_GENERIC_TYPE).length
}

/** Every shipped file under the systemd trees carrying `--discard=no`. */
function discardOverrides(root: string): string[] {
  const found: string[] = []
  const walk = (dir: string): void => {
    let names: string[]
    try {
      names = readdirSync(dir)
    }
    catch {
      return
    }
    for (const name of names) {
      const full = join(dir, name)
      let st: Stats | undefined
      try {
        st = statSync(full)
      }
      catch {
        continue
      }
      if (st.isDirectory()) {
        walk(full)
        continue
      }
      if (!st.isFile()) continue
      let body = ''
      try {
        body = readFileSync(full, 'utf8')
      }
      catch {
        continue
      }
      // The FULL path, not the root-relative one: this is the one message in
      // the oracle that does not strip ${ROOT}, so it prints the container-side
      // absolute path -- and here it prints the unpack directory's, which is the
      // same directory under a different name.
      if (body.includes('--discard=no')) found.push(full)
    }
  }
  // TWO trees, not three: the oracle's grep covers /etc/systemd and
  // /usr/lib/systemd and NOT /usr/local/lib/systemd. Reproduced rather than
  // widened -- the STATE-backed unit directory is empty in the image, and a
  // check that read it would be answering about a runtime state no image has.
  for (const tree of ['/etc/systemd', '/usr/lib/systemd']) {
    walk(join(root, tree))
  }
  return found.sort()
}

// the AuthorizedKeysFile drop-in

/** `sed -n 's/^ *AuthorizedKeysFile +\(.*[^ ]\) *$/\1/p' | tail -n1`. */
function authorizedKeysValue(root: string, path: string): string {
  const values = lines(root, path)
    .flatMap(l => /^[ \t]*AuthorizedKeysFile[ \t]+(.*[^ \t])[ \t]*$/.exec(l)?.[1] ?? [])
  return values.at(-1) ?? ''
}

const SSHD_CHECKS: readonly CheckCase[] = [
  {
    id: 'sshd-authorized-keys-value',
    shell: {
      pass: `${SSHD_DROPIN} sets AuthorizedKeysFile ${AK_EXPECT},`,
      fail: `${SSHD_DROPIN} sets AuthorizedKeysFile to '`,
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const root = await packedRoot(ctx)
      const value = authorizedKeysValue(root, SSHD_DROPIN)
      const ok = value === AK_EXPECT
      return [verdict(
        'sshd-authorized-keys-value',
        ok,
        ok
          ? `${SSHD_DROPIN} sets AuthorizedKeysFile ${AK_EXPECT}, the file mosd renders per user`
          : `${SSHD_DROPIN} sets AuthorizedKeysFile to '${value === '' ? '<nothing>' : value}', `
            + `expected '${AK_EXPECT}'; sshd would read keys from somewhere mosd does not write, so no `
            + `installed key would ever grant access`,
      )]
    },
  },

  {
    // The path it names has to sit inside the directory etc-ssh.mount binds
    // from STATE, or the keys land in the read-only squashfs view of /etc and
    // vanish on the next A/B update. Where=/What= are READ from the unit, so
    // retargeting the mount cannot leave this passing for a stale path.
    id: 'sshd-authorized-keys-on-state',
    shell: {
      pass: ' is inside /etc/ssh, which etc-ssh.mount binds from ',
      fail: [
        'etc-ssh.mount is not in the image,',
        'the AuthorizedKeysFile path \'',
        'etc-ssh.mount binds ',
      ],
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const root = await packedRoot(ctx)
      const id = 'sshd-authorized-keys-on-state'
      const unit = '/etc/systemd/system/etc-ssh.mount'
      const value = authorizedKeysValue(root, SSHD_DROPIN)
      const where = lastValue(root, unit, 'Where=')
      const what = lastValue(root, unit, 'What=')
      if (!regularFileFollowingLinks(root, unit)) {
        return [verdict(id, false,
          'etc-ssh.mount is not in the image, so authorised keys have no STATE-backed home and would '
          + 'be lost by every update')]
      }
      if (where === '' || !value.startsWith(`${where}/`)) {
        return [verdict(id, false,
          `the AuthorizedKeysFile path '${value}' is not inside '${where === '' ? '<no Where=>' : where}', `
          + `the directory etc-ssh.mount binds; keys written there would land in the read-only image `
          + `view of /etc and not survive an A/B update`)]
      }
      if (!what.startsWith('/mnt/state/')) {
        return [verdict(id, false,
          `etc-ssh.mount binds ${where} from '${what}', which is not under /mnt/state; authorised keys `
          + `would not be on the STATE partition and would not survive an A/B update`)]
      }
      return [verdict(id, true,
        `the AuthorizedKeysFile path ${value} is inside ${where}, which etc-ssh.mount binds from `
        + `${what} on STATE, so installed keys survive an A/B update`)]
    },
  },

  {
    // sshd keeps the FIRST value it reads for this keyword and reads
    // sshd_config.d in lexical order, so a second file emitting it would make
    // the winner depend on filename ordering.
    id: 'sshd-single-authorized-keys-emitter',
    shell: {
      pass: ' is the ONLY shipped sshd config emitting AuthorizedKeysFile',
      fail: ' shipped sshd config files emit AuthorizedKeysFile (',
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const root = await packedRoot(ctx)
      // `grep -l ... /etc/ssh/sshd_config /etc/ssh/sshd_config.d/*.conf | sort`
      const candidates = ['/etc/ssh/sshd_config', ...confFiles(root, '/etc/ssh/sshd_config.d')
        .map(f => `/etc/ssh/sshd_config.d/${f}`)]
      const emitters = candidates
        .filter(p => lines(root, p).some(l => /^[ \t]*AuthorizedKeysFile[ \t]/.test(l)))
        .sort()
      const ok = emitters.length === 1 && emitters[0] === SSHD_DROPIN
      return [verdict(
        'sshd-single-authorized-keys-emitter',
        ok,
        ok
          ? `${SSHD_DROPIN} is the ONLY shipped sshd config emitting AuthorizedKeysFile, so which `
            + `value wins cannot depend on filename ordering`
          : `${emitters.length} shipped sshd config files emit AuthorizedKeysFile `
            + `(${emitters.join(' ')}); sshd keeps the first value it `
            + `reads in lexical order, so the effective authorised-keys path depends on filenames`,
      )]
    },
  },
]

/** `sed -n 's/^KEY//p' | tail -n1`. */
function lastValue(root: string, path: string, key: string): string {
  const values = lines(root, path).filter(l => l.startsWith(key)).map(l => l.slice(key.length))
  return values.at(-1) ?? ''
}

// the image profile, and the SSH default it selects

export interface ProfileContract {
  readonly key: string
  readonly defaultPath: string
}

/** `PROFILE_KEY` and `DEFAULT_PROFILE_PATH`, read out of mosd's provisioning.rs. */
export function readProfileContract(): ProfileContract {
  return {
    key: mosdSourceConst('provisioning.rs', /^const PROFILE_KEY: &str = "(.*)";$/),
    defaultPath: mosdSourceConst('provisioning.rs', /^pub const DEFAULT_PROFILE_PATH: &str = "(.*)";$/),
  }
}

const PROFILE_CHECKS: readonly CheckCase[] = [
  {
    // mosd fails closed on a missing profile: every image would self-provision
    // to prod and disable its own sshd with every other check still green. So
    // the path and the key are READ from mosd rather than restated.
    id: 'profile-path-matches-mosd',
    shell: {
      pass: 'mosd reads the image profile from ',
      fail: "mosd reads its profile from '",
    },
    run: async (): Promise<readonly CheckResult[]> => {
      const { key, defaultPath } = readProfileContract()
      const ok = defaultPath === PROFILE_FILE && key !== ''
      return [verdict(
        'profile-path-matches-mosd',
        ok,
        ok
          ? `mosd reads the image profile from ${defaultPath} with key ${key}, which is the file this `
            + `image ships`
          : `mosd reads its profile from '${defaultPath}' with key '${key}', but the image ships `
            + `${PROFILE_FILE}; mosd FAILS CLOSED on a missing file, so every image would `
            + `self-provision to prod and disable its own sshd with every check still green`,
      )]
    },
  },

  {
    id: 'profile-mode-0444',
    shell: {
      pass: `${PROFILE_FILE} is mode 0444`,
      fail: `${PROFILE_FILE} is mode `,
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const mode = modeOf(await packedRoot(ctx), PROFILE_FILE)
      const ok = mode === '444'
      return [verdict(
        'profile-mode-0444',
        ok,
        ok
          ? `${PROFILE_FILE} is mode 0${mode} (it describes the image, not the device, and lives `
            + `inside the read-only verity root)`
          : `${PROFILE_FILE} is mode ${mode}, expected 444`,
      )]
    },
  },

  {
    // The value is matched CASE-SENSITIVELY by mosd and anything it does not
    // recognise resolves to prod, so `DEV`, `Dev`, a comment or a typo in the
    // key are all the same silent failure: SSH off on an image built to have it
    // on. And mosd takes the LAST line, so two of them make the file's meaning
    // depend on line order.
    id: 'profile-value-recognised',
    shell: {
      pass: ' line, an exact lowercase value mosd recognises',
      fail: [
        ' lines; mosd takes the LAST one,',
        ', which mosd does not recognise.',
      ],
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const root = await packedRoot(ctx)
      const id = 'profile-value-recognised'
      const key = readProfileContract().key || 'MOS_PROFILE'
      const values = profileValues(root, key)
      const value = values.at(-1) ?? ''
      if (value === 'dev' || value === 'prod') {
        if (values.length === 1) {
          return [verdict(id, true,
            `${PROFILE_FILE} carries exactly one ${key}=${value} line, an exact lowercase value mosd `
            + `recognises`)]
        }
        return [verdict(id, false,
          `${PROFILE_FILE} carries ${values.length} ${key}= lines; mosd takes the LAST one, so the `
          + `file's meaning depends on line order`)]
      }
      return [verdict(id, false,
        `${PROFILE_FILE} resolves to '${value}', which mosd does not recognise. Its match is `
        + `case-sensitive and it FAILS CLOSED: this image would self-provision to prod and disable `
        + `its own sshd, with every other check still green. Contents: `
        + `${text(root, PROFILE_FILE).replaceAll('\n', ' ')}`)]
    },
  },

  {
    // ssh.service must NOT be enabled in the image, on EITHER profile -- the
    // assertion is deliberately NOT profile-dependent. mosd seeds
    // access.ssh.enabled false for dev and prod alike, so an image that
    // shipped ssh.service enabled would be listening from early boot until
    // mosd's first reconcile stopped it -- precisely the window the setting
    // exists to close.
    id: 'profile-ssh-not-enabled',
    shell: {
      pass: ' and ssh.service is NOT enabled in the image,',
      fail: [
        ' but ssh.service IS enabled in the image (',
        'ssh.service enablement cannot be judged:',
      ],
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const root = await packedRoot(ctx)
      const id = 'profile-ssh-not-enabled'
      const key = readProfileContract().key || 'MOS_PROFILE'
      const value = profileValues(root, key).at(-1) ?? ''
      if (value !== 'dev' && value !== 'prod') {
        return [verdict(id, false,
          'ssh.service enablement cannot be judged: the image profile did not resolve to dev or prod')]
      }
      const wants = sshWants(root)
      if (wants.length === 0) {
        return [verdict(id, true,
          `profile is ${value} and ssh.service is NOT enabled in the image, so sshd never listens `
          + `before mosd has decided (both profiles seed access.ssh.enabled false)`)]
      }
      return [verdict(id, false,
        `profile is ${value} but ssh.service IS enabled in the image (${wants.join(' ')}); sshd would `
        + `be listening from early boot until mosd's reconciler stopped it, and both profiles now seed `
        + `access.ssh.enabled false`)]
    },
  },
]

/** `sed -n "s/^KEY=\(.*\)$/\1/p"` over the profile, then `grep -c .` for the count. */
function profileValues(root: string, key: string): string[] {
  return lines(root, PROFILE_FILE)
    .flatMap(l => (l.startsWith(`${key}=`) ? [l.slice(key.length + 1)] : []))
    // `grep -c .` counts NON-EMPTY lines, so `MOS_PROFILE=` on its own is not one.
    .filter(v => v !== '')
}

/** `find ... \( -name ssh.service -o -name sshd.service \) -path '*.wants/*'`. */
function sshWants(root: string): string[] {
  const found: string[] = []
  const walk = (dir: string): void => {
    let names: string[]
    try {
      names = readdirSync(dir)
    }
    catch {
      return
    }
    for (const name of names) {
      const full = join(dir, name)
      // lstat, never stat: `find` reports the LINK, and a *.wants entry IS one.
      let st: Stats
      try {
        st = lstatSync(full)
      }
      catch {
        continue
      }
      if ((name === 'ssh.service' || name === 'sshd.service') && /\.wants\//.test(full)) {
        found.push(full.slice(root.length))
      }
      if (st.isDirectory()) walk(full)
    }
  }
  for (const tree of ['/etc/systemd/system', '/usr/lib/systemd/system']) walk(join(root, tree))
  return found.sort()
}

// ssh.service's inherited properties

interface SshUnitCase {
  readonly id: string
  /** `KillMode` or `ExecReload` -- the noun the absent-unit branch names. */
  readonly what: string
  readonly pattern: RegExp
  readonly passMatcher: string
  readonly failMatcher: string
  readonly passMessage: string
  readonly failMessage: (found: string) => string
}

/**
 * KillMode= and ExecReload= are INHERITED from Debian's openssh-server, not
 * authored here, and the sshd reconciler's correctness rests on both.
 *
 * The reload is the mitigation and KillMode is defence in depth: an operator who
 * sets a transient root password over their own SSH session keeps it because the
 * reconciler RELOADS on a config-only change, and sshd re-reads its
 * configuration on SIGHUP. KillMode=process bounds the damage if something
 * restarts the unit anyway. Neither passing is a reason to go back to restarting.
 */
function sshUnitCheck(c: SshUnitCase): CheckCase {
  return {
    id: c.id,
    shell: {
      pass: c.passMatcher,
      fail: [
        `/usr/lib/systemd/system/ssh.service is not in the image, so no claim can be made about ${c.what}`,
        c.failMatcher,
      ],
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const root = await packedRoot(ctx)
      if (!regularFileFollowingLinks(root, SSH_UNIT)) {
        return [verdict(c.id, false,
          `/usr/lib/systemd/system/ssh.service is not in the image, so no claim can be made about ${c.what}`)]
      }
      const body = lines(root, SSH_UNIT)
      if (body.some(l => c.pattern.test(l))) return [verdict(c.id, true, c.passMessage)]
      const found = body.filter(l => l.startsWith('KillMode=')).map(l => l.slice('KillMode='.length)).at(-1) ?? ''
      return [verdict(c.id, false, c.failMessage(found))]
    },
  }
}

const SSH_UNIT_CHECKS: readonly CheckCase[] = [
  sshUnitCheck({
    id: 'ssh-killmode-process',
    what: 'KillMode',
    pattern: /^KillMode=process[ \t]*$/,
    passMatcher: 'ssh.service sets KillMode=process,',
    failMatcher: 'ssh.service does NOT set KillMode=process (found ',
    passMessage: 'ssh.service sets KillMode=process, so a restart would spare established sessions '
      + '— defence in depth only: what actually protects an operator\'s own session is that the '
      + 'reconciler RELOADS on a config-only change, and this passing is not a reason to '
      + 'restart instead',
    failMessage: found => `ssh.service does NOT set KillMode=process (found '${found}'; systemd `
      + `defaults to control-group). The image has lost its second line of defence: anything that `
      + `RESTARTS this unit now kills established SSH sessions with it. This does not by itself `
      + `disconnect an operator setting a transient root password — the reconciler reloads rather than `
      + `restarts — but that reload is now the ONLY thing preventing it, so do not treat `
      + `this as cosmetic`,
  }),
  sshUnitCheck({
    id: 'ssh-execreload-present',
    what: 'ExecReload',
    pattern: /^ExecReload=/,
    passMatcher: 'ssh.service carries ExecReload=,',
    failMatcher: 'ssh.service has NO ExecReload=.',
    passMessage: 'ssh.service carries ExecReload=, so the config-only reload the sshd reconciler '
      + 'issues can actually reach the running sshd',
    failMessage: () => 'ssh.service has NO ExecReload=. The sshd reconciler RELOADS this unit on a '
      + 'configuration-only change; without ExecReload that reload fails, and the rendered '
      + 'sshd configuration — PasswordAuthentication included — silently never applies to the running '
      + 'listener',
  }),
]

// libcrypt, and the crypt(3) format mosd writes

const MULTIARCH: ReadonlyMap<string, string> = new Map([
  ['arm64', 'aarch64-linux-gnu'],
  ['amd64', 'x86_64-linux-gnu'],
])

/** Every distinct `starts_with("$X$")` prefix `transient.rs` pins, sorted. */
export function cryptPrefixes(): string[] {
  let src: string
  try {
    src = readFileSync(join(MOSD_SRC, 'transient.rs'), 'utf8')
  }
  catch {
    return []
  }
  const found = new Set<string>()
  for (const m of src.matchAll(/starts_with\("(\$[0-9a-zA-Z]+\$)/g)) found.add(m[1] as string)
  return [...found].sort()
}

function libcryptLink(board: Board): string {
  const triplet = MULTIARCH.get(board.arch ?? '')
  if (triplet === undefined) {
    throw new ToolOutputError(
      `${board.path} declares MOS_ARCH='${board.arch ?? ''}'; this verifier knows arm64 and amd64. `
      + `The multiarch triplet FOLLOWS the board: pinning aarch64 is what made this check report that `
      + `libcrypt "does not resolve to a regular file" on x64 -- true of a path that board never had.`,
    )
  }
  return `/usr/lib/${triplet}/libcrypt.so.1`
}

/** `readlink -f`, resolved WITHIN the unpacked tree, or the empty string. */
function libcryptReal(root: string, link: string): string {
  if (!existsSync(join(root, link))) return ''
  try {
    return realpathSync(join(root, link))
  }
  catch {
    return ''
  }
}

const CRYPT_CHECKS: readonly CheckCase[] = [
  {
    // Requiring exactly ONE keeps the source unambiguous: two pinned prefixes
    // and the format the image must support is a question rather than a fact,
    // so the check below could not mean anything.
    id: 'crypt-prefix-pinned-once',
    shell: {
      pass: 'transient.rs pins exactly one crypt(3) prefix for the shadow field: ',
      fail: 'distinct crypt(3) prefixes (',
    },
    run: async (): Promise<readonly CheckResult[]> => {
      const prefixes = cryptPrefixes()
      const ok = prefixes.length === 1
      return [verdict(
        'crypt-prefix-pinned-once',
        ok,
        ok
          ? `transient.rs pins exactly one crypt(3) prefix for the shadow field: ${prefixes[0] as string}`
          : `transient.rs pins ${prefixes.length} distinct crypt(3) prefixes (${prefixes.join(' ')}); `
            + `the format the image must support is ambiguous, so `
            + `the libcrypt check below cannot mean anything`,
      )]
    },
  },

  {
    id: 'libcrypt-resolves',
    shell: {
      pass: ' in the image (the SONAME the login stack loads)',
      fail: ' does not resolve to a regular file in the image;',
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const root = await packedRoot(ctx)
      const link = libcryptLink(ctx.board)
      const real = libcryptReal(root, link)
      const ok = real !== '' && (() => {
        try {
          return statSync(real).isFile()
        }
        catch {
          return false
        }
      })()
      return [verdict(
        'libcrypt-resolves',
        ok,
        ok
          ? `${link} resolves to ${real.slice(root.length)} in the image (the SONAME the login stack loads)`
          : `${link} does not resolve to a regular file in the image; without it pam_unix cannot `
            + `verify any password at all`,
      )]
    },
  },

  {
    // No Rust test can make this assertion: the test host is x86 and the library
    // is an arm64 object inside the image. A format the library cannot parse
    // rejects every password while the file, the unit and the reconciler all
    // look perfectly healthy.
    id: 'libcrypt-implements-prefix',
    shell: {
      pass: ', the crypt(3) format mosd writes into the root shadow entry',
      fail: [
        "cannot check the crypt(3) format against the image's libcrypt:",
        ') does NOT implement ',
      ],
    },
    run: async (ctx): Promise<readonly CheckResult[]> => {
      const root = await packedRoot(ctx)
      const id = 'libcrypt-implements-prefix'
      const prefixes = cryptPrefixes()
      const link = libcryptLink(ctx.board)
      const real = libcryptReal(root, link)
      const size = real === '' ? 0 : (() => {
        try {
          return statSync(real).size
        }
        catch {
          return 0
        }
      })()
      if (prefixes.length !== 1 || size === 0) {
        return [verdict(id, false,
          `cannot check the crypt(3) format against the image's libcrypt: prefix count `
          + `${prefixes.length}, library '${real === '' ? 'missing' : real}'`)]
      }
      const prefix = prefixes[0] as string
      const bytes = readFileSync(real)
      // `tr -c '[:print:]' '\n' | grep -F` finds the prefix exactly when its
      // bytes are contiguous and printable, which is what an indexOf over the
      // raw file answers -- and `$2b$` is printable ASCII, so there is no case
      // where the two disagree.
      if (bytes.includes(Buffer.from(prefix, 'latin1'))) {
        return [verdict(id, true,
          `the libcrypt packed in this image implements ${prefix}, the crypt(3) format mosd writes `
          + `into the root shadow entry`)]
      }
      const carried = printableRuns(bytes)
        .filter(s => /^\$[0-9a-z]+\$$/.test(s))
        .sort()
      const unique = [...new Set(carried)]
      return [verdict(id, false,
        `the libcrypt packed in this image (${real.split('/').at(-1) ?? ''}) does NOT implement `
        + `${prefix}, the format mosd writes into /etc/shadow. pam_unix would reject every password `
        + `while the shadow file, the reconciler and every other check look healthy. Formats it does `
        + `carry: ${unique.join(' ')}${unique.length > 0 ? ' ' : ''}`)]
    },
  },
]

/** `LC_ALL=C tr -c '[:print:]' '\n'` -- the runs of printable bytes, as lines. */
function printableRuns(bytes: Buffer): string[] {
  const out: string[] = []
  let current = ''
  for (const b of bytes) {
    // POSIX [:print:] in the C locale is 0x20..0x7e.
    if (b >= 0x20 && b <= 0x7E) current += String.fromCharCode(b)
    else {
      out.push(current)
      current = ''
    }
  }
  out.push(current)
  return out
}

// every external binary the /usr/lib/mos boot scripts invoke

const BOOT_SCRIPT_COMMANDS: CheckCase = {
  // These scripts run at boot, as root, OUTSIDE any package's dependency graph,
  // so nothing in the image declares what they need. The dependency is real: the
  // newline-safety fix in mos-shadow-reconcile made it call `od`, and neither
  // Dockerfile installs coreutils explicitly -- it arrives with the base image
  // and would disappear without a word if the base were ever slimmed.
  //
  // The vacuity guard is half the check. If the extractor stops seeing commands,
  // an empty set makes the presence test pass while proving nothing at all, so
  // fewer than ten extracted names is itself a failure.
  id: 'boot-scripts-commands-resolve',
  shell: {
    pass: ' external commands invoked at command position by the /usr/lib/mos boot scripts resolve',
    fail: [
      ' command names were extracted from the /usr/lib/mos boot scripts;',
      'the /usr/lib/mos boot scripts invoke commands that are NOT in the packed rootfs:',
    ],
  },
  run: async (ctx): Promise<readonly CheckResult[]> => {
    const root = await packedRoot(ctx)
    const id = 'boot-scripts-commands-resolve'
    const commands = bootScriptCommands(root)
    const missing = commands.filter(c => !resolvesInRoot(root, c))
    if (commands.length < 10) {
      return [verdict(id, false,
        `only ${commands.length} command names were extracted from the /usr/lib/mos boot scripts; the `
        + `extractor is not reading them, so the binary-presence check would pass vacuously`)]
    }
    if (missing.length === 0) {
      return [verdict(id, true,
        `all ${commands.length} external commands invoked at command position by the /usr/lib/mos `
        + `boot scripts resolve in the packed rootfs (${commands.join(' ')})`)]
    }
    return [verdict(id, false,
      `the /usr/lib/mos boot scripts invoke commands that are NOT in the packed rootfs:`
      + `${missing.map(m => ` ${m}`).join('')}. These scripts run at boot as root with no package `
      + `dependency declaring them; a missing one fails at runtime, in the code that reconciles root's `
      + `credentials`)]
  },
}

/** Every `#!`-headed regular file under /usr/lib/mos, in the oracle's own order. */
function bootScriptCommands(root: string): string[] {
  const dir = join(root, '/usr/lib/mos')
  let names: string[]
  try {
    names = readdirSync(dir).sort()
  }
  catch {
    return []
  }
  const all = new Set<string>()
  for (const name of names) {
    const full = join(dir, name)
    let st: Stats
    try {
      st = statSync(full)
    }
    catch {
      continue
    }
    if (!st.isFile()) continue
    let body: string
    try {
      body = readFileSync(full, 'latin1')
    }
    catch {
      continue
    }
    // `head -c 2` -- the first two bytes, not a search.
    if (body.slice(0, 2) !== '#!') continue
    for (const c of extractCommands(body)) all.add(c)
  }
  return [...all].sort()
}


export const SYSTEM_CHECKS: readonly CheckCase[] = [
  NETWORKD_CHECK,
  ...SHIPPED.flatMap(board => ['/usr/bin/mosd', '/usr/bin/apid'].map(p => elfArchCheck(board, p))),
  ...BOOTENV_CHECKS,
  ...HEALTH_CHECKS,
  ...REPART_CHECKS,
  ...SSHD_CHECKS,
  ...PROFILE_CHECKS,
  ...SSH_UNIT_CHECKS,
  ...CRYPT_CHECKS,
  BOOT_SCRIPT_COMMANDS,
]
