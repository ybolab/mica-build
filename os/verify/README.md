# `os/verify` — the bun + TypeScript foundation for os/

A bun + TypeScript package that reads the **board definition** as data and
hands the rest of `os/` a typed model of it. It has **no runtime dependencies**:
`typescript` and `@types/bun` are dev-only, and `bun test` needs neither —
measured on 2026-08-25 by running the suite with `node_modules/` moved aside.

This is PLAN-014's M3, in the shape `test/apid-api` (RFCT-105) already
established: `bun.lock`, `package.json`, `tsconfig.json`, `run.sh`, `src/`.
Nothing here runs on the device. The image ships no bun.

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

## Running

```sh
make os-verify-test        # the whole suite
make os-layout-lint        # the schema lint, over every board this tree ships
make os-layout-lint-test   # the lint's own cases, which is the suite filtered
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
src/*.test.ts       the suite; every refusal has a positive control beside it
```

`lint.sh` and `lint-test.sh` — the shell board-definition schema lint and its
negative test — were **retired** in M3b. `src/lint.ts` and `src/lint.test.ts`
replace them, `make os-layout-lint` and `make os-layout-lint-test` keep their
names, and both now go through `run.sh`. What changed in the verdicts, and why
each change is deliberate, is in "The lint, and where it is stricter" above.
