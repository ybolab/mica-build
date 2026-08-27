# RFCT-021 Settings schema v3 - access, provisioning and wifi subtrees

- **status**: completed — implementation complete
- **priority**: P1
- **owner**: ai-agent
- **createdAt**: 2026-08-19 00:23
- **claimedAt**: 2026-08-19 00:23
- **completedAt**: 2026-08-19 00:40

## Description

PLAN-010 M5 adds the access layer, first-boot self-provisioning and connd. All
three read and write mosd settings, so the tree has to be able to hold their
configuration before any of them can be written. This task is that step and
only that step: schema v2 -> v3, plus the bidirectional migration. No
reconcilers, no daemon changes, no image changes.

### The tree that shipped

`Settings::default()` serializes to exactly this, which is also what a fresh
device writes to `/var/lib/mos/settings.toml`:

```toml
schema_version = 3
hostname = "mos"

[network]

[access.ssh]
enabled = false
port = 22
permitRootLogin = true
passwordAuthentication = true
listenAddresses = []

[access.console]
shellEnabled = false

[access.device]
generation = 0

[provisioning]
state = "pending"
seededGeneration = 0

[wifi.client]
enabled = false
interface = "wlan0"
networks = []

[wifi.ap]
mode = "off"
interface = "wlan0"
channel = 6
countryCode = "US"
address = "192.168.4.1/24"
holdDownSeconds = 120
graceSeconds = 60
```

`access.webAdmin` is unchanged from v2 - same serialized path, same
`password_hash` key - because webd already reads and writes it through the bus
by that exact dot-path. It is absent above only because a fresh tree has no web
admin yet.

Optional values (`access.device.passwordHash`, `provisioning.deviceId`,
`wifi.ap.ssid`, `wifi.ap.psk`, and a network's `psk`) carry
`skip_serializing_if = "Option::is_none"`, so an unset secret is an absent key
rather than an empty string. That is why `passwordHash`, `deviceId`, `ssid` and
`psk` do not appear in the default document at all.

Design points worth recording:

- **No secret has a non-`None` default, and that is load-bearing, not
  tidiness.** `access.device.passwordHash`, `wifi.ap.psk` and each
  `wifi.client.networks[].psk` default to `None`; `wifi.ap.ssid` does too. The
  rootfs is byte-identical across the fleet and signed, so any default value
  placed here would become a fleet-wide shared secret shipped inside the image
  - precisely what `docs/design/provisioning.md` section 2 and PLAN-008 Part D
  forbid. `None` on `wifi.ap.ssid`/`psk` means "derive from the device identity
  and the device credential at render time", which is the connd reconciler's
  job, not the schema's. A unit test
  (`no_secret_is_present_in_a_freshly_built_tree`) asserts the serialized
  default document contains neither `psk` nor `passwordHash` anywhere, so a
  future "helpful default" fails the build.
- **`access.device` holds credential metadata, never the credential.**
  `passwordHash` is an Argon2id PHC string and `generation` is the revision
  counter that lets a regenerated password invalidate anything derived from the
  old one (the AP PSK, for instance). The plaintext device password exists only
  on the label and in the operator's hands, per `docs/design/access.md` section
  4 phase 1.
- **SSH defaults are off-but-usable.** `enabled = false` matches the `prod`
  profile rule in `docs/design/access.md` section 5.3: the image ships sshd and
  opening it requires an authenticated admin action. `permitRootLogin` and
  `passwordAuthentication` both default to `true` because phase 1 has exactly
  one account (root) and exactly one credential (the device password); turning
  either off in phase 1 would leave no way in at all. They exist as settings now
  so phases 2 and 3 can flip them without another schema bump.
  `listenAddresses = []` means "every address". access.md section 3 sketches
  `listenAddresses: []` with the comment "empty = none"; the empty-means-all
  reading is what sshd itself does with no `ListenAddress` directive, and
  encoding "none" as an empty list would make an enabled-but-unreachable sshd
  the default shape. Closure is expressed by `enabled = false`, which is the
  layer that already exists for it (section 5.1).
- **`wifi.client.networks` is a whole-array write, deliberately.** The dot-path
  API in `mosd/mosd-settings/src/path.rs` addresses MAP segments only and has no
  array indexing, so there is no `wifi.client.networks.0.psk`. Callers read and
  write `wifi.client.networks` as one JSON array. This limitation is kept on
  purpose: adding index segments would introduce read-modify-write races between
  two writers on the same array and a second addressing syntax for UI binding to
  learn, for a list that is edited as a unit anyway. `network` (the ethernet
  tree) is keyed by interface name and stays individually addressable, which is
  the case that actually needs it.
- **The AP address default is `192.168.4.1/24`, not PLAN-008's `10.42.0.x`.**
  PLAN-008 Part B sketches a DHCP range in 10.42.0.0/24. The 192.168.4.0/24
  block is the conventional embedded-AP subnet and is far less likely to collide
  with an operator's existing management network than 10.42.0.0/24, which
  systemd-networkd hands out for its own `ipv4ll`/container ranges. The value is
  a setting, so a deployment that needs the other block sets it. connd's DHCP
  range is derived from this address, not configured separately - one source of
  truth for the AP subnet.
- **`holdDownSeconds = 120` / `graceSeconds = 60`** implement steps 2 and 3 of
  the PLAN-008 Part D state machine: two minutes without a usable uplink before
  the AP comes up (long enough that a DHCP lease renewal or a link flap does not
  trigger it), one minute of grace after the uplink returns before it goes away
  again (long enough that the operator finishing setup over the AP does not have
  the connection pulled out from under them mid-request).
- **`countryCode` defaults to `"US"` and channel to 6.** A regulatory domain has
  to be set for the radio to come up at all; `US` and channel 6 are the safest
  universally-permitted 2.4 GHz combination. Deployments set their own - PLAN-008
  Part B's example uses `CN`.

### The migration, and what a rollback costs

`MigrateV2ToV3` is registered in `MigrationRegistry::default()` alongside
`MigrateV0ToV1` and `MigrateV1ToV2`, so `Store::load` walks a v0, v1 or v2
document all the way to v3 on first read.

- `up` stamps `schema_version = 3` and inserts empty `provisioning` and `wifi`
  tables when absent. It does not touch `access` at all - the v3-only keys
  inside it are supplied by serde defaults at deserialization time, which is
  what keeps `access.webAdmin` byte-identical through the upgrade.
- `down` stamps `schema_version = 2`, removes `provisioning` and `wifi`, and
  removes `ssh`, `console` and `device` from `access` while keeping
  `webAdmin`.

Rolling back to v2 therefore loses three things, deliberately and
irreversibly: **the SSH policy, the console shell policy, and the device
credential hash with its generation counter**. v2 software has no reconciler
for any of them, so keeping the keys would only produce a document v2 cannot
deserialize at all (`deny_unknown_fields` is on every struct). A rolled-back
device falls back to v2 behaviour - sshd untouched, no console shell, web admin
as the only credential - and rolling forward again restores the v3 *defaults*,
not the values that were there before the rollback. Anything that must survive
a rollback cannot live in a v3-only key.

## Scope

Owned here:

- `mosd/mosd-settings/src/model.rs` - `SCHEMA_VERSION = 3`, the `access.ssh`,
  `access.console`, `access.device`, `provisioning` and `wifi` types.
- `mosd/mosd-settings/src/migration.rs` - `MigrateV2ToV3` and its registration.
- `mosd/mosd-settings/src/lib.rs` - re-exports and the crate doc.
- `mosd/mosd-settings/tests/settings.rs` - the six R3 test groups.
- `docs/task/RFCT-021.md`.

Not owned here, and deliberately untouched: reconcilers for any of the new
subtrees (connd, sshd, the console shell), first-boot credential generation,
and anything under `os/`. This task makes the tree able to hold the
configuration; nothing yet acts on it.

### One file outside the stated scope had to change

`mosd/mosd/tests/bus.rs:102` asserted `defaults["schema_version"] == 2` as a
bare literal. That assertion cannot coexist with `SCHEMA_VERSION = 3`; the task
brief's "do not modify `mosd/mosd/**`" and "`bash mosd/hack/check.sh` must
print ALL CHECKS PASSED" are in direct conflict on this one line. It now reads
`assert_eq!(defaults["schema_version"], mosd_settings::SCHEMA_VERSION)`, so the
next schema bump does not have to touch it again. No behaviour changed and no
other line of `mosd/mosd/**` was modified.

## Work checklist

- [x] `SCHEMA_VERSION = 3`; v2 fields (`schema_version`, `hostname`, `network`,
      `access.webAdmin`) untouched at their existing serialized paths
- [x] `access.ssh` / `access.console` / `access.device` with the documented
      defaults, `deny_unknown_fields` on each
- [x] `provisioning` with the `pending`/`complete` state enum
- [x] `wifi.client` (+ `WifiNetwork`) and `wifi.ap` (+ `ApMode`)
- [x] Every new leaf reachable through the existing dot-path `get`/`set`
- [x] `MigrateV2ToV3` up and down, registered in `MigrationRegistry::default()`
- [x] `MigrateV2ToV3` re-exported from `lib.rs`
- [x] R3.1 real v2 document survives the upgrade with values compared, not
      merely "it loaded"
- [x] R3.2 v3 -> v2 -> v3 round trip
- [x] R3.3 rollback asserted key by key, both the loss and the retention
- [x] R3.4 unknown key rejected, error message asserted
- [x] R3.5 dot-path coverage of every new leaf plus the enum rejection case,
      with the tree proven unchanged after the failed write
- [x] R3.6 v0 and v1 documents walk all the way to v3
- [x] No new dependency; no change to `os/**` or `mosd/webd/**`

## Verification (2026-08-19)

Command:

```
bash mosd/hack/check.sh
```

Final lines:

```
        PASS [   0.006s] (36/67) mosd-settings::settings v3_document_migrates_down_to_v2_dropping_only_v3_keys
        PASS [   0.006s] (37/67) mosd-settings::settings v3_document_round_trips_down_to_v2_and_back
        PASS [   0.045s] (39/67) mosd-settings::settings v3_document_with_unknown_key_fails_to_load
        PASS [   0.097s] (42/67) mosd-settings::settings save_load_roundtrip_with_network
        PASS [   0.089s] (43/67) mosd-settings::settings v0_and_v1_documents_walk_all_the_way_to_v3
        PASS [   0.104s] (45/67) mosd-settings::settings save_is_atomic_and_leaves_no_temp_files
     Summary [   3.458s] 67 tests run: 67 passed, 0 skipped
advisories ok, bans ok, licenses ok
ALL CHECKS PASSED
```

67 tests, 67 passed, 0 skipped - `cargo fmt --check`, `cargo clippy
--workspace --all-targets -D warnings`, `cargo nextest run --workspace`
(including webd's `e2e web_flow_end_to_end`) and `cargo deny check licenses
bans advisories` all clean. mosd-settings contributes 25 integration tests and
2 unit tests.

### The negative tests were mutation-checked, not assumed

Each guard was removed and the suite re-run, to prove the test fails for the
reason it claims. All four mutations were reverted afterwards; `git diff` is
clean of them.

| Mutation | Result |
|---|---|
| `deny_unknown_fields` dropped from `SshSettings` | `v3_document_with_unknown_key_fails_to_load` FAILED (24 passed, 1 failed) |
| `down` stops removing `provisioning` and `access.ssh` | `v3_document_migrates_down_to_v2_dropping_only_v3_keys` and `v3_document_round_trips_down_to_v2_and_back` both FAILED (23 passed, 2 failed) |
| `down` also removes `access.webAdmin` | same two tests FAILED (23 passed, 2 failed) |
| `ApMode` given a fourth `Captive` variant, so the rejected value becomes valid | `set_rejects_unknown_ap_mode_and_leaves_settings_unchanged` FAILED (24 passed, 1 failed) |

The third row is the one that matters most: it proves R3.3 asserts the
retention of `access.webAdmin` and not merely the removal of the v3 keys, so a
future migration that quietly drops webd's credential cannot pass.

Other evidence:

- `real_v2_document_survives_the_upgrade_to_v3` drives a literal v2 TOML
  document (hostname `edge-42`, `eth0` with a static address, gateway and two
  DNS servers, and an `access.webAdmin.password_hash`) through `Store::load`
  and compares each value against the input, then asserts all 22 new leaves sit
  at their documented defaults.
- `v3_document_with_unknown_key_fails_to_load` asserts the error is
  `SettingsError::Parse` whose message contains ``unknown field `enabld` ``,
  then loads the same document with the typo corrected to prove the fixture is
  otherwise valid.
- `set_rejects_unknown_ap_mode_and_leaves_settings_unchanged` asserts the error
  is `SettingsError::Validation { path: "wifi.ap.mode", .. }` and that the whole
  `Settings` value is byte-equal to its pre-write clone, i.e. the documented
  "a failed write leaves settings untouched" contract holds for the new subtrees
  too. It also covers a bad `provisioning.state`, a string where
  `access.ssh.port` wants an integer, and a `wifi.client.networks` entry missing
  its required `ssid`.

## ActiveForm

Extending the settings tree to schema v3 with the access, provisioning and wifi
subtrees.

## Dependencies

- **blocked by**: RFCT-009 (mosd settings persistence and migration skeleton)
- **blocks**: the M5 access reconciler, first-boot provisioning, and connd -
  all three read the subtrees defined here
