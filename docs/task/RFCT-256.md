# RFCT-256 PLAN-028 M1: the no-slash citation form, resolved and its violations corrected

- **status**: completed — the no-slash form is resolved by the tracked-path-then-unique-basename rule, ambiguity is an error naming its candidates, the metalinguistic and no-candidate classes are counted skips, 392 sites were classified and their 41 violations corrected, and the fixture suite is 37/37; 2525/2525 citations, 995/995 index
- **priority**: P1
- **owner**: bkd/b0jd5e1a
- **createdAt**: 2026-08-29
- **plan**: PLAN-028 (M1)

`docs/verify-citations.sh` matched the no-slash citation form — `` `routes.rs:2545` ``
— with its token regex and then dropped it, on the ground that such a token is
shorthand with no base to resolve against. That left a measured **392**
citations in this corpus checked by nothing at all: not resolved, not
content-checked, and counted only as a skip. M1 teaches the gate to resolve
them the way a reader resolves them, and corrects what that turns up rather
than baselining it away.

Every number below was measured by this workstream, in this worktree, at a
pinned commit stated next to it. Nothing is relayed.

**How this record writes a citation it is talking ABOUT rather than making.**
A record whose subject is stale citations will assert every one of them if it
writes them plainly, which is the trap it exists to describe. Superseded
tokens are therefore written either double-backticked, `` `like this` ``, which
the gate now skips as an example of the form, or split into a path and a line,
`` `bus.rs` `:461-471` ``, which is the form docs/task/RFCT-172.md's ledger
already uses and which the token regex does not match at all. The split form is
used inside the two quoted gate outputs below, where a double-backtick cannot
reach: those two lines are verbatim except that the backticks the gate printed
around the token have been split, and this sentence is the notice of it.

## 1. The re-measured census, at `c5f7e96`

`c5f7e96` is this branch's base. Gates reproduce there: citations 2170/2170
PASS, index 863/863 PASS.

PLAN-028's Context says "393 no-slash sites corpus-wide". **Measured: 392**,
and it agrees exactly with the gate's own summary line
`skipped, bare filename with no directory to resolve against: 392`. Treat 393
as stale by one. L2's independent census in a clean worktree agrees at 392.

The 392 split four ways. Candidates are the `git ls-files` entries whose
basename equals the cited basename; the token is split at its LAST colon,
because that is what the gate does.

| class | sites | treatment |
|---|---|---|
| **metalinguistic** — the token sits inside a `` double-backtick span ``, quoting the FORM rather than citing | 8 | counted SKIP with its own reason |
| **zero candidates** — no tracked file carries that basename | 71 | counted SKIP, reusing the outside-this-tree refusal |
| **exactly one candidate** | 260 | resolved and content-checked |
| **several candidates** | 53 | ERROR naming every candidate; fixed in the document |

8 + 71 + 260 + 53 = 392.

L2's census classified the same 392 without separating the metalinguistic
class, and reported 266 unique / 53 multiple / 73 zero. The two agree: the
eight metalinguistic sites are six that would otherwise count as unique
(`routes.rs` ×4 in docs/task/RFCT-214.md, `api.md` and `routes.rs` in
docs/task/RFCT-170.md) and two that would count as zero (`a:5` and `a:6`, in
docs/task/RFCT-170.md's worked example of the chained-citation rule).

**Of the 260 unique-candidate sites: 1 failed resolution, 40 failed the content
check, 219 passed.** L2's brief flagged the one resolution failure and warned
that the content check would turn up more; it turned up forty.

### Why zero candidates must never fail

The 71 are not citations at all, and a gate that failed on them would be
broken rather than strict. Measured members of the class:
`localhost:8080` (a host and a port whose host is not digits and dots, so the
existing host-and-port branch misses it); `eth0:1` and `br-lan:1` (interface
aliases); `registry:5000`; `10-base:` and `34-feature-mqtt:` (Yocto and config
fragment names); `PLAN-014:`; `"settingsSchemaVersion":`; and **`::1`**, the
IPv6 loopback at docs/task/RFCT-105.md:436, whose path under the last-colon
rule is the single character `:`. The rest are real files in trees this
repository does not contain — `do_mounts.c`, `dm-init.c`, `bootmeth_*.c` and
`config_distro_bootcmd.h` from the kernel and U-Boot, and
`PageSettings*.qml`, `localsettings.py` and `check-updates.sh` from the Venus
OS research documents. This is exactly the class the gate's header already
refuses to judge, and the refusal is kept.

### The metalinguistic class, measured

Eight sites, in two documents, found by containment in a `` `` `` span rather
than by adjacency — the adjacency test (opening backtick preceded by a
backtick) finds only five, and misses docs/task/RFCT-170.md:65 and :70, where
the example token sits in the middle of a longer quoted span.

| site | token | what the document is doing |
|---|---|---|
| docs/task/RFCT-170.md:65 | `` `api.md:1251` `` | quoting RFCT-155's own quote-and-citation pair as an illustration |
| docs/task/RFCT-170.md:70 | `` `routes.rs:586-608` `` | illustrating an apposition that names rather than quotes |
| docs/task/RFCT-170.md:122 (×2) | `a:5`, `a:6` | the chained-citation case, twice |
| docs/task/RFCT-214.md:56, :65, :255, :265 | `` `routes.rs:95` ``, `:172`, `:2545` (×2) | naming the form under discussion |

Under the basename rule `routes.rs` resolves uniquely into a file of 6870
lines, so all four RFCT-214 tokens would resolve, find their line, and be
reported green while asserting nothing. Skip-with-a-reason is the honest
answer, and it is restricted to the no-slash form: a full-form citation inside
such a span is resolved and green today, and taking it out of scope would
loosen an assertion this milestone had no mandate to loosen.

## 2. The rule, as implemented

In `docs/verify-citations.sh`, for a token whose path carries no `/`:

1. inside a `` `` `` span → counted skip, `skipped, bare filename quoted as an
   example of the citation form`;
2. the path is itself a tracked file → resolve to it. `Makefile:32` and
   `.gitignore:8` are citations written in full whose path happens to carry no
   directory, and they are never ambiguous;
3. exactly one tracked file has that basename → resolve to it;
4. none → counted skip, `skipped, bare filename matching no tracked file, so
   outside this tree`;
5. several → **ERROR** naming the site and every candidate.

Candidates come from `git ls-files`, not a filesystem walk: a walk would pull
in `target/` and `node_modules/`, whose basenames would make ordinary names
spuriously ambiguous. Nothing else is excluded. That makes git a new dependency
of the gate, stated in its header next to the rest of its floor.

A resolved citation counts in the census under the first segment of the path it
RESOLVED to, so a repository-root file is its own segment (`Makefile`,
`.gitignore`, `README.md`). Failure messages name where a bare filename landed:
``cites `settings_api.rs:8` (resolved to os/pkgs/mosd/apid/src/settings_api.rs)``.

## 3. The 53 ambiguous sites, and what each became

Fixed in the document, never guessed. Where a document already writes the same
file in full nearby, that path was used; the cited line was then read to check
it still holds what the prose claims.

| document | sites | resolved to | note |
|---|---|---|---|
| docs/design/dashboard.md | 24 | `os/pkgs/mosd/mosd/src/bus.rs`, `os/pkgs/mosd/deny.toml`, `os/pkgs/mosd/apid/Cargo.toml`, `os/pkgs/mosd/apid/src/main.rs` | the same document writes each of these in full elsewhere; 13 of the 24 were stale and are re-anchored in section 4 |
| docs/task/RFCT-058.md | 6 | root `Makefile`, root `README.md` | resolved by the exact-path branch; no edit needed |
| docs/design/uboot-ab-handshake.md | 4 | `os/boards/cx3576/bsp/uboot/Dockerfile` | named in full on the neighbouring lines |
| docs/task/RFCT-162.md | 4 | root `Makefile` | exact-path branch; no edit needed |
| docs/task/RFCT-169.md | 3 | `os/pkgs/mosd/Cargo.toml`, `os/boards/x64/board.env`, `os/pkgs/rauc-sign/README.md` | each verified by content |
| docs/design/build-harness.md | 2 | root `.gitignore` | exact-path branch; no edit needed |
| docs/task/RFCT-081.md, RFCT-115.md, RFCT-139.md | 3 | `mosd/mosd/src/bus.rs` | the historical path, see below |
| docs/task/RFCT-105.md | 1 | `test/apid-api/HARNESS.md` | the sibling of `test/apid-api/README.md:14`, cited two lines above |
| docs/design/api.md, RFCT-045, RFCT-055, RFCT-167, RFCT-205 | 5 | root `Makefile`, root `.gitignore` | exact-path branch |
| docs/task/RFCT-215.md | 1 | — | **held, see section 9** |

Eighteen of the 53 needed no edit at all: `Makefile`, `.gitignore` and
`README.md` are ambiguous by basename and unambiguous by path, and the
exact-path branch resolves them. That branch is not a convenience — without it
twelve `Makefile` citations, four `.gitignore` and one `README.md` would be
hard errors in documents that cite them perfectly correctly.

Three sites resolve to `mosd/mosd/src/bus.rs`, a path this tree does not
contain, and that is deliberate: docs/task/RFCT-081.md:201, RFCT-115.md:132 and
RFCT-139.md:23 each write that path IN FULL on the line above or below the bare
one. Those records are anchored at the pre-`os/pkgs/` layout, and re-pointing
them at today's tree would falsify a completed record (the RFCT-210 lesson).
They now read as the history they are, and the gate skips them as outside.

## 4. The 41 content and resolution failures, by cause

### (a) api.md sections 2.2 and 2.3: a measurement pinned at `f7cb5ba`, 41 sites

Both sections say so in their own prose, and the measurement is exact. Verified
against `f7cb5ba` (an ancestor of this branch), where the tree still lived at
`mosd/` rather than `os/pkgs/mosd/`:

- every one of §2.3's 30 route citations is correct there —
  `mosd/apid/src/routes.rs:120` is `.route("/", get(serve::root))`, `:149` is
  the `/setup` route, `:947` is `async fn setup_submit(`, `:172` is
  `.route("/healthz", get(healthz))`, `:2545` is `async fn ssh_key_add(...)`;
- every one of §2.2's 11 model citations is correct there —
  `mosd/mosd-settings/src/model.rs:266-278` is `ProvisioningSettings`,
  `:301-314` is `WifiClientSettings`, `:163-169` is `WebAdminSettings`;
- and every checkable one is stale at HEAD: `ProvisioningSettings` is now at
  `pub struct ProvisioningSettings` (`os/pkgs/mosd/mosd-settings/src/model.rs:334`), `WifiClientSettings` at
  `:369`, `WebAdminSettings` at `:187`, `ConsoleSettings` at `:259`.

Two of §2.2's rows pass at HEAD by coincidence rather than by correctness —
`WifiApSettings` and `SshSettings` happen to fall inside their old ranges — so
a green content check on those two rows would have meant nothing.

**They are not re-anchored.** RFCT-215 recorded §2.3 as "a dated measurement
the campaign supersedes row by row" and left it as residue; re-anchoring the
line numbers alone would produce a table that reads freshly measured while its
prose is still the residue somebody else owns. Instead each citation is written
with the path it had at `f7cb5ba`, and both sections say that in a sentence, so
the gate skips them as paths this tree does not contain. That is the same
refusal the gate's header already documents. The cost is stated plainly: 41
citations M1 could have brought into scope stay out of it, and §2.2/§2.3 still
need a genuine re-measurement — recorded as residue in section 8.

One number in that table was not an `f7cb5ba` number at all. The `GET /healthz`
row cited `:3278`, and `mosd/apid/src/routes.rs` has 2599 lines at `f7cb5ba`.
It is re-derived from content to `:715`, where `async fn healthz()` is declared
there.

### (b) dashboard.md: shorthand for paths the same document writes in full, 13 sites

dashboard.md's `bus.rs`, `routes.rs`, `model.rs`, `deny.toml`, `Cargo.toml` and
`main.rs` citations are shorthand for `os/pkgs/mosd/...` paths the document
writes in full within a few lines — line 1003 cites
`os/pkgs/mosd/mosd/src/bus.rs:77` two lines above a bare `` `bus.rs:49-50` ``, and
line 1760 cites `os/pkgs/mosd/mosd/src/bus.rs:470-475` three lines above a bare
`` `bus.rs:49-51` ``. The campaign has re-anchored the full-form ones on every merge
("docs: re-anchor the citations M9's cutover moved (numbers only)"); the bare
ones were invisible to the gate and so were never re-anchored at all. That is
the silence M1 exists to end.

Re-derived from content at `d855804`, never by a constant offset:

| claim | was | is |
|---|---|---|
| `record` writes `{"error": ...}` into live state and logs | `bus.rs` `:461-471` | `fn record(state: &mut Value` (`os/pkgs/mosd/mosd/src/bus.rs:497-508`) |
| the settings write takes the lock | `bus.rs` `:431` | `:464` |
| it holds it across the reconciler loop | `bus.rs` `:183-188` | `:470-475` |
| `set_settings` returns `Ok(())` regardless | `bus.rs` `:183-193` | `:470-478` |
| `Ok(())` | `bus.rs` `:193` | `:478` |
| the lock's doc comment | `bus.rs` `:49-50` | `:50-51` |
| `Mutex<Inner>` | `bus.rs` `:49-51` | `:77` |
| `record` uses `map.insert` unconditionally | `bus.rs` `:134-136` | `:505-507` |
| `InvalidArgs` on an absent state path | `bus.rs` `:198-202` | `:663-664` |
| the `SettingsChanged` signal | `bus.rs` `:249-254` | `:905-912` |
| whole-tree reads | `bus.rs` `:160-164`, `:197-202` | `:610-614`, `:656-661` |
| the 502 page | `routes.rs` `:95-105` | `fn bus_error(err: &anyhow::Error)` (`os/pkgs/mosd/apid/src/routes.rs:3248-3258`) |
| the `STYLE` constant | `routes.rs` `:147-154`, `:165` | `:3326-3333`, `:3344` |
| the `.error`/`.saved` rules | `routes.rs` `:153-154` | `:3332-3333` |
| `network_submit`'s 303 | `routes.rs` `:696-720` | `:5519-5555` |
| the `/` pane's JSON dump | `routes.rs` `:587-596` | `:4725` |
| `[bans] multiple-versions = "warn"` | `deny.toml` `:16-17` | `multiple-versions = "warn"` (`os/pkgs/mosd/deny.toml:33-34`) |
| apid's dev-dependencies | `Cargo.toml` `:30-33` | `[dev-dependencies]` (`os/pkgs/mosd/apid/Cargo.toml:33-36`) |
| the TLS listener | `main.rs` `:72-79` | `RustlsConfig::from_pem` (`os/pkgs/mosd/apid/src/main.rs:195-204`) |

The four settings-subtree rows of §3.2's page table cited the model by dot-path
— `network.<iface>` against `model.rs` `:280-299` — and a dot-path is a name, not
an excerpt of any line, so those pairings could never have matched. They now
name the struct, which is an excerpt: `IfaceSettings` at
`pub struct IfaceSettings` (`os/pkgs/mosd/mosd-settings/src/model.rs:561`), `WifiClientSettings` at `:369`,
`WifiApSettings` at `:465`, `SshSettings` at `:198`.

### (c) Four fragments that named rather than quoted

The gate's header says it: a fragment that names a thing rather than quoting it
belongs anywhere but directly against the citation. Four had drifted into that
position and could not have matched any line.

| document | was quoted as | the source actually reads |
|---|---|---|
| docs/task/RFCT-137.md:49 | `DEFAULT_ROOT = "/srv/ui"` | `pub const DEFAULT_ROOT: &str = "/srv/ui"` |
| docs/design/dashboard.md:1606 | `reconciler.apply().await` | `reconciler.apply(&settings).await` |
| docs/design/dashboard.md:1507 | `GetSettings("network")` | `get_settings("network")` |
| docs/design/dashboard.md:503 | `<pre>` | maud's `pre { (pretty(details)) }` |

### (d) Two quotations the gate paired wrongly, and one it could not match

docs/task/RFCT-058.md:133 put a citation INSIDE a quotation, so the forward
adjacency rule armed it against the words that followed the closing quote — the
gate read the quotation as `, while line 4 today reads`. The sentence is
rephrased so no pairing is made; the citation itself is correct, and
`os/pkgs/mosd/dist/com.mos.mosd.conf:4` still reads exactly what the record
says it does.

docs/task/RFCT-205.md:323 quoted a Makefile comment with backticks the source
does not carry, so the comparison could never succeed. The backticks are
removed and the quotation is now literal.

docs/task/RFCT-172.md:93 is the one **resolution** failure: it cited
`` `checks-root.ts:629-633` `` and `os/verify/src/checks-root.ts` has 632 lines. It
is a row in a re-anchoring ledger whose left column deliberately holds the
superseded citation, and the same table already writes such rows in a split
form — `` `os/rauc/system.conf.in` `:50-62` `` — that does not parse as a
citation token. Row 93 now uses that form.

### (e) uboot-ab-handshake.md §1.1 was measuring a Dockerfile that has moved

The section cited `ARG UBOOT_REF=v2026.07` at `` `Dockerfile:33` ``. That text does
not exist anywhere in `os/boards/cx3576/bsp/uboot/Dockerfile` at `d855804`: the
U-Boot pin is now `ARG UBOOT_REPO=https://github.com/u-boot/u-boot.git` at
`:41` and `ARG UBOOT_COMMIT=ece349ade2973e220f524ce59e59711cc919263f` at `:42`,
and the build runs `make "${BOARD}_defconfig"` at `:67`. Re-derived from the
file, with the version claim moved onto the file's own header line. The DT
append moved 50-73 → 68-92, the `vdd-microvolts` block 68-72 → 88-92, and the
`bootcmd` tail 108 → 107 (its `PREBOOT` sibling, cited in full at line 516, was
one line off in the same direction and is corrected with it).

### (f) 56 citations re-anchored because this work moved their targets

Adding the pinned-path notes to api.md and the corrected sentence to
uboot-ab-handshake.md moved lines that other documents point at; so did the
gate's own header. All 56 are re-anchored numbers-only, each by locating its
quoted text and preserving the window length, never by a constant offset. Two
sentences were deliberately rewritten so they did NOT change: api.md §2.3's
"the line numbers in the first column are this commit's" and the gate header's
"is shorthand for a path named earlier in the prose and has no base to resolve
against" are each quoted verbatim by three or four other documents, so the new
text is appended around them rather than replacing them.

**Measured against the pre-image `d855804`: the gate found 33 of the 56, and a
deliberate audit found the other 23.** That gap is the whole argument for
arming. The 33 were the ARMED citations: the content check caught each one
because a quotation sat against it and the quotation no longer matched. The
remaining 23 carried no quote, so they resolved into a file long enough to
contain their number and the run read green at 2239/2239 with every one of them
pointing at the wrong line. The sha is stated here rather than left implicit
because this campaign has already retracted one measurement that was taken
through a moving symbolic ref: a number this load-bearing has to carry the
commit it was measured against.

They were found by re-deriving, not by inspection. For each of the three files
this milestone lengthened, the pre-image is diffed against the current text and
a map is built from the byte-identical blocks ONLY; a cited line inside a
rewritten block gets no map entry and is re-derived from its content by hand
rather than guessed at. No constant offset is applied anywhere, and the reason
is visible in the measurement: api.md displaces by **+0 below line 1339, +5 from
1340 to 1552, and +9 from 1553 on**, three zones inside a single change.

| file this milestone lengthened | delta | citations into it, at or past the first moved line | already right | displaced, now repaired |
|---|---|---|---|---|
| docs/design/api.md | +9 | 40 | 18 | 19 |
| docs/design/uboot-ab-handshake.md | +4 | 8 | 5 | 3 |
| docs/verify-citations.sh | +117 | 8 | 4 | 1 |

Every repair was checked by reading the pre-image line and the new line and
confirming they are byte-identical — for example the pre-image's
`access.device.passwordHash` row, cited from docs/design/bus.md, is the same
text at 1465 before and 1470 after.

This is the class that hides in the unquoted set, and this milestone enlarged
that set while it was at it. Arming is not a stylistic preference: it is the
only thing that made two thirds of this displacement visible without an audit
nobody is obliged to run.

**Then the audit itself was found to under-report, and the fix is the campaign's
seven-line window.** The first pass accepted a re-anchored citation if the wanted
token appeared ANYWHERE in the citing document. That is defeated by two
citations three lines apart into the same paragraph: **one row's correct token
vouches for its neighbour's wrong one**, and the audit reports green over a
citation it never actually checked. The failure is in the MATCHING, not in the
mapping — the destinations were computed correctly and then verified against the
wrong thing. Re-run per citing line,
with a **seven-line byte-identical window** required around the destination
before a line number is accepted — three lines before the range, the range,
three after, and it must occur exactly once in the current file — the same
audit found **four** wrong where it had found two, all four in the same
paragraph of docs/task/RFCT-210.md and docs/task/RFCT-139.md. A bare `}` cannot
satisfy a seven-line window, so a repeated-content mismap is designed out rather
than warned about, and a window that is not unique is REFUSED rather than
guessed at.

Confirmed on the merged tree after taking bkd/tcdocsrm: of the citations into
docs/design/api.md, 48 are confirmed by a unique seven-line window matched at
their own line, none is wrong, none has an ambiguous window, and 7 sit in
regions this milestone rewrote where the window cannot apply — every one of
those 7 is armed, so the content check holds them instead. The same sweep over
docs/design/uboot-ab-handshake.md confirms 7 with 1 rewritten-region case, and
over docs/verify-citations.sh confirms the rest with four armed re-anchors the
gate itself reported.

## 5. Before and after

Per-segment, measured at `c5f7e96` before and at `d855804` plus this work
after:

| segment | before | after | floor before |
|---|---|---|---|
| `docs` | 303 | 377 | 303 |
| `.github` | 2 | 2 | 2 |
| `os` | 1847 | 2021 | 1847 |
| `test` | 18 | 21 | 18 |
| `.gitignore` | — | 4 | — |
| `Makefile` | — | 12 | — |
| `README.md` | — | 1 | — |
| **in scope** | **2170** | **2438** | |

Every floored segment sat exactly on its floor at `c5f7e96` — L2 measured
1847 + 303 + 2 + 18 = 2170 with nothing left over — so a milestone that took
even one citation out of scope would have failed the census on the spot. None
did: every segment grew.

The skip lines moved as expected: outside-this-tree 380 → 424 (the 41 pinned
api.md citations plus the three historical `mosd/` ones), bare-with-no-match
392 → 71, and two new counted classes appear at 8 (metalinguistic) and 220
(bare filenames resolved).

## 6. The self-test, and the proof that it can fail

`docs/verify-citations-test.sh` gains eight cases (27 → 37, all passing), and
its fixtures become git repositories because the checker now reads
`git ls-files`.
`run_checker` refreshes the index immediately before every run, so a case that
writes a file after `new_fixture` needs no bookkeeping of its own.

The new cases: a bare filename with one tracked match, quoted and correct; the
same going red when its quotation no longer holds; a bare filename that IS a
tracked repository-root path, and its own census segment; two candidates
failing with both named; the metalinguistic skip; and no-candidate skips
staying green.

The metalinguistic fixture encodes the exact trap rather than a convenient
one. It builds a 200-line `os/pkgs/mosd/apid/src/routes.rs` — a unique basename
resolving into a long file, the shape docs/task/RFCT-214.md carries — and cites
it twice inside `` `` `` spans, once at a line that EXISTS (the silent-green
half) and once past the end (the loud half).

Proved by removing the skip. With the three lines that implement it deleted
from `docs/verify-citations.sh`, the case goes red:

```
RESULT: FAIL (34/35 cases)
FAIL: a metalinguistic bare filename: expected 5/5, exit 0, 5 in scope and a skip count of 2, got exit 1
    |   FAIL docs/design/fixture.md:23 cites `routes.rs` `:2545` (resolved to os/pkgs/mosd/apid/src/routes.rs), and os/pkgs/mosd/apid/src/routes.rs has 200 lines
    |   in scope:               7
    |   in scope, bare filename resolved against the tracked files: 3
    |   skipped, bare filename quoted as an example of the citation form: 0
```

Both halves fire: the in-scope count grows from 5 to 7, the skip count drops
from 2 to 0, and the past-the-end example raises a resolution failure. The skip
was restored from a copy taken before the mutation — not with `git checkout`,
which would have discarded the uncommitted extractor change with it — and the
suite returns to `RESULT: PASS (37/37 cases)`.

### The table trap, probed and pinned

The eighth case is not about the no-slash form at all; it pins a trap the
campaign measured while this milestone was in flight, and M1 owns the fixtures
for the traps more than one milestone shares.

Probed here against the real extractor, at `9ef57ee`, by running
`extract_citations` over a document written three ways:

| where the quoted fragment sits | result |
|---|---|
| the table cell BEFORE the citation's cell | `qkind=none`, near-miss 1 |
| the citation's OWN cell, quote first | `qkind=code`, armed |
| the citation's OWN cell, citation first | `qkind=code`, armed |
| prose, directly against the citation | `qkind=code`, armed |

The mechanism is one character: `|` is not in the backward scan's skippable
set, so the scan stops on the pipe and never reaches the fragment in the
neighbouring cell. Both directions work INSIDE a cell, which is the part worth
knowing: the forward rule is not defeated by the table, only the crossing of a
pipe is. So tables are not banned and prose is not mandated — the quote simply
has to be in the citation's own cell.

And the demotion is not silent. The adjacent-cell case scores near-miss 1, so
the gate has been reporting this class in its summary all along: it was visible
and unread rather than invisible. This record put its own table through that:
the before-and-after tables of section 4(b) opened with twelve near-misses, and
arming the "is" column by moving a quoted literal into the citation's own cell
took that to four — the four that cannot be armed, being two non-citations in
the zero-candidate evidence list and two paths pinned at `f7cb5ba` that the
gate skips as outside this tree. Writing a re-measurement as a two-column table therefore
demotes every citation in it to resolution-only, silently. The fixture pins
both halves — the same WRONG quote across a pipe stays green and is surfaced
only as a near-miss, while the same wrong quote inside the citation's own cell
arms and fails — because the useful half is the fix: move the quote into the
citation's own cell, or write the row as prose.

**How far the format explains this milestone's class, measured rather than
assumed.** Of the 392 no-slash sites at `c5f7e96`, **119 (30%)** sit on a
markdown table row; the concentration is real (28 in api.md, 23 in
docs/task/RFCT-169.md, 11 in dashboard.md) but 70% are in prose, so the table
format is a contributing cause of this class and not its origin. For the bare
form M2 owns the picture is similar and slightly stronger: **676** bare
`` `:NNN` `` tokens in citation scope, **249 (36%)** of them on a table row.
Both numbers are measured at `9ef57ee`; neither supports the stronger claim
that the format manufactures the class outright.

## 7. Baseline and ceiling moves, with reasons

Census floors are raised to measured. The base for these numbers is `d855804`
plus this milestone's commits; per the standing rule they are re-measured on
the merged tree at merge, never summed and never taken from one side.

Unquoted ceilings rise wherever a document's unquoted count rose, which is the
documented, reviewable override. There are two distinct causes and they are not
interchangeable:

- **full-forming a citation** moves it into scope under the OLD rule too, so
  four documents needed a raise in the corpus-corrections commit alone:
  dashboard.md 80 → 99, uboot-ab-handshake.md 12 → 14, RFCT-105.md 3 → 4,
  RFCT-169.md 19 → 22;
- **arming the no-slash rule** moves 220 more citations into scope, and 1151 of
  the 2438 in-scope citations carry no quote. Thirty-eight documents exceed
  their row, twenty of them because they had no row at all (a document with no
  row has a ceiling of 0). Each row moves to its measured count, exactly, with
  no slack.

## 6a. The expansion exception, and the ruling on how to write it

Full-forming a citation is per-site judgement and never a sweep. Three families
have been measured where expansion is the wrong repair, and the third is the one
this milestone met head on:

- a fragment that NAMES rather than quotes (section 4(c) here, nine more
  measured in api.md by M2);
- an elided paraphrase presented as a quotation;
- a **historical reference** — text recording lines as they stood at a past
  commit. Full-forming one of those produces a citation that RESOLVES against
  today's tree and asserts a falsehood, gate-green. api.md sections 2.2 and 2.3
  are exactly that, 41 sites of it.

Two forms answer it, and this milestone used the first:

**A, the pinned historical path.** Rewrite the citation with the path the file
had at the pinned commit, so it stays legible AS a citation, keeps its
provenance visible in the text, and the gate skips it as a path this tree does
not contain.

**B, prose plus a why sentence.** Strip the citation syntax — "sat at line
3449" — and say in a sentence why it is not a citation. There is nothing left
for the gate to resolve or to skip.

**The ruling is L1's, carried to this milestone by L2, and it is B for every
new instance; A is tolerated where it has already landed and is green, which is
why api.md §2.2/§2.3 are not being reworked.** The deciding argument is
state-dependence, and this workstream supplied the proof for it: A's safety is a
property of the TREE, not of the text. It holds only while no repository-root
directory of that name exists. `mosd/` WAS a repository-root directory before
the move under `os/pkgs/`, and M2 found an antecedent still naming it at
docs/task/RFCT-169.md:254. Re-create a top-level `mosd/` tomorrow and every
pinned-historical citation whose first segment is `mosd` stops being skipped and
starts resolving against whatever now lives there — with no commit touching the
document and nothing to announce it. It is the same scheduled-hazard shape as
the live-id self-test M3 closed, and it parks the text in precisely the bucket
this gate's own summary declares indistinguishable: *"a skipped-as-outside path
that once existed in this tree reads the same as one that never did"*
(`docs/verify-citations.sh:617`). B has no such dependency and cannot fire
under any future tree.

**api.md §2.2 and §2.3 are therefore a recorded, dated exception**: form A,
correct when chosen, green, and not to be repeated. Asked which I would choose
in future, the answer is settled rather than preferred — B, on L1's ruling, for
the reason above.

## 6b. What the merges taught the rule, after it was written

**`git ls-files` prints an unmerged path once per index stage, and the rule read
that as ambiguity.** Taking a base with conflicts in the working tree, the very
next run reported 46 ambiguous-basename errors whose candidate list named
`docs/design/api.md` three times — one file, three stages, read as three
candidates. Every citation to a conflicted document would fail for as long as
the merge was unresolved, which is exactly when a person is most likely to run
the gate. The index is now built one path once. It is a small guard and it was
not imagined: it was measured on a real merge, and it is the kind of thing that
only shows up in a state nobody thinks to test.

**Twelve citations were displaced by a merge and git flagged none of them.**
Git raises a conflict only where BOTH branches edited the same token; it says
nothing about a token edited on one side that points into a document displaced
on the other. So the unit of work after a merge is *files whose length changed*,
not *files git asked about*. Sweeping every moved-and-cited file with the
seven-line window found twelve wrong — five `Makefile` citations in
docs/task/RFCT-058.md, two in docs/task/RFCT-162.md, one in
docs/task/RFCT-205.md and four more including two in this record — against zero
conflicts raised. One of the twelve is the shape the seven-line rule exists for:
docs/task/RFCT-058.md:283 carries two `Makefile` citations on one line, moving
by different amounts (`:28` → `:29` and `:100` → `:103`), so a per-line
constant would have been wrong on the same line it was derived from.

**And one conflict where NEITHER side was right — this milestone's own 0-of-23
finding, reproduced live, in a citation rather than in a floor.** Both branches
re-anchored the same citation of the `os-devkeys` recipe, each correctly against
its OWN Makefile: this one to `Makefile:133-134`, the other to `Makefile:56-57`.
Git offered a two-way choice and BOTH CHOICES ARE FALSE on the merged tree,
where main's own Makefile changes had moved the recipe to `Makefile:136-137`
after both re-anchors were taken. The citation is unquoted, so take-ours and
take-theirs would each have produced a green run over a wrong line and nothing
would have caught it — which is the unarmed class this record measured at
d855804, arriving in a merge on a single line instead of in a corpus sweep.

Re-derived from the merged tree, and verified with the seven-line window rather
than read off: `os-devkeys:` occurs once as a target, at `Makefile:136`, its
recipe `bash os/pkgs/rauc/gen-dev-keys.sh` at `:137`, and the window around
them is unique. One nuance the exercise exposed and it is worth keeping: BOTH
losing windows are also unique in the merged file. A unique window confirms
where a line MOVED TO; it does not confirm that the line says what the prose
claims. The window is a guard against mismapping, not a substitute for reading
the destination.

## 6c. The separator that silently disarms, and the test that catches it

The repository's house style writes a citation and its quotation with an em
dash between them:

    `path:line` — *"quote"*

and that citation is UNQUOTED. The backward scan skips only `[ \t\n*_(]` and
the forward scan only `[ \t\n*_)]`; U+2014 is in neither set, so the scan stops
on the dash and never reaches the fragment. Probed here against the real
extractor, and the ASCII double hyphen fails identically, which the report of
this class did not mention:

| written as | result |
|---|---|
| `` `docs/verify-index.sh:2` — *"three document indexes"* `` | `qkind=none`, near-miss 1 |
| `` *"three document indexes"* — `docs/verify-index.sh:2` `` | `qkind=none`, near-miss 1 |
| `` `docs/verify-index.sh:2` -- *"three document indexes"* `` | `qkind=none`, near-miss 1 |
| `` `docs/verify-index.sh:2` *"three document indexes"* `` | `qkind=text`, ARMED |

These are not citations nobody thought about: every one is a citation somebody
armed ON PURPOSE — the quotation was written, placed against the citation, and
discarded by a separator. It scores near-miss 1, so like the table trap it has
been visible in the summary all along and unread.

**Measured on this tree: twelve such pairs in non-dated documents**, agreeing
with the count routed to this milestone, across api.md, uboot-ab-handshake.md
and RFCT-115 (4), RFCT-120 (2), RFCT-159, RFCT-167, RFCT-169 and RFCT-180.

**But only four of the twelve are in scope at all**, and that qualifies the
"cheapest arming wins in the corpus" framing. Eight cite paths this tree does
not contain — `u-boot/`, `src/` and `mosd/` are none of them repository-root
directories — so the citation is skipped before the content check could ever
run, and removing the separator changes nothing whatever. The four that are in
scope split two and two:

- two were armed by deleting the separator, and both quotations hold:
  api.md's `0700` against `mos-seed-home:46`, and RFCT-169's `.join("mosd")`
  against `e2e.rs:73`;
- two would have gone RED, and neither is a defect in the cited file. Both are
  before-and-after sentences where the em dash happened to separate the citation
  from the SUPERSEDED half. RFCT-180 reads *"`toBeGreaterThanOrEqual(0)` is now
  `toBeGreaterThan(0)`"*, so deleting the dash would have asserted the old value
  at the new line; re-ordered instead, and it now arms against what the line
  says today. RFCT-159 lists `board/` as a stale token it FOUND at
  `docs/architecture.md:23`, where the row now reads `os/boards/`; arming that
  would falsify the finding, so it stays unarmed deliberately — the historical
  reference of section 6a, and the reason a separator sweep cannot be mechanical.

**The arming test, which costs nothing: write it, run the gate, and let the
unquoted ceiling tell you whether the quote took.** The ratchet is the only
mechanism here that can report an intended arming that FAILED — a citation
meant to be armed and silently not is invisible to every other check, because
resolution still passes and the content check never runs. That is the ratchet
doing a job it was not designed for, and it is why a ceiling that refuses to
drop after an arming pass is a finding rather than an annoyance.

## 7a. Arming, and the one place this record does not arm

The campaign standard this milestone was written under: an ARMED citation buys
fragment-versus-line verification, and a raised ceiling is an override with
nothing behind it, so arm by default and raise a ceiling only when arming would
itself manufacture a defect. Every citation this milestone ADDED to a design
document is armed against a literal it verified — the four fragments in section
4(c) exist precisely because arming a fragment that names rather than quotes
produces a defect rather than a check.

This record's own row in the ceiling file is its measured count rather than an
absent row, because a document with NO row has a ceiling of zero and its first
unquoted citation would fail the ratchet. What remains unarmed in it is the
class named above: a token this record is talking ABOUT rather than making
would, if armed, assert the very citation it exists to report as superseded.
Everything else was armed, including the "is" column of section 4(b)'s tables.

One layout rule falls out of the same adjacency: two quoted gate records
written back to back can arm a SPURIOUS pairing, the second record's quoted
span landing within three words of the first record's citation. A blank line
between quoted records is the remedy — not arming, and not a raised ceiling.
The two gate outputs quoted here sit in different sections with prose between
them, and the near-miss probe above confirms neither manufactured a pairing.

## 8. Residues, recorded and not fixed

1. **A fourth citation form neither M1 nor M2 resolves.** Measured
   corpus-wide: **2 tokens, both on docs/task/RFCT-190.md:83**, which reads
   ``  `render-config.sh:239/:245/:265/:270` became `:234/:240/:260/:265` `` —
   a slash-separated compound of one path and four lines. Split at the last
   colon, the first token's path is `render-config.sh:239/:245/:265`, which
   CONTAINS a slash, so the scope rule reads its first segment as
   `render-config.sh:239`, finds no repository-root directory of that name, and
   skips it as outside the tree. It escapes M1's basename rule and M2's
   continuation rule both, silently, even though `render-config.sh` is a
   tracked file. No resolver is built for it here; the count and the worked
   example are recorded so the next pass starts from evidence.
2. **api.md §2.2 and §2.3 still need a genuine re-measurement.** M1 made their
   provenance legible; it did not make them true. RFCT-215 already recorded
   §2.3's "There is no `POST` and no `PUT` anywhere under `/api`" as false and
   left it, and §2.3's stated input — section 1.2's route table at `f7cb5ba` —
   no longer exists in that form, because RFCT-215 rebuilt section 1.2 at HEAD.
3. **uboot-ab-handshake.md §1.1 is stale beyond its citations.** Two claims in
   the same sentence M1 corrected are still unverified: the full-form
   `ARG RKBIN_COMMIT` (`os/boards/cx3576/bsp/uboot/Dockerfile:34`) is what that
   citation points at now
   rather than the U-Boot clone, and `generic-rk3576_defconfig` appears nowhere
   in that file — the build takes the board from an `ARG`. Both are unquoted,
   so the gate cannot see either.
4. **Two historical records whose claims no longer hold, deliberately not
   re-anchored.** docs/task/RFCT-058.md:264 says `` `Makefile:32` `` "still routes
   `make os` into `talos/`"; that line is an `@echo` about
   `os-factory-root-gate` today, and PLAN-010 retired the Talos path.
   docs/task/RFCT-105.md:407 says `` `HARNESS.md:120` `` gives ~200–260s to a login
   prompt; that file now says at `:149-150` that the harness never waits for a
   login prompt at all. Both citations resolve and neither carries a quote, so
   the gate is satisfied; both are findings about a superseded tree, and
   rewriting them would falsify the record.
5. **Neighbouring stale full-form citations, seen and left.** Re-anchoring the
   bare citations in dashboard.md put corrected numbers next to uncorrected
   ones: `os/pkgs/mosd/mosd/src/bus.rs:216-221` at line 1496 is cited for
   "`set_settings` … calls `record` for each overlapping reconciler" and is not
   where that happens. It is unquoted, in scope, and green. A re-anchoring
   sweep of the corpus's unquoted full-form citations is its own piece of work.
6. **A citation inside a fenced block is judged exactly like prose.** The
   extractor reads the document as text and knows nothing about fences, so a
   token in a sample of output or a code listing resolves and is checked like
   any other. Measured corpus-wide at `d855804`: **one** in-scope citation sits
   inside a fence, in docs/task/RFCT-155.md, and it is green. The class is
   therefore recorded rather than closed — the two gate outputs quoted in this
   record are the reason it was noticed at all.
7. **The RFCT-058 marker was withdrawn, so its citations stay live — and that
   is the better outcome.** An earlier draft of this record said M2 had
   committed a dated-record marker on docs/task/RFCT-058.md, which would have
   made the six citations this milestone full-formed in it exempt and therefore
   pointless. M2 landed five speculative markers under an eager framing
   (RFCT-058, 064, 066, 071, 212) and WITHDREW all five when L1 ruled for lazy
   marking; none is forced by this milestone's rule or by M2's. Verified here
   by the anchored grep the gate itself uses, `^<!-- dated-record:`:
   RFCT-058 carries 0, and the documents that do carry one are RFCT-215 (M2's,
   which is what made this milestone landable) and RFCT-210 (arriving from
   PLAN-027). So RFCT-058's six full-formed citations are live and checked, not
   pointless, and the marker this milestone forced is exactly one.
8. **The content check cannot tell a quotation from its negation.** It is a
   substring test, and *"the API is read-only"* and *"the API is not
   read-only"* both contain the bytes a quoted fragment names; an edit that
   falsifies a sentence can supply the token that keeps its citation green.
   Nothing mechanises this and nothing here proposes to. It bears on this
   milestone specifically because arming a citation that was never armed
   changes what a green run means for that site: the bytes are present, not
   the sentence true. Every passage whose truth this milestone's own edits
   changed and which is now armed was therefore read, not merely re-run — the
   four fragments of section 4(c), where the source text was substituted for a
   name, and the eight citations armed in this record's own tables.
9. **1151 in-scope citations carry no quote and 479 are near-misses.** Both
   counts rose with the scope. The near-miss counter is the surfaced form of
   RFCT-170's zero-tolerance adjacency rule: one interposed word between a
   quotation and its citation demotes the pair to resolution-only, and at four
   or more words even the near-miss counter goes quiet. M1 does not change that
   rule; it enlarges the population subject to it.

## 9. The blocker, and how it cleared

**docs/task/RFCT-215.md:54 is the one site the ambiguity error still fires on**,
and this milestone must not touch it:

```
FAIL docs/task/RFCT-215.md:54 cites `tests.rs` `:1821`, and tests.rs is the basename
of several tracked files: os/pkgs/mosd/apid/src/tests.rs
os/pkgs/mosd/mosd/src/reconciler/container/tests.rs; write the citation in full
so it names one
```

That row is the left column of a frozen re-measurement table: it quotes the
ORIGINAL WRONG citation and the right column carries the correction. Making the
left column resolve would destroy the finding the record exists to hold. Under
L1's standing ruling the document takes the `<!-- dated-record: -->` marker
instead, which exempts it from both checks and from the ratchet, and M2
(bkd/n50ivit0) owns landing it. Re-verified here at `d855804`: `git ls-files |
awk -F/ '$NF=="tests.rs"'` returns the two candidates above, and
`grep -rn '`tests\.rs:[0-9]' docs/` returns exactly that one line.

**Cleared.** M2 landed the marker; docs/task/RFCT-215.md carries exactly one
anchored `<!-- dated-record:` line on the merged tree, its 31 citations left
coverage, and its `os` floor was lowered from 1847 to 1816 in the marker's own
commit. The ambiguity error stopped firing there and the arming commit landed.

M2's own record reproduced RFCT-215's row twice while explaining it, at
docs/task/RFCT-257.md:324 and :338, and the ambiguity error fired on those
instead. They are written here in the non-asserting forms this milestone
defines — double-backticked in the prose, split into a path and a line inside
the indented reproduction, since a double-backtick cannot reach there — with a
notice in that document saying so. Not a word of M2's argument changed, and
RFCT-215's own row was not touched.

M2 also measured that the ambiguity was MASKING a content failure underneath
it: full-forming `` `tests.rs:1821` `` arms the quotation in its own cell, and
the cited line declares
`fn the_committed_openapi_document_is_the_generated_one()` while the quoted
phrase is api.md's prose ABOUT the test. So the marker was the only green path
there, and the ambiguity error was pointing at something real rather than
merely at an ambiguous basename.
