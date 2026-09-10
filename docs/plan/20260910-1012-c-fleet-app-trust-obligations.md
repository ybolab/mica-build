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

The first review amendment preserves that evidence baseline and the completed
classification. For its scheduling conclusions only, it synchronizes local
workstream C through `fa51970ca32c2a7d16f809134e78d249c0a1f897` (including
approved source `5d0dca577a782aa707d9530779c4b23f2a7eda31`) in merge commit
`0f81c0ce5d501dec41b2a3170ad6b6f9f6b99c52`, then refreshes only the existing
local configuration/status call chain. It does not relabel the original matrix
as evidence collected at the synchronized HEAD.

## Proposal

Record an obligation-level classification with current file-and-line evidence,
test limitations, implementation-ready dependency slices, shared-path needs,
and bounded product choices for the parent workstream.

## Obligation Matrix

The classifications below are obligation classifications, not status-field
translations. `already delivered` may mean an approved design decision rather
than a shipped mechanism; the evidence column says which. `valid
implementation work` means the historical contract remains valid, not that it
is authorized or dispatchable in this campaign; the amendment below applies
that separate test. For a design-only delivered decision or a superseded
product clause, the available repository gate is `make docs-verify`; there is
no software behavior to test unless the row names a current mechanism and its
stronger gate.

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

## Campaign Disposition Amendment (2026-09-10)

The matrix above classifies **historical contract validity**. It does not grant
twenty implementation tasks. The campaign needs a second property:
**dispatchability now**, which requires an approved consumer, a complete input
and output contract, an integrated call chain, owned paths and the applicable
dependency already merged. On that test, this amendment finds **zero presently
dispatchable application/fleet slices**. This is a scheduling conclusion, not a
change to any of the 65 classifications.

The 20 delivered rows also have different proof grades: eight are delivered
design approvals (`PLAN-054/COND-product`, Q1, Q4–Q7, registration architecture
and selected-registration security), ten are delivered software mechanisms or
software-test acceptances (`PLAN-076/B4`; PLAN-077 G1, G3, publication G4 and
G5; RFCT-305 G1, G3, publication G4, G5 and software gates), and two are
delivered documentation outcomes (PLAN-077/G6 and RFCT-305/G6). None of those
categories implies physical board, power-cut or production-key-custody proof.

### Historical candidates and this campaign

The table maps every one of the 20 historically valid implementation rows. A
candidate named here is not a new obligation or authorization.

| Candidate | Historical obligation IDs | Campaign disposition | Reason or next dependency |
|---|---|---|---|
| `APP-INVENTORY` | prerequisite only; not one of the 20 | deferred | No approved inventory caller, mutation consumer or persistent registry owner exists. Do not create a new crate or registry merely to classify hypothetical records. |
| `APP-TRUST` | `PLAN-069/SW container trust policy` | decision proposal only | Decision brief B must first approve the local catalog bytes, independent publisher anchor and actual verifier/activation callers. It also needs a new shared signing/rootfs handoff. |
| `APP-ADMIT` | `PLAN-069/SW resource/device admission` | deferred | It has no approved activation consumer. Dispatch only after `APP-TRUST` and a concrete managed-OCI activation entry point; do not create an admission library in isolation. |
| `APP-SECRETS` | `PLAN-069/SW protected secret store` | deferred | No managed runtime or authenticated application mutation consumes a secret. A store or API without that consumer would be a new credential surface, not a bounded slice. |
| `APP-AUDIT` | `PLAN-069/SW audit projection` | deferred | There are no application operations producing durable tasks. Do not create a consumerless ring, route or daemon. |
| `APP-ROLLBACK` | `PLAN-069/SW health-gated rollback` | deferred | It depends on an admitted activation, retained artifact and real health gate; runtime image proof would later need an expensive QEMU grant. |
| `FLEET-CONFIG` | `PLAN-072/C1 local config and off transition`; `PLAN-076/B8` | conditional backend proposal; not dispatchable now | The only concrete consumer is the existing provisioning-status projection described below. Any revision of its route, handler or projection waits for C.D5 (`g4if0wrb`) to be reviewed and merged into local `bkd/58sdocnk`, then needs a fresh scoped approval. |
| `FLEET-REPORT` | `PLAN-076/B1`, `PLAN-076/B2` | deferred | The field allowlist is historically approved, but there is no existing report caller, preview or sender. A new `GetFleetReport` library/bus member by itself is consumerless. |
| `FLEET-THERMAL` | `PLAN-076/B3` | deferred | Window aggregation has no report consumer until `FLEET-REPORT` has an approved integrated caller. |
| `FLEET-SCHEDULE` | `PLAN-076/B6` | deferred | There is no approved client or sender to schedule; do not create `fleetd` or a timer first. |
| `FLEET-BUFFER` | `PLAN-076/B7` | deferred | `/mos/fleet` persistence is justified only by failed sends, but no sender, accepted-counter envelope or retry contract exists. Do not create a buffer first. |
| `FLEET-STATUS` | `PLAN-076/B9` | deferred | Real registration/report activity sources do not exist. Desired `enabled=true` must never be projected as registered, connected or reporting. |
| `FLEET-CLIENT-SAFETY` | `PLAN-076/B10`, `PLAN-076/B11` | decision-dependent and deferred | It needs decision brief A's user-specified existing plane, credentials, wire envelopes and retry semantics plus separate network/runtime/packaging authorization. |
| `FLEET-CONSOLE` | `PLAN-072/C6`, `PLAN-076/B12` | campaign-excluded | Both rows remain historically valid, but this campaign excludes UI work. They are removed from the executable chain, not reclassified. |
| `FLEET-AUTONOMY` | `PLAN-072/C4` | deferred proof | There is no fleet runtime to disconnect. A later end-to-end runtime proof needs a separately approved QEMU grant and remains distinct from board/power-cut proof. |
| `FLEET-DOC` | `PLAN-072/C7`, `PLAN-076/B13` | deferred | Current docs correctly say the features are absent. Update them only after a mechanism ships. |

Selected managed application work remains the local vendor-curated OCI case.
Optional integrator enrollment remains a later off-by-default capability;
managed native admission remains later pending its non-root identity and sandbox;
external catalog/cloud/plane contracts are outside this repository. No entry in
the table turns those later scopes into implementation work.

### Conditional `FLEET-CONFIG` integrated chain

This is the only bounded next proposal because it reuses a current caller. It
is **not dispatchable at this amendment's HEAD** and it does not implement
registration or enable network activity.

1. **Entry and input.** The established offline pour lets an integrator write
   `/mos/config/*.json` while the device is stopped; mosd validates those files
   on the next boot (`docs/design/provisioning.md:301-346`). The candidate input
   is exactly `/mos/config/fleet.json`, mode `0600` inside the existing `0700`
   namespace, with this current-only strict schema:

   ```json
   {
     "schema": "mos/fleet-config/v1",
     "enabled": true,
     "reporting": false,
     "url": "https://fleet.example.invalid"
   }
   ```

   The object requires `schema`, which must equal the shown tag; `enabled`,
   `reporting` and `url` are optional overlay keys; `enabled`/`reporting` are
   booleans and `url` is HTTPS or `null`; additional properties and any
   anchor-shaped key are load errors. No compatibility reader or migration
   exists. The historical three values are `enabled`, `reporting` and `url`;
   `schema` is the namespace's existing per-document framing rule
   (`PLAN-070.md:1324-1359`). Absent or `null` URL selects the baked default;
   absent `enabled` selects the baked default; absent `reporting` defaults on
   only when effective `enabled` is on. Reporting is always effectively off
   when fleet is off, and the operator projection includes only overlay keys
   actually present.
2. **Read and resolution.** The baked defaults come from
   `/usr/share/mos/meta/updates/manifest.json`; synchronized source still has
   code defaults `enabled=false`, `url=null`
   (`pkgs/mosd/mosd-settings/src/configuration.rs:223-267`). The conditional
   change extends the one existing resolver in that file to read
   `/mos/config/fleet.json`; it must not introduce a second configuration
   reader. The document is unique because fleet desired configuration must
   survive reboot and A/B, remain separate from `updates.json` and from a future
   STATE credential, and inherit the existing reset discipline. The only write
   in this slice is the already-approved offline pour; there is no new runtime
   writer, route or credential file.
3. **Existing caller and observable behavior.** The authenticated
   `GET /api/v1/provisioning/status` route is mounted in
   `pkgs/mosd/apid/src/routes.rs:711-716`; its handler calls
   `configuration::provisioning_status_at` and returns its `operator` and
   `effective` values (`pkgs/mosd/apid/src/provisioning_api.rs:199-288`). The
   current resolver says the fleet document does not exist and emits only baked
   values (`pkgs/mosd/mosd-settings/src/configuration.rs:1187-1270`). The
   proposal ends that chain with the exact desired operator/effective fleet
   projection. It must expose no `registered`, `connected`, `lastReport` or
   other activity member and must open no socket; `enabled=true` is desired
   configuration, not evidence of registration.
4. **RED, GREEN and ownership.** The smallest RED is a resolver/status test with
   baked off/null plus the shown poured document: it must return the raw
   operator values and effective URL/switches, then reject a trust-anchor key,
   while the response contains no activity state. The GREEN commands are
   `make os-rust-gate` and `make os-apid-api-spec-pins`. Expected write paths
   are limited to `pkgs/mosd/mosd-settings/src/configuration.rs` and its tests,
   plus the existing provisioning handler/test/OpenAPI projection only if the
   merged C.D5 interface requires them. There is no new crate, daemon, buffer,
   UI, rootfs/build/signing path or expensive resource. C.D5 must be reviewed
   and merged into local `bkd/58sdocnk` before the implementing L3 is created;
   that L3 must first merge the resulting shared local commit into a clean
   branch and revalidate the call signature.

### Decision brief A — fleet

**Decision requested:** name the user-specified existing plane to integrate, or
defer the client for this campaign. The recommendation in the absence of that
input is defer. This brief does not choose or implement a service, endpoint,
credential, mock plane or outbound connection.

Established approvals are not questions: vendor-operated by default,
integrator-operated open-source deployment optional, with an effective
per-device URL (`PLAN-072.md:335-346`); the plane assists and never gates local
execution (`PLAN-072.md:348-355`); zero-touch TOFU uses `deviceId`, with visible
refusal and an operator release path for a wrongly claimed ID
(`PLAN-072.md:357-379`); serial and MAC are excluded
(`PLAN-072.md:381-385`). Registration sends only `deviceId`, board, profile,
version and baked product labels over outbound HTTPS, with no inbound port
(`PLAN-072.md:146-163`). Reports carry the fixed envelope and allowlisted state
at `PLAN-076.md:141-173`, batch as an array, deduplicate by
`(deviceId,counter)`, accept 2xx, retry 429/5xx and permanently refuse selected
4xx (`PLAN-076.md:585-618`). Responses are one-way and may change no local
state except acknowledgement of an accepted counter
(`PLAN-076.md:623-655`). Fleet remains off/null by default.

The minimum missing contract is:

- owner and repository of the existing plane;
- exact relative register, deregister and batch-report paths, plus request and
  response JSON envelopes;
- issued credential type, presentation, STATE filename and modes, renewal,
  revocation and URL-rebind deletion behavior, plus first-writer TOFU conflict
  and the concrete operator release response;
- the accepted-counter field/type, permanent-4xx code mapping, maximum batch,
  and exact `Retry-After` parsing/clamping behavior for 429/5xx.

Until all four are supplied and separately approved, registration, reporting,
buffering, scheduling, status activity and every network client stay deferred;
local configuration must not fabricate connection state. NAT-safe support and
any bidirectional control channel require a separate plan. Plane tenancy,
retention, residency, SLO and operations remain external-owner contracts, not
device blockers.

### Decision brief B — curated OCI

**Decision requested:** approve a pure local catalog input plus an independent
application-publisher trust contract, or defer managed activation. The
recommended proposal below uses a baked Ed25519 application trust domain,
never an OS metadata key and never a mutable operator anchor. Every path,
caller and format in this subsection is **proposed, absent and unauthorized**;
it is a reviewable contract example, not implementation.

Candidate paths keep acquisition outside the 1-GiB SYSTEM deployment store:

```text
/usr/share/mos/app-trust/trust.json
/mos/apps/catalog/inbox/<catalog-sha256>/catalog.json
/mos/apps/catalog/inbox/<catalog-sha256>/catalog.sig.json
/mos/apps/catalog/inbox/<catalog-sha256>/artifacts/sha256/<artifact-sha256>.oci
```

`trust.json` is immutable authenticated-image policy. Its proposed current
document is:

```json
{
  "schema": "mos/app-trust/v1",
  "keys": [{
    "keyId": "vendor-apps-2026-01",
    "algorithm": "Ed25519",
    "publicKey": "base64:<32-byte-ed25519-public-key>"
  }],
  "revokedKeyIds": [],
  "revokedReleaseDigests": []
}
```

The catalog is local DATA input and names only exact local artifact digests; it
implies no registry or cloud fetch. DATA remains quota-unlimited for `/mos`,
with bounded preflight and garbage collection required before any future
staging work.

A minimal candidate `catalog.json` document is:

```json
{
  "schema": "mos/app-catalog/v1",
  "catalogVersion": 1,
  "releases": [{
    "appId": "com.example.sensor",
    "displayName": "Example Sensor",
    "vendor": "Example",
    "version": "1.0.0",
    "releaseNotes": "Initial local release",
    "artifact": {
      "kind": "oci",
      "digest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "sizeBytes": 1048576
    },
    "compatibility": {
      "architecture": "amd64",
      "boards": ["x64"],
      "profiles": ["dev"],
      "mosApi": "1"
    },
    "interfaces": {"ports": [], "devices": [], "mounts": []},
    "storage": {"volumes": [], "reservedBytes": 0, "dataSchema": "1"},
    "secrets": [],
    "resources": {
      "cpuQuotaPercent": 50,
      "memoryMaxBytes": 134217728,
      "pidsMax": 64,
      "capabilities": []
    },
    "runtime": {
      "entrypoint": ["/app/sensor"],
      "restart": "on-failure",
      "healthcheck": ["/app/sensor", "--health"]
    },
    "update": {
      "codeRollback": true,
      "dataRollback": false,
      "lastKnownGood": true
    },
    "supplyChain": {
      "license": "Apache-2.0",
      "sbomDigest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "revocationId": "com.example.sensor/1.0.0"
    }
  }]
}
```

`catalog.sig.json` has exactly `schema`, `keyId`, `algorithm`,
`catalogDigest` and `signature`. Its example is:

```json
{
  "schema": "mos/app-catalog-signature/v1",
  "keyId": "vendor-apps-2026-01",
  "algorithm": "Ed25519",
  "catalogDigest": "sha256:89644a4a1ffc987944b529493b45691797fe151757b96ab4540ffeeb5b70c39e",
  "signature": "base64:<64-byte-ed25519-signature>"
}
```

The verifier computes SHA-256 over the exact raw `catalog.json` bytes and
requires `catalogDigest` to match; `algorithm` must be exactly `Ed25519`.
Ed25519 signs these exact UTF-8 bytes, including the final newline:

```text
mos-app-catalog-signature/v1
keyId=vendor-apps-2026-01
catalogDigest=sha256:89644a4a1ffc987944b529493b45691797fe151757b96ab4540ffeeb5b70c39e
```

The domain line, key ID and raw-file digest are therefore covered directly;
every catalog field and exact OCI digest is covered transitively by the raw
file digest. Unknown schema, duplicate release identity, unknown/revoked key,
revoked release digest, malformed signature, digest/size mismatch, mutable OCI
reference or missing required admission field fails closed with no bypass.

Key rotation is image-owned: image N contains old and new application keys and
new catalogs use the new key; image N+1 removes the old key only after no
supported current catalog depends on it. Revocation is a new authenticated
image containing `revokedKeyIds` or `revokedReleaseDigests`. Every future
preflight and activation must reverify against the current image policy; a
revoked or removed association blocks activation and leaves data untouched,
with no unsigned fallback. Development recovery remains flashing the newest
image; there is no old-schema reader or mutable rotation channel.

The required consumers do not exist. The existing design names proposed
`mos-appd` as lifecycle owner (`docs/design/applications.md:124-154`), so a
separately approved `mos-appd` local-import/preflight caller must verify before
content enters managed staging, and its separately approved privileged
activation caller must reverify the catalog, signature, trust policy and staged
OCI bytes before publishing runtime state. Both callers and the local input
producer are absent; no HTTP route is implied. Adding the baked anchor or any
signing/publication tooling needs a new exact L1 handoff for shared
rootfs/build/verify/release-signing paths; C.D2/C.D3/C.D4 do not grant it.
Optional integrator enrollment remains off and separately designed, native
admission remains later, and public catalog/fleet rollout remain outside this
choice.

### Shared-path and conditional boundaries

- No new application/fleet signing, rootfs, build, verify, packaging or release
  publication edit is authorized. Issue #313's approved artifacts remain
  precommit dirty-stamped, source-equivalent and hardware-unqualified with
  `BOARD_RELEASE_TARGET=0`; this amendment adds no image or board evidence.
- Current storage stays unchanged: `/mos`, `/srv` and `/mos/containers` have
  zero byte/inode limits, `/var` is bounded, and container storage/tmp remains
  inside its independent private bind so reset traversal does not acquire child
  mounts (`docs/design/storage.md:30-32,56-71`;
  `docs/design/containers.md:203-219`).
- Development recovery is fresh newest-image flashing. No compatibility reader,
  migration, old update package/raw-slot path, RAUC/TUF restoration or lode OS
  updater is introduced. PLAN-037 is not an executable task, and PLAN-086 S5's
  general tool reduction remains rejected.
- Production key custody ceremony remains an operational decision, not a
  blocker for the shipped development/software mechanisms. The historical
  mutable device-time trust rotation remains conditional only if product later
  requires remote re-anchoring after all accepted associations are lost and
  physical reflash is unavailable.
- `FLEET-AUTONOMY` and application runtime/rollback image proof require a later
  expensive QEMU grant. Physical watchdog, USB and storage power-cut evidence
  remains a separate board gate.
- PLAN-070/071 and RFCT-315 matrices remain C1-owned. This amendment refers only
  to their merged configuration seam and does not duplicate their matrix.

## Evidence Limits

- Baseline and original classification HEAD were both
  `5c61f7fbb5589807e931e981b3ef8cb9bdff8b6d`. The first amendment merged local
  workstream C through `fa51970ca32c2a7d16f809134e78d249c0a1f897`, which
  contains approved S905X5M source
  `5d0dca577a782aa707d9530779c4b23f2a7eda31`, as merge commit
  `0f81c0ce5d501dec41b2a3170ad6b6f9f6b99c52`. Only the local
  configuration/provisioning-status chain and scheduling dependencies were
  refreshed at that synchronized HEAD. The remaining 65-row file evidence is
  still explicitly baseline-specific and is not represented as a full current
  source re-audit.
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
