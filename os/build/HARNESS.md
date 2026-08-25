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
