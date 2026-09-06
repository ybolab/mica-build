# RFCT-340 The keyring rotation channel: decide it, and say what it costs

- **status**: completed
- **priority**: P0
- **owner**: bkd/jbdqxqd0
- **createdAt**: 2026-09-06 21:40

> The index line in `docs/task/index.md` is written by L1, not by this task.
> `scripts/task-state.sh claim` was deliberately not used: it edits the index
> under a lock, and this branch must not touch it.

## Description

PLAN-037's Gate A has five items. Four are settled: the ceremony is a human
act documented by `docs/design/key-delivery.md`, a shipped image provisions
its trust anchor (PLAN-070 F7/F8/F9), a device states whether it trusts a
development CA (`trust.grade`), and an image carrying a development keyring
cannot be published (`build/src/release-cli.ts`). The fifth is this one:

> A keyring rotation path exists that does not require an image signed by the
> key being replaced.

`docs/design/release-signing.md` carried it as an absence in three places, and
this task establishes what the answer is before building anything — which is
what the item needs, because the answer turns out to be mostly a decision.

## ActiveForm

Decided the keyring rotation answer, made the rollover's own instructions
executable, and corrected a stale gap marker

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

### The finding: the three markers are not one gap

The three `[not implemented]` markers in `release-signing.md` are a legend
(§0), the keyring gap (§2.4), and an unrelated update-workspace gap (§3.1).
Treating them as one would have rewritten a true statement about `mos-health`
into a false one about keyrings. They are resolved separately below.

### The constraint, which is what makes this a decision

Replacing a device's keyring needs authority, and there are exactly two places
authority can come from: a key the device already holds that is not the one
being replaced, or a human standing at the device. There is no third —
`docs/plan/PLAN-077.md` §6.2 argues it, and this task did not find a way
around it. The first is a second baked anchor, which is PLAN-077 §6's open
question and belongs to the user. So the 1.0 answer for CA compromise is
physical re-provisioning, and it is now **chosen with its reason** rather than
left as an absence.

### What was improved without touching that decision

The two uncovered cases are not symmetric, and only one of them was actually
irreducible.

**Case 1 — a device that missed the overlap window — did not need the third
key and does not need a reflash.** It is recoverable by an update, using only
mechanisms the tree already ships: republish the overlap release into a
*rescue repository* signed by the outgoing chain, then either override the
stranded device's `source.url` with `POST /api/v1/update/config`, or hand it a
§3.2 lockbox cut from that repository. It installs a bundle its own keyring
already trusts. This is not a second trust-anchor path — the only thing that
moves is where the device looks; the route used is the one whose 422 refuses a
trust anchor by name (PLAN-070 §5.3.5), so the write that performs the rescue
is mechanically incapable of naming a key.

**A rescue *channel* was the first design and the tree refuses it.**
`build/src/release-manifest.ts` holds `development`/`candidate`/`stable` as a
closed set and rejects an invented name, on the stated ground that a channel is
a promise about qualification; and `development` is the wrong one to borrow,
because a device parked there selects the newest target it finds, which on that
channel is by definition unqualified. A repository containing only the overlap
release has neither problem, because selection has exactly one candidate. The
cost is that it must be rooted at the same TUF root, and `init` is the only
command that loads `root.pk8` — so §1.3 now initializes it during the ceremony,
while the key is already out, rather than forcing a root-key checkout during an
incident.

**Four things had to be fixed for the route to be true.**

- §2.4 step 4 said "Destroy or retire the outgoing CA key". Destroying it at
  that step converts every missed-window device from recoverable into a
  reflash, permanently, because §2.2's expiry arithmetic applies: the shipped
  `[keyring]` carries no `use-bundle-signing-time` (asserted by
  `verify/src/checks-rauc.ts`'s `rauc-keyring-verifies-against-now`), so RAUC
  checks the signer against the current clock and an archived overlap bundle
  stops installing on its own. The rule is now retain-sealed-until-the-rescue-
  route-is-retired, with the cost of the longer window stated.
- §2.4 step 3 said convergence is "measured by whatever fleet telemetry
  exists", which is an instruction nothing could perform — PLAN-076's
  reporting plane is not shipped. It now names the one surface that answers
  today: the booted slot's `bundleVersion` from `GET /api/v1/system/info`,
  compared against the overlap release. Its three limits are written down with
  it — the version rule below, a never-updated device that reports no bundle
  version at all, and the fact that at 1.0 this is one device at a time
  through its API, which bounds the fleet size the procedure is practical for.
- §3 step 2 says `--bundle 1.2.3` and step 3 says `--release-version 1.2.3`,
  and nothing enforces that they agree. RAUC records the *bundle's* version in
  the slot it installs, and that recorded value is the only thing a fielded
  device can be asked about the release it is running — so two different
  strings make the convergence reading impossible rather than awkward. The
  rule is now stated where the bundle is built.
- §1.3 now initializes the rescue repository beside the production one, for
  the reason above.

No new code was needed for any of it: the version is already reported, and
`source.url` is already an operator-writable, administrator-authenticated
field — which is exactly what PLAN-070 §5.3.1 made it overridable for, *the
only exit from a device stranded by an address*.

### Why no keyring fingerprint was added to `trust`

A candidate design added the SHA-256 fingerprints of the certificates in
`/etc/rauc/keyring.pem` to mosd's `system.trust`, so convergence could be read
directly off the keyring. It was dropped: the booted slot's `bundleVersion` is
already reported and already answers the question, because every build between
§2.4 phases 2 and 4 carries the concatenated keyring by construction. A new
reported member, a snapshot schema bump and a redaction allowlist bump to
re-derive a fact already on the wire is not worth its own maintenance. The
three limits of the version reading are written into §2.4 phase 3 instead of
being papered over.

### What this task did NOT change, deliberately

- **PLAN-077 §6's open question is untouched.** Whether a third offline key is
  worth it is the user's, and `release-signing.md` §2.4a now says which way
  each half goes under each choice instead of guessing one.
- **No anchor moved and no code changed.** `pkgs/`, `rootfs/`, `build/`,
  `verify/` and both Rust workspaces are byte-identical to main. This branch
  is documentation only, so no channel enum was widened, no reported member
  was added and no operator schema key was created.
- **§3.1's `mos-health` half of its marker stays `[not implemented]`.** It is
  true: `pkgs/mosd/mosd/src/update_lifecycle.rs` says so at the site that
  needs the entry.
- **`docs/plan/index.md`, `docs/task/index.md` and `docs/CHANGELOG.md`** are
  L1's.
- **`docs/design/updates.md` §1016's provisioning bullet** names the same
  `/var/lib/mos/update/` tree and was left alone: it is `updates.md`'s own
  list and correcting it there is that document's task, not this one's. Only
  the `release-signing.md` restatement was corrected.

### The stale marker, corrected

§3.1 said "nothing provisions the `/var/lib/mos/update/` tree that policy
defaults to for the metadata mirror and rollback state". Both halves are
provisioned on demand today and were verified in the tree:
`pkgs/rauc-sign/src/update.rs`'s `sync_metadata` creates the mirror's metadata
and targets directories, and `pkgs/rauc-sign/src/client.rs`'s `save_state`
creates the state file's parent before the atomic write. mosd passes both
paths (`--repo`, `--state`) from the effective policy. Only the `health.boot`
half of that marker survives.

### Files touched

`docs/design/release-signing.md` (§0 legend, §1.3, §2 header, §2.3, §2.4
phases 3 and 4, new §2.4a, §3 step 2, §3.1's marker),
`docs/design/key-delivery.md` §7, `docs/design/security-lifecycle.md` §1.2,
`docs/user/security.md`'s named-gap bullet with its `docs/zh/user/security.md`
translation and the `docs/zh/README.md` coverage stamp, and this record.
`docs/zh/design/` was **not** updated: it is outside the coverage table's
gated trees (`user`, `website`, `bsp`), it lags the English design tree
already, and translating two long runbook sections is not this task.

### Verification

- `make docs-verify` — all five gates, from a `git archive` of the branch into
  an empty directory.
- No Rust or TypeScript changed, so no build or image gate was run; `git diff
  --stat main` is the evidence.
