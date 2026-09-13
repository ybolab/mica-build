import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CX3576_CMDLINE } from './kernel-package.ts'
import { REPO_ROOT } from './paths.ts'
import { parseBoardEnv } from './verify-package.ts'

// The forced kernel command line (CONFIG_CMDLINE) is asserted against
// board.env in ybolab/mica-boards (cx3576/tests/kernel-cmdline-test.sh), where the
// kernel configuration lives; this file holds the two legs the assembly owns.
const boardCmdline = parseBoardEnv(readFileSync(join(REPO_ROOT, 'boards/cx3576/board.env'), 'utf8'), 'board.env')
  .values.get('BOARD_CMDLINE_ARGS')

test.each([
  ['authenticated packaging', CX3576_CMDLINE],
  ['board declaration', boardCmdline],
])('%s shows one centered HDMI logo with no VT cursor', (_source, cmdline) => {
  expect(cmdline).toBeDefined()
  const args = cmdline!.split(/\s+/)
  expect(args.filter(arg => arg.startsWith('fbcon='))).toEqual(['fbcon=logo-pos:center,logo-count:1'])
  expect(args.filter(arg => arg.startsWith('vt.global_cursor_default='))).toEqual(['vt.global_cursor_default=0'])
})

test('the board declaration matches authenticated command policy', () => {
  expect(boardCmdline).toBe(CX3576_CMDLINE)
})
