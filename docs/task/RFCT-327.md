# RFCT-327 PLAN-071 U11/U8/U7: the write route, the actor, the console

- **status**: completed
- **priority**: P1
- **owner**: plan071-write-route/bkd-43mhi8ru
- **createdAt**: 2026-09-05 13:30

## Description

PLAN-071 U11's remaining half, U8 and U7, taken as one task because they are
one seam: U7 cannot be real without U11's route, and U8 is the field U11 §3
requires that route to carry.

RFCT-313 landed U11's first half — `/mos/config/updates.json` as the document,
the reader, the three-layer precedence, `source.url` as an overridable key and
the anchor-shaped keys as load errors asserted by name. What was missing was
the **write**: the save, the route, the actor field, and a console whose
controls were still disabled and simulation-backed behind a planned notice.

This task builds:

- **U11's write half** — the atomic save in the library, mosd's
  `SetUpdateConfig` as the file's only writer, and apid's one administrator
  route over it, validating on write and naming the offending field;
- **U8** — the audit `actor` field, `policy` for the automatic driver and
  `operator` for a human through the API, across the update events and the
  write route;
- **U7** — `AutomaticUpdates` made real: the policy and channel controls as
  writes, the deferral display, the baked/operator/effective reading for the
  source address as well as the channel, and the "already on the previous
  system" string.

## ActiveForm

Building the update-config write route, the audit actor and the console.

## Dependencies

- **blocked by**: RFCT-313 (F5/F6/F6b), RFCT-317 (U1/U2/U3), RFCT-321
  (U4/U5), RFCT-315 (F9) — all landed
- **blocks**: U9 (`updates.md` §3's operator surface), U10 (bench)

## Acceptance

- One apid route writes the operator document, authenticated as an
  administrator, and apid never touches `/mos/config/updates.json`: mosd is
  the only writer, all the way down to the filesystem.
- A rejected document is refused with the offending field named, and the
  on-disk document is never replaced by one that would fail to load —
  including `auto` with no maintenance window, and including a document
  naming a trust anchor.
- The save is the discipline the tree already has: temp file, mode before the
  rename, fsync, rename, directory fsync.
- Every update event carries an `actor`: `policy` for the automatic driver,
  `operator` for a human.
- The console's channel and policy controls are writes; a re-pointed device
  shows which address it is using and that it is not the baked one.
- `cargo test --locked -p mosd -p apid`, `cargo fmt --all -- --check`,
  `cargo clippy --workspace --all-targets --locked -- -D warnings` green;
  `openapi.json` byte-equal to what the tree generates; the UI checks green
  in the pinned bun image.
- `docs/plan/index.md`, `docs/task/index.md` and `docs/CHANGELOG.md`
  untouched.

## 1. U11 — the write half

**The library owns the write, because it already owns the read.**
`mosd_settings::configuration` grew four things beside what RFCT-313 left
there, and nothing it left was changed:

- `Serialize` on the document types, with `skip_serializing_if` on every
  overridable key, so a save round-trips the absent / `null` / set distinction
  the whole precedence rests on. A save that flattened the last two would
  rewrite what the operator said about a document they can only read through
  the status route.
- `UpdatesPatch` — the keys the write route accepts, `deny_unknown_fields`,
  with the same three states per overridable key: absent leaves it, `null`
  clears the override back to the baked default, a value overrides.
- `write_updates(path, patch_json)` — **the whole route in one function so the
  order cannot drift**: parse, refuse an anchor by name, load the base, merge,
  validate, save. Every refusal happens before anything is written, which is
  what makes *the on-disk document is never replaced by one that would fail to
  load* a shape rather than a convention.
- `save_updates` — validate, stamp the schema tag, and write through
  `store::write_atomically`.

**A patch and not a replacement, and that is not a convenience.** A console
cannot honestly send a whole document: it reads the *resolved* policy, and
sending that back would pin the image's defaults into the operator's layer —
the device would stop following its image on the day the image changed, and
nobody asked it to. The panel's address and channel fields therefore hold the
**operator's** value with the baked one as the placeholder, and an emptied box
sends `null`.

**The atomic save is the store's, extracted rather than rewritten.**
`store::write_document` had the sequence inline; it is now
`store::write_atomically` and both callers use it. The plan says *invent no
second discipline*, and a second copy of "temp file, mode before rename,
fsync, rename, directory fsync" would have been a second answer to what a
reader sees when the power fails mid-write.

**A missing `/mos/config/` is a failure, not a directory to create** — its
absence is the DATA medium not mounted (PLAN-070 §5.2.6), and a device that
created it would write the operator's channel onto the root filesystem where
the next boot would not look. `Store::write_config` already refuses that way;
this refuses the same way.

**Three refusals, three answers, and the split is a type.** `WriteRefusal`
separates *the patch is wrong* from *the file on the device is wrong* from
*the disk failed*, because the same parse error means opposite things on
either side of that line: mosd maps them to `InvalidArgs` (422),
`AccessDenied` (409 — the same refusal every other action on an unreadable
document already gives) and `Failed` (500). A route that answered both parse
failures the same way would tell an operator their input was wrong about a
document they never sent.

**The anchor scan runs on the patch too.** `trust`, `signingKeys`,
`signingKeyId(s)`, `rootPath` and `keyring` are refused **by name, at any
depth, before deserialisation** — not by `deny_unknown_fields`, which would
stop refusing them the day the schema widens for a benign reason. The write
route is the surface where somebody would try, so this is where the scan
matters most, and a test drives all six keys plus one nested inside a
maintenance window.

**mosd is the writer, all the way down.** `SetUpdateConfig` on `com.mos.mosd1`
takes the patch JSON and answers the saved document;
`UpdateLifecycle::write_config` is where it lands, beside `clear_suppression`
and audited on both sides the same way. apid holds no path to
`/mos/config/updates.json` and opens no file. After a successful write the
lifecycle retakes its snapshot, so the very next `GET /api/v1/update` reports
what was just set rather than what the last action saw.

**apid's route is `POST /api/v1/update/config`**, behind `ApiCredential` — the
same authority every other management write takes, and no new one. The body is
a transparent `Value` forwarded verbatim, the shape `SettingsWrite` already
uses: the enforcing definition of the patch is the library's, in the process
that writes the file, and a typed mirror in apid would have been a second
spelling of one schema.

## 2. U8 — the actor

`audit_line` has a fifth member and there is never a sixth. Three values:

- `operator` — every event apid records, because every route that reaches its
  sink is behind the credential extractor. Deliberately not the session's
  identifier: the cookie is a credential and has no place in this file, the
  peer address is already `source`, and the question §3 requires the trail to
  answer is *did a human do this*.
- `policy` — the automatic driver's `update-check`, `update-fetch` and
  `update-install`, written into the same ring through the same
  single-`O_APPEND`-write appender.
- `device` — what the device did that nobody asked for: the boot-time recovery
  action, and apid's start-up pick-up of a staged UI bundle. Recording that
  last one as an operator's would have been the exact lie the field exists to
  prevent.

**The event names are constants in the crate both binaries link**
(`UPDATE_CHECK_EVENT`, `UPDATE_FETCH_EVENT`, `UPDATE_INSTALL_EVENT`,
`UPDATE_CONFIG_EVENT`). If the two spellings drifted, the actor field would
still be there and the trail would answer *did a human do this* with two event
sets that never meet.

## 3. U7 — the console

`AutomaticUpdates` is gone and `automatic-updates-panel.tsx` is real. Four
pieces, reading only `GET /api/v1/update` and
`GET /api/v1/provisioning/status`:

- **The source panel is the gate.** The address and the channel are each shown
  as *effective* with *from the image* or *set here — the image says X*
  beside them, and both are writable. Both halves are needed: the effective
  value alone cannot be told apart from the image's, and the baked value alone
  is not what the device is doing.
- **The policy panel** — mode, cadence and reboot policy, written explicitly,
  because choosing a mode in a selector *is* the operator deciding.
- **The windows panel** edits the list the document holds, not one window: an
  editor showing only the first would silently delete the rest on the next
  save. The device validates the days and the times and refuses with the
  offending value named, and §2's `auto`-needs-a-window rule arrives the same
  way, so the form restates neither.
- **The deferral display** names all fifteen of `update_auto.rs`'s reasons in
  both locales, shows the device's own detail verbatim beside them (it carries
  the channel, version and window a translation cannot), and says how long and
  over how many attempts. A reason outside the vocabulary renders as itself
  rather than as one of the fifteen.

**The "already on the previous system" string** replaces the raw
`alternate_is_newer` copy in the rollback panel: after an automatic install
that fell back, the device IS on the older system, and an operator reading
"rollback refused" a minute after an update failure would otherwise conclude
something is broken.

**The simulation provider lost `automaticUpdates` outright.** A control that
wrote in production and simulated in the demo would be one code path behaving
two ways, which is the shape that hides a regression; the provider now says so
where the field was. `updatePhase` stays — it backs the applications
prototype's progress animation and nothing on the update tab reads it.

## 4. What this task did not do, and why

**PLAN-071's backlog, unfinished after this task:**

- **U9 — the design documents.** `docs/design/updates.md` §2/§3/§5/§6 and
  `remote-management.md` §3 are a concurrent branch's (F10/F11/U9), so nothing
  here touched them. **`docs/design/api.md` §'s route table does not list
  `POST /api/v1/update/config`** — it is a design document and the same branch
  owns it; that row is owed and is the one documentation gap this task
  knowingly leaves.
- **U10 — the bench.** Hardware: bad bundle → automatic install → fallback →
  suppression, observed on serial. Blocking for shipping `auto`, not for
  building it.
- **The console control that clears a suppressed version.** PLAN-071 §3 lists
  it among the operator's controls; U7's row does not, and this task built
  U7's row. The route exists (RFCT-321) and the deferral display names the
  suppressed version, so the loop the display opens is closed today by a
  request an operator has to make by hand. It is a small addition to this
  panel whenever it is wanted.

**Owed to a composed image** (this batch was run without image builds, without
`verify/run.sh` and without a bench, as asked):

- that the document lands at `0600` inside a `0700` `/mos/config/` on a real
  DATA pool — the mode is asserted in a unit test against a temporary
  directory, which proves the writer and not the layout;
- that apid reaches `SetUpdateConfig` over the **system** bus with the shipped
  D-Bus policy — the apid-side tests drive a fake and mosd's drive the service
  object directly, so the bus name and policy path is unexercised here;
- that the regenerated `openapi.json` matches what the running daemon serves
  (`os-apid-api-test`'s black-box phases).

**One test shape that is weaker than it looks, named rather than hidden.** The
automatic path's audit line is asserted at `record_policy_action`, the writer
`BusRoutes::audit` delegates to in one line — not by driving `AutoDriver::tick`
through a fake. The driver's check cadence is keyed on `std::time::Instant`
with no seam to advance and `tokio::time::pause` does not move it, so a test
that drove a tick would need a clock seam in U2's code, which is U2's slice
and not this one. What is proven here is that the writer produces a line
carrying `actor: policy` under the same event-name constants apid uses; what
is not proven is that the driver calls it at each of the three steps, which is
visible only by reading `update_auto.rs`.

## 5. Verification

Run in `localhost/mos-build-rust-check:amd64` — the derived image, which is
`mos-build-rust:amd64` plus the gate tools **and `dbus-daemon`**; without it
two apid bus tests correctly refuse to skip rather than passing vacuously.

- `cargo fmt --all -- --check` — clean.
- `cargo clippy --workspace --all-targets --locked -- -D warnings` — clean.
- `cargo test --locked -p mosd -p apid` — **852 passed, 0 failed** on the
  merged tree: apid 322 unit + 1 e2e, mosd 521 unit + 1 bus + 7 scan. That
  count includes `the_committed_openapi_document_is_the_generated_one`, so the
  regenerated `openapi.json` is byte-equal to what this tree produces.
- `bash pkgs/mosd/apid/ui/run.sh` — `bun run lint`, `bun run typecheck` and
  `bun run test` inside the bun pinned as `IMAGE_BUN_1`, then the dist build:
  **24 test files, 142 tests, all passing**, `APID UI CHECKS PASSED`. Run in
  the pinned image and not on the host, whose bun produces different chunk
  hashes, so a dist diff taken there would lie.

**Not run, and not runnable in this batch**: no image composition, no
`verify/run.sh`, no bench. §4 names what that leaves owed.

**A design document this task made stale and did not fix.** `docs/design/`
belongs to the F10/F11/U9 branch, which merged into `main` while this one was
in flight. Its `updates.md` §3.4 is titled *The write route — **[not
implemented]*** and says *"apid declares no write route for this document
today (`pkgs/mosd/apid/openapi.json` carries `/api/v1/update` and its six
action routes and no policy write), so an operator's only way to change the
document is to edit it on the device"*. That is false as of this branch, as
are §2.2's *"Until the write route of §3.4 exists that is an edit on the
device"*, §3.5's attribution gap, and the owed-list entry *"The write route of
§3.4, and the automatic path's audit events (§3.5)"*. Nothing here edits them:
the scope of this task excludes every design document, and rewriting one a
sibling branch may still hold is the conflict that constraint exists to
prevent. They are named here so the correction can be routed rather than
discovered.
