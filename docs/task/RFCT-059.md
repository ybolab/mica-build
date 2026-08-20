# RFCT-059 Direction-2 audit of the apid rename: every new `apid` must be a place that should have been renamed

- **status**: implementation complete — `make docs-verify` green (140/140),
  diff confined to `docs/`
- **priority**: P1
- **owner**: ai-agent
- **createdAt**: 2026-08-19 18:45
- **claimedAt**: 2026-08-19 18:45
- **completedAt**: 2026-08-19 19:40

Campaign `l1-o7ee8v0o-20260819152009-apid`. Branch `bkd/uw6s6ohz`, base
`0504dbb` (the RFCT-058 L2 merge).

## Description

A rename audit has two directions. This campaign had run only one.

1. **No surviving OLD name outside justified history.** RFCT-057 ran this:
   58 files containing `webd`, all under `docs/`, every one justified, zero
   misses. That result is true and is not disturbed by this record.
2. **Every NEW-name occurrence is a place that SHOULD have been renamed.**
   Never run before this task.

**Why direction 1 is structurally blind to the direction-2 defect.** Direction
1 searches for `webd`. A `webd` that was *wrongly* changed to `apid` contains
no `webd`, so it cannot match. The two directions are not two spellings of one
question — direction 1 asks *"was the rename finished?"* and direction 2 asks
*"was the rename too eager?"*. A campaign can score a perfect direction-1 audit
while every over-rename it committed sits untouched, because the evidence for
an over-rename is precisely the absence of the string direction 1 looks for.
Three over-renames had already been found by inspection before this task
started, one of them only because it happened to sit in the repository's front
door where a reader noticed a name ambiguity. Nothing systematic was looking.

### The defect shape

An over-rename is a **historical or abandoned-architecture sentence whose
`webd` was changed to `apid` as though it described current state.** The result
asserts that today's daemon existed in a world it never existed in. It reads
plausibly, breaks no build, and no check compares a document against itself for
internal consistency.

The diagnostic used here: after the rename, does the sentence carry a
**live-architecture** term (`apid`) beside an **abandoned-architecture** term
(Talos, `machined`, COSI, `talosctl`, `trustd`, `/run/machined.sock`, the Go
SSH server, busybox)? If so the sentence is now internally inconsistent, and
whichever half a reader believes, the other is wrong.

## Method and counts

`grep` on PATH is **ugrep 7.5.0**, not GNU grep. Every count below is stated
beside the exact command that produced it.

**The introduced set** — bounded to what this campaign changed,
`86cd669..HEAD`:

    git diff 86cd669fa71889577f7e1ab1fab0e0e09a463dcf HEAD \
      | grep '^+' | grep -v '^+++' | grep apid | wc -l      -> 587

587 added lines contain `apid`. Split by destination and counted both ways
(matching lines, and total occurrences via `gsub` over the same diff):

| Scope | added lines with `apid` | total `apid` occurrences |
|---|---|---|
| under `docs/` | 449 | 519 |
| outside `docs/` | 138 | 158 |
| **total** | **587** | **677** |

(The L1 brief's estimate was ~415 under `docs/` and 139 outside. The figures
above are the measured ones; the brief's docs figure was low. The pattern is
stated so the two are comparable.)

**Examined: 587 of 587 added lines / 677 of 677 occurrences.** Not a sample.
The diagnostic filter was applied mechanically first —

    <introduced set> | grep -E 'Talos|talos|machined|COSI|talosctl|trustd|busybox|BusyBox' | wc -l   -> 57
    <introduced set> | grep -c 'Talos `apid`'                                                        -> 24

— and then every remaining line was read by file: the 158 non-`docs/`
occurrences in full, the 202 `dashboard.md` occurrences in full, the 160 task-
record occurrences in full, and every English and Chinese design document
compared line-for-line against its `86cd669` text (`git show 86cd669:<f> | grep
-n webd` beside `grep -n apid <f>`), so that each rename site was judged
against the sentence it replaced rather than against the sentence alone.

**24 of the 57 abandoned-architecture co-occurrences already read "Talos
`apid`"** — RFCT-056's disambiguation working as intended. That proportion is
the reason this tail is small rather than systematic: the collision with Talos's
own upstream `apid` had already been handled deliberately, so what remained were
sentences where the *product* daemon's old name was carried into a world it
never lived in.

**Found: 5 over-renames across the campaign** — 1 already corrected by RFCT-058,
**4 corrected here**. **Beyond these, none further.** That is a result, not a
silence: the remaining 672 occurrences were each examined and each has our
daemon as its referent.

## Instances, by category

| # | Site | Category | Disposition |
|---|---|---|---|
| 1 | `README.md`, the `talos/` layout line | historical Talos service | **already fixed by RFCT-058** — verified: `grep -n 'apid' README.md` (ugrep) returns 3 hits, lines 4, 7 and 15, and line 16 now reads *"`talos/` abandoned Talos base, reference-only archive superseded by `os/` and `mosd/`"*, naming no daemon at all |
| 2 | `docs/design/boards.md:97` | historical Talos service | **fixed** — `apid` -> `webd` |
| 3 | `docs/design/boards.zh.md:88` | historical Talos service | **fixed** — `apid` -> `webd` |
| 4 | `docs/design/access.zh.md:29` | abandoned architecture (superseded Go-sshd/COSI design) | **fixed** — `apid` -> `webd` |
| 5 | `docs/design/access.zh.md:52` | abandoned architecture (superseded COSI controller model) | **fixed** — `apid` -> `webd` |

### 2 and 3 — the board bring-up checklist

At `86cd669`, `boards.md` §7 item 5 read *"**Talos** image consuming the
artifacts boots to **webd** healthz on hardware."* After the rename it read
*"Talos image … boots to **apid** healthz"*, which is internally inconsistent
with its own neighbours: item 4 says *"before the **Talos** image"* and §6 says
*"**Not supported by the Talos core**"*. `boards.zh.md:88` is the identical
sentence in the stale translation and carried the identical defect; it was
**not** in the seed list and was found by this sweep.

Both restored to `webd`. Restoring the historical name is **correct and is not
a regression of the campaign**: direction 1's proof explicitly permits `webd`
in justified history, and `boards.md`'s own header note (`:8-9`) tells a reader
that the daemon *"formerly called `webd` is now `apid`"*. After the fix, both
files' `webd` line sets are byte-identical to `86cd669` apart from that header
note (`diff <(git show 86cd669:<f> | grep webd) <(grep webd <f>)`).

### 4 and 5 — the superseded access design, in the Chinese sibling

`access.md` (English) records at §2 a **"Superseded mechanism"** paragraph: the
original design put the SSH server in Go (`x/crypto/ssh` + pty) inside the
`machined` multi-call binary reading policy from COSI, and *"on the systemd
base that is not what ships"* — the image carries OpenSSH driven by mosd. Its
§3 was likewise rewritten to the mosd settings tree and `SshdReconciler`.

`access.zh.md` was never brought across. It still describes the abandoned
model, and RFCT-056 applied an **identifier-only** rename to it (its own record
says so: *"No prose translated"*). That is exactly where an over-rename lands.

- `:29` — *"编入 machined 多调用二进制，与 **webd** 同款监督方式，策略直接读
  COSI——无 OpenSSH、无独立 C daemon"*. The rename planted today's daemon inside
  the abandoned Go-sshd design, beside `machined`, COSI and "no OpenSSH".
- `:52` — the chain *"`DebugAccessConfig` → `DebugAccessController` →
  `DebugAccessStatus` 资源 → 服务起停"*, then *"**webd** 从同一资源渲染状态"*.
  The "same resource" is a COSI status resource. Today's `apid` reads no COSI
  resource; it calls mosd over D-Bus. Renamed, the sentence asserts something
  false about the current daemon. Same defect class as `:29`, one section later.

Both restored to `webd`. **Scope was held to the one word per line.** The
translation's content was not updated, no status marker was added, no
`superseded` note was introduced, and no sibling `.zh.md` was touched — see
"Note for the parked `.zh.md` decision" below. `access.zh.md`'s three other
`apid` occurrences (`:78`, `:100`, `:101`) are correct and were kept; they are
recorded in the table below.

## Deliberate keeps — examined and kept, with referent and reason

**No silent survivors.** An occurrence examined and kept must be
distinguishable in this record from one never looked at. If this record did not
say why a bare `apid` in a Talos-era passage was kept, it would have created
the next audit's work.

| Site | Referent | Why kept |
|---|---|---|
| `docs/design/remote-management.md:60`, `.zh.md:51` — *"local trigger (`apid` button / lockbox)"* | **our daemon** | **Ruled by L1; not re-litigated here.** The referent is the product daemon's UI affordance — a button a local operator presses to authorise remote support — not the Talos machine API. The rename is correct **on the merits** even though the surrounding document is Talos-era and every *other* `apid` in it is disambiguated as "Talos `apid`". Recorded here precisely because a reader who finds one bare `apid` among many "Talos `apid`" will reasonably suspect a miss |
| `docs/design/connd.md:33` — *"COSI status resources \| mosd's live-state tree, served over D-Bus to `apid`"* | **our daemon** | A **migration mapping** table: left column is the abandoned Talos design, right column is what ships. The COSI term is the *subject being replaced*, not a claim about `apid` |
| `docs/design/access.zh.md:78` — *"管理操作（apid / Talos apid 配置写入）"* | our daemon + Talos's | RFCT-056's disambiguation. Read `webd/apid` at `86cd669`; the pair is now correctly split |
| `docs/design/access.zh.md:100-101`, `access.md:404-405` | our daemon | Kiosk / AP-captive setup paths. The kiosk extension renders the product daemon's UI |
| `docs/design/provisioning.zh.md:17` — *"apid 开、Talos apid / SSH 关"* | our daemon + Talos's | Same RFCT-056 split, from *"webd 开、apid/SSH 关"* |
| `docs/architecture.md:137`, `.zh.md:129` — roadmap row *"access layer (`apid` completion, sshd/console, auth)"* | our daemon | Forward-looking plan row; the daemon named is the one being completed |
| `docs/design/mosd.md:35` and its `2026-08-19` correction note | our daemon | The renamed sentence is the M2 sketch (*"`apid` bridges HTTP/WebSocket ↔ D-Bus"*), explicitly dated and corrected two lines below. It describes **our** daemon's superseded *design sketch*, not an abandoned *architecture* — no Talos/COSI/`machined` term collides with it, and the correction note keeps it legible |
| `docs/plan/PLAN-010.md:37` — the "Context" architecture diagram | our daemon | Deliberately renamed, confirmed by RFCT-057; the diagram describes the target architecture. PLAN-010's header note (`:9-16`) already declares every remaining `webd` below it a **deliberate retention** |
| `docs/plan/PLAN-010.md:662-663` — `<policy user="apid">` | our daemon | Renamed **with** an inline note that the daemon *"was called `webd` when RFCT-048 wrote this"*, and it matches the shipped `mosd/dist/com.mos.mosd.conf` |
| `docs/design/dashboard.md` — **202 occurrences**, the largest single block | our daemon | Current-state analysis citing `mosd/apid/src/*` by path and line throughout. Its only two Talos references (`:2270`, `:2652`) already read **"Talos `apid`"** with a parenthetical marking them as the upstream machine API daemon |
| `docs/task/RFCT-055/056/057/058.md` — **160 occurrences** | our daemon | The campaign's own records, describing the rename. Every historical quotation in them retains `webd` deliberately (PLAN-003's title, `mosd/webd/` paths in §7.4, the `webd_session` cookie diff). Not altered — this record changes nothing any prior record claimed |
| Everything outside `docs/` — **158 occurrences** | our daemon | Crate/binary/unit names, `APID_STATE_DIR`, `apid_session`, `/var/lib/mos/apid`, verifier assertions, health-probe labels, and doc comments about current behaviour. **Zero** co-occur with any abandoned-architecture term. **No over-rename exists in code**, so RFCT-057's "zero `webd` outside `docs/`" stands as a complete result rather than a half-measured one |

## Counts in merged records that this task moves

RFCT-057 reported, and still reports, **58 files containing `webd`, all under
`docs/`** (`command grep -rIl webd --exclude-dir=.git --exclude-dir=_out .`),
noting that with `RFCT-057.md` itself written the figure was 59. That claim is
**left exactly as written** — it was true when measured.

The live figure has since moved, and is stated here so it does not go stale
silently:

| When | Files containing `webd` | Same pattern, outside `docs/` |
|---|---|---|
| RFCT-057, as reported | 58 (59 incl. its own record) | 0 |
| after RFCT-058 | 60 | 0 |
| **after RFCT-059** | **63** | **0** |

Pattern for every row: `command grep -rIl webd --exclude-dir=.git
--exclude-dir=_out . | wc -l`, ugrep 7.5.0. The +3 is `boards.zh.md` and
`access.zh.md` (each restored from 0 `webd` lines to their `86cd669` state)
plus `RFCT-059.md` itself. `boards.md` already contained `webd` in its rename
header note, so restoring `:97` did not change the file count. The non-`docs/`
column is unchanged at 0 — this task restored no name outside `docs/`.

## Staleness the rename did not cause — reported, not fixed

Following the precedent RFCT-058 set: name the axis, do not rewrite the
analysis.

1. **`boards.md` §7 item 4-5 and §6 — architecture-base staleness.** The
   checklist still says *"Talos image"* and the kernel policy still says
   *"Talos core"*, for a pipeline that PLAN-010 moved to a Debian/systemd base.
   That is a different axis from the rename: the fix for it is a decision about
   what the board bring-up step targets today, not a word substitution. Fixing
   only the rename error was deliberate. **Left as found.**
2. **`access.zh.md` in whole — translation-currency staleness.** The file
   describes the superseded Go-sshd/COSI model that `access.md` §2 and §3 have
   already retired, and it carries none of `access.md`'s status markers. See
   the note below.
3. **`display.md:102` / `display.zh.md:90` — a name ambiguity the rename
   created, in a correctly-renamed sentence.** *"phase 1 joins the
   access-layer/`apid` campaign"* was *"access-layer/`webd` campaign"*. The
   referent is our daemon and the rename is right, but the phrase now collides
   with **campaign `apid`** (RFCT-055 through RFCT-059), which is a different
   thing entirely. Not an over-rename, so **not fixed here**; recorded because
   it is the same class of front-door ambiguity that surfaced the `README.md`
   `talos/` defect, and a future reader deserves to find it already named.

## Note for the parked `.zh.md` decision

Two of the four fixes are in `access.zh.md`, and finding them required reading
it. What that reading showed, recorded for whoever settles the parked question
and **not acted on here**:

`access.zh.md` still documents the **superseded** access design end to end — a
Go SSH server inside the `machined` multi-call binary, policy read directly
from COSI, busybox providing `/bin/sh`, and a `DebugAccessConfig` /
`DebugAccessController` / `DebugAccessStatus` COSI chain. Its English sibling
retired all of that: §2 carries a "Superseded mechanism" paragraph, §3 is
rewritten to the mosd settings tree and `SshdReconciler`, and §4.2 records the
M5 password model as superseded rather than deleting it. The translation has
none of the `[implemented]` / `[decided]` / `[superseded]` markers §0 defines.

Whether the Chinese documents are brought current is **parked with the user and
unresolved** — see the rules paragraph in `docs/README.md` and the deliberate
`*.zh.md` exclusion in `docs/verify-index.sh`, which states in its own header
that the exclusion "is not an oversight to be fixed later". So this is a note
for that decision, **not work**. The same pattern holds in the other stale
translations: every `.zh.md` in this campaign went to **zero** `webd`, while
each English sibling kept at least one as justified history — because the
translations received an identifier-only pass with no historical judgement
applied. That asymmetry is the structural reason both `.zh.md` over-renames
found here are in translations, and it is what a future translation sweep
should expect to re-check.

## Verification

    bash docs/verify-index.sh          -> 140/140 PASS
    make docs-verify                   -> green
    git diff --name-only 0504dbb HEAD  -> docs/ only

The diff is confined to `docs/`. No file under `mosd/`, `os/`, `board/`,
`update/`, `extensions/`, the `Makefile` or the root `README.md` changed, so
the cargo gate, both image builds, both verifiers and the health/shadow/
dbus-policy/repart/bundle targets are unreachable from this change and were not
run. That is asserted by the `git diff --name-only` above, not assumed.

## What this record does not do

- It does not reopen the process decision, the name decision, or the
  orphan-the-`StateDirectory` decision.
- It does not alter what any prior task record claimed; RFCT-057's 58-file
  figure is quoted as written and the live figure is given separately.
- It does not rewrite any analysis, and it does not touch the `Makefile`.
