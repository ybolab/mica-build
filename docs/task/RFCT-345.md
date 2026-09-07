# RFCT-345 Extract the inline scripts and patches out of the cx3576 BSP Dockerfiles

- **status**: in-progress
- **priority**: P2
- **owner**: bkd/zj256dt3
- **createdAt**: 2026-09-07 20:30

> The index line in `docs/task/index.md` is written by L1, not by this task.

## Description

`docs/plan/PLAN-087.md` section 4. `boards/cx3576/bsp/kernel/Dockerfile` was 253
lines and `boards/cx3576/bsp/uboot/Dockerfile` 255, and most of both was shell:
dependency installation, source fetching, patch application, kconfig
manipulation, the post-`olddefconfig` grep loops that enforce the shared floor,
the compile, the packaging and the assertions. One of the two remaining
edit-the-source-with-a-shell-redirection steps was still there -- U-Boot's
`printf ... >> "$DTSFILE"`, which appended an `adc-keys` node to a vendor `.dts`
found by grepping `CONFIG_DEFAULT_DEVICE_TREE` out of the resolved `.config`.

RFCT-343 deliberately left this undone and said why: the extraction is only
verifiable against a byte-identity control, and until that task there was none
for either component. Both are byte-reproducible as of `2707ade9`, so
"the extraction changed nothing" is now falsifiable -- and falsifying it is the
whole acceptance criterion here.

## ActiveForm

Moving the cx3576 BSP build steps out of the Dockerfiles into files, against a
byte-identity control

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Acceptance

- The extraction, with the Dockerfiles reduced to orchestration and the logic in
  files a reader can open on its own.
- All eleven BSP artefacts byte-identical to the pre-extraction control, proven
  by `--no-cache` builds with the hashes quoted. Nothing substitutes for this.
- `bash verify/run.sh --verify --board cx3576` 419/419.
- `bash tests/deb-preflight-test.sh` 23/23, with the host state it ran in stated.
- `make docs-verify` green from a `git archive` into an empty directory.
- `docs/plan/PLAN-087.md` and this record with status heads that match reality.

## Notes

### The control

Taken from `_out/boards/cx3576/` in the main checkout at `2707ade9` before any
edit, and copied outside the repository so that a concurrent build could not move
it underneath this task.

```
kernel/config             5f4395802419ebbc70e2d5a2f78ef3d3d93f1234b11c929c5b68f7ed20616bc3
kernel/Image              72510d5fb154d36b39b6322957d20b7fadc0d113a02ba779780dccce22ce19c9
kernel/kernel.release     157ec590c0eeaa193c9f22b60379c343d9b60e12adf52db15932995c4001444e
kernel/modules.tar        4222947791e03311954f0a35ec2e5b96b1617ab06ba8f5e5ebceb97b93fa08f1
kernel/rk3576-src.dtb     9c9979092f1e7cb8524e8989e71862fe48fb03d1f0016f23e0c1bf1e0ea1fcac
uboot/u-boot-rockchip.bin 83c28e92329c8ebe4d7dbc5e99ce009fa962e66fce165660855f4017c0cf9aa5
uboot/u-boot-spl.bin      fe295d51f37c50f0336f6b6330c4f7f1a0b2754f34dc1296cd1c36a9c2b57f52
uboot/u-boot.itb          8f162ef50f5ac404509554c83d53e9ca196bf8f1b93d4a9ccca8e5ceafd08b32
uboot-mos/u-boot-rockchip.bin 989f4c0035428ab0cc2942d11c3a6a8149104e1881ed902d3dcbb7cad2d23065
uboot-mos/u-boot-spl.bin      fe295d51f37c50f0336f6b6330c4f7f1a0b2754f34dc1296cd1c36a9c2b57f52
uboot-mos/u-boot.itb          98f01757cfcb277ec9e30e5569c2153a34f71b78ac5b25031c43f97f36460005
```

The two variants sharing one `u-boot-spl.bin` is a property of the tree, not a
copying mistake: the mos stage's `scripts/config` run touches no symbol the SPL
carries.

### What moved where

```
boards/cx3576/bsp/scripts/apt-install.sh      shared: apt-get update/install/clean
boards/cx3576/bsp/scripts/fetch-source.sh     shared: git init + fetch <sha> + prove HEAD
boards/cx3576/bsp/scripts/apply-patches.sh    shared: series-driven patch application
boards/cx3576/bsp/kernel/configure.sh         kconfig, the fragment merge, both floors
boards/cx3576/bsp/kernel/build.sh             compile, per-patch assertions, packaging, dtb
boards/cx3576/bsp/kernel/patches/series       the four kernel patches, in order
boards/cx3576/bsp/uboot/build.sh              debug variant: defconfig, config, build, asserts
boards/cx3576/bsp/uboot/build-mos.sh          mos A/B variant: reconfigure and rebuild
boards/cx3576/bsp/uboot/patches/series        seven U-Boot patches, in order
boards/cx3576/bsp/uboot/patches/0007-...      the adc-keys append, as a patch
```

253 + 255 lines of Dockerfile became 127 + 97, and what is left in them is the
base image, the pinned commits, the reproducibility `ENV` pins and the artifact
stages.

### The U-Boot device-tree append is now `patches/0007`

The old step ran between `make ${BOARD}_defconfig` and `make`, resolved the file
by `find dts arch -name "${DTSNAME}.dts" | head -1`, and appended twenty-one
lines with `printf >>`. Two things about it were worth removing beyond the
obvious: the `find` searched `dts/` before `arch/`, and U-Boot carries a
`dts/upstream/` import, so a future rebase that added an upstream
`rk3576-generic.dts` would have silently redirected the append to a file the
build does not compile. Measured on the pinned tree -- `find` yields exactly one
candidate, `arch/arm/dts/rk3576-generic.dts` -- which is what made the conversion
safe today and is precisely the guarantee a patch makes permanent.

The patch body was not hand-written. It was generated by running the Dockerfile's
own `printf` block, extracted verbatim from the file, against the pinned U-Boot
tree with 0001-0006 applied, and taking `git diff`. It is applied last, because
0005 and 0006 edit the same `.dts` and this appends to the end of it.

### `series` replaces the length assertion, and is strictly stronger

Both Dockerfiles asserted `count=$(ls /patches/*.patch | wc -l)` against a
hard-coded number. That pinned the LENGTH only. `scripts/apply-patches.sh`
requires the series to be non-empty, every entry to exist, and every `*.patch`
in the directory to be named in it. The third is the one the count could be
talked out of: "add the patch, bump the count" was a green way to ship a patch
that is never applied.

### One pipeline had to be rewritten, and it is a real defect rather than style

The U-Boot Dockerfile asserted patch 0004's effect with

```
grep -A4 'status = usb_add_function' drivers/usb/gadget/f_rockusb.c | \
    grep -q 'free(f_rkusb->write_cache)'
```

`grep -q` exits at the first match and closes the pipe, so under
`set -o pipefail` the pipeline reports FAILURE precisely when the pattern is
FOUND. It was dormant inside a `RUN`, where `/bin/sh` runs without `pipefail`;
moving it into a `set -euo pipefail` script would have inverted it. It is
`| grep -c ... >/dev/null` in `uboot/build.sh`, which is the form
`tests/shell-pipefail-lint.sh` names -- and that lint only reads `*.sh`, which is
why the Dockerfile carried the shape for as long as it did.

### `tests/netavark-kernel-config-test.sh` followed the loop

Its assertion 2 reads each board's post-`olddefconfig` gate out of a named file:
that the file mentions `mos-required.fragment`, and the text of its
`for option in ... ; do` loop. For cx3576 that file is now
`kernel/configure.sh`, so the row moved and `BOARD_DOCKERFILES` became
`BOARD_CONFIG_GATES` -- x64 and virt-arm64 still name their Dockerfiles. The
loop's shape is a contract with that test and is preserved verbatim; the header
now says so at the loop. Left pointing at the Dockerfile the test would have
refused by name rather than passing vacuously, which is the behaviour that
matters and is why this was a one-line move rather than a redesign.

### `bsp_target_for` still resolves all three targets

`boards/cx3576/deb/board-cx3576/render.sh` names the command that builds a
missing BSP artefact by grepping the BSP Makefile for the literal, unexpanded
text `-o $(BSP_OUT)/<subdir> `. The two U-Boot recipes gained
`--build-context bsp-scripts=scripts` before that text, which the pattern does
not read. Checked directly rather than assumed:

```
kernel     -> kernel
uboot      -> uboot
uboot-mos  -> uboot-mos
```

`uboot` still does not match the `uboot-mos` recipe; the trailing space is what
separates them and it is still there.

### Where PLAN-087 section 4 was not followed, and why

- **No config fragments.** RFCT-343's restatement of the draft's file list names
  "the config fragments" beside the scripts; section 4's own text does not, and
  they are not done here. Turning `scripts/config --disable WL_ROCKCHIP ...` into
  a fragment merged by `merge_config.sh` is not an extraction: it changes the
  route by which the `.config` is produced, and that `.config` is one of the
  eleven artefacts under control. It is a separable change and it needs its own
  byte comparison, which is exactly the argument RFCT-343 made for not doing
  the whole extraction before there was a control.
- **`apt-install.sh`, not `install-deps.sh`.** The draft's name promises
  dependency installation in general; both BSP builders are Ubuntu and the
  script is three apt commands. A name that promised more would be a promise the
  file does not keep.
- **The package lists stay in the Dockerfiles.** They are what each builder IS,
  and they belong beside the `FROM` that says which image they are installed
  into. What is shared is the step.
- **The two `patch` appliers were not unified.** The kernel series applies with
  GNU `patch -p1` and the U-Boot series with `git apply`; the applier is an
  argument to the shared script. `patch` applies with a default fuzz of 2 and
  `git apply` does not, so switching either one is a change to what is compiled
  and needs the same byte comparison. Whether either series would also apply
  under the other tool was not measured.
- **The U-Boot stage restructuring of section 5 is still deferred**, untouched.
