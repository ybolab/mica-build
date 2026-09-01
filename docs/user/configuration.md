# Configuration

mos configuration is a single typed settings tree, owned by the management
daemon (`mosd`), persisted on the STATE partition, and applied by reconcilers
that drive the underlying system services. Every supported way to change the
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
built-in UI at `/ui` or the JSON API under `/api/v1` (contract:
`pkgs/mosd/apid/openapi.json`, see [api.md](api.md)). apid holds no state of
its own; it forwards to mosd over the local system bus, where the write is
validated against the typed schema. A rejected write leaves the tree
untouched, and a settings write returns a task you can observe until the
matching reconciler has applied it.

Settings persist on STATE, so they survive both a reboot and an A/B update.

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
- **power actions and update actions** — not settings, but reachable over the
  same authenticated surface.

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

## 5. Known gaps

### 5.1 Time

There is no supported runtime configuration of NTP servers or timezone today,
and no enabled network-time service in the rootfs. The plan adds
`systemd-timesyncd` always-on, typed `time.ntp.servers` and `time.timezone`
settings, and synchronization status over the API.

> status: proposed — evidence: `docs/plan/PLAN-044.md`

TODO(PLAN-044): revisit after this plan merges

### 5.2 Offline provisioning channels and repeatable provisioning

The offline configuration channels and factory injection of section 1, and a
versioned, validated provisioning document that can be applied idempotently
across devices, are planned under the install/onboarding plan. Today
configuration is applied through individual API writes over an existing
network.

> status: proposed — evidence: `docs/plan/PLAN-046.md`

TODO(PLAN-046): revisit after this plan merges
