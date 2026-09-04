# RFCT-307 The development-grade marker is staged but never installed

- **status**: completed
- **priority**: P0
- **owner**: meta-marker-install/bkd-8ud12dym
- **createdAt**: 2026-09-04 20:05
- **relatedPlan**: [PLAN-077](../plan/PLAN-077.md)

## Description

`main` composes an x64 image that fails `bash verify/run.sh --verify --board x64`:

```
FAIL: the baked meta/ is exactly the public set: /srv/mos/meta/GENERATED marks this
tree's signing material DEVELOPMENT-GRADE and the packed root ships no
/usr/share/mos/meta/GENERATED.
```

[RFCT-305](RFCT-305.md) (PLAN-077 slice G1) added `GENERATED` to
`rootfs/build.sh`'s `META_PUBLIC` as a **conditional** third entry. The staging
side is correct — the build log says `staged and checked 3 of 3 public-set
entries` and `_out/x64/meta-public/usr/share/mos/meta/GENERATED` exists — and
`rootfs/build.sh` copies the whole staged tree into the composition context. The
**install** side never learned about it. `rootfs/compose/compose-install.sh`
names each public-set path explicitly, on purpose, and its own comment prices
that choice as *"naming them means a third public file is a reviewed line here
as well as there"*. That reviewed line was never written, so the marker is
audited, staged, copied into the build context and then dropped.

The consequence is not cosmetic. The image reports itself production on
`GET /api/v1/system/info` and `build/src/release-manifest.ts`'s publication gate
reads the same absent file, so a bench image built on unprotected development
keys is one the gate would let out to a customer channel.

Neither contributing branch ran the case: the seam's composed run
([RFCT-301](RFCT-301.md)) had a two-entry allowlist, so tree and image agreed
and the biconditional held; RFCT-305 added the third entry and explicitly did
not compose an image, naming this exact pairing as the thing it had not proven.

## ActiveForm

Installing the conditional development-grade marker on the composition path,
and reconciling the named set against the staged set.

## Dependencies

- **blocked by**: (none) — RFCT-305 is merged at `86402c33`
- **blocks**: PLAN-037 Gate B (Gate A is not green until a composed image passes)

## Acceptance

- The marker reaches the image, and a production-shaped tree (no
  `meta/GENERATED`) still produces an image with none.
- A composed x64 image and `bash verify/run.sh --verify --board x64` **green**,
  in both dispositions.
- `(cd verify && bun test)`, `(cd build && bun test)`, `make docs-verify` green.
- `compose-install.sh`'s header comment corrected — it still says two files.
- The third-place question answered, and a recommendation on making the two
  lists fail when they disagree.
- `docs/plan/index.md`, `docs/task/index.md` and `docs/CHANGELOG.md` untouched.

- complete: the marker reaches the image in the disposition that has one and
  no image in the disposition that does not, and the two lists that decide
  that now disagree loudly instead of silently.

  **The fix.** `rootfs/compose/compose-install.sh` gains the reviewed line the
  allowlist entry was owed, and it is conditional the way the entry is:

  - **Staged → installed.** The condition read is `/mos-compose/meta-public/`
    and nothing else, which is the right seam. `rootfs/build.sh` already
    enforces tree ↔ staged (the conditional entry is staged iff `meta/` carries
    it, and B1's count is against what resolved), and
    `packed-meta-is-the-public-set` enforces tree ↔ image in both directions —
    so this step's job is **staged → image, exactly**, and `meta/` is a
    directory the composition container cannot see anyway.
  - **Absent → nothing, and that is not an error.** This is the one member of
    the set whose correct behaviour includes doing nothing. The keyring's
    `[ -s … ] || fail` shape is right for a required file and would refuse
    every build made on production material — which is every release build.
  - **Staged-but-empty, or not a regular file → refusal.** That is the
    equivalent of the keyring's refusal, and it is a narrow case on purpose:
    `rootfs/build.sh` treats an empty conditional source as absent and never
    stages it, and B1 refuses a staged path that is not a regular file, so a
    zero-byte or irregular file at this path is one damaged *after* the audit —
    and a marker that states nothing would be baked into the verity root as
    though it stated the grade.
  - **Both dispositions are announced.** In a log a silent nothing reads
    exactly like the line that was never written, which is how this defect
    survived a green build.

  **Which conditions are errors and which are the steady state, as the code now
  says it:** absent is the supported steady state (production); present and
  non-empty is the supported steady state (development); present and empty or
  irregular is an error; and a staged file no line installs is an error.

  ### Is there a third place?

  A sweep for every file naming a member of the baked public set — `META_PUBLIC`,
  `meta-public`, `meta/GENERATED`, `usr/share/mos/meta`, `keyring.pem` across
  `*.sh`, `*.ts`, `*.rs`, Dockerfiles, `Makefile`, `docs/`, `meta.example/` —
  separates into three kinds.

  **Producers — where a file becomes part of an image. Exactly two, and the
  answer to the question as asked is *no*: there was no third producer.**

  | place | what it decides |
  | --- | --- |
  | `rootfs/build.sh` `META_PUBLIC` | membership, source path, image path, required-or-conditional |
  | `rootfs/compose/compose-install.sh` | which staged path is installed into the root |

  Nothing else moves a byte of `meta/` toward an image. `rootfs/build.sh`'s
  hand-off to the composition context is a whole-tree `cp -a` with no
  enumeration, which is exactly why the staged marker reached the build context
  and stopped at the installer.

  **Oracles — independent transcriptions of the same set. Two, both already
  correct.** `verify/src/checks-root.ts` (`BAKED_META_SET`,
  `BAKED_META_MARKER`, `KEYRING_PATH`) and `verify/src/checks-fixture.ts` (the
  set the synthetic packed root seeds, deliberately production-shaped).
  RFCT-305 updated both. `checks-root.ts` says in its own comment that a member
  "belongs here only alongside a new line in rootfs/build.sh's `META_PUBLIC`" —
  it is *meant* to be an independent transcription, and that independence is
  why it is the check that fired. The fixture is why the unit suites could not
  have caught this: it constructs the shipped tree itself, so it measures the
  checks and never the composer.

  **Readers of individual baked paths, which are not enumerations of the set
  and needed no line:** `pkgs/mosd/mosd/src/system_info.rs`
  (`BAKED_META_MANIFEST_PATH`, `BAKED_META_MARKER_PATH`),
  `build/src/release-manifest.ts` (`readBakedTrust` over the extracted
  directory), `verify/src/checks-rauc.ts` (RAUC's `system.conf` keyring path).

  **Documentation** — `meta.example/README.md`'s operator table (all three rows,
  conditional disposition marked), `docs/design/build.md`,
  `docs/design/security-lifecycle.md`, `docs/design/diagnostics.md`,
  `docs/zh/design/build.md` — states the three-file set correctly and was not
  edited. One stale sentence found and deliberately **not** edited because it
  belongs to an approved plan's owner: PLAN-077 §1 still reads *"the baked
  public set therefore stays at two files"*, written when it answered PLAN-070
  open question 6 about a TUF root document and superseded by its own §2.

  ### Making the two lists fail when they disagree — recommended and **built**

  **Disclosure: this was implemented, not only recommended.** It is nine lines
  at the end of the meta block in `compose-install.sh`, no new file, target or
  convention, and it is exercised by the composed-image gate this task already
  had to run.

  Each install records the path it named (`meta_install <rel>`); afterwards the
  staged tree is walked and any file under `/mos-compose/meta-public/` that no
  line named is a refusal naming it. **Not a walk-install** — nothing is
  installed because it was found; the staged tree decides only whether the build
  *stops*, so the allowlist and the named lines remain the two reviewed places a
  public file passes through, and what changes is that violating that rule is a
  red build rather than a silent drop.

  **Why that seam rather than a lint.** The composition container is the only
  place both lists exist as *resolved values* in one process: the staged tree is
  `META_PUBLIC` after conditional resolution, `META_INSTALLED` is the named
  lines after theirs. A static comparison would have to re-implement "the
  conditional entry whose source is present", and a checker that re-implements
  the rule it checks agrees with itself.

  **What it does not catch, so the guarantee is not over-read.** Not the reverse
  direction — a line naming a path `META_PUBLIC` never stages; for a required
  entry `install` already fails on the missing source, and for a conditional one
  that case is by construction the absent case. Not drift between the producers
  and `checks-root.ts`: that pair is bound only by running the verifier over a
  composed image, deliberately. **The standing recommendation is therefore
  procedural** — any change to the public set must be closed by a composed image
  and `verify --board x64`, never by the unit suites, because `checks-fixture.ts`
  builds the shipped tree itself and no fixture-based test can see the composer.
  That is precisely the gate RFCT-305 named as not run.

  ### Gate results — 2026-09-04, in `/srv/bkd/worktrees/33z9aa5q/8ud12dym`

  **Every number below is against the MERGED head** (`518af8c7`, `main` at
  `9b4a053a` merged in), not against the pre-merge branch. The amd64 pool was
  rebuilt at that commit's stamp (`git518af8c7087b`) before any compose,
  producer by producer, on the private builder `mos-l3-8ud12dym`. Each gate ran
  with its own exit status rather than through a pipe.

  | gate | result |
  | --- | --- |
  | `(cd verify && bun test)` (via `verify/run.sh`) | **green** — 1268/1268, 39 files, 18275 assertions |
  | `(cd build && bun test)` (via `build/run.sh`) | **green** — 889/889, 28 files, 4327 assertions |
  | `make docs-verify` | **green** — 183 index, 448 link, 734 status, 231 zh coverage, 43 board |
  | composed x64 image + `verify --board x64`, **marker present** | **green** — `RESULT: PASS (313/313 checks, 22 skipped)`; smoke 12/12 |
  | composed x64 image + `verify --board x64`, **marker absent** | **green** — `RESULT: PASS (313/313 checks, 22 skipped)`; smoke 12/12 |

  **The merge changed the answer once, and it was measured rather than assumed.**
  `main` had meanwhile taken RFCT-304, which turns seven x_tables symbols from
  `=m`/absent into `=y` in `boards/x64/bsp/kernel/config/x64.config` and adds
  the matching assertions to `verify/src/checks-kernel.ts`. Run against the
  merged head, the image built before the merge went **FAIL (311/313)** on
  exactly those two kernel checks — a green that was about a different tree,
  which is the failure mode this whole task is about. The x64 kernel artefact
  was therefore replaced with the post-fix build, the pool rebuilt at the merge
  commit and both dispositions composed again; the two meta checks were
  unaffected in either direction, and the table above is the re-run.

  **Both dispositions, in the verifier's own words.** With `meta/GENERATED`
  present the build logs `staged and checked 3 of 3 public-set entries`, the
  compose logs `3 public-set file(s) installed`, and the check reads
  *"`/usr/share/mos/meta/` holds exactly 2 file(s) [updates/manifest.json
  GENERATED], each byte-equal to its source"*. With the marker removed — a
  production-shaped tree, and the generator does not re-create it because it
  regenerates no domain — the build logs `2 of 3`, prints no development
  warning, the compose logs *"no /usr/share/mos/meta/GENERATED … Not an error:
  that is what a production build looks like"*, and the check reads *"holds
  exactly 1 file(s) [updates/manifest.json]"*. `packed-keyring-from-meta` moves
  with it, reporting development-grade in the first and *"production material
  placed there on purpose"* in the second.

  **The reconciliation driven red, over real input.** A guard that never fails
  is the same class of thing as a line never written, so it was mutated: the
  meta block was taken **verbatim** out of `compose-install.sh` by line range
  (`set -eu`, the real `fail()`, lines 174–271), run in the pinned
  `IMAGE_DEBIAN_TRIXIE` against the **real staged tree** this build produced
  (`_out/x64/compose/meta-public`), and run twice. Unmutated it installs three
  files and exits 0. With one line deleted — `meta_install
  usr/share/mos/meta/GENERATED`, which reproduces exactly the defect `main`
  shipped — it exits 1 with *"rootfs/build.sh staged public-set file(s) this
  script installs nowhere: usr/share/mos/meta/GENERATED"*. So the check would
  have caught this at build time, and the positive control shows the harness is
  capable of green.

  **Out-of-scope files touched, all gitignored build inputs, none committed:**
  `pkgs/podman/out-amd64/` copied in from `/srv/mos` so the pool could be built
  without recompiling six upstream clones; `boards/x64/bsp/out/kernel/` copied
  in — first from `/srv/mos`, then replaced after the merge with the post-fix
  build from `/srv/bkd/worktrees/33z9aa5q/nksjhmcu`, which is RFCT-304's own
  output and matches the merged head's `x64.config` (all seven new symbols
  present, `modules.tar` shrunk to the four loadable modules
  `checks-kernel.ts` now names); `meta/` generated by the first build, its
  `GENERATED` marker removed and restored to drive the two dispositions;
  `_out/`. `git status` is clean on this branch. `docs/plan/index.md`,
  `docs/task/index.md` and `docs/CHANGELOG.md` untouched.
