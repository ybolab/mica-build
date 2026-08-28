# RFCT-231 PLAN-025 M2a: cx3576 builder unpin and mos-build-* reachability

- **status**: completed
- **priority**: P1
- **owner**: bkd/i5oya9q7
- **createdAt**: 2026-08-28
- **claimedAt**: 2026-08-28
- **completedAt**: 2026-08-28
- **plan**: PLAN-025 (M2a)
- **design**: PLAN-025's engineering-debts list; the capability wall RFCT-206 section 7 recorded for `MOS_BOARD=cx3576 make os-rauc`

`MOS_BOARD=cx3576 make os-rauc` could not run on this host, and two independent
halves held it. The first was a decision written into two files: the buildx
builder was pinned to `default` unconditionally, so a host without arm64 binfmt
had no route at all. The second was the reason that pin existed: every stage of
those Dockerfiles is `FROM` a `localhost/mos-build-*` tag, and the only buildx
driver that resolves such a tag is `docker`.

Both are closed. The builder is now selected rather than pinned, and the
`localhost/mos-build-*` bases are handed to a container builder as content
instead of as names. What is NOT closed, and is recorded here with the command
and the output rather than worked around, is the third thing standing behind
them: this host holds no **arm64** mos-build family, and cannot produce one,
because building one ends in a `docker run --platform linux/arm64` that the
host kernel cannot execute.

## Scope

| file | change |
| --- | --- |
| `os/build-env/from.sh` | a fourth mode, `--contexts=<dir>`: export each LOCAL_ image to an OCI layout and print the `--build-context` that overrides the matching `FROM` |
| `os/pkgs/rauc/build.sh` | builder selected instead of pinned; OCI-layout contexts when the chosen builder is not the docker driver; the refusal rewritten around what is missing after the fix |
| `os/pkgs/podman/build.sh` | the identical block, for the identical reason (see *Why podman too*) |
| `docs/task/RFCT-206.md` | one citation re-anchored: its quote of the old refusal named line 73 of `os/pkgs/podman/build.sh`, a line this task rewrote (see *The citation this moved*) |

`os/build-env/build.sh` was in scope and is **untouched**; section *The wall*
says why, and it is not an oversight.

## 1. The builder, selected rather than pinned

The pin read `BUILDER_ARGS=(--builder default)` with a refusal under it. What
replaces it is the register `if [ -n "${BUILDX_BUILDER:-}" ]; then`
(`os/rootfs/build-v2.sh:571`) already uses -- an explicitly named builder, with
`BUILDX_BUILDER` winning when a caller names one, because a caller who names a
builder has made a decision:

- `BUILDX_BUILDER` set: that builder, and this script does not second-guess it.
- otherwise `default` when it offers `linux/${MOS_ARCH}`, which is exactly when
  the host has binfmt registered for that architecture.
- otherwise the `mos-${MOS_ARCH}` docker-container builder, created on demand.
  Same name and same creation as
  `docker buildx create --name mos-arm64 --driver docker-container`
  (`os/tests/quadlet-doc-test.sh:83-85`), so there is still one way to get a
  cross-capable builder in this tree.

What is NOT inherited is the ambient selection. The old comment's reason for
that stands unchanged and is kept: a leftover `mos-rauc-arm64` from an
unrelated build is a plausible current builder on any host that has ever run
`make os-rauc`.

The `grep -c ... >/dev/null` form survived the rewrite on both sides of the
selection. It is not stylistic: `os/tests/shell-pipefail-lint.sh` exists for the
one mistake of putting an early-exiting `grep -q` on the right of a pipe in a
file that sets `pipefail`, and it caught this exact line once already. Under the
new code the consequence would have been quieter, not louder -- the pipeline
would report failure precisely when the platform IS present, so the container
builder would be selected on the hosts that can build natively, intermittently.

## 2. The refusal, rephrased around the state after the fix

The old refusal told the operator to register host binfmt. After the
reachability fix that advice is wrong for the common case: nothing about this
build needs host binfmt any more, because the container builder carries the
emulators itself. A refusal that names a remedy the build no longer needs is
worse than no refusal, so it was rewritten rather than kept.

It is still a refusal, not a warning. What it now refuses is the one builder
this script may not replace -- the one a caller named:

```text
error: the buildx builder '<name>' uses the docker driver and does not offer
linux/arm64 on this host, so every RUN in os/pkgs/rauc/Dockerfile would fail with
'exec format error'. Either register the emulator on the HOST -- docker run
--privileged --rm tonistiigi/binfmt --install arm64 -- or unset BUILDX_BUILDER and
let this script select the docker-container builder 'mos-arm64', whose buildkit
image bundles the emulators and needs no host registration
```

The driver is read off the builder (`docker buildx inspect`, the `Driver:` line)
rather than guessed from its name, because `BUILDX_BUILDER` may name anything;
a builder that reports no driver at all is itself a refusal, since nothing
downstream could then tell whether the bases go over as tags or as layouts.

## 3. Reachability: the bases as content, not as names

### The measurement, red

A throwaway Dockerfile whose entire content is

```dockerfile
FROM localhost/mos-build-base
RUN uname -m
```

built with `docker buildx build --builder mos-arm64 --platform linux/arm64`:

```text
#2 [internal] load metadata for localhost/mos-build-base:latest
#2 ERROR: failed to do request: Head "http://localhost/v2/mos-build-base/manifests/latest": dial tcp [::1]:80: connect: connection refused
------
 > [internal] load metadata for localhost/mos-build-base:latest:
------
Dockerfile:1
--------------------
   1 | >>> FROM localhost/mos-build-base
   2 |     RUN uname -m
--------------------
ERROR: failed to build: failed to run Build function: localhost/mos-build-base: failed to resolve source metadata for localhost/mos-build-base:latest: failed to do request: Head "http://localhost/v2/mos-build-base/manifests/latest": dial tcp [::1]:80: connect: connection refused
```

That is the whole of the second half: the builder is not confused about the
architecture, it is treating `localhost/` as a registry hostname and dialling
port 80.

### The measurement, green

The same Dockerfile, the same builder, the same platform, with the base handed
over as an OCI layout instead of as a name:

```text
#4 [context localhost/mos-build-base] OCI load from client
#4 resolve localhost/mos-build-base@sha256:b1f5a46d61f8172d882849ea5eceb18079cd10d242b21085a47e629c45f0fab5 0.0s done
#4 DONE 0.4s

#5 [1/2] RUN uname -m
#5 0.560 aarch64
#5 DONE 63.8s
```

`aarch64`, from a `FROM localhost/mos-build-base` line that is character for
character the one that produced the refusal above. Two things are proved at
once: the `localhost/` base resolves, and the `mos-arm64` builder genuinely
executes linux/arm64 -- which `docker buildx ls` denies, listing that builder
as `linux/amd64 (+3), linux/386` and nothing else. RFCT-206 section 7 recorded
that under-reporting; this run is an independent instance of it.

The layout in that green run is an arm64 `mos-build-base` built here for the
purpose, with `os/build-env/base/Dockerfile` unmodified and its floor
assertions passing inside the image (`ok git 2.47.3 (floor 2.47)`,
`ok file 5.46 (floor 5.46)`, `ok binutils 2.44 (floor 2.44)`,
`ok xz 5.8.1 (floor 5.8)`, `ok ca-certificates 150 certificates`) -- including
the `TARGETARCH` check that fails when a builder silently produces a
host-architecture image. It was exported with `--output type=oci` and never
loaded into the image store, so the amd64 family other work on this host stands
on was not disturbed.

### The shipped path, end to end

The green run above proves the mechanism. This proves the code that ships it.
`os/build-env/from.sh --contexts=` against the family the store actually holds:

```console
$ bash os/build-env/from.sh --arch=amd64 --contexts=<dir> LOCAL_MOS_BUILD_BASE
--build-context
localhost/mos-build-base=oci-layout://<dir>/mos-build-base
```

and those two lines fed to `docker buildx build --builder mos-arm64 --platform
linux/amd64` over the same throwaway Dockerfile:

```text
#4 [context localhost/mos-build-base] OCI load from client
#5 [1/2] RUN uname -m
#5 1.193 x86_64
```

### Why an OCI layout and not a local registry

PLAN-025 names both. The registry shape -- push `localhost:<port>/mos-build-*`
into a `registry:2` the builder can reach -- was not taken, on measured
grounds rather than taste. Asked about the builder this tree creates:

```console
$ docker inspect buildx_buildkit_mos-arm640 --format 'NetworkMode={{.HostConfig.NetworkMode}} IP={{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}'
NetworkMode=bridge IP=172.17.0.2
$ docker exec buildx_buildkit_mos-arm640 cat /etc/buildkit/buildkitd.toml
cat: can't open '/etc/buildkit/buildkitd.toml': No such file or directory
```

So `localhost:<port>` inside that builder is its own loopback and not the
host's, and it carries no configuration that would let it talk http to an
insecure registry. Both are fixed at CREATION time -- `--driver-opt
network=host` and a `--buildkitd-config` file -- and neither of the two
`docker buildx create` call sites in this tree passes either --
`docker buildx create --name mos-arm64 --driver docker-container`
(`os/tests/quadlet-doc-test.sh:83-85`) and
`docker buildx create --name "mos-${PLATFORM_ARCH}" --driver docker-container`
(`os/build-env/build.sh:361`). A registry
would therefore have to change every place a builder is made, and would leave a
long-lived container holding image state that `os/build-env/images.env` exists
to keep in the tree. An OCI layout needs no daemon, no port, no builder option
and no second copy of the naming.

The layout is written to a `mktemp -d` and removed on exit, not kept in the
tree: it is a copy of what the image store already holds, and a copy that
outlived the build would be a second source of truth about which
`mos-build-base` is current.

`docker image save` is what produces it, and the format is the daemon's choice
rather than the command's promise -- measured here on docker 29.7.2 with the
containerd image store, it writes `oci-layout`, `index.json` and `blobs/`. That
is checked after every export rather than assumed, because a daemon that wrote
the older docker-archive format instead would surface as an unreadable build
context rather than as the daemon configuration it is.

## 4. Why podman too

The task allowed leaving `os/pkgs/podman/build.sh` alone if measured not to be
on the cx3576 image path. It is on it:
`PODMAN_OUT="$REPO_ROOT/os/pkgs/podman/out-$MOS_ARCH"`
(`os/rootfs/build-v2.sh:223`) stages
`os/pkgs/podman/out-$MOS_ARCH` into the root the image is packed from, and that
directory is produced by `os/pkgs/podman/build.sh` and by nothing else. It
carried the identical pin and the identical refusal, and it now carries the
identical selection.

One thing measured about it is a consequence for the follow-on task rather than
for this one. Its source stage opens
`FROM --platform=$BUILDPLATFORM ${MOS_BUILD_BASE} AS src`
(`os/pkgs/podman/Dockerfile:74`), so a cross build wants that base at TWO
architectures: the build platform's for the source fetch, the
target's for the compiles. A `localhost/` tag carries exactly one. Handed a
single-architecture layout, buildx does not refuse the mismatch -- it serves
what the layout holds and the stage dies inside:

```text
#7 [src 1/2] RUN uname -m
#7 0.122 exec /bin/sh: exec format error
#7 ERROR: process "/bin/sh -c uname -m" did not complete successfully: exit code: 255
```

That is measured with an arm64 layout on this amd64 host, against a two-stage
probe shaped like the real one. It is not a defect this task introduced -- the
same tag holds the same one architecture under the docker driver -- but a
cross-architecture `make podman` will meet it the moment an arm64 family
exists, and whoever owns that should expect it.

## 5. The wall: no arm64 mos-build family, and none producible here

**Dated note (RFCT-234, 2026-08-28): the second half of that heading is wrong,
and the family has since been produced on this host.** Everything below is the
2026-08-28 record of what ran in THIS task and stays as it was written; the
measurements in it were not wrong, the conclusion drawn from one of them was.

What that conclusion rested on is the sentence further down: *"`os/build-env/build.sh` verifies every image it produces by reading the record
back out of the built image with `docker run --platform "${MOS_BUILD_PLATFORM}"`"*.
That is true of the line as it stood, and the `exec format error` above is what
it did here. What does not follow is that the STEP needs host binfmt: it needs
the FILE, and reading a file out of an image executes nothing. Measured on this
same host, same day, on one arm64 image:

```console
$ docker run --rm --platform linux/arm64 localhost/probe-arm64:syk8eqzw uname -m
exec /bin/uname: exec format error
$ cid="$(docker create --platform linux/arm64 localhost/probe-arm64:syk8eqzw /bin/sh)"
$ docker cp "$cid:/arch.txt" - | tar -xO
aarch64
```

`/proc/sys/fs/binfmt_misc/` was empty for both. So the blocker was a mechanism
choice in this repository, not a missing host capability. RFCT-234 changed that
readback to a create-and-copy pair --
`cid="$(docker create --platform "${MOS_BUILD_PLATFORM}" "${TAG}" /bin/sh)"`
(`os/build-env/build.sh:549`) and
`docker cp "${cid}:/etc/mos-build/${name}.env" "${envfile}" 2>"${cp_err}" || cp_rc=$?`
(`os/build-env/build.sh:554`) -- fed the `localhost/` rows the OCI layouts this
task's `--contexts` mode produces --
`mapfile -t CTX_ARGS < <(bash "${HERE}/from.sh" --arch="${PLATFORM_ARCH}" \`
(`os/build-env/build.sh:488`) -- and
`MOS_BUILD_PLATFORM=linux/arm64 make build-env` then built all four images --
`MOS_BUILD_ARCH=arm64` read back out of each of them on this host.
`MOS_BOARD=cx3576 make os-rauc` followed it to `rauc v1.13 for arm64: 470008
bytes, 7 shared libraries`.

Of the three items pre-declared at the end of this section, item 1's premise
(*"On a host with arm64 in `/proc/sys/fs/binfmt_misc/`"*) turned out not to be
needed and its body is done; item 2 was right, and RFCT-234 measured what it
costs `make podman`; item 3's first half is done and its hardware half is not.
docs/task/RFCT-234.md carries all of it.

`MOS_BOARD=cx3576 bash os/pkgs/rauc/build.sh` no longer stops at the builder
refusal. It stops later, for a different and named reason:

```text
error: LOCAL_MOS_BUILD_BASE=localhost/mos-build-base is a amd64 image and this build targets arm64. A local tag carries exactly one architecture -- unlike the IMAGE_ digests above it, which are multi-architecture indexes -- so `make build-env` has to have produced a arm64 family: MOS_BUILD_PLATFORM=linux/arm64 make build-env. os/build-env/build.sh refuses that today when it is not the host's architecture, and RFCT-108's M2b note records what closing it needs (each image published as content with --output type=oci, consumed as --build-context oci-layout://)
error: LOCAL_MOS_BUILD_C=localhost/mos-build-c is a amd64 image and this build targets arm64. [...]
error: os/build-env/from.sh did not yield the two builder images (see its message above); this build would have run with an unpinned or missing FROM
```

It did not reach a compile stage, and it cannot on this host. The remedy that
message names -- `MOS_BUILD_PLATFORM=linux/arm64 make build-env` -- has its own
wall, and it is not the one this task removed:

```console
$ docker run --rm --platform linux/arm64 debian:trixie-slim@sha256:d7e12182ce18b85b93007c1dedf31f2d29e01ccf3182cc4017c709b6259bc132 uname -m
exec /usr/bin/uname: exec format error
$ ls /proc/sys/fs/binfmt_misc/
$
```

`os/build-env/build.sh` verifies every image it produces by reading the record
back out of the built image with `docker run --platform "${MOS_BUILD_PLATFORM}"`
-- the daemon, not a builder -- and that call is exactly the one above. It is
not the localhost-tag problem, so the mechanism this task added does not touch
it. A host that CAN cross-build the builder family must have arm64 registered
in `/proc/sys/fs/binfmt_misc/`; RFCT-206 section 7 records that the documented
remedy (`tonistiigi/binfmt --install arm64`) reports success here and leaves
that directory empty, and it is still empty.

That is why `os/build-env/build.sh` was left untouched. Its cross-build refusal
sits under a note that already names this mechanism --
`and passing it to its children as`
(line 351 of `os/build-env/build.sh` as it stood at 08a5bae; RFCT-234 rewrote
that comment when it wired the rows, so the line anchor is gone and the quote is
kept as the record of what was read here) -- and is now over-stated as to its
REASON: the
localhost rows could be fed the way rauc and podman are fed. But rewiring it
here would ship code no run on this host can exercise: the `base` row's readback fails before the first `localhost/` row is
ever reached, so the wiring for `c`, `go` and `rust` would go in unmeasured.
Every claim in these two files is something that was run, and that one could
not be.

**Pre-declared for whoever owns the arm64 family**, so the gap is a stated
obligation rather than a silence:

1. On a host with arm64 in `/proc/sys/fs/binfmt_misc/`,
   `MOS_BUILD_PLATFORM=linux/arm64 make build-env` still refuses at
   `os/build-env/build.sh`'s localhost rows. Feeding those rows the parent's
   OCI layout, the way `os/pkgs/rauc/build.sh` is now fed, is the change; the
   mechanism is `os/build-env/from.sh --contexts=`.
2. `localhost/mos-build-*` is one tag per image, not one per architecture, so
   an arm64 family REPLACES the amd64 one in the store. Section 4's
   `$BUILDPLATFORM` measurement is what that costs `make podman`.
3. Only then does `MOS_BOARD=cx3576 make os-rauc` reach a compile stage, and
   only then is RFCT-206 section 7's hardware pass startable.

## 6. The citation this moved

`docs/task/RFCT-206.md` quoted the refusal this task rewrote and anchored the
quote at line 73 of `os/pkgs/podman/build.sh`. The quoted words no longer exist in that
file at any line, so there was nothing to re-anchor to. The quote is a record of
what ran on this host in that task and stays exactly as written; what was
dropped is the line anchor, replaced by the file and the commit the record was
made against. `bash docs/verify-citations.sh` went from one content failure back
to green on that change alone.

## 7. Verification

| command | result |
| --- | --- |
| the requirement-2 probe, before | `dial tcp [::1]:80: connect: connection refused` -- red, section 3 |
| the requirement-2 probe, after | `#5 0.560 aarch64` -- green, section 3 |
| `MOS_BOARD=cx3576 bash os/pkgs/rauc/build.sh` | past the builder refusal; stops at `os/build-env/from.sh`'s architecture check, section 5 |
| `MOS_BOARD=x64 bash os/pkgs/rauc/build.sh` | `rauc v1.13 for amd64: 453872 bytes, 7 shared libraries` -- the native path built end to end, unchanged |
| `BUILDX_BUILDER=default MOS_BOARD=cx3576 bash os/pkgs/rauc/build.sh` | the section 2 refusal, by name |
| `make os-shell-pipefail-lint` | `RESULT: PASS (31/31 files clean, 31 scanned)` |
| `bash docs/verify-citations.sh` | `1385/1385 PASS` |
| `bash docs/verify-index.sh` | `752/752 PASS` |

The native build is in that table deliberately. Every other row is about a path
that could not run before this change; that one is about the path that could,
and a builder selection rewritten under it is exactly the kind of change that
breaks what already worked. It did not: the amd64 rauc still compiles and
exports, with `CTX_ARGS` empty and the `default` builder resolving the
`localhost/mos-build-*` tags out of the image store as it always did.

The citation total moves from the 1379 this branch started at to 1385: section 6
removed one `path:line` token and this record adds seven, each one armed with a
quote that is the cited line's own text, so its row in
`docs/verify-citations-unquoted-baseline.txt` stays absent and its ceiling stays
zero.

## 8. Out of scope, and untouched

- The cx3576 image end to end, and the RFCT-206 section 7 hardware pass. A
  follow-on owns both, and section 5 states what has to exist first.
- `os/rootfs/build-v2.sh`'s own builder logic. It is the file this change took
  its register from; it was read and not edited.
- `os/build-env/build.sh`, for the reason section 5 gives. **Dated note
  (RFCT-234, 2026-08-28):** that reason did not hold, and RFCT-234 edited this
  file; section 5's note says what it changed.
- `os/build-env/images.env`. No pin moved, and no key was added: the
  `--contexts` mode resolves the same `LOCAL_` keys the pair form already did.
