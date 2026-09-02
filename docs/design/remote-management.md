# Design: Remote Management & API Surface

> English | [中文](../zh/design/remote-management.md)
>
> Who reaches the device, over what, with which trust — as the tree stands
> today, plus the one requirement stated here and designed nowhere.

## 0. How to read the status markers

Markers follow `docs/design/access.md` section 0: **[implemented]** is *"code
exists and is named, by path"* (`docs/design/access.md`), **[not
implemented]** is *"deliberately, no code at all. Prose only"*
(`docs/design/access.md`). This section carries neither
(`docs/design/access.md`).

## 1. What reaches the device today — **[implemented]**

**apid, on the LAN, over HTTPS.** It is the *"mos API daemon (serves the web
dashboard)"* (`pkgs/mosd/dist/apid.service`), started as `/usr/bin/apid`
(`pkgs/mosd/dist/apid.service`) after mosd — `After=network.target mosd.service`
(`pkgs/mosd/dist/apid.service`). It binds an HTTPS listener and a
*"Redirect-only HTTP listen address"* (`pkgs/mosd/apid/src/config.rs`),
defaulting to `unwrap_or_else(|_| "0.0.0.0:443".to_string())`
(`pkgs/mosd/apid/src/config.rs`) and `unwrap_or_else(|_| "0.0.0.0:80".to_string())`
(`pkgs/mosd/apid/src/config.rs`). No second protocol, no third port.

**The API is the gate.** `app` structurally reserves `/api`, `/_ui`, `/healthz`
and `/` before the custom-bundle fallback (`pkgs/mosd/apid/src/routes.rs`).
The static SPA is always readable; appliance data is not. Each management API
handler extracts either a stored bearer token or a signed browser session. A
session-authenticated mutation additionally requires its random
`X-CSRF-Token`. Setup and session discovery are the narrowly defined
unauthenticated API operations; `/healthz` proves listener liveness only.

**The JSON API under `/api` is the complete management protocol.** It includes
versioned settings/state reads, typed writes and collections, queued task
records, setup/session lifecycle, UI selection, live network observation and
system actions. Its generated contract is
`pkgs/mosd/apid/openapi.json`. There are no HTML form mutation routes beside
it.

**apid owns no state; it is a client of mosd** over D-Bus — its one backend
choice is *"Which message bus to reach"* (`pkgs/mosd/apid/src/config.rs`) mosd on,
carrying one interface *"for the settings, state and transient-password calls"*
(`pkgs/mosd/apid/src/bus_client.rs`) and another for the power actions. mosd
holds the tree (`BusName=com.mos.mosd`, `pkgs/mosd/dist/mosd.service`); *"apid
never spawns a process and never talks to systemd itself"*
(`pkgs/mosd/apid/src/settings_api.rs`).

**SSH and the console are access channels, not management ones**, and both are
shut: SSH ships *"off by default on both"* profiles
(`docs/design/access.md`), the tty3 shell has *"no reconciler consuming it"*
(`docs/design/access.md`), the serial console has *"no account that will
accept a credential"* (`docs/design/access.md`).

**That is the whole list.** There is **no device-initiated management channel
and no fleet plane in this tree**: nothing dials out, nothing enrolls a device,
no component holds more than one device. Every path in is inbound, on the LAN.

## 2. Reaching devices behind NAT, and managing a fleet — **[not implemented]**

A device sits behind NAT on somebody else's network. It must be reachable for
support, and a fleet of them must be manageable, **without an inbound port**:
an appliance whose owner has to forward a port has no support story, and one
that forwards a port carries an attack surface its owner did not choose. That
forces a device-initiated channel — the device dials out and management rides
back down the connection the device opened.

**The requirement is live and has no design.** Nothing under `docs/design/`
covers remote reachability or fleet management; section 1 is the whole of what
the tree does. This section records the gap and does not close it. Three
decisions any future design settles first, each constraining the others:

- **Where the management endpoint is hosted, and who runs it** — a service with
  an availability story and a compromise story of its own, and no existence
  today.
- **How a device enrolls**, and what revoking an enrollment does. mosd already
  mints per-device identity at first boot — *"A device instead gives itself an
  identity and its credentials here, at first boot, from the system CSPRNG"*
  (`pkgs/mosd/mosd/src/identity.rs`) — so enrollment has something to bind to.
- **How update targeting shares the channel.** Per-device targeting and
  management want the same device-initiated connection; decided separately they
  produce two.

## 3. Update control flow

**What holds today — [implemented].** Installation is local and mosd owns it:
`InstallUpdate(bundle_path)` (`docs/design/mosd.md`) hands a bundle already
on the device to RAUC, against *"the A/B update design this implements"*
(`docs/design/ro-root.md`). The boot health gate confirms the new slot and
*"probes systemd, mosd and apid first"* (`docs/design/mosd.md`); an
unconfirmed slot spends boot credits until *"a slot that cannot complete a boot
is guaranteed to exhaust its credits"*
(`docs/design/uboot-ab-handshake.md`) and the bootloader falls back.

**What does not exist — [not implemented].** No on-device pull: the device-side
verifier is built and tested on the host, and *"nothing ships it to a device
yet"* (`pkgs/rauc-sign/README.md`). apid declares no update route
(`pkgs/mosd/apid/src/routes.rs`), so it offers no local check/apply button
either; earlier text here claiming one described a surface that is not there.

**The constraint on any future trigger.** Whatever triggers an update — a
policy pull, a remote trigger over section 2's channel, a local one — converges
on the one update path with its verification, health gate and rollback. A
trigger is a way *into* that path, never a bypass of it: an endpoint that could
hand a device an installable payload directly would make compromise of the
endpoint equal to compromise of every device it reaches.

## 4. Security posture

**Exposed today — [implemented].** apid on the LAN is the entire inbound
management surface. `/_ui` and custom UI assets are public static code on that
origin; every appliance operation and datum is protected by the `/api`
credential boundary described in section 1.

**Not exposed today — [implemented], as an absence the build asserts.** No
other inbound management port, no outbound management connection, and **no
operator credential provisioned onto a device**. A signed rootfs is
byte-identical on every unit, so a credential baked into one would be *"a
fleet-wide shared secret"* (`rootfs/scripts/pack-assert-shadow-chain.sh`)
— the pack step fails the build over that, and the reasoning binds any future
fleet credential too.

**The invariant a future channel must hold — [not implemented].** Each plane is
an independent credential domain; compromise of one grants nothing in another.
An apid session is not an enrollment credential, an enrollment credential is
not a root shell, and an endpoint holding a fleet's channel credentials must
not thereby hold the keys that authorise an image — the update trust anchor is
already *"a separate key hierarchy"* (`pkgs/rauc-sign/README.md`) and stays one.
