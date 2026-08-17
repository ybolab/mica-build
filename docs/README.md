# mos documentation

- `architecture.md` — top-level system architecture and component map (start here)
- `design/` — subsystem design records
  - `access.md` — debug/maintenance access: channels, auth phases, lockdown layers
  - `boards.md` — BSP contract: artifacts, kernel assertions, new-board checklist
  - `remote-management.md` — webd vs apid, SideroLink fleet path
- `research/` — decision-basis studies
  - `os-comparison.md` — balena/Torizon/Talos/Yocto evaluation and rejected alternatives
- `plan/` — PMA plans (numbered, with status index)
- `task/` — PMA task tracking

Rules: English only in repo docs; plans follow the PMA lifecycle
(investigate → proposal → implement) with status markers in `plan/index.md`.
