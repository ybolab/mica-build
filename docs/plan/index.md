# NAS Appliance Refactor - Plan Index

> Updated: 2026-09-01

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
- [x] [**PLAN-036 Compose rootfs from independently built Debian packages**](PLAN-036.md) `2026-08-30`
- [ ] [**PLAN-037 Coordinate the embedded delivery roadmap**](PLAN-037.md) `2026-08-31`
- [x] [**PLAN-038 Bound, scope and queue the settings-write path**](PLAN-038.md) `2026-08-31`
- [x] [**PLAN-039 Serve a built-in SPA and put management behind `/api`**](PLAN-039.md) `2026-08-31`
- [x] [**PLAN-040 Select a retained custom UI from the built-in SPA**](PLAN-040.md) `2026-09-01`
- [x] [**PLAN-041 Per-package upstream versions, an installed manifest, and independent wifi/bluetooth producers**](PLAN-041.md) `2026-09-01`
- [ ] [**PLAN-042 Build the user documentation contract and official website content**](PLAN-042.md) `2026-09-01`
- [ ] [**PLAN-043 Publish release identity and supply-chain artifacts**](PLAN-043.md) `2026-09-01`
- [ ] [**PLAN-044 Add RTC, NTP and timezone management**](PLAN-044.md) `2026-09-01`
- [ ] [**PLAN-045 Add the unexpanded BusyBox emergency binary**](PLAN-045.md) `2026-09-01`
- [ ] [**PLAN-046 Deliver install, onboarding and provisioning**](PLAN-046.md) `2026-09-01`
- [ ] [**PLAN-047 Deliver authenticated system updates**](PLAN-047.md) `2026-09-01`
- [ ] [**PLAN-048 Deliver recovery and credential access recovery**](PLAN-048.md) `2026-09-01`
- [ ] [**PLAN-049 Add storage status and data lifecycle management**](PLAN-049.md) `2026-09-01`
- [ ] [**PLAN-050 Document BSP porting and qualify field reliability**](PLAN-050.md) `2026-09-01`
- [ ] [**PLAN-051 Document native and container application delivery**](PLAN-051.md) `2026-09-01`
- [ ] [**PLAN-052 Add diagnostics and operational network state**](PLAN-052.md) `2026-09-01`
- [ ] [**PLAN-053 Define security and manufacturing lifecycle**](PLAN-053.md) `2026-09-01`
- [ ] [**PLAN-054 Design conditional fleet management**](PLAN-054.md) `2026-09-01`
