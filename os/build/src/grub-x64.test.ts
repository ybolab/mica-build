// The three grub.cfg guards, each driven from the FAILING side, and each with a
// positive control beside it.
//
// WHY A POSITIVE CONTROL EVERY TIME. A guard that refused everything would
// satisfy every negative case in this file. The controls are the tree's own
// os/boards/x64/grub.cfg and the tree's own board definition -- not a fixture
// built to pass -- so "the shipped file renders clean" is asserted against the
// file that actually ships.
//
// AND WHY THE MUTATIONS ARE CHECKED TO BE MUTATIONS. M6b recorded a near-miss
// worth repeating: removing `rauc.slot=${bootslot}` with String.replace changed
// only the COMMENT that mentioned it, the guard stayed green, and the negative
// test was not negative. Every mutation below asserts that it changed the line
// it meant to change before asserting that the guard noticed.

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadGeometry } from './geometry.ts'
import {
  cmdlineFacts,
  earlyCfg,
  GRUB_MODULES,
  grubSubstitutions,
  linuxLines,
  literalHashLines,
  renderGrubCfg,
  renderTemplate,
  REQUIRED_FRAGMENT_VARS,
  unrenderedPlaceholders,
  unusedFragmentVars,
  verityFactsFrom,
  VERITY_KEYS,
  type VerityFacts,
} from './grub-x64.ts'
import { BOARDS_DIR } from './paths.ts'

const g = loadGeometry('x64')
const TEMPLATE_PATH = join(BOARDS_DIR, 'x64', 'grub.cfg')
const TEMPLATE = readFileSync(TEMPLATE_PATH, 'utf8')

/** The real _out/x64/rootfs-verity.env, as text, without needing the file. */
const VERITY_ENV_TEXT = [
  'VERITY_ROOT_HASH=29809478ef06ccd26a88fb48f5faa78e8477a20dad8ca407a435eaa14419ef8a',
  'VERITY_SALT=0000000000000000000000000000000000000000000000000000000000000001',
  'VERITY_UUID=5ac35760-0064-4000-8000-000000000005',
  'VERITY_HASH_ALGO=sha256',
  'VERITY_DATA_BLOCK_SIZE=4096',
  'VERITY_HASH_BLOCK_SIZE=4096',
  'VERITY_DATA_BLOCKS=58116',
  'VERITY_HASH_START_BLOCK=58116',
  'VERITY_DATA_SECTORS=464928',
  'SQUASHFS_BYTES=238043136',
  'IMAGE_BYTES=240123904',
].join('\n')

const FACTS: VerityFacts = verityFactsFrom(VERITY_ENV_TEXT, '(fixture)')

describe('the verity facts, read out of the env file', () => {
  test('the real file parses to the eight values the fragment carries', () => {
    expect(FACTS).toEqual({
      dataSectors: '464928',
      dataBlockSize: '4096',
      hashBlockSize: '4096',
      dataBlocks: '58116',
      hashStartBlock: '58116',
      hashAlgo: 'sha256',
      rootHash: '29809478ef06ccd26a88fb48f5faa78e8477a20dad8ca407a435eaa14419ef8a',
      salt: '0000000000000000000000000000000000000000000000000000000000000001',
    })
  })

  test('every one of the eight keys is refused when it is ABSENT', () => {
    let driven = 0
    for (const [, key] of VERITY_KEYS) {
      const without = VERITY_ENV_TEXT.split('\n').filter(l => !l.startsWith(`${key}=`)).join('\n')
      // The mutation is a mutation: the key really is gone.
      expect(without).not.toContain(`${key}=`)
      expect(() => verityFactsFrom(without, '/x/rootfs-verity.env')).toThrow(
        new RegExp(`${key} is missing from /x/rootfs-verity\\.env`),
      )
      driven += 1
    }
    expect(driven).toBe(8)
  })

  test('every one of the eight is refused when it is present and EMPTY', () => {
    // A different sentence, deliberately: `VERITY_ROOT_HASH=` renders as
    // `set MOS_ROOT_HASH=` in the fragment, which os/boards/x64/grub.cfg reads as
    // "no usable cmdline.cfg" and refuses the slot. An empty value produces an
    // image that assembles, verifies, and boots neither slot.
    let driven = 0
    for (const [, key] of VERITY_KEYS) {
      const emptied = VERITY_ENV_TEXT.split('\n')
        .map(l => (l.startsWith(`${key}=`) ? `${key}=` : l)).join('\n')
      // The mutation is a mutation: the key is still declared, and its value is
      // now nothing. That is the whole distinction from the case above.
      expect(emptied.split('\n')).toContain(`${key}=`)
      expect(() => verityFactsFrom(emptied, '/x/rootfs-verity.env')).toThrow(
        new RegExp(`${key} is empty in /x/rootfs-verity\\.env`),
      )
      driven += 1
    }
    expect(driven).toBe(8)
  })

  test('a later assignment wins, as it would in a shell that sourced the file', () => {
    const twice = `${VERITY_ENV_TEXT}\nVERITY_DATA_SECTORS=999`
    expect(verityFactsFrom(twice, '(fixture)').dataSectors).toBe('999')
  })
})

describe('the per-slot fragment', () => {
  test('is byte-for-byte what os/mkimage-x64.sh prints', () => {
    // Copied from the shell's own output over these inputs (its "slot A boot
    // facts" block, with the two-space indent it adds for display removed).
    expect(cmdlineFacts(FACTS)).toBe(
      'set MOS_SECTORS=464928\n'
      + 'set MOS_DATA_BLOCK_SIZE=4096\n'
      + 'set MOS_HASH_BLOCK_SIZE=4096\n'
      + 'set MOS_DATA_BLOCKS=58116\n'
      + 'set MOS_HASH_START_BLOCK=58116\n'
      + 'set MOS_HASH_ALGO=sha256\n'
      + 'set MOS_ROOT_HASH=29809478ef06ccd26a88fb48f5faa78e8477a20dad8ca407a435eaa14419ef8a\n'
      + 'set MOS_SALT=0000000000000000000000000000000000000000000000000000000000000001\n',
    )
  })

  test('the LINE ORDER is part of its bytes', () => {
    // A fragment whose lines were sorted would boot identically and hash
    // differently, which is exactly the class of change a byte-identity gate is
    // there to catch -- so the order is asserted rather than the set.
    const order = cmdlineFacts(FACTS).trimEnd().split('\n').map(l => l.split('=')[0])
    expect(order).toEqual([
      'set MOS_SECTORS', 'set MOS_DATA_BLOCK_SIZE', 'set MOS_HASH_BLOCK_SIZE', 'set MOS_DATA_BLOCKS',
      'set MOS_HASH_START_BLOCK', 'set MOS_HASH_ALGO', 'set MOS_ROOT_HASH', 'set MOS_SALT',
    ])
  })

  test('and it ends with a newline, because the shell\'s printf does', () => {
    expect(cmdlineFacts(FACTS).endsWith('\n')).toBe(true)
    expect(cmdlineFacts(FACTS).endsWith('\n\n')).toBe(false)
  })
})

describe('the substitutions', () => {
  const subs = grubSubstitutions(g)

  test('the PARTUUIDs are LOWERCASED, and the board spells them uppercase', () => {
    // `lower()` in the shell. The kernel matches PARTUUID as a string; a
    // dm-mod.waitfor carrying the uppercase spelling waits for a partition that
    // never appears, and the machine hangs in the initramfs with no message.
    expect(g.requirePartition('ROOTFS_A').require('GUID')).toBe('5AC35760-0064-4000-8000-000000000005')
    expect(subs.ROOTFS_A_PARTUUID).toBe('5ac35760-0064-4000-8000-000000000005')
    expect(subs.ROOTFS_B_PARTUUID).toBe('5ac35760-0064-4000-8000-000000000006')
  })

  test('the boot partition numbers come from the layout', () => {
    expect(subs.BOOT_A_PARTNUM).toBe('2')
    expect(subs.BOOT_B_PARTNUM).toBe('3')
  })

  test('the board command line arrives verbatim, metacharacters and all', () => {
    // `console=ttyS0,115200 net.ifnames=0` is full of regex metacharacters. This
    // is a literal replaceAll, not a pattern, so nothing in the value is read as
    // syntax.
    expect(subs.BOARD_CMDLINE_ARGS).toBe('console=tty0 console=ttyS0,115200 net.ifnames=0')
    expect(renderTemplate('x @BOARD_CMDLINE_ARGS@ y', subs)).toBe(
      'x console=tty0 console=ttyS0,115200 net.ifnames=0 y',
    )
  })

  // THE $-EXPANSION CLASS. The comment above renderTemplate used to say the
  // right-hand side "has no right-hand-side syntax at all"; that was wrong. A
  // STRING replacement in JavaScript expands $&, $`, $' , $$ and $n, and
  // BOARD_CMDLINE_ARGS is free-form board text -- a kernel argument, which is
  // freer than the board name that carries the same hazard in bundle.ts.
  //
  // A cmdline containing `$&` would have been silently rewritten into the
  // grub.cfg that boots the machine. Fixed with a replacer function, which is
  // never scanned for those sequences.
  test.each([
    ['$&', 'console=ttyS0 mos.tag=$& net.ifnames=0'],
    ['$`', 'console=ttyS0 mos.tag=$` net.ifnames=0'],
    ["$'", "console=ttyS0 mos.tag=$' net.ifnames=0"],
    ['$$', 'console=ttyS0 mos.tag=$$ net.ifnames=0'],
    ['&', 'console=ttyS0 mos.tag=a&b net.ifnames=0'],
  ])('a cmdline carrying %s lands byte for byte', (_name, value) => {
    const out = renderTemplate('linux /vmlinuz @BOARD_CMDLINE_ARGS@', { BOARD_CMDLINE_ARGS: value })
    expect(out).toBe(`linux /vmlinuz ${value}`)
    expect(out).not.toContain('@BOARD_CMDLINE_ARGS@')
  })

  test('EVERY occurrence is replaced, not just the first', () => {
    // The shell's sed has a /g; a port using String.replace would substitute the
    // slot A menuentry and leave slot B's placeholder in place, producing an
    // image whose B slot cannot boot and whose A slot can -- found on the first
    // rollback and not before.
    expect(renderTemplate('@A@ @A@ @A@', { A: 'z' })).toBe('z z z')
  })
})

describe('the shipped grub.cfg renders clean -- the positive control', () => {
  const rendered = renderGrubCfg(g, TEMPLATE, TEMPLATE_PATH)

  test('it renders at all', () => {
    expect(rendered.text.length).toBeGreaterThan(0)
    expect(unrenderedPlaceholders(rendered.text)).toEqual([])
  })

  test('it has two linux lines, one per slot', () => {
    expect(linuxLines(rendered.text).length).toBe(2)
  })

  test('no linux line carries a literal hash', () => {
    expect(literalHashLines(rendered.text)).toEqual([])
  })

  test('and every fragment variable IS referenced', () => {
    expect(unusedFragmentVars(rendered.text)).toEqual([])
    expect(REQUIRED_FRAGMENT_VARS.length).toBe(5)
  })

  test('the rendered file names both slots\' PARTUUIDs and neither placeholder', () => {
    expect(rendered.text).toContain('PARTUUID=5ac35760-0064-4000-8000-000000000005')
    expect(rendered.text).toContain('PARTUUID=5ac35760-0064-4000-8000-000000000006')
    expect(rendered.text).not.toContain('@ROOTFS_A_PARTUUID@')
  })
})

describe('guard 1: an unrendered placeholder', () => {
  test('an unknown @NAME@ is refused, with the line it is on', () => {
    const broken = TEMPLATE.replace('load_env', 'load_env\nset MOS_X=@NOT_A_KEY@')
    expect(broken).toContain('@NOT_A_KEY@')
    expect(() => renderGrubCfg(g, broken, TEMPLATE_PATH)).toThrow(/unrendered placeholder left in grub\.cfg/)
    try {
      renderGrubCfg(g, broken, TEMPLATE_PATH)
    } catch (e) {
      expect(String(e)).toMatch(/grub\.cfg:\d+: set MOS_X=@NOT_A_KEY@/)
    }
  })

  test('a substitution REMOVED from the map leaves its placeholder behind', () => {
    // The failure this really guards: not a typo in the template, but a board
    // key an assembler stopped substituting. The literal `@BOOT_A_PARTNUM@` would
    // become part of a GRUB device name.
    const partial = { ...grubSubstitutions(g) } as Record<string, string>
    delete partial.BOOT_A_PARTNUM
    const rendered = renderTemplate(TEMPLATE, partial)
    expect(unrenderedPlaceholders(rendered).map(l => l.text.trim())).toContain(
      'set slot_a_root="${mos_disk},gpt@BOOT_A_PARTNUM@"',
    )
  })

  test('lowercase @name@ is NOT a placeholder', () => {
    // The shell's pattern is '@[A-Z_]\+@'. GRUB configs contain no @lowercase@
    // today, and a port that widened the pattern would start refusing files the
    // shell accepts.
    expect(unrenderedPlaceholders('linux @foo@ bar')).toEqual([])
  })
})

describe('guard 2: a literal hash on a linux line', () => {
  test('a 64-hex root hash on a linux line is refused', () => {
    const hash = '29809478ef06ccd26a88fb48f5faa78e8477a20dad8ca407a435eaa14419ef8a'
    const broken = TEMPLATE.replaceAll('${MOS_ROOT_HASH}', hash)
    expect(broken).toContain(hash)
    expect(broken).not.toContain('${MOS_ROOT_HASH}')
    expect(() => renderGrubCfg(g, broken, TEMPLATE_PATH)).toThrow(/carries a literal hash/)
  })

  test('a hash in a COMMENT does not fire -- a false positive the shell recorded', () => {
    // "two earlier drafts of this check did that and rejected the correct file,
    // once for a comment and once for the console message printed when a fragment
    // is missing."
    const withComment = TEMPLATE.replace(
      'load_env',
      '# the root hash looks like 29809478ef06ccd26a88fb48f5faa78e8477a20dad8ca407a435eaa14419ef8a\nload_env',
    )
    expect(withComment).toContain('29809478ef06')
    expect(() => renderGrubCfg(g, withComment, TEMPLATE_PATH)).not.toThrow()
  })

  test('a hash in an `echo` line does not fire -- the other one', () => {
    const withEcho = TEMPLATE.replace(
      'load_env',
      'echo "expected 29809478ef06ccd26a88fb48f5faa78e8477a20dad8ca407a435eaa14419ef8a"\nload_env',
    )
    expect(() => renderGrubCfg(g, withEcho, TEMPLATE_PATH)).not.toThrow()
  })

  test('a PARTUUID is not a hash, and that is why the threshold is 32', () => {
    // A GUID has 32 hex digits, in five dash-separated groups; its longest
    // unbroken run is 12. A check written as {12,} would reject the correct file
    // on the very substitution this assembler makes.
    const guid = '5ac35760-0064-4000-8000-000000000005'
    expect(literalHashLines(`  linux /vmlinuz PARTUUID=${guid}`)).toEqual([])
    expect(/[0-9a-f]{12}/.test(guid)).toBe(true)
    expect(/[0-9a-f]{32,}/.test(guid)).toBe(false)
  })

  test('exactly 32 hex fires and 31 does not, so the boundary is the stated one', () => {
    expect(literalHashLines(`linux x ${'a'.repeat(32)}`).length).toBe(1)
    expect(literalHashLines(`linux x ${'a'.repeat(31)}`).length).toBe(0)
  })

  test('a line that is not a linux line is not examined', () => {
    expect(literalHashLines(`initrd ${'a'.repeat(64)}`)).toEqual([])
    // ...but a linux line indented with a tab IS.
    expect(literalHashLines(`\tlinux ${'a'.repeat(64)}`).length).toBe(1)
  })
})

describe('guard 3: a fragment nothing reads', () => {
  test('each of the five required variables is refused when the linux lines stop using it', () => {
    let driven = 0
    for (const v of REQUIRED_FRAGMENT_VARS) {
      // replaceAll, not replace -- and asserted to have changed a LINUX line, not
      // a comment. This is M6b's near-miss, made impossible here.
      const broken = TEMPLATE.replaceAll(`\${${v}}`, 'REMOVED')
      const before = linuxLines(renderTemplate(TEMPLATE, grubSubstitutions(g)))
        .filter(l => l.text.includes(`\${${v}}`)).length
      const after = linuxLines(renderTemplate(broken, grubSubstitutions(g)))
        .filter(l => l.text.includes(`\${${v}}`)).length
      expect(before).toBeGreaterThan(0)
      expect(after).toBe(0)

      expect(() => renderGrubCfg(g, broken, TEMPLATE_PATH)).toThrow(
        new RegExp(`no linux line in .* uses \\$\\{${v}\\}; the per-slot fragment would be installed and never read`),
      )
      driven += 1
    }
    expect(driven).toBe(5)
  })

  test('a grub.cfg whose linux lines say NOTHING passes guard 2 and fails guard 3', () => {
    // The two halves of one argument. A linux line with no variables carries no
    // literal hash -- perfectly clean by guard 2 -- and would boot with an empty
    // dm-verity table.
    const empty = 'menuentry "a" {\n  linux (hd0)/vmlinuz ro\n}\n'
    expect(literalHashLines(empty)).toEqual([])
    expect(unusedFragmentVars(empty)).toEqual([...REQUIRED_FRAGMENT_VARS])
  })

  test('a variable used only OUTSIDE a linux line does not count', () => {
    const elsewhere = `set x=\${MOS_ROOT_HASH}\nlinux (hd0)/vmlinuz \${MOS_SECTORS} \${MOS_DATA_BLOCKS} \${MOS_HASH_START_BLOCK} \${MOS_SALT}\n`
    expect(unusedFragmentVars(elsewhere)).toEqual(['MOS_ROOT_HASH'])
  })
})

describe('the embedded GRUB', () => {
  test('early.cfg is three lines and $root is LITERAL', () => {
    // The shell's heredoc is unquoted, so `${ESP_FAT_LABEL}` expands and `\$root`
    // does not. A port that expanded $root would embed the host shell's idea of
    // it -- which is nothing -- and GRUB would look for its config on a device
    // spelled `()`.
    expect(earlyCfg('MOS-ESP')).toBe(
      'search --no-floppy --label MOS-ESP --set root\n'
      + 'set prefix=($root)/EFI/mos\n'
      + 'configfile ($root)/EFI/mos/grub.cfg\n',
    )
  })

  test('the label comes from the board', () => {
    expect(earlyCfg(g.requirePartition('ESP').require('FAT_LABEL'))).toContain('--label MOS-ESP ')
  })

  test('regexp is in the module list, and grub.cfg needs it', () => {
    // Without it the `regexp --set=1:mos_disk` command silently does nothing,
    // mos_disk stays empty, and every menuentry looks for its kernel on a device
    // spelled ",gpt2".
    expect(GRUB_MODULES).toContain('regexp')
    expect(TEMPLATE).toContain('regexp --set=1:mos_disk')
  })

  test('every module the shipped list names is one os/mkimage-x64.sh names', () => {
    expect(GRUB_MODULES.join(' ')).toBe(
      'part_gpt fat search search_label configfile linux normal echo test loadenv regexp',
    )
  })
})
