# Research: Venus OS web UI and information architecture

> Reference study of Victron Energy's Venus OS UI layer (gui-v2), done
> 2026-08-19. Venus OS is the closest shipping analogue to mos: an appliance OS
> with a central settings bus, a local browser UI and a remote console, and mos
> already borrowed its settings-tree model (`docs/design/mosd.md:18`,
> `docs/design/mosd.md:47`). This document describes Venus. It does not propose
> an mos design; a sibling task owns that and cites this file.

**Companion document:** `docs/research/venus-os-access.md` covers the other half
of the same Venus study — SSH and root access, the local serial console, the
vendor remote-support tunnel, the shipped access defaults, and the firmware
update/rollback UX. A fold of the two into one file was specified, measured and
dropped; the decision and its evidence are in `docs/task/RFCT-045.md`.

## 1. Scope and method

**Date of research:** 2026-08-19. All repository line references below were read
on that date at the commits pinned in §1.3.

### 1.1 What was studied

- What gui-v2 is as an artefact, and how it relates to the on-screen display.
- How the UI is served on the LAN and how it is reached remotely.
- The information architecture: landing screen, top-level navigation, settings
  nesting, navigation depth.
- How the UI distinguishes persisted settings from live service values.
- The inventory of screens and the bus paths behind them.

### 1.2 What was deliberately not studied

- **SSH/root access, remote support tunnelling and firmware-update UX.** A
  sibling task (B) owns these and will append them to this file. Where good
  sources were found in passing they are recorded as pointers in §8.4 without
  analysis.
- gui-v1 internals: it is closed source. Claims about it rest on Victron's own
  description in the gui-v2 README.
- VRM portal server-side behaviour (Victron-hosted, not public source).
- Node-RED, Signal-K, Modbus-TCP and the marine/boat pages beyond naming them.
- VictronConnect (the Bluetooth phone app) is a separate product and is out of
  scope; it is mentioned only where the manual names it as an access route.
- Venus OS was **not** installed, flashed, emulated or run. Nothing in this
  document was observed on hardware.

### 1.3 Sources treated as primary

Public Victron repositories, shallow-cloned read-only into `/srv/tmp/` (never
into this worktree, never committed) and read as source:

| Repository | Commit read |
|---|---|
| `victronenergy/gui-v2` | `97f659b56184549179a77d905a52282ec5a30727` |
| `victronenergy/meta-victronenergy` | `c4836d7c574c5ea4c163009c0576edcdd738b757` |
| `victronenergy/venus-platform` | `735e458ce4be2fc07156d0b03fbc4c5e666a9ed6` |
| `victronenergy/dbus-flashmq` | `bb470b7a6ff23423a3d6d84a30f57e88a10dedf3` |
| `victronenergy/localsettings` | `3aac232f99b150f4db74d20abae3421bcdb72268` |
| `victronenergy/venus.wiki` | `20f17f9f2a649b3146101f0857084331d78b361f` |
| `victronenergy/venus` | `186b23958666a84113ad237d32859fa632565232` |
| `victronenergy/venus-html5-app` | `cc88d36d850eab17741f57e098bd84bad963cedb` |

Repository roots are `https://github.com/<path>`; the wiki is
`https://github.com/victronenergy/venus/wiki`. Also used: the GitHub releases
API for `gui-v2` (release asset sizes, §2.3), and Victron's Cerbo GX product
manual at `https://www.victronenergy.com/media/pg/Cerbo_GX/en/`.

Third-party blogs and community posts by non-staff were **not** used as
evidence for any claim in §2 to §6.

### 1.4 Evidence labelling

Every non-obvious claim carries one of:

- **[S]** read out of source at the cited `repo/path:line`.
- **[D]** documented by Victron (repository README, wiki, or product manual).
- **[I]** my inference from [S]/[D] material, stated as inference.

### 1.5 Licence warning, stated up front

`gui-v2/LICENSE.txt` is "Victron Energy OS license v1". It grants broad rights
but adds: *"The Software and its modifications are only used in systems where
the core of the system consists of Victron Energy components... USE OF THE
SOFTWARE AND ITS MODIFICATIONS WITH SYSTEMS WHOSE CORE IS NOT VICTRON ENERGY
PRODUCTS IS EXPRESSLY NOT AUTHORIZED."* **[S]** `gui-v2/LICENSE.txt:18-23`.

This is a study-only source for mos. Patterns and architecture may be learned
from; code and assets may not be copied. (`meta-victronenergy` recipes are
under their own licences; the gui-v2 recipe declares
`LICENSE = "Victron-Energy-OS-license-v1"` **[S]**
`meta-victronenergy/meta-ve-software/recipes-ve/gui-v2.inc:2`.)

## 2. What GUI-v2 actually is

### 2.1 The technology

gui-v2 is a **Qt 6 / QML application with a C++ backend**, built with CMake
**[S]** `gui-v2/CMakeLists.txt:26-32` (`project(venus-gui-v2 LANGUAGES CXX
VERSION 1.3.15)`). It is roughly 303 QML page files under `pages/` plus a large
`components/` library and ~60 C++ model/helper classes under `src/`. It pulls
`veutil` and `qzxing` as git submodules **[S]** `gui-v2/.gitmodules`.

There is **no HTML, no CSS and no DOM** anywhere in the UI itself. The one
HTML file in the repository, `gui-v2/wasm/index.html`, is a loader page: it
downloads a WebAssembly binary, shows a progress bar, and hands off to Qt's
`qtLoad()` **[S]** `gui-v2/wasm/index.html:644-662`.

### 2.2 Two artefacts from one source tree

The same tree is built twice, and the two builds ship by different routes:

| | On the GX display | In a browser |
|---|---|---|
| Artefact | native ARM binary `venus-gui-v2` | `venus-gui-v2.wasm.gz` + loader |
| Built by | OpenEmbedded from git | GitHub Actions, attached to a release |
| Recipe | `gui-v2_1.3.15.bb` | `gui-v2-webassembly_1.3.15.bb` |
| Rendering | Qt eglfs on DRM/KMS, no browser | Qt for WebAssembly on a canvas |
| Data path | D-Bus | MQTT over WebSocket |

- The on-device build runs under daemontools and depends on
  `qtbase-plugin-qeglfs` and `qtbase-plugin-qeglfs-kms-integration`, i.e. it
  paints straight to DRM/KMS with no X, no Wayland and no browser **[S]**
  `meta-victronenergy/meta-ve-software/recipes-ve/gui-v2_1.3.15.bb:13-31`.
- The WASM build is **not** built by the image build. The recipe downloads
  `venus-webassembly.zip` from the gui-v2 GitHub release for the same version
  and installs it into the web root **[S]**
  `meta-victronenergy/meta-ve-software/recipes-ve/gui-v2-webassembly_1.3.15.bb:3-17`.
  That zip is produced by a GitHub Actions workflow using emscripten 3.1.56 and
  Qt 6.8.3 **[S]** `gui-v2/.github/workflows/build-wasm.yml:66-82`,
  `gui-v2/scripts/.env`.
- Which GUI a device runs is a packaging decision: `start-gui.bbclass` makes
  `start-gui`, `start-gui-v1`, `start-gui-v2` and `start-sway` mutually
  exclusive `RREPLACES`/`RCONFLICTS` packages, so exactly one can be installed
  **[S]** `meta-victronenergy/meta-ve-software/classes/start-gui.bbclass:15-23`.

Victron states the consequence plainly: *"The QML files are still on the rootfs
and can be edited, but doing so only changes the version you see on screen. It
won't change the version used remotely in a browser, ie. the WASM version. That
is a compiled single binary blob, which can't be rebuild on the GX itself."*
**[D]** `gui-v2/README.md:36`.

So "the same codebase drives both" is true; "the same *artefact*" is not, and
the on-device artefact is field-modifiable while the browser artefact is not.

### 2.3 Does "it is a web app" hold up?

Partly, and the part that fails is the part that matters.

It holds up in that: it is fetched over HTTP from the device, it runs in an
unmodified browser with no plugin, it is addressed by URL, and its runtime
configuration arrives as URL query parameters (`mqtt`, `id`, `shard`, `user`,
`pass`, `token`, `colorScheme`, `nodeRedUrl`, `signalKUrl`) **[S]**
`gui-v2/src/main.cpp:76-108`.

It does not hold up in that the payload is a single opaque binary. Measured
from the v1.3.15 release asset (GitHub releases API, published 2026-08-07):

- `venus-webassembly.zip`: 15,958,404 bytes.
- `wasm/venus-gui-v2.wasm.gz` inside it: **15,793,432 bytes on the wire**,
  **35,883,890 bytes decompressed**.
- Everything else in the zip together is under 500 KB (loader, JS glue, icons,
  SVG logos, a `Makefile`, a `.sha256`).

nginx serves the pre-gzipped file directly (`gzip_static always` **[S]**
`meta-victronenergy/meta-venus/recipes-httpd/nginx/files/https.site:11`), and
the loader reports download/compile/instantiate timings and an out-of-memory
path for low-memory clients **[S]** `gui-v2/wasm/index.html:672-680`.

Consequences that a mos designer should weigh **[I]**: there is no view-source,
no progressive rendering, no server-side rendering, no HTML fallback, no CSS
theming hook, no accessibility tree from the DOM, and no possibility of a
usable UI on a browser that cannot run a ~34 MB WASM module. In exchange the
device screen and the browser are pixel-identical by construction, and the
whole UI is one QML codebase.

### 2.4 What it replaced, and why

gui-v1 was Qt 4, button-oriented, and closed source; gui-v2 is Qt 6, touch
oriented, and published **[D]** `gui-v2/README.md:13-16`. gui-v2 was released
in Venus OS 3.50 as "New UI" **[D]** `gui-v2/README.md:22`.

Two structural changes came with it, both stated by Victron **[D]**
`gui-v2/README.md:16-19`:

1. **Remote console changed transport.** gui-v1's remote console was
   browser-based VNC; gui-v2's is a WASM build talking MQTT. The old path still
   exists in the image: nginx proxies `/websockify` to `127.0.0.1:81` **[S]**
   `meta-victronenergy/meta-venus/recipes-httpd/nginx/files/https.site:42-49`,
   and the layer still carries `javascript-vnc-client`, `x11vnc` and `neatvnc`
   recipes.
2. **The UI stopped being privileged.** gui-v1 also started and stopped
   services; those duties moved to the `venus-platform` repository. Because the
   WASM build cannot reach D-Bus, *"it can no longer issue commands directly to
   Venus OS. The only data path is MQTT (for WASM) and D-Bus (when running
   locally on the GX). For that, various features have been added to
   venus-platform (like starting a reboot, or starting a firmware update) so
   that the command for that can be issued over D-Bus / MQTT."*

That second point is the load-bearing architectural fact of the whole design,
and §5.4 and §7 return to it.

## 3. How the UI is served and reached

### 3.1 The local path

**Server.** nginx, packaged from OpenEmbedded with the `http-auth-request`
module, running as user `www-data` under daemontools (not systemd; the recipe
explicitly clears `SYSTEMD_SERVICE` and sets `DAEMONTOOLS_RUN`) **[S]**
`meta-victronenergy/meta-venus/recipes-httpd/nginx/nginx_%.bbappend:3-29`. The
document root is `/var/www/venus` **[S]**
`meta-victronenergy/meta-ve-software/classes/www.bbclass:2`.

**Startup is gated on a setting.** `start-nginx.sh` blocks in a `sleep 1` loop
until `com.victronenergy.settings /Settings/System/SecurityProfile` answers a
`GetValue`, and only then decides which site files to enable **[S]**
`meta-victronenergy/meta-venus/recipes-httpd/nginx/files/start-nginx.sh:3-30`:

| SecurityProfile | Sites enabled |
|---|---|
| always | `https.site` (443, TLS) |
| `0` Secured | `http-explanation.site` on :80 |
| `1` Weak, `2` Unsecured, `3` Indeterminate | `http.site` on :80 |

The default value shipped for that setting is `0` (Secured), declared with
range 0-3 in the recipe's localsettings seed file **[S]**
`meta-victronenergy/meta-venus/recipes-httpd/nginx/files/localsettings:1`
(`System/SecurityProfile 0 i 0 3`). The enum is
`SECURED, WEAK, UNSECURED, INDETERMINATE` **[S]**
`venus-platform/src/security_profiles.hpp:16-22`.

Note a discrepancy worth flagging: the comment in `start-nginx.sh:25` says
profile 3 should *"serve a page that a Secure Profile must be selected"*, but
the code branches 1, 2 and 3 all to the full plaintext `http.site` **[S]**
`meta-victronenergy/meta-venus/recipes-httpd/nginx/files/start-nginx.sh:25-27`.
Comment and code disagree; the code is what runs.

**TLS.** Always on, always self-signed. A boot script generates
`/data/etc/ssl/venus.local.{crt,key}` if missing or mismatched, with
`CN=venus.local` and `-days 365000` **[S]**
`meta-victronenergy/meta-venus/recipes-httpd/venus-www-config/files/ssl-certificate:29-35`.
`https.site` is unconditionally enabled. The `ssl_ciphers` line is templated at
build time; `ssl_protocols` is left commented out **[S]**
`meta-victronenergy/meta-venus/recipes-httpd/nginx/files/nginx.conf:26-29`.

**Authentication.** nginx `auth_request` against a PHP endpoint. Every location
except the exempted ones is guarded by `auth_request
@remoteconsole-authproxy`, which sub-requests `/auth/test.php?user=remoteconsole`
over php5-fpm on a unix socket; 401 and 403 are rewritten to a 200 redirect to
`/auth/login.php?page=$request_uri` **[S]**
`meta-victronenergy/meta-venus/recipes-httpd/nginx/files/https.site:12-35`. The
PHP itself lives in `victronenergy/venus-www`, pinned by SRCREV **[S]**
`meta-victronenergy/meta-venus/recipes-httpd/nginx-auth/venus-www.bb:6-30`.

Two deliberate holes in that gate, both commented in the config:

- `location ~ /gui-v2/venus-gui-v2 { auth_request off; ... }` — the WASM asset
  itself is served without a cookie, plus permissive CORS headers, *"for the
  HttpProxyOverSshTunnels (VRM)"* **[S]**
  `meta-victronenergy/meta-venus/recipes-httpd/nginx/files/https.site:59-72`.
- On the Secured profile's port 80 site, the only served location is that same
  WASM path, with the comment *"VRM downloads the wasm over http, so it is also
  included here. It is not intended for use over the LAN."* **[S]**
  `meta-victronenergy/meta-venus/recipes-httpd/nginx/files/http-explanation.site:14-29`.

On the plaintext site, `/auth/generate-token` is explicitly denied with a
plain-text 403 **[S]**
`meta-victronenergy/meta-venus/recipes-httpd/nginx/files/http.site:14-23`.

**Data channel.** The WASM does not talk HTTP to the device after loading. The
loader computes a default argument
`ws(s)://<document.location.host>/websocket-mqtt` and passes it as `--mqtt`
**[S]** `gui-v2/wasm/index.html:644-645`. nginx proxies `/websocket-mqtt` to
`127.0.0.1:9001` with the WebSocket upgrade headers **[S]**
`meta-victronenergy/meta-venus/recipes-httpd/nginx/files/https.site:51-57`.
Port 9001 is FlashMQ's `protocol websockets` listener **[S]**
`meta-victronenergy/meta-venus/recipes-connectivity/flashmq/flashmq/flashmq.conf:22-25`.
FlashMQ is made D-Bus-aware by the `dbus-flashmq` plugin loaded from
`/usr/libexec/flashmq/libflashmq-dbus-plugin.so` **[S]** same file, line 2;
the plugin publishes `N/<portal ID>/<service_type>/<instance>/<D-Bus path>` and
accepts writes on `W/...` **[D]** `dbus-flashmq/README.md`.

The same broker also listens on 1883 plain and 8883 TLS **[S]**
`flashmq.conf:10-20`; whether those are reachable is separately gated by a
`MqttAccess` setting with values `OFF` (default), `ON`, `TOKENS_ONLY` **[S]**
`venus-platform/src/security_profiles.hpp:35-39`.

**What URL an operator actually types.** `/index.php` in the web root is a
symlink to `/run/www/index.php` **[S]** `nginx_%.bbappend:53`, which a boot
hook re-creates each start by reading
`com.victronenergy.settings /Settings/Gui/RunningVersion` and linking either
`gui-v1.php` or `gui-v2.php` **[S]**
`meta-victronenergy/meta-venus/recipes-httpd/nginx/files/create-gui-redirect.sh:3-16`.
`gui-v2.php` is a three-line 302 to `/gui-v2`, preserving the query string
**[S]** `meta-victronenergy/meta-venus/recipes-httpd/nginx/files/gui-v2.php:2-4`.
So `https://<device>/` follows whichever GUI is running, and the query string
survives the redirect.

**Discovery.** avahi plus a small helper that registers a CNAME
`venus-<serial>.local` read from `/data/venus/serial-number` **[S]**
`meta-victronenergy/meta-ve-software/recipes-ve/venus-mdns-aliases/venus-mdns-aliases.c:166-192`.
The product manual tells users to browse to `venus.local`, or to
`http://172.24.24.1` when connected to the device's own `Venus-[serial]` Wi-Fi
access point **[D]** Cerbo GX manual, "Accessing the GX device",
`https://www.victronenergy.com/media/pg/Cerbo_GX/en/accessing-the-gx-device.html`.

**Site overrides.** `/var/www/venus/default/*` entries are symlinked into
`/run/www/` at boot, but any directory present under `/data/www/` shadows the
shipped one **[S]**
`meta-victronenergy/meta-venus/recipes-httpd/venus-www-config/files/www-overrides:6-16`.
That is how a persistent, user-supplied web asset survives a read-only rootfs.

### 3.2 The remote path

The remote console is **not** a tunnel to the device's web server for the data;
only the initial asset download traverses VRM's proxy.

- The WASM assets are fetched through VRM's `HttpProxyOverSshTunnels`, which is
  why the asset path is exempted from auth and given CORS headers, on both the
  HTTPS site and the Secured-profile HTTP site **[S]** `https.site:59-72`,
  `http-explanation.site:14-29`.
- The data channel goes to Victron's own broker farm, not to the device. The
  client computes `wss://webmqtt<shard>.victronenergy.com/mqtt`, where the
  shard is derived from the VRM portal id by summing its lowercase character
  codes modulo 128 **[S]** `gui-v2/src/main.cpp:55-69`.
- Credentials for that connection are a VRM username/password or a JWT token,
  supplied as URL query parameters and, for `shard=vrm`, exchanged at
  `https://vrmapi.victronenergy.com/v2/auth/login` **[S]**
  `gui-v2/src/backendconnection.cpp:494-505`.
- The client knows it is on the VRM path by testing whether the address starts
  with `wss://webmqtt` **[S]** `gui-v2/src/backendconnection.cpp:334`, and
  changes behaviour accordingly: a longer write-confirmation timeout (§5.4), a
  heartbeat requirement before declaring the backend ready **[S]**
  `gui-v2/Global.qml:19-22`, and suppression of the onboarding flow in
  read-only mode **[S]** `gui-v2/data/SystemSettings.qml:14-19`.
- The device side of that link is a bridge registered by venus-platform
  (`src/mqtt_bridge_registrator.cpp`, `SecurityProfiles::enableMqttBridge`
  **[S]** `venus-platform/src/security_profiles.cpp:477`), gated by a
  `VrmPortal` setting with values `OFF`, `READ_ONLY`, `FULL` (default `FULL`)
  **[S]** `venus-platform/src/security_profiles.hpp:41-46` and the shipped
  default `Network/VrmPortal 2 i 0 2` **[S]**
  `meta-victronenergy/meta-venus/recipes-httpd/nginx/files/localsettings:2`.

**Who terminates what** **[I]**, following from the above: on the LAN the
browser terminates TLS at the device's own self-signed certificate and the
WebSocket at the device's own broker; remotely the browser terminates TLS at
Victron's broker and the device holds an outbound bridge to the same broker.
The device therefore needs no inbound port for the remote case.

**On by default.** TLS on 443: yes, unconditionally. Plaintext on 80: only
below the Secured profile. Password: required by the Secured and Weak profiles,
minimum 8 characters, enforced client-side in QML **[S]**
`gui-v2/pages/settings/PageSettingsAccessAndSecurity.qml:155-163`. MQTT on
1883/8883: off by default. VRM: `FULL` by default.

## 4. Information architecture

### 4.1 The landing screen

**Which screen opens is a setting, with an alarm override.** On load, if
`NotificationModel.activeAlarms > 0` the UI goes to the Notifications page;
otherwise it goes to the configured start page **[S]**
`gui-v2/pages/MainView.qml:189-196`. The start page is one of nine configured
values, or an "auto-select" mode in which the UI silently records whatever page
you were last looking at as the new start page **[S]**
`gui-v2/data/StartPageConfiguration.qml:19-83`.

**The default landing screen is "Brief".** It is a single instrument panel: one
large circular gauge in the centre, with up to three gauges down the left edge
(AC input, DC input, solar yield) and up to two down the right (AC loads, DC
loads), each rendered only when that input or load exists **[S]**
`gui-v2/pages/BriefPage_Landscape.qml:27-28, 56-64`. It has a portrait variant
and an optional side panel of widgets **[S]** `gui-v2/pages/BriefPage.qml:52-105`.

**What the landing screen deliberately does not show:** no device list, no
settings, no IP address, no firmware version, no service or health status, no
logs, no tables of numbers. It answers "is my system doing what I want right
now" and nothing else. Every one of those omitted things is reachable, but each
costs at least one deliberate navigation.

**Persistent chrome.** A status bar at the top carrying a left button (opens
the "Controls" card overlay, or acts as Back inside a page stack), an aux
button (the "Switches" pane), breadcrumbs, a notification button and a sleep
button **[S]** `gui-v2/components/StatusBar_Landscape.qml:51-97, 134`; and a
navigation bar at the bottom showing as many page buttons as fit, collapsing
the remainder behind a "More" button **[S]** `gui-v2/components/NavBar.qml:21-25,
77-79`, with an unacknowledged-notification counter badge on the Notifications
button **[S]** `gui-v2/components/NavBar.qml:104-110`.

### 4.2 Top-level navigation is data-dependent

The set of top-level pages is not fixed. `SwipePageModel` computes it **[S]**
`gui-v2/components/SwipePageModel.qml:11-16, 32-44, 67-74`:

- always: Brief, Overview, Notifications, Settings;
- Levels **only if** `tankCount > 0 || environmentInputCount > 0`;
- Boat **only if** `/Settings/Gui/ElectricPropulsionUI/Enabled` is set.

So a system with no tanks has four top-level pages and never shows an empty
Levels screen. **[I]** This is the single cheapest IA idea in the whole design:
the navigation is a function of what is attached, not a constant.

### 4.3 The settings tree

The Settings page root is seven rows, in two groups **[S]**
`gui-v2/pages/SettingsPage.qml:36-107`:

| Row | Caption shown under it |
|---|---|
| Devices | "All connected devices" |
| General | "Access control, Display, Firmware, Support" |
| Connectivity | "Ethernet, Wi-Fi, Bluetooth, VE.Can" |
| VRM | "Remote monitoring portal" |
| *(header: Advanced)* | |
| Integrations | "Relays, Sensors, PV Inverters, Modbus, Node-RED" |
| System Setup | "AC/DC system, ESS, DVCC, Battery..." |
| Debug & Develop | "Profiling tools, debug statistics, app version..." |

Behind those seven rows sit 98 QML files directly in `pages/settings/`, plus
subdirectories for the device list, the debug pages and timezone selection, and
303 QML files under `pages/` in total.

Two IA devices carry that volume:

1. **Every navigation row states what is inside it.** At the root it is a static
   caption; one level down it is usually the *live current value*. Examples
   **[S]** `gui-v2/pages/settings/PageSettingsConnectivity.qml:30-80`: the
   "Ethernet" row's secondary text is the current IP address, or the connman
   service state, or "Unplugged"; the "Wi-Fi" row shows the connected network
   name; the "Bluetooth" row shows Enabled/Disabled or "No Bluetooth
   available"; the "Mobile Network" row shows the network name or "No cellular
   modem connected". The Firmware row shows the installed version **[S]**
   `gui-v2/pages/settings/PageSettingsGeneral.qml:112-120`. A settings menu is
   therefore also a status page, and an operator can answer most questions
   without opening anything.
2. **Breadcrumbs.** A horizontal breadcrumb list in the status bar, with a
   synthetic bottom crumb labelled "Settings", each crumb clickable to pop back
   to that depth; hidden entirely when the trail is shorter than two **[S]**
   `gui-v2/components/Breadcrumbs.qml:14-37`.

### 4.4 How deep does it go? A measured example

Take a routine task: put a Wi-Fi network on a static IP.

| Step | Screen | Pushed by |
|---|---|---|
| 0 | Settings (a top-level swipe page, stack depth 0) | nav bar |
| 1 | Connectivity | `SettingsPage.qml:62` |
| 2 | Wi-Fi | `PageSettingsConnectivity.qml:46` |
| 3 | the chosen access point (a `PageSettingsTcpIp`) | `PageSettingsWifi.qml:208-215` |
| 4 | "IP configuration" option list | `ListRadioButtonGroup.qml:59-63` |

Four page pushes below the Settings root, five screens from the landing screen,
six taps including selecting Settings. Note step 4: a radio-button setting is
not an inline control, it is **its own pushed page**
(`RadioButtonListPage`) — every enumerated setting in the product costs one
extra level of depth. That is the single biggest contributor to depth in the
design.

The Ethernet variant of the same task is one level shallower (Settings →
Connectivity → Ethernet → IP configuration) because there is no per-network
selection step.

### 4.5 What can be done without reading documentation

**[I]**, from reading the pages rather than from user testing:

- Reachable by exploration: connecting to Wi-Fi, seeing the IP address,
  changing display units and brightness, reading firmware version, reading and
  acknowledging notifications, changing the start page, choosing a security
  profile (each option carries a one-line caption and a bulleted confirmation
  dialog, §6).
- Not reachable by exploration: raising your own access level. The escalation
  paths are undocumented gestures on the Access & Security page — hold the
  Right key for 60 repeats to reach Superuser, five Up presses followed by five
  Down presses to reach Service, or drag the list down past 60 px and hold for
  5 seconds **[S]**
  `gui-v2/pages/settings/PageSettingsAccessAndSecurity.qml:29-58`. The password
  prompt on the User and Installer options accepts the literal string `ZZZ`,
  hard-coded in the QML **[S]** same file, lines 80-86.

### 4.6 The access-level model

Four levels: `User`, `Installer`, `SuperUser`, `Service` **[S]**
`gui-v2/src/enums.h:134-140`, held in
`/Settings/System/AccessLevel` **[S]** `gui-v2/data/SystemSettings.qml:189-191`.

The model is enforced *in the base class of every settings row*, not per page
**[S]** `gui-v2/components/listitems/core/ListSetting.qml:46-84`:

- `showAccessLevel` defaults to `User`, `writeAccessLevel` defaults to
  `Installer`.
- A row whose `showAccessLevel` exceeds the current level is not disabled, it is
  **not rendered** (`effectiveVisible: preferredVisible && userHasReadAccess`).
- A write attempted above `writeAccessLevel` is refused and raises a toast,
  "Setting locked for access level", via `checkWriteAccessLevel()`.
- Rows requiring `SuperUser` or above get a distinguishing colour stripe on the
  left edge of their background (`backgroundIndicatorColor`).
- The comment is explicit that rows must never set `enabled: false`, so that
  keyboard navigation still highlights them.

## 5. Settings versus live state in the UI

### 5.1 The two service families

- **Persisted settings** live in one service, `com.victronenergy.settings`,
  implemented by `localsettings`, which is *"D-Bus settings manager that
  interfaces between xml file on disk and D-Bus"* **[D]**
  `localsettings/README.md:5-7`; the wiki names the backing file as
  `/data/conf/settings.xml` **[D]** `venus.wiki/dbus-api.md:80`. Settings are
  created at runtime by whichever process needs them, via `AddSetting` /
  `AddSettings`, which take a default, a type and optional min/max, and which
  are idempotent **[D]** `localsettings/README.md:16-33`.
- **Live values** live in per-device services `com.victronenergy.<type>[.suffix]`,
  one service per device, disambiguated by `/DeviceInstance` **[D]**
  `venus.wiki/dbus.md:5`, `venus.wiki/dbus-api.md:60-74`.

Both families expose the **same** interface, `com.victronenergy.BusItem`:
`GetValue`, `GetText`, `SetValue`, `GetMin`, `GetMax`. Only
`com.victronenergy.settings` additionally offers `SetDefault`, `GetDefault`
and `AddSetting` **[D]** `venus.wiki/dbus-api.md:280-300`.

### 5.2 Where the boundary lives in the code: in the path, not in a type

gui-v2 addresses everything through one QML type, `VeQuickItem`, keyed by a
transport-independent `uid`. `BackendConnection::serviceUidForType()` maps a
service type to `dbus/com.victronenergy.<type>` or `mqtt/<type>/0` depending on
the active producer **[S]** `gui-v2/src/backendconnection.cpp:631-645`.

The result is that in the QML there is **no type-level distinction at all**
between a setting and a reading. Compare, from the same file
`gui-v2/data/System.qml`:

```qml
uid: root.serviceUid + "/Dc/Battery/Voltage"                          // line 48, live
uid: Global.systemSettings.serviceUid + "/Settings/SystemSetup/HasDcSystem" // line 56, setting
```

`Global.systemSettings.serviceUid` is `serviceUidForType("settings")` **[S]**
`gui-v2/data/SystemSettings.qml:12`; `Global.system.serviceUid` is
`serviceUidForType("system")` **[S]** `gui-v2/data/System.qml:12`;
`Global.venusPlatform.serviceUid` is `serviceUidForType("platform")` **[S]**
`gui-v2/data/VenusPlatform.qml:12`. The boundary is the string `/Settings/`.

**[I]** This is a real design cost: nothing in the UI's type system prevents
binding an editor to a live path or a read-only label to a setting. Discipline
lives in the choice of QML component, which is the next subsection.

### 5.3 How each is presented

The distinction the operator sees is carried entirely by **which list-item
component** the page author picked:

| Component | Used for | Presentation |
|---|---|---|
| `ListText` | live text values | left label, right secondary text, no affordance |
| `ListQuantity` | live numeric readings | right-aligned value plus unit, in secondary type |
| `ListSwitch`, `ListSlider`, `ListSpinBox`, `ListTextField` | settings | an actual control on the row |
| `ListRadioButtonGroup` | enumerated settings | a navigation row whose secondary text is the *currently selected option's display string*, pushing an options page |
| `ListNavigation` / `SettingsListNavigation` | sub-menus | forward chevron, secondary text = live summary of what is inside |
| `ListButton` | actions | a labelled button |

Two invalid-value conventions, and they differ by component:

- `ListText` renders an empty string when the item is not valid:
  `secondaryText: dataItem.valid ? dataItem.value : ""` **[S]**
  `gui-v2/components/listitems/core/ListText.qml:16`.
- Numeric quantities render the literal `--` and keep the unit suffix, so the
  row does not reflow when a reading drops out **[S]**
  `gui-v2/src/units.cpp:259-266`.

Note that gui-v2 does **not** use the bus's own `GetText` (which returns
`"21.3 W"` and an empty string when invalid **[D]**
`venus.wiki/dbus-api.md:285-286`). It formats client-side through its own
`Units`/`QuantityLabel` machinery, because the presentation depends on user
preference settings — Watts versus Amps, Celsius versus Fahrenheit, litres
versus gallons, four speed units — resolved by
`SystemSettings.toPreferredUnit()` **[S]**
`gui-v2/data/SystemSettings.qml:47-66`. **[I]** The bus offers a
server-formatted string and the UI declines it, because unit preference is a
UI-side concern.

### 5.4 Configured intent versus observed reading: `SettingSync`

This is the part of the design most directly relevant to mos.

gui-v2 has an explicit component whose only job is to show the operator *what
they asked for* while the backend has not yet caught up **[S]**
`gui-v2/components/SettingSync.qml`:

- `writeValue(v)` stores `v` as `_pendingValue`, starts a timer, and calls
  `dataItem.setValue(v)`.
- `expectedValue` returns `_pendingValue` while busy, and the backend value
  otherwise.
- `busy` is true while the timer runs *and* the backend value still differs.
- The timer is **3000 ms over VRM, 500 ms on WASM-local and on the device
  screen** (line 59) — the tolerance is a function of the transport.
- The header comment lists why the backend may never converge: *"the pending
  write did not occur due to a write by another user via VRM"*, *"the backend
  was unable (or refused) to update the value"*, *"some latency when changing
  values via VRM"* (lines 52-56).
- The comment also records the intended end state: this type should not be
  needed, because `VeQuickItem` already tracks locally-written values and a
  synchronisation `state`, *"but those features are not currently supported by
  the MQTT producer"* (lines 15-17).

So Venus models three states per setting — backend value, written-but-unconfirmed
value, and give-up — and it does so because a remote UI made the difference
observable.

What the UI does **not** distinguish **[I]**: there is no visual marker for
"this reading is a setting that a driver echoed back" versus "this is a
measurement"; there is no display of a setting's stored default alongside its
current value even though the bus offers `GetDefault`; and there is no
indication anywhere of whether a written setting has actually been *applied* by
its consumer, as opposed to merely *stored* by localsettings.

## 6. Screens and panes inventory

Bus paths are given where they could be determined by reading the QML. "uid
prefix" abbreviations: `settings` = `com.victronenergy.settings` (or
`mqtt/settings/0`), `platform` = `com.victronenergy.platform`, `system` =
`com.victronenergy.system`.

| Screen / pane | Displays | Binds to | Mode |
|---|---|---|---|
| Brief (default landing) | central gauge plus edge gauges for AC/DC input, solar yield, AC/DC loads | `system/Dc/Battery/Voltage`, `system/Dc/System/Power`, `system/Dc/Pv/Power`, gauge maxima from `settings/Settings/Gui/Gauges/*` **[S]** `gui-v2/data/System.qml:44-83` | read-only |
| Brief side panel | configurable widget strip, expandable graphs | `settings/Settings/Gui/BriefView/*` **[S]** `gui-v2/pages/settings/PageSettingsDisplayBrief.qml:229, 262` | read-only |
| Overview | live energy-flow diagram of the whole installation | `com.victronenergy.system` aggregate paths | read-only |
| Levels (conditional) | Tanks tab and Environment tab | tank and temperature/humidity services; pane exists only if either count > 0 **[S]** `gui-v2/components/SwipePageModel.qml:15-17, 67-74` | read-only |
| Notifications | active and inactive alarms/warnings/infos, acknowledge and silence | `platform/Notifications` subtree **[S]** `gui-v2/src/notificationmodel.cpp:25-35` | read + acknowledge |
| Controls (card overlay) | ESS card plus one control card per EV charger, generator, inverter/charger | `system/SystemType` gates the ESS card **[S]** `gui-v2/pages/ControlCardsPage.qml:47-65` | editor |
| Switches (aux pane) | switchable outputs and dimmers | `/SwitchableOutput` API services **[D]** `venus.wiki/dbus.md` index | editor |
| Boat (conditional) | electric-propulsion dashboard | enabled by `settings/Settings/Gui/ElectricPropulsionUI/Enabled` **[S]** `SwipePageModel.qml:40-43` | read-only |
| Settings root | seven navigation rows with captions | none | navigation |
| Settings > Devices | one delegate per connected device, chosen by service type; disconnected devices retained by cached name with a "remove disconnected" action | `RuntimeDeviceModel` over all `com.victronenergy.*` services **[S]** `gui-v2/pages/settings/devicelist/DeviceListPage.qml:17-64` | navigation |
| Settings > General | firmware version, support status, display, access control entry points | `platform/Firmware/Installed/Version`, `platform/Device/Model`, `settings/Settings/Services/Modbus`, `platform/Services/SignalK/Enabled`, `platform/Services/NodeRed/Mode` **[S]** `gui-v2/pages/settings/PageSettingsGeneral.qml:87-120` | mixed |
| ... > Access & Security | access level, local network security profile, root password, SSH on LAN, remote support, logout | `settings/Settings/System/AccessLevel`, `settings/Settings/System/SecurityProfile`, `platform/Security/Api` (JSON command item), `settings/Settings/System/SSHLocal`, `settings/Settings/System/RemoteSupport`, `settings/Settings/System/RemoteSupportIpAndPort` **[S]** `gui-v2/pages/settings/PageSettingsAccessAndSecurity.qml:65-320` | editor |
| Settings > Connectivity | Ethernet, Wi-Fi, Bluetooth, Mobile, VE.Can rows, each with a live summary | `settings/Settings/Services/Bluetooth`, `com.victronenergy.modem/SimStatus`, connman via `NetworkServices` **[S]** `gui-v2/pages/settings/PageSettingsConnectivity.qml:30-90` | navigation |
| ... > Wi-Fi | scanned access point list with favourite ticks, rescanning every 10 s, auto-exit after 5 min | `WifiModel` over connman **[S]** `gui-v2/pages/settings/PageSettingsWifi.qml:187-257` | editor |
| ... > network detail (`PageSettingsTcpIp`) | name, password, connect/forget, signal strength, state, MAC, IP configuration, netmask, gateway, DNS, link-local | connman service properties plus `platform/Network/Ethernet/GatewayEnabled` **[S]** `gui-v2/pages/settings/NetworkSettingsPageModel.qml:90-135` | editor |
| Settings > VRM | portal access level, portal ID, device registration, log interval, HTTPS toggle, last contact | `settings/Settings/Network/VrmPortal`, `platform/Device/UniqueId`, `platform/Device/ProductId`, `settings/Settings/Vrmlogger/LogInterval`, `settings/Settings/Vrmlogger/HttpsEnabled` **[S]** `gui-v2/pages/settings/PageSettingsLogger.qml:44-155` | editor |
| Settings > Integrations | relays, sensors, PV inverters, Modbus, Node-RED, Shelly, EEBus, Signal K | many, per sub-page | editor |
| Settings > System Setup | AC/DC system, ESS, DVCC, battery, generator conditions | `settings/Settings/SystemSetup/*`, `settings/Settings/CGwacs/*` | editor |
| Settings > Debug & Develop | app version, quit, power debug, system data, VeQItems browser, FPS visualiser, CPU usage, demo mode | `showAccessLevel: SuperUser` on the entry row **[S]** `gui-v2/pages/SettingsPage.qml:98-106` | mixed |
| ... > VeQItems browser | the whole bus tree, dumped as JSON with serial numbers and custom names redacted before sharing | any uid under `BackendConnection.uidPrefix()` **[S]** `gui-v2/pages/settings/debug/PageDebugVeQItems.qml:12-75` | read-only |
| Welcome / onboarding | seven "what's new" cards with a Skip button, shown once after the UI change | `needsOnboarding` on the settings service, suppressed when VRM is read-only or touch is disabled **[S]** `gui-v2/data/SystemSettings.qml:13-19`, `gui-v2/pages/welcome/WelcomeView.qml:33-117` | informational |

## 7. What Venus does in the UI that mos has no answer for

Ranked by value to mos, most valuable first. Each item states what Venus does,
why it earns its place, and one sentence on plausibility for mos. No mos design
is proposed here.

1. **The product UI works from outside the LAN without any inbound port, using
   the same build.** The browser loads the WASM through VRM's proxy and then
   connects to Victron's broker farm, while the device holds an outbound bridge
   to the same broker (§3.2). *Why it earns its place:* it removes the entire
   category of "how does the owner see their appliance from a phone on
   cellular" without NAT traversal, port forwarding, or a second UI.
   *Plausible for mos:* mos already plans an outbound tunnel (SideroLink) but it
   carries the machine API, not webd, so the mechanism exists while the UI path
   does not (`docs/design/remote-management.md:24-34`).

2. **Actions are modelled as writable bus items, not as methods.** A reboot is
   `setValue(true)` on `platform/Device/Reboot`, implemented by a
   `VeQItemReboot : VeQItemAction` registered as a child item **[S]**
   `gui-v2/data/VenusPlatform.qml:14-20`,
   `venus-platform/src/application.cpp:215-233, 815`. Security changes are a
   JSON document written to a single `platform/Security/Api` item **[S]**
   `gui-v2/pages/settings/PageSettingsAccessAndSecurity.qml:104-110, 207-210`.
   *Why it earns its place:* a value-oriented remote bridge (MQTT `W/` topics)
   carries commands unchanged, so remote and local use exactly one code path.
   *Plausible for mos:* mosd exposes `Reboot` and `PowerOff` as D-Bus **methods**
   (`docs/design/mosd.md:202-203`), which a value-forwarding remote bridge
   cannot carry, so this is a fork in the road rather than a feature to add.

3. **A first-class notification stream, surfaced in the chrome and raised by
   backend services.** Notifications are a bus subtree (`platform/Notifications`)
   with active/inactive and acknowledged/unacknowledged dimensions, a counter
   badge on the nav bar, and a top-level page that the UI jumps to on load when
   an alarm is active (§4.1, §6). *Why it earns its place:* it is the only
   channel by which the device tells the operator something without being
   asked. *Plausible for mos:* mosd has `ReportHealth`
   (`docs/design/mosd.md:374`) but no notification model and no UI surface for
   one.

4. **Config-versus-reality drift is raised as a user-visible warning.**
   `SecurityProfiles::checkPassword()` compares the declared security profile
   against the actual password file (missing, empty, unexpectedly present) and,
   on any inconsistency, raises a WARNING notification titled *"Inconsistent
   Network Security Profile"*, clearing it when consistency returns **[S]**
   `venus-platform/src/security_profiles.cpp:422-475`. *Why it earns its place:*
   it turns "the setting says one thing and the system is another" from an
   invisible failure into a UI event. *Plausible for mos:* mosd's reconcilers
   already produce named outcomes including `conflict` and `plaintext-missing`
   (`docs/design/mosd.md:258-260`), so the detection exists and only the surface
   is missing.

5. **Per-row access levels with hide-not-disable semantics.** Four levels, and
   `showAccessLevel`/`writeAccessLevel` on the base class of every settings row,
   so an under-privileged operator sees a *shorter* menu rather than a greyed-out
   one, and an over-reach produces an explanatory toast (§4.6). *Why it earns
   its place:* it lets one UI serve an owner, an installer and a support
   engineer without three UIs or three builds. *Plausible for mos:* mos has a
   single `access.webAdmin` credential and one session gate
   (`docs/design/mosd.md:117-120`), so this would be a new axis rather than a
   refinement.

6. **Optimistic write feedback with a transport-dependent timeout.**
   `SettingSync` shows the requested value while the backend catches up, and
   gives up after 500 ms locally or 3000 ms over VRM (§5.4). *Why it earns its
   place:* on a slow or shared link, a control that snaps back to the old value
   with no explanation is the single most common way an appliance UI loses the
   operator's trust. *Plausible for mos:* webd is server-rendered
   (`docs/design/remote-management.md:13`), so a form POST already round-trips,
   but nothing today distinguishes "stored" from "reconciled".

7. **Navigation rows carry the live value of what is behind them.** Ethernet
   shows the IP address, Wi-Fi the connected SSID, Firmware the installed
   version, Bluetooth enabled/disabled (§4.3). *Why it earns its place:* it
   makes a menu answer questions without being entered, which is what keeps a
   five-level tree usable. *Plausible for mos:* cheap and transport-agnostic;
   it costs one extra bus read per row.

8. **Panes and rows appear only when their data exists.** The Levels page is
   absent when there are no tanks and no environment sensors; the Boat page is
   absent unless enabled; individual rows use `preferredVisible` bound to a
   count (§4.2, §6). *Why it earns its place:* the operator's mental model of
   the product is exactly as large as their installation. *Plausible for mos:*
   directly applicable — a headless unit should not carry a display pane, a
   unit with no Wi-Fi adapter should not carry a Wi-Fi pane.

9. **The device list survives disconnection.** A device that vanishes is kept in
   the list under a cached name with a distinct delegate, and there is an
   explicit "remove disconnected" action **[S]**
   `gui-v2/pages/settings/devicelist/DeviceListPage.qml:28-39, 133`. *Why it
   earns its place:* "my sensor disappeared" is a diagnosis, not an absence.
   *Plausible for mos:* applies to any enumerated hardware mos tracks
   (interfaces, storage, USB), and needs a retention decision rather than new
   plumbing.

10. **An in-UI bus browser that redacts before it shares.** The VeQItems debug
    page walks any subtree, emits it as JSON, and replaces serial numbers with
    `ABCDE_<random>` and blanks `CustomName` values first — gated behind
    Superuser **[S]** `gui-v2/pages/settings/debug/PageDebugVeQItems.qml:50-75`,
    `gui-v2/pages/SettingsPage.qml:105`. *Why it earns its place:* it turns
    "send us your logs" into a one-tap, privacy-reviewed action. *Plausible for
    mos:* mosd's `GetState`/`GetSettings` already return the whole tree
    (`docs/design/mosd.md:198-199`), and the missing pieces are the redaction
    rule and the gate.

11. **Self-lockout warnings before the change that removes your own access.**
    Setting VRM portal access to Read-only or Off shows *"Changing this setting
    to Read-only or Off will lock you out."* **[S]**
    `gui-v2/pages/settings/PageSettingsLogger.qml:74-77`; each security profile
    option carries a bulleted description of exactly what it enables and
    disables, and the "Unsecured" choice is confirmed in a modal **[S]**
    `PageSettingsAccessAndSecurity.qml:213-250`. *Why it earns its place:* the
    most expensive support call on an appliance is the one where the operator
    locked themselves out of the box on a boat. *Plausible for mos:* mos has an
    equivalent hazard class already recorded (`docs/design/mosd.md:225-228`
    notes the power pane cannot warn about burning a boot attempt).

12. **UI extensions delivered over the data channel.** `dbus-flashmq` scans
    `/data/apps/enabled/`, publishes an app list and, on request, streams each
    app's blob as base64 chunks over MQTT, so a *remote* browser gets the
    device's local UI modifications **[S]** `dbus-flashmq/src/guicustomizations.h:44-70`.
    *Why it earns its place:* it is Victron's answer to the problem their own
    README admits the WASM created — that editing QML on the rootfs no longer
    affects the browser (§2.2). *Plausible for mos:* only if mos ever ships a
    client-side UI; a server-rendered webd has the opposite problem.

13. **Localisation as build infrastructure, not an afterthought.** 19 shipped
    languages plus the source catalogue, with `//%` source strings in the QML
    and `make download_translations` / `upload_translations` targets driving an
    external translation service **[S]** `gui-v2/i18n/`,
    `gui-v2/CMakeLists.txt:9-19`. *Why it earns its place:* retrofitting i18n
    into a UI that was written without translation markers is a rewrite.
    *Plausible for mos:* cheap now, expensive later; nothing in the mos design
    docs addresses UI language.

14. **The UI degrades itself under load and idles gracefully.** Above 90% CPU
    the Brief page closes its graphs and tells the operator why, via a toast
    reading *"System load high, hiding graphs to reduce CPU load"* **[S]**
    `gui-v2/pages/BriefPage.qml:38-48`; animations and timers are gated on
    `ScreenBlanker.blanked` and application visibility **[S]**
    `gui-v2/Global.qml:28-29`. *Why it earns its place:* an appliance UI shares
    a small SoC with the work the appliance actually exists to do.
    *Plausible for mos:* the kiosk path (`docs/design/display.md:16-24`) has the
    same constraint, and a browser rendering webd has no equivalent governor.

15. **A configurable start page with an auto-select mode.** Nine start-page
    choices, plus a mode in which the UI adopts whatever page you last left it
    on, plus an alarm override that beats both (§4.1). *Why it earns its place:*
    a wall-mounted appliance is looked at, not operated; the right first screen
    is installation-specific. *Plausible for mos:* only meaningful once mos has
    more than one screen worth landing on.

## 8. Unverified / gaps

### 8.1 Things I could not verify at all

- **Nothing was observed on hardware.** Venus OS was not installed, flashed,
  emulated or run, per the campaign constraint. Every behavioural claim above is
  read out of source, out of Victron documentation, or labelled as inference.
- **Whether "Remote Console on LAN" is a switch in gui-v2, and its default.**
  gui-v1 is widely described as having a `/Settings/System/RemoteConsoleOnLan`
  setting. I grepped `gui-v2/pages`, `gui-v2/components`,
  `meta-victronenergy/meta-venus/recipes-httpd` and `venus-platform/src` for
  `RemoteConsoleOnLan` and `remoteconsole` and found only the nginx
  `auth_request` sub-request name `@remoteconsole-authproxy`. I could not find
  any setting that disables the served UI, and I fetched
  `https://www.victronenergy.com/media/pg/Cerbo_GX/en/accessing-the-gx-device.html`,
  which does not state a default for it. **My best reading is that under gui-v2
  the web UI is always served and the security profile is the only control, but
  I could not confirm this and it should not be relied on.**
- **`veutil` semantics.** `VeQuickItem`, `VeQItemDbusProducer` and
  `VeQItemMqttProducer` live in the `victronenergy/veutil` submodule, which I
  did not clone. The meanings of `valid`, `state`, `setValue` return semantics
  and local-value caching are asserted from their *uses* in gui-v2 and from the
  `SettingSync.qml` header comment, not read from their implementation.
- **The PHP authentication implementation.** Session cookies, the login form,
  `/auth/test.php` semantics, `/auth/generate-token` and the token-user model
  live in `victronenergy/venus-www` (pinned at SRCREV
  `18584ca9750b4024d133e17196dcc3c32d0daeac` **[S]**
  `meta-victronenergy/meta-venus/recipes-httpd/nginx-auth/venus-www.bb:9`),
  which I did not clone. §3.1 describes only what nginx does, not what the PHP
  decides.
- **Effective TLS configuration.** `nginx.conf` leaves `ssl_protocols`
  commented out and substitutes `%SSL_CIPHERS` from
  `${OPENSSL_CIPHERSTRING_COLONS}` at build time **[S]**
  `meta-victronenergy/meta-venus/recipes-httpd/nginx/nginx_%.bbappend:41`. I did
  not resolve that variable, so I cannot state which TLS versions or ciphers a
  shipped device offers. Whether HTTP/2 is enabled is likewise unverified.
- **The number of settings paths in the Venus tree.** Not statically
  enumerable: localsettings creates paths on demand via `AddSetting`, so the
  tree is the union of whatever the installed drivers ask for **[D]**
  `localsettings/README.md:16-33`. Any count of "how many settings Venus has"
  would be fabricated.
- **Which translations ship in a release image.** The CMake targets download
  translations from an external service at build time using a token
  **[S]** `gui-v2/CMakeLists.txt:9-19`, so the 19 `.ts` files in the repository
  are the tracked set, not necessarily the shipped set.
- **gui-v1 internals.** Closed source. Every comparison to gui-v1 in §2.4 rests
  on Victron's own README text, not on reading it.
- **VRM portal server behaviour**: the broker farm, the SSH-tunnel HTTP proxy,
  shard allocation and token issuance are Victron-hosted and not public. §3.2
  describes only the client half, read from `gui-v2/src/main.cpp` and
  `backendconnection.cpp`.

### 8.2 Things I verified only partially

- **The `--dbus-default` address.** On a desktop build the D-Bus source
  defaults to `tcp:host=localhost,port=3000` **[S]** `gui-v2/src/main.cpp:347`.
  On the device the recipe passes no `--dbus` argument at all
  (`DAEMONTOOLS_SCRIPT` is just `exec .../venus-gui-v2` **[S]**
  `gui-v2_1.3.15.bb:31`), so the empty address presumably means the system bus
  **[I]** — consistent with `initDBusConnection` selecting `QDBusConnection::SystemBus`
  when no address is given **[S]** `gui-v2/src/backendconnection.cpp:184-199`,
  but I did not trace the empty-string branch line by line.
- **Navigation depth.** The chain in §4.4 was traced through the QML by
  following `pushPage` calls; I did not count taps on a device, and pages that
  branch on hardware or on ESS/DVCC configuration may be deeper. §4.4 is a
  concrete lower bound for a *routine* task, not the maximum depth in the
  product.
- **The `/debug` endpoint** that `wasm/index.html` probes with a HEAD request to
  decide whether to enable performance instrumentation **[S]**
  `gui-v2/wasm/index.html:243-256`. I found no nginx location serving it in
  `meta-victronenergy`; `nginx-testmode.conf` is a different, restricted
  configuration. So the instrumentation is presumably off on a shipped device
  **[I]**, but I could not find where `/debug` would come from.
- **`ConsoleTerminal.qml`** imports a third-party `jhofstee.nl.VTerm` module
  **[S]** `gui-v2/components/ConsoleTerminal.qml:8`. I could not find any page
  in `pages/` that instantiates it, so I do not know whether a terminal is
  reachable in a shipped build, and I have not investigated it further because
  shell access belongs to sibling task B.

### 8.3 Contradictions found in the sources themselves

- `start-nginx.sh:25` says security profile 3 should serve a "select a profile"
  page; the code serves the full plaintext site (§3.1).
- `SettingSync.qml:15-17` documents that the component should be unnecessary
  because `VeQuickItem` already has the feature, and exists only because the
  MQTT producer does not implement it — i.e. the remote transport, not the
  design, forced the component into existence.

### 8.4 Pointers for sibling task B (recorded, not analysed)

Per the campaign constraint I did not analyse SSH/root access, remote support
tunnelling or firmware-update UX. Sources encountered in passing:

- `gui-v2/pages/settings/PageSettingsAccessAndSecurity.qml:262-343` — root
  password field, "Enable SSH on LAN" switch bound to
  `settings/Settings/System/SSHLocal`, "Remote support" switch bound to
  `settings/Settings/System/RemoteSupport`, tunnel online/offline and
  `RemoteSupportIpAndPort` rows, and the logout button.
- `gui-v2/pages/settings/PageSettingsFirmware.qml`,
  `PageSettingsFirmwareOnline.qml`, `PageSettingsFirmwareOffline.qml`,
  `PageSettingsRootfsSelect.qml`, and `gui-v2/components/FirmwareUpdate.qml`.
- `venus-platform/src/updater.cpp` and `src/token_users.cpp`.
- `meta-victronenergy/meta-venus/recipes-connectivity/openssh/` (including
  `generate_authorized_keys.sh`) and
  `meta-victronenergy/meta-bsp/recipes-bsp/machine-runtime-conf/files/ve-set-passwd`.
- `venus.wiki/swupdate-project.md`, `venus.wiki/swupdate-migration-notes-for-developers.md`,
  `venus.wiki/modifying-a-cerbo-swu-file.md`.
- `https://github.com/victronenergy/venus/issues/836` ("[Security] Root login by
  default") and `https://github.com/victronenergy/venus/issues/1255` ("Change
  settings around VRM / ssh tunnel / remote access") — both surfaced by search,
  neither opened or verified.
