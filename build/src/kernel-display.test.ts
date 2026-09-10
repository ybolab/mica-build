import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CX3576_CMDLINE } from './kernel-package.ts'
import { REPO_ROOT } from './paths.ts'
import { parseBoardEnv } from './verify-package.ts'

const config = readFileSync(join(REPO_ROOT, 'boards/cx3576/bsp/kernel/config/kernel-cx3576z.config'), 'utf8')
const kernelCmdline = config.match(/^CONFIG_CMDLINE="([^"]*)"$/m)?.[1]
const boardCmdline = parseBoardEnv(readFileSync(join(REPO_ROOT, 'boards/cx3576/board.env'), 'utf8'), 'board.env')
  .values.get('BOARD_CMDLINE_ARGS')

test.each([
  ['forced kernel', kernelCmdline],
  ['authenticated packaging', CX3576_CMDLINE],
  ['board declaration', boardCmdline],
])('%s shows one centered HDMI logo with no VT cursor', (_source, cmdline) => {
  expect(cmdline).toBeDefined()
  const args = cmdline!.split(/\s+/)
  expect(args.filter(arg => arg.startsWith('fbcon='))).toEqual(['fbcon=logo-pos:center,logo-count:1'])
  expect(args.filter(arg => arg.startsWith('vt.global_cursor_default='))).toEqual(['vt.global_cursor_default=0'])
})

test('the forced kernel and board declaration match authenticated command policy', () => {
  expect(config.split('\n')).toContain('CONFIG_CMDLINE_FORCE=y')
  expect(kernelCmdline).toBe(CX3576_CMDLINE)
  expect(boardCmdline).toBe(CX3576_CMDLINE)
})
