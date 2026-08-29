# RFCT-251 PLAN-026 M5: `GetState` names `NotFound`, and apid stops reading the name

- **status**: completed — `GetState` raises `com.mos.mosd1.Error.NotFound` for a dot-path that resolves to nothing, `api_v1_state` is one call again, and the wire is byte-for-byte what it was
- **priority**: P1
- **owner**: bkd/jah7ss1a
- **createdAt**: 2026-08-29
- **completedAt**: 2026-08-29
- **plan**: PLAN-026 (M5)

`GET /api/v1/state/{path}` answered **404 `settings_not_found`** for a dot-path
that does not resolve, and it got there by reading an error name apid had no
general right to read. This task moves the naming to mosd, where the condition
is known, and deletes the reading. **Nothing a client can see changes**, and
that is the acceptance test rather than a caveat.

## 1. What was measured, before anything was changed

The brief's three claims were re-measured at `ffa65ca`, the branch point, and
all three held.

1. The rewrite was where it was said to be:
   `Some(zbus::Error::MethodError(name, message, _)) if name.as_str() == FDO_INVALID_ARGS =>`
   at `routes.rs:1262` of the pre-image, inside `api_v1_state`.
2. Its own comment named the cleaner fix — *"The cleaner fix is a `NotFound`
   error name mosd-side; PLAN-025's scope excludes mosd itself, so the reading
   is done here, where it is still unambiguous"* — at `routes.rs:1247-1256` of
   the pre-image.
3. The rotate-key path had already shipped that split, and still has:
   `return Err(SettingsFault::NotFound(format!(`
   (`os/pkgs/mosd/mosd/src/bus.rs:899`), with the reason in the comment above it
   — *"The split is here rather than in apid because apid had nothing left to
   tell them apart with."*

So the two paths disagreed about which side named the same class of condition.
That is the whole of the defect: not a wrong status code, a wrong **owner** for
the classification.

One thing the brief did not say, and it matters for scoping: `bus_api_error`
already mapped `MOSD_NOT_FOUND` to 404 `settings_not_found` with mosd's message
and the dot-path attached — `ApiError::mosd("settings_not_found", message)`
(`os/pkgs/mosd/apid/src/routes.rs:3022`), `Some(path) => error.at(path),`
(`os/pkgs/mosd/apid/src/routes.rs:3049`). The rewrite branch and the shared
classifier therefore produced the *same* response, member for member. That is
why requirement 4 is satisfiable at all, and it was checked before the branch
was deleted rather than asserted afterwards.

## 2. RED first

The failing test was written, run and committed before the fix
(`f73b9b6`). It asserts the bus-visible name, which is the only thing that
moves:

```
thread 'bus::tests::a_state_path_that_does_not_resolve_is_not_found' (2203)
panicked at mosd/src/bus.rs:1402:9:
assertion `left == right` failed: a dot-path that resolves to nothing names
nothing, which is a 404 and not a 422: state path not found: `no.such.path`
  left: "org.freedesktop.DBus.Error.InvalidArgs"
 right: "com.mos.mosd1.Error.NotFound"
test bus::tests::a_state_path_that_does_not_resolve_is_not_found ... FAILED
test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 322 filtered out
```

The test is placed against
`a_rotation_refuses_an_interface_that_is_not_a_tunnel`, the PLAN-023 M6 test
that pins the same rule for the rotate-key path, because the two now assert one
rule and reading them together is the point.

## 3. What changed

**mosd.** `get_state` now returns `Result<String, SettingsFault>`
(`os/pkgs/mosd/mosd/src/bus.rs:654`) where it returned `fdo::Result<String>`
before, which is what lets it name an interface-scoped error at all. Its two failure paths keep their
count and swap one name:

- the uptime read stays `Failed` —
  `SettingsFault::Fdo(fdo::Error::Failed("read /proc/uptime".to_string()))`
  (`os/pkgs/mosd/mosd/src/bus.rs:657`);
- the unresolvable dot-path becomes not-found —
  `.ok_or_else(|| SettingsFault::NotFound(format!(`
  (`os/pkgs/mosd/mosd/src/bus.rs:678`).

The message is unchanged, deliberately: §2.4 passes mosd's words through, so
changing them would change a response body for no reason.

**apid.** The branch and its explanatory comment are gone. `api_v1_state` is
two lines: `let value = state.api.get_state(&path).await;`
(`os/pkgs/mosd/apid/src/routes.rs:1246`) and
`resource_response(value, &path)` (`os/pkgs/mosd/apid/src/routes.rs:1247`).
`FDO_INVALID_ARGS` is still used, by the shared classifier, and is untouched
there.

The utoipa annotation was **not** edited, including the 422 row that still
reads *"mosd rejected the dot-path (`settings_rejected`); a dot-path that does
not resolve is the 404 above"*. It is still true — the 404 above is still the
answer — and editing it would move `openapi.json`, which requirement 4 forbids.

## 4. The tests, and which one is the acceptance test

- `a_state_path_that_does_not_resolve_is_not_found` (mosd) — new. The
  bus-visible name, asserted directly, per requirement 5.
- `a_state_dot_path_that_does_not_resolve_is_404_not_422` (apid) — **the
  acceptance test**. Kept under its own name because the fact it names did not
  change. Its 404 half is now driven by `com.mos.mosd1.Error.NotFound` instead
  of fdo `InvalidArgs`, and it gains the assertion the old arrangement could not
  make: fdo `InvalidArgs` on the state route is now a plain **422**, because no
  rewrite is left to intercept it. That second half fails against the
  pre-image, which is what makes it evidence rather than decoration.
- `each_fdo_error_name_gets_its_own_envelope` (apid) — the route-dependent row
  is deleted. §2.4's table had one row that read differently on one route; it
  no longer does, and the loop reads the table straight.

`test/apid-api/**` needed no change: its only live-state assertions are
`GET /api/v1/state/network` on a resolvable path, and no phase exercises an
unresolvable one.

## 5. The design documents

`docs/design/bus.md` states no error name for any method — measured, not
assumed: `grep -n "com.mos.mosd1.Error" docs/design/bus.md` is empty — so
there was no bound in it to move.

`docs/design/api.md` carried three:

1. §1.2's route row said the handler separates an unresolved dot-path out
   itself. It now says the classifier answers it.
2. §2.2's live-state paragraph said *"`GetState` returns the subtree at a
   dot-path or `InvalidArgs`"*. That sentence was false the moment the fix
   landed, and the citation gate would **not** have caught it: the range it
   cites still contains the string `InvalidArgs`, in a comment saying the name
   is *not* used. A gate-green falsehood, avoided by reading the passage rather
   than trusting the check.
3. §2.4's `settings_not_found` inventory row listed the deleted branch as a
   second apid-side producer.

§2.4's own contract rows were **not** touched, because the contract did not
move: *"the dot-path does not resolve: mosd answered
`com.mos.mosd1.Error.NotFound`"* (`docs/design/api.md:1823`) was already the
written rule for the settings tree, and the state tree has simply stopped being
the exception to it.

## 6. The citation re-anchor

Done last, in two commits, against the tree that resulted from merging
`bkd/5q6am5rw` at `dcae967` — **not** against the base the work started from.
That distinction was not theoretical: the ref moved twice under this task, and
a map computed against `1652b61` was discarded and re-derived rather than
replayed, because `RFCT-249` had landed 48 lines into
`os/pkgs/mosd/apid/src/tests.rs` in between.

**Class A, 609 citations** (`4f108b5`). Mapped from the pre-image
(`git diff -U0 bkd/5q6am5rw -- <path>`) hunk by hunk, never by a constant
offset — the drift is not uniform. Four files shifted, in both directions:

| file | shift |
|---|---|
| `os/pkgs/mosd/apid/src/routes.rs` | `-26` below the deleted branch, `0` above it |
| `os/pkgs/mosd/mosd/src/bus.rs` | `+5`, `+6`, `+14`, `+44` across four boundaries |
| `os/pkgs/mosd/apid/src/tests.rs` | `+2`, `-9`, `-1`, `-5` across four |
| `docs/design/api.md` | `0`, `+1` |

The mapper asserts each hunk's reported `new_start` against its own running
delta before mapping anything, so a misread of the diff format fails loudly
instead of moving 609 citations by a wrong amount.

**Class B, 13 citations** (`a11446d`). These name lines the edit deleted or
rewrote; there is no line to shift them to, and none was guessed at.

- Six quote a fragment that survives, and were re-derived from it: the
  `async fn get_state` signature line, the reflowed uptime `ok_or_else`, and the
  four quoting `resource_response(value, &path)`.
- Seven quote text that is gone outright. `docs/task/RFCT-215.md` section 6
  item 5 **is** the residue this task closes, so it is closed in place with a
  dated append, and its two dead citations are removed rather than re-pointed.
  `RFCT-214`, `RFCT-232` and `RFCT-246` each get the smallest true restatement
  of the point they were making; `RFCT-232` additionally gets a dated note,
  because the names it measured are exactly what changed and the record must
  not read as a present-tense claim about a tree that no longer says that.

**A defect in the re-anchor tooling, found and fixed mid-pass.** The script
tested the dated-record exemption as a substring, where the gate anchors it to
the start of a line — `grep -q '^<!-- dated-record:'`
(`docs/verify-citations.sh:356`). Four documents that merely *discuss* the
marker were therefore exempted by the script while the gate still checked them.
Re-measured: none of the four carries a citation into a shifted region, so
nothing was in fact missed. It is recorded because the next script to copy that
predicate would not be so lucky.

## 7. Out of scope, untouched

- `os/pkgs/mosd/apid/src/routes.rs` from line 2516 down — a sibling milestone
  owns that region, so no line number is cited for it here: a bare `:NNN` form
  is skipped by the citation gate entirely, and a full-form citation into a
  region this task never read would be a claim with no measurement behind it.
  Measured instead: this branch's only hunk in that file is at line 1244
  (`git diff -U0 bkd/5q6am5rw -- os/pkgs/mosd/apid/src/routes.rs`).
- `main`. No merge into it, no other issue filed, nothing dispatched.
- `docs/plan/**`, which L2 closes out.
- Every other apid route: `InvalidArgs` still means *"this argument was
  rejected"* everywhere it is raised, and still answers 422.

## 8. Gates

All four were run in this task's own worktree,
`/srv/bkd/worktrees/u51kzjlk/jah7ss1a`, and the Rust gate's container mounts
that path and no other (`-v /srv/bkd/worktrees/u51kzjlk/jah7ss1a:/work`). The
shared checkout at `/srv/ai/mos` was never entered, edited, mounted or measured
from.

| Gate | Result |
|---|---|
| `bash docs/verify-citations.sh` | **`2218/2218 PASS`**, `ratchet failures: 0`, and `no quote, by document: docs/task/RFCT-251.md 0` — this record arms every citation it makes, so it sits at the ratchet's zero ceiling for a new document rather than taking an override row in `docs/verify-citations-unquoted-baseline.txt`. It also carries **no bare `:NNN` form**: `grep -oE '`:[0-9]+(-[0-9]+)?`' docs/task/RFCT-251.md \| wc -l` is `0`, which matters because the gate skips that form outright and a document can be green and unchecked at once. Near-miss **352** against the merge parent's 354. The -2 was attributed by measurement, not by inference: the merge parent `dcae967` was unpacked into this task's scratch directory and run there (`2210/2210 PASS`, near-miss 354, matching L2's reference), and its per-document unarmed counts diffed against this tip. Exactly two documents fall by one each — `docs/design/api.md` 452 to 451, where the prose commit deleted the unarmed citation naming the removed branch, and `docs/task/RFCT-215.md` 8 to 7, where item 5's close removed the unarmed citation to the deleted comment. No document rises, and the new record enters at 0, so nothing drifted INTO the near-miss set |
| `bash docs/verify-index.sh` | **`879/879 PASS`**. The merge parent measures `875/875 PASS`; the whole of the +4 is this task's one new document and its one index row |
| `bash hack/check.sh` in `localhost/mos-build-rust:amd64` | `Summary [ 172.027s] 839 tests run: 839 passed (1 slow), 0 skipped`, then `advisories ok, bans ok, licenses ok` and **`ALL CHECKS PASSED`**. 838 was the campaign baseline at RFCT-249; this task adds exactly one, the new bus test, and 838 + 1 = 839. `dbus` was installed in-container first, or the bus round-trip goes rc=100 — and this milestone changes the bus layer, so that test is the one that had to run |
| `oasdiff breaking` | **`No changes detected`, RC=0**. oasdiff 1.29.1, sha256 verified `541f7c66c933495fceef24eaf5c48aa66c19069f366f7bd0a60a6a4820c5e533`. Base is `main` at `7566210`, re-read at the moment of the run. The spec did not move at all, which is the machine-checkable half of requirement 4: `git diff main --stat -- os/pkgs/mosd/apid/openapi.json` is empty, so no regeneration was needed and none was done |
