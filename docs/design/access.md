# Design: Debug & Maintenance Access

> English | [中文](../zh/design/access.md)
>
> Shell/SSH/console access for an immutable appliance — configuration-driven,
> auditable, lockable, and absent from production images. Companion to
> architecture.md §5.
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
| Console shell (tty3) | root | same as SSH | `access.console.shellEnabled` exists in the schema with **no reconciler consuming it** — **not implemented** |
| Serial console (`serial-getty@ttyFIQ0`) | login prompt only | `/etc/shadow`, i.e. nothing by default | **present** — spawned by systemd's getty-generator from the kernel `console=` parameter on both profiles. It has no account that will accept a credential; see §9 |
| Rescue (all-slots-failed FIT entry) | chroot repair environment | physical access (cmdline / boot failure) | **not implemented** |
| Factory (rockusb / SoC loader mode) | full reflash | physical access | hardware-level; see §9.2 |

**One policy source.** The image carries **OpenSSH**, and mosd renders the only
drop-in that configures it and drives `ssh.service` (§3). That ownership is what
keeps sshd's policy in one place: there is no second, operator-edited
`sshd_config` for the settings tree to drift against. busybox is not shipped;
the debug profile uses the base image's shell.

## 3. Configuration model — **[implemented]**

Implemented by `pkgs/mosd/mosd-settings/src/model.rs` (the tree),
`pkgs/mosd/mosd/src/reconciler/sshd.rs` (the reconciler) and
`pkgs/mosd/mosd/src/transient.rs` (the transient password).

### 3.1 As shipped

Access policy is a subtree of the mosd settings tree (`docs/design/mosd.md` §3),
**schema version 4**, persisted to `/var/lib/mos/settings.toml` on STATE:

```toml
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
and §6 and need a schema change when they land. The original YAML sketch is
retained below as the record of that intent:

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

Both later phases authenticate **directly against mosd** — a derived PIN checked
against a stored hash, and a signature verified against a compiled-in public
key — neither of which `crypt(3)` can express at all. The STATE-backed shadow
machinery in `ro-root.md` §4 now exists only for the transient password and for
keeping every other account locked; it is not permanent architecture.

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

**And factory reset itself is not implemented either.** Nothing in the tree
performs one. The only mention in code is a doc comment in
`pkgs/mosd/mosd/src/provisioning.rs` explaining why wiping STATE *would* return the
device to first boot. So this paragraph describes a reset nobody can invoke,
preserving a bit nobody can set — which is precisely why §0's marker discipline
exists. Whether the lockdown is built at all is an open product decision.

### 5.3 Image profile — **[partial]**

Decision 2026-08-17: prod ships SSH. **Two** profiles ship today, selected at
build time and recorded in the image.

`/usr/lib/mos/profile.conf` carries `MOS_PROFILE=dev` or `MOS_PROFILE=prod`,
mode 0444, written by `rootfs/build.sh`. It is under `/usr/lib` and not
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

**Missing (hence *partial*):** `sealed` — the fully shell-free build where "no
shell" is part of the signed image identity — is **not implemented**. It remains
the design intent for high-security deployments.

Trade-off accepted with the prod decision: for `prod`, compile-time absence
no longer protects SSH; the effective defenses are default-off config, key-only
persistent auth (§4.1), and — when they exist — META lockdown (§5.2) and audit
(§6).

## 6. Brute force & audit — **[partial]**

Four intents were stated here. Two now have code and tests; two do not, and
saying which is which is the point of this section.

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
deliberately *never permanent* (`the_lockout_is_never_permanent`), because
there is no physical-presence mechanism to release one with — §9 records that
an operator locked out of apid has no software path back in. A permanent
lockout without a release path is a brick, so the threshold waits on the
presence work in §7.

**[not implemented] Session lifecycle events, and upload.** The trail records
attempts and power actions, not session open/close/duration/presence-check,
and nothing uploads it when connectivity exists. The stronger claim this
section made — *no audit trail ⇒ no shell* — is **not** taken: a failed audit
write is logged and swallowed rather than refusing to serve management.
Refusing management when the disk fails is a lockdown decision with the same
brick risk as the paragraph above, and it is not this campaign's to take.

## 7. Provisioning paths (ordered by preference) — **[not implemented]**

None of these five is built; they are the ordering a later campaign should
follow. Today the only path in is apid over an existing network.

1. BOOT-partition provisioning file (edit on SD/USB with any reader; physical
   possession of the boot medium already implies full control).
2. Signed config drop via USB (udev-triggered import; vendor-key signature).
3. AP-mode captive setup (connd + apid).
4. HDMI local setup: kiosk display renders the apid wizard with USB
   keyboard/touch input (design/display.md).
5. Console wizard (tty2) as the no-display, no-WiFi fallback.

## 8. Phasing & campaign mapping

| Phase | Scope | Campaign | Status |
|---|---|---|---|
| 1 | `access.ssh` / `access.console` / `access.device` subtrees + `SshdReconciler`; OpenSSH driven by mosd; `dev`/`prod` image profile | M5 | **shipped 2026-08-19**, with the credential model **superseded** the same day (§4.2) |
| 1 | key-based access (schema v4 `authorizedKeys`), transient root password, SSH off and root passwordless on both profiles, `/home` and `/root` on DATA | campaign `sshweb` | **shipped 2026-08-19** (locally verified; every on-device behaviour is the user's hardware acceptance) |
| 1 | brute-force counters (persistent) + bounded audit trail | audit work | **shipped 2026-08-23** — on STATE, not META (§6 records the deviation) |
| 1 | tty3 console shell; META lockdown; hard lockout + physical presence; session/upload audit; factory reset | — | **not implemented** (§5.2, §6) |
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
