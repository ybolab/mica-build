# RFCT-069 Resolve the auth/CSRF and version-set contradictions; the migration finding as a dead-control instance

- **status**: completed — both contradictions resolved; one supplied citation was found not to hold and was corrected against the plan documents; one finding was corrected **upward** by execution
- **priority**: P1
- **owner**: ai-agent
- **createdAt**: 2026-08-19 16:41
- **claimedAt**: 2026-08-19 16:42
- **completedAt**: 2026-08-19 17:00

Campaign `l1-o7ee8v0o-20260819152142-api` (design proposal, documents only).
Branch `bkd/2hj1kmy3`, merged by L2 into `bkd/ml2dtd5k` at `8f1a957` — the
campaign head.

## Description

Added after RFCT-066, to close the two contradictions RFCT-066 had found in
sections it did not own and **correctly routed rather than patched** (§10.3
items 2 and 3). A contradiction between two sections cannot be fixed by either
section's author without reaching across an ownership boundary; a task created
for it can fix both.

## Deliverable

`docs/design/api.md` sections 2.1, 3.2, 3.3, 6.1 and 10.3, edited in place. No
new section, no stub consumed — every stub was already gone.

## Resolution 1 — §3.2 versus §3.3: auth and CSRF

§3.2 said the bearer token was *"the **only** accepted credential on `/api/v1/`
routes"* and also that a session cookie could mint one. If the mint were
reachable at an `/api/v1/` path with cookie authentication, `SameSite=Lax`
would be the only control between a cross-site page and a **permanent
credential** — and `Lax` withholds the cookie from cross-site form POSTs while
permitting it on top-level cross-site GET navigations.

**Resolved by making no `/api/v1/` route accept a cookie at all.** The token
bootstrap moves to an HTML form POST at **`POST /builtin/tokens`**, under §6.3's
reserved built-in prefix, authenticated by the session cookie and served by the
built-in UI's mint pane. `POST /api/v1/tokens` answers a cookie with a `401`.
Its sibling `POST /builtin/tokens/revoke` lets an operator holding only a
browser revoke a leaked token without first holding another one.

Two properties are stated as load-bearing rather than incidental: the mint is
**POST-only and no GET form may ever exist**, and the route is not part of the
`v1` contract §2.1 versions — it is HTML surface, which §8.1 already establishes
carries no version promise.

The alternatives are recorded with why they lose: minting over SSH needs SSH,
which is off by default and whose enablement is itself an authenticated action
through the daemon (circular); minting at first-run setup means `POST /setup`
returns a credential the wizard does not ask for.

**§3.3 was sharpened, not softened.** Its API-path CSRF claim is now
unconditional, and the residual — a same-origin bundle submitting the mint form
with the operator's cookie — is stated as a **fifth named attack** the design
does not stop, with the reason a CSRF token would not stop it either.

## Resolution 2 — §2.1 versus §6.1: the version set

§2.1 named a versions array; §6.1's start-up check compared against a single
value. **Resolved** by naming the `versions` array of `GET /api/versions` the
**served set**, and making §6.1's class-5 check **membership in that set**,
deactivating only on an **empty intersection** — never on inequality with
`current`. A bundle that supports `v1` and `v2` against a daemon serving `v1`
is fine, and the old check would have deactivated it.

## The citation handed down that did not hold

This task's package asserted that `docs/plan/PLAN-006.md` **Part I** requires
the rollback direction. **It does not.** Verified against the tree:

- PLAN-006 Part I is *"Update policy configuration"*
  (`docs/plan/PLAN-006.md:228-231`) and says nothing about migrations.
- The requirement is **Part J, "Upgrade boundaries"**: *"machine config (STATE)
  | Untouched; versioned migrations must support rollback direction"*
  (`docs/plan/PLAN-006.md:241`), restating PLAN-005 Part I's *"Schema changes go
  through versioned migrations that must also support the rollback direction"*
  (`docs/plan/PLAN-005.md:260`).
- The error did not originate in the package. `docs/design/mosd.md:64` says
  *"PLAN-006 Part I requires the rollback"* — PLAN-006 renumbered the part
  PLAN-005 called I, and the design document never followed.

**The requirement is real, so the finding is unaffected; only the pointer was
wrong.** The task wrote what it found rather than what it was told, and routed
the `docs/design/mosd.md:64` correction onward rather than editing a file it did
not own — that file is outside this campaign's fence.

It is recorded here because it is the third time in two campaigns that a wrong
claim arrived from a **trusted source** rather than from carelessness. That is
the argument for the rule: a task instructed to verify rather than transcribe
catches what a task instructed to be careful cannot.

## The dead-code finding, and the correction that made it stronger

RFCT-066 established by execution that an A/B rollback across a schema bump
fails the settings load. This task restated it as the defect class it is:
**the backward migrations are dead code in production** — not "rollback can
fail", but machinery that exists, is registered, passes its tests, and cannot
be reached from any production path.

**The package assumed two `down` steps had test coverage. Running the suite
showed four.** The count was corrected **upward**, which makes the finding
sharper rather than weaker — four tested-and-unreachable backward migrations is
a stronger statement than two.

Executed at `86cd669`, and independently reproduced by RFCT-067:

```
$ cargo test --manifest-path mosd/Cargo.toml -p mosd-settings
test result: ok. 36 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out
```

- `down` is a required trait method (`mosd/mosd-settings/src/migration.rs:23`);
  **all four** shipped migrations implement it (`:115`, `:143`, `:186`, `:247`),
  all four are in the default registry (`:74-81`), and `migrate` walks them
  descending whenever `from > to` (`:46-56`).
- **One production caller**, and its `to` argument is the constant
  `SCHEMA_VERSION`, so it can only walk upward:

  ```
  $ grep -rn --include=*.rs 'migrate(' mosd/mosd/src mosd/webd/src mosd/mosd-settings/src \
      | grep -v 'src/migration.rs'
  mosd/mosd-settings/src/store.rs:68:        migrate(&mut doc, from, SCHEMA_VERSION)?;
  ```

- All **seven** descending call sites in the tree are tests, in
  `mosd/mosd-settings/tests/settings.rs`.
- The one situation a `down` step was written for — an older binary meeting a
  newer tree — never reaches the migration machinery at all: the guard at
  `store.rs:63-67` returns before `migrate` at `:68` is called.

**No `down` step this project has ever written has run on an appliance.**
§10.3 item 5 names it as an instance of the recurring class — a control that
exists, is tested, and is never invoked — alongside
`access.console.shellEnabled` and `identity.rs` `verify_password`. **No
resolution is proposed**; the three admissible ones (a pre-rollback downgrade
hook, a tolerant load path, or written acceptance that a schema bump forfeits
rollback) stand as the owning decision.

## What it did NOT do

- **It did not edit §9.** Item 8 of §9 was written against the contradiction
  resolved here, so its verdict and two quoted sentences no longer describe the
  document. §9 belongs to RFCT-066; this task **cited it and routed the
  restatement as §10.3 item 14** rather than editing across the boundary. That
  inconsistency is live at campaign head and is reported as such by RFCT-067.
- **It did not delete §10.3 items 2 and 3.** They are kept with their
  resolutions recorded, so the register shows what was resolved and how, not
  merely what remains.
- **It did not fix `docs/design/mosd.md:64`.** Routed; the file is outside the
  fence.
- **§10.3 item 1** — §2.1 versus §4.1 on whether today's paths are reserved —
  was **not** in scope and remains open.

## Scope fence

Sections 0 and 1 not edited; the hash at `docs/task/RFCT-063.md` still holds at
this task's merge. `docs/design/mosd.md`, `docs/plan/PLAN-005.md` and
`docs/plan/PLAN-006.md` were read and cited, never edited.

No product code changed. The test run above executed nothing that outlives it
and left the worktree clean.
