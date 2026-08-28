# RFCT-216 rauc-sign root-rotation tooling, before the first ceremony's one-year expiry

- **status**: completed — `rotate-root` publishes a cross-signed `<n+1>.root.json` and `refresh-root` republishes over the same key; 11 tests in a new `tests/rotation.rs` prove both directions of the overlap window and six refusals; `docs/design/release-signing.md` §1.6 rewritten from **[not implemented]** to a six-step **[runbook]**; online-key revocation is still not implemented and is now said so narrowly
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

`os/pkgs/rauc-sign/tests/rotation.rs`, eleven tests, deliberately not split
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
- `--role` with a name that is not a role.

Keys are generated by each test into its own `TempDir` and thrown away with it,
as the other two suites already do. No fixture holds key material.

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
## 6. `docs/task/RFCT-210.md`, and why it is now marked a dated record

`docs/verify-citations.sh` was green at 2170/2170 before this change and went
red at six citations after it. Two are ordinary drift in live design documents
and were re-anchored mechanically from the pre-image, in their own commit:

| citation | was | is |
| --- | --- | --- |
| `docs/design/api.md:3875` → `os/pkgs/rauc-sign/README.md` | `:51` | `:52` |
| `docs/design/remote-management.md:135` → same file | `:51-52` | `:52-53` |

The second was still passing — its quote happened to land inside the stale
range — and was corrected anyway; a citation that resolves by luck is the case
the gate's own header warns cannot be told from a correct one.

The other four are all in `docs/task/RFCT-210.md`, and four of them cannot be
re-anchored, because the text they quote no longer exists anywhere:

- `RFCT-210:694` quotes *"`rauc-sign` has no command that produces such a
  file"* — the sentence this task exists to falsify;
- `RFCT-210:696` quotes *"a compromised online key ends the repository's
  lineage"* — §1.6 still says this, but as "still ends", so the fragment no
  longer matches verbatim;
- `RFCT-210:698` quotes *"the 1-year horizon in §1.4 is the deadline for
  building it"* — deleted; the deadline was met;
- `RFCT-210:768` quotes *"the signer cannot yet produce a rotation, so the
  chain is depth one in practice"* — deleted from the crate README;
- `RFCT-210:700` quotes *"No such bind exists yet, deliberately"*, which is
  intact but has moved down the file as §1.6 grew.

Rewriting the first four is impossible and rewriting the fifth alone would
leave a record half-repointed at a tree it never measured. RFCT-210 is a
completed decision memo (`status: completed`, `completedAt: 2026-08-28`) that
declares its own freezing in its second paragraph — *"Every line number below
was read at `6950f69`, this branch's HEAD"* — and 34 sibling task records
already carry `<!-- dated-record: ... -->`, the exemption
`docs/verify-citations.sh`'s header prescribes for exactly this: *"Their
citations name where things WERE, and re-pointing them at today's tree would
falsify the record."* The marker was added, in its own commit.

The cost is visible rather than silent, which is the point of the census: the
run's "exempted as dated records" count goes 34 → 35 and names the file, and
RFCT-210's citations — 56 unquoted plus the quoted ones — stop being checked.
Whoever revisits that trade should know the alternative was to leave four
citations pointing at sentences that were deleted on purpose.

## 7. Residue, continued

- **RFCT-210's citations are now unchecked.** See §6. If the key-custody memo
  is ever re-measured against today's tree rather than read as a record of
  2026-08-28, the marker should come off with that re-measurement.
