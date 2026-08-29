# Design: the build and check harness — how this repository's checks are run

This page is for someone about to run something. Most checks in this tree run in
a container that the command line does not mention — the docs gates in section 7
are the exception — and the facts that make the difference between a green run
and a confusing red one have until now lived in task records and in operators'
heads. They are collected here so that the next tool does not rediscover them by
failing first.

**Two kinds of claim, and they are marked.** A claim with a citation is a fact
about a file in this tree, and `docs/verify-citations.sh` checks it. A claim
marked *measured* is an observation of **this host** on the date given; no gate
can check it, it can go stale under you, and it is dated for that reason. The
host measurements below were taken on **2026-08-28** unless another date is
given.

## 1. bun runs in a pinned container, and that is a decision

Both bun suites resolve their runtime the same way, from the digest pinned as
`IMAGE_BUN_1` in `os/build-env/images.env`. `os/verify` reads it as
`BUN_IMAGE="$(bash "${REPO_ROOT}/os/build-env/from.sh" --ref IMAGE_BUN_1)" || exit 1`
(`os/verify/run.sh:280`), and `test/apid-api/run.sh` the same:

    bash os/build-env/from.sh --ref IMAGE_BUN_1

`test/apid-api/run.sh` does exactly that, with an override for a caller who
means it —
`BUN_IMAGE="${MOS_APID_BUN_IMAGE:-$(bash "${REPO_ROOT}/os/build-env/from.sh" --ref IMAGE_BUN_1)}"`
(`test/apid-api/run.sh:101`). The pin is a digest and not the `oven/bun:1` tag
because that tag is repointed upstream on every 1.x release, and this harness is
what decides whether apid's API is judged conformant.

`os/verify/run.sh` holds the one seam where host-or-container is decided:
"The seam. Everything above and below passes an argv and reads a status,"
(`os/verify/run.sh:433-435`). Above it the route is chosen once —
`WHY="MOS_VERIFY_CONTAINER=1"` (`os/verify/run.sh:196-198`) — and the
environment variable is documented as
"MOS_VERIFY_CONTAINER=1 use the pinned container even where a host bun exists,"
(`os/verify/run.sh:91`). That is the knob to reach for when you want to compare
the two routes on one machine.

**The container is a pin, not a workaround.** *Measured 2026-08-28:* this host
does have a usable bun and it works.

| what | command | result |
| --- | --- | --- |
| a host bun exists | `command -v bun; bun --version` | `/srv/bkd/runtime/bun`, `1.4.0` |
| it parses the committed lockfile | `cd test/apid-api && bun install --frozen-lockfile --dry-run` | all five packages resolved, `[2.00ms] done` |
| it runs the suite's selftest green | `cd test/apid-api && bun run src/selftest.ts` | `RESULT: PASS (47/47 checks)` |

So a host route is *possible* here and is nevertheless not taken. The reason is
recorded where the decision was made: `run.sh` has
"no host-bun route for any of its other bun invocations" (`docs/task/RFCT-230.md:69`)
— the suite and the `/healthz` probe both run in the pinned image — so a host
route for one caller of three would be
"a second route for one of three callers, and configurability"
(`docs/task/RFCT-230.md:71`) nobody asked for. Read a green run announcing the
container as the pin doing its job, not as a fallback.

## 2. The pinned bun image carries no docker client

`IMAGE_BUN_1` is bun and nothing else, so any route that drives docker from
inside it dies with a message about docker rather than about what you were
doing:
"docker client, so inside it every route ends at `docker: command not found`."
(`os/verify/Dockerfile:16-17`), and the pin's own block says the same —
"this every route inside it ends at `docker: command not found`. Mounting the"
(`os/build-env/images.env:103-104`) daemon socket does not help, because what is
missing is the client, not the socket.

`os/verify/Dockerfile` exists solely to close that gap, and it is the file to
reuse rather than a second one to write. It is two digest `FROM`s and one copy —
`COPY --from=cli /usr/local/bin/docker /usr/local/bin/docker`
(`os/verify/Dockerfile:42`) — with the result asserted at build time by
`RUN docker --version && bun --version` (`os/verify/Dockerfile:49`), so a COPY
whose source moved upstream fails at build rather than three steps later inside a
verify run. The client half is pinned as `IMAGE_DOCKER_CLI_28`, chosen because
the "`-cli` variant carries the client and NOT dockerd. The client is a static"
(`os/build-env/images.env:109-110`) binary, which is what lets an alpine-built
client run on the debian-based bun image.

Both `os/verify/run.sh` and `test/apid-api/run.sh` build that image on demand and
tag it with both input digests, so bumping either pin names an image that was
never built and there is no stale parent to find. Nothing in `make build-env`
builds it; whichever of the two runs first pays the few seconds for it.

## 3. The Rust gate: `os/pkgs/mosd/hack/check.sh`

The gate is five commands, unremarkable in themselves —
`cargo fmt --all --check` (`os/pkgs/mosd/hack/check.sh:6`),
`cargo clippy --workspace --all-targets --locked -- -D warnings`
(`os/pkgs/mosd/hack/check.sh:7`) and
`cargo nextest run --workspace --locked` (`os/pkgs/mosd/hack/check.sh:8`) among
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
(`os/pkgs/mosd/apid/tests/e2e.rs:53`), and the identical refusal is repeated in
"dbus-daemon was not found at /usr/bin/dbus-daemon or on PATH. This test asserts"
(`os/pkgs/mosd/mosd/tests/scan.rs:76`). Measured without it, the gate exits
**`rc=100`**:

    thread 'web_flow_end_to_end' panicked at apid/tests/e2e.rs:51:9:
    dbus-daemon was not found at /usr/bin/dbus-daemon or on PATH. [...]
    Summary [   5.853s] 57/705 tests run: 56 passed, 1 failed, 0 skipped
    warning: 648/705 tests were not run due to test failure
    error: test run failed
    rc=100

**Which** test surfaces it first is scheduling, not signal: `bus_roundtrip`
(`os/pkgs/mosd/mosd/tests/bus.rs:107`) carries the same requirement, and nextest
cancels the remaining 648 at the first failure. Read `rc=100` together with a
`dbus-daemon was not found` panic as one fact, whatever the test name is.
`apt-get install -y dbus` in the container before the gate is what makes it
green; section 8 records both runs.

## 4. Scratch: `runtime/`, and why never `/tmp`

`runtime/` is the scratch root and it is gitignored — `runtime/`
(`.gitignore:33`), directly under a comment that states the rule and its reason:
"docker daemon does not share this session's /tmp). All throwaway compile, verify"
(`.gitignore:30-31`). Container scratch belongs under
`/srv/ai/mos/runtime/<issue-id>/` — never `/tmp`, and never the `/srv` top level.

The reason is measurable rather than stylistic, and the failure is silent.
*Measured 2026-08-28:*

    $ T=$(mktemp -d); echo sentinel > "$T/marker.txt"; ls "$T"
    marker.txt
    $ docker run --rm -v "$T:/probe" alpine:3.21 sh -c 'ls -A /probe | wc -l'
    0
    $ docker run --rm -v /srv/ai/mos/runtime/<id>:/probe alpine:3.21 cat /probe/marker.txt
    sentinel

The mount **succeeds**. The container starts, the directory is there, and it is
bare. Nothing reports an error, so the run fails later saying a file was not
found — and the file is there; it is the mount that is empty. `os/verify/run.sh`
carries a preflight against exactly this, whose message is worth reading before
you debug anything else:
"The mount succeeded and delivered nothing, which is how a bind mount of /tmp"
(`os/verify/run.sh:423`).

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
than re-run: RFCT-206 measured that it reports success and leaves the directory
unchanged, so
"the registration does not stick in this container's"
(`docs/task/RFCT-206.md:371`) namespace. The same record states the inspection
trap in the same breath, a throwaway build having
"printed `aarch64`" (`docs/task/RFCT-206.md:374`) where `docker buildx ls`
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

*Measured 2026-08-28 (RFCT-235), appended to the above rather than replacing
any of it.*

The capability question above has a companion that reads like it and is not
it: what happens when the emulator IS available and the BASE is the wrong
architecture. The answer is the reason `os/pkgs/podman/Dockerfile` carries two
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
architecture. `os/pkgs/podman/build.sh` does this with `MOS_BUILD_BASE_NATIVE`,
resolved through a second `os/build-env/from.sh` call with `--arch` from
`uname -m`, and carried to a container-driver builder as a fifth OCI layout
next to the four. Proved before it was written, with a two-stage throwaway
whose `src` stood on the amd64 base and whose `verify` stood on the arm64 one,
built `--platform linux/arm64` on `mos-arm64`:

    #9 0.809 SRCARCH=x86_64 VERIFYARCH=aarch64

One build, two architectures, one builder.

## 6. The image is an input, and "no image" reads as a harness failure

`test/apid-api/run.sh` **builds nothing**. When `_out/x64/` or the image inside
it is absent it refuses by name and prints the two commands that make it:
"image ${IMG##*/} is missing; this harness builds nothing. Build it: MOS_BOARD=x64 bash os/rootfs/build-v2.sh && bash os/build/run.sh --mkimage-x64"
(`test/apid-api/run.sh:332`). The same sentence guards the missing directory one
step earlier:
"does not exist, so there is no image to boot; this harness builds nothing."
(`test/apid-api/run.sh:48`).

Those two commands are the last two links of a longer chain, and the earlier
links fail the same way — as an apparently broken harness. In order:

1. **The packages.** `bash os/pkgs/rauc/build.sh` and `bash os/pkgs/podman/build.sh`
   produce `_out/<board>/rauc` and `_out/<board>/podman`. The rootfs stages
   consume those directories by name — `COPY ${RAUC_DIR}/ /tmp/rauc/`
   (`os/rootfs/stages/32-feature-rauc.Dockerfile:35`) and
   `COPY ${PODMAN_DIR}/ /tmp/podman/`
   (`os/rootfs/stages/31-feature-containers.Dockerfile:103`) — and the build
   passes each one only when the matching feature is in the chain, as
   `--arg PODMAN_DIR="_out/$MOS_BOARD/podman"`
   (`os/rootfs/build-v2.sh:642`) and
   `--arg RAUC_DIR="_out/$MOS_BOARD/rauc"`
   (`os/rootfs/build-v2.sh:644`).
2. **The rootfs.** `MOS_BOARD=x64 bash os/rootfs/build-v2.sh`.
3. **The image.** `bash os/build/run.sh --mkimage-x64`, which writes the A/B disk
   image around the rootfs slot. Its name is read from the board definition,
   `IMAGE_LATEST_NAME=x64-mos-v2-latest.img` (`os/boards/x64/board.env:182`),
   rather than repeated in the harness.
4. **The run.** `make os-apid-api-test`, or `bash test/apid-api/run.sh`.
   `bash test/apid-api/run.sh --dry-run` does the preconditions and the network
   discovery and boots nothing, which is how to check the harness in seconds.

The boot engine itself is `test/apid-api/src/qemu.ts`, beside the suite that
drives it. It was a shell tool under `os/tools/` until RFCT-230 ported it; that
file is gone, and a search for it is a search for something deleted.

## 7. The docs gates

Two scripts, both read-only, both needing nothing but bash and coreutils.

`bash docs/verify-index.sh` asserts that the indexes agree with the tree **in
both directions** — it is written to catch a rename, because
"Asserts that the three document indexes agree with the tree, in BOTH"
(`docs/verify-index.sh:2`) directions is the half that a forward-only check
omits. It covers four pairings:
`1. docs/design/*.md      <-> docs/README.md` (`docs/verify-index.sh:9`),
the same for `docs/research/`,
`3. docs/task/RFCT-*.md   <-> docs/task/index.md` (`docs/verify-index.sh:11`),
and `4. docs/plan/PLAN-*.md   <-> docs/plan/index.md`
(`docs/verify-index.sh:12`).
So a new design page needs its row in `docs/README.md`, a new task file needs
its row in `docs/task/index.md` and a new plan needs its row in
`docs/plan/index.md`, in the same commit.

`bash docs/verify-citations.sh` scans
"docs/design/*.md, docs/task/*.md and" (`docs/verify-citations.sh:13`)
`docs/research/*.md`, each excluding `*.zh.md`, plus `docs/architecture.md`. It
does **not** scan `test/`, which is why this page lives under `docs/design/`: a
harness page under `test/apid-api/` would be gated by nothing.

Two properties decide how you write a citation here.

**Citations are quote-armed.** Resolution alone passes on a quotation whose
source was renamed underneath it, so check 2 compares the quoted text against the
cited lines — but only when quote and citation are *directly adjacent*, since
"a citation carries a" (`docs/verify-citations.sh:90`) quote when it sits
directly against a quoted fragment on either side, with nothing between them but
whitespace, emphasis characters and one parenthesis. One interposed word demotes
the pair to resolution-only, silently as far as the run's exit status goes. A
per-document ceiling in `docs/verify-citations-unquoted-baseline.txt` holds the
ratchet: a document with no row has a ceiling of zero, so **a new document must
be fully quoted**.

**A green gate does not mean every citation is fresh.** Shorthand citations are
skipped by design: a token whose path has no `/` — the continuation form, where
the file was named earlier in the prose — "is shorthand for a path named earlier
in the prose and has no base to resolve" (`docs/verify-citations.sh:45`) against.
It is counted in the summary and never opened. A citation written that way points
nowhere checkable, so write the full path every time. The script says the rest
itself: a provenance claim such as "measured at <commit>" is validated against no
file at all.

## 8. Verification

Everything below was run on this host on 2026-08-28, in this worktree. The Rust
gate ran in `localhost/mos-build-rust` with `/srv/mos-rust-tools` mounted at
`/tools`, invoked with `bash -c` and the full PATH of section 3.

| command | final line |
| --- | --- |
| `bash docs/verify-citations.sh` | `docs/verify-citations.sh: 1457/1457 PASS` |
| `bash docs/verify-index.sh` | `docs/verify-index.sh: 767/767 PASS` |
| `bash hack/check.sh` in `os/pkgs/mosd`, dbus installed | `705 tests run: 705 passed, 0 skipped`, `advisories ok, bans ok, licenses ok`, `ALL CHECKS PASSED` |
| the same nextest line with **no** `dbus-daemon` | `57/705 tests run: 56 passed, 1 failed, 0 skipped`, `error: test run failed`, `rc=100` |
| `cargo fmt --all --check`, `/tools/bin` first | clean |
| the gate's clippy line, `/tools/rust96/bin` first | `error[E0463]: can't find crate for 'std'`, `rc=101` |

`docs/task/RFCT-233.md` carries the full table — every command in this page with
its output, including the two deliberately-red runs above and the bun, scratch
and arm64 measurements.
