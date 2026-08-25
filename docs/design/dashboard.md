# The mos dashboard: landing screen and information architecture

> **Status:** proposal, with two decisions now settled. This file contains
> **sections 1-8**. Section 5 (technology posture) was added by RFCT-044;
> sections 6-8 (process architecture, the daemon rename, and phasing) were added
> by RFCT-046.
>
> **Both decisions sections 6 and 7 left to the user have been made** (campaign
> `apid`, 2026-08-19, recorded by RFCT-056):
>
> - **The process decision — keep two processes.** `apid` is **not** merged into
>   `mosd`. Recorded in §6.
> - **The rename decision — `webd` is renamed `apid`.** Not `dashboard`, not
>   `webui`. Recorded in §7.4, and applied throughout this document.
>
> Sections 6 and 7 are **retained unrewritten as the reasoning behind those
> decisions**, including the costs of the rejected options and the one
> recommendation (§7.4.3) the user overrode. The decisions are stated on top of
> that reasoning, never in place of it.
>
> **Status markers** below follow `docs/design/access.md` §0 — `[implemented]`,
> `[partial]`, `[not implemented]`, and `[decided]` for a settled question.

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

**Cite by commit plus quoted content, not by bare line range, for any file still
under change.** A line range is acceptable only when it is anchored to a commit
that pins what those lines were — `path:LINE` *as of* `<sha>` — or when the
quoted words travel with the citation, so a reader can tell a line that merely
moved from a claim that actually changed. An unanchored range does not simply go
stale. As a file grows, the range comes to point at whatever text now occupies
those bytes, and that text can *refute* the claim citing it — at which point the
reader who does the responsible thing and follows the citation is misled more
thoroughly than the reader who does not. This is the same discipline as
anchoring a present-tense claim, applied to the pointer instead of the sentence.

`mosd/dist/com.mos.mosd.conf` is the worked example, and it is why this
paragraph exists rather than a footnote. The file grew from **12 lines to 73**
at `637295e` (RFCT-048). Every `:4-11` and `:8-11` citation below had been
written against the 12-line file, where those ranges *were* the policy stanzas;
in the 73-line file the same ranges are explanatory comment prose — including
the sentence *"The previous policy was a development skeleton that let any local
uid send to all of it."* A reader following the unanchored citation therefore
landed on text that appeared to **confirm** a claim which had become false.
Worse, `:4` once read *"Dev skeleton posture: root owns the name, everyone may
talk to it."* and today reads *"com.mos.mosd is a ROOT-ONLY bus name
(RFCT-048)"* — the exact negation of the claim it was cited to support. Every
such citation below now carries `as of 637295e^`, the last commit at which the
range meant what the sentence says.

**[re-anchored]** — a status marker added by RFCT-058 (campaign `apid`),
following the marker discipline of `docs/design/access.md` §0. It marks a claim
that was **true when written and has since been overtaken by a named commit**.
The claim is not deleted and the analysis built on it is not rewritten: the
marker dates the claim, names the commit that moved it, and states what that
does to the surrounding argument. It is the fact-level counterpart of
**[decided]** — where **[decided]** records that an open question was settled,
**[re-anchored]** records that a *fact* moved beneath an analysis that remains
otherwise valid. A **[re-anchored]** claim is still load-bearing history: it is
what the comparison was reasoning about at the time it reasoned, and deleting it
would make the reasoning unreadable rather than correct.

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
a single function (`mosd/apid/src/routes.rs:40-57`), plus a catch-all 308
redirect router on the HTTP listener (`routes.rs:61-65`). That is the entire
HTTP surface: no nested router, no fallback, no static-asset route
(`mos-ui-inventory.md` section 2).

The operator's whole menu is **four links plus a logout button** —
`Status` (`/`), `Network` (`/network`), `Hostname` (`/hostname`),
`Power` (`/power`) — rendered by `shell()` at `mosd/apid/src/routes.rs:168-178`
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
(`mos-ui-inventory.md` section 4). `apid` calls five of the six methods and
subscribes to the signal not at all — its zbus proxy declares no signal member
(`mosd/apid/src/bus_client.rs:9-20`).

### 1.2 The shape of the problem, in one paragraph

Ten routes, four nav links, every state change a form POST followed by a 302
and a full page re-render, and **one single `GetState` call in the entire UI** —
`GetState("network")` at `mosd/apid/src/routes.rs:568`, whose result is rendered
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
  `mosd/apid/src/routes.rs:567`; `GetSettings("provisioning")`, which returns
  `state`, `deviceId` and `seededGeneration`
  (`mosd/mosd-settings/src/model.rs:142-162`).
- **Availability: (a) available today.** `GetSettings("provisioning")` works
  today and `mosd/apid/src/` contains zero references to it — gap-table
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
  - (i) is **(a) available today** — gap-table **row 18**, UI-work-only. `apid`
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
    probes systemd, mosd and apid and then runs `rauc status mark-good`
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
    (`os/update/rauc/system.conf.in:75-95`, partition GUIDs at
    `os/boards/cx3576/board.env:209-219`), but there is no bus mechanism: a UI
    would have to subprocess `rauc status --output-format=shell`, and `apid`
    cannot, because it never spawns a process
    (`mosd/apid/src/settings_api.rs:10-12`,
    which states *"mosd owns every system action: apid never spawns a process and
    never talks to systemd itself"*).
  - **row 2** — boot attempt credits. `BOOT_A_LEFT` / `BOOT_B_LEFT` in the
    redundant U-Boot environment (`os/rootfs/overlay-v2/etc/fw_env.config.in:27-29`),
    reachable only via `fw_printenv`, and that file's own comment at `:23-25`
    warns there is **no cross-process locking** between the two existing writers.
  - **row 3** — RAUC status and last install result, kept on the META partition
    (`os/update/rauc/system.conf.in:14-34`).
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
- **Feed:** `/proc/uptime`, read by `apid` itself at
  `mosd/apid/src/routes.rs:569-571`, parsed at `:539-546`, formatted at
  `:549-560`, rendered on `/` at `:580-583`.
- **Availability: (a) available today** — gap-table **row 12**, answered via a
  side channel. Recorded honestly: this is **the one place `apid` touches the
  filesystem for data rather than going through the bus**, a documented
  exception to the layering asserted at `mosd/apid/src/settings_api.rs:10-12`.
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
  needing only UI work. `mosd/apid/src/` contains **zero** references to any of
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
  test at `mosd/apid/src/tests.rs:563`), plus a required confirmation token.
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
and not necessarily mos's. `apid`'s gate already calls `GetSettings("access")`
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
| 1 | 2.5, 3.2 Update page | Which slot is running, and the version in each | **row 1** | A bus method returning RAUC slot status. `grep -rci rauc mosd/mosd/src/` returns **0 across all 12 files**; `apid` cannot subprocess (`mosd/apid/src/settings_api.rs:10-12`), so this must live in `mosd`. The parse already exists in shell at `os/rootfs/overlay-v2/usr/lib/mos/mos-health:72-104` |
| 2 | 2.5, 2.7 | Boot attempt credits remaining | **row 2** | Read `BOOT_A_LEFT`/`BOOT_B_LEFT` from the redundant U-Boot environment (`os/rootfs/overlay-v2/etc/fw_env.config.in:27-29`). Carries a real hazard the file itself records at `:23-25`: **no cross-process locking** between the two existing writers |
| 3 | 2.5, 3.2 Update page | RAUC status and last install result | **row 3** | Same bus surface as item 1; the status file is on META by design (`os/update/rauc/system.conf.in:14-34`) |
| 4 | 2.5, 3.2 Update page | Installing a bundle at all | **row 4** | The largest single item. Signed verity-format bundles are already **built** and signature-verified against `/etc/rauc/keyring.pem` with `plain` format refused (`os/update/bundle.sh:1-22`, `os/update/rauc/system.conf.in:50-62`), but there is **no upload route, no file-receiving handler** (`Multipart` appears nowhere in `mosd/apid/`) and **no `rauc install` caller anywhere in `mosd/`**. Needs a bus method, a place to put the bundle, and a progress surface |
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
`apid`'s proxy declares five methods and no signal member
(`mosd/apid/src/bus_client.rs:9-20`), and with zero JavaScript there is no
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
   (`os/update/rauc/system.conf.in:50-62`, bundles built by `os/update/bundle.sh:1-22`). Venus
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

**What this section deliberately does not decide.** Whether `apid` should be
renamed, whether `apid` should be merged into `mosd`, and in what order any of
this is delivered are all **RFCT-046's**, not this section's. Where a
recommendation below would be changed by the process-architecture decision, that
is flagged in one line and left open.

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
(`mosd/apid/Cargo.toml:11-28`): `anyhow`, `argon2`, `async-trait`, `axum`,
`axum-server`, `hmac`, `maud`, `rand`, `rcgen`, `rustls`, `serde`, `serde_json`,
`sha2`, `tokio`, `tracing`, `tracing-subscriber`, `zbus`. Dev-dependencies are
`reqwest`, `tempfile`, `tower` (`Cargo.toml:30-33`). **`tower-http` is absent**,
which is the mechanical reason there is no static-file route — and also, read out
of that same absence, the reason **`apid` emits no HTTP compression at all**:
compression in this stack comes from `tower_http::compression`, and the crate is
not present. Every byte counted in section 5.3 is therefore an uncompressed byte
on the wire.

The single stylesheet is a `const STYLE` at `mosd/apid/src/routes.rs:147-154`,
emitted into a `<style>` element at `routes.rs:165` through `PreEscaped`.
Measured on this branch: **484 bytes** of CSS after line continuations are
resolved. This matters below only because it is the existing, working precedent
for *shipping browser-side text as a Rust string constant rather than as a build
artefact* — it is what option B would have to imitate.

`Multipart` and `http-equiv` appear nowhere under `mosd/` (grepped on this
branch: 0 matches each), so there is no file-upload path and no auto-refresh
today.

#### 5.1.2 TLS and the crypto posture — and what a new crate is checked against

- `rustls = { version = "0.23", default-features = false, features = ["ring", "std", "tls12"] }`
  (`mosd/Cargo.toml:38`), provider installed explicitly at
  `mosd/apid/src/main.rs:46-48`; `axum-server` takes
  `tls-rustls-no-provider` (`mosd/Cargo.toml:37`), which is why that install is
  mandatory rather than decorative. `rcgen` is likewise pinned to the `ring`
  backend (`mosd/Cargo.toml:39`).
- The workspace **actively enforces a pure-Rust crypto posture**, and does so in
  a comment rather than by accident: `tough` is pinned to `=0.18.0` with the
  note *"tough 0.18 is the last release whose crypto backend is `ring`; 0.19+
  hard-depend on aws-lc-rs, which builds C (AWS-LC). See docs/task/RFCT-016.md."*
  (`mosd/Cargo.toml:33-35`).
- Licence gate: `mosd/deny.toml:3-14` allows Apache-2.0, MIT, BSD-2-Clause,
  BSD-3-Clause, ISC, Unicode-3.0, Zlib and nothing else; `[bans]
  multiple-versions = "warn"` (`deny.toml:16-17`).

**So "does this option need a new crate?" is answered below by three tests, in
this order:** is it already in `mosd/Cargo.lock`; does it build C or pull
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
off** (`axum = "0.8"` at `mosd/Cargo.toml:36`; axum 0.8.9's default feature set
is `form, http1, json, matched-path, original-uri, query, tokio, tower-log,
tracing`, read from `axum-0.8.9/Cargo.toml:81-91`). Cargo feature unification
means `axum-server`'s `hyper` features are the ones that apply. This is stated as
**read out of source**; it is not documented in this repository and it was not
observed on a running appliance (see 5.13).

#### 5.1.4 The bus surface, and the single mutex behind it

`mos-ui-inventory.md` section 4 gives the six-method, one-signal surface.
Two properties read directly from `mosd/mosd/src/bus.rs` on this branch bound
every option below:

1. **`apid` does not subscribe to `SettingsChanged`.** Its zbus proxy declares
   five methods and no signal member (`mosd/apid/src/bus_client.rs:9-20`).
   Adding a `#[zbus(signal)]` member needs **no new crate**: `zbus` 5.19.0 is
   already in the tree and already pulls `futures-core` (`mosd/Cargo.lock`, zbus
   entry at `:2906-2931`), and signal streams are part of the proxy macro. The
   workspace pin is `zbus = { version = "5", default-features = false, features = ["tokio"] }`
   (`mosd/Cargo.toml:24`).
2. **All of `mosd`'s settings and live state sit behind one `tokio::sync::Mutex`.**
   `MosdService.inner: Mutex<Inner>` (`mosd/mosd/src/bus.rs:41-53`), whose own
   doc comment says *"Mutable trees guarded by one lock so settings writes and
   live-state updates stay consistent"* (`bus.rs:41-42`). `get_settings` takes it
   at `bus.rs:161`, `get_state` at `:198`, `report_health` at `:215`. Critically,
   `set_settings` takes it at `bus.rs:177` and **holds it across every
   overlapping reconciler's `apply().await`** (loop at `:183-188`, released by
   `drop(inner)` at `:189`).

   Read out of that: **while a reconciler is applying, every dashboard read
   blocks.** How long that is depends on the reconciler — the network reconciler
   calls `org.freedesktop.network1 Manager.Reload`
   (`mosd/mosd/src/reconciler/network.rs:36-43`), the sshd reconciler drives a
   systemd unit (`mosd/mosd/src/reconciler/sshd.rs:386-404`). This is not a
   defect to fix here; it is a **hard budget on how often a dashboard may poll**,
   and it applies identically to all four options, because all four ultimately
   read through the same lock. It is the single strongest argument in this
   section against high-frequency polling of any kind.

   One further load fact, already noted in section 3.4.1: the auth gate calls
   `GetSettings("access")` on **every** request (`mosd/apid/src/routes.rs:120`),
   so every browser request costs at least one bus round trip before a tile is
   read.

3. **`SetSettings` swallows reconciler failures.** `record` writes
   `{"error": "<message>"}` into live state and logs (`bus.rs:126-137`), and
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
  `mosd/apid/src/tests.rs` asserts `StatusCode::SEE_OTHER` at 20 call sites
  (for example `:41`, `:174`, `:394`, `:587`). `mos-ui-inventory.md` section 3.2
  and section 1.2 of this document describe the pattern as "302"; the pattern —
  POST/Redirect/GET — is the same either way, and 303 is the more correct of the
  two for a form submit. Sections 1-4 are left as written.
- The HTTP-listener redirect is 308 (`mosd/apid/src/routes.rs:61-65` and its doc
  comment at `:59-60`); that one is stated correctly throughout.

### 5.2 The criteria

Every option in 5.3-5.6 is costed against the same six criteria, in the same
order, so the four are comparable rather than merely described.

| | Criterion | What is being measured |
|---|---|---|
| **C1** | **Bytes shipped to the browser** | Bytes beyond the HTML that would ship anyway, plus bytes re-shipped per update. Uncompressed, because `tower-http` is absent (5.1.1) |
| **C2** | **New crates** | Named, and checked against `mosd/Cargo.toml`, `mosd/Cargo.lock` and `mosd/deny.toml` by the three tests in 5.1.2 |
| **C3** | **JavaScript disabled** | What an operator with scripting off, or a text browser, or a hardened kiosk profile, still gets |
| **C4** | **`mosd`-side work** | New bus method? New signal? Does it need `SettingsChanged` (`bus.rs:249-254`), which exists and is unsubscribed (`bus_client.rs:9-20`)? |
| **C5** | **`mosd` down** | Today: lazy connect, cache dropped on error, per-request 502 pages, never a `apid` crash (`mosd/apid/src/bus_client.rs:22-25`, `:41-58`; `bus_error` at `routes.rs:95-105`). What does the option do to that? |
| **C6** | **Operator-visible latency** | Worst-case delay between a value changing on the box and the operator seeing it |

A seventh consideration — interaction with the existing form-POST + 303 +
full re-render model — is not a per-option criterion because it has a single
answer for all four; it is 5.10.

### 5.3 Option A — full-page refresh

`<meta http-equiv="refresh" content="15">` emitted into the `<head>` by
`shell()` (`mosd/apid/src/routes.rs:157-185`) on pages that opt in.

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
   reads the expiry and never rewrites it (`mosd/apid/src/session.rs:66-79`);
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
  (`mosd/Cargo.lock`), licence `MIT OR Apache-2.0` (read from the local registry
  copy of `futures-util-0.3.34/Cargo.toml`), which is on the `deny.toml`
  allow-list (`deny.toml:6-14`). Pure Rust, no C. **So option C adds one line to
  `mosd/apid/Cargo.toml` and zero crates to the compiled graph.** (`tokio-stream`
  would be the more ergonomic choice and **is not** in `mosd/Cargo.lock` — that
  one is a genuine new crate and is not needed.)
- **C3 — JavaScript disabled.** Nothing updates. `EventSource` is a scripting
  API; there is no markup-level SSE consumer. Identical degraded story to option
  B, and it needs the same server-rendered timestamp.
- **C4 — `mosd` work. This is where the option collapses, and it is the decisive
  finding of this section.** SSE is a *push* transport, and push requires
  something to push. `mosd` emits **exactly one signal**, `SettingsChanged`
  (`mosd/mosd/src/bus.rs:249-254`, emitted at `:190-192`) — and it fires on
  **settings** writes. For **live state** — the IP address of section 2.4, the
  storage figures of 2.6, the slot state of 2.5, install progress — there is **no
  signal of any kind**. `record` mutates the live-state tree in place
  (`bus.rs:126-137`) and announces nothing.

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
  (`axum-0.8.9/Cargo.toml:264-266`). Checked against `mosd/Cargo.lock` on this
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
mitigation is `SameSite=Lax` (`mosd/apid/src/session.rs:91`) plus POST-only
destructive routes with a confirmation field (`routes.rs:49-53`, `:820`).
`SameSite` cookie semantics do not cover the WebSocket handshake, so a
writable WebSocket endpoint on a box whose D-Bus policy then let *any local
process* call `Reboot` (`mosd/dist/com.mos.mosd.conf:4-11` as of `637295e^`,
quoted in `mos-ui-inventory.md` section 3.6) would want explicit `Origin`
checking before it shipped. **[my inference, from the absence of CSRF machinery
plus the handshake's cookie semantics; not verified against an exploit and not
something this campaign tested.]** Opening a bidirectional channel to buy a
direction the design does not use, on an application with no CSRF defence, is
the wrong trade.

> **[re-anchored]** — RFCT-058. The bus clause above was true when written and
> is not now: `637295e` (RFCT-048) made `com.mos.mosd` root-only, so an
> unprivileged local process cannot call `Reboot` over the bus at all.
> **The conclusion is unchanged, because it never rested on the bus.** The CSRF
> gap is in `apid`'s own HTTP surface, and a WebSocket hijacked through the
> operator's authenticated browser acts *as* `apid` — which is still root and
> still permitted to call every member. Closing the bus to unprivileged callers
> does not close a cross-site path that arrives holding a valid session cookie.
> The open policy was corroborating colour here, never the load-bearing step.

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
  second session or by a local bus caller (which
  `mosd/dist/com.mos.mosd.conf:4-11` as of `637295e^` permitted any local
  process to do; **since `637295e` / RFCT-048 that caller must be root**)
  appears within one refresh interval rather than at once. For an appliance with
  one admin credential (`mos-ui-inventory.md` section 3.4) this is the right
  trade. **[re-anchored]** — RFCT-058: the root-only policy *narrows* the set of
  second actors but does not empty it (root scripts and `busctl` still qualify,
  and the health gate is one), so the refresh-interval trade is unchanged.
  Note the two are separable: **`apid` could subscribe to `SettingsChanged`
  server-side** — no new crate, per 5.1.4 item 1 — for cache invalidation or a
  render stamp, entirely independently of any browser transport. Gap row 16 is
  therefore *partly* closable under this recommendation. Whether to do so is a
  `apid` process-architecture question and belongs to RFCT-046.
- **It does not foreclose option B.** A is not a one-way door: the fragment
  routes of option B are additive to a server-rendered page, and 5.9 names the
  single circumstance under which they should be built.

**One line left open for RFCT-046:** if `apid` were merged into `mosd`, the
mutex analysis of 5.1.4 changes shape — the bus round trip per tile disappears
and the lock becomes an in-process one. That would lower the cost of every
option, most of all the polling ones, and could make a shorter interval or
option B cheaper than costed here. It does not change the C3 or C4 arguments,
which are the load-bearing ones. Left open.

### 5.9 The tile section 2.5 handed over: live install progress

Section 2.5 flagged exactly one item as materially technology-dependent: *"a
genuinely live progress bar is the one item on this screen that a server-rendered
page cannot show well"*, borrowing from Venus's practice of publishing real
percentage progress from the installer's own progress socket rather than guessing
(`venus-os-access.md` section 5.4 and section 6 item 5, cited via section 2.5).

**The first thing to say is that this tile cannot be built at all today, for
reasons that have nothing to do with transport.** Gap row 4: there is no upload
route, no file-receiving handler (`Multipart` appears nowhere under `mosd/`,
re-grepped on this branch), and no `rauc install` caller anywhere in `mosd/`
(`mos-ui-inventory.md` section 7 row 4; carried in section 4.1 item 4 of this
document). There is no progress to display because there is no install. **The
transport is not this tile's blocker and choosing SSE would not unblock it.**

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
  by `mosd/apid/src/tests.rs:563`). A `meta refresh` issues a GET and therefore
  **cannot** trigger a power action even if one were somehow placed on a
  refreshing page. Section 2.10's exclusion of power buttons from the landing
  screen stands on its own reasoning; this is an independent second layer, and it
  is worth recording that adopting auto-refresh does not weaken it.

### 5.11 The `?saved=1` banner

`mos-ui-inventory.md` section 3.2 and section 3.3 of this document both observe
that `SetSettings` runs the overlapping reconcilers **before** returning, so
"stored versus applied" is resolved server-side and the `?saved=1` marker
(`routes.rs:205-209`, banner at `:201-203`) discards information `mosd` already
computed. The question put to this section is whether the recommendation lets
that information reach the operator.

**Yes, fully — and the finding is that this was never a live-value transport
question at all.** It is a server-rendering question, and it is answerable under
option A exactly as well as under SSE. The evidence, read on this branch:

1. **The outcome is not in the return value.** `set_settings` returns
   `fdo::Result<()>` and calls `record` for each overlapping reconciler
   (`mosd/mosd/src/bus.rs:183-188`); `record` writes `Ok(value)` or
   `{"error": "<message>"}` into the live-state tree and **logs the failure
   rather than propagating it** (`bus.rs:126-137`). `set_settings` then returns
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
  entry. `mosd`'s D-Bus policy permitted any local process to call `SetSettings`
  (`mosd/dist/com.mos.mosd.conf:4-11` as of `637295e^`); **since `637295e`
  (RFCT-048) only root may call it**. **[re-anchored]** — RFCT-058: this makes
  the race rarer, not impossible, since every caller in the tree is already
  root — so the caveat stands as written and is if anything more clearly a
  `mosd` concurrency question than an access-control one. On a single-admin
  appliance this is
  vanishingly unlikely, and the honest closure is a `mosd` change — returning the
  outcome from `SetSettings`, or stamping `record` entries — not a `apid` one.
  **`record` writes no timestamp and no generation** (`bus.rs:126-137`), so
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
| `SettingsChanged` (gap row 16) | Browser-side push: **not adopted**. Server-side subscription in `apid`: **possible with no new crate**, decision deferred to RFCT-046 |
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
   (`mosd/apid/src/tls.rs:47-81`). If it falls back to HTTP/1.1, MDN's
   six-connection limit
   applies to option C. This does not change the recommendation, which rejects C
   on C4 grounds regardless.
3. **All byte figures for markup and scripts that do not exist are estimates**
   and are labelled `(est.)` in the table of 5.7. The two measured figures in
   this section are the 484-byte inline stylesheet (5.1.1) and Venus's
   15,793,432-byte compressed WASM payload (`venus-os-ui.md` section 2.3, not
   re-measured here).
4. **Crate resolution was read from `mosd/Cargo.lock` and from the local
   registry copies of published crates**, not from a resolved build graph. In
   particular, `mosd/Cargo.lock` includes entries for optional dependencies in
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
   `docs/design/mosd.md:217-220`, that citation is carried through unchecked.
   Likewise the in-flight SSH work on `bkd/hiu25adw` (`mos-ui-inventory.md`
   section 8) is not in this tree; if it adds routes, the route count in 5.1.1
   and the fragment-route count in 5.4 are both understated.

---

## 6. The process question: one daemon, two hardened daemons, or a generic bus

> **[decided]** — campaign `apid`, 2026-08-19, RFCT-056. **The user decided to
> keep two processes: `apid` is not merged into `mosd`.**
>
> Two findings carried the decision, and both are load-bearing:
>
> 1. **A merged process makes a provisioning failure fatal to the UI.** `mosd`
>    exits hard on purpose when provisioning fails (`mosd/mosd/src/main.rs`).
>    Today `apid` survives that and still renders an error page telling the
>    operator the management daemon is unavailable. Merged, a provisioning
>    failure leaves a serial console and nothing else — the worst failure mode
>    for a headless appliance whose operator may be on a phone attached to a
>    setup access point.
> 2. **`com.mos.mosd1` is load-bearing for updates.** `mos-health` probes
>    `GetState` on that interface and never reaches `rauc status mark-good` if
>    it does not answer. So the bus interface must keep existing and keep being
>    served regardless; a merge does not delete the bus, it deletes one
>    consumer — which removes the main premise for merging in the first place.
>
> **On the merge question this matches §6.6's recommendation** ("adopt option 2
> … do not merge"). **It does not settle the rest of option 2.** Whether the
> non-root `apid` user, the rewritten unit, the `user="…"` D-Bus rule and the
> filesystem-mode secret boundary (§6.3, §6.3.1, §6.3.2) are actually built is a
> **separate question, still open**. The decision made is *do not merge*; it is
> not *build the option-2 hardening now*.
>
> §§6.1-6.8 below are **retained as written**. The costs of options 1 and 3, and
> §6.6's honest counter-argument for option 1, are the reason this decision is
> trustworthy and are not rewritten.

Sections 1-5 designed a dashboard and chose how its values reach the screen.
This section answers the question underneath all of it: **should the management
UI keep being a separate process at all, and if it does, what is the boundary
between it and `mosd` actually for?**

Three options are analysed. Each carries two columns, and the second is the one
usually omitted: what it **costs to adopt**, and what it **forecloses** — what
becomes permanently harder or impossible once it is chosen. A recommendation
follows in 6.6. **The decision is the user's.** This section exists to make the
costs visible in both security directions, because neither the merge nor the
status quo is defensible as written.

**Licence fence, restated here and not only in sibling sections.** Venus OS
gui-v2 is a **study reference only** for mos, and the reason is a licence term,
not a preference: gui-v2 ships under "Victron Energy OS license v1", which
states *"USE OF THE SOFTWARE AND ITS MODIFICATIONS WITH SYSTEMS WHOSE CORE IS
NOT VICTRON ENERGY PRODUCTS IS EXPRESSLY NOT AUTHORIZED"*
(`gui-v2/LICENSE.txt:18-23`, as verified and quoted by
`docs/research/venus-os-ui.md` section 1.5; I did not re-verify the file
myself). mos is not a Victron product, so no gui-v2 code, markup, asset name or
verbatim string may be copied into mos — only ideas and interaction patterns
may be learned from, and every borrowing below is attributed. An implementer
reaching this section first should treat that as binding before opening any
Venus source.

**Scope fence.** `docs/design/access.md`, `docs/design/provisioning.md` and
`docs/design/mosd.md` belong to the parallel `sshweb` campaign. They are quoted
and cited here and never edited. The `SetTransientRootPassword` method that
campaign is adding is **announced only** — it is not in this tree, and no branch
of it was read. Where it changes a count below, that is said in line.

### 6.1 The baseline, re-verified on this branch

Every option below is scored against these eight facts. Each was re-opened and
re-read at the head of `bkd/z2pjo6lc`; none is carried from memory or from a
sibling document.

1. **`apid` runs as root, unsandboxed.** `mosd/dist/apid.service` is 13 lines
   and they are all of it: `Type=simple`, `ExecStart=/usr/bin/apid`,
   `Restart=on-failure` (`:9`), `StateDirectory=mos/apid` (`:10`),
   `After=network.target mosd.service` / `Wants=mosd.service` (`:3-4`). There is
   **no `User=`, no `DynamicUser=`, no `ProtectSystem=`, no `NoNewPrivileges=`,
   no `PrivateTmp=`, no `CapabilityBoundingSet=`, no `RestrictAddressFamilies=`
   and no `SystemCallFilter=`.** `mosd/dist/mosd.service` is 12 lines and
   equally bare (`Type=dbus`, `BusName=com.mos.mosd`, `:6-7`). **[read out of
   source; "runs as root" is the standard systemd default in the absence of
   `User=`, so it is an inference from an absence, exactly as
   `mos-ui-inventory.md` section 3.5 records it.]** *The privilege separation
   that a two-process split could buy is therefore not realised today.*
2. **There is no D-Bus method allowlisting.** `mosd/dist/com.mos.mosd.conf:8-11`
   (as of `637295e^`) granted `<policy context="default">` a bare `<allow
   send_destination="com.mos.mosd"/>` with no `send_member` and no
   `send_interface`. **Any local uid could call `Reboot`, `PowerOff` or
   `SetSettings`.** The file's own comment at `:4` called this a *"Dev skeleton
   posture: root owns the name, everyone may talk to it."* It was the shipped
   file — `os/rootfs/build.sh:38` copies it into the image staging directory
   (carried from `mos-ui-inventory.md` section 3.6). *`os/rootfs/build.sh` was
   the v1 stager, deleted by RFCT-107; `build-v2.sh` stages the same file.*

   > **[re-anchored]** — RFCT-058, campaign `apid`. **This is fact 2, and it is
   > the fact the rest of §6 reasons from, so it is dated here once and
   > referred back to everywhere else.**
   >
   > **It was true when written.** RFCT-046 measured it correctly against the
   > 12-line policy file that shipped at the time. Nothing in the analysis below
   > was mistaken; it was current.
   >
   > **It stopped being true at `637295e`** — *"os(RFCT-048): restrict
   > com.mos.mosd to root, on the bus and in both verifiers"*. The shipped
   > 73-line file now carries an explicit default-deny in **both** directions
   > and allows only root:
   >
   > ```xml
   > <policy context="default">
   >   <deny send_destination="com.mos.mosd"/>
   >   <deny receive_sender="com.mos.mosd"/>
   > </policy>
   > <policy user="root">
   >   <allow own="com.mos.mosd"/>
   >   <allow send_destination="com.mos.mosd"/>
   >   <allow receive_sender="com.mos.mosd"/>
   > </policy>
   > ```
   >
   > `receive_sender` is denied too, which is not mere symmetry: the interface
   > broadcasts `SettingsChanged(path, value_json)`, so a uid that could not
   > send could otherwise still subscribe and read
   > `access.webAdmin.password_hash` the moment an operator set it.
   >
   > **What it does to the argument, stated rather than left to the reader.**
   > Fact 2 was one of two legs under the claim that *the two-process split buys
   > no access control today*. That claim was accurate when made and is now half
   > retired: **the bus leg is closed; the process leg (fact 1 — `apid` runs as
   > root, unsandboxed) is untouched.** So the boundary is still unbuilt, but it
   > is unbuilt for one reason instead of two. Every "any local uid" sentence
   > below is to be read as *"any local uid, until `637295e`"*, and each carries
   > its own note where the conclusion depends on it.
   >
   > **RFCT-048 also delivered part of option 2 in advance.** §6.3.2 proposed a
   > default-deny policy plus a named-identity allow. The default-deny half is
   > **shipped**. What remains of option 2's D-Bus work is the `user="apid"`
   > block — which the shipped file already documents at its `EXTENSION POINT`
   > comment, together with a warning not to reopen the default context to get
   > there.
   >
   > **This does not reopen §6's decision.** See the note at the end of §6.6.
3. **`apid` reaches `mosd` only over the bus, proxying exactly five methods.**
   `mosd/apid/src/bus_client.rs:9-20` declares `get_settings`, `set_settings`,
   `get_state`, `reboot`, `power_off` and **no signal member**. `apid` does
   **not** call `ReportHealth` — that is the boot health gate's
   (`os/rootfs/overlay-v2/usr/lib/mos/mos-health:45-50`). The `sshweb` campaign adds a sixth call; it
   is not in this tree.
4. **`apid` binds `0.0.0.0:443` and `0.0.0.0:80` by default**, both
   env-overridable (`mosd/apid/src/config.rs:34-37`). The HTTP listener exists
   only to 308 every request to HTTPS (`mosd/apid/src/routes.rs:61-65`).
5. **TLS material is self-generated into the StateDirectory.**
   `ensure_state_dir` creates the directory at mode `0700`
   (`mosd/apid/src/tls.rs:20-28`); `write_secret` writes `key.pem` and
   `session.key` at mode `0600` (`tls.rs:31-42`, called at `:78` and `:100`);
   `cert.pem`/`key.pem` are generated self-signed on first start only when
   absent (`tls.rs:47-81`).
6. **`mosd` emits exactly one signal, `SettingsChanged`**
   (`mosd/mosd/src/bus.rs:249-254`, emitted at `:190-192`), and it fires on
   **settings** writes. There is **no change notification of any kind for live
   state** — `record` mutates the tree in place and announces nothing
   (`bus.rs:126-137`). Carried from section 5.5, re-verified.
7. **One `Mutex<Inner>` guards settings and live state together, and
   `set_settings` holds it across every overlapping reconciler's `apply().await`.**
   `MosdService.inner: Mutex<Inner>` (`bus.rs:41-55`), whose doc comment says
   *"Mutable trees guarded by one lock so settings writes and live-state updates
   stay consistent"* (`:41-42`). `get_settings` takes it at `:161`, `get_state`
   at `:198`, `report_health` at `:215`, and `set_settings` at `:177`, holding
   it through the reconciler loop at `:183-188` until `drop(inner)` at `:189`.
8. **`set_settings` returns `Ok(())` even when a reconciler fails.** `record`
   writes `{"error": "<message>"}` into the live-state tree and logs
   (`bus.rs:126-137`); the loop at `:183-188` discards the outcome and the
   method returns `Ok(())` at `:193`. Carried from section 5.11 item 1,
   re-verified.

### 6.2 Option 1 — merge `apid` into `mosd` as a module

The proposal: delete the `apid` binary, move its routes, auth, session store and
TLS listener into `mosd` as a module, and let the HTTP handlers call the
settings and state trees directly instead of over D-Bus.

#### 6.2.1 What it actually saves, quantified

| Saving | Size, measured where possible |
|---|---|
| **One bus round trip per read** | Every request already pays one before any tile is rendered — the auth gate calls `GetSettings("access")` at `mosd/apid/src/routes.rs:120`. The seven-tile dashboard of section 2.9 adds roughly 8-10 more per render (section 5.3, cost 4). A merge removes all of them. **Cost per round trip: not measured.** No benchmark was run and this is a documents-only campaign; the *shape* is known (a unix-socket request/reply through `dbus-daemon`, serialising and deserialising a JSON string each way), the *number* is not. Anyone who wants this saving quantified must measure it — do not substitute an adjective |
| **One systemd unit** | `mosd/dist/apid.service`, 13 lines, plus its enablement symlink and the four verifier assertions that pin it (`os/verify-image-v2.sh:922-929`) |
| **One StateDirectory** | `/var/lib/mos/apid` (`apid.service:10`, default at `config.rs:38-40`), holding `cert.pem`, `key.pem`, `session.key` (`tls.rs:48-49`, `:85-86`). Note it does not disappear — it moves, and on already-deployed devices it has to be migrated or orphaned (7.4) |
| **One settings parse** | **This saving does not exist.** `apid` never reads `settings.toml`: grepping `mosd/apid/src/` for `settings.toml`, `DEFAULT_PATH` and `mosd-settings` returns nothing, and `mosd/apid/Cargo.toml:11-28` does not depend on `mosd-settings`. `apid`'s entire configuration is four environment variables (`config.rs:33-45`). Recorded because it was offered as a saving and is not one |
| **One crate and one binary in the image** | `mosd/apid/src/` is **2301 lines across 9 files**, of which `tests.rs` is 591 and `routes.rs` is 916, plus 359 lines of `tests/e2e.rs`. `mosd/mosd/src/` is **7401 lines**. The image drops one ELF at `/usr/bin/apid` (installed by `os/rootfs/Dockerfile.v2:282-288`); **binary size not measured** — no `cargo` was run |

**The dependency graph moves rather than shrinks.** `mosd/mosd/Cargo.toml:11-23`
declares 12 dependencies; `mosd/apid/Cargo.toml:11-28` declares 16. The
intersection is `anyhow`, `argon2`, `async-trait`, `serde_json`, `tokio`,
`tracing`, `tracing-subscriber`, `zbus`. So a merged `mosd` **acquires eight new
direct dependencies** — `axum`, `axum-server`, `maud`, `rustls`, `rcgen`,
`hmac`, `sha2`, `rand` (plus `serde`, which `mosd` gets transitively through
`mosd-settings` today) — and their transitive trees, of which `hyper`,
`hyper-util`, `h2` and `ring` are the security-relevant ones. Total compiled
graph size: **not measured**, because `Cargo.lock` already resolves the whole
workspace and cannot answer "what would `mosd` alone pull".

#### 6.2.2 The mutex: the one thing section 5 hoped a merge would fix, and the finding

Section 5.8 left exactly one line open for this section: *"if `apid` were merged
into `mosd`, the mutex analysis of 5.1.4 changes shape — the bus round trip per
tile disappears and the lock becomes an in-process one."* Picking it up:

**Half of that is true and the valuable half is not.** The bus round trip does
disappear. The lock does **not** become materially cheaper, because it is
already in-process *within `mosd`*: fact 7 is about `mosd`'s own
`Mutex<Inner>`, and merging does not change how long `set_settings` holds it. A
dashboard render that arrives while the network reconciler is inside
`Manager.Reload` (`mosd/mosd/src/reconciler/network.rs:36-43`) waits for that
reconcile either way. **The blocking duration is unchanged by a merge.**

What a merge genuinely enables is something narrower and worth naming precisely:
an in-process dashboard could take the lock **once** and read all seven tiles
inside one critical section, instead of taking and releasing it 8-10 times.
That is a real improvement in lock *acquisition count* and in the window during
which a writer can interleave between two tiles of the same render.

**But that improvement does not require a merge.** A multi-path read on the
existing bus — option 3's first primitive (6.4.4a) — delivers exactly the same
property: one lock acquisition, N paths, one reply. **So the mutex argument for
option 1 is answered more cheaply by option 3, and should not be counted as a
reason to merge.** This is the sharpest finding in this section and it changes
option 1's score materially.

There is also a fact that shrinks the round-trip saving on its own terms:
`GetState("")` and `GetSettings("")` **already return the whole tree**
(`mosd/mosd/src/bus.rs:160-164`, `:197-202`; `""` is documented as the whole
tree in `mos-ui-inventory.md` section 4, and the boot health gate exercises it
in production — `os/rootfs/overlay-v2/usr/lib/mos/mos-health:155-156` calls
`com.mos.mosd1 GetState s ""` and treats success as proof that `mosd` is
answering). So a dashboard render *can already* be two round trips rather than
ten, today, with no new mechanism. It would transfer the entire tree to do it —
which is a real cost and a disclosure concern that section 3.2 already flagged
for the diagnostics export — but the "N round trips" figure is an artefact of
how a UI would naturally be written, not a hard property of the bus.

#### 6.2.3 What a merge makes permanent

This is the column that decides the option.

**(a) The HTTP and TLS stack becomes permanently root-resident and
un-sandboxable.** `mosd` must be root, and not marginally:

- it rewrites `/etc/shadow` — `DEFAULT_SHADOW` at
  `mosd/mosd/src/reconciler/sshd.rs:32`, read at `:314-317`, written atomically
  with explicit mode and restored uid/gid at `:337-338` via `write_atomically`
  (`:218`), whose doc comment at `:215-217` explains that a shadow file coming
  back `root:root` instead of `root:shadow` *"locks out every setgid tool that
  reads it"*;
- it writes `/etc/ssh/sshd_config.d/10-mos.conf` (`sshd.rs:30`, `:280`);
- it calls `org.freedesktop.systemd1.Manager` for `Reboot` and `PowerOff`
  (`mosd/mosd/src/power.rs:11-19`), drives arbitrary units through the same
  manager (`mosd/mosd/src/reconciler/systemd.rs:22-30`), calls
  `org.freedesktop.hostname1` (`reconciler/hostname.rs:27-29`) and
  `org.freedesktop.network1` (`reconciler/network.rs:36-43`);
- it owns the device's plaintext credentials: `secrets/` at mode `0700` and the
  files inside at `0600` (`mosd/mosd/src/identity.rs:43`, `:51-56`), under
  `/var/lib/mos` (`identity.rs:37-40`).

None of that survives `User=`, `ProtectSystem=strict`, a restrictive
`CapabilityBoundingSet=` or a `SystemCallFilter=` narrow enough to matter.
**The merged process's privilege is the union of the two, and the union is
strictly larger than either.** Every future CVE in `axum`, `hyper`, `h2` or
`rustls` — the classes that reach a listener before authentication — then lands
in the process that holds `/etc/shadow` and systemd's manager. That is a
permanent property of the merge, not a transitional one.

**Stated honestly in the other direction, because it is the strongest thing that
can be said for option 1:** *today that boundary buys almost nothing.* Per fact
2 **as measured before `637295e`**, any local uid could already call `Reboot`,
`PowerOff` and `SetSettings`, and per fact 1 `apid` is root anyway, so a `apid`
compromise already reached everything `mosd` can do. **Option 1 therefore
forecloses a boundary that has not been built rather than destroying one that
exists.** **[re-anchored]** — RFCT-058: RFCT-048 removed the fact-2 half of
that, but **the sentence survives on fact 1 alone** — `apid` is still root, so a
compromised `apid` still reaches everything `mosd` can do, by process privilege
rather than by bus policy. The strongest-thing-for-option-1 remains true, and
its remaining support is now exactly one fact instead of two. Whether that matters
depends entirely on whether the boundary would otherwise be built — which is
option 2, and which is why the two options must be compared and not merely
listed.

**(b) Fault isolation is lost, and the loss has a specific, cited shape.** Both
units carry `Restart=on-failure` today (`apid.service:9`, `mosd.service:9`), and
`apid` is only `Wants=mosd.service`, not `Requires=` (`apid.service:4`), so
`apid` starts and stays up even when `mosd` does not. Three consequences of
merging:

- A panic or OOM in request handling takes the management plane down with it.
- **A restart empties the live-state tree, and one entry cannot come back.**
  Live state is in-memory only; `mosd` restart repopulates it by running
  `apply_all()` (`mosd/mosd/src/main.rs:92`, `bus.rs:114-121`), which records
  only *reconciler* outputs. `health.*` is written **only** by `ReportHealth`
  callers (`bus.rs:209-229`), and there is exactly one: the boot health gate
  (`os/rootfs/overlay-v2/usr/lib/mos/mos-health:45-50`, `:194`, `:197`), which is a `Type=oneshot` with
  `Restart=no` ordered `After=multi-user.target`
  (`os/rootfs/overlay-v2/usr/lib/systemd/system/mos-health.service:9`, `:16-23`). **So after a mid-life restart,
  `health.var` is gone until the next boot** — and section 2.3's health tile is
  built on it. Today a `apid` crash cannot cause that; after a merge it can.
- **A `mosd` startup failure would leave nothing to serve the error page.**
  `mosd` treats first-boot provisioning as a hard failure on purpose —
  `main.rs:57-63` propagates with `.context("first-boot provisioning")?` and the
  comment at `:53-56` says so explicitly: *"a loud exit is better than a daemon
  that quietly serves an unprovisioned tree the operator cannot log in to."*
  Today, if that happens, `apid` is still up and every request renders the 502
  page *"The management daemon is unavailable."* (`routes.rs:95-105`, via
  `bus_client`'s lazy-connect design at `bus_client.rs:22-25`). After a merge
  there is no process left to render it: **a provisioning failure becomes a
  device with no UI and no diagnostic surface at all**, reachable only by serial
  console. That is the single most concrete cost of option 1, and it is a
  regression in exactly the failure mode a headless appliance most needs a UI
  for.

**(c) `Type=dbus` startup ordering begins to gate the UI.** `mosd.service:6-7`
is `Type=dbus` with `BusName=com.mos.mosd`, so systemd considers the unit
started when the bus name is acquired. Merged, the HTTPS listener binds inside
that unit, so UI availability becomes downstream of bus-name acquisition and of
the provisioning step above. Today the listeners bind first and print
`APID_LISTENING` before anything else (`mosd/apid/src/main.rs:59-69`), and the
UI is reachable whether or not the management plane is healthy. **[inference
from the two unit files and the two `main.rs` startup sequences; not observed on
a device.]**

**(d) One dependency-policy note, small but real.** The workspace enforces a
pure-Rust crypto posture deliberately — `tough` is pinned to `=0.18.0` with the
comment *"tough 0.18 is the last release whose crypto backend is `ring`; 0.19+
hard-depend on aws-lc-rs, which builds C (AWS-LC)"* (`mosd/Cargo.toml:33-35`) —
and `rustls`, `rcgen` are both pinned to the `ring` backend (`:38-39`). Merging
does not violate that, but it moves the whole TLS surface into the daemon that
also holds `ring` for identity generation (`mosd/mosd/src/identity.rs:35`), so
a future forced backend migration would have one blast radius instead of two.

#### 6.2.4 The constraint option 1 cannot decide on its own

Option 1's premise is that removing `apid` removes the bus hop. **It only does
so if `com.mos.mosd1` has no other consumer.** It has one today. That question
is section 7, and option 1 is re-scored against the answer in 7.3.

### 6.3 Option 2 — keep two processes and build the boundary

The proposal: `apid` runs as a dedicated non-root system user, the D-Bus policy
allowlists exactly the members `apid` may call, and the unit acquires the
standard systemd sandboxing set.

**State this before anything else: per fact 2 and fact 1, this is not hardening
an existing boundary. It is building one that was never built.** The policy file
called itself a dev skeleton (`com.mos.mosd.conf:4` as of `637295e^`, then
reading *"Dev skeleton posture: root owns the name, everyone may talk to it."*)
and the unit has no hardening directive at all (`apid.service`, 13 lines). So
every item below is **new cost, not a delta**, and option 2 should be costed as
a project rather than as a cleanup.

> **[re-anchored]** — RFCT-058. The dev-skeleton citation is the sharpest case
> of the stale-pointer failure this document's citation convention now warns
> about: `com.mos.mosd.conf:4` as of `637295e` reads *"com.mos.mosd is a
> ROOT-ONLY bus name (RFCT-048)"*, so the unanchored citation had come to assert
> the **exact opposite** of the claim it was offered as evidence for.
>
> **What it does to the argument.** Option 2 is now **partly a delta and not
> wholly a project**: `637295e` built the policy half, so the D-Bus item below
> is no longer new cost. The unit half is untouched — no `User=`, no
> `DynamicUser=`, no sandboxing directive — so **the costing above still holds
> for everything except §6.3.2**, which should now be read as "add one
> `user="apid"` block to a policy that is already default-deny" rather than
> "replace a dev skeleton".

#### 6.3.1 What must change for `apid` to run without root

**(a) The two privileged ports (fact 4).** `apid` binds `0.0.0.0:443` and
`0.0.0.0:80` (`config.rs:34-37`). Three ways out, with honest costs:

- **`AmbientCapabilities=CAP_NET_BIND_SERVICE` — recommended.**
  `capabilities(7)` describes `CAP_NET_BIND_SERVICE` as *"Bind a socket to
  Internet domain privileged ports (port numbers less than 1024)"*
  (<https://man7.org/linux/man-pages/man7/capabilities.7.html>, fetched and
  read). `systemd.exec(5)` says of `AmbientCapabilities=`: *"Ambient capability
  sets are useful if you want to execute a process as a non-privileged user but
  still want to give it some capabilities"*, and notes that with a
  non-privileged user the setting automatically adds `keep-caps` to
  `SecureBits=` (<https://man7.org/linux/man-pages/man5/systemd.exec.5.html>,
  fetched and read). Cost: two directives, no code change, both listeners stay
  where they are. Pair it with a `CapabilityBoundingSet=` holding the same
  single capability so nothing else is retained.
- **Socket activation.** systemd binds as root and passes the descriptors.
  Cheaper in capability terms, more expensive here: `apid` binds its own
  listeners at `mosd/apid/src/main.rs:59-66` and prints the single
  machine-readable marker `APID_LISTENING https=<addr> http=<addr>` *after*
  binding (`:69`, contract documented at `:17-19`). Adopting socket activation
  changes that startup contract, and the contract has consumers. **Not proposed
  here**; recorded as the option with the best capability story and the worst
  compatibility story.
- **A high port plus a redirect — cheapest to describe, most expensive to
  ship.** Costs, concretely:
  - The redirect must be applied for **both** listeners, and the port-80 half is
    the awkward one: that listener's entire job is to 308 to HTTPS
    (`routes.rs:61-65`), so a packet-filter rule would exist solely to keep a
    redirect reachable. Two rules to ship, order and verify, in an image that
    today ships no packet-filter configuration at all.
  - The 308's `Location` is built from the **bound** HTTPS port —
    `redirect_app(https_addr.port())` at `mosd/apid/src/main.rs:80-83`, consumed
    by `redirect_to_https` (`routes.rs:67-...`). On a high port the redirect
    would send the browser to `https://<host>:8443`, i.e. past the redirect
    rule, exposing the internal port in the URL bar. Fixing that is a code
    change, so the "no code change" advantage of this route is false.
  - **It breaks the boot health gate unless loopback is also covered.**
    `os/rootfs/overlay-v2/usr/lib/mos/mos-health:168` probes `https://127.0.0.1/healthz` — port 443,
    hardcoded. Redirecting loopback traffic needs an `OUTPUT`-chain rule, not
    just `PREROUTING`. A silent break here is a gate that stops probing `apid`
    while still reporting OK, which `os/verify-image-v2.sh:1184-1200` already
    treats as a failure condition worth asserting on.

  **[The three port claims above are read out of source and out of the two
  manual pages cited; nothing was run. In particular the `OUTPUT`-chain claim is
  standard netfilter behaviour and was not tested here.]**

**(b) TLS key ownership — cheap, and it should not be inflated.**
`systemd.exec(5)` states of `StateDirectory=`: *"The innermost specified
directories will be owned by the user and group specified in User= and Group="*
(<https://man7.org/linux/man-pages/man5/systemd.exec.5.html>). `apid.service:10`
already carries `StateDirectory=mos/apid`, and `apid` creates the directory at
`0700` and its secrets at `0600` itself (`tls.rs:20-28`, `:31-42`). So adding
`User=` gives the certificate, key and session key the right owner with **no
code change and no extra directive**. One wrinkle, flagged rather than asserted:
on an **already-deployed** device `/var/lib/mos/apid` exists owned by root, and
whether systemd re-chowns an existing state directory when `User=` changes was
**not verified** (6.7 item 3). Assume a one-time ownership fix may be needed on
upgrade and check it before shipping.

**(c) The sandboxing directives, and which ones survive what `apid` actually
does.** `apid` does two unusual things: it reads `/proc/uptime`
(`routes.rs:569`, the documented exception to the layering asserted at
`mosd/apid/src/settings_api.rs:10-12`), and it needs the system bus.

| Directive | Survives? | Why, cited |
|---|---|---|
| `ProtectSystem=strict` | **yes** | *"the entire file system hierarchy is mounted read-only, except for the API file system subtrees /dev/, /proc/ and /sys/"* (`systemd.exec(5)`). `apid`'s only writes are into its StateDirectory (`tls.rs:76-78`, `:100`), which systemd makes writable; and `/proc` stays readable, so the uptime read is unaffected |
| `ProtectProc=` | **expected yes** | *"this controls the 'hidepid=' mount option ... which controls which directories with process metainformation (/proc/PID) are visible and accessible"* (`systemd.exec(5)`). `/proc/uptime` is not a PID directory. **[inference from the documented scope; not tested]** |
| `PrivateTmp=yes` | **yes** | `tempfile` is a dev-dependency only (`mosd/apid/Cargo.toml:30-33`) |
| `NoNewPrivileges=yes` | **yes** | `apid` never spawns a process — `settings_api.rs:10-12` states *"mosd owns every system action: apid never spawns a process and never talks to systemd itself"* |
| `PrivateNetwork=` | **must stay off** | `apid` is the listener. The system bus is a unix socket and is unaffected either way |
| `RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6` | **yes** | `AF_UNIX` for `/run/dbus/system_bus_socket`, the two INET families for the listeners |
| `ProtectHome=`, `ProtectKernelTunables=`, `ProtectKernelModules=`, `ProtectControlGroups=`, `RestrictSUIDSGID=`, `SystemCallFilter=@system-service` | **expected yes** | Nothing in `mosd/apid/src/` touches any of these surfaces; **not tested** |
| `MemoryDenyWriteExecute=yes` | **expected yes, verify** | `rustls`/`ring` are ahead-of-time compiled with no JIT, but this is the directive most likely to break something subtly. **[inference; not tested]** |
| `DynamicUser=yes` | **not recommended** | It gives the StateDirectory a private path and an unstable uid, and `/var/lib/mos` is a bind mount from the STATE partition that must survive A/B updates (`os/rootfs/overlay-v2/etc/systemd/system/var-lib-mos.mount:3`, `:10`). A static system user created in the rootfs is the right shape; creating it is rootfs work (`os/rootfs/Dockerfile.v2`), outside the crate |

**(d) The concrete security gain nothing else provides.** Today root-`apid` can
open `/var/lib/mos/secrets/device-password` and `.../ap-psk` — mode `0600` in a
`0700` directory (`identity.rs:43`, `:51-56`). Section 2.10 makes *"No secrets,
ever"* a rule of the dashboard, and today that rule is enforced **only by
`apid`'s own code** — nothing stops a future route, or an exploited one, from
reading those files. Under a non-root `apid` the rule becomes a **filesystem
property**: the process cannot open them at all. That is the single most
valuable thing option 2 buys, and it is not available under option 1 at any
price, because a merged daemon must be able to write those files.

#### 6.3.2 D-Bus method allowlisting, and the limit it runs into

Replacing the bare `<allow send_destination="com.mos.mosd"/>`
(`com.mos.mosd.conf:8-11` as of `637295e^` — **already replaced by a
default-deny at `637295e`, RFCT-048**) with per-member rules is mechanically
simple —
`dbus-daemon(1)`'s busconfig policy accepts `send_interface`, `send_member`,
`send_path`, `send_destination`, `user` and `group` on `<allow>`/`<deny>`
(<https://dbus.freedesktop.org/doc/dbus-daemon.1.html>, fetched and read). A
default-deny plus a `user="<apid user>"` allow for exactly the five members of
fact 3, plus a root allow for `ReportHealth` and `GetState` (the health gate's
two calls — `os/rootfs/overlay-v2/usr/lib/mos/mos-health:47-48` and `:155-156`), is expressible today.

**Two limits that must be stated, because they bound how much this buys:**

1. **A policy keyed on uid is meaningless while `apid` is root.** Allowlisting
   and the non-root user are one change, not two; shipping the policy alone
   would be theatre.
2. **D-Bus policy cannot see method arguments, so it cannot express
   per-subtree authorization.** The documentation is explicit: the `send_*` and
   `receive_*` attributes are *"purely textual/by-value matches against the
   given field in the message header"* (`dbus-daemon(1)`, same source), and the
   same page recommends that services *"normally accept method call messages
   from all callers, then apply a sysadmin-controllable policy"* — pointing at
   polkit for argument-level decisions. `SetSettings` is **one** method covering
   the **entire** settings tree (`bus.rs:169-194`). So "apid may call
   SetSettings" grants `apid` the ability to write `access.*` as well as
   `network.*`, and the bus cannot narrow it. **Per-subtree authorization has to
   live inside `mosd`, or not at all.** This is the same limit that decides part
   of option 3 (6.4.5), and the two interlock.

#### 6.3.3 What option 2 forecloses

- **The bus hop stays, forever.** Every dashboard read is IPC. Unmeasured, but
  permanent.
- **Two units, two state directories, two restart domains stay.** The
  operational surface does not shrink.
- **`apid` can never again read anything privileged directly.** Today's one
  exception — `/proc/uptime` at `routes.rs:569` — survives, but a future tile
  needing `fw_printenv` (gap row 2, which reads raw partitions via
  `os/rootfs/overlay-v2/etc/fw_env.config.in:27-29`) or `rauc status` (gap
  row 1) becomes *structurally* impossible in `apid` rather than merely
  discouraged. That is a foreclosure and also the point: it converts the
  documented invariant *"mosd owns every system action"*
  (`settings_api.rs:10-12`) into an enforced one, and it means **every future
  privileged tile must arrive as a new `mosd` surface** — which is exactly the
  growth option 3 exists to bound.
- **It does not fix the mutex, the round-trip count, or fact 8.** Option 2 is a
  security posture change and nothing else. Anyone expecting it to make the
  dashboard better will be disappointed; it makes the dashboard *safe to grow*.

### 6.4 Option 3 — keep two processes, remove method-per-feature growth

The proposal: make the bus surface generic — settings paths, state paths, and a
small fixed set of actions — so that a new dashboard page needs no new `mosd`
method.

#### 6.4.1 What the existing dot-path shape already supports

Answered from `mosd/mosd/src/bus.rs` rather than assumed. More is already there
than the framing suggests, and saying so is the honest starting point:

- **Whole-tree read: already works, both trees.** `get_settings` resolves the
  dot-path through `Settings::get` (`bus.rs:160-164`) and `get_state` through
  `json_path_get` (`:197-202`), with `""` meaning the whole tree
  (`mos-ui-inventory.md` section 4). This is not theoretical — the boot health
  gate calls `GetState s ""` in production and treats a successful reply as
  proof of life (`os/rootfs/overlay-v2/usr/lib/mos/mos-health:155-156`).
- **Segment-wise path overlap: already works.** `paths_overlap` (`bus.rs:24-39`)
  matches in either direction with the root matching everything, which is what
  makes `SetSettings("network.eth0.dhcp")` re-run the reconciler whose subtree
  is `network` (`bus.rs:183-184`).
- **Validated, atomic, typed writes: already work.** `set_settings` builds a
  candidate, validates it against the typed tree and persists atomically before
  mutating anything (`bus.rs:175-181`).

So the *addressing* half of a generic surface exists. What is missing is
everything around it.

#### 6.4.2 What is missing, item by item

1. **Multi-path read.** There is a whole-tree read and a single-path read and
   nothing between. A tile grid must therefore either issue N calls — N lock
   acquisitions against fact 7, with a writer free to interleave between tiles
   of the same render — or transfer the entire tree, which is the disclosure
   shape section 3.2 already refused for the diagnostics export. **This is the
   gap that matters most**, and per 6.2.2 it is the same gap option 1 was being
   credited with closing.
2. **Scoped enumeration.** You can enumerate by reading the root and walking the
   JSON. You cannot ask "what are the children of `network`" without
   transferring `network`. For settings that is survivable; for a growing live
   state tree it is not.
3. **Schema discovery — absent entirely.** The settings tree is a typed Rust
   structure with `#[serde(deny_unknown_fields)]` throughout
   (`mos-ui-inventory.md` section 5), and nothing exposes its types, ranges,
   enum variants or read-only-ness. Two concrete consequences: a generic UI
   cannot know that `schema_version` is read-only, and it cannot know that
   `access.console.shellEnabled` is consumed by no reconciler at all (gap
   row 17) and must therefore never be offered as a working control. **A
   generic surface without schema discovery moves the schema into the UI**,
   which is where mos's advantage over Venus currently is not (section 3.3).
   Venus solved this by carrying min/max/default per item in localsettings
   (`venus-os-ui.md` section 5).
4. **No live-state write path.** `GetState` is read-only and there is no
   `SetState`. Every action is consequently a method, which is precisely the
   growth being complained about.
5. **No change subscription usable by a UI.** `SettingsChanged` exists and is
   settings-only (fact 6); `apid` does not subscribe (fact 3). Section 5.1.4
   item 1 established that adding a `#[zbus(signal)]` member needs **no new
   crate** — `zbus` 5 is already in the tree and signal streams are part of the
   proxy macro — so server-side subscription is cheap and independent of any
   browser transport (section 5.8 records gap row 16 as *partly* closable on
   that basis). What does not exist at any price today is a **live-state**
   change signal.
6. **No way to report that a reconciler failed (fact 8).** `set_settings`
   returns `Ok(())` whether the reconcile worked or not. **A generic surface
   built on top of that generalises the wrong thing:** it would take a method
   that cannot say "this failed" and make it the shape of every future
   operation. Any move toward option 3 that does not fix fact 8 first makes the
   problem larger, not smaller.
7. **Actions that are not settings — where the growth actually comes from.**
   Today: `Reboot`, `PowerOff` (`bus.rs:235-245`). Known future, from section
   4.1's table: install a bundle (row 4), the confirm/mark-good surface (row 5),
   rotate a credential (row 9), plus two UI-side items with no method yet — a
   password-change route and a delete-interface route (section 3.2). The
   `sshweb` campaign adds a seventh (announced only). **That is a trajectory
   from 6 members to 12-plus, one per feature.**

#### 6.4.3 The Venus convergence: evidence or coincidence?

Venus models actions as **writable bus items rather than methods** — a reboot is
`setValue(true)` on `platform/Device/Reboot`, implemented as a
`VeQItemReboot : VeQItemAction` registered as a child item, and a whole security
change is a JSON document written to one `platform/Security/Api` item
(`venus-os-ui.md` section 7 item 2). That is exactly the shape option 3 proposes.

**Venus was forced into it, and the forcing constraint is one mos does not
have.** The gui-v2 UI is a WASM binary in a browser; it cannot reach D-Bus at
all. It talks MQTT over a websocket to FlashMQ, made bus-aware by the
`dbus-flashmq` plugin, which publishes `N/<portal ID>/...` and accepts writes on
`W/...` (`venus-os-ui.md` section 3.1). A value-forwarding topic bridge can
carry `setValue`; it cannot carry a method call. So every action *had* to become
a value. Venus's own research document reaches the same conclusion from the mos
side, calling it *"a fork in the road rather than a feature to add"*
(`venus-os-ui.md` section 7 item 2).

**My assessment, labelled as mine: the convergence is neither evidence nor
coincidence — it is a shared consequence of a constraint mos has not yet
adopted.** Precisely:

- **Not evidence today.** `apid` is a native bus client in the same trust domain
  as `mosd`, speaking zbus directly (`bus_client.rs:9-20`). It gets *no*
  transport benefit from turning methods into values. Adopting Venus's shape for
  Venus's reason would be cargo cult.
- **Evidence conditionally.** The one case where mos would face Venus's
  constraint is a value-forwarding remote bridge. `docs/design/remote-management.md`
  does plan device-dialled remote reach (SideroLink, `:23-39`) — **but its
  remote plane is Talos `apid` (the upstream machine API daemon, unrelated to
  the mos daemon renamed here) over gRPC against `/run/machined.sock`
  (`:10-21`), not `com.mos.mosd1` at all.** So mos's *current written plan* does
  not create the constraint. If that plan changes such that a remote bridge forwards
  `com.mos.mosd1` values, the convergence becomes real evidence and option 3
  becomes materially more attractive. Recording the condition is more useful
  than picking a side.
- **And one Venus property mos should explicitly refuse.** Venus's writable
  items erase the distinction between a setting and a reading: `venus-os-ui.md`
  section 5.2 records that in the QML *"there is no type-level distinction at
  all"* and the boundary is the substring `/Settings/`. Section 3.3 of this
  document identifies mos's two-method split as structurally stronger and makes
  not throwing it away rule 1. **So mos should take Venus's data-shaped action
  namespace and reject Venus's writable-state-item mechanism.** Actions must not
  become writable *state paths*.

#### 6.4.4 The smallest generic shape that absorbs the known future features

**[proposal]**, deliberately three additions rather than a redesign, ordered by
what each is for. Each is checked against section 4.1's table.

- **(a) A multi-path read.** One call, a list of paths, a reply keyed by path
  with a **per-path** error rather than a whole-call failure (today an absent
  path fails the entire call — `bus.rs:199-201` returns `InvalidArgs`). Absorbs
  every read tile in section 2 and every live nav row in section 3.4.1. **This
  is the one primitive that pays for itself immediately**: one lock acquisition
  per render instead of 8-10 (fact 7), no whole-tree transfer, and it delivers
  the improvement option 1 was being credited with (6.2.2). It needs no new
  crate and no new concept — it is `GetState`/`GetSettings` with a list
  argument.
- **(b) An outcome-carrying write.** Either `SetSettings` returns the
  per-reconciler outcomes it already computes, or a companion method does.
  Fact 8 is the reason: today the outcome is written into the live-state tree
  and thrown away from the reply (`bus.rs:126-137`, `:183-193`). Section 5.11
  works around this with one extra `GetState` on the redirect target and
  documents the narrow race that remains — *"`record` writes no timestamp and no
  generation, so `apid` cannot detect the race locally"*. **(b) closes that race
  properly, and it must land before (c), not after.**
- **(c) One action verb with a named-action namespace.** A single method taking
  an action name and a JSON parameter document and returning a JSON **result
  document**. `Reboot`/`PowerOff` become `power.reboot`/`power.off`;
  the known future features land as `update.install`, `update.confirm`,
  `access.rotate-device-password`, `network.delete-interface`,
  `access.set-web-admin-password` — **none of which needs a new D-Bus member.**
  That converts the 6-to-12-plus trajectory of 6.4.2 item 7 into a flat one.

Not proposed, deliberately: schema discovery (6.4.2 item 3) and a live-state
change signal (item 5). Both are real gaps; neither is needed by anything in
sections 2-5 under section 5.8's recommendation, and proposing mechanism ahead
of a consumer is what produced the 18-row gap table in the first place.

#### 6.4.5 What option 3 costs and forecloses

- **(c) makes option 2's allowlist strictly weaker, and this is not
  negotiable.** Per 6.3.2, D-Bus policy matches header fields only, never
  arguments. A single `Invoke`-style method is therefore **one** allowlist
  entry: the bus can permit it or forbid it and **cannot distinguish
  `power.reboot` from `update.install`**. Collapsing twelve members into one
  collapses twelve possible policy rules into one. **Authorization must then
  move inside `mosd`** — either a caller-identity check using the sender's
  unique name (`sender_of` already extracts it, `bus.rs:140-142`, and
  `Reboot`/`PowerOff` already record it into live state at `:80-89`), or polkit,
  which `dbus-daemon(1)` explicitly recommends for argument-level decisions. **A
  generic action verb adopted *without* that in-daemon authorization is a
  security regression relative to option 2, not a neutral refactor.**
- **(a) and (b) have no such cost.** Both are reads and writes of paths that
  already exist; both remain allowlistable as distinct members. **This
  asymmetry is the reason the recommendation below splits option 3 in half.**
- **A generic surface forecloses per-method D-Bus introspection as
  documentation.** Today `com.mos.mosd1` describes itself: six members with
  typed signatures (`bus.rs:157-254`). After (c), the interface says only
  "actions exist" and the real contract moves into a string namespace that
  nothing enforces and no tool can enumerate. That is a genuine loss for a
  reference-quality management plane and it should be paid for with a written
  action registry, not with nothing.
- **It does not touch the process boundary at all.** `apid` stays root and the
  policy stays open unless option 2 is also done. **Option 3 is orthogonal to
  options 1 and 2, not an alternative to them** — a fact obscured by presenting
  all three as one list, and worth stating plainly.

### 6.5 Side by side

| | **1** merge into `mosd` | **2** two processes, hardened | **3** generic bus surface |
|---|---|---|---|
| Removes the bus hop | yes (but see 7.3) | no | no |
| Fixes the render's lock-acquisition count | yes | no | **yes, via (a)** |
| Fixes fact 8 (swallowed failures) | no | no | **yes, via (b)** |
| Bounds method-per-feature growth | no | no | **yes, via (c)** |
| `apid` can be non-root | **never** | **yes** | unchanged |
| Secrets unreadable by the UI process | **no — impossible** | **yes, by filesystem mode** | unchanged |
| D-Bus policy can be meaningfully allowlisted | n/a (no second process) | **yes** | **weakened by (c)** |
| A UI crash takes the management plane down | **yes** | no | no |
| A UI crash empties live state incl. `health.var` | **yes** | no | no |
| A `mosd` startup failure still renders an error page | **no** | yes | yes |
| New direct dependencies in the root-privileged daemon | **8** | 0 | 0 |
| Units / state directories | 1 / 1 | 2 / 2 | 2 / 2 |
| Is it a delta or a new project? | new project | **new project** (fact 1, fact 2) | new project |

### 6.6 Recommendation

**Adopt option 2, together with the read half of option 3 — primitives (a) and
(b). Defer option 3's action verb (c). Do not merge.**

Five reasons, each traceable above:

1. **Section 7 removes option 1's main premise.** `com.mos.mosd1` has a real
   second consumer today — `mos-health` calls `ReportHealth`
   (`os/rootfs/overlay-v2/usr/lib/mos/mos-health:47-48`) and `GetState`
   (`:155-156`). So the interface must keep existing and keep being served, and
   a merge does not delete the bus: **it deletes one consumer.** ~~The remaining
   consumer keeps the open-policy problem (fact 2) alive in full.~~ Option 1's
   simplification then shrinks to one fewer unit and one fewer state directory,
   which is not worth what 6.2.3 charges for it. This is re-scored formally in
   7.3.

   > **[re-anchored]** — RFCT-058. The struck clause was true when written and
   > **no longer bites: `637295e` (RFCT-048) solved the open-policy problem
   > outright**, so a surviving consumer no longer keeps it alive — there is
   > nothing left alive to keep. **Reason 1 itself is unaffected**, because its
   > load-bearing step is that `mos-health` is a second consumer and the
   > interface must therefore keep being served. That step is about the health
   > gate, not about the policy, and RFCT-048 does not touch it. Reason 1 stands
   > with one supporting clause retired.
2. **The one technical prize is available more cheaply.** Section 5.8 left the
   mutex line open for this section; the answer (6.2.2) is that a merge does not
   shorten the lock hold at all, and the lock-acquisition improvement it *does*
   deliver is delivered identically by option 3(a) without moving an HTTP parser
   into the process that writes `/etc/shadow`.
3. **The status quo is not a neutral baseline.** A root web server on
   `0.0.0.0:443` and `0.0.0.0:80` (facts 1 and 4) behind a D-Bus policy that
   ~~lets any local uid call `Reboot` (fact 2)~~ let any local uid call `Reboot`
   until `637295e` was the least defensible of the four
   states available, and it is the one mos is in. Doing nothing is a choice with
   a cost, and it should be scored as one.

   > **[re-anchored]** — RFCT-058. **This is the reason RFCT-048 costs the
   > most.** The status quo is no longer "a root web server on `0.0.0.0`
   > *behind a policy any uid can call*" — the second half is gone as of
   > `637295e`, and with it most of this reason's force.
   >
   > **What survives, and it is not nothing.** Facts 1 and 4 are **unchanged**:
   > `apid` still runs as root and unsandboxed, and still binds `0.0.0.0:443`
   > and `0.0.0.0:80`. A root web server on every interface is still not a
   > neutral baseline, and doing nothing is still a choice with a cost. So
   > **reason 3 is reduced, not retired** — it now rests on the process and its
   > listener rather than on the bus, and the "least defensible of the four
   > states" framing should be read as materially overstated today.
4. **Option 2 buys something no other option can.** A non-root `apid` cannot
   open `/var/lib/mos/secrets/*` (mode `0600` in a `0700` directory,
   `identity.rs:43`, `:51-56`), so section 2.10's *"No secrets, ever"* becomes a
   filesystem property instead of a code discipline. A merged daemon must be
   able to write those files, so option 1 forecloses this permanently.
5. **The availability regression under option 1 is the wrong one for this
   product.** A hard provisioning failure (`mosd/mosd/src/main.rs:53-63`)
   currently still leaves a UI that says *"The management daemon is
   unavailable."* (`routes.rs:95-105`). Merged, it leaves a serial console. For
   a headless appliance whose operator may be on a phone attached to a setup
   access point, that is the failure mode least acceptable to regress.

**Stated honestly in the other direction, because the recommendation should not
read as one-sided.** Option 2 concentrates nothing but it *fixes* nothing the
operator can see: it costs a system user, a rewritten unit, a new D-Bus policy,
an image change to create the user, and new verifier assertions — and at the end
the dashboard is identical. Option 1 is a genuinely smaller system to reason
about, to build and to operate, and "one daemon, one state directory, one
restart domain" is a real engineering virtue on an appliance. If the user judges
that the appliance's threat model does not include a hostile local uid and does
not include a pre-auth HTTP CVE, **option 1 is a coherent choice** and the
honest summary of it is: *mos would be accepting that its management plane and
its web server are one trust domain, permanently, and would be giving up the
ability to change its mind cheaply later.*

**If the user chooses option 1 anyway, four conditions follow from the analysis
above and should be treated as part of the option, not as follow-ups:**

> **[decided] — moot.** Option 1 was not chosen (§6 marker), so none of the four
> conditions below is live. They are kept because they are what option 1 would
> have cost, not deleted.

- Keep serving `com.mos.mosd1`. `mos-health` depends on it (7.1), and dropping
  it silently breaks the boot health gate — which would then stop confirming
  A/B slots.
- Decide, in writing, what happens to `health.var` across a restart (6.2.3b).
  The current answer is "it is lost until the next boot", and section 2.3's
  health tile is built on it.
- Decide what serves the error page when `mosd` cannot start (6.2.3b). "Nothing"
  is an acceptable answer only if it is a decision.
- Migrate or orphan `/var/lib/mos/webd` on deployed devices (7.4).

**Effect on section 5's technology choice: none.** Section 5.8 chose option A,
`meta http-equiv="refresh"` on read-only pages, on C3 (works without JavaScript)
and C4 (`mosd` has no live-state push) grounds. Neither is touched by anything
here. Option 3(a) makes each refresh **cheaper**, which strengthens 5.8 rather
than reopening it. Had this section recommended a merge, section 5.8's open line
about a shorter interval would have become live; it does not.

#### 6.6.1 What RFCT-048 changes here, and what it explicitly does not

> **[re-anchored]** — RFCT-058, campaign `apid`. Added because five reasons
> above cite fact 2, and a reader who discovers on their own that fact 2 has
> moved needs to be told immediately how far the damage travels. It does not
> travel to the outcome.

**The decision recorded in §6 is NOT reopened. It stands unchanged.**

The user's decision to keep two processes rested on exactly two findings, both
recorded in §6's marker:

1. a merged process makes a provisioning failure **fatal to the UI**, leaving a
   headless appliance with a serial console and nothing else; and
2. `com.mos.mosd1` is **load-bearing for the update health gate** — `mos-health`
   probes `GetState` and never reaches `rauc status mark-good` without it.

**`637295e` touches neither.** It changes who may call the interface, not
whether the interface must exist, and not what happens to the UI when
provisioning fails. Both findings are exactly as true after RFCT-048 as before.

What changed is **the strength of two supporting arguments inside the option
comparison, not the outcome of it**:

| §6.6 reason | Status after `637295e` |
|---|---|
| **1** — section 7 removes option 1's premise | **Stands.** One supporting clause (the open-policy problem surviving a merge) is retired; the load-bearing `mos-health` step is untouched |
| **2** — the one technical prize is cheaper elsewhere | **Untouched.** It is a lock-hold argument (6.2.2), unrelated to bus policy |
| **3** — the status quo is not a neutral baseline | **Reduced.** Carried now by facts 1 and 4 alone (root web server on `0.0.0.0:443` and `:80`), which are unchanged |
| **4** — option 2 buys what no other option can | **Untouched, and now the strongest surviving argument for option 2.** A non-root `apid` cannot open `/var/lib/mos/secrets/*`, making §2.10's *"No secrets, ever"* a **filesystem property** rather than a code discipline. No policy change can deliver this; only a `User=` can |
| **5** — the availability regression is the wrong one | **Untouched.** It is the same finding as the first leg of §6's decision |

**Therefore: the options are not re-scored, no new recommendation is made, and
§6's [decided] marker is not reopened.** Three of five reasons are untouched,
one stands with a retired clause, and one is reduced but not retired. The
recommendation those reasons supported — *adopt option 2, do not merge* — is
where it was.

**One item of option 2 is now partly built.** RFCT-048 delivered the
default-deny policy that §6.3.2 proposed. Option 2's remaining D-Bus work is the
`user="apid"` block, and `mosd/dist/com.mos.mosd.conf` already carries it as a
written-out `EXTENSION POINT` with the instruction to **add** a named-user block
rather than reopen the default context. **The unit hardening — `User=`,
`AmbientCapabilities=`, the sandboxing set — remains entirely unbuilt**, and it
is the half that reason 4 depends on.

### 6.7 One correctness risk that must be recorded rather than lost

Section 2.5 proposes a tile showing boot attempt credits, and section 4.1 item 2
costs it against gap row 2. Both touch the redundant U-Boot environment. **The
hazard around that environment has been mis-stated before, so it is recorded
here in its correct form.** No fix is proposed; the point is that it cannot be
lost or closed as invalid.

1. **The boot-path writer-versus-writer hazard IS handled. Do not re-report
   it.** `os/rootfs/overlay-v2/usr/lib/systemd/system/mos-health.service:10-13` carries `After=mos-machine-id.service`
   with a comment naming this exact interlock: *"U-Boot environment writer
   interlock: mos-machine-id owns `machine_id`, RAUC (invoked from here by
   mark-good) owns BOOT_ORDER/BOOT_x_LEFT. Ordering keeps the two writers
   strictly sequential."* The other writer states the same split from its own
   side — `os/rootfs/overlay-v2/usr/lib/mos/mos-machine-id:15-18`: *"this unit owns `machine_id` and
   nothing else. `BOOT_ORDER` and `BOOT_x_LEFT` belong to RAUC. The two writers
   are never concurrent."* RAUC's write happens through `rauc status mark-good`
   at `os/rootfs/overlay-v2/usr/lib/mos/mos-health:203-207`.
2. **What the interlock is, and what it is not.**
   `os/rootfs/overlay-v2/etc/fw_env.config.in:23-25` still records the
   underlying property: *"Two writers exist for this environment (RAUC slot
   marking and the first-boot machine-id oneshot), and libubootenv gives no
   cross-process locking, so their writes must never overlap."* The interlock is
   **boot-time systemd ordering between two boot oneshots** and buys nothing
   outside that window. There is no lock.
3. **The window is narrower than it looks, which is why testing misses it.**
   `mos-machine-id` exits early when a valid `machine_id` is already set
   (`os/rootfs/overlay-v2/usr/lib/mos/mos-machine-id:43-47`), and the value lives in the U-Boot
   environment, so it survives an update (`:2-9`, and the unit is additionally
   gated off by `ConditionKernelCommandLine=!systemd.machine_id`,
   `os/rootfs/overlay-v2/usr/lib/systemd/system/mos-machine-id.service:5`). **So the two-writer boot is the first
   boot of a freshly flashed device, not the first boot after an update.**
   Anyone testing the update path finds nothing and concludes there is nothing
   to find.
4. **The residual, and it is introduced BY the dashboard rather than inherited.**
   Both halves come from proposals in this document:
   - **A dashboard that POLLS boot credits is a reader racing a writer that is
     ordered against nothing.** The boot-time ordering says nothing about a read
     issued at an arbitrary moment by a UI on a 15-second refresh (section 5.8).
   - **A UI-triggered `rauc install` writes the environment at an arbitrary
     moment, outside any boot ordering at all.** That is gap row 4 / section 4.1
     item 4, and section 2.5 proposes exactly it.

   **Reading the environment safely is therefore itself unsolved.** A future
   feature that polls boot credits **inherits** this hazard rather than avoiding
   it, and the interlock above does not cover it. This is a prerequisite for
   section 8's phase 4d, not a detail of it.

### 6.8 Unverified / gaps for section 6

1. **Nothing was run.** No `cargo`, no binary built, no unit started, no device
   booted, no bus traffic observed. Every claim is read from source in this tree
   or quoted from a fetched manual page.
2. **No latency, size or contention figure is measured.** The bus round-trip
   cost (6.2.1), the binary size (6.2.1), the merged dependency-graph size
   (6.2.1) and the reconcile duration behind fact 7 are all **not measured**,
   and are marked as such wherever they appear. Do not let an implementer read
   an adjective here as a number.
3. **`StateDirectory=` ownership on an already-populated directory** (6.3.1b) is
   documented for the directories systemd creates; whether systemd re-chowns an
   existing `/var/lib/mos/apid` when `User=` is added later was **not verified**
   and is the one item in option 2 that could surprise an upgrade.
4. **The sandboxing table (6.3.1c) is derived from documentation and from
   reading `mosd/apid/src/`, not from running a hardened unit.**
   `MemoryDenyWriteExecute=` and `ProtectProc=` are the two most likely to
   behave differently in practice.
5. **The high-port-plus-redirect costs (6.3.1a)** — the `Location` port bug and
   the loopback `OUTPUT`-chain requirement — are read out of
   `mosd/apid/src/main.rs:80-83` and `os/rootfs/overlay-v2/usr/lib/mos/mos-health:168` plus standard
   netfilter behaviour. Neither was tested.
6. **`mosd` "runs as root" is an inference from the absence of `User=`** in
   `mosd/dist/mosd.service`, exactly as it is for `apid` (fact 1). The set of
   privileged operations listed in 6.2.3a is verified by direct citation; the
   uid it runs under is not stated anywhere in the tree.
7. **The `sshweb` branch was not read**, per the campaign fence. Its announced
   `SetTransientRootPassword` would make fact 3 six methods rather than five and
   would add one row to any allowlist; nothing else above changes.
8. **Venus material is carried from the two research documents and was not
   re-verified against Victron sources** (and, per the licence fence, must not
   be copied from in any case).

---

## 7. Is `com.mos.mosd1` a supported external contract?

Option 1's whole case rests on an unstated premise: that removing `apid` removes
the bus. It only does if `apid` is the interface's sole consumer. **It is not**,
so the question is answered here rather than assumed, and option 1 is re-scored
against the answer in 7.3.

### 7.1 Who consumes it today — two consumers, not one

| Consumer | Calls | Cited | Status |
|---|---|---|---|
| **`apid`** | `GetSettings`, `SetSettings`, `GetState`, `Reboot`, `PowerOff` | `mosd/apid/src/bus_client.rs:9-20` | in tree |
| **`mos-health`, the boot health gate** | **`ReportHealth`** and **`GetState`** | `os/rootfs/overlay-v2/usr/lib/mos/mos-health:45-50` (the `report_health` helper, calling `busctl ... com.mos.mosd1 ReportHealth sss`), invoked at `:194` and `:197`; and `:151-160`, which calls `busctl ... com.mos.mosd1 GetState s ""` as probe b and **fails the gate** if `mosd` does not answer | in tree, shipped, and load-bearing |

`mos-health` is a **real second consumer today**, and it is not incidental:

- It is not a Rust caller linking `mosd`'s types — it is a POSIX shell script
  invoking `busctl` (`os/rootfs/overlay-v2/usr/lib/mos/mos-health:47-48`, `:155-156`). It consumes
  `com.mos.mosd1` as a *wire* interface, member names and signature included.
- Probe b is **fatal**: `fail "mosd did not answer com.mos.mosd1.GetState on the
  system bus"` (`mos-health:159`). A gate failure means `rauc status mark-good`
  at `:203-207` never runs, so **the booted A/B slot is never confirmed**, and
  the U-Boot boot-credit counter performs a rollback instead
  (`os/rootfs/overlay-v2/usr/lib/systemd/system/mos-health.service:21-23`: *"The gate is advisory. On failure it
  does nothing: the U-Boot BOOT_x_LEFT counter performs the rollback"*). Breaking
  `com.mos.mosd1` therefore does not produce a broken UI — it produces a device
  that rolls back its own updates.
- It used to ship in two byte-identical copies, `os/rootfs/overlay-v2/usr/lib/mos/mos-health` and
  `os/rootfs/overlay-v2/usr/lib/mos/mos-health`, hand-staged between each other
  and watched by five `cmp` checks in `os/tests/health-test.sh`. **RFCT-111
  (PLAN-014 M5) deleted the `os/health/` copy and its stager.** There is one
  copy, the overlay one, which is the one the image build installs; the drift
  those checks watched for is not detected now, it is impossible.

`apid` also has a second, non-bus relationship to the gate that matters for
section 8: probe c fetches `https://127.0.0.1/healthz`
(`os/rootfs/overlay-v2/usr/lib/mos/mos-health:162-181`), and `os/verify-image-v2.sh:1184-1200` asserts
that an HTTP client is present in the image so that probe cannot silently
degrade to `SKIP`. So `apid`'s HTTPS listener is *also* part of the boot gate's
contract, on port 443 specifically.

### 7.2 Who might consume it, and the honest status of each

- **A kiosk / local display client — no, and the design says so.**
  `docs/design/display.md:9-14` states the principle plainly: the local display
  *"renders the same apid UI that remote browsers use, in a kiosk session
  pointed at `https://127.0.0.1`. No second UI stack to maintain"*, and local
  affordances are *"apid routes selected by the kiosk, not separate code"*. The
  component stack diagram at `:16-24` puts cage + WPE WebKit above `apid` over
  localhost. **The kiosk is a consumer of `apid`'s HTTP surface, not of
  `com.mos.mosd1`.** Recorded because it is the most natural thing to assume the
  other way round, and assuming it would inflate the case for keeping the bus.
  It does, however, mean the kiosk is a **second consumer of `apid`** — which
  strengthens rather than weakens the two-process picture, and which makes the
  port-443 question in 6.3.1a a kiosk question as well as a health-gate one
  (`display.md:81-83` notes the kiosk browser renders only localhost by default).
- **A future remote-management bridge — planned, but against a different
  interface.** `docs/design/remote-management.md:23-39` plans SideroLink, a
  device-dialled WireGuard tunnel with *"no inbound port on the device"* (`:68`).
  But its remote plane is **Talos `apid` (the upstream machine API daemon, not
  the mos daemon renamed here) over gRPC :50000 with mutual TLS**, and both
  frontends in that document are described as *"thin frontends over
  `/run/machined.sock`"* (`:10-21`). **Nothing in that design makes a remote
  bridge a `com.mos.mosd1` consumer.** So this is a *possible* future consumer
  and not a planned one, and it must not be counted as an existing constraint.
  It is, though, exactly the case discussed in 6.4.3: if a remote bridge ever
  forwards `com.mos.mosd1` *values*, option 3's action shape stops being
  optional.
- **Operator and third-party tooling — was enabled by accident, and has since
  been withdrawn.** Fact 2 was not only a security posture; it was also a
  de-facto contract. `<policy context="default"><allow
  send_destination="com.mos.mosd"/></policy>`
  (`mosd/dist/com.mos.mosd.conf:8-11` as of `637295e^`) meant **any local
  process, of any uid, could call any member**, and `busctl` is in the image
  (the health gate uses it). Anyone who had written a script against
  `com.mos.mosd1` on a shipped device was a consumer, whether or not mos
  intended one. **Option 2's allowlist would break exactly those callers** —
  which is a cost that should be stated rather than discovered, and an argument
  for doing the allowlist *early*, before the informal consumer set grows.

  > **[re-anchored]** — RFCT-058. **The argument for acting early was correct,
  > and `637295e` (RFCT-048) is what acting early looked like.** The de-facto
  > contract is already withdrawn: any non-root local script calling
  > `com.mos.mosd1` stopped working at that commit, not at some future option-2
  > allowlist. So this is no longer a *pending* cost of option 2 — **it is a
  > cost already paid**, and the paragraph should be read as the record of a
  > break that has happened rather than a warning about one that might.
  > Root-owned scripts are unaffected, which is why the health gate did not
  > notice. What option 2 would still add is per-member narrowing *within* root
  > and a separate `apid` identity; the "any uid" consumer set no longer exists
  > to be broken a second time.
- **The `sshweb` campaign** adds a sixth member (`SetTransientRootPassword`,
  announced only, not in this tree). A campaign actively adding members to the
  interface is itself evidence that it is being treated as a live contract.

### 7.3 The answer, and option 1 re-scored

**Answer: yes, `com.mos.mosd1` is a supported contract, and it must remain
served regardless of which process option is chosen.** The reason is not
aspirational — it is `mos-health`, which is in the image, calls the interface
over `busctl`, and whose failure path is an A/B rollback rather than a cosmetic
error (7.1).

**Therefore option 1 does not remove the bus. It removes one consumer.**
Re-scoring 6.2 against that, plainly:

- `mosd` must still own `com.mos.mosd`, still serve `com.mos.mosd1`, still
  answer `GetState` and `ReportHealth`, and still ship
  `mosd/dist/com.mos.mosd.conf`. The zbus dependency, the interface definition,
  the object path and the policy file all stay.
- ~~**The open-policy problem (fact 2) survives the merge entirely.** With one
  process instead of two, `<allow send_destination="com.mos.mosd"/>` still lets
  any local uid call `Reboot`. Option 1 does not make that better and does not
  make it worse; it simply leaves it,~~ while removing the *option* of ever
  fixing it by uid separation between the UI and the daemon.

  > **[re-anchored]** — RFCT-058. True when written; retired by `637295e`
  > (RFCT-048), which fixed the open-policy problem outright, so there is no
  > longer a fact-2 problem for a merge to survive. **The trailing clause is the
  > part that survives, and it survives intact**: a merge would still remove the
  > *option* of separating the UI from the daemon by uid, because a merged
  > daemon must hold every privilege either process needs. That is a statement
  > about process identity, not bus policy, and RFCT-048 does not reach it.
  > **The re-score's conclusion is unchanged** — option 1 removes one consumer,
  > not the bus.
- The saving therefore reduces to what 6.2.1 measured minus the bus surface
  itself: **one systemd unit, one state directory, one binary, and the
  per-request round trips of one caller.** Against 6.2.3's foreclosure list —
  permanent root-resident TLS, no fault isolation, `health.var` lost on restart,
  no error page when `mosd` cannot start, eight new dependencies in the
  privileged daemon — that is a poor trade, and it is the specific reason 6.6
  recommends against it.

**If the interface did *not* need to remain supported, what would mos give
up?** Worth stating, because it is the strongest form of the option-1 argument:
`mos-health` would have to learn a different channel for `ReportHealth` and for
its liveness probe — plausibly HTTP against `apid`'s existing `/healthz`
(`mosd/apid/src/routes.rs:54`, `:142-144`, already exempt from the auth gate at
`:117`), which the gate *already* speaks (`mos-health:162-181`). That is a real,
small, plausible migration. What mos would give up is: the ability for any
future non-HTTP consumer to reach the management plane; introspectable, typed
member signatures as documentation (`bus.rs:157-254`); and the option of ever
placing a uid boundary between the UI and the daemon, which cannot be
reconstructed once the code is one process. **Those are architectural options,
not features**, and the honest framing is that option 1 spends them rather than
that it breaks something.

**The Venus contrast, and what it does and does not prove.** Venus's UI is a bus
client by construction: gui-v2 is WASM in a browser, unable to reach D-Bus at
all, so it reaches the bus through FlashMQ and the `dbus-flashmq` plugin
(`venus-os-ui.md` section 3.1), and *that* is why its action surface is data
rather than methods (`venus-os-ui.md` section 7 item 2). Venus therefore never
had the option of merging its UI into its daemons — the bus **is** the UI's only
API. mos does have that option precisely because `apid` is a native local
process. So the Venus contrast does not argue against merging; **it argues that
Venus's action-as-data shape is a consequence of a constraint, which is exactly
the reading 6.4.3 reaches.**

### 7.4 The rename sub-question

> **[decided]** — campaign `apid`, 2026-08-19, RFCT-056. **The name chosen is
> `apid`.** Not `dashboard`, and not `webui`.
>
> **Reason, in one line:** it is the API daemon; the dashboard is what it
> serves — which is precisely the objection 7.4.3 raises against `dashboard`
> (the process serves ten routes, of which the dashboard is one).
>
> **Reading note for all of §7.4.** This section measures and costs the rename,
> so every path and string it cites is a **pre-rename** path, deliberately left
> as `webd`. RFCT-055 executed the code-side rename on its own branch; the paths
> below are what it started from, not what the tree looks like after it.

The campaign began with "should `webd` be renamed to `dashboard`". **Under
option 1 the question is moot** — the process disappears and the name goes with
it. Under options 2 and 3 it is live, so it is costed here.

#### 7.4.1 The migration cost, enumerated with cited paths

`webd` appears in **95 files** in this tree (`grep -rln webd`, excluding
`.git`): **65 under `docs/`** and **30 elsewhere**.

> **Re-measured on this branch** (base `86cd669`, campaign `apid`, RFCT-056).
> The original figure was **83 files** (54 docs / 29 elsewhere), measured before
> the `sshweb` campaign landed; that campaign added docs and task records naming
> the daemon. Only the count is corrected — **the table below is not
> re-derived**, and its per-surface findings stand as measured.

| Surface | Files and lines | Note |
|---|---|---|
| **Crate and binary name** | `mosd/webd/Cargo.toml:2` (`name = "webd"`); workspace member list `mosd/Cargo.toml:3`; the directory `mosd/webd/`; cross-build script `mosd/hack/build-aarch64.sh:9` (`-p mosd -p webd`) and `:11` | Mechanical |
| **systemd unit** | `mosd/dist/webd.service` (13 lines, the file itself); ordering reference in `os/rootfs/overlay-v2/etc/systemd/system/var-lib-mos.mount:10` (`Before=mosd.service webd.service`) and its comment at `:3` | The unit is also what option 2 rewrites — see 7.4.2 |
| **D-Bus policy** | **zero cost today** — `mosd/dist/com.mos.mosd.conf` does not contain the string `webd` (verified: `grep -c webd` returns 0). It is a ~~12-line~~ **73-line** file whose only identity is `root` — see the staleness note below | **But under option 2 the policy gains a `user="<webd user>"` rule (6.3.2), at which point this becomes a rename surface.** Ordering matters |
| **Image verifier assertions** | v2: `os/verify-image-v2.sh:922-929` — four assertions plus `sq_enabled webd.service`; and `:1184-1200`, the health-probe block that names `webd` in both its `pass` and `fail` strings. v1: `os/verify-image.sh:603-628` — seven assertions on the binary, the ELF architecture, two unit lines and the enablement symlink | Two verifiers when measured; **one since RFCT-107 deleted the v1 chain** |
| **`StateDirectory` and deployed data** | `mosd/dist/webd.service:10` (`StateDirectory=mos/webd`); default `WEBD_STATE_DIR=/var/lib/mos/webd` at `mosd/webd/src/config.rs:38-40`; documented at `mosd/webd/src/main.rs:12-13` | See 7.4.2 — this is the only item with a cost on **already-deployed** devices |
| **Image / build wiring** | `os/rootfs/build-v2.sh:73-74` and `os/rootfs/build.sh:39-40` (stage the binary and the unit); `os/rootfs/Dockerfile.v2:282-288` (install binary, unit and enablement symlink) and `:377`; `os/rootfs/Dockerfile:211-217` and `:289`. **The `build.sh` / `Dockerfile` half is gone since RFCT-107** | **The `Makefile` is not affected**: `grep -c webd Makefile` returns 0. Its 70 lines only route to the scripts above. Recorded because it is commonly assumed otherwise |
| **Health gate** | `os/rootfs/overlay-v2/usr/lib/mos/mos-health:162-181` (probe c: `unit_present webd.service`, `https://127.0.0.1/healthz`); and `os/tests/health-test.sh` | One file since RFCT-111 collapsed the `os/health/` duplicate into the overlay copy |
| **Settings schema** | **No persisted key changes.** The only `webd` strings under `mosd/mosd-settings/` are doc comments — `src/model.rs:51`, `:65` and `src/migration.rs:121`, `:126` (*"v1 -> v2: adds the webd-owned `access` subtree"*). No serde rename, no key, no TOML field. **So a rename needs no settings migration** | The single most reassuring finding here |
| **Docs** | 54 files, **of which 10 are `*.zh.md`**: `docs/architecture.zh.md`, `docs/README.zh.md`, `docs/design/{access,boards,display,mosd,provisioning,remote-management}.zh.md`, `docs/research/{init-strategy,os-comparison}.zh.md` | The Chinese copies are translations that will silently contradict the English after a rename. They are outside this campaign's scope and were not edited |

> **[re-anchored]** — RFCT-058, campaign `apid`. **Two different staleness axes
> cross in the table above, and only one of them is frozen.**
>
> **The correction just made is on the RFCT-048 axis, not the rename axis.** The
> line count "12" was never a statement about `webd` or about the rename. It was
> a measurement of the policy file's size, and it went stale at `637295e`
> (RFCT-048) when the file grew from 12 lines to 73 — **before this campaign
> began.** Proof that it is the earlier axis and not the rename: the file was
> already 73 lines at `86cd669`, the pre-rename base this section is frozen
> against. The freeze could not have protected the figure, because the figure
> was already wrong when the freeze was taken.
>
> **The pre-rename freeze is unchanged and still in force.** Every path and
> string in §7.4 remains deliberately `webd` — `mosd/webd/`, `webd.service`,
> `WEBD_STATE_DIR`, `mosd/webd/src/config.rs` and the rest are **not** rewritten
> to `apid`, exactly as RFCT-056 left them, because this section measures what
> the rename cost *from* its starting point. Nothing about that preservation is
> abandoned here.
>
> **The rule this draws, worth keeping.** *"It is a preserved measurement"* is a
> defence against being updated on the axis it was preserved for. It is not a
> defence against every later fact. A frozen section can still carry a number
> that was never about the freeze, and that number gets no protection from it —
> so a preserved section must say **which axis** it is frozen on, or it will be
> read as frozen on all of them. The two remaining `webd`-vs-`apid` figures in
> this table stay put; the policy line count does not.
>
> Neither the per-surface findings nor the file counts above are re-derived.

#### 7.4.2 The one cost that lands on deployed devices

> **[decided]: orphan** — campaign `apid`, 2026-08-19, RFCT-056. This matches
> this section's own **[proposal]** below. **No migration code was written.**
>
> **What a fielded device loses.** `/var/lib/mos/webd` is orphaned on STATE; the
> new daemon uses `/var/lib/mos/apid` and never looks at the old directory. The
> self-signed certificate therefore regenerates, so **every operator's stored
> browser exception breaks once**. The session signing key is new, so existing
> sessions are invalidated — indistinguishable from the restart that already
> logs everyone out.
>
> **What is NOT lost.** The admin password hash is **not** in that directory: it
> lives in the settings tree, at `access.webAdmin.password_hash`. A device keeps
> its admin credential across the rename.
>
> **Why.** Every device today is a dev unit, and a migration path is code that
> exists only to serve a window that closes.

`/var/lib/mos/webd` is on the **STATE** partition — `/var/lib/mos` is a bind
mount established by
`os/rootfs/overlay-v2/etc/systemd/system/var-lib-mos.mount:10-16`, ordered
`Before=mosd.service webd.service` (`:10`), and STATE survives an A/B update
(tier table, `docs/design/ro-root.md:363-368`). So on any device already in the
field the directory exists with contents. It holds exactly three things:
`cert.pem`, `key.pem` (`mosd/webd/src/tls.rs:48-49`) and `session.key`
(`tls.rs:85-86`).

**Migrate or orphan?** The costs are asymmetric and small, and should be decided
rather than defaulted:

- **Orphaning `session.key` costs nothing.** Sessions are in-memory only and a
  restart already logs everyone out — `mosd/webd/src/session.rs:1-6`: *"Sessions
  live in memory only and expire after 24 hours, so a webd restart logs everyone
  out."* A new signing key is indistinguishable from a restart.
- **Orphaning `cert.pem`/`key.pem` has one visible cost.**
  `load_or_generate_certificate` regenerates a self-signed pair when the files
  are absent (`tls.rs:47-81`), so an orphaned directory means a **new
  certificate**, which means **every operator's stored browser exception breaks
  and they see a certificate warning again** on a device they had already
  accepted. On an appliance whose TLS is self-signed by design that is a
  recurring, familiar prompt rather than an outage — but it is exactly the
  prompt an operator is trained to click through, and re-training that reflex
  has a security cost of its own.
- **Migrating** is a one-time rename of a directory on STATE, ordered before the
  daemon starts. Cheap, and it needs somewhere to live (a rootfs oneshot or an
  `ExecStartPre`), which is new machinery for a one-off.

**[proposal]** Orphan it, and say so in the release note. The only real loss is
the certificate exception, and paying it once at a rename is cheaper than
carrying a migration step forever. **But this is the user's call, and it is the
only part of the rename that a fielded device notices.**

#### 7.4.3 Recommendation on the rename — the user decides

> **[decided] — the user overrode this recommendation.** Campaign `apid`,
> 2026-08-19, RFCT-056. **The rename was done now, standalone, without the
> option-2 hardening.** The §6 decision settled *do not merge*; it did not
> commission the option-2 non-root user, so the unit rewrite this section wanted
> to bundle with has not happened and has no date.
>
> **The cost this section named is accepted, not disputed.** The argument below
> is correct as written and is not softened: because the rename went first, the
> unit (`mosd/dist/apid.service`, the renamed file), **both** image verifiers
> (`os/verify-image-v2.sh`, `os/verify-image.sh`) and the **two** `mos-health`
> copies (`os/rootfs/overlay-v2/usr/lib/mos/mos-health` and the overlay copy) **will be edited a second
> time** if and when option 2 is built. Bundling would have been roughly half
> the work; sequencing was chosen anyway, and this is what it costs.
>
> *RFCT-107 (PLAN-014 M1) has since deleted the v1 chain, so
> `os/verify-image.sh` is no longer one of the files that second edit would
> touch. The cost is one verifier, not two; nothing else in the argument
> changes. RFCT-111 (PLAN-014 M5) has since collapsed the two `mos-health`
> copies into the overlay one, so that second edit is one file too.*

**Recommendation: do not rename as a standalone change. Rename only if and when
the option-2 unit rewrite happens, in the same change.**

The reason is ordering, not aesthetics. Option 2 already rewrites
`mosd/dist/webd.service` (adding `User=`, ambient capabilities and the
sandboxing set), already adds a `user="..."` rule to
`mosd/dist/com.mos.mosd.conf` — a file that has **no** rename cost today and
would acquire one at that moment (7.4.1) — and already forces new assertions in
both verifiers. **[re-anchored]** — RFCT-058: `637295e` (RFCT-048) made that
policy default-deny, so the `user="..."` rule is now the *only* D-Bus item
option 2 has left; the ordering argument is unchanged, since it turns on the
unit and the verifiers being edited twice, not on the policy's contents. Doing the rename separately means editing the unit twice, both
verifiers twice, the two `mos-health` copies twice, and answering the deployed
`StateDirectory` question twice. **Bundling is roughly half the work of
sequencing.**

**On the name itself, two things worth weighing before choosing one.** This is
offered as input, not as a decision:

- `dashboard` is accurate for the *product* this document designs and inaccurate
  for the *process*. That process also serves `/setup`, `/login`, `/logout`, the
  three editor panes and the power routes, and the entire HTTP-listener redirect
  router — ten routes, of which the dashboard is one
  (`mosd/webd/src/routes.rs:40-57`, `:61-65`). Naming the process after its
  landing page invites the same confusion in reverse in two years.
- If the goal is "name the process for what it is", something like `webui` or
  `mos-webui` survives the UI growing past a dashboard; if the goal is to align
  the codebase with the product language this document establishes, `dashboard`
  wins. **Both are defensible; the tie-breaker is which of those two goals the
  user actually holds, and only the user knows that.**

---

## 8. Phased delivery

Milestones, each with scope, `mosd` prerequisites cited by gap-table row, and
how it is verified. Phase 1 is shippable on its own and **does not depend on the
section 6 decision**; that independence is stated explicitly in 8.1 because it
is the property that keeps the architecture question from blocking the product.

### 8.1 What is architecture-independent, stated first

**Everything in phase 1 is unchanged by whichever of options 1, 2 and 3 is
chosen.** Concretely, none of the following touches a unit file, a D-Bus policy,
a process boundary, a uid, or `mosd`:

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
`SettingsApi` (`mosd/apid/src/settings_api.rs:13-20`), a trait whose entire
purpose is that the transport underneath it is substitutable — its doc comment
says handlers depend on it *"so tests can substitute an in-memory fake for the
D-Bus client"* (`settings_api.rs:1-4`). Under option 1 the implementation behind
that trait becomes a direct call instead of a bus call; under options 2 and 3 it
stays a bus call. **The handlers do not change either way.** That is the
strongest practical argument for shipping phase 1 first regardless of the
section 6 outcome.

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
  pattern — `mosd/apid/src/tests.rs` is 591 lines of exactly this shape.
- Three specific behaviours are worth pinning as tests because they are the ones
  a refactor silently loses: a reconciler whose live-state entry is
  `{"error": ...}` renders in the error register and **not** as raw JSON
  (`bus.rs:126-137` produces it; `routes.rs:587-596` is what must stop dumping
  it); network half B renders its absence statement and never borrows half A's
  numbers (section 2.4); and a pane whose reconciler failed is **shown with the
  error**, never hidden (section 3.4.2's fence).
- The auto-refresh off-switch is reachable without JavaScript (section 5.3
  cost 1, WCAG F41).
- Image contract unchanged: `os/verify-image-v2.sh:922-929` should still pass
  untouched. **If phase 1 changes anything the verifier asserts, phase 1 has
  left its scope.**

#### Phase 2 — the section 6 decision, executed

> **[decided], partly.** Campaign `apid`, 2026-08-19, RFCT-056. The merge branch
> is closed — option 1 was not chosen (§6), so the "if the user chooses option 1
> instead" alternative below is moot. **The rest of this phase is still open:**
> the option-2 non-root user, the rewritten unit and the default-deny D-Bus
> policy were *not* commissioned by that decision and remain unscheduled. Item 3
> below is **already done and unbundled** — the rename shipped standalone
> (§7.4.3), against this document's recommendation and at the cost recorded
> there.

This is the only phase gated on the user's answer. Written for the 6.6
recommendation (option 2 + option 3's (a) and (b)); if the user chooses option 1
instead, this phase is replaced by the merge plus the four conditions listed at
the end of 6.6.

**Scope.**
1. A static system user created in the rootfs (`os/rootfs/Dockerfile.v2`), a
   rewritten `mosd/dist/apid.service` carrying `User=`,
   `AmbientCapabilities=CAP_NET_BIND_SERVICE`, a matching
   `CapabilityBoundingSet=`, and the sandboxing set of 6.3.1c.
2. ~~`mosd/dist/com.mos.mosd.conf` replaced with a default-deny~~ **done at
   `637295e` (RFCT-048)** — plus per-member
   allows: the five members of fact 3 for the `apid` user, `ReportHealth` and
   `GetState` for root (the health gate's two calls). **[re-anchored]** —
   RFCT-058: the default-deny half of this item is **shipped**; what remains is
   the `user="apid"` block, which the shipped file already sketches at its
   `EXTENSION POINT` comment, and the optional per-member narrowing that the
   same comment defers with reasons.
3. ~~Optionally the rename (7.4.3), bundled here if it happens at all.~~
   **Done already, not bundled** — see the marker above.

**`mosd` prerequisites: none — this phase closes no gap-table row.** It is
posture, not capability, and it is worth saying so: nothing an operator can see
changes.

**Verification.**
- New verifier assertions beside the existing block at
  `os/verify-image-v2.sh:922-929`: the unit carries `User=`, `NoNewPrivileges=`
  and `ProtectSystem=`; and the policy file no longer contains a bare
  `<allow send_destination="com.mos.mosd"/>` in the `default` context.
- **The honest end-to-end test is the boot health gate itself.** Probe c
  (`os/rootfs/overlay-v2/usr/lib/mos/mos-health:162-181`) fetches `https://127.0.0.1/healthz` on port
  443; probe b (`:151-160`) calls `com.mos.mosd1 GetState` over `busctl` as
  root. If the capability change broke the port bind, probe c fails. If the
  allowlist was written wrong, probe b fails. Both fail the gate loudly. That is
  a better test than any assertion about file contents, and it already exists.
- Verify the deployed-device ownership question of 6.3.1b (does systemd re-chown
  an existing `/var/lib/mos/apid`?) **before** shipping, not after. It is listed
  in 6.8 item 3 as unverified for a reason.
- Confirm the known breakage of 7.2: any local script calling `com.mos.mosd1`
  outside the allowlist stops working. That is the intent, and it belongs in the
  release note. **[re-anchored]** — RFCT-058: for **non-root** callers this
  already happened at `637295e` (RFCT-048) and belongs in *that* release note,
  not this phase's. What is left for this phase to break is narrower — root
  callers outside a per-member allowlist, and anything assuming `apid` may still
  call every member once it has its own uid.

#### Phase 3 — the read primitive and the outcome-carrying write

**Scope.** Option 3's (a) and (b) from 6.4.4: a multi-path read with per-path
errors, and an outcome-carrying settings write. Plus the cheap, independent
piece section 5.8 left open: **`apid` subscribing to `SettingsChanged`
server-side**, which needs no new crate (`zbus` is already in the tree; section
5.1.4 item 1) and which partly closes gap **row 16**.

**Why after phase 2 and not before:** (b) fixes fact 8, and 6.4.4 states that
(b) must land before any generic action shape. Phase 3 is also what makes the
15-second refresh of section 5.8 cheap enough to stop being a compromise —
one lock acquisition per render instead of 8-10 (fact 7).

**`mosd` prerequisites.** This *is* `mosd` work. Gap rows: **16** (partly
closed by the subscription), and it removes the workaround section 5.11 built
around fact 8 — including the narrow race that section documents as unclosable
from `apid`'s side (*"`record` writes no timestamp and no generation"*).

**Verification.** `mosd` unit tests in the existing `bus.rs` test module
(`mosd/mosd/src/bus.rs:257-...`): a multi-path read returning a per-path error
for one absent path while succeeding on the rest; a `SetSettings` against a
failing reconciler returning the failure in its reply rather than `Ok(())`. On
the `apid` side, a handler test that a failed apply renders in the error
register.

#### Phase 4 — the `mosd` mechanism work, in dependency order

Each sub-phase is one or more gap-table rows from section 4.1. The order is
chosen by operator demand and by which items unblock others, not by size.

| | Scope | Gap rows | Unblocks | Verified by |
|---|---|---|---|---|
| **4a** | **Observed network** — `mosd` queries `org.freedesktop.network1` for addresses, leases, gateway, DNS in use and carrier state. It already talks to that service for exactly one thing, `Manager.Reload` (`mosd/mosd/src/reconciler/network.rs:36-43`), and issues no `Get` and no link enumeration | **14** | Section 2.4 half B; the *condition* on section 3.4.1's Network nav row; the "what is my IP address?" question section 2.9 names as one of the two an operator asks first | A live-state read that returns a lease for a DHCP interface and an explicit no-lease state for one without — the distinction `mos-ui-inventory.md` section 6.3 records as currently impossible |
| **4b** | **Storage per tier** — a `statvfs` read across the four tiers of `os/rootfs/overlay-v2/etc/fstab.in:11-27` and a bus surface for it | **11** | Section 2.6 | `/srv` reports a figure at all — today it has **no reporting of any kind** (section 4.1 item 7). Cheapest item in phase 4; do it early for that reason alone |
| **4c** | **Slot state, RAUC status, and the gate's verdict** — a bus method returning slot status; `mos-health` reporting its own verdict through `ReportHealth` or a richer equivalent instead of only journalling (`os/rootfs/overlay-v2/usr/lib/mos/mos-health:17-18`) | **1, 3, 5** | Section 2.5's slot half; section 2.3 part (iii); **and section 2.10's power-page warning (row 10)**, which is a dependency rather than a new primitive | `rauc status mark-good` having run is readable over the bus. Note `grep -rci rauc mosd/mosd/src/` returns **0 across all 12 files** today, so this is new surface, not a wiring change |
| **4d** | **Boot attempt credits** — reading `BOOT_A_LEFT`/`BOOT_B_LEFT` from the redundant U-Boot environment (`os/rootfs/overlay-v2/etc/fw_env.config.in:27-29`) | **2** | The credits half of section 2.5, and the two-tile cross-read section 2.7 describes (short uptime plus falling credits = a slot failing its health gate) | **Gated on section 6.7.** A polling dashboard is a reader racing a writer ordered against nothing, and `fw_env.config.in:23-25` records that libubootenv gives no cross-process locking. **Do not start 4d until 6.7 item 4 has an answer.** It is deliberately last among the read items for this reason |
| **4e** | **Install a bundle, with progress** — an upload path, a place to put the bundle, a `rauc install` caller, and a progress surface. Today: no upload route, `Multipart` appears nowhere under `mosd/`, and no `rauc install` caller anywhere in `mosd/` | **4** | The update page of section 3.2; section 5.9's 2-second update-page refresh and its two specified degraded forms | The largest single item (section 4.1 item 4). Section 4.2 item 2's constraint is binding: mos refuses `plain`-format bundles by configuration (`os/update/rauc/system.conf.in:50-62`), and **no "install this file anyway" affordance may be added** |
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

### 8.3 Unverified / gaps for sections 7 and 8

1. **The consumer set in 7.1 is what is in *this tree*.** It was established by
   `grep -rln apid` and by reading `os/rootfs/overlay-v2/usr/lib/mos/mos-health`; a consumer that
   exists only on a deployed device, in an operator's script, or on the
   unread `sshweb` branch would not appear. 7.2 records that fact 2 makes such
   consumers possible without mos knowing.
2. **The 83-file rename count is a string count, not a semantic one.** It
   includes prose mentions in `docs/task/*` and `docs/plan/*` that are historical
   records of completed work and arguably should *not* be rewritten by a rename.
   Nobody should read 83 as a work estimate.
3. **`display.md` and `remote-management.md` were read for consumer analysis
   only.** Neither is owned by this campaign; `docs/design/access.md`,
   `provisioning.md` and `mosd.md` were not opened at all beyond the citations
   sections 1-5 already carry, and `mos-ui-inventory.md` section 9 records that
   some of those documents contradict the code.
4. **No phase was costed in time or effort.** The ordering is by dependency and
   by operator demand; there is no estimate here and none should be inferred.
5. **Phase 2's verification leans on the boot health gate**, which is the right
   test and is also the test that cannot run without hardware or a full image
   build. Nothing in this campaign built an image.
6. **The claim that phase 1 is architecture-independent rests on
   `SettingsApi`** (`mosd/apid/src/settings_api.rs:13-20`) remaining the seam.
   It is the seam today, including for the tests. A merge that dissolved the
   trait rather than re-implementing behind it would break the property — which
   is a reason to keep the trait under option 1, and is recorded here rather
   than assumed.
