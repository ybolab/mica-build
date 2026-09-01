# NAS Appliance Refactor - Task List

> Updated: 2026-09-02

## Usage

Each task is a single line linking to its detail file. All detailed information lives in `docs/task/PREFIX-NNN.md`.

### Format

- [ ] [**PREFIX-001 Short imperative title**](PREFIX-001.md) `P1`

### Status Markers

| Marker | Meaning | Record status head |
|--------|---------|--------------------|
| `[ ]`  | Pending | `pending` |
| `[-]`  | In progress | `in_progress` |
| `[x]`  | Completed | `completed` |
| `[~]`  | Closed / Won't do | `closed` |

Each record's front matter carries a status line of the shape
`- **status**: <head>` or `- **status**: <head> — <free detail>`, where
`<head>` is exactly one of the four heads above and the detail after ` — ` is
free text. PMA's `task-state.sh` serializer updates the record and index under
one lock and rejects a transition when their current states do not match.

### Priority: P0 (blocking) > P1 (high) > P2 (medium) > P3 (low)

### Rules

- Only update the checkbox marker; never delete the line.
- New tasks append to the end.
- See each `PREFIX-NNN.md` for full details.

---

## Tasks

- [ ] [**RFCT-260 The AP reconciler's third copy of the WPA byte rule, and a refusal that names the secret's length**](RFCT-260.md) `P0`
- [-] [**RFCT-273 Coordinate the embedded delivery roadmap**](RFCT-273.md) `P1`
- [ ] [**RFCT-278 Build the user documentation contract and official website content**](RFCT-278.md) `P0`
- [ ] [**RFCT-279 Publish release identity and supply-chain artifacts**](RFCT-279.md) `P0`
- [ ] [**RFCT-280 Add RTC, NTP and timezone management**](RFCT-280.md) `P0`
- [ ] [**RFCT-281 Add the unexpanded BusyBox emergency binary**](RFCT-281.md) `P2`
- [ ] [**RFCT-282 Deliver install, onboarding and provisioning**](RFCT-282.md) `P0`
- [ ] [**RFCT-283 Deliver authenticated system updates**](RFCT-283.md) `P0`
- [ ] [**RFCT-284 Deliver recovery and credential access recovery**](RFCT-284.md) `P0`
- [ ] [**RFCT-285 Add storage status and data lifecycle management**](RFCT-285.md) `P0`
- [ ] [**RFCT-286 Document BSP porting and qualify field reliability**](RFCT-286.md) `P0`
- [ ] [**RFCT-287 Document native and container application delivery**](RFCT-287.md) `P1`
- [ ] [**RFCT-288 Add diagnostics and operational network state**](RFCT-288.md) `P0`
- [ ] [**RFCT-289 Define security and manufacturing lifecycle**](RFCT-289.md) `P0`
- [ ] [**RFCT-290 Design conditional fleet management**](RFCT-290.md) `P2`
- [x] [**UI-001 Define the built-in UI development guide**](UI-001.md) `P1`
- [x] [**UI-002 Design the local application lifecycle module**](UI-002.md) `P1`
- [x] [**UI-003 Define the built-in UI design guide**](UI-003.md) `P1`
- [x] [**UI-004 Add localization and selectable Spectrum themes**](UI-004.md) `P1`
