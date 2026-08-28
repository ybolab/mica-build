# PLAN-023 API phase 2: bearer tokens, the write surface, and the health route

- **status**: approved (design-first for the write surface)
- **createdAt**: 2026-08-28 07:30
- **approvedAt**: 2026-08-28 07:30
- **relatedTask**: RFCT-210..219 reserved
- **milestones**: M1 write-surface design, USER-GATED; M2 bearer tokens per api.md section 3.2; M3 GET /api/v1/health and the 405 envelope; M4+ set by the ratified design

## Context

PLAN-016 shipped the read-only slice and deferred, by decision: bearer tokens
(api.md section 3.2 — `access.apiTokens` on the settings tree, SHA-256 with
constant-time compare, creation via an authenticated session, revocation by
id, no expiry while nothing reads a wall clock), the write/action surface
(section 2.3's inventory), GET /api/v1/health (section 2.4's third case,
needs its own gate exemption), and the 405-vs-envelope behaviour on declared
routes. PLAN-021 added POST /api/v1/actions/change-password and recorded
token-revocation-on-password-change as open in api.md section 2.3; PLAN-022
added the network write surface for its own panes. api.md sections 2-3 are
the design of record; sections 4-9 remain unmeasured (RFCT-207's residue).

## Proposal

- **M1 (RFCT-210)** the write-surface design, user-gated: section 2.3's
  operation inventory re-measured against today's HTML surface (which grew
  password-change and the network kinds since 86cd669); the write routes
  classified (settings writes, collection resources for SSH keys and WiFi
  networks, actions); the token-revocation-on-password-change semantics
  decided; the key-custody decision memo for the user (RFCT-139's open
  product decision: who holds production signing keys, where, rotation
  cadence — options with costs, user rules).
- **M2 (RFCT-211)** bearer tokens exactly per section 3.2, additive;
  oasdiff-clean; the section 6 lockout interaction tested.
- **M3 (RFCT-212)** GET /api/v1/health (gate-exempt, 200 in both states,
  mosd reachability in the body) and the 405 §2.4 envelope on declared
  routes; both additive.
- **M4+** the ratified write surface, milestone per resource cluster.

## Scope

- **In**: os/pkgs/mosd/apid/**, mosd-settings (the apiTokens model),
  openapi.json, .github check steps, test/apid-api phases, docs/design/api.md
  status annotations.
- **Out**: api.md sections 4-9 rewrite, UI redesign, .zh.md.

## Amendment 1 — M1 ratified and the three decisions (user, 2026-08-28)

1. **Auth model: dual-credential with an in-plan cutover.** `/api/v1/` accepts
   bearer OR the existing session cookie from RFCT-213 onward. The cookie's
   acceptance on `/api/v1/` is removed by a NAMED milestone of this plan
   (scheduled after the mint pane ships and test/apid-api drives bearer
   end-to-end), so api.md section 3.2's bearer-only statement is false only
   for a bounded, in-plan window. Section 3.2 gains a dated note at that
   milestone, not before.
2. **The revised M1 design is ratified as written**: the M4-M8 write-surface
   split; the collection error contract (absent identifier 404, malformed
   422, one shared helper, paired cross-surface tests); the network cluster
   typed with the raw passthrough answering 409; token revocation on
   password change stays OUT with the password pane carrying the ratified
   sentence verbatim; the rotate-key 422->404 correction rides M6 as a mosd
   change; the peer-add finding is confirmed-or-refuted by M6's acceptance
   test.
3. **Key custody: option A** — vendor-held, offline, single root, per the
   ceremony and horizons already written. Root-rotation tooling is scheduled
   unconditionally as RFCT-216 (pending, deadline: before the first
   ceremony's one-year expiry); options C/D remain reachable later since the
   rotation work is prerequisite to both.
