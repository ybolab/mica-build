# Design: Debug & Maintenance Access

> English | [中文](../zh/design/access.md)
>
> Shell/SSH/console access for an immutable appliance — configuration-driven,
> auditable, and disabled by default on every profile. **Not absent from
> production images:** since the 2026-08-17 decision the prod image carries
> OpenSSH and an emergency BusyBox binary, both off and unused until an
> administrator turns SSH on (§5.3). Companion to architecture.md §5.
>

## 0. How to read the status markers

Every section below that describes a **mechanism** carries one of:

- **[implemented]** — code exists and is named, by path.
- **[partial]** — some of it exists; what is missing is named.
- **[not implemented]** — deliberately, no code at all. Prose only.
- **[decided]** — a question that was open is now settled by the user, with the
  campaign that settled it named. Added deliberately (campaign `apid`). It marks
  a *decision*, not a state of the code: a section can be **[decided]** and
  **[not implemented]** at the same time, and where it is, both markers appear.

The milestone records apply this discipline at milestone level, and its six
explicitly-not-claimed items are why that record is trustworthy. A design
document needs it for the same reason, and for one worse case: **dead code has a
compiler, a test run and a grep-for-callers that can surface it; a security
control that exists only as prose has no mechanism that will ever notice it is
absent.** An undated design paragraph describing a control is not evidence the
control exists. One section below — §5.2 — is exactly that, and is marked
accordingly; §6 was the other until later moved two of its four intents
into code, and it now names which two per intent.

**No section of this document carries [partial] any more, and that is a
decision.** RFCT-316 triaged every marker here and in
`docs/design/recovery.md` against the code, and PLAN-037's Gate C requires each
to end as either the capability it claims or an explicit non-capability, because
a half-built capability described as if it works is exactly the prose control
this section warns about. Where a section held one, it now names the part that
ships under **[implemented]** and the part that does not under
**[not implemented]**, with what an operator does instead. `[partial]` stays
defined above for a mechanism that later earns it honestly — some of it existing
and the missing half named.

Sections without a marker (§1, §7, §9's reasoning, §11) state principles,
preferences or history rather than a mechanism.

## 1. Principles

- Access channels are **first-class services under the model layer**
  (settings subtree → reconciler → service), never side doors around it. The
  executor is mosd over systemd.
- **Provisioning and debugging are different problems.** A weak-auth,
  resource-whitelisted wizard covers "no network on site"; a strong-auth full
  shell covers deep debugging. One almighty shell for both inevitably drags
  auth strength down to usability level.
- "Disabled" must exist at three strengths (see §5); the strongest is
  compile-time absence.
- **A credential that outlives the session that needed it is a liability.**
  Persistent access is by key; a password is the exception, and it is transient.

## 2. Channels

| Channel | Capability | Auth | Availability |
|---|---|---|---|
| Network wizard (tty2 TUI; AP captive portal; HDMI local wizard via kiosk) | whitelisted network resources only; no secrets, no exec, no raw logs | per-device PIN | **not implemented** |
| SSH (**OpenSSH**, driven by mosd) | root (see §4.1: `mos` is not a lesser privilege level) | SSH public key, persistent; optionally a **transient** root password | **prod and dev** — **shipped**, and **off by default on both** |
| Console shell (tty3) | root | same as SSH | **not implemented.** `access.console.shellEnabled` exists in the schema with **no reconciler consuming it**, so a managed tty3 shell is unsupported and setting the flag changes nothing on the device. Use SSH explicitly enabled with an enrolled key, or a boot-time provisioning document for initial setup |
| Serial console (`serial-getty@ttyFIQ0`) | login prompt only | `/etc/shadow`, i.e. nothing by default | **present** — spawned by systemd's getty-generator from the kernel `console=` parameter on both profiles. It has no account that will accept a credential; see §9 |
| Rescue (all-slots-failed FIT entry) | chroot repair environment | physical access (cmdline / boot failure) | **not implemented.** There is no rescue boot entry and no offline repair environment; the emergency BusyBox binary lives in the same root that would be damaged and is deliberately not one (`docs/design/recovery.md` §6.3). An unbootable device needs an external service host or a whole-disk reflash, which replaces its data and its identity |
| Factory (rockusb / SoC loader mode) | full reflash | physical access | hardware-level; see §9.2 |

**One policy source.** The image carries **OpenSSH**, and mosd renders the only
drop-in that configures it and drives `ssh.service` (§3). That ownership is what
keeps sshd's policy in one place: there is no second, operator-edited
`sshd_config` for the settings tree to drift against. Every profile ships one
`/usr/bin/busybox` as an emergency binary with no applet links, no PATH entry
and nothing on the device depending on it (`docs/design/recovery.md` §6.3); it
is not a rescue environment and not a login channel, and the debug profile's
shell is the base image's.

## 3. Configuration model — **[implemented]**

Implemented by `pkgs/mosd/mosd-settings/src/model.rs` (the tree),
`pkgs/mosd/mosd/src/reconciler/sshd.rs` (the reconciler) and
`pkgs/mosd/mosd/src/transient.rs` (the transient password).

### 3.1 As shipped

Access policy is a subtree of the mosd settings tree (`docs/design/mosd.md` §3),
persisted since PLAN-070 §5.2 as one document per reconciler under
`/mos/config/` on DATA plus the remainder on STATE at
`/var/lib/mos/settings.toml`, each document carrying its own schema version
(`docs/design/mosd.md` §5.1a says which key lives where). Addressed as one tree
regardless:

```toml
[access.claim]                # §4.4, schema v11; absent until the device is
via = "setup"                 # claimed, and absent by design on a device
at = 1700000000               # claimed by a provisioning document
rotationRequired = false

[access.ssh]
enabled = false
port = 22
permitRootLogin = true
passwordAuthentication = true
listenAddresses = []          # empty = LISTEN ON ALL — see below

[[access.ssh.authorizedKeys]]
key = "ssh-ed25519 AAAA..."   # canonical key text, no comment
comment = "laptop"            # absent when the key was pasted without one

[access.console]
shellEnabled = false

[access.device]
generation = 0
# passwordHash is optional and absent until first boot mints it

[[access.apiTokens]]          # schema v8; the list is omitted entirely when
id = "3f2a9c41"               # no token has been minted
name = "ci"
hash = "0000...0001"          # SHA-256 of the secret, never the secret
created = 1700000000
```

`enabled = false` is the default **on both image profiles**. `authorizedKeys` is
empty by default: a key baked into the signed rootfs would let whoever holds its
private half into every device built from that image.

Flow: settings subtree → **`SshdReconciler`** → three system effects:

1. one authorized-keys file **per managed login account** is rendered from
   `access.ssh.authorizedKeys` into `/etc/ssh/authorized_keys.d/<account>`,
   0600, for each of `root` and `mos`;
2. `/etc/ssh/sshd_config.d/10-mos.conf` is rendered from `access.ssh`;
3. `ssh.service` is brought to the state `enabled` asks for.

`AuthorizedKeysFile /etc/ssh/authorized_keys.d/%u` is **not** in that rendered
drop-in. It is a static image file,
`/etc/ssh/sshd_config.d/05-mos-authorized-keys.conf`, numbered 05 so it sorts
before mosd's `10-mos.conf`: sshd keeps the *first* value it obtains for a
non-repeatable keyword, so no later drop-in can override it, and the image
verifier can assert it byte-for-byte. Setting it also **replaces** sshd's
defaults (`~/.ssh/authorized_keys`), which is the point — a key dropped into
`/root/.ssh` by some other path does not silently grant access.

**The reconciler no longer writes `/etc/shadow`.** Under M5 it hashed the device
password into the root entry as its second effect; it does not any more. It
*reads* the shadow file's neighbourhood — through
`transient::transient_password_active`, which tests for the marker beside it —
because whether password authentication may be offered at all is a question
about that exact path. The only writers of `/etc/shadow` today are mosd's bus
method (§4.1) and `mos-shadow-reconcile` at boot.

Unit enablement is **runtime-scoped** (`EnableUnitFiles` with `runtime = true`,
so symlinks land in `/run/systemd/system`). Persistent enablement would need
`/etc/systemd/system` to be writable, and on the mos read-only root it is not —
a persistent enable would fail with EROFS on device while passing every test on
a normal filesystem. mosd reconciles the whole tree at every start, so the unit
returns to its configured state on each boot without a persisted symlink.

The reconciler re-renders, compares against what is on disk, and skips the write
when the bytes match — the drop-in lives on STATE, so an unconditional rewrite
would cost a flash write on every reconcile. One case is deliberately not a
no-op: when the drop-in changed and sshd is already running, the unit is
**reloaded**, because a rewritten configuration that nothing re-reads
is a configuration that silently did not take effect. Adding or removing a key
needs neither: sshd re-reads the authorized-keys file on every attempt.

`access.webAdmin` (apid's own credential) is not part of this subtree.

### 3.2 `listenAddresses: []` means LISTEN ON ALL

**This is a correction. Earlier revisions of this document commented the field
`# empty = none`. That is not what ships, and the "none" reading was
deliberately rejected on L2 review.**

The reconciler treats an empty list as "every address" and emits **no
`ListenAddress` directive at all**, which is what sshd itself does when given
none. Each entry present appends one `ListenAddress <addr>` line, in tree order.

The reasoning:

- the "none" reading would hand an operator who enables SSH without naming an
  address a **running-but-unreachable sshd** — a silent failure, green
  everywhere, with nothing to log;
- **closure is already expressed by `enabled: false`**, which is the layer §5.1
  exists for. Encoding it a second time in the address list adds a second way to
  be closed and no capability.

A design document that says the opposite of the shipped behaviour is the same
defect class as a passing test that proves nothing — it makes a reader confident
about something that is false. Hence the correction here rather than a change to
the reconciler.

`permitRootLogin` defaults to `true` because root is the account keys are
rendered for. `passwordAuthentication` defaults to `true` but is **gated**: the
value written into the drop-in is `passwordAuthentication AND a transient
password is actually active`, so the default costs nothing on a device that has
never had one set. The published state carries both — `passwordAuthentication`
(effective) and `passwordAuthenticationRequested` (raw setting) — because a UI
that showed only one of them would be lying in one direction or the other.

### 3.3 Not yet modelled — **[not implemented]**

`idleTimeout`, `autoDisableAfter`, the `bruteForce` block and the one-way
`lockdown` bit are **not in the schema**. They remain the design intent of §5
and §6 and need a schema change when they land.

**Read as capabilities: SSH idle timeout, timed SSH auto-disable, a
configurable brute-force policy and META lockdown are unsupported settings, and
an operator should not plan around any of them arriving.** An opened shell stays
open until somebody closes it: **disable SSH explicitly when you are finished**,
which is the reversible runtime switch of §5.1. The absence of a *configurable*
brute-force block does not mean there is no rate limit — apid applies a fixed,
bounded, persistent login backoff that no setting turns off or tunes (§6).

The original YAML sketch is retained below as the record of that intent, and it
is a record rather than a roadmap:

```yaml
# NOT SHIPPED — design intent for later phases
ssh:
  idleTimeout: 15m
  autoDisableAfter: 2h         # opened channels fall closed automatically
bruteForce: { backoffBase: 1s, backoffMax: 300s, lockoutThreshold: 20 }
lockdown: false                # one-way; see §5
```

## 4. Authentication

### Browser management sessions — **[implemented]**

The browser UI is a static client of the same JSON management API as
automation. `GET /api/v1/session` reports setup, unauthenticated or
authenticated state. Password login at `POST /api/v1/session` creates an
in-memory, HMAC-signed `HttpOnly; Secure; SameSite=Lax` session cookie and
returns a random per-session CSRF token. The SPA keeps that CSRF value only in
memory and sends it as `X-CSRF-Token` on `POST`, `PUT`, `PATCH` and `DELETE`.
The unified API credential extractor rejects a missing or wrong proof with 403
`csrf_invalid`; bearer-token automation is unaffected. Logout is
`DELETE /api/v1/session` and revokes the server session before clearing the
cookie. Setup establishes the same browser session while still returning the
one-time bearer token to API-only clients.

The browser session protects the HTTPS management API only. It is not an SSH
credential, a fleet-enrollment credential or a substitute for the transient
root password below.

### 4.1 Phase 1 as shipped — **[implemented]**

Implemented by `pkgs/mosd/mosd/src/reconciler/sshd.rs` (keys),
`pkgs/mosd/mosd/src/transient.rs` and `pkgs/mosd/mosd/src/bus.rs` (the transient
password), `rootfs/overlay/usr/lib/mos/mos-shadow-reconcile` (the boot
clear) and `pkgs/mosd/apid/src/routes.rs` (the operator-facing pane).

**The default state of a device is: SSH off, root with no password, no keys.**
Both image profiles. Neither profile seeds `access.ssh.enabled` true
(`Profile::ssh_enabled_default` returns `false` for both), and neither image
ships `ssh.service` enabled — `mos-system` ships
`/usr/lib/systemd/system-preset/50-mos-ssh.preset` holding `disable
ssh.service`, so `deb-systemd-helper` never writes the
`multi-user.target.wants` symlink when openssh-server is configured, and the
package's postinst asserts that outcome rather than arranging it
(`rootfs/packages-src/system/Dockerfile`). Getting in requires
an authenticated admin action through apid, over the network the appliance is
already on.

**Persistent access is by SSH public key.** Keys live in
`access.ssh.authorizedKeys` and are rendered as §3.1 describes. A key survives
reboot and an A/B update, because the settings tree is on STATE and RAUC writes
only the ROOTFS and BOOT slots.

**Every authorized key is a root key.** One shared key list is rendered per
managed account, so a key added expecting an unprivileged shell grants root.
`mos` is a **persistent working directory and a non-root default shell, not a
lesser privilege level** — it exists so an operator's files land on DATA and
survive an update, not to contain what that operator can do. apid states this on
the SSH pane in as many words ("Every authorized key is a root key."), and a
test asserts the sentence is present; this document must not be softer than the
UI.

**A transient root password covers the one case a key cannot: an operator in
front of a device with no key installed yet.** It is set through apid, which
calls a mosd bus method, which:

- bcrypt-hashes the password (cost 12) into the root entry of the STATE-backed
  shadow file, and
- writes exactly that hash into a **marker** beside it,
  `transient-root-password`, 0600.

It is deliberately **not a setting**: nothing about it is persisted in the
settings tree and nothing re-applies it. On every boot,
`mos-shadow-reconcile` — ordered before `mosd.service` and `ssh.service` —
compares root's current hash against the marker. **If they are equal it rewrites
the field to a locked marker and deletes the marker file, so the password
vanishes.** If they disagree it leaves the shadow file alone.

The request boundary hashes and writes the shadow entry before enqueueing; the
queue contains only an `access.ssh` apply task and never the plaintext
password. apid answers 202 with the task id (or redirects the form to
`/ssh?task=<id>`). The server-rendered pane uses a meta refresh while the task
is queued/running and stops on succeeded, failed, interrupted, or a missing
bounded-history record—no JavaScript and no unbounded blank request.

**Why a marker rather than "lock root on every boot".** Any root hash mosd did
not write — one set by hand over the serial console, or by a future
provisioning path — never equals a marker. Locking unconditionally would be
this code overwriting a credential it does not own. The marker makes the
reconciler clear only what it wrote. (A baked `ROOT_PASSWORD` is *not* such a
case on mos: the pack stage fails any build whose factory shadow carries a
usable hash, so no buildable mos image ships one — see §5.3.)

Password authentication is offered to sshd **only while a transient password is
really active** (§3.2). So a device whose password has expired at boot does not
present a password prompt that can never be satisfied.

### 4.2 Superseded: the M5 per-device password model

**Superseded by §4.1, 2026-08-19. Recorded, not deleted.**

M5 minted a per-device password at first boot, hashed it with bcrypt into
`/etc/shadow`'s root entry through the sshd reconciler, and stored an Argon2id
hash of the same password in `access.device.passwordHash`. The whole credential
model is stated in `docs/design/provisioning.md` §3.

Why it was superseded:

- **A password is a persistent credential with no rotation path.** M5 shipped
  with nothing that could change one after first boot (the own
  recorded follow-up); a key list is rotated by editing a list.
- **A password is guessable at network speed** the moment sshd is up, and M5's
  brute-force accounting (§6) was never implemented. A public key is not.
- **Nothing ever exposed the generated password to the operator.** That is
  M5's known gap, and it made the credential unusable in practice. Under §4.1
  nothing needs to: the operator chooses the transient password, and persistent
  access needs no shared secret at all.

**The per-device credential still exists on STATE and authenticates nothing.**
`access.device.passwordHash` (Argon2id) and the plaintext at
`/var/lib/mos/secrets/device-password` are still minted at first boot and still
persisted — the campaign reserved them for future use rather than removing
them. They are **inert**: no code path verifies either one — not SSH, not the
serial console, not the apid admin UI, which has always used its own
`access.webAdmin` hash. The correction is carried in `provisioning.md` §3.2 as
well. Recorded here so the next reader finds a decision rather than an
oversight.

### 4.3 Later phases — **[not implemented]**

- **Phase 2**: derived per-device PIN for the wizard:
  `PIN = base32(HMAC(K_vendor[gen], device_id))[:8]`; vendor key offline,
  support can compute it from the label; device stores only the hash.
- **Phase 3**: offline challenge-response for the full shell: console shows
  `device_id‖nonce‖counter`; operator's tool signs with an authorization key
  (Ed25519); device verifies with a compiled-in public key (covered by the FIT
  signature). Gives expiry, scoped permissions, per-engineer revocation, no
  shared secrets, works with the device fully offline.
- Optional at any phase: `requirePhysicalPresence` (GPIO/jumper/boot-window)
  because "local console" is routinely bridged over serial servers.

**Read as capabilities: derived-PIN setup, offline challenge-response shell
access and a general physical-presence access switch are unsupported**, and
none of them is what a locked-out operator is waiting for. There is already a
supported remote management path: normal authenticated management over the API,
and SSH explicitly enabled with an enrolled key (§4.1). After total credential
loss the answer is §9 — whole-disk reflash — and not one of these phases. The
narrow presence mechanism that *does* exist is recovery-specific
(`docs/design/recovery.md` §4) and is a different contract from this shell
protocol; it is also unreachable on every shipped board, so it does not change
this answer either.

Both later phases authenticate **directly against mosd** — a derived PIN checked
against a stored hash, and a signature verified against a compiled-in public
key — neither of which `crypt(3)` can express at all. The STATE-backed shadow
machinery in `ro-root.md` §4 now exists only for the transient password and for
keeping every other account locked; it is not permanent architecture.

### 4.4 The claim: how a device stops being anyone's — **[implemented]**

Implemented by `pkgs/mosd/apid/src/routes.rs` (the claim, its record, the
rotation gate and `GET /api/v1/claim`), `pkgs/mosd/mosd-settings/src/model.rs`
(`access.claim`, settings schema **v11**) and, for the other channel,
`pkgs/mosd/mosd/src/provisioning_doc.rs`.

**A claim is the unclaimed → claimed transition, and `access.webAdmin` is the
one fact that decides which side of it a device is on.** It always was. What
schema v11 adds is `access.claim`, the part `webAdmin` cannot state: which
channel minted the credential (`setup` or `provisioning-document`), the device
clock's reading at the commit, and whether that credential is still the
bootstrap secret it arrived as. The record never contradicts `webAdmin`; a tree
carrying a record and no credential is a bug, not a state.

#### Two channels, one state

Exactly two writers can create the FIRST `access.webAdmin` on a device that has
none: `POST /api/v1/setup`, and the provisioning-document importer
(`docs/design/provisioning.md` §4.1). Every other writer of that path is
authenticated, and an unclaimed device has no credential to authenticate with.
The setup route writes the record in the same save as the credential. **The
importer deliberately writes none**, and its absence is what identifies it:

- the importer refuses to apply a document at all once `access.webAdmin` exists
  (§4.1.4's already-claimed rule), so a document that applied ran on an
  unclaimed device;
- therefore a device that is claimed, carries no record, and has an applied
  document was claimed **by** that document.

**This reading holds because only the setup route and the document importer can
create a first `webAdmin`; a third writer would make the silence ambiguous.** A
device claimed by that third writer would be indistinguishable from one claimed
by a document, and would be told to rotate a credential no medium ever carried.
The premise is stated here and deliberately not asserted by a check: a count of
writers is a claim about the shape of the source, and a third one arrives with
its own code review rather than by drift.

apid reads it exactly that way. The alternative — teaching the importer to
write a record too — would put a second statement of "this device is claimed"
beside `webAdmin`, on the one write path that runs before anything is
listening. WHEN a document claim happened is not copied either: P1 already
records it in `provisioning.document.lastImport.at`, and a second copy is a
second thing that can disagree.

#### The bound is a forced rotation, not an expiry

PLAN-046 offers either. This is a rotation, for two reasons.

**An expiry would be the first deadline this appliance ever enforced against
its own clock.** The schema says so twice already, in as many words:
`access.apiTokens[].created` and `provisioning.document.lastImport.at` are each
documented as *"a label, never a deadline"*, because the image enables no time
daemon before a device is manageable and the reading is whatever the clock
happened to say. An unclaimed device is precisely the device with no
synchronised clock. A claim window measured against it would close early on one
device and never on another, and nothing on the device could tell which had
happened.

**An expiry can brick; a rotation cannot.** A claim window that closed with
nobody in it leaves a device with no credential and no way to create one —
§9.1's "no software path back in", reached by doing nothing. Releasing that
state needs a physical-presence gate (`docs/design/recovery.md` §4), which is
not built. A forced rotation bites only on a device that is already claimed and
whose operator is already signed in, so the worst it can cost is one password
change.

**What the rotation is.** A credential that arrived on a provisioning document
sat in plaintext on a medium the device deliberately does not erase
(`docs/design/provisioning.md` §4.1.6, *"treat a provisioning medium as
credential material"*), and one document may be written onto a batch of cards.
So a claim by document sets `rotationRequired`. Until it is discharged, apid
serves every read and refuses every authenticated **mutation** with **409
`rotation_required`** — except `POST /api/v1/actions/change-password`, which is
the one that clears it. The check lives in the credential extractor rather than
in a list of routes, so a mutation added later is covered by construction.

Those two exemptions are the anti-brick argument, and they are what an operator
needs: they can sign in (`POST /api/v1/session` takes no credential extractor),
they can read **why** on `GET /api/v1/claim`, and they can do the one thing that
lifts it. A claim through `POST /api/v1/setup` sets no such flag: that password
was chosen by the caller at the moment of the claim and was never written down
anywhere the device can reason about.

**The bound is FIRST SIGN-IN, not elapsed time, and nothing counts down.** A
bootstrap credential on a device that is claimed but has never been signed into
stays valid **indefinitely** — a device that came off the line with a document
on its card and sat in a warehouse for a year is holding the same working
password on the day it is unboxed. That is the deliberate price of a bound that
cannot brick the device: the only moment this appliance can safely demand a
rotation is one where somebody is there to perform it, and "somebody is there"
is exactly what a sign-in proves and a clock reading does not. **A reader who
takes "forced rotation" to mean the credential stops working on its own will
plan an exposure window that does not exist.** There is none. What bounds that
exposure before the first sign-in is physical custody of the medium
(`docs/design/provisioning.md` §4.1.6, which is why that section says to treat
one as credential material), not this rule.

**Observable before it bites.** `GET /api/v1/claim` (authenticated) answers the
state, the channel, the moment and `rotationRequired`. It is authenticated
deliberately: *"this device was claimed from a medium and still holds the
password that was on it"* is a sentence an attacker would act on, and the
operator who needs it is signed in by construction.

**It does not overlap `recovery.md` §5.** That flow is for an operator who has
**lost** the credential; it is presence-gated, it mints and never reveals, and
an authenticated session may not run it. This one is for an operator who
**holds** a credential and must replace it, which §5.2 names as "the ordinary
change-password path, which is a different feature". A device whose bootstrap
credential is lost before it is rotated is a §5 case, not a §4.4 one — and
§4.3's `requirePhysicalPresence` is the gate it waits on, which is not this
work's to build.

#### Claiming twice

`POST /api/v1/setup` on a claimed device answers **409 `already_configured`**
and writes nothing. **What an unauthenticated caller learns from that is one
bit — whether this device has an administrator credential — and it already had
that bit**: `GET /api/v1/session` answers `setup` or `unauthenticated` without
a credential, because a first-run wizard cannot ask for one. The refusal is
therefore not a new disclosure; it is the same bit, in the response to a
request that could only have been an attempt to take the device. Acceptable
because the alternative — answering as though the claim had succeeded — would
be a scan-friendly way to burn an operator's device out of a script, and
because the bit is not a secret: an appliance on a network that has never been
configured is discoverable in a dozen cheaper ways.

Nothing else is disclosed. Not the hash, not its length, not when the
credential was set, not which channel set it: those live behind §4.4's
authenticated claim route. A refused claim is audited (§6).

**Two claims that arrive at once get the same answer, and that took a fix.**
The route reads `access` to decide the device is unclaimed and writes `access`
to claim it, and until 2026-09-04 nothing made that pair one step: mosd
serialises each `SetSettings` under its own write lock but offers no
compare-and-set, so two requests that both read an unclaimed tree both wrote
one. It was not a race that was hard to win — the window is an argon2id hash
and two bus round trips — and it was measured on the shipped path with no test
seam anywhere in it: against a real mosd on a real bus, two concurrent
`POST /api/v1/setup` requests produced two 201s and two working administrator
sessions in **200 of 200** attempts, and eight produced eight in **100 of 100**.
The device kept whichever credential was written last and one of the API tokens
it had already handed out, so a caller held a token that authenticated nothing
and was never told; every browser session it issued read protected settings.

It is closed by making the claim **one step**: apid takes a claim guard before
the read and holds it past the write, so a second claimant re-reads a claimed
tree and takes the 409 above, having written nothing. The guard is in apid and
not in mosd because apid is the only claimant for as long as the device can be
asked — the other writer that can create a first `webAdmin` is the document
importer, which runs to completion before mosd requests its bus name, so no
request can be in flight beside it. A third claimant arriving inside mosd would
move the guard there, which is the same premise the two-writers reading above
already rests on.

#### One commit point

**The claim writes the `access` subtree ONCE.** The credential, the claim
record and the API token the route mints are three keys of one subtree, so mosd
turns them into one `Settings::set` and one `Store::save`, whose commit point
is a rename — `docs/design/provisioning.md` §4.1.3's argument, held here by the
same construction. A power loss therefore leaves the device fully unclaimed or
fully claimed, never a credential without its token or a token without its
record. The hostname and network entries a setup body may also carry are
written **before** it and separately, because neither claims the device: a
failure in either leaves an unclaimed, still-claimable appliance and the caller
may post the same body again.

**A retry after an interrupted claim mints no second identity and no second
credential.** The device identity is drawn once by
`pkgs/mosd/mosd/src/identity.rs` and the claim never touches it. If the save
did not land, the retry claims a device that is exactly as it was. If it did
land and only the answer was lost, the retry is the 409 above — so there is
never a second token that also works and that nobody was told about. The
rotation is the same shape: the new hash and the record that the bootstrap
secret is gone commit in one write, because a crash between two writes would
either demand a rotation that already happened or excuse one that never did.

## 5. Layered disablement

### 5.1 Runtime — **[implemented]**

`enabled: false` → the reconciler stops and runtime-disables `ssh.service`
(`pkgs/mosd/mosd/src/reconciler/sshd.rs`). Reversible, and the default.

### 5.2 META lockdown — **[not implemented]**

Design intent: a one-way bit in the META partition; when set, the management
plane ignores config and never registers the services. Cleared only by full wipe
— but factory reset deliberately does NOT clear it: "forgot the password" is
self-serviceable, "un-lock the shell" is not.

**None of that exists.** `grep -i lockdown` across every `.rs`, `.sh` and
`.conf` in this repository returns nothing outside `docs/`. There is no one-way
bit, nothing that reads one, and no reset that preserves one.

**Read as a capability: META lockdown is unsupported, and nothing else in the
product substitutes for it.** SSH is disabled *reversibly*, through the runtime
setting of §5.1 and by nothing stronger; **do not describe that switch as a
one-way state**, because an administrator who can reach the API can turn it back
on. There is no irreversible shell disablement on this device, and a deployment
whose requirement is that no shell can ever be re-enabled is a deployment mos
does not serve today. Whether the lockdown is ever built is an open product
decision.

**A correction this section used to carry the other way.** It said factory reset
itself was not implemented. That is no longer true: `ResetTier::FullFactory`
exists and `pkgs/mosd/mosd/src/reset.rs` executes it
(`docs/design/recovery.md` §2). What remains true is the operator-facing answer —
**field full-factory reset is unsupported**, because the tier is presence-gated
and no shipped board declares a physical recovery action, so no fielded device
can invoke it (`docs/design/recovery.md` §4). And the internal executor is not
an irreversible-lockdown mechanism either, which is the only thing this section
needed from it.

### 5.3 Image profile — the two profiles **[implemented]**, a sealed image **[not implemented]**

Decision 2026-08-17: prod ships SSH. **Two** profiles ship today, selected at
build time and recorded in the image, and that pair is complete rather than half
of a third.

`/usr/lib/mos/profile.conf` carries `MOS_PROFILE=dev` or `MOS_PROFILE=prod`,
mode 0444, written by the profile package
(`rootfs/packages-src/profile/Dockerfile`, selected as `mos-profile-dev` or
`mos-profile-prod`) rather than by `rootfs/build.sh` directly. It is under
`/usr/lib` and not
`/etc` because it describes the *image* rather than the device — and that also
puts it inside the read-only verity root, where a production device cannot be
edited into a development one.

**Both profiles now seed `access.ssh.enabled = false`**, and neither image ships
`ssh.service` enabled; both image verifiers assert the disabled state. The
profile therefore selects nothing about SSH today. `Profile` is kept anyway,
because `read_profile`'s fail-closed parsing is load-bearing on its own and a
per-profile default is the kind of thing that gets re-introduced: a missing
file, an unreadable path, a misspelt key, an empty value and an unrecognised
value all resolve to `prod`, and the comparison is **case-sensitive**, so `DEV`
resolves to `prod` too. The build rejects any `MOS_PROFILE` value that is not
exactly `dev` or `prod` in lowercase.

The `ROOT_PASSWORD` build arg is **v1-only** and is not selected by the profile
on mos: `rootfs/build.sh` and `rootfs/compose/` carry no such plumbing,
because the pack stage unconditionally fails any build whose factory shadow
holds a usable hash — for every account and on both profiles — and both
verifiers assert the same about the packed artifact. A baked mos root credential
is therefore unbuildable, dev profile included. Dev root access on mos is §4.1's
transient password set at runtime through mosd, plus the serial console, whose
root account stays locked until that password is set.

**A sealed image is unsupported.** `sealed` — the fully shell-free build where
"no shell" is part of the signed image identity — is **[not implemented]**, and
it is an absence rather than a build waiting to be wired up: **only dev and prod
exist, and both carry OpenSSH and the emergency BusyBox binary with SSH disabled
by default.** A deployment whose requirement is that a shell be *absent from the
signed image* is one mos should not be selected for; a deployment that needs the
shell off in practice uses the runtime disablement of §5.1 and key-only
persistent authentication, and accepts that both are reversible by whoever holds
the management credential.

Trade-off accepted with the prod decision: for `prod`, compile-time absence
no longer protects SSH; the effective defenses are default-off config, key-only
persistent auth (§4.1), and — when they exist — META lockdown (§5.2) and audit
(§6).

## 6. Brute force & audit — two intents **[implemented]**, two **[not implemented]**

Four intents were stated here. Two now have code and tests; two do not, and
saying which is which is the point of this section.

**As one sentence, because the pair is what an operator has to plan around:**
mos provides a bounded, persistent apid login backoff and a best-effort local
audit ring. It provides **no permanent lockout, no comprehensive shell or
session audit, and no automatic audit upload.** A legitimate administrator who
has armed the backoff waits out the window — it is capped, never permanent — and
an investigator collects the local audit files through authorized access,
reading them as a record of the events §6 lists below and not as a complete
history of who was on the device.

**[implemented] Failure counters and backoff state persist across a restart.**
`GuardStore` (`pkgs/mosd/apid/src/auth.rs`) wraps the in-RAM `LoginGuard` and
writes the consecutive-failure run and the window deadline to
`login_guard.json` on every mutation, atomically and 0600. A refused attempt
mutates nothing and therefore writes nothing — without that check an
unauthenticated caller hammering a throttled endpoint would convert every
refusal into an fsync.

*Deviation, deliberate: the state lives on **STATE**, not META as this section
originally said.* apid already creates and owns one state directory there
(`APID_STATE_DIR`, default `/var/lib/mos/apid`) holding its TLS material, and
a second persistence root on a second partition would double the surface —
two directories to create, two sets of permissions to hold, two failure modes
on a device whose META partition no daemon currently writes at runtime. What
§6 actually asks for is that a power cycle not reset the clock, and STATE
satisfies that: it survives reboot and A/B update alike.

The directory is 0700 (`StateDirectoryMode=0700` in `pkgs/mosd/dist/apid.service`;
apid's own `ensure_state_dir` uses the same mode when it creates the path
itself), every file in it is 0600, and the unit orders itself after the STATE
mount with `RequiresMountsFor=/var/lib/mos` — counters written to a tmpfs
standing in for an unmounted STATE would reset on the next power cycle, which
is the exact bypass the persistence exists to close.

The persisted form is an absolute deadline, so it is capped at `BACKOFF_MAX`
**on load** — a clock that stepped backwards, or a bit-flipped file that still
parses, must not arm a window the curve itself refuses to. Corruption and
unreadability both degrade to a clean in-RAM guard with a loud log, never to a
lockout: the failure direction here has to be open, because the alternative is
an appliance no operator can reach.

**[implemented] A bounded persistent audit trail.** `Audit`
(`pkgs/mosd/apid/src/audit.rs`) appends one JSONL line per audited event — RFC 3339
UTC timestamp, event, outcome, source address — into a two-file ring capped at
~512 KiB total, mirrored to the journal so the volatile log tells the same
story. Lines are fsynced individually, because the two most consequential
events are immediately followed by the machine going down. A line never
carries a password, a hash or any other credential material; callers pass
fixed strings and a peer address.

Audited today: login (`success`, `wrong-password`, `throttled`), logout,
setup completion (the moment the device leaves setup mode), a transient root
password being set (the event, never the password), the two power actions
(`requested`, `unconfirmed` — recorded **before** dispatch for the same
reason the sync exists), and the custom UI changing hands: `activated` when
start-up picks up a staged bundle (source `local` — the trigger is a
directory on disk, not a network peer), plus request-driven UI selection
(`activated`, `deactivated`, or `no-op`). The source address on request-driven
events comes from axum's
`ConnectInfo` (installed in `main.rs`); a missing connection degrades to
`unknown` rather than to a failed request, so audit wiring can never be what
makes a login fail.

**[not implemented] A hard lockout (`lockoutThreshold`) releasable only with
physical presence.** Not shipped, and not merely unfinished: the curve is
deliberately *never permanent* (`the_lockout_is_never_permanent`), because there
is no physical-presence mechanism to release one with — §9 records that an
operator locked out of apid has no software path back in. A permanent lockout
without a release path is a brick.

**Read as a capability: permanent login lockout is unsupported, and it is not
waiting on a schema change.** A valid administrator who trips the guard retries
after the bounded window, which is capped at 300 seconds however many attempts
preceded it. An operator who has lost the credential *and* every usable key is
not throttled but locked out, and their answer is §9.2's whole-disk reflash,
with the loss of data and of the device identity. The release path the threshold
would need does exist in code — a successful presence-gated credential rotation
clears the guard (`docs/design/recovery.md` §5.4) — and is unreachable on every
shipped board, which is why arming the threshold would strand operators rather
than protect them.

**[not implemented] Session lifecycle events, and upload.** **Read as a
capability: complete session-lifetime and SSH-session histories, and automatic
audit upload, are unsupported.** What IS recorded is not nothing, and the list
above is the whole of it: browser login and explicit logout are audited, as are
setup completion, the two power actions, transient-password events, UI changes
and the recovery outcomes `docs/design/recovery.md` §5.3 names. What is absent
is session duration and expiry, SSH session open and close, presence-check
history, and any exporter at all. **Collect the local audit files through
authorized access and do not read them as a complete record of who was on the
device.** The trail records attempts and power actions, not session
open/close/duration/presence-check, and nothing uploads it when connectivity
exists. The stronger claim this
section made — *no audit trail ⇒ no shell* — is **not** taken: a failed audit
write is logged and swallowed rather than refusing to serve management.
Refusing management when the disk fails is a lockdown decision with the same
brick risk as the paragraph above, and it is not this campaign's to take.

## 7. Provisioning paths — paths 1-2 **[implemented]**, paths 3-5 **[not implemented]**

**Paths 1 and 2 are built, and they are a complete boot-time document transport
rather than two fifths of a feature.** Both are one provisioning document read
from an offline medium at boot; `docs/design/provisioning.md` §4.1 is the
mechanism and this list is only the preference order it came from.

**Read as a capability: provision a device through a boot-time TOML document on
the boot medium or on attached removable media, or through browser setup over a
reachable network. Signed import, hotplug import, captive setup, HDMI local
setup and the tty2 wizard are all unsupported**, and paths 3 to 5 are an
ordering a later campaign might follow rather than work in progress. Apart from
the two offline documents, the only path in is apid over an existing network.

1. **[implemented]** BOOT-partition provisioning file (edit on SD/USB with any
   reader; physical possession of the boot medium already implies full
   control) — `docs/design/provisioning.md` §4.1.
2. **[implemented, and weaker than this line used to promise]** Config drop on
   removable media — `docs/design/provisioning.md` §4.1. This entry read
   *"signed config drop via USB (udev-triggered import; vendor-key
   signature)"*, and **what shipped has neither half**:
   - **no signature.** The transport verifies none, and there is no vendor key
     in the image for this purpose. Authorisation is physical possession of the
     medium, bounded by §4.4's already-claimed rule; the gap is stated in
     `docs/design/provisioning.md` §4.1.7 and closing it is a separate
     decision, not an oversight.
   - **no udev trigger.** Media are consulted **once, at boot**, before
     anything is listening. A stick pushed into a running appliance is a
     next-boot document; there is deliberately no rule by which inserting media
     reconfigures a live device.
3. **[not implemented]** AP-mode captive setup (connd + apid). **Captive-portal
   setup is unsupported**, and AP connectivity is not evidence that it is
   nearly here: the AP itself is real — `WifiApReconciler` renders hostapd and
   the DHCP configuration and operates the service — but nothing intercepts or
   redirects a client's first request, and the restricted PIN wizard this entry
   promised does not exist. Configure initial connectivity with a boot-time
   provisioning document, then open the normal management UI over a reachable
   network, including over an AP that has already been configured.
4. **[not implemented]** HDMI local setup: kiosk display renders the apid
   wizard with USB keyboard/touch input (design/display.md). **HDMI
   keyboard/touch setup is unsupported.** The browser client exists; no shipped
   kiosk launcher, display chain or USB-input setup flow connects it to a
   board's own screen, and displaying a web client is a product integration
   rather than a page to point at. Use a provisioning document, or a browser on
   another machine with network access to the device.
5. **[not implemented]** Console wizard (tty2) as the no-display, no-WiFi
   fallback. **There is no tty2 provisioning wizard**, and the serial login
   prompt is not one: there is no TUI, no restricted resource dispatcher and no
   PIN verifier anywhere in the tree. For a device with neither display nor
   Wi-Fi, use a boot-time provisioning document, and wired management
   connectivity where the deployment has it.

## 8. Phasing & campaign mapping

| Phase | Scope | Campaign | Status |
|---|---|---|---|
| 1 | `access.ssh` / `access.console` / `access.device` subtrees + `SshdReconciler`; OpenSSH driven by mosd; `dev`/`prod` image profile | M5 | **shipped 2026-08-19**, with the credential model **superseded** the same day (§4.2) |
| 1 | key-based access (schema v4 `authorizedKeys`), transient root password, SSH off and root passwordless on both profiles, `/home` and `/root` on DATA | campaign `sshweb` | **shipped 2026-08-19** (locally verified; every on-device behaviour is the user's hardware acceptance) |
| 1 | brute-force counters (persistent) + bounded audit trail | audit work | **shipped 2026-08-23** — on STATE, not META (§6 records the deviation) |
| 1 | tty3 console shell; META lockdown; hard lockout + physical presence; session/upload audit | — | **not implemented** (§5.2, §6) |
| 1 | reset tiers 1-3 and presence-gated credential recovery | PLAN-048 | **code shipped, field entry not implemented** — the tiers and the flow exist and are tested; no board declares a physical recovery action, so tier 3 and credential recovery are unsupported in the field (`docs/design/recovery.md` §4) |
| 2 | wizard TUI + derived PIN + provisioning file/USB import | with connd P2 | not started |
| 3 | challenge-response, physical presence, variant split enforcement in CI | hardening campaign | not started |

## 9. Recovery: what happens when the operator is locked out

### 9.1 There is no software path back in

An operator who loses the webAdmin password **and** every authorized key has
**no software path back into the appliance**. Stated exhaustively:

- **apid** is the only thing that can enable SSH, add a key or set a password,
  and it needs the webAdmin credential.
- **SSH** is off, and even enabled it would accept only a key that is not there.
- **The serial console is present and reachable, and offers no way in.** Be
  precise about this: systemd's getty-generator **does** spawn
  `serial-getty@ttyFIQ0` from the kernel `console=` parameter on both profiles.
  No package ships a getty unit; `mos-board-cx3576` ships only a drop-in that
  amends the generated one
  (`boards/cx3576/overlay/etc/systemd/system/serial-getty@ttyFIQ0.service.d/local-line.conf`).
  A login prompt appears. It has no account that will accept a
  credential — root is locked and every other account is locked by
  `mos-shadow-reconcile`.

**This reads like a regression and is not one, and the difference matters
because a reader who believes a regression happened will go looking for the
wrong fix.** Under M5 the per-device password did reach `/etc/shadow`, so the
console path was *nominally* usable — but nothing in the system ever exposed
that password to the operator (M5's own known gap). The path was already
unusable. This campaign makes it **honestly** unusable rather than closing a
working door.

**The path back in is now code, and it is not yet a door.**
`docs/design/recovery.md` section 5 designed it and
`POST /api/v1/recovery/credential` (`pkgs/mosd/apid/src/routes.rs`) implements
it: under the physical-presence contract of that document's section 4, the flow
**mints a new management credential and returns it once** on the channel that
proved presence, never discloses, decrypts or recovers the previous secret,
invalidates that secret at the same commit, bumps
`access.device.generation`, and audits every attempt including the refusals. It
is credential **rotation**, not disclosure, and it is not a permanent shell — an
authenticated session is refused and told to use section 4.1's change-password
path instead.

**What that does not change: 9.1 above is still the shipped truth on every
board.** The gate is one seam keyed by the board capability
`recovery.presence`, and the system side that writes the assertion ships too —
mosd maps a board-declared physical action into one at boot. What is missing is
the board half: **cx3576, x64 and virt-arm64 all declare
`BOARD_RECOVERY_ACTIONS` empty**, so no fielded device can produce an assertion
and **field credential recovery is unsupported** —
`docs/design/recovery.md` section 4 names that missing half and section 8
carries it as bench-dependent per board. Until a board has it, an operator who
has lost the credential and every key still reaches section 9.2, and the
successful-rotation release of the brute-force guard that section 6 records as
missing is likewise implemented but unreachable. Read those two sections
together before concluding a fielded unit can be recovered without a reflash.

### 9.2 What a whole-disk reflash recovers — **[implemented]**

The mos image is a **full-disk image carrying all eleven partitions**, and
`build/src/mkimage-cx3576.ts` builds fresh ext4 filesystems for META, STATE and DATA into
it (`mkext4` for each of `meta.img`, `state.img`, `data.img`). Flashing it over
rockusb therefore replaces all three:

- **STATE** — credentials and identity: settings, the webAdmin hash, the shadow
  file, sshd host keys, the device secrets;
- **META** — appliance and update metadata;
- **DATA** — mounted internally at `/mnt/data`, with appliance-owned `/mos` and
  operator-owned `/srv`; `/home` and `/root` are backed from `/mos`.

That is the appliance equivalent of Victron's physical-access guarantee (§11),
at the cost of everything stored on the device.

**One precision that must not be rounded off.** DATA grows past the flashed
image's extent on first boot (`systemd-repart`, `x-systemd.growfs`). A later
reflash writes only the image's own extent and a fresh GPT, so **the blocks
beyond that extent are left on the disk, unreferenced by the new
filesystem**. "Cleared" here means **unreachable through the new filesystem, not
erased**. An operator disposing of a device, or handing one to somebody else,
needs that distinction and should wipe the media rather than reflash it.

## 10. Persistence model: through the settings tree, not a writable `/etc`

**Decided by the user: model A. There is no `/etc` overlay, and there will not
be one.** Configuration is persisted **through the settings tree**; a service
that genuinely needs a hand-edited file gets a deliberate bind mount. The
consequences are stated plainly here because operators otherwise discover them
the hard way.

### 10.1 An unmodelled setting is an unsupported setting — **[implemented]**

Anything an operator needs to persist must be **modelled in the settings tree
and exposed by the UI**. There is no fallback where "just edit the file" works:
`/` is a verity-protected squashfs, and an edit under `/etc` either fails
outright or lands in a tmpfs and is gone at the next boot. If the UI cannot set
it, the appliance does not support persisting it.

### 10.2 Where a file genuinely must be hand-edited: a new bind — **[implemented]**

The mechanism is **one mount unit plus one verifier assertion**, added
deliberately — not an overlay. `mos-system` ships **eight enabled core binds**;
board and feature packages can add their own. Read the packaged units rather
than trusting a fixed profile-wide count.

| Bind unit | Source | Mountpoint | Tier |
|---|---|---|---|
| `mos.mount` | `/mnt/data/mos` | `/mos` | **DATA** |
| `srv.mount` | `/mnt/data/srv` | `/srv` | **DATA** |
| `etc-ssh.mount` | `/mnt/state/ssh` | `/etc/ssh` | STATE |
| `etc-hostname.mount` | `/mnt/state/hostname` | `/etc/hostname` | STATE |
| `var-lib-mos.mount` | `/mnt/state/mos` | `/var/lib/mos` | STATE |
| `home.mount` | `/mos/home` | `/home` | **DATA** |
| `root.mount` | `/mos/root` | `/root` | **DATA** |
| `usr-local-lib-systemd-system.mount` | `/mnt/state/systemd-units` | `/usr/local/lib/systemd/system` | STATE |

The cx3576 WiFi, AP and Bluetooth packages add the STATE-backed
`etc-wpa_supplicant.mount`, `etc-hostapd.mount` and
`var-lib-bluetooth.mount`. The container package ships
`etc-containers-systemd.mount`, which the reconciler enables only when the
container subsystem is enabled.

### 10.3 Files, scripts and data — **[implemented]**

They belong in `/home` or `/root` (DATA, via the two binds above) or directly
under `/srv`. They survive both a reboot and an A/B update, because RAUC writes
only the ROOTFS and BOOT slots and never touches DATA.

### 10.4 The survives-what table

| What | Reboot | A/B update | Factory reset |
|---|---|---|---|
| **Settings tree** (`/var/lib/mos/settings.toml`, STATE) — including `access.ssh.authorizedKeys` | **yes** | **yes** — RAUC writes only ROOTFS/BOOT | **no**, by definition. Not implemented today (§5.2); a whole-disk reflash is the closest real operation, and it replaces STATE outright |
| **`/home`, `/root`, `/srv`** (DATA) | **yes** | **yes** | **no**. On a reflash, replaced by the image's fresh DATA filesystem — but see §9.2: blocks beyond the flashed extent are *unreachable*, not erased |
| **Arbitrary `/etc` edits** | **no** — `/etc` is inside the verity squashfs except at its deliberate bind points; an edit elsewhere fails or is lost | **no** | n/a — there is nothing to lose |
| **`/var`** (EPHEMERAL) | **yes** for the files, and it is disposable by contract | **yes** — but nothing precious may live here; the build asserts it | **no**, and also wiped by a routine log cleanup, which costs nothing that matters |
| **Transient root password** (§4.1) | **no, deliberately** — cleared by `mos-shadow-reconcile` on the next boot | **no** | **no** |

The tier table this row set derives from is `docs/design/ro-root.md` §4.

### 10.5 The rejected alternative

**An overlayfs with its upper layer on STATE was rejected**: it creates two
sources of truth, where a stale operator edit silently shadows an updated image
file and the upgrade appears to do nothing.

## 11. Where this design diverges from Venus OS, and why

the inventory is the reference study. This document cites
Venus as its UX reference and then does the opposite in two places. Both
departures are deliberate; neither was written down until now.

### 11.1 The UX was copied and the credential lifecycle inverted

§4 names the Victron-style "password + UI toggle" as the phase-1 UX reference.
**Venus destroys the root password on every firmware update, deliberately**, and
Victron publishes the reason: `passwd` lives on the rootfs that an update fully
replaces, and Victron *wants* an end user with physical access to always be able
to regain access after locking themselves out. Firmware update is their reset
path.

mos does the opposite. `/etc/shadow` is a symlink onto STATE
(`docs/design/ro-root.md` §4), so credentials **survive image replacement** — an
A/B update changes nothing about who can log in. The UX was copied; the
credential lifecycle was inverted.

The consequence is §9: mos has no "update your way back in" path, and its
equivalent of Victron's physical-access guarantee is a whole-disk reflash that
costs the operator everything on DATA. That trade is accepted — a fleet
appliance whose credentials reset on every update is a different product — but
it must be stated, not discovered.

One thing mos deliberately does **not** copy is the persistence of the password
itself: mos's operator-set root password is transient by design (§4.1), which is
closer to Venus's outcome than to its mechanism.

### 11.2 The META lockdown is the inverse of that same Victron policy

§5.2's one-way META bit, which a factory reset deliberately does not clear, is
the **exact inverse** of the Venus policy above: Venus guarantees that physical
access always recovers the device; the lockdown bit guarantees that it
sometimes cannot. That is a defensible position for a deployed fleet appliance,
and it is a product decision rather than an implementation detail.

**And, per §5.2, it describes a control that does not exist.** Both facts belong
together: the design document currently contains an undated paragraph asserting
an inverse-of-reference security guarantee that no code implements. That
combination is the reason §0's markers were added.
