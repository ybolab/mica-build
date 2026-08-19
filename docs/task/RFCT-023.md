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
2. `access.device.passwordHash` is written into the root account's shadow
   entry.
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

Three outcomes, and keeping them apart is the point:

| `access.device.passwordHash` | shadow file | outcome |
|---|---|---|
| set, differs from stored | present with `root:` | rewritten, live state `applied` |
| set, already stored | present with `root:` | untouched, live state `unchanged` |
| absent | present with `root:` | untouched, live state `absent` |
| set | missing | **error** |
| set | present, no `root:` line | **error** |

An absent hash is a device whose first boot has not provisioned itself yet:
there is nothing to apply, so the root entry is left alone and the rest of the
reconcile continues. A missing shadow file or a shadow file without a root
entry means the image wiring is broken, and that errors out before sshd is
started. Reporting the second case as the first would be the M4 failure shape
in its purest form - everything green, no password on the device.

The shadow path is a constructor parameter. No test touches a real
`/etc/shadow`, and none can: on the v2 read-only root that file is on the
dm-verity squashfs.

### Two integration dependencies this task does not implement

1. **`/etc/shadow` must be writable.** Issue heca0kvp is making it a symlink
   into a STATE-backed directory. Until that lands, `apply_root_password`
   fails on device with EROFS. **mosd's unit must be ordered `After=` that
   reconcile oneshot**, otherwise mosd races it and the credential write hits
   the read-only squashfs file.
2. **The shadow hash format.** `access.device.passwordHash` is an Argon2id PHC
   string (RFCT-022), and this reconciler writes it into the shadow field
   verbatim as the spec requires. Whether the login stack accepts it depends on
   the image's libxcrypt being built with Argon2 support, which is not the
   default in most distributions - glibc's own `crypt` has none at all. If it
   is not, the hash is written, every check here still passes, and no password
   works on the device: the M4 shape again, one layer down. The image side has
   to either enable Argon2 in libxcrypt or supply a second, crypt(3)-native
   hash for the shadow field. **Flagged for L2; not resolvable inside this
   task's file scope.**

## Scope

Owned here:

- `mosd/mosd/src/reconciler/systemd.rs` - the `UnitControl` trait, the
  `Systemd` production executor over the system bus, the `is_active` /
  `is_enabled` state predicates, and the recording `MockUnitControl`.
- `mosd/mosd/src/reconciler/sshd.rs` - `SshdReconciler`, the drop-in renderer,
  the shadow rewrite, the atomic writer, and 20 tests.
- `mosd/mosd/src/reconciler/mod.rs` - `mod` lines and registration in `all()`.
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

No new dependency; `mosd/Cargo.lock` is unchanged.

## Work checklist

- [x] R1 `UnitControl` with start / stop / restart / enable / disable and both
      state readers, unit-name-generic, plus `Systemd` and `MockUnitControl`
- [x] R2 drop-in rendered from `access.ssh`, path parameterised, written
      atomically, deterministic, golden-file tested
- [x] R2 empty `listenAddresses` emits no `ListenAddress` directive
- [x] R3 `enabled` drives enable+start / stop+disable, convergent and
      idempotent, restart when the config changed under a running sshd
- [x] R4 root hash written into the shadow file: read-modify-write, atomic,
      mode and ownership preserved, other accounts byte-for-byte intact
- [x] R4 missing file and missing `root:` line both error; absent hash skips
      cleanly and says so in live state
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
     Summary [  19.237s] 100 tests run: 100 passed, 0 skipped
advisories ok, bans ok, licenses ok
ALL CHECKS PASSED
```

100 tests, 100 passed, 0 skipped - `cargo fmt --check`, `cargo clippy
--workspace --all-targets --locked -D warnings`, `cargo nextest run
--workspace --locked` and `cargo deny check licenses bans advisories` all
clean. This task adds 23 of those tests (20 in `sshd`, 3 in `systemd`).

### Every guard was mutation-tested

Each guard was removed or inverted, the reconciler suite re-run, and the
mutation reverted. All 13 were killed. `diff` against the pre-mutation copies
and `git status` confirm nothing survived.

| Mutation | Test that failed |
|---|---|
| M1 empty `listenAddresses` emits `ListenAddress 0.0.0.0` | `empty_listen_addresses_emit_no_listen_address_directive` (+3) |
| M2 unchanged-drop-in short circuit removed (always rewrite) | `reapplying_the_same_settings_changes_nothing`, `already_running_and_enabled_needs_no_calls` |
| M3 start issued without reading `ActiveState` | `already_running_and_enabled_needs_no_calls` (+2) |
| M4 no restart when the config changed under a running sshd | `changing_the_config_of_a_running_sshd_restarts_it` |
| M5 missing `root:` line returns Ok instead of erroring | `a_shadow_file_without_a_root_entry_is_an_error` |
| M6 missing shadow file read as empty instead of erroring | `a_missing_shadow_file_is_an_error` |
| M7 absent `passwordHash` errors instead of skipping cleanly | `absent_password_hash_skips_the_write_cleanly` |
| M8 shadow mode hardcoded 0600 instead of preserved | `shadow_rewrite_preserves_mode_and_ownership` |
| M9 shadow ownership not restored after rename | `shadow_rewrite_preserves_mode_and_ownership` |
| M10 root line matched by `contains` instead of `starts_with` | `rewrite_does_not_match_an_account_merely_containing_root` |
| M11 drop-in written 0666 instead of the fixed mode | `apply_writes_the_golden_drop_in_creating_its_directory` |
| M12 `is_active` always true | `already_stopped_and_disabled_needs_no_calls` (+3) |
| M13 `is_enabled` always true | `disabled_to_enabled_enables_then_starts` (+3) |

M8 and M9 are the rows that matter most for the earlier L3's warning about
tautological mode assertions: the test asserts the literal `0o640` against a
fixture explicitly set to `0o640`, while the atomic writer's own temp file is
created at whatever mode is passed in - so hardcoding a mode kills the test
rather than satisfying it. M9 is asserted against gid 12, handed to the fixture
by a `chown` that only root can perform; where the test cannot do that it falls
back to asserting the gid is unchanged.

M4 and M12 are the two that catch the "component present, integration broken"
class directly: without them a port change would leave the old sshd running,
and a converged system would be issued jobs it does not need.

### What is asserted, beyond existence

- `apply_writes_the_golden_drop_in_creating_its_directory` compares the whole
  file against a golden constant and asserts mode 0644, not that a file exists.
- `shadow_rewrite_touches_only_the_root_hash` asserts the **entire** shadow
  file against a golden three-account constant, so a change to `daemon` or
  `operator` fails it.
- `reapplying_the_same_settings_changes_nothing` proves the skip-write path
  without relying on mtime: it chmods the drop-in to 0600 between the two
  applies and asserts it is still 0600, which only holds if the second apply
  really did not rewrite the file.
- `every_path_the_reconciler_writes_stays_inside_the_tempdir` asserts both
  paths are under the tempdir and that the live-state `dropIn` is not the
  system default.
- `a_shadow_file_without_a_root_entry_is_an_error` and
  `a_missing_shadow_file_is_an_error` both also assert **no unit calls were
  made**, i.e. a broken shadow file stops the reconcile before sshd starts,
  and the missing-file case asserts the file was not created from nothing.

## ActiveForm

Reconciling `access.ssh` into sshd configuration, `ssh.service` state and the
root account's password.

## Dependencies

- **blocked by**: RFCT-021 (schema v3 `access.ssh` / `access.device`),
  RFCT-022 (the per-device credential this writes into shadow)
- **blocks**: the WiFi client and AP reconcilers, which drive their units
  through this task's `UnitControl`
- **requires, outside this task**: `/etc/shadow` made writable via STATE
  (issue heca0kvp) with mosd ordered `After=` that oneshot; `etc-ssh.mount`
  for the drop-in directory; an image whose crypt library accepts the Argon2id
  PHC hash
