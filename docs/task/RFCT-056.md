# RFCT-056 Documentation for the `apid` rename and the keep-two-processes decision

- **status**: completed — implementation complete, documentation only; no code, no image
  content and no verifier was touched, so nothing on a device is claimed
- **priority**: P1
- **owner**: (bkd campaign)
- **createdAt**: 2026-08-19 15:20
- **claimedAt**: 2026-08-19 15:20
- **completedAt**: 2026-08-19 16:40

Campaign `l1-o7ee8v0o-20260819152009-apid`. Branch `bkd/ka27r994`. Base
`86cd669`. The parallel task **RFCT-055** renames the crate, binary, unit, image
wiring and both verifiers on its own branch; this record covers `docs/` only and
touched nothing outside it.

## Description

Two questions that `docs/design/dashboard.md` sections 6 and 7 analysed and
recommended on (RFCT-046) were left open for the user. Both are now answered:

1. **The process question — keep two processes.** The HTTPS daemon is **not**
   merged into `mosd`.
2. **The rename question — `webd` becomes `apid`.** Not `dashboard`, not
   `webui`.

The job was to record both outcomes *on top of* the existing analysis without
rewriting it, and to carry the new name through the design documents — including
one document where the new name collides with an existing one.

## 1. The two decisions and where each is recorded

### Decision 1 — keep two processes

Recorded as a **[decided]** marker at the head of
`docs/design/dashboard.md` **§6**, plus a moot-marker on §6.6's option-1
conditions and a partial marker on §8's Phase 2.

Both findings that carried it are recorded in full, not summarised:

- **A merged process makes a provisioning failure fatal to the UI.** `mosd`
  exits hard on purpose when provisioning fails (`mosd/mosd/src/main.rs`). Today
  `apid` survives that and still renders an error page telling the operator the
  management daemon is unavailable. Merged, a provisioning failure leaves a
  serial console and nothing else — the worst failure mode for a headless
  appliance whose operator may be on a phone attached to a setup access point.
- **`com.mos.mosd1` is load-bearing for updates.** `mos-health` probes
  `GetState` on that interface and never reaches `rauc status mark-good` if it
  does not answer. So the bus interface must keep existing and keep being served
  regardless; a merge does not delete the bus, it deletes one consumer — which
  removes the main premise for merging in the first place.

The marker states explicitly that this matches §6.6's recommendation **on the
merge question only**, and that whether the option-2 non-root user, unit rewrite
and default-deny D-Bus policy get built is a **separate, still-open** question.
The decision made is *do not merge*; it is not *build the option-2 hardening
now*. §8 Phase 2 carries the same split.

§§6.1–6.8 are byte-unchanged apart from the daemon name. The costs of options 1
and 3, §6.5's comparison table and §6.6's honest counter-argument for option 1
are all retained — they are the reason the decision is trustworthy.

### Decision 2 — the rename

Recorded in `docs/design/dashboard.md`:

- **File header** — both decisions named, attributed to the user and to this
  campaign, with §§6–7 declared retained as their reasoning.
- **§7.4** — **[decided]**: the name is `apid`. Reason in one line: *it is the
  API daemon; the dashboard is what it serves* — precisely the objection §7.4.3
  raises against `dashboard` (the process serves ten routes, of which the
  dashboard is one).
- **§7.4.1** — the file count corrected from **83** to **95** (65 under `docs/`,
  30 elsewhere), stated as re-measured on this branch. The table itself was
  **not** re-derived; its per-surface findings stand as originally measured.
- **§7.4.2** — **[decided]: orphan**, matching this section's own `[proposal]`.
- **§7.4.3** — **[decided], recommendation overridden.** §7.4.3 recommended *do
  not rename as a standalone change*. The user decided otherwise. The marker
  says so plainly and records the cost §7.4.3 named: the unit, **both** image
  verifiers and the **two** `mos-health` copies will be edited a second time if
  and when option 2 is built. §7.4.3's argument is not softened and is not
  presented as having been followed.

**What §7.4.2's orphan decision costs a fielded device**, as recorded:
`/var/lib/mos/webd` is orphaned on STATE; the self-signed certificate
regenerates, so every operator's stored browser exception breaks once; the
session signing key is new, so existing sessions are invalidated —
indistinguishable from the restart that already logs everyone out. **Not lost:**
the admin password hash, which lives in the settings tree at
`access.webAdmin.password_hash`, not in that directory. **Reason:** every device
today is a dev unit, and a migration path is code that exists only to serve a
window that closes. **No migration code was written.**

## 2. Status-marker convention

`docs/design/access.md` §0 (RFCT-037) is the single convention. Rather than
inventing a second one, **[decided]** was added to that list, defined as *a
question that was open is now settled by the user, with the campaign that
settled it named*, and noted to be orthogonal to implementation status — a
section can be **[decided]** and **[not implemented]** at once, and where it is,
both markers appear. `dashboard.md`'s header points at `access.md` §0 rather
than restating it.

## 3. The `apid` name collision, per file

`apid` already existed in this repository as Talos's upstream machine API daemon
(gRPC :50000, mutual TLS, `talosctl`) — in `docs/` only, in no code. It was
**disambiguated in place, never deleted**; the convention adopted is that the
bare name is the product daemon and the upstream one is written **Talos `apid`**
(**Talos apid** in the Chinese files, to avoid introducing new prose).

| File | Handling |
|---|---|
| `docs/design/remote-management.md` | Naming convention stated in the header marker; every Talos occurrence rewritten to **Talos `apid`** (§1 table header and body, §2 twice, §3 three times, §4 twice). The product daemon takes the bare name. §1's heading and the whole analysis are unchanged. |
| `docs/design/remote-management.zh.md` | Same disambiguation, identifier-only: every pre-existing bare `apid` became `Talos apid`, then `webd` became `apid`. No prose translated. |
| `docs/architecture.md` | §2's ASCII component diagram column relabelled `Talos apid`; the bullet became **Talos `apid` + talosctl**; the product bullet became **`apid`** with "(the product daemon, renamed from `webd`)". Header carries a rename note that names the collision. The file is not restructured. |
| `docs/architecture.zh.md` | Same, identifier-only. |
| `docs/README.md` / `.zh.md` | The `remote-management.md` index line read "webd vs apid"; now "`apid` (product) vs Talos `apid`". |
| `docs/design/dashboard.md` | Two Talos references (§6.4.3 and §7.2) rewritten to Talos `apid` with a parenthetical saying it is the upstream machine API daemon, not the daemon renamed here. |
| `docs/design/access.zh.md` | One line listed "webd/apid" as the two config writers; now "apid / Talos apid". |
| `docs/design/provisioning.zh.md` | One line listed "webd 开、apid/SSH 关"; now "apid 开、Talos apid / SSH 关". |

No sentence in any touched file uses the bare name for both daemons.

## 4. `remote-management.md` — the status marker, verbatim

The distinction this marker had to carry is that **the mechanism died and the
model did not**. It is written to be unusable as grounds for retiring the
document:

```
> **[not implemented] — status of this document: awaiting a rewrite, not
> retirement.** Two separable things live here and only one of them died.
>
> - **The MECHANISM is dead.** This document was last revised on 2026-08-17 at
>   05:40, *before* the Plan B decision landed the same day at 19:18
>   (`docs/architecture.md` MIGRATION NOTICE). Talos `apid`, `talosctl`, mutual
>   TLS to gRPC :50000, `trustd`, and the claim that both frontends are *"thin
>   frontends over `/run/machined.sock`"* all belonged to the Talos base that
>   systemd + mosd replaced. **None of it exists in the tree**: there is no
>   `machined`, no `machined.sock` and no Talos `apid` anywhere in this
>   repository.
> - **The MODEL is alive, wanted, and undesigned.** A reverse-connected
>   management channel — the device dialling out so it is reachable from behind
>   NAT — and the fleet-management story survive Plan B completely intact. The
>   user asked for that model and it was **not withdrawn**. And there is **no
>   replacement design for it anywhere in the tree today**: nothing under
>   `docs/design/` covers remote reachability or fleet management on the
>   systemd + mosd architecture.
>
> So this document is **not obsolete and must not be retired**. The requirement
> it carries is still live and currently has no design. What it needs is a
> rewrite against the current architecture. Recording that gap is the whole
> point of this marker; no replacement is sketched here.
```

The Talos content itself was **not deleted**. Whether to retire it is a decision
the user has not made, and this task did not make it.

## 5. Occurrences kept as `webd`, with reasons

### `docs/plan/PLAN-010.md` — 10 kept

| Line | Reason |
|---|---|
| `:62` | M3's milestone heading — names the milestone as delivered, when the binary was called `webd` |
| `:68` | M3 done criteria — records which test run went green at the time |
| `:72` | M3 scope as executed ("Port webd's UI/HTTP layer to the mosd API") |
| `:316` | M5 "What was delivered" — records the power routes as shipped |
| `:529` | names RFCT-035 by the title it was completed under ("webd SSH pane") |
| `:552` | M5 addendum "What was delivered" — what the shipped default state required |
| `:560` | M5 addendum "What was delivered" — what the shipped UI string says |
| `:562` | M5 addendum "What was delivered" — how the shipped transient password is set |
| `:621` | M5 acceptance list — a hardware acceptance stated in the terms it was written in |
| `:623` | M5 acceptance list — same |

Three PLAN-010 occurrences were **renamed** because they describe what the system
is or will be, not what a campaign did: the architecture stack diagram (`:28`);
the RFCT-048 follow-up, which is explicitly *not implemented* and describes a
future D-Bus policy block (`:653`, with an inline parenthetical recording the
old name); and the Risks section's ongoing mitigation (`:701`).

### `docs/design/dashboard.md` §7.4 — kept wholesale, by design

§7.4 **measures and costs the rename**, so its paths and strings are the
pre-rename ones by construction: `grep -rln webd` is the measurement that
produced the 95-file figure, and a table headed "the migration cost, enumerated
with cited paths" is meaningless if the paths are the post-rename ones. A bulk
rename was applied to the whole file and then §7.4 was restored to `webd` and
given a **reading note** at the top of the section saying exactly this, and that
RFCT-055 executed the code-side rename. Kept: `:2546`, `:2552`, `:2563`–`:2570`
(the eight table rows), `:2592`, `:2595`, `:2598`, `:2605`, `:2606`, `:2646`,
`:2662`.

`:2578` (`/var/lib/mos/webd` is orphaned on STATE) is kept for a second reason:
it is the **legacy** directory a fielded device carries, and naming it `apid`
would state the opposite of the decision.

### Rename-record prose — the old name appears because it is the subject

`dashboard.md:13`, `access.md:159`, `architecture.md:13` and `:60`,
`remote-management.md:7` and `:10`, `mosd.md:16`, `provisioning.md:16`,
`display.md:9`, `boards.md:9`, `connd.md:9`, `ro-root.md:12`,
`PLAN-010.md:654`. Each is of the form "renamed from `webd`". None of them calls
the daemon `webd`; a rename record that cannot name the old name is not a
record.

## 6. Files changed

Design docs: `dashboard.md`, `access.md`, `access.zh.md`, `mosd.md`,
`mosd.zh.md`, `provisioning.md`, `provisioning.zh.md`, `display.md`,
`display.zh.md`, `remote-management.md`, `remote-management.zh.md`, `boards.md`,
`boards.zh.md`, `connd.md`, `ro-root.md`.
Top level: `architecture.md`, `architecture.zh.md`, `README.md`, `README.zh.md`.
Plan: `PLAN-010.md` (three occurrences, under the judgement rule).
New: this record.

The one-line explanation of the name — *`apid` is the API daemon; the dashboard
is what it serves* — appears once per document, at the first place it makes
sense, in each of the nine English design/top-level documents that name the
daemon. The `*.zh.md` siblings had the identifier renamed only; no new prose was
translated into them.

## 7. Not resolved

- **`docs/plan/index.md:1`, `docs/research/*` (76 occurrences) and 27 existing
  `docs/task/RFCT-0NN.md` records still say `webd`.** All out of scope and
  correct as-is: research documents are measurements of a past tree
  (`mos-ui-inventory.md` names the commit it measured on its face) and task
  records describe what a past campaign did.
- **`docs/task/index.md` has no row for RFCT-056.** Deliberate — a later audit
  task owns that file and adds all three campaign rows at once. This is the
  single expected `docs/verify-index.sh` failure.
- **`PLAN-010.md` has no header note** explaining that its retained `webd`
  mentions are historical while `:28` now says `apid`. Adding one is outside the
  judgement rule, which scopes this task to occurrences; the inline parenthetical
  at `:654` is the only in-file signal. Flagged for the audit task.
- **`remote-management.md`'s §1 heading is still "Two frontends, one machined"**
  and its body still asserts the `/run/machined.sock` premise. Correcting either
  means rewriting analysis this task was told not to rewrite; the header marker
  names the premise as dead instead.
- **The option-2 hardening remains undecided and unscheduled** — recorded in
  §6's marker and §8's Phase 2 marker, not resolved here.

<!-- dated-record: a frozen worklist or exhibit of what was measured then; re-pointing its citations would falsify the record; exempt from docs/verify-citations.sh (RFCT-172) -->
