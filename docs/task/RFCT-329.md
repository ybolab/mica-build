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

## 7. Round two — U6 landed, and §5.2 was its ground

`bkd/eeme30d5` merged as `79fa2fe6`; U6 merged beside it as `fdd11c01`.
Round one left `updates.md` §5.2 alone and named it U6's; this round corrects
it against the merged tree, reading
`pkgs/mosd/mosd/src/{confirmed_boot.rs,rauc.rs,bus.rs,main.rs}` rather than a
report of them. **Two files, no others.** `make docs-verify` green:
183/183, 456/456, 738/738, 231/231, 43/43.

**`docs/design/updates.md`**

- **§5.2's rule sentence** — the target must be the strictly older install
  *by mosd's confirmed-boot record where it has observed both installs run,
  and by `installed.timestamp` only where it has not*, with the guard's own
  step quoted:
  `boots.older_install(target, booted).or_else(|| older_install(target, booted))`.
  The guard is no longer described as pure over two arguments; it takes three.
- **§5.2a (new)** — the record itself: `/var/lib/mos/update/confirmed-boots.json`
  on STATE (path confirmed at `main.rs:438`, `state_dir_for(…)/update/` plus
  `confirmed_boot::DEFAULT_FILE_NAME`); one entry per slot, written when mosd
  observes itself running from it; a minted `sequence` as the ordering key so
  it reads no clock; `firstSeenAt` recorded and never compared. Four
  properties that decide what it can answer: entry identity is the install
  (`is_about` compares slot **plus** bundle version **plus** install
  timestamp), first sighting wins, `None` rather than a guess, and neither an
  unparseable store nor a failed write is fatal or destructive.
- **§5.2's `install_order_unknown` row** — now *neither* source could order
  the two, not just the timestamps. The factory-flash case still refuses, and
  the row says why the record cannot rescue it: nothing ever booted the
  alternate.
- **§5.2's honest limit** — replaced. The clock gap is **narrowed, not
  closed**, in the form that names which device you have: a device that has
  taken at least one update under this code is on the strong story; a device
  whose only history predates it falls back to exactly the story it had.
  Making *mosd never saw the target run* a refusal of its own would close it
  and is deliberately not done — PLAN-071 §7 does not make that decision.

**`docs/design/recovery.md` §3 node 2** — the same three sentences in its
*Precondition*, *What the guard actually checks* and premise bullets. The
premise bullet is split in two: the record (`[implemented]`) and the premise
the fallback still stands on. Node 2 stays `[partial]`: the bench evidence it
was partial for is unchanged.

### The over-claim I nearly made, and the one I caught

**Not written:** that the record retires the RAUC-invariant derivation. It
does not. Concluding *the target is the older install* from *mosd saw it
running first* uses the same invariant — an install is written into the slot
the device is not running from and is booted after it is written
(`confirmed_boot.rs`'s "Why first-boot order IS install order"). What the
record removes is the dependency on a **clock**; what it additionally answers
is `recovery.md` §3 node 2's precondition **directly** rather than by
implication, because the entry exists only because mosd ran there. Both
documents now say exactly that, in both directions.

**Caught in review:** a first draft cited `recovery.md` §4.1 as where the
health gate owns PENDING_CONFIRM → CONFIRMED. §4.1 is the *physical presence*
gate. Corrected to name `rootfs/overlay/usr/lib/mos/mos-health` directly.

### Verified unchanged, and left alone

- `pending_not_confirmed` and its honest limit; the health gate's ownership of
  the confirm edge; equal timestamps still refusing as `install_order_unknown`
  (`older_install` returns `None` on equality, so the fallback refuses and the
  record has no entry to rescue it with).
- **The record surfaces no new live-state member.** `merge_into` takes
  `&ConfirmedBoots` and uses it only for `rollback`'s verdict, so
  `updates.md` §1's state model needed no change. Checked rather than assumed.
- **`updates.md` §3.4's `[not implemented]` marker and §3.5's audit-gap
  paragraph** — U11/U8 (`43mhi8ru`) still running, untouched per L1.
- **`provisioning.md` §4.0's `[partial]`** — F6g (`kl4k8pgb`) still running,
  untouched per L1.

### `docs/zh/` — zero work owed, and why

Neither file has a Chinese mirror: `docs/zh/design/` holds no `recovery.md`
and no `updates.md`. The coverage gate does not reach `docs/design/` either.
The `docs/zh/design/{mosd,api,access,connd,provisioning}.md` lag of §3 is
unchanged by this round.

### Still owed after round two

- **The record's own tests exist; the auto path's still do not.**
  `confirmed_boot.rs` carries 7 `#[test]` functions and `rauc.rs` 27, so U6
  arrived with evidence. `update_auto.rs` and `update_suppress.rs` still carry
  **zero**, so §6's table stands verbatim.
- The unobserved-alternate refusal, if PLAN-071 §7 is ever reopened.

## 8. Round three — U11/U8/U7 and F6g landed; the documents and the tree agree

Merged `main` at `88db4ae9` (past `39d67210` U11/U8/U7 and `f7b2429e` F6g)
before reading anything, and again before reporting. Every claim below was
checked in `configuration.rs`, `update_api.rs`, `bus_client.rs`, `audit.rs`,
`store.rs`, `documents.rs`, `bus.rs` and `automatic-updates-panel.tsx`, not
from L1's message. `make docs-verify` green: 183/183, 458/458, 738/738,
231/231, 43/43.

### The six L1 named

1. **`updates.md` §3.4 — marker off, section rewritten.**
   `POST /api/v1/update/config`, administrator-authenticated, driving the
   console's `AutomaticUpdates` panel. Three subsections, because three things
   a reader cannot infer: **it takes a patch** and why the read side forces
   that (a console reads the *resolved* policy; sending it back writes the
   image's defaults into the operator's layer and the device stops following
   its image) — with `UpdatesSourcePatch`'s two-key shape as the same argument
   in the schema; **the order is the property**, the seven steps of
   `write_updates` with the note that every refusal precedes every write, so
   *never replaced by one that would fail to load* is a shape rather than a
   promise; and **three refusals, three answers** as a table — 422 the patch,
   409 the document on the device, 500 the disk — with the reason a corrupt
   document is not blind-overwritten and that the way out is the reset of
   §2.4.
2. **`updates.md` §2.4** — the *until the write route exists* clause is gone;
   the per-key route back is now `{"source": {"url": null}}` and the contrast
   with a reset is stated (a reset spends every key to recover one).
3. **`updates.md` §3.5 — rewritten around the actor field**, three values in
   a table, with `device` given the paragraph it earns: it was not in the plan,
   and recording an action nobody asked for as an *operator's* would be the
   exact lie the field exists to prevent. Also here: one ring, two daemons,
   one `O_APPEND` writer; `actor` is deliberately not a session id.
   **The test shape is stated, not rounded up** — a test asserts the writer
   emits `actor: policy` under the shared event-name constants; that the
   driver *reaches* the recorder at each step is read from `update_auto.rs`.
   Counted precisely: four call sites, three event names, `update-check`
   twice because the pre-install re-check is also a check.
4. **`api.md`'s route table** — the row named six action routes; it now names
   eight, adds `SetUpdateConfig` to the bus list, and says what makes `config`
   different from the seven beside it. `rollback` was missing from that row
   too, which L1 did not name.
5. **`provisioning.md` §4.0 → `[implemented]`**, with what F6g delivers in its
   own terms: adopted whole, per-document refusal that names the file, and
   **the change to previously shipped behaviour said plainly** — before F6g a
   mistyped `wifi.json` took the daemon and the network reconciler with it.
   Both things that still refuse to start are named as *different rules*: the
   missing medium (F6f) and the STATE document, with the `ensure_provisioned`
   reason for the second. **Q8 is answered at §4.1.4**, where the
   already-claimed rule lives, as the bound the pour does **not** inherit —
   with the back-door argument and physical custody named as the authority.
6. **`mosd.md` §5.1a — says *what* is refused.** The old bullet was true and
   under-specified. Now: the reconcilers that document configures are skipped,
   the tree says why in their place and at `configuration.refused` (the only
   form that reports a document with no reconciler behind it), the bytes are
   left alone, and every other subsystem runs. The cover is `DOCUMENT_SUBTREES`
   matched by dot-path **overlap** rather than equality, which is what makes
   `wifi.json` gate `wifi.client`.

### The parser-echo rule, added as L1 suggested

A second `mosd.md` §5.1a bullet, because it is a rule a later subsystem author
needs and not a fact about updates: **a refusal an operator can read is not
the parser's sentence.** serde prints `invalid type: string "…", expected a
boolean` *with the value in it*, so `message` names the file plus one of three
closed classes and quotes nothing, and `detail` is the parser's words and is
journal only. Written with its reason — the redactor keys on **field names**
and had no reason to inspect one called `message`, so a poured `mqtt.json`
reading `"enabled": "<site secret>"` would have published that secret through
its own refusal. Verified against the code: `publish_refusals` serves
`document`, `path`, `message`, `subtrees`; `detail` reaches no served record.

### Five more I found stale that L1 did not name

Each is my own sentence from an earlier round, made false by these two merges.

- **`updates.md`'s header blockquote** still called the write route "approved
  design that is not in the tree".
- **`updates.md` §7's owed list** still owed the write route and the audit
  events. Both now recorded as closed rather than deleted.
- **`remote-management.md` §3** still said the write route was owed and that
  an operator's only way to set `policy` was to edit the file.
- **`docs/user/configuration.md`** and **`docs/user/recovery.md`** both said
  there is no API route yet. `recovery.md`'s now gives the one-key patch.
- **`docs/user/update-rollback.md` §2 and §5** — §2 gains the route, the
  patch-not-document rule in operator words, and the three refusals; §5's *no
  way to change the settings over the API* bullet is replaced by **how much of
  the audit trail is proven**, which is the honest successor rather than a
  deletion.

### One thing I added to §6 that L1 did not ask for

A row to the owed-tests table: **a clock seam on the driver.**
`AutoDriver`'s cadence is keyed on `std::time::Instant`, which has no seam and
which `tokio::time::pause` does not move, so the driver cannot be ticked in a
test at all. That is the blocker *under* every other row in that table, and
without it those rows read as work nobody has got to rather than work nobody
can start. §6's table is otherwise verbatim: `update_auto.rs` and
`update_suppress.rs` still carry **zero** `#[test]` functions, re-counted on
merged main.

### `docs/zh/`

**Gated**: `zh/user/{configuration,recovery,update-rollback}.md` translated
for every changed passage, coverage rows moved to `88db4ae9`.
`zh/user/security.md` needed nothing this round.

**Ungated, mirrored anyway**: `zh/design/{provisioning,remote-management}.md`.
The zh `provisioning.md` is a condensed translation that carries no §4.1.4 at
all, so Q8's paragraph went into its §4.0 instead of into a section that does
not exist there — noted because a later mirror pass will find it in a
different place than the English.

**Ungated, still lagging**: `zh/design/{mosd,api,access,connd}.md`, unchanged
from round one and now also behind §5.1a's two rewritten bullets and api.md's
route row. `updates.md` and `recovery.md` still have no Chinese mirror.

### Still owed after round three

- **`update_auto.rs` and `update_suppress.rs`: zero tests**, and the reason is
  now recorded rather than left as an absence — the clock seam.
- **U10**, the bench cycle, hardware-blocked and unchanged.
- The `docs/zh/design/` lag above.
