// Batch 4b's ext4 family, driven from the failing side: one mutation per check.
//
// PLAN-014 M4g (RFCT-110), RFCT-096's rule. Every case asserts the check GREEN
// against an unmutated transcript first and RED against a transcript that
// differs in exactly one field, and asserts the MESSAGE names the tier -- a
// check that goes red about `state` when `data` is the broken one sends a
// reader to the wrong partition and the parity harness still calls it a clean
// divergence.
//
// WHY TRANSCRIPTS AND NOT A REAL FILESYSTEM. `make os-verify-test` runs on a
// host with no image and in CI inside the pinned bun container with no docker
// under it, so a suite that needed a real ext4 would be a suite that skipped --
// and a skip reports the same green as a pass. Every transcript below was
// captured on 2026-08-26 from e2fsprogs 1.47.1 in the pinned alpine:3.21,
// against the real cx3576 image and against deliberately malformed inputs.

import { describe, expect, test } from 'bun:test'
import { loadBoard } from './board.ts'
import { EXT4_CHECKS } from './checks-ext4.ts'
import { healthyGpt, imageFixture } from './checks-fixture.ts'
import type { CheckCase } from './checks.ts'
import { boardEnvPath } from './paths.ts'
import type { CheckResult } from './parity.ts'
import { runChecked, type ToolResult, type ToolRuntime } from './tools.ts'

const cx3576 = loadBoard(boardEnvPath('cx3576'))
const x64 = loadBoard(boardEnvPath('x64'))

/** The real slot size on the shipped cx3576 image, as sgdisk reads it. */
const SLOT = 524288
/** ...and on x64's. */
const X64_SLOT = 1048576

// ── real transcripts, one per tool per tier ────────────────────────────────

interface TierReply {
  readonly tune2fs?: Partial<ToolResult>
  readonly debugfsLs?: Partial<ToolResult>
  readonly debugfsStat?: Partial<ToolResult>
  readonly debugfsLibLs?: Partial<ToolResult>
  readonly e2fsck?: Partial<ToolResult>
}

/** `tune2fs -l` on a real tier of the shipped cx3576 image. */
function tune2fs(label: string, uuid: string, blocks: number, features?: string): Partial<ToolResult> {
  return {
    stdout: `tune2fs 1.47.1 (20-May-2024)
Filesystem volume name:   ${label}
Last mounted on:          <not available>
Filesystem UUID:          ${uuid}
Filesystem magic number:  0xEF53
Filesystem revision #:    1 (dynamic)
Filesystem features:      ${features ?? 'has_journal ext_attr resize_inode dir_index filetype extent 64bit flex_bg sparse_super large_file huge_file dir_nlink extra_isize metadata_csum'}
Filesystem state:         clean
Block count:              ${blocks}
Block size:               4096
`,
    stderr: '',
  }
}

/** `debugfs -R "ls -p /"`, in the `/inode/mode/uid/gid/name/size/` form. */
function lsp(names: readonly string[]): Partial<ToolResult> {
  const rows = ['/2/040755/0/0/.//', '/2/040755/0/0/..//', '/11/040700/0/0/lost+found//']
    .concat(names.map((n, i) => `/${12 + i}/040755/0/0/${n}//`))
  return { stdout: `${rows.join('\n')}\n`, stderr: 'debugfs 1.47.1 (20-May-2024)\n' }
}

const E2FSCK_CLEAN: Partial<ToolResult> = {
  code: 0,
  stdout: `e2fsck 1.47.1 (20-May-2024)
Pass 5: Checking group summary information
meta: 12/4096 files (8.3% non-contiguous), 1650/4096 blocks
`,
}

/** e2fsck on 8 MiB of zeros: exit 8, and the tier is NOT clean. */
const E2FSCK_NOT_EXT4: Partial<ToolResult> = {
  code: 8,
  stdout: `e2fsck 1.47.1 (20-May-2024)
ext2fs_open2: Bad magic number in super-block
e2fsck: Superblock invalid, trying backup blocks...
`,
}

/** tune2fs on 8 MiB of zeros: exit 1, which is `|| true`'s empty string. */
const TUNE2FS_NOT_EXT4: Partial<ToolResult> = {
  code: 1,
  stderr: `tune2fs 1.47.1 (20-May-2024)\ntune2fs: Bad magic number in super-block while trying to open /w/meta.img\n`,
}

/** debugfs on a file it never opened: EXIT 0, empty stdout, the truth on stderr. */
const DEBUGFS_NOT_OPEN: Partial<ToolResult> = {
  code: 0,
  stdout: '',
  stderr: `debugfs 1.47.1 (20-May-2024)
/w/meta.img: Bad magic number in super-block while opening filesystem
ls: Filesystem not open
`,
}

const STAT_SEEDED: Partial<ToolResult> = {
  stdout: `Inode: 12   Type: regular    Mode:  0644   Flags: 0x80000\nGeneration: 0    Version: 0x00000000:00000001\n`,
  stderr: 'debugfs 1.47.1 (20-May-2024)\n',
}
const STAT_ABSENT: Partial<ToolResult> = {
  stdout: '',
  stderr: `debugfs 1.47.1 (20-May-2024)\n/.mos-var-seeded: File not found by ext2_lookup\n`,
}
const LS_LIB_POPULATED: Partial<ToolResult> = {
  stdout: ' 12  (12) .    2  (12) ..    13  (20) apt   14  (4076) dpkg\n',
  stderr: 'debugfs 1.47.1 (20-May-2024)\n',
}
const LS_LIB_EMPTY: Partial<ToolResult> = { stdout: '', stderr: 'debugfs 1.47.1 (20-May-2024)\n' }

/** cx3576's four tiers, exactly as the shipped image reads. */
function healthyTiers(board: 'cx3576' | 'x64' = 'cx3576'): Record<string, TierReply> {
  const g = board === 'cx3576' ? '0002' : '0064'
  return {
    meta: { tune2fs: tune2fs('meta', `5ac35760-${g}-4000-8000-000000000107`, 4096), debugfsLs: lsp([]), e2fsck: E2FSCK_CLEAN },
    state: { tune2fs: tune2fs('state', `5ac35760-${g}-4000-8000-000000000108`, 16384), debugfsLs: lsp([]), e2fsck: E2FSCK_CLEAN },
    ephemeral: {
      tune2fs: tune2fs('ephemeral', `5ac35760-${g}-4000-8000-000000000109`, 131072),
      debugfsLs: lsp(['backups', 'cache', 'lib', 'local', 'lock', 'log', 'mail', 'opt', 'run', 'spool', 'tmp', '.mos-var-seeded']),
      debugfsStat: STAT_SEEDED,
      debugfsLibLs: LS_LIB_POPULATED,
      e2fsck: E2FSCK_CLEAN,
    },
    data: { tune2fs: tune2fs('data', `5ac35760-${g}-4000-8000-000000000110`, 16384), debugfsLs: lsp([]), e2fsck: E2FSCK_CLEAN },
  }
}

/**
 * A runtime that answers per TIER, keyed on the extract's file name.
 *
 * The checks name their extracts `${tier}.img` because the oracle names its
 * temp files that way, so the file name IS the tier here. A stub that answered
 * the same transcript for every tier could not tell a check that reads the
 * right partition from one that reads the first one four times.
 */
function tierTools(tiers: Record<string, TierReply>): ToolRuntime {
  const exec = async (argv: readonly string[]): Promise<ToolResult> => {
    const line = argv.join(' ')
    const tier = Object.keys(tiers).find(t => line.includes(`/${t}.img`))
    if (tier === undefined) throw new Error(`the stub has no tier for: ${line}`)
    const reply = tiers[tier] as TierReply
    const pick = (): Partial<ToolResult> | undefined => {
      if (line.includes('tune2fs -l')) return reply.tune2fs
      if (line.includes('e2fsck -fn')) return reply.e2fsck
      if (line.includes('stat /.mos-var-seeded')) return reply.debugfsStat
      if (line.includes('ls /lib')) return reply.debugfsLibLs
      if (line.includes('ls -p /')) return reply.debugfsLs
      return undefined
    }
    const chosen = pick()
    if (chosen === undefined) throw new Error(`the stub has no transcript for: ${line}`)
    return { argv, code: chosen.code ?? 0, stdout: chosen.stdout ?? '', stderr: chosen.stderr ?? '' }
  }
  return {
    route: 'host',
    announce: 'stub',
    // tools.ts's own runChecked, so a non-zero exit throws here exactly as it
    // throws in production. A stub deciding for itself when to throw would be
    // testing the stub.
    run: (argv, options) => runChecked(exec, argv, options),
    dispose: async () => {},
  }
}

function checkNamed(id: string): CheckCase {
  const found = EXT4_CHECKS.find(c => c.id === id)
  if (found === undefined) throw new Error(`no ext4 check is registered as '${id}'`)
  return found
}

async function drive(
  id: string,
  tiers: Record<string, TierReply>,
  board = cx3576,
  slot = SLOT,
): Promise<readonly CheckResult[]> {
  const fixture = imageFixture({ board, gpt: healthyGpt(board, slot), tools: tierTools(tiers) })
  try {
    return await checkNamed(id).run(fixture.ctx)
  }
  finally {
    fixture.dispose()
  }
}

function at(results: readonly CheckResult[], instance: string): CheckResult {
  const found = results.find(r => r.instance === instance)
  if (found === undefined) throw new Error(`no firing for '${instance}' in ${results.map(r => r.instance).join(', ')}`)
  return found
}

/** Every check fires once per tier, and the tier is the instance. */
describe('the family covers every ext4 tier the layout declares', () => {
  test('four firings on cx3576 and four on x64, named for the layout rows', async () => {
    for (const [board, slot] of [[cx3576, SLOT], [x64, X64_SLOT]] as const) {
      const r = await drive('ext4-label', healthyTiers(board === cx3576 ? 'cx3576' : 'x64'), board, slot)
      expect(r.map(x => x.instance)).toEqual(['meta', 'state', 'ephemeral', 'data'])
      expect(r.every(x => x.verdict === 'pass')).toBe(true)
    }
  })
})

describe('ext4-label', () => {
  test('green on the shipped labels', async () => {
    expect((await drive('ext4-label', healthyTiers())).every(r => r.verdict === 'pass')).toBe(true)
  })

  test('RED when STATE carries META\'s label, and it names state', async () => {
    // The mutation an assembler makes when two mkfs invocations are copied:
    // both partitions exist, both are ext4, both mount -- and every tool that
    // resolves /mnt/state by LABEL now finds the 16 MiB one.
    const t = healthyTiers()
    t['state'] = { ...t['state'] as TierReply, tune2fs: tune2fs('meta', '5ac35760-0002-4000-8000-000000000108', 16384) }
    const r = at(await drive('ext4-label', t), 'state')
    expect(r.verdict).toBe('fail')
    expect(r.message).toBe(`state ext4 label is 'meta', expected 'state'`)
  })

  test('an EXACT compare, not eq_ci: case is a difference here', async () => {
    // The oracle uses `[ "${label}" = "${want_label}" ]` for the label and
    // `eq_ci` for the UUID two lines below. Folding case here would pass where
    // the oracle fails.
    const t = healthyTiers()
    t['data'] = { ...t['data'] as TierReply, tune2fs: tune2fs('DATA', '5ac35760-0002-4000-8000-000000000110', 16384) }
    expect(at(await drive('ext4-label', t), 'data').verdict).toBe('fail')
  })

  test('a tier tune2fs could not open FAILS describing the value, as the oracle does', async () => {
    const t = healthyTiers()
    t['meta'] = { ...t['meta'] as TierReply, tune2fs: TUNE2FS_NOT_EXT4 }
    const r = at(await drive('ext4-label', t), 'meta')
    expect(r.verdict).toBe('fail')
    expect(r.message).toBe(`meta ext4 label is '', expected 'meta'`)
  })

  test('an exit-0 tune2fs whose magic is NOT 0xEF53 still throws', async () => {
    // The `|| true` is reproduced for a tool that REFUSED, never for one that
    // exited 0 having read something that is not a superblock -- that is a
    // format this parser does not know, and swallowing it would turn it into a
    // statement about the image.
    const t = healthyTiers()
    t['meta'] = {
      ...t['meta'] as TierReply,
      tune2fs: { code: 0, stdout: 'tune2fs 1.47.1\nFilesystem magic number:  0x2A2A\n' },
    }
    await expect(drive('ext4-label', t)).rejects.toThrow(/not\n?\s*0xEF53/)
  })
})

describe('ext4-uuid', () => {
  test('green on the shipped UUIDs, and case-folded as eq_ci folds it', async () => {
    const t = healthyTiers()
    t['data'] = { ...t['data'] as TierReply, tune2fs: tune2fs('data', '5AC35760-0002-4000-8000-000000000110', 16384) }
    expect((await drive('ext4-uuid', t)).every(r => r.verdict === 'pass')).toBe(true)
  })

  test('RED when EPHEMERAL and DATA have swapped UUIDs', async () => {
    // Both filesystems still mount; /etc/fstab resolves /var and /srv by
    // PARTUUID, but every tool that resolves by FS UUID gets the other tier.
    const t = healthyTiers()
    t['data'] = { ...t['data'] as TierReply, tune2fs: tune2fs('data', '5ac35760-0002-4000-8000-000000000109', 16384) }
    const r = at(await drive('ext4-uuid', t), 'data')
    expect(r.verdict).toBe('fail')
    expect(r.message).toContain('000000000109')
    expect(r.message).toContain('expected 5ac35760-0002-4000-8000-000000000110')
  })
})

describe('ext4-orphan-file', () => {
  test('green: no shipped tier carries it', async () => {
    expect((await drive('ext4-orphan-file', healthyTiers())).every(r => r.verdict === 'pass')).toBe(true)
  })

  test('RED when a tier has orphan_file, which kernel 6.1 cannot mount', async () => {
    // mke2fs 1.47 enables orphan_file by DEFAULT; the image assembler turns it
    // off. A tier built by a newer mkfs than the one pinned would carry it, the
    // image would assemble and verify green everywhere else, and the device
    // would fail to mount /var at boot.
    const t = healthyTiers()
    t['ephemeral'] = {
      ...t['ephemeral'] as TierReply,
      tune2fs: tune2fs('ephemeral', '5ac35760-0002-4000-8000-000000000109', 131072,
        'has_journal ext_attr resize_inode dir_index orphan_file filetype extent'),
    }
    const r = at(await drive('ext4-orphan-file', t), 'ephemeral')
    expect(r.verdict).toBe('fail')
    expect(r.message).toContain('ephemeral ext4 has the orphan_file feature')
  })

  test('`grep -w` and not a substring: `orphan_file_foo` is a different feature', async () => {
    const t = healthyTiers()
    t['meta'] = {
      ...t['meta'] as TierReply,
      tune2fs: tune2fs('meta', '5ac35760-0002-4000-8000-000000000107', 4096, 'has_journal orphan_file_experiment extent'),
    }
    expect(at(await drive('ext4-orphan-file', t), 'meta').verdict).toBe('pass')
  })

  test('A VACUOUS PASS, reproduced: a tier tune2fs cannot open has no features', async () => {
    // There is nothing to have orphan_file, so the check passes -- about a
    // partition that holds no filesystem at all. The oracle does exactly this
    // (`sed -n 's/^Filesystem features://p' <<<""` matches nothing) and a port
    // that refused would answer FAIL where the oracle answers PASS.
    const t = healthyTiers()
    t['meta'] = { ...t['meta'] as TierReply, tune2fs: TUNE2FS_NOT_EXT4 }
    expect(at(await drive('ext4-orphan-file', t), 'meta').verdict).toBe('pass')
  })
})

describe('ext4-fills-partition', () => {
  test('green: block count x block size is the partition size', async () => {
    const r = await drive('ext4-fills-partition', healthyTiers())
    expect(r.every(x => x.verdict === 'pass')).toBe(true)
    expect(at(r, 'ephemeral').message).toContain('131072 blocks x 4096 bytes = 512 MiB')
  })

  test('RED when the filesystem is smaller than the partition it sits in', async () => {
    // mkfs run against a size the assembler computed differently: the tail of
    // the partition is unaddressable, and a growfs on first boot is what would
    // otherwise have to notice.
    const t = healthyTiers()
    t['state'] = { ...t['state'] as TierReply, tune2fs: tune2fs('state', '5ac35760-0002-4000-8000-000000000108', 8192) }
    const r = at(await drive('ext4-fills-partition', t), 'state')
    expect(r.verdict).toBe('fail')
    expect(r.message).toBe('state ext4 is 33554432 bytes, expected 67108864 (the partition size)')
  })

  test('a tier tune2fs could not open is 0 bytes, and 0 is not the partition size', async () => {
    // The `fs_bytes > 0` guard: without it `0 == 0` would pass for a partition
    // whose declared size were also zero.
    const t = healthyTiers()
    t['data'] = { ...t['data'] as TierReply, tune2fs: TUNE2FS_NOT_EXT4 }
    const r = at(await drive('ext4-fills-partition', t), 'data')
    expect(r.verdict).toBe('fail')
    expect(r.message).toContain('data ext4 is 0 bytes')
  })
})

describe('ext4-fsck-clean', () => {
  test('green on all four shipped tiers', async () => {
    expect((await drive('ext4-fsck-clean', healthyTiers())).every(r => r.verdict === 'pass')).toBe(true)
  })

  test('RED at exit 4 -- errors left uncorrected', async () => {
    const t = healthyTiers()
    t['data'] = {
      ...t['data'] as TierReply,
      e2fsck: { code: 4, stdout: 'e2fsck 1.47.1 (20-May-2024)\nInode 12 is in use, but has dtime set.  Fix? no\n' },
    }
    const r = at(await drive('ext4-fsck-clean', t), 'data')
    expect(r.verdict).toBe('fail')
    expect(r.message).toContain('e2fsck -fn on data reported errors (exit 4')
    expect(r.message).toContain('dtime set')
  })

  test('RED at exit 8 -- the file is not a filesystem at all', async () => {
    const t = healthyTiers()
    t['meta'] = { ...t['meta'] as TierReply, e2fsck: E2FSCK_NOT_EXT4 }
    expect(at(await drive('ext4-fsck-clean', t), 'meta').verdict).toBe('fail')
  })

  test('A TRUNCATED FILESYSTEM PASSES, because e2fsck exits 0 -- reproduced', async () => {
    // THE VACUOUS PASS IN THE CODE UNDER TEST. e2fsck says the superblock or
    // the partition table is likely to be corrupt and exits 0;
    // os/verify-image-v2.sh:2342 discards both streams and reads the status.
    // A port that read the report would answer FAIL where the oracle answers
    // PASS, and the divergence would be the port's. Asserted as its own case so
    // that removing the reproduction has to remove the record of it too.
    const t = healthyTiers()
    t['data'] = {
      ...t['data'] as TierReply,
      e2fsck: {
        code: 0,
        stdout: `e2fsck 1.47.1 (20-May-2024)
The filesystem size (according to the superblock) is 16384 blocks
The physical size of the device is 8192 blocks
Either the superblock or the partition table is likely to be corrupt!
Abort? no

Pass 5: Checking group summary information
`,
      },
    }
    expect(at(await drive('ext4-fsck-clean', t), 'data').verdict).toBe('pass')
  })
})

describe('ext4-factory-content', () => {
  test('green: three tiers empty, EPHEMERAL populated', async () => {
    const r = await drive('ext4-factory-content', healthyTiers())
    expect(r.every(x => x.verdict === 'pass')).toBe(true)
    expect(at(r, 'meta').message).toBe('factory: meta is empty at build (nothing but lost+found)')
    expect(at(r, 'ephemeral').message).toContain('is populated at build (12 entries)')
  })

  test('RED when STATE ships with something in it', async () => {
    // A build that ran a seed oneshot at assembly time rather than on first
    // boot: STATE's contents then predate the device's identity, and the seed
    // that should have created them is a no-op forever after.
    const t = healthyTiers()
    t['state'] = { ...t['state'] as TierReply, debugfsLs: lsp(['machine-id', 'systemd-units']) }
    const r = at(await drive('ext4-factory-content', t), 'state')
    expect(r.verdict).toBe('fail')
    expect(r.message).toBe('factory: state is not empty at build; it contains: machine-id systemd-units')
  })

  test('lost+found does NOT count as content', async () => {
    // mkfs.ext4 creates it on every tier; a filter that missed it would fail
    // three checks on a correct image.
    expect(at(await drive('ext4-factory-content', healthyTiers()), 'meta').verdict).toBe('pass')
  })

  test('RED when EPHEMERAL is EMPTY -- the RFCT-106 race, from the other side', async () => {
    const t = healthyTiers()
    t['ephemeral'] = { ...t['ephemeral'] as TierReply, debugfsLs: lsp([]) }
    const r = at(await drive('ext4-factory-content', t), 'ephemeral')
    expect(r.verdict).toBe('fail')
    expect(r.message).toContain('factory: ephemeral is EMPTY at build')
    expect(r.message).toContain('RFCT-106')
  })

  test('A VACUOUS PASS, reproduced: debugfs exits 0 having opened nothing', async () => {
    // debugfs on a file that is not ext4 EXITS 0 with empty stdout and
    // "Filesystem not open" on stderr; :2358's `|| true` drops the stderr and
    // an empty listing is the PASSING direction for META, STATE and DATA. So
    // the oracle concludes `factory: meta is empty at build` about a partition
    // that holds no filesystem. Reproduced, and recorded here rather than in a
    // comment nobody runs.
    const t = healthyTiers()
    t['meta'] = { ...t['meta'] as TierReply, debugfsLs: DEBUGFS_NOT_OPEN }
    const r = at(await drive('ext4-factory-content', t), 'meta')
    expect(r.verdict).toBe('pass')
    expect(r.message).toBe('factory: meta is empty at build (nothing but lost+found)')
  })

  test('...and the SAME transcript on EPHEMERAL fails, which is what shows it is vacuous', async () => {
    const t = healthyTiers()
    t['ephemeral'] = { ...t['ephemeral'] as TierReply, debugfsLs: DEBUGFS_NOT_OPEN }
    expect(at(await drive('ext4-factory-content', t), 'ephemeral').verdict).toBe('fail')
  })
})

describe('ephemeral-seeded', () => {
  test('green: the stamp is there and /lib is populated', async () => {
    const r = (await drive('ephemeral-seeded', healthyTiers()))[0] as CheckResult
    expect(r.verdict).toBe('pass')
    expect(r.message).toContain('stamp at inode 12, /lib populated')
  })

  test('RED when the stamp is missing, even though the tree is seeded', async () => {
    // THE POINT OF ASSERTING THE STAMP AND NOT THE TREE: mos-seed-var's
    // ConditionPathExists keys on exactly this path, so a seeded /var WITHOUT
    // the stamp still runs the seed on first boot and still races every unit
    // that writes /var.
    const t = healthyTiers()
    t['ephemeral'] = { ...t['ephemeral'] as TierReply, debugfsStat: STAT_ABSENT }
    const r = (await drive('ephemeral-seeded', t))[0] as CheckResult
    expect(r.verdict).toBe('fail')
    expect(r.message).toContain('ships unstamped')
  })

  test('RED when the stamp is there and /lib is EMPTY', async () => {
    // A stamp dropped onto an empty filesystem is worse than no stamp: the
    // seed is then skipped and /var stays empty.
    const t = healthyTiers()
    t['ephemeral'] = { ...t['ephemeral'] as TierReply, debugfsLibLs: LS_LIB_EMPTY }
    const r = (await drive('ephemeral-seeded', t))[0] as CheckResult
    expect(r.verdict).toBe('fail')
    expect(r.message).toContain('ships stamped but empty')
  })

  test('the tier it reads is EPHEMERAL and not the first ext4 row', async () => {
    // If it read META, every transcript above would still answer and the check
    // would report on the wrong partition. Driven by making META's stat say
    // the stamp IS there and EPHEMERAL's say it is not: a check reading META
    // would go green.
    const t = healthyTiers()
    t['meta'] = { ...t['meta'] as TierReply, debugfsStat: STAT_SEEDED, debugfsLibLs: LS_LIB_POPULATED }
    t['ephemeral'] = { ...t['ephemeral'] as TierReply, debugfsStat: STAT_ABSENT }
    expect(((await drive('ephemeral-seeded', t))[0] as CheckResult).verdict).toBe('fail')
  })
})
