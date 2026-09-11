# 20260910-1012-c-config-update-obligations Classify configuration and update policy obligations

- **status**: completed
- **createdAt**: 2026-09-10 10:12
- **approvedAt**: 2026-09-10 10:12
- **completedAt**: 2026-09-10 10:36
- **relatedTask**: 20260910-1012-c-config-update-obligations

## Context

This pre-approved full-tier classification compares PLAN-070 F1-F12,
PLAN-071 implementation obligations, and RFCT-315 F7/F8/F9 against the current
committed configuration, update, provisioning, trust, API, and test contracts
at `5c61f7fbb5589807e931e981b3ef8cb9bdff8b6d`.

The classification preserves the development-only fresh-image invariant: no
compatibility readers, migrations, obsolete package/slot formats, RAUC/TUF, or
legacy updater restoration. It also preserves signed file deployment trust,
DATA staging under `/mos/updates`, secret-safe reads, authenticated API/CSRF,
watchdog/recovery behavior, and outbound-off defaults.

## Proposal

1. Extract the assigned historical obligations and their latest amendments.
2. Trace only the bounded current design, implementation, API, and tests.
3. Classify every obligation into exactly one permitted category with current
   file-and-line evidence, test limits, and trigger status.
4. Define small dependency slices only for valid implementation work, including
   exact paths, behavior, the smallest RED test, default model, and shared-path
   requirements.
5. Record unresolved product choices as bounded decisions without inventing a
   service or enabling outbound behavior.

## Obligation Matrix

Categories below are exhaustive and mutually exclusive. Evidence is from the
recorded HEAD unless a historical line is explicitly named. An available test
is evidence that can be run against the current source; it is not reported as
executed by this documentation-only unit.

### PLAN-070

| ID | Classification | Current evidence and test limit |
|---|---|---|
| F1 | **valid implementation work** (D1) | `meta.example/updates/manifest.json:1-20` is the current secret-free, no-server document and `.gitignore:4-9` protects `/meta/` and the `/ca/` tombstone. The README is not current: `meta.example/README.md:3-10`, `:18-25`, `:91-100`, and `:109-125` still prescribe removed RAUC/TUF keys and commands, contrary to `docs/design/key-delivery.md:7-18` and `:20-36`. This is a documentation gap, not a reason to restore those readers. |
| F1b | **superseded** | The domain-mutating, idempotent RAUC generator was replaced by fresh, isolated inputs: `pkgs/mos-boot/dev-keys.sh:1-13` refuses an existing output, `:25-38` creates the three current domains and copies public defaults. `docs/design/key-delivery.md:20-36` makes the fresh-directory/no-conversion model explicit. Available test: `bash tests/trust-domain-hygiene-test.sh`; limitation: it is software custody evidence, not production key custody. |
| F2 | **superseded** | There is no RAUC CA/keyring path to rename. `docs/design/updates.md:3-9` removes RAUC and prior trust formats, while `docs/design/release-signing.md:3-26` places metadata/content anchors in authenticated kernel policy. `verify/src/checks-file-root.ts:14-23` rejects retired RAUC binaries and paths. Available tests: `bash verify/run.sh src/checks-file-root.test.ts`; no current image was built in this unit. |
| F3 | **valid implementation work** (D2) | The current staging allowlist is narrow (`rootfs/build.sh:233-250`), but it scans only `manifest.json` and silently ignores off-allowlist source files; it also copies a non-empty `GENERATED` marker without scanning its bytes. Thus the historical B1 negative gate is absent even though the ordinary staged set is correct. |
| F4 | **valid implementation work** (D3) | `verify/src/checks-file-root.ts:92-100` enforces the current path set and scans the manifest, and `verify/src/checks-file-root.test.ts:32-42` drives three ordinary negatives. It does not scan `GENERATED`, compare the current manifest schema/keys, or report a nonzero scanned file/byte count. The current check therefore does not provide all of F4's independent image-side proof. |
| F5 | **valid implementation work** (D2) | The runtime reader is strict and total: `pkgs/mosd/mosd-settings/src/configuration.rs:174-228` uses required fields plus `deny_unknown_fields`, and `:387-424` returns code defaults with an explicit error. However its claim that the build compares keys (`:176-182`) is not implemented by `rootfs/build.sh:233-250`; an unknown baked key is not presently a build error. Runtime unit coverage at `configuration.rs:1275-1281` proves only the `trust` rejection. |
| F6 | **already delivered** | One resolver defines three-layer, per-key precedence and the no-fallback rule (`configuration.rs:18-42`, `:1148-1180`). `load_updates` refuses every present invalid document (`:760-802`); mosd maps that to an unknown selection rather than baked fallback (`pkgs/mosd/mosd/src/update_policy.rs:120-148`). Available tests include `pkgs/mosd/mosd/src/bus.rs:2665-2688` and `configuration.rs:1422-1444`. Limitation: source reachability is mocked/unit-level here. |
| F6b | **already delivered** | `/mos/config/updates.json` is the sole current path (`configuration.rs:430-447`); its schema accepts operator URL/channel but no trust/root/repository path (`:507-577`, `:760-802`, `:873-953`). Named refusal tests are at `:1487-1539`. The baked-origin credential predicate is fixed at `:270-304`. Its documented trigger does not hold: `:283-286` records that the product has no update-source credential caller. Keep outbound authentication absent; if separately approved later, the caller must use this predicate rather than creating a new credential path. |
| F6c | **already delivered** | The namespace is created at 0700 and the update workspace on DATA at `rootfs/overlay/usr/lib/mos/mos-data-layout:65-85`. Configuration reset clears the whole namespace and full-factory reset reseeds its skeleton (`pkgs/mosd/mosd/src/reset.rs:297-315`); `docs/design/recovery.md:26-42` records survivors. Available tests live with `reset.rs`; no board reset was run here. |
| F6d | **already delivered** | `pkgs/mosd/mosd-settings/src/documents.rs:1-19`, `:43-83`, and `:120-138` split seven operator documents from STATE and pin each at v1 with no migration. `store.rs:138-200` rejects absent/different versions and `:229-239` owns the two stores. The existing mosd-settings suite covers byte/inode isolation and old-version refusal. Limitation: software filesystem tests do not establish physical power-loss behavior. |
| F6e | **already delivered** | The 0700/0600 charter is executable in `documents.rs:29-41`; the shared writer sets 0600 before rename and syncs file and parent (`store.rs:203-227`). The store's current tests cover replacement of a laxer file and secret-safe refusals. Available test: `cargo test --locked --manifest-path pkgs/mosd/Cargo.toml -p mosd-settings`; not run in this unit. |
| F6f | **already delivered** | `pkgs/mosd/dist/mosd.service:8-15` orders startup after `/mos`; `store.rs:297-330` independently refuses a missing medium and names it. `pkgs/mosd/mosd/src/main.rs:160-198` loads the store before service startup. Available mosd-settings tests cover the missing namespace; no mount race was exercised on a board. |
| F6g | **already delivered** | `store.rs:341-455` validates hand-written documents, refuses only their declared subtrees, and keeps missing medium/STATE failures hard. `pkgs/mosd/mosd/src/main.rs:418-426` installs refusals before reconciliation. Current store tests cover valid pour, every invalid document, refusal preservation, and secret-free served reasons; route-level secret protection is also tested at `pkgs/mosd/apid/src/tests/provisioning_api.rs:193-224`. |
| F7 | **superseded** | The old `rauc-update`/manifest-key mechanism is forbidden by the native design. Current `mos-deploy` reads authenticated `/run/mos/boot-policy.json` (`pkgs/mos-deploy/src/bin/mos-deploy.rs:171-189`) and verifies strict Ed25519 envelopes against that fixed set (`pkgs/mos-deploy/src/components.rs:305-338`). `docs/design/release-signing.md:3-26` states the current trust boundary and no mutable input. Available tests: `cargo test --locked --manifest-path pkgs/mos-deploy/Cargo.toml`; no kernel/image trust gate was run here. |
| F8 | **valid implementation work** (D4) | The historical checker was deleted with the retired binaries. The current root checker contains no equivalent scan (`verify/src/checks-file-root.ts:1-103`), although the native shipped first-party set is now `/usr/bin/mosd`, `/usr/bin/apid`, and `/usr/bin/mos-deploy` (`:6-8`). `pkgs/mosd/apid/ui/src/features/system/automatic-updates-panel.tsx:188-193` still relies on this invariant. |
| F9 | **valid implementation work** (D5) | Production code returns baked bytes/digests and calls the shared operator/effective resolver (`pkgs/mosd/apid/src/provisioning_api.rs:105-175`, `:215-268`); the resolver preserves absent versus null and fails closed (`configuration.rs:1187-1270`). Existing route tests assert only field shape (`pkgs/mosd/apid/src/tests/provisioning_api.rs:226-273`), not resolved content. Fleet is conditional: the latest amendment is `docs/plan/PLAN-070.md:2995-3028`; its PLAN-072 operator-document trigger does not hold, as `configuration.rs:1221-1225` and `docs/design/remote-management.md:57-70` state. Keep fleet baked/off and hand its historical rows to C2; do not invent a fleet service in this slice. |
| F10 | **already delivered** | The native replacement documentation now defines current update storage/policy and removes the old updater (`docs/design/updates.md:1-9`, `:33-105`), fixed trust (`docs/design/release-signing.md:1-26`, `:47-75`), and reset semantics (`docs/design/recovery.md:21-60`). The literal RAUC README amendment is superseded by these current documents. Available test: `make docs-verify`; documentation is not board proof. |
| F12 | **superseded** | The RAUC algorithm parameter and A1/A2 material sets no longer exist. Current domains and public delivery are explicit at `docs/design/key-delivery.md:7-18`; the current development generator makes RSA boot/content and Ed25519 metadata inputs at `pkgs/mos-boot/dev-keys.sh:25-38`. Current signed-envelope validation is `pkgs/mos-deploy/src/components.rs:305-338`. Tests cover current algorithms, but no test of a deleted RAUC parameter is required. |
| F11 | **already delivered** | Operator-facing reset consequences are explicit in `docs/user/configuration.md:42-58` and `docs/user/recovery.md:116-143`, including a baked `null` source, offline import, reflash, and the narrower one-key remedy. Fleet remains off/unimplemented (`docs/design/remote-management.md:57-70`, `:110-115`), so no operator fleet reset claim is manufactured. Available test: `make docs-verify`. |

### PLAN-071

| ID | Classification | Current evidence and test limit |
|---|---|---|
| U1 | **already delivered** | `UpdateMode` and `RebootPolicy` are closed enums (`configuration.rs:104-162`); the old `autoCheck` key is rejected by name (`:1520-1539`), and auto-without-window is refused before write (`:839-866`, `:1446-1485`). The authenticated route documents and maps the same refusal at `pkgs/mosd/apid/src/update_api.rs:489-560`, with route tests at `tests/update_api.rs:384-427`. |
| U11 | **already delivered** | The JSON document, patch merge, strict trust boundary, shared atomic writer, and sole mosd writer are implemented at `configuration.rs:430-447`, `:873-1069`, `store.rs:203-227`, and `update_api.rs:508-560`. Mosd integration tests at `pkgs/mosd/mosd/src/bus.rs:2691-2818` cover merge, invalid auto, trust keys, and unreadable bases. Native failed IDs/generation live in deployment state, not this document (`docs/design/updates.md:13-26`, `:90-105`). |
| U2 | **already delivered** | The automatic path calls the same `AutoRoutes` check/fetch/install/reboot surface as manual actions (`pkgs/mosd/mosd/src/update_auto.rs:42-103`) and implements check, fetch, re-check, and install at `:234-318` and `:320-421`. Integration tests in `pkgs/mosd/mosd/src/bus.rs:3600-4065` drive the shared service gates. Limitation: current tests are native/software and QEMU evidence is separate. |
| U3 | **already delivered** | The auto trait structurally omits the override (`update_auto.rs:42-49`), and reboot honors `rebootPolicy`, window, and the shared gate (`:449-470`). Unit/integration coverage includes `:1250-1341` and `pkgs/mosd/mosd/src/bus.rs:4069-4134`. No board reboot was performed here. |
| U4 | **superseded** | The manual clearing action is no longer a valid current obligation. Failed IDs and the monotonic generation floor are native authenticated deployment state (`pkgs/mos-deploy/src/deployments.rs:238-283`, `:989-1004`), and current policy explicitly requires a newly signed higher generation with no UI clear (`docs/design/updates.md:90-92`). `pkgs/mosd/apid/src/tests/update_api.rs:330-355` asserts the old clear route is absent. Native deployment tests exercise rejection/fallback/floor behavior; physical durability is separate. |
| U5 | **already delivered** | The driver records channel-specific no-newer facts (`update_auto.rs:234-283`) and every deferral through the closed lifecycle writer (`pkgs/mosd/mosd/src/update_lifecycle.rs:430-485`, `:936-1004`). Reachability tests are at `update_auto.rs:909-1163` and lifecycle encoding tests at `update_lifecycle.rs:1961-2046`. |
| U6 | **already delivered** | The old extra boot fact is replaced by authenticated native status: current/candidate/fallback and verified boot/component identity are parsed at `pkgs/mosd/mosd/src/deployment.rs:17-145`, and confirmation phases at `:154-215`. Installation requires a confirmed running receipt in `pkgs/mos-deploy/tests/io_faults.rs:536-607`. This is mechanism/software evidence, not a physical watchdog proof. |
| U7 | **already delivered** | The completed console reads baked/operator/effective source and channel, writes source/policy/window patches, and renders deferrals (`pkgs/mosd/apid/ui/src/features/system/automatic-updates-panel.tsx:55-120`, `:126-205`, `:208-327`, `:329-379`). Tests cover re-pointing, writes, validation, and deferrals at `automatic-updates-panel.test.tsx:39-187`. The old literal “previous system” wording is superseded by authenticated native rollback/phase status; the completed UI work at `3963c7b3`/`5c61f7fb` is not reopened. |
| U8 | **already delivered** | Automatic actions use the policy actor and shared event names (`update_auto.rs:19-22`, `:88-96`; `pkgs/mosd/mosd/src/bus.rs:1759-1793`). The exact JSONL actor/source contract is tested at `bus.rs:2821-2837`. |
| U9 | **already delivered** | Current native policy/storage/rollback behavior is documented at `docs/design/updates.md:28-105` and local-only management/no-fleet behavior at `docs/design/remote-management.md:87-115`. Available test: `make docs-verify`. |
| U10 | **unresolved product decision** | The controlling trigger is `docs/plan/PLAN-071.md:770-772`: physical bench evidence blocks a release that offers `auto`, not implementation during development. No shipping release is in this assignment, so the trigger does not currently hold. Current software/QEMU acceptance is recorded at `docs/design/updates.md:107-117`, which explicitly leaves physical watchdog/power-cut proof separate. L1's bounded choice is: defer while development-only, or before an `auto` release name the shipping board/boot backend, exact signed build, serial capture, safe power-cut injection points, and pass/fail rule. Without those five inputs there is no self-contained bench command or evidence destination. |

### RFCT-315 acceptance

| ID | Classification | Current evidence and test limit |
|---|---|---|
| F7 | **superseded** | RFCT-315's TUF inline-manifest anchors (`docs/task/RFCT-315.md:34-37`) were removed by the current native design. The operative fixed-anchor evidence is now `pkgs/mos-deploy/src/bin/mos-deploy.rs:171-189`, `pkgs/mos-deploy/src/components.rs:305-338`, and `docs/design/release-signing.md:3-26`. Its historical Rust/build run predates that replacement and is not current acceptance evidence. |
| F8 | **valid implementation work** (D4) | RFCT-315 records the old checker and its unexecuted negatives at `docs/task/RFCT-315.md:38` and `:319-325`. Current `verify/src/checks-file-root.ts:1-103` has no native replacement. The requirement survives, but the required ELF set must be the three current first-party binaries, never deleted RAUC files. |
| F9 | **valid implementation work** (D5) | The handler and shared resolver are present, but RFCT-315 itself records the missing assertions at `docs/task/RFCT-315.md:327-336`; current route tests still stop at schema membership (`pkgs/mosd/apid/src/tests/provisioning_api.rs:226-273`). This is a test/acceptance gap, not a second resolver or production endpoint. |

### Counts

Across 33 assigned identifiers: **18 already delivered, 6 superseded, 8 valid
implementation work, and 1 unresolved product decision**. F8 and F9 occur in
both PLAN-070 and RFCT-315; they remain separate classified identifiers but map
to one implementation slice each below.

## Dependency Slices

Only these five slices are executable from the assigned rows. They are ordered
by dependency, not by historical plan order.

### D1 — Refresh the committed public-defaults README

- **Obligations**: PLAN-070 F1.
- **Write paths**: `meta.example/README.md` only.
- **Read paths**: `meta.example/updates/manifest.json`,
  `docs/design/key-delivery.md`, `docs/design/release-artifacts.md`, and
  `pkgs/mos-boot/dev-keys.sh`.
- **Behavior**: describe the current public-only `meta` input, native signing
  domains, fresh-directory generator, fixed kernel trust, and no-server/off
  defaults; remove all RAUC/TUF/root-key instructions without compatibility
  prose.
- **Existing test command**: `make docs-verify`.
- **Smallest RED assertion**: `! rg -n 'pkgs/rauc|meta/rauc|trust\.signingKeys|root\.key' meta.example/README.md` is red now and becomes green after the rewrite.
- **Default model**: one canonical public-defaults README pointing to the
  authoritative design documents; do not duplicate signing ceremonies.
- **Coordination**: local, no expensive grant and no shared-path handoff.

### D2 — Enforce the source-side public-meta boundary

- **Obligations**: PLAN-070 F3 and F5.
- **Write paths**: `rootfs/build.sh`, a narrow reusable validator under
  `rootfs/scripts/`, and its focused test under `build/src/`.
- **Read paths**: `meta.example/updates/manifest.json`, optional
  `meta/GENERATED`, and `configuration.rs`'s `BakedManifest` contract.
- **Behavior**: reject any source entry outside exactly
  `updates/manifest.json` plus optional `GENERATED`; reject private-key patterns
  in either staged file; require a regular non-symlink input; validate the exact
  current manifest object/key/type set and `mos/meta/v1` before composition.
  Do not add a legacy schema reader.
- **Existing test command**: `bash build/run.sh src/public-meta.test.ts`, then
  `make os-build-test`.
- **Smallest RED test**: a fixture with `updates/root.key` or a PEM marker must
  fail naming that file; a manifest with one unknown key must fail naming the
  key. Each currently passes the staging block.
- **Default model**: fail the build, not runtime; exact current schema, no
  migration and no secret allowlist exception.
- **Coordination**: requires L1/L2 path handoff before editing shared build
  paths; no kernel/QEMU/image grant is needed for the focused test.

### D3 — Complete the independent packed-root public-meta check

- **Obligations**: PLAN-070 F4.
- **Write paths**: `verify/src/checks-file-root.ts` and
  `verify/src/checks-file-root.test.ts`.
- **Read paths**: packed `/usr/share/mos/meta/{GENERATED,updates/manifest.json}`
  and the current baked-manifest shape.
- **Behavior**: scan every allowed regular file for private-key patterns,
  enforce exact allowed paths and exact manifest schema/keys, fail on missing or
  empty inputs, and report nonzero file/byte counts. It independently checks the
  packed root; it does not trust D2's result or accept an old schema.
- **Existing test command**: `bash verify/run.sh src/checks-file-root.test.ts`,
  then `make os-verify-test`.
- **Smallest RED test**: place a PEM sentinel in `GENERATED`; the current check
  passes and the completed check must fail naming the marker. A second mutation
  adds an unknown manifest key.
- **Default model**: exact current public set; no host-tree traversal and no
  silent zero-scan success.
- **Coordination**: requires handoff for `verify/`, which is shared with active
  issue #313; no image build is needed for fixture tests.

### D4 — Restore the native no-compiled-endpoint check

- **Obligations**: PLAN-070 F8 and RFCT-315 F8.
- **Write paths**: `verify/src/checks-file-root.ts` and
  `verify/src/checks-file-root.test.ts` (a helper may be split only if reused by
  both the check and its fixture).
- **Read paths**: packed `/usr/bin/mosd`, `/usr/bin/apid`, and
  `/usr/bin/mos-deploy`; baked/operator JSON is deliberately outside the scan.
- **Behavior**: require all three inputs to be regular ELF files, scan their
  bytes for update/fleet endpoint literals, report scanned paths/file/byte
  counts, and keep any necessary exclusions exact and justified. A configured
  URL in `meta` remains allowed; no blanket localhost/host exception.
- **Existing test command**: `bash verify/run.sh src/checks-file-root.test.ts`,
  then `make os-verify-test`.
- **Smallest RED test**: plant `https://updates.example/v1/manifest.json` in a
  fixture ELF and require a red verdict while the same string in the fixture
  manifest stays green; missing and non-ELF inputs are separate negatives.
- **Default model**: scan the current native first-party binaries only; never
  re-add `rauc-update`/`rauc-verify` or scan arbitrary third-party packages.
- **Coordination**: `verify/` handoff from issue #313 is mandatory. Fixture tests
  need no expensive grant; final packed-image execution belongs to the shared
  integration owner.

### D5 — Close provisioning resolution route acceptance

- **Obligations**: PLAN-070 F9 and RFCT-315 F9.
- **Write paths**: `pkgs/mosd/apid/src/routes.rs` for an `AppState` updates-path
  test seam, `pkgs/mosd/apid/src/provisioning_api.rs` to use that path, and
  `pkgs/mosd/apid/src/tests/provisioning_api.rs` for assertions. No resolver or
  endpoint is added.
- **Read paths**: `mosd-settings/src/configuration.rs:1187-1270`, the existing
  baked manifest seam, and the current route/OpenAPI contract.
- **Behavior**: drive a temporary operator document through the real route and
  assert (1) absent differs from explicit null in `operator`, (2) an override
  wins in `effective` while baked remains distinct, and (3) malformed layer 2
  returns `configuration_unavailable` rather than baked success. Assert that no
  unprojected/secret key is served. Fleet remains the baked off/null pair until
  PLAN-072 supplies a real operator document.
- **Existing test command**: `cargo test --locked --manifest-path
  pkgs/mosd/Cargo.toml -p apid tests::provisioning_api -- --nocapture`.
- **Smallest RED test**: a route fixture with an operator URL expects distinct
  baked/operator/effective values; it cannot currently direct the handler to a
  temporary `updates.json`, so it fails before the seam lands.
- **Default model**: one library resolver and one read-only authenticated route;
  a path field is a test seam, not a second configuration source.
- **Coordination**: local apid paths, no expensive grant, no UI edit. A future
  source L3 must first merge the shared local `bkd/58sdocnk` into a clean branch
  as directed by the campaign.

Dependency order is `D2 -> D3`; D4 may follow D3 on the same handed-off verify
path. D1 and D5 are independent. U10 is intentionally absent: it is a release
decision/bench contract, not an executable source slice yet.

## Evidence Limits

- This classification is current only for
  `5c61f7fbb5589807e931e981b3ef8cb9bdff8b6d`. A moving `main` does not change
  this branch's evidence; L2 must rebase the classification before instantiating
  slices if the cited paths change.
- No Rust, Bun, QEMU, kernel, root, full-image, Docker, or physical-board gate
  was run. Available test locations were inspected; historical pass counts were
  not promoted to current evidence after the native deployment replacement.
- Software validation separates mechanism from proof: configuration/parser and
  auto-driver tests do not prove mount timing, watchdog behavior, serial
  fallback, or eMMC power-cut durability.
- `docs/design/updates.md:107-117` and
  `docs/design/release-signing.md:67-75` are the current evidence boundaries.
  The earlier unexecuted composed-image gate in RFCT-315/RFCT-305 is not by
  itself a current release blocker.
- Completed UI work at `3963c7b3`/`5c61f7fb` and storage work at `3579a2cd`
  remain complete. PLAN-037 is ordering history, not a new executable task;
  PLAN-086 S5's general tool reduction remains rejected.
- Exact changelog handoff for L2 D: “Classified 33 PLAN-070/071 and RFCT-315
  configuration/update obligations at `5c61f7fb`: 18 delivered, 6 superseded,
  8 implementation rows mapping to five bounded slices, and one conditional
  release-board decision; no production behavior changed.”

## Risks

- Historical status markers can be stale, so classification must rely on the
  current contract and implementation rather than record status.
- Design approval, mechanism implementation, software tests, and board or
  power-cut proof are separate evidence levels and must not be conflated.
- Build, publication, signing, endpoint-verifier, and active S905X5M paths have
  external owners and must be handed off before any future edit.

## Scope

Writes are limited to this plan, its task record, and their two index rows.
All product code, tests, historical task/plan records, and the changelog remain
unchanged.

## Alternatives

- Treating old unchecked rows as current blockers was rejected because stale
  status and unexecuted historical image gates are not current-code evidence.
- Reopening compatibility mechanisms was rejected because development images
  are freshly flashed and compatibility is explicitly out of scope.

## Annotations

- The campaign proposal and this bounded classification were approved before
  dispatch; no additional proposal approval is required.
