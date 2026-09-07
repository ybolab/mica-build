# RFCT-343 Make the cx3576 kernel reproducible, and let the image contract read its config

- **status**: completed
- **priority**: P2
- **owner**: bkd/31fp8utl
- **createdAt**: 2026-09-07 14:28

> The index line in `docs/task/index.md` is written by L1, not by this task, and
> this branch does not touch that file, `docs/plan/index.md` or
> `docs/CHANGELOG.md`. RFCT-342's header credits this decision to not running
> `scripts/task-state.sh claim`; that script does not exist in this tree, so the
> reason is simply the ownership rule and not a tool that was declined.

## Description

Two findings in `boards/cx3576/bsp/kernel/Dockerfile`.

**The kernel is not reproducible, and the existing pins are necessary but not
sufficient.** `b10f4b87` (RFCT-320) pinned `KBUILD_BUILD_TIMESTAMP`,
`KBUILD_BUILD_USER` and `KBUILD_BUILD_HOST` citing RFCT-304's measurement, and
never ran the experiment those pins were supposed to close. Run today — two
`docker buildx build --no-cache` of the kernel target, same tree, back to back —
`Image` and `modules.tar` both differ at identical size, while `rk3576-src.dtb`
comes out byte-identical from the same toolchain in the same containers.

**The image contract cannot see this board's kernel config.** x64 exports
`bzImage config kernel.release modules.tar`; cx3576 exports `Image modules.tar
rk3576-src.dtb`. So `verify/src/checks-kernel.ts` reads x64's shipped
`/boot/config-*` and asserts `boards/common/mos-required.fragment`'s `=y` floor
by name, and has nothing to read on cx3576 — which is the 1.0 board. The floor
is enforced there only by the post-`olddefconfig` grep loops in the kernel
Dockerfile, and `tests/netavark-kernel-config-test.sh` reads the *committed*
configs, which are inputs. Both run only when the kernel is built, and
`bsp/out/kernel/` is an input to image assembly rather than something assembling
one rebuilds.

That is not hypothetical: `bsp/out/kernel/Image` sat at its 2026-08-31 build
until 2026-09-07 while the fragment gained dm-crypt (`e1dd3d45`), the
eBPF/firewall/bridge floor (`abd5e727`) and `NF_CONNTRACK_MARK` /
`NF_NAT_MASQUERADE` (`23317128`). Every cx3576 image built in that window
shipped a kernel predating those symbols and no check went red.

## ActiveForm

Pinning what the kernel build still leaves varying, and shipping the resolved
config where the image contract reads it

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Acceptance

- Finding 1: either the kernel is reproducible, proven by the same two-build
  `--no-cache` experiment with the result quoted, or a written diagnosis naming
  what varies and why it cannot be pinned. Evidence that the pins "look right"
  is not evidence.
- Whether x64 is reproducible under the same experiment, stated; a defect shared
  with x64 fixed in both.
- Finding 2: the resolved config exported from the cx3576 kernel build, shipped
  where the image contract can read it, and the fragment floor asserted from the
  image the way x64 does — with the negative shown.
- `bash verify/run.sh --verify --board cx3576` green, and x64 still green.
- `bash tests/netavark-kernel-config-test.sh` green, its header updated if what
  it proves has changed.
- `make docs-verify` green from a `git archive` into an empty directory.

## Notes

### Finding 1: two causes, not one, and the first fix was not enough

The experiment is two `docker buildx build --no-cache` builds of the kernel
target, same tree, back to back. It was run three times: once on the tree as
RFCT-320 left it, once with `SOURCE_DATE_EPOCH` added, and once with the Mali
patch added as well.

**Run 1, the tree as found.** `Image` and `modules.tar` both DIFFER at identical
size; `rk3576-src.dtb` is IDENTICAL. 24 bytes of a 44,493,312-byte `Image`
differ, in two clusters, and all 24 are accounted for:

| Bytes | Offsets | Cause |
|---:|---|---|
| 5 | 29,842,404 / 29,842,407 and 29,851,830 / 29,851,833-4 | Two `__TIME__` sites in the vendor Mali driver — `mali_kernel_linux.c:404` and `:410-411` print `"Compiled: %s, time: %s"`. The two builds read `14:11:33` and `14:21:43`. |
| 19 | 31,961,470-31,961,488 | The GNU build-id ELF note. Read out of the file: `namesz=4 descsz=20 type=3` (`NT_GNU_BUILD_ID`), `a6c76ff6…` vs `a67874a5…`. 19 of its 20 bytes differ; it is a SHA1 **of** the linked image, so it moved because the five above did. |

`modules.tar` was a separate defect with a separate cause: 189 members, **every
member byte-identical**, member order identical, and every tar header carrying
the build's wall clock. A packaging step, not a compile step, exactly as the
brief anticipated.

**Ruled out by the same measurement.** `-j"$(nproc)"` — no differing byte is
attributable to parallelism. `CONFIG_DEBUG_INFO` — named as the biggest
config-level suspect and not implicated; nothing else in the image moved. Both
were reasonable a priori and both are wrong.

**Run 2, with `SOURCE_DATE_EPOCH=1577836800`.** `modules.tar` became IDENTICAL,
`config` and `kernel.release` IDENTICAL, `rk3576-src.dtb` IDENTICAL — and
`Image` **still differed**, again by 24 bytes. One of the two Mali sites was now
correctly pinned (`Jan  1 2020` / `00:00:00` in both builds), which is what
proved `SOURCE_DATE_EPOCH` reaches `__DATE__`/`__TIME__` and that something else
was left. The remaining four bytes were a different string:

```
BUILD_DATE=Mon Sep  7 14:38:57 UTC 2026     (build a)
BUILD_DATE=Mon Sep  7 14:55:18 UTC 2026     (build b)
```

`drivers/gpu/arm/mali400/mali/Kbuild:234` — `VERSION_STRINGS += BUILD_DATE=$(shell date)`.
A **make-time shell call**, which no compiler variable and no `KBUILD_BUILD_*`
can reach. `kernel/patches/0003-mali-deterministic-build-date.patch` takes it
from `SOURCE_DATE_EPOCH` instead.

The same Kbuild passes `-Wno-date-time` at line 194, which is why this driver's
`__DATE__`/`__TIME__` compile at all under a top-level Kbuild that sets
`-Werror=date-time`. That one flag is the reason a vendor tree could carry three
wall-clock sources that mainline forbids.

**Why one patch is enough, enumerated rather than inferred.** A same-day
experiment cannot see a date-only string, so the pinned tree was searched whole
rather than trusting that a pair matched:

- `$(shell date` across every `Makefile`, `Kbuild` and `*.mk`: **one** hit, the
  line patched above.
- `__DATE__`/`__TIME__` across every `.c`, `.h` and `.S`: twenty files — this
  driver, its `ump`/`umplock` siblings, an nvp6158 tuner, a goodix tool,
  `bcmdhd` (which this board disables), `acpica`, and thirteen AMD GPU register
  headers. All twenty are cpp macros, so `SOURCE_DATE_EPOCH` covers them whether
  or not this config compiles them.

**Run 3, with `SOURCE_DATE_EPOCH` and patch 0003.** Two `--no-cache` builds,
11m30s and 10m48s, the second starting the moment the first finished so their
wall clocks differ by eleven minutes and their host load differed (an unrelated
image build was running through the second):

| Artifact | Result | size | sha256 |
|---|---|---:|---|
| `Image` | **IDENTICAL** | 44,493,312 | `72510d5fb154d36b39b6322957d20b7fadc0d113a02ba779780dccce22ce19c9` |
| `config` | **IDENTICAL** | 227,622 | `5f4395802419ebbc70e2d5a2f78ef3d3d93f1234b11c929c5b68f7ed20616bc3` |
| `kernel.release` | **IDENTICAL** | 8 | `157ec590c0eeaa193c9f22b60379c343d9b60e12adf52db15932995c4001444e` |
| `modules.tar` | **IDENTICAL** | 5,529,600 | `4222947791e03311954f0a35ec2e5b96b1617ab06ba8f5e5ebceb97b93fa08f1` |
| `rk3576-src.dtb` | **IDENTICAL** | 290,023 | `9c9979092f1e7cb8524e8989e71862fe48fb03d1f0016f23e0c1bf1e0ea1fcac` |

The cx3576 kernel is byte-reproducible.

### x64: the control, and the tar half measured rather than inferred

`tar -C /kmods -cf /modules.tar lib` was character-for-character identical in
`boards/x64/bsp/kernel/Dockerfile` and `boards/virt-arm64/bsp/kernel/Dockerfile`,
so the defect is shared by inspection. It is also shared by measurement, which
matters because an identical line is an argument and not a result. The x64
`modules.tar` in the main checkout, built on 2026-09-04 with the old line:

```
drwxr-xr-x root/root  0 2026-09-04 18:56 lib/
-rw-r--r-- root/root  493 2026-09-04 18:56 lib/modules/6.12.107/modules.alias
```

and the same archive from this branch:

```
drwxr-xr-x 0/0  0 2020-01-01 00:00 lib/
drwxr-xr-x 0/0  0 2020-01-01 00:00 lib/modules/6.12.107/kernel/
```

The wall clock and the owner NAMES are both gone, and the member order changed
as well — `--sort=name` displacing readdir order, which is the half of the fix
that the cx3576 pair could not have detected because its two runs happened to
enumerate in the same order.

**The x64 pair, run under the same `--no-cache` experiment:**

| Artifact | Result | size | sha256 |
|---|---|---:|---|
| `bzImage` | **IDENTICAL** | 14,980,096 | `a5ba8494…` |
| `config` | **IDENTICAL** | 152,911 | `a3429cab…` |
| `kernel.release` | **IDENTICAL** | 9 | `de1f03e3…` |
| `modules.tar` | **IDENTICAL** | 286,720 | `641f18b4…` |

So x64 is fully reproducible. Its `bzImage` needed nothing: mainline sets
`-Werror=date-time`, so no in-tree file can embed `__DATE__`, and mainline has
no vendor Kbuild calling `$(shell date)`. That is the whole difference between
the two Dockerfiles, and it is why the `Image` half of this finding is cx3576's
alone while the `modules.tar` half belongs to all three boards.

Stated precisely, because the two halves have different evidence: cx3576 was
measured before AND after the fix; x64's pre-fix defect was measured from its
committed artefact's tar headers, and its post-fix state from a full pair.
virt-arm64 was fixed by the same edit and not separately measured — it has no
image in this tree to verify against and its kernel Dockerfile is x64's shape.

### Finding 2: the contract had nothing to read, confirmed off the artefact

The premise was verified against the real image rather than argued: the packed
root of the cx3576 image that verified **418/418 on 2026-09-07** carries an
**entirely empty `/boot`** and no `config-*` anywhere in the tree, while
`/usr/lib/modules/6.1.115` is present. So `kernel-config-floor-built-in` could
not have run there, and the fragment floor was enforced for this board only by
the post-`olddefconfig` greps in the kernel Dockerfile — which run when the
KERNEL is built, and `bsp/out/kernel/` is an input to image assembly.

The chain now: the kernel build exports `/ksrc/.config` as `config` and writes
`kernel.release`; `render.sh` stages both under `require_bsp`, so an `out/kernel`
predating this change is a refusal naming `make -C boards/cx3576/bsp kernel`
rather than a package quietly missing the file; the board package installs
`/boot/config-<release>`, refuses a `modules.tar` that does not unpack to
`lib/modules/<release>` (so a config and a module tree from different builds of
`out/kernel` cannot be packed together), and re-asserts the six-symbol
no-initramfs boot floor over the bytes being packed. Measured on the built
package: `/boot/config-6.1.115`, 7899 lines, beside 157 modules.

`verify/src/checks-kernel.ts`'s config check **lost its `boards:` list entirely**
rather than gaining a second name. x64 and virt-arm64 already shipped
`/boot/config-*`; cx3576 now does too, so all three shipped boards have one and
a list would be a thing to edit for a fourth board. The modprobe check keeps
`boards: ['x64']`, deliberately: its dependency walk covers the whole of
`modules.dep`, which is four entries on x64 and a vendor tree's worth here, and
extending it is a judgement about this board's module tree with its own
measurement to do.

All 39 symbols the contract requires are `=y` in the freshly exported config,
including the three the stale kernel predated — `DM_CRYPT`, `NF_CONNTRACK_MARK`
and `NF_NAT_MASQUERADE`.

### The negative, and two wrong ways of getting it

`bash verify/run.sh --verify --board cx3576` on the assembled image:
**`RESULT: PASS (419/419 checks, 3 skipped)`**, against 418/419 before this
change — the one new conclusion is the config check, and it quotes the real
`/boot/config-6.1.115`.

For the negative, `CONFIG_DM_CRYPT=y` was removed from the config the BSP
exports and the whole chain rebuilt: package, pool index, rootfs, image. It is
chosen because it is NOT one of the six symbols the board package's own
pack-time floor asserts, so the package builds green and the defect reaches the
image — which is exactly the case the image contract exists for.

```
FAIL: the shipped kernel config does not build in CONFIG_DM_CRYPT as =y in
/boot/config-6.1.115: CONFIG_BLK_DEV_DM=y, CONFIG_DM_INIT=y, CONFIG_DM_VERITY=y,
CONFIG_SQUASHFS=y, CONFIG_OVERLAY_FS=y,
CONFIG_DM_CRYPT (no such line; absent or "is not set"), ...
RESULT: FAIL (418/419 checks, 3 skipped)
```

One check red and 418 still green, so the mutation moved the conclusion it was
aimed at and nothing else.

**Two earlier attempts were wrong and both looked green.** Recorded because the
green was the problem, not the red:

1. Mutating the verifier's cached unpacked root under `_out/verify/cx3576/`.
   `--work` is documented as "emptied at the start of every run", so the
   re-extraction overwrote the edit before any check read it and the run
   returned 419/419. A negative that cannot fail is not evidence.
2. Rebuilding the board package without re-running `build-env/deb/repo.sh`.
   `SHA256SUMS` and the pool came apart, the rootfs build refused — correctly —
   and the script then fell through to `build/run.sh --mkimage-cx3576`, which
   reused the PREVIOUS `rootfs-verity.img`. The image looked rebuilt, carried
   the old good config, and would have verified green over a mutation it did
   not contain.

### U-Boot was not reproducible either, and nothing had been pinned

The user's request named the kernel **and** U-Boot. U-Boot was never in this
task's two findings, so it was measured rather than assumed — read straight out
of the binaries the tree was shipping:

```
uboot      U-Boot 2026.07-gece349ade297-dirty (Aug 25 2026 - 18:35:45 +0000)
uboot-mos  U-Boot 2026.07-gece349ade297-dirty (Aug 30 2026 - 16:29:48 +0000)
```

`boards/cx3576/bsp/uboot/Dockerfile` pinned **none** of `SOURCE_DATE_EPOCH` or
`KBUILD_BUILD_*` — the kernel Dockerfile at least had three. So every boot blob
carried the wall clock of whenever it happened to be compiled, and no comparison
of a shipped U-Boot against its source could have been a byte comparison.

U-Boot reads `SOURCE_DATE_EPOCH` for exactly this. One `ENV` line, and four
independent `--no-cache` builds (two passes × two variants):

| Artifact | Result | size | sha256 |
|---|---|---:|---|
| `uboot/u-boot-rockchip.bin` | **IDENTICAL** | 9,440,256 | `83c28e92…` |
| `uboot/u-boot-spl.bin` | **IDENTICAL** | 120,790 | `fe295d51…` |
| `uboot/u-boot.itb` | **IDENTICAL** | 1,084,416 | `8f162ef5…` |
| `uboot-mos/u-boot-rockchip.bin` | **IDENTICAL** | 9,447,424 | `989f4c00…` |
| `uboot-mos/u-boot-spl.bin` | **IDENTICAL** | 120,790 | `fe295d51…` |
| `uboot-mos/u-boot.itb` | **IDENTICAL** | 1,091,584 | `98f01757…` |

```
U-Boot 2026.07-gece349ade297-dirty (Jan 01 2020 - 00:00:00 +0000)
```

`-dirty` stays and is not a defect: the patch series is applied to the fetched
tree without committing, so `git describe` says dirty on every build. It is the
same word every time, which is all reproducibility asks of it. The SPL is
byte-identical between the two variants, which is expected — they differ only in
the U-Boot proper configuration.

### The BSP outputs moved under `_out/` (added by the user mid-task)

`boards/<board>/bsp/out/` is now `_out/boards/<board>/`, **on all three boards**.
The user named cx3576; doing only that board would leave two conventions in one
tree, and the widening is stated here rather than treated as implied.

**One variable became two, and that is the substance of the change rather than
a side effect.** `BOARD_DIR` meant both "the bsp source tree" (committed vendor
firmware, `containers.env`, the Makefile) and "where the build put its
artefacts". Pointing it at a prebuilt tree therefore also repointed the
firmware. Now `BOARD_DIR` is the source directory and **`BSP_OUT`** is the
output directory, defaulting to `_out/boards/<board>`. The old
`BOARD_DIR=/path/to/bsp` spelling for reusing artefacts is **retired, not
aliased** — no compatibility shims during development — so recorded invocations
in `rootfs/README.md`, `docs/design/build.md` and its Chinese mirror were
rewritten to `BSP_OUT=/srv/mos/_out/boards/cx3576`.

**Two couplings that a path-substitution sweep would have missed:**

- `render.sh`'s `bsp_target_for()` does not know the make targets; it **greps
  the BSP Makefile's literal text** for `-o out/<subdir> ` to name the command
  in its refusal. The Makefile now writes `-o $(BSP_OUT)/<subdir>`, so the awk
  pattern moved with it, unexpanded. Checked directly: `kernel`, `uboot` and
  `uboot-mos` all still resolve, and the trailing space is still what stops
  `uboot` matching the `uboot-mos` recipe.
- `boards/x64/deb/kernel-x64/stage.sh` and its virt-arm64 twin deliberately read
  **no** path variable — their own comment explains that one global honoured by
  several producers makes `BOARD_DIR=<a cx3576 tree>` mean two things in one
  run, which `tests/deb-preflight-test.sh` does while driving the aggregate.
  A first pass had them read `BSP_OUT`, reintroducing exactly that; they derive
  the repository root from their own location instead. (The first pass also
  referenced a `REPO_ROOT` that does not exist in those scripts, which `set -u`
  would have turned into a run-time failure.)

`tests/deb-preflight-test.sh` needed real work rather than a rename: it derives
what to assert from the hook's own report by matching paths under a fixture
directory. With one fixture it would have captured only the firmware half and
read the kernel half from the real `_out/`, so it would have **passed on a
machine that had built a kernel and failed on one that had not**. It now sets
both `BOARD_DIR` and `BSP_OUT` to separate fixtures. A1 demands 11 inputs across
the two; the suite is 23/23.

`.gitignore`: `boards/*/bsp/out/` is **removed rather than tombstoned**, and the
file now says why. The two tombstones it keeps (`pkgs/*/.devkeys/`, `/ca/`)
exist because a stale directory at either path holds a private key that
`git add -A` could publish. A stale BSP output holds a kernel image and a U-Boot
binary, and the first line's bare `out/` still matches a directory of that name
at any depth — verified both ways: a leftover `boards/<b>/bsp/out/probe` is
still ignored, by `.gitignore:1`, and `_out/boards/cx3576/kernel/Image` by
`.gitignore:2`. Three nested single-line `boards/*/bsp/.gitignore` files went
with it.

### The patch extraction, and what is NOT extracted

The user asked for the inline scripts and patches to move into files. **The
patch half is done; the script half is not, and the reason is an ordering
argument rather than a shortage of time.**

Done: the kernel Dockerfile's last edit-the-source-with-a-shell-redirection is
gone. `echo 'dtb-$(CONFIG_ARCH_ROCKCHIP) += rk3576-cx3576z.dtb' >>
arch/arm64/boot/dts/rockchip/Makefile`, run between two build steps, is now
`kernel/patches/0004`. It is applied by the same series, with the same reject
handling, counted by the same series-length assertion (2 -> 4, with 0003), and
its effect is grepped in the compiled tree beside the other three. The `.dts`
COPY moved up beside the patches so the tree is coherent from the moment 0004
names the file. Both new patches were checked against the real pinned sources
with `git apply --check` before any build.

The control, because a refactor of a build is only as good as the comparison
that follows it: **one `--no-cache` build after the change, against the hashes
recorded above.**

```
Image           UNCHANGED 72510d5fb154d36b39b6322957d20b7fadc0d113a02ba779780dccce22ce19c9
config          UNCHANGED 5f4395802419ebbc70e2d5a2f78ef3d3d93f1234b11c929c5b68f7ed20616bc3
kernel.release  UNCHANGED 157ec590c0eeaa193c9f22b60379c343d9b60e12adf52db15932995c4001444e
modules.tar     UNCHANGED 4222947791e03311954f0a35ec2e5b96b1617ab06ba8f5e5ebceb97b93fa08f1
rk3576-src.dtb  UNCHANGED 9c9979092f1e7cb8524e8989e71862fe48fb03d1f0016f23e0c1bf1e0ea1fcac
```

Including the dtb, which is the one the placement change could have moved.

**Not done: the script extraction** — `scripts/install-deps.sh`,
`scripts/fetch-source.sh`, `scripts/apply-patches.sh`, `kernel/build.sh`,
`uboot/build.sh`, the config fragments and `patches/series`, as
`docs/plan/PLAN-087.md` section 4 specifies them. It is left rather than half
done, and the ordering is the point: **that refactor is only verifiable against
a byte-identity control, and until this task there was none for either
component.** The kernel was not reproducible and U-Boot was not reproducible, so
"the extraction changed nothing" was an unfalsifiable claim about both. It is
falsifiable now — five kernel hashes and six U-Boot hashes, all recorded above —
so the next session can move a build step into a script and be told
immediately if it changed what is compiled. Doing the extraction first would
have meant refactoring two builds whose output nobody could compare, which is
the wrong order and the reason it is not started here.

### The move needs each machine to move or rebuild its artefacts

`_out/boards/<board>/` is a build product, so nothing in git carries it and
every existing checkout still has its BSP outputs at `boards/<board>/bsp/out/`.
The first run after this change therefore sees them as absent until they are
moved or rebuilt. L1's battery hit exactly that: on a checkout that had built
x64's and virt-arm64's kernels into the old location, `deb-preflight-test.sh`
reported eight missing inputs and F1 went red.

Moving them is enough and takes no build:

```sh
mkdir -p _out/boards
for b in cx3576 x64 virt-arm64; do
    [ -d "boards/$b/bsp/out" ] && mv "boards/$b/bsp/out" "_out/boards/$b"
done
```

### `deb-preflight-test.sh` F1 asserted a host state, not the code

L1's battery found this and it is the class named in this record's own negative
section: **a green that was measuring the machine.** F1 demanded `exit 0`
outright while comparing the missing count against a BASELINE that can be
non-zero. The pre-flight exits non-zero whenever anything is missing, so
`PF_RC -eq 0` silently required `BASE_MISSING` to be 0 -- true only on a host
that has built every board's BSP. The counts agreed exactly and only the status
differed, which reads as a defect in the code under test and is not one.

**The assumption predates this task**: the same `[ "${PF_RC}" -eq 0 ]` is at
line 522 of `11dbaea6`. What the move changed is WHICH hosts trip it, by
relocating the path whose absence sets the baseline -- so it surfaced now and on
every checkout at once.

**Why section A's fixture route does not fix it.** `BOARD_DIR` and `BSP_OUT`
redirect the board-cx3576 producer and A2 fills both. They cannot redirect
`boards/{x64,virt-arm64}/deb/kernel-*/stage.sh`, which read
`${REPO_ROOT}/_out/boards/<board>/kernel` and honour no variable ON PURPOSE --
one global read by several producers would make `BOARD_DIR=<a cx3576 tree>` mean
two things in the aggregate run this file drives, which is the property those
hooks' own comments protect. Those inputs are host state no fixture can supply.

F1 now asserts the delta it can assert anywhere -- warnings do not CHANGE the
exit code, the warned count is 14 absolutely, and warnings are not counted among
the missing -- and additionally demands `exit 0` on a host whose baseline is
green, so nothing is lost where it can be checked. Verified in both host states,
reproducing L1's exactly (8 missing of 80, exit 1).

**And mutated, because a test that was measuring the host might now be measuring
nothing.** `WARNED_N` accumulated into `MISSING_N` reddens F1 on both hosts;
`exit 1` when `WARNED_N > 0` reddens it on a complete host and **not** on a
partial one -- on a host where something is genuinely missing, no observation of
this exit code can show that warnings alone would have been green. That gap is
irreducible and is written into the file, because a green F1 on a partial host
and a green F1 on a complete one do not mean the same thing.

### Considered and scoped out: binding `bsp/out/` to its inputs

A stamp over the kernel build's inputs (patches, config, fragment,
`KERNEL_COMMIT`) written by the build and checked by `render.sh` would make any
stale `bsp/out/` a refusal. It is not done here, for two reasons. It refuses on
input changes that cannot affect the output — a comment edit in the Dockerfile
would cost an 11-minute rebuild — and the consequence that actually matters, a
shipped kernel missing a floor symbol, is now a red image-contract check that
names the symbol. The earlier refusal would be strictly better placed and is a
separate change; `docs/plan/PLAN-087.md` records it as an alternative rather
than leaving it unstated.
