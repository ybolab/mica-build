# RFCT-315 Read the baked package anchor and report effective provisioning

- **status**: in-progress (F7/F8/F9 delivered and compiled; five route tests owed)
- **priority**: P1
- **owner**: bkd/2o9qieqh
- **createdAt**: 2026-09-05 01:50
- **plan**: [PLAN-070](../plan/PLAN-070.md), F7/F8/F9

## Scope and authorization

Implement the approved F7/F8/F9 batch. The dispatch grants implementation approval and replaces per-task tests with compilation and syntax checks. L1 owns the indexes, changelog, and independent gate battery; this task is claimed here without editing those files.

## Implementation plan

1. Authenticate repository root metadata with the baked inline Ed25519 keys, remove alternate device anchor inputs, and derive/validate key IDs during staging. Verify by cargo check and syntax checks.
2. Scan shipped first-party binaries for endpoint literals, refusing missing scan inputs and reporting scanned paths/counts. Verify by TypeScript typecheck only.
3. Report the baked document and file digests alongside operator/effective settings using the same resolution as runtime. Verify by cargo check.

## Verification boundary

No new tests, test suites, verifier execution, image builds, deb pools, or compose runs are authorized. Runtime positive/negative gates are owed to L1. Merge main before final reporting.

## Delivered slice

- F7: both device binaries read `/usr/share/mos/meta/updates/manifest.json` at a fixed path, reject symlink anchors, validate the inline Ed25519 keys and their raw-byte SHA-256 IDs, and authenticate repository root metadata before entering the existing TUF walk. Online selection, fetch, and offline import use this entry point. Device `--root` arguments and mosd's `source.rootPath`/argument forwarding are removed. Release-host APIs remain available to the host signing tool, which is not shipped.
- F7 build gate: `rootfs/scripts/derive-signing-key-ids.sh` emits the staged manifest without modifying its host input. Omit `signingKeyIds` to derive it; any supplied mismatch, including an empty array beside nonempty keys, fails staging. The development key generator now omits IDs. The packed-root comparison independently derives the expected IDs and compares the manifest structurally; other public files remain byte-equal.
- F8: `no-compiled-in-endpoint` scans the required ELF files `/usr/bin/rauc-update`, `/usr/bin/rauc-verify`, `/usr/bin/mosd`, and `/usr/bin/apid`. Missing directories/files and non-ELF inputs throw. The verdict names all paths, the root, file count and byte count. Configuration in baked meta/ or operator documents is outside this binary scan. Exact upstream diagnostic/namespace strings and the embedded router's specific synthetic-origin expression are excluded; no whole-host or blanket localhost exception exists. These exclusions were identified by static inspection of existing binaries, not by executing the new check.
- F9 baked half: authenticated provisioning status now returns `baked` (the whole public manifest) and `bakedDigests` (relative path to SHA-256 for every allowlisted file under `/usr/share/mos/meta/`). Missing/invalid configuration returns `baked_configuration_unavailable`, never an empty successful report. Import history and claim state keep their existing redaction.
- `docs/user/security.md` now records the device anchor reader instead of the closed implementation gap.

## F9 integration seam: connected

The first batch stopped at F9's effective half because RFCT-313 (`bkd/o6eeb97q`)
owned the only baked/operator resolver, and a stub returning the baked value
where the effective one belongs reads as correct on every device that has
overridden nothing — which is all of them today, so nothing would catch it. No
duplicate reader, shim or stub was added in the interval.

RFCT-313 has since landed on `main`. The resolver is in the library rather than
in `mosd`, because apid links `mosd-settings` and cannot link the `mosd` binary:

```rust
mosd_settings::configuration::provisioning_status() -> Result<Value, ConfigError>
mosd_settings::configuration::provisioning_status_at(manifest: &Path, updates: &Path) -> Result<Value, ConfigError>
```

`GET /api/v1/provisioning/status` now calls it and serves the two halves as
`operator` and `effective` beside the existing `baked` and `bakedDigests`, which
is PLAN-070 §8's "three facts side by side". The three properties the library
guarantees are carried, not undone:

- **Absent stays absent, explicit `null` stays `null`.** The projection is
  passed through unchanged; nothing here flattens the two readings into one.
- **A layer-2 read, parse, anchor-key or validation failure is a refusal.**
  `Err` becomes HTTP 500 `configuration_unavailable`, never a baked fallback —
  the route refusing and the update path refusing are one fact reaching two
  surfaces. Layer 1 is deliberately not an error: `load_manifest` always
  answers, and the baked half of the response reports the manifest's own error.
- **The operator half stays a key-by-key projection.** It is not serialized
  from the document and no key is added here.

`fleet.url` / `fleet.enabled` come back as the **baked** values, and that is not
a stub: `/mos/config/`'s fleet document is PLAN-072 §2's and does not exist, so
there is no operator layer to read and nothing on the device reads one either.
When that slice lands it extends the library's resolver rather than adding a
second one in this route.

### Why `operator` does not go through `crate::redact`

The first batch's seam note asked for it. It is deliberately not done, and the
module doc now carries the argument instead. PLAN-070 §8's last paragraph
forbids the endpoint from borrowing the baked tier's "allowlisted, so return it
whole" argument for `/mos/config/`, which is credential material. The projection
is a *different* argument, not that one: three named fields, built key by key,
so a key the projection does not name cannot reach a caller however the schema
grows. That is stronger than `redact`, whose list is fail-open by its own
module doc. It also has no honest `path` argument to pass — `redact(value, path)`
reads a settings dot-path, and this value was not read from one.

This is a judgement call and it is cheap to overrule: one `redact::redact` call
in the handler removes nothing today and would keep the older wording true.

## Continuation batch: the dead fixtures, and the merge that made the seam real

### `main` merged, with two real conflicts

`git merge --no-edit main` conflicted in `pkgs/mosd/mosd/src/update_policy.rs`
and `pkgs/mosd/mosd/src/update_lifecycle.rs`. Both are the same collision:
RFCT-313 moved the policy structs out of `mosd` and into
`mosd_settings::configuration`, while this branch was deleting `--root` from
the structs and the argument vector that main still kept.

- `update_policy.rs`: main's side. The `SourcePolicy` block this branch edited
  no longer exists here; `rootPath` is retired in the library's rejected-key
  list, which is the same removal by a better route.
- `update_lifecycle.rs`: main's `workspace.repo_dir` with this branch's
  removal of `--root`, and the doc comment above `check_args` restated —
  it promised that F7 *would* replace the flag, which has now happened.
- `DEFAULT_ROOT_PATH` is deleted. It survived the merge outside the conflict
  region and had exactly one reader, the `--root` argument that F7 removed.

### The fixtures that named a removed flag

The whole tree carries **two** dead call sites, both CLI invocations in
`pkgs/rauc-sign/tests/update.rs` (`the_cli_reports_readiness_with_its_own_exit_code`):
`"--root", fx.trusted_root...` passed to `rauc-update fetch`. Both removed.

Nothing else names it. The `--root` in `tests/host-toolchain-lint.sh` and the
`pack.sh --root` in two Dockerfiles are different tools' flags. Every
`&fx.trusted_root` in the rauc-sign test suite is a **library** call —
`client::verify_repository`, `verify_target`, `update::check`,
`import_selected` all still take a pinned root, because the release host still
uses them — so those call sites are live, not dead.

`pkgs/mosd/apid/openapi.json` is regenerated, by `apid --openapi`, which is the
command `the_committed_openapi_document_is_the_generated_one` names for exactly
this. It was already stale from the first batch's `baked`/`bakedDigests`; the
route fields added here made it staler.

### Owed rather than written: five route tests

Removing `--root` cannot make `tests/update.rs` pass and was never going to:
`anchor::root_bytes` reads `/usr/share/mos/meta/updates/manifest.json` at a
fixed path with no environment override, by design and by its own comment, so a
device binary invoked on a build host now fails before it reaches the flag. That
is F7's design, not a defect in the fixture.

The same fixed path is why five `apid` route tests fail, and none of them can be
repaired mechanically:

- `the_status_reports_the_applied_document_and_requires_a_credential`
- `a_device_no_document_reached_reports_nulls_and_unclaimed`
- `a_refused_document_is_reported_with_its_key_path_and_no_value`
- `the_status_serves_no_secret_from_either_subtree_it_reads`

  All four now get the 500 envelope, because `baked_configuration()` reads
  `/usr/share/mos/meta` and a build host has no such directory. Making them
  pass needs either a test seam in that reader — which is extending F7/F8, and
  this dispatch forbids it — or a fixture that materialises the baked tree,
  which is a new assertion about new behaviour.

- `the_openapi_document_covers_the_provisioning_status_route`

  Asserts `ProvisioningStatus` carries **exactly four** members. It carries
  eight. Changing `4` to `8` and naming the new members *is* the new assertion,
  so it is named here rather than written.

None of these five was introduced by connecting the effective half:
`provisioning_status()` treats a missing `/mos/config/updates.json` as the
absent case and a missing manifest as layer 1's own answer, so it returns `Ok`
on a bare host. They are the first batch's baked half reaching a test host.

## Compilation and syntax evidence

Passed on this worktree:

- `cargo check --offline --locked --manifest-path pkgs/rauc-sign/Cargo.toml --lib --bins`.
- `cargo check --offline --locked --manifest-path pkgs/mosd/Cargo.toml -p mosd -p apid --bins`, with `MOS_APID_UI_DIST_DIR` pointing at a temporary copy of already generated UI assets. No UI build was performed.
- `cd verify && bun run typecheck` (`tsc --noEmit`), after a frozen-lockfile dependency install with lifecycle scripts disabled.
- `bash -n rootfs/build.sh rootfs/scripts/derive-signing-key-ids.sh pkgs/rauc/gen-dev-keys.sh`.
- `git diff --check`.

The first Rust check found a `tough::RepositoryLoader` reference-type mismatch, which was fixed. The first apid check lacked `MOS_APID_UI_DIST_DIR`; the existing assets supplied that required compile input. Both final Rust checks passed.

### Continuation batch

All in `localhost/mos-build-rust-check:amd64`, source mounted read-only:

- `cargo check --locked --offline --all-targets` in `pkgs/rauc-sign` — `rc=0`,
  no warnings. `--all-targets` is what puts the edited `tests/update.rs` under
  the compiler.
- `cargo check --locked --offline --all-targets -p mosd -p apid` in `pkgs/mosd`
  — `rc=0`, no warnings.
- `bash -n rootfs/build.sh rootfs/scripts/derive-signing-key-ids.sh
  pkgs/rauc/gen-dev-keys.sh`, and `git diff --check`.

`cargo test --locked -p mosd -p apid` was run because the dispatch asked for it
by name, against the batch's general "do not run test suites". Verbatim, after
`openapi.json` was regenerated and with `--no-fail-fast` so the run did not stop
at the first red binary:

| binary | result |
| --- | --- |
| `apid` unittests | **FAILED. 314 passed; 5 failed** |
| `apid` `tests/e2e.rs` | ok. 1 passed |
| `mosd` unittests | ok. 503 passed |
| `mosd` `tests/bus.rs` | ok. 1 passed |
| `mosd` `tests/scan.rs` | ok. 7 passed |

The five, and the one line that explains four of them:

```
---- tests::provisioning_api::the_status_reports_the_applied_document_and_requires_a_credential stdout ----
assertion `left == right` failed
  left: 500
 right: 200

---- tests::provisioning_api::the_status_serves_no_secret_from_either_subtree_it_reads stdout ----
{"error":{"code":"baked_configuration_unavailable","message":"No such file or directory (os error 2)","source":"mosd"}}

---- tests::provisioning_api::a_device_no_document_reached_reports_nulls_and_unclaimed stdout ----
assertion `left == right` failed: with no admin credential the device is still claimable
  left: Null
 right: true

---- tests::provisioning_api::a_refused_document_is_reported_with_its_key_path_and_no_value stdout ----
assertion `left == right` failed
  left: Null
 right: "rejected"

---- tests::provisioning_api::the_openapi_document_covers_the_provisioning_status_route stdout ----
assertion `left == right` failed: the status must carry exactly the four documented members
  left: 8
 right: 4
```

The first run, before `openapi.json` was regenerated, was
`FAILED. 313 passed; 6 failed` — the sixth was
`the_committed_openapi_document_is_the_generated_one`, and `cargo test`'s
default fail-fast meant it never reached `mosd` at all.

`main` moved again while this ran (RFCT-314/RFCT-321: the settings store
rewrite, `update_suppress.rs`, 3.8k lines across 49 files). It was merged a
second time, without conflicts, and **every number above is from the re-run
after that merge**, not from before it. `openapi.json` was regenerated again
too: main had changed it by 131 lines, so the merge of two independently
generated documents needed checking rather than assuming — it turned out
byte-identical to what the generator produces, which is the only reason it is
not a third commit.

## Owed execution and handoff

No new test files and no new test assertions were written in either batch. L1
still owes positive and negative gates for baked-key verification (including
rotation and offline import), alternate-anchor refusal, malformed/empty keys,
build-time ID mismatch/derivation, planted binary endpoints versus allowed
configuration URLs, and missing scan inputs.

**Never executed, in either batch.** The F9 effective half has been *compiled*
and never *run*: no test reaches `provisioning_status()` through the route,
because every route test dies earlier on the baked reader. So the three
properties this task carries — absent-versus-null, `Err` rather than a baked
fallback, and the key-by-key projection — are the library's guarantees plus a
call site that type-checks, and nothing on this branch demonstrates them end to
end. The five named route tests are what would.

The second batch merged `main` (two real conflicts, resolved above), started
containers under the `ai-agent-nl59gfwo-` name prefix and removed them by that
prefix, and did not edit the plan/task indexes or the changelog. `_out/` in this
worktree holds copied build caches and is gitignored.
