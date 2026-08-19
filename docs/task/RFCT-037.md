# RFCT-037 Access-model documentation, implementation-status markers, and the dead-control demotion

- **status**: implementation complete — `bash docs/verify-index.sh` (0 FAILED)
  and `bash mosd/hack/check.sh` both green; no on-device behaviour is claimed
- **priority**: P1
- **owner**: ai-agent
- **createdAt**: 2026-08-19 13:30
- **claimedAt**: 2026-08-19 13:30
- **completedAt**: 2026-08-19 14:45

Campaign `l1-o7ee8v0o-20260819093920-sshweb`. Branch `bkd/vbp2wlp6`, merged by
L2 into `bkd/hiu25adw`. Last task of the campaign: every other task had already
merged, so this one makes the documentation describe what actually shipped and
closes two code items nobody else owned.

## Description

The campaign replaced the phase-1 access model — per-device password in
`/etc/shadow` — with SSH off by default, no root password by default,
persistent access by public key, and an operator-set root password that is
transient. `docs/design/access.md` still described the superseded model, three
other design documents carried statements the code contradicts, eleven task
records had no row in the index, and two small code items were left over.

## What changed

### 1. `docs/task/index.md` — eleven missing rows plus this one

`bash docs/verify-index.sh` named eleven records with no row (032–036, 038, 039,
047, 048, 053, 054). A twelfth was needed for **this** record, which the tool
could not name until the file existed — the row an author most reliably forgets
is the one for the record being written in the same pass.

No list of numbers was worked from, deliberately. The record set changed three
times during the campaign; the tool is authoritative and self-maintaining, so
the loop was: run, close what it names, re-run.

### 2. `docs/design/access.md` — rewritten to the shipped model

- **§0 (new): status markers.** Every mechanism section now carries
  **[implemented]** with the implementing path, **[partial]** with what is
  missing, or **[not implemented]**. `PLAN-010 M4` already does this at
  milestone level; a design document needs it for the same reason.
- **§3, §4: the model as shipped.** Schema v4, `access.ssh.authorizedKeys`,
  one rendered key file per managed login account, the static
  `AuthorizedKeysFile` drop-in, and the transient root password with its marker
  and boot-time clear. The M5 per-device-password model is recorded as
  **superseded, with its reasons, in §4.2** rather than deleted.
- **Every authorized key is a root key**, stated as plainly as webd's SSH pane
  already states it. `mos` is a persistent working directory and a non-root
  default shell, **not a lesser privilege level**.
- **§5.2, §6: the two not-implemented sections**, below.
- **§9 (new): the recovery path**, below.
- **§10 (new): the persistence model**, below.
- **§11 (new): two Venus OS divergences**, below.

### 3. Two sections marked *not implemented*, and why that class is the worst one

**The META lockdown (§5.2).** `grep -i lockdown` across every `.rs`, `.sh` and
`.conf` returns nothing outside `docs/`. The one-way bit, the daemon that
ignores config when it is set, and the reset that preserves it do not exist.

**Factory reset.** Nothing performs one. The only mention in code is a doc
comment in `mosd/mosd/src/provisioning.rs` explaining why wiping STATE *would*
return the device to first boot. So §5.2 described a reset nobody can invoke,
preserving a bit nobody can set.

**Why this class is worse than dead code.** Dead code has a compiler, a test run
and a grep-for-callers that can surface it. **A security control that exists
only as prose has no mechanism that will ever notice it is absent.** That is the
reason a reader should distrust an undated design paragraph, and the reason §0's
markers were added rather than the two paragraphs being quietly deleted.

Neither was implemented here. Whether the lockdown is built at all is a product
decision going to the user.

### 4. §9 — the recovery path, attributed honestly

An operator who loses the webAdmin password **and** every authorized key has no
software path back in. The serial console is **present and reachable** — be
precise, because "there is no console" would be wrong: systemd's getty-generator
spawns `serial-getty@ttyFIQ0` from the kernel `console=` parameter on both
profiles (`os/rootfs/Dockerfile.v2` records exactly this and ships no getty unit
of its own). A login prompt appears; no account will accept a credential.

**This reads like a regression and is not one.** Under M5 the device password
did reach `/etc/shadow`, so the console path was nominally usable — but nothing
ever exposed that password to the operator, which is M5's own recorded gap. The
path was already unusable; this campaign makes it *honestly* unusable rather
than closing a working door. A reader who believes a regression happened goes
looking for the wrong fix.

**What a whole-disk reflash recovers.** The v2 image carries all eleven
partitions and `os/mkimage-v2.sh` builds fresh ext4 filesystems for META, STATE
and DATA into it, so flashing replaces credentials and identity (STATE),
appliance metadata (META), and the operator's home and files (DATA). That is the
appliance equivalent of Victron's physical-access guarantee, at the cost of
everything stored.

**One precision that must not be rounded off:** DATA grows past the flashed
image's extent on first boot, so a reflash leaves the blocks beyond that extent
on the disk, unreferenced by the new GPT. **"Cleared" means unreachable through
the new filesystem, not erased.** An operator disposing of a device needs that
distinction.

### 5. §10 — the persistence model (model A), decided by the user

Configuration persists **through the settings tree**. **No `/etc` overlay.**
Consequences now stated in the document: an **unmodelled setting is an
unsupported setting**; a file that genuinely must be hand-edited gets **a new
bind** — one mount unit plus one verifier assertion — and the image ships
**eight** today (`etc-ssh`, `etc-hostname`, `etc-wpa_supplicant`, `etc-hostapd`,
`var-lib-mos`, `var-lib-bluetooth` on STATE; `home`, `root` on DATA); files,
scripts and data belong in `/home`, `/root` or `/srv`.

§10.4 is a **survives-what table** — settings tree / `/home` + `/root` + `/srv`
/ arbitrary `/etc` edits / `/var`, against reboot, A/B update and factory reset,
with §9.2's reflash precision carried into the reset column.

§10.5 records the rejected alternative: an overlay with upper on STATE creates
two sources of truth, where a stale operator edit silently shadows an updated
image file and the upgrade appears to do nothing.

### 6. §11 — two Venus OS divergences

1. **The UX was copied and the credential lifecycle inverted.** access.md names
   the Victron-style "password + UI toggle" as its phase-1 UX reference. Venus
   **destroys the root password on every firmware update**, deliberately, and
   Victron publishes the reason: `passwd` lives on the rootfs an update fully
   replaces, and they want an end user with physical access to always be able to
   regain access. mos does the opposite — `/etc/shadow` is a symlink onto STATE,
   so credentials survive image replacement.
2. **The META lockdown is the inverse of that same policy**, and per §5.2 it
   describes a control that does not exist. Both facts are stated together,
   because either alone misleads.

### 7. `mosd.md`, `provisioning.md`, `ro-root.md`

- **`mosd.md` §5.3, the `SshdReconciler` row — both cells corrected.** The
  subtree cell read `access.ssh`, `access.device`; `subtree()` returns
  `"access.ssh"` alone. The effects cell said the reconciler drives
  `/etc/shadow`; it no longer writes that file at all. The doc was stale by
  **supersession**, not by a typo: under M5 the device credential flowed into
  `/etc/shadow` through this reconciler, so a write to `access.device` genuinely
  had to re-run it. The final subtree contract is now stated explicitly, with
  `access.device` **deliberately not watched**, so a reader who finds the
  credential subtree absent does not reconstruct it as an oversight.
- **`mosd.md` §2** still described webd as an HTTP/WebSocket bridge — a stale M2
  artefact. Corrected inline: webd renders server-side HTML over plain HTTP and
  calls D-Bus per request; there is no WebSocket.
- **`mosd.md` §3** gave the settings path as `/state/mos/settings.toml`. The
  real default is `/var/lib/mos/settings.toml`
  (`mosd-settings/src/store.rs`, `DEFAULT_PATH`), which `mosd/src/main.rs` also
  documents — so the doc contradicted both the code and §5.1 of the same file.
- **`access.md` §4 and `provisioning.md` §3.2** both claimed the device password
  authenticates the operator on SSH, the console and the webd admin UI. Both are
  false and are corrected without softening: **the device password authenticates
  nothing.**
- **The substantive answer, recorded in `provisioning.md` §3.6:** nothing
  verifies the device credential under this model. The plaintext and its
  Argon2id hash remain on STATE because the campaign reserved them for future
  use; they are **inert**. Stated plainly so the next reader finds a decision
  rather than an oversight.
- **`ro-root.md`**: the mount table gains the two DATA binds (`/home`, `/root`);
  the shadow contract gains the transient marker and its exception to
  "an entry that already exists is never touched"; the two writers of
  `/etc/shadow` are named; the DATA tier row names the home directories; and
  factory reset is marked as not implemented.

### 8. Two code items

- **`mosd/mosd/src/identity.rs::verify_password` is now `#[cfg(test)]`**, not
  deleted. Two of its three callers use it as the assertion mechanism for
  `ensure_identity` ("stored hash does not verify against the stored
  plaintext"), so deleting it would either delete those assertions or force
  Argon2 to be re-inlined twice. Demoting removes the security-control-shaped
  **public API**, which is the actual hazard: nothing can wire itself to a
  function that no longer exists outside tests. Its `#[allow(dead_code)]` and
  the stale comment justifying it ("read back by the access and connd
  reconcilers, which do not exist yet") went with it. `PasswordHash` and
  `PasswordVerifier` are now imported under `#[cfg(test)]` too — nothing else in
  the module used them, and `-D warnings` catches that immediately, which is
  itself the point of §3 above: the compiler notices when code goes unused, and
  notices nothing at all when a documented control was never written.

  **There are TWO functions with this name.** `mosd/webd/src/auth.rs` is
  **live**, called from `mosd/webd/src/routes.rs` on the admin login path, and
  was not touched. A `grep` for `verify_password` showing callers is that one.
- **`mosd/webd/src/tests.rs`** carried a fixture naming `authorizedKeysPath`.
  RFCT-053 renamed that published-state key to `authorizedKeysPaths`, an array
  of every path written. webd reads the key from nowhere, so nothing broke — but
  a fixture describing state that no longer exists is a fixture that teaches the
  next reader something false. It now carries both real paths.

## What could NOT be proven

- **No hardware claim is made anywhere.** Nothing in this task, or in this
  campaign, booted a device. SSH reachable with a webd-set password, a key login
  surviving a reboot, a password *not* surviving one, `/home` and `/root`
  persisting across a reboot and an A/B update, and the D-Bus policy being
  enforced by a real system bus are all the **user's hardware acceptance** and
  are claimed by nobody. They are listed in the PLAN-010 addendum.
- **§9's lockout claim is reasoned from the code, not demonstrated.** No
  attempt was made to lock a real device out and fail to recover it.
- **The reflash precision in §9.2** is read off `os/mkimage-v2.sh` and the
  repart/growfs configuration. No device was reflashed and no disposed-of eMMC
  was examined for residual blocks.

## Follow-ups recorded (none implemented)

- **`mos-seed-home` and `mos-seed-root` have no test.** They are the two
  executables in the image that nothing drives, unlike `mos-shadow-reconcile`
  (`os/shadow-reconcile-test.sh`). One `os/seed-test.sh` closes both.
- **The other design documents still lack implementation-status markers.**
  Named, not swept: `docs/design/provisioning.md`, `docs/design/ro-root.md`,
  `docs/design/mosd.md`, `docs/design/connd.md`, `docs/design/boards.md`,
  `docs/design/display.md`, `docs/design/remote-management.md`,
  `docs/design/dashboard.md`, `docs/design/uboot-ab-handshake.md`. Only
  `access.md` was marked up, deliberately — a sweep across nine documents in the
  same pass would be unreviewable.
- **RFCT-038**: a shadow file containing CRLF, a NUL byte or an incomplete UTF-8
  sequence is untested. CRLF would leave a stray `\r` at the end of a field,
  which that fix neither creates nor repairs.
- **RFCT-035**: the 72-byte transient-password cap is documented reasoning, not
  a measurement — no test shows bcrypt ignoring the 73rd byte. "Never logged" is
  asserted by construction rather than by capturing tracing output. The key-list
  read-modify-write is not atomic, which is a property of `SetSettings` rather
  than of the pane.
- **RFCT-048**: per-method allowlisting is deferred, and should be implemented
  in the **same change** that adds a `<policy user="webd">` block, not before.
  Its reasoning is worth carrying: the default context carries an explicit
  **deny** rather than a removed allow, because the standard `system.conf`
  stanza allows `receive_type="signal"` — removing the allow alone would have
  left `SettingsChanged`, which carries settings values, deliverable to every
  uid.
- **RFCT-048 also left one reopening path unasserted** until RFCT-039 closed it:
  a second policy file for the same bus name.

## Verification

- `bash docs/verify-index.sh` — `130/130 PASS` (0 failures; the script prints
  the pass count on success and only prints a failure count when it fails).
- `bash mosd/hack/check.sh` — `ALL CHECKS PASSED`, 305 tests before and after.
  The demotion changes test-visible code and removes no test.
- Image builds were not run: no image content changed.
