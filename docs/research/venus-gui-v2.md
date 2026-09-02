# Research: Venus OS gui-v2 — a functional reference for benchmarking apid

> **Status and intent.** This is a research note, not a design record: it
> documents someone else's product so that mos can measure its own management
> surface against a shipped, mature appliance UI. It restates no mos design;
> section 14 maps each gui-v2 capability domain to the mos document or open
> task that owns the analogous surface. The earlier Venus OS *compatibility*
> goal was closed in August 2026 and is not being reopened here — nothing in
> this document proposes implementing Venus contracts, bus names, or topics.
>
> **Source basis.** Read from the public sources at
> `github.com/victronenergy/gui-v2`, tag v1.3.17 (2026-08-28), including the
> `veutil` submodule. gui-v2 is the "New UI" shipped since Venus OS 3.50 and
> is the only Venus UI still published as source; gui-v1 is no longer public.
> Following this repository's documentation discipline, files and modules are
> named, lines are not cited. Scale at the read snapshot: ~300 page QML files,
> ~306 component QML files, ~141 data-layer QML files, ~124 C++ sources,
> 21 translation files. Settings-page inventories below were verified against
> the pages' translation-id sets, not inferred from menu captions.
>
> **Granularity.** Every user-visible surface is enumerated to the page level,
> and to the control level where the control carries a decision worth copying
> (refusal texts, mode vocabularies, watchdogs). String-by-string transcription
> is deliberately out of scope — the source is the artifact for that.

## 1. Product context

Venus OS runs on Victron GX energy-monitoring appliances (Cerbo GX, Ekrano
GX, Raspberry Pi builds). gui-v2 is its operator UI: an inverter/battery/solar
dashboard, a device configurator, and a settings tree, presented on an
attached touch screen and, identically, in a browser ("Remote Console").

The product parallel to mos is close: a headless-capable Linux appliance, a
local management daemon, an attached-display kiosk, and a browser surface that
must work without the vendor cloud but gains remote reach with it.

## 2. One codebase, three transports

The same Qt6/QML application ships in three forms, selected at startup
(`src/backendconnection.h`):

| Form | Data transport | Role |
|---|---|---|
| Native Linux (eglfs) | D-Bus (`VeQItemDbusProducer`) | On-device touch screen |
| WebAssembly in a browser | MQTT (`QMqttClient`) to the local broker or the VRM cloud | Remote Console — replaced gui-v1's VNC screen-scraping |
| Mock | In-process simulated producers (`data/mock/`) | Development and sales demo |

Two consequences drive the whole architecture:

- **The UI issues no commands.** Because the identical binary may run in a
  remote browser, every action — reboot, firmware update, even creating a
  settings key — is a *value write* on the data tree, executed on-device by a
  separate `venus-platform` service. `data/VenusPlatform.qml` implements
  "reboot" as writing `true` to `/Device/Reboot`. The UI process needs no
  privileges and no local exec path.
- **One data model, two producers.** All state is a uniform tree of typed
  items (VeQItem, from the `veutil` submodule). Locally the tree mirrors
  D-Bus services; remotely it mirrors MQTT topics (`N/<portalId>/#` for
  notifications, `W/` writes, `R/` read requests, plus keepalive and
  heartbeat topics — `veutil/src/qt/ve_qitems_mqtt.cpp`). QML binds with a
  declarative `VeQuickItem { uid: "..." }` element carrying value, validity,
  min/max, unit, and decimals (`veutil/inc/veutil/qt/ve_quick_item.hpp`).
  No page knows which transport it is on.

`BackendConnection` (singleton) owns the connection state machine
(Idle → Connecting → Connected → Initializing → Ready → Disconnected /
Reconnecting / Failed), a heartbeat state, VRM credentials (username /
password / token / portal id / shard), and the VRM portal mode
(Off / ReadOnly / Full) that globally degrades the UI to read-only.

## 3. Application shell

`Main.qml` and `pages/MainView.qml` compose:

- **Status bar** (`components/StatusBar_Landscape.qml`, `_Portrait`): left
  button toggles the Controls card deck or acts as Back inside a page stack;
  an adjacent button opens the Switches pane; centered title plus live clock;
  right side holds a WiFi button (deep-links to WiFi settings), a GSM signal
  icon, the notification bell (colored by highest active severity), and a
  display-sleep button.
- **Main page carousel**: a `SwipeView` of 4–6 top-level pages with a bottom
  nav bar; overflow pages collapse into a "More" dialog. Pages load only
  after every data source reports ready (`data/DataManager.qml` gates on all
  domain objects plus the plugin loader).
- **Page stack** with breadcrumbs for the settings/device drill-down.
- **Dialog layer** (modal dialogs are their own layer, not per-page) and a
  **toast layer** with severity-typed, auto-expiring notices. The dialog
  inventory (`components/dialogs/`) is ~23 dialogs: number/time/date
  selectors, current limit, ESS minimum SOC, inverter/charger mode, EVCS
  mode, generator start/stop/auto-disable, color wheel, security-profile
  password, VRM-instance swap, unpair, solar daily history, modal warning,
  and a "rebooting" blocker.
- **Idle behavior**: pages can declare `fullScreenWhenIdle`; a configurable
  start page — a fixed page or "auto-select last used view", with a timeout
  in seconds — is restored after inactivity (`data/StartPageConfiguration.qml`);
  the screen blanker and (auto-)brightness are part of the UI process
  (`src/screenblanker.cpp`).
- **Degradation handling**: a listener watches the settings and platform
  services; if one goes offline the shell posts a warning toast and schedules
  a full UI reload for when it returns (`src/systemservicelistener.cpp`).
- **Full keyboard/rotary navigation**: every interactive element participates
  in `KeyNavigation` with a global focus highlight, so devices without touch
  remain operable.
- **Hidden maintenance console**: Alt+F2 opens an embedded terminal
  (`components/ConsoleTerminal.qml`) on device builds.

## 4. Main pages

Composition is dynamic (`components/SwipePageModel.qml`): Brief, Overview,
Notifications and Settings always exist; Levels appears only when tanks or
environment sensors exist; a Boat page appears only when the electric-
propulsion setting enables it.

### 4.1 Brief

The glanceable landing page. Center: a multi-ring circular gauge — state of
charge inside, configurable power-flow rings around it (which rings appear is
itself a settings page, "Brief view start page"). Side panel
(`pages/BriefSidePanel.qml`): one compact widget per source/sink actually
present — solar yield, generator (titled with the generator's own name), the
non-generator AC input (titled grid/shore/mains per its configured source
type), DC input(s), AC loads, DC loads — each with live power and an
expandable history graph. The page watches its own CPU cost and closes the
graphs with a toast when system load crosses a threshold (`src/cpuinfo.cpp`)
— the UI is explicitly a guest on a busy appliance.

### 4.2 Overview

A live energy-flow diagram. A layout engine composes three columns from 19
widget types (`src/enums.h`): left — AC input 1/2 (grid, shore, generator),
solar, alternator, DC generator, fuel cell, generic DC source, AC charger,
DC charger, water/shaft/wind generators; center — inverter/charger, battery;
right — AC loads, essential loads, DC loads, EV charger. Widgets are sized by
how many are present, connected by animated paths showing instantaneous
power direction, and each opens its device page on tap. Portrait builds swap
in a scrolling vertical variant of the same widgets.

### 4.3 Levels

Two tabs. Tanks: one bar gauge per tank (fuel, fresh/gray/black water, oil,
LPG — color per fluid type), grouping duplicate senders, expandable detail
(`src/aggregatetankmodel.cpp`). Environment: temperature / humidity /
pressure gauges per sensor.

### 4.4 Notifications

Active and historical alerts in one list, three severities (alarm / warning
/ info), tap-to-acknowledge per row, a bulk "silence" button while
unacknowledged alarms/warnings exist, automatic acknowledgment of info-level
items, and status-bar/nav-bar badge integration (`data/Notifications.qml`,
`src/notificationmodel.cpp`).

### 4.5 Boat (optional)

A domain dashboard for electric propulsion (`pages/boat/`): central motor
gauge (power/RPM), battery arc with percentage and time-to-go, range,
gear indicator, shore-power arc, consumption gauge, GPS speed, multiple
motors, multiple temperature gauges.

### 4.6 Settings

Section 6.

## 5. Quick controls

Two card decks slide over the current page from the status bar, so routine
actions never require entering the settings tree.

**Control cards** (`pages/controlcards/`), one per controllable subsystem:

- **ESS card**: current ESS state read from the BatteryLife state machine,
  minimum-SOC spin dialog, and an "active SOC limit" readout that explains
  (via toast) when the operating limit differs from the configured one.
- **Inverter/charger card**: titles itself "Inverter" or "Inverter/charger"
  per capability; mode button (On / Off / Charger-only / Inverter-only via
  `InverterChargerModeDialog`); AC input current-limit dialog; shows the ESS
  minimum SOC when ESS is present.
- **Generator card**: autostart toggle with a link to the start/stop
  conditions page; manual start dialog (run duration), stop dialog, and a
  "disable autostart" confirmation dialog.
- **EVCS card**: charge-mode dialog (manual / auto / scheduled), charge
  current spinner, enable-charging switch.

**Switches pane** (`pages/AuxCardsPage.qml`): user-facing switchable outputs
grouped into cards. Four output types — momentary, toggle, dimmable,
temperature setpoint (`src/switchableoutput.cpp`) — with sliders, spin
buttons and an RGB color-wheel dialog; channels are renamable, groupable,
and individually hideable from settings (`components/listitems/
ListIOChannel*.qml`).

## 6. Settings tree

Eight top-level branches (`pages/SettingsPage.qml`), ~130 pages under
`pages/settings/`. The shape worth copying is the discipline: every row is a
`VeQuickItem`-bound list item from a small shared vocabulary (switch,
spinbox, radio-button page, nav row, quantity group — `components/
listitems/`), so a new settings page is data description, not new UI code.
Inventories below are per-page, verified from source.

### 6.1 General

- **System**: device identity, serial, VRM portal id.
- **Firmware** (`PageSettingsFirmware*`): three sub-surfaces —
  *Online updates*: update feed selection (official / beta / testing /
  develop), auto-update policy (off / check only / check and download /
  check and update), manual check, install with progress and build
  timestamps. *Install from SD/USB*: scans removable media for images,
  shows what it found, installs offline. *Stored backup firmware*
  (`PageSettingsRootfsSelect`): shows current and backup rootfs versions
  and a "boot to version" action; refuses with named reasons when switching
  is impossible (no backup present, indeterminate security profile).
- **Access & security** (`PageSettingsAccessAndSecurity`): access level
  (User / User & Installer with password challenge / Superuser / Service —
  the latter two read-only in the picker), local-network security profile
  (Secured / Weak / Unsecured, one three-position choice with captions,
  password dialog on change, page-reload warning).
- **Preferences**, **Display & appearance**
  (`PageSettingsDisplayAndAppearance`): brightness, adaptive brightness,
  display-off timeout (10 s – 30 min / never), dark/light scheme, a
  *separate* Remote Console appearance policy (follow GX display / follow
  browser theme / forced, with "forced by VRM / by app" explanations),
  start-page configuration, Brief-page ring configuration, boat-page enable,
  units (metric/imperial etc.), min/max display toggle, UI-animations
  toggle, and the per-surface classic-UI/new-UI switch (on-screen and Remote
  Console selected independently).
- **Alarms & feedback**: audible alarm toggle, status LEDs toggle.
- **Language**: 21 locales including zh_CN; runtime switch with progress
  and success/failure feedback; per-locale font loading.
- **Date & time**: time zone tree (`tz/`), NTP vs manual.
- **Documentation**: manual links rendered as QR codes for a phone
  (`components/listitems/ListLink.qml`, embedded QZXing).
- **Support status**: a supportability self-report — detects a modified
  rootfs, counts running third-party integrations by name (Modbus TCP
  server, Signal K, Node-RED), flags unsupported devices, and states
  "clean" otherwise.
- **Demo mode**: scenario presets (ESS demo, boat/motorhome demos) with an
  explanatory caption; demo data ships in the production binary.

### 6.2 Connectivity

- **Ethernet** (`PageSettingsTcpIp`): DHCP/static, DNS, link watched live
  ("connection lost", "cable unplugged").
- **WiFi** (`PageSettingsWifi`): scanned network list, hidden-SSID join,
  password update feedback, *access-point mode* (create AP, AP password,
  disable-AP confirmation) and a gateway-mode disable with an
  are-you-sure step.
- **Bluetooth**: enable, explicitly framed as "for the VictronConnect app";
  reports adapter absence.
- **Mobile network** (`PageSettingsGsm`): modem status, APN/PIN; reports
  "no cellular modem connected".
- **VE.Can / CAN-bus** (`PageSettingsCanbus`, `CanbusProfile`,
  `PageCanbusStatus`): per-port profile selection, live bus status, device
  finder, CAN-over-TCP debug toggle.
- **Modbus TCP** client/server surfaces (also reachable from Integrations).

### 6.3 VRM (cloud logger, `PageSettingsLogger`)

Connection status with per-channel diagnostics (HTTP, HTTPS, realtime/MQTT,
RPC channels; named error codes 150–157), last-contact timestamp, log
interval (1 min – 1 day), HTTPS toggle, traffic counter, and a
*no-contact reboot watchdog* — reboot the GX if the portal has been
unreachable for a configured time. Per-device VRM instance management
(`PageVrmDeviceInstances`) with a conflict-swap dialog.

### 6.4 Integrations

Grouped as: **physical IO** — relays (per-relay function: alarm relay /
generator start-stop with helper relay / tank pump / manual / temperature
rules; polarity normally-open/closed; the page tells you where the control
moved when a function claims the relay), digital inputs; **device
integrations** — energy meters, PV inverters (Fronius/SolarEdge etc.:
discovery, per-inverter setup, IP list management), tank & temperature
sensors, Bluetooth sensors (Ruuvi), Shelly devices, MQTT devices, EEBUS
devices, Modbus devices (discovery, add, per-device pages), Modbus TCP
server; **server applications** — the "Venus OS Large" feature set with an
enable switch and safe mode: Node-RED, Signal K, with documentation links
and community pointer; **UI plugins** — installed plugin list, each able to
integrate with the device list (section 13).

### 6.5 System setup

- **System name**: auto, or a named preset (boat / vehicle), or
  user-defined text.
- **AC system** (`PageSettingsAcSystem`): AC input 1/2 source types
  (grid / shore / generator), input priority.
- **Inputs and monitoring** (`PageSettingsBatteryMeasurements`): which
  battery services are visible and which is the system's battery monitor;
  "has DC system" toggle.
- **Batteries & BMS** (`PageSettingsBatteries`): battery list, per-battery
  settings.
- **Charge control / DVCC** (`PageSettingsDvcc`): DVCC master switch with
  auto-selection by battery type ("auto-selected: …/none"), the controlling
  BMS choice, managed-battery charge-voltage limit, maximum charge voltage,
  shared voltage sense / shared temperature sense (with used-sensor picker)
  / shared current sense — each with named unavailability reasons (external
  control, no battery monitor, no chargers), charge-current limits page,
  and an MK3/USB control toggle with caption.
- **ESS / Hub-4** (`PageSettingsHub4`): mode (self-consumption with
  BatteryLife, without BatteryLife, keep-charged, external control);
  BatteryLife state readout (self-consumption / discharge-disabled /
  slow-charge / sustain / recharge); minimum SOC and active SOC limit;
  grid setpoint; per-phase vs total regulation; grid feed-in (AC/DC-coupled
  excess, per-limit); max charge/discharge power and percentage; grid
  metering (inverter/charger vs external meter, with required/optional
  captions per topology); scheduled charging windows
  (`ListChargeSchedule`); peak shaving (`PageSettingsHub4Peakshaving`);
  a deprecation notice for retired modes.
- **Dynamic ESS** (`PageSettingsDynamicEss`): tariff-driven scheduling —
  buy/sell price configuration, target SOC, interlock against the
  opportunity-loads feature ("disable OL first").
- **Generator start/stop** (`PageSettingsGenerator`,
  `PageGeneratorConditions`, `GeneratorCondition`): condition set — battery
  SOC, voltage, current, inverter high temperature, overload, AC load —
  each with start/stop thresholds in both directions and per-condition
  quiet-hours values; periodic test run; minimum run time; warm-up and
  cool-down times with a skip rule and an "unavailable on this genset"
  message; stop-on-tank-level with warning; stop when AC input returns;
  loss-of-communication behavior; generator presence detection at AC or DC
  input; "alarm when not in auto-start" with explanation; quiet hours
  window.
- **Opportunity loads / controllable devices**
  (`PageControllableLoads*`): automation of controllable loads (EVCS,
  battery, S2 resource manager), preferences and per-device pages.
- **System status** (`PageSettingsSystemStatus`): live control-loop
  diagnosis — solar charger voltage/current control state, VE.Bus link,
  BMS parameters, SOC sync between VE.Bus and battery monitor.
- **DC gensets** and **tank pump** configuration.

### 6.6 Devices

The device list — section 7.

### 6.7 Debug & develop (superuser-gated)

A live tree browser over the entire VeQItem space *with write access*
(`pages/settings/debug/PageDebugVeQItems.qml`), power-flow debug
(`PagePowerDebug`, `PageHub4Debug`), raw system data, demo configuration.
The debug surface is the same data plane as the product surface, just
unfiltered.

## 7. Device model and device pages

Every attached product is a service in the tree; C++ models aggregate,
filter, and sort them (`src/aggregatedevicemodel.cpp`,
`src/filtereddevicemodel.cpp`, `src/classandvrminstancemodel.cpp`). The
device list (`pages/settings/devicelist/`) routes each service class to a
dedicated page suite:

- **Batteries**: details, parameters, history, alarms, per-module alarms,
  BMS-specific suites (Lynx Ion: system/diagnostics/IO/battery info;
  distributor list; 48TL diagnostics), fuse info.
- **VE.Bus inverter/chargers** (`pages/vebusdevice/`): overview, advanced
  page, alarm setup per alarm, kWh counters, serial numbers per unit, BMS
  page, a guided Error-11 diagnosis suite, AC sensors, microgrid page,
  device-config backup/restore, debug page.
- **Solar chargers** (`pages/solar/`): device page, daily history (bar
  dialog per day), per-tracker detail, parallel operation, PV inverter
  pages.
- **Meters and sources**: AC meters (with Smappee CT setup wizards), DC
  meters (alarms, history with cycle list), alternators, DC-DC converters,
  AC chargers.
- **Others**: gensets (with genset error model), motor drives, meteo
  sensors, GPS, digital inputs, temperature senders, tank senders (sensor
  setup, shape calibration table, alarms), pulse meters, switches — and an
  explicit "unsupported device" fallback page that still shows identity and
  connection facts.
- **EV charger** (`pages/evcs/`): list, per-charger page (session energy
  and charging time, charge mode, auto-mode power source internal/external,
  enable charging), first-time setup page.

The pattern to note: the *device page is generated from the same tree the
device publishes*, so a new device class costs a page suite, not a protocol
change.

## 8. Alarm and notification model

Alarms are data, not UI events: devices publish alarm items; a C++ model
(`src/notificationmodel.cpp`) folds them into active/inactive lists with
acknowledged state; the same model drives the bell icon, the nav-bar badge,
the Notifications page, and the "silence" semantics. Toasts are a separate,
transient channel (`ToastModel`) used for UI-local outcomes (mode changed,
service offline, high CPU).

## 9. Cross-cutting mechanics

- **Theming**: colors (dark/light plus design tokens), geometry, typography,
  and animation durations are JSON documents (`themes/`), loaded by
  `src/theme.cpp`. Screen-size adaptation is a *geometry theme swap*
  (five-inch / seven-inch / portrait), not fluid scaling — every layout is
  pixel-designed per class.
- **Units**: a single conversion layer (`src/units.cpp`, enums in
  `src/enums.h`) handles metric/imperial, temperature scales, volume,
  distance and speed; pages declare source and display units on the binding,
  never convert inline.
- **i18n**: 21 `.ts` locales including zh_CN; language switch at runtime;
  font is chosen per language.
- **Onboarding**: a first-run tour (`pages/welcome/`) walks through the new
  UI's pages and offers "what's new" after updates.
- **Demo mode**: complete mock implementations per domain (`data/mock/`)
  ship in the production binary, selectable from settings with several
  scenario presets and an on-screen demo indicator.

## 10. Access control and security posture

- **Access levels**: User, User & Installer, Superuser, Service — a level is
  a password-gated UI filter; rows and whole branches declare the minimum
  level that reveals them (`showAccessLevel`).
- **Security profiles**: one three-position choice — Secured / Weak /
  Unsecured — bundles transport and password policy for the local network,
  with a password dialog on profile change. One knob, not a matrix.
- **VRM read-only mode**: the cloud relay can be capped to read-only, and
  the entire UI honors it through the single write path.

## 11. Remote Console (the WASM form)

The browser build is the same QML compiled to WebAssembly (`wasm/`,
CI workflow `build-wasm.yml`), served either by the device itself or from
the VRM portal. Data rides MQTT; against VRM the client discovers the portal
id from a retained topic, then subscribes to the portal's namespace and
enforces a broker heartbeat — a stale heartbeat visibly degrades the UI
rather than showing stale numbers. Login against VRM uses account or token
credentials held by `BackendConnection`; the on-LAN form needs none. The
consequence Victron accepts and documents: on-device QML files can be
hot-modified by owners, but the WASM blob cannot, which is why an official
plugin mechanism (section 13) exists.

## 12. Testing and development tooling

Model-level unit tests (QtTest) cover the C++ aggregation/filter models and
the backend connection (`tests/`); a bespoke UI-test step framework exists
(`src/uitest.cpp`); the mock backend doubles as the demo mode; CI builds the
WASM form. There is no end-to-end browser test — the mock transport is the
integration seam.

## 13. Extensibility and UI replaceability

- **Plugin loader** (`src/guiplugins.h`): watches plugin directories (or
  fetches plugin manifests over MQTT in the remote form), loads packaged
  QML resource bundles with their own translations, and offers five
  integration points — a settings page, a device-list page, a navigation
  page, a quick-access pane, or a card inside the Controls/Switches decks.
  Version bounds (`minRequiredVersion`/`maxRequiredVersion`) gate loading.
- **UI selection**: settings expose "classic UI vs new UI" per surface
  (on-screen and Remote Console independently) — the old and new UIs
  shipped in parallel for multiple releases.

## 14. Benchmark mapping to mos

What gui-v2 demonstrates, mapped to where mos carries (or owes) the
equivalent. The energy domain itself (ESS, DVCC, solar, boat) is Victron's
product and maps to nothing here; the *management surface* is the benchmark.

| gui-v2 capability domain | mos owner today |
|---|---|
| Single API/data plane, UI issues writes only, no exec in UI | `docs/design/api.md` — apid's `/api`-only contract; same posture, HTTP instead of a value tree |
| One UI for local kiosk and remote browser | `docs/design/display.md` (cage+WPE renders apid's own UI) — mos already unified this harder than Victron did |
| Connection state machine, heartbeat, visible staleness | apid session model; no dashboard-side staleness contract yet — relevant to `docs/design/dashboard.md` |
| Notifications: severity model, acknowledge, badges, history | no mos analog yet; nearest owners are RFCT-288 (diagnostics) and the dashboard proposal |
| Settings tree: uniform bound rows, generated pages | `docs/design/mosd.md` settings schema + `docs/design/dashboard.md` IA |
| Device list with per-class page suites and an "unsupported" fallback | mos analog is storage devices and services — RFCT-285 |
| Connectivity settings (Ethernet/WiFi/AP, live link state) | `docs/design/connd.md`, `GET /api/v1/network`; gui-v2's WiFi/GSM status-bar affordances are a dashboard reference |
| Cloud logger diagnostics: per-channel errors, last contact, no-contact reboot watchdog | no mos analog; the *named per-channel error* pattern is directly relevant to RFCT-288 and any future fleet channel (`docs/design/remote-management.md`) |
| Firmware update online/offline + explicit rollback page with named refusals | RFCT-283 (authenticated updates), RAUC A/B + `docs/design/uboot-ab-handshake.md`; the *offline from removable media* path matches RFCT-284 recovery thinking |
| Access levels + one-knob security profile | `docs/design/access.md`; the single Secured/Weak/Unsecured knob is a UX benchmark for lockdown layers |
| Support status page (detects modification, names running integrations, self-reports supportability) | no mos analog; cheap and valuable for a shipped appliance |
| First-run onboarding tour | RFCT-282 (install, onboarding, provisioning) |
| Demo mode with shipped mock data | no mos analog; consider for the dashboard (sales/dev value, near-zero runtime cost) |
| Time/timezone settings page | RFCT-280 |
| Debug tree browser over the live data plane | apid's OpenAPI + bus inspection; a raw-surface debug page is worth considering under RFCT-288 |
| Plugin/integration points, replaceable UI | apid's validated custom-UI mechanism (`/api/v1/ui`) already exceeds gui-v2's plugin story in replaceability, but offers no *partial* integration points |
| Theming as data, geometry-theme responsiveness, i18n, units layer | dashboard proposal; none are contracts yet |

Reading order for an apid/dashboard feature audit: sections 3–7 and 10 are
the appliance-management core; sections 2 and 11 explain the architectural
moves that made one UI serve two transports; section 13 is relevant only if
mos ever wants third-party surface extension rather than whole-UI
replacement.
