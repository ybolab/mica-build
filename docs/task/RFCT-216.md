# RFCT-216 rauc-sign root-rotation tooling, before the first ceremony's one-year expiry

- **status**: completed — `rotate-root` publishes a cross-signed `<n+1>.root.json` and `refresh-root` republishes over the same key; 12 tests in a new `tests/rotation.rs` prove both directions of the overlap window and seven refusals, one of them found by executing the runbook's literal commands through the CLI; `docs/design/release-signing.md` §1.6 rewritten from **[not implemented]** to a six-step **[runbook]**; online-key revocation is still not implemented and is now said so narrowly; RFCT-210 marked a dated record with both census floors moved in the same commit (os 1847->1768, docs 303->278)
- **priority**: P1
- **owner**: bkd/dcg5mmqd
- **createdAt**: 2026-08-28
- **completedAt**: 2026-08-28
- **plan**: PLAN-023 (Amendment 1, decision 3), PLAN-027 M2

The key-custody decision (option A: vendor-held offline single root) makes
root rotation load-bearing: without a rotation command, the TUF root's
1-year horizon turns option A's fleet-wide failure mode from a risk into a
certainty on a timer, and a compromised online key ends the repository's
lineage. The signing tool has no command that produces a rotated root today,
and the design records the 1-year horizon as the deadline for building it.

Scope when claimed: `os/pkgs/rauc-sign` — a rotation command producing a new
root signed by the old (the TUF cross-sign), tests over the verifier's
acceptance of the rotated chain, and the ceremony runbook's rotation section
made executable. Delegated roles (option C's prerequisite) are adjacent but
not required here.

## Dependencies

- **blocked by**: (none — claimable any time; the deadline is the first
  production ceremony + 1 year)
- **blocks**: any option-C migration; the first annual root refresh.

## 1. What shipped

**Two commands, not one.** `root.json` expiring is two ceremonies with
different obligations afterwards, and the missing tooling was blocking both:
§1.6 recorded that the annual same-key refresh "is blocked on the same missing
rotation command" as rotation itself, because `init` refuses an existing
repository and nothing else republishes root.

- `rotate-root --repo --keys-dir --new-keys-dir --root-expires` — the incoming
  key takes the root role; the published `<n+1>.root.json` is signed by the
  outgoing key **and** the incoming one.
- `refresh-root --repo --keys-dir --root-expires` — same key, later expiry, no
  change of anchor and nothing to redistribute.

They share one implementation (`repo::rotate_root`, with `new_keys_dir:
Option<&Path>`) and are separate at the CLI so neither is reachable by omitting
an argument to the other. Rotating to the key that already holds the role is
refused and the refusal names `refresh-root`.

**The outgoing key is revoked, not merely superseded.** It is pruned from the
new root's `keys` map, not left listed and unbound. Leaving it could not make it
authoritative — verification only counts a signature whose key id the role
itself lists — but which listed keys still count is the last question an
operator reading a trust anchor should have to answer.

**Neither ceremony reads an online key.** No top-level role's metadata pins
`root.json`, so `targets`, `snapshot` and `timestamp` keep their existing
signatures; they are refreshed afterwards by `sign` on the release host. This
matters to the custody model rather than to convenience: §1.5 moves the online
keys to the release host, so a root command that demanded them would require
carrying them back into the offline room.

**Two checks that were not asked for and are load-bearing.** `tough` skips its
own signature-threshold check when the role is root, with the comment "since for
root the check depends on cross-sign" — so a caller that assembles the key set
wrongly gets a silently under-signed root back. Both halves are therefore
checked here, before anything is written: a threshold of the outgoing root's
keys, and a threshold of the new root's own. Those two calls are exactly what a
client pinned to the old anchor and one pinned to the new anchor each perform.
Separately, the anchor being rotated *from* is verified against its own keys
before it is built on: it arrives on media, and a partial or substituted copy
would otherwise be discovered by the fleet, after the ceremony, with the key
sealed away again.

**A published root version is never rewritten.** If `metadata/root.json` is a
stale copy of an older version — the shape a partial media copy leaves — the
next ceremony would otherwise overwrite an already-published `<n>.root.json`
with a different document under the same name.

**`gen-dev-keys --role`** (repeatable, defaults to all four) so a rotation
ceremony generates the incoming root key alone. Generating all four would put
spare copies of the release host's online keys on offline media the ceremony
never uses, each then needing its own destruction record.

## 2. The tests, and why they are one suite

`os/pkgs/rauc-sign/tests/rotation.rs`, twelve tests, deliberately not split
along the signer/device line the other two suites follow. The property under
test is that a device pinned to the **outgoing** anchor reaches the incoming
one; the signer half alone proves nothing about it, so both halves of each
scenario sit in one test.

Accepted:

- a client pinned to the anchor from the first ceremony walks forward to the
  rotated root, and the same document is asserted to carry two signatures, to
  name a different key, and not to list the outgoing key at all;
- a client pinned to the new anchor verifies;
- a release published after the rotation with the unchanged online keys
  verifies from **either** anchor — rotating root must not cost the repository
  its ability to publish;
- a refresh extends the expiry, names the same key id, is signed once (the
  cross-sign degenerates when one key is both), and verifies from the unchanged
  anchor.

Refused:

- a rotation signed by the incoming key **alone**. It is internally consistent
  and the new anchor accepts it — asserted in the same test — and the outgoing
  anchor refuses it. That contrast is the cross-sign's entire purpose;
- a rotated root whose **outgoing** signature does not verify. The test rewrites
  the file through `serde_json`, so it first asserts that an unmodified round
  trip still verifies: the refusal must be the flipped signature, not the
  reordering of JSON members;
- a withdrawn rotation, as a root rollback caught by the persistent state file
  across a restart — every signature in what remains is valid, and only the
  device's memory says the repository went backwards;
- rotating to the incumbent key, with nothing published by the refusal;
- rewriting a published root version, with the published bytes asserted
  unchanged;
- rotating from an anchor its own keys do not sign;
- rotating, or refreshing, with the **wrong outgoing key** — see below;
- `--role` with a name that is not a role.

Keys are generated by each test into its own `TempDir` and thrown away with it,
as the other two suites already do. No fixture holds key material.

**One test came from running the runbook rather than from writing it.** §1.6's
literal commands were executed once end to end through the CLI — `gen-dev-keys`,
`init`, `add`, `gen-dev-keys --role root`, `rotate-root`, `sign`, `verify` from
both anchors, `rauc-verify` from the old anchor, then `refresh-root` a year on
and `verify` from the *original* anchor again, which reported `OK root v3`
across a two-link chain. That exercise surfaced the operator error the suite had
no test for: the wrong sealed media, so `--keys-dir` holds a root key that does
not hold the role. Nothing upstream of the write notices — the document is
signed, by a key, and is self-consistent — and only the fleet would refuse it,
after the ceremony, with the key sealed away again. The pre-write check against
the outgoing root is what makes that a refusal in the room, and it now has a
test on both the rotation and the refresh path.

## 3. The runbook

`docs/design/release-signing.md` §1.6 was **[not implemented]**, stated
honestly. It is now **[runbook]**, six numbered steps: generate the incoming key
(rotation only), publish, media and minutes, refresh the online roles on the
release host, prove it from the anchor devices actually hold, distribute.

Three things the rewrite had to get right that the old text did not have to:

- **The two ceremonies are told apart before the commands appear**, because
  conflating them is the operational failure. The section opens by naming which
  is which and what each obliges afterwards.
- **`rauc-sign verify` is not the in-room check.** At a root's annual expiry the
  `timestamp` horizon (two weeks, §1.4) is long past, so `verify` fails on
  expiry — an obvious step to write down that would fail every time it was
  followed. Verification is step 5, after the release host refreshes the online
  roles; the in-room guarantee is the pre-write check in §1 above.
- **Intermediate root files are never deleted.** A device offline across several
  rotations walks the chain one version at a time; a gap is where its walk stops,
  permanently. Nothing previously said so.

§1.4's `root` row now names the two commands instead of "the offline ceremony,
repeated (§1.6)". `os/pkgs/rauc-sign/README.md` drops "root key rotation" from
the out-of-scope list, gains a section on the two ceremonies, and has one
tradeoff corrected that this change falsified: the image-baked anchor bullet
said "rotating the TUF root *requires* shipping an image through the RAUC
channel", which the cross-sign makes untrue — a baked anchor now follows a
rotation without an image update, and the RAUC channel is needed only for first
trust and for re-anchoring a device whose chain is broken.

## 4. What did NOT ship

- **Replacing a compromised *online* key.** `rotate-root` carries the
  `targets`, `snapshot` and `timestamp` key bindings forward unchanged; no
  command binds a *different* online key into a new root version. §1.6 said
  this was "the same missing operation" as rotation. It is now a narrower and
  differently-shaped gap — the mechanism that republishes root exists, the
  ability to change what it says about the online roles does not — and §1.6 and
  the README both say so under **[not implemented]**. A compromised online key
  therefore still ends the repository's lineage.
- **Multi-key roles and thresholds above 1.** Unchanged: §1.3's constraint
  stands, and the cross-sign implementation is written against thresholds
  generally rather than against one key per role, but nothing was built or
  tested above 1.
- **Delegated targets roles**, hardware-backed key stores, the Uptane
  director/image split, and the RAUC CMS hierarchy (§2). Out of scope as filed.
- **Anchor delivery to a device.** Still no shipped mechanism; the crate
  README's provisioning section is unchanged. Rotation no longer needs it,
  which is what the cross-sign buys; first provisioning still does.

## 5. Residue

- **Root metadata is not byte-reproducible**, and this predates the change.
  Measured: five `init` runs over the *same* key directory and the same explicit
  expirations produced five distinct sha256 images of `metadata/1.root.json`,
  carrying one and the same signature. `Root.keys` and `Root.roles` are
  `HashMap`s and `serde_json::to_vec_pretty` emits them in iteration order,
  while the signature is computed over canonical JSON — so the signed payload is
  reproducible and the file is not; the whole diff between two runs is the order
  of the members of the `keys` object. §1.3's claim that a ceremony's output
  "can be re-derived to check the media" therefore holds for what is signed, not
  for what is written, and §1.5's "record its sha256 in the ceremony minutes"
  records a number a re-run will not reproduce. A rotation adds a second
  instance of the same thing (`tough`'s signing key list is also a `HashMap`, so
  the ORDER of the two signatures varies too, though not their bytes). Not fixed
  here: the fix is a canonical serializer on the write path, it changes `init`'s
  output as much as the ceremonies', and whether §1.3/§1.5 should promise byte
  reproducibility or stop implying it is the prior question.
## 6. The RFCT-210 marker, its census cost, and the floor move

Everything about this decision is here, in one place, so the census history is
readable without git archaeology.

**Forced by.** This task's rewrite of `docs/design/release-signing.md` §1.6,
from **[not implemented]** to a runbook. That rewrite is the whole point of
RFCT-216, and it deletes the prose four of `docs/task/RFCT-210.md`'s citations
quote. Under the campaign's lazy-marking rule the marker is spent at the moment
of breakage, by the workstream whose change forces it, in the commit that
forces it. That is this one.

**The four broken citations, and why none could be re-quoted instead.** Each
fragment was searched for across every tracked file. All four are gone from the
source the citation asserts about — not moved within it:

- *"`rauc-sign` has no command that produces such a file"*
  (`docs/task/RFCT-210.md:693-694`) — **absent** from
  `docs/design/release-signing.md`. It is the sentence this task exists to
  falsify.
- *"a compromised online key ends the repository's lineage"*
  (`docs/task/RFCT-210.md:695-696`) — **absent**. §1.6 still makes the claim,
  but as "still ends", so no verbatim fragment survives.
- *"the 1-year horizon in §1.4 is the deadline for building it"*
  (`docs/task/RFCT-210.md:697-698`) — **absent**. Deleted; the deadline was met.
- *"rotation, so the chain is depth one in practice"*
  (`docs/task/RFCT-210.md:767-768`) — **absent** from
  `os/pkgs/rauc-sign/README.md`, deleted from its out-of-scope list.

Each fragment does still appear in exactly two places, and neither is a
legitimate re-quote target: `docs/task/RFCT-210.md` itself, which is the citing
document quoting its source, and this file, which quotes them in order to
explain that they were deleted. Re-pointing a citation at either would change
what the record asserts — from "the design document says X" to "a document
quoting the design document says X" — which is the falsification the marker
exists to prevent. So the marker could not be shrunk below four.

A fifth citation fails and is **not** in that class: *"No such bind exists yet,
deliberately"* (`docs/task/RFCT-210.md:699-700`) quotes text that is intact and
has only moved down `release-signing.md` as §1.6 grew. Re-anchoring it would
falsify nothing. It is subsumed by the marker rather than fixed by it, and if
the marker is ever lifted that citation needs re-anchoring, not repair.

**Two citations elsewhere were ordinary drift, and were re-anchored rather
than exempted.** The crate README's out-of-scope list gained a bullet, so the
line reading *"a separate key hierarchy applied"*
(`os/pkgs/rauc-sign/README.md:52`) moved down one. The failing citation quoted
*"is a separate key hierarchy"* (`docs/design/api.md:3917`); a second, quoting
*"a separate key hierarchy"* (`docs/design/remote-management.md:135`), was
passing only because its fragment happened to land inside the stale two-line
range, and was corrected anyway — a citation that resolves by luck reads
exactly like a correct one. Both were re-derived by grepping the moved text in
the post-edit file, never by applying an offset, and both now name
*"a separate key hierarchy applied"* (`os/pkgs/rauc-sign/README.md:52-53`).

**The collateral, priced at both ends.** A marked document contributes zero to
the in-scope census: the checker `continue`s before incrementing the
per-segment count. Measured on this branch with the gate's own
`extract_citations`, `docs/task/RFCT-210.md` carries **114 in-scope citations**
(plus 6 no-slash forms the scope rule drops anyway). Only 4 are broken, so
**110 still-valid citations leave the corpus**:

| segment | in scope | forced red | collateral | armed (content-checked) | resolution-only |
| --- | --- | --- | --- | --- | --- |
| `os/` | 81 | 1 | 80 | 41 | 40 |
| `docs/` | 33 | 3 | 30 | 17 | 16 |
| **total** | **114** | **4** | **110** | **58** | **56** |

The armed/resolution-only split is close to even — 58 of the 114 were being
content-checked, not all of them. This is a cheaper loss than the all-armed
shape found elsewhere in this workstream, and it is recorded that way rather
than assumed to match.

**The near-miss line moved too, and it is fully accounted for.** The run's
near-miss count — in-scope citations with no armed quote but a quoted span
within three words — was 352 at `c5f7e96` and stayed 352 across this task's
code commit and its §1.6 rewrite, which is the evidence that neither unarmed
anything. It moves only because `docs/task/RFCT-210.md` carries 19 near-misses
of its own and an exempted document contributes none. This task's own documents
contribute zero: every citation in this file is armed and content-checked.

**The floor move.** Both segments drop below their floors, so both floors move
in this same commit, per `docs/verify-citations-baseline.txt`'s own update
rule. The numbers are measured on this branch, not estimated:

| segment | floor was | floor now |
| --- | --- | --- |
| `os` | 1847 | **1768** |
| `docs` | 303 | **278** |

Base commit for the measurement: `c5f7e96`, this branch's dispatch point, where
the gate read 2170/2170 PASS. The drops are smaller than the exempted counts
(81 and 33) because this task adds citations of its own: 2 new `os/` and 8 new
`docs/`. These floors are this branch's honest numbers and nothing else — they
are deliberately **not** reconciled against any sibling branch that moves the
same floors, because floors are re-measured on the merged tree and never summed
across branches.

## 7. Residue, continued

- **The marker is file-scoped; the breakage is anchor-scoped.** Four dead
  anchors in an 834-line memo cost that memo's entire citation contribution:
  110 still-valid citations left the corpus to absorb 4 broken ones (§6).
  Nothing in the current mechanism can exempt a citation without exempting its
  document. That is the general shape of the problem, not a fact about this
  task, and it outlives this task.
- **If the marker is ever lifted**, the fifth failing citation —
  *"No such bind exists yet, deliberately"*
  (`docs/task/RFCT-210.md:699-700`) — needs re-anchoring rather than repair: its
  text is intact and has only moved. The other four have nothing to point at.
