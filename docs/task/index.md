# NAS Appliance Refactor - Task List

> Updated: 2026-09-08

## Usage

Each task is a single line linking to its detail file. All detailed information lives in `docs/task/<feature-slug>-<timestamp>.md`.

### Format

- [ ] [**add-endpoint-20260906T1430Z Add endpoint**](add-endpoint-20260906T1430Z.md) `P1`

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
free text. Nothing in this tree enforces that the record and its marker agree: the
repository has no `scripts/` directory, and the `task-state.sh` serializer
that keeps them in step ships with the PMA skill, not here, so a hand edit
can still move one without the other. They had drifted apart five times
by 2026-09-07 (RFCT-305, 310, 315, 335 and UI-011 were all marked `[x]` while
their own records said in progress or pending). Read the record, not the row.

### Priority: P0 (blocking) > P1 (high) > P2 (medium) > P3 (low)

### Rules

- New tasks append to the end.
- **New records are named `<feature-slug>-<timestamp>.md`** — a lowercase
  kebab-case slug plus the creation time in UTC at minute precision
  (`YYYYMMDDTHHmmZ`). No sequence number is allocated. Existing numbered
  `RFCT-NNN` files remain valid and are not renamed.
- See each detail file for full details.
- **A completed task's record is deleted, and its line goes with it.** This
  index is a list of what is left, not a history of what was done. A finished
  task lives in git history: `git log --diff-filter=D -- docs/task/` lists
  every record that has left, and `git show <commit>^:docs/task/RFCT-NNN.md`
  prints one back. `docs/verify-index.sh` and `docs/verify-links.sh` both
  exclude this directory, and say so in their own headers, so a deleted record
  breaks no gate.
- **The record's own `status` head is authoritative; the marker summarises it.**
  Where the two disagreed, the record won -- see the note above; five rows were
  marked `[x]` over records that said otherwise, and deleting on the marker
  alone would have destroyed work still in flight.
- **A citation to a deleted task stays as text, not as a link** --
  `RFCT-281`, not `[RFCT-281](RFCT-281.md)`. The name survives so the reason
  can be found in history; the link does not, because it would point at
  nothing.

Until 2026-09-07 this section read "Only update the checkbox marker; never
delete the line", inherited verbatim from the PMA skill's `task-format.md`.
It was removed rather than reworded, for the reason given in
`docs/plan/index.md`: completed records have been leaving this tree since
PLAN-001, and a rule the tree disobeys on sight teaches a reader the wrong
thing about the tree. Both indexes now say the same thing.

---

## Tasks

- [x] [**RFCT-947 Integrate the S905X5M branch into updated local main**](RFCT-947.md) `P1`

- [-] [**RFCT-273 Coordinate the embedded delivery roadmap**](RFCT-273.md) `P1`
- [ ] [**RFCT-290 Design conditional fleet management**](RFCT-290.md) `P2`
- [-] [**RFCT-305 Gate A mechanisms: the trust grade, the device surface and the publication refusal**](RFCT-305.md) `P1`
- [-] [**RFCT-310 The host toolchain lint and the container-only build policy**](RFCT-310.md) `P1`
- [-] [**RFCT-315 PLAN-070 F7/F8/F9: the client reads the baked anchor**](RFCT-315.md) `P1`
- [ ] [**UI-011 Stabilize Bun V8 coverage aggregation**](UI-011.md) `P1`
- [x] [**RFCT-360 PLAN-089: the boot health gate requires core function**](RFCT-360.md) `P1`
- [-] [**RFCT-335 Add a generic virtual arm64 board, bootable in QEMU**](RFCT-335.md) `P1`
- [x] [**RFCT-343 cx3576: reproducible kernel and U-Boot, and the config the contract reads**](RFCT-343.md) `P1`
- [x] [**RFCT-354 PLAN-088: cx3576 HDMI boot logo, console recoverable on demand**](RFCT-354.md) `P1`
- [x] [**RFCT-358 One path resolver inside the root, and the gpt-auto generator masked**](RFCT-358.md) `P1`
- [x] [**RFCT-356 Two gates report without checking: factory-root-gate on arm64, and the smoke build-commit assertion**](RFCT-356.md) `P1`
- [x] [**RFCT-355 Triage the first cx3576 hardware boot**](RFCT-355.md) `P1`
- [x] [**RFCT-352 boot.cmd verifies the kernel and dtb it loads**](RFCT-352.md) `P1`
- [x] [**RFCT-357 Spike: grub-arm64-efi under U-Boot EFI_LOADER on RK3576**](RFCT-357.md) `P1`
- [x] [**RFCT-353 Verify the whole flashed image, and give the mos image a flash path**](RFCT-353.md) `P1`
- [x] [**RFCT-351 cx3576 kernel BUGs in paging_init: System.map, and the build cleared**](RFCT-351.md) `P1`
- [x] [**RFCT-350 PLAN-086 S2: separate the debug and boot artefacts from the shipped root**](RFCT-350.md) `P1`
- [x] [**RFCT-349 Bound the cache fetch from outside the process, and stop the lint reading prose as a command**](RFCT-349.md) `P1`
- [x] [**RFCT-347 PLAN-080 B4/B5/B7 and the two debts RFCT-318 left**](RFCT-347.md) `P1`
- [x] [**RFCT-348 cx3576 bench test plan and its collection script**](RFCT-348.md) `P1`
- [x] [**RFCT-346 PLAN-086 S1+S4: the runtime baseline, and no static hwdb**](RFCT-346.md) `P1`
- [x] [**RFCT-345 Extract the cx3576 BSP build steps into files**](RFCT-345.md) `P1`
- [x] [**RFCT-344 Delete the completed plan and task records, and remove the rule that forbade it**](RFCT-344.md) `P1`
- [-] [**RFCT-336 Compose a minimal MOS runtime from explicit payloads**](RFCT-336.md) `P1`

- [-] [**cx3576-reproducible-bsp-20260907T1356Z Make CX3576 BSP builds reproducible and extract Dockerfile logic**](cx3576-reproducible-bsp-20260907T1356Z.md) `P1`

- [ ] [**file-ab-signed-components-20260908T1423Z Design and implement file-based A/B with independently signed components**](file-ab-signed-components-20260908T1423Z.md) `P1`
- [x] [**RFCT-910 Make the s905x5m kernel meet the shared floor**](RFCT-910.md) `P1`
- [x] [**RFCT-911 Establish whether vendor U-Boot can automatically roll back**](RFCT-911.md) `P1`
- [x] [**RFCT-912 Build the s905x5m U-Boot and assert the shared contract**](RFCT-912.md) `P1`
- [x] [**RFCT-913 Boot s905x5m from SD and establish peripheral initialization**](RFCT-913.md) `P1`
- [x] [**RFCT-914 Ship a system time source with systemd-timesyncd**](RFCT-914.md) `P1`
- [-] [**RFCT-915 Register SSH logins with logind and audit omitted recommends**](RFCT-915.md) `P1`
- [-] [**RFCT-916 Declare the shared kernel surface for container networking**](RFCT-916.md) `P1`
- [x] [**RFCT-917 Rebuild crun with systemd support**](RFCT-917.md) `P1`
- [x] [**RFCT-918 Measure PLAN-910 section-5 gaps against built U-Boot configs**](RFCT-918.md) `P1`
- [x] [**RFCT-919 Re-derive the s905x5m `SYS_BOOTM_LEN` requirement**](RFCT-919.md) `P1`
- [x] [**RFCT-920 Close PLAN-910 section-5 bootcount and redundant environment gaps**](RFCT-920.md) `P1`
- [-] [**RFCT-922 Exercise s905x5m Bluetooth pairing and a profile with a controlled peer**](RFCT-922.md) `P1`
- [-] [**RFCT-921 Make the shared rootfs cold-build reproducible**](RFCT-921.md) `P1`
- [x] [**RFCT-923 Add a board runtime smoke check for time and Podman**](RFCT-923.md) `P1`
- [x] [**RFCT-924 Classify FIT signature as a tree-wide export debt**](RFCT-924.md) `P1`
- [ ] [**RFCT-925 Decide the tree-wide FIT verified-boot design**](RFCT-925.md) `P1`
- [-] [**RFCT-926 Adopt per-board `SYS_BOOTM_LEN` derivations**](RFCT-926.md) `P1`
- [x] [**RFCT-927 Run the s905x5m U-Boot section-5 export measurement**](RFCT-927.md) `P1`
- [x] [**RFCT-928 Implement Amlogic bootloader packaging for s905x5m**](RFCT-928.md) `P1`
- [x] [**RFCT-929 Build a complete s905x5m eMMC USB-burning package**](RFCT-929.md) `P1`
- [x] [**RFCT-930 Write the s905x5m production RAUC A/B boot script**](RFCT-930.md) `P1`
- [x] [**RFCT-931 Rebuild the complete s905x5m eMMC package with boot.scr**](RFCT-931.md) `P1`
- [-] [**RFCT-932 Build and prove a reference MQTT application on s905x5m**](RFCT-932.md) `P1`
- [x] [**RFCT-933 Build a reusable s905x5m eMMC installer-card image**](RFCT-933.md) `P1`
- [-] [**RFCT-934 Prove the s905x5m A/B watchdog and rollback on hardware**](RFCT-934.md) `P1`
- [x] [**RFCT-935 Renumber branch-owned plan and task records away from upstream IDs**](RFCT-935.md) `P1`
- [x] [**RFCT-936 Separate the MQTT reference application from board userland**](RFCT-936.md) `P1`
- [x] [**RFCT-937 Investigate s905x5m Wi-Fi acceptance-evidence gap**](RFCT-937.md) `P1`
- [x] [**RFCT-938 Build a booted-board runtime acceptance suite**](RFCT-938.md) `P1`
- [x] [**RFCT-939 Integrate the BM201 front-panel userland**](RFCT-939.md) `P1`
- [ ] [**RFCT-940 The installer card blocks Linux boot on a board it already installed**](RFCT-940.md) `P1`
- [-] [**RFCT-941 The installer reinstalls on every boot because its receipt never persists**](RFCT-941.md) `P1`
- [x] [**RFCT-942 Adapt s905x5m to the current mainline build and runtime contracts**](RFCT-942.md) `P1`
- [x] [**RFCT-943 Adapt the device initialization helper to current mainline**](RFCT-943.md) `P1`
- [-] [**RFCT-944 Resolve runtime defects observed on the mainline S905X5M SD image**](RFCT-944.md) `P1`

- [-] [**RFCT-945 Verify managed Wi-Fi connectivity on the S905X5M SD system**](RFCT-945.md) `P1`
- [x] [**RFCT-946 Permit the built-in Wi-Fi client switch through the settings API**](RFCT-946.md) `P1`
