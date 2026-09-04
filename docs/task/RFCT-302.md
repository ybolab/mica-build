# RFCT-302 The snapshot schema version follows the schema, in the code

- **status**: completed
- **priority**: P2
- **owner**: diagnostics-schema-version/bkd-n0utp24l
- **createdAt**: 2026-09-04 15:00

## Description

`docs/design/diagnostics.md` section 5 shipped three different answers to one
question: its heading said "version 1", its own table row said `2`, and
`apid`'s `SCHEMA_VERSION` said `1` and is what a snapshot actually carries.

The history says which of the three is the intent. Commit `4690a87e`, *"fix
(diagnostics): the snapshot schema version follows the schema"*, is entirely
about the SNAPSHOT schema -- the members it names, the rename it cites, the
reader it is for. Its documentation half is exactly that table row, 1 -> 2.
Its code half edited `REDACTION_SCHEMA_VERSION` instead. So the row records
the decision and the code records a mis-edit, and the defect the commit set
out to fix was never fixed: the snapshot shape changed and the version naming
it did not.

The shape change is `7d759112`, one commit earlier. `system.system` carried
`buildEpoch`, `buildDate` and `buildDateDetail` -- three scalars; it now
carries `commitDate` (an object with `date`) and `fileEpoch` (an object with
`epoch` and `date`). Different members, different types, same version number.

## ActiveForm

Making the shipped snapshot version name the shape it ships.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Acceptance

- The shape change is established from the history before anything is
  changed, with the members named.
- `SCHEMA_VERSION` names the shape apid actually produces, with the reason
  for the number recorded.
- The heading is NOT the thing edited to agree: that would erase the evidence
  and leave a number whose whole purpose is that it cannot be false being
  exactly that.
- A position on `REDACTION_SCHEMA_VERSION`, which stands at 3 having been
  bumped once by the mis-edit.
- Sections 5 and 6 each name what their code ships.
- `cargo test --locked -p mosd -p apid`, `(cd verify && bun test)`,
  `(cd build && bun test)`, `make docs-verify` green.
- `docs/plan/index.md`, `docs/task/index.md` and `docs/CHANGELOG.md`
  untouched.

- complete: `SCHEMA_VERSION` is 2, and 2 is the number a snapshot now carries.

  **The shape did change, and here is what changed.** Under version 1
  `system.system` carried three scalars: `buildEpoch`, `buildDate` and
  `buildDateDetail`. `7d759112` replaced them with two objects,
  `commitDate` (`date`) and `fileEpoch` (`epoch`, `date`), in mosd's
  `system_info` and in the diagnostics redaction allowlist, which drops any
  member it does not name. Different members, different types, and both
  documents claiming `schemaVersion: 1`. So the fix is a bump and not a
  heading edit.

  **Why 2.** Nothing migrates a stored snapshot and nothing needs to; the
  number's only job is that a reader holding two of them can tell which shape
  each has. The store reads `schemaVersion` back out of every stored file and
  reports it per snapshot in the listing, and the retention block reports the
  version this build produces -- so a device that has snapshots from before
  and after the rename will now show `1` on the old ones and `2` on the new
  ones, which is exactly the distinction that was missing. Nothing branches on
  the value, so no consumer had to change with it: `openapi.json` types the
  member and does not carry the number, and the UI renders whatever it is
  given. 2 rather than 3 because it is the second shape, and because it is
  what section 5's own table row has said since `4690a87e` -- the row is the
  record of the decision this completes.

  **`REDACTION_SCHEMA_VERSION` stays at 3, and it is not one too high.** The
  starting reading was that it had been bumped once for a change that was not
  its own, and that a version too high is harmless. The first half turns out
  to be false. `7d759112` changed the allowlist -- three names removed, two
  added -- and did not bump it, so at `4690a87e` the redaction schema at
  version 1 already named two different allowlists: the same defect, one
  surface over. `4690a87e`'s mis-edit landed on a bump that was independently
  owed. Checking every change to `fn schema()` since version 1 finds exactly
  two, `7d759112` and `5dfa80f9`, which is exactly the distance from 1 to 3.
  So the value is right for the right reason and nothing about it needed
  correcting -- only section 6's heading, which said 1.

  Red first: `the_snapshot_version_names_the_shape_it_ships` drives the real
  `Collector` over a fake carrying the version-2 members and requires the
  literal `2` beside the members that define it. It failed `left: Number(1),
  right: 2` before the change. The number is written out rather than compared
  against `SCHEMA_VERSION`, which puts the same value on both sides and is why
  the two existing assertions on it could not have caught this; they are left
  alone, since what they check is that the member is wired to the constant at
  all. The redaction fixture, which carries the version-2 members, now says
  `schemaVersion: 2` rather than 1 -- a document with one shape's members and
  the other's number is the defect itself, sitting in a fixture.

  Not changed, and why:

  - The section 5 heading is the only heading that moved to agree with
    something; it moved to agree with the code, which moved first. Section 6's
    heading moved to 3 for the same reason.
  - The two existing `assert_eq!(.., SCHEMA_VERSION)` assertions are left as
    they are. They are tautologies about the value but real assertions about
    the wiring, and rewriting them is not this defect.
  - Stored snapshots are not rewritten and there is no migration. A version
    exists so that two shapes can coexist; converting them would defeat it.
  - `pkgs/mosd/apid/ui/.../diagnostics-panel.test.tsx` keeps `schemaVersion:
    1` on its stored-snapshot fixtures. A stored snapshot legitimately carries
    the version it was written under, and the panel renders the number it is
    given.
  - `openapi.json` is unchanged and was not regenerated: it types
    `schemaVersion` as an integer and carries no example of it, so no wire
    value moved. Its byte-equality test is green.
  - No `docs/zh/` mirror: `docs/design/` is outside the gated trees
    (`user`, `website`, `bsp`) and has no Chinese counterpart. No page in a
    gated tree states either version.

  Verified: `cargo test --locked -p mosd -p apid` green (318 apid + 1 e2e +
  492 mosd + 1 bus + 7 scan) in a container derived from
  `localhost/mos-build-rust:amd64` with `dbus` added; `(cd verify && bun
  test)` 1253 pass; `(cd build && bun test)` 869 pass; `make docs-verify`
  1636 PASS across its five checks. `cargo fmt` and `cargo clippy` were NOT
  run: the image ships only cargo, rustc and std, and `/srv/mos-rust-tools`
  is empty on this host.
