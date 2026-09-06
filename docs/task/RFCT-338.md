# RFCT-338 Gate C: adopt the 35 recovery/access triage rulings

- **status**: completed
- **priority**: P1
- **owner**: bkd/7julx51i
- **createdAt**: 2026-09-06
- **baseline**: `d4ca794660e2259e43ba9dc346b34bee074235d0`
- **worktree**: `/srv/bkd/worktrees/33z9aa5q/7julx51i`, branch `bkd/7julx51i`

> The index line in `docs/task/index.md` is written by L1, not by this task.

## Description

[PLAN-037 Gate C](../plan/PLAN-037.md) requires that every `[partial]` in
`docs/design/recovery.md` and `docs/design/access.md` end as either the
capability it claims or an explicit non-capability, and that no customer-facing
page describe as available anything the tree marks `[partial]` or `[proposed]`.
[RFCT-316](RFCT-316.md) triaged all 35 markers and recorded 2 complete / 28
downgrade / 5 legend rulings. This task adopts them.

Documentation only. A `complete` ruling is a claim about code that already
exists; no code was written, and the two complete rows were verified at the
source before their markers moved.

## ActiveForm

Adopted the 35 Gate C rulings across both design documents and the customer
pages that contradicted them.

## Dependencies

- **blocked by**: RFCT-316 (the rulings), RFCT-322 (the F3 fix and the residue
  measurement)
- **blocks**: PLAN-037 Gate C

## What was adopted

All 35, in RFCT-316's own order.

### recovery.md

| ID | Ruling | Adopted as |
|---|---|---|
| R01, R02 | legend, retain | §0 keeps both definitions; a new paragraph records that no *section* carries `[partial]` any more and why `[partial]` stays defined |
| R03 | downgrade the four-tier product claim | §2 heading is `[implemented]` for the tiers that exist; a new paragraph says two of the four are operations an operator can run, names reflash as the lockout fallback and destruction as the disposal answer |
| R04 | downgrade tier 4 | the opening line now separates reachable tiers 1-2, unreachable tier 3 and absent tier 4 |
| R05 | downgrade "every node is a step"; keep the ordering normative | §3's section marker removed (it is an ordering, not a mechanism — §0's markerless list now includes it); the available sequence is stated in full |
| R06 | **complete** — the manual two-action workflow | §3 step 2 is `[implemented]`, "as an explicitly two-action workflow" |
| R07 | **complete**, same capability | the "what does not ship" bullet is now "the second action is deliberate": request rollback, then request reboot; one-click and fallback qualification explicitly not claimed |
| R08 | downgrade field credential recovery | §3 step 5 is `[not implemented]` as a field operation, with reflash and its costs as the operator's answer |
| R09 | downgrade field full-factory reset | §3 step 6 is `[not implemented]` as a field operation; the cleanup-scope half is deferred, see below |
| R10 | downgrade, shared with R04/R14 | §3 step 8 leads with "secure wipe is unsupported" and physical destruction |
| R11 | downgrade the presence capability | §4's heading splits: schema and gate `[implemented]`, field entry `[not implemented]`; "asserting recovery presence is unsupported" is stated as a capability |
| R12 | downgrade, shared with R08/R09 | the §4 back-reference now says steps 5 and 6 are `[not implemented]` as field operations |
| R13 | downgrade, shared with R11 | the section's field half stays `[not implemented]` until a board declares one — **and the one-use half of this ruling is declined as stale**, see below |
| R14 | downgrade tier 4 | §4.3 item 3: presence grants no secure-wipe operation because none exists |
| R15 | downgrade board actions, keep the schema | §4.4 heading reads "on every shipped board"; the enumeration is now three boards |
| R16 | downgrade automatic rescue and the guaranteed loop | §6.1 splits into loader behaviour `[implemented]` and on-device rescue `[not implemented]` |
| R17 | downgrade the repair tier | §6.2 is `[not implemented]`; "mos provides no dedicated non-destructive repair operation" |
| R18 | downgrade, shared with R19 | the offline bullet leads with "offline filesystem repair is not supported by the device" and states that mos guarantees no route preserving the damaged data |
| R19 | downgrade, shared with R18 | same bullet: no rescue boot entry, no recovery environment, and §6.3's BusyBox is deliberately not one |
| R20 | downgrade field qualification claims | §8's heading is "presence entry `[not implemented]` on every board"; a lead paragraph says no board has a qualified path and source availability is not a recovery level |
| R21 | downgrade, shared with R17 | the cx3576 row's repair reference is `[not implemented]` with the operator alternative in the same cell |

### access.md

| ID | Ruling | Adopted as |
|---|---|---|
| A01, A02, A03 | legend, retain | §0 keeps all three; a new paragraph records the Gate C end state, matching recovery.md §0 |
| A04 | downgrade the unmodelled settings | §3.3 states four unsupported settings, tells administrators to disable SSH explicitly, and says the fixed apid backoff is not the absent one |
| A05 | downgrade both later phases | §4.3 names the supported path that already exists and points total credential loss at §9 |
| A06 | downgrade irreversible lockdown | §5.2 says SSH is only reversibly disabled and that no irreversible shell disablement exists — plus F7's correction, below |
| A07 | downgrade the sealed image | §5.3's heading splits: two profiles `[implemented]`, sealed `[not implemented]`; "do not select mos for a requirement that shells be absent from the signed image" |
| A08 | downgrade the aggregate promise | §6's heading splits two/two and a lead paragraph states the guard and the ring as the whole of what ships |
| A09 | downgrade permanent lockout | the bullet says it is unsupported and not waiting on a schema change; the release path exists in code and is unreachable, which is why arming it would strand operators |
| A10 | downgrade lifecycle/upload | the bullet now preserves the events actually recorded and names what is absent |
| A11 | downgrade the five-path promise | §7's heading is "paths 1-2 `[implemented]`, paths 3-5 `[not implemented]`"; paths 1-2 are called a complete transport |
| A12 | downgrade captive setup | path 3 states the absence and that AP connectivity is not evidence of a portal |
| A13 | downgrade HDMI local setup | path 4 states the absence and the two alternatives |
| A14 | downgrade the console wizard | path 5 states that a serial login prompt is not a wizard |

### Adjacent corrections, each shared with an adopted row

RFCT-316's F rows are not part of the 35. Five were adopted because an adopted
decision cannot stand beside the sentence that contradicts it, and two because
a downgrade depends on the qualification:

- **F2** (§2.2) — replay after an interrupted apply is asserted; survival of a
  sudden power loss across two filesystems is not, and is no longer implied.
- **F4** (§4.2, §5.1 rule 4) — "every attempt is audited" is now best-effort,
  with the two branches that carry no recovery audit event named.
- **F5** (§5.3) — the `source` cell said the flow has no network peer by
  construction; it is an HTTP request and the source is the requesting peer.
  The event name is composed from the board's declared mechanism, not one of
  four constants.
- **F6** (§6.1) — "a device with two unbootable slots reboots in a loop" is
  now failure-dependent, and the x64 loader carries no unconditional reboot.
- **F7** (access.md header, §2, §5.2, §9.1) — four stale statements, in both
  directions: production images are not shell-free, BusyBox *is* shipped, the
  factory-reset executor *does* exist, and mosd *does* write presence
  assertions. Each is corrected without weakening the operator-facing answer.
- **F8** (§3 step 3) — "every modelled setting … all of them, at once" now
  names what the tier preserves by design.
- The unbracketed console-shell claim in access.md §2 is restated as the
  non-capability it is.

## What was declined, and why

- **R09's cleanup-scope half and all of F1.** RFCT-316 asks that the tier-3
  description say the executor "does not reinitialize all STATE". That is the
  factory-reset residue question, whose per-entry retain/wipe rulings this
  task's brief places with the user and whose input is RFCT-322 §5. §3 step 6
  therefore points at that measurement and says the row is the tier's declared
  scope rather than a handover guarantee, and decides no entry.
- **R13's one-use half, as stale.** RFCT-316 wrote that a future board entry
  "must also resolve the one-use and audit gaps". The one-use gap was closed
  between the triage baseline and this branch: `state.presence.spend()` now
  runs under a rotation lock held across the read, and §5.4 already records
  RFCT-322's measurement. §4 now says what a first board owes is the mechanism,
  its declaration and §8's evidence — not a system-layer contract gap. The
  audit half (F4) was open at the code and is adopted.
- **F3 as a downgrade.** Same reason: it is fixed, and the document already
  says so. It is recorded here as a ruling that no longer fits rather than
  applied.

## Rulings that no longer fit the tree

Three, all found by reading the code rather than the triage:

1. **Two boards became three.** Every ruling phrased "both boards" / "neither
   shipped board" now covers `cx3576`, `x64` and `virt-arm64`, all three of
   which declare `BOARD_RECOVERY_ACTIONS=""`. The substance is unchanged and
   slightly stronger. §8 gains a virt-arm64 row; §1 and §4.1's "both boards are
   I1" become "no board is above I1", since virt-arm64 makes no assurance claim
   at all.
2. **F3 is closed** (above).
3. **The rollback guard gained a first source.** `rollback_eligibility` now
   takes a `ConfirmedBoots` record and orders installs by mosd's own observation,
   falling back to `installed.timestamp`. RFCT-316's R06 caveat that eligibility
   is timestamp-derived is now only the fallback's caveat, and §3 step 2 already
   said so; the completion ruling is unaffected and the clock caveat is retained
   where it still applies.

## Verification of the two `complete` rulings, at the code

Required before a marker moves. Read on this branch, not taken from RFCT-316:

- `rollback_eligibility` (`pkgs/mosd/mosd/src/rauc.rs`) resolves the alternate
  slot and returns a named refusal for each of: no alternate, alternate is
  booted, never installed, marked bad, not the older install, unorderable, and
  booted-not-confirmed.
- `api_v1_update_rollback` (`pkgs/mosd/apid/src/update_api.rs`) reads that
  verdict, marks only `bad`/`booted`, audits, and returns
  `next_step: "POST /api/v1/actions/reboot"`. It does not dispatch a reboot.
- `api_v1_reboot` (`pkgs/mosd/apid/src/routes.rs`) is the separate action.
- The UI states the second action rather than leaving it to be inferred:
  `rollback-panel.tsx` renders `system.update.rollback.rebootToApply`, whose
  English string is *"This action does not reboot. Reboot the device to
  complete the rollback."*

The capability RFCT-316 called complete is therefore present in full, and the
`[partial]` marker was pessimistic about it.

## Customer-facing pages

`docs/verify-status.sh` gates the status lines; it cannot gate a paragraph.
Walked `docs/user/` and `docs/website/` for prose that the adoptions
contradicted:

- `docs/user/recovery.md` — §2's "reboots in a loop" is now failure-dependent;
  §3's decision table gains an "available today?" column and a paragraph saying
  five of eight steps are reachable; steps 5 and 6 move from
  `status: shipped` to `status: unsupported`, which is what the design page
  now says about them as field operations; §7's board count and its repair
  bullet are corrected.
- `docs/user/configuration.md` — said two of the five provisioning channels do
  not exist. Three do not: the HDMI local setup wizard was missing from the
  count.
- `docs/website/security.md` — "Production images are build-time sealed" reads
  as the `sealed` capability access.md §5.3 calls unsupported. Restated: the
  profile is immutable, the image is not shell-free, and `sealed` is neither
  implemented nor planned.
- `docs/website/embedded.md` — the recovery ladder was "built"; it is designed,
  five of seven rungs are reachable, and "nothing in the tree writes one" was
  F7's error. The absence paragraph also gains secure wipe's disposal answer
  and the repair/rescue absence.

Everything else already read honestly: `docs/user/security.md` and
`docs/user/storage.md` already state the lockout, the audit limits and the
seven unsupported storage lifecycle answers.

## Chinese mirrors

The coverage gate governs `docs/user/`, `docs/website/` and `docs/bsp/`, and
requires a `current` row's zh page to carry identical `> status:` lines.

- `docs/zh/user/recovery.md` — mirrored in full: §2, the decision table, both
  status-line changes and §7's two corrections. The status lines are
  byte-identical to the English page.
- `docs/zh/user/configuration.md` — the channel count mirrored.
- `docs/zh/design/access.md` — not gated (design zh pages are overviews), but
  it repeated F7's factory-reset error and the retired `[部分]` markers, so
  §2's three rows, §5.2, §5.3, §6 and §9.1 were brought into line.

**Left lagging, deliberately:** there is no `docs/zh/design/recovery.md` — that
page has never had a Chinese mirror, and creating one is a translation task
rather than part of this gate. `docs/zh/README.md`'s claim that every
`docs/design/` page has a Chinese counterpart was already false before this task
(`recovery.md`, and two pages the table marks 仅英文); it is not touched here.

## The surviving markers, and why each is legitimate

Re-derivable with `grep -c` on either file.

| | `[partial]` | `[not implemented]` |
|---|---:|---:|
| `docs/design/recovery.md` | 3 | 21 |
| `docs/design/access.md` | 3 | 15 |

**All six `[partial]` occurrences are the vocabulary, not a claim.** Each file
has one legend definition (`- **[partial]** — some of it exists…`) and two
mentions inside the §0 paragraph that explains why the definition stays. **No
section heading, bullet or table cell in either document carries one**, which is
the gate's condition.

**Of the 21 in recovery.md**, one is the legend definition and one is that same
§0 paragraph; the other 19 state or cross-reference **nine** distinct
non-capabilities, each with the operator's alternative in the same place:
secure wipe / tier 4 (§2, §3 step 8, §4.3); field credential recovery (§3 step
5); field full-factory reset (§3 step 6); the recovery-presence field entry
(§4, §4.4, §5); the on-device rescue environment (§6.1); the repair tier (§0,
§6.2, §8); offline filesystem repair (§6.2); the rescue boot entry (§6.2); and
a qualified per-board presence path (§8).

**Of the 15 in access.md**, two are legend definitions (`[partial]` and the
`[decided]`/`[not implemented]` example) and one is the §0 paragraph; the other
12 state **eight** non-capabilities: the four unmodelled settings (§3.3); the
two later authentication phases (§4.3); META lockdown (§5.2); the sealed image
(§5.3); permanent lockout (§6); session lifecycle events and upload (§6); and
the three local setup front ends (§7, one marker each). §2's console-shell and
rescue rows state their absences in the table's own unbracketed voice and are
not in this count.

**The `[not implemented]` count rose and that is the gate working**: a
downgrade turns a claim nobody can use into a named absence. The `[partial]`
count falling to the legend is the other half of the same move.

## Verification

- `make docs-verify` — all five, from a `git archive` of this branch into an
  empty directory rather than from the worktree: `verify-index` 189/189,
  `verify-links` 473/473, `verify-status` 734/734, `zh/verify-coverage`
  237/237, `bsp/verify-board` 97/97.
- `verify-status` fell from 738 to 734 because two `shipped — evidence: …`
  lines became `unsupported`, and an `unsupported` line is worth two checks
  where a two-reference `shipped` line is worth four.
- The zh status lines were diffed against the English page directly, not only
  through the gate.
- Not performed: no test suite, no compiler invocation, no runtime or hardware
  work. This task changed no code and none was needed.
