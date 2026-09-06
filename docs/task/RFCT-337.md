# RFCT-337 Document key delivery: produce, hand over, place, verify

- **status**: completed
- **priority**: P1
- **owner**: bkd/qjq7dk6b
- **createdAt**: 2026-09-06 19:10

> The index line in `docs/task/index.md` is written by L1, not by this task.
> `scripts/task-state.sh claim` was deliberately not used: it edits the index
> under a lock, and this branch must not touch it.

## Description

`docs/design/release-signing.md` is a complete set of runbooks for the person
standing in the ceremony room: §1 the TUF root ceremony, §2.1 the offline RAUC
CA ceremony, §2.2 signer reissue, §2.4 CA rollover, §2.5 the exact `cp`/`chmod`
lines that place material on a build host, §2.6 the domain/key table, §3
bundle signing, §3.2 the offline lockbox.

Nothing in it addresses the party on the other end of a delivery: an integrator
who receives material, an operator told to place it, or the engineer asked a
year later whether what is on this build host is the right material at all.
That handover is what this task writes, without restating a single ceremony
step.

No new plan: the decisions are already made and recorded (PLAN-070, PLAN-077,
PLAN-078). This documents them from the recipient's side.

## ActiveForm

Documented the key handover: inventory, travel rule, delivery form, receiving
checks and refusals

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

- Delivered as [`docs/design/key-delivery.md`](../design/key-delivery.md), a
  new design page, with its index row in `docs/README.md`, a pointer from
  `docs/design/release-signing.md` §0, and an English-only row in
  `docs/zh/README.md`'s design list.
- **Placement argument.** `docs/user/` and `docs/website/` address integrators
  and `docs/design/` addresses this repository's engineers, and this delivery
  has readers on both sides — but every step of it happens *in a checkout of
  this repository*: material is placed into the gitignored `meta/`, the
  refusals that catch a bad delivery are `rootfs/build.sh`'s, and the receipt
  is `bash verify/run.sh --verify`. That is design-record subject matter. The
  user-doc contract also forbids narrating implementation and requires a
  truth-status line per capability claim; a page whose content is entirely
  build-host mechanics would either violate that or be gutted to satisfy it.
  A `docs/user/` page was therefore not written. `docs/user/security.md` is
  where a user-facing pointer would go if one is later wanted; none was added,
  because adding one costs a `docs/zh/` mirror and a status line for a claim
  this task did not independently verify from the user's side.
- **Chinese coverage.** `docs/zh/verify-coverage.sh` gates `user`, `website`
  and `bsp` only; `docs/zh/design/` is a curated partial mirror with no gate in
  either direction. So no coverage row was owed and none was added. The new
  page is left **untranslated**, listed in `docs/zh/README.md` as `仅英文`,
  which is the precedent `native-applications.md` already sets there. That is
  the one thing left lagging.
- **Every check in the document was run.** `git ls-files meta/` (0 rows);
  `tests/trust-domain-hygiene-test.sh` (8/8); `rootfs/build.sh`'s A1 and A2
  green on this tree's material and refusing twice on material deliberately
  made wrong (an RSA-2048 CA, and an ECDSA key in the package role — the
  second with A1 still green, which is the asymmetry the document states);
  `bash verify/run.sh --verify` on all three boards (x64 315/315, cx3576
  418/418, virt-arm64 313/313), quoting `packed-keyring-from-meta`,
  `packed-meta-is-the-public-set` and `no-private-key-in-baked-meta`;
  `verify/run.sh src/checks-root.test.ts` (68/68) for the production-shaped
  reading of the marker biconditional; `build/run.sh
  src/release-manifest.test.ts` (128/128) for the publication gate;
  `openssl verify` and `openssl x509 -dates` for the chain and the 45-day
  window.
- **What could not be verified, and was therefore not claimed.** (1) No
  production material exists or can exist in this repository, so every run was
  against development-grade material; the document says so at each quote and
  reaches the production reading only through a check whose fixture is that
  shape. (2) The device-side half — `GET /api/v1/system/info` reporting the
  grade, and `rauc install` accepting a production-signed bundle on a booted
  device — was not executed; the document states the first as what the build
  and the image checks establish (the marker is baked iff the tree has it) and
  the second as §2.3 already does, documented and not tested. (3) The build's
  private-key staging refusal (B1) and the release gate's refusal text were
  observed only through green runs of the suites that drive them, not by
  triggering them by hand; the document says which of its refusals were fired
  directly and which were not.
- **Throwaway mutations, all outside the tracked tree.** The gitignored
  `meta/` and `_out/debs/amd64` were populated in this worktree to run the
  checks (`_out/debs/amd64` copied from `/srv/mos`, `meta/` written by
  `pkgs/rauc/gen-dev-keys.sh --if-absent`), and `meta/rauc/ca.cert.pem` and
  `meta/updates/root.key` were temporarily replaced with wrong-algorithm
  material to fire A2 and then restored/removed. No tracked file was touched
  by any of it; one interrupted `rootfs/build.sh` compose was killed before it
  produced an image. No script was changed.

## Acceptance

- A delivery document exists that answers, in order: what is produced, what
  travels and what never does, how it is delivered, how a recipient verifies
  what they received, and what happens when it is wrong.
- It duplicates no runbook from `release-signing.md` and links to each.
- Every check it names was run and its output quoted verbatim.
- `make docs-verify` green on all five gates, run from a `git archive` of this
  branch into an empty directory rather than from the worktree.
