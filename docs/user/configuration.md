# Configuration

mos configuration is a single typed settings tree, owned by the management
daemon (`mosd`), stored as JSON documents under `/mos/config/` on the data
partition, and applied by reconcilers that drive the underlying system
services. Every supported way to change the
device converges on one validated write path; nothing edits files behind the
daemon's back. This page covers the model, the channels, what is configurable
today, and — just as important on an immutable system — what is not.

## 1. The model: three layers

The provisioning design (its record is
[../design/provisioning.md](../design/provisioning.md)) structures
configuration as three layers:

1. **Layer 1 — first-boot self-provisioning.** From empty STATE the device
   seeds identity, hostname, secrets and defaults, offline, exactly once.
   Shipped; described in [first-run.md](first-run.md).
2. **Layer 2 — local configuration channels.** The ways an operator changes
   settings. Today exactly one is implemented: the authenticated HTTPS API
   (with the built-in UI as its client). The designed offline channels
   (boot-medium provisioning file, signed USB drop, captive portal, HDMI
   wizard, serial wizard) are ordered intent, not code.
3. **Layer 3 — build-time embedded configuration.** Does not exist,
   deliberately: no mechanism bakes fleet configuration or credentials into an
   image, and the build asserts the credential half of that.

> status: shipped — evidence: `docs/design/provisioning.md`, `pkgs/mosd/mosd/`

## 2. The channel that exists: the API and the built-in UI

All configuration reads and writes go over HTTPS to apid — through the
built-in UI at `/_ui/` or the JSON API under `/api/v1` (contract:
`pkgs/mosd/apid/openapi.json`, see [api.md](api.md)). apid holds no state of
its own; it forwards to mosd over the local system bus, where the write is
validated against the typed schema. A rejected write leaves the tree
untouched, and a settings write returns a task you can observe until the
matching reconciler has applied it.

**Where settings are stored, and what that means for resets.** System
configuration — hostname, network, WiFi, SSH, MQTT, time, the container
switch and the update settings — is written as one JSON document per subsystem
under `/mos/config/` on the data partition. What the device mints or observes
about *itself* stays on STATE: the device identity, the administrator
credential, API tokens. Both survive a reboot and an A/B update, because an
update writes only the system slots.

The split is the reset boundary rather than a storage detail: **a
configuration reset returns everything under `/mos/config/` to the values the
image was built with** and keeps the administrator credential, which is why
that tier is a settings action and not a lockout. Read
[recovery.md](recovery.md) Step 3 before running one — the update server
address goes back too, and where the image names no server that leaves the
device with none.

> status: shipped — evidence: `pkgs/mosd/apid/openapi.json`, `docs/design/mosd.md`

## 3. What is configurable today

The settings tree currently models, per subtree:

- **hostname**;
- **network** — wired interfaces by name, each with a declared kind:
  physical, `vlan`, `bridge` or `wireguard`, rendered into systemd-networkd
  units. A WireGuard tunnel's private key is generated on the device and never
  enters the settings tree; rotation is an explicit API action;
- **wifi.client** and **wifi.ap** — WiFi station and access-point roles,
  driving wpa_supplicant and hostapd (the AP exists for provisioning and
  product use; radios are a board fact);
- **access.ssh** — SSH enablement, port, listen addresses, authorized keys,
  and the policy around the transient root password
  (see [security.md](security.md));
- **container.enabled** — the single switch gating the container runtime
  ([applications.md](applications.md));
- **mqtt** — the local MQTT broker and application-data bridge
  ([applications.md](applications.md));
- **time** — the time source and synchronisation policy (section 5.1);
- **power actions and update actions** — not settings, but reachable over the
  same authenticated surface.

**Update settings are not in this tree.** The update mode, channel, server
address, maintenance windows and network mode live in their own document,
`/mos/config/updates.json`, beside the ones above rather than inside the
settings schema. They have their own route —
`POST /api/v1/update/config`, which takes only the keys you are changing —
and the built-in UI's automatic-updates panel drives it.
[update-rollback.md](update-rollback.md) is what each one does.

The authoritative list is the API contract, not this prose: what
`pkgs/mosd/apid/openapi.json` accepts is what the device supports.

> status: shipped — evidence: `pkgs/mosd/apid/openapi.json`, `pkgs/mosd/mosd-settings/`

WiFi presence is board-dependent: the cx3576 carries WiFi and Bluetooth; the
x64 QEMU baseline has no radio.

> status: board-dependent — evidence: `boards/cx3576/board.env`

## 4. An unmodelled setting is an unsupported setting

The root filesystem is a verity-protected read-only squashfs. There is no
`/etc` overlay and there will not be one: an edit under `/etc` either fails
outright or lands in memory and vanishes on reboot. Anything that must persist
must be modelled in the settings tree and exposed by the API — if the API
cannot set it, the appliance does not support persisting it. The deliberate
exceptions (paths bound onto STATE or DATA, such as `/etc/ssh` or the Quadlet
directory) are enumerated in the design record, and integrator files, scripts
and data belong on DATA ([storage.md](storage.md)).

> status: shipped — evidence: `docs/design/access.md`, `docs/design/ro-root.md`

## 5. Deliberate limits, and what is still missing

### 5.1 Time

Network time is not a gap any more, but two things about it are deliberate
limits rather than omissions.

`systemd-timesyncd` is installed and statically enabled, so it always runs:
**there is no enable, disable or pause control** — not in the settings tree,
not in the API, not in the UI. Two settings exist and only two,
`time.ntp.servers` (a validated list; empty means the image's fallback pool)
and `time.timezone`. `GET /api/v1/time/status` reports whether the kernel
bounds the clock's error (`synchronized`) or a server is merely answering
(`polling`), which server that is, and whether the last correction was a step
or a slew.

**The machine's time is UTC, always, and the timezone is presentation only.**
`time.timezone` is never applied to `/etc/localtime` — the image bakes no zone
and the build refuses one — because that symlink is read by every consumer of
UTC, journald included. The zone is published as a runtime value the UI
formats with, and nothing else.

Below network time sits a clock floor, so a device with no RTC or a dead RTC
battery still boots no earlier than the last minute it was known to be
running: the saved clock lives on STATE and survives reboots and A/B updates.
PTP, NTS and configurable polling periods are out of scope.

**Unproven on hardware:** the cx3576's device tree declares an RTC, and
neither its driver nor its backup power has been validated on a bench board.
Nothing on this page depends on the RTC being there — that is what the saved
floor is for — but a device that keeps time across a long power-off has not
been demonstrated.

> status: shipped — evidence: `docs/design/time.md`, `pkgs/mosd/mosd/src/time_status.rs`

> status: board-dependent — evidence: `boards/cx3576/bsp/kernel/dts/rk3576-cx3576z.dts`

### 5.2 Offline provisioning channels and factory injection

A versioned, validated provisioning document now exists and is applied from a
medium before anything is listening on the network: one TOML file at a fixed
name, whole-document validation, applied once and recorded, over two offline
transports ([first-run.md](first-run.md)). It is the repeatable path for
configuring a device that has never had a network.

> status: shipped — evidence: `docs/design/provisioning.md`, `pkgs/mosd/mosd/src/provisioning_doc.rs`

Two of the five channels the design lists still do not exist: the AP captive
portal has its transport and not the portal, and the serial wizard was never
built. Neither has factory injection — versioned inputs, verification at
injection and a per-device record are described in
[manufacturing.md](manufacturing.md) and have no tooling. Beyond the
provisioning document, configuration is individual API writes over an existing
network.

> status: unsupported
