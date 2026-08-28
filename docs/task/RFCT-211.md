# RFCT-211 PLAN-023 M2 part 1: `access.apiTokens` in the settings model

- **status**: in progress
- **priority**: P1
- **owner**: bkd/6u47m244
- **createdAt**: 2026-08-28
- **plan**: PLAN-023 (M2 part 1)

The storage tier for the bearer API token of `docs/design/api.md` section 3.2,
and only the storage tier. Bearer verification, the constant-time compare, the
`mos_<id>_<secret>` wire format, `POST/GET/DELETE /api/v1/tokens`,
`POST /builtin/tokens` and the mint pane are RFCT-213's and are deliberately
absent here. Nothing in this task reads a token; what it lands is a place to
put one that a later task can read without reopening a schema decision.

## 1. Section 3.2 re-measured before implementing

Section 3.2 was written at an older commit and its line citations had drifted:
the settings model moved when schema v7 landed with PLAN-022. Each claim the
storage tier depends on was re-measured at this branch's base rather than
quoted forward.

| Claim in section 3.2 | Measured | Verdict |
| --- | --- | --- |
| The store is `access.apiTokens`, items `{id, name, hash, created}` | no such field existed | implemented as written |
| The tree renames multi-word keys to camelCase | `webAdmin`, `authorizedKeys`, `passwordHash` all present | followed |
| `access.device` never holds a plaintext secret | the struct holds a hash and a generation | followed |
| The dot-path syntax has no array indexing | writes walk objects only | the model assumes none |
| The redaction denylist must cover `hash` | `hash` was **already on the list** | measured, not re-added |
| Nothing in the crate reads a wall clock | apid reads one in two places | **corrected below** |

The last two rows are the ones where the document and the tree had already
diverged, and both changed what this task did.

## 2. The shape that landed

`ApiToken` carries four fields and nothing else. Their spelling in the file is
`pub struct ApiToken {` (`os/pkgs/mosd/mosd-settings/src/model.rs:297`), and the
list hangs off `access` under the tree's camelCase convention -- the serde
attribute is `rename = "apiTokens"` beside `skip_serializing_if =
"Vec::is_empty"`, on `pub api_tokens: Vec<ApiToken>,`
(`os/pkgs/mosd/mosd-settings/src/model.rs:180-181`).

Three properties are load-bearing:

- **Under `access`, not beside it.** Section 3.2 reason 4: apid's gate already
  fetches the `access` subtree per request, so the token set the check needs is
  in hand when the check runs. A sibling root would have added a bus round trip
  to every API call. This is a placement decision, and it is the reason the
  field is nested rather than convenient.
- **Hashes only.** `pub hash: String,`
  (`os/pkgs/mosd/mosd-settings/src/model.rs:312`) is a SHA-256 hex digest. There
  is no plaintext field and no field a plaintext could be smuggled into: the
  struct carries `deny_unknown_fields`, so a hand-edited `secret = "..."` makes
  the document fail to load rather than quietly persist.
- **Empty is not written out.** `skip_serializing_if = "Vec::is_empty"` means a
  device that never minted a token writes a v8 file that differs from its v7
  file by the version integer alone. That is what makes the bump additive, and
  section 3 is why that matters.

## 3. `created`: what it is, and what this device's clock is worth

Section 3.2 asserts that *"nothing in the crate reads one"* about a wall clock.
Measured, that is true of `SessionStore` --
`sessions: Mutex<HashMap<String, Instant>>,`
(`os/pkgs/mosd/apid/src/session.rs:32`) is monotonic and cannot express a
deadline that survives a reboot -- and **false of apid as a whole**: the audit
ring stamps `chrono::Utc::now()` and the login guard reads
`std::time::SystemTime::now()`. So a wall clock is available. The question is
whether it is worth anything.

It is not, and the reason is in the image rather than the code. A grep for
`chrony`, `ntpd`, `ntpsec`, `timesyncd`, `hwclock` and `time-sync` over `os/`
returns nothing at all: no RTC sync unit and no time daemon is built, installed
or enabled. `docs/design/ro-root.md` records the consequence for `/etc/adjtime`
in one line:
*"Not written: no RTC sync unit is enabled."*
(`docs/design/ro-root.md:793`). A device's clock is therefore whatever the
kernel came up with, and it may be wrong by any amount.

The representation chosen says exactly that and no more: `pub created: u64,`
(`os/pkgs/mosd/mosd-settings/src/model.rs:328`) is seconds since the UNIX epoch
as the device clock read them at mint time, saturating at 0 -- the same
representation and the same saturation apid's login guard already persists. It
is documented as a label, never a deadline, and three things follow from that
and are enforced rather than hoped for:

1. **No `expiresAt`, and none is invented.** An expiry enforced against a clock
   that can reset is worse than no expiry: it is a field that either does
   nothing or locks an operator out of a device that rebooted. Revocation is
   the whole lifecycle, exactly as section 3.2 decided.
2. **Nothing compares `created` to anything.** It is stored, served and
   displayed. If a trusted clock ever arrives, the field is already the right
   shape to become meaningful, and until then it claims nothing.
3. **The validator places no bound on it.** 0, 1 and `u64::MAX` all pass, and
   there is a test that says so. A bound would let a wrong clock decide whether
   the operator may hold a credential, which inverts what the field is for.

The alternative considered and rejected was an RFC 3339 string. It reads
better and claims more: a formatted UTC timestamp looks authoritative and
comparable across devices, which is precisely the impression a device with no
time source must not give.

## 4. The schema bump: required, and the reason is the rollback

`SCHEMA_VERSION` moves 7 to 8 -- `pub const SCHEMA_VERSION: u32 = 8;`
(`os/pkgs/mosd/mosd-settings/src/model.rs:11`) -- with a registered
`pub struct MigrateV7ToV8;`
(`os/pkgs/mosd/mosd-settings/src/migration.rs:480`).

The task asked whether this tree's own rules require a bump for an additive
optional field. Measured, they do, and the evidence is both precedent and
mechanism.

**Precedent.** Every one of the four most recent additions took a bump,
including the one that added nothing to the serialized form: v3 to v4 added
`access.ssh.authorizedKeys`, v4 to v5 the `container` subtree, v5 to v6 the
`mqtt` subtree, and v6 to v7 added interface kinds whose every field is
defaulted and skipped on serialization. There is no precedent in this crate for
adding a field without a bump.

**Mechanism, which is the decisive half.** The `serde(deny_unknown_fields)`
attribute sits directly above `pub struct AccessSettings {`
(`os/pkgs/mosd/mosd-settings/src/model.rs:146-148`), so a document holding
`access.apiTokens` is one that a binary without the field cannot deserialize at
all. The only thing that rescues such a document is the store's tolerant load,
and that path is gated on the on-disk version being greater than the reading
binary's: *"A document from a NEWER schema loads tolerantly instead of
failing"* (`os/pkgs/mosd/mosd-settings/src/store.rs:107`). Adding the field
without the bump would therefore turn an A/B rollback out of a token-holding
device into a **failed settings load** -- hostname, network configuration and
admin credential lost with it -- rather than a dropped key. The bump is not
bookkeeping; it is what makes the rollback survivable.

`up` stamps the version and does nothing else, which is `MigrateV6ToV7`'s shape
for `MigrateV6ToV7`'s reason. Seeding an empty `apiTokens = []` into every
device's file was rejected on `MigrateV5ToV6`'s grounds: a written-out default
is indistinguishable from an operator's choice the day the default changes.
`down` stamps 7 and removes the key, discarding every token -- a v7 binary has
no bearer verification to honour them, and v7's `deny_unknown_fields` would
refuse the whole document rather than only the key.

Two fixtures in the crate's integration tests tracked `SCHEMA_VERSION + 1` and
moved with it. One of them used `access.apiTokens` itself as its "key this
schema does not know", which this change makes known; leaving it would have
left a rollback test asserting nothing. It now carries an `expiresAt` on a
token entry, which is the field section 3.2 refuses to add, so the fixture is a
genuine future document again.

## 5. Validation: what makes an entry invalid

`pub fn validate_api_tokens(tokens: &[ApiToken]) -> Result<(), SettingsError> {`
(`os/pkgs/mosd/mosd-settings/src/api_token.rs:62`) follows
`validate_authorized_keys`: a free function the write path calls, not a hook
inside `Settings::set`. The tree is a file anything with STATE write access can
edit, so the boundary belongs where an operator action is, and the crate
already made that choice once.

| Rejected | Why it is not merely untidy |
| --- | --- |
| duplicate `id` | identity is the id, so a lookup and a `DELETE` would have two answers |
| duplicate `hash` | two names for one secret: revoking either leaves the presented token working, which makes revocation lie |
| `hash` not 64 lowercase hex | a digest that can never match anything, indistinguishable to an operator from one that can; uppercase is rejected rather than folded, so a comparison cannot depend on which path wrote the entry |
| `id` empty, over-long or not lowercase hex | the id is a `DELETE` path segment and a field of an `_`-separated wire format; both break on a separator or an escape |
| `name` empty, over 256 bytes, or holding a control character | the name is the only thing that tells one token from another in a listing |
| more than 32 entries | `const MAX_TOKENS: usize = 32;` (`os/pkgs/mosd/mosd-settings/src/api_token.rs:32`), matching `const MAX_KEYS: usize = 32;` (`os/pkgs/mosd/mosd-settings/src/authorized_key.rs:38`) -- and tighter here than a STATE-growth argument alone needs, because the list is read on the hot path of every API request |

Not rejected: any value of `created`, for section 3's reason. Rejection
messages name the entry index and never echo a digest or an id, and there is a
test for that.

## 6. Redaction: measured, already covered, now proved

The task asked for the denylist to be extended. Measured at this branch's base,
it did not need extending: PLAN-022 had already widened it to
`const SECRET_FIELDS: [&str; 5] = ["psk", "passwordHash", "password_hash", "hash", "privateKey"];`
(`os/pkgs/mosd/apid/src/redact.rs:40`). `hash` was on it before any settings
field carried that name.

What changed is the standing of that entry, and that is recorded in the file
rather than left implicit. `access.apiTokens[].hash` is the **first real
settings field named `hash`**, so the entry stops being precautionary and
starts being load-bearing: `GetSettings` answers with the subtree verbatim, and
`access` is the subtree the auth gate reads on every request.

The proof is a test rather than the reading above. The fixture the redaction
suite runs against now carries a token entry with a marker digest, so the
existing walk covers it automatically, and a dedicated test asserts three
distinct failure modes separately -- the subtree, the array on its own, and the
absence of any dot-path that reaches one entry. It also asserts the *positive*
half: the id, the name and the clock reading still come back, so this is
redaction and not removal, and `GET /api/v1/tokens` has something to list.

## 7. What was deliberately not built

Bearer verification, the constant-time compare, the `mos_<id>_<secret>` format,
`POST/GET/DELETE /api/v1/tokens`, `POST /builtin/tokens`,
`POST /builtin/tokens/revoke`, the OpenAPI document and any change to apid's
auth gate. All of it is RFCT-213's. `os/pkgs/mosd/apid/src/routes.rs`,
`session.rs`, `auth.rs` and `openapi.json` are untouched by this branch.

One thing outside this task's write scope was touched and is called out rather
than buried: `docs/design/api.md` carries two quoted copies of the
`SCHEMA_VERSION` literal, and a quote naming a value cannot be repaired by a
line map. Both were updated 7 to 8 in the re-anchor commit. No prose, no claim
and no citation was added or removed.

## 8. Gates

| Gate | Result |
| --- | --- |
| `bash docs/verify-citations.sh` | pending final run |
| `bash docs/verify-index.sh` | pending final run |
| `bash os/pkgs/mosd/hack/check.sh` | pending final run |
