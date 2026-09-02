# Manufacturing: identity, factory records and quarantine

This page is for the team putting mos onto units at volume: who creates a
device's identity and its first credential, which records a factory has to
keep, and what happens to a unit that fails a station or is provisioned twice.

**The headline, first, because everything else reads differently without it:
mos ships no factory tooling.** What ships is the device half — a unit that
mints its own identity on first boot, an offline provisioning document that
can carry a first configuration onto it, and the loader-level flash that puts
an image there. Everything that makes those into a *factory* — versioned input
pools, verification at injection, per-device result records, quarantine
handling, RMA linkage — is designed and not built. This page marks which is
which at every section, and does not promote a design into a procedure.

## 1. Who creates identity, and who cannot

**The device mints its own identity, and the factory does not supply one.** On
the first boot from empty STATE the device draws a 32-hex-character `deviceId`
from its own CSPRNG, derives its `mos-xxxxxxxx` hostname from it, and mints
its per-device secrets and SSH host keys — on the device, with no network, and
never in the image. An image is byte-identical across every unit of a release,
which is exactly why nothing secret may be baked into one.

The consequence for a line is structural rather than procedural: **a station
cannot copy, assign or reuse an identity, because there is no input for one.**
What a station can do is *witness* the first boot completing and *record* the
`deviceId` the device reports. That is the designed step, and it is the shape
every future factory-injected material (device certificates, fleet identity)
has to fit.

> status: shipped — evidence: `rootfs/overlay/usr/lib/mos/mos-seed-state`, `docs/design/provisioning.md`

## 2. Who creates the first credential

Exactly two channels can create a device's first administrator credential, and
which one a line uses is the main manufacturing decision on this page:

- **Setup at the end customer.** The unit ships unclaimed; the first person to
  reach `/_ui/` chooses the password. The factory never holds a credential.
- **A provisioning document at the factory.** The password is written into
  `mos-provisioning.toml` on the boot partition or a removable medium and
  applied on the first boot. The factory holds that password.

If a line uses the second, three rules follow and none of them is optional:

1. **The medium is credential material.** The document is left on it —
   deliberately, since deleting it would need a writable mount of an
   operator's filesystem during a boot that may lose power. Treat a batch of
   cards carrying a document exactly as you would treat a batch of printed
   passwords.
2. **One document written across a batch is one password across a batch.**
   The device cannot tell that apart from a per-unit password, and it does not
   try to.
3. **The device demands a rotation at first sign-in — and never before.** A
   claim by document sets `rotationRequired`, and until the operator changes
   the password the device refuses every authenticated mutation. But the bound
   is the sign-in, not a clock: a unit that came off the line and sat in a
   warehouse holds a working bootstrap password indefinitely. Section 4 of
   [first-run.md](first-run.md) states that in full; a line that plans an
   exposure window around an expiry is planning around something that does not
   exist.

A document is applied **only while the device has no administrator
credential**. A unit that has already been claimed cannot be re-provisioned
from a medium, at the factory or anywhere else.

> status: shipped — evidence: `pkgs/mosd/mosd/src/provisioning_doc.rs`, `docs/design/provisioning.md`

## 3. What a factory record must contain

Designed, not built. One record per device, opened at the first station,
closed at pass or at quarantine, and retained for the support lifetime of the
product. It carries:

- the device identity — `deviceId`, serial, MAC addresses — **as read back
  from the device**, never as assigned;
- every versioned input the unit consumed: the release version flashed, the
  serial and MAC pool identifiers and the values drawn from them, calibration
  station versions, and the digests of any key or trust-anchor material;
- per-station **measured evidence against bounds**, not bare verdicts. A
  station that records only `PASS` has recorded nothing a later support case
  can compare a field failure against;
- the final disposition: **pass**, or **quarantined** with the failing station
  and its evidence;
- for a reworked unit, the old→new identity link.

Two verification rules shape those entries: nothing is injected unverified,
and nothing is verified only by the tool that wrote it. An image is read back
and checked against the release's digests before first boot; a serial or MAC
is read back through the *runtime* path — the booted system reporting it — and
checked against the allocation.

The full requirement, with the owning role for each step, is
[../design/manufacturing.md](../design/manufacturing.md). mos ships no record
format, no schema and no station tooling for any of it, and no work is in
flight to build one: a line that needs these records builds them.

> status: unsupported

## 4. Quarantine: failed and duplicated provisioning

Designed, not built. A unit that fails any station **stops moving forward**.
Quarantine means all of the following, together:

- the record is marked with the failure and its evidence, and the unit is
  **physically segregated** — a failed unit that stays in the flow is a failed
  unit that ships;
- **consumed identity values stay consumed.** A serial or MAC drawn for this
  unit is not returned to the pool while the unit exists. A "freed" MAC that
  later ships in a reworked unit alongside the original is a field-debugging
  disaster with a factory-side cause;
- **a duplicate serial or MAC is a quarantine event, not a retry.** Detecting
  it at read-back is the point of reading back through the runtime path;
- the only two exits are **rework**, which opens a new record generation, or
  **scrap**, which closes the record with the disposition and with the
  **destruction of any credential-bearing storage**. A scrapped unit's STATE
  holds secrets in the clear, so physical destruction is the honest disposal —
  the same conclusion [recovery.md](recovery.md) section 6 reaches for a unit
  leaving an operator's control.

**Identity is never cloned.** The invariant is that a device identity exists
on exactly one physical device, ever. A replacement board gets a **new**
identity — which the shipped design already guarantees, since identity is
drawn on the device and a reflash replaces STATE outright. Nobody images one
unit's STATE onto another to "preserve" its identity; serial-number continuity
is handled in the record, not on the flash. At RMA intake the returned unit's
credentials are treated as **exposed** from the moment it is received, and any
fleet-side trust tied to that identity is revoked at intake rather than at
diagnosis.

That invariant is the one part of this section the product enforces by
construction rather than by procedure.

> status: shipped — evidence: `rootfs/overlay/usr/lib/mos/mos-seed-state`, `docs/design/provisioning.md`

Everything else above — the quarantine record, the segregation, pool
accounting, duplicate detection, the rework generation and the scrap
disposition — is a requirement on a line, with no tooling behind it and none
planned.

> status: unsupported

## 5. Debug and recovery ports, factory versus field

The distinction is between a device that is not yet anyone's and one holding
an operator's credentials and data:

| Port | At the factory | In the field, as shipped |
|---|---|---|
| Serial console | open; a station may use it to witness provisioning | a login prompt exists and **no account accepts a credential** |
| SSH / management | station network and station credentials | off by default on both profiles; key-only, operator-enrolled |
| SoC loader (cx3576: rockusb) | the flashing primitive | open to physical access — this **is** the recovery path |
| JTAG/SWD | open on the bench | per board and revision; no mos board today documents or enforces a closed state |

The honest field posture is therefore: **software access closed by default and
credential-gated; physical access open by design.** That is not a gap to be
closed quietly. Both mos boards stand at I1 on the boot-assurance ladder
(`docs/design/security-model.md` section 5), and the loader port being open is
what makes the recovery path in [recovery.md](recovery.md) exist at all.

**No irreversible operation ships on any board.** Fusing a debug port off,
locking a boot configuration or burning a key hash is irreversible on most
SoCs, and on a device whose recovery path *is* the physical port an incorrect
fuse does not degrade the unit — it destroys the recovery path and can brick a
whole batch. Nothing in this tree fuses anything, and nothing may, until the
exact sequence has been proven on sacrificial hardware of the same board
revision and named in the record of every unit it is applied to.

> status: board-dependent — evidence: `docs/design/manufacturing.md`, `boards/cx3576/board.env`

## 6. What a line can actually do today

Assembled from the sections above, with nothing designed counted as available:

1. Build or receive an image, and verify it against the image contract
   ([install.md](install.md) section 2). A development-keyring image never
   goes on a unit that leaves the building.
2. Flash it over the board's loader transport ([install.md](install.md)
   sections 4 and 5).
3. Optionally place a provisioning document, and accept the credential
   handling that comes with it (section 2 above).
4. Witness the first boot and read back the `deviceId` the device minted
   ([install.md](install.md) section 6 lists what a good first boot looks
   like).
5. Keep your own record of steps 1 to 4. mos provides no record format, no
   station tooling and no pool management, and will not until the work in
   sections 3 and 4 is built.

Nothing in this sequence has been executed on physical hardware from this
tree; the board dossier carries every hardware-dependent row as `not tested`.

> status: board-dependent — evidence: `docs/bsp/cx3576-example.md`, `docs/bsp/qualification.md`
