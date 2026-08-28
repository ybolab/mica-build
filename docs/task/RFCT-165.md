# RFCT-165 PLAN-019 M1: the os/pkgs target layout, designed before it is executed

- **status**: completed
- **priority**: P2
- **owner**: (bkd campaign)
- **createdAt**: 2026-08-27
- **claimedAt**: 2026-08-27
- **plan**: PLAN-019 (M1)

PLAN-019 Decisions item 1 says the layout is designed before it is executed:
M2 through M5 move files, and this milestone decides where they land. Nothing
in the tree moves here. The two files this record touches are itself and its
index row.

Everything below was measured at `1bbd799` in a fresh BKD worktree. Where the
plan's own "Measured consumer surface" section states a number, this record
either confirms it against a quoted command or corrects it. Three of the
plan's claims needed correcting; they are marked **CORRECTION** where they
appear.

---

## A. Target tree

Every top-level directory, and every child of `os/`, as it stands after
PLAN-019 completes. Directories that do not move say so.

```
mos/
├── .github/          CI: check.yml, the single workflow. DOES NOT MOVE.
├── docs/             all project documentation. DOES NOT MOVE.
│   ├── design/       live design records; the only tree docs/verify-citations.sh scans
│   ├── plan/         PMA plans; dated history (Decisions item 4)
│   ├── research/     dated research records; history
│   ├── task/         dated task records; history
│   ├── architecture.md, README.md   the two live top-level documents
│   └── verify-citations.sh, verify-index.sh   the two gating checkers
├── os/               the OS build
│   ├── boards/       one board.env per board: partition geometry and layout constants. DOES NOT MOVE.
│   ├── build/        TypeScript: image assemblers, bundle builder, toolset wrappers. DOES NOT MOVE.
│   ├── build-env/    the pinned builder images every component build is FROM. DOES NOT MOVE.
│   ├── pkgs/         NEW. Every component this repository builds from source.
│   │   ├── podman/     ← os/podman.      Container engine, built FROM scratch into out-<arch>/
│   │   ├── rauc/       ← os/update/rauc. RAUC binary, slot config and manifest templates
│   │   ├── rauc-sign/  ← update/sign.    RAUC/TUF trust tooling; its OWN cargo workspace
│   │   └── mosd/       ← mosd/.          Rust workspace: mosd, apid, mqttd, broker, settings, busname
│   ├── rootfs/       stage Dockerfiles and build-v2.sh; assembles the root filesystem. DOES NOT MOVE.
│   ├── tests/        shell suites over the built image. DOES NOT MOVE.
│   ├── tools/        three QEMU helper scripts. DOES NOT MOVE.
│   └── verify/       TypeScript: the board model and the checks an image must pass. DOES NOT MOVE.
├── extensions/       the optional-sysext slot; a README and nothing else. DOES NOT MOVE.
├── test/             the apid HTTP API suite (test/apid-api). DOES NOT MOVE.
├── Makefile          top-level routing. DOES NOT MOVE.
├── README.md         the repository's front page. DOES NOT MOVE.
└── .gitignore        DOES NOT MOVE.
```

Two directories that exist at `1bbd799` are **gone** afterwards:

- `os/update/` — its only child is `rauc/`. Once that leaves, git removes the
  empty parent. Measured: `git ls-files os/update` returns 8 paths, all under
  `os/update/rauc/`.
- `update/` — its children are `README.md` and `sign/`. `sign/` moves,
  `README.md` folds in, the parent goes. Measured: `git ls-files update`
  returns 11 paths, 1 README and 10 under `sign/`.

The organising rule of `os/pkgs/` is not "Rust things" or "container things".
It is **provenance**: a directory under `os/pkgs/` holds source this repository
compiles into a shipped artefact. `os/build`, `os/verify` and `os/rootfs`
*assemble* and *check*; `os/build-env` supplies the compilers; `os/pkgs`
is what gets compiled.

`os/pkgs/rauc-sign` is the one member that does not fit that rule cleanly, and
it is worth naming rather than hiding: `update/README.md:6` says the release
half "runs on a build host, never on a device", while `update/README.md:9` says
the device half verifies on the device. So it is half build-host tool, half
shipped component. The user settled the destination in PLAN-019 Decisions item
5; this record does not reopen it, only records that the directory's rule has
one member it stretches to hold.

---

## B. Migration table

| # | old path | new path | kind of move |
| --- | --- | --- | --- |
| 1 | `os/podman/` | `os/pkgs/podman/` | `git mv` of a whole tree (6 tracked files, incl. `.gitignore`) |
| 2 | `os/update/rauc/` | `os/pkgs/rauc/` | `git mv` of a whole tree (8 tracked files) |
| 3 | `os/update/` | — | deletion of a now-empty parent (implicit; git tracks no directories) |
| 4 | `update/sign/` | `os/pkgs/rauc-sign/` | `git mv` of a whole tree (10 tracked files) **+ workspace extraction** |
| 5 | `update/README.md` | `os/pkgs/rauc-sign/README.md` | file fold-in |
| 6 | `update/` | — | deletion of a now-empty parent |
| 7 | `mosd/` | `os/pkgs/mosd/` | `git mv` of a whole tree (incl. `.gitignore` and `.cargo/config.toml`) |
| 8 | package `mos-sign` (`update/sign/Cargo.toml:2`) | package `rauc-sign` | crate rename |
| 9 | binary `mos-sign` (from `src/main.rs` + package name) | binary `rauc-sign` | binary rename, follows the package name |
| 10 | `update/sign/src/bin/mos-update-verify.rs` | `os/pkgs/rauc-sign/src/bin/rauc-verify.rs` | file rename, **which is** the binary rename |
| 11 | lib crate `mos_sign` | lib crate `rauc_sign` | implied by row 8; 10 `use mos_sign::` sites |
| 12 | *(no new file)* | `os/pkgs/rauc-sign/Cargo.toml` `[workspace]` + `Cargo.lock` + `deny.toml` | creation, required by the extraction |
| 13 | *(no new file)* | **PROPOSED** `os/pkgs/README.md` | creation — see E, proposal P2 |

Rows 1–12 are ratified by PLAN-019 (Proposal M2/M3/M4 and Decisions item 5).
Row 13 is this record's own proposal and is marked so.

Two things the table hides, both load-bearing:

**Rows 1 and 2 are not symmetric.** `os/pkgs/rauc` sits at the same depth as
`os/update/rauc` — three levels below the repo root — so rauc's path arithmetic
survives untouched. `os/pkgs/podman` is one level *deeper* than `os/podman`, so
podman's breaks. Quoted:

```
os/podman/build.sh:20:     REPO_ROOT="$(cd "${HERE}/../.." && pwd)"        <- becomes ../../..
os/update/rauc/build.sh:15: REPO_ROOT="$(cd "${HERE}/../../.." && pwd)"    <- unchanged
os/update/rauc/render-config.sh:19: REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"  <- unchanged
os/update/rauc/build.sh:22: LAYOUT_ENV="${HERE}/../../boards/${MOS_BOARD}/board.env"  <- unchanged
os/update/rauc/render-config.sh:44: # shellcheck source=../../boards/cx3576/board.env <- unchanged
```

Both scripts carry a self-describing error for exactly this failure —
`os/podman/build.sh:23` "derives REPO_ROOT as two levels above itself; if this
file moved, that arithmetic moved with it", and `os/update/rauc/build.sh:18`
the three-level equivalent. M2 must edit podman's and leave rauc's alone,
including the word "two" in that message.

**`os/podman/.gitignore` is written in relative terms and travels intact.**

```
os/podman/.gitignore:1: out-arm64/
os/podman/.gitignore:2: out-amd64/
os/podman/.gitignore:3: versions.lock
```

The repo-root `.gitignore` writes rauc's equivalents as absolute paths and does
need editing. See C.

---

## C. Consumer inventory, re-measured at `1bbd799`

### The commands

Three of the four trees are plain substrings, so:

```
git grep -l -F "<path>" -- .          # file count
git grep -c -F "<path>" -- . | awk -F: '{s+=$NF} END{print s}'   # line count
```

`mosd` is not: a plain `git grep -F "mosd/"` also matches `os/pkgs/mosd/`-style
sub-paths and, more importantly, cannot tell a repo path from a runtime one.
The measurement used is

```
git grep -cP '(?<![/\w.-])mosd/' -- . ':(exclude)mosd/'
```

which requires `mosd/` to start a path token. Every one of its 947 hits was
sampled by class and **all are repo-relative**; the tree has no `/etc/mosd/` or
`/var/lib/mosd/` string that this pattern would have swept up. The complement
check `git grep -n -E "/(etc|var/lib|usr/lib|usr/share|run|var/log)/mosd/"`
returns **0**, so the distinction cost nothing here — but a naive `-F "mosd/"`
would still have to be re-justified, and this one does not.

### Totals

| tree | files | lines |
| --- | --- | --- |
| `os/podman` | 48 | 122 |
| `os/update/rauc` | 65 | 193 |
| `update/sign` | 26 | 50 |
| `mosd/` (outside `mosd/` itself) | 151 | 2071 |
| `mosd/` (self-references inside `mosd/`) | 19 | 54 |

### By class

`os/podman` — 48 files, 122 lines

| class | files | lines |
| --- | --- | --- |
| build orchestration (`Makefile`) | 1 | 3 |
| container build / shell | 20 | 57 |
| source | 9 | 16 |
| tests | 2 | 2 |
| ignore files | 1 | 1 |
| docs-live | 2 | 2 |
| docs-history (`docs/task`) | 8 | 31 |
| docs-history (`docs/plan`) | 5 | 10 |
| CI | 0 | 0 |

`os/update/rauc` — 65 files, 193 lines

| class | files | lines |
| --- | --- | --- |
| build orchestration | 1 | 3 |
| container build / shell | 19 | 48 |
| source | 15 | 43 |
| tests | 4 | 10 |
| ignore files | 6 | 12 |
| docs-live | 7 | 29 |
| docs-history (`docs/task`) | 11 | 40 |
| docs-history (`docs/plan`) | 2 | 8 |
| CI | 0 | 0 |

`update/sign` — 26 files, 50 lines

| class | files | lines |
| --- | --- | --- |
| container build / shell | 1 | 2 |
| source | 3 | 5 |
| ignore files | 1 | 1 |
| docs-live | 7 | 10 |
| docs-history (`docs/task`) | 10 | 20 |
| docs-history (`docs/plan`) | 4 | 12 |
| CI | 0 | 0 |

`mosd/` — 151 files, 2071 lines outside the tree itself

| class | files | lines |
| --- | --- | --- |
| build orchestration | 1 | 2 |
| CI (`.github/workflows/check.yml`) | 1 | 19 |
| container build / shell | 5 | 13 |
| source | 17 | 39 |
| tests | 2 | 3 |
| docs-live | 12 | 871 |
| docs-history (`docs/task`) | 100 | 924 |
| docs-history (`docs/plan`) | 9 | 76 |
| docs-research (history) | 1 | 89 |

Of the 12 docs-live files, 10 are `docs/design/*.md` (836 lines),
`docs/architecture.md` is 8, and `docs/verify-citations-test.sh` is 27.

### The number that actually governs M5

Line counts overstate the work, because the gate checks *citations*, not lines.
The gated corpus is `docs/design/*.md` excluding `*.zh.md`, plus
`docs/architecture.md` (read the header of `docs/verify-citations.sh`).
Backticked `` `path:line` `` citations carrying an old prefix, measured with
`grep -oP '`<prefix>[^`]*:[0-9]+(-[0-9]+)?`'` over exactly that file set:

| prefix | gated citations | where |
| --- | --- | --- |
| `mosd/` | **708** | api.md 612, dashboard.md 72, remote-management.md 19, bus.md 5 |
| `os/update/rauc` | **18** | api.md 11, dashboard.md 6, boards.md 1 |
| `os/podman` | **0** | — |
| `update/sign` | **0** | — |

**726 of the 902 in-scope citations — 80.5% of the entire gated corpus —
carry a prefix this campaign rewrites.** That is the single largest fact in
this inventory, and it is concentrated: `docs/design/api.md` alone holds 623
of the 726.

### Confirming or correcting the plan's specific claims

**Makefile `:46, :134, :227, :287` — CONFIRMED, but incomplete.**
All four line numbers are still exactly what the plan says:

```
46:  	@echo "  podman              build the container engine from source into os/podman/out-\$$MOS_ARCH"
134: 	bash os/update/rauc/gen-dev-keys.sh
227: 	MOS_BOARD=$(or $(MOS_BOARD),cx3576) bash os/update/rauc/build.sh
287: 	bash os/podman/build.sh
```

The plan describes these as "podman/rauc build targets". Two of the four are
not recipe lines: `:46` is a `make help` echo, `:227`/`:134`/`:287` are recipes.
And the podman/rauc surface in the Makefile is **six** lines, not four — the
plan omits two comment lines:

```
220: # is recorded in os/update/rauc/versions.env: the distribution builds it with
285: # this image's libc; os/podman/README.md has the reasoning.
```

Plus two mosd lines the plan folds into "every mosd target" without numbering:

```
147: # mosd/dist/com.mos.mosd.conf, owns com.mos.mosd from a root connection, and
154: 	bash mosd/hack/dbus-policy-test.sh
```

Total Makefile surface for this campaign: **8 lines**, at `:46 :134 :147 :154
:220 :227 :285 :287`. The three affected targets are `os-devkeys` (`:133`),
`os-rauc` (`:226`), `podman` (`:286`), and `os-dbus-policy-test` (`:153`).

**".gitignore: 6+ lines" — CORRECTED to 8, and the file split is different
from what the phrasing implies.** The repo-root `.gitignore` carries exactly 8
lines naming an old path, at `:8 :11 :13 :15 :16 :26 :27 :28`. Four are
executable ignore rules and four are comments:

```
 8: update/sign/.devkeys/
11: # os/update/rauc/gen-dev-keys.sh. Key material is never committed; a committed signing
13: os/update/rauc/.devkeys/
15: # The RAUC system configuration is RENDERED from os/update/rauc/system.conf.in and
16: # os/boards/cx3576/board.env by os/update/rauc/render-config.sh, which os/rootfs/build-v2.sh
26: # Built by os/update/rauc/build.sh, like os/podman/out-*: compiled artefacts, not source.
27: os/update/rauc/out-*/
28: os/update/rauc/versions.lock
```

`.gitignore:6` also names the **binary** `mos-sign` and so belongs to
deliverable D as well as here.

The important structural point the plan's phrasing misses: **there is no
`os/podman/out-*` rule in the root `.gitignore` at all.** Podman's artefacts
are ignored by `os/podman/.gitignore`, which is relative and moves with the
tree. So M2 edits the root `.gitignore` for rauc only, and touches podman's
own ignore file not at all. `git grep -n -E "os/podman|os/update/rauc|update/sign"
-- '.gitignore' '*/.gitignore'` returns 8 root-file hits and 0 from any nested
ignore file.

**"os/build/src: comments and error strings naming os/update/rauc and its
versions.env; bundle-cli's signing-material defaults" — CONFIRMED.**
`git grep -n -F "os/update/rauc" -- os/build/` returns 39 lines across 11 files
(`HARNESS.md`, `run.sh`, `bundle.ts`, `bundle.test.ts`, `bundle-cli.ts`,
`bundle-cli.test.ts`, `tools/rauc.ts`, `tools/rauc.test.ts`, `toolsets.ts`).
`bundle-cli.ts:52` is the signing-material line: "`CERT KEY KEYRING     real
signing material, instead of os/update/rauc/.devkeys`". The default itself is
`DEVKEY_DIR`, imported at `bundle-cli.ts:26` and applied at `:128` — a symbol,
not a literal, so the constant's definition is the only place the path is
written once.

**"CI: the rust job builds the mosd workspace" — CONFIRMED, with a correction
to how.** `.github/workflows/check.yml` carries 19 `mosd/` lines. CI does
**not** use the pinned container image; it installs a rustup toolchain on the
GitHub runner and reads the MSRV out of the manifest:

```
 85:           version=$(sed -n 's/^rust-version *= *"\([^"]*\)".*/\1/p' mosd/Cargo.toml | head -1)
 86:           [ -n "$version" ] || { echo "no rust-version in mosd/Cargo.toml" >&2; exit 1; }
141:         run: bash mosd/hack/check.sh
159:           cargo run --locked --manifest-path mosd/Cargo.toml -p apid -- --openapi \
161:           diff -u mosd/apid/openapi.json "$tmp/openapi.json" || {
209:           if ! git cat-file -e FETCH_HEAD:mosd/apid/openapi.json 2>/dev/null; then
246:           git show FETCH_HEAD:mosd/apid/openapi.json >"$tmp/base-openapi.json"
248:           "$tmp/oasdiff" breaking "$tmp/base-openapi.json" mosd/apid/openapi.json \
```

`:209` and `:246` read the OpenAPI document out of the **merge base**, not the
working tree. On the first PR after M4 the base still carries the old path, so
`:209`'s `git cat-file -e` fails and the step takes its documented skip
("`skipped: ${base} carries no mosd/apid/openapi.json`") rather than erroring.
That is the graceful outcome and it self-heals on the next PR. It should be
expected, not diagnosed as a break.

**"docs/design: hundreds of `mosd/...` path:line citations" — CONFIRMED and
sharpened to 708** (see the table above). The plan says "hundreds"; the exact
number matters because it sets M5's size.

### The live-versus-dated split (Decisions item 4)

| classification | trees | rule |
| --- | --- | --- |
| **moves** | `Makefile`, `.gitignore`, `.github/`, `os/**`, `test/**`, `mosd/**`, `README.md`, `docs/architecture.md`, `docs/design/*.md`, `docs/README.md` | live; must name where things are |
| **stays** | `docs/task/*.md`, `docs/plan/*.md`, `docs/research/*.md` | dated history; names where things were |

`docs/research/` is classified as history rather than live, and the evidence is
in the files themselves rather than in a convention:
`docs/research/mos-ui-inventory.md:581` cites `mosd/webd/src/settings_api.rs`
— a daemon renamed to `apid` before `1bbd799` — and `:584` cites
`os/update/bundle.sh`, which does not exist (`git ls-files os/update` returns
only `os/update/rauc/**`). A document already citing two paths that HEAD does
not have is a dated record, and `docs/verify-citations.sh` correctly does not
scan it.

`docs/verify-citations-test.sh` is live but needs **no** edit. Its 27 `mosd/`
occurrences are fixture strings inside a synthetic tree it builds itself —
`:61` runs `mkdir -p "${dir}/docs/design" "${dir}/mosd/apid/src"` under a
`mktemp -d` root. The checker's scope rule ("first segment names a directory
that exists at the repo root", per its header) is evaluated against that
fixture root, so it stays green after `mosd/` leaves the real root. What it
becomes is *cosmetically* stale: a self-test whose example path names a
directory the tree no longer has. See E, proposal P4.

### `.zh.md` path tokens (Decisions item 3)

Two lines, both in `docs/research/`, both naming `update/sign`:

```
docs/research/init-strategy.zh.md:83
docs/research/os-comparison.zh.md:159
```

Their English siblings carry the same token at `init-strategy.md:96` and
`os-comparison.md:190`. Since `docs/research/` is classified as history above,
**the consistent ruling is that neither the English nor the Chinese line
changes**, and Decisions item 3's licence is not exercised at all in this
campaign. No `.zh.md` file names `os/podman`, `os/update/rauc`, or `mosd/`.

---

## D. Binary rename inventory

### Where the names are declared

There is **no `[[bin]]` section anywhere in the crate.** `update/sign/Cargo.toml`
is 26 lines and has `[package]`, `[lints]`, `[dependencies]`, `[dev-dependencies]`
and nothing else. Both binary names come from cargo's auto-discovery:

| binary | declared by | mechanism |
| --- | --- | --- |
| `mos-sign` | `update/sign/Cargo.toml:2` — `name = "mos-sign"` | package name + the presence of `src/main.rs` |
| `mos-update-verify` | the **filename** `update/sign/src/bin/mos-update-verify.rs` | cargo names an auto-bin after its file |
| lib `mos_sign` | `update/sign/Cargo.toml:2`, again | package name with `-` → `_` |

So the rename is: edit one line, rename one file, and fix the 10 `use mos_sign::`
sites. Everything else on the list below is a *reference*.

### Files that MUST change

| file:line | text | why |
| --- | --- | --- |
| `update/sign/Cargo.toml:2` | `name = "mos-sign"` | **declaration** |
| `update/sign/src/bin/mos-update-verify.rs` (path) | — | **declaration** (filename → `rauc-verify.rs`) |
| `update/sign/Cargo.toml:9` | `workspace = "../../mosd"` | deleted outright by the M3 extraction |
| `update/sign/src/main.rs:1` | `` //! `mos-sign` — release-side TUF repository tool `` | doc comment |
| `update/sign/src/main.rs:8,9` | `use mos_sign::keys;` / `use mos_sign::repo::{self, Expirations};` | lib crate name |
| `update/sign/src/main.rs:17` | `name = "mos-sign",` | clap command name — the string users type |
| `update/sign/src/lib.rs:5,7` | `` the `mos-sign` binary `` / `` the `mos-update-verify` binary `` | doc comments |
| `update/sign/src/keys.rs:67` | `` "missing {role} key at {}; run `mos-sign gen-dev-keys`" `` | **runtime error text** |
| `update/sign/src/bin/mos-update-verify.rs:1` | `` //! `mos-update-verify` — device-side TUF … `` | doc comment |
| `update/sign/src/bin/mos-update-verify.rs:13` | `use mos_sign::client;` | lib crate name |
| `update/sign/src/bin/mos-update-verify.rs:17` | `name = "mos-update-verify",` | clap command name |
| `update/sign/src/bin/mos-update-verify.rs:25` | `` the same reason `mos-sign verify` requires it `` | comment |
| `update/sign/src/bin/mos-update-verify.rs:65` | `eprintln!("mos-update-verify: {err:#}");` | **runtime error prefix** |
| `update/sign/tests/client.rs:17,18,19` | `use mos_sign::{client,keys,repo};` | lib crate name |
| `update/sign/tests/common/mod.rs:13,14` | `use mos_sign::{keys,repo};` | lib crate name |
| `update/sign/tests/repository.rs:11,12` | `use mos_sign::{keys,repo};` | lib crate name |
| `mosd/Cargo.toml:3` | `members = [..., "../update/sign"]` | member dropped by the extraction |
| `mosd/Cargo.lock:1702` | `name = "mos-sign"` | entry leaves this lock entirely |
| `.gitignore:6` | `` # Development TUF signing keys, generated by `mos-sign gen-dev-keys`. `` | comment above `:8` |
| `.gitignore:8` | `update/sign/.devkeys/` | ignore rule; path AND the crate dir change |
| `README.md:22` | `` ├── update/          TUF release signing … (`mos-sign`, `mos-update-verify`) `` | live tree block |
| `docs/architecture.md:104` | `` `mos-sign` signs and `mos-update-verify` `` | live prose |
| `docs/architecture.md:145` | `` ├── update/        release trust tooling: mos-sign and mos-update-verify `` | live tree block |
| `docs/design/api.md:3512` | `` (`update/sign`, RFCT-016). `mos-sign` is a member of the `` | live design doc; also a factual claim the extraction falsifies |
| `docs/design/release-signing.md` — 14 lines | `:4 :35 :55 :56 :62 :74 :85 :90 :114 :135 :148 :295 :297 :308` | live runbook; every one is a command a human types |
| `update/README.md` — 21 lines | `:6 :9 :16 :17 :19 :27 :29 :47 :52 :71 :76 :113 :147 :158 :166 :174 :178 :181 :189 :195` (14 `mos-sign`, 7 `mos-update-verify`) | folded into `os/pkgs/rauc-sign/README.md` at M3; rewritten in the same movement |

Two entries on that list deserve individual attention:

- `docs/design/release-signing.md:308` reads
  `mos-sign verify --repo <repo> --root /trusted/root.json --datastore /var/lib/mos-sign/trusted`.
  The `/var/lib/mos-sign/trusted` is a **runtime datastore path in an example
  invocation**, not a binary name. It is a free parameter — nothing in the code
  defaults to it. Renaming it is a choice, and the defensible one is to rename
  it with the binary so the runbook stays internally consistent; but M5 should
  record that it did so deliberately, because a blind `sed s/mos-sign/rauc-sign/`
  would change it silently and a reviewer could not tell which happened.
- `docs/design/api.md:3520` reads
  ``grep -rn "mos-sign\|update/sign" os/ returns nothing at `86cd669` ``.
  This is a **provenance claim about a specific historical commit**. Rewriting
  the strings inside it would make the sentence assert something that was never
  measured. `docs/verify-citations.sh`'s own summary flags this class — "a
  provenance claim such as 'measured at <commit>' is validated against no file
  at all". M5 must leave this line alone or re-run the grep at HEAD and restate
  it; it must not be swept.

### Files that MUST NOT change (dated history, Decisions item 4)

| file | lines carrying an old name |
| --- | --- |
| `docs/plan/PLAN-010.md` | 1 |
| `docs/plan/PLAN-019.md` | 3 (this campaign's own plan; L1 amends it separately) |
| `docs/task/RFCT-016.md` | 3 |
| `docs/task/RFCT-086.md` | 5 |
| `docs/task/RFCT-088.md` | 3 |

Measured by `git grep -c -E "mos-sign|mos_sign|mos-update-verify" -- 'docs/task/' 'docs/plan/'`.

### Totals

`mos-sign` 54 lines / 17 files; `mos_sign` 10 lines / 5 files;
`mos-update-verify` 17 lines / 7 files; `mos_update_verify` **0**. No consumer
outside `docs/` and the crate itself invokes either binary: `git grep` finds no
Makefile target, no CI step, no `os/**` script that runs them. **The rename has
no build-graph consumers at all** — it is a crate-internal rename plus a
documentation rewrite, which is why it can safely ride along with M3.

---

## E. Additional restructure proposals

PLAN-019 Decisions item 2 licenses proposing beyond the four moves. Four
proposals follow, and one explicit non-proposal. They are deliberately few: the
tree that remains after `os/pkgs/` lands is coherent, and the honest answer for
most of it is that it already matches its function.

### P1 — Repair the two live tree blocks. **ADOPT**, into M5.

*What.* `README.md:14-24` and `docs/architecture.md:134-148` both draw the
repository layout, and **both are already wrong at `1bbd799`, before this
campaign touches anything.**

```
README.md:18: ├── board/           one directory per supported board, plus common/ fragments
README.md:19: │   ├── cx3576/      CX3576-Z (Rockchip RK3576, arm64): U-Boot, kernel, firmware, Alpine demo
README.md:20: │   └── x64/         generic x86_64 UEFI platform (QEMU/CI baseline, no BSP build)
docs/architecture.md:144: ├── board/         BSP per board: kernel, U-Boot and firmware Dockerfiles
```

`ls -d board` returns `No such file or directory`. PLAN-018 moved that tree to
`os/boards/` and neither block followed. Separately,
`docs/architecture.md:136-142` lists six children of `os/` and the tree has
nine — `podman/`, `build-env/` and `tools/` are absent — and `:142` attaches
"podman/ pins the engine" to the `tests/` line, where it reads as a child of
`os/tests/`.

*Why.* M5 is already rewriting both blocks to introduce `os/pkgs/`. Rewriting
a block while knowingly leaving a directory in it that does not exist is worse
than either fixing it or not touching it.

*Cost.* Four lines in `README.md`, six in `docs/architecture.md`. Zero risk.

*What breaks.* Nothing. Neither block is a `path:line` citation, which is
precisely why `docs/verify-citations.sh` has been green over this error since
PLAN-018 — the gate reads citations, not prose. That is a gap in the gate, not
a defect in these files, and closing it is not this campaign's job.

### P2 — Add `os/pkgs/README.md`. **ADOPT**, into M2.

*What.* One short file stating the rule of the directory: a child of `os/pkgs/`
holds source this repository compiles into a shipped artefact; the container
ones export from a `FROM scratch` final stage into a gitignored `out-<arch>/`
and pin upstream in `versions.env`; the Rust ones are cargo workspaces built in
the pinned image.

*Why.* The twin structure already exists but is only asserted sideways, in a
comment inside one of the twins — `os/update/rauc/build.sh:7`: "Same driver
shape as os/podman/build.sh, and for the same reason". After the move, four
directories share a parent and nothing at that parent says what the parent is
for. `os/rootfs/stages/README.md` and `extensions/README.md` are the precedent:
this tree explains its directories in place.

*Cost.* One file, ~20 lines. *What breaks.* `docs/verify-index.sh` scans
`docs/design/` and `docs/research/` against `docs/README.md` and
`docs/task/RFCT-*.md` against `docs/task/index.md` — a README under `os/` is
outside all three sections, so the index gate is unaffected.

### P3 — Move `test/apid-api` under `os/`. **DEFER.**

*What.* The tree has three bun suites: `os/build`, `os/verify` and
`test/apid-api`. Two live under `os/`; the third is the sole occupant of a
top-level `test/`.

*Why it is tempting.* `test/` holds exactly one thing and its name promises to
hold all tests, while `os/tests/` — which does hold tests — is a different
directory with a nearly identical name. That is a real collision.

*Cost.* 9 lines in 6 files reference `mosd/` from inside `test/apid-api`, and
`git grep -l "test/apid-api"` finds its consumers in the Makefile and docs;
the move itself is small.

*What breaks.* Nothing structural.

*Recommendation: defer.* Two reasons. First, it is outside PLAN-019's stated
scope — the campaign's organising idea is "self-built components consolidate",
and `test/apid-api` builds nothing. Second, the right destination is genuinely
unclear: `os/tests/` is shell suites over a *booted* image and `os/verify` is a
bun suite over an *assembled* one, so `test/apid-api` (a bun suite over a booted
image) has a claim on both and a clean answer on neither. Deciding that badly
under time pressure is exactly what Decisions item 1 exists to prevent. It
deserves its own plan.

### P4 — Re-point `docs/verify-citations-test.sh`'s fixture paths. **DEFER.**

*What.* The self-test builds a synthetic tree using `mosd/apid/src` as its
example path (27 occurrences). After M4 that names a directory the real tree
does not have.

*Why it is only cosmetic.* The fixture creates its own root under `mktemp -d`
(`:61`), so the gate stays green. Verified by reading the fixture construction,
not by assuming.

*Cost.* 27 mechanical string edits in a self-test.

*What breaks.* The risk is asymmetric and points the wrong way: editing 27
fixture strings in the file that tests the gate, during the same milestone that
rewrites 726 real citations, means a mistake in the *test* could mask a mistake
in the *tree*.

*Recommendation: defer* to a standalone follow-up after PLAN-019 closes, when
the gate is trusted and the change can be reviewed on its own.

### P5 — Rename `os/tests/`, fold `os/tools/`, relocate `extensions/`. **REJECT.**

Considered and declined, each for a stated reason rather than by omission:

- **`os/tools/`** is three QEMU scripts under an accurate name. Folding it into
  `os/tests/` would mix "things that check" with "things that help you look".
- **`extensions/`** is an empty slot, and `extensions/README.md` already
  explains itself: "It is empty: the v2 image is a single squashfs root, and
  nothing in the build reads this directory", followed by the conditions under
  which something would live there. A documented reserved slot is not layout
  fighting function; it is layout recording a decision.
- **`os/tests/`** vs `test/` is a real collision, but it is P3's collision and
  renaming the `os/` side without deciding P3 would move the confusion rather
  than remove it.

### The non-proposal

Beyond P1 and P2, **the four ratified moves are sufficient.** The remaining
top-level and `os/` directories each name what they contain, and the one
genuine naming collision (`test/` vs `os/tests/`) is deferred with a reason
rather than solved by reflex. This section is short because padding it would
buy a longer list at the cost of a worse tree.

---

## F. Untracked artifact relocation

**Which tree was measured, and why it matters.** A fresh BKD worktree carries
none of the main checkout's build output. This worktree is
`/srv/bkd/worktrees/u51kzjlk/kfvacdp0` and
`git status --porcelain --ignored` returns **nothing at all** — no untracked
files, no ignored files. So every probe below was run twice: once here, once
against the main checkout at `/srv/ai/mos` (resolved via
`git rev-parse --git-common-dir`), which is where the artefacts actually live
and where the M2–M4 integrator will be standing.

| path | this worktree | `/srv/ai/mos` (main checkout) |
| --- | --- | --- |
| `os/podman/out-arm64/` | absent | **absent** |
| `os/podman/out-amd64/` | absent | **absent** |
| `os/podman/versions.lock` | absent | **absent** |
| `os/update/rauc/out-arm64/` | absent | **absent** |
| `os/update/rauc/out-amd64/` | absent | **absent** |
| `os/update/rauc/.devkeys/` | absent | **absent** |
| `os/update/rauc/versions.lock` | absent | **absent** |
| `update/sign/.devkeys/` | absent | **absent** |
| `update/lockbox/` | absent | **present, 4.0K — an empty directory** |
| `mosd/target/` | absent | **present, 4.2G** |

Two paths outside the moving trees, measured for context because they dominate
the disk and an integrator will see them:

| path | `/srv/ai/mos` |
| --- | --- |
| `_out/` | **5.8G** (of which `_out/cx3576/` is 5.8G) |
| `os/boards/cx3576/bsp/out/` | **585M** — the tree PLAN-018 relocated by hand |

### What this means for execution

**Only one artefact actually needs relocating: `mosd/target/`, 4.2G, at M4.**
Every other path the plan lists as "to relocate at integration" is absent from
both trees. The podman and rauc `out-*/` directories and their `.devkeys/`
have not been built in this checkout, so M2 relocates nothing.

`update/lockbox/` is present but is an **empty directory**, confirmed by
`ls -la` (two entries, `.` and `..`) and untracked, confirmed by
`git check-ignore -v update/lockbox` returning nothing. Git does not track
directories, so it simply does not exist as far as `git mv` is concerned. M3
removes it with `rmdir` when it removes the rest of `update/`. There is nothing
to preserve.

`mosd/target/` is gitignored by `mosd/.gitignore:1` (`target/`), which is
relative and travels with the `git mv`. The directory itself does not:
`git mv mosd os/pkgs/mosd` moves tracked files only. So M4 must do

```
mv /srv/ai/mos/mosd/target /srv/ai/mos/os/pkgs/mosd/target
```

by hand, exactly as PLAN-018 did with the 585M BSP `out/`. Not moving it is
not a correctness failure — cargo rebuilds — but it is a **4.2G rebuild** on
the next `make`, and a second 4.2G on disk if the old directory is left behind.

`_out/cargo` (the shared registry cache `mosd/hack/build-target.sh:65` derives
as `${REPO_ROOT}/_out/cargo`) is REPO-root-relative and unaffected by any of
the four moves.

---

## G. Gate-recipe impact

### The current recipe

The Rust gates run in the pinned image `localhost/mos-build-rust` with
`/srv/mos-rust-tools` mounted at `/tools`. Both exist on this host —
`docker images` lists `localhost/mos-build-rust:latest`, and
`ls /srv/mos-rust-tools/bin` gives `cargo-clippy cargo-deny cargo-fmt
clippy-driver rustfmt`. Today:

```
docker run --rm \
  -v /srv/ai/mos:/src \
  -v /srv/mos-rust-tools:/tools \
  -e PATH=/tools/bin:$PATH \
  -e LD_LIBRARY_PATH=/opt/rust/lib \
  -w /src/mosd \
  localhost/mos-build-rust  <cargo ...>
```

### The new recipes

After M3 and M4 there are **two** workspaces and therefore two recipes. Only
`-w` changes; the mount, the image and the two environment variables are
identical.

**mosd workspace (after M4):**

```
docker run --rm \
  -v /srv/ai/mos:/src \
  -v /srv/mos-rust-tools:/tools \
  -e PATH=/tools/bin:$PATH \
  -e LD_LIBRARY_PATH=/opt/rust/lib \
  -w /src/os/pkgs/mosd \
  localhost/mos-build-rust  <cargo ...>
```

**rauc-sign workspace (after M3):**

```
docker run --rm \
  -v /srv/ai/mos:/src \
  -v /srv/mos-rust-tools:/tools \
  -e PATH=/tools/bin:$PATH \
  -e LD_LIBRARY_PATH=/opt/rust/lib \
  -w /src/os/pkgs/rauc-sign \
  localhost/mos-build-rust  <cargo ...>
```

The repository stays mounted at the fixed path `/src` and is **not** narrowed
to the workspace directory, for the reason `mosd/hack/build-target.sh:132-135`
gives: "At the fixed path /src, because rustc records the paths it is given:
mounting the checkout where it happens to live would make the output depend on
the directory the repository was cloned into -- two machines, same commit,
different binaries, for a reason that is not about the source."

### Every file that hard-codes a workspace path today

Quoted, not paraphrased.

**`mosd/hack/check.sh` — SURVIVES UNCHANGED.**

```
3: cd "$(dirname "$0")/.."
```

One level up from `hack/` is the workspace, wherever the workspace is. This is
the only one of the three hack scripts whose arithmetic is move-proof.

**`mosd/hack/build-target.sh` — BREAKS in four places.**

```
13: cd "$(dirname "$0")/.."
14: WORKSPACE="$(pwd)"
15: REPO_ROOT="$(cd "${WORKSPACE}/.." && pwd)"
```

`:13-14` is fine; `:15` is not. It asserts the repo root is one level above the
workspace. At `os/pkgs/mosd` it is **three**. Must become
`REPO_ROOT="$(cd "${WORKSPACE}/../../.." && pwd)"`. Left unfixed it resolves to
`os/pkgs`, `FROM_SH` misses, and the guard at `:24-29` fires with

```
26: echo "error: ${p} does not exist. mosd/hack/build-target.sh derives the workspace as its own directory's parent and the repository as the level above that; if this file moved, that arithmetic moved with it" >&2
```

— which is the failure mode working as designed, and the message itself is the
second thing to edit ("the level above that" becomes false, and the path prefix
in it changes).

```
159:     -w /src/mosd \
```

Must become `-w /src/os/pkgs/mosd`.

```
123: # The repository is mounted, not mosd/: mosd/Cargo.toml's workspace members
124: # include `../update/sign`, a crate outside the directory this script's own path
125: # arithmetic calls the workspace, and mounting mosd/ alone makes cargo fail with
126: #
127: #   error: failed to load manifest for workspace member `/src/../update/sign`
128: #   Caused by: No such file or directory (os error 2)
```

**M3 falsifies this comment.** Once `../update/sign` leaves the member list,
the stated reason for mounting the repository evaporates. The *decision* is
still right — the reproducibility argument at `:132-135` quoted above carries
it alone — but the comment must be rewritten to rest on that argument rather
than on a member that no longer exists. This is the subtlest edit in the whole
campaign: nothing fails if it is missed, and the file then documents a reason
that is not true.

```
136-150:  the `../*` workspace-member guard
146: echo "error: mosd/Cargo.toml lists the workspace member '${m}', which resolves outside ${REPO_ROOT}. ..."
```

After M3 the members list has no `../` entries, so the loop iterates zero times
and the guard becomes dormant rather than wrong. Keep it — it is a general
form, and `:130-132` says so — but its error text needs the path prefix.

**`mosd/hack/dbus-policy-test.sh` — BREAKS.**

```
28: HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
29: REPO_ROOT=$(cd "${HERE}/../.." && pwd)
30: POLICY="${REPO_ROOT}/mosd/dist/com.mos.mosd.conf"
```

`:29` climbs two levels from `mosd/hack`. From `os/pkgs/mosd/hack` it must climb
**four**: `${HERE}/../../../..`. And `:30`, `:640` (`EXT_POLICY`) and `:752`
(`MQTTD_POLICY`) all build `${REPO_ROOT}/mosd/dist/...` and need the new prefix.
Unlike `build-target.sh` this script has **no guard** on the derived root — it
will simply fail to find the policy file and report that, without saying why.

**`mosd/hack/build-aarch64.sh` — SURVIVES UNCHANGED.**

```
7: exec bash "$(dirname "$0")/build-target.sh" aarch64-unknown-linux-gnu aarch64
```

Sibling-relative.

**`.github/workflows/check.yml` — BREAKS in 8 places**, at `:85 :86 :141 :159
:161 :162 :163 :167` plus the merge-base reads at `:209 :210 :246 :248`. Full
text quoted in section C. M3 additionally **adds** a second gate here: today
`mosd/hack/check.sh:7-8` runs `cargo clippy --workspace` and
`cargo nextest run --workspace`, and `mos-sign` is inside that workspace via
`mosd/Cargo.toml:3`. After the extraction it is not, so without a new CI step
the crate ships **unchecked**. This is the specific failure M3 must not leave
behind.

**`Makefile:154` — BREAKS.** `bash mosd/hack/dbus-policy-test.sh`.

**`os/rootfs/build-v2.sh` — BREAKS in 10 executable lines.** `:256` invokes
`"$REPO_ROOT/mosd/hack/build-target.sh"`, and `:265 :266 :267 :268 :269 :270
:274 :276 :277 :283 :285` copy binaries and units out of
`$REPO_ROOT/mosd/target/...` and `$REPO_ROOT/mosd/dist/...`. All are
`$REPO_ROOT`-anchored literals; all need the `os/pkgs/` prefix. `:264` copies
`$REPO_ROOT/_out/mosd-build.txt`, which is repo-root-relative and unaffected.

**`os/build-env/rust/Dockerfile` — 7 lines, all comments except one.** `:24 :25
:28 :57 :176 :179` are prose naming `mosd/hack/build-target.sh` and
`mosd/.cargo/config.toml`; `:262` is a `say "error: ... so mosd/hack/build-target.sh
could not run in this image ..."` inside a RUN. None affects the build; all
should follow the move so the image's own diagnostics name a real path.

**`os/build-env/from.sh:27-29`** enumerates its call sites in a comment —
"os/podman/build.sh, os/update/rauc/build.sh, os/rootfs/build-v2.sh,
os/tests/handshake-test/run.sh, mosd/hack/build-target.sh and four
os/boards/cx3576/bsp make recipes". Three of those five named paths change.

### What M3 must create alongside the extraction

Not a path question, but it belongs with the gate recipe because the second
`cargo deny` run has no configuration until someone writes it:

- `os/pkgs/rauc-sign/Cargo.toml` gains a `[workspace]` table; `workspace = "../../mosd"`
  (`update/sign/Cargo.toml:9`) is deleted, and every `workspace = true`
  inheritance in it (`edition`, `rust-version`, `publish`, `[lints]`, and all 9
  `{ workspace = true }` dependencies) must be given a literal value or a new
  `[workspace.package]` / `[workspace.dependencies]` block in the same file.
- `os/pkgs/rauc-sign/Cargo.lock` is generated fresh.
- `os/pkgs/rauc-sign/deny.toml` is new. It can start **smaller** than
  `mosd/deny.toml`: that file's two exceptions both belong to mosd crates and
  neither reaches `mos-sign`. The `CC0-1.0` allowance is documented at
  `mosd/deny.toml:14-30` as reaching tiny-keccak through
  `rumqttd -> config -> rust-ini -> ordered-multimap -> dlv-list -> const-random
  -> const-random-macro`, and the `RUSTSEC-2025-0134` ignore at `:44` is
  "pulled in by axum-server tls-rustls". `rumqttd` is the broker's, `axum-server`
  is apid's.
- `mosd/Cargo.lock` **shrinks**. `tough` and `url` are declared by
  `update/sign/Cargo.toml` and by no crate in `mosd/` — verified per-dependency
  across all seven manifests — so their whole transitive subtree leaves the
  lock. It is 3871 lines and 378 packages today; expect a large, entirely
  mechanical diff, and expect `cargo deny` to be re-run against the *reduced*
  graph, which can only remove findings.

---

## H. Risks and execution order

### Dependency order

```
        M2 (podman, rauc)          M3 (rauc-sign)
              │                          │
              └────────────┬─────────────┘
                           ▼
                    M4 (mosd)   ── requires M3
                           ▼
                    M5 (sweep + closeout)
```

**M2 ∥ M3 — may run concurrently.** Their file sets are disjoint at the level
that matters. M2 touches `Makefile`, root `.gitignore`, `os/build/**`,
`os/build-env/**`, `os/rootfs/**`, `os/verify/**`, `os/podman/**`,
`os/update/rauc/**`. M3 touches `update/**`, `mosd/Cargo.toml`,
`mosd/Cargo.lock`, `.github/workflows/check.yml`. The overlap is exactly two
files — the root `.gitignore` (M2 owns `:11 :13 :15 :16 :26 :27 :28`, M3 owns
`:6 :8`) and, if both edit it, `README.md`. Both are line-level conflicts a
merge resolves, not semantic ones. If the coordinator prefers zero conflicts,
serialise on `.gitignore` alone: M2 first, M3 rebases.

**M3 → M4 is a hard dependency, not a preference.** Three reasons, in
descending severity:

1. `mosd/Cargo.toml:3` reads `members = [..., "../update/sign"]`. If M4 ran
   first, that relative member would resolve from `os/pkgs/mosd` to
   `os/pkgs/../update/sign` = `os/update/sign`, which does not exist. **Every
   cargo command in the workspace fails immediately** — `cargo fmt`, `clippy`,
   `nextest`, `deny`, and `mosd/hack/build-target.sh` — with the exact error
   quoted in `build-target.sh:127`. There is no partial-green state; the gate
   set goes fully red until the member path is fixed. Doing M3 first deletes
   the member and removes the hazard entirely.
2. `mosd/hack/build-target.sh:136-150` guards on `../*` members resolving
   inside `REPO_ROOT`. Running M4 first exercises that guard against a member
   whose path arithmetic has *also* just changed, so one broken run has two
   independent causes and the error message names only one.
3. M3 adds the second CI cargo gate. Landing it before M4 means M4's much
   larger change arrives with both workspaces already independently green, so a
   red after M4 is unambiguously M4's.

**M4 → M5 is a hard dependency.** M5 rewrites 708 gated `mosd/...:N` citations.
Those rewrites are only *checkable* once the files are at the new paths —
`docs/verify-citations.sh` resolves the cited path and re-reads the quoted
fragment at the cited lines. Rewriting first would turn 708 green citations
into 708 red ones for the duration, and a checker reporting 708 failures is
indistinguishable from a checker reporting a real problem.

**M2 → M5 for the same reason**, at a smaller scale: 18 `os/update/rauc` gated
citations.

### The specific failures each choice prevents

| choice | failure prevented |
| --- | --- |
| M3 before M4 | Total cargo failure on a dangling `../update/sign` member — every Rust gate red at once, from a one-line cause. |
| M3 before M4 | `mos-sign` silently unchecked: `--workspace` stops covering it the moment it is extracted, and only a new CI step restores coverage. |
| M4 before M5 | 708 citation failures that cannot be told apart from a genuine miss. |
| M2 before M5 | 18 more of the same. |
| M2 ∥ M3 allowed | Nothing to prevent; serialising them buys only latency. |

### Risks specific to this design

1. **80.5% of the gated citation corpus moves in one campaign.** 726 of 902.
   `docs/design/api.md` alone carries 623 of them. The gate's content check
   (check 2 in its header) re-reads each quoted fragment at the cited lines, so
   a rewrite that changes a line number as well as a prefix fails loudly — the
   safety net works. What it does *not* catch is a citation whose prefix was
   rewritten to a path that exists but is the wrong one, if the quoted text
   happens to match. Keep the rewrite purely mechanical: prefix only, line
   numbers untouched, as PLAN-018 M4 did (`docs/task/RFCT-163.md`).
2. **Podman's path arithmetic breaks and rauc's does not.** The natural
   instinct at M2 is to treat the twins identically. Doing so either misses
   `os/podman/build.sh:20` or gratuitously "fixes" the two correct `../../..`
   in rauc. Both scripts carry a self-describing error message naming the
   number of levels, and both messages must end up saying the truth.
3. **The comment at `build-target.sh:123-128` becomes false at M3 and is
   repaired at M4.** It spans two milestones and nothing fails if it is missed.
   It is on M4's checklist because M4 is the milestone that touches that file
   anyway.
4. **`mosd/target/` is 4.2G and `git mv` will not move it.** See F. The cost of
   forgetting is a full rebuild plus 4.2G of orphaned output — recoverable, but
   PLAN-018 hit exactly this with the 585M BSP tree and it is worth not hitting
   twice.
5. **Old worktrees keep looking for `mosd/` at the old path.** PLAN-019's Risks
   section already names this. The concrete form: any L2 or L3 holding a
   pre-M4 branch will run `bash mosd/hack/check.sh` and get "No such file or
   directory", which reads as a broken tree rather than a stale one. Every
   subtask must re-derive paths from its own merged worktree.
6. **The two live tree blocks are already wrong** (E/P1). If M5 rewrites them
   without fixing `board/`, the campaign ships a freshly-edited document
   containing a directory that has not existed since PLAN-018.

---

## Verification

Both gates were run at the base commit and again with this record and its index
row in place, from a private `mktemp -d` scratch directory.

```
$ git log --oneline -1
1bbd799 docs(plan): PLAN-019 binary names settled - rauc-sign and rauc-verify

baseline:  docs/verify-index.sh      510/510 PASS   (rc=0)
           docs/verify-citations.sh  902/902 PASS   (rc=0)

after:     docs/verify-index.sh      513/513 PASS   (rc=0)
           docs/verify-citations.sh  902/902 PASS   (rc=0)
```

Citations: **unchanged at 902**, as expected. `docs/verify-citations.sh` scans
`docs/design/*.md` excluding `*.zh.md`, plus `docs/architecture.md`; this
record is neither, so its citations are not scanned. They were kept accurate
regardless.

Index: **+3, not +1**, and the three are accounted for rather than assumed.
Section 3 of `docs/verify-index.sh` runs *three* loops over the task records,
so one new record plus one new row adds one check to each:

1. forward — `docs/task/RFCT-165.md` exists and the index has a row for it;
2. reverse — the new row resolves to a file that exists;
3. once-each — the index carries exactly one row for `RFCT-165.md`, the
   check that catches a merge which kept both sides of a two-L3 append.

`git status --porcelain` lists exactly two paths: ` M docs/task/index.md` and
`?? docs/task/RFCT-165.md`. Nothing else in the tree was touched; no `git mv`
was run, and `os/pkgs/` does not exist yet.

<!-- dated-record: a measurement record frozen at its commit; its citations name the tree as it was then (pre-PLAN-019 layout, pre-rewrite design documents); exempt from docs/verify-citations.sh (RFCT-172) -->
