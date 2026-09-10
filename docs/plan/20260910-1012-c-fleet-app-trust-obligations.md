# 20260910-1012-c-fleet-app-trust-obligations Fleet application and trust obligation classification

- **status**: completed
- **createdAt**: 2026-09-10 10:12
- **approvedAt**: 2026-09-10 10:12
- **relatedTask**: 20260910-1012-c-fleet-app-trust-obligations

## Context

This bounded audit compares the historical fleet application and trust backlog
against the committed tree at
`5c61f7fbb5589807e931e981b3ef8cb9bdff8b6d`. It does not implement production
code or broaden historical designs.

## Proposal

Record an obligation-level classification with current file-and-line evidence,
test limitations, implementation-ready dependency slices, shared-path needs,
and bounded product choices for the parent workstream.

## Obligation Matrix

The classifications below are obligation classifications, not status-field
translations. `already delivered` may mean an approved design decision rather
than a shipped mechanism; the evidence column says which. `valid
implementation work` means a current obligation with a bounded slice below.
For a design-only delivered decision or a superseded product clause, the
available repository gate is `make docs-verify`; there is no software behavior
to test unless the row names a current mechanism and its stronger gate.

### PLAN-054: product and fleet boundary

The actual top-level trigger is the question at PLAN-054 lines 10–20: whether
fleet operation is an explicit product promise. It holds because the latest
approval says yes and selects outbound registration/reporting
(`PLAN-054.md:185-220`). Consequently the selected `COND/design` and
`COND/security` work is live. The separate bidirectional-control trigger does
not hold because no control channel was selected. `COND/OPS/DOC` is a live
product obligation, but its implementation trigger is unmet because no plane
repository or service owner is in this assignment. These distinctions prevent
the selected report slice from silently becoming a control plane.

| Obligation ID | Classification | Current evidence, test and limit |
|---|---|---|
| `PLAN-054/COND-product: fleet exists and first slice` | already delivered | Design approval only: PLAN-054 lines 14–31 selects fleet operation and outbound registration/reporting; lines 185–220 records the final approval. Current code still has no fleet connection (`docs/design/remote-management.md:56-58`). `make docs-verify` is the only applicable test of this decision record. |
| `PLAN-054/Q1 operator` | already delivered | The latest approval is vendor-operated by default, optional integrator-operated open-source server, and a per-device effective URL (`PLAN-054.md:185-210`; `PLAN-072.md:335-346`). This is product approval, not evidence that a server exists. |
| `PLAN-054/Q2 scale and availability` | unresolved product decision | The latest approval explicitly leaves it with the plane operator and makes it non-blocking for the autonomous device (`PLAN-054.md:218-220`; `PLAN-072.md:387-392`). No service repository, SLO or capacity target is in scope. |
| `PLAN-054/Q3 data residency` | unresolved product decision | The 2026-09-04 amendment removes the device/image dependency but leaves vendor-plane residency as an operator decision (`PLAN-054.md:218-240`; `PLAN-072.md:393-395`). An integrator chooses residency by choosing where to run its own plane. |
| `PLAN-054/Q4 offline tolerance` | already delivered | Product approval: the plane assists and never gates local execution (`PLAN-054.md:202-205`; `PLAN-072.md:348-351`). No software test exists because fleet software does not exist. C4 is the valid proof obligation. |
| `PLAN-054/Q5 support liability` | already delivered | Product approval: plane failure does not affect the device and no stronger availability promise was made (`PLAN-054.md:206-211`; `PLAN-072.md:353-355`). |
| `PLAN-054/Q6 zero-touch enrollment` | already delivered | Product approval selected TOFU keyed by `deviceId`, without a factory credential (`PLAN-054.md:212-215`; `PLAN-072.md:357-368`). `provisioning.deviceId` is currently generated locally (`docs/design/provisioning.md:16-32`), but registration is absent. |
| `PLAN-054/Q7 serial and MAC` | already delivered | Product approval excludes both and uses `deviceId` (`PLAN-054.md:216`; `PLAN-072.md:381-386`). Existing diagnostics tests prove secret/MAC redaction, not a nonexistent fleet payload (`pkgs/mosd/apid/src/diagnostics.rs:1370-1501`). |
| `PLAN-054/COND-design: registration architecture` | already delivered | Approved design only in PLAN-072: outbound HTTPS, no inbound port, effective URL, locally authoritative disable, and TOFU. Current design truth remains no implementation (`docs/design/remote-management.md:56-70`). |
| `PLAN-054/COND-design: NAT support channel` | unresolved product decision | The trigger holds: current design calls NAT-safe support a live requirement (`docs/design/remote-management.md:60-83`). Missing are service ownership, mutually authenticated connection protocol, authorization model and a bounded command set. Do not extend reporting into this channel. |
| `PLAN-054/COND-design: identity rotation` | unresolved product decision | TOFU enrollment is approved, but no fleet credential format, renewal/revocation protocol or recovery authority is specified; current lifecycle explicitly says no fleet CA/enrollment (`docs/design/security-lifecycle.md:91-107`). |
| `PLAN-054/COND-design: policy targeting` | unresolved product decision | No remote configuration or target selector is approved; PLAN-072 excludes configuration push and fleet-derived device roles (`PLAN-072.md:562-568`). A target model belongs to a separate plane contract. |
| `PLAN-054/COND-design: staged rollout` | unresolved product decision | Current updates are a local signed-file capability and there is no remote trigger (`docs/design/remote-management.md:85-113`). A rollout state machine, stop conditions and plane-side ownership are missing. |
| `PLAN-054/COND-design: command audit` | unresolved product decision | No command channel or command vocabulary exists. The current APID audit trail is an authenticated LAN boundary and cannot be reused as proof for a future remote channel (`docs/design/remote-management.md:27-48`). |
| `PLAN-054/COND-design: break-glass support` | unresolved product decision | The requirement has no approved authority, physical-presence rule, expiry, revocation or audit contract. Current recovery deliberately preserves signature and local authentication boundaries. |
| `PLAN-054/COND-security: selected registration slice` | already delivered | PLAN-072 threat-models the outbound-only slice and preserves autonomy; this is design evidence only. Current stock images still make no outbound connection (`docs/design/remote-management.md:122-135`). |
| `PLAN-054/COND-security: bidirectional control` | unresolved product decision | The approved registration threat model is explicitly not valid for a control channel (`PLAN-054.md:61-66`). Tenant isolation, authorization, replay, plane compromise and operator-role decisions must be reopened in a separate plan. |
| `PLAN-054/COND-OPS/DOC` | unresolved product decision | Retention, privacy, incident response, disaster recovery, SLOs and fleet-administrator journeys remain external-plane obligations (`PLAN-054.md:67-73`). There is no external service owner or path to inspect in this assignment. |

`RFCT-290` is a stale design-only tracking record: its `pending` status is not
delivery evidence. PLAN-054/072/076 now contain the later approvals, while its
explicit “no fleet software” condition remains true.

### PLAN-069: managed application enforcement

The actual trigger at PLAN-069 lines 28–38 now holds: the current application
contract schedules a managed module and selects a first production target
(`docs/design/applications.md:3-10,255-275`). That does not select every later
source class or create an external catalog service.

| Obligation ID | Classification | Current evidence, test and limit |
|---|---|---|
| `PLAN-069/SW independent native bundle` | unresolved product decision | Managed native admission is explicitly later and disabled pending a non-root identity and reviewed sandbox (`docs/design/applications.md:47-57,255-275`). The historical independent-unit mechanism is not selected for the first OCI slice, and backward OS/schema compatibility is not required during development. |
| `PLAN-069/SW container trust policy` | valid implementation work | The enforcement obligation holds for curated OCI, but the historical distributable global `signedBy policy.json` mechanism is replaced by signed catalog-manifest and exact-digest admission at staging and activation (`docs/design/applications.md:41-54`). The shipped global policy still says `insecureAcceptAnything` (`rootfs/overlay/etc/containers/policy.json:1-15`; `docs/design/containers.md:403-419`). Slice `APP-TRUST`. |
| `PLAN-069/SW resource/device admission` | valid implementation work | Current Quadlets can omit every ceiling and there is no admission step (`docs/design/containers.md:388-393`). The selected contract requires generated declarations and conflict refusal (`docs/design/applications.md:61-86`). Slice `APP-ADMIT`. |
| `PLAN-069/SW protected secret store` | valid implementation work | Current registry credentials are merely root-readable files and are explicitly not a secret store (`docs/design/containers.md:465-487`). The selected contract requires write-only API values and systemd credential files (`docs/design/applications.md:156-176`). Slice `APP-SECRETS`. |
| `PLAN-069/SW audit projection` | valid implementation work | The current application contract assigns durable task IDs and an activity projection but no routes or manager exist (`docs/design/applications.md:88-116,178-215`). Slice `APP-AUDIT`. |
| `PLAN-069/SW health-gated rollback` | valid implementation work | Manual digest rollback has no health gate and depends on retained images (`docs/design/containers.md:489-521`). The selected contract requires a bounded gate and last-known-good result (`docs/design/applications.md:88-122`). Slice `APP-ROLLBACK`. |

The selected work is local managed OCI only. `System` and
`External/unmanaged` remain observe-only; `Local trusted` enrollment is a
later, disabled-by-default capability; managed native is later still
(`docs/design/applications.md:22-32,255-275`). The public marketplace and fleet
rollout are out of scope. The exact curated-catalog signature envelope, its
application-publisher anchor and revocation statement are a missing contract
listed under product choices; no slice may silently reuse the OS update key.

### PLAN-072: outbound registration

| Obligation ID | Classification | Current evidence, test and limit |
|---|---|---|
| `PLAN-072/C1 local config and off transition` | valid implementation work | Baked fields and an off/null code default exist (`pkgs/mosd/mosd-settings/src/configuration.rs:174-228,246-267`), but the current resolver explicitly has no `/mos/config/fleet.json` (`configuration.rs:1221-1225`) and reports baked values only (`configuration.rs:1257-1270`). Slice `FLEET-CONFIG`. |
| `PLAN-072/C1 deregistration call` | unresolved product decision | Local stop and credential deletion are fully specified and remain authoritative (`PLAN-072.md:111-143`), but the old-plane endpoint, authentication, idempotency and response taxonomy are absent. Disable must never wait for this best-effort call. |
| `PLAN-072/C2 registration payload/client/credential` | unresolved product decision | The allowlist is approved (`deviceId`, board, profile, version and product; no serial/MAC/secrets), but neither an endpoint nor request/response envelope, post-TOFU credential type, storage filename, renewal, revocation or `fleetd` IPC for registration identity exists. Current provisioning creates no PKI (`docs/design/provisioning.md:99-105`). |
| `PLAN-072/C2 claim-code display` | superseded | The later explicit approval selected zero-touch TOFU shape (c), not operator claim-code shape (a) (`PLAN-072.md:357-368`). Current design still has no enrollment implementation (`docs/design/remote-management.md:56-70`). A stronger optional claim flow would require a new plane contract; it is not a default device obligation. No software test applies; `make docs-verify` covers the current decision text. |
| `PLAN-072/C3 inventory report` | superseded | PLAN-076 replaces the short inventory report with B1–B13’s approved, narrower state-report contract and separate reporting switch (`PLAN-076.md:244-509`). Current code has neither (`docs/design/remote-management.md:56-58`); use PLAN-076 rows rather than implementing both. No software test applies; `make docs-verify` covers the replacement contract. |
| `PLAN-072/C4 autonomy proof` | valid implementation work | The approved product promise is still current and no fleet runtime exists to test. The proof must follow the implementation and show every existing local API/update/recovery capability still works with the configured plane unreachable. Slice `FLEET-AUTONOMY`; it needs a later QEMU grant. |
| `PLAN-072/C5 update-channel hint` | unresolved product decision | The safety rule is clear—never write update policy or source—but the registration response has no wire field or persistence/display contract. PLAN-076 closes report responses to transport outcomes only; a registration hint must not leak into that path. |
| `PLAN-072/C6 console` | valid implementation work | No fleet route or UI exists (`docs/design/remote-management.md:56-58`; OpenAPI inspection below). It depends on config, status and registration state. Slice `FLEET-CONSOLE`. |
| `PLAN-072/C7 current design/user docs` | valid implementation work | Current docs correctly say fleet is absent, so they must change only with shipped slices. Slice `FLEET-DOC`. |

### PLAN-076: state reporting

| Obligation ID | Classification | Current evidence, test and limit |
|---|---|---|
| `PLAN-076/B1` | valid implementation work | Diagnostics already supplies a tested fail-closed pattern, but it deliberately keeps a broader per-act set and uploads nothing (`pkgs/mosd/apid/src/diagnostics.rs:1-23,107-231`; `docs/design/diagnostics.md:28-43,237-287`). A distinct fleet allowlist is required. Slice `FLEET-REPORT`. |
| `PLAN-076/B2` | valid implementation work | No `GetFleetReport` member exists. Build it beside the state sources with fixed keys and `unknownComponents`; do not let `fleetd` read the settings/state tree. Slice `FLEET-REPORT`. |
| `PLAN-076/B3` | valid implementation work | Current telemetry observes point samples, not min/max/last across the report window. Slice `FLEET-THERMAL`. |
| `PLAN-076/B4` | already delivered | Closed update codes ship in `pkgs/mosd/mosd/src/update_codes.rs:1-24,36-130`, reboot-health codes ship in `update_policy.rs:228-307`, and APID health transport failures are typed and tested (`apid/src/tests.rs:3686-3729`). `make os-rust-gate` is the current gate; it was inspected, not run here. |
| `PLAN-076/B5` | unresolved product decision | The unit/UID/bus restriction is designed (`PLAN-076.md:511-555`), but an outbound client cannot be self-contained without the registration/report endpoint and credential contracts. No `fleetd` crate or unit currently exists. |
| `PLAN-076/B6` | valid implementation work | Cadence 900 s, 60 s floor, trigger set, coalescing and recovery jitter are complete local semantics (`PLAN-076.md:329-359`). Implement after a pure sender interface, without enabling networking by default. Slice `FLEET-SCHEDULE`. |
| `PLAN-076/B7` | valid implementation work | `/mos/fleet`, 128 reports/1 MiB, oldest drop, `gapReports`, append-only outage writes and 64-counter reservations are fully specified (`PLAN-076.md:361-407`) and fit current unlimited DATA/mos accounting (`docs/design/storage.md:56-71`). Slice `FLEET-BUFFER`. |
| `PLAN-076/B8` | valid implementation work | Three-key `fleet.json`, nested switch semantics and configured-host off-state proof are specified (`PLAN-076.md:409-437,471-509`). Combine the document model with `FLEET-CONFIG`; the network-negative proof stays in `FLEET-AUTONOMY`. |
| `PLAN-076/B9` | valid implementation work | Authenticated status and exact preview are fully specified and absent from current OpenAPI. Slice `FLEET-STATUS`, after `FLEET-REPORT` and `FLEET-CONFIG`. |
| `PLAN-076/B10` | valid implementation work | The response must be data-inert: commands, cadence, config and bundle URLs may only result in transport failure/accepted-counter handling. Slice `FLEET-CLIENT-SAFETY`, after the wire contract. |
| `PLAN-076/B11` | valid implementation work | Clock-related TLS failure classification and `sysinit.target` ordering are bounded device behavior (`PLAN-076.md:557-576`). Slice `FLEET-CLIENT-SAFETY`, after the wire contract. |
| `PLAN-076/B12` | valid implementation work | The built-in console has no fleet surface. Add it only after status is real. Slice `FLEET-CONSOLE`. |
| `PLAN-076/B13` | valid implementation work | Current fleet docs correctly remain `[not implemented]`; update them only after code/tests. Slice `FLEET-DOC`. |
| `PLAN-076/§8 plane accepts old schemas forever` | superseded | The current development instruction explicitly rejects backward readers/migrations unless separately requested, and current deployment accepts only current signed-file contracts (`docs/design/updates.md:1-9`). There is no deployed report schema to preserve because no fleet path exists (`docs/design/remote-management.md:56-58`). Implement only the newest approved contract; no software compatibility test applies, while `make docs-verify` covers the current contract. |

### PLAN-077 and RFCT-305: trust grade and release refusal

PLAN-077 itself remains `proposed`; there is no later approval section in that
file. Current code is nevertheless authoritative for mechanisms that landed.
The current trust model is signed file deployments through `mos-deploy`, with
boot/content/metadata anchors carried by authenticated boot policy
(`docs/design/updates.md:1-9`; `docs/design/release-signing.md:1-26`). Historical
RAUC/TUF/lode device mechanisms are not current work.

| Obligation ID | Classification | Current evidence, test and limit |
|---|---|---|
| `PLAN-077/G1` | already delivered | `rootfs/build.sh:233-250` stages the mandatory public manifest and conditionally stages nonempty `GENERATED`. Available current gates: `make os-build-test`, `make os-verify-test`; not run in this docs-only unit. |
| `PLAN-077/G2` | superseded | The historical host-tree/image byte biconditional is not the current verifier contract. Current packed-root verification rejects anchors, private material and extra files (`verify/src/checks-file-root.ts:91-100`; negative fixture `checks-file-root.test.ts:32-42`). Release assembly accepts caller-supplied extraction and explicitly does not prove it came from the image (`docs/design/release-artifacts.md:72-76`); full image verification is separate. |
| `PLAN-077/G3` | already delivered | Device grade has production/development/absent states and does not equate absence with production (`pkgs/mosd/mosd/src/system_info.rs:266-313,481-509,652-672`). Tests cover all three (`system_info.rs:1212-1295`). Diagnostics allowlists the trust projection (`apid/src/diagnostics.rs:220-231`) and has two-direction redaction tests. |
| `PLAN-077/G4 development publication refusal` | already delivered | Current release records `developmentDomains` and refuses them on candidate/stable (`build/src/release-manifest.ts:194-207,220-242`). Tests cover malformed/empty markers and customer-channel refusal (`release-manifest.test.ts:124-142,186-203`). `make os-release-verify-test` exercises the shipped CLI. |
| `PLAN-077/G4 trust block and empty signingKeys refusal` | superseded | Current baked metadata rejects any `trust` object (`build/src/release-manifest.ts:203-204`; `verify/src/checks-file-root.ts:91-100`), because metadata anchors live in authenticated kernel policy. The release gate instead requires explicit public keys and authenticates current update/firmware envelopes. There is no `trust.signingKeys` reader (`docs/design/release-artifacts.md:97-108`). |
| `PLAN-077/G5` | already delivered | The current release CLI takes `--baked-meta`, and its executed fixture test passes that argument (`build/src/release-manifest.test.ts:164-178`; current user command at `docs/design/release-artifacts.md:78-95`). |
| `PLAN-077/G6` | already delivered | Current security, diagnostics, lifecycle, release-artifact and key-delivery docs describe the replacement contract and its limits (`docs/user/security.md:21-40`; `docs/design/diagnostics.md:68-83`; `docs/design/security-lifecycle.md:45-89`). Original RAUC wording is obsolete, but the documentation outcome is delivered. |
| `PLAN-077/G7 historical ceremony migration` | superseded | The proposed runbook generates RAUC/lode material, which current deployment does not consume. Current lifecycle assigns roles and separates software mechanism from production custody (`docs/design/security-lifecycle.md:1-39,145-155,157-182`), but the concrete production custody ceremony remains an unresolved operations choice below. |
| `PLAN-077/G8 mutable device-time rotation channel` | superseded | Current anchors rotate through separately authenticated kernel/firmware overlap and removal, with complete-image reflash when no accepted association remains (`docs/design/release-signing.md:47-65`; `docs/design/key-delivery.md:38-54`). No mutable STATE keyring or operator trust import is wanted under the current fresh-image development model. The old trigger does not hold unless product explicitly requires remote re-anchoring without an accepted signer or physical reflash. |

RFCT-305's acceptance is reconciled separately because its stale
`in_progress` status must not obscure what its historical evidence did and did
not prove:

| Acceptance ID | Classification | Current disposition |
|---|---|---|
| `RFCT-305/G1` | already delivered | Current staging still installs the mandatory public manifest and only nonempty `GENERATED` (`rootfs/build.sh:233-250`). Available gates are `make os-build-test` and `make os-verify-test`; historical direct-staging tests were green on 2026-09-04, but neither current gate was rerun here. |
| `RFCT-305/G2` | superseded | Current packed-root verification rejects anchors, private material and extra files (`verify/src/checks-file-root.ts:91-100`; negative test `checks-file-root.test.ts:32-42`), while release assembly explicitly does not prove extraction from an exact image (`docs/design/release-artifacts.md:72-76`). Available gate: `make os-verify-test`; not rerun here. Do not resurrect a host-tree compatibility verifier. |
| `RFCT-305/G3` | already delivered | Current code derives production/development/absent grades and tests all three (`pkgs/mosd/mosd/src/system_info.rs:266-313,1212-1295`); diagnostics allowlists the projection (`pkgs/mosd/apid/src/diagnostics.rs:220-231`). Available gate: `make os-rust-gate`; historical focused Rust tests were green, but the current gate was not rerun here. |
| `RFCT-305/G4 publication grade` | already delivered | Current release records development domains and refuses them on candidate/stable (`build/src/release-manifest.ts:194-207,220-242`), with cases in `build/src/release-manifest.test.ts:124-142,186-203`. Available gate: `make os-release-verify-test`; not rerun here. |
| `RFCT-305/G4 empty signingKeys` | superseded | Current baked metadata rejects any `trust` object (`build/src/release-manifest.ts:203-204`; `verify/src/checks-file-root.ts:91-100`) because anchors live in authenticated kernel policy (`docs/design/release-artifacts.md:97-108`). Available gates: `make os-build-test` and `make os-verify-test`; not rerun here. |
| `RFCT-305/G5` | already delivered | The current executable release fixture passes `--baked-meta` (`build/src/release-manifest.test.ts:164-178`), matching the current command contract (`docs/design/release-artifacts.md:78-95`). Available gate: `make os-release-verify-test`; not rerun here. |
| `RFCT-305/G6` | already delivered | Current user and lifecycle documentation carries the replacement security contract and limitations (`docs/user/security.md:21-40`; `docs/design/security-lifecycle.md:45-89`). Available gate: `make docs-verify`, run for this documentation unit. |
| `RFCT-305 software gates` | already delivered | The record reports 1268 verify tests, 889 build tests, 823 Rust tests, trust-domain/RAUC-negative/docs/release gates and direct staging green on 2026-09-04. Current corresponding entry points remain `make os-verify-test`, `make os-build-test`, `make os-rust-gate`, `make os-release-verify-test` and `make docs-verify`; only the docs gate was rerun here, so the numeric evidence is historical. |
| `RFCT-305 composed x64 image gate` | superseded | The record explicitly says it was not run. Current delivery separates software fixtures, complete-image verification and physical board proof (`docs/design/release-artifacts.md:154-179`; `docs/design/updates.md:107-117`). The available image gates belong to current delivery ownership and were not run here. Its absence is neither a pass nor an automatic current release blocker. |

Across the 65 atomic obligations above: **20 already delivered, 10
superseded, 20 valid implementation work, and 15 unresolved product
decisions**. Design approvals, mechanisms, software tests and board/power-cut
proof are intentionally counted separately.

## Dependency Slices

Only the following slices are valid implementation work. They are intentionally
smaller than a complete application manager or fleet service. Every future code
task must first merge the shared local `bkd/58sdocnk` into a clean branch and
must use TDD plus `pma-cr` review before claiming completion.

### Managed applications

`APP-INVENTORY` is a prerequisite from the current stage ordering, not a new
PLAN-069 promise. Write a minimal new
`pkgs/mosd/mos-appd/{Cargo.toml,src/lib.rs,src/registry.rs}` and add the member
to `pkgs/mosd/Cargo.toml`; read the shipped package manifest, discovered units
and `/mnt/data/state/mos/apps/`. It only classifies `System`, managed and
`External/unmanaged`, persists the stable registry, and exposes no activation.
Existing command: `make os-rust-gate`. Smallest RED: a discovered handwritten
unit remains observe-only and has no allowed mutation. Default: current schema
only, no migration and no network. No shared-path handoff is needed until
packaging the new binary/unit.

| Slice | Obligations and exact paths | Behavior, smallest RED and default | Existing gate / grant |
|---|---|---|---|
| `APP-TRUST` | `PLAN-069/SW container trust policy`; write `pkgs/mosd/mos-appd/src/{manifest.rs,trust.rs,oci.rs}` and their unit tests; read normalized catalog input, staged OCI content and `rootfs/overlay/etc/containers/policy.json`. | Verify the exact signed manifest/digest before staging and again before activation; generate a `Pull=never` runtime and never weaken the global unmanaged-container policy. RED: flip one staged byte after preflight and prove activation refuses it. Default: curated OCI only, one current schema, local input interface, no native/local-import/cloud transport. The signature-envelope and app-anchor choice below must land first. | `make os-rust-gate`. A build/signing handoff is required before adding an application anchor or changing `build/`, `rootfs/`, `verify/` or release publication. |
| `APP-ADMIT` | `PLAN-069/SW resource/device admission`; write `mos-appd/src/{admission.rs,runtime.rs}`; read the normalized manifest plus current storage, device, D-Bus, MQTT, port and unit ownership facts. | Reject missing CPU/memory/PID/I/O ceilings, undeclared capabilities/devices/paths and conflicts before runtime publication. RED: omit `MemoryMax` and prove no unit is published. Default: generate one namespaced systemd/Quadlet definition; `/mos`, `/srv` and `/mos/containers` remain byte/inode-unlimited, so storage uses capacity preflight/reservation accounting, never new project quotas. | `make os-rust-gate`; later packed-root coverage uses `make os-verify-test`. Packaging/rootfs edits require a path handoff. |
| `APP-SECRETS` | `PLAN-069/SW protected secret store`; write `mos-appd/src/secrets.rs` and later `apid/src/apps_api.rs`; read/write only `/mnt/data/state/mos/apps/<app-id>/secrets/` and generated systemd credential files. | API writes replace a named declared secret and return configured/missing status only; mode 0700 directory/0600 files; no value in reads, logs, tasks, audit or diagnostics. RED: plant the value in every output path and assert no returned/stored projection contains it. Default: no secret read endpoint, export, escrow or migration. | `make os-rust-gate`; API contract also `make os-apid-api-spec-pins`. No expensive grant; packaging handoff only when shipping the unit. |
| `APP-AUDIT` | `PLAN-069/SW audit projection`; write `mos-appd/src/{tasks.rs,activity.rs}` and the application route projection in `apid/src/apps_api.rs`; store a bounded append-only ring under `/mnt/data/state/mos/apps/activity/`. | Record stable task ID, operation, source, app/revision IDs, timestamps and structured outcome for install/update/activation/removal; never arguments, credentials or free text from untrusted bundles. RED: disconnect after `202` and prove the same task reaches one terminal recorded result. Default: local-only bounded projection, no upload. | `make os-rust-gate` and `make os-apid-api-spec-pins`. No expensive grant. |
| `APP-ROLLBACK` | `PLAN-069/SW health-gated rollback`; write `mos-appd/src/{health.rs,rollback.rs,gc.rs}`; read the active revision, retained last-known-good artifact and bounded health result; write only manager registry pointers and generated definitions. | Retain one last-known-good code artifact until the candidate health window closes; failure atomically restores it or leaves a stable `blocked` result. RED: candidate fails at the health deadline and active digest returns to the retained digest. Default: code rollback only; no data rollback or compatibility migration is claimed. | `make os-rust-gate`; a later runtime image test needs an explicit QEMU grant. No signing-path edit in this slice. |

The first dispatchable application order is `APP-INVENTORY`, then the local
parts of `APP-ADMIT`, `APP-SECRETS` and `APP-AUDIT`. `APP-TRUST` waits for the
small application-signing contract, and `APP-ROLLBACK` waits for admitted
activation. Optional integrator enrollment and native admission are not hidden
inside any of these slices.

### Fleet device work

| Slice | Obligations and exact paths | Behavior, smallest RED and default | Existing gate / grant |
|---|---|---|---|
| `FLEET-CONFIG` | `PLAN-072/C1 local`, `PLAN-076/B8`; write `pkgs/mosd/mosd-settings/src/configuration.rs` plus tests, then `pkgs/mosd/apid/src/fleet_api.rs`, `routes.rs`, `main.rs` and generated `apid/openapi.json`; read baked `/usr/share/mos/meta/updates/manifest.json` and `/mos/config/fleet.json`. | One strict `mos/fleet-config/v1` document with `enabled`, `reporting`, `url`; resolve through the existing configuration library; authenticated/CSRF mutation; malformed/anchor-shaped keys fail closed. RED: an override URL is effective, then disable immediately reports off without opening a client. Default: fleet off, URL null, reporting meaningful only under enabled; no backward reader. Credential erasure is added only after its wire contract names the credential. | `make os-rust-gate`, `make os-apid-api-spec-pins`; no expensive grant. Rootfs namespace/unit packaging later needs a handoff. |
| `FLEET-REPORT` | `PLAN-076/B1/B2`; write `pkgs/mosd/mosd/src/fleet_report.rs`, register exactly `GetFleetReport` in `mosd/src/bus.rs`, and narrow the grant in `pkgs/mosd/dist/com.mos.mosd.conf`; read current system/update/health/storage/telemetry/time/network observations. | Produce the approved fixed-key, maximum-16-KiB report and exclude all site values, hardware IDs, names and free text. RED pair: every planted secret/excluded diagnostics leaf is absent, and every benign approved leaf survives; a new dynamic health component changes only `unknownComponents`. Default: current schema only; no serialization negotiation or outbound action. | `make os-rust-gate` and `make os-dbus-policy-test`. No expensive grant. The D-Bus policy path is not a build/signing path but should stay one reviewed slice. |
| `FLEET-THERMAL` | `PLAN-076/B3`; write aggregation beside the current source in `pkgs/mosd/mosd/src/telemetry.rs` or a focused `fleet_thermal.rs`, read the existing bounded thermal observations, and feed `fleet_report.rs`. | Track min/max/last between report captures without changing the telemetry API. RED: a spike between two cadence boundaries appears as max even when first/last are lower. Default: reset the accumulator only after a report snapshot is committed. | `make os-rust-gate`; no expensive grant. |
| `FLEET-SCHEDULE` | `PLAN-076/B6`; after the wire interface exists, write `pkgs/mosd/fleetd/{Cargo.toml,src/schedule.rs}` and add the workspace member. | 900-second baked cadence, 60-second minimum, one coalesced early-send path for the approved transitions, jitter only on recovery. RED: a flapping health source schedules at most one send per 60 seconds. Default: deterministic injected clock/RNG in tests; the plane cannot set cadence. | `make os-rust-gate`; no expensive grant. Packaging `fleetd.service` requires a shared rootfs/build path handoff. |
| `FLEET-BUFFER` | `PLAN-076/B7`; write `pkgs/mosd/fleetd/src/{buffer.rs,counter.rs}`, read/write `/mos/fleet/{reports.log,counter,status.json}` only. | Buffer only after failed sends, cap at 128 records or 1 MiB, drop oldest with `gapReports`, reserve counters in windows of 64, and make steady-state success perform no flash write. RED: drive each cap independently and crash between reservation and send without reusing a counter. Default: mode 0700, one append-only rotated file, no configurable bounds; DATA/mos stays quota-unlimited. | `make os-rust-gate`; no expensive grant. |
| `FLEET-STATUS` | `PLAN-076/B9`; write `pkgs/mosd/apid/src/fleet_api.rs`, route/OpenAPI wiring and tests; read resolved config, `GetFleetReport` and `/mos/fleet/status.json`. | Authenticated status works while `fleetd` is stopped and reports baked/effective URLs separately; preview returns the same serializer output the client would send. RED: re-pointed/off device reports the new effective URL, default URL and zero activity; preview bytes equal the bus payload. | `make os-rust-gate` and `make os-apid-api-spec-pins`; no expensive grant. |
| `FLEET-CLIENT-SAFETY` | `PLAN-076/B10/B11`; after the missing wire contract, write `pkgs/mosd/fleetd/src/{client.rs,tls.rs}` and tests, plus `pkgs/mosd/dist/fleetd.service`. | Parse only HTTP outcome class and accepted counter; ignore/refuse every response instruction. Classify certificate-not-yet-valid against the trusted-clock floor separately from network failures; start after `sysinit.target`. RED: adversarial response carrying command/config/cadence/bundle URL changes nothing except an accepted counter; stale clock produces `clock` not `network`. Default: outbound HTTPS only and no connection when disabled. | `make os-rust-gate`; packed unit coverage later uses `make os-verify-test`. Service packaging needs a shared rootfs/build handoff. |
| `FLEET-CONSOLE` | `PLAN-072/C6`, `PLAN-076/B12`; after `FLEET-STATUS`, write `pkgs/mosd/apid/ui/src/features/fleet/` and add only the route/navigation wiring required by the existing SPA. | Display enabled/reporting, claim/registration state, effective and baked URLs, buffer, last send and structured error; do not enable cloud activity on render. RED: status says off with an override and the page renders off plus both distinct URLs. Default: no navigation until the API capability exists. | `(cd pkgs/mosd/apid/ui && bun run test)` and `make os-apid-ui-build-contract-test`; use `pma-web` for implementation. No QEMU grant for component tests. |
| `FLEET-AUTONOMY` | `PLAN-072/C4` and B8's off-state proof; add a focused phase under `pkgs/mosd/tests/apid-api/src/phases/` after all runtime slices. | With a configured hostname and fleet off, span boot plus more than one cadence: `fleetd` inactive, no DNS lookup/socket, and local authenticated API, update import/install policy, recovery and watchdog/health behavior remain available. Repeat with enabled plane unreachable and prove only reporting degrades. RED: fake resolver records one lookup of the configured host while off. Default: no lease or time-since-contact local consequence. | `make os-apid-api-test`; **requires a separately approved expensive QEMU grant** and clean shared harness. It is software/VM proof, not board power-cut proof. |
| `FLEET-DOC` | `PLAN-072/C7`, `PLAN-076/B13`; update only the current fleet sections after their mechanisms ship: `docs/design/{remote-management,security-model,security-lifecycle,diagnostics}.md`, user docs and governed Chinese mirrors. | Mark only the delivered subset, document destination/cadence/disclosure and preserve no-command/no-update-trigger/no-snapshot-upload rules. RED is not needed for docs; the implementation task records its code RED/GREEN separately. | `make docs-verify`. No expensive grant. |

No current fleet slice may be dispatched as an outbound client until the
registration/report wire choice exists. `FLEET-CONFIG`, `FLEET-REPORT`,
`FLEET-THERMAL` and `FLEET-BUFFER` are independently testable local work;
nevertheless the feature remains off and no daemon is packaged or started by
those library-only slices.

### Product and external-contract choices for L1

Each choice is intentionally bounded; none authorizes a new service by
implication.

1. **Fleet registration wire (`PLAN-072/C1/C2`).** Supply an external service
   owner/repository and fix: relative register/deregister paths; exact JSON
   envelope; HTTP status taxonomy; TOFU first-writer/release behavior; issued
   credential type, header/mTLS use, storage name, renewal, revocation and URL
   rebinding; and the read-only D-Bus method through which non-root `fleetd`
   obtains registration identity. Default if absent: keep C2/B5 blocked and
   fleet off; implement no mock cloud.
2. **Fleet report ingest (`PLAN-076/B5/B10`).** The payload fields are already
   fixed by PLAN-076. Still supply the relative batch path, maximum batch bytes,
   accepted-counter response, 4xx permanent-refusal codes and 429/5xx
   `Retry-After` treatment, bound to the registration credential. Default if
   absent: local report/preview tests only, no network client.
3. **External plane obligations.** Name the vendor-plane repository/operator,
   tenancy, retention, residency, capacity/SLO, incident/disaster-recovery
   owner, wrongly-claimed-ID release journey and open-source delivery. An
   integrator-hosted plane owns the same decisions for itself. Default: no
   plane work in this repository and no availability promise beyond device
   autonomy.
4. **NAT support/control channel.** Choose either to defer it and keep the
   product at outbound registration/reporting, or open a separate plan for a
   mutually authenticated persistent channel with a closed command vocabulary,
   authorization, audit, expiry and break-glass policy. Default: defer; never
   accrete commands onto reporting.
5. **Curated application signing.** Fix one current signed-application envelope,
   a distinct application-publisher public-anchor source, overlap/removal and
   revocation statement, and exact catalog input handed to `mos-appd`. The
   recommended default is a distinct Ed25519 application trust domain baked by
   authenticated system policy, not the OS metadata key, with no mutable
   operator anchor and no old schema reader. This touches shared signing/build
   paths and needs an L1 handoff before edit.
6. **Optional integrator enrollment.** Either defer stage 4 (recommended) or
   separately define who may enroll/remove/revoke an integrator key, its
   physical/authenticated ceremony and UI distinction from vendor catalog
   trust. It remains disabled by default; do not treat a writable key file as
   enrollment.
7. **Managed native admission.** Keep stage 3 deferred (recommended) until a
   non-root application identity and exact systemd sandbox profile are selected.
   During development only the current OS contract must be admitted; no
   backward OS/data migration reader is required. Do not turn current
   image-integrated native applications into independently managed bundles.
8. **Production key ceremony.** Current software accepts explicit production
   inputs but absence of `GENERATED` does not prove custody. Name the release
   owner and witness, file-media versus HSM/KMS holder, n-of-m policy, recorded
   public fingerprints, recovery material, minutes location and release-host
   hardening. Until selected, claims remain development/software evidence.
9. **Conditional device-time trust rotation.** The current bounded choice is
   immutable authenticated-kernel anchors with overlap/removal and complete
   reflash recovery. The historical G8 mutable STATE channel is not needed now.
   Reopen it only if product explicitly requires remote re-anchoring after all
   accepted signer associations are lost and physical reflash is unavailable.

### Shared-path and dependency handoff

- Application or fleet library/API work under `pkgs/mosd/` is independent of
  issue #313 until it changes packaging, images or release evidence.
- Adding app/fleet packages or units to `rootfs/`, build producers, `build/` or
  `verify/` requires an exact L1 path handoff first. Application signing also
  requires handoff for `pkgs/mos-boot/`, `pkgs/mos-deploy/`, release-signing and
  publication paths. Issue #313 currently owns changes across `build/`,
  `verify/`, `pkgs/mos-deploy/` and boards; future work must use approved commits
  rather than copying its uncommitted files.
- `FLEET-AUTONOMY` and app runtime/rollback image proof need a later expensive
  QEMU grant. Physical cx3576 watchdog, USB and storage power-cut evidence is a
  separate board gate and cannot be claimed by those runs.
- PLAN-070/071 and RFCT-315 matrices remain C1-owned. This classification uses
  only their current seam: anchors are not operator-writable and update policy
  stays independent of fleet. It does not duplicate or reopen those rows.

## Evidence Limits

- Baseline and classification HEAD were both
  `5c61f7fbb5589807e931e981b3ef8cb9bdff8b6d`. Local `main` advanced during
  final verification to `5d0dca577a782aa707d9530779c4b23f2a7eda31`, the S905X5M
  integration owned outside this unit. It was not merged. It changes shared
  build, verify, `mos-deploy` and board paths, so evidence about those delivery
  seams is stale relative to `main` and L2 must refresh it before dependent
  dispatch. The application/fleet absence and core `pkgs/mosd/` evidence remain
  classifications at the explicitly recorded HEAD, not claims about the newer
  commit.
- `jq -r '.paths | keys[]' pkgs/mosd/apid/openapi.json` contained no
  `/api/v1/apps`, `/api/v1/app-catalog` or `/api/v1/fleet` path. Focused `rg`
  found no `mos-appd` or `fleetd` crate/unit. These are absence observations,
  not runtime network traces.
- Existing current test entry points were inspected: `make os-rust-gate`,
  `make os-verify-test`, `make os-build-test`, `make os-release-verify-test`,
  `make os-apid-api-spec-pins`, `make os-apid-api-test`, and the UI package's
  `bun run test`. None was run in this docs-only audit except the required docs
  gate recorded in the task.
- RFCT-305's software counts and direct-staging checks are historical
  2026-09-04 evidence. Its unrun composed-image gate proves no failure and no
  pass. Current release fixtures verify signed update/firmware objects and
  publication refusals; arbitrary factory-image bytes and physical boot remain
  separate (`docs/design/release-artifacts.md:154-179`).
- Device `trust.grade` is provenance derived from a public manifest plus marker,
  not attestation of active firmware enforcement, production custody or board
  qualification (`docs/design/diagnostics.md:68-83`). Diagnostics projects it
  through a fail-closed allowlist and does not upload it.
- SYSTEM is the 1-GiB final two-deployment store; acquisition is under
  `/mos/updates` on DATA (`docs/design/storage.md:39-54`). `/mos`, `/srv` and
  `/mos/containers` have unlimited byte/inode quotas, while `/var` is bounded
  (`storage.md:56-71`). Proposed buffers/staging preserve those facts.
- No image, Rust/Bun matrix, QEMU guest, physical board or power-cut test was
  run. No credential, secret or production key was read.

## Risks

- Historical status markers may be stale and are not treated as delivery
  evidence.
- External fleet service contracts and physical board evidence may be absent
  from the allowed repository scope.
- Shared build and signing paths remain read-only in this unit.

## Scope

- Historical obligations: PLAN-054, PLAN-069, PLAN-072, PLAN-076, PLAN-077,
  and RFCT-305.
- Current evidence: only the read-only paths enumerated in the dispatch.
- Writes: this task record, this plan record, and their two index rows only.

## Alternatives

- Treat plan status as implementation evidence: rejected because current
  contracts, code, and tests are authoritative.
- Reconstruct a speculative fleet manager or external plane: rejected because
  missing service contracts require a product decision, not invention.

## Annotations

- Compatibility readers and migrations are intentionally out of scope during
  system development unless explicitly requested.
- The classification is preapproved; no additional proposal gate is required.
