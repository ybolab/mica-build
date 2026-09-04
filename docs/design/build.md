# Design: building the images — x64 and cx3576

> English | [中文](../zh/design/build.md)
>
> The build guide: what a complete build is, the order it runs in, which steps
> cross-compile and which need emulation, and how to tell the three arm64
> capabilities apart before believing an error message. `build-harness.md`
> covers the *checks*; this page covers the *artifacts*.

## 0. The rule

The rule is a property of the system, and it is written as one so that it can
be run rather than argued:

> **A host with only Docker and git must be able to build and release an image,
> completely.**

From which, as an instruction:

> **No toolchain on the host. No compilation on the host. No assembly on the
> host.**

Every compiler, every filesystem maker, every image assembler, every packer and
every signing tool comes out of an image pinned by digest in
`build-env/images.env`.

This page has carried the instruction for as long as it has existed. What
follows is the part it was missing: what "only Docker and git" has to mean in
practice, which side of the line a given tool is on, which paths do not obey it
yet, and what fails when a new one joins them.

### 0.0 What the host is allowed to have

Taken from the experiment below rather than guessed — this is what it needed
and nothing more:

| On the host | Why |
| --- | --- |
| `docker`, with a reachable daemon | everything else runs inside what it starts |
| `git` | the file list every gate reads comes from `git ls-files` |
| `bash` | every entry point here is a bash script, and bash writes no byte of any artefact |
| `make` | the target names are the build's interface, and a recipe only decides which script runs |
| a busybox userland — `sh`, `awk`, `sed`, `grep`, `sha256sum`, `tar` | the scripts' own arithmetic |

**`bash` and `make` are orchestration by §0.1** — neither can change a byte of a
shipped artefact — and they are named here rather than left implied, because a
policy whose own entry point violates it is worse than no policy. `jq` and
`curl` are reached by two paths only (§0.3) and are not needed to build an
image.

Anything else a build reaches for is a finding. Nothing may require host `bun`,
host `node`, host `python3`, host `go`, host `gcc`, host `cargo`, or any
filesystem or image tool.

**Observed, 2026-09-04, not asserted.** Inside `IMAGE_DOCKER_CLI_28` — which is
docker, git and a busybox userland, with no bash, no make, no bun, no node, no
python, no compiler and none of sgdisk/mtools/mksquashfs — against a fresh
clone with the daemon socket mounted:

| | |
| --- | --- |
| `make docs-verify`, `bash …` with docker + git only | `sh: make: not found`, `sh: bash: not found` |
| + `bash` and `make` | all five docs gates green |
| `make os-layout-lint` | `RESULT: PASS (28/28 checks)` |
| `make os-verify-test` | `RESULT: PASS (1270/1270 tests)`, bun from the pin |
| `bash build/run.sh --mkimage-x64` | image assembled, 1938 MiB |
| `bash verify/run.sh --verify --board x64` | `RESULT: PASS (313/313 checks, 22 skipped)` |

One thing a bare host still cannot do: compose the rootfs.
`build/run.sh --build-rootfs` drives `docker buildx`, which is a CLI plugin
`verify/Dockerfile` does not copy, and the refusal names it.

### 0.1 The test, for a tool nobody listed

A list of banned binaries goes stale the first time someone reaches for one
that is not on it. The boundary is a question instead, asked of the tool:

> **If this exact input were handed to a different build of this tool, could
> the run's output differ?**

| Answer | The tool is a… | Where it runs |
| --- | --- | --- |
| Yes, and the output is a byte that survives the run — an image, a package, a bundle, `dist/`, `out-<arch>/`, a signature, a recorded config | **producer** | In a container, pinned by digest. No probe, no host route, no fallback. |
| Yes, and the output is a verdict — a pass or a fail somebody reads | **judge** | The pinned container is the *contract*: it is what CI runs and what a result is quoted from. A host route may exist as an opt-in for the inner loop, and must announce which route answered. |
| No — the output is fixed by the input alone (`sha256sum`, `cmp`, `git rev-parse`), or the tool produces nothing and only decides which container runs (`docker`, `make`, `bash`, `jq`, `curl`) | **orchestration** | On the host. There is no container to run it in without it. |

Two consequences, because both have been argued the other way:

**Compilation is a producer even when the binary is discarded.** `cargo clippy
--workspace -- -D warnings` keeps no artefact and its verdict is still decided
by the toolchain — `build-harness.md` §3 records a 1.96 `rustc` ahead of the
image's 1.98 reporting `error[E0463]: can't find crate for 'std'` against a
workspace that was fine. A compiler is never a judge.

**A digest is not a producer.** `sha256sum` writes a byte that ships, into
`SHA256SUMS` and into `disk.img.sha256`, and no build of it can write a
different one. The question is about the tool's freedom, not about whether the
byte survives.

Worked through for `bun`, which is the tool the question is hardest for: the
bun that writes `_out/apid-ui/dist` (`pkgs/mosd/apid/ui/build.sh`) is a
producer and has deliberately no host route, because a host bun produces
different chunk hashes than the pinned one. The bun that runs a test suite
(`verify/run.sh`, `build/run.sh`, `pkgs/mosd/tests/apid-api/spec-pins.sh`) is a
judge, keeps its announced host route, and CI installs no bun at all so the
pinned container is what every push exercises.

### 0.2 Why — six measurements, not a principle

1. **e2fsprogs.** The layouts ask for `-O ^orphan_file` and `-E hash_seed`, and
   an e2fsprogs older than 1.47 *silently cannot* write them. This host carries
   `mke2fs 1.46.5 (30-Dec-2021)` (*measured 2026-09-04*), which is the reason
   the seeded-times step has always run container-side.
2. **Which package provided the tool decides bytes.** `build/src/toolsets.ts`:
   "which package provided mkfs.vfat or mksquashfs is exactly the kind of thing
   that decides bytes". `BOOTX64.EFI` is only as reproducible as the
   `grub-efi-amd64-bin` in its container, which is why the two assemblers use
   different base images on purpose.
3. **The apid UI.** A host `bun` produces different chunk hashes than the
   digest-pinned `IMAGE_BUN_1`, so a `dist/` comparison run on the host reports
   a difference that is not there.
4. **This host's `mkfs.vfat` is BusyBox's** (*measured 2026-09-04*).
   `command -v mkfs.vfat` answers `/build/bin/busybox/mkfs.vfat`, BusyBox
   v1.37.0, whose usage is `mkfs.vfat [-v] [-n LABEL] BLOCKDEV [KBYTES]` and
   which answers `--invariant` — the flag every FAT step in this tree passes —
   with `unrecognized option: invariant`. The presence check that used to guard
   the host route was `command -v`, and it says yes to that binary. The route
   was not taken here only because `sgdisk` and `mcopy` are missing too: the
   check that would have caught the wrong `mkfs.vfat` is not the one that was
   doing the work.
5. **The host C compiler is not the one this tree pins** (*measured
   2026-09-04*). `gcc --version` here answers
   `gcc (Ubuntu 11.4.0-1ubuntu1~22.04.3) 11.4.0`, while `build-env/c/Dockerfile`
   asserts version floors for the gcc it ships and links a probe program to
   prove it. The same C compiled on the host and in `mos-build-c` is compiled by
   two different compilers, and nothing in a build log would say which.
6. **The largest host toolchain here is one a script goes looking for**
   (*measured 2026-09-04*). `command -v cargo` on the default PATH answers
   nothing. The whole rustup toolchain — cargo, `rustc 1.98.0`,
   `cargo-clippy 0.1.98`, cargo-nextest, cargo-deny, rustfmt — lives under
   `/root/.cargo/bin`, and is reachable only because `pkgs/mosd/hack/check.sh`
   line 8 and `pkgs/rauc-sign/hack/check.sh` line 13 put it in front of PATH.
   The gate runs, and it ran green today: it is a working gate standing on an
   unpinned host toolchain, which is a different thing from a broken one.

### 0.3 What is exempt today, and why

An exemption is allowed. An unexamined path is not. Each row below is
registered in `tests/host-toolchain-exemptions` with its reason, and the check
**fails when a rule there matches nothing** — so a renamed file cannot leave a
waiver behind, and a path that stops violating the policy cannot keep one.

| Site | Tool | Why it is still on the host |
| --- | --- | --- |
| `pkgs/mosd/hack/check.sh`, `pkgs/rauc-sign/hack/check.sh` | `cargo` | The Rust gate, and the one path with **no container today**: `localhost/mos-build-rust` ships cargo and rustc only, and rustfmt, clippy, cargo-nextest and cargo-deny come from `/srv/mos-rust-tools`, a host directory pinned by nothing. A derived image is being built; these two come off the register when it lands. |
| `.github/workflows/check.yml` | `cargo` | The runner that runs those two. It installs a toolchain with `rustup` and cannot move before the image exists. |
| `pkgs/rauc/gen-dev-keys.sh` | `openssl` (and `jq`) | A producer: the CA, the signer certificate and the Ed25519 root key it writes are baked into `meta/` and into every image, and its `jq` edits `meta/updates/manifest.json`, which reaches the image too. Closing it needs a pinned openssl image and the trust tests re-run. `jq` is not in the check's table — it is orchestration everywhere else here, and a row for it would flag fixture edits that are verdicts — so this is the one producing use of it and it moves with this row. |
| `rootfs/build.sh` | `openssl` | A judge: `alg_of_material()` reads a certificate or key and reports its algorithm; nothing it writes survives. It parses openssl's own text output, which is version-sensitive, so the container is still worth having. |
| `tests/repart-loader-test.sh` | `sgdisk` | A judge: five host reads of an assembled image's partition table, beside a container-side half that is already declared. |

Flashing is not a build. `boards/cx3576/bsp/Makefile`'s `rkdeveloptool` targets
write to a board over USB and need the host's bus; they are orchestration by
§0.1 and are not exempted, because they never were in scope.

### 0.4 What enforces it

`make os-host-toolchain-lint` (`tests/host-toolchain-lint.sh`) scans every
tracked shell script, `Makefile` and CI workflow for **two shapes**: a producer
binary in command position, and a `PATH` assignment that prepends a directory
under `$HOME`. The second is there because the first nearly missed measurement
6 — a toolchain a script reaches for is still a host toolchain, and a worse one,
since nothing pins it. Dockerfiles are not scanned — they *are* containers. A
file or a block that runs inside an image says so at the site:

```sh
# mos-build-side: container -- <why>          the whole file runs in an image
# mos-build-side: container-block -- <why>    the lines below do
# mos-build-side: host                        ...and here they stop
```

It cannot see a binary invoked through a variable, a producer written into a
heredoc body, a declaration that is simply wrong, or whether the criterion at
the top of this section still holds — that one is an experiment somebody runs.
Its header says so at greater length, and `tests/host-toolchain-lint-test.sh`
plants a host invocation, a `$HOME` PATH prepend, a stale exemption, a removed
declaration, an unclosed block and a heredoc named in a comment, and requires
each to turn it red — and three legitimate shapes, which it requires to stay
green.

## 1. What a build produces

A board build ends with three artifacts under `_out/<board>/`:

| Artifact | Made by | What it is |
|---|---|---|
| `<board>-mos-<epoch>.img` and `<board>-mos-latest.img` | `bash build/run.sh --mkimage-cx3576` (cx3576) or `--mkimage-x64` | the whole-disk A/B image to flash |
| `rootfs-verity.img` + `rootfs-verity.env` | `rootfs/build.sh` | one rootfs slot: squashfs with its dm-verity tree, and the parameters the kernel command line needs |
| the RAUC bundle | `bash build/run.sh --bundle --board <board>` | the signed update for a device already running mos |

The image names are read from the board definition (`IMAGE_NAME_PREFIX`,
`IMAGE_LATEST_NAME` in `boards/<board>/board.env`), never spelled in a
script.

Before the rootfs can be built, **one** input must exist: the local Debian
package pool under `_out/debs/<arch>/`, which `make os-debs` builds and indexes.
The rootfs build installs out of that pool and compiles nothing, so a pool that
is absent, unindexed, indexed against different bytes, or stamped at another
commit is a refusal naming `make os-debs` — not a build that quietly takes
longer and then installs some other tree's packages.

The compiled components are inputs to the **producers** that pack them, one
step further out:

| Input | Built by | Lands in |
|---|---|---|
| builder images `localhost/mos-build-{base,c,go,rust}:<arch>` | `build-env/build.sh` | the local docker image store |
| APID built-in UI asset tree | `pkgs/mosd/apid/ui/build.sh`, invoked before every repository-owned APID Cargo build in the pinned Bun container with read-only source | ignored `_out/apid-ui/dist/`, mounted read-only into the Rust builder, supplied to `apid/build.rs` and embedded in the binary |
| RAUC | `pkgs/rauc/build.sh`, driven by the `rauc` producer's `PREPARE` hook | `pkgs/rauc/out-<arch>/`, packed as `mos-rauc` |
| podman and its six companions | `pkgs/podman/build.sh`, driven by the `podman` producer's hook | `pkgs/podman/out-<arch>/`, packed as `mos-podman` |
| mosd, apid, mos-mqttd, mos-mqtt-broker | `pkgs/mosd/hack/build-deb.sh`, driven by the `mosd` and `mqtt` producers | `target-deb/<producer>/`, packed as `mosd`, `mos-apid`, `mos-mqttd`, `mos-mqtt-broker` |
| rauc-update, rauc-verify | `pkgs/rauc-sign/hack/build-deb.sh`, driven by the `rauc-update` producer's hook | `target-deb/rauc-update/`, packed as `mos-rauc-update` |

A producer whose hook can build its own input does so rather than stopping, and
that is a cost worth paying where it can be seen: `make os-deb-preflight` lists
every missing input across every producer at once, before `os-debs` starts a
container, and says which of them the run would build for itself.

Both boards additionally need a BSP build. cx3576's produces the kernel
(`Image`, `modules.tar`, `rk3576-src.dtb`) and the A/B U-Boot
(`u-boot-rockchip.bin`) into `boards/cx3576/bsp/out/`, and the `board-cx3576`
producer stages them into `mos-board-cx3576`. x64's produces a kernel and
nothing else — UEFI firmware is its boot chain, so there is no bootloader to
compile — into `boards/x64/bsp/out/kernel/`, and the `kernel-x64` producer
packages it as `mos-kernel-x64`. Neither pool can be completed without them,
and `make os-deb-preflight` names whichever is missing before anything runs.

Output directories carry the architecture in their name (`out-amd64`,
`out-arm64`, `:amd64`, `:arm64`) so the two boards' inputs coexist. A build
for one board never overwrites the other's.

### 1.1 The rootfs is composed, not chained

The root is not a sequence of Dockerfiles mutating one image in a fixed order.
It is **one APT transaction** onto a Debian base pinned by digest in
`build-env/images.env`, followed by **one finalizer**. `rootfs/compose/`
holds exactly those two files:

| File | What it does |
|---|---|
| `10-compose.Dockerfile` | `FROM` the pinned trixie base at `$TARGETPLATFORM`; installs the resolved package set out of `_out/debs/<arch>/` in a single `apt` transaction. The pool is bind-mounted and the resolution is copied in; the Dockerfile makes no selection of its own |
| `90-pack.Dockerfile` | closes the root (inventory, package-manager log capture, purge, build report), does the `/var`, machine-id, resolver and shadow tree surgery, runs the whole-tree assertions, builds the squashfs, appends the dm-verity tree, and exports both surfaces |

What used to be a floor stage, a read-only-root wiring stage, four feature
stages and a board stage is package metadata now: `mos-system`, `mos-ca-trust`,
one of `mos-profile-{dev,prod}`, `mos-wifi`, `mos-wifi-ap`, `mos-bluetooth`,
`mos-podman`, `mos-rauc`, `mos-rauc-update`, `mosd`, `mos-apid`, `mos-mqttd`,
`mos-mqtt-broker`, and one `mos-board-<board>`. **What orders configuration is `Depends`, not a
number in a filename** — and one apt transaction is atomic by construction, so
there is nothing left for a stage boundary to sit between.

`build/src/stages-cli.ts` still sequences the two files, unchanged: it
discovers `<number>-<name>.Dockerfile` in the directory it is pointed at, builds
them in numeric order, hands each the previous one's image, and exports the
last one's `artifact` and `factory-root` targets. It knows nothing about which
directory it was given, which is why composition needed no second driver.

**Selection is a resolution.** `rootfs/packages/resolve.sh` takes the board,
the profile, the radio set and the decline list as arguments and prints package
names; `rootfs/build.sh` decides all four and the resolver re-derives
none of them. A declined feature is *fewer packages named* —
`MOS_ROOTFS_WITHOUT`, into which `WITH_CONTAINERS=0` and `WITH_MOSD=0` fold —
and a feature name that matches nothing is refused rather than silently
producing the full image.

**The explicit profile selection is the only thing keeping a dev image dev**,
so the resolver **refuses a resolution that does not name exactly one profile
package**. Neither failure is visible downstream: with none, mosd's
case-sensitive `read_profile` fails closed and the image behaves as production
with every gate green; with two, `mos-profile-dev` and `mos-profile-prod`
`Conflict` by name and APT refuses the transaction. The count is taken over the
*resolved set* rather than inferred from `--profile` having picked one manifest,
because any manifest may name a profile package.

**Enablement is package-owned symlink payload.** Nothing on this path calls
`systemctl enable` — not the composer, not a script, not a maintainer script.
Each package ships its own `multi-user.target.wants/` symlinks and declares how
many in its `producer.env` `ENABLEMENT` field. The reasoning came out of the
comparison that retired the chain and outlives it: *an unsanctioned `removed`
means a file the chain shipped and no package owns, and the fix is an owner,
not a stanza.* An absence — "there is deliberately no `ssh.service` link here" —
cannot survive another package's postinst; only payload can.

**Board drop-ins are a derived set, and the tracking is silent.** A board that
must amend a *generic* unit records the amendment as overlay content, and
`mos-board-<board>` ships every `*.d` drop-in directory under that board
overlay's `etc/systemd/system/` rather than naming them one at a time — the
same derivation rule as the repart definitions beside it, and the glob takes
only drop-in directories, never the units themselves. Say the consequence
plainly: **board payload tracks overlay `*.d` content silently.** Adding a
drop-in to a board overlay ships it, with no edit anywhere else and no line in
any diff announcing that a package grew.

#### The keyring is the exception, and it is not the CA trust store

Two seams a reader will conflate unless the text separates them. They were
conflated once during this migration and corrected:

| Seam | Owner | What it decides |
|---|---|---|
| `/etc/ssl/certs/ca-certificates.crt`, the anchors under `/usr/share/ca-certificates`, `/etc/ca-certificates.conf` | `mos-ca-trust` — **package payload** | the **TLS trust store**: which certificate authorities the device believes on an outbound connection |
| `/etc/rauc/keyring.pem` | **not package-owned**; `rootfs/build.sh` stages it from `meta/rauc/ca.cert.pem` | the **RAUC trust root**: whose signed update bundles this device will install |

The keyring is per-build trust material no package may ever carry: a package is
one artifact installed into many images, and the CA an operator put in the
repository-root `meta/rauc/` is a decision about *this* build. So `build.sh`
copies it into the composition context itself, **refuses** one left at
`rootfs/overlay/etc/rauc/keyring.pem` — the overlay is copied wholesale
into every image, so a file there is a trust root nobody chose — and warns when
`meta/GENERATED` beside the material marks it development-grade.
Verify reads the same marker and names the grade in its verdict.

#### Where the two paths differed, the composed one was right

Not a tie the removal broke arbitrarily. Each of these was measured:

- **Account last-change dates.** `10-compose` declares `ARG SOURCE_DATE_EPOCH`,
  so the whole apt transaction runs under it and `useradd` writes `18262`
  (2020-01-01) into the last-change field for `messagebus`, `sshd`,
  `systemd-network` and `systemd-resolve` — in `/etc/shadow-` and
  `/usr/share/factory/etc/shadow`. The chain's postinsts saw the wall clock and
  wrote the build date into a signed root. Measured rather than reasoned: in the
  pinned base, `useradd -r probe` yields `SOURCE_DATE_EPOCH / 86400` when the
  variable is set and today's day-number when it is not.
- **Dependency-scoped libraries.** Declining `rauc` removes a set of
  **packages**, not a set of libraries: `mos-rauc` itself, plus the
  `libjson-glib` packages only its `${shlibs:Depends}` pulls in —
  `libjson-glib-1.0-0`, which in turn `Depends: libjson-glib-1.0-common`. The
  chain installed those unconditionally. A library that arrives with its
  consumer and leaves with it is the dependency system working, so this was
  ruled *record, do not gate*. The condition riding on that ruling is that any
  other component relying on those libraries declares its own dependency, and
  the full root cannot check it — with `mos-rauc` installed every ELF resolves
  whether or not its package said so. `tests/install-closure-gate.sh` builds
  the rauc-declined root for exactly that reason, prints the package set the two
  roots differ by on every run, and reports a run in which `mos-rauc` was the
  only package to leave as an *empty search space* rather than quoting it as a
  proof.
- **Build residue.** `/run/crun` was in the chain's root because the chain
  exercised the container engine during assembly. Nothing a signed root should
  carry, and no package's to own.

The written reasoning behind the removal — every difference judged rather than
assumed, including the ones that were eliminated instead of sanctioned — is
`tests/dual-build-sanctions.md`.

## 2. One-time setup

**Builder images, per architecture.** Every component build is `FROM` a
`localhost/mos-build-*:<arch>` tag, and the tag carries the architecture of the
*target*:

```sh
MOS_BUILD_PLATFORM=linux/amd64 bash build-env/build.sh   # for x64
MOS_BUILD_PLATFORM=linux/arm64 bash build-env/build.sh   # for cx3576
```

`make build-env` builds the host's own family. A family for the other
architecture is a different set of tags, and a component build that finds its
family missing refuses by name (`LOCAL_MOS_BUILD_BASE resolves to
localhost/mos-build-base:amd64, which is not in the local docker image store`)
rather than pulling from a registry called `localhost`.

**The trust root: `meta/rauc/`.** The repository-root `meta/` directory holds
everything a release needs to be configured and signed, and it is gitignored;
`meta/rauc/` is the one place a signing CA enters a build. `build/run.sh
--bundle` signs with `meta/rauc/signer.cert.pem` and `meta/rauc/signer.key.pem`;
`rootfs/build.sh` stages `meta/rauc/ca.cert.pem` into the image at
`/etc/rauc/keyring.pem`, which is what lets an image install the bundles built
beside it.

Only the files the allowlist in `rootfs/build.sh` names leave `meta/` for the
image: that certificate and `meta/updates/manifest.json`, both required, and
`meta/GENERATED` conditionally — staged if and only if it is there, so the
image says whether the material it was built from is development-grade. Every
private key stays on the build host, and two checks hold it — the build refuses
to stage anything off the allowlist or anything carrying private key material,
and the image verifier refuses an assembled image that contains one however it
got there, and refuses one whose marker disagrees with the tree's in either
direction.

Nothing has to be run first. A build that finds `meta/` absent — or missing any
of the four RAUC files — generates a development-grade trust root there, prints
a loud notice, and carries on. `make os-devkeys` does the same on purpose, ahead
of a build; `bash pkgs/rauc/gen-dev-keys.sh --force` rotates it, at the cost of
every bundle already signed with the old key. The package signing key is the
other domain and is **opt-in**: `bash pkgs/rauc/gen-dev-keys.sh --domain
updates`, because a development key no published repository has signed anything
with anchors nothing.

The signature algorithm of every key the generator mints is a declared value in
`pkgs/rauc/key-algorithms.env`, with the reason beside each; `rootfs/build.sh`
refuses a declared value outside its role's allowed set, and refuses material in
`meta/` outside it. Changing an algorithm is a one-line edit to that file;
widening a set is a code change and a claim about a verifier.

The generator leaves `meta/GENERATED` beside the material naming the domains it
wrote, and that marker is what distinguishes generated material from provided
production material on every later build, not only on the one that made it.
`rootfs/build.sh` keys its "this image trusts a DEVELOPMENT RAUC keyring"
warning off it, and nothing else: there is no build-time variable that declares
a bench image. A production release puts real material in `meta/` and does not
carry the marker.

Two rules do not change. `CERT`/`KEY`/`KEYRING` still beat the convention for
the bundle step — with all three set, nothing is generated and nothing in
`meta/rauc/` is read. And a keyring left at
`rootfs/overlay/etc/rauc/keyring.pem` is still refused, now unconditionally: the
overlay is copied wholesale into every image, so a file there is a CA nobody
chose, and `meta/rauc/` is the one sanctioned source. Since every image now
ships a keyring, `make os-verify-<board>` passes on either grade of material and
names in its verdict which one it read.

The keyring is the one path in a mos root that is **not** package payload, and
it is a different seam from the TLS trust store `mos-ca-trust` ships — §1.1 has
the two side by side.

## 3. x64, end to end

Every step runs natively on an amd64 host. In order:

```sh
MOS_BUILD_PLATFORM=linux/amd64 bash build-env/build.sh
bash pkgs/rauc/gen-dev-keys.sh   # optional: a build with no meta/ does this itself
MOS_BOARD=x64 bash pkgs/rauc/build.sh
MOS_ARCH=amd64 bash pkgs/podman/build.sh
make os-debs                                   # the package pool, then its index
MOS_BOARD=x64 bash rootfs/build.sh       # == make os-rootfs-x64-composed
bash build/run.sh --mkimage-x64
bash verify/run.sh --verify --board x64
bash build/run.sh --bundle --board x64
```

`make` spellings exist for most of them (`make os-rauc`, `make podman`,
`make os-verify-cx3576`), but their defaults are cx3576 and arm64, so for
x64 the environment variable is not optional. The rootfs build ends with a
smoke run that executes the freshly built binaries inside the packed root;
on x64 that is a native `docker run`, so nothing extra is needed.

The two component builds above the pool are optional in the sense that the
`rauc` and `podman` producers run them from their own `PREPARE` hooks if their
output directories are empty — but podman's is roughly three quarters of an hour
of compiling six upstream clones across four language toolchains, so running it
first is how that cost is paid somewhere it can be seen rather than from inside
a packaging hook. `make os-debs` must run **after** them and **before** the
rootfs build: `build.sh` refuses a pool whose one version is not this tree's,
including the `.dirty` suffix an uncommitted change puts on either side.

Boot the result with the QEMU harness under `pkgs/mosd/tests/apid-api/`,
which takes `_out/x64/x64-mos-latest.img` as its input and builds nothing.

## 4. cx3576: what crosses, what emulates, what needs the host

An amd64 host reaches arm64 three different ways, and each step below uses
exactly one of them:

- **cross-compile** — the compiler runs at the host's architecture and emits
  arm64 code. Needs nothing beyond docker.
- **emulate inside buildkit** — a `docker-container` builder whose buildkit
  image bundles QEMU runs arm64 `RUN` steps. Needs nothing on the host either;
  the builder is created on first use as `mos-arm64`.
- **emulate in the daemon** — `docker run --platform linux/arm64` and the
  `default` buildx builder execute arm64 through the host kernel's
  `binfmt_misc`. Needs a one-time registration **on the host**.

| Step | Command | Route | Host binfmt |
|---|---|---|---|
| arm64 builder family | `MOS_BUILD_PLATFORM=linux/arm64 bash build-env/build.sh` | emulate inside buildkit | no |
| U-Boot, both variants | `make cx3576-uboot cx3576-uboot-mos` | cross-compile (`CROSS_COMPILE=aarch64-linux-gnu-` in an amd64 Ubuntu stage); the image takes `uboot-mos`, and the verifier compares it against the debug variant to prove the pairing | no |
| kernel | `make cx3576-kernel` | cross-compile, same toolchain | no |
| RAUC | `make os-rauc` (`MOS_BOARD=cx3576` is the default) | `default` builder if the host has binfmt, else `mos-arm64` with the builder images handed over as OCI layouts | no |
| podman | `make podman` (`MOS_ARCH=arm64` is the default) | as RAUC; its source stage runs at the build platform on the amd64 base | no |
| mosd family | run by the `mosd` and `mqtt` producers via `pkgs/mosd/hack/build-deb.sh` | cross-compile: cargo target `aarch64-unknown-linux-gnu` in `mos-build-rust:amd64` | no |
| the package pool | `make os-debs` | each producer's own route, above; the packing stages themselves are `Architecture`-tagged file copies | no |
| rootfs composition | `bash rootfs/build.sh` (`MOS_BOARD=cx3576` is the default) | `default` builder if the host has binfmt, else `mos-arm64` with the two files linked by OCI layout (section 4.1) | no |
| smoke run | last step of the rootfs build | `docker run` if the daemon can execute arm64, else one throwaway build per artifact on `mos-arm64` | no |
| disk image | `bash build/run.sh --mkimage-cx3576` | file assembly only | no |
| image verification | `make os-verify-cx3576` | reads files out of the image | no |
| bundle | `make os-bundle-cx3576` | `rauc bundle` in an amd64 container | no |

So the whole of cx3576 builds on an amd64 host with no host-level emulation
at all. In order:

```sh
MOS_BUILD_PLATFORM=linux/arm64 bash build-env/build.sh
bash pkgs/rauc/gen-dev-keys.sh   # optional: a build with no meta/ does this itself
make cx3576-uboot cx3576-uboot-mos
make cx3576-kernel
make os-rauc
make podman
make os-debs
bash rootfs/build.sh
bash build/run.sh --mkimage-cx3576
make os-verify-cx3576
make os-bundle-cx3576
```

`BOARD_DIR=/path/to/bsp` points the rootfs build and the assembler at
prebuilt BSP artifacts (a directory holding `out/kernel/` and
`out/uboot-mos/`), so a kernel built once can serve many rootfs builds.

### 4.1 How the rootfs composition reaches arm64 without the host

The composition is two Dockerfiles (§1.1), and the second opens
`FROM ${MOS_STAGE_PREV}`. `build/src/stages-cli.ts` links them one of two
ways, chosen by the builder's driver:

- **tag mode** on the `docker` driver: the first file's result is a tag in the
  daemon's image store and the finalizer's `FROM` finds it there. That driver
  executes arm64 only through the host's `binfmt_misc`, so this is the native
  route and the route on a host that has registered the emulator.
- **layout mode** on a `docker-container` builder: the result is exported as an
  OCI layout under `_out/<board>/stages/` and handed on as a named build
  context under the very tag the `FROM` names. Nothing touches the daemon's
  image store, and the builder's bundled QEMU executes the arm64 steps.

`build.sh` picks the builder the way RAUC and podman do — `default` when it
reaches the platform, else `mos-<arch>` — and the smoke run at the end, when
the daemon cannot execute the root, executes every register entry inside that
builder instead, one throwaway build per artifact, with the same register and
the same judging. Layout mode's cost is one copy of the root's layers over the
docker socket per link, which composition reduced from eight links to one.

Both modes predate the composition and neither is specific to it: the driver
is handed a directory of numbered Dockerfiles and knows nothing else about it.
Before layout mode existed the driver refused any builder but the `docker` one,
so a cross build needed host binfmt. Layout mode restores the container-builder
route without putting a registry in the build path.

## 5. arm64 on an amd64 host: check by executing, never by inspecting

Three questions, three commands, and the answer to one says nothing about the
others. `docker buildx ls` and `docker buildx inspect` under-report on some
hosts — a builder that demonstrably executes arm64 has been seen listed as
`linux/amd64 (+3), linux/386` — so none of these is settled by reading a table.

**Can buildkit emulate?** A throwaway build on the container builder:

```sh
printf 'FROM alpine:3.21\nRUN uname -m\n' | \
  docker buildx build --builder mos-arm64 --platform linux/arm64 --no-cache --progress=plain -
```

`aarch64` in the `RUN` output means RAUC, podman and the arm64 builder family
will build. Create the builder first if `docker buildx ls` does not list it:
`docker buildx create --name mos-arm64 --driver docker-container`.

**Can the daemon execute?** The question tag mode and `docker run` ask; layout
mode and the buildkit smoke executor do not need it:

```sh
docker run --rm --platform linux/arm64 alpine:3.21 uname -m
```

`aarch64` means yes; `exec /bin/uname: exec format error` means no. Run
`docker run --rm alpine:3.21 uname -m` beside it: on a loaded host the
container-create call can time out, and `context canceled` reads like an arm64
verdict when it is a busy daemon.

**Registering emulation on the host** is optional: it makes the rootfs
composition take tag mode on the `default` builder, which is faster than layout
mode. Either
of these, run **on the host**, not inside a container that merely mounts the
docker socket — a registration made from inside a container has been observed
to report success and change nothing the daemon can see:

```sh
# any distribution, through docker itself
docker run --privileged --rm tonistiigi/binfmt --install arm64

# Fedora / RHEL family, persistent across reboots
sudo dnf install -y qemu-user-static
sudo systemctl restart systemd-binfmt
```

Then re-run the daemon check above; the `default` builder's platform list
(`docker buildx inspect default`) gains `linux/arm64` at the same time, which is
the exact test `build.sh` applies. Undo with `--uninstall arm64` or by
removing the package.

**What needs no emulator at all.** Reading bytes out of an arm64 image —
`docker create --platform linux/arm64 ... && docker cp` — works everywhere,
which is why image verification and the bundle build run on any host.

## 6. Reading the failures

| Message | Meaning | Do |
|---|---|---|
| `LOCAL_MOS_BUILD_BASE resolves to localhost/mos-build-base:<arch>, which is not in the local docker image store` | the builder family for that architecture was never built, or was built under an older architecture-less tag | `MOS_BUILD_PLATFORM=linux/<arch> bash build-env/build.sh` |
| `note: the 'default' builder cannot reach linux/arm64 on this host; using the docker-container builder 'mos-arm64'` | not an error: the rootfs composition is taking layout mode | nothing; register emulation on the host (section 5) only if you want the faster tag mode |
| `exec /bin/sh: exec format error` inside a build | either no emulator, **or** a single-architecture `localhost/` base under `--platform` (the tag has no index to select from, so buildkit serves what it holds and applies no emulator) | check the daemon (section 5); if it executes, the stage's base is the wrong architecture — `build-harness.md` section 5.1 |
| `pull access denied ... localhost/...` from a `docker-container` builder | a local tag handed to a builder that cannot read the image store | use the `default` builder, or hand the image over as an OCI layout (`build-env/from.sh --contexts=`) |
| `modules.tar not found` | the cx3576 kernel was not built, or `BOARD_DIR` points elsewhere | `make cx3576-kernel`, or set `BOARD_DIR` |
| `pkgs/rauc/out-<arch>/rauc not found` / `pkgs/podman/out-<arch>/podman not found` | the component was built for the other architecture, or not at all | `MOS_BOARD=<board> make os-rauc`, `MOS_ARCH=<arch> make podman` |
| `_out/debs/<arch> does not exist` / `... holds no .deb at all` / `... carries no usable index` | there is no package pool for that architecture, or `repo.sh` never indexed it | `make os-debs` |
| `the <arch> pool was built at version '...' and this tree is '...'` | the pool is another commit's, or one side carries `.dirty` from uncommitted changes | commit, then `make os-debs` again — composing would install another tree's packages into an image every later check would attribute to this one |
| `the resolution names package(s) the <arch> pool does not contain` | a producer in the resolution was never built for that architecture; the message names the `make os-deb-<producer>` for each | run those, then `make os-debs` to re-index |
| `mqttd: the unit runs as 'mos-mqttd' and no such account` (from the verifier) | the MQTT units are in the root without the account their package creates | look at the `mqtt` producer's account handling. Declining `mosd` while keeping `mqtt` is not this failure: `mos-mqttd` depends on `mosd`, so APT refuses that transaction by name |

A build that stops with one of these has written nothing under
`_out/<board>/` it will later trust: every consumer re-checks its inputs by
name.

## 7. Verification

**These runs predate the chain removal.** Both were made while the rootfs was
still assembled by the nine-file stage chain, so what they establish is the
arm64 routing of section 4 — the builder selection, layout mode and the
buildkit smoke executor — and not the composition of §1.1. They are kept as the
record of that routing; the composed path's own acceptance is PLAN-036's
dual-build gate and the ledger it wrote, `tests/dual-build-sanctions.md`.

*Measured on this host on 2026-08-30 and 2026-08-31.* The x64 sequence of
section 3 was run as written, in one shell, on an amd64 host with docker 28
and no host binfmt. `docker run --rm --platform linux/arm64 alpine:3.21
uname -m` answered `exec /bin/uname: exec format error` on the same host. The
x64 image passed `bash verify/run.sh --verify --board x64` at 292/292
(22 skipped, x64/grub) with a signed RAUC bundle built.

The cx3576 sequence of section 4 has since been run end to end on the same
binfmt-less host, twice on different days, through the layout mode of
section 4.1: the rootfs chain built on the `mos-arm64` builder with every
stage handed over as an OCI layout, the smoke run executed the packed root's
binaries through the buildkit executor and reported
`11 pass, 1 executor-limited (crun), 0 fail` — crun's memfd re-exec is the
emulator's documented limit, reported as its own verdict rather than a pass —
and the assembled image passed `make os-verify-cx3576` at 395/395 with a
signed RAUC bundle built and read back. No tag touched the image store and
no binfmt was registered at any point.

The 394 that run reported before 2026-08-31 was the register without
`verity-hash-start-no-superblock` (§1 of `ro-root.md`). Both counts were green
and only the later one was about an image that boots: the check added that day
is the one that reads what sits AT `hash_start_block`, and the images the 394
runs passed all carried a verity superblock there. Re-run against one of them,
the register reports it as a FAIL quoting the magic it found.
