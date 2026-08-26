# `os/verify` — the bun + TypeScript foundation for os/

A bun + TypeScript package that reads the **board definition** as data and
hands the rest of `os/` a typed model of it. It has **no runtime dependencies**:
`typescript` and `@types/bun` are dev-only, and `bun test` needs neither —
measured on 2026-08-25 by running the suite with `node_modules/` moved aside.

This is PLAN-014's M3, in the shape `test/apid-api` (RFCT-105) already
established: `bun.lock`, `package.json`, `tsconfig.json`, `run.sh`, `src/`.
Nothing here runs on the device. The image ships no bun.

Since M4a it also holds the **image-inspection helpers** and the **parity
harness** the port of `os/verify-image-v2.sh` is gated on — see "Reading an
image" and "The parity harness" below. **M4b ported batch 1**: 21 checks
covering the GPT geometry, the boot slots' filesystems and the RAUC slot
contract. Everything still unported was reported as *unclaimed* rather than as
agreement, and the run's conclusion stayed INCOMPLETE for as long as anything
was.

**That is history now: M4e closed the port and deleted the oracle**
(`os/verify-image-v2.sh`, at `6eadc65`), so nothing is unclaimed and the run
concludes on its own checks — `RESULT: PASS (290/290 checks, 22 skipped)`,
0 FAIL, x64, recorded at RFCT-111's close. `os-verify-parity` went with it,
rather than being kept able to pass having compared nothing. Two `not-ported`
citations survive **inside comments** in `src/checks-gpt.ts` and
`src/checks-root.test.ts`, and they are about a matcher shape that was left
open, not about a check that is missing.

## Everything reads `board.env`, and until now everything sourced it

`os/boards/<board>/board.env` is the single source of truth for a board —
partition geometry, `RAUC_BOOTLOADER`, `BOARD_RADIOS`, `BOARD_HWINIT_CONFS` —
and every consumer so far has read it with `.` in a shell. That works because a
shell evaluates anything, which is the whole problem: a value of `$(...)` is
not a lint finding, it is a **command that has already run** by the time any
checker looks at the result.

`src/board-env.ts` parses instead. It never touches a shell, it never consults
`process.env`, and it refuses — by name — everything that would have been shell
rather than data.

### What it accepts, all of which is in a real board definition today

| shape | example, from the shipped files |
|-------|---------------------------------|
| bare | `LAYOUT_BOARD=x64` |
| double-quoted | `BOARD_CMDLINE_ARGS="console=tty0 console=ttyS0,115200 net.ifnames=0"` |
| single-quoted | nothing expands inside |
| reference | `EPHEMERAL_SIZE_MIB="${MOS_VAR_MIB}"` |
| interpolation | `BOOT_SLOT_REQUIRED_FILES="Image rk3576-src.dtb ${BOOT_SCRIPT_NAME} mos-verity-@SLOT@.env"` |
| arithmetic | `ESP_START_SECTOR=$((ESP_START_MIB * MIB_BYTES / SECTOR_SIZE))` |
| declared empty | `BOARD_FIRMWARE_FILES=""` — **not** the same as absent |
| comments | whole-line, and trailing after a value |

A `${NAME}` resolves only against a key declared **above** it in the same file,
the way a shell reading top to bottom would. The process environment is not
consulted, deliberately: a definition that resolved differently depending on
who ran the reader would not be a definition.

`$(( ))` is integer arithmetic over `+ - * / %`, parentheses and unary sign,
evaluated in **BigInt**. These are byte offsets; past 2⁵³ a double stops being
exact, and a size that is silently one byte out is the class of defect this
package exists to make visible.

### What it refuses, each with its own message

Command substitution in both spellings, backticks, every parameter-expansion
operator (`${X:-y}`, `${X#p}`, `${X/a/b}`, `${#X}`, `${!X}`), the shell special
parameters and a bare `$`, a reference to a key the file does not define,
unquoted whitespace, unquoted metacharacters `; & | < > ( )` and globs `* ? [`,
backslash escapes outside quotes, line continuations, an unterminated quote,
`export`/`unset`/`source`-style command prefixes, DOS line endings, ANSI-C
quoting, an unquoted `~`, and anything inside `$(( ))` that is not integer
arithmetic — including a division by zero, a hex literal, a leading-zero octal,
`**`, and assignment.

The unquoted `~` is refused for the opposite reason to the rest: a shell
**does** expand it on the right of an assignment (`A=~/foo` is `/root/foo`), so
reading it literally here would be a silent disagreement with every existing
consumer of these files. Quoted, it is a literal tilde and is accepted.

Every refusal names the file, the line, the column and the offending line.

**`${X:-}` is the subtle one, and refusing it is the point.** That idiom is how
every shell consumer of these files reads a key, and it is exactly what makes a
shell reader unable to tell *declared empty* from *not declared*. x64 declares
`BOARD_FIRMWARE_FILES=""` and `BOARD_HWINIT_CONFS=""` **on purpose** — a QEMU
machine has no radio firmware and no MAC to burn, and the emptiness is the
statement. Under `${X:-}` that is indistinguishable from a board that forgot
them. Here the first is `[]` and the second is `undefined`.

## The parser throws; the model does not

`src/board.ts` turns the parsed map into the shape the rest of `os/` reasons
about: an ordered partition set with typed geometry, the bootloader backend,
and the board lists.

- A file the parser **cannot read faithfully** is not a board definition, so
  `parseBoardEnv` throws.
- A definition it **can read and disagrees with** — a missing
  `LAYOUT_PARTITIONS`, a role no checker knows, a partition with no `PARTNUM` —
  is reported as absent or unknown and handed on.

The schema lint is a separate consumer of the model. A model that threw on the
first fault could only ever report one, and a lint whose messages came from its
data layer would say what the model noticed rather than what a board engineer
needs to read.

Keys typed as numbers whose values are not become `Board.faults` — collected,
never thrown, never dropped.

## The lint, and where it is stricter

`src/lint.ts` is the board-definition schema lint: every key a role requires is
present, and no key a role does not use is present. The second direction is the
one that earns its keep — `BOOT_ATTEMPTS_DEFAULT=3` sat in the x64 layout under
a comment claiming U-Boot's contract was identical, nothing objected, and RAUC
refused the rendered configuration on the device.

It replaces `lint.sh` + `lint-test.sh`, which `source`d each definition and read
every key as `${NAME:-}`. That idiom gives the same answer for a key that is
**absent** and a key that is **declared empty**, so every check built on it had
a spelling that walked straight through. All four were run against the shell
lint on 2026-08-25:

| mutation of a real layout | `lint.sh` | `src/lint.ts` |
|---|---|---|
| `ROOTFS_A_FS_UUID=""` on a `verity-slot` | **PASS** | reject |
| `BOOT_ATTEMPTS_DEFAULT=""` on the grub board | **PASS** | reject |
| `LAYOUT_PARTITIONS=" "` | **PASS**, "0 partitions, numbered 1..0" | reject |
| `MOS_ARCH` deleted, but exported by the caller | **PASS** | reject |
| the same four, spelled non-empty | reject | reject |

The first two are the same hole seen twice; the second is the check this linter
was written for. The third even emitted a `PASS` line, so the vacuity guard was
satisfied by a board that declared no partitions at all. The fourth is closed
one layer down — the parser never reads `process.env`.

So the port is **stricter than its predecessor on purpose**, and asks
`declared()` — presence, answered without consulting the value — wherever the
shell tested for emptiness. On the 30-case parity table in `HARNESS.md` the two
agree on 26 and differ on exactly these four, every one in the direction of the
port rejecting what the shell accepted.

**Strictness that is not indiscriminate.** An empty declaration the schema does
not forbid stays a *statement*: `BOARD_RADIOS=""` means this board has none, and
x64 must keep passing with all three of its empty lists. There is a test whose
only job is to hold that line, because a port that closed the hole by failing
every empty declaration would reject the board it exists to accept.

**The messages diverge where the verdicts do not.** `lint.sh` said "declares no
ESP_FAT_VOLUME_ID" about a file containing `ESP_FAT_VOLUME_ID=""`, which sends a
reader looking for a line that is already there. Absent and empty get different
sentences here.

## Verified against the oracle it replaces

The parser was checked against `bash` **sourcing the same file**: every key of
both shipped boards, compared value for value.

| board | keys | result |
|-------|------|--------|
| cx3576 | 141 | identical to `bash` on all 141 |
| x64 | 115 | identical to `bash` on all 115 |

That comparison found a real bug on its first run — precedence climbing threw
on the lower-precedence operator instead of returning, so every
`$((A * B / C))` in the x64 layout was refused. It is **not** shipped as a
test: it would mean `source`-ing a board definition to check the thing whose
entire purpose is not to, and pointed at an untrusted file it would execute it.
Re-run it by hand when the parser changes; the recipe is in `HARNESS.md`.

## Reading an image, without touching the host

`src/image.ts` drives the same five tool families `os/verify-image-v2.sh` does,
and no others: **sgdisk** for the GPT, **mtools at an offset** for the FAT boot
slots, a byte range extracted out of the image and read with
**tune2fs/debugfs**, **unsquashfs** for the packed root, and `veritysetup
verify`, which walks the hash tree in userspace and never creates a
device-mapper target, never calls losetup and never mounts anything. No loop
mounts, no host mutation, no root.

`src/tools.ts` is the seam that decides where the tools come from — this host,
or the container pinned as `IMAGE_ALPINE_3_21`, the same key the assembler and
the shell verifier use, resolved through `os/build-env/from.sh --ref`. One
container per run, prepared once, `docker exec` per call; `MOS_VERIFY_TOOLS`
forces a route.

### Four of the five tools succeed at nothing

Every one of these was measured on 2026-08-25 in the pinned `alpine:3.21`, and
every one is refused rather than returned:

| tool | driven with | what it does |
|---|---|---|
| `sgdisk -p` | 64 MiB of zeros, no GPT | prints `Creating new GPT entries in memory.`, **invents a random disk GUID** — two runs on the same file gave `82861E6A-…` then `21E337DD-…` — lists no partitions, and **exits 0** |
| `sgdisk --verify` | the same file | **"No problems found."** |
| `debugfs -R "ls -p /"` | a file that is not ext4 | **exits 0**, empty stdout, `ls: Filesystem not open` on stderr |
| `unsquashfs -d D A p/not/in/it` | a path not in the archive | **exits 0** and leaves `D` empty |
| `veritysetup verify` | a wrong root hash / a non-verity file | **exit 1 for both** — one is the failing direction of the check, the other is the tool getting nowhere |
| `mcopy -n` | a file not in the slot | exit 1, `File "::/x" not found` — the one that is honest |

So no helper decides anything by exit status alone. `sgdisk` is refused by its
own admission sentence (`os/verify-image-v2.sh:1397` greps for the same one);
`debugfs` by the rule that its stderr must be **exactly** the version banner;
`unsquashfs` by asserting each requested path landed; `veritysetup` by
distinguishing the two exit-1 messages. Every refusal names the tool, the argv,
the status and what it saw.

`--probe` drives all of them against a real image and prints what they read —
which is both the evidence they work and the fastest way to see what a check
has to work with:

```sh
bash os/verify/run.sh --verify --board cx3576 --probe
```

## Verifying an image

```sh
make os-verify-cx3576-v2                        # the image contract
bash os/verify/run.sh --verify --board x64      # the other board
bash os/verify/run.sh --verify --board x64 --image PATH
```

`src/verify-cli.ts` runs the register against one assembled image and prints one
`PASS:`/`FAIL:`/`SKIP:` line per conclusion and a `RESULT:` line — the format
`os/verify-image-v2.sh` printed, kept deliberately, because
`test/apid-api` describes its own output as that shape and several `docs/task/`
records quote `RESULT:` lines as evidence.

It needs **docker** on a host without `sgdisk`/`mtools`/`debugfs`/`unsquashfs`/
`veritysetup`: the tools come out of the pinned `IMAGE_ALPINE_3_21`, exactly as
the deleted script re-exec'd into it. It cannot run inside the pinned bun
container — see `HARNESS.md`'s "The hole, measured rather than assumed".

## The parity harness — REMOVED at M4e, and what it recorded

**`make os-verify-parity` and `src/parity-cli.ts` are gone.** Their one input was
`os/verify-image-v2.sh`, which RFCT-110 M4e deleted at full parity. A target
whose oracle no longer exists can only refuse every time or pass having compared
nothing, and the second reads exactly like a gate still being held.

`src/parity.ts` stays: `CheckResult` and `Verdict` are imported by 36 modules and
the `shell:` matcher backs all 333 register entries. `parseShellRun`,
`diffParity` and `formatReport` now have **no production caller** and remain
driven by `src/parity.test.ts` against synthetic transcripts.

The rest of this section is the record of the gate, in the past tense. It ran
`os/verify-image-v2.sh` and this package's check register against the **same
image** and diffed their conclusions **per check**. The oracle was not modified
to help: a verifier edited to make its readings easier to compare is no longer
independent of the thing it measures.

**Identity, not a count.** The oracle prints prose, and the two directions of
one check share only a leading clause — `eq_ci` prints `X is Y` on the way
through and `X is 'Z', expected Y` on the way out. So each ported check carries
the substring that identifies its own PASS line (and, where the directions
differ, its FAIL and SKIP lines) as a field on the check itself. That was
`os/tests/ui-location-test.sh`'s `ASSERTIONS` register at a larger scale — that
suite is deleted too, and for the same reason — and it lives on the check so a
port cannot exist without saying which conclusion it replaces.

**A skip is a third verdict.** The oracle skips 3 checks on cx3576 and 22 on
x64, and a skip never equals a pass here: pass-vs-skip is a divergence with a
name, and a SKIP line no check registered stays *unclaimed* rather than
matching the check's pass matcher.

**What it reports**, per check: `agree`, `diverge`, `not-ported` (the shell
concluded and nothing claims it), `ts-silent` (claimed, and the port said
nothing), `orphan` (the port concluded and no shell line matched), `unfired`
(registered, applicable, silent on both sides) and `ambiguous` (the register
cannot tell two checks apart, or one check from two lines).

**Exit status was three-valued**: `0` full parity, `2` INCOMPLETE — still
unported checks — and `1` a real divergence. A caller who only looked at
"non-zero" could not tell an unfinished migration from a broken one. The final
run was `0` on both boards: `cx3576` compared 398 with 0 diverging and 0
unclaimed, `x64` compared 312 the same way.

The parser also refuses a reading that disagrees with the oracle's **own**
counters, because a parser that missed conclusions would report agreement about
the part it read. And a comparison in which nothing was compared can only come
out INCOMPLETE or FAIL, never PASS — M3a's board-env oracle once reported
agreement "on all 0 keys" because both dumps were empty.

### Where it stands after M4b, 2026-08-25

Both boards, against the images the M1 gate built, with the harness's shell side
invoked exactly as `make os-verify-<board>-v2` invokes it:

| board | oracle | register | compared | unclaimed | conclusion |
|---|---|---|---|---|---|
| cx3576 | `PASS (395/395 checks, 3 skipped)` | 21 checks | 84 | **314 of 398** (was 398) | INCOMPLETE |
| x64 | `PASS (290/290 checks, 22 skipped)` | 21 checks | 72 | **240 of 312** (was 312) | INCOMPLETE |

`diverge`, `ts-silent`, `orphan`, `unfired` and `ambiguous` are **0 on both
boards**, which is what makes the exit status 2 rather than 1.

### Batch 1, and the two conclusions a substring cannot name

| module | checks | what they read |
|---|---|---|
| `src/checks-gpt.ts` | 12 | the table the image carries (`readGpt`) against the one the board declares (`walkLayout`) |
| `src/checks-slots.ts` | 3 | the FAT32 signature, volume serial and volume label of BOOT-A and BOOT-B |
| `src/checks-rauc.ts` | 6 | `/etc/rauc/system.conf` in the packed root, against the layout the GPT was written from |

Two of the oracle's conclusions are **deliberately left unclaimed**, and the
reason is measured rather than argued. `ShellMatcher` identifies a conclusion by
a **substring**, and these two have none that is board-independent and unique:

| conclusion | candidate matcher | claims |
|---|---|---|
| `exactly ${EXPECT_PARTS} partitions` | ` partitions` | 3 lines on cx3576, 3 on x64 |
| | `exactly ` | 13 lines on cx3576, 8 on x64 |
| `${slot} contains ${f}` | ` contains ` | also `BOOT-A contains no extlinux/…` and `BOOT-A contains no initramfs file`, twice each on cx3576 |

The only remaining token in the first is the partition **count** — the literal
`os/verify-image-v2.sh:1408` deliberately stopped writing down, because
`EXPECT_PARTS=11` is why `MOS_BOARD=x64` once died four checks in. Putting it
back inside the register would make a board that changed its partition count
report `orphan` rather than red.

The second collides with checks that are M4d's (`is_uboot_board`-gated), in both
directions: whichever batch registers ` contains ` first makes the other's lines
`ambiguous`. Both want an **anchored** matcher — `^exactly \d+ partitions$` and
`^BOOT-[AB] contains \S+$` separate them cleanly — which is a change to
`ShellMatcher` and therefore M4e's, on the same list as the "beyond the oracle"
flag M4a left it.

## The smoke runner — "it linked", "it runs" and "it is the version we decided"

RFCT-113 M7b. Twelve artifacts in the image are built by this repository — mosd,
apid, mos-mqttd, mos-mqtt-broker, rauc, podman, quadlet, crun, conmon, netavark,
aardvark-dns, catatonit — and until M7 the last thing done to any of them was to
**link** them. Three different claims were being read as one, and only the first
was ever checked:

| claim | what would establish it |
|-------|-------------------------|
| it linked | the build did not fail |
| it runs | the loader resolves it and it reaches `main` |
| it is the version we decided | what ran is what `versions.env` says |

A wrong-architecture binary, a missing soname and a version that does not match
its pin all survive to first boot, and from a build log all three look identical:
green.

```sh
bash os/verify/run.sh --smoke                # x64, or $MOS_BOARD
bash os/verify/run.sh --smoke --board cx3576
```

It loads `_out/<board>/factory-root.oci` — the packed root the build exports as
an OCI image — and runs each artifact **inside it**, at its installed path,
with `--rm --network none`.

### One list, two readers

No version string is written down in this package. Every pin is read, at run
time, out of the file that owns it: `os/podman/versions.env`,
`os/update/rauc/versions.env`, and `mosd/<crate>/Cargo.toml` for the four
binaries this repository writes. That is the whole of what makes the third
acceptance clause true — *bumping a pin without rebuilding the artifact turns
the smoke run red* — and it is the reason the register carries identity (which
artifact, which path, which key) and never a value.

`pinCoverageFaults` checks both directions and the **runner** calls it, not only
its tests. Every `*_VERSION` in every `versions.env` must be claimed by some
artifact; a new self-built binary that arrives with a pin and no register entry
refuses the run instead of quietly not being executed.

### Three verdicts, because two would be a lie

`mosd` and `apid` have **no `--version`**. Measured inside the real factory root:
`mosd --version` ignores the flag, runs first-boot provisioning and exits 1 on
the absent system bus; `apid --version` ignores it, generates a TLS keypair,
binds `:443` and never returns. Neither reports a version, neither exits 0, and
neither invocation is *minimal* — both mutate. Closing that means editing
`mosd/` Rust sources, which PLAN-014 excludes.

So they are **unclaimed**: not a pass, not a skip, not invoked at all. The run
concludes `INCOMPLETE` and exits non-zero. That is deliberate — the alternative
is a green that has quietly stopped asking two of the eleven artifacts for a
version, and this tree has deleted several checks for exactly that.

```
RESULT: INCOMPLETE (10 pass, 0 fail, 2 unclaimed, of 12). UNCLAIMED: mosd, apid. …
```

The **names** are on the RESULT line and not only the count: this run's steady
state is non-zero until M7d's `--version` handlers land, so the number is exactly
the part a reader stops seeing.

The category **cannot grow silently**. `EXPECTED_UNCLAIMED` declares who is
allowed to go unasked, `unclaimedFaults` refuses any run whose register disagrees
with it, and adding a third artifact costs three edits in one diff. Nothing
infers the category at runtime — a binary that *loses* its `--version` is a
**FAIL**, not a new member. Both directions fail, including the good one: when
M7d lands, mosd and apid move UNCLAIMED → PASS and the constant empties, which is
what proves the fix landed.

### The commit half is printed, not asserted

M7d's handlers will report the git commit beside the version —
`mosd 0.1.0 (abc1234)`. No git provenance is recorded anywhere by the build
(measured, with a positive control on the search), so there is no build fact to
compare against and the runner **prints** the reported line verbatim rather than
asserting anything about the sha:

```
PASS  catatonit  …  == CATATONIT_VERSION=v0.2.1  [said: "tini version 0.2.1_catatonit"]
```

Comparing against `git rev-parse HEAD` at run time is refused by name: it would
be trivially green on any freshly built tree, asserting that somebody just built
rather than that the embedding works.

### It refuses rather than skipping, in four places

- **no image** — names the file and `MOS_BOARD=<b> bash os/rootfs/build-v2.sh`
- **register vs pins disagree** — nothing is executed at all
- **a feature stage was declined** — read off the build's own
  `rootfs-stages.txt`; against such a root the declined feature's artifacts would
  all answer `rc=127`, and a handful of failures about binaries is the wrong
  diagnosis of one decision about one stage
- **this host cannot execute the image** — a `/bin/true` preflight, which is
  also the positive control. Without it an arm64 image on a host with no
  `binfmt_misc` gives twelve failures about twelve binaries, which is twelve
  wrong diagnoses of one condition.

### It is part of the build, since M7c

`os/rootfs/build-v2.sh` runs `run.sh --smoke` as its **last step, under
`set -e`**, so a root whose binaries do not run does not become an image. That is
RFCT-113's first acceptance clause on its literal reading — "fail the build" —
and until M7c **nothing in this tree invoked the runner at all**: no `make`
target, neither `.gitea` workflow, and every `smoke` in `build-v2.sh` was a
comment.

In the script rather than in the `Makefile`, because two make targets run it, so
does the CI deep lane, and anyone can run it directly; a step wired into the
callers would be three copies to keep in step and bypassed by the fourth. There
is no skip and no opt-out. `make os-smoke-test` is how to ask the question on its
own, against a root that is already built.

### The three negative tests — `make os-smoke-negative-test`

A check on the check. Each case **makes** its defect in a real image built from
the real factory root and drives the real `docker run` at it:

| case | mutation | artifact |
|---|---|---|
| `wrong-arch` | `e_machine` `0x3e` → `0xb7`, one byte | `/usr/bin/crun` |
| `missing-soname` | `libjson-glib-1.0.so.0` removed — NEEDed by `rauc` and, measured, by nothing else in the register | `/usr/bin/rauc` |
| `version-skew` | replaced by a shim reporting `1.29.2` against a pin of `1.29.1` | `/usr/bin/crun` |

They are **not** unit tests, and could not be. Everything else here is driven
from a fabricated `ExecResult`, which is what makes the red branches runnable
without a daemon — but a fabricated result is a statement the test wrote, and
M7b's exit-status map was green throughout while being wrong about both of the
shapes this clause names. See `HARNESS.md`, "The exit-status diagnosis,
measured".

Five things are asserted per case, each ruling out a different way of passing
vacuously: the image built (**a mutation that changed nothing fails the image
BUILD** — every Dockerfile asserts its own pre-state and post-state); `preflight`
still passes on the *mutated* image, so the failure is the artifact and not the
host; the *unmutated* artifact passes through the same runner in the same pass;
the failure says the right thing **and not the wrong one**; and the whole run
concludes FAIL, exit 1, with exactly one failure, named.

The parts that decide *whether the cases run at all* — an empty list, a case
naming an artifact the register does not have, an empty mutation body, a skew
that is not a skew — are in `src/smoke-negative.test.ts` and need no daemon,
because those are the failures that would otherwise be silent.

## Running

```sh
make os-verify-test          # the whole suite
make os-layout-lint          # the schema lint, over every board this tree ships
make os-layout-lint-test     # the lint's own cases, which is the suite filtered
make os-smoke-test           # execute the built artifacts in the factory root (docker)
make os-smoke-negative-test  # break that root three ways, require each red (docker)
make os-factory-root-gate    # is the OCI export the tree that ships? (docker)
```

or, equivalently, `bash os/verify/run.sh` — install if needed, `typecheck`,
then `bun test`, with a guard that turns a run asserting nothing red. See
`HARNESS.md` for why that guard exists and how to drive it. `bash
os/verify/run.sh --lint [board.env ...]` is the lint; the flag has to come
first, so it can never be mistaken for a `bun test` filter.

Directly, with bun on the host:

```sh
cd os/verify
bun install
bun run typecheck
bun test
```

**bun is not required on the host.** A host without one runs the same three
targets unchanged: `run.sh` falls back to the bun pinned by digest as
`IMAGE_BUN_1` in `os/build-env/images.env`, which needs docker and nothing else.
There is no separate command to remember and no flag to pass — the route is
chosen automatically and announced on the first line of output:

```
os/verify: 1.4.0 in oven/bun:1@sha256:5ff6… (no bun on this host)
RESULT: PASS (26/26 checks)
```

`MOS_VERIFY_CONTAINER=1` forces that route on a host that *does* have bun, which
is how the two are compared; `MOS_VERIFY_BUN` names a binary instead. Setting
both is refused.

This matters more since M3b than it did before. `make os-layout-lint` used to
run on bare bash, and now needs bun like the suite does — so the container path
is what keeps a board definition checkable on a host that has only docker,
rather than a convenience. `.gitea/workflows/check.yml` installs no bun for
exactly this reason: the runner takes the container route, so the pin is
exercised on every push. See `HARNESS.md` for the mount, which is an identity
mount and not a `/w`, and why.

## Layout

```
run.sh              the entry point; the only place that decides how bun is invoked
src/board-env.ts    the parser: board.env text -> assignments, faithfully or not at all
src/board.ts        the typed model: assignments -> partitions, roles, bootloader, lists
src/lint.ts         the schema lint: the model -> a verdict and the sentence for it
src/lint-cli.ts     argv, printing and an exit status; every decision is in lint.ts
src/paths.ts        where the package sits, anchored rather than counted
src/tools.ts        the tool seam: this host, or the pinned alpine; one place decides
src/image.ts        sgdisk / mtools / tune2fs+debugfs / unsquashfs / veritysetup, typed
src/checks.ts       the check register, and what a check is handed
src/checks-gpt.ts   batch 1a: the GPT geometry, image table vs board definition
src/checks-slots.ts batch 1b: the boot slots' FAT filesystems
src/checks-rauc.ts  batch 1c: the RAUC slot contract in the packed root
src/checks-fixture.ts  a synthetic image, for driving a ported check RED
src/layout.ts       the board definition walked into the table it describes
src/verdict.ts      how a ported check spells its conclusion
src/parity.ts       the diff: shell conclusions vs port results, per check, by identity
src/parity-cli.ts   argv and orchestration; every decision is in parity.ts
src/smoke-pins.ts   where a recorded version is READ from; no version string lives here
src/smoke-register.ts  the twelve artifacts: identity and installed path, never a value
src/smoke.ts        the runner: the exec seam, the verdicts, the refusals, the count guard
src/smoke-cli.ts    argv, printing and an exit status; every decision is in smoke.ts
src/probe.ts        drives every helper against a real image and prints what it read
src/*.test.ts       the suite; every refusal has a positive control beside it
```

`lint.sh` and `lint-test.sh` — the shell board-definition schema lint and its
negative test — were **retired** in M3b. `src/lint.ts` and `src/lint.test.ts`
replace them, `make os-layout-lint` and `make os-layout-lint-test` keep their
names, and both now go through `run.sh`. What changed in the verdicts, and why
each change is deliberate, is in "The lint, and where it is stricter" above.
