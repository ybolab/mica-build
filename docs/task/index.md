# NAS Appliance Refactor - Task List

> Updated: 2026-08-30

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

- [~] [**RFCT-253 `access.ssh` is bus-writable and grants a remote capability, which the platform-switch rule does not cover**](RFCT-253.md) `P2`
- [ ] [**RFCT-260 The AP reconciler's third copy of the WPA byte rule, and a refusal that names the secret's length**](RFCT-260.md) `P2`
- [x] [**RFCT-265 Consolidate mosd workspace-level tests under the workspace**](RFCT-265.md) `P2`
- [x] [**RFCT-266 Separate MQTT application data from system management**](RFCT-266.md) `P1`
- [x] [**RFCT-267 Decouple MQTT eligibility from D-Bus service names**](RFCT-267.md) `P1`
- [x] [**RFCT-268 Close the six defects found in the MQTT decoupling review**](RFCT-268.md) `P1`
- [x] [**RFCT-269 Drop the retained-topic upgrade guidance for the removed system projection**](RFCT-269.md) `P3`
