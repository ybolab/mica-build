# PLAN-015 Function-oriented comments: strip history from code, tests, and docs

- **status**: approved
- **createdAt**: 2026-08-26 14:05
- **approvedAt**: 2026-08-26 14:20
- **relatedTask**: RFCT-114 (M1), RFCT-115 (M2), RFCT-116 (M3), RFCT-121 (M4), RFCT-122+ (M5) — task files created by the executing workstream as each milestone starts
- **milestones**: M1 os/ + Makefile + board/ comments; M2 mosd/ (excluding mosd/apid/) comments; M3 test-script comments; M4 the citation checker (RFCT-092); M5 documentation rewrite

## Context

Measured 2026-08-26 at `a89b969`, three-area survey. The tree's comments are
dense (mosd 23%, os ~18%, Makefile 71%) and a large share of them narrate the
project's history rather than state what the code does or must not do.

### Problem taxonomy

- **C1 Task-ID provenance stamps.** ~250 `RFCT-nnn`/`PLAN-nnn` citations in
  non-md files; ~45 identical `// PLAN-014 M4x (RFCT-110)` file headers under
  `os/verify/src/` and `os/build/src/`; task IDs leaked into runtime error
  strings (`mosd/hack/build-target.sh:55`) and test names
  (`os/verify/src/smoke-negative.test.ts:21`,
  `test/apid-api/src/phases/07b-postreboot.ts:71`).
- **C2 Process narrative.** Blocks recording who authorised an edit and when
  ("THE USER LIFTED THAT EXCLUSION ON 2026-08-26"): `mosd/mosd/src/main.rs:66-82`,
  `mosd/apid/src/main.rs:57-61`, `test/apid-api/run.sh:120-138`,
  `os/verify/src/smoke-register.ts` (~:335).
- **C3 Self-referential meta-commentary.** Comments about their own previous
  wording: `os/build-env/images.env:125`, `os/podman/versions.env:26`,
  `os/update/rauc/versions.env:27`, `os/build/src/grub-x64.ts:151`,
  `os/tests/handshake-test/harness.sh:91-99`.
- **C4 Tombstones for deleted code.** `Makefile:180-197`, `:199-210`,
  `:300-311`; `os/tests/health-test.sh:340-363` (24 lines after the RESULT
  line); ~40 comment lines naming paths that no longer exist.
- **C5 Narrative history.** "used to / no longer / was previously" (~90 hits
  across mosd + os + test), e.g. `mosd/mosd/src/reconciler/sshd.rs:19-21`,
  `os/verify/src/checks-root.test.ts:649-651`, `test/apid-api/run.sh:110-118`.
- **C6 Dramatic typography.** 77 `═══` box headers, ~1,360 multi-word ALL-CAPS
  runs, 54 dash-banner separators.
- **C7 Essays.** 68 header blocks of 25+ contiguous comment lines; worst:
  `os/rootfs/stages/40-board.Dockerfile:1-111`, `os/build-env/images.env:1-102`,
  `mosd/mqttd/src/lib.rs:1-76` (85-line file), `mosd/busname/src/lib.rs:94-154`.
  Includes design-doc blockquotes transplanted into source
  (`mosd/apid/src/startup.rs:8-14`) and decision-litigation for settled
  choices (`os/rootfs/stages/40-board.Dockerfile:38-53`).

### Worst files (severity-ranked, per area)

os/: `os/build-env/images.env` (484 cmt / 538 lines, ~55% narrative),
`Makefile` (320/449, ~50%), `os/rootfs/stages/40-board.Dockerfile` (225/253,
~65%), `os/rootfs/stages/31-feature-containers.Dockerfile` (209/232, ~60% —
the :10-37 header explains a deleted build arg), `os/verify/src/smoke-register.ts`,
`os/verify/src/smoke.ts`, `os/podman/versions.env`, `os/update/rauc/versions.env`,
`os/verify/run.sh`, `os/rootfs/stages/10-base.Dockerfile`,
`os/tests/repart-loader-test.sh`.

mosd/ (excl. apid): `mosd/mosd/src/main.rs` (~70% narrative),
`mosd/busname/src/lib.rs`, `mosd/mqttd/src/lib.rs`,
`mosd/mosd/src/reconciler/mqtt.rs`, `mosd/mosd/src/reconciler/sshd.rs`,
`mosd/mosd/src/transient.rs`, `mosd/mosd/src/bus.rs`,
`mosd/mosd/src/reconciler/wifi_ap.rs`. Estimated net reduction for mosd as a
whole: ~44% of 8,523 comment lines.

test scripts: `mosd/hack/build-target.sh` (58% comments, header is an account
of the previous implementation), `test/apid-api/run.sh`,
`mosd/hack/dbus-policy-test.sh` (high keeper ratio; only section openers rot),
`os/tests/health-test.sh`, `os/verify/src/lint.test.ts`,
`os/build/src/grub-x64.test.ts` (9 cases described relative to the deleted
shell), the ~20 identical "Batch Nx" test-file openers.

docs: 7 design docs paste one identical ~25-line "CITATION NOTE" banner
(api.md, dashboard.md, ro-root.md, bus.md, access.md, uboot-ab-handshake.md,
release-signing.md — ~175 lines); 7 files carry the same 5-line "Daemon
rename" banner; `docs/design/dashboard.md` §6-§7 (~1,270 lines) is
rejected-option analysis for decisions settled 2026-08-19;
`docs/design/api.md` §10 (751 lines) is a defect register, and ~150 lines of
resolved-question annotations sit in §§2-9; `os/verify/HARNESS.md` (:26-249
is a register keyed to line numbers of a deleted file) and
`os/build/HARNESS.md` (four byte-identity gate sections for a one-time
migration) are campaign journals, not manuals; `docs/architecture.md` still
describes the abandoned Talos architecture behind a migration notice;
`extensions/README.md` documents an empty directory.
`docs/design/containers.md` (0 task IDs, 0 narrative) is the register to copy.

### MUST-KEEP classes (deletion here is a defect)

1. Test-harness safety invariants: the `MOSD_DRY_RUN=1` / `MOSD_SHADOW_PATH`
   blocks in `mosd/mosd/tests/{bus,tree,scan}.rs`, `mosd/apid/tests/e2e.rs`;
   "never point at the host's /etc/shadow".
2. Reproducibility invariants: `os/rootfs/stages/90-pack.Dockerfile:334-360`
   (single-processor mksquashfs, why no -all-root), FILE_MTIME/@epoch quirks
   (`os/rootfs/build-v2.sh:166-175`, `os/build/src/geometry.ts:360-362`),
   verity UUID/salt pinning, `os/build/src/pin-seeded-times.ts:1-53`,
   `os/boards/cx3576/board.env` geometry/determinism blocks (:95-175, :320-338).
3. Tool quirks: debugfs fails on stderr not exit status
   (`os/build/src/tools/e2fsprogs.ts`), sgdisk silent relocation
   (`os/build/src/layout-x64.ts:214`), replaceAll `$&` expansion
   (`os/build/src/grub-x64.ts:146-157` — keep the rule, drop the "earlier
   version of this comment" framing), mkimage wall-clock fallback
   (`os/tests/handshake-test/harness.sh:102`), rauc block-size refusal,
   `.PHONY` no-patterns and the pipefail/SIGPIPE inversion in `Makefile`.
4. Protocol/wire facts: shadow(5) nine fields, bcrypt 72-byte truncation,
   OpenSSH fingerprint format, MQTT QoS-0/retained-delete/topic grammar,
   D-Bus `own_prefix` measured semantics, broker config key set, the nested
   MQTT live-state shape (`mosd/apid/src/routes.rs:1839-1846`).
5. Ordering constraints: config-before-service-start in reconcilers,
   broker-before-bridge, sshd config precedence, `reset-failed` for
   StartLimitBurst, stage-selection and SOURCE_DATE_EPOCH notes in
   `os/build/src/stages.ts`.
6. Secret-handling: PSK single-0600-file rule (`wifi_ap.rs:24-28`), mqttd
   structural redaction key list, independent-draw rule (`identity.rs:102-106`),
   "a hash inside a signed rootfs is a fleet-wide shared secret" error strings.
7. Deliberate citations of present-tense contracts (~30 of ~250): the five
   "PLAN-014's Scope section" quotes added by `3b438f8`
   (`os/verify/src/checks-bootchain.ts:31,376`, `checks-connd.ts:12`,
   `checks-system.ts:29`, `checks-ext4.ts:424`), design-doc contract
   references (`docs/design/uboot-ab-handshake.md` §refs in
   `os/update/rauc/*`, `board/cx3576/uboot/Dockerfile`, `os/build/src/mkimage-v2.ts:14`;
   `access.md`/`ro-root.md`/`containers.md` refs), and the output-format
   contract note in `os/verify/src/verify-cli.ts:22`.
8. Test-intent comments that explain a non-obvious assertion shape (e.g.
   `test/apid-api/src/phases/04-readonly.ts:19-37`, `src/console.ts:19-34`,
   `06-backoff.ts:1-17`, `mosd/hack/dbus-policy-test.sh:14-17`, `:623-660`,
   `os/tests/repart-loader-test.sh:4-22`); keep the inline note, cut the
   15-25-line preamble above the test.

### Triage rule

A citation of the form "X says «quoted clause», therefore this code does Y"
constrains present behaviour — keep. A citation of the form "RFCT-nnn / M4x
ported/added/changed this" records who typed it — delete; git blame holds it.
The same rule by tense: present-tense constraint stays, past-tense narrative
goes.

## Decisions (user-set, 2026-08-26)

1. Comments are function-oriented: they state present-tense constraints the
   code cannot show. Provenance and history belong to git.
2. `docs/design/dashboard.md` §6-§7, the HARNESS campaign registers, and
   equivalent history-as-body sections are **deleted, not relocated**. Git
   history is the archive.
3. RFCT-092 (the citation checker) is built **first** in the docs milestone
   and then used to repair the `path:line` drift that M1-M3 cause.
4. `mosd/apid/` comment cleanup is carved out to PLAN-016 M4 so the two
   workstreams have disjoint write scopes.

## Proposal

- **M1 (RFCT-114)** os/, Makefile, board/: delete C1-C4 outright; rewrite C5-C7
  survivors into 1-3-line present-tense statements; keep-list verified file by
  file. Diffs are comment/whitespace-only; no executable line changes.
- **M2 (RFCT-115)** mosd/ excluding mosd/apid/: same treatment; module doc
  comments shrink to what the module does and its invariants.
- **M3 (RFCT-116)** test scripts (test/, mosd/hack/, os/tests/, *.test.ts):
  same treatment; task IDs leave test names and runtime error strings (these
  are string changes, the one permitted non-comment edit class, each named in
  the task file).
- **M4 (RFCT-121)** the citation checker RFCT-092 describes: resolves
  `path:line` citations in docs/design and asserts quoted text still matches;
  wired into `make` and CI as advisory-then-gating.
- **M5 (RFCT-122+)** docs: delete the 7 duplicated citation banners and 6 of 7
  rename banners; api.md §10 and resolved-question annotations deleted;
  dashboard.md §6-§7 deleted; both HARNESS.md files reduced to manuals
  (keep the tool-behaviour measurements, reworded to present tense);
  architecture.md rewritten to the current system; README sweeps
  (root, os/*, extensions/); citations repaired using M4's checker;
  `docs/design/containers.md` is the style target. `.zh.md` siblings out of
  scope.

## Risks

- A test or verifier may grep a comment this plan deletes (the verify suite
  strips comment lines in places; `verify-cli.ts` output format is quoted by
  docs). Mitigation: full gates green per milestone
  (`make os-verify-cx3576-v2`-equivalent bun suites, `cargo test`,
  `mosd/hack/check.sh`, shellcheck, `docs/verify-index.sh`).
- Comment deletion shifts line numbers under ~708 `path:line` citations in
  docs/design. Accepted: M4's checker measures and M5 repairs; docs are
  already drifted today.
- Judgement calls on keep-vs-delete. Mitigation: the MUST-KEEP list above is
  binding; anything on it that moves must be quoted in the task file.

## Scope

- **In**: comments (and doc-comments) in `mosd/` (excluding `mosd/apid/`),
  `os/`, `test/`, `Makefile`, `board/`; task-ID strings in test names and
  error messages; `docs/design/*.md` (English), `docs/architecture.md`,
  `README.md`, `os/**/README.md`, `os/**/HARNESS.md`, `extensions/README.md`.
- **Out**: `docs/task/`, `docs/plan/`, `.zh.md` files, `mosd/apid/`
  (PLAN-016), `talos/`, any change to executable behaviour, formatting of
  code the plan does not name.
