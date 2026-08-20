# RFCT-072 Asset path resolution and content classification: traversal, MIME allowlist, caching posture

- **status**: complete — `docs/design/api.md` §4.3 and §4.4 implemented as pure functions with a per-guard test suite; three findings reported rather than designed around
- **priority**: P1
- **owner**: ai-agent
- **createdAt**: 2026-08-20 14:27
- **claimedAt**: 2026-08-20 14:34
- **completedAt**: 2026-08-20 15:36

Campaign `l1-o7ee8v0o-20260820142702-ui`, phase 4 of `docs/design/api.md` §8.2.
Branch `bkd/fwaq4uml`. Base `b4b7c72`.

```
$ git rev-parse HEAD
b4b7c72f09eb56ab420f93b8ff799abc95a15560
$ git merge-base --is-ancestor b4b7c72f09eb56ab420f93b8ff799abc95a15560 HEAD && echo BASE-OK
BASE-OK
$ test -d mosd/apid && echo APID-OK
APID-OK
```

## Description

§4.4's traversal rules and §4.3's content typing and caching posture, written as
pure functions the asset router will call. **No HTTP.** No route, no handler, no
axum extractor, no new dependency, no `unsafe`.

The router that consumes them is a sibling task in the same phase, so nothing in
the crate calls them yet; `mosd/apid/src/assets/mod.rs` carries an
`#![allow(dead_code)]` with a comment naming the route that removes it.

## Deliverable

| file | what |
| --- | --- |
| `mosd/apid/src/assets/mod.rs` | module doc, the two submodules, the dead-code note |
| `mosd/apid/src/assets/path.rs` | §4.4 rules 1-5 as `resolve`, plus 8 tests |
| `mosd/apid/src/assets/mime.rs` | §4.3 allowlist, `nosniff`, cache classes, plus 9 tests |
| `mosd/apid/src/main.rs` | one line: `mod assets;` |

```
$ git diff --name-only b4b7c72..HEAD
docs/task/RFCT-072.md
docs/task/index.md
mosd/apid/src/assets/mime.rs
mosd/apid/src/assets/mod.rs
mosd/apid/src/assets/path.rs
mosd/apid/src/main.rs
```

`mosd/Cargo.toml`, `mosd/apid/Cargo.toml` and `mosd/Cargo.lock` are **not** in
that list, which is the mechanical form of "no new dependency". Percent-decoding
is 24 lines of hand-written code in `path.rs`; `percent-encoding` was never
added. Nothing under `os/` is touched and no file is added to the packed rootfs,
so no image build or verifier run applies to this diff.

## The shape of `resolve`

```rust
pub fn resolve(request_path: &str, bundle_root: &Path) -> Result<PathBuf, Rejection>
```

Order of operations, which is the whole of rule 2: decode **once** → validate the
**decoded** bytes (NUL, residual `%`, backslash) → strip **all** leading
separators → parse into components, rejecting `..` and root/prefix → `join`
(never concatenate) → `canonicalize` → assert inside the root, and assert the
kernel resolved to the path that was asked for.

`Rejection` has ten variants, one per guard, so a test asserting a variant is
asserting one guard. `Rejection::eligible_for_fallback` returns true for
`NotFound` and nothing else — see finding 1 for why that method exists.

**The root must already be resolved**, per §4.4's consequence carried into §5.3:
the assertion is made against the resolved bundle root, never against the
`/srv/ui/current` symlink, which is appliance-managed and lives outside every
bundle tree. `resolve` therefore does not resolve `current` itself. A caller who
passes an unresolved root fails closed — `a_symlinked_root_rejects_everything`
proves it — rather than silently widening the assertion.

## The traversal suite, per guard rather than per string

§4.4 lists five hostile strings. They are **compound**:
`/%252e%252e%2fetc%2fpasswd` trips rules 1, 2 and 3 at once, so deleting any two
of them leaves a suite built from that list passing. This is the regression
RFCT-034 recorded, so the suite here is written per character and per rule.

Twenty hostile inputs, each carrying exactly one hostile feature:

| input | verdict | the single guard it exercises |
| --- | --- | --- |
| `/../../etc/passwd` | `ParentDir` | rule 1, `..` leading |
| `/assets/../../etc/passwd` | `ParentDir` | rule 3, `..` interior |
| `/assets/..` | `ParentDir` | rule 3, `..` trailing |
| `/%2e%2e%2fetc%2fpasswd` | `ParentDir` | rule 2, decode runs **before** the component parse |
| `/%2e%2e` | `ParentDir` | rule 2, single-encoded `..` alone |
| `/%252e%252e%2fetc%2fpasswd` | `ResidualEscape` | rule 2, decode is **not** repeated |
| `/%252e` | `ResidualEscape` | rule 2, double-encoded alone |
| `/%2500` | `ResidualEscape` | rule 2, double-encoded NUL |
| `/index.html%00.txt` | `Nul` | rule 4, NUL as `%00` |
| `/index.html<NUL>.txt` | `Nul` | rule 4, NUL as a raw byte |
| `/a\b.js` | `Backslash` | backslash, raw |
| `/%5cetc%5cpasswd` | `Backslash` | backslash, encoded |
| `/%` | `MalformedEscape` | truncated escape |
| `/%2` | `MalformedEscape` | truncated escape |
| `/%zz` | `MalformedEscape` | non-hex escape |
| `/%2gindex.html` | `MalformedEscape` | half-hex escape |
| `/%c0%af` | `NotUtf8` | overlong UTF-8 |
| `/leak` | `OutsideRoot` | rule 5, symlink **out of** the tree |
| `/inside` | `Symlink` | rule 5, symlink **within** the tree |
| `/linkdir/app.a1b2c3.js` | `Symlink` | rule 5, symlinked intermediate directory |

Every one of them is also asserted **not** `eligible_for_fallback`.

Two of §4.4's five strings are not in that table because at this layer they are
not lexical rejections at all, and each gets its own property test instead:

- `/%2fetc%2fpasswd` — the leading-separator case. The fixture plants a **decoy**
  at `<root>/etc/passwd`, and the test asserts the result is that decoy. This is
  a stronger assertion than a rejection: it proves the path was *joined* under
  the root rather than concatenated, and that `PathBuf::push` never got an
  absolute path to replace the root with.
- `/a%2fb` — an encoded separator with no `..` behind it. It must **decode to a
  separator**, producing two components, not be smuggled through as one name.

And the positive direction, because a refusal-only suite passes just as well
against a function that refuses everything — the discipline
`mosd/hack/dbus-policy-test.sh` documents for the D-Bus policy: `/index.html`,
`/assets/app.a1b2c3.js` (a legitimate `.` in a filename, which is also the shape
§4.3's immutable class exists for), `/./index.html`, `//index.html`, `/assets/`
and `/` all resolve.

### The suite was mutation-tested, not asserted to be good

Twelve mutants, one per guard, each applied to a scratch copy and reverted. The
run is throwaway and left nothing in the tree.

| guard deleted | outcome |
| --- | --- |
| rule 1, the `..` arm | killed |
| rule 1, `join` replaced by `format!` concatenation | **survived** — see below |
| rule 2, component parse moved onto the raw string | killed |
| rule 2, a second decode pass added | killed |
| rule 2, the residual-`%` rejection | killed |
| rule 3, strip-**all**-leading weakened to strip-one | killed |
| rule 3, the root/prefix arm | **survived** — see below |
| rule 4, the NUL check | killed |
| the backslash check | killed |
| the malformed-escape rejection | killed |
| rule 5, `starts_with(bundle_root)` | killed |
| rule 5, `canonical != candidate` | killed |

Ten of twelve killed. Both survivors are **equivalent mutants**, and both are
recorded rather than papered over:

- **`join` versus concatenation.** Every component reaching that line is a
  `Component::Normal`, so `format!("{root}/{rel}")` produces the identical path
  and no test can see the difference. The reason to keep `join` is not that it
  behaves differently today — it is that it stays correct if the component parse
  is ever weakened, which is precisely the invariant a concatenation would
  silently depend on.
- **Rule 3's root/prefix arm.** On Unix a `RootDir` component cannot survive
  `trim_start_matches('/')`, so the arm is unreachable and its deletion is
  invisible. Deleting the strip *and* the arm together is also invisible, because
  skipping `RootDir` and stripping leading separators are the same operation on
  this platform. The arm is kept — with a comment saying exactly this — because
  §4.4 states it as a rule and because the strip-one mutant shows it is what
  catches `/etc/passwd` the moment the strip is weakened.

## §4.3, and the interaction that is the acceptance

`content_type` is a 21-entry table matched case-insensitively on the extension,
falling back to `application/octet-stream` for an unknown or absent one.
`.wasm` → `application/wasm` and `.webmanifest` → `application/manifest+json` are
in it from the start and have their own test, because §4.3 names them as the two
that **break** rather than degrade and the table is inside verity, so a customer
cannot add them on device.

`X_CONTENT_TYPE_OPTIONS`/`NOSNIFF` are exposed as constants for the router to put
on **every** asset response, not only the unknown ones.

`cache_class(relative_path, immutable_dir)` returns `NoStore` / `Immutable` /
`NoCache`, with the header strings on `CacheClass::header_value`. The immutable
directory is a parameter: the manifest is §5.3's to read, not this module's.
`None` — the default for an undeclared bundle — is `no-cache` for everything, and
a declaration with **no components** is treated as no declaration, so an empty
string in a manifest cannot make a whole bundle immutable for a year by accident.

**The test that matters is the interaction.** §4.3's acceptance is an operator
criterion — *upload, reload, see the new UI, with no cache clear, no hard refresh
and no incognito window*. At this layer that is one property: `index.html`
classifies `no-store` **unconditionally, including when it sits inside a
directory declared immutable**. That is the single combination that would break
the criterion silently, and `html_inside_the_immutable_directory_is_still_no_store`
is the test for it.

`no-store` and not `no-cache` for HTML, per §4.3: `no-cache` still permits a
stored copy revalidated by a validator apid may not emit.

## Findings

Reported, not designed around. §§4-6 are proposals derived from a §1 measured at
`86cd669`, and the tree has moved.

### Finding 1 — §4.2 and §4.4 disagree about `/%252e%252e%2fetc%2fpasswd`

§8.2 phase 4 acceptance 2 requires **404** for that request. Under §4.4 rule 2,
decoding it exactly once yields `%2e%2e/etc/passwd`, whose components are all
ordinary names — so rules 1 and 3 do **not** fire and the honest lexical answer
is a plain miss. §4.2's five fallback conditions are then all satisfied: it is
not reserved, a browser navigation is `GET`, it offers `text/html`, and the final
segment `passwd` contains no `.`. **A literal reading of §4.2 and §4.4 together
returns `200 text/html` for a string §8.2 requires to be a 404.**

Closed here by rejecting any `%` that survives the single decode
(`Rejection::ResidualEscape`), which makes the double-encoded class a hard
rejection that is never fallback-eligible. This is a **strengthening beyond
§4.4's five rules**, so it is flagged: no behaviour §4.4 requires is lost, the
cost is that a bundle cannot ship a filename containing a literal `%`, and the
benefit is that acceptance 2 holds structurally rather than depending on what the
router does with a miss. `Rejection::eligible_for_fallback` exists to make the
boundary explicit for the router. **§4.2, §4.4 or §10.2 should record this** —
the document is not edited here.

### Finding 2 — §4.4 says nothing about the backslash, and §4.4 rule 4's own reasoning covers it

On Linux `\` is an ordinary filename character; on Windows it is a separator.
Rule 4 rejects NUL explicitly rather than relying on a platform's errno, on the
stated ground that *"an accident is not a rule"* — the same argument applies to a
byte whose meaning is platform-dependent. `tower_http` has a Windows-only guard
for exactly this class (`is_reserved_dos_name`, and a re-parse of each component
to catch `/foo/c:/bar/baz`). A backslash is rejected here, with that reasoning in
the code comment. Also an extension to §4.4's five rules, also flagged.

### Finding 3 — §4.4's `tower-http` claims all hold; only the line numbers drifted

All four are load-bearing for the hand-roll decision and all four are **true**
against this base.

| claim | check | result |
| --- | --- | --- |
| the pinned copy is 0.6.11 | `grep -n -A 20 'name = "tower-http"' mosd/Cargo.lock` | `version = "0.6.11"` at `mosd/Cargo.lock:2392` |
| built **without** `fs`, so `ServeDir` is not compiled | its lockfile dependency list `mosd/Cargo.lock:2395-2406` versus `fs = [...]` at `tower-http-0.6.11/Cargo.toml:168-183` | the list is `bitflags, bytes, futures-util, http, http-body, pin-project-lite, tower, tower-layer, tower-service, url` — **no** `tokio`, `mime_guess`, `httpdate` or `http-range-header`, all of which `fs` requires. Confirmed |
| no canonicalisation anywhere | `grep -rn "canonicalize\|symlink_metadata\|read_link"` over `tower-http-0.6.11/src/` | no match |
| `build_and_validate_path` is purely lexical | read at `tower-http-0.6.11/src/services/fs/serve_dir/mod.rs:455-493` | confirmed — `percent_decode` once, then reject `Prefix`/`RootDir`/`ParentDir` at `:488` and push the rest |

The four supporting citations were opened too and all resolve:
`open_file.rs:78-82` is the `mime_guess::from_path` fallback to
`APPLICATION_OCTET_STREAM`; `open_file.rs:153-156` is
`is_invalid_filename_error` with the comment *"Only applies to NULL bytes"*;
`future.rs:244` sets `LAST_MODIFIED`; `future.rs:108` maps `InvalidFilename` to
the not-found path. `grep -n "CACHE_CONTROL\|ETAG"` over
`tower-http-0.6.11/src/services/fs/serve_dir/` returns no match, so §4.3's
statement that the entire caching posture is a layer apid must add regardless is
correct.

**The one thing that drifted is line numbers.** §4.4 cites the lockfile at
`mosd/Cargo.lock:2364-2366` and `:2368-2379`; the actual lines on this base are
`:2391-2394` and `:2395-2406`. The lockfile has grown since `86cd669`; the
content the citation names is unchanged.

### Finding 4 — the pre-rename path spellings, stated once

§§4-6 cite `mosd/webd/src/session.rs`, `mosd/webd/src/config.rs`,
`mosd/webd/src/tls.rs`, `mosd/webd/src/routes.rs`, `mosd/webd/src/main.rs`,
`mosd/webd/Cargo.toml` and `mosd/dist/webd.service`. The crate was renamed in
`b1e23b2`, so every one of them is stale in that single mechanical way. Recorded
**once**, not once per citation, and owned by the campaign's documentation
reconciliation task. Two content details behind those paths were re-checked
because §4.3 and §4.4 lean on them: the cookie name is now `apid_session`
(`mosd/apid/src/session.rs:18`), not `webd_session` as §4.3's stored-XSS
paragraph writes it — the argument is unaffected, only the name; and
`#![forbid(unsafe_code)]` is at `mosd/apid/src/main.rs:21`, exactly where §4.4
says it is.

## What could not be established from the tree

- **Nothing was run on hardware.** No claim in this record is an on-device claim.
  Every result above comes from `cargo nextest` on the build host.
- **The symlink cases are proved against a temporary bundle root**, not against
  `/srv/ui`. That directory does not exist on this base — §5.2's layout is a
  sibling task's deliverable — so `resolve`'s behaviour against a real
  `current` pointer is untested here by construction.
- **Whether the install-time symlink rejection is present.** §4.4 names it as the
  *primary* defence and §5.3 requirement 2 specifies it; it belongs to another
  task in this phase. This module implements only the defence-in-depth half, and
  the two guards it carries (`OutsideRoot`, `Symlink`) do not depend on the other
  half existing.
- **The `Rejection::NotFound` variant covers a permission error too**, because
  `canonicalize` reports both. Whether an unreadable-but-present asset should be
  §6.1 failure class 2 rather than a miss is a routing question this layer cannot
  answer.

## Checks

Both pass. `cargo deny`'s tree dump is ~900 lines, so the verdict lines are
quoted here and the run is reproduced by the command above.

```
$ bash mosd/hack/check.sh
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.22s
    Finished `test` profile [unoptimized + debuginfo] target(s) in 0.18s
────────────
 Nextest run ID 86b57b8d-076b-4836-aec4-444c39cb2317 with nextest profile: default
    Starting 322 tests across 9 binaries
        ... (322 PASS lines, 17 of them under `assets::`)
────────────
     Summary [  30.291s] 322 tests run: 322 passed, 0 skipped
    ... (cargo deny dependency tree)
advisories ok, bans ok, licenses ok
ALL CHECKS PASSED
$ echo $?
0
```

`cargo fmt --all --check` prints nothing when it passes, which is why the first
visible line is clippy's. `cargo deny` emits 7 `warning[duplicate]` entries
(`base64`, `crypto-common`, `getrandom`, `syn`, `toml_datetime`, `windows-sys`,
`winnow`); all 7 are pre-existing and unchanged by this diff, which cannot be
otherwise since `mosd/Cargo.lock` is not modified.

322 tests, of which 17 are new here — 8 in `assets::path::tests` and 9 in
`assets::mime::tests`. The base's count was 305.

```
$ bash docs/verify-index.sh
docs/verify-index.sh: design/ <-> docs/README.md
docs/verify-index.sh: research/ <-> docs/README.md
docs/verify-index.sh: task/RFCT-*.md <-> docs/task/index.md
docs/verify-index.sh: 158/158 PASS
```

## Scope fence

Files created: `mosd/apid/src/assets/{mod,path,mime}.rs`. Files edited:
`mosd/apid/src/main.rs` (**one line**, `mod assets;`, inserted at the top of the
alphabetical module block immediately before `mod auth;`, so that the sibling
task inserting `mod bundle;` between `mod bus_client;` and `mod config;` stays
separable), `docs/task/index.md` (one row). No route, no handler, no axum
extractor. `docs/design/api.md` not edited. `mosd/apid/src/routes.rs`,
`tests.rs`, `config.rs`, `session.rs`, `tls.rs`, `auth.rs`, `bus_client.rs`,
`settings_api.rs`, `tests/e2e.rs`, everything under `os/`, and `docs/README.md`
not touched. No new dependency, no `unsafe`, no lockfile change.
