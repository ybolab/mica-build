# 20260911-0145-b7-fresh-lifecycle-acceptance B7 fresh lifecycle and rootfs acceptance

- **status**: in_progress
- **priority**: P1
- **owner**: bkd/75btxdqb
- **createdAt**: 2026-09-11 01:45

## Description

Prepare the current native shutdown and release acceptance callers, then execute
fresh x64, virt-arm64 and CX3576 joint lifecycle/rootfs acceptance from one
reviewed integrated J after exact L2 job allocation and the one-time L1 joint
source review. Carry exactly two independent equal-input virt-arm64 cold roots
and the distinct pending runtime/physical-board rows. No new S905 image.

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

## Identity refinement and API inventory continuation

L2 approved one refined immutable-child ARM64 probe and read-only access to the
committed API suite/launcher call chain. Continue this existing claim and preserve
all prior commits and passed/failed gate evidence. No product edits, upstream
merge, actual API/guest operation or heavy job is authorized by this handoff.
The plan records the exact identity/cleanup boundary before execution.

## Refined ARM64 probe result

Evidence root: `/tmp/mos-b7-refinement.vaDgut`; software source remains
`178a1ee1d285221546127865517ac30829ef9e86`, tree
`3c932de591c777d98374c4e8e3d6e4a43bca7752`. The only working-file changes during
this probe are the two owned tracking records. Original continuation logs,
geometry/consumer commits and offline shutdown success are preserved unchanged.

The read-only pinned index/child byte SHA checks and actual stopped-container
inspection passed before execution. Index:
`sha256:d7e12182ce18b85b93007c1dedf31f2d29e01ccf3182cc4017c709b6259bc132`;
linux/arm64/v8 child manifest:
`sha256:7215f78f35ffe58fe13f244fac9c4f21326d55187271fbb3e1a8aa5cc7e387ab`;
config descriptor:
`sha256:7e3898f7b011a107d0ef7393d5f604a6e0c0ff05ac4f2476630a8af21059ec9b`.
The daemon's actual container/image ID maps to the child manifest, not the config
digest; both identities are explicitly recorded. Registry config architecture
and rootfs diff IDs match the inspected arm64 image. The saved inline config's
466 bytes were additionally checksummed after execution; that timestamp is kept
separate in `config-verification.json`.

Before starting the single owned container, only these harmless ELF files were
copied out and verified as ELF64 little-endian with e_machine=183:

| Executable | Bytes | SHA-256 |
| --- | --- | --- |
| `/usr/bin/dash` | 199256 | `367967c823a0c391e5049b15a67c6a0a629c88b9b6dcdca75ef13ac9d65334b1` |
| `/usr/bin/dpkg` | 396184 | `d8878dcd8949b2d18359b98082e18b2c3bb77f4cbe14e7a90f58b3fad2670e79` |

Container `ai-agent-b7-arm64-75btxdqb-vadgut`, ID
`44fc7b0f66d734c99eddc14334a20d3f9c54d7eabacb8d148fb7ced9d34e5d96`,
used the immutable child reference, ai-agent=true and traefik, no mounts/devices,
no privileged setting and no shared tag mutation. It was retained only to inspect
its exit state and removed afterward. The once-only executable argv was:
`/usr/bin/dash -ec 'uname -m; dpkg --print-architecture; test "$(dpkg
--print-architecture)" = arm64'` (the actual command is one line in metadata).

`timeout 30 docker start -a CONTAINER_ID` started at
2026-09-11T02:28:39.616972+00:00 and completed at
2026-09-11T02:28:39.831504+00:00, exit 255. Exact stderr:
`exec /usr/bin/dash: exec format error`. Docker state independently records
exited, Running=false, Pid=0, ExitCode=255 and OOMKilled=false. Removal exited 0
at 2026-09-11T02:28:40.057474+00:00. There was one execution attempt; no repetition,
forced-stop cleanup, host emulation, binfmt, device or shared-builder change.

The outer gates are `timeout 240 python3 /tmp/mos-b7-refinement.vaDgut/identity.py`
(exit 0) and `timeout 90 python3 /tmp/mos-b7-refinement.vaDgut/execute.py`
(exit 255), run in persistent shell `75btxdqb-7e0f1b`. Per-step exact argv,
source/UTC/log/hash/exit metadata is in identity.json, execution.json and their
outer gate JSON records. Actual config/ELF identity is now proved; execution is
still failed. This is Docker launch evidence, not a BuildKit execution result or
a root-build verdict. L2/L1 must supply a working, identified ARM64 build route
before the cold/image milestone can start. No further probe is self-scheduled.

## API inventory handoff

The newly allowed committed registration/launcher chain was read without editing
or running it. `api-inventory.json` binds 29 source file identities and the exact
eight registered phases to the current source. The plan now records their order,
prerequisites, authoritative command shape, output paths and explicit no-skip
acceptance condition. All eight statuses and every check must pass with positive
counts and skip=0; a summary PASS alone cannot close the selected-feature matrix.

Concrete remaining limitations are not product failures inferred from fixtures:

- Phase 03 enables SSH/MQTT/container settings and checks task results, but the
  registry has no actual SSH/SFTP, DNS/time, MQTT traffic or container-network
  phase. Those original B7 rows require controlled peer/key/image inputs and
  separate actual operation evidence.
- `run.sh:461-470` does not forward the optional SSH port supported by
  `src/qemu.ts:114-120`; an external variable alone cannot create that route.
  Any edit of this read-only launcher/phase tree needs a precise L2 write handoff.
- `run.sh:777-795` records image name/mtime/length, not SHA-256. B7's independent
  artifact evidence must bind the immutable factory image, seeded disk, public
  boot certificate, sources/tools, endpoint/container and all logs/results.
- Phase 07 retires the running deployment without reboot; phase 08 stages reset
  without applying it. Harness teardown stops QEMU and cannot prove graceful
  reboot/poweroff/halt or reset isolation. Existing physical and fresh runtime
  rows remain open.
- Historical HARNESS.md latest-image/shared-output/kernel-append text is not the
  current executable input contract. It stays untouched; explicit image/cert and
  DATA seeding in current run.sh/qemu.ts govern the future allocated job.

No API host/address, credential, container peer, root/package/kernel/trust input
or heavy job was fabricated. This documentation checkpoint remains partial and
uses the same PMA claim; no historical/global status or product file changes.

Tracking review confirms the phase list against the actual registry/imports and
separates settings, fixture, protocol, guest-action and physical evidence.
PMA-CR: PASS, no introduced source changes or findings. Documentation verification
and whitespace checks pass; final per-command metadata is retained beside the
probe. Existing successful software matrices were not replayed for this update.

## Joint wave and R1 authorized continuation (2026-09-11)

Campaign `mos-open-plans-20260910-100408`: L2 reviewed caller `64387f20`
and geometry `5ead2055` as PASS. Review round B7-R1 identified the actual pinned
outer-wrapper failure: `ENOENT: no such file or directory, lstat
'/srv/mos/.git/worktrees/75btxdqb'`. Only `tests/file-ab-x64/bun.sh` and a focused
identity fixture may change for this correction. Resolve checkout/gitdir/commonDir
outside the container, preserve the writable checkout and existing host route,
and mount required Git metadata read-only. Production sourceIdentity, Toolbox
and release policy remain unchanged. Verify the real linked-worktree route,
ordinary-checkout metadata protection and consumer entry beyond source validation.
Submit the isolated correction and clean checkpoint to L2 before joint merges.

The user-authorized joint wave replaces the earlier B-only freeze and one-B-job
serialization. After this source review, synchronize the exact reviewed local B,
then no-ff merge exact A `e4154126b7e38eb90db210adfb412b19535637a8` (tree
`04de9264c7eb0d190e13852955789ceea7439a71`) and full C
`48acef7f1a3683b1f3bb6261911b1a5123197da2` (tree
`553c1e7af96203315f79e7ea61e862f7a753e3a5`) in this same worktree. J remains
unformed. Preserve every original ancestor and all reviewed C production inputs,
including the six offline configuration/API/manifest/lock files. Mechanical
index/import/test unions must preserve sibling rows, status, ownership and
behavior. Semantic conflicts require exact evidence; no main access or merge.

The future matrix uses one J and one new image each for x64, virt-arm64 and
CX3576, with exactly two independent equal-input virt-arm64 cold roots and no
new S905 image. CX kernel/firmware reuse requires complete input equality;
previous A artifacts remain historical, never relabeled J. The independent C
verifier remains pinned to C-final separately from payload J. L2 schedules up
to two independent heavy jobs only after J/input manifests and the one-time L1
cross-workstream review. No heavy job is allocated in this source checkpoint.

The explicit ARM64 route is now authorized: preserve both unassisted Docker
failures; verify A's pinned BuildKit emulator and execute the identified Debian
ARM64 child once with an explicit read-only emulator, no network/capabilities,
2 CPUs and 512 MiB. A task-owned BuildKit replica may run one tiny target probe
using pinned v0.32.2, remote docker-container connection, labels and enforced
4 CPU / 10 GiB limits. Do not modify shared builders, binfmt or host state.
Actual package/root/image/guest production still waits for J and named jobs.

### R1 correction evidence

The outer wrapper now resolves canonical Git directories on the host and mounts
only `.git`/gitdir/commonDir read-only, retaining the existing writable checkout,
Docker socket and `/work`/`/root` host translations. Common-directory coverage
avoids duplicate child mounts. The linked gitfile is protected too. No production
sourceIdentity/Toolbox/release change is included.

Evidence directory: `/tmp/mos-b7-r1.9BVl5b`; per-gate JSON records source/tree,
working-file hashes, exact timeout command, UTC, exit code and log SHA-256.
The exact L2 command (`timeout 60 bash tests/file-ab-x64/bun.sh -e` importing
and calling production sourceIdentity) reproduced exit 1 and the unchanged
ENOENT at release-cli.ts:29 in `r1-original-red`. The focused wrapper regression
also failed both tests before the fix: missing linked metadata and writable
ordinary `.git/HEAD`. It opens existing metadata with `r+` without changing bytes,
so the RED does not alter Git metadata. Initial GREEN passed 2 tests / 13 assertions.
The final fixture additionally confines the writable-checkout test to a unique
owned directory. Original native, geometry, release, offline Cargo and unrelated
environment/baseline results remain unchanged. The clean committed consumer
entry check and explicit ARM64 route metadata follow in the continuation record.

PMA-CR reviewed the complete wrapper/fixture diff against `66cc7874`: no introduced
findings. The new fixture invokes the pinned wrapper, not a mock container or host
sourceIdentity bypass. Ordinary-checkout scope checks mount protection; the real
production sourceIdentity call runs on this actual linked worktree. Existing
release policy and tamper fixtures are preserved. Task/plan remain open.

## R1 clean checkpoint and bounded ARM64 route results

Isolated R1 correction commit: `fa817ca9b1bfe118c9ef4d5d98a1e87c20a63bc8`,
tree `8cace615cb023ebb560a0feb361cfffdfb1e3914`. Final wrapper regression passed
2 tests / 13 assertions; strict TypeScript, shell syntax, host-toolchain lint
422/422, docs and diff checks passed. Prior successful native/caller, geometry,
release and offline shutdown gates were preserved, not relabeled or replaced.

On that exact clean commit, the original pinned wrapper command returned
`{"commit":"fa817ca9b1bfe118c9ef4d5d98a1e87c20a63bc8","dirty":false}`.
The unchanged consumer CLI then used a task-owned negative fixture with that
actual source, exact committed board evidence and actual builder-image mapping.
It passed source/policy/evidence/tool checks and refused intentionally empty notes
inside typed assembleRelease: `Invalid release: empty release notes` (exit 1).
No artifact directory or acceptance record was created. This proves entry beyond
source validation, not complete artifact qualification. Evidence:
`/tmp/mos-b7-r1.9BVl5b/{r1-clean-identity,r1-clean-consumer}.{json,log}` and
`entry-proof.json`; the fixture path/hash and exact command are preserved there.

### ARM64 input and execution identities

All route evidence is task-owned under
`/srv/station/work/tmp/mos/75btxdqb/route-ICNGawQo/`; `/srv` paths map identically
to the Docker host. Per-step records include argv, UTC, source commit, stdout,
stderr, exit code and hashes. No private trust material is included.

- Debian source index: `d7e12182ce18b85b93007c1dedf31f2d29e01ccf3182cc4017c709b6259bc132`.
- Actual arm64/v8 child: `7215f78f35ffe58fe13f244fac9c4f21326d55187271fbb3e1a8aa5cc7e387ab`;
  config: `7e3898f7b011a107d0ef7393d5f604a6e0c0ff05ac4f2476630a8af21059ec9b`.
- Actual target `/usr/bin/dash`: 199256 bytes,
  `367967c823a0c391e5049b15a67c6a0a629c88b9b6dcdca75ef13ac9d65334b1`;
  `/usr/bin/dpkg`: 396184 bytes,
  `d8878dcd8949b2d18359b98082e18b2c3bb77f4cbe14e7a90f58b3fad2670e79`.
  Prior extracted ELF64 little-endian headers have e_machine=183. The successful
  BuildKit RUN independently reproduced both executable hashes in its output.
- Verified A emulator and the private daemon's own copy both hash to
  `239ff153cde81b6a6ab2c48eef9cff234751caa8e9d841363eace8db51e000e8`.
- BuildKit image: `moby/buildkit@sha256:28a898719c18a33f4e8000685287fa36fd0dd9560c6440227d3a732d79bb41d8`,
  actual amd64 / v0.32.2; installed Buildx v0.36.1. No floating-tag replacement.

The explicit Docker probe used the exact child and read-only emulator copy,
network none, dropped capabilities, no-new-privileges, 2 CPUs and 512 MiB. Its
shell command explicitly invoked the emulator again for dpkg. It exited 255:
`.buildkit_qemu_emulator: /dev/.buildkit_qemu_emulator: Invalid ELF image for this architecture`.
That invocation failed and was not repeated. It is separate from both prior
unassisted exec-format failures and the successful BuildKit route below.

### Private BuildKit RUN proof and resource retirement

Only one actual ARM64 RUN probe executed. The successful route used a private
labelled container `ai-agent-mos-wave-75btxdqb-arm`, builder
`mos-wave-75btxdqb-arm`, and labelled state volume
`ai-agent-mos-wave-75btxdqb-arm-state-icngawqo`. It exposed only the Unix socket
through `docker-container://ai-agent-mos-wave-75btxdqb-arm`; no TCP listener,
host/source/device/socket bind, shared-builder change or binfmt registration.
HostConfig verified NanoCpus=4000000000, Memory=MemorySwap=10737418240,
AutoRemove=true and exactly the owned state-volume mount. The source-approved
rootful namespace privilege remained confined to this daemon. Configuration
`[worker.oci] max-parallelism = 4` has SHA-256
`6d07b01fdf2dafa4aead7cfcca4e35036f8842349cd6e8e144b153eaec2b9063`.

For deterministic startup, configuration was copied into the created, stopped
container and verified before starting the image's original entrypoint. Buildx
remote create/bootstrap succeeded. Exact timeout-180 build argv and a tiny
Dockerfile are in `buildkit-prepared/arm64-buildkit-run.json` and
`buildkit-prepared/probe-context/Dockerfile`. The RUN used network none and
no-cache, executed dpkg, checked arm64 and both target ELF hashes, then exported
only three small evidence files. It returned 0 with
`ARM64_BUILDKIT_RUN_PASS`. Proof: `buildkit-prepared/buildkit-proof.json`.
This establishes emulated BuildKit userspace execution, not host binfmt, native
crun, system-QEMU boot, lifecycle, physical hardware or any final root/image.

Preserved setup/cleanup failures remain individually visible:

1. Initial read-only volume-absence parsing expected capitalized `No such`;
   Docker returned `no such volume`. No resource existed or was created then.
2. `timeout 30 docker ps --format '{{json .}}'` timed out (124, empty streams)
   before resource creation. The subsequent bounded inventory used explicit
   ID/name/image/status fields; no daemon/host setting changed.
3. The first private container's immediate post-start configuration copy failed:
   `Could not find the file /tmp/b7-buildkitd.toml in container 9a852383f08a78297296abfc553efe0f6e1f11f55556482376590d53471947e9`.
   No Buildx handle or RUN existed. That container and its empty volume were
   retired; the verified pre-start configuration sequence resolved the ordering.
4. After the successful RUN, immediate volume removal reported `volume is in use`
   while Docker auto-removal was settling. The enclosing script exited 1; it is
   not an aggregate PASS. Once absence was observed, a separate owned-resource
   cleanup verified labels and removed the volume successfully. The successful
   RUN was not replayed. `buildkit-prepared/cleanup-proof.json` records completion.

No private daemon, builder, state volume or detached gate remains. Resource
snapshots record 8 daemon CPUs / 33635225600 total bytes and approximately
297 GB free disk, with explicit per-container usage; these are snapshots, not a
future heavy-job reservation. Shared builders and A's historical proof remain
unchanged. The remote connection and worker setting follow the
[Docker remote driver](https://docs.docker.com/build/builders/drivers/remote/)
and [pinned BuildKit configuration](https://github.com/moby/buildkit/blob/v0.32.2/docs/buildkitd.toml.md).

### Next dependency boundary

L2 must review this isolated R1 correction and the already delivered consumer
before the authorized exact A/C joint merges. Local B is still
`ebdd7208f3c026c96e08d003d9d4f383c22f1eb9`; J does not exist yet. The route proof
removes a generic BuildKit ARM64-route blocker but supplies no selected package
pool, native release export, trust material, kernel equality manifest or fresh
artifact. Actual joint input freeze, one-time L1 source review, named heavy jobs,
full provenance/image/verifier/API/runtime/cold proof and physical bench rows
remain pending. No passed expensive matrix was repeated and no expensive
package/root/kernel/image/guest production was started.

## Authorized API launcher continuation (2026-09-11)

Campaign `mos-open-plans-20260910-100408`: L2 independently reproduced the
missing outer-container SSH forwarding input. It authorizes only conditional
propagation of a supplied `MOS_QEMU_SSH_PORT` into QEMU_ENV in
`pkgs/mosd/tests/apid-api/run.sh`, plus a focused regression in
`tests/file-ab-x64/api-launcher.test.ts` and necessary adjacent fixtures.
Preserve unset behavior, raw supplied values, source/image/certificate/board
arguments and all eight phases. Existing qemu.ts performs validation; do not
add another port parser. No guest, port opening, API product/service/registry
change or heavy job is authorized in this source phase. This is a new evidenced
caller obligation; the B7-R1 corrective count remains one.

Use byte-for-byte copies of the real launcher and qemu.ts in an owned fixture
checkout. Isolate Docker/build boundaries and observed networking; send the
actual launcher-generated container environment to the actual qemu.ts capture
path on an existing tiny fixture disk. Record the planned inner Docker argv
without executing Docker or QEMU. RED/GREEN must cover both boards, a supplied
port, absence and existing invalid-value refusals. Commit this correction
separately after focused tests/type/shell/docs checks and PMA-CR review. Retain
all independent service-traffic, actual reboot/reset and physical rows.

### API launcher correction evidence

The source change is exactly three lines after QEMU_ENV: append the supplied
`MOS_QEMU_SSH_PORT` verbatim when the variable is set. No default, coercion or
additional parser is introduced; absent remains absent. The original qemu.ts,
phase registry, service policy and image/certificate/board arguments are unchanged.

Evidence: `/tmp/mos-b7-api-launcher.Uoeguq/<gate>.{json,log}`, with exact commands,
UTC, source/tree, working-file identities and log hashes. Before implementation,
`timeout 120 bun test tests/file-ab-x64/api-launcher.test.ts` returned 1: 2 pass,
8 fail, each supplied value missing at the outer boundary. After the three-line
fix it returned 0: 10 tests / 134 assertions. The same ten cases passed through
`timeout 120 bash tests/file-ab-x64/bun.sh test tests/file-ab-x64/api-launcher.test.ts`.
Strict TypeScript for both new fixture files, bash syntax and diff checks passed.

The fixture copies real run.sh/qemu.ts and board inputs byte-for-byte and executes
them. It isolates the expensive images.sh and Docker boundary, supplies a local
Unix socket plus simulated network observations, and reconstructs the inner
environment solely from actual `-e` arguments. To reach the existing forward
validator without disk production, it invokes real qemu.ts capture on an existing
tiny private disk. Inner Docker is recorded and deliberately exits 73. The outer
harness deliberately fails before preparation/guest/API phases; that exit is not
an API or boot PASS. Unset has no SSH forward; 22345 survives to both HOSTFWD and
Docker port argv; 0/non-numeric values reach `Invalid positive integer`, 65536
reaches `Invalid forwarding port`, and invalid values never reach inner Docker.
The fixture Docker executable never delegates to the real daemon; the pinned
run uses only the existing Bun tool container. No TCP listener, guest or service
is started. Temporary fixture files/socket are removed after every case.

PMA-CR inspected the three-line source hunk and complete two-file fixture;
PASS, zero introduced findings. This is the separately authorized launcher
obligation, not another failed R1 round. Existing R1/geometry/caller/provenance,
ARM64 BuildKit and earlier negative evidence are retained without replay.

The same plan now records task-owned, uninstalled per-board allowed/alternative
SSH public identities and exact source-pinned Alpine amd64/arm64 child/config
identities. Public manifest: `/srv/station/work/tmp/mos/75btxdqb/service-inputs-I5cyEHJc/public-inputs.json`; SHA-256 `24a8096f4235d4168f244d281e0637a02bd8098623b0ae321597b658583dce9d`. No private key is
committed, no credential installed and no peer/guest/port started. Exact live
endpoint/account/host-key, controlled DNS/NTP/MQTT tooling and frozen guest
container archive inputs remain pending J-job allocation. All eight registered
phases and independent real-traffic/reboot/reset rows remain mandatory.

Final source gates: host-toolchain lint 424/424, docs and staged diff checks
passed in `launcher-final-gates`. No full unrelated suite was replayed.

## Reviewed upstream and input-readiness continuation (2026-09-11)

L2 accepted the caller/geometry/consumer/R1 checkpoints and merged reviewed
`6049df8f` into LOCAL B `53fc261f66aba95b9b0b03b4edbadadfb9ffc6e6`. At a clean
boundary, verified that exact ref/tree and merged it with `--no-ff` as
`53eeee9dd2df23cc9a191e9e5d0f7b67703e11e0`. Its tree
`cc020280a5f6a9855847836688480cacbbce181b` equals the already-tested API
checkpoint `d691708827994a36b9f2015c503c785d61120860`; no source conflict or
test-relevant change occurred. Ancestry checks passed. Merge evidence:
`/tmp/mos-b7-upstream.x9SubY/merge.json`, SHA-256
`08691ae9db26f6810845bf2067ea49157e623cd19e974d5325abfe0a8d28ac79`.
The separately committed API correction still awaits L2 review; no unchanged
suite or accepted ARM64 probe was replayed. Corrective count remains one,
resolved. A/C merges are authorized after this remaining review boundary;
J remains unformed.

The plan now carries the bounded joint package/root recipe and actual pre-J
input inventory: `/tmp/mos-b7-wave-inputs.DalRgH/readiness.json`, SHA-256
`d1839b7c4f7526bbfed49d4e7dfdd1f72a9e7622420b81a13bf26a9f6fd65876`.
It records 233 source/config/lock files, six required C production blobs and
separate C verifier identities; current full-feature dev resolution is 11/11/14
packages for x64/virt/CX3576. All three selected pools and final root/native/image
outputs are absent. Eleven local tool images were resolved to actual IDs;
arm64 OpenSSL is absent with exact stderr retained, while the current host
verity tool uses the available amd64 image. No tool install/build was attempted.

All 42 entries of A's approved compiled kernel manifest match actual bytes.
The 28 recorded kernel-source/support-input files match between compiled
`38a362cd` and A-final `e4154126`; B's missing A patch/fixture differences remain
expected until integration. Actual historical firmware bytes also match the
reported segment hash. These are verified reuse candidates, not J-qualified
components: actual J equality, compiler/package evidence and explicit joint
trust/input mappings remain required. No live-main source or private signing
key was read; no old payload was relabeled.

Original bounded inventory commands/streams/exit metadata are retained. A
filename collision caused the runner to replace the first detailed inventory
with its own completion metadata; the final record was reconstructed from
hash-checked captured outputs and unchanged sources/artifacts, without repeating
Docker or resolver commands. Original and reconstruction evidence are preserved.

No heavy package/root/kernel/image/guest/cold job started. The plan distinguishes
shared `all` package production from independent architecture jobs, preserves
two equal-input virt roots and one image per required board, and lists exact
missing J/package/kernel/trust/service/job inputs. Full runtime, authenticated
fresh-image scans, extraction equivalence, cold proof and physical rows remain
open. Only the existing own task/plan are updated; no global status changes.

## Joint integration checkpoint (2026-09-11)

L2 accepted `d6917088`; no reviewed source defect remains. Under the existing
joint-wave grant, cleanly synchronized exact LOCAL B `c2861fdf` with no-ff merge
`a4e48a6f`, then merged exact A `e4154126` as `6e8e6bf1` and full C `48acef7f`
as `e176876b733d675d1e20b40b42628cd4e18b197d`. Candidate J is that final clean
merge, tree `7e8e8bc62b52f3d78263d717e186a07f0d3430a1`, awaiting L2 review and
the one-time L1 joint review. All original authorized ancestors remain present.
Later task/plan commits do not relabel the payload source or package stamps.

Actual conflicts: both indexes in A and C, plus C's single existing
acceptProvenance import. Index unions retain every parent row verbatim and
exactly once (114 task / 67 plan rows); the test file equals reviewed B7 after
retaining its required import. No new production code or test was introduced.
C's six mandatory production and two verifier blobs remain exact. Every one of
1827 non-index files matches an authorized source input. Proof:
`/tmp/mos-b7-joint.rggwkleq/joint-source-proof.json`, SHA-256
`03e033fb6e9163d4cbaa6090a2e3a7c2027e65bb46ee34ec1ed20c019fdff4ee`.
PMA-CR reviewed these concrete unions/source bindings with no introduced finding;
corrective count remains one, resolved.

On clean J: affected non-publication typecheck/test gate passed 3 tests / 45
assertions (48 explicitly filtered), actual pinned sourceIdentity returned J
and dirty=false, and docs/merge-diff checks passed. No unchanged whole suite or
ARM64 route was repeated. A's original full staged diff check remains exit 2 on
unchanged patch-context whitespace; index-only check passed and reviewed blob
equality is proven. Original merge failures, conflict stages and external helper
syntax diagnostics remain in `/tmp/mos-b7-joint.rggwkleq/`; the plan gives their
exact classification. No failing aggregate is presented as PASS.

Board-keyed candidate job manifest:
`/tmp/mos-b7-joint.rggwkleq/J-job-inputs.json`, SHA-256
`c8d5eacaccc4dec388e3647d4b66e450da99625691779c94e6d4587ad1aaefbc`.
It binds J/board/profile/radios/locks/context trees/tools to commands and planned
outputs for x64, virt-arm64 and CX3576. Selected package resolution remains
11/11/14. Fresh package pools, selected deb/index hashes, native/root/image bytes
are outputs of the named jobs, not fabricated prerequisites or old stamps.
The 28 CX kernel inputs match the compiled input at J; the preserved fixed
toolchain image also yielded GCC 13.3.0 and its complete package inventory via
a bounded read-only metadata query. Full joint trust/firmware reuse binding is
still pending; x64/virt external kernel/firmware handoffs are absent.

The plan identifies direct Docker resource gaps at mosd/native compilation and
boot packaging/tool-tag routing. They require exact task execution-envelope
binding in L2's job allocation; no production scripts or shared tags were edited.
Missing public trust/signing mappings and controlled service peers/guest inputs
remain explicit. No private signing key, live main source or physical disk was
accessed. No production package/root/kernel/image/guest/cold job started, and no
global status changed. The task remains open for actual milestone acceptance.
