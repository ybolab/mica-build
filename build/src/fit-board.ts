/** Fixed hardware facts used by the authenticated FIT packager. */
export const FIT_BOARDS = {
  cx3576: {
    dtb: 'rk3576-src.dtb', watchdog: 'DW_WATCHDOG',
    cmdline: 'console=ttyFIQ0,1500000n8 net.ifnames=0 ro dm_verity.require_signatures=1 panic=5 rdinit=/init fbcon=logo-pos:center,logo-count:1 vt.global_cursor_default=0',
    addresses: ['0x42000000', '0x52000000', '0x54000000'],
  },
  s905x5m: {
    dtb: 's7d_s905x5m_m100.dtb', watchdog: 'AMLOGIC_MESON_GXBB_WATCHDOG',
    cmdline: 'console=ttyS0,921600n8 earlycon=aml_uart,0xfe07a000 net.ifnames=0 ro dm_verity.require_signatures=1 panic=5 rdinit=/init',
    // Keep the kernel, DTB and initramfs clear of S7D secure memory and the logo.
    addresses: ['0x08000000', '0x18000000', '0x20000000'],
  },
} as const

export function fitBoard(board: string) {
  return board === 'cx3576' || board === 's905x5m' ? FIT_BOARDS[board] : undefined
}

/** Reject payloads whose in-memory extent violates the fixed board map. */
export function validateFitKernel(board: 'cx3576' | 's905x5m', header: Buffer, fileBytes: number, dtbBytes: number) {
  if (header.length < 64 || header.subarray(56, 60).toString('ascii') !== 'ARMd') throw new Error('Invalid ARM64 Image header')
  const offset = header.readBigUInt64LE(8), extent = header.readBigUInt64LE(16)
  const address = BigInt(FIT_BOARDS[board].addresses[0])
  if (address < offset || (address - offset) % 0x200000n !== 0n) throw new Error('ARM64 Image load alignment mismatch')
  if (fileBytes < 64 || BigInt(fileBytes) > extent || extent > 128n * 1048576n) throw new Error('ARM64 Image extent exceeds FIT memory budget')
  if (dtbBytes <= 0 || dtbBytes > 2 * 1048576) throw new Error('DTB exceeds FIT memory budget')
}
