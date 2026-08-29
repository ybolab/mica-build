# RFCT-249 PLAN-026 M3: the psk quotable gap

- **status**: completed — `validate_wifi_psk` now refuses what the station renderer cannot carry, so a pre-shared key accepted at a write surface can no longer die at render time
- **priority**: P1
- **owner**: bkd/23at5xui
- **createdAt**: 2026-08-28
- **completedAt**: 2026-08-28
- **plan**: PLAN-026 (M3)

`docs/task/RFCT-215.md` section 6 item 3 measured the defect and left it open.
This closes it.

## 1. What was measured, at this branch's base

Every claim the milestone rests on was re-measured at `c5f7e96` before anything
was written, and every one of them held.

The renderer's predicate is printable ASCII minus two characters, and it was
applied to a pre-shared key **only** inside `encode_psk`:

```
fn is_quotable(value: &str) -> bool {
    value
        .bytes()
        .all(|byte| (0x20..=0x7e).contains(&byte) && byte != b'"' && byte != b'\\')
}
```

What the write surface ran instead was `mosd_settings::validate_wifi_psk(psk)`
(`os/pkgs/mosd/apid/src/routes.rs:2227`), and that function checked a 64-digit
hex PMK or IEEE 802.11i's length band and nothing else. `grep` over the crate
found the predicate's only two call sites inside the station renderer,
`encode_ssid` and `encode_psk`, and no third one anywhere on a write path.

The gap is therefore not a theory. The route-level test written first (see
section 2) answered **201 Created** for a key carrying a quote — accepted,
stored, and refused later by the renderer with the error visible only in live
state.

`docs/design/api.md` stated no psk constraint at all:
`grep -n "passphrase\|PMK" docs/design/api.md` returned nothing, exit 1. The
nearest place the constraint was named is the `POST /api/v1/wifi/client/networks`
row, which already cites `mosd_settings::validate_wifi_psk(psk)`.

## 2. Red first

Two tests were written and **run failing** before any fix.

`mosd-settings`, the unit level:

```
running 1 test
test model::tests::a_passphrase_the_renderer_cannot_quote_is_refused ... FAILED

---- model::tests::a_passphrase_the_renderer_cannot_quote_is_refused stdout ----
thread '...' panicked at mosd-settings/src/model.rs:914:17:
"has\"quote1" must be refused

test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 57 filtered out
```

`apid`, the route level — and this is the one that shows what the defect
actually costs, because the answer is not a wrong refusal but an acceptance:

```
running 1 test
test tests::a_psk_the_renderer_cannot_quote_is_refused_by_the_wifi_route ... FAILED

---- tests::a_psk_the_renderer_cannot_quote_is_refused_by_the_wifi_route stdout ----
thread '...' panicked at apid/src/tests.rs:9263:9:
assertion `left == right` failed: "has\"quote1"
  left: 201
 right: 422

test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 352 filtered out
```

## 3. What changed

**One rule, stated once.** `is_wpa_quotable` is now a public function of
`mosd-settings` beside the typed model —
`pub fn is_wpa_quotable` (`os/pkgs/mosd/mosd-settings/src/model.rs:432`) — exported
from the crate root, and it holds the bytes:

```
pub fn is_wpa_quotable(value: &str) -> bool {
```

`validate_wifi_psk` calls it in the passphrase arm, after the length band and
after the raw-PMK early return. The station renderer's `is_quotable` keeps its
name and its place — `encode_ssid` reads it and the SSID's fallback to hex is
untouched — and delegates:

```
fn is_quotable(value: &str) -> bool {
    mosd_settings::is_wpa_quotable(value)
}
```

That shape was chosen over restating the predicate in `mosd-settings`
deliberately. A second copy of the bytes is the defect one level up: it is
exactly what let the write surface and the renderer disagree in the first
place, and PLAN-023 M6 refused the same option for the length band for the same
reason. `mosd-settings` cannot depend on the `mosd` binary crate, so the
predicate had to move down, not up.

**The renderer's own branch stays.** `if !is_quotable(psk) {` and its sentence
are unchanged. It is now unreachable through any write surface, which is the
point; it remains defence in depth for a value that reached the store some
other way, because `Store` loads settings files written by older builds and the
bound is deliberately not enforced in `WifiNetwork`'s `Deserialize` — a bound
enforced there would turn one bad key already on disk into a device whose
settings file does not load at all.

### 3.1 Which predicate was implemented, and why not the narrower one

PLAN-026 M3 names "the two characters the renderer cannot quote". The measured
renderer bound is **wider than two characters**: `is_quotable` refuses every
byte outside `0x20..=0x7e`, so a newline, a tab, any other control character and
every non-ASCII byte are refused by the same predicate that refuses `"` and `\`.

A two-character rule would have closed part of the gap and left the rest of it
open — a passphrase carrying `é` or a newline would still have been accepted at
the route and still refused at render time, which is the same defect with a
smaller input set. It would also have been a second, differently-worded copy of
the predicate, which the milestone's own design constraint forbids.

So the implemented rule is the renderer's predicate itself, unmodified, moved to
where a write surface can run it. The plan's phrase is read as naming the two
characters that motivated the item, not as bounding the fix. L1 ruled the same
way while this was in flight, and the predicate was re-verified against
`wifi_client.rs` at this HEAD rather than taken from the ruling.

### 3.2 A finding: the two character classes are near-identical, not identical

L1's ruling asks this record to state that the renderer's character class **is**
the WPA passphrase character class, which would make PLAN-026's escape hatch
inapplicable rather than merely unopened. The ruling also says that a reading of
the standard which contradicts it is a finding to report rather than an
assertion to make. This is that report: **the two classes are not identical.**
They agree on the printable range and differ on exactly two of its 95 code
points — and those two are precisely the ones the milestone is about.

IEEE 802.11i-2004 Annex H.4.1, carried forward as IEEE 802.11-2020 Annex J.4.1,
defines a pass-phrase as a sequence of 8 to 63 ASCII-encoded characters, each
"in the range of 32 to 126 (decimal), inclusive". The exclusion list is empty.
`"` is 34 and `\` is 92, so the standard admits both.

The repository's own record says the same thing in three places, and not one of
them attributes the two exclusions to the standard:

| What the code says, and where | What it attributes it to |
|---|---|
| `IEEE 802.11i's shortest WPA2 passphrase` (`os/pkgs/mosd/mosd-settings/src/model.rs:411`) and `IEEE 802.11i's longest` (`os/pkgs/mosd/mosd-settings/src/model.rs:414`) | Only the **length** band is the standard's |
| `the quote that would close the string and the backslash that some wpa_supplicant string forms treat as an escape` (`os/pkgs/mosd/mosd-settings/src/model.rs:420-421`), lifted from the renderer by this task | The **file format**, not the standard |
| `a handful of legal SSIDs take the hex form and stay just as correct` (`os/pkgs/mosd/mosd/src/reconciler/wifi_ap.rs:272-273`) | The repo already calls a value carrying these two characters **legal** |

So the tightening does refuse two characters a client could legitimately have
chosen. What makes that cost nothing is a different fact from the one the ruling
gives, and it is stronger:

**A passphrase carrying `"` or `\` never worked on this device.** Before this
change it was accepted at the route and stored, and then the station reconcile
failed — `apply` returns an error, no configuration file is written at all, and
no supplicant control call is made. That is asserted, not inferred, by
`an_unrenderable_key_fails_before_anything_is_written_or_started`
(`os/pkgs/mosd/mosd/src/reconciler/wifi_client.rs:1394`), which checks
`assert!(!paths.config.exists());`. One such key therefore stalled the whole
station subtree, every other configured network included, with the error visible
only in live state.

That test's key carries a newline as well as a quote, and the claim here is
about a **quote-only** key, so the step across is worth stating rather than
assuming: the two take the same path. `encode_psk` has exactly one gate for
either of them — the single `if !is_quotable(psk) {` branch — and `is_quotable`
is one `all(..)` over the bytes, so a quote alone and a quote-with-newline reach
the identical `Err`, and `apply` cannot distinguish them. The new tests added by
this task pin the quote-only case directly at both levels: the unit test and the
route test each drive `has"quote1`, which carries no newline and no other
excluded byte.

This change removes no working configuration. It converts a silent, total and
misattributed failure into an immediate 422 that names the character class and
nothing else. That is the whole of the milestone's value, and it survives the
classes not being identical.

### 3.3 The escape hatch: still not taken, and for the second condition

PLAN-026 opens the hatch only when **both** hold: legitimate WPA passphrases
require `"` or `\`, **and** wpa_supplicant has an escaping form the renderer
could use instead.

Given section 3.2, the first condition is closer to met than the ruling assumes
— the standard permits both characters, so a client could legitimately have
chosen one. The hatch nonetheless stays shut, on the **second** condition, which
could not be established here and is recorded as a limit rather than as a
finding: wpa_supplicant is not vendored in this tree.
`grep -rn "wpa_supplicant" --include="*.c" --include="*.h"` matches nothing; it
arrives as an Alpine package, `wpa_supplicant iw`
(`os/boards/cx3576/bsp/rootfs/alpine/Dockerfile:31`), so its `psk=` parser is not available to
measure against. The station renderer's own doc comment records
what it believes — that an SSID has wpa_supplicant's unquoted hex form to fall
back on and a passphrase has none, because bare hex on a `psk=` line means a raw
PMK and not a passphrase — and that belief is consistent with everything
measurable here, but it is a belief in this tree and not a measurement of the
parser.

So the state of the hatch, stated as the shape of the reasoning and not just as
its outcome:

| PLAN-026's condition | State | On what evidence |
|---|---|---|
| Legitimate WPA passphrases require `"` or `\` | **Established**, in the weaker sense of *permit* rather than *require*: a client could legitimately have chosen one | IEEE 802.11i Annex H.4.1's inclusive 32-to-126 range with an empty exclusion list, corroborated by the repo calling such values `a handful of legal SSIDs` (`os/pkgs/mosd/mosd/src/reconciler/wifi_ap.rs:272-273`) |
| wpa_supplicant has an escaping form the renderer could use instead | **Unmeasurable from this tree** | The parser is not here to read. A `wpa_supplicant.conf` under the board rootfs is a config file and not the parser, so it settles nothing |

Both conditions are required and only one is met, so the hatch does not open.
The second is recorded as a **limit** and not as a finding: this task did not
establish that no escaping form exists, and it must not be read as having done
so. Rounding it up to a finding would assert something unmeasured; rounding it
down to silence would hide the one question that could reopen the decision.
Neither is the honest state, which is that one of two conditions is settled. The direction taken is also the reversible one: if a supplicant-side
escaping form is later measured to exist, widening one predicate in
`mosd-settings` re-admits the two characters at both surfaces at once — which is
the property the lift bought. That is the residue this milestone leaves, and it
is a narrow one: two code points, on a path that has never carried them.

## 4. Tests

| Test, and where | What it holds |
|---|---|
| `fn a_passphrase_the_renderer_cannot_quote_is_refused` (`os/pkgs/mosd/mosd-settings/src/model.rs:943`) | The unit rule, over a quote, a backslash, a newline, a tab and a non-ASCII byte, each inside the length band so the length arm cannot pass it for the wrong reason; and that the admissible shapes — an in-range passphrase over the whole printable alphabet, and a raw PMK — still pass |
| `async fn a_psk_the_renderer_cannot_quote_is_refused_by_the_wifi_route` (`os/pkgs/mosd/apid/src/tests.rs:9546`) | The route answers 422 with section 2.4's envelope, `validation_failed`, `source` `apid`, the dot path; the message never echoes the key; and `fake.set_paths()` is empty, so a refused key never reaches mosd |
| `fn the_lifted_psk_bound_is_the_one_the_renderer_enforces` (`os/pkgs/mosd/mosd/src/reconciler/wifi_client.rs:785`) | Extended, not replaced. The existing agreement table gained the five unquotable shapes, so the property it was built for — that no input exists on which the renderer and the lifted rule disagree — now covers the predicate as well as the length band |

The renderer's own refusal test,
`a_passphrase_that_cannot_be_quoted_is_an_error_that_does_not_name_it`, was kept
untouched and still passes. It now exercises the lifted refusal rather than the
renderer's branch, which is precisely the change: the message it asserts on
still says `pre-shared key` and still names neither the key nor its length.

The refusal sentence follows the convention documented above `validate_wifi_psk`
and modelled by the renderer's: it names the class of character and not the
value, because a value — and its length — is a fact about a secret and this
string reaches an HTTP client.

## 5. Documentation

The anchor was re-confirmed against the **pre-change** document before anything
was written there, because after the edit the grep can no longer fail:
`git show c5f7e96:docs/design/api.md` into a scratch file, then
`grep -n "passphrase\|PMK"` over it — no output, exit 1. `grep -n
"validate_wifi_psk"` over the same file returned exactly **one** line, 266, the
`POST /api/v1/wifi/client/networks` row. So the row is the only place in the
document that names the validator, and it is the right home; no new section was
invented and none was needed.

The row's outcome cell now states what the 422 admits: a 64-digit hex PMK, or an
IEEE 802.11i passphrase of 8 to 63 characters the station renderer can carry —
printable ASCII, no quote and no backslash — citing `is_wpa_quotable`
(`os/pkgs/mosd/mosd-settings/src/model.rs:432`).

## 6. A residue this created and paid off in the same branch

Adding lines to `model.rs`, `wifi_client.rs` and `apid/src/tests.rs` moved 58
cited lines out from under the documents that name them, and
`docs/verify-citations.sh` went to `46 FAILED (0 resolution, 46 content), 2125
citations passed`. Every failure named one of those three files.

They were re-anchored **mechanically and in their own commit**: each citation's
pre-image line was mapped to its post-image line through the diff of that file,
so the quoted fragment sits at the line it now occupies. No prose was touched,
and the commit's diff is 51 changed lines against 51 — a pure re-point. This
includes `docs/task/RFCT-215.md` section 6 item 3, whose citations now resolve
against the moved lines; its prose is left as the dated measurement it is.

## 7. Findings, not fixed here

The access point's renderer carries a **third** statement of the same bytes,
plus its own copies of the length bounds, and its refusal sentence names the
length of the secret where the station path's deliberately does not. That was
measured here, out of this milestone's scope, and it is filed as its own task:
**`docs/task/RFCT-260.md`**, re-measured by the routing L2 at `ffa65ca` and
carrying the full detail. It is not restated here, so there is one home for it.

Two boundaries are worth stating explicitly, because they are what kept it out:
`os/pkgs/mosd/mosd/src/reconciler/wifi_ap.rs` is outside this task's file list,
and the AP key has no `/api/v1/` write route of its own, so nothing accepted at
the API surface this milestone tightened can reach it. RFCT-260's own sizing
question — whether that refusal text can reach an API caller, which decides
inconsistency-at-P2 against disclosure-at-P1 — is deliberately left open there
rather than guessed at here.

## 8. Gates

All four run in this task's own worktree, `/srv/bkd/worktrees/u51kzjlk/23at5xui`,
and the Rust gate's container mounts that path and no other
(`-v /srv/bkd/worktrees/u51kzjlk/23at5xui:/work`). The shared checkout at
`/srv/ai/mos` was never checked out, edited, mounted or measured from; a verdict
taken there would be void, and none of these is.

| Gate | Result |
|---|---|
| `bash docs/verify-citations.sh` | **`2210/2210 PASS`**, `ratchet failures: 0`, and `no quote, by document: docs/task/RFCT-249.md 0` — this document arms every citation it makes, so it starts at the ratchet's zero ceiling for a new file rather than taking an override row in `docs/verify-citations-unquoted-baseline.txt`. Near-miss 354, equal to the merge parent's, so the re-anchor of section 6 drifted nothing |
| `bash docs/verify-index.sh` | **`875/875 PASS`**. The merge parent measures `871/871 PASS`; the whole of the +4 is this task's one new document and its one index row, which is the only change the branch makes to the indexed set |
| `bash hack/check.sh` in `localhost/mos-build-rust:amd64` | `Summary [ 252.204s] 838 tests run: 838 passed (2 slow), 0 skipped` — 836 was the campaign baseline at RFCT-245, this task adds 2, and 836 + 2 = 838 — then `advisories ok, bans ok, licenses ok` and **`ALL CHECKS PASSED`**. `dbus` installed in-container first, or the bus round-trip goes rc=100. Run at `1d5e8fb`; the later merge of `bkd/5q6am5rw` and this file's own revisions changed no `.rs`, `.toml`, `.json` or lockfile — `git diff --stat 1d5e8fb HEAD -- '*.rs' '*.json' '*.toml'` is empty — so the compiled tree the gate measured is byte-identical to the one reported |
| `oasdiff breaking` against main's tip | `No changes detected`, **RC=0**. Re-run last against main's tip as it then stood, `a06e9dd`; main moved three times during this task (`c5f7e96` -> `ffa65ca` -> `a06e9dd`) and the base was re-taken each time rather than cached. Both severity promotions applied. `openapi.json` is byte-identical to main's, which is expected: this milestone registers no route and changes no schema |

The two `warning` lines the Rust gate prints are **pre-existing and present on
main**, are warnings and not failures, and are unrelated to anything this task
changed: an unmatched `"Zlib"` license allowance at `deny.toml:13`, and a yanked
`chacha20 0.10.1` reached through `uuid` into `rumqttd` and `zbus`.
