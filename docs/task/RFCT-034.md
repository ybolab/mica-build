# RFCT-034 sshd reconciler: authorized keys, AuthorizedKeysFile, password gating

- **status**: completed — implementation complete, `bash mosd/hack/check.sh` and
  `make os-shadow-test` both green; on-device sshd behaviour is NOT claimed
- **priority**: P1
- **owner**: (bkd campaign)
- **createdAt**: 2026-08-19 09:39
- **claimedAt**: 2026-08-19 09:39
- **completedAt**: 2026-08-19 11:20

Campaign `l1-o7ee8v0o-20260819093920-sshweb`. Branch `bkd/5sgswiog`, merged by
L2 into `bkd/hiu25adw`.

## Description

Third seam of the SSH access campaign. RFCT-032 put `access.ssh.authorizedKeys`
into the settings tree and wrote the parser; RFCT-033 made the operator-set root
password transient and removed the M5 device-password write to `/etc/shadow`.
Neither of them made any of it reach sshd.

This task does that: the reconciler renders the authorized-keys file, the image
ships the drop-in that points sshd at it, and `PasswordAuthentication` is gated
on whether a transient password is actually active.

Sibling L3s own the image profile default flip, the verifiers, and the webd
surface. None of those is touched here.

## Design

### The authorized-keys file

| property | value |
| --- | --- |
| path | `/etc/ssh/authorized_keys.d/root` |
| test override | `MOSD_AUTHORIZED_KEYS` |
| mode | `0600`; parent directory `0755` when this reconciler creates it |
| content | one entry per line, `<key>` or `<key> <comment>`, settings order |
| write | `transient::write_atomically` — temp file, `fsync`, `rename` |

**Why `/etc/ssh` and not `/root/.ssh`.** `/etc/ssh` is a STATE-backed bind mount
on the v2 image: `etc-ssh.mount` binds `/mnt/state/ssh` over it, which is how the
sshd host keys already survive an A/B update. `/root` is on the ephemeral
filesystem, so a key written there would be gone at the next boot — which is
precisely what "persistent access" must not mean. The path choice is the whole
reason this works, so it is stated in a comment on `DEFAULT_AUTHORIZED_KEYS`
rather than left to be rediscovered.

**An empty list renders an empty file.** It does not delete the file. A key the
operator removed has to stop working immediately, and "absent" versus "empty" is
a distinction sshd does not need to make. Deleting would also add a second code
path that has to be got right.

**The write is atomic** because sshd reads this file on every authentication
attempt, concurrently with mosd rewriting it. A partially written file is a file
in which the operator's key is briefly absent.

### Re-validation before rendering

`apply` calls `mosd_settings::validate_authorized_keys` as its first statement,
before anything is written. The settings file lives on STATE and is editable by
anything that can write STATE, so the parser is the security boundary and this is
the second place it has to hold — RFCT-032's own module doc makes the same
argument for why the validator re-parses stored text rather than trusting it.

**On failure the whole apply fails and every rendered file is left byte-identical
to what it was.** The alternative — skip the bad entry, render the rest — was
rejected: it leaves the operator looking at a key in the UI that grants nothing,
which is a worse failure than a loud one because it is invisible. Placing the
call before any write is what makes "untouched" true rather than merely likely,
and a mutation test confirmed it (see *Testing*).

### The static drop-in

`os/rootfs/overlay-v2/etc/ssh/sshd_config.d/05-mos-authorized-keys.conf`:

```
AuthorizedKeysFile /etc/ssh/authorized_keys.d/%u
```

Three decisions recorded in that file's own header, because each is the sort of
thing a later reader undoes:

- **It is static, not rendered by mosd.** So the image verifier can assert it
  byte-for-byte, and so it exists before mosd has ever run. `mos-seed-state`
  copies `/etc/ssh/.` onto STATE on first boot (`cp -a /etc/ssh/. /mnt/state/ssh/`),
  so it lands inside the bind and survives an update along with the host keys.
  It needs no Dockerfile change: `Dockerfile.v2` copies the whole overlay tree.
- **It is numbered `05`, ahead of mosd's rendered `10-mos.conf`.** sshd keeps the
  FIRST value it obtains for a non-repeatable keyword and reads `sshd_config.d`
  in lexical order, so a later drop-in cannot override it. The consequence is
  binding: mosd must NOT also emit `AuthorizedKeysFile` in `10-mos.conf`, or the
  emitted copy is dead text that reads as authoritative. It does not, and a test
  asserts it does not.
- **Setting this replaces the defaults** (`.ssh/authorized_keys` and
  `.ssh/authorized_keys2`), which is intended rather than a side effect. The
  managed file becomes the single source of authorised keys, so a key dropped
  into `/root/.ssh` by some other path does not silently grant access.

### PasswordAuthentication gating

```
effective = access.ssh.passwordAuthentication && transient_password_active(shadow_path)
```

Root ships locked and stays locked unless a transient password is active, so
offering password authentication at any other time advertises an authentication
method that cannot succeed. The campaign brief was willing to accept this as a
residual; it is closed instead, since the predicate was already sitting in
`transient` waiting for a caller.

`PermitRootLogin` is untouched. Key login requires it, and it is already
operator-controlled.

**The bookkeeping that makes the flip take effect.** Setting a transient password
changes no setting at all, so a reconcile comparing settings would leave sshd
refusing passwords until some unrelated change came along. `apply_drop_in`
compares the **rendered bytes** against what is on disk, not settings against
settings, so RFCT-033's `SetTransientRootPassword` → `apply_all()` path flips the
drop-in and restarts sshd. `render_drop_in` takes the effective value as a
parameter rather than reading the marker itself, which keeps it a pure function
of its inputs and therefore comparable byte-for-byte in a test.

**Only the drop-in restarts sshd.** A key added or removed does not, and this is
deliberate: sshd re-reads the authorized-keys file on every authentication
attempt, so a key change takes effect without touching the unit — while
restarting would drop the live session of the operator who just added the key.
The discarded return value of `apply_authorized_keys` carries a comment saying so.

### Published state

Added to what the reconciler publishes:

| key | value |
| --- | --- |
| `authorizedKeysPath` | the rendered path |
| `authorizedKeys` | `[{fingerprint, comment}]` in render order |
| `transientPasswordActive` | the gating input |
| `passwordAuthenticationRequested` | the RAW setting |

`passwordAuthentication` keeps its name and becomes the **effective** value —
what sshd was actually told. `passwordAuthenticationRequested` is what the
operator asked for, so the UI can explain why the two differ. Two similarly
named keys is exactly the sort of thing a later reader gets backwards, so the
distinction is commented at the point where both are computed.

`authorizedKeys` carries **fingerprints, never key material**. The state tree is
served over D-Bus and read by webd; a fingerprint is what an operator needs in
order to recognise a key, and the key blob is not. The fingerprint is the
standard OpenSSH form — `SHA256:` plus the unpadded base64 of the SHA-256 digest
of the decoded blob — computed with `ring::digest` (already a dependency; no new
crate). `fingerprint` returns `Option` and publishes `null` on a blob that does
not decode, because publishing state must not fail a reconcile that already
succeeded.

### Housekeeping (forced by the change)

`sshd.rs` and `transient.rs` both defined `DEFAULT_SHADOW` and `SHADOW_ENV`.
RFCT-033 left the pair duplicated with a note; the copies in `sshd.rs` are now
gone and `production()` calls `transient::production_shadow_path()`. Two
constants naming one env var drift, and these two in particular have to agree
about which file the marker sits beside.

The two now-stale `#[allow(dead_code)]` attributes are deleted: on
`SshdReconciler::shadow_path` and on `transient::transient_password_active`, each
of which named this task as its future consumer. Both are genuinely consumed now
and neither attribute is still needed. (The `transient.rs` deletion is a
one-line attribute removal — outside this task's original file scope, added by
explicit follow-up instruction.)

No other refactor was made.

## Testing

26 new tests, all in `mosd/mosd/src/reconciler/sshd.rs`. No existing test was
weakened or deleted.

- **Golden renders** — empty list, one key without a comment, one key with a
  comment, three keys mixing both, plus a determinism test.
- **Real keys, closing RFCT-032's stated gap.** RFCT-032 could not prove genuine
  `ssh-keygen` output round-trips because its spec forbade pasting key material.
  There is a rendered file to compare against here, so it is proved here: one
  real Ed25519 key, one real RSA-2048 key and a second Ed25519 key are committed
  as constants, and each is asserted to parse, canonicalise, render, and come
  back **byte-identical to the original `ssh-keygen` line**. The keys were
  generated for this test and correspond to no device; public keys are not
  secrets and the private halves were discarded at generation.
  Additionally a key is generated **at test time** when `ssh-keygen` is on the
  host and put through the same round-trip, so the committed constants cannot
  quietly drift from what OpenSSH emits. When the binary is absent that half
  returns early and the committed-constant half still runs — the test never
  silently becomes a no-op.
- **Fingerprints** are compared against the values `ssh-keygen -lf` printed for
  those same three keys, committed as constants with a comment saying where they
  came from. A fingerprint function tested only against itself proves nothing.
  The negative direction is covered too: a key with no blob, and one whose blob
  is not base64, both yield `None`.
- **Validation failure path**, each asserting the file is byte-identical after
  the failed apply: an embedded `\n` in the `key` field, a comment smuggled into
  `key`, and a duplicate pair. Plus the error naming the offending index, and the
  positive direction — a valid list renders and *overwrites* rather than appends.
- **Per-character hostile input** in the comment of an `AuthorizedKey` built
  directly, bypassing the parser as a corrupted settings file would: `\0`, `\n`,
  `\r`, `\t`, `\x7f`, one case each, all failing and leaving the file untouched.
  The other direction: a comment holding `$`, `` ` ``, `\`, `"` and `;` renders
  **verbatim** and succeeds. The file is read by sshd, not by a shell, and a
  guard that rejected those would refuse comments operators really write.
- **Gating** in all three combinations — no marker → `no`; marker → `yes`;
  setting false with a marker present → `no` (the AND, not an OR) — plus an empty
  marker not counting as active, and the end-to-end flip: apply, create the
  marker with no settings change, apply again, and assert both the flipped byte
  and `restart ssh.service`.
- **Published state** — every new key present with its expected value, and the
  serialised state asserted NOT to contain either key blob.
- **Permissions** — file `0600`, directory `0755`, no temporary file left behind,
  and an unchanged key list not rewritten (proved by the mode-marker trick the
  existing drop-in test uses).

**Both guards were mutation-tested rather than assumed.** Moving the validation
call to after the render fails
`a_comment_smuggled_into_the_key_field_fails_and_changes_nothing`; changing the
gating `&&` to `||` fails seven tests. Neither guard is vacuous.

Four existing tests changed expectation, none weakened: the goldens they assert
now carry `PasswordAuthentication no` because the fixture writes no transient
marker. That is the behaviour change this task exists to make, and the original
`GOLDEN_DEFAULTS` survives as the pure-renderer golden with the effective value
passed explicitly.

### Check results

| check | before | after |
| --- | --- | --- |
| `bash mosd/hack/check.sh` | ALL CHECKS PASSED, 250 tests | ALL CHECKS PASSED, 276 tests |
| `make os-shadow-test` | 117 passed, 0 failed | 117 passed, 0 failed |

## What is NOT proven

- **No hardware claim is made.** Nothing here proves that sshd on the device
  actually accepts a key login. No test runs sshd, parses `sshd_config.d`, or
  authenticates. What is proven is that the rendered file is byte-identical to
  what `ssh-keygen` produced, at the mode and path sshd is configured to read.
  On-device key login remains the user's acceptance.
- **The drop-in ordering rule is asserted by reasoning, not by sshd.** That sshd
  keeps the first `AuthorizedKeysFile` it sees and reads the directory in lexical
  order is OpenSSH documented behaviour; no test in this repo runs `sshd -T` to
  confirm it. What is tested is the half within reach: that `10-mos.conf` never
  emits the keyword at all, so the ordering rule is not being relied on to
  resolve a conflict in the first place.
- **`05-mos-authorized-keys.conf` reaching the image is not asserted here.**
  `Dockerfile.v2` copies the whole overlay tree, so it needs no change, but the
  image verifier is owned by a sibling L3 and was not touched. Until that lands,
  nothing fails if the file is deleted from the overlay.
- **The seed-state copy is not exercised.** That `cp -a /etc/ssh/.` puts the
  drop-in on STATE is read from the script, not run.
- **Directory mode is only asserted on the path this reconciler creates it.** An
  existing directory with wrong permissions is left alone rather than corrected;
  rewriting metadata on every reconcile costs a flash write, and on the real
  image the directory is created by this code or not at all.
- **webd does not read the new state keys yet.** Only the reconciler publishes
  them; the UI that explains effective-vs-requested is a sibling task.

## ActiveForm

Making authorized keys and the transient-password gate reach sshd.

## Dependencies

- **blocked by**: RFCT-032 (`authorizedKeys` in the settings tree, the parser and
  base64 codec), RFCT-033 (`transient_password_active`, `write_atomically`, the
  shadow-path helpers)
- **blocks**: the webd surface that adds and lists keys, which consumes
  `authorizedKeys` and `passwordAuthenticationRequested` from the published state
