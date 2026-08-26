# `os/tests/factory-root-gate` — is the OCI export the tree that ships?

The invariant: *the image the smoke run executes in is byte-for-byte the tree
the device ships*. Every other smoke-run result rests on that assumption, and
nothing else in the tree checks it. The two trees come from two exports of one
stage, so nothing about their agreement is structural; a smoke run inside a
*different* tree is a measurement of something that never boots.

`make os-factory-root-gate` is the target (docker-requiring, like
`os-verify-cx3576-v2`), and the deep lane of `.gitea/workflows/privileged.yml`
is the step, which is the only place it can run on cx3576.

It needs a matched pair — `factory-root.oci` and `rootfs-verity.img` from one
build — and it says so and exits non-zero when it has neither, rather than
skipping. `MOS_BOARD` selects the board; `x64` is the default.

## What it is

| file | runs where | what it does |
| --- | --- | --- |
| `gate.sh` | the host | resolves the pinned tool image and runs the other two inside it |
| `inner.sh` | the container | unpacks both trees and compares them four ways; **exits non-zero on any difference** |
| `mutate.sh` | the container | breaks each of those four comparisons in turn and requires each to go red, then to go silent again on revert |

`mutate.sh` is not optional and `gate.sh` runs it every time. Four of the five
comparisons can only ever be observed agreeing, and the file-capability
comparison has nothing behind it at all — this root carries no file
capabilities, so it is an empty file compared with an empty file. Without the
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

## What it measures on x64

9,240 entries on both sides; identical on mode/uid/gid/path, on content under
`diff -r --no-dereference`, on file capabilities (0 on both), and on all six
hardlinks. All five comparisons driven from the failing side. The full record,
including the reproducibility measurements this harness does *not* cover, is in
`os/rootfs/stages/README.md`.

## cx3576 is unmeasured

This host has no arm64 emulation and no BSP `modules.tar` to build a cx3576
root from, so the numbers above are x64's and there is no cx3576 column. The
deep lane above is where it first runs on arm64.
