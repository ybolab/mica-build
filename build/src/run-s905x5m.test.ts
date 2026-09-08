import { expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { REPO_ROOT } from './paths.ts'

test('s905x5m build modes preserve caller-relative paths', async () => {
  const dir = mkdtempSync(join(tmpdir(), 's905-run-'))
  try {
    const capture = join(dir, 'argv')
    const bun = join(dir, 'bun')
    const docker = join(dir, 'docker')
    writeFileSync(bun, '#!/bin/sh\ncase "$1" in --version) echo 1.4.0 ;; run) case "$2" in src/*) printf "%s\\n" "$@" > "$CAPTURE" ;; esac ;; esac\n', { mode: 0o755 })
    writeFileSync(docker, '#!/bin/sh\nexit 0\n', { mode: 0o755 })
    for (const [mode, args, script, expected] of [
      ['--mkimage-s905x5m-sd', ['--out-dir', 'output'], 'mkimage-s905x5m-sd-cli.ts', ['--out-dir', join(dir, 'output')]],
      ['--extract-s905x5m-emmc-payloads', ['--image', 'sd.img', '--out-dir', '/absolute/output'],
        's905x5m-emmc-payloads-cli.ts', ['--image', join(dir, 'sd.img'), '--out-dir', '/absolute/output']],
    ] as const) {
      const result = Bun.spawnSync(['bash', join(REPO_ROOT, 'build/run.sh'), mode, ...args], {
        cwd: dir, env: { ...process.env, MOS_BUILD_CONTAINER: '0', MOS_BUILD_BUN: bun, MOS_BUILD_DOCKER: docker, CAPTURE: capture },
      })
      expect(result.exitCode, result.stderr.toString()).toBe(0)
      expect(readFileSync(capture, 'utf8').trim().split('\n')).toEqual(['run', `src/${script}`, ...expected])
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
