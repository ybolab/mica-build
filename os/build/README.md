# `os/build` — the TypeScript build driver for os/

The typed **geometry** of a board, and **`Bun.$` wrappers** for the external
toolset the image assemblers drive: sgdisk, mtools, dd, mkimage, veritysetup,
e2fsprogs and rauc. No runtime dependencies: `typescript` and `@types/bun` are
dev-only, and `bun test` needs neither.

This is PLAN-014's M6a (RFCT-112), in the shape `os/verify` established in M3 —
`bun.lock`, `package.json`, `tsconfig.json`, `run.sh`, `src/`. Nothing here runs
on the device. The image ships no bun.

**No assembly happens here.** `os/mkimage-v2.sh` (cx3576), `os/mkimage-x64.sh`
(x64) and `os/update/bundle.sh` are ported in M6b, M6c and M6d, under the
byte-identity gate; M6e is the gate that deletes the shell. This milestone opens
the package with the two things all three need and nothing else.

## Where the board model comes from, and why it is not here

`os/verify/src/board-env.ts` parses `boards/<board>/board.env` as **data** —
never sourcing it, never reading `process.env`, refusing by name everything a
shell would have executed — and `board.ts` turns that into partitions, roles,
bootloader and the board lists, keeping *declared empty* apart from *absent*. It
was proven key-for-key against `bash` on both shipped boards: cx3576 141/141,
x64 115/115.

`os/build` **imports that**, across the two packages, through exactly one file:
`src/verify-package.ts`. Three options were open and this is the choice.

| | |
|---|---|
| **Copy it** | Refused. Two parsers that must agree about the same bytes are the duplication PLAN-014 has spent its length removing — `os/health/`'s byte-identical pair, and `os/mkimage-common.sh`'s header on why an *argument* must not be copied. The failure mode is not that a copy is wrong when it is made; it is that it reads as self-evidently correct long after one of its reasons changed. |
| **A third, shared package** | Refused. It means moving M3's sources out of the package whose README, HARNESS and 108 tests describe them where they are, three days after that gate closed and with M4 (RFCT-110) still to port the verifier on top of them. The cost is real and the benefit is a directory name. |
| **Import the source** | Taken. One copy of the parser, no move, no lockfile coupling, no workspace. bun and `tsc` both resolve a relative specifier into a sibling package's `src/` directly, and `os/build`'s typecheck follows its imports — so the two packages are checked *against each other* on every run of either suite. |

A relative `..` **module specifier** is safe where a counted directory path is
not, and `src/paths.ts` says why: `resolve(dir, '..')` always produces a path, so
a miscount surfaces later as an empty directory; a wrong module specifier is
"Cannot find module", at import, before any test runs. It is the loud kind.
`paths.ts` still anchors `os/verify` itself, so the message names which of the
two packages moved.

`src/verify-package.test.ts` asserts the claim rather than restating it:

- the imported module **is** `os/verify/src/board.ts`, by object identity — bun
  keys its module cache on the resolved path, so a copy would give an
  equal-looking function that is a different object;
- exactly **one** file in `src/` names the other package;
- **no** file in `src/` defines `parseBoardEnv`, `modelBoard`,
  `evaluateArithmetic` or a second `KNOWN_ROLES`.

The third is written for M6b–M6e. The tempting shortcut when an assembler needs
one more field is to read `board.env` "just here".

## The geometry, and what it adds over the model

`src/geometry.ts`. The model answers a **lint's** question: what is declared,
what is not, never stopping at the first fault. An **assembler** asks a different
one — give me the sector for sgdisk and the MiB for dd, or end the build. Three
differences follow, and each is that difference:

**One number per fact, in every unit.** A start is declared in MiB on one
partition, in sectors on another and in all three on a third: cx3576 writes
`LOADER_START_SECTOR=64` alone, `BOOT_A_START_MIB`/`_START_SECTOR`/
`_OFFSET_BYTES` together, and x64 computes all three with `$(( ))`. A
`Placement` carries `bytes`, `sectors` and `mib`, derived from whichever the file
spelled, against the board's **own** `SECTOR_SIZE` and `MIB_BYTES` rather than
against 512 and 1048576 written down again. Where two declared units disagree it
records a fault and keeps the file's first word rather than blending them — the
schema lint *reports* that contradiction, this refuses to *use* it.

**BigInt, not number.** `board.ts` reads its integers with `Number(t)`.
`board-env.ts` evaluates `$(( ))` in BigInt for a reason it states — "these are
byte offsets; past 2⁵³ a double stops being exact, and a size that is silently
one byte out is the class of defect this package exists to make visible" — and
that reason stops applying the moment a double touches the value. Every quantity
here is re-read from the string and kept as a `bigint`.

**Required means throws.** `require`/`requireInt` name the key **and the file**.
Under `set -u` a shell says `BOOT_A_START_MIB: unbound variable` and names
neither; every consumer that used `${X:-}` instead said nothing at all.

What it does **not** do: the derived layout. `os/mkimage-v2.sh` computes the
rootfs slot size from the built rootfs and chains rootfs-b, meta, state,
ephemeral and data off it; `os/mkimage-x64.sh` does the same with a different
chain. Those depend on inputs that do not exist until an assembly is running,
they differ per board, and they are under a byte-identity gate that belongs to
M6b and M6c.

Both shipped boards read clean — 0 geometry faults, 0 model faults — and the
per-board assertions are spelled out with the values copied from the files.
**Anything that passes on cx3576 alone is half tested**: M3a's parser passed
cx3576 141/141 while x64 was wholly unreadable.

## The toolbox: how an external tool is run

`src/toolbox.ts` is one function with two routes, which is `os/verify/run.sh`'s
shape for bun, one level down. Every caller passes an argv and reads a status,
and none can tell which route answered.

**The container is the normal route, not a degraded one.** Both shell assemblers
already have one: `os/mkimage-v2.sh` probes the host with `host_can_assemble()`
and falls back to alpine; `os/mkimage-x64.sh` does not even probe — its header
says requiring the toolset would make the build "a host-configuration problem".
Measured on this campaign's host: no sgdisk, no mcopy, no mdir, no minfo, no
mkimage, and an e2fsprogs that is 1.46.5 — **on `PATH` and unable to write `-O
^orphan_file`**, which is exactly why `pin_seeded_times` has always run
container-side. So the route is chosen by probing *capability*, not presence.

**Per toolset, never per tool.** An image half written by the host's sgdisk and
half by the container's mcopy has no answer to "which tool wrote these bytes",
and that is the property M6b and M6c are gated on. `host_can_assemble()` is an
`&&` chain across seven binaries plus a capability probe for the same reason.

**A session, not a container per call.** Measured: `docker run --rm <alpine>
true` ≈ 320 ms, `docker exec` into a running one ≈ 40 ms, and the package install
is ≈ 1.3 s on top of *every* run. A `Toolbox` opens once — image resolved,
container started, packages installed, **every declared tool asserted present** —
and each call is an exec into it. That is also what makes a container-side step
ordinary rather than special-cased: `pin_seeded_times`' `dumpe2fs` and `debugfs`
are two more calls into the same session.

**Every tool asserted at open**, because alpine splits `debugfs` and `dumpe2fs`
out of `e2fsprogs` into `e2fsprogs-extra` and `apk add e2fsprogs` succeeds while
providing neither. Without the assertion that gap surfaces as "debugfs: not
found" forty steps into an assembly.

**Identity mounts**, not `/w` or `/work`. `os/verify/run.sh:189` states the rule
— short names for containers that *run a script* and build their paths inside,
identity for containers *handed paths from outside* — and every tool here is the
second kind. It matters twice over when bun is itself in a container: a container
started from inside one is a **sibling**, created by the same daemon, so every
`-v` it passes is resolved against the **host** filesystem. And a bind mount of a
path the daemon cannot see does not fail — it succeeds and delivers an empty
directory (measured, `/tmp`, on this host, still true).

### The toolsets

`src/toolsets.ts`. Every image is an `os/build-env/images.env` **key**, resolved
through `os/build-env/from.sh --ref`; R6 removed the last floating tag from the
shipping path and this package starts with none. Every package list is a
transcription of a line in the shell, **deliberately not tidied**: which package
provided `mkfs.vfat` or `grub-efi-amd64-bin` decides bytes, and the two
assemblers use different base images on purpose.

| toolset | image key | provides |
|---|---|---|
| `cx3576-assembly` | `IMAGE_ALPINE_3_21` | sgdisk, mkfs.vfat, mcopy, mdir, minfo, mke2fs, dumpe2fs, debugfs, mkimage, dd, truncate |
| `x64-assembly` | `IMAGE_DEBIAN_TRIXIE` | the same, plus grub-mkstandalone, minus mkimage |
| `verity` | `IMAGE_ALPINE_3_21` | veritysetup |
| `coreutils` | `IMAGE_ALPINE_3_21` | dd, truncate — usually the **host** route |
| `bundle` | `IMAGE_DEBIAN_TRIXIE` | rauc (carried in), mksquashfs, mcopy, mkimage, jq |

`coreutils` earns its place by being the one that normally runs on the host: a
seam with one reachable route is a seam nobody is checking, and both are live in
every run of the suite.

## The wrappers, and the fact that their failure signals differ

`src/tools/`. `toolbox.run()` returns the status and both streams and interprets
**nothing**; each wrapper knows its own tool. That is not fastidiousness — the
signals genuinely differ, and three of them were measured to be other than what
the code first assumed.

| tool | how it reports failure |
|---|---|
| `sgdisk` | exit status — **and** `--verify` prints problems with exit 0 |
| `dd` | exit status; it writes its summary to **stderr on success** |
| `mkfs.vfat` | exit status — and `-F 32` writes a FAT32 boot sector over a filesystem that is not FAT32 and exits 0 |
| `mtools` | exit status; an **empty** `mdir` listing is refused |
| `mkimage` | exit status; `SOURCE_DATE_EPOCH` is read from the environment and falls back to the wall clock |
| `veritysetup` | exit status — and `format`'s answer is a root hash on stdout, so an unreadable one is a failure whatever it exited |
| `mke2fs` | exit status; `E2FSPROGS_FAKE_TIME` from the environment |
| `dumpe2fs` | exit status, plus a header this parser must actually understand |
| `debugfs` | **its stderr** — three failure shapes exit 0 |
| `rauc` | exit status — and writing a bundle is refused by *provenance*, before it runs |

**sgdisk writes one argv shape where the two assemblers write two**, and that is
only safe if the differences are not differences — so they were measured, and the
suite re-runs the comparison rather than recording a claim:

| difference | result |
|---|---|
| flag order `new/name/type/guid` vs `new/type/guid/name` | byte-identical |
| `+131072S` vs `+64M` at 512-byte sectors | byte-identical |
| `--clear` on a freshly truncated (all-zero) file | byte-identical |
| `-a 1` where every start is already MiB-aligned | byte-identical |
| `-a 1` where a start is sector **64** | **not** the same: 64 vs 2048, silently, exit 0 |

The last row is cx3576's loader, and it is why `readPartition` exists: asking
sgdisk for a layout proves nothing about the layout.

**debugfs is the one whose stated reason turned out to be wrong.**
`os/mkimage-common.sh` gives the reason for reading its stderr as "a rename of
`sif` [would] turn this into a no-op that still reports success". Measured
against debugfs 1.47.1, an **unknown command exits 1**; the argument is right and
its illustration is not. What really is silent is a bad *argument* (rc 0, "File
not found by ext2_lookup"), an image that is not a filesystem (rc 0, "Bad magic
number"), an image that is not there (rc 0) — and an **empty command file**, rc 0
with a clean stderr, which neither signal carries and which is what a
free-inode-range parse that understood nothing would produce. All seven cases are
in that file's header and each is driven.

**rauc will not write a bundle with a rauc this tree did not build.** Commit
9a43a59: a bundle built in a bookworm container by rauc 1.8 was refused by the
device's 1.13, "found by failure rather than by a check", and "a format
difference would not have announced itself so kindly." So `bundle()` refuses a
toolset whose `provenance` is not `'shipped'`, by name, before any bytes exist.
Reading is allowed on either — which is how the wrapper is exercised in a
checkout where `make os-rauc` has not run.

## Running

```sh
make os-build-test          # the whole suite
bash os/build/run.sh        # the same thing
bash os/build/run.sh --help
bash os/build/run.sh src/geometry.test.ts   # extra arguments go to `bun test`
```

`run.sh` finds bun — on the host, or failing that in the container pinned as
`IMAGE_BUN_1` — installs the dev dependencies if `node_modules/` is absent,
typechecks `src/` (which typechecks `os/verify`'s sources too, because they are in
the program), runs the suite, and then checks the suite actually ran.

**This package needs docker, and `os/verify` does not.** It drives the real
toolset, and on any host that does not carry all of it natively that means
containers. `run.sh` refuses by name when there is no docker client, and again
when the client cannot reach a daemon. Nothing is skipped: a tool reachable
neither way is a failure, not a gap.

**bun is not required on the host.** Without one, `run.sh` takes the pinned-bun
container route — and mounts the host's docker client (a static Go binary) and
`/var/run/docker.sock` at their own paths, so the toolbox can still start
*sibling* containers from in there. Both routes were run to completion:
199/199 either way.

```
os/build: 1.4.0 at /srv/bkd/runtime/bun
os/build: 1.4.0 in oven/bun:1@sha256:5ff6… (no bun on this host)
```

`MOS_BUILD_CONTAINER=1` forces that route where a host bun exists, which is how
the two are compared; `MOS_BUILD_BUN` names a binary instead; setting both is
refused. `MOS_BUILD_TOOLBOX=host|container` forces a *toolbox's* route the same
way, one level down.

## Layout

```
run.sh                     the entry point; the only place that decides how bun is invoked
src/verify-package.ts      the one place os/build reaches into os/verify
src/paths.ts               where the package sits, anchored rather than counted
src/geometry.ts            board.env -> the typed geometry an assembler asks questions in
src/images.ts              an images.env key -> its reference, through from.sh and nothing else
src/toolbox.ts             THE SEAM: how an external tool is run, host or pinned container
src/toolsets.ts            the toolsets, transcribed from the shell rather than tidied
src/testing.ts             the timeouts the container-driving tests need, and the measurements
src/tools/sgdisk.ts        the GPT
src/tools/mtools.ts        mkfs.vfat, mcopy, mmd, mdir, minfo
src/tools/dd.ts            raw placement, and truncate
src/tools/mkimage.ts       the U-Boot boot script
src/tools/e2fsprogs.ts     mke2fs, dumpe2fs, debugfs
src/tools/veritysetup.ts   the dm-verity hash tree
src/tools/rauc.ts          the update bundle
src/**/*.test.ts           199 tests; every refusal has a positive control beside it
```

`HARNESS.md` carries how each guard was driven from the failing side, the bash
oracle for the geometry, and what M6b needs.
