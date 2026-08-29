# RFCT-172 PLAN-020 M3: citation scanning widened to docs/task and docs/research, with the dated-record exemption

- **status**: completed — widened gate green at 1139/1139 (this record's own citations included) with 31 dated records exempted by name, 15 live citations repaired across 12 documents, census floors raised in the widening commit, 24/24 self-test cases
- **priority**: P2
- **owner**: bkd/wj2vk59q
- **createdAt**: 2026-08-27

PLAN-020's Context item 5, measured by RFCT-159 finding a: `path:line`
citations in `docs/task/*.md` and `docs/research/*.md` were scanned by no gate
at all — 77 stale citations into the six rewritten design documents alone, and
an unknown number into the rest of the tree. This milestone widens
`docs/verify-citations.sh` to both directories (still excluding `*.zh.md`),
with an exemption mechanism for the records that must never be "fixed".

## The exemption mechanism

A dated record declares itself with a marker line in its own body, at the
start of a line (shown indented here so this record does not exempt itself):

```
  <!-- dated-record: <what is frozen, and at what point> -->
```

Front-matter marker over a committed path list, for two reasons: the decision
travels with the file it is about (the diff that exempts a record touches that
record, so review sees both together), and a reader of the record itself sees
that it is exempt without opening a second file. The marker sits at the END of
the file — an early insertion was tried first and immediately turned the
previously green 902 red: it shifted every line in the marked file by one,
under the documents citing INTO it (`docs/design/api.md` quotes
`mos-ui-inventory.md` by line), which is precisely the resolves-but-wrong
class the checker exists to catch. End-of-file placement shifts nothing.

"Left alone" is evidenced, never silent (the PLAN-018 Amendment-1 pattern):
every run prints `exempted as dated records, citations not checked: N` and one
`dated record: <path>` line per exempted file. The marker exempts whichever
scanned file carries it — a marker on a file nobody classified as dated still
prints, so review reads the census rather than trusting silence
(self-test case 23).

## The classification and its criterion

The inventory was re-derived by running the widened checker over the merged
tree: 110 failures (86 missing paths, 12 lines past end of file, 12 quote
mismatches) across 39 documents — larger than RFCT-159's 77 because that
grep counted only citations into the six rewritten design documents, while
the widened scan also reaches the citations into the pre-PLAN-019 `os/`
layout (`os/verify-image-v2.sh` alone is cited 20 times).

Criterion, per record content, not per count: a document whose failing
citations record what was measured at its own commit — a frozen worklist, a
verification table over a tree that has since been reorganised, an exhibit
whose staleness is the exhibit — is dated; a document whose failing citations
name a fact a reader still uses to navigate today's tree, where that fact
still exists at a reachable location, is live and gets repaired. The
distinguishing test used for every file: does the cited fact still live
somewhere (file moved intact by PLAN-019, line drifted, quote reworded in
place), and does the citing sentence stay TRUE when re-pointed there? If
either answer is no, re-pointing would falsify the record, and the record is
dated.

**31 dated records** (the spec's "on the order of 13" was RFCT-159's estimate
within its design-doc-only inventory; the widened scan surfaces the whole
`os/`-layout class that grep never counted):

- Frozen worklists and exhibits, the class RFCT-159 named explicitly —
  `RFCT-056`, `RFCT-059`, `RFCT-128` (its `boards.md:91` citation is
  deliberately the wrong line: it is the exhibit of the resolves-but-wrong
  case), `RFCT-131`, `RFCT-163` (the "sites left for RFCT-157" worklist).
- Measurement records frozen at their commit, citing deleted pre-PLAN-019
  paths or design-document sections that no longer exist — `RFCT-044`,
  `RFCT-046`, `RFCT-057`, `RFCT-063`, `RFCT-065`, `RFCT-067`, `RFCT-073`
  (self-dated: "these line numbers are as of `b4b7c72`"), `RFCT-075`,
  `RFCT-077` (self-described "dated-by-policy"), `RFCT-079`, `RFCT-080`,
  `RFCT-095`, `RFCT-096`, `RFCT-107`, `RFCT-108`, `RFCT-109`, `RFCT-110`,
  `RFCT-112`, `RFCT-116`, `RFCT-151`, `RFCT-152`, `RFCT-154`, `RFCT-160`,
  `RFCT-161`, `RFCT-165`.
- `docs/research/mos-ui-inventory.md`, measured at `86cd669` and already
  classified dated by RFCT-165.

## The repairs — 15 citations across 12 live documents

Every target verified by opening it before re-pointing:

| document | was | now | why it is live |
| --- | --- | --- | --- |
| `docs/task/RFCT-041.md:24` | `venus-os-access.md:16-19` | `:17-20` | the cited scope paragraph drifted one line |
| `docs/task/RFCT-042.md:42` | `dashboard.md:45` | `:61` | section 1 "Problem and current state" still exists |
| `docs/task/RFCT-058.md:285` | `verify-index.sh:26` | `:42` | `README=docs/README.md` moved when RFCT-171 grew the file |
| `docs/task/RFCT-066.md:62` | `os/rauc/system.conf.in` `:50-62` | `os/pkgs/rauc/system.conf.in:64-76` | the plain-refusal and CMS keyring text lives there today |
| `docs/task/RFCT-105.md:355` | `os/qemu-run.sh` `:167` | `test/apid-api/src/qemu.ts:251` | `-no-reboot` still passed, file moved twice |
| `docs/task/RFCT-139.md:8` | `os/update/rauc/system.conf.in` `:71-78` | `os/pkgs/rauc/system.conf.in:71-78` | moved by PLAN-019, same lines, quote intact |
| `docs/task/RFCT-139.md:16` | `checks-root.ts` `:629-633` | `:601-620` | `packed-no-dev-keyring` check body |
| `docs/task/RFCT-142.md:22` | `os/update/rauc/system.conf.in` `:35` | `os/pkgs/rauc/system.conf.in:35` | the fw_setenv comment, same line |
| `docs/task/RFCT-162.md:132` | `os/update/rauc/build.sh` `:63` | `os/pkgs/rauc/build.sh:63` | `BUILDER_ARGS=(--builder default)`, same line |
| `docs/task/RFCT-166.md:75` | `os/update/rauc/build.sh` `:63` | `os/pkgs/rauc/build.sh:63` | same, in the record of the move itself |
| `docs/task/RFCT-169.md:139` | quote/citation pairing | restructured | the deliberately-false quote sat adjacent to the citation; the sentence now pairs the citation with what `:32` actually reads |
| `docs/research/venus-os-access.md:271` | `access.md:199-202` | `:310-313`, quote re-cut | the not-cleared-by-reset sentence, reworded in place by the access.md rewrite |
| `docs/research/venus-os-access.md:359` | `remote-management.md:68` | `:71`, quote re-cut | "without an inbound port" is the text the target carries today |
| `docs/research/venus-os-ui.md:682` | `mosd.md:192` | `:269` | the `ReportHealth` interface-table row |
| `docs/research/venus-os-ui.md:694` | `mosd.md:173-176` | `:250-252` | the named-outcomes bullet holding `plaintext-missing` |

## The census baseline

The widened scope raises the per-segment floors in the same commit as the
widening, the sanctioned explicit baseline edit: `docs` 92 → 176, `os`
810 → 935, and `test` enters with 7.

## Self-tests

Case 21: a stale citation in a non-exempt task document FAILS. Case 22: the
same document and citation with the marker runs green, exemption count and
per-file census line asserted verbatim. Case 23: a marker on a file outside
the dated list still prints in the census. Case 1 pins the exempted-count
line at zero so the category prints even when empty. 24/24.

## What this milestone does not close

- Resolve-but-wrong citations in the widened scope: an unquoted citation whose
  target file exists passes resolution whatever its line now holds. The
  remaining files of RFCT-159's 77-citation inventory that neither failed the
  widened run nor sit in the dated list (`RFCT-064`, `RFCT-068`, `RFCT-071`,
  `RFCT-111`, `RFCT-155`, `RFCT-158` among them) may still cite drifted lines
  invisibly; that class is bounded by the no-quote ratchet RFCT-173 records,
  not by this gate.
- Provenance claims ("measured at `<commit>`") stay unverifiable by design,
  as the checker header states.
