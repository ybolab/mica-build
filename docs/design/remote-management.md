# Design: Remote Management & API Surface

> English | [中文](remote-management.zh.md)
>
> Who reaches the device, over what, with which trust — as the tree stands
> today, plus the one requirement stated here and designed nowhere. The
> `.zh.md` sibling was written against the retired framing and is stale.
>
> **Naming convention for this document, because the name collided.** Bare
> **`apid`** below means the mos product daemon: the HTTPS management daemon
> that serves the API, with the dashboard as one client of it. The upstream
> Talos machine API daemon, written **Talos `apid`** in older material, is not
> part of this system and exists nowhere in this repository; no sentence below
> uses the bare name for both.

## 0. How to read the status markers

Markers follow `docs/design/access.md` section 0: **[implemented]** is *"code
exists and is named, by path"* (`docs/design/access.md:15`), **[not
implemented]** is *"deliberately, no code at all. Prose only"*
(`docs/design/access.md:17`). This section carries neither
(`docs/design/access.md:33-34`).

## 1. What reaches the device today — **[implemented]**

**apid, on the LAN, over HTTPS.** It is the *"mos API daemon (serves the web
dashboard)"* (`os/pkgs/mosd/dist/apid.service:2`), started as `/usr/bin/apid`
(`os/pkgs/mosd/dist/apid.service:14`) after mosd — `After=network.target mosd.service`
(`os/pkgs/mosd/dist/apid.service:3-4`). It binds an HTTPS listener and a
*"Redirect-only HTTP listen address"* (`os/pkgs/mosd/apid/src/config.rs:19`),
defaulting to `unwrap_or_else(|_| "0.0.0.0:443".to_string())`
(`os/pkgs/mosd/apid/src/config.rs:34-35`) and `unwrap_or_else(|_| "0.0.0.0:80".to_string())`
(`os/pkgs/mosd/apid/src/config.rs:36-37`). No second protocol, no third port.

**One gate in front of everything.** `app` is *"The HTTPS application router"*
(`os/pkgs/mosd/apid/src/routes.rs:130`) and its outermost layer is the auth gate
(`os/pkgs/mosd/apid/src/routes.rs:228`), which *"routes every request into setup mode,
login, or through"* (`os/pkgs/mosd/apid/src/routes.rs:3305`) on a session cookie minted
at first-run setup or at login. `/healthz` and the declared API routes are the
only exemptions; they *"answer for themselves"*
(`os/pkgs/mosd/apid/src/routes.rs:3308-3309`).

**The JSON API under `/api` is read-only.** The router reserves the prefix and
*"every other path under it 404s"* (`os/pkgs/mosd/apid/src/routes.rs:216-217`); every
route inside is a GET — `get(api_v1_settings)` (`os/pkgs/mosd/apid/src/routes.rs:421`)
and `get(api_v1_state)` (`os/pkgs/mosd/apid/src/routes.rs:423`), beside version
discovery and metadata. `docs/design/api.md` section 1 records the whole of
*"The surface as it exists today"* (`docs/design/api.md:96`).

**apid owns no state; it is a client of mosd** over D-Bus — its one backend
choice is *"Which message bus to reach"* (`os/pkgs/mosd/apid/src/config.rs:5`) mosd on,
carrying one interface *"for the settings, state and transient-password calls"*
(`os/pkgs/mosd/apid/src/bus_client.rs:3-4`) and another for the power actions. mosd
holds the tree (`BusName=com.mos.mosd`, `os/pkgs/mosd/dist/mosd.service:11`); *"apid
never spawns a process and never talks to systemd itself"*
(`os/pkgs/mosd/apid/src/settings_api.rs:10-12`).

**SSH and the console are access channels, not management ones**, and both are
shut: SSH ships *"off by default on both"* profiles
(`docs/design/access.md:55`), the tty3 shell has *"no reconciler consuming it"*
(`docs/design/access.md:56`), the serial console has *"no account that will
accept a credential"* (`docs/design/access.md:57`).

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
  (`os/pkgs/mosd/mosd/src/identity.rs:6-7`) — so enrollment has something to bind to.
- **How update targeting shares the channel.** Per-device targeting and
  management want the same device-initiated connection; decided separately they
  produce two.

## 3. Update control flow

**What holds today — [implemented].** Installation is local and mosd owns it:
`InstallUpdate(bundle_path)` (`docs/design/mosd.md:468`) hands a bundle already
on the device to RAUC, against *"the A/B update design this implements"*
(`docs/design/ro-root.md:7-8`). The boot health gate confirms the new slot and
*"probes systemd, mosd and apid first"* (`docs/design/mosd.md:484`); an
unconfirmed slot spends boot credits until *"a slot that cannot complete a boot
is guaranteed to exhaust its credits"*
(`docs/design/uboot-ab-handshake.md:434-435`) and the bootloader falls back.

**What does not exist — [not implemented].** No on-device pull: the device-side
verifier is built and tested on the host, and *"nothing ships it to a device
yet"* (`os/pkgs/rauc-sign/README.md:12`). apid declares no update route
(`os/pkgs/mosd/apid/src/routes.rs:138-229`), so it offers no local check/apply button
either; earlier text here claiming one described a surface that is not there.

**The constraint on any future trigger.** Whatever triggers an update — a
policy pull, a remote trigger over section 2's channel, a local one — converges
on the one update path with its verification, health gate and rollback. A
trigger is a way *into* that path, never a bypass of it: an endpoint that could
hand a device an installable payload directly would make compromise of the
endpoint equal to compromise of every device it reaches.

## 4. Security posture

**Exposed today — [implemented].** apid on the LAN, behind section 1's session
gate, is the entire inbound management surface.

**Not exposed today — [implemented], as an absence the build asserts.** No
other inbound management port, no outbound management connection, and **no
operator credential provisioned onto a device**. A signed rootfs is
byte-identical on every unit, so a credential baked into one would be *"a
fleet-wide shared secret"* (`os/rootfs/scripts/pack-assert-shadow-chain.sh:26`)
— the pack step fails the build over that, and the reasoning binds any future
fleet credential too.

**The invariant a future channel must hold — [not implemented].** Each plane is
an independent credential domain; compromise of one grants nothing in another.
An apid session is not an enrollment credential, an enrollment credential is
not a root shell, and an endpoint holding a fleet's channel credentials must
not thereby hold the keys that authorise an image — the update trust anchor is
already *"a separate key hierarchy"* (`os/pkgs/rauc-sign/README.md:52-53`) and stays one.
