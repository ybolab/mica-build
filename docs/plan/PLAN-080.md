# PLAN-080 Every build and every assembly runs in a container

- **status**: implementing
- **createdAt**: 2026-09-04 21:30
- **approvedAt**: 2026-09-04 21:30
- **relatedTask**: [RFCT-310](../task/RFCT-310.md)
- **relatedPlans**: [PLAN-074](PLAN-074.md) (the x64 kernel, the last board artifact to move into a container)

## Context

### What this record is for, and what the request approved

The user asked for the tree's global build policy, written down and made
enforceable: **every compilation and every image assembly runs in a container;
no toolchain is installed on, or invoked from, the host.** That request is the
approval for designing it. The design settles a boundary, an enumeration and a
check; what the enumeration finds too large to close here is scoped as a
backlog and waits at the approval boundary in section 8.

### This is a tightening, not a new idea

`docs/design/build.md` opens with the rule already:

> Everything here runs in docker. The host needs docker with buildx, bash, make
> and git, and nothing else: no toolchain is installed on the host, and every
> compiler comes out of a builder image pinned by digest in
> `build-env/images.env`.

`docs/zh/design/build.md` carries the same sentence. So the tree publishes this
policy today. What it does not have is a boundary that says which side `make`
is on, and nothing at all fails when a path contradicts it — and section 3
finds paths that do.

### The measurements this rests on

Four, all in the tree or on this host, none of them an opinion.

1. **e2fsprogs.** `build/src/toolsets.ts` records that the layouts ask for
   `-O ^orphan_file` and `-E hash_seed`, that an e2fsprogs older than 1.47
   "silently cannot", and that this host's 1.46.5 "is the measured reason
   `pin_seeded_times` has always run container-side". Re-measured 2026-09-04:
   `mke2fs -V` → `mke2fs 1.46.5 (30-Dec-2021)`. Still true.

2. **Which package provided the tool decides bytes.** The same file: "which
   package provided mkfs.vfat or mksquashfs is exactly the kind of thing that
   decides bytes", and the x64 assembly contract's note that `BOOTX64.EFI` is
   only as reproducible as the `grub-efi-amd64-bin` in its container. The two
   assemblers deliberately use different base images and the package lists are
   "not merged, not sorted and not deduplicated" for that reason.

3. **The apid UI.** A host `bun` produces different chunk hashes than the
   digest-pinned `IMAGE_BUN_1`, so a `dist/` comparison run on the host reports
   a difference that is not there. Measured today: host bun is `1.4.0` at
   `/srv/bkd/runtime/bun`; the pin is
   `oven/bun:1@sha256:5ff609364c049b54eb0ff560ec96319729a972078ef2c755d758f0c6ef89c2d6`.

4. **New, taken 2026-09-04 on this host.** `command -v mkfs.vfat` answers
   `/build/bin/busybox/mkfs.vfat` — **BusyBox v1.37.0**, not dosfstools:

   ```
   $ /build/bin/busybox/mkfs.vfat --invariant /dev/null
   /build/bin/busybox/mkfs.vfat: unrecognized option: invariant
   $ /build/bin/busybox/mkfs.vfat --help
   Usage: mkfs.vfat [-v] [-n LABEL] BLOCKDEV [KBYTES]
   ```

   `--invariant` is the flag both assemblers and the bundle builder pass to make
   FAT reproducible, and this binary does not have it. The guard in front of
   `build/src/toolbox.ts`'s host route is `command -v` — which says yes to it.
   The host route is not taken on this machine only because `sgdisk` and `mcopy`
   are *also* absent; the check that would have caught the wrong `mkfs.vfat` is
   not the one doing the work. Measurement 2 is no longer hypothetical here.

And one the tree already carries for compilers, in `docs/design/build-harness.md`
§3: with a 1.96 toolchain ahead of the image's 1.98 on `PATH`, the gate's own
clippy line reported `error[E0463]: can't find crate for 'std'` against a
workspace that was fine. A toolchain difference arrived as damage to the code.

### One correction to the dispatch brief

The brief cited `docs/design/build-harness.md` as describing a gate that cannot
run, and separately warned that an earlier claim — that
`pkgs/mosd/hack/check.sh` does not exist — was wrong. Checked against the tree:
the script exists, is 24 lines, and is the clearest host-toolchain path in the
repository. It is treated here as the Rust half of this policy, not as a gap.

## 1. The rule

> **No toolchain on the host. No compilation on the host. No assembly on the
> host.**

Stated in the imperative, in `docs/design/build.md` §0, where a contributor
meets it before their first build.

## 2. The boundary, as a test rather than a list

A list of banned binaries goes stale the day someone reaches for a tool nobody
listed. So the boundary is one question, applied to the tool:

> **If this exact input were handed to a different build of this tool, could
> the run's output differ?**

- **Yes, and the output is a byte that survives the run** — an image, a
  package, a bundle, `dist/`, `out-<arch>/`, a signature, a recorded config.
  The tool is a **producer**. It runs in a container whose image is pinned by
  digest in `build-env/images.env`. No probe, no host route, no fallback.

- **Yes, and the output is a verdict** — a pass/fail somebody reads. The tool
  is a **judge**. The pinned container is the *contract*: it is what CI runs and
  what a result is quoted from. A host route may exist as an optimisation for
  the inner loop, and must announce which route answered, so that no result is
  ever ambiguous about which build of the tool produced it.

- **No** — the output is fixed by the input alone (`sha256sum`, `cmp`,
  `git rev-parse`), or the tool produces nothing at all and only decides which
  container runs (`docker`, `make`, `bash`, `jq`, `curl`, `sed`, the shell).
  The tool is **orchestration** and runs on the host, because there is no
  container to run it in without it.

Two consequences worth stating, because both have been argued the other way:

**Compilation is a producer even when the binary is discarded.** `cargo clippy
--workspace -- -D warnings` keeps no artefact, and its verdict is still decided
by the toolchain: build-harness.md §3's `E0463` is that failure, measured. A
compiler is never a judge.

**A digest is not a producer.** `sha256sum` writes a byte that ships — into
`SHA256SUMS`, into `disk.img.sha256` — and no build of it can write a different
one. The question is about the tool's freedom, not about whether the byte
survives.

### Testing the reading the brief proposed

The brief's own reading was that a host route is acceptable only where the
output is a verdict and never a shipped byte, with the pinned container as the
contract. Tested against `run_bun`, that reading holds and the tree already
implements it:

| bun caller | writes | today | verdict of the test |
| --- | --- | --- | --- |
| `pkgs/mosd/apid/ui/build.sh` | `_out/apid-ui/dist`, embedded in the apid binary | pinned container only; build-harness.md §1 records it "has no host-runtime or image override route" | producer — correct, and must not gain one |
| `verify/run.sh` | a suite verdict | host bun or `IMAGE_BUN_1`, announced | judge — correct |
| `build/run.sh` | a suite verdict | same seam | judge — correct |
| `pkgs/mosd/tests/apid-api/spec-pins.sh` | a comparison verdict | same seam | judge — correct |

CI installs no bun, so the container route is the one every push takes and the
`os-verify` job greps the announce line for the pinned reference. The container
is the contract there in fact and not only in intention. **The seam survives
unchanged.**

## 3. The enumeration

### How it was taken

Four passes, because no single one sees everything:

1. `git grep -n 'command -v' -- '*.sh' '*.ts'` — every host-binary probe in the
   tree: 50 lines match, 16 of them probing for `docker` itself
   (orchestration); the rest are classified below.
2. A tool-name scan over `git ls-files '*.sh' Makefile '*/Makefile'
   '.github/workflows/*.yml'` for 34 producer binaries in command position,
   eliding comment lines, heredoc bodies, `case` labels and `echo`/`printf`
   arguments: **63 candidate lines in 22 files**. Dockerfiles are not scanned —
   they *are* containers.
3. Hand-classification of all 63 against the file's own execution context
   (a script's header, or the `docker run` whose argument the line is).
4. The TypeScript seams, which no shell scan can see, read directly:
   `build/src/toolbox.ts`, `build/src/toolsets.ts`, `verify/src/tools.ts`.

**66 sites in 25 files.** The count is reported so that the next reader can tell
an empty result from an unasked question; pass 2 is reproduced exactly by
`tests/host-toolchain-lint.sh`, so the number can be re-taken rather than
believed. Its own RESULT line, on the tree as this record lands, is the
enumeration in one sentence:

    RESULT: PASS (94/94 files clean, 0 finding(s), 8803 command lines examined,
    3053 elided, 6 file + 7 block container declarations, 27 exempted
    invocation(s) under 6 rule(s))

36 of the 63 shell sites are inside the 13 declarations and 27 are under the 6
exemptions, which is the two tables below added up.

### 3.1 Already container-side — 36 lines in 13 files

Each runs inside an image today, either because the whole script does or
because the line is an argument to a `docker run`. Disposition: **declared**,
with `# mos-build-side: container -- <reason>` at the site, so the claim is
visible to the check and to a reader.

| Site | Lines | Runs inside |
| --- | --- | --- |
| `build-env/deb/pack.sh` | 8 | `localhost/mos-build-deb:<arch>`, from a producer Dockerfile's `RUN` |
| `build-env/deb/repo.sh` | 6 | the `docker run … -c '…'` block that indexes the pool |
| `pkgs/mosd/apid/ui/build.sh` | 5 | the `IMAGE_BUN_1` block with source mounted read-only |
| `pkgs/mosd/hack/build-target.sh` | 1 | `localhost/mos-build-rust` |
| `pkgs/mosd/hack/build-deb.sh` | 1 | `localhost/mos-build-rust` |
| `pkgs/rauc-sign/hack/build-deb.sh` | 1 | `localhost/mos-build-rust` |
| `rootfs/scripts/pack-squashfs.sh` | 1 | `90-pack.Dockerfile` line 380 |
| `rootfs/scripts/pack-assert-privileged.sh` | 1 | `90-pack.Dockerfile` line 389 |
| `rootfs/scripts/pack-verity.sh` | 1 | `90-pack.Dockerfile` line 413 |
| `tests/factory-root-gate/inner.sh` | 1 | the alpine tool container `gate.sh` starts |
| `tests/handshake-test/harness.sh` | 3 | the sandbox U-Boot image, "container side" per its own header |
| `tools/qemu-seed-state.sh` | 6 | the `docker run … -v "${WORK}:/w" … -c '…'` block |
| `tests/repart-loader-test.sh` (line 340) | 1 | the `REPART_BASE` container |

### 3.2 Host-side, closed by this task — 3 seams

| Seam | Today | Becomes |
| --- | --- | --- |
| `build/src/toolbox.ts` `Toolbox.open` | measures the host, takes the host route when every tool is present, container otherwise | **container unconditionally.** Every toolset it opens is a producer: two assemblers, verity, the bundle. `MOS_BUILD_TOOLBOX=host` and `route: 'host'` become a **refusal** naming this policy, rather than being ignored |
| `build/src/toolsets.ts` `mke2fsCanWriteTheseLayouts` | the host capability probe behind that route | **removed**, dead with the route it guarded. Its measurement is preserved in `docs/design/build.md` §0 and in the Context above, which is where a dated host measurement belongs |
| `verify/src/tools.ts` `chooseRoute` | prefers the host when it has all of sgdisk/mtools/debugfs/unsquashfs/veritysetup | **container by default; host only when `MOS_VERIFY_TOOLS=host` asks for it**, announced either way. The verifier is a judge, and this is what makes the pinned image the contract rather than the fallback |

### 3.3 Host-side, exempted with its reason — 27 lines in 6 files

An exemption is allowed; an unexamined path is not. Each is registered in
`tests/host-toolchain-exemptions` with the reason, and **an exemption that
matches no line is a failure** — so a rename cannot leave a rule behind about a
file that has moved, and a path that stops violating the policy cannot keep a
silent waiver.

| Site | Lines | Tool | Why exempt, and what closes it |
| --- | --- | --- | --- |
| `pkgs/mosd/hack/check.sh` | 5 | `cargo` | The Rust gate. It is a producer by §2 and it has **no container today**: `localhost/mos-build-rust` ships cargo and rustc only, and rustfmt, clippy, nextest and cargo-deny come from the unpinned host tree `/srv/mos-rust-tools`. RFCT-309 is building the derived image; this exemption is its acceptance criterion |
| `pkgs/rauc-sign/hack/check.sh` | 5 | `cargo` | The same gate over the second workspace, same missing image. Named separately because RFCT-309's brief names only the first, and a `--workspace` that no longer spans a crate does not complain |
| `.github/workflows/check.yml` | 3 | `cargo` | The runner that runs those two: it `curl`s rustup and installs a toolchain on the host. It cannot move before the image exists, and it must move with them |
| `pkgs/rauc/gen-dev-keys.sh` | 6 | `openssl` | A producer: the CA, the signer certificate and the Ed25519 root key it writes are baked into `meta/` and into every image. Backlog **B2** — closing it needs a pinned openssl image and the trust-grade tests re-run, and it is not free |
| `rootfs/build.sh` | 3 | `openssl` | A judge: `alg_of_material()` reads a certificate or key and reports its algorithm; nothing it writes survives. The parse is of openssl's own text output, which is version-sensitive, so it is a judge whose container is worth having. Backlog **B3** |
| `tests/repart-loader-test.sh` | 5 | `sgdisk` | A judge: it reads partition tables out of an assembled image to check growth. Its own container-side half is already declared (§3.1); these five are the host reads around it. Backlog **B3** |

### 3.4 The whole-host paths that are not builds

Named so that the enumeration is not silently narrower than it looks:

- `boards/cx3576/bsp/Makefile`'s `rkdeveloptool` targets **flash a board over
  USB**. Flashing is not a build; it needs the host's USB bus, and a container
  cannot do it without handing over the device. Orchestration by §2.
- The same file's `$(SHA256)` is `sha256sum` — a digest, no freedom, §2's third
  arm.
- `pkgs/mosd/tests/dbus-policy-test.sh` and `pkgs/mosd/tests/apid-api/`'s
  `socat` are runtime behaviour tests, not builds. Judges that keep their own
  refusals.

## 4. Enforcement, because prose is what failed

The reason this record exists is that a documented gate with nothing enforcing
it stayed broken for a week and nothing failed. So the policy ships with a
check, in the shape `tests/shell-pipefail-lint.sh` already uses.

`tests/host-toolchain-lint.sh`, wired as `make os-host-toolchain-lint` and run
in the CI `offline-suites` job:

- **What it scans.** `git ls-files '*.sh' Makefile '*/Makefile'
  '.github/workflows/*.yml'` for 34 producer binaries in command position.
  Dockerfiles are excluded because they are containers.
- **What it elides.** Comment lines; `case` labels; `echo`/`printf` arguments;
  heredoc bodies; and every file or block declared
  `# mos-build-side: container -- <reason>`.
- **Its positive controls**, so it cannot pass over nothing: zero files scanned
  is an error; zero lines examined is an error; zero container-side declarations
  is an error (the scan found no producer at all, which this tree cannot be);
  an exemption matching no line is an error; a container block left unclosed at
  EOF is an error.
- **Its negative test**, `tests/host-toolchain-lint-test.sh`: plants a host
  `mkfs.ext4`, a host `cargo build`, a stale exemption, a removed container
  declaration and an unclosed block, and requires each to turn the run red with
  its own message — and plants a producer *inside* a declared container block
  and requires green, because a rule whose findings are false positives teaches
  people to ignore it.

### What it cannot catch, said at the site

- **A binary invoked through a variable.** `"${MKIMAGE}" -T script` is invisible
  to it; `tests/handshake-test/harness.sh` line 101 is exactly that shape and is
  found only because the file declares its side.
- **A heredoc body.** Every heredoc in this tree that carries a producer today
  carries a *container* script — `docker run … <<'INNER'`, or a `cat > inner.sh`
  whose output is run in a container — so eliding them costs nothing measured
  today, and a host build step written into one would not be seen.
- **A declaration that is wrong.** `# mos-build-side: container` is a claim by
  the person who wrote it. The check records how many such claims exist and
  requires the count to be non-zero; it cannot verify one.
- **Anything outside a shell script.** The three TypeScript seams of §3.2 are
  closed in code and held by `build`'s and `verify`'s own suites, not by this
  scan.

## 5. Documentation

**`docs/design/build.md` §0**, immediately after the intro, and mirrored into
`docs/zh/design/build.md`.

Justified against the alternative rather than assumed: build.md's intro already
carries the claim, so §0 is that sentence made precise in the place a reader
already meets it, and build.md is the page a contributor opens *before* a build.
`build-harness.md` opens "This page is for someone about to run something" — it
is the second page, about checks, and it is also where RFCT-309 is working right
now, so the policy text there would collide on the same lines. It gets a
one-line pointer instead, which merges as a union.

The zh coverage gate (`docs/zh/verify-coverage.sh`) governs `user`, `website`
and `bsp` — **not** `design/` — so no mirror is required by a gate.
`docs/zh/design/build.md` exists and carries the same intro sentence, so it is
mirrored anyway; leaving it behind would make the Chinese page quietly weaker
than the English one about a rule.

`docs/README.md` already indexes both pages and needs no new row.

## 6. What this costs

Measured, not reassured.

**Invocations that stop working on a host without docker.** None that work
today on this one. An assembly needs the complete toolset, and this host has
none of `sgdisk`, `mcopy`, `mmd`, `mdir`, `minfo`, `mkimage`, `veritysetup`,
`mksquashfs`, `unsquashfs`, `grub-mkstandalone` or `grub-editenv`; its
`mkfs.vfat` is BusyBox's. The population that loses something is "a host
carrying the whole assembly toolset *and* no docker", and that host cannot run
`make os-verify-<board>` or any producer build today either.

**Wall clock where the host route was the fast one — measured, and it is
nothing.** `build/src/testing.ts` records the opens: host route ~4 ms,
alpine+apk coreutils ~4.6 s, alpine+apk assembly ~2.1 s. Only `COREUTILS`
actually took the host route, and only in `build/src/toolbox.test.ts` — no
production path opens it, so the predicted cost was two container opens in one
test file. Both runs on this host, 2026-09-04,
`bash build/run.sh src/toolbox.test.ts src/toolsets.test.ts`:

| | tests | wall clock |
| --- | --- | --- |
| before | 35 | 118.15 s |
| after | 36 | 116.62 s |

The after-run is *faster*, which is not a claim that the change speeds anything
up: it is one run each, and the same file records container creation on this
host varying from ~320 ms to 101 s under load. The honest statement is that the
predicted ~9 s does not show above the noise, and that no production path paid
anything at all because none of them was taking the host route.

**A path with no container today.** One: the Rust gate. `localhost/mos-build-rust`
carries cargo and rustc and nothing else, and rustfmt, clippy, cargo-nextest and
cargo-deny come from `/srv/mos-rust-tools`, a host directory pinned by nothing.
Until a derived image exists, `pkgs/mosd/hack/check.sh` and
`pkgs/rauc-sign/hack/check.sh` cannot be moved, and the policy is unimplementable
for them. **The image is not invented here.** RFCT-309 is building it; this plan
names the requirement and exempts the two scripts until it lands.

## 7. Risks

- **The check teaches people to ignore it.** Mitigated by the elisions in §4 and
  by the negative test's false-positive case. If a finding is ever wrong, the
  rule is narrowed, not waived.
- **A declaration becomes a rubber stamp.** `# mos-build-side: container` is
  unverifiable. Mitigated only by requiring a reason after `--` and by keeping
  the declared set small enough to read: 13 files today, listed in §3.1.
- **The exemption register becomes permanent.** Mitigated by the
  matches-nothing failure, which makes a closed path's stale exemption red, and
  by naming the closer of each one in the register itself.
- **The `verify` default flip changes a verdict.** Flipping `chooseRoute` to
  container-first means a host that has the tools now reads its image with
  alpine's. That is the point — but it is a behaviour change on a gate, so
  `MOS_VERIFY_TOOLS=host` keeps the old route one variable away and both routes
  stay exercised by `verify`'s own suite.
- **RFCT-309 collides in `build-harness.md` and `build-env/`.** Expected, and
  the two are the same policy at different scopes. Resolved as a union.

## 8. Scope

**In**, and done under this approval:

1. `docs/design/build.md` §0 and the zh mirror; the pointer from
   `build-harness.md`.
2. `tests/host-toolchain-lint.sh`, its exemption register, `make
   os-host-toolchain-lint`, the CI step, and
   `tests/host-toolchain-lint-test.sh`.
3. The 13 container-side declarations of §3.1.
4. The three seams of §3.2.

**Out**, and waiting at the approval boundary below:

- **B1 — the Rust gate's container.** RFCT-309 owns it. This plan contributes
  the requirement and the two exemptions that come off when it lands, including
  `pkgs/rauc-sign/hack/check.sh`, which RFCT-309's brief does not name.
  *Estimate: not sized here; it is another task's.*
- **B2 — `pkgs/rauc/gen-dev-keys.sh` into a pinned openssl container.** A
  producer, six invocations, writing material that is baked into every image.
  Needs an image key, the `--if-absent` path `rootfs/build.sh` calls on every
  build, and `tests/trust-domain-hygiene-test.sh` and
  `tests/rauc-trust-negative-test.sh` re-run. *Estimate: ~0.5 day.*
- **B3 — the two judges.** `rootfs/build.sh`'s `alg_of_material()` and
  `tests/repart-loader-test.sh`'s five host `sgdisk` reads. Both are verdicts
  and neither is urgent; both would take the same pinned alpine the verifier
  uses. *Estimate: ~0.5 day together.*
- **B4 — extend the scan past shell.** The three TypeScript seams are closed in
  code and nothing stops the fourth from being added. A check over
  `build/src` and `verify/src` for `Bun.$` against a producer binary is
  possible and is not written here. *Estimate: ~0.5 day.*

## 9. Alternatives considered

- **A list of banned binaries in the document.** Rejected: a list is what goes
  stale, and the first tool nobody listed passes it. §2 is a test instead, and
  the lint's table is the *check's* implementation detail rather than the
  policy.
- **Ban the host bun route as well.** Rejected against the tree's own evidence.
  The bun that writes bytes already has no host route; the bun that returns a
  verdict is the tightest loop in the repository, CI runs the pinned container
  and asserts the announce line, and removing the host route would buy nothing
  measured and cost every `bun test`.
- **Keep `MOS_BUILD_TOOLBOX=host` as an escape hatch.** Rejected: an escape
  hatch on a producer is the policy with a switch to turn it off. It becomes a
  refusal that names the reason, which is more useful than being ignored.
- **Put the policy in `build-harness.md`.** Rejected in §5: wrong page for a
  contributor's first build, and a guaranteed conflict with RFCT-309.
- **Enforce by a git hook rather than a check.** Rejected: a hook runs on the
  machine that has it. The failure this plan exists to prevent is precisely a
  gate that only some machines run.

## 10. Approval boundary

**Approved by the request, and being implemented:** sections 1, 2, 3.1, 3.2,
3.3, 4, 5 — the rule, the boundary, the declarations, the three seams, the
check with its controls and its negative test, and the documentation.

**NOT approved, and not started:** B1–B4 in section 8. B1 belongs to RFCT-309
and this plan only states the requirement. B2, B3 and B4 are estimated
separately above and need their own approval before anyone writes them; each
carries an exemption in the register today, so the tree is honest about them
rather than silent.
