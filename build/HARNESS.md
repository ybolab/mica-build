# The build harness

`build/run.sh` is the single entry point. It finds bun — on the host, or
failing that in the container pinned as `IMAGE_BUN_1` — asserts a docker client
that can reach a daemon, installs the dev dependencies if `node_modules/` is
absent, typechecks `src/`, runs the step the mode asks for, and then checks that
step actually ran.

    make os-build-test                        # the whole suite
    bash build/run.sh --help
    bash build/run.sh src/geometry.test.ts # extra arguments go to `bun test`
    bash build/run.sh -t "sgdisk"
    bash build/run.sh --build-rootfs       # the rootfs stage chain
    bash build/run.sh --mkimage-cx3576         # assemble the cx3576 image
    bash build/run.sh --mkimage-uefi --board x64        # assemble the x64 image
    bash build/run.sh --bundle             # build and sign the RAUC bundle

---

## 1. The modes

Each mode is recognised only in first position, so none can be mistaken for a
`bun test` filter. `bash build/run.sh filter --mkimage-uefi --board x64` exits 1 by name.

| mode | what it runs |
|---|---|
| *(none)* | the suite |
| `--build-rootfs` | the numbered-Dockerfile driver, pointed at `rootfs/compose/` — `10-compose` then `90-pack`, the second `FROM` the local image tag the first was written to. `rootfs/build.sh` calls it with the build arguments it computed |
| `--mkimage-cx3576` | the cx3576 image assembler |
| `--mkimage-uefi --board x64` | the x64 image assembler |
| `--bundle [--board NAME]` | the RAUC update bundle, built and signed |

The two assemblers are separate arms rather than one arm taking a board, because
they share a board format and a slot model and nothing else: one writes a U-Boot
loader at a fixed sector and the other builds a standalone EFI binary, and a
mistake in either would otherwise be a mistake in both. `--bundle` *does* take a
board, because its two branches differ only in what a boot slot holds, and that
is a board fact.

Docker is this package's requirement either way. The suite drives the real
external toolset — sgdisk, mtools, dd, mkimage, veritysetup, e2fsprogs and rauc
— each on the host when the host has it, and in the container pinned for that
toolset otherwise. There is no third route and nothing is skipped: a tool that
can be reached neither way is a failure, not a gap.

| variable | effect |
|---|---|
| `MOS_BUILD_BUN` | the bun binary to use, instead of searching `PATH` and `~/.bun` |
| `MOS_BUILD_CONTAINER=1` | the pinned bun container even where a host bun exists — how the two routes are compared on one host |
| `MOS_BUILD_DOCKER` | the docker CLI to use, instead of searching `PATH` |

`MOS_BUILD_BUN` and `MOS_BUILD_CONTAINER` together are refused: those are two
different buns.

## 2. What it costs

Per-operation, which is where the design decisions came from:

| | |
|---|---|
| `Toolbox.open`, host route | ~4 ms |
| `Toolbox.open`, alpine + apk | ~2.1 s (assembly), ~4.6 s (coreutils) |
| `Toolbox.open`, debian + apt | ~12 s (x64 assembly), ~20 s (rauc + squashfs + openssl) |
| one `docker exec` into an open toolbox | ~40 ms |
| one `docker run --rm` — what a session avoids | ~320 ms |
| `bash build/run.sh --mkimage-cx3576` | ~55 s |
| `bash build/run.sh --mkimage-uefi --board x64` | ~27 s |
| `bash build/run.sh --bundle` | ~22 s |
| `src/mkimage-cx3576.test.ts` (seven full assemblies, fabricated inputs) | ~45 s |
| `src/mkimage-uefi.test.ts` (three full assemblies) | ~70 s |
| `src/bundle.test.ts` (six real bundles) | ~32 s |

A toolbox is one container held open for the run, with each call a `docker exec`
into it. Opening one per tool call would pay the open cost per call, and an
assembly makes hundreds.

The 4.6 s open is why `src/testing.ts` exists: it is **under** bun's 5 s default
and it flaked against it, which is the worst kind of limit — green on a warm
image cache and red on a cold one, for a reason unrelated to what is under test.
The tests that open a toolbox carry a number at the place that pays the cost,
rather than the whole suite being given a blanket `--timeout` that would also
hide a genuine hang in the tests that compute.

The suite assembles **seven** whole cx3576 images over fabricated inputs, which
is the price of having a full assembly in it at all: a chain that runs end to
end is the thing a table of unit refusals cannot assert.

## 3. Zero tests is a failure, and bun does not agree

Measured with bun 1.4.0:

| situation | `bun test` exit status |
|-----------|------------------------|
| no test **file** matches the glob | 1 |
| a file matches and declares **no tests** | **0** — "Ran 0 tests across 1 file" |

So `run.sh` reads the count out of the run and turns `N = 0` red, and also
refuses a run that exits 0 without printing the count line at all.

**Both halves are driven, and the second only by mutating the guard**, because
nothing a caller can do makes bun print no count while exiting 0. This package
has shipped a guard that was itself unreachable, twice, and both were found
exactly this way.

| driven | what happens |
|---|---|
| a test file declaring no tests, through `bun test` | `Ran 0 tests`, **exit 0** |
| the same file through `run.sh` | **exit 1**, "a suite that asserts nothing reports the same green as one that passes" |
| the count pattern mutated to match nothing | **exit 1**, "printed no 'Ran N tests' line" |
| a one-test filter (`Ran 1 test`, singular) | `RESULT: PASS (1/1 tests)` — a pattern insisting on the plural would call this vacuous |
| one deliberately red test | `RESULT: FAIL (bun test exited 1; 0 passed of 1 run)` |

## 4. Every guard driven from the failing side

Each guard in `run.sh` is run against the condition it exists to catch:

| driven | what it prints |
|---|---|
| `MOS_BUILD_BUN` and `MOS_BUILD_CONTAINER` both set | refused; "those are two different buns" |
| no docker client on `PATH`, bun present | refused, naming the toolset it drives and `MOS_BUILD_DOCKER` |
| the same, and no bun either | the same refusal — docker is this package's requirement either way |
| `MOS_BUILD_DOCKER` naming a client that cannot reach a daemon | refused; "the client exists; the daemon does not answer" |
| `IMAGE_BUN_1` set to a tag, or removed | `from.sh`'s own refusal, naming the key and the file |
| `IMAGE_BUN_1` a well-formed digest naming no image | refused **by the key**, before any run — `docker run` would give exit 125, indistinguishable at this seam from bun exiting 125 |
| a copy of `run.sh` whose `REPO_ROOT` has no `Makefile` | the computed `HERE` and `REPO_ROOT`, and that one of them is stale |
| a copy with no `verify/package.json` beside it | the same, naming `verify` — so a reader is told *which* package moved |
| the repository mount replaced by an empty directory | every unseen path listed, and "the mount succeeded and delivered nothing" |
| the docker socket mount removed from the container route | refused; "the docker client works on this host but not inside the pinned bun container" |

### A bind mount under /tmp succeeds and carries nothing

```
$ echo hello > /tmp/probe/f.txt && cat /tmp/probe/f.txt
hello
$ docker run --rm -v /tmp/probe:/tmp/probe alpine sh -c 'ls -A /tmp/probe | wc -l; cat /tmp/probe/f.txt'
0
cat: can't open '/tmp/probe/f.txt': No such file or directory
```

A bind mount of anything under `/tmp` **succeeds and delivers an empty
directory**. That is why `src/paths.ts` puts this package's scratch space under
`build/.work/` (gitignored) and not under `/tmp`: every tool here may be
running in a container, so a scratch file the daemon cannot share is a file the
tool cannot see, reported as a file that does not exist.

Anything staging into `.work/` must clean up after itself. The bundle builder's
staging tree holds a copy of the rootfs slot image and of the kernel; without
the cleanup, `.work/` reaches 557 MiB after seven runs.

### The boundary guards

`build` imports the board model from `verify/src/` across the two package
directories rather than copying it or moving it into a third package. One copy
of the parser, no lockfile coupling, no workspace: bun and tsc both resolve a
relative specifier into a sibling package's `src/` directly, and `build`'s
tsconfig typechecks what it imports, so the two are checked together on every
run of either suite.

`src/verify-package.test.ts` holds that boundary with two source sweeps, and
both are mutated to prove they are reachable — the only way to know a pattern
matches anything:

| driven | result |
|---|---|
| a second file in `src/` importing `../../verify/src/board.ts` | red — the file listed beside `verify-package.ts` |
| a file in `src/` defining `export function parseBoardEnv` | red — the file named, and the pattern that caught it |
| both removed | green again, tree checked with `git status` |

The sweep excludes only its own file, and only for those two assertions: it has
to quote `../../verify/` and a `function parseBoardEnv` in order to search for
them. Every other file in the package, tests included, stays in scope. A
separate assertion requires the sweep to see more than four files, so a walk
that found nothing cannot satisfy it by having nothing to object to.

## 5. The geometry against bash, key for key

`src/geometry.ts` derives partition order, number, role, label, GUID, and start
and size **in sectors** however the board file spelled them. It is checked
against `bash` sourcing the same definitions, key for key.

**The bash side uses the opposite precedence to the TypeScript on purpose** —
sectors first here, MiB first there. On a board whose units agree both give the
same answer; on one where they do not, they diverge, which is the point of
having two.

This check is **deliberately not in the suite**: it `source`s a board definition
to test the thing whose entire purpose is not to, and pointed at an untrusted
file it would execute it. Re-run it by hand when `src/geometry.ts` changes.

```sh
cat > /tmp/geo-oracle.sh <<'SHEOF'
#!/usr/bin/env bash
set -euo pipefail
board="$1"
# shellcheck disable=SC1090
. "$PWD/boards/${board}/board.env"
n=0
for p in ${LAYOUT_PARTITIONS}; do
    n=$((n + 1))
    ss="-"; sz="-"
    v="${p}_START_SECTOR";  [ -n "${!v:-}" ] && ss="${!v}"
    if [ "${ss}" = "-" ]; then v="${p}_START_MIB"; [ -n "${!v:-}" ] && ss=$(( ${!v} * MIB_BYTES / SECTOR_SIZE )); fi
    if [ "${ss}" = "-" ]; then v="${p}_OFFSET_BYTES"; [ -n "${!v:-}" ] && ss=$(( ${!v} / SECTOR_SIZE )); fi
    v="${p}_SIZE_SECTORS";  [ -n "${!v:-}" ] && sz="${!v}"
    if [ "${sz}" = "-" ]; then v="${p}_SIZE_MIB"; [ -n "${!v:-}" ] && sz=$(( ${!v} * MIB_BYTES / SECTOR_SIZE )); fi
    v="${p}_PARTNUM"; num="${!v:-}"; v="${p}_ROLE"; role="${!v:-}"
    v="${p}_LABEL"; label="${!v:-}"; v="${p}_GUID"; guid="${!v:-}"
    printf '%d %s num=%s role=%s label=%s guid=%s start=%s size=%s\n' "$n" "$p" "$num" "$role" "$label" "$guid" "$ss" "$sz"
done
printf 'board arch=%s bootloader=%s sector=%s mib=%s align=%s diskguid=%s slot=%s head=%s tail=%s salt=%s\n' \
    "${MOS_ARCH}" "${RAUC_BOOTLOADER}" "${SECTOR_SIZE}" "${MIB_BYTES}" "${GPT_ALIGN_SECTORS}" "${DISK_GUID}" \
    "${MOS_ROOTFS_SLOT_MIB}" "${IMAGE_HEAD_MIB}" "${IMAGE_TAIL_SLACK_MIB}" "${VERITY_SALT}"
[ "$n" -gt 5 ] || { echo "refusing: only $n partitions from ${board}" >&2; exit 1; }
SHEOF

cat > /tmp/geo-ts.ts <<'TSEOF'
const { loadGeometry } = await import(`${process.cwd()}/build/src/geometry.ts`)
const g = loadGeometry(process.argv[2]!)
for (const p of g.partitions) {
  console.log(`${p.position} ${p.name} num=${p.partnum ?? ''} role=${p.role ?? ''} label=${p.label ?? ''} `
    + `guid=${p.guid ?? ''} start=${p.start?.sectors ?? '-'} size=${p.size?.sectors ?? '-'}`)
}
console.log(`board arch=${g.arch} bootloader=${g.bootloader} sector=${g.sectorSize} mib=${g.mibBytes} `
  + `align=${g.disk.alignSectors} diskguid=${g.disk.guid} slot=${g.slot.slotMib} head=${g.disk.headMib} `
  + `tail=${g.disk.tailSlackMib} salt=${g.veritySalt}`)
if (g.partitions.length <= 5) { console.error(`refusing: only ${g.partitions.length} partitions`); process.exit(1) }
TSEOF

for b in cx3576 x64; do
  bash /tmp/geo-oracle.sh "$b" > "/tmp/sh-$b.txt"
  bun run /tmp/geo-ts.ts "$b" > "/tmp/ts-$b.txt"
  n=$(wc -l < "/tmp/sh-$b.txt")
  diff -u "/tmp/sh-$b.txt" "/tmp/ts-$b.txt" && echo "$b: agrees on all $n lines"
done
```

Expected: **cx3576 12/12, x64 10/10.**

The `[ "$n" -gt 5 ]` guard on each side is not decoration — the equivalent
comparison in `verify` was once run from the wrong directory and reported
that the parser agreed with the shell "on all 0 keys". The comparison is also
checked to be *live*: cx3576's bash output against x64's TypeScript output
differs, and a one-sector mutation of either side shows up in the diff.

## 6. The tools, and the measurements that shaped the code

Every wrapper is exercised against its real tool. These are the runs where the
tool did something other than what the code assumed, which is why they are
written down rather than summarised.

### sgdisk: one argv shape where the shell had two

Measured with sgdisk 1.0.10 over the same two partitions, comparing whole
images:

| difference | result |
|---|---|
| flag order `new/name/type/guid` vs `new/type/guid/name` | byte-identical |
| `+131072S` vs `+64M` at 512-byte sectors | byte-identical |
| `--clear` on a freshly truncated (all-zero) file | byte-identical |
| `-a 1` where every start is already MiB-aligned | byte-identical |
| **`-a 1` where a start is sector 64** | 64 **vs 2048** — relocated, silently, exit 0 |

`writeGptArgs` therefore emits one argv shape. The suite re-runs the first four,
so a different sgdisk disagrees *here* rather than in the middle of an assembly,
and the comparison carries its own vacuity control: two images differing in one
partition GUID must compare unequal.

`sgdisk --verify`'s two failure shapes are both driven. The exit-0-with-problems
shape is produced by shrinking a disk under a valid table (`Identified 5
problems!`, rc 0) — **not** by overlapping partitions, which proves only the
other shape: sgdisk refuses those outright with exit 4.

### debugfs: its exit status is not its verdict

debugfs 1.47.1, `-w -f <cmds> <img>`:

| case | rc | stderr |
|---|---|---|
| valid commands, real filesystem | 0 | banner only |
| **unknown command** (`sif_renamed`) | **1** | "Command not found" |
| bad **argument** (`sif <999999>`) | **0** | "File not found by ext2_lookup" |
| image is not a filesystem | **0** | "Bad magic number" |
| image is not there at all | **0** | "No such file …" |
| command file is not there | **1** | "No such file …" |
| **command file is EMPTY** | **0** | **banner only** |

So `debugfsApply` reads stderr, not the status. Note which cases each signal
does and does not carry: an unknown command *does* exit 1, and the exit status
does *not* catch a filesystem debugfs cannot open.

The last row is the one **neither** signal carries, and nothing else covers it:
`pin_seeded_times` generates its command file by parsing dumpe2fs's free-inode
ranges, so an empty one is precisely what a parse that understood nothing
produces — the pass runs, pins no timestamps, reports success, and EPHEMERAL
quietly stops rebuilding byte-identically. `debugfsApply` refuses it.

### rauc: `info` will not read a bundle without a keyring

`rauc info` with no `--keyring` exits 1 with "No keyring file or directory
provided" rather than reading the bundle unverified. The wrapper's `--keyring`
is therefore required, not optional.

The bundle the `info` tests read is built in-test by a **distro** rauc, through
`bundleArgs` directly rather than through `bundle()` — because `bundle()`
refuses a distro toolset, which is the behaviour the tests either side of it
drive. A payload of one repeated byte will not do: rauc refuses a squashfs that
compresses to its own block size ("squashfs size (4096) must be larger than 4096
bytes"), so the fixture is a fixed-seed LCG — deterministic and incompressible.

**A bundle is compared by its payload, not by its file bytes.** rauc salts the
bundle's own verity hash tree at random and the CMS signature carries a
`signingTime` attribute, so two correct builds of the same version differ after
the payload and must not differ inside it. The payload digest is computed from
the squashfs superblock, independently of anything rauc prints:

```sh
n=$(od -An -tu8 -j40 -N8 "$f" | tr -d ' ')      # squashfs bytes_used
n=$(( (n + 4095) / 4096 * 4096 ))               # rauc pads to 4096
head -c "$n" "$f" | sha256sum
```

The magic is checked **before** the length is read, because `head -c <huge>` is
"the whole file" rather than an error, so a length read out of something that is
not a superblock would produce a digest for it anyway.

### mkfs.vfat: `-F 32` does not enforce FAT32

Driven at 32 MiB: mkfs.vfat exits 0, mcopy copies into it, mdir lists it — and
the cluster count is below the 65525 the specification requires, which is the
one measurement that disagrees. The consequence is not theoretical: OVMF refused
such an ESP, it was absent from the firmware's device list, and the machine
dropped to the UEFI shell.

`readFatClusters` refuses an unreadable count rather than comparing it, because
`[ "" -lt 65525 ]` is a shell error and `undefined < 65525` is `false`.

### touch -h does not create

`-h` makes `touch` operate on the link rather than its target, so on a path that
does not exist it does not create one:

```
touch: setting times of '.../.mos-var-seeded': No such file or directory
```

Collapsing `: >file` plus `touch -h -d` into a single `touch -h -d` therefore
fails forty steps into an assembly. It is two calls, both in the container.

### The reproducibility knobs, each with its control

Every "identical twice" assertion has a "different when the pin changes" beside
it. Without the second, a tool that ignored the variable entirely would satisfy
the first.

| pin | identical | control |
|---|---|---|
| `SOURCE_DATE_EPOCH` (mkimage, on cx3576's real `boot.cmd`) | two builds byte-identical | a different epoch → different bytes |
| `E2FSPROGS_FAKE_TIME` (mke2fs) | two builds byte-identical | a different fake time → different bytes |
| `--salt` / `--uuid` (veritysetup) | same root hash twice | a different payload → different hash |
| the host route vs the container route (dd) | same disk, same sha256 | — |

### Toolsets

Every toolset is opened and every tool in it is asked to answer. The
`e2fsprogs`-without-`e2fsprogs-extra` gap is driven as a negative, with the
correct package list as its positive control.

`grub-editenv` is declared separately from `grub-mkstandalone`: the first comes
from `grub-common` and the second's EFI target from `grub-efi-amd64-bin`, so
"grub is installed" is not one fact.

## 7. Substitution is literal, at every site

`String.replace` and `String.replaceAll` expand `$&`, `` $` ``, `$'`, `$$` and
`$n` **in a string replacement**. `replaceAll` is not exempt. A template
rendered with a string replacement therefore produces text nobody wrote as soon
as a substituted VALUE contains a `$`:

```
'@COMPATIBLE@' -> 'mos-a$&b'   yields   compatible=mos-a@COMPATIBLE@b
'@COMPATIBLE@' -> 'mos-a$`b'   yields   compatible=mos-acompatible=b
'@COMPATIBLE@' -> "mos-a$'b"   yields   compatible=mos-ab
'@COMPATIBLE@' -> 'mos-a$$b'   yields   compatible=mos-a$b
```

**Every substitution of caller data goes through a replacer FUNCTION**, which is
never scanned for `$` sequences:

```ts
.replaceAll('@COMPATIBLE@', () => options.compatible)
out.replaceAll(`@${name}@`, () => value)
```

An escape list enumerating `$&`, `` $` ``, `$'`, `$$` and `$n` is a list that
can go stale; a function cannot. The rule holds at `src/bundle.ts`'s
`renderManifest` and at `src/grub-uefi.ts`'s fragment renderer — the second has
the freer input, since `BOARD_CMDLINE_ARGS` is arbitrary board text and a
cmdline containing `$&` would otherwise be silently rewritten into the
`grub.cfg` that boots the machine.

Driven from the failing side in `src/bundle.test.ts` and `src/grub-uefi.test.ts`.
With the replacer functions reverted to string replacements, four of six and
four of five cases go red — **and the ones that do not are the controls**: a
bare `&` lands literally in JavaScript either way, and `$1` with no capture
group is also literal. A test set where *everything* went red would be failing
indiscriminately rather than catching this class. There is an explicit positive
control too: an ordinary `mos-x64` / `0.0.0-dev` renders unchanged, without
which a `renderManifest` that returned its input untouched would satisfy every
case.

A `replace` whose replacement contains no `$`, or whose `'$1'` refers to a real
capture group, is correct as written. `src/toolbox.ts`, `src/pin-seeded-times.ts`
and `src/tools/sgdisk.ts` are those cases.

## 8. The cx3576 assembler

### What it refuses, and the mutation that drives each red

**A byte-identity comparison cannot see a dropped refusal.** An assembler that
lost one produces identical bytes for every good input and compares perfectly;
what it stopped catching is a board that needs re-flashing. So every refusal is
driven from the failing side, and every negative has a **positive control**
beside it in the same file — the tree's own `boot.cmd`, the tree's own board
definition, or the same input unmutated. Without that, a guard that refused
everything would satisfy the whole table.

**slot pin, strict mode** — `src/layout-cx3576.test.ts`, `src/mkimage-cx3576.test.ts`

| driven | what it prints |
|---|---|
| pin `0`, `-16`, `256.5`, `256M`, `' 256'`, `abc`, `+256`, `0256` | "is not a positive whole number of MiB", eight times |
| `MOS_ROOTFS_SLOT_MIB=` (set, empty) | the same — supplied-and-empty is a release build whose pin got lost, not a dev build |
| a 300 MiB payload against `--pin 256` | "300 MiB — 44 MiB too large", "frozen for every device already flashed", "shrink the rootfs instead" |
| **the same payload UNPINNED** | assembles; floor mode grows the slot to 384 MiB. The control that makes the row above a statement about the MODE |
| a pin equal to the board's own default (`256`) | still `mode: 'pinned'`, while unpinned is `mode: 'floor'` — selected by PRESENCE, never by value |

**boot-attempts range** — `src/boot-cx3576.test.ts`

| driven | what it prints |
|---|---|
| `setenv BOOT_A_LEFT 10` | "sets a boot-attempts value of 10; RAUC writes this counter in hex and U-Boot compares it in decimal, so it must stay in 1..9" |
| `setenv BOOT_B_LEFT 0` | the same, "value of 0" |
| `1` and `9` | accepted — the boundaries themselves, so the range is a range |
| `BOOT_ATTEMPTS_MAX=5` on the board | "must stay in 1..5" — the range comes from the board, not from a literal |
| the tree's own file | four credits found, all `3`. Four, not two: the exhausted-both-slots recovery block resets both, and the scan reads the whole file for that reason |

**stale partition number — the renumbering guard** — `src/boot-cx3576.test.ts`

| driven | what it prints |
|---|---|
| `bootpart` 4→5 for slot A | "sets 'bootpart' to '5' for slot A, but the layout puts that partition at p4" |
| `bootpart` 5→6 for slot B | the same, p5 |
| `rootpart` 6→7 for slot A | the same, p6 |
| `rootpart` 7→8 for slot B | the same, p7 |
| `setenv bootpart` renamed away entirely | "sets 'bootpart' to 'nothing' for slot A" — not a comparison against `undefined` |
| `BOOT_A_PARTNUM=99` on the board | "the layout puts that partition at p99" — the expected numbers come from the layout |
| all four, through a whole assembly | the build stops before anything is written |

The scan's shape is driven too: it latches on `setenv bootslot <slot>`, takes
the FIRST following assignment, never unlatches, and ignores leading whitespace
— transcribed rather than tidied, because a scan that read a different line
would be right about today's file and wrong about the next one.

**loader content** — `src/mkimage-cx3576.test.ts`

| driven | what it prints |
|---|---|
| a blob whose first bytes are not `RKNS` | "starts with '33333333', not the Rockchip idbloader magic '524b4e53' ('RKNS'); the RK3576 BootROM would not recognise it at sector 64" |
| a blob one byte over `UBOOT_MAX_BYTES` | "does not fit between sector 64 and uenv-a at 16 MiB" |
| a blob **exactly** `UBOOT_MAX_BYTES` | assembles — the control that makes the row above `>` and not `>=` |
| a 2 MiB image of zeros, read at sector 64 | "the first bytes of the loader partition are '00000000', not the idbloader magic '524b4e53'" |
| the same image with the blob dd'd in, read at sector **2048** | refused — it reads at the start sector it is GIVEN, so a relocated partition points at nothing |
| a file with two bytes in it | "has only 2 byte(s) at offset 0, and 4 were read" — a short read is not a wrong magic |

**the uboot-mos-only rule** — `src/mkimage-cx3576.test.ts`

| driven | what it prints |
|---|---|
| `uboot-mos` absent | "build it with 'make -C boards/cx3576/bsp uboot-mos'", "is NOT a substitute", "CONFIG_ENV_IS_NOWHERE", "silently never run the RAUC A/B handshake" |
| `uboot-mos` byte-identical to the debug build | "is byte-identical to the debug build at …", quoting the env offsets the real variant carries, and "do not copy or symlink the other variant into place" |
| **no debug build present at all** | assembles. The control: its absence disables nothing else, and without this the guard could be "always refuses" |
| through the CLI, with no `uboot-mos` blob in the boot export | the same sentence, which since PLAN-086 S2 also names the two steps between the BSP build and the export: `make os-deb-board-cx3576` and `rootfs/build.sh` |
| through the CLI, with every blob in `BSP_OUT` and none in the export | "boot/Image not found; it is exported out of the packed root" — the property the slice is for, driven from the side that can fail |

**the rest** — thirty-three refusals in all, each driven:

| refusal | driven in |
|---|---|
| `board.env` not found | `mkimage-cx3576-cli.test.ts` — refused by name |
| `boot.cmd` not found | `mkimage-cx3576.test.ts` |
| verity env filenames are not `<base>-a.env`/`<base>-b.env` | `boot-cx3576.test.ts`, both sides, plus a renamed base that stays consistent |
| `rauc.slot=${bootslot}` missing from `boot.cmd` | `boot-cx3576.test.ts` — **`replaceAll`**, because the token appears in a comment too and a replace that changed only the comment is a negative test that is not negative |
| the per-slot verity env load missing | `boot-cx3576.test.ts`, and the pattern it looks for is derived from the board |
| no `dm-mod.create=` | `boot-cx3576.test.ts` |
| no `dm-mod.waitfor=` | `boot-cx3576.test.ts`, and through a whole assembly |
| the table does not name this slot's PARTUUID | `boot-cx3576.test.ts`, and slot B pointed at rootfs-a through an assembly |
| the `waitfor` names a different partition from the table | `boot-cx3576.test.ts` |
| the table carries a different root hash | `boot-cx3576.test.ts` |
| `FACTORY_VAR` absent / a file / without `lib/` | `mkimage-cx3576.test.ts`, all three |
| kernel, dtb, rootfs-verity.img/.env, both cmdlines absent | `mkimage-cx3576.test.ts`, five cases, each asserting the sentence that says what MAKES it |
| the three loader identities | `layout-cx3576.test.ts` individually and all three at once; `mkimage-cx3576.test.ts` through an assembly |
| payload not a whole-MiB multiple / zero bytes | `mkimage-cx3576.test.ts` |
| `VERITY_ROOT_HASH` missing | `mkimage-cx3576.test.ts` |
| salt not the pinned one | `mkimage-cx3576.test.ts`, with an UPPERCASE salt as the case-folding control |
| `sgdisk --verify` reporting problems | `src/tools/sgdisk.test.ts` — both shapes, including problem text with exit 0 |
| the assembled loader partition moved | below |
| the rootfs input / BSP input messages | `mkimage-cx3576-cli.test.ts`, asserting they are DIFFERENT sentences |

### Loader alignment, and why the table is read back

Driven against a real sgdisk in `src/mkimage-cx3576.test.ts`, over the real cx3576
geometry on a sparse 1315 MiB file:

| alignment | what sgdisk does | what catches it |
|---|---|---|
| `-a 1` (the board's) | loader at **64**, 32704 sectors | — it is correct |
| **omitted** | loader at **2048**. Exit **0**. `sgdisk --verify` says "No problems found" | the read-back: "the assembled loader partition is 30720 sectors at 2048, expected 32704 at 64" |
| `-a 2048` | the same silent relocation | the same read-back |
| `-a 4096` | uenv-b moves into boot-a; sgdisk **refuses the table**, exit 4, saves nothing | `writeGpt`'s own `must()` |

**The three do not fail alike.** A check written only against silent relocation
would be right about what it caught and wrong about what it thought it was
catching.

The size half is driven separately — a partition starting at 64 and 1000 sectors
long is refused — because a check that looked only at the start would pass a
loader partition that begins in the right place and stops before the bootloader
ends.

In the finished image: `out.loaderStartSector === 64n`,
`out.loaderSizeSectors === 32704n`, and the four bytes at byte 32768 are
`524b4e53`.

### The derived layout against bash, payload for payload

The slot arithmetic and the whole start chain, against a shell that reads the
same `board.env`. Like the geometry oracle, **deliberately not in the suite**:
it sources a board definition.

```sh
cat > /tmp/slot-oracle.sh <<'SH'
#!/usr/bin/env bash
set -euo pipefail
. boards/cx3576/board.env
for verity_mib in 1 10 12 13 51 80 94 204 205 206 400 408 409 410 500 1000; do
  slot_mib=$(((verity_mib * ROOTFS_SLOT_HEADROOM_PCT + 99) / 100))
  slot_mib=$(((slot_mib + ROOTFS_SLOT_ALIGN_MIB - 1) / ROOTFS_SLOT_ALIGN_MIB * ROOTFS_SLOT_ALIGN_MIB))
  if [ "${slot_mib}" -lt "${MOS_ROOTFS_SLOT_MIB}" ]; then slot_mib="${MOS_ROOTFS_SLOT_MIB}"; fi
  rootfs_b=$((ROOTFS_A_START_MIB + slot_mib)); meta=$((rootfs_b + slot_mib))
  state=$((meta + META_SIZE_MIB)); eph=$((state + STATE_SIZE_MIB)); data=$((eph + MOS_VAR_MIB))
  total=$((data + DATA_SIZE_MIB + IMAGE_TAIL_SLACK_MIB))
  printf '%s slot=%s rootfs_b=%s meta=%s state=%s eph=%s data=%s total=%s\n' \
    "$verity_mib" "$slot_mib" "$rootfs_b" "$meta" "$state" "$eph" "$data" "$total"
done
SH

cat > /tmp/slot-ts.ts <<'TS'
const { loadGeometry } = await import(`${process.cwd()}/build/src/geometry.ts`)
const { decideSlot, deriveLayout } = await import(`${process.cwd()}/build/src/layout-cx3576.ts`)
const g = loadGeometry('cx3576')
for (const v of [1n,10n,12n,13n,51n,80n,94n,204n,205n,206n,400n,408n,409n,410n,500n,1000n]) {
  const s = decideSlot(g, v, undefined, 'x').slotMib
  const l = deriveLayout(g, s)
  console.log(`${v} slot=${s} rootfs_b=${l.rootfsBStartMib} meta=${l.metaStartMib} `
    + `state=${l.stateStartMib} eph=${l.ephemeralStartMib} data=${l.dataStartMib} total=${l.totalSizeMib}`)
}
TS

bash /tmp/slot-oracle.sh > /tmp/slot-sh.txt
bun run /tmp/slot-ts.ts   > /tmp/slot-ts.txt
diff -u /tmp/slot-sh.txt /tmp/slot-ts.txt && echo "agrees on $(wc -l < /tmp/slot-sh.txt) payload sizes"
```

Expected: **agreement on all 16 payload sizes**, slot and full chain.

**Check it live**, because an oracle that agrees for the wrong reason is the
failure this tree keeps finding in its own checkers. Dropping the `+ 99` from
the shell side turns the ceiling into a floor and diverges at 205 MiB — ceil
gives 257 → 272, floor gives 256 → 256 — and again at 410 MiB:

```sh
sed 's/+ 99) \/ 100/) \/ 100/' /tmp/slot-oracle.sh > /tmp/slot-oracle-floor.sh
bash /tmp/slot-oracle-floor.sh | diff - /tmp/slot-ts.txt   # must differ
```

205 MiB is the discriminating size at the shipped floor. Most payloads are not:
a case where ceil and floor agree proves nothing.

## 9. pin_seeded_times

`src/pin-seeded-times.test.ts`, against real filesystems in the toolbox.

**The claim**: two 16 MiB ext4 filesystems seeded from trees that differ only in
atime and ctime come out byte-identical after the pass. **And differ without
it** — the half that stops a pass which does nothing from satisfying the first.

The two trees are made to differ **deterministically**, by `touch -a` on one of
them: that sets atime and, because no syscall sets ctime, bumps ctime as well.
Waiting for a wall clock to tick between two copies would test this on a machine
slow enough and nothing on a machine that is not.

| driven | result |
|---|---|
| the two seeded images, before the pass | `cmp` exit 1 |
| the two seeded images, after it | `cmp` exit 0 |
| every in-use inode, after the pass | atime and ctime both `1577836800`; mtime still `1000000000` |
| inode 2 (the root directory), after the pass | **unchanged** — the pass starts at `First inode`, so mke2fs's own reserved inodes are left as mke2fs wrote them |
| a listing truncated after its first group | "says N inodes are in use from 11 up, but parsing dumpe2fs's free-inode ranges found M" |
| a listing whose ranges the parse cannot read (`12-abc`) | refused by token, not skipped |
| an unindented `Free inodes: 21` (the SUPERBLOCK total) | not read as a group — and the control, indented, DOES change the answer |
| an empty command file | `debugfsApply` refuses it — the one shape neither of debugfs's signals carries |

**Which times `E2FSPROGS_FAKE_TIME` reaches, and which it does not.** `mke2fs
-d` on a source file touched to `@1000000000`, alpine 3.21:

```
ctime:  0x6a8e3b33  the SOURCE's ctime -- the fake time does not reach it
atime:  0x3b9aca00  the SOURCE's atime (1000000000)
mtime:  0x3b9aca00  the SOURCE's mtime
crtime: 0x5e0be100  mke2fs's own invention -- and the fake time DOES pin this
```

But `lost+found` — inode 11, which mke2fs creates itself — gets the fake time in
all four, so **sampling the first in-use inode finds the pass already done and
proves nothing**. The test asserts over every in-use inode and requires at least
one to have differed beforehand.

Without `E2FSPROGS_FAKE_TIME`, atime comes back as the wall clock rather than
the source's, because reading the source to make the copy is itself what bumps
it under relatime.

## 10. The x64 assembler

### What it refuses, and the mutation that drives each red

Fourteen reachable refusals, plus one guard with no message of its own
(`sgdisk --verify`, refusing under `set -e`). Every negative has a **positive
control** beside it in the same file.

| # | refused | in | driven red by |
|---|---|---|---|
| 1 | five inputs absent | `requiredInputs`/`requireFile` | each of the five, absent; plus a DIRECTORY where a file belongs |
| 2 | `FACTORY_VAR` not a directory | `assembleUefi` | absent, and a FILE in its place |
| 3 | unrendered placeholder | `unrenderedPlaceholders` | an unknown `@NOT_A_KEY@`; and a substitution REMOVED from the map |
| 4 | literal hash on a linux line | `literalHashLines` | a 64-hex hash spliced onto both linux lines |
| 5 | fragment variable unused | `unusedFragmentVars` | each of the five, `replaceAll`'d away |
| 6 | ESP cluster floor | `checkEspIsFat32` | a real 32 MiB `mkfs.vfat -F 32`; and a whole assembly on a mutated board |
| 7 | grubenv not 1024 bytes | `checkGrubenvSize` | 0, 1023 and 1025 |
| 8 | per-slot file on the ESP | `strayEspEntries` | each of the three names, one at a time |
| 9 | the two boot slots differ | `bootSlotFault` | a listing with one entry dropped |
| 10 | factory `/var` has no `lib/` | `assembleUefi` | a staged tree with only `cache/` |
| 11 | inode geometry unreadable | `dumpe2fsHeader` | `src/pin-seeded-times.test.ts` |
| 12 | inode count cross-check | `refuseUnlessCountsAgree` | the same, with a truncated listing |
| 13 | debugfs stderr | `debugfsApply` | the same, with a renamed `sif` |
| 14 | any tool call failing | `Toolbox.must` | `src/toolbox.test.ts` |

Number 14 replaces a wrapper rather than reproducing one. A shell assembler that
re-execs a whole script inside a container has nothing but an exit status to
report and needs a line that says "image assembly failed". Here every tool call
goes through `Toolbox.must`, which throws a `ToolError` carrying the argv, the
route, stdout and stderr — the information is delivered per call, by the call
that failed, and there is nothing left to wrap.

**The controls, listed, because they are what make the table mean anything:**

- **the five inputs**: all five present, and the assembly proceeds;
- **the shipped `grub.cfg`**: renders clean through all three text guards, with
  two linux lines and every fragment variable referenced;
- **a hash in a COMMENT and a hash in an `echo` line**: neither fires guard 4.
  These are the two false positives an earlier reader produced by grepping for
  the word "verity" and rejecting the correct file;
- **a PARTUUID**: 32 hex digits in five dash-separated groups, longest unbroken
  run 12 — which is why guard 4's threshold is `{32,}` and not `{12,}`, asserted
  from both sides;
- **grubenv at 1024**: passes, and a real `grub-editenv grubenv create` makes one
  of exactly that size;
- **a clean ESP listing**: no strays; and a per-slot name NESTED under `EFI/` is
  not a stray either, because the match is anchored at the root;
- **the pinned salt in UPPERCASE**: accepted, so the salt comparison is not a
  literal one.

### The ESP cluster floor: its position is the whole check

`checkEspIsFat32` parses **free** clusters out of minfo's FSInfo sector. The FAT
specification defines the type by **total** clusters. Those are not the same
number, and the check is correct anyway — *where it stands*.

Measured on a 64 MiB ESP:

| | |
|---|---|
| `free clusters=` immediately after `mkfs.vfat` | **129021** |
| total clusters, computed from the BPB | **129022** |
| `free clusters=` after the ESP tree is staged (12 MiB) | **117119** |

On an empty filesystem free is total minus the root directory's one cluster, so
the comparison is conservative by exactly one. **After the `mcopy` it becomes a
free-space check**: it would refuse a valid FAT32 for being full while printing
a message about the FAT specification, and it would stop refusing the case it
exists for as soon as the payload grew. Moving it is the natural tidy-up, and it
is silent.

So it runs immediately after `mkfs.vfat` and before anything is copied in.

**minfo prints no total at all** — only `free clusters=` in its Infosector
block. That is *why* free is what gets read. `src/mkimage-uefi.test.ts` derives
the total from the BPB (`(big size − reserved − fats × Big fatlen) / cluster
size`) purely to MEASURE the relationship; the shipped check still reads free.

Driven both ways: a real 32 MiB `mkfs.vfat -F 32` — which exits 0, which minfo
calls FAT32, and which OVMF left out of its device list entirely — is refused; a
64 MiB one is accepted; 33 MiB, the measured floor, passes.

And it is driven **through a whole assembly** on a board mutated to
`ESP_SIZE_MIB=32`, so its call site cannot be deleted unnoticed. A guard only
ever called directly is a guard whose caller could have dropped it.

### Alignment on x64, and why the whole table is read back

`writeGpt` passes the board's `GPT_ALIGN_SECTORS`, which x64 declares as 2048.
Measured over the real x64 geometry with real partition GUIDs — sgdisk invents
random ones when they are not given, so a probe that omits them compares
nothing:

| alignment | what sgdisk does |
|---|---|
| omitted (sgdisk's default) | esp at 2048, 131072 sectors |
| `-a 2048` (the board's) | **byte-identical table** |
| `-a 1` | byte-identical too — nothing here needs relocating |
| `-a 4096` | esp **moved to 4096 AND shrunk to 129024 sectors**, exit **0** |

**The `-a 4096` row is not what cx3576 does.** There sgdisk *refuses* the table
(exit 4), because the relocation would push uenv-b into boot-a and there is no
room. Here there is room, so it relocates silently — and it does not only move
the ESP, it truncates it to stop at boot-a's original start. The two boards'
third alignment case is a **different failure**, and the shape depends on the
geometry rather than on the flag.

Which is why `src/mkimage-uefi.ts` reads the assembled table back and compares
every partition against the spec (`partitionFaults`). On this board a wrong
alignment does not announce itself at all, so the read-back is the only thing
that would report it. Driven red against a real `-a 4096` table and green
against the one the assembler writes.

### How layout-uefi.ts differs from layout-cx3576.ts

Three differences, each of which changes a number or a behaviour, which is why
they are two files:

1. **The headroom is applied in BYTES.** x64's is
   `(rootfs_bytes * PCT / 100 + MIB_BYTES - 1) / MIB_BYTES` — percentage first,
   on the byte count, then the ceiling to MiB. cx3576's is
   `(payload_mib * pct + 99) / 100`, with the ceiling to MiB first. Measured:
   the two **agree on all 2048 whole-MiB payloads** and disagree on thousands of
   others — 12583292 bytes gives **16 MiB** one way and **32** the other, and
   the difference survives the 16 MiB alignment rather than being absorbed by
   it. The cx3576 assembler refuses a payload that is not a whole MiB; the x64
   one never checks, so the disagreement is reachable.
2. **There is no pinned mode.** cx3576 captures `${MOS_ROOTFS_SLOT_MIB+set}`
   *before* the board file is read, so an environment pin selects the
   frozen-geometry mode. x64 reads the board's 512 first, which has already
   overwritten anything the environment said. x64 has one mode, the floor, and
   `layout-uefi.ts` has one too.
3. **The partition set and the alignment.** Nine partitions against eleven, no
   loader and no uenv pair, and no `checkLoaderLanded` because there is no
   loader to land — replaced by the whole-table read-back above.

What they DO share is shared as modules and not copied: `src/geometry.ts`,
`src/pin-seeded-times.ts`, `src/tools/`, and the board files themselves.

### The derived chain, against bash

`src/layout-uefi.test.ts` drives `decideSlot` against a bash `$(( ))` oracle over
13 payloads — one byte either side of the floor (416074957/416074958) and of two
alignment steps (429496730/429496731, 442918503/442918504), plus 1 byte, 1 MiB,
2 GiB and 4 GiB − 1.

The three constants are passed to bash as **arguments** rather than by sourcing
`boards/x64/board.env`: an oracle that read the board file would be testing
the parser this comparison is meant to be independent of.

**And the oracle is checked to be live.** Dropping the `+ mib - 1` turns the
ceiling into a floor. It is *not* visible at every payload — at 12583292 bytes
both spellings still land on 16 after alignment, so a test that tried only that
one would call a broken oracle live. At 268435457 bytes the ceiling gives 336
and the floor gives 320, and that is the payload the mutation is driven at.

### One step runs on the host, deliberately

The cx3576 assembler stages the factory `/var` **inside** its container; the x64
one stages it **on the host** and runs everything else inside.

That is not fastidiousness. `cp -a` is `--preserve=all`, which includes
**xattrs**; `mke2fs -d` copies xattrs into the image; and a host running SELinux
labels the factory `/var` tree (`system_u:object_r:container_file_t:s0`) while
neither container does. Moving that one step to the other side of the boundary
changes EPHEMERAL's bytes — as a diff in the middle of a 512 MiB filesystem.

`stageFactoryVarOnHost` is its own function so the one step that deliberately
runs outside the container is visible as such, with the reason travelling with
it. `cp -a`, not node's `cpSync`: node preserves neither ownership nor xattrs
and would produce a different filesystem while reporting success.

`cp`, `find` and `touch` are still declared in `uefiAssembly(<arch>).tools`, because the
assembly runs all three **inside** the container — `cp` for the ESP staging,
`find … -exec touch` for the mtimes, `touch` for the seed stamp and the per-slot
payload.

## 11. The bundle builder

Thirty-one refusals, of which two exist here and nowhere else. Every negative
has a **positive control** beside it in the same file, and every mutation goes
through a `mutate()` that throws when the replacement matched nothing.

### the rauc version cross-check — `src/bundle.test.ts`

Three of its four refusals are about the COMPARISON rather than about a
mismatch, because each of them would otherwise make it pass by finding nothing.

| driven | what it prints |
|---|---|
| the report file absent | "the image's RAUC version is unknown and a bundle built by an unknown-matching rauc is not one this can vouch for" |
| a report with the `RAUC_VERSION` line deleted | "records no RAUC_VERSION … either way the comparison would pass by finding nothing" |
| a build env carrying only `RAUC_SHA256` | "no RAUC_VERSION from /pkgs/rauc/out-amd64/RAUC_VERSION.env … would pass by finding nothing" |
| no build env path at all | the same sentence, with `<unset>` where the path goes |
| `v1.13` in the image, `v1.8` here | "this rauc is v1.8, the image ships v1.13" |
| `v1.130` against `v1.13` | refused: the comparison is a STRING, and it is the one place a numeric reading would say `1.8 > 1.13` |
| **both halves agreeing** | "rauc v1.13 here, v1.13 in the image" — the control |
| the report read with `=` and the build env read with a space | both find nothing: two files, two shapes, and reading either with the other's separator is the failure this exists to prevent |

### the boot-attempts range, and the empty read — `src/bundle.test.ts`

| driven | what it prints |
|---|---|
| **the tree's own `boot.cmd`** | accepted, and the guard reports it SAW **4** credits, all `3`. Not "the target exited 0" — the count is what distinguishes a guard that compared four values from one that compared none |
| `setenv BOOT_A_LEFT 10` | "boot-attempts value of 10 … must stay in 1..9" |
| `BOOT_A_LEFT 3` → `0` | the same, "value of 0" — the other end of a range |
| **every `BOOT_[AB]_LEFT <n>` renamed away** | "sets no BOOT_A_LEFT/BOOT_B_LEFT credit at all … would pass by finding nothing" |
| an EMPTY `boot.cmd` | the same refusal — not "nothing wrong here" |
| a credit inside a COMMENT | found: the scan is deliberately not anchored to `setenv` |

**The empty read is a refusal that exists here and not on the assembler path.**
Reading credits through `grep … | awk` into a `while read` loop means that a
`boot.cmd` which is missing or carries no credit produces no stdout, the loop
body never runs, and the guard passes having compared nothing. On the assembler
path a second guard catches it anyway — `checkBootCmdTokens` runs immediately
after and refuses a `boot.cmd` with no `rauc.slot=` in it. **The bundle path
runs no such second guard**, which is why the refusal lives there and not in
`checkBootAttempts`, which both share.

### the per-slot verity env — `src/bundle.test.ts`

| driven | what it prints |
|---|---|
| `dm-mod.create=` replaced by `root=/dev/mmcblk0p5` | "carries no dm-mod.create=/dm-mod.waitfor= verity table for slot A" |
| `dm-mod.waitfor=` replaced by `rootwait` | the SAME sentence — the assembler gives the two their own, the bundle builder does not, and each keeps its own words |
| **slot B's CORRECT cmdline under slot A's GUID** | "does not reference PARTUUID … each slot must point dm-verity at its own rootfs partition". The mutation that matters most is not a malformed file: it is a correct file for the other slot. Both boot; one boots the wrong rootfs |
| a `waitfor` naming the other slot's partition | "the wait must name the same partition the verity table uses" |
| the root hash replaced with another 64 hex characters | "does not carry the root hash" |
| **the SALT replaced inside the table** | "does not carry the salt" — a check the assembler does not have. The assembler compares the salt against the pin; the bundle builder additionally requires it in the table it is about to SIGN |
| the GUID upper-cased throughout the cmdline | accepted — every identifier comparison folds case, because GPT tooling writes GUIDs uppercase and the kernel cmdline lowercase |
| a cmdline carrying TWO `dm-mod.create=` tables | the LAST one wins, which is what a greedy leading wildcard yields |
| **an unmutated slot-A and slot-B cmdline** | both accepted, each against its own GUID — the controls |

### the verity facts, and the pinned salt — `src/bundle.test.ts`

| driven | what it prints |
|---|---|
| `VERITY_ROOT_HASH` deleted | "VERITY_ROOT_HASH missing from … fix rootfs/build.sh" |
| a salt of 64 `f`s | "does not match the pinned VERITY_SALT" |
| `VERITY_SALT` deleted entirely | "salt '' does not match" — an absent value does not compare equal to the pin |
| a salt with LETTERS, upper-cased on one side | accepted |
| **the file the rootfs build actually writes** | both facts read — the control |

The case-folding row must be written with a salt that has letters in it.
cx3576's pinned salt is `0000…0001` — all digits — so `toUpperCase()` on it is
the identity, the fixture is never broken, and the case would pass by asserting
that a guard stayed quiet about an input it had no reason to complain about.
`mutate()` refuses that, which is what it is for.

### the grub branch — `src/bundle.test.ts`

| driven | what it prints |
|---|---|
| **each of the 8 `VERITY_*` keys deleted, one at a time** | "`<KEY>` missing from … the installed slot would get an incomplete dm-verity table and GRUB would refuse to boot it", eight times. One case per key, not one for the family: a loop that reads seven of eight names correctly is exactly the drift this is here to catch |
| `VERITY_ROOT_HASH=deadbeef` — present, and not a hash | "the cmdline fragment carries no root hash; every slot installed from this bundle would refuse to boot". NOT redundant with the row above: that one is about a MISSING value, this one about a present and unusable one |
| an UPPERCASE root hash | the same refusal — GRUB's reader is the lowercase one |
| **the file the rootfs build writes** | all eight rendered, in order, as `set MOS_*=…` — the control |

### the manifest — `src/bundle.test.ts`

| driven | what it prints |
|---|---|
| `compatible=@COMPATIBLE@` → `@COMPAT@` | "unrendered placeholder left in a manifest VALUE", and the offending line is listed |
| `format=verity` → `format=plain` | "does not declare '[bundle] format=verity'" — rauc 1.8 has no `--bundle-format` flag, so a template edit could otherwise downgrade every bundle to the format `system.conf` refuses |
| `format=verity` commented out | the same refusal |
| **the shipped template's comment naming `@SLOTS@`** | accepted. The template DOCUMENTS the other template's placeholder by name, and a check over the raw bytes would reject a correct manifest for saying what it does |
| an INDENTED comment carrying a placeholder | accepted — what `[[:space:]]*` buys |
| **the shipped template, rendered** | both checks pass, `[image.boot]` is spliced in and `@BOOT_IMAGES@` is gone — the control |
| `a\nb` with no trailing newline | `a\nb\n`: the record separator is supplied whether or not the file had one |
| an empty file | no records, no blank line — `''.split('\n')` would have produced one |
| `# see @BOOT_IMAGES@ below` | NOT a splice point, because the splice compares whole lines rather than substrings |

### the bundle read back — `src/bundle.test.ts`

| driven | what it prints |
|---|---|
| a bundle whose compatible is `mos-x64` | "bundle compatible is 'mos-x64', expected 'mos-cx3576'" |
| the compatible key ABSENT | "bundle compatible is 'null'" — the four characters `jq -r` prints, not an `undefined` that would compare its own way |
| a version that is not the one asked for | "bundle version is '9.9.9', expected '0.0.0-dev'" |
| **each slot class's filename wrong, in turn** | "bundle image for slot class 'rootfs' is 'wrong.img'", and the same for `boot` |
| a bundle carrying NO boot image | "slot class 'boot' is ''" — the empty string is what `jq … \| select(has($s))` prints when it matches nothing, and it is a third answer that is not a value |
| `images` absent, or not an array | read as `''` rather than throwing its own way |
| **the shape a real rauc prints** | accepted — the control |

### the payload digest — `src/bundle.test.ts`

| driven | what it prints |
|---|---|
| a file beginning `ELF\0` | "does not start with a squashfs superblock" |
| a file beginning `nope` with a `bytes_used` of 2^40 | the SAME refusal — the magic is checked FIRST |
| `bytes_used` = 5000 | rounded up to 8192, which is the 4096 rauc pads to |
| `bytes_used` = 8192 | left at 8192 — not rounded up again |
| **one byte changed AFTER the payload** | the digest does not move. This is the whole reason the comparison is the payload |
| **one byte changed INSIDE it** | the digest moves — the control for the row above, without which a constant would satisfy it |

### the host half — `src/bundle-cli.test.ts`

| driven | what it prints |
|---|---|
| `MOS_BOARD=cx3567` | "boards/cx3567/board.env not found (MOS_BOARD=cx3567)". One transposition away from working, and an ENOENT names the path rather than the mistake |
| versions `-1.2.3`, `.1`, `''`, `1.2.3/../../etc`, `1.2.3 4`, `1.2.3;rm`, `1.2.3$(x)`, `1.2.3\n4`, `1.2&3` | "is not a plain version string", nine times. It reaches a FILENAME by concatenation and a manifest by substitution |
| a `system.conf` with no `compatible=` | "no compatible= in …" |
| `compatible=` with an empty value | the same — declared-empty is not a value here |
| `# compatible=mos-x64 is what x64 uses` | not read as one |
| **each of the three key files missing from `meta/rauc/`, in turn** | "signing material not found: …" naming that file, and `make os-devkeys` |
| `CERT=/hsm/typo.pem` missing | "…supplied from the environment but this file does not exist", and NOT `make os-devkeys` — a different reader with a different fix |
| `CERT=/keys-backup/c.pem` against `KEYDIR=/keys` | the environment sentence: the under-`KEYDIR` test needs the slash, and `/keys-backup` is not under `/keys` |
| **each rootfs-side input missing, in turn** | "not found; run 'MOS_BOARD=cx3576 bash rootfs/build.sh' first" |
| **each boot-export input missing, in turn** | "it is exported out of the packed root by …, which takes it from the installed board and kernel packages" — since PLAN-086 S2 both families come from ONE command, and the sentences still differ because the diagnosis does: a missing verity image means the composition did not finish, a missing `boot/Image` means a package did not carry it |
| both families missing | the rootfs-side sentence first |
| a UEFI board's one-file boot export | short, not empty, and still refused when that file is absent — an empty list is what a vacuous guard looks like |
| `riscv64`, `armv7l`, `ppc64le`, `''` | "pkgs/rauc/ builds amd64 and arm64" |
| `x86_64`, `x64`, `aarch64`, `arm64` | accepted — `uname -m` and node's `os.arch()` spell these differently and both reach this function |
| the shipped rauc absent | "out-amd64/rauc not found … built from source now, not installed from Debian" |
| an arm64 host against an amd64 binary | "out-arm64/rauc not found" — the path is per-architecture |
| **caller-supplied CERT/KEY/KEYRING, and a MIXED trio** | honoured per file, and not overridden — resolved once, never reassigned |

### the host-route refusal

`openBundleToolbox({ route: 'host' })` with a rauc on `PATH` that is not the
shipped one is refused: "took the HOST route, where its rauc would be … and not
…".

`carry` is a `docker cp`, and the host route has no way to put a binary on
`PATH`, so a bundle toolset that took it would declare `provenance: 'shipped'`
while `src/tools/rauc.ts` signed with whatever `rauc` resolved to first. The
refusal lives at the bundle rather than in `src/toolbox.ts`: provenance is not a
property of toolsets in general — rauc is the only tool that has one — so a
blanket "a toolset with `carry` may not take the host route" would be a rule
about something the toolbox does not model.

## 12. Determinism, and how to read a difference

Both assemblers reproduce themselves: two runs over identical inputs produce
identical bytes. That is a property of the assemblers, not of the rootfs build —
a cold rootfs build does **not** reproduce itself, so a rootfs hash committed as
an expectation is a check that looks like coverage and is not.

`src/mkimage-cx3576.test.ts` and `src/mkimage-uefi.test.ts` each carry the control
that makes "byte-identical" mean something: one changed input — a different
U-Boot blob, a different rootfs payload — and the images must compare **unequal**.
`src/bundle.test.ts` carries the same pair over a fabricated payload and a
self-signed key pair, so a change that puts a clock back into the staging path
is a red test rather than a hash somebody has to remember to compare.

When two images that should match do not, report **which structure moved**, not
that something did:

```sh
cmp -l a.img b.img | awk '{printf "%d\n", int(($1-1)/1048576)}' | uniq -c
```

then map the MiB offsets against the layout — for cx3576 `loader` at 0, `boot-a`
at 18, `rootfs-a` at 146, `ephemeral` at 738; for x64 `esp` at 1, `boot-a` at
65, `boot-b` at 161, `rootfs-a` at 257, `rootfs-b` at 769, `meta` at 1281,
`state` at 1297, `ephemeral` at 1361, `data` at 1873.

The two boards seed different numbers of slots at assembly — cx3576 one,
x64 both — so a one-byte change to `rootfs-verity.img` shows up as one MiB
bucket on cx3576 and two on x64.

When mutating an input to check that a comparison can report a difference, the
mutation must refuse to be a no-op. Flipping a byte to the value it already
holds asserts nothing while looking exactly like a control, so hash before and
after and fail by name if they match. Break any hardlink first: inputs copied
with `cp -al` share their blocks, and an in-place write corrupts the source as
well.
