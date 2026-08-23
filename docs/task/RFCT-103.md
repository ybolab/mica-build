# RFCT-103 PLAN-012 M1–M4: build the engine from source, replace the distribution's configuration, and give the switch something to switch

- **status**: implementation complete — image verify 381/381, `os/ui-location-test.sh` 59/59 cases, mosd workspace 517/517, `os/quadlet-doc-test.sh` 12/12, `docs-verify` 342/342
- **priority**: P1
- **owner**: ai-agent
- **createdAt**: 2026-08-23 18:00
- **claimedAt**: 2026-08-23 18:00

RFCT-101 put trixie's podman in the image; RFCT-102 proved it was usable and
gave boards a way to decline it. This task builds the engine from upstream
source, drops `containers-common` for configuration mos writes itself, and
lands the switch PLAN-012 D3 asked for — which turned out to gate something
different from what D3 described.

## The build is dynamic, and the static version was the wrong problem

`os/podman` was first written to produce statically linked musl binaries so the
engine and the base could move independently. Twelve iterations went into it.
Both hard blockers were musl-only: Rust edition 2024 needs rustc ≥ 1.85 and
Alpine 3.21 ships 1.83, and `aardvark-dns` 2.x calls `libc::close_range`, which
the `libc` crate defines for gnu and not for musl (measured: 1 occurrence in
`gnu/mod.rs`, 0 in `musl/mod.rs`), forcing a downgrade to the 1.17 network
stack.

The image already ships glibc. Static linking bought independence from a
library that is present either way, and the 2.1 network stack came back the
moment the build was pointed at `rust:1.90-trixie`. `catatonit` remains static
for a reason that applies to it alone: it is copied **into** containers as
their init, where the libc is whatever the container ships.

Also retired: the original justification for building at all. It was that
Debian 12 predates Quadlet — and that died when the base moved to trixie, whose
podman 5.4.2 has it. **A justification does not expire on its own, and nothing
in the build would have reported it false.** What remains is version autonomy,
which is a different and real claim: podman 5.8.6 against trixie's 5.4.2, crun
1.29.1 against 1.21, netavark 2.1.0 against 1.14.

## Three kinds of dependency, and only one of them is visible

Auditing from podman's own source rather than from what `apt-get install
podman` pulled turned up three categories:

| Kind | Example | What can see it |
|---|---|---|
| linked | `libjson-c.so.5` | `NEEDED`, `ldd` |
| **exec'd** | `nft` | nothing |
| **dlopen'd** | `libsystemd.so.0` | nothing |

`nft` was **missing from the image RFCT-101/102 shipped**, which passed 376
assertions. netavark 2.x has exactly three firewall drivers — Firewalld,
Nftables, Fwnone (`src/firewall/mod.rs`); the iptables driver was removed — and
it reaches nftables by exec'ing `nft` off PATH (`nftables-0.6.3/src/helper.rs`,
`NFT_EXECUTABLE = "nft"`). Measured: without it the first `podman run` fails
with `netavark: nftables error: unable to execute nft`; installing `nftables`
moves the failure past netavark entirely.

Nothing caught it, and the reason is worth recording. A soname check cannot see
an exec by construction. And the build probe's comment said, accurately, that a
container starting could not be tested there because the sandbox has no cgroups
or namespaces — **whether a file exists needs no cgroups at all**. An
accurately stated limit is still a place for an unrelated gap to hide, so the
probe now names each claim it makes rather than gesturing at its own reach.

`libsystemd.so.0` is the third kind: `go-systemd`'s `sdjournal` opens it by
name at runtime (`sdjournal/functions.go:37`). With `log_driver = "journald"`,
its absence would lose container logs rather than fail.

`libsqlite3-0` went the other way. It was predicted from `go.mod:44`, which
does carry `mattn/go-sqlite3` — but that driver compiles the SQLite
amalgamation in unless the `libsqlite3` build tag is set, so no binary links
it. Predicting a runtime package list from a dependency manifest ships packages
nothing opens.

## mos writes the engine's configuration, and only at `/etc`

`golang-github-containers-common` is not installed. Four files ship instead —
`policy.json`, `containers.conf`, `registries.conf`, `storage.conf` — each
citing the podman source that defines its path, and the verifier asserts there
is **no** second layer at `/usr/share/containers/containers.conf`: podman merges
that one underneath `/etc`'s, so an operator reading `/etc` would see half the
configuration.

`containers.conf` pins `helper_binaries_dir` rather than letting podman search.
The default list (`config_linux.go:24`) begins with `/usr/local/libexec/podman`
and `/usr/local/lib/podman`, and PLAN-011 D5 makes part of `/usr/local` a
STATE-backed writable bind. The sibling directories are read-only squashfs
today, so this is not a live hole — it is a search order that puts
writable-adjacent paths ahead of the image's own binaries.

`short-name-mode = "disabled"`, and the stricter-looking value is a trap:
`"enforcing"` **errors when stdout is not a TTY**
(`sysregistriesv2/system_registries_v2.go:246`). A Quadlet-generated unit is a
systemd service. It has no TTY.

## Seven units that are absent rather than masked

`os/podman` does not run upstream's `make install.systemd`, so the image
contains no podman unit at all. The previous arrangement installed seven and
symlinked each to `/dev/null` against a hand-kept list — a check that could
only fail if podman's unit set *changed*, and could not notice one podman
*added*. The assertion is now that nothing named `podman*` exists under any
unit directory.

## The switch gates the Quadlet bind, not a service

PLAN-012 D3 said "enable+start on true, stop+disable on false", on the
`SshdReconciler` model. It was written against the packaged engine, and the
unit it meant no longer exists: podman is daemonless and this image ships none
of its units. What remains as the real gate is `/etc/containers/systemd` —
unmounted, it is the empty directory inside the read-only root, so Quadlet
parses nothing and no container unit exists.

**`etc-containers-systemd.mount` therefore ships installed and NOT statically
enabled, which inverts RFCT-102.** That task added the
`local-fs.target.wants` symlink because without it nothing an operator
installed survived a reboot — correct for an image with no switch, and it
pre-empted the switch. Statically enabled, the bind comes up at every boot
whatever `container.enabled` says, so anything able to write
`/mnt/state/quadlet` gets a root-capable container at the next reboot with no
operator decision in the path. `ContainerReconciler` brings it up at runtime,
which is the same runtime-scoped enablement (`/run/systemd/system`) every other
mos-driven unit uses.

Two ordering facts are assertions rather than comments, and each was
mutation-checked by reversing it:

- **Mount before reload.** Generators run at boot and on reload and only then;
  a reload with the directory still unmounted parses the image's empty one and
  produces nothing, with every step succeeding.
- **Stop containers before unmounting.** The reverse makes the `.container`
  files invisible, the next reload drops the generated units from systemd's
  view, and the containers they started keep running as orphans that no unit
  name can stop.

A generated unit is recognised by **content** — the podman path in its
`ExecStart` — not by filename. Quadlet's name mapping has cases (`.pod` becomes
`<name>-pod.service`, `.volume` becomes `<name>-volume.service`); a reconciler
that reimplemented that table would fail to stop exactly the unit types it had
not heard of, and would fail silently.

## The apid pane, and a hole it exposed

The pane states the consequence in D5's terms rather than as a generic warning:
containers run as root, rootless is not built, and writing a `.container` file
into the Quadlet directory is the act that exercises it. Three separate
assertions, because a page saying only "runs as root" would pass a check for
the word.

A meta-test now reads `routes.rs` for every path registered with `post(...)`
and fails naming any that the authentication tests do not iterate. On its first
run it named three. Two were false — the power routes are covered by a second
list — and one was real: **POST `/network`, which rewrites an interface's
addressing, had no test asserting it rejects an unauthenticated request.**
`unauthenticated_panes_redirect_to_login` covers the GET and reads as though it
covered the pane. The lists are now one, and `assert_nothing_written` also
asserts no power action, since a rejected `/power/reboot` and a successful one
were indistinguishable to a settings-only check.

## The document is executed

`docs/design/containers.md` is the integrator's guide (D4: mos does not
orchestrate). Its six examples are extracted by `os/quadlet-doc-test.sh` and
fed to the aarch64 Quadlet binary the image ships, under emulation.

The first version of one assertion was `grep -q 'db'`, which matches
`db.service` and would have passed with `NetworkAlias` silently dropped — the
exact failure section 5 tells the reader cannot happen. It checks
`--network-alias db` now. Mutation-checked: removing `NetworkAlias` fails one
assertion, removing `After=` fails a different one.

The document also states plainly that `policy.json` ships
`insecureAcceptAnything` and that **image signatures are not verified** — JSON
has no comment syntax, so the one place that decision can be recorded and
checked is here.

## Two caches, and one measurement that was not one

The Rust and C stages had no compiled-output cache while the Go stage had two.
Measured cost: netavark 23m58s, aardvark-dns 8m05s, crun ~10m on every
invalidation. With `target/` and `ccache` mounts, a forced Rust rebuild
recompiles 0 crates: netavark 3.99s, aardvark-dns 1.10s.

A second `make podman` finishing in 6 seconds is **not** evidence of this. That
is the layer cache, which was never in question; nothing had invalidated a
compile stage. The number above came from a temporary Dockerfile that changed
the Rust stage's instruction hash on purpose.

Merging the four builder stages into one shared image would make caching
*worse*, and this build measured it: adding `libsystemd-dev` — which only the
Go stage needs — invalidated `go-build` and nothing else. Behind one apt list
that edit recompiles every component.

`COPY versions.env` was replaced by a generated `versions.lock` with comments
stripped, after adding a paragraph of prose to `versions.env` invalidated every
compile stage below it. **A cache key should be the inputs, not the commentary
about the inputs, or the commentary stops getting written.**

## The verifier could have checked the wrong image

`make os-verify-cx3576-v2` had no dependency on the image being current. During
M2 this was one command away from verifying a six-hour-old image built from the
distribution's podman and reading PASS as a description of the self-built one.
It now refuses an image older than `rootfs-verity.img` or `os/podman/out`;
`MOS_VERIFY_ALLOW_STALE=1` is for checking a downloaded release image, whose
source is not this tree.

## What the build still cannot prove, named individually

- **A container starting.** Needs cgroups and namespaces buildkit does not
  give a `RUN`.
- **That `containers.conf`'s VALUES take effect** — that podman resolves its
  runtime to `/usr/bin/crun` and conmon to `/usr/libexec/podman/conmon` rather
  than finding something under `/usr/local` first. `podman info` reports
  exactly that and fails here with `cannot clone: Invalid argument`. What the
  build does prove is that podman **parses** the file, checked against a
  deliberately malformed control so the check is known to be able to fail.

Both stay the first flash's job, and they are listed rather than covered by one
sentence about the sandbox's limits — which is how `nft` hid.
