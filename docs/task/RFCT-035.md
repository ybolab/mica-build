# RFCT-035 webd SSH pane: keys, transient password, effective state

- **status**: implementation complete — `bash mosd/hack/check.sh` green; no
  on-device SSH behaviour is claimed
- **priority**: P1
- **owner**: ai-agent
- **createdAt**: 2026-08-19 09:39
- **claimedAt**: 2026-08-19 09:39
- **completedAt**: 2026-08-19 11:10

Campaign `l1-o7ee8v0o-20260819093920-sshweb`. Branch `bkd/1ofugc37`, merged by
L2 into `bkd/hiu25adw`.

## Description

Fourth seam of the SSH access campaign, and the operator-facing one. RFCT-032
put `access.ssh.authorizedKeys` into the settings tree with a validating parser,
RFCT-033 made the root password transient, and RFCT-034 made both reach sshd.
None of them gave an operator a way to use any of it: adding a key still meant
hand-editing a TOML file on STATE, and setting a transient password still meant
a D-Bus call by hand.

This task adds the webd pane that reaches all of it — the SSH toggle, the
authorized-key list, and the transient root password — behind the existing auth
gate.

Sibling L3s own the image profile defaults and the verifiers. None of those is
touched here; neither is `mosd/mosd/**` or `mosd/mosd-settings/**`.

## Design

### Route table

| method | path | effect |
| --- | --- | --- |
| GET | `/ssh` | render the pane; writes nothing |
| POST | `/ssh/enable` | write `access.ssh.enabled` from the checkbox |
| POST | `/ssh/password` | set a transient root password through mosd |
| POST | `/ssh/keys/add` | parse, validate and append one authorized key |
| POST | `/ssh/keys/remove` | remove one key by fingerprint or exact key text |

All five sit inside the existing `gate` middleware, so an unauthenticated
request is redirected before any handler runs.

**The four mutating routes are POST-only**, in the same shape the power actions
already use: no GET handler is registered for any of them, so axum answers 405
rather than dispatching. This is not decoration. A GET is what a browser
prefetches, what a crawler follows, and what a mis-clicked link or an `<img>`
tag issues — and three of these four routes hand out or withdraw root access.
The GET direction is asserted per route, and the assertion covers both halves:
the 405, and that neither `set_settings` nor the transient-password call was
made. A query string carrying the form body is asserted not to help either.

**Unauthenticated access is asserted route by route**, not once against "the
gate exists". Each of the five paths is driven three ways — no cookie, a forged
cookie, and setup mode — and each is asserted to redirect *and* to have written
nothing. A gate that stopped covering one route would otherwise pass.

### The transient password never enters the settings tree

`SettingsApi` gains `set_transient_root_password`, implemented by `BusSettings`
against the `SetTransientRootPassword` member of `com.mos.mosd1`, following the
existing proxy pattern including dropping the cached proxy on error. The handler
reads the password out of the form, checks it, hands it to mosd, and drops it.
Nothing is written at any settings path and nothing is logged.

`FakeSettings` records **how many times** it was called and never the password.
That is deliberate: a fake that stored the password would let a test assert
"the right password arrived" and pass while the real path leaks it somewhere
else. With nothing to compare against, the tests assert the only two things that
are true statements about secrecy — the settings tree stayed empty of writes,
and the password string appears nowhere in the tree afterwards.

The confirmation step matches `power_form_markup`/`confirm_token`: a required
checkbox whose value is the exact token the handler insists on, so the submit
button alone cannot set a root password. A missing, empty, or wrong token — the
power actions' own tokens included — is rejected.

### The 72-byte cap, and why it is not arbitrary

`MIN_TRANSIENT_PASSWORD_BYTES = 8`, `MAX_TRANSIENT_PASSWORD_BYTES = 72`.

mosd's own bound is 256 bytes, so this is deliberately the stricter of the two.
The transient password is hashed with bcrypt, and **bcrypt reads only the first
72 bytes of its input and silently ignores the rest**. Accepting a
100-character password would therefore mean the first 72 characters of it also
unlock the device: the operator would be defended by a shorter secret than the
one they typed and believe in, with nothing on screen saying so. Refusing the
input is the only way the pane avoids manufacturing that surprise — truncating
silently would be the same surprise with a different author.

Both boundaries are tested in both directions: 7 rejected / 8 accepted, 72
accepted / 73 rejected, plus a count assertion that exactly the accepted
lengths reached mosd. `\0`, `\n` and `\r` are rejected, and no error message
echoes the password.

### Keys go through the shared parser, never around it

`mosd/webd/Cargo.toml` gains the `mosd-settings` path dependency (the only
dependency added) so `parse_authorized_key` and `validate_authorized_keys` are
the same code mosd runs. No validation is reimplemented here. The submitted line
is handed to the parser **untrimmed**: a leading or trailing space is one of the
things that parser exists to reject, and trimming in webd would accept a line
mosd would not. The parser's own message is surfaced, without the dot-path
prefix its `Display` adds, since the operator is looking at a form field.

Hostile input is tested one character per case — `\0`, `\n`, `\r`, `\t`,
`\x7f`, a leading space, and a double space between the fields — each rejected
with nothing written. The other direction is tested too: a valid key whose
comment holds `$`, `` ` ``, `;`, `"` and `\` is **accepted**, because the
comment reaches a file sshd reads, not a shell, and refusing it would refuse
labels operators really write while buying nothing.

### Removal is by fingerprint, never by index

`POST /ssh/keys/remove` takes an `identifier` and matches it against each
entry's fingerprint or its exact canonical key text. **A list index is not
accepted.** An index is only meaningful against the list the operator was
looking at, so a key added or removed by another session between the render and
the submit slides it onto a different key and deletes something nobody asked to
delete. A fingerprint names one key wherever it has moved to.

**An identifier matching nothing is an error, not a silent success.** "Removed"
when nothing was removed is how an operator ends up believing access was
withdrawn while the key still grants root. Four non-matching identifiers are
tested, including the empty string and `"0"` — the index that would have worked
under the rejected design.

The pane renders fingerprints, so a removal has to be addressed by one, so webd
has to be able to compute one. `ssh_fingerprint` recomputes it (`SHA256:` plus
unpadded base64 of the SHA-256 of the decoded blob, using the already-present
`sha2`) rather than reading mosd's published list, because the published list
carries fingerprints with no handle back to the stored entry a removal must
rewrite. The duplication is pinned rather than assumed: the three fingerprints
in the tests came out of `ssh-keygen -lf`, and one test asserts the pane renders
that value *and* that a removal addressed by it succeeds. A fingerprint function
checked only against itself would prove nothing.

For the same reason the key list is rendered from the **settings** tree rather
than from the published state: what the operator sees is then exactly the list a
removal acts on. The published state supplies the three status flags instead.

### What the pane says

- SSH enabled state, from settings.
- Effective `PasswordAuthentication` and whether a transient password is
  active, from the published state; `unknown` rather than a bare `no` when mosd
  has published nothing yet, because the two mean different things.
- **When the operator asked for password authentication but none is in force**
  (`passwordAuthenticationRequested` true, `passwordAuthentication` false), the
  pane explains why instead of showing a bare `no`. Tested in all three
  directions: the explanation appears when suppressed, and is asserted *absent*
  when password auth was never requested and when it is actually in force — in
  both of those it would be a false account of why.
- The key list as **fingerprints and comments only**. A test asserts each key's
  base64 blob does not appear in the page.
- The transient-password form states that the password **lasts until the next
  reboot**, asserted.

**"Every authorized key is a root key."** `AuthorizedKeysFile` is `%u`-expanded
over one shared key list, so a key added here logs in as root. An operator who
adds a colleague's key expecting an unprivileged shell would be granting root,
and a pane that stays silent manufactures exactly that misunderstanding. This is
a correctness requirement, not a wording preference. It is asserted by
`ssh_pane_states_that_every_authorized_key_is_a_root_key` in
`mosd/webd/src/tests.rs`, against a **literal** rather than against the
`ROOT_KEY_NOTICE` constant the pane renders, so rewording the constant fails the
test rather than passing it.

### Failure handling

A failure to read `access.ssh` is fatal to the pane; a failure to read the live
state is not, since the settings half and the key list are still worth showing
and mosd may simply not have reconciled yet. A stored key list that is *present
and unreadable* is an error rather than an empty list: treating it as empty
would let an add or a remove silently overwrite keys the operator cannot see.

Existing style was matched (`shell`, `page`, `pane`, `error_box`,
`saved_banner`, `?saved=1`); nothing was restyled and no existing handler was
touched. `Cargo.lock` changed because the new path dependency requires it.

## Testing

18 new tests: 17 in `mosd/webd/src/tests.rs`, plus the SSH section added to the
existing `mosd/webd/tests/e2e.rs` flow. No existing test was weakened or
deleted.

The e2e half runs webd and a real mosd over a private session bus and proves the
things the route tests cannot: that `SetTransientRootPassword` exists on the
interface under that name, that mosd's typed settings tree accepts the key list
webd writes, and that the pane's fingerprint round-trips through a real removal.
It also asserts that setting a transient password changed **no** setting and
that the password is absent from the whole tree afterwards.

`MOSD_SHADOW_PATH` is set on the mosd child there and is a hard safety
requirement, alongside `MOSD_DRY_RUN`: without it, setting a transient password
would rewrite the host's `/etc/shadow`. The test asserts that the temporary
shadow file is the one that gained a bcrypt hash and that the host's file's
mtime is unchanged, so a spawn that lost the variable fails loudly.

**Four guards were mutation-tested rather than assumed:**

| mutation | result |
| --- | --- |
| `MAX_TRANSIENT_PASSWORD_BYTES` 72 → 73 | boundary test fails |
| `parse_authorized_key(&form.key)` → `form.key.trim()` | hostile-input test fails |
| remove by fingerprint → remove by list index | both removal tests fail |
| reword `ROOT_KEY_NOTICE` | root-key test fails |

None of the four is vacuous.

### Check results

| check | before | after |
| --- | --- | --- |
| `bash mosd/hack/check.sh` | ALL CHECKS PASSED, 276 tests | ALL CHECKS PASSED, 294 tests |

## What is NOT proven

- **No hardware claim is made. Nothing here proves an operator can actually
  SSH in.** No test runs sshd, authenticates, or logs in. What is proven stops
  at the settings tree and the D-Bus boundary: the key webd writes is the key
  mosd's schema accepts, and the transient password reaches mosd's shadow file.
  Whether sshd then admits that key on a real device remains the user's
  acceptance.
- **That every key really is a root key is asserted as copy, not as behaviour.**
  It is true because of `AuthorizedKeysFile /etc/ssh/authorized_keys.d/%u`,
  which lives in an image overlay this task does not touch and no test here
  reads. If a later change made keys non-root, this pane would keep saying they
  are and no test would notice.
- **The 72-byte cap is not proven against bcrypt.** No test hashes a 73-byte
  password and shows the 73rd byte is ignored; the cap is enforced and tested as
  a bound, and the reason for its value is documented reasoning about bcrypt,
  not a measurement. webd is also now stricter than mosd here (72 against 256),
  so a caller reaching mosd by another route is not held to this bound.
- **"Never logged" is asserted by construction, not by capturing output.** No
  test drives a tracing subscriber and greps its output; what is asserted is
  that no branch in the password path formats the password into a message, and
  that the settings tree never holds it.
- **Concurrency is reasoned about, not exercised.** Removal by fingerprint is
  what makes a concurrent list change safe rather than merely unlikely, but no
  test runs two overlapping submissions. The read-modify-write of the key list
  is also not atomic: two adds racing through mosd could lose one, which is a
  property of `SetSettings`, not of this pane.
- **The unfingerprintable-key path is not exercised end to end.** An entry whose
  blob does not decode renders without a Remove button; nothing that goes
  through this pane can produce one, so only the branch exists, not a test that
  reaches it.

## ActiveForm

Giving the operator a pane for SSH keys, the transient password, and what sshd
is actually doing.

## Dependencies

- **blocked by**: RFCT-032 (`authorizedKeys` and the parser), RFCT-033
  (`SetTransientRootPassword`), RFCT-034 (the published `authorizedKeys`,
  `transientPasswordActive` and `passwordAuthenticationRequested` state keys
  this pane reads)
- **blocks**: nothing in this campaign
