# RFCT-348 Write the cx3576 bench test plan and its collection script

- **status**: completed
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

### Delivered

- `docs/bsp/cx3576-bench.md` — twelve ordered stages, each naming what it
  assumes of the previous one; a per-row scriptable/human split with a pass
  criterion; the power-cut window as three named cuts; U10 scoped to the half
  no seam retires; the off-hardware predictions the session falsifies; and a
  section stating exactly what the dry run did and did not reach.
- `docs/bsp/cx3576-bench-collect.sh` — bash-only, no `jq`, self-contained,
  needs nothing from this repository. Twelve stages plus `report`, which prints
  the dossier's thirteen rows in its own column order.
- Index rows in `docs/README.md` and a `not-translated` coverage row in
  `docs/zh/README.md`.

### Every row got a procedure

No row was left without one. Two are narrower than the matrix implies, and the
page says so at the row rather than in a footnote:

- **Watchdog/reset cause.** The second half — "the reset cause is readable
  afterwards" — may have no source on this kernel: `# CONFIG_WATCHDOG_SYSFS is
  not set` gates the `bootstatus` attribute. The procedure reads it when
  present and records its absence as the finding, and says that a row whose
  first half passes and whose second half has no source is a `fail`, not a
  `pass`, because the row claims both.
- **"Which UART drives the display"** (Gate D's third measurement) does not
  resolve as written: the dossier records the display as HDMI and no UART
  drives an HDMI output. It is specified as the `ttySn` ↔ `of_node` ↔
  register-address map read from the running kernel, plus an operator answer
  naming what each mapped port is wired to and whether a serial display module
  exists at all. Either answer closes it; a blank does not.

### Off-hardware findings that sharpened the procedure

Read out of the tree while writing it, each with the command that settles it on
the bench:

- **The shipped kernel builds no RTC driver.** All 76 `CONFIG_RTC_DRV_*` lines
  are `is not set`, `CONFIG_RTC_DRV_HYM8563` included, while `CONFIG_RTC_CLASS`,
  `CONFIG_RTC_HCTOSYS` and `CONFIG_RTC_HCTOSYS_DEVICE="rtc0"` are set and the
  DTS declares an AT8563 at `i2c7` `0x51`.
- **And that predicts a radio failure.** The DTS gives `/sdio-pwrseq`
  `clocks = <&at8563>` and `CONFIG_PWRSEQ_SIMPLE=y` is built, so a clock
  provider that never registers defers the SDIO host the AIC8800D80 sits
  behind. Stage `network` is where that is confirmed or killed.
- The watchdog node is `okay` and `CONFIG_DW_WATCHDOG=y`, so a missing
  `/dev/watchdog0` is a defect to report rather than an absence to accept.

### The tool inventory, measured rather than assumed

Listed off the composed arm64 root (`_out/cx3576/factory-root.oci`, exported
and listed, not executed). It confirmed the brief's inventory and added three:
**`hwclock`, `cansend` and `candump` are also absent**, and busybox ships as
`/usr/bin/busybox` with no applet links. Row 7's CAN traffic is therefore
driven from the peer node and observed through `ip -details -statistics`.

### The dry run

Not on cx3576, which is not here. `virt-arm64` has no assembled image in this
checkout and building one would have meant composing an arm64 root against the
shared `_out` pool while two other tasks were running against it, so the
collector was exercised on what does exist:

- **Every stage ran, in order, inside a composed mos root.** The ordering gate
  refused three stages by name — `powercut` because `update` recorded no slot,
  then `storagefill` and `recovery` on their own assumptions.
- **All three operator branches ran over a real pty** (`script -q -e -c`):
  `pass` and `fail` produced dated rows carrying the operator's verbatim note,
  an unrecognised verdict was re-asked, and `skip` produced `not tested`.
- **The rendered table was spliced into a copy of `cx3576-example.md` and put
  through the real `verify-board.sh`**, which accepted it — 100/100 — and,
  with one row deliberately changed to a `pass` with no date, rejected it. The
  collector's output is pasteable into the dossier as a measurement rather than
  an intention.
- **Two real bugs were found by running it**, both of the same shape:
  `basename "$(readlink -f X)"` returns empty for a missing link and returns
  the path itself for a non-link, so an absent driver was reported as an empty
  field and thirty-two x86 `ttyS` ports each claimed an `of_node` that does not
  exist. Fixed with a `linktarget`/`linkname` pair that says `none`.
- **Not reached:** anything needing a running A/B system — the bundle cycle,
  the boot-credit arithmetic, the watchdog reset, the thermal load, the power
  cuts. Stages `thermal` through `recovery` are syntax- and refusal-checked,
  not outcome-checked, and section 9 of the page says so.

### Gates

- `make docs-verify` from a `git archive` of HEAD into an empty directory:
  192/192, 488/488, 749/749, 243/243, 97/97 — all five green.
- `make docs-verify-test` 9/9; `bash tests/shell-pipefail-lint.sh` 91/91.
- `bash -n` on the collector.

### Out of scope, as briefed

Filling the dossier's rows (that is the bench session's output), the arm64
verification debt, and the I1–I4 assurance level.
