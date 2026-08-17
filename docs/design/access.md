# Design: Debug & Maintenance Access

> Shell/SSH/console access for an immutable appliance — configuration-driven,
> auditable, lockable, and absent from production images. Companion to
> architecture.md §5. Implementation is phased; phase 1 ships a per-device
> default password, later phases upgrade auth without changing the model.

## 1. Principles

- Access channels are **first-class services under the COSI model** (config
  document → controller → service), never side doors around it.
- **Provisioning and debugging are different problems.** A weak-auth,
  resource-whitelisted wizard covers "no network on site"; a strong-auth full
  shell covers deep debugging. One almighty shell for both inevitably drags
  auth strength down to usability level.
- "Disabled" must exist at three strengths (see §5); the strongest is
  compile-time absence.

## 2. Channels

| Channel | Capability | Auth | Availability |
|---|---|---|---|
| Network wizard (tty2 TUI; AP captive portal via connd/webd) | whitelisted network COSI resources only; no secrets, no exec, no raw logs | per-device PIN | all variants |
| Full shell (tty3 console; SSH via Go sshd + busybox) | root | phase 1: per-device default password; phase 2+: offline challenge-response | debug variant only |
| Rescue (`talos.rescue=1` / all-slots-failed FIT entry) | chroot repair environment | physical access (cmdline / boot failure) | all variants |
| Factory (rockusb / SoC loader mode) | full reflash | physical access + recovery key | hardware-level |

SSH server is implemented in Go (`x/crypto/ssh` + pty), lives in the machined
multi-call binary, is supervised like webd, and reads its policy from COSI —
no OpenSSH, no separate C daemon, no config-file drift. busybox provides
`/bin/sh` and basic tools (~1MB), debug variant only.

## 3. Configuration model

```yaml
apiVersion: v1alpha1
kind: DebugAccessConfig
console:
  networkWizard: { enabled: true, tty: tty2, auth: { mode: derivedPIN, keyGeneration: 1 } }
  shell:        { enabled: false, tty: tty3, auth: { mode: staticPassword } }   # phase 1 mode
ssh:
  enabled: false
  port: 22
  listenAddresses: []          # empty = none; bind management subnets only
  auth: { mode: staticPassword }   # -> publicKey / challengeResponse in later phases
  idleTimeout: 15m
  autoDisableAfter: 2h         # opened channels fall closed automatically
bruteForce: { backoffBase: 1s, backoffMax: 300s, lockoutThreshold: 20 }
lockdown: false                # one-way; see §5
```

Flow: `DebugAccessConfig` → DebugAccessController → `DebugAccessStatus`
resource → service start/stop, no reboot. webd renders status ("debug channel
open, 1h23m remaining") from the same resource.

## 4. Authentication phases

- **Phase 1 (current)**: static per-device password (baked at provisioning,
  hash in STATE via Argon2id — parameters sized on target hardware). Fleet-wide
  constants are forbidden; the Victron-style "password + UI toggle" is the UX
  reference.
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

## 5. Layered disablement

1. **Runtime**: `enabled: false` → controller stops the service (reversible).
2. **META lockdown**: one-way bit in the META partition; when set, machined
   ignores config and never registers the services. Cleared only by full wipe
   — but factory reset (STATE/EPHEMERAL wipe) deliberately does NOT clear it:
   "forgot the password" is self-serviceable, "un-lock the shell" is not.
3. **Image variant**: prod images exclude busybox/sshd/console-shell at build
   time. This is the only layer an attacker with config/META write access
   cannot cross, and on non-UEFI ARM (no PCR measurement) it is what makes
   "no shell" part of the signed image identity.

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
4. Console wizard (tty2) as the no-WiFi fallback.

## 8. Phasing & campaign mapping

| Phase | Scope | Campaign |
|---|---|---|
| 1 | DebugAccessConfig + controller; Go sshd + busybox (debug variant); tty3 shell; static per-device password; META counters; audit wiring | access-layer campaign (after board bring-up) |
| 2 | wizard TUI + derived PIN + provisioning file/USB import | with connd P2 |
| 3 | challenge-response, physical presence, variant split enforcement in CI | hardening campaign |
