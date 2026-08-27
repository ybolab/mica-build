# RFCT-120 PLAN-016 M4: comment simplification inside mosd/apid

- **status**: completed
- **priority**: P1
- **owner**: bkd/x9gmepqb
- **createdAt**: 2026-08-26 16:05
- **claimedAt**: 2026-08-26 16:05
- **completedAt**: 2026-08-26 17:05
- **plan**: PLAN-016 (M4)

PLAN-015's comment taxonomy, triage rule and MUST-KEEP list applied to
`mosd/apid/`. Comments become present-tense statements of what the code does
or must not do; provenance and process history are left to git.

## Scope

- `mosd/apid/**`: comments, doc-comments and whitespace on lines that are
  otherwise comments. Nothing else.
- `docs/task/RFCT-120.md` (this file) and one entry in `docs/task/index.md`.
- Explicitly untouched: `mosd/apid/openapi.json`, `mosd/apid/Cargo.toml`,
  every file outside `mosd/apid/`, and every string literal (see Findings).

## The comment-only proof

Every hunk inside `mosd/apid/` touches only comments. This is proved rather
than asserted: strip all Rust comments and all blank lines from the base tree
and from the working tree, per file, and diff. `231895a` is the merge commit
that brought M1-M3 onto this branch and is the base every change here sits on.

The stripper honours Rust's lexical rules, so a `//` or `/*` inside a string,
raw string or char literal is not treated as a comment and any change to one
would show up in the diff:

```bash
cat > /tmp/strip-comments.py <<'PY'
#!/usr/bin/env python3
"""Strip every Rust comment and all blank lines from stdin; write the rest to stdout."""
import sys

src = sys.stdin.read()
out = []
i, n = 0, len(src)
while i < n:
    c = src[i]
    if c in 'rb':                                   # (b)r#*"..."#* raw string
        j = i
        if src[j] == 'b' and j + 1 < n and src[j + 1] == 'r':
            j += 1
        if src[j] == 'r':
            k = j + 1
            while k < n and src[k] == '#':
                k += 1
            if k < n and src[k] == '"':
                term = '"' + '#' * (k - j - 1)
                end = src.find(term, k + 1)
                end = n if end == -1 else end + len(term)
                out.append(src[i:end]); i = end; continue
    if c == '"':                                    # "..." with escapes
        j = i + 1
        while j < n:
            if src[j] == '\\': j += 2; continue
            if src[j] == '"': j += 1; break
            j += 1
        out.append(src[i:j]); i = j; continue
    if c == "'":                                    # char literal, else lifetime
        j = i + 1
        if j < n and src[j] == '\\':
            k = j + 1
            while k < n and src[k] != "'": k += 1
            if k < n:
                out.append(src[i:k + 1]); i = k + 1; continue
        elif j + 1 < n and src[j + 1] == "'":
            out.append(src[i:j + 2]); i = j + 2; continue
        out.append(c); i += 1; continue
    if c == '/' and i + 1 < n and src[i + 1] == '/':   # line comment
        j = src.find('\n', i)
        i = n if j == -1 else j
        continue
    if c == '/' and i + 1 < n and src[i + 1] == '*':   # nested block comment
        depth, j = 1, i + 2
        while j < n and depth:
            if src.startswith('/*', j): depth += 1; j += 2
            elif src.startswith('*/', j): depth -= 1; j += 2
            else: j += 1
        i = j; continue
    out.append(c); i += 1

for line in ''.join(out).splitlines():
    if line.strip():
        sys.stdout.write(line.rstrip() + '\n')
PY

BASE=231895a
for f in $(git ls-tree -r --name-only "$BASE" -- mosd/apid | grep '\.rs$'); do
  diff -u <(git show "$BASE:$f" | python3 /tmp/strip-comments.py) \
          <(python3 /tmp/strip-comments.py < "$f") \
    && : || echo "DIFFERS: $f"
done
```

Output:

```
(no output; every file's stripped form is byte-identical to the base's)
```

The harness was validated against a deliberate one-character code change
(`use std::path::Path;` -> `use  std::path::Path;` in `src/persist.rs`) before
any edit was made, and reported it:

```
=== mosd/apid/src/persist.rs
-use std::path::Path;
+use  std::path::Path;
```

so an empty result is evidence and not a silent pass.

## What was removed

Counted as lines matching `^[[:space:]]*(//|/\*|\*)`, base `231895a` -> HEAD.

| file | before | after | delta |
| --- | ---: | ---: | ---: |
| `src/assets/mime.rs` | 70 | 70 | 0 |
| `src/assets/mod.rs` | 14 | 14 | 0 |
| `src/assets/path.rs` | 146 | 147 | +1 |
| `src/assets/serve.rs` | 140 | 140 | 0 |
| `src/audit.rs` | 46 | 46 | 0 |
| `src/auth.rs` | 199 | 190 | -9 |
| `src/bundle.rs` | 279 | 271 | -8 |
| `src/bus_client.rs` | 62 | 61 | -1 |
| `src/config.rs` | 14 | 14 | 0 |
| `src/main.rs` | 126 | 111 | -15 |
| `src/openapi.rs` | 21 | 21 | 0 |
| `src/persist.rs` | 14 | 14 | 0 |
| `src/redact.rs` | 28 | 28 | 0 |
| `src/routes.rs` | 674 | 643 | -31 |
| `src/session.rs` | 23 | 23 | 0 |
| `src/settings_api.rs` | 40 | 40 | 0 |
| `src/startup.rs` | 218 | 201 | -17 |
| `src/tests.rs` | 681 | 661 | -20 |
| `src/tests/broken_classes.rs` | 235 | 207 | -28 |
| `src/tests/power_bus.rs` | 81 | 81 | 0 |
| `src/tls.rs` | 12 | 12 | 0 |
| `tests/e2e.rs` | 99 | 95 | -4 |
| **total** | **3222** | **3090** | **-132 (4.1%)** |

The two reverts described in Findings 3 are single-line swaps and do not move
these counts.

`src/assets/path.rs` gains a line because one four-line doc paragraph rewraps
to five when the task ID is taken out of it.

By category:

- **C1 task-ID provenance stamps** — 19 in comments at base, 0 now. Verified:
  `grep -rnE '^[[:space:]]*(//|/\*|\*)' --include='*.rs' mosd/apid | grep -E '(RFCT|PLAN|TASK)-[0-9]+'`
  returns nothing.
- **C2 process narrative** — two blocks. `src/main.rs` (the scope-exclusion
  record, quoted below) and `src/bundle.rs` (which phase landed which consumer
  and when a module-wide `allow(dead_code)` came off).
- **C4/C5 tombstones and narrative history** — `src/bus_client.rs` naming the
  `Reboot`/`PowerOff` methods a return shape "used to" match; `src/auth.rs`
  and `src/tests.rs` measuring the current backoff curve against "the old
  rule"; `src/tests.rs` recounting a fixture that was replaced; `tests/e2e.rs`
  recounting a specific 1.49 s observation.
- **C6 dramatic typography** — 21 dash-banner box headers collapsed to plain
  heading comments (12 in `src/routes.rs`, 9 in `src/tests.rs`, 8 in
  `src/tests/broken_classes.rs`, 1 in `src/auth.rs`, 8 `// -- name ---` rules
  in `src/startup.rs`), and every multi-word ALL-CAPS run normalised. The only
  remaining all-caps run in the crate is the PEM header `BEGIN CERTIFICATE`
  in `src/tls.rs:122`, which is a literal being matched.
- **C7 essays** — `src/startup.rs`'s module header (47 -> 32 lines, design-doc
  blockquote removed), `src/tests/broken_classes.rs`'s (47 -> 37), the
  `tests/e2e.rs` login-curve preamble (33 -> 29), and `MqttView`'s doc in
  `src/routes.rs` (37 -> 31).

### Why this is 4.1% and not PLAN-016's ~50%

PLAN-016's estimate was measured at `a89b969`, before M1-M3 added roughly 900
lines to this crate. Two things account for the gap, and neither was fixed by
deleting less than the taxonomy asks for:

1. The ~900 lines M1, M2 and M3 added were written under this same rule.
   `src/redact.rs`, `src/openapi.rs` and the §2.2 half of `src/tests.rs`
   needed nothing.
2. Most of the pre-existing prose in this crate is already the KEEP form under
   the triage rule: a design-document citation with a quoted clause, followed
   by the behaviour it constrains, in the present tense. `src/bundle.rs` is
   279 comment lines and lost 8; `src/assets/*.rs` is 370 and lost none,
   because those are dense §4/§5 statements with no narrative in them.

Every comment block of eleven or more contiguous lines in the crate was read
and triaged individually, as was every comment in `src/routes.rs`,
`src/bundle.rs`, `src/startup.rs` and `src/main.rs`. The number is reported as
measured; nothing was deleted to move it.

## MUST-KEEP: all ten located by content, none deleted

| # | item | now at |
| --- | --- | --- |
| 1 | `MOSD_SHADOW_PATH` / `MOSD_DRY_RUN` harness safety, incl. never pointing at the host's `/etc/shadow` | `tests/e2e.rs:142-155` |
| 2 | The durability rule on `write_atomically` | `src/persist.rs:17-23` |
| 3 | The mode-bit facts | `src/tls.rs:19` (0700), `:30`, `:46`, `:84` (0600); `src/auth.rs:287`, `:495` (0600) |
| 4 | The nested MQTT live-state shape | `src/routes.rs:2215-2245` |
| 5 | bcrypt's 72-byte truncation | `src/routes.rs:1770-1779`, restated at `src/tests.rs:1069` |
| 6 | The OpenSSH fingerprint format | `src/routes.rs:1783-1793` |
| 7 | `startup.rs`'s "never returns an error" rule | `src/startup.rs:8-15` |
| 8 | Identity/secret-handling rules | **no instance in `mosd/apid/`** — see Findings |
| 9 | The redaction key list and the fail-open note | `src/redact.rs:1-14` (fail-open), `:25` (`SECRET_FIELDS`) |
| 10 | Test-intent notes on non-obvious assertion shapes | kept throughout; e.g. `src/tests.rs:2465`, `src/tests/broken_classes.rs` rules 1 and 2 |

Items 1, 2, 3, 6 and 9 are byte-identical to the base. Items 4, 5, 7 and 10
were reworded and are quoted below.

### Item 4 — the nested MQTT live-state shape (`src/routes.rs`)

The shape statement itself is unchanged. The third bullet and the paragraph
restating it are folded into one bullet.

Before:

```
/// * `units` has to be an array: the reconciler drives two units and there is
///   no flat encoding of that. The pane reads a nested array either way, and
///   flat scalars sitting beside it would be the worst of both.
///
/// That last point is not a preference. A flat `activeState` cannot say whose
/// state it is, and the question "the broker's or the bridge's?" has no answer
/// in the key -- only in whatever the reconciler happened to mean, which the
/// pane cannot check. Reporting both halves flat would take a second key, then
/// a third and a fourth for their unit-file states, invented anew each time
/// the reconciler grows a unit. Every entry of `units` carries its own `unit`,
/// `activeState` and `unitFileState`, so the broker is the entry named
/// `mos-mqtt-broker.service` and the bridge is the one named
/// `mos-mqttd.service`, and neither needs a key of its own.
```

After:

```
/// * `units` has to be an array: the reconciler drives two units, and a flat
///   `activeState` cannot say whose state it is. Every entry carries its own
///   `unit`, `activeState` and `unitFileState`, so the broker is the entry
///   named `mos-mqtt-broker.service` and the bridge the one named
///   `mos-mqttd.service`, and neither needs a key of its own; reporting both
///   halves flat would take a new pair of keys each time the reconciler grows
///   a unit.
```

The closing paragraph on the pair of tests also loses its past-tense half.

Before:

```
/// own expectation. The two ends disagreed once -- flat here, nested there --
/// and stayed green for exactly as long as each side only tested itself
/// against a shape it had invented.
```

After:

```
/// own expectation. Without that pair each side tests itself against a shape
/// it invented, and both stay green while disagreeing.
```

### Item 5 — bcrypt's 72-byte truncation (`src/routes.rs`)

ALL-CAPS run normalised; the fact is unchanged.

Before: `/// the FIRST 72 BYTES of its input and silently ignores the rest. Accepting a`

After: `/// the first 72 bytes of its input and silently ignores the rest. Accepting a`

### Item 7 — "never returns an error" (`src/startup.rs`)

The rule is kept and the §6.1 blockquote transplanted into the source, plus
the enumeration of which `?` calls precede the bind, are dropped.

Before (module header lines 8-29 at base):

```
//! **The constraint outranks the feature, so it is stated first.** §6.1:
//!
//! > Bundle discovery and evaluation must happen after the listeners bind and
//! > after `APID_LISTENING` is printed, and every possible outcome must be a
//! > state the daemon holds, never an error it returns. A bundle must not be
//! > able to stop apid from listening.
//!
//! The reason is mechanical. `main` propagates every earlier start-up step
//! with `?` — `config::Config::from_env()?`, `tls::ensure_state_dir(...)`,
//! `tls::load_or_generate_certificate(...)?`,
//! `tls::load_or_generate_session_key(...)?` — all *before* the listeners
//! bind, and the unit is `Restart=on-failure` (`mosd/dist/apid.service:9`).
//! A start-up error is therefore a crash loop with no listener bound, which is
//! precisely the failure §6 exists to prevent.
//!
//! So nothing in this module returns an error, and nothing in it may `?`,
//! `unwrap`, `expect` or panic its way out. Every outcome — an unreadable
//! disk, a garbage manifest, an absent `/srv/ui` — is logged and becomes a
//! [`BundleState`]. [`discover`] adds one more layer of the same property:
//! the work runs on the blocking pool, so even a panic raised *below* this
//! module arrives as a [`JoinError`](tokio::task::JoinError) and becomes a
//! state rather than an unwind through `main`.
```

After (`src/startup.rs:8-15`):

```
//! Nothing in this module returns an error, and nothing in it may `?`,
//! `unwrap`, `expect` or panic its way out. §6.1 requires discovery to run
//! after the listeners bind and after `APID_LISTENING` is printed, and every
//! outcome — an unreadable disk, a garbage manifest, an absent `/srv/ui` — to
//! be a [`BundleState`] the daemon holds. `main` propagates every earlier
//! start-up step with `?` and the unit is `Restart=on-failure`
//! (`mosd/dist/apid.service:9`), so an error out of here is a crash loop with
//! no listener bound.
```

The `JoinError` half is not lost: `discover`'s own doc (`src/startup.rs:161-165`)
already states it at the function it is a property of.

### Item 10 — test-intent notes

The pattern is: keep the inline note that explains the assertion shape, cut
the preamble above the test that narrates how it got there. Two examples.

`src/tests/broken_classes.rs`, rule 2 of the module header — kept, with the
bold headings and the "they are the same rule seen twice" framing removed:

Before:

```
//! **Two rules govern the shape, and they are the same rule seen twice.**
//!
//! 1. *"5 passed"* and *"3 passed, 2 never ran"* are the same number. A suite
//!    cut short does not fail loudly; it tests fewer classes and reports green
//!    on the ones it reached, so a bare pass count is invariant across the
//!    defect it is supposed to detect. So the facts are declared **by
//!    identity**, the set that actually ran is observed, the two are diffed,
//!    and a failure names what is missing and what is unexpected.
```

After:

```
//! Two rules govern the shape:
//!
//! 1. *"5 passed"* and *"3 passed, 2 never ran"* are the same number, so a
//!    bare pass count is invariant across the defect it is supposed to detect.
//!    The facts are declared by identity, the set that actually ran is
//!    observed, the two are diffed, and a failure names what is missing and
//!    what is unexpected.
```

`src/auth.rs`, the persistence round-trip test — the reason the fixture seeds
a run rather than one failure is kept in full; the incident report is not.

Before:

```
        // SEEDED WITH A RUN, so the armed window is 16 seconds rather than
        // BACKOFF_BASE's one.
        //
        // The property under test is "an armed window survives a restart",
        // and it does not depend on which step of the curve is armed. Arming
        // the FIRST step made this test race its own constant: ...
        // ... It failed twice
        // in one afternoon under parallel-suite load and passes 3/3 in
        // isolation.
```

After (`src/auth.rs:331-349`): the same mechanism — two filesystem round-trips
against a deadline carried as whole UNIX seconds, two truncations that do not
cancel, a one-second window reducible to zero — stated once, in the present
tense, with the caps and the incident removed.

### The C2 worst case: `src/main.rs`

The narrative goes; the constraint buried in it stays.

Before (28 lines):

```
    // `--version`, ANSWERED AND RETURNED FROM HERE, above every line that makes
    // this process a daemon. RFCT-113 M7d, and the same handler mosd carries;
    // `mosd/mosd/src/main.rs` holds the long form of the shared reasoning.
    //
    // WHY THIS FILE WAS EDITABLE AT ALL: PLAN-014's Scope excludes `mosd/` Rust
    // sources, and THE USER LIFTED THAT EXCLUSION ON 2026-08-26 for exactly
    // this handler in exactly these two files, plus its build-time plumbing.
    // The rest of the exclusion stands. mosd/mosd/src/main.rs records the
    // amendment in full.
    //
    // The position is the requirement. Measured in the x64 factory root on
    // 2026-08-26, before this handler existed: `/usr/bin/apid --version`
    // ignored the flag, generated a self-signed certificate and a session
    // signing key into /var/lib/mos/apid, bound 0.0.0.0:443 and 0.0.0.0:80,
    // printed APID_LISTENING and NEVER EXITED -- rc=124 against a 20s budget.
    // So a handler below initialisation would answer the question by minting
    // key material and then hanging, and a smoke run that asked it would hang
    // rather than go red.
    //
    // Hence a synchronous `main` with the async body moved into `serve`: ...
    //
    // AN UNRECOGNISED ARGV IS UNCHANGED, for the reason mosd's copy of this
    // comment gives: apid is started by systemd with no arguments
    // (mosd/dist/apid.service) and has always ignored what it was given.
```

After (`src/main.rs:55-68`, 14 lines):

```
    // `--version` is answered and returned from here, above every line that
    // makes this process a daemon. The position is the requirement: a handler
    // below initialisation would generate a self-signed certificate and a
    // session signing key into the state dir, bind 0.0.0.0:443 and 0.0.0.0:80,
    // print APID_LISTENING and never exit, so a smoke run that asked for the
    // version would hang rather than go red. Hence a synchronous `main` with
    // the async body in `serve`: the answer is given before the tokio runtime
    // is built, before the ring crypto provider is installed, before
    // `Config::from_env`, before the state dir exists and before any key is
    // generated. There is nothing above it. `mosd/mosd/src/main.rs` carries
    // the same handler and the long form of the shared reasoning.
    //
    // An unrecognised argv falls through to the daemon: apid is started by
    // systemd with no arguments (mosd/dist/apid.service).
```

## Findings — reported, not edited

1. **Task IDs in string literals.** Five, all SSH-key fixture data, where the
   ID is the key's OpenSSH comment field. They are string literals and were
   left alone as the milestone requires:
   - `tests/e2e.rs:448` and `:481` — `rfct-034-test-ed25519`
   - `src/tests.rs:625`, `:626`, `:627` — `rfct-034-test-ed25519`,
     `rfct-034-test-rsa`, `rfct-034-test-ed25519-second`
   - `src/tests.rs:878` — asserts on `rfct-034-test-ed25519`

   Changing them is a test-data edit, not a comment edit. They are inert:
   nothing outside these files reads them, and they identify fixtures rather
   than recording who typed anything.

   No task ID appears in any test name, `assert!` message or runtime error
   string in this crate.

2. **MUST-KEEP item 8 has no instance in `mosd/apid/`.** The independent-draw
   rule and the "a hash inside a signed rootfs is a fleet-wide shared secret"
   reasoning live in `mosd/mosd/src/identity.rs:5` and `:514`,
   `mosd/mosd-settings/src/model.rs:258`, `:365` and `:534`, and
   `mosd/mosd/src/reconciler/wifi_ap.rs:579` — all outside this milestone's
   scope. apid generates its TLS key and its 32-byte session signing key per
   device on first start (`src/tls.rs:47`, `:85`) and carries no comment on the
   subject, so there was nothing here to keep or to reword. Nothing was
   deleted.

3. **Two doc-comments in `src/routes.rs` are not comments — they are spec
   source, and were reverted.** utoipa lifts the doc-comment of every
   `#[utoipa::path]` handler and every `ToSchema`-derived type and field
   straight into `openapi.json` as a `description`. Normalising typography in
   one of those changes the committed document, which M1's
   `the_committed_openapi_document_is_the_generated_one` correctly rejects.
   Two edits hit this and both were reverted to the base text:

   - `src/routes.rs:461` — `/// The dot-path IS the resource identifier`, the
     doc of the `#[utoipa::path]`-annotated `api_v1_settings` handler. `IS`
     kept.
   - `src/routes.rs:371` — `/// ... A client tests **membership** in this set`,
     the doc of `ApiVersions::versions`, a `ToSchema` field. `**membership**`
     kept.

   These were also M1/M2-authored comments, which this milestone was told not
   to churn, so the revert is right on both counts. **The doc-comments on
   utoipa-annotated items in `mosd/apid/src/routes.rs` — lines 315-520 — are
   part of the published API surface. Editing one is an API change, not a
   comment change.** No other comment in the crate has that property; the
   remaining edits in that range are on plain functions.

   The failure is why `cargo test` is the milestone's real gate: the
   comment-only proof passes on this change, because a doc-comment edit *is* a
   comment edit. Only the test knows the document moved.

4. **Deprecated dependency line, not touched.** `mosd/apid/Cargo.toml` is out
   of scope by the milestone's own rules and was not opened.

## Verification

- The comment-only proof above: empty diff over all 22 `.rs` files, with the
  harness validated against a planted code change first.
- `cargo fmt --all --check`, `cargo clippy --workspace --all-targets --locked
  -- -D warnings`, `cargo test --workspace --locked` and `cargo deny check
  licenses bans advisories`, run inside `localhost/mos-build-rust` with
  `/srv/mos-rust-tools` mounted at `/tools` and `dbus-daemon` installed in the
  container.
- `bash docs/verify-index.sh` on the host.

`cargo test` is the real gate for a comment-only change: a comment edit that
disturbed code fails a test, and M1's spec-identity test additionally proves
`openapi.json` did not move.
