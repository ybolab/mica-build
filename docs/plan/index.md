# MOS plans

> Updated: 2026-09-11

## Usage

Each plan is a single line linking to its detail file. All detailed information lives in `docs/plan/<timestamp>-<feature-slug>.md`.

### Format

- [ ] [**20260907-1440-add-endpoint Add endpoint**](20260907-1440-add-endpoint.md) `YYYY-MM-DD`

### Status Markers

| Marker | Meaning | Plan status heads |
|--------|---------|-------------------|
| `[ ]`  | Draft / Pending review | `draft` |
| `[-]`  | Approved / Implementing | `implementing` |
| `[x]`  | Completed | `completed` |
| `[~]`  | Rejected / Abandoned | `rejected` |

### Rules

- Update or delete plan entries and their detail files as needed; keep them
  consistent.
- Record change history and deletion reasons in `docs/changelog.md`; update
  affected task and plan references.
- New plans append to the end.
- **New records are named `<timestamp>-<feature-slug>.md`** — the creation
  time in UTC at minute precision as `YYYYMMDD-HHmm` (no `T`, no `Z`), then a
  lowercase kebab-case slug. No sequence number is allocated. Existing
  numbered `PLAN-NNN` files remain valid and are not renamed.
- See each detail file for full details.
- **A completed plan's record is deleted, and its line goes with it.** This
  index is a list of what is left, not a history of what was done. A finished
  plan lives in git history: `git log --diff-filter=D -- docs/plan/` lists
  every record that has left, and `git show <commit>^:docs/plan/PLAN-NNN.md`
  prints one back. `docs/verify-index.sh` and `docs/verify-links.sh` both
  exclude this directory, and say so in their own headers, so a deleted record
  breaks no gate.
- **The record's own `status` head is authoritative; the marker summarises it.**
  Where the two disagreed, the record won. Check both before deleting anything:
  PLAN-080 (`implementing`) and PLAN-085 (`draft`) were each marked `[x]` here,
  and deleting on the marker alone would have destroyed two live designs.
- **A citation to a deleted plan stays as text, not as a link** --
  `PLAN-049`, not `[PLAN-049](PLAN-049.md)`. The name survives so the reason
  can be found in history; the link does not, because it would point at
  nothing. This is already the house style: before this change 234 of the 239
  `PLAN-NNN` mentions in the shipped trees were bare names.

Until 2026-09-07 this section read "Only update the checkbox marker; never
delete the line". It was inherited verbatim from the PMA skill's
`plan-format.md` and had already been contradicted by five prune commits
(`ab0e650c`, `32f6a453`, `7c78a89a`, `1b31a6c0`, `3a5e52c3`); `1b31a6c0` put
the real norm plainly -- "Completed records leave the tree, as PLAN-001..029
did before them". It was removed rather than reworded because a rule the tree
disobeys on sight teaches a reader the wrong thing about the tree.

---

## Plans

- [x] [**PLAN-926 Merge the S905X5M adaptation into updated local main**](PLAN-926.md) `2026-09-08`

- [-] [**PLAN-037 Coordinate the embedded delivery roadmap**](PLAN-037.md) `2026-08-31`
- [ ] [**PLAN-054 Design conditional fleet management**](PLAN-054.md) `2026-09-01`
- [ ] [**PLAN-069 Design managed and untrusted application controls**](PLAN-069.md) `2026-09-03`
- [ ] [**PLAN-070 Design the meta/ seam and the /mos/config/ system-configuration namespace**](PLAN-070.md) `2026-09-03`
- [ ] [**PLAN-071 Design the update module: off/check/auto with automatic install in a window**](PLAN-071.md) `2026-09-03`
- [ ] [**PLAN-072 Design cloud registration: outbound-only, off by default**](PLAN-072.md) `2026-09-03`
- [ ] [**PLAN-076 Design device state reporting to the fleet plane**](PLAN-076.md) `2026-09-03`
- [ ] [**PLAN-077 Gate A: trust is real -- the anchor, the grade and the rotation decision**](PLAN-077.md) `2026-09-04`
- [x] [**PLAN-078 Short-lived signer certificates under the existing CA**](PLAN-078.md) `2026-09-04`
- [x] [**PLAN-087 Make the cx3576 BSP build reproducible**](PLAN-087.md) `2026-09-07`
- [x] [**PLAN-080 Every build and assembly runs in a container, none on the host**](PLAN-080.md) `2026-09-04`
- [x] [**PLAN-085 A generic virtual arm64 board, bootable in QEMU**](PLAN-085.md) `2026-09-06`
- [-] [**PLAN-086 Compose a minimal MOS runtime from explicit payloads**](PLAN-086.md) `2026-09-06`

- [x] [**PLAN-088 cx3576 HDMI boot logo, with the console recoverable**](PLAN-088.md) `2026-09-08`

- [-] [**20260908-1428-file-ab-signed-components File-based A/B and independently signed system components**](20260908-1428-file-ab-signed-components.md) `2026-09-08`
- [~] [**PLAN-910 s905x5m board intake (Amlogic S7D)**](PLAN-910.md) `2026-08-30`
- [x] [**PLAN-911 Close three runtime gaps found by exercising containers on hardware**](PLAN-911.md) `2026-08-31`
- [ ] [**PLAN-912 Validate s905x5m Bluetooth peer interaction**](PLAN-912.md) `2026-08-31`
- [~] [**PLAN-913 Restore shared rootfs cold-build reproducibility**](PLAN-913.md) `2026-08-31`
- [x] [**PLAN-914 Classify FIT signature as a tree-wide export debt**](PLAN-914.md) `2026-08-31`
- [~] [**PLAN-915 Adopt per-board `SYS_BOOTM_LEN` derivations**](PLAN-915.md) `2026-08-31`
- [~] [**PLAN-916 Build and prove a reference MQTT application package**](PLAN-916.md) `2026-08-31`
- [x] [**PLAN-917 Move branch-owned record IDs into a reserved range**](PLAN-917.md) `2026-09-01`
- [x] [**PLAN-918 Select the MQTT reference application as a component**](PLAN-918.md) `2026-09-01`
- [x] [**PLAN-919 Investigate s905x5m Wi-Fi acceptance-evidence gap**](PLAN-919.md) `2026-09-01`
- [x] [**PLAN-920 Build a booted-board runtime acceptance suite**](PLAN-920.md) `2026-09-01`
- [x] [**PLAN-921 Integrate the BM201 front-panel userland**](PLAN-921.md) `2026-09-01`
- [x] [**PLAN-922 Adapt s905x5m to the current mainline contracts**](PLAN-922.md) `2026-09-08`
- [x] [**PLAN-923 Adapt the local MOS initialization helper to the JSON API**](PLAN-923.md) `2026-09-08`

- [x] [**PLAN-924 Repair S905X5M front-panel package permissions**](PLAN-924.md) `2026-09-08`
- [x] [**PLAN-925 Align the Wi-Fi client switch with the settings API**](PLAN-925.md) `2026-09-08`
- [x] [**PLAN-089 The boot health gate requires core function, not the absence of every failure**](PLAN-089.md) `2026-09-08`
- [x] [**20260908-1702-pma-project-injection Wire the repository into the PMA workflow**](20260908-1702-pma-project-injection.md) `2026-09-08`

- [-] [**20260909-2331-cx3576-boot-watchdog Restore mandatory cx3576 boot watchdog availability**](20260909-2331-cx3576-boot-watchdog.md) `2026-09-09`

- [ ] [**20260910-0029-cx3576-boot-log-cleanup Repair cx3576 boot configuration and qualify the current image**](20260910-0029-cx3576-boot-log-cleanup.md) `2026-09-10`


- [x] [**20260910-0047-cx3576-hdmi-fullscreen-logo Show one centered CX3576 HDMI logo without a cursor**](20260910-0047-cx3576-hdmi-fullscreen-logo.md) `2026-09-10`

- [x] [**20260910-0159-cx3576-uboot-console Restore the standard CX3576 U-Boot console entry**](20260910-0159-cx3576-uboot-console.md) `2026-09-10`

- [ ] [**20260910-0341-minimal-boot-shutdown Minimize boot and shutdown userspace with BusyBox**](20260910-0341-minimal-boot-shutdown.md) `2026-09-10`

- [x] [**20260910-0517-writable-var-regdb Writable var with bounded DATA storage and matching regdb**](20260910-0517-writable-var-regdb.md) `2026-09-10`

- [x] [**20260910-0555-apid-spa-interaction-refactor Repair and refactor apid console interaction**](20260910-0555-apid-spa-interaction-refactor.md) `2026-09-10`

- [x] [**20260910-0559-s905x5m-current-system Integrate S905X5M with the current signed-file system**](20260910-0559-s905x5m-current-system.md) `2026-09-10`

- [x] [**20260910-0616-cx3576-storage-display-cleanup Container storage and CX3576 boot presentation**](20260910-0616-cx3576-storage-display-cleanup.md) `2026-09-10`

- [x] [**20260910-0726-unlimited-application-data Unlimited application data with bounded var**](20260910-0726-unlimited-application-data.md) `2026-09-10`

- [x] [**20260910-1012-c-config-update-obligations Classify configuration and update policy obligations**](20260910-1012-c-config-update-obligations.md) `2026-09-10`

- [x] [**20260910-1012-c-fleet-app-trust-obligations Fleet application and trust obligation classification**](20260910-1012-c-fleet-app-trust-obligations.md) `2026-09-10`

- [x] [**20260910-1013-b0-lifecycle-rootfs-audit Lifecycle and rootfs closure design**](20260910-1013-b0-lifecycle-rootfs-audit.md) `2026-09-10`

- [-] [**20260910-1013-open-plans-campaign Coordinate the open plans campaign**](20260910-1013-open-plans-campaign.md) `2026-09-10`

- [x] [**20260910-1014-a1-cx3576-resource-repairs CX3576 accelerator and resource repairs**](20260910-1014-a1-cx3576-resource-repairs.md) `2026-09-10`

- [x] [**20260910-1014-a2-cx3576-acceptance-matrix Current CX3576 acceptance matrix and evidence baseline**](20260910-1014-a2-cx3576-acceptance-matrix.md) `2026-09-10`

- [x] [**20260910-1014-a3-cx3576-late-hdmi-logo CX3576 late HDMI and return-to-logo repair**](20260910-1014-a3-cx3576-late-hdmi-logo.md) `2026-09-10`

- [x] [**20260910-1014-a4-cx3576-integrated-acceptance CX3576 integrated artifact and board acceptance**](20260910-1014-a4-cx3576-integrated-acceptance.md) `2026-09-10`

- [x] [**20260910-1038-b1-pinned-static-busybox B1 pinned static BusyBox boot package**](20260910-1038-b1-pinned-static-busybox.md) `2026-09-10`

- [x] [**20260910-1046-c-provisioning-resolution-tests Verify provisioning resolution through the API route**](20260910-1046-c-provisioning-resolution-tests.md) `2026-09-10`

- [x] [**20260910-1046-c-public-defaults-guide Update the public defaults guide**](20260910-1046-c-public-defaults-guide.md) `2026-09-10`

- [x] [**20260910-1050-c-native-endpoint-verification Verify native binaries contain no default update endpoints**](20260910-1050-c-native-endpoint-verification.md) `2026-09-10`

- [x] [**20260910-1050-c-packed-public-meta-validation Validate packed public metadata independently**](20260910-1050-c-packed-public-meta-validation.md) `2026-09-10`

- [x] [**20260910-1050-c-public-meta-source-validation Validate public metadata before root staging**](20260910-1050-c-public-meta-source-validation.md) `2026-09-10`

- [x] [**20260910-1142-b2-busybox-startup B2 explicit BusyBox startup semantics**](20260910-1142-b2-busybox-startup.md) `2026-09-10`

- [-] [**20260910-1206-b3-bounded-exitrd-teardown B3 bounded exitrd teardown**](20260910-1206-b3-bounded-exitrd-teardown.md) `2026-09-10`

- [x] [**20260910-1221-c-offline-fleet-config Project offline fleet desired configuration**](20260910-1221-c-offline-fleet-config.md) `2026-09-10`

- [x] [**20260910-1910-fleet-device-plane-protocol Fleet device-to-plane protocol**](20260910-1910-fleet-device-plane-protocol.md) `2026-09-10`

- [x] [**20260910-2100-b4-runtime-selection Select explicit runtime payloads**](20260910-2100-b4-runtime-selection.md) `2026-09-10`

- [x] [**20260910-2152-b5-scratch-provenance Wire scratch runtime composition and shipped provenance**](20260910-2152-b5-scratch-provenance.md) `2026-09-10`

- [x] [**20260911-0110-b6-reproducibility-closure B6 reproducibility closure**](20260911-0110-b6-reproducibility-closure.md) `2026-09-11`

- [-] [**20260911-0145-b7-fresh-lifecycle-acceptance B7 fresh lifecycle and rootfs acceptance**](20260911-0145-b7-fresh-lifecycle-acceptance.md) `2026-09-11`

- [-] [**20260911-1927-boot-artifact-size Shrink the signed boot artifact: compression and early-userspace closure**](20260911-1927-boot-artifact-size.md) `2026-09-11`
