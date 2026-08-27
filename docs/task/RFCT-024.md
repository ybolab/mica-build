# RFCT-024 First-boot self-provisioning in mosd (provisioning Layer 1)

- **status**: completed — implementation complete
- **priority**: P1
- **owner**: (bkd campaign)
- **createdAt**: 2026-08-19 00:23
- **claimedAt**: 2026-08-19 01:20
- **completedAt**: 2026-08-19 02:05

## Description

`docs/design/provisioning.md` section 2 defines Layer 1: when STATE holds no
configuration, the device generates its own, persists it, and is thereafter a
fully working, configurable appliance. This task is that step for mosd.
RFCT-021 made the settings tree able to *hold* the configuration and RFCT-022
made the device able to *mint* an identity; neither one runs. This task is what
runs them, once, on first boot.

`mosd/mosd/src/provisioning.rs` is the whole feature. `main.rs` calls it after
`Store::load` and before `reconciler::all()`, so the first reconcile already
sees the seeded tree rather than the built-in defaults.

### What a first boot produces

Starting from an empty STATE and a `prod` image, `ensure_provisioned` writes
exactly one `settings.toml`:

```toml
schema_version = 3
hostname = "mos-3f8a1c02"        # derived from deviceId, see below

[network]                        # deliberately empty

[access.ssh]
enabled = false                  # from the image profile
port = 22
# ... schema defaults

[access.device]
passwordHash = "$argon2id$..."   # minted by identity::ensure_identity
generation = 1

[provisioning]
state = "complete"
deviceId = "3f8a1c02...."        # 16 CSPRNG bytes as hex
seededGeneration = 1

[wifi.client]                    # untouched schema defaults
enabled = false
[wifi.ap]
mode = "off"
```

Plus, on the same STATE and written by `identity::ensure_identity`,
`secrets/device-password` and `secrets/ap-psk` at 0600 inside a 0700 directory.

### The no-network property, and how it is enforced

This is the point of Layer 1, not a side effect of it. An appliance is unboxed
on a bench with no DHCP server, no DNS and possibly no cable, and it still has
to reach a named, credentialled, configurable state. So:

- **The hostname comes from the device identity.** `seeded_hostname` is
  `mos-` plus the first eight hex characters of `provisioning.deviceId`, which
  `identity::ensure_identity` drew from the system CSPRNG. Not a DHCP option 12,
  not a reverse DNS lookup, not a MAC address. Beyond removing the network
  dependency this makes the name *stable*: it does not change when the device
  is moved to another subnet, when a lease expires, or when a NIC is replaced.
  Eight hex characters is 32 bits, so two devices on one LAN colliding is not a
  practical concern; it is short enough to print on a label.
- **The module references no networking API whatsoever.** Its entire import
  list is `std::fs`, `std::path::Path`, `anyhow`, `mosd_settings` and
  `crate::identity`. The only I/O it performs is reading the profile file and
  writing STATE.
- **`network` is seeded empty, on purpose** (R2.4). The image already ships a
  static `80-dhcp.network` matching `eth*`, so DHCP works on a fresh device with
  no seeded entry at all. Seeding one would mean guessing interface names:
  writing `network.eth0` on a board whose NIC enumerates as `end0` or which has
  no ethernet at all produces a networkd unit for an interface that does not
  exist. An empty `network` also keeps mosd's network reconciler from claiming
  ownership of an interface the operator never configured. `wifi` is likewise
  left at its defaults: there is no network to join yet, and bringing up AP mode
  is connd's decision from the uplink state machine, not first boot's.

What the tests prove, stated precisely: `hostname_is_derived_only_from_the_
device_identity` proves the derivation is a pure function of `deviceId` — the
same identity yields the same name across two independent runs on two
independent temporary STATE directories, and two identities that differ only
after the eighth character yield the same name while two that differ inside it
yield different names. `fresh_state_is_seeded_and_persisted` proves `network`
comes out empty and `wifi` byte-equal to its defaults.

What they do **not** prove: that the process issues no network syscall. A unit
test cannot establish that, and claiming it would be exactly the M4 mistake.
The syscall-level claim rests on the import list above and on `provisioning.rs`
containing no networking symbol in any non-comment line — mechanically checked,
output in the Verification section. On-device behaviour is the user's
acceptance and is not claimed here.

### The image profile drives the SSH default, and fails closed

`read_profile` parses `MOS_PROFILE` out of the shell-style `KEY=value` file at
`/usr/lib/mos/profile.conf` (shipped read-only by a sibling task; the path is a
parameter, so tests inject their own). `dev` seeds `access.ssh.enabled = true`;
`prod` seeds it `false`, per `docs/design/access.md` section 5.

**Every other input resolves to `prod`.** Missing file, unreadable path, no
`MOS_PROFILE` key, an empty value, an unrecognised value — all of them log a
warning and return `Profile::Prod`. The two ways of being wrong here are not
symmetric: guessing `dev` on a malformed file opens SSH on a production device,
and guessing `prod` on a malformed file inconveniences a developer who can flip
one setting. Only the first one is expensive, so the code always guesses the
second.

The same reasoning makes the match **case-sensitive**. `DEV` and `Dev` resolve
to `prod`, because accepting them would widen the set of inputs that open SSH,
which is the direction being defended. `profile_matrix_fails_closed` asserts
that explicitly, and mutation M4 below confirms the assertion is real.

Concessions to shell-file reality, none of which widen the fail-open surface:
blank lines and `#` comments are skipped, a value may be wrapped in single or
double quotes, and a repeated key takes its last value the way a shell would.

### Atomicity: one save, and never a half-seeded `complete`

`ensure_provisioned` seeds into a **private clone** of the settings tree.
`store.save` is the commit point; only after it returns does `*settings` get
replaced. A failure anywhere before that — the CSPRNG unavailable, the secrets
directory uncreatable, the settings file unwritable — leaves both STATE and the
caller's tree exactly as they were, and the device stays `pending` so the next
boot retries from scratch.

The failure mode this defends against is specific: a tree on disk that says
`state = "complete"` but carries no `deviceId` and no `passwordHash` would be
*trusted* by every subsequent boot, which would then skip provisioning forever.
That device is unrecoverable without a STATE wipe. An unprovisioned device just
tries again.

**Scope of the guarantee, stated honestly.** It covers the settings tree. It
does not cover the two secret files, which `identity::ensure_identity` writes
before the save returns. If the save fails after they are written, the
plaintexts are on STATE but no hash is in the settings, so the next boot
regenerates and overwrites both. That ordering is `identity.rs`'s deliberate
choice (documented there: an orphaned plaintext is recoverable, a hash with no
recorded plaintext is not) and this task does not change it.

### Idempotence

`ensure_provisioned` returns `Outcome::AlreadyProvisioned` before touching
anything at all when `provisioning.state` is already `complete`. No credential
is regenerated, no operator setting is reverted, `seededGeneration` does not
move, and no file is opened — not even the profile file.

A second guard covers the interrupted-first-boot case, where the state is still
`pending` but an operator has already named the device: the hostname is seeded
**only** while it equals the built-in default `"mos"`.

### Startup wiring and the dry-run escape hatch

`main()` runs provisioning between `Store::load` and `reconciler::all()`.

- **Under `MOSD_DRY_RUN=1` provisioning is skipped entirely.** The existing
  contract is that dry-run never touches the host, and provisioning both mints
  secrets on disk and rewrites the settings file. `mosd/mosd/tests/bus.rs`
  relies on that; it passes unchanged.
- **The state directory is the settings file's parent**, falling back to
  `identity::DEFAULT_STATE_DIR`. In production `MOSD_SETTINGS_PATH` defaults to
  `/var/lib/mos/settings.toml`, so secrets land in `/var/lib/mos/secrets` as
  RFCT-022 specified. A test that redirects `MOSD_SETTINGS_PATH` into a
  temporary directory redirects the secrets with it, which is what keeps a test
  run from writing to the host's `/var/lib/mos`.
- **A provisioning failure aborts startup**, deliberately. An unwritable STATE
  means no identity and no device credential, so there is no usable device to
  serve; a loud exit is better than a daemon quietly serving an unprovisioned
  tree that the operator cannot log in to.

`MOS_PROFILE_PATH` was considered as an environment override and **rejected**:
the path is already a function parameter, which is what the tests use, and a
second injection point that only tests would use is configurability nobody
asked for.

## Scope

Owned here:

- `mosd/mosd/src/provisioning.rs` — the feature and its eleven tests.
- `mosd/mosd/src/main.rs` — the startup call, the dry-run gate and
  `state_dir_for`.
- `mosd/mosd/src/identity.rs` — the module-level `#![allow(dead_code)]` is
  gone, replaced by three per-item `#[allow(dead_code)]` on
  `read_device_password`, `read_ap_psk` and `verify_password`, which are still
  waiting for the access and connd reconcilers. No logic changed.
- `docs/task/RFCT-024.md`.

Not touched: `mosd/Cargo.lock` (no dependency change), `mosd-settings`, the
reconcilers, `os/**`, `mosd/webd/**`.

## Work checklist

- [x] R1 hostname derived from `deviceId`; no networking API in the module
- [x] R2.1 `identity::ensure_identity` establishes deviceId + both secrets
- [x] R2.2 hostname seeded only while it is still the built-in default
- [x] R2.3 `access.ssh.enabled` from the image profile
- [x] R2.4 `network` left empty, with the reasoning recorded above
- [x] R2.5 `wifi` left at its defaults
- [x] R2.6 `state = complete`, `seededGeneration = SEEDING_GENERATION` (= 1)
- [x] R2.7 one `Store::save`; nothing persisted on a partial failure
- [x] R3 profile matrix with `prod` as the fail-closed default, case-sensitive
- [x] R4 re-run is a genuine no-op
- [x] R5 called after `Store::load`, before `reconciler::all()`, skipped under
      `MOSD_DRY_RUN`
- [x] R6 eleven in-file tests including run-twice, operator-changes, the
      profile matrix, both atomicity directions and the offline property
- [x] No new third-party crate; `mosd/Cargo.lock` unchanged
- [x] `bash mosd/hack/check.sh` prints `ALL CHECKS PASSED`

## Verification (2026-08-19)

Command:

```
bash mosd/hack/check.sh
```

Result:

```
    Starting 88 tests across 9 binaries
        PASS [   1.119s] (16/88) mosd::bin/mosd provisioning::tests::a_failed_identity_step_leaves_the_on_disk_tree_untouched
        PASS [   1.016s] (18/88) mosd::bin/mosd provisioning::tests::a_failed_save_leaves_no_complete_tree_on_disk
        PASS [   0.035s] (19/88) mosd::bin/mosd provisioning::tests::profile_matrix_fails_closed
        PASS [   0.019s] (20/88) mosd::bin/mosd provisioning::tests::profile_parsing_handles_shell_style_documents
        PASS [   1.168s] (21/88) mosd::bin/mosd provisioning::tests::fresh_state_is_seeded_and_persisted
        PASS [   0.942s] (23/88) mosd::bin/mosd provisioning::tests::running_twice_is_a_genuine_no_op
        PASS [   1.077s] (27/88) mosd::bin/mosd provisioning::tests::operator_changes_survive_a_re_run
        PASS [   2.668s] (63/88) mosd::bin/mosd provisioning::tests::dev_profile_seeds_ssh_on_and_prod_seeds_it_off
        PASS [   1.327s] (64/88) mosd::bin/mosd provisioning::tests::seeding_does_not_overwrite_a_non_default_hostname
        PASS [   2.311s] (65/88) mosd::bin/mosd provisioning::tests::seeded_generation_records_the_seeding_revision
        PASS [  10.186s] (87/88) mosd::bin/mosd provisioning::tests::hostname_is_derived_only_from_the_device_identity
     Summary [  26.038s] 88 tests run: 88 passed, 0 skipped
ALL CHECKS PASSED
```

88 tests, 88 passed, 0 skipped — `cargo fmt --check`, `cargo clippy --workspace
--all-targets --locked -D warnings`, `cargo nextest run --workspace --locked`
and `cargo deny check licenses bans advisories` all clean. This task adds 11 of
those tests; the suite was at 77 before it.

### The no-networking-API check, mechanically

```
$ grep -vE '^\s*(//|///|//!)' mosd/mosd/src/provisioning.rs \
    | grep -niE 'socket|net::|dns|dhcp|reqwest|hyper|getaddrinfo|netlink|zbus|tokio'
219:            "network must stay empty: the image's static 80-dhcp.network already \
```

The single hit is inside a test's assertion message. The import list is:

```
use std::fs;
use std::path::Path;
use anyhow::{Context, Result};
use mosd_settings::{ProvisioningState, Settings, Store};
use crate::identity;
```

### Mutation testing

Every guard was removed or inverted and the suite re-run, to prove each test
fails for the reason it claims rather than passing for an unrelated one. All
mutations were reverted; `grep` for their residue comes back empty and the
final check run above is on the reverted tree.

| # | Mutation | Tests that FAILED |
|---|---|---|
| M1 | `provisioning.state == Complete` early return removed | `running_twice_is_a_genuine_no_op`, `operator_changes_survive_a_re_run` (9 passed, 2 failed) |
| M2 | hostname seeded unconditionally (built-in-default check dropped) | `seeding_does_not_overwrite_a_non_default_hostname` (10 passed, 1 failed) |
| M3 | `read_profile` fails **open**: missing / unreadable / unrecognised -> `Dev` | `profile_matrix_fails_closed`, `dev_profile_seeds_ssh_on_and_prod_seeds_it_off` (6 passed, 2 failed) |
| M4 | profile match made case-insensitive (`DEV` would open SSH) | `profile_matrix_fails_closed` (8 passed, 1 failed) |
| M5 | seed into `*settings` directly instead of a private clone | `a_failed_save_leaves_no_complete_tree_on_disk`, `a_failed_identity_step_leaves_the_on_disk_tree_untouched` (8 passed, 2 failed) |
| M6 | `seeded_hostname` returns the fixed string `mos-device` | `hostname_is_derived_only_from_the_device_identity`, `fresh_state_is_seeded_and_persisted` (9 passed, 2 failed) |
| M7 | a `network.eth0` DHCP entry seeded | `fresh_state_is_seeded_and_persisted` (10 passed, 1 failed) |
| M8 | `seededGeneration` assignment removed (left 0) | `seeded_generation_records_the_seeding_revision`, `fresh_state_is_seeded_and_persisted`, `running_twice_is_a_genuine_no_op` (8 passed, 3 failed) |
| M9 | `state = Complete` assignment removed | `fresh_state_is_seeded_and_persisted`, `running_twice_is_a_genuine_no_op`, `operator_changes_survive_a_re_run`, `seeding_does_not_overwrite_a_non_default_hostname` (7 passed, 4 failed) |
| M10 | `seededGeneration` incremented instead of stamped | **initially caught nothing (11 passed)** — see below |

Two rows deserve comment.

**M1 is why `running_twice_is_a_genuine_no_op` asserts the returned
`Outcome`.** Without that one assertion the test passes with the guard removed:
re-seeding an already-seeded tree happens to reproduce the same bytes
(`ensure_identity` is itself idempotent, the hostname is no longer the default,
and the profile has not changed), so every byte-comparison in the test still
holds. The outcome is the only observable that distinguishes "did not
re-provision" from "re-provisioned to the same result". `operator_changes_
survive_a_re_run` is the second, independent detector: it stores an SSH state
that is the *opposite* of what the profile would seed, so a re-seed closes SSH
and the test fails on behaviour rather than on a status value.

**M10 was a real hole, found by running the mutation and closed.** Changing
`seeded_generation = SEEDING_GENERATION` to `= seeded_generation + 1` passed the
entire suite, because the `Complete` guard means seeding runs exactly once, so
incrementing from 0 and stamping 1 are indistinguishable on a fresh device.
`seeded_generation_records_the_seeding_revision` now also drives a `pending`
tree that already carries `seededGeneration = 5` — the shape an interrupted run
of a later seeding revision leaves behind — and asserts it comes out as 1, not
6. Re-running M10 against the fixed test: `seeded_generation_records_the_
seeding_revision` FAILED (10 passed, 1 failed).

A note on tautology, since a previous task in this campaign was bitten by it:
the tests assert against **literals** (`1`, `"mos-"`, `8`, `32`), not against
`SEEDING_GENERATION`, `HOSTNAME_PREFIX` or `HOSTNAME_ID_CHARS`. Widening a
constant therefore fails a test instead of silently moving the expectation with
it.

### Other evidence

- `a_failed_save_leaves_no_complete_tree_on_disk` makes the save fail by
  pointing the settings path's parent at a regular file, so
  `Store::save`'s `create_dir_all` fails. That is a path *type* error rather
  than a permission check, so it fails identically when the suite runs as root
  — a chmod-based fixture would not have.
- `a_failed_identity_step_leaves_the_on_disk_tree_untouched` covers the other
  side: a pre-existing `settings.toml` is compared **byte for byte** before and
  after a run whose identity step fails.
- `profile_matrix_fails_closed` drives thirteen malformed bodies (empty, blank
  lines, the key commented out, an empty value, `DEV`, `Dev`, `development`,
  `devel`, a trailing-token value, a different key, two near-miss key names, and
  a body of control characters), plus an absent path and a directory-where-a-
  file-is-expected. All fifteen must yield `Prod`.

## ActiveForm

Implementing first-boot self-provisioning so an offline device seeds itself
into a working, credentialled state.

## Dependencies

- **blocked by**: RFCT-021 (settings schema v3), RFCT-022 (device identity and
  per-device secret generation)
- **blocks**: the access reconciler (consumes `access.ssh.enabled` and
  `access.device.passwordHash`) and connd (consumes `provisioning.deviceId` and
  the AP PSK)
