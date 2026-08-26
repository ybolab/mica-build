# `os/tests/factory-root-gate` — is the OCI export the tree that ships?

**THIS HAS NO `make` TARGET, AND THAT IS NOT AN OVERSIGHT — IT IS RFCT-113 M7c'S
DECISION TO MAKE.** M7a (the export) wrote it and used it to produce the
measurements recorded in `os/rootfs/stages/README.md`. M7a did not give it a
target because M7c owns the gate, and this campaign's rule is that a committed
script nothing runs is worse than no script. It is committed rather than left in
prose because re-deriving 250 lines from a recipe is worse still.

**M7c: decide one of two things, and say which.**

1. **It becomes a real target.** The invariant it checks — *the image the smoke
   run executes in is byte-for-byte the image the device ships* — is the
   assumption every other M7 result rests on, and nothing else checks it. It
   needs a built rootfs, the way `os-verify-cx3576-v2` needs a built image, so
   it would be a docker-requiring target and not part of the unit floor.
2. **The recipe in `os/rootfs/stages/README.md` suffices**, and this directory
   is deleted — with the reason recorded, not merely by removal.

What it may not do is stay here unrun.

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
bash os/tests/factory-root-gate/gate.sh _out/x64
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
