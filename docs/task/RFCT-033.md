# RFCT-033 Transient root password: marker, bus method, shadow reconcile

- **status**: completed — implementation complete, `bash mosd/hack/check.sh` and
  `make os-shadow-test` both green; on-device PAM behaviour is NOT claimed
- **priority**: P1
- **owner**: ai-agent
- **createdAt**: 2026-08-19 09:39
- **claimedAt**: 2026-08-19 09:39
- **completedAt**: 2026-08-19 10:30

Campaign `l1-o7ee8v0o-20260819093920-sshweb`. Branch `bkd/9ly3sa8v`, merged by
L2 into `bkd/hiu25adw`.

## Description

SSH access is moving to: SSH off by default, root with no password by default,
persistent access by SSH public key. The one case a key cannot cover is an
operator standing in front of a device that has no key installed yet, so the web
UI may set a root password — and that password must not outlive the session.

This task is the lifecycle of that password: the D-Bus method that sets it, the
marker file that records it, the boot-time reconcile that removes it, and the
removal of the M5 behaviour in which the generated per-device password was
written into `/etc/shadow` and stayed there.

A sibling L3 owns the authorized-keys rendering and another owns the image
profile default flip. Neither is touched here.

## Design

### The marker

| property | value |
| --- | --- |
| path | `<dirname of the shadow path>/transient-root-password` |
| content | exactly the bcrypt hash written into the root entry, plus `\n` |
| mode | `0600`, owner root |
| write | temp file in the same directory, `fsync`, `rename` |

The path is **derived from the shadow path, never hardcoded**. With the
production shadow at `/var/lib/mos/shadow` that resolves to
`/var/lib/mos/transient-root-password`, which is STATE-backed; with
`mos-seed-state`'s early `/mnt/state/mos/shadow` it is the same file reached by
the other name, because `var-lib-mos.mount` has not bound the directory onto
`/var` yet at that point in boot. Hardcoding `/var/lib/mos` would have made the
two paths name two different files.

Content is the hash and nothing else: no password, no timestamp, no JSON. It is
not a plaintext secret but it *is* a password hash, so it never appears in a log
line and its mode is asserted by a test
(`the_shadow_hash_verifies_and_the_marker_repeats_it_exactly`).

### Vanish-on-reboot, exactly

`mos-shadow-reconcile.service` runs on every boot, `After=var-lib-mos.mount` and
`Before=mosd.service ssh.service`. The script now, before anything else it does:

1. reads the marker's **first line** as `want`;
2. reads the hash field of the `root:` line as `cur`;
3. if `cur = want`, rewrites that field to `!` and logs
   `shadow: transient root password cleared`;
4. otherwise leaves the file byte-for-byte alone and logs
   `shadow: transient marker does not match the current root hash; leaving it alone`;
5. removes the marker in **both** branches — it is stale either way.

So the window is exactly one boot: set at 14:00, usable until the machine
restarts, gone before sshd or mosd start on the next boot. Nothing re-applies
it, because nothing about it is persisted anywhere a reconciler reads.

### Why the clearing runs BEFORE the converged early exit

The pre-existing script exits early with "already converged" when it appended no
entry — which is the state of every fielded device on almost every boot. A
transient check placed after that exit would run on a device's first boot and
never again. It is therefore the first thing the script does after validating
its inputs.

### Why write shadow first, then the marker

`set_transient_root_password` writes the shadow file and only then the marker.
The two failure windows are not symmetric:

- **marker written, shadow not**: the next boot compares a hash that is not in
  the file, takes the mismatch branch, changes nothing and deletes the marker.
  Harmless.
- **shadow written, marker not**: a changed root hash with nothing recording it.
  The next boot has no reason to clear it, and the password never expires —
  which is precisely the failure this whole design exists to prevent.

The ordering is stated as a comment at the write site.

### Why a marker at all, rather than "lock root every boot"

Locking root unconditionally on every boot would be simpler and would also make
the password transient. It would also destroy the `ROOT_PASSWORD` build-arg hash
a **dev image** bakes in: that hash is not one mosd wrote, and a developer
expects it to survive a reboot. The marker is what distinguishes "a hash this
system set, which it may clear" from "a hash something else set, which it must
not touch". The mismatch branch is that distinction, and it is the reason the
script is not three lines long. `os/shadow-reconcile-test.sh` case 2 asserts it
in both directions: the dev hash survives, and the log line is not the one the
clearing branch emits.

### The empty-field rule

RFCT-024 fixed the rule: an EMPTY hash field is not a locked account, it is
`pam_unix` accepting any password. The script therefore **never writes an empty
hash field in any branch**. When `want` is empty (a marker holding only a
newline) or the shadow file has no `root:` line, it logs
`shadow: transient marker names no usable hash` and changes nothing.

**What this implementation chose for R5 case 6, stated explicitly.** The
fixture is a marker containing just a newline and a shadow whose root field is
*already* empty. The implementation takes the change-nothing branch, so the
field stays empty — it comes out **unchanged, and still empty**. It is not
rewritten to `!`. The rule enforced is "never *write* an empty field", not
"never leave one", and the two differ only when the field was already empty
before this code ran. Forcing it to `!` would mean this block rewriting an
entry it did not create, which contradicts the script's rule 2 ("any other
entry that already exists is NEVER touched") and would silently lock an account
on a system that never had a transient password. The test asserts the honest
outcome — file byte-identical, marker gone, and the emptiness demonstrably not
produced by this run — and a companion case asserts the same marker over a
*real* hash also writes nothing, so a stray newline in the marker can never
blank out a working credential. This is a deliberate deviation from the literal
wording of R5 case 6 ("assert the resulting field is `!` or
unchanged-but-not-empty"), which is unsatisfiable together with R5's own
"if `want` is empty ... change nothing".

### The D-Bus method

`com.mos.mosd1.SetTransientRootPassword(s password)`, exported from
`async fn set_transient_root_password` by zbus's default snake_case ->
PascalCase rename. That rename is **verified against the running interface**,
not assumed: `mosd/mosd/tests/bus.rs` reads
`org.freedesktop.DBus.Introspectable.Introspect` off the live daemon and asserts
the XML carries a method named exactly `SetTransientRootPassword` with exactly
one `in` argument of type `s`, and that the snake_case spelling appears nowhere
in the interface. A test that only called the Rust function would prove nothing
about what a D-Bus client can reach.

The method:

- validates, hashes and writes through `transient::set_transient_root_password`
  against the shadow path the service was configured with;
- then calls `apply_all()`, so the sshd drop-in re-renders and sshd reloads;
- writes **nothing** into the settings tree and emits **no** `SettingsChanged`.
  A password in the settings tree would be persisted to `settings.toml`,
  re-applied on the next boot and readable by anything that can call
  `GetSettings` — the opposite of transient in all three respects. Asserted by
  `a_transient_password_does_not_touch_the_settings_tree` (byte-identical tree
  across the call, and no `settings.toml` written at all) and again over the bus.

The shadow path reaches the service the way every other path reaches its
consumer: a `MosdService::new` parameter, defaulted in `main.rs` from
`MOSD_SHADOW_PATH` or `/etc/shadow`. That is the same variable the sshd
reconciler honours, so one override redirects both and the integration test can
point the whole daemon at a temporary file.

### Password rules

Rejected: shorter than 8 bytes (which covers empty), longer than 256 bytes, or
containing `\0`, `\n` or `\r`. The 8-byte floor is not theatre — the moment sshd
comes up this password is reachable over the network, so it is guessed at
network speed rather than keyboard speed. The 256-byte ceiling is a bound on the
input rather than on strength: **bcrypt reads only the first 72 bytes**, silently
truncating beyond that (`bcrypt` 0.19's `hash`, as opposed to
`non_truncating_hash`, does not error). The three control characters would
either terminate the hash early or split the shadow entry across lines.

No error message carries the password;
`a_rejection_message_never_carries_the_password` asserts that directly, and the
bus tests assert it again on the D-Bus error a client actually receives.

### What was removed from `reconciler/sshd.rs`

Deleted: `apply_root_password`, the `RootPassword` enum and its `as_str`, the
`rootPassword` key in the published live state, `BCRYPT_COST`, `ROOT_ACCOUNT`,
`ROOT_PREFIX`, `SHADOW_HASH_FIELD`, the `state_dir` field, `STATE_DIR_ENV`, and
the `state_dir` constructor parameter (nothing reads it any more). The module
doc paragraph describing effect (2) is gone and the block is rewritten to
describe what the reconciler now does, with one paragraph recording that the
device password no longer reaches PAM and why.

`root_hash`, `rewrite_root_hash` and `write_atomically` were **moved** (not
copied) into `transient.rs` as `pub(crate)`, so the sibling authorized-keys work
can use the atomic writer. `sshd.rs` imports `write_atomically` from there for
the drop-in.

Kept, per the campaign spec: the `shadow_path` field, `SHADOW_ENV` and
`DEFAULT_SHADOW`. Nothing in the reconciler reads the field today, so it carries
an `#[allow(dead_code)]` naming the sibling task that will — the same house
pattern `reconciler/mod.rs` and `identity.rs` already use.
`transient_password_active` carries the same allow for the same reason.

`identity::read_device_password` and the `secrets/device-password` file on STATE
are untouched. The secret still exists; it simply no longer flows to PAM. The
credential of record for shell access is now a key, or a transient password the
operator sets explicitly.

### One duplicated constant, deliberately

`DEFAULT_SHADOW` / `SHADOW_ENV` exist in both `transient.rs` and
`reconciler/sshd.rs`. `reconciler::sshd` is a private module of `reconciler` and
`reconciler/mod.rs` is outside this task's file scope, so `main.rs` cannot reach
sshd's copies to configure the bus service, and the spec explicitly says not to
delete sshd's. Both name `MOSD_SHADOW_PATH` and `/etc/shadow`; a future task
that can touch `reconciler/mod.rs` should collapse them onto
`transient::production_shadow_path()`.

### Two test-only env overrides on the script

`MOS_SHADOW_PASSWD` and `MOS_SHADOW_FACTORY` redirect `/etc/passwd` and
`/usr/share/factory/etc/shadow`. They exist because the harness has to run the
**real** script offline, and a build host has no `/usr/share/factory`; the
alternatives were creating that path on the host (needs root, pollutes it) or
testing a `sed`-mangled copy of the script, which is not the same artifact.
Nothing on the device sets either variable, and the shadow path stays the
positional argument it already was.

## Files changed

- `mosd/mosd/src/transient.rs` — NEW: the module, the marker, the moved shadow
  primitives, 18 tests.
- `mosd/mosd/src/bus.rs` — `shadow_path` on `MosdService`, the
  `SetTransientRootPassword` method, `transient_to_fdo`, 2 tests.
- `mosd/mosd/src/main.rs` — `mod transient;`, the `MOSD_SHADOW_PATH` doc line,
  the new `MosdService::new` argument.
- `mosd/mosd/src/reconciler/sshd.rs` — the removals above and their fallout.
- `mosd/mosd/tests/bus.rs` — introspection proof plus the over-the-bus
  behaviour, reject and settings-untouched assertions.
- `os/rootfs/overlay-v2/usr/lib/mos/mos-shadow-reconcile` — the transient
  clearing block, the rule list rewritten as three rules, the two env overrides.
- `os/shadow-reconcile-test.sh` — NEW harness.
- `Makefile` — `os-shadow-test`, in `.PHONY`, in `help:` and beside
  `os-health-test`.
- `docs/task/RFCT-033.md` — this file.

Not touched: `mosd/mosd-settings/**`, `provisioning.rs`, the `Profile` enum, any
image profile default, `identity.rs`, `docs/task/index.md`, any `Cargo.toml` or
`Cargo.lock` (no new dependency).

## Verification (2026-08-19)

```
$ bash mosd/hack/check.sh
     Summary [  28.196s] 212 tests run: 212 passed, 0 skipped
ALL CHECKS PASSED
```

212 tests, up from **203** on the merge base, a net +9. Measured per module by
`cargo nextest list` on both trees:

| module | before | after |
| --- | --- | --- |
| `transient::tests` | 0 | 18 |
| `bus::tests` | 6 | 8 |
| `sshd::tests` | 25 | 14 |

`sshd::tests` loses 13 and gains 2. The 13 are the ones that covered only the
removed device-password write, plus the three pure-function tests that moved to
`transient.rs` with the functions they cover. The 2 added assert the removal
itself in both directions: that a reconcile writes nothing into the shadow file
and publishes no `rootPassword`, and that a missing or broken shadow file no
longer stops the reconcile. The integration additions live inside the existing
`bus_roundtrip` and so do not move the count.
`cargo fmt --check`, `cargo clippy --workspace --all-targets --locked -D
warnings` and `cargo deny check licenses bans advisories` are all clean.

```
$ make os-shadow-test
chgrp mode: real (real chgrp, group assertions active)
117 passed, 0 failed
RESULT: PASS (117/117 checks)

$ setpriv --reuid=65534 --regid=65534 --clear-groups bash os/shadow-reconcile-test.sh
chgrp mode: faked (chgrp faked on PATH, group assertions skipped)
116 passed, 0 failed
```

Run as an unprivileged user as well as as root, to prove the "no root required"
claim rather than assert it. The one check that differs is the `group shadow`
assertion, which is skipped in faked mode; the harness prints which mode it took
as its first line.

### What the harness covers

| # | case | asserted |
| --- | --- | --- |
| 1 | marker matches the current root hash | field becomes `!`, marker gone, every other line byte-identical, mode 0640, group shadow, no temp file, the clear is logged |
| 2 | marker does not match (dev-image hash) | file byte-identical, dev hash survives, marker gone, the mismatch log is emitted and the clear log is not |
| 3 | no marker | file byte-identical and the converged exit is reached; separately, an account in passwd with no entry still gets a LOCKED one and the root hash survives the append |
| 4 | marker present, no `root:` line | exit 0, file byte-identical, no root entry invented, marker gone |
| 5 | empty marker file | treated as absent, nothing written, marker gone |
| 6 | marker holding only a newline | nothing written in either sub-case (root field empty, root field a real hash); see the empty-field section above |
| 7 | hostile marker content | two lines (only the first is used, and it clears), leading space, trailing space, `:`, `$`, `` ` ``, `\`, `"`, a 4096-byte line — each in both directions where the value can legally sit in a shadow field: correctly rewritten when it matches, untouched when it does not, every line re-parsed as exactly 9 colon-separated fields, and nothing executed |
| 8 | idempotence | two runs, exit 0 both times, identical bytes, no marker resurrected, no temp file |

The comparison is done in shell with `[ "$cur" = "$want" ]` and the value is
handed to `awk` only as input data, never through `awk -v` (which processes
backslash escapes in the value) and never through `eval`. That is what makes the
`\`, `` ` `` and `$` cases pass rather than merely happen to pass.

## What is NOT proven

- **No hardware claim is made.** Nothing here proves that PAM on the device
  accepts a password against the hash that was written. The test host's libcrypt
  is not the image's, `bcrypt::verify` is the Rust crate verifying its own
  output, and no test runs `pam_unix`. What is proven is that the field carries
  a `$2b$12$` crypt(3) string that the bcrypt implementation accepts for that
  password, and that the format is one the image's libcrypt is documented to
  implement. On-device login remains the user's acceptance.
- **The clearing is not proven against a real boot.** The harness runs the
  script directly; it does not boot an image, so `Before=mosd.service
  ssh.service` and `After=var-lib-mos.mount` are still only asserted structurally
  by `os/verify-image-v2.sh` (unchanged by this task).
- **`fsync` durability across power loss** is not tested. `write_atomically`
  calls `sync_all` before the rename and the test asserts no temp file survives,
  but no test cuts power.
- **The web UI does not call the method yet.** Only the D-Bus surface exists;
  wiring it into webd is not this task.

## Known sharp edge, pre-existing, NOT fixed here

The append rule concatenates onto the last line when the shadow file's final
line is unterminated: `echo ... >>` after a file with no trailing newline glues
the new entry onto the previous one. This predates the task — it is in the
`added` loop, untouched here — and is only reachable from a shadow file that was
not written by this stack. The harness normalises its fixtures to exactly one
trailing newline and says so at the point it does it. Worth fixing in whoever
next owns that loop.

## ActiveForm

Making the operator-set root password transient: one boot, then gone, with the
device password removed from PAM entirely.

## Dependencies

- **blocked by**: RFCT-029 (`/etc/shadow` on STATE, the reconcile script),
  RFCT-024 (the empty-field rule and the provisioning tree)
- **blocks**: the webd surface that calls `SetTransientRootPassword`; the
  authorized-keys reconciler, which consumes `transient_password_active` and
  `write_atomically`
