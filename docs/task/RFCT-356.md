# RFCT-356 Two gates that report without checking: factory-root-gate on arm64, and the smoke build-commit assertion

- **status**: completed
- **priority**: P1
- **owner**: bkd/njizj3fm
- **createdAt**: 2026-09-08 04:00
- **relatedPlans**: (none)

> The index line in `docs/task/index.md` is written by L1, not by this task.

## Description

Two checks in this tree report a result without having checked. One is loud and
wrong on every arm64 run; the other has been silently off since the path that
builds the shipped binaries changed.

**`make os-factory-root-gate` cannot pass on any arm64 root.**
`tests/factory-root-gate/inner.sh` compared the two trees with
`diff -r --no-dereference`, and `diff` cannot read a device node: for each of
the eight character devices under `/dev` it printed `File .../dev/null is a
character special file while file .../dev/null is a character special file`.
Eight lines that say only that diff declined to look, counted as eight
differences, turned into

```
FIDELITY: 1 of 4 comparisons differ. The image the smoke run
          executes in is NOT the image the device ships, so nothing the smoke run
          reports is about the shipped artifact.
```

The damage is not the red exit; it is that the message asserts every smoke
result is meaningless, on every arm64 run, for a reason that has nothing to do
with the artifact. RFCT-350 measured the same failure against the untouched
pre-S2 cx3576 pair, so it predates that task.

**The smoke suite's build-commit assertion has never run.**
`pkgs/mosd/hack/build-target.sh` wrote `_out/mosd-build.txt`;
`rootfs/build.sh` removed `$OUT_DIR/mosd-build.txt` on every build and nothing
wrote it back, because the binaries in a composed root come out of packages
built by `pkgs/mosd/hack/build-deb.sh`, which wrote no record. That choice was
right — a visible gap beats a false assertion — but the consequence is that
every run printed `build commit NOT ASSERTED`, while `verify/src/smoke.ts`'s own
documentation still said *"A root built by rootfs/build.sh always has it"*.

## ActiveForm

Comparing device nodes by type and major:minor, driving the new comparison from
the failing side, and moving the build-commit record onto the path that compiles
the binaries the image ships

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Acceptance

- `make os-factory-root-gate` passes on cx3576 and on virt-arm64, with device
  node identity actually compared.
- `mutate.sh` extended with the three device-node mutations, each shown red.
- The build-commit record written by the path that builds the shipped binaries,
  the assertion running, and its independence (or lack of it) stated.
- `verify/run.sh --smoke` on both arm64 boards no longer prints `NOT ASSERTED`.
- `verify/run.sh --verify` at its count or the change explained.
- `make docs-verify` green from a `git archive` into an empty directory.

## Outcome

### 1. The gate now compares device nodes, and `diff` is handed only what it can read

`inner.sh` makes **five** comparisons, not four:

| comparison | what it reads |
| --- | --- |
| METADATA | `%M %U %G %P` over every entry |
| CONTENT | a sha256 per regular file, a target per symlink |
| DEVICES | `stat -c '%F %t %T %n'` over every block and character device |
| CAPS | `getcap -r` |
| HARDLINKS | `%n %P` for every file with more than one link |

`diff -r --no-dereference` over the two trees is gone. Neither alternative the
task ruled out was taken: no message is filtered, and `/dev` is still compared.
The content comparison is now a diff of two *files* — the shape `caps` and
`links` already used — so the only things handed to `diff` are text.

**`%M` already carries the type character.** The task's framing said METADATA
sees mode/uid/gid and not device type; measured, `crw-rw-rw- 0 0 dev/null` is
what the inventory prints, so a device node shipped as a regular file, or
missing, was already caught there. What nothing could see is the **major and
minor** — a `/dev/null` exported as character 1:5 has the same mode, owner, link
count and (absent) content as the real one. That is the hole DEVICES closes, and
mutation 5 is the one no other comparison notices.

### 2. A second arm64 blocker, found on the way

**Neither arm64 root carries a single multiply-linked file.** `mutate.sh`'s
hardlink case took the first `-links +1` file and `exit 1`-ed when there was
none, so it could not have completed on cx3576 or virt-arm64 even with the
device-node fix in place. x64 is the only board with one (klibc, one binary
under six names). The case now has two forms — break a link where there is one,
make one where there is not — and says which it used. Without this the gate
still could not pass on either arm64 board.

That comparison was also *vacuous* on those roots for the same reason: an empty
list against an empty list, agreeing because neither side has anything, exactly
the position the file already flags for capabilities.

### 3. `mutate.sh`: six mutations -> **nine**, over five comparisons

Added, each shown red and each reverted:

| # | mutation | comparison |
| --- | --- | --- |
| 5 | `dev/console` 5:1 -> 5:2 | device |
| 6 | `dev/console` character device -> empty regular file | device |
| 7 | `dev/console` removed | device |

### 4. The build-commit record is written by the path that builds the binaries

- `pkgs/mosd/hack/build-deb.sh` writes `_out/mosd-build-<arch>.txt` after it has
  compiled, asserted producer independence and staged the binaries — and only
  for the producer that owns `mosd`/`apid`, so the mqtt producer's run of the
  same script cannot write a record about binaries it did not build.
- `pkgs/mosd/hack/build-target.sh` no longer writes one. It compiles a set no
  image installs, so its record named a build whose output never reached an
  image and was indistinguishable from one that did.
- `rootfs/build.sh` removes the per-board copy at the start and writes it only
  after the image is packed and inside its budget, from the record for the
  board's architecture — and **refuses** to finish without one.

**What the assertion is worth, plainly.** The two sides are the string compiled
*into* the binary in the packed root, read back by executing it, and the string
that producer run wrote to disk. Both descend from one `MOS_BUILD_COMMIT` in one
`build-deb.sh` invocation, so **it is not a check that the commit is right** —
no reader of an image could be. It closes the distance between *the producer was
told to embed X* and *the binary in the image reports X*: a compile cargo did not
re-run for a changed environment variable, an `option_env!` that resolved to
nothing so the binary answers `unknown`, a stage that installed a binary from
somewhere other than the package. The pool's own stamp and `SHA256SUMS` checks
already refuse an archive built from another tree — but they read its name and
its bytes, never what was compiled into the binary inside it.

## Evidence

Everything below is against artifacts built in this worktree at `d01b4be1de03`
— main merged first, through RFCT-352's revision and RFCT-355. Pool: 18
archives at stamp `gitd01b4be1de03-1`.

**`make os-factory-root-gate`, both arm64 boards, green:**

| board | entries | with content | device nodes | caps | hardlinks | mutations |
| --- | --- | --- | --- | --- | --- | --- |
| cx3576 | 4,546 | 3,902 | 8 | 0 | 0 | 9/9 red |
| virt-arm64 | 5,742 | 4,768 | 8 | 0 | 0 | 9/9 red |

```
FIDELITY: the exported OCI image is the tree that ships, on all five comparisons
MUTATION: all five comparisons were driven from the failing side and fired
```

Before: `FIDELITY: 1 of 4 comparisons differ` on both, from eight
`is a character special file while file ... is a character special file` lines.

**`verify/run.sh --smoke`, both boards — `NOT ASSERTED` is gone:**

```
verify smoke: build commit d01b4be1de03, from _out/cx3576/mosd-build.txt
PASS  mosd  ... [said: "mosd 0.1.0 (d01b4be1de03)"], and reports the commit
      d01b4be1de03 that _out/cx3576/mosd-build.txt records this build embedding
RESULT: PASS (11 pass, 1 executor-limited, 0 fail, 0 unclaimed, of 12)
```

`virt-arm64` reads the same against its own record. `crun` is the standing
executor limit, not this change's.

**The assertion driven from the failing side.** A green run of a check nobody
has watched fail proves nothing, so the record's `commit` was set to
`deadbeefcafe` with the image and its binaries untouched, and `--smoke` re-run:

```
RESULT: FAIL (9 pass, 1 executor-limited, 2 fail, 0 unclaimed, of 12). FAILED: mosd, apid.
```

The record was restored and the board re-read its own commit. That run was
taken one merge earlier, at `2839410e2f3d`; neither the record's shape nor the
assertion has moved since.

**`verify/run.sh --verify --board cx3576`: `PASS (440/440 checks, 3 skipped
(cx3576/uboot; each named above))`** — against an image assembled in this
worktree from this pool.

Getting there took one detour worth recording. The first run at this HEAD read
**436/440**, and all four failures were one fact, two per boot slot:

```
FAIL: BOOT-A rk3576-src.dtb: /reserved-memory: ramoops@40110000 at 0x40110000 lies BELOW 0x40200000 ...
FAIL: BOOT-A rk3576-src.dtb: /reserved-memory/ramoops@40110000 does not carry no-map ...
```

RFCT-355 moved ramoops in the DTS, and no BSP kernel on this host had been
rebuilt since: `_out/boards/cx3576/kernel/rk3576-src.dtb` was dated 2026-09-07
16:21 and still carried `ramoops@40110000`. Not this change's, and kernel/DTS
work is out of this task's scope. L1 rebuilt the BSP kernel in `/srv/mos`; its
artefacts were checksummed twice, twenty seconds apart, to confirm the export had
settled, then copied in — after which only the producer that stages them
(`board-cx3576`) was rebuilt, the pool re-indexed, and the cx3576 half of the
pipeline re-run.

**Also green:** `verify/run.sh` (typecheck + 1356/1356 tests),
`make docs-verify` from a `git archive` into an empty directory,
`tests/shell-pipefail-lint.sh` (92/92), `tests/host-toolchain-lint.sh`
(352/352 files, 0 findings).

## What is not covered

- **x64.** No x64 root can be composed here without a full amd64 pool, so the
  content and device-node figures in `tests/factory-root-gate/README.md` are
  arm64's; the x64 row keeps its pre-change entry and hardlink counts. x64 is
  also the only board that can drive `mutate.sh`'s *break*-a-hardlink form, and
  that form is unexercised on this host.
- **Physical cx3576.** Cross-build, image-contract and emulated-execution
  evidence only. No device booted.
- **`--verify` on virt-arm64.** Only cx3576's image was assembled and verified;
  virt-arm64 was built to a root and smoke-tested, which is what the gate needs.

## Files touched outside the repository

`_out/boards/`, `_out/debian-base/`, `_out/cargo/`, `_out/apid-ui/`,
`pkgs/podman/out-{amd64,arm64}` and `pkgs/rauc/out-{amd64,arm64}` were copied in
from `/srv/mos` — all gitignored build outputs, needed to rebuild the pool on
this host. `_out/gate-probe/` holds the pre-change reproduction pair. A private
buildx builder `ai-agent-njizj3fm-arm64` was used throughout; `mos-amd64`,
`mos-arm64` and `mos-rauc-arm64` were not touched. Nothing under version control
was changed outside this branch's commits.
