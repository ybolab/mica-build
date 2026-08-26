# os/rootfs/scripts — the shell that used to live inside the Dockerfile

Every `RUN` body in `../stages/*.Dockerfile` longer than one command is a file
here. Each stage file reaches its own the same way:

```dockerfile
RUN --mount=type=bind,source=os/rootfs/scripts,target=/mos-scripts \
    sh /mos-scripts/<name>.sh
```

RFCT-111 M5a extracted them from the single `Dockerfile.v2`. The point was M5b:
that file splits into one Dockerfile per stage, and a stage boundary can only be
drawn through shell that is addressable. M5b has since distributed them — every
file below names its stage in its own header, and `../stages/README.md` says
which stage holds what.

## Why a bind mount and not a `COPY`

A `COPY` would put the script *in the image*. The mount exists only for the
duration of its `RUN` and leaves nothing behind — neither the files nor the
`/mos-scripts` directory. That is what makes the extraction invisible in the
packed root, and it was measured, not assumed: x64 was built before and after
and `rootfs-verity.img` had the same sha256.

That measurement was cache-hot, which is the only way it could be made. M5b then
measured that a **cold** x64 build does not reproduce itself at all — two cold
builds of the untouched file gave `1b3f5e50…` and `7aad6efd…` — so the gate for
a change here is the content diff recorded in `../README.md`, never a hash.

`/mos-scripts` is at the top level rather than under `/tmp` on purpose. If the
mount ever did leak, a stray directory at `/` is something `ls /` on the packed
root shows and the image verifier's layout checks would notice; the same leak
under `/tmp` would be invisible.

## How the build arguments get in

Docker puts every `ARG` that has a value into the `RUN`'s **environment**, so
the shell reads them from there — and so does any child of that shell. Nothing
is passed explicitly on the `RUN` line, because nothing needs to be: the script
inherits `BOARD_RADIOS`, `MOS_ARCH`, `RAUC_BOOTLOADER` and the rest exactly as
an inline body would have seen them.

`WITH_CONTAINERS` and `WITH_MOSD` used to be on that list and are not any more.
RFCT-111 M5c replaced them with stage selection: five scripts each opened by
testing `WITH_CONTAINERS` and a sixth tested `WITH_MOSD` four times, and every
copy was a chance to disagree with the others. A declined feature is now a stage
file the driver does not build, so a script that runs at all was asked for.
`../stages/README.md` has the mechanism.

The failing side matches too. An `ARG` declared with no value is *unset* in the
environment, not empty, so a `set -u` on it fails inside the script for the same
reason and with the same message it failed inline. Each script names the
arguments it reads in its header.

## Where the comments went

The prose stayed in the stage files. It explains what the image *is* — which
package is in the allowlist and why, which unit is deliberately not enabled —
and that belongs next to the `FROM`, `ARG` and `COPY` it describes.

The comments that sat **inside** a `RUN` body came here with their code, because
they explain lines of shell. They are also real comments now. Inside a `RUN` they
were not: the Dockerfile parser deletes a whole-line comment *before* it joins
the continuations, so those lines never reached the shell at all. That is why
they could sit in the middle of a `&&` chain without breaking it — and why an
apostrophe in one had to be written `'"'"'` to be safe. Neither is needed here.

## What deliberately did not move

- **Package lists.** A stage's package set *is* the image; reading it should not
  require opening a second file. `apt-get install` lines stay in the Dockerfile.
- **Single-command `RUN`s.** `RUN rm -f /etc/ssh/ssh_host_*` gains nothing from
  a hop through a file.

## The seam is the `RUN` boundary

One `RUN` becomes exactly one script. None were merged and none were split.
The single file already chose those boundaries for reasons it documents — the
pack stage says outright that it is "in three steps so each can carry its own
explanation and cache independently" — and re-cutting them would have been a
second change riding along with the extraction, with nothing to check it
against.

## These scripts are POSIX `sh`, and must stay that way

They run under the container's `/bin/sh`, which is dash on Debian. In
particular **do not add `set -o pipefail`**: dash has no such option, and
several of these scripts use `producer | grep -q` — a form that is correct
without that option and inverts its own answer with it. `os-shell-pipefail-lint`
scans only files that enable it, which is why these are outside its scope by
construction rather than by exemption.

## Verifying a change here

`sh -n` catches syntax. For a change that is meant to be a *refactor*, the check
that matters is that bash parses the old and new bodies to the same tree:

```sh
canon() { bash -c "__c__() {
$(cat "$1")
}
declare -f __c__"; }
diff <(canon old.sh) <(canon new.sh)
```

`declare -f` re-prints a function from bash's parse tree, so indentation, line
breaks and comments are gone and anything that survives is program structure.
That is how all 34 of these were checked against the `RUN` bodies they came
from, including the cx3576-only paths an x64 build never executes.
