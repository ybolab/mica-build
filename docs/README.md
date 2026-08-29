# mos documentation

> English | [中文](zh/README.md)

- `architecture.md` — top-level system architecture and component map (start here)
- `design/` — subsystem design records
  - `access.md` — debug/maintenance access: channels, auth phases, lockdown layers
  - `boards.md` — BSP contract: artifacts, kernel assertions, new-board checklist
  - `remote-management.md` — what reaches the device today (apid on the LAN over HTTPS), the NAT/fleet channel as a requirement with no design, update control flow
  - `display.md` — HDMI kiosk UI: cage+WPE rendering `apid` locally
  - `provisioning.md` — configuration without a network: three-layer model
  - `mosd.md` — management plane design brief: D-Bus tree, settings schema, reconcilers
  - `connd.md` — connectivity concern (no `connd` process ships): WiFi STA/AP as two mosd reconcilers driving wpasupplicant/hostapd units
  - `containers.md` — integrator's guide: Quadlet units, container interconnection, dependency ordering, persistence
  - `ro-root.md` — read-only root: squashfs + dm-verity rootfs pack and boot wiring
  - `uboot-ab-handshake.md` — A/B boot-order contract between U-Boot, RAUC and the health gate
  - `dashboard.md` — dashboard proposal: landing screen, IA, technology posture, process architecture
  - `api.md` — API-first apid: current HTTP/bus surface, proposed API, static hosting, replaceable UI
  - `bsp-cx3576-sync.md` — cx3576 upstream BSP: source repo, synced commit, deviation register
  - `bus.md` — device bus v2: `com.mos.Item1` contract, class registry, actions as items, Sparkplug B evaluation
  - `release-signing.md` — production key ceremonies: TUF root, RAUC CA, bundle signing runbook
  - `build-harness.md` — how this repository's checks are run: the pinned bun container, the Rust gate's container and PATH, scratch that is not `/tmp`, arm64 build-vs-execute, and the docs gates
- `plan/` — PMA plans (numbered, with status index)
- `task/` — PMA task tracking
- `zh/` — Chinese documentation, written against the current version

Rules. `architecture.md` and `design/` are the English design record and are
authoritative; `zh/` carries the Chinese documentation and yields to the
English on conflict. Those are the documents that ship, and `docs/README.md`
is asserted against `design/` in both directions by `make docs-verify`, so a
new design page needs its row here in the same commit.

`plan/` and `task/` are PMA process tracking, not product: English only,
following the PMA lifecycle (investigate -> proposal -> implement), and a
record is deleted when it closes. They carry no index gate, because the set one
would assert is empty or nearly so.

These documents describe design and behaviour. They do not cite code by line
and do not narrate implementations statement by statement, because a document
coupled to line numbers is falsified by edits that leave its design intact.
Where a precise contract is needed, the artifact that carries it is named
instead: the HTTP surface is specified by `os/pkgs/mosd/apid/openapi.json`,
which CI holds equal to what the shipped binary prints, and the rest lives in
the code the document points at by module.
