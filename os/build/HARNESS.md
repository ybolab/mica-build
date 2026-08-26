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
driver merged alongside it, taking the package to **406/406**, and M5c's stage
SELECTION added **15** more, for **421/421** in 2 m 43 s. The
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

## What M6c and M6d need from M6b

- `src/layout-cx3576.ts` is **cx3576's** chain, and x64's is a different one.
  Make `layout-x64.ts` beside it rather than a `case` inside this one: the two
  boards agree on the slot-sizing IDEA and on nothing about the order of what
  follows.
- **`os/mkimage-common.sh` is still live** and must not be deleted or
  restructured: `os/mkimage-x64.sh` sources it, by a path it COPIES into its work
  directory as `/w/mkimage-common.sh`. `src/pin-seeded-times.ts` is the ported
  argument; when M6c lands, the shell file goes with the shell assembler.
- `pinSeededTimes(tb, image, fileMtime)` is board-neutral already — it takes a
  path and a `touch -d` spelling and nothing else.
- The toolbox's `cx3576-assembly` toolset now declares `cp`, `find` and `touch`
  as well. `x64-assembly` does not yet, and M6c will want them for the same
  reason: `cp -a` is `--preserve=all`, `mke2fs -d` copies xattrs, and a host with
  SELinux stages different bytes from a container without it.
- `run.sh --mkimage-v2` is the mode pattern to copy for `--mkimage-x64` and
  `--bundle`, including the refusal when the flag is not first.
- **The gate needs the oracle to reproduce ITSELF first.** Run the shell twice
  before comparing. It costs 70 seconds and it is what turns a matching hash into
  evidence.

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
