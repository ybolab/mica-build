# RFCT-116 PLAN-015 M3: function-oriented comments in the test scripts

- **status**: completed
- **priority**: P2
- **owner**: (bkd campaign)
- **createdAt**: 2026-08-26 16:40
- **claimedAt**: 2026-08-26 16:40
- **completedAt**: 2026-08-26 17:55
- **plan**: PLAN-015 (M3)

Apply PLAN-015's triage rule to the test scripts: `test/**`, `mosd/hack/**`,
`os/tests/**` and every `*.test.ts` in the tree. Delete the C1-C4 classes
outright, rewrite the C5-C7 survivors into short present-tense statements, and
leave every MUST-KEEP item standing. Task IDs also leave test names and runtime
strings - the one permitted non-comment edit class, each change tabulated below.

## Scope

- **In**: `test/**`, `mosd/hack/**`, `os/tests/**` except `README.md`, every
  `*.test.ts` under `os/verify/src/`, `os/build/src/` and `os/build/src/tools/`.
- **String-only (scope extension approved by L1)**: `os/verify/run.sh`,
  `os/build/run.sh`, `os/verify/src/checks-*.ts` (non-test) and the four
  `os/build-env/*/Dockerfile` LABEL values - task IDs leave user-visible
  strings there, and nothing else in those files is touched.
- **String-only (second handover, from M2 via L2)**: four `.rs` string literals
  under `mosd/` - `busname/src/lib.rs`, `mosd/tests/scan.rs`,
  `mqttd/tests/protocol.rs`, `mosd/src/reconciler/sshd.rs`. M2 treated the
  comments in those files; only the literal changes here. The
  `sshd.rs` key-comment site is **deliberately retained** - see below.
- **Out**: `mosd/apid/**` (PLAN-016), every non-test file under `os/` and
  `mosd/` that M1 and M2 already treated, `os/tests/**/README.md`, `Makefile`,
  `board/**`, `docs/design/**`, `docs/plan/**`, `*.zh.md`, `.gitea/**`.
- Comment and blank-line changes only, plus the string table below.

## Acceptance

- `git diff c03bd09...HEAD` (the `bkd/fxykktxe` head this branch was cut from,
  before L2 merged round 1 back into it) over the area is comment/whitespace-only
  plus the tabulated string changes and the two `docs/task/` files. **Verified**
  by filtering the whole diff to non-comment lines; the result is exactly the
  tables below and nothing else. 72 files, none outside scope.
- Every MUST-KEEP item that lives in this area survives; anything reworded is
  quoted before and after below.
- All gates green.

## What changed, in numbers

70 files, **+562 / -819**: a net reduction of 257 lines over the area, in
10 commits. Plus `docs/task/RFCT-116.md` and one row in `docs/task/index.md`.
The four `mosd/` `.rs` files account for 7 changed lines of that total; the
rest is the comment sweep.

| file | before | after |
|---|---|---|
| `mosd/hack/build-target.sh` | 282 | 222 |
| `test/apid-api/run.sh` | 789 | 757 |
| `os/tests/health-test.sh` | 372 | 348 |
| `mosd/hack/dbus-policy-test.sh` | 973 | 958 |
| `os/verify/src/smoke.test.ts` | 1095 | 1081 |
| `os/tests/repart-loader-test.sh` | 435 | 426 |
| `os/tests/shell-pipefail-lint.sh` | 77 | 70 |
| `os/build/src/grub-x64.test.ts` | 381 | 375 |

## Files treated

**The sites PLAN-015 names, each rewritten rather than swept:**

- `mosd/hack/build-target.sh` - the 26-line header account of the previous
  implementation reduced to three lines. What survives is what still binds:
  the two arguments, the repository mounted at the fixed path `/src` and not
  `mosd/` (because the workspace lists `../update/sign`), the commit resolved
  on the host because this checkout is a git worktree, that an empty commit is
  not an error, and that dirty is marked.
- `test/apid-api/run.sh:110-118` (the boot-2 default, gated-off history) and
  `:120-138` (the R6 escalation and the scope-lift narrative) deleted; the
  present-tense facts kept in 3 and 4 lines respectively.
- `os/tests/health-test.sh:340-363` - the 24 tombstone lines after the RESULT
  line deleted outright, plus the matching clause in the header.
- `os/tests/handshake-test/harness.sh:91-99` - the self-referential
  "THE CITATION WAS RE-CHECKED AT ..." block deleted. **The mkimage wall-clock
  fallback note below it is MUST-KEEP and survives**; its rewording is quoted
  in full under "MUST-KEEP items reworded".
- The ~20 identical "Batch Nx" / `PLAN-014 M4x (RFCT-110), RFCT-096's rule`
  openers across `os/verify/src/checks-*.test.ts` - every one replaced by a
  sentence naming what the file drives. The rule the stamp carried ("a check
  lands with the fixture that fails it, because the parity harness cannot tell
  a check that PASSES from one that CANNOT FAIL") is kept where it was stated.
- `os/build/src/grub-x64.test.ts` - the nine cases described relative to the
  deleted `os/mkimage-x64.sh`. Every describing **comment** is rewritten to
  state the rule directly. Four **test names** still name the deleted script;
  see "Left untreated, and why" below.
- `os/verify/src/lint.test.ts` - the dash banner and the
  "run against os/verify/lint.sh on 2026-08-25" block replaced by what the
  `shellPassed` cases actually are.

**The rest of the area**, grep-driven per the plan's list (`RFCT-`, `PLAN-`,
`used to`, `no longer`, `previously`, `WAS HERE`, `═══`, dash banners, 25+ line
comment blocks):

- `mosd/hack/` - `build-target.sh`, `dbus-policy-test.sh`.
  `check.sh` and `build-aarch64.sh` were read and needed no change: their
  comments are already present-tense statements of what the code does.
  `mosd/hack/check.sh` was **not edited at all**.
- `test/apid-api/` - `run.sh`, `src/{client,config,console,main,report,runner,
  selftest}.ts`, `src/phases/{04-readonly,05-mutate,06-backoff,07-reboot,
  07b-postreboot}.ts`. `01-transport.ts`, `02-setup.ts`, `03-login.ts` and
  `08-poweroff.ts` were read and left alone - their headers are already
  function-oriented.
- `os/tests/` - `health-test.sh`, `quadlet-doc-test.sh`, `repart-loader-test.sh`,
  `shadow-reconcile-test.sh`, `shell-pipefail-lint.sh`,
  `factory-root-gate/{gate,inner}.sh`, `handshake-test/{harness,run}.sh`.
  `factory-root-gate/mutate.sh` carried no C-class comment.
- `os/verify/src/*.test.ts` - 25 files.
- `os/build/src/*.test.ts` - `bundle.test.ts`, `grub-x64.test.ts`,
  `paths.test.ts`, `stages.test.ts`. The remaining 21, including all seven
  under `tools/`, carried no C-class comment.

## Every string change

The one permitted non-comment edit class. Line numbers are **as they now
stand**, after the comment deletions above.

### The four sites the task named

| file:line | before | after |
|---|---|---|
| `os/verify/src/smoke-negative.test.ts:21` | `test('RFCT-113 asks for three, and there are three, named', ...)` | `test('the case list declares three negative cases, and names them', ...)` |
| `test/apid-api/src/phases/07b-postreboot.ts:71` | `"the login backoff survived the restart (access.md section 6, RFCT-085)"` | `"the login backoff survived the restart (access.md section 6)"` |
| `mosd/hack/build-target.sh:32` | `error: docker is required and not on PATH. Since RFCT-108 M2c this build runs inside localhost/mos-build-rust ... instead of whatever the machine happened to have` | `error: docker is required and not on PATH. This build runs inside localhost/mos-build-rust rather than on the host's cargo, which is what makes the compiler a value recorded in os/build-env/images.env instead of whatever the machine happens to have` |
| `os/tests/factory-root-gate/inner.sh:130` | `FIDELITY: ${differing} of 4 comparisons differ. The image RFCT-113's smoke run` | `FIDELITY: ${differing} of 4 comparisons differ. The image the smoke run` |

**The 07b grep the task asked for was run first**:
`grep -rn "the login backoff survived" test/` returns exactly one line, and
every other reference in the phase goes through the `ASSERTIONS` constant
(`ASSERTIONS[2]`, 6 call sites). One edit is coherent; there is no second
literal to keep in step.

### Others of the same shape, found in the sweep

| file:line | before | after |
|---|---|---|
| `test/apid-api/src/phases/07b-postreboot.ts:293` | `` `          RFCT-085 and is a finding rather than a flake.` `` (runtime failure note) | `` `          and is a finding rather than a flake.` `` (the preceding line absorbs `section 6`) |
| `os/verify/src/smoke-register.test.ts:67` | `describe('the register names what RFCT-113 names', ...)` | `describe('the register names exactly the artifacts in scope', ...)` |
| `os/build/src/bundle.test.ts:586` | `describe('the payload digest, which is RFCT-112\'s gate for the bundle', ...)` | `describe('the payload digest, the bundle\'s identity', ...)` |
| `os/build/src/stages.test.ts:527` | `describe('selectStages -- RFCT-111 stage selection, which replaced the WITH_* args', ...)` | `describe('selectStages -- stage selection, in place of WITH_* build args', ...)` |
| `os/build/src/stages.test.ts:893` | `test('the feature stages are the four RFCT-111 names, and they run before the board', ...)` | `test('the feature stages are the four declinable names, and they run before the board', ...)` |

### The L1 scope extension: runtime strings M1 left behind

`os/verify/run.sh` and `os/build/run.sh` (usage heredoc), the non-test
`os/verify/src/checks-*.ts` verdict strings, and the four OCI label values.

| file:line | before | after |
|---|---|---|
| `os/verify/run.sh:66` | `With --smoke FIRST, it runs RFCT-113's smoke runner: it loads` | `With --smoke FIRST, it runs the smoke runner: it loads` |
| `os/verify/run.sh:74` | `With --smoke-negative FIRST, it runs RFCT-113's three negative tests: it builds` | `With --smoke-negative FIRST, it runs the three negative tests: it builds` |
| `os/build/run.sh:79` | `it assembles the cx3576 image instead -- the TypeScript port of os/mkimage-v2.sh (PLAN-014 M6b). Its remaining arguments are` | `it assembles the cx3576 image instead. Its remaining arguments are` |
| `os/build/run.sh:83` | `it assembles the x64 image -- the TypeScript port of os/mkimage-x64.sh (PLAN-014 M6c). Same shape, same first-position rule` | `it assembles the x64 image. Same shape, same first-position rule` |
| `os/build/run.sh:90` | `it builds and SIGNS the RAUC update bundle -- the TypeScript port of os/update/bundle.sh (PLAN-014 M6d) ... which is the one thing RFCT-106 made a board fact. Both branches are gated -- M6e built an x64 bundle against the shell before deleting it.` | `it builds and SIGNS the RAUC update bundle. Same shape, same first-position rule; try --bundle --help. Unlike the two assemblers this one takes a board, because its two branches differ only in what a boot slot holds, and that is a board fact.` |
| `os/verify/src/checks-shadow.ts:226` | `` + `design RFCT-105 removed` `` | `` + `design mos does not have` `` |
| `os/verify/src/checks-ext4.ts:356` | `` + `mosd, apid and the health gate intermittently (RFCT-106)` `` | `` + `mosd, apid and the health gate intermittently` `` |
| `os/verify/src/checks-ext4.ts:403` | `` ... intermittently ` + `(RFCT-106)` `` (two literals) | `` ... intermittently` `` (one literal) |
| `os/verify/src/checks-engine.ts:190` | `` + `PLAN-012 ships the engine installed and inert; ...` `` | `` + `the engine ships installed and inert; ...` `` |
| `os/verify/src/checks-engine.ts:375` | `` + `PLAN-012's default-off switch` `` | `` + `the default-off switch` `` |
| `os/verify/src/checks-engine.ts:488` | `... and PLAN-012's switch gates nothing. mosd's` | `... and the container.enabled switch gates nothing. mosd's` |
| `os/verify/src/checks-home.ts:765` | `... at the next reboot and PLAN-011 D5's whole extension model does not work on the device` | `... at the next reboot and the whole extension model does not work on the device` |
| `os/verify/src/checks-home.ts:823` | `PLAN-011 D5 named this target originally and it was rejected on 2026-08-22;` | `The plan named this target originally and it was rejected on 2026-08-22;` |
| `os/verify/src/checks-mqtt.ts:180,183,186` | `so the MQTT bridge PLAN-011 D6 specifies is not in this image at all` (x3) | `so the MQTT bridge is not in this image at all` (x3) |
| `os/verify/src/checks-system.ts:1008` | `reconciler RELOADS on a config-only change (RFCT-047), and this passing` | `reconciler RELOADS on a config-only change, and this passing` |
| `os/verify/src/checks-system.ts:1014` | `restarts (RFCT-047) — but that reload is now the ONLY thing` | `restarts — but that reload is now the ONLY thing` |
| `os/verify/src/checks-system.ts:1024` | `issues (RFCT-047) can actually reach the running sshd` | `issues can actually reach the running sshd` |
| `os/verify/src/checks-system.ts:1026` | `configuration-only change (RFCT-047); without ExecReload` | `configuration-only change; without ExecReload` |
| `os/build-env/base/Dockerfile:166` | `image.description="mos common build floor (PLAN-014 M2, RFCT-108)"` | `image.description="mos common build floor"` |
| `os/build-env/c/Dockerfile:176` | `image.description="mos C/C++ toolchain (PLAN-014 M2, RFCT-108)"` | `image.description="mos C/C++ toolchain"` |
| `os/build-env/go/Dockerfile:228` | `image.description="mos Go toolchain, sha256-pinned tarball (PLAN-014 M2, RFCT-108)"` | `image.description="mos Go toolchain, sha256-pinned tarball"` |
| `os/build-env/rust/Dockerfile:295` | `image.description="mos Rust toolchain, sha256-pinned tarballs, cross-capable (PLAN-014 M2, RFCT-108)"` | `image.description="mos Rust toolchain, sha256-pinned tarballs, cross-capable"` |

**L1's condition 2, run against this merged tree before the labels were
touched**:

    $ grep -rn 'image\.description\|opencontainers' os/verify os/build
    (no output, rc=1)
    $ grep -rln 'image.description' os/verify/src/*.test.ts os/build/src/*.test.ts
    (no output, rc=1)

Nothing asserts on those label values, so the four are a one-sided change.

### The second handover: task-ID strings in `mosd/`

M2 (RFCT-115) was comment-only by design and left this class for M3. All four
sites were **re-located by content**, not by M2's line numbers, as instructed;
three had moved by 1-3 lines.

| file:line | before | after |
|---|---|---|
| `mosd/busname/src/lib.rs:262` | `(measured, RFCT-093 Investigation), so classifying it as system lets a third \` / `party present itself as the system` | `(measured against dbus-daemon 1.12.20), so classifying it as system lets a \` / `third party present itself as the system` |
| `mosd/mosd/tests/scan.rs:670-672` | `...can own this name (measured, \` / `RFCT-093), so publishing it as system-origin would let any third party present itself \` / `to operators and to the bridge as the system; got {entry:#}` | `...can own this name (measured \` / `against dbus-daemon 1.12.20), so publishing it as system-origin would let any third \` / `party present itself to operators and to the bridge as the system; got {entry:#}` |
| `mosd/mqttd/tests/protocol.rs:729` | `...which is the wrong-class defect \` / `PLAN-011 D5 names, reached by the other route` | `...which is the wrong-class defect \` / `this rule exists to prevent, reached by the other route` |
| `mosd/mosd/src/reconciler/sshd.rs:947` | `.expect("the shadow file is no longer an input to this reconciler")` | `.expect("the shadow file is not an input to this reconciler")` |

M2's list gave `sshd.rs:968`; by content the past-tense `expect()` is at
**:947**. `:968` on both M2's branch and this one is
`let (reconciler, paths) = fixture(...)` in a different test, so the number was
stale exactly as L2 warned. `:947` is the only past-tense `expect()` in the
file - the other three (`:1210`, `:1392`, `:1724`) are already present-tense.

The first two messages keep the measurement they carried and lose only the
task ID; `dbus-daemon 1.12.20` is the version `mosd/hack/dbus-policy-test.sh`
section 4 measures against, so a reader of the panic still knows what was
measured and where. Each of the four literals was grepped across `mosd/`,
`test/`, `os/` and `docs/` first and appears **exactly once** - nothing
compares them.

**Rust continuation semantics were checked rather than assumed.** A `\` at
end of line strips the newline *and* the next line's leading whitespace, so the
re-wrap had to preserve the word spacing. The joined values were computed and
read back before committing; all three concatenate with single spaces and no
doubled or missing space. The `{entry:#}` capture in `scan.rs` is preserved,
and no `{` or `}` was added anywhere.

### `mosd/mosd/src/reconciler/sshd.rs:1004`/`:1006` - RETAINED as data

**Option 1, and the tie-breaker is not close.** The task IDs at `:1004` and
`:1006` are inside the comment field of committed SSH public-key constants -
data, not prose - and L1's rule is that if changing that comment field would
touch **any** assertion on the key line, both the doc lines and the constant
stay. The greps were run first:

    $ grep -rn "AAAAC3NzaC1lZDI1NTE5AAAAIL99V7xPTOP3jZjnbVPM7xC" .
    mosd/mosd/src/reconciler/sshd.rs:1005    <- the constant
    mosd/apid/src/tests.rs:625               <- the SAME key, second crate
    mosd/apid/tests/e2e.rs:448,449           <- and again, plus its bare blob

    $ grep -rn "rfct-034" mosd/ test/
    mosd/apid/tests/e2e.rs:481   assert!(stored.contains("rfct-034-test-ed25519"), ...)
    mosd/apid/src/tests.rs:878   assert!(body.contains("rfct-034-test-ed25519"), "comment missing")

**Two live assertions assert on the comment field itself**, and both are in
`mosd/apid/**` - a hard carve-out owned by a sibling workstream (PLAN-016)
that this subtask may not edit. `mosd/apid/src/tests.rs:621-624` states the
coupling in its own words: *"the same three keys `mosd/mosd/src/reconciler/
sshd.rs` tests against, so both sides of the D-Bus boundary are exercised with
identical input."* Changing the constant here would either break that stated
identity across the D-Bus boundary or turn two apid tests red, and repairing
either would mean editing a carved-out crate. Retained, both lines and the
constant, exactly as L1's default directs.

(A key line's SHA256 fingerprint is computed over the base64 blob only, so the
`REAL_*_FINGERPRINT` constants would in fact have survived a comment-field
edit. That is not what decides it - the two `contains` assertions are.)

**`sshd.rs:1157` and `:1173` are retained on the same rule.**
`"fresh@rfct-034"` is passed to a live `ssh-keygen -C` at `:1157` and asserted
back as the parsed comment field at `:1173` (`assert_eq!(parsed.comment
.as_deref(), Some("fresh@rfct-034"))`). It is a self-contained pair in one
file, so it *could* move together - but it is an SSH key comment field with an
assertion on it, which is the case L1's tie-breaker names. Retained, and
recorded here rather than left implicit. It is a two-line change if L2 wants
it.

### Test assertions that had to move with a verdict string

Three verdict strings above are asserted by name. Both halves are in the same
commit (`95cbfb1`), and the gate was re-run after it.

| test file:line | before | after |
|---|---|---|
| `os/verify/src/checks-engine.test.ts:504` | `.toContain("PLAN-012's switch gates nothing")` | `.toContain('the container.enabled switch gates nothing')` |
| `os/verify/src/checks-ext4.test.ts:418` | `test('RED when EPHEMERAL is EMPTY -- the RFCT-106 race, from the other side', ...)` | `test('RED when EPHEMERAL is EMPTY -- the first-boot /var race, from the other side', ...)` |
| `os/verify/src/checks-ext4.test.ts:424` | `expect(r.message).toContain('RFCT-106')` | `expect(r.message).toContain('the health gate intermittently')` |
| `os/verify/src/checks-home.test.ts:717` | `test('the bind absent fails, naming PLAN-011 D5\'s extension model', ...)` | `test('the bind absent fails, naming the extension model it breaks', ...)` |
| `os/verify/src/checks-home.test.ts:721` | `.toContain("PLAN-011 D5's whole extension model does not work on the device")` | `.toContain('the whole extension model does not work on the device')` |

`checks-home.test.ts:765`'s `.toContain('it was rejected on 2026-08-22')`
needed **no** change: `checks-home.ts:823` was edited to drop `PLAN-011 D5`
only, leaving that clause byte-identical.

## MUST-KEEP items reworded, quoted before and after

Everything else on PLAN-015's MUST-KEEP list in this area is byte-unchanged.
Three items were reworded; all three keep their rule.

### 1. The mkimage wall-clock fallback (`os/tests/handshake-test/harness.sh:94-102`)

MUST-KEEP class 3. The block above it (C3 self-referential meta-commentary) was
deleted; this one kept its whole substance and lost only the M7c attribution.

**Before**

    # ONE RESIDUAL, RECORDED RATHER THAN FIXED. `makeBootScript` sets AND VALIDATES
    # SOURCE_DATE_EPOCH -- mkimage silently falls back to the wall clock without it,
    # so an unvalidated value is a boot script that rebuilds differently every time
    # -- and this harness sets it nowhere. The two therefore produce DIFFERENT
    # BYTES, and "same invocation" must not be read here as "same output". It does
    # not weaken what this harness tests: the U-Boot sandbox executes the script's
    # CONTENT, and the header timestamp it differs in is not part of that. Fixing it
    # would mean threading the board's FILE_MTIME in, which is a change to what this
    # harness builds rather than to a citation, and is not M7c's.

**After**

    # One residual, recorded rather than fixed. `makeBootScript` sets AND VALIDATES
    # SOURCE_DATE_EPOCH -- mkimage silently falls back to the wall clock without it,
    # so an unvalidated value is a boot script that rebuilds differently every time
    # -- and this harness sets it nowhere. The two therefore produce DIFFERENT
    # BYTES, and "same invocation" must not be read here as "same output". It does
    # not weaken what this harness tests: the U-Boot sandbox executes the script's
    # CONTENT, and the header timestamp it differs in is not part of that. Fixing it
    # would mean threading the board's FILE_MTIME in, a change to what this harness
    # builds rather than to a citation.

### 2. `mosd/hack/dbus-policy-test.sh:14-17` (class 8, both-directions rule)

Only the ALL-CAPS run changed; the sentence is otherwise identical.

**Before**: `# Every guard is exercised in BOTH directions. A refusal-only suite would pass`
**After**:  `# Every guard is exercised in both directions. A refusal-only suite would pass`

### 3. `mosd/hack/dbus-policy-test.sh:623-660` (class 8)

Two blocks in that range moved. The measured own_prefix quirk keeps its
measurement and its dbus-daemon version; the plan-ID attribution goes.

**Before**

    # MEASURED on dbus-daemon 1.12.20, not inferred. PLAN-011 states no expectation
    # for the bare prefix, and the answer is not the conservative one: own_prefix
    # matches the prefix ITSELF, so an unprivileged uid may own com.mos.ext with no
    # suffix at all. It is inside the namespace extensions were given, so it grants
    # nothing the decision did not intend to give away, but it is a name the D5
    # grammar com.mos.ext.<class>[.<suffix>] never contemplated -- anything that
    # derives a class from the fourth dotted component has no fourth component here.

**After**

    # Measured on dbus-daemon 1.12.20, not inferred, and the answer is not the
    # conservative one: own_prefix matches the prefix itself, so an unprivileged uid
    # may own com.mos.ext with no suffix at all. That is inside the namespace
    # extensions are given, so it gives away nothing extra, but it is a name the
    # com.mos.ext.<class>[.<suffix>] grammar does not contemplate -- anything that
    # derives a class from the fourth dotted component has no fourth component here.

The "A SEPARATE BUS, and the reason is attribution" paragraph in the same range
kept every clause and lost only its ALL-CAPS runs (`A SEPARATE BUS,` ->
`A separate bus,`; `NOTHING else of ours` -> `nothing else of ours`; `would have
been over-determined` -> `would be over-determined`; `BOTH DIRECTIONS` ->
`Both directions`). The C1/C3 paragraph above it - "Numbered 5, not 4:
RFCT-093's own_prefix MEASUREMENT owns section 4 ..." - was deleted outright.

### Verified present and byte-unchanged

- **Test-harness safety invariants.** `mosd/hack/dbus-policy-test.sh`'s
  `setpriv`/uid-65534 machinery and its "Needs root (to drop to uid 65534 with
  setpriv)" header line; `os/tests/shadow-reconcile-test.sh`'s
  `MOS_SHADOW_PASSWD` / `MOS_SHADOW_FACTORY` redirection header and its
  "nothing on the host is read or written" clause;
  `os/tests/health-test.sh`'s fake-PATH header. `mosd/mosd/tests/*.rs` is M2's
  and was not touched.
- **Class-8 test-intent comments**: `test/apid-api/src/phases/04-readonly.ts:19-37`
  (the three load-bearing properties, verbatim - only the `====` banner and the
  campaign clause below them were removed), `src/console.ts:19-34` (both rules
  kept; see the one-clause change noted under "Judgement calls"),
  `06-backoff.ts:1-17` (verbatim; only line 18's `, RFCT-085` removed),
  `os/tests/repart-loader-test.sh:4-22` (**byte-unchanged**).

## Judgement calls, stated rather than absorbed

1. **`docs/task/*.md` citations in verdict strings are KEPT**, three of them:
   `checks-home.ts:580` and `:590` (`docs/task/RFCT-039.md`) and
   `checks-shape.ts:172` (`docs/task/RFCT-017.md`). These are the
   `(access.md section 6)` shape the plan's triage rule protects - a resolvable
   pointer to where a deferral is recorded, which an operator reading the
   verdict needs - rather than a stamp naming who typed the line. Dropping the
   identifier here would delete the pointer, not just an identifier. If L2
   reads the extension as covering them, they are two one-line edits.
2. **`test/apid-api/src/phases/06-backoff.ts:18` is inside a MUST-KEEP block**
   and was edited: `(docs/design/access.md section 6, RFCT-085)` ->
   `(docs/design/access.md section 6)`. The contract citation stays, the task
   ID goes - the plan's own rule for the sibling string at `07b:71`.
3. **`test/apid-api/src/console.ts:31`** is inside MUST-KEEP `:19-34`. The
   rule is unchanged; one clause lost a campaign tally:
   "is the defect class this campaign has already hit three times" ->
   "is a check that asserts nothing".
4. **`os/verify/src/checks-context.test.ts`'s header** described a cache defect
   in the past ("one of them used to be keyed on the slot's NAME ... M4b found
   it and left it"). Rewritten to the present-tense requirement ("both must be
   keyed on the image as well as on the slot"). The behaviour under test is
   unchanged; only the description is.
5. **`os/verify/src/checks.test.ts`'s header was stale, not merely narrative.**
   It claimed "The register is EMPTY here -- M4a ports no checks -- so the
   well-formedness assertion over the shipped CHECKS is vacuous today".
   `CHECKS` now spreads 17 families, so the sentence was false. Replaced with
   what the file does. The assertion itself was **not** touched - see below.
6. **The two `mosd/` panic messages keep their measurement.** `RFCT-093` in
   `busname/src/lib.rs:262` and `mosd/tests/scan.rs:671` was doing real work in
   a failure message - it told the reader the classification was measured
   rather than reasoned. Deleting the identifier alone would have left
   "(measured,)" saying nothing, so both now name **what** was measured
   against: `dbus-daemon 1.12.20`, the version `mosd/hack/dbus-policy-test.sh`
   section 4 drives. The doc comments above each (which M2 already treated,
   and which this subtask did not touch) still carry the full
   `docs/task/RFCT-093.md` citation.
7. **Four `docs/task/*.md` and `docs/plan/*.md` citations survive in `mosd/`
   doc comments** (`busname/src/lib.rs:38,110,224,252`,
   `mosd-settings/src/model.rs:366`, `mosd/src/identity.rs:102`). They are
   comments in files M2 already treated, so out of this handover by its own
   terms - and they are the same resolvable-path shape kept in `os/`.
   `identity.rs:102` is additionally on PLAN-015's MUST-KEEP list (class 6,
   the independent-draw rule).

## Left untreated, and why

- **`os/verify/src/checks.test.ts:26`**: `expect(CHECKS.length).toBeGreaterThanOrEqual(0)`
  is vacuous - it is true of any array, including an empty one - and it was
  written when the register genuinely was empty. Repairing it is a logic edit
  and outside this milestone's one permitted non-comment class. Flagged here.
- **Four test names in `os/build/src/grub-x64.test.ts` still name the deleted
  `os/mkimage-x64.sh`**: `:114` "is byte-for-byte what os/mkimage-x64.sh
  prints", `:139` "because the shell's printf does", `:267` "a false positive
  the shell recorded", `:370` "every module the shipped list names is one
  os/mkimage-x64.sh names". Every *comment* in that file was rewritten. These
  are strings, and a deleted-path reference is not the task-ID class the plan
  and L1 permit, so they were left. Suggested replacements, for whoever takes
  them: "is byte-for-byte the fragment the assembler emits", "and it ends with
  a newline", "a hash in a COMMENT does not fire", "every module the shipped
  list names is one the assembler names".
- **`test/apid-api/run.sh:254`'s refusal message points at a deleted script**:
  `Build it: MOS_BOARD=x64 bash os/rootfs/build-v2.sh && bash os/mkimage-x64.sh`.
  `os/mkimage-x64.sh` does not exist; the command is now
  `bash os/build/run.sh --mkimage-x64`. **Pre-existing at `main`** (driven, see
  gate 5 below) and not a task ID, so not repaired here. It misdirects anyone
  who runs the harness without an image, and is worth a follow-up.
- **Assertions and test names that quote a live message containing a task ID**,
  where the producing string is out of scope, were left aligned with it. After
  the extension above, none remain: every such pair was moved together.
- **`mosd/hack/check.sh`** was not edited at all. Its only comment (`cargo
  nextest` does not execute doctests) is already a present-tense statement of
  why the line below it is not a duplicate.

## Gate results

Run from the worktree root at `041e82b`, the last commit before this record.
Both bun suites were re-run after the final code commit.

| gate | command | result |
|---|---|---|
| verify suite | `MOS_VERIFY_CONTAINER=1 bash os/verify/run.sh` | `RESULT: PASS (1066/1066 tests)`, 31 files, **rc=0** |
| build suite | `MOS_BUILD_CONTAINER=1 bash os/build/run.sh` | `RESULT: PASS (689/689 tests)`, 25 files, **rc=0** |
| shell lint | `bash os/tests/shell-pipefail-lint.sh` | `RESULT: PASS (29/29 files clean, 29 scanned)`, rc=0 |
| docs index | `bash docs/verify-index.sh` | `384/384 PASS`, rc=0 |
| apid harness | `bash test/apid-api/run.sh --dry-run` | refuses at its image precondition, rc=1 - **identical at `main`**, see below |
| `bash -n` | every `.sh` touched (14 files) | all rc=0 |
| Rust | `mosd/hack/check.sh`'s five lines, driven in a container | **all rc=0**: rustfmt clean over 66 files, clippy `-D warnings` clean, `cargo test --workspace` **593 passed / 0 failed** across 22 binaries, doc-tests ok, `cargo deny` ok. See below. |
| shellcheck | container, same 14 files, vs `main` | 9 findings, **identical set**, rc=123 both sides |

**The container route is what CI takes and is what these numbers are.** The
host bun is 1.3.13 and `bun.lock` is lockfileVersion 2, so a bare
`bash os/verify/run.sh` fails with "Unknown lockfile version" at `main` too;
`bun.lock` is out of scope and was not touched.

**Baseline, established on the merged branch before any edit**: verify
`RESULT: PASS (1066/1066 tests)` rc=0, build `RESULT: PASS (689/689 tests)`
rc=0. Both unchanged at close - no test count moved, which is what a
comment-only milestone should produce.

### The two tests that also run on this host, driven rather than assumed

Neither is on the required list; both were run because they need no image:

    $ bash os/tests/health-test.sh
    RESULT: PASS (57/57 checks)                     # the RFCT-113 floor, unmoved
    $ bash os/tests/shadow-reconcile-test.sh
    RESULT: PASS (23/23 checks)

### shellcheck, compared line by line against `main`

`shellcheck` is not installed on this host; it was run in
`koalaman/shellcheck:stable` against a bind mount, once over this tree and once
over a `git worktree add --detach ... main` on the same filesystem, with the
same file list. Identical, file for file and code for code:

| file | finding |
|---|---|
| `os/build/run.sh` | SC2016 (info) |
| `os/tests/handshake-test/harness.sh` | SC1091 (info), SC2016 (info) |
| `os/tests/quadlet-doc-test.sh` | SC2086 (info) |
| `os/tests/repart-loader-test.sh` | SC1091 (info), SC2066 (**error**) |
| `os/tests/shadow-reconcile-test.sh` | SC2016 (info) x2, SC2034 (warning) |

9 findings on both sides, rc=123 on both (xargs relaying shellcheck's rc=1).
None introduced, none removed. The SC2066 error is pre-existing and out of
scope.

### `test/apid-api/run.sh --dry-run`, and what it actually does here

First run: **exit 1 with no output at all**. Driven to the cause with `bash -x`:

    + RUN_DIR=.../\_out/x64/.qemu
    ++ readlink -f .../\_out/x64/.qemu
    + RUN_DIR_REAL=

`_out/x64/` does not exist on this host, `readlink -f` fails on a path whose
parent is absent, and `set -e` kills the script before its first message.
**This reproduces byte-for-byte at `main`** (detached worktree, same command,
same silent rc=1 and same empty output), so it is not a regression and not
mine. It is a real defect - a harness that exits silently is the failure mode
this suite's own comments object to - and it is out of scope here.

With `_out/x64/.qemu` created, the harness runs and reaches its own
precondition, exercising the reporting path this milestone edited:

    note: repository /srv/bkd/worktrees/u51kzjlk/hsvg4rzn
    FAIL: image x64-mos-v2-latest.img is missing; this harness builds nothing. Build it: ...
    RESULT: FAIL (0/1 checks)                                            exit 1

The same command against a detached `main` worktree with the same directory
created prints the identical three lines. The scratch directory was removed
afterwards.

### The Rust gate WAS driven, contrary to this record's first draft

**Correction.** An earlier version of this file said the Rust gate could not be
run here and asked L2 to run `mosd/hack/check.sh` before merging. That was
wrong, and it was wrong in the direction that matters -- it asked someone else
to verify something verifiable. All five of `check.sh`'s lines have now been
driven green on this host.

**Why the first attempt failed, and what the route is.** There is no cargo on
the host, and `/srv/mos-rust-tools/bin/rustfmt` dies with
`error while loading shared libraries: librustc_driver-28a98848f7a7c026.so`.
That library is not on the host filesystem -- but it **is** inside
`localhost/mos-build-rust` at `/opt/rust/lib`, which is that binary's partner
toolchain. Mounting the host binary into the pinned image pairs them:

    docker run --rm -v "$PWD:/src:ro" \
      -v /srv/mos-rust-tools/bin/rustfmt:/usr/local/bin/rustfmt:ro \
      -w /src --entrypoint /bin/bash localhost/mos-build-rust -c '
        export LD_LIBRARY_PATH=/opt/rust/lib
        rustfmt --edition 2024 --check <files>'

    rustfmt 1.9.0-stable (88d9e12ae1 2026-08-18), against rustc 1.98.0

The same mount trick works for `cargo-clippy`, `clippy-driver` and `cargo-deny`.
`cargo fmt` and `cargo nextest` are the two subcommands the image genuinely does
not have (`error: no such command: fmt`), so `rustfmt --check` was driven over
an explicit file list and `cargo test` stood in for `cargo nextest run` -- the
same tests, a different runner.

| `check.sh` line | how it was driven | result |
|---|---|---|
| `cargo fmt --all --check` | `rustfmt --edition 2024 --check` over all 66 `.rs` files under `mosd/` | **rc=0, no output** |
| `cargo clippy --workspace --all-targets --locked -- -D warnings` | host `cargo-clippy` + `clippy-driver`, image `/opt/rust/lib` | **rc=0** |
| `cargo nextest run --workspace --locked` | `cargo test --workspace --locked` | **593 passed, 0 failed**, 22 binaries, rc=0 |
| `cargo test --doc --workspace --locked` | as written | **rc=0** |
| `cargo deny check licenses bans advisories` | host `cargo-deny` | **advisories ok, bans ok, licenses ok**, rc=0 |

**`--edition 2024` is required** and getting it wrong is a trap: the workspace
is `edition = "2024"` (`mosd/Cargo.toml:6`), and rustfmt at its default 2021
reports spurious import-ordering diffs in `busname/src/lib.rs` and
`mqttd/tests/protocol.rs` plus two `let chains are only allowed in Rust 2024`
errors in `sshd.rs`. Those are artifacts of the wrong edition, not findings.

**The tests this milestone's four string edits live in were each driven
individually, and pass:**

- `mos_busname` lib unit tests -- **8 passed**, including
  `the_bare_extension_namespace_is_never_system_origin`, whose assertion message
  this milestone rewrote.
- `mqttd` `tests/protocol.rs` -- **14 passed**, including
  `a_bus_name_with_no_class_yields_no_address_and_no_invented_class`.
- `mosd` unit tests -- **280 passed**, including
  `a_shadow_file_that_is_missing_or_broken_does_not_stop_the_reconcile`, whose
  `expect()` string this milestone rewrote.
- `mosd` `tests/scan.rs` -- **7 passed**, including
  `the_bare_extension_namespace_has_no_class_and_is_not_system`.

**One environmental obstacle, named rather than absorbed.** The first full run
came back `CARGO_TEST_RC=101` on `mosd/tests/bus.rs`, and `tests/scan.rs` never
ran at all because cargo stops at the first failing target. The cause was not
this milestone: `localhost/mos-build-rust` ships no `dbus-daemon`, and both
files **refuse rather than skip** --

    dbus-daemon was not found at /usr/bin/dbus-daemon or on PATH. This test
    asserts real bus behaviour over a private session bus and MUST NOT skip

which is precisely the MUST-KEEP safety invariant PLAN-015 protects, doing its
job. `bus.rs` is M2's file and this subtask never touched it. Adding
`dbus-daemon` to a throwaway layer on top of the pinned image turns both green:
`bus.rs` 1 passed, `scan.rs` 7 passed, and the full workspace **rc=0**. The
throwaway image is not committed and nothing in the tree references it.

Before it was measured, the result was also argued from construction, and the
argument still holds: there is **no `rustfmt.toml`** in the tree, so rustfmt
runs at `max_width = 100` and `format_strings = false`; with `format_strings`
off it does not reflow string literal contents or their manual
`\`-continuation wrapping. The seven added `.rs` lines measure 54, 65, 74, 89,
90, 91 and 94 columns, all inside string literals, and the whole four-file diff
is seven `-`/`+` pairs of string-continuation lines and nothing else. The joined
literal values were computed and read back, because a `\` at end of line strips
the newline *and* the following leading whitespace: all three multi-line
messages concatenate with correct single spacing.

### Not run here, and why

- `os/tests/health-test.sh` was expected to need an image; it does not, and it
  was run (above). `os/tests/shadow-reconcile-test.sh` likewise.
- `mosd/hack/dbus-policy-test.sh` needs root, dbus-daemon and python3 with
  three live buses; **not run**. Its gate here is `bash -n` (rc=0) plus
  shellcheck (no finding, matching `main`).
- `os/tests/handshake-test/{run,harness}.sh` need a built U-Boot sandbox and
  docker with a network build; **not run**. Same gate: `bash -n` plus
  shellcheck.
- `os/tests/factory-root-gate/{gate,inner}.sh` need a matched
  `factory-root.oci` + `rootfs-verity.img` pair, which does not exist here;
  **not run**. Same gate.
- `os/tests/repart-loader-test.sh` needs `docker --privileged` and a built
  image; **not run**. Same gate.
- `os/tests/quadlet-doc-test.sh` needs the arm64 Quadlet generator under
  emulation; **not run**. Same gate.
- `mosd/hack/check.sh` prepends `$HOME/.cargo/bin` and runs cargo on a host
  that has none, so it was **not run as written** -- and it is the one file in
  scope this milestone did not modify at all. Every line it runs was driven
  through the container route instead, all rc=0; see "The Rust gate WAS driven"
  above for the commands and the numbers.
- `mosd/hack/build-target.sh` needs a full cross build; **not run**. `bash -n`
  and shellcheck are its gate, and its only executable change is the one
  tabulated error string.

<!-- dated-record: a measurement record frozen at its commit; its citations name the tree as it was then (pre-PLAN-019 layout, pre-rewrite design documents); exempt from docs/verify-citations.sh (RFCT-172) -->
