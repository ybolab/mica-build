# mos documentation

> English | [中文](zh/README.md)

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
  - `uboot-ab-handshake.md` — A/B boot-order contract between U-Boot, RAUC and the health gate
  - `dashboard.md` — dashboard proposal: landing screen, IA, technology posture, process architecture
  - `api.md` — API-first apid: current HTTP/bus surface, proposed API, static hosting, replaceable UI
  - `bsp-cx3576-sync.md` — cx3576 upstream BSP: source repo, synced commit, deviation register
  - `bus.md` — management/application boundary, package-enrolled `com.mos.Item1` applications, D-Bus policy and MQTT grammar
  - `release-signing.md` — production key ceremonies: TUF root, RAUC CA, bundle signing runbook
  - `updates.md` — device update lifecycle: state model, update policy file, maintenance/metered/offline rules, safe-to-reboot gate, operator procedures, fault-test evidence
  - `recovery.md` — recovery design: the four reset tiers and what each clears, the data-preserving-first decision tree, the physical-presence contract, credential rotation rather than disclosure, both-slots-failed and the non-destructive repair tier
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
  - `cx3576-example.md` — the filled dossier instance for the cx3576 board
  - `qualification.md` — field-reliability qualification: the matrix and its binding rules
  - `assurance.md` — boot assurance ladder (I1–I4) and what each level requires
  - `support-tiers.md` — board support tiers: claims about evidence and ownership
- `research/` — research notes: external products read as benchmarks, not part of the design record
  - `venus-gui-v2.md` — Venus OS gui-v2 functional reference, source-read, mapped to apid/dashboard owners
- `plan/` — PMA plans (numbered, with status index)
- `task/` — PMA task tracking
- `zh/` — Chinese documentation, written against the current version

Rules. `architecture.md` and `design/` are the English design record and are
authoritative; `user/`, `website/` and `bsp/` are the shipped documentation,
website and board sets; `zh/` carries the Chinese documentation and yields to
the English on conflict. Those are the documents that ship, and
`docs/README.md` is asserted against `design/`, `user/`, `website/` and `bsp/`
in both directions by `make docs-verify`, so a new page in any gated
directory needs its row here in the same commit.

`plan/` and `task/` are PMA process tracking, not product: English only,
following the PMA lifecycle (investigate -> proposal -> implement), and a
record is deleted when it closes. They carry no index gate, because the set one
would assert is empty or nearly so.

These documents describe design and behaviour. They do not cite code by line
and do not narrate implementations statement by statement, because a document
coupled to line numbers is falsified by edits that leave its design intact.
Where a precise contract is needed, the artifact that carries it is named
instead: the HTTP surface is specified by `pkgs/mosd/apid/openapi.json`,
which CI holds equal to what the shipped binary prints, and the rest lives in
the code the document points at by module.
