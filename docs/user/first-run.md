# First boot and initial setup

A mos appliance must reach a fully working state with zero external input —
no DHCP server, no DNS, possibly no cable. That property is designed in, not
incidental, and this page describes what actually happens on the first boot
and how you then claim the device.

## 1. What the device does by itself

On the first boot from empty STATE, the management daemon seeds the device's
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

A failed seed aborts loudly and the next boot retries from scratch; a
half-provisioned device that looks provisioned is the failure this design
refuses. SSH host keys are generated on the device on first boot, and DATA
grows to fill the disk (see [install.md](install.md)).

> status: shipped — evidence: `docs/design/provisioning.md`, `rootfs/overlay/usr/lib/mos/mos-seed-state`

On cx3576, the device also persists a machine id into the redundant U-Boot
environment on first boot, so `/etc/machine-id` is stable from the second boot
onward; on boards without a writable bootloader environment the unit is
inert and the machine id is per-boot transient.

> status: board-dependent — evidence: `rootfs/overlay/usr/lib/mos/mos-machine-id`, `boards/cx3576/boot.cmd`

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

## 3. Claiming the device: setup

The first visit to the built-in UI at `/_ui/` (or `GET /api/v1/session`, which
reports setup state to API clients) runs **setup**: you create the
administrator credential. Setup establishes a browser session and returns a
one-time bearer token for API-only clients. From that point every management
read and write is authenticated; see [api.md](api.md) for the session and
token model and [configuration.md](configuration.md) for what to configure
next.

Two things setup is not:

- It is not an SSH credential. SSH remains off until an authenticated
  administrator enables it and installs a key —
  [security.md](security.md) covers the access model.
- It is not recoverable by the device. Losing the administrator credential
  and every authorized SSH key leaves **no software path back in**;
  [recovery.md](recovery.md) states what that costs. Store the credential
  accordingly.

> status: shipped — evidence: `pkgs/mosd/apid/openapi.json`, `docs/design/access.md`

## 4. Factory and offline onboarding

Today, the only way to change configuration is the authenticated API over an
existing network (plus the physical console for a transient root password once
SSH-level access is set up). The offline provisioning *channels* — a
provisioning file on the boot medium, a signed USB configuration drop, an AP
captive portal, an HDMI setup wizard, a serial wizard — are a designed,
ordered list with an invariant (every channel converges on the same validated
settings write path), and none of them is implemented. Factory injection of
initial configuration and a bounded device-claim flow are part of the same
plan.

Until that lands, factory/offline reality is: the device self-provisions to a
working state offline (section 1), and claiming and configuring it requires
putting it on a network you control.

> status: proposed — evidence: `docs/plan/PLAN-046.md`, `docs/design/provisioning.md`

TODO(PLAN-046): revisit after this plan merges
