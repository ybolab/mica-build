# Design: Manufacturing and Device-Identity Lifecycle

> How a device is born, proven, and — when it fails — reworked, without ever
> cloning an identity or losing the record. Owner role throughout: the
> **manufacturing owner** (`docs/design/security-lifecycle.md` §0), with the
> **support owner** taking over at RMA intake. Companion to
> `docs/design/provisioning.md` (what the device mints for itself),
> `docs/design/security-model.md` (the boundaries manufacturing must not
> undermine) and `docs/design/boards.md` (the board contract these steps
> instantiate).

## 0. How to read this document, and the current reality

Markers are `docs/design/security-lifecycle.md` §0's: **[procedure]** —
executable with shipped tooling; **[partial]** — executable with a named gap;
**[proposed]** — no tooling; prose only.

The current reality, stated first so the rest reads as the plan it is:
**mos has no factory tooling today.** What ships is first-boot
self-provisioning — the device mints its own `deviceId`, hostname and secrets
on first boot, on the device, never in the image
(`docs/design/provisioning.md` §2–3) **[implemented]** — and the SoC-loader
whole-disk reflash as the flashing/recovery primitive
(`docs/design/access.md` §9.2) **[implemented]**. Everything that makes those
two into a *factory* — versioned inputs, injection verification, result
records, quarantine, RMA linkage — is **[proposed]** unless marked
otherwise. This document exists so that when factory work is built, it is
built to these rules rather than improvised at a contract manufacturer.

## 1. Versioned factory inputs — **[proposed]**

Every input a factory consumes is **versioned, immutable once issued, and
named in the per-device record** (§3). A device built from unversioned
inputs cannot be audited, recalled by cohort, or reproduced. The input
classes:

- **The release image** — already versioned and signed
  (`docs/design/release-signing.md`); the factory flashes a named release,
  never a loose build. A development-keyring image
  (`meta/GENERATED`-derived) must never be flashed at a factory station. Three
  mechanisms now stand behind that sentence: the image verifier's gate
  (`verify/src/checks-root.ts`), the **publication gate**, which refuses a
  `candidate` or `stable` release whose image carries
  `/usr/share/mos/meta/GENERATED` and names the file
  (`docs/design/release-artifacts.md` §4.1), and the **device itself**, which
  reports `trust.grade` on `GET /api/v1/system/info` so a station can ask a
  flashed unit what it trusts. The factory-side check is §2's.
- **Serial number pools** — issued to a factory as a bounded, versioned
  allocation; a serial is consumed exactly once, and an exhausted or
  withdrawn pool is closed, never reused.
- **MAC address pools** — same discipline; allocations come from
  organisationally owned OUI space, are bounded per order, and consumption
  is recorded per device. (On cx3576 the MAC reaches the hardware through
  the board's hwinit facts; the factory input is the *allocation*, the
  board contract is how it is applied.)
- **Calibration data** — per-device measurements (radio, sensors, display)
  produced by versioned test stations; the station software version is part
  of the calibration record.
- **Identity material** — see §2: mos identity is minted on-device by
  design, so the factory input is not an identity but the *procedure and
  station version* that triggers and witnesses first boot. If a future
  fleet identity (device certificates, `docs/design/security-lifecycle.md`
  §1.3) adds factory-injected material, its issuing CA and batch are
  versioned inputs here.
- **Keys** — any board boot keys (I3/I4 boards,
  `docs/design/security-lifecycle.md` §1.5) arrive as versioned public
  material plus a fusing procedure; private halves never travel to a
  factory. The production trust anchors are **not** a factory input today:
  both the RAUC keyring and the package signing keys ride inside the image
  (`docs/design/release-signing.md` §2.3, §2.5), so the versioned input that
  carries them is the release image above and the factory injects nothing.
  A provisioning channel for the keyring is still open; if one ships, the
  file it delivers becomes a versioned public input here with its sha256
  checked at injection.
- **The build host's `meta/` directory** — not a factory input, and named
  here because it is the input a recall would otherwise fail to reach.
  `meta/` holds the RAUC CA certificate, the bundle signer, the package
  signing key and this deployment's `updates/manifest.json` — the update
  server address, the channel and the trusted keys the image is built to
  believe. It is **gitignored**, so a deployment's configuration is not
  reproducible from a checkout: a build is reproducible only together with
  the `meta/` its build host carried, and that pairing belongs in the release
  record beside the keys. Two images can report the same `BOARD`, `PROFILE`
  and `VERSION` and differ in what they trust; where they do, `PROFILE` is
  the field that has to tell them apart (`release-signing.md` §2.6).

## 2. Injection, and verification at injection — **[proposed]**

Nothing is injected unverified, and nothing is verified only by the tool
that wrote it. Per class:

- **Image** — after flashing, read back and verify against the release's
  published digests before first boot; a station that flashes and hopes is
  how a stale or development image ships. The release's own artifacts carry
  the digests (`docs/design/release-signing.md` §3).
- **Serial/MAC** — written to the board's storage (fuses, EEPROM, or the
  board contract's fact files), read back through the *runtime* path (the
  booted system reports them), and checked against the allocation — both
  that the value is the assigned one and that it has not been consumed
  before. A duplicate MAC or serial is a §4 quarantine event, not a retry.
- **Calibration** — applied, then exercised: the station validates the
  calibrated subsystem's output against acceptance bounds, not merely that
  the write succeeded.
- **Identity** — the station witnesses first boot completing
  (`provisioning.state = "complete"`, `docs/design/provisioning.md` §2) and
  records the minted `deviceId` read from the device. The station never
  supplies or copies a `deviceId`: identity is drawn from the device's own
  CSPRNG, which is what makes cloning §5's structural impossibility rather
  than a policy request.
- **Keys/anchors** — public material verified by digest against the
  versioned input before and after write; for fuses, see §7 before any
  production use.

## 3. The per-device manufacturing result record — **[proposed]**

One record per device, created at the first station and closed at pass or
quarantine, retained for the support lifetime of the product. It contains:

- the device identity (`deviceId`, serial, MACs) as **read back**, not as
  assigned;
- every versioned input consumed (§1): release version, pool ids and the
  values drawn from them, calibration station versions, key/anchor digests;
- per-station **pass/fail evidence** — measured values against bounds, not
  bare verdicts, so a later field failure can be compared against what the
  factory measured; a station that records only "PASS" has recorded
  nothing a support case can use;
- the final disposition: **pass**, or **quarantined** with the failing
  station and evidence (§4);
- for reworked devices, the old→new identity link (§5).

The record is the factory-side twin of the board qualification evidence
(`docs/design/boards.md` §7's checklist discipline): rows are pass, fail or
not-tested — never implicitly green.

## 4. Quarantine of failures — **[proposed]**

A device that fails any station stops moving forward. Quarantine means:

- the record is marked with the failure and its evidence, and the device is
  physically segregated;
- consumed identity values (serial, MAC) stay consumed — they are not
  returned to the pool while the device exists, because a "freed" MAC that
  ships in a reworked unit alongside its original is a field-debugging
  disaster with a factory-side cause;
- the only exits from quarantine are **rework** (§5, producing a new
  record generation) or **scrap**, which closes the record with the
  disposition and the destruction of any credential-bearing storage
  (a scrapped device's STATE holds secrets; `docs/design/security-model.md`
  §6 — plaintext at rest — makes physical destruction the honest disposal).

## 5. Rework and RMA — identity is never cloned — **[proposed]**, with the invariant partly enforced by design

The invariant: **a device identity exists on exactly one physical device,
ever.** No step of rework, repair or RMA copies an identity onto other
hardware. Concretely:

- A **replacement board gets a NEW identity.** A replacement built from a
  fresh flash mints a fresh `deviceId` on first boot — the shipped design
  already guarantees this, since identity is CSPRNG-drawn on device and a
  reflash replaces STATE outright (`docs/design/provisioning.md` §2,
  `docs/design/access.md` §9.2). What manufacturing adds is the rule's
  other half: nobody images one device's STATE partition onto another to
  "preserve" its identity, serial-number continuity is handled in the
  record, not on the flash, and any future factory-injected identity
  material (§2) is issued per physical device and never re-issued.
- The **record links old→new**: the RMA record names the returned device's
  identity, the replacement's identity, and the disposition of the
  returned unit (reworked under a new record generation, or scrapped per
  §4). Support history follows the link; the identity does not.
- The returned device's credentials are treated as exposed: STATE is
  unencrypted (`docs/design/security-model.md` §6), so an RMA intake
  assumes every secret on the device is readable by whoever shipped it,
  and any fleet-side trust tied to that device identity is revoked at
  intake, not at diagnosis.
- RMA intake and authorization belong to the **support owner**; physical
  rework and the new record generation to the **manufacturing owner**.

## 6. Debug and recovery-port policy, per lifecycle stage — **[partial]**

The policy distinguishes **factory** (the device is not yet anyone's; the
line needs full access) from **field** (the device holds an operator's
credentials and data; the boundary is
`docs/design/security-model.md` §1's). Per port:

| Port | Factory | Field (today, as shipped) |
|---|---|---|
| Serial console | open; stations may use it for provisioning witness | present, login prompt only, **no account accepts a credential** (`docs/design/access.md` §2, §9.1) **[implemented]** |
| SSH / management | station network, station credentials | off by default on both profiles; key-only persistent access, operator-enrolled (`docs/design/access.md` §4.1) **[implemented]** |
| SoC loader / recovery (cx3576: rockusb) | the flashing primitive | open to physical access — this **is** the recovery path and the physical-access boundary; closing it is an I4-class decision (§7) |
| JTAG/SWD | open on the bench | policy is **per board/revision** and recorded in the board's evidence (`docs/design/boards.md`); no mos board today documents or enforces a closed state **[proposed]** |

The honest field posture today is therefore: software access closed by
default and credential-gated; physical access open by design and stated as
the boundary. A board claiming a *closed* physical debug posture makes an
I4-ladder claim and owes the evidence for it
(`docs/design/security-model.md` §5).

## 7. Irreversible operations: fusing debug-off and boot policy — **[proposed]**, deliberately last

Fusing a debug port off, locking a boot configuration, or burning a key hash
is **irreversible on most SoCs**, and on a device whose recovery path *is*
the physical port (§6), an incorrect fuse does not degrade the device — it
destroys the recovery path and can brick the unit or the batch. Rules,
absolute:

- **No irreversible operation enters production without board-specific
  validation**: the exact fuse sequence proven on sacrificial hardware of
  the same board *revision*, including proof that the fused device still
  boots, still updates A/B, and still has a validated recovery path — or a
  recorded, deliberate acceptance that it has none.
- The validated sequence, its board revision, and its evidence are named in
  the manufacturing record of every device it is applied to (§3); a fuse
  step with no evidence row is a §4 quarantine of the *procedure*, not
  just the device.
- Vendor documentation is input, not evidence: SoC fuse maps differ across
  revisions and vendor docs have been wrong before; only the sacrificial
  run on the same revision counts.
- Until a board carries that validation, mos ships **no** fused debug or
  boot policy for it — which is today's state for every board, consistent
  with every board standing at I1 (`docs/design/security-model.md` §5).
