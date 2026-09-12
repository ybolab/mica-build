# Design: Remote Management & API Surface

> Who reaches the device, over what, with which trust. Status markers follow
> `docs/design/access.md` section 0: **[implemented]** means code exists and is
> named by path; **[not implemented]** means prose only.

## 1. What reaches the device today — **[implemented]**

**apid, on the LAN, over HTTPS.** `pkgs/mosd/dist/apid.service` starts
`/usr/bin/apid` after `mosd.service`. It binds an HTTPS listener (default
`0.0.0.0:443`) and a redirect-only HTTP listener (default `0.0.0.0:80`), both
configured in `pkgs/mosd/apid/src/config.rs`. There is no other protocol or
port.

**The API is the gate.** apid reserves `/api`, `/_ui`, `/healthz` and `/`
before the custom-bundle fallback (`pkgs/mosd/apid/src/routes.rs`). The static
SPA is always readable; appliance data is not. Each management API handler
requires a stored bearer token or a signed browser session, and a
session-authenticated mutation also requires its random `X-CSRF-Token`. Setup
and session discovery are the only unauthenticated API operations; `/healthz`
proves listener liveness only.

**The JSON API under `/api` is the complete management protocol**: versioned
settings and state reads, typed writes and collections, queued task records,
setup and session lifecycle, UI selection, live network observation and system
actions. Its generated contract is `pkgs/mosd/apid/openapi.json`.

**apid owns no state; it is a client of mosd** over D-Bus
(`pkgs/mosd/apid/src/bus_client.rs`). mosd holds the tree as `com.mos.mosd`;
apid never spawns a process and never talks to systemd itself.

**SSH and the console are access channels, not management channels**, and
both are closed by default: SSH is off on both image profiles, the tty3 shell
has no reconciler, and the serial console has no account that accepts a
credential (`docs/design/access.md`).

**No device-initiated management channel or fleet plane ships.** Nothing dials
out and nothing enrolls a device; every path in is inbound, on the LAN.

## 2. Reaching devices behind NAT — requirement

A device behind NAT on somebody else's network must be reachable for support,
and a fleet must be manageable, **without an inbound port**: forwarding a port
leaves an appliance without a support story or with an attack surface its
owner did not choose. That forces a device-initiated channel — the device dials
out and management rides back over the connection it opened.

## 3. Fleet protocol — designed, **[not implemented]**

The device-to-plane v1 protocol is designed in
[`docs/plan/20260910-1910-fleet-device-plane-protocol.md`](../plan/20260910-1910-fleet-device-plane-protocol.md):
off by default, outbound-only, trust-on-first-use registration, allowlisted
registration and report payloads, and separate consent for reporting. mosd's
first-boot device identity (`pkgs/mosd/mosd/src/identity.rs`) is what
enrollment binds to. The runtime — registration, renewal, revocation, a durable
report queue and the plane service — is tracked by
[`docs/task/20260912-2058-fleet-runtime.md`](../task/20260912-2058-fleet-runtime.md),
which also moves the protocol into `docs/design/`.

## 4. Update control flow

The implemented local path is signed catalog check, missing-object acquisition,
verified deployment staging, native installation, reboot and health confirmation.
`mos-deploy` authenticates current contracts and serializes installation with
collection/reset. mosd exposes the lifecycle over D-Bus; apid and the built-in
System page show candidate/current/fallback identities and distinct acquisition,
installation, reboot and confirmation states. There is no old backend or bundle
path accepted by the native installer.

The source is an operator setting, seeded from public factory defaults and
changed through the authenticated API. It names `/v1/manifest.json`; changing a
source or channel cannot change the metadata anchors embedded in authenticated
boot policy. Offline `.mosupd` import converges on the same verified workspace.
The catalog's freshness/replay checks apply to acquisition, not installed offline
boot. Firmware artifacts have a separate publication and offline maintenance
flow, outside ordinary OS updates.

Automatic policy uses the device's configured schedule, maintenance window and
reboot policy. Reboot gating prevents an unrelated reboot from discarding an
unsettled update; override is explicit and audited. Native contract, policy and
API tests exist, with x64 and virt-arm64 guest evidence; physical board
evidence is tracked in [support tiers](../boards/support-tiers.md#current-boards).
See [updates](updates.md) for exact routes and failure semantics.

There is still no outbound fleet-management connection or remote fleet trigger.
The API is an authenticated inbound management surface. A future fleet channel
must invoke the same verified deployment policy and cannot bypass signature,
board, capacity, retained-fallback or reboot checks.

## 5. Security posture

**Exposed today — [implemented].** apid on the LAN is the entire inbound
management surface. `/_ui` and custom UI assets are public static code on that
origin; every appliance operation and datum is protected by the `/api`
credential boundary described in section 1.

**Not exposed today — [implemented], as an absence the build asserts.** No
other inbound management port, no outbound management connection, and **no
operator credential provisioned onto a device**. A signed rootfs is
byte-identical on every unit, so a credential baked into one would be a
fleet-wide shared secret (`rootfs/scripts/pack-assert-shadow-chain.sh`)
— the pack step fails the build over that, and the reasoning binds any future
fleet credential too.

**The invariant a future channel must hold — [not implemented].** Each plane is
an independent credential domain; compromise of one grants nothing in another.
An apid session is not an enrollment credential, an enrollment credential is
not a root shell, and an endpoint holding a fleet's channel credentials must
not thereby hold the keys that authorise an image — the update trust anchor is
already a separate key hierarchy (`pkgs/mos-deploy/README.md`) and stays one.
