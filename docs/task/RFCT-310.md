# RFCT-310 Write the global build policy and make it enforceable

- **status**: implementing
- **priority**: P1
- **owner**: build-policy/bkd-e81lsy1j
- **createdAt**: 2026-09-04 21:30
- **relatedPlan**: [PLAN-080](../plan/PLAN-080.md)

## Description

`docs/design/build.md` already opens by claiming that "no toolchain is
installed on the host, and every compiler comes out of a builder image pinned
by digest". Nothing enforces it, the tree does not say which side `make` is on,
and an enumeration of the build surfaces finds 27 host-side producer
invocations that contradict the claim.

The user asked for the policy written down and made enforceable: **no toolchain
on the host, no compilation on the host, no assembly on the host** — with a
boundary a reader can apply to a tool nobody listed, an enumeration in which
every path is closed, refused or exempted with its reason, and a check that
fails.

PLAN-080 settles the boundary (§2), the enumeration of 66 sites in 25 files
(§3), the check and its controls (§4), the documentation placement (§5), the
measured cost (§6) and a backlog of four items that stay out (§8).

## ActiveForm

Writing the policy into `docs/design/build.md` §0, closing the three host
seams, declaring the container-side sites, and landing
`tests/host-toolchain-lint.sh` with its negative test.

## Dependencies

- **blocked by**: (none)
- **relates to**: RFCT-309 (the derived Rust image). It is the same policy
  applied to one gate: PLAN-080 §3.3 exempts `pkgs/mosd/hack/check.sh` and
  `pkgs/rauc-sign/hack/check.sh` until that image exists, and those two
  exemptions are its acceptance criterion. Both touch `build-env/` and
  `docs/design/build-harness.md`; resolved as a union.

## Acceptance

1. `docs/design/build.md` carries the rule in the imperative, the boundary test,
   and the exemptions with their reasons; `docs/zh/design/build.md` mirrors it;
   `docs/design/build-harness.md` points at it.
2. `tests/host-toolchain-lint.sh` is green on the tree, has a positive control
   for every way it could pass over nothing, and is wired as
   `make os-host-toolchain-lint` and into CI.
3. `tests/host-toolchain-lint-test.sh` plants a host invocation, a stale
   exemption, a removed declaration, an unclosed block and a heredoc named in a
   comment, and requires each to turn the lint red with its own message — and
   requires a producer inside a declared container block to stay green.
4. The three seams of PLAN-080 §3.2 are closed: `Toolbox.open` is container-only
   and refuses a host route by name, `mke2fsCanWriteTheseLayouts` is gone with
   the route it guarded, and `verify`'s `chooseRoute` defaults to the container.
5. `(cd verify && bun test)`, `(cd build && bun test)` and `make docs-verify`
   are green.
6. A composed x64 image is assembled and `bash verify/run.sh --verify --board
   x64` is green, because this touches the assembly path and that is the only
   gate that sees it.

## Notes

Measured cost, for the record PLAN-080 §6 asks for:

- Before, this host, 2026-09-04:
  `bash build/run.sh src/toolbox.test.ts src/toolsets.test.ts` → 35 tests,
  **118.15 s**.
- After, same command, same host: 36 tests, **116.62 s**. The two `COREUTILS`
  opens that moved from the host route to a container are predicted at ~4.6 s
  each by `build/src/testing.ts`, and they do not show: one run each, on a host
  whose container creation that file measures at anywhere from 320 ms to 101 s.
  No production path was taking the host route, so nothing outside this test
  file paid anything.
- The cost did show once, and where `build/src/testing.ts` said it would. That
  file records the ~4.6 s coreutils open as "the one that matters: it is UNDER
  the default and it flaked against it". One case in `toolbox.test.ts` opened
  a COREUTILS toolbox without a timeout override, and the first full suite run
  after the policy landed failed it at exactly 5000.80 ms. It carries
  `OPEN_TIMEOUT_MS` now, with the reason at the site.
