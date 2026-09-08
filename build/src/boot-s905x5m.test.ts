// The s905x5m boot command has literal GPT numbers because hush cannot read
// board.env. Exercise the generic refusal against this board too: p3/p4 hold
// the redundant environment, so copying cx3576's numbers would be catastrophic.

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  bootAttemptValues,
  bootCmdSetting,
  checkAbBootCmd,
  checkPartitionNumbers,
} from './boot-cx3576.ts'
import { loadGeometry } from './geometry.ts'
import { BOARDS_DIR } from './paths.ts'

const g = loadGeometry('s905x5m')
const BOOT_CMD_PATH = join(BOARDS_DIR, 's905x5m', 'boot.cmd')
const BOOT_CMD = readFileSync(BOOT_CMD_PATH, 'utf8')

describe('the s905x5m production boot command', () => {
  test('is the tree fixture and satisfies every generic A/B guard', () => {
    expect(() => checkAbBootCmd(g, BOOT_CMD, BOOT_CMD_PATH)).not.toThrow()
    expect(bootAttemptValues(BOOT_CMD)).toEqual([3n, 3n, 3n, 3n])
  })

  test('spells the shifted p5/p6 boot and p7/p8 rootfs numbers', () => {
    expect([
      bootCmdSetting(BOOT_CMD, 'A', 'bootpart'),
      bootCmdSetting(BOOT_CMD, 'B', 'bootpart'),
      bootCmdSetting(BOOT_CMD, 'A', 'rootpart'),
      bootCmdSetting(BOOT_CMD, 'B', 'rootpart'),
    ]).toEqual(['5', '6', '7', '8'])
  })

  const stale: [string, string, string, string][] = [
    ['A', 'bootpart', '5', '6'],
    ['B', 'bootpart', '6', '7'],
    ['A', 'rootpart', '7', '8'],
    ['B', 'rootpart', '8', '9'],
  ]
  for (const [slot, name, real, wrong] of stale) {
    test(`refuses stale ${name} ${wrong} for slot ${slot}`, () => {
      const bad = BOOT_CMD.replace(`setenv ${name} ${real}`, `setenv ${name} ${wrong}`)
      expect(bad).not.toBe(BOOT_CMD)
      expect(() => checkPartitionNumbers(g, bad, '<boot.cmd>'))
        .toThrow(new RegExp(`sets '${name}' to '${wrong}' for slot ${slot}, but the layout puts that partition at p${real}`))
    })
  }

  test('uses only the s905x5m production loader values and the mandatory RAUC shape', () => {
    for (const token of [
      'setexpr BOOT_A_LEFT ${BOOT_A_LEFT} - 1',
      'setexpr BOOT_B_LEFT ${BOOT_B_LEFT} - 1',
      'fatload mmc 1:${bootpart} ${verityaddr} mos-verity-${slotsuffix}.env',
      'elif fatload mmc 1:${bootpart} ${verityaddr} mos-verity.env; then',
      'rauc.slot=${bootslot}',
      'setenv loadaddr_kernel 0x3000000',
      'setenv dtb_mem_addr 0x1000000',
      'setenv fdtfile s7d_s905x5m_m100.dtb',
      'console=ttyS0,921600 earlycon=aml_uart,0xfe07a000',
      'fdt rm /chosen bootargs',
      'booti ${loadaddr_kernel} - ${dtb_mem_addr}',
    ]) expect(BOOT_CMD).toContain(token)
    expect(BOOT_CMD).not.toContain('cfgload emmc')
    expect(BOOT_CMD).not.toContain('mmc 0:${bootpart}')
  })

  test('keeps the proven Amlogic display handoff and serial-console order paired', () => {
    const consoleArgs = 'console=tty1 console=ttyS0,921600 earlycon=aml_uart,0xfe07a000'
    const displayArgs = [
      'logo=${display_layer},loaded,${fb_addr}',
      'aml_media.vout=${outputmode},disable',
      'aml_media.connector0_type=${connector0_type}',
      'hdmitx=,${colorattribute}',
      'hdmimode=${hdmimode}',
    ].join(' ')
    const vout = [
      'if vout output ${outputmode}; then',
      '    echo "display: ${outputmode} enabled"',
      'fi',
    ].join('\n')

    for (const line of [
      'setenv connector0_type "HDMI-A-A"',
      'setenv outputmode "1080p60hz"',
      'setenv hdmimode "${outputmode}"',
      'setenv colorattribute "444,8bit"',
      'setenv display_layer "osd0"',
      'setenv fb_addr "0x00300000"',
    ]) expect(BOOT_CMD).toContain(line)
    expect(BOOT_CMD).toContain(`setenv consoleargs "${consoleArgs}"`)
    expect(BOOT_CMD).toContain(`setenv displayargs "${displayArgs}"`)
    expect(BOOT_CMD).toContain(
      'setenv bootargs "${rootargs} ${verity_args} ${raucargs} ${consoleargs} ${displayargs} net.ifnames=0 ${machineid_arg}"',
    )
    expect(consoleArgs.indexOf('console=tty1')).toBeLessThan(consoleArgs.indexOf('console=ttyS0,921600'))
    expect(consoleArgs.lastIndexOf('console=')).toBe(consoleArgs.indexOf('console=ttyS0,921600'))
    expect(BOOT_CMD).toContain(vout)
    expect(BOOT_CMD.indexOf('if fdt rm /chosen bootargs; then')).toBeLessThan(BOOT_CMD.indexOf(vout))
    expect(BOOT_CMD.indexOf(vout)).toBeLessThan(BOOT_CMD.indexOf('booti ${loadaddr_kernel} - ${dtb_mem_addr}'))
  })

  test('leaves the Amlogic DT bootargs merge input absent for booti', () => {
    expect(BOOT_CMD).toContain([
      'if fdt rm /chosen bootargs; then',
      '    echo "bootargs: removed DT merge input"',
      'fi',
    ].join('\n'))
    expect(BOOT_CMD).not.toMatch(/^\s*fdt set \/chosen\/bootargs\b/m)
    expect(BOOT_CMD).not.toContain('retaining U-Boot values')
  })
})
