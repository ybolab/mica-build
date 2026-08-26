# The os/build harness

`os/build/run.sh` is the single entry point.

    make os-build-test                        # the whole thing
    bash os/build/run.sh --help
    bash os/build/run.sh src/geometry.test.ts # extra arguments go to `bun test`
    bash os/build/run.sh -t "sgdisk"

It finds bun — on the host, or failing that in the container pinned as
`IMAGE_BUN_1` — asserts a docker client that can reach a daemon, installs the
dev dependencies if `node_modules/` is absent, typechecks `src/`, runs the suite,
and then checks the suite actually ran.

## What it costs, measured

Both routes were run to completion on 2026-08-25, this host:

| route | result | wall clock |
|---|---|---|
| host bun (`/srv/bkd/runtime/bun`) | **199/199** | 107 s |
| pinned bun container (`MOS_BUILD_CONTAINER=1`) | **199/199** | 99 s |

M6b added the assembler and raised the count by **158**, to 358; M5b's stage
driver merged alongside it, taking the package to **406/406**; M5c's stage
SELECTION added **16** more, for **422/422**; and M6c's x64 assembler added
**121**, for **543/543** in 3 m 37 s. The
suite assembles **seven** whole cx3576 images over fabricated inputs, which is
the price of having one full assembly in it rather than only at the gate — a
chain that runs end to end is the thing a table of unit refusals cannot assert.

Per-operation, which is where the design decisions came from:

| | |
|---|---|
| `Toolbox.open`, host route | ~4 ms |
| `Toolbox.open`, alpine + apk | ~2.1 s (assembly), ~4.6 s (coreutils) |
| `Toolbox.open`, debian + apt | ~12 s (x64 assembly), ~20 s (rauc + squashfs + openssl) |
| one `docker exec` into an open toolbox | ~40 ms |
| one `docker run --rm` — what a session avoids | ~320 ms |

The 4.6 s open is why `src/testing.ts` exists: it is **under** bun's 5 s default
and it flaked against it, which is the worst kind of limit — green on a warm
image cache and red on a cold one, for a reason unrelated to what is under test.
The tests that open a toolbox carry a number at the place that pays the cost,
rather than the whole suite being given a blanket `--timeout` that would also
hide a genuine hang in the tests that compute.

## Zero tests is a failure, and bun does not agree

Measured with bun 1.4.0 on 2026-08-25 — the same table `os/verify/HARNESS.md`
records, re-measured here rather than cited:

| situation | `bun test` exit status |
|-----------|------------------------|
| no test **file** matches the glob | 1 |
| a file matches and declares **no tests** | **0** — "Ran 0 tests across 1 file" |

So `run.sh` reads the count out of the run and turns `N = 0` red, and also
refuses a run that exits 0 without printing the count line at all.

**Both halves were driven, and the second only by mutating the guard**, because
nothing a caller can do makes bun print no count while exiting 0. M3a and M3b
each shipped a guard that was itself unreachable and was found exactly this way.

| driven | what happened |
|---|---|
| a test file declaring no tests, through `bun test` | `Ran 0 tests`, **exit 0** |
| the same file through `run.sh` | **exit 1**, "a suite that asserts nothing reports the same green as one that passes" |
| the count pattern mutated to match nothing | **exit 1**, "printed no 'Ran N tests' line" |
| a one-test filter (`Ran 1 test`, singular) | `RESULT: PASS (1/1 tests)` — a pattern insisting on the plural would call this vacuous |
| one deliberately red test | `RESULT: FAIL (bun test exited 1; 0 passed of 1 run)` |

## Driven from the failing side

Every guard in `run.sh`, run against the condition it exists to catch:

| driven | what it printed |
|---|---|
| `MOS_BUILD_BUN` and `MOS_BUILD_CONTAINER` both set | refused; "those are two different buns" |
| no docker client on `PATH` (stock `PATH` of symlinks with `docker` withheld), bun present | refused, naming the toolset it drives and `MOS_BUILD_DOCKER` |
| the same, and no bun either | the same refusal — docker is this package's requirement either way |
| `MOS_BUILD_DOCKER` naming a client that cannot reach a daemon | refused; "the client exists; the daemon does not answer" |
| `IMAGE_BUN_1` set to a tag | `from.sh`'s own refusal, naming the key and the file |
| `IMAGE_BUN_1` removed | `from.sh`'s refusal, naming the key |
| `IMAGE_BUN_1` a well-formed digest naming no image | refused **by the key**, before any run — `docker run` would have given exit 125, indistinguishable at this seam from bun exiting 125 |
| a copy of `run.sh` whose `REPO_ROOT` has no `Makefile` | the computed `HERE` and `REPO_ROOT`, and that one of them is stale |
| a copy with no `os/verify/package.json` beside it | the same, naming `os/verify` — so a reader is told *which* package moved |
| the repository mount replaced by an empty directory | every unseen path listed, and "the mount succeeded and delivered nothing" |
| the docker socket mount removed from the container route | refused; "the docker client works on this host but not inside the pinned bun container" |

`images.env` was restored after each mutation and `git diff` checked clean.

### The mount that succeeds and carries nothing

Re-measured on this host rather than cited from M3c, because the whole
container route depends on it:

```
$ echo hello > /tmp/m6a-probe/f.txt && cat /tmp/m6a-probe/f.txt
hello
$ docker run --rm -v /tmp/m6a-probe:/tmp/m6a-probe alpine sh -c 'ls -A /tmp/m6a-probe | wc -l; cat /tmp/m6a-probe/f.txt'
0
cat: can't open '/tmp/m6a-probe/f.txt': No such file or directory
```

A bind mount of anything under `/tmp` **succeeds and delivers an empty
directory**. That is why `src/paths.ts` puts this package's scratch space under
`os/build/.work/` (gitignored) and not under `/tmp`: every tool here may be
running in a container, so a scratch file the daemon cannot share is a file the
tool cannot see, reported as a file that does not exist.

### The boundary guards

`src/verify-package.test.ts`'s two source-sweep assertions were mutated to prove
they are reachable, which is the only way to know a pattern matches anything:

| driven | result |
|---|---|
| a second file in `src/` importing `../../verify/src/board.ts` | red — "sneaky.ts" listed beside `verify-package.ts` |
| a file in `src/` defining `export function parseBoardEnv` | red — the file named, and the pattern that caught it |
| both removed | green again, tree checked with `git status` |

The sweep excludes only its own file, and only for those two assertions: it has
to quote `../../verify/` and a `function parseBoardEnv` in order to search for
them. Every other file in the package, tests included, stays in scope. There is a
separate assertion that the sweep sees more than four files, so a walk that found
nothing cannot satisfy it by having nothing to object to.

## The geometry against bash, key for key

The parser was proven against `bash` in M3 (cx3576 141/141, x64 115/115). What
`os/build` adds is *derived* numbers, so the oracle was extended to those:
partition order, number, role, label, GUID, and the start and size **in sectors**
however the file spelled them.

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
. "$PWD/os/boards/${board}/board.env"
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
const { loadGeometry } = await import(`${process.cwd()}/os/build/src/geometry.ts`)
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

Result, 2026-08-25: **cx3576 12/12, x64 10/10.**

The `[ "$n" -gt 5 ]` guard on each side is not decoration — `os/verify`'s version
of this comparison was once run from the wrong directory and reported that the
parser agreed with the shell "on all 0 keys". The comparison was also checked to
be *live*: cx3576's bash output against x64's TypeScript output differs, and a
one-sector mutation of either side shows up in the diff.

## The tools, and the measurements that changed the code

Every wrapper is exercised against its real tool. These are the runs where the
tool did something other than what the code assumed, which is why they are
written down rather than summarised.

### sgdisk: one argv shape where the shell has two

Measured with sgdisk 1.0.10 over the same two partitions, comparing whole images:

| difference | result |
|---|---|
| flag order `new/name/type/guid` (v2) vs `new/type/guid/name` (x64) | byte-identical |
| `+131072S` vs `+64M` at 512-byte sectors | byte-identical |
| `--clear` on a freshly truncated (all-zero) file | byte-identical |
| `-a 1` where every start is already MiB-aligned | byte-identical |
| **`-a 1` where a start is sector 64** | 64 **vs 2048** — relocated, silently, exit 0 |

The suite re-runs the first four, so a different sgdisk disagrees *here* rather
than inside M6b's byte-identity gate, and the comparison carries its own
vacuity control: two images differing in one partition GUID must compare unequal.

`--verify`'s two failure shapes are both driven. The exit-0-with-problems shape
is produced by shrinking a disk under a valid table (`Identified 5 problems!`,
rc 0) — **not** by overlapping partitions, which was this test's first draft and
proves only the other shape: sgdisk refuses those outright with exit 4.

### debugfs: its exit status is not its verdict, and the reason given for that is wrong

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

`os/mkimage-common.sh` gives the reason for reading stderr as "a rename of `sif`
[would] turn this into a no-op that still reports success". That example does not
hold: an unknown command exits 1. The argument is right and the illustration is
not, and this wrapper's own first draft made the mirror-image mistake — it said
the exit status catches a filesystem debugfs cannot open, which it does not.

The last row is the one **neither** signal carries, and nothing else covers it:
`pin_seeded_times` generates its command file by parsing dumpe2fs's free-inode
ranges, so an empty one is precisely what a parse that understood nothing
produces — the pass runs, pins no timestamps, reports success, and EPHEMERAL
quietly stops rebuilding byte-identically. `debugfsApply` refuses it.

### rauc: `info` will not read a bundle without a keyring

`rauc info` with no `--keyring` exits 1 with "No keyring file or directory
provided" rather than reading it unverified. This wrapper's `--keyring` was
optional on the opposite assumption. Recorded so M6d does not find it by failure
while porting `verify_bundle`.

The bundle the `info` tests read is built in-test by a **distro** rauc, through
`bundleArgs` directly rather than through `bundle()` — because `bundle()` refuses
a distro toolset, which is the behaviour the tests either side of it drive. A
payload of one repeated byte will not do: rauc refuses a squashfs that compresses
to its own block size ("squashfs size (4096) must be larger than 4096 bytes"), so
the fixture is a fixed-seed LCG — deterministic and incompressible.

### mkfs.vfat: `-F 32` does not enforce FAT32

Driven at 32 MiB, the size `os/mkimage-x64.sh` measured: mkfs.vfat exits 0, mcopy
copies into it, mdir lists it — and the cluster count is below the 65525 the
specification requires, which is the one measurement that disagrees. That script
records the consequence: OVMF refused the ESP, it was absent from the firmware's
device list, and the machine dropped to the UEFI shell.

`readFatClusters` refuses an unreadable count rather than comparing it, because
`[ "" -lt 65525 ]` is a shell error and `undefined < 65525` is `false`.

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

Every toolset is opened and every tool in it is asked to answer, including
`x64-assembly`, which nothing else in this package uses: M6c is the milestone
that will, and a package list that is wrong should be wrong now. The
`e2fsprogs`-without-`e2fsprogs-extra` gap is driven as a negative, with the
correct package list as its positive control.

## THE BYTE-IDENTITY GATE: shell against TypeScript, cx3576

RFCT-112's gate. Same board definition, same prebuilt `_out/cx3576/` inputs, the
shell assembler and the TypeScript one, twice each.

```sh
cp -al /path/to/prebuilt/_out/cx3576 _out/cx3576        # preserving mtimes
cp -al /path/to/prebuilt/board/cx3576/out board/cx3576/out

bash os/mkimage-v2.sh                       # the oracle
bash os/mkimage-v2.sh                       # again -- it must reproduce ITSELF first
bash os/build/run.sh --mkimage-v2           # the port
bash os/build/run.sh --mkimage-v2

sha256sum _out/cx3576/cx3576-mos-v2-*.img
```

Result, 2026-08-26, this host — **eight images, one hash**:

```
f36bf80993583f6b9d097531a8efcd086e9aaaeabc014a367d7543582ecd8bce  cx3576-mos-v2-1787704793.img  shell
f36bf80993583f6b9d097531a8efcd086e9aaaeabc014a367d7543582ecd8bce  cx3576-mos-v2-1787704868.img  shell
f36bf80993583f6b9d097531a8efcd086e9aaaeabc014a367d7543582ecd8bce  cx3576-mos-v2-1787705464.img  TypeScript
f36bf80993583f6b9d097531a8efcd086e9aaaeabc014a367d7543582ecd8bce  cx3576-mos-v2-1787705541.img  TypeScript
f36bf80993583f6b9d097531a8efcd086e9aaaeabc014a367d7543582ecd8bce  cx3576-mos-v2-1787707325.img  TypeScript, re-run at the final tree
f36bf80993583f6b9d097531a8efcd086e9aaaeabc014a367d7543582ecd8bce  cx3576-mos-v2-1787707701.img  shell,      merged tree
f36bf80993583f6b9d097531a8efcd086e9aaaeabc014a367d7543582ecd8bce  cx3576-mos-v2-1787707707.img  shell,      merged tree
f36bf80993583f6b9d097531a8efcd086e9aaaeabc014a367d7543582ecd8bce  cx3576-mos-v2-1787707713.img  TypeScript, merged tree
```

The last three are the same measurement re-taken after merging M4c and M5b —
which deleted `os/rootfs/Dockerfile.v2` and rewired `os/rootfs/build-v2.sh`.
None of that is read by the assembler, and the hash says so rather than the
sentence saying so: **re-run the gate on the tree that ships, not on the tree
the port was written against.**

**A hash is the right comparison here and nowhere else in this campaign.** M5's
content-diff rule exists because the rootfs *build* does not reproduce itself.
Assembly does — R2/R4 made it so and `make os-mkimage-v2-test` asserts exactly
that — so the first two lines above are not ceremony: they are what makes the
last two evidence. Two assemblers over identical inputs must give identical
bytes, and if the oracle did not agree with itself there would be nothing to
compare against.

**The comparison was checked live.** The suite carries the control
(`src/mkimage-v2.test.ts`, "a changed input changes the bytes"): one different
U-Boot blob, everything else equal, and the images compare unequal. Without it,
"byte-identical" could be a comparison that always passes.

**Had they differed**, the report would have been the differing MiB blocks rather
than the fact of a difference:

```sh
cmp -l shell.img ts.img | awk '{printf "%d\n", int(($1-1)/1048576)}' | uniq -c
```

which names the MiB offsets that moved; mapping those against the layout
(`loader` at 0, `boot-a` at 18, `rootfs-a` at 146, `ephemeral` at 738 …) says
*which structure* moved rather than that something did.

### The one input difference that had to be found first

The prebuilt `_out/cx3576/` used here was produced from an **older commit** —
before `pin_seeded_times` existed — so the image sitting beside those inputs
hashes differently (`5412f708…`) and is **not** a valid oracle. The four hashes
above are all from *this* tree's assembler over those inputs. Checked, not
assumed: `cmp` of the two `os/mkimage-v2.sh` files, which differ.

### Cost, measured

| | |
|---|---|
| `bash os/mkimage-v2.sh`, container route | ~70 s |
| `bash os/build/run.sh --mkimage-v2` | ~55 s |
| `sha256sum` of one 1315 MiB image | ~4 s |
| the whole `src/mkimage-v2.test.ts` file (seven full assemblies, fabricated inputs) | ~45 s |

## Every ported refusal, and the mutation that drives it red

`os/mkimage-v2.sh` carries **33** `echo "error:` sites, each with its own `exit
1`. All are ported; the table names where each is driven from the failing side. **A byte-identity gate
cannot see a dropped refusal** — a port that lost one produces identical bytes
for every good input and passes the gate perfectly, and what it stopped catching
is a board that needs re-flashing.

Every negative below has a **positive control** beside it in the same file: the
tree's own `boot.cmd`, the tree's own board definition, or the same input
unmutated. Without that, a guard that refused everything would satisfy the whole
table.

### slot-pin strict mode — `src/layout-cx3576.test.ts`, `src/mkimage-v2.test.ts`

| driven | what it printed |
|---|---|
| pin `0`, `-16`, `256.5`, `256M`, `' 256'`, `abc`, `+256`, `0256` | "is not a positive whole number of MiB", eight times |
| `MOS_ROOTFS_SLOT_MIB=` (set, empty) | the same — supplied-and-empty is a release build whose pin got lost, not a dev build |
| a 300 MiB payload against `--pin 256` | "300 MiB — 44 MiB too large", "frozen for every device already flashed", "shrink the rootfs instead" |
| **the same payload UNPINNED** | assembles; floor mode grows the slot to 384 MiB. The control that makes the row above a statement about the MODE |
| a pin equal to the board's own default (`256`) | still `mode: 'pinned'`, while unpinned is `mode: 'floor'` — selected by PRESENCE, never by value |

### boot-attempts range — `src/boot-cx3576.test.ts`

| driven | what it printed |
|---|---|
| `setenv BOOT_A_LEFT 10` | "sets a boot-attempts value of 10; RAUC writes this counter in hex and U-Boot compares it in decimal, so it must stay in 1..9" |
| `setenv BOOT_B_LEFT 0` | the same, "value of 0" |
| `1` and `9` | accepted — the boundaries themselves, so the range is a range |
| `BOOT_ATTEMPTS_MAX=5` on the board | "must stay in 1..5" — the range comes from the board, not from a literal |
| the tree's own file | four credits found, all `3`. Four, not two: the exhausted-both-slots recovery block resets both, and the shell greps the whole file for the same reason |

### stale partition number (THE RENUMBERING GUARD) — `src/boot-cx3576.test.ts`

| driven | what it printed |
|---|---|
| `bootpart` 4→5 for slot A | "sets 'bootpart' to '5' for slot A, but the layout puts that partition at p4" |
| `bootpart` 5→6 for slot B | the same, p5 |
| `rootpart` 6→7 for slot A | the same, p6 |
| `rootpart` 7→8 for slot B | the same, p7 |
| `setenv bootpart` renamed away entirely | "sets 'bootpart' to 'nothing' for slot A" — not a comparison against `undefined` |
| `BOOT_A_PARTNUM=99` on the board | "the layout puts that partition at p99" — the expected numbers come from the layout |
| all four, through a whole assembly | the build stops before anything is written |

The scan's shape is driven too: it latches on `setenv bootslot <slot>` and takes
the FIRST following assignment, never unlatches, and ignores leading whitespace —
transcribed rather than tidied, because a scan that read a different line would
agree with the shell on today's file and disagree on the next one.

### loader content — `src/mkimage-v2.test.ts`

| driven | what it printed |
|---|---|
| a blob whose first bytes are not `RKNS` | "starts with '33333333', not the Rockchip idbloader magic '524b4e53' ('RKNS'); the RK3576 BootROM would not recognise it at sector 64" |
| a blob one byte over `UBOOT_MAX_BYTES` | "does not fit between sector 64 and uenv-a at 16 MiB" |
| a blob **exactly** `UBOOT_MAX_BYTES` | assembles — the control that makes the row above `>` and not `>=` |
| a 2 MiB image of zeros, read at sector 64 | "the first bytes of the loader partition are '00000000', not the idbloader magic '524b4e53'" |
| the same image with the blob dd'd in, read at sector **2048** | refused — it reads at the start sector it is GIVEN, so a relocated partition points at nothing |
| a file with two bytes in it | "has only 2 byte(s) at offset 0, and 4 were read" — a short read is not a wrong magic |

### the uboot-mos-only rule — `src/mkimage-v2.test.ts`

| driven | what it printed |
|---|---|
| `uboot-mos` absent | "build it with 'make -C board/cx3576 uboot-mos'", "is NOT a substitute", "CONFIG_ENV_IS_NOWHERE", "silently never run the RAUC A/B handshake" |
| `uboot-mos` byte-identical to the debug build | "is byte-identical to the debug build at …", quoting the env offsets the real variant carries, and "do not copy or symlink the other variant into place" |
| **no debug build present at all** | assembles. The control: its absence disables nothing else, and without this the guard could be "always refuses" |
| through the CLI, with no `uboot-mos` on disk | the same sentence, plus "note: BOARD_DIR is currently …" |

### the five RFCT-112 names, and the twenty-nine others

RFCT-112 lists five guards. The script carries **thirty-three refusals**, and the
rest are ported and driven too:

| refusal | driven in |
|---|---|
| `board.env` not found | `mkimage-v2-cli.test.ts` — refused by name |
| `boot.cmd` not found | `mkimage-v2.test.ts` |
| verity env filenames are not `<base>-a.env`/`<base>-b.env` | `boot-cx3576.test.ts`, both sides, plus a renamed base that stays consistent |
| `rauc.slot=${bootslot}` missing from `boot.cmd` | `boot-cx3576.test.ts` — **`replaceAll`**, because the token appears in a comment too and a replace that changed only the comment is a negative test that is not negative |
| the per-slot verity env load missing | `boot-cx3576.test.ts`, and the pattern it looks for is derived from the board |
| no `dm-mod.create=` | `boot-cx3576.test.ts` |
| no `dm-mod.waitfor=` | `boot-cx3576.test.ts`, and through a whole assembly |
| the table does not name this slot's PARTUUID | `boot-cx3576.test.ts`, and slot B pointed at rootfs-a through an assembly |
| the `waitfor` names a different partition from the table | `boot-cx3576.test.ts` |
| the table carries a different root hash | `boot-cx3576.test.ts` |
| `FACTORY_VAR` absent / a file / without `lib/` | `mkimage-v2.test.ts`, all three |
| kernel, dtb, rootfs-verity.img/.env, both cmdlines absent | `mkimage-v2.test.ts`, five cases, each asserting the sentence that says what MAKES it |
| the three loader identities | `layout-cx3576.test.ts` individually and all three at once; `mkimage-v2.test.ts` through an assembly |
| payload not a whole-MiB multiple / zero bytes | `mkimage-v2.test.ts` |
| `VERITY_ROOT_HASH` missing | `mkimage-v2.test.ts` |
| salt not the pinned one | `mkimage-v2.test.ts`, with an UPPERCASE salt as the case-folding control |
| `sgdisk --verify` reporting problems | `src/tools/sgdisk.test.ts` (M6a) — both shapes, including problem text with exit 0 |
| the assembled loader partition moved | below — the alignment proof |
| the rootfs input / BSP input messages | `mkimage-v2-cli.test.ts`, asserting they are DIFFERENT sentences |

Two are covered at the wrapper rather than through the assembler, and are marked
as such above: `sgdisk --verify`'s two failure shapes (M6a drove both) and the
board-file-absent refusal (`loadBoard`'s, one layer down).

## THE LOADER-ALIGNMENT PROOF

The one difference between the two shell assemblers that M6a measured **not** to
be cosmetic. Driven against a real sgdisk in `src/mkimage-v2.test.ts`, over the
real cx3576 geometry on a sparse 1315 MiB file:

| alignment | what sgdisk did | what caught it |
|---|---|---|
| `-a 1` (the board's) | loader at **64**, 32704 sectors | — it is correct |
| **omitted** | loader at **2048**. Exit **0**. `sgdisk --verify` says "No problems found" | the read-back: "the assembled loader partition is 30720 sectors at 2048, expected 32704 at 64" |
| `-a 2048` | the same silent relocation | the same read-back |
| `-a 4096` | uenv-b moves into boot-a; sgdisk **refuses the table**, exit 4, saves nothing | `writeGpt`'s own `must()` |

**The three do not fail alike, and that is recorded rather than smoothed over.**
A check written only against silent relocation would be right about what it
caught and wrong about what it thought it was catching.

The size half is driven separately (a partition starting at 64 and 1000 sectors
long is refused), because a check that looked only at the start would pass a
loader partition that begins in the right place and stops before the bootloader
ends.

And in the finished image: `out.loaderStartSector === 64n`,
`out.loaderSizeSectors === 32704n`, and the four bytes at byte 32768 are
`524b4e53`.

## The derived layout against bash, payload for payload

The slot arithmetic and the whole start chain, against a shell that reads the
same `board.env`. Like the geometry oracle, **deliberately not in the suite**: it
sources a board definition.

```sh
cat > /tmp/slot-oracle.sh <<'SH'
#!/usr/bin/env bash
set -euo pipefail
. os/boards/cx3576/board.env
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
const { loadGeometry } = await import(`${process.cwd()}/os/build/src/geometry.ts`)
const { decideSlot, deriveLayout } = await import(`${process.cwd()}/os/build/src/layout-cx3576.ts`)
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

Result, 2026-08-26: **agrees on all 16 payload sizes**, slot and full chain.

**Checked live**, because an oracle that agrees for the wrong reason is the
failure this tree keeps finding in its own checkers. Dropping the `+ 99` from the
shell side — turning the ceiling into a floor — diverges at 205 MiB (256 against
272) and at 410 MiB:

```sh
sed 's/+ 99) \/ 100/) \/ 100/' /tmp/slot-oracle.sh > /tmp/slot-oracle-floor.sh
bash /tmp/slot-oracle-floor.sh | diff - /tmp/slot-ts.txt   # must differ
```

## pin_seeded_times, and the two halves of its claim

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

### Measured while porting, and it corrects a guess I had made

`mke2fs -d` with `E2FSPROGS_FAKE_TIME` set, on a source file touched to
`@1000000000`, alpine 3.21:

```
ctime:  0x6a8e3b33  the SOURCE's ctime -- the fake time does not reach it
atime:  0x3b9aca00  the SOURCE's atime (1000000000)
mtime:  0x3b9aca00  the SOURCE's mtime
crtime: 0x5e0be100  mke2fs's own invention -- and the fake time DOES pin this
```

exactly as `os/mkimage-common.sh` describes. But `lost+found` — inode 11, which
mke2fs creates itself — gets the fake time in all four, so **sampling the first
in-use inode finds the pass already done and proves nothing**. The test asserts
over every in-use inode, and requires at least one to have differed beforehand.

Without `E2FSPROGS_FAKE_TIME`, atime came back as the wall clock rather than the
source's — because reading the source to make the copy is itself what bumps it
under relatime, which is the second half of that file's argument, observed.

## THE BYTE-IDENTITY GATE: shell against TypeScript, x64

RFCT-112's second gate, M6c's. Same board definition, same prebuilt `_out/x64/`
inputs, the shell assembler and the TypeScript one, twice each.

```sh
cp -al /path/to/prebuilt/_out/x64 _out/x64        # preserving mtimes
rm -f _out/x64/x64-mos-v2-*.img                   # the prebuilt image is NOT an oracle -- see below

bash os/mkimage-x64.sh                            # the oracle
bash os/mkimage-x64.sh                            # again -- it must reproduce ITSELF first
bash os/build/run.sh --mkimage-x64                # the port
bash os/build/run.sh --mkimage-x64

sha256sum _out/x64/x64-mos-v2-*.img
```

Result, 2026-08-26, this host — **seven images, one hash**:

```
bdf340e93a553a02ef4c1774dcba78db20520b09fc6faf5c8c76e0cb94575a8f  x64-mos-v2-1787708550.img  shell
bdf340e93a553a02ef4c1774dcba78db20520b09fc6faf5c8c76e0cb94575a8f  x64-mos-v2-1787708613.img  shell
bdf340e93a553a02ef4c1774dcba78db20520b09fc6faf5c8c76e0cb94575a8f  x64-mos-v2-1787709504.img  TypeScript
bdf340e93a553a02ef4c1774dcba78db20520b09fc6faf5c8c76e0cb94575a8f  x64-mos-v2-1787709624.img  TypeScript
bdf340e93a553a02ef4c1774dcba78db20520b09fc6faf5c8c76e0cb94575a8f  x64-mos-v2-1787711949.img  TypeScript, re-run at the final tree
bdf340e93a553a02ef4c1774dcba78db20520b09fc6faf5c8c76e0cb94575a8f  x64-mos-v2-1787712511.img  shell,      MERGED TREE (M5c)
bdf340e93a553a02ef4c1774dcba78db20520b09fc6faf5c8c76e0cb94575a8f  x64-mos-v2-1787712531.img  TypeScript, MERGED TREE (M5c)
```

**Runs 6 and 7 are the same measurement re-taken after merging M5c**, which
rewrote the rootfs stage chain into nine stages and replaced the `WITH_*` build
arguments with `--without NAME` stage selection. None of that is read by the
assembler, and the hash says so rather than the sentence saying so — which is the
same reason M6b re-took its own gate after M4c and M5b landed.

**The fifth is not ceremony.** Runs 3 and 4 were taken before `espSizeFaults` was
deleted from the assembly path and before the boot-slot comparison was extracted
into `bootSlotFault`. Neither of those should touch a byte, and "should" is what
this rule refuses: the fifth run is the tree that ships, `git status` clean, and
it produces the same hash. **Re-run the gate on the tree that ships, not on the
tree the port was written against.**

**Take the hashes from inside the worktree.** `/tmp` and `/srv` are shared across
the concurrent worktrees on this host; a generic scratch filename is not evidence
of whose bytes it holds. These five were read from `_out/x64/` directly.

1938 MiB, nine partitions, seven filesystems (three FAT32, four ext4), 512 MiB
per rootfs slot from a 240123904-byte payload.

### The prebuilt image beside the inputs is NOT an oracle

The same trap M6b nearly walked into, and it is **sharper for x64**. The
prebuilt `_out/x64/` was produced at `ab6ffe3`, before R1 added the five
determinism controls: that tree's `os/mkimage-x64.sh` contains **zero**
occurrences of `--invariant` or `E2FSPROGS_FAKE_TIME` where this tree's contains
eight, and it has no `os/mkimage-common.sh` at all. So the image sitting beside
those inputs is the output of an assembler that pinned **nothing** — FAT
directory times, ext4 `s_wtime`, `s_lastcheck` and `s_hash_seed` all live — and
it hashes

```
095f718e6593891df19638c4f5f37c3d550cbce11b1758e69800433b46e1c5d2   <- NOT the gate's value
```

Comparing against it would have reported a divergence that is not one. Checked,
not assumed: `grep -c` of the two files, and the absent shared file.

**Two shell runs on THIS tree are what make the TypeScript runs evidence.**
Assembly reproduces itself — R1 made it so — so two assemblers over identical
inputs must give identical bytes, and if the oracle did not agree with itself
there would be nothing to compare against.

**The comparison was checked live.** The suite carries the control
(`src/mkimage-x64.test.ts`, "...and ONE changed input changes the bytes"): one
different rootfs payload, everything else equal, and the images compare unequal.

**Had they differed**, the report would have been the differing MiB blocks rather
than the fact of a difference:

```sh
cmp -l shell.img ts.img | awk '{printf "%d\n", int(($1-1)/1048576)}' | uniq -c
```

mapped against the x64 layout: `esp` at 1, `boot-a` at 65, `boot-b` at 161,
`rootfs-a` at 257, `rootfs-b` at 769, `meta` at 1281, `state` at 1297,
`ephemeral` at 1361, `data` at 1873.

### Cost, measured

| | |
|---|---|
| `bash os/mkimage-x64.sh` | ~70 s |
| `bash os/build/run.sh --mkimage-x64` | ~27 s |
| the whole `src/mkimage-x64.test.ts` file (three full assemblies, fabricated inputs) | ~70 s |
| `make os-build-test`, the whole suite at 543 tests | ~3 m 37 s |

## Every x64 refusal, and the mutation that drives it red

`os/mkimage-x64.sh` carries **11** `echo "error:` sites, each with its own `exit
1`, and it sources `os/mkimage-common.sh`, which carries **3** more — **14
reachable refusals**. RFCT-112 names five. There is also one guard with no
message of its own (`sgdisk --verify`, line 471, refusing under `set -e`).

All 14 are ported. Every negative below has a **positive control** beside it in
the same file; without one, a guard that refused everything would satisfy the
whole table.

| # | shell | ported to | driven red by |
|---|---|---|---|
| 1 | `:83` five inputs absent | `requiredInputs`/`requireFile` | each of the five, absent; plus a DIRECTORY where a file belongs |
| 2 | `:157` FACTORY_VAR not a directory | `assembleX64` | absent, and a FILE in its place |
| 3 | `:174` unrendered placeholder | `unrenderedPlaceholders` | an unknown `@NOT_A_KEY@`; and a substitution REMOVED from the map |
| 4 | `:190` literal hash on a linux line | `literalHashLines` | a 64-hex hash spliced onto both linux lines |
| 5 | `:198` fragment variable unused | `unusedFragmentVars` | each of the five, `replaceAll`'d away |
| 6 | `:265` ESP cluster floor | `checkEspIsFat32` | a real 32 MiB `mkfs.vfat -F 32`; and a whole assembly on a mutated board |
| 7 | `:300` grubenv not 1024 bytes | `checkGrubenvSize` | 0, 1023 and 1025 |
| 8 | `:325` per-slot file on the ESP | `strayEspEntries` | each of the three names, one at a time |
| 9 | `:357` the two boot slots differ | `bootSlotFault` | a listing with one entry dropped |
| 10 | `:412` factory /var has no `lib/` | `assembleX64` | a staged tree with only `cache/` |
| 11 | `:514` "image assembly failed" | — | see below |
| 12 | `common:99` inode geometry unreadable | `dumpe2fsHeader` | M6b's `src/pin-seeded-times.test.ts` |
| 13 | `common:117` inode count cross-check | `refuseUnlessCountsAgree` | M6b's, with a truncated listing |
| 14 | `common:126` debugfs stderr | `debugfsApply` | M6b's, with a renamed `sif` |

**Number 11 has no analogue, and that is a structural difference rather than a
dropped guard.** `error: image assembly failed` is the one line the HOST prints
when its `docker run` exits non-zero — it exists because the shell re-execs a
whole script inside a container and has nothing but an exit status to report. The
port has no second process: every tool call goes through `Toolbox.must`, which
throws a `ToolError` carrying the argv, the route, stdout and stderr. So the
information that line was standing in for is delivered per call, by the call that
failed, and there is nothing left to wrap. `src/toolbox.test.ts` drives that
path.

### The controls, listed, because they are what make the table mean anything

- **the five inputs**: all five present, and the assembly proceeds;
- **the shipped `grub.cfg`**: renders clean through all three text guards, with
  two linux lines and every fragment variable referenced;
- **a hash in a COMMENT and a hash in an `echo` line**: neither fires guard 4.
  These are the two false positives `os/mkimage-x64.sh` records having shipped,
  where an earlier draft grepped for the word "verity" and rejected the correct
  file;
- **a PARTUUID**: 32 hex digits in five dash-separated groups, longest unbroken
  run 12 — which is why guard 4's threshold is `{32,}` and not `{12,}`, asserted
  from both sides;
- **grubenv at 1024**: passes, and a real `grub-editenv grubenv create` makes one
  of exactly that size;
- **a clean ESP listing**: no strays; and a per-slot name NESTED under `EFI/` is
  not a stray either, because the shell greps with `-x` at the root;
- **the pinned salt in UPPERCASE**: accepted, so the salt comparison is not a
  literal one.

## THE ESP CLUSTER FLOOR: why its POSITION is the whole check

`os/mkimage-x64.sh:263` parses **free** clusters out of minfo's FSInfo sector.
The FAT specification defines the type by **total** clusters. Those are not the
same number, and the check is correct anyway — *where it stands*.

Measured on a 64 MiB ESP, this host:

| | |
|---|---|
| `free clusters=` immediately after `mkfs.vfat` | **129021** |
| total clusters, computed from the BPB | **129022** |
| `free clusters=` after the ESP tree is staged (12 MiB) | **117119** |

On an empty filesystem free is total minus the root directory's one cluster, so
the comparison is conservative by exactly one. **After the `mcopy` it is a
free-space check**: it would refuse a valid FAT32 for being full while printing a
message about the FAT specification, and it would stop refusing the case it
exists for as soon as the payload grew. Moving it is the natural tidy-up during a
port, and it is silent.

So it is ported **where it stands**, immediately after `mkfs.vfat` and before
anything is copied in, with that reasoning attached to `checkEspIsFat32`.

**minfo prints no total at all** — only `free clusters=` in its Infosector block.
That is *why* the shell reads free. `src/mkimage-x64.test.ts` derives the total
from the BPB (`big size − reserved − fats × Big fatlen) / cluster size`) purely
to MEASURE the relationship; the shipped check still reads free, where the shell
reads it.

Driven both ways: a real 32 MiB `mkfs.vfat -F 32` (which exits 0, which minfo
calls FAT32, and which OVMF left out of its device list entirely) is refused; a
64 MiB one is accepted; 33 MiB — the measured floor — passes.

And it is driven **through a whole assembly** on a board mutated to
`ESP_SIZE_MIB=32`, so its call site cannot be deleted unnoticed. A guard only ever
called directly is a guard whose caller could have dropped it, which is exactly
what `os/tests/mkimage-x64-selftest.sh` says a byte-identity gate cannot see.

## THE ALIGNMENT: `-a 2048` where the shell passes none

The one spelling this port changed on the `sgdisk` call. `os/mkimage-x64.sh`
passes no `-a` at all and takes sgdisk's default; this passes the board's
`GPT_ALIGN_SECTORS`, which x64 declares as 2048 — the same number. Measured over
the real x64 geometry with real partition GUIDs (sgdisk invents random ones when
they are not given, so a probe that omits them compares nothing):

| alignment | what sgdisk did |
|---|---|
| omitted (sgdisk's default) | esp at 2048, 131072 sectors |
| `-a 2048` (the board's) | **byte-identical table** |
| `-a 1` | byte-identical too — nothing here needs relocating |
| `-a 4096` | esp **moved to 4096 AND shrunk to 129024 sectors**, exit **0** |

**The `-a 4096` row is not what M6b measured on cx3576, and that matters.** There
sgdisk *refuses* the table (exit 4), because the relocation would push uenv-b into
boot-a and there is no room. Here there is room, so it relocates silently — and it
does not only move the ESP, it truncates it to stop at boot-a's original start.
The two boards' third alignment case is a **different failure**, and the shape
depends on the geometry rather than on the flag.

Which is why `src/mkimage-x64.ts` READS THE ASSEMBLED TABLE BACK and compares
every partition against the spec (`partitionFaults`). On this board a wrong
alignment does not announce itself at all, so the read-back is the only thing
that would report it. Driven red against a real `-a 4096` table and green against
the one the assembler actually writes.

## How `layout-x64.ts` differs from `layout-cx3576.ts`, and why it is a second file

Three differences, each of which changes a number or a behaviour:

1. **The headroom is applied in BYTES.** `os/mkimage-x64.sh:117` is
   `(rootfs_bytes * PCT / 100 + MIB_BYTES - 1) / MIB_BYTES` — percentage first,
   on the byte count, then the ceiling to MiB. cx3576's is
   `(payload_mib * pct + 99) / 100`, with the ceiling to MiB first. Measured:
   the two **agree on all 2048 whole-MiB payloads** and disagree on thousands of
   others — 12583292 bytes gives **16 MiB** one way and **32** the other, and the
   difference survives the 16 MiB alignment rather than being absorbed by it.
   (`os/mkimage-v2.sh` refuses a payload that is not a whole MiB;
   `os/mkimage-x64.sh` never checks, so the disagreement is reachable.)
2. **There is no pinned mode.** `os/mkimage-v2.sh` captures
   `${MOS_ROOTFS_SLOT_MIB+set}` *before* sourcing the board file, so an
   environment pin selects the frozen-geometry mode. `os/mkimage-x64.sh` sources
   `board.env` at line 74 and reads `MOS_ROOTFS_SLOT_MIB` at line 119 — the
   board's 512 has already overwritten anything the environment said. x64 has one
   mode, the floor, and `layout-x64.ts` has one too. Adding a pinned mode would
   give the x64 release path a behaviour its shell has never had, inside the
   milestone whose job is to prove nothing changed.
3. **The partition set and the alignment.** Nine partitions against eleven, no
   loader and no uenv pair, and no `checkLoaderLanded` because there is no loader
   to land — replaced by the whole-table read-back above, for the reason that
   section gives.

What they DO share is shared as modules and not copied: `src/geometry.ts`,
`src/pin-seeded-times.ts`, `src/tools/`, and the board files themselves.

### The derived chain, against bash

`src/layout-x64.test.ts` drives `decideSlot` against a bash `$(( ))` oracle over
13 payloads — one byte either side of the floor (416074957/416074958) and of two
alignment steps (429496730/429496731, 442918503/442918504), plus 1 byte, 1 MiB,
2 GiB and 4 GiB − 1.

The three constants are passed to bash as **arguments** rather than by sourcing
`os/boards/x64/board.env`: an oracle that read the board file would be testing
the parser this comparison is meant to be independent of.

**And the oracle was checked to be live.** Dropping the `+ mib - 1` turns the
ceiling into a floor. It is *not* visible at every payload — at 12583292 bytes
both spellings still land on 16 after alignment, so a test that tried only that
one would call a broken oracle live. At 268435457 bytes the ceiling gives 336 and
the floor gives 320, and that is the payload the mutation is driven at.

## `cp -a` ON THE HOST — the opposite of what M6b did, deliberately

`os/mkimage-v2.sh` stages the factory `/var` **inside** its container.
`os/mkimage-x64.sh` stages it **on the host** (line 161, outside its `docker
run`) and runs everything else inside. Each port stages where its own shell
stages.

That is not fastidiousness. `cp -a` is `--preserve=all`, which includes
**xattrs**; `mke2fs -d` copies xattrs into the image; and this campaign's host
runs SELinux (`system_u:object_r:container_file_t:s0` on the factory `/var`
tree) while neither container does. Moving that one step to the other side of the
boundary would change EPHEMERAL's bytes, and **the only thing that would report
it is the gate** — as a diff in the middle of a 512 MiB filesystem.

`stageFactoryVarOnHost` is its own function so the one step that deliberately
runs outside the container is visible as such, with the reason travelling with
it. `cp -a`, not node's `cpSync`: node preserves neither ownership nor xattrs and
would produce a different filesystem while reporting success.

`cp`, `find` and `touch` are still declared in `X64_ASSEMBLY.tools`, because the
assembly runs all three **inside** the container — `cp` for the ESP staging,
`find ... -exec touch` for the mtimes, `touch` for the seed stamp and the
per-slot payload. `grub-editenv` joined them for a related reason: it comes from
`grub-common` and `grub-mkstandalone`'s EFI target from `grub-efi-amd64-bin`, so
"grub is installed" is not one fact.

### Measured while porting: `touch -h` does not create

A first draft collapsed the shell's `: >file` plus `touch -h -d` into one
`touch -h -d`. `-h` makes touch operate on the link rather than its target, so on
a path that does not exist it does not create one:

```
touch: setting times of '.../.mos-var-seeded': No such file or directory
```

Forty steps into an assembly. It is two calls again, both in the container, where
the shell has them.

## THE BYTE-IDENTITY GATE: shell against TypeScript, the cx3576 bundle

RFCT-112's third gate. Same board definition, same `_out/cx3576/` inputs, same
`board/cx3576/out/kernel/`, same `os/update/rauc/.devkeys`, the shell bundle
builder and the TypeScript one.

```sh
bash os/update/rauc/gen-dev-keys.sh                # the signing material
MOS_BOARD=x64 bash os/update/rauc/build.sh         # the HOST's rauc: amd64
bash os/update/rauc/render-config.sh               # system.conf is generated

make os-bundle-cx3576                       # the oracle
make os-bundle-cx3576                       # again -- it must reproduce ITSELF first
bash os/build/run.sh --bundle               # the port
```

**THE COMPARISON IS THE PAYLOAD, NOT THE FILE, and the shell is what says so.**
`verify_bundle` prints the digest of the squashfs at the head of the bundle and
explains the rest in the same breath: "the bytes after it are not [a pure
function of the inputs] — rauc salts the bundle's own verity hash tree at random
and the CMS signature carries a signingTime attribute". Two correct builds of
the same version therefore differ after the payload and must not differ inside
it. Measured: the `hash` field `rauc info` reports moved on every one of the
four runs below (`56112b4d…`, `a17d3ea1…`, `e9ed9dc5…`, …) while the payload
digest did not.

Result, 2026-08-26, this host:

```
114425856 bytes  d7506b6279e6f3643da8938d0be8a025abe01bb1ea10ad57abcd9ad753d86aea  shell
114425856 bytes  d7506b6279e6f3643da8938d0be8a025abe01bb1ea10ad57abcd9ad753d86aea  shell, again
114425856 bytes  d7506b6279e6f3643da8938d0be8a025abe01bb1ea10ad57abcd9ad753d86aea  TypeScript
114425856 bytes  d7506b6279e6f3643da8938d0be8a025abe01bb1ea10ad57abcd9ad753d86aea  shell,      merged tree
114425856 bytes  d7506b6279e6f3643da8938d0be8a025abe01bb1ea10ad57abcd9ad753d86aea  TypeScript, merged tree
```

The last two are the same measurement re-taken after the L2 branch moved under
this worktree TWICE while the port was being written: M4f, which added six
modules and 250 tests to `os/verify` — a package `os/build` imports its board
model from and typechecks against — and then M5's board parameterisation of
`os/rootfs/stages/40-board.Dockerfile`, which added three tests to `os/build`'s
own suite. Neither is read by the bundle builder, and **the hash says so rather
than the sentence saying so**: re-run the gate on the tree that ships, not on
the tree the port was written against. The one-byte control was re-run at each
of the three trees and moved the digest at each of them.

And `rauc info` reports the same checksum for each image INSIDE the bundle,
which is the same fact read a second way — by rauc rather than by `sha256sum`,
and per slot class rather than over the whole payload:

```
rootfs.img  05b72468d04d35aca78f59072568f6e2ef9b17c4eab30e09e6413135f49b15ba   shell and TypeScript
boot.vfat   caf90a14a5c8b2484084267df5246b82b8a889af41ac8c77efc4544f804c7623   shell and TypeScript
```

**The comparison was checked live.** One byte of `_out/cx3576/rootfs-verity.img`
flipped at offset 4096 (`0342` → `001`, confirmed with `cmp -l`), both builders
re-run over the mutated input, the byte restored and the file `cmp`-verified
identical again:

```
114425856 bytes  782532ada1d2f50931c6b51b5b6f0cdccb148c74ac1a629d43bbf24440b489c9  shell,      one byte changed
114425856 bytes  782532ada1d2f50931c6b51b5b6f0cdccb148c74ac1a629d43bbf24440b489c9  TypeScript, one byte changed
114425856 bytes  782532ada1d2f50931c6b51b5b6f0cdccb148c74ac1a629d43bbf24440b489c9  both,       merged tree
114425856 bytes  782532ada1d2f50931c6b51b5b6f0cdccb148c74ac1a629d43bbf24440b489c9  both,       merged tree, again
```

Three things at once: the gate can report a difference, the two implementations
agree about the *changed* input as well as the unchanged one, and the difference
is confined to the half that changed — `rauc info`'s `rootfs.img` checksum moved
to `6c5afc49…` while `boot.vfat` stayed at `caf90a14…`.

**The suite carries the same control in miniature** (`src/bundle.test.ts`, "THE
PAYLOAD IS A PURE FUNCTION OF THE INPUTS" and "AND IT MOVES WHEN AN INPUT
DOES"), over fabricated inputs and a self-signed pair, so a change that puts a
clock back into the staging path is a red test rather than a hash somebody has
to remember to compare.

### The inputs, and what was checked about them before they were trusted

`_out/cx3576/` and `board/cx3576/out/kernel/` were copied from `1w0jf032`'s
worktree (same host, built 2026-08-25 12:34). They are the M5/BSP outputs and
neither milestone is M6d's; what matters is that both builders get the *same*
ones. **The prebuilt `mos-cx3576-*.raucb` sitting beside them was NOT used as an
oracle** — M6b and M6c each nearly compared against an artefact that predated a
determinism fix. What was checked instead:

- `diff` of that tree's `os/update/bundle.sh` against this one's — **identical**,
  so the oracle run here is the same program;
- `RAUC_VERSION v1.13` in its `rootfs-report-v2.txt` against this tree's
  `os/update/rauc/versions.env` (`RAUC_VERSION=v1.13`) — the bundle builder's own
  cross-check would have refused them otherwise;
- the rauc binary was **built here**, from this tree's pin, rather than copied
  from any of the four worktrees that already had one.

### Cost, measured

| | |
|---|---|
| `make os-bundle-cx3576` (shell, container route) | ~45 s |
| `bash os/build/run.sh --bundle` | ~22 s |
| `src/bundle.test.ts` (six real bundles, fabricated inputs) | ~32 s |
| `src/bundle-cli.test.ts` (pure) | ~22 ms |

The port is roughly twice as fast, and the reason is structural rather than
clever: the shell re-execs itself inside a container that runs `apt-get install`
on every build, while the toolbox opens one session and `docker exec`s into it.

## Every bundle refusal, and the mutation that drives it red

`os/update/bundle.sh` carries **28** `echo "error:` sites. All are ported, as
**29** refusals — the signing-material site has two different sentences and
which one a reader gets decides whether they run `make os-devkeys` or go and
look for their own typo — plus **2 that are new**, for **31** in total.

**A byte-identity gate cannot see a dropped refusal.** A port that lost one
produces identical bytes for every good input and passes the gate perfectly;
what it stopped catching is a signed bundle that bricks a slot. Every negative
below has a **positive control** beside it in the same file, and every mutation
goes through a `mutate()` that throws when the replacement matched nothing.

### the rauc version cross-check — `src/bundle.test.ts`

Three of its four refusals are about the COMPARISON rather than about a
mismatch, because each of them would otherwise make it pass by finding nothing.

| driven | what it printed |
|---|---|
| the report file absent | "the image's RAUC version is unknown and a bundle built by an unknown-matching rauc is not one this can vouch for" |
| a report with the `RAUC_VERSION` line deleted | "records no RAUC_VERSION … either way the comparison would pass by finding nothing" |
| a build env carrying only `RAUC_SHA256` | "no RAUC_VERSION from /os/update/rauc/out-amd64/RAUC_VERSION.env … would pass by finding nothing" |
| no build env path at all | the same sentence, with `<unset>` where the path goes |
| `v1.13` in the image, `v1.8` here | "this rauc is v1.8, the image ships v1.13" — commit 9a43a59's case, which was found by failure |
| `v1.130` against `v1.13` | refused: the comparison is a STRING, and it is the one place a numeric reading would say `1.8 > 1.13` |
| **both halves agreeing** | "rauc v1.13 here, v1.13 in the image" — the control |
| the report read with `=` and the build env read with a space | both find nothing: two files, two shapes, and reading either with the other's separator is the failure this exists to prevent |

### the boot-attempts range, and THE EMPTY READ — `src/bundle.test.ts`

| driven | what it printed |
|---|---|
| **the tree's own `boot.cmd`** | accepted, and the guard reports it SAW **4** credits, all `3`. Not "the target exited 0" — the count is what distinguishes a guard that compared four values from one that compared none |
| `setenv BOOT_A_LEFT 10` | "boot-attempts value of 10 … must stay in 1..9" |
| `BOOT_A_LEFT 3` → `0` | the same, "value of 0" — the other end of a range |
| **every `BOOT_[AB]_LEFT <n>` renamed away** | "sets no BOOT_A_LEFT/BOOT_B_LEFT credit at all … would pass by finding nothing" |
| an EMPTY boot.cmd | the same refusal — not "nothing wrong here" |
| a credit inside a COMMENT | found: the shell's `grep -oE` is deliberately not anchored to `setenv`, and the port is not either |

**The empty read is the one behavioural difference between the two.**
`os/update/bundle.sh` reads the credits through `done < <(grep -oE … | awk …)`;
with `boot.cmd` missing or carrying no credit, grep produces no stdout, the
`while read` body never runs and the guard passes having compared nothing —
before `mkimage` dies on the same path, which is how `os-bundle-cx3576` stayed
broken through two merges earlier in this campaign. It can only ever turn a
vacuous pass into a refusal.

`os/mkimage-v2.sh`'s copy of the same guard has the same shape and is covered by
accident: `checkBootCmdTokens` runs immediately after it and refuses a `boot.cmd`
with no `rauc.slot=` in it. **The bundle path runs no such second guard** — it is
the one place the hole is reachable, which is why the refusal is added there and
not in `checkBootAttempts`, which both share.

### the per-slot verity env — `src/bundle.test.ts`

| driven | what it printed |
|---|---|
| `dm-mod.create=` replaced by `root=/dev/mmcblk0p5` | "carries no dm-mod.create=/dm-mod.waitfor= verity table for slot A" |
| `dm-mod.waitfor=` replaced by `rootwait` | the SAME sentence — `os/mkimage-v2.sh` gives the two their own, `os/update/bundle.sh` does not, and each keeps its own words |
| **slot B's CORRECT cmdline under slot A's GUID** | "does not reference PARTUUID … each slot must point dm-verity at its own rootfs partition". The mutation that matters most is not a malformed file: it is a correct file for the other slot. Both boot; one boots the wrong rootfs |
| a `waitfor` naming the other slot's partition | "the wait must name the same partition the verity table uses" |
| the root hash replaced with another 64 hex characters | "does not carry the root hash" |
| **the SALT replaced inside the table** | "does not carry the salt" — the check `os/mkimage-v2.sh` does NOT have. The assembler compares the salt against the pin; the bundle builder additionally requires it in the table it is about to SIGN |
| the GUID upper-cased throughout the cmdline | accepted — every identifier comparison folds case, because GPT tooling writes GUIDs uppercase and the kernel cmdline lowercase |
| a cmdline carrying TWO `dm-mod.create=` tables | the LAST one wins, which is what sed's greedy leading wildcard yields |
| **an unmutated slot-A and slot-B cmdline** | both accepted, each against its own GUID — the controls |

### the verity facts, and the pinned salt — `src/bundle.test.ts`

| driven | what it printed |
|---|---|
| `VERITY_ROOT_HASH` deleted | "VERITY_ROOT_HASH missing from … fix os/rootfs/build-v2.sh" |
| a salt of 64 `f`s | "does not match the pinned VERITY_SALT" |
| `VERITY_SALT` deleted entirely | "salt '' does not match" — an absent value does not compare equal to the pin |
| a salt with LETTERS, upper-cased on one side | accepted |
| **the file the rootfs build actually writes** | both facts read — the control |

**A mutation that was not a mutation, caught here.** The case-folding row above
was first written by upper-casing cx3576's own pinned salt. That salt is
`0000…0001` — all digits — so `toUpperCase()` is the identity, the fixture was
never broken, and the case would have passed by asserting that a guard stayed
quiet about an input it had no reason to complain about. `mutate()` threw. It is
the third instance of this shape in the campaign, after M6b's `String.replace`
that changed only a comment and M6c's `str.replace` that matched nothing.

### the grub branch — `src/bundle.test.ts`

| driven | what it printed |
|---|---|
| **each of the 8 `VERITY_*` keys deleted, one at a time** | "`<KEY>` missing from … the installed slot would get an incomplete dm-verity table and GRUB would refuse to boot it", eight times. One case per key, not one for the family: a loop that reads seven of eight names correctly is exactly the drift this is here to catch |
| `VERITY_ROOT_HASH=deadbeef` — present, and not a hash | "the cmdline fragment carries no root hash; every slot installed from this bundle would refuse to boot". NOT redundant with the row above: that one is about a MISSING value, this one about a present and unusable one |
| an UPPERCASE root hash | the same refusal — GRUB's reader is the lowercase one |
| **the file the rootfs build writes** | all eight rendered, in order, as `set MOS_*=…` — the control |

### the manifest — `src/bundle.test.ts`

| driven | what it printed |
|---|---|
| `compatible=@COMPATIBLE@` → `@COMPAT@` | "unrendered placeholder left in a manifest VALUE", and the offending line is listed |
| `format=verity` → `format=plain` | "does not declare '[bundle] format=verity'" — rauc 1.8 has no `--bundle-format` flag, so a template edit could otherwise downgrade every bundle to the format `system.conf` refuses |
| `format=verity` commented out | the same refusal |
| **the shipped template's comment naming `@SLOTS@`** | accepted. The template DOCUMENTS the other template's placeholder by name, and a check over the raw bytes once rejected a correct manifest for saying what it does |
| an INDENTED comment carrying a placeholder | accepted — what `[[:space:]]*` buys |
| **the shipped template, rendered** | both checks pass, `[image.boot]` is spliced in and `@BOOT_IMAGES@` is gone — the control |
| `a\nb` with no trailing newline | `a\nb\n`: awk's `print` supplies the record separator whether or not the file had one |
| an empty file | no records, no blank line — `''.split('\n')` would have produced one |
| `# see @BOOT_IMAGES@ below` | NOT a splice point, because awk's `$0 ==` is not a substring match |

### the bundle read back — `src/bundle.test.ts`

| driven | what it printed |
|---|---|
| a bundle whose compatible is `mos-x64` | "bundle compatible is 'mos-x64', expected 'mos-cx3576'" |
| the compatible key ABSENT | "bundle compatible is 'null'" — the four characters `jq -r` prints, not an `undefined` that would compare its own way |
| a version that is not the one asked for | "bundle version is '9.9.9', expected '0.0.0-dev'" |
| **each slot class's filename wrong, in turn** | "bundle image for slot class 'rootfs' is 'wrong.img'", and the same for `boot` |
| a bundle carrying NO boot image | "slot class 'boot' is ''" — the empty string is what `jq … | select(has($s))` prints when it matches nothing, and it is a third answer that is not a value |
| `images` absent, or not an array | read as `''` rather than throwing its own way |
| **the shape a real rauc prints** | accepted — the control |

### the payload digest — `src/bundle.test.ts`

| driven | what it printed |
|---|---|
| a file beginning `ELF\0` | "does not start with a squashfs superblock" |
| a file beginning `nope` with a `bytes_used` of 2^40 | the SAME refusal — the magic is checked FIRST, because `head -c <huge>` is "the whole file" and not an error, so a length read out of something that is not a superblock would produce a digest for it |
| `bytes_used` = 5000 | rounded up to 8192, which is the 4096 rauc pads to |
| `bytes_used` = 8192 | left at 8192 — not rounded up again |
| **one byte changed AFTER the payload** | the digest does not move. This is the whole reason the gate is the payload |
| **one byte changed INSIDE it** | the digest moves — the control for the row above, without which a constant would satisfy it |

### the host half — `src/bundle-cli.test.ts`

| driven | what it printed |
|---|---|
| `MOS_BOARD=cx3567` | "boards/cx3567/board.env not found (MOS_BOARD=cx3567)". One transposition away from working, and an ENOENT names the path rather than the mistake |
| versions `-1.2.3`, `.1`, `''`, `1.2.3/../../etc`, `1.2.3 4`, `1.2.3;rm`, `1.2.3$(x)`, `1.2.3\n4`, `1.2&3` | "is not a plain version string", nine times. It reaches a FILENAME by concatenation and a manifest by substitution |
| a system.conf with no `compatible=` | "no compatible= in …" |
| `compatible=` with an empty value | the same — declared-empty is not a value here |
| `# compatible=mos-x64 is what x64 uses` | not read as one |
| **each of the three key files missing from the devkey dir, in turn** | "signing material not found: …" naming that file, and `make os-devkeys` |
| `CERT=/hsm/typo.pem` missing | "…supplied from the environment but this file does not exist", and NOT `make os-devkeys` — a different reader with a different fix |
| `CERT=/keys-backup/c.pem` against `KEYDIR=/keys` | the environment sentence: `case "${keyfile}" in "${KEYDIR}"/*)` needs the slash, and `/keys-backup` is not under `/keys` |
| **each rootfs-side input missing, in turn** | "not found; run 'MOS_BOARD=cx3576 bash os/rootfs/build-v2.sh' first" |
| **each board-side input missing, in turn** | "build the BSP or set BOARD_DIR (currently: /bsp)" — a different action, so a different sentence |
| both families missing | the rootfs-side sentence first, as the shell orders them |
| `riscv64`, `armv7l`, `ppc64le`, `''` | "os/update/rauc/ builds amd64 and arm64" |
| `x86_64`, `x64`, `aarch64`, `arm64` | accepted — `uname -m` and node's `os.arch()` spell these differently and both reach this function |
| the shipped rauc absent | "out-amd64/rauc not found … built from source now, not installed from Debian" |
| an arm64 host against an amd64 binary | "out-arm64/rauc not found" — the path is per-architecture |
| **caller-supplied CERT/KEY/KEYRING, and a MIXED trio** | honoured per file, and not overridden. Both of the shell's branches used to reassign them; that is the defect the resolve-once shape removes |

### the two refusals that are NOT in the shell

| driven | what it printed |
|---|---|
| a `boot.cmd` with no credits (above) | the empty read |
| `openBundleToolbox({ route: 'host' })` with a rauc on PATH that is not the shipped one | "took the HOST route, where its rauc would be … and not …" |

The second is a hole in the provenance machinery M6a built, and it is closed at
the bundle rather than in `src/toolbox.ts`. `carry` is a `docker cp`; the host
route has no way to put a binary on PATH, so a bundle toolset that took it would
still declare `provenance: 'shipped'` while `src/tools/rauc.ts` signed with
whatever `rauc` resolved to first. Provenance is not a property of toolsets in
general — rauc is the only tool that has one — so a blanket "a toolset with
`carry` may not take the host route" would be a rule about something the toolbox
does not model.

## What M6d found in the code under test — reported, not fixed

**`os/update/bundle.sh:294` substitutes with sed, which expands `&`.**

```sh
sed -e "s|@COMPATIBLE@|${BUNDLE_COMPATIBLE}|g" -e "s|@VERSION@|${BUNDLE_VERSION}|g"
```

An `&` in a sed replacement expands to the whole match. `BUNDLE_VERSION` cannot
contain one — it is refused unless it matches `^[A-Za-z0-9][A-Za-z0-9._+-]*$`,
and `src/bundle-cli.test.ts` drives exactly that character — but
**`BUNDLE_COMPATIBLE` has no such guard**: it is read straight out of the
rendered `system.conf`, which is rendered from `board.env`. A board declaring a
compatible with an `&` in it would render a manifest whose `compatible=` line
was not the string anybody wrote, and `verify_bundle`'s own comparison would
then fail against a value it had itself corrupted. `src/bundle.ts` substitutes
LITERALLY and says so at `renderManifest`; today's boards make the two agree.
A decision for whoever owns the shell, alongside M4d's `:3765`/`:3899` shadow
field disagreement and M4f's `:3331` two-line device count.

**`os/update/bundle.sh` leaves nothing behind, and the port had to be made to.**
The shell's `trap 'rm -rf "${workdir:-}"' EXIT` was read as housekeeping when
the port was written and left out; `os/build/.work` reached **557 MiB after
seven runs**, because the staging tree holds a copy of the rootfs slot image and
of the kernel. Not a defect in the shell — a defect the shell had already
solved, found by measuring the port against it.

## What M6e needs to delete the shell

- **`os/update/bundle.sh` is NOT deleted**, and neither are `os/mkimage-v2.sh`,
  `os/mkimage-x64.sh` or `os/mkimage-common.sh`. All four are oracles at this
  commit.
- **`make os-bundle-cx3576` still runs `bash os/update/bundle.sh`** and was
  re-measured green here. The TypeScript entry point is
  `bash os/build/run.sh --bundle`; giving it the make target is M6e's call, not
  a change to smuggle into a milestone whose gate is that nothing changed.
- **`os/update/rauc/render-config.sh` is NOT ported and does not need to be.**
  `src/bundle-cli.ts` runs `bash …/render-config.sh --check` as a subprocess,
  exactly as the shell does. That script owns the rendered `system.conf`; it is
  not one of the three RFCT-112 names.
- **The x64 bundle branch is ported but NOT gated.** Both branches of
  `bundle.sh` are in `src/bundle.ts` and the grub half's two refusals are driven
  from the failing side, but no x64 bundle was built by either implementation:
  RFCT-112's acceptance says "byte-identical bundles for cx3576", and this
  worktree has no x64 rootfs to bundle. If M6e wants that comparison it needs an
  `_out/x64/` carrying `rootfs-verity.{img,env}` and `boot/{vmlinuz,initrd.img}`.
- **`bundleToolset()`'s tool list grew by five** — `mkfs.vfat`, `truncate`, `cp`,
  `find`, `touch` — because the port drives them inside the container where the
  shell drives them inside its own. The PACKAGE list is untouched and is still
  `os/update/bundle.sh`'s, verbatim.
- **`mkfs.vfat`'s `-i` is now optional in `src/tools/mtools.ts`.** The two
  assemblers still pass it and are still checked for eight hex digits; the
  bundle passes neither a volume id nor a slot label, because its boot payload
  is installed into whichever slot is inactive and must not carry that slot's
  FAT identity.
- `docs/task/index.md` is still unchecked for RFCT-112, and `RFCT-112.md` is
  still `in progress`. M6e closes both.
- Re-run all three gates on the tree that ships. The recipes and values are
  above: `f36bf809…` for the cx3576 image, `bdf340e9…` for x64, and
  `d7506b62…` (114425856 bytes) for the cx3576 bundle payload.

## What M6d and M6e need from M6c

**M6d (the bundle, `os/update/bundle.sh`):**

- `run.sh` now carries four modes (`--build-rootfs`, `--mkimage-v2`,
  `--mkimage-x64`, and the suite). Add a fifth ARM; do not reshape the dispatch.
  Each mode's first-position refusal is its own loop, and all three were driven:
  `bash os/build/run.sh filter --mkimage-x64` exits 1 by name.
- `bundleToolset()` already exists in `src/toolsets.ts` and already refuses to
  open without the rauc this tree built. Nothing in M6c touched it.
- `os/update/bundle.sh` was NOT touched or run. No bundle was built.

**M6e (the deletion):**

- **`os/mkimage-x64.sh` is NOT deleted**, and neither is `os/mkimage-v2.sh`.
  Both are the oracles their gates are measured against.
- **`os/mkimage-common.sh` can now be deleted** — both assemblers are ported and
  `src/pin-seeded-times.ts` carries its argument. It is still live at this
  commit because `os/mkimage-x64.sh` sources it (copied into the work directory
  as `/w/mkimage-common.sh`) and that script still ships.
- The TypeScript assemblers have **no `make` target** and M6c deliberately did
  not give one: `os-image-x64` still runs `bash os/mkimage-x64.sh`. Rewiring the
  shipping path is M6e's call, not a change to smuggle into a milestone that must
  prove nothing changed. `bash os/build/run.sh --mkimage-x64` is the entry point
  until then.
- When `os/mkimage-x64.sh` goes, **`os/tests/mkimage-x64-selftest.sh` goes with
  it or is repointed**. It drives the shipped script directly and 196 of its
  assertions are about that; in particular it SCRAPES the `images.env` key out of
  the assembler with `from.sh --ref <KEY>` on a single line, so the assertion
  container stays the assembly container. `src/mkimage-x64.test.ts` covers the
  refusals and three whole assemblies; what it does **not** cover is the
  selftest's read-back of ext4 root listings and its BPB-level ESP assertions.
- `docs/task/index.md` is still unchecked for RFCT-112. M6e closes it.
- Re-run BOTH gates on the tree that ships. The recipes and hashes are above;
  `f36bf809…` for cx3576 and `bdf340e9…` for x64.

## What M6b needs from here

- `loadGeometry('cx3576')` for the static geometry, and `Toolbox.open(
  CX3576_ASSEMBLY, { mounts: [...] })` for the tools. Close it in a `finally`;
  a leaked container self-terminates within the hour but nothing depends on that.
- The **derived** layout is not here and was left out deliberately: the slot
  sizing (pinned vs floor, headroom, alignment) and the start chain from
  `ROOTFS_A` down to `DATA` depend on the built rootfs, differ per board, and are
  the thing the byte-identity gate is about. `Geometry.slot` carries the three
  inputs (`slotMib`, `headroomPct`, `alignMib`); the arithmetic is M6b's.
- `pin_seeded_times` ports **with** the assembler, not from here. Its three
  primitives are wrapped — `mke2fs`, `dumpe2fsHeader`/`dumpe2fsFull`,
  `debugfsApply` — each with the right failure signal; what is not wrapped is the
  free-inode-range parse and the atime/ctime command generation, which are the
  *argument* `os/mkimage-common.sh` exists to keep in one place.
- The container-side constraint survives the port: this host's mke2fs is 1.46.5
  and cannot write these layouts, so the toolbox will choose the container and
  every step including the timestamp pass runs there. Nothing needs arranging.
- **Do not add a second reader of `board.env`.** `src/verify-package.test.ts`
  fails if a file in `src/` defines one, and that assertion was mutated to prove
  it fires.
