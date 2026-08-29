# The mos dashboard: landing screen and information architecture

> **Status:** proposal, for whoever builds the mos management UI. It covers the
> landing dashboard, the information architecture behind it, the live-update
> posture that supports them, and a phased delivery order.
>
> Two architectural points are settled and the rest is written on top of them.
> mos runs two processes: `mosd` owns device state and the system bus, `apid`
> owns HTTPS, sessions and the UI, and `apid` is not merged into `mosd`. The
> HTTPS management daemon is named `apid`.
>
> **Status markers** below follow `docs/design/access.md` §0 — `[implemented]`,
> `[partial]`, `[not implemented]`, and `[decided]` for a settled question.

This document proposes turning the mos management UI from a set of forms into a
dashboard. It proposes no code, no route handlers, no markup, and no rendering
or live-update technology. Where a proposal only works under some technology
choice, that is said in one line and the choice is left to section 5.

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

**Quote the source, do not merely point at it.** A line range on a file still
under change is worth what its quoted words are worth: with the quotation
travelling alongside, a reader can tell a line that merely moved from a claim
that actually changed. A bare range does not simply go stale as the file grows —
it comes to point at whatever text now occupies those bytes, and that text can
*refute* the claim citing it, so the reader who does the responsible thing and
follows the citation is misled more thoroughly than the reader who does not.
`bash docs/verify-citations.sh` enforces both halves: the range must resolve,
and where a quotation sits against it, the quoted words must still be there.

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

`apid` is one Rust crate serving **ten routes on the HTTPS listener**, built in
a single function (`os/pkgs/mosd/apid/src/routes.rs:53-74`), plus a catch-all 308
redirect router on the HTTP listener (`routes.rs:61-65`). That is the entire
HTTP surface: no nested router, no fallback, no static-asset route
(`mos-ui-inventory.md` section 2).

The operator's whole menu is **four links plus a logout button** —
`Status` (`/`), `Network` (`/network`), `Hostname` (`/hostname`),
`Power` (`/power`) — rendered by `shell()` at `os/pkgs/mosd/apid/src/routes.rs:209-219`
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

`mosd` offers an **eleven-method, one-signal** bus surface on `com.mos.mosd1`
(`os/pkgs/mosd/mosd/src/bus.rs:607`): `GetSettings`, `SetSettings`, `GetState`,
`ReportHealth`, `ForgetService`, `Reboot`, `PowerOff`, `InstallUpdate`,
`GetUpdateState`, `MarkUpdate`, `SetTransientRootPassword`, and the
`SettingsChanged` signal. `apid`'s own proxy declares four of those methods and
no signal member (`os/pkgs/mosd/apid/src/bus_client.rs:28-31`); reboot and power-off
reach `mosd` through the `com.mos.Item1` façade instead (`:33-35`).

### 1.2 The shape of the problem, in one paragraph

Ten routes, four nav links, every state change a form POST followed by a 302
and a full page re-render, and **one single `GetState` call in the entire UI** —
`GetState("network")` at `os/pkgs/mosd/apid/src/routes.rs:3075`, whose result is rendered
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
row 9). The sharpest of these was the A/B update subsystem — the largest thing
M4 built, with zero `mosd` lines referencing it when `mos-ui-inventory.md` section
7 row 1 measured it. That is dated: re-measured, `grep -rci rauc os/pkgs/mosd/mosd/src/`
finds 180 matches across 3 of 21 source files — RFCT-084's update-orchestration surface.

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
   (`os/pkgs/mosd/mosd/src/reconciler/hostname.rs:64`), and the `network` key carries the
   rendered unit file name, the configured `dhcp` flag and the configured kind —
   `"kind": kind_name(cfg.kind),`
   (`os/pkgs/mosd/mosd/src/reconciler/network.rs:660-664`) — plus, for a
   WireGuard tunnel, `entry["publicKey"] = json!(self.keys.ensure(iface)?);`
   (`os/pkgs/mosd/mosd/src/reconciler/network.rs:670`). Every one of those is
   either an echo of the settings tree or a fact about a file the reconciler
   itself wrote; not one is a reading off a link, and the public key least of
   all — it is derived from the key file, not from the tunnel. A dashboard
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
   one, that is one line and the decision is section 5's.

Each tile below is marked **(a) available today** — the feed is an existing bus
call returning the data — or **(b) needs new mosd work**, with the
`mos-ui-inventory.md` section 7 gap-table row cited.

### 2.2 Tile: identity — "which box am I looking at?"

- **Shows:** the configured hostname; the device identity (`deviceId`); the
  provisioning state (`pending` / `complete`).
- **Feed:** `GetSettings("hostname")` — already called at
  `os/pkgs/mosd/apid/src/routes.rs:3074`; `GetSettings("provisioning")`, which returns
  `state`, `deviceId` and `seededGeneration`
  (`os/pkgs/mosd/mosd-settings/src/model.rs:334-342`).
- **Availability: (a) available today.** `GetSettings("provisioning")` works
  today and `os/pkgs/mosd/apid/src/` contains zero references to it — gap-table
  **row 8**, classified UI-work-only. Identity is a *setting*, not live state,
  and is therefore reachable (`mos-ui-inventory.md` section 6.3).
- **Why it earns the first screen:** an operator with more than one appliance,
  or one browser tab open from yesterday, needs to know which machine is
  answering before any other tile means anything.
- **Caveat carried, not hidden:** the hostname shown is the **configured** one.
  The live-state `hostname` key echoes `settings.hostname` back
  (`os/pkgs/mosd/mosd/src/reconciler/hostname.rs:64`) rather than reading back from
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
  rather than disappearing (`os/pkgs/mosd/mosd/src/bus.rs:494-504`). (ii)
  `GetState("health")`, written by `report_health`
  (`os/pkgs/mosd/mosd/src/bus.rs:687`). (iii) does not exist.
- **Availability: mixed, and the split is the point.**
  - (i) is **(a) available today** — gap-table **row 18**, UI-work-only. `apid`
    calls `GetState` for exactly one path and treats any object as opaque JSON
    (`routes.rs:568`, `:587-596`), so an `error` key is today dumped as raw JSON
    in a `<pre>` rather than surfaced as a failure. This is the single cheapest
    high-value tile in the whole proposal.
  - (ii) is **(a) available today**, with a hard limitation: exactly one
    component reports health, exactly once per boot. `mos-health` calls
    `ReportHealth("var", …)` at
    `os/rootfs/overlay-v2/usr/lib/mos/mos-health:248` / `:251`, and **nothing
    ever refreshes it** (`mos-ui-inventory.md` section 6.2). The tile must
    therefore timestamp it as a boot-time reading, not present it as current.
  - (iii) is **(b) needs new mosd work** — gap-table **row 5**. A 262-line gate
    probes systemd, mosd and apid (`:111-236`) and then runs
    `rauc status mark-good`
    (`os/rootfs/overlay-v2/usr/lib/mos/mos-health:256-261`), and its verdict —
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
  `os/pkgs/mosd/mosd/src/bus.rs:494-504` already records failures durably in a place the
  bus can read. mos is missing the surface, not the detection. Venus additionally
  has a first-class notification stream with a nav-bar counter badge
  (`venus-os-ui.md` section 7 item 3); mos has no notification model at all, and
  this tile is deliberately *not* proposed as one — see section 2.10.

### 2.4 Tile: network — "what is my IP address?"

This is the tile the operator wants most and the one mos can least honestly
provide. It is designed around that.

- **The problem, stated exactly.** The live-state `network` subtree holds
  **configured** data — per interface, the unit file the reconciler wrote and
  the DHCP flag it wrote it from, built as
  `json!({ "file": file_name, "dhcp": cfg.dhcp, "kind": kind_name(cfg.kind), })`
  (`os/pkgs/mosd/mosd/src/reconciler/network.rs:660-664`). There is no address,
  no lease, no gateway, no route, no DNS server actually in use and no carrier
  state anywhere in mos (`mos-ui-inventory.md` section 6.3). A DHCP interface
  that got no lease is **indistinguishable in this tree from one that did**.
  `mosd` does talk to `org.freedesktop.network1`, but for exactly one thing —
  `Manager.Reload` (`os/pkgs/mosd/mosd/src/reconciler/network.rs:32-33`); it issues no
  `Get`, no property read and no link enumeration. Gap-table **row 14**.
- **How this proposal handles it: the tile is split in two, and the halves are
  labelled differently.** **[proposal]**
  - **Half A — "Configured" — (a) available today.** Per interface: the method
    (DHCP or static) and, for static, the configured address, gateway and DNS.
    `GetSettings("network")` returns exactly that per interface: a `dhcp` flag
    and, when it is false, a `static` block carrying `address`, `gateway` and
    `dns` (`os/pkgs/mosd/mosd-settings/src/model.rs:721-741`).
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
    (`os/pkgs/rauc/system.conf.in:83-121`, partition GUIDs at
    `os/boards/cx3576/board.env:214-224`), but there is no bus mechanism: a UI
    would have to subprocess `rauc status --output-format=shell`, and `apid`
    cannot, because it never spawns a process
    (`os/pkgs/mosd/apid/src/settings_api.rs:10-12`,
    which states *"mosd owns every system action: apid never spawns a process and
    never talks to systemd itself"*).
  - **row 2** — boot attempt credits. `BOOT_A_LEFT` / `BOOT_B_LEFT` in the
    redundant U-Boot environment (`os/rootfs/overlay-v2/etc/fw_env.config.in:49-51`),
    reachable only via `fw_printenv`, and that file's own comment at `:23-25`
    warns there is **no cross-process locking** between the two existing writers.
  - **row 3** — RAUC status and last install result, kept on the META partition
    (`os/pkgs/rauc/system.conf.in:14-34`).
  - **row 5** — the boot health gate's verdict and whether the slot was
    confirmed (shared with section 2.3).
- **Why it earns the first screen, and why this specific field.** mos's A/B
  model decrements a slot's credit **before** the boot and refunds it only when
  userspace reaches the health gate and runs `rauc status mark-good` — *"Saving
  before booting is what makes the counter a watchdog rather than a hint"*
  (`docs/design/uboot-ab-handshake.md:429`). That produces a real state that
  the operator can be in and cannot currently see: **installed, running, not yet
  confirmed good.**
- **When it is red** (running slot unconfirmed, or credits at 1): **do not
  reboot.** Rebooting a slot RAUC has installed but that has not been marked
  good **burns a boot attempt**, and today the power pane has no update-state
  awareness and does not warn — recorded as a known follow-up at
  `docs/design/mosd.md:225-228` and `docs/plan/PLAN-010.md:502-503`, and
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
  Flagged for section 5: a genuinely live progress bar is the one item on this
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
  the `health.var` detail string (`os/rootfs/overlay-v2/usr/lib/mos/mos-health:237-254`).
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
- **Feed:** mosd's live-state `uptime` key, read over the bus via `get_state`
  (`os/pkgs/mosd/apid/src/routes.rs:4791-4811`); mosd itself reads
  `/proc/uptime` (`os/pkgs/mosd/mosd/src/bus.rs:585-591`). RFCT-129 landed this.
- **Availability: (a) available today** — gap-table **row 12**, no longer via a
  side channel. The old `/proc/uptime`-in-`apid` exception to the layering
  asserted at `os/pkgs/mosd/apid/src/settings_api.rs:10-12` is closed: RFCT-129
  moved the read into `mosd` and `apid` gets uptime through the bus like every
  other system fact, so uptime now sits in the live-state tree.
  This proposal notes that a dashboard adding
  `/proc` reads to `apid` would reopen it, and that the place to decide is the
  `mosd`/`apid` boundary rather than this document.
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
  and `unitFileState` (`os/pkgs/mosd/mosd/src/reconciler/sshd.rs:429-443`);
  `GetState("wifiAp")`, which already computes `ssid` and `ssidSource` for
  exactly this purpose (`os/pkgs/mosd/mosd/src/reconciler/wifi_ap.rs:793-808`, and the
  single-radio conflict variant at `:739-750`); and `GetState("wifiClient")`,
  which publishes each known network's SSID and a `secured` boolean and never
  the PSK (`os/pkgs/mosd/mosd/src/reconciler/wifi_client.rs:508-514`).
- **Availability: (a) available today** — gap-table **rows 15, 7 and 6**
  respectively, all three classified by `mos-ui-inventory.md` section 7.1 as
  needing only UI work. `os/pkgs/mosd/apid/src/` contains **zero** references to any of
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
  pending-confirm slot burns a boot attempt (`docs/design/mosd.md:225-228`).
  Promoting an action to the first screen while it cannot state its own
  consequence is the wrong order of operations. The existing safety properties
  stay as they are: POST-only with no `GET` handler, so a browser prefetch or a
  mis-clicked link cannot power the appliance off (`routes.rs:49-51`, pinned by a
  test at `os/pkgs/mosd/apid/src/tests.rs:697`), plus a required confirmation token.
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
  publishes the PSK (`os/pkgs/mosd/mosd/src/reconciler/wifi_client.rs:501-511`); the
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
| **Diagnostics** | what happened, and what do I send to support | — | the whole tree via `GetState("")` / `GetSettings("")` | **(a)** mechanically — both already accept `""` for the whole tree (`os/pkgs/mosd/mosd/src/bus.rs:193-197`, `:197-202`) — but **(b)** for the redaction rule that must precede any export |
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
distinct bus methods** — `GetSettings` at `os/pkgs/mosd/mosd/src/bus.rs:193-197` and
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
  `Ok` (`os/pkgs/mosd/mosd/src/reconciler/hostname.rs:64`) — a confirmation that the
  write was attempted, not a read-back (`mos-ui-inventory.md` section 7, row 13).
- `network` carries the rendered unit file name, the configured `dhcp` flag and
  the configured kind — `"kind": kind_name(cfg.kind),`
  (`os/pkgs/mosd/mosd/src/reconciler/network.rs:660-664`) — and, for a WireGuard
  tunnel, the public half of the key on disk: *"Only the public half is
  published"* (`os/pkgs/mosd/mosd/src/reconciler/network.rs:668`). No observed
  value (row 14): a `wireguard` entry says which key the tunnel was built to
  use, not whether a peer is reachable, and a `vlan` or `bridge` entry says a
  `.netdev` was written, not that the device came up.
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
(`os/pkgs/mosd/mosd/src/bus.rs:202-227`, reconciler loop at `:183-188`), recording each
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
unit (`os/pkgs/mosd/mosd/src/reconciler/sshd.rs:392-403`). A "Network" row **may not**
carry an IP address until gap row 14 is closed, and until then must carry the
configuration method rather than a fabricated address. Adopting the pattern
without this condition is precisely how mos would ship the failure mode
section 2.4 exists to prevent — Venus's Ethernet row shows a real address
sourced from connman; a mos row imitating it would be showing intent in the same
visual slot.

One further note on cost, since "one extra bus read per row" is Venus's number
and not necessarily mos's. `apid`'s gate already calls `GetSettings("access")`
on **every single request**, including static-looking ones (`routes.rs:120`), so
per-request bus reads are the established shape of this application rather than
a new burden. Whether that shape scales is section 5's question, not this
section's.

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
(`os/pkgs/mosd/mosd/src/bus.rs:494-504`), and gap row 18 is precisely about surfacing
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
  readable (`bus.rs:461-471`).
- The distinguishable case mos already has is `wifiAp.accessPoint == "conflict"`
  on a single-radio unit, which carries its own explanatory sentence
  (`os/pkgs/mosd/mosd/src/reconciler/wifi_ap.rs:739-750`). That is a *state to render*,
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
section 8's.

### 4.1 The mosd work, per item

| # | Proposed in | What is missing | Gap row | `mosd` work required |
|---|---|---|---|---|
| 1 | 2.5, 3.2 Update page | Which slot is running, and the version in each | **row 1** | A bus method returning RAUC slot status — **built since this was measured**: `GetUpdateState` answers per-slot status over the bus (RFCT-084), and the dated `grep -rci rauc mosd/mosd/src/` 0-count re-measures at 180 across 3 of 21 files in `os/pkgs/mosd/mosd/src/`. `apid` cannot subprocess (`os/pkgs/mosd/apid/src/settings_api.rs:10-12`), so it lives in `mosd`. The parse also exists in shell at `os/rootfs/overlay-v2/usr/lib/mos/mos-health:72-104` |
| 2 | 2.5, 2.7 | Boot attempt credits remaining | **row 2** | Read `BOOT_A_LEFT`/`BOOT_B_LEFT` from the redundant U-Boot environment (`os/rootfs/overlay-v2/etc/fw_env.config.in:49-51`). The read hazard is answered by the RFCT-142 rule the file records at `:23-47`: all access via `fw_printenv`/`fw_setenv` under libubootenv's flock, one writer per variable — the credits stay RAUC-owned and this reader polls only |
| 3 | 2.5, 3.2 Update page | RAUC status and last install result | **row 3** | Same bus surface as item 1; the status file is on META by design (`os/pkgs/rauc/system.conf.in:14-34`) |
| 4 | 2.5, 3.2 Update page | Installing a bundle at all | **row 4** | The largest single item. Signed verity-format bundles are already **built** and signature-verified against `/etc/rauc/keyring.pem` with `plain` format refused (`os/build/src/bundle.ts:1-7`, `os/pkgs/rauc/system.conf.in:66-69`), but there is still **no upload route, no file-receiving handler** (`Multipart` appears nowhere in `os/pkgs/mosd/apid/`, re-measured on this tree). The caller half is dated: `InstallUpdate` now hands an on-device bundle path to RAUC's D-Bus `InstallBundle`, with progress read back through `GetUpdateState` (RFCT-084). Still needs the upload path and a place to put the bundle |
| 5 | 2.3, 2.5 | The boot health gate's verdict; whether the running slot is confirmed | **row 5** | The gate exists and runs `rauc status mark-good` (`os/rootfs/overlay-v2/usr/lib/mos/mos-health:256-261`); its verdict goes to the journal (`:17-18`). Needs the gate to report through `ReportHealth` (or a richer equivalent) instead of only journalling. **This is the item where mos is furthest ahead of Venus and least able to show it** — see 4.2 |
| 6 | 2.4, 3.4.1 | Observed IP address, lease, gateway, DNS in use, carrier state | **row 14** | `mosd` must **query** networkd. It already talks to `org.freedesktop.network1` for exactly one thing, `Manager.Reload` (`os/pkgs/mosd/mosd/src/reconciler/network.rs:32-33`); it issues no `Get`, no property read and no link enumeration. This is the highest-value item on the list by operator demand |
| 7 | 2.6 | Filesystem usage per tier | **row 11** | A `statvfs` read plus a bus surface for it. The read is trivial; the surface does not exist. `/srv`, the only tier that grows (`docs/design/ro-root.md:363-368`), has **no reporting of any kind** today |
| 8 | 2.2, 3.4.1 | Observed hostname as opposed to configured | **row 13** | A read-back from hostnamed. There is no `GetHostname` call anywhere; the live-state key echoes the configured value (`os/pkgs/mosd/mosd/src/reconciler/hostname.rs:64`) |
| 9 | 2.5, 2.10 | The power page warning that a reboot burns a boot attempt | **row 10** | No new bus primitive beyond item 1 and item 5 — it is a *dependency* the power pane does not have. Recorded at `docs/design/mosd.md:225-228` and `docs/plan/PLAN-010.md:502-503` as a deliberate M5 omission |
| 10 | 3.2 Diagnostics | A redaction rule before any state export | — (not a gap row; **[proposal]**) | `GetState("")` and `GetSettings("")` already return whole trees (`os/pkgs/mosd/mosd/src/bus.rs:193-197`, `:197-202`), so the mechanism exists and the *policy* does not. Venus's precedent is redaction plus an access gate (`venus-os-ui.md` section 7 item 10) |

**Items needing no `mosd` work at all**, listed so they are not accidentally
costed: sections 2.2 (row 8), 2.3 part (i) (row 18), 2.7 (row 12), 2.8
(rows 6, 7, 15), the settings half of 2.4, the password-change and
delete-interface routes of section 3.2, the live-value nav rows of section 3.4.1
and the pane-visibility rule of section 3.4.2. All are UI work against bus calls
that already return the data.

One further item is out of this document's scope but should not be lost.
`SettingsChanged` is emitted after every successful write
(`os/pkgs/mosd/mosd/src/bus.rs:282-287`, emitted at `:190-192`) and nothing subscribes:
`apid`'s proxy declares five methods and no signal member
(`os/pkgs/mosd/apid/src/bus_client.rs:14-27`), and with zero JavaScript there is no
transport to push it over either (gap row 16). Whether a dashboard should
consume it is a live-update-technology question and therefore section 5's, not
this section's.

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
   (`docs/design/uboot-ab-handshake.md:437`) — and has **no bus mechanism and
   no UI for it** (gap rows 2 and 5). This is the campaign's central finding:
   **mos built the better mechanism and then hid it.** The correct response is
   item 5 of section 4.1, not adopting Venus's manual "Press to boot" slot switch
   (`venus-os-access.md` section 5.6), which would replace a watchdog with a
   button.
2. **Bundle signing.** mos builds signed verity-format bundles and configures
   RAUC to refuse `plain` format outright, so *"a bundle whose payload is only
   hashed at install time can never be installed on a device"*
   (`os/pkgs/rauc/system.conf.in:72-74`, bundles built by `os/build/src/bundle.ts:1-7`). Venus
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
   (`os/pkgs/mosd/mosd/src/bus.rs:202-227`) where Venus needs `SettingSync` and a
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
than dashboard-layout questions, and both are left open.

---

## 5. Technology posture

One question is answered here: **can the dashboard designed in sections 2 and 3
be delivered inside `apid`'s existing constraints — server-rendered `maud`, no
JavaScript build chain, rustls-only — and if so, how do live-ish values reach
the screen?** Four transports are costed against one set of criteria, one is
recommended, and the three things sections 2 and 3 explicitly deferred here are
resolved: the live-install-progress tile (2.5), whether a partial-refresh
mechanism can coexist with the form-POST model (3.2), and whether the `?saved=1`
banner can be made to carry what `mosd` already computed (3.3).

**Licence fence, restated here so it does not live only in the campaign record.**
Venus OS gui-v2 ships under "Victron Energy OS license v1", which states *"USE OF
THE SOFTWARE AND ITS MODIFICATIONS WITH SYSTEMS WHOSE CORE IS NOT VICTRON ENERGY
PRODUCTS IS EXPRESSLY NOT AUTHORIZED"* (`gui-v2/LICENSE.txt:18-23` as verified by
`docs/research/venus-os-ui.md` section 1.5, not re-verified here); Venus is a
**study reference only** in this section as in the rest of the document, and no
code, markup, asset name or verbatim string is borrowed from it — only ideas and
interaction patterns, each attributed where used.

**What this section deliberately does not decide.** In what order any of this
is delivered is **section 8's**, not this section's. Where a recommendation
below would be changed by how the `mosd`/`apid` boundary is hardened, that is
flagged in one line and left open.

**Hard constraint honoured, and the finding that goes with it.** No npm, no
bundler, no TypeScript, no SPA framework, no component library, no CSS
framework is proposed or assumed anywhere below. Stated as a finding rather than
an assumption: **no option evaluated here requires one.** The dashboard of
section 2 is deliverable without a build chain. If that were not true, the
correct recommendation would be to abandon the dashboard rather than to acquire a
front-end toolchain, and this section would say so.

### 5.1 The constraint set, re-verified at the head of this branch

`mos-ui-inventory.md` section 3 measured this at commit
`d0bcae92656257021bb67bf7db72b8ac5bfb4651`. Everything below was re-opened and
re-read on this branch, because no crate is costed here from memory. Where this
section reads something the inventory did not, it says so.

#### 5.1.1 Rendering and assets

`apid`'s complete dependency list is 16 crates
(`os/pkgs/mosd/apid/Cargo.toml:11-28`): `anyhow`, `argon2`, `async-trait`, `axum`,
`axum-server`, `hmac`, `maud`, `rand`, `rcgen`, `rustls`, `serde`, `serde_json`,
`sha2`, `tokio`, `tracing`, `tracing-subscriber`, `zbus`. Dev-dependencies are
`reqwest`, `tempfile`, `tower` (`Cargo.toml:30-33`). **`tower-http` is absent**,
which is the mechanical reason there is no static-file route — and also, read out
of that same absence, the reason **`apid` emits no HTTP compression at all**:
compression in this stack comes from `tower_http::compression`, and the crate is
not present. Every byte counted in section 5.3 is therefore an uncompressed byte
on the wire.

The single stylesheet is a `const STYLE` at `os/pkgs/mosd/apid/src/routes.rs:182-195`,
emitted into a `<style>` element at `routes.rs:165` through `PreEscaped`.
Measured on this branch: **484 bytes** of CSS after line continuations are
resolved. This matters below only because it is the existing, working precedent
for *shipping browser-side text as a Rust string constant rather than as a build
artefact* — it is what option B would have to imitate.

`Multipart` and `http-equiv` appear nowhere under `os/pkgs/mosd/` (grepped on this
branch: 0 matches each), so there is no file-upload path and no auto-refresh
today.

#### 5.1.2 TLS and the crypto posture — and what a new crate is checked against

- `rustls = { version = "0.23", default-features = false, features = ["ring", "std", "tls12"] }`
  (`os/pkgs/mosd/Cargo.toml:70`), provider installed explicitly at
  `os/pkgs/mosd/apid/src/main.rs:48-50`; `axum-server` takes
  `tls-rustls-no-provider` (`os/pkgs/mosd/Cargo.toml:55`), which is why that install is
  mandatory rather than decorative. `rcgen` is likewise pinned to the `ring`
  backend (`os/pkgs/mosd/Cargo.toml:71`).
- The workspace **actively enforces a pure-Rust crypto posture**, and does so in
  a comment rather than by accident: `tough` is pinned to `=0.18.0` with the
  note *"tough 0.18 is the last release whose crypto backend is `ring`; 0.19+
  hard-depend on aws-lc-rs, which builds C (AWS-LC). See docs/task/RFCT-016.md."*
  (`os/pkgs/mosd/Cargo.toml:51-52`).
- Licence gate: `os/pkgs/mosd/deny.toml:3-14` allows Apache-2.0, MIT, BSD-2-Clause,
  BSD-3-Clause, ISC, Unicode-3.0, Zlib and nothing else; `[bans]
  multiple-versions = "warn"` (`deny.toml:16-17`).

**So "does this option need a new crate?" is answered below by three tests, in
this order:** is it already in `os/pkgs/mosd/Cargo.lock`; does it build C or pull
`aws-lc-rs`; is its licence on the `deny.toml` allow-list. A crate that fails any
of these is a cost, not a detail.

#### 5.1.3 What the HTTPS listener actually speaks — read out of source, not documented anywhere in this repo

This is new relative to `mos-ui-inventory.md` section 3.3, which covers the
certificate and the provider but not the protocol, and it changes the cost of
one option materially.

`main.rs:72-79` builds the listener with `RustlsConfig::from_pem` and serves it
through `axum_server::from_tcp_rustls`. Reading `axum-server` 0.7.3 from the
local registry copy of the published crate:

- `RustlsConfig::from_pem` reaches `config_from_pem` → `config_from_der`, which
  sets `config.alpn_protocols = vec![b"h2".to_vec(), b"http/1.1".to_vec()]`
  (`axum-server-0.7.3/src/tls_rustls/mod.rs:292`;
  <https://docs.rs/axum-server/0.7.3/>).
- `axum-server` serves connections through `hyper_util::server::conn::auto::Builder`
  (`axum-server-0.7.3/src/server.rs:10`) and declares `hyper` with features
  `["http1", "http2", "server"]` (`axum-server-0.7.3/Cargo.toml:158-164`).

**Consequence: `apid`'s HTTPS listener already advertises and can serve HTTP/2,
even though `axum` itself is on default features and its own `http2` feature is
off** (`axum = "0.8"` at `os/pkgs/mosd/Cargo.toml:36`; axum 0.8.9's default feature set
is `form, http1, json, matched-path, original-uri, query, tokio, tower-log,
tracing`, read from `axum-0.8.9/Cargo.toml:81-91`). Cargo feature unification
means `axum-server`'s `hyper` features are the ones that apply. This is stated as
**read out of source**; it is not documented in this repository and it was not
observed on a running appliance (see 5.13).

#### 5.1.4 The bus surface, and the single mutex behind it

`mos-ui-inventory.md` section 4 gives the six-method, one-signal surface.
Two properties read directly from `os/pkgs/mosd/mosd/src/bus.rs` on this branch bound
every option below:

1. **`apid` does not subscribe to `SettingsChanged`.** Its zbus proxy declares
   five methods and no signal member (`os/pkgs/mosd/apid/src/bus_client.rs:14-27`).
   Adding a `#[zbus(signal)]` member needs **no new crate**: `zbus` 5.19.0 is
   already in the tree and already pulls `futures-core` (`os/pkgs/mosd/Cargo.lock`, zbus
   entry at `:2906-2931`), and signal streams are part of the proxy macro. The
   workspace pin is `zbus = { version = "5", default-features = false, features = ["tokio"] }`
   (`os/pkgs/mosd/Cargo.toml:28`).
2. **All of `mosd`'s settings and live state sit behind one `tokio::sync::Mutex`.**
   `MosdService` holds an `inner: Arc<Mutex<Inner>>` (`os/pkgs/mosd/mosd/src/bus.rs:77`),
   whose own doc comment says *"Mutable trees guarded by one lock so settings
   writes and live-state updates stay consistent"* (`bus.rs:49-50`).
   `get_settings` takes it at `bus.rs:514`, `get_state` at `:539`,
   `report_health` at `:575`. Critically, the settings write takes it at
   `bus.rs:431` and **holds it across every
   overlapping reconciler's `apply().await`** (loop at `:183-188`, released by
   `drop(inner)` at `:189`).

   Read out of that: **while a reconciler is applying, every dashboard read
   blocks.** How long that is depends on the reconciler — the network reconciler
   calls `Manager.Reload` on `org.freedesktop.network1`
   (`os/pkgs/mosd/mosd/src/reconciler/network.rs:32-33`), the sshd reconciler drives a
   systemd unit (`os/pkgs/mosd/mosd/src/reconciler/sshd.rs:386-404`). This is not a
   defect to fix here; it is a **hard budget on how often a dashboard may poll**,
   and it applies identically to all four options, because all four ultimately
   read through the same lock. It is the single strongest argument in this
   section against high-frequency polling of any kind.

   One further load fact, already noted in section 3.4.1: the auth gate calls
   `GetSettings("access")` on **every** request (`os/pkgs/mosd/apid/src/routes.rs:145`),
   so every browser request costs at least one bus round trip before a tile is
   read.

3. **`SetSettings` swallows reconciler failures.** `record` writes
   `{"error": "<message>"}` into live state and logs (`bus.rs:461-471`), and
   `set_settings` returns `Ok(())` regardless (`bus.rs:183-193`). This is a
   precision refinement of section 3.3, not a contradiction of it: "stored versus
   applied" *is* resolved before the call returns, but the resolution is written
   **into the live-state tree**, not into the method's return value. Section 5.11
   is built on this.

#### 5.1.5 Two precision corrections, carried without editing sections 1-4

Both are small, both are verified, and neither changes any conclusion in
sections 1-4.

- The post-submit redirect is **303 See Other**, not 302. `Redirect::to` uses
  `StatusCode::SEE_OTHER` (`axum-0.8.9/src/response/redirect.rs:26-38`), and
  `os/pkgs/mosd/apid/src/tests.rs` asserts `StatusCode::SEE_OTHER` at 20 call sites
  (for example `:41`, `:174`, `:394`, `:587`). `mos-ui-inventory.md` section 3.2
  and section 1.2 of this document describe the pattern as "302"; the pattern —
  POST/Redirect/GET — is the same either way, and 303 is the more correct of the
  two for a form submit. Sections 1-4 are left as written.
- The HTTP-listener redirect is 308 (`os/pkgs/mosd/apid/src/routes.rs:3229-3233` and its doc
  comment at `:3166-3167`); that one is stated correctly throughout.

### 5.2 The criteria

Every option in 5.3-5.6 is costed against the same six criteria, in the same
order, so the four are comparable rather than merely described.

| | Criterion | What is being measured |
|---|---|---|
| **C1** | **Bytes shipped to the browser** | Bytes beyond the HTML that would ship anyway, plus bytes re-shipped per update. Uncompressed, because `tower-http` is absent (5.1.1) |
| **C2** | **New crates** | Named, and checked against `os/pkgs/mosd/Cargo.toml`, `os/pkgs/mosd/Cargo.lock` and `os/pkgs/mosd/deny.toml` by the three tests in 5.1.2 |
| **C3** | **JavaScript disabled** | What an operator with scripting off, or a text browser, or a hardened kiosk profile, still gets |
| **C4** | **`mosd`-side work** | New bus method? New signal? Does it need `SettingsChanged` (`bus.rs:249-254`), which exists and is unsubscribed (`bus_client.rs:9-20`)? |
| **C5** | **`mosd` down** | Today: lazy connect, cache dropped on error, per-request 502 pages, never a `apid` crash (`os/pkgs/mosd/apid/src/bus_client.rs:29-40`, `:55-72`; `bus_error` at `routes.rs:95-105`). What does the option do to that? |
| **C6** | **Operator-visible latency** | Worst-case delay between a value changing on the box and the operator seeing it |

A seventh consideration — interaction with the existing form-POST + 303 +
full re-render model — is not a per-option criterion because it has a single
answer for all four; it is 5.10.

### 5.3 Option A — full-page refresh

`<meta http-equiv="refresh" content="15">` emitted into the `<head>` by the
`shell()` helper (`os/pkgs/mosd/apid/src/routes.rs:3394-3407`) on pages that opt in.

- **C1 — bytes.** ~45 bytes of markup, once. Per update: the **entire page,
  uncompressed**. Estimate for the seven-tile dashboard of section 2, based on
  the current shell plus 484 bytes of CSS (5.1.1) plus tile content: **4-6 KB per
  refresh**. This is an estimate — the page does not exist — and is labelled as
  one. At a 15-second interval that is roughly 300-400 bytes/second per open tab.
- **C2 — new crates. Zero.** `maud` already emits arbitrary `<head>` children
  (`routes.rs:160-166`); nothing else is required.
- **C3 — JavaScript disabled. Everything works.** This is the only one of the
  four options for which that sentence is true, and it is the whole of its case.
  `meta refresh` is HTML, not script; it survives scripting being off, `noscript`
  environments and text browsers.
- **C4 — `mosd` work. None.** No new method, no signal, no subscription. Every
  tile is a read at request time, which is exactly the shape section 2.1 rule 6
  already designed for.
- **C5 — `mosd` down.** Unchanged and already correct: the refresh re-issues a
  GET, the gate's `GetSettings("access")` fails, and `bus_error` renders the
  502 page *"The management daemon is unavailable."* (`routes.rs:95-105`). The
  next refresh retries. **A dashboard that recovers by itself when `mosd` comes
  back, with no code written for that at all**, is a genuine property of this
  option and not of the other three, where a dead stream has to be reconnected
  deliberately.
- **C6 — latency.** Bounded by the interval: worst case one full interval, mean
  half of it. At 15 s that is 7.5 s mean, 15 s worst.

**Costs that must be stated, not buried.**

1. **Accessibility. This is a documented WCAG failure**, not a matter of taste:
   W3C technique **F41, "Failure of Success Criterion 2.2.1, 2.2.4, and 3.2.5 due
   to using meta refresh to reload the page"**
   (<https://www.w3.org/WAI/WCAG21/Techniques/failures/F41>, fetched and read).
   The applicable criterion is 2.2.1 Timing Adjustable, which is satisfied when
   the operator can turn the time limit off.
   **[proposal]** Therefore auto-refresh must ship with a plain link that turns
   it off — `/?refresh=off`, a GET with a cookie or query marker, no JavaScript
   involved. That is one extra link in the page chrome and it is not optional.
2. **Client-side UI state is destroyed on every refresh.** Scroll position,
   focus, and — directly relevant — the expanded/collapsed state of section 2.3's
   *"expandable to the failing detail"* health roll-up. **[proposal]** This
   imposes a design constraint back onto section 2: **any expandable tile detail
   must be encoded in the URL** (`/?open=network`) so that it survives the
   navigation, or be rendered inline and always-open. `<details>` elements reset
   to their markup-declared state on navigation, so the open state has to come
   from the server. This is a real cost of option A and it is charged here rather
   than discovered later.
3. **History-entry behaviour is browser-dependent** and was not tested here
   (5.13).
4. **Bus load.** Seven tiles plus the gate is on the order of 8-10 bus round
   trips per render (section 2.9's tile list plus `routes.rs:120`). Against the
   single mutex of 5.1.4, a 15-second interval with a handful of tabs open is
   comfortable; a 1-second interval is not. The interval is a real budget, not a
   cosmetic setting.
5. **It does not extend the session, which is correct.** `SessionStore::verify`
   reads the expiry and never rewrites it (`os/pkgs/mosd/apid/src/session.rs:66-79`);
   `SESSION_TTL` is an absolute 24 hours from creation (`session.rs:19`). So a
   tab left refreshing overnight lands on `/login` when the session expires,
   exactly as a manually reloaded tab would. Options C and D do **not** have this
   property (5.5, 5.6).

### 5.4 Option B — fetch-fragment polling in hand-written JavaScript

A `setInterval` that fetches per-tile HTML fragments from new routes and swaps
them into the DOM. No framework, no npm, no bundler; the script ships as a Rust
`const` string emitted through `PreEscaped`, exactly as `STYLE` does today
(`routes.rs:147-154`, `:165`).

- **C1 — bytes.** The script, once: **~800 bytes uncompressed** is the budget
  proposed here — enough for a fetch loop, a failure path that marks tiles stale
  instead of blanking them, and an exponential backoff. **[proposal, estimate]**
  A naive one-line version is under 200 bytes; the difference is entirely error
  handling, and shipping the naive version is how a dashboard silently shows
  values from ten minutes ago. Per update: only the changed fragments,
  **~200-600 bytes per tile** rather than 4-6 KB — roughly an order of magnitude
  less than option A per update at equal interval.
- **C2 — new crates. Zero.** A fragment route is a `maud` handler returning
  `Html<String>` like every existing one; `axum` needs no additional feature.
- **C3 — JavaScript disabled.** The initial server render still works — the page
  is complete and correct at load — but it **never updates**. **[proposal]** That
  makes a degraded mode mandatory rather than optional: the page must carry a
  server-rendered "as of HH:MM:SS" stamp so that a non-updating page reads as a
  snapshot rather than as a live view. Without that stamp this option ships the
  exact failure mode section 2.4 exists to prevent, in the time dimension instead
  of the configured/observed dimension.
- **C4 — `mosd` work. None**, but it needs **new `apid` routes**: one per
  refreshable tile, each behind the same auth gate (`routes.rs:54`), each
  returning a fragment rather than a page. That is real surface area — section
  1.1 counts ten routes today; seven tile routes would nearly double it.
- **C5 — `mosd` down.** Each fragment route returns the 502 page body
  (`routes.rs:95-105`), which would be swapped into a tile slot — visually wrong
  unless the client script special-cases the status code. This is the first
  option that needs code written specifically to degrade well.
- **C6 — latency.** Same as option A: bounded by the interval. **Polling
  frequency is not actually improved by this option** — the mutex budget of
  5.1.4 is the binding constraint, not the byte count. What B buys is *cheaper*
  updates at the same rate, and preserved scroll/focus/expansion state. What it
  does not buy is *faster* ones.

**The honest summary of B:** it is a real improvement on A in bytes and in
preserved UI state, and it costs the repository's most distinctive property —
the zero-JavaScript posture measured by four independent probes in
`mos-ui-inventory.md` section 3.2. It is not a build chain and it is not a
framework, and it should not be described as either. But once ~800 bytes of
hand-written JavaScript are in the tree, "no JavaScript" stops being a checkable
invariant and becomes a matter of degree.

### 5.5 Option C — Server-Sent Events

A long-lived `text/event-stream` response, consumed by the browser's built-in
`EventSource`.

- **C1 — bytes.** Client script: **~300-500 bytes** for an `EventSource` plus a
  per-tile dispatch. **[proposal, estimate]** `EventSource` reconnects
  automatically when the connection drops
  (<https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events>),
  so no reconnect logic is needed — this is genuinely cheaper than option D on
  the client. Per update: only the changed payload, plus SSE framing and periodic
  keep-alive comments.
- **C2 — new crates. Effectively zero, and this surprised me.** `axum`'s SSE
  support is **not feature-gated**: `pub mod sse;` is unconditional
  (`axum-0.8.9/src/response/mod.rs:7`), and `sse.rs` imports only `bytes`,
  `futures-util`, `http-body`, `pin-project-lite` and `sync_wrapper`
  (`axum-0.8.9/src/response/sse.rs:36-48`) — all already non-optional `axum`
  dependencies. To construct a stream, `apid` would add **`futures-util`** as a
  direct dependency; it is already resolved in the tree at **0.3.34**
  (`os/pkgs/mosd/Cargo.lock`), licence `MIT OR Apache-2.0` (read from the local registry
  copy of `futures-util-0.3.34/Cargo.toml`), which is on the `deny.toml`
  allow-list (`deny.toml:6-14`). Pure Rust, no C. **So option C adds one line to
  `os/pkgs/mosd/apid/Cargo.toml` and zero crates to the compiled graph.** (`tokio-stream`
  would be the more ergonomic choice and **is not** in `os/pkgs/mosd/Cargo.lock` — that
  one is a genuine new crate and is not needed.)
- **C3 — JavaScript disabled.** Nothing updates. `EventSource` is a scripting
  API; there is no markup-level SSE consumer. Identical degraded story to option
  B, and it needs the same server-rendered timestamp.
- **C4 — `mosd` work. This is where the option collapses, and it is the decisive
  finding of this section.** SSE is a *push* transport, and push requires
  something to push. `mosd` emits **exactly one signal**, `SettingsChanged`
  (`os/pkgs/mosd/mosd/src/bus.rs:633-637`, declared at `:817-822`) — and it fires on
  **settings** writes. For **live state** — the IP address of section 2.4, the
  storage figures of 2.6, the slot state of 2.5, install progress — there is **no
  signal of any kind**. `record` mutates the live-state tree in place
  (`bus.rs:461-471`) and announces nothing.

  So an SSE dashboard would be `apid` polling `mosd` on a timer internally and
  forwarding to the browser: **the same bus load as option A, through the same
  mutex, plus a persistent connection per tab.** The push is a fiction one hop
  from the browser. Making it real means a new `mosd` signal — a `StateChanged`,
  or a subscription mechanism — which is `mosd` work in the same class as gap
  rows 1-5 and 14, and which nothing in this campaign has proposed or costed.
- **C5 — `mosd` down.** Worse than A in a way that matters. `bus_client`'s
  degradation is **per-request** by construction (`bus_client.rs:22-25`,
  `:41-58`): an error drops the cached proxy so the *next request* reconnects.
  An open SSE stream is not a next request. The stream handler has to detect the
  failure, emit an error event, and either keep the stream open emitting failures
  or close it and rely on `EventSource`'s automatic retry. Either is fine; both
  are code that does not exist and that option A does not need.
- **C6 — latency.** Sub-second *if* there were a real push source. Given C4,
  actual latency equals `apid`'s internal poll interval, which is governed by the
  same mutex budget as A and B. **The latency advantage is theoretical until
  `mosd` grows a state-change signal.**

**Two further costs specific to C.**

- **Connection budget.** MDN documents the limit plainly: *"When not used over
  HTTP/2, SSE suffers from a limitation to the maximum number of open
  connections, which can be especially painful when opening multiple tabs, as
  the limit is per browser and is set to a very low number (6)"*, against *"the
  maximum number of simultaneous HTTP streams is negotiated between the server
  and the client (defaults to 100)"* under HTTP/2
  (<https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events>).
  Per 5.1.3, `apid`'s HTTPS listener **does** advertise `h2` via ALPN, so this
  limit probably does not bind — but that is read out of `axum-server`'s source
  and was not confirmed against a browser negotiating h2 to `apid`'s self-signed
  certificate after a security exception (5.13). Under HTTP/1.1 fallback, one
  open dashboard tab consumes one of six connections for the whole origin.
- **The session outlives the gate.** The auth gate is per-request middleware
  (`routes.rs:115-138`). An established stream is not re-gated, so it keeps
  delivering after the session's absolute 24-hour TTL expires
  (`session.rs:19`, `:66-79`) until the connection drops. Option A has the
  opposite and better behaviour (5.3, cost 5). Closing this needs an explicit
  in-stream expiry check — again, code that A does not need.

### 5.6 Option D — WebSocket

- **C1 — bytes.** Client script **~900 bytes** **[proposal, estimate]** — larger
  than C because `WebSocket` has **no** automatic reconnect, so the backoff loop
  that `EventSource` provides for free must be hand-written. Per update: the
  smallest framing of the four.
- **C2 — new crates. Three, and this is the only option that fails the test.**
  `axum`'s `ws` feature is
  `["dep:hyper", "tokio", "dep:tokio-tungstenite", "dep:sha1", "dep:base64"]`
  (`axum-0.8.9/Cargo.toml:133-139`), with `tokio-tungstenite` at 0.29.0
  (`axum-0.8.9/Cargo.toml:264-266`). Checked against `os/pkgs/mosd/Cargo.lock` on this
  branch: **`tokio-tungstenite` — absent. `tungstenite` — absent. `sha1` —
  absent.** (`base64` is present, at two versions.) `tungstenite` in turn pulls
  its own dependency set. All are pure Rust and all are `MIT`/`Apache-2.0`-family
  so the `deny.toml` gate would pass, but `[bans] multiple-versions = "warn"`
  (`deny.toml:16-17`) would have more to warn about. Three new crates against
  zero for options A, B and C is not a marginal difference.
- **C3 — JavaScript disabled.** Nothing updates, same as B and C.
- **C4 — `mosd` work.** Identical to option C, and the same collapse: there is
  nothing to push. WebSocket's distinguishing feature over SSE is the
  **client-to-server** direction, and the dashboard of section 2 is **read-only
  by rule 1 of section 2.1**. The one capability D has that C lacks is the one
  capability this design has explicitly refused.
- **C5 — `mosd` down.** Same as C, but worse: no automatic reconnect.
- **C6 — latency.** Same as C, and theoretical for the same reason.

**The security cost that decides it.** `mos-ui-inventory.md` section 3.4 records
that **there is no CSRF token anywhere in `apid`**; the only cross-site
mitigation is `SameSite=Lax` (`os/pkgs/mosd/apid/src/session.rs:121`) plus POST-only
destructive routes with a confirmation field (`routes.rs:49-53`, `:820`).
`SameSite` cookie semantics do not cover the WebSocket handshake, so a writable
WebSocket endpoint — one that reaches the reboot and power-off members behind
the bus — would want explicit `Origin` checking before it shipped. **[my
inference, from the absence of CSRF machinery plus the handshake's cookie
semantics; not verified against an exploit and not something this campaign
tested.]** Opening a bidirectional channel to buy a
direction the design does not use, on an application with no CSRF defence, is
the wrong trade.

**The bus policy does not help here.** `com.mos.mosd` is root-only in both
directions, but the CSRF gap is in `apid`'s own HTTP surface: a WebSocket
hijacked through the operator's authenticated browser acts *as* `apid`, which
is root and permitted to call every member. Closing the bus to unprivileged
callers does not close a cross-site path that arrives holding a valid session
cookie.

### 5.7 Side by side

| | **A** full-page refresh | **B** fetch-fragment polling | **C** SSE | **D** WebSocket |
|---|---|---|---|---|
| **C1** bytes, one-off | ~45 B markup | ~800 B script *(est.)* | ~300-500 B script *(est.)* | ~900 B script *(est.)* |
| **C1** bytes, per update | 4-6 KB, whole page, uncompressed *(est.)* | ~200-600 B/tile *(est.)* | payload + framing | payload + framing |
| **C2** new crates | **0** | **0** | **0** (`futures-util` 0.3.34 already in `Cargo.lock`) | **3** — `tokio-tungstenite`, `tungstenite`, `sha1`, all absent from `Cargo.lock` |
| **C3** JS disabled | **fully works** | initial render only | initial render only | initial render only |
| **C4** `mosd` work | **none** | none (+7 `apid` routes) | none *to build it* — but the push is a fiction without a new state-change signal | same as C |
| **C5** `mosd` down | already correct, self-healing, zero new code | fragment routes return the 502 body into a tile slot | stream needs explicit error/retry handling | same as C, plus hand-written reconnect |
| **C6** latency | interval-bound (15 s proposed) | interval-bound — **no better than A** | sub-second *in theory*; interval-bound *in fact* | same as C |
| **Preserves scroll / focus / expansion** | **no** | yes | yes | yes |
| **Survives session expiry correctly** | **yes** | yes | no, without extra work | no, without extra work |
| **Keeps the zero-JS invariant** | **yes** | no | no | no |

### 5.8 Recommendation

**Adopt option A — full-page refresh — as the dashboard's only live-value
mechanism, at a 15-second default interval, with a no-JavaScript off switch.**

The reasoning is four facts from above, not a preference:

1. **C4 kills the push options.** `mosd` has one signal and it is about
   *settings* (`bus.rs:249-254`). There is no live-state change notification of
   any kind. C and D therefore do not deliver push; they deliver `apid` polling
   `mosd` with a persistent browser connection stapled on. Their headline
   advantage does not exist yet, and buying the transport before the signal is
   paying for a pipe with nothing at the far end.
2. **C6 is identical across all four options**, because the binding constraint is
   `mosd`'s single mutex (5.1.4), not the wire format. No option evaluated here
   makes the dashboard meaningfully fresher than any other.
3. **C3 is the only criterion on which the options genuinely differ**, and A is
   the only one that keeps working. Against a *headless appliance* — where the
   browser may be an unfamiliar one on a phone on a setup access point — that is
   worth more than 4 KB per refresh.
4. **C2 and C5 both favour A**, and C5 favours it for free: `bus_client`'s
   per-request degradation (`bus_client.rs:22-25`) is already exactly the right
   behaviour for a page that re-fetches itself, and exactly the wrong shape for a
   long-lived stream.

**What this buys.** The dashboard of section 2 becomes deliverable with **no new
crate, no new `mosd` mechanism, no new client-side technology and no change to
the zero-JavaScript posture** — and every tile that section 2.9 marks **(a)
available today** ships as soon as it is written. The technology question stops
blocking anything.

**What this forecloses, stated plainly.**

- **Any value meaningful at sub-15-second resolution.** A moving needle, a
  throughput graph, a load average — none of these are renderable under A.
  Section 2.10 already refuses CPU, memory, load and temperature tiles on
  independent grounds, so nothing currently proposed is lost. But if a future
  tile needs a moving value, this recommendation is what has to be revisited, and
  the revisit should start at option B.
- **Client-side UI state.** Scroll, focus, and expanded detail are destroyed on
  every refresh. Section 5.3 charges this as a design constraint back onto
  section 2.3: **expandable detail must be URL-encoded, not client-side**. This
  is the concrete price paid.
- **Immediate reaction to a change made by another actor.** `SettingsChanged`
  stays unsubscribed at the browser boundary, so a config change made from a
  second session or by a local bus caller — the D-Bus policy admits only root
  (`os/pkgs/mosd/dist/com.mos.mosd.conf:69-79`), which narrows the set of second actors
  without emptying it: root scripts and `busctl` still qualify, and the health
  gate is one — appears within one refresh interval rather than at once. For an
  appliance with one admin credential (`mos-ui-inventory.md` section 3.4) this
  is the right trade.
  Note the two are separable: **`apid` could subscribe to `SettingsChanged`
  server-side** — no new crate, per 5.1.4 item 1 — for cache invalidation or a
  render stamp, entirely independently of any browser transport. Gap row 16 is
  therefore *partly* closable under this recommendation. Doing so is scheduled
  as phase 3 in section 8.2.
- **It does not foreclose option B.** A is not a one-way door: the fragment
  routes of option B are additive to a server-rendered page, and 5.9 names the
  single circumstance under which they should be built.

### 5.9 The tile section 2.5 handed over: live install progress

Section 2.5 flagged exactly one item as materially technology-dependent: *"a
genuinely live progress bar is the one item on this screen that a server-rendered
page cannot show well"*, borrowing from Venus's practice of publishing real
percentage progress from the installer's own progress socket rather than guessing
(`venus-os-access.md` section 5.4 and section 6 item 5, cited via section 2.5).

**The first thing to say is that this tile still cannot be built today, for
reasons that have nothing to do with transport.** Gap row 4: there is no upload
route and no file-receiving handler (`Multipart` appears nowhere under
`os/pkgs/mosd/`, re-measured on this tree). The install caller half is dated:
`InstallUpdate` hands a bundle path to RAUC over D-Bus and `GetUpdateState`
reads progress back (RFCT-084) — but with no upload route, no bundle arrives.
**The transport is not this tile's blocker and choosing SSE would not unblock it.**

**Under the recommendation, once row 4 exists** — **[proposal]**:

- The update page — **not the dashboard** — opts into a **2-second**
  `meta refresh` for the duration of an install, and renders the percentage as
  text plus a `<progress>` element, which is a native HTML element requiring no
  script and no styling framework.
- The 2-second interval is affordable **only because it is scoped to one page
  during one operation**: it reads one live-state key rather than the dashboard's
  eight to ten, and an install is a bounded event, not a steady state. The mutex
  budget of 5.1.4 is respected because the load is one read every two seconds,
  not eighty.
- The refresh is emitted **only while an install is in progress** and removed on
  completion, so the page settles rather than reloading forever. That also keeps
  the WCAG exposure of 5.3 bounded to a screen the operator is actively watching,
  and the off-switch link still applies.
- The dashboard tile itself (section 2.5) shows the *state* — installing, at what
  percentage as of the last render — and links to the update page. It does not
  animate.

**The degraded form, which is the part that matters.** Two distinct degradations,
and they must not be conflated:

- **If `meta refresh` is unavailable** (scripting is irrelevant here, but a text
  browser or a hardened profile may ignore it): the page is still complete and
  correct at load, showing the percentage as of that render, with the "as of"
  stamp and an explicit **"Reload for current progress"** link. The operator gets
  a manual refresh button instead of an automatic one. Nothing is hidden and
  nothing is fabricated.
- **If progress reporting itself is unavailable** — that is, row 4 lands with an
  install method but no progress feed: the page must show **"installing, progress
  not reported"** and the elapsed time since the install started. It must **not**
  show an indeterminate animated bar, and it must **not** interpolate a
  percentage. Section 2.4's rule applies unchanged in the time dimension: a
  progress bar that moves without a source is the same lie as an IP address that
  is really a configured intent. An honest elapsed-time counter is what stops an
  operator power-cycling mid-install, and that is the entire purpose section 2.5
  claimed for this tile.

**What this concedes.** A 2-second page reload is a worse progress experience
than a smoothly updating bar, and this section does not pretend otherwise. It is
recommended because it costs nothing, ships with the rest of the dashboard, and
is honest. **If, once row 4 exists, the 2-second reload measures as
unacceptable in practice, option B is the pre-approved escalation for this one
route** — a ~300-byte fetch loop against a single progress fragment, with the
byte count stated in the commit and the script shipped as a `PreEscaped` string
constant like `STYLE` (`routes.rs:147-154`, `:165`), never as a build artefact.
It must not spread to the dashboard, and the trigger for it is a measurement, not
a preference.

### 5.10 Can a partial-refresh mechanism coexist with POST + 303 + full re-render?

**Yes — under one rule, and the rule falls out of section 2.1 rather than being
invented here.**

**The rule: auto-refresh is permitted on read-only pages and forbidden on any
page containing a form.** **[proposal]**

This is not a compromise; it is a restatement of section 2.1 rule 1 — *"Read-only.
No form, no control, no destructive action"* — which already makes the landing
screen exactly the class of page that is safe to refresh. The result is a clean
partition with no overlap:

| Page class | Update path | Why |
|---|---|---|
| Dashboard, update page, diagnostics — **read-only** (section 2.1 rule 1, section 3.2) | `meta refresh`, GET, interval-bound | No form state to destroy. Nothing to lose on navigation except scroll and expansion, which 5.8 charges as a known cost |
| Network, Access, Hostname, Power — **editors** (the form routes of `routes.rs:44-53`) | POST → 303 → full re-render, unchanged | A refresh mid-typing would discard the operator's input. Absolutely forbidden |

**So the UI has one update path, not two.** Every update in the product — a
refresh tick and a form submit alike — is *a GET that renders the whole page
from current server state*. `meta refresh` does not introduce a second rendering
model; it introduces a second **trigger** for the one that already exists. That
is precisely why this option coexists and why options B, C and D do not without
care: those three introduce a genuinely different rendering path — a fragment
route producing markup that must stay consistent with the full-page render of the
same tile — and therefore two places where a tile's HTML is defined. Under option
B that duplication is manageable (one `maud` function called from both handlers)
but it is real, and it is a maintenance cost worth naming since 5.9 leaves option
B on the table for one route.

Two mechanical points, verified:

- The 303 target is a GET (`Redirect::to` → `SEE_OTHER`,
  `axum-0.8.9/src/response/redirect.rs:26-38`), so a refreshing dashboard reached
  after a submit re-renders normally with no resubmission prompt.
- The power routes are POST-only with no GET handler (`routes.rs:49-53`, pinned
  by `os/pkgs/mosd/apid/src/tests.rs:697`). A `meta refresh` issues a GET and therefore
  **cannot** trigger a power action even if one were somehow placed on a
  refreshing page. Section 2.10's exclusion of power buttons from the landing
  screen stands on its own reasoning; this is an independent second layer, and it
  is worth recording that adopting auto-refresh does not weaken it.

### 5.11 The `?saved=1` banner

`mos-ui-inventory.md` section 3.2 and section 3.3 of this document both observe
that `SetSettings` runs the overlapping reconcilers **before** returning, so
"stored versus applied" is resolved server-side and the `?saved=1` marker
(`routes.rs:205-209`, banner at `:202-204`) discards information `mosd` already
computed. The question put to this section is whether the recommendation lets
that information reach the operator.

**Yes, fully — and the finding is that this was never a live-value transport
question at all.** It is a server-rendering question, and it is answerable under
option A exactly as well as under SSE. The evidence, read on this branch:

1. **The outcome is not in the return value.** `set_settings` returns
   `fdo::Result<()>` and calls `record` for each overlapping reconciler
   (`os/pkgs/mosd/mosd/src/bus.rs:216-221`); `record` writes `Ok(value)` or
   `{"error": "<message>"}` into the live-state tree and **logs the failure
   rather than propagating it** (`bus.rs:461-471`). `set_settings` then returns
   `Ok(())` (`bus.rs:193`). So today, `apid`'s `Ok(())` from
   `bus_client.rs:74-83` means *"persisted, and every overlapping reconciler
   ran"* — **not** *"applied successfully"*. This refines section 3.3, which is
   right that the resolution happens before the call returns; it happens into the
   live-state tree, not into the reply.
2. **Therefore the fix is one extra `GetState` on the redirect target**, and
   nothing else. `network_submit` writes `network.<iface>` and 303s to
   `/network?saved=1` (`routes.rs:696-720`); `network_form` then calls
   `GetSettings("network")` (`routes.rs:687`). **[proposal]** It should also call
   `GetState("network")` and render *the reconciler's recorded outcome* in place
   of the generic banner: the applied result on success, and on failure the
   recorded `error` string, in the error register rather than the green `.saved`
   one (`STYLE` already carries both, `routes.rs:153-154`). The same shape
   applies to `hostname_form` and to any future editor.
3. **The read-after-write is sound.** `record` uses `map.insert` unconditionally
   (`bus.rs:134-136`), so a successful apply always overwrites a stale `error`
   entry from an earlier attempt. There is no risk of showing a previous
   failure as if it were this one.
4. **`GetState` on a not-yet-written key errors rather than returning null** —
   `InvalidArgs` on an absent path (`bus.rs:198-202`) — so the handler must treat
   "no state recorded for this reconciler" as its own case, distinct from
   success and from failure.

**Two caveats, stated because they are real.**

- **A narrow race.** Between `SetSettings` returning and the follow-up
  `GetState`, another writer could re-run the same reconciler and replace the
  entry. `mosd`'s D-Bus policy admits only root to the bus name, in both
  directions (`os/pkgs/mosd/dist/com.mos.mosd.conf:69-79`), which makes the race rarer
  rather than impossible: every caller in the tree is already root, so this is a
  `mosd` concurrency question rather than an access-control one. On a
  single-admin appliance this is
  vanishingly unlikely, and the honest closure is a `mosd` change — returning the
  outcome from `SetSettings`, or stamping `record` entries — not a `apid` one.
  **`record` writes no timestamp and no generation** (`bus.rs:461-471`), so
  `apid` cannot detect the race locally. Noted, not designed around.
- **Cost.** One extra bus round trip on the redirect target only — on a form
  submit, which is already the most expensive operation in the UI (a
  `SetSettings` that runs reconcilers under the global mutex, 5.1.4). It is
  irrelevant against that.

**Why this belongs in the technology section and not only in section 3.3:** it is
the clearest case in the whole campaign of a "live value" problem that has a
**server-rendering** answer. mos already computes the thing the operator needs;
what is missing is one read and one branch in a `maud` template. No transport,
no crate, no `mosd` mechanism, no JavaScript. Section 4.2 item 3 records
stored-versus-applied as a place mos is ahead of Venus — which needs
`SettingSync`, a 500 ms/3000 ms give-up timer, and *still* cannot say whether a
setting was applied (`venus-os-ui.md` section 5.4). Under this recommendation
mos can say it, in the plainest possible way, and shipping `?saved=1` while
holding that capability is the sharpest small example of section 1.2's thesis:
**the appliance knows things it never says.**

### 5.12 Summary of what section 5 decides

**[proposal]**, all of it.

| Question | Decision |
|---|---|
| Is the section 2-3 dashboard deliverable under the existing constraints? | **Yes**, with no new crate, no build chain and no change to the zero-JavaScript posture |
| Live-value transport | **Option A**, `meta http-equiv="refresh"`, 15 s default on read-only pages, with a no-script off link (WCAG F41 / SC 2.2.1) |
| Live install progress (section 2.5) | Update page only, 2 s refresh during an install, `<progress>` plus text; degraded forms specified in 5.9; **blocked on gap row 4 regardless of transport** |
| Coexistence with POST + 303 | **Yes** — refresh on read-only pages, forbidden on editors; one rendering model, two triggers |
| `?saved=1` | **Replace it** with the reconciler's recorded outcome via one extra `GetState` on the redirect target; not a transport question |
| `SettingsChanged` (gap row 16) | Browser-side push: **not adopted**. Server-side subscription in `apid`: **possible with no new crate**, scheduled as phase 3 in section 8.2 |
| Escalation path | Option B, hand-written, ~800 B as a `PreEscaped` string constant, for the install-progress route only, only on a measurement |
| Options C and D | **Rejected**; C for delivering no real push until `mosd` has a state-change signal, D for that plus three new crates and a bidirectional channel the read-only design does not use |

### 5.13 Unverified / gaps

Listed because an unmarked wrong claim in a reference document is worse than an
admitted gap.

1. **Nothing in this section was observed on a running appliance.** No `apid`
   binary was built or started, no browser connected, no protocol trace taken.
   This is a documents-only campaign and `cargo` was deliberately not run. Every
   claim above is read from source or from published documentation.
2. **HTTP/2 in practice (5.1.3).** I verified that `axum-server` 0.7.3 sets
   `alpn_protocols = ["h2", "http/1.1"]` and serves through `hyper-util`'s auto
   builder with `hyper` features `http1`+`http2`, and that `main.rs:72-79` uses
   that path. I did **not** verify that a browser negotiates `h2` to `apid`
   *after the operator accepts the self-signed-certificate exception*
   (`os/pkgs/mosd/apid/src/tls.rs:47-81`). If it falls back to HTTP/1.1, MDN's
   six-connection limit
   applies to option C. This does not change the recommendation, which rejects C
   on C4 grounds regardless.
3. **All byte figures for markup and scripts that do not exist are estimates**
   and are labelled `(est.)` in the table of 5.7. The two measured figures in
   this section are the 484-byte inline stylesheet (5.1.1) and Venus's
   15,793,432-byte compressed WASM payload (`venus-os-ui.md` section 2.3, not
   re-measured here).
4. **Crate resolution was read from `os/pkgs/mosd/Cargo.lock` and from the local
   registry copies of published crates**, not from a resolved build graph. In
   particular, `os/pkgs/mosd/Cargo.lock` includes entries for optional dependencies in
   some cases, so "absent from the lock" is a stronger signal than "present in
   the lock". The three crates named as new in option D — `tokio-tungstenite`,
   `tungstenite`, `sha1` — are **absent**, which is the direction that matters.
   `futures-util` 0.3.34 is **present**, which is the weaker of the two signals;
   if it turned out to be an unactivated optional entry, option C would cost one
   pure-Rust crate rather than zero, and the recommendation would be unchanged.
5. **The CSRF/WebSocket-handshake argument in 5.6 is my inference**, drawn from
   the absence of any CSRF token in `apid` (`mos-ui-inventory.md` section 3.4)
   plus the cookie semantics of the WebSocket handshake. It was not tested and no
   exploit was attempted. It is a reason to prefer not opening the channel, not a
   report of a vulnerability.
6. **The mutex-contention argument in 5.1.4 is read out of source and not
   measured.** `mosd`'s single `Mutex<Inner>` is real and `set_settings` provably
   holds it across `reconciler.apply().await` (`bus.rs:177-189`), but no reconcile
   was timed. The 15-second and 2-second intervals proposed above are engineering
   judgement calibrated against that structure, not against a measurement. If
   this recommendation is implemented, the intervals should be re-derived from a
   measured reconcile duration.
7. **WCAG.** F41's title and the success criteria it fails were fetched and read
   from <https://www.w3.org/WAI/WCAG21/Techniques/failures/F41>. The precise
   wording of SC 2.2.1's exceptions was **not** re-read; the off-switch proposed
   in 5.3 is the conventional remedy and should be checked against the criterion
   text before implementation.
8. **`docs/design/access.md`, `docs/design/provisioning.md` and
   `docs/design/mosd.md`** are owned by the parallel `sshweb` campaign and were
   not opened for this section. Where section 4 of this document cites
   `docs/design/mosd.md:225-228`, that citation is carried through unchecked.
   Likewise the in-flight SSH work on `bkd/hiu25adw` (`mos-ui-inventory.md`
   section 8) is not in this tree; if it adds routes, the route count in 5.1.1
   and the fragment-route count in 5.4 are both understated.

---

## 8. Phased delivery

Milestones, each with scope, `mosd` prerequisites cited by gap-table row, and
how it is verified. Phase 1 is shippable on its own and **does not depend on any
change to the `mosd`/`apid` boundary**; that independence is stated explicitly
in 8.1 because it is the property that keeps the architecture question from
blocking the product.

### 8.1 What is architecture-independent, stated first

**Nothing in phase 1 depends on how the two-process boundary is hardened.**
Concretely, none of the following touches a unit file, a D-Bus policy, a process
boundary, a uid, or `mosd`:

- Every tile section 2.9 marks **(a) available today** — 2.2 identity (gap
  row 8), 2.3 part (i) reconciler errors (row 18), 2.7 uptime (row 12), 2.8
  access surface (rows 6, 7, 15), and half A of 2.4 network-configured.
- The IA of section 3: the flat five-item nav (3.1), the page inventory (3.2),
  the three registers configured/applied/observed (3.3), live-value nav rows
  (3.4.1) and hide-on-absence-never-on-failure (3.4.2).
- Section 5.8's transport decision — `meta http-equiv="refresh"` at 15 s on
  read-only pages, with the WCAG F41 off-switch — and section 5.10's rule that
  auto-refresh is forbidden on any page with a form.
- Section 5.11's replacement of `?saved=1` with the reconciler's recorded
  outcome, which is one extra `GetState` on the redirect target and one branch
  in a template.

**Why they are independent:** all of them are HTTP handlers calling
`SettingsApi` (`os/pkgs/mosd/apid/src/settings_api.rs:13-20`), a trait whose entire
purpose is that the transport underneath it is substitutable — its doc comment
says handlers depend on it *"so tests can substitute an in-memory fake for the
D-Bus client"* (`settings_api.rs:1-4`). Whatever changes beneath that trait —
a tightened bus policy, a different uid, a different transport — **the handlers
do not change.** That is the strongest practical argument for shipping phase 1
before any of the boundary work.

### 8.2 The phases

#### Phase 1 — the dashboard that is buildable today

**Scope.** The list in 8.1. Result: a landing screen answering identity, health
(reconciler errors and the boot-time `/var` reading), uptime and access surface;
the network tile shipping with half A labelled *configured* and half B rendering
the labelled absence section 2.4 requires; the five-item nav with live secondary
values where truthful; auto-refresh with its off switch; and settings POSTs that
render what the reconciler actually did.

**`mosd` prerequisites: none.** Every feed is an existing call. Gap rows 8, 18,
12, 6, 7, 15 are classified UI-work-only by `mos-ui-inventory.md` section 7.1,
and 5.11's outcome rendering needs only `GetState` on a path `SetSettings` has
just written.

**One dependency that is not a `mosd` prerequisite:** gap row 15 (SSH) is in
flight on the `sshweb` branch (`mos-ui-inventory.md` section 8), which is **not
in this tree**. Section 2.8's SSH half and section 3.2's Access row must be
re-measured against the route inventory after that merge, as
`mos-ui-inventory.md` section 2 instructs.

**Verification.**
- Handler tests against the in-memory `SettingsApi` fake, following the existing
  pattern — `os/pkgs/mosd/apid/src/tests.rs` is 591 lines of exactly this shape.
- Three specific behaviours are worth pinning as tests because they are the ones
  a refactor silently loses: a reconciler whose live-state entry is
  `{"error": ...}` renders in the error register and **not** as raw JSON
  (`bus.rs:461-471` produces it; `routes.rs:587-596` is what must stop dumping
  it); network half B renders its absence statement and never borrows half A's
  numbers (section 2.4); and a pane whose reconciler failed is **shown with the
  error**, never hidden (section 3.4.2's fence).
- The auto-refresh off-switch is reachable without JavaScript (section 5.3
  cost 1, WCAG F41).
- Image contract unchanged: the packed-image unit checks at
  `os/verify/src/checks-root.ts:210-221` should still pass untouched. **If phase 1 changes anything the verifier asserts, phase 1 has
  left its scope.**

#### Phase 2 — building the boundary the two processes imply

Two processes only buy privilege separation once the boundary is actually
built, and today it is not: `apid` runs as root with no sandboxing directive of
any kind. This phase builds it. **[not implemented]** — none of it is
scheduled.

**Scope.**
1. A static system user created in the rootfs (`os/rootfs/scripts/account-mos.sh`), a
   rewritten `os/pkgs/mosd/dist/apid.service` carrying `User=`,
   `AmbientCapabilities=CAP_NET_BIND_SERVICE`, a matching
   `CapabilityBoundingSet=`, and a sandboxing set checked against the one
   unusual thing `apid` still does — it needs the system bus (the
   `/proc/uptime` read moved into `mosd`, RFCT-129).
2. A `user="apid"` block in `os/pkgs/mosd/dist/com.mos.mosd.conf`. The policy is
   already default-deny in both directions with root allowed
   (`os/pkgs/mosd/dist/com.mos.mosd.conf:69-79`), and the file sketches the block to add
   at its `EXTENSION POINT` comment; the per-member narrowing beyond it is what
   that same comment defers, with reasons. The members `apid` needs are the four
   its proxy declares (`os/pkgs/mosd/apid/src/bus_client.rs:28-31`), and `ReportHealth`
   and `GetState` stay with root — the health gate's two calls.

**`mosd` prerequisites: none — this phase closes no gap-table row.** It is
posture, not capability, and it is worth saying so: nothing an operator can see
changes.

**Verification.**
- New verifier assertions beside the existing unit checks at
  `os/verify/src/checks-root.ts:210-221`: the unit carries `User=`,
  `NoNewPrivileges=`
  and `ProtectSystem=`; and the policy file no longer contains a bare
  `<allow send_destination="com.mos.mosd"/>` in the `default` context.
- **The honest end-to-end test is the boot health gate itself.** Probe c
  (`os/rootfs/overlay-v2/usr/lib/mos/mos-health:216-232`) fetches `https://127.0.0.1/healthz` on port
  443; probe b (`:202-213`) calls `com.mos.mosd1 GetState` over `busctl` as
  root. If the capability change broke the port bind, probe c fails. If the
  allowlist was written wrong, probe b fails. Both fail the gate loudly. That is
  a better test than any assertion about file contents, and it already exists.
- Verify the deployed-device ownership question **before** shipping, not after:
  does systemd re-chown an existing `/var/lib/mos/apid` when `User=` is added to
  a unit that has been running as root? It is unverified, and it is the one item
  here that could surprise an upgrade.
- Confirm the known breakage: any local script calling `com.mos.mosd1`
  outside the allowlist stops working. That is the intent, and it belongs in the
  release note. Non-root callers are already shut out by the default-deny
  policy, so what is left for this phase to break is narrower: root callers
  outside a per-member allowlist, and anything assuming `apid` may still call
  every member once it has its own uid.

#### Phase 3 — the read primitive and the outcome-carrying write

**Scope.** Two `mosd` bus primitives: (a) a multi-path read with per-path
errors, and (b) an outcome-carrying settings write. Plus the cheap, independent
piece section 5.8 left open: **`apid` subscribing to `SettingsChanged`
server-side**, which needs no new crate (`zbus` is already in the tree; section
5.1.4 item 1) and which partly closes gap **row 16**.

**Why after phase 2 and not before:** (b) is what fixes `set_settings`
returning `Ok(())` even when a reconciler fails — `record` writes
`{"error": "<message>"}` into the live-state tree and the write loop discards
the outcome (`os/pkgs/mosd/mosd/src/bus.rs:470-475`). It must land before any generic
action shape is built on top of it. Phase 3 is also what makes the 15-second
refresh of section 5.8 cheap enough to stop being a compromise: `mosd` guards
settings and live state under one `Mutex<Inner>` (`bus.rs:49-51`), so (a) buys
one lock acquisition per render instead of 8-10.

**`mosd` prerequisites.** This *is* `mosd` work. Gap rows: **16** (partly
closed by the subscription), and it removes the workaround section 5.11 built
around that discarded outcome — including the narrow race that section documents
as unclosable from `apid`'s side (*"`record` writes no timestamp and no
generation"*).

**Verification.** `mosd` unit tests in the existing `bus.rs` test module
(`os/pkgs/mosd/mosd/src/bus.rs:929-930`): a multi-path read returning a per-path error
for one absent path while succeeding on the rest; a `SetSettings` against a
failing reconciler returning the failure in its reply rather than `Ok(())`. On
the `apid` side, a handler test that a failed apply renders in the error
register.

#### Phase 4 — the `mosd` mechanism work, in dependency order

Each sub-phase is one or more gap-table rows from section 4.1. The order is
chosen by operator demand and by which items unblock others, not by size.

| | Scope | Gap rows | Unblocks | Verified by |
|---|---|---|---|---|
| **4a** | **Observed network** — `mosd` queries `org.freedesktop.network1` for addresses, leases, gateway, DNS in use and carrier state. It already talks to that service for exactly one thing, `Manager.Reload` (`os/pkgs/mosd/mosd/src/reconciler/network.rs:32-33`), and issues no `Get` and no link enumeration | **14** | Section 2.4 half B; the *condition* on section 3.4.1's Network nav row; the "what is my IP address?" question section 2.9 names as one of the two an operator asks first | A live-state read that returns a lease for a DHCP interface and an explicit no-lease state for one without — the distinction `mos-ui-inventory.md` section 6.3 records as currently impossible |
| **4b** | **Storage per tier** — a `statvfs` read across the four tiers of `os/rootfs/overlay-v2/etc/fstab.in:11-27` and a bus surface for it | **11** | Section 2.6 | `/srv` reports a figure at all — today it has **no reporting of any kind** (section 4.1 item 7). Cheapest item in phase 4; do it early for that reason alone |
| **4c** | **Slot state, RAUC status, and the gate's verdict** — a bus method returning slot status; `mos-health` reporting its own verdict through `ReportHealth` or a richer equivalent instead of only journalling (`os/rootfs/overlay-v2/usr/lib/mos/mos-health:17-18`) | **1, 3, 5** | Section 2.5's slot half; section 2.3 part (iii); **and section 2.10's power-page warning (row 10)**, which is a dependency rather than a new primitive | `rauc status mark-good` having run is readable over the bus. The dated "0 across all 12 files" rauc measurement re-measures at 180 across 3 of 21 files in `os/pkgs/mosd/mosd/src/`: `GetUpdateState` answers slot status with the pending-not-confirmed flag, and `mos-health` now reports its verdict through `ReportHealth` (RFCT-084) — this row is largely built, wiring remains |
| **4d** | **Boot attempt credits** — reading `BOOT_A_LEFT`/`BOOT_B_LEFT` from the redundant U-Boot environment (`os/rootfs/overlay-v2/etc/fw_env.config.in:49-51`) | **2** | The credits half of section 2.5, and the two-tile cross-read section 2.7 describes (short uptime plus falling credits = a slot failing its health gate) | **Gated on the RFCT-142 serialisation rule, no longer on an open question.** The read hazard has an answer: every access goes through `fw_printenv`/`fw_setenv`, and the shipped libubootenv takes `flock(LOCK_EX)` on `/var/lock/fw_printenv.lock` across the whole read or read-modify-write, so a poll cannot land mid-write. The rule and its two caveats — the lock is silently skipped while `/var/lock` is absent, so the polling service keeps `DefaultDependencies=yes`; the lock never spans a check-then-set, so `BOOT_A_LEFT`/`BOOT_B_LEFT` stay RAUC-owned and 4d is read-only — are recorded at `os/rootfs/overlay-v2/etc/fw_env.config.in:23-47`. **4d starts only as an exec of `fw_printenv` under that rule** — never a private libubootenv link, never a raw read of the UENV partitions. It is deliberately last among the read items because it touches the one store RAUC also writes |
| **4e** | **Install a bundle, with progress** — an upload path and a place to put the bundle. The caller and progress surface exist (RFCT-084): `InstallUpdate` hands a bundle path to RAUC's D-Bus `InstallBundle`, `GetUpdateState` reads progress back. Today: no upload route — `Multipart` appears nowhere under `os/pkgs/mosd/`, re-measured on this tree | **4** | The update page of section 3.2; section 5.9's 2-second update-page refresh and its two specified degraded forms | The largest single item (section 4.1 item 4). Section 4.2 item 2's constraint is binding: mos refuses `plain`-format bundles by configuration (`os/pkgs/rauc/system.conf.in:50-62`), and **no "install this file anyway" affordance may be added** |
| **4f** | **Observed hostname**; and the **redaction policy** that must precede any diagnostics export | **13**; and section 4.1 item 10 (not a gap row) | Section 2.2's caveat; section 3.2's Diagnostics page | Diagnostics is mechanically buildable today — `GetState("")` and `GetSettings("")` already return whole trees (`bus.rs:160-164`, `:197-202`) — which is exactly why the **policy** must land first. Section 3.2: shipping an export before the redaction rule *"is how a support channel becomes a disclosure channel"* |

**One sequencing note that is not obvious.** 4c must precede 4d, not because of
implementation dependency but because boot credits are meaningless to an
operator without slot state beside them: "2 credits left" answers nothing unless
the screen also says which slot is running and whether it is confirmed. Shipping
4d alone would produce exactly the kind of tile section 2.1 rule 2 forbids — one
that exists because the data was available.

**And one that is.** Section 2.5's power-page warning (row 10) needs 4c and
nothing else; it is the cheapest safety improvement in phase 4 and it should
ship in the same change as 4c rather than waiting for the full update page.

### 8.3 Unverified / gaps for section 8

1. **The set of `com.mos.mosd1` consumers is what is in *this tree*.** It was
   established by `grep -rln apid` and by reading
   `os/rootfs/overlay-v2/usr/lib/mos/mos-health`; a consumer that exists only on
   a deployed device, in an operator's script, or on the unread `sshweb` branch
   would not appear. The bus name is reachable by any local root process, so
   such consumers are possible without mos knowing.
2. **`display.md` and `remote-management.md` were read for consumer analysis
   only.** Neither is owned by this campaign; `docs/design/access.md`,
   `provisioning.md` and `mosd.md` were not opened at all beyond the citations
   sections 1-5 already carry, and `mos-ui-inventory.md` section 9 records that
   some of those documents contradict the code.
3. **No phase was costed in time or effort.** The ordering is by dependency and
   by operator demand; there is no estimate here and none should be inferred.
4. **Phase 2's verification leans on the boot health gate**, which is the right
   test and is also the test that cannot run without hardware or a full image
   build. Nothing in this campaign built an image.
5. **The claim that phase 1 is architecture-independent rests on
   `SettingsApi`** (`os/pkgs/mosd/apid/src/settings_api.rs:13-20`) remaining the seam.
   It is the seam today, including for the tests. A merge that dissolved the
   trait rather than re-implementing behind it would break the property — which
   is a reason to keep the trait whatever happens beneath it, and is recorded
   here rather than assumed.
