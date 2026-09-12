# 20260911-2006-split-package-repositories Split the tree into an assembly repository and independently released package repositories

- **status**: draft
- **createdAt**: 2026-09-11 20:06
- **approvedAt**: (pending)
- **relatedTask**: [20260911-2003-split-package-repositories](../task/20260911-2003-split-package-repositories.md)

## Context

### What the tree is today

One repository holds both halves. The **software** is under `pkgs/`: the
`mosd` Cargo workspace (mosd, apid with its React UI, mqttd, broker,
mqtt-reference, busname, mosd-settings, ui-bundle; 354 tracked files), the
`mos-deploy` workspace (mos-init and mos-deploy; 31 files) and the `podman`
source build (six pinned upstreams, four toolchains, about 45 minutes of
emulated arm64 compile; 15 files). The **assembly** is everything else:
`boards/`, `rootfs/`, `build/`, `verify/`, `tests/`, `build-env/`,
`update-server/` and `docs/`. `pkgs/mos-boot` is assembly tooling (UKI/FIT,
initramfs, verity tool, dev keys) that happens to live under `pkgs/`; it is not
a package and does not move.

Every shipped userspace binary reaches an image as a Debian archive. A
**producer** is a directory holding `Dockerfile` + `producer.env`; sixteen of
them are discovered anywhere in the tree by `build-env/deb/producers.sh`
(`pkgs/mosd/deb/{mosd,mqtt,mqtt-reference}`, `pkgs/mos-deploy/deb/deploy`,
`pkgs/podman/deb/podman`, six under `rootfs/packages-src/`, five under
`boards/*/deb/`). One driver, `build-env/deb/build.sh`, runs a producer's
`PREPARE` hook on the host (the cargo or Go compile) and packs at the target
architecture in `localhost/mos-build-deb`. `make os-debs` builds all of them
into `_out/debs/<arch>/pool/` and `repo.sh` writes `Packages`, `SHA256SUMS`
and `manifest.txt` beside the pool. The composer (`rootfs/build.sh`) installs
from that pool in one APT transaction and never compiles.

### The bindings the split has to replace

Three rules bind the pool to *this* commit, and each is exactly what stops a
package built elsewhere from being accepted:

1. **One stamp across the pool.** `build-env/deb/version.sh` reads the mosd
   workspace's crate version (`0.1.0`) and appends `+git<commit>[.dirty]-1`;
   every producer, including the podman repack, carries that stamp.
   `tests/deb-package-gate.sh` asserts one stamp over the whole pool and
   `rootfs/build.sh` ("stale, sense 3") refuses a pool whose stamp is not the
   tree's own.
2. **The mosd build record.** `pkgs/mosd/hack/build-deb.sh` writes
   `_out/mosd-build-<arch>.txt`; the composer copies it beside the image and
   `verify/src/smoke.ts` compares the commit the running binary reports with
   it. A pool "carried in from another tree" has no record and is refused.
3. **Version pins read from source.** `verify/src/smoke-pins.ts` reads
   `pkgs/podman/versions.env` and `pkgs/mosd/*/Cargo.toml` to know what each
   binary must report; `tests/install-closure-gate.sh` reads the same two plus
   `pkgs/mos-deploy/Cargo.toml`; `tests/netavark-kernel-config-test.sh` reads
   the netavark tag out of `versions.env`.

### Coupling inventory

Assembly side reaching into `pkgs/` (tracked, non-docs): 97 files. The ones
that execute or read package source rather than cite it in a comment:

| Site | What it needs from `pkgs/` |
|---|---|
| `Makefile` | `os-rust-gate`, `os-dbus-policy-test`, `podman`, `podman-pins`, `os-apid-api-test`, `os-apid-api-spec-pins`, `os-apid-ui-build-contract-test`, `os-file-transaction-faults` all run scripts under `pkgs/` |
| `tests/rust-gate.sh` | runs `pkgs/{mosd,mos-deploy}/hack/check.sh` in `mos-build-rust-check` |
| `tests/deb-preflight-test.sh`, `tests/podman-pins-test.sh`, `tests/quadlet-doc-test.sh`, `tests/netavark-kernel-config-test.sh` | `pkgs/podman/{versions.env,versions-stamp.sh,check-pins.sh,out-arm64/quadlet,deb/podman/prepare.sh}` |
| `tests/apid-ui-build-contract-test.sh` | `pkgs/mosd/apid/{ui/build.sh,ui/run.sh,build.rs}` and the three `hack/` scripts |
| `tests/file-ab-faults/run.sh`, `tests/file-ab-x64/early-hang-init.sh` | compile `pkgs/mos-deploy` source (the io-fault suite; a patched mos-init fixture) |
| `tests/p1-writable-path-audit/boot.sh` | runs `pkgs/mosd/tests/apid-api` |
| `tests/component-contracts/*.json` | golden fixtures `include_str!`'d by nine mos-deploy Rust tests and read by `build/src/*.test.ts` and `update-server/src/*` |
| `build/src/kernel-package.ts` | copies the built `mos-init` into the initramfs input; `pkgs/mos-boot/initramfs.sh` places it at `/init` |
| `verify/src/{smoke,smoke-pins}.ts` | the pins above and the mosd build record |
| `rootfs/build.sh` | the stamp rule, the mosd build record, `producers.sh` for the composition record's source column |
| `build-env/deb/version.sh` | the mosd workspace's crate manifests |
| `.github/workflows/check.yml` | the `rust` job (both workspaces), the UI and spec-pin steps |
| `.gitattributes` | two `linguist-generated` rows under `pkgs/mosd` |

`pkgs/` reaching into the assembly:

| Site | What it needs |
|---|---|
| every `pkgs/*/hack/*.sh`, `pkgs/podman/build.sh`, `pkgs/mosd/apid/ui/build.sh` | `build-env/from.sh` + `build-env/images.env` to resolve the pinned builder images; each derives `REPO_ROOT` three levels up and refuses if `build-env/from.sh` is absent |
| `pkgs/podman/deb/podman/producer.env` | `BUILD_CONTEXTS="overlay=rootfs/overlay"`: the archive copies `etc/containers/containers.conf` and `etc/systemd/system/etc-containers-systemd.mount` out of the assembly overlay (the file itself says "until a later workstream switches it") |
| `pkgs/mosd/tests/apid-api/run.sh` | `boards/<board>/board.env`, `_out/<board>/` (the image), `verify/Dockerfile` |
| `pkgs/mosd/deb/*/control/*` | `Depends: mos-system (= @VERSION@)`; `pkgs/podman/deb/podman/control` `Depends: mos-system (= @SYSTEM_VERSION@)` |

Exact-version pins across the future repository boundary: `mosd`, `mos-apid`
and `mos-podman` each pin `mos-system` to their own version. Once versions are
per repository these cannot hold. Pins *within* one repository (`mos-apid` on
`mosd`, board packages on `mos-system`) stay exact.

Churn: 21 of the last 60 commits touching `pkgs/` also touched the assembly
side. Most are docs or Makefile edits; the genuinely cross-cutting ones are the
ones listed in the two tables.

### Forge and tooling facts

- `origin` is `ssh://git@git.ds.cc:33/miehq/mos.git` (internal Gitea). Gitea
  ships a Debian package registry (`/api/packages/<owner>/debian/...`, APT
  compatible) and a container registry. Neither was probed: the host returns
  403 to unauthenticated API calls and no `GITEA_*` token is exported in this
  session. Availability is Phase 0's first check.
- `.github/workflows/*.yml` run on Gitea Actions (privileged.yml says so). A
  package repository's CI needs the same runner class check.yml uses today
  (docker + buildx); the arm64 emulated packaging already runs there.
- `git subtree split` is available; `git-filter-repo` is not. Subtree split
  preserves per-directory history, which is what the extraction needs.
- 60+ documentation files cite `pkgs/...` paths in prose. `docs/verify-links.sh`
  checks relative links only, so prose citations do not break the gate; the
  one relative link that does (`docs/README.md` to `../pkgs/mosd/apid/openapi.json`)
  will.

## Proposal

### Target repository set

All under `miehq` on `git.ds.cc`. Names are a Phase 0 decision (see
*Annotations*); the mechanism does not depend on them.

| Repository | Content | Publishes |
|---|---|---|
| `mos` (this one) | `boards/`, `rootfs/` (with `rootfs/packages-src/` producers), `build/`, `verify/`, `tests/`, `pkgs/mos-boot/`, `update-server/`, `docs/`, the board producers under `boards/*/deb/`, the lock | factory images, update archives, release directories |
| `mos-build-env` | today's `build-env/` unchanged in layout (`images.env`, `from.sh`, builder Dockerfiles, `deb/` driver, `pack.sh`, `producers.sh`, `repo.sh`, `version.sh`, `preflight.sh`) plus `tests/deb-package-gate.sh` and the new `fetch.sh`, `lock.sh`, `publish.sh`, `source.sh` | the builder images to the container registry (optional, later); consumed as a git submodule at `build-env/` by every other repository |
| `mosd` | `pkgs/mosd/*` incl. `deb/`, `hack/`, `tests/` (dbus policy, apid-api harness), `apid/ui` | `mosd`, `mos-apid`, `mos-mqttd`, `mos-mqtt-broker`, `mos-mqtt-reference` |
| `mos-deploy` | `pkgs/mos-deploy/*`, `tests/file-ab-faults/`, `tests/component-contracts/` | `mos-deploy`, and a new `mos-init` archive (the initramfs init, today an unpackaged binary) |
| `mos-podman` | `pkgs/podman/*`, `rootfs/overlay/etc/containers/containers.conf`, `rootfs/overlay/etc/systemd/system/etc-containers-systemd.mount`, `tests/podman-pins-test.sh` | `mos-podman` |

Recommended reading of the request: one repository per package, because the
three have different release cadences (podman moves on upstream pins, mosd on
product work, mos-deploy on the trust contract) and different toolchains. The
mechanism below is repository-count agnostic; a single "software" repository
publishing to the same registry namespace would use it unchanged.

### 1. Transport: the Gitea Debian registry

Each package repository's CI, on every push to `main` that passes its gates,
builds both architectures, runs `deb-package-gate.sh` over its own pool, and
uploads with `publish.sh`:

```sh
# build-env/deb/publish.sh --pool _out/debs --owner miehq --dist mos --component mosd
PUT https://git.ds.cc/api/packages/miehq/debian/pool/mos/<component>/upload
```

Distribution is `mos`; component is the source repository name, so one
registry namespace holds every package and a reader can still tell which
repository produced which archive. Download is the registry's direct URL,
`.../pool/mos/<component>/<name>_<version>_<arch>.deb`. Reads need a token
if the organisation is private; `fetch.sh` reads `GITEA_DS_TOKEN` (the `gitea`
skill's alias convention) and refuses with the variable's name when the
registry answers 401/403.

Fallback if the Debian registry is not offered by this Gitea version: the
generic package registry (`/api/packages/<owner>/generic/<name>/<version>/<file>`)
with the same lock format and the same `fetch.sh`; only the URL builder differs.

### 2. Provenance inside the archive

`pack.sh` gains `--source-repo <name>` and `--source-commit <sha>` and writes
them as `Mos-Source-Repo:` and `Mos-Source-Commit:` control fields (dpkg keeps
unknown fields; `dpkg-deb -f` reads them back). `build.sh` supplies them from
`git remote get-url origin` and `HEAD` of the repository the producer lives in.
`repo.sh` adds the two columns to `manifest.txt`.

This retires `_out/mosd-build-<arch>.txt`: the composer writes
`_out/<board>/mosd-build.txt` from the `mosd` archive's field, and
`verify/src/smoke.ts` keeps asserting the same thing it asserts today, that
the binary reports the commit the archive says it was built from.

### 3. The lock

`rootfs/packages/lock.tsv`, one file for both architectures, tab separated:

```
#package	version	arch	sha256	source-repo	source-commit
mos-podman	5.8.6+git1a2b3c4d5e6f-1	arm64	<sha256>	mos-podman	1a2b3c4d5e6f
mos-podman	5.8.6+git1a2b3c4d5e6f-1	amd64	<sha256>	mos-podman	1a2b3c4d5e6f
mosd	0.1.0+git9f8e7d6c5b4a-1	arm64	<sha256>	mosd	9f8e7d6c5b4a
...
```

- `fetch.sh --arch <a>` downloads every row for `<a>` and `all` into
  `_out/debs/<a>/pool/`, verifies the sha256 and both control fields against
  the row, and deletes and refuses on any mismatch, naming the package. It is
  idempotent: an archive already present with the right digest is not fetched
  again. Then `repo.sh` indexes as today, so the composer's
  `Packages`/`SHA256SUMS`/`manifest.txt` contract is untouched.
- `lock.sh --bump <component> [<version>]` reads the component's `Packages`
  index from the registry, rewrites that component's rows to the newest (or
  named) version and prints the diff. It is the only writer of the lock. A
  diff of the lock is a diff of the software an image imports, which is what
  makes the import reviewable.
- `source.sh <component>` clones the source repository at the commit the lock
  names into `_out/src/<component>/` (`git archive --remote`), for the two
  assembly tests that need package *source* (the component-contract fixtures
  and the early-hang init), so those tests build from exactly the commit the
  image ships.

### 4. The composer's rule

`rootfs/build.sh` "stale, sense 3" is replaced by a two-class rule over every
archive in the pool:

- **built here**: a package a discovered producer of *this* repository emits
  must carry this tree's stamp (today's check, scoped to that set);
- **imported**: a package the lock names must match its row's sha256;
- anything else refuses, naming the archive.

`MOS_POOL_UNLOCKED="<pkg> ..."` lets named imported packages bypass the digest
check for local development. The bypass is announced, written into
`rootfs-packages.txt` and into the image's `release-identity.env` as
`MOS_POOL_UNLOCKED=...`, and `build/src/release-manifest.ts` refuses such an
image in the `candidate` and `stable` channels the way it refuses the
development marker there today.

### 5. Targets

- `make os-debs` keeps its name and builds the producers `producers.sh`
  discovers in this tree, which after the split are the assembly's own
  (`rootfs/packages-src/*`, `boards/*/deb/*`).
- `make os-pool` = `fetch.sh` for both architectures + `os-debs` + `repo.sh`.
  It is what `rootfs/build.sh` names in its refusal message instead of
  `os-debs`.
- `make os-deb-preflight` additionally checks that every lock row is
  reachable (a HEAD request per row) before a build starts.
- `make os-lock-bump COMPONENT=<name>` wraps `lock.sh`.

### 6. Versioning

`version.sh` reads `${REPO_ROOT}/VERSION` (one line, e.g. `0.1.0`) instead of
the mosd crate manifests. Each repository gets a `VERSION`; the `mosd`
repository's `hack/check.sh` asserts it equals the workspace's crate version
so the number is still written once for the binaries. The `deb-package-gate`
one-stamp rule stays true per repository pool.

Cross-repository `Depends` lose their exact pin: `mosd`, `mos-apid` and
`mos-podman` declare `Depends: mos-system` unversioned. The `@SYSTEM_VERSION@`
token and `--system-version` in `pack.sh` are removed with their last user.

### 7. The shared substrate as a submodule

`build-env/` becomes the `mos-build-env` repository and is added back as a
submodule at `build-env/` in all five repositories. Nothing in the consumers
changes path: `from.sh`, `images.env` and the driver are where every script
already looks. Each repository's `Makefile` refuses with the
`git submodule update --init` line when `build-env/from.sh` is absent.

Builder images stay locally built (`make build-env`) in this plan. Publishing
them to the container registry so consumers pull by digest is a follow-up
that changes only `images.env` (`LOCAL_*` to `REGISTRY_*` keys) and
`from.sh`'s resolution; it is listed under *Annotations*.

### 8. Local development loop

A developer changing a package and wanting it in an image:

```sh
cd /srv/mosd
MOS_POOL_DIR=/srv/mos/_out/debs make os-debs      # dirty stamp, into the assembly's pool
cd /srv/mos
bash build-env/deb/repo.sh --arch amd64
MOS_POOL_UNLOCKED="mosd mos-apid" MOS_BOARD=x64 bash rootfs/build.sh
```

`MOS_POOL_DIR` is a new, optional override of `_out/debs` in `build.sh` and
`repo.sh`; unset, both behave as today.

### 9. Gate relocation

| Gate | Today | After |
|---|---|---|
| `os-rust-gate` (fmt, clippy, nextest, deny, openapi drift) | `mos` CI | `mosd` and `mos-deploy` CI, each over its own workspace |
| `os-apid-ui-build-contract-test`, `os-apid-api-spec-pins`, `pkgs/mosd/apid/ui/run.sh` | `mos` CI | `mosd` CI |
| `os-dbus-policy-test` | manual (root) | `mosd`, same privilege note |
| `os-apid-api-test` (boots the image) | manual | stays in `mosd` (the API's acceptance suite), driven with `MOS_QEMU_IMAGE` pointing at an assembly image; the assembly's delivery record names the mosd commit it ran |
| `os-file-transaction-faults` | `mos` CI | `mos-deploy` CI |
| `podman`, `podman-pins`, `podman-pins-test` | `mos` | `mos-podman` |
| `deb-package-gate.sh` | `mos`, over the whole pool | every repository with producers, over its own pool, before publish; the assembly runs it over the assembly-built archives only |
| `os-install-closure-gate` | `mos` | `mos`, over the fetched + assembly-built pool (it answers an assembly question: does the set the manifests select install) |
| `os-smoke-test`, `os-verify`, `os-factory-root-gate`, image assembly | `mos` | `mos`, unchanged; pins come from the pool's control fields and the lock instead of `pkgs/` source |
| `netavark-kernel-config-test` | reads `pkgs/podman/versions.env` | reads the netavark version the `mos-podman` archive ships in `/usr/share/mos/podman/versions.env` (new payload file), extracted from the fetched archive |
| `quadlet-doc-test` | runs `pkgs/podman/out-arm64/quadlet` | runs `quadlet` extracted from the fetched arm64 archive |
| `host-toolchain-lint` | scans the whole tree | unchanged in `mos`; each package repository runs it over its own tree through the submodule |

### 10. Repository hygiene for the new repositories

Each new repository gets: `AGENTS.md` with `CLAUDE.md` symlinked (PMA
injection naming its stack skill), `README.md`, `LICENSE` (copied), `.gitignore`,
`.gitattributes` (the two `linguist-generated` rows move with `mosd`),
`.editorconfig`, `VERSION`, `docs/{task,plan}/index.md`, `docs/changelog.md`,
and the `build-env` submodule. History comes from
`git subtree split -P pkgs/<dir>` so blame survives.

### 11. Documentation

System-level design records stay in `mos`: `docs/design/{mosd,api,bus,dashboard,connd,containers}.md`
describe the product contract, not the crate. Prose citations of `pkgs/...`
are rewritten as `<repository>:<path>`; the one relative link
(`docs/README.md` to the OpenAPI document) becomes a URL into the `mosd`
repository. `docs/architecture.md` gains a *Repositories* section with the
table above; `docs/design/build.md` section 1.1 and `build-harness.md` section
2 describe `os-pool`, the lock and the gate relocation. `pkgs/README.md` is
rewritten to say what is left (`mos-boot`) and where the rest went.

### Phase order

Each phase ends with an x64 image composed, verified (`os-verify`) and
smoke-tested from the pool as it stands at that phase.

- **Phase 0 — preflight and decisions.** Confirm the Debian registry on
  `git.ds.cc` with a token (one upload and one download of a throwaway
  archive), the runner class available to new repositories, and the four
  decisions under *Annotations*. Nothing merges.
- **Phase 1 — the mechanism, inside this tree.** Provenance fields, manifest
  columns, `VERSION` + `version.sh`, `fetch.sh`/`lock.sh`/`publish.sh`/`source.sh`,
  `MOS_POOL_DIR`, the composer's two-class rule, `os-pool`, the unlocked
  marker and its release refusal, and the negative tests. Proven by publishing
  the locally built `mos-podman` to the registry, locking it, deleting the
  local archive, and composing x64 from the fetched copy. No repository is
  split yet, so a failure here is a normal in-tree revert.
- **Phase 2 — `mos-build-env`.** Subtree-split `build-env/`, push, add back
  as a submodule, move `deb-package-gate.sh` in, CI green with the submodule.
- **Phase 3 — `mos-podman`.** The first real consumer: the 45-minute arm64
  build leaves this tree. Move the two overlay files and the pins test, drop
  the `@SYSTEM_VERSION@` pin, publish, lock, delete `pkgs/podman`, rewire the
  four podman tests.
- **Phase 4 — `mos-deploy`.** Publish `mos-deploy` and the new `mos-init`
  archive; `build/src/kernel-package.ts` takes the init from the fetched
  archive; contract fixtures and the faults suite move; the early-hang
  fixture builds from `source.sh`'s checkout; delete `pkgs/mos-deploy`.
- **Phase 5 — `mosd`.** The largest. Move the workspace, its gates and the
  apid-api harness; the mosd build record comes from the control field; delete
  `pkgs/mosd`; the `rust` CI job leaves `check.yml`.
- **Phase 6 — clean-up.** Makefile help and targets, `check.yml`, docs
  citations, `AGENTS.md` skill stack (the `/pma-rust` line moves to the new
  repositories), `pkgs/README.md`, changelog.

## Verification

### Phase 1 (the mechanism)

- `fetch.sh` negatives, each red by name: a row whose sha256 is altered; a row
  whose `source-commit` differs from the archive's control field; a row naming
  a version the registry does not hold; a 401/403 with no token.
- Composer negatives, each red by name: an archive in the pool that no lock
  row and no local producer names; a lock-named archive with one byte changed
  (re-index, then compose); `MOS_POOL_UNLOCKED` naming a package that is not
  in the pool.
- Positive: `os-pool` then `rootfs/build.sh` for x64 and virt-arm64, then
  `os-verify`, `os-smoke-test`, `os-install-closure-gate`, `os-factory-root-gate`
  all green with `mos-podman` fetched and everything else built here.
- `build/src/release-manifest.ts` refuses an unlocked image in `candidate` and
  `stable`, accepts it in `development`; fixture test added beside the existing
  development-marker cases.
- `docs-verify`, `os-host-toolchain-lint`, `os-shell-pipefail-lint` green.

### Phases 2 to 5 (each extraction)

- The new repository's CI runs its gates and `deb-package-gate.sh` and
  publishes; the published archive's control fields name the new repository
  and its `HEAD`.
- In `mos`: `lock.sh --bump` produces the expected diff; `os-pool` fetches;
  the x64 image composes and passes the gate set above; `git grep pkgs/<dir>`
  outside `docs/` returns nothing.
- For `mos-deploy`: the kernel component builds with the archive's `mos-init`,
  `tests/file-ab-x64/` runtime/update/fault cases pass under QEMU, and the
  early-hang case still trips the watchdog.
- For `mosd`: `os-apid-api-test` from the `mosd` checkout against the
  assembly's image passes; the smoke run's commit row is green from the
  control field with no `_out/mosd-build-<arch>.txt` present.

### Phase 6

- `make docs-verify docs-verify-test` green; `check.yml` runs without the
  jobs that moved; `make help` lists no target that runs a script under a
  deleted directory.

## Risks

- **Registry availability.** If `git.ds.cc` predates the Debian registry the
  generic registry fallback applies; if neither is enabled, Phase 0 stops and
  the user decides (enable it, or host an APT pool elsewhere).
- **CI for the new repositories.** The arm64 packaging is emulated and the
  podman build is long; the package repositories need the same docker+buildx
  runner the assembly uses. A repository without a runner publishes from a
  developer machine with `publish.sh`, which the archive's provenance fields
  make visible.
- **Provenance becomes two-level.** An image is reproduced from the assembly
  commit *plus* the lock. `provenance.json` must record the lock rows (name,
  version, sha256, source repo and commit); the release gate reconstructs and
  compares it as it does the SBOM today.
- **Unlocked images leaking.** Covered by the release-channel refusal and the
  identity marker; a development image can still be flashed by hand, as a
  development-marker image can today.
- **Submodule ergonomics.** A checkout without `--recurse-submodules` has an
  empty `build-env/`; every Makefile refuses on `from.sh` absent with the
  init command. Worktrees (this tree uses them heavily) inherit the submodule
  pointer but need `git submodule update` per worktree.
- **Assembly tests that compile package source** (`early-hang-init.sh`, the
  contract fixtures) now depend on a network clone at the locked commit. They
  are already docker-and-network tests; `source.sh` refuses offline by name.
- **Exact pins dropped across the boundary.** `mosd` no longer pins
  `mos-system`'s version. The install-closure gate still proves the selected
  set installs together; what is lost is APT refusing a mismatched pair, which
  the lock now expresses at the assembly instead.
- **Concurrent work.** Several BKD workstreams have open branches touching
  `pkgs/mosd` and `boards/`. Phase 5 should land when those branches are
  merged or rebased; Phases 1 to 3 do not move `pkgs/mosd` and can proceed.
- **Docs churn.** Sixty-odd prose citations of `pkgs/...` are rewritten in
  Phase 6; the link gate catches the relative ones, the rest are reviewed by
  grep.

## Scope

- Phase 1: `build-env/deb/{pack.sh,build.sh,repo.sh,version.sh,preflight.sh}`,
  new `build-env/deb/{fetch.sh,lock.sh,publish.sh,source.sh}`, `VERSION`,
  `rootfs/packages/lock.tsv`, `rootfs/build.sh`, `Makefile`,
  `build/src/release-manifest.ts` (+ test), `verify/src/smoke.ts`,
  `tests/deb-package-gate.sh`, new negative tests under `tests/`, `docs/design/build.md`.
  About 15 files.
- Phase 2: `build-env/` out, `.gitmodules` in, `Makefile` preflight, CI
  checkout step. About 6 files here plus the new repository.
- Phase 3: `pkgs/podman/` (15 files) out; `rootfs/overlay` two files out;
  `tests/{podman-pins-test.sh,quadlet-doc-test.sh,netavark-kernel-config-test.sh,deb-preflight-test.sh,install-closure-gate.sh}`,
  `verify/src/smoke-pins.ts`, `Makefile`, `check.yml`. About 12 files.
- Phase 4: `pkgs/mos-deploy/` (31 files) out; `tests/component-contracts/`,
  `tests/file-ab-faults/` out; `build/src/kernel-package.ts`,
  `build/src/*.test.ts` (fixture path), `update-server/src/*` (fixture path),
  `tests/file-ab-x64/early-hang-init.sh`, `Makefile`, `check.yml`. About 14 files.
- Phase 5: `pkgs/mosd/` (354 files) out; `tests/rust-gate.sh`,
  `tests/apid-ui-build-contract-test.sh`, `tests/p1-writable-path-audit/boot.sh`,
  `rootfs/build.sh`, `verify/src/smoke-pins.ts`, `Makefile`, `check.yml`,
  `.gitattributes`. About 10 files here.
- Phase 6: docs and `AGENTS.md`; about 60 files, prose only.

## Alternatives

- **Submodules of package source into the assembly.** Keeps one build
  entry point and no registry, but the assembly still compiles and re-gates
  every package on every image; it does not meet the request's "avoid repeated
  compilation and verification". Rejected.
- **Two repositories only (assembly + one software repository).** Same
  mechanism, one pool component, less isolation between packages with
  different cadences. Viable; the choice is put to the user in *Annotations*
  and changes only the repository table.
- **APT straight at the registry from the compose Dockerfile, no lock.**
  Simplest wiring, but the pool bytes are then whatever the registry serves
  at compose time: no offline compose, no reviewable import diff, and a
  reproduced build can differ. Rejected.
- **`git subtree` instead of a submodule for `build-env`.** No pin to a
  commit and duplicated history in every consumer. Rejected.
- **Keep `build-env/` in the assembly and bootstrap-clone it into package
  repositories.** Avoids a third repository at the cost of coupling every
  package's build to the assembly's history. Kept as the fallback if a
  separate `mos-build-env` is not wanted.
- **Publishing raw binaries (not archives) per package.** Would need a
  second packaging step in the assembly and lose `dpkg-shlibdeps` at the
  producer. Rejected; the archive is already the unit every gate reads.

## Annotations

Decisions needed before Phase 0 closes:

1. One repository per package (recommended) or one software repository.
2. Repository names: `mos-build-env`, `mosd`, `mos-deploy`, `mos-podman`
   under `miehq`, or other.
3. Builder images: keep `make build-env` local in every repository (this
   plan), or publish them to the container registry now.
4. Token custody: a `GITEA_DS_TOKEN` with package read/write for CI publish
   and for `fetch.sh` if the organisation's packages are private; where it
   lives on the build hosts.
