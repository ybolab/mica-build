# RFCT-315 Read the baked package anchor and report effective provisioning

- **status**: in-progress
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

## F9 integration seam: deliberately incomplete

L1 instructed this workstream to stop at F9's effective half because RFCT-313 (`bkd/o6eeb97q`) owns F5/F6/F6b and the only baked/operator resolver. No duplicate reader, shim, stub, or baked-as-effective value was added. RFCT-315 remains in-progress until this seam is connected.

Requested callable interface, also recorded at the route call site:

```rust
mosd_settings::configuration::provisioning_status() -> Result<serde_json::Value, ConfigError>
```

It returns `{operator, effective}`, each describing `update.source`, `update.channel`, `update.policy`, `fleet.url`, and `fleet.enabled`, using the same resolver as runtime dialing/policy. Absent operator fields remain absent; explicit null URL overrides remain null. A layer-2 read/parse/validation error returns `Err`; the route must return a named configuration error instead of showing the baked value as effective. Operator values pass through the existing redactor before serving. L1 will reconcile the final exported spelling with RFCT-313 at merge.

## Compilation and syntax evidence

Passed on this worktree:

- `cargo check --offline --locked --manifest-path pkgs/rauc-sign/Cargo.toml --lib --bins`.
- `cargo check --offline --locked --manifest-path pkgs/mosd/Cargo.toml -p mosd -p apid --bins`, with `MOS_APID_UI_DIST_DIR` pointing at a temporary copy of already generated UI assets. No UI build was performed.
- `cd verify && bun run typecheck` (`tsc --noEmit`), after a frozen-lockfile dependency install with lifecycle scripts disabled.
- `bash -n rootfs/build.sh rootfs/scripts/derive-signing-key-ids.sh pkgs/rauc/gen-dev-keys.sh`.
- `git diff --check`.

The first Rust check found a `tough::RepositoryLoader` reference-type mismatch, which was fixed. The first apid check lacked `MOS_APID_UI_DIST_DIR`; the existing assets supplied that required compile input. Both final Rust checks passed.

## Owed execution and handoff

No new test files, test edits, test suites, verifier execution, image/deb builds, UI builds, or composition runs were performed. Compilation is the only claim about execution. L1 still owes positive and negative gates for baked-key verification (including rotation and offline import), alternate-anchor refusal, malformed/empty keys, build-time ID mismatch/derivation, planted binary endpoints versus allowed configuration URLs, missing scan inputs, and authenticated status/digest/error behavior. Existing CLI and route fixtures that assumed `--root` or no baked manifest require L1's gate updates.

`git merge --no-edit main` reported `Already up to date` against `cf4ffbf3`. No container was started. The protected plan/task indexes and changelog were not edited. Changes remain uncommitted in the assigned worktree; this dispatch did not request a commit or push.
