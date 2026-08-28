# RFCT-169 PLAN-019 M5: the tree-wide reference sweep and the campaign closeout

- **status**: completed
- **priority**: P2
- **owner**: (bkd campaign)
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

**(c) `api.md:3559`.** A pre-existing mis-citation: it claimed the README
"names the on-device Uptane client as out of phase 1", while
`os/pkgs/rauc-sign/README.md:32` reads "over HTTP range requests." M3 repointed it faithfully
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

## Withdrawn: removing the dead `tough` pin

M5's spec asked for `os/pkgs/mosd/Cargo.toml:51-53` to be deleted once (a) was
rewritten — the pin is dead, no member declares it, and it has left the lock.
It was queried before acting and the licence was then **withdrawn**, on two
independent grounds. `os/pkgs/mosd/Cargo.toml` is byte-identical in this
milestone.

**Ground 1 — out of scope.** PLAN-019's Scope section lists "Cargo dependency
changes" under **Out**. Deleting an entry from `[workspace.dependencies]` is
exactly that, whether or not anything still consumes it. Amendment 2 item 7
scopes M5's licence to falsified *prose statements*, not to manifests, and a
milestone spec has no authority to widen the plan's own Scope.

**Ground 2 — it would silently mispoint citations.** This was measured, not
argued: the three lines were deleted in a throwaway edit, the gate was run, and
the manifest was restored byte-identically.

The pin is **three** lines — `:42-43` comment, `:44` the dependency — so every
line below shifts *up* by three and each citation at line N resolves to what
used to be at N+3:

| citation | today | after the deletion it would read |
| --- | --- | --- |
| `:45` | `axum = "0.8"` | `` # `mosd/apid/openapi.json`, so the spec cannot describe a route the code does `` |
| `:46` | `axum-server = { ... }` | `# not serve. Each route's path is one constant, read by the axum declaration` |
| `:61` | `rustls = { ... }` | `bcrypt = "0.19"` |
| `:62` | `rcgen = { ... }` | `rand = "0.8"` |
| `:66` | `maud = "0.27"` | `tower = { version = "0.5", features = ["util"] }` |
| `:69` | `tower = { ... }` | `# rumqttc without default features is TCP-only: no TLS, and every remaining` |

Fifteen citation occurrences point at those six lines or at the `tough` block
itself. Under the deletion the gate reports:

```
docs/verify-citations.sh: 4 FAILED, 898 passed
  in scope: 902     resolution failures: 0     content failures: 4
```

**The in-scope count holds at 902 and no citation is orphaned.** Only the four
carrying quoted fragments go red — `api.md:708`, `dashboard.md:932`, `:934`, and
`dashboard.md:941`, which cites the `tough` block itself. The other **eleven
pass silently while naming the wrong dependency**.

That is the finding worth carrying: this campaign's binding acceptance is the
in-scope count held constant, and **that acceptance is blind to this class**. A
count-based check catches a vanishing first path segment (RFCT-167's six) and a
content check catches a moved quoted fragment; an unquoted citation into a file
whose *interior* shifted is caught by neither. It is the same shape as
`smoke-pins.test.ts:157`'s weakened assertion — green, and asserting the wrong
thing.

M3 deferred this deliberately and gave that reason. M3 was right.

After (a), no live document cites the dead pin *as rauc-sign's dependency*.
`dashboard.md:941` is the only citation into the `tough` block, and the comment
it quotes remains true as written.

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
   `os/pkgs/mosd/apid/tests/e2e.rs:73` — `.join("mosd")` is the cargo target-dir
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
| `docs/architecture.md:156`, `os/pkgs/README.md:23` | `mosd/` named relative to its parent `os/pkgs/`, correct as written |
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
### Follow-up: the dead `tough` pin needs its own plan

`tough` is declared at `os/pkgs/mosd/Cargo.toml:51-53`. **No workspace member
declares it**, and it has left `os/pkgs/mosd/Cargo.lock` entirely. Removing it
is a correct future change. It is not a small one, and it does not belong to
this campaign, for two reasons:

1. It is a **Cargo dependency change**, which PLAN-019's Scope puts under
   **Out**. It needs a plan that owns that decision.
2. **Six citations must be repointed with content verification in the same
   commit**, because deleting three lines shifts the manifest's interior up by
   three. The six, named here so the next person does not rediscover this the
   hard way:

   | line | what it holds today | cited by |
   | --- | --- | --- |
   | `:45` | `axum = "0.8"` | `api.md:135` |
   | `:46` | `axum-server = { ... }` | `api.md:136`, `api.md:155`, `dashboard.md:934` |
   | `:61` | `rustls = { ... }` | `api.md:154`, `api.md:2008`, `dashboard.md:932` |
   | `:62` | `rcgen = { ... }` | `api.md:156`, `dashboard.md:936` |
   | `:66` | `maud = "0.27"` | `api.md:132` |
   | `:69` | `tower = { ... }` | `api.md:708` |

   Plus `dashboard.md:941`, which cites the `tough` block itself at `:42-43`
   with a quoted fragment and would be orphaned outright — and whose paragraph
   claims the *mosd workspace* enforces a pure-Rust crypto posture *in that
   comment*, so it needs a prose decision, not a repoint.

   **Do not trust the gate to catch this.** Measured above: the deletion leaves
   the in-scope count at 902 with zero resolution failures, four content
   failures, and **eleven citations passing silently while naming the wrong
   dependency**. Re-derive each target by locating its content, the way
   RFCT-167 re-derived its six.

- **`os/pkgs/mosd/Cargo.toml:50`** — `url = "2"` may be dead in that workspace
  too; `os/pkgs/rauc-sign/Cargo.toml:35` asserts the mosd lock "does not contain
  `tough` or `url` at all". Not measured here; named with the `tough` pin, and
  it belongs in the same future plan.

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

### The gate set, and where each one ran

Every run below was produced from this worktree; the working directory was
recorded into each log before the command, because a green `rc` proves nothing
about *which* tree was green.

| gate | result |
| --- | --- |
| `os/verify` suite, `MOS_VERIFY_CONTAINER=1` | PASS 1066/1066 |
| `os/build` suite, `MOS_BUILD_CONTAINER=1` | PASS 689/689, no re-run needed |
| mosd workspace: fmt, clippy, nextest, doctests, deny | all rc=0, 600/600 tests |
| rauc-sign workspace: fmt, clippy, nextest, doctests, deny | all rc=0 |

The cargo runs use the recipe RFCT-165 section G ratified — repository at the
fixed path `/src`, `-w /src/os/pkgs/<workspace>`, `localhost/mos-build-rust`,
with the full explicit `PATH` and `LD_LIBRARY_PATH=/opt/rust/lib`. `cargo-nextest`
0.9.133 is bind-mounted from the artifact `check.yml` pins, sha256 verified; the
image carries none, and `cargo test` is not a substitute — it surfaces a false
apid failure from a shared-tracing-subscriber race.

`dbus-daemon` is absent from `localhost/mos-build-rust` and
`os/pkgs/mosd/mosd/tests/bus.rs:65` panics by name rather than skipping. It was
installed into the container for the run, which is what `check.yml` provisions
on its runner and for the same stated reason. Without it the suite is red on an
environment gap, not on the tree.

`cargo deny` reports `advisories ok, bans ok, licenses ok` for both workspaces.
It also emits 23 `duplicate` warnings in the mosd workspace and 3 in rauc-sign
(thiserror 1.0.69 vs 2.0.20 among them). Warnings under `multiple-versions =
"warn"`, pre-existing, and untouched by this campaign.
