# `os/podman` — the container engine, built from source

Produces seven aarch64 binaries into `os/podman/out/`. Same arrangement as
`board/cx3576/kernel/`: builder stages, then a `FROM scratch AS artifact` that
`-o` exports.

```
make podman          # → os/podman/out/
```

| Binary | What it is |
|---|---|
| `podman` | the engine. Daemonless: `podman run` forks `conmon`, which execs `crun` |
| `quadlet` | the systemd generator that turns a `.container` file into a service |
| `crun` | the OCI runtime. C, not Go — and what trixie's podman already invokes |
| `conmon` | per-container monitor |
| `netavark` | networking |
| `aardvark-dns` | container-to-container name resolution |
| `catatonit` | container init, for `--init` |

**Staging these into the rootfs is not wired yet** (PLAN-012 M2).
`os/rootfs/` still installed the engine from apt when this was written; this directory
builds a parallel set that nothing consumes. The unfinished part is not the
compile — it is deciding what happens to the apt package's configuration,
`containers-common` policy files and seven systemd units when its binaries are
replaced. Until that is answered, `make podman` is a build you can run and an
image you cannot yet get out of it.

## Bumping a version

`versions.env` is the only file to edit. Set the tag, set its hash to the
literal `PENDING`, and run `make podman`: the build prints the hash it
computed and **fails**. Paste that in and run again.

The two-step is deliberate. It makes recording a hash an act, rather than a
value copied from an upstream page that nobody re-checked.

Until RFCT-108 M2c the build printed the hash and *warned*, and
`MOS_PODMAN_STRICT=1` turned the warning into a failure — described here and in
`versions.env` as "what CI sets". Nothing in this repository ever set it, in any
workflow, Makefile target or script, so the developer path and the release path
were the same warning and a half-finished bump built green against whatever the
tag pointed at that day. The knob is gone; the behaviour is now the one both
files always described.

The hash is over `git archive` of the tag, so it covers the tree that is
actually compiled. A tag can be moved upstream; a tree hash cannot.

## Which compiler builds it (RFCT-108 M2c)

The four builder stages stand on `localhost/mos-build-{base,c,go,rust}`, built
by `make build-env` from `os/build-env/images.env`. Until RFCT-108 M2c they
stood on `debian:trixie-slim`, `golang:1.25-trixie` and `rust:1.90-trixie` --
three tags upstream repoints on its own schedule.

That was a **toolchain bump as well as an image swap**: Go 1.25 to 1.26.7 (1.25
is a line Go no longer supports) and Rust 1.90 to 1.98.0. So the engine was
re-proven under it rather than merely rebuilt, on amd64, at switchover:

| binary | built by | reported version | `versions.env` pins |
| --- | --- | --- | --- |
| podman | `go1.26.7` (from `go version -m`) | 5.8.6 | `v5.8.6` |
| quadlet | `go1.26.7` | 5.8.6 | (podman's tree) |
| crun | GCC (Debian 14.2.0-19) | 1.29.1 | `1.29.1` |
| conmon | GCC (Debian 14.2.0-19) | 2.2.1 | `v2.2.1` |
| catatonit | GCC (Debian 14.2.0-19) | 0.2.1 | `v0.2.1` |
| netavark | rustc `88d9e12ae178…` = 1.98.0 | 2.1.0 | `v2.1.0` |
| aardvark-dns | rustc `88d9e12ae178…` = 1.98.0 | 2.1.0 | `v2.1.0` |

"Built by" was read out of each artefact, not assumed from the image. Each
binary was then EXECUTED, in the digest-pinned trixie with the sonames
`NEEDED.txt` names installed -- not the builder image, which carries the `-dev`
headers and not the runtime libraries. `podman info` (privileged, because it
re-execs into a user namespace) resolves this build's own conmon and crun and
reports `netavark 2.1.0` as its network backend, with `+SECCOMP +JSON_C` --
which is the `-dev` list below doing its job.

The `-dev` packages stay in this Dockerfile and are deliberately NOT in
`mos-build-c`. libseccomp, libcap, libjson-c, libyajl, glib and libsystemd are
facts about crun, conmon and catatonit; hoisting them into the shared image
would put them in the cache key of every other component that stands on it,
which is the ~42-minute measurement recorded at the top of the Dockerfile. For
the same reason `mos-build-go` carries no C compiler and the Go stage installs
`build-essential` itself.

Building for **arm64 needs an arm64 builder family**, because a `localhost/` tag
carries exactly one architecture where a `name:tag@sha256:` digest is a
multi-architecture index. `os/podman/build.sh` refuses the mismatch by name.

## Why build it, when trixie ships a working one

Not to save space, and not because the package is missing a feature.

The original argument for this directory was that Debian 12 shipped podman
4.3.1, which predates Quadlet (4.4) — and Quadlet is what lets a container
definition be a systemd unit, which is how PLAN-012 D4 avoids mos needing an
orchestrator. That argument died when the base moved to trixie, whose podman
5.4.2 has Quadlet. It is recorded here rather than deleted because it stood
unexamined for the length of a base upgrade: **a justification does not expire
on its own, and nothing in the build would have reported it false.**

What remains is version autonomy, which is a different claim and a real one:

| | trixie (apt) | this directory |
|---|---|---|
| podman | 5.4.2 | 5.8.6 |
| crun | 1.21 | 1.29.1 |
| netavark | 1.14 | 2.1.0 |
| aardvark-dns | 1.14 | 2.1.0 |

The gap is not the point either — it will be different next month. The point is
that the version becomes a line in `versions.env` instead of a consequence of
which Debian the base happens to be. Independence is bought per component, not
per distribution: nothing here obliges the other 500-odd packages in the image
to leave apt.

## Why dynamic, against an earlier decision to go static

This build was first written to produce statically linked musl binaries, so
that the engine and the base could move independently. Two things retired that:

- **The image already has glibc.** Static linking bought independence from a
  libc that ships either way, at the cost of a second toolchain.
- **Both hard blockers were musl-only.** `close_range` is absent from the musl
  side of the `libc` crate (measured: 1 occurrence under `gnu`, 0 under `musl`)
  and crun's autotools path needed reworking. Twelve build iterations were spent
  on obstacles that the glibc build does not have.

`catatonit` is still static, for a reason that applies to it alone: it is copied
*into* containers as their init, so it must not depend on this image's libc.

The verify stage asserts each of those separately — seven aarch64 ELFs,
`catatonit` statically linked, and for every other binary, each `NEEDED` soname
present in `image-libs.txt`. That last list is **generated from the packed
rootfs**, never hand-written: a hand-kept list keeps passing after the image
drops a package, and the binary that needed it fails on the device instead.
It is the check that caught crun 1.29.1 needing `libjson-c.so.5` where trixie's
1.21 needed `libyajl.so.2` — upstream deleted yajl between them.

## What this costs, stated plainly

Six upstreams to track for CVEs, in three languages. On the packaged path
Debian's security team does that work; here it is ours. `versions.env` plus a
scheduled upstream-tag check in the privileged CI lane (PLAN-012 M5) is the
mitigation, and it is not optional — a pinned version with nothing watching it
is a version that silently rots.

`catatonit` is the one to watch: its newest release is v0.2.1 (2024-12-14). A
container init is small and rarely needs to change, so a quiet upstream is not
by itself alarming — but it is the component where "no new tag" and "no longer
maintained" look identical, and the M5 check cannot tell them apart.
