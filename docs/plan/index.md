# NAS Appliance Refactor - Plan Index

> Updated: 2026-09-05

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

- [ ] [**PLAN-037 Coordinate the embedded delivery roadmap**](PLAN-037.md) `2026-08-31`
- [x] [**PLAN-043 Publish release identity and supply-chain artifacts**](PLAN-043.md) `2026-09-01`
- [x] [**PLAN-044 Add RTC, NTP and timezone management**](PLAN-044.md) `2026-09-01`
- [x] [**PLAN-045 Add the unexpanded BusyBox emergency binary**](PLAN-045.md) `2026-09-01`
- [x] [**PLAN-046 Deliver install, onboarding and provisioning**](PLAN-046.md) `2026-09-01`
- [x] [**PLAN-047 Deliver authenticated system updates**](PLAN-047.md) `2026-09-01`
- [x] [**PLAN-048 Deliver recovery and credential access recovery**](PLAN-048.md) `2026-09-01`
- [x] [**PLAN-049 Add storage status and data lifecycle management**](PLAN-049.md) `2026-09-01`
- [x] [**PLAN-051 Document native and container application delivery**](PLAN-051.md) `2026-09-01`
- [x] [**PLAN-052 Add diagnostics and operational network state**](PLAN-052.md) `2026-09-01`
- [x] [**PLAN-053 Define security and manufacturing lifecycle**](PLAN-053.md) `2026-09-01`
- [ ] [**PLAN-054 Design conditional fleet management**](PLAN-054.md) `2026-09-01`
- [x] [**PLAN-055 Define the built-in UI development guide**](PLAN-055.md) `2026-09-01`
- [x] [**PLAN-056 Design a managed application catalog and lifecycle**](PLAN-056.md) `2026-09-01`
- [x] [**PLAN-057 Define the built-in UI product-design guide**](PLAN-057.md) `2026-09-01`
- [x] [**PLAN-058 Add built-in UI localization and Spectrum themes**](PLAN-058.md) `2026-09-01`
- [x] [**PLAN-059 Embed isolated UI asset trees**](PLAN-059.md) `2026-09-01`
- [x] [**PLAN-060 Move the built-in UI to `/_ui/`**](PLAN-060.md) `2026-09-01`
- [x] [**PLAN-061 Establish the `/mos` persistent system namespace**](PLAN-061.md) `2026-09-02`
- [x] [**PLAN-062 Add uploadable versioned custom UI packages**](PLAN-062.md) `2026-09-02`
- [x] [**PLAN-063 Adopt the direct development-stage DATA layout**](PLAN-063.md) `2026-09-02`
- [x] [**PLAN-064 Recreate the built-in UI from the approved prototype**](PLAN-064.md) `2026-09-02`
- [x] [**PLAN-065 Generate built-in UI assets during the build**](PLAN-065.md) `2026-09-02`
- [x] [**PLAN-066 Isolate built-in UI build outputs**](PLAN-066.md) `2026-09-02`
- [x] [**PLAN-067 Align the built-in console with the approved prototype details**](PLAN-067.md) `2026-09-02`
- [x] [**PLAN-068 Complete the built-in console against the prototype information architecture**](PLAN-068.md) `2026-09-02`
- [ ] [**PLAN-069 Design managed and untrusted application controls**](PLAN-069.md) `2026-09-03`
- [ ] [**PLAN-070 Design the meta/ seam and the /mos/config/ system-configuration namespace**](PLAN-070.md) `2026-09-03`
- [ ] [**PLAN-071 Design the update module: off/check/auto with automatic install in a window**](PLAN-071.md) `2026-09-03`
- [ ] [**PLAN-072 Design cloud registration: outbound-only, off by default**](PLAN-072.md) `2026-09-03`
- [x] [**PLAN-073 Add the eBPF, firewall and bridge kernel floor, and bring both boards to it**](PLAN-073.md) `2026-09-03`
- [x] [**PLAN-074 Build the x64 kernel in tree, with its own config**](PLAN-074.md) `2026-09-04`
- [x] [**PLAN-075 Ship the firewall tools in the base image, with no policy**](PLAN-075.md) `2026-09-03`
- [ ] [**PLAN-076 Design device state reporting to the fleet plane**](PLAN-076.md) `2026-09-03`
- [ ] [**PLAN-077 Gate A: trust is real -- the anchor, the grade and the rotation decision**](PLAN-077.md) `2026-09-04`
- [ ] [**PLAN-078 Short-lived signer certificates under the existing CA**](PLAN-078.md) `2026-09-04`
- [x] [**PLAN-080 Every build and assembly runs in a container, none on the host**](PLAN-080.md) `2026-09-04`
- [x] [**PLAN-079 Build the update server and release console**](PLAN-079.md) `2026-09-04`
- [x] [**PLAN-081 Resolve the September repository audit findings**](PLAN-081.md) `2026-09-05`
