# NAS Appliance Refactor - Task List

> Updated: 2026-08-27

## Usage

Each task is a single line linking to its detail file. All detailed information lives in `docs/task/PREFIX-NNN.md`.

### Format

- [ ] [**PREFIX-001 Short imperative title**](PREFIX-001.md) `P1`

### Status Markers

| Marker | Meaning | Record status head |
|--------|---------|--------------------|
| `[ ]`  | Pending | `pending` |
| `[-]`  | In progress | `in progress` |
| `[x]`  | Completed | `completed` |
| `[~]`  | Closed / Won't do | `closed` |

Each record's front matter carries a status line of the shape
`- **status**: <head>` or `- **status**: <head> — <free detail>`, where
`<head>` is exactly one of the four heads above and the detail after ` — ` is
free text. `docs/verify-index.sh` enforces the pair: a record with no such
line or a non-canonical head fails, and a row whose checkbox does not match
its record's head fails naming both sides (RFCT-171).

### Priority: P0 (blocking) > P1 (high) > P2 (medium) > P3 (low)

### Rules

- Only update the checkbox marker; never delete the line.
- New tasks append to the end.
- See each `PREFIX-NNN.md` for full details.

---

## Tasks

- [~] [**RFCT-005 Port appliance feature set onto upstream v1.14.0-rc.1 base (rebase derivation)**](RFCT-005.md) `P1`
- [x] [**RFCT-007 cx3576 flashing: rockusb loader-mode descriptor + RK update.img packaging**](RFCT-007.md) `P2`
- [~] [**RFCT-008 PLAN-010 M1 - systemd rootfs prototype image for cx3576**](RFCT-008.md) `P1`
- [ ] [**RFCT-253 `access.ssh` is bus-writable and grants a remote capability, which the platform-switch rule does not cover**](RFCT-253.md) `P2`
- [ ] [**RFCT-260 The AP reconciler's third copy of the WPA byte rule, and a refusal that names the secret's length**](RFCT-260.md) `P2`
- [~] [**RFCT-257 PLAN-028 M2: the bare-continuation resolver**](RFCT-257.md) `P1`
- [~] [**RFCT-261 docs/plan/ is half-read: its index is asserted, its citations are not**](RFCT-261.md) `P2`
- [x] [**RFCT-262 PLAN-029: rebuild the documentation system on the current version**](RFCT-262.md) `P1`
- [x] [**RFCT-263 PLAN-029 Amendment 1: code stops citing records, and docs/zh covers design in full**](RFCT-263.md) `P1`
- [x] [**RFCT-264 PLAN-029 Amendment 2: the published API document describes behaviour only**](RFCT-264.md) `P1`
