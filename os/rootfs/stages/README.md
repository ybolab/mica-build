# os/rootfs/stages — one Dockerfile per stage, chained by local image tags

`Dockerfile.v2` was 1,827 lines, then 1,152 once RFCT-111 M5a moved its shell
into `../scripts/`. It is now these four files. Read this before any of them.

## The chain

Each file is built on its own, in numeric order, and each is written to a local
image tag the next one starts `FROM`:

```
10-base ──▶ 20-install ──▶ 30-40-unsplit ──▶ 90-pack ──▶ _out/<board>/
```

Every stage after the first declares `ARG MOS_STAGE_PREV` with **no default**
and opens with `FROM ${MOS_STAGE_PREV}`. The driver passes the previous stage's
tag and refuses to build a file that does not declare the argument, so a stage
cannot be built standalone against whatever `FROM` line happened to be typed.
Only `10-base` and `90-pack` name a base image of their own, and each names
only the one its own `FROM` consumes — trixie here, bookworm there.

The driver is `os/verify/src/stages.ts` (the plan) and `stages-cli.ts` (the
run); `os/rootfs/build-v2.sh` still stages the build context and still is the
whole build. See "Where the driver lives" below.

**The stage list is the directory, not a list.** The driver reads
`*.Dockerfile` here and sorts by the numeric prefix. Adding a stage is adding a
file; removing one is removing a file. A list kept somewhere else is the second
table this repository keeps deleting — and a stage added without being added to
it would be a stage that silently never runs.

## Why these numbers

PLAN-014 M5's vocabulary is `10-base`, `20-install`, `30-feature-*`,
`40-board`, `90-pack`. Three of those are here. `30-40-unsplit` is **not a
stage**: it is the material `30-feature-*` and `40-board` are cut from, held in
one file, under a number no plan uses, until M5c and M5d cut it. Its own header
says what each of them takes. When both cuts have landed the file is empty and
must be deleted.

| stage | what it is | scripts |
|---|---|---|
| `10-base` | the system-essential floor: package allowlist, TLS trust anchors, image profile, operator account, journald storage | 4 |
| `20-install` | read-only-root wiring: the rendered overlay (fstab, `repart.d`, STATE/DATA binds, seed oneshots) and the image's network defaults | 2 |
| `30-40-unsplit` | **temporary** — features and board work, awaiting M5c and M5d | 16 |
| `90-pack` | close the root (inventory, purge, report), then squashfs-zstd + dm-verity, then the export surface | 12 |

## The one reordering, and why it was necessary

The four files hold **exactly** the instructions `Dockerfile.v2` held — no `RUN`
was merged, split, added or dropped, and the only new lines in the whole cut are
the three `ARG MOS_STAGE_PREV`/`FROM ${MOS_STAGE_PREV}` chain links and
`COPY --from=rootfs` becoming `COPY --from=closed`.

Six of them moved **earlier**, and nothing moved later:

| moved | from | to |
|---|---|---|
| `profile-write.sh` | after `podman-exercise` | `10-base` |
| `RUN rm -f /etc/ssh/ssh_host_*` | after `firmware-install` | `10-base` |
| the journald `Storage=volatile` drop-in | after `hwinit-install` | `10-base` |
| `account-mos.sh` | after the journald drop-in | `10-base` |
| `network-and-ssh-units.sh` | after `firmware-install` | `20-install` |
| `overlay-install.sh` | after the ssh-host-key removal | `20-install` |

Every other instruction keeps its relative order exactly.

**This is not tidying.** RFCT-111 asks for one stage per *switchable* feature,
"replacing `WITH_*` args with stage selection" — a feature has to be a stage the
driver can leave out. In the single file the radio feature straddled the
overlay: `radios-packages` and `radios-mask-units` ran before it,
`radios-mounts` after, and `radios-mounts` **must** be after it (the comment on
that `RUN` records the x64 build that failed when it was not). The container
feature straddled it the same way, through `podman-assert-config`. A feature
split across the overlay cannot be one omittable stage. Putting the overlay
before every feature is what makes the rest of M5 possible.

**It was measured, not argued.** A reordering can change the image, and the
instrument for that is in `../README.md` under "Determinism, and what still
deviates": extract both packed roots, `diff -r` the trees, and require the
differing set to be no larger than a control of two cold builds of the
unmodified file. It is a content diff and **not** a sha256, because a cold x64
build does not reproduce itself — RFCT-111 measured two cold builds of the
untouched `Dockerfile.v2` on this host at `1b3f5e50…` and `7aad6efd…`. A gate
that compared hashes would fail on a correct change and pass on luck.

## What did not move, and why it could not

`90-pack`'s `closed` stage holds the package inventory, the package-manager
purge and the build report. They read as `10-base` material — they are neither
a feature nor a board fact — and they cannot go there: `dpkg-query` has to see
every package a feature or board stage installed, and the purge has to be the
last step in the chain that still needs dpkg. A floor stage cannot hold a step
that must run after everything.

They are in `90-pack` rather than in a fifth stage file of their own because
closing the root and packing it are one operation with one output, and nothing
can ever be inserted between them. A stage boundary nothing can be inserted at
costs a reader a hop and buys nothing.

## The builder must resolve local tags — measured

The chain resolves `FROM ${MOS_STAGE_PREV}` against the **local docker image
store**, so it must be built by a builder whose driver can read that store. The
default `docker` driver can. A `docker-container` builder **cannot**, and does
not say so usefully; driven on this host it reported

```
ERROR: failed to solve: mos-probe:a: failed to resolve source metadata for
docker.io/library/mos-probe:a: pull access denied, repository does not exist
```

— a message about a registry, for an image that is right there. The driver
therefore checks the builder's driver up front and refuses by name, because
that error arriving forty minutes into a build, pointing at Docker Hub, is a
diagnosis nobody makes quickly.

This matters for **cross-architecture builds and no other case**.
`build-v2.sh` falls back to a `docker-container` builder exactly when the
current builder cannot reach the target platform — an amd64 host building
cx3576's arm64 without host `binfmt_misc`. On such a host the chain needs
`binfmt` installed (so the `docker` driver can reach arm64 itself) or a local
registry to hold the stage tags. A host that can build the target natively,
or that has binfmt, is unaffected.

## The shell, the arguments, and the bind mount

Unchanged by this cut, and recorded once here instead of four times:

Every `RUN` body longer than one command lives in `../scripts/` and is reached

```dockerfile
RUN --mount=type=bind,source=os/rootfs/scripts,target=/mos-scripts \
    sh /mos-scripts/<name>.sh
```

A **bind mount and not a `COPY`**, because a `COPY` would put the script in the
image; the mount exists only for its own `RUN` and leaves neither the files nor
`/mos-scripts` behind. `sh <path>` and not the shebang, so the interpreter is
the caller's decision rather than a mode bit a checkout could lose.

The **arguments still arrive**: docker puts every `ARG` that has a value into
the `RUN`'s environment, so the script — and any child of it — reads them from
there. An `ARG` declared with no value is *unset* rather than empty, so a
`set -u` on it fails inside the script exactly as it did inline. Each script
names the arguments it reads in its header. Note that `ARG` is **per stage**,
and now also per *file*: an argument a stage's `RUN`s read must be declared in
that stage's file. `BOARD_RADIOS` is declared in `30-40-unsplit` and again in
`90-pack` for that reason.

These scripts are POSIX `sh` under dash. **Do not add `set -o pipefail`**: dash
has no such option, and several use `producer | grep -q`, a form that is correct
without it and inverts its own answer with it. `os-shell-pipefail-lint` scans
only files that enable the option, so these are outside its scope by
construction rather than by exemption.

## Where the driver lives, and where it belongs

`os/verify/src/stages.ts` + `stages-cli.ts` + `stages.test.ts`, reached through
`os/verify/run.sh --build-rootfs`.

That is **not** where PLAN-014 will leave it. RFCT-112 (M6) puts build
orchestration in `os/build/`, and M6a was building that package while this
landed. The driver went into `os/verify` because that is the only bun package in
the tree today that typechecks, runs `bun test` and carries the tool-less-host
route — a driver nobody can run is not a deliverable — and because the board
model it needs is `os/verify/src/board.ts`, the one typed reader, which must not
be copied.

The module is deliberately shaped for the move: `stages.ts` is pure and imports
nothing but `node:fs`, `node:path` and this package's `paths.ts`;
`stages-cli.ts` is the only file that runs docker. Relocating it into
`os/build/` is three file moves, two import-path rewrites and a `run.sh` mode.
