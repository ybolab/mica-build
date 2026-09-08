# RFCT-352 cx3576 boot.cmd loads the kernel and the dtb unguarded

- **status**: completed
- **priority**: P0
- **owner**: bkd/cr6pd5t6
- **createdAt**: 2026-09-08 12:00
- **relatedPlans**: (none)

> The index line in `docs/task/index.md` is written by L1, not by this task.

## Description

`boards/cx3576/boot.cmd` guards the 370-byte verity env file and does not guard
the 42 MB kernel:

```
load mmc 0:${bootpart} ${kernel_addr_r} Image
load mmc 0:${bootpart} ${fdt_addr_r} rk3576-src.dtb
booti ${kernel_addr_r} - ${fdt_addr_r}
```

A cx3576 board died in `paging_init` with `kernel BUG at arch/arm64/mm/mmu.c:283`
because the image in DRAM was a **mixture of two kernel builds**: RFCT-351
measured the eight bytes at `swapper_pg_dir[256]` to be, byte for byte, the
content of file offset `0x1e87800` in a **different, older** build, while the
trap that fired exists only in the current one. The console reported
`44493312 bytes read` -- the full file size -- while doing it.

`load` returning success means the FAT directory had an entry and the read
call did not error. It does not mean the bytes in DRAM are the bytes on the
card, and the cheapest possible check would have said so.

## ActiveForm

Guarding both boot-partition loads with a recorded byte count and CRC-32, and
routing a failure down the existing burn-the-slot path

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Acceptance

- Both loads guarded, the size and the checksum asserted, failures named on the
  console, and the failure route the one already in this file.
- `tests/handshake-test` extended so the new refusals have cases.
- `docs/design/uboot-ab-handshake.md` 5.3 and its zh counterpart synced.
- `verify/run.sh --verify --board cx3576` at its count or the change explained.
- `make docs-verify` green from a `git archive` into an empty directory.
- `docs/plan/index.md`, `docs/task/index.md` and `docs/CHANGELOG.md` untouched.

## Notes

### What the guard is

`mos-boot-digest.env`, one per boot partition, beside `Image` and
`rk3576-src.dtb`:

```
kernel_bytes=<hex>   kernel_crc=<8 hex digits>
fdt_bytes=<hex>      fdt_crc=<8 hex digits>
```

`boot.cmd` loads it, clears the four keys first, then per artefact: `load`,
compare `${filesize}` against `<key>_bytes`, `crc32 -v` against `<key>_crc`.
Any of the three failing sets `bootfault`, and one block at the end echoes
`mos: slot <A|B> p<N>: <fault>`, sets `BOOT_<slot>_LEFT 0`, `saveenv`, `reset` --
the route the missing-`mos-verity-<slot>.env` case already takes, twice over in
this file.

**Which failure each half catches, plainly.** The byte count catches a **short
read** and names it precisely; the checksum alone would say only "wrong". The
CRC-32 catches **any divergence present in DRAM when it runs** -- a short read
*or* stale bytes in the middle -- and it is the one of the two that would have
caught RFCT-351's failure, where the console reported the full `44493312 bytes
read` over a mixture of two builds. **Neither catches a corruption that happens
after the check**: the window is the milliseconds between `crc32` and `booti`
instead of the whole load, and it is not zero. The script cannot make it zero,
and this record does not claim it does.

### Two spellings that are contract, not presentation

- **The byte count is `%lx`.** `do_load` publishes `${filesize}` through
  `env_set_hex`, which is `sprintf(str, "%lx", ...)`: lowercase, no `0x`, no
  leading zeros. The comparison is a hush string compare, because hush has no
  arithmetic without `setexpr` and `setexpr` is hexadecimal.
- **The checksum is eight digits, zero-padded, and that is load-bearing.**
  `parse_verify_sum` (`u-boot/common/hash.c`) reads an argument of exactly
  `2 * digest_size` characters as a hex literal and **anything else as the name
  of an environment variable to look up**. A CRC with a zero top byte written
  as six digits would not be compared against the image at all; it would be
  looked up, not found, and refuse a slot that was fine. Roughly 1 build in 256.
  `crc32Hex` pads and `build/src/boot-cx3576.test.ts` drives the zero-top case.

### Why no slot suffix -- the one design call worth arguing

The task's constraints anticipated a slot-suffixed file, on the analogy of
`mos-verity-<slot>.env`. It is the wrong analogy and the file is deliberately
slot-**neutral**.

`mos-verity-<slot>.env` describes a **different partition** -- the rootfs slot
this boot partition will be paired with -- which one RAUC boot payload cannot
know, because it is installed into whichever boot slot is inactive. That is why
it must ship both slots' copies under distinct names.

These digests describe **this partition's own two files**, of which there is
exactly one set whichever slot the partition turns out to be -- exactly as there
is one `Image` and one `boot.scr`, neither of which carries a suffix. A suffixed
pair would be two names for one fact: the assembler would write
`mos-boot-digest-a.env` and `mos-boot-digest-b.env` with **identical content**
into the same partition, only one would ever be read, and the other would be
free to drift. `build/src/mkimage-cx3576.test.ts` asserts the positive form of
this: both slots' digest files are byte-identical and both describe the Image
actually staged.

The assembler writes it into both slots (`makeBootSlot`), and `bundle.ts` writes
one into the single `boot.vfat` a RAUC payload carries -- one payload, one
kernel, one digest.

### `crc32 -v`, and the cost of choosing it

`CONFIG_CMD_CRC32` is `default y` and gives only `crc32 address count [addr]`,
which writes its answer to **memory**. Reading it back needs a byte swap
(`crc32_wd_buf` stores the digest big-endian; `setexpr`'s `*addr` does a native
load) and an unpadded `%llx` comparison -- two spellings nothing would check,
either of which silently bricks a fleet if a later refactor "normalises" them.
`crc32 -v` compares in one command, returns the verdict as an exit status hush
can branch on, and prints both values on mismatch.

It needs `CONFIG_CRC32_VERIFY=y`, which is `default n`. **Measured against the
shipped blob**: `/srv/mos/_out/boards/cx3576/uboot-mos/u-boot-rockchip.bin`
carries `crc32 address count [addr]` and no `-v`. So:

> **This change is not deployable by a RAUC update alone.** The loader lives in
> raw sectors outside every slot group. A device carrying today's `uboot-mos`
> that received the new `boot.scr` would read `crc32 -v` as a usage error, treat
> that as a failed verification, and burn **both** slots. The blob and the boot
> payload must be flashed together.

That is stated in `boot.cmd`'s header, in §5.3 divergence 3, in §3.2's note on
the symbol, and in the zh overview. Under the tree's no-compatibility rule the
break is allowed; it is not silent.

`build-mos.sh` enables the symbol and asserts it by name, in the same list as
the `ENV_MMC_*` pins and for a sharper reason: it is `default n`, so it is
exactly what an `olddefconfig` drops, and a blob without it refuses both slots
on the first boot.

### The cost of the checksum, measured -- and what is still owed

`crc32` over **44,493,312 bytes** (the real kernel's size) in the U-Boot
sandbox, on this host (Intel Xeon 8581C @ 2.10 GHz):

| run | wall |
| --- | --- |
| process floor (`crc32 addr 4`) | 980, 980, 987 ms |
| one pass | 1089, 1071, 1072 ms |
| ten passes | 1922, 1971, 1969 ms |

One pass ≈ **95 ms** by subtracting the floor, ≈ **99 ms** from the ten-pass
slope: ~470 MB/s, ~4.5 cycles/byte, which is the shape of `lib/crc32.c`'s
table-driven byte loop.

**This is not the SoC number and must not be read as one.** No cx3576 is
attached to this session, so the RK3576 figure -- U-Boot runs single-core on the
boot core, and the code is portable C whose throughput follows clock and IPC --
**has not been measured, and is owed.** What can be said without the board: the
same 42 MB is already read off eMMC by the `load` that precedes it, and the
refusal buys the difference between a console line naming the slot and a kernel
`BUG()` in `paging_init` with nothing attributing it.

### Burning the slot is right, including on a first boot

The task asked what the refusal costs on a device whose `rootfs-b` (p7) is
zero-filled. **The burn is not a permanent loss**: `BOOT_<slot>_LEFT 0` is
undone by the script's own refill block -- when both slots reach zero it puts
three credits back on each and resets (§4.2). So on a factory-flashed board a
refusal on slot A sends the device to slot B, whose rootfs is zeros, whose
credits are spent over its own boots, and the refill then returns to slot A with
three credits. **The guard cannot strand a device that a retry would have
saved**; it costs boot cycles.

Against that, today's behaviour for the failure that was actually measured is
not "retry" -- it is a `BUG()` in `paging_init` with the board hung, no reset,
no failover, and nothing on the console attributing it to the boot chain. A
board that says `mos: slot A p4: Image: 2a6ea00 bytes landed and their crc32 is
not <x>` is strictly better than that.

### What the harness measured about itself, and what it cost

Extending `tests/handshake-test/` turned up a **fact about the harness that was
wrong before this change**, and it is the same defect in miniature.

Its execution model claimed that seeding `kernel_addr_r` above the sandbox's
2048 MiB RAM ended a cycle at the `load ... Image` line with a hard
`os_abort()`, standing in for "the kernel accepted control". Measured, five
ways, against the built sandbox binary:

- `load mmc 0:4 0xf0000000 Image` **fails cleanly** --
  `fs_read_lmb_check() ** Reading file would overwrite reserved memory **`,
  `do_load() Failed to load 'Image'` -- with and without preceding loads.
- The abort came from the **next line**: `booti 0xf0000000 - ...` →
  `phys_to_virt: Cannot map sandbox address f0000000 (SDRAM from 0 to
  80000000)` → core.

So the old model worked **only because the script ignored a failed load** and
handed `booti` an address nothing had been written to -- which is exactly the
defect RFCT-352 closes. With the guard in place the script refuses that slot and
never reaches `booti`, and the model is no longer expressible.

`CONFIG_LMB=n` was tried as a way to keep it: it makes the out-of-RAM load abort
where the note always said it did. **It does not build** -- `CMD_BOOTI` is
unavailable without LMB (`ERROR: CONFIG_CMD_BOOTI=y missing from sandbox
.config`) -- so LMB stays on and is now pinned `=y` positively in the Dockerfile.

**What that costs, stated rather than papered over.** On sandbox every path in
the guarded script ends in a burn or the refill; nothing can end a cycle by
leaving U-Boot. The **3→2→1→0 decrement trajectory across three resets is
therefore no longer covered anywhere.** Scenario 1 was rewritten to assert what
is still reachable, and one property it gained is arguably the one that mattered
in that trajectory: **decrement-then-save-then-boot** (§4.2), read off the
console as two environment writes per cycle with the first one preceding the
`mos: booting slot` banner. Failover at zero, the refill at exhaustion, and the
restart at the head of `BOOT_ORDER` are all still asserted.

### The harness, before and after

| | before | after |
| --- | --- | --- |
| scenarios | 3 | 7 |
| PASS assertions | 72 | 101 |

The four new ones, each carrying exactly one fault:

- **4** -- an `Image` of the **right length and the wrong bytes** (30 bytes
  overwritten 2 MiB in). The shape of the hardware failure; only the checksum
  can see it. Asserts `** ERROR **` from `crc32 -v`, the named burn, that the
  **size** half did *not* fire, and that `booti` was never reached.
- **5** -- a **short** `Image`. Asserts the size message with both numbers
  (`3ff000` landed, `400000` recorded) and that the checksum never ran.
- **6** -- a slot with **no `mos-boot-digest.env`**, its verity env intact.
- **7** -- a slot with **no `Image` at all**, covering the `would not load`
  branch that scenario 1's out-of-RAM address used to reach by accident.

Plus the positive control, in scenario 3 and in every scenario-1 cycle: a good
slot prints `mos: Image 400000 bytes, crc32 <x> verified in DRAM` and
`mos: rk3576-src.dtb 10000 bytes, crc32 <y> verified in DRAM` and goes on to
`booti`. Without it a guard that refused everything would satisfy all four
negatives.

The fixture digest is computed with python3's `zlib.crc32` rather than by
calling `build/src/boot-cx3576.ts` -- the assembler is the producer this script
has to agree with, and a fixture built by calling it would agree by
construction. Seven anti-vacuity checks assert the fixtures are what the
scenarios claim: the mixed Image is the same length and different bytes, the
short one is shorter, the digest records the real lengths, and the checksums are
eight hex digits.

### Guards added on the build side

- `checkBootDigestGuards` joins `checkBootCmd`, so the assembler refuses a
  `boot.cmd` that carries the digest file's name but stopped comparing it. Per
  artefact it requires both the `${filesize}` compare and the `crc32 -v`, driven
  from the failing side by deleting each half in turn -- because the assembler
  writes the digest file whatever the script does with it, so the file's
  presence is not evidence that anything reads it.
- `bootDigestEnv` refuses a **zero-length** artefact. `load` of an empty file
  sets `${filesize}` to `0` and `crc32` over zero bytes is `00000000`: an empty
  `Image` satisfies both assertions exactly, so the one input that makes the
  guard meaningless would otherwise sail through it.
- The verify register gained `boot-digest-<board>-<slot>-<file>`: the recorded
  digest is matched against the artefact **read back out of the assembled
  image**, per slot per artefact. The assembler computes the file from the
  staged copies, which is exactly why it cannot be the thing that proves it.
  Matching is by **value**, not by key name, so the `kernel_`/`fdt_` mapping is
  not restated in verify where it could drift.

### Two shared consumers that had to learn a third category

`BOOT_SLOT_REQUIRED_FILES` entries were classified by producer into a
trichotomy: BSP artefact, the boot script, or a per-slot (`@SLOT@`) assembler
file. `mos-boot-digest.env` is the first **slot-neutral assembler-written**
entry, and left alone both `boards/cx3576/deb/board-cx3576/render.sh` and
verify's `bspArtefacts()` would have looked for it under `${BSP_OUT}/kernel/`,
where nothing produces it. Both now exclude it by the board's own
`BOOT_DIGEST_ENV_NAME`, with `:-` / `undefined` guards for boards that declare
none.

### verify, at 432/432 against an image built from this branch

`bash verify/run.sh --verify --board cx3576` reports **432/432, 3 skipped**,
against `_out/cx3576/cx3576-mos-1788841846.img`, assembled from this branch.
The denominator moved **426 -> 432**, +6, all of them this change:

| family | new checks |
| --- | --- |
| `boot-slot-file-cx3576-BOOT-{A,B}-mos-boot-digest.env` | 2 |
| `boot-digest-cx3576-BOOT-{A,B}-{Image,rk3576-src.dtb}` | 4 |

and their output on the shipped image:

```
PASS: BOOT-A contains mos-boot-digest.env
PASS: BOOT-B contains mos-boot-digest.env
PASS: BOOT-A mos-boot-digest.env records Image as kernel_bytes=2a6ea00 kernel_crc=5f867ac9, and that is what is in the slot
PASS: BOOT-A mos-boot-digest.env records rk3576-src.dtb as fdt_bytes=46ce7 fdt_crc=703d24cf, and that is what is in the slot
PASS: BOOT-B ... (the same two)
```

`kernel_bytes=2a6ea00` is 44,493,312 -- the number the dying board printed as
`44493312 bytes read`, and now the number the next boot holds it to.

RFCT-351 read **423/426** because no image on the host carried PLAN-086 S2's
exports. This build produces them (`_out/cx3576/boot/` holds `Image`,
`rk3576-src.dtb`, `boot.cmd` and `u-boot-rockchip.bin`; `_out/cx3576/debug/`
holds `manifest.tsv` and the `.build-id` tree), so those three are green here
and were never this change's.

### What was rebuilt to get there, and one failure that was not this change

The whole arm64 pool had to be rebuilt rather than just `mos-board-cx3576`:
first-party packages depend on each other by exact version
(`mos-mqttd ... Depends: mosd (= 0.1.0+git8c49e8e43e50.dirty-1)`) and
`rootfs/build.sh` refuses a pool carrying more than one git stamp, so a
single-producer rebuild would have produced an unsatisfiable index. 14 producers
for `arm64`/`all`, one stamp, then `repo.sh`, then the rootfs and the image.
`pkgs/{podman,rauc}/out-arm64`, `_out/cargo` and the cx3576 + virt-arm64 kernel
artefacts were copied from `/srv/mos` rather than rebuilt; the `Image` is the
byte-identical one RFCT-351 measured.

The first rootfs attempt died on `debian-base: error: download exceeded the
600s ceiling and was killed:
https://snapshot.debian.org/.../libc6_2.41-12+deb13u3_arm64.deb` -- an upstream
fetch, nothing to do with this change. Merging
`/srv/mos/_out/debian-base/debs` (173 content-addressed archives) into this
worktree's cache and re-running carried it through.

### Everything else that was run

- `bash tests/handshake-test/run.sh` -- RESULT: PASS, 101 assertions, 0 fail.
- `bash build/run.sh` -- 947/947. `bash verify/run.sh` -- 1356/1356.
- `make docs-verify` from a `git archive` of this tree into an empty directory
  -- 192 + 488 + 749 + 243 + 97 PASS, 0 fail.
- `docs/design/uboot-ab-handshake.md` 5.3's code block is now asserted
  byte-identical to `boards/cx3576/boot.cmd`'s body. It was NOT before this
  change: the published block still carried `bootpart 3` / `rootpart 5` and
  `storagemedia=emmc` from before the loader partition landed, so "synced to
  the shipped file" was false when this task started. It is true now.
- `make -C boards/cx3576/bsp uboot-mos` -- the blob the image carries, measured
  to hold `-v address count crc` / `verify crc of memory area`, which the
  previously shipped one does not.

### Not done, and owed

- **The `crc32` cost on RK3576.** Measured on the sandbox host only; see above.
- **Nothing is asserted about the window between `crc32` and `booti`.** Stated
  in the script and in 5.6 rather than papered over.
- **Why the load delivered stale bytes** is out of scope by the task and is
  untouched here. This change makes that failure visible and attributable; it
  does not explain it.
