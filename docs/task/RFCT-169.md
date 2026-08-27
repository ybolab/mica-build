# RFCT-169 PLAN-019 M5: the tree-wide reference sweep and the campaign closeout

- **status**: completed
- **priority**: P2
- **owner**: ai-agent
- **createdAt**: 2026-08-27
- **claimedAt**: 2026-08-27
- **completedAt**: 2026-08-27
- **plan**: PLAN-019 (M5)

Nothing moves in this milestone. It repairs the two live tree blocks (P1), sweeps
the path tokens the citation gate cannot see, exercises the narrow prose licence
Amendment 2 item 7 grants, proves the old paths are gone by five independent
sweeps, and closes the campaign.

The whole of M5's edit licence is: path tokens, the four prose statements
enumerated in its spec, and the records. Every other stale or false sentence
found on the way is reported here rather than rewritten.

## Scope

| file | change |
| --- | --- |
| `README.md` | layout block: the deleted top-level `board/` gone, `os/boards/` and `os/pkgs/` named |
| `docs/architecture.md` | layout block rebuilt; `:21`, `:23`, `:24`, `:109` repointed |
| `docs/design/*.md` (9 files) | 193 backticked path tokens reprefixed |
| `docs/design/release-signing.md` | `mos-sign` → `rauc-sign` across the runbook; the example datastore renamed deliberately |
| `docs/design/api.md` | the TUF-skeleton paragraph; the Uptane-client citation |
| `docs/task/RFCT-166.md`, `167`, `168`, `169` | the four milestone records |
| `docs/task/index.md` | four rows appended, RFCT-165's row flipped to `[x]` |
| `docs/plan/PLAN-019.md` | status, completedAt, milestones — the one permitted plan edit |

## P1 — the two live tree blocks

Both blocks were already wrong before this campaign: both still drew a top-level
`board/` that PLAN-018 deleted, and `ls -d board` fails. Adopted into M5 by
Amendment 2 item 2, on the reasoning that rewriting a block while knowingly
leaving a directory in it that does not exist is worse than either fixing it or
not touching it.

`docs/architecture.md` now lists **eight** children of `os/`, which is what the
tree has: `boards`, `build`, `build-env`, `pkgs`, `rootfs`, `tests`, `tools`,
`verify`. RFCT-165 measured nine at `1bbd799`; the difference is exactly the two
this campaign folded into `pkgs/` — `podman/` and `update/`. The block also no
longer attaches "podman/ pins the engine" to the `tests/` line, where it read as
a child of `os/tests/`.

`docs/architecture.md:23` — the BSP-artifacts row, which still cited `board/` —
was corrected in the same pass. It is PLAN-018 rot rather than this campaign's,
and sits outside the two blocks P1 names; it is repaired here because it is the
same defect in the same file, three lines from a block being rebuilt. Named
explicitly so a reviewer can tell a decision from an accident.

## The path-token sweep

A backticked path token with no line number is invisible to
`docs/verify-citations.sh`, which parses `path:line`. It is still wrong. In the
gated corpus — `docs/design/*.md` excluding `*.zh.md`, plus
`docs/architecture.md` — there were **219** such tokens carrying a path this
campaign moved. 193 were reprefixed; **26 survive**, each justified below.

| pattern | before | after |
| --- | --- | --- |
| `mosd/` | 192 | 25 |
| `os/podman` | 2 | 0 |
| `os/update/` | 8 | 0 |
| `update/sign` | 4 | 1 |
| `update/README.md` | 4 | 0 |
| `mos-sign` | 10 | 1 |
| `mos_sign`, `mos-update-verify` | 0 | 0 |

`update/sign` and `mos-sign` share one surviving token: the grep string on
`api.md:3469`.

Six further lines are bare (unbackticked) `mos-sign` command lines inside
`release-signing.md`'s fenced ceremony transcripts. They are outside the
backtick census and were renamed with the binary: `:62 :74 :114 :295 :297 :308`.

### The rule the survivors follow

Amendment 2 item 6 ruled on `api.md:3466`: *leave it, or re-run the grep at HEAD
and restate — never rewrite the quoted command's strings.* Applied generally,
that gives one rule with two branches:

- **Leave** a token when its sentence attributes a measurement to a named commit
  (`f7cb5ba`, `86cd669`, "at that commit", "at this commit"), or when the
  measurement it reports is **false at HEAD**. Rewriting the path in either case
  relocates a claim nobody measured onto the current tree.
- **Rewrite** a quoted command whose result is asserted in the present tense —
  but only after re-running it at HEAD and confirming the stated result. That is
  item 6's own second branch, exercised rather than assumed.

Re-run and confirmed at HEAD, then rewritten: `find os/pkgs/mosd/apid -type f
! -name '*.rs'` (two files, as stated); `find os/pkgs/mosd/apid -type d` (five
directories, as listed); `grep -n "ServeDir\|ServeFile"` (nothing);
`grep -n "include_str!\|include_bytes!"` (two hits, neither an asset);
`grep -rn Multipart os/pkgs/mosd/` (nothing); `http-equiv` (nothing).

Re-run and found **false at HEAD**, therefore left: `grep -rci rauc
mosd/mosd/src/` no longer "returns 0 across all 12 source files" — the directory
holds 21 files and `rauc.rs`, `bus.rs` and `main.rs` answer 97, 80 and 3. And
"no `rauc install` caller anywhere in `mosd/`" is false: `install_bundle` exists
at `os/pkgs/mosd/mosd/src/rauc.rs:98`. Both are pre-existing rot from mosd's own
development, not from these moves, and both are reported below.

### The 26 survivors

| location | why |
| --- | --- |
| `api.md:69` | provenance, "at that commit" — Amendment 2 item 6 by precedent |
| `api.md:2059` | provenance, "at `f7cb5ba`" — same |
| `api.md:137` | quoted grep, "at this commit" |
| `api.md:287`, `:419`, `:2088`, `:2122` | quoted greps at `f7cb5ba` |
| `api.md:1903`, `:4108`, `:4310` | quoted greps at `86cd669` |
| `api.md:3469` | Amendment 2 item 6's own ratified exclusion |
| `api.md:4102` | verbatim quotation of `dashboard.md:1779`, whose claim is false at HEAD |
| `dashboard.md:120`, `:786`, `:1777` | the "0 across all 12 files" rauc measurement, false at HEAD |
| `dashboard.md:789`, `:1373`, `:1374`, `:1779` | the "no `rauc install` caller" claim, false at HEAD |
| `mosd.md:71` | `mosd/src/main.rs` is **workspace-relative**, paired with `mosd-settings/src/store.rs` on the line above — a token-as-identifier case, not a repo path |

`mosd.md:71` was caught by a post-sweep validator that resolves every backticked
repo-path token against the tree, not by reading. The sweep had rewritten it to
`os/pkgs/mosd/src/main.rs`, which does not exist; it was reverted.

## The narrow prose licence, exercised

**(a) `api.md:3461-3462`.** "`mos-sign` is a member of the same cargo workspace"
was made false by M3's extraction. The gate could not catch it: that citation
carries no adjacent quoted fragment, so it is resolution-checked only, and
`Cargo.toml:3` still exists. Restated for the extracted reality, and its two
citations repointed at `os/pkgs/rauc-sign/Cargo.toml:39-44` (the workspace
declaration and the comment recording that `cargo clippy --workspace` from
`os/pkgs/mosd/` no longer reaches this crate) and `:66-68` (rauc-sign's own
`tough` pin). Two citations before, two after.

**(b) The dead `tough` pin — NOT removed. See "Declined" below.**

**(c) `api.md:3559`.** A pre-existing mis-citation: it claimed
`os/pkgs/rauc-sign/README.md:32` "names the on-device Uptane client as out of
phase 1", and `:32` reads "over HTTP range requests." M3 repointed it faithfully
to the same content rather than to the line that would make the sentence true,
because choosing a different referent is a prose judgment. Repointed to `:9-12`,
the device-side bullet, which places `rauc-verify` in phase 2 and records that
nothing ships it to a device yet.

**(d) `release-signing.md:308`.** The example datastore
`/var/lib/mos-sign/trusted` is renamed to `/var/lib/rauc-sign/trusted`. **This
was deliberate, and it is recorded here because it is a free parameter**:
`git grep 'var/lib/mos-sign' -- . ':(exclude)docs'` returns nothing, so no code
defaults to it and nothing forced the choice. It renames with the binary so the
runbook stays internally consistent. A blind `sed s/mos-sign/rauc-sign/` would
have changed it silently and a reviewer could not tell which happened.

One further edit belongs to the same class and is named for it:
`release-signing.md:56` said to build with `cargo build --release -p mos-sign`
"in the `mosd/` workspace". A prefix rewrite would have produced
`os/pkgs/mosd/`, which is the wrong workspace after M3. It now names
`os/pkgs/rauc-sign/`.

## Declined: removing the dead `tough` pin

M5's spec asked for `os/pkgs/mosd/Cargo.toml:42-44` to be deleted once (a) was
rewritten — the pin is dead, no member declares it and it has left the lock.
It was **not** removed, for two reasons measured here.

1. `docs/design/dashboard.md:938-941` makes a substantive claim about the mosd
   workspace's crypto posture and cites `os/pkgs/mosd/Cargo.toml:42-43` **with a
   quoted fragment** — the "tough 0.18 is the last release whose crypto backend
   is `ring`" comment. Deleting those lines turns that citation red and falsifies
   the paragraph. Repairing it would mean repointing a claim about *the mosd
   workspace* at *rauc-sign's* manifest, which is a prose judgment M5's licence
   does not cover.
2. Eleven further citations into that file target lines ≥ 45 and would all shift
   by three: `api.md:132 :135 :136 :154 :155 :156 :708 :2008` and
   `dashboard.md:932 :934 :936`.

PLAN-019's own acceptance for M5 also reads "no Cargo change". The two
directions of the spec contradict each other here; the tree settles it. After
(a), no live document cites the dead pin *as rauc-sign's dependency* — only
`dashboard.md` cites it, for a comment that remains true as written. The pin is
recorded below as a follow-up rather than removed under a licence that does not
stretch to its consequences.

## The five sweeps

Run tree-wide, excluding `docs/plan/`, `docs/task/` and `docs/research/` (dated
history, Decisions item 4) and `*.zh.md`.

1. **Literal `git grep -F`** for `mosd/`, `os/podman`, `os/update`,
   `update/sign`, `mos-sign`, `mos_sign`, `mos-update-verify`, filtered through
   the `(?<![/\w.-])` boundary. Survivors: the 26 documented above, the
   allowlist below, and the `os/update/bundle.sh` provenance class.
2. **Segment-built paths.** Every `join(...)` and every quoted-segment array now
   carries `'pkgs'`: `checks-connd.ts:53`, `checks-system.ts:52`,
   `smoke-pins.ts:31` and `:134`, `smoke-pins.test.ts:157`, `smoke.test.ts:378`
   and `:379`. One new survivor, not on the briefed list:
   `os/pkgs/mosd/apid/tests/e2e.rs:50` — `.join("mosd")` is the cargo target-dir
   **binary name**, not a repo path.
3. **Escaped-regex literals** spelled `mosd\/` inside `.toThrow(/.../)`: one hit
   tree-wide, `os/build/src/boot-cx3576.test.ts:119`, and it is
   `os\/update\/bundle\.sh` — the provenance class, not a live path.
4. **Variable-prefixed paths** — `$REPO_ROOT/mosd/...`, `${REPO_ROOT}/...`. The
   acceptance grep's own lookbehind excludes this shape by construction. Clean
   tree-wide: the only hits are `docs/task/RFCT-165.md` (dated history),
   `docs/verify-citations-test.sh` (deferred, below) and
   `os/rootfs/scripts/mosd-install.sh:34-35`, whose `/tmp/mosd/apid` is the
   staged build context.
5. **Token-as-identifier**, which must NOT be rewritten. See the allowlist.

Also checked: assertions still *assert*.
`os/verify/src/smoke-pins.test.ts:157` reads
`expect(pin.file).toContain(join('os', 'pkgs', 'mosd', crate))` — a genuine
substring test against the absolute path `cratePath()` builds, which would fail
if the tree moved again.

### The survivor allowlist, each justified

| location | why it stays |
| --- | --- |
| `os/verify/src/checks-connd.ts:11`, `checks-system.ts:24` | verbatim quotations of PLAN-014, which reads `` `mosd/` Rust sources `` at `:243` and `:256`. `docs/plan/` is history and keeps old paths; rewriting the quotation would fabricate a quotation of a document that says something else. Both PLAN-014 lines were read to confirm it. |
| `os/verify/src/checks-system.ts:7` | "the ELF architecture of mosd/apid" is an and-slash in prose, not a path |
| `os/rootfs/README.md:265` | the staged `mosd/` build-context directory, not a repo path |
| `docs/architecture.md:144`, `os/pkgs/README.md:23` | `mosd/` named relative to its parent `os/pkgs/`, correct as written |
| `os/build/src/stages.ts`, `stages.test.ts`, `stages-cli.ts` | 17 occurrences of the bare word `mosd` on 17 lines — the feature identifier driving `selectStages()` and `--without mosd` |
| `os/build/src/mkimage-v2.test.ts`, `mkimage-x64.test.ts`, `pin-seeded-times.test.ts` | 3 `Package: mosd` dpkg strings |
| `docs/design/mosd.md`, `mosd.zh.md`, `os/rootfs/scripts/mosd-install.sh`, `os/rootfs/stages/33-feature-mosd.Dockerfile` | the four mosd-named files |
| `docs/verify-citations-test.sh` | 27 fixture strings under a `mktemp -d` root. P4 is deferred past campaign close (Amendment 2 item 3). |

Rewriting any of the identifier class would break feature selection **while
every gate stayed green**, which is why it is enumerated rather than trusted to
judgment.

The identifier counts differ from the campaign brief's (13 + 9 = 22). Measured
here: 17 bare-`mosd` occurrences across the three stages files, and 3
`Package: mosd` lines. The class and the ruling are unchanged.

## Reported, not acted on

### Pre-existing rot, neither caused nor touched by this campaign

- **~31 references to `os/update/bundle.sh`**, a file this tree has never
  contained: `os/build/src/bundle*.ts`, `tools/rauc*.ts`, `toolbox.ts`,
  `toolsets.ts`, `tools/mtools.ts`, `boot-cx3576*.ts`,
  `os/boards/{cx3576,x64}/board.env`, `os/pkgs/rauc/manifest.raucm.in`,
  `os/rootfs/scripts/rauc-install.sh`. They are provenance references to a shell
  script that was ported to TypeScript. They read worse now that `os/update/` is
  gone, but rewriting them would be wrong — they name where the ported-from code
  lived. Same class: `os/mkimage-v2.sh` and `os/mkimage-x64.sh` at
  `boot-cx3576.ts:204` and `board.env:115`, and 24 unresolvable backticked
  tokens in the design docs, mostly `os/mkimage-v2.sh` and
  `os/verify-image-v2.sh`.
- **The rauc measurements that have gone stale.** `grep -rci rauc
  mosd/mosd/src/` returning "0 across all 12 source files" is cited in
  `dashboard.md:120`, `:786`, `:1777` and `api.md:4108`; the directory now holds
  21 files and three of them answer non-zero. "No `rauc install` caller anywhere
  in `mosd/`" is cited in `dashboard.md:789`, `:1373-1374`, `:1779` and quoted in
  `api.md:4102`; `install_bundle` exists. These are gap-table claims dated to
  `docs/research/mos-ui-inventory.md`, falsified by mosd's own development. A
  present-tense re-measure is a content edit for the design workstream.
- **`api.md:3464`** says the rauc-sign README "names the **on-device Uptane
  client**" as *"Explicitly out of scope for the whole crate"*. The quote
  resolves at `README.md:41`, but the item named out of scope at `:43` is the
  Uptane director/image-repository split, not the on-device client. Pre-existing;
  a sibling of the `:3559` defect but not on M5's enumerated list.
- **`release-signing.md:313`** names a planned `update/lockbox/` path. `update/`
  no longer exists as a repository root, so the plan now names a location with no
  parent. Forward-looking, so not swept.
- **`docs/design/uboot-ab-handshake.md:4`, `:17`, `:110`** still say `board/`.
  `:110` is upstream NXP's own `board/*.env` and is correct; `:4` and `:17` are
  PLAN-018 rot in a file P1 does not name.
- **`os/pkgs/mosd/Cargo.toml:41`** — `url = "2"` may be dead in that workspace
  too; `os/pkgs/rauc-sign/Cargo.toml:35` asserts the mosd lock "does not contain
  `tough` or `url` at all". Not measured here; named with the `tough` pin.

### Environment, not the tree

- **The host `bun` route is broken independently of this campaign.** Host bun
  1.3.13 cannot parse the committed `bun.lock` (lockfileVersion 2), so both
  suites must run via `MOS_VERIFY_CONTAINER=1` / `MOS_BUILD_CONTAINER=1` — which
  is the route CI takes anyway, since CI installs no bun.
- **`cargo-deny` emits pre-existing duplicate-crate warnings** in the mosd
  workspace (thiserror 1.0.69 vs 2.0.20). Warnings, not failures, and
  pre-existing.
- **CJK outside `*.zh.md` is not zero, and never was.** 71 lines: 8
  language-switch links in document headers (the localised label in each
  `](…zh.md)` link), 22 verbatim
  quotations of the user's own Chinese decisions in dated `docs/plan/`,
  `docs/task/` and `docs/research/` records, and 37 in vendored BSP READMEs under
  `os/boards/cx3576/bsp/`. **Zero were added by this campaign**, verified against
  the diff.

## Measurements

| gate | before | after |
| --- | --- | --- |
| `docs/verify-citations.sh` | 902/902 | 902/902 |
| — carrying a quote | 355 | 355 |
| — resolution checked only | 547 | 547 |
| — skipped, outside the tree | 50 | 50 |
| — skipped, bare filename | 168 | 168 |
| — skipped, host and port | 4 | 4 |
| `docs/verify-index.sh` | 513/513 | 525/525 |
| `docs/verify-citations-test.sh` | 16/16 | 16/16 |
| `docs/verify-index-test.sh` | 8/8 | 8/8 |

The index gate rises by 12 — three loops per new task file (forward, reverse,
and the once-each duplicate-row check) across four records.

`.zh.md` files: untouched. Amendment 2 item 4 recorded that Decisions item 3's
`.zh.md` licence would go unexercised in this campaign; it has.
