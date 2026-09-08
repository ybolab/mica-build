# PLAN-086 Compose a minimal MOS runtime from explicit payloads

- **status**: approved
- **createdAt**: 2026-09-06 10:54
- **approvedAt**: 2026-09-07
- **relatedTask**: RFCT-336

## Context

The user requested a smaller system, explicitly removed backward compatibility as a requirement during development, and asked for a plan before implementation. Debian archives remain a useful binary source; neither debootstrap nor Debian's Essential package set defines the minimum MOS runtime.

The current composition installs a locked 68-package bootstrap floor, adds upstream and local packages, and then removes package managers and selected residue. The selection in `rootfs/debian/manifest.ts` always includes the `base` consumer. `rootfs/compose/10-compose.Dockerfile` already uses scratch stages, but copies the complete configured filesystem between them. `90-pack.Dockerfile` inherits that filesystem before pruning and packing it.

Read-only measurements on 2026-09-06:

| Measurement | x64 | cx3576 |
|---|---:|---:|
| Upstream / local packages installed during composition | 159 / 13 | 170 / 15 |
| `TOTAL_MB` in the current build report, in MiB | 292 | 380 |
| Regular-file payload, counting hard links once, in MiB | 281.10 | 367.35 |
| Squashfs bytes | 114,786,304 | 118,579,200 |
| Rootfs image bytes, including verity and padding | 116,391,936 | 119,537,664 |
| ELF debug and static symbol sections, approximately MiB | 39 | 43 |
| Boot inputs retained inside rootfs, approximately MiB | 14 | 52 |
| udev hardware database and source data, approximately MiB | 22 | 22 |

Evidence is in `_out/<board>/rootfs-report.txt`, `rootfs-verity.env`, and the extracted roots under `_out/verify/<board>/`. Both current rootfs images matched the corresponding verified slot prefixes. ELF measurements include a small amount of kernel-module symbol data; that data is not a user-space stripping target. These are occupied bytes, not promised compressed savings, and package Installed-Size values are not used as removal estimates.

### S1 baseline, measured 2026-09-07 (RFCT-346)

The table above is confirmed on cx3576 and superseded by this one. It is
reproduced with `bash tools/measure-rootfs.sh --board <board>`, which reads
`_out/<board>/factory-root.oci` -- the packed root the build exports, i.e. the
byte-for-byte input to mksquashfs -- and counts each inode once. Tree
`0.1.0+git4845a0b31124.dirty`, both pools at that same stamp.

| Measurement | cx3576 | virt-arm64 |
|---|---:|---:|
| Upstream / local packages shipped | 170 / 15 | 159 / 13 |
| `TOTAL_MB` in the build report | 380 | 430 |
| Regular-file payload, hard links counted once, bytes | 385,524,283 | 435,604,278 |
| The same, in MiB | 367.66 | 415.42 |
| Regular files / distinct inodes / symlinks | 3,145 / 3,145 / 786 | 4,068 / 4,068 / 739 |
| Squashfs bytes | 118,685,696 | 127,582,208 |
| Rootfs image bytes, including verity and MiB padding | 120,586,240 | 128,974,848 |
| User-space ELF debug and static symbol sections, bytes | 44,804,825 | 44,804,825 |
| Kernel-module symbol data, bytes (NOT a stripping target) | 736,766 | 10,854,802 |
| Boot inputs retained inside rootfs, bytes | 54,464,989 | 53,535,273 |
| udev hardware database and source data, bytes | 22,863,740 | 22,863,740 |
| Kernel module indexes, bytes | 333,062 | 2,476,993 |

Four findings from that measurement, each of which changes what a later slice
should expect:

- **There are no hard links in either root.** The deduplicated and naive sums
  are equal to the byte on both boards, so "counting hard links once" is a
  guard here rather than a correction, and a slice that reports a saving cannot
  attribute any part of it to link accounting.
- **The 42.73 MiB of user-space debug data is 13 files, and they are the same
  13 on both arm64 boards** -- `podman` (19,305,340 B), `netavark`, `apid`,
  `mosd`, `crun`, `mos-mqttd`, `mos-mqtt-broker`, `rauc-update` and five more,
  every one of them built by this repository. All 1,009 other user-space ELF
  files carry zero: Debian ships its binaries stripped. So S2's user-space
  target is this repository's own build outputs, not the shipped package set,
  and the identical totals on two different roots are that fact and not a
  measurement error.
- **The cx3576 column of the 2026-09-06 table reproduces within 0.1% on every
  row.** The residual differences -- payload +0.31 MiB, squashfs +104 KiB,
  image +1 MiB -- are the cx3576 kernel that landed in RFCT-343 after that
  measurement; the image row moves by a whole MiB because the pack pads to a
  MiB boundary and the squashfs crossed one.
- **The x64 column is NOT reproduced here.** `snapshot.debian.org` returned
  HTTP 503 for the whole amd64 base cache while this ran, so no x64 root could
  be composed. virt-arm64 is measured in its place; it is a UEFI board with the
  same feature selection and its package counts match the x64 column's 159/13,
  but it is a different architecture and is not a substitute for that column.
  x64 remains outstanding for S1.

Specific findings that affect the design:

- Coreutils retains about 6.5 MiB on x64, despite its roughly 18 MiB Installed-Size field. Bash retains about 1.3 MiB. BusyBox is already shipped but deliberately has no applet links.
- Podman alone contains approximately 19 MiB of debug/static symbol data on x64. Similar sections remain in the Rust services and container helpers.
- cx3576 stores kernel, DTB and U-Boot inputs under `/usr/lib/mos/board/cx3576`; x64 retains its exported kernel under `/boot`. Current cx3576 bundle assembly still reads boot inputs from `BOARD_DIR`, so the export path must be made authoritative before dropping these files from rootfs.
- `libcurl` references LDAP, while RTMP references GnuTLS. `libdb5.3` still has consumers in arpd and PAM/SASL modules. Shared libraries cannot be classified as unused from package-manager removal alone.
- `mos-health` uses curl for the local HTTPS probe. apid already depends on reqwest with rustls, so a health-check mode can reuse an existing client stack.
- The BusyBox image checks, account shell, GNU tar seeding behavior, and fixed package/copyright counts encode the current composition. Those contracts must be deliberately revised, not bypassed.

## Proposal

### 1. Separate installation inputs from shipped runtime files

Use the existing locked `.deb` cache and temporary installation environment to run maintainer scripts and generate required state. Export boot and debug artifacts separately, then copy an explicitly selected runtime into an empty destination:

```text
per-package JSON pins + cached upstream/local .deb archives
    -> offline installation and configuration in a disposable build stage
    -> boot export + debug export + runtime file selection
    -> FROM scratch: selected runtime and generated configuration only
    -> factory-root OCI + squashfs + dm-verity
```

Keep one archive lock and the existing feature/board resolver. Introduce small runtime file lists under `rootfs/runtime/`, keyed by the already selected local packages. Reuse local package ownership for their payloads and explicitly select required upstream programs and resources. Do not introduce another package manager, version lock, feature resolver, or generic bootstrap framework.

The 68-package set may remain an installation-stage requirement while dpkg and maintainer scripts need it. It must stop being a mandatory shipped runtime set. Declarations and reports will distinguish installation-only inputs from shipped content. debootstrap can remain an internal build helper; replacing it is unnecessary unless it prevents this separation.

Runtime dependency selection must include ELF interpreters, recursive shared-library dependencies, and separately declared resources that ELF metadata cannot reveal: dlopen modules, PAM/NSS configuration, systemd units and generators, D-Bus policy and activation, scripts and commands, firmware, certificate stores, and timezone data. Resolve target paths inside the staged root, including absolute symlinks, without accidentally copying host files. Preserve ownership, permissions, capabilities, hard links, and required symlink chains.

### 2. Define the minimal runtime policy

| Area | Proposed decision |
|---|---|
| Init and device management | Retain systemd, required units/generators, udev and kmod. Remove all shipped hwdb source files and compiled databases, together with unused hwdb query/update paths. Keep required udev rules, runtime device state under `/run/udev`, and module dependency/alias indexes. BusyBox supplies mdev rather than udev; replacing udev with mdev is outside this plan. |
| Networking and time | Retain networkd, resolved, timesyncd, iproute2 operations used by MOS, CA trust and supported timezone data. |
| Storage and updates | Retain repart, required mount/filesystem tools, bootloader environment tools for their actual board, RAUC and the current signing/verification mechanisms. |
| MOS applications | Keep the existing selected mosd, apid, MQTT and update capabilities. Do not claim savings by silently disabling selected services. |
| Containers and radios | Keep current feature selection. A selected Podman stack retains Quadlet, crun, network helpers and nftables; selected radios retain their daemons, firmware and board setup. |
| Shell and common utilities | Use BusyBox ash as `/bin/sh` with an explicit applet link list. Remove Bash, dash and superseded GNU tools from the minimal runtime after converting and testing MOS callers. Keep individual tools where they provide a demonstrated system requirement. |
| SSH | Preserve inbound SSH and its existing dev/prod enablement policy. Keep host-key generation, required authentication modules and SFTP support; remove outbound ssh/scp and unused client helpers. Change account shells to the selected system shell. |
| HTTP health probe | Add a bounded health-check mode to the existing apid executable, using its existing reqwest/rustls stack. Replace the curl shell invocation; remove curl and its exclusive dependency branches after auditing other runtime consumers. |
| Firewall tools | Keep nftables. Remove the iptables compatibility frontends and exclusive dependencies if the caller audit confirms MOS and its selected container stack use nftables. This changes the general-purpose tooling policy from PLAN-075. |
| Package administration | Keep package installation, account provisioning helpers used only at build time, and package databases in the build stage. Retain the resulting accounts, configuration, required runtime account tools and license material. |

This proposal supersedes PLAN-045's unexpanded emergency-only BusyBox policy. It does not add a compatibility mode or a new troubleshooting OS profile. Debug artifacts are build outputs for diagnosis, not extra files in the normal rootfs.

### 3. Execute in verifiable steps

| Step | Work | Verification required before proceeding |
|---|---|---|
| S1: Establish the baseline and runtime roots | Capture current source/input hashes, feature selections, build inventory, actual file sizes, ELF dependencies and non-ELF consumers. Record required commands/resources for each selected component. | Reproduce both architecture selections and verify artifact identity. Account for current boot, debug and hwdb bytes without double-counting hard links. **SHIPPED (RFCT-346, 2026-09-07):** `tools/measure-rootfs.sh` and the baseline table above. cx3576 and virt-arm64 measured and verified (`--verify` green on both, 419/419 and 314/314 before this task's own checks). Both architecture selections resolve -- `make os-rootfs-manifest-test`, 44/44 over 384 resolutions. **OUTSTANDING:** the x64 column; `snapshot.debian.org` was HTTP 503 for the entire amd64 base cache, so no x64 root could be composed. |
| S2: Separate debug and boot artifacts | Strip user-space debug/static symbol sections with target-aware tools; export matching debug files outside rootfs. Export boot files from the selected packages before runtime filtering. Make image and bundle assembly consume that same export, including cx3576. | Match debug files to shipped binaries; smoke-test executables. Assert boot/kernel/module identity, boot-slot contents and bundle consistency. Reject boot blobs and removable user-space debug sections in the packed root. Preserve module symbols needed for loading. **SHIPPED (RFCT-350, 2026-09-08):** `rootfs/scripts/pack-export-debug.sh` and an extended `pack-export-boot.sh`, both called from 90-pack's `pack` stage, which now installs the two cross binutils and picks one by `MOS_ARCH` -- the stage runs on the build platform, so the host `objcopy` is the wrong tool for the tree it is pointed at. Thirteen binaries stripped on each board, all thirteen this repository's own, and each debug half written to `_out/<board>/debug/.build-id/<xx>/<rest>.debug` with a manifest carrying the build-id and the sha256 of the stripped binary. Boot inputs: cx3576's four blobs out of `/usr/lib/mos/board/cx3576` and a UEFI board's `/boot/vmlinuz-<release>`, into `_out/<board>/boot/`, which `build/src/mkimage-cx3576-cli.ts` and `build/src/bundle-cli.ts` now read -- `--bundle` lost its `--bsp-out` flag, which redirected nothing any more. `/boot/config-<release>` is deliberately kept: no bootloader reads it and the kernel-config family does. `TOTAL_MB` moved from `closed` to `pack`, measured after both removals. Payload falls **99,053,385 B on cx3576** (345.79 -> 251.33 MiB) and **98,046,098 B on virt-arm64** (393.55 -> 300.05 MiB); squashfs -33.87 / -33.75 MiB, image -34 MiB on both, `TOTAL_MB` 358 -> 262 and 408 -> 314. User-space debug bytes 44,804,736 -> **0** on both; kernel-module symbol bytes unchanged (736,766 and 10,854,802), which is the "preserve module symbols" clause measured rather than asserted. Three checks in the image contract (`verify/src/checks-debug.ts`) over a self-contained ELF reader (`verify/src/elf.ts`), with 27 negative tests: cx3576 **426/426** and virt-arm64 **321/321**, exactly +3 each. `--smoke` PASS on both (11 pass, 1 executor-limited -- crun's pre-existing qemu `fexecve` limit), and both RAUC bundles built from the export. **OUTSTANDING:** x64, which no tree here can compose without a full amd64 pool; and DWARF for nine of the thirteen -- see the Annotations. |
| S3: Compose the explicit runtime | Add runtime lists and dependency/resource validation, preserving generated configuration and filesystem metadata. Copy only the selected tree into the scratch runtime stage. Replace path-based package-manager sweeping where selection makes it obsolete. | Add failing fixtures for a missing interpreter/library/helper, missing generated state, escaping links, broken links and lost capabilities. Pass positive offline composition and executable smoke checks for both architectures. |
| S4: Remove static hardware databases | Exclude `/usr/lib/udev/hwdb.d`, `/etc/udev/hwdb.d` and both locations of `hwdb.bin` from the runtime. Remove hwdb update machinery and query clauses without deleting unrelated actions from the same udev rule. Keep ordinary device rules, runtime udev state and module indexes. Express a demonstrated board-specific requirement as a small explicit rule rather than restoring a general hardware database. | Assert that no static hwdb ships and no active rule or unit still requires it. Verify coldplug/hotplug, network identity/naming, storage and required USB/input devices. Check that rule edits preserve permissions, symlinks, module loading and service activation. **SHIPPED (RFCT-346, 2026-09-07):** `rootfs/scripts/hwdb-remove.sh`, called from 90-pack's `closed` stage, removes the compiled database, 34 source files, `systemd-hwdb`, the update unit and its enablement, the `After=` naming it, and 33 query clauses plus 4 `ENV{.HAVE_HWDB_PROPERTIES}` flags across 13 rule files -- token by token, so 41/42 rule files still ship and 14 preserved actions are asserted by name. Payload falls 22,935,607 B on both boards (367.66 -> 345.79 MiB on cx3576, 415.42 -> 393.55 on virt-arm64); squashfs -3.34 MiB, image -4 MiB; `TOTAL_MB` 380 -> 358 and 430 -> 408. Four checks in the image contract (`verify/src/checks-hwdb.ts`) with 28 negative tests; cx3576 423/423 and virt-arm64 318/318, and three of the four go red on the pre-removal image. **No board-specific rule was needed:** nothing on these boards reads a hwdb property. **OUTSTANDING:** physical cx3576 acceptance. Coldplug, hotplug, naming and storage are verified on a booted virt-arm64 guest, which is a different board and a different kernel (6.12 mainline against cx3576's 6.1.115 vendor tree); PLAN-085's transfer boundary says driver and boot-chain behaviour does not carry across it. |
| S5: Reduce shell and network tools — **DECLINED 2026-09-08, see Annotations** | Introduce explicit BusyBox applets; convert seeding, health and board scripts. Add apid health-check mode. Remove superseded tools, outbound SSH and unused protocol branches. Review selected PAM/NSS/crypto modules before pruning their libraries. | Write failing behavior tests first. Exercise repeated first-boot seeding, ownership/modes, interruption-sensitive storage paths, shadow reconciliation, SSH/SFTP, HTTPS failure/timeout handling and container networking. The health gate must fail, not skip, if its required probe is absent. |
| S6: Reconcile inventories and acceptance | Generate shipped-file provenance and final size reports from the selected tree. Update affected image contracts and current build documentation. Build and test the final images with the complete selected feature set. | Pass the acceptance matrix below and compare actual uncompressed, squashfs and verity-image bytes against S1. Remove temporary experiments and obsolete code introduced by this change. |

S2 provides the first independently measurable reduction: approximately 53 MiB of x64 and 95 MiB of cx3576 uncompressed candidate content before metadata/alignment effects. Subsequent reductions depend on demonstrated runtime needs. No fixed minimal package count or compressed-size saving is promised before S1/S2 measurements.

## Acceptance

### Composition and provenance

- Both amd64 and arm64 use the existing pinned archives, checksum validation and reusable cache. Target installation/composition works with networking disabled; JSON tooling and package administration do not enter the final runtime.
- Every retained program, shared library and explicit resource has a recorded runtime consumer. Package inventory distinguishes build inputs from packages that contribute shipped files; it does not describe the pre-prune dpkg database as the final installed system.
- Preserve upstream archive identity and license attribution. Record hashes of shipped files after transformations such as stripping, and matching boot/debug outputs. Reuse the existing report/release machinery rather than creating an independent inventory system.
- Final production rootfs contains no boot-image copies, removable user-space debug sections, package databases, bootstrap archives, static hwdb sources/databases or superseded tool families. Necessary kernel modules and their indexes, licenses, device rules, configuration and generated state remain present. udev may create its normal device-state database under `/run/udev` at runtime.
- Measure both the current feature-equivalent image and the proposed minimal tooling policy. Report their deltas separately so optional-feature removal cannot disguise a regression or inflate savings. Set tighter image budgets from verified results rather than relaxing the current gates.

### Tests and running systems

- Run affected package/selection tests, install-closure and package gates, shell/host-toolchain lint, build and verifier suites. Reuse the existing Makefile/container entrypoints. The apid behavior change also requires its relevant Rust gates and health tests.
- Build both board rootfs outputs and factory OCI artifacts; run all applicable image checks and executable smoke checks against the final outputs, not an earlier build.
- Boot the final x64 image in QEMU and run every registered API E2E phase. Require all applicable assertions to pass without failures or hidden partial-suite skips. Include DNS, time, persistent state, authentication, SSH/SFTP, MQTT and a real container-network operation when selected.
- Verify install/update bundles use the same boot export as image assembly. Exercise A/B update, successful boot confirmation and rollback, including kernel/modules consistency. First boot and a second boot must preserve the intended state and permissions after the shell/tool changes.
- For cx3576, distinguish cross-build/image checks, emulated executable checks and physical hardware evidence. Validate the database-free udev configuration on the affected board devices. If hardware is unavailable, record physical acceptance as outstanding; do not silently restore the full hwdb or label an emulated check as board acceptance.
- Replace tests that specifically enforce superseded choices, such as GNU command identity or no BusyBox applet links, with assertions for the approved new behavior. Retain boot, integrity, account, capability and persistence protections. Fixed historical package/copyright counts become selected-content assertions.

Development/test services run in the repository's tmux/container workflow. This plan does not authorize commits, pushes or releases.

## Risks

| Risk | Handling |
|---|---|
| Debian dependencies include install-time assumptions; ELF scanning misses runtime discovery | Run maintainer scripts in the disposable installation root and declare dynamic modules/resources alongside recursive ELF dependencies. Validate the resulting system through actual service operations. |
| BusyBox differs in tar/cp/find/timeout and shell behavior | Convert callers to the chosen behavior and test observable state results, especially repeated seeding and interruption-sensitive operations. Do not keep GNU behavior solely for compatibility. |
| Removing boot files disconnects assembly from package provenance | Create one export from installed, selected package payloads and use it for both image and bundle assembly before excluding it from runtime. |
| Stripping damages modules or prevents diagnosis | Limit automatic stripping to appropriate user-space ELF sections with target-aware tools; retain required dynamic symbols and separate matching debug artifacts. Treat kernel modules separately. |
| Removing hwdb changes model descriptions or device-specific behavior | Descriptive vendor/model names are not required. Preserve needed udev rule actions and add only demonstrated board-specific properties as explicit rules. Test device behavior without restoring a general hardware database. |
| Library removal breaks PAM, DNS, TLS or future service activation | Inspect configured dlopen consumers and execute those paths. A library with no DT_NEEDED reference is only a candidate, not proof of dead content. |
| Apparent savings do not survive compression, or old inventories overstate runtime | Compare final artifacts and post-transform file inventories; report compression and feature choices explicitly. |

## Scope

Expected changes span `rootfs/debian/`, new `rootfs/runtime/` lists/selection code, `rootfs/compose/`, affected rootfs scripts and package producers, boot export/assembly in `build/src/`, user-space producer packaging for debug separation, the apid health-check entrypoint, and their tests/verifier contracts. Update existing build/package/release documentation and this task/plan as implementation progresses.

No Linux distribution or libc migration, kernel feature reduction, init-system replacement, application redesign, new package manager, compatibility adapter, general troubleshooting profile, or unrelated dependency upgrade. Preserve the existing A/B trust model and selected product capabilities. Proposed command availability and packaging changes are development-stage contract changes, with no migration layer.

## Alternatives

| Approach | Assessment |
|---|---|
| Keep the current complete bootstrap tree and extend the deletion list | Small initial diff, but leaves implicit package/runtime assumptions and repeated residue cleanup. Suitable for S2 measurements, not the final composition model. |
| Replace debootstrap with mmdebstrap `custom` or `extract` | These variants do not implicitly select Essential packages, but configuration and actual runtime dependency selection still need solving. Not required for the proposed final-tree separation. |
| Start from an existing Distroless image | Useful model for selecting runtime contents, but MOS must also supply PID 1, device management, storage, networking and updates. A direct base-image substitution does not define those requirements. |
| Move to Alpine, Buildroot or a fully self-built userspace | Allows broader reductions but changes the binary/toolchain and system integration scope. Reconsider only after measuring the proposed Debian-payload runtime. |

Reference material consulted during investigation: [mmdebstrap variants](https://manpages.debian.org/trixie/mmdebstrap/mmdebstrap.1.en.html#VARIANTS), [Distroless base contents](https://github.com/GoogleContainerTools/distroless/blob/main/base/README.md), and [Debuerreotype](https://github.com/debuerreotype/debuerreotype). The proposal borrows their build/runtime separation without requiring their complete build systems.

## Annotations

- 2026-09-06: The user requested a plan for review. Implementation approval is pending.
- 2026-09-06: Backward compatibility is not a requirement unless explicitly requested. Actual boot, update, persistence and selected application behavior remain acceptance requirements.
- 2026-09-06: Following the user's clarification about a minimal BusyBox-based system, replace the initial keep-then-filter hwdb proposal with a runtime containing udev and required rules but no static hwdb. This does not remove runtime udev state or kernel-module indexes, and does not switch device management to BusyBox mdev. Implementation approval remains pending.
- 2026-09-07: Implementation approved by the user. Dispatched as two tranches
  rather than one: S1 and S4 first — S1 because every later slice states its
  result as a delta against a baseline that does not exist yet, and S4 because
  it is the slice the approval was asked about and the one whose 22 MiB is
  removed by exclusion rather than by altering a binary. S2, S3, S5 and S6
  follow once a baseline exists to measure them against; S2 in particular
  changes shipped bytes, and claiming a saving against an unmeasured tree is
  the shape this plan's own S1 exists to prevent.

- 2026-09-08: **S5 declined by the user.** Not deferred and not owed — the
  slice is out of the plan, and this is written at the row as well as here
  so a reader of the table does not have to find the note.

  What that gives up, stated so nobody re-derives it as an opportunity:
  BusyBox ships today with no applet links (measured, RFCT-346), coreutils
  retains about 6.5 MiB and bash about 1.3 MiB, and outbound SSH stays. The
  saving was the smallest of the four and the risk the least bounded — S5
  was the only slice whose own text warned to *review selected PAM/NSS/crypto
  modules before pruning their libraries*, which is the class that does not
  fail at build time or at boot but at the first authentication.

- 2026-09-08: **What S2's debug export actually resolves, measured per binary.**
  Four of the thirteen carry DWARF -- podman, crun, quadlet and catatonit, the
  Go and C artefacts -- so their `.debug` files resolve a core to a file and a
  line. The other nine carry a symbol table and no DWARF: apid (68,004
  symbols), netavark (76,448), mosd (51,238), mos-mqttd (36,743),
  mos-mqtt-broker (36,947), rauc-update (30,105), rauc-verify (28,661),
  aardvark-dns (18,034) and conmon (543). A backtrace against those
  symbolicates to function names and stops there.

  **Nothing was lost in S2 -- those nine shipped exactly that and no more
  before it, because the Rust release profile emits no debug information.** The
  slice moved 44,804,736 bytes out of the root and destroyed none of it. Naming
  it here because "export matching debug files" is easy to read as "a core is
  now fully resolvable", and for nine of the thirteen it is not; making it so
  is a change to how those crates are COMPILED (`debug = 1` plus a split), not
  to where the result is put, and it would grow the debug export rather than
  the image.

  S3 is unaffected. Part of its argument was that an explicit runtime list is
  what makes 'can this tool go' answerable rather than guessed, and S5 was the
  first consumer of that — but S3's own gate is the failing fixtures for a
  missing interpreter, library, helper, generated state, escaping link, broken
  link and lost capability, and none of those depends on anything being
  removed afterwards.
