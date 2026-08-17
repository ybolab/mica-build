# mos documentation

> English | [中文](README.zh.md)

- `architecture.md` — top-level system architecture and component map (start here)
- `design/` — subsystem design records
  - `access.md` — debug/maintenance access: channels, auth phases, lockdown layers
  - `boards.md` — BSP contract: artifacts, kernel assertions, new-board checklist
  - `remote-management.md` — webd vs apid, SideroLink fleet path
  - `display.md` — HDMI kiosk UI: cage+WPE rendering webd locally
  - `provisioning.md` — configuration without a network: three-layer model
- `research/` — decision-basis studies
  - `os-comparison.md` — balena/Torizon/Talos/Yocto evaluation and rejected alternatives
- `plan/` — PMA plans (numbered, with status index)
- `task/` — PMA task tracking

Rules: architecture/design/research docs are bilingual (`*.zh.md` is the
Chinese counterpart; English is authoritative on conflict, update both
together); `plan/` and `task/` are PMA process docs, English only, following
the PMA lifecycle (investigate → proposal → implement) with status markers in
`plan/index.md`.
