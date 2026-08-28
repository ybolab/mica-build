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
`mosd-settings` beside the typed model
(`os/pkgs/mosd/mosd-settings/src/model.rs:432`), exported from the crate root,
and it holds the bytes:

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
characters that motivated the item, not as bounding the fix.

Nothing legitimate is lost by the wider reading. IEEE 802.11i's own passphrase
alphabet is ASCII 32 to 126 — precisely the printable range — so the only
characters this refuses that the standard allows are `"` and `\`, and those are
the two the plan already names.

### 3.2 The escape hatch was considered and not taken

PLAN-026 offers one: if legitimate WPA passphrases genuinely require `"` or `\`
**and** wpa_supplicant has an escaping form the renderer could use instead, stop
and report rather than tighten.

The first half holds — 802.11i's alphabet includes both characters, so a
passphrase using them is legal in the standard even though it cannot be written
into this configuration file. The second half could **not** be established here,
and that is stated as a limit rather than as a finding: wpa_supplicant is not
vendored in this tree. `grep -rn "wpa_supplicant" --include="*.c" --include="*.h"`
matches nothing; it arrives as an Alpine package
(`os/boards/cx3576/bsp/rootfs/alpine/Dockerfile:31`), so its `psk=` parser is not
available to measure against. The renderer's own doc comment already records
what it believes — that an SSID has wpa_supplicant's unquoted hex form to fall
back on and a passphrase has none, because bare hex on a `psk=` line means a raw
PMK and not a passphrase.

Both conditions are required by the plan's wording, and only one is established,
so the hatch does not open. The direction taken is also the reversible one: a
refusal at the write surface is a 422 a client sees immediately, where the
status quo was a stored key that failed silently on the reconciler. If a
supplicant-side escaping form is later measured to exist, widening one predicate
in `mosd-settings` re-admits the two characters at both surfaces at once —
which is the property the lift bought.

## 4. Tests

| Test | Where | What it holds |
|---|---|---|
| `a_passphrase_the_renderer_cannot_quote_is_refused` | `os/pkgs/mosd/mosd-settings/src/model.rs:943` | The unit rule, over a quote, a backslash, a newline, a tab and a non-ASCII byte, each inside the length band so the length arm cannot pass it for the wrong reason; and that the admissible shapes — an in-range passphrase over the whole printable alphabet, and a raw PMK — still pass |
| `a_psk_the_renderer_cannot_quote_is_refused_by_the_wifi_route` | `os/pkgs/mosd/apid/src/tests.rs:9244` | The route answers 422 with section 2.4's envelope, `validation_failed`, `source` `apid`, the dot path; the message never echoes the key; and `fake.set_paths()` is empty, so a refused key never reaches mosd |
| `the_lifted_psk_bound_is_the_one_the_renderer_enforces` | `os/pkgs/mosd/mosd/src/reconciler/wifi_client.rs:785` | Extended, not replaced. The existing agreement table gained the five unquotable shapes, so the property it was built for — that no input exists on which the renderer and the lifted rule disagree — now covers the predicate as well as the length band |

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

`docs/design/api.md:266`, the `POST /api/v1/wifi/client/networks` row, in the
place that already cites the validator. No new section was invented. The row's
outcome cell now states what the 422 admits: a 64-digit hex PMK, or an IEEE
802.11i passphrase of 8 to 63 characters the station renderer can carry —
printable ASCII, no quote and no backslash — citing `is_wpa_quotable`.

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

The access point's renderer carries a **third** statement of the same bytes.
`os/pkgs/mosd/mosd/src/reconciler/wifi_ap.rs` has its own private
`RAW_PMK_LEN`, `MIN_PASSPHRASE_LEN` and `MAX_PASSPHRASE_LEN`
(`os/pkgs/mosd/mosd/src/reconciler/wifi_ap.rs:84-88`), its own length check
inside `fn psk_directive` (`os/pkgs/mosd/mosd/src/reconciler/wifi_ap.rs:353`),
and its own predicate `fn is_plain`
(`os/pkgs/mosd/mosd/src/reconciler/wifi_ap.rs:274`), whose byte test is
character-for-character the one lifted here plus two clauses hostapd needs and
wpa_supplicant does not: a leading or trailing space is refused as well.

Two things about it are worth the next phase's attention and neither is this
milestone's to change. It is not the same predicate, so folding it into
`is_wpa_quotable` is a design decision and not a rename. And its refusal
sentence **does** name the length observed —
`"the pre-shared key is {} characters; WPA2 requires ..."` — where both the
station renderer's and the lifted rule's deliberately do not; that sentence
reaches no HTTP client today, because the AP key has no `/api/v1/` write route
of its own, so nothing accepted at the API can reach it. Recorded as measured,
not fixed: `wifi_ap.rs` is outside this task's file list.

## 8. Gates

| Gate | Result |
|---|---|
| `bash docs/verify-citations.sh` | `docs/verify-citations.sh: 2171/2171 PASS` — 2170 at main plus the one citation this task added |
| `bash docs/verify-index.sh` | GATE_INDEX |
| `bash hack/check.sh` in `localhost/mos-build-rust:amd64` | GATE_RUST |
| `oasdiff breaking` against main's tip | GATE_OASDIFF |
