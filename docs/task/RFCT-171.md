# RFCT-171 PLAN-020 M2: the index checkbox is compared with the record's status head, after the vocabulary is unified

- **status**: completed — checkbox-vs-status gate live at 680/680, vocabulary swept tree-wide with no information loss, README description contract decided against with the reasons recorded
- **priority**: P2
- **owner**: PLAN-020 M2
- **createdAt**: 2026-08-27

PLAN-020's Context items 2 and 3, both measured before this plan existed:
RFCT-144 found that a checkbox in `docs/task/index.md` and the `status` field
in the record it links to are two independent records of the same fact that
nothing compares, over a vocabulary split three ways; RFCT-159 finding d found
a `docs/README.md` description bullet that lies about its document with no
gate reaching it.

## The status contract

The status line in every `docs/task/*.md` record is now

    - **status**: <head>
    - **status**: <head> — <free detail>

where `<head>` is exactly one of `pending`, `in progress`, `completed`,
`closed`, mapping to the index markers `[ ]`, `[-]`, `[x]`, `[~]`
respectively. The contract is stated next to the Status Markers table in
`docs/task/index.md`, and `docs/verify-index.sh` section 3 enforces both
halves: a record with no parseable status line or a non-canonical head fails
(the vocabulary gate holding), and a row whose checkbox does not match its
record's head fails naming both sides. 680/680 on this tree; three negative
cases in `docs/verify-index-test.sh` drive each new assertion to fail with
its own message (11/11 cases).

## The vocabulary sweep

Before the sweep the tree carried the split RFCT-144 measured and more:
`done`, `complete — ...`, `implementation complete`, `implementation
complete — ...`, `analysis complete — ...`, `research complete — ...`,
`proposal complete — ...`, `in-progress`, `done. ...`, `closed by ...`. Every
status line was rewritten to the contract with no information loss: wording
that was not already the bare head moved into the detail (`implementation
complete — pending user hardware acceptance` became `completed —
implementation complete, pending user hardware acceptance`); bare synonyms
that carry nothing beyond the head (`done`, `complete`, `in-progress`)
collapsed into it. Only the status line changed in each record; RFCT-095's
`closed by PLAN-011 M5 ...` maps to `completed`, matching its `[x]` marker,
because its own Resolution section records the defect as fixed inside M5, not
abandoned.

## Marker-vs-status repairs

Where the two sides disagreed today, the record's own content decided which
side was wrong. Every repair, none made silently:

| record | disagreement | side judged wrong, and why |
| --- | --- | --- |
| RFCT-009 | status `implementation complete — ...` vs marker `[-]` | marker; flipped to `[x]` |
| RFCT-010 | same | marker; flipped to `[x]` |
| RFCT-011 | same | marker; flipped to `[x]` |
| RFCT-012 | same | marker; flipped to `[x]` |
| RFCT-013 | same | marker; flipped to `[x]` |
| RFCT-014 | same | marker; flipped to `[x]` |
| RFCT-015 | same | marker; flipped to `[x]` |
| RFCT-020 | status `implementation complete` vs marker `[-]` | marker; flipped to `[x]` |
| RFCT-165 | status `in-progress` vs marker `[x]` | status; now `completed` |
| RFCT-031 | no status line at all vs marker `[x]` | record; `completed` added |

For RFCT-009..015 and RFCT-020: each record states implementation complete
with its checks green, and the only pending item is user hardware acceptance,
which sibling records with the same posture (RFCT-027, RFCT-029, RFCT-097)
carry as detail under `[x]` — "on-device behaviour is the user's acceptance".
PLAN-010's own finalize record (RFCT-019) is `[x]`; its milestones'
implementation tasks cannot still be open. For RFCT-165: the record's closing
measurements are present (baseline and after counts, the clean
`git status --porcelain`), PLAN-019 is merged and its closeout RFCT-169 is
completed; the status field was simply never updated at close. For RFCT-031:
the record predates the front-matter convention and documents a landed,
reproduced-and-fixed defect.

## The README description contract: no, and why

PLAN-020 M2 allows "assert docs/README.md description bullets against a
front-matter or first-heading contract, **or document why not**". The answer
is no, for reasons measured rather than assumed (recorded in the
`docs/verify-index.sh` header as well):

1. **There is no shared token to assert.** The description bullets and the
   documents' first headings are independently written prose. The test case
   itself: the README says `connd.md` is "unified connectivity service: WiFi
   STA/AP, Bluetooth, CAN"; connd.md's H1 says "Design: connd — WiFi station
   and access point on the systemd/mosd base". Across all 21 indexed design/
   and research files, zero bullets equal their document's heading under any
   punctuation or case normalization, and no design/research document carries
   a front-matter description field.
2. **Creating the token is out of scope.** An equality contract would require
   rewriting one side tree-wide — either 21 headings in settled documents or
   21 README bullets — and those documents' content is history this milestone
   must not edit.
3. **A heuristic fails on the one known defect.** A keyword-overlap check
   goes green exactly where the measured lying bullet lives: "WiFi" appears
   in both the wrong connd bullet and the true connd heading, so the
   RFCT-159 finding-d case — the reason the check would exist — passes it. An
   assertion that cannot fail on the defect it was built for is worse than
   none, because it converts a known review concern into a false green.

Description truth therefore stays a review concern; membership, uniqueness
and now status agreement stay mechanical.

## Checks

`bash docs/verify-citations.sh` 902/902, `bash docs/verify-index.sh` 680/680
when the gate landed (525 baseline + 155 checkbox-vs-status), 684/684 once
this record and its row joined, `bash docs/verify-citations-test.sh` (16/16
cases) and `bash docs/verify-index-test.sh` (11/11 cases) all green at every
commit of this task.
