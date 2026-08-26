// Drive every image helper against a real image and print what it read.
//
//   bash os/verify/run.sh --parity --probe
//
// M4a. This is the instrument that answers "do the helpers work against BOTH
// real images" without needing a single check to be ported -- and it is what
// M4b will reach for first, because the fastest way to write a check is to see
// what the helper already hands you.
//
// It is a PROBE and not a check: it asserts nothing about the image and its
// output is not a verdict. What it does assert is that each helper ran and
// produced something of the shape it promises -- and every helper here refuses
// rather than returns empty when its tool did not do the work, so a probe line
// that prints is a helper that worked. A step that cannot run says WHY, by
// name; it never quietly drops out of the list, because a probe with a missing
// line and a probe with a passing one look identical from outside.
//
// It walks the board definition's ROLES rather than partition names, so the
// same code drives cx3576's eleven partitions (raw-blob loader, two uboot-env,
// two FAT boot slots) and x64's nine (an ESP plus two FAT boot slots, no
// loader, no environment) without a board branch.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ImageContext } from './checks.ts'
import {
  debugfsRun,
  e2fsckClean,
  ext4List,
  ext4Super,
  fatList,
  fatCopyOut,
  fatVolumeLabel,
  fdtGetCells,
  fdtGetResult,
  readBytes,
  readUImage,
  sgdiskVerify,
  squashfsExtract,
  squashfsList,
  squashfsSuper,
  uImageMagic,
  verityVerify,
} from './image.ts'

type Log = (line: string) => void

/** Run one probe step and print its outcome, naming a refusal rather than hiding it. */
async function step<T>(log: Log, what: string, run: () => Promise<T> | T): Promise<T | undefined> {
  try {
    const value = await run()
    return value
  }
  catch (error) {
    log(`      !! ${what}: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`)
    return undefined
  }
}

export async function probeImage(ctx: ImageContext, log: Log): Promise<void> {
  log('')
  log(`── probe: ${ctx.board.name} ── ${ctx.image}`)
  log(`   tools: ${ctx.tools.announce}`)

  // 1. sgdisk
  const gpt = await ctx.gpt()
  log(`   [sgdisk]      ${gpt.partitions.length} partitions, sector ${gpt.sectorSize} B,`
    + ` disk GUID ${gpt.diskGuid}, ${gpt.totalSectors} sectors`)
  for (const p of gpt.partitions) {
    log(`                 p${String(p.number).padStart(2)} ${p.name.padEnd(10)}`
      + ` ${String(p.firstSector).padStart(8)}..${String(p.lastSector).padStart(8)}`
      + ` (${p.sizeSectors} sectors)  type ${p.typeGuid}  attrs ${p.attributeFlags}`)
  }
  const verdict = await sgdiskVerify(ctx.tools, ctx.image)
  log(`   [sgdisk]      --verify: ${verdict.clean ? 'no problems' : `complaints: ${verdict.complaints.join(' | ')}`}`)

  // 2. mtools, at an offset
  for (const part of ctx.board.partitions.filter(p => p.role === 'esp')) {
    const label = part.label
    if (label === undefined) continue
    await step(log, `mtools on ${label}`, async () => {
      const slot = await ctx.fatSlot(label)
      const volume = await fatVolumeLabel(ctx.tools, slot)
      const entries = await fatList(ctx.tools, slot)
      log(`   [mtools]      ${label} @ ${slot.offsetBytes} B: volume '${volume}', ${entries.length} entries`)
      log(`                 ${entries.join(' ')}`)
      return entries
    })
  }

  // 3. dd-extract + tune2fs/debugfs
  for (const part of ctx.board.partitions.filter(p => p.role === 'ext4')) {
    const label = part.label
    if (label === undefined) continue
    await step(log, `ext4 on ${label}`, async () => {
      const file = await ctx.extract(label)
      const sb = await ext4Super(ctx.tools, file)
      const entries = await ext4List(ctx.tools, file, '/')
      log(`   [tune2fs]     ${label}: volume '${sb.volumeName}', UUID ${sb.uuid},`
        + ` ${sb.blockCount} × ${sb.blockSize} B, state ${sb.state}`)
      log(`   [debugfs]     ${label}: / holds ${entries.length} entries —`
        + ` ${entries.map(e => e.name).join(' ')}`)
      // M4g: the ext4 family's own verdict, and the one whose REPORT the oracle
      // sends to /dev/null. Printed here so a truncated filesystem's "likely to
      // be corrupt" is visible somewhere even though the status says clean.
      const fsck = await e2fsckClean(ctx.tools, file)
      log(`   [e2fsck]      ${label}: exit ${fsck.code} — ${fsck.clean ? 'clean' : 'NOT clean'}`
        + `${fsck.report.length === 0 ? '' : ` — ${fsck.report.join(' | ').slice(0, 160)}`}`)
      return entries
    })
  }

  // 4/5. unsquashfs and veritysetup, over the verity slot
  for (const part of ctx.board.partitions.filter(p => p.role === 'verity-slot')) {
    const label = part.label
    if (label === undefined) continue
    if (!label.endsWith('-a')) continue // the B slot is a copy; one is the probe
    await step(log, `squashfs on ${label}`, async () => {
      const file = await ctx.extract(label)
      const magic = new TextDecoder().decode(readBytes(file, 0, 4))
      const sb = await squashfsSuper(ctx.tools, file)
      const paths = await squashfsList(ctx.tools, file)
      log(`   [dd/read]     ${label}: first four bytes '${magic}'`)
      log(`   [unsquashfs]  ${label}: SQUASHFS ${sb.version}, ${sb.sizeBytes} B, ${sb.compression},`
        + ` block ${sb.blockSize} — ${paths.length} paths`)
      // A path the archive REALLY carries, taken out of the listing that was
      // just read rather than named here -- so this drives extraction on both
      // boards without knowing either one's tree.
      const sample = paths.find(p => p === '/usr/lib/os-release') ?? paths[1] ?? paths[0] as string
      const dest = join(ctx.workDir, `probe-${label}`)
      if (!existsSync(dest)) {
        await squashfsExtract(ctx.tools, file, dest, [sample])
        log(`   [unsquashfs]  ${label}: ${sample} extracted and present`)
      }

      // AND THE OTHER DIRECTION, in the same breath. unsquashfs exits 0 for a
      // path that is not in the archive and leaves an empty directory behind;
      // a probe that only ever showed the succeeding case would be showing a
      // helper that has never been observed refusing anything.
      const absent = join(ctx.workDir, `probe-absent-${label}`)
      if (!existsSync(absent)) {
        try {
          await squashfsExtract(ctx.tools, file, absent, ['no/such/path/in/this/image'])
          log(`   [unsquashfs]  !! extracting a path that is NOT in ${label} was NOT refused.`)
        }
        catch (error) {
          const first = error instanceof Error ? error.message.split('\n')[0] : String(error)
          log(`   [unsquashfs]  ${label}: a path not in the archive is refused — ${first}`)
        }
      }
      return paths
    })

    // The root hash comes from the parameter file the build produced. Reading
    // it out of the boot slot instead is a CHECK -- cx3576 puts it in a file
    // there and x64 puts it on the kernel command line, and asserting that the
    // two agree is one of the things M4b ports. A probe that re-derived it
    // would be a second implementation of that check, in a file that asserts
    // nothing.
    const paramFile = join(ctx.outDir, 'rootfs-verity.env')
    if (!existsSync(paramFile)) {
      log(`   [veritysetup] NOT RUN: ${paramFile} is not there, so this probe has no root hash to`)
      log(`                 verify ${label} against. Produce it with os/rootfs/build-v2.sh.`)
      continue
    }
    await step(log, `veritysetup on ${label}`, async () => {
      const env = new Map(
        readFileSync(paramFile, 'utf8').split('\n')
          .map(l => /^([A-Z_]+)=(.*)$/.exec(l))
          .filter((m): m is RegExpExecArray => m !== null)
          .map(m => [m[1] as string, m[2] as string]),
      )
      const rootHash = env.get('VERITY_ROOT_HASH') ?? ''
      const hashStart = Number(env.get('VERITY_HASH_START_BLOCK') ?? Number.NaN)
      const hashBlock = Number(env.get('VERITY_HASH_BLOCK_SIZE') ?? Number.NaN)
      const file = await ctx.extract(label)
      const answer = await verityVerify(ctx.tools, {
        dataFile: file,
        hashFile: file,
        rootHash,
        hashOffset: hashStart * hashBlock,
      })
      log(`   [veritysetup] ${label}: ${answer} against ${rootHash}`
        + ` (--hash-offset=${hashStart * hashBlock})`)
      return answer
    })
  }

  // 6. debugfs's raw command surface, which several ported checks will want ----
  const firstExt4 = ctx.board.partitions.find(p => p.role === 'ext4')?.label
  if (firstExt4 !== undefined) {
    await step(log, `debugfs features on ${firstExt4}`, async () => {
      const file = await ctx.extract(firstExt4)
      const out = await debugfsRun(ctx.tools, file, 'features')
      log(`   [debugfs]     ${firstExt4}: features — ${out.trim().split('\n').join(' ')}`)
      return out
    })
  }

  // 7. M4g: fdtget and the uImage header, over whatever BOOT-A actually holds -
  //
  // Driven off the slot's OWN listing rather than off a file name written here:
  // a `.dtb` is a device tree on any board that ships one and a `.scr` is a
  // compiled boot script on any board that ships one, and a board that ships
  // neither prints neither line instead of two refusals about files it never
  // claimed to have.
  const bootA = ctx.board.partitions.find(p => p.name === 'BOOT_A')?.label
  if (bootA !== undefined) {
    await step(log, `the boot slot's own files on ${bootA}`, async () => {
      const slot = await ctx.fatSlot(bootA)
      const listing = await fatList(ctx.tools, slot)
      const named = listing.map(l => l.replace(/^::\//, ''))

      for (const dtb of named.filter(f => f.endsWith('.dtb'))) {
        const local = join(ctx.workDir, `probe-boot-a-${dtb}`)
        if (!await fatCopyOut(ctx.tools, slot, dtb, local)) {
          log(`   [fdtget]      ${dtb} is listed in ${bootA} and mcopy could not read it`)
          continue
        }
        // BOTH DIRECTIONS, in the same breath, as the unsquashfs step does:
        // a node that IS there and a node that is not, so the probe is never
        // showing a helper that has only ever been observed succeeding.
        const red = await fdtGetResult(ctx.tools, local, '/leds/status-red', 'label')
        const cells = await fdtGetCells(ctx.tools, local, '/leds/status-red', 'gpios')
        const ghost = await fdtGetResult(ctx.tools, local, '/leds/no-such-led', 'label')
        log(`   [fdtget]      ${dtb}: /leds/status-red label ${red.value ?? `— ${red.refusal}`},`
          + ` gpios (-t x) [${cells.join(' ')}]`)
        log(`   [fdtget]      ${dtb}: a node that is NOT there refuses — ${ghost.refusal ?? 'IT DID NOT'}`)
      }

      for (const scr of named.filter(f => f.endsWith('.scr'))) {
        const local = join(ctx.workDir, `probe-boot-a-${scr}`)
        if (!await fatCopyOut(ctx.tools, slot, scr, local)) {
          log(`   [uImage]      ${scr} is listed in ${bootA} and mcopy could not read it`)
          continue
        }
        const header = readUImage(local)
        log(`   [uImage]      ${scr}: magic ${uImageMagic(local)}, type ${header?.imageType ?? '(no header)'},`
          + ` name '${header?.name ?? ''}', ${header?.dataSize ?? 0} B of payload at ${header?.dataOffset ?? 0}`)
      }
      return named
    })
  }
  log('')
}
