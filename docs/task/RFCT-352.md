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
- `docs/plan/index.md`, `docs/task/index.md` and `docs/changelog.md` untouched.

## Notes

### What the guard is

`mos-boot-digest-<slot>.env`, one per slot, beside `Image` and
`rk3576-src.dtb`:

```
kernel_bytes=2a6ea00   kernel_crc=5f867ac9
fdt_bytes=46ce7        fdt_crc=703d24cf
```

`boot.cmd` loads it, clears the four keys first, then per artefact: `load`,
compare `${filesize}` against `<key>_bytes`, `crc32 -v` against `<key>_crc`.
Any of the three failing sets `bootfault`, and one block at the end echoes
`mos: slot <A|B> p<N>: <fault>`, sets `BOOT_<slot>_LEFT 0`, `saveenv`, `reset` --
the route the missing-`mos-verity-<slot>.env` case already takes.

### The checksum is the guard. The size compare is a first line. This is measured.

The brief asked me to prefer the form that would have caught the failure. **The
board settled it**, and the answer is not "both halves, equally". At the U-Boot
prompt the word under `swapper_pg_dir[256]` was poisoned before the load and
read back after it:

```
=> mw.q 0x43e87800 deadbeefdeadbeef 1
=> md.q 0x43e87800 1
43e87800: deadbeefdeadbeef
=> load mmc 0:4 $kernel_addr_r Image
44493312 bytes read in 621 ms (68.3 MiB/s)
=> md.q 0x43e87800 1
43e87800: 910fa02190ffef61
```

1. The load reported the **exact right size** — 44,493,312, the byte count of
   the file this repository builds. **A `${filesize}` assertion passes here.**
2. It **did** write the address: the poison is gone, so nothing was skipped.
3. What it wrote is the **previous kernel's** bytes (`early_kvm_mode_cfg+0x10`
   out of the 2026-09-07 08:12 build). The file on eMMC is itself a mixture and
   `load` read it faithfully.

So the size compare is **green on the failure this whole mechanism exists for**.
It is kept because a short read is a different fault and naming it precisely
costs nothing — the checksum alone would say only "wrong" — but it is not the
guard and is never presented as one:

- **At the point of use.** A comment sits directly above the `test "${filesize}"
  != "${kernel_bytes}"` in `boot.cmd`, carrying the transcript and the sentence
  *"Never read a passing size compare as 'the kernel is the right one'; only the
  crc32 -v below says that."*
- **In the build-side guard.** `checkBootDigestGuards` now checks the `crc32 -v`
  **first**, and its refusal says why: *"This is THE guard, not a
  belt-and-braces addition to the size compare."* Dropping the checksum and
  keeping the size compare is a build failure with that sentence attached.
- **In §5.6 and its zh counterpart**, both of which carry the transcript.

**Neither catches** a corruption after the check and before the kernel reads the
page. The window is the `crc32`-to-`booti` gap rather than the whole load. It is
not zero and nothing here pretends it is.

### The recorded values, verified rather than trusted

The brief supplied `crc32 0x5f867ac9` / `0x703d24cf` and said to verify them
rather than trust the line. Done, through **U-Boot's own `crc32`** — the real
kernel loaded from a real FAT slot in the sandbox binary, the same
`load mmc 0:4 … Image` the script makes:

```
44493312 bytes read          IMAGE_FILESIZE=2a6ea00
crc32 for 10000000 ... 12a6e9ff ==> 5f867ac9
290023 bytes read            FDT_FILESIZE=46ce7
crc32 for 20000000 ... 20046ce6 ==> 703d24cf
crc32 -v 0x10000000 ${filesize} 5f867ac9  ->  IMAGE_VERIFY_OK
crc32 -v 0x10000000 ${filesize} 5f867aca  ->  ** ERROR **  (negative control refused)
```

Both match. `${filesize}` also confirms the `%lx` spelling the byte counts are
written in. The negative control matters as much as the match: without it,
"verified" could mean a `crc32 -v` that accepts anything.

### The name carries the slot

I argued the other way and you reaffirmed it, so it is suffixed;
`mos-boot-digest-a.env` / `mos-boot-digest-b.env`, derived from a
`BOOT_DIGEST_ENV_NAME` base by `bootDigestBase`, exactly as `verityEnvBase`
derives the verity trio. The reason is yours and it holds: **a RAUC boot payload
is installed into whichever boot slot is inactive**, so it ships both slots'
files, and a slot-neutral name could not be one of them.

Two things fell out of following the verity precedent exactly, and both are
improvements over what I had:

- **The assembler writes only the slot's own file** (`makeBootSlot`), as it does
  for the verity env, so a factory slot and a RAUC-installed slot do not differ
  in layout. `bundle.ts` writes both, because the payload cannot know its
  destination. The duplication I objected to therefore exists only inside a
  payload, where it is *required* — which is exactly the verity env's situation.
- **The `@SLOT@` spelling put the file back under the existing per-slot filter.**
  My changes to `boards/cx3576/deb/board-cx3576/render.sh` and verify's
  `bspArtefacts()` are reverted: a slot-neutral name was the only reason those
  two shared consumers needed to learn a third category.

`checks-bootchain.test.ts` gains the case the suffix is *for*: slot A carrying a
`mos-boot-digest-b.env` that describes something else must still verify against
its own file, and does. `boot-cx3576.test.ts` refuses an unsuffixed load and a
misderived `BOOT_DIGEST_ENV_B_NAME`.

### The cost, measured where I could and owed where I could not

`crc32` over the real 44,493,312-byte kernel, U-Boot sandbox, this host (Xeon
8581C @ 2.10 GHz), loaded from a FAT slot the way boot.scr loads it:

| | wall |
| --- | --- |
| load + `crc32` of 4 bytes (floor) | 1095, 1283, 1425 ms |
| load + one pass | 1473, 1464, 1462 ms |
| load + ten passes | 2375, 2359, 2370 ms |

The floor is noisy; the ten-pass slope is not. `(2365 − 1466) / 9` ≈ **100 ms
per pass**, ~445 MB/s — `lib/crc32.c` is a portable byte-at-a-time table loop.

**The RK3576 number is NOT measured and is owed.** No board is attached to this
session. It is one line at the U-Boot prompt, and the yardstick is already in
the brief's own transcript — the board reads the same 42 MB off eMMC in
**621 ms**:

```
=> load mmc 0:4 $kernel_addr_r Image     # prints its own ms
=> crc32 $kernel_addr_r $filesize        # time this against the line above
```

**What I did given that I could not measure it**: shipped the checksum
unconditionally, with no runtime switch. A guard that can be turned off will be
off on the machine that needed it. If the board number comes back in seconds
rather than a fraction of one, the answer is not a flag but a narrower check
chosen with the number in hand — and §5.6 says so rather than leaving the next
person to invent a switch.

### Two spellings that are contract, not presentation

- **The byte count is `%lx`.** `do_load` publishes `${filesize}` through
  `env_set_hex`, i.e. `sprintf(str, "%lx", ...)`: lowercase, no `0x`, no leading
  zeros. The comparison is a hush string compare, because hush has no arithmetic
  without `setexpr` and `setexpr` is hexadecimal.
- **The checksum is eight digits, zero-padded, and that is load-bearing.**
  `parse_verify_sum` (`u-boot/common/hash.c`) reads an argument of exactly
  `2 * digest_size` characters as a hex literal and **anything else as the name
  of an environment variable to look up**. A CRC with a zero top byte written as
  six digits would not be compared against the image at all; it would be looked
  up, not found, and refuse a slot that was fine. Roughly 1 build in 256.
  `crc32Hex` pads and `boot-cx3576.test.ts` drives the zero-top case (`62` →
  `0012d20a`).

### `crc32 -v`, and the cost of choosing it

`CONFIG_CMD_CRC32` is `default y` and gives only `crc32 address count [addr]`,
which writes its answer to **memory**. Reading it back needs a byte swap
(`crc32_wd_buf` does `htonl` before the `memcpy`, confirmed in the pinned
source; `setexpr`'s `*addr` does a native load) and an unpadded `%llx`
comparison — two spellings nothing would check. `crc32 -v` compares in one
command, returns the verdict as an exit status hush can branch on, and prints
both values on mismatch.

It needs `CONFIG_CRC32_VERIFY=y`, which is `default n`. **Measured against the
shipped blob**: the previous `uboot-mos` carries `crc32 address count [addr]`
and no `-v`. So:

> **This change is not deployable by a RAUC update alone.** The loader lives in
> raw sectors outside every slot group. A device carrying the previous
> `uboot-mos` that received the new `boot.scr` would read `crc32 -v` as a usage
> error, treat that as a failed verification, and burn **both** slots. The blob
> and the boot payload must be flashed together.

Stated in `boot.cmd`'s header, §5.3 divergence 3, §3.2's note on the symbol, and
the zh overview. `build-mos.sh` enables it and asserts it by name, in the same
list as the `ENV_MMC_*` pins and for a sharper reason: it is `default n`, so it
is exactly what an `olddefconfig` drops.

### Burning the slot is right, including on a first boot

**The burn is not a permanent loss**: `BOOT_<slot>_LEFT 0` is undone by the
script's own refill when both slots reach zero (§4.2). On a factory-flashed
board with `rootfs-b` zero-filled, a refusal on A goes to B, B spends its
credits, the refill returns to A with three. **The guard cannot strand a device
a retry would have saved** — it costs boot cycles. Against that, today's
behaviour for the measured failure is not "retry": it is a `BUG()` in
`paging_init`, hung, no reset, nothing attributing it.

### What the harness measured about itself

Extending `tests/handshake-test/` turned up a fact about the harness that was
wrong before this change, and it is the same defect in miniature.

Its execution model claimed that seeding `kernel_addr_r` above the sandbox's
2048 MiB RAM ended a cycle at the `load ... Image` line with a hard
`os_abort()`. Measured, five ways:

- `load mmc 0:4 0xf0000000 Image` **fails cleanly** —
  `fs_read_lmb_check() ** Reading file would overwrite reserved memory **`,
  `do_load() Failed to load 'Image'` — with and without preceding loads.
- The abort came from the **next line**: `booti 0xf0000000 - …` →
  `phys_to_virt: Cannot map sandbox address f0000000 (SDRAM from 0 to
  80000000)` → core.

The old model worked **only because the script ignored a failed load** and
handed `booti` an address nothing had been written to — the defect RFCT-352
closes. With the guard in place the script refuses that slot and never reaches
`booti`, so the model is no longer expressible. `CONFIG_LMB=n` was tried and
**does not build**: `CMD_BOOTI` is unavailable without LMB (`ERROR:
CONFIG_CMD_BOOTI=y missing from sandbox .config`). LMB stays and is pinned `=y`.

**What that costs, stated rather than papered over.** On sandbox every path in
the guarded script ends in a burn or the refill; nothing can end a cycle by
leaving U-Boot. The **3→2→1→0 decrement trajectory across three resets is no
longer covered anywhere.** Scenario 1 was rewritten around what is reachable and
gained the property that trajectory was really there for:
**decrement-then-save-then-boot** (§4.2), read off the console as two
environment writes per cycle with the first preceding the banner. Failover at
zero, the refill at exhaustion, and the restart at the head of `BOOT_ORDER` all
still hold.

### The harness, before and after

| | before | after |
| --- | --- | --- |
| scenarios | 3 | 7 |
| PASS assertions | 72 | 103 |

The four new scenarios, each carrying exactly one fault:

- **4** — an `Image` of the **right length and the wrong bytes** (30 bytes
  overwritten 2 MiB in): the board failure's shape. Asserts `** ERROR **` from
  `crc32 -v`, the named burn, **that the size half did NOT fire**, and that
  `booti` was never reached. That third assertion is the one that encodes the
  board measurement: it is red if anyone ever makes the size compare look like
  the thing that caught this.
- **5** — a **short** `Image`: the size message with both numbers (`3ff000`
  landed, `400000` recorded) and that the checksum never ran.
- **6** — a slot with **no `mos-boot-digest-a.env`**, its verity env intact.
- **7** — a slot with **no `Image` at all**, covering the `would not load`
  branch that scenario 1's out-of-RAM address used to reach by accident.

Plus the positive control in scenario 3 and every scenario-1 cycle, and two new
anti-vacuity checks for the suffix: slot A carries `mos-boot-digest-a.env` and
**does not** carry `mos-boot-digest-b.env`, so the harness can tell "read the
right file" from "read either file".

The fixture digests are computed with python3's `zlib.crc32` rather than by
calling `build/src/boot-cx3576.ts` — the assembler is the producer this script
has to agree with, and a fixture built by calling it would agree by
construction.

### Guards added on the build side

- `checkBootDigestGuards` joins `checkBootCmd`: per artefact, the `crc32 -v`
  first and the `${filesize}` compare second, each with its own refusal, driven
  from the failing side by deleting each half in turn. Plus the suffixed-name
  requirement, driven by an unsuffixed load.
- `bootDigestBase` ties `BOOT_DIGEST_ENV_NAME` / `_A_NAME` / `_B_NAME` to one
  derivation, the way `verityEnvBase` does for the verity trio.
- `bootDigestEnv` refuses a **zero-length** artefact: `load` of an empty file
  gives `filesize=0` and `crc32` gives `00000000`, so an empty `Image` satisfies
  both assertions exactly.
- The verify register's `boot-digest-<board>-<slot>-<file>` matches the recorded
  digest against the artefact **read back out of the assembled image**, per slot
  per artefact, by **value** rather than by key name so the `kernel_`/`fdt_`
  mapping is not restated where it could drift.

### One thing the guard caught on its own build

Reassembling the image after the rename failed with:

```
error: _out/cx3576/boot/boot.cmd never loads 'mos-boot-digest-${slotsuffix}.env'
```

The assembler compiles `boot.scr` from the **boot export** the board package
shipped, not from the working tree, so a renamed script in the tree and a stale
export in `_out/` is exactly the mismatch it is there to refuse. The pool,
rootfs and image were rebuilt rather than the export patched by hand.

### verify, at 432/432 against an image built from this branch

`bash verify/run.sh --verify --board cx3576` reports **432/432, 3 skipped**,
against an image assembled from this branch, and the six checks this change
adds read the recorded values back out of it:

```
PASS: BOOT-A contains mos-boot-digest-a.env
PASS: BOOT-B contains mos-boot-digest-b.env
PASS: BOOT-A mos-boot-digest-a.env records Image as kernel_bytes=2a6ea00 kernel_crc=5f867ac9, and that is what is in the slot
PASS: BOOT-A mos-boot-digest-a.env records rk3576-src.dtb as fdt_bytes=46ce7 fdt_crc=703d24cf, and that is what is in the slot
PASS: BOOT-B mos-boot-digest-b.env records Image as kernel_bytes=2a6ea00 kernel_crc=5f867ac9, and that is what is in the slot
PASS: BOOT-B mos-boot-digest-b.env records rk3576-src.dtb as fdt_bytes=46ce7 fdt_crc=703d24cf, and that is what is in the slot
```

`kernel_crc=5f867ac9` is the value in the brief, arrived at independently by the
assembler and read back out of the image by the verifier. Each slot carries the
file that names it and not the other one, which is the factory layout the
assembler writes.

The denominator moved **426 -> 432**, +6, all of them this change: 2 x
`boot-slot-file-cx3576-BOOT-{A,B}-mos-boot-digest-<slot>.env` and 4 x
`boot-digest-cx3576-BOOT-{A,B}-{Image,rk3576-src.dtb}`. RFCT-351 read 423/426
because no image on the host carried PLAN-086 S2's exports; this build produces
them, so those three are green here and were never this change's.

### Everything else that was run

- `bash tests/handshake-test/run.sh` -- RESULT: PASS, 103 assertions, 0 fail.
- `bash build/run.sh` -- 950/950. `bash verify/run.sh` -- 1357/1357.
- `make docs-verify` from a `git archive` into an empty directory -- 192 + 488 +
  750 + 243 + 97 PASS.
- `docs/design/uboot-ab-handshake.md` 5.3's code block asserted byte-identical
  to `boards/cx3576/boot.cmd`'s body. It was NOT synced before this task: the
  published block still carried `bootpart 3` / `rootpart 5` and
  `storagemedia=emmc` from before the loader partition landed.
- U-Boot's `crc32` checked against the recorded values on the real kernel, with
  a one-bit-different negative control refused.

### Two self-inflicted rebuilds, recorded because they cost real time

- The image assembler compiles `boot.scr` from the **boot export** the board
  package shipped, not from the working tree, so renaming the digest file made
  `_out/cx3576/boot/boot.cmd` stale and the assembly refused with
  `never loads 'mos-boot-digest-${slotsuffix}.env'`. That refusal is the guard
  working. The pool, rootfs and image were rebuilt rather than the export
  patched by hand.
- The first of those rebuilds died at `rootfs/build.sh` with *"manifest.txt
  carries more than one git stamp"*, because this record was edited while the
  pool build was running: the three producers built before the edit carried the
  clean stamp and the eleven after it carried `.dirty`. The tree must not be
  touched while a pool is being built. Recovered by rebuilding those three
  against the unchanged tree rather than all fourteen.
