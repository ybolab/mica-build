# RFCT-032 Settings schema v4: access.ssh.authorizedKeys and the key parser

- **status**: completed — implementation complete
- **priority**: P1
- **owner**: ai-agent
- **createdAt**: 2026-08-19 09:39
- **claimedAt**: 2026-08-19 09:45
- **completedAt**: 2026-08-19 10:40

## Description

SSH access is moving to a model where sshd is off by default, root has no
password, a transient root password can be set from the web UI and vanishes on
reboot, and the only *persistent* way in is an SSH public key added through the
web UI. This task is the first seam of that change: the place the keys are
stored, and the code that decides whether a given line of text is a key at all.

Nothing here renders a file or opens a socket. `mosd`'s sshd reconciler, webd's
form handling and the image profiles are separate tasks that consume what this
one defines.

Two things were built:

1. **Schema v4.** `access.ssh.authorizedKeys` — a list of
   `{ key, comment? }` — plus the `MigrateV3ToV4` step that puts it into an
   existing document and takes it back out.
2. **`mosd-settings/src/authorized_key.rs`** — a parser and a list validator,
   with a hand-written base64 codec.

### The parser is a whitelist, and it is deliberately narrower than sshd

`parse_authorized_key` accepts exactly two shapes:

```
<type> <base64blob>
<type> <base64blob> <comment>
```

Everything that passes this function ends up inside a file sshd reads and acts
on, so the grammar is the narrowest one that still expresses a usable key. The
full accept/reject rules:

| Position | Rule |
|---|---|
| whole line | no `\0`, `\n`, `\r`, `\t`, `\x0b`, `\x0c`; no leading or trailing space; not empty |
| separators | exactly one ASCII space between type and blob, and between blob and comment |
| type | byte-for-byte equal to one of seven names (below); no case folding |
| blob | non-empty, every character in `A-Za-z0-9+/` with at most two trailing `=`, length a multiple of 4, decodes to at least 32 bytes |
| blob | the algorithm name **inside** the decoded blob equals the declared type |
| comment | everything after the second space, verbatim; no byte below `0x20`, no `0x7f`; at most 256 bytes; not empty |

The seven accepted types are `ssh-ed25519`, `ssh-rsa`,
`ecdsa-sha2-nistp256`, `ecdsa-sha2-nistp384`, `ecdsa-sha2-nistp521`,
`sk-ssh-ed25519@openssh.com` and `sk-ecdsa-sha2-nistp256@openssh.com`.
Certificate types (`*-cert-v01@openssh.com`), `ssh-dss` and the
`rsa-sha2-*` signature-algorithm names are **not** key types this list carries,
and are rejected.

On success `key` is `"<type> <blob>"` with the comment stripped, and `comment`
is the separate field. That split is the point: two operators pasting the same
public key under different labels must produce entries that compare equal, so
duplicate detection has something canonical to compare.

**Why the `options` field is refused.** OpenSSH lets an authorized-keys line
begin with an options list — `command="..."`, `environment="..."`, `no-pty`,
`restrict`, `from="..."` and so on. `command=` is a remote-code-execution
primitive by design: it names a program the server runs on every login with
that key. Phase 1 has no feature that needs any of it, so rather than
validating an options grammar the parser refuses to have one, which it enforces
by requiring the line to *begin* with a known key type. Every options-prefixed
line therefore fails on the type check, and so does a `#`-commented line and a
blank line. If a later phase needs `restrict` or `from=`, adding it is a
deliberate schema change with its own review, not an accident of a permissive
parser.

**Why the blob's own type field is checked.** This is what makes the module a
validator rather than a shape check. An OpenSSH public key blob begins with a
four-byte big-endian length followed by that many bytes of algorithm name, and
sshd resolves a disagreement between the label and the blob by trusting the
blob. A line reading `ssh-ed25519 <an RSA blob>` satisfies every other rule
here, and would install a key whose actual algorithm is not the one the
operator (or a future policy check on the type field) believes it is. So the
parser decodes the blob, reads the embedded name, and compares. Mutation M1
below confirms this check is load-bearing.

**Why shell metacharacters are accepted in a comment.** `\`, `"`, `'`,
`` ` ``, `$` and `#` are rejected in the type and the blob because they are not
in those alphabets — but inside a comment they are accepted verbatim, and the
tests assert that acceptance rather than leaving it untested. The comment is
written into a file and read by sshd; it is never handed to a shell. Rejecting
`dev$box` as a label would be theatre that costs an operator a legitimate name
and buys nothing. What *is* banned in a comment is the C0 range and `0x7f`:
those could split one entry into two lines, or hide the rest of the line from
whoever reads the file. Non-ASCII UTF-8 is allowed, because people put names
there.

**Why the space rule is exact.** Fields are separated by exactly one space, so
`ssh-ed25519  AAAA...` (two spaces) is a rejection rather than something the
parser silently normalises. A run of spaces *inside* the comment is fine and is
preserved, because everything after the second space is the comment taken
verbatim to end of line.

### `validate_authorized_keys` re-parses; it does not trust the tree

The settings file is a file on STATE that a person can edit. A key that passed
`parse_authorized_key` on the way in is not the same claim as a key that still
parses on the way out, so the list validator re-parses every entry's `key`,
requires the re-parsed comment to be `None` (a comment smuggled into `key`
would put operator text on the key line itself), re-checks each `comment`
field, rejects duplicate `key` values naming both indices, and caps the list at
32 entries. Callers — webd on input, the sshd reconciler before rendering —
are expected to run it at both ends.

### Base64 is hand-written, on purpose

The workspace has no base64 crate. `decode_base64` and `encode_base64_nopad`
are about thirty lines each, standard alphabet, and `decode_base64` returns
`None` for every malformed input rather than panicking or decoding partially.

Adding a dependency was rejected for three reasons. The workspace already pins
`tough` to `=0.18.0` to keep a pure-Rust crypto backend (RFCT-016), so
dependency additions here are not free — every one is a supply-chain decision
that `cargo deny` has to bless. The needed surface is two functions over a
fixed alphabet with no streaming, no URL-safe variant and no configuration.
And the code is small enough to read in full during review, which is worth more
on a security boundary than the same code behind a version range. (`base64`
*is* already in `Cargo.lock` as a transitive dependency of `reqwest`'s tree,
but it is not a direct dependency of any workspace crate and making it one is
out of scope for this task.)

### `down` discards keys, and that is the correct trade

`MigrateV3ToV4::down` removes `access.ssh.authorizedKeys` unconditionally,
including a non-empty list. This is real data loss and is chosen rather than
tolerated:

- A v3 image has no code that renders the list into an `authorized_keys` file.
  Keeping the keys in the document would make the settings tree advertise an
  access path the running image cannot serve — an operator would read their key
  back out of the tree and reasonably believe it works.
- v3 deserializes `access.ssh` with `deny_unknown_fields`, so a leftover
  `authorizedKeys` key does not merely sit there being ignored: it makes the
  whole document fail to load.

Dropping the list makes the rollback honest. A device rolled back to v3 falls
back to that release's access story, and rolling forward again starts from an
empty list rather than from keys nobody re-authorized. The reasoning is
recorded on `down`'s own doc comment, where the next person to read that
function will find it. There is no warning log because this crate has no
`tracing` dependency and adding one was out of scope.

`up` is idempotent: an existing array is left untouched, so re-running it
changes nothing. `up` over a *non-array* value at that path is a
`SettingsError::Migration` naming both the path and the type found, rather than
a silent overwrite of whatever someone hand-edited in. Both directions cope
with `access` or `access.ssh` being absent — `up` creates the intermediate
tables, `down` is a no-op.

### Error variant

All parser and validator failures are `SettingsError::Validation`, which
already existed in `error.rs`, with `path` set to `access.ssh.authorizedKeys`.
Messages name the field and, where it applies, the byte offset. The rejected
input is never echoed back into the message.

## Scope

Owned here:

- `mosd/mosd-settings/src/model.rs` — `SCHEMA_VERSION` 3 -> 4, the
  `AuthorizedKey` struct, `SshSettings::authorized_keys` and its default.
- `mosd/mosd-settings/src/migration.rs` — `MigrateV3ToV4`, its registration,
  and the `child_table` helper.
- `mosd/mosd-settings/src/authorized_key.rs` (new) — parser, validator, base64
  codec, and 27 unit tests.
- `mosd/mosd-settings/src/lib.rs` — module and re-exports.
- `mosd/mosd-settings/tests/settings.rs` — 11 new integration tests; existing
  tests updated only where the version bump moved a literal (see below).
- `docs/task/RFCT-032.md`.

Touched outside the owned set, minimally and mechanically:

- `mosd/mosd/src/reconciler/sshd.rs` — two exhaustive `SshSettings { .. }`
  literals in that file's tests each gained `authorized_keys: Vec::new()`.
  Adding a field to a public struct breaks exhaustive literals in the consuming
  crate, so this is the compile fix, not a behaviour change; no production line
  in that file was touched. The reconciler task that owns this file will need
  to be aware of it.

Not touched: `Cargo.toml` (no dependency added), `Cargo.lock`, `webd`, `os/**`,
`docs/task/index.md` (owned by a later task), and every other
`SshSettings` default — `enabled`, `port`, `permitRootLogin`,
`passwordAuthentication` and `listenAddresses` are exactly as they were,
because the default flip belongs to a sibling task.

### Existing tests that had to move

Four assertions in `tests/settings.rs` named the schema version as a literal
and had to follow the bump. None were weakened or removed:

- `save_load_roundtrip_with_network`: on-disk `schema_version` 3 -> 4.
- `real_v2_document_survives_the_upgrade_to_v3` and
  `v0_and_v1_documents_walk_all_the_way_to_v3`: `Store::load` now walks one
  step further, so the expected version is 4. Both gained an assertion that
  `authorizedKeys` arrives empty. Their names still say v3; renaming them would
  have made the diff read as a delete plus an add, so the names were left and
  this note records it.
- `migrate_errors_on_missing_step` asked for version 4, which now exists. The
  gap moved to 5, which preserves the test's intent exactly.
- `v3_populated()` now says `schema_version: 3` instead of `SCHEMA_VERSION`.
  It is the *input* to the v3 rollback tests, so pinning it to the current
  constant was already wrong in principle and became wrong in fact at v4.

## Work checklist

- [x] R1 `SCHEMA_VERSION == 4`; `AuthorizedKey`; `SshSettings.authorized_keys`
      renamed `authorizedKeys`, defaulting empty; no other SSH default touched
- [x] R1 `AuthorizedKey` and the four functions re-exported from `lib.rs`
- [x] R2 `MigrateV3ToV4` registered; `up` idempotent, creates intermediates,
      errors on a non-array; `down` removes the key and documents the loss
- [x] R3 parser, validator and hand-written codec, no new dependency
- [x] R4.1 all seven types parse, canonicalise and round-trip comments
- [x] R4.2 per-character hostile input in type / blob / comment, one character
      per case, including the shell-metacharacter acceptance in a comment
- [x] R4.3 blob-vs-declared-type mismatch rejected, match accepted, all 49
      type-vs-blob pairs checked
- [x] R4.4 31 decoded bytes rejected, exactly 32 accepted
- [x] R4.5 options-prefixed, `#`-commented and empty lines rejected
- [x] R4.6 codec round trip over lengths 0..=64, all three `len % 3` cases,
      invalid alphabet and bad padding
- [x] R4.7 validator: duplicate, 32 accepted / 33 rejected, comment-in-`key`,
      malformed `key`, valid list
- [x] R4.8 default tree serialises `authorizedKeys` empty at version 4; a v4
      document round-trips through the store
- [x] R4.9 migration up/idempotent/non-array/down/round-trip/missing tables,
      and the full v0 -> v4 -> v0 walk
- [x] R5 this record; `docs/task/index.md` left alone
- [x] `bash mosd/hack/check.sh` prints `ALL CHECKS PASSED`

## Verification (2026-08-19)

Command:

```
bash mosd/hack/check.sh
```

Result: `ALL CHECKS PASSED` — `cargo fmt --all --check`, `cargo clippy
--workspace --all-targets --locked -- -D warnings`, `cargo nextest run
--workspace --locked` and `cargo deny check licenses bans advisories` all
clean.

```
Summary [  29.567s] 241 tests run: 241 passed, 0 skipped
```

The suite was at **203** before this task and is at **241** after: 38 new tests
-- 27 unit tests beside the parser, and 11 integration tests (25 -> 36).
`mosd/Cargo.lock` is unchanged.

### Mutation testing

Every guard added by this task was removed or inverted and the crate's suite
re-run, to establish that each test fails for the reason it claims. All
mutations were reverted; the check run above is on the reverted tree.

| # | Mutation | Tests that FAILED |
|---|---|---|
| M1 | blob-vs-declared-type check made a no-op | `the_blob_must_declare_the_type_the_line_declares`, `an_entry_with_a_malformed_key_is_rejected` |
| M2 | type whitelist bypassed | `a_type_outside_the_whitelist_is_rejected`, `an_entry_with_a_malformed_key_is_rejected` |
| M3 | comment control-character ban bypassed | `control_characters_are_rejected_in_the_comment`, `an_entry_with_a_bad_comment_field_is_rejected` |
| M4 | duplicate-key check bypassed | `a_duplicate_key_is_rejected_and_names_its_index` |
| M5 | `MAX_KEYS` raised to 1024 | `the_list_is_bounded_at_thirty_two_entries` |
| M6 | `MIN_BLOB_BYTES` dropped to 0 | `a_blob_below_thirty_two_..._is_accepted`, `an_entry_with_a_malformed_key_is_rejected` |
| M7 | decoder maps out-of-alphabet bytes to zero instead of `None` | `the_decoder_rejects_bad_alphabets_and_bad_padding` |
| M8 | leading/trailing-space ban bypassed | `space_runs_and_edge_spaces_are_rejected_between_fields_but_kept_in_a_comment` |
| M9 | `up` overwrites a non-array value instead of erroring | `v3_to_v4_up_refuses_a_non_array_authorized_key_value` |
| M10 | `down` leaves `authorizedKeys` in place | `v4_document_migrates_down_to_v3_and_round_trips` |
| M11 | `MAX_COMMENT_BYTES` raised to 4096 | `a_comment_is_bounded_at_256_bytes`, `an_entry_with_a_bad_comment_field_is_rejected` |
| M12 | comment left inside the canonical `key` | `every_accepted_type_parses_with_and_without_a_comment`, `shell_metacharacters_are_accepted_verbatim_inside_a_comment` |
| M13 | `key`-carries-a-comment check bypassed | `an_entry_whose_key_carries_a_comment_is_rejected` |

Two of these changed the tests rather than only confirming them:

**M2 initially caught nothing in its own test.** `a_type_outside_the_whitelist_
is_rejected` fed each bad type a blob built for `ssh-ed25519`, so with the
whitelist bypassed the *blob-vs-type* check still rejected every line and the
test passed for the wrong reason. It now builds each line a blob whose embedded
algorithm name agrees with the declared type, leaving the whitelist as the only
guard that can reject it, and it fails under M2 as it should. (The mutation was
never invisible — `an_entry_with_a_malformed_key_is_rejected` caught it — but a
test that names the whitelist should fail on the whitelist.)

**M6 would not compile**, which is its own finding: three tests wrote their
expectations as `MIN_BLOB_BYTES`, `MAX_KEYS` and `MAX_COMMENT_BYTES` rather
than as `32`, `31`, `256` and `257`. An expectation written in terms of the
constant under test moves with the constant and proves nothing. All of them now
use literals, and M5, M6 and M11 each fail a test.

## What is NOT proved here

- **That a real OpenSSH key parses.** The tests construct blobs from a
  `<length><algorithm name><filler>` byte sequence with this crate's own
  encoder, because the spec forbids pasting key material in from anywhere. That
  proves the format rules and the type-agreement check; it does not prove that
  `ssh-keygen` output round-trips. Verifying that against a real
  `ssh-keygen -t ed25519` public key is worth doing in the reconciler task,
  which will have a rendered file to compare.
- **That the decoder is constant-time.** It is not, and does not need to be:
  public keys are public. Nothing here handles a secret.
- **That the blob is a well-formed key of its declared type.** The parser reads
  the algorithm name and the length prefix; it does not parse the remaining
  fields, check curve parameters or validate an RSA modulus size. A blob that
  is correctly framed but cryptographically nonsense is accepted here and would
  be rejected by sshd at load time.
- **Anything about rendering, file permissions, or sshd behaviour.** No file is
  written by this task.

## ActiveForm

Adding the authorized-key list to the settings schema and the validator that
decides what may enter it.

## Dependencies

- **blocked by**: RFCT-021 (settings schema v3)
- **blocks**: the sshd reconciler (renders `authorizedKeys` into
  `authorized_keys` and must re-validate before writing), webd's key-management
  UI (validates operator input with `parse_authorized_key`), and the image
  profile change that turns SSH off by default
