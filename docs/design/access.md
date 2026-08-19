# Design: Debug & Maintenance Access

> English | [中文](access.zh.md)
>
> Shell/SSH/console access for an immutable appliance — configuration-driven,
> auditable, lockable, and absent from production images. Companion to
> architecture.md §5. Implementation is phased; phase 1 ships a per-device
> default password, later phases upgrade auth without changing the model.
>
> **Base change (PLAN-010 M5, 2026-08-19).** This document was written for the
> Talos/COSI base. The **model** below survives intact — channels, phases,
> layered disablement, brute-force accounting, provisioning paths. The
> **mechanism** does not: there is no `DebugAccessConfig` document, no COSI
> controller, and no Go sshd in a machined multi-call binary. Phase 1 as
> shipped is described in §3 and §4; §2's channel table is annotated with what
> exists today. The `.zh.md` sibling has not been updated and is stale.

## 1. Principles

- Access channels are **first-class services under the model layer**
  (settings subtree → reconciler → service), never side doors around it. This
  was "config document → COSI controller → service" on the Talos base; the
  shape is the same and the executor is now mosd over systemd.
- **Provisioning and debugging are different problems.** A weak-auth,
  resource-whitelisted wizard covers "no network on site"; a strong-auth full
  shell covers deep debugging. One almighty shell for both inevitably drags
  auth strength down to usability level.
- "Disabled" must exist at three strengths (see §5); the strongest is
  compile-time absence.

## 2. Channels

| Channel | Capability | Auth | Availability |
|---|---|---|---|
| Network wizard (tty2 TUI; AP captive portal; HDMI local wizard via kiosk) | whitelisted network COSI resources only; no secrets, no exec, no raw logs | per-device PIN | all variants |
| SSH (**OpenSSH**, driven by mosd) | root | phase 1: per-device password; phase 2+: offline challenge-response | **prod and dev** (default off in `prod`, on in `dev`) — **shipped** |
| Console shell (tty3) | root | same as SSH | `access.console.shellEnabled` exists in schema v3; **no reconciler consumes it yet** |
| Rescue (`talos.rescue=1` / all-slots-failed FIT entry) | chroot repair environment | physical access (cmdline / boot failure) | all variants |
| Factory (rockusb / SoC loader mode) | full reflash | physical access + recovery key | hardware-level |

**Superseded mechanism.** The original design had the SSH server implemented in
Go (`x/crypto/ssh` + pty) inside the machined multi-call binary, reading its
policy from COSI — no OpenSSH, no separate C daemon. On the systemd base that
is not what ships: the image carries **OpenSSH**, and mosd renders a drop-in and
drives `ssh.service` (§3). The argument the Go sshd was making — one policy
source, no config-file drift — is preserved by mosd owning the only file that
configures sshd, not by replacing sshd. busybox is likewise not shipped; the
debug profile uses the base image's shell.

## 3. Configuration model

### 3.1 As shipped (PLAN-010 M5)

Access policy is a subtree of the mosd settings tree (`docs/design/mosd.md` §3),
schema version 3, persisted to `/var/lib/mos/settings.toml` on STATE:

```toml
[access.ssh]
enabled = false
port = 22
permitRootLogin = true
passwordAuthentication = true
listenAddresses = []          # empty = LISTEN ON ALL — see below

[access.console]
shellEnabled = false

[access.device]
generation = 0
# passwordHash is optional and absent until first boot mints it
```

Flow: settings subtree → **`SshdReconciler`** → three system effects, in this
order:

1. `/etc/ssh/sshd_config.d/10-mos.conf` is rendered from `access.ssh`;
2. the device password is hashed with bcrypt and written into the root
   account's `/etc/shadow` entry;
3. `ssh.service` is brought to the state `enabled` asks for.

**Credential before service start is deliberate.** A running sshd whose root
account still carries the image's hash is precisely the failure the ordering
rules out, and it is a failure that looks green from the outside: the unit is
active, the config is on disk, and nobody can log in — or worse, everybody can
with the same fleet-wide secret.

Unit enablement is **runtime-scoped** (`EnableUnitFiles` with `runtime = true`,
so symlinks land in `/run/systemd/system`). Persistent enablement would need
`/etc/systemd/system` to be writable, and on the v2 read-only root it is not —
a persistent enable would fail with EROFS on device while passing every test on
a normal filesystem. mosd reconciles the whole tree at every start, so the unit
returns to its configured state on each boot without a persisted symlink.

The reconciler re-renders, compares against what is on disk, and skips the write
when the bytes match — the drop-in lives on STATE, so an unconditional rewrite
would cost a flash write on every reconcile. One case is deliberately not a
no-op: when the drop-in changed and sshd is already running, the unit is
**restarted**, because a rewritten configuration that nothing re-reads is a
configuration that silently did not take effect.

`access.webAdmin` (webd's own credential) is unchanged from schema v2 and is not
part of this subtree.

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

`permitRootLogin` and `passwordAuthentication` both default to `true` because
phase 1 has exactly one account (root) and exactly one credential (the device
password); turning either off in phase 1 would leave no way in at all. They
exist as settings now so phases 2 and 3 can flip them without a schema bump.

### 3.3 Not yet modelled

`idleTimeout`, `autoDisableAfter`, the `bruteForce` block and the one-way
`lockdown` bit are **not in schema v3**. They remain the design intent of §5 and
§6 and need a schema change when they land. The original YAML sketch is retained
below as the record of that intent:

```yaml
# NOT SHIPPED — design intent for later phases
ssh:
  idleTimeout: 15m
  autoDisableAfter: 2h         # opened channels fall closed automatically
bruteForce: { backoffBase: 1s, backoffMax: 300s, lockoutThreshold: 20 }
lockdown: false                # one-way; see §5
```

## 4. Authentication phases

- **Phase 1 (current, shipped in PLAN-010 M5)**: a per-device password,
  generated **on the device** at first boot and never present in the image.
  Fleet-wide constants are forbidden; the Victron-style "password + UI toggle"
  is the UX reference.

  The full credential model — why the secrets are minted on device, why there
  are **two** independent secrets rather than one, and why the same password is
  stored under **two different hash formats** — is stated once in
  **`docs/design/provisioning.md` §3**. Read that section before changing
  anything here; the two-hash arrangement in particular looks redundant and is
  not.

  What phase 1 gives the operator: `/etc/shadow`'s root entry carries a bcrypt
  hash of the device password, so `pam_unix` accepts it on SSH and on the local
  console; `access.device.passwordHash` carries an Argon2id hash of the same
  password, which mosd and webd verify against themselves. The plaintext is on
  STATE at `/var/lib/mos/secrets/device-password`, 0600, so the operator can be
  *told* what it is.

  Phase 1 depends on `/etc/shadow` being writable, which on the v2 read-only
  root it is not by default. It is made writable by moving it to STATE — see
  `docs/design/ro-root.md` §4.
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

**Phases 2 and 3 supersede the shadow route.** Phase 1 goes through
`/etc/shadow` because `pam_unix` is the only thing that can authenticate an
OpenSSH password login, and phase 1 has exactly one account and one credential.
Both later phases authenticate **directly against mosd** — a derived PIN checked
against a stored hash (phase 2), and a signature verified against a compiled-in
public key (phase 3) — neither of which `crypt(3)` can express at all.

The consequence worth recording now: when phase 2 or 3 lands, the bcrypt copy in
`/etc/shadow` stops being the credential of record and becomes a legacy fallback
to be locked, and the STATE-backed shadow machinery in `ro-root.md` §4 exists
only to keep that fallback working. It is not permanent architecture.

## 5. Layered disablement

1. **Runtime**: `enabled: false` → controller stops the service (reversible).
2. **META lockdown**: one-way bit in the META partition; when set, machined
   ignores config and never registers the services. Cleared only by full wipe
   — but factory reset (STATE/EPHEMERAL wipe) deliberately does NOT clear it:
   "forgot the password" is self-serviceable, "un-lock the shell" is not.
3. **Image profile** (decision 2026-08-17 — prod ships SSH). **Two** profiles
   ship today, selected at build time and recorded in the image:

   `/usr/lib/mos/profile.conf` carries `MOS_PROFILE=dev` or `MOS_PROFILE=prod`,
   mode 0444, written by `os/rootfs/build.sh` / `build-v2.sh`. It is under
   `/usr/lib` and not `/etc` because it describes the *image* rather than the
   device — and on v2 that also puts it inside the read-only verity root, where
   a production device cannot be edited into a development one.

   - `prod`: sshd included, **`access.ssh.enabled` seeded `false`** at first
     boot; opening it requires an authenticated admin action.
   - `dev`: `access.ssh.enabled` seeded `true`.

   mosd reads this file once, on first boot, to seed the setting, and **fails
   closed**: a missing file, an unreadable path, a misspelt key, an empty value
   and an unrecognised value all resolve to `prod`, and the comparison is
   **case-sensitive**, so `DEV` resolves to `prod` too. The two ways of being
   wrong are not symmetric — guessing `dev` on a malformed file opens SSH on a
   production device, while guessing `prod` inconveniences a developer who can
   flip one setting. The build rejects any `MOS_PROFILE` value that is not
   exactly `dev` or `prod` in lowercase, rather than shipping an image that
   silently self-provisions to `prod`.

   `ssh.service`'s **static enablement in the image follows the profile**, and
   both image verifiers assert the agreement in both directions. Without that,
   a prod image would have sshd listening from early boot until mosd's
   reconciler got around to stopping it.

   `sealed` — the fully shell-free build where "no shell" is part of the signed
   image identity — **is not implemented.** It remains the design intent for
   high-security deployments.

   Trade-off accepted with the prod decision: for `prod`, compile-time absence
   no longer protects SSH; the effective defenses are default-off config,
   auth strength (§4), META lockdown (§5.2), and audit (§6).

## 6. Brute force & audit

- Failure counters and backoff state persist in **META**, not RAM — a power
  cycle must not reset the clock (the classic embedded bypass).
- Exponential backoff to a hard lockout (`lockoutThreshold`), releasable only
  with physical presence.
- Every attempt/session (open, close, source, duration, presence check) →
  syslogd + bounded persistent ring buffer; uploaded when connectivity exists.
  No audit trail ⇒ no shell — this is what makes the channel defensible in
  security review.

## 7. Provisioning paths (ordered by preference)

1. BOOT-partition provisioning file (edit on SD/USB with any reader; physical
   possession of the boot medium already implies full control).
2. Signed config drop via USB (udev-triggered import; vendor-key signature).
3. AP-mode captive setup (connd + webd; PLAN-008 Part D).
4. HDMI local setup: kiosk display renders the webd wizard with USB
   keyboard/touch input (design/display.md).
5. Console wizard (tty2) as the no-display, no-WiFi fallback.

## 8. Phasing & campaign mapping

| Phase | Scope | Campaign | Status |
|---|---|---|---|
| 1 | `access.ssh` / `access.console` / `access.device` subtrees + `SshdReconciler`; OpenSSH driven by mosd; per-device password minted on device; `dev`/`prod` image profile | PLAN-010 M5 | **shipped 2026-08-19** (locally verified; on-device SSH login is the user's acceptance) |
| 1 | tty3 console shell; META brute-force counters; audit wiring | — | **not implemented.** `access.console.shellEnabled` exists in the schema with no consumer; §6's counters and audit trail have no schema representation yet |
| 2 | wizard TUI + derived PIN + provisioning file/USB import | with connd P2 | not started |
| 3 | challenge-response, physical presence, variant split enforcement in CI | hardening campaign | not started |

**§5.2's META lockdown bit and §6's brute-force accounting and audit trail are
not implemented.** They are the reason phase 1's default-off SSH is defensible
in the long run, and nothing in M5 delivers them. Recorded here so that the
absence is visible rather than assumed from the phase-1 "shipped" row above.
