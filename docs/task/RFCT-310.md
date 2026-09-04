# RFCT-310 A host with only Docker and git builds and releases an image

- **status**: implementing
- **priority**: P1
- **owner**: build-policy/bkd-e81lsy1j
- **createdAt**: 2026-09-04 21:30
- **relatedPlan**: [PLAN-080](../plan/PLAN-080.md)

## Description

`docs/design/build.md` already opened by claiming that "no toolchain is
installed on the host, and every compiler comes out of a builder image pinned
by digest". Nothing enforced it, the tree did not say which side a given tool
was on, and nobody had ever run the claim.

The user asked for the policy written down and made enforceable, and gave the
acceptance criterion to write it against: **a host with only Docker and git must
be able to build and release an image, completely.** That is stronger than the
prohibition — it is falsifiable by one experiment, it stays true as producers
arrive, and it settles the `bun`/`node` question by determining that the host
route may exist while the container route must be sufficient on its own.

PLAN-080 settles the criterion and its permitted set (§1, including the `make`
ruling), the rule that follows (§2), the boundary test (§3), the experiment run
in a `docker`+`git` container (§4), the enumeration of every producer (§5), the
check with both finding shapes (§6), the documentation (§7), the measured cost
(§8) and a backlog of six items that stay out (§10).

## ActiveForm

Writing the criterion into `docs/design/build.md` §0, closing the four host
seams, declaring the container-side sites, and landing
`tests/host-toolchain-lint.sh` with its negative test.

## Dependencies

- **blocked by**: (none)
- **relates to**: RFCT-309 (the derived Rust image), which **landed on `main`
  while this task was finishing**. `tests/rust-gate.sh` and `make os-rust-gate`
  run both `hack/check.sh` unmodified inside `localhost/mos-build-rust-check` —
  both workspaces, which is more than its brief named and is the second half
  PLAN-080 §5.5 asked for. So the one path with no container is closed. The four
  exemption rows stay, for a different reason now: CI still runs the same
  scripts on its runner (PLAN-080 backlog **B7**). `tests/rust-gate.sh` passes
  this task's check unmodified — two workstreams, one policy, no negotiation.

## Acceptance

1. `docs/design/build.md` §0 leads with the criterion, states what the host is
   allowed to have and why, carries the boundary test and the exemptions with
   their reasons; `docs/zh/design/build.md` mirrors it;
   `docs/design/build-harness.md` points at it.
2. The experiment is run, not simulated, and its transcript is in PLAN-080 §4
   with every rung's command and result.
3. Every producer in the tree is named in PLAN-080 §5.2 with the line that runs
   its container, read rather than assumed.
4. `tests/host-toolchain-lint.sh` is green, finds both shapes, has a positive
   control for every way it could pass over nothing, and is wired as `make
   os-host-toolchain-lint` and into CI.
5. `tests/host-toolchain-lint-test.sh` plants a host invocation, a `$HOME` PATH
   prepend, a stale exemption, a removed declaration, an unclosed block and a
   heredoc named in a comment, and requires each to turn the lint red with its
   own message — and requires three legitimate shapes to stay green.
6. The four seams of PLAN-080 §5.4 are closed.
7. `(cd verify && bun test)`, `(cd build && bun test)` and `make docs-verify`
   are green.
8. A composed x64 image is assembled and `bash verify/run.sh --verify --board
   x64` is green, because this touches the assembly path and that is the only
   gate that sees it.

## Notes

**The gap the criterion found and the prohibition would not have.**
`build/run.sh` passed the host's docker client into the pinned bun container
with `-v "${DOCKER}:${DOCKER}:ro"`. A sibling container's `-v` source is
resolved by the *daemon*, so on a host whose client is at a path the daemon's
filesystem does not have — every host that is itself a container — docker
created an empty directory there and mounted it. The preflight written to catch
exactly that failure could not see it: it tests `[ -e "$f" ]`, and `-e` is true
for a directory, as is `-x`. Fixed by using the pinned client through
`verify/Dockerfile`, which is what `verify/run.sh` already did.

**Measured cost.**

- Before, this host, 2026-09-04:
  `bash build/run.sh src/toolbox.test.ts src/toolsets.test.ts` → 35 tests,
  **118.15 s**. After: 36 tests, **116.62 s**. The two `COREUTILS` opens that
  moved from the host route to a container are predicted at ~4.6 s each by
  `build/src/testing.ts` and do not show: one run each, on a host whose
  container creation that file measures at anywhere from 320 ms to 101 s.
- The cost did show once, where that file said it would. One case in
  `toolbox.test.ts` opened a COREUTILS toolbox with no timeout override and the
  first full suite run after the change failed it at exactly 5000.80 ms. It
  carries `OPEN_TIMEOUT_MS` now, with the reason at the site.
- `tools/dd.test.ts` compared the host and container routes for the same
  toolset. With one route that pair is a tautology, so it compares two
  *toolsets* in the same image instead — which is the comparison the
  byte-identity gates actually rest on.
