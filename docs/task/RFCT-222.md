# RFCT-222 PLAN-013 audited: the x64/QEMU vehicle measured against the tree it asked for

- **status**: completed — nine deliverables measured; M1 and M2 discharged by later campaigns, M3 transferred, six residuals routed, close-with-amendment recommended for all three milestones
- **priority**: P1
- **owner**: bkd/2qiryl95
- **createdAt**: 2026-08-28
- **completedAt**: 2026-08-28
- **plan**: PLAN-024 (M1)

## 1. What was audited, and against what

PLAN-013 — the x64/QEMU verification vehicle — proposal and three milestones,
plus the two annotations that changed its shape. The tree is this worktree at
`a86ab46`, cut from main, with `_out/` absent: no assembled image of either
board exists here, so every verdict below is about source and scripts, never
about a run.

The plan's own head still reads "- **status**: proposal"
(`docs/plan/PLAN-013.md:3`) and its provenance fields are still
"- **relatedTask**: -" (`docs/plan/PLAN-013.md:7`); the plan index carries the
row for "PLAN-013 The x64/QEMU verification vehicle"
(`docs/plan/index.md:46`) unchecked. None of that is true of the tree: most of
what the plan describes has landed, under other numbers.

Nine deliverables were extracted — M1.1 to M1.4, M2.1 to M2.3, M3's
rebuild-and-diff and M3's overlay claim — and each was opened against its
artifact rather than against any record's prose.

## 2. Milestone by milestone

### M1.1 — the layout indirection in the verifier — **superseded**

Every property M1.1 asked for exists, and none of it is in the file M1.1 named.
`os/verify-image-v2.sh` was deleted at `6eadc65` and replaced by the bun +
TypeScript package under `os/verify/`, ported by PLAN-014 M4 — the record is
"the image-contract verifier ported to TS under a per-check parity gate"
(`docs/task/RFCT-110.md:1`). Measured against that port, property by property:

- **The partition count is derived, not literal.** The conclusion is generated
  per board as `exactly ${want} partitions`
  (`os/verify/src/checks-shape.ts:263`), and what it counts is the board's own
  ordered set,
  `LAYOUT_PARTITIONS="ESP BOOT_A BOOT_B ROOTFS_A ROOTFS_B META STATE EPHEMERAL DATA"`
  (`os/boards/x64/board.env:314`).
- **The partition set is walked, not enumerated.** Each entry carries a role —
  `ROOTFS_A_ROLE=verity-slot` (`os/boards/x64/board.env:315-323`) — and the
  checks dispatch on it, so a board that omits `loader` omits rows instead of
  crashing under `set -u`.
- **The bootloader predicate exists and is derived.** It is
  `export const isUBoot = (board: Board): boolean => board.bootloader === 'uboot'`
  (`os/verify/src/board-scope.ts:32`), defined once for every family that needs
  it.
- **Every skip is a named line, and the skips are counted.** A skipped check
  prints `SKIP: ${r.message}` (`os/verify/src/verify-cli.ts:188`) and the
  summary appends `${skipped} skipped` (`os/verify/src/verify-cli.ts:200`),
  naming the board and its bootloader — exactly the shape M1.1 specified, for
  exactly the reason it gave.
- **The boot-slot file list comes from the layout.** The board declares
  `BOOT_SLOT_REQUIRED_FILES="vmlinuz initrd.img cmdline.cfg"`
  (`os/boards/x64/board.env:295`) and the model reads
  `bootSlotRequiredFiles: list('BOOT_SLOT_REQUIRED_FILES')`
  (`os/verify/src/board.ts:215`).
- **The kernel version is read, not pinned.** The check is
  `packed-modules-exactly-one` (`os/verify/src/checks-root.ts:436-449`), which
  reads the packed root's own modules directory and keeps the exactly-one
  assertion; no pinned BSP version constant survives outside fixtures.
- **The default image path follows the board.** It resolves as
  `return join(REPO_ROOT, '_out', board.name, name)`
  (`os/verify/src/verify-cli.ts:104`), and the plan's opening defect is
  recalled by name in the module that replaced it — "the container re-exec's
  missing" `-e MOS_BOARD` (`os/verify/src/verify-cli.ts:65`).
- **The x64 board has its own files**, beside cx3576 under `os/boards/`, and
  the design table's row for "x64 (generic UEFI)" (`docs/design/boards.md:134`)
  now describes them correctly — the plan recorded that row as wrong in both
  halves.

Annotation 1's larger requirement — a board defined by its layout file, with a
schema linter — is implemented as `os/verify/src/lint.ts`, which rejects a bad
value with `BOARD_HAS_STATUS_LED is '${led}'; it must be 0 or 1`
(`os/verify/src/lint.ts:396`), reached by `bash os/verify/run.sh --lint`
(`Makefile:192`) with its own conformance cases behind
`bash os/verify/run.sh src/lint.test.ts` (`Makefile:195`).

Annotation 2 — a failing unit on x64 is fixed, not allowlisted — is implemented
as a board fact: `BOARD_HAS_STATUS_LED=0` (`os/boards/x64/board.env:329`)
against `BOARD_HAS_STATUS_LED=1` (`os/boards/cx3576/board.env:485`), and the
unit whose header reads
"Description=mos status indicator (boot red -> ready blue)"
(`os/boards/cx3576/overlay/usr/lib/systemd/system/mos-status-led.service:2`)
ships only from the cx3576 overlay. The plan's ruling was carried out in the
form the plan demanded.

Two residuals inside M1.1 did not come across the port:

- `make os-verify-x64-v2` does not exist. The board is a flag instead:
  `bash os/verify/run.sh --verify --board cx3576` (`Makefile:77`) is the only
  wired verify target, and any x64 make target is an explicit refusal —
  "x64 has no BSP build; assemble its image with:" (`Makefile:321`).
  Functionally equivalent, so this is a naming difference, not a gap.
- The staleness guard is **gone, not generalised**. The plan's complaint was
  that "an x64 run's freshness is decided by arm64 artifacts"
  (`docs/plan/PLAN-013.md:113-114`); the port has no freshness comparison in any
  module. The defect is moot because the check was dropped, which is a different
  outcome from the one M1.1 proposed and is named here for that reason.

### M1.2 — a runtime assertion harness — **superseded in part, four assertions open**

`os/qemu-boot-test.sh` was never created and there is no `os-qemu-boot-test`
target; the wired runtime harness is `bash test/apid-api/run.sh`
(`Makefile:351`). It does assert on the console in the shape M1.2 asked for,
and it is stricter than the plan proposed: "Mark first is the rule"
(`test/apid-api/src/console.ts:27`), so a boot line cannot satisfy a claim
about a later POST — a hazard the plan's own §Risks raised and did not solve.

Of M1.2's seven required assertions, measured in that harness:

- `apid` reaching `APID_LISTENING` — asserted, as a timed readiness gate:
  "APID_LISTENING on the console after" (`test/apid-api/run.sh:656`).
- The container engine present and inert — asserted indirectly: the mutation
  phase refuses to conclude if
  "the containers switch was ALREADY on when this phase posted"
  (`test/apid-api/src/phases/05-mutate.ts:219`), which is a statement about the
  shipped state.
- Shutdown unmounting filesystems — asserted as a console pattern,
  "Deactivating swap|Unmounting"
  (`test/apid-api/src/phases/07-reboot.ts:288`).
- **No unit reached `[FAILED]`** — nothing in the tree asserts this. A search of
  `test/apid-api` for `is-system-running`, `degraded` and the failed-unit marker
  returns nothing, and no other harness makes the claim.
- **All three daemons active and cleanly stopped** — only `apid` is covered.
  `mosd` is observed solely through its effects in the mutation phase, and
  `mos-mqttd` is not observed at all.
- **The verity root mounted from the chosen slot, read-only** — covered
  statically on the image by `os/verify`, never at runtime.
- **`systemd-repart` grew DATA** — the disk is grown so that growth is
  *possible*, "grows it so systemd-repart has somewhere"
  (`test/apid-api/run.sh:356`), and no assertion checks that it happened.

So the mechanism M1.2 wanted exists and is better than its design; four of its
seven assertions do not exist. That residual is harness work.

### M1.3 — `os/qemu-journal.sh` made honest — **implemented, as the plan's own Alternative 1**

The plan left this open between three options, of which the first was
"Delete it. Console forwarding already covers the need"
(`docs/plan/PLAN-013.md:308`), and its annotation still records the script as
"still broken, still committed, decision still open"
(`docs/plan/PLAN-013.md:386`). The decision has since been taken and executed.
Commit `8b0d1a7` removes the file, and its message gives the plan's own
reasoning back: the premise "never held: journald is Storage=volatile on the
ephemeral partition, so a guest's journal dies with the guest and no
post-mortem reader can work", with the harness capturing the console instead
and its three live mentions repointed. The correct verdict is therefore
implemented — the decision resolved in the recommended direction — not missing.

### M1.4 — the `/var/log` package-manager residue — **genuinely open**

Neither half was done. The purge removes databases and caches and stops there:
`rm -rf /var/lib/dpkg /var/lib/apt /var/cache/apt /var/cache/debconf`
(`os/rootfs/scripts/package-manager-purge.sh:7`) never touches
`/var/log/dpkg.log`, `/var/log/apt/` or `/var/log/alternatives.log`. The
checker's tree list is unchanged too —
`'/var/lib/dpkg', '/var/lib/apt', '/etc/apt', '/usr/lib/apt',`
(`os/verify/src/checks-engine.ts:491`) — with no log path among the six.

Closing it is no longer the two-line change the plan assumed, and that is the
finding. `dpkg.log` has since become load-bearing evidence: the stage order is
gated on it, "with its timestamps stripped is byte-identical"
(`os/rootfs/stages/README.md:423`) over all 694 operations, and a stage file
repeats the dependency —
"in the logs the pack stage carries into /usr/share/factory/var/log"
(`os/rootfs/stages/40-board.Dockerfile:37`). Dropping the logs from the seeded
`/var` must keep them reachable to that comparison, or replace the comparison.
Route to PLAN-025.

### M2.1 — the two doors, opt-in — **implemented**

Both doors, behind one variable, in the moved script:
`if [ -n "${MOS_QEMU_FORWARD:-}" ]; then` (`os/tools/qemu-run.sh:244`) guards
`HOSTFWD=",hostfwd=tcp::${https_port}-:443,hostfwd=tcp::${http_port}-:80"`
(`os/tools/qemu-run.sh:247`) and the matching container publish, default-off
exactly as the plan required. The implementation went past the design: a third
route exists because a loopback publish is unreachable from a sibling
container — "a sibling container reaches it at"
(`os/tools/qemu-run.sh:267`) the container's address, not `127.0.0.1`. The plan
did not anticipate that door.

### M2.2 — the over-the-wire suite — **implemented**

It exists as `test/apid-api/`, in TypeScript rather than the shell script
§Alternatives recommended, and it is carried by the record
"An over-the-wire suite for apid: nine phases against one boot"
(`docs/task/RFCT-105.md:1`), whose status head reports
"RESULT: FAIL (231/232 checks)" (`docs/task/RFCT-105.md:3-11`) against a booted
x64 image with the single failure attributed to the daemon. That claim was
checked against the artifact rather than taken: the suite is present, ten
phases, and every assertion M2.2 enumerated has a phase that names it in its
own title —

- the certificate and the redirect:
  "transport: the self-signed certificate, the :80 -> :443 redirect, and the setup-mode gate"
  (`test/apid-api/src/phases/01-transport.ts:40`), with the health route
  asserted as "/healthz answers 200 with no session"
  (`test/apid-api/src/phases/01-transport.ts:177`);
- the first-boot flow:
  "setup: the rejections, the first admin password, and the session cookie it mints"
  (`test/apid-api/src/phases/02-setup.ts:70`);
- the session: "login: /logout kills the session server-side"
  (`test/apid-api/src/phases/03-login.ts:41`);
- the reserved subtree, the UI prefix and traversal:
  "read-only surface: the panes, the reserved /api/ envelope, the fallback and traversal contract"
  (`test/apid-api/src/phases/04-readonly.ts:322`);
- the effects through the bus:
  "mutation: hostname, containers, ssh and network, each asserted by its effect on the device"
  (`test/apid-api/src/phases/05-mutate.ts:75`), which reads the change back over
  the bus *and* matches the reconciler's own console line —
  "(b) device effect: mosd's container reconciler logged"
  (`test/apid-api/src/phases/05-mutate.ts:254`);
- the backoff, twice:
  "login backoff: the guard is global, its window doubles, and it survives a restart"
  (`test/apid-api/src/phases/06-backoff.ts:148`) and then across a real power
  cycle —
  "after the reboot: the hostname persisted, the session did not, and the backoff did"
  (`test/apid-api/src/phases/07b-postreboot.ts:108`).

One item on M2.2's list has no assertion: the certificate being `0600` in
`StateDirectory` and surviving a reboot rather than being reminted. Phase 01
inspects the certificate over TLS, and phase 07b asserts only
"the machine came back: apid answers /healthz on the second boot"
(`test/apid-api/src/phases/07b-postreboot.ts:52`) — neither compares a
fingerprint across the two boots. A file mode is not observable over the wire
at all; the fingerprint is, and the reboot it needs already happens.

That two-boot shape also answers PLAN-024's framing question directly: the
suite reboots the guest inside one run and re-asserts afterwards, which is
strictly more than M1.2's single-boot design asked for. It supersedes M1.2's
*approach* outright; it does not supersede the four assertions M1.2 listed and
nothing makes.

### M2.3 — the make target and the design note — **half implemented, half open**

The target exists: `bash test/apid-api/run.sh` (`Makefile:351`). The second
half does not. The plan asked to record
"§10 that the surface now has an over-the-wire suite and where it lives"
(`docs/plan/PLAN-013.md:239`), and no file under `docs/design/` mentions
`test/apid-api` — every reference in `docs/` is from a plan or a task record.
Route to PLAN-023.

### M3 — the cx3576 back-port — **one part implemented, the rest transferred**

- **The board-overlay layering claim — implemented.** Both files the plan
  wanted confirmed are under the board, not the shared overlay:
  "systemd-repart placeholder for uenv-a (partition 2)."
  (`os/boards/cx3576/overlay/etc/repart.d/10-uenv-a.conf:1`) and
  "systemd-repart placeholder for uenv-b (partition 3)."
  (`os/boards/cx3576/overlay/etc/repart.d/20-uenv-b.conf:1`). Confirming they
  still *land in an image* needs a build, which is the next item.
- **The rebuild-and-diff — genuinely open, and blocked on a host capability
  another plan already owns.** No cx3576 image can be built here: `_out/` does
  not exist, and the cause is recorded as
  "os/pkgs/rauc/build.sh pins --builder default while arm64 needs the mos-arm64 buildx builder"
  (`docs/plan/PLAN-025.md:16-17`), with
  "cx3576 image build on this host: unpin the builder choice"
  (`docs/plan/PLAN-025.md:37-38`) scoped to fix it and then run the deferred
  pass. PLAN-013 M3 is that same work under an older number.
- **The gate list — superseded.** Of the nine gates the plan enumerates from
  "os-verify-cx3576-v2" (`docs/plan/PLAN-013.md:249-252`) onward,
  `os-ui-location-test` no longer exists in any form: the fixture-driven
  verifier suite it named is now `bash os/verify/run.sh` (`Makefile:206`). The
  other eight are still targets, and the set a back-port should re-run today is
  those plus `os-verify-test`, `os-layout-lint` and `os-build-test` — a
  different list from the one written down, so re-running the plan's literal
  enumeration would under-cover the tree.

## 3. Where the plan's own claims disagree with the tree

1. **The status head is wrong by four campaigns.** "- **status**: proposal"
   (`docs/plan/PLAN-013.md:3`) and the unchecked row for
   "PLAN-013 The x64/QEMU verification vehicle" (`docs/plan/index.md:46`)
   describe a plan nobody started. In fact seven of its nine deliverables are in
   the tree, built by PLAN-014, PLAN-017, PLAN-018, PLAN-022 and the campaigns
   PLAN-025 now inherits. This is precisely
   "the checkbox-vs-reality gap" (`docs/plan/PLAN-024.md:14-17`) that PLAN-024
   exists to close.
2. **`relatedTask` is empty and cannot be filled with the numbers the plan
   reserved** — see §3a.
3. **The plan's own annotation is stale on M1.3.** It records the decision as
   "still broken, still committed, decision still open"
   (`docs/plan/PLAN-013.md:386`); it was closed and executed at `8b0d1a7`, in
   the plan's own recommended direction.
4. **The Scope list names files that no longer exist.** It opens on
   the shell verifier's own line, "the layout indirection, the board predicates"
   (`docs/plan/PLAN-013.md:289-298`), and goes on to name the two
   `os/layout/*-v2.env` files and the monolithic `Dockerfile.v2`. The first was
   deleted at `6eadc65`, the layouts became `os/boards/<board>/board.env`, and
   the Dockerfile became the per-stage chain under `os/rootfs/stages/`. A reader
   working that list literally would edit nothing that exists.

### 3a. The RFCT-104/105/106 collision

The plan reserves three numbers in its milestone headings —
"the x64 image verified, statically and at runtime (RFCT-104)"
(`docs/plan/PLAN-013.md:150`),
"the apid API test suite (RFCT-105)" (`docs/plan/PLAN-013.md:211`) and
"the back-port to cx3576 (RFCT-106)" (`docs/plan/PLAN-013.md:241`). Two of the
three were allocated to other work, and the collision is not cosmetic: it is
why PLAN-013's M1 and M3 have no task record at all.

- **RFCT-104 is not M1.** It is
  "A master switch for MQTT, and a broker for the bridge that has only ever retried"
  (`docs/task/RFCT-104.md:1`), claimed by PLAN-011 M7 and named as such in that
  plan's own provenance line — "RFCT-104 (M7, complete 2026-08-24)"
  (`docs/plan/PLAN-011.md:7`).
- **RFCT-105 is M2**, and holds:
  "An over-the-wire suite for apid: nine phases against one boot"
  (`docs/task/RFCT-105.md:1`).
- **RFCT-106 is not M3.** It is
  "x64 A/B: the update has to land where the firmware actually looks"
  (`docs/task/RFCT-106.md:1`) — x64 work, not the cx3576 back-port.

So exactly one of the three reservations holds. M1's work is carried by
PLAN-014's records instead, chiefly
"the image-contract verifier ported to TS under a per-check parity gate"
(`docs/task/RFCT-110.md:1`); M3's work is carried by nothing yet, which
PLAN-025 M2 is about to change.

RFCT-104's own status head is worth naming while it is in view: it records
"no assembled image was built or booted in this campaign"
(`docs/task/RFCT-104.md:3`), so the verification it left outstanding is the very
thing PLAN-013 was created to supply — and it was supplied elsewhere, by
"PLAN-022 M7: kernel fragment and on-image proof" (`docs/task/RFCT-206.md:1`).
That is the clearest single measure of what happened to this plan: its purpose
was served, by other campaigns, under other numbers.

## 4. Routed to siblings

Nothing below is proposed as a PLAN-024 task. Each is stated as work in a
domain another approved plan already owns.

- The `/var/log` package-manager residue, and the determinism gate it now
  collides with — from M1.4,
  `rm -rf /var/lib/dpkg /var/lib/apt /var/cache/apt /var/cache/debconf`
  (`os/rootfs/scripts/package-manager-purge.sh:7`) — **route to PLAN-025**.
- The four missing runtime assertions (no unit failed; `mosd` and `mos-mqttd`
  active and cleanly stopped; the verity root read-only from the chosen slot;
  repart growth observed) — from M1.2, harness work against
  "Mark first is the rule" (`test/apid-api/src/console.ts:27`) —
  **route to PLAN-025**, whose M1 already reworks this boot path:
  "qemu-run.sh ported into test/apid-api's TS harness"
  (`docs/plan/PLAN-025.md:34`).
- `os/rootfs/build-v2.sh` still deciding the architecture in a local
  `case "$MOS_BOARD" in` (`os/rootfs/build-v2.sh:52`) although both boards now
  declare it — `MOS_ARCH=amd64` (`os/boards/x64/board.env:273`) and
  `MOS_ARCH=arm64` (`os/boards/cx3576/board.env:398`). This is M1.1's last
  bullet, unfinished — **route to PLAN-025**.
- The certificate-persistence assertion: one fingerprint compared across the
  reboot the suite already performs, beside
  "the machine came back: apid answers /healthz on the second boot"
  (`test/apid-api/src/phases/07b-postreboot.ts:52`) — **route to PLAN-023**.
- The design note M2.3 asked for, recording
  "§10 that the surface now has an over-the-wire suite and where it lives"
  (`docs/plan/PLAN-013.md:239`) — **route to PLAN-023**.
- The cx3576 rebuild-and-diff and the gate re-run — already scoped as
  "cx3576 image build on this host: unpin the builder choice"
  (`docs/plan/PLAN-025.md:37-38`) — **route to PLAN-025 M2**.

## 5. Recommendation

**Close PLAN-013 with a dated amendment — shape (a), for all three
milestones.** Nothing in the plan is both open and unowned: M1 and M2 are in
the tree, M3's remaining half is inside PLAN-025 M2's approved scope, and the
six residuals above belong to PLAN-023 and PLAN-025 by domain. Keeping any
milestone open here would put a second owner on work a sibling plan has already
claimed, which is the failure mode PLAN-024 was created to remove. No task is
proposed from the RFCT-223..229 pool.

Per milestone, in the required shape:

- **M1 — close with amendment.** Superseded by PLAN-014 M4's verifier port and
  PLAN-014 M1's board tree; M1.3 executed at `8b0d1a7`; M1.4 and the four
  runtime assertions routed to PLAN-025.
- **M2 — close with amendment.** Implemented as `test/apid-api/`, recorded by
  RFCT-105 and hardened by RFCT-206; the certificate-persistence assertion and
  the design note routed to PLAN-023.
- **M3 — close with amendment, by transfer.** The overlay claim is implemented;
  the rebuild-and-diff and the gate re-run are PLAN-025 M2's, already scoped and
  approved there.

### The status line the plan should carry

```
- **status**: closed 2026-08-28 — superseded; see Amendment 1
```

and its row in the plan index moves from an unchecked marker to a checked one.

### The literal amendment text

To be appended to the plan file **at the gate's direction, by the milestone
that executes the ratified verdict — not by this record, which appends
nothing.**

```markdown
## Amendment 1 — 2026-08-28: closed as superseded (PLAN-024 M1, RFCT-222)

This plan was never approved and never executed under its own number. Between
its writing on 2026-08-24 and this amendment, four campaigns built the work it
proposed. The audit that measured them, milestone by milestone against the tree
at a86ab46, is RFCT-222.

**M1 — superseded.** Every property M1.1 asked of the shell verifier was
delivered by porting that script away: it was deleted at 6eadc65 and rebuilt as
the bun/TypeScript package os/verify/ under PLAN-014 M4's per-check parity gate
(RFCT-110). The partition count is derived from LAYOUT_PARTITIONS, the
partition set is walked by role, the U-Boot sections sit behind a derived
isUBoot predicate whose skips print as named SKIP lines and are counted in the
RESULT summary, BOOT_SLOT_REQUIRED_FILES drives the boot-slot check, the kernel
version is read from the packed root, and the default image path follows the
board. Annotation 1's board-definition schema and its linter ship as
os/verify/src/lint.ts behind make os-layout-lint, with conformance cases of
their own. Annotation 2's ruling is implemented as BOARD_HAS_STATUS_LED, with
mos-status-led.service shipping only from the cx3576 overlay. M1.2's harness
exists in a stronger form than proposed, as the marker-based console assertions
in test/apid-api/. M1.3 was decided in this plan's own recommended direction
and executed at 8b0d1a7.

**M2 — implemented.** The suite is test/apid-api/: ten phases over one boot
plus a reboot, recorded as RFCT-105 and hardened by PLAN-022 M7 (RFCT-206). The
two doors are MOS_QEMU_FORWARD in os/tools/qemu-run.sh, default-off. It is
TypeScript rather than the shell script this plan's Alternatives recommended;
that choice followed the toolchain PLAN-014 established and is not revisited.

**M3 — transferred.** The board-overlay layering claim is confirmed: the two
uenv repart placeholders live under os/boards/cx3576/overlay/. The
rebuild-and-diff and the gate re-run cannot run on this host for a reason that
is not this plan's — the arm64 buildx builder cannot reach the local base-image
family — and both are inside PLAN-025 M2's approved scope. The gate list this
plan enumerated is itself stale: os-ui-location-test no longer exists, and
os-verify-test, os-layout-lint and os-build-test are now part of the set.

**Not done, and routed rather than left here.** The /var/log package-manager
residue (M1.4), now entangled with the stage-order gate that diffs dpkg.log;
the four runtime assertions M1.2 listed that no harness makes; and
os/rootfs/build-v2.sh still choosing the architecture in a local case although
both boards declare MOS_ARCH — all to PLAN-025. The certificate-persistence
assertion and the design note M2.3 asked for — to PLAN-023.

**The reserved numbers.** RFCT-104 and RFCT-106 were allocated to other work —
PLAN-011 M7's MQTT master switch, and the x64 A/B fix — so M1 and M3 never had
task records under the numbers this plan named. Only RFCT-105 holds. The
numbers are not reclaimed; what actually carries each milestone is recorded in
RFCT-222 section 3a.

Status moves to closed, superseded. No milestone of this plan remains open
under this plan.
```

## 6. Checks

Both documentation gates were run against this record and the single index row
it adds, and their verdict lines are quoted in this task's report.

<!-- dated-record: the PLAN-024 M1 audit, frozen at `a86ab46`; its citations name the plan heads and the sibling plans as they stood before the PLAN-024 M2 closeout (RFCT-227) amended them, and re-pointing them would falsify what was measured when; exempt from docs/verify-citations.sh (RFCT-172) -->
