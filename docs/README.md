# mos documentation

> English | [中文用户指南](zh/README.md)

Current development images use signed file deployments managed by `mos-deploy`.
There is no RAUC or lode update runtime. Each acceptance sequence starts from a
complete current image. The [architecture](architecture.md) maps the components;
the [delivery record](task/20260908-2229-file-ab-delivery-x64-first.md) records
tested artifacts and the remaining cx3576 physical acceptance.

## Start with a task

| I need to… | Read |
|---|---|
| Build and boot a device | [Quickstart](user/quickstart.md), [build guide](design/build.md), [installation](user/install.md) |
| Understand upgrade and rollback | [Operator guide](user/update-rollback.md), [deployment lifecycle](design/updates.md), [trust](design/release-signing.md) |
| Understand disk layout and recovery | [Storage](design/storage.md), [immutable root](design/ro-root.md), [reset/recovery](design/recovery.md) |
| Develop the API or UI | [API contract](design/api.md), [dashboard](design/dashboard.md), [OpenAPI](../pkgs/mosd/apid/openapi.json) |
| Integrate an application | [Native applications](design/native-applications.md), [containers](design/containers.md), [bus](design/bus.md) |
| Build, verify or publish artifacts | [Check harness](design/build-harness.md), [release directory](design/release-artifacts.md), [key delivery](design/key-delivery.md) |
| Port or qualify a board | [Porting](bsp/porting.md), [qualification](bsp/qualification.md), [cx3576 bench](bsp/cx3576-bench.md) |
| Find work status or a decision | [Tasks](task/index.md), [plans](plan/index.md), `decisions/`, [changelog](changelog.md) |

## Document ownership

`architecture.md` is the system map. `design/` owns engineering contracts;
unimplemented requirements are labeled and their execution belongs in `plan/`
and `task/`. `user/` owns operator instructions, `bsp/` owns board evidence and
qualification, and `website/` owns publication copy and its claim limits.
The generated OpenAPI file owns route/schema detail.

Chinese user guides are maintained under `zh/user/`; retained translations link
to their English source. Superseded engineering translations and prototypes are
removed instead of remaining beside current instructions. Historical decisions
are available in the changelog and Git history. A closed task may be removed
with its index row after its outcome and replacement are recorded.

## Complete catalog

- `architecture.md` — top-level system architecture and component map (start here)
- `design/` — subsystem design records
  - `access.md` — debug/maintenance access: channels, auth phases, lockdown layers
  - `applications.md` — planned managed applications: curated OCI-first catalog, signed manifest, lifecycle, trust and API boundary
  - `boards.md` — BSP contract: artifacts, kernel assertions, new-board checklist
  - `remote-management.md` — what reaches the device today (apid on the LAN over HTTPS), the NAT/fleet channel as a requirement with no design, update control flow
  - `display.md` — HDMI kiosk UI: cage+WPE rendering `apid` locally
  - `provisioning.md` — configuration without a network: three-layer model
  - `mosd.md` — management plane design brief: D-Bus tree, settings schema, reconcilers
  - `connd.md` — connectivity concern (no `connd` process ships): WiFi STA/AP as two mosd reconcilers driving wpasupplicant/hostapd units
  - `containers.md` — integrator's guide: Quadlet units, container interconnection, dependency ordering, persistence
  - `native-applications.md` — integrator's guide to the native path: the `.deb` producer, the unit and what starts it, dedicated accounts, writable state, the health gate, named devices, ceilings, and what the A/B lifecycle does and does not roll back
  - `ro-root.md` — read-only root: squashfs + dm-verity rootfs pack and boot wiring
  - `storage.md` — fixed storage tiers and media: status surface, wear reporting, low-space policy, the reserved update workspace and the explicit data-lifecycle decisions
  - `uboot-ab-handshake.md` — cx3576 signed FIT selection, redundant native records and health confirmation
  - `dashboard.md` — current React dashboard: navigation, state, actions and development gate
  - `api.md` — current management API: ownership, authentication, tasks and isolated UI hosting
  - `bsp-cx3576-sync.md` — cx3576 upstream BSP: source repo, synced commit, deviation register
  - `bus.md` — management/application boundary, package-enrolled `com.mos.Item1` applications, D-Bus policy and MQTT grammar
  - `release-signing.md` — independent boot/content/metadata trust, rotation and firmware maintenance
  - `key-delivery.md` — key handover: what the ceremonies produce, what may travel and what never does, the delivery form this tree does not define, and the checks a recipient runs before building
  - `updates.md` — device update lifecycle: state model, update policy file, maintenance/metered/offline rules, safe-to-reboot gate, operator procedures, fault-test evidence
  - `recovery.md` — three reset tiers, interrupted retry, credential/presence gates and shared-store recovery limits
  - `release-artifacts.md` — the release directory: manifest schema, SHA256SUMS/SBOM/provenance/licenses, publication gate, customer verification procedure
  - `security-model.md` — threat and physical-access boundaries per concern, the I1–I4 boot-assurance ladder, honest limits
  - `security-lifecycle.md` — key/credential lifecycles with owner roles, release channels and custody, support windows, security response
  - `manufacturing.md` — factory inputs, per-device result records, quarantine, RMA without identity cloning, debug/fuse policy
  - `build-harness.md` — how this repository's checks are run: the pinned bun container, the Rust gate's container and PATH, scratch that is not `/tmp`, arm64 build-vs-execute, and the docs gates
  - `build.md` — the build guide: what a board build produces, the x64 and cx3576 sequences, which cx3576 steps cross-compile, emulate inside buildkit or need host binfmt, and how to read the build's refusals
  - `time.md` — RTC, saved clock floor, NTP synchronization and timezone management
  - `diagnostics.md` — diagnostics: the system-information surface, observed network state, board telemetry, and the bounded redacted support snapshot
- `user/` — user documentation: the customer journey from download to support
  - `doc-contract.md` — the contract behind this set: audience, page ownership, truth-status taxonomy, evidence rules
  - `quickstart.md` — the shortest honest path to a running mos system
  - `download.md` — release selection and obtaining an image
  - `install.md` — writing an image to a board and reaching first boot
  - `first-run.md` — first boot, the offline provisioning document, and claiming the device
  - `manufacturing.md` — putting mos on units at volume: who mints identity and the first credential, the factory record, and quarantine of failed or duplicated provisioning
  - `configuration.md` — the configuration model and every supported way to change settings
  - `applications.md` — delivering and running applications: native packages and containers
  - `update-rollback.md` — the A/B update path, health confirmation and rollback
  - `recovery.md` — what to do when a device does not boot, and what recovery costs
  - `storage.md` — the storage tiers, what survives what, and where data belongs
  - `troubleshooting.md` — diagnosis: access channels, evidence to read, refusals to interpret
  - `security.md` — the security posture: what is protected, by what, and the named gaps
  - `release-notes.md` — how releases are identified and where release facts come from
  - `api.md` — the programmatic surface and its machine-readable contract
  - `support.md` — support tiers, lifecycle ownership, and what a support case needs
- `website/` — official-website content briefs, one per page
  - `contract.md` — the website content contract: page set, tone, claims policy
  - `product.md` — page brief: what mos is, in one honest screen
  - `embedded.md` — page brief: why mos is not a generic server/cloud OS
  - `hardware.md` — page brief: whether a visitor's board runs mos, at what tier
  - `downloads.md` — page brief: selecting a release and the image for a board
  - `documentation.md` — page brief: the portal into the user documentation set
  - `security.md` — page brief: the security posture, stated exactly as it is
  - `licensing.md` — page brief: the license facts the site must carry
  - `support.md` — page brief: what support exists and who owns what
- `bsp/` — BSP porting and qualification set
  - `porting.md` — BSP porting manual: blank board to supported board, by stage
  - `intake.md` — vendor and BSP intake rubric: input classes and acceptance
  - `board-env.md` — `board.env` key reference: the board definition contract
  - `board-template.md` — board dossier template: the thirteen validated sections
  - `s905x5m.md` — board dossier: BM201 / S905X5M mainline adaptation and qualification boundary
  - `cx3576-example.md` — the filled dossier instance for the cx3576 board
  - `cx3576-bench.md` — the cx3576 bench session: stage order and assumptions, the scriptable/human split per row, the power-cut window, and the collector that writes the dossier's rows
  - `virt-arm64.md` — board dossier: ARM64 UEFI/QEMU signed-file image and its evidence boundary
  - `qualification.md` — field-reliability qualification: the matrix and its binding rules
  - `assurance.md` — boot assurance ladder (I1–I4) and what each level requires
  - `support-tiers.md` — board support tiers: claims about evidence and ownership
- `research/` — research notes: external products read as benchmarks, and feasibility drafts held outside the design record
  - `venus-gui-v2.md` — Venus OS gui-v2 functional reference, source-read, mapped to apid/dashboard owners
  - `ssd202d-lite.md` — draft: mos on SigmaStar SSD202D; the 16 MiB / 128 MiB flash fork that selects between a new OS and a new board
  - `root-closure.md` — measurement: what the read-only root is made of, which packages are deletable, which are held there by a shell script, and whether mosd could own network configuration instead of systemd-networkd
- `plan/` — approved proposals and remaining acceptance, with a status index
- `task/` — PMA task tracking
- `zh/` — current Chinese user guides and retained engineering translations

`make docs-verify` checks catalog membership in both directions, internal links,
truth-status evidence and translation coverage. Add or remove a catalog row in
the same change as its document. Keep test transcripts and implementation
chronology in delivery records; permanent guides describe behavior and runnable
entry points.
