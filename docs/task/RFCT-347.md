# RFCT-347 PLAN-080's last three backlog items, and the suites RFCT-318 left owed

- **status**: implementing
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
- `docs/plan/index.md`, `docs/task/index.md` and `docs/CHANGELOG.md` untouched.

## Notes

Filled in as the work lands; see PLAN-080 section 10 for the surviving record.
