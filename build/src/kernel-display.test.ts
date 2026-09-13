import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadBoardFacts } from './board-facts.ts'
import { REPO_ROOT } from './paths.ts'

// The forced kernel command line (CONFIG_CMDLINE) is asserted against
// board.env in ybolab/mica-boards (cx3576/tests/kernel-cmdline-test.sh), where the
// kernel configuration lives; this file holds the two legs the assembly owns:
// the board's authenticated line, which the kernel component packs, and the
// built kernel's forced line out of the imported bundle.
const board = loadBoardFacts('cx3576')
const builtCmdline = /^CONFIG_CMDLINE="(.*)"$/m.exec(readFileSync(join(REPO_ROOT, '_out/boards/cx3576/kernel/config'), 'utf8'))?.[1]

test.each([
  ['authenticated packaging', board.cmdline],
  ['the built kernel', builtCmdline],
])('%s shows one centered HDMI logo with no VT cursor', (_source, cmdline) => {
  expect(cmdline).toBeDefined()
  const args = cmdline!.split(/\s+/)
  expect(args.filter(arg => arg.startsWith('fbcon='))).toEqual(['fbcon=logo-pos:center,logo-count:1'])
  expect(args.filter(arg => arg.startsWith('vt.global_cursor_default='))).toEqual(['vt.global_cursor_default=0'])
})

test('the built kernel forces the line the board declares', () => {
  expect(builtCmdline).toBe(board.cmdline)
})
