# RFCT-065 Static hosting, the custom-UI lifecycle, and the safety fallback

- **status**: completed — sections 4, 5, 6 and 10.2 proposed; the traversal rules and the fallback are specified to the point of being testable
- **priority**: P1
- **owner**: (bkd campaign)
- **createdAt**: 2026-08-19 15:27
- **claimedAt**: 2026-08-19 15:28
- **completedAt**: 2026-08-19 16:12

Campaign `l1-o7ee8v0o-20260819152142-api` (design proposal, documents only).
Branch `bkd/2axiu30k`, merged by L2 into `bkd/ml2dtd5k` at `c5e8261`.

## Description

An API-first daemon is only half the proposal; the other half is that a site can
**replace the UI without forking the daemon**. That needs three things this task
owns: a way to serve files at all, a place for a custom bundle to live and a
lifecycle for installing and removing it, and — the requirement that makes the
whole direction safe — a guaranteed way back when the custom UI is broken.

## Deliverable

`docs/design/api.md` sections 4, 5, 6 and 10.2, written into the stubs RFCT-063
laid. Sixteen stub lines consumed, verified at merge.

| section | line | subject |
| --- | --- | --- |
| 4.1 | `docs/design/api.md:2306` | Routing between API and assets |
| 4.2 | `:2368` | SPA fallback |
| 4.3 | `:2435` | MIME and caching |
| 4.4 | `:1765` | Path traversal |
| 5.1 | `:1896` | Why a custom UI cannot live in the rootfs — **[implemented]** |
| 5.2 | `:1911` | The location, and the bind |
| 5.3 | `:1981` | Install and removal |
| 5.4 | `:2078` | Survives-what |
| 6.1 | `:2119` | What "broken" covers — five failure classes |
| 6.2 | `:2227` | The built-in default UI, inside verity |
| 6.3 | `:2296` | The deterministic way to reach it |
| 6.4 | `:2386` | Why this is the same reasoning that split mosd and apid — **[implemented]** |
| 10.2 | `:3529` | Ten routed findings, in four groups |

## Decisions

**Assets are the router's fallback, so declared routes win structurally.** This
is a shape choice rather than a rule that has to be remembered: axum registers
routes by path (`mosd/webd/src/routes.rs:44-68`), so an asset can never shadow
an API route by being named after one.

**A mistyped API call must not return 200 HTML.** §4.2's SPA fallback is
conditioned so that a wrong `/api/` path returns a JSON 404, not the index page.
This is the failure mode that makes SPA fallback quietly awful to debug, and it
is closed by condition rather than by convention.

**A fixed MIME allowlist compiled into apid, never content sniffing**, with
`nosniff` on every response (§4.3). The unknown-extension case is the
security-relevant half and is decided explicitly: `application/octet-stream`
**together with** `nosniff`. The alternative — `mime_guess`, which is what
`tower_http`'s `ServeDir` uses — is rejected with its reasoning stated: a fixed
table means the unknown-extension behaviour is *"a decision rather than a
default"* (`docs/design/api.md:1722-1725`).

**`/srv/ui/`, which needs no ninth bind — and that is the point.** `/srv` is
DATA's own mountpoint rather than a redirect, so a custom bundle needs no new
mount unit ordered against anything (§5.2). §5.1 establishes why the rootfs is
impossible rather than merely unwise: `/` is a dm-verity-covered squashfs whose
fstab template says *"there is no remount to perform and no entry that could
ever succeed in rewriting it"* (`os/rootfs/overlay-v2/etc/fstab.in:7-9`), so a
write there fails a cryptographic check, not a permission check.

**A bundle is a validated directory activated by an atomic rename of one
symlink** (§5.3) — validate, then rename, so a half-unpacked bundle is never
reachable.

## The path-traversal rule set, and why it is owned here rather than borrowed

§4.4 specifies percent-decoding order, NUL, absolute paths and symlinks as
explicit rules, because the obvious shortcut does not hold:

- `tower-http` is **not a dependency of the crate** at `86cd669`
  (`mosd/webd/Cargo.toml:11-29`). The copy in the lockfile is pulled in by the
  dev-dependency `reqwest` (`mosd/webd/Cargo.toml:32`) and is built **without
  the `fs` feature**, so `ServeDir` is not compiled at all
  (`mosd/Cargo.lock:2368-2379`).
- `ServeDir` performs **no canonicalisation** — a grep of
  `tower-http-0.6.11/src/services/fs/serve_dir/` returns no match
  (`docs/design/api.md:2679-2681`).

So bundle symlinks are closed **at install time** (reject non-regular entries)
**plus** canonicalise-and-assert at serve time. And if `tower-http` is ever
adopted, §4.4 requires the traversal test to live in our crate rather than
theirs, because `build_and_validate_path` is private with no stability promise
and *"nothing in this repository would notice"* a refactor that reopened a rule.

`openat2(2)` with `RESOLVE_BENEATH` was considered and rejected for a reason
specific to this workspace: it needs a raw syscall, **the workspace forbids
unsafe code** (`mosd/Cargo.toml:10-11`, repeated at
`mosd/webd/src/main.rs:21`), so it means a new `unsafe`-carrying dependency
inside the root-privileged daemon, subject to the audit `mosd/hack/check.sh:9`
runs.

## The finding that makes section 6 more than a fallback story

**Five failure classes, and the fifth is not visible in the filesystem.** The
first four are — a missing bundle, a bad unpack, a filesystem error, an empty
directory. The fifth is a UI that **renders perfectly and cannot talk to the API
it found** (`docs/design/api.md:3070`). No file check detects it. That class is
the reason §6.3 requires a reserved prefix the asset router cannot shadow as the
way *in*, and pointer removal as the way *out* — a mechanism that works when
nothing on disk looks wrong.

**Bundle evaluation happens after the listeners bind**, so a bad bundle can
never become a startup error. This is measured, not hypothetical: config errors
today propagate out of `main` (`mosd/webd/src/main.rs:50-54`) under
`Restart=on-failure` (`mosd/dist/webd.service:9`), which would turn a bad bundle
into a **crash loop with no way in to fix it**.

**§6.4 derives all of this from a decision already made rather than re-arguing
it.** It is the same reasoning `dashboard.md` §6 used to keep the two daemons
apart: do not let a recoverable failure take out the mechanism that recovers it.
§8.1 later cited §6.4 to reject the "one asset pipeline for both UIs" option for
the same reason.

## What it did NOT settle

- **`docs/design/access.md` §10.2 and §10.4 need three new rows and a `/srv/ui`
  entry**, and access.md belongs to another campaign's fence. Routed in §10.2,
  not edited.
- **`docs/design/dashboard.md` §6's line citations no longer resolve** at
  `86cd669` — its `main.rs:57-63`, `:53-56` and `routes.rs:95-105` are stale.
  §6.4 records the current numbers; the re-measure is routed to whoever next
  edits that file, because it belongs to campaign
  `l1-o7ee8v0o-20260819152009-apid`.
- **Sandboxing directives for the unit** (`ProtectSystem=`, `ReadWritePaths=`)
  are routed as product code, not proposed here.

## Scope fence

Sections 0 and 1 not edited. `docs/design/access.md` and
`docs/design/dashboard.md` cited and never edited.

No product code changed.

<!-- dated-record: a measurement record frozen at its commit; its citations name the tree as it was then (pre-PLAN-019 layout, pre-rewrite design documents); exempt from docs/verify-citations.sh (RFCT-172) -->
