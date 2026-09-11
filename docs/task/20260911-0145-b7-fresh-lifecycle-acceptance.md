# 20260911-0145-b7-fresh-lifecycle-acceptance B7 fresh lifecycle and rootfs acceptance

- **status**: in_progress
- **priority**: P1
- **owner**: bkd/75btxdqb
- **createdAt**: 2026-09-11 01:45

## Description

Prepare the current native shutdown and release acceptance callers, then execute
fresh x64 and virt-arm64 lifecycle/rootfs acceptance from one reviewed integrated
source after each exact L2 job allocation. Carry the two serial equal-input
virt-arm64 cold root comparisons and the distinct pending runtime/board rows.

## ActiveForm

Preparing and verifying the B7 acceptance checkpoint.

## Dependencies

- **blocked by**: final integrated source and exact L2 milestone job allocation
- **blocks**: L2 B final acceptance and D historical reconciliation

## Notes

- Campaign: `mos-open-plans-20260910-100408`; issue: `75btxdqb`;
  coordinator: `8t4ghqi6`.
- The user explicitly approved this full-tier bounded proposal and scoped local
  commits. The current START DISPATCH authorizes source/fixture work now;
  expensive jobs require a named L2 allocation under the existing L1 grant.
- Startup: clean `bkd/75btxdqb` at
  `5d0dca577a782aa707d9530779c4b23f2a7eda31`; local L2 ref exactly
  `ebdd7208f3c026c96e08d003d9d4f383c22f1eb9`, tree
  `4c1e47337dc6e9787864a31dfbcd570aef21e4f5`. Authorized no-ff merge:
  `c39234c6e3e6810de3bae85d4bfef5a26916a159`, same tree. Approved #313
  and `deef0850dbd468f5423d3bb45c7e39e819dc9470` ancestry checks passed.
- Compatibility, migration, old images and old payload fallbacks are excluded.
- Only this task/plan and their index rows are owned here. Global/historical
  status and changelog reconciliation belongs to D. Physical board evidence
  belongs to A. Initial preparation uses no expensive job.

## Caller checkpoint

The three acceptance CLIs now require a final `MOS_SHUTDOWN` argument and pass
its resolved path to the existing `KernelInputs.shutdown` contract. The six
direct shell callers pass the same explicit argument. No inferred sibling file,
old-payload fallback, production source, board layout or C-owned file is changed.
No release-assemble caller exists in the scoped acceptance directories; the
mandatory release report/selected manifest interface is retained in the plan.
B6's completed BusyBox startup fixture is unchanged.

The new isolated Bun regression invokes each real CLI in a separate process,
replacing only Toolbox execution and expensive kernel packing. The intercepted
packing boundary calls the real `kernelExecutables` validator and records both
exact hashes. Factory callers cover both boards, update callers cover x64 kernel
and virt-arm64 combined updates, and rotation covers its existing x64 scope.
Missing helper arguments and foreign-architecture helpers refuse. Synthetic ELF
headers exercise the production validator, not native execution or signed boot.

- Initial `native-red` exited 1, including a fixture setup error:
  `SyntaxError: Export named 'ToolError' not found in module` (the Toolbox mock
  omitted an existing export). That log is preserved and is not the valid RED.
- After preserving Toolbox's original exports, `native-red-valid` exited 1:
  15 failed tests, all reaching `Missing required native lifecycle input`
  instead of the expected argument/architecture contract. Source callers had
  not yet been changed.
- `native-green` and `native-pinned` each passed 15 tests and 60 assertions.
  The latter uses the existing `tests/file-ab-x64/bun.sh` pinned container route.
- The standalone TypeScript check covers all three callers and both new test
  files; the build package's default include does not cover these files.

## Verification evidence

Every command ran with an explicit timeout in persistent-shell tmux
`75btxdqb-7e0f1b`. Per-command source commit/tree, working-file hashes, UTC start
and finish, exit code, log path and log SHA-256 are in
`/tmp/mos-b7-gates.D4K7zn/<gate>.json`. Aggregate metadata:
`/tmp/mos-b7-gates.D4K7zn/checkpoint-gates.json`, SHA-256
`4088e05f85f213518d0deecb2e6e10e8254fa2321e7770a40def750825a7c6de`.
The tested production base is merge `c39234c6e3e6810de3bae85d4bfef5a26916a159`;
exact uncommitted caller/test bytes are identified by those records.

| Command | Result / boundary |
| --- | --- |
| `timeout 120 bun test tests/file-ab-x64/native-input.test.ts` | RED 15 failures; GREEN 15 tests / 60 assertions |
| `timeout 120 bash tests/file-ab-x64/bun.sh test tests/file-ab-x64/native-input.test.ts` | Exit 0; pinned-container 15 tests / 60 assertions |
| `timeout 120 bash build/run.sh src/kernel-payload.test.ts` | Exit 0; typecheck, nonzero-test guard, 2 tests / 15 assertions |
| `timeout 120 bash tests/file-ab-x64/shutdown-check-test.sh` | Exit 0; ordered log positive and nine refusal mutations; external action proof pending |
| `timeout 120 bash tests/boot-busybox-package-test.sh` | Exit 0 for source/synthetic fixtures; actual x64 and aa64 payload checks explicitly skipped because no built payload was supplied |
| `timeout 120 bash tests/boot-shutdown-test.sh` | Exit 101; fresh worktree offline Cargo registry missing `anyhow`; no retry or offline bypass |
| `timeout 120 bash tests/rootfs-runtime-test.sh` | Exit 0; 80 tests, no skips, `ROOTFS_REPRODUCIBILITY_PASS` |
| `timeout 120 make os-rootfs-manifest-test` | Exit 0; 46 checks, 22 packages, 257 resolutions, six distinct refusals |
| `timeout 120 make os-host-toolchain-lint` | Exit 0; 418 tracked files clean; new files checked again after staging |
| `timeout 120 make os-shell-pipefail-lint` | Exit 2; only the accepted unrelated UI baseline, 160/161 files clean |
| `timeout 120 make docs-verify` | Exit 0; index 195, links 510, status 724, translations 249, board checks 131 |
| `timeout 30 bash -c 'for path in tests/file-ab-x64/{runtime-build,reset,large-root,updates,acquisition,early-hang}.sh; do bash -n "$path" || exit; done'` | Exit 0 |
| `timeout 120 build/node_modules/.bin/tsc --noEmit --strict --skipLibCheck --target ESNext --module Preserve --moduleResolution bundler --allowImportingTsExtensions --types bun --typeRoots build/node_modules/@types tests/file-ab-x64/native-input.test.ts tests/file-ab-x64/native-input.preload.ts tests/file-ab-x64/build.ts tests/file-ab-x64/update.ts tests/file-ab-x64/trust-rotation.ts` | Exit 0 |
| `timeout 30 git diff --check` | Exit 0 |

The required Rust failure is preserved verbatim:

```text
error: no matching package named `anyhow` found
location searched: crates.io index
required by package `mos-deploy v0.1.0 (/src/pkgs/mos-deploy)`
note: offline mode (via `--offline`) can sometimes cause surprising resolution failures
help: if this error is too confusing you may wish to retry without `--offline`
```

The unchanged accepted shell baseline is preserved verbatim:

```text
FAIL: pkgs/mosd/apid/ui/verify-ui-policy.sh:82: an early-exiting grep on the right of a pipe, in a file that sets pipefail: the pipeline reports failure when the pattern IS found. Use 'grep -c ... >/dev/null'
RESULT: FAIL (160/161 files clean, 161 scanned)
make: *** [Makefile:350: os-shell-pipefail-lint] Error 1
```

The BusyBox gate explicitly prints both unfulfilled artifact rows:

```text
SKIP: MOS_BOOT_BUSYBOX_X64 is unset; no built x64 payload was supplied
SKIP: MOS_BOOT_BUSYBOX_AA64 is unset; no built aa64 payload was supplied
```

There is no aggregate acceptance PASS. Final-source `make os-build-test`,
`make os-verify-test`, `make os-rust-gate`, package/install gates, actual executable
smoke, fresh images/guests/API phases and the cold comparison remain unexecuted.
The package gate contains rebuilds; the install gate builds roots. They cannot
run as a cheap source checkpoint or against a missing pool. No successful full
upstream suite was replayed merely to receive its source.

## Review and handoff state

PMA-CR local review compares only this checkpoint against the approved merge,
including the complete new test/preload files and direct shell call chains.
Verdict: PASS, zero critical/high/medium/low introduced findings. Required-input
validation and native hashing remain owned by the production packer; tests do
not mock that validator. The layout/release-source conflicts below are existing
input blockers, not defects introduced by the caller change.

This is a partial checkpoint for L2 review and integration. The task remains
serializer-owned `in_progress`, and the plan remains `implementing`; neither the
fresh milestone nor any old/global record is completed. No detached gate,
expensive job, physical disk write, main merge, push, publication or issue status
transition is part of this checkpoint. L2 must supply the final reviewed local
HEAD and exact named jobs after addressing the plan's prerequisites.

## Approved continuation

The 2026-09-11 L1 decision relayed by L2 authorizes the exact geometry invariant,
non-publication artifact test consumer and bounded private environment preparation
listed in the plan's approved-continuation section. The previous pending policy
decisions are resolved by that scope; the original negative logs remain valid
pre-fix evidence. The caller checkpoint `64387f20d29405fa34790670b2e68e76593abb0b`
remains unchanged. Startup of this continuation verified its branch and clean
status. The same serializer-owned task stays in progress; no new node or grant.

## Geometry and environment continuation evidence

The approved geometry is implemented: only the two authorized assignments in
x64/virt-arm64 board.env, one exact 1 GiB parsed SYSTEM invariant, and the
shared-DATA corruption offset in `tests/file-ab-x64/faults.sh` changed.
CX/S905 board source and all reserves remain unchanged.

Metadata and full logs: `/tmp/mos-b7-continuation.hEaedH/<gate>.{json,log}`;
source is caller commit `64387f20d29405fa34790670b2e68e76593abb0b` plus the
recorded working-file hashes. Persistent shell: `75btxdqb-7e0f1b`.

| Gate | Exact command / result |
| --- | --- |
| geometry-red | `timeout 180 bash build/run.sh src/file-layout.test.ts`; exit 1, 9 pass / 9 fail. Wrong real geometry and contiguous smaller/larger layouts reached the new assertions. |
| geometry-green | Same command; exit 0, typecheck / nonzero guard, 18 tests / 92 assertions. Four current boards, both backends and raw/ext4 reserve boundaries remain covered. |
| geometry-callers | `timeout 180 bash build/run.sh src/fit-environment.test.ts src/tools/sgdisk.test.ts`; exit 0. |
| geometry-static | `timeout 120 make os-layout-lint && timeout 30 bash -n tests/file-ab-x64/faults.sh && timeout 30 git diff --check`; exit 0. |
| cargo-fetch | `timeout 310 bash /tmp/mos-b7-continuation.hEaedH/cargo-fetch.sh`; exit 0, one timeout-300 fetch in the unchanged pinned image with only owned registry/git caches writable. |
| shutdown-offline-recheck | Original `timeout 120 bash tests/boot-shutdown-test.sh`; exit 0, `BOOT_SHUTDOWN_FIXTURES_PASS`. No script, lock, offline assertion or toolchain change. This is software fixture evidence. |
| arm64-probe | `timeout 90 bash /tmp/mos-b7-continuation.hEaedH/arm64-probe.sh`; actual fixed target-command launch exited 255: `exec /bin/sh: exec format error`. No mounts/devices or host/builder mutation; no execution retry. |

Rust lock SHA-256: `816a21311421587b088bc65239c1489998db43421e458d2f163a180af13a049e`;
resolved runner `localhost/mos-build-rust-check:amd64`, actual image
`sha256:f962663a6b90735118eb2ce954d3a457e1ba784b023fc346469927b5ecc3f0a1`.
The original missing-anyhow exit 101 log stays environment failure evidence,
not behavior RED. Source/lock remain unchanged after the authorized fetch.

ARM64 requested platform was `linux/arm64` with source-pinned Debian index
`sha256:d7e12182ce18b85b93007c1dedf31f2d29e01ccf3182cc4017c709b6259bc132`.
The program never started, so expected ARM64 executable execution is not proved.
The local Docker client rejects image-inspect `--platform` (`unknown flag:
--platform`); ordinary image inspection reports amd64 and is not ARM64 image
identity proof. Preserve that distinction from the requested run platform.
BuildKit container image remains
`sha256:28a898719c18a33f4e8000685287fa36fd0dd9560c6440227d3a732d79bb41d8`;
`mos-arm64` advertises amd64/386 and has no configured CPU/memory cap.
A verified working ARM64 route and bounded job allocation remain L2 inputs.

PMA-CR geometry review: PASS; zero introduced findings across correctness,
firmware protection, trust, data integrity and test meaningfulness. Only the
approved assignments/invariant and necessary DATA fixture offset changed.

## Non-publication acceptance checkpoint

Geometry was separately committed as
`5ead205523bdeb6a8cf0cb8dc9c35b2c9f47d56d` (tree
`4b1ece458af066a872f8c31744de5aa766a29e24`). Geometry docs-verify also passed;
its dependent fit/sgdisk tests passed 21 tests / 107 assertions.

The new test consumer at `tests/file-ab-x64/provenance-acceptance.ts` enforces
virt-arm64/development/dev, fresh output and sibling evidence, actual clean
checkout identity, frozen builder declarations and byte-identical committed
board evidence. It calls the complete unchanged typed assemble/gate functions.
The existing harness invocation and exact input contract are in the plan.
The CLI has no source/checkout override; regression checkout injection is confined
to the exported test function. The external record binds source, all artifact
hashes, manifest hash and metadata public-key fingerprints without qualifying
publication, runtime or hardware behavior.

`build/src/release-manifest.test.ts` now produces an ARM64 selector/composition
fixture and signs matching small update/firmware byte objects. The same candidate
passes low-level checks and is refused by normal release CLI assemble and gate.
False source, dirty checkout, channel/profile widening, changed builder/board
evidence and existing evidence refuse. Runtime, provenance, signed firmware,
evidence and update tampering refuse even after outer digest repinning; changed
factory-image bytes refuse against the recorded digest. All objects are synthetic
fixtures, never final-image evidence.

| Gate | Exact command / result |
| --- | --- |
| provenance-red | `timeout 180 bash build/run.sh src/release-manifest.test.ts -t non-publication`; exit 1. The initial fixture used `arch` instead of the actual `architecture` field, causing one schema-error assertion mismatch; preserve it separately from behavior failures. |
| provenance-red-valid | Same command before consumer guards/entry implementation; exit 1, 1 pass / 2 fail. Valid signed candidate accepted a false source commit and emitted no required non-publication result. Fixture tamper checks already passed. |
| provenance-green | Same command; exit 0, typecheck / nonzero guard, 3 tests / 45 assertions. The explicitly selected filter excludes 48 other tests. |
| release-regression | `timeout 300 bash build/run.sh src/release-manifest.test.ts`; exit 0, complete release test file, 51 tests / 224 assertions, no test filter. No full build matrix replay. |
| provenance-pinned | `timeout 180 bash tests/file-ab-x64/bun.sh test build/src/release-manifest.test.ts -t non-publication`; exit 1 before acceptance: all three tests reach the shared Python runtime fixture and receive `Expected: 0`, `Received: undefined` from spawn status. This is not an acceptance pass or a behavior RED. |

All logs and per-command source/tree/working-file/UTC/exit/hash metadata remain
under `/tmp/mos-b7-continuation.hEaedH`. The initial and corrected RED records are
retained separately. The pinned fixture prerequisite is investigated with a
read-only executable lookup and the consumer's no-input CLI refusal; no image or
global toolchain is modified. The successful host regression is reported
separately from the pinned fixture environment failure.

PMA-CR acceptance review: PASS; zero introduced correctness/security/integrity/
lifecycle findings. Source identity, signatures, strict production schemas and
publication policy stay intact. Frozen package/input provenance and actual
SquashFS/OCI/image/guest verification remain independent obligations.

Readiness stays partial: both indexed pools and final artifact inputs are absent,
ARM64 program execution failed, and no exact final-source/job allocation exists.
The original UI shell baseline failure is retained unchanged; prior caller,
rootfs selection, layout and offline shutdown checks are not replayed for status.
No heavy job, new source import, physical operation, main/push/done or historical
status update was performed. Keep this task/plan active until the existing
acceptance milestone is actually complete; final task closure uses the serializer.

The pinned prerequisite probe confirms the exact cause:
`Executable not found in $PATH: "python3"` (`ENOENT`), with Bun 1.4.0.
The actual consumer entry loads through `tests/file-ab-x64/bun.sh` and its
missing-input control exits 1 with the required usage message. That command
exits 0 only because it asserts the refusal; it does not turn the failed Python
fixture suite into a pass. The standalone artifact consumer has no Python runtime
dependency. A pinned route for the existing Python composition fixture remains
an environment prerequisite if L2 requires that suite in the Bun image; no Python
or other toolchain was installed there.

| Review severity | Introduced findings |
| --- | --- |
| CRITICAL | 0 |
| HIGH | 0 |
| MEDIUM | 0 |
| LOW | 0 |

Verdict: PASS for the scoped diff. Reported environment and future artifact rows
remain partial and are not waived by this review.
