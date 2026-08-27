# Research: Venus OS — system access and firmware update UX

> Sourced study of Victron Energy's Venus OS (GX product range) covering shell
> access, vendor remote support, shipped security defaults, and the firmware
> update/rollback experience. Companion to the Venus OS web-UI study; the two
> are intended to be merged. Sections are self-contained and renumberable.

**Companion document:** `docs/research/venus-os-ui.md` covers the other half of
the same Venus study — what gui-v2 is as an artefact, how it is served on the
LAN and reached remotely, and the information architecture of its landing
screen, navigation and settings tree. The merge the note above anticipates was
measured and dropped; the decision and its evidence are in
`docs/task/RFCT-045.md`.

## 1. Scope and method

Research date: **2026-08-19**. Venus OS is the closest shipping analogue to mos:
an appliance Linux with a read-only rootfs, a dual-rootfs updater, a locked-down
default network posture, and a vendor support channel — all driven from a
settings tree rather than from `/etc`.

**What is covered.** SSH and root access, the local serial console, the vendor
remote-support tunnel and the VRM remote-console path, the access-affecting
shipped defaults, and the online/offline firmware update and rollback UX.

**Not covered** (deliberately): the web UI's technology and information
architecture (owned by the sibling Venus web-UI study); VRM portal server-side
features; anything requiring a device — nothing here was flashed, emulated or
run. Where a behaviour could only be established by running a device, it is in
§7 rather than asserted.

**Evidence tags.** Every non-obvious claim below carries one of:

- **[DOC]** — stated in Victron's own documentation, with the URL.
- **[SRC]** — read out of a public Victron repository, cited `repo/path:line`.
- **[INF]** — my inference from the cited evidence. Never a fact.

**Primary sources, in the order they were trusted.**

1. Public Victron source repositories, shallow-cloned read-only and read at
   these commits:

   | Repository | Commit | Date |
   |---|---|---|
   | `victronenergy/meta-victronenergy` | `c4836d7` (tag `v3.80~41`) | 2026-08-10 |
   | `victronenergy/venus-access` | `488cc01` | 2026-01-26 |
   | `victronenergy/venus-platform` | `735e458` | 2026-07-15 |
   | `victronenergy/gui-v2` | `97f659b` | 2026-08-13 |
   | `victronenergy/localsettings` | `3aac232` (v1.76) | 2026-04-16 |

2. Official Victron documentation: the Venus OS root-access page
   (<https://www.victronenergy.com/live/ccgx:root_access>, page footer says last
   modified 2026-06-01) and the Cerbo GX manual
   (<https://www.victronenergy.com/media/pg/Cerbo_GX/en/index-en.html>), whose
   chapters are cited individually below.
3. Victron's own release announcement for v3.50, the release that reshaped the
   local-network security model.

Where documentation and source disagree, both are given and the disagreement is
named. One upstream non-Victron source is cited where it decides a claim:
OpenEmbedded-core's `rootfs-postcommands.bbclass`.

---

## 2. SSH and root access

### 2.1 The control, and where it lives

SSH is enabled from **Settings → General → "Enable SSH on LAN"** [DOC]
(<https://www.victronenergy.com/live/ccgx:root_access>, §4.3: *"To login via
ssh, enable SSH on LAN (Settings → General)"*). In the v3.50+ UI the switch sits
under **Settings → General → Access & Security** and writes the D-Bus setting
`/Settings/System/SSHLocal`; it is only shown at access level **Superuser**
[SRC] (`victronenergy/gui-v2/pages/settings/PageSettingsAccessAndSecurity.qml:284-289`).

Reaching Superuser is itself a deliberate speed bump: set the access level to
"User and installer" with the **fleet-wide constant password `ZZZ`**, then
press-and-hold the right button (or drag-and-hold the menu for five seconds on a
touchscreen) until the level flips to Superuser [DOC] (root-access page §4.1).
The `ZZZ` constant and the hold-to-escalate gesture are both hard-coded in the
UI [SRC] (`gui-v2/pages/settings/PageSettingsAccessAndSecurity.qml:29-47,80-86`).

Before Venus v2.40 there was no separate SSH switch at all — enabling **Remote
Support** also started sshd [DOC] (root-access page §4.3). The settings
migration that split them is still in the tree and sets `SSHLocal=1` for any
device that had `RemoteSupport=1` at the time [SRC]
(`victronenergy/localsettings/migrate.py:137-150`, comment: *"Enable ssh on LAN
since it was enabled by RemoteSupport"*).

### 2.2 It is not per-interface

The setting is a single global boolean. The service that acts on it calls a
shell helper — `firewall allow tcp ssh` when on, `firewall deny tcp ssh` when
off [SRC] (`victronenergy/venus-access/src/application.cpp:115-126`) — and that
helper builds its iptables match as `-p $proto --dport $port` with **no
interface predicate at all** [SRC]
(`meta-victronenergy/meta-venus/recipes-extended/iptables/files/firewall:27-45`).
There is no per-interface, per-address or per-subnet SSH control in Venus.

Two consequences worth separating:

- **sshd's lifetime and LAN reachability are different things.** `venus-access`
  starts sshd when *either* SSH-on-LAN is enabled *or* a tunnel is wanted, and
  starts the tunnel service only for the tunnel case [SRC]
  (`venus-access/src/application.cpp:91-99`). So on a device with SSH-on-LAN
  **off** but Remote Support **on**, sshd is running; what keeps the LAN out is
  the iptables REJECT rule, not the absence of a daemon.
- **The base firewall is not default-deny.** The boot-time ruleset creates one
  empty `new-conn` chain and sends new connections to it; it never sets a DROP
  policy on INPUT [SRC]
  (`meta-venus/recipes-extended/iptables/files/rules:1-5`,
  `.../files/init:1-8`). Venus's firewall is an explicit per-service deny list,
  so anything listening that nobody thought to deny is reachable on the LAN.

### 2.3 The root password

Set from **Settings → General → Set root password** [DOC] (root-access page
§4.2). Documentation states a **6-character minimum**; the shipping v3.50+ UI
enforces **8** [SRC]
(`gui-v2/pages/settings/PageSettingsAccessAndSecurity.qml:263-282`). Treat the
doc as stale on this point.

The implementation is the interesting part: setting the password first runs
`swupdate-scripts/resize2fs.sh` — which remounts the read-only rootfs
read-write and grows it — and then pipes `root:<password>` into `chpasswd`
[SRC] (`victronenergy/venus-platform/src/application.cpp:1000-1021`). Victron
documents the visible consequence themselves: *"the root password is stored on
the rootfs, causing it to be marked as modified. This is normal, and visible in
the UI"* [DOC] (root-access page §4.2).

### 2.4 What a factory device ships with

- **SSH: closed.** `/Settings/System/SSHLocal` is registered with default `0`
  [SRC] (`venus-access/src/application.cpp:14`, the `add(path, default, min,
  max)` call is `add("System/SSHLocal", 0, 0, 1)`).
- **Remote support: off.** Same registration, default `0`
  (`venus-access/src/application.cpp:13`), and stated as *"Remote support is
  disabled by default"* [DOC] (Cerbo GX manual §20.2.16,
  <https://www.victronenergy.com/media/pg/Cerbo_GX/en/troubleshooting.html>).
- **Console: off**, and only registered at all when `/dev/ttyconsole` exists
  [SRC] (`venus-access/src/application.cpp:11-12`).
- **Root has no usable password.** The image is built without the
  `empty-root-password` image feature [SRC]
  (`meta-venus/recipes-images/venus-image.inc:11-12`, which sets only
  `package-management ssh-server-openssh` and `read-only-rootfs`), and no
  Venus recipe sets a root password anywhere in the layer. In OpenEmbedded-core
  that means `zap_empty_root_password` runs and rewrites `root::` to `root:*`
  in `/etc/shadow`
  (<https://github.com/openembedded/openembedded-core/blob/master/meta/classes-recipe/rootfs-postcommands.bbclass>,
  lines 7-8 and 252-259). **[INF]** a factory device therefore ships with the
  root account locked, and the documented "create a temporary root password"
  step is what unlocks it.

That inference matters because the shipped `sshd_config` is unusually
permissive: `PermitRootLogin yes` and — explicitly uncommented, where OpenSSH's
own default is `no` — `PermitEmptyPasswords yes` [SRC]
(`meta-venus/recipes-connectivity/openssh/sshd_config:42,66`). **[INF]** the
only thing standing between that config and passwordless root over SSH is the
`*` in the shadow entry; nothing in the sshd configuration itself.

### 2.5 Authorized keys

`sshd_config` accepts three key files [SRC]
(`meta-venus/recipes-connectivity/openssh/sshd_config:49`):

```
AuthorizedKeysFile	.ssh/authorized_keys .ssh/authorized_keys2 /run/ssh_support_keys
```

Victron's documentation names the third file as
`/usr/share/support-keys/authorized_keys` [DOC] (root-access page §4.4:
*"The third file contains the keys we use for Remote Support login"*). Source
reconciles the two: `/run/ssh_support_keys` is a **symlink created only while
Remote Support is enabled**, and deleted when it is turned off [SRC]
(`venus-access/src/application.cpp:101-113`). Victron's support keys are
therefore not standing authorized keys — they are armed and disarmed by the
Remote Support toggle.

There is also an `AuthorizedKeysCommand`, but it is scoped: the script
short-circuits to exit 0 for every user except `vnctunnel` [SRC]
(`sshd_config:51-52`;
`meta-venus/recipes-connectivity/openssh/generate_authorized_keys.sh:16-22`).
For that one account it emits a `restrict,port-forwarding,permitopen="..."` key
line whose permitted forward targets are computed at login time, and only when
the VRM portal setting is `full` [SRC] (`generate_authorized_keys.sh:96-127`).

The device's own **SSH host keys** are generated on first start into
`/data/keys/` and passed to sshd with `-h` from there, not from `/etc/ssh`
[SRC] (`meta-venus/recipes-connectivity/openssh/start-sshd.sh:3-34,43`).

Whether a root key is installed is surfaced to the UI as a first-class
diagnostic: `venus-platform` publishes `SshKeyForRootPresent` from the existence
of `/data/home/root/.ssh/authorized_keys` [SRC]
(`venus-platform/src/modifications_check.cpp:14,94-101`).

### 2.6 Persistence — reboot

**Everything survives a reboot, and this is a property of where the state
lives, not of a reconciler.**

- Settings (`SSHLocal`, `RemoteSupport`, `Console`) are persisted by
  `localsettings` to `settings.xml` under `/data/conf` — the daemon is started
  with `--path=/data/conf` [SRC]
  (`meta-victronenergy/meta-ve-software/recipes-ve/localsettings_1.76.bb:17`).
  `/data` is a separate partition [DOC] (root-access page §2). `venus-access`
  re-reads the settings at every start and installs or removes the daemontools
  service accordingly [SRC] (`venus-access/src/application.cpp:91-99,128-154`),
  so the service state is reconstructed each boot from persisted settings.
- The root password lives in `/etc/shadow` on the **active rootfs** [SRC]
  (`venus-platform/src/application.cpp:1000-1021`), which is a normal disk
  partition — it survives reboot.
- Host keys live on `/data` [SRC] (`start-sshd.sh:43`), so a device's SSH host
  identity is stable across reboots.

### 2.7 Persistence — firmware update

**This is where Venus splits, and the split is asymmetric.**

- **The root password is destroyed.** Victron say so directly: *"Note that the
  root password will be reset by a firmware update. The reason is that the
  passwd file is on the rootfs, which is fully replaced by an update."* [DOC]
  (root-access page §4.2). The same page generalises it: *"Changes made to the
  rootfs will be lost in case of a firmware update... the complete rootfs is
  overwitten during an update"* (§3).
- **SSH keys survive.** *"Using a ssh key for authentication, instead of a root
  password, has the advantage that it isn't lost during a firmware update. The
  keys are stored on the /data partition."* [DOC] (root-access page §4.4),
  corroborated by the `/data/home/root/.ssh/authorized_keys` path in source
  [SRC] (`venus-platform/src/modifications_check.cpp:95`).
- **Host keys survive** — `/data/keys` [SRC] (`start-sshd.sh:3-10,43`). A
  firmware update therefore does not trip client host-key warnings.
- **The SSH-enabled setting survives**, because it is on `/data` (§2.6). Venus
  does *not* re-close SSH on update.

**[INF]** The operator-visible outcome of those four facts together: a device
that was reachable by password and gets a firmware update comes back with sshd
still listening on the LAN and a locked root account — reachable only by
whoever installed a key beforehand. Victron's stated advice is exactly that:
*"use it to login only the first time, and then install a public ssh key(s).
Thereafter login with the keys"* [DOC] (root-access page §4.2).

Everything else Victron want to survive an update is pushed onto `/data` by the
same logic: `/data/rc.local` and `/data/rcS.local` are sourced early and late in
boot, and a `venus-data.*.tar.gz` on removable media is unpacked into `/data` at
boot [DOC] (root-access page §5.1).

### 2.8 Local console / serial

Every GX device except the Color Control GX has a **dedicated serial console
header at 115200 baud**, with per-model pinouts documented down to the wire
colours [DOC] (root-access page §7 and §7.1-7.7). Victron frame it as *"an
alternative to connecting to the commandline over ssh"* — same root account,
same credentials, no separate authentication path.

Separately, a `Settings/Services/Console` toggle (default off) controls a getty
service named `vegetty` on devices that expose `/dev/ttyconsole` [SRC]
(`venus-access/src/application.cpp:11-12,77-81`). The distinction between that
setting and the always-present hardware console header could not be resolved
from the sources read (see §7).

### 2.9 Where this contradicts `docs/design/access.md`

- mos names *"the Victron-style 'password + UI toggle'"* as its phase-1 UX
  reference (`docs/design/access.md:153`), but mos's per-device password is
  minted on the device and persisted on STATE via a `/etc/shadow` symlink
  (`docs/design/ro-root.md:257,283`) — deliberately surviving an image
  replacement, which is precisely the behaviour Venus does **not** have
  (root-access page §4.2, quoted in §2.7). The toggle is the borrowed part; the
  credential lifetime is the opposite.
- mos's META lockdown bit is one-way and *"factory reset deliberately does NOT
  clear it"* (`docs/design/access.md:310-313`). Venus's
  stated policy is the direct inverse: *"we as Victron Energy always want an
  end-user with physical access to the device to be able to gain access to the
  device again after he has himself accidentally locked out"* [DOC]
  (root-access page §6.1).

---

## 3. Remote support and tunnelling

Venus has **two distinct remote paths** that are easy to conflate. They share
transport machinery and differ in who is on the other end.

### 3.1 Remote Support — the vendor tunnel

- **Control**: a single switch, **Settings → General → Remote support**, writing
  `/Settings/System/RemoteSupport` [SRC]
  (`gui-v2/pages/settings/PageSettingsAccessAndSecurity.qml:291-297`). Note the
  asymmetry with the SSH switch three items above it: the SSH switch carries
  `showAccessLevel: Superuser`, the Remote Support switch carries **no access
  level restriction at all** [SRC] (same file, lines 288 vs 291-297).
- **Who initiates**: the device. It opens an **outbound reverse SSH connection**
  to `supporthosts.victronenergy.com`, trying **port 22, then 80, then 443**,
  using the first that works and retrying all of them on loss [DOC] (Cerbo GX
  manual §20.2.15). The DNS record resolves to several geo-located servers.
  *"No port-forwarding or other internet router configuration is necessary"*
  [DOC] (same).
- **What it exposes while enabled**: *"Enabling remote support grants Victron
  Engineers access the device for diagnostics and troubleshooting over the
  reverse SSH tunnel"* [DOC] (Cerbo GX manual §20.2.16). Concretely, and from
  source: enabling it (a) starts sshd even if SSH-on-LAN is off, (b) starts the
  `ssh-tunnel` service, and (c) links Victron's support key file into
  `/run/ssh_support_keys`, which is one of sshd's `AuthorizedKeysFile` entries
  [SRC] (`venus-access/src/application.cpp:91-99,101-113`;
  `sshd_config:49`). Turning the switch off reverses all three in the same
  handler.
- **What the operator sees while it is on**: two extra read-only rows appear —
  "Remote support tunnel: online/offline" and "Remote support IP and port",
  the latter bound to `/Settings/System/RemoteSupportIpAndPort` [SRC]
  (`gui-v2/pages/settings/PageSettingsAccessAndSecurity.qml:299-313`). The
  device tells you the rendezvous address support will connect through.
- **Persistence**: the setting is on `/data` (§2.6), so **it survives reboot and
  survives a firmware update**, and stays on until somebody turns it off. No
  expiry, no auto-disable, and no session count was found in any source read
  (see §7).
- **How to turn it off**: the same toggle. Victron's hardening checklist also
  scripts it via D-Bus alongside the other services [DOC] (root-access page
  §6.3).

### 3.2 Remote Console on VRM — the customer path

This is a different feature with a different audience: it renders the device's
own UI to a logged-in VRM user.

- **Control**: **Settings → VRM → VRM Portal**, with three values — **Full
  (default) / Read-only / Off** — plus the separate Remote Console enable [DOC]
  (Cerbo GX manual §13.6,
  <https://www.victronenergy.com/media/pg/Cerbo_GX/en/vrm-portal.html>). The
  same chapter's table maps each value onto data transmission, the Controls
  pane, VictronConnect-Remote, and **remote firmware updates from VRM** — all
  three of which are disabled at Read-only and Off.
- **Authorisation is server-side, by VRM role**: under the *Secured* profile,
  *"Admin and Technician can access without asking for a password. User has no
  access."* [DOC] (Cerbo GX manual §4.9, the Network-security-profile table
  image at
  <https://www.victronenergy.com/media/pg/Cerbo_GX/en/the-new-user-interface.html>).
  The device password is not what gates VRM access.
- **Transport, and why it is not always the SSH tunnel**: `venus-platform`
  raises `ConnectVrmTunnel` only when the VRM portal mode is `full` **and** one
  of a short list of things needs a tunnel — the old gui-v1 with VNC-on-VRM
  enabled, a Node-RED or Signal K service on a Large image, or a detected EV
  charger [SRC]
  (`venus-platform/src/security_profiles.cpp:223-291`, method
  `VrmTunnelSetup::checkVrmTunnel`). When it is raised, `venus-access` starts
  the same sshd and `ssh-tunnel` services as Remote Support does [SRC]
  (`venus-access/src/application.cpp:91-99,147-148`). With the v3.50+ UI none of
  those conditions hold by default, and VRM traffic instead rides outbound
  **MQTT over TLS** to `mqtt-rpc.victronenergy.com` and
  `mqtt{0..127}.victronenergy.com` on port 443 [DOC] (Cerbo GX manual
  §20.2.15). **[INF]** the reverse-SSH tunnel is on its way to being
  support-only.
- **Read-only mode still tunnels for support**: *"In 'read-only' mode: The
  outbound SSH connection described above is also enabled ... but only when
  'remote support' is enabled"* [DOC] (Cerbo GX manual §20.2.15).

### 3.3 Compared to `docs/design/remote-management.md`

mos plans SideroLink — a device-dialled WireGuard tunnel managing the fleet
*"without an inbound port"* (`docs/design/remote-management.md:71`). Venus reaches the same
topology with reverse SSH over 22/80/443, and additionally publishes the
rendezvous endpoint back into the device UI (§3.1) — which mos's design does not
currently describe an equivalent of.

---

## 4. Security posture

### 4.1 Shipped defaults

Every row is a control I could verify; the last column is what an unauthenticated
attacker on the same LAN can do against a factory device.

| Control | Setting path | Shipped default | Reachable from the LAN on a factory device | Source |
|---|---|---|---|---|
| SSH on LAN | `/Settings/System/SSHLocal` | **off** | no — iptables REJECT on dport 22 | [SRC] `venus-access/src/application.cpp:14,115-126` |
| Remote support tunnel | `/Settings/System/RemoteSupport` | **off** | n/a (outbound only) | [SRC] `venus-access/src/application.cpp:13`; [DOC] Cerbo §20.2.16 |
| Console (getty) | `/Settings/Services/Console` | **off** | n/a (local) | [SRC] `venus-access/src/application.cpp:11-12` |
| Network security profile | `/Settings/System/SecurityProfile` | **Secured** on units shipped with v3.50+ | HTTPS only, password required | [DOC] Cerbo §4.9 |
| Device (network access) password | `/data/conf/vncpassword.txt` | the **six-digit random PIN printed on the enclosure**, same as the Bluetooth PIN | must be guessed (10^6) | [DOC] Cerbo §4.9; [SRC] `venus-platform/src/security_profiles.cpp:8` |
| Remote Console on LAN | `/Settings/System/VncLocal` + profile | reachable, password-gated under *Secured* | HTTPS login page | [DOC] Cerbo §4.9, §20.2.15 |
| HTTP webserver | — | **on**, redirects to HTTPS under *Secured* | yes (redirect only) | [DOC] Cerbo §21.3, §4.9 note ** |
| HTTPS webserver | — | **on** | yes — login page / Remote Console | [DOC] Cerbo §21.3 |
| MQTT over websockets | — | **on** (needed by the new UI) | yes, but the webserver gates access | [DOC] Cerbo §21.3; [SRC] `venus-platform/src/security_profiles.cpp:346-350` |
| MQTT on LAN (1883/8883) | `/Settings/Services/MqttLocal` | **off** — *"Disable LAN socket access by default, unless explicitly enabled"* | no | [SRC] `venus-platform/src/security_profiles.cpp:340` |
| Modbus TCP (502) | `/Settings/Services/Modbus` | off | no | [DOC] Cerbo §20.2.15 ("When enabled…"), root-access §6.3 |
| mDNS / SSDP / DNS-SD | — | **on** | yes — device is discoverable as `venus.local` | [DOC] Cerbo §21.3 |
| WiFi access point | `/Settings/Services/AccessPoint` | **on**, WPA key printed on the enclosure | yes, within radio range | [DOC] Cerbo §8.2 |
| Bluetooth LE | `/Settings/Services/Bluetooth` | **on**; PIN `000000` before serial HQ2242, random 6-digit after | network setup only | [DOC] Cerbo §8.1 |
| VRM portal mode | `/Settings/Network/VrmPortal` | **Full** | n/a (outbound) | [DOC] Cerbo §13.6 |
| Automatic firmware update | `/Settings/System/AutoUpdate` | **disabled** | n/a | [DOC] Cerbo §10.2.1 |
| Access level | `/Settings/System/AccessLevel` | User; "User & installer" unlocked by the constant `ZZZ` | n/a (local UI) | [DOC] root-access §4.1; [SRC] `gui-v2/…/PageSettingsAccessAndSecurity.qml:80-86` |

### 4.2 Which services actually ship listening

Victron publish this as a compliance table (RED 3.3d / EN 18031-1) [DOC] (Cerbo
GX manual §21.3,
<https://www.victronenergy.com/media/pg/Cerbo_GX/en/technical-specifications.html>).
The enumerated communication services are: **HTTP webserver** (landing page that
forwards to HTTPS), **HTTPS webserver** (login page and Remote Console), **MQTT
via websockets** (data exchange between device and Remote Console), **DHCP** and
**DNS** on the WiFi AP, **SSDP / DNS-SD**, and **mDNS** (`venus.local`).

Plainly: **a factory GX device ships with a web server and a service-discovery
stack listening on every network it is attached to, and nothing else.** SSH,
Modbus TCP and the MQTT TCP sockets are all off until switched on.

### 4.3 What Victron document as deliberately insecure, and why

- **Physical access is an intentional escape hatch.** *"The first thing to keep
  in mind is that we as Victron Energy always want an end-user with physical
  access to the device to be able to gain access to the device again after he
  has himself accidentally locked out. So the best solution to keep people from
  tampering with a Venus device is to block physical access to the device."*
  [DOC] (root-access page §6.1). Their recommended mitigation is a lockable
  rack, not a device-side lockdown bit.
- That escape hatch is implemented: a long press of the physical button resets
  all passwords including the network access password, and a "reset to factory
  defaults" USB stick does the same [DOC] (Cerbo §4.9, "Recovering a lost
  network access password"). The long press is wired to a `network-reset` helper
  [SRC] (`venus-platform/src/application.cpp:934-940`).
- **An "Unsecured" profile is a supported, selectable state** — *"No password
  and the network communication is not encrypted"* — offered in the UI next to
  Secured and Weak [SRC]
  (`gui-v2/pages/settings/PageSettingsAccessAndSecurity.qml:147-153,244-246`),
  and documented as such [DOC] (Cerbo §4.9 table image).
- **`PermitEmptyPasswords yes`** is set explicitly in the shipped sshd
  configuration [SRC] (`sshd_config:66`), overriding OpenSSH's `no` default. No
  Victron document explains it; see §2.4 for why it is **[INF]** not currently
  exploitable, and §7 for what that leaves unverified.
- **No image signature on firmware.** Venus's swupdate is built without
  `CONFIG_SIGNED_IMAGES` (or any hash/encryption option) in every machine
  defconfig read [SRC]
  (`meta-venus/recipes-support/swupdate/files/{k3,ccgx,rpi,sunxi}/defconfig`,
  each containing only `CONFIG_HW_COMPATIBILITY=y` and `CONFIG_DOWNLOAD=y` among
  the relevant options). Update authenticity therefore rests on HTTPS transport
  to `updates.victronenergy.com` [SRC]
  (`meta-venus/recipes-support/swupdate-scripts/files/check-updates.sh:298`) —
  and, for the offline path, on nothing but physical possession of the SD card.
- **The escalation password `ZZZ` is a fleet-wide constant** [DOC] (root-access
  §4.1) — the exact pattern `docs/design/access.md:153` forbids for mos
  ("Fleet-wide constants are forbidden").

---

## 5. Firmware update UX

### 5.1 Storage model

*"The disk on a GX device ... is split in to multiple partitions: boot, rootfs1,
rootfs2, data"*, and *"Venus OS employs a so-called dual boot system ... two
copies of the operating system, one active and one standby"* [DOC] (root-access
page §2). The rootfs is mounted read-only by default and is only 5% free,
because the image is written as a filesystem image and not expanded [DOC]
(root-access page §5.2); the image is built with the `read-only-rootfs` feature
[SRC] (`meta-venus/recipes-images/venus-image.inc:12`).

### 5.2 The online path

**Settings → General → Firmware → Online updates** [DOC] (Cerbo GX manual
§10.2.1, <https://www.victronenergy.com/media/pg/Cerbo_GX/en/firmware-updates.html>).
The page offers three radio groups and a check button [SRC]
(`gui-v2/pages/settings/PageSettingsFirmwareOnline.qml`):

- **Auto update** → `/Settings/System/AutoUpdate`: *Disabled / Check only /
  Check and download only (read-only in the UI) / Check and update* [SRC]
  (lines 17-31; enum in `gui-v2/src/enums.h:692-698`). The updater script reads
  the same setting and exits immediately on `0` [SRC]
  (`check-updates.sh:178-189`). Victron's own recommendation: *"For most
  systems, we recommend leaving automatic updates disabled (which is also the
  factory default). Instead, perform updates during scheduled maintenance"*
  [DOC].
- **Update feed** → `/Settings/System/ReleaseType`: *Official release / Beta
  release / Testing (Victron internal) / Develop (Victron internal)*, the last
  two gated to service-level access or read-only outright [SRC]
  (`PageSettingsFirmwareOnline.qml:33-49`). The script maps these to
  `release / candidate / testing / develop` and builds the URL
  `https://updates.victronenergy.com/feeds/venus/${feed}/images/${machine}`
  [SRC] (`check-updates.sh:268-302`). The four-feed model dates back to the
  original project plan (<https://github.com/victronenergy/venus/wiki/swupdate-project>,
  *"keep the four feeds: develop, testing, candidate, release"*).
- **Image type** → normal or **Large** (adds Node-RED and Signal K) [SRC]
  (`PageSettingsFirmwareOnline.qml:51-64`); switching image type forces a
  reinstall even at the same version [SRC] (`check-updates.sh:281-292`).

Automatic checking is a boot-time job, not a daemon: `/etc/rc5.d/S99check-updates.sh`
sleeps **300 seconds** after boot and then runs `check-updates.sh -auto` [SRC]
(`meta-venus/recipes-support/swupdate-scripts/check-updates.init:11-15`,
installed by `swupdate-scripts.bb:48-51`). The `-delay` mode adds a random sleep
of up to **3600 seconds** *"to prevent thousands of units starting the download
at the same time"* [SRC] (`check-updates.sh:190-194`).

Two robustness details worth noting because they are cheap and not obvious: the
downloader resumes with `-t 30 -r 3` [SRC] (`check-updates.sh:355-359`), and to
stop a resume from stitching together two different builds, the script rewrites
the URL to the **version-stamped filename** before downloading [SRC]
(`check-updates.sh:19-34,331`). Compatibility is enforced twice — a
`hardware-compatibility` list inside the `.swu` and a `-H machine:board-compat`
argument to swupdate [SRC] (`check-updates.sh:78-95,361-362`).

Typical scale, from Victron: *"The size of the download typically is around
90MB. After download it will install the files which can take up to 5 minutes."*
[DOC] (Cerbo GX manual §20.2.11).

### 5.3 The offline path

Put the `.swu` in the **root directory** of a FAT-formatted USB stick or microSD
card, insert it, then **Settings → General → Firmware → Install firmware from
SD/USB → "Check for updates on SD/USB"**; the entry *"Firmware found"* appears
and is clicked to install [DOC] (Cerbo GX manual §10.2.2). The script scans
`/media/*` and prefers the unversioned filename, then the newest timestamped one
[SRC] (`check-updates.sh:206-235`).

Downgrade is supported on this path, with a documented caveat: *"While
backporting to older firmware versions is generally supported, some settings may
be reset to their default values during the process"* [DOC] (Cerbo §10.3.2).
Old images are published at
<https://updates.victronenergy.com/feeds/venus/release/images/>.

### 5.4 How progress, and failure, are shown

The whole update UX runs off two D-Bus items published by `venus-platform` —
`/Firmware/State` and `/Firmware/Progress` [SRC]
(`venus-platform/src/updater.cpp:148-186`).

- **Progress** is a real percentage, not a spinner: `venus-platform` connects to
  swupdate's own progress socket at `/tmp/swupdateprog`, reads swupdate's
  `progress_msg` struct, and republishes `dwl_percent` (or 100 on success) as
  `/Firmware/Progress` [SRC] (`venus-platform/src/updater.cpp:27-79`). The list
  item then reads *"Installing &lt;version&gt; &lt;n&gt;%"*, falling back to
  *"Installing &lt;version&gt;..."* when no percentage has arrived yet [SRC]
  (`gui-v2/pages/settings/PageSettingsFirmwareOnline.qml:72-103`).
- **State** is a small enum carried through a status file
  (`/var/run/swupdate-status`) that `check-updates.sh` writes at each step [SRC]
  (`check-updates.sh:97-106,263,307,314,345,350,364,368`) and that
  `venus-platform` watches and offsets into
  `Idle=1000, Checking, DownloadingAndInstalling, Rebooting` plus the three
  negatives `UpdateFileNotFound, ErrorDuringUpdating, ErrorDuringChecking`
  [SRC] (`veutil/inc/veutil/qt/firmware_updater_data.hpp:28-37`,
  <https://github.com/victronenergy/veutil/blob/master/inc/veutil/qt/firmware_updater_data.hpp>).
- **Every state transition raises a 10-second toast** with a specific string —
  *"Error while checking for firmware updates"*, *"Downloading and installing
  firmware X..."*, *"Error during firmware installation"*, *"Firmware
  installed, device rebooting"* — plus *"No newer version available"*, *"No
  firmware found"* and *"Firmware check timed out"* for the check outcomes
  [SRC] (`gui-v2/components/FirmwareUpdate.qml:74-143,236-254`). The check has a
  **15-second client-side timeout** [SRC] (same file, lines 49-54).
- **Failure leaves the running system untouched.** On a non-zero swupdate exit
  the script writes status `-2` and simply stops; it does not reboot and does
  not touch the boot selector [SRC] (`check-updates.sh:362-369`).

### 5.5 What happens to the UI/session across the update

On success the update script **reboots the device itself** [SRC]
(`check-updates.sh:363-365`). The UI's contract with that is explicit: on state
`Rebooting` it shows the "device rebooting" toast and deliberately does *not*
reload, waiting instead for a full disconnect/reconnect cycle and reacting to
the changed `/Firmware/Installed/Build` value, at which point the WebAssembly UI
reloads itself [SRC] (`gui-v2/components/FirmwareUpdate.qml:126-134,172-195`).
A ten-minute forced re-read of the installed build exists purely because *"VRM
sometimes won't provide the latest value to existing clients after a device
restart"* [SRC] (same file, lines 186-194).

### 5.6 A/B, and what rollback actually is

The dual-rootfs arrangement is real, and mechanically simple:

- `check-updates.sh` computes the inactive slot and passes swupdate the
  selector `-e "stable,copy$altroot"` [SRC] (`check-updates.sh:337-362`,
  `functions.sh:9-16`).
- The `sw-description` inside the `.swu` has a `copy1` and a `copy2` section,
  each writing the rootfs image to that slot's partition and then setting the
  **U-Boot environment variable `version`** to `1` or `2` [SRC]
  (`meta-venus/recipes-images/venus-swu/einstein/sw-description:18-57`; identical
  shape for k3 and the other machines). U-Boot uses `${version}` to pick both
  the kernel and the rootfs [SRC]
  (`meta-bsp/recipes-bsp/u-boot/u-boot-fw-utils/ccgx/u-boot.env:13,16`).
- The bootloader itself is **not** A/B: the `bootloader` section of the same
  `sw-description` writes U-Boot to one fixed offset with no second copy [SRC]
  (`.../einstein/sw-description:9-17`).
- At boot, `S98scan-versions.sh` mounts the *other* rootfs read-only (fsck'ing
  it first), reads its version file, and publishes both versions into
  `/var/run/versions` [SRC]
  (`meta-venus/recipes-support/swupdate-scripts/files/scan-versions.sh:8-37`) —
  which becomes `/Firmware/Installed/Version` and
  `/Firmware/Backup/AvailableVersion` [SRC]
  (`venus-platform/src/updater.cpp:226-242`).

**Rollback is a manual, operator-triggered slot switch.** *"Stored backup
firmware ... This feature allows you to switch between the current and previous
firmware version without requiring internet or SD-card access ... Click Press to
boot to start the stored version. The system will now boot the stored firmware,
and the current version will be saved as the new backup."* [DOC] (Cerbo GX
manual §10.3.1). The button writes `/Firmware/Backup/Activate`, which runs
`set-version.sh 2`, which does `fw_setenv version <other>` and reboots [SRC]
(`venus-platform/src/updater.cpp:108-113`;
`meta-venus/recipes-support/swupdate-scripts/files/set-version.sh:7-29`).

The UI guards it in two ways that are themselves informative [SRC]
(`gui-v2/pages/settings/PageSettingsRootfsSelect.qml:12,60-88`): the button is
disabled while Auto update is set to "Check and update" (*"Set auto update to
Disabled or Check only to enable this option"* — otherwise the device would
immediately re-update itself back), and it refuses while the network security
profile is still indeterminate.

### 5.7 What the UI says while a new version is running but unconfirmed

**Nothing, because there is no such state.**

Grepping the whole of `meta-victronenergy` for `bootcount`, `boot_count`,
`bootlimit`, `altbootcmd` and `rollback` returns no hits, and the
`sw-description` files set `version` unconditionally as part of a successful
install (§5.6) — there is no attempt counter, no "mark good", and no bootloader
watchdog that could demote a slot. `/Firmware/Backup/AvailableVersion` is purely
descriptive: it reports what is in the other partition, not a pending state.
**[INF]** if a newly installed Venus rootfs boots far enough to write the U-Boot
environment but then fails, nothing automatically returns the device to the
previous slot; recovery is the manual "Stored backup firmware" button, a
factory-reset USB stick, or the documented full reinstall from an installer SD
card [DOC] (Cerbo GX manual §19.1-19.2,
<https://www.victronenergy.com/media/pg/Cerbo_GX/en/reset-to-factory-defaults-and-venus-os-reinstall.html>).

Venus does have a *health* watchdog, but for the data partition rather than the
rootfs: a counter in the U-Boot environment (`data-failed-count`) records
read-only remounts of `/data`, reboots once to see whether it recovers, clears
itself after 24 hours of health, and marks the device broken on the second
failure [SRC]
(`meta-venus/recipes-core/initscripts/files/test-data-partition.sh:11-99`). The
shape mos wants for rootfs slots exists in Venus — just aimed elsewhere.

### 5.8 Where this differs from mos's A/B model

mos's slot counters are decremented **before** boot and refunded only when
userspace reaches a health gate and runs `rauc status mark-good`
(`docs/design/uboot-ab-handshake.md:418-444`). Venus has no counter and no health
gate at all (§5.7). This is not a contradiction in the mos documents — it is a
capability Venus simply does not have.

---

## 6. What Venus does in access/update that mos has no answer for

Ranked by how much of a real gap it closes, not by implementation cost. Each
entry says what Venus does, why it earns the rank, and one sentence on
plausibility for mos. **No mos design is proposed here.**

1. **Credentials survive a firmware update, because they live on the data
   partition — and the UI tells you which ones don't.** Keys under
   `/data/home/root/.ssh`, host keys under `/data/keys`, the network password
   under `/data/conf`, all settings under `/data/conf/settings.xml` (§2.7);
   the root password on the rootfs is the deliberate exception and is documented
   as such. mos has the storage tier (STATE) and the shadow symlink
   (`docs/design/ro-root.md:257`) but no equivalent of Venus's *published
   contract* about what an update destroys. Plausible for mos as documentation
   plus one UI line, not as new mechanism.
2. **A public authorized-keys path as the *recommended* credential, with the
   password demoted to a bootstrap.** *"use it to login only the first time,
   and then install a public ssh key(s). Thereafter login with the keys"*, and
   `echo 'root:*' | chpasswd -e` to close the password route afterwards [DOC]
   (root-access §4.2, §4.4). `docs/design/access.md` has no authorized-keys
   story at any phase — phase 1 is a password and phases 2-3 jump straight to
   PIN/challenge-response (`docs/design/access.md:148-182`). Plausible and
   cheap: OpenSSH already ships in the mos image.
3. **A one-switch vendor support tunnel that publishes its own rendezvous
   address in the device UI, and that arms the vendor's keys only while it is
   on.** The `/run/ssh_support_keys` symlink lifecycle (§3.1) is the part worth
   copying — the vendor's key is not standing authorization. mos's SideroLink
   plan is not scheduled (`docs/design/remote-management.md:36-39`) and has no
   equivalent "vendor credential is armed by a visible toggle" property.
   Plausible in shape; the transport choice is independent.
4. **A named, three-valued local-network security profile as a single user-facing
   control.** Secured / Weak / Unsecured collapses "HTTPS or not", "password or
   not" and "VRM over HTTPS or not" into one decision with an explicit warning
   dialog listing the consequences [SRC]
   (`gui-v2/pages/settings/PageSettingsAccessAndSecurity.qml:130-260`), and it
   is enforced server-side by `venus-platform` rather than by the UI alone
   [SRC] (`venus-platform/src/security_profiles.cpp:24-49`). mos has independent
   booleans and no composite. Plausible for mos as a settings-tree derived value.
5. **Real percentage progress for an update, sourced from the installer's own
   progress socket rather than guessed.** §5.4. mos's design documents describe
   the update state machine but no progress surface. Plausible: RAUC exposes
   equivalent progress.
6. **An operator-visible "modifications" audit.** `venus-platform` publishes
   `FsModifiedState` (from an `fsmodified /` check), `SystemHooksState`,
   `SshKeyForRootPresent` and `DataPartitionFreeSpace` as first-class D-Bus
   items with a support-status page behind them [SRC]
   (`venus-platform/src/modifications_check.cpp:11-101`). mos's read-only verity
   root makes the filesystem half of this trivially answerable, and it has no
   equivalent of the "is this device modified, and how" summary. Plausible and
   arguably easier on mos than on Venus.
7. **A boot-time update check with a randomised delay up to an hour**, so a fleet
   does not stampede a static origin [SRC] (`check-updates.sh:190-194`). mos
   adopted "waves" from Bottlerocket for fleet rollout
   (`docs/research/os-comparison.md`, §4) but the per-device jitter is a
   separate, much cheaper property. Plausible immediately.
8. **A "check only" / "check and download only" gradient on auto-update, not just
   on/off** [SRC] (`gui-v2/src/enums.h:692-698`). It lets a site be told an
   update exists without accepting a reboot. Plausible for mos's settings tree.
9. **A documented, scriptable hardening checklist that the vendor maintains**
   — a list of every service to disable and the exact `dbus -y` commands to do
   it in bulk [DOC] (root-access §6.3). mos has the layered-disablement model
   but nothing an integrator can paste. Plausible as documentation only.
10. **Update-feed selection exposed to the operator, with the internal feeds
    access-gated in the UI rather than hidden** [SRC]
    (`PageSettingsFirmwareOnline.qml:33-49`). mos's Uptane design has channels
    but no described operator control. Plausible.

Two things Venus does that are listed here **only to be marked as not worth
copying**: the fleet-wide `ZZZ` escalation password (§4.3), and
`PermitEmptyPasswords yes` in the shipped sshd configuration (§2.4).

---

## 7. Unverified / gaps

Everything below is something I could not establish from the sources available,
with what I tried.

1. **The exact factory `/etc/shadow` root entry.** §2.4's conclusion that root
   ships locked as `root:*` is **[INF]**, derived from the absence of the
   `empty-root-password` image feature plus OE-core's
   `zap_empty_root_password`. Tried: grepped all of `meta-victronenergy` for
   `EXTRA_IMAGE_FEATURES`, `debug-tweaks`, `empty-root-password`,
   `allow-empty-password`, `POSTPROCESS`, `chpasswd` and `root password` — no
   hits; checked `meta-venus/files/passwd`, which has no root line at all;
   checked `meta-venus/conf/distro/venus.conf` exists but the image features are
   set in `venus-image.inc`. Settling this needs an unpacked `.swu`, which I did
   not download. Until then the interaction between `PermitEmptyPasswords yes`
   and the shadow entry is unproven in the dangerous direction.
2. **Why `PermitEmptyPasswords yes` is there.** No Victron document, commit
   message or forum post found explains it. Tried: read the whole
   `sshd_config`, the `openssh_%.bbappend`, and the root-access page; searched
   the Victron site for the directive. The layer was cloned shallow (`--depth
   1`), so `git log`/`git blame` on that line was not available.
3. **The `ssh-tunnel` implementation.** `venus-access` depends on a recipe named
   `ssh-tunnel` [SRC] (`meta-ve-software/recipes-ve/venus-access_1.07.bb:9`) but
   the recipe is not in the public layer and
   `github.com/victronenergy/ssh-tunnel` returns 404 (checked). So the tunnel's
   reconnect policy, keepalive, what it forwards, and whether it has any
   idle/expiry behaviour are **unknown**. The claim in §3.1 that Remote Support
   has no auto-expiry is therefore an absence-of-evidence claim about the
   *settings* layer, not a positive finding about the tunnel process.
4. **The relationship between `Settings/Services/Console` and the always-present
   serial console header.** `venus-access` gates a `vegetty` service on
   `/dev/ttyconsole` [SRC] (`venus-access/src/application.cpp:11-12,77-81`), and
   the manual documents hardware console pinouts for every model without
   mentioning a setting [DOC] (root-access §7). Whether the setting is a
   CCGX-era artefact, whether it gates login on the header, and whether the
   header offers a login prompt on a factory device were not established. Tried:
   grepped the layer for `ttyconsole`, `vegetty` and `getty`.
5. **Whether the serial console requires authentication on a factory device.**
   Follows from gaps 1 and 4. The root-access page treats the serial console as
   equivalent to SSH without discussing credentials.
6. **What the "Modifications enabled" setting and `/run/venus/custom-rc` do to
   access specifically.** `venus-platform` renames `/data/rc.local` to
   `.disabled` at every boot while modifications are disabled [DOC]
   (root-access §5.1) [SRC] (`venus-platform/src/modifications_check.cpp:104-147`),
   but whether that setting has any effect on SSH or key installation was not
   checked.
7. **Server-side VRM behaviour.** Who at Victron can initiate a support session,
   whether the device is notified, whether sessions are logged or shown to the
   owner afterwards, and what the Admin/Technician/User roles mean in policy
   terms. Tried: read Cerbo manual §13.6-13.7 and §4.9; these describe the
   device-side switches only. VRM's own documentation requires a login.
8. **Firmware image authenticity end to end.** §4.3 establishes that swupdate is
   built without `CONFIG_SIGNED_IMAGES` on all four machine defconfigs present
   in the layer. What I did **not** verify: whether the `.swu` files Victron
   publish nonetheless carry a detached signature checked elsewhere, and whether
   the `venus-install-initramfs` installer path verifies anything. Tried: read
   all four defconfigs in full and the `swupdate_%.bbappend` patch list; grepped
   the layer for `SIGNED`, `SIGNATURE`, `CONFIG_HASH`, `ENCRYPT`, `CRYPTO`.
9. **Rollback triggered by anything other than a person.** §5.7 is an
   absence-of-evidence finding over `meta-victronenergy` only. If a per-machine
   U-Boot fork carries a bootcount that the layer does not configure, I would
   not have seen it — the U-Boot sources themselves are separate repositories
   that were not cloned.
10. **Update-time behaviour of an active SSH session.** The device reboots
    itself on success (§5.5); what the operator sees in a live SSH session, and
    whether anything warns a logged-in SSH user, was not established.
11. **`AutoUpdate` value 3 ("Check and download only").** It is marked
    `readOnly` in the UI [SRC] (`PageSettingsFirmwareOnline.qml:27`) and
    `check-updates.sh:178-189` accepts only `0`, `1` and `2`, exiting with an
    error otherwise [SRC]. So the option appears unimplemented on the device
    side, but I could not confirm that is intentional rather than a version skew
    between the two repositories at the commits I read.
12. **Whether Venus documents an SSH idle timeout.** `ClientAliveInterval 15` /
    `ClientAliveCountMax 4` are set [SRC] (`sshd_config:104-105`), which is a
    liveness probe rather than an idle policy; no idle-disconnect or
    auto-disable equivalent to `docs/design/access.md:143-144`'s
    `autoDisableAfter` was found anywhere.
