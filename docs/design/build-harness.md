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

**The rule these containers exist to keep is [`build.md`](build.md) §0** — no
toolchain on the host, no compilation on the host, no assembly on the host —
with the test for deciding which side a new tool is on, the exemptions that are
still open, and `make os-host-toolchain-lint`, which fails when a new one
appears. The Rust gate in §3 runs in the dedicated pinned
`localhost/mos-build-rust-check` container through `tests/rust-gate.sh`.

## 1. bun runs in a pinned container, and that is a decision

Every bun entry resolves its runtime from the digest pinned as `IMAGE_BUN_1` in
`build-env/images.env`. `verify` reads it as
`BUN_IMAGE="$(bash "${REPO_ROOT}/build-env/from.sh" --ref IMAGE_BUN_1)" || exit 1`
(`verify/run.sh`), `pkgs/mosd/tests/apid-api/run.sh` does the same, and the
built-in UI production entry resolves that pin directly before mounting its
source read-only:

    bash build-env/from.sh --ref IMAGE_BUN_1

`pkgs/mosd/tests/apid-api/run.sh` does exactly that, with an override for a caller who
means it —
`BUN_IMAGE="${MOS_APID_BUN_IMAGE:-$(bash "${REPO_ROOT}/build-env/from.sh" --ref IMAGE_BUN_1)}"`
(`pkgs/mosd/tests/apid-api/run.sh`). The pin is a digest and not the `oven/bun:1` tag
because that tag is repointed upstream on every 1.x release, and this harness is
what decides whether apid's API and built-in UI are judged conformant. Unlike
the QEMU suites, `pkgs/mosd/apid/ui/build.sh` has no host-runtime or image
override route.

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

## 3. The Rust gate: `pkgs/mosd/hack/check.sh` and `pkgs/rauc-sign/hack/check.sh`

Two scripts, one per Rust workspace, five commands each and the same five in the
same order: `cargo fmt --all --check`, `cargo clippy --workspace --all-targets
--locked -- -D warnings`, `cargo nextest run --workspace --locked`, `cargo test
--doc --workspace --locked` and `cargo deny check licenses bans advisories`.
**Run them unmodified.** The harness is the container they run in, not an edit to
the script.

There are two because `pkgs/rauc-sign` is its own `[workspace]`: since that
split, `cargo clippy --workspace` run from `pkgs/mosd` has not reached that
crate at all, and the twin exists so the omission is a file somebody can see
rather than a gap nobody can.

    make os-rust-gate              both workspaces
    bash tests/rust-gate.sh mosd   one

That is the whole of how to invoke it. Everything this section used to say about
PATH ordering, a `/tools` mount and which of two toolchains to put first
described an arrangement that no longer exists; what replaced it is below.

### 3.1 It runs in `localhost/mos-build-rust-check`, and why that image exists

`mos-build-rust` ships `cargo` and `rustc` and nothing else — no clippy, no
rustfmt, no nextest, no cargo-deny — and that is deliberate rather than an
oversight: it is the `FROM` of every Rust deb producer, so anything installed
there is downloaded on every build. `build-env/rust-check/Dockerfile` is
`FROM` it and adds the four tools plus `dbus-daemon`, and nothing pulls that
image except this gate. *Measured 2026-09-04:* 1.83 GB for `mos-build-rust`,
1.92 GB for `mos-build-rust-check` — 90 MB, paid by one target.

clippy and rustfmt cost **no new pin**. They are in the same
`rust-${RUST_VERSION}` tarball `RUST_SHA256_<arch>` already names, so the
derived image re-fetches those recorded bytes through the same download cache
and asks `install.sh` for two more component names. *Measured 2026-09-04:* on a
host that had just built `mos-build-rust`, that stage logged `using the cached
/var/cache/mos-fetch/rust-1.98.0-x86_64-unknown-linux-gnu.tar.xz, which already
matches the recorded hash` — same bytes, no second download. Do not go looking
for a `CLIPPY_SHA256`; there is none, and there should not be.

`cargo-nextest` and `cargo-deny` are in no Rust tarball and are pinned in full,
`RUSTCHECK_NEXTEST_*` and `RUSTCHECK_DENY_*` in `build-env/images.env`, URL and
sha256 per architecture, with the same PENDING bump flow every other pin has.
The prefix is `RUSTCHECK_` and not `RUST_CHECK_` because the lock filter is
`RUST_[A-Za-z0-9_]*`: the second spelling would put the gate's pins into the
cache key of the image every Rust build pulls.

The image asserts what it holds and records it at `/etc/mos-build/rust-check.env`,
which `tests/rust-gate.sh` prints at the top of every run, so a gate log answers
"which clippy said that" without anyone having to know which image was current:

    MOS_BUILD_RUSTC=1.98.0
    MOS_BUILD_CLIPPY=1.98.0
    MOS_BUILD_NEXTEST=0.9.143
    MOS_BUILD_DENY=0.19.9
    MOS_BUILD_DBUS=1.16.2

**Why an image and not a directory.** Until 2026-08-29 the four tools came from
`/srv/mos-rust-tools`, a host directory bind-mounted at `/tools`, referenced by
no Makefile target and no script — `grep -rn 'mos-rust-tools'` over the tree
matches nothing at all. That directory was emptied, and **nothing failed**.

Read that precisely, because the useful version is narrower than "nobody ran the
gate". CI kept running both scripts on every push (section 3.5), so the
workspace stayed checked. What was lost was the ability to run the gate **here**,
on the tree in front of you, before pushing it — and because no target named the
directory, its disappearance was not a failure anywhere. A bind mount can be
emptied out from under a build. An image cannot, and a `make` target is a thing
whose absence somebody notices.

### 3.2 The built-in UI tree comes first, and from outside the container

When `MOS_APID_UI_DIST_DIR` is absent, `check.sh` runs `apid/ui/build.sh`, which
drives docker — and the Rust image carries no docker client, so that fallback
cannot fire from inside the gate's own container. `tests/rust-gate.sh` therefore
does what `pkgs/mosd/hack/build-target.sh` does: builds the tree on the host in
the pinned bun container, mounts it at `/build/apid-ui:ro`, and passes
`MOS_APID_UI_DIST_DIR=/build/apid-ui`. The repository itself is mounted
read-only at the fixed path `/src` with a separate writable `CARGO_TARGET_DIR`,
so the gate cannot fix what it found.

### 3.3 Never `bash -lc` in this container

`-l` sources `/etc/profile`, which overwrites the PATH and takes `/opt/rust/bin`
with it, and then cargo and every tool vanish at once. The trap survived the move
off `/tools` unchanged — it is about the shell, not about the mount — and it now
discards the image's **own** `ENV PATH` rather than one passed with `docker -e`.
*Measured 2026-09-04,* same image, no `-e PATH` at all:

| invocation | `$PATH` inside | `command -v cargo` |
| --- | --- | --- |
| `bash -c 'echo $PATH'` | `/opt/rust/bin:/usr/local/cargo/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin` | `/opt/rust/bin/cargo` |
| `bash -lc 'echo $PATH'` | `/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin` | nothing |

The failure looks exactly like a broken image. Use `bash -c`, which is what
`tests/rust-gate.sh` does.

### 3.4 `dbus-daemon` is in the image now, and that is load-bearing

Several of mosd's and apid's tests assert real behaviour over a private session
bus and are written to **fail rather than skip** without a daemon: "real bus
behaviour over a private session bus and MUST NOT skip: install it"
(`pkgs/mosd/apid/tests/e2e.rs`), and the identical refusal is repeated in
"dbus-daemon was not found at /usr/bin/dbus-daemon or on PATH. This test asserts"
(`pkgs/mosd/mosd/tests/scan.rs`). Until this image existed it was installed by
hand into the container on every run of this gate that ever happened, which is
one `apt-get` between a green run and this, *measured 2026-08-28* on the previous
substrate (the panic location is normalized; source-line positions are not part
of the contract):

    thread 'web_flow_end_to_end' panicked in apid/tests/e2e.rs:
    dbus-daemon was not found at /usr/bin/dbus-daemon or on PATH. [...]
    Summary [   5.853s] 57/705 tests run: 56 passed, 1 failed, 0 skipped
    warning: 648/705 tests were not run due to test failure
    error: test run failed
    rc=100

**Which** test surfaces it first is scheduling, not signal: `bus_roundtrip`
(`pkgs/mosd/mosd/tests/bus.rs`) carries the same requirement, and nextest cancels
the remainder at the first failure. Read `rc=100` together with a `dbus-daemon
was not found` panic as one fact, whatever the test name is — and if you see it
now, you are not in this image.

### 3.5 CI runs the same two scripts, on a deliberately different compiler

`.github/workflows/check.yml`'s `rust` job runs `pkgs/mosd/hack/check.sh` and
`pkgs/rauc-sign/hack/check.sh` on every push to `main` and every pull request. It
does **not** use this image and cannot: a GitHub runner has no
`localhost/mos-build-*` in its image store. It installs rustup at the MSRV both
manifests declare, adds rustfmt and clippy, and apt-installs `dbus-daemon` for
the same tests section 3.4 is about.

The two tools that are neither in a Rust tarball nor in apt — `cargo-nextest`
and `cargo-deny` — are pinned **once**, as the `RUSTCHECK_*` keys in
`build-env/images.env`, and that workflow sources them rather than repeating
them. It used to carry its own four literals; the day this image started
installing the same two tools, that became two pins per tool in two files, free
to disagree. A bump is now one edit that moves CI and this image together.

**The compiler deliberately still differs, and that is two questions rather than
one drift.** CI checks at the MSRV — does the version this tree *promises*
still compile and lint it — and this image checks at `RUST_VERSION`, the version
the shipped binaries are actually built with. A clippy lint that fires on one and
not the other is a real possibility and is a finding in both cases, not a fault
in either runner. Do not "fix" it by making them the same; the local gate going
green is not a statement about the MSRV, and CI going green is not a statement
about the compiler that builds the release.

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
"image ${IMG##*/} is missing; this harness builds nothing. Build it: MOS_BOARD=x64 bash rootfs/build.sh && bash build/run.sh --mkimage-uefi --board x64"
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
4. **The image.** `bash build/run.sh --mkimage-uefi --board x64`, which writes the A/B disk
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

### 8.1 The current substrate — measured 2026-09-04

Run on this host, in this worktree, with the Rust gate in
`localhost/mos-build-rust-check:amd64` and no `/tools` mount anywhere.

| command | final line |
| --- | --- |
| `make build-env` | six images tagged, the new one recording `MOS_BUILD_RUSTC=1.98.0`, `MOS_BUILD_CLIPPY=1.98.0`, `MOS_BUILD_NEXTEST=0.9.143`, `MOS_BUILD_DENY=0.19.9`, `MOS_BUILD_DBUS=1.16.2` |
| `make os-rust-gate` | `ALL CHECKS PASSED` for each workspace, then `RUST GATE PASSED (mosd rauc-sign)` |
| `cargo fmt --all --check`, both workspaces | clean — the diff is **0 bytes**, so nothing was reformatted for this |
| the gate's clippy line at `-D warnings`, both workspaces | **0 findings**, `Finished dev profile in 38.88s` for the seven-crate one |
| `cargo nextest run --workspace --locked` | mosd `1023 tests run: 1023 passed, 0 skipped`; rauc-sign `62 tests run: 62 passed, 0 skipped` |
| `cargo test --doc --workspace --locked` | green, both |
| `cargo deny check licenses bans advisories` | `advisories ok, bans ok, licenses ok`, both |
| `cargo test --locked -p mosd -p apid` | `823 passed` (apid 318 + 1, mosd 496 + 1 + 7), dbus-daemon from the image |
| `make docs-verify` | `183/183`, `448/448`, `734/734`, `231/231`, `43/43` PASS |
| `(cd verify && bun test)` | `1268 pass, 0 fail` |
| `(cd build && bun test)` | `889 pass, 0 fail` (430 s) |
| `bash tests/shell-pipefail-lint.sh` | `70/70 files clean` |

**Zero clippy findings on a gate that had not run for a week is a claim that
needs breaking, not celebrating.** It was: a copy of both workspaces under
`tmp/`, one `pub fn probe(v: &Vec<u8>)` appended per crate — `clippy::ptr_arg`,
a `style` lint inside the `clippy::all` the workspace sets to `warn` — and the
gate's own clippy line run against the copy. Every one of the eight crates goes
red, `rc=101`, `could not compile ... due to 1 previous error`: `busname`,
`mosd-settings`, `ui-bundle`, `mqttd`, `mosd`, `apid`, `mos-mqtt-broker`,
`rauc-sign`. Cargo stops at the first failing crate, so the members had to be
driven one at a time to show that each is reached — worth knowing before reading
a clean run as coverage. The tree was not modified; the copy was thrown away.

### 8.2 The previous substrate — measured 2026-08-28, kept as the baseline

**These numbers describe an arrangement that no longer exists.** The gate ran in
`localhost/mos-build-rust` with `/srv/mos-rust-tools` mounted at `/tools`, and
that directory was emptied on 2026-08-29. They are kept because they are the
only record of what this gate found the last time it ran before that, and
because the two deliberately-red rows still describe failures reachable today.

| command | final line |
| --- | --- |
| `bash docs/verify-index.sh` | `docs/verify-index.sh: 767/767 PASS` |
| `bash hack/check.sh` in `pkgs/mosd`, dbus installed | `705 tests run: 705 passed, 0 skipped`, `advisories ok, bans ok, licenses ok`, `ALL CHECKS PASSED` |
| the same nextest line with **no** `dbus-daemon` | `57/705 tests run: 56 passed, 1 failed, 0 skipped`, `error: test run failed`, `rc=100` |
| `cargo fmt --all --check`, `/tools/bin` first | clean |
| the gate's clippy line, `/tools/rust96/bin` first | `error[E0463]: can't find crate for 'std'`, `rc=101` |

Read across the two tables, the gate went from `705 tests` to `1023` in the week
that no one here could run it. What merged in that week was checked locally by
`cargo test --locked` and by nothing else — no clippy, no `cargo deny`, no
doctests — and CI checked the rest of it at the MSRV; the 2026-09-04 run above
is the first time the whole gate has been run on this host since the toolchain
directory went. It found nothing, which is a fact about how the work was done
rather than an argument that the local route did not need to exist.
