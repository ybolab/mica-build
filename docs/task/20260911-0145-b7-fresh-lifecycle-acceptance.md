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
