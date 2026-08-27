# RFCT-077 Verifier assertions for the built-in prefix, fixture-mode widening, and the SIGPIPE sweep

- **status**: completed — two image assertions added and guard-fired, fixture mode widened to the check it delegates to, the count-based control replaced by a per-fact identity diff, 105 SIGPIPE sites fixed structurally
- **priority**: P1
- **owner**: ai-agent
- **createdAt**: 2026-08-20 16:45
- **claimedAt**: 2026-08-20 16:49
- **completedAt**: 2026-08-20 17:15

Campaign `l1-o7ee8v0o-20260820142702-ui`, phase 4 of `docs/design/api.md` §8.2.
Branch `bkd/5gofg363`. Base `c47d6b2`.

```
$ git rev-parse HEAD
c47d6b28526b51167bd33083ccb16bfbe8cf3ff4
$ git merge-base --is-ancestor c47d6b2 HEAD && echo BASE-OK
BASE-OK
$ test -f os/ui-location-test.sh && grep -q '/builtin' mosd/apid/src/routes.rs && echo DEPS-OK
DEPS-OK
```

`DEPS-OK` is positive evidence rather than the absence of a complaint: `main`
is at `b4b7c72` and carries none of RFCT-071..076 or 080, so the `/builtin`
prefix item 1 asserts would not exist there.

No Rust was written or changed. `mosd/apid/` was read but not touched; the only
file under `mosd/` in the diff is `mosd/hack/dbus-policy-test.sh`.

## Description

Four items, all about the verifier and its harness rather than about the
campaign's feature.

**1. The reserved prefix is unasserted by the image contract.** RFCT-075 landed
`/builtin` (`mosd/apid/src/routes.rs:782-791`) and asserted, in the crate, that a
bundle cannot shadow it by dispatch order. That is a fact about code. §6.2 makes
a separate claim about the *image* — the built-in UI is `maud` expansions
compiled into `/usr/bin/apid`, with no `include_str!`, no `include_bytes!` and no
asset directory — and **nothing in the image contract said anything about it.**
A crate test proves the sources say so; only the image can say what shipped.

**2. `MOS_VERIFY_FIXTURE_ROOT` ran the six custom-UI assertions "and nothing
else".** RFCT-073's case *"/srv absent from the tree: existence is chained, not
re-derived"* proves those six do **not** re-derive mountpoint existence. It does
**not** prove anything still catches a missing `/srv`, and from outside the two
are the same picture. The chain itself is real and mechanical — `PACKED_MOUNTPOINTS`
is one constant read by the UI assertion and by the loop it delegates to, so they
cannot drift — but **that loop had only ever been observed passing**, because it
runs against real images, where `/srv` is always there.

**3. Widening fixture mode breaks `expect_all_pass`, and the obvious repair is a
trap.** The old control was `RC==0 && 0 FAIL && exactly 6 PASS`. The hardcoded
`6` is the only reason RFCT-073's `/srv`-absent case means anything: replace it
with `RC==0 && 0 FAIL` and that case still passes on a fixture where the UI
assertions never ran at all — a proof-of-chaining turned into a proof of nothing,
while the diff reads as cleanup.

**4. 105 pipeline sites can kill a verifier run with no `FAIL:` and no
`RESULT:`.** Under `set -euo pipefail` a consumer that exits early (`| grep -q`,
`| head -n1`, `| awk '{print; exit}'`) leaves the producer to take SIGPIPE, which
`pipefail` promotes to exit 141 for the whole pipeline. Observed once in this
campaign: a run died `Error 141` with zero `FAIL:` lines and no `RESULT:` line,
and two re-runs on the same image passed 323/323.

## Deliverable

| # | change | file |
| --- | --- | --- |
| 1 | `check_builtin_ui`: two assertions about the built-in escape as an on-image fact | `os/verify-image-v2.sh` |
| 2 | mountpoint loop hoisted to `check_packed_mountpoints` and run in fixture mode too | `os/verify-image-v2.sh` |
| 3 | count-based expectations replaced by a per-fact identity diff | `os/ui-location-test.sh` |
| 3 | two new negative cases for the item-1 assertions | `os/ui-location-test.sh` |
| 4 | 105 SIGPIPE sites fixed structurally | four scripts |
| — | target comment brought in line with what the test now proves | `Makefile` |

## The two assertions, named by what each catches

Both live in `check_builtin_ui`, beside `check_ui_location`, because fixture
mode dispatches before any image is opened.

**`catches a built-in escape that has grown an on-disk half`** — the packed
read-only root ships nothing at or under `BUILTIN_PREFIX`. §6.2 guarantees the
built-in UI is `maud` expansions inside `/usr/bin/apid` **and nothing else**,
because §6 requires the fallback to be the artifact with **no build chain**. A
file tree under the reserved prefix is a second artifact that has to be built,
shipped and kept in step with the binary, and when it is stale or missing the
escape fails in precisely the situation it exists for.

**`catches a built-in escape that is no longer inside the binary`** — the packed
`/usr/bin/apid` carries the escape page's own **rendered markup**:

```
BUILTIN_MARKUP='<form method="post" action="/builtin/deactivate">'
```

This is deliberately markup rather than a bare route constant.
`/builtin/deactivate` on its own would still be in the binary after the pages
moved out to an on-disk asset tree, which is the one change this is here to
catch. `maud` expands the page into string literals inside the binary, so the
byte sequence is there **iff** the page is compiled in.

It also asserts an **outcome** rather than enumerating mechanisms. §6.2 names
three (`include_str!`, `include_bytes!`, an asset directory); whichever one moved
the pages out to files — including one nobody has thought of — the rendered
markup stops being in the binary and this goes red. See the finding below for
why enumerating the three would already have been wrong.

Read with `LC_ALL=C tr -c '[:print:]' '\n' < … | grep -F -- … >/dev/null`, the
same spelling the libcrypt check uses: it needs no `grep -a`, which busybox and
GNU grep do not agree about, and it is already the SIGPIPE-safe shape.

## The verifier check total, before and after

Predicted per term before running, decomposed so a partial failure would be
diagnostic:

| term | predicted | observed |
| --- | --- | --- |
| `os/verify-image-v2.sh` base | 323 | 323 |
| `+ catches a built-in escape that has grown an on-disk half` | +1 | +1 |
| `+ catches a built-in escape that is no longer inside the binary` | +1 | +1 |
| **total** | **325** | **325/325 PASS** |
| `os/ui-location-test.sh` base | 9 cases | 9 |
| `+ an asset tree shipped at the reserved /builtin prefix` | +1 | +1 |
| `+ an apid binary that no longer carries the escape page` | +1 | +1 |
| **total** | **11 cases** | **11/11 PASS** |
| `docs/verify-index.sh` base `3 x 85` | 255 | 255 |
| `+ docs/task/RFCT-077.md` (`3 x 86`) | 258 | 258/258 PASS |
| `docs/verify-index-test.sh` | 8 (unmoved) | 8/8 PASS |

Hoisting the mountpoint loop into a function adds **no** check on a real image:
it is the same single check, called from one place instead of being inline.

The SIGPIPE sweep is asserted to move nothing, and was measured that way against
both verifiers before the assertions were added:

```
os/verify-image-v2.sh   323/323 before the sweep, 323/323 after
os/verify-image.sh      136/136 before the sweep, 136/136 after
```

and for v1, where the sweep touched 72 sites and nothing else, the PASS/FAIL
lines are **identical line for line** before and after — `diff` is empty. The
pre-sweep verifier was recovered with `git show c47d6b2:os/verify-image.sh` and
run against the same image; the scratch copy was deleted and the tree left clean.

## The negative direction, and why it is no longer a count

Every case in `os/ui-location-test.sh` now **names the assertions it expects, by
identity**, and the harness diffs that against the set that actually ran. The
rule the old control could not express:

> Declare the expected set by identity. Observe the actual set. Diff them. Fail
> naming what is missing and what is unexpected. Never assert a count, never
> assert only absence-of-failure.

`ASSERTIONS` is one row per assertion fixture mode runs — key, the substring
identifying its PASS line, its FAIL line, and its baseline state. An empty third
field means the two directions share one substring, which is true of every
assertion written in RFCT-073's `catches …` register. The packed-root mountpoint
check predates that register and says two different things, so it spells both
out — and its FAIL substring is what gives it its first failing observation.

**Why the obvious repair was refused, measured.** Fixture mode was temporarily
gutted so that it ran no assertions at all, and both predicates were applied to
the real output:

```
gutted fixture mode: RC=0  PASS lines=0  FAIL lines=0
RESULT: PASS (0/0 checks)
the weakened rework  [ RC==0 && 0 FAIL ]            -> PASSES (control destroyed)
the old hardcoded    [ RC==0 && 0 FAIL && 6 PASS ]  -> fails
```

Under `RC==0 && 0 FAIL`, a run in which **nothing executed** is indistinguishable
from a clean run — and RFCT-073's `/srv`-absent case, whose entire content is
that six assertions still PASSED, would survive it. The identity diff names all
nine that did not run. The experiment was reverted; nothing of it is committed.

**Three positive controls for the new harness**, each a real mutation of the
verifier, each reverted afterwards:

| mutation | what the harness said |
| --- | --- |
| fixture mode runs nothing | `did not run: ui-content-baked(expected PASS) builtin-on-disk(expected PASS) …` (all nine) |
| fixture mode grows an unnamed assertion | `unnamed assertion ran: PASS: some new check nobody named in ui-location-test.sh` |
| `check_builtin_ui` silently stops being called | `did not run: builtin-on-disk(expected PASS) builtin-in-binary(expected PASS)` |

The exit status is **derived** rather than stated — a case expecting any FAIL
requires a non-zero exit, a case expecting none requires zero — so the old RC
control survives the change without a second thing to hand-maintain.

`expect_set` also degrades the way the task needs: the next person to widen
fixture mode adds a **name** to `ASSERTIONS`, and until they do, the harness says
`unnamed assertion ran: …` rather than silently changing a number.

## The eleven cases, and the guard-fired observation for each

Every case below was observed FAILING with its own message. Cases 0–7 are
RFCT-073's, re-expressed by identity; 4, 7, 8 and 9 are new or newly widened.

| case | expected set | fired |
| --- | --- | --- |
| 0 baseline | all ten in baseline state | — (positive control, exit 0) |
| 1 `/srv` on EPHEMERAL | `ui-off-data=FAIL ui-on-ephemeral=FAIL` | both, own messages |
| 2 `/srv` on STATE | `ui-off-data ui-on-state ui-fixed-ceiling` | all three |
| 3 growfs stripped | `ui-fixed-ceiling=FAIL` | yes |
| 4 `/srv` absent from the tree | `mountpoints-exist=FAIL`, six UI still PASS | `FAIL: mountpoint(s) missing from the read-only root: /srv; a verity root cannot create them at runtime, so the mount fails` |
| 5a bare `/srv/ui` shipped | `ui-content-baked=FAIL` | yes |
| 5b bundle baked under `/srv/ui` | `ui-content-baked=FAIL` | yes |
| 6 deeper `/srv/ui` entry | `ui-off-data ui-on-ephemeral ui-unasserted-mountpoint` | all three |
| 7 nothing covers the UI root | `ui-no-filesystem=FAIL mountpoints-exist=FAIL`, **six ABSENT** | both, and the six confirmed not to have run |
| 8 asset tree at `/builtin` | `builtin-on-disk=FAIL` | `FAIL: catches a built-in escape that has grown an on-disk half: the packed read-only root ships /builtin /builtin/assets /builtin/assets/app.js. …` |
| 9 apid without the escape page | `builtin-in-binary=FAIL` | `FAIL: catches a built-in escape that is no longer inside the binary: the /usr/bin/apid packed in this image does NOT carry the escape page's rendered markup (<form method="post" action="/builtin/deactivate">). …` |

**Case 4 is the point of item 2.** Six passes prove only that the UI assertions
do not *re-derive* existence. They prove nothing about whether anything still
*catches* a missing `/srv`. Fixture mode now runs the check being delegated to,
and this case requires it to go red with its own message — its first failing
observation in the history of this file.

**Case 7 gained six `=ABSENT` entries.** `check_ui_location` RETURNS on the
no-covering-entry path, so the six that follow it never run. *Did not run* is a
different fact from *ran and passed*, and only an identity diff can tell them
apart; the old count could not see it and the weakened repair would not have
either.

**The fixture is still derived, not authored.** `BUILTIN_PREFIX`,
`BUILTIN_MARKUP`, `APID_BIN` and `PACKED_MOUNTPOINTS` are read **out of the
verifier** with `sed`, and the test fails loudly if any of them stops being
defined. A fixture built from this file's own idea of the reserved prefix would
test that idea rather than the verifier's — the same reason the fstab is rendered
from the SHIPPED `fstab.in`. `new_fixture` now also creates `/home` and `/root`,
which `PACKED_MOUNTPOINTS` names and `fstab.in` does not, because they are STATE
binds owned by mount units.

## The SIGPIPE sweep

**Every site was fixed. No site was classified as safe.** The instruction that
reverses RFCT-080's judge-don't-patch rule is on the record and the reasoning is
kept here because the conclusion matters more than the data: proving one site
safe needs a sample size that could have seen the thing, **and** a harness not
written blind to it, **and** the right interpreter (BusyBox awk on musl inside
`alpine:3.21`, whose measured rates differ from the host's by two orders of
magnitude), **and even then** the rate moves with consumer speed — the same
payload and match position, with one extra `awk` pattern per record, moved a
measured 28/20000 to 0/10000. A multi-thousand-run containerised experiment that
still would not settle it, against a fix that costs one token.

**Sites, by file.** The task's brief said 29 in `os/verify-image-v2.sh` and *"11
between them"* for the two verifiers; the second number is off by an order of
magnitude and is reported as a finding below.

| file | sites | shapes |
| --- | --- | --- |
| `os/verify-image-v2.sh` | 30 | 29 matching `\| grep -*q*` / `\| head -n1`, plus one `printf \| awk '{print $3; exit}'` at the old `:719` that neither pattern matches |
| `os/verify-image.sh` | 72 | 67 of the same two shapes, 3 `\| awk '{…; exit}'`, 2 with the `grep -q` on a **continuation line** so a single-line grep does not see them |
| `docs/verify-index.sh` | 1 | `readme_entries_under \| grep -qxF` |
| `mosd/hack/dbus-policy-test.sh` | 1 | `dbus-daemon --version \| head -n1 \| awk` |
| `os/ui-location-test.sh` | 1 | `grep -F … \| grep -q '^FAIL:'`, inside the harness being rewritten |
| **total** | **105** | |

**Three structural fixes, no measurement needed.**

1. **Here-string** where the producer is a shell variable: `grep -q P <<<"$v"`
   for `echo "$v" \| grep -q P`. bash materialises the string before exec'ing the
   consumer, so there is no producer left to signal, and the pipeline disappears
   entirely.
2. **`grep … >/dev/null`** instead of `grep -q` where the input is a stream. The
   file already used exactly this fix at its libcrypt site, with a comment; both
   verifiers now carry that comment on a shared helper too. Without `-q`, grep
   must print every match and therefore reads to EOF; the exit status is
   unchanged.
3. **`first_line()` — `awk 'NR == 1'`** — instead of `\| head -n1`, and dropping
   `exit` from an awk consumer where the payload is small and a full scan is
   free. awk reads to EOF and prints only the first record. `\| tail -n1`, which
   both files already use in ~20 places, was never a site: `tail` never exits
   early.

`| head -n1` was **not** rewritten to `| tail -n1`. They differ whenever there is
more than one match, and silently changing which match a check reads is exactly
the kind of tidying this campaign is about.

**Nothing was reserved for judgement.** No site's fix had a real cost: none
required a large scan or a non-local restructure. Per the instruction, no
per-site safety argument is written for a site whose fix is one token.

**The fix shapes validated inside the real container, with positive controls.**
A zero is only evidence from a harness that could have seen the thing, so the old
shapes are reported alongside the new ones. 200 KB payload, match on the first
line, `alpine:3.21`, BusyBox v1.37.0 on musl, script fed on stdin, 200 runs each:

```
== POSITIVE CONTROLS: these must fire ==
printf | grep -q          (the old shape)      exp=rc141     rc0=0    rc141=200  rcother=0
printf | head -n1         (the old shape)      exp=rc141     rc0=0    rc141=200  rcother=0
printf | awk {print;exit} (the old shape)      exp=rc141     rc0=0    rc141=200  rcother=0

== THE THREE FIXES: these must not ==
printf | grep ... >/dev/null                   exp=rc0       rc0=200  rc141=0    rcother=0
printf | awk NR==1                             exp=rc0       rc0=200  rc141=0    rcother=0
grep -q ... <<<"$big"  (here-string)           exp=rc0       rc0=200  rc141=0    rcother=0
head -n1 <<<"$big"     (here-string)           exp=rc0       rc0=200  rc141=0    rcother=0
```

**What this does and does not establish.** It establishes that the three fix
shapes remove the early exit and that the shapes they replace do take SIGPIPE, in
the interpreter these scripts actually run under. It is **not** a rate
measurement for any individual site, and it is not offered as one: the payload
here is chosen to fire deterministically, which is the opposite of what a site
survey would need. The justification for the sweep is structural.

## The `141` observation, inherited and left open

**No confirmed cause.** Ledger, unchanged by this task:

- commit `0f4990f`; last printed line `PASS: boot.scr carries the legacy uImage magic 27051956`, position **PASS #106** of 323; exit 141; **0** `FAIL:` lines; **no** `RESULT:` line; 2 re-runs on the same image both clean.
- `os/verify-image-v2.sh:719` was proposed and is **not** exculpated. It was under-measured, like every other site — and it is now fixed, along with the other 104.

**Two hypotheses remain untested**, and both survive this task:

1. the container's stdout crosses a docker pipe, so the last **printed** line
   need not be the last **executed** check — the position `#106` may be an
   artefact of buffering rather than a pointer at the failing site;
2. the 141 came from something outside the enumerated pipeline sites entirely.

**Landing this makes the next occurrence a discriminating test.** With all 105
sites structurally unable to produce a 141, a recurrence of the signature (exit
141, zero `FAIL:`, no `RESULT:`) leaves only those two hypotheses standing.
Closing it was explicitly not this task's acceptance, and it is not claimed.

## Checks run

`BOARD_DIR=/srv/ai/mos/board/cx3576`, valid because this campaign changes
nothing under `board/`: an L3 editing `board/**` would have to rebuild the BSP or
build an image from a kernel not containing its own change.

| check | predicted | observed |
| --- | --- | --- |
| `bash docs/verify-index.sh` | 258/258 (255 + 3 for this record) | 258/258 PASS |
| `bash docs/verify-index-test.sh` | 8/8 | 8/8 PASS |
| `bash os/ui-location-test.sh` | 11/11 cases | 11/11 PASS |
| `make os-image-cx3576-v2` | builds | assembled |
| `make os-verify-cx3576-v2` | 325/325 | 325/325 PASS |
| `make os-image-cx3576` (v1) | builds | assembled |
| `make os-verify-cx3576` (v1) | 136/136, unmoved | 136/136 PASS, PASS/FAIL lines identical to the pre-sweep verifier |
| `make os-dbus-policy-test` | 10/10 | 10/10 PASS |
| `bash -n` on all five edited scripts | clean | clean |

The v1 image was built and verified **because the sweep touched 72 sites there**
and a mechanical edit at that scale deserves an executed control, not a syntax
check. `shellcheck` is not installed on this host.

**`mosd/hack/check.sh` was not run, and the proof is that it is unreachable:**
this task changed no Rust. The only file under `mosd/` in the diff is
`mosd/hack/dbus-policy-test.sh`, whose own target `make os-dbus-policy-test` was
run instead and passes 10/10.

**No `141` was seen in any run of this task** — v1 and v2 verifiers, base and
swept, six runs total. That is not evidence about the rate; it is recorded so a
reader knows the known flake did not fire here and no re-run was consumed.

## Findings — reported, not fixed

**1. §6.2's asset-directory evidence now trips on the tree, while the property
it stands for still holds.** §6.2 evidences "compiled into the binary" partly as
*"no `assets/`, `static/` or `public/` directory in the crate"*. Measured at this
base, `mosd/apid/src/assets/` **exists** — `mime.rs`, `mod.rs`, `path.rs`,
`serve.rs`, the asset-serving module RFCT-074 added. It is a Rust module, not a
directory of asset files, and the property §6.2 was actually reaching for is
intact: the only non-Rust file in the crate is `Cargo.toml`, and
`grep -rn 'include_str!\|include_bytes!' mosd/apid/` returns only the doc comment
at `mosd/apid/src/routes.rs:12` that states the rule. **A reader running §6.2's
check literally would now get a false positive.** This is reported rather than
designed around — `docs/design/**` is out of my fences — and it is the concrete
reason the new assertion tests the **outcome** (rendered markup in the shipped
binary) rather than enumerating §6.2's three mechanisms.

**2. §6.2's image-side citations name `webd`, which is not in the tree.** §6.2
says the built-in UI is compiled into the **`webd`** binary, cites
`mosd/webd/src/routes.rs`, `mosd/dist/webd.service:1-13` and
`os/rootfs/Dockerfile.v2:294` installing `/usr/bin/webd`, and names
`WEBD_STATE_DIR`. On this tree: no `mosd/webd/`; `mosd/dist/apid.service`;
`os/rootfs/Dockerfile.v2:294` installs `/usr/bin/apid`; the variable is
`APID_STATE_DIR` (`mosd/apid/src/config.rs:39`). **This is dated-by-policy, not
wrong** — the document's own note at `docs/design/api.md:41-55` re-pointed
§1's citations after the rename and leaves everything else pinned at `86cd669`,
where the crate was `mosd/webd/`. Recorded so the next reader does not re-derive
it. The **substance** of §6.2 layer 3 was re-measured and still holds:
`mosd/dist/apid.service` is `Type=`, `ExecStart=`, `Restart=`, `StateDirectory=`
and nothing else — no `ProtectSystem=`, no `ReadWritePaths=`, no
`ReadOnlyPaths=`. dm-verity is still the only layer protecting the binary.

**3. The brief's site count for the two verifiers is off by an order of
magnitude.** *"os/verify-image-v2.sh and os/verify-image.sh (11 sites between
them)"*. Measured: **102** across those two files (30 + 72), of which the brief's
own separate figure of 29 for `os/verify-image-v2.sh` is exactly right. All 102
were fixed. Recorded because a scope estimate that low would have invited
sampling, and sampling is the failure mode this item exists to prevent.

## What is NOT claimed — hardware

The **v2** stack — verity root, A/B, `rauc install`, apid — is **not exercised on
hardware.** Everything above is a packed image verified on a host, and a packed
image verified on a host is not a booted device. What has booted is a **v1**
image reaching `mos login:` on a real CX3576-Z, and the repart/maskrom and
SPL-hash work ran against a real board. Nothing in this task changes either.

In particular: that `/usr/bin/apid` carries the escape page's markup is asserted
of the **file inside the image**. That §6.3's documented action reaches a
rendering page on a running appliance is a different claim and is not made here.

## Deliberately out of scope

- **The unshadowability of `/builtin` by dispatch order.** A fact about code,
  already asserted by RFCT-075's `a_bundle_cannot_shadow_the_reserved_builtin_prefix`
  and its guard-fired counterpart. Restating it here would add a line and no
  coverage — the same reasoning by which RFCT-073's assertion 4 chains to the
  mountpoint check instead of re-deriving it.
- **`mosd/apid/**`.** RFCT-078 is in that test surface concurrently. Read only.
- **Closing the `141`.** Explicitly not this task's acceptance; the ledger and
  the two surviving hypotheses are recorded above instead.
- **`docs/design/api.md`.** The two §6.2 mismatches are findings above, not
  edits.
