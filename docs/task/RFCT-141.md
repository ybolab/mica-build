# RFCT-141 The static-asset traversal guards have no over-the-wire coverage, because no device under test has a bundle

- **status**: completed
- **priority**: P2
- **owner**: bkd/1n7prrif
- **createdAt**: 2026-08-26

`test/apid-api/` talks to apid over the network on a booted image and covers
the transport, the setup and login flows, the cookie, the read-only surface and
a form post travelling all the way to a reconciler. It does not reach the
path-resolution guards.

`serve::respond` calls `asset_path::resolve` — the function holding the
dot-segment rejection, the residual-escape rejection, the NUL rejection, the
escaped-separator rejection and the canonicalised-root containment assertion —
only inside `if let Some(root) = active_root(..)`. Every device the suite runs
against has no bundle at `/srv/ui`, so `active_root` is `None` and not one line
of the guard set executes. The phase says so in its own header rather than
letting the result read as coverage
(`test/apid-api/src/phases/04-readonly.ts:168-186`).

The 404s the phase does observe come from the static-asset fallback's
`offers_html()` and `ends_in_a_route_segment()` conditions and from nowhere
else — the right statuses arrived at by a different route. A probe for
`/../../etc/passwd` passing there proves nothing about traversal.

Closing it needs a bundle seeded at `/srv/ui` on **DATA** before the phase
runs. The available seeding tool writes STATE only, so the work is a seeding
step, not a new assertion.

## Resolution

Two pieces, both in `test/apid-api/`:

**The seeding step.** `run.sh` gained a DATA counterpart to
`os/tools/qemu-seed-state.sh` (same mechanism — extract the partition by its
GPT sector range with `sgdisk`, write with `debugfs`, verify each write with
`debugfs stat`, put it back), run after `--prepare-only` and before the first
boot. It seeds `test/apid-api/fixture/ui-bundle/` — `index.html`,
`assets/app.js` and an in-bundle `etc/passwd` decoy — into DATA at
`/srv/ui/.staging-1`. Deliberately a **staged** tree, never an activated
store: apid's own start-up (`pick_up_staged`) validates, digests, records and
activates it, so the store state the phase runs against is produced by the
code under test rather than imitated by the harness. The fixture carries no
`mos-ui.json`, so activation records the compatibility check as not run and
no served-set coupling exists.

**The assertions.** `04-readonly.ts`'s traversal section now runs with the
bundle active. It first anchors — `GET /` and `GET /assets/app.js` must
return the fixture files **byte for byte** (the phase reads the same fixture
tree run.sh seeds, so expectation and disk cannot drift); without the anchor,
a guard 404 and a bundle-less §4.2 404 are indistinguishable and every row
would prove nothing. Then the probes assert against the active-bundle path:

- `/../../etc/passwd` under `text/html` is now **404** where bundle-less it
  was 200 — the `..` rejection firing is the one over-the-wire observation
  that separates the guards from §4.2, and a regression that skipped the
  guards would answer 200 (the bundle index via the SPA fallback).
- `/%2e%2e%2fetc%2fpasswd` (decoded dot-segment), `/%252e%252e%2fetc%2fpasswd`
  (residual escape) and `/x%00y` (NUL) are 404 with empty bodies, each row's
  check text naming the §4.4 rejection that decides it.
- `GET /etc/passwd` returns the bundle's decoy byte for byte and none of the
  real-passwd signs — rule 3's join-not-concatenate semantics observed over
  the wire.
- `/no-such-route` under `text/html` serves the bundle's index (NotFound is
  the one fallback-eligible rejection); `/no-such-asset.js` stays 404 on
  §4.2 condition 4.

The `/` pane row moved out of `PANES` (with a bundle active, `/` is §4.1's
declared exception and serves the bundle index, which section 3 asserts
exactly); phases 01–03 and 05–08 only ever assert gate behaviour for `/`
(303/308) and are unaffected.

Verified without a booted image, as the constraints here allow: the fixture
satisfies `bundle.rs`'s `validate_tree` by construction (regular files only,
readable root `index.html`, no manifest), `bash -n run.sh` passes, and the
suite's own gates pass in the pinned bun container (`bun run typecheck`,
`bun run selftest` → 37/37). The end-to-end run against a booted image is
**pending** — no built image was available to this change; the first
`bash test/apid-api/run.sh` will exercise the seeding step and the new rows
together.
