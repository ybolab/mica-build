# RFCT-150 PLAN-015 M6: form compression in os/verify

- **status**: completed
- **priority**: P1
- **owner**: ai-agent
- **createdAt**: 2026-08-26 18:05
- **claimedAt**: 2026-08-26 18:05
- **completedAt**: 2026-08-26 20:35
- **plan**: PLAN-015 (M6)

A comment-**form** pass over the 44 files of `os/verify`. Constraint content is
preserved; typography, decorative banners and essay length change. No behaviour
change, no executable-line change, no string-literal change.

The four M6 rules as applied here:

1. Multi-word ALL-CAPS emphasis became sentence case. Single-word emphasis
   (`NOT`, `NEVER`, `MUST`, `ONLY`) may stay and often does, and identifiers
   that are genuinely upper-case -- `BOARD_HAS_STATUS_LED`, `LAYOUT_PARTITIONS`,
   `META`/`STATE`/`EPHEMERAL`/`DATA`, `GPT`, `ESP`, `RAUC`, `PARTUUID` -- are
   untouched, as is quoted tool output (`RESULT: PASS (0/0 checks)`) and the
   `-I` in `grep -rlI`.
2. Every decorative banner separator is gone. Where the break was real it became
   one short plain-text header line (`// 2. The FAT boot slots, with mtools at
   an offset.`). Three alignment tables whose column padding tripped the
   20-repeated-character rule were re-flowed rather than deleted.
3. Long blocks were rewritten to present-tense statements. Counterfactual
   rationale ("a check that did X would pass an image that...") and repetition
   across a header and the code it describes were cut; measured numbers, tool
   quirks, oracle line numbers and contract quotes were not.
4. The MUST-KEEP list held. See "MUST-KEEP items reworded" below.

## Scope

Only these 44 source files, plus this task file. `docs/task/index.md` was **not**
touched. Counts are `caps runs / banner lines / 15+-line comment blocks /
longest block`, measured with the milestone's own metric script.

| file | before caps/ban/blk15+/longest | after caps/ban/blk15+/longest |
|---|---|---|
| `os/verify/src/smoke.ts` | 28/3/9/43 | 0/0/1/23 |
| `os/verify/src/image.ts` | 15/35/5/54 | 0/0/0/14 |
| `os/verify/src/checks-fixture.ts` | 5/18/6/21 | 0/0/6/19 |
| `os/verify/src/checks-board.ts` | 7/18/3/59 | 0/0/3/33 |
| `os/verify/src/checks-system.ts` | 6/21/1/45 | 0/0/1/32 |
| `os/verify/src/tools.ts` | 9/0/3/36 | 0/0/3/27 |
| `os/verify/src/smoke-register.ts` | 17/2/5/55 | 0/0/3/18 |
| `os/verify/src/smoke.test.ts` | 17/9/1/16 | 0/0/1/16 |
| `os/verify/src/checks-root.ts` | 6/8/1/42 | 0/0/1/22 |
| `os/verify/src/checks-bootchain.ts` | 8/13/2/51 | 0/0/2/30 |
| `os/verify/src/lint.ts` | 8/2/2/60 | 0/0/2/30 |
| `os/verify/run.sh` | 11/6/3/23 | 0/0/3/21 |
| `os/verify/src/checks-home.ts` | 6/12/2/36 | 0/0/2/26 |
| `os/verify/src/checks-dbus.ts` | 5/12/1/35 | 0/0/1/25 |
| `os/verify/src/checks-ext4.ts` | 8/0/2/54 | 0/0/2/27 |
| `os/verify/src/checks-engine.ts` | 4/10/1/38 | 0/0/1/22 |
| `os/verify/src/checks-connd.ts` | 4/8/1/49 | 0/0/1/30 |
| `os/verify/src/smoke-negative.ts` | 11/0/2/46 | 0/0/2/22 |
| `os/verify/src/checks.ts` | 6/2/3/34 | 0/0/3/23 |
| `os/verify/src/parity.ts` | 3/5/3/57 | 0/0/3/26 |
| `os/verify/src/checks-board.test.ts` | 1/12/1/24 | 0/0/1/18 |
| `os/verify/src/checks-shadow.ts` | 2/0/1/50 | 0/0/1/31 |
| `os/verify/src/image.test.ts` | 7/10/2/27 | 0/0/2/22 |
| `os/verify/src/checks-mqtt.ts` | 4/4/1/33 | 0/0/1/26 |
| `os/verify/src/checks-cmdline.ts` | 8/4/1/31 | 0/0/1/23 |
| `os/verify/src/board-env.ts` | 5/8/1/44 | 0/0/1/36 |
| `os/verify/src/smoke-register.test.ts` | 8/0/1/16 | 0/0/1/16 |
| `os/verify/src/smoke-pins.ts` | 6/0/3/22 | 0/0/3/20 |
| `os/verify/src/checks-bootchain.test.ts` | 3/6/0/12 | 0/0/0/12 |
| `os/verify/src/checks-fstab.ts` | 4/4/1/31 | 0/0/1/25 |
| `os/verify/src/checks-shape.ts` | 5/0/1/36 | 0/0/1/27 |
| `os/verify/src/checks-ext4.test.ts` | 2/1/1/15 | 0/0/1/15 |
| `os/verify/src/lint.test.ts` | 2/1/1/19 | 0/0/1/19 |
| `os/verify/src/checks-gpt.ts` | 3/3/2/24 | 0/0/2/23 |
| `os/verify/src/board.ts` | 3/0/2/29 | 0/0/2/22 |
| `os/verify/src/checks-rauc.ts` | 3/0/1/26 | 0/0/1/20 |
| `os/verify/src/script-commands.ts` | 4/0/1/30 | 0/0/1/24 |
| `os/verify/src/checks-slots.ts` | 2/0/2/26 | 0/0/2/22 |
| `os/verify/src/verify-cli.ts` | 5/0/1/29 | 0/0/1/23 |
| `os/verify/src/probe.ts` | 1/4/1/21 | 0/0/1/16 |
| `os/verify/src/layout.ts` | 5/0/1/23 | 0/0/1/18 |
| `os/verify/Dockerfile` | 4/0/1/37 | 0/0/1/31 |
| `os/verify/src/smoke-pins.test.ts` | 4/0/1/15 | 0/0/1/15 |
| `os/verify/src/smoke-cli.ts` | 2/0/1/17 | 0/0/1/17 |
| **total (44 files)** | **277/241/85/60** | **0/0/70/36** |

Comment lines over the 44 files: **6694 -> 5840 (-854, -12.8%)**. The branch
diff is `44 files changed, 1236 insertions(+), 2091 deletions(-)`.

## The comment-only proof

Three independent checks. All three pass; the first two were validated against a
planted code change first, so an empty result is evidence rather than silence.

### 1. The milestone's stripper (`strip-comments-multi.py`), as specified

`/tmp/scope-files.txt` and the other paths the dispatch prompt names are shared
by the four concurrent subtasks of this workstream on this host, and one of them
was overwritten mid-run. Everything here therefore lives in a private scratch
directory; nothing under it is committed.

```bash
SCRATCH=/tmp/zaorneny-rfct150      # private; the stripper is byte-identical to the
                                   # one in the dispatch prompt (md5 23ba5136a610…)
BASE=$(git merge-base HEAD main)   # b55b9df
while read -r f; do
  diff -u <(git show "$BASE:$f" | python3 $SCRATCH/strip.py "$f") \
          <(python3 $SCRATCH/strip.py "$f" < "$f") >/dev/null \
    || echo "DIFFERS: $f"
done < $SCRATCH/scope-files.txt
```

Output on the final tree:

```
DIFFERS: os/verify/src/image.ts
DIFFERS: os/verify/src/image.test.ts
DIFFERS: os/verify/src/checks-cmdline.ts
```

**Those three are a blind spot in the stripper, not an edit outside comments**,
and the merge base proves it. The stripper has no rule for a JavaScript regular
expression literal, so an apostrophe inside one -- `os/verify/src/image.ts:296`
is `.filter(l => !/doesn't (begin|end) on a|degraded performance/.test(l))` --
opens a single-quoted string that is never closed where the lexer thinks it is.
From there its quote state is inverted for a window of the file, and comments
inside that window are emitted as though they were code.

Counted at the merge base, before a single edit, the stripper already fails to
strip comments in seven of the 44 files:

| file | comment lines the mandated stripper emits as code, at `b55b9df` |
|---|---:|
| `os/verify/src/checks-cmdline.ts` | 42 |
| `os/verify/src/image.ts` | 14 |
| `os/verify/src/checks-mqtt.ts` | 10 |
| `os/verify/run.sh` | 5 |
| `os/verify/src/checks-root.ts` | 4 |
| `os/verify/src/image.test.ts` | 3 |
| `os/verify/src/script-commands.ts` | 1 |

The three that report `DIFFERS` are exactly the three where this pass edited a
comment inside such a window. For example `image.ts`, at the merge base, hands
back these as "code":

```
182:// ---------------------------------------------------------------------------
183:// 2. the FAT boot slots, with mtools AT AN OFFSET
184:// ---------------------------------------------------------------------------
```

Rule 2 deletes that banner, so the stripped forms differ. The complete set of
hunks the stripper reports is 23 changed lines across the three files, and every
one of them is a comment line:

```
--- os/verify/src/image.ts
-// ---------------------------------------------------------------------------
-// 2. the FAT boot slots, with mtools AT AN OFFSET
-// ---------------------------------------------------------------------------
+// 2. The FAT boot slots, with mtools at an offset.
--- os/verify/src/image.test.ts
-// ── mtools ─────────────────────────────────────────────────────────────────
+// mtools
-// ── ext4 ───────────────────────────────────────────────────────────────────
+// ext4
-// ── squashfs ───────────────────────────────────────────────────────────────
+// squashfs
--- os/verify/src/checks-cmdline.ts
- * `$(NF-1)` and `$NF` for the hash and the salt -- POSITIONS FROM THE END, so a
+ * `$(NF-1)` and `$NF` for the hash and the salt -- positions from the end, so a
-// ---------------------------------------------------------------------------
 // the ESP: static, in no slot group, and holding NOTHING per-slot (:1968-2006)
-// ---------------------------------------------------------------------------
-    // THE PER-SLOT RULE, from the other side. A per-slot file on
-    // the ESP is one that NO INSTALL CAN REPLACE: the ESP is in no slot group,
+    // The per-slot rule, from the other side. A per-slot file on
+    // the ESP is one that no install can replace: the ESP is in no slot group,
```

The blind spot is conservative, never permissive: a mis-parsed window is emitted
verbatim, so a **code** change inside one still shows up. That was driven --
planting ` output` (one extra space) on `image.ts`'s
`return { clean, output, complaints }`, inside the window, made the mandated
stripper report `DIFFERS: os/verify/src/image.ts` too.

### 2. The same stripper plus a regular-expression-literal rule

`strip2.py` is `strip-comments-multi.py` with one addition: in the non-Rust
branch, a `/` in operand position begins a regex literal (character classes
honoured, no line breaks) and is consumed whole. Nothing else changed. It leaves
**zero** comment lines in all 44 files at the merge base, and reports empty:

```
$ bash $SCRATCH/proof2.sh
$            # no output over all 44 files
```

Sentinel, planted on a code line (`os/verify/src/probe.ts:19`,
`import { join } from 'node:path'` -> two spaces after `import`):

```
--- mandated stripper:
DIFFERS: os/verify/src/image.ts
DIFFERS: os/verify/src/image.test.ts
DIFFERS: os/verify/src/checks-cmdline.ts
DIFFERS: os/verify/src/probe.ts          <- the planted change
--- strip2:
DIFFERS: os/verify/src/probe.ts          <- the planted change
```

After `git checkout -- os/verify/src/probe.ts`:

```
--- mandated stripper:
DIFFERS: os/verify/src/image.ts
DIFFERS: os/verify/src/image.test.ts
DIFFERS: os/verify/src/checks-cmdline.ts
--- strip2:
(no output)
```

Both harnesses were therefore shown able to fail before their empty result was
taken as evidence.

### 3. Line classification over the whole branch diff

Independent of any lexer: every added or removed line in
`git diff -U0 $BASE -- os/verify` is blank or begins with `//`, `/*`, `*/`, `*`
or `#`.

```
$ python3 $SCRATCH/lineclass.py
changed lines: 3327; non-comment changed lines: 0
```

No string literal moved: the "fleet-wide shared secret" error strings in
`checks-shadow.ts:564` and `:617`, the `NOT EXECUTED, no version asserted.`
message in `smoke.ts`, and every `RESULT:`/`PASS:`/`FAIL:`/`SKIP:` literal are
byte-identical to the merge base.

## MUST-KEEP items reworded

Every MUST-KEEP class with an instance in `os/verify` is listed. Where the text
is byte-identical it says so; where it was reworded, both forms are quoted.

### Class 7 — deliberate present-tense contract citations

The five PLAN-014 **Scope** quotes named in the plan are all present and the
quoted clause is byte-identical in every one. Three were not touched at all
(`checks-connd.ts:10`, `checks-ext4.ts:396`, `checks-bootchain.ts:349`); two
were re-wrapped around an unchanged quotation.

`checks-bootchain.ts:31` -> `:19`

Before:

```
// not found`. That is not a defect in the image and it is not something this
// batch may repair: PLAN-014's Scope section puts `board/` BSP builds outside
// this campaign -- "No change to ... `board/` BSP builds (digest pins only)" --
// and populating the tree would turn eight of the oracle's FAILs into passes,
// i.e. it would change the measurement rather than port it.
```

After:

```
// found`. PLAN-014's Scope section puts `board/` BSP builds outside this
// campaign -- "No change to ... `board/` BSP builds (digest pins only)" -- so
// the port expresses the absence exactly as the oracle does: same paths, same
// sentence.
```

`checks-system.ts:29` -> `:23`

Before:

```
// is in scope under PLAN-014's Scope section -- "No change to ... `mosd/` Rust
// sources" -- and nothing here writes to them.
```

After (re-wrapped only):

```
// Reading those sources is in scope under PLAN-014's Scope section -- "No change
// to ... `mosd/` Rust sources" -- and nothing here writes to them.
```

`verify-cli.ts:22` — the output-format contract note.

Before:

```
// THE OUTPUT FORMAT IS A CONTRACT, not a presentation choice. One
// `PASS:`/`FAIL:`/`SKIP:` line per conclusion and a final `RESULT:` line:
// test/apid-api's own harness describes its output as "the shape os/verify
// prints", and docs/task/RFCT-039 and RFCT-054 quote `RESULT: PASS (n/n)`
// lines as evidence. Changing how a verdict READS makes every one of those
// records unreadable.
```

After (`verify-cli.ts:11`):

```
// The output format is a contract, not a presentation choice: one
// `PASS:`/`FAIL:`/`SKIP:` line per conclusion and a final `RESULT:` line.
// test/apid-api's own harness describes its output as "the shape os/verify
// prints", and docs/task/RFCT-039 and RFCT-054 quote `RESULT: PASS (n/n)` lines
// as evidence, so changing how a verdict reads makes those records unreadable.
```

The design-doc citations are unchanged in substance: `checks-shadow.ts` still
opens on `docs/design/access.md 4.2`, `checks-dbus.ts` still names
`dbus_policy_rules_only` (:661), `dbus_policy_tags` (:729) and the awk at :2989,
and `checks-fstab.ts` still names `os/tests/ui-location-test.sh`'s seven
identities and its case 7.

### Class 3 — tool quirks

| quirk | where it is now | changed? |
|---|---|---|
| debugfs reports failure on **stderr**, not in its exit status | `image.ts:480` | reworded, quoted below |
| sgdisk invents a GPT and exits 0 on a file with no partition table | `image.ts:146` and the `SGDISK_INVENTED` throw text | doc-comment unchanged; throw text is a string literal, untouched |
| `unsquashfs -d DEST ARCHIVE nope/nothing` exits 0 and leaves DEST empty | `image.ts:597` | unchanged |
| `veritysetup verify` exits 1 both for a real mismatch and for "not a valid VERITY device" | `image.ts:681` | reworded (caps only) |
| the e2fsck exit-code bitmask, and `e2fsck -fn` exiting 0 on a truncated filesystem | `image.ts` `E2FSCK_VERDICT_CODES` and `e2fsckClean`; restated at `checks-ext4.ts:1` | moved out of the section preamble onto the two declarations it constrains |
| the measured `docker run` exit-status table (255 / 127 / 126 / 127 / own status) with its stderr text | `smoke.ts:160` | table byte-identical; prose around it compressed |
| `fdtget -t x` on a **string** property exits 0 and prints the string's bytes as cells | `image.ts` `fdtGetCells` | moved out of the section preamble onto `fdtGetCells` |
| apk describes a failed index fetch as "no such package"; 3 of 40 runs measured | `tools.ts:100` | reworded, count and error text kept |
| `grep -c` printing `0` **and** exiting 1, so `|| echo 0` yields `"0\n0"` | `checks-system.ts:1` | reworded, kept |
| `getcap -r DIR` on an absent directory exits 0 and prints to stderr | `checks-shape.ts:1` | reworded, kept |

`image.ts` — the debugfs stderr rule.

Before:

```
 * THE STDERR RULE, and why it is the whole check. debugfs exits 0 whether or
 * not it opened the filesystem -- measured: `debugfs -R "ls -p /"` on a file
 * that is not ext4 exits 0 with empty stdout. What differs is stderr: on a
 * filesystem it opened, stderr is EXACTLY the one-line version banner; on one
 * it did not, the banner is followed by "...while trying to open FILE" and
 * "ls: Filesystem not open". So the rule is: one line of stderr, and it is the
 * banner. Any second line is a refusal, quoted.
```

After:

```
 * The stderr rule is the whole check. debugfs exits 0 whether or not it opened
 * the filesystem -- measured: `debugfs -R "ls -p /"` on a file that is not ext4
 * exits 0 with empty stdout. What differs is stderr: on a filesystem it opened,
 * stderr is EXACTLY the one-line version banner; on one it did not, the banner
 * is followed by "...while trying to open FILE" and "ls: Filesystem not open".
 * So the rule is one line of stderr and it is the banner; any second line is a
 * refusal, quoted.
```

### Class 5 — ordering constraints

`smoke-register.ts` — "asking a daemon for its version must not mutate". The
module header restated this and so did the `mosd` register entry; the header's
copy went and the entry's grew the facts the header carried, so nothing is lost
and it now sits on the entry it constrains.

Before (module header, and a shorter note on the entry):

```
// mosd AND apid ANSWER `--version` BEFORE ANY DAEMON INITIALISATION --
// provisioning, bus connection or key generation. That ordering is the whole
// contract: asking a daemon for its version must not MUTATE. `/usr/bin/mosd`
// with no argv still provisions (secrets/, settings.toml) and still exits 1 on
// the absent system bus, and `/usr/bin/mosd -v` -- NOT this flag -- falls
// through into that same daemon and prints no version at all.
```

After (on the `mosd` entry):

```
    // mosd and apid answer `--version` before any daemon initialisation --
    // provisioning, bus connection, key generation -- because asking a daemon
    // for its version must not MUTATE. mosd/mosd/src/main.rs answers from a
    // synchronous `main`, before the tokio runtime, the subscriber, the settings
    // store and provisioning, so this invocation reports, exits 0 and leaves
    // nothing behind. `/usr/bin/mosd` with no argv still provisions (secrets/,
    // settings.toml) and still exits 1 on the absent system bus, and
    // `/usr/bin/mosd -v` -- NOT this flag -- falls through into that daemon and
    // prints no version at all.
```

`checks-shadow.ts` keeps "the reconciler runs BEFORE every reader, and each unit
it orders against is actually in the image, because systemd drops an ordering
against an absent unit silently" and "it reads the FACTORY copy and not the
previous boot's". `checks-mqtt.ts` keeps the comment-strip-before-tag-normalise
ordering. `checks-home.ts` keeps the separate-enablement rule.

### Class 6 — secret handling

"A signed rootfs is byte-identical on every device, so this is a fleet-wide
shared secret" lives in `checks-shadow.ts` in two forms: as `verdict()` message
strings (`:564`, `:617`) which are string literals and were not touched, and as
the comment at `:531-533`, which is unchanged. The header's version --
"nothing in the image can satisfy either end of it, or PAM would read a file
byte-identical on every device in the fleet" -- survives verbatim.

### Class 8 — test-intent comments

Kept throughout; what went is the preamble above the test rather than the note
on the assertion. `smoke-register.test.ts`'s "the lock, and the edit it was built
to force", `smoke.test.ts`'s "the case a right-hand guard broke" and
`checks-board.test.ts`'s `status-led-absent` paragraph (the branch never before
driven failing) are all present.

### Classes with no instance in `os/verify`

Class 1 (`MOSD_DRY_RUN` / `MOSD_SHADOW_PATH` harness safety), class 2
(reproducibility: mksquashfs, FILE_MTIME/@epoch, verity UUID/salt pinning,
seeded times) and class 4 (shadow(5) nine fields, bcrypt 72-byte truncation,
OpenSSH fingerprint format, MQTT topic grammar, D-Bus `own_prefix` measured
semantics) have no comment in these 44 files. `checks-dbus.ts` reads
`own_prefix` but its comment is about the one-character edit that widens a
grant, which is kept. Nothing was deleted on their account.

## Surviving 15+-line comment blocks

85 before, **70 after**; the longest went from 60 lines to 36. None is zero and
this section says why, per block.

The shape of `os/verify` is the reason. It is 5,840 comment lines over 44 files
and the great majority of them are MUST-KEEP classes 3 and 7: a measured tool
quirk, an oracle line number, a per-board conclusion census, or a quoted
contract clause. Rule 3's `<= 8` target is reachable for a block that is mostly
rationale and not for a module header that is mostly a table of measurements.
What this pass could do, it did:

- every counterfactual paragraph ("a check that did X would pass an image
  that...") is gone where the constraint it justified is stated plainly;
- every header paragraph that repeated something already stated at the code it
  describes is gone -- `image.ts`'s four-tool preamble now points at
  `SGDISK_INVENTED`, `debugfsRun`, `squashfsExtract` and `verityVerify`, each of
  which already carried the same measurement;
- four blocks were split rather than shortened, by moving a paragraph down onto
  the declaration it constrains: `image.ts`'s fdtget and e2fsck section
  preambles onto `fdtGetCells`, `FDT_REFUSAL`, `E2FSCK_VERDICT_CODES` and
  `e2fsckClean`; `smoke.ts`'s maximal-munch rule into `versionTokens`;
  `smoke-register.ts`'s catatonit normalisation onto the `pin:` it describes;
  and `smoke.ts`'s 127-is-ambiguous rule into `diagnose`.

Fifteen blocks left the 15+ class entirely, including all five in `image.ts`
(longest 54 -> 14) and eight of the nine in `smoke.ts` (longest 43 -> 23).

| block | lines | why it cannot be shorter |
|---|---:|---|
| `os/verify/src/board-env.ts:1` | 36 | the accepted and the refused board.env grammar, enumerated; each construct is a refusal the parser must keep making |
| `os/verify/src/checks-board.ts:1` | 33 | three derivation rules (skip matcher, derived board lists, one check per path) plus the measured 3/22 SKIP census |
| `os/verify/src/checks-system.ts:1` | 32 | the ten-site conclusion census (line numbers and per-board counts) plus the PLAN-014 Scope quote and the `grep -c` "0\n0" defect |
| `os/verify/src/checks-shadow.ts:1` | 31 | the access.md 4.2 credential property end to end, plus the two oracle checks that disagree about an empty password field |
| `os/verify/Dockerfile:1` | 31 | two digest pins, why build-env does not build it, and the measured `ldd` "Not a valid dynamic program" static-client fact |
| `os/verify/src/lint.ts:1` | 30 | the RAUC grub-backend incident quote plus four measured `${NAME:-}` holes, each with its own spelling |
| `os/verify/src/checks-connd.ts:1` | 30 | the PLAN-014 Scope quote plus the measured extractor-rot incident that forbids a fallback default |
| `os/verify/src/checks-bootchain.ts:1` | 30 | the five skip-group line numbers with their check counts, the PLAN-014 Scope quote, and the two cx3576 literals |
| `os/verify/src/tools.ts:1` | 27 | the two-route seam, the pinned-image key, and the no-empty-string-on-failure rule |
| `os/verify/src/checks-shape.ts:1` | 27 | the per-board `exactly N partitions` derivation plus the measured `getcap -r` vacuous pass |
| `os/verify/src/checks-ext4.ts:1` | 27 | the layout-offset extraction rule plus three measured oracle defects reproduced rather than repaired |
| `os/verify/src/parity.ts:1` | 26 | the by-name-not-by-count rule and the measured 398/312 verdict-line census |
| `os/verify/src/checks-mqtt.ts:1` | 26 | the inertness property plus the measured tag-normalisation ordering (:838-846) |
| `os/verify/src/checks-home.ts:1` | 26 | the read-the-tier rule, the separate-enablement rule, and the static-read rule for the seed scripts |
| `os/verify/src/checks-fstab.ts:1` | 25 | the one-check-seven-firings shape and the measured six-line `custom UI root` matcher |
| `os/verify/src/checks-dbus.ts:1` | 25 | three ported readers named against their oracle line numbers, plus the read-the-bus-name rule |
| `os/verify/src/script-commands.ts:1` | 24 | the pipeline-not-parser rule, the wrapper commands deliberately excluded, and the re-rooting difference |
| `os/verify/src/verify-cli.ts:1` | 23 | the output-format contract (MUST-KEEP class 7) plus the SKIP-is-not-PASS and zero-conclusions rules |
| `os/verify/src/smoke.ts:160` | 23 | the measured five-row `docker run` exit-status table (255/127/126/127/own status) with its stderr text |
| `os/verify/src/checks.ts:369` | 23 | the content-keyed cache rule and the publish-by-rename rule, both with the defect each prevents |
| `os/verify/src/checks-gpt.ts:121` | 23 | the measured substring census (` partitions` 3/3, `exactly ` 13/8) the matcher choice rests on |
| `os/verify/src/checks-cmdline.ts:1` | 23 | the U-Boot and GRUB command-line composition, both sources named, plus the leave-unexpanded rule |
| `os/verify/src/smoke-negative.ts:1` | 22 | the measured 255/127/126 correction to M7b's map, plus the no-op and positive-control rules |
| `os/verify/src/image.test.ts:50` | 22 | the measured `_out/` ENOENT incident (373/373 -> 332 of 333) and the filtered-run scratch leak |
| `os/verify/src/checks.ts:1` | 22 | the matcher-on-the-check rule and the shape of a register entry |
| `os/verify/src/checks-slots.ts:150` | 22 | the per-slot factory assertions and the oracle line numbers they come from |
| `os/verify/src/checks-root.ts:1` | 22 | the unpack-once cache rule, the same-text-on-both-boards admission rule, and the measured ` contains ` census |
| `os/verify/src/checks-engine.ts:1` | 22 | the one register shape that cannot be expressed, measured and recorded |
| `os/verify/src/board.ts:1` | 22 | the parser-throws / model-does-not split and the declared-empty-is-not-absent rule |
| `os/verify/src/tools.ts:100` | 21 | the measured apk index-fetch failure rate (3 of 40) with its exact error text, and the retry rule |
| `os/verify/src/checks-slots.ts:1` | 21 | the layout-offset rule plus the factory-only serial and label facts (:1796, :1804) |
| `os/verify/src/checks-bootchain.ts:341` | 21 | the PLAN-014 Scope quote about `board/` BSP files, at the check it constrains |
| `os/verify/src/board.ts:113` | 21 | the partition model fields and the geometry each one is read from |
| `os/verify/run.sh:1` | 21 | the usage block plus the tool-less-host seam and the zero-tests-is-a-failure rule |
| `os/verify/src/smoke-pins.ts:1` | 20 | the closed-version-loop rule and the three second-list defects it exists to prevent |
| `os/verify/src/smoke-negative.ts:250` | 20 | the mutation contract for one negative case, pre-state and post-state |
| `os/verify/src/checks-rauc.ts:1` | 20 | the slot-device consequence (an update over the running slot) and what is deliberately not here |
| `os/verify/src/lint.ts:514` | 19 | the backstop/vacuity rule with the measured shell-predecessor incident it exists for |
| `os/verify/src/lint.test.ts:1` | 19 | the declared-empty axis the shell pair never tested, with the measured 0/0 and 1/1 incidents |
| `os/verify/src/checks-fixture.ts:190` | 19 | fixture contract: what the synthetic image asserts and which mutation drives which check red |
| `os/verify/run.sh:210` | 19 | a measured route decision (bun invocation, or the vacuity guard) stated where it is taken |
| `os/verify/src/smoke-register.ts:211` | 18 | the catatonit Scope correction and its two-step normalisation, and the unclaimed-authorisation rule |
| `os/verify/src/smoke-pins.ts:137` | 18 | the measured two-spellings-in-one-file fact and why this is not a one-line regex |
| `os/verify/src/parity.ts:152` | 18 | the self-consistency guard and the identity assignment it depends on |
| `os/verify/src/layout.ts:1` | 18 | the size-resolution order and the walk rule that makes packing the thing under test |
| `os/verify/src/checks-gpt.ts:1` | 18 | the derivation of the expected table and the one number that crosses |
| `os/verify/src/checks-ext4.ts:382` | 18 | a measured oracle defect reproduced at the check that reproduces it |
| `os/verify/src/checks-board.test.ts:1` | 18 | the three-direction discipline and the branch never before driven failing |
| `os/verify/src/tools.ts:540` | 17 | a measured runtime decision stated at the code that takes it |
| `os/verify/src/smoke-register.ts:189` | 17 | the catatonit Scope correction and its two-step normalisation, and the unclaimed-authorisation rule |
| `os/verify/src/smoke-cli.ts:1` | 17 | the CLI contract and the refusals it makes before anything is executed |
| `os/verify/src/checks-fixture.ts:553` | 17 | fixture contract: what the synthetic image asserts and which mutation drives which check red |
| `os/verify/src/checks-board.ts:853` | 17 | a per-family derivation rule with the board declaration it reads |
| `os/verify/src/smoke.test.ts:1` | 16 | the five things asserted, each ruling out a different way of passing |
| `os/verify/src/smoke-register.ts:1` | 16 | the catatonit Scope correction and its two-step normalisation, and the unclaimed-authorisation rule |
| `os/verify/src/smoke-register.test.ts:36` | 16 | the lock and the edit it was built to force |
| `os/verify/src/smoke-pins.ts:60` | 16 | the measured two-spellings-in-one-file fact and why this is not a one-line regex |
| `os/verify/src/probe.ts:1` | 16 | the probe-is-not-a-check rule and the role walk |
| `os/verify/src/image.test.ts:1` | 16 | the stub-runtime rule and the four tools that must be refused |
| `os/verify/src/checks-home.ts:176` | 16 | the tier rule stated at the check that reads it |
| `os/verify/src/checks-fixture.ts:451` | 16 | fixture contract: what the synthetic image asserts and which mutation drives which check red |
| `os/verify/src/smoke-pins.test.ts:1` | 15 | the failing side of the pin normalisation |
| `os/verify/src/parity.ts:171` | 15 | the self-consistency guard and the identity assignment it depends on |
| `os/verify/src/checks.ts:276` | 15 | a register invariant stated at the code that holds it |
| `os/verify/src/checks-fixture.ts:682` | 15 | fixture contract: what the synthetic image asserts and which mutation drives which check red |
| `os/verify/src/checks-fixture.ts:359` | 15 | fixture contract: what the synthetic image asserts and which mutation drives which check red |
| `os/verify/src/checks-fixture.ts:1` | 15 | fixture contract: what the synthetic image asserts and which mutation drives which check red |
| `os/verify/src/checks-ext4.test.ts:1` | 15 | the vacuous-pass cases asserted as their own cases |
| `os/verify/src/checks-board.ts:311` | 15 | a per-family derivation rule with the board declaration it reads |
| `os/verify/run.sh:145` | 15 | a measured route decision (bun invocation, or the vacuity guard) stated where it is taken |

## Gate results

Run from the worktree root on the final commit. The container route is the CI
route; the host bun is 1.3.13 and `bun.lock` is lockfileVersion 2, so a bare
`bash os/verify/run.sh` fails with "Unknown lockfile version" at `main` too.

| gate | command | result |
|---|---|---|
| verify suite | `MOS_VERIFY_CONTAINER=1 bash os/verify/run.sh` | `RESULT: PASS (1066/1066 tests)`, `Ran 1066 tests across 31 files`, **rc=0** |
| shell lint | `bash os/tests/shell-pipefail-lint.sh` | `RESULT: PASS (29/29 files clean, 29 scanned)`, **rc=0** |
| syntax | `bash -n os/verify/run.sh` (the only `.sh` touched) | **rc=0** |

Real output:

```
$ MOS_VERIFY_CONTAINER=1 bash os/verify/run.sh; echo rc=$?
...
 4836 expect() calls
Ran 1066 tests across 31 files. [17.67s]
RESULT: PASS (1066/1066 tests)
rc=0

$ bash os/tests/shell-pipefail-lint.sh; echo rc=$?
PASS: test/apid-api/run.sh pipes nothing into an early-exiting grep
RESULT: PASS (29/29 files clean, 29 scanned)
rc=0

$ bash -n os/verify/run.sh; echo rc=$?
rc=0
```

**Baseline, taken on this branch before the first edit**: the same
`RESULT: PASS (1066/1066 tests)` over 31 files, rc=0. The count did not move,
which is what a comment-only pass must produce.

## Metric re-run

The milestone's `m6metric.py`, over the whole tree.

| | before (`b55b9df`) | after |
|---|---:|---:|
| files over threshold (score >= 8) | 144 | 117 |
| caps runs, tree-wide | 780 | 503 |
| banner lines, tree-wide | 662 | 421 |
| 15+-line blocks, tree-wide | 387 | 372 |

Restricted to the 44 files in scope: **caps 277 -> 0, banners 241 -> 0,
15+-line blocks 85 -> 70, longest block 60 -> 36**. Every one of the 44 now
scores below the score-8 threshold; none appears in the metric's over-threshold
list.

## Findings — reported, not acted on

1. **The dispatch prompt's `/tmp` paths collide between concurrent subtasks.**
   `/tmp/scope-files.txt` was overwritten by a sibling mid-run on this host, and
   the resulting metric read was nonsense for one turn before it was caught.
   Everything here moved to a private scratch directory. Nothing was committed
   from it.
2. **`strip-comments-multi.py` has no regular-expression-literal rule.** An
   apostrophe inside a regex -- `/doesn't (begin|end) on a/` -- desynchronises
   its quote state and it emits a window of the file, comments included, as
   code. Measured over these 44 files at the merge base: seven files affected,
   42 comment lines in `checks-cmdline.ts` alone. It is conservative rather than
   permissive (a code change in such a window still shows), but a comment-only
   edit there reads as a difference. The one-rule fix is in `strip2.py`,
   described above; whoever owns the harness may want it.
3. **`os/verify/HARNESS.md` restates several of these headers** and now says
   some of them at greater length than the source does. It is a `*.md` file and
   out of this task's scope; the sibling docs workstream owns it.
