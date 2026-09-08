# Design: connd — WiFi station and access point on the systemd/mosd base

> WiFi station and access point on the systemd/mosd base. Companion to
> mosd.md, access.md and provisioning.md.

## 1. What ships

**There is no `connd` process.** The name is retained for the *concern*, not
for a process, and nothing in the image is called connd.

The concern is carried by:

- **two mosd reconcilers**, `wifi_client.rs` and `wifi_ap.rs`, driven from the
  mosd settings subtrees `wifi.client` and `wifi.ap` (schema v3);
- **systemd**, which owns the unit lifecycles — mosd never supervises a daemon
  as a child process, it only drives units over the system bus;
- **`wpasupplicant` and `hostapd`** from the base rootfs package allowlist,
  not from a separate system extension;
- **systemd-networkd's built-in `DHCPServer=yes`** beside hostapd, so the AP
  needs no dnsmasq and no separate DHCP daemon;
- **mosd's live-state tree**, served over D-Bus to apid, as the only status
  surface.

The model those parts implement: a declarative list of known networks with
priorities, an AP with `off` / `provisioning` / `always` modes, one owner for
the single-radio question, and the rule that **no fleet-wide credential may
exist**.

**CAN and Bluetooth are not mosd's.** They stay with the board hwinit units
(`hwinit-can`, `hwinit-bt`), which are already read-only-root safe and already
work; folding them into mosd would rewrite something that is not broken for no
benefit. The boundary is therefore: `wifi.client` / `wifi.ap` are mosd's, CAN
and BT are the board layer's.

## 2. Settings model

Both subtrees live in the mosd settings tree (`docs/design/mosd.md` §3) and are
persisted since PLAN-070 §5.2 in `/mos/config/wifi.json` on DATA, at that
document's own schema version (`docs/design/mosd.md` §5.1a). Both Wi-Fi
reconcilers share the one document, because `wifiAp` declares the whole `wifi`
subtree. The document is `0600` inside a `0700` directory: it carries the site's
WPA2 pre-shared key, and the namespace's charter is that it is credential
material.

```toml
[wifi.client]
enabled = false
interface = "wlan0"
networks = []          # each: { ssid, psk?, hidden, priority }

[wifi.ap]
mode = "off"           # off | provisioning | always
interface = "wlan0"
channel = 6
countryCode = "US"
address = "192.168.4.1/24"
holdDownSeconds = 120
graceSeconds = 60
# ssid and psk are optional and absent by default
```

Three model decisions are load-bearing:

- **No secret has a non-`None` default.** `wifi.ap.ssid`, `wifi.ap.psk` and
  each network's `psk` are `Option`, serialized with
  `skip_serializing_if = "Option::is_none"`. The rootfs is byte-identical
  across the fleet and covered by the FIT signature, so any default value here
  would be a fleet-wide shared secret shipped inside the image. Absent means
  "derive it from the device identity and the per-device credential at render
  time". A unit test asserts the serialized default document contains neither
  `psk` nor `passwordHash` anywhere, so a future "helpful default" fails the
  build.
- **`wifi.client.networks` is a whole-array write.** mosd's dot-path API
  addresses map segments only; there is no `wifi.client.networks.0.psk`.
  Callers read and write the whole array as one JSON value. This is kept on
  purpose: index segments would add read-modify-write races between two writers
  on one array, and a second addressing syntax for the UI to learn, for a list
  that is edited as a unit anyway.
- **The AP subnet is `192.168.4.0/24`, not the `10.42.0.0/24`.**
  192.168.4.0/24 is the conventional embedded-AP block and is far less likely
  to collide with an operator's management network than 10.42.0.0/24, which
  systemd-networkd already uses for its own ranges. It is a setting, so a
  deployment that needs the other block sets it.

## 3. The station reconciler (`wifi.client`)

Three system effects, applied in this order:

1. `/etc/wpa_supplicant/wpa_supplicant-<interface>.conf` rendered from
   `wifi.client`, mode 0600. That exact path is a **contract with the unit**:
   Debian's `wpa_supplicant@.service` has `-c/etc/wpa_supplicant/wpa_supplicant-%I.conf`
   baked into its `ExecStart`. Changing either side breaks the other.
2. A networkd `.network` unit for the interface with `DHCP=yes`. Association
   without addressing is a link that reports carrier and moves no traffic, so
   addressing is part of this reconciler rather than left to be noticed on
   hardware.
3. `wpa_supplicant@<interface>.service` brought to the state
   `wifi.client.enabled` asks for.

Configuration before unit, deliberately: a supplicant started against a stale
or absent file associates with the previous network, or with none.

Rendering rules: networks are ordered by `priority` highest-first **and** every
block states its own `priority=` (order alone would let wpa_supplicant select
by its own default of 0; the directive alone would make the file read in an
order it does not behave in). `psk` absent means an open network and emits
`key_mgmt=NONE` with no `psk=` line; `hidden` is the only thing that emits
`scan_ssid=1`; `update_config=0` is stated rather than defaulted, so a
`wpa_cli save_config` cannot rewrite mosd's render.

**SSID and key encoding is an injection boundary.** An SSID is operator-supplied
text landing inside a `network={…}` block, where a newline would close the block
and let the remainder be read as directives. An SSID that is printable ASCII
with no `"` and no `\` is emitted quoted; **anything else is emitted in
wpa_supplicant's unquoted hex form**, whose alphabet is `0-9a-f` — injection is
not merely escaped there, it is not expressible. A 64-character hex key is a raw
PMK and is emitted unquoted; quoting it would make wpa_supplicant read a
64-character passphrase, exceed the 63-character maximum, and reject the
**whole file**, taking every other network down with it.

### `enabled: true` with no networks — decided, not incidental

A UI produces this state in one click, so it is defined: the configuration is
still rendered (header only), the supplicant is **kept down**, and the live
state reports `station: "idle"`, deliberately distinct from `"disabled"`.

The reason is a real conflict, not tidiness: a running wpa_supplicant **claims
the radio** — it puts the interface into managed mode and holds it. A radio
claimed by a station role that can never associate is a radio the access-point
role cannot use, and the AP is exactly what a device with no configured network
needs in order to be given one.

## 4. The access-point reconciler (`wifi.ap`)

The same three effects, same order:

1. `/etc/hostapd/<interface>.conf`, mode 0600 — again the path Debian's
   `hostapd@.service` template reads (`… /etc/hostapd/%i.conf`).
2. A networkd `.network` unit carrying the AP-side address and
   `DHCPServer=yes`, with `PoolOffset` / `PoolSize` **derived from
   `wifi.ap.address`** rather than configured beside it. One source of truth:
   networkd accepts a pool outside the subnet without complaint and simply
   hands out addresses no client can use, which looks like a working AP with
   broken clients.
3. `hostapd@<interface>.service`.

**systemd-networkd's DHCP server, not dnsmasq.** No extra package in the signed
rootfs, and the server's lifecycle is the same networkd reload the address
already needs. The absence of dnsmasq is asserted by both image verifiers.

The AP is **WPA2-PSK and can never be open** — `wpa=2` + `wpa_key_mgmt=WPA-PSK`
+ `rsn_pairwise=CCMP`, asserted as a set. The settings model cannot express an
open AP, because this AP carries the path to a device's configuration.
`ieee80211d=1` is what makes `country_code` more than a comment; without it
hostapd carries the code and never advertises the regulatory domain.

**hostapd's escaping rules are not wpa_supplicant's, and this was checked rather
than assumed.** hostapd's `ssid=` takes the bytes after the `=` literally to end
of line: there is no quoting to escape into, a `"` is an ordinary character, and
a newline simply starts the next directive. Reusing the station's quoted form
would have emitted a literal pair of quotes as part of the SSID — a working AP
with the wrong name, which no "is the SSID in the file" check would catch. What
hostapd offers instead is `ssid2=`, which takes a hexdump. So the discipline is
the station's, spelled hostapd's way: raw when representable, `ssid2=<hex>`
otherwise, and the key moves with the encoding because the two are not
interchangeable spellings of one directive.

**Where the SSID and key come from.** `wifi.ap.ssid` when set, else derived from
`provisioning.deviceId` as `mos-<first 8 hex>` — the same shape the derived
hostname uses, so a device advertising `mos-1a2b3c4d` is recognisably the device
called `mos-1a2b3c4d`. The key is `wifi.ap.psk` when set, else
`/var/lib/mos/secrets/ap-psk`, the per-device secret minted at first boot. There
is deliberately **no constant fallback**: a device with no key in either place
refuses to raise the AP and says why. See §7.

`mode: off` renders no configuration at all, unlike the station reconciler. The
AP's key comes from STATE, so on an unprovisioned device there is nothing to
render — and `off` is the *default*, so rendering unconditionally would make the
default tree fail on every reconcile.

## 5. The single-radio conflict — reported as shipped, not arbitrated

STA and AP cannot both own one radio. Two reconcilers each starting and stopping
units on the same interface would flap forever, each undoing the other every
cycle, and the device would be neither.

> **When `wifi.ap.mode != off` and `wifi.client.enabled` is true and both name
> the same interface, the live state reports `accessPoint: "conflict"` and the
> AP reconciler does nothing at all** — no unit call, no configuration write, no
> networkd unit. It returns before any I/O.

In particular it does **not** stop the supplicant. That unit belongs to the
station reconciler, which would start it again on its next pass.

The conflict is decided on `wifi.client.enabled` alone, not on whether the
station has any networks to join: a station the operator switched on owns the
radio as far as configuration is concerned, and reporting that is the point.

**Automatic arbitration is the later phase and is explicitly not
here.** `wifi.ap.holdDownSeconds` and `wifi.ap.graceSeconds` are in the schema
and are **consumed by nothing** — that is deliberate, not an oversight. Raising
the AP on loss of carrier after a hold-down, and dropping it a grace period
after the uplink returns, needs a carrier watcher and a state machine that
outlive a single `apply`. Until that lands, **`mode: provisioning` behaves
exactly like `always`**; the mode is recorded in live state so a UI can tell
them apart, and a test pins that this is the decided behaviour.

So of the state machine, step 4 (`always` / `off`) shipped and
steps 1–3 (the automatic trigger and exit) did not.

## 6. The networkd naming constraint — read this before writing another reconciler

`pkgs/mosd/mosd/src/reconciler/network.rs` **deletes every `*-mos-*.network` file it
did not itself render.** A WiFi unit named `50-mos-wlan0.network` is therefore
swept away on the network reconciler's next pass: the component is present,
every unit test is green, and WiFi has no address on device. This bit an L3
during M5 and cost real time; a future reconciler author must not rediscover it.

Reconciler-rendered networkd units therefore use prefixes **outside** that
pattern:

| Renderer | Prefix | Why |
|---|---|---|
| `network.rs` (ethernet, operator-configured) | `50-mos-` | owns the sweep |
| `wifi_client.rs` | `90-wifi-client-` | no `-mos-`, so the sweep misses it |
| `wifi_ap.rs` | `90-wifi-ap-` | same |
| the image's fallback | `80-dhcp.network` | baked at build time |

Two independent properties, and both are required:

- the prefix does **not** contain `-mos-`, so `network.rs` does not match it;
- `90-` sorts after `50-mos-…` and after `80-dhcp.network`, and networkd applies
  the first matching unit in lexical order — so an interface the operator
  configured explicitly under `network.<iface>` keeps winning over a
  reconciler's implicit default, whatever the interface is called.

Each WiFi reconciler sweeps **its own** namespace (`90-wifi-client-*`,
`90-wifi-ap-*`) so an interface rename converges instead of leaving networkd
running DHCP on a link mosd no longer manages.

This is asserted, not documented and hoped for. The tests render the unit and
then run the **real** `NetworkReconciler` over the same directory, asserting the
file survives intact; and both image verifiers enumerate every `.network` file
the image ships and assert none of them falls in a reconciler-owned namespace.

## 7. Credentials

The AP PSK is one of the two per-device secrets minted on the device at first
boot. The full credential model — why the secrets are generated on device, why
there are two of them rather than one, and why there are two hash formats — is
stated once in **`docs/design/provisioning.md` §3** and is not restated here.

What matters for connd specifically:

- the PSK reaches exactly one place, the 0600 configuration file. It is not in
  the live-state tree (which is served over D-Bus to apid), not in any log line
  — the two reconciler modules contain no logging statement at all, checked
  mechanically — and not in any error message, including the one raised when a
  key cannot be rendered.
- the live state publishes `secured: true`, meaning *a key exists*, never what
  it is.
- no secret enters the image. Every key in a rendered file comes from the
  settings tree on STATE or from `/var/lib/mos/secrets/ap-psk`, both born at
  runtime.

## 8. Image integration — Debian's packaging actively fights the reconcilers

This section is the expensive part. The packaging interaction below looks like
nothing in review and costs a day on hardware.

`wpasupplicant` and `hostapd` are in the base rootfs allowlist for both
pipelines. Both packages ship **enabled non-templated units** that compete with
the instances mosd starts:

| Unit | What the package does | Why it is a problem |
|---|---|---|
| `wpa_supplicant.service` | shipped **enabled**, with **no condition gating it** | it *does* start. Worse, it carries `RuntimeDirectory=wpa_supplicant`, so systemd **deletes `/run/wpa_supplicant` when it stops** — taking the control socket of the templated instance mosd started with it |
| `hostapd.service` | shipped **enabled** | inert *today* only because its `ConditionFileNotEmpty=/etc/hostapd/hostapd.conf` is unsatisfied. That is one operator `cp` away from a second hostapd on the same radio while mosd's instance reports healthy |
| `dbus-fi.w1.wpa_supplicant1.service` | the package's `Alias=` link | a second name for the same unit |

**All three are MASKED, not disabled.** The distinction is the point:
`wpasupplicant` ships `/usr/share/dbus-1/system-services/fi.w1.wpa_supplicant1.service`,
a D-Bus activation file. A plain `systemctl disable` leaves that activation path
open and the unit can still be started by anything that talks to the bus name.
Masking closes it.

The templates mosd *does* drive (`wpa_supplicant@.service`, `hostapd@.service`)
must **not** be statically enabled in the image: mosd owns those lifecycles and
would race the image's own instance. Both verifiers assert this in both
directions — the masks are present, the package's `*.wants` symlinks are gone,
and neither template is statically enabled.

The rest of the image contract:

| Requirement | Value |
|---|---|
| Binaries | `/usr/sbin/wpa_supplicant`, `/usr/sbin/hostapd` |
| Unit templates | `wpa_supplicant@.service`, `hostapd@.service` — Debian's own, ExecStart config paths cross-checked against the reconciler constants |
| Config dirs | `/etc/wpa_supplicant` and `/etc/hostapd`, STATE-backed binds via `etc-wpa_supplicant.mount` / `etc-hostapd.mount`, mode 0700 |
| Config dirs (v1) | writable ext4 root, mode 0700; v1 has no STATE partition to back them |
| Control socket | `/run/wpa_supplicant`, on tmpfs, created by wpa_supplicant itself |
| networkd dir | `/run/systemd/network` |
| dnsmasq | **absent, and asserted absent** |
| Firmware | the board's WiFi blob must be in the image firmware dir, and the driver must support AP mode, or the interface never appears as one |

The verifiers read every path, prefix and unit name **out of the mosd source
that owns it** rather than restating it. A constant restated in two places can
drift, and this drift is invisible from the code side because mosd's tests all
pass against a mock. Each extraction is checked for emptiness, so a rename in
mosd breaks the verifier loudly instead of turning an assertion into a
comparison against `""`.

## 9. Known limitations, carried forward rather than dropped

- **WPA3-SAE is not expressible**, on either side. `key_mgmt=WPA-PSK` /
  `wpa_key_mgmt=WPA-PSK` is what the model can ask for; SAE needs `key_mgmt=SAE`
  and `ieee80211w`, and `WifiNetwork` has no field for it. A schema change, not
  a renderer change.
- **Passphrase length is not validated** on the station side. wpa_supplicant
  requires 8–63 characters and rejects the *entire file* on a shorter one,
  taking every network down. Validation belongs in `mosd-settings` with the rest
  of the schema. (The AP side *does* validate 8..=63, because hostapd's failure
  there is equally total.)
- **5 GHz is not expressible.** `hw_mode=g` is fixed and the channel is
  validated to 1..=14, because `wifi.ap.channel` is documented as a 2.4 GHz
  channel and the model has no band field.
- **No `ieee80211n`/`ac` and no HT capabilities are emitted**, so the AP runs
  802.11g rates. Adequate for a setup UI on a handful of clients; raising it
  needs per-driver capability knowledge this repo cannot verify.
- **`EmitDNS` / `EmitRouter` are left at networkd's defaults** (both on), so a
  provisioning AP with no uplink advertises itself as a router and resolver it
  cannot be. Whether that helps a captive-portal flow or hurts it is a decision
  for the apid setup-UI task.
- **`ConfigureWithoutCarrier` is not set.** If a driver does not report carrier
  in AP mode, networkd will not configure the address and the DHCP server will
  not start. Per-driver, only hardware can settle it; the fix would be one line.
- **A stale `<old-interface>.conf` and its unit are not swept on an interface
  rename.** The networkd side *is* swept; the daemon side is not, because
  stopping units for interfaces mosd was never told about is a broader claim of
  ownership than these subtrees grant. Blast radius is bounded: unit enablement
  is runtime-scoped, the stale file is inert unless something starts that
  instance, and mosd only ever starts the configured one — so a reboot clears it.
- **`write_atomically` is duplicated three times** — `sshd.rs`, `wifi_client.rs`,
  `wifi_ap.rs`. Each task was forbidden to edit the others' files. Now that all
  the M5 reconcilers have landed, lifting it into a shared helper is worth doing.
- **Regulatory correctness cannot be verified in this repository.**
  `country_code` is validated for *shape* (exactly two ASCII letters — which is
  also what stops it carrying a newline into the file) and passed through.
  Whether the resulting channel and transmit power are legal where a device is
  deployed depends on the regulatory database in the image, the driver, and the
  operator setting the right code.

  Two of those three moved with RFCT-355 and are worth stating exactly, because
  the first is easy to mistake for the whole answer. **The database is now in
  the image**: `mos-wifi` and `mos-wifi-ap` depend on `wireless-regdb`, and the
  image contract asserts `/lib/firmware/regulatory.db` and its `.p7s` at the
  path the firmware loader searches. **That alone would have bought nothing.**
  cfg80211 is built into every board kernel here and these boards carry no
  initramfs, so its own boot-time request runs before the root is mounted —
  measured on cx3576 as 7.668 s against a root at 7.681 s — and
  `net/wireless/reg.c` records that failure in a file-scope pointer no later
  request consults; registering a wiphy does not re-read it. The only path that
  clears it is nl80211's `RELOAD_REGDB`, so `mos-wifi` also ships
  `mos-regdb-reload.service`, a oneshot running `iw reg reload` before
  `network-pre.target`, and the contract asserts the unit, its enablement and
  the presence of the program it runs.

  **The driver is the third element and it is still open.** On the AIC8800D80
  SKU the vendor driver defaults `custregd` to true, sets
  `REGULATORY_WIPHY_SELF_MANAGED` on `phy0` and installs its own table — the
  `CAUTION: USING PERMISSIVE CUSTOM REGULATORY RULES` banner in the boot log is
  that call's success branch. A self-managed wiphy does not take the core
  regulatory domain, so on that SKU `iw reg get` and `iw phy phy0 reg get` can
  disagree and which of them a rendered `country_code` reaches is a hardware
  question. `docs/bsp/cx3576-bench.md`'s `regdb-loaded` probe records both.

## 10. What is NOT claimed

Nothing in M5 has been near a radio. Every test in both reconcilers runs against
a mock `UnitControl`, a mock `NetworkReload` and a tempdir; every image
assertion reads a packed artifact or a source file.

The following are the **user's hardware acceptance** and are not claimed
anywhere in this repository:

- that a station actually associates and gets a DHCP lease;
- that the AP actually beacons, that a client can associate with it, and that
  networkd's DHCP server hands out a usable address;
- that the AP6275S vendor driver supports AP mode at all — a recorded risk
  records this as the known hardware risk and only a radio can settle it;
- that the masked units stay masked and the templated instances come up cleanly
  on a real boot.
