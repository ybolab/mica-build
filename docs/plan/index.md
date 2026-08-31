# NAS Appliance Refactor - Plan Index

> Updated: 2026-08-31

## Usage

Each plan is a single line linking to its detail file. All detailed information lives in `docs/plan/PLAN-NNN.md`.

### Format

- [ ] [**PLAN-001 Short plan title**](PLAN-001.md) `YYYY-MM-DD`

### Status Markers

| Marker | Meaning | Plan status heads |
|--------|---------|-------------------|
| `[ ]`  | Draft / Pending review | `draft` |
| `[-]`  | Approved / Implementing | `implementing` |
| `[x]`  | Completed | `completed` |
| `[~]`  | Rejected / Abandoned | `rejected` |

### Rules

- Only update the checkbox marker; never delete the line.
- New plans append to the end.
- See each `PLAN-NNN.md` for full details.

---

## Plans

- [x] [**PLAN-030 Consolidate mosd workspace-level test harnesses**](PLAN-030.md) `2026-08-29`
- [x] [**PLAN-031 Separate MQTT application data from system management**](PLAN-031.md) `2026-08-30`
- [x] [**PLAN-032 Decouple MQTT eligibility from D-Bus service names**](PLAN-032.md) `2026-08-30`
- [x] [**PLAN-033 Close the six defects found in the MQTT decoupling review**](PLAN-033.md) `2026-08-30`
- [x] [**PLAN-035 Build the cx3576 rootfs chain on a host without binfmt through buildkit**](PLAN-035.md) `2026-08-30`
- [-] [**PLAN-036 Compose rootfs from independently built Debian packages**](PLAN-036.md) `2026-08-30`
- [ ] [**PLAN-037 Build an embedded-first delivery documentation system**](PLAN-037.md) `2026-08-31`
- [x] [**PLAN-038 Bound, scope and queue the settings-write path**](PLAN-038.md) `2026-08-31`
- [x] [**PLAN-039 Serve a built-in SPA and put management behind `/api`**](PLAN-039.md) `2026-08-31`
