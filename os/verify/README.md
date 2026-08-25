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
`export`/`unset`/`source`-style command prefixes, DOS line endings, and
anything inside `$(( ))` that is not integer arithmetic — including a division
by zero, a hex literal, a leading-zero octal, `**`, and assignment.

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
make os-verify-test
```

or, equivalently, `bash os/verify/run.sh` — install if needed, `typecheck`,
then `bun test`, with a guard that turns a run asserting nothing red. See
`HARNESS.md` for why that guard exists and how to drive it.

Directly, with bun on the host:

```sh
cd os/verify
bun install
bun run typecheck
bun test
```

bun is not required on the host. Until RFCT-109's pinned-container path lands,
run it in a container, mounting the **repository** (a `/tmp` mount does not
propagate to the docker daemon here and silently yields an empty directory):

```sh
docker run --rm -v "$(git rev-parse --show-toplevel):/w" -w /w/os/verify \
  oven/bun:1 sh -c 'bun install && bun run typecheck && bun test'
```

## Layout

```
run.sh              the entry point; the only place that decides how bun is invoked
src/board-env.ts    the parser: board.env text -> assignments, faithfully or not at all
src/board.ts        the typed model: assignments -> partitions, roles, bootloader, lists
src/paths.ts        where the package sits, anchored rather than counted
src/*.test.ts       the suite; every refusal has a positive control beside it
```

`lint.sh` and `lint-test.sh` are the **shell** board-definition schema lint,
still the thing `make os-layout-lint` and `make os-layout-lint-test` run. They
are unchanged by this package and are RFCT-109's next step to port.
