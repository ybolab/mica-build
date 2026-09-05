# NAS Appliance Refactor - Task List

> Updated: 2026-09-04

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

- [x] [**RFCT-260 The AP reconciler's third copy of the WPA byte rule, and a refusal that names the secret's length**](RFCT-260.md) `P0`
- [-] [**RFCT-273 Coordinate the embedded delivery roadmap**](RFCT-273.md) `P1`
- [x] [**RFCT-279 Publish release identity and supply-chain artifacts**](RFCT-279.md) `P0`
- [x] [**RFCT-280 Add RTC, NTP and timezone management**](RFCT-280.md) `P0`
- [x] [**RFCT-281 Add the unexpanded BusyBox emergency binary**](RFCT-281.md) `P2`
- [x] [**RFCT-282 Deliver install, onboarding and provisioning**](RFCT-282.md) `P0`
- [x] [**RFCT-283 Deliver authenticated system updates**](RFCT-283.md) `P0`
- [x] [**RFCT-284 Deliver recovery and credential access recovery**](RFCT-284.md) `P0`
- [x] [**RFCT-285 Add storage status and data lifecycle management**](RFCT-285.md) `P0`
- [x] [**RFCT-287 Document native and container application delivery**](RFCT-287.md) `P1`
- [x] [**RFCT-288 Add diagnostics and operational network state**](RFCT-288.md) `P0`
- [x] [**RFCT-289 Define security and manufacturing lifecycle**](RFCT-289.md) `P0`
- [ ] [**RFCT-290 Design conditional fleet management**](RFCT-290.md) `P2`
- [x] [**UI-001 Define the built-in UI development guide**](UI-001.md) `P1`
- [x] [**UI-002 Design the local application lifecycle module**](UI-002.md) `P1`
- [x] [**UI-003 Define the built-in UI design guide**](UI-003.md) `P1`
- [x] [**UI-004 Add localization and selectable Spectrum themes**](UI-004.md) `P1`
- [x] [**UI-005 Embed isolated UI asset trees**](UI-005.md) `P1`
- [x] [**UI-006 Move the built-in UI to `/_ui/`**](UI-006.md) `P1`
- [x] [**RFCT-291 Establish the `/mos` persistent system namespace**](RFCT-291.md) `P0`
- [x] [**UI-007 Add uploadable versioned custom UI packages**](UI-007.md) `P1`
- [x] [**RFCT-292 Adopt the direct development-stage DATA layout**](RFCT-292.md) `P0`
- [x] [**UI-008 Recreate the built-in UI from the approved prototype**](UI-008.md) `P1`
- [x] [**UI-009 Generate built-in UI assets during the build**](UI-009.md) `P1`
- [x] [**RFCT-293 Ship the `docker` command name as a podman symlink**](RFCT-293.md) `P2`
- [x] [**RFCT-294 Add eBPF, firewall and bridge symbols to the common kernel floor**](RFCT-294.md) `P1`
- [x] [**RFCT-295 Build the x64 kernel in tree, with its own config**](RFCT-295.md) `P1`
- [x] [**RFCT-296 Ship the firewall tools in the base image, with no policy**](RFCT-296.md) `P1`
- [x] [**RFCT-297 Design device state reporting to the fleet plane**](RFCT-297.md) `P1`
- [x] [**RFCT-298 Report rtnetlink enums on the observed-network surface as names**](RFCT-298.md) `P1`
- [x] [**RFCT-299 Say what /api/v1/time/status means by a synchronized clock**](RFCT-299.md) `P1`
- [x] [**RFCT-300 An unreadable time signal must not report as a read one**](RFCT-300.md) `P1`
- [x] [**RFCT-301 The meta/ seam and its enforcement (PLAN-070 F1, F1b, F2, F3, F4, F12)**](RFCT-301.md) `P1`
- [x] [**RFCT-305 Gate A mechanisms: the trust grade, the device surface and the publication refusal**](RFCT-305.md) `P1`
- [x] [**RFCT-304 The shipped iptables answers the same on both boards**](RFCT-304.md) `P1`
- [x] [**RFCT-307 The development-grade marker reaches the image**](RFCT-307.md) `P1`
- [x] [**RFCT-308 Design short-lived signer certificates**](RFCT-308.md) `P1`
- [x] [**RFCT-309 The Rust lint gate runs in a derived image, not on the host**](RFCT-309.md) `P1`
- [x] [**RFCT-311 PLAN-078 S1-S7: the short-lived signer and its refusals**](RFCT-311.md) `P1`
- [x] [**RFCT-310 The host toolchain lint and the container-only build policy**](RFCT-310.md) `P1`
- [x] [**RFCT-312 A factory-fresh device issues exactly one administrator session**](RFCT-312.md) `P1`
- [x] [**RFCT-317 PLAN-071 U1/U2/U3: the automatic update driver**](RFCT-317.md) `P1`
- [x] [**RFCT-320 The cx3576 kernel stamp, and two documents that said something false**](RFCT-320.md) `P2`
- [x] [**RFCT-316 Gate C triage: 35 partial and unimplemented claims ruled on**](RFCT-316.md) `P1`
- [x] [**RFCT-313 PLAN-070 F5/F6/F6b: the reader, the precedence, the document move**](RFCT-313.md) `P1`
- [x] [**RFCT-318 PLAN-080 B2/B3: the last producer and two judges into containers**](RFCT-318.md) `P1`
- [x] [**RFCT-319 PLAN-080 B6: the docker-and-git experiment is a gate**](RFCT-319.md) `P1`
- [x] [**RFCT-302 The snapshot schema version follows the shape it ships**](RFCT-302.md) `P1`
- [x] [**RFCT-303 Three apid tests assert on state, not on wall-clock speed**](RFCT-303.md) `P1`
- [x] [**RFCT-306 The update and fleet URLs become changeable, the anchors do not**](RFCT-306.md) `P1`
- [x] [**UI-010 Isolate built-in UI build outputs**](UI-010.md) `P1`
- [x] [**UI-011 Stabilize Bun V8 coverage aggregation**](UI-011.md) `P1`
- [x] [**UI-012 Align the built-in console with the approved prototype details**](UI-012.md) `P1`
- [x] [**UI-013 Complete the built-in console against the prototype information architecture**](UI-013.md) `P1`
- [x] [**FEAT-001 Build the update server and release console**](FEAT-001.md) `P1`
