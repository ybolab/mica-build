# PLAN-008 Unified connectivity service (connd) - WiFi STA/AP, Bluetooth, CAN

- **status**: draft
- **createdAt**: 2026-08-17 00:00
- **approvedAt**: -
- **completedAt**: -
- **relatedTask**: (to be created on approval)

## Context

The appliance targets embedded boards with interfaces Talos's network subsystem does not
manage: WiFi station mode, WiFi access-point mode (field provisioning), Bluetooth, and CAN
bus. The CX3576-Z board (see the board repo at /srv/ai/board) ships AP6275S/AIC8800 WiFi,
Bluetooth, and CAN transceivers; its Alpine demo configures them imperatively
(wpa_supplicant conf + OpenRC local.d scripts + can-utils), which is exactly the
configuration-drift model this project exists to eliminate.

Upstream Talos network controllers (COSI: LinkSpec/AddressSpec/RouteSpec/...) own
ethernet, VLAN, bond, and WireGuard, and must stay the owner — this plan adds the missing
interface classes without duplicating or forking that subsystem.

Decision (user directive): these interfaces are managed by ONE unified network service,
not by per-daemon ad-hoc services.

## Proposal

### Part A: Architecture — unify at the model layer, execute in one service

```text
machine config (multi-doc)                       webd "Connectivity" pane
  WifiConfig / AccessPointConfig                        |  (read status, write config
  BluetoothConfig / CANConfig                           v   via machined API)
        |                                    COSI status resources
        v                                    (WifiStatus, APStatus,
  config controllers (machined)               BluetoothStatus, CANStatus)
        v                                              ^
  COSI spec resources  ------------------->  connd  ---+
                                             (single machined-supervised Go service)
                                               ├─ wpa_supplicant (child, WiFi STA)
                                               ├─ hostapd + DHCP (child, AP mode)
                                               ├─ bluetoothd (child, BT; phase 2)
                                               └─ CAN via netlink (no daemon)
```

- **One service (`connd`)** owns every non-ethernet interface: it watches the spec
  resources, renders daemon configs, supervises the C daemons as child processes,
  configures CAN links directly via netlink (SocketCAN needs no daemon), and publishes
  status resources. machined supervises connd exactly like webd (system service, health
  check, restart policy).
- **Ethernet is out of scope for connd** — upstream controllers keep it. connd refuses to
  touch eth*/bond*/wg* links.
- webd gets a single Connectivity pane backed entirely by COSI status resources; no
  daemon-specific protocols leak above connd.

### Part B: Configuration documents

New documents in the network family (multi-doc, one per interface concern):

```yaml
apiVersion: v1alpha1
kind: WifiConfig
interface: wlan0
country: CN
networks:
  - ssid: "site-ap"
    psk: "${secret}"        # secret handling per existing config secret conventions
    priority: 10
---
apiVersion: v1alpha1
kind: AccessPointConfig
interface: wlan0
mode: provisioning          # provisioning | always | off
ssid: "appliance-${serial}"
psk: "${provisioning-pin}"  # defaults to the device provisioning PIN scheme
channel: auto
dhcp: { range: "10.42.0.10-10.42.0.100", lease: 1h }
---
apiVersion: v1alpha1
kind: BluetoothConfig
enabled: false              # phase 2: BLE GATT provisioning service
name: "appliance-${serial}"
---
apiVersion: v1alpha1
kind: CANConfig
interface: can0
bitrate: 500000
fd: false
restartMs: 100
```

Validation lives with the documents; STA and AP on the same radio are mutually arbitrated
by connd (see Part D).

### Part C: Packaging — C daemons via system extension

wpa_supplicant, hostapd, and (phase 2) bluez are C userland. They ship as a
`connectivity` system extension included per board profile, NOT in the base rootfs:

- boards without wireless skip the extension entirely (zero size/attack-surface cost);
- connd itself is Go, part of the machined multi-call binary (tiny), and degrades
  gracefully: specs referencing daemons whose extension is absent produce a clear
  status error, not a crash;
- CAN support is pure netlink in connd — always available, no extension needed.

### Part D: Provisioning flow (the "no network on site" path)

State machine owned by connd, integrating the provisioning paths already designed in the
access-layer plan:

1. Normal: WifiConfig present and a network connects -> STA mode, APStatus=off.
2. Provisioning trigger: no usable uplink (no eth carrier + no configured/connectable
   WiFi) for a hold-down period, and AccessPointConfig.mode=provisioning -> start AP +
   DHCP; webd serves the setup UI (captive-portal style) on the AP address.
3. Exit: uplink restored or operator completes setup -> AP stops after grace period.
4. `mode: always` keeps AP up regardless (dedicated-AP deployments); `off` disables.
5. Phase 2: BLE GATT provisioning as an alternative channel (BluetoothConfig.enabled),
   sharing the same target: writing network config documents via machined API.

Auth note: AP PSK defaults to the per-device provisioning PIN (access-layer plan), never a
fleet-wide constant; the demo's hardcoded WiFi credentials in the board repo are
explicitly not a pattern to carry forward.

### Part E: Boundaries

| Concern | Owner |
|---|---|
| eth/vlan/bond/wireguard | upstream Talos network controllers (untouched) |
| WiFi STA/AP, BT, CAN | connd (this plan) |
| Setup/config UI | webd, via COSI resources + machined API only |
| wpa_supplicant/hostapd/bluez binaries | `connectivity` system extension per board profile |
| WiFi/BT firmware blobs | board repo -> injected into rootfs firmware dir by image build |
| provisioning PIN/auth | access-layer plan (DebugAccessConfig family) |

### Part F: Code touchpoints

| Path | Action |
|---|---|
| `pkg/machinery/config/types/network/` | New documents: WifiConfig, AccessPointConfig, BluetoothConfig, CANConfig |
| `pkg/machinery/resources/network/` | New spec + status resource types |
| `internal/app/machined/pkg/controllers/network/` | Config->spec controllers for the new documents |
| `internal/app/connd/` + `internal/pkg/connd/` | The service: daemon supervision, config rendering, netlink CAN, provisioning state machine |
| `internal/app/machined/pkg/system/services/connd.go` | Service registration (mirrors webd.go) |
| `internal/app/machined/main.go` | Multi-call dispatch entry |
| extensions (board repo or hack/extensions) | `connectivity` extension: wpa_supplicant + hostapd (+ bluez phase 2) |
| `internal/pkg/webd/` | Connectivity pane (status + config editing) |

## Phasing

- **Phase 1**: WifiConfig (STA) + CANConfig + connd skeleton + status resources.
- **Phase 2**: AccessPointConfig + provisioning state machine + webd captive setup flow.
- **Phase 3**: BluetoothConfig + BLE GATT provisioning.

Implementation is its own campaign after the board bring-up campaign (needs real WiFi/CAN
hardware for acceptance); webd pane work coordinates with the access-layer campaign.

## Acceptance criteria (campaign-level)

1. Declarative round-trip: applying each config document converges the interface and is
   reflected in its status resource; removing the document tears it down.
2. Provisioning: with no uplink, the device raises the AP and webd setup is reachable;
   completing setup joins the configured WiFi and drops the AP.
3. CAN: can0 up with configured bitrate after boot, survives machined restart.
4. Base rootfs without the connectivity extension: specs error cleanly, nothing crashes.
5. All daemon processes are children of connd, restarted on failure, logs in syslogd.
6. No fleet-wide default credentials anywhere in the shipped image.

## Risks

- wpa_supplicant/hostapd version + driver quirks (bcmdhd vendor driver vs nl80211) must be
  validated on CX3576-Z early — the AP6275S path may constrain hostapd options.
- Single-radio STA/AP arbitration is the trickiest state; keep it in connd (one owner),
  never split across controllers.
- BLE provisioning (phase 3) has real security surface; do not enable by default.
