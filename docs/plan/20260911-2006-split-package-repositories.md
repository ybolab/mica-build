# 20260911-2006-split-package-repositories Split the tree into an assembly repository and independently released package repositories

- **status**: implementing
- **createdAt**: 2026-09-11 20:06
- **revisedAt**: 2026-09-12 21:30
- **approvedAt**: 2026-09-12 21:00
- **relatedTask**: 20260911-2003-split-package-repositories

## Context

### What the tree is today (`7742a596`)

One repository holds both halves. The **software** is under `pkgs/`: the
`mosd` Cargo workspace (mosd, apid with its React UI, mqttd, broker,
mqtt-reference, busname, mosd-settings, ui-bundle; 354 tracked files), the
`mos-deploy` workspace (`mos-deploy`, the static `mos-init` and
`mos-shutdown`, `lifecycle-sys`; 47 files) and the `podman` source build (six
pinned upstreams, four toolchains, about 45 minutes of emulated arm64
compile; 15 files). The **assembly** is everything else: `boards/`,
`rootfs/`, `build/`, `verify/`, `tests/`, `build-env/`, `update-server/`,
`docs/`. `pkgs/mos-boot` (UKI/FIT, initramfs, verity tool, dev keys, the
boot-tools image; 17 files) is assembly tooling that lives under `pkgs/`; it
does not move.

Every shipped userspace binary reaches an image as a Debian archive. A
**producer** is a directory holding `Dockerfile` + `producer.env`; fifteen
are discovered by `build-env/deb/producers.sh` (`pkgs/mosd/deb/{mosd,mqtt}`,
`pkgs/mos-deploy/deb/deploy`, `pkgs/podman/deb/podman`, six under
`rootfs/packages-src/`, five under `boards/*/deb/`). `build-env/deb/build.sh`
runs a producer's `PREPARE` hook on the host and packs at the target
architecture in `localhost/mos-build-deb`; `make os-debs` fills
`_out/debs/<arch>/pool/` and `repo.sh` writes `Packages`, `SHA256SUMS` and
`manifest.txt` beside it. The composer (`rootfs/build.sh`) installs from that
pool in one APT transaction and never compiles.

One shipped thing is not an archive: the kernel component takes `mos-init`
and `mos-shutdown` as static PIE files that
`pkgs/mos-deploy/hack/build-deb.sh --producer boot --stage <dir>` compiles
into a stage directory; `build/src/kernel-package.ts` checks their ELF shape
(`kernelExecutables()`) and seals their digests into the signed kernel
identity.

### The bindings the split has to replace

Six rules bind the pool to *this* commit; each is exactly what stops a
package built elsewhere from being accepted.

1. **One stamp across the pool.** `build-env/deb/version.sh` reads the mosd
   crate version and appends `+git<commit>[.dirty]-1` to every producer's
   output; `tests/deb-package-gate.sh` asserts one stamp over the pool and
   `rootfs/build.sh` ("stale, sense 3") refuses a pool at another stamp.
2. **The mosd build record.** `pkgs/mosd/hack/build-deb.sh` writes
   `_out/mosd-build-<arch>.txt`; the composer copies it beside the image and
   `verify/src/smoke.ts` compares the commit the binary reports with it.
3. **Version pins read from source.** `verify/src/smoke-pins.ts`,
   `tests/install-closure-gate.sh` and `tests/netavark-kernel-config-test.sh`
   read `pkgs/podman/versions.env` and the crate manifests.
4. **The fixed producer join.** `rootfs/runtime/source-lineage.py` and
   `build/src/release-manifest.ts` carry hard-coded constants (`JOIN_*`,
   `STARTUP_*`, `GPT_*`, `BOOT_ROLE_SHA`: commits, trees, epochs, pool and
   receipt digests, per-file blob ids) describing one reviewed reuse of a
   pool built at an earlier commit, entered through `MOS_ROOTFS_PRODUCER_JOIN`,
   `MOS_ROOTFS_PACKAGE_SOURCE` and `MOS_ROOTFS_PACKAGE_RECEIPT`. The file
   calls itself "one reviewed producer transition, not a caller-extensible
   reuse policy": it is this plan's problem solved once by hand, and a second
   reuse means editing two constant tables and their tests.
5. **Native lifecycle digests.** The same constants pin the bytes and sha256
   of `mos-init` and `mos-shutdown`, so the kernel component is bound to one
   compile of `pkgs/mos-deploy`.
6. **The boot-tools witness.** The lineage record carries the immutable
   manifest of the `ai-agent/mos-boot-tools-*` image, compared with
   `LOCAL_BOOT_TOOLS_X64` in `build-env/images.env`. Boot tools stay in the
   assembly; this binding survives unchanged.

### Coupling inventory

Assembly files reaching into `pkgs/` (tracked, non-docs): 100. The ones that
execute or read package source rather than cite it in a comment:

| Site | What it needs from `pkgs/` |
|---|---|
| `Makefile` | `os-rust-gate`, `os-dbus-policy-test`, `podman`, `podman-pins`, `os-apid-api-test`, `os-apid-api-spec-pins`, `os-apid-ui-build-contract-test`, `os-file-transaction-faults` run scripts under `pkgs/` |
| `tests/rust-gate.sh` | `pkgs/{mosd,mos-deploy}/hack/check.sh` in `mos-build-rust-check` |
| `tests/{deb-preflight-test,podman-pins-test,quadlet-doc-test,netavark-kernel-config-test}.sh` | `pkgs/podman/{versions.env,versions-stamp.sh,check-pins.sh,out-arm64/quadlet,deb/podman/prepare.sh}` |
| `tests/apid-ui-build-contract-test.sh` | `pkgs/mosd/apid/{ui/build.sh,ui/run.sh,build.rs}` and the `hack/` scripts |
| `tests/file-ab-faults/run.sh`, `tests/file-ab-x64/early-hang-init.sh`, `tests/boot-shutdown-test.sh` | compile `pkgs/mos-deploy` source |
| `tests/p1-writable-path-audit/boot.sh`, `tests/file-ab-x64/api-launcher-docker.ts`, `tests/shell-pipefail-lint.sh` | `pkgs/mosd/tests/apid-api` |
| `tests/component-contracts/*.json` | golden fixtures `include_str!`'d by mos-deploy tests and read by `build/src/*.test.ts`, `update-server/src/*` |
| `build/src/kernel-package.ts` | the staged `mos-init` and `mos-shutdown` |
| `verify/src/{smoke,smoke-pins,smoke-register}.ts` | the pins above and the mosd build record |
| `rootfs/build.sh`, `rootfs/runtime/source-lineage.py`, `build/src/release-manifest.ts` (+ tests) | bindings 1, 2, 4 to 6; `producers.sh` for the composition record |
| `build-env/deb/version.sh` | the mosd crate manifests |
| `.github/workflows/check.yml`, `.gitattributes` | the `rust` job, UI and spec-pin steps; two `linguist-generated` rows |

`pkgs/` reaching into the assembly:

| Site | What it needs |
|---|---|
| every `pkgs/*/hack/*.sh`, `pkgs/podman/build.sh`, `pkgs/mosd/apid/ui/build.sh` | `build-env/from.sh` + `build-env/images.env`; each derives `REPO_ROOT` three levels up |
| `pkgs/podman/deb/podman/producer.env` | `BUILD_CONTEXTS="overlay=rootfs/overlay"` for `containers.conf` and `etc-containers-systemd.mount` |
| `pkgs/mosd/tests/apid-api/run.sh` | `boards/<board>/board.env`, `_out/<board>/`, `verify/Dockerfile` |
| `pkgs/mosd/deb/*/control/*`, `pkgs/podman/deb/podman/control` | `Depends: mos-system (= @VERSION@)` / `(= @SYSTEM_VERSION@)` |

Exact-version pins across the future boundary (`mosd`, `mos-apid`,
`mos-podman` on `mos-system`) cannot hold once versions are per repository;
pins within one repository stay exact.

### Forge and tooling facts (probed 2026-09-12)

- `origin` is `git@github.com:ybolab/mica.git` since 2026-09-12 23:25; the
  internal Gitea remote (`ssh://git@git.ds.cc:33/ybolab/mica-build.git`,
  Gitea `1.26.1`, organisation renamed from `miehq` and repository from
  `mos` earlier that day) is kept as the `gitea` remote for the registry.
  On GitHub the `ybolab` organisation holds `mica` (existing, empty) and the
  six package repositories created empty and private on 2026-09-12; on
  Gitea the four repositories created earlier that day (`mica-build-env`,
  `micad`, `mica-deploy`, `mica-podman`) are superseded.
- The Debian registry is enabled and round-tripped on 2026-09-12 with a
  throwaway archive: `PUT .../pool/mica/<component>/upload` answers 201 (409
  for a duplicate name), the download is byte-identical and answers 401
  without a token, the component's `Packages` index carries the custom
  `Mos-Source-*` control fields, and
  `DELETE .../pool/mica/<component>/<name>/<version>/<arch>` answers 204.
  `GITEA_DS_URL` and `GITEA_DS_TOKEN` are exported on this development machine
  (API user `roy`).
- **No Actions runner is registered** for the organisation, for `mica-build`
  or for the new repositories (the runner lists are empty and every recent
  `check.yml` run on `mica-build` is `cancelled` or `queued`). Until one is,
  nothing publishes from CI: archives are published from a developer machine
  with `publish.sh`, which the provenance fields make visible, and the
  repository gates run locally. The runner is a prerequisite for Phase 2's
  "CI green", not for Phase 1.
- `git subtree split` is available (per-directory history survives);
  `git-filter-repo` is not.
- `tools/docs/verify-links.sh` checks relative links only; the one relative link
  into `pkgs/` (`docs/README.md` to `../pkgs/mosd/apid/openapi.json`) will
  break, prose citations will not.

## Proposal

### Target repository set

One repository per package, named for Mica OS (the project's current
name), under the `ybolab` organisation on **GitHub** (decided 2026-09-12
23:20, superseding `git.ds.cc` as the source host): the assembly and
documentation repository is `git@github.com:ybolab/mica.git`, the daemon
repository `micad`, the others `mica-` prefixed. Locally every repository is
its own checkout under `/srv/ybolab/mica/<repository>/`, so the hierarchy
on disk is the organisation's. Package, binary, unit, bus and path names
inside the archives are renamed to Mica OS by the phase that moves them
(section 12); the split and the rename are one operation per repository,
decided and confirmed 2026-09-12.

Archives travel as GitHub Release assets (section 1, decided 2026-09-13);
the Gitea instance keeps a mirror of every repository (`gitea` remote,
pushed in step with `origin`) and nothing else. The `mica-build` rows the
Phase 1 proof locked from the Gitea registry are replaced by rows from the
`mica` release at the next `os-lock-bump`.

| Repository | Content | Publishes |
|---|---|---|
| `mica` (this one; `mica-build` until 2026-09-12 23:20) | `boards/`, `rootfs/` less `debian/` and `packages-src/`, `build/`, `verify/`, `tests/`, `pkgs/mos-boot/`, `update-server/`, `docs/`, `boards/*/deb/`, the lock | factory images, update archives, release directories |
| `mica-build-env` | today's `build-env/` unchanged in layout, plus `tests/deb-package-gate.sh` and the new `fetch.sh`, `lock.sh`, `publish.sh`, `source.sh` | consumed as a git submodule at `build-env/` by every other repository |
| `micad` | `pkgs/mosd/*` incl. `deb/`, `hack/`, `tests/` (dbus policy, apid-api harness), `apid/ui` | `mosd`, `mos-apid`, `mos-mqttd`, `mos-mqtt-broker` |
| `mica-deploy` | `pkgs/mos-deploy/*`, `tests/file-ab-faults/`, `tests/component-contracts/`, `tests/boot-shutdown-test.sh` | `mos-deploy`, and a new `mos-lifecycle` archive carrying the static `mos-init` and `mos-shutdown` per architecture |
| `mica-podman` | `pkgs/podman/*`, `rootfs/overlay/etc/containers/containers.conf`, `rootfs/overlay/etc/systemd/system/etc-containers-systemd.mount`, `tests/podman-pins-test.sh` | `mos-podman` |
| `mica-debian` | today's `rootfs/debian/` unchanged in layout (the 179 pinned upstream records, `sources.env`, `run.sh`, `docker.sh`, `fetch.ts`, `manifest.ts`, `consumers.pkgs`), plus `tests/debian-base-test.sh` and `tests/debian-lock-test.sh` | nothing: consumed as a git submodule at `rootfs/debian/`; its commit is the pin of the Debian base, bumped like a lock row |
| `mica-system` | `rootfs/packages-src/*` (the six system producers), `rootfs/overlay/` (less the two podman files) | `mos-system`, `mos-busybox`, `mos-ca-trust`, `mos-profile-dev`, `mos-profile-prod`, `mos-wifi`, `mos-wifi-ap`, `mos-bluetooth` |

The registry component of each archive is its source repository name.

**Why `rootfs/debian` and `rootfs/packages-src` leave and the composer
stays.** `rootfs/debian` is already a module with one interface -- `run.sh
cache|verify|install|select` and `manifest.ts helper`, driven from the
composer's bootstrap stage, `make os-debian-*` and two tests -- and its own
cadence (Debian point releases and security updates). Its product is a pin
set, not an archive, so a submodule commit is the right pin and the registry
is not involved; the cache stays in the assembly's `_out/debian-base`. Its
outward coupling is `build-env/from.sh` for the Bun image and the cache
path, both already arguments. `rootfs/packages-src` is six ordinary
producers and moves the way the others do, through the lock. The composer
(`rootfs/build.sh`, `rootfs/compose`, `rootfs/runtime`, `rootfs/packages`,
`rootfs/scripts`) is the assembly: it reads `boards/*`, the lock, the pool
and `meta/`, and the release gate re-verifies its record; moved out, it
would need the boards and the lock from here and the assembly would have
nothing left to assemble.

### 1. Transport: GitHub Releases, one per source commit

Decided 2026-09-13 (user): archives are published as **release assets by
each repository's workflow**, not through a package registry of our own.
Every push to `main` that passes a package repository's gates creates the
release `build-<commit12>` of `ybolab/<repository>` on that commit, with one
asset per archive named `<package>_<version>_<arch>.deb`; `publish.sh` is
that step, runnable from a developer machine as well:

```sh
# build-env/deb/publish.sh [--pool _out/debs] [--arch <a>] [--package <name> ...]
POST https://api.github.com/repos/ybolab/<repository>/releases        {tag_name: build-<commit12>, target_commitish: <commit>}
POST https://uploads.github.com/repos/ybolab/<repository>/releases/<id>/assets?name=<archive>
```

A lock row names the repository and the full commit, so `fetch.sh` derives
the release tag and the asset and follows nothing "latest"; it verifies the
bytes against the row's sha256 (and the API's `digest` on `--check`) and the
five control fields against the row. `lock.sh --bump <component>
[--tag build-…]` downloads every `.deb` asset of a release and writes the
rows from the archives' own fields. `registry.env` declares the API, the
organisation, the token variable (`GH_TOKEN`, falling back to
`gh auth token`) and the source URL prefix. `publish.sh` refuses a `.dirty`
version, a dirty checkout, an archive from another repository or commit, an
asset already present with other bytes, and a HEAD not yet pushed (GitHub
refuses to tag an unknown commit). The Gitea Debian registry used by the
Phase 1 proof is retired; Gitea stays as a git mirror only.

### 2. Provenance inside the archive

`pack.sh` reads `MOS_DEB_SOURCE_REPO` and `MOS_DEB_SOURCE_COMMIT` from the
environment (the `SOURCE_DATE_EPOCH` pattern; each producer Dockerfile
declares the two `ARG`s) and writes them as `Mos-Source-Repo:` and
`Mos-Source-Commit:` control fields (dpkg keeps unknown fields; `dpkg-deb -f`
reads them back). `build.sh` supplies them from `origin` and `HEAD` of the
repository the producer lives in; `repo.sh` adds both columns to
`manifest.txt` and refuses an archive without them.

This retires `_out/mosd-build-<arch>.txt`: the composer writes
`_out/<board>/mosd-build.txt` from the `mosd` archive's field (through the
lineage record, so no `dpkg-deb` runs on the host) and `verify/src/smoke.ts`
asserts what it asserts today.

### 3. The lock: one pin per package

Decided 2026-09-13 (user): package versions and hashes are declared in JSON
in the shape of the Debian pins, one file per package under
`deps/packages/`, so every dependency of a repository -- upstream Debian,
Mica OS packages, source trees (section 7) -- is the same kind of record:

```json
deps/packages/mos-podman.json
{ "name": "mos-podman", "repository": "mica-podman", "commit": "1a2b3c4d5e6f…",
  "targets": {
    "amd64": { "version": "5.8.6+git1a2b3c4d5e6f-1", "architecture": "amd64",
               "sha256": "…", "asset": "mos-podman_5.8.6.git1a2b3c4d5e6f-1_amd64.deb" },
    "arm64": { "version": "5.8.6+git1a2b3c4d5e6f-1", "architecture": "arm64",
               "sha256": "…", "asset": "mos-podman_5.8.6.git1a2b3c4d5e6f-1_arm64.deb" } } }
```

An `Architecture: all` archive serves both pools with one target each.
`lock.sh --rows` is the one reader, printing the pins as
`package version arch sha256 source-repo source-commit` rows for every other
consumer, so the composer, the gate and the release gate read one shape.
The TSV lock of Phase 1 (`rootfs/packages/lock.tsv`) was converted on
2026-09-13 and retired.

- `fetch.sh --arch <a>` downloads every row for `<a>` and `all` into
  `_out/debs/<a>/pool/`, verifies sha256 and both control fields against the
  row, deletes and refuses on any mismatch naming the package, and skips an
  archive already present at the right digest. `repo.sh` then indexes as
  today, so the composer's `Packages`/`SHA256SUMS`/`manifest.txt` contract is
  untouched.
- `lock.sh --bump <component> [--version <v>] [--package <p> ...]` reads the
  component's `Packages` index from the registry, rewrites that component's
  rows and prints the diff. It is the lock's only writer; a lock diff is the
  reviewable import. `lock.sh --rows [--arch <a>]` is the one parser every
  other reader uses.
- `source.sh <component>` checks the source repository out at the locked
  commit into `_out/src/<component>/` for the two assembly tests that need
  package *source* (the component-contract fixtures, the early-hang init).

### 3a. What the lock retires: the fixed producer join

Binding 4 is the lock in hand-made form, so Phase 1 retires it rather than
keeping both:

- `source-lineage.py` keeps schema `mos/source-lineage/v1` for archives the
  assembly builds. The `join-v1` schema, the three `MOS_ROOTFS_*` inputs and
  every `JOIN_*`, `STARTUP_*`, `GPT_*` constant go, with the tests that pin
  them; the `delta` and `receipt_sha256` fields go with the explicit package
  source they described (package and composition source are now one). No
  compatibility path: migration was waived on 2026-09-11.
- The lineage record gains a `lock` array (package, version, arch, sha256,
  source repo, source commit), an `unlocked` array, and `source_repo` /
  `source_commit` on every pool package row. The two-class rule is
  implemented once, in `source-lineage.py` (`--lock`, `--unlocked`,
  `--local-packages`); `release-manifest.ts` re-checks the record and, at
  assembly, compares its rows with the tree's `lock.tsv`, replacing the fixed
  `producerJoin()` validation with a rule any future import satisfies.
- Binding 5 becomes the `mos-lifecycle` archive: `kernel-package.ts` extracts
  `mos-init` and `mos-shutdown` from the fetched archive into the stage
  directory it already reads; `kernelExecutables()` keeps its ELF checks;
  the lock row's sha256 is what the release gate compares.
- Binding 6 is unchanged.

### 4. The composer's rule

"Stale, sense 3" becomes a two-class rule over every archive in the pool:

- **built here**: a package a producer of *this* repository emits must carry
  this tree's stamp;
- **imported**: a package the lock names must match its row's sha256;
- anything else refuses, naming the archive.

`MOS_POOL_UNLOCKED="<pkg> ..."` lets named imported packages bypass the
digest check for local development. The bypass is announced, written into
`rootfs-packages.txt` and the image's `release-identity.env`, and
`release-manifest.ts` refuses such an image in the `candidate` and `stable`
channels as it refuses the development marker today.

### 5. Targets

- `make os-debs` keeps its name and builds the producers discovered in this
  tree (after the split: `rootfs/packages-src/*`, `boards/*/deb/*`).
- `make os-pool` = `fetch.sh` for both architectures + `os-debs` + `repo.sh`;
  it is what `rootfs/build.sh` names in its refusal message.
- `make os-deb-preflight` additionally checks that every lock row is
  reachable (one one-byte ranged GET per row; the registry answers HEAD with 405).
- `make os-lock-bump COMPONENT=<name>` wraps `lock.sh`.

### 6. Versioning

`version.sh` reads `${REPO_ROOT}/VERSION` (one line, e.g. `0.1.0`) instead of
the mosd crate manifests. Each repository gets a `VERSION`; `micad`'s
`hack/check.sh` asserts it equals the workspace crate version. The
`deb-package-gate` one-stamp rule holds per repository pool.

Cross-repository `Depends` lose their exact pin: a dependency across the lock
boundary (either side imported) is unversioned, and `deb-package-gate.sh`
requires exactly that -- exact within a class, unversioned across. Phase 1
unpins `mos-podman` on `mos-system` and removes `@SYSTEM_VERSION@` and
`--system-version` with it; `mosd` and `mos-apid` stay exactly pinned on
`mos-system` until Phase 5 moves them across the boundary.

### 7. The shared substrate as a source pin

Decided 2026-09-13 (user): repositories are not linked by submodules but by
pins in the shape of the Debian pins -- a JSON file per dependency naming a
version (commit) and a hash -- so each repository builds on its own and
depends by pin. `build-env/` becomes `mica-build-env`, published on every
commit as the release asset `mica-build-env-<commit12>.tar.gz`, and every
consumer carries `deps/sources/mica-build-env.json` (name, repository,
commit, path, asset, sha256) and a vendored `tools/deps.sh` that fetches,
verifies and unpacks it into the gitignored `build-env/`, recording the pin
in `build-env/.deps-pin`; no consumer changes path. `mica-debian` is pinned
the same way at `rootfs/debian/`. Each repository's `Makefile` refuses with
`make deps` when `build-env/from.sh` is absent, and the lineage record
requires each directory at its pin. Builder images stay locally built
(`make build-env`); publishing them to the container registry is decision 3.

### 8. Local development loop

```sh
cd /srv/micad
MOS_POOL_DIR=/srv/mica-build/_out/debs make os-debs   # dirty stamp, into the assembly's pool
cd /srv/mica-build
bash build-env/deb/repo.sh --arch amd64
MOS_POOL_UNLOCKED="mosd mos-apid" MOS_BOARD=x64 bash rootfs/build.sh
```

`MOS_POOL_DIR` is a new optional override of `_out/debs` in `build.sh` and
`repo.sh`; unset, both behave as today.

### 9. Gate relocation

| Gate | Today | After |
|---|---|---|
| `os-rust-gate` (fmt, clippy, nextest, deny, openapi drift) | `mica-build` CI | `micad` and `mica-deploy` CI, each over its own workspace |
| `os-apid-ui-build-contract-test`, `os-apid-api-spec-pins`, `apid/ui/run.sh` | `mica-build` CI | `micad` CI |
| `os-dbus-policy-test` | manual (root) | `micad`, same privilege note |
| `os-apid-api-test` (boots the image) | manual | `micad`, driven with `MOS_QEMU_IMAGE` at an assembly image; the assembly's delivery record names the mosd commit it ran |
| `os-file-transaction-faults`, `tests/boot-shutdown-test.sh` | `mica-build` CI | `mica-deploy` CI |
| `podman`, `podman-pins`, `podman-pins-test` | `mica-build` | `mica-podman` |
| `deb-package-gate.sh` | `mica-build`, whole pool | every repository with producers, over its own pool, before publish; the assembly over its own archives |
| `os-install-closure-gate` | `mica-build` | `mica-build`, over the fetched + assembly-built pool |
| `os-smoke-test`, `os-verify`, `os-factory-root-gate`, image assembly | `mica-build` | unchanged; pins come from the pool's control fields and the lock |
| `netavark-kernel-config-test` | reads `pkgs/podman/versions.env` | reads `/usr/share/mos/podman/versions.env` shipped in the `mos-podman` archive from `mica-podman` (new payload file) |
| `quadlet-doc-test` | runs `pkgs/podman/out-arm64/quadlet` | runs `quadlet` extracted from the fetched arm64 archive |
| `host-toolchain-lint` | whole tree | unchanged in `mica-build`; each package repository runs it through the submodule |

### 10. Repository hygiene for the new repositories

Each new repository gets `AGENTS.md` with `CLAUDE.md` symlinked (PMA
injection naming its stack skill), `README.md`, `LICENSE`, `.gitignore`,
`.gitattributes` (the two `linguist-generated` rows move with `micad`),
`.editorconfig`, `VERSION`, `docs/{task,plan}/index.md`, `docs/changelog.md`
and the `build-env` submodule. History comes from
`git subtree split -P pkgs/<dir>`.

### 11. Documentation

System-level design records stay in `mica-build`
(`docs/design/{mosd,api,bus,dashboard,connd,containers}.md`). Prose citations
of `pkgs/...` become `<repository>:<path>`; the OpenAPI link becomes a URL
into `micad`. `docs/architecture.md` gains a *Repositories* section;
`docs/design/build.md` 1.1 and `build-harness.md` 2 describe `os-pool`, the
lock and the gate relocation; `pkgs/README.md` says what is left
(`mos-boot`) and where the rest went.

### 12. Renaming to Mica OS

Decided 2026-09-12: the split and the rename proceed together. The phase
that moves a component renames what it moves, so no repository is created
under a name it will not keep and no archive is published twice for a
rename. The table was confirmed by the user on 2026-09-12 23:20:

| Today | Proposed | Renamed in |
|---|---|---|
| `mosd`, `mos-apid`, `mos-mqttd`, `mos-mqtt-broker` (packages and binaries), `pkgs/mosd/` workspace, `mosd.service`, `apid.service` | `micad`, `mica-apid`, `mica-mqttd`, `mica-mqtt-broker`; `micad.service`, `mica-apid.service` | Phase 5 (`micad`) |
| `mos-deploy`, `mos-init`, `mos-shutdown` (packages, binaries, `pkgs/mos-deploy/`) | `mica-deploy`, `mica-init`, `mica-shutdown` | Phase 4 (`mica-deploy`) |
| `mos-podman` | `mica-podman` | Phase 3 (`mica-podman`) |
| `mos-system`, `mos-busybox`, `mos-ca-trust`, `mos-profile-*`, `mos-wifi*`, `mos-bluetooth`, `mos-health.service` | `mica-system`, `mica-busybox`, `mica-ca-trust`, `mica-profile-*`, `mica-wifi*`, `mica-bluetooth`, `mica-health.service` | Phase 3a (`mica-system`) |
| `mos-board-*`, `mos-s905x5m-*`, `mos-bm201-front-panel` (stay in the assembly) | `mica-board-*`, `mica-s905x5m-*`, `mica-bm201-front-panel` | Phase 6 |
| D-Bus `com.mos.*` (`com.mos.mosd`, `com.mos.control`, `com.mos.ext.*`; 57 files) | `com.mica.*` | Phase 5, with `micad` |
| `/usr/lib/mos`, `/etc/mos`, `/var/lib/mos`, `/usr/share/mos` (root layout; 82/56/43 files) and the `mos-*` state directories | `/usr/lib/mica`, `/etc/mica`, `/var/lib/mica`, `/usr/share/mica` | Phase 3a (`mica-system` owns the layout), consumers follow in 4 and 5 |
| `MOS_*` build and runtime variables, `make os-*` targets, `mos-build-*` images, `Mos-Source-*` control fields | `MICA_*`, `make os-*` unchanged, `mica-build-*`, `Mica-Source-*` | Phase 6, last, as one mechanical sweep |

The on-device names (bus, paths, state directories) are a runtime
compatibility break for existing installs; migration was waived on
2026-09-11 and the rename lands while the tree is in its development
phase. `rootfs/runtime/consumers.json` (115 rows keyed by package) and
`rootfs/packages/*.pkgs` are rewritten with each package rename, and
`verify/src/smoke-register.ts` with each binary rename.

### Phase order

Each phase ends with an x64 image composed, verified (`os-verify`) and
smoke-tested from the pool as it stands.

- **Phase 0 — preflight and decisions.** Closed 2026-09-12: registry and
  token confirmed, repository renamed, the four repositories created,
  `origin` repointed, the throwaway upload/download/delete round trip done,
  the runner question answered (none registered; see *Forge facts*),
  decisions 3 and 4 recorded under *Annotations*.
- **Phase 1 — the mechanism, inside this tree.** Done 2026-09-12
  (commits `882ed749` to `42b76d50`): provenance fields, manifest columns,
  `VERSION` + `version.sh`, `fetch.sh`/`lock.sh`/`publish.sh`/`source.sh`,
  `MOS_POOL_DIR`, the composer's two-class rule, retirement of the fixed
  producer join (3a), `os-pool`, the unlocked marker and its release refusal,
  the negative tests. Proven by publishing the locally built `mos-podman`,
  locking it (`3a731a71`), deleting the local archive and composing x64 and
  virt-arm64 from the fetched copy; the x64 image passed `os-verify` and the
  release gate with the lock rows in `provenance.json`. Pre-existing defects
  met on the way are `20260912-2236-phase1-findings`.
- **Phase 2a — release transport.** Done 2026-09-13: `fetch.sh`,
  `lock.sh` and `publish.sh` moved from the Gitea Debian registry to GitHub
  Releases (section 1); `tests/pool-lock-test.sh` drives them against a stub
  of the release API (20 checks).
- **Phase 2 — `mica-build-env` and `mica-debian`.** Done 2026-09-13:
  `build-env/` (14 commits) and `rootfs/debian/` (20 commits) subtree-split
  from `75a29d4d`, pushed to GitHub, added back as submodules at their old
  paths; `tests/deb-package-gate.sh` became `build-env/deb/package-gate.sh`
  and the two Debian tests `rootfs/debian/tests/`, each deriving the
  consumer from its new depth. Revised the same night per section 7: the
  submodules were replaced by source pins (`deps/sources/*.json`, `make
  deps`, `tools/deps.sh`), the directories are gitignored, CI runs `make
  deps` with the `MICA_DEPS_TOKEN` secret, and the lineage identity requires
  each directory at its pin. Neither new repository runs standalone: both are
  consumed through `mica`. Gitea mirrors pending (host down).
- **Phase 3 — `mica-podman`.** The 45-minute arm64 build leaves this tree.
  Move the two overlay files and the pins test, rename the package, publish,
  lock, delete `pkgs/podman`, rewire the four podman tests.
- **Phase 3a — `mica-system`.** Subtree-split `rootfs/packages-src/` and
  `rootfs/overlay/`, rename the eight packages and the root layout
  (section 12), publish, lock, delete both directories; the composer's
  `packages/*.pkgs`, `consumers.json` and the assembly tests follow the new
  names.
- **Phase 4 — `mica-deploy`.** Publish `mos-deploy` and `mos-lifecycle`;
  `kernel-package.ts` takes both executables from the fetched archive;
  contract fixtures, the faults suite and the shutdown test move; the
  early-hang fixture builds from `source.sh`'s checkout; delete
  `pkgs/mos-deploy`.
- **Phase 5 — `micad`.** Move the workspace, its gates and the apid-api
  harness; the mosd build record comes from the control field; delete
  `pkgs/mosd`; the `rust` job leaves `check.yml`.
- **Phase 6 — clean-up.** Makefile help and targets, `check.yml`, docs
  citations, `AGENTS.md` skill stack (`/pma-rust` moves to the new
  repositories), `pkgs/README.md`, changelog.

## Verification

### Phase 1

Run 2026-09-12; results in the task record's *Verification*.

- `fetch.sh` negatives, each red by name: altered sha256; `source-commit`
  differing from the control field; a version the registry does not hold;
  401/403 with no token. (`tests/pool-lock-test.sh`, 16 checks, against a
  stub registry that requires the token.)
- Composer negatives, each red by name: an archive no lock row and no local
  producer names; a lock-named archive with one byte changed; `MOS_POOL_UNLOCKED`
  naming a package not in the pool.
- Positive: `os-pool`, then `rootfs/build.sh` for x64 and virt-arm64, then
  `os-verify`, `os-smoke-test`, `os-install-closure-gate`,
  `os-factory-root-gate` green with `mos-podman` fetched and the rest built
  here. (All green except the factory-root gate's device negative case and
  the package gate's board-package overlap, both pre-existing; see the
  findings task.)
- `release-manifest.ts` refuses an unlocked image in `candidate` and
  `stable`, accepts it in `development`; fixture test beside the
  development-marker cases.
- The fixed join is gone: `git grep` finds no `producer-join`,
  `MOS_ROOTFS_PRODUCER_JOIN`, `JOIN_`, `STARTUP_NATIVE` or `GPT_NATIVE`
  outside `docs/changelog.md`; `source_lineage_test.py` and
  `release-manifest.test.ts` prove the lock-row path, positive and with one
  altered row.
- `docs-verify`, `os-host-toolchain-lint`, `os-shell-pipefail-lint` green.

### Phases 2 to 5 (each extraction)

- The new repository's CI runs its gates and `deb-package-gate.sh` and
  publishes; the archive's control fields name the new repository and its
  `HEAD`.
- In `mica-build`: `lock.sh --bump` produces the expected diff; `os-pool` fetches;
  the x64 image composes and passes the gate set above; `git grep pkgs/<dir>`
  outside `docs/` returns nothing.
- `mica-deploy`: the kernel component builds with the archive's executables;
  `tests/file-ab-x64/` runtime, update and fault cases pass under QEMU; the
  early-hang case still trips the watchdog.
- `micad`: `os-apid-api-test` from its checkout against the assembly's
  image passes; the smoke commit row is green from the control field with no
  `_out/mosd-build-<arch>.txt` present.

### Phase 6

- `make docs-verify docs-verify-test` green; `check.yml` runs without the
  moved jobs; `make help` lists no target under a deleted directory.

## Risks

- **CI for the new repositories.** The arm64 packaging is emulated and the
  podman build is long; the package repositories need the same docker+buildx
  runner. A repository without one publishes from a developer machine with
  `publish.sh`, which the provenance fields make visible.
- **Provenance becomes two-level.** An image is reproduced from the assembly
  commit *plus* the lock; `provenance.json` records the lock rows and the
  release gate reconstructs and compares them as it does the SBOM.
- **The fixed join is retired, not generalised.** Until Phase 1 lands, every
  further pool reuse costs a reviewed edit of two constant tables and their
  tests; that cost is the argument for Phase 1 first. Its delta allowlists
  also name task and plan files (one already deleted); no replacement may
  list a document.
- **Unlocked images leaking.** Covered by the release-channel refusal and
  the identity marker.
- **Submodule ergonomics.** A checkout without `--recurse-submodules` has an
  empty `build-env/`; every Makefile refuses with the init command.
  Worktrees need `git submodule update` each.
- **Assembly tests that compile package source** now depend on a clone at
  the locked commit; they are already docker-and-network tests and
  `source.sh` refuses offline by name.
- **Exact pins dropped across the boundary.** APT no longer refuses a
  mismatched `mosd`/`mos-system` pair; the lock expresses it at the assembly
  and the install-closure gate still proves the set installs together.
- **Concurrent work.** Branches touching `pkgs/mosd` and `boards/` should be
  merged or rebased before Phase 5; Phases 1 to 3 do not move `pkgs/mosd`.
- **Docs churn.** Sixty-odd prose citations of `pkgs/...` rewritten in
  Phase 6; the link gate catches the relative ones, grep the rest.

## Scope

- Phase 1: `build-env/deb/{pack.sh,build.sh,repo.sh,version.sh,preflight.sh}`,
  new `build-env/deb/{fetch.sh,lock.sh,publish.sh,source.sh}`, `VERSION`,
  `rootfs/packages/lock.tsv`, `rootfs/build.sh`, `rootfs/runtime/source-lineage.py`,
  `Makefile`, `build/src/release-manifest.ts` (+ test), `verify/src/smoke.ts`,
  `tests/deb-package-gate.sh`, `tests/rootfs-runtime/source_lineage_test.py`,
  new negative tests, `docs/design/build.md`. About 18 files.
- Phase 2: `build-env/` out, `.gitmodules` in, `Makefile` preflight, CI
  checkout step. About 6 files plus the new repository.
- Phase 3: `pkgs/podman/` (15 files) and two overlay files out;
  `tests/{podman-pins-test,quadlet-doc-test,netavark-kernel-config-test,deb-preflight-test,install-closure-gate}.sh`,
  `verify/src/smoke-pins.ts`, `Makefile`, `check.yml`. About 12 files.
- Phase 4: `pkgs/mos-deploy/` (47 files), `tests/component-contracts/`,
  `tests/file-ab-faults/`, `tests/boot-shutdown-test.sh` out;
  `build/src/kernel-package.ts`, fixture paths in `build/src/*.test.ts` and
  `update-server/src/*`, `tests/file-ab-x64/early-hang-init.sh`, `Makefile`,
  `check.yml`. About 15 files.
- Phase 5: `pkgs/mosd/` (354 files) out; `tests/rust-gate.sh`,
  `tests/apid-ui-build-contract-test.sh`, `tests/p1-writable-path-audit/boot.sh`,
  `rootfs/build.sh`, `verify/src/smoke-pins.ts`, `Makefile`, `check.yml`,
  `.gitattributes`. About 10 files.
- Phase 6: docs and `AGENTS.md`; about 60 files, prose only.

## Alternatives

- **OCI images instead of Debian archives.** Both registries exist, so this
  is a format question. An image carries no dependency metadata (the
  `dpkg-shlibdeps` `Depends` computed at the target architecture is lost),
  no install transaction (the install-closure gate no longer proves the
  selected set installs into the pinned base, and the Debian base stays
  `.deb` either way, so the root is composed from two formats), no maintainer
  scripts (three `postinst` and the `ENABLEMENT` contract become composer
  steps) and no ownership database (`consumers.json` keys 115 rows by
  package; `select.py`, `shipped_packages`, the copyright inventory and
  `manifest.tsv` read dpkg ownership). What it adds, a content-addressed
  digest and layer de-duplication, the lock already gives per archive.
  OCI as transport only gains nothing over the Debian registry, which also
  serves the APT index `lock.sh` reads. OCI stays where it already is:
  builder images, the `factory-root.oci` export, buildx stage hand-off.
  **Decided 2026-09-12: archives.**
- **APT straight at the registry from the compose Dockerfile, no lock.**
  No offline compose, no reviewable import diff, a reproduced build can
  differ. Rejected.
- **Submodules of package source into the assembly.** The assembly still
  compiles and re-gates every package on every image. Rejected.
- **`git subtree` instead of a submodule for `build-env`.** No pin to a
  commit, duplicated history. Rejected.
- **Publishing raw binaries per package.** Needs a second packaging step in
  the assembly and loses `dpkg-shlibdeps` at the producer. Rejected.

## Annotations

- Decided 2026-09-12: one repository per package, named for Mica OS:
  `mica-build` (this repository), `mica-build-env`, `micad`, `mica-deploy`,
  `mica-podman` under `ybolab`; Debian archives remain the package format.
  `mica-build-env` is the prefix rule applied to the substrate; not
  explicitly confirmed by the user. History of the earlier drafts and probes is in
  `docs/changelog.md`.
- Approved 2026-09-12 21:00 ("你来做拆分计划"); Phase 1 implemented the same
  evening inside this tree.
- Decision 3 (2026-09-12): builder images stay locally built with
  `make build-env` in every repository; publishing them to the container
  registry is not part of this plan.
- Decided 2026-09-12 (user): the split and the Mica OS rename proceed
  together, per section 12; the table was confirmed at 23:20 together with
  the move to GitHub (`git@github.com:ybolab/mica.git` as the documentation
  and main repository, one GitHub repository per package) and the local
  layout `/srv/ybolab/mica/<repository>/`. `ybolab/mica` already existed on
  GitHub (empty); `mica-build-env`, `micad`, `mica-deploy`, `mica-podman`,
  `mica-debian` and `mica-system` were created private on 2026-09-12 23:25
  after the `aamf` account's pending organisation membership was accepted.
  `origin` of this checkout is `git@github.com:ybolab/mica.git` (the Gitea
  remote is kept as `gitea`); nothing has been pushed, and this machine's
  SSH key is not registered with GitHub yet (`git@github.com` answers
  "Permission denied (publickey)"), so the first push needs either
  `gh ssh-key add ~/.ssh/id_ed25519.pub` or an https remote. Asked the same day whether `rootfs/`, and the Debian base in
  particular, should be a repository of its own: `rootfs/debian` yes, as
  the `mica-debian` submodule; `rootfs/packages-src` + `overlay` yes, as
  `mica-system` through the lock; the composer no (rationale under *Target
  repository set*).
- Decision 4 (2026-09-13, revised): the token is `GH_TOKEN` (named, never
  printed, by `build-env/deb/registry.env`; `gh auth token` on a developer
  machine); in a package repository's workflow it is the job's
  `GITHUB_TOKEN` with `contents: write`, which may create releases and
  upload assets of its own repository, and in the assembly's workflow a
  fine-grained token that reads the package repositories' releases.
  Runners are GitHub-hosted; the builder images are built by `make
  build-env` in each job until decision 3 is revisited for speed.
- Decided 2026-09-13 (user): packages are published by workflows as
  releases, not through a package registry of our own (section 1).
