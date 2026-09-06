# PLAN-086 Compose a minimal MOS runtime from explicit payloads

- **status**: draft
- **createdAt**: 2026-09-06 10:54
- **approvedAt**: (pending)
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
| S1: Establish the baseline and runtime roots | Capture current source/input hashes, feature selections, build inventory, actual file sizes, ELF dependencies and non-ELF consumers. Record required commands/resources for each selected component. | Reproduce both architecture selections and verify artifact identity. Account for current boot, debug and hwdb bytes without double-counting hard links. |
| S2: Separate debug and boot artifacts | Strip user-space debug/static symbol sections with target-aware tools; export matching debug files outside rootfs. Export boot files from the selected packages before runtime filtering. Make image and bundle assembly consume that same export, including cx3576. | Match debug files to shipped binaries; smoke-test executables. Assert boot/kernel/module identity, boot-slot contents and bundle consistency. Reject boot blobs and removable user-space debug sections in the packed root. Preserve module symbols needed for loading. |
| S3: Compose the explicit runtime | Add runtime lists and dependency/resource validation, preserving generated configuration and filesystem metadata. Copy only the selected tree into the scratch runtime stage. Replace path-based package-manager sweeping where selection makes it obsolete. | Add failing fixtures for a missing interpreter/library/helper, missing generated state, escaping links, broken links and lost capabilities. Pass positive offline composition and executable smoke checks for both architectures. |
| S4: Remove static hardware databases | Exclude `/usr/lib/udev/hwdb.d`, `/etc/udev/hwdb.d` and both locations of `hwdb.bin` from the runtime. Remove hwdb update machinery and query clauses without deleting unrelated actions from the same udev rule. Keep ordinary device rules, runtime udev state and module indexes. Express a demonstrated board-specific requirement as a small explicit rule rather than restoring a general hardware database. | Assert that no static hwdb ships and no active rule or unit still requires it. Verify coldplug/hotplug, network identity/naming, storage and required USB/input devices. Check that rule edits preserve permissions, symlinks, module loading and service activation. |
| S5: Reduce shell and network tools | Introduce explicit BusyBox applets; convert seeding, health and board scripts. Add apid health-check mode. Remove superseded tools, outbound SSH and unused protocol branches. Review selected PAM/NSS/crypto modules before pruning their libraries. | Write failing behavior tests first. Exercise repeated first-boot seeding, ownership/modes, interruption-sensitive storage paths, shadow reconciliation, SSH/SFTP, HTTPS failure/timeout handling and container networking. The health gate must fail, not skip, if its required probe is absent. |
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
