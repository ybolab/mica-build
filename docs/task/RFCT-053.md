# RFCT-053 sshd reconciler: render authorized keys for every managed login account

- **status**: implementation complete — `bash mosd/hack/check.sh` green, 305
  tests; no on-device sshd behaviour is claimed
- **priority**: P1
- **owner**: ai-agent
- **createdAt**: 2026-08-19 12:40
- **claimedAt**: 2026-08-19 12:40
- **completedAt**: 2026-08-19 13:35

Campaign `l1-o7ee8v0o-20260819093920-sshweb`. Branch `bkd/1r0v0l3m`, merged by
L2 into `bkd/hiu25adw`.

## Description

RFCT-034 made the sshd reconciler render `access.ssh.authorizedKeys` to a single
file, `/etc/ssh/authorized_keys.d/root`. The static drop-in it pairs with,
`05-mos-authorized-keys.conf`, sets

```
AuthorizedKeysFile /etc/ssh/authorized_keys.d/%u
```

and sshd expands `%u` to **the login user**, not to root. That agreed with the
render only because root was the sole account that could log in.

RFCT-039 (sibling, in parallel) adds a `mos` system account with a persistent
home. The moment it lands, sshd authenticating `mos` looks for
`/etc/ssh/authorized_keys.d/mos`, mosd renders no such file, and key login as
`mos` does not work. Nothing errors and nothing logs a mismatch: the operator
simply cannot log in and has no way to see why. This task closes that.

## Design

### One key set, rendered for every managed login account

Keys stay **non-per-user in the settings tree**. `access.ssh.authorizedKeys` is
one list, and it is rendered — byte-identical — to a file for each account mosd
manages. Making keys per-user would be a schema change, a webd change and a
migration, for a device with one operator.

The consequence is stated plainly rather than left implicit: **every authorized
key is a root key.** It is also a `mos` key. There is no key an operator can add
that grants the lesser of the two. The web UI already says this.

### The account list is a constant, not a scan of `/etc/passwd`

```rust
const MANAGED_LOGIN_ACCOUNTS: [&str; 2] = ["root", "mos"];
```

Scanning the passwd database would silently start granting key access to any
account a future package happens to add — a privilege decision inherited from a
dependency rather than made in code review. Adding an account here is a diff
somebody has to approve, which is the whole point of the constant. The reasoning
is on the constant itself, not only here.

### Rendering for an account that does not exist is harmless, deliberately

`mos` may not exist on the image this code runs against: RFCT-039 adds it, and
the two tasks can merge in either order. There is **no existence check** against
`/etc/passwd`, and adding one would be a mistake in two ways:

- it would couple this reconciler to account state it does not own, and
- it would fail exactly in the merge window it is meant to protect — this task
  landing first would render nothing for `mos`, and nothing would re-render when
  the account appeared, because no setting would have changed.

A key file for an account that cannot log in is inert, not wrong. `%u` is
expanded from the user sshd is authenticating, so a file no login can name is
never opened. Proved by `a_key_file_renders_for_an_account_that_does_not_exist`,
which renders for an account name no system carries and first asserts that name
really is absent from the host's `/etc/passwd`.

`apply_authorized_keys` takes the account list as a parameter rather than
reading the constant directly, purely so that test can exist against a name that
provably does not resolve. The single production call site passes
`MANAGED_LOGIN_ACCOUNTS`.

### Path constant and env override: directory plus per-account file name

| before | after |
| --- | --- |
| `DEFAULT_AUTHORIZED_KEYS = "/etc/ssh/authorized_keys.d/root"` | `DEFAULT_AUTHORIZED_KEYS_DIR = "/etc/ssh/authorized_keys.d"` |
| `MOSD_AUTHORIZED_KEYS` (a file) | `MOSD_AUTHORIZED_KEYS_DIR` (a directory) |
| `SshdReconciler::new(.., authorized_keys_path, ..)` | `SshdReconciler::new(.., authorized_keys_dir, ..)` |

The file name inside the directory is the account name, which is precisely what
`%u` expands to, so the render and the drop-in agree by construction rather than
by coincidence.

**The env var is renamed, not reinterpreted.** Reusing `MOSD_AUTHORIZED_KEYS`
for a directory would take a stale value pointing at a file and render
`<that file>/root` — a silent change of meaning. Nothing in the image or in any
unit sets either name (checked: the only occurrences in the repo were this file
and the RFCT-034 record), so the rename costs nothing and makes the changed
meaning visible.

Mode, directory mode and the atomic writer are unchanged: `0600` per file,
`0755` on the directory when this reconciler creates it,
`transient::write_atomically` (temp file, `fsync`, `rename`). Directory creation
moved out of the per-file branch to before the loop, because more than one file
now needs it to exist.

### Ordering: validate once, render once, then write

The list is validated in `apply` before anything is opened — RFCT-034's rule,
unchanged — and the bytes are now rendered **once**, before the loop, so no
account can be written from a different list than another. A rejected list
therefore updates neither account, rather than updating `root` and leaving `mos`
holding stale keys.

### Published state: `authorizedKeysPath` -> `authorizedKeysPaths`

**This is a rename, and it is a cross-task contract change.** The old key was
singular for what is now plural; a single path could only ever name one of the
two files, so keeping the name and changing the value to a list would be a name
that lies. The new key is an array of every path written, in
`MANAGED_LOGIN_ACCOUNTS` order:

```json
"authorizedKeysPaths": [
  "/etc/ssh/authorized_keys.d/root",
  "/etc/ssh/authorized_keys.d/mos"
]
```

The account is the basename, so no information is lost relative to naming them
in a map.

`mosd/webd/src/routes.rs` does **not** read this key — it reads
`authorizedKeys` (the fingerprint list) and the three password flags. The only
other occurrence in the tree is a webd *test fixture*
(`mosd/webd/src/tests.rs`), which will carry a key that no longer exists in real
state until its owner updates it. That is stale fixture data, not a break, and
webd is outside this task's file scope so it was not touched.

## Testing

Seven new tests in `mosd/mosd/src/reconciler/sshd.rs`. No existing test was
weakened or deleted; the RFCT-034 goldens still hold against the `root` file
byte-for-byte, and four existing tests were **strengthened** to cover the second
account (`assert_bad_keys_leave_the_file_untouched`,
`every_path_the_reconciler_writes_stays_inside_the_tempdir`,
`published_state_carries_fingerprints_and_never_key_material`, and the
permissions test, renamed from `the_rendered_key_file_is_...` to
`every_rendered_key_file_is_0600_in_a_0755_directory` because it now checks
both).

| test | property |
| --- | --- |
| `one_key_list_renders_byte_identical_files_for_every_managed_account` | one list, two files, identical bytes |
| `only_the_managed_accounts_get_a_file` | the file set is exactly the constant — no more |
| `a_key_file_renders_for_an_account_that_does_not_exist` | render succeeds for a provably absent account |
| `an_empty_list_empties_every_account_file_without_deleting_any` | two empty files, not two deletions |
| `removing_one_key_of_three_rewrites_every_account_file_without_it` | a removal reaches every account in one reconcile |
| `a_validation_failure_updates_neither_account` | fail-loud with no partial application |
| `rendering_every_account_leaves_no_temporary_file_behind` | no `mosd-tmp` survives either write |

`a_validation_failure_updates_neither_account` uses a list whose **first** entry
is valid and whose second is not, so a renderer that wrote as it iterated would
have left the good prefix somewhere before failing.

### Mutation of the central guard

`apply_authorized_keys` was changed to skip every account but `root`
(`if *account != "root" { continue; }`) and the suite re-run with
`--no-fail-fast`. **11 tests failed**, 294 passed:

- `one_key_list_renders_byte_identical_files_for_every_managed_account`
- `only_the_managed_accounts_get_a_file`
- `a_key_file_renders_for_an_account_that_does_not_exist`
- `an_empty_list_empties_every_account_file_without_deleting_any`
- `removing_one_key_of_three_rewrites_every_account_file_without_it`
- `a_validation_failure_updates_neither_account`
- `every_rendered_key_file_is_0600_in_a_0755_directory`
- `a_newline_embedded_in_the_key_field_fails_and_changes_nothing`
- `a_comment_smuggled_into_the_key_field_fails_and_changes_nothing`
- `a_duplicate_key_pair_fails_and_changes_nothing`
- `each_control_character_in_a_comment_fails_and_changes_nothing`

The mutation was then reverted and the suite re-run clean.

Two tests that touch the plural property did **not** fail under the mutation,
and that is worth knowing rather than glossing:
`every_path_the_reconciler_writes_stays_inside_the_tempdir` and
`published_state_carries_fingerprints_and_never_key_material` assert on
`authorizedKeysPaths`, which is computed from the constant and not from what was
actually written. Published state is a claim about paths, not evidence that the
files exist. The eleven above are what holds the write.

## What is NOT proven

**Nothing here runs sshd.** No test authenticates, and no test observes sshd
expanding `%u`. That `AuthorizedKeysFile /etc/ssh/authorized_keys.d/%u` resolves
to the file this reconciler writes for the account being authenticated is read
off OpenSSH's documented behaviour and off the static drop-in's content; it is
not demonstrated. No hardware claim is made.

**The `mos` account is not proven to exist, or to be able to log in.** RFCT-039
owns that. This task proves only that a key file is rendered for it and that
rendering does not fail when the account is absent. A `mos` account that exists
but is `nologin`, or has no valid shell, would take these files and still not
grant a session — nothing here checks that, by design, since account shape is
not this reconciler's to own.

**Cross-file atomicity is NOT claimed.** Validation failure is fully prevented
from partially applying, because validation precedes every write, and that is
what the tests hold. An **I/O** failure part-way through the loop — the second
`write_atomically` failing after the first has renamed into place — would leave
`root` updated and `mos` stale, and the apply would return an error. Each file
is individually atomic; the pair is not. Making it so needs a two-phase commit
across two paths, which is out of proportion to a failure mode that means STATE
is already failing. The error names the path that failed.

**No verifier assertion.** Nothing in `os/verify-image-v2.sh` checks that mosd
renders two files; the verifiers assert the static drop-in's content, which is
unchanged by this task. A sibling owns the verifiers and the image, and no image
content changed here, so no image build was run.

**The webd fixture drift is unverified downstream.** `authorizedKeysPath` in
`mosd/webd/src/tests.rs` is stale after this rename. webd's production code
never read the key, so nothing should break, but that was established by reading
`routes.rs` — not by changing webd and watching its tests.

## ActiveForm

One validated key set rendered to `/etc/ssh/authorized_keys.d/<account>` for
every account in a constant list — `root` and `mos` — so the render matches what
`AuthorizedKeysFile %u` actually expands to; no `/etc/passwd` scan and no
account existence check, so a key file for an account that does not exist yet is
harmless rather than a merge-order failure; validation before the first write, so
a rejected list updates neither account; published state renamed from
`authorizedKeysPath` to a plural `authorizedKeysPaths`.

## Dependencies

- RFCT-034 (built the single-account render, the drop-in pairing, the atomic
  writer and the goldens this task preserves) — merged
- RFCT-036 (shipped `05-mos-authorized-keys.conf` into the image and the
  verifier assertion on its content) — merged
- RFCT-039 (adds the `mos` account) — sibling, may merge in either order; this
  task is deliberately correct under both orders
- RFCT-047 (reload rather than restart) — sibling; owns `apply_unit`, untouched
  here
