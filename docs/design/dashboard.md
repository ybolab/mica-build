# The mos dashboard: landing screen and information architecture

> **Status:** proposal. This file contains **sections 1-4 only**. Sections 5-8
> (technology posture; process architecture, the `webd` rename, and phasing) are
> added by RFCT-044 and RFCT-046.

This document proposes turning the mos management UI from a set of forms into a
dashboard. It proposes no code, no route handlers, no markup, and no rendering
or live-update technology. Where a proposal only works under some technology
choice, that is said in one line and the choice is left open for RFCT-044.

**Evidence base.** Three research documents, already produced and merged on the
campaign branch, are the sole factual basis here. Their work is *carried
through*, not re-derived:

- `docs/research/mos-ui-inventory.md` — what mos ships today, measured at commit
  `d0bcae92656257021bb67bf7db72b8ac5bfb4651`, every claim carrying `path:LINE`.
- `docs/research/venus-os-ui.md` — Venus OS GUI-v2 and its information
  architecture.
- `docs/research/venus-os-access.md` — Venus OS access and firmware-update UX.

**Citation convention used below.** A claim about mos today cites the inventory
by section, and carries the inventory's own `path:LINE` where the line is
load-bearing. A borrowed or rejected Venus idea cites `venus-os-ui.md` or
`venus-os-access.md` by section. A claim marked **[proposal]** is mine and is
not sourced from anything, because it does not exist yet.

**Licence fence, load-bearing.** gui-v2 ships under "Victron Energy OS license
v1", which states *"USE OF THE SOFTWARE AND ITS MODIFICATIONS WITH SYSTEMS
WHOSE CORE IS NOT VICTRON ENERGY PRODUCTS IS EXPRESSLY NOT AUTHORIZED"* —
quoted from `gui-v2/LICENSE.txt:18-23` as verified by `venus-os-ui.md`
section 1.5, which I did not re-verify. Venus is a **study reference only**
throughout this document. Interaction patterns and IA ideas are borrowed and
attributed; no code, markup, asset name or verbatim string is.

**Scope fence.** `docs/design/access.md`, `docs/design/provisioning.md` and
`docs/design/mosd.md` are owned by a parallel campaign for the duration. They
are quoted and cited here and not edited, including where
`mos-ui-inventory.md` section 9 records them as contradicting the code.

---

## 1. Problem and current state

### 1.1 What the UI is today

Summarised from `mos-ui-inventory.md` sections 2 and 3, with its citations
carried through.

`webd` is one Rust crate serving **ten routes on the HTTPS listener**, built in
a single function (`mosd/webd/src/routes.rs:40-57`), plus a catch-all 308
redirect router on the HTTP listener (`routes.rs:61-65`). That is the entire
HTTP surface: no nested router, no fallback, no static-asset route
(`mos-ui-inventory.md` section 2).

The operator's whole menu is **four links plus a logout button** —
`Status` (`/`), `Network` (`/network`), `Hostname` (`/hostname`),
`Power` (`/power`) — rendered by `shell()` at `mosd/webd/src/routes.rs:168-178`
(`mos-ui-inventory.md` section 2.2).

Of those, three are editors and one is a status page. The status page, `/`,
shows the configured hostname, the uptime, and a `<pre>` dump of the
pretty-printed live-state `network` subtree, one `<li>` per interface
(`routes.rs:566-572`, rendering at `routes.rs:587-596`).

The technology posture is measured, not assumed (`mos-ui-inventory.md`
section 3): server-rendered compile-time-typed HTML via `maud`; **zero
JavaScript** anywhere in the repository, confirmed by four separate probes
(no `<script` tag, no `.js` file, no `ServeDir`/`ServeFile`, no `fetch(`); and
one 7-line inline stylesheet at `routes.rs:147-154` whose own doc comment says
*"Inline stylesheet shared by every page; no external assets."*

`mosd` offers a **six-method, one-signal** bus surface on `com.mos.mosd1`
(`mosd/mosd/src/bus.rs:157`): `GetSettings`, `SetSettings`, `GetState`,
`ReportHealth`, `Reboot`, `PowerOff`, and the `SettingsChanged` signal
(`mos-ui-inventory.md` section 4). `webd` calls five of the six methods and
subscribes to the signal not at all — its zbus proxy declares no signal member
(`mosd/webd/src/bus_client.rs:9-20`).

### 1.2 The shape of the problem, in one paragraph

Ten routes, four nav links, every state change a form POST followed by a 302
and a full page re-render, and **one single `GetState` call in the entire UI** —
`GetState("network")` at `mosd/webd/src/routes.rs:568`, whose result is rendered
as an opaque JSON dump (`mos-ui-inventory.md` sections 2, 3.2, 4). The `?saved=1`
query marker at `routes.rs:206-209` exists precisely because a redirect is the
only way the application has to say "that worked". The consequence, stated as
fact rather than complaint in the inventory's Appendix A: the settings tree is
well surfaced and the **live-state tree is almost entirely unsurfaced**, and
nothing in the system can display a value that changes on its own.

The asymmetry has a number attached. `mos-ui-inventory.md` section 7 catalogues
**18 mechanisms that M3/M4/M5 built and that no UI reaches**. Its own
classification in section 7.1: one answered (power), one answered through a side
channel (uptime), **7 needing only UI work** because the bus call already exists
and returns the data (rows 6, 7, 8, 15, 16, 17, 18 and the metadata half of
row 9), and **9 needing new mosd work** because no mechanism reaches the data
from the bus at all (rows 1, 2, 3, 4, 5, 11, 13, 14 and the plaintext half of
row 9). The sharpest of these is that the A/B update subsystem is the largest
thing M4 built and `mosd` contains literally zero lines referencing it —
`grep -rci rauc mosd/mosd/src/` returns 0 across all 12 source files
(`mos-ui-inventory.md` section 7, row 1).

### 1.3 What a dashboard has to change about that

Four changes, in dependency order. **[proposal]**

1. **Read live state, not just settings.** A dashboard is a view of what the
   appliance *is*, and today the UI asks for that exactly once, for one path.
   Every tile in section 2 is first of all a `GetState` call that nobody makes
   yet.
2. **Answer questions instead of accepting input.** Three of the four current
   nav destinations are editors. A landing screen that is an editor is not a
   landing screen; the first screen must be read-only (section 2.1).
3. **Stop rendering machine shapes.** `<pre>` around pretty-printed JSON
   (`routes.rs:587-596`) is a debugging affordance presented as a product. Each
   tile in section 2 names the specific fields it renders and what they mean.
4. **Distinguish configured from observed, visibly.** This is the load-bearing
   one, and section 2.4 and section 3.3 are about it. mos's live-state tree is
   substantially an echo of the settings tree — the `hostname` key echoes
   `settings.hostname` back after the hostnamed call returned `Ok`
   (`mosd/mosd/src/reconciler/hostname.rs:64`), and the `network` key carries the
   rendered unit file name and the configured `dhcp` flag
   (`mosd/mosd/src/reconciler/network.rs:115-118`) and nothing else. A dashboard
   that renders those as if they were measurements is a dashboard that lies.

Note what is *not* on that list: making the UI faster, prettier, or
single-page. None of those are the problem. The problem is that the appliance
knows things it never says.

---

## 2. The landing dashboard

### 2.1 Rules the landing screen obeys

**[proposal]**, though rules 1 and 5 have Venus precedent noted inline.

1. **Read-only.** No form, no control, no destructive action. Every tile links
   to the page where the corresponding change is made.
2. **Every tile answers a question an operator actually asks**, phrased as that
   question. A tile that exists because the data was available is a tile that
   fails this rule.
3. **Every tile has a defined red state, and a defined next action for it.** A
   red tile with no next action is an alarm, not a dashboard.
4. **No tile shows configured intent in a place where the operator will read it
   as observed reality.** Where mos has only the configured value, the tile says
   so in its own label (section 2.4).
5. **A tile whose underlying subsystem does not exist on this unit is absent,
   not empty.** Borrowed from Venus's data-dependent navigation
   (`venus-os-ui.md` section 4.2 and section 7 item 8), and fenced in
   section 3.4.2 — "does not exist" must mean *hardware or setting absent*, never
   *reconciler failed*.
6. **Server-rendered-compatible by default.** Every tile below is a value read
   at request time and rendered into the page. No tile requires a client-side
   transport unless it is flagged; where a tile would be materially better with
   one, that is one line and the decision is RFCT-044's.

Each tile below is marked **(a) available today** — the feed is an existing bus
call returning the data — or **(b) needs new mosd work**, with the
`mos-ui-inventory.md` section 7 gap-table row cited.

### 2.2 Tile: identity — "which box am I looking at?"

- **Shows:** the configured hostname; the device identity (`deviceId`); the
  provisioning state (`pending` / `complete`).
- **Feed:** `GetSettings("hostname")` — already called at
  `mosd/webd/src/routes.rs:567`; `GetSettings("provisioning")`, which returns
  `state`, `deviceId` and `seededGeneration`
  (`mosd/mosd-settings/src/model.rs:142-162`).
- **Availability: (a) available today.** `GetSettings("provisioning")` works
  today and `mosd/webd/src/` contains zero references to it — gap-table
  **row 8**, classified UI-work-only. Identity is a *setting*, not live state,
  and is therefore reachable (`mos-ui-inventory.md` section 6.3).
- **Why it earns the first screen:** an operator with more than one appliance,
  or one browser tab open from yesterday, needs to know which machine is
  answering before any other tile means anything.
- **Caveat carried, not hidden:** the hostname shown is the **configured** one.
  The live-state `hostname` key echoes `settings.hostname` back
  (`mosd/mosd/src/reconciler/hostname.rs:64`) rather than reading back from
  hostnamed; there is no `GetHostname` call anywhere — gap-table **row 13**. The
  tile is therefore labelled as configuration, per rule 4.
- **When it is red** (`provisioning.state == pending`): first-boot seeding did
  not complete. Next action: open the provisioning page (section 3.2) and read
  the seeding outcome; `seededGeneration` versus the image's expected generation
  is what distinguishes "never seeded" from "seeded by an older image".

### 2.3 Tile: health — "is anything actually broken right now?"

- **Shows:** a roll-up of three things, each expandable to the failing detail:
  (i) any reconciler currently in an error state, named, with its message;
  (ii) the `/var` health verdict; (iii) the boot health gate's own verdict.
- **Feed:** (i) `GetState("<reconciler-name>")` per reconciler — a failing
  reconciler is recorded as `{"error": "<message>"}` under its own live-state key
  rather than disappearing (`mosd/mosd/src/bus.rs:126-137`). (ii)
  `GetState("health")`, written by `ReportHealth`
  (`mosd/mosd/src/bus.rs:209-229`). (iii) does not exist.
- **Availability: mixed, and the split is the point.**
  - (i) is **(a) available today** — gap-table **row 18**, UI-work-only. `webd`
    calls `GetState` for exactly one path and treats any object as opaque JSON
    (`routes.rs:568`, `:587-596`), so an `error` key is today dumped as raw JSON
    in a `<pre>` rather than surfaced as a failure. This is the single cheapest
    high-value tile in the whole proposal.
  - (ii) is **(a) available today**, with a hard limitation: exactly one
    component reports health, exactly once per boot. `mos-health` calls
    `ReportHealth("var", …)` at
    `os/rootfs/overlay-v2/usr/lib/mos/mos-health:194` / `:197`, and **nothing
    ever refreshes it** (`mos-ui-inventory.md` section 6.2). The tile must
    therefore timestamp it as a boot-time reading, not present it as current.
  - (iii) is **(b) needs new mosd work** — gap-table **row 5**. A 208-line gate
    probes systemd, mosd and webd and then runs `rauc status mark-good`
    (`os/rootfs/overlay-v2/usr/lib/mos/mos-health:111-207`), and its verdict —
    did it pass, was the slot confirmed, which probe failed — goes to the journal
    and nowhere a UI can read.
- **Why it earns the first screen:** it is the only tile that can be red for a
  reason the operator did not cause. Everything else on this screen reports a
  consequence of a decision someone made.
- **When it is red:** the failing reconciler's name *is* the next action —
  `network` red routes to the network page, `sshd` red to the access page,
  `wifiAp` red to the WiFi page, each carrying the recorded error string. This
  is why the roll-up is per-reconciler and not a single global light.
- **Venus comparison, running both ways.** Venus surfaces config-versus-reality
  drift as a user-visible WARNING notification, raised by the backend rather than
  computed in the UI (`venus-os-ui.md` section 7 item 4). mos already *detects*
  the equivalent — the reconcilers produce named outcomes, and
  `mosd/mosd/src/bus.rs:126-137` already records failures durably in a place the
  bus can read. mos is missing the surface, not the detection. Venus additionally
  has a first-class notification stream with a nav-bar counter badge
  (`venus-os-ui.md` section 7 item 3); mos has no notification model at all, and
  this tile is deliberately *not* proposed as one — see section 2.10.

### 2.4 Tile: network — "what is my IP address?"

This is the tile the operator wants most and the one mos can least honestly
provide. It is designed around that.

- **The problem, stated exactly.** The live-state `network` subtree holds
  **configured** data: `{"<iface>": {"file": "50-mos-<iface>.network", "dhcp":
  <bool>}}` (`mosd/mosd/src/reconciler/network.rs:115-118`). There is no address,
  no lease, no gateway, no route, no DNS server actually in use and no carrier
  state anywhere in mos (`mos-ui-inventory.md` section 6.3). A DHCP interface
  that got no lease is **indistinguishable in this tree from one that did**.
  `mosd` does talk to `org.freedesktop.network1`, but for exactly one thing —
  `Manager.Reload` (`mosd/mosd/src/reconciler/network.rs:36-43`); it issues no
  `Get`, no property read and no link enumeration. Gap-table **row 14**.
- **How this proposal handles it: the tile is split in two, and the halves are
  labelled differently.** **[proposal]**
  - **Half A — "Configured" — (a) available today.** Per interface: the method
    (DHCP or static) and, for static, the configured address, gateway and DNS,
    from `GetSettings("network")` (`mosd/mosd-settings/src/model.rs:280-299`).
    Rendered under a heading that says *configured*, in the same visual register
    the rest of the UI uses for settings (section 3.3).
  - **Half B — "Observed" — (b) needs new mosd work, gap-table row 14.** Until
    that work lands, this half renders the literal statement that the appliance
    does not know its own address, with a link to the mechanism gap. It does
    **not** render blank, and it does **not** borrow half A's numbers.
- **Why the empty half ships rather than waiting.** A network tile that shows
  configured intent while looking like observed reality is worse than no tile:
  it converts "I do not know my IP" into "I confidently know the wrong IP" on
  every DHCP interface. Shipping the labelled absence is what makes the eventual
  arrival of half B a visible improvement rather than an invisible correction.
  For a static-addressed interface the two halves will agree in the common case,
  which is exactly why the labelling has to be structural rather than a footnote
  — the operator must not learn to read half A as ground truth on the units where
  it happens to be right.
- **Why it earns the first screen:** it is the first question asked of any
  headless appliance, and the only tile whose absence sends the operator to a
  serial console or a router's DHCP table.
- **When it is red:** an interface configured for DHCP with no lease, or a link
  with no carrier — **neither of which mos can currently detect**. Under half B
  the next actions are: no carrier, check cabling and the switch port; carrier
  but no lease, check the DHCP server or switch the interface to static on the
  network page.
- **Venus comparison:** Venus's Connectivity settings row carries the current IP
  address as its own secondary text, so the menu answers the question without
  being entered (`venus-os-ui.md` section 4.3 and section 7 item 7), sourced from
  connman service properties (`venus-os-ui.md` section 6). That is the target
  state for half B, and it is a *mechanism* gap for mos, not a layout gap.

### 2.5 Tile: update and slot state — "can I safely reboot?"

This is the tile that carries the campaign's sharpest finding: **mos built the
better mechanism and then hid it.**

- **Shows:** which slot is running (A or B); the version in each slot; whether
  the running slot is **confirmed good or still pending confirmation**; the boot
  attempt credits remaining; and the result of the last install.
- **Feed: none of it exists on the bus.** **(b) needs new mosd work**, across
  four gap-table rows:
  - **row 1** — which slot is running. The two-slot model is fully specified
    (`os/rauc/system.conf.in:75-95`, partition GUIDs at
    `os/layout/cx3576-v2.env:209-219`), but there is no bus mechanism: a UI would
    have to subprocess `rauc status --output-format=shell`, and `webd` cannot,
    because it never spawns a process (`mosd/webd/src/settings_api.rs:10-12`,
    which states *"mosd owns every system action: webd never spawns a process and
    never talks to systemd itself"*).
  - **row 2** — boot attempt credits. `BOOT_A_LEFT` / `BOOT_B_LEFT` in the
    redundant U-Boot environment (`os/rootfs/overlay-v2/etc/fw_env.config.in:27-29`),
    reachable only via `fw_printenv`, and that file's own comment at `:23-25`
    warns there is **no cross-process locking** between the two existing writers.
  - **row 3** — RAUC status and last install result, kept on the META partition
    (`os/rauc/system.conf.in:14-34`).
  - **row 5** — the boot health gate's verdict and whether the slot was
    confirmed (shared with section 2.3).
- **Why it earns the first screen, and why this specific field.** mos's A/B
  model decrements a slot's credit **before** the boot and refunds it only when
  userspace reaches the health gate and runs `rauc status mark-good` — *"Saving
  before booting is what makes the counter a watchdog rather than a hint"*
  (`docs/design/uboot-ab-handshake.md:418-444`). That produces a real state that
  the operator can be in and cannot currently see: **installed, running, not yet
  confirmed good.**
- **When it is red** (running slot unconfirmed, or credits at 1): **do not
  reboot.** Rebooting a slot RAUC has installed but that has not been marked
  good **burns a boot attempt**, and today the power pane has no update-state
  awareness and does not warn — recorded as a known follow-up at
  `docs/design/mosd.md:217-220` and `docs/plan/PLAN-010.md:502-503`, and
  gap-table **row 10**. The next action is to wait for the health gate to run, or
  read *why* it did not pass (section 2.3, part iii). This tile and the power
  page are therefore coupled: the power page must read this tile's feed before it
  will offer a reboot without a warning.
- **The Venus comparison runs in the opposite direction here, and no borrow is
  proposed.** Venus has **no bootcount, no mark-good and no bootloader
  watchdog** — grepping the whole of `meta-victronenergy` for `bootcount`,
  `boot_count`, `bootlimit`, `altbootcmd` and `rollback` returns no hits, and the
  `sw-description` files set the `version` variable unconditionally as part of a
  successful install (`venus-os-access.md` section 5.7). Consequently Venus has
  no "installed but not yet confirmed good" state and its UI says nothing about
  one: `/Firmware/Backup/AvailableVersion` is *purely descriptive*, reporting
  what is in the other partition rather than a pending state (same section).
  Venus's rollback is a manual operator-triggered slot switch — the "Press to
  boot" button on the stored-backup page (`venus-os-access.md` section 5.6) — and
  its own research document records the asymmetry plainly: *"This is not a
  contradiction in the mos documents — it is a capability Venus simply does not
  have"* (`venus-os-access.md` section 5.8). **Borrowing Venus's model here would
  regress mos.** What is worth borrowing from that page is only its two guard
  behaviours: the backup-boot button is disabled while auto-update is set to
  "check and update", because the device would immediately re-update itself back,
  and it refuses while the security profile is indeterminate
  (`venus-os-access.md` section 5.6) — that is, an action that would undo itself
  is disabled with the reason stated, which is a pattern, not a mechanism.
- **Also worth borrowing from Venus, for the install path (row 4):** real
  percentage progress sourced from the installer's own progress socket rather
  than guessed, republished as a first-class bus item
  (`venus-os-access.md` section 5.4 and section 6 item 5). Progress that moves
  is the difference between an operator waiting and an operator power-cycling.
  Flagged for RFCT-044: a genuinely live progress bar is the one item on this
  screen that a server-rendered page cannot show well, and it is the only tile in
  this document whose value is materially technology-dependent.

### 2.6 Tile: storage — "is the disk filling up?"

- **Shows:** used and free per storage tier, with the tier's loss semantics named
  — **DATA** (`/srv`) first, because it is the only tier that grows.
- **Feed:** `statvfs` on the four tier mount points. mos has four tiers with
  distinct loss semantics — STATE `/mnt/state`, DATA `/srv`, META `/mnt/meta`,
  EPHEMERAL `/var` (`os/rootfs/overlay-v2/etc/fstab.in:11-27`, tier table at
  `docs/design/ro-root.md:363-368`, which records DATA as the one tier marked
  *"yes — fills the media"*).
- **Availability: (b) needs new mosd work** — gap-table **row 11**. Today the
  UI has *almost nothing*: only `/var`, only as a boot-time percentage inside
  the `health.var` detail string (`os/rootfs/overlay-v2/usr/lib/mos/mos-health:186-199`).
  `/srv` — the tier that actually fills up — has **no reporting of any kind**.
  The inventory's own judgement is that the `statvfs` read is trivial and the bus
  surface for it does not exist.
- **Why it earns the first screen:** it is the only failure on this screen that
  is gradual, predictable and preventable, and therefore the only one where a
  dashboard changes the outcome rather than reporting it.
- **When it is red:** which tier is red determines the action, which is why the
  tier names are shown rather than a single "disk" figure. DATA full is an
  application problem and the operator's own data to clear. EPHEMERAL full is
  logs and caches, recoverable by routine cleanup and lost on factory reset
  anyway (`docs/design/ro-root.md:363-368`). STATE or META full is a defect and
  should be reported, since both are documented as fixed-size and non-growing.

### 2.7 Tile: uptime — "how long has this been up?"

- **Shows:** time since boot, and — once section 2.5's feed exists — whether
  that boot was the first on the current slot version.
- **Feed:** `/proc/uptime`, read by `webd` itself at
  `mosd/webd/src/routes.rs:569-571`, parsed at `:539-546`, formatted at
  `:549-560`, rendered on `/` at `:580-583`.
- **Availability: (a) available today** — gap-table **row 12**, answered via a
  side channel. Recorded honestly: this is **the one place `webd` touches the
  filesystem for data rather than going through the bus**, a documented
  exception to the layering asserted at `mosd/webd/src/settings_api.rs:10-12`.
  Uptime is not in the live-state tree at all (`mos-ui-inventory.md` section 6.3).
  This proposal does not resolve that exception; it notes that a dashboard adding
  more `/proc` reads would widen it, and that the correct place to decide is
  RFCT-046's process-architecture section.
- **Why it earns the first screen:** it is the cheapest possible detector of an
  unplanned reboot, and — paired with section 2.5 — the difference between "this
  updated last night" and "this is crash-looping".
- **When it is red** (uptime unexpectedly short): cross-read section 2.5's boot
  credits. Credits decreasing across short uptimes is the signature of a slot
  failing its health gate and being retried; that is the one pattern on this
  screen that no single tile can show and two tiles together can.

### 2.8 Tile: access surface — "what is open on this box, right now?"

- **Shows:** whether SSH is listening and on which port; whether the setup
  access point is broadcasting and under which SSID; whether the appliance is
  associated to a WiFi network.
- **Feed:** `GetState("sshd")`, which publishes `enabled`, `port`,
  `permitRootLogin`, `passwordAuthentication`, `listenAddresses`, `activeState`
  and `unitFileState` (`mosd/mosd/src/reconciler/sshd.rs:392-403`);
  `GetState("wifiAp")`, which already computes `ssid` and `ssidSource` for
  exactly this purpose (`mosd/mosd/src/reconciler/wifi_ap.rs:792-807`, and the
  single-radio conflict variant at `:739-750`); `GetState("wifiClient")`
  (`mosd/mosd/src/reconciler/wifi_client.rs:508-518`, which never publishes the
  PSK).
- **Availability: (a) available today** — gap-table **rows 15, 7 and 6**
  respectively, all three classified by `mos-ui-inventory.md` section 7.1 as
  needing only UI work. `mosd/webd/src/` contains **zero** references to any of
  these paths. Note that row 15 (SSH) is **in flight on the `sshweb` branch**
  (`mos-ui-inventory.md` section 8); anyone building this tile after that merge
  must re-measure section 2's route inventory first, as that section instructs.
- **Why it earns the first screen:** every other tile reports the appliance's
  condition; this one reports its exposure, and it is the only value on the
  screen that can change because of a setting someone else edited.
- **When it is red** (an unexpected listener, or `wifiAp.accessPoint ==
  "conflict"`): the conflict case is already a designed outcome with a
  `conflict` sentence attached (`wifi_ap.rs:739-750`) — render that sentence and
  link to the WiFi page. An unexpected SSH listener links to the access page.
- **What this tile deliberately does not show:** the device password or the AP
  PSK. See section 2.10.

### 2.9 Feed availability, counted

Being honest about the ratio, since it determines whether this is a UI project
or a `mosd` project. **[proposal — my classification of my own tiles against
`mos-ui-inventory.md` section 7]**

| Tile | Availability | Gap-table rows |
|---|---|---|
| 2.2 Identity | **(a)** available today | 8 (UI-only); caveat 13 |
| 2.3 Health | **mixed** — reconciler errors and `health.var` (a); gate verdict (b) | 18 (UI-only), 5 (mosd) |
| 2.4 Network | **mixed** — configured half (a); observed half (b) | 14 (mosd) |
| 2.5 Update / slot | **(b)** needs new mosd work | 1, 2, 3, 5; install 4; warning 10 |
| 2.6 Storage | **(b)** needs new mosd work | 11 |
| 2.7 Uptime | **(a)** available today, via a side channel | 12 |
| 2.8 Access surface | **(a)** available today | 6, 7, 15 (all UI-only) |

Three tiles are fully available today, two are fully blocked on new `mosd`
work, and two ship half-built. That is consistent with the inventory's overall
7-UI-only against 9-needs-mosd split (`mos-ui-inventory.md` section 7.1).

The headline is less comfortable than the count. **The two questions an operator
asks first — "what is my IP address?" and "is it safe to reboot?" — are both in
the needs-new-mosd column** (rows 14, and 1/2/3/5). A dashboard built only from
what is available today would be a genuine improvement over four nav links and a
JSON dump, and it would still not answer either of them. Section 4 costs that
out.

### 2.10 What does NOT go on the landing screen, and why

A dashboard is defined as much by what it refuses to show. Each exclusion below
names the reason, and where it belongs instead. **[proposal]**

- **No forms, controls or editable fields.** Rule 1 of section 2.1. Three of the
  four current nav destinations are editors (`routes.rs:168-178`); the landing
  screen is not a fourth. Every tile links out to its editor.
- **No power buttons.** They are one click from the nav bar already
  (`routes.rs:48`), they are the only irreversible actions in the product, and —
  until section 2.5's feed exists — the power pane cannot warn that rebooting a
  pending-confirm slot burns a boot attempt (`docs/design/mosd.md:217-220`).
  Promoting an action to the first screen while it cannot state its own
  consequence is the wrong order of operations. The existing safety properties
  stay as they are: POST-only with no `GET` handler, so a browser prefetch or a
  mis-clicked link cannot power the appliance off (`routes.rs:49-51`, pinned by a
  test at `mosd/webd/src/tests.rs:563`), plus a required confirmation token.
- **No raw JSON.** The current `/` renders the network subtree as
  pretty-printed JSON inside a `<pre>` (`routes.rs:587-596`). That is the
  artefact this proposal exists to remove, not a component to reuse. A full-tree
  browser is a legitimate *debug* page — Venus gates exactly that behind
  Superuser and redacts serials and custom names before sharing
  (`venus-os-ui.md` section 7 item 10) — and it belongs in section 3.2's
  diagnostics page, not here.
- **No secrets, ever.** Not the device password, not the AP PSK. The plaintexts
  are not on the bus at all — no method reads `secrets/` — and only the Argon2id
  hash and generation are readable via `GetSettings("access.device")`
  (`mos-ui-inventory.md` section 7, row 9). This is a property to preserve
  deliberately, not a gap to close. Note that `wifiClient` state already never
  publishes the PSK (`mosd/mosd/src/reconciler/wifi_client.rs:508-518`); the
  landing screen inherits that discipline.
- **No CPU, memory, load, temperature, kernel version or build id.** None of
  these exist anywhere in mos's management plane
  (`mos-ui-inventory.md` section 6.3). Proposing tiles for them would be
  proposing `mosd` work whose only justification is that dashboards usually have
  such tiles — which fails rule 2 of section 2.1. Kernel and OS version belong
  with the update page once row 3 lands.
- **No log or journal tail.** The boot gate's own output goes to the journal
  (`os/rootfs/overlay-v2/usr/lib/mos/mos-health:17-18`), so a tail is tempting.
  It is refused here for two reasons: it is unbounded in size and unbounded in
  what it may disclose, and it answers "what happened" rather than "what is
  true", which is a diagnostics question. Section 3.2 gives it a page.
- **No notification or alarm stream.** Venus's is genuinely the best idea in its
  UI — a bus subtree with active/inactive and acknowledged/unacknowledged
  dimensions, a counter badge in the nav chrome, and the landing screen jumping
  to it when an alarm is active (`venus-os-ui.md` section 4.1 and section 7
  item 3) — and mos has no notification model and no mechanism for one. Adding a
  notification badge fed by section 2.3's tile would be a badge that reports the
  same thing twice. This is named as a deliberate deferral, not an oversight.
- **No per-interface detail tables, no WiFi scan list, no device inventory.**
  These are page content, not tile content; section 3.2 places them. Venus's own
  landing screen makes the same refusal more aggressively than this proposal
  does — the default "Brief" page shows no device list, no settings, no IP
  address, no firmware version, no service or health status, no logs and no
  tables of numbers, answering only *"is my system doing what I want right now"*
  (`venus-os-ui.md` section 4.1).
- **A deliberate divergence from Venus, stated as such.** Venus's landing screen
  is an instrument panel for the installation the appliance manages, and pushes
  IP address, firmware version and health status behind at least one navigation
  (`venus-os-ui.md` section 4.1). mos is not managing an installation; mos *is*
  the appliance, and its operator's questions are about the box itself. So this
  proposal puts identity, health, network, slot state, storage and uptime on the
  first screen — precisely the set Venus excludes. The Venus rule being kept is
  the discipline (a landing screen answers one class of question and refuses the
  rest); the Venus rule being rejected is its particular answer, because the
  product is a different kind of thing.

---

## 3. Information architecture for the rest

### 3.1 The navigation model

Today the nav is four flat links plus logout (`routes.rs:168-178`), rendered by
`shell()`; `page()` renders the same shell **without** the nav and is used for
setup, login and every error page (`routes.rs:187-190`)
(`mos-ui-inventory.md` section 2.2).

**[proposal]** Keep it flat and keep it short. Five destinations, one level:

`Dashboard` · `Network` · `Access` · `Update` · `Diagnostics` · [Logout]

Rationale, and one thing measured from Venus. Venus carries 303 QML files under
`pages/` behind seven settings rows, and pays for it in depth: putting a WiFi
network on a static IP is four page pushes below the Settings root, five screens
from the landing screen, six taps in total — and the single biggest contributor
is that *every enumerated setting is its own pushed page* rather than an inline
control (`venus-os-ui.md` section 4.4). Venus mitigates depth with breadcrumbs
in the status bar (`venus-os-ui.md` section 4.3). mos does not have Venus's
volume and should not adopt Venus's depth to prepare for volume it does not
have: a flat five-item bar needs no breadcrumb mechanism at all. If mos ever
grows a settings tree of that size, breadcrumbs are the documented answer and
can be added then.

Note one structural thing the current nav gets right and which is worth stating
so it is not lost: setup, login and error pages render *without* navigation
(`routes.rs:187-190`). A page the operator cannot act from should not offer a
menu of places to act. Keep it.

### 3.2 Page inventory and bindings

**[proposal].** Availability marks and gap rows carry the same meaning as
section 2.

| Page | Answers | Settings bindings | Live-state bindings | Availability |
|---|---|---|---|---|
| **Dashboard** (`/`) | the six questions of section 2 | `hostname`, `provisioning` | `network`, `health`, `sshd`, `wifiAp`, `wifiClient`, per-reconciler error keys | mixed — see 2.9 |
| **Network** | how is networking configured, and what is it actually doing | `network.<iface>` (`model.rs:280-299`), `wifi.client` (`model.rs:177-214`), `wifi.ap` (`model.rs:219-246`) | `network`, `wifiClient`, `wifiAp` | settings **(a)** for wired today (`routes.rs:686-720`); WiFi panes **(a)**, rows 6 and 7; observed data **(b)**, row 14 |
| **Access** | who can reach this box and how | `access.webAdmin`, `access.ssh` (`model.rs:79-94`), `access.device` metadata, `access.console` | `sshd` | **(a)**, rows 15 and 9-metadata; note row 15 is in flight on `sshweb` (`mos-ui-inventory.md` section 8), and `access.console.shellEnabled` is consumed by no reconciler at all (row 17) so it must not be offered as a working control |
| **Update** | what is installed, what is pending, what can I install | — | slot state, RAUC status, boot credits, install progress | **(b)** entirely — rows 1, 2, 3, 4, 5 |
| **Diagnostics** | what happened, and what do I send to support | — | the whole tree via `GetState("")` / `GetSettings("")` | **(a)** mechanically — both already accept `""` for the whole tree (`mosd/mosd/src/bus.rs:160-164`, `:197-202`) — but **(b)** for the redaction rule that must precede any export |
| **Hostname** | — | folded into Access or a small identity page; it does not earn a nav slot of its own | | **(a)** today (`routes.rs:745`, `:896`) |
| **Power** | reboot / shut down safely | — | must read section 2.5's slot state before offering an unwarned reboot | action **(a)** (row 10, already answered); the *warning* is **(b)**, rows 1/5 |

Two things this table makes visible. First, **Update is the only page that is
entirely unbuildable today** — every one of its bindings is a gap row. Second,
**Diagnostics is buildable today but should not be built first**: `GetState("")`
returns the whole tree, which includes whatever reconcilers have recorded, and
shipping an export before the redaction rule exists is how a support channel
becomes a disclosure channel. Venus faced the same order and resolved it the
same way — its bus browser redacts serial numbers and blanks custom names
*before* sharing, and is gated behind Superuser
(`venus-os-ui.md` section 7 item 10).

Two absences carried forward from the inventory, because a page inventory that
silently assumes they are fixed would be wrong. There is **no password-change
route** — `SetSettings("access.webAdmin", …)` has exactly one call site,
`routes.rs:430` inside `setup_submit`, which 409s if a hash already exists
(`mos-ui-inventory.md` section 5.2). And there is **no delete-interface route** —
`network_submit` only ever writes `network.<iface>` and nothing in the crate
removes a key (`mos-ui-inventory.md` section 5.5). The Access and Network pages
above assume both are added; neither is a `mosd` gap, both are UI work.

### 3.3 Keeping the settings-versus-live-state split visible

This split must stay visible to the operator, and mos starts from a better
position than Venus.

**How Venus carries the distinction** (`venus-os-ui.md` section 5). Venus has
two service families: persisted settings in one service,
`com.victronenergy.settings`, and live values in per-device services
`com.victronenergy.<type>` (section 5.1). But **the boundary is the path string
rather than a type** (section 5.2): gui-v2 addresses everything through a single
QML type keyed by a transport-independent uid, so in the QML there is *no
type-level distinction at all* between a setting and a reading — the boundary is
literally the substring `/Settings/`. That document records the cost in its own
words: *"nothing in the UI's type system prevents binding an editor to a live
path or a read-only label to a setting. Discipline lives in the choice of QML
component."* What the operator actually sees is carried entirely by which
list-item component the page author picked — `ListText` and `ListQuantity` for
live values with no affordance, `ListSwitch`/`ListSlider`/`ListSpinBox` for
settings with a real control on the row (section 5.3).

**mos's position is structurally stronger, and this proposal's first rule is not
to throw that away.** `mosd` exposes settings and live state through **two
distinct bus methods** — `GetSettings` at `mosd/mosd/src/bus.rs:160-164` and
`GetState` at `:197-202` — so a mos UI cannot accidentally bind an editor to a
live path: it would have to call the wrong method. The boundary is in the API,
not in a string convention. **[proposal]** The UI should mirror that boundary
visibly rather than relying on it silently: anything reached by `GetSettings`
renders as configuration and may carry a control; anything reached by `GetState`
renders as a reading and never does.

**But mos needs a third category that Venus does not, and this is the honest
part.** In Venus, a live value is a measurement from a device. In mos, most of
the live-state tree is an **echo** of the settings tree:

- `hostname` echoes `settings.hostname` back after the hostnamed call returned
  `Ok` (`mosd/mosd/src/reconciler/hostname.rs:64`) — a confirmation that the
  write was attempted, not a read-back (`mos-ui-inventory.md` section 7, row 13).
- `network` carries the rendered unit file name and the configured `dhcp` flag
  (`mosd/mosd/src/reconciler/network.rs:115-118`) and no observed value
  (row 14).
- `wifiClient.networks` lists the **configured** networks, and `activeState` is
  systemd's view of the supplicant *unit*, not of the association
  (`mos-ui-inventory.md` section 6.3).

So `GetState` in mos today means *"what the reconciler did"*, not *"what is
true"*. **[proposal]** The UI should therefore distinguish three registers, not
two — **configured** (from `GetSettings`), **applied** (from `GetState`, meaning
a reconciler ran and reported this) and **observed** (measured from the system).
Today the third register is empty for nearly everything, which is exactly why
section 2.4 splits the network tile rather than merging it. Collapsing *applied*
into *observed* is the single most likely way this dashboard could mislead.

**One place mos is ahead of Venus and should say so.** Venus needs an explicit
`SettingSync` component whose only job is to show the operator what they asked
for while the backend has not caught up, with a give-up timer of 500 ms locally
and 3000 ms over VRM, because localsettings stores a value and the consumer
applies it independently and may never converge — the component's own header
comment lists *"the backend was unable (or refused) to update the value"* among
the reasons (`venus-os-ui.md` section 5.4). That document also records that
Venus has *no indication anywhere of whether a written setting has actually been
applied by its consumer, as opposed to merely stored by localsettings*.
**mos does not have that problem by construction**: `SetSettings` validates
against the typed tree, persists atomically, and then **runs every reconciler
whose subtree overlaps the path before it returns**
(`mosd/mosd/src/bus.rs:169-194`, reconciler loop at `:183-188`), recording each
outcome into live state via `record` (`:126-137`). By the time a `SetSettings`
call returns, "stored" and "applied" have already been resolved. **[proposal]**
The UI should use that: a settings POST should render the *reconciler's recorded
outcome*, not a generic success banner. The current `?saved=1` marker
(`routes.rs:206-209`) throws away information that `mosd` already computed.

### 3.4 Two Venus IA properties, weighed for adoption

#### 3.4.1 Navigation rows that show the live value of what is behind them

**What Venus does.** At the settings root a navigation row's secondary text is a
static caption; one level down it is usually the *live current value*. The
Ethernet row's secondary text is the current IP address, the connman service
state, or "Unplugged"; the Wi-Fi row shows the connected network name; the
Bluetooth row shows Enabled/Disabled or "No Bluetooth available"; the Firmware
row shows the installed version (`venus-os-ui.md` section 4.3). That document's
conclusion: *"A settings menu is therefore also a status page, and an operator
can answer most questions without opening anything."* It is ranked item 7 of
what mos has no answer for, assessed there as *"cheap and transport-agnostic; it
costs one extra bus read per row"* (`venus-os-ui.md` section 7 item 7).

**Verdict: adopt, with one condition.** **[proposal]** It is cheap, it is
transport-agnostic, and it suits a server-rendered UI particularly well — the
value is read at request time and rendered into the page, needing no client-side
transport. It also composes with the flat five-item nav of section 3.1: with
only five destinations, a live summary per destination is five extra bus reads
per page render, not fifty.

The condition is section 3.3's third register. **A nav row may only carry a value
mos can truthfully show.** An "Access" row may carry `sshd.activeState` and the
port, because those are applied values reported by a reconciler that drove the
unit (`mosd/mosd/src/reconciler/sshd.rs:392-403`). A "Network" row **may not**
carry an IP address until gap row 14 is closed, and until then must carry the
configuration method rather than a fabricated address. Adopting the pattern
without this condition is precisely how mos would ship the failure mode
section 2.4 exists to prevent — Venus's Ethernet row shows a real address
sourced from connman; a mos row imitating it would be showing intent in the same
visual slot.

One further note on cost, since "one extra bus read per row" is Venus's number
and not necessarily mos's. `webd`'s gate already calls `GetSettings("access")`
on **every single request**, including static-looking ones (`routes.rs:120`), so
per-request bus reads are the established shape of this application rather than
a new burden. Whether that shape scales is RFCT-044's question, not this
document's.

#### 3.4.2 Data-dependent navigation

**What Venus does.** The set of top-level pages is not fixed; `SwipePageModel`
computes it — always Brief, Overview, Notifications and Settings; Levels **only
if** `tankCount > 0 || environmentInputCount > 0`; Boat **only if** an electric
propulsion setting is enabled (`venus-os-ui.md` section 4.2). A system with no
tanks has four top-level pages and never shows an empty Levels screen. That
document calls it *"the single cheapest IA idea in the whole design: the
navigation is a function of what is attached, not a constant"*, and ranks it
item 8, assessed as *"directly applicable — a headless unit should not carry a
display pane, a unit with no Wi-Fi adapter should not carry a Wi-Fi pane"*
(`venus-os-ui.md` section 7 item 8).

**Verdict: adopt, with a fence that Venus does not need and mos does.**
**[proposal]**

Venus's condition is a *count of attached hardware*. mos's natural equivalent
would be a reconciler's live state — and that is where it goes wrong, because in
mos a **failing** reconciler does not vanish from the live-state tree: `record`
writes `{"error": "<message>"}` under the same key
(`mosd/mosd/src/bus.rs:126-137`), and gap row 18 is precisely about surfacing
that. If pane visibility were bound to "does `GetState("wifiAp")` return
something useful", then a WiFi reconciler that failed would make the WiFi pane
**disappear**, which the operator reads as "this appliance does not do WiFi"
rather than "WiFi is broken". A UI that hides subsystems when they break is
worse than one that shows them all.

The fence, therefore: **hide on absence, never on failure.**

- Hide a pane when the *hardware or the setting* is absent — no WiFi adapter, no
  display, `wifi.client.enabled == false` combined with no configured networks.
  That mirrors Venus exactly.
- **Never** hide a pane because its reconciler reported an error. Show the pane,
  and show the error inside it. The error string is already recorded and already
  readable (`bus.rs:126-137`).
- The distinguishable case mos already has is `wifiAp.accessPoint == "conflict"`
  on a single-radio unit, which carries its own explanatory sentence
  (`mosd/mosd/src/reconciler/wifi_ap.rs:739-750`). That is a *state to render*,
  not a pane to remove.

A related Venus behaviour worth taking with it: Venus keeps a device that
vanishes in the list under a cached name with a distinct delegate, plus an
explicit "remove disconnected" action, on the reasoning that *"my sensor
disappeared" is a diagnosis, not an absence* (`venus-os-ui.md` section 7 item 9).
The same argument applies to a mos interface that was configured and is no
longer present. That document notes it needs a retention decision rather than
new plumbing; the retention decision is not made here, and it interacts with the
missing delete-interface route noted in section 3.2.

---

## 4. Proposed but not yet possible

This section is what makes the proposal costable rather than aspirational.
Every item proposed in sections 2 and 3 that has no mechanism today is listed
with the `mosd` work it requires and the `mos-ui-inventory.md` section 7 gap-table
row that records it. Nothing here is scheduled or sequenced — phasing is
RFCT-046's.

### 4.1 The mosd work, per item

| # | Proposed in | What is missing | Gap row | `mosd` work required |
|---|---|---|---|---|
| 1 | 2.5, 3.2 Update page | Which slot is running, and the version in each | **row 1** | A bus method returning RAUC slot status. `grep -rci rauc mosd/mosd/src/` returns **0 across all 12 files**; `webd` cannot subprocess (`mosd/webd/src/settings_api.rs:10-12`), so this must live in `mosd`. The parse already exists in shell at `os/rootfs/overlay-v2/usr/lib/mos/mos-health:72-104` |
| 2 | 2.5, 2.7 | Boot attempt credits remaining | **row 2** | Read `BOOT_A_LEFT`/`BOOT_B_LEFT` from the redundant U-Boot environment (`os/rootfs/overlay-v2/etc/fw_env.config.in:27-29`). Carries a real hazard the file itself records at `:23-25`: **no cross-process locking** between the two existing writers |
| 3 | 2.5, 3.2 Update page | RAUC status and last install result | **row 3** | Same bus surface as item 1; the status file is on META by design (`os/rauc/system.conf.in:14-34`) |
| 4 | 2.5, 3.2 Update page | Installing a bundle at all | **row 4** | The largest single item. Signed verity-format bundles are already **built** and signature-verified against `/etc/rauc/keyring.pem` with `plain` format refused (`os/bundle.sh:1-22`, `os/rauc/system.conf.in:50-62`), but there is **no upload route, no file-receiving handler** (`Multipart` appears nowhere in `mosd/webd/`) and **no `rauc install` caller anywhere in `mosd/`**. Needs a bus method, a place to put the bundle, and a progress surface |
| 5 | 2.3, 2.5 | The boot health gate's verdict; whether the running slot is confirmed | **row 5** | The gate exists and runs `rauc status mark-good` (`os/rootfs/overlay-v2/usr/lib/mos/mos-health:111-207`); its verdict goes to the journal (`:17-18`). Needs the gate to report through `ReportHealth` (or a richer equivalent) instead of only journalling. **This is the item where mos is furthest ahead of Venus and least able to show it** — see 4.2 |
| 6 | 2.4, 3.4.1 | Observed IP address, lease, gateway, DNS in use, carrier state | **row 14** | `mosd` must **query** networkd. It already talks to `org.freedesktop.network1` for exactly one thing, `Manager.Reload` (`mosd/mosd/src/reconciler/network.rs:36-43`); it issues no `Get`, no property read and no link enumeration. This is the highest-value item on the list by operator demand |
| 7 | 2.6 | Filesystem usage per tier | **row 11** | A `statvfs` read plus a bus surface for it. The read is trivial; the surface does not exist. `/srv`, the only tier that grows (`docs/design/ro-root.md:363-368`), has **no reporting of any kind** today |
| 8 | 2.2, 3.4.1 | Observed hostname as opposed to configured | **row 13** | A read-back from hostnamed. There is no `GetHostname` call anywhere; the live-state key echoes the configured value (`mosd/mosd/src/reconciler/hostname.rs:64`) |
| 9 | 2.5, 2.10 | The power page warning that a reboot burns a boot attempt | **row 10** | No new bus primitive beyond item 1 and item 5 — it is a *dependency* the power pane does not have. Recorded at `docs/design/mosd.md:217-220` and `docs/plan/PLAN-010.md:502-503` as a deliberate M5 omission |
| 10 | 3.2 Diagnostics | A redaction rule before any state export | — (not a gap row; **[proposal]**) | `GetState("")` and `GetSettings("")` already return whole trees (`mosd/mosd/src/bus.rs:160-164`, `:197-202`), so the mechanism exists and the *policy* does not. Venus's precedent is redaction plus an access gate (`venus-os-ui.md` section 7 item 10) |

**Items needing no `mosd` work at all**, listed so they are not accidentally
costed: sections 2.2 (row 8), 2.3 part (i) (row 18), 2.7 (row 12), 2.8
(rows 6, 7, 15), the settings half of 2.4, the password-change and
delete-interface routes of section 3.2, the live-value nav rows of section 3.4.1
and the pane-visibility rule of section 3.4.2. All are UI work against bus calls
that already return the data.

One further item is out of this document's scope but should not be lost.
`SettingsChanged` is emitted after every successful write
(`mosd/mosd/src/bus.rs:249-254`, emitted at `:190-192`) and nothing subscribes:
`webd`'s proxy declares five methods and no signal member
(`mosd/webd/src/bus_client.rs:9-20`), and with zero JavaScript there is no
transport to push it over either (gap row 16). Whether a dashboard should
consume it is a live-update-technology question and therefore RFCT-044's, not
this document's.

### 4.2 Where mos is already ahead, and must not regress

The Venus comparison runs in **both** directions, and three places in this
proposal exist to protect a mos advantage rather than to close a mos gap.

1. **The boot-confirmation gate.** Venus has no bootcount, no mark-good and no
   bootloader watchdog — a grep of the whole of `meta-victronenergy` for
   `bootcount`, `boot_count`, `bootlimit`, `altbootcmd` and `rollback` returns no
   hits (`venus-os-access.md` section 5.7). It therefore has no "installed but
   not yet confirmed good" state, and its UI says nothing about one. mos has that
   gate — credits decremented before the boot and refunded only when userspace
   reaches the health gate and runs `rauc status mark-good`
   (`docs/design/uboot-ab-handshake.md:418-444`) — and has **no bus mechanism and
   no UI for it** (gap rows 2 and 5). This is the campaign's central finding:
   **mos built the better mechanism and then hid it.** The correct response is
   item 5 of section 4.1, not adopting Venus's manual "Press to boot" slot switch
   (`venus-os-access.md` section 5.6), which would replace a watchdog with a
   button.
2. **Bundle signing.** mos builds signed verity-format bundles and configures
   RAUC to refuse `plain` format outright, so *"a bundle whose payload is only
   hashed at install time can never be installed on a device"*
   (`os/rauc/system.conf.in:50-62`, bundles built by `os/bundle.sh:1-22`). Venus
   ships **no image signature on firmware** — swupdate built without
   `CONFIG_SIGNED_IMAGES` or any hash or encryption option in every machine
   defconfig read, leaving update authenticity resting on HTTPS transport for the
   online path *"and, for the offline path, on nothing but physical possession of
   the SD card"* (`venus-os-access.md` section 4.3). Any update UI proposed for
   mos (section 4.1 item 4) inherits mos's verification and must not acquire a
   "install this file anyway" affordance in the name of matching Venus's offline
   convenience.
3. **The settings/live-state boundary, and stored-versus-applied.** Both are
   section 3.3's subject: mos's boundary is two distinct bus methods rather than
   Venus's `/Settings/` substring convention, and `SetSettings` resolves
   stored-versus-applied before it returns
   (`mosd/mosd/src/bus.rs:169-194`) where Venus needs `SettingSync` and a
   give-up timer and still cannot say whether a setting was applied
   (`venus-os-ui.md` section 5.4). The proposal's ask here is only that the UI
   *use* what `mosd` already computes instead of a generic `?saved=1` banner.

Two smaller notes for completeness, neither a mos advantage. Venus models
actions as writable bus items rather than methods — a reboot is `setValue(true)`
on a platform item — which a value-forwarding remote bridge carries unchanged,
whereas mos exposes `Reboot` and `PowerOff` as D-Bus **methods**; the Venus
research calls this *"a fork in the road rather than a feature to add"*
(`venus-os-ui.md` section 7 item 2). And Venus's per-row access levels with
hide-not-disable semantics let one UI serve an owner, an installer and a support
engineer, where mos has a single `access.webAdmin` credential and one session
gate (`venus-os-ui.md` section 7 item 5). Both are architecture questions rather
than dashboard-layout questions, and both are left to RFCT-044 and RFCT-046.
