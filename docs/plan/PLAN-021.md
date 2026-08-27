# PLAN-021 The defect and debt batch: sixteen filed tasks, the quick fixes, and the ghost sweeps

- **status**: approved
- **createdAt**: 2026-08-27 17:05
- **approvedAt**: 2026-08-27 17:05
- **relatedTask**: claims RFCT-094, 096, 129..134, 136..142; new tasks RFCT-180..199 reserved
- **milestones**: M1 the one-line and small fixes; M2 apid/mosd filed defects; M3 the ghost-reference sweeps; M4 closeout

## Context

User decisions (2026-08-27): every filed open task except RFCT-135 (which
grows into PLAN-022) is to be processed; the unfiled quick-fix batch and the
ghost-reference sweeps ride in the same campaign.

## Proposal

- **M1 quick fixes (RFCT-180..184 as needed)**:
  os/build/src/pin-seeded-times.test.ts afterAll gains beforeAll's timeout;
  the apid audit-trail flake (serialise or widen the 401/429 acceptance with
  the rate-limiter documented); test/apid-api/run.sh:254's dead instruction
  and the silent exit-1 on missing _out; checks.test.ts:26's vacuous
  assertion made real or deleted with its header; the three dead-code sites
  (os/verify/src/parity.ts, render-config.sh MOS_RAUC_TEMPLATE,
  identity.rs cfg(test) verify_password) — delete with the user's standing
  approval from this plan.
- **M2 filed defects, by cluster**:
  (a) credential and auth: RFCT-134 (password change: verify-old ->
  write-new via the settings tree, HTML pane + API route + section 2.4
  envelope; additive, oasdiff-clean), RFCT-131 (/healthz semantics),
  RFCT-140 (unify 502/503);
  (b) API/bus plumbing: RFCT-129 (uptime via mosd), RFCT-130 (split the
  three settings failures — needs the mosd bus.rs to_fdo split RFCT-130
  describes), RFCT-132 (cache or batch the per-request GetSettings),
  RFCT-133 (SettingsChanged reception);
  (c) hardening: RFCT-137 (apid unit sandbox), RFCT-138 (cargo-deny actually
  enforcing the no-C posture), RFCT-136 (bundle-store route or removal
  decision recorded), RFCT-141 (over-the-wire traversal coverage with a
  bundle-carrying fixture);
  (d) device: RFCT-142 (order the U-Boot env read against writers with a
  lock or single-owner rule), RFCT-139 (production keyring provisioning
  path, fail-closed stays but documented and testable);
  (e) test honesty: RFCT-096, RFCT-094.
- **M3 ghost sweeps (RFCT-190..194 as needed)**: the ~60
  os/verify-image-v2.sh and ~31 os/update/bundle.sh / os/mkimage-v2.sh
  provenance references across os/** rewritten to name what replaced them or
  marked as dated inline; the ~17 board/ tokens in os/** comments; the eight
  false "no rauc references" measurements in dashboard.md/api.md re-measured
  and restated; api.md:3464; uboot-ab-handshake.md:4/:17; the docs/README
  connd bullet; docs/task+research live citations IF PLAN-020 M3 has not
  already repaired them (coordinate, do not duplicate); the 7 .zh.md path
  tokens (user-approved as pure path-token edits).
- **M4** closeout: every claimed task completed or explicitly returned with
  a reason; verify-index/citations green; changelog entry.

## Ordering

M1 first (small, unblocks clean gates). M2 clusters may run parallel with
disjoint crates/files. M3 runs after PLAN-020 merges to main if that lands
first (its new gates then check the sweeps); otherwise sweep now and accept
PLAN-020 re-checking later — coordinator's call, stated in the snapshot.

## Scope

- **In**: os/pkgs/mosd/** (apid + mosd + settings), os/build/src,
  os/verify/src, test/apid-api, os/tests, the named docs files, .zh.md path
  tokens only, mosd dist units and policies as the defects require.
- **Out**: RFCT-135 / networking features (PLAN-022), bearer tokens and API
  phase 2, gate scripts (PLAN-020), dated records.

## Risks

- M2(a) and (b) change API behaviour: every route change must stay
  oasdiff-additive or carry an explicit version argument; RED-GREEN applies.
- The password-change write is the first post-setup writer of
  access.webAdmin: the gate's session semantics (all sessions invalidated?)
  must be decided and tested, not implied.
