# RFCT-209 Reconciling PLAN-021 with PLAN-022: fourteen conflicted files, one tree

- **status**: completed — 14 conflicts resolved with both workstreams' behaviour intact, 455 citations re-anchored, every gate green on the merged tree
- **priority**: P1
- **owner**: bkd/yb03x8mz
- **createdAt**: 2026-08-28
- **completedAt**: 2026-08-28
- **plan**: PLAN-022 (finding, slot reserved by RFCT-200 section 8)

RFCT-200 section 8 reserves 208 and 209 for findings raised while M2-M8 run.
This is the second, and like the first it is a seam rather than a defect:
PLAN-021 (the defect and debt batch) and PLAN-022 (native networking) edited
the same files in parallel, PLAN-021 reached main first, and the two have to
become one tree without either workstream's behaviour being reverted.

## 1. What the two sides did to the same files

PLAN-021 and PLAN-022 branched from the same commit and both rewrote apid's
router, its tests, its OpenAPI document, the e2e harness, and the four design
documents that describe them. The overlap is not accidental: PLAN-021's M2(b)
cluster is *"API/bus plumbing"* (`docs/plan/PLAN-021.md:32`) and PLAN-022 M6
is the apid surface for the new interface kinds, so both campaigns had reason
to touch `os/pkgs/mosd/apid/src/routes.rs` and everything that describes it.

Neither side may be reverted. PLAN-021 ships a change-password route, an
in-process access cache fed by a `SettingsChanged` subscription, `/healthz`
semantics, a five-name bus-error split and a UI-bundle traversal fixture.
PLAN-022 ships quoted path segments, typed network panes, the WireGuard
rotate-key route, a widened redaction denylist, e2e phases 05b and 05c, and
the kernel fragment those phases measure. Every resolution below keeps both.

## 2. The fourteen conflicts, and how each was resolved

### 2.1 The apid sources

| File | Conflict | Resolution |
| --- | --- | --- |
| `os/pkgs/mosd/apid/src/bus_client.rs` | one hunk: PLAN-021's `SettingsChanged` signal member against PLAN-022's `rotate_wireguard_key` method, both appended to the same `trait Mosd` | union — the method, then the signal |
| `os/pkgs/mosd/apid/src/settings_api.rs` | one hunk: two accessors appended to the same `impl FakeSettings` | union — `settings_reads` and `rotations` both kept |
| `os/pkgs/mosd/apid/src/openapi.rs` | one hunk: the last entry of the `paths(...)` list, extended by both | union — `api_v1_change_password`, then `api_v1_wireguard_rotate` |
| `os/pkgs/mosd/apid/src/routes.rs` | two hunks: the last `.route(...)` of `api_router` and the last arm of `is_declared_api_route` | union in both; the gate now hands off the change-password path, the resource paths and the rotate path |
| `os/pkgs/mosd/apid/src/tests.rs` | three hunks: the `ALL_MUTATIONS` length, and two large blocks both sides appended after the same test | union; the array is 13 rows, its body having auto-merged to the union already, and the two appended blocks are kept whole and in order |
| `os/pkgs/mosd/apid/openapi.json` | four hunks | not hand-merged: regenerated from the merged handlers, which is the mechanism the tree already asserts — *"`--openapi` prints it and a test asserts the committed copy is exactly what this module produces"* (`os/pkgs/mosd/apid/src/openapi.rs:4-5`) |

`tests.rs` is the one file git could not be trusted with. Both sides appended
several hundred lines at the same point, and git's alignment interleaved the
two blocks into hunks that were syntactically wrong on either side of the
markers. It was rebuilt instead: the common prefix, then PLAN-021's tail
whole, then PLAN-022's tail whole, taken from each parent by line range. No
function or constant name collides between the two tails, checked by name
before the file was written.

`openapi.json` was regenerated rather than merged because a hand-merged
document would have been a fifth opinion about the API alongside the four
`utoipa::path` attributes. The regenerated document carries both new paths and
both new schemas, and `mosd/apid`'s own staleness test — the one that says
*"is stale; from mosd/, regenerate it with"* (`os/pkgs/mosd/apid/src/tests.rs:1813-1814`)
— passes on the merged tree, which is what proves the document describes the
merged handlers and not one side's.

### 2.2 The e2e harness

`test/apid-api/run.sh` conflicted once, where both sides inserted a seeding
step immediately after the disk copy is made. PLAN-021 seeds the UI-bundle
traversal fixture into DATA; PLAN-022 seeds phase 05c's guest script into
STATE. They write different partitions of the same disk copy and neither reads
the other's, so both are kept, in that order, both still after
`--prepare-only` because that is what makes the copy either could be written
into. The rest of the file — the phase list carrying `05b-wireguard` and
`05c-kernel-net`, the dry-run notes for both seeds, the second boot — merged
without conflict and all of it survives.

`test/apid-api/src/phases/04-readonly.ts` did NOT conflict, which is worth
recording because both sides rewrote it heavily. The merge is coherent and was
read line by line: PLAN-021's MQTT pane row and its `/mqtt/enable` POST-only
row sit beside PLAN-022's `/api/versions` rework, and the image-skew guard
PLAN-022 deleted is gone with its definition, leaving no dead function behind.

### 2.3 The documents

`docs/design/api.md` conflicted 118 times, `docs/design/dashboard.md` 16,
`docs/design/bus.md` once, `docs/design/remote-management.md` twice, and
`docs/task/RFCT-066.md` twice. Of those 139 hunks, 120 differ between the two
sides in digits only: both workstreams re-anchored the same sentence to their
own tree, so the prose is identical and only the line numbers differ. Those
were taken from PLAN-021's side and then re-anchored wholesale onto the merged
tree in section 3, which is the only way to be right about a number in a tree
neither side ever saw.

The remaining 19 hunks are substantive, and each was decided by asking which
side describes the behaviour that now ships:

| Hunk | Decided | Why |
| --- | --- | --- |
| `/healthz` semantics, section 1.5 | PLAN-021 | RFCT-131 gave the endpoint its stated meaning; PLAN-022's text is the older description |
| the `SettingsChanged` proxy member, section 1.3 | PLAN-021 | RFCT-133 declared the member PLAN-022's text says does not exist |
| uptime, sections 1.6, 2.2 item 3, 5.2, and dashboard section 2 | PLAN-021 | RFCT-129 moved the read into mosd; PLAN-022's text still has apid reading `/proc/uptime` |
| the password change, section 3.2 | PLAN-021 | RFCT-134 shipped both surfaces; PLAN-022's text says no such route exists |
| the five-name bus-error split, sections 2.4 and 8.2 | PLAN-021 | RFCT-130 split `NotFound` and `ReadOnly` out of `InvalidArgs`; PLAN-022's text names three fdo names |
| 502 unified to 503, sections 2.4 and 5.1 | PLAN-021 | RFCT-140 made the HTML path answer 503 with `Retry-After` |
| the access cache, sections 5.1 and 8.3 | PLAN-021 | RFCT-132 removed the per-request `GetSettings` PLAN-022's text describes |
| the bundle-install gap row, section 8.1 | PLAN-021 | RFCT-136 re-measured the row and PLAN-021's quote is the one `docs/design/dashboard.md` now carries |
| the VLAN dot-path limit, section 2.2 | **PLAN-022** | RFCT-201 closed it with quoted path segments; PLAN-021's text still calls it an open limit |
| section 8.4's residue list | **both** | PLAN-021's error-split bullet, PLAN-022's dot-path bullet and PLAN-021's uptime bullet are three separate claims and all three are now true |

That last row is the only hand-written resolution in the document set: the
three bullets belong to different subjects and each side had rewritten a
different one, so taking either side whole would have reverted a true
statement. The bullets were reassembled, each in its own side's words.

`docs/task/index.md` takes the union of both sides' rows: PLAN-021's
RFCT-180/190/191 and PLAN-022's RFCT-200..208, nine rows and three, in
numeric order. `docs/verify-citations-unquoted-baseline.txt` likewise takes
both sides' new rows, with the recomputation in section 3.

## 3. Re-anchoring, and the measured ceilings

Both parents pass `docs/verify-citations.sh` on their own trees — 1170/1170
and 1345/1345 — and the merged tree failed 183 content checks, every one of
them a line number that moved because the other side's edits landed above it.

The repair is mechanical and numbers-only. For every citation in every
non-dated scanned document, the parent tree the citing LINE came from is
decided by whether that exact line appears in PLAN-021's copy of the document,
PLAN-022's copy, or both; a line in both is ancestral and is mapped from the
common ancestor's tree. The cited line number is then mapped through the
diff between that tree and the merged tree, and rewritten. 453 citations
moved. Two could not be mapped because the cited source line was itself
edited by the other side — the redaction comment in `api.md` section 3.1 and
RFCT-200's `api.md` row — and were repointed by searching for their quote.
No prose, no claim, and no citation was added or removed; the commit is
separate from the merge for exactly that reason.

The unquoted-citation ceilings were then recomputed on the merged tree, not
inherited. Measured: `docs/design/api.md` 435, `docs/design/bus.md` 5,
`docs/design/dashboard.md` 80, `docs/design/remote-management.md` 5,
`docs/task/RFCT-066.md` 3, `docs/task/RFCT-190.md` 10,
`docs/task/RFCT-200.md` 65, `docs/task/RFCT-201.md` 2. Every one of those
equals its committed ceiling except `dashboard.md`, whose row drops 81 -> 80
in the same commit, which is the direction the ratchet allows.

## 4. Beyond the conflicts

Three changes outside the fourteen conflicted files:

- `os/pkgs/mosd/apid/openapi.json` is regenerated rather than resolved, as
  section 2.1 records.
- The citation re-anchor of section 3 reaches every document whose numbers
  moved, not only the conflicted ones: a citation into a file the other
  workstream edited is stale whether or not its own document conflicted.
- `docs/verify-citations-unquoted-baseline.txt` loses one from
  `docs/design/dashboard.md`'s row.

Nothing else. No feature was added, no unrelated defect fixed.

## 5. Gates on the merged tree

| Gate | Result |
| --- | --- |
| `bash os/pkgs/mosd/hack/check.sh` | `ALL CHECKS PASSED` — fmt, clippy `-D warnings`, 704 nextest tests, doctests, `cargo deny` |
| `bash os/pkgs/rauc-sign/hack/check.sh` | `ALL CHECKS PASSED` |
| `bash docs/verify-citations.sh` | `1379/1379 PASS` |
| `bash docs/verify-index.sh` | `748/748 PASS` |
| `bash os/verify/run.sh` | `RESULT: PASS (1080/1080 tests)` |
| `bash os/verify/run.sh --verify --board x64` | `RESULT: PASS (292/292 checks, 22 skipped (x64/grub; each named above))` |
| `make os-apid-api-test` | `RESULT: PASS (337/337 checks)` — boot 1 `PASS (306/306)`, boot 2 `PASS (17/17)`, 9 skipped |
| `make os-build-test` | `689 pass`, `0 fail` |

The image the e2e suite ran against was REBUILT on this tree
(`MOS_BOARD=x64 bash os/rootfs/build-v2.sh` then
`bash os/build/run.sh --mkimage-x64`), not reused from either workstream's
worktree: PLAN-021 edits `os/rootfs/overlay-v2`, `os/boards/x64/board.env`,
the mosd sources and the RAUC templates, so every sibling `_out/` predates
changes that reach the artefact. The two pinned third-party builds under
`os/pkgs/{rauc,podman}/out-amd64` WERE copied from a sibling worktree, which
is sound for a narrower reason: they are gitignored outputs of upstream
sources pinned in `versions.env`, and both `versions.env` files are byte
identical between the two trees, so a rebuild could not produce different
bytes. Nothing else was reused.

The e2e result is 337 checks where RFCT-206 measured 329 on PLAN-022 alone:
the extra checks are PLAN-021's additions to `04-readonly` and the
change-password surface, which is the merge showing up as coverage. The
`pin-seeded-times` flake PLAN-021 claims to have fixed did not fire.
