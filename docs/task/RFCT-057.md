# RFCT-057 Closing audit of the `apid` rename: completeness, consistency, assertion accounting, index closure

- **status**: completed — implementation complete, all mandatory project checks green,
  including `make docs-verify`, which passes for the first time in this campaign
- **priority**: P1
- **owner**: ai-agent
- **createdAt**: 2026-08-19 17:00
- **claimedAt**: 2026-08-19 17:00
- **completedAt**: 2026-08-19 17:40

Campaign `l1-o7ee8v0o-20260819152009-apid`. Branch `bkd/eosxgii8`, base
`c460ec9` (the RFCT-055 L2 merge, which already carries RFCT-056). Pre-rename
baseline for every before/after number below is `86cd669`.

## Description

RFCT-055 renamed the code, unit, image and verifier surface; RFCT-056 renamed
the documentation and recorded the decision. This record proves the rename is
**complete** (nothing still calls the live daemon `webd`) and **consistent**
(crate, unit, config default, image staging, install, enablement, health gate
and mount ordering all name the same thing), accounts for every verifier
assertion across the rename, and closes `docs/task/index.md`, which both prior
tasks deliberately left untouched to avoid two branches appending to one table.

The failure this audit exists to catch is a partial rename that still builds:
a renamed binary with a unit still pointing at the old path passes every
host-side check and fails only on a device.

## Method note: which `grep`

The interactive shell in this environment aliases `grep` to a `ugrep` wrapper
that strips the `./` path prefix, applies `--ignore-files`, and counts
occurrences rather than lines under `-c`. Every number in this record was taken
with **GNU `grep`**, invoked as `command grep` or from inside a `bash` heredoc,
so the counts are line counts and are reproducible from a plain shell.

## Deliverable 1 — completeness

    command grep -rIl webd  --exclude-dir=.git --exclude-dir=_out . | wc -l   -> 58
    command grep -rIli webd --exclude-dir=.git --exclude-dir=_out . | wc -l   -> 58
    command grep -rIl webd  --exclude-dir=.git --exclude-dir=_out . | grep -v '^\./docs/'
                                                                             -> (nothing)

**58 files contain `webd`, and every one of them is under `docs/`.** (Measured
before this record existed; with `RFCT-057.md` written the count is 59, still
all under `docs/`, and the non-`docs/` sweep still returns nothing.) The
case-insensitive sweep returns the same 58 files, so no file carries a
non-lowercase spelling that the lowercase sweep missed. Non-lowercase
occurrences exist only as `StartWebd`/`Webd` (Talos-era sequencer task names, in
`docs/plan/PLAN-003.md` and `docs/task/RFCT-003.md`) and as `WEBD_*` environment
names inside the three documents listed in the consistency chain below.

Zero occurrences remain in `mosd/`, `os/`, `board/`, `update/`, `extensions/`,
the `Makefile` or the root `README.md`.

Counts are **matching lines** (`grep -c`); the parenthesised figure is total
occurrences (`grep -o | wc -l`) where the two differ.

### Category 1 — historical task record (29 files, 146 lines)

`docs/task/RFCT-0NN.md` records of campaigns that ran while the daemon was
called `webd`. Correct as-is.

| file | lines | file | lines |
|---|---|---|---|
| `RFCT-003.md` | 10 (12) | `RFCT-030.md` | 11 (15) |
| `RFCT-004.md` | 7 | `RFCT-032.md` | 4 |
| `RFCT-005.md` | 1 | `RFCT-033.md` | 2 |
| `RFCT-009.md` | 1 | `RFCT-034.md` | 4 |
| `RFCT-010.md` | 16 (18) | `RFCT-035.md` | 12 |
| `RFCT-011.md` | 1 | `RFCT-036.md` | 1 |
| `RFCT-013.md` | 4 (5) | `RFCT-037.md` | 10 |
| `RFCT-015.md` | 5 (6) | `RFCT-043.md` | 1 |
| `RFCT-016.md` | 1 | `RFCT-044.md` | 4 |
| `RFCT-017.md` | 5 | `RFCT-046.md` | 7 |
| `RFCT-021.md` | 4 | `RFCT-048.md` | 7 |
| `RFCT-022.md` | 10 | `RFCT-053.md` | 8 (9) |
| `RFCT-023.md` | 1 | | |
| `RFCT-024.md` | 1 | | |
| `RFCT-025.md` | 2 | | |
| `RFCT-026.md` | 5 | | |
| `RFCT-028.md` | 1 | | |

### Category 2 — historical plan (9 files, 98 lines)

| file | lines | note |
|---|---|---|
| `docs/plan/PLAN-001.md` | 3 | status `completed` |
| `docs/plan/PLAN-002.md` | 5 | status `completed` |
| `docs/plan/PLAN-003.md` | 41 (55) | status `completed`; Talos-era `StartWebd` sequencer task |
| `docs/plan/PLAN-004.md` | 4 (5) | status `completed` |
| `docs/plan/PLAN-005.md` | 5 | status `rejected (superseded by PLAN-006)` |
| `docs/plan/PLAN-006.md` | 5 | status `partially implemented` |
| `docs/plan/PLAN-007.md` | 10 (12) | status `implementing`; Talos-derivation plan |
| `docs/plan/PLAN-008.md` | 10 | status `draft`; Talos/COSI connd mechanism, superseded by `design/connd.md` |
| `docs/plan/PLAN-010.md` | 15 | 11 in completed-milestone records (M3, M5, M5-addendum) + 4 in the retention note added by this task |

`PLAN-010.md` is the one live plan in this list. All eleven pre-existing
occurrences sit inside completed-milestone sections (lines 62/68/72 in `### M3`,
and 316/529/552/560/562/621/623/654 inside `### M5` and `### M5 addendum`). The
single forward-looking statement in the file — the architecture diagram in
`## Context`, line 28 — already reads `apid + kiosk`, renamed by RFCT-056.

### Category 3 — historical measurement (6 files, 77 lines)

| file | lines | why correct as-is |
|---|---|---|
| `docs/research/mos-ui-inventory.md` | 69 (91) | states on its face that it measured the tree at commit `d0bcae9` |
| `docs/research/venus-os-ui.md` | 4 | Venus OS reference study dated 2026-08-19, comparing against mos as it then was |
| `docs/research/init-strategy.md` | 1 | line 55 is inside `### Plan A (current): Talos core` — the description of the *rejected* plan |
| `docs/research/init-strategy.zh.md` | 1 | translated sibling of the same line |
| `docs/research/os-comparison.md` | 1 | record of the 2026-08 evaluation ("Records what was chosen from whom and what was rejected") |
| `docs/research/os-comparison.zh.md` | 1 | translated sibling of the same line |

### Category 4 — deliberate rename record (10 files, 12 lines)

Prose of the form "renamed from `webd`" in a current document. This is the
category that *should* contain the word.

| file | line(s) |
|---|---|
| `docs/architecture.md` | 13, 60 |
| `docs/design/access.md` | 159 |
| `docs/design/boards.md` | 9 |
| `docs/design/connd.md` | 9 |
| `docs/design/display.md` | 9 |
| `docs/design/mosd.md` | 16 |
| `docs/design/provisioning.md` | 16 |
| `docs/design/ro-root.md` | 12 |
| `docs/design/remote-management.md` | 7, 10 (status marker deliberate; not touched) |
| `docs/design/dashboard.md` | 13, 2543, 2546 |

### Category 5 — measurement of the rename itself (`docs/design/dashboard.md` §7, 15 lines)

Lines 2552, 2563–2570, 2595, 2598, 2605, 2606, 2646, 2662. §7.4 enumerates the
migration cost with **pre-rename paths** (`mosd/webd/Cargo.toml:2`,
`mosd/dist/webd.service:10`, `WEBD_STATE_DIR`, `Before=mosd.service
webd.service`, …). Rewriting those paths to `apid` would destroy the thing that
makes it a cost table: it measures what the rename had to touch. Correct as-is.

### Category 6 — the legacy directory (`docs/design/dashboard.md`, 3 lines)

Lines 2307, 2578, 2592 name `/var/lib/mos/webd` as the orphaned directory a
fielded device carries after an update across the rename. Naming it `apid`
would state the opposite of the orphan decision. Correct as-is.

### Category 7 — this campaign's own records (5 files, 56 lines)

| file | lines |
|---|---|
| `docs/task/RFCT-055.md` | 29 (32) |
| `docs/task/RFCT-056.md` | 18 |
| `docs/task/RFCT-057.md` | this record |
| `docs/task/index.md` | 5 — four historical task titles (rows RFCT-003, RFCT-010, RFCT-030, RFCT-035) plus the RFCT-055 row added by this task |
| `docs/plan/index.md` | 2 — the PLAN-003 historical title plus the disambiguation note added by this task |

### Misses found and fixed

**None.** Every one of the 58 files falls into one of the seven legitimate
categories. No current-state document calls the live daemon `webd`. The three
files this task edited were edited for the two carry-ins and for index closure,
not to repair a miss.

## Deliverable 2 — the consistency chain

Every link read from the file, not inferred.

| link | file | value read | agrees |
|---|---|---|---|
| crate name | `mosd/apid/Cargo.toml:2` | `name = "apid"` | yes |
| workspace member | `mosd/Cargo.toml:3` | `members = ["mosd", "mosd-settings", "apid", "../update/sign"]` | yes |
| unit ExecStart | `mosd/dist/apid.service:8` | `ExecStart=/usr/bin/apid` | yes |
| unit StateDirectory | `mosd/dist/apid.service:10` | `StateDirectory=mos/apid` | yes |
| state-dir default | `mosd/apid/src/config.rs:38-39` | `APID_STATE_DIR`, default `/var/lib/mos/apid` | yes — matches `StateDirectory=mos/apid` |
| cross-build | `mosd/hack/build-aarch64.sh:9,11` | `-p mosd -p apid`; loop `for name in mosd apid` | yes |
| v1 staging | `os/rootfs/build.sh:41-42` | stages `release/apid` -> `$MOSD_STAGE/apid`, `dist/apid.service` -> `apid.service` | yes |
| v2 staging | `os/rootfs/build-v2.sh:75-76` | same two copies | yes |
| v1 install | `os/rootfs/Dockerfile:208-214` | `/usr/bin/apid`, `/usr/lib/systemd/system/apid.service`, symlink `/etc/systemd/system/multi-user.target.wants/apid.service` + `test -L` | yes |
| v2 install | `os/rootfs/Dockerfile.v2:293-299` | identical shape | yes |
| enablement target | both Dockerfiles | `ln -sf /usr/lib/systemd/system/apid.service` -> `.../multi-user.target.wants/apid.service` | yes — link and target agree |
| health gate | `os/health/mos-health:165` | `unit_present apid.service`; probe label `apid`, endpoint `https://127.0.0.1/healthz` (unchanged) | yes |
| overlay copy | `os/rootfs/overlay-v2/usr/lib/mos/mos-health` | `cmp` clean; both sha256 `6919a83a4776fd5054513ef1ce5dde4ac6252a0fcbb61fd1dd1bf5ec7e32c79d` | byte-identical |
| mount ordering | `os/rootfs/overlay-v2/etc/systemd/system/var-lib-mos.mount:10` | `Before=mosd.service apid.service` (comment at `:3` also updated) | yes |
| environment names | repo-wide | no `WEBD_` survives in any executable, unit or source file | yes |

The `Before=` link is the specific chain break this audit was created to catch:
a mount unit still ordering itself before `webd.service` would let the daemon
start before `/var/lib/mos` was bound onto STATE, on a device only. It reads
`apid.service`.

`WEBD_` remains in exactly three documents, all justified above:
`docs/research/mos-ui-inventory.md` (7 lines, historical measurement),
`docs/task/RFCT-055.md` (6 lines, the rename mapping table itself) and
`docs/design/dashboard.md:2567` (the §7.4 cost table).

### Diff shape, as a cross-check

`git diff -U0 86cd669 HEAD` over `os/ mosd/ Makefile README.md board/ update/
extensions/`, with every casing of `webd` and `apid` normalised to a common
token, leaves only paired `a`/`an` grammar corrections and four prose rewordings
(`mos web UI daemon` -> `mos API daemon (serves the web dashboard)` and three
doc-comment sentences). No route, settings key, TLS/session/SSH logic, D-Bus
interface member, HTTP endpoint or unit directive changed.

`mosd/dist/com.mos.mosd.conf` is modified but **comment-only**: the three
changed lines are inside the explanatory comment block and the extension-point
example (`<policy user="webd">` -> `<policy user="apid">` in a commented-out
sample). No live policy stanza changed. Likewise every changed line under
`mosd/mosd/` and `mosd/mosd-settings/` is a `//`, `///` or `//!` comment —
filtering the diff for non-comment lines returns nothing.

## Deliverable 3 — assertion accounting

Measured independently on this base; the "before" column is
`git show 86cd669:<path> | grep -cE '<pattern>'`, the "after" column is
`grep -cE '<pattern>' <path>` on the working tree. **GNU `grep`, `-c` = matching
lines.** The exact pattern used is printed in its own column, because for two of
these metrics the pattern *is* the measurement.

| metric | pattern used | file | before | after | verdict |
|---|---|---|---|---|---|
| v1 pass | `^\s*pass ` | `os/verify-image.sh` | 96 | 96 | match |
| v1 fail | `^\s*fail ` | `os/verify-image.sh` | 125 | 125 | match |
| v1 ext_regular | `^\s*ext_regular ` | `os/verify-image.sh` | **23** | **23** | match (see note) |
| v2 pass | `^\s*pass ` | `os/verify-image-v2.sh` | 132 | 132 | match |
| v2 fail | `^\s*fail ` | `os/verify-image-v2.sh` | 198 | 198 | match |
| v2 sq_regular | `^\s*sq_regular ` | `os/verify-image-v2.sh` | 41 | 41 | match |
| v2 sq_grep | `^\s*sq_grep ` | `os/verify-image-v2.sh` | 15 | 15 | match |
| v2 sq_enabled | `^\s*sq_enabled ` | `os/verify-image-v2.sh` | 8 | 8 | match |
| v2 elf_is_aarch64 | `^\s*elf_is_aarch64 ` | `os/verify-image-v2.sh` | 2 | 2 | match |
| health checks | `^check ` (fixed string, `grep -c`) | `os/health/test.sh` | 49 | 49 | match |
| health cases | `new_case` (fixed string, `grep -c`) | `os/health/test.sh` | 20 | 20 | match |

**All eleven before/after pairs are identical. No verifier assertion was
deleted rather than renamed.** The three touched verifier files each show equal
insertions and deletions (`os/verify-image.sh` 17/17, `os/verify-image-v2.sh`
14/14, `os/health/test.sh` 11/11), which is the shape of a pure substitution.

### The `sq_regular` trap, confirmed

All three spellings measured on the current tree:

| pattern | count | what it actually counts |
|---|---|---|
| `^sq_regular ` | 40 | misses the indented call at `os/verify-image-v2.sh:944`, inside a `for` loop |
| `^\s*sq_regular ` | **41** | the assertion call sites — the correct measure |
| `sq_regular` (unanchored) | 42 | also counts the function definition `sq_regular() {` at `:811` |

### The same trap a second time, in `ext_regular`

The task brief states the `v1 ext_regular` baseline as **21**. Measured with the
prescribed `^\s*ext_regular ` pattern the baseline is **23**, and the current
tree is also 23. The difference is not an assertion count changing — it is the
identical pattern trap:

| pattern | before (`86cd669`) | after (`HEAD`) | what it counts |
|---|---|---|---|
| `^ext_regular ` | 21 | 21 | misses two indented calls |
| `^\s*ext_regular ` | **23** | **23** | the assertion call sites |
| `ext_regular` (unanchored) | 24 | 24 | also counts `ext_regular() {` at `:514` |

The two indented calls are `os/verify-image.sh:815`
(`ext_regular "/usr/lib/systemd/system/${u}.service"`) and `:862`
(`ext_regular "/usr/lib/mos/${h}"`), both inside `for` loops, and both present
identically at `86cd669` and at `HEAD`. So the stated baseline of 21 is the
`^ext_regular ` number quoted against the `^\s*ext_regular ` pattern; it is a
pattern mismatch in the brief, **not** an assertion loss. Before equals after
under every one of the three patterns, which is the property that matters.

## Deliverable 4 — the task index is closed

`docs/task/index.md` gains three rows, appended in the existing format
(`- [x] [**RFCT-0NN Title**](RFCT-0NN.md) \`P1\``, per the file's own "New tasks
append to the end" rule):

- `RFCT-055 Rename webd to apid: crate, binary, unit, StateDirectory, image, verifiers, health gate`
- `RFCT-056 Documentation for the apid rename and the keep-two-processes decision`
- `RFCT-057 Closing audit of the apid rename: repo-wide completeness, consistency chain, assertion accounting`

`make docs-verify` before this change: `2 FAILED, 130 passed`. After:
`136/136 PASS`.

## Deliverable 5 — the two carry-ins

### Carry-in 1 — `docs/plan/PLAN-010.md` retention note: DONE

A short note is added directly under the frontmatter stating that every `webd`
below is a deliberate retention (the name the daemon had while that milestone
was executed), that the one forward-looking statement — the `## Context`
architecture diagram — was renamed to `apid` because it describes the target
rather than the past, and that current-state documentation lives in
`docs/design/`. The retained occurrences themselves are untouched.

### Carry-in 2a — the `apid` name collision in `docs/plan/index.md`: DONE

PLAN-003's title, *"Retire apid/trustd/talosctl/dashboard, bring up webd
skeleton and rescue shell"*, uses `apid` for the **Talos** machine API daemon —
a genuine collision inherited from the abandoned Talos base. Before this change
a reader could not distinguish it: the index gives no context, and the same
token now names the mos product daemon in `README.md:7`, `docs/architecture.md`
and every design doc.

The title is a historical plan title and is **not** rewritten. A one-line note
above the plan list states the collision and that plan titles are never
rewritten. `docs/task/index.md` carries the same collision in the RFCT-003 row;
it is left as-is, because that index is one link away from the plan index and
the note there covers the campaign's only two occurrences of the ambiguity.

### Carry-in 2b — the `README.md` `talos/` claim: REPORTED, NOT FIXED

`README.md:16` lists `talos/  OS core (independent git repo): Talos fork —
rootfs, machined, apid` in the layout tree, and `:34` describes it as a
standalone repository. The directory is **absent** from the tree.

It is **not** a plain factual error about what exists today, so under this
task's authority it is not fixed:

- `.gitignore:1` lists `talos/` — the directory is *deliberately* untracked, an
  external checkout a developer clones alongside this repo.
- `Makefile:31` still routes `make os` to `$(MAKE) -C talos`, and `:13`/`:28`
  advertise it. `board/x64/README.md:5` also relies on it.

So the README describes a real, still-referenced sibling checkout, not a
phantom. Two related observations are **reported rather than changed**, because
each is a live question the campaign did not decide:

1. **The collision is worse in `README.md` than in the plan index.**
   Line 7 declares "`apid` is the API daemon; the web dashboard is what it
   serves", line 15 places `apid` in `mosd/`, and line 16 places `apid` in
   `talos/`. Same token, two different daemons, nine lines apart, in the
   repository's front door. The plan-index note does not reach here. A
   one-clause qualifier on line 16 (`apid` -> `apid (Talos's)`) would resolve
   it. Not made: this task's authority over `README.md` is limited to plain
   factual errors, and this is an ambiguity, not an error.
2. **Whether the Talos base is still a build target at all** is unresolved.
   PLAN-010 replaced the Talos core with systemd and PLAN-003 retired Talos's
   `apid`, yet `make os` still delegates into `talos/` and `extensions/`
   contains only a `README.md`. Deciding that is out of scope here and reopens
   nothing this campaign settled.

## Commands run and results

| command | result |
|---|---|
| `git rev-parse HEAD` | `c460ec90c8d8e5367c14713f7f490e05a84e5073` — correct base, no repair needed |
| anchors: `mosd/apid/` present, `mosd/webd/` absent, `mosd/dist/apid.service` present, RFCT-055/056 present, no non-`docs/` `webd` | all five agreed |
| `command grep -rIl webd --exclude-dir=.git --exclude-dir=_out .` | 58 files, all under `docs/` |
| `command grep -rIn -E 'WEBD\|Webd\|WebD\|webD' ...` | 31 lines, of which 7 are in this record itself; the other 24 are in `PLAN-003.md` (7), `mos-ui-inventory.md` (7), `RFCT-055.md` (8), `RFCT-003.md` (1), `dashboard.md` (1) — all justified categories |
| `cmp os/health/mos-health os/rootfs/overlay-v2/usr/lib/mos/mos-health` | identical |
| `make docs-verify` (before) | `2 FAILED, 130 passed` |
| `make docs-verify` (after) | **`136/136 PASS`** |
| `bash mosd/hack/check.sh` | **ALL CHECKS PASSED** |
| `make os-image-cx3576` + `bash os/verify-image.sh` | **PASS (136/136 checks)** |
| `make os-image-cx3576-v2` + `bash os/verify-image-v2.sh` | **PASS (317/317 checks)** |
| `make os-health-test` | **PASS (54/54 checks)** |
| `make os-shadow-test` | **PASS (220/220 checks)** |
| `make os-dbus-policy-test` | **PASS (10/10 checks)** |
| `make os-repart-test` | **PASS (18/18 checks)** |
| `make os-devkeys` | ran once: this fresh worktree had no `os/rauc/.devkeys`, which `os-bundle-cx3576` requires. Output is gitignored |
| `make os-bundle-cx3576` | OK — bundle built, inline signature verified by `O = mos development, CN = mos development bundle signer` |

This task's diff is documentation-only; the cargo and image gates are
unreachable by it (`git diff --name-only c460ec9 HEAD | grep -v '^docs/'`
returns nothing). They were run anyway, because this record's purpose is to
prove the campaign's end state rather than only its own delta.

## What could NOT be proved

- **No on-device run.** Identical to RFCT-055's limitation and not resolved
  here. Every consistency link above is read from a file or asserted by a
  host-side verifier against an image; nothing was booted on CX3576. That
  `apid.service` actually starts after `var-lib-mos.mount`, binds :443/:80,
  regenerates its certificate into `/var/lib/mos/apid` and answers `/healthz` is
  established structurally, not observed.
- **The update-across-the-rename path was not exercised.** No bundle was
  installed over a device whose `/var/lib/mos/webd` was populated, so the
  orphaning outcome documented in `dashboard.md` §7.4.2 remains reasoned rather
  than demonstrated.
- **Category assignment is a reading, not a mechanical proof.** The 58 files
  were classified by reading each occurrence in context; the historical status
  of the plans was cross-checked against their `- **status**:` lines and the
  research documents against their own dating, but "this sentence describes the
  past" is ultimately a judgement, not a check a script can re-run.
- **Binary files are excluded.** All greps use `-I`. The tree's binary content
  is BSP firmware, U-Boot blobs and a splash image under `board/cx3576/`, none
  of which could carry a daemon name meaningfully, but the exclusion is stated
  rather than assumed.
- **`README.md` line 16 remains ambiguous** (carry-in 2b). It is reported above
  with the exact fix that would close it; making it was outside this task's
  authority.
