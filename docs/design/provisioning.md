# Design: Configuration Without a Network (Provisioning Model)

> English | [中文](../zh/design/provisioning.md)
>
> How the appliance obtains and changes its machine configuration when no
> network can be assumed. Approved 2026-08-17. Companion to access.md §7 and
> connd.md.
>

## 1. The break from upstream

A mos appliance must reach a fully working state with **zero external input**,
unlike a data-center machine that may boot without config and wait for one over
the network. Three layers:

## 2. Layer 1 — first-boot self-provisioning (shipped)

When STATE holds no configuration, the device generates its own, persists it,
and is thereafter a fully working, configurable appliance. `mosd`'s
`provisioning.rs` runs this once, between loading the settings store and the
first reconcile, so the first reconcile already sees the seeded tree rather than
the built-in defaults.

Starting from an empty STATE, a first boot writes exactly one `settings.toml`
on STATE, plus the two secret files described in §3:

- **hostname `mos-<first 8 hex of deviceId>`**;
- **`provisioning.deviceId`** — 16 CSPRNG bytes as 32 lowercase hex characters;
- **`access.device.passwordHash`** and `generation = 1`;
- **`access.ssh.enabled`** seeded from the image profile (access.md §5.3);
- **`provisioning.state = "complete"`**, `seededGeneration = 1`;
- `network` **left empty**, and `wifi` left at its schema defaults.

### The no-network property, and how it is enforced

This is the point of Layer 1, not a side effect of it. An appliance is unboxed
on a bench with no DHCP server, no DNS and possibly no cable, and it still has
to reach a named, credentialled, configurable state.

- **The hostname is derived from the device identity**, not from a DHCP option
  12, a reverse DNS lookup, or a MAC address. Beyond removing the network
  dependency this makes the name *stable*: it does not change when the device
  moves to another subnet, when a lease expires, or when a NIC is replaced.
  Eight hex characters is 32 bits, so a collision on one LAN is not a practical
  concern, and it is short enough to print on a label.
- **The module references no networking API at all** — its entire import list is
  `std::fs`, `std::path::Path`, `anyhow`, `mosd_settings` and `crate::identity`.
  This is a claim about the source, mechanically checked; it is **not** a proof
  that the process issues no network syscall, and no unit test can establish
  that.
- **`network` is seeded empty on purpose.** The image already ships a static
  `80-dhcp.network` matching `eth*`, so DHCP works on a fresh device with no
  seeded entry. Seeding one would mean guessing interface names — writing
  `network.eth0` on a board whose NIC enumerates as `end0`, or which has no
  ethernet at all, produces a networkd unit for an interface that does not
  exist. It also keeps mosd's network reconciler from claiming ownership of an
  interface the operator never configured.
- **`wifi` is left at its defaults.** There is no network to join yet, and
  raising AP mode is a connd decision from the uplink state machine, not first
  boot's.

### Atomicity, and never a half-seeded `complete`

Seeding happens into a **private clone** of the settings tree; the single
`Store::save` is the commit point, and only after it returns is the live tree
replaced. Any failure before that — CSPRNG unavailable, secrets directory
uncreatable, settings file unwritable — leaves both STATE and the running tree
exactly as they were, and the device stays `pending` so the next boot retries
from scratch.

The failure this defends against is specific: a tree on disk saying
`state = "complete"` but carrying no `deviceId` and no `passwordHash` would be
*trusted* by every subsequent boot, which would skip provisioning forever. That
device is unrecoverable without a STATE wipe. An unprovisioned device just tries
again.

**The guarantee covers the settings tree and not the two secret files**, which
are written before the save returns. If the save fails after they exist, the
plaintexts are on STATE with no hash in the settings, so the next boot
regenerates and overwrites both. That ordering is deliberate — an orphaned
plaintext is recoverable, a hash with no recorded plaintext is not.

### Idempotence

Re-running returns before touching anything at all when `provisioning.state` is
already `complete`: no credential is regenerated, no operator setting is
reverted, and no file is opened — not even the profile file. A second guard
covers the interrupted-first-boot case, where the state is still `pending` but an
operator has already named the device: the hostname is seeded **only** while it
still equals the built-in default `"mos"`.

A provisioning failure **aborts mosd startup**, deliberately. An unwritable
STATE means no identity and no device credential, so there is no usable device
to serve; a loud exit beats a daemon quietly serving an unprovisioned tree the
operator cannot log in to. Under `MOSD_DRY_RUN=1` provisioning is skipped
entirely, because dry-run must never touch the host and provisioning both mints
secrets on disk and rewrites the settings file.

### What was NOT carried over

The original Layer 1 sketch said "fresh per-device **PKI**". No PKI is generated
— there is no device certificate and no device CA, because nothing on the
systemd base consumes one. What is generated is described in §3. sshd host keys
are separate and predate this work: `mos-seed-state` generates them into
`/mnt/state/ssh` on first boot.

## 3. The credential model — stated once, here

Three documents touch this (`access.md` §4, `connd.md` §7, `ro-root.md` §4) and
all of them defer to this section. It is subtle in three places and each one has
been "simplified" wrongly at least once already.

### 3.1 Secrets are minted on the device, never in the image

The rootfs is squashfs + dm-verity: read-only, **byte-identical on every device
in the fleet**, and covered by the FIT signature. A credential baked into it is
a fleet-wide shared secret by construction, and a randomly generated one would
make the verity root hash depend on a keygen. So every per-device secret is
drawn from the system CSPRNG **on the device, at first boot**, and persisted to
STATE.

This is asserted, not merely intended: a unit test serializes a freshly built
settings tree and asserts the document contains neither `psk` nor
`passwordHash` anywhere, so a future "helpful default" fails the build.

### 3.2 There are TWO independent secrets, not one

| Secret | Where it lands | What it authenticates |
|---|---|---|
| **device password** | hash in `access.device.passwordHash`; plaintext at `/var/lib/mos/secrets/device-password` (0600 in a 0700 dir) | **nothing, since 2026-08-19** — not SSH, not the local console, not the apid admin UI. See §3.6 |
| **AP PSK** | plaintext at `/var/lib/mos/secrets/ap-psk` (same modes) | WPA2 clients joining the provisioning access point |

Both are independent draws from `ring::rand::SystemRandom`, as is `deviceId`.
Nothing is derived from the hostname, the MAC, the machine-id or the clock: a
secret derived from a per-device-but-guessable input is a fleet-wide secret with
extra steps.

**This DEVIATES from the baseline**, which states that the AP PSK "defaults
to the per-device provisioning PIN". Both readings satisfy "never a fleet-wide
constant", so the plan is not violated in spirit — but reusing one string
couples two very differently exposed credentials. **The WPA2 PSK is
broadcast-adjacent and offline-crackable from a captured handshake; if it is
also the device password, then recovering the WiFi key hands over the root
shell.** A second draw from the CSPRNG costs nothing. A test asserts per device
that the password is not the PSK, so a future "simplification" back to one
string fails the build.

`access.device.generation` goes 0 → 1 when the credential is first created, so a
non-zero generation means "a credential of record exists". It is the revision
counter anything derived from the password must key off.

### 3.3 The SAME password is stored under TWO hash formats — SUPERSEDED

**Superseded 2026-08-19 (§3.6). Retained because the libcrypt measurement below
still governs every hash mos writes into `/etc/shadow`, and because the defect
it records is worth keeping.** What is no longer true is the arrangement itself:
the device password is not written into `/etc/shadow` any more, by the sshd
reconciler or by anything else, so only the Argon2id copy is written today — and
nothing verifies it. The paragraphs below describe the M5 arrangement.

This was the part a future reader would otherwise "simplify" back into one hash
and silently break login.

| Store | Format | Verified by |
|---|---|---|
| `access.device.passwordHash` (settings tree, on STATE) | **Argon2id** PHC string | mosd and apid, in Rust, against themselves |
| `/etc/shadow`, root entry | **bcrypt**, cost 12 | `pam_unix` → `crypt(3)` → libcrypt, for SSH and console login |

**Why not Argon2id in both: Debian's libxcrypt has no Argon2 support.** This was
measured on the library packed in the image, not assumed:

```
$ strings libcrypt.so.1.1.0 | grep -i argon2          -> no output
$ strings libcrypt.so.1.1.0 | grep -E '^\$[A-Za-z0-9]{1,9}\$'
  $1$  $2a$  $2b$  $2x$  $2y$  $3$  $5$  $6$  $7$  $gy$  $sha1$  $y$
```

bcrypt, yescrypt and the sha2crypt family are compiled in; Argon2 is absent
entirely. `crypt(3)` cannot parse `$argon2id$…`, so it rejects every password
offered against it.

**Why not one hash in the shadow format only:** Argon2id is the right choice
where mosd and apid verify against themselves, and libcrypt is not involved
there at all.

A hash cannot be converted into another hash, so the plaintext on STATE is
hashed a **second** time, into the format the device can actually verify. That
is also why the plaintext must exist on STATE at all.

**The first version of this shipped Argon2id straight into the shadow field, as
originally specified.** The result was a device with SSH enabled, a per-device
password on the label, and no way to log in — while every check, both verifiers
and the bundle stayed green. That is the campaign's signature defect shape, and
it is why the image verifier now asserts that the libcrypt packed in the image
implements the prefix `sshd.rs` pins on its own output, rather than either side
asserting it alone.

Idempotency needed care that Argon2id did not: bcrypt salts every hash, so a
freshly computed value never compares equal to the stored one. "Already applied"
therefore meant `bcrypt::verify(plaintext, stored)` returning true. Without that
check, every reconcile would rewrite the shadow file with a new salt — a flash
write per boot, and a live state that never settles.

**What survives into the current model:** bcrypt is still the format mos writes
into `/etc/shadow`, for exactly the libcrypt reason measured above — but the
only thing written there now is the **transient** root password
(`os/pkgs/mosd/mosd/src/transient.rs`, cost 12), and the idempotency question does not
arise because it is written once per operator action rather than on every
reconcile. `mos-shadow-reconcile` recognises it by an exact hash match against
its marker, not by `bcrypt::verify`.

### 3.4 Why a plaintext on STATE is acceptable

Neither secret can be hash-only: the operator has to be able to *learn* the
initial device password (read it over the console, print it, have apid show it
once), and the AP PSK has to be re-rendered into `hostapd.conf` verbatim on
every boot.

STATE is unencrypted flash. That is a smaller concession than it first looks,
because access.md §7 already establishes the boundary: **physical possession of
the boot medium implies full control** — the preferred provisioning path is
literally "edit a file on the SD card with any reader", and anyone holding the
card can rewrite the rootfs regardless. A plaintext on STATE does not weaken a
threat model that already grants the card-holder everything.

The two protections that do matter are both asserted by tests: the **hash** in
`settings.toml` is what defends the credential against an *online* attacker, who
reaches the settings tree over the bus or the web UI but never the raw
partition; and the **file mode** — 0600 inside a 0700 directory, with the mode
set on the temp file *before* the rename, so the secret is never reachable under
its final name at a laxer mode — is what defends it against a non-root local
process.

### 3.5 A credential is never regenerated

`access.device.passwordHash` is the credential of record. If it is present but
the plaintext file is gone, the hash is **not** regenerated: replacing it would
invalidate a password the operator may already be holding, and regenerating a
credential on a fielded device locks its operator out. The reconciler reports
that state distinctly (`plaintext-missing`, never confused with `absent`) and
logs a warning.

**Correction (2026-08-19).** This section used to end "the operator's password
still authenticates against `access.device.passwordHash` on the web UI". That
was never quite true — apid authenticates against `access.webAdmin`, its own
credential — and it is now false in every direction: `access.device.passwordHash`
authenticates nothing at all (§3.6), so "the credential of record" above now
means "the record that a credential was minted", not a credential anything
checks.

**There is no credential-rotation path.** Nothing in M5 can change a device
password or an AP PSK after first boot — not the UI, not the bus, not a
reconciler. This is a real gap, not a design position, and it is the first thing
a later phase should close.

### 3.6 What the device credential authenticates today: nothing

**Nothing verifies the device credential under the current access model.** Not
sshd, not `pam_unix`, not the serial console, not apid — which has always
authenticated its admin against `access.webAdmin` rather than against this. No
code path in the repository calls a verifier against
`access.device.passwordHash`; `os/pkgs/mosd/mosd/src/identity.rs::verify_password`, the
function that was written to, is now `#[cfg(test)]` precisely because it had no
caller outside its own tests.

Both halves — the Argon2id hash in `access.device.passwordHash` and the
plaintext at `/var/lib/mos/secrets/device-password` — are still minted at first
boot and still persisted. **They are inert, and deliberately kept:** the
campaign reserved them for a later phase (a support-side credential, or the
phase-2 PIN of `access.md` §4.3) rather than removing a first-boot behaviour and
its migration alongside a change to how SSH authenticates.

Recorded so the next reader finds a decision rather than an oversight, and so
that "the device has a password" is not mistaken for "the device accepts a
password".

## 4. Layer 2 — local configuration channels

All channels ultimately write settings through **the mosd bus** — one trust
path, ordered by preference (details in access.md §7):

1. BOOT-partition provisioning file (offline pre-seed at factory or field);
2. USB signed config drop (udev-triggered, vendor-key verified);
3. AP captive portal (connd.md) and HDMI kiosk wizard (display.md);
4. apid over LAN once any network exists;
5. tty2 serial wizard as the last resort.

**Status: none of these is implemented.** Layer 1 gives a device a working,
credentialled configuration; changing that configuration today is apid over the
LAN (channel 4), which M3 delivered, or the AP captive portal's *transport*
(connd.md §4) without the portal itself. Channels 1, 2 and 5 do not exist.

The invariant across all five: every channel converges on one validated write
path — mosd's D-Bus surface (`com.mos.mosd1`) — and none of them edits a file
behind the daemon's back. That is what `docs/design/mosd.md` §3 describes.

## 5. Layer 3 — bring-up interim — does not exist

**The image pipeline (`os/**`) has no embedded-config mechanism and no
committed CA**, so there is no embedded-config directory for a CI check to
assert is absent. What the image verifiers assert instead is narrower and is
implemented: the shipped `/etc/shadow` carries no usable root password, so no
fleet-wide credential can reach an artifact.

## 6. Security invariants

- No fleet-shared credentials or keys in any shipped image. **The Layer 3
  exception is gone** with Layer 3 (§5), so this invariant now holds without
  qualification, and both image verifiers assert the shadow half of it.
- Provisioning channels never bypass config validation or the audit log.
  Validation is enforced — every write goes through the typed settings tree,
  and a rejected write leaves the tree untouched. **The audit log does not
  exist yet** (access.md §6); nothing in M5 records provisioning or access
  events to a persistent trail.
- Wiping STATE resets configuration but never clears META lockdown
  (access.md §5). **META lockdown is not implemented**, so this invariant has
  nothing to protect yet.
- Factory reset (wiping STATE) returns the device to its unprovisioned state,
  and the next boot re-runs §2 — including minting a **new** device password
  and a **new** AP PSK. The old ones are gone with the partition. This is the
  only credential-rotation path that exists (§3.5).
