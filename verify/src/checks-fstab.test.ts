// The fstab checks, driven from the failing side.
//
// The baseline /etc/fstab is RENDERED
// FROM THE SHIPPED TEMPLATE, rootfs/overlay/etc/fstab.in, with the
// board's own GUIDs -- the same thing the image fixture contract does and for
// the same reason: a table hand-written here would test this file's idea of the
// table rather than the one that ships, and an fstab.in that grew a placeholder
// would go on passing.
//
// Every mutation is a single edit to that rendered text, and each is a shape
// the real failure takes: a growfs option dropped, a tier's PARTUUID pointed at
// the wrong partition, a deeper mount landing over the UI root. The baseline is
// asserted green FIRST in every case.
//
// The early return is testable, and that is why this is one `many` check.
// check_ui_location emits ONE conclusion when nothing covers UI_ROOT and SIX
// otherwise. Seven independent `one` checks could not model that: on the
// early-return path six of them would conclude nothing, the oracle would print
// nothing for them, and the parity harness would report six `unfired` rows --
// exit 1 for a run that behaved correctly. As one `many` check the early return
// is a firing rather than six absences, and the case below drives it.

import { describe, expect, test } from 'bun:test'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadBoard } from './board.ts'
import { packedRootFixture, type RootFixture } from './checks-fixture.ts'
import { FSTAB_CHECKS } from './checks-fstab.ts'
import type { CheckCase } from './checks.ts'
import { boardEnvPath } from './paths.ts'
import type { CheckResult, Verdict } from './parity.ts'

const cx3576 = loadBoard(boardEnvPath('cx3576'))
const x64 = loadBoard(boardEnvPath('x64'))

function checkNamed(id: string): CheckCase {
  const found = FSTAB_CHECKS.find(c => c.id === id)
  if (found === undefined) {
    throw new Error(`no batch-2b check is registered as '${id}'. Registered: `
      + FSTAB_CHECKS.map(c => c.id).join(', '))
  }
  return found
}

/**
 * The pass matcher, refused when absent.
 *
 * `ShellMatcher.pass` became optional in M4d for the entries that own a
 * family's SKIP and nothing else. None of the checks this file names is one, so
 * an absent matcher here is a register fault and not a case to tolerate.
 */
function passMatcher(id: string): string {
  const m = checkNamed(id).shell.pass
  if (typeof m !== 'string') {
    throw new Error(
      `'${id}' registers no single-string pass matcher. Since M4d a matcher may be absent -- for a `
      + `check that owns a SKIP line and nothing else -- or a LIST of alternative spellings. This `
      + `check is compared against one PASS line and should register one substring.`,
    )
  }
  return m
}

function guid(board: typeof cx3576, layout: string): string {
  return (board.partition(layout)?.guid ?? '').toLowerCase()
}

const FSTAB = '/etc/fstab'

function fstabOf(fx: RootFixture): string {
  return readFileSync(join(fx.root, FSTAB), 'utf8')
}

/** The rows that are actually a table: comments and short lines dropped. */
function rowsOf(text: string): string[] {
  return text.split('\n')
    .filter(l => !/^\s*#/.test(l) && l.trim().split(/\s+/).length >= 4)
    .map(l => l.trim())
}

/**
 * Rewrite the fixture's fstab, and REFUSE an edit that changed no ROW.
 *
 * "The text changed" is not enough, and this file learned that from its own
 * failing case: `t.replace('/mnt/meta', '/mnt/metadata')` hit the FIRST
 * occurrence, which is in the template's comment block, so the table came out
 * identical and the check stayed green -- a test reporting a pass about a
 * mutation that never reached the thing under test. So the comparison is over
 * the rows the checks actually read.
 */
function editFstab(fx: RootFixture, edit: (text: string) => string): void {
  const before = fstabOf(fx)
  const after = edit(before)
  expect(rowsOf(after)).not.toEqual(rowsOf(before))
  writeFileSync(join(fx.root, FSTAB), after)
}

async function verdictOf(fx: RootFixture, id: string): Promise<Verdict> {
  const got = await checkNamed(id).run(fx.ctx)
  expect(got.length).toBe(1)
  return (got[0] as CheckResult).verdict
}

async function messageOf(fx: RootFixture, id: string): Promise<string> {
  return ((await checkNamed(id).run(fx.ctx))[0] as CheckResult).message
}

/** The UI check's firings, keyed by the clause that is each one's identity. */
async function uiFirings(fx: RootFixture): Promise<Map<string, CheckResult>> {
  const got = await checkNamed('ui-location').run(fx.ctx)
  const out = new Map<string, CheckResult>()
  for (const r of got) {
    // The instance the parity harness will pair on is derived from the MESSAGE
    // by the registered pattern, so it is derived the same way here -- a test
    // that read r.instance directly would not notice a pattern that stopped
    // matching the text.
    const m = (checkNamed('ui-location').instance as RegExp).exec(r.message)
    expect(m?.[1]).toBeDefined()
    expect(r.instance).toBe(m?.[1] as string)
    out.set(m?.[1] as string, r)
  }
  return out
}

const UI_NO_FILESYSTEM = 'catches a custom UI root with NO filesystem under it'
const UI_OFF_DATA = 'catches a custom UI root moved off DATA'
const UI_ON_STATE = 'catches a custom UI root moved onto STATE'
const UI_ON_EPHEMERAL = 'catches a custom UI root moved onto the wipeable /var partition'
const UI_UNASSERTED = 'catches a custom UI root under an unasserted mountpoint'
const UI_CEILING = 'catches a custom UI root with a fixed ceiling'
const UI_BAKED = 'catches content baked under the custom UI root'

/** Which of the six went red. Order-independent, by identity. */
async function uiRed(fx: RootFixture): Promise<string[]> {
  return [...await uiFirings(fx)].filter(([, r]) => r.verdict !== 'pass').map(([k]) => k).sort()
}

describe('the healthy fstab', () => {
  test('every batch-2b check PASSES on the unmutated fixture, on BOTH boards', async () => {
    for (const board of [cx3576, x64]) {
      const fx = packedRootFixture(board)
      try {
        for (const c of FSTAB_CHECKS) {
          const got = await c.run(fx.ctx)
          expect({ board: board.name, id: c.id, red: got.filter(r => r.verdict !== 'pass') })
            .toEqual({ board: board.name, id: c.id, red: [] })
        }
      }
      finally {
        fx.dispose()
      }
    }
  })

  test('the UI check fires SIX times on the healthy path, each with its own identity', async () => {
    const fx = packedRootFixture(cx3576)
    try {
      const firings = await uiFirings(fx)
      expect([...firings.keys()].sort()).toEqual([
        UI_BAKED, UI_CEILING, UI_ON_EPHEMERAL, UI_ON_STATE, UI_OFF_DATA, UI_UNASSERTED,
      ].sort())
      expect(firings.size).toBe(6)
    }
    finally {
      fx.dispose()
    }
  })

  test('the fixture table is the SHIPPED one, placeholders and all resolved', () => {
    const fx = packedRootFixture(cx3576)
    try {
      const rendered = fstabOf(fx)
      expect(rendered).not.toMatch(/@[A-Z_]+@/)
      expect(rendered).toContain(guid(cx3576, 'DATA'))
      expect(rendered).toContain(guid(cx3576, 'STATE'))
      // ...and it is the template's own text, not a paraphrase of it.
      expect(rendered).toContain('The root filesystem is deliberately absent')
    }
    finally {
      fx.dispose()
    }
  })
})

describe('the four storage tiers', () => {
  test('the DATA entry is GONE', async () => {
    const fx = packedRootFixture(cx3576)
    try {
      expect(await verdictOf(fx, 'fstab-data')).toBe('pass')
      editFstab(fx, t => t.split('\n').filter(l => !l.includes('/srv')).join('\n'))
      expect(await verdictOf(fx, 'fstab-data')).toBe('fail')
      expect(await messageOf(fx, 'fstab-data')).toContain('has no /srv entry for PARTUUID=')
      expect(await verdictOf(fx, 'fstab-state')).toBe('pass')
    }
    finally {
      fx.dispose()
    }
  })

  test('DATA loses x-systemd.growfs -- the option only DATA carries', async () => {
    // DATA is the only partition systemd-repart grows. Without the option the
    // application tier is capped at the size the image was built with, however
    // large the disk is.
    const fx = packedRootFixture(cx3576)
    try {
      expect(await verdictOf(fx, 'fstab-data')).toBe('pass')
      editFstab(fx, t => t.replace('noatime,x-systemd.growfs', 'noatime'))
      expect(await verdictOf(fx, 'fstab-data')).toBe('fail')
      expect(await messageOf(fx, 'fstab-data')).toContain("lacks the 'x-systemd.growfs' option")
      // And the UI ceiling assertion goes red on the SAME edit, because it
      // reads the option off whichever entry governs /srv/ui. Two checks, one
      // cause -- and that is the oracle's behaviour too.
      expect(await uiRed(fx)).toEqual([UI_CEILING])
    }
    finally {
      fx.dispose()
    }
  })

  test('a tier is pointed at ANOTHER BOARD\'s partition GUID', async () => {
    // The mistake a renderer run with one board's env and an assembler run with
    // another's makes. The two agree with each other and fail here.
    const fx = packedRootFixture(cx3576)
    try {
      expect(await verdictOf(fx, 'fstab-state')).toBe('pass')
      editFstab(fx, t => t.replace(guid(cx3576, 'STATE'), guid(x64, 'STATE')))
      expect(await verdictOf(fx, 'fstab-state')).toBe('fail')
      expect(await messageOf(fx, 'fstab-state')).toContain('has no /mnt/state entry')
    }
    finally {
      fx.dispose()
    }
  })

  test('the right device at the WRONG mountpoint is not the entry', async () => {
    // `$1 == d && $2 == m`: BOTH fields. An entry that mounted META's partition
    // somewhere else would satisfy a device-only search while /mnt/meta stayed
    // unmounted.
    const fx = packedRootFixture(cx3576)
    try {
      expect(await verdictOf(fx, 'fstab-meta')).toBe('pass')
      editFstab(fx, t => t.replace(
        new RegExp(`(PARTUUID=${guid(cx3576, 'META')}\\s+)/mnt/meta\\b`), '$1/mnt/metadata'))
      expect(await verdictOf(fx, 'fstab-meta')).toBe('fail')
    }
    finally {
      fx.dispose()
    }
  })

  test('/var CARRIES x-systemd.growfs, which is forbidden and not merely unrequired', async () => {
    // The direction that has no analogue in the other three. /var is fixed-size
    // disposable residue; growing the wipeable tier is how a fill-up becomes
    // permanent instead of transient.
    const fx = packedRootFixture(cx3576)
    try {
      expect(await verdictOf(fx, 'fstab-ephemeral')).toBe('pass')
      editFstab(fx, t => t.replace(
        new RegExp(`(PARTUUID=${guid(cx3576, 'EPHEMERAL')}\\s+/var\\s+ext4\\s+)noatime`),
        '$1noatime,x-systemd.growfs'))
      expect(await verdictOf(fx, 'fstab-ephemeral')).toBe('fail')
      expect(await messageOf(fx, 'fstab-ephemeral')).toContain("carries 'x-systemd.growfs' but must not")
      // DATA's own growfs assertion is untouched: the two directions are about
      // different partitions and must not be one check.
      expect(await verdictOf(fx, 'fstab-data')).toBe('pass')
    }
    finally {
      fx.dispose()
    }
  })

  test('an option is matched at COMMA BOUNDARIES, not as a substring', async () => {
    // `,${opts},` contains `,${o},`. Without the commas, `noatimexyz` satisfies
    // a search for `noatime` and a tier mounts with atime updates on a
    // read-mostly partition while the check stays green.
    const fx = packedRootFixture(cx3576)
    try {
      expect(await verdictOf(fx, 'fstab-state')).toBe('pass')
      editFstab(fx, t => t.replace(
        new RegExp(`(PARTUUID=${guid(cx3576, 'STATE')}\\s+/mnt/state\\s+ext4\\s+)noatime`),
        '$1noatimexyz'))
      expect(await verdictOf(fx, 'fstab-state')).toBe('fail')
      expect(await messageOf(fx, 'fstab-state')).toContain("lacks the 'noatime' option")
    }
    finally {
      fx.dispose()
    }
  })

  test('a COMMENTED-OUT entry is not an entry', async () => {
    const fx = packedRootFixture(cx3576)
    try {
      expect(await verdictOf(fx, 'fstab-data')).toBe('pass')
      editFstab(fx, t => t.replace(`PARTUUID=${guid(cx3576, 'DATA')}`,
        `# PARTUUID=${guid(cx3576, 'DATA')}`))
      expect(await verdictOf(fx, 'fstab-data')).toBe('fail')
    }
    finally {
      fx.dispose()
    }
  })

  test('the four `what` matchers are distinct, and each is in all four directions', () => {
    // The `what` clause is the identity because it is the ONLY substring the
    // pass line and all three failure shapes share -- the mountpoint appears in
    // every one of them but also in the six UI assertions' text, so a
    // mountpoint matcher would go `ambiguous` on a run where both failed.
    const whats = ['fstab-data', 'fstab-state', 'fstab-meta', 'fstab-ephemeral']
      .map(id => passMatcher(id))
    expect(new Set(whats).size).toBe(4)
    for (const w of whats) {
      expect(w.startsWith('(')).toBe(true)
      expect(w.endsWith(')')).toBe(true)
    }
  })
})

describe('the table\'s own shape', () => {
  test('/tmp is not a tmpfs', async () => {
    const fx = packedRootFixture(cx3576)
    try {
      expect(await verdictOf(fx, 'fstab-tmpfs-tmp')).toBe('pass')
      editFstab(fx, t => t.replace(/^tmpfs\s+\/tmp\s+tmpfs/m, 'tmpfs\t/tmp\text4'))
      expect(await verdictOf(fx, 'fstab-tmpfs-tmp')).toBe('fail')
      expect(await messageOf(fx, 'fstab-tmpfs-tmp')).toBe('/etc/fstab has no tmpfs /tmp entry')
    }
    finally {
      fx.dispose()
    }
  })

  test('the /tmp entry is GONE', async () => {
    const fx = packedRootFixture(cx3576)
    try {
      editFstab(fx, t => t.split('\n').filter(l => !l.startsWith('tmpfs')).join('\n'))
      expect(await verdictOf(fx, 'fstab-tmpfs-tmp')).toBe('fail')
    }
    finally {
      fx.dispose()
    }
  })

  test('an fstab entry for / -- and note the direction: PRESENCE is the failure', async () => {
    // The kernel assembles /dev/dm-0 from dm-mod.create= on the cmdline and
    // mounts it read-only. An fstab entry for / is a remount path into a verity
    // root, so this check is red when the entry EXISTS. A port that copied the
    // other three checks' polarity would be green on exactly the wrong image.
    const fx = packedRootFixture(cx3576)
    try {
      expect(await verdictOf(fx, 'fstab-no-root-entry')).toBe('pass')
      editFstab(fx, t => `${t}\n/dev/dm-0\t/\tsquashfs\tro\t0\t0\n`)
      expect(await verdictOf(fx, 'fstab-no-root-entry')).toBe('fail')
      expect(await messageOf(fx, 'fstab-no-root-entry')).toContain('/etc/fstab has a / entry')
    }
    finally {
      fx.dispose()
    }
  })
})

describe('where the custom UI root actually lands', () => {
  test('NOTHING covers it -- the early return, one firing instead of six', async () => {
    // The path six independent `one` checks could not model. With no covering
    // entry /srv/ui lands on the read-only verity squashfs: apid cannot create
    // it on first install and no bundle can ever be installed.
    const fx = packedRootFixture(cx3576)
    try {
      expect((await uiFirings(fx)).size).toBe(6)
      editFstab(fx, t => t.split('\n').filter(l => !l.includes('\t/srv\t')).join('\n'))
      const firings = await uiFirings(fx)
      expect([...firings.keys()]).toEqual([UI_NO_FILESYSTEM])
      expect((firings.get(UI_NO_FILESYSTEM) as CheckResult).verdict).toBe('fail')
      // ...and the six that follow it do not run AT ALL, which is what makes
      // the early return real rather than merely believed.
      expect(firings.size).toBe(1)
    }
    finally {
      fx.dispose()
    }
  })

  test('moved onto STATE -- 64 MiB, shared with the settings tree and the host keys', async () => {
    const fx = packedRootFixture(cx3576)
    try {
      expect(await uiRed(fx)).toEqual([])
      editFstab(fx, t => `${t}\nPARTUUID=${guid(cx3576, 'STATE')}\t/srv/ui\text4\t`
        + `noatime,x-systemd.growfs\t0\t2\n`)
      expect(await uiRed(fx)).toEqual([UI_OFF_DATA, UI_ON_STATE, UI_UNASSERTED].sort())
      const firings = await uiFirings(fx)
      expect((firings.get(UI_ON_STATE) as CheckResult).message).toContain(guid(cx3576, 'STATE'))
      // The DEEPER mountpoint wins, which is what the kernel does -- /srv/ui
      // beats /srv. A port taking the first match would have read the DATA
      // entry and stayed green.
      expect((firings.get(UI_OFF_DATA) as CheckResult).message).toContain('/srv/ui')
    }
    finally {
      fx.dispose()
    }
  })

  test('moved onto the wipeable /var', async () => {
    // /var is fixed-size disposable residue with no growfs, so every installed
    // custom UI silently disappears the first time it is cleared.
    const fx = packedRootFixture(cx3576)
    try {
      editFstab(fx, t => `${t}\nPARTUUID=${guid(cx3576, 'EPHEMERAL')}\t/srv/ui\text4\t`
        + `noatime,x-systemd.growfs\t0\t2\n`)
      expect(await uiRed(fx)).toEqual([UI_OFF_DATA, UI_ON_EPHEMERAL, UI_UNASSERTED].sort())
    }
    finally {
      fx.dispose()
    }
  })

  test('under a mountpoint NOTHING has asserted exists in the packed root', async () => {
    // Chained to the packed-root mountpoint check: membership in that set is
    // what proves the directory is there. A verity root cannot create it at
    // runtime, so a mount at an unasserted point fails silently into the
    // squashfs. DATA's own device, so only the mountpoint question is live.
    const fx = packedRootFixture(cx3576)
    try {
      editFstab(fx, t => `${t}\nPARTUUID=${guid(cx3576, 'DATA')}\t/srv/ui\text4\t`
        + `noatime,x-systemd.growfs\t0\t2\n`)
      expect(await uiRed(fx)).toEqual([UI_OFF_DATA, UI_UNASSERTED].sort())
      expect((await uiFirings(fx)).get(UI_UNASSERTED)?.message).toContain('NOT in the set')
    }
    finally {
      fx.dispose()
    }
  })

  test('the covering entry has a CEILING even though DATA does not', async () => {
    // Not the DATA entry's growfs restated: it is read off whichever entry
    // governs UI_ROOT, so it keeps holding in exactly the case the DATA check
    // cannot see. Here DATA is correct and the deeper entry is not.
    const fx = packedRootFixture(cx3576)
    try {
      editFstab(fx, t => `${t}\nPARTUUID=${guid(cx3576, 'DATA')}\t/srv/ui\text4\tnoatime\t0\t2\n`)
      expect(await uiRed(fx)).toEqual([UI_CEILING, UI_OFF_DATA, UI_UNASSERTED].sort())
      // The DATA tier check stays GREEN -- which is the whole point: it cannot
      // see this.
      expect(await verdictOf(fx, 'fstab-data')).toBe('pass')
    }
    finally {
      fx.dispose()
    }
  })

  test('content BAKED under the UI root, on the read-only squashfs', async () => {
    // Both failure modes are silent: a baked file either WINS over the writable
    // copy an operator installed, or NEVER UPDATES when the bundle beneath it
    // changes. Absence is the defined shipped state.
    const fx = packedRootFixture(cx3576)
    try {
      expect(await uiRed(fx)).toEqual([])
      mkdirSync(join(fx.root, 'srv/ui'), { recursive: true })
      writeFileSync(join(fx.root, 'srv/ui/index.html'), '<html>\n')
      expect(await uiRed(fx)).toEqual([UI_BAKED])
      expect((await uiFirings(fx)).get(UI_BAKED)?.message).toContain('/srv/ui/index.html')
    }
    finally {
      fx.dispose()
    }
  })

  test('an EMPTY /srv/ui directory is content too', async () => {
    // The directory itself counts: `find` lists it even when nothing is under
    // it, and a port reporting only the CONTENTS would pass an empty one.
    const fx = packedRootFixture(cx3576)
    try {
      mkdirSync(join(fx.root, 'srv/ui'), { recursive: true })
      expect(await uiRed(fx)).toEqual([UI_BAKED])
      expect((await uiFirings(fx)).get(UI_BAKED)?.message).toContain('/srv/ui')
    }
    finally {
      fx.dispose()
    }
  })

  test('more than five baked paths are summarised as the oracle summarises them', async () => {
    // `awk 'NR <= 5 { ... } END { if (NR > 5) printf "(+%d more) " ...}'`. The
    // message is the whole of what a reader gets when this goes red, so a port
    // that printed a count where the oracle prints names would diverge on the
    // sentence while agreeing on the verdict.
    const fx = packedRootFixture(cx3576)
    try {
      mkdirSync(join(fx.root, 'srv/ui'), { recursive: true })
      for (let i = 0; i < 9; i += 1) writeFileSync(join(fx.root, `srv/ui/f${i}`), '')
      const msg = (await uiFirings(fx)).get(UI_BAKED)?.message as string
      // ten paths: /srv/ui itself plus nine files -> five named, five more.
      expect(msg).toContain('(+5 more)')
      expect(msg).toContain('/srv/ui/f0')
      expect(msg).not.toContain('/srv/ui/f8')
    }
    finally {
      fx.dispose()
    }
  })

  test('the matcher claims all seven messages and nothing else', () => {
    // Measured against both boards' real output: `custom UI root` is six lines
    // on each. It is the only substring common to all seven -- five read
    // `catches a custom UI root ...` and the sixth `catches content baked under
    // the custom UI root`.
    const pass = passMatcher('ui-location')
    for (const m of [
      UI_NO_FILESYSTEM, UI_OFF_DATA, UI_ON_STATE, UI_ON_EPHEMERAL,
      UI_UNASSERTED, UI_CEILING, UI_BAKED,
    ]) expect(m).toContain(pass)
    // ...and not the built-in UI assertions, which sit beside them in the same
    // fixture-mode dispatch and read almost the same way.
    expect('catches a built-in escape that has grown an on-disk half').not.toContain(pass)
  })

  test('the instance pattern names each firing distinctly', async () => {
    const fx = packedRootFixture(cx3576)
    try {
      const firings = await uiFirings(fx)
      expect(new Set([...firings.keys()]).size).toBe(firings.size)
      for (const key of firings.keys()) expect(key.startsWith('catches ')).toBe(true)
    }
    finally {
      fx.dispose()
    }
  })
})

describe('the vacuity traps', () => {
  test('NO /etc/fstab at all: the no-/-entry check passes VACUOUSLY, as the oracle does', async () => {
    // Deliberately reproduced rather than improved on. `awk '$2 == "/" {found=1}
    // END {exit !found}' "${FSTAB}" 2>/dev/null` on a missing file exits
    // non-zero, so the oracle takes its ELSE branch and PASSES -- green about
    // an image with no table at all. Diverging here would be a divergence
    // introduced by the PORT, which is the one thing a port may not do; the
    // repair is a "the table exists" precondition, which is an assertion the
    // oracle does not make and therefore `orphan` until M4e.
    //
    // What stops it mattering today is that the four tier checks and the tmpfs
    // check are all RED on the same input, and the UI check reports the early
    // return -- so no run can be green while this one is vacuous.
    const fx = packedRootFixture(cx3576)
    try {
      rmSync(join(fx.root, FSTAB))
      expect(await verdictOf(fx, 'fstab-no-root-entry')).toBe('pass')

      expect(await verdictOf(fx, 'fstab-data')).toBe('fail')
      expect(await verdictOf(fx, 'fstab-state')).toBe('fail')
      expect(await verdictOf(fx, 'fstab-meta')).toBe('fail')
      expect(await verdictOf(fx, 'fstab-ephemeral')).toBe('fail')
      expect(await verdictOf(fx, 'fstab-tmpfs-tmp')).toBe('fail')
      expect([...(await uiFirings(fx)).keys()]).toEqual([UI_NO_FILESYSTEM])
    }
    finally {
      fx.dispose()
    }
  })

  test('an EMPTY /etc/fstab is the same shape and the same answer', async () => {
    const fx = packedRootFixture(cx3576)
    try {
      writeFileSync(join(fx.root, FSTAB), '')
      expect(await verdictOf(fx, 'fstab-no-root-entry')).toBe('pass')
      expect(await verdictOf(fx, 'fstab-data')).toBe('fail')
    }
    finally {
      fx.dispose()
    }
  })

  test('an fstab of nothing but COMMENTS is read as empty, not as a table', async () => {
    const fx = packedRootFixture(cx3576)
    try {
      editFstab(fx, t => t.split('\n').map(l => (l.startsWith('#') ? l : `# ${l}`)).join('\n'))
      expect(await verdictOf(fx, 'fstab-data')).toBe('fail')
      expect(await verdictOf(fx, 'fstab-tmpfs-tmp')).toBe('fail')
    }
    finally {
      fx.dispose()
    }
  })

  test('a board declaring no GUID for a tier THROWS rather than failing', async () => {
    // A fail is a statement about the IMAGE. "the board definition names no
    // STATE_GUID" is a statement about the board definition, and the harness
    // turns the throw into a named error against this check's id -- which is
    // distinguishable from both directions of the check.
    const fx = packedRootFixture(cx3576)
    try {
      const noGuid = {
        ...fx.ctx,
        board: { ...cx3576, partition: () => undefined },
      }
      await expect(checkNamed('fstab-state').run(noGuid)).rejects.toThrow(/declares no STATE_GUID/)
      await expect(checkNamed('ui-location').run(noGuid)).rejects.toThrow(/declares no DATA_GUID/)
    }
    finally {
      fx.dispose()
    }
  })
})
