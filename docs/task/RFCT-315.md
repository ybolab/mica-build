# RFCT-315 Read the baked package anchor and report effective provisioning

- **status**: in-progress (F7/F8/F9 delivered; suite green; operator/effective content assertions owed)
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

The dispatch traded per-task verification for wall-clock: no new tests, no test
suites, no verifier execution, image builds, deb pools or compose runs, with
compilation as the one floor.

**Amended by L1 after the first report.** *Do not write tests* is outranked by
*main stays green*, so existing tests this branch's own commits turned red had
to be repaired here — repairing them is finishing an incomplete change, not
writing coverage. The amendment authorises a test seam in the baked reader (a
seam is not behaviour) and following the data on an assertion whose subject
changed. It does **not** authorise new assertions about new behaviour, and none
were written. Image builds, deb pools, compose runs and verifier execution stay
unauthorised; runtime gates are still owed to L1.

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

### Decision: `operator` does not go through `crate::redact`, and must not be given it later

**Settled, not pending.** The first batch's seam note asked for the redactor;
L1 reviewed the argument below and ratified leaving it out. It is written here
because the shape of this code invites a well-meaning "safety" patch that adds
the call back, and that patch would be a regression in reasoning even though it
changes no output.

Two reasons, and the second is the one that matters:

1. `redact(value, path)` has **no honest `path` to be given**. The argument is a
   settings dot-path, read so that a request naming a secret leaf directly
   (`GET /api/v1/settings/access.webAdmin.password_hash`) is caught when the
   response is a bare string with no field name left to key on. The
   operator projection was not read from a settings dot-path. Any value passed
   would be decoration.

2. The projection is a **stronger guarantee than the redactor**, not a weaker
   one that wants topping up. `redact`'s `SECRET_FIELDS` is a denylist and its
   own module doc calls it fail-open: a secret-bearing field under a name it
   does not carry is served. The operator half is built key by key over
   `update.source`, `update.channel` and `update.policy` — a key the projection
   does not name cannot reach a caller however `/mos/config/updates.json`'s
   schema grows. Adding a fail-open list behind an allowlist adds nothing and
   suggests the allowlist was the weaker of the two.

This is also what PLAN-070 §8's last paragraph requires. It forbids the
endpoint from borrowing the baked tier's "allowlisted and checked twice, so
return it whole" argument for `/mos/config/`, which is credential material. The
projection is a *different* argument — allowlisted **by construction, per key**,
on a document that is never served whole — and not the borrowed one. The module
doc in `provisioning_api.rs` carries this so the next reader meets it before the
code.

If `operator` ever stops being a projection and starts being a serialization of
the document, this decision expires with it.

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

### The five route tests, finished

L1 overruled the deferral, and the ruling is the same one this branch already
took once: **removing a flag and leaving its callers naming it is an incomplete
change, not a deferred test.** The first batch added a filesystem read to a
route and left four existing route tests unable to reach the route. That is the
change being incomplete. `main` stays green outranks *do not write tests*.

**The seam is an `AppState` field, not an environment variable.** L1 offered
`MOSD_META_MANIFEST_PATH`'s shape as the fallback if the honest way needed an
override; it does not. apid already has this exact seam for this exact
situation — `with_bundle_root`, `with_diagnostics_root`, and a `diagnostics`
field whose doc reads "`/mos/diagnostics` on a device, a temporary directory in
tests". `with_meta_manifest` joins them. An env var would also have been the
wrong instrument here: apid's tests run in parallel threads in one process and
none of them calls `set_var`, so a process-global path would have been a race
between tests.

**It is addressed by the manifest, and the tree is derived from it.** That is
the shape `MOSD_META_MANIFEST_PATH` gives the mosd side, and it closes a defect
the seam exposed: the route read layer 1 **twice** — once to digest the baked
tree, once through `configuration::provisioning_status()` for the effective
policy — from two independently spelled paths. On a device they are the same
file, so nothing was wrong in production; under a test that moves one of them,
the response would have reported one tree's manifest beside another tree's
digests. The route now takes `provisioning_status_at(manifest, …)` with the
same path the digest walk derives its root from, so they cannot diverge. The
default is `configuration::DEFAULT_MANIFEST_PATH` itself rather than a second
spelling of that literal.

The operator document keeps its production path. Nothing overrides it and
nothing needs to: a missing `/mos/config/updates.json` is the absent case, not
an error, which is the state every one of these tests is in.

**The fixture is a real tree, in the production shape.** `provisioning_app()`
writes `updates/manifest.json` into a `TempDir` and nothing beside it —
`meta/GENERATED` is conditional on a device, staged only for development-grade
material, so one file is what a shipped image carries. The content is
`meta.example/updates/manifest.json` in full, because `BakedManifest` carries no
serde defaults: a shortened fixture would fail to parse, `load_manifest` would
fall back to the code defaults, and the test would pass without the reader
having parsed anything.

`the_provisioning_surface_is_read_only` keeps plain `test_app`: its 405s and
404s never reach the handler, so a baked tree would be scenery.

**The member count follows the data: four to eight.** `baked`, `bakedDigests`,
`operator` and `effective` are named in the loop and the count says eight.
**No assertion about their contents was added** — that was L1's line and it
stays. What those four fields *say* is still owed, and it is the interesting
half: nothing yet checks that `operator` distinguishes absent from `null`, that
a malformed layer-2 document is refused rather than answered with the baked
value, or that `effective` is the resolved value and not the baked one.

### The TypeScript suites, which this branch had never run

L1 caught `verify` red: **1268 pass, 11 fail** against main's 1279/0. The first
batch added `manifest-keys.ts` and the manifest derivation in `checks-root.ts`
and never ran the suite; the second batch ran neither. This is that TypeScript
work meeting its fixture for the first time, the same shape as the four apid
route tests meeting a test host.

**Ten of the eleven were one stale fixture.**
`FIXTURE_META_MANIFEST` was `{ "schema": "mos/meta/v1", "update": { "source":
null } }` — no `trust` object, so `derivedManifest` threw before any check could
conclude, taking the positive controls and *"a scan that read NOTHING is red,
not green"* down with them. It now carries the **whole**
`meta.example/updates/manifest.json`. Its doc comment claimed "nothing parses
the JSON, so a faithful copy would assert nothing extra"; that reasoning died
when the manifest row grew a derivation, and the comment now says so.

**`signingKeys` is populated rather than copied empty**, which is the one place
this departs from "take it from `meta.example`". An empty array *passes*
`derivedManifest` — it derives an empty id list, which matches — and passes
vacuously: the per-key base64/length validation and the SHA-256 never run, so
the positive control's own verdict line, "manifest signingKeyIds derived from
key bytes", would assert a derivation that did not happen. The fixture carries
one canonical 32-byte value (bytes 1..32) and the id it actually hashes to.
`meta.example` has empty arrays because no ceremony stands behind an example; a
released image's does not, and `anchor.rs` refuses one that does.

**The eleventh was not the fixture**, and L1's one-line root cause did not cover
it. The first batch also made `listRelative` **throw** on a missing directory.
Both of its callers already refuse the empty case and say more about it than a
stack trace can: `packed-meta-is-the-public-set` names the missing paths, and
`no-private-key-in-baked-meta` owns the vacuity rule outright — its
`scanned === 0` branch is a red verdict explaining that these directories are
always populated. The throw pre-empted that verdict with a bare `ENOENT` and
made the branch unreachable in exactly the case its test drives. Reverted to
main's behaviour, with the reasoning in the doc comment. "An absent scan input
cannot prove absence" is right; it is enforced one level up, where the check can
name what it means.

Two more assertions followed the data: the first batch changed the differing-file
verdict from "is not the byte-for-byte copy" to "does not match" — correct,
because the manifest row is now compared structurally after derivation rather
than byte for byte — and two tests still named the old string.

`manifest-keys.ts` was not weakened. It is enforcing the committed schema and it
is the thing that caught this.

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

`cargo test --locked -p mosd -p apid --no-fail-fast`, after L1 ruled the five
route tests had to be finished before this merges. `--no-fail-fast` because the
default stops at the first red binary and never reaches `mosd` at all:

| binary | result |
| --- | --- |
| `apid` unittests | ok. **319 passed; 0 failed** |
| `apid` `tests/e2e.rs` | ok. 1 passed |
| `mosd` unittests | ok. 503 passed |
| `mosd` `tests/bus.rs` | ok. 1 passed |
| `mosd` `tests/scan.rs` | ok. 7 passed |

**831 passed, 0 failed, no `failures:` block anywhere in the run.**

`openapi.json` needed no third regeneration: the seam changed only how the
route reaches its inputs, not what it documents, and
`the_committed_openapi_document_is_the_generated_one` is green.

For the record, the runs before the fix. First:
`FAILED. 313 passed; 6 failed` — the sixth was
`the_committed_openapi_document_is_the_generated_one`, and fail-fast meant
`mosd` never ran. After regenerating the document:
`FAILED. 314 passed; 5 failed`, the five route tests.

`main` moved twice under this branch while this ran (RFCT-313 first, then
RFCT-314/RFCT-321: the settings store rewrite, `update_suppress.rs`, 3.8k lines
across 49 files). **Every number above is from after the last merge.**
`openapi.json` was regenerated after the second merge too, because main had
changed it by 131 lines and a textual merge of two independently generated
documents is exactly where a plausible-looking wrong document appears; it came
out byte-identical to the generator, which is why it is not a separate commit.

## Owed execution and handoff

No new test files and no new test assertions were written in either batch. L1
still owes positive and negative gates for baked-key verification (including
rotation and offline import), alternate-anchor refusal, malformed/empty keys,
build-time ID mismatch/derivation, planted binary endpoints versus allowed
configuration URLs, and missing scan inputs.

**Executed, but shallowly.** The route is now reached: four tests drive
`api_v1_provisioning_status` against a real baked tree and get 200 with the
document they expect, so the effective half is no longer compile-only. What
they do **not** do is look at what `operator` and `effective` say — L1 drew that
line and it holds. So the three properties this task carries remain
**unexercised**: nothing checks that an absent operator field stays absent while
an explicit `null` stays `null`, that a malformed `/mos/config/updates.json` is
refused rather than answered with the baked value, or that `effective` is the
resolved value rather than the baked one. Those are the assertions worth having
and they are still owed.

The second batch merged `main` (two real conflicts, resolved above), started
containers under the `ai-agent-nl59gfwo-` name prefix and removed them by that
prefix, and did not edit the plan/task indexes or the changelog. `_out/` in this
worktree holds copied build caches and is gitignored.
