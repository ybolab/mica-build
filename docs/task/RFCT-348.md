# RFCT-348 Write the cx3576 bench test plan and its collection script

- **status**: in_progress
- **priority**: P1
- **owner**: bkd/5glp79ue
- **createdAt**: 2026-09-07 21:10

> The index line in `docs/task/index.md` is written by L1, not by this task.

## Description

`docs/plan/PLAN-037.md` Gate D is the last 1.0 blocker that is not a decision,
and it needs hardware. `docs/bsp/cx3576-example.md`'s Qualification results
table carries thirteen rows, every one `not tested` with `needs bench
hardware`, and Gate D names four further measurements by hand: the `eth1`
DHCPv4 lease defect, whether a watchdog device exists at all, which UART
drives the display, and the input device set.

The board is about to become available. This task makes that session
executable rather than exploratory: an ordered procedure, a per-row split
between what a script collects and what a human must do, a named power-cut
window, and a collector that runs on the shipped image — which has no package
manager, no `jq`, no `python3`, no `wget` and no `perl`, and whose BusyBox
ships with no applet links.

Filling the dossier's rows is the bench session's output, not this task's.

## ActiveForm

Writing the cx3576 bench procedure and its on-device collection script

## Dependencies

- **blocked by**: (none)
- **blocks**: `docs/plan/PLAN-037.md` Gate D

## Acceptance

- `docs/bsp/cx3576-bench.md`: the ordered procedure, the per-row
  scriptable/human split, the power-cut window, and what a pass looks like for
  each row.
- The collector, self-contained, `bash`-only, no `jq`, writing a result file
  whose rows map onto the dossier table, and never reporting a pass it did not
  observe.
- A dry run against something that exists today, with the rows it exercised
  and the rows it could only syntax-check named separately.
- `make docs-verify` green from a `git archive` into an empty directory.
- This record completed, naming any row no procedure could be written for.

## Notes

(filled as the work lands)
