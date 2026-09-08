# RFCT-347 PLAN-080's last three backlog items, and the suites RFCT-318 left owed

- **status**: completed
- **priority**: P2
- **owner**: bkd/ns1wwmdt
- **createdAt**: 2026-09-07 22:10
- **relatedPlans**: [PLAN-080](../plan/PLAN-080.md) backlog B4, B5 and B7

> The index line in `docs/task/index.md` is written by L1, not by this task.

## Description

`docs/plan/PLAN-080.md` section 10 left seven backlog items. B1, B2, B3 and B6
are closed. This task takes the remaining three, and discharges the two debts
RFCT-318 recorded against its own closure of B2 and B3.

- **B4 — extend the scan past shell.** The four toolbox seams are closed in code
  and nothing stops a fifth from being written. `tests/host-toolchain-lint.sh`
  reads shell, `Makefile`s and workflows; `build/src` and `verify/src` are
  TypeScript and were held only by those packages' own suites.
- **B5 — buildx in the pinned bun image.** `verify/Dockerfile` copied the docker
  client out of `IMAGE_DOCKER_CLI_28` and not the buildx plugin beside it, so
  `build/run.sh --build-rootfs` refused the container route outright. The plan
  priced this as "one `COPY` … plus the run that proves it — which needs the
  amd64 package pool", and said most of the day is the proof.
- **B7 — CI stops installing a host toolchain.** `.github/workflows/check.yml`
  curled rustup onto the runner and ran both `hack/check.sh` there.
  `tests/rust-gate.sh` already runs those two scripts **unmodified** inside
  `localhost/mos-build-rust-check`; CI was the last caller choosing the host,
  and the last thing holding five rows in `tests/host-toolchain-exemptions`
  open.
- **The two debts.** RFCT-318 moved the RAUC signer's extensions from a `<(…)`
  process substitution to a real file, because a `/dev/fd` path belongs to the
  calling shell and the container cannot see it — and then recorded *"The two
  trust tests were NOT re-run — owed"* and *"Neither suite was run — owed"*.
  Nothing had driven that shape since.

## ActiveForm

Closing PLAN-080's B4, B5 and B7, and running the four suites RFCT-318 left owed

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Acceptance

- B4: a check over the TypeScript surface, with a positive control that goes
  red, a negative that stays green, and a reported count of call sites
  examined. Not a rule against `` $` ``.
- B5: the `COPY`, the refusal lifted, and a rootfs that actually composed on the
  container route. The rung reached is named, and so is what stops the next one.
- B7: CI running both `hack/check.sh` through `tests/rust-gate.sh`, and the
  exemption rows removed — the lint refuses a rule that matches nothing, so a
  stale row is itself a failure.
- The owed suites run, with their output quoted.
- `bash tests/host-toolchain-lint.sh` green, with the exempted count stated.
- `make docs-verify` green from a `git archive` into an empty directory.
- `docs/plan/index.md`, `docs/task/index.md` and `docs/changelog.md` untouched.

## Notes

The durable record is `docs/plan/PLAN-080.md` — section 4.4 for the rung, and
section 10's B3, B4, B5 and B7 bullets for the runs. What follows is what only
this task can say.

### What was run

| Check | Result |
| --- | --- |
| `bash tests/host-toolchain-lint.sh` | **green**. `347/347 files clean, 0 finding(s), 10983 shell command lines examined, 4167 elided, 35 TypeScript launch sites examined in 226 file(s) (19 naming a command, 16 through a variable), 19 file + 20 block container declarations, 2 exempted invocation(s) under 1 rule(s)` — from 15 exempted under 5 rules; the 2 that remain arrived with the merge and are not a build (see below) |
| `bash tests/host-toolchain-lint-test.sh` | **green**, `RESULT: PASS (23/23 cases)`, up from 15 |
| a fifth seam planted in `build/src/toolbox.ts` | **red at both call sites, by name**, and the RESULT line moved to `37 TypeScript launch sites … 21 naming a command` |
| the scanner under **busybox awk** in `IMAGE_ALPINE_3_21` | output identical to the host awk, which is what `tests/bare-host-gate/ladder.sh` needs |
| `bash tests/rust-gate.sh` | **green**, both workspaces in `localhost/mos-build-rust-check:amd64`, 1081 tests, ending `apid/openapi.json matches apid --openapi` |
| `bash tests/rauc-trust-negative-test.sh` | **green**, `RESULT: PASS (10 passed, 0 failed)` |
| `bash tests/trust-domain-hygiene-test.sh` | **green**, `RESULT: PASS (8 passed, 0 failed)` |
| `bash tests/repart-loader-test.sh` | **green**, `RESULT: PASS (13/13 checks)`, `sgdisk runs in … IMAGE_ALPINE_3_21` |
| `make os-build-test` | **green**, `RESULT: PASS (935/935 tests)` |
| `MOS_BUILD_CONTAINER=1 MOS_BOARD=x64 rootfs/build.sh` | **composed**, smoke `PASS (12 pass, of 12)` |
| `MOS_BUILD_CONTAINER=1 build/run.sh --mkimage-uefi --board x64` | **assembled 1938 MiB** |
| `verify/run.sh --verify --board x64`, host route and `MOS_VERIFY_CONTAINER=1` | **green both ways**, `PASS (315/315 checks, 22 skipped)` |
| `bash tests/shell-pipefail-lint.sh` | **green**, `90/90 files clean` |
| `make docs-verify` from a `git archive` into an empty directory | **green**, 1717 assertions across the five gates |

### A defect found and NOT fixed here: the Debian cache step hangs

`rootfs/debian/run.sh cache` sat for **ten minutes at 100% CPU with frozen
network I/O** on one pin —
`snapshot.debian.org/…/dbus-bin_1.16.2-2_amd64.deb` — and did not move.
`rootfs/debian/fetch.ts` budgets 180 s per attempt and three attempts through an
`AbortController`; **the abort never fired**, so the nine-minute ceiling that
file is supposed to have did not apply. The same URL answers from this host in
**0.26 s** (302 → 200, 80004 bytes), so the remote is not the cause.

This is the *class* of defect `fetch.ts`'s own header says it fixed on
2026-09-06 — "sat for EIGHT HOURS with an empty `.download.*` directory" — but
not the same instance: that one was an unbounded body stream, and one controller
covering both halves closed it. This one burns CPU inside `fetch`, where the
timer cannot run. It is pre-existing, it is outside this task, and it will stop
any cache population that reaches that pin.

**Worked around, and the workaround is disclosed rather than folded in.** The
cache is content-addressed: `run.sh` skips any pin already present as
`<sha256>.deb`, and verifies the digest after every download it does make. So
all 172 amd64 pins were placed there directly — 29 already present, 143 fetched
with `curl` on the host — **every one verified against the sha256 that is its
own filename**, staged and moved atomically. The compose then reported
`debian-base: verified 159 packages; downloaded 0 archives`. A file under its
own digest is indistinguishable from one the step fetched, which is what makes
this sound rather than a shortcut around the pin; it does mean the container
fetch path went unexercised by this run.

### The merge arrived red, and the two rows in the register are why

`main` at `f6c63613` **fails its own `tests/host-toolchain-lint.sh`** — measured
by running main's copy of the lint against a `git archive` of main, so this is
not something the TypeScript surface introduced:

```
FAIL: docs/bsp/cx3576-bench-collect.sh:497: `rauc` runs on the host.
FAIL: docs/bsp/cx3576-bench-collect.sh:1058: `rauc` runs on the host.
RESULT: FAIL (120/121 files clean, 2 finding(s), ...)
```

Neither is a policy violation. That file is a **device-side** qualification
collector — its own header says "IT NEEDS NOTHING FROM THE REPOSITORY" and lists
`rauc` among what a shipped root carries. Line 497 is `rauc status
--output-format=shell`, a read on the booted device; line 1058 is prose inside a
double-quoted argument, `"install the GOOD bundle (rauc install <bundle>), …"`,
where the `(` reads as a command separator to a scanner that does not track
quoting — a false positive, recorded as one.

Two register rows with that reasoning make this branch green. **Nothing in
`docs/bsp/` was edited**, so this cannot conflict with whichever task owns that
file. What was deliberately *not* done, because it is somebody's decision and
not this task's: give the lint a `mos-build-side: device` marker. A
`container` marker would be a false claim — the lint says at its own head that it
cannot check a declaration — and inventing a third grammar for one file is the
kind of rule nobody maintains.

### Inputs copied in rather than built

Named because none of them is this worktree's own product:

- `_out/boards/x64/kernel/` from `/srv/mos`. **Checked by content, not by date**:
  all **1700** `=y`/`=m` symbols that
  `boards/x64/bsp/kernel/config/x64.config` declares are honoured in the built
  `config`.
- `pkgs/podman/out-amd64` from `/srv/mos`, with
  `PODMAN_VERSIONS_SHA256=89c2b2b5…` equal to `versions-stamp.sh --digest` here.
- `pkgs/rauc/out-amd64` from `/srv/mos`.
- `_out/cx3576/cx3576-mos-1788800841.img` and its `rootfs-verity.img`, for the
  repart suite, which is cx3576-only and cannot be handed an image this worktree
  is able to build.

Nothing was written into `/srv/mos`.

### What is owed, and by whom

- **The CI change is unrun.** B7's own sizing predicted exactly this. What ran
  is the work the runner will do; the workflow file itself executes for the
  first time on the first push.
- **The `fetch.ts` hang above.** It has no task and no plan item yet.
- **arm64.** Everything here is amd64. The buildx `COPY` is
  architecture-neutral, and the image is `IMAGE_BUN_1` plus two static binaries,
  but no arm64 compose was run on the container route.
