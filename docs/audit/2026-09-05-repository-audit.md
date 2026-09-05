# Repository Audit and Code–Documentation Consistency Review

## Repository Audit Summary

- Audit date: 2026-09-05 (UTC).
- Repository: `mos`.
- Repository HEAD when this report was written: `7453668aaf1362edad8dcb5aaac9514dd4e427bf`.
- Original audit verdict: **WARNING**.
- Repair review verdict: **PASS within the repository verification scope**.
- Finding status: A01-A08 resolved; D01-D09 reconciled or confirmed already corrected. See the resolution record below.
- Development policy: backward compatibility is not an acceptance requirement unless explicitly requested. Recommendations do not require compatibility adapters or preservation of superseded contracts.

The review covered repository-owned Rust services, the management API and SPA,
MQTT integration, device update tooling, the update server, image assembly and
verification, rootfs and systemd configuration, and English/Chinese documentation.
It combined static inspection, contract comparison, existing quality gates, and
three isolated reproductions against production handlers and persistence code.

Four P1 findings require priority fixes. Four additional P2 code or gate findings
and the documentation discrepancies below also need attention. Existing test
success does not establish correctness across the affected component boundaries.

No tracked source was changed during the audit. Reproduction fixtures and command
output were written under `_out/audit-20260905T131122Z/`; this report is the requested
persistent deliverable. No commit or push was performed.

## Resolution Record — 2026-09-05

The user authorized fixes in this report. [PLAN-081](../plan/PLAN-081.md) and
[RFCT-330](../task/RFCT-330.md) track the repair. The findings and original test
results below remain an audit record, not a list of defects still open. The HEAD
above records the report-writing baseline; D03-D05 were already corrected when
repair work began, and those corrections were retained and checked against code.

### Code and integration findings

| ID | Resolution | Regression or acceptance evidence |
| --- | --- | --- |
| A01 | Login captures the session credential generation before reading access settings. Session issuance checks that generation under the same lock used by password-change and recovery invalidation. | [Concurrent rotation regression](../../pkgs/mosd/apid/src/tests/credential_rotation.rs): old-password login first failed the new assertion, then returned 401 after the fix; a new-password login remained usable. |
| A02 | [Settings transactions](../../pkgs/mosd/mosd-settings/src/transaction.rs) persist a private undo journal before replacing DATA and STATE documents. Failed saves restore prior files; startup recovers pending saves before loading; blocked recovery refuses further use. | The import failure regression now preserves disk and memory. Fault injection before and after each replacement, restart recovery, refused recovery, invalid journal names, and journal permissions pass. Unchanged and deliberately preserved invalid documents retain their bytes and inodes. |
| A03 | The UI sends JSON `{}` when installing a staged bundle. Handler documentation and the generated OpenAPI description now match extraction behavior. | [UI request test](../../pkgs/mosd/apid/ui/src/features/system/update-actions.test.tsx) checks body and content type. [Real API tests](../../pkgs/mosd/apid/src/tests/update_api.rs) accept `{}` with a staged bundle and refuse missing or invalid inputs. |
| A04 | DATA initialization creates `/mos/diagnostics` at 0700. [apid.service](../../pkgs/mosd/dist/apid.service) grants only that additional DATA directory write access. | DATA layout regression passes. An isolated systemd probe using the service's filesystem restrictions fails with the old allowlist (`Read-only file system`) and passes snapshot creation, reading, and deletion with the new allowlist; writing another DATA path remains denied. |
| A05 | [Update queries](../../pkgs/mosd/apid/ui/src/features/system/system-page.tsx) poll every second while checking, downloading, or installing; action controls remain disabled during the server operation. | Fake-clock regression observes the final state without a manual refresh, verifies controls follow operation state, and verifies polling stops after completion. |
| A06 | [The shared query client](../../pkgs/mosd/apid/ui/src/app/query-client.ts) handles query and mutation 401 errors by cancelling queries, clearing protected cached data, and returning the session to unauthenticated. Fetch and upload failures discard the old CSRF token. | [Provider tests](../../pkgs/mosd/apid/ui/src/app/providers.test.tsx) cover expired reads and rejected logout, retaining authentication on HTTP 503. [HTTP tests](../../pkgs/mosd/apid/ui/src/lib/api.test.ts) cover fetch and non-JSON upload 401 responses. |
| A07 | The bridge reads optional private JSON credentials from `/var/lib/mos/mqttd-credentials.json`, validates them without echoing contents, and applies them to its MQTT connection. Provisioning and ownership are documented in both bus guides. | [Broker integration test](../../pkgs/mosd/broker/src/main.rs) uses the bridge's production connection options against the actual authenticated broker. It failed before the fix and now completes the authenticated handshake. Missing-file anonymous operation and invalid/private-file checks pass. |
| A08 | Package-pool preflight now runs before OpenSSL container resolution, preserving the intended offline stale-stamp refusal. | `make os-deb-preflight-test`: 25/25 passed, including rejecting and restored-baseline cases. |

The settings transaction guarantees the store's committed or recovered view.
Independent raw-file readers may observe intermediate renames. Hardware power-cut
behavior is separate from deterministic filesystem-failure and recovery tests.

### Documentation and CI

| IDs / area | Resolution |
| --- | --- |
| D01-D02 | English and Chinese storage, configuration, and update guidance distinguish DATA configuration from STATE identity and describe shipped offline channels alongside live API writes. |
| D03-D05 | Existing corrections for automatic update modes, DATA's `updates.json`, and baked signing keys were verified and retained. The remaining false claim of no automated update tests was removed. |
| D06 | Provisioning and first-run guidance describe the undo journal, recovery requirement, and boundaries of atomic visibility. |
| D07-D09 | README describes the x64 kernel build; current mosd notes describe independently versioned documents and eight reconcilers; the build harness describes the pinned Rust container. |
| Diagnostics | The diagnostics design now states boot-time directory creation, mode 0700, and the service write exception. |
| Missing CI checks | The workflow runs package-preflight and DATA layout checks, and a new job runs the update-server quality gate and dependency audit in the pinned Bun container. The root-owned DATA test uses root on CI. |
| CI integration regression | A clean container exposed runtime-dependent import classification in update-server lint. Its lint command now always uses Bun, and four imports follow that runtime's ordering. Container commands also carry the repository's required build-side declarations. |
| Compatibility policy | The base-branch API-breaking-change gate was removed. Generated OpenAPI equality and the shipped `--openapi` flag check remain. Current API guides state that backward compatibility is required only when explicitly requested; historical versioning proposals are labelled accordingly. |

### Repair verification

| Area | Result |
| --- | --- |
| mosd Rust workspace | `hack/check.sh` in the pinned Rust gate image: format, Clippy with warnings denied, **1,047 tests**, documentation tests, and dependency checks passed. The initial generated-spec mismatch was corrected by regeneration before this passing run. |
| Management SPA | Lint, type checking, **149 tests**, and coverage checks passed. The production build passed for the same implementation; the final three added cases change tests only. |
| Build tooling | `make os-build-test`: **920/920 passed**. |
| Image verification and API contracts | `make os-verify-test`: **1,279/1,279 passed**; layout, OpenAPI pins, and UI build contract checks passed. |
| Offline gates | Shell/toolchain lint, its negative fixtures, rootfs manifests, **25/25 package-preflight tests**, and DATA layout checks passed. |
| Update server CI command | Frozen dependency install, lint, type checking, **36 tests / 257 assertions**, coverage, standalone compilation, and dependency audit passed in a clean pinned Bun container. |
| Diagnostics sandbox | Old allowlist: expected failure. Fixed allowlist: creation/read/deletion succeeded, and an unrelated DATA path remained read-only. |
| Documentation | Index, link, status, translation coverage, board dossier checks and their negative fixtures passed, including the updated report and tracking documents. |
| Unchanged rauc-sign workspace | The original audit's 62-test gate remains the evidence; this repair changed no source or dependencies in that workspace. |

Repair command output and exit statuses are retained in
[`_out/audit-fixes-20260905/`](../../_out/audit-fixes-20260905/results.tsv).
Individual evidence includes [Rust](../../_out/audit-fixes-20260905/rust-final.log),
[UI](../../_out/audit-fixes-20260905/ui-final.log),
[offline](../../_out/audit-fixes-20260905/offline-final.log),
[update-server CI](../../_out/audit-fixes-20260905/update-server-final.log), and
[sandbox](../../_out/audit-fixes-20260905/sandbox-final.log) logs. Earlier nonzero
entries record expected RED regressions or intermediate integration failures;
they are not overwritten by later success. These artifacts are ignored and local.

### Remaining acceptance limits

No board image was rebuilt, flashed, or booted for this repair. The sandbox probe
uses systemd with the shipped service restrictions, substitutes a filesystem
probe for the daemon command, and supplies isolated tmpfs mounts instead of real
board storage; it does not establish end-to-end HTTP diagnostics on a board.
Real power cuts, QEMU image acceptance, physical recovery and USB provisioning,
and continuous device MQTT/real-browser operation remain deployment acceptance.
The intentionally deferred new update-server device reader in PLAN-079 remains
outside this repair. No compatibility adapter was added.

A concurrent edit in `verify/src/checks-update.ts` was preserved and is not part
of this repair's implementation. No commit or push was performed.

## Original Findings and Audit Evidence

The following sections preserve the pre-repair findings, priorities, test
results, coverage gaps, and recommended actions. Use the resolution record above
for current status.

## P0

No confirmed P0 finding was identified within the reviewed and exercised scope.
This is not a claim that hardware, power-loss behavior, or the complete deployed
system has passed acceptance.

## P1

### A01 — An old-password login can mint a valid session after password rotation

**Evidence: reproduced with a controlled concurrent request.**

The login handler reads the access settings, verifies the captured password hash
on a blocking task, and then creates a session. Password rotation writes the new
credential and removes other existing sessions, but it does not synchronize with
in-flight logins or revalidate their credential generation before session creation.

A request that captured the old hash can therefore finish after password rotation
has completed and obtain a new administrator session. The reproduction paused the
login's settings read, completed a real password-change request, then resumed the
login. A protected request using its resulting cookie returned `200`, where the
regression assertion expected `401`.

This requires knowledge of the previous password and a request overlapping its
rotation; it is not an unauthenticated password bypass.

- [Login: settings read, password verification, and session creation](../../pkgs/mosd/apid/src/routes.rs#L923).
- [Password persistence and session invalidation](../../pkgs/mosd/apid/src/routes.rs#L6773).
- [Reproduction output](../../_out/audit-20260905T131122Z/repro-verified.log).

**Recommended correction:** make credential updates and session issuance share a
consistent generation check or synchronization boundary. Retain a regression that
proves an old credential cannot create a usable session after rotation completes.

### A02 — A failed provisioning import can leave partially updated configuration

**Evidence: reproduced with a deterministic persistence failure.**

`Store::save` writes seven configuration documents in sequence and writes STATE
last. Each document is individually atomic, but the operation is not a transaction
across documents. The importer changes its in-memory settings only after the entire
save succeeds.

If a later write fails, previously written configuration documents remain changed
while the caller retains the old in-memory tree. The reproduction made the STATE
parent unwritable by representing it as a regular file: import returned an error,
but `time.json` already contained the imported value. A subsequent load can observe
configuration that the import reported as unsuccessful.

The provisioning design still promises one atomic commit point and no mixture of
old and new settings. The persistence code explicitly documents the opposite
cross-document behavior.

- [Document write order and lack of a cross-document transaction](../../pkgs/mosd/mosd-settings/src/store.rs#L439).
- [Import: clone, save, then replace the in-memory tree](../../pkgs/mosd/mosd/src/provisioning_doc.rs#L425).
- [Whole-import atomicity promise](../design/provisioning.md#L431).
- [Reproduction output](../../_out/audit-20260905T131122Z/repro-verified.log).

**Recommended correction:** provide a recoverable commit protocol for the whole
import, including the applied marker, so startup cannot consume an unsuccessful
partial application. Test failures between document writes and during STATE
persistence; checking only the caller's memory is insufficient.

### A03 — The built-in update installation action sends an invalid request

**Evidence: reproduced against the actual API router with a staged bundle.**

The UI uses the same bodyless POST request for check, fetch, and install. The install
handler requires a JSON body; installing the already staged bundle requires `{}`.
An empty request is rejected during extraction before the installation operation
can run.

The reproduction provided a valid credential and staged bundle, sent the request
shape used by the UI, and received `400` instead of `202`. The built-in install
button therefore cannot perform the normal staged-bundle operation.

- [UI update action request](../../pkgs/mosd/apid/ui/src/features/system/system-page.tsx#L134).
- [Required JSON extraction](../../pkgs/mosd/apid/src/update_api.rs#L235).
- [Reproduction output](../../_out/audit-20260905T131122Z/repro-verified.log).

**Recommended correction:** send the required JSON for installation and align the
handler description with the actual contract. Add coverage across the UI request
shape and real API validation, rather than testing each side only against mocks.

### A04 — The shipped service sandbox prevents diagnostics snapshot writes

**Evidence: confirmed by service configuration and write-path inspection; not
reproduced on a booted board.**

The production diagnostics store uses `/mos/diagnostics`. Publishing creates that
directory and writes a staging file there. `apid.service` enables
`ProtectSystem=strict` and grants the DATA namespace write access only at `/mos/ui`.
Its other writable exceptions cover `/var/lib/mos/apid` and `/run/mos`, not the
diagnostics directory.

Under the shipped service configuration, snapshot creation reaches an unwritable
path and fails through the `diagnostics_io` response. Creating the directory ahead
of time alone does not resolve the missing write exception.

- [Service filesystem restrictions](../../pkgs/mosd/dist/apid.service#L56).
- [Production diagnostics root](../../pkgs/mosd/apid/src/diagnostics.rs#L65).
- [Snapshot directory creation and publication](../../pkgs/mosd/apid/src/diagnostics.rs#L1218).
- [systemd's official filesystem restriction semantics](https://github.com/systemd/systemd/blob/main/man/systemd.exec.xml).

**Recommended correction:** establish the diagnostics directory and grant its
specific required write access. Verify snapshot creation and deletion under the
actual unit sandbox, not only in a writable temporary test directory.

## P2

### A05 — The update page does not follow asynchronous operation completion

**Evidence: static inspection of query and background-operation lifecycles.**

The UI invalidates `update-state` once when a POST succeeds. The API returns after
admitting background work, so this refresh can observe an intermediate checking or
downloading state. The query has no polling interval, and task completion does not
deliver a UI invalidation event. Global query defaults also disable refetch on
window focus.

The page can remain stale after the task completes until an explicit refresh or
another query-triggering action. Button pending state represents HTTP admission,
not the lifetime of the background operation.

- [Update query and action invalidation](../../pkgs/mosd/apid/ui/src/features/system/system-page.tsx#L107).
- [Query defaults](../../pkgs/mosd/apid/ui/src/app/providers.tsx#L9).
- [Background update lifecycle](../../pkgs/mosd/mosd/src/update_lifecycle.rs).

**Recommended correction:** poll while an operation is active or deliver completion
events, and derive action availability from the server operation state.

### A06 — Expired or revoked browser sessions do not return the UI to login

**Evidence: static inspection of authentication state and error handling.**

The root route caches the authenticated session. The HTTP helper throws on `401`
without invalidating that cache, while the shell's refresh explicitly excludes the
session query. Logout clears local state only after a successful authenticated
DELETE; a revoked or expired session makes that DELETE fail as well.

After session expiration, revocation, or a service restart that loses in-memory
sessions, the current page can remain inside the authenticated shell while its
requests fail. A full page reload can recover, but the current UI flow does not.

- [Root session query](../../pkgs/mosd/apid/ui/src/app/routes/__root.tsx#L10).
- [HTTP error handling](../../pkgs/mosd/apid/ui/src/shared/lib/http.ts#L35).
- [Logout and refresh behavior](../../pkgs/mosd/apid/ui/src/features/shell/app-shell.tsx#L34).
- [Authenticated DELETE handler](../../pkgs/mosd/apid/src/routes.rs#L985).

**Recommended correction:** invalidate session state on authentication failure and
allow local logout cleanup when the server already regards the session as absent.

### A07 — Enabling local MQTT authentication disconnects the default bridge

**Evidence: static inspection of broker, bridge, and dependency authentication.**

When broker authentication is enabled, the broker supplies its account map to the
listener. The default mqttd bridge connects to that local broker, but its runtime
settings contain no username or password and its `MqttOptions` never receives
credentials. The pinned broker implementation rejects a connection without login
details when authentication is configured.

Even if a valid broker account has been enrolled, the default bridge continues
connecting anonymously and cannot publish application item trees. This finding
concerns the default local connection, not a deliberately configured independent
external broker.

- [Broker authentication configuration](../../pkgs/mosd/broker/src/main.rs#L94).
- [Bridge settings](../../pkgs/mosd/mqttd/src/runtime.rs#L58).
- [Bridge connection options](../../pkgs/mosd/mqttd/src/runtime.rs#L426).
- [Default broker endpoint](../../pkgs/mosd/mqttd/dist/mos-mqttd.service#L30).

**Recommended correction:** define and implement the bridge's authenticated local
connection, including credential provisioning, and test it against the broker with
authentication enabled.

### A08 — The offline preflight regression fixture no longer reaches its assertion

**Evidence: existing gate failure.**

The package-pool stamp regression uses a Docker substitute. A newer rootfs path
resolves the local OpenSSL image before reaching the stamp check, and the substitute
does not model that image lookup. The test now exits early and never verifies its
intended stale-pool refusal. This is a stale fixture, not evidence that the actual
local OpenSSL image is absent.

The recorded failure starts with:

```text
FAIL: E1 expected a refusal naming git000000000000-1 and no docker; got exit 1: meta: declared key algorithms -- CA ecdsa-p256, signer ecdsa-p256, package ed25519 (pkgs/rauc/key-algorithms.env)
```

The suite finished with:

```text
RESULT: FAIL (1 failed, 24 passed)
```

- [Regression assertion](../../tests/deb-preflight-test.sh#L484).
- [Earlier OpenSSL image resolution](../../rootfs/build.sh#L387).
- [Complete original failure](../../_out/audit-20260905T131122Z/offline.log).

**Recommended correction:** update the substitute to support the required read-only
lookup, or place the independent stamp preflight before the image-dependent work.
Keep both the rejecting and restored-baseline cases meaningful.

## Code–Documentation Consistency Findings

The following operational discrepancies have P2 priority. A02's atomicity mismatch
is included for traceability but is the same finding, not an additional defect.

| ID | Document claim | Current implementation and required correction |
| --- | --- | --- |
| D01 | [Configuration](../user/configuration.md#L3), [storage](../user/storage.md#L12), and [update guidance](../user/update-rollback.md#L10) place the settings tree entirely on STATE. | Seven configuration documents now live on DATA under `/mos/config`; other state and identity material remain on STATE. Align storage and persistence explanations with [the document definitions](../../pkgs/mosd/mosd-settings/src/documents.rs#L50). |
| D02 | [Configuration channels](../user/configuration.md#L19) says offline provisioning is unimplemented. [The Chinese page](../zh/user/configuration.md#L16) repeats it. | Offline import is implemented. [Section 5.2 of the same English page](../user/configuration.md#L126) already calls it shipped. Replace the contradictory current-state descriptions in both languages. |
| D03 | [Update instructions](../user/update-rollback.md#L49) says nothing is downloaded or installed without an operator request. | [Automatic update mode](../../pkgs/mosd/mosd/src/update_auto.rs#L283) drives check, fetch, install, and reboot under policy. Distinguish the default check mode from explicitly configured auto mode. |
| D04 | [Update policy instructions](../user/update-rollback.md#L69) places the policy on STATE. | The operator document is DATA's [`/mos/config/updates.json`](../../pkgs/mosd/mosd-settings/src/configuration.rs#L453). Correct the location and ownership explanation. |
| D05 | [Trust bootstrap instructions](../user/update-rollback.md#L80) says images provide no pinned trust anchor and the operator must supply one. | [The client](../../pkgs/rauc-sign/src/anchor.rs#L13) authenticates using baked package signing keys and explicitly rejects operator anchor overrides. Replace the obsolete provisioning procedure. |
| D06 / A02 | [Provisioning atomicity](../design/provisioning.md#L431) describes a single rename for the complete import. | [Persistence](../../pkgs/mosd/mosd-settings/src/store.rs#L439) explicitly has multiple independent renames. Resolve the implementation contract and update the design and first-run guidance together. |

Document structure checks validate indexes, links, and prescribed metadata. Their
success does not validate these behavioral claims against code.

## P3

Lower-priority current-state descriptions also need correction:

| ID | Stale description | Evidence |
| --- | --- | --- |
| D07 | [README](../../README.md#L18) says x64 has no BSP build. | [The x64 BSP Makefile](../../boards/x64/bsp/Makefile#L23) builds its kernel. |
| D08 | [The mosd design's current-state note](../design/mosd.md#L9) says schema v8 and seven reconcilers. | [Document schema versions](../../pkgs/mosd/mosd-settings/src/documents.rs#L103) are independently versioned at 1, and [the registry](../../pkgs/mosd/mosd/src/reconciler/mod.rs#L32) contains eight reconcilers. |
| D09 | [Build harness introduction](../design/build-harness.md#L19) says the Rust gate has no container. | [The Rust gate](../../tests/rust-gate.sh#L79) resolves and uses the dedicated builder image. |

Explicitly historical decision records were not treated as defects merely for
describing a superseded design. The discrepancies above are presented as current
behavior or operational instructions.

## Verification Results

These results are from the audit run, not a new full test run performed while
writing this report.

| Area | Command or entry point | Result |
| --- | --- | --- |
| Documentation | `make docs-verify docs-verify-test` | Passed. |
| Rust workspaces | `bash tests/rust-gate.sh` | Passed: 988 mosd-workspace tests and 62 rauc-sign tests; formatting, Clippy, documentation tests, and dependency checks passed. |
| Image verification | `make os-verify-test` | 1,279 tests passed. |
| Layout and API contracts | `make os-layout-lint os-apid-api-spec-pins os-apid-ui-build-contract-test` | Passed. |
| Build tooling | `make os-build-test` | 920 tests passed. |
| Management SPA | `bash pkgs/mosd/apid/ui/run.sh` | 134 tests passed; lint, type checking, and production build passed. |
| Update server | `cd update-server && bun run check` | 36 tests passed; lint, type checking, coverage check, and standalone compilation passed. |
| Offline checks | Health, shadow, kernel requirements, shell/toolchain lint, and rootfs manifests | Passed before the preflight failure. |
| Package preflight | `make os-deb-preflight-test` | Failed: 24 passed, 1 failed; see A08. The combined make invocation exited with status 2. |
| Podman pins | `make podman-pins-test` | Passed when run separately after the earlier make failure had skipped it. |
| Supplemental shell checks | `mos-data-layout-test.sh`, `repart-loader-test.sh`, `trust-domain-hygiene-test.sh`, `release-verify-test.sh` under `tests/` | Passed. |
| JavaScript dependencies | `bun audit` in `build/`, `pkgs/mosd/apid/ui/`, and `update-server/` | No known vulnerabilities reported by these checks. |
| Isolated reproductions | Production API and import code with temporary test fixtures | Three new assertions failed in the expected defect paths: A01, A02, and A03. |

Rust dependency checks passed with permitted duplicate-dependency warnings. A clean
dependency report is limited to the tools' advisory coverage at the time of the run.

### Local evidence

The following files are local, ignored artifacts. They are available in the audit
workspace but will not accompany a checkout containing only this report.

- [Gate exit-status summary](../../_out/audit-20260905T131122Z/results.tsv).
- [Main command runner](../../_out/audit-20260905T131122Z/checks.sh).
- [Supplemental command runner](../../_out/audit-20260905T131122Z/supplemental.sh).
- [Original offline failure log](../../_out/audit-20260905T131122Z/offline.log).
- [Rust gate log](../../_out/audit-20260905T131122Z/rust.log).
- [Reproduction output](../../_out/audit-20260905T131122Z/repro-verified.log).
- [Reproduction runner](../../_out/audit-20260905T131122Z/repro/run.sh).
- [API test overlay](../../_out/audit-20260905T131122Z/repro/apid-tests.rs).
- [Provisioning test overlay](../../_out/audit-20260905T131122Z/repro/provisioning_doc.rs).

The reproduction runner mounted production source read-only and overlaid only
copied test-containing files. It used the real handlers and persistence logic with
controlled settings and filesystem seams. Its nonzero result is evidence of the
three findings, separate from the pre-existing gate failure in A08.

## Coverage Gaps

- The inspected CI definitions do not include the update-server checks or the
  failing package-preflight regression suite. This is a statement about repository
  workflow definitions, not a claim about remote CI execution history.
- Existing tests did not cover credential rotation racing with login, the actual UI
  installation request shape, or partial persistence after a failed import.
- Tests using writable temporary directories do not exercise the shipped systemd
  sandbox. Broker and bridge authentication also lack the required joint coverage.
- Passing UI unit tests does not establish browser recovery from session expiry or
  correct observation of background update completion.
- Repository-owned integration and build configuration were reviewed; bundled or
  downloaded upstream kernel, firmware, and third-party sources were not audited
  line by line.
- No substantial dead-code removal candidate met the confidence threshold. The
  package reachability checks found all 18 package producers reachable across the
  tested manifest resolutions; this does not prove the absence of every unused path.

## Needs Runtime Verification

The following were not established by this audit:

- Diagnostics creation and deletion under the actual `apid.service` sandbox.
- Authenticated MQTT bridge operation against the configured local broker.
- Browser behavior after session revocation and after asynchronous update completion.
- Real-board startup, physical recovery inputs, and USB provisioning behavior.
- Power-loss recovery, actual-disk RAUC A/B installation and rollback, and a complete
  QEMU boot acceptance run for an image built from the reviewed source.

The isolated persistence failure proves A02's write-order defect; it is not a
substitute for power-cut testing on the deployed storage stack.

## Known Integration Boundary

The update server publishes a new signed envelope that the existing device client
cannot yet consume. [PLAN-079](../plan/PLAN-079.md#L26) explicitly records the device
reader as deferred and excludes OS-client changes from that delivery. This is an
unfinished integration milestone, not an accidental compatibility regression.

The repository also retains [an API-breaking-change CI gate](../../.github/workflows/check.yml#L247).
That policy predates the current instruction that development does not require
backward compatibility. Align it and related documentation with the current policy;
do not add legacy adapters solely to satisfy the old gate.

## Original Recommended Next Actions

1. Fix A01 and A02 first, preserving the concurrency and partial-write reproductions
   as durable regressions.
2. Fix A03 and A04, then verify the UI-to-API request and the real service sandbox.
3. Resolve UI operation/session state handling and authenticated MQTT integration.
4. Repair A08 and include the missing suites in CI.
5. Correct the operational documentation in both languages, starting with storage,
   provisioning atomicity, automatic update behavior, and trust bootstrap.
6. Align the API compatibility gate with the current development policy, then
   schedule the outstanding image, board, and power-loss acceptance work.

**Original audit verdict: WARNING.** The findings were open at audit time.
The repair status and subsequent passing checks are recorded above.
