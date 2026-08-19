# RFCT-023 sshd gating reconciler - drop-in render, unit state and root password

- **status**: implementation complete
- **priority**: P1
- **owner**: ai-agent
- **createdAt**: 2026-08-19 00:23
- **claimedAt**: 2026-08-19 00:23
- **completedAt**: 2026-08-19 01:55

## Description

PLAN-010 M5 turns `access.ssh` from a settings subtree (RFCT-021) into an
actual SSH channel. This task is that reconciler, plus the shared systemd
unit-control executor the WiFi client and AP reconcilers will drive their own
units through, plus the write that makes the per-device password (RFCT-022)
the password the root account actually accepts.

Three system effects, applied in this order by `SshdReconciler::apply`:

1. `/etc/ssh/sshd_config.d/10-mos.conf` is rendered from `access.ssh`.
2. the device password is hashed with **bcrypt** and written into the root
   account's shadow entry.
3. `ssh.service` is brought to the state `access.ssh.enabled` asks for.

Credential before service start is deliberate. A running sshd whose root
account still carries the image's hash is precisely the failure the ordering
rules out, and it is a failure that looks green from the outside: the unit is
active, the config is on disk, and nobody can log in - or worse, everybody can
with the same fleet-wide secret.

### The drop-in

```
# Managed by mosd from access.ssh. Do not edit.
Port 22
PermitRootLogin yes
PasswordAuthentication yes
```

That is the byte-exact render of a default `access.ssh` and it is a golden
constant in the tests. `listenAddresses` appends one `ListenAddress <addr>`
line per entry, in tree order.

`/etc/ssh/sshd_config.d` is the one part of `/etc` this reconciler may write:
it is a STATE-backed bind mount (`etc-ssh.mount`), while the rest of `/etc`
sits on the dm-verity squashfs and is read-only. The path is a constructor
parameter, so every test runs inside a tempdir and the host's sshd is never
touched.

**Empty `listenAddresses` means listen on every address, so no
`ListenAddress` directive is emitted at all.** `docs/design/access.md` section
3 currently carries the comment `# empty = none`. That reading would hand an
operator who enables SSH without naming an address a running-but-unreachable
sshd, which is a silent failure; and closure is already expressed by
`enabled: false`, which is the layer section 5.1 exists for. This is an
explicit L2 ruling; the docs task amends the design document to match. The
"none" reading is not implemented.

The render is pure and deterministic, which is load-bearing rather than
tidiness: `apply` re-renders, compares against what is on disk, and skips the
write when the bytes match. The drop-in lives on STATE, so an unconditional
rewrite would cost a flash write on every reconcile.

### Unit state, and why enablement is runtime-scoped

`access.ssh.enabled` drives `ssh.service`: true -> enable then start, false ->
stop then disable.

`apply_unit` reads before it writes. It asks for the unit's `ActiveState` and
unit-file state and issues only the calls that change something, so a system
already in the target state gets no bus calls at all, and a repeated `apply` is
a genuine no-op rather than a stream of redundant jobs.

One case is not a no-op and must not be: when the drop-in changed and sshd is
already running, the unit is **restarted**. A rewritten configuration that
nothing re-reads is a configuration that silently did not take effect - change
`access.ssh.port` and the port would not move.

`EnableUnitFiles` is called with `runtime = true`, so the symlinks land in
`/run/systemd/system` rather than `/etc/systemd/system`. Persistent enablement
would need `/etc/systemd/system` to be writable, and on the v2 read-only root
it is not - `/etc/ssh/sshd_config.d` is the only writable part of `/etc`. A
persistent enable would therefore fail with EROFS on device while passing every
test on a normal filesystem: the M4 defect shape exactly. Runtime scope always
works, and mosd reconciles the whole settings tree at every start, so the unit
returns to its configured state on each boot without a persisted symlink. At
runtime `stop` is the authoritative disablement; `disable` keeps
`systemctl is-enabled` honest for the current boot.

### The shadow field carries bcrypt, not Argon2id

The first version of this task wrote `access.device.passwordHash` — an
Argon2id PHC string — straight into the shadow field, as specified. That was
wrong, and wrong in the campaign's signature way: it produced a device with
SSH enabled, a per-device password on the label, and no way to log in, while
every check here, both verifiers and the bundle stayed green.

L2 extracted libcrypt from the image base (`debian:bookworm-slim`, arm64) and
inspected it:

```
$ strings libcrypt.so.1.1.0 | grep -i argon2          -> no output
$ strings libcrypt.so.1.1.0 | grep -E '^\$[A-Za-z0-9]{1,9}\$'
  $2a$  $2b$  $2x$  $2y$  $gy$  $sha1$
$ strings libcrypt.so.1.1.0 | grep -E 'alg-|rounds='
  ../lib/alg-sha256.c  ../lib/alg-yescrypt-opt.c  ../lib/alg-gost3411-2012-hmac.c
```

bcrypt, yescrypt and the sha2crypt family are compiled in. Argon2 is absent
entirely. crypt(3) cannot parse `$argon2id$…`, so it rejects every password
offered against it.

A hash cannot be converted into another hash, so the fix is to hash the
**plaintext** a second time in a format the device can verify. The reconciler
reads it with `identity::read_device_password(state_dir)` and hashes it with
the pure-Rust `bcrypt` crate (0.19.3) at **cost 12** — a few hundred
milliseconds per verification on the target class of hardware, tolerable for
an interactive login and expensive against a stolen shadow file. bcrypt's
72-byte input limit is irrelevant for a 16-character generated password.
`cargo deny check licenses bans advisories` accepts the crate and its four new
transitive dependencies (`blowfish`, `cipher`, `inout`, `hybrid-array`, all
pure Rust), so the sha512crypt fallback was not needed.

**`access.device.passwordHash` is unchanged and stays exactly where it is.**
It remains the credential of record that mosd and webd verify against
themselves, where Argon2id is the right choice and libcrypt is not involved.
The settings schema is untouched. The two hashes are of the same secret, in two
formats, for two different verifiers — a test asserts the Argon2id string never
reaches the shadow file.

Idempotency needs care here that it did not need with Argon2id: bcrypt salts
every hash, so a freshly computed value never compares equal to the stored one.
"Already applied" therefore means `bcrypt::verify(plaintext, stored)` returns
true. Without that check every reconcile would rewrite the shadow file with a
new salt — a flash write per boot, and a live state that never settles.

`identity.rs` is called, never edited: the sibling provisioning task owns that
file.

### The root password write

`rewrite_root_hash` is a read-modify-write on the exact bytes of the shadow
file. It replaces field 1 of the `root:` line and nothing else: every other
account's line survives byte-for-byte, the root line's field count and ordering
are preserved, and a file with no trailing newline comes back without one. The
match is `starts_with("root:")`, not `contains`, so an account such as `chroot`
is not mistaken for it. The write is atomic (temp file in the same directory,
flushed, renamed) and restores the original file's mode **and uid/gid** - a
shadow file that comes back `root:root` instead of `root:shadow` locks out
every setgid tool that reads it.

Four outcomes, and keeping them apart is the point:

| `access.device.passwordHash` | plaintext on STATE | shadow file | outcome |
|---|---|---|---|
| set | present | `root:` present, stored hash does not verify | rewritten, live state `applied` |
| set | present | `root:` present, stored hash verifies | untouched, live state `unchanged` |
| set | **missing** | any | untouched, live state `plaintext-missing` + warning |
| **absent** | any | any | untouched, live state `absent` |
| set | present | **missing file** | **error** |
| set | present | present, no `root:` line | **error** |

Three of these are skips and none of them may be confused with another:

- `absent` is a device whose first boot has not provisioned itself. There is no
  credential yet; there is nothing to apply.
- `plaintext-missing` is a device that *is* provisioned but whose plaintext
  file is gone. This is a real state, not a defect: `identity::ensure_identity`
  deliberately never regenerates a credential whose hash is already present, so
  a STATE that lost only the plaintext keeps the hash forever. The operator's
  password still authenticates against `access.device.passwordHash` on the web
  UI; only the shadow entry cannot be refreshed. It is logged at warn level.
- a missing shadow file, or one without a root entry, means the image wiring is
  broken. That **errors**, before any unit call, so sshd is never started
  against a root account mosd could not set.

Reporting a broken image as a skip would be the M4 failure shape in its purest
form - everything green, no password on the device.

The shadow path is a constructor parameter. No test touches a real
`/etc/shadow`, and none can: on the v2 read-only root that file is on the
dm-verity squashfs.

### Two integration dependencies this task does not implement

1. **`/etc/shadow` must be writable.** Issue heca0kvp is making it a symlink
   into a STATE-backed directory. Until that lands, `apply_root_password`
   fails on device with EROFS. **mosd's unit must be ordered `After=` that
   reconcile oneshot**, otherwise mosd races it and the credential write hits
   the read-only squashfs file.
2. **The shadow hash format must be asserted by the image verifier, not
   here.** This task now writes bcrypt (`$2b$12$`), chosen from direct evidence
   in the shipped library. What the Rust tests prove is that the value written
   is well-formed bcrypt at the shipped cost and that the device password
   round-trips through `bcrypt::verify` - **not** that the device's PAM stack
   accepts it. They cannot prove that: the test host is x86 and the libcrypt in
   question ships inside an arm64 image. The assertion that the image's
   libcrypt actually implements the format in the root shadow field belongs to
   the image verifier and is assigned to the image L3.

## Scope

Owned here:

- `mosd/mosd/src/reconciler/systemd.rs` - the `UnitControl` trait, the
  `Systemd` production executor over the system bus, the `is_active` /
  `is_enabled` state predicates, and the recording `MockUnitControl`.
- `mosd/mosd/src/reconciler/sshd.rs` - `SshdReconciler`, the drop-in renderer,
  the shadow rewrite, the atomic writer, and 20 tests.
- `mosd/mosd/src/reconciler/mod.rs` - `mod` lines and registration in `all()`.
- `mosd/Cargo.toml`, `mosd/mosd/Cargo.toml`, `mosd/Cargo.lock` - the `bcrypt`
  dependency.
- `docs/task/RFCT-023.md`.

`UnitControl` is deliberately unit-name-generic - nothing sshd-specific is in
it - because the WiFi client and AP reconcilers drive
`wpa_supplicant@…`/`hostapd` through the same trait. `MockUnitControl` lives
next to it for the same reason: every reconciler that drives a unit needs the
same mock, and it models the state transitions its own calls cause, so a second
`apply` sees the world the first one left behind.

Not owned here and untouched: `mosd/mosd/src/identity.rs` (the sibling
provisioning task owns its `dead_code` allowance, and this reconciler does not
need it - the hash comes from the settings tree, not the identity module), the
`etc-ssh.mount` and shadow-symlink image work, the console shell reconciler,
and `docs/design/access.md`.

One new dependency, `bcrypt` 0.19.3, pulling in `blowfish`, `cipher`, `inout`,
`hybrid-array`, `byteorder`, `crypto-common` and `base64` - all pure Rust, all
accepted by `cargo deny`. `identity.rs` is called but not edited.

## Work checklist

- [x] R1 `UnitControl` with start / stop / restart / enable / disable and both
      state readers, unit-name-generic, plus `Systemd` and `MockUnitControl`
- [x] R2 drop-in rendered from `access.ssh`, path parameterised, written
      atomically, deterministic, golden-file tested
- [x] R2 empty `listenAddresses` emits no `ListenAddress` directive
- [x] R3 `enabled` drives enable+start / stop+disable, convergent and
      idempotent, restart when the config changed under a running sshd
- [x] R4 the shadow field carries bcrypt cost 12 derived from the plaintext,
      not the Argon2id credential; written read-modify-write, atomic, mode and
      ownership preserved, other accounts byte-for-byte intact
- [x] R4 missing file and missing `root:` line both error; absent hash and
      missing plaintext skip cleanly with distinct live-state values
- [x] R5 all 20 sshd tests and 3 systemd tests inside tempdirs, mocked unit
      control, no host sshd touched
- [x] 13 mutations run, each killed by the test that claims the property

## Verification (2026-08-19)

Command:

```
bash mosd/hack/check.sh
```

Final lines:

```
     Summary [  31.229s] 105 tests run: 105 passed, 0 skipped
advisories ok, bans ok, licenses ok
ALL CHECKS PASSED
```

105 tests, 105 passed, 0 skipped - `cargo fmt --check`, `cargo clippy
--workspace --all-targets --locked -D warnings`, `cargo nextest run
--workspace --locked` and `cargo deny check licenses bans advisories` all
clean. This task adds 28 of those tests (25 in `sshd`, 3 in `systemd`).

### What the tests prove, and what they cannot

They prove the drop-in is byte-exact, the unit convergence is minimal, the
shadow rewrite is surgical, and the value written into the root field is
well-formed bcrypt at the shipped cost that the device password round-trips
through `bcrypt::verify`.

They do **not** prove the device's PAM stack accepts it, and no test here can:
the test host is x86 and the libcrypt in question ships inside an arm64 image.
That property belongs to the image verifier. On-device behaviour is the user's
acceptance throughout.

### Every guard was mutation-tested

Each guard was removed or inverted, the reconciler suite re-run, and the
mutation reverted. All 19 were killed. `diff` against the pre-mutation copies
and `git status` confirm nothing survived.

| Mutation | Test that failed |
|---|---|
| M1 empty `listenAddresses` emits `ListenAddress 0.0.0.0` | `empty_listen_addresses_emit_no_listen_address_directive` (+3) |
| M2 unchanged-drop-in short circuit removed (always rewrite) | `reapplying_the_same_settings_changes_nothing`, `already_running_and_enabled_needs_no_calls` |
| M3 start issued without reading `ActiveState` | `already_running_and_enabled_needs_no_calls` (+2) |
| M4 no restart when the config changed under a running sshd | `changing_the_config_of_a_running_sshd_restarts_it` |
| M5 `root_hash` returns `Ok("")` instead of erroring | `root_hash_reads_the_root_entry_not_a_lookalike` |
| M6 missing shadow file read as empty instead of erroring | `a_missing_shadow_file_is_an_error` |
| M7 absent `passwordHash` errors instead of skipping cleanly | `absent_password_hash_skips_the_write_cleanly` |
| M8 shadow mode hardcoded 0600 instead of preserved | `shadow_rewrite_preserves_mode_and_ownership` |
| M9 shadow ownership not restored after rename | `shadow_rewrite_preserves_mode_and_ownership` |
| M10 root line matched by `contains` instead of `starts_with` | `rewrite_does_not_match_an_account_merely_containing_root` |
| M11 drop-in written 0666 instead of the fixed mode | `apply_writes_the_golden_drop_in_creating_its_directory` |
| M12 `is_active` always true | `already_stopped_and_disabled_needs_no_calls` (+4) |
| M13 `is_enabled` always true | `disabled_to_enabled_enables_then_starts` (+4) |
| M14 the Argon2id credential written into shadow instead of bcrypt | `shadow_gets_a_bcrypt_hash_that_verifies_against_the_plaintext` (+2) |
| M15 missing plaintext reported as `absent` | `a_credential_whose_plaintext_is_gone_skips_with_its_own_outcome` |
| M16 bcrypt cost lowered from the shipped 12 to 4 | `shadow_gets_a_bcrypt_hash_that_verifies_against_the_plaintext` |
| M17 stored hash never verified, so every reconcile re-salts | `an_already_applied_password_reports_unchanged`, `reapplying_the_same_settings_changes_nothing` |
| M18 stored hash always treated as matching | `a_stale_hash_of_a_different_password_is_replaced` (+2) |
| M19 both root-line guards made silent | `a_shadow_file_without_a_root_entry_is_an_error`, `root_hash_reads_the_root_entry_not_a_lookalike` |

M14 is the row this rework exists for: it restores the original defect - the
Argon2id string in the shadow field - and three tests now reject it. M16 proves
the cost assertion reads the shipped constant rather than a test-local copy.
M17 and M18 are the two halves of the bcrypt idempotency check: without M17's
guard the shadow file is rewritten with a fresh salt on every boot, and with
M18's inversion a password change would never reach the device.

M8 and M9 answer the earlier L3's warning about tautological mode assertions:
the test asserts the literal `0o640` against a fixture explicitly set to
`0o640`, while the atomic writer creates its temp file at whatever mode it is
handed - so hardcoding a mode kills the test rather than satisfying it. M9
asserts gid 12, handed to the fixture by a `chown` only root can perform,
falling back to an unchanged-gid assertion where that is not possible.

M4 and M12 catch the "component present, integration broken" class directly:
without them a port change would leave the old sshd running, and a converged
system would be issued jobs it does not need.

### What is asserted, beyond existence

- `apply_writes_the_golden_drop_in_creating_its_directory` compares the whole
  file against a golden constant and asserts mode 0644, not that a file exists.
- `shadow_gets_a_bcrypt_hash_that_verifies_against_the_plaintext` asserts the
  `$2b$12$` prefix, that the real password verifies, that a different password
  does **not**, and that the string `argon2` appears nowhere in the field.
- `shadow_rewrite_touches_nothing_but_the_root_hash` reconstructs the **entire**
  expected file from the one field that legitimately changed, so any edit to
  `daemon` or `operator` fails it.
- `reapplying_the_same_settings_changes_nothing` proves the skip-write path
  without relying on mtime: it chmods the drop-in to 0600 between the two
  applies and asserts it is still 0600, and asserts the shadow file is
  byte-identical across both - which, because bcrypt re-salts, only holds if
  the second apply really did not re-hash.
- `absent_password_hash_skips_the_write_cleanly` deliberately leaves the
  plaintext in place, so it asserts the not-provisioned path keys on the
  settings tree and cannot be satisfied by the plaintext-missing path.
- `a_credential_whose_plaintext_is_gone_skips_with_its_own_outcome` asserts the
  live state is `plaintext-missing` and explicitly `assert_ne!` against
  `absent`.
- `a_shadow_file_without_a_root_entry_is_an_error` and
  `a_missing_shadow_file_is_an_error` both also assert **no unit calls were
  made**, and the missing-file case asserts the file was not created from
  nothing.
- `every_path_the_reconciler_writes_stays_inside_the_tempdir` asserts all three
  paths are under the tempdir and that the live-state `dropIn` is not the
  system default.

## ActiveForm

Reconciling `access.ssh` into sshd configuration, `ssh.service` state and the
root account's password.

## Dependencies

- **blocked by**: RFCT-021 (schema v3 `access.ssh` / `access.device`),
  RFCT-022 (`identity::read_device_password`, the plaintext this hashes)
- **blocks**: the WiFi client and AP reconcilers, which drive their units
  through this task's `UnitControl`
- **requires, outside this task**: `/etc/shadow` made writable via STATE
  (issue heca0kvp) with mosd ordered `After=` that oneshot; `etc-ssh.mount`
  for the drop-in directory; an image verifier assertion that the shipped
  libcrypt implements the crypt format in the root shadow field (`$2b$`),
  assigned to the image L3
