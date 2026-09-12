# Mica OS documentation

> English | [中文用户指南](zh/README.md)

Mica OS is an embedded Linux operating system for industrial devices: a signed
dm-verity root, independently signed kernel/support components, file-based
A/B deployments managed by `mos-deploy`, and a local management API and
dashboard. The [architecture](architecture.md) maps the components; current
board status is in [support tiers](boards/support-tiers.md#current-boards).

## Start with a task

| I need to… | Read |
|---|---|
| Build and boot a device | [Quickstart](user/quickstart.md), [build guide](design/build.md), [installation](user/install.md) |
| Understand upgrade and rollback | [Operator guide](user/update-rollback.md), [deployment lifecycle](design/updates.md), [trust](design/release-signing.md) |
| Understand disk layout and recovery | [Storage](design/storage.md), [immutable root](design/ro-root.md), [reset/recovery](design/recovery.md) |
| Develop the API or UI | [API contract](design/api.md), [dashboard](design/dashboard.md), [OpenAPI](../pkgs/mosd/apid/openapi.json) |
| Integrate an application | [Native applications](design/native-applications.md), [containers](design/containers.md), [bus](design/bus.md) |
| Build, verify or publish artifacts | [Check harness](design/build-harness.md), [release directory](design/release-artifacts.md), [key delivery](design/key-delivery.md) |
| Port or qualify a board | [Board contract](boards/contract.md), [porting](boards/porting.md), [qualification](boards/qualification.md), [support tiers](boards/support-tiers.md) |
| Find work status or a decision | [Tasks](task/index.md), [plans](plan/index.md), [decisions](decisions/README.md), [changelog](changelog.md) |

## Naming

The product is **Mica OS** (identifier `mica`). Package, binary, service, bus
and path names keep the `mos` prefix — `mosd`, `mos-deploy`, `com.mos.mosd`,
`/mos/config` — and documents quote them verbatim.

## Ownership

Each fact has one owner; other documents link to it instead of restating it.

| Directory | Owns | Does not hold |
|---|---|---|
| `architecture.md` | the system map and repository layout | subsystem detail |
| `design/` | engineering contracts for current behaviour; unimplemented parts are labelled | chronology, test transcripts, record IDs |
| `boards/` | the board contract, porting and qualification process, per-board dossiers and the board status table | generic OS design |
| `user/` | operator and integrator instructions with truth-status lines | engineering rationale |
| `website/` | publication copy for micaos.dev and its claim limits | anything not yet evidenced |
| `research/` | measurements and external references that inform, but do not define, a contract | normative requirements |
| `plan/`, `task/` | `/pma` tracking: proposals, open work and acceptance evidence | permanent contracts |
| `decisions/` | dated decisions and skill divergences with a sunset | design detail |
| `changelog.md` | the history of changes to code and records | current behaviour |
| `zh/` | Chinese user guides and explicitly requested Chinese briefs | engineering translations |

The generated OpenAPI file owns route and schema detail. Permanent documents
describe the current system only: history lives in the changelog and Git, and
work in progress lives in `plan/` and `task/`.

## Complete catalog

- `architecture.md` — top-level system architecture and component map (start here)
- `design/` — engineering contracts
  - `access.md` — debug and maintenance access: channels, authentication, lockdown layers
  - `api.md` — management API: ownership, authentication, tasks and isolated UI hosting
  - `applications.md` — planned managed applications: curated OCI-first catalog, signed manifest, lifecycle, trust and API boundary
  - `build.md` — the build guide: board build products, component sequences, cross-compilation versus emulation, and build refusals
  - `build-harness.md` — how the checks run: pinned containers, the Rust gate, scratch space, ARM build-versus-execute, docs gates and the acceptance workflow
  - `bus.md` — management/application boundary, package-enrolled `com.mos.Item1` applications, D-Bus policy and MQTT grammar
  - `containers.md` — integrator's guide: Quadlet units, container interconnection, dependency ordering, persistence
  - `dashboard.md` — React dashboard: navigation, state, actions and development gate
  - `diagnostics.md` — system information, observed network state, board telemetry and the bounded redacted support snapshot
  - `display.md` — HDMI kiosk UI: cage and WPE rendering `apid` locally
  - `key-delivery.md` — key handover: what ceremonies produce, what may travel, and the checks a recipient runs before building
  - `manufacturing.md` — factory inputs, per-device result records, quarantine, RMA without identity cloning, debug and fuse policy
  - `mosd.md` — management plane: D-Bus contract, settings documents, reconcilers and bus surface
  - `native-applications.md` — integrator's guide to native `.deb` applications: units, accounts, writable state, the health gate, devices, ceilings and rollback limits
  - `provisioning.md` — configuration without a network: first-boot identity, provisioning documents and credentials
  - `recovery.md` — reset tiers, interrupted retry, credential and presence gates, shared-store recovery limits
  - `release-artifacts.md` — the release directory: manifest schema, SHA256SUMS, SBOM, provenance, licenses and customer verification
  - `release-signing.md` — independent boot, content and metadata trust, rotation and firmware maintenance
  - `remote-management.md` — what reaches the device today, the NAT requirement, the designed fleet protocol and update control flow
  - `ro-root.md` — read-only root: squashfs and dm-verity packing and boot wiring
  - `security-lifecycle.md` — key and credential lifecycles, owner roles, release channels, support windows and security response
  - `security-model.md` — threat and physical-access boundaries, the I1–I4 boot-assurance ladder and honest limits
  - `storage.md` — partitions and DATA namespaces: status surface, wear reporting, low-space policy and data-lifecycle decisions
  - `time.md` — RTC, saved clock floor, NTP synchronization and timezone management
  - `uboot-ab-handshake.md` — U-Boot signed FIT selection, redundant native records and health confirmation
  - `updates.md` — deployment lifecycle: state model, acquisition, installation, policy, reboot gate and fault evidence
  - `wifi.md` — Wi-Fi station and access point as two mosd reconcilers driving wpa_supplicant and hostapd
- `boards/` — board contract, porting, qualification and dossiers
  - `contract.md` — BSP contract: artifacts, kernel assertions, new-board checklist
  - `porting.md` — BSP porting manual: blank board to supported board, by stage
  - `intake.md` — vendor and BSP intake rubric: input classes and acceptance
  - `board-env.md` — `board.env` key reference: the board definition contract
  - `board-template.md` — board dossier template: the thirteen validated sections
  - `qualification.md` — field-reliability qualification: the matrix and its binding rules
  - `assurance.md` — boot assurance ladder (I1–I4) and what each level requires
  - `support-tiers.md` — board support tiers and the current board status table
  - `cx3576.md` — board dossier: CX3576-Z / RK3576
  - `cx3576-bench.md` — the cx3576 bench session: stage order, scriptable and human rows, the power-cut window and the collector
  - `cx3576-bsp-sync.md` — cx3576 upstream BSP: source repository, synced commit, deviation register
  - `s905x5m.md` — board dossier: BM201 / S905X5M mainline adaptation and qualification boundary
  - `virt-arm64.md` — board dossier: ARM64 UEFI/QEMU image and its evidence boundary
- `user/` — the customer journey from download to support
  - `doc-contract.md` — the contract behind this set: audience, page ownership, truth-status taxonomy, evidence rules
  - `quickstart.md` — the shortest honest path to a running Mica OS system
  - `download.md` — release selection and obtaining an image
  - `install.md` — writing an image to a board and reaching first boot
  - `first-run.md` — first boot, the offline provisioning document, and claiming the device
  - `manufacturing.md` — putting Mica OS on units at volume: identity, first credential, factory record and quarantine
  - `configuration.md` — the configuration model and every supported way to change settings
  - `applications.md` — delivering and running applications: native packages and containers
  - `update-rollback.md` — the A/B update path, health confirmation and rollback
  - `recovery.md` — what to do when a device does not boot, and what recovery costs
  - `storage.md` — partitions, what survives what, and where data belongs
  - `troubleshooting.md` — diagnosis: access channels, evidence to read, refusals to interpret
  - `security.md` — the security posture: what is protected, by what, and the named gaps
  - `release-notes.md` — how releases are identified and where release facts come from
  - `api.md` — the programmatic surface and its machine-readable contract
  - `support.md` — support tiers, lifecycle ownership, and what a support case needs
- `website/` — micaos.dev content briefs, one per page
  - `contract.md` — the website content contract: page set, tone, claims policy
  - `product.md` — page brief: what Mica OS is, in one honest screen
  - `embedded.md` — page brief: why Mica OS is not a generic server/cloud OS
  - `hardware.md` — page brief: whether a visitor's board runs Mica OS, at what tier
  - `downloads.md` — page brief: selecting a release and the image for a board
  - `documentation.md` — page brief: the portal into the user documentation set
  - `security.md` — page brief: the security posture, stated exactly as it is
  - `licensing.md` — page brief: the license facts the site must carry
  - `support.md` — page brief: what support exists and who owns what
- `research/` — measurements and external references
  - `root-closure.md` — what the read-only root is made of, which packages are deletable, and whether mosd could own network configuration
  - `ssd202d-lite.md` — draft: Mica OS on SigmaStar SSD202D and the 16 MiB / 128 MiB flash fork
  - `venus-gui-v2.md` — Venus OS gui-v2 functional reference, mapped to apid and dashboard owners
- `plan/`, `task/` — `/pma` tracking with status indexes
- `decisions/` — dated decisions with review sunsets
- `zh/` — Chinese user guides

`make docs-verify` checks catalog membership in both directions, internal
links, truth-status evidence, board dossiers, Chinese coverage, tracking
records and stale terms. Add or remove a catalog row in the same change as its
document.
