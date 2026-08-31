# PLAN-037 Build an embedded-first delivery documentation system

- **status**: draft
- **createdAt**: 2026-08-31 03:08
- **approvedAt**: (pending)
- **relatedTask**: [RFCT-273](../task/RFCT-273.md)

## Context

### Goal and benchmark

mos needs a customer-facing delivery set, not another layer of implementation
notes. Fedora CoreOS is the benchmark for the shape of the user journey rather
than a component prescription. Its current documentation moves through:

1. getting started and choosing a release stream;
2. provisioning by installation platform;
3. system configuration;
4. running containers;
5. automatic updates and rollback;
6. troubleshooting and access recovery;
7. tutorials, reference, migration notes, release notes and FAQ.

The complete mos delivery surface has four audiences and therefore four
related but separate bodies of content:

- **public/product:** the official website, downloads, supported hardware,
  releases, security and support entry points;
- **operator/application integrator:** installation, configuration, workloads,
  updates, recovery and troubleshooting;
- **application developer/software publisher:** choosing a native or container
  delivery model, publishing artifacts, starting services, accessing hardware
  and platform APIs, and owning application update/rollback compatibility;
- **platform/BSP integrator:** bringing a new SoC/board from vendor inputs to a
  qualified, maintainable mos target.

The benchmark was read from the current Fedora CoreOS product page and official
documentation source on 2026-08-31, including the navigation, getting-started,
bare-metal installation, container, update-stream, auto-update and rollback
pages. CoreOS's transferable principles are:

- start at an operator goal, not the repository layout;
- publish machine-readable release/artifact metadata beside human guidance;
- make first-boot configuration a validated contract;
- treat the OS as an immutable, replaceable unit and workloads as separate;
- explain update policy, rollout, reboot and rollback as one lifecycle;
- keep recovery and troubleshooting in the primary navigation;
- state supported platforms, release changes and operational notices.

### Embedded-first correction to the benchmark

Fedora CoreOS is a generic server/container node. mos is the operating system
inside a hardware product. That changes both the system requirements and the
order in which a user encounters them:

| Concern | Generic CoreOS-style node | mos embedded appliance |
| --- | --- | --- |
| Deployment unit | Cloud/VM/bare-metal image selected mainly by platform | A product SKU tied to SoC, board revision, boot media, peripherals, enclosure and factory process |
| Provisioning | Cloud metadata or network-delivered first-boot data is normal | Factory injection, removable media, local AP/display/serial and zero-network boot are primary; cloud metadata is not assumed |
| Environment | Stable power/network and server-class storage are common assumptions | Power loss, intermittent/offline networks, bounded eMMC/flash, thermal limits and watchdog recovery are normal design inputs |
| Update policy | Continuous automatic update and reboot orchestration | Signed A/B update with bandwidth/storage budgets, offline delivery, operational interlocks, power-cut safety and an explicit field-recovery path |
| Access | SSH is a normal exploration and repair channel | Persistent shell access may be forbidden; web/local UI, status indicators, recovery keys and factory tools must carry normal service workflows |
| Hardware | Mostly standardised platform firmware and devices | Boot ROM, SPL/TF-A/U-Boot, vendor kernels, DTS, firmware, calibration and hardware-init are integrator-selected inputs governed by the mos board contract; mos supplies guidance, schemas, examples and verifiers rather than owning every vendor BSP |
| Lifecycle | Distribution release cadence drives the node | Board availability, vendor BSP/kernel support, component substitutions, security backports and field support may span many years |
| Workload | General container host | Appliance control/data services plus selected containers, with hardware I/O and product-state constraints |
| Security boundary | Platform secure boot is often externally supplied | Available boot trust, key injection and physical/debug boundaries are board/integrator specific; mos guarantees only the assurance level evidenced for that integration |

Therefore CoreOS supplies documentation patterns only. mos keeps RAUC/TUF
rather than rpm-ostree/Zincati, begins with the board and factory image rather
than a cloud matrix, persists four explicit storage tiers rather than Fedora
CoreOS's `/etc` and `/var` model, and normally disables SSH rather than making
an SSH session the quickstart destination. Long-lived embedded support,
manufacturing and field service are first-class sections, not appendices.

Reference material inspected:

- `https://fedoraproject.org/coreos/`
- `https://github.com/coreos/fedora-coreos-docs/blob/main/modules/ROOT/nav.adoc`
- `https://github.com/coreos/fedora-coreos-docs/blob/main/modules/ROOT/pages/getting-started.adoc`
- `https://github.com/coreos/fedora-coreos-docs/blob/main/modules/ROOT/pages/bare-metal.adoc`
- `https://github.com/coreos/fedora-coreos-docs/blob/main/modules/ROOT/pages/running-containers.adoc`
- `https://github.com/coreos/fedora-coreos-docs/blob/main/modules/ROOT/pages/update-streams.adoc`
- `https://github.com/coreos/fedora-coreos-docs/blob/main/modules/ROOT/pages/auto-updates.adoc`
- `https://github.com/coreos/fedora-coreos-docs/blob/main/modules/ROOT/pages/manual-rollbacks.adoc`
- `https://coreos.github.io/ignition/`
- `https://coreos.github.io/zincati/`

### Current mos documentation

`docs/README.md`, `docs/architecture.md` and the 17 records under
`docs/design/` are an unusually detailed engineering corpus. They cover boot,
storage, A/B updates, signing ceremonies, boards, access, provisioning, API,
networking, containers, dashboard, display, MQTT and the build harness. The
English records are authoritative and `docs/zh/` supplies current-state Chinese
rewrites. `make docs-verify` currently passes 51/51 checks, but it checks only
that the design directory and the two indexes agree.

The corpus is not yet a delivery manual:

- the root README and `docs/README.md` begin with components and source paths;
- most pages preserve design history, alternatives and unimplemented proposals;
- `docs/design/build.md` explains how a developer builds an image, not how a
  customer obtains, verifies, flashes and boots a released image;
- there is no quickstart, released-artifact page, installation guide, first-run
  guide, operator update guide, recovery guide, troubleshooting tree, support
  policy, release-note set, FAQ or machine-readable user-doc navigation;
- `docs/design/containers.md` is already close to an integrator guide, but it
  is embedded among design records and assumes readers understand the settings
  and persistence model;
- there is no rendered documentation site, search or version selector. This is
  a usability gap, but not a prerequisite for a correct Markdown delivery set.

The existing documentation can also disagree with the current executable
contract. For example, `docs/design/remote-management.md` says the JSON API is
read-only, while `os/pkgs/mosd/apid/openapi.json` currently declares write
routes for settings, networks, Wi-Fi networks, SSH keys, tokens, passwords,
WireGuard key rotation, reboot and poweroff. A user guide cannot take a
secondary design summary as its only evidence.

### Current capability and delivery-gap matrix

| Journey | What exists now | Delivery consequence | Class |
| --- | --- | --- | --- |
| Product and architecture | Immutable squashfs/dm-verity root, A/B RAUC, TUF publisher/verifier tooling, mosd/apid, Podman/Quadlet and two board models are documented | Good source material, but no concise product contract or support boundary | documentation |
| Public website | No website source or website content contract exists in this repository | No canonical public explanation of what mos is, who it is for, what is available, where to download, which hardware is supported, or how to obtain security/support information | product communication + documentation |
| Acquire a release | Local builds produce a whole-disk image, verity artifacts and a RAUC bundle below `_out/<board>/` | No public release identity, channel, download metadata, checksum/signature instructions, compatibility matrix or customer release notes | product + documentation |
| Install | Whole-disk x64 and cx3576 images exist; cx3576 has RockUSB recovery | No operator guide for selecting the target, preserving/wiping data, flashing, verifying, first boot or reverting a failed install | documentation, with hardware validation required |
| First boot | Empty STATE self-seeds device identity, hostname and secrets; Ethernet DHCP is present; apid has setup/login flows | The generated device credential is inert, offline provisioning channels do not exist, and there is no verified customer onboarding path documented end to end | product + documentation |
| Configure | The OpenAPI contract exposes reads and writes; mosd owns typed settings and reconcilers | Configuration facts are spread across large design records; API/design drift already exists | documentation + contract gate |
| Run workloads | Podman and Quadlet ship, off by default; a detailed container page exists | Needs a short supported path, persistence rules, registry/auth guidance, resource boundaries and an explicit statement that mos does not update application containers | mostly documentation |
| Publish OS-integrated packages | Reproducible `.deb` producers and indexed architecture-specific pools exist for rootfs composition; the final image deliberately removes `apt`, `dpkg` and their databases | System components and optional product-profile features are composed into squashfs and released only through a newly signed RAUC whole-OS image; there is no customer package repository, on-device package-install channel or independent system-extension lifecycle, and the artifact/SBOM/provenance/compatibility contract is incomplete | release engineering + documentation |
| Run custom native programs | `/usr/local/lib/systemd/system` is persistently backed by STATE and reserved for third-party units | There is no supported native application bundle, binary location, installer, signature policy, dedicated-user/capability profile, atomic update/rollback or uninstall contract; persistent units can also outlive an incompatible A/B rollback | product design + security + documentation |
| Run custom containers | Rootful Podman and Quadlet can generate systemd services from persistent definitions under STATE; boot enablement is available through Quadlet | For the default trusted-integrator model, mos can provide tested guidance for digest pinning, registry credentials, device exposure, cgroup limits and manual rollback. Image-signature enforcement, a secret store, non-bypassable admission policy and automatic rollback do not exist and become product work only if mos later manages untrusted applications | documentation + tested examples; conditional product/security work |
| Update | RAUC installs a bundle already present on the device; health gating and automatic slot fallback exist; TUF publication tools exist on the host | No device-side discovery/download/TUF client, no apid update route, no production keyring delivery, no release stream, rollout policy or maintenance window | product blocker |
| Roll back and recover | Boot-credit exhaustion automatically falls back; full-disk reflash is the physical recovery path | No supported manual rollback, rescue environment, factory reset, access-recovery procedure or non-destructive recovery tier | product blocker + documentation |
| Persist and protect data | STATE, DATA, META and EPHEMERAL have explicit semantics; DATA grows to fill media | No user backup/restore/export procedure; factory reset is not implemented; STATE and DATA are unencrypted; reflashing makes old grown-DATA blocks unreachable but does not erase them | product decision + documentation |
| Diagnose | Health and state data exist; logs live on disposable `/var`; dashboard design proposes redacted diagnostics | No support bundle, redaction policy, log-collection workflow or user troubleshooting decision tree | product + documentation |
| Manage a fleet | LAN HTTPS management exists | No device-initiated NAT traversal, enrollment/revocation, fleet plane or shared update targeting design | product, conditional on market scope |
| Trust the delivered system | RAUC CMS and TUF use separate hierarchies; the root is read-only and dm-verity verifies its blocks after the kernel activates the declared mapping | No production RAUC keyring reaches devices; many integrator-selected bootloaders may be binary-only or unable to verify later boot artifacts. Update authenticity is a product blocker, while end-to-end verified boot is a per-board best-effort capability that must be reported by assurance level rather than required universally | product update blocker + board capability + documentation |
| Port hardware and boards | `docs/design/boards.md` defines `board.env`, the BSP artifact boundary, kernel/U-Boot requirements and a short intake checklist; `bsp-cx3576-sync.md` records cx3576 provenance | No blank-board-to-supported-board manual, `board.env` field reference, SoC/BSP intake rubric, peripheral acceptance matrix, factory identity/key workflow, hardware-in-the-loop test record, board-revision policy or ongoing BSP/security maintenance procedure | platform documentation + productisation |
| Operate in the field | Storage tiers, A/B boot credits, status LEDs and some hardware-init behavior exist | No declared operating envelope for boot time, flash/log budgets, intermittent network, thermal/watchdog behavior, power-loss tolerance, offline servicing, replacement/RMA or operational reboot inhibition | embedded product design + qualification |
| Understand support | Board contract and source pins exist | No release lifecycle, supported-version window, compatibility promise, security advisory path, end-of-life policy or breaking-change notice mechanism | product policy + documentation |
| Keep docs true | Design index parity and generated OpenAPI equality are checked | No link check, command/example test, user-navigation parity, capability-status check, version scope or translation coverage gate | documentation infrastructure |

### Production embedded-appliance maturity audit

The comparison target is a production embedded-appliance OS that can be
manufactured, operated, updated, diagnosed, recovered and supported for its
declared lifetime. It is not a desktop distribution checklist: RAID, LVM,
arbitrary repartitioning, suspend or hard real-time are requirements only when a
product profile needs them. The following gaps remain after crediting the
strong immutable-root, A/B, typed-management and board-build foundations:

| Domain | Current foundation | Missing production contract | Priority |
| --- | --- | --- | --- |
| Boot and OS update | Read-only squashfs/dm-verity, RAUC A/B, boot-attempt fallback and host-side TUF/CMS tooling | Production update trust-anchor provisioning, device-side discovery/download, resumable and offline delivery, update-space budgeting, safe-to-reboot interlock, migration barriers and supported manual rollback. Boot-artifact verification is added where the selected board/bootloader exposes it and otherwise documented as unavailable | P0 for authenticated system update; best effort per board for verified boot |
| Storage lifecycle | Fixed per-board GPT, separate ROOTFS/BOOT/META/STATE/EPHEMERAL/DATA tiers, DATA first-boot growth, ext4 boot checks and periodic TRIM | Current capacity/status API, DATA low-space prevention, eMMC/NVMe/SATA health and lifetime telemetry, filesystem-error reporting/repair, application quotas, backup/restore, factory reset, secure erase, encryption/key recovery, removable-media policy and board-replacement migration | P0 for capacity/failure visibility and recovery decisions; P1 for the full lifecycle |
| Power, thermal and watchdog | cx3576 kernel enables Rockchip thermal and hardware-watchdog drivers; A/B boot credits handle failed boots | PID 1 runtime-watchdog ownership, service liveness policy, watchdog reset-cause reporting, temperature/throttling/fan state, brown-out/safe-shutdown behavior, power-loss qualification and application-aware reboot inhibition | P0 hardware qualification and reset visibility; implementation depends on product hardware |
| Clock and time trust | `tzdata` ships and cx3576 DTS declares an AT8563/HYM8563-compatible RTC, but the current cx3576 kernel disables `CONFIG_RTC_DRV_HYM8563`; TLS primitives exist | No proven RTC device on cx3576, no installed/enabled network-time daemon, no persistent last-known-good time floor, no NTP source/configuration/status API, no offline clock recovery, no trusted-time bootstrap and no defined handling for certificate/TUF expiry or audit timestamps after clock rollback. `/etc` is read-only, so a selectable system timezone also needs an explicit persistence/application design rather than an unsupported `timedatectl set-timezone` instruction | P0 software + per-board validation before signed online update and reliable audit claims; UTC documentation alone is insufficient |
| Platform security | dm-verity, RAUC/TUF separation, per-device credentials, service sandboxing on several daemons and a compiled LSM baseline | No production RAUC keyring delivery, no data-at-rest encryption, no production debug/fuse/JTAG policy, no enforcing SELinux policy, rootful containers with permissive image policy, incomplete credential/certificate rotation and no security-response pipeline. Unsigned or opaque boot stages reduce the board's assurance level but do not block publishing an honest rootfs-integrity boundary | P0 for the declared trust and update boundary; verified boot is board-dependent |
| Provisioning and manufacturing | Self-seeding identity/secrets and board image/recovery primitives | Versioned factory input, serial/MAC/calibration/key injection and verification, zero-network operator onboarding, manufacturing result record, rework/RMA identity rules and production-line recovery tools | P0 |
| BSP and device support | Board artifact boundary, kernel assertions, cx3576/x64 definitions and build/image verification | The integrator must provide board.env, BSP artifacts/provenance, license rights, revision-specific hardware qualification, real radio/peripheral tests, regulatory evidence, component-substitution policy and lifecycle ownership. mos still lacks the templates and automated contract reporting needed to guide and distinguish those user integrations | P0 documentation/contract; hardware evidence is owned by the party claiming board qualification |
| Networking and connectivity | Ethernet, Wi-Fi station/AP, VLAN, bridge and WireGuard configuration | Observed carrier/address/lease/gateway/DNS state, WPA3/5 GHz/modern AP capabilities, verified regulatory behavior, captive/offline onboarding behavior and optional cellular/modem support if a SKU requires it | P1; hardware/SKU dependent |
| Applications and isolation | systemd, package-composed OS services, Podman/Quadlet, cgroup/seccomp/device controls and a D-Bus/MQTT application boundary | The default model trusts the product integrator: native code is composed into the signed OS and containers follow documented/tested Quadlet patterns. Platform-enforced native bundle signing, container trust/key distribution, unbypassable device/resource ceilings, a secret store and automatic application rollback are absent and are required only for a managed or untrusted-application promise | P0 documentation/examples if customers deploy applications; conditional product work for managed applications |
| Observability and field service | Reconciler live state, one boot-time `/var` reading, health gate, API and volatile logs | Persistent bounded event history or export policy, current per-tier storage/thermal/watchdog/network state, reset reason, redacted support bundle, offline collection, alert thresholds and a troubleshooting/remediation tree | P0 for pilot serviceability |
| Recovery and data safety | Automatic bad-slot fallback and whole-disk RockUSB reflash | Non-destructive rescue, explicit slot selection, all-slots-failed behavior, credential recovery, backup/restore, factory reset, secure wipe and a board/storage replacement procedure that preserves or intentionally destroys identity/calibration/data | P0 |
| Release and supply chain | Pinned builders/sources, reproducible package and image work, signed bundle tooling | Customer release manifest/channel, end-to-end SBOM, license/source-offer output, vulnerability scanning and triage, release provenance/attestation, security advisories, support window and EOL policy | P0 for a customer release |
| Fleet operations | Authenticated LAN API | Enrollment/revocation, device-initiated NAT-safe channel, inventory, policy targeting, staged rollout, fleet observability and remote support audit | Conditional: P0 only if remote/fleet operation is sold |
| Product-specific controls | Linux drivers and systemd provide building blocks | Suspend/battery management, deterministic latency/RT, functional-safety evidence, redundant storage or specialised fieldbus supervision are absent as product contracts | Conditional; decide per SKU rather than adding generic features |

#### Disk and storage management: precise current answer

mos has an automated **storage-layout foundation**, but it does not yet have an
operator-facing disk-management subsystem.

Implemented today:

- one fixed GPT layout per board from `board.env`, with A/B boot and rootfs
  partitions plus separate META, STATE, EPHEMERAL and DATA filesystems;
- read-only squashfs/dm-verity system slots and ext4 writable tiers mounted by
  stable `PARTUUID`;
- `systemd-repart` expands only DATA to the end of larger media on first boot,
  and `x-systemd.growfs` expands its ext4 filesystem online;
- writable ext4 entries request the boot-time filesystem check pass, `/var` is
  bounded and automatically aged, and `fstrim.timer` is enabled for flash;
- image and layout gates check partition geometry, mountpoints, growth rules,
  bootloader-region protection and tier persistence semantics.

Not implemented today:

- no mosd/apid inventory of disks, partitions, filesystem state or current
  used/free capacity; only `/var` usage is sampled once by the boot health gate,
  while DATA `/srv` has no reporting or low-space protection;
- no eMMC EXT_CSD lifetime/EOL, NVMe SMART or SATA SMART collection, wear/error
  trend, read-only-remount detection, filesystem-error alert or last-repair
  result;
- no application/container quota, reserved update workspace or policy preventing
  a full DATA filesystem from taking applications down;
- no supported format, repair, backup, restore, factory-reset, secure-erase,
  storage-replacement or data/schema migration workflow;
- STATE and DATA are not encrypted and there is no device-bound key, escrow or
  recovery decision;
- no removable USB/SD storage contract: supported filesystems, trust model,
  read-only default, mount location, ownership, safe eject and power-loss rules
  are all undefined;
- no arbitrary user repartitioning, LVM, RAID or storage pooling. This is
  intentional unless a product SKU requires it; exposing a generic partition
  editor would undermine the fixed A/B layout and recovery guarantees.

The recommended storage-management contract is deliberately narrow: a
read-mostly `StorageStatus` surface for the fixed tiers and physical media;
board-specific normalized health metrics; warning/critical thresholds with
hysteresis; bounded application and update space; offline repair and recovery;
and explicit backup/reset/wipe flows. Destructive partition or format actions
belong only to authenticated factory/recovery tooling, not the normal operator
API.

### Priority interpretation

CoreOS parity is not the acceptance criterion. Customer-operable mos is. The
gaps are prioritised as follows:

- **P0 — truthful pilot delivery:** release identity/artifacts; production RAUC
  trust anchor; one proven install and first-login path per board/profile the
  release claims compatible with;
  one operator-reachable update path; automatic rollback documentation; one
  documented physical recovery path; explicit data-loss and trust boundaries;
  current DATA capacity and storage-failure visibility; a clock/time-trust
  contract; watchdog/reset-cause and thermal evidence on mos-qualified hardware
  or an explicitly integrator-owned qualification record; a tested,
  documentation-led custom-container path if customer applications are part of
  the pilot; and a public website that exposes only these verified claims. Every
  board that mos itself markets as qualified also needs a dated hardware
  dossier including power-loss, storage, thermal/watchdog and offline
  field-service results. A user-integrated board instead carries an explicit
  integrator-qualified/bring-up label and the integrator owns its evidence.
- **P1 — supported operation:** versioned declarative provisioning, manual
  rollback/factory reset, backup/restore, redacted diagnostics bundle, release
  promotion policy, maintenance windows, application/package publishing and
  lifecycle guidance, and the reusable hardware/BSP porting manual. An
  independently updated signed native-application channel is conditional
  future product work, not part of the common platform. The
  release policy follows the product's board/BSP support horizon rather than
  inheriting Fedora's cadence.
- **P2 — fleet scale:** device enrollment/revocation, outbound management
  channel, staged fleet rollout/lock coordination, fleet observability and
  migrations from older product generations.

P2 becomes P0 if the initial product promise includes vendor-operated remote
support or fleet management. A protected application admission and lifecycle
channel becomes P0 only if the pilot accepts applications from an untrusted or
separately administered domain. Otherwise native customer code remains part of
the RAUC OS image and independently updated custom applications use the
documented container path. The plan does not silently make either product
decision.

### Work classification and scheduling baseline

The preceding gap tables identify the right domains, but their earlier broad
`product + documentation` labels are not sufficiently precise for staffing or
scheduling. This section is the authoritative execution split. Every follow-up
task must carry one or more of these labels and must not close a software gap by
publishing prose:

- **DOC:** content, information architecture, examples and truth/status gates
  for behavior that already exists. A DOC task may add documentation validation
  scripts, but it does not create a device capability.
- **SW:** device, build, release or management software needed before a
  capability can be called supported.
- **INT:** board/BSP integration and hardware-in-the-loop evidence. This is
  owned by mos only for `mos-qualified` hardware and by the product integrator
  for `integrator-qualified` hardware.
- **OPS:** product decisions and repeatable operational processes such as key
  ceremonies, release promotion, vulnerability response and lifecycle policy.
- **COND:** work that is not scheduled until the product promise includes fleet
  management, untrusted applications, encryption, removable media or another
  named optional domain.

Documentation work can specify a contract before software lands, but that page
must remain `proposed` or `not available`. A supported procedure needs the SW,
INT and OPS gates named in its row, not just the DOC deliverable.

| ID | Priority and class | Software exit | Documentation, operations and integration exit | Initial estimate and dependency |
| --- | --- | --- | --- | --- |
| W00 Product boundary | P0, OPS + DOC | None | Freeze pilot SKUs/boards, qualification owner, release/update/support promise, application trust model, offline requirement and whether fleet operation is sold | 0.5-1 engineer-week; first dependency for all public claims |
| W01 Documentation contract and capability register | P0, DOC | Only small link/metadata/parity gates | English/Chinese navigation, support-state vocabulary, known-limitations register, command verification and source-of-truth rules | 1-2 engineer-weeks; after W00, parallel with all SW work |
| W02 Release identity and supply-chain output | P0, SW + OPS + DOC | Generate release manifest, checksums, compatible-board data, SBOM/provenance/license outputs and publication checks | Artifact naming, download/verification, release notes, channel/promotion, retention, advisory and EOL runbooks | 2-4 SW engineer-weeks plus 1 DOC/OPS week; W00, then feeds W05 and W14 |
| W03 Clock, RTC, NTP and timezone | P0, SW + INT + DOC | Add always-enabled `systemd-timesyncd` to the base image; deliver typed NTP-server/timezone settings, mosd reconciliation, apid/UI configuration and status, RTC and STATE-backed timesync clock behavior, and service ordering for time consumers | UTC/timezone rules, offline/degraded behavior, per-board RTC evidence and troubleshooting | 2-3 SW engineer-weeks plus 0.5-1 week per qualified board; before online TLS/TUF and reliable audit gates |
| W04 Install, first login and provisioning | P0 minimum; P1 full, SW + INT + DOC | Resolve the inert credential/onboarding gap; later add versioned declarative factory/offline input and atomic validation | Flash/wipe warnings, first-login journey, factory input schema and x64/physical-board evidence | 1-3 SW weeks plus 1 DOC/INT week for pilot; full provisioning adds 2-4 SW weeks; W00/W01 |
| W05 Authenticated update delivery | P0, SW + OPS + DOC | Production RAUC keyring injection/rotation, on-device TUF verification/download, authenticated local status/install path, space/power/reboot interlocks and manual rollback | Signing/update runbooks, maintenance/failure behavior and verified online/offline operator journeys | 4-8 SW engineer-weeks plus 1-2 DOC/OPS weeks; blocked by W02/W03 and product safe-to-reboot input |
| W06 Recovery and credential access recovery | P0 physical path; P1 non-destructive path, SW + INT + DOC | Explicit slot selection, all-slots-failed behavior, recovery entry/tooling, credential recovery and later factory reset | Consequence/preservation table, physical recovery and RMA instructions, destructive-action gates | 3-6 SW weeks plus 1-2 DOC/INT weeks; W04/W05 and board boot capability |
| W07 Storage status and data lifecycle | P0 status; P1 lifecycle, SW + INT + DOC | Fixed-tier capacity/inodes/errors, low-space control and media-health adapters; later quota, backup/restore, reset/wipe and optional encryption/removable-media mechanisms | Storage model, thresholds, recovery, data-loss, replacement and per-media qualification guidance | P0 2-4 SW weeks; P1 4-8 additional SW weeks; media validation per board; W00 |
| W08 Watchdog, thermal, reset and power-loss behavior | P0, SW + INT + DOC | PID 1 watchdog ownership, service liveness, reset-cause and thermal status; board-specific brown-out/safe-shutdown hooks where hardware allows | Operating envelope and dated boot/power/update/thermal/watchdog qualification record | 2-4 SW weeks plus 1-2 INT weeks per board; board vendor evidence required |
| W09 Custom software and containers | P0 DOC for trusted integrators; COND SW for untrusted apps | Common model needs only tested systemd/Quadlet examples and gates. Protected signing/admission, secret store, mandatory limits and automatic app rollback are separate conditional software | OS-integrated native-package guide, start/stop/log/device/resource/container-digest/manual-rollback guidance and explicit rootful boundary | 1-2 DOC/test weeks; managed/untrusted application platform is a separate 6-12+ SW-week investigation, not on the common schedule |
| W10 Hardware/BSP porting and qualification | P0 DOC contract + INT evidence | Small board-contract/report validators only; board-specific kernel, DT, U-Boot and hwinit changes are integration work, not one generic mos feature | Porting manual, `board.env` reference, binary-BSP intake, I1-I4 assurance, qualification and lifecycle templates | 2-3 DOC/tool weeks plus board-dependent INT effort; W00/W01 |
| W11 Diagnostics and field service | P0, SW + DOC | Redacted, bounded, offline support bundle and current storage/network/time/thermal/watchdog/reset state | Collection, redaction, export, escalation and troubleshooting decision tree | 2-4 SW weeks plus 1 DOC week; consumes W03/W07/W08 state surfaces |
| W12 Network operational state | P1, SW + INT + DOC | Carrier/address/lease/route/DNS state and SKU-specific modem support only when required | Ethernet/Wi-Fi/AP/regulatory/offline troubleshooting and per-radio evidence | 2-4 SW weeks plus board/radio INT; basic configuration docs can start under W01 |
| W13 Security and manufacturing lifecycle | P0 boundary, SW + OPS + INT + DOC | Device key/certificate rotation, factory identity injection/verification and optional board boot verification/debug lockdown | Threat/physical-access boundary, key ceremonies, security response, factory/RMA and per-board I1-I4 evidence | 2-6 SW/OPS weeks plus board-dependent INT; production private material remains outside the repository |
| W14 Website content and publication | P0 DOC; deployment separate | No product software; renderer/hosting is a separate implementation plan | Bilingual product, download, hardware, security, lifecycle, support and known-limitations copy generated or checked against W01/W02 | 1-2 DOC weeks after W00; public release waits for W02 and verified claims |
| W15 Fleet management | COND, SW + OPS + DOC | Enrollment/revocation, outbound channel, targeting, staged rollout, observability and remote-support audit | Fleet administrator and incident procedures | 8-16+ SW weeks after a separate product decision; excluded from the pilot baseline |
| W16 BusyBox emergency utility | P1, SW + DOC | Install the normal dynamically linked Debian `busybox` binary in the base rootfs as `/usr/bin/busybox`, with no generated applet links, no global PATH change and no implicit initramfs role | Document explicit `busybox APPLET` use and transient `/run/mos-toolbox` links for authenticated field service; record package/version/license/SBOM data | 0.5-1 SW/DOC week including amd64/arm64 image and smoke gates; may run with other base-image work |

The estimates are engineering-capacity ranges, not promises. They exclude
vendor response time, certification, production-line changes and unavailable
hardware. Work may run in parallel only when its dependency column is clear.

#### Clock, NTP, RTC and timezone contract

Time is a real software work package, not documentation-only work. Current
build evidence shows `tzdata` but no `systemd-timesyncd` or `chrony` in the
packed Debian image. The cx3576 device tree declares the board RTC while the
matching kernel driver is disabled, `/etc/adjtime` is not writable or managed,
and no service persists a last-known-good wall-clock floor. The proposed W03
design must decide and test:

1. keep the kernel, RTC and all machine APIs/logs in UTC; publish timestamps as
   RFC 3339 UTC and treat the operator timezone as presentation/scheduling
   metadata, never as a source of time trust;
2. enable and verify the correct RTC driver per board, validate battery-backed
   retention, reject/report implausible RTC values and write the RTC only after
   an accepted synchronization event;
3. install, enable and keep Debian's `systemd-timesyncd` running as an
   unconditional base service. It has no product setting that stops or disables
   it: without connectivity or a reachable source it remains available,
   reports synchronizing/degraded state and retries when conditions change. The
   approved common requirement is an NTP client with operator-selected sources,
   and systemd/networkd are already the image's init and network stack. `chrony`
   remains a later design choice only if the product adds NTS, stronger
   intermittent-network holdover/source selection, PTP or another requirement
   timesyncd does not meet;
4. persist timesyncd's clock state under STATE instead of the EPHEMERAL `/var`
   tier so loss of network or a dead RTC does not silently reset the device to
   an earlier epoch. This last-accepted floor limits rollback but is not proof
   that unauthenticated NTP is honest;
5. expose `unset`, `rtc`, `persisted-floor`, `network-synchronizing`,
   `network-synchronized` and `error/degraded` state, source and last-success
   information through the local status surface and diagnostics;
6. define whether a large forward/backward correction steps or slews the clock,
   and record a bounded event without assuming existing wall-clock timestamps
   were trustworthy;
7. gate or explicitly degrade TLS, TUF-expiry checks, release download, audit
   timestamps and scheduled maintenance until the clock satisfies their stated
   requirement. Network synchronization is operational accuracy; it is not
   called cryptographically trusted unless NTS or an equivalent authenticated
   source is actually deployed;
8. support offline boards through RTC plus the persisted floor and an
   authenticated/manual factory time-set path with audit provenance;
9. default the product to UTC and add a validated IANA timezone setting for the
   built-in UI and local scheduling. Kernel/system time, RTC, API timestamps and
   stored events remain UTC; changing the timezone changes representation, not
   the clock. Documentation must not suggest that the currently unsupported
   `timedatectl set-timezone` write will survive; containers remain UTC unless
   the integrator deliberately supplies timezone data/configuration.

The settings and management contract for W03 is now fixed at proposal level:

- bump the persistent settings schema from v8 and add `time.ntp.servers` and
  `time.timezone`, with an explicit up/down migration. There is deliberately no
  `time.ntp.enabled` switch;
- accept a bounded list of NTP hostnames or IP addresses, never shell fragments,
  URLs or arbitrary timesyncd configuration. Product-profile defaults and
  DHCP-provided sources are separate, documented precedence inputs; no
  undeclared upstream public server is silently inherited;
- pin the base timesync policy explicitly instead of inheriting defaults that
  may move with a future systemd update: `PollIntervalMinSec=32s`,
  `PollIntervalMaxSec=2048s` (34 minutes 8 seconds),
  `ConnectionRetrySec=30s` and `SaveIntervalSec=60s`. Polling is adaptive, not a
  fixed 32-second request loop: it starts at the minimum and grows toward the
  maximum when synchronization is stable. Connection failure retries from the
  30-second floor, while the 60-second save interval maintains the STATE-backed
  clock floor when no recent NTP synchronization occurred;
- do not expose these timing controls in the normal UI/API. They are a tested
  platform policy sized for fleet load, oscillator drift and flash writes;
  operators edit only the NTP source list and display timezone. A SKU that needs
  different accuracy or network behavior changes its product-profile policy and
  repeats the time/power/network qualification rather than applying an
  arbitrary per-device value;
- add a `TimeReconciler` to mosd. It renders a mos-owned drop-in under `/run`
  from the typed settings, restarts/reloads the owned time service only when its
  source configuration changes, and publishes applied/degraded live state. It
  never stops or disables timesyncd and does not edit the read-only root;
- add an authenticated typed apid time resource rather than widening the generic
  settings route indiscriminately. The built-in server-rendered UI provides the
  NTP source list and IANA timezone controls, with no pause/disable toggle, and
  displays current UTC, local display time, synchronization/source status and
  the last successful synchronization or a bounded error;
- keep UI timezone conversion and future maintenance-window interpretation
  consistent with the stored IANA zone. An invalid or removed zone is rejected,
  and an A/B rollback to software that does not understand the new settings
  follows the normal settings-schema rollback rule rather than leaving a
  half-applied `/etc/localtime` change;
- verify package presence, unit enablement, STATE persistence, drop-in ownership,
  settings migration, render escaping, service calls, API/OpenAPI/UI behavior,
  reboot persistence and x64/cx3576 clock behavior in the relevant gates.

W03 acceptance includes cold boot with valid, missing, dead and far-wrong RTC;
network available/unavailable; NTP server failure; forward/backward correction;
power cycle after synchronization; timezone persistence; and certificate/TUF
behavior on both sides of the minimum accepted time. Each board dossier records
whether an RTC exists and whether retention was physically verified.

#### BusyBox and command-surface decision

Include BusyBox in the production base as one preinstalled emergency binary, without
expanding its applets into command links. Do not add a target `/build/bin`
directory or a fallback directory to the global PATH. There is no such path
contract today: build harness tools live under `/tools/bin`, while `/build`
would read as a temporary build-stage location on a shipped appliance. The
packed image continues to retain GNU coreutils, and every normal runtime script
and verifier continues to resolve the same GNU commands and semantics.

Use Debian's normal dynamically linked `busybox` package, which installs
`/usr/bin/busybox`; do not choose `busybox-static` without a separate rescue
requirement. Measured against the pinned trixie base on 2026-08-31, the normal
amd64 package installs an approximately 826 KiB binary (875 KiB installed
package size), while the static package installs an approximately 2.0 MiB
binary. dm-verity already makes shared-library corruption a rootfs-integrity
failure, so the additional static copy does not improve the common online field
service path enough to justify its size. Re-check and record the current package
version for both target architectures when W16 enters implementation.

`Not expanded` is a command-resolution guarantee, not a claim that the applets
are unreachable: an authenticated operator can intentionally run any compiled
applet as `/usr/bin/busybox APPLET`. It prevents accidental dependencies and
name collisions, while retaining the requested emergency toolbox.

The rules and acceptance gates are:

- install `/usr/bin/busybox` in the base composition; create no `ash`, `sh`,
  `cp`, `sed`, `mount` or other BusyBox applet symlinks anywhere in the shipped
  rootfs, and do not change system or service PATH values;
- production services still name every command dependency explicitly. No
  normal boot, health, update, networking or management script may call BusyBox
  unless a later reviewed change declares that dependency;
- use `/usr/bin/busybox APPLET ...` directly for the normal emergency case. If
  command-name links are useful during a session, create them only in writable,
  transient `/run/mos-toolbox/` and prepend that directory to PATH in that
  shell. The read-only `/usr` tree cannot and should not be modified on-device;
- the Debian package carries initramfs integration files. W16 must prove that
  merely adding the target utility does not silently add or replace x64 initramfs
  commands; any initramfs rescue role is a separate explicit decision;
- image checks assert the single binary, absence of applet links and unchanged
  resolution/behavior of the existing GNU command set. Smoke tests exercise a
  small emergency sample only through `busybox APPLET`, on amd64 and arm64;
- include BusyBox in release inventory, SBOM, copyright/source-offer and
  vulnerability handling. Its presence is a supported field-service tool, not
  a supported API for application scripts.

#### Draft calendar baseline

The following calendar assumes two platform engineers, one documentation/QA
engineer and a board integrator available at roughly half time. With one
platform engineer, do not overlap SW rows and expect the calendar to expand by
approximately 1.7-2x. No implementation starts until this proposal is approved
and the individual SW tasks pass their own investigation/proposal gate.

| Window | Parallel tracks | Exit milestone |
| --- | --- | --- |
| 2026-09-01 to 2026-09-11 — scope and task split | W00 decisions; split W01-W16 into owned task records; detailed proposals for W02/W03/W05/W07; hardware availability and evidence intake | Approved pilot capability boundary, dependency graph, owners and measurable acceptance for the first software tranche |
| 2026-09-14 to 2026-10-09 — foundation | W01 documentation contract; W02 release identity; W03 clock/time implementation; W04 verified install/onboarding; W10 porting/qualification skeleton; W16 BusyBox binary and gates | Internal pilot documentation preview; release/time/install foundations demonstrated on x64 and queued or verified on cx3576 |
| 2026-10-12 to 2026-11-06 — operability | W05 authenticated local update slice; W07 capacity/storage-failure visibility; W11 diagnostics core; W06 recovery design/physical-path proof; W08 instrumentation | Field-pilot candidate has truthful update, time, storage status, diagnostics and recovery boundaries |
| 2026-11-09 to 2026-12-04 — qualification and delivery | W05 offline/resumable completion as approved; W06 recovery slice; W08 board evidence; W09 application docs; W10 BSP manual; W13 manufacturing/security runbooks; W14 bilingual site copy and Chinese parity | Release-candidate delivery set for the explicitly qualified boards; unsupported P1/conditional capabilities remain visible gaps |
| From 2026-12-07 — supported-operation backlog | Full provisioning, backup/restore/reset/wipe, storage lifecycle, enhanced network state, release promotion and any approved conditional capability | Scheduled only from pilot feedback and the product promise; W15 and untrusted-app enforcement remain separate programmes |

The critical path for an online-update pilot is W00 -> W02 and W03 -> W05 ->
W06/qualification -> W14. Documentation work runs alongside it but cannot move
the public milestone earlier than the software, operations and hardware evidence
gates.

## Proposal

### 1. Establish a separate user-documentation contract

Create `docs/user/` and `docs/zh/user/`. Keep `docs/design/` authoritative for
engineering rationale, but make `docs/user/` authoritative for supported user
procedures. A user page may describe only:

- **supported** behavior proven by a shipped artifact and a repeatable check;
- **preview** behavior with an explicit limitation and opt-in;
- **not available** behavior only in the capability/known-limitations pages.

Do not carry `[proposed]` mechanisms into a how-to. Each procedure records its
audience, prerequisites, supported boards/profiles, destructive effects,
expected result, recovery action, version applicability and last verification
evidence. The evidence precedence is:

1. generated/executable contracts and image tests;
2. source/configuration carrying the behavior;
3. current design records;
4. prose summaries.

If two levels disagree, the page is blocked until the discrepancy is resolved.

Keep English as the repository's authoritative contract and provide a complete
Chinese delivery set, following the existing policy. Page IDs and navigation
must match across languages even where the Chinese copy is a current-state
rewrite rather than a literal translation.

### 2. Build the user information architecture around journeys

Use this target tree. Create pages only when they have verified content; the
tree is a delivery map, not permission to add empty placeholders.

```text
docs/user/
├── index.md
├── getting-started.md
├── install/
│   ├── choose-an-image.md
│   ├── cx3576.md
│   └── x64.md
├── configure/
│   ├── first-boot.md
│   ├── network.md
│   ├── access.md
│   └── api.md
├── workloads/
│   └── containers.md
├── operate/
│   ├── updates.md
│   ├── offline-updates.md
│   ├── rollback-and-recovery.md
│   ├── storage-and-persistence.md
│   ├── storage-health-and-capacity.md
│   ├── removable-storage.md
│   ├── backup-and-reset.md
│   ├── field-service.md
│   └── diagnostics.md
├── troubleshoot/
│   ├── boot-and-install.md
│   ├── network-and-access.md
│   ├── updates.md
│   └── containers.md
├── security/
│   ├── security-model.md
│   └── update-trust.md
├── reference/
│   ├── supported-hardware.md
│   ├── release-artifacts.md
│   ├── capability-status.md
│   ├── operating-envelope.md
│   ├── persistence-matrix.md
│   ├── api.md
│   └── known-limitations.md
└── faq.md
```

The first implementation slice contains the minimum useful path:

1. `index.md` and `getting-started.md`;
2. image choice plus one install page per currently published board/profile,
   with its qualification owner and assurance level, beginning
   with power, storage, console/recovery and data-loss prerequisites;
3. first boot, local/zero-network discovery, network and access;
4. container deployment;
5. online/offline updates, rollback/recovery, field service, operating envelope
   and the persistence matrix;
6. boot/network/update troubleshooting;
7. supported hardware, release artifacts, capability status, security model,
   known limitations and FAQ.

Specialised API, backup/reset and diagnostic pages land only when their
procedures are real. Until then the capability page links to the relevant
design gap and says `not available`.

### 3. Write the official website content contract

Add `docs/site/index.md` and `docs/zh/site/index.md` as the source brief and
approved copy deck for a future official site. This is separate from choosing
or implementing the site's rendering stack. The brief defines:

- audience and positioning: embedded-appliance OS, not a general Debian distro
  and not a Kubernetes distribution;
- value proposition: read-only verity-protected root, atomic A/B updates,
  per-board BSP separation, local management API and container workloads;
- a homepage hero, short architecture explanation, supported-use-case section,
  honest feature/capability table and calls to action;
- primary navigation: `Product`, `Download`, `Hardware`, `Docs`, `Developers`,
  `Releases`, `Security`, `Support` and language switch;
- the download page's dependency on the machine-readable release manifest,
  checksums, signatures, board/profile compatibility and release notes;
- a hardware page derived from the supported-board matrix and qualification
  records, distinguishing `mos-qualified`, `integrator-qualified`, `bring-up`
  and `retired`, and naming who owns each qualification claim;
- a developer/porting entry point into the BSP manual;
- security advisory, lifecycle/EOL, support-contact, license, privacy and
  analytics-policy requirements;
- SEO/social metadata and stable URLs, without hard-coding a release number
  into manually maintained copy.

The website must consume or be checked against the same release manifest,
capability register and board-support records as the documentation. It may
claim a read-only verity-protected root and authenticated system updates only
when those statements are true for the named release. It may claim verified or
secure boot only for a named board/revision whose assurance record proves it.
Planned fleet management, automatic updates, stronger boot assurance or
recovery features may appear only in a clearly labelled roadmap, never among
shipped product claims.

The initial website deliverable under this plan is the bilingual content/IA
brief, not production HTML or hosting. A later site implementation can use the
design/prototyping workflow after domain, hosting, brand assets and analytics
policy are decided.

### 4. Add an end-to-end hardware and BSP porting track

Create `docs/porting/` and `docs/zh/porting/` for platform integrators. Preserve
`docs/design/boards.md` as the cross-board architectural contract and turn it
into a practical, verified workflow through these pages:

```text
docs/porting/
├── index.md
├── board-intake.md
├── responsibility-and-assurance.md
├── board-env-reference.md
├── bsp-artifact-contract.md
├── boot-chain-and-ab.md
├── kernel-device-tree-and-drivers.md
├── firmware-and-hwinit.md
├── image-and-package-integration.md
├── factory-provisioning.md
├── qualification.md
├── upstream-and-lifecycle.md
└── boards/
    └── cx3576.md
```

The workflow starts before code:

1. record SoC, board revision, storage geometry, boot ROM/recovery behavior,
   vendor BSP source availability/license, kernel line, bootloader origin and
   whether it is source-available or binary-only, firmware licensing,
   schematic-controlled interfaces and support ownership;
2. choose an intake tier using the kernel/support policy and refuse an
   unsupported A/B, rootfs-integrity or recovery path before creating board
   files. Closed bootloader source alone is not a refusal if the binary exposes
   the required boot/slot/recovery contract and its redistribution and lifecycle
   ownership are recorded;
3. create and lint `board.env`, with every field documented by type, unit,
   allowed range, consumer and cross-field invariant;
4. produce bootloader, kernel, modules, DTB and selected firmware only through
   the BSP artifact contract; record source commits where available, otherwise
   vendor binary version/digest/provenance, plus patches, licenses and deviations;
5. establish SPL/TF-A/U-Boot or UEFI behavior, console, boot media, recovery,
   redundant environment, A/B slot selection, dm-verity command line and RAUC
   mark-good/rollback handshake; additionally record which boot artifacts the
   selected chain can authenticate, without making source access or verified
   boot a universal prerequisite;
6. integrate the kernel config, DTS, drivers, regulatory data, firmware and
   hardware-init units without leaking board facts into common userland;
7. integrate the board package/image and prove modules/kernel, partition,
   bootloader and RAUC configuration consistency;
8. define factory flashing, unique identity/MAC/serial handling, production
   update trust-anchor injection, optional boot keys/fuses where supported,
   calibration data and recovery tooling;
9. qualify on hardware and publish a signed-off dossier naming whether mos or
   the external integrator owns the result;
10. maintain upstream sync, CVE/kernel lifecycle, board revisions, replacement
    components, deprecation and end-of-life.

`responsibility-and-assurance.md` makes the integration boundary contractual:

| Party | Owns |
| --- | --- |
| mos project | Common immutable OS and update format; read-only/verity root composition; board schema and BSP artifact interface; reference integrations; lint, image and compatibility gates; documentation templates; honest capability labels |
| Board/product integrator | Selecting and legally redistributing bootloader/kernel/DTB/firmware; implementing board.env and the A/B/recovery contract; board keys/fuses/debug policy where available; hardware, power-loss, thermal, storage, peripheral and regulatory qualification; BSP/CVE and replacement-component lifecycle |

Boot trust is reported in additive levels instead of one `secure boot` boolean:

| Level | Claim allowed | Required evidence |
| --- | --- | --- |
| **I1 — verity-protected root** | The shipped rootfs is read-only and dm-verity checks root blocks after the kernel activates the declared mapping | Built image, dm-verity mapping, read-only mount and corruption-negative test. This does **not** prove that an untrusted bootloader/kernel/cmdline supplied the intended root hash |
| **I2 — authenticated system update** | The device accepts only bundles authorised by the product update trust domain through the normal RAUC path | Production keyring provisioning, wrong-key/tampered-bundle rejection, update/rollback test and protected update policy. Raw factory/recovery flashing remains outside this claim |
| **I3 — authenticated boot artifacts** | The board's bootloader verifies the kernel/FIT, DTB and verity parameters it consumes | Named board/revision/bootloader configuration, enrolled public key and negative boot test. Source availability is useful but not required if the vendor binary exposes and documents this behavior |
| **I4 — hardware-rooted boot** | Authentication begins in immutable SoC/firmware trust and production debug/recovery policy is declared | Vendor/SoC evidence, key/fuse ceremony and negative test on production hardware |

I1 is the common mos target and I2 is required before claiming authenticated
field updates. I3 and I4 are best-effort board capabilities. A board may ship at
I1/I2 when its vendor boot chain is closed or cannot verify later artifacts,
provided the limitation and physical-attacker boundary are visible in its
dossier, release compatibility record, security page and website claim. The
documentation uses `read-only verity-protected root` for I1; it never calls an
I1/I2 board `tamper-proof`, `verified boot` or `secure boot`.

The qualification page carries a reusable matrix with `pass`, `fail`, `N/A`
and `not tested`, covering at least:

- cold/warm boot, intended boot order, serial console and physical recovery;
- eMMC/SD/NVMe/USB storage as applicable, partition growth and filesystem
  persistence;
- Ethernet, Wi-Fi station/AP, Bluetooth, USB host/device, CAN, RS-485, GPIO,
  display/touch/audio, LEDs and other declared board interfaces;
- MAC/serial/identity stability and regulatory/firmware provenance;
- temperature, thermal throttling, watchdog, RTC/time, brown-out and repeated
  power loss;
- container smoke, mosd/apid health and declared service reconciliation;
- RAUC install, mark-good, boot-credit exhaustion, automatic fallback,
  interrupted update and power-cut safety;
- factory image flashing, readback verification, recovery reflash and data-loss
  semantics;
- sustained/repeated tests appropriate to storage and product duty cycle.

A board is `mos-qualified` only when its definition and builds pass the
repository gates, mos-controlled physical qualification has no unexplained
mandatory gap, the recovery path has been exercised, and its support owner,
upstream baseline and lifecycle are recorded. A user-selected board can be
`integrator-qualified` when the same evidence is supplied and owned by that
integrator; mos validates the documented contract and labels the evidence
owner, but does not imply it performed the hardware tests. Source-only or
image-only success is `bring-up`, not qualification.

For cx3576, the first dossier must explicitly resolve or expose the current
findings already recorded in the repository: `CONFIG_FIT_SIGNATURE` is not
configured, production trust material is absent, and existing source/image
checks do not substitute for the required hardware and power-cut runs.

### 5. Define software and application delivery models

Create `docs/apps/` and `docs/zh/apps/` for application developers and software
publishers. Do not hide these procedures inside the operator container page:

```text
docs/apps/
├── index.md
├── choose-a-delivery-model.md
├── os-integrated-packages.md
├── native-applications.md
├── systemd-services.md
├── container-images.md
├── quadlet.md
├── data-config-and-secrets.md
├── hardware-access-and-permissions.md
├── dbus-mqtt-integration.md
├── publish-update-and-rollback.md
└── troubleshooting.md
```

The entry page provides a decision table and keeps three mechanisms distinct:

1. **OS-integrated package:** a trusted platform component is built as a
   reproducible architecture-specific `.deb`, composed into the immutable
   rootfs, and released, updated and rolled back with the entire RAUC OS image.
   The internal indexed package pool is a build input, not a customer apt
   repository. The device removes `apt` and `dpkg`; no supported page may tell
   a user to install a package on-device. Optional system features are selected
   as build-time image profiles/rootfs stages, not mounted later as independent
   extensions; changing one produces a new signed system image and follows the
   normal RAUC A/B update, health check and rollback path.
2. **Native application:** for the common product model, native code is an
   OS-integrated package. Its service, binary and permissions are composed into
   the read-only root and its authenticity/update/rollback follow the RAUC
   system image; the documentation shows how an integrator adds and starts it.
   The persistent third-party systemd-unit directory is an expert integration
   primitive, not a signed application channel. Independent field installation
   remains `not available`; it would require a real signed/versioned bundle,
   compatibility, atomic activation, uninstall and rollback mechanism, and is
   not scheduled unless mos later offers managed applications.
3. **Container application:** use OCI images pinned by digest plus a Quadlet
   unit persisted in STATE, with mutable application data in DATA. This is the
   preferred current delivery direction for independently changed custom
   applications. The guide covers TLS registry pulls, digest verification,
   optional integrator-configured registry/signing credentials, offline OCI
   archive digest verification, boot enablement, systemd status/logs, restart
   policy, storage, resource limits, hardware device access, network and manual
   image update/rollback. Current rootful execution, the immutable image-level
   `insecureAcceptAnything` policy, and the absence of orchestration, image
   auto-update, platform key distribution, secret storage and a Podman API must
   be disclosed.

The default application trust model is **trusted product integrator**, not an
application marketplace or multi-tenant host. Documentation, testable examples
and integration gates are sufficient where the same integrator controls the OS
image and application definitions. The boundary is:

| Concern | Common mos delivery | Technical enforcement required only for a managed/untrusted application promise |
| --- | --- | --- |
| Native authenticity | Build the native `.deb` into the OS; RAUC authenticates and rolls back the whole system image once I2 is available | Independent bundle verifier, trust/key distribution, atomic activation, compatibility admission and uninstall/rollback manager |
| Container identity and keys | Fully qualified digest, TLS registry, integrator-owned registry auth/signing configuration, offline digest check; document that current policy does not enforce signatures | Immutable or protected signature policy, key provisioning/rotation/revocation, signed-image admission and audit |
| Hardware least privilege | Tested Quadlet examples expose only named device nodes and required capabilities; integrator owns the definition and can deliberately grant more | Protected policy/allowlist, admission validation, unprivileged/rootless execution or an enforcing MAC policy, plus per-board device mediation |
| CPU/memory/PID/I/O limits | Document systemd/Quadlet cgroup controls and verify examples on kernels that advertise each controller; limits are enforced when configured | Mandatory ceilings/defaults in a protected generator or admission layer that the application definition cannot remove |
| Secrets | Document root-owned STATE/DATA files, modes, registry auth placement and rotation responsibility; mos provides no application secret store | Versioned secret API/store, encryption/key handling, access policy, injection, rotation, audit and recovery |
| Rollback | Native code rolls back with RAUC; containers pin the previous digest and use a documented manual Quadlet switch/restart procedure with data-migration warnings | Health-gated automatic rollback, atomic application generation activation and compatibility-aware data/schema rollback |

Because anyone authorised to write persistent Quadlet definitions can currently
run root-capable code, these controls protect against application mistakes only
to the extent the integrator configures them. The documentation must call them
`recommended` or `configured`, never `platform-enforced`, unless the protected
technical control in the last column exists.

The obsolete `extensions/` reservation is removed after approval. Architecture
and display design records that still describe optional layers or a kiosk
extension are corrected: kiosk and similar tightly coupled components belong to
an image profile and are serviced through the system update lifecycle.

Every published OS package or container release needs a common artifact record:
application/package ID, semantic or declared version scheme, target
architecture, compatible mos releases/API versions, compatible board/product
profiles, dependencies, license, digest, actual signature/trust status, SBOM,
build provenance, release notes, data/schema migration behavior, minimum
free-space budget and rollback constraints. A signature is recorded only when
the consuming path verifies it; otherwise the record says `digest-only` or
`not enforced`. Publication ownership, retention, revocation and
security-advisory handling must be named.

Application integration guidance also defines the supported mosd/apid, D-Bus
and MQTT boundaries. It must explain exact D-Bus package enrollment, the
current `com.mos.Item1` application surface, management-versus-application
authorization, and how board device nodes are exposed without granting broad
host privileges. A sample application is supported only when its package or
image, service definition, permissions, data path, health check, update and
rollback have all been verified on the declared board/release pair.

### 6. Define a release and artifact delivery contract before writing download instructions

Create a follow-up design/task for a release contract with these outputs:

- one immutable release identifier embedded in `/etc/os-release` and exposed by
  apid metadata;
- per-board/profile artifact names, sizes, SHA-256 digests, build provenance,
  required bootloader pairing, board-revision compatibility, download/storage
  budget and compatibility constraints;
- a machine-readable release manifest, analogous in purpose to CoreOS stream
  metadata but native to mos/RAUC/TUF;
- named release channels and a promotion policy. The number and names are a
  product decision; do not copy `stable/testing/next` by reflex;
- signed release notes: new features, fixed defects, security changes, known
  issues, migration/rollback impact and minimum supported prior release;
- retention, end-of-life, vulnerability notification and support-contact
  policies, tied to the supported board/BSP/kernel horizon rather than a
  workstation-distribution release cadence.

The user guide points to published artifacts only after the manifest and
verification instructions are generated by the release pipeline. A local
`_out/` build is not called a customer release.

### 7. Close the provisioning and onboarding contract

Retain mos's zero-input self-provisioning property, but design a versioned,
declarative operator input that plays the role Ignition plays for CoreOS
without importing Ignition's disk-mutation model blindly. The follow-up design
must decide:

- the schema, version negotiation, validation and atomic application rules;
- supported resources for the first version: hostname, wired/Wi-Fi network,
  web administrator bootstrap, SSH keys/policy, API token bootstrap and initial
  container/Quadlet payloads only if security review permits them;
- delivery channels and precedence: factory-injected BOOT data, signed USB,
  local AP/HDMI/serial wizard and LAN apid;
- secret handling, one-time display, rotation and audit behavior;
- idempotence and what happens on validation failure or partial media failure.

Before the first-boot guide is marked supported, validate one complete journey
from a factory image to authenticated apid access on x64 and physical cx3576.
The inert generated device password must either acquire a defined purpose or be
removed/migrated; documentation must not present it as a usable credential.

### 8. Turn the existing RAUC/TUF pieces into an operator update lifecycle

Create separate product plans for:

1. production RAUC trust-anchor injection/rotation, coordinated with the
   existing release-signing runbook;
2. an on-device TUF metadata verifier and bundle downloader;
3. resumable/intermittent-network download and a signed offline-media path,
   both converging on the same verification and install boundary;
4. a local authenticated check/download/install/status surface;
5. update staging budgets for the inactive slot, META and bounded temporary
   storage, with no unbounded write amplification on flash;
6. power-loss tests before, during and after metadata, bundle and slot writes;
7. an operational interlock that prevents automatic reboot while the appliance
   or its attached process is in a product-defined unsafe/busy state;
8. update policy: channel, rollout eligibility, maintenance window, reboot
   consent and failure/backoff;
9. manual rollback or a documented reason it is intentionally unavailable;
10. update barriers for settings/data migrations and minimum prior versions.

All triggers converge on mosd's existing RAUC path. The device never accepts a
payload merely because a management endpoint supplied it. The first supported
user page may document a manual authenticated local update; automatic and fleet
rollout documentation waits for the corresponding mechanisms.

### 9. Add recovery, storage/data safety and diagnostics as first-class system designs

Create focused follow-up designs rather than one broad rescue implementation:

- **Recovery:** temporary slot selection, permanent rollback, all-slots-failed
  behavior, physical recovery entry, recovery-key/status-indicator behavior,
  rescue media/environment, factory reset and an RMA/board-replacement path.
- **Storage status:** a read-only inventory of fixed tiers and their physical
  backing media, current bytes/inodes, mount/read-only/error state, normalized
  eMMC/NVMe/SATA health where the board supports it, warning thresholds and the
  reset/repair result. The status identifies facts; it does not expose generic
  repartitioning or formatting through the normal API.
- **Capacity and wear:** DATA/application/container budgets, reserved update and
  recovery workspace, low-space hysteresis and remediation, per-tier write/log
  budgets, periodic TRIM evidence, media-life thresholds and escalation before
  a device becomes read-only or unbootable.
- **Data lifecycle:** backup/export and restore boundaries for STATE and DATA,
  version/compatibility and schema-migration checks, secure erase versus
  reflash, calibration and identity handling on board/storage replacement, and
  the data-at-rest encryption, key escrow and recovery decision.
- **Removable media:** decide whether USB/SD data media are supported per SKU;
  if supported, constrain filesystems, device selection, authenticity, default
  read-only/read-write behavior, mount/ownership, safe removal and power-loss
  behavior. Recovery/update media remain a separate signed channel.
- **Diagnostics:** redaction policy first, then a versioned support bundle with
  health, slot state, service failures, bounded logs, configuration shape and
  release identity; collection must work locally/offline and must not require
  permanent SSH.

The recovery guide includes a consequence table for every action: which of
ROOTFS, BOOT, META, STATE, EPHEMERAL and DATA it reads, changes, preserves or
destroys. Any destructive command starts with an explicit device-selection and
backup checkpoint.

### 10. Record security boundaries without overstating dm-verity

The security pages distinguish four questions:

- runtime rootfs integrity through dm-verity;
- update authenticity through RAUC CMS and TUF metadata;
- boot-chain authenticity, reported by I1-I4 for the named board rather than
  assumed from dm-verity or required from every vendor bootloader;
- confidentiality, currently absent for STATE and DATA at rest.

For embedded targets this also records who controls boot-ROM recovery, JTAG and
serial access; when production fuses or secure-boot keys are injected; how
factory credentials are separated from fleet credentials; and which recovery
capabilities remain after debug lockdown. These are per-board manufacturing
contracts, not generic Linux settings.

The common mos assurance model targets I1 plus I2: a read-only
verity-protected root and authenticated normal system updates. A release claims
each only after its evidence exists; production I2 remains blocked until the
RAUC keyring provisioning path lands. Each product integrator chooses whether
physical possession remains an accepted full-compromise boundary or whether
I3/I4 boot verification, measured boot and data encryption enter that board's
product promise. The common work still defines how a production RAUC keyring is
provisioned and rotated. User documentation reports the selected level and
evidence; it does not imply end-to-end verified boot from dm-verity alone or
from a bootloader whose source is unavailable.

### 11. Keep fleet management conditional but design its boundary before implementation

If fleet operation is in the product scope, design the device-initiated channel
around enrollment, mutual identity, revocation, authorization, audit,
availability, proxy behavior and credential-domain separation. Update targeting
may share transport but not signing authority. If fleet operation is out of the
first release, say so in capability status and do not let the quickstart imply
remote vendor support.

### 12. Add documentation quality gates

Extend the current docs gate without adopting a static-site stack in this
phase:

- assert English and Chinese user navigation have the same page IDs;
- check local links, anchors and duplicate/missing index entries;
- validate command names, board IDs, image names and Make targets against
  `board.env`, release manifests and `make help`;
- validate the website's release, capability and supported-board claims against
  the same machine-readable sources rather than duplicating them in copy;
- validate API paths/examples against the generated OpenAPI document;
- run container examples through the existing Quadlet gate;
- exercise the documented OS-package example through the existing architecture
  package gate, and verify that no supported device procedure invokes `apt` or
  `dpkg`;
- validate application artifact metadata, compatibility declarations and
  digest-pinned image references; run documented OS-integrated native units,
  device exposure and cgroup-limit examples through their available systemd,
  Quadlet and per-board kernel gates, without labelling configured guidance as
  protected admission policy;
- validate storage documentation and status identifiers against `board.env`,
  the assembled GPT, rendered fstab/repart rules and supported per-board media;
  prohibit normal operator procedures from repartitioning or formatting the
  fixed system disk;
- add a small metadata lint for audience, support state, applies-to version,
  prerequisites, destructive warning and verification note;
- prohibit `supported` pages from linking their procedure to a mechanism marked
  only proposed/not implemented in the capability register;
- require every board/release security claim to name its I1-I4 assurance level,
  evidence owner and physical-attacker boundary; reject website or user-doc
  uses of `secure boot`, `verified boot` or `tamper-proof` that are not backed
  by the corresponding board evidence;
- keep hardware-only steps explicitly marked `not hardware-verified` until a
  dated cx3576 run records the board/revision and result.
- require each qualified board dossier to cover every mandatory qualification
  row and to identify the qualification owner, hardware revision, test image
  and test date.
- require every qualified board/release pair to publish its evidence owner and
  measured operating envelope: boot/recovery timing, storage footprint and
  growth budget, bounded log behavior, tested power-loss cases, and applicable
  thermal/watchdog limits.

Introduce a rendered/searchable site only after the Markdown contract is
stable. Antora, MkDocs and another generator remain interchangeable presentation
choices at this stage; selecting one now would add tooling without closing a
truth or coverage gap.

### 13. Deliver in reviewable increments

Implementation after approval is staged:

1. add the capability register, documentation contract and navigation gate;
2. write the bilingual official-website content/IA brief;
3. write/review the English minimum operator journey from shipped behavior;
4. add the application-publisher structure, delivery-model decision table and
   currently supported Quadlet workflow, while marking the native bundle path
   unavailable; remove the obsolete extension reservation and route every
   system component through image composition and RAUC system updates;
5. add the platform/BSP porting skeleton, `board.env` reference and
   qualification template, then populate the cx3576 dossier from verified facts;
6. verify commands on x64 and record/execute the cx3576 hardware verification
   queue where hardware is available;
7. add the Chinese operator, application and porting journeys and parity gates;
8. file the P0/P1/P2 system-gap tasks, each linked to the capability or board
   qualification row it blocks;
9. add specialised pages as those capabilities land;
10. implement the public site renderer/hosting only in a separate approved plan.

Each increment keeps `make docs-verify` and the new user-doc gate green. The
minimum journey is not declared complete while a page depends on an unshipped
mechanism; it links to `known-limitations.md` and offers only a verified
alternative.

## Risks

- **Documentation can certify fiction.** Status metadata, executable-contract
  checks and the capability register make unsupported claims fail visibly.
- **The rootfs composition is changing under PLAN-035/036.** User pages describe
  released artifacts and supported behavior, not stage numbers or package
  producer internals; refresh evidence after those plans complete.
- **cx3576 procedures need hardware evidence.** Source inspection and image
  verification are insufficient for flashing, first boot, network, update and
  rollback claims. Those pages stay preview/unverified until a dated run.
- **Board matrices can become paper compliance.** A `pass` requires a named
  test, image/release, board revision, date and result artifact; an empty row is
  `not tested`, never implicitly green.
- **One board result does not define the product.** Electrical design, storage,
  radio, thermal solution, boot ROM and vendor BSP differ by SKU and revision;
  shared requirements stay common while evidence remains board/revision
  specific.
- **Binary-only boot chains limit what can be guaranteed.** A vendor digest,
  version and hardware test can establish reproducibility and observed behavior,
  not source-level auditability. Such a board may meet I1/I2 if its A/B,
  recovery and rootfs contracts work, but it cannot claim I3/I4 without vendor
  capability evidence and a negative signature test. The integrator owns vendor
  access, redistribution rights, security escalation and upgrade availability.
- **`Best effort` can become an unlimited exception.** The I1-I4 labels keep it
  bounded: unavailable boot verification is acceptable only when disclosed;
  missing rootfs integrity, authenticated normal updates, A/B behavior or a
  recovery path is still a compatibility failure, not a documentation waiver.
- **Operational interlocks are product-domain decisions.** The OS can expose a
  safe-to-reboot contract, but it cannot invent when attached machinery is safe.
  Automatic reboot remains blocked until the product owner defines that state;
  no functional-safety certification is implied by this documentation.
- **Website copy magnifies stale claims.** Release, support and capability data
  is sourced from or checked against the same registers as the user docs; the
  content brief forbids hand-maintained version/support facts.
- **Production signing material is intentionally absent from the repository.**
  Documentation can define ceremony inputs and public anchors, never commit or
  fabricate private keys.
- **Independent applications can bypass the immutable-OS safety story.**
  STATE-backed systemd units persist across A/B changes and current containers
  are rootful; an incompatible or compromised application can survive OS
  rollback and execute with host privileges. The common trusted-integrator
  model mitigates this through documented/tested definitions but cannot call
  them non-bypassable. Separate signing, admission, least-privilege and
  automatic rollback become implementation requirements only if mos accepts or
  manages applications from a different trust domain.
- **Package terminology can create a false device contract.** The build pipeline
  produces `.deb` files, but the target intentionally has no package manager.
  The docs use `OS-integrated package` for composition inputs and never imply
  that `apt install` is a supported field operation.
- **A disk-management label can invite destructive generic controls.** mos's
  fixed GPT and A/B geometry are product invariants. The supported surface is
  storage status, capacity, media health, backup/reset and controlled recovery;
  arbitrary partition/format controls remain outside the normal operator API.
- **Storage health is media- and board-specific.** eMMC EXT_CSD, NVMe SMART and
  SATA SMART expose different counters and vendors interpret some lifetime
  fields differently. The API normalizes only documented thresholds and keeps
  the raw evidence available for support; an absent metric is `unsupported`,
  never `healthy`.
- **The scope can become a product rewrite.** This plan builds the documentation
  system and gap backlog. Provisioning, update clients, rescue, diagnostics and
  fleet management each require their own investigation, approval, tests and
  implementation plan.
- **Translation may drift.** Page-ID parity catches missing coverage, not
  semantic disagreement; release review must include a bilingual current-state
  review for changed supported procedures.
- **A release-channel scheme creates compatibility expectations.** Channel names
  and promotion windows are withheld until release ownership and support policy
  are explicitly assigned.
- **External CoreOS docs evolve.** The benchmark date and links make this a
  traceable comparison, not a permanent claim of exact parity.

## Scope

After approval, this plan covers the user-documentation structure, capability
register, minimum English and Chinese delivery journey, bilingual official-site
content/IA brief, hardware/BSP porting documentation and qualification template,
application/software-publisher documentation and delivery-model matrix,
embedded operating-envelope and field-service templates, validation scripts,
index updates and creation of follow-up task records for the identified system
gaps. It may make small corrections to existing design summaries when executable
contracts prove them stale.

It does not implement release hosting, an update client, provisioning channels,
a native application bundle/installer, container image signing or automatic
application update, factory reset, rescue, diagnostics export, secure boot,
disk encryption or fleet management. It does not commit production secrets,
choose a hosted documentation platform, build/deploy the official website,
perform unprovided hardware tests, or replace the existing engineering design
records. It does remove the unused extension reservation and stale documentation
that presents extensions as a future delivery mechanism.

Expected documentation/infrastructure footprint: roughly 12-18 minimum-journey
pages per language, 8-12 application-publisher pages per language, 10-14 porting
pages per language, one bilingual website brief, one capability register,
navigation indexes, one board qualification template, one small verification
script plus Make/CI wiring, and targeted corrections to current indexes/design
summaries. The numbers are ceilings for the first slice, not requirements to
create placeholders.

## Alternatives

### Keep extending `docs/design/`

Rejected. It preserves one authority but continues mixing shipped procedures,
history, proposals and implementation evidence. A customer cannot infer support
status safely from those records.

### Copy Fedora CoreOS's exact tools and navigation

Rejected. Ignition, rpm-ostree, Zincati, Cincinnati and a large cloud platform
matrix solve Fedora CoreOS's deployment model. mos already has RAUC/TUF,
appliance-specific storage, per-board BSPs and a zero-network first boot. Adopt
the lifecycle contracts, not the implementation brands.

### Treat mos as a smaller CoreOS distribution

Rejected. It would optimise for generic node provisioning and continuous online
operation while hiding the real product contracts: board revisions, vendor BSPs,
factory key/identity injection, bounded flash, power interruption, physical
recovery, offline service and long support horizons. CoreOS remains a reference
for immutable-OS lifecycle communication only.

### Require open bootloader source and hardware-rooted secure boot on every board

Rejected as the common compatibility floor. Many embedded products select
vendor boards whose early boot firmware is binary-only, and mos is primarily a
documented integration contract rather than the owner of every BSP. The common
floor remains I1 rootfs integrity, I2 authenticated normal updates, A/B and
recovery; I3/I4 are added and advertised where the board allows them.

### Accept any board definition without qualification ownership

Rejected. User ownership does not turn unknown behavior into support. A
user-selected board may be integrator-qualified, but its artifact provenance,
licenses, A/B and recovery contract, hardware matrix, assurance level and
lifecycle owner remain mandatory and visible.

### Publish only a single quickstart PDF

Rejected as the primary source. It is easy to hand over but hard to keep aligned
with API, board and release contracts. A generated PDF may later be an output of
versioned source pages, not a second hand-maintained manual.

### Select and deploy a documentation site generator immediately

Deferred. Search and version navigation are useful, but the present blocker is
truthful content and product capability. Markdown-first source with mechanical
gates remains portable to Antora, MkDocs or another renderer.

### Treat the public website as another hand-written copy of the docs

Rejected. A public site needs shorter product language, but its versions,
downloads, supported boards and capability state must come from the same release
and support records. Independent copy would be the most visible place for drift.

### Keep the existing new-board checklist as the porting manual

Rejected. It gives the repository shape and six high-level steps, but not the
vendor-intake decisions, full `board.env` reference, manufacturing inputs,
peripheral qualification, power/update fault testing, evidence format or
lifecycle obligations needed to call hardware supported.

### Enable apt/dpkg on the target as the application channel

Rejected. It conflicts with the immutable read-only-root contract, creates
device-local dependency and rollback state outside the RAUC image, and the
current image deliberately purges the package manager. Debian packages remain
reproducible OS-composition inputs unless a separate architecture decision
changes the target model.

### Use only containers for every customer application

Not selected as an absolute rule. Containers are the preferred default and
already have the strongest runtime primitive, but some embedded applications
need latency-sensitive device access, vendor libraries or boot ordering that
may justify a native form. The common route for those cases is an OS-integrated
Debian package updated with the RAUC system image; an independent signed native
bundle is conditional future work, and ad-hoc copied binaries and units are not
a supported substitute.

### Build a platform application policy engine now

Deferred. mos currently trusts the product integrator and exposes no marketplace
or remote application-upload service. Podman/systemd already enforce device and
cgroup controls when the integrator configures them, while documentation and
tested examples can make those configurations reproducible. A protected
admission layer, signature/key service, mandatory ceilings and automatic
rollback are justified only if a future product accepts applications from an
untrusted or separately administered domain.

### Add an independently overlaid system-extension channel

Rejected. It would introduce a second system-component compatibility, signing,
activation and rollback lifecycle alongside RAUC. All system components,
including optional product-profile features such as kiosk UI dependencies, are
instead composed into the immutable rootfs and updated atomically through the
signed RAUC A/B system-update path.

### Make Chinese the sole authoritative delivery language

Not selected because it would split the repository from its current English
authority and remote-visible metadata policy. If the commercial delivery
contract requires Chinese to be legally authoritative, make that an explicit
repository-wide documentation decision before implementation; the parity model
can support it, but this plan does not assume it.

## Annotations

- **2026-08-31 03:29 UTC — user:** Add an official website explanation and
  include hardware and board porting.
- **2026-08-31 03:29 UTC — response:** Added a bilingual public-site content/IA
  brief, a dedicated platform/BSP porting documentation tree, board intake and
  qualification rules, a cx3576 support dossier, and website/board truth gates.
- **2026-08-31 03:35 UTC — user:** mos is an embedded system and differs from
  ordinary CoreOS.
- **2026-08-31 03:35 UTC — response:** Reframed the plan as embedded-first,
  demoted CoreOS to documentation/lifecycle patterns, and added factory,
  offline-network, flash, power-loss, thermal/watchdog, field-service,
  board-revision and long-lived BSP requirements.
- **2026-08-31 03:43 UTC — user:** Ask whether package publishing, starting
  custom programs and custom containers are included.
- **2026-08-31 03:43 UTC — response:** Added a dedicated bilingual application
  publisher track and separated OS-integrated `.deb` composition, native
  applications and OCI/Quadlet containers, while auditing the then-existing
  extension placeholder. Recorded the current shipped boundary and the signing,
  privilege, compatibility, update, rollback, offline and documentation work
  still required.
- **2026-08-31 03:50 UTC — user:** Remove the system-extension mechanism; use
  system updates instead.
- **2026-08-31 03:50 UTC — response:** Removed system extensions from the
  delivery model. Optional system components are now build-time image-profile
  contents serviced only through signed RAUC A/B system updates. Added cleanup
  of the unused `extensions/` reservation and stale architecture/display
  descriptions to the approved implementation scope.
- **2026-08-31 03:54 UTC — user:** Compare the current system with a complete
  embedded Linux and ask whether disk management exists.
- **2026-08-31 03:54 UTC — response:** Added a production embedded-appliance
  maturity audit across update, storage, reliability, time, security,
  manufacturing, BSP, networking, applications, observability, recovery,
  supply chain and fleet operation. Distinguished the implemented fixed-layout,
  DATA growth and TRIM foundation from the missing operator storage lifecycle,
  and constrained destructive disk actions to factory/recovery tooling.
- **2026-08-31 04:01 UTC — user:** Treat trusted boot as best effort because
  many selected boards provide only binary U-Boot; users choose and integrate
  board definitions, while mos should primarily guide them through documentation.
- **2026-08-31 04:01 UTC — response:** Split mos and integrator responsibilities,
  allowed documented binary-only boot inputs when the A/B/rootfs/recovery
  contract is met, introduced I1-I4 additive assurance levels, distinguished
  mos-qualified from integrator-qualified boards, and limited public security
  claims to the evidence recorded for each board/revision.
- **2026-08-31 04:11 UTC — user:** Ask whether native signing, container keys,
  least-privilege hardware access, resource limits and application rollback
  should be documentation guidance or technical controls.
- **2026-08-31 04:11 UTC — response:** Defaulted the common product to a trusted
  integrator model with documentation, tested systemd/Quadlet examples and
  integration checks. Native applications follow RAUC OS authentication and
  rollback; protected admission, key enforcement, mandatory ceilings and
  automatic application rollback remain conditional product work for a
  managed or untrusted application domain.
- **2026-08-31 04:20 UTC — user:** Make the software-versus-documentation split
  explicit, prepare scheduling, and include NTP, clock and timezone handling.
- **2026-08-31 04:20 UTC — response:** Added authoritative DOC/SW/INT/OPS/COND
  classifications, W00-W15 capacity estimates, dependencies, a four-window
  draft calendar and its critical path. Added W03 as P0 software plus board
  validation and documentation after confirming the packed image has `tzdata`
  but no time daemon and the cx3576 HYM8563 RTC driver is currently disabled.
- **2026-08-31 04:26 UTC — user:** Consider adding BusyBox under `/build/bin` at
  the end of PATH, and require base-image NTP with UI-configurable NTP addresses
  and timezone.
- **2026-08-31 04:26 UTC — response:** Kept production command dependencies
  explicit and limited a future BusyBox toolbox to a justified recovery or
  developer profile. Selected `systemd-timesyncd` for the common W03 base,
  specified typed settings, schema migration, mosd reconciliation,
  authenticated apid/UI controls, UTC semantics, STATE-backed clock history
  and board verification.
- **2026-08-31 04:30 UTC — user:** Include the BusyBox binary but do not expand
  applet links, so links can be created for urgent field-service use.
- **2026-08-31 04:30 UTC — response:** Added W16 for Debian's normal dynamic
  `/usr/bin/busybox`, no applet links or PATH changes, explicit
  `busybox APPLET` use and transient `/run/mos-toolbox` links. Added package,
  initramfs, GNU-resolution, cross-architecture, SBOM and source-offer gates.
- **2026-08-31 04:31 UTC — user:** Confirm BusyBox should be preinstalled under
  `/usr/bin`, and keep NTP running without a pause function.
- **2026-08-31 04:31 UTC — response:** Confirmed the existing
  `/usr/bin/busybox` location. Removed `time.ntp.enabled` from W03 and made
  timesyncd an unconditional base service; UI/API change only the source list
  and timezone and report unavailable/synchronizing/degraded state while the
  service continues retrying.
- **2026-08-31 04:34 UTC — user:** Ask how often the time service synchronizes.
- **2026-08-31 04:34 UTC — response:** Verified the pinned trixie systemd 257.13
  behavior and fixed the MOS policy at an adaptive 32-2048 second polling
  window, a 30-second connection-retry floor and a 60-second persisted-clock
  save interval. Kept these platform controls out of the normal UI/API.
