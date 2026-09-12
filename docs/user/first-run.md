# First boot, offline setup and claiming the device

A Mica OS appliance must reach a fully working state with zero external input —
no DHCP server, no DNS, possibly no cable. That property is designed in, not
incidental. This page covers what the first boot does by itself, the offline
route for configuring a device with no network at all, and how the device
stops being unclaimed and becomes yours.

## 1. What the device does by itself

On the first boot from empty DATA state directories, the management daemon seeds the device's
configuration once, atomically, before anything else consumes it:

- a **device id** — 32 hex characters drawn from the system CSPRNG;
- a **hostname** — `mos-` followed by the first eight hex characters of the
  device id. Derived from the identity, not from the network, so it is stable
  across subnets, lease renewals and NIC replacements, and short enough to
  print on a label;
- per-device secrets, minted on the device — never baked into the image,
  which is byte-identical across every device of a release;
- **SSH off**, on both image profiles;
- **no network configuration** — deliberately. The image ships a static DHCP
  match for wired `eth*` interfaces, so a fresh device acquires an address on
  any DHCP network without mosd guessing interface names.

A durable undo journal covers the DATA configuration documents and DATA identity
record. A pending rollback must finish before the next startup can consume them
([provisioning.md](../design/provisioning.md#413-idempotence-and-atomicity)).
A failed seed aborts loudly and the next boot retries from scratch; a
half-provisioned device that looks provisioned is the failure this design
refuses. SSH host keys are generated on the device on first boot, and DATA
grows to fill the disk (see [install.md](install.md)).

> status: shipped — evidence: `docs/design/provisioning.md`, `rootfs/overlay/usr/lib/mos/mos-seed-state`

The authenticated early loader creates `/mnt/data/state/machine-id` before
systemd on every current target and binds it read-only at `/etc/machine-id`.
It stays stable across reboot, update and rollback. A complete reflash creates a
new identity. No identity is stored in the bootloader's attempt records.

> status: shipped — evidence: `pkgs/mos-deploy/src/bin/mos-init.rs`, `verify/src/checks-file-root.ts`

## 2. Finding the device

- On a DHCP network: the device requests an address on its wired interfaces
  and announces the `mos-xxxxxxxx` hostname to the DHCP server. Its own name
  also resolves locally on the device regardless of DNS.
- The management surface is **apid over HTTPS** on the device's address (port
  443, with port 80 redirecting). The TLS certificate is generated per device,
  so a first visit shows a self-signed-certificate warning — expected, and
  worth explaining to operators rather than training them to ignore warnings
  elsewhere.

> status: shipped — evidence: `pkgs/mosd/apid/`, `docs/design/remote-management.md`

On cx3576 neither Ethernet port has a MAC address in hardware, so the device
derives one for each of them from the eMMC chip identifier and from where the
port is attached to the board. The addresses are therefore stable across
reboots, reflashes and image updates.

> status: board-dependent — evidence: `boards/cx3576/hwinit/hwinit-mac`, `boards/cx3576/bsp/init/mac.conf`, `make os-mac-test`

## 3. The offline route: a provisioning document

A device with no network you control, or one that has to arrive configured out
of the box, is configured by a **provisioning document**: one TOML file named
`mos-provisioning.toml`, at the root of a medium's filesystem, read once
during the first boot and applied before anything else.

**Read this first, because it is where the feature is most often assumed to be
broken: a provisioning document is honoured ONLY while the device has no
administrator credential.** Once a device is claimed — by setup, or by an
earlier document — a document offered on a medium is refused with
`already-claimed` and nothing on it is applied. **A fielded device cannot be
re-provisioned from a stick.** That is the rule that makes an unsigned
transport safe, and it is not a defect to be worked around: reconfiguring a
claimed device goes through the authenticated API. An operator who pushes a
card into a running appliance and sees no change is seeing this rule, not a
failure.

### The two transports

| Transport | Where the file goes | When it is read |
|---|---|---|
| `boot` | the UEFI ESP, by its GPT label `esp`; absent on cx3576 | first; written with any card reader, with the medium out of the device |
| `media` | an attached removable block device — its partitions first, then the bare disk | when the ESP is absent or carries no document |

Both are read **once, at boot, before anything is listening**. There is
deliberately no udev trigger and no HTTP route that applies a document: a
stick pushed in later is a next-boot document, never a way to reconfigure a
running appliance. The internal eMMC or NVMe the device boots from is never a
candidate for the `media` source. A medium that will not mount never becomes a
document at all, so `journalctl -u mos-provisioning-import` is where an
operator whose stick did nothing looks first — not the status route.

> status: board-dependent — evidence: `rootfs/overlay/usr/lib/mos/mos-provisioning-import`, `boards/cx3576/board.env`, `boards/x64/board.env`

### What it may carry, and what it refuses by name

A document may set the device identity, the first administrator password and
authorized SSH keys, wired network settings, WiFi client networks, and time
settings. Every key maps onto a setting that already exists and is validated
by the same validator an API write goes through.

**Two things are refused by name, and asking for them is an error, not an
omission**: a **certificate** section and a **hostname**. There is no settings
path for either — the only certificate on the device is apid's own self-signed
TLS pair, a file in DATA/state rather than a setting, and the device names itself
from the identity the document injects. A document carrying either is refused
naming the offending key.

Two more properties an operator has to plan around:

- **The whole document is validated before any of it is applied.** One bad
  field applies nothing, and the refusal names the key path and never the
  value — so a malformed file cannot leak the password it carries into a log,
  and cannot leave a device half-configured either. A refusal is not a brick:
  the device comes up unclaimed and configurable.
- **Neither transport verifies a signature.** Said plainly, because a reader
  who infers it can infer it wrong: the document is checked against no key at
  all. Its only authorisation is physical possession of the medium, bounded by
  the already-claimed rule above.

The file is left on the medium exactly as written — not deleted, not
rewritten. **Treat a provisioning medium as credential material**, because a
document may carry an administrator password and a WPA2 pre-shared key, and
one document may be written onto a whole batch of cards.

`GET /api/v1/provisioning/status` reports, to an authenticated caller, which
document version and digest were last applied and what the last import attempt
did. It returns no value the document carried.

> status: shipped — evidence: `pkgs/mosd/mosd/src/provisioning_doc.rs`, `pkgs/mosd/apid/src/provisioning_api.rs`, `docs/design/provisioning.md`

**What has never been executed on hardware.** The document parser, its
validators and the status route are covered by tests. The *transports* are
not: no test and no bench run has staged a real boot partition or a real USB
stick into a booting device, and the boot-partition transport in particular
has never run on a physical board. The mechanism ships; the procedure is
unproven, and a board dossier is where a run of it gets recorded
([../boards/qualification.md](../boards/qualification.md)).

> status: shipped — evidence: `rootfs/overlay/usr/lib/mos/mos-provisioning-import`, `docs/design/provisioning.md`

## 4. Claiming the device

**The claim is the unclaimed → claimed transition**, and the one fact that
decides which side a device is on is whether an administrator credential
exists. Exactly two channels can create the first one:

1. **Setup** — the first visit to `/_ui/`, or `POST /api/v1/setup` for API
   clients. You choose the administrator password; the route establishes a
   browser session and mints a one-time bearer token for automation. A second
   setup call on a claimed device is refused with `already_configured` and
   writes nothing.
2. **A provisioning document** — section 3. The password came off the medium.

From the claim onward, every management read and write is authenticated. See
[api.md](api.md) for the session and token model and
[configuration.md](configuration.md) for what to configure next.
`GET /api/v1/claim` answers, to an authenticated caller, which channel claimed
the device and when.

### The rotation bound, and what it does not do

A device claimed **by a provisioning document** holds a bootstrap secret: it
sat in plaintext on a medium the device deliberately does not erase, and one
document may have been written onto a batch of cards. So that claim sets
`rotationRequired`. Until it is discharged, the device serves every read and
refuses every authenticated **mutation** with `409 rotation_required` —
except signing in, reading why, and `POST /api/v1/actions/change-password`,
which is the one action that clears it. A claim through setup sets no such
flag: that password was never written down anywhere the device can reason
about.

**The bound is FIRST SIGN-IN, not elapsed time, and nothing counts down.** A
device that is claimed but has never been signed into keeps its bootstrap
credential working **indefinitely** — a unit that came off the line with a
document on its card and then sat in a warehouse for a year is holding the
same working password on the day it is unboxed. That is deliberate: this
appliance enforces no deadline against its own clock, because an unclaimed
device is exactly the device with no synchronised clock, and a window that
closed with nobody in it would leave a device nobody can get into. **A reader
who takes "forced rotation" to mean the credential stops working on its own
will plan an exposure window that does not exist.** What bounds that exposure
before the first sign-in is physical custody of the medium, and nothing else.

### Two things the claim is not

- **It is not an SSH credential.** SSH stays off until an authenticated
  administrator enables it and installs a key — [security.md](security.md)
  covers the access model.
- **It is not recoverable by the device today.** Losing the administrator
  credential and every authorized SSH key leaves no software path back in on
  any board that exists. A credential-recovery flow is built and is refused on
  a fielded device for the reason [recovery.md](recovery.md) section 5 states.
  Store the credential accordingly.

> status: shipped — evidence: `pkgs/mosd/apid/openapi.json`, `docs/design/access.md`
