# mos documentation

> English | [中文](README.zh.md)

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
- `research/` — decision-basis studies
  - `os-comparison.md` — balena/Torizon/Talos/Yocto evaluation and rejected alternatives
  - `init-strategy.md` — init core strategy: Plan A Talos / Plan B systemd+Rust / Plan C Rust PID1, with triggers
  - `venus-os-ui.md` — Venus OS gui-v2 reference study: what it is, how it is served, its information architecture
  - `venus-os-access.md` — Venus OS reference study: SSH/root access, remote support, firmware-update and rollback UX
  - `mos-ui-inventory.md` — what the mos management UI ships today, measured from the tree
- `plan/` — PMA plans (numbered, with status index)
- `task/` — PMA task tracking

Rules: architecture/design/research docs are bilingual (`*.zh.md` is the
Chinese counterpart; English is authoritative on conflict, update both
together); `plan/` and `task/` are PMA process docs, English only, following
the PMA lifecycle (investigate → proposal → implement) with status markers in
`plan/index.md`.

Exception, deliberate and recorded: the documents added by the dashboard
campaign (`design/dashboard.md`, `research/venus-os-ui.md`,
`research/venus-os-access.md`, `research/mos-ui-inventory.md`) ship
**English-only**, because whether the existing `*.zh.md` files are kept current
is a decision parked with the user and unresolved; if bilingual coverage is
revived these get translated then, as a deliberate act rather than a half-kept
convention (`task/RFCT-045.md`). `design/api.md` joins that same exception for
the same unresolved reason: it is the API-first follow-on to
`design/dashboard.md`, cites it and `research/mos-ui-inventory.md` throughout,
and is written by sibling tasks in one campaign against a moving crate — a
translation kept in step with that would be a second moving target, and one
kept out of step would be worse than none. There is deliberately no
`design/api.zh.md`.
