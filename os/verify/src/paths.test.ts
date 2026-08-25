// Path arithmetic, driven from the failing side.
//
// The reason this file exists rather than "the imports resolved, so the paths
// are right": they would also resolve if the count were wrong and the wrong
// directory happened to exist. Each ascent below is therefore checked at the
// count it uses AND at the counts on either side of it, and the neighbours
// must FAIL. An anchor that is satisfied by more than one answer is not an
// anchor.

import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import { ascendTo, BOARDS_DIR, boardEnvPath, OS_DIR, PACKAGE_DIR, REPO_ROOT, SRC_DIR } from './paths.ts'

describe('every ascent is anchored, and the neighbours miss', () => {
  test('src is where this module lives', () => {
    expect(basename(SRC_DIR)).toBe('src')
    expect(existsSync(join(SRC_DIR, 'board-env.ts'))).toBe(true)
  })

  test('the package directory: 1 up, and neither 0 nor 2', () => {
    expect(PACKAGE_DIR).toBe(ascendTo(SRC_DIR, 1, 'package.json', 'x'))
    expect(basename(PACKAGE_DIR)).toBe('verify')
    expect(() => ascendTo(SRC_DIR, 0, 'package.json', 'x')).toThrow()
    expect(() => ascendTo(SRC_DIR, 2, 'package.json', 'x')).toThrow()
  })

  test('os/: 2 up, and neither 1 nor 3', () => {
    expect(basename(OS_DIR)).toBe('os')
    expect(() => ascendTo(SRC_DIR, 1, 'boards', 'x')).toThrow()
    expect(() => ascendTo(SRC_DIR, 3, 'boards', 'x')).toThrow()
  })

  test('the repository root: 3 up, and neither 2 nor 4', () => {
    expect(existsSync(join(REPO_ROOT, 'Makefile'))).toBe(true)
    expect(() => ascendTo(SRC_DIR, 2, 'Makefile', 'x')).toThrow()
    expect(() => ascendTo(SRC_DIR, 4, 'Makefile', 'x')).toThrow()
  })

  test('a miscount names the path it computed, the marker and the count', () => {
    let msg = ''
    try {
      ascendTo(SRC_DIR, 1, 'boards', 'the os/ directory')
    } catch (e) {
      msg = (e as Error).message
    }
    expect(msg).toContain('the os/ directory')
    expect(msg).toContain('climbing 1 level')
    expect(msg).toContain(PACKAGE_DIR)
    expect(msg).toContain('boards')
  })
})

describe('the board definitions the package reads', () => {
  test('boards/ holds both, at the names the Makefile uses', () => {
    expect(BOARDS_DIR).toBe(join(OS_DIR, 'boards'))
    for (const board of ['cx3576', 'x64']) {
      expect(`${board}: ${existsSync(boardEnvPath(board))}`).toBe(`${board}: true`)
    }
  })

  test('a board that does not exist is not silently a path that does', () => {
    expect(existsSync(boardEnvPath('no-such-board'))).toBe(false)
  })
})
