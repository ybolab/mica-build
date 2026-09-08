# RFCT-351 cx3576 kernel BUGs in paging_init: export the symbol table and test the toolchain

- **status**: completed
- **priority**: P0
- **owner**: bkd/28bgl1mk
- **createdAt**: 2026-09-08 09:00
- **relatedPlans**: (none)

> The index line in `docs/task/index.md` is written by L1, not by this task.

## Description

The cx3576 kernel dies in `paging_init` on the hardware:

```
kernel BUG at arch/arm64/mm/mmu.c:283!
pc : create_kpti_ng_temp_pgd+0x518/0x604   lr : __create_pgd_mapping+0x6c/0x8c
Call trace: __create_pgd_mapping / map_kernel_segment / paging_init / setup_arch
```

The campaign that measured it ruled the artefacts out at byte level: the Image,
the DTB and the U-Boot in the loader region are the ones this repository built,
the resolved kernel configuration has not moved a paging symbol in a week, the
reproducibility work moved only date strings, and no load address collides.
What is left is the build, and the instrument that would say which part of the
build is missing: `kernel/Dockerfile` exports `Image`, `config`,
`kernel.release`, `modules.tar` and the dtb, and throws `vmlinux` and
`System.map` away with the build stage. Nobody can name the symbol at the
faulting PC.

Two deliverables follow from that, and the second is a hypothesis test rather
than a fix:

- **The symbol table.** Export `System.map` so a register dump off the console
  can be read without the board.
- **The toolchain.** The tree is a Rockchip vendor 6.1 BSP built with the
  GCC 13.3 / binutils 2.42 that `IMAGE_UBUNTU_2404` carries. Find what Armbian
  -- whose tree this is -- builds it with, build it with that, and compare the
  two kernels by LAYOUT: the three `*_pg_dir` symbols, the segment boundaries,
  `_stext` / `_etext` / `_end`. A negative result is a result.

## ActiveForm

Exporting the kernel symbol table, resolving the crash addresses against it,
and testing the toolchain hypothesis by layout comparison

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Acceptance

- `System.map` exported and the two crash addresses resolved by name.
- A stated, evidence-backed answer to whether a `*_pg_dir` symbol overlaps
  `_stext.._etext`.
- The kernel built with the toolchain the tree targets, the two layouts
  compared symbol by symbol, artefacts left where they can be flashed.
- The four reproducibility pins and `kernel/patches/0003` still working.
- `verify/run.sh --verify --board cx3576` at 426/426 or the change explained;
  `make docs-verify` green from a `git archive` into an empty directory.
- `docs/plan/index.md`, `docs/task/index.md` and `docs/changelog.md` untouched.

## Notes

### What the instrument said, within a minute of existing

`System.map` is exported from `kernel/Dockerfile`'s artifact stage. All three
console addresses resolve:

| console | System.map | what it is |
| --- | --- | --- |
| `pc : ...+0x518` = `ffffffc008031da8` | `__create_pgd_mapping_locked+0x518` | the `brk #0x800` of a `BUG_ON` |
| `x19 : ffffffc009e96d20` | `early_pgtable_alloc+0x0` | the `pgtable_alloc` argument, not a page table |
| (derived, see below) `ffffffc009e87000` | `swapper_pg_dir+0x0` | the page table being read |

The `create_kpti_ng_temp_pgd+0x518/0x604` the console printed is the same code:
`create_kpti_ng_temp_pgd` (`T`) and `__create_pgd_mapping_locked` (`t`) share
the address `ffffffc008031890`, GCC's `-fipa-icf` having folded the wrapper into
the function it wraps, and kallsyms prefers the global name. `0x604` is
`__create_pgd_mapping - __create_pgd_mapping_locked` exactly.

**Which BUG_ON.** `arch/arm64/mm/mmu.c:283` at the pinned commit is
`BUG_ON(pud_sect(pud))` in `alloc_init_cont_pmd`. Disassembling the shipped
Image at the PC shows it literally -- `ldr x1,[x7]` / `and x0,x1,#3` /
`cmp x0,#1` / `b.eq` to the trap -- so the value tested is `*pudp`, the register
dump's `x20` holds an earlier load of the same address, and `x7` is the
pointer. Elsewhere in the same function `x7` is tested against the page of a
symbol at `ffffffc009e87000` -- arm64's `in_swapper_pgdir()`, an `adrp`/`eor`/
`cmp #0xfff` triple -- and System.map names that address `swapper_pg_dir`.

So the failure reads, in words: **`swapper_pg_dir[256]` -- the PGD entry for
`_stext` -- held `0x910fa02190ffef61` when `paging_init` first looked at it,
and its low two bits say "section", so the mapping walk refused to continue.**

### The hypothesis, tested and negative

> *Where do `init_pg_dir`, `idmap_pg_dir` and `swapper_pg_dir` land, and does any
> of them overlap `_stext.._etext`?*

**No, and not close.** `_stext.._etext` is `ffffffc008010000..ffffffc0096b0000`.
Every page-table symbol is above `_etext`:

| symbol | address | inside text | offset past `_etext` |
| --- | --- | --- | --- |
| `idmap_pg_dir` | `ffffffc009e84000` | no | +8,208,384 |
| `tramp_pg_dir` | `ffffffc009e85000` | no | +8,212,480 |
| `reserved_pg_dir` | `ffffffc009e86000` | no | +8,216,576 |
| `swapper_pg_dir` | `ffffffc009e87000` | no | +8,220,672 |
| `init_idmap_pg_dir` | `ffffffc009f70000` | no | +9,175,040 |
| `init_pg_dir` | `ffffffc00ab27000` | no | +21,458,944 |

That is exactly where `arch/arm64/kernel/vmlinux.lds.S` puts them at this
commit: the four in one run after `RO_DATA` and `.rodata.text`, `init_pg_dir`
in the zero-init region past `__bss_stop`. Nothing is displaced.

**And a stronger statement than the absence of an overlap.** The 48 KiB from
`idmap_pg_dir` to `__init_begin` is **entirely zero in the shipped Image**, byte
for byte, and it lies inside the file rather than past its end: the file is
`0x2a6ea00` long, which is `_edata - _text` exactly, and `swapper_pg_dir` is at
`0x1e87000`. U-Boot's `load mmc` therefore writes zeros to
**PA `0x43e87000`**, and something changed them before `paging_init` read them.

Three further searches, all negative:

- **The value is in nothing the CURRENT build flashes.** The word `0x90ffef61`
  (the `ADRP` half) occurs in none of the 90 files under the cx3576 BSP outputs
  and sources -- not the Image, not either U-Boot variant, not the vendor
  `MiniLoaderAll.bin`, not the dtb, not the Alpine rootfs. It is
  instruction-shaped but it is not text from anything this build ships. **It is
  text from the PREVIOUS build**, which the section "Whose text it is" below
  identifies by name; that search was over the current artefacts only, and
  widening it to an older assembled image is what found it.
- **The relocator does not write there.** `CONFIG_RELOCATABLE=y`, so `head.S`
  walks 267,504 `R_AARCH64_RELATIVE` entries before `start_kernel`. Parsed out
  of the Image between `__rela_start` and `__rela_end`: **zero** of them have
  an `r_offset` in `[idmap_pg_dir, __init_begin)`.
- **The device tree reserves nothing there.** The dtb's header
  `mem_rsvmap` block is empty (first entry is the `0,0` terminator), so the
  three `/reserved-memory` nodes are the whole reservation set.

### Whose text it is

`0x910fa02190ffef61` **is** kernel text, and the decode was right about that.
It is the wrong kernel's.

The bytes `61 ef ff 90 21 a0 0f 91` occur **exactly once** in the kernel of
`_out/cx3576/cx3576-mos-1788768763.img`, the 2026-09-07 08:12 image, at file
offset **`0x1e87800`** -- which is, to the byte, `swapper_pg_dir[256]` in the
kernel that crashed. Disassembled out of that older Image:

```
ffffffc009e877f0 <early_kvm_mode_cfg>:
ffffffc009e877fc:  a9be7bfd   stp  x29, x30, [sp, #-32]!
ffffffc009e87800:  90ffef61   adrp x1, 0xffffffc009c73000
ffffffc009e87804:  910fa021   add  x1, x1, #0x3e8
```

`early_kvm_mode_cfg+0x10` -- the `kvm-arm.mode=` early-param handler, ordinary
`.init.text`. In the shipped kernel that same function is at
`ffffffc009e977f0`, exactly `0x10000` higher, which is the whole size delta
between the two builds.

**The image in DRAM was not one file.** Two offsets settle it:

| file offset | shipped kernel (`image_size 0x2b30000`) | 08:12 kernel (`0x2b20000`) |
| --- | --- | --- |
| `0x31da8`, the faulting PC | `d4210000` = **`brk #0x800`** | `f90043e3` = `str x3,[sp,#128]` |
| `0x1e87800`, `swapper_pg_dir[256]` | `0000000000000000` | **`61efff9021a00f91`** = `x20` |

The BUG trap that fired exists only in the shipped kernel, so the CPU was
executing shipped bytes at PA `0x42031da8`; the word it read at PA `0x43e87800`
is the older build's. Three more registers say the same from the other
direction -- `x21` is the shipped `_etext` (`ffffffc0096b0000`; the 08:12
kernel's is `ffffffc0096a0000`), `x23` its text size, and `x19` the shipped
`early_pgtable_alloc` at `ffffffc009e96d20`, where the 08:12 kernel has
`free_area_init+0x9d8`.

**It is a hole, not a truncation.** The shipped `paging_init` lives at
`ffffffc009e97080` and ran there with shipped constants -- the 08:12 kernel has
`alloc_large_system_hash+0x1c` at that address -- and `setup_arch` at
`ffffffc009e93fbc` likewise. So content at `0x1e87800` was stale while content
`0x0c7bc` higher was fresh, and so was content 31 MB lower. A short read would
have left everything above one cut stale; this did not.

It is also not a displaced copy of the shipped image: the shipped Image does
not contain that word anywhere, and the same instruction pair in it (at
`0x1e97800`, in the same function) carries *different immediates*
(`d0ffef61 911a4021`) because its target moved. The bytes are the older file's.

**Reproduced from source.** The tree at `c7ce86e5` -- the parent of `abd5e727`,
earliest of the four commits that added `BPF_JIT`, `DM_CRYPT`,
`CRYPTO_AUTHENC` and `CRYPTO_ESSIV` -- rebuilds to `image_size 0x2b20000`,
99.935% of its 4 KiB pages identical to the kernel extracted from that image
(the seven that differ are date strings and the build-id over them; that tree
predates RFCT-320's pins, and its banner says `root@buildkitsandbox`), and
byte-identical at `0x1e87800`.

### `INIT_DIR_SIZE`, closed analytically and then empirically

The early page-table sizing cannot be size-sensitive at 2 MiB on this board.
From `arch/arm64/include/asm/kernel-pgtable.h` at the pinned commit:

```c
#if ARM64_KERNEL_USES_PMD_MAPS                            /* 1: CONFIG_ARM64_4K_PAGES */
#define SWAPPER_PGTABLE_LEVELS  (CONFIG_PGTABLE_LEVELS - 1)   /* 3 - 1 = 2 */
```

`EARLY_PUDS` needs `> 3` levels and `EARLY_PMDS` needs `> 2`, so with 2 both
expand to the literal `0` and `EARLY_PAGES = 1 + EARLY_PGDS`. The only shift
left is `PGDIR_SHIFT = 30`: **1 GiB**. A 2 MiB crossing spends one more of the
512 *entries* in an already-reserved PMD page and cannot cost a page.

| | 08:12 (`_end ffffffc00ab20000`) | shipped (`_end ffffffc00ab30000`) |
| --- | --- | --- |
| `_end` 1 GiB block | same | same |
| `_end` 2 MiB block | same | same |
| `INIT_DIR_SIZE`, computed | `0x2000` | `0x2000` |
| `init_pg_end - init_pg_dir`, linked | `0x2000` | `0x2000` |
| `INIT_IDMAP_DIR_SIZE`, computed | `0x5000` | `0x5000` |
| `init_idmap_pg_end - init_idmap_pg_dir`, linked | `0x5000` | `0x5000` |
| `head.S` `create_kernel_mapping` needs | 2 pages | 2 pages |
| `create_idmap` needs (PA `0x42000000..0x44f30000`) | 2 pages, 3 spare | 2 pages, 3 spare |

Computed and linked agree in both builds. `INIT_DIR_SIZE` first changes at
`image_size 0x38010000` -- the kernel would have to grow **852.9 MiB** from its
current `0x2b30000`.

There is a structural reason as well, which holds whatever the arithmetic says:
`init_idmap_pg_dir` (`ffffffc009f70000`) and `init_pg_dir`
(`ffffffc00ab27000`) are both **above** `swapper_pg_dir`
(`ffffffc009e87000`), by 954 KiB and 13.2 MiB. Early page-table builders fill
forward. An overrun of either runs away from `swapper_pg_dir`, never into it.

### The two kernels, symbol by symbol

Built from `c7ce86e5` with the current Dockerfile plus a throwaway
`System.map` export, outside the repository:

| symbol | shipped | 08:12 | delta |
| --- | --- | --- | --- |
| `_stext` | `ffffffc008010000` | `ffffffc008010000` | 0 |
| `_etext` | `ffffffc0096b0000` | `ffffffc0096a0000` | -65,536 |
| `idmap_pg_dir` | `ffffffc009e84000` | `ffffffc009e71000` | -77,824 |
| `tramp_pg_dir` | `ffffffc009e85000` | `ffffffc009e72000` | -77,824 |
| `reserved_pg_dir` | `ffffffc009e86000` | `ffffffc009e73000` | -77,824 |
| `swapper_pg_dir` | `ffffffc009e87000` | `ffffffc009e74000` | -77,824 |
| `__init_begin` | `ffffffc009e90000` | `ffffffc009e80000` | -65,536 |
| `init_idmap_pg_dir` | `ffffffc009f70000` | `ffffffc009f60000` | -65,536 |
| `init_pg_dir` | `ffffffc00ab27000` | `ffffffc00ab14000` | -77,824 |
| `init_pg_end` | `ffffffc00ab29000` | `ffffffc00ab16000` | -77,824 |
| `_end` | `ffffffc00ab30000` | `ffffffc00ab20000` | -65,536 |

The 64 KiB is in `.text` (`_etext` moves by it). In **both**: no `*_pg_dir` is
inside `_stext.._etext`, and the whole `[idmap_pg_dir, __init_begin)` block is
zero in the Image. The 08:12 kernel's `swapper_pg_dir` is at PA `0x43e74000`,
a different page from the `0x43e87000` that was read.

### The bench test this leaves

At the U-Boot prompt, the boot script's own first line and then one read:

```
load mmc 0:${bootpart} ${kernel_addr_r} Image     # expect 44,493,312 bytes read
md 0x43e87800 2
```

`90ffef61 910fa021` means the load delivered old content and the fault is in
the load path or in DRAM that survived a warm reset; `00000000 00000000` means
the load was right and something between it and `paging_init` wrote there. For
the whole page rather than one word, `md 0x43e87000 16` against the 08:12
kernel's bytes at that offset:

```
43e87000: 52820018 9274fa73 f2bfb7e2 aa1303e4
43e87010: aa1603e1 f2dfffa2 d0ff0d45 52800026
43e87020: 910dc0a5 9786ab98 9b385ae1 aa1303e2
43e87030: 4b170320 eb37c29f 54000089 110006f7
```

`rkdeveloptool rd`, which `make -C boards/cx3576/bsp flash` ends with, is a
warm reset: DDR is not cleared, so a previous boot's image survives a reflash.
A power cycle between flash and boot is worth having in any test that is trying
to establish whether an image boots.

**`boards/cx3576/boot.cmd` has no error check between its three steps.** `load
Image`, `load rk3576-src.dtb` and `booti` run unconditionally in sequence, so a
failed or short load reaches `booti` anyway and the console says nothing about
it. Not changed here: it is the A/B handshake and `tests/handshake-test`
encodes its current shape.

### The toolchain, and what Armbian actually says

Demoted by L1's correction: `kernel/Dockerfile` has started `FROM ubuntu:24.04`
since the initial scaffold (`feb448e7`, 2026-08-17), so GCC 13.3 has built every
cx3576 kernel this repository has produced -- and the 08:12 kernel's own banner
in the flashed image says so directly
(`aarch64-linux-gnu-gcc (Ubuntu 13.3.0-6ubuntu2~24.04.1) 13.3.0, GNU ld ... 2.42`).
Recorded anyway, because the question was asked and the answer is durable.

The reference answer is Armbian's own build configuration, and it does not
name a toolchain version. `config/sources/arm64.conf` sets
`KERNEL_COMPILER="aarch64-linux-gnu-"` -- the *distribution's* cross compiler
inside the build container -- and `config/sources/families/rk35xx.conf` adds
nothing. So the toolchain is whatever `DOCKER_ARMBIAN_BASE_IMAGE` carries. At
the pinned commit's date, 2026-08-18, `lib/functions/host/docker.sh` read:

    declare -g DOCKER_ARMBIAN_BASE_IMAGE="${DOCKER_ARMBIAN_BASE_IMAGE:-"ubuntu:noble"}"

**Ubuntu 24.04. GCC 13.3.0, binutils 2.42 -- the toolchain this repository
already uses**, because `kernel/Dockerfile` builds `FROM ${MOS_IMAGE_UBUNTU_2404}`.
Four days after the commit (`e061b08c`, 2026-08-22) Armbian moved the default
to `debian:trixie`, which is GCC 14.2 -- newer still. There is no older
toolchain this tree targets; the premise that a vendor 6.1 BSP of this vintage
wants GCC 9-11 is not what its publisher builds it with. `IMAGE_UBUNTU_2404` is
already the digest-pinned `IMAGE_` key the acceptance asked for, so
`build-env/images.env` needed no new entry and gained none.

**The falsification was run anyway**, because "the targeted toolchain is the
one we use" is an argument and a layout comparison is a measurement. The same
Dockerfile was built against `ubuntu:22.04` -- GCC 11.4.0, binutils 2.38,
Armbian's own base before 2025-05-14, and the closest real thing to the
suspected "GCC 9-11" -- with `--build-arg MOS_IMAGE_UBUNTU_2404=ubuntu:22.04@sha256:2edbbc...`,
no tree change. It compiles clean:

| symbol | GCC 13.3 | GCC 11.4 | delta |
| --- | --- | --- | --- |
| `_stext` | `ffffffc008010000` | `ffffffc008010000` | 0 |
| `_etext` | `ffffffc0096b0000` | `ffffffc0096d0000` | +131,072 |
| `idmap_pg_dir` | `ffffffc009e84000` | `ffffffc009ea2000` | +122,880 |
| `tramp_pg_dir` | `ffffffc009e85000` | `ffffffc009ea3000` | +122,880 |
| `reserved_pg_dir` | `ffffffc009e86000` | `ffffffc009ea4000` | +122,880 |
| `swapper_pg_dir` | `ffffffc009e87000` | `ffffffc009ea5000` | +122,880 |
| `__init_begin` | `ffffffc009e90000` | `ffffffc009eb0000` | +131,072 |
| `init_pg_dir` | `ffffffc00ab27000` | `ffffffc00ab47000` | +131,072 |
| `_end` | `ffffffc00ab30000` | `ffffffc00ab50000` | +131,072 |

GCC 11.4 emits 128 KiB more text and every later symbol shifts by that or by
the 120 KiB the rodata segment absorbs. **Nothing structural moves.** Under
both toolchains: no `*_pg_dir` is inside `_stext.._etext`, the whole
`[idmap_pg_dir, __init_begin)` block is zero in the Image, `_edata - _text`
equals the file size, and the four page-table pages sit page-aligned in the
same run in the same order. An older toolchain does not move a page table into
text, because the linker script is what places them and it did not change.

**Stated plainly: the toolchain is not the cause, and the build is not the
cause.** The kernel this repository produces places its page tables where 6.1's
linker script says, ships them zeroed, sizes its early page tables to match what
`head.S` writes, and its own relocator does not touch them. What reached the CPU
was a kernel image assembled from two builds -- the shipped one at PA
`0x42031da8`, the 2026-09-07 08:12 one at PA `0x43e87800`. That is a delivery
fault between the boot slot and DRAM. The measurements say the build is
exonerated and name the bytes; they do not say which link of the boot chain
dropped them.

### Reproducibility, unchanged and re-measured

The GCC 13.3 build from this branch is **byte-identical to the shipped one** in
every artifact that existed before it: `Image`, `config`, `kernel.release`,
`modules.tar` and `rk3576-src.dtb` all `cmp`-clean against
`/srv/mos/_out/boards/cx3576/kernel/`, with `Image` at sha256
`72510d5f...ce19c9`. So RFCT-343's four pins and `kernel/patches/0003` still
hold across this change: both builds carry `(mos@mos-build)`, `# SMP
@1577836800` and `BUILD_DATE=Wed Jan  1 00:00:00 UTC 2020`. No hash was
re-recorded because none moved.

### What is NOT exported, and the number behind it

`vmlinux` is 173.7 MiB with this configuration's `CONFIG_DEBUG_INFO=y` --
four times the Image, 26 times `System.map`'s 6.5 MiB -- and it buys line
numbers over a symbol name. `build.sh` now sizes both in the build log so the
ratio is a measurement rather than a memory, and the build stage keeps
`vmlinux` where a cached rebuild reaches it in seconds.

### verify, and why it is 423/426

`bash verify/run.sh --verify --board cx3576` reports **423/426, 3 skipped**,
against the newest cx3576 image that exists on this host
(`cx3576-mos-1788821684.img`, assembled 2026-09-07 22:52). The denominator is
the expected 426. The three failures are all one fact:

    FAIL: the debug export manifest is missing: _out/cx3576/debug/manifest.tsv
    FAIL: this walk has no search space: .../debug/manifest.tsv is not there
    FAIL: the boot export holds no blob: _out/cx3576/boot

Those checks arrived with PLAN-086 S2 (`0940c3fd`, 2026-09-08 00:51), two hours
*after* that image was assembled; no image on this host carries the exports its
contract now requires, and producing one is a full arm64 pool, rootfs and image
rebuild. They are not this change's: the verifier reads the assembled image,
`_out/<board>/`, `boards/*/board.env` and `pkgs/podman/`, and mentions
`boards/cx3576/bsp/kernel/build.sh` in exactly one place, a comment. The
artifacts this change does affect are byte-identical to the ones already in the
image, and the one new file lands in the BSP export, which
`boards/cx3576/deb/board-cx3576/render.sh` stages by name -- a list that does
not contain `System.map`.

Also green: `make docs-verify`, `make os-host-toolchain-lint` (352/352 files,
0 findings), and `docker buildx build --check` on the kernel Dockerfile, whose
warning list is unchanged from HEAD's -- the same single pre-existing
`InvalidDefaultArgInFrom`.

### Artifacts

- `_out/boards/cx3576/kernel/` -- the flashable set, `Image` byte-identical to
  what is on the board, now with `System.map` beside it.
- `_out/experiments/gcc11-jammy/` -- the GCC 11.4 comparison build. Kept for
  the layout table above; it is not a candidate kernel and nothing points at it.
