# RFCT-071 The /srv/ui bundle store: layout, validation, atomic activation, deactivate, status read

- **status**: completed — `mosd/apid/src/bundle.rs` implements api.md §5.2 and §5.3 with 27 tests; four findings reported rather than designed around
- **priority**: P1
- **owner**: ai-agent
- **createdAt**: 2026-08-20 14:27
- **completedAt**: 2026-08-20 16:05

Campaign `l1-o7ee8v0o-20260820142702-ui`, phase 4 of `docs/design/api.md` §8.2 —
static hosting and the custom-UI lifecycle, with **no** upload route. Branch
`bkd/n0bakix6`, base `b4b7c72`.

## Description

`docs/design/api.md` §5.2 and §5.3 as one self-contained module with no HTTP in
it: where a custom UI lives, what a bundle is, how it is validated, how it is
activated atomically, how it is removed, and how "what is installed right now?"
is answered. The endpoint that exposes the answer belongs to §2 and is not here;
the serve-time path belongs to §4 and is not here either.

## Deliverable

`mosd/apid/src/bundle.rs` — the whole task — plus one line in
`mosd/apid/src/main.rs` (`mod bundle;`).

**Layout (§5.2).** Root `/srv/ui`, and the root is a parameter so tests root it
in a temporary directory. `bundles/<generation>/` holds installed trees,
`current` is a symlink to the active one, `.staging-<generation>/` and
`.trash-<generation>/` are the dot-prefixed working names, `records/` carries
what activation recorded. Directories are created mode `0755` and files `0644`;
the installed tree is normalised to those modes at activation, so a tree an
operator staged with `0600` files does not become a bundle that a non-root apid
cannot read the day §6.6's privilege split lands.

**Absence of `/srv/ui` is a defined state.** The root is created lazily by the
install path and by nothing else. `status()`, `discover_staged()` and
`recheck_active()` all answer on an absent root without creating it, and one
test asserts exactly that.

**What a bundle is (§5.3).** Exactly one readable `index.html` at the root; no
entry that is not a regular file or a directory; optionally `mos-ui.json`.
A bundle with no manifest is **valid** and is activated with the compatibility
check recorded as `CompatCheck::NotRun`.

The no-irregular-entries rule is enforced on the **staged** tree, in the same
walk that produces the digest, before anything is reachable. A hardlink is a
regular file, so the only thing that distinguishes it is its link count: a
regular file with `nlink > 1` is refused with the count in the rejection.

**Activation, in §5.3's five steps and that order.** The staged tree is
validated (never the live one), normalised, hashed, `fsync`-ed file by file and
directory by directory including its parent, `rename`-d into
`bundles/<generation>`, recorded, and only then is `current` flipped — by
creating the new symlink under `.current-<generation>.tmp` and `rename`-ing it
over the old one, so there is no instant at which `current` is absent. Prune
runs last.

**Removal is two operations.** `deactivate()` removes the `current` symlink and
leaves the tree on disk — §6.3's escape, and it is idempotent. `delete()`
renames to `.trash-<generation>` and unlinks recursively, and **refuses** when
`current` points at that generation.

**The digest** is recorded at activation under `records/<generation>.json` and
re-checked by `recheck_active()`, which L3 F wires to start-up. It is not
re-checked per request, which is §6.1's stated and accepted gap.

**The compatibility check takes the served set as an input parameter.** §2 is
not implemented in the tree — `grep -rn '"/api' mosd/apid/src/` returns 0 lines
at `b4b7c72` — so `GET /api/versions` is not there to consult and this module
does not invent it. The relation is **membership in the served set**, and the
only trigger is an empty intersection.

## Tests — 27, in-module against `tempfile`

| test | what it proves |
| --- | --- |
| `absent_root_reads_as_the_built_in_ui` | §5.2's defined state: a named answer, not an error and not an empty field |
| `reading_status_never_creates_the_root` | the three read paths never create `/srv/ui` |
| `rejects_a_tree_with_no_index` | §6.1 class 2, first half |
| `rejects_a_tree_whose_index_is_a_directory` | §6.1 class 2, second half |
| `rejects_a_staged_tree_containing_a_symlink` | §5.3 rule 2 / §4.4 rule 5's primary mitigation |
| `rejects_a_staged_tree_containing_a_fifo` | §5.3 rule 2, FIFO |
| `rejects_a_staged_tree_containing_a_socket` | §5.3 rule 2, socket |
| `rejects_a_staged_tree_containing_a_hardlink` | §5.3 rule 2, the entry a stat cannot distinguish by type |
| `a_tree_without_a_manifest_activates_unchecked` | degradation, not rejection; check recorded as not run |
| `the_installed_tree_carries_the_layout_modes` | §5.2's `0755`/`0644` |
| `a_manifest_intersecting_the_served_set_activates` | §6.1 class 5, the passing case |
| `a_manifest_with_an_empty_intersection_is_refused` | §6.1 class 5, the one and only trigger |
| `a_manifest_matching_only_the_non_current_member_activates` | **the load-bearing negative test**: membership, not equality with `current` — §2.1's dual-major recommendation |
| `the_startup_recheck_finds_the_empty_intersection_after_an_update` | the same bundle after an image serving only `v2`; re-check reports and does not act |
| `the_startup_recheck_never_deactivates_an_unchecked_bundle` | a bundle that could not be checked is never called incompatible |
| `a_present_but_unparsable_manifest_is_refused` | §5.3 step 2's "manifest parses if present" |
| `deactivate_keeps_the_bundle_on_disk` | §6.3's escape, and it is idempotent |
| `a_deactivated_bundle_can_be_reactivated_from_disk` | what keeping two generations buys |
| `delete_after_deactivate_removes_the_tree` | §5.3's delete, trash included |
| `delete_while_active_is_refused` | never unlink the tree `current` points at |
| `prune_keeps_exactly_two_generations` | §5.3 step 5, records pruned with their trees |
| `the_digest_recheck_detects_a_file_mutated_after_activation` | §6.1 class 3 |
| `a_symlink_planted_after_activation_reads_as_a_mismatch` | a tree that cannot be walked is a mismatch, not an error — §6.1 forbids a bundle failing start-up |
| `a_refused_activation_leaves_the_active_bundle_untouched` | atomicity: the previously active bundle is still active, the rejected tree is still staged |
| `activating_an_existing_generation_is_refused` | activation never overwrites an installed generation |
| `pick_up_staged_activates_the_highest_staged_generation` | §8.2 phase 4's second local install path |
| `the_digest_is_stable_across_two_identical_trees` | the digest is a property of the tree, not of readdir order |

## Checks

```
$ bash mosd/hack/check.sh
     Summary [  36.390s] 332 tests run: 332 passed, 0 skipped
advisories ok, bans ok, licenses ok
ALL CHECKS PASSED
$ bash docs/verify-index.sh
docs/verify-index.sh: 158/158 PASS
```

332 = the 305 that existed at `b4b7c72` plus the 27 added here. No `unsafe`, no
new crate dependency, no change to `mosd/Cargo.lock`: the module uses `sha2`,
`serde`, `serde_json` and `anyhow`, all already dependencies of `apid`
(`mosd/apid/Cargo.toml:12-30`). Hex encoding is six lines rather than a `hex`
dependency the crate does not have.

No file under `os/` is touched and no file is added to the packed rootfs, so no
image build or verifier run is owed.

## Decisions this task had to take, because §5.3 does not state them

1. **Where the digest is recorded.** §5.3 requires "the digest recorded at
   activation" and specifies no location. A file inside the bundle tree would be
   servable content, so the record lives **outside** it, at
   `/srv/ui/records/<generation>.json`, carrying the digest and the
   compatibility result. Everything else the status read reports — the
   generation, the manifest, whether `index.html` opens — is read from the tree
   **now**, which is what §5.3 requires; only the two facts that are inherently
   historical come from the record.
2. **Manifest field names.** §5.3 names the four things a manifest declares but
   not their JSON keys. Chosen: `name`, `version`, `immutableDir`,
   `apiVersions` — camelCase, matching §2's body style. All four are required,
   so a manifest missing one is `ManifestUnparsable` rather than a manifest that
   silently degrades; §5.3 says "declaring at least", which reads as a floor.
3. **"The previous generation."** §5.3 says keep the current and the previous
   one. Implemented as *the active generation, plus the newest generation that
   is not the active one* — so a store with no active pointer keeps its newest
   two, and re-activating an older generation does not silently delete a newer
   one that is still on disk.
4. **A tree that cannot be walked is a digest mismatch.** If an operator plants
   a symlink under `bundles/N` over a root shell, the re-check cannot hash the
   tree. It reports `digest_matches: Some(false)` rather than returning an
   error, because §6.1 requires every bundle outcome to be a state the daemon
   holds.

## Findings — reported, not designed around

1. **§§4-6's path citations use the pre-rename `mosd/webd/...` spelling.** 33
   occurrences of `mosd/webd/` and 8 of `mosd/dist/webd.service` between
   `api.md:1553` and `:2468` (`grep -o`, at `b4b7c72`). Mechanical, expected,
   and owned by the documentation reconciliation. §5.2 and §5.3 themselves carry
   exactly one (`api.md:1956`).
2. **The startup marker in §1 is wrong, and §1 is the measured section.**
   `api.md:101` states the line is `WEBD_LISTENING https=<addr> http=<addr>`
   while citing `mosd/apid/src/main.rs:69` — a post-rename path. At `b4b7c72`
   that line prints `APID_LISTENING`. The line number is right and the string is
   not. §6.1 (`:2222`) and §8.2 phase 4 (`:3066`) both repeat `WEBD_LISTENING`,
   and it is the marker phase 4's start-up ordering constraint is written
   against, so it is worth correcting rather than leaving as a rename artefact.
3. **`mosd/dist/webd.service` no longer exists.** It is `mosd/dist/apid.service`
   (`ls mosd/dist/`), still root — no `User=` — and `Restart=on-failure` is
   still line 9, so every §5.2/§6.1 claim resting on it holds; only the filename
   moved.
4. **This task's own one-line edit shifts `mosd/apid/src/main.rs` by one line.**
   `mod bundle;` inserted at `:24` moves the `APID_LISTENING` `println!` from
   `:69` to `:70`, so `api.md:101`'s line number goes stale the moment this
   branch merges. Named here so the reconciliation edits it once with the right
   number rather than re-measuring twice.
5. **The module was placed alphabetically, not where the task package named
   it.** The package asked for `mod bundle;` between `mod bus_client;` and
   `mod config;`, and called that the alphabetical position; `bundle` sorts
   before `bus_client`, so alphabetical is between `mod auth;` and
   `mod bus_client;`, which is where it went. Still exactly one line, still
   separable from the parallel `mod assets;` insertion.

## What could not be established from the tree

- **The served set has no in-tree value.** `GET /api/versions` does not exist
  (`grep -rn '"/api' mosd/apid/src/` → 0 at `b4b7c72`), so every test passes a
  set of its own and `activate`/`recheck_active` take it as a parameter. A
  degenerate empty served set would refuse every manifest-bearing bundle; that
  is the literal reading of "empty intersection", and the caller that owns the
  real set owns not passing an empty one.
- **This work is not exercised on hardware.** Every claim above rests on one
  thing: a host-side `cargo nextest run --workspace --locked` against temporary
  directories. No real `/srv/ui`, no verity root, no A/B update and no
  `rauc install` was involved. That is a statement about the v2 stack this
  module lands in — which has not been exercised on a board — and not a claim
  that the project has never booted hardware: a v1 image has reached the
  `mos login:` prompt on a real CX3576-Z. Neither "never booted" nor "verified
  on device" would be an accurate description of the evidence here.

## Scope fence

Touched: `mosd/apid/src/bundle.rs` (new), `mosd/apid/src/main.rs` (one line),
`docs/task/RFCT-071.md`, `docs/task/index.md`. Not touched: `routes.rs`,
`tests.rs`, `config.rs`, `session.rs`, `tls.rs`, `auth.rs`, `bus_client.rs`,
`settings_api.rs`, `tests/e2e.rs`, anything under `os/`, `docs/design/api.md`,
`docs/README.md`. No route was added and no dependency was added.
