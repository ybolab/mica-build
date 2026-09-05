# RFCT-322 One rotation per presence assertion, the factory-reset residue list, and a stale mirror

- **status**: completed
- **priority**: P1
- **owner**: bkd/lnr3h0hi
- **createdAt**: 2026-09-05
- **baseline**: `18cf61102d098d676807b973bdd55ab73bc7d0cf`, `main` merged at `8066477d`
- **worktree**: `/srv/bkd/worktrees/33z9aa5q/lnr3h0hi`, branch `bkd/lnr3h0hi`

## Description

Three items pulled out of [RFCT-316](RFCT-316.md)'s Gate C triage, which
recommended downgrading claims rather than implementing them. Two of its
findings are code rather than documentation and are handled here; the third
item is a stale number in a Chinese mirror.

1. **F3 — the one-rotation bound was a sentence, not a mechanism.** Closed.
2. **F1 — full-factory does not reinitialize all STATE.** MEASURED, not fixed
   and not downgraded: the residue list is delivered so the ruling can be made
   on facts. Nothing was implemented for it.
3. **`docs/zh/design/release-signing.md` §2 still said the RAUC signer window
   is two years.** RFCT-311 replaced 730 days with the 45 declared in
   `pkgs/rauc/key-validity.env` and the mirror did not follow. Fixed.

## ActiveForm

Closed the presence-assertion reuse, measured the factory-reset residue, and
brought the Chinese signing mirror back to the declared window.

## Dependencies

- **blocked by**: (none)
- **blocks**: the Gate C ruling on RFCT-316's F1 (the residue list is its input)

## Acceptance

- The reuse question answered by measurement against the shipped binaries,
  either way, with the concurrency, the iteration count and the conditions
  stated.
- If real: closed, with the losing request's status and the absence of a usable
  losing credential both asserted by that measurement.
- The residue list produced by running the full-factory path, by path, with
  what each entry is and a per-entry recommendation. No implementation.
- `docs/zh/design/release-signing.md` carries the declared window, and its
  siblings checked for the same number.
- The code compiles. **Tests were not written and no suite was run** — the
  user traded per-task verification for wall-clock on this batch and L1 runs
  an independent gate battery on the branch.
- `docs/plan/index.md`, `docs/task/index.md` and `docs/CHANGELOG.md` untouched.

## 1. Where the read and the spend are, and what made them one step — nothing

`pkgs/mosd/apid/src/routes.rs`, `api_v1_recovery_credential`:

| Step | Call |
|---|---|
| **read** | `state.presence.assert()` → `MarkerPresence::assert`, which `std::fs::read`s `/run/mos/presence`, parses it, checks the mechanism against the board declaration and the deadline against the clock |
| between | `get_settings("access")` and the claimed check; `mint_recovery_password`; `spawn_blocking(auth::hash_password)` — argon2id; `Presence::publish` to the console; `set_settings("access", …)` |
| **spend** | — **there was none.** No `remove_file`, no rename, no flag. `MarkerPresence` had exactly `assert` and `publish` |

**The marker's own properties do not supply the bound either.** It is on tmpfs
and 0600, which makes an assertion die with the boot and unreadable to a
non-root process — `mosd_settings::recovery`'s own comment says "an assertion is
spent by the boot it was made on **even if nothing consumes it**". That bounds
the window at fifteen minutes and at one boot. It does not bound the number of
rotations inside it, which is what `docs/design/recovery.md` §5.4 claims: "one
rotation per presence assertion, and the assertion is re-performed physically
for the next one."

**So there were two defects, and only one of them is a race.** A second request
arriving *after* the first has finished re-reads the same live marker and is
authorized again — no concurrency required. A second request arriving *during*
the first reads the same `access` subtree, so both compute the same
`generation + 1` and both write the whole subtree; the store applies both
faithfully and the last one wins.

This is the same shape as [RFCT-312](RFCT-312.md), and the same layer answered
it: `MosdService::set_settings` → `persist_setting` takes `inner.write()` and
serialises writes against each other, which is a different property from
serialising a read against the write that follows it.

## 2. Reachability without a fabricated seam — measured, and won every time

Not argued from the code: driven end to end. A private `dbus-daemon --session`,
the **real** `mosd` on it (`MOSD_BUS=session`, `MOSD_DRY_RUN=1`, a fresh
`MOSD_SETTINGS_PATH` and `MOSD_CONFIG_DIR` per iteration), the **real** `apid`
against it over real TLS, and real HTTP requests from
`curl -Z --parallel-immediate` — one curl process opening every transfer at
once. **No barrier, no fake backend, no instrumentation inside the handler.**
The only hooks are the two path variables the SHIPPED reader already honours,
`MOS_PRESENCE_MARKER_PATH` and `MOS_RECOVERY_DECLARATION_PATH`, so what is under
measurement is `MarkerPresence` and `api_v1_recovery_credential` as compiled.

Every iteration is a fresh factory-fresh device: both daemons restarted, the
settings file and the config documents removed, the device claimed through
`POST /api/v1/setup`, then one presence assertion written. The declaration
names a board action whose channel is a FIFO under `/dev` with a reader
attached, so **every published credential is captured** and then driven through
the real `POST /api/v1/session`. Newest first, because a failed login arms
`docs/design/access.md` §3.3's backoff and testing an orphan first would measure
the guard instead of the rotation.

Debug binaries, in `ai-agent/mos-lnr3h0hi-rust-dbus`
(`localhost/mos-build-rust-check:amd64` plus curl and openssh-client), on a host
at load average ≈7. The before and after runs **overlapped**, which makes the
after result the conservative one: load widens a race rather than narrowing it.

**Before the fix**, on the merged tree:

| Configuration | Iterations | Iterations with more than one `200` | Total `200`s | Non-`200`s | Published credentials that authenticate | That do not | Iterations where the marker survived |
|---|---|---|---|---|---|---|---|
| one rotation, then a second on the same marker | 100 | **100** | 200 | 0 | 100 | **100** | **100** |
| concurrency 2 | 100 | **100** | 200 | 0 | 95 | **105** | **100** |
| concurrency 8 | 50 | **50** | **400** | 0 | 48 | **351** | **50** |

Every attempt reproduced it, and the sequential row is the one that settles what
kind of defect this is: **the second rotation on the same marker was answered
`200` in 100 attempts out of 100**, with no concurrency at all. At concurrency 8
one presence assertion produced **eight** rotations; the device published 400
credentials and 50 of them worked.

**And the operator cannot tell which console line is real.** The harness tests
the credential published LAST first. In 5 of the 100 concurrency-2 iterations
that one did not authenticate — publication order and commit order are not the
same order — so reading down the console does not identify the live credential.

**After the fix, same harness, same conditions:**

| Configuration | Iterations | Iterations with exactly one `200` | Losing responses | Distinct losing codes | Published credentials that authenticate | That do not | Iterations where the marker survived |
|---|---|---|---|---|---|---|---|
| one rotation, then a second on the same marker | 100 | **100** | 100 | `403` | 100 | **0** | **0** |
| concurrency 2 | 100 | **100** | 100 | `403` | 100 | **0** | **0** |
| concurrency 8 | 50 | **50** | 350 | `403` | 50 | **0** | **0** |

**The loser's outcome, asserted and not assumed.** Across all 250 iterations
every one of the 550 losing requests answered `403` — not a 500, not a silent
`200` — carrying `presence_required` with the sentence that the assertion has
already been spent by a credential recovery and must be asserted again at the
device. No losing request published anything: the device emitted **one**
credential per assertion and **every** credential it emitted authenticated, so
there is no orphan for an operator to be handed. The marker was gone in every
iteration.

## 3. The fix, and where the atomicity is

`Presence` gains a third operation, `spend`. `MarkerPresence::spend` unlinks
`/run/mos/presence` and remembers which assertion it took; `AppState` gains
`rotation: Arc<tokio::sync::Mutex<()>>`, taken before the `assert` and held
past the commit and the spend.

**The guard follows RFCT-312's shape, and it is in apid for RFCT-312's
reason.** This route is the only thing in the tree that spends an assertion —
`POST /api/v1/reset` only reads one, and mosd has finished writing the marker
before apid can answer any request at all — so a second guard would be a second
place for the rule to fail. The hold is bounded: `MOSD_CALL_TIMEOUT` bounds each
mosd call, the hash is one argon2id, and the publish is a write to the console
the board declared. After one rotation succeeds, every further request takes an
uncontended lock, reads a spent assertion and is refused **before** the hash.

**The spend follows the commit; it does not precede it.** Two orders were
available and the difference is what an aborted rotation costs. §5.4's third
rule is that a refused or aborted rotation clears nothing, and an assertion is a
trip to the device: `an_interrupted_rotation_writes_nothing_and_the_retry_leaves_one_credential`
already required that a rotation whose commit failed can be retried on the
device as it stands. Spending first would have turned every mosd hiccup into a
second walk to the board. The cost of spending last is stated rather than
hidden: a rotation whose *unlink* fails is a rotation that happened, so it
answers 200 and logs the failure instead of unsaying a commit, and
`MarkerPresence` keeps the bound in memory meanwhile.

**A remembered marker, not a spent flag, and it is not the authority.** The
unlink is the authority and it survives an apid restart, which the in-memory
value does not. What the remembered value buys is the operator's answer: an
absent marker with nothing spent is `Absent` — "presence is not asserted" —
which is the wrong sentence for somebody standing at the device who asserted it
ninety seconds ago. `NoPresence::Spent` says the assertion was used by a
credential recovery and to assert it again. It stores the whole marker rather
than a bit because mosd re-maps the command line if it restarts inside a boot,
and a bit would refuse the fresh assertion that restart wrote.

**`apid.service` gains `RuntimeDirectory=mos`.** apid runs under
`ProtectSystem=strict` with `ReadWritePaths=/mos/ui`, so `/run` is read-only to
it and unlinking a file needs write on its *directory*. `ReadWritePaths=/run/mos`
would not do: it binds at unit start and `/run/mos` does not exist on an
ordinary boot, so the exemption would be missing exactly when the assertion is
not. `RuntimeDirectoryPreserve=yes` because `/run/mos` is mosd's directory — the
marker, the rendered mqtt config, the timezone — and a unit that deleted it on
every restart would take mosd's runtime state with it.

**This does not make apid a writer of presence.** §4.2's rule is that no API can
CREATE an assertion, because a presence flag an API can set is not presence.
Spending one only ever removes authority. The rule and its reason are restated
at both sites.

## 4. What was NOT changed, and why

- **`POST /api/v1/reset` does not spend the assertion.** §2.2 makes no
  one-reset-per-assertion claim, and the finding is about the rotation. The
  interaction is real and is now written down rather than discovered: a
  rotation spends the marker, so a full-factory reset wanted in the same visit
  needs presence asserted again — or a board action that declares the tier
  (§4.2 step 4), which stages it at boot without the API at all.
- **RFCT-316's F4 (audit branches) and F2 (durability of the reset) are
  untouched.** Both are documentation rulings in that task's triage; neither
  is this task's scope, and neither is repaired here.
- **`mosd` gained no bus method and `SettingsApi` gained no compare-and-set.**
  RFCT-312's reasoning applies unchanged: it would be a bus-surface change for
  one caller.
- **The refusal is 403 `presence_required`**, the code every other presence
  refusal already uses, with a message of its own. A new error code would have
  split one door into two for a caller that has to handle the door being shut
  either way.
- **No test was written and no suite was run**, on the user's instruction for
  this batch. What that leaves owed is named in §7.

## 5. RFCT-316's F1: what a full-factory reset actually leaves — MEASURED

**Nothing here is fixed and nothing is downgraded.** The brief asks for the
list before anyone rules, because *"this device keeps its pairing keys through a
factory reset"* is a different sentence for a device that changes hands than for
one that does not, and both the completion and the downgrade are guesses until
the list exists.

### 5.1 How it was measured

Not read off the code: run. In one container,

1. `rootfs/overlay/usr/lib/mos/mos-seed-state` and
   `rootfs/overlay/usr/lib/mos/mos-data-layout`, **unmodified**, against
   `/mnt/state` and `/mnt/data`, so the trees are the shipped seeders' own —
   real `ssh-keygen`'d host keys included;
2. the real `mosd` and the real `apid` on a private session bus; the device
   claimed through `POST /api/v1/setup` and the tier staged through
   `POST /api/v1/reset {"tier":"full-factory"}` — **202**, so the intent record
   is the route's and not a hand-written one;
3. STATE and DATA populated with what a device in service accumulates, each
   secret a distinct sentinel string;
4. the real `mosd` started again with `MOSD_STATE_ROOT` and `MOS_DATA_ROOT` at
   those trees, so `reset::apply_pending` executed — `reset applied
   tier=FullFactory`;
5. `find` and `md5sum` either side of it. **Content, not paths**: `/mos/config/`
   is emptied by the re-seed and immediately rewritten at its defaults by the
   same `Store::save`, so a path-only diff would have called that survival.

## 6. The Chinese mirror and the signer window

`docs/zh/design/release-signing.md` §2 said the signer is
短有效期（2 年）. That was correct until 2026-09-04: the ceremony block minted
`-days 730`, and PLAN-078 §3a replaced it with **45 days**, landed by
[RFCT-311](RFCT-311.md) as the declared value
`MOS_RAUC_SIGNER_VALIDITY_DAYS=45` in `pkgs/rauc/key-validity.env`. The English
document moved; the mirror did not.

The bullet now states 45 days, dates the decision, says what it replaced, and —
the part that matters more than the number — names the **single declaration**
and the gate that holds the English ceremony block to it
(`build/src/signer-window.test.ts`), so the next change to the window has one
place to be made and this mirror has a reason to be checked. It also carries
the short window's reason, which the Chinese text did not have: there is no CRL
path to devices, so a stolen signer is out-waited rather than revoked.

**The siblings were checked and are clean.** `grep` for `730`, `2 年`, `两年`,
`有效期` and `signer` across `docs/zh/` finds the CA's 15 years (unchanged and
correct), two unrelated token-expiry sentences in the built-in-UI documents, and
`docs/zh/design/build.md`'s references to `gen-dev-keys.sh` and the signer file
paths, which carry no number. No other Chinese document states a signer
validity, and none carries the pre-decision shape of a bare literal with no
pointer to the declaration.

## 7. What is owed, because it was not done here

Named rather than written, on the user's instruction for this batch. L1 owns the
independent gate battery on this branch.

- **`cargo test --locked -p mosd -p apid` was not run at first report, and L1's
  gate found what that cost** — see §8. It has since been run and is **green**:
  831 tests, apid 319 + 1 e2e, mosd 503 + 1 bus + 7 scan, 0 failed, in
  `localhost/mos-build-rust-check:amd64` (rustc 1.98.0). `cargo check
  --workspace --all-targets --locked` is green on the same tree.
- **A unit test for the bound.** The property measured in §2 belongs in
  `pkgs/mosd/apid/src/tests/reset.rs` beside
  `an_interrupted_rotation_writes_nothing_and_the_retry_leaves_one_credential`:
  a second rotation on one `FakePresence` assertion must be refused, and the
  refusal must be `Spent` rather than `Absent`. It is not written.
- **`RuntimeDirectory=mos` was not exercised on a device.** The unlink was
  measured against a marker in a scratch directory, which is what
  `MOS_PRESENCE_MARKER_PATH` exists for; nothing here booted an image and
  proved that apid under `ProtectSystem=strict` can remove `/run/mos/presence`.
  That is an image-gate question and it is the one thing in this change a
  source-level gate cannot answer.
- **The residue rulings.** §5 delivers the list and a recommendation per entry.
  Neither the wipe nor the downgrade is implemented, by instruction.

### 5.2 What the reset DID do, so the finding is not overstated

Removed, and correctly: STATE `quadlet/app.container` and
`systemd-units/app.service`; DATA `/mos/apps/*`, `/mos/containers/*`,
`/mos/home/*`, `/mos/root/*`, `/mos/ui/*`, `/mos/updates/downloads/*`,
`/mos/diagnostics/` (directory and all — it is not in `SYSTEM_SKELETON`, so the
re-seed removes it outright) and `/srv/*`. `settings.toml` lost
`access.webAdmin`, `access.claim`, `access.apiTokens` and the `reset` record and
kept `access.device.generation` and `provisioning.deviceId`.

**PLAN-070's `/mos/config/` namespace is genuinely re-seeded**, and this was
checked by content rather than by path. Five documents were given operator
values through the shipped `PUT /api/v1/settings/{path}` route and every one
came back at its default:

| Document | before | after |
|---|---|---|
| `container.json` | `enabled: true` | `enabled: false` |
| `mqtt.json` | `enabled: true` | `enabled: false` |
| `ssh.json` | `enabled: true` | `enabled: false` |
| `system.json` | `hostname: "residue-sentinel-host"` | `hostname: "mos"` |
| `time.json` | `timezone: "Europe/Berlin"` | `timezone: "UTC"` |

`network.json` and `wifi.json` came out byte-identical because the write route's
allowlist cannot reach them, so they were at their defaults on both sides; they
are re-seeded by the same directory sweep as the five above, but that is
inference here rather than measurement.

**So the DATA half of §2.1's tier-3 row holds.** The finding is the STATE half.

### 5.3 The residue: what survives a full-factory reset, byte for byte

`/mnt/state`, i.e. `/var/lib/mos` plus the sibling directories the other bind
mounts expose. Every row below was **identical before and after** by `md5sum`.

| Path | What it is | Recommendation |
|---|---|---|
| `bluetooth/<adapter>/<device>/info` | **bluez pairing material** — `[LinkKey]`, and on a real device the long-term and identity-resolving keys with it. Seeded by `mos-seed-state` at 0700 and bound to `/var/lib/bluetooth` by the `mos-bluetooth` package | **Wipe.** A pairing key is a credential that lets a peer reconnect with no further authentication. On a device that changes hands, every phone and peripheral the previous operator paired stays able to connect, and the retained adapter identity makes the device the same device to anything that saw it before. Tier 3's own sentence is "management credentials all go" |
| `wpa_supplicant/wpa_supplicant-*.conf` | **every joined network's PSK, in cleartext.** mosd's WiFi reconciler renders it; 0700 is why the mode matters and not why the content may stay | **Wipe.** The plaintext WiFi password of the previous site leaves with the hardware. The settings that produced it are cleared by the `/mos/config/` sweep, so what survives is an orphaned render of settings that no longer exist |
| `hostapd/hostapd.conf` | **the AP passphrase, in cleartext**, same render-and-orphan shape | **Wipe**, for the row above's reason |
| `ssh/ssh_host_{rsa,ecdsa,ed25519}_key` and `.pub` | **the device's SSH host identity**, generated once per device by `mos-seed-state` | **Wipe.** `mos-seed-state` regenerates any host key it does not find, on the next boot, so removal has a defined and already-shipped recovery. Retaining them means the previous owner's `known_hosts` still matches — the warning that would flag a device that changed hands does not fire — and the host key stays a stable fingerprint across the operation the product calls a factory reset. §7's whole-disk reflash *does* replace them, which is why that step's identity sentence is true and this tier's is not |
| `ssh/sshd_config`, `ssh/ssh_config`, `ssh/ssh_config.d/` | image copies carried across by `cp -an`, **including any operator edit**, because STATE wins over the image | **Wipe.** They are re-carried from the image on the next boot by the same `cp -an`, so removing them restores the image's copy, which is what "first-boot state" means. Left alone, an operator's edit outlives the operator |
| `mos/apid/key.pem`, `mos/apid/cert.pem` | **apid's TLS private key** and its self-signed certificate | **Wipe** (apid mints them when they are absent). The previous owner holds the certificate the device still presents, and any client that pinned it trusts a device it no longer owns |
| `mos/apid/session.key` | **the session-cookie signing key** | **Wipe.** It is the secret that makes a session cookie authentic; keeping it through the reset that deleted `access.webAdmin` keeps a key that can forge sessions on the device it was minted for |
| `mos/apid/audit.log` | the audit ring: the previous operator's logins, resets, recovery events and their sources | **Retain, and say so in §2.1.** An audit trail a factory reset erases is one an attacker erases *with* a factory reset, and the reset itself is audited — an erased trail would delete the record of the deletion. But it hands the previous operator's history to the next one, so a handover procedure has to copy-and-destroy it deliberately, which it can only do if the document says the trail survives |
| `mos/secrets/*` | the per-device secrets drawn at first boot | **Retain.** Already deliberate: §2.1 footnote `[^identity]`, and re-minting severs every fleet-side record naming the device |
| `mos/mqtt-broker-users.toml` | the broker's user file, **with credential hashes**, rendered by mosd from `mqtt` settings | **Wipe.** `mqtt.json` is re-seeded to `enabled: false`, so this is a render of settings that no longer exist, carrying hashes nothing will remove |
| `mos/update/tuf-mirror/*` | the mirrored TUF metadata: a cache of public data | **Wipe**, as a cache. It re-syncs on the next `rauc-update sync`, and a factory reset that leaves gigabytes of mirror behind has not returned the device's storage to first boot |
| `mos/update/uptane-state.json` | the persisted rollback floor — the version the device refuses to go below | **Retain, and say why.** It is a security control, not operator data: wiping it lets a stale bundle be installed on a device that had already refused it. This is a `preserved` cell the table does not currently have |
| `mos/update/reserve/*.raucb` | downloaded update bundles, up to gigabytes | **Wipe.** Not operator data, but storage the tier promised to return |
| `timesync/clock` | the last-known-good clock floor | **Retain, and say why.** Wiping it leaves the device believing it is at the epoch, and under PLAN-078's 45-day signer window a device with an epoch clock refuses every bundle whose signer is valid *now*. Wiping it would brick updates until NTP lands |
| `hostname` | the STATE copy `etc-hostname.mount` binds over `/etc/hostname` | **Retain.** First-boot provisioning re-derives the hostname from the preserved `deviceId` on the same boot, so a re-seed and a retain produce the same name. Noted as **not measured**: this harness kills mosd 0.5 s after the apply, before the hostname reconciler runs |
| `mos/settings.toml` | rewritten, correctly (see §5.2) | — |

**One loose observation, not a claim.** A stray `/mos/config/.tmpXXXXXX` was
present after the run. `Store::save` writes temp-and-renames, and this harness
kills mosd half a second after the apply, so it is most likely this harness's
own artefact rather than the applier's — but it was seen, and it is cheap for
whoever rules on F1 to look once.

### 5.4 What the list says about §2.1

The tier-3 STATE cell reads **`re-seeded`**, defined in that section as "the
tier removes the contents and the next boot recreates them at their first-boot
defaults". Measured, tier 3 delivers `re-seeded` for the settings tree and the
two application unit directories, and `preserved` for everything else on STATE
— including four kinds of credential (pairing keys, WiFi and AP PSKs, the TLS
key, the session signing key) and one SSH host identity. That is RFCT-316's F1,
with paths.

**The list is delivered; the ruling is not made here.** Both dispositions are
available on this evidence — extend `clear_application_state` to the named
directories, or change the cell and say plainly that a factory reset is not a
handover operation and §7's reflash is — and the brief reserves that call.

## 8. The gate `cargo check` cannot see, and what the diff said

L1's battery ran `cargo test --locked -p mosd -p apid --no-fail-fast` and got
one red out of 831: `the_committed_openapi_document_is_the_generated_one`.
`pkgs/mosd/apid/openapi.json` is asserted byte-for-byte against
`apid --openapi`, and `utoipa` builds that document out of the handler's
`#[utoipa::path(responses(...))]` **and its rustdoc**. Both moved in this
change, so the committed document was stale. **`cargo check` cannot see this**
— the crate compiles either way — and this branch was the third this week to
land on it, so L1 has put "regenerate `openapi.json`" in the dispatch preamble.

Regenerated, and the diff read before committing. It is **two fields on one
operation**: the `403` description, and the operation description. And the
second one was the finding L1 said to look for.

**A handler's rustdoc is published API text, and I had put a defect report in
it.** The paragraph I added ended with *"Before this guard existed the marker
was read and never taken … one assertion answered two rotations in 100 attempts
out of 100, and two concurrent callers were both answered 200 in 100 iterations
out of 100"* — which is true, useful, and belongs nowhere near a document a
client generates a stub from. An OpenAPI description states the contract a
caller must satisfy today, not the history of the bug that used to break it.
Worse, that sentence was also the one place still carrying the pre-final
phrasing "only the last-written credential authenticated", which §2's finished
measurement had already refined.

So the published paragraph is now four sentences of contract — one rotation per
assertion, a second request is refused `403` `presence_required` having written
nothing, the next rotation needs presence asserted again — and the whole
measurement moved into the comment at the guard, which `utoipa` does not read.

**And then the same mistake once more, one layer down.** The first fix left a
note reading *"This paragraph is PUBLISHED: utoipa copies it into
openapi.json…"* as a `///` line — so the API document acquired a paragraph
explaining utoipa to its readers. It is a `//` comment now. Reading the
generated diff is what caught both; neither is visible in the source.

Final state: `openapi.json` regenerated (`+2 -2`), and
`cargo test --locked -p mosd -p apid --no-fail-fast` **green at 831 tests**.
