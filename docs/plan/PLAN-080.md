# PLAN-080 A host with only Docker and git builds and releases an image

- **status**: implementing
- **createdAt**: 2026-09-04 21:30
- **approvedAt**: 2026-09-04 21:30
- **relatedTask**: [RFCT-310](../task/RFCT-310.md)
- **relatedPlans**: [PLAN-074](PLAN-074.md) (the x64 kernel, the last board artifact to move into a container)

## Context

### What this record is for, and what the request approved

The user asked for the tree's global build policy, written down and made
enforceable, and then gave the acceptance criterion it should be written
against:

> **A host with only Docker and git must be able to build and release an image,
> completely.**

That request is the approval for designing it. Sections 1–7 are being
implemented under it; what the enumeration found too large to close here is a
backlog in section 10 and waits at the approval boundary in section 12.

### Why the criterion and not the prohibition

"No toolchain on the host" is the same rule stated as a prohibition, and the
criterion is better in three ways, all of which this record uses:

- **A prohibition is a list of things not to do, and it goes stale.** The
  criterion is a property of the system, and it stays true as producers arrive.
- **It is falsifiable by one experiment**, which section 4 designs and runs.
- **It settles questions a prohibition leaves open.** Whether `run_bun`'s host
  route survives is not a matter of taste under it: the host route may exist as
  a convenience, and the container route must be sufficient on its own.

So the prohibition follows from the criterion rather than the other way round,
and section 2 derives it.

### This is a tightening, not a new idea

`docs/design/build.md` already opened with "no toolchain is installed on the
host, and every compiler comes out of a builder image pinned by digest", and
`docs/zh/design/build.md` said it too. `verify/run.sh` already states the
criterion's intent for its own seam — a host route and a pinned container route,
"which makes a host with no bun a supported host". What was missing is a
boundary that says which side a given tool is on, an experiment that says
whether the claim is true, and anything at all that fails when a path
contradicts it.

### The measurements this rests on

Six, all in the tree or on this host, none of them an opinion.

1. **e2fsprogs.** `build/src/toolsets.ts` records that the layouts ask for
   `-O ^orphan_file` and `-E hash_seed`, that an e2fsprogs older than 1.47
   "silently cannot", and that this host's 1.46.5 "is the measured reason
   `pin_seeded_times` has always run container-side". Re-measured 2026-09-04:
   `mke2fs 1.46.5 (30-Dec-2021)`.

2. **Which package provided the tool decides bytes.** The same file: "which
   package provided mkfs.vfat or mksquashfs is exactly the kind of thing that
   decides bytes", and the x64 assembly contract's note that `BOOTX64.EFI` is
   only as reproducible as the `grub-efi-amd64-bin` in its container.

3. **The apid UI.** A host `bun` produces different chunk hashes than the
   digest-pinned `IMAGE_BUN_1`. Host bun is 1.4.0 at `/srv/bkd/runtime/bun`;
   the pin is `oven/bun:1@sha256:5ff6…`.

4. **This host's `mkfs.vfat` is BusyBox's** (*measured 2026-09-04*).
   `command -v mkfs.vfat` answers `/build/bin/busybox/mkfs.vfat`, BusyBox
   v1.37.0, whose whole usage is `mkfs.vfat [-v] [-n LABEL] BLOCKDEV [KBYTES]`
   and which answers `--invariant` — the flag every FAT step here passes — with
   `unrecognized option: invariant`. The guard in front of `build/src/toolbox.ts`'s
   host route was `command -v`, which says yes to it. The route was not taken
   here only because `sgdisk` and `mcopy` are missing too: the check that would
   have caught the wrong `mkfs.vfat` is not the one doing the work.

5. **The host C compiler is not the one the tree pins** (*measured 2026-09-04*).
   `gcc --version` on this host answers
   `gcc (Ubuntu 11.4.0-1ubuntu1~22.04.3) 11.4.0`, while `build-env/c/Dockerfile`
   asserts version FLOORS for the gcc it ships and links a probe program to
   prove it. The same C compiled here and in `mos-build-c` is compiled by two
   different compilers, and nothing in a build log would say which.

6. **The largest host toolchain in the tree is one a script goes looking for**
   (*measured 2026-09-04*). `command -v cargo` on this container's default PATH
   answers nothing. The whole rustup toolchain — cargo, `rustc 1.98.0`,
   `cargo-clippy 0.1.98`, cargo-nextest, cargo-deny, rustfmt, miri, audit —
   lives under `/root/.cargo/bin`, and it is reachable only because
   `pkgs/mosd/hack/check.sh` line 8 and `pkgs/rauc-sign/hack/check.sh` line 13
   put it in front of PATH. A toolchain a script reaches for is a different
   finding shape from one lying around, and section 6 makes the check see both.

And a seventh the tree already carries for compilers, in
`docs/design/build-harness.md` §3: with a 1.96 toolchain ahead of the image's
1.98 on PATH, the gate's own clippy line reported
`error[E0463]: can't find crate for 'std'` against a workspace that was fine.

### Two corrections carried from the dispatch

- `pkgs/mosd/hack/check.sh` **exists** — 24 lines — and is the clearest
  host-toolchain path in the repository.
- It is **not a broken gate**. It runs, and it ran green today: a release audit
  took it to `ALL CHECKS PASSED` on that host toolchain. The Rust case is a
  *working gate standing on the thing the criterion forbids*, and the rest of
  the enumeration looks the same way — mostly working, some of it working for
  the wrong reason.

## 1. The criterion, and what a bare host actually is

> **A host with only Docker and git must be able to build and release an image,
> completely.**

The experiment in section 4 ran that sentence literally and it failed at the
first command, for a reason worth writing down rather than papering over: the
tree's entry points are `make` and `bash`, and a host with only Docker and git
has neither. So the criterion needs its permitted set stated, and here it is,
measured rather than guessed — this is exactly what the experiment needed and
nothing more:

| Permitted on the host | Why |
| --- | --- |
| `docker` (with a reachable daemon) | the criterion names it; everything else runs inside what it starts |
| `git` | the criterion names it; the file list every gate reads comes from `git ls-files` |
| `bash` | every entry point in the tree is a bash script, and bash produces no byte of any artefact |
| `make` | the target names *are* the build's interface, and a recipe only decides which script runs |
| a busybox userland — `sh`, `awk`, `sed`, `grep`, `sha256sum`, `tar` | the scripts' own arithmetic. `sha256sum` writes bytes that ship and cannot write different ones; the rest produce nothing |

**The `make` ruling, explicitly, because a policy whose own entry point violates
it is the failure this repository has already produced once.** `make` and `bash`
are **orchestration** by the boundary test in section 3: neither can change a
byte of a shipped artefact, and both only decide which container runs. They join
the permitted set, written down here rather than implied. The alternative — a
`docker run` one-liner as the entry point — was considered and rejected in
section 11: it moves the orchestration into an image, and that image has to be
built by something on the host.

Everything else is a finding. Nothing in the build may require host `bun`, host
`node`, host `python3`, host `go`, host `gcc`, host `cargo`, or any filesystem
or image tool.

## 2. The rule that follows

> **No toolchain on the host. No compilation on the host. No assembly on the
> host.**

It is the criterion restated as an instruction, and it is the form a
contributor meets in `docs/design/build.md` §0. Where the two seem to disagree,
the criterion decides — because it is the one that can be run.

## 3. The boundary, as a test rather than a list

A list of banned binaries goes stale the first time someone reaches for one
that is not on it. The boundary is one question, asked of the tool:

> **If this exact input were handed to a different build of this tool, could the
> run's output differ?**

| Answer | The tool is a… | Where it runs |
| --- | --- | --- |
| Yes, and the output is a byte that survives the run — an image, a package, a bundle, `dist/`, `out-<arch>/`, a signature, a recorded config | **producer** | In a container, pinned by digest. No probe, no host route, no fallback. |
| Yes, and the output is a verdict — a pass or a fail somebody reads | **judge** | The pinned container is the *contract*: it is what CI runs and what a result is quoted from. A host route may exist as a convenience, and **the container route must be sufficient on its own**. |
| No — the output is fixed by the input alone (`sha256sum`, `cmp`, `git rev-parse`), or the tool produces nothing and only decides which container runs (`docker`, `make`, `bash`, `jq`, `curl`) | **orchestration** | On the host, by section 1. |

Two consequences, because both have been argued the other way:

**Compilation is a producer even when the binary is discarded.** `cargo clippy
--workspace -- -D warnings` keeps no artefact and its verdict is still decided
by the toolchain; measurement 7 is that failure. A compiler is never a judge.

**A digest is not a producer.** `sha256sum` writes a byte that ships and no
build of it can write a different one. The question is about the tool's
freedom, not about whether the byte survives.

### 3.1 The bun and node ruling, settled by the criterion

The brief left this open and asked for a decision. Under section 1 it is
determined rather than chosen: **the host route may exist, and the container
route must be sufficient on its own.** Applied:

| bun caller | writes | today | verdict |
| --- | --- | --- | --- |
| `pkgs/mosd/apid/ui/build.sh` | `_out/apid-ui/dist`, embedded in the apid binary | pinned container only, no host route and no override | producer — correct, and must not gain one |
| `verify/run.sh` | a suite verdict | host bun or `IMAGE_BUN_1`, announced | judge — host route kept; **§4 rung 3 proves the container route sufficient** |
| `build/run.sh` | a suite verdict, and it drives the assemblers | same seam | judge — host route kept; the container route was **not** sufficient, and §4 says why and closes it |
| `pkgs/mosd/tests/apid-api/spec-pins.sh` | a comparison verdict | same seam | judge — host route kept |

`node` appears nowhere in a build path: the apid UI's toolchain is bun's, inside
the pinned image. The host's `node v24.19.0` is not reached by anything here.

## 4. The experiment

Not a simulation. A container, the tree's own pinned one, a clone, and the
transcript in the order it happened.

### 4.1 The substrate, which the tree already pins

`IMAGE_DOCKER_CLI_28` = `docker:28-cli@sha256:625d9431a9f5…` **is** the
criterion's host, which is a piece of luck worth using: measured inside it,

    sh /bin/sh          git /usr/bin/git     docker /usr/local/bin/docker
    awk sed grep sha256sum tar   (busybox)
    bash - make - jq - curl - xz - python3 - node - bun - go - gcc - cargo - perl -

An independent `git clone` of this branch was mounted at its own path together
with `/var/run/docker.sock`, and every rung below ran inside that container.

### 4.2 The ladder

| Rung | Command | Result |
| --- | --- | --- |
| **0** docker + git | `docker version` | `Server 29.7.2` — the daemon answers |
| | `git rev-parse HEAD`, `git ls-files \| wc -l` | `0b4be1a5`, `1095` |
| | `make docs-verify` | **`sh: make: not found`** |
| | `bash docs/verify-index.sh` | **`sh: bash: not found`** |
| **1** + bash | `bash docs/verify-index.sh` | `183/183 PASS` |
| | `make docs-verify` | still `make: not found` |
| **2** + make | `make docs-verify` | all five gates green |
| **3** | `make os-layout-lint` | `RESULT: PASS (28/28 checks)` — bun from the pinned container |
| | `make os-verify-test` | `RESULT: PASS (1270/1270 tests)` in 13.20 s, no bun on the host |
| **4** | `bash build/run.sh --mkimage-x64` | **FAILED.** See 4.3 |
| **4′** after the fix | `bash build/run.sh --mkimage-x64` | image assembled, 1938 MiB, verity root hash `db388c98…` |
| | `bash verify/run.sh --verify --board x64` | **`RESULT: PASS (313/313 checks, 22 skipped)`** |

Rungs 0–2 are the `make` ruling, taken rather than argued: a host with literally
only Docker and git runs nothing in this tree, and the smallest addition that
changes that is bash and make.

Rung 4′ was then repeated on this machine, which takes the *host* bun route
through the same code, and produced the same verity root hash `db388c98…` and
the same `RESULT: PASS (313/313 checks, 22 skipped)`. Two routes, one image.

### 4.3 What rung 4 found, and it is not a small thing

`bash build/run.sh --mkimage-x64` failed with

    error: the docker client works on this host but not inside the pinned bun container.
           /usr/local/bin/docker and /var/run/docker.sock are both mounted; the daemon
           still would not answer.

The cause is not the socket. `build/run.sh` passed its own client into the
pinned bun container with `-v "${DOCKER}:${DOCKER}:ro"` — and a sibling
container's `-v` **source is resolved by the daemon**, against the daemon's
filesystem, not by the process asking. On this host the client is
`/usr/local/bin/docker`; the daemon's host has no such path; docker therefore
created an **empty directory** there and mounted it.

The preflight immediately above it exists to catch exactly "the mount that
succeeded and delivered nothing", and it could not see this one: it tests
`[ -e "$f" ]`, and `-e` is true for a directory. So is `-x`, because the execute
bit on a directory means traversable. Both plausible tests pass on the empty
directory, and the failure surfaces one step later as a sentence about the
daemon.

Two things follow, and both are in this task:

- **It is a latent bug for any host whose docker client is not at the same path
  inside and outside**, which is every host that is itself a container. It was
  invisible because this campaign's host has bun, so the container route was
  never taken here.
- **The fix was already in the tree.** `verify/run.sh` does not mount a client;
  it builds `verify/Dockerfile` — two pinned `FROM`s and one `COPY` — and runs
  the pinned client. `build/run.sh` now does the same, with the same build
  arguments and the same tag stamp, so the two share one image and one cache.
  Which docker client the assemblers drive is a recorded digest now instead of
  whatever the host had.

### 4.4 The one thing a bare host still cannot do

`bash build/run.sh --build-rootfs` — the rootfs composition — refuses on the
container route, because it drives `docker buildx` once per stage and buildx is
a **CLI plugin**, not a subcommand: `verify/Dockerfile` copies
`/usr/local/bin/docker` and not the plugin beside it, so the container answers
`docker: unknown command: docker buildx`.

*Measured 2026-09-04:* `IMAGE_DOCKER_CLI_28` **does ship** buildx —
`github.com/docker/buildx v0.29.1` in `/usr/local/libexec/docker/cli-plugins`.
So this is one more `COPY` from a pin the tree already has, with no host binary
and no second pin. It is **not done here**, because lifting that refusal is a
claim about composing a root and a claim like that is worth only the run that
proves it — and that run needs the amd64 package pool. Backlog **B5**, and the
refusal names the gap until then.

So the honest state of the criterion: **a host with docker, git, bash, make and
a busybox userland can assemble and verify an image, proven end to end; it
cannot yet compose the rootfs, and the reason is one COPY and one proof run.**

## 5. The enumeration

### 5.1 How it was taken

Five passes, because no single one sees everything:

1. `git grep -n 'command -v' -- '*.sh' '*.ts'` — every host-binary probe: 50
   lines match, 16 of them probing for `docker` itself.
2. A 34-binary command-position scan over `git ls-files '*.sh' Makefile
   '*/Makefile' '.github/workflows/*.yml'`, eliding comments, heredoc bodies,
   `case` labels and `echo` arguments: **63 lines in 22 files**. Dockerfiles are
   not scanned — they *are* containers.
3. A scan for the second shape, added after measurement 6: a PATH assignment
   prepending a directory under `$HOME`. **2 lines**, both `hack/check.sh`.
4. Hand-classification of all 65 against each file's own execution context.
5. **Every producer named and its container invocation read**, in 5.2 — the
   part that cannot be done by grep, because "already complies" is a claim and
   an unlooked-at claim is the one that survives.

Passes 2 and 3 are reproduced exactly by `tests/host-toolchain-lint.sh`, whose
RESULT line is the enumeration in one sentence:

    RESULT: PASS (96/96 files clean, 0 finding(s), 9072 command lines examined,
    3073 elided, 6 file + 7 block container declarations, 29 exempted
    invocation(s) under 8 rule(s))

### 5.2 Every producer, and how each was verified

Not assumed. Each row was opened and the invocation read; the evidence column is
the line that runs the container.

| Producer | Builds | Verified at |
| --- | --- | --- |
| `build-env/build.sh` | `localhost/mos-build-{base,c,deb,go,rust}:<arch>` | `docker buildx build "${BUILDER_ARGS[@]}"`, line 538 |
| `build-env/deb/build.sh` | one producer's `.deb`, per architecture | `docker buildx build --builder "${BUILDER}"`, line 448 |
| `build-env/deb/pack.sh` | the archive itself, `dpkg-deb --build` | runs *inside* `localhost/mos-build-deb:<arch>` from a producer Dockerfile's `RUN`; its own header says so and it checks the container architecture rather than trusting it |
| `build-env/deb/repo.sh` | `Packages`, `SHA256SUMS`, `manifest.txt` | `docker run --rm`, line 105 |
| `boards/cx3576/bsp` | U-Boot, kernel, vendor rootfs, debug image | `docker buildx build -f uboot/Dockerfile`, line 37, and one per target |
| `boards/x64/bsp` | kernel, and the recorded kernel config | `docker buildx build --build-context mos-common=…`, line 31 |
| `pkgs/podman/build.sh` | podman and its six companions | `docker buildx build "${BUILDER_ARGS[@]}"`, line 260 |
| `pkgs/rauc/build.sh` | the shipped rauc | `docker buildx build "${BUILDER_ARGS[@]}"`, line 159 |
| `pkgs/mosd/hack/build-target.sh` | mosd, apid, mos-mqttd, mos-mqtt-broker | `docker run --rm … "${IMAGE}" -c 'cargo build …'`, line 166 |
| `pkgs/mosd/hack/build-deb.sh` | the same, staged for packing | `docker run --rm`, line 180 |
| `pkgs/mosd/hack/build-aarch64.sh` | — | `exec bash build-target.sh aarch64-unknown-linux-gnu aarch64`; it is a name, not a second path |
| `pkgs/rauc-sign/hack/build-deb.sh` | rauc-update, rauc-verify | `docker run --rm`, line 161 |
| `pkgs/mosd/apid/ui/build.sh` | `_out/apid-ui/dist` | `docker run --rm … "${image}"`, line 57, source mounted read-only, no host route at all |
| `rootfs/build.sh` | the composed root, squashfs + verity | delegates at line 1039 to `build/run.sh --build-rootfs`, which is `src/stages.ts` driving `docker buildx build` per stage |
| `build/run.sh --mkimage-cx3576` / `--mkimage-x64` | the A/B disk image | `Toolbox.open`, container-only since this plan; **proven on a bare host in §4** |
| `build/run.sh --bundle` | the signed RAUC bundle | the same toolbox, with the shipped rauc carried in by `docker cp` |
| `build/run.sh --release assemble` | the release directory | reads and hashes what the above produced; no producer of its own |

**Seventeen producers, sixteen of them already building in containers, verified
by reading the invocation rather than by assuming it.** That sentence is
load-bearing: this policy is a tightening of practice, not a demand for a
rewrite. The seventeenth is the Rust gate, which is 5.4.

Text and staging, checked and found to compile nothing and assemble nothing:
`pkgs/rauc/render-config.sh`, `pkgs/podman/versions-stamp.sh`,
`boards/*/deb/*/render.sh`, `boards/x64/deb/kernel-x64/stage.sh`, and the
`pkgs/*/deb/*/prepare.sh` hooks, which call the build scripts above.

### 5.3 Already container-side, and now declared — 36 lines in 13 files

Each runs inside an image today, either because the whole script does or
because the line is an argument to a `docker run`. Each now says so at the site
with `# mos-build-side: container -- <reason>`, which is what the check reads:
`build-env/deb/pack.sh` (8), `build-env/deb/repo.sh` (6),
`pkgs/mosd/apid/ui/build.sh` (5), the three Rust `build-*.sh` (1 each),
`rootfs/scripts/pack-{squashfs,assert-privileged,verity}.sh` (1 each),
`tests/factory-root-gate/inner.sh` (1),
`tests/handshake-test/harness.sh` (3), `tools/qemu-seed-state.sh` (6), and one
block in `tests/repart-loader-test.sh` (1).

### 5.4 Closed by this task — 4 seams

| Seam | Today | Becomes |
| --- | --- | --- |
| `build/src/toolbox.ts` | measured the host, took the host route when every tool was present | **container unconditionally.** Every toolset it opens is a producer. `MOS_BUILD_TOOLBOX=host` and `route: 'host'` are **refusals** naming the policy rather than values being ignored |
| `build/src/toolsets.ts` | `mke2fsCanWriteTheseLayouts`, the host capability probe | **removed** with the route it guarded; its measurement is preserved in `docs/design/build.md` §0 |
| `verify/src/tools.ts` | preferred the host when it had sgdisk/mtools/debugfs/unsquashfs/veritysetup | **container by default whatever the host carries**; `MOS_VERIFY_TOOLS=host` is the announced opt-out. The verifier's tools are judges, and this makes the pin the contract rather than the fallback |
| `build/run.sh` | mounted the host's docker client into the pinned bun image | **uses the pinned client**, via `verify/Dockerfile` with the same stamp. §4.3 is why; it is the gap the criterion found and the prohibition would not have |

### 5.5 Exempted with its reason — 29 invocations under 8 rules

An exemption is allowed; an unexamined path is not. Each is registered in
`tests/host-toolchain-exemptions`, and **an exemption that matches no line is a
failure**, so a rename cannot leave a waiver behind and a fixed path cannot keep
one.

| Site | Tool | Why exempt, and what closes it |
| --- | --- | --- |
| `pkgs/mosd/hack/check.sh` | `cargo` (5) + `host-toolchain-on-PATH` | The Rust gate. Its container **now exists** — see below — so what keeps the row is CI, which still runs the same script on the runner. A script cannot be declared container-side while one of its two callers is a bare host. Backlog **B7** |
| `pkgs/rauc-sign/hack/check.sh` | `cargo` (5) + `host-toolchain-on-PATH` | The same gate over the second workspace, here for B7's reason and not for a missing image |
| `.github/workflows/check.yml` | `cargo` (3) | The runner that runs those two: it `curl`s rustup onto the host, which is a host toolchain whoever owns the host. Backlog **B7** |
| `pkgs/rauc/gen-dev-keys.sh` | `openssl` (6) | A producer: the CA, the signer certificate and the Ed25519 root key it writes are baked into `meta/` and into every image. Its host `jq`, which edits `meta/updates/manifest.json`, is the same story and travels with it. Backlog **B2** |
| `rootfs/build.sh` | `openssl` (3) | A judge: `alg_of_material()` reads a certificate or key and reports its algorithm. It parses openssl's own text output, which is version-sensitive. Backlog **B3** |
| `tests/repart-loader-test.sh` | `sgdisk` (5) | A judge: five host reads of an assembled image's partition table, beside a container-side half already declared. Backlog **B3** |

**RFCT-309 landed while this record was being written, and it changes two of
those rows.** `tests/rust-gate.sh` and `make os-rust-gate` run
`pkgs/<ws>/hack/check.sh` **unmodified** inside
`localhost/mos-build-rust-check`, both workspaces — which is more than its brief
named, and is the second half this plan asked for in §5.5. So the Rust gate is
no longer "a path with no container": the image exists and the local route uses
it. What is left is CI, which still installs rustup on the runner and runs the
two scripts there, and that is **B7** rather than a missing image. The scripts
stay on the register and are not declared container-side, because a whole-file
declaration would be a false claim while one of two callers is a bare host.

Worth recording as agreement rather than coincidence: `tests/rust-gate.sh`
passes this plan's check unmodified. Two workstreams, one policy, no
negotiation needed.

### 5.6 Not builds, named so the enumeration is not narrower than it looks

`boards/cx3576/bsp/Makefile`'s `rkdeveloptool` targets **flash a board over
USB**: they need the host's bus, and a container cannot do it without being
handed the device. Orchestration by §3. The same file's `$(SHA256)` is a digest.
`pkgs/mosd/tests/dbus-policy-test.sh` and the apid QEMU suite's `socat` are
runtime behaviour tests.

## 6. Enforcement, because prose is what failed

The reason this record exists is that a documented gate with nothing enforcing
it stayed broken for a week and nothing failed. So the policy ships with a
check, in the shape `tests/shell-pipefail-lint.sh` already uses.

`tests/host-toolchain-lint.sh`, wired as `make os-host-toolchain-lint`, run in
the CI `offline-suites` job with its negative test as the step after it — bash,
awk and git, no docker and no bun.

- **Two shapes, not one.** A producer binary in command position; and a PATH
  assignment that prepends a directory under `$HOME`. The second exists because
  the first nearly missed the largest violation in the tree: this host has no
  `cargo` at all, and `hack/check.sh` finds one only by putting
  `$HOME/.cargo/bin` in front. It is narrowed to `$HOME` and `~` so that the
  fixture PATHs two test suites build are not findings.
- **What it elides.** Comment lines; `case` labels; `echo`/`printf` arguments;
  heredoc bodies; and every file or block declared container-side.
- **Its positive controls**, so it cannot pass over nothing: zero files scanned
  is an error; zero command lines examined is an error; **zero container-side
  declarations is an error** — this tree builds images, so a scan that sees no
  producer in a container has found a pattern that stopped matching; an
  exemption matching nothing is an error; an unclosed container block is an
  error.
- **Its negative test**, `tests/host-toolchain-lint-test.sh`, **18 cases**: a
  host `mkfs.ext4`, a host `cargo build`, a `$HOME` PATH prepend, a stale
  exemption, an exemption with no reason, a removed container declaration, an
  unclosed block, a close with no open, a marker with no reason, a declaration
  after code, a heredoc named in a comment, an empty surface and the
  no-declaration control — each required to turn the run red with *its own*
  message. Three require **green**: a producer inside a declared container
  block, a whole-file declaration doing its job (whose removal the next case
  requires to turn the same bytes red), and a fixture PATH built from a temp
  directory.

The elision order is one of those cases because it was a real defect rather
than a hypothetical one. Heredoc detection ran ahead of the comment skip in the
first draft, so a line of prose containing `<<EOF` opened a heredoc and elided
every line after it until something matched the terminator — a file that
silently stopped being scanned and still reported clean. Fixing it brought back
**152 command lines that had never been examined**. No finding was hiding in
them, and that is luck: what found the hole was reading the scanner, not
anything failing.

### What it cannot catch, said at the site

- **A binary invoked through a variable.** `"${MKIMAGE}" -T script` in
  `tests/handshake-test/harness.sh:101` is exactly that, and is covered only
  because the file declares its side.
- **A heredoc body.** Elided whole. Every heredoc in this tree that carries a
  producer today carries a *container* script, so the elision costs nothing
  measured; a host build step written into one would not be seen.
- **A declaration that is wrong.** `# mos-build-side: container` is a claim. The
  check counts the claims and refuses a run that found none; it cannot verify
  one.
- **Anything that is not shell.** The four seams of §5.4 are closed in code and
  held by `build`'s and `verify`'s own suites.
- **Whether the criterion still holds.** That is §4's experiment. **B6 closed
  it**: `tests/bare-host-gate/gate.sh`, wired as `make os-bare-host-gate`, is
  that climb on demand — a clone of `HEAD` inside `IMAGE_DOCKER_CLI_28`, with
  the substrate measured before it is used and every producer in the table above
  required to stay unreachable after `bash` and `make` arrive. Its ceiling is
  rung 3, so what it does *not* execute is still covered only by the shape this
  check reads. §10 B6 records both halves.

## 7. Documentation

**`docs/design/build.md` §0**, immediately after the intro, mirrored into
`docs/zh/design/build.md`; a pointer from `build-harness.md`.

Justified against the alternative rather than assumed: build.md's intro already
carried the claim, so §0 is that sentence made precise where a reader already
meets it, and build.md is the page a contributor opens *before* a build.
`build-harness.md` opens "This page is for someone about to run something" — it
is the second page, about checks, and it is where RFCT-309 is working, so policy
text there would collide on the same lines. It gets a one-line pointer, which
merges as a union.

The zh coverage gate governs `user`, `website` and `bsp` — not `design/` — so no
mirror is required by a gate. `docs/zh/design/build.md` exists and carries the
same intro sentence, so it is mirrored anyway; leaving it behind would make the
Chinese page quietly weaker than the English one about a rule.

## 8. What this costs

Measured, not reassured.

**Invocations that stop working on a host without docker.** None that work
today on this one. An assembly needs the complete toolset and this host has none
of `sgdisk`, `mcopy`, `mmd`, `mdir`, `minfo`, `mkimage`, `veritysetup`,
`mksquashfs`, `unsquashfs`, `grub-mkstandalone` or `grub-editenv`, and its
`mkfs.vfat` is BusyBox's. The population that loses something is "a host
carrying the complete assembly toolset *and* no docker", which cannot run
`make os-verify-<board>` or any producer build today either.

**Wall clock where the host route was the fast one — measured, and it is
nothing.** `build/src/testing.ts` records the opens: host route ~4 ms,
alpine+apk coreutils ~4.6 s. Only `COREUTILS` took the host route, and only in
`build/src/toolbox.test.ts`; no production path opens it. Both runs on this
host, 2026-09-04, `bash build/run.sh src/toolbox.test.ts src/toolsets.test.ts`:

| | tests | wall clock |
| --- | --- | --- |
| before | 35 | 118.15 s |
| after | 36 | 116.62 s |

The after-run is faster, which is not a claim that this speeds anything up: one
run each, on a host whose container creation that same file measures anywhere
from 320 ms to 101 s. The predicted ~9 s does not show above the noise.

It did show once, and exactly where `testing.ts` said it would. That file calls
the ~4.6 s open "the one that matters: it is UNDER the default and it flaked
against it". One case in `toolbox.test.ts` opened a COREUTILS toolbox with no
timeout override and the first full suite run after the change failed it at
5000.80 ms. It carries `OPEN_TIMEOUT_MS` now, with the reason at the site.

**A path with no container: there was one, and it closed during this task.**
The Rust gate. `localhost/mos-build-rust` carries cargo and rustc and nothing
else; rustfmt, clippy, cargo-nextest and cargo-deny came from
`/srv/mos-rust-tools` and `/root/.cargo/bin`, neither pinned by anything. That
was the one path that made the policy unimplementable rather than merely
unimplemented — and RFCT-309's `localhost/mos-build-rust-check` landed on `main`
before this record did. **There is no path in the tree today with no container
available to it.** What remains is CI still choosing the host one (B7), and the
rootfs composition needing one `COPY` (B5).

**A path the criterion still blocks: the rootfs composition.** §4.4. One `COPY`
from a pin the tree already has, plus a run that proves it. Backlog **B5**.

## 9. Risks

- **The check teaches people to ignore it.** Mitigated by the elisions in §6 and
  by the three green cases in the negative test. If a finding is ever wrong, the
  rule is narrowed, not waived.
- **A declaration becomes a rubber stamp.** `# mos-build-side: container` is
  unverifiable. Mitigated only by requiring a reason after `--` and by keeping
  the declared set small enough to read: 13 files, listed in §5.3.
- **The exemption register becomes permanent.** Mitigated by the
  matches-nothing failure and by naming the closer of each rule in the register.
- **The `verify` default flip changes a verdict.** A host that has the tools now
  reads its image with alpine's. That is the point, but it is a behaviour change
  on a gate, so `MOS_VERIFY_TOOLS=host` keeps the old route one variable away
  and both routes stay exercised by `verify`'s own suite.
- **The criterion decays silently.** §4 was run by hand. **Closed by B6**
  (RFCT-319): `make os-bare-host-gate` re-climbs it, and a rung that goes red
  names the tool and the file rather than reporting a broken build. What decays
  now is narrower and worth stating in its place: the gate's ceiling is rung 3,
  so a host tool that only the *assembly* path reaches is caught by §6's static
  shape and not by execution. The gate runs §6's lint from inside itself at rung
  2 for exactly that reason, and rung 4 stays a dated observation until a pool
  is cheap enough to stand behind it.
- **RFCT-309 collides in `build-harness.md` and `build-env/`.** Expected; the
  two are the same policy at different scopes. Resolved as a union.

## 10. Scope

**In**, and done under this approval:

1. `docs/design/build.md` §0 and the zh mirror; the pointer from
   `build-harness.md`.
2. `tests/host-toolchain-lint.sh` with both shapes, its exemption register,
   `make os-host-toolchain-lint`, `tests/host-toolchain-lint-test.sh`, `make
   os-host-toolchain-lint-test`, and both as CI steps.
3. The 13 container-side declarations of §5.3.
4. The four seams of §5.4, including the client-mount fix §4.3 found.
5. The experiment of §4, run and recorded.

**Out**, and waiting at the approval boundary:

- **B1 — the Rust gate's container. CLOSED during this task, by RFCT-309.**
  `localhost/mos-build-rust-check`, `tests/rust-gate.sh` and `make os-rust-gate`
  landed on `main`; they run both `hack/check.sh` unmodified, covering the
  second workspace this plan asked for and its brief did not name. What this
  plan contributed is the requirement and the rows that come off; what is left
  of it is B7. *Not sized here; it was another task's.*
- **B2 — `pkgs/rauc/gen-dev-keys.sh` into a pinned openssl container.** A
  producer, six `openssl` invocations plus the `jq` edit, writing material baked
  into every image. Needs an image key, the `--if-absent` path `rootfs/build.sh`
  calls on every build, and the two trust tests re-run. *~0.5 day.*
- **B3 — the two judges.** `rootfs/build.sh`'s `alg_of_material()` and
  `tests/repart-loader-test.sh`'s five host `sgdisk` reads. *~0.5 day together.*
- **B4 — extend the scan past shell.** The four seams are closed in code and
  nothing stops a fifth from being written. A check over `build/src` and
  `verify/src` for `Bun.$` against a producer binary is possible. *~0.5 day.*
- **B5 — buildx in the pinned bun image, and the rootfs composition on a bare
  host.** One `COPY` of `/usr/local/libexec/docker/cli-plugins/docker-buildx`
  into `verify/Dockerfile`, lifting `--build-rootfs`'s refusal, plus the run
  that proves it — which needs the amd64 package pool. *~1 day, most of it the
  proof.*
- **B6 — make §4 a gate. CLOSED by RFCT-319.**
  `tests/bare-host-gate/{gate.sh,substrate.sh,ladder.sh}` and
  `make os-bare-host-gate`: the pinned CLI image, a `--depth 1` clone of `HEAD`
  mounted at a daemon-resolvable path, `apk add bash make`, and rungs 1–3. The
  sizing above was right about the pool, so the **ceiling is rung 3** and the
  record says so rather than implying a full climb: it runs the five docs gates,
  `make os-host-toolchain-lint`, `make os-layout-lint` and `make os-verify-test`,
  and it does **not** assemble an image, does not run `os-build-test` (§8 priced
  two of its files at ~118 s; the whole suite was not measured), and does not
  lift `--build-rootfs`'s refusal — that is still B5.
  Two things make it more than a re-run of §4. The substrate is *measured*, not
  described: `substrate.sh` requires the permitted set present and `bash`/`make`
  absent before either is added, and `ladder.sh` then requires every producer in
  §6's table — read out of `tests/host-toolchain-lint.sh --print-tools`, one
  table with two readers — to still be unreachable. And a red rung is diagnosed:
  four measured failure signatures (bash's `command not found`, busybox's `not
  found`, make's `No such file or directory`, and this tree's own `is required
  and not on PATH`) name the tool, and the file comes from the message where the
  shell put it there and from a command-position grep where it did not.
- **B7 — CI stops installing a toolchain.** `.github/workflows/check.yml`'s
  `rust` job `curl`s rustup onto the runner and runs both `hack/check.sh` there.
  With `make os-rust-gate` in the tree those two steps and the three install
  steps above them could become one. The cost is that the runner must build the
  `mos-build-*` family first, and it is a CI change nothing here can run to
  prove, so it is named rather than attempted. *~0.5 day, most of it watching a
  runner.*

## 11. Alternatives considered

- **A list of banned binaries in the document.** Rejected: a list is what goes
  stale, and the first tool nobody listed passes it. §3 is a test instead, and
  the lint's table is the *check's* implementation detail rather than the policy.
- **Write the policy as the prohibition alone.** Rejected on the user's own
  argument, and §4 is the evidence: the prohibition would have called
  `build/run.sh` compliant — it invoked no host toolchain — while it could not
  complete on a bare host at all.
- **A `docker run` one-liner as the entry point, so `make` need not be
  permitted.** Rejected: it moves the orchestration into an image, and that
  image has to be built by something on the host — the same problem one level
  down, with the target names no longer visible in the tree.
- **Ban the host bun route as well.** Rejected against the criterion, which asks
  for sufficiency and not exclusivity, and against the tree's evidence: the bun
  that writes bytes already has no host route, and §4 rung 3 shows the container
  route sufficient for the ones that do not.
- **Keep `MOS_BUILD_TOOLBOX=host` as an escape hatch.** Rejected: an escape
  hatch on a producer is the policy with a switch to turn it off. It becomes a
  refusal that names the reason, which is more useful than being ignored.
- **Mount the host's buildx plugin directory into the bun image.** Rejected as
  the fix for §4.4: it puts a second host binary inside a pinned image, and the
  pin exists so that what runs is a recorded value. B5 copies it from the pin.

## 12. Approval boundary

**Approved by the request, and implemented:** sections 1–7 — the criterion and
its permitted set, the rule, the boundary test with the bun/node and `make`
rulings, the experiment, the enumeration with a verdict on every path, the check
with both shapes and its controls, and the documentation.

**NOT approved, and not started:** B2–B5 and B7 in section 10. **B6 closed by
RFCT-319** — `make os-bare-host-gate` runs §4's ladder to rung 3, which is the
answer to the largest risk in section 9; the rungs above that ceiling are named
in section 10 rather than implied. **B1 closed during this
task** — RFCT-309's `localhost/mos-build-rust-check` landed on `main` and
`make os-rust-gate` runs both `hack/check.sh` unmodified inside it, so the one
path that made the policy unimplementable no longer exists. B2–B7 are estimated
separately and need their own approval; each carries an exemption or a named
refusal in the tree today, so the state of things is written down rather than
silent.
