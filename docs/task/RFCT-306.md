# RFCT-306 The update and fleet URLs become changeable, the anchors do not

- **status**: completed
- **priority**: P2
- **owner**: url-override-amendment/bkd-63ugffmi
- **createdAt**: 2026-09-04 18:00

## Description

DESIGN AMENDMENT ONLY. The user requires that the update server address and the
fleet control-plane URL both be changeable. Five approved plans forbid it and
must be amended: PLAN-070, PLAN-071, PLAN-072, PLAN-076 and PLAN-054. No new
plan record, and no implementation — the slices that would carry this are not
dispatched, and a half-changed schema is worse than an unchanged one.

The constraint the amendment is built around: **the URL becomes overridable,
the trust anchor never does.** `manifest.json`'s `trust.signingKeys` and the
RAUC keyring stay baked in the verity root with no layer-2 override and no
on-device write path, and the schema must make an override of a trust key a
load error in the same shape `deny_unknown_fields` gives the rest of the
document. The whole safety of a changeable address rests on the signature check
being unchangeable.

Both bakings being reversed are argued positions, not oversights — PLAN-070 §5's
*"the source URL joins the anchors on the build side"* and PLAN-072
Alternative 4's *"the baked URL ... is the property that makes §5's compromise
analysis hold"* — so the amendment states what changed in the reasoning, not
only in the conclusion.

## ActiveForm

Amending the approved plans so the two URLs are overridable and the anchors are not.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Acceptance

- The five plans amended in place, each amendment dated 2026-09-04, each
  engaging with the reasoning it revises.
- The backlog rows that are now wrong corrected in the tables that hold them,
  with their gates rewritten to match.
- `make docs-verify` green.
- `docs/plan/index.md`, `docs/task/index.md` and `docs/CHANGELOG.md` untouched.
- Nothing implemented; no schema code; no change to how anchors are baked.

- complete: the five plans are amended and the two URLs are overridable
  defaults, with the anchors held on the build side by a schema fact rather
  than a rule.

  **The decision as recorded.** `update.source` and `fleet.url` become
  **defaults** overridden through PLAN-070 §5.1's existing layer 2 — the source
  in `/mos/config/updates.json`, the plane in `/mos/config/fleet.json` — with no
  new mechanism. The trust anchors do not move, the operator schema has **no
  `trust` object at all**, and naming a signing key, keyring or root path in a
  `/mos/config/` document is a load error asserted **by name** per key rather
  than only by the generic unknown-key path, because a generic assertion goes
  green the day somebody adds a `trust` object for a benign reason.

  **What changed in the reasoning, per plan.**

  - **PLAN-070 §5.3** (new, with §5.3.1–§5.3.5) is the argument. Against §5's
    own sentence: *"the trust-relevant path"* was doing two jobs — the path that
    decides **what installs** (the signature check, in the verity root) and the
    path that decides **where the device looks** (the URL). Removing the URL
    knob bought safety on the first only to the extent that they are the same
    path, and they are not. The new weight is the plan's own §5.2.1 boundary,
    written *after* that paragraph: `/mos/config/` holds what an integrator
    sets, its test for which side a fact belongs on is *does tier 1 clear it*,
    and both addresses answer yes. And the strongest argument is the plan's own
    F11 residue — a stranded device with no remedy but a new image or an offline
    import — which this change turns into one authenticated API call.
  - **PLAN-072 §8** re-derives §5's compromise analysis heading by heading
    instead of asserting that it survives. Tenant isolation, replay and
    stolen-device credentials are untouched; the compromised-plane heading's
    *what it does not get* list — no payload, no configuration write, no shell,
    no reboot, no rollback — is enforced **device-side** and none of those
    enforcements consults the recipient's address. So Alternative 4's claim that
    the baked URL *"is the property that makes §5's compromise analysis hold"*
    over-reads its own analysis: the baked URL narrowed the set of parties who
    could choose the recipient; it never bounded what the recipient gets.
  - **PLAN-071 §10**: §9's two mechanisms were built against a *substituted*
    source, and an operator substituting one deliberately is that same input by
    another route, so they apply unchanged.
  - **PLAN-076 §11**: §1's four questions never ask who is listening and §4's
    containment invariant is checked against a constant in the image, so the
    rule and the field set do not move at all.
  - **PLAN-054**: *one plane per image* was derived from the baked URL and from
    nothing else; it is replaced by **one baked default plane per image, with
    the effective plane per device**.

  **The four questions the amendment had to work out.**

  1. **Does the redirect buy an attacker anything on the update path?** No new
     denial: the same writer can already set `policy = "off"`. No install: the
     device refuses every package not signed by a baked key. PLAN-071 §9.1's
     floor and §9.6's freshness bound **are** sufficient for rollback and
     freeze. Two things they were never about are named and closed, and the
     first is the only place the amendment would otherwise have *created* a
     capability: (a) the same-origin credential base is pinned to the **baked**
     `update.source` and `http.credentialHosts`, so an override moves the
     request and never the credential and a non-same-origin override is fetched
     anonymously; (b) the check itself discloses board/profile/version/channel
     to whoever answers, bounded by what selection needs.
  2. **The fleet URL is not the same case and is not argued as one.** There is
     no signature check standing behind the recipient, so a redirect is a real
     exfiltration path. Priced honestly, and narrowed to what is actually new:
     the switch was **already** in the writable document, so what the amendment
     adds is *to whom* a device reports, not *whether* it reports. What leaks is
     bounded by PLAN-076 §1/§2 and holds against any recipient because the
     allowlist is in the image. Accepted with three requirements the approval
     boundaries now carry: a URL change discards the enrolment credential
     (PLAN-072 C1), `GET /api/v1/fleet/status` reports the **effective** URL
     (PLAN-076 B9), and §6a's off-state test resolves the **configured** host
     (PLAN-076 B8).
  3. **What this removes** is F11's residue, and it is recorded as the reason
     the trade is worth making rather than as a bonus.
  4. **Layering**: PLAN-070 §5.1's table gains two moved rows and nothing else.
     The baked value is a **default** — not a fallback and not a floor: an
     override that does not answer reports the failure and never reverts to the
     baked address, on the same reasoning §5.1 already applies to an unpublished
     channel. Reset is §4.1's existing table with no new mechanism: tiers 1 and
     3 re-seed `/mos/config/` and restore both baked defaults, tier 2 leaves
     them.

  **Two defects found on the way, both created by the amendment's premise and
  both fixed.**

  - **PLAN-071 §9.1 and §6 said the downgrade floor and the suppression store
    live "beside the policy on STATE".** After PLAN-070 F6b the policy is on
    DATA, so the phrase points at the store the redirect is written to —
    following it literally would let one atomic rename both re-point the device
    and lower the floor, and §9.3's *"a floor a remote party can lower is not a
    floor"* would hold only on a technicality. Both are corrected to STATE with
    two independent reasons, and PLAN-070 §5.3.4 and its approval boundary pin
    it from the other end.
  - **PLAN-076 §6a's off-state negative test watched the *baked* host.** Against
    an overridable URL that test passes while a re-pointed device dials
    somewhere else — a check that cannot fail on the defect it exists for. It
    now resolves the configured host, and B8's gate says so.

  **A third document still asserting the old rule: none found, and the one
  measurement that went the other way.** A sweep of `docs/design/`, `docs/user/`,
  `docs/website/`, `docs/zh/` and the other twenty-nine plan records for
  `fleet.url`, `update.source`, `source.url` and baked-URL phrasing returns
  nothing outside the five amended plans. Four documents name
  `/var/lib/mos/update-policy.toml` (`docs/design/updates.md` §2,
  `docs/design/mosd.md`, `docs/design/release-signing.md` and its zh mirror);
  none of them asserts the baked rule — they describe the shipped file, and
  PLAN-070 F10 and F6b already own moving them.

  What the sweep did turn up is that
  `pkgs/mosd/mosd/src/update_policy.rs` **already** carries `source.url` as an
  operator-settable `Option<String>` with no default, refusing a check with *"no
  update source configured (source.url is unset)"*. So F6b's gate *"a document
  naming a source URL is a load error"* would have turned a working shipped
  configuration into a load error on the first boot after the move. The
  amendment therefore does not add a capability; it declines to remove one, and
  PLAN-070 §5.3.1 records that measurement rather than the assumption.

  **Nothing implemented**, as required: no schema code, no change to
  `trust.signingKeys` or to how anchors are baked, no new mechanism where
  §5.1's layers already answer, and `fleet.reportIntervalSeconds` deliberately
  left baked with the reason stated.

  Verified: `make docs-verify` green (183 index, 446 link, 733 status, 231 zh
  coverage, 43 board assertions). `docs/plan/index.md`, `docs/task/index.md` and
  `docs/CHANGELOG.md` untouched.
