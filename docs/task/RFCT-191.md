# RFCT-191 PLAN-021 M3b: docs ghost sweep, recorded residuals, owner sweep and gate repairs

- **status**: completed — ghost re-measures, owner sweep (131 files), gates 9+15 red -> 1 reserved red
- **priority**: P2
- **owner**: bkd/xvc66w1c
- **createdAt**: 2026-08-27
- **completedAt**: 2026-08-27
- **plan**: PLAN-021 (M3)

PLAN-021 M3 plus the L1 scope additions: the ghost re-measures deferred from
the original M3 scope, the residuals t5 recorded during M2, the user-approved
owner sweep across docs/task, and the adjudicated gate red list.

## 1. Ghost re-measures (original M3 scope)

- The eight "no rauc references" measurements in docs/design/dashboard.md and
  docs/design/api.md: re-run each stated measurement on the current tree and
  restate the sentence with the measured result.
- docs/design/uboot-ab-handshake.md:4 and :17 stale references: repoint or
  mark dated, re-derived by content.
- docs/README's connd bullet: rewrite to the network story that ships today
  (RFCT-135/PLAN-022 owns the future; no promises).
- The 7 .zh.md path tokens: pure path-token edits, no prose changes.

## 2. t5's recorded residuals

- dashboard.md:787 gap-table U-Boot hazard row: reword to the RFCT-142 rule
  (all access via fw_printenv/fw_setenv under libubootenv's flock; one writer
  per variable).
- dashboard.md:323 and :787 fw_env.config.in device-line citations: :27-29
  moved to :49-51, re-derived by content.
- docs/design/release-signing.md 2.3: RFCT-088 completed 2026-08-23; the "in
  parallel with this document" prose says so.
- dashboard.md 2.7 + scope note: apid reads uptime via mosd get_state, not
  /proc/uptime.

## 3. Owner sweep (user-approved, tree-wide docs/task)

Replace every `- **owner**: ai-agent` (and ai-agent-prefixed variants) with
`(bkd campaign)`, except this campaign's own files, which get their real
executing id: RFCT-180 -> bkd/xw8o4454; RFCT-134/131/140 -> bkd/xexc9k2h;
RFCT-129/130/132/133 -> bkd/0fibgdbm; RFCT-136/137/138/141 -> bkd/1n7prrif;
RFCT-142/139 -> bkd/nlijystw; RFCT-096/094 -> bkd/nd6nhwv6. Files already
carrying a specific id or a milestone owner stay. Owner lines only.

## 4. Gate repairs (the adjudicated red list)

- Index checkbox sync: flip the 15 rows the checkbox gate flags to `[x]`.
- Unquoted ratchet: quote each unquoted citation in RFCT-129/130/132/134/
  139/142/180 (prefer quoting; ceiling raise only where quoting would
  falsify a dated context, in the same commit).
- Content repair: docs/task/RFCT-140.md:31 "Retry-After: 5" range re-derived
  by content.
- NOT repaired: docs/task/RFCT-139.md:70 (api.md:3444) — reserved for the
  closeout subtask's ruled work list; stays red.

## 5. Nothing else

No drive-by prose edits outside the named packages.

## Resolution

All five packages landed, one commit each. The eight "no rauc references"
measurements re-measured: RFCT-084's update-orchestration surface exists
(`rauc.rs`, `bus.rs`, `main.rs`; `InstallUpdate`/`GetUpdateState`/
`MarkUpdate`, `mos-health` reporting through `ReportHealth`), so each
sentence now states the 180-matches result and what remains parked (the
upload route — `Multipart` still appears nowhere under `os/pkgs/mosd/`).
All design-doc edits were kept line-count-neutral so no external citation
anchors shifted. uboot-ab-handshake.md `board/` references repointed with
a dated note; the README connd bullet describes what ships; the seven
stale `.zh.md` path-token forms (11 occurrences) follow their English
counterparts token-only. t5's residuals: dashboard rows re-anchored to
`fw_env.config.in:49-51`/`:23-47` and reworded to the RFCT-142 rule; 2.7
and the 5.x scope note record the RFCT-129 uptime path; release-signing
2.3 records RFCT-088's completion (2026-08-23). Owner sweep: 131 files,
owner lines only. Gate repairs: 15 index checkboxes synced (704/704
PASS); all seven ratchet files quoted down to or below their ceilings
with no ceiling raised; RFCT-140:31 re-derived to `routes.rs:682-697`.
Citations gate: 9 FAILED -> 1 FAILED, the single survivor being
RFCT-139.md:70 (`api.md:3444`), reserved for the closeout subtask by
ruling. Residue noted, not touched (outside the named packages):
release-signing.md §1.6 still says RFCT-088 is "in flight in parallel
with this document".
