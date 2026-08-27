# RFCT-082 Reach the unreachable rollback path, and stop the stale documentation lying quietly

- **status**: completed — the tolerant load is product code with five tests; four documents record decisions; seven translations carry staleness banners
- **priority**: P0
- **owner**: (bkd campaign)
- **createdAt**: 2026-08-21 04:40
- **claimedAt**: 2026-08-21 04:45
- **completedAt**: 2026-08-21 05:30

Base `1b5d796` (RFCT-081's commit).

## Description

A user review re-confirmed eight findings against the tree; each was
re-verified here by running it rather than reading it before anything was
changed. Verdicts first, because one of the eight did not survive
verification:

| finding | verdict |
| --- | --- |
| `store.rs:63` refuses newer schemas before `migrate()` — down-migrations unreachable from production, rollback = mosd crash loop, gates api.md §8.2 phase 2 | **confirmed**, matches api.md §10.3 item 5 exactly |
| access.md claims sealed / META lockdown exist | **did not reproduce** — §5.2 is `[not implemented]` with *"None of that exists"*, §5.3 is `[partial]` naming `sealed` as missing; the English document is honest |
| `.zh.md` documents state a superseded security claim | **confirmed and sharper**: `access.zh.md` still opens with shell/SSH *"彻底不存在"* in prod, which §5.3 explicitly withdrew; the English side's stale-notice is in the English file, invisible to the Chinese reader |
| api.md §2/§3 still `[proposed]`, no `/api/v1`, no bearer auth | **confirmed** (§3.1's `[implemented]` is a measurement of the session mechanism, not of an API) |
| phase 5 (upload route) and 6 outstanding; installing a UI needs SSH | **confirmed** (§5.3 names both install paths as shell paths) |
| M6 balena-engine at `/srv/balena-engine` outstanding | **confirmed** (PLAN-010:676-691, user decision recorded, not started) |
| xattr preservation not demonstrated end-to-end | **confirmed, and the verifier already says so itself** — the both-empty PASS message at `os/verify-image-v2.sh` §xattr names it a tripwire, not a proof |
| §10.3 item 15: §0 claims marker-convention sameness falsely | **confirmed** — four markers vs three, overlap two |

Verification also surfaced one finding nobody had listed: **api.md
contradicted itself about phase 4** — §4's preamble said *"§8.2 phase 4 has
since landed"* while §8.2's table still carried `not started` in that row.

## The rollback decision, taken

The user chose, of §10.3 item 5's three admissible resolutions, **the
tolerant load path with the loss accepted in writing**. Implemented in
`mosd/mosd-settings/src/store.rs`:

- `Store::load_with_report` no longer refuses `schema_version >
  SCHEMA_VERSION`. It strips the keys this schema does not know — serde's
  `deny_unknown_fields` rejection names one key per pass; the strip is
  recursive by name and bounded — and parses what remains. This is
  mechanically the loss `mosd.md` §5.2 already priced for a down migration:
  *newer-only keys are dropped, the device falls back to this version's
  behaviour.*
- A future schema that **reshaped** an existing key defeats stripping; the
  load then falls back to `Settings::default()` — reported, never an error.
  The written acceptance (now in `mosd.md` §5.2): that case abandons every
  setting including the admin credential and returns the device to setup
  mode, priced against the alternative the old code delivered — a crash loop
  on the rolled-back-to slot that fails its health gate too, leaving **no**
  confirmable slot. The rule it binds schema authors to: prefer additive
  bumps; a reshaping bump forfeits settings on rollback and its migration
  must say so.
- `Store::load` keeps its signature and delegates; mosd calls
  `load_with_report` and logs the report at start-up (`warn!` for stripped
  keys, `error!` for the defaulted case) — `mosd/mosd/src/main.rs`.
- The current-version contract is deliberately unchanged: an unknown key in a
  document at `SCHEMA_VERSION` is still a load error, because on the
  non-rollback path silent dropping would hide corruption. Tolerance is
  strictly a property of the newer-schema branch.
- The down-migrations stay registered and tested — they are simply no longer
  the (unreachable) rollback story.

Five tests in `mosd-settings/tests/settings.rs`: additive-bump survival
(admin hash intact, report names the dropped key), reshaped fall-back to
defaults, unchanged strict semantics at the current version, the
save-after-rollback that persists a clean current-version document, and
recursive same-named stripping. **§8.2 phase 2's gate is open.**

## The documentation changes

| file | change |
| --- | --- |
| `docs/design/api.md` §10.3 item 5 | resolution appended (kept, per §10.3's no-deletion rule) |
| `docs/design/api.md` §8.2 | phase 4 row: `not started` → landed with campaign named; the "nothing has an owning campaign" paragraph re-anchored to its period; phase 2's gate noted open |
| `docs/design/api.md` §0 | item 15's second option taken: sameness claim replaced by the named two-taken/two-dropped/one-added divergence, with the reason `[partial]` is deliberately unrepresentable |
| `docs/design/api.md` §10.3 item 15 | resolution appended |
| `docs/design/mosd.md` §5.2 | the written acceptance, in the document that owns the migration pattern |
| 7 × `.zh.md` (`access`, `mosd`, `boards`, `provisioning`, `remote-management` under design/, `architecture`, `README`) | staleness banner: lags English, English authoritative, revival parked with the user (RFCT-045) |
| `docs/design/access.zh.md` | additionally, the three superseded claims named — the withdrawn "no shell in prod" security claim first |

`display.zh.md`, `init-strategy.zh.md`, `os-comparison.zh.md` carry no banner:
each is in step with its English sibling by date and content.

**The sealed/META finding produced no change**, recorded here so it is not
re-raised: access.md already marks §5.2 `[not implemented]` and §5.3
`[partial]`, states "None of that exists", and calls the lockdown an open
product decision. "记为推迟" is the existing state of the English document;
what was missing was the Chinese reader's view of it, which the banner now
provides.

**The xattr, M6 and phase 2/3/5/6 findings produced no change**: each is
future work with an honest owner already on record (RFCT-017/verifier message,
PLAN-010 M6, api.md §8.2), and nothing about them was misdocumented.

## Checks run

| command | result |
| --- | --- |
| `cargo fmt --all --check` | pass |
| `cargo clippy --workspace --all-targets --locked -- -D warnings` | pass |
| `cargo nextest run --workspace --locked` | **392 tests, 392 passed** (387 + the five above) |
| `cargo deny check licenses bans advisories` | ok |
| `make docs-verify` | 273/273 PASS (predicted +3 for this record: 270 + 3) |
| `make docs-verify-test` | 8/8 |
| `make os-health-test` / `os-shadow-test` / `os-ui-location-test` | 54/54, 220/220, 14/14 |

## What is NOT claimed

- **No hardware, and no rolled-back device.** The tolerant path is proven
  against fixture documents in a temp dir, not against a STATE partition
  written by a real newer image — no v5 schema exists to write one. The
  reshaped-schema fixture is a synthetic worst case.
- **The serde error-message dependency is real.** `unknown_field_name` parses
  serde's `` unknown field `x` `` spelling. The workspace pins toml to the
  0.9 line and the additive-bump test fails loudly if the spelling drifts;
  if it does, stripping degrades to the defaulted fall-back — lossy, but
  never the crash loop.
- **Setup-mode exposure is accepted, not solved.** The defaulted fall-back
  reopens LAN-claimable setup mode. That is the accepted written cost; a
  future mitigation (e.g. preserving the credential subtree by a stronger
  parse) belongs to whoever ships the first reshaping bump.
