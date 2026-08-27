# RFCT-128 PLAN-015 M5: citations repaired against the checker, and the check made to gate

- **status**: done
- **priority**: P2
- **owner**: PLAN-015 (M5)
- **createdAt**: 2026-08-26
- **plan**: PLAN-015 (M5)

`bash docs/verify-citations.sh` exits 0 over the tree. `make
docs-verify-citations` runs it without `--advisory`, and the CI step is named
for what it asserts rather than for being advisory. The flag still exists and
still works; nothing in the default path passes it.

## What was repaired

66 failures on the merged tree, 0 after: 58 in `api.md`, 5 in `dashboard.md`, 2
in `uboot-ab-handshake.md`, 1 in `bus.md`. Most were line drift — a quoted
comment or assertion still says what the document says it says, several lines
from where it used to. Those were re-pointed at the line the text is on now,
each verified by reading the target before the citation was written.

Where a quotation's source no longer said it, the sentence was changed to say
what the source says today. `api.md` section 1.7 cited a process-architecture
and bus-contract analysis in `dashboard.md` that no longer exists; it now cites
`dashboard.md`'s statement of the two-process split, and anchors the
bus-as-a-contract claim to the boot health gate that calls `com.mos.mosd1`
directly. Section 6.4's merge-consequence quotation is stated as the
present-tense consequence of the split instead.

## The convergence order this pass establishes

Structural deletions land first; cross-document citations are repaired once,
last, on a tree where nothing further will move. Repairing citations while
sibling documents are still losing sections costs the repair twice and
converges on nothing, because every deletion invalidates line numbers in every
document that cites it. This pass ran after all ten document subtasks and after
the source-comment compression that moved 144 files, and that is why one run of
the checker was enough to enumerate the work.

A failure count is true only of the tree it was measured on. The list carried
into this pass says 24; the run on the merged tree, after 144 source files have
been reflowed, finds 66 — so the enumeration here is re-derived from its own
run, and a list carried across a merge counts as orientation rather than as a
work list.

## RESOLVES-BUT-WRONG

A citation whose line still resolves while the text it named has moved is
invisible to this checker when the citation carries no quote. Check 1 passes on
whatever now occupies that line; there is no check 2 to run. The reader is
handed a line number that answers a different question, with nothing anywhere
reporting a problem.

The campaign's instance: a claim about a board booting to apid healthz cited
`docs/design/boards.md:91`, and the text moved to `:98` while line 91 became a
different checklist step. It now lives in `docs/task/RFCT-131.md`, retargeted at
`:98` with the quote the source carries today. It was caught because a subtask
reported the move, never by a tool, and a green run is not evidence it is fixed.
Following that thread found five more of the same class — `mos-health` citations
in `api.md` and `dashboard.md` naming line ranges the probe reordering had
vacated — which is a count of what one thread turned up, not a bound on how many
exist.

That is the residual human responsibility this checker leaves, and it belongs
beside the provenance-claim limit in `RFCT-121.md`, which is where both are
recorded.

## The two test-file comments, a bounded exception

`os/build/src/mkimage-v2.test.ts` and `os/build/src/mkimage-x64.test.ts` each
carried a header comment pointing at byte-identity gate sections of
`os/build/HARNESS.md` that this milestone deleted. Comment lines only were
changed in both; no executable line was touched. The exception is recorded here
because these files are otherwise outside M5's scope: this workstream broke the
pointers and both owning workstreams are closed.

`mkimage-v2.test.ts`, before:

```
// The byte-identity gate is not here. It is shell-against-TypeScript over the
// real _out/cx3576/ inputs, it takes minutes and 1.3 GiB, and os/build/HARNESS.md
// carries the recipe and the two hashes. What is here is everything that gate
// cannot see: a gate compares bytes for a good input, and a port that quietly
// dropped a refusal produces identical bytes for every good input and passes it
// perfectly. What it stops catching is a board that needs re-flashing.
```

after:

```
// This file compares no bytes. It covers what a byte comparison cannot see: a
// comparison is green for a good input, and an assembler that quietly dropped a
// refusal produces identical bytes for every good input and passes it perfectly.
// What it stops catching is a board that needs re-flashing.
```

`mkimage-x64.test.ts`, before:

```
// The byte-identity gate is not here. It is shell-against-TypeScript over the
// real _out/x64/ inputs, it takes a minute and 1.9 GiB, and os/build/HARNESS.md
// carries the recipe and the four hashes. What is here is everything that gate
// cannot see: a gate compares bytes for a good input, so a port that quietly
// dropped a refusal produces identical bytes for every good input and passes it
// perfectly. os/tests/mkimage-x64-selftest.sh says the same about itself, naming
// the ESP cluster-count floor as exactly that kind of loss.
```

after:

```
// This file compares no bytes. It covers what a byte comparison cannot see: a
// comparison is green for a good input, so an assembler that quietly dropped a
// refusal produces identical bytes for every good input and passes it perfectly.
// os/tests/mkimage-x64-selftest.sh says the same about itself, naming the ESP
// cluster-count floor as exactly that kind of loss.
```

## Pointers repaired outside the checker's reach

`os/verify/README.md` named two `HARNESS.md` sections that no longer exist. Both
facts survive under new titles, so both pointers were re-pointed: "The hole,
measured rather than assumed" to "Why `--verify` runs in an image of its own",
and "The exit-status diagnosis, measured" to "What a non-zero exit means". The
four `HARNESS.md` pointers in `os/build/README.md` name no section and each
underlying fact was confirmed present, so none was changed.
`os/rootfs/stages/README.md` carries no `HARNESS.md` pointer at all.

Two references this milestone left dangling were repaired by reading, since
neither can turn a run red: `docs/design/remote-management.md` cited a deleted
`docs/architecture.md` notice, and `docs/design/provisioning.md` cited
`talos/hack/cx3576/dev-config/config.yaml`, a path the checker skips as outside
this tree rather than failing.
