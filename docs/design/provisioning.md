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
(`pkgs/mosd/mosd/src/transient.rs`, cost 12), and the idempotency question does not
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
`access.device.passwordHash`; `pkgs/mosd/mosd/src/identity.rs::verify_password`, the
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

**Status.** Channels **1 and 2 are shipped** and are §4.1 below — one
provisioning document, two offline transports. Channel **4** was delivered by
M3 and is what an operator uses once a network exists. Channel **3** has the AP
captive portal's *transport* (connd.md §4) and not the portal itself, and
channel **5** does not exist.

The invariant across all five: every channel converges on one validated write
path — mosd's D-Bus surface (`com.mos.mosd1`) — and none of them edits a file
behind the daemon's back. That is what `docs/design/mosd.md` §3 describes. §4.1
holds that line from the inside rather than over the bus: it is mosd itself
reading the file, and every value it writes goes through the same typed settings
tree and the same validators an API write goes through.

### 4.1 The provisioning document — channels 1 and 2 (shipped)

One file, one format, two transports. `pkgs/mosd/mosd/src/provisioning_doc.rs`
parses, validates and applies it; `rootfs/overlay/usr/lib/mos/mos-provisioning-import`
and its unit put the media where mosd can read them;
`pkgs/mosd/apid/src/provisioning_api.rs` reports what happened. Implements
PLAN-046 / RFCT-282.

**The split is deliberate.** The transport is shell, because mounting a
GPT-labelled partition read-only is shell's job; everything that decides what a
document MAY SAY is Rust, because a shell script that also applied would need
the settings schema, the validators and the single-save discipline in shell,
and a device with a half-written settings file is a device nobody can log in
to.

#### 4.1.1 The format

TOML, matching how mos already stores settings and how an operator edits a file
on a boot partition with any text editor. The file is `mos-provisioning.toml`
at the ROOT of the medium's filesystem — one fixed name at one fixed place,
never a glob and never a path the medium supplies.

```toml
version = 1                       # the DOCUMENT schema version

[identity]
deviceId = "0123456789abcdef0123456789abcdef"

[admin]
password = "the-first-administrator-password"
authorizedKeys = ["ssh-ed25519 AAAAC3Nz… ops@factory"]

[network.eth0]
dhcp = true

[wifi]
enabled = true
interface = "wlan0"

[[wifi.networks]]
ssid = "site-ap"
psk = "the-site-key"
priority = 10

[time]
timezone = "Europe/Berlin"

[time.ntp]
servers = ["0.pool.ntp.org"]
```

Every section is optional except `version`, and every section maps onto an
EXISTING settings path:

| Document key | Settings path | Validated by |
|---|---|---|
| `identity.deviceId` | `provisioning.deviceId` | `validate_device_id` |
| `admin.password` | `access.webAdmin.password_hash` (Argon2id) | length floor; §3.1's rule that the plaintext is never stored |
| `admin.authorizedKeys` | `access.ssh.authorizedKeys` | `parse_authorized_key`, `validate_authorized_keys` |
| `network` | `network` | the typed `IfaceSettings`, plus `Settings::set`'s interface-name charset rule |
| `wifi` | `wifi.client` | the typed `WifiClientSettings`, `is_wpa_quotable`, `validate_wifi_psk` |
| `time` | `time` | the typed `TimeSettings`, `validate_ntp_servers`, `validate_timezone_name` |

**`version` is the DOCUMENT's own schema version and is independent of every
settings document's.** A document format revision does not reshape the settings
tree, and a settings bump does not invalidate a document an operator already
wrote onto a card. This build applies version `1` and refuses any other.

Since PLAN-070 §5.2.3 the settings side is also per document and also starts at
`1`, so the two numbers now coincide by accident. **They are still unrelated**,
and nothing may derive one from the other.

**There is no certificate section, and no hostname.** PLAN-046 lists
certificates among the things a provisioning document should carry; there is no
settings path to carry them onto. The only certificate on the device is apid's
self-signed TLS pair, a file pair on STATE (`pkgs/mosd/apid/src/tls.rs`), not a
setting — so a certificate section would mean inventing a setting, which this
document deliberately does not do. A document carrying one is refused naming
the key. The hostname is out for a related reason: the device names itself from
its identity (§2), the document injects that identity, and there is no hostname
predicate in `mosd-settings` to reuse — writing one here would be the second
grammar this design exists to avoid.

#### 4.1.2 Validation is total, fail-closed, and never quotes a value

The whole document is validated before ANY of it is applied. **A document with
one bad field applies nothing** — no field reaches the settings tree until
every field has passed, so "half-configured" is not a state this code can
produce even in RAM.

A refusal names the offending **key path** and a reason, and **never the
value**. That is a property of construction, not of care:

- the parser's own message is dropped on the floor. `toml` reports a type error
  by quoting the offending literal (`invalid type: integer 5, expected a
  string`), and the offending literal may be the administrator password. So the
  document is taken apart key by key with messages written in
  `provisioning_doc.rs`, and a shape failure is reported as the key path plus a
  fixed sentence. The cost is named: a malformed `[network]` or `[wifi]` entry
  is reported at the section, not at the field inside it. Run the file through
  any TOML linter before it goes on the medium;
- the two secret-bearing keys are refused by validators that name neither the
  value nor its length — `validate_wifi_psk` documents that rule about itself,
  and the password floor's sentence is written to it.

A refusal is not an error. The device records it, comes up **unclaimed and
configurable**, and the operator sets it up over the network or fixes the file
and reboots. A bad file on a stick can never produce a brick.

#### 4.1.3 Idempotence and atomicity

`provisioning.document` (settings schema **v10**) records the applied
document's `appliedVersion`, its `appliedDigest`, and the `lastImport` attempt.

**Idempotence** is the digest. It is a SHA-256 over a CANONICAL rendering of
the *parsed* document, so a comment, a reordered key or different indentation
in the source file is the same document; an offered document whose digest
matches the recorded one is `unchanged`, applies nothing, and — from the second
such boot on — writes nothing at all, so a device left with the medium in its
socket does not burn a flash write per boot.

The digest covers the secret-bearing fields as well, deliberately. Omitting
them would make two documents that differ only in the administrator password
one document, and the second would be short-circuited and never applied — a
credential silently not rotated is a worse failure than the one omitting them
avoids. What that costs is named rather than hidden: an authenticated reader of
the status route can confirm a guess at the WHOLE document by hashing their
guess. That reader is an administrator who can already read the settings the
document wrote.

**Atomicity** is §2's argument, unchanged and for the same reason. The apply
commits through exactly ONE `Store::save`: everything before it mutates a
private clone, `Store::save` writes a temporary file, fsyncs it, renames it
over the target and fsyncs the directory, and the rename is the commit point.
A power loss therefore leaves either the old settings file or the new one and
never a blend; a failure at any step before the rename leaves STATE and the
running tree exactly as they were, and the next boot is offered the same
document again. **Never half-configured, in either direction.**

**Applying a document does not touch Layer 1's rules.** It regenerates no
credential and never moves `provisioning.seededGeneration` — neither is a field
the document can carry.

**The import runs BEFORE first-boot seeding**, and that order is the point: a
factory-injected `identity.deviceId` has to be in the tree when
`ensure_identity` decides whether to mint one, and when the hostname is derived
from it (§2). The other way round, the device would mint an identity, name
itself after it, and only then be handed the identity the factory recorded.

#### 4.1.4 The already-claimed rule

A document is applied only while the device is **unclaimed** — while
`access.webAdmin` is absent. Once an administrator credential exists,
configuration changes go through the authenticated API, and a document offered
on a medium is refused with `already-claimed`.

This is what makes an unsigned transport safe. Neither transport verifies a
signature (§4.1.7), so without this rule a stick pushed into a fielded device
would reconfigure it, administrator password included. The digest
short-circuit is checked FIRST, so a device claimed BY the document being
offered reports `unchanged` rather than looking like an attack on every reboot.

#### 4.1.5 The two transports

`mos-provisioning-import.service` runs `Before=mosd.service` and after
`local-fs.target`. It mounts a candidate **read-only** (`ro,nosuid,nodev,noexec`)
under `/run/mos/provisioning/<source>` and keeps the mount only when
`mos-provisioning.toml` under it is a **regular file** — a directory, a symbolic
link planted on the medium, or a device node leaves nothing mounted. mosd
enforces the same rule from its side. The staging root is mode 0700, because a
vfat mount presents every file world-readable whatever the medium says and a
directory a non-root process cannot traverse is what keeps the content
unreachable on any filesystem.

| Source | Where | Order |
|---|---|---|
| `boot` | the FAT boot slot partitions, by GPT partition label `boot-a` then `boot-b` (`boards/*/board.env`) | first |
| `media` | an attached removable block device — the kernel's own `removable` flag, so the internal eMMC or NVMe this device boots from is never a candidate — its partitions first, then the bare disk | only when `boot` carried nothing |

The BOOT medium wins because physical possession of it already implies full
control of the device (`access.md` §7), so a document written there with any
card reader is the most authoritative one available and a stick left in a
socket cannot displace it.

**A transport-level failure is a journal entry, not a status field.** §4.1.8
reports what mosd did with a document it was given; a medium that would not
mount, or a filesystem type the kernel does not have, never becomes a document,
so there is nothing for mosd to record. The unit says which source it staged,
or that it staged none, and `journalctl -u mos-provisioning-import` is where an
operator whose stick did nothing looks first.

**The transport references no networking API at all.** Neither does
`provisioning_doc.rs`, whose entire import list is `std::collections`,
`std::fmt`, `std::fs`, `std::path`, `anyhow`, `hex`, `ring::digest`, `toml`,
`mosd_settings` and `crate::identity` — no socket, no resolver, no DHCP lease,
no MAC lookup, no wait on a network unit. That is §2's claim, held here with
more force because this is the channel that exists *because* there is no
network. As in §2 it is a claim about the SOURCE, mechanically checkable by
reading it, and not a proof that the process issues no network syscall.

**Boot assurance is unchanged by any of this.** Both boards are honestly I1 on
`security-model.md` §5's ladder, and a provisioning document neither raises nor
depends on that rung: it is authorised by physical possession of a medium, and
`access.md` §7 already states that physical possession of the boot medium
implies full control.

#### 4.1.6 The document on the medium: it stays, untouched

**Policy: every mount is read-only and the document is left exactly as the
operator wrote it.** After a successful import the file is not deleted, not
renamed and not rewritten. Three reasons, in order of weight:

1. **Deleting needs a writable mount of a filesystem the device does not own.**
   A partial write to an operator's vfat stick on a power loss corrupts their
   medium, and this whole feature exists to survive power loss.
2. **Idempotence already makes leaving it free.** A second boot with the same
   document is `unchanged` and writes nothing, so the file costs nothing by
   staying.
3. **The lifetime of a medium carrying secrets is the operator's decision, not
   the device's.** A document may carry an administrator password and a WPA2
   pre-shared key; flash cannot be securely erased by overwriting anyway, so a
   device that deleted the file would be buying the *appearance* of erasure.
   **Treat a provisioning medium as credential material** — it is one.

#### 4.1.7 What is deliberately NOT here

- **No signature: this transport verifies no signature.** Said in those words
  rather than left to be inferred from the paragraphs around it — a reader who
  has to infer it can infer it wrong, and what they would be wrong about is
  whether a file on a stick is authenticated. Neither transport checks the
  document against any key. Authorisation is physical possession of the medium,
  and §4.1.4's already-claimed rule is what bounds it. `access.md` §7 used to
  describe channel 2 as a *"signed config drop … vendor-key verified"*; it no
  longer does, and it now names this gap from its own side. A vendor-key check
  needs a trust root the image does not carry for this purpose, and adding one
  is a separate decision.
- **No udev trigger.** Media are consulted once, at boot, before anything is
  listening. A stick pushed in later is a next-boot document — there is
  deliberately no rule that lets inserting media reconfigure a *running*
  appliance.
- **No HTTP route that applies one.** §4.1.8 is a read. A document is the
  channel for a device with NO network, so a route that applied one would be a
  second, differently-trusted write path for the same thing.
- **No way to read the document back.** Nothing stores it; the fields are
  applied into the subtrees that own them and the parse is dropped.

#### 4.1.8 The status surface

`GET /api/v1/provisioning/status` (authenticated, read-only) answers four
things and nothing else:

| Member | Meaning |
|---|---|
| `documentVersion` | `version` of the document last applied; `null` when none was |
| `documentDigest` | its canonical digest; `null` with the version |
| `lastImport` | the last ATTEMPT: `source` (`boot`/`media`), `outcome` (`applied`/`unchanged`/`rejected`), `reason` for a rejection, and `at`, the device clock's reading — a label, never a deadline, for the reason `access.apiTokens[].created` is |
| `unclaimed` | whether the device still has no administrator credential |

**It returns no value the document carried.** Both settings subtrees it reads
pass through apid's existing redactor (`docs/design/api.md` §2.2), so a
secret-named field that ever appeared under `provisioning` is substituted
rather than served. The applied version and digest are independent of
`lastImport` on purpose: a rejection leaves them exactly as they were, so a bad
file on a stick can never make a device look configured by it.

## 5. Layer 3 — bring-up interim — does not exist

**The image pipeline has no embedded-config mechanism and no
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
