# RFCT-314 The `/mos/config/` namespace and the settings store's move onto it

- **status**: completed
- **priority**: P1
- **owner**: plan070-f6cdef/bkd-dgr8l3eq
- **createdAt**: 2026-09-05 02:10

## Description

PLAN-070 §5.2 decided that `/mos/config/` is **the home of system
configuration** — mqtt, the ssh switch and everything of that sort together —
so that an integrator can flash a device, pour the configuration in, and have
it work with no provisioning ceremony between the two. This task is slices
**F6c, F6d, F6e and F6f**, which the plan's own backlog says are one change and
not four: *shipping the documents without the mode publishes the Wi-Fi key, and
shipping either without the fail-closed mount produces a device that comes up on
defaults when DATA is missing.*

- **F6c** — the namespace: `mos-data-layout` creates `/mos/config` at `0700`,
  §5.2.7's rules are written where a subsystem author meets them
  (`docs/design/mosd.md` §5.1a), and tier 1 re-seeds the subtree in `reset.rs`.
- **F6d** — the store's move: per-reconciler documents, one schema version each
  starting at v1, the `V0→V12` chain deleted with the document it migrated, and
  `Settings` split into the moved half and the STATE half.
- **F6e** — the mode and the secrets charter: directory `0700`, every document
  written `0600` with the mode set before the rename, and the redactor naming
  rule written at the redactor's own list.
- **F6f** — fail-closed on the medium: `RequiresMountsFor=/mos` on mosd, and a
  refusal that **names the mount** instead of starting on schema defaults.

F6g — the pour — is deliberately not here; it is separable and is a different
task.

## ActiveForm

Moving system configuration to `/mos/config/` and making a missing medium a
refusal.

## Dependencies

- **blocked by**: (none)
- **blocks**: F6g (the pour), F6b (`/mos/config/updates.json`)

## Acceptance

Per the dispatch, this batch trades per-task verification for wall-clock: **no
tests were written and no test suite was run.** The floor that stands is that
the code compiles.

- `cargo check --offline --locked --all-targets` green for the whole
  `pkgs/mosd` workspace in `localhost/mos-build-rust:amd64` — lib, bins and
  every test target, warning-free.
- `bash -n` green on `rootfs/overlay/usr/lib/mos/mos-data-layout`,
  `tests/mos-data-layout-test.sh` and `boards/cx3576/board.env`.
- `docs/verify-index.sh`, `docs/verify-links.sh`, `docs/verify-status.sh` green
  (read-only doc lints, not a suite).
- `docs/plan/index.md`, `docs/task/index.md` and `docs/CHANGELOG.md` untouched.

**Owed, and named rather than quietly skipped** — see §6.

## 1. The shape: one addressed tree, several documents

`Settings` is still the one tree every reader and every dot-path sees.
Underneath it, `pkgs/mosd/mosd-settings/src/documents.rs` is the storage shape
and `store.rs` is the only thing that converts between the two.

| Document | Carries | Reconciler |
|---|---|---|
| `/mos/config/system.json` | `hostname`, `access.console` | hostname |
| `/mos/config/network.json` | `network` | network |
| `/mos/config/wifi.json` | `wifi` | wifiAp, wifiClient |
| `/mos/config/ssh.json` | `access.ssh` | sshd |
| `/mos/config/mqtt.json` | `mqtt` | mqtt |
| `/mos/config/time.json` | `time` | time |
| `/mos/config/container.json` | `container` | container |
| `/var/lib/mos/settings.toml` | `provisioning`, `access.webAdmin`, `access.device`, `access.claim`, `access.apiTokens`, the staged `reset` intent | — |

The split is §5.2.1's boundary, which is the tier-1 reset partition rather than
a new judgement. `DocumentSet::of` and `DocumentSet::compose` are both total, so
a field added to `Settings` and forgotten in one direction does not compile.

**Two decisions the plan left to the implementation, stated because a reader
will check them against §5.2.5's prose:**

1. **Each document nests its subtree under the settings key it carries** —
   `ssh.json` is `{"schema_version": 1, "ssh": {…}}`, `network.json` is
   `{"schema_version": 1, "network": {…}}`. §5.2.5 illustrates the mapping with
   two examples that do not agree with each other (`mqtt.enabled` flattened to
   `enabled`, `access.ssh.enabled` kept as `ssh.enabled`); the nested form is
   the one that matches the second. It is also the one that works: flattening
   would need `#[serde(flatten)]`, which serde refuses to combine with
   `deny_unknown_fields` — the whole validate-by-deserialize discipline — and it
   would put interface names in the same namespace as `schema_version` inside
   `network.json`.
2. **The STATE remainder stays TOML at `/var/lib/mos/settings.toml`.**
   §5.2.7's JSON rule is stated for `/mos/config/` and the remainder is not in
   that namespace, so its format was not changed. One `Format` enum carries the
   two, and both parse into `serde_json::Value` before the version check, so the
   tolerant load below has one implementation and not two.

## 2. Versions: per document, and the chain is gone

Every document starts at **v1**, including the STATE remainder — it is a
document too and is not exempt for being what is left over.
`pkgs/mosd/mosd-settings/src/migration.rs` is **deleted**, with the trait, the
registry and all twelve steps: there is no fielded device holding a v12
`settings.toml`, so a split chain would have been code written to convert a
document that does not exist. The four rules the chain taught — additive bumps,
a `down` that states what it discards, A/B rollback survivability as the reason
for both, and **no migration that moves a key between documents** — are written
into `documents.rs`'s module docs and `docs/design/mosd.md` §5.2.

`schema_version` is **no longer a key of the addressed tree.** There is no
tree-wide version left to address. Consequences, each handled:

- `GET`/`PUT /api/v1/settings/schema_version` is now a **404** (a root the typed
  schema has no field for) instead of a named **409**. apid's
  `is_settings_root` derives from `Settings::default()` and needed no edit; the
  hardcoded refusal arm beside it was removed.
- `GET /api/v1/meta`'s `settingsSchemaVersion` now reports
  `STATE_SCHEMA_VERSION`. The member is kept because it is a published API
  contract with a UI type behind it; `docs/design/api.md` §2.1 now says plainly
  what it can and cannot answer, and that a client cannot get per-subtree
  version information from it. **Whether the member survives at all is a real
  question and it is not this task's to answer.**
- `SettingsError::ReadOnly` lost its only producer. It is kept, with the reason
  written at the variant: `mosd::bus` maps it to
  `com.mos.mosd1.Error.ReadOnly` and apid maps that name to a 409, so retiring
  it is a change to the bus contract and belongs with whoever owns that.

**The tolerant newer-schema load survives, per document.** It is the A/B
rollback path and the reason the additive rule exists, so it was ported rather
than dropped: `load_newer` strips unknown keys by the names serde's rejections
give until the document parses, and falls back to that document's schema
default if a future schema reshaped a key. The blast radius of that loss shrank
from "every setting including the admin credential, device back in setup mode"
to one document.

## 3. The mode, the secrets, and the write

- `mos-data-layout` gains `ensure_dir "$SYSTEM_ROOT/config" 0700`, beside the
  `0700` it already creates for `/mos/root`, with the reason at the line: the
  namespace is **credential material**, `wifi.json` carries the site's WPA2
  pre-shared key, and `0755` would publish it to every process on the device.
- `Store`'s writer sets each document's mode to `0600` **before** the rename —
  the same discipline `mosd::fswrite::write_config` carries, implemented in the
  store because `fswrite` lives in the `mosd` binary crate and `mosd-settings`
  cannot reach it. A document that replaces a laxer one lands `0600`.
- **A document whose bytes did not change is not rewritten.** That is what makes
  a write's blast radius one document: setting `mqtt.enabled` leaves the other
  six byte-identical, inodes included.
- The redactor naming rule (§5.2.4.2) is written at
  `pkgs/mosd/apid/src/redact.rs`'s `SECRET_FIELDS`, where an author adding a
  field meets it. **The moved schema satisfies it with nothing added**: the only
  secret-bearing keys in the namespace are `wifi.ap.psk` and
  `wifi.client.networks[].psk`, both spelled `psk`, which is already on the
  list. `mqtt.auth` carries no credential — the broker reads its accounts from
  a STATE file, the rule already stated at that field.

## 4. Fail closed on the medium

`Store::ensure_config_medium` refuses when `/mos/config/` is not a directory,
and both `load_with_report` and `save` call it first, so no path reaches schema
defaults by accident. The error is a new `SettingsError::Unavailable` whose
message **names the mount**:

> `/mos/config` is not there, so this device has no configuration to render:
> `/mos` is not mounted. Refusing to start on schema defaults — a device that
> cannot read its configuration must not render a different one

`pkgs/mosd/dist/mosd.service` gains `/mos` to its `RequiresMountsFor`, which
also orders mosd after `mos-data-layout.service` (that unit runs
`Before=mos.mount`), so the directory exists at its declared mode before mosd
looks. `mosd::bus` maps the new variant to `org.freedesktop.DBus.Error.IOError`
— the caller asked for something reasonable and the device cannot reach the
store.

**The asymmetry is deliberate and is written down in three places: an absent
document is a default, an absent namespace is a refusal.** A document that was
never written is a subsystem that was never configured; a namespace that is not
there is a medium that did not mount.

`MOSD_CONFIG_DIR` relocates the namespace, mirroring `MOSD_SETTINGS_PATH`. It is
a variable of its own rather than derived from `MOS_DATA_ROOT` because what mosd
reads is the `/mos` bind and what `mos-data-layout` and `reset.rs` write is the
pool underneath it.

## 5. Tier 1, and the safety property that had to be re-anchored

`reset.rs`:

- `SYSTEM_SKELETON` gains `config`, so tier 3's re-seed empties it with every
  other declared directory and needs no clause of its own.
- Tier 1 clears `/mos/config/`'s contents — the same operation tier 2 already
  performs on `apps/` and `containers/`. §4.1's objection to the previous
  revision's answer does not survive the move: what was expensive at a file
  granularity is ordinary at a directory granularity.
- `reseeded_settings` is unchanged in behaviour and its comment is not: the
  survivor list is now exactly what STATE holds, because everything it used to
  clear moved out.

**The property that had to be written down rather than left to travel with the
function that carried it**: `reseeded_settings` fails safe by naming survivors
rather than clearing them, so a subtree added to the schema is cleared by
default. Under the move that property is carried by the **directory sweep**
instead — which is strictly wider, because it also reaches documents mosd does
not model at all (`updates.json`, `fleet.json`, anything a later slice adds).
The reason is now at `CONFIG_DIR` in `reset.rs` and in `recovery.md`'s new
`[^cfg-mos]` footnote.

`docs/design/recovery.md` §2.1's tier-1 `DATA (/mos)` cell moves from
`preserved` to `re-seeded [^cfg-mos]`, and `config/` joins `[^apps-mos]`'s list
of subtrees tier 2 does not open. PLAN-070 §4.1 assigns that cell to F6c in
terms (*"F6c carries it"*), which is why it is here and not left to F10.

## 6. What was NOT verified, and what is owed

**Nothing in this task was executed.** `cargo check --all-targets` compiles
every test target; it runs none of them. The store's read and write paths, the
tier-1 sweep, the mode on a written document and the refusal's message have
been **compiled and never run**.

**Tests deleted with their subject** — 25 of the 60 in
`pkgs/mosd/mosd-settings/tests/settings.rs`, every one of them about the
`V0→V12` chain or about a whole-document TOML fixture stamped with a tree-wide
version. Naming the coverage that went with them, because two of these were
about properties that still hold and now have no test:

- `v3_document_with_unknown_key_fails_to_load` — the fail-closed rule for a
  document that parses as TOML but carries a key the schema does not know. The
  rule is unchanged and is now per document; nothing asserts it.
- the four `newer_*` / `stripping_*` tests — the tolerant rollback load. The
  mechanism was ported and generalised over `serde_json`, and **none of the
  ported code has ever been executed.** This is the least-tested and
  highest-consequence part of the change.

**Tests adapted, not rewritten** — the `Store::new` call sites gained the
namespace argument, `load_with_report`'s report became a `Vec`, and five
fixtures moved from a whole-document TOML tree to the document that now carries
the subtree. Their assertions say what they said before.

**Owed, in the order I would write them:**

1. The tolerant load, per document: additive strip, reshaped fallback, and that
   a rollback in one document leaves the other seven alone.
2. A parse error in one document refuses the load and names it; an absent
   document is still a default.
3. `ensure_config_medium`: a store whose namespace is missing refuses, the
   message contains `/mos`, and no schema-default tree is produced.
4. F6e's own gate: a document lands `0600` even when it replaces one that was
   laxer, and an enumeration of the moved schema's secret-bearing field names
   against the redactor's list that goes red when a name is added to one and
   not the other.
5. F6d's gate: a key written to one document leaves the others byte-identical.
6. Tier 1 clears `/mos/config/` including a document mosd does not model, and
   leaves `ui/`, `apps/`, `containers/`, `updates/`, `home/` and `root/` alone.

**Out of scope and left alone, deliberately:**

- `docs/design/updates.md` §2's *"PLAN-061 keeps small authoritative metadata on
  STATE and sends only large bytes to `/mos`"*, which §5.2.6 says must be
  rewritten. That paragraph is about `update-policy.toml`'s tier, which F6b
  retires outright and F10 owns; editing it here would collide with both.
- `docs/zh/design/` — the Chinese mirrors of `mosd.md`, `api.md`, `access.md`,
  `connd.md` and `provisioning.md` now lag their English sources. `design/` is
  not one of `docs/zh/verify-coverage.sh`'s gated trees, so nothing goes red;
  the lag is real all the same.
- `docs/plan/index.md`, `docs/task/index.md`, `docs/CHANGELOG.md` — L1's.
