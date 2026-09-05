# RFCT-329 The documents PLAN-070 F10/F11 and PLAN-071 U9 owe

- **status**: completed
- **priority**: P1
- **owner**: plan070-f10-f11-plan071-u9/bkd-eeme30d5
- **createdAt**: 2026-09-05 06:00
- **baseline**: `9243aeea`
- **worktree**: `/srv/bkd/worktrees/33z9aa5q/eeme30d5`, branch `bkd/eeme30d5`

## Description

Three documentation slices, taken as one task because **F10 and U9 both
rewrite `docs/design/updates.md` §2** and two branches on that section would
conflict on the paragraph that matters most.

- **F10** (PLAN-070) — the design tree catches up to the `meta/` seam and the
  `/mos/config/` namespace.
- **U9** (PLAN-071) — `updates.md` §2, §3, §5, §6 and `remote-management.md`
  §3.
- **F11** (PLAN-070) — the operator documentation: which resets return the
  device to its baked defaults, and §5 consequence 4's residue in its amended
  form.

## ActiveForm

Writing what the last three weeks made true into the design and operator
trees.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Acceptance

- `make docs-verify` — **all five gates green**, run after every batch:
  `verify-index.sh` 183/183, `verify-links.sh` 456/456, `verify-status.sh`
  738/738, `zh/verify-coverage.sh` 231/231, `bsp/verify-board.sh` 43/43.
- The `updates.md` §2.3 JSON example extracted and checked **mechanically**
  against `pkgs/mosd/mosd-settings/src/configuration.rs`: every key present in
  the matching struct's serde names (so `deny_unknown_fields` accepts it), no
  key matching `ANCHOR_KEYS`, every enum value a real variant, `schema` equal
  to `UPDATES_SCHEMA_TAG`, and the `auto`-needs-a-window rule not tripped.
- Every `rauc-update` / `rauc-verify` invocation in every file touched,
  re-read against `src/bin/*.rs`'s clap definitions after the edits: no
  `--root` survives on either device binary.
- `docs/plan/index.md`, `docs/task/index.md`, `docs/CHANGELOG.md` untouched.
- No code changed. The diff is documentation only.

## 1. The premise that had already been discharged

The brief's first instruction was to fix `updates.md` §2's
*"PLAN-061 keeps small authoritative metadata on STATE and sends only large
bytes to `/mos`"*, which RFCT-314 left for F10. **That sentence is not in the
tree.** RFCT-321 (`a27ca75c`, in `main`) rewrote §2 when it found the example
there taught a load error, and left a blockquote saying F10 owns the full
rewrite. What F10 actually owed was therefore the rest: the **tier, home and
format** of the move, which is now §2.1, and the placeholder blockquote,
which is gone.

## 2. What each page got

**`docs/design/updates.md`** — the largest change.

- **§2.1 (new)** — the move: STATE→DATA, `update-policy.toml`→
  `/mos/config/updates.json`, TOML→JSON, one decision each, with the reason
  the tier-1 property STATE gave for free is *kept* rather than lost.
- **§2.2** — the two layers, the four overridable keys, absent-versus-`null`,
  and the address/anchor split stated as the line PLAN-070 §5.3 drew.
- **§2.3** — the document with every key, plus the **six anchor-shaped key
  names refused by name** at any depth, and why a by-name scan buys something
  `deny_unknown_fields` does not.
- **§2.4 (new)** — what a reset does to the document, both faces of it.
- **§3.1–§3.3** — what each key gates; what `auto` does in four steps with
  its **fifteen deferral reasons** tabulated by step; a channel or address
  change and what it may select.
- **§3.4 (new, `[not implemented]`)** — the write route, from PLAN-071 §3's
  five bullets, marked so the document does not claim it exists.
- **§3.5 (new)** — attribution: what holds, and the gap (§4 below).
- **§1** — `deferred` and `suppressed` documented beside the state table.
  Beyond the brief's list; §3.2 and §5 refer to both and a state model that
  omitted them would be self-inconsistent.
- **§5.1** — the automatic path walks the same steps; `deferred` is what to
  read when nothing appears to happen.
- **§5.3** — `--root` removed, with the reason its absence is the design.
- **§5.4 (new)** — the server has moved: three routes back, the reset as a
  fourth that points backwards, and the narrowed stranded case.
- **§5.5** — support data, and that the trail covers operator actions only.
- **§6** — the automatic path has no rows because it has no unit column: a
  table of what is owed, in the order to write it.
- **§7** — three of its four owed items closed; each recorded rather than
  deleted, because §1 and §2 make claims a reader will check here.

**`docs/design/recovery.md`** — §2.1's clarifying note (the slot columns
cover the baked configuration and the anchors, because those are files in the
root filesystem), and `[^cfg-mos]` extended to name the address the tier
returns, including the `null` case. The tier-1 footnote and `config/` in
`[^apps-mos]` were already there: F6c landed them, as PLAN-070 §4.1 assigns.

**`docs/design/release-signing.md`** — the baked-anchor paragraph in §3.1;
`--root` removed from `check`, `fetch` and `import`; §2.3's TUF half answered
and the honest cost of both hierarchies riding one road stated; §2.5's last
paragraph replaced; **§2.6 (new)** is PLAN-070 §6.2's custody split with the
three-key table and the rule that `root.key` is present on a release host
while `ca.key.pem` is not; §4 gains two rules and corrects one that the split
made false (see §4 below).

**`docs/design/provisioning.md`** — **§4.0 (new)**: the pour, placed beside
the five channels and argued as *not* a sixth, with the three properties it
inherits and a `[partial]` status that separates the shipped reader from
F6g's boot-time validation.

**`docs/design/manufacturing.md`** — §1: the trust anchors are not a factory
input today, and `meta/` is a versioned build-host input a recall must reach.

**`docs/design/security-model.md`** — §3: the TUF bullet moves to
`[implemented]` on the device side, and the "not fielded" claim is replaced
by three narrower ones, including that a default build trusts nothing for
packages and says so.

**`docs/design/remote-management.md`** — §3 rewritten: the on-device pull
exists, apid declares update routes, the device now initiates on its own and
that capability is untested, where the address comes from and what a reset
does to it, and what a fleet plane still could not set.

**`docs/design/mosd.md`** — one paragraph: the update policy no longer lives
in `update-policy.toml` on STATE.

**`pkgs/rauc-sign/README.md`** — the anchor section rewritten as *Trust
anchors* (settled, not owed), `--root` removed from six invocations, and four
prose sentences that described a pinned-root deployment corrected.

**Operator docs (F11)** — `docs/user/recovery.md` Step 3 carries the warning
in full with both cases and how to tell them apart, Step 6 inherits it, and
Step 4 is explicitly excluded. `docs/user/update-rollback.md` §2 gains the
three-value mode with its rules, where the settings live, and the three
routes back with the stranded case; §4 says where each anchor comes from; §5
replaces the retired anchor debt with `auto`'s missing tests and the missing
write route. `docs/user/configuration.md` had two false sentences about
settings living on STATE; corrected, with the reset boundary stated.

## 3. Chinese mirrors

**Gated** (`docs/zh/verify-coverage.sh`) — `docs/zh/user/{recovery,
update-rollback,configuration,security}.md` translated for every changed
passage, including the new `> status:` line in `update-rollback.md`, and the
four coverage rows moved to `9243aeea`.

**Ungated, mirrored anyway** — `docs/zh/design/{release-signing,
remote-management,provisioning}.md`, the three design pages I edited that
have a mirror. `release-signing.md` gained §2.6 and the anchor paragraph;
`remote-management.md` §3 was rewritten; `provisioning.md` gained §4.0.

**Ungated, left lagging** — listed rather than hidden:

- `docs/zh/design/{mosd,api,access,connd}.md` trail their sources, which
  RFCT-314 recorded and this task did not close. `mosd.md`'s lag now includes
  §5.1a and the paragraph corrected here.
- `docs/zh/design/provisioning.md` is mirrored only for §4.0 and the one §4
  status paragraph corrected below; the rest of the page still trails.
- `docs/design/{updates,recovery,security-model,manufacturing}.md` have **no**
  Chinese mirror, so nothing is owed for them.

## 4. Findings — sentences the tree contradicted

Five, each fixed where it stood and each named because a reader would
otherwise have believed it.

1. **`updates.md` §2's stale sentence was already gone** (§1 above). The
   brief's starting point had been discharged by RFCT-321.
2. **The automatic path writes no audit event.** PLAN-071 §3 requires
   `update-check`/`update-fetch`/`update-install` from automation,
   distinguished by an actor field. Those three are recorded in
   `pkgs/mosd/apid/src/update_api.rs`, **on the routes**, and the driver does
   not pass through apid. What *is* true is that the driver acts under
   `SENDER = "auto-update"`, so `install.requested_by` distinguishes it.
   §3.5 states both halves; the design was not written as though it shipped.
3. **`release-signing.md` §4 said the root key never touches a networked
   machine.** True of the TUF root-role key and of the RAUC CA; **false of
   `meta/updates/root.key`**, which §2.6 establishes must live on a release
   host because it signs every package. The bullet now names the two
   separately, with the reason one sentence could not cover both.
4. **Three states, two messages.** PLAN-071 §4 requires *the channel is
   empty* and *the channel has nothing newer* to be distinguishable. The
   client reports its selection and not the target list, so both reach mosd
   as `Settled::NoneCompatible` and both record `no-newer-release`. §3.3
   states what the tree does and names the gap.
5. **Five pages outside F10's list still said no image provisions the
   anchor** — `mosd.md`, `api.md`, `website/security.md`, `bsp/assurance.md`,
   `bsp/cx3576-example.md` — and `docs/zh/user/security.md` still said it
   while its English source had been corrected. All six fixed. The coverage
   gate cannot see that last one: it compares status lines, not prose.

## 5. Out of scope, and deliberately touched anyway

Three edits go beyond the three lists, each because it was a false statement
in a page the change made a reader more likely to open:

- `docs/user/configuration.md` (+ mirror) — "persisted on the STATE
  partition" and "Settings persist on STATE".
- `docs/design/mosd.md` — `update-policy.toml` on STATE.
- The five pages of finding 5, and `docs/zh/design/provisioning.md` §4's
  status paragraph, which claimed none of the five channels is implemented
  while its English source says channels 1, 2 and 4 are.

## 6. NOT verified, and owed

- **No Rust test ran.** This task changed no code and executed none. Claims
  about `update_auto.rs`, `configuration.rs`, `reset.rs` and `anchor.rs` are
  traced from the source, not observed from a run — except the §2.3 example,
  which was checked mechanically against the reader's serde names rather than
  deserialised by the reader itself. Driving that example through
  `configuration::load_updates` in a test would close the gap properly and is
  the smallest item here.
- **The three concurrent branches had not landed.** `main` was still at
  `9243aeea` at the final merge, so F6g (the pour), U11/U8/U7 (the write
  route, audit actor and console) and U6 (mosd's confirmed-boot fact) are all
  absent from the tree these documents describe. Three sections turn on that
  and will need a re-read when those merge: **§3.4** (the write route is
  marked `[not implemented]`; if U11 landed, the marker comes off and §3.5's
  audit gap may close with it), **`provisioning.md` §4.0's `[partial]`
  status** (F6g), and **`updates.md` §5.2's sentence that closing the
  install-order gap needs mosd's own confirmed-boot fact** (U6).
- **`updates.md` §5.2's rollback section was not re-derived.** It is U6's
  ground and this task left it as found.
- **`docs/user/security.md`'s named gaps** were read and left: they are
  correct as written.
- **The `docs/zh/design/` lag** of §3, which needs its own pass.
