# Design: the build and check harness — how this repository's checks are run

This page is for someone about to run something. Most checks in this tree run in
a container that the command line does not mention — the docs gates in section 7
are the exception — and the facts that make the difference between a green run
and a confusing red one have until now lived in task records and in operators'
heads. They are collected here so that the next tool does not rediscover them by
failing first.

**A claim marked *measured* is an observation of THIS host** on the date given.
No gate can check it, it can go stale under you, and it is dated for that
reason. The host measurements below were taken on **2026-08-28** unless another
date is given.

## 1. bun runs in a pinned container, and that is a decision

Both bun suites resolve their runtime the same way, from the digest pinned as
`IMAGE_BUN_1` in `build-env/images.env`. `verify` reads it as
`BUN_IMAGE="$(bash "${REPO_ROOT}/build-env/from.sh" --ref IMAGE_BUN_1)" || exit 1`
(`verify/run.sh`), and `pkgs/mosd/tests/apid-api/run.sh` the same:

    bash build-env/from.sh --ref IMAGE_BUN_1

`pkgs/mosd/tests/apid-api/run.sh` does exactly that, with an override for a caller who
means it —
`BUN_IMAGE="${MOS_APID_BUN_IMAGE:-$(bash "${REPO_ROOT}/build-env/from.sh" --ref IMAGE_BUN_1)}"`
(`pkgs/mosd/tests/apid-api/run.sh`). The pin is a digest and not the `oven/bun:1` tag
because that tag is repointed upstream on every 1.x release, and this harness is
what decides whether apid's API is judged conformant.

`verify/run.sh` holds the one seam where host-or-container is decided:
"The seam. Everything above and below passes an argv and reads a status,"
(`verify/run.sh`). Above it the route is chosen once —
`WHY="MOS_VERIFY_CONTAINER=1"` (`verify/run.sh`) — and the
environment variable is documented as
"MOS_VERIFY_CONTAINER=1 use the pinned container even where a host bun exists,"
(`verify/run.sh`). That is the knob to reach for when you want to compare
the two routes on one machine.

**The container is a pin, not a workaround.** *Measured 2026-08-28:* this host
does have a usable bun and it works.

| what | command | result |
| --- | --- | --- |
| a host bun exists | `command -v bun; bun --version` | `/srv/bkd/runtime/bun`, `1.4.0` |
| it parses the committed lockfile | `cd pkgs/mosd/tests/apid-api && bun install --frozen-lockfile --dry-run` | all five packages resolved, `[2.00ms] done` |
| it runs the suite's selftest green | `cd pkgs/mosd/tests/apid-api && bun run src/selftest.ts` | `RESULT: PASS (47/47 checks)` |

So a host route is *possible* here and is nevertheless not taken. The reason is
recorded where the decision was made: `run.sh` has
"no host-bun route for any of its other bun invocations"
— the suite and the `/healthz` probe both run in the pinned image — so a host
route for one caller of three would be
"a second route for one of three callers, and configurability"
nobody asked for. Read a green run announcing the
container as the pin doing its job, not as a fallback.

## 2. The pinned bun image carries no docker client

`IMAGE_BUN_1` is bun and nothing else, so any route that drives docker from
inside it dies with a message about docker rather than about what you were
doing:
"docker client, so inside it every route ends at `docker: command not found`."
(`verify/Dockerfile`), and the pin's own block says the same —
"this every route inside it ends at `docker: command not found`. Mounting the"
(`build-env/images.env`) daemon socket does not help, because what is
missing is the client, not the socket.

`verify/Dockerfile` exists solely to close that gap, and it is the file to
reuse rather than a second one to write. It is two digest `FROM`s and one copy —
`COPY --from=cli /usr/local/bin/docker /usr/local/bin/docker`
(`verify/Dockerfile`) — with the result asserted at build time by
`RUN docker --version && bun --version` (`verify/Dockerfile`), so a COPY
whose source moved upstream fails at build rather than three steps later inside a
verify run. The client half is pinned as `IMAGE_DOCKER_CLI_28`, chosen because
the "`-cli` variant carries the client and NOT dockerd. The client is a static"
(`build-env/images.env`) binary, which is what lets an alpine-built
client run on the debian-based bun image.

Both `verify/run.sh` and `pkgs/mosd/tests/apid-api/run.sh` build that image on demand and
tag it with both input digests, so bumping either pin names an image that was
never built and there is no stale parent to find. Nothing in `make build-env`
builds it; whichever of the two runs first pays the few seconds for it.

## 3. The Rust gate: `pkgs/mosd/hack/check.sh`

The gate requires the ignored built-in UI tree before Rust: when
`MOS_APID_UI_DIST_DIR` is absent it runs `apid/ui/build.sh` and exports that
absolute path itself. When the gate is run inside the Rust-only container,
build the tree on the host first and pass
`MOS_APID_UI_DIST_DIR=/src/pkgs/mosd/apid/ui/dist`; the script then consumes it
without looking for Bun or Docker in that container. It next runs five
unremarkable Rust commands — `cargo fmt --all --check` (`pkgs/mosd/hack/check.sh`),
`cargo clippy --workspace --all-targets --locked -- -D warnings`
(`pkgs/mosd/hack/check.sh`) and
`cargo nextest run --workspace --locked` (`pkgs/mosd/hack/check.sh`) among
them. **Run it unmodified.** The harness is the container it runs in, not an
edit to the script; every trap below is fixed by how you invoke the container.

It runs in `localhost/mos-build-rust` with `/srv/mos-rust-tools` mounted at
`/tools`. *Measured 2026-08-28,* four facts that each cost a failed run to learn.

**The image ships cargo and rustc and nothing else.** `/opt/rust/bin` holds
`cargo`, `rustc`, `rustdoc` and the gdb/lldb wrappers; `/usr/local/cargo/bin` is
empty. `cargo-nextest`, `cargo-clippy`, `clippy-driver`, `cargo-fmt`, `rustfmt`
and `cargo-deny` all come from `/tools/bin`. So `/tools/bin` must be **first**
and the PATH must be spelled out in full:

    PATH=/tools/bin:/opt/rust/bin:/usr/local/cargo/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
    LD_LIBRARY_PATH=/opt/rust/lib

Measured: `command -v cargo-nextest` inside the image with no `/tools` on PATH
prints nothing; `cargo --version` prints `cargo 1.98.0 (797e8a9bc 2026-08-05)`.

**Never `bash -lc` inside this container.** `-l` sources `/etc/profile`, which
overwrites the PATH you passed with `docker -e PATH`, and then cargo and every
`/tools` binary vanish at once. The failure looks exactly like a broken `/tools`
mount, which sends you to debug the wrong thing. Measured, same container, same
`-e PATH`:

| invocation | `$PATH` inside |
| --- | --- |
| `bash -lc 'echo $PATH'` | `/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin` |
| `bash -c 'echo $PATH'` | `/tools/bin:/opt/rust/bin:/usr/local/cargo/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin` |

Under `-lc`, `command -v cargo` prints nothing at all. Use `bash -c`, or export
PATH inside the `-c` string.

**`/srv/mos-rust-tools` carries two toolchains; take `bin/`, never `rust96/`.**
Measured versions: `/opt/rust/bin/rustc --version` reports
`rustc 1.98.0 (88d9e12ae 2026-08-18)` and `/tools/bin/rustfmt --version` reports
`rustfmt 1.9.0-stable (88d9e12ae1 2026-08-18)` — the same build, matching the
image's cargo. The `rust96` tree is a different one:
`/tools/rust96/bin/rustc --version` reports `rustc 1.96.0 (ac68faa20 2026-05-25)`,
and its `bin/` holds only `cargo-fmt`, `rustfmt`, `rustc` and `rustdoc` — no
clippy, no nextest, no deny, so it cannot run this gate at all.

Putting it first on PATH does not merely fail to help; it reports damage that is
not there. Measured with `/tools/rust96/bin` ahead of `/tools/bin`, running the
gate's own clippy line against this workspace unchanged:

    error[E0463]: can't find crate for `std`
    error[E0463]: can't find crate for `core`
    error: could not compile `serde` (build script) due to 1 previous error
    error: could not compile `libc` (build script) due to 1 previous error
    rc=101

The 1.96 `rustc` shadows the image's 1.98 one and brings a sysroot that has no
`std` for the target, and the cascade reads as though the workspace's
dependencies are broken. They are not: with `/tools/bin` first,
`cargo fmt --all --check` on the same tree, same commit, is clean.

**The image has no `dbus-daemon`, and mosd's tests need one.** `command -v
dbus-daemon` in the image prints nothing. Several tests assert real bus
behaviour over a private session bus and are written to fail rather than skip
without it: "real bus behaviour over a private session bus and MUST NOT skip: install it"
(`pkgs/mosd/apid/tests/e2e.rs`), and the identical refusal is repeated in
"dbus-daemon was not found at /usr/bin/dbus-daemon or on PATH. This test asserts"
(`pkgs/mosd/mosd/tests/scan.rs`). Measured without it, the gate exits
**`rc=100`** (the panic location below is normalized because source-line
positions are not part of the contract):

    thread 'web_flow_end_to_end' panicked in apid/tests/e2e.rs:
    dbus-daemon was not found at /usr/bin/dbus-daemon or on PATH. [...]
    Summary [   5.853s] 57/705 tests run: 56 passed, 1 failed, 0 skipped
    warning: 648/705 tests were not run due to test failure
    error: test run failed
    rc=100

**Which** test surfaces it first is scheduling, not signal: `bus_roundtrip`
(`pkgs/mosd/mosd/tests/bus.rs`) carries the same requirement, and nextest
cancels the remaining 648 at the first failure. Read `rc=100` together with a
`dbus-daemon was not found` panic as one fact, whatever the test name is.
`apt-get install -y dbus` in the container before the gate is what makes it
green; section 8 records both runs.

## 4. Scratch: `tmp/`, and why never `/tmp`

`tmp/` at the repository root is the scratch root, and it is gitignored.
Container scratch belongs under `<repo>/tmp/<issue-id>/` — never the system
`/tmp`, and never the `/srv` top level.

**It is `tmp/` and not `runtime/`.** The earlier name collided twice: a genuine
`runtime/` directory in this repository would have been silently ignored, and
the measurements in this very page quote unrelated paths like
`/srv/bkd/runtime/bun`. A reader had to know which `runtime` was meant.

The reason for avoiding the system `/tmp` is measurable rather than stylistic,
and the failure is silent. *Measured 2026-08-28:*

    $ T=$(mktemp -d); echo sentinel > "$T/marker.txt"; ls "$T"
    marker.txt
    $ docker run --rm -v "$T:/probe" alpine:3.21 sh -c 'ls -A /probe | wc -l'
    0
    $ docker run --rm -v "$PWD/tmp/<id>:/probe" alpine:3.21 cat /probe/marker.txt
    sentinel

The mount **succeeds**. The container starts, the directory is there, and it is
bare. Nothing reports an error, so the run fails later saying a file was not
found — and the file is there; it is the mount that is empty. `verify/run.sh`
carries a preflight against exactly this, whose message is worth reading before
you debug anything else:
"The mount succeeded and delivered nothing, which is how a bind mount of /tmp"
(`verify/run.sh`).

## 5. arm64 on this host: build yes, execute no

Three separate capabilities get confused with one another here, and they answer
differently. *Measured 2026-08-28.*

**Do not settle an arm64 question by inspecting.** `docker buildx ls` and
`docker buildx inspect` **under-report** on this host. For the `mos-arm64`
builder, which demonstrably does execute arm64, they print:

    NAME/NODE      DRIVER/ENDPOINT                 STATUS   BUILDKIT  PLATFORMS
    mos-arm64      docker-container
     \_ mos-arm640  \_ unix:///var/run/docker.sock  running  v0.32.2   linux/amd64 (+3), linux/386

    $ docker buildx inspect mos-arm64
    Platforms:     linux/amd64, linux/amd64/v2, linux/amd64/v3, linux/386

No arm64 in either. Settle it with a throwaway build instead.

**buildx on `mos-arm64` does execute arm64.** A two-line Dockerfile,
`FROM alpine:3.21` and `RUN uname -m`, built with
`docker buildx build --builder mos-arm64 --platform linux/arm64 --no-cache --progress=plain`:

    #5 [2/2] RUN uname -m > /arch.txt && cat /arch.txt
    #5 0.244 aarch64
    #5 DONE 11.3s

**buildx on `mos-arm64` chains stages through OCI layouts.** *Measured
2026-08-30.* Two throwaway stages, the second `FROM ${MOS_STAGE_PREV}`, built
`--platform linux/arm64` on `mos-arm64` with the first exported
`--output type=oci,dest=<dir>,tar=false,name=mos-probe:a` and handed to the
second as `--build-context mos-probe:a=oci-layout://<dir>`: the second stage
read the first's file and wrote `stage-b sees: aarch64 on aarch64`. That is
the mechanism `build/src/stages-cli.ts` calls layout mode, and it is why
the cx3576 rootfs chain no longer needs the daemon to execute arm64.

**The daemon does not.** The same image, run rather than built:

    $ docker run --rm --platform linux/arm64 mos-arm64-probe uname -m
    exec /bin/uname: exec format error

**Run an amd64 control before believing any of this.** On a loaded host the
container-create call times out instead of refusing, and `docker run --platform
linux/arm64` then returns `context canceled` — which reads like an arm64 verdict
and is not one. It was measured here at a load average of 30 on 8 cores, and the
plain `docker run --rm alpine:3.21 uname -m` control returned `context canceled`
in the same state. Once the daemon recovered the control printed `x86_64` and the
arm64 run printed the `exec format error` above. A capability claim about arm64
is only worth as much as the amd64 control run beside it.

`/proc/sys/fs/binfmt_misc/` is empty here — `ls -A` prints nothing. The
documented remedy, `docker run --privileged --rm tonistiigi/binfmt --install
arm64`, does not close it. That is the one claim here taken from a record rather
than re-run: it was measured reporting success and leaves the directory
unchanged, so
"the registration does not stick in this container's"
namespace. The inspection trap comes in the same breath, a throwaway build having
"printed `aarch64`" where `docker buildx ls`
under-reported it as amd64/386 only.

**The consequence worth carrying.** Reading a **file** out of an arm64 image
needs no emulator; **executing** one does. Measured against the same probe
image:

    $ cid=$(docker create --platform linux/arm64 mos-arm64-probe)
    $ docker cp "$cid:/arch.txt" ./arch.txt && cat ./arch.txt
    aarch64

So an inspection task that only has to read bytes out of an arm64 artifact is
not blocked here, while anything that has to run one is.

### 5.1 A single-architecture tag does not refuse `--platform`; it misresolves

*Measured 2026-08-28, appended to the above rather than replacing
any of it.*

The capability question above has a companion that reads like it and is not
it: what happens when the emulator IS available and the BASE is the wrong
architecture. The answer is the reason `pkgs/podman/Dockerfile` carries two
base arguments for one image.

`--platform` on a `FROM` selects a manifest out of an index. A digest-pinned
upstream reference is an index, so `--platform=$BUILDPLATFORM` picks the right
one; a `localhost/mos-build-*` tag is one manifest and no index, so there is
nothing to select and docker serves what the tag holds. Buildkit still
believes the stage is running at the platform the `FROM` named, applies no
emulator, and the stage dies on its first `RUN`. Both driver paths, a
`linux/arm64` build whose `src` stage was given the arm64 base under
`--platform=$BUILDPLATFORM`:

    # docker driver, tag resolved out of the image store
    #4 resolve localhost/mos-build-base:arm64@sha256:b1f5a46d... 0.0s done
    #5 0.444 exec /bin/sh: exec format error

    # mos-arm64 docker-container driver, base handed over as an OCI layout
    #6 [context localhost/mos-build-base:arm64] OCI load from client
    #6 resolve localhost/mos-build-base:arm64@sha256:b1f5a46d... 0.0s done
    #7 0.573 exec /bin/sh: exec format error

Neither report names the base, the architecture or the argument, and both are
the same `exec format error` that a MISSING emulator produces — which is what
makes this worth writing down. `docker buildx build --platform` refusing a
mismatch is the behaviour to expect and not the behaviour to get.

The remedy is a second argument, not a second `--platform`: a stage that runs
at the build platform takes a base resolved at the build platform's
architecture. `pkgs/podman/build.sh` does this with `MOS_BUILD_BASE_NATIVE`,
resolved through a second `build-env/from.sh` call with `--arch` from
`uname -m`, and carried to a container-driver builder as a fifth OCI layout
next to the four. Proved before it was written, with a two-stage throwaway
whose `src` stood on the amd64 base and whose `verify` stood on the arm64 one,
built `--platform linux/arm64` on `mos-arm64`:

    #9 0.809 SRCARCH=x86_64 VERIFYARCH=aarch64

One build, two architectures, one builder.

## 6. The image is an input, and "no image" reads as a harness failure

`pkgs/mosd/tests/apid-api/run.sh` **builds nothing**. When `_out/x64/` or the image inside
it is absent it refuses by name and prints the two commands that make it:
"image ${IMG##*/} is missing; this harness builds nothing. Build it: MOS_BOARD=x64 bash rootfs/build.sh && bash build/run.sh --mkimage-x64"
(`pkgs/mosd/tests/apid-api/run.sh`). The same sentence guards the missing directory one
step earlier:
"does not exist, so there is no image to boot; this harness builds nothing."
(`pkgs/mosd/tests/apid-api/run.sh`).

Those two commands are the last two links of a longer chain, and the earlier
links fail the same way — as an apparently broken harness. In order:

1. **The components.** `bash pkgs/rauc/build.sh` and
   `bash pkgs/podman/build.sh` produce `pkgs/rauc/out-<arch>/` and
   `pkgs/podman/out-<arch>/`. Nothing in the rootfs build reads either
   directory: the `rauc` and `podman` producers do, from their `PREPARE` hooks,
   and pack the result as `mos-rauc` and `mos-podman`.
2. **The package pool.** `make os-debs` builds every producer at every
   architecture it declares and then indexes both pools. The rootfs build
   installs out of `_out/debs/<arch>/` and compiles nothing, so this step is
   where a missing or stale component becomes a refusal that names a target.
3. **The rootfs.** `MOS_BOARD=x64 bash rootfs/build.sh`, which refuses a
   pool that is absent, unindexed, or stamped at a version other than this
   tree's.
4. **The image.** `bash build/run.sh --mkimage-x64`, which writes the A/B disk
   image around the rootfs slot. Its name is read from the board definition,
   `IMAGE_LATEST_NAME=x64-mos-latest.img` (`boards/x64/board.env`),
   rather than repeated in the harness.
5. **The run.** `make os-apid-api-test`, or `bash pkgs/mosd/tests/apid-api/run.sh`.
   `bash pkgs/mosd/tests/apid-api/run.sh --dry-run` does the preconditions and the network
   discovery and boots nothing, which is how to check the harness in seconds.

**This suite runs nowhere in CI, and that is the standing decision rather than
an oversight.** It boots an x64 image under QEMU, so putting it on push would
lengthen the feedback loop for a suite that is run deliberately, against an
image the harness does not build. What CI does check is narrower and cheap:
`make os-apid-api-spec-pins` asserts that the suite's expectations still agree
with the committed OpenAPI document. Run the suite itself by hand after a
change to apid's surface.

The boot engine itself is `pkgs/mosd/tests/apid-api/src/qemu.ts`, beside the suite that
drives it. It was a shell tool under `tools/` until later ported it; that
file is gone, and a search for it is a search for something deleted.

## 7. The docs gate

One script, read-only, needing nothing but bash and coreutils.

`bash docs/verify-index.sh` asserts that `docs/design/*.md` and
`docs/README.md` agree **in both directions** — it is written to catch a
rename, because a forward-only check passes happily on an index full of
entries pointing at files that no longer exist. So a new design page needs its
row in `docs/README.md` in the same commit.

**`docs/plan/` and `docs/task/` are not gated, deliberately.** They are PMA
process tracking rather than product, and a record is deleted when it closes,
so the set an index check would assert is empty or nearly so — and a check over
an empty set reports green without having checked anything. If a second shipped
directory appears, `check_readme_dir` already takes the directory as an
argument and one call adds it.

**There is no citation gate, deliberately.** `docs/verify-citations.sh` and its
three baselines were removed with the coupling they existed to police:
documents no longer cite code by `path:line`, so there is no citation to keep
resolvable. Where a document needs a precise contract it names the artifact
that carries it — the HTTP surface is `pkgs/mosd/apid/openapi.json`, which
CI holds equal to what the shipped binary prints.

## 8. Verification

Everything below was run on this host on 2026-08-28, in this worktree. The Rust
gate ran in `localhost/mos-build-rust` with `/srv/mos-rust-tools` mounted at
`/tools`, invoked with `bash -c` and the full PATH of section 3.

| command | final line |
| --- | --- |
| `bash docs/verify-index.sh` | `docs/verify-index.sh: 767/767 PASS` |
| `bash hack/check.sh` in `pkgs/mosd`, dbus installed | `705 tests run: 705 passed, 0 skipped`, `advisories ok, bans ok, licenses ok`, `ALL CHECKS PASSED` |
| the same nextest line with **no** `dbus-daemon` | `57/705 tests run: 56 passed, 1 failed, 0 skipped`, `error: test run failed`, `rc=100` |
| `cargo fmt --all --check`, `/tools/bin` first | clean |
| the gate's clippy line, `/tools/rust96/bin` first | `error[E0463]: can't find crate for 'std'`, `rc=101` |

The full table — every command in this page with its output, including the two
deliberately-red runs above and the bun, scratch and arm64 measurements — was
recorded when these facts were measured and is in the repository history.
