# RFCT-319 The docker-and-git experiment becomes a gate

- **status**: completed
- **priority**: P1
- **owner**: build-policy/bkd-wbjpfjv3
- **createdAt**: 2026-09-05 10:00
- **relatedPlan**: [PLAN-080](../plan/PLAN-080.md)

## Description

PLAN-080 §9 named this as its own largest risk, in its own words: **§4 was run
by hand and nothing re-runs it. The next path that requires a host tool will
pass every check in §6 and break the criterion silently, exactly as the
documented-but-unrunnable gate did.** Backlog **B6**.

The criterion is that a host with only Docker and git — plus the orchestration
§0.0 permits, `bash`, `make` and a busybox userland — builds and releases an
image. §4 climbed that ladder once, by hand, inside `IMAGE_DOCKER_CLI_28`, and
reached `PASS (313/313)` on an assembled x64 image. Until this task the record
of that climb was a date.

`make os-bare-host-gate` is the climb on demand. It is not a description of a
constrained host: it clones `HEAD` into the pinned image §4 used and runs there.

## ActiveForm

Turning PLAN-080 §4's hand-run ladder into a gate that fails loudly.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Acceptance

- The gate runs inside `IMAGE_DOCKER_CLI_28`, not on this host with a stripped
  `PATH`, and the surface it runs on is measured rather than described.
- A new host dependency turns it red **naming the tool and the file**, not just
  reporting a broken build.
- The ceiling is decided honestly and written down: which rungs it climbs, and
  what the ones it does not climb stop covering.
- §8's `--build-rootfs` gap (B5) is not quietly lifted.

## Notes

**The ceiling is rung 3, and the reason is the one PLAN-080 §10 predicted.**
Rung 4 assembles an image, which needs the amd64 package pool and a composed
rootfs; a fresh clone has neither and making them costs tens of minutes. So the
gate climbs:

| Rung | What runs | Where |
| --- | --- | --- |
| 0 | the substrate control | the pinned image, untouched |
| 1 | `bash docs/verify-index.sh` | + `bash` and `make` |
| 2 | `make docs-verify`, `make os-host-toolchain-lint` | same |
| 3 | `make os-layout-lint`, `make os-verify-test` | same, bun from its pin |

and it does **not** climb rung 4, does **not** run `os-build-test`, and does
**not** lift `--build-rootfs`'s `buildx` refusal — that is still B5. A host tool
reachable only from the assembly path is therefore caught by §6's static shape
and not by this gate's execution, which is why the gate runs that lint from
inside itself at rung 2.

**Two things keep it from being a re-run of §4.**

*The substrate is measured.* `substrate.sh` runs in the image before anything is
added and requires §0.0's permitted set to be present and `bash` and `make` to
be **absent** — §4.2's `sh: bash: not found` asserted rather than remembered, so
a pin that moved to a fatter image fails the ladder's premise instead of quietly
weakening it. After `apk add --no-cache bash make`, `ladder.sh` requires every
producer in `tests/host-toolchain-lint.sh`'s table to still be unreachable. That
table is read with the new `--print-tools` flag rather than copied: one table,
two readers, so a row added to the lint is a row this gate checks.

*A red rung is diagnosed.* Four failure signatures, measured inside the image on
2026-09-05 rather than recalled — bash's `<file>: line N: <tool>: command not
found`, busybox's `not found`, make's `<tool>: No such file or directory`, and
this tree's own `error: <tool> is required and not on PATH` — yield the tool.
The file comes from the message where the shell put it there, and from a
command-position grep in the shape the lint uses where it did not. The failure
then reads as one invocation, with the two ways out named: containerise it, or
widen §0.0's permitted set, which is a decision that leaves a record.

**Owed, and not done here.** There is no negative test. `tests/host-toolchain-
lint-test.sh` plants a defect per case and requires its own message back, and
this gate deserves the same: a planted host-tool need at each rung, required to
turn it red naming that tool and that file. The diagnosis was driven red by hand
against a mutated clone (see the report) but nothing re-runs that, which is the
same shape of debt B6 existed to pay off one level up.
