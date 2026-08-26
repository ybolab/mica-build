# `os/tests/factory-root-gate` — is the OCI export the tree that ships?

**DECIDED 2026-08-26 BY RFCT-113 M7c: it becomes a real target.**
`make os-factory-root-gate` (docker-requiring, like `os-verify-cx3576-v2`), and a
step in `.gitea/workflows/privileged.yml`'s deep lane, which is the only place it
can run on cx3576. The alternative — delete this directory and leave the recipe
in `os/rootfs/stages/README.md` — was rejected for one reason: the invariant here
is *the image the smoke run executes in is byte-for-byte the tree the device
ships*, that is the assumption **every other M7 result rests on**, and nothing
else in the tree checks it. The two trees come from two exports of one stage, so
nothing about their agreement is structural; a smoke run inside a *different*
tree is a measurement of something that never boots.

M7a wrote it and used it for the measurements in `os/rootfs/stages/README.md`,
and left the target decision to M7c because this campaign's rule is that a
committed script nothing runs is worse than no script. It now has something that
runs it.

**It needs a MATCHED PAIR** — `factory-root.oci` and `rootfs-verity.img` from one
build — and it says so and exits non-zero when it has neither, rather than
skipping. `MOS_BOARD` selects the board; `x64` is the default.

## What it is

| file | runs where | what it does |
| --- | --- | --- |
| `gate.sh` | the host | resolves the pinned tool image and runs the other two inside it |
| `inner.sh` | the container | unpacks both trees and compares them four ways; **exits non-zero on any difference** |
| `mutate.sh` | the container | breaks each of those four comparisons in turn and requires each to go red, then to go silent again on revert |

`mutate.sh` is not optional and `gate.sh` runs it every time. Four of the five
comparisons had only ever been seen agreeing, and the file-capability
comparison had **nothing at all** behind it — this root carries no file
capabilities, so it was an empty file compared with an empty file. Without the
mutation pass, that line is a positive result that cannot fail.

## Running it

```sh
MOS_BOARD=x64 bash os/rootfs/build-v2.sh     # produces _out/x64/{rootfs-verity.img,factory-root.oci}
make os-factory-root-gate                    # MOS_BOARD selects the board; x64 by default
bash os/tests/factory-root-gate/gate.sh _out/x64   # the same thing, said longhand
```

Needs docker. It reads `_out/<board>/` and writes only under
`_out/<board>/gate-work/`; it never touches the artifacts it compares.

## Why it runs in a container

Neither side is readable on the build host — there is no `unsquashfs` and no
`getcap`. Both sides run in the same pinned `IMAGE_ALPINE_3_21` with
`os/verify/src/tools.ts`'s package list, which is what makes a difference a
difference between the two trees rather than between two versions of
`squashfs-tools`.

## What it measured on 2026-08-26 (x64)

9,240 entries on both sides; identical on mode/uid/gid/path, on content under
`diff -r --no-dereference`, on file capabilities (0 on both), and on all six
hardlinks. All five driven from the failing side. The full record, including
the reproducibility measurements this harness does *not* cover, is in
`os/rootfs/stages/README.md`.

## What has NOT been run

**cx3576, ever.** This host has no arm64 emulation and no BSP `modules.tar` to
build a cx3576 root from, so the numbers above are x64's and there is no
cx3576 column at all — the same wall RFCT-113's second acceptance clause hit, recorded as a
disposition in `docs/task/RFCT-113.md`. The deep lane above is where it first
runs on arm64.

**M7c did not re-run it green.** The target landed and its REFUSAL was driven
(`rootfs-verity.img is missing or empty`, exit 1, before comparing anything), but
no matched pair existed on that host: the factory root available was M7d's, still
in the docker image store, with no squashfs from the same build beside it. M7a's
run above is the last green one.
