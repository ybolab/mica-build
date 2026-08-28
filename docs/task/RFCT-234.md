# RFCT-234 PLAN-025 M2b: the arm64 builder family, cx3576 rauc, and the RFCT-206 section 7 pass

- **status**: completed
- **priority**: P1
- **owner**: bkd/syk8eqzw
- **createdAt**: 2026-08-28
- **claimedAt**: 2026-08-28
- **completedAt**: 2026-08-28
- **plan**: PLAN-025 (M2b)
- **design**: PLAN-025's engineering-debts list; the capability wall RFCT-231 section 5 recorded, and the one RFCT-206 section 7 recorded before it

RFCT-231 closed two halves of `MOS_BOARD=cx3576 make os-rauc` and recorded a
third as a capability wall this host cannot pass: *"no arm64 mos-build family,
and none producible here"*. That conclusion was too strong, and the reason is
one line. `os/build-env/build.sh` verified each image it built by reading a
recorded env file back out of it with `docker run --entrypoint /bin/sh ... -c
"cat ..."` -- which EXECUTES a shell inside the image, and therefore demanded a
host that can execute the target architecture. The step needs the FILE. Reading
a file out of an image executes nothing.

That line is now a `docker create` + `docker cp` + `docker rm`, the `localhost/`
rows of the image table are fed the OCI layouts RFCT-231's `--contexts` mode
produces, and on this host, with `/proc/sys/fs/binfmt_misc/` empty throughout:

- `MOS_BUILD_PLATFORM=linux/arm64 make build-env` built **all four** images and
  read `MOS_BUILD_ARCH=arm64` back out of each.
- `MOS_BOARD=cx3576 make os-rauc` built **`rauc v1.13 for arm64: 470008 bytes,
  7 shared libraries`**, an `ELF 64-bit LSB pie executable, ARM aarch64`.

The cx3576 IMAGE did not build, and section 6 records the three walls it meets,
in the order it meets them, each with the command and the output. None of the
three is the one RFCT-231 recorded, and two of them were one wall wearing two
faces: `localhost/mos-build-*` was ONE tag holding ONE architecture, and the
image path needs the family at two architectures at the same time.

That tag is the defect this milestone surfaced, and section 7 is its own
finding: building an arm64 family for the first time made an arm64
`make build-env` OVERWRITE the amd64 one, and the reverse an hour later. The
architecture is now part of the tag, both families coexist, and the second of
the three walls is closed by that alone.

## Scope

| file | change |
| --- | --- |
| `os/build-env/build.sh` | the readback no longer executes the image (section 2); the cross-build refusal over the `localhost/` rows is replaced by the OCI-layout handoff (section 3) |
| `os/build-env/from.sh` | one error message, which told the reader `build.sh` refuses a cross build (section 3); then LOCAL_ key resolution, which now appends the architecture and requires `--arch` (section 7) |
| `os/build-env/images.env` | no value changed; the paragraph that says why these four carry NO tag (section 7) |
| `Makefile` | the `build-env` help line, which named a tag that no longer exists |
| `docs/task/RFCT-231.md` | one citation re-anchored mechanically, then the dated correction to section 5 and section 8 (section 7) |
| `docs/task/RFCT-234.md`, `docs/task/index.md` | this record and one index row |

`os/pkgs/rauc/build.sh` and `os/pkgs/podman/build.sh` are in scope and are
**untouched**: nothing measured here asked for a change in either. Section 6
says what podman's failure is instead, and it is not in its driver script.

## 1. The premise, reproduced

RFCT-231 settled arm64 capability on this host by inspection in one place and by
measurement everywhere else. These three are the measurement, re-run here on
2026-08-28 rather than relayed, because they are what the rest of this record
stands on.

**A. The `mos-arm64` docker-container builder DOES execute arm64.** A throwaway
`FROM alpine:3.21` + `RUN uname -m`, built `--builder mos-arm64 --platform
linux/arm64 --load`:

```text
#5 [2/2] RUN echo syk8eqzw-A && uname -m > /arch.txt && cat /arch.txt
#5 0.711 syk8eqzw-A
#5 0.797 aarch64
#5 DONE 2.7s
```

and the image it exported carries `arm64 linux`. `docker buildx ls` denies this,
listing that builder as `linux/amd64 (+3), linux/386`.

**B. The daemon does NOT.** The same image, run by the daemon:

```console
$ docker run --rm --platform linux/arm64 localhost/probe-arm64:syk8eqzw uname -m
exec /bin/uname: exec format error
$ ls -A /proc/sys/fs/binfmt_misc/
$
```

**C. But the readback needs no execution at all.** The same image again, the
same host, the same empty `binfmt_misc`:

```console
$ cid="$(docker create --platform linux/arm64 localhost/probe-arm64:syk8eqzw /bin/sh)"
$ docker cp "$cid:/arch.txt" - | tar -xO
aarch64
$ docker rm -f "$cid"
```

`aarch64`, out of an image whose `/bin/uname` this host cannot run.

## 2. The readback, and why it is still a verification

The line that stopped `MOS_BUILD_PLATFORM=linux/arm64 make build-env` was

```sh
recorded="$(docker run --rm --platform "${MOS_BUILD_PLATFORM}" --entrypoint /bin/sh "${TAG}" -c "cat /etc/mos-build/${name}.env 2>/dev/null || true")"
```

`cat` in a guest shell is a guest binary. What replaces it creates a container
and never starts it:
`cid="$(docker create --platform "${MOS_BUILD_PLATFORM}" "${TAG}" /bin/sh)"`
(`os/build-env/build.sh:582`), then
`docker cp "${cid}:/etc/mos-build/${name}.env" "${envfile}" 2>"${cp_err}" || cp_rc=$?`
(`os/build-env/build.sh:587`). `/bin/sh` is the created container's command and
is never executed; a command is named only because `docker create` wants one
when the image carries no CMD.

**`--platform` keeps the assertion it always carried.** That is measured, not
assumed. Under this daemon's containerd image store a tag that does not hold the
requested platform is not found at all, and `create` and `run` say the identical
thing about it:

```console
$ docker image inspect localhost/probe-amd64:syk8eqzw --format 'stored arch: {{.Architecture}}'
stored arch: amd64
$ docker create --platform linux/arm64 localhost/probe-amd64:syk8eqzw /bin/sh
Unable to find image 'localhost/probe-amd64:syk8eqzw' locally
Error response from daemon: failed to resolve reference "localhost/probe-amd64:syk8eqzw": localhost/probe-amd64:syk8eqzw: not found
$ docker run --rm --platform linux/arm64 localhost/probe-amd64:syk8eqzw cat /arch.txt
Unable to find image 'localhost/probe-amd64:syk8eqzw' locally
docker: Error response from daemon: failed to resolve reference "localhost/probe-amd64:syk8eqzw": localhost/probe-amd64:syk8eqzw: not found.
```

### The `|| true` the old line kept out of the host side

The old line's `|| true` was INSIDE the guest shell. That is not an accident and
the property is preserved: only a missing file, never a docker malfunction,
could reach the emptiness check as empty output. `docker cp` reports an absent
path and a broken daemon through the same exit code, so the replacement tells
them apart by what `docker cp` SAID, and a blanket `|| true` on the host side is
exactly what it must not be:
`if grep -c 'Could not find the file' "${cp_err}" >/dev/null; then`
(`os/build-env/build.sh:598`). `grep -c ... >/dev/null` and not `grep -q`,
because this file sets `pipefail`.

### Both directions, measured

Four arm64 probe images, and the block AS SHIPPED -- lifted out of
`os/build-env/build.sh` character for character and given `name`, `TAG` and
`MOS_BUILD_PLATFORM` -- run against each. The old `docker run` form is beside
each one, and it fails on all four including the good one:

| image | old form | the shipped block |
| --- | --- | --- |
| record present | `exec /bin/sh: exec format error`, rc=255 | the record, rc=0 |
| record absent | `exec /bin/sh: exec format error`, rc=255 | *"carries no /etc/mos-build/base.env"*, rc=1 |
| record present but zero bytes | `exec /bin/sh: exec format error`, rc=255 | *"carries /etc/mos-build/base.env but it is EMPTY"*, rc=1 |
| `docker cp` fails for another reason | -- | *"failed for a reason that is not an absent file"*, rc=1 |

Verbatim, the three that must go red:

```text
error: localhost/rb-absent:syk8eqzw carries no /etc/mos-build/base.env, so what it asserted at build time cannot be read back out of it. An image that inherits its parent's record and writes none of its own is asserting nothing under its own name
error: localhost/rb-empty:syk8eqzw carries /etc/mos-build/base.env but it is EMPTY, so what it asserted at build time cannot be read back out of it. An image whose record is a zero-byte file is asserting nothing under its own name
error: reading /etc/mos-build/base.env out of localhost/rb-ok:syk8eqzw failed for a reason that is not an absent file, so whether that image carries its own record is unknown: Error response from daemon: connection to the daemon was lost
```

The last row is produced by putting a `docker` on `PATH` that fails `cp` and
delegates everything else, which is the only way to make that branch happen on a
working daemon. The empty-file case is a distinction the old line did not draw:
an absent record and a zero-byte one gave it the same message.

The green case is the same block on an amd64 image on the `default` builder,
which is the path this check has always taken: it returns the record, rc=0.

## 3. The `localhost/` rows, fed rather than refused

The refusal that stood over the cross-build path said the `localhost/` rows are
*"a tag that exists only in the local docker image store, which that driver
cannot read"*. True, and no longer a reason to stop: RFCT-231 taught
`os/build-env/from.sh` to export such an image as an OCI layout and print the
`--build-context` that overrides the matching `FROM`, and its section 5 said in
so many words that *"the localhost rows could be fed the way rauc and podman are
fed"*.

They are, and the export happens INSIDE the build loop rather than before it:
`mapfile -t CTX_ARGS < <(bash "${HERE}/from.sh" --arch="${PLATFORM_ARCH}" \`
(`os/build-env/build.sh:521`). A row's parent is produced by an EARLIER
ITERATION of that loop -- the table's ordering check proves the producing row
comes first -- so exporting up front would export whatever a previous run left
tagged, which is the failure mode that ordering check exists to prevent.
Nothing is exported when the driver is `docker`: the tag resolves directly, and
copying the family to disk on every native build would change nothing.

Which driver it is, is read off the builder rather than inferred from its name,
the register `os/pkgs/rauc/build.sh` uses.

One thing in `os/build-env/from.sh` had to change with it, and it is a sentence
rather than a mechanism. Its architecture refusal told the reader
*"os/build-env/build.sh refuses that today when it is not the host's
architecture"*. It does not, since this task. What replaces that clause is the
limit that IS left, and section 6 is where it was met.

## 4. `MOS_BUILD_PLATFORM=linux/arm64 make build-env`

All four rows, on the `mos-arm64` docker-container builder, with
`/proc/sys/fs/binfmt_misc/` empty:

```text
=== mos-build-base ===
  from      IMAGE_DEBIAN_TRIXIE=debian:trixie-slim@sha256:d7e12182ce18b85b93007c1dedf31f2d29e01ccf3182cc4017c709b6259bc132
  platform  linux/arm64
  tagged    localhost/mos-build-base
  image id  sha256:b1f5a46d61f8172d882849ea5eceb18079cd10d242b21085a47e629c45f0fab5
  MOS_BUILD_IMAGE=mos-build-base
  MOS_BUILD_ARCH=arm64
  MOS_BUILD_GIT=2.47.3
=== mos-build-c ===
  context   localhost/mos-build-base=oci-layout:///tmp/tmp.8MPI3qKbeo/contexts/mos-build-base
  tagged    localhost/mos-build-c
  MOS_BUILD_ARCH=arm64
  MOS_BUILD_GCC=14.2.0
=== mos-build-go ===
  tagged    localhost/mos-build-go
  MOS_BUILD_ARCH=arm64
  MOS_BUILD_GO=1.26.7
=== mos-build-rust ===
  tagged    localhost/mos-build-rust
  MOS_BUILD_ARCH=arm64
  MOS_BUILD_RUSTC=1.98.0
  MOS_BUILD_RUST_HOST_TRIPLE=aarch64-unknown-linux-gnu
```

(abridged to the lines that carry the claim; every row printed its full record.)
`MOS_BUILD_ARCH=arm64` in each is the point: it was read out of an arm64 image
by a host that cannot execute one, and `mos-build-base`'s floor assertions --
including the `TARGETARCH` check that catches a builder silently producing a
host-architecture image -- ran INSIDE the image while it was built, on the
builder that measurement A proves executes arm64.

**One row failed once, transiently.** The first run died on `mos-build-go` with
`ERROR: failed to build: failed to solve: frontend grpc server closed
unexpectedly`, and buildkit's own log carried nothing beyond the same sentence.
The builder container was up with `OOMKilled=false ExitCode=0`. That row then
built on its own, isolated, against the same layout, and built again in the
re-run above. It is recorded because a green second run is not evidence that the
first failure was not real -- what makes it transient is that the same inputs
produced both outcomes, and the next person to see it should not go looking for
a defect in the go row.

## 5. `MOS_BOARD=cx3576 make os-rauc`

Green, end to end, which is the target RFCT-206 section 7 recorded as refusing:

```text
rauc v1.13 for arm64: 470008 bytes, 7 shared libraries
  libc.so.6
  libcrypto.so.3
  libfdisk.so.1
  libgio-2.0.so.0
  libglib-2.0.so.0
  libgobject-2.0.so.0
  libjson-glib-1.0.so.0
```

and the artifact is what it says:

```console
$ file os/pkgs/rauc/out-arm64/rauc
os/pkgs/rauc/out-arm64/rauc: ELF 64-bit LSB pie executable, ARM aarch64, version 1 (SYSV), dynamically linked, interpreter /lib/ld-linux-aarch64.so.1, ..., stripped
```

## 6. The cx3576 image: three walls, in the order it meets them

`MOS_BOARD=cx3576 make os-image-cx3576-v2` does not produce an image on this
host. The kernel and both U-Boot variants build here (`make cx3576-kernel`,
`make cx3576-uboot`, `make cx3576-uboot-mos` all green, leaving `Image`,
`modules.tar` and `rk3576-src.dtb` under `os/boards/cx3576/bsp/out/`), and rauc
stages. What stops it is three things, and NONE of them is the wall RFCT-231
recorded.

### Wall 1 -- `make podman` for arm64

```text
error: /srv/.../os/pkgs/podman/out-arm64/podman not found.
stages/31-feature-containers is in the chain, which asks for a container engine, and none has been built.
```

`MOS_BOARD=cx3576 make podman`, with the arm64 family in the store, reaches the
source stage and dies inside it:

```text
#16 [src 2/3] RUN --mount=type=cache,target=/root/.cache/git     set -eu; . /versions.env; ... fetch podman ...
#16 0.476 exec /bin/sh: exec format error
#16 ERROR: process "/bin/sh -c set -eu; ..." did not complete successfully: exit code: 255
```

This is the consequence RFCT-231 section 4 pre-declared, now met on the real
build rather than on a probe. `os/pkgs/podman/Dockerfile`'s source stage is
`FROM --platform=$BUILDPLATFORM ${MOS_BUILD_BASE} AS src`, so ONE build needs
that base at TWO architectures: the build platform's to clone and hash the
sources, the target's to compile. Handed a single-architecture layout, buildx
does not refuse the mismatch -- it serves what the layout holds, and the stage
dies inside.

Nothing in `os/pkgs/podman/build.sh` can fix that, which is why it is untouched:
the driver hands over the tag it is given, and the tag is the problem.

### Wall 2 -- the family was needed at both architectures at once. CLOSED

This wall was real when first met and is gone. It is kept here because what
removed it is section 7, and the before-and-after is the argument for that
change.

With containers declined, the chain got much further and then met the
one-tag-one-architecture limit from the other side:

```text
error: LOCAL_MOS_BUILD_RUST=localhost/mos-build-rust is a arm64 image and this build targets amd64.
error: os/build-env/from.sh did not yield localhost/mos-build-rust (see its message above)
```

`os/pkgs/mosd/hack/build-target.sh` selects `IMAGE_ARCH=amd64` for an
`aarch64-*` target BY DESIGN -- *"cross-built FROM an amd64 builder"* -- so the
cx3576 image path wants an **amd64** `mos-build-rust` in the same run that wants
an **arm64** `mos-build-c` for rauc. With one architecture-less tag those two
demands could not both be satisfied, and satisfying either meant destroying the
other family.

Both now coexist under `:amd64` and `:arm64`, so both are satisfied at once and
nothing has to be restored between steps. Re-run after section 7 landed, the
same command walks straight past it:

```text
mosd: four aarch64 ELFs in target/aarch64-unknown-linux-gnu/release
firmware: staged 5 file(s) from .../bsp/rootfs/firmware
rendered .../etc/rauc/system.conf (compatible=mos-cx3576, bootloader=uboot, ...)
overlay: layered 7 board-specific file(s) from boards/cx3576/overlay
layout: 8 repart definitions, 1 of them growing
```

and stops at wall 3 instead. This is RFCT-231 section 5's pre-declared item 2,
met and closed.

**What wall 1 needs is a further change, and section 7 is its prerequisite
rather than its substitute.** Two coexisting tags let a HOST hold both families;
they do not let a single `FROM` resolve to two architectures. `make podman`
re-run after section 7 fails identically -- `#18 0.417 exec /bin/sh: exec format
error` -- because `os/pkgs/podman/build.sh` resolves ONE base for every stage
with `--arch=${MOS_ARCH}`, and the `src` stage wants the build platform's. What
closes it is a second build argument: a `MOS_BUILD_BASE_NATIVE` resolved with
the HOST's architecture, replacing the argument in
`FROM --platform=$BUILDPLATFORM ${MOS_BUILD_BASE} AS src`
(`os/pkgs/podman/Dockerfile:74`) and carried as a second OCI layout. That is now possible
where before it was not -- an amd64 base to resolve it to did not exist on a
host that had built an arm64 family. It is NOT done here: proving it means an
arm64 podman, crun, netavark and aardvark-dns compile under emulation, and
shipping the wiring without running it would be the one thing these records do
not do.

### Wall 3 -- the rootfs stage chain, which is a host capability

Past both of those, `os/rootfs/build-v2.sh` stops on its own terms:

```text
error: the 'default' buildx builder cannot reach linux/arm64.
       Its platforms are: linux/amd64, linux/amd64/v2, linux/amd64/v3
       Install arm64 emulation on the host:
         docker run --privileged --rm tonistiigi/binfmt --install arm64
       A docker-container builder would bundle QEMU and would ALSO not work here: the
       stage chain resolves FROM against the local image store, which that driver
       cannot read. os/rootfs/stages/README.md records the measurement.
```

That file is not in this task's scope, and the second half of its refusal is the
same shape this task closed elsewhere. But the OCI-layout mechanism would only
carry the `FROM` half of it, and there is a half it cannot carry: the smoke run
is part of this build, and it EXECUTES the self-built board binaries inside the
root that ships them. Executing an aarch64 binary on this host needs
`/proc/sys/fs/binfmt_misc/` to hold an arm64 registration, and RFCT-206 section
7 records that the documented remedy reports success here and leaves that
directory empty. It is still empty; measurement B above is that directory.

**A host that CAN build the cx3576 image must therefore have:** an arm64 entry
in `/proc/sys/fs/binfmt_misc/` (which `docker run --privileged --rm
tonistiigi/binfmt --install arm64` provides on a host where the registration
sticks), plus either the multi-architecture family change above or a second
machine for the arm64 component builds.

**A booted cx3576 smoke stays a stated obligation, not a failure.** There is no
cx3576 hardware on this host, and RFCT-206 section 7's three-item list is
unchanged by anything here except its first item's prerequisites.

## 7. The defect this milestone surfaced: an architecture-less tag

Building an arm64 family for the first time turned a latent naming defect into
an active one, twice, on this host, inside one hour. It is recorded here as a
finding rather than as an incident because the mechanism is one line and the
consequence is total.

### The mechanism

`os/build-env/build.sh` tagged every image it built as
`TAG="localhost/mos-build-${name}"` -- no architecture anywhere in the name --
and `os/build-env/images.env` held the same four architecture-less values for
every consumer to resolve. So `MOS_BUILD_PLATFORM=linux/arm64 make build-env`
does not ADD a family. It writes the same four tags the amd64 family occupied,
and the amd64 images are left untagged and prune-eligible.

This is not a race and not a risk. With an architecture-less tag the second
build to run on a host always destroys the first one's family, and the loser is
whichever ran first.

### Both directions, measured

**arm64 over amd64.** After section 4's run, all four tags reported
`Architecture=arm64`, and the gate that runs in `localhost/mos-build-rust` --
`os/pkgs/mosd/hack/check.sh`, which a sibling workstream depends on -- became:

```console
$ docker run --rm localhost/mos-build-rust bash -c 'uname -m; cargo --version'
WARNING: The requested image's platform (linux/arm64) does not match the detected host platform (linux/amd64/v3)
exec /usr/bin/bash: exec format error
```

**amd64 over arm64.** Restoring the amd64 family for section 9's regression row
then orphaned the arm64 images this milestone had just spent an hour building --
the same four tags, back to `Architecture=amd64`, and the arm64 family dangling.

Neither family was deleted; both were overwritten, and in both cases the images
survived only as dangling ones that a `docker image prune` or a builder GC would
have collected.

### The fix: the architecture is part of the name

`localhost/mos-build-${name}:${PLATFORM_ARCH}`
(`os/build-env/build.sh:473`). `os/build-env/images.env` still holds the
repository with NO tag, because the architecture must live in exactly one place;
`os/build-env/from.sh` appends the same suffix when it resolves a LOCAL_ key,
and `--arch` becomes REQUIRED for one:

```console
$ bash os/build-env/from.sh --ref LOCAL_MOS_BUILD_RUST
error: LOCAL_MOS_BUILD_RUST is an image this repository builds, and those are tagged by architecture -- localhost/mos-build-c:amd64 and localhost/mos-build-c:arm64 are two images that coexist. Pass --arch=<amd64|arm64> to say which this build stands on. [...]
$ bash os/build-env/from.sh --arch=amd64 MOS_BUILD_RUST=LOCAL_MOS_BUILD_RUST
--build-arg
MOS_BUILD_RUST=localhost/mos-build-rust:amd64
$ bash os/build-env/from.sh --arch=arm64 MOS_BUILD_RUST=LOCAL_MOS_BUILD_RUST
--build-arg
MOS_BUILD_RUST=localhost/mos-build-rust:arm64
```

Requiring `--arch` rather than defaulting to the host is the deliberate part.
Both families are in the store at once BY DESIGN now, so there is no "the" local
image to fall back on, and defaulting to the host's would hand a native answer
to exactly the cross build this naming exists to serve -- silently. All four
callers that resolve a LOCAL_ key already passed `--arch`
(`os/pkgs/rauc/build.sh`, `os/pkgs/podman/build.sh`,
`os/pkgs/mosd/hack/build-target.sh` and `os/build-env/build.sh`'s own loop), so
no caller is special-cased and none needed a change. The two callers that
resolve only IMAGE_ keys are untouched by construction.

`os/build-env/build.sh` no longer reads the parent out of the sourced pin file
either. It asks from.sh, so the suffix is composed in ONE file rather than two
that could drift:
`mapfile -t FROM_ARGS < <(bash "${HERE}/from.sh" --arch="${PLATFORM_ARCH}" "MOS_BASE_IMAGE=${from_key}")`
(`os/build-env/build.sh:479`).

### The check that changed meaning

from.sh's architecture check is still there and now asks a different question.
It used to ask *"is the family this host happens to hold the one this build
needs"* -- which the name now answers. It asks *"does this tag hold what its
name says"*, which catches a tag applied by hand or composed differently.
Proved by pointing the arm64 tag at an amd64 image:

```console
$ docker tag localhost/mos-build-go:amd64 localhost/mos-build-go:arm64
$ bash os/build-env/from.sh --arch=arm64 MOS_BUILD_GO=LOCAL_MOS_BUILD_GO
error: LOCAL_MOS_BUILD_GO resolves to localhost/mos-build-go:arm64, whose tag says arm64 and whose image is amd64. That tag is written by os/build-env/build.sh and by nothing else, so this is not a family that needs rebuilding -- it is a tag that lies about what it holds [...]
```

### The acceptance, which is not "two tags exist today"

Two full builds, in both orders, with the image ids recorded on each side:

```console
$ MOS_BUILD_PLATFORM=linux/arm64 make build-env      # tagged ...:arm64 x4
$ diff amd64-before.txt amd64-after.txt
$                                                     # identical, all four
$ make build-env                                      # native; tagged ...:amd64 x4
$ diff arm64-before.txt arm64-after.txt
$                                                     # identical, all four
```

A cross build no longer touches the native family, and the native build no
longer touches the cross one. The `c` row's `from` line in each run names the
tag it stood on -- `LOCAL_MOS_BUILD_BASE=localhost/mos-build-base:arm64` in the
first, `:amd64` in the second -- so the two runs are visibly standing on
different parents rather than racing for one name.

### What happened to the rescue tags

L2 rescued both orphaned families under `localhost/mos-build-*:rescued-amd64`
and `:rescued-arm64` while this fix was being written, explicitly as scaffolding
and not as a proposed scheme. Both are gone: the amd64 and arm64 families are
now what `make build-env` itself wrote under `:amd64` and `:arm64`, and the
`:latest` tag was removed with them. `:latest` is deleted rather than left
pointing at one of the two, because an unqualified name that resolves is exactly
the defect this section is about -- a caller that asks for it should get "no such
image", not a coin flip. No rescue name appears in committed content.

## 8. The correction to RFCT-231

RFCT-231 section 5 is titled *"no arm64 mos-build family, and none producible
here"* and says the remedy *"has its own wall"*. The measurements under that
heading were right; the conclusion drawn from one of them was not, and this task
produced the family it says cannot be produced. Its record now carries a dated
note under that heading, in the register `docs/design/mosd.md` uses: the
2026-08-28 text stays exactly as written, and the note says what changed, when,
and which of its three pre-declared items are now done. Section 8's
*"`os/build-env/build.sh`, for the reason section 5 gives"* carries a second,
one-line note, because that reason is the one that did not hold.

One citation in it needed re-anchoring for a different reason:
`docker buildx create --name "mos-${PLATFORM_ARCH}" --driver docker-container`
moved from line 373 to 361 when this task rewrote the block above it. That is a
mechanical move and is in its own commit, ahead of the correction. A second
citation could not be re-anchored: RFCT-231 quotes
`and passing it to its children as` from a comment this task rewrote, and the
quoted words are no longer in the file at any line. That is the situation
RFCT-231 section 6 met and it is handled the same way -- the quote stays as the
record of what was read, the line anchor is replaced by the commit it was read
against.

## 9. Verification

| command | result |
| --- | --- |
| measurement A, the arm64 builder | `#5 0.797 aarch64`, image `arm64 linux` |
| measurement B, the daemon | `exec /bin/uname: exec format error`; `/proc/sys/fs/binfmt_misc/` empty |
| measurement C, the readback | `aarch64` out of the same image, no emulator |
| the shipped readback, record present | the record, rc=0 |
| the shipped readback, record absent | *"carries no /etc/mos-build/base.env"*, rc=1 |
| the shipped readback, record zero bytes | *"carries ... but it is EMPTY"*, rc=1 |
| the shipped readback, `docker cp` broken | *"not an absent file"*, rc=1 |
| `MOS_BUILD_PLATFORM=linux/arm64 make build-env` | all four tagged, `MOS_BUILD_ARCH=arm64` read back from each |
| `MOS_BOARD=cx3576 make os-rauc` | `rauc v1.13 for arm64: 470008 bytes, 7 shared libraries` |
| `MOS_BOARD=cx3576 make os-image-cx3576-v2` | stops at wall 1, section 6 |
| the same chain, containers declined, after section 7 | past wall 2 without restoring anything; stops at wall 3 |
| `make build-env` (native amd64) | all four tagged, `MOS_BUILD_ARCH=amd64` read back from each -- the path this readback always took, unchanged |
| `from.sh --ref LOCAL_MOS_BUILD_RUST`, no `--arch` | refused by name, section 7 |
| `from.sh --arch=amd64` / `--arch=arm64`, same key | `localhost/mos-build-rust:amd64` / `:arm64` |
| the arm64 tag pointed at an amd64 image | *"whose tag says arm64 and whose image is amd64"*, rc=1 |
| arm64 `make build-env`, then the amd64 ids | `diff` empty -- the cross build did not touch the native family |
| native `make build-env`, then the arm64 ids | `diff` empty -- the native build did not touch the cross family |
| `docker run --rm localhost/mos-build-rust:amd64 bash -c 'uname -m; cargo --version'` | `x86_64`, `cargo 1.98.0 (797e8a9bc 2026-08-05)` |
| the same command on `:arm64`, as the control | `exec /usr/bin/bash: exec format error` |
| `bash os/pkgs/mosd/hack/check.sh` in `localhost/mos-build-rust:amd64` | `705 tests run: 705 passed, 0 skipped`, `advisories ok, bans ok, licenses ok`, `ALL CHECKS PASSED` |
| `MOS_BOARD=x64 make os-rauc` | `rauc v1.13 for amd64: 453872 bytes, 7 shared libraries` |
| `make os-shell-pipefail-lint` | `RESULT: PASS (31/31 files clean, 31 scanned)` |
| `bash docs/verify-citations.sh` | `1416/1416 PASS` |
| `bash docs/verify-index.sh` | `760/760 PASS` |

The amd64 `docker run` row has an arm64 CONTROL beside it deliberately. An
amd64 result on its own does not distinguish "this image executes" from "the
daemon was healthy just then"; the two rows differ, on the same command a second
apart, so what they measure is the architecture and not the load average.

The mosd gate is run with `bash -c` and never `bash -lc`. `-l` sources
/etc/profile, which OVERWRITES a PATH passed into the container, so the
/tools mount carrying rustfmt, clippy, nextest and cargo-deny vanishes and the
failure then reads as a broken mount rather than as a shell flag. The tools come
from that mount because the image ships `cargo` and `rustc` only, and they are
run against the image's OWN `$(rustc --print sysroot)/lib` -- the
`librustc_driver-28a98848f7a7c026.so` there is the one they were linked against,
and `clippy 0.1.98` matches the image's `rustc 1.98.0`. `dbus-daemon` is
apt-installed into the container first; without it the nextest run goes red.

The two native rows are in that table deliberately. Every other row is about a
path that could not run before this change; those two are about the path that
could, and a verification step rewritten under them is exactly the kind of
change that breaks what already worked.

## 10. Out of scope, and untouched

- `os/rootfs/build-v2.sh`, whose refusal is wall 3. It was read and not edited.
- `os/pkgs/podman/build.sh` and `os/pkgs/rauc/build.sh`. Both were exercised;
  neither needed a change. Wall 1 is in `os/pkgs/podman/Dockerfile`'s stage
  graph and in the one-tag-one-architecture limit, not in either driver.
- `os/build-env/images.env`'s VALUES. Section 7 added a paragraph to it and
  changed no assignment: the four LOCAL_ values stay untagged, which is what
  puts the architecture in exactly one place.
- Closing walls 1 and 2 is a further change to how the family is PUBLISHED --
  multi-architecture content rather than two single-architecture tags -- and no
  run here could have exercised one. Section 7 is a prerequisite for it, not a
  substitute: two coexisting tags let a host hold both families, but a single
  build that needs both at one `FROM` still cannot be satisfied by two names.
- Booting cx3576. There is no hardware on this host.
