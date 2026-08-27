# RFCT-022 On-device identity and per-device credential generation

- **status**: completed — implementation complete
- **priority**: P1
- **owner**: ai-agent
- **createdAt**: 2026-08-19 00:23
- **claimedAt**: 2026-08-19 00:23
- **completedAt**: 2026-08-19 01:20

## Description

The rootfs is squashfs + dm-verity: read-only and byte-identical on every
device in the fleet, and covered by the FIT signature. Nothing secret can be
baked into it — a baked credential is a fleet-wide shared secret by
construction, and a random one would make the verity root hash depend on a
keygen. `mos-seed-state` already reaches this conclusion for the sshd host
keys and generates them on the device instead. This task is the same move for
the device's own identity and its operator credentials.

`mosd/mosd/src/identity.rs` generates them at runtime, from the system CSPRNG,
and persists them to STATE. It is a library only: nothing calls it yet. Wiring
it into the startup sequence, reconciling the device password into the root
account, and rendering the AP PSK into `hostapd.conf` are separate tasks.

### What is generated, and why it is two secrets and not one

| Item | Where it lands | Purpose |
|---|---|---|
| `device_id` | `provisioning.deviceId` in `settings.toml` | 16 CSPRNG bytes as 32 lowercase hex chars; the device's name to the fleet |
| device password | hash in `access.device.passwordHash`, plaintext in `<state>/secrets/device-password` | authenticates the operator on SSH, the local console and the webd admin UI |
| AP PSK | plaintext in `<state>/secrets/ap-psk` | the WPA2 pre-shared key for provisioning AP mode |

All three are independent draws from `ring::rand::SystemRandom`. Nothing is
derived from the hostname, the MAC, the machine-id or the clock: a secret
derived from a per-device-but-guessable input is a fleet-wide secret with extra
steps.

**Deviation from PLAN-008 Part D.** PLAN-008 Part D says the AP PSK "defaults
to the per-device provisioning PIN". It does not here — it is a second,
independent random string. Both readings satisfy "never a fleet-wide constant",
so the plan is not violated in spirit, but reusing one string couples two very
differently exposed credentials: the WPA2 PSK is broadcast-adjacent and
offline-crackable from a captured handshake, and if it is also the device
password then recovering the WiFi key hands over the root shell. A second draw
from the CSPRNG costs nothing. `two_hundred_devices_share_no_secret` asserts
per device that the password is not the PSK, so a future "simplification" back
to one string fails the build.

`access.device.generation` goes 0 -> 1 when the credential is first created, so
a non-zero generation means "a credential of record exists". It is the revision
counter anything derived from the password must key off.

### The STATE layout that shipped

```
/var/lib/mos/                      (bind mount of /mnt/state/mos)
├── settings.toml                  owned by mosd-settings; hashes and metadata only
└── secrets/                       0700
    ├── device-password            0600, 16 chars, no trailing newline
    └── ap-psk                      0600, 16 chars, no trailing newline
```

`settings.toml` is written only through the `Settings` type, and only three
leaves: `provisioning.deviceId`, `access.device.passwordHash` and
`access.device.generation`. `provisioning.state` is deliberately not touched —
declaring first boot finished belongs to whichever caller ran every other
first-boot step, not to this module.

Every write is atomic in the same shape as `mosd_settings::Store::save`: temp
file in the destination directory, `fsync`, `rename`, `fsync` the directory.
The mode is set on the temp file **before** the rename, so the secret is never
reachable under its final name at a laxer mode. The directory mode is carried
by `mkdir(2)` itself for the same reason, and then re-applied unconditionally —
`mkdir`'s mode is masked by the umask, and a directory left behind by an
interrupted earlier run has to be tightened rather than inherited.

### Why a plaintext secret on STATE is acceptable

Neither secret can be hash-only:

- the operator has to be able to *learn* the initial device password (read it
  over the console, print it, have webd show it once);
- the AP PSK has to be re-rendered into `hostapd.conf` verbatim on every boot.

STATE is unencrypted flash. That is a smaller concession than it first looks,
because `docs/design/access.md` section 7 already establishes the boundary:
physical possession of the boot medium implies full control — the preferred
provisioning path is literally "edit a file on the SD card with any reader", and
anyone holding the card can rewrite the rootfs regardless. A plaintext on STATE
does not weaken a threat model that already grants the card-holder everything.

The two protections that do matter are both asserted by tests:

- the **hash** in `settings.toml` is what defends the credential against an
  *online* attacker, who reaches the settings tree over the bus or the web UI
  but never the raw partition. `settings_document_contains_no_plaintext_secret`
  serializes the resulting tree and asserts neither plaintext appears anywhere
  in the document, rather than trusting the types to have kept it out.
- the **file mode** is what defends it against a non-root local process. 0600
  in a 0700 directory, asserted by reading the permission bits back.

### Argon2 is duplicated with webd, deliberately

`hash_password` / `verify_password` here are a second copy of
`mosd/webd/src/auth.rs`'s pair, at the same parameters (`Argon2::default()`,
PHC string output), so a hash written by one verifies in the other. webd was not
refactored to share them. The alternative is a third crate existing only to hold
two functions, or a `mosd` -> `webd` dependency edge that inverts the intended
direction. Twenty lines duplicated across a boundary that already exists is the
cheaper of the three, and the parameter choice is pinned by a test on each side.

One difference: the salt comes from `SystemRandom` here rather than
`password_hash`'s `OsRng`. `OsRng` is gated behind a `rand_core` feature that
`mosd`, unlike `webd`, does not otherwise pull in, and this module already has a
CSPRNG handle. Both are the operating system CSPRNG; the hash format is
identical.

### The alphabet, and the rejection sampling that looks like a no-op

Secrets are 16 characters from a 32-symbol alphabet —
`23456789ABCDEFGHJKLMNPQRSTUVWXYZ`. Lowercase is excluded wholesale, which
removes `o` and `l`; `0`, `1`, `O` and `I` are removed by hand. That is 80 bits
of entropy, and 16 sits inside the 8..=63 character range WPA2 requires of a
pre-shared key, which the AP PSK has to satisfy.

`generate_secret` discards bytes at or above `256 - (256 % 32)` instead of
folding a full 0..=255 byte with `%`, which would make the first `256 % N`
symbols more likely than the rest. Since the alphabet is 32 long and 256 is a
multiple of 32, the limit is 256 and *no byte is ever actually rejected today*.
The rejection stays anyway, because what makes the mapping unbiased is the
alphabet's length rather than the code, and the alphabet is the part likely to
change.

### Idempotence, and what "partial" means

`ensure_identity` mutates the settings tree and does **not** save it, so the
caller owns the single atomic settings write that commits every first-boot
change at once.

Each of the three items is generated only when absent, so an interrupted first
boot completes only its missing half and leaves the present half byte-identical.
Two consequences worth stating:

- **Plaintext is written before the hash is set.** The caller's settings save is
  the commit point. A crash in between orphans a plaintext that the next boot
  overwrites; the reverse order would strand a hash with no way to learn the
  password it stands for.
- **A `passwordHash` whose plaintext file is missing is not regenerated.** The
  hash is the credential of record. Replacing it because the plaintext copy
  vanished would invalidate a password the operator may already be holding —
  and regenerating a credential on a fielded device locks its operator out,
  which is the failure this module exists to avoid.

## Scope

Owned here:

- `mosd/mosd/src/identity.rs` — the whole feature and its eight test groups.
- `mosd/mosd/src/main.rs` — one line, `mod identity;`.
- `mosd/mosd/Cargo.toml` — `argon2`, `ring`, `hex` from the workspace table,
  plus `toml` as a dev-dependency for the no-plaintext assertion. No new
  third-party crate was added to the workspace.
- `docs/task/RFCT-022.md`.

Not owned here, and deliberately untouched: the startup sequence, any
reconciler, the D-Bus surface, `mosd/webd/**`, `mosd/mosd-settings/**` and
`os/**`. No secret, seed or default credential enters the image.

### Two deviations from the stated file scope

1. **`mosd/Cargo.lock`** had to change. `mosd/hack/check.sh` runs
   `cargo clippy --locked` and `cargo nextest run --locked`, so a manifest that
   adds dependencies without the matching lock update fails the gate outright.
   The change is mechanical: `argon2`, `hex`, `ring` and `toml` added to the
   `mosd` package's dependency list. No version resolved differently — all four
   were already in the lock for `webd`, `mosd-settings` and `update-sign`.
2. **The task branch did not actually contain schema v3.** The brief states it
   does; `bkd/zw7iebgu` was in fact branched from `bea0b25`, which predates it.
   Nothing in this module compiles without `provisioning.deviceId` and
   `access.device`, so `bkd/tnljob83` (carrying RFCT-021) was merged in. That
   merge commit brings the previous L3's files into this branch's history; they
   are its changes, not this task's, and no line of them was modified here.

## Work checklist

- [x] `device_id`, device password and AP PSK, all three independent CSPRNG draws
- [x] `ring::rand::SystemRandom` only; no time, MAC, hostname or machine-id derivation
- [x] 32-symbol unambiguous alphabet, length 16, rejection sampling against modulo bias
- [x] State directory is a parameter, defaulting to `/var/lib/mos`
- [x] Secrets at 0600 inside a 0700 directory, mode set before the rename
- [x] Atomic writes: temp + fsync + rename + parent dir fsync
- [x] `ensure_identity` mutates the tree and leaves the save to the caller
- [x] `read_device_password` / `read_ap_psk` / `hash_password` / `verify_password`
- [x] No new workspace dependency
- [x] R6.1–R6.8 test groups, plus a ninth for a lax pre-existing directory
- [x] No `unwrap`/`expect` outside tests; every public item documented

## Verification (2026-08-19)

Command:

```
bash mosd/hack/check.sh
```

Final lines:

```
    Starting 77 tests across 9 binaries
        PASS [   0.008s] ( 5/77) mosd::bin/mosd identity::tests::generated_secrets_use_only_the_unambiguous_alphabet
        PASS [   0.716s] (11/77) mosd::bin/mosd identity::tests::second_call_is_a_genuine_no_op
        PASS [   1.062s] (12/77) mosd::bin/mosd identity::tests::settings_document_contains_no_plaintext_secret
        PASS [   1.138s] (17/77) mosd::bin/mosd identity::tests::partial_state_with_credential_only_completes_the_device_id
        PASS [   1.119s] (18/77) mosd::bin/mosd identity::tests::secret_files_are_0600_inside_a_0700_directory
        PASS [   1.200s] (21/77) mosd::bin/mosd identity::tests::a_lax_pre_existing_secrets_directory_is_tightened
        PASS [   2.627s] (53/77) mosd::bin/mosd identity::tests::fresh_state_gets_identity_and_both_secrets
        PASS [   2.715s] (55/77) mosd::bin/mosd identity::tests::partial_state_with_device_id_only_completes_the_credential
        PASS [   3.000s] (56/77) mosd::bin/mosd identity::tests::verify_password_rejects_a_one_character_miss
        PASS [  18.769s] (77/77) mosd::bin/mosd identity::tests::two_hundred_devices_share_no_secret
     Summary [  18.889s] 77 tests run: 77 passed, 0 skipped
advisories ok, bans ok, licenses ok
ALL CHECKS PASSED
```

77 tests, 77 passed, 0 skipped — `cargo fmt --check`, `cargo clippy --workspace
--all-targets --locked -D warnings`, `cargo nextest run --workspace --locked`
and `cargo deny check licenses bans advisories` all clean. RFCT-021's run was
67 tests; this task adds the 10 `identity::tests` cases.

`two_hundred_devices_share_no_secret` provisions 200 tempdirs, which is 200
Argon2id hashes at webd's deliberately expensive parameters. Serially that took
106s in an unoptimised test build — enough to make the check gate unusable — so
the test spreads the draws over `available_parallelism()` scoped threads and
finishes in ~15-19s. The assertion set is unchanged by that: 200 distinct
passwords, 200 distinct PSKs, 200 distinct device_ids, password != PSK per
device, and 400 distinct strings across the union of the two secret sets.

### The guards were mutation-checked, not assumed

Each guard was removed, the suite re-run, and the mutation reverted. All eight
are reverted; `git diff` on `identity.rs` is clean of them.

| Mutation | Result |
|---|---|
| M1 — idempotence guard dropped, password regenerated on every call | `second_call_is_a_genuine_no_op` and `partial_state_with_credential_only_completes_the_device_id` FAILED (8 passed, 2 failed) |
| M2 — AP PSK reuses the device password (the literal PLAN-008 Part D reading) | `fresh_state_gets_identity_and_both_secrets` and `two_hundred_devices_share_no_secret` FAILED (8 passed, 2 failed) |
| M3 — `device_id` returns a constant instead of the CSPRNG draw | `two_hundred_devices_share_no_secret` and `partial_state_with_credential_only_completes_the_device_id` FAILED (8 passed, 2 failed) |
| M4 — explicit `chmod` on the directory and the temp file dropped, create-time mode only | `a_lax_pre_existing_secrets_directory_is_tightened` FAILED (9 passed, 1 failed) |
| M5 — `SECRET_FILE_MODE` widened to 0644 | **first run: all 10 PASSED** — see below. After the fix: `secret_files_are_0600_inside_a_0700_directory` and `a_lax_pre_existing_secrets_directory_is_tightened` FAILED (8 passed, 2 failed) |
| M6 — `SECRETS_DIR_MODE` widened to 0755 | same two FAILED (8 passed, 2 failed) |
| M7 — `0`, `1`, `O`, `I` put back into the alphabet | `generated_secrets_use_only_the_unambiguous_alphabet` FAILED (9 passed, 1 failed) |
| M8 — the plaintext password stored in settings in place of its hash | `fresh_state_gets_identity_and_both_secrets`, `settings_document_contains_no_plaintext_secret`, `partial_state_with_device_id_only_completes_the_credential` and `verify_password_rejects_a_one_character_miss` FAILED (6 passed, 4 failed) |

**M5 is the row that earned its keep, because it initially passed.** The mode
tests asserted `mode_of(path) == SECRET_FILE_MODE` — against the very constant
the implementation uses — so widening the constant moved the goalposts and the
assertion held. That is the M4 lesson in miniature: the test was checking
self-consistency, not the property. Both mode tests now assert the literals
`0o600` and `0o700`, and M5 and M6 fail as they should. Had the mutation not
been run, the suite would have shipped unable to detect a world-readable
credential file.

M8 is the second most informative: it proves
`settings_document_contains_no_plaintext_secret` is checking the serialized
document and not merely the presence of a `passwordHash` key.

## ActiveForm

Generating this device's identity and its per-device secrets on the device at
first boot.

## Dependencies

- **blocked by**: RFCT-021 (settings schema v3 — `access.device` and
  `provisioning` are the leaves written here)
- **blocks**: first-boot startup wiring, the SSH/console access reconciler (needs
  `read_device_password`), and connd's hostapd rendering (needs `read_ap_psk`)
