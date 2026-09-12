# 20260911-0145-b7-fresh-lifecycle-acceptance B7 fresh lifecycle and rootfs acceptance

- **status**: in_progress
- **priority**: P1
- **owner**: bkd/75btxdqb
- **createdAt**: 2026-09-11 01:45

## Description

Complete the reviewed no-Python source with B3's single-static-shutdown
refinement, then execute the combined x64 lifecycle/rootfs/image acceptance.
Generic implementation and iteration use x64; only a concrete ARM64-specific
change justifies a focused check of that affected surface. After the actual
separately approved main merge, run the consolidated virt-arm64/CX3576 wave on
that exact merged source, including two independent equal-input virt cold roots.
ARM obligations remain deferred, with physical limitations separate. No S905 image.

## ActiveForm

Four-mask source/input review passed. Preserve the first root command
resource-transition failure; resume its unexecuted producer after owned-daemon recovery.

## Dependencies

- **blocked by**: reviewed B3 static source and affected x64 input/acceptance predecessors
- **blocks**: L2 B Phase1 x64 handoff; deferred ARM acceptance after approved main merge

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

## Current architecture and producer policy (2026-09-11)

The latest actual user direction supersedes historical dual-architecture
pre-main gates. Portable Rust or shared rootfs changes alone do not trigger ARM
compilation or a complete ARM wave. A specific ARM-only change requires its
narrow affected-surface check; stable post-merge ARM acceptance remains owed.
Historical ARM outputs keep their original sources and cannot qualify later code.

Phase1 source/readiness and B7 acceptance are x64. The completed packet goes to
L1 for the existing D/D3 main-integration review with explicit deferred rows;
main merge/push still require the final human decision. No target Python and the
single named routel omission remain unchanged. The existing owner and task stay
in progress; no new tracking node or duplicate B3 dispatch is required.

Package/root separation and the bounded per-producer identity proposal are
recorded in the paired plan. That follow-on design is proposal-only, not a new
prerequisite or permission to change producer, pool, lineage or release rules.
The ongoing static correction must retain truthful changed-native identities.

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

## Final execution grant and W0 collection (2026-09-11 09:04 UTC)

L1 approved J `e176876b733d675d1e20b40b42628cd4e18b197d`, tree
`7e8e8bc62b52f3d78263d717e186a07f0d3430a1`, and the automatic W0-W4
phase DAG at 08:43 UTC. This supersedes the earlier pending review/allocation
rows. No additional producer input/output approval is pending. L2 B remains the
only report/collection endpoint; L1 issue `10nksom6` coordinates the campaign.

W0 ran the original `build-env/deb/build.sh --producer NAME --arch all` driver
once each for `ca-trust`, `profile`, `system`, `wifi`, and `bluetooth`, with
`timeout --signal=TERM --kill-after=30s 3600` per producer. All five exited 0.
Both original `build-env/deb/repo.sh --arch ARCH` invocations exited 0 under
300-second timeouts. Seven shared packages carry the actual J-derived version
`0.1.0+gite176876b733d-1`; both pools contain identical package bytes.

The independent clean checkout is `W/sources/shared`, where
`W=_out/wave/e176876b733d675d1e20b40b42628cd4e18b197d` in this worktree.
It has its own Git metadata and no object alternates. The final source status
check exited 0 with empty output. Read-only copies of both completed pools and
indexes are at `W/frozen-pools/shared-all`; they are W1 inputs, not a completed
selected architecture pool or root/image qualification.

W0 started at 09:03:40 UTC; its first actual producer started at 09:04:21 UTC,
PID `2401014`. It finished at 09:04:53 UTC, exit 0. Persistent tmux
`75btxdqb-7e0f1b`, pane `%101`, shell PID `2400503`, orchestrator PID `2400556`.
No child remained when collected. Exact step argv/PIDs/UTC/log hashes/exit codes
and all output identities are in `W/metadata/W0.json`, SHA256
`87d721d6af0868d235b7cc8e5726d71bef0f8fcc519da7700737db99f7d8aad4`.
The frozen delivery is `W/metadata/W0-delivery.json`, SHA256
`e1daa56c9314ca0df13d71837a876abb006e891edca02a96984e58313cff0213`.

Only the owned remote builder `mos-wave-75btxdqb-x64` and its labelled state
volume were created. The approved BuildKit image and emulator hashes matched.
BuildKit runs under 4 CPU/10 GiB/no-swap and worker parallelism 4. Sequential
direct index containers use 3 CPU/8 GiB while the idle daemon is limited to
1 CPU/2 GiB; the aggregate stays within the same job envelope. The owned daemon
and state are retained for W1. No shared builder, host emulation or tool tag was
modified. Task-private wrapper forwarding checks passed for original arguments,
read-only source mounts, writable caches, names, network and private tool tags.

The first task-local recorder exited 1 before any producer/resource creation:
`AttributeError: module 'hashlib' has no attribute 'file_digest'`. Its original
script and log remain under `W/tools/w0-startup-original.py` and
`W/logs/W0/orchestrator-startup-python.log`, with metadata in
`W/metadata/W0-startup-python.json`. Streaming SHA256 corrected only this private
recorder. No producer was repeated and frozen product source did not change.
Public trust hashes and private-key 0600 permissions were captured without
reading private contents; signing pairing and public-meta validation remain
required before their consuming phases.

## W1 completion and W2 capture refusal (2026-09-11)

Both architecture producer sets completed at immutable J. Only native export
and final index execution required task-local resource-envelope recovery;
successful producers were not repeated. The amd64 and arm64 pools contain 15
and 16 packages, respectively, and both native pairs and pools are frozen.
Evidence is in `W/metadata/W1/recovery-x64-v1/result.json` and
`W/metadata/W1/recovery-arm-v1/result-continue-v1.json`. Actual ARM native files
are ELF64/AArch64; their identities are in the adjacent `native-elf.json`.

Fixed Debian cache acquisition preserved the original 600-second timeout,
HTTP/2 connection resets and private mirror-prefix errors. All 163 amd64 and
175 ARM selected/union inputs, including the bootstrap helper, subsequently
passed the original cache verifier. Receipts are in
`W/metadata/W2/amd64-fixed-cache-v3/result.json` and
`W/metadata/W2/arm64-fixed-cache-v2/result.json`. Public metadata now uses the
exact J development template; the approved public trust identities are
unchanged. No root/image/runtime PASS follows from package or cache success.

The x64 normal root and virt-arm64 cold run1 independently failed at
`runtime composition refused: unsupported node: /installed/dev/console`.
Their terminal metadata is `W/metadata/W2/x64/root-resume-v5.json` and
`W/metadata/W2/virt-arm64/cold-root-run1.json`; the latter ended on its own at
10:58:24 UTC. No active gate or frozen source was interrupted or modified.
L2 authorized the directly affected composition/fixture correction and requires
reviewed successor-source identity before another changed-source root.

Read-only layer inspection proves that all eight devices are already in the
10-compose OCI and match the pinned debootstrap installation helper. The plan
records the precise snapshot-only correction and negative acceptance boundary.
This is a newly confirmed composition integration defect; the existing B7 R1
review corrective count remains recorded as 1, without self-dispatching a new
review round. The task remains open for source review and fresh acceptance.

The isolated correction captures only the eight exact bootstrap character
devices with device number, mode, owner, timestamp and xattrs. Runtime selection
and copying remain unchanged. The actual tar transfer fixture passes; selected
devices, unrelated devices/FIFO, wrong device numbers, owners/modes and changed
transfer timestamps refuse. PMA-CR Python review found no introduced findings.

Verification completed in persistent tmux `75btxdqb-7e0f1b`, pane `%102`:

- RED: `timeout --kill-after=10s 120 python3 tests/rootfs-runtime/composition_test.py CompositionTest.test_bootstrap_devices_are_captured_but_never_shipped`
  exited 1 with the same `unsupported node` console refusal. The log SHA256 is
  `10ef221e912df4c376e525b92e9e926c2db8fc06e183e6a74f8a185cde1ca6b5`.
- GREEN: five focused device tests exited 0, then
  `timeout --kill-after=10s 120 bash tests/rootfs-runtime-test.sh` passed all
  85 tests and `ROOTFS_REPRODUCIBILITY_PASS`, without skips. Its log SHA256 is
  `9e1311e66aad892bd8a2e4bce21e7593745e4d569047b36c7fec99894241cc66`.
- `timeout --kill-after=10s 120 make docs-verify` and
  `timeout --kill-after=10s 120 git diff --check` exited 0. The final record
  update receives a separate docs/diff check; the source suite is not replayed.

`W/metadata/W2/device-capture/{red,green}.json` records exact commands, PIDs,
UTC times and working-source/log hashes. GREEN metadata SHA256 is
`43f33e37a5849bb3bb2a5e64345235ed41d9111f9f18aea33a0230efa804c7ae`.
Layer audit SHA256 is
`b556c49b4446c2df5a73523d787d38cea7de43edd35eda15bc3c71713f0d7fc2`.
The original ARM terminal metadata SHA256 is
`907648fdb92de16c0a26c8ee5f5ddbc1e98d5c0956b584df8dbefe0e89c608dc`;
its root log SHA256 is
`0370b287c113976054fc5d0e3d94d797615f49a3407017b076239126a4b68fef`.
Neither architecture has a completed root. Root/image, cold equivalence,
authenticated guest/API/lifecycle and physical evidence remain outstanding.

The subsequent L1 bounded-composition disposition and L2 ARM terminal relay
refer to this same defect; they do not create another corrective round. Source
candidate `165f2fbd595e4c44c5ada9de273ca6f0936c5d66` and its passed code gates
remain unchanged. `W/metadata/W2/device-capture/terminal-classification.json`
separately retains the nonfatal systemd-resolved `/etc/resolv.conf` busy errors,
the subsequent successful installation of 173 packages, and the fatal 90-pack
capture refusal in each original root log. Its SHA256 is
`bde5a5360b3b9885900077be2b6a15fbeba7c73de63e431e283805d2ecded256`.

The exact unchanged stamp guard was extracted for a read-only reproduction,
using real frozen manifests and each actual checkout's `version.sh`. Both
architecture cases pass against original J and refuse against clean candidate
`165f2fbd` with `gite176876b733d-1` versus `git165f2fbd595e-1`. This tests only
the identity guard, not a full pool or root gate. Commands, script/source/input
hashes, PIDs, UTC and four logs are recorded in
`W/metadata/W2/device-capture/stamp-guard.json`, SHA256
`36abcc1604ec8d16897e004fddf21a3eb9a7f0dbb697fe4af211c0a56ccce372`.
No package, frozen source, producer or prior gate was changed or replayed.
The source candidate still awaits the already-required L2 review and precise
component-identity disposition. Two successful equal-input virt cold roots
remain required; the failed J attempt qualifies neither half.

### Approved package and composition source lineage (2026-09-11)

The existing full-tier approval now covers the exact L1 package-lineage decision relayed at 12:05 UTC. Package source remains e176876b733d675d1e20b40b42628cd4e18b197d and version 0.1.0+gite176876b733d-1; composition source will be the real clean successor containing the reviewed device capture correction and this consumer change. Original package, control, index, native and kernel bytes keep their original identities. The completed x64 kernel is collected and must not be rebuilt; the independent immutable-J ARM kernel remains untouched.

Implementation is limited to rootfs/build.sh source selection/staging, a new rootfs/runtime/source-lineage.py verifier, compose-capture.sh transport, compose.py report binding, release-manifest.ts strict consumption, and their directly affected Python/TypeScript fixtures. compose-install.sh changes only if transport requires them. An explicit clean ancestor checkout and a SHA256-pinned frozen component receipt authorize reuse; an exact checked-in composition-only path policy rejects every other tree delta. Actual Git bytes/modes, package controls/indexes, tool and receipt identities must verify before the container boundary. Default same-source refusal remains.

The deterministic private capture records separate full package/composition commits, trees and epochs, the root epoch, architecture, frozen pool/control digests, verified input receipts and exact path/blob/mode delta. Runtime and derived release provenance must consume those roles and bind the capture bytes. No private runtime configuration or policy bypass is introduced. Real Git/pool/caller RED/GREEN covers source, ancestry, input/tool/lock, archive/index, architecture, epoch/version and capture/release tampering, including equality across disjoint paths.

The original real J-pool/successor stamp refusal remains RED evidence. No production root uses changed source before B's review and the actual successor freeze. Two successful independent virt-arm64 cold roots must use the same final successor and equal package/tool/config/trust/root-epoch/lineage inputs; the two failed J roots do not qualify. W0/W1 and completed kernels are retained, not relabelled or repeated.

### Lineage implementation and validation checkpoint

The consumer now verifies full clean Git trees (including executable modes and hidden index changes), ancestor identity, the exact composition-only delta and producer context boundaries before running the package version script or any container. Existing permitted files cannot change type/mode or disappear. Explicit reuse requires `MOS_ROOTFS_PACKAGE_SOURCE`, `MOS_ROOTFS_PACKAGE_RECEIPT`, and the externally frozen `MOS_ROOTFS_PACKAGE_RECEIPT_SHA256`; the receipt binds original producer evidence, every recorded input, actual immutable tools, both native exports, all archive/control identities and the complete indexed pool. These are verified input facts, not an approval flag. `GIT_OPTIONAL_LOCKS=0` preserves read-only Git metadata. The original public-meta staging block moves intact after source/pool validation; its schema/helper, trust and policy are unchanged.

`source-lineage.json` is canonical sorted JSON with separate package/composition commits, trees and Git epochs, the root epoch, architecture, exact pool/control digest set, frozen input-receipt digest and before/after Git blob/mode delta. Absolute paths and wall-clock observations remain only in external producer evidence. The composition captures and hashes those exact bytes, joins installed/selected packages against them, and retains structured source roles in the runtime report. Release validation requires the clean actual composition source, capture/pool/package agreement, strict schemas and normalized root epoch; derived provenance retains the same record. Package version/date and `mosd-build.txt` continue to come from the original package producer. No production CLI, publication target, signing or runtime selector change is included.

Verification evidence is under `_out/wave/e176876b733d675d1e20b40b42628cd4e18b197d/metadata/lineage/`, with immutable command/source/working-file/log/UTC/exit metadata:

- `caller-original-red-v2`: the actual pre-change rootfs caller rejects an explicitly supplied original pool at its old stamp comparison. Exit 1 preserves the exact differing stamps and refusal. The first RED recorder only found an incomplete public-meta fixture; it is retained as fixture setup evidence, not the behavioral RED.
- `final-policy-python`: 20 real Git/pool/caller and capture checks pass, including same-source operation, explicit ancestor reuse, disjoint-path byte identity, dirty/hidden/mode/nonancestor source, changed lock/tool inputs, missing/wrong/forged receipt identities, replaced archives with recomputed indexes, wrong architecture/stamp, altered native bytes and missing/swapped/unknown capture.
- `final-python`: 17 then-current lineage fixtures plus all 87 existing/affected runtime cases and the rootfs reproducibility checks pass. The subsequent delta mode/deletion checks are covered by `final-policy-python`; no successful root build is implied.
- `final-policy-release`: TypeScript passes; all 12 focused lineage positives/negatives pass. `final-release-types` ran the exact current release module: 57 passed, five Git-container cases refused the inappropriate host-toolbox environment. Their original refusal is retained: `the release-git-fixture toolset was asked to run on the host (MOS_BUILD_TOOLBOX=host asked for it), and it will not.` No host-route exception was added.
- `final-release-container-route`: three non-publication acceptance cases pass on their existing container route. The two older CLI fixtures exposed their implicit use of the dirty developer checkout. `cli-frozen-source-green` now freezes the actual CLI/direct imports in each real ordinary/linked checkout, retains clean/dirty and read-only Git write-refusal checks, and passes both actual CLI/documented-command cases with their honest composition identity.
- Earlier type errors and the superseded nanosecond fixture expectation remain in the original logs. The final epoch fixture retains exact nanosecond comparison and refuses a one-nanosecond divergence. The first Bun filename filter also matched read-only frozen J source copies; its 122-pass/one-failure aggregate is not attributed to the current source. Subsequent commands use an explicit `./build/src/release-manifest.test.ts` path and focused filters; no frozen source was edited.

Actual immutable inputs were verified through the production helper, not only fixture data: `verified-real-inputs.json` SHA256 `fe33e5a2ea2bea23209ece63a0e834025eabb2892943b001e6c97872e81cf06f`. Both source snapshots are J with producer epoch 1789097968 and version 0.1.0+gite176876b733d-1. The amd64 frozen receipt is `frozen-inputs/amd64.json`, SHA256 `fc79903fcd6dc8bf40191c5f4cdf4979d664dfd0315a53521d57af821f80d166` (57 inputs, 6 actual tools, 15 archives plus three indexes, two native exports). The arm64 receipt is `frozen-inputs/arm64.json`, SHA256 `034bfe1387a770bcd35a6f29a5b026d3e7ca606dcd7200c64b69299e95dd9aad` (63 inputs, 9 tools, 16 archives plus three indexes, two native exports). Original W0/W1 receipts and aggregate environment failures remain unchanged. No producer/cache acquisition was repeated.

Both original-J kernels are complete. x64 result SHA256 `86bbbe6b0a4ea13f8af0f0ebebee67dc7d1aeab90d9dca06747c4c2f7d17e4be` retains bzImage `536a9d276d01fe116371f71ccd22d703f693f5642da0174163495bfb81876e0b`. virt-arm64 finished at 2026-09-11T12:10:20.012083+00:00, exit 0; result SHA256 `6136b2c57a825697a1e2acf5a1ce3e22b2f3df2cbdb8b12977ebb80cf88e5fc6`, Image `544f6bcba99c50313e36cdf72ff513965ba1dc5cc3e4d1cb830fc4a7ae3fcf4e`, modules `1839ff93f53e1af2a0a24a5d4c8075a605ca029a7ed441ebd998325ca54e945a`, kernel release 6.12.107. All 21 ARM step logs and four output identities were collected once in `arm-kernel-collection.json`; no compiler remains active and neither kernel will be rebuilt.

PMA-CR review covers the actual Bash/Python/TypeScript diff, strict input boundaries, subprocess argument handling, immutable pool joins, producer-context exclusion, unchanged private/source/trust policies and exact CLI fixtures. No unresolved finding remains in this candidate. B7-R1 remains the prior resolved review round; this is the separately authorized lineage contract extension and does not self-dispatch a corrective round. Candidate source identity and source-bound final manifests are supplied in the external delivery record after committing. B review and final input validation precede affected root-stage execution. All fresh image, successful dual cold-root comparison, guest/service/lifecycle and physical evidence rows remain pending under their existing owners.

Final shell validation preserves the accepted unrelated baseline failure verbatim:

```text
FAIL: pkgs/mosd/apid/ui/verify-ui-policy.sh:82: an early-exiting grep on the right of a pipe, in a file that sets pipefail: the pipeline reports failure when the pattern IS found. Use 'grep -c ... >/dev/null'
RESULT: FAIL (161/162 files clean, 162 scanned)
```

Both changed shell files pass syntax and the pipefail scan; the aggregate is not a PASS. The UI source is unchanged. `final-docs` passed, and final scoped whitespace is recorded separately because the shell aggregate exits before its chained diff command. After final review, the 20-case policy/capture gate includes the additional consumer mode/deletion refusal; the 12-case release lineage gate includes the corresponding symlink-mode refusal. The later CLI fixture uses the pinned Toolbox Git route for its actual commit/tree/epoch rather than requiring a host Git tool inside the Bun container.

### Reviewed J2 production root start (2026-09-11)

L2 reviewed and integrated f183a35d4ee581ab2a73cf68ea0fcef7c2b56c25, tree 0b0c4ed62bffa0006bdf85eabff1f2fbab1f9d4f, with no unresolved bounded findings. The local integration label 9ba74ee9a48c9c737e000fec9588382c88d21178 does not change the frozen composition identity. `J2_DIR` is `W/J2-f183a35d4ee581ab2a73cf68ea0fcef7c2b56c25`. The existing automatic W2-W4 authorization now applies after the completed source/input review.

Both production commands passed real clean-source, frozen pool/receipt/tool/native, deterministic lineage, wrapper boundary and fresh resource checks. They run in separate full Git checkouts and output directories; no fixture environment injection is present. Original J packages, native exports and both successful kernels retain their original identity. Fixed Debian cache copies preserve verified bytes; no acquisition or producer was repeated.

- x64: 2026-09-11T13:09:43.034922+00:00, orchestrator 2484332, root timeout 2485260, pane %102; `timeout --signal=TERM --kill-after=30s 10800 bash rootfs/build.sh`; `MOS_ROOTFS_NO_CACHE=0`. Metadata `J2_DIR/metadata/W2/x64-run1.json`, log `J2_DIR/logs/W2/x64-run1/root-build.log`.
- virt-arm64: 2026-09-11T13:09:43.035742+00:00, orchestrator 2484334, root timeout 2485261, pane %103; `timeout --signal=TERM --kill-after=30s 10800 bash rootfs/build.sh`; `MOS_ROOTFS_NO_CACHE=1`. Metadata `J2_DIR/metadata/W2/virt-arm64-run1.json`, log `J2_DIR/logs/W2/virt-arm64-run1/root-build.log`.

Each owned slot retains aggregate 4 CPU / 10 GiB with MemorySwap equal to Memory, x64 cpuset 0-3 and ARM cpuset 4-7. Direct children use the verified 3 CPU / 5 GiB allocation alongside the idle 1 CPU / 5 GiB daemon; positive-headroom refusal and owned-state preservation remain enforced. BuildKit stages use the full bounded slot. Source/output/tag/log changes exist only in versioned task-local root-v1 wrappers; original wrappers and evidence remain unchanged.

`J2_DIR/metadata/W2/initial-running-snapshot.json`, SHA256 `55404e5b591fbcafca4bb610b1a988995ea003660d1200a7a1ac180c7bed6bf7`, binds actual PIDs, commands, UTC, per-step logs, public trust, lineage and resource identities. Gate-pending was acknowledged by L2 with HTTP 200 and success=true. These are running production gates, not successful root, cold comparison, image or guest results. The two successful equal-input virt cold roots, independent CX root/firmware reuse checks and dependent signed image/runtime/API gates remain outstanding.

The x64 J2 gate subsequently ended at 2026-09-11T13:10:57.364923+00:00, exit 1, after passing the original bootstrap-device capture boundary. The exact new 90-pack pack-step 11/19 refusal is:

```text
runtime composition refused: missing path: /usr/lib/systemd/system/sysinit.target.wants/systemd-hwdb-update.service
```

`J2_DIR/metadata/W2/x64-run1-terminal-collection.json`, SHA256 `0abe1634e9fbf66bade6f7520383951beda01080f50ffb6e97ec984366574f92`, verifies every completed step-log digest and absence of both terminated x64 PIDs. The root log SHA256 is `69453e946350d26da34d4444419844bed27fe37eae79596c967ce9395ec692a6`. The frozen source remains clean f183a35d. The independent ARM cold1 gate remains active; it was not interrupted. L2 acknowledged the terminal report with HTTP 200 and success=true. No root success, cold equivalence or new source correction is claimed; successful original packages/native/kernels and both failed original J roots remain unchanged.

### Shared hwdb selector diagnosis after J2 root failures

The ARM cold1 gate settled at 2026-09-11T13:16:36.369358+00:00, exit 1, with the same vendor hwdb enablement refusal as x64. Its original PIDs 2484334 and 2485261 exited without interruption. Metadata SHA256 is `c3372be5691aa23512cea2947461bd564e97890a93c8ad2ddabc90ea2744a1af`; root log SHA256 is `5f36d74d2d7ba3b1b545bad2b6d6d64c0c34ebb3c88e14904216c028810edf4e`. Both architectures' 12 completed step-log hashes were verified. Neither failed f183 root qualifies a successful cold run, image or guest result.

Read-only diagnosis used both fixed `udev` 257.13-1~deb13u1 archives and all four preserved 10-compose OCI layers per architecture. The package-owned unit and symlink occur in the installed `udev.list`; the symlink targets `../systemd-hwdb-update.service`. The `mos-system` consumer's udev-owned `/usr/lib/systemd/system/*.wants/*` rule matches that link. The existing hwdb script removes it, but the selector's exact exclusions contain only the corresponding `/etc` enablement. The first diagnostic incorrectly assumed the owner was the systemd package; the second isolated fixture lacked the mandatory runtime_links field. Both setup failures remain preserved and are not behavioral RED evidence.

`J2_DIR/diagnostics/hwdb-20260911-1320-v3/diagnosis.json`, SHA256 `2b00e866ef98371b97ba45827a644767c0db4af1c0afe4a5ae577802e05f357e`, records the valid original-selector CLI RED using actual fixed package bytes and ownership. Two independent negative controls still refuse a missing systemd-udevd.service and an unrelated owned enablement link. The versioned diagnostic gate exited 0 because it verified the intended RED and both negative refusals; no patched selector ran and no correction GREEN is claimed.

The external review-only `proposed.patch`, SHA256 `ccae05119655020fd2832e79fc1161bc06c92fd41a4c5a8e91045dce115a68d9`, adds only the exact removed vendor link, focused positive/negative/explicit-selection fixtures, and the two necessary selector/fixture path entries in the existing Python and release lineage policies with direct tests. All current producer contexts were enumerated; those paths are outside package inputs. No hunk has been applied. L2 acknowledged the source-bound diagnosis and precise proposal with HTTP 200 and success=true. The separately required L1 path decision remains pending; no root replay, CX/cold2 start, package/native/kernel rebuild or source relabelling occurred.

### Approved exact hwdb selector reconciliation

L1's concrete decision, relayed through L2 B, authorizes only the existing removed `/usr/lib/systemd/system/sysinit.target.wants/systemd-hwdb-update.service` exclusion and its direct selection fixtures. The Python and release lineage path sets may add only `rootfs/runtime/select.py` and `tests/rootfs-runtime/selection_test.py`, with direct lineage tests. All other ownership, special-node, missing-path, context, source/tool/receipt/epoch, signing and release-policy guards remain unchanged. This resolves the prior scope hold; no further generic approval is required.

Implementation will preserve the real udev archive/installed-layer diagnostic and both failed f183 roots, capture scoped test RED before changing the three production lines, and run the affected selection/lineage/type/release gates. A clean isolated successor must pass L2 review and actual frozen input verification before affected production stages resume. Original J package/native/kernel identities remain fixed; neither failed f183 run qualifies cold reproducibility. Existing nkglvdlt and sighz7r7 are retained without changes.

The correction adds exactly one excluded path in select.py and exactly two allowed path strings in each existing lineage consumer. Tests construct ownership before configured removal, retain a nonempty required unit set, reject unrelated missing owned units/links and reject explicit selection of the removed link. Direct lineage fixtures cover both exact delta paths and refusal when a producer context actually consumes the selector. No other production behavior or source was changed.

Scoped RED is retained in `W/metadata/hwdb-correction-v1`: selection-red (2 pass / 2 fail, including the real removed-link missing-path refusal), lineage-red-unittest (one test refusing the newly requested selector delta), and release-red (one existing allowed path passes; two new paths refuse, one exact file). The first lineage-red invocation exited zero without a unittest entry point; its empty log is explicitly invalid test evidence and was replaced by the real one-test RED without changing assertions.

GREEN evidence: selection-green runs all 57 affected selector tests; lineage-green runs 20 affected helper/capture tests; release-green runs TypeScript plus 15 lineage/nanosecond tests in exactly one explicit release test file. The added producer-context negative passes separately. actual-package-fixture-green reuses the preserved real udev package-byte/ownership fixture without changing its inputs: the corrected selector retains the required unit, omits only the existing removed hwdb unit/link and passes report verification; both unrelated missing unit/link cases retain their exact original refusals. This is fixture acceptance, not a successful root build.

PMA-CR review of the actual three production lines and direct Python/TypeScript fixtures found no unresolved introduced issue. Existing ancestry/mode/blob/context checks, fixed receipts and strict release/capture/source binding remain intact. The final commit/tree, complete approved delta, deterministic records for two disjoint source checkouts and actual J package/native/tool/input verification will be bound in the external candidate delivery after committing. L2 review precedes production use; both failed f183 roots, original J producer outputs and the unrelated UI shell baseline remain preserved.

### Reviewed J3 production roots and first terminal collection

L2 accepted composition commit 92a877dd4644ed7b886763e7927f668cab9d63a6, tree 7d926cb4690f00be64e855ee753a7988181856ae, and independently verified the real frozen inputs and deterministic lineage. Its integration label 80dcd35bc3c5127afb8c8fc5b25c879b1ca97d2b does not relabel payloads. The original J package/native/kernel identities remain unchanged. Production uses new clean checkouts and versioned root-v1 tools under `W/J3-92a877dd4644ed7b886763e7927f668cab9d63a6`; no fixture boundary injection is present.

Both jobs passed actual source/pool/receipt/tool/trust/lineage checks, wrapper forwarding and positive-headroom checks, and fresh resource checks before running `timeout --signal=TERM --kill-after=30s 10800 bash rootfs/build.sh`. Each slot retains aggregate 4 CPU / 10 GiB with MemorySwap equal to Memory; direct children use 3 CPU / 5 GiB beside the idle 1 CPU / 5 GiB daemon. Both owned daemons were idle before launch, with disjoint CPU sets and more than 350 GB free on /srv.

- x64 ordinary root (`MOS_ROOTFS_NO_CACHE=0`) started at 2026-09-11T13:42:12.784756+00:00, orchestrator 2511362 and root timeout 2512310, tmux pane %102. It ended at 13:43:18.262726+00:00 with aggregate exit 1. The actual 90-pack failure is `runtime composition refused: root package not installed: readline-common`. Root log SHA256 is `be70e367ea5604f6e07bc80573cbb2ad2c8e83446f1a847ea186c015bad4d60d`. Both PIDs were absent at collection. The hwdb missing-link refusal did not recur; no complete root success follows.
- virt-arm64 cold1 (`MOS_ROOTFS_NO_CACHE=1`) started at 2026-09-11T13:42:12.767867+00:00, orchestrator 2511367 and root timeout 2512297, pane %103. Both were present at first collection. The existing command, source, inputs and resources remain intact; this observation is not a completed cold-root result.

The immutable first collection is `J3_DIR/metadata/first-root-collection.json`, SHA256 `449e347e51cc0ecaa26242d188c813def76450b0231ba58146c92c315bc3e8b7`. It binds both exact command/environment/source/resource records, completed step logs, process observations and preserved root-log snapshots. Ongoing log snapshots are explicitly prefixes, not final hashes. Launch metadata is `J3_DIR/metadata/W2-launch.json`, SHA256 `56e8577c27707f80abcbb647d6ab9878bfdf0067e20667d3d2c50a393c0f63c4`. The runner SHA256 is `f6951c2b69b1705ddb8d36a870d4bf65af163fd5ed8e82c1bd5c208dc14b6058`; original J/f183 wrapper bytes remain preserved.

The first report preparation encountered the already-exited x64 PID and stopped before sending. The replacement report collected its real terminal state and the continuing ARM state; this is reporting recovery, not a build or code retry. L2 accepted the guarded follow-up with HTTP 200 and success=true, message 01M28BDSQP8EPPN8ACVG66SDH6. Evidence is under `/srv/station/work/tmp/mos/75btxdqb/j3-root-start-terminal-q9rf2t0o`.

The new direct source anchors are `rootfs/runtime/consumers.json:65` (required readline-common resource owner), `rootfs/runtime/select.py:427` (strict installed-root-package check), and the committed readline-common Debian pin. No selector, consumer, package, dependency or installation policy was changed for this new failure. Preserve the existing ARM job and diagnose the exact installed ownership/selection mismatch before repeating dependent roots. Both final successful virt cold roots, all final images and runtime/physical acceptance remain outstanding. No W0/W1/native/kernel build was repeated.

### J3 selected-owner diagnosis and external proposal

L2 authorized a bounded read-only diagnosis of the readline-common refusal, a single pass over the other required owners in selected consumer rows, and external proposed hunks/tests. This does not authorize changing consumers.json, package pins or the fixed lineage policy. Production source remains 92a877dd4644ed7b886763e7927f668cab9d63a6; only these existing records are updated.

The actual x64 and virt-arm64 10-compose OCI manifests and all eight layer digests were verified. Captured native status, sources.tsv, selected.pkgs and ownership lists agree: each has 173 installed packages and 11 selected local consumers. Across each selected declaration's 88 owner requirements (70 distinct package names), only readline-common is absent. The same resource row's other five package owners are installed with captured ownership. Both roots lack /etc/inputrc. The locked selection command agrees with both actual installed inventories; no fixture is substituted for those observations. Collection is `J3_DIR/diagnostics/readline-v1/collection.json`, SHA256 `5795e456b9e49e055193cb43f04844d2fd456b3a3b42348faffa9f53a75abd9e`.

The pinned readline-common archive is SHA256 f77e8aa0bf0de618f11cb0b21658a4ed60f177d63b3cf26d7fc3706b6d0eaaa9, version 8.2-6, architecture all. It owns /usr/share/readline/inputrc; /etc/inputrc is absent from archive ownership and is generated by its actual postinst on initial configure using cp -p from that template. Consequently merely moving an owned /etc/inputrc glob into radio declarations would not preserve the intended configuration. The external proposal moves the readline requirement out of unconditional mos-system roots and into both actually selected Wi-Fi/Bluetooth consumers, explicitly retaining the owned template and the named generated /etc/inputrc. The two actual Bash ELFs remain installed, reference /etc/inputrc, and have no DT_NEEDED libreadline dependency; that observation does not independently prove guest interaction behavior or authorize removing Bash/GNU/S5 tools.

An isolated actual-package resource fixture reproduces the unchanged original consumer row's missing-owner RED. The external proposal passes no-radio, Wi-Fi, Bluetooth and combined-radio cases and report verification. Required-owner absence, missing owned default and missing generated inputrc each still refuse. Eight cases retain exact argv/log/source identities and real pinned resource bytes. Two earlier fixture setup failures (absolute archive symlink handling and accidental inclusion of foreign-board inventory) remain preserved, not behavioral RED or GREEN. No production assertion was changed.

The same single-pass candidate check identifies an independent CX mismatch before another root is launched: CX's selected radio packages include readline-common, but unconditional mos-system also requires dmsetup, whose current amd64 and arm64 pins select it only for mos-board-x64 and mos-board-virt-arm64. This is a locked-input finding, not a newly installed CX-root result. The external alternative moves that exact executable owner rule to those board consumers, matching current selection; L1 must confirm that policy or disposition a different package requirement. No dmsetup/libdevmapper package pin, producer, runtime policy or selected tool was changed, and no CX build was used to rediscover the known mismatch.

Required production scope for the proposed reconciliation is the exact consumer rules in rootfs/runtime/consumers.json plus that one exact path in the existing Python/release lineage sets. Direct selection/composition and lineage/release fixtures remain necessary after a concrete disposition. All 15 actual producer contexts exclude consumers.json; the existing producer-context guard remains intact and would be revalidated against a reviewed successor. Combined external proposal: `J3_DIR/diagnostics/readline-v1/combined-proposal.json`, SHA256 `cc841daca22dd37273070a8c9ce447a5f3c7edf228316cc02faff75a64877af1`. Readline and CX proposals are separately inspectable; neither is applied to the repository.

ARM J3 cold1 also completed failure without interruption: root ended 2026-09-11T13:48:57.934605+00:00, aggregate exit 1 at 13:48:57.935605+00:00, with the same readline-common error. Orchestrator 2511367 and root timeout 2512297 are absent. All 12 step-log hashes were collected once; metadata SHA256 is 1f1645768a2bc8661af71d77de1091b6c2d95a4cf57883d0518a0a7b4f5330a0 and root log SHA256 is 127dd4b8f861feedd2eb6531704af832e7807e9ba932372b1bf09fc569e2edfc. The collection `arm-terminal-collected.json` has SHA256 8fa1a157fb9ffa679ed4018c5b803e046f574f31b2d1a4a2eaf316c5001c60c4. Both J3 roots remain failures; no completed root, cold comparison, image or guest result follows. No producer/native/kernel/root was rerun during diagnosis. New dependent roots await the exact consumer-policy disposition and reviewed successor, with all original component identities preserved.

### Approved readline resources and CX locked tool selection

L1 approved the conditional readline template/generated-inputrc rules, preserving the common dmsetup executable rule. Only mos-board-cx3576 is appended to the arm64 consumer lists for dmsetup and libdevmapper1.02.1; existing pins, versions, digests, amd64 selections and all other dependencies stay unchanged. The fixed lineage sets may add only consumers.json and those two lock files. The external board-only dmsetup-rule move is declined and remains unapplied. Direct fixture, real locked-selection/ELF closure, source-context/receipt/capture/release validation and a clean reviewed successor precede any production root. Original J local packages/native/kernels and all failed root histories retain their identities. This concrete decision is authorized; no further generic approval is needed.

### Feature-resource correction verification

The bounded implementation preserves the common mos-system dmsetup rule, moves only readline-owned defaults and their explicitly generated configuration into selected Wi-Fi/Bluetooth consumers, and appends CX only to the two existing ARM lock entries. The Python and release fixed delta sets gain exactly those three authorized paths. No package producer, version, archive digest, tool pin, native binary, kernel, signing policy or previous source snapshot changes.

Focused source-bound RED records under `W/metadata/feature-resource-v1/` retain the original no-radio `runtime selection refused: root package not installed: readline-common`, real CX locked-selection missing dmsetup/libdevmapper assertion, Python unapproved-delta refusal and three exact one-file release refusals. GREEN comprises 66 selection tests, 21 source-lineage tests, 18 release tests/45 assertions across exactly one file, TypeScript and four direct generated-resource/lineage capture tests. Seven real pinned-resource cases cover no radio, either radio, both radios and missing owner/template/generated path; the three negatives correctly exit 1. The actual pinned postinst/template evidence remains bound to the preceding diagnostic.

The real manifest driver produces identical archive/version/architecture/URL/SHA rows for x64 and virt-arm64. CX gains only dmsetup SHA256 f802c1ec2d6f45a6544f09c5da72f9688e06208d12bb76ac9b25f2cfa8033306 and libdevmapper1.02.1 SHA256 4d783b235eb9857ec96fabd0f161a84426706d079ec82ef5a91cbbf9dd644904. The existing virt rows' consumer annotations now also name CX; their payload identities do not change. All selected candidate required-owner references are present. This is locked-input coverage, not an installed CX inventory.

The real ARM dmsetup closure uses the unchanged common executable rule, 14 already selected pinned package/control inputs and 11 retained ARM ELFs, including Bash for the package-owned blkdeactivate script and the actual base-files merged-/usr aliases. Its dmsetup ELF SHA256 is 554e3526e1683a710be0c8aa89ea52be72e2cc5a96c7029d07a80de7827554f2. Archive dependency/version checks include the actual mawk Provides: awk relation. Selection and report verification pass; a removed real loader still refuses. No additional pin beyond the approved two is required. `dmsetup-closure-v5/result.json` contains the full library/interpreter/hash mapping; no ARM target program, installed CX root or guest was executed.

All intermediate fixture/recorder failures remain evidence, not behavior RED or PASS: duplicate fixture ownership (`ambiguous ownership: /etc/libaudit.conf`), a colliding temporary result/metadata name (`KeyError: 'cx3576'`), missing fixture `/bin` for blkdeactivate, an initially unmodelled virtual `awk` dependency, and the fixture's attempted synthetic aliases despite their presence in actual base-files. The corrected fixture uses actual selected archives and their existing aliases; production selection/integrity checks were unchanged. Local PMA-CR review of the complete scoped diff reports PASS with zero introduced findings. `precommit-review.json` binds every gate/log hash. Final clean successor source, deterministic lineage, actual receipt/tool/pool/native checks and isolated real caller checks are recorded after commit; production roots remain pending L2 review/input acceptance. Task ownership and all historical failures remain unchanged.

### Frozen feature-resource successor input handoff

The isolated correction is `259681e809b7093688211c6db69822d376c4d9f7`, tree `cc4f46cf02d391a620efc01fcdcce52ae825030c`, composition epoch `1789136510`, with 11 scoped files. The distinct output/evidence namespace is `W/J4-259681e809b7093688211c6db69822d376c4d9f7`. Both clean verification checkouts contain this exact commit/tree. Actual final-source helper checks validate the full J-to-successor delta, producer contexts, unchanged original J receipts/pool/control/index/tool/native identities and clean ancestry. Two disjoint paths produce byte-identical lineage: amd64 `83c8f36da7a21664d92a9928d3b8bcc193a3a799044f01aaee41de995b7a24ae`; arm64 `027097a644867db75c3ddab33cb6cc340020eb47bd34efd8edd87fdf722b4732`. Package identity remains original J/version/epoch, and root epoch remains `1577836800`.

`J4_DIR/metadata/candidate-inputs.json` SHA256 `9d401947f7edaf629762b5e712ce5d1002e7f002de08b1728e90ba5371ae3669` records the four successful helper calls and three real caller boundary exits 79. These deliberate pre-resolver boundary tests are not production roots; their BASH_ENV fixture is forbidden as a production input. `J4_DIR/metadata/successor-readiness.json` SHA256 `9aa09d8e4dd3998d688e76b112566495d1044f98fe4ae90d543abc99ac8ef402` binds all three board configurations/selections, exact public trust and frozen receipts, current Debian rows, resource proofs and reuse/invalidation decisions. The bounded owner checks cover 87 x64, 87 virt and 99 CX references, with zero missing owners. Existing virt lock rows gain only the shared CX consumer annotation; their selected archive identities are unchanged.

No J4 production build or guest action has started. L2 must review/integrate this bounded correction and verify the real input handoff before the already-authorized affected W2-W4 jobs resume. Original J packages/native and successful kernels, prior root failures, physical limitations and final equal-input cold-root requirements remain intact. This later tracking entry does not relabel frozen composition `259681e809b7093688211c6db69822d376c4d9f7` or any binary artifact. Task remains owned and in progress; final campaign/global reconciliation remains with D.

### Reviewed J4 production startup

L2 accepted and integrated the bounded correction at B merge 82ad2fcdce99f44e67ac8a06799d534df21da029; immutable composition remains 259681e809b7093688211c6db69822d376c4d9f7/tree cc4f46cf02d391a620efc01fcdcce52ae825030c. J4 versioned wrappers change only source/tree/readiness, private paths/tags and event names. The original resource envelope, input verification, archive adapter and prior wrapper bytes remain intact. Fresh launch inspection found both owned daemons idle at 4 CPU/10 GiB/no swap, separate CPU sets, more than 60 GiB free disk; each runner repeats checks immediately before its root command.

Virt-arm64 cold1 started the actual `timeout --signal=TERM --kill-after=30s 10800 bash rootfs/build.sh` at 2026-09-11T14:36:20.849530+00:00, orchestrator 2541422, root timeout 2542260, persistent tmux 75btxdqb-7e0f1b pane %103. Its clean J4 source is `J4_DIR/sources/production-virt-arm64-run1`; logs and metadata are `J4_DIR/logs/W2/virt-arm64-run1/root-build.log` and `J4_DIR/metadata/W2/virt-arm64-run1.json`. No BASH_ENV boundary fixture enters production. The verified original J arm64 pool/native/receipt, fixed cached archives, trust and expected J4 lineage are unchanged. This is a running gate, not root/cold/image/guest success.

The x64 orchestrator 2541362 ended before any root command at 2026-09-11T14:36:19.699415+00:00, aggregate exit 1. Its exact unchanged capacity refusal was `('station', '60.42%')`: station CPU exceeded the existing 50 percent per-container preflight threshold. No threshold was weakened, root invoked or successful producer replayed. The clean prepared source and all failed preparation logs remain in J4. `J4_DIR/metadata/startup-collection.json` binds completed step hashes and process evidence; x64 metadata SHA256 is `bbc51c18b912a1a01bf0d9694d29e79b79a3c10b8b345d597ec8f5a5c3157926`. L2 collects the ARM gate and the x64 execution-only capacity failure; no product correction or root PASS is inferred. The earlier failed root attempts and all physical limitations remain distinct.

### J4 ARM terminal and shared tmpfiles dependency diagnosis

The next x64 continuation collected a newly settled ARM cold1 before launching another root. ARM ended at 2026-09-11T14:43:02.792157+00:00, aggregate exit 1, with exact error `runtime composition refused: missing path: /usr/lib/systemd/systemd-tmpfiles` in 90-pack pack 11/19. Orchestrator 2541422 and root timeout 2542260 are absent. All 12 completed step/log hashes verify. Metadata SHA256 is `3234f9d106759bacdbc54c4ce0f3482bd148f134236774df0c19fe4809fbcd83` and root log SHA256 is `e4ba596ddc17a89f1004c47e6343a25aa9226394587c230299c7c5ac91169237`. Installation of 173 packages completed, but no successful root, cold comparison, image or guest is claimed. All original wrappers, source and result files remain unchanged.

A single fresh read-only x64 preflight passed the unchanged resource/input checks: station CPU 5.17%, all unrelated container CPU below 50 percent, disk/memory bounds, idle owned 4 CPU/10 GiB/no-swap daemon and builder, clean prepared J4 source, original pool/cache/receipt/native/trust identities and deterministic lineage. Nevertheless the new shared producer-resource declaration is unsatisfiable for both architectures, so the previously unexecuted x64 root was not launched into the confirmed same prerequisite failure. No source was recloned, resource threshold waived, or successful producer/kernel replayed.

The actual retained J4 ARM 10-compose OCI layers contain `/usr/bin/systemd-tmpfiles`, its dpkg ownership and setup unit, and contain no `/usr/lib/systemd/systemd-tmpfiles`. Its bytes equal the exact ARM systemd archive. Both fixed systemd archives (amd64 and arm64) own the `/usr/bin` executable; their retained setup unit invokes `systemd-tmpfiles`. The common `consumers.json` line 72 instead names the absent `/usr/lib/systemd` path in exactly three accounting-link `requires` arrays (wtmp, btmp, lastlog). `select.py` adds those explicit producer resources while preserving the runtime links; the real package declaration remains strict.

`J4_DIR/diagnostics/tmpfiles-v1/result.json` SHA256 `6f86fcd6f74e1b745f9cb113d2d0fb41783da7b8193698fccf41be15bb1b7565` binds terminal collection, fresh capacity/input checks, exact OCI layers and both package-node identities. A focused external fixture uses the pinned path placement/setup-unit bytes with a small synthetic ELF: original path refuses (exit 1), exact path proposal selects/verifies (exit 0), and removal of the required real-path producer still refuses (exit 1). This is scoped fixture evidence, not target execution. The external `proposed-consumers.patch` SHA256 `000e207f28e7f7dfc24b1d1534d3e2c25e0ff7f3a61179f23fd7e7ccbcd7f465` changes only the three `requires` values to `/usr/bin/systemd-tmpfiles`; it is unapplied. Production path correction and matching existing selection/composition fixtures need L2/L1's precise disposition under the current execution-only continuation. No new lineage path, package pin, producer, runtime quota, auth, signature or release-policy change is proposed. Both J4 roots remain unqualified: ARM failed and x64 never started. Existing crons and all hardware limits remain unchanged.

### Approved tmpfiles runtime-link correction

L1 explicitly approved changing only the three accounting links' requires member from `/usr/lib/systemd/systemd-tmpfiles` to `/usr/bin/systemd-tmpfiles`. Existing pinned archives and the J4 ARM installed-view failure establish the wrong declaration; preserve their original RED and all preceding failures. Direct selection/composition regressions cover all three links, generator ELF dependencies, unchanged configuration and unit, and missing required resources. No producer, pin, selector or fixed lineage path policy changes. The current source scope is consumers.json, the two direct test files and these existing records.

Validate all enabled runtime-link requirements in one bounded captured-input pass, distinguishing installed ARM evidence, earlier equal-input x64 evidence and CX locked inputs. Revalidate final clean successor lineage against original J receipts/pool/native/tool identities before L2 review and production continuation. Neither J4 nor any earlier failed root qualifies a cold half. The later notification policy keeps nkglvdlt and c9ea0np3; deleted sighz7r7 is not recreated. No cron is changed.

### Tmpfiles correction verification

The production diff is exactly three replacements in consumers.json; no other production bytes or fixed lineage paths change. The new direct test fails on the original declaration with `runtime selection refused: missing path: /usr/lib/systemd/systemd-tmpfiles`, then passes after the exact correction. New tests cover all three links, their generator dependencies and capture/report ownership; missing generator, unit, configuration and an unrelated required resource still refuse. The targeted accounting discovery records seven executions of four unique tests (the existing imported fixture class is discovered twice); six distinct existing runtime-link regressions pass. Two capture-lineage tests, six exact-delta/context/package/tool/native/receipt refusals and 18 release-lineage/epoch tests with 45 assertions across exactly one Bun file pass. No aggregate full suite or target execution is claimed.

`W/metadata/tmpfiles-correction-v1/actual-links-v4/result.json` SHA256 `0c0eab24803e558a77b3f4268f245ee4d97e6add10d5f72cd143b88f6381b63b` binds the actual x64 J3 and ARM J4 installed OCI inputs, full layer/node identities, captured ownership and 173-package inventories. J4 x64 never executed a root; the earlier x64 view remains labeled with its actual source. Each diagnostic accounting selection retains 19 real ELF files and all three links with exact configuration/unit/generator hashes. Actual producer, unit, configuration and loader removal each refuse (eight negative cases across architectures); selection and report verification succeed without executing target code. All 11 distinct requires are accounted for: ten are captured regular owned files, while factory shadow is the existing explicit pack-shadow-relocate transformation of captured /etc/shadow. Unit commands retain the actual basename `ExecStart=systemd-tmpfiles`; no unit or alias is rewritten.

The complete enabled-link inventory covers 12 common links per captured board and three additional CX Wi-Fi/AP /dev/null masks from its frozen selected package archives. CX remains locked-input evidence, not an installed-root result. The final audit binds these declarations, mask metadata, source cleanliness and unchanged scope. Capture was performed once per architecture; subsequent diagnostic fixture corrections reused its immutable node/object evidence. Preserved preparation errors are the host Python missing hashlib.file_digest, missing fixture generated origins for accounting links and ld.so.cache, and an initial two-mask assumption that omitted CX's already-selected AP mask. They are fixture/recorder failures, not policy RED or product changes. The preliminary metadata-print TypeError is also retained as setup history.

Local PMA-CR review finds no introduced issue in the exact consumer/test diff. Final clean successor source/input verification and L2 review precede production. Original J package/native/kernel identities, failed J/J2/J3/J4 roots, both required future equal-input virt cold successes and all guest/physical evidence rows remain unchanged. No producer/kernel/root replay or cron mutation occurred during this correction.

### Frozen tmpfiles successor input handoff

The isolated five-file correction is `1ff1d03c202f874e691acd2b61311e41b5ce1074`, tree `6e5c0644afbf5404f4cf7290af27d07cb1316038`, composition epoch `1789139904`, parent `cd9de21519fd1f76d04732910a2aa73f1d78ffbf`. The new namespace is `W/J5-1ff1d03c202f874e691acd2b61311e41b5ce1074`. Two disjoint clean checkouts independently validate the final full allowed delta and actual producer contexts against original J sources, frozen receipts/control/index/pool bytes, tools and both native exports. Four helper calls pass; three actual rootfs/build.sh caller checks reach the deliberately isolated exit-79 boundary. They are not production root results and their BASH_ENV boundary is forbidden in production.

Both independent lineage copies match exactly: amd64 SHA256 `09af46eb3d2da7009a0a665a0d24e29825dd91116bb1943aa15c4afd85265683`; arm64 `5cfbf3ba95f14560c99ef199d430e55c3cc089c2c326b2683beff7dd42db385a`. Original J package commit/version/epoch and root epoch `1577836800` remain unchanged. `J5_DIR/metadata/candidate-inputs.json` SHA256 `91b33dfb9836d5dc7739169d446893a03dda3c0f175f57447af123a4364d4f48` and `successor-readiness.json` SHA256 `672046b5134f51e58ae8c3af88c2660eee39edbb28205c1990079798df9c6ed9` bind all three board inputs, original public trust and unchanged selected Debian rows (162/162/174). The final enabled-link audit is `W/metadata/tmpfiles-correction-v1/final-audit-v2.json`, SHA256 `b542aef862b24ff4b58c72b96d3dec3e308955bf13b1eb0b37b05a8977212013`.

All candidate-input checks completed; no detached gate or heavy job remains. L2 bounded review/internal integration and final input validation precede the already-authorized J5 production successors. x64 ordinary root and virt cold1 are the first ready jobs after that handoff; CX and independent equal-input virt cold2 follow the existing resource/dependency rules. Original J packages/native/kernels are reused with their actual source identities. This later documentation checkpoint does not relabel the frozen correction or any artifact. Task remains in progress, final images/runtime/cold/hardware rows remain outstanding, and no other issue or cron was changed.

### Reviewed J5 production startup and audit reference recovery

L2 accepted the exact tmpfiles correction and verified final inputs, integrating records at B merge `947eff0646876294761278387c0c3313afef733f`. Frozen composition remains `1ff1d03c202f874e691acd2b61311e41b5ce1074`, tree `6e5c0644afbf5404f4cf7290af27d07cb1316038`, epoch `1789139904`; original J package/native/kernel identities and root epoch remain unchanged. No product or test suite was replayed for the handoff.

L2 detected that final-audit-v2.py and its gate recorder used the same output filename: the surviving final-audit-v2.json is gate metadata, SHA256 `d2bb09502c708065d5f2726b4efc6c832f781f34731dff78f01c7ed3d3021454`. The logged audit payload hash `b542aef862b24ff4b58c72b96d3dec3e308955bf13b1eb0b37b05a8977212013` was reconstructed from unchanged captured metadata and frozen archive members, matching exactly. This resolves the historical evidence-reference collision without rerunning diagnostics or changing payload source. Its exact recovered bytes now have the distinct filename `J5_DIR/metadata/runtime-link-input-audit-recovered.json`. `execution-readiness-v1.json` SHA256 `45a596bb7728e4d0dedc3a2264106e579c030730d950d59e43540e5ecb1dde9c` differs from L2's verified readiness only in that copied reference path. Original readiness and failed/colliding records remain intact.

Both versioned production runners passed clean source, frozen input/lineage/public trust, wrapper/adapter and immediate resource checks, then executed the real `timeout --signal=TERM --kill-after=30s 10800 bash rootfs/build.sh` command. x64 normal root started at 2026-09-11T15:33:25.397735Z (orchestrator 2572009, root timeout 2572927, pane %102); virt-arm64 cold1 started at 15:33:25.456886Z (orchestrator 2572011, root timeout 2572951, pane %103). Their independent clean sources are `J5_DIR/sources/production-{x64,virt-arm64}-run1`; no production BASH_ENV/DEBUG fixture is present. Each owned slot preserves 4 CPU/10 GiB/no swap and CPU sets 0-3/4-7, with the unchanged positive-headroom 3 CPU/5 GiB direct-child plus 1 CPU/5 GiB idle-daemon transition. No shared builder, tag, binfmt, cache or earlier wrapper was changed.

Initial live-state evidence is `J5_DIR/metadata/initial-root-state.json`, SHA256 `5c6ab780e966ec0014423bb525ae154e0ccd6aa6e079bc9af90cdad13c8ae4c7`; its process/environment, completed log hashes and running log-prefix snapshots are explicitly a startup observation. Live gate metadata is `metadata/W2/{x64,virt-arm64}-run1.json`, with logs in `logs/W2/{x64,virt-arm64}-run1/root-build.log`. Runner SHA256 is `a9f65d31de6a921fc1b24feaa1778c2d82111ec08414d59b04971e4abc09bafe`; versioned wrapper-inputs.json SHA256 is `709a5763d9f550044ab88dee0e5c58a1adcd169baee2aea086e2c0875852ad48`. L2 received the immediate gate-pending follow-up with HTTP 200/success=true, message `01M28HQ7MJSXAE9DGVQ6ECGCXH`; transport evidence is `/srv/station/work/tmp/mos/75btxdqb/j5-root-start-xx_ggk2j`.

The two actual production jobs occupy the allocated heavy slots until their terminal collection. Startup is not root, image, guest or cold comparison success. No J4 or earlier failed run counts toward either successful final virt cold root. B collects terminal events and dispatches the already-authorized same-node eligible successors; CX/cold2 and all remaining signed-image/runtime/physical rows remain distinct. Task ownership, notification restrictions and all crons are unchanged.

### J5 x64 terminal during startup bookkeeping

The actual x64 root ended at 2026-09-11T15:36:13.851328+00:00 with exit 1; orchestrator 2572009 and root timeout 2572927 are absent. All 12 completed step log hashes were verified. The new 90-pack pack-11 failure is `runtime composition refused: unresolved shared library libsystemd-shared-257.so for /usr/lib/x86_64-linux-gnu/systemd/libsystemd-core-257.so`. This is a new unresolved closure finding; neither the earlier tmpfiles correction nor a successful root is inferred beyond the actual log. Preserve the original source/output and do not replay the unchanged root or change loader/selector policy as a workaround.

Terminal evidence is `J5_DIR/metadata/x64-first-terminal.json` SHA256 `c2c182e4b0ed3a95bfc360ef1fd9b14d7c322234522dd4057a76ded0dc16cc29`; root log SHA256 `72c75d42b988b92a1efff2292e3aeefa7014011e6956ca4615ba518cb9f200f8`, metadata SHA256 `b944cb4004ecec53dd3ed56175ab6983d82fffe2b10494a27325348a92749734`. ARM cold1 remains running at this terminal observation, with recorded process identities in the evidence; its immutable source/wrapper/outputs continue untouched. L2 receives the exact new failing operation for the bounded diagnostic/scope successor. No production pass, cold-half success or physical claim is made.

### J5 dual-architecture ELF resolution diagnosis

The L2 terminal follow-up authorized a bounded read-only diagnosis and external proposal, with no production selector edit. The previously collected x64 terminal is reused unchanged. ARM cold1 also ended at 2026-09-11T15:41:43.709604Z, exit 1, with `runtime composition refused: unresolved shared library libsystemd-shared-257.so for /usr/lib/aarch64-linux-gnu/systemd/libsystemd-core-257.so`. Orchestrator 2572011 and root timeout 2572951 are absent; all 12 step logs verify. ARM metadata SHA256 is `24748e0074534a4d8ba655eac0d70f2d74767f610d7f458a43295ef10bd6bf72`, root log SHA256 `ac4c591ca834c24890dd63932ff5aeaf508036311a8d06758a5bf10a3ed6bd38`. Both owned daemons have only buildkitd. No process was interrupted or root retried; neither failed J5 root is a successful cold half.

Evidence is under `J5_DIR/diagnostics/systemd-loader-v1`. `arm-terminal-collection.json` SHA256 `f18583d3bac478b7b643fc1cc8f261fd2f692ee5dba0f9f9ae76ff826800ce8b` records the deduplicated terminal. `diagnostic-result.json` SHA256 `d577f1db77df5574432c6859cd4c13a32c31c4a246cc0c26bf3fab3cded382e8` binds the actual-file selector RED, pinned archive/control/member identities, ownership, loader/cache/config, SONAME/DT_NEEDED/RPATH/RUNPATH and reached graph. The one current-J5 x64 OCI pass verifies all 21 reached ELF hashes/modes/uid/gid and owners against retained inputs. The ARM graph uses actual earlier captured bytes bound to exact pinned archives; its separate J5 terminal confirms the same operation, without relabeling the input graph as a new installed-root result. CX remains unqualified.

Both `libsystemd-core-257.so` and `libsystemd-shared-257.so` are present regular files owned by the installed `libsystemd-shared` package, version `257.13-1~deb13u1`. The systemd executable needs core then shared and has RUNPATH `/usr/lib/{triplet}/systemd`. Core needs shared but has neither RPATH nor RUNPATH; neither private SONAME is in the real loader cache. `Selector.add` recursively enters core before processing the executable's shared sibling. Its global bindings check conflicting identities but do not model already loaded objects in a single entry context. The glibc 2.41 [dependency walk](https://raw.githubusercontent.com/bminor/glibc/glibc-2.41/elf/dl-deps.c) and [loaded-object lookup](https://raw.githubusercontent.com/bminor/glibc/glibc-2.41/elf/dl-load.c), retained with hashes in the evidence, establish ordered breadth-first discovery and namespace-local name/SONAME reuse. This identifies unsupported resolution semantics, not a missing package.

The external diagnostic model resolves 21 ELF nodes/53 dependency edges for x64 and 21/66 for ARM without adding search directories or inheriting RUNPATH. Actual shared-library removal, unrelated libacl removal and a new independent core entry each refuse on both architectures. Six additional small external fixtures preserve original-selector sibling RED, demonstrate model sibling/RPATH positives, and refuse missing shared, missing unrelated, inherited RUNPATH and cross-entry reuse. `proposed-fixture-v3-results.json` SHA256 is `5247db3377454c9f86e59f5e127629e1e0b4d26087ff709369ab3e18e48daa61`. These are diagnostic model results, not changed production-selector GREEN or target execution. Two earlier synthetic-fixture setup failures (`no origin: /usr/bin`, then `no origin: /`) remain recorded; complete fixture ownership resolves them without weakening the selector. The diagnostic import's own bytecode is preserved under the evidence directory, outside tracked source.

`proposal.json` SHA256 `1ac89165e04999fb82387dd504d65fad0972caed2117fad52f9cd48384fb6dc8` requests only the ELF parser/entry dependency branch in `rootfs/runtime/select.py` and direct existing `selection_test.py` fixtures: strict SONAME decoding, ordered dependency discovery and validated loaded-object reuse confined to one entry, while retaining existing conflicting-library identity refusal and all ownership/architecture/cache/search-path checks. Both files already occur in both fixed composition lineage sets; no allowance expansion, producer/pin/consumer change or private-directory fallback is proposed. The source correction still needs the exact L1 disposition through L2 before implementation. Subsequent final-source/context/receipt checks and a reviewed immutable composition successor precede any dependent root retry. Original J packages/native/kernels and all previous failures remain immutable; no W0/W1/kernel/full-suite replay or root/image/guest/physical PASS occurred.

### Current J5 loader proof after the A reference handoff

The new L1 handoff authorizes only additional read-only engineering evidence, not production repair. The seven exact A reference files were read once and their three supplied hashes verified; the valid historical proof is `proof-final/loader-proof.json`, not the empty earlier instrumentation output. A's private checker/tests were neither run nor imported. Its historical image and proof remain separate from J5. The already committed original-selector RED and dependency graph were reused without another root, producer, kernel or suite run.

`J5_DIR/diagnostics/systemd-loader-v2/actual-loader-proof-final.json` SHA256 `e0bc798a9243e673dcc7edb1874c53983f83814a394f5d2501d7de8db7f6bd58` records actual current-J5 interpreter execution. The exact x64 10-compose manifest is `cff6cb98ed27317da6a6013745b8e2d97944090b0226f05aabe7af23f897d75b`, config `abcea9dd30b313122accc7a88d0359c6f8e31611b1b60985e9bd65acce51ec60`; ARM manifest is `bf7893066cc7d2f82ba5b53e83d15c0002b36aef07d1d1583746607e54b43c3f`, config `378e20f645ccaafd596790af4871af79cc0a54829d1bfaffdacb629f82131f98`. All four layers and diff IDs per architecture remain exact. Fresh task-only load indexes change only image-name annotations, preserving config, labels and payload bytes. Current OCI capture independently binds the 21 reached ELF bytes/modes from the prior graph, retaining its archive/ownership bindings, and actual loader cache/config; the ARM content binding now has its own current J5 layer evidence.

The actual x64 interpreter `/lib64/ld-linux-x86-64.so.2 --list /usr/lib/systemd/systemd` exited 0 at 2026-09-11T16:09:35.276302Z..16:09:35.649582Z, recorded timeout PID 2590830. The actual ARM interpreter `/lib/ld-linux-aarch64.so.1 --list /usr/lib/systemd/systemd`, through the previously verified task emulator SHA256 `239ff153cde81b6a6ab2c48eef9cff234751caa8e9d841363eace8db51e000e8`, exited 0 at 16:09:51.207997Z..16:09:51.590561Z, timeout PID 2591038. Each entry's 20 actual provider paths agree with the entire 21-ELF graph. Both runs use read-only, network-none, capability-dropped containers and only ARM's explicit read-only emulator mount. No service, added library/cache/alias, LD_LIBRARY_PATH or target-file mutation is involved. This proves the current installed-stage consumer namespace; it is not a completed selected root, signed image, boot, guest or cold comparison.

The initial x64 OCI load succeeded, but Docker tag inspection returned `No such image: ai-agent/mos-b7-loader-j5:x64-proof-v2`; inspection by the original manifest digest proved the loaded immutable identity. This setup failure is retained. The continuation used that content ID without another load or interpreter retry. Exactly one loader invocation per architecture ran. Each child was inspected before start under the existing direct-child 3 CPU/5 GiB plus idle-daemon 1 CPU/5 GiB envelope. Auto-removed children and the two task-owned diagnostic image references were retired; both idle owned daemons were restored to 4 CPU/10 GiB/no swap and original disjoint cpusets. `restored-owned-envelopes.json` SHA256 `8b4366274ce5009173e12b66fe0024d2d6aec5088e9526d28aa9a30a51c3e563` records the result. No shared builder, state volume/cache, original source/output or cron changed.

`version-proof-result.json` SHA256 `ef026868e4496f5732a6a1032e1655a85d12e021ec12918ed6e5ce81ec7617d1` binds current exact readelf dynamic/version tables: 21 ELF files with 240 version requirements on x64, 21 with 138 on ARM, all satisfied by the observed exact providers. Core requires shared's `SD_SHARED`. Four in-memory metadata/identity negatives per architecture reject wrong observed-provider SONAME, changed expected provider hash, missing version and missing transitive libacl provider. They leave original ELF bytes untouched and are not additional target executions. Prior missing-library, RPATH/RUNPATH and independent-consumer negatives remain preserved. The external proposal supplement requests only the same parser/entry branch and direct test paths, including bounded version/provider validation before loaded-object reuse; no fixed lineage-set expansion. Optional SONAME absence is not converted into a universal missing-library rule, and A's artifact-specific whitelist/equality policy is not a production template. Production repair still requires the exact L1 disposition through B. Original J package/native/kernel identities, both failed J5 roots and outstanding root/cold/image/guest/physical rows are unchanged.

### Approved independent ELF entry correction

L1 approved only strict DT_SONAME parsing and the directly necessary ordered ELF dependency traversal/context in select.py, direct selection_test.py fixtures and these existing records. Both fixed lineage sets remain unchanged. Source tests establish RED before production edits, then exercise real select/copy/verify on retained architecture inputs and bounded other-entry checks. The already completed current-J5 loader/version evidence and earlier failed roots are preserved without replay. The grant does not authorize ELF symbol-version parser expansion: existing exact provider/version input evidence remains separate. The correction must preserve requested-name/actual-SONAME identity, independent entries, first discovery context, global conflicting-library/cache refusal, RPATH/RUNPATH, architecture, interpreter, ownership and report/copy checks. No systemd-specific rule, production loader/cache/config/pin change or compatibility fallback is permitted. A clean source candidate and actual final lineage/receipt/context/native/tool/trust checks precede B review and affected production successors.

### Independent ELF entry correction evidence

The change is confined to `rootfs/runtime/select.py`, `tests/rootfs-runtime/selection_test.py` and these two records. The parser now validates an optional unique SONAME using the existing bounded string-table decoder. A per-entry FIFO resolves direct DT_NEEDED siblings in declaration order before child traversal and registers only validated requested names and actual SONAMEs. Canonical objects keep their first discovery context; retention does not suppress validation of a later independent entry. Existing strict global identity/cache conflict, architecture, symlink, interpreter, RPATH/RUNPATH, owner and copy/report checks remain. No loader-directory, consumer, package/pin, lineage path-set or symbol-version parser change was made.

Evidence is in `W/metadata/elf-context-correction-v1`. The original source-bound entry RED ran 10 cases (5 failures); the separate duplicate-SONAME RED failed once. A further original-source breadth-first grandchild fixture fails with unresolved `libshared.so` before the corrected selector succeeds. The final selector suite passes 82 tests, including requested-name and SONAME reuse, sibling/grandchild ordering, bounded cycles, first-context preservation, independent-entry refusal, missing/transitive/wrong-architecture providers, duplicate/malformed SONAME, ambiguous cache and conflicting aliases. Four direct composition/capture tests and the exact-file release lineage/nanosecond gate (18 tests, 45 assertions, one file) pass. The initial direct `source_lineage_test.py` command had no test runner and executed zero helper tests; it is not helper GREEN. The separate explicit six-test unittest runner supplies the helper/context/stamp/lock/native/mode/deletion evidence.

The actual corrected select/copy/verify CLI passes on both retained systemd architecture graphs: x64 91 paths/21 ELF files and ARM 89 paths/21 ELF files, with exact prior archive/current-J5 loader/ownership bindings. Three actual-input refusals per architecture preserve missing shared, missing unrelated libacl and independent core-entry isolation. The existing current-J5 target-loader and version/provider proof was not replayed; these new results are changed-selector evidence, not new target executions.

One bounded pass checks the other selected ELF entry graphs against current J5 installed OCI metadata and captured ownership: 761 entrypoints and 857 reached ELF files per architecture, zero dependency refusals. `selected-entry-collection.json` binds both results. It does not qualify non-ELF configured transformations, a complete installed root or CX. The first pass refused a diagnostic subset mode mismatch at `/usr/bin/chage`: an earlier fixture materializer had called chown after chmod, clearing 14 set-ID modes per architecture. Only new private fixture copies were restored to the exact current OCI modes. The subsequent x64 pass succeeded; an ARM source-directory locator setup error was retained, then only the unexecuted ARM continuation ran using the actual `production-virt-arm64-run1` path. Neither failure was waived or counted as a product/root result.

Original J packages/native/kernels, both failed J5 roots, prior RED/setup failures and A historical evidence remain immutable. The candidate will keep package source/version/producer epoch at J and fixed root epoch 1577836800; its own composition commit/tree/epoch must be verified by the unchanged lineage helper before L2 review. All root/cold/signed-image/guest/API/lifecycle/storage/service and physical evidence rows remain outstanding. No producer, native, kernel or root rebuild ran for this correction.

### Frozen J6 candidate and component reuse verification

The isolated correction is `ad56474bcf394cff995764eed1671462f8ddd4a5`, tree `61ee87675eb3a5085368bbeedc9e2ac757bfcd24`, composition epoch `1789144684`, parent `f21293349429f492c375b87834bb30a1d0c2f9a7`. The later record commit is not payload source. PMA-CR finds no introduced issue; `W/metadata/elf-context-correction-v1/precommit-review.json` SHA256 `39e1b02d78197421c81668f33843e6d2a4e902f6e85ce2f397a635820c21d29e` binds source, exact scope, unchanged script-interpreter/other-selector-method ASTs and meaningful gates. Both fixed lineage path sets remain unchanged.

Two clean independent snapshots at `W/J6-ad56474bcf394cff995764eed1671462f8ddd4a5/sources/verification-{1,2}` ran the actual successor helper against the complete frozen original J pools, receipts, tools and native exports. Both produce identical deterministic bytes: amd64 `8151dfc07540f78470ec58b5b180274b54b632830700be89089b6209a0c34175`, arm64 `d9db79fc678bc4fdeb342f1335aa6d993cc76356f135e76b5b5d98f414affedc`. The whole 15-path delta and real producer-context exclusion checks pass. Package commit/tree/version/epoch remain original J/`7e8e8bc62b52f3d78263d717e186a07f0d3430a1`/`0.1.0+gite176876b733d-1`/`1789097968`; root epoch remains `1577836800`. Three actual rootfs callers reach the deliberate exit-79 boundary with original package identity; this is source/input plumbing proof, not a production root.

`J6_DIR/metadata/candidate-inputs.json` SHA256 `63630e00afe2f10d0adb928416c163d34ca5f2821f9a536ccad605c813df8f63` and `successor-readiness.json` SHA256 `fa13d6eabad504e9592224016078489b512057b30810e41b744406c161282ebc` bind all three board configurations, unchanged selected upstream inputs (162/162/174), pool/receipt/public-trust identities and separate verifier source. The readiness inherits the exact L2-recovered J5 runtime-link audit payload reference and adds the actual selector graph, required refusals and selected-entry audit; it does not reuse the collided historical audit filename. Root/support/signed-component/image bytes and their checks must be produced at J6 after L2 review/input collection, with x64 no-cache=0, both equal-input independent virt roots no-cache=1, and CX no-cache=0. No original J package/native/kernel is relabeled or rebuilt. All existing physical, guest and complete-root limitations remain open.

### J6 production start and first terminal

L2 accepted the exact composition candidate and independently verified original J inputs; the local B integration label does not change payload source. J6 production uses `ad56474bcf394cff995764eed1671462f8ddd4a5` / tree `61ee87675eb3a5085368bbeedc9e2ac757bfcd24` / epoch `1789144684`, original J package/native/kernel identities and root epoch `1577836800`. No accepted source suite or current-J5 loader proof was replayed.

The new task-owned `J6_DIR/tools/root-v1` preserves the previous recipe arguments, checks, strict OCI adapter and refusal thresholds. Only composition/path/tag/event/readiness identities and actual tmux-pane recording change; MAKEFLAGS is tightened from -j5 to the granted compiler ceiling -j4. Wrapper inputs SHA256 `cae1633fdcfceff967ddc6cb6b788195350c1ae32f78f361e7d09fb79e535607` bind every old/new script. The launch preflight initially treated a shared builder's docker-init plus buildkitd as an active build; the instrumentation assertion is preserved separately. Read-only process inspection established only those two daemon processes. The corrected observation preserves all existing station/unrelated CPU<50%, disk/memory, owned-daemon and positive-headroom checks; no shared resource was modified. Fresh capacity was 6/30 with 24 available execution slots, and both owned daemons were idle at 4 CPU/10 GiB/no swap with cpusets 0-3 and 4-7.

Both actual root commands started after their own full input/resource checks: x64 at `2026-09-11T16:57:21.075355Z`, orchestrator `2608907`, root timeout `2609834`, pane `%105`; virt-arm64 cold1 at `2026-09-11T16:57:21.096927+00:00` (see exact step metadata), orchestrator `2608919`, root timeout `2609847`, pane `%106`, session `75btxdqb-7e0f1b`. Each executes `timeout --signal=TERM --kill-after=30s 10800 bash rootfs/build.sh` in its own clean `J6_DIR/sources/production-BOARD-run1`, with ordinary x64 no-cache=0 and virt cold1 no-cache=1. No production BASH_ENV/DEBUG fixture is present. Outputs, logs and temporary tags are confined to J6; the source-bound initial snapshot SHA256 `73ae5f99664f7b770043b27a69c72a1763232331beff5fc76712475c6f8473f3` contains real process/environment/argv, resource identities and immutable log prefixes. The bounded direct-child 3 CPU/5 GiB plus idle-daemon 1 CPU/5 GiB route remains enforced.

The x64 root already reached a new terminal at `2026-09-11T16:58:26.903664+00:00`, aggregate `2026-09-11T16:58:26.908425+00:00`, exit 1 in 90-pack pack 11/19: `runtime composition refused: script interpreter of /usr/bin/routel: missing env command: python3`. The preceding systemd shared-library error is no longer the stopping point. `J6_DIR/metadata/x64-first-terminal.json` SHA256 `1b969730eb0825efefe4f6b49784e964b53495feaf9dfa3e272de9216a4c123d` records PID absence, clean frozen source and all 12 completed step-log hashes. Root metadata SHA256 `9a4f44f66e7024f305e6d2f1711a55ad167de59e353401d3a9c4938f6c9e2b3f`; root log SHA256 `55ef0a0c6d4b75f493262785622b0f2d08cadffcafa35b1b8573adb070d52e4e`. The existing 761-entry/857-ELF input audit explicitly covered ELF graphs, not all non-ELF script/configured transformations. This new actual script closure failure is preserved without adding Python, removing a selected tool, modifying declarations/pins, weakening the interpreter check or restarting the failed root.

At terminal collection ARM remained running on immutable J6, PID `2609847`; it was neither interrupted nor modified. Actual gate-pending and x64 terminal reports were sent to the same L2 B endpoint with HTTP 200/success=true. The x64 slot is free after collection, but dependent root attempts require this newly evidenced script contract to be resolved first; no CX/cold2 replay was started. Original J/J2/J3/J4/J5 failures and all successful original package/native/kernel outputs are preserved. No full root, cold comparison, image, guest, lifecycle/API/storage/service or physical acceptance is claimed.

### J6 routel interpreter diagnosis

The L2 read-only successor was consumed without a product edit or root restart. Both J6 roots are terminal failures. ARM cold1 ended at 2026-09-11T17:04:26.637359Z (aggregate exit 1); PIDs 2608919/2609847 are absent and all 12 step logs verify. It has the same `script interpreter of /usr/bin/routel: missing env command: python3` refusal. ARM metadata SHA256 is `00ebb671dbd2810e8bf5e7bdefe9bd50f55a2b1bb7f3674ad9a9ba81b6280df7`; deduplicated terminal collection SHA256 is `fe1904d01bf8dac05cc78345d1860933fa623c0be72f2270005d5d208223cbe2`. The earlier x64 collection remains unchanged. No active root or successful cold half remains.

`J6_DIR/diagnostics/script-closure-v1/collection.json` SHA256 `5cd425449cbf4bdc6f795942cc3acfe8414fe1c2f26214a10b588583ca6ddfd5` binds actual J6 10-compose OCI layers, package status/ownership, script and interpreter metadata, pinned iproute2 controls, commands and all original gate logs. Each installed architecture contains 173 packages and 52 selected script entries. The CX diagnostic overlays 16 exact locked/local archives on the ARM input, yielding 188 package-input rows and 64 selected scripts; it does not execute maintainer scripts or qualify a CX installed root. The sole actual missing interpreter across these inputs is routel's python3. Every other selected recursive shebang/env chain resolves through the actual owned shell/env files. This bounded pass does not claim closure of commands dynamically invoked by script bodies or arbitrary language modules.

Both pinned iproute2 6.15.0-1 archives own the same regular 0755/root:root routel script: 1,658 bytes, SHA256 `e348c708ec6d0b3252b5ac42b21a27c7dafad2ca32e1bba2f19aee3b7bf45bbe`, shebang `#! /usr/bin/env python3`. Their controls declare `Suggests: python3:any`, not a mandatory Python dependency. No Python package/interpreter exists in the actual installed views or selected CX inputs. The unchanged mos-system iproute2 wildcard reaches routel; `Selector.add` correctly retains env and then refuses the absent PATH command. Routel formats `ip -j route list` output using sys/json/getopt/subprocess; the ip executable itself is present.

The current production CLI reproduces the exact real-script RED for both architectures. Two actual shell/env select-copy-verify controls and eight missing env/shell/unrelated-interpreter/resource negatives pass in the final bounded fixtures. Preserve the earlier fixture preparation failures (missing generated profile/cache origin and incorrect CX archive locator). The first CX diagnostic incorrectly marked the nonexecutable functions.sh resource executable; the isolated correction uses its unchanged resource declaration and succeeds, leaving routel as the sole real refusal. External proposal select/copy/verify completed successfully for 18 iproute2 entries on each architecture, but the enclosing proposal wrappers remain exit 1 because their subsequent negative instrumentation failed: x64 rewrote the selected-list argument, while ARM expected different wording for its actual missing-ip filesystem refusal. No failed aggregate is counted as GREEN and no unchanged positive was replayed.

`proposal.json` SHA256 `5a3d732ebcdd916f9af764062a8f0bf58d431bca0a2f1f3646990ee9d4b070ff` and external patch SHA256 `42e475e09c820ee0e2f0c7817691e639527781465c8152c0e1122a6275f645e9` offer the smallest concrete declaration option: replace only the iproute2 row's wildcards with its 18 exact non-routel entry paths. This would stop shipping the optional formatter and therefore requires the exact L1 scope decision; S5's rejection does not authorize applying it. If routel must remain, the alternative requires an explicitly verified pinned Python and stdlib/resource closure, not an interpreter skip or an assumed python3-minimal solution. No production declaration, pin, selector, lineage set, package/native/kernel, source identity or source snapshot changed. The records remain in progress; L2 receives this bounded proposal before any dependent root successor.

### J6 S5 and named-resource diagnosis supplement

The complete L1 supplement was consumed in the same read-only diagnosis. Both J6 roots remain terminal failures, with no live root or new heavy job. Their existing terminal, 52-script-per-architecture audit and CX 64-script input audit were reused without replay. Production source, frozen inputs and prior evidence remain unchanged.

B4's operator transfer contract and B5's actual `compose.py` surviving-executable guard require retaining routel. The earlier external 18-entry proposal is therefore superseded: an isolated execution of the exact committed guard against the real transformed 0755 routel refuses `operator executable omitted: /usr/bin/routel`; its retained-entry control passes. This is a guard fixture, not full composition success. No tool was removed or policy changed.

Evidence is under `J6_DIR/diagnostics/script-closure-v1/s5-supplement`. `collection.json` SHA256 `5539582984659ee6838036478fac3615c53d5a27836bdea40f20a056450cbe24` binds 136 supplemental evidence files and the preserved original delivery. `combined-proposal-final.json` SHA256 `fb3d8ba7ca9f292a6de58810800c47a263dac234abdbba1b1fd7de62c9272246` is the single current proposal; its unapplied patch SHA256 is `0435f4c1cf9b1d1036450a8ae7fa3172888a3b22e8554ba77bfa149cc1e89964`.

The fixed Debian 20260905 snapshot's InRelease signature and both package-index hashes verify. Six downloaded archives were checked against those exact signed-index identities and controls, without installing packages or executing target code. Keeping routel requires the candidate `python3-minimal` 3.13.5-1, `python3.13-minimal` and `libpython3.13-minimal` 3.13.5-2+deb13u3, plus their owned interpreter/stdlib/default/helper resources. Actual minimal archives contain json, getopt, subprocess and encodings; required built-in module symbols and current production select/copy/verify pass on the external real-byte fixture (424 x64 / 422 ARM paths, eight control dependency checks each). Existing installed libc6, libssl3t64, libexpat1, zlib1g and dpkg satisfy the declared installation constraints. Dpkg remains removed from the final image: optional Python package-database helper modes are not qualified, and no package-manager restoration is proposed.

The three archives total 3,114,764 / 2,886,084 compressed bytes and 12,370,964 / 12,231,701 regular unpacked bytes for amd64/arm64. The proposed Python runtime subset accounts for 12,213,212 / 12,073,949 regular bytes before final packing. These are archive/fixture measurements, not final hardlink/xattr, SquashFS/verity, memory or guest results. The original select-only caller on an isolated proposal input copy selects 165/165/177 upstream rows for x64/virt/CX, exactly three more than 162/162/174. Existing pin files are byte-identical; the 15 real producer contexts do not consume the three proposed new pin paths. Both fixed lineage sets would need exactly those three additions after an explicit scope disposition; no set was changed.

Read-only metadata copies from the two idle owned BuildKit daemons identify the actual J6 pre-failure snapshot chains: x64 413 through 422, ARM 443 through 452, bound to J6 source-lineage and cache parent/command records. Named resource subtrees were read from those chains without executing a build or service. The 18/18 actual transformed named-resource rows and 25 CX locked-input rows identify additional declaration omissions: tzselect's country/zone tables and timezone data, plus update-shells' baseline and Bash/dash fragments. They are present inputs, not missing packages. The proposal retains their existing owned resources (630,088 additional regular timezone bytes and 106 shell-template bytes). The present 685-byte e2scrub.conf is also undeclared; its script permits built-in defaults, so preserving it is separately classified as configuration preservation, not the routel interpreter failure. Existing PAM, health, account, factory-shadow, SSH, hostname and resolver declarations remain; runtime-generated DATA/run targets and CX board behavior still require actual acceptance.

Only consumer resource additions, three exact new Python pin files, their two fixed lineage-set additions and direct existing tests are proposed. Selector strictness, iproute2 pins, existing tools, producers, signatures, authentication and runtime policy remain unchanged. Original real RED and refusal cases are retained. The supplemental duplicate-package index parser, public-key/tool setup, binary metadata decoder, incorrect lineage-field lookup and empty-tar instrumentation failures remain recorded separately; successful recovery outputs do not relabel those gates. No unchanged full suite, producer, native, kernel or root was replayed. L2 receives this exact combined packet for L1's production-hunk disposition before any implementation or dependent root successor.

### L1 retained-routel decision and actual Python module evidence

L1 explicitly declined the historical 18-entry omission alternative and confirmed that unchanged routel and the complete existing iproute2 set must remain. The decision permits bounded fixed-input acquisition and completion of the current packet, but grants no production pin, consumer or lineage edits. Prior script/resource inventories, six verified binary archives and original terminal evidence were reused. No production root or unchanged test matrix was replayed.

The remaining actual-module check is complete under `J6_DIR/diagnostics/script-closure-v1/python-runtime-v1`. Using the existing pinned, task-owned BuildKit route, each architecture ran one short FROM-scratch input fixture containing only the previously verified selected bytes and a fixed diagnostic program. It imported the actual Python json/getopt/subprocess modules and executed the unchanged routel through its real env/python shebang, including its real ip subprocess. Four read-only IPv4/IPv6 queries per architecture exited 0 in network-none execution; no interface, service, guest or external endpoint was configured. BuildKit reported the actual RUN duration as 0.5 seconds for amd64 and 4.7 seconds for ARM. Both daemons retained 4 CPU/10 GiB/no-swap and disjoint cpusets, with fresh CPU/memory/disk/quiescence checks. Source fixture bytes remained identical, and both daemons were idle after collection. This is target userspace input evidence, not a completed root/image/guest or native ARM host claim.

Each run traces 51 imported file-backed modules to exact package/ownership/report hashes. The actual archive sitecustomize symlink resolves to its owned `/etc/python3.13/sitecustomize.py`; no fabricated alias, PYTHONHOME, LD_LIBRARY_PATH, pip or third-party module is used. The original missing-interpreter RED and strict resource/interpreter negatives remain unchanged. The new package candidate remains exactly python3-minimal 3.13.5-1 and python3.13-minimal/libpython3.13-minimal 3.13.5-2+deb13u3, selected by mos-system for amd64 and arm64, including CX's existing mos-system selection. No additional binary dependency was discovered by actual execution.

The already verified fixed InRelease binds newly acquired Sources.xz SHA256 `e8bbadd8389119e841494630998187f961d7de4d5b1dcbeed4f792a1d423299f`. Exact source descriptors are python3-defaults 3.13.5-1 SHA256 `206e2f527ca126e46f007b3dd668ae9d35a03c7653bee137a03161df33063d2c` and python3.13 3.13.5-2+deb13u3 SHA256 `2f6c3f83cd3de0355f4411807871a95f99a0aae9b397daba5dbdbf1bd5169cc8`. Their source archive names/hashes are recorded without claiming those tarballs were downloaded or rebuilt. All three actual copyright files remain selected by the existing contributor-license rule. The existing producer-context proof and original J local component identities remain prerequisites for final reviewed source reuse, not blanket equivalence claims.

The proposed new Python subset plus its retained copyright files occupies 12,329,044 / 12,189,781 hardlink-aware regular bytes in the amd64/arm64 input fixtures (323 reported paths each). Prior compressed/archive and named-tool-resource measurements remain separate. Final packed bytes and filesystem overhead are unknown. SYSTEM stays exactly 1 GiB, with two full deployments plus 128 MiB reserve and the stricter actual ext4 overhead/reserved/internal-cluster check. The raw geometric ceiling is 448 MiB per SYSTEM deployment before that overhead; CX includes boot content in the same amount. EFI boards also retain their separate 512 MiB ESP/two-boot/64 MiB reserve check. No budget, reserve or partition change is proposed and no capacity PASS is claimed.

`successor-proposal.json` SHA256 `34fdfe6f0ff7bd32ebff31d9ed49d0f161f85963578e6bbc913ae3432fa1a607` is the single input-bound successor packet, extending the previous unapplied exact patch with actual modules, source/license bindings and capacity limits. `collection.json` SHA256 `d74837c0be8f40ee9a8724ae348f18b8dce886931ec5fd87a236913425ea6da8` binds 36 new evidence files and the prior supplement. The source-index multiline-field parser error and initial symlink-digest attribution error are preserved; their corrections reused existing bytes/results without replaying target execution. Production source and all original J components remain unchanged. L2 receives this packet for the exact code-hunk grant and later reviewed successor/input freeze; all root/cold/image/guest and physical obligations remain open.

The remaining recursive control pass is also complete: `python-runtime-v1/recursive-package-inputs.json` SHA256 `7f202318cbd6af8dbc8c4d13046f31c404e020420814db584e38be99cc9cb923` binds all 19 reached packages and 38 Depends/Pre-Depends edges per architecture, using the real installed controls and exact new archive controls. Every existing and proposed lock path, file digest, target version/architecture/archive digest/URL and selected-consumer set is retained in that record. The closure requires only the three proposed new packages; the other 16 remain existing inputs. This read-only pass does not install, update or rebuild them.

### Approved retained Python correction implementation

Campaign `mos-open-plans-20260910-100408`: the recovered complete L1 implementation grant (SHA256 `1875a4ac377a7f46cca603e747955ed6818410883d4221bd666b07aae918fdf7`) authorizes the exact external patch `0435f4c1cf9b1d1036450a8ae7fa3172888a3b22e8554ba77bfa149cc1e89964`: three fixed Python minimal-package pins and five owner-bound Python/timezone/shell/e2scrub resource rows in `rootfs/runtime/consumers.json`. Only those three new pin paths may be added to the fixed Python and release composition lineage sets. Direct regressions use the existing selection, lineage and release test files. No selector, operator guard, producer, existing pin or release policy changes are authorized. Existing snapshot/version pins take precedence over dependency freshness defaults for this immutable acceptance wave.

The target Python/module/routel subprocess and recursive source/license input proofs at records `7b2f1f69` and `6b5c1c2f` are complete and will be reused without target execution replay. Source tests must first expose the missing retention/lineage behavior, then pass on the exact approved changes with missing interpreter/module/named-resource, wrong owner/input and unapproved-pin/context controls. Final actual locked selection must be 165/165/177; original J pool/native/kernel bytes and release identity remain unchanged. A clean correction and deterministic final-source input proof precede L2 review and automatic affected W2-W4 successors. No root or final packed-capacity success is claimed by these source checks.

### Superseding user direction: omit only routel, no target Python

The user explicitly changed the product direction after the preceding grant. Only `/usr/bin/routel` may be omitted from its iproute2 owner; every other existing iproute2/operator entry and all original pins remain. The three new Python pin files, their two resource rows, fixed-lineage additions and Python-only tests are withdrawn from the implementation and preserved under `W/metadata/no-python-correction-v1` with the complete uncommitted patch. The parent also preserved `/tmp/mos-no-python-direction-dwEX0U/b7-uncommitted-before.patch`. Earlier input/target execution successes and the historical declined omission remain evidence of their original scope, not current target requirements.

Current authorized changes are the exact iproute2 selection row and the narrow owner-bound composition surviving-operator exception, necessary direct selection/composition tests, and these records. The independent tzselect timezone, update-shells templates and existing e2scrub defaults remain approved resources. No selector interpreter/ELF/ownership refusal or lineage path set is broadened. Both existing affected production paths are already within the fixed composition set. Real selected script/resource inputs and production select/copy/compose controls must pass before review; missing unrelated interpreters, omitted retained tools and wrong ownership still refuse. Original J package/native/kernel and unchanged upstream inputs remain reusable only after final-source verification. Root/cold/image/guest results remain pending.

### No-Python source checks and review

The final production delta is two files: the iproute2 declaration names its other 18 entries explicitly, while compose accepts only an omitted regular `/usr/bin/routel` with sole owner `iproute2`. A symlink substitution, another owner, another omitted operator, selected routel or missing interpreter of a retained script still refuses. Three independent existing-tool resource rows preserve timezone tables/data, shell templates and e2scrub defaults. All original upstream pins, both fixed lineage sets, selector code and package/native/kernel bytes remain unchanged; no Python target package is introduced.

Under `W/metadata/no-python-correction-v1`, valid source RED records reproduce missing Python and the surviving-operator routel refusal. Direct GREEN comprises five selection/resource tests, six composition/capture tests, three source-context/default-source controls, and two release source-role tests across exactly one Bun file (six assertions), plus syntax and scoped review. The first compose fixture omitted its retained env declaration and two negative fixtures attempted to overwrite a prior snapshot; both setup errors are preserved and corrected without changing production behavior. The superseded Python test preparation/zero-test records also remain historical, never GREEN.

The current-source real-input batch verifies 51 selected scripts per installed x64/virt input and 63 in the CX locked overlay, with 513 named-resource metadata/owner checks each. x64/virt completed before a stale CX diagnostic classification stopped the aggregate; their successful results were reused. The corrected final batch consumes the already-established effective CX resource-kind proof. CX remains locked-overlay/shared ARM transformed-resource evidence, not an installed CX result. Original pin selections are byte-identical: 162/162/174. The tar-type instrumentation error and original aggregate remain preserved. `actual-inputs-result.json` binds each input and original archive/control/source evidence. No target Python, ELF suite, root or kernel was replayed.

PMA-CR scoped review has zero introduced findings. Freeze this correction independently of later tracking commits, then run final clean-source receipt/context/native/lineage validation and the real captured iproute production compose/copy/verify fixture before L2 review. The successor uses original J package identity and unchanged root epoch. All complete-root, cold, image, guest, service, lifecycle and physical evidence remains outstanding.

### Frozen no-Python successor and actual input handoff

Composition source is `ce361585dc6971ad42bae870e590a1dbebb38b82`, tree `186b1dea92b61bee0dda22394c33a702d44cf272`, Git epoch `1789153454`. The separate namespace is `W/J7-ce361585dc6971ad42bae870e590a1dbebb38b82`. Two clean independent verification checkouts run the unchanged lineage helper against the actual original J frozen pools/receipts/tools/native exports. Both architectures pass the whole allowed delta/context and original package identity checks; deterministic outputs match between directories: amd64 `1cdff4f87dfa1dcbe4d7b0771624be05f7fa37c02797e7ee1e40ef4e87dac44f`, arm64 `2605d690bcdb866868909a9d960d6a995db7b5ce78bd698cce2f39cac3f50e38`. Original package version/epoch and root epoch remain unchanged. Three actual rootfs caller checks stop at the deliberate exit-79 fixture boundary; production has not run and must not inherit that boundary environment.

The frozen production compose/copy/verify code also succeeds on real captured iproute2 files and their actual ELF closure: x64 retains all 18 expected entries in 110 report paths; ARM retains all 18 in 108 paths. Every entry preserves original owner, bytes/symlink target and mode. Routel and Python are absent. This is a bounded real-input fixture with generated inventory and isolated installer tables, not a complete root or guest. It retains actual archive/source identity joins and the new composition lineage; no target command, service or historical Python test is executed.

`J7_DIR/metadata/candidate-inputs.json` SHA256 `110eb7054f85e359438a21e0f733b837b594f2aea4083e9a49a7da3f38b20a1b` and `successor-readiness.json` SHA256 `9a9ae36f872d9b5d14ec84add771c04562502ef8f6e96846080605e222416c9c` bind the board selections, 162/162/174 unchanged fixed upstream rows, public trust, separate C verifier, original components and 35 checked readiness references. The first readiness recorder used an incorrect existing field name; that error is retained and only the recorder was corrected. No source, gate result, input bytes or tests were changed/replayed for that recovery.

L2 receives the clean source and this evidence for independent bounded review/integration. Afterwards the existing automatic affected W2-W4 grant applies to this exact successor, with at most two capped disjoint heavy jobs. Both successful virt cold roots must use the same final source and equal inputs; every previous failed root remains a failure. No producer/native/kernel replay, hardware qualification, main write, push, publication, done transition or sibling notification occurred.

### Phase1 combined static-shutdown source and x64 producers

Campaign `mos-open-plans-20260910-100408`: the complete reviewed B handoff returns the sole B L3 allocation to this existing executor. B3 has settled; no sibling is woken. The authorized local no-ff synchronization is `d279c0086ebf64ebe52d58e50b0b64a581eb61fa`, preserving the original record head and all reviewed ancestry. Actual frozen production source is independently checked out at `fb6c4597bb902f69d528bcdc3c8372f310c322b1`, tree `cbf2fa8ff2c8fc03534b218c952a511b6a6ba392`, Git epoch `1789157855`, version `0.1.0+gitfb6c4597bb90-1`. Its new namespace is `W/Phase1-fb6c4597bb902f69d528bcdc3c8372f310c322b1` (P). Neither this local merge nor later tracking relabels production bytes. No target Python or additional iproute2 omission is introduced.

The new production native hook completed at 2026-09-11 20:35:26 UTC with exit 0, from P/sources/producer-x64: `timeout 7200 bash pkgs/mos-deploy/hack/build-deb.sh --producer boot --bins "mos-init mos-shutdown" --arch amd64 --stage P/artifacts/amd64/native`. Actual output is mos-init 1,673,848 bytes, SHA256 `738391aa650a58fb3819f52831f6affd57ddd17e357c2a161faaf39d800ec642`, and static mos-shutdown 2,047,144 bytes, SHA256 `d2c5c9a6e2473c0125670031c79014c6ee946b834e2e26f32a65f38939e68b35`. These equal B3's measured bytes but were actually rebuilt from the combined source in separate targets; the retained dynamic startup and static shutdown routes were not relabeled. Production static ELF refusal checks passed. GNU NSS linker warnings remain in the log, and this is not real guest shutdown or memory evidence.

`P/metadata/native-v2/result.json` and `terminal-collection.json` bind the source, unchanged Cargo.lock/tool pins, actual Rust image `sha256:b13d4a7b877c9d6dd9a2766c4e80f1fd020218715d62877c69ce0dc2abe4fc12`, private fixed-cache copy, exact compiler argv, source read-only/target-and-cache writable mounts, create/inspect/start metadata and terminal outputs. The real caller boundary and eight resource/architecture/forwarding refusal controls passed. Native-v1 stopped only the proven idle owned ARM daemon, retaining its labelled state; its immediate post-stop inspect raced asynchronous AutoRemove and failed before compilation. Native-v2 reused the completed source/cache/checks after actual absence was observed, preserving the original failure. A subsequent report-time top observation raced the already completed native child; no nonexistent running snapshot was claimed.

The existing lineage helper was run against the actual new clean source and original J source/pool/receipt. Its source-bound RED is `source lineage refused: source lineage: package-relevant source changed: build/src/kernel-package.ts`. `P/metadata/native-v1/consumer-input-assessment.json` records the full Git delta, all 15 primary/named producer contexts and actual inputs. Changed deploy/native/boot inputs require new producers; they cannot be admitted by broadening composition-only exclusions. The existing rootfs single-stamp guard, Python lineage pool/native/source checks, strict release lineage parser and package-gate stamp checks cannot yet describe retained original-J packages plus the rebuilt deploy/native. This exact consumer gap and a bounded explicit producer-receipt/source/version/epoch join proposal have been sent to B for technical disposition. No guard, source identity, schema or stamp has been changed. Complete transitive/tool equality still precedes each unrelated component reuse; declared-context equality alone is not final reuse proof.

The independent changed deploy producer actually started at 20:40:01 UTC: `timeout 7200 bash build-env/deb/build.sh --producer deploy --arch amd64`, followed only by the original `repo.sh --arch amd64` index command. Its separate target and empty new pool preserve successful native outputs and all original J pools. `P/metadata/deploy-v1/result.json`, `start-observation.json` and `P/logs/deploy-v1/deploy-build.log` record actual execution (orchestrator 2716008, producer timeout 2716271, persistent tmux `75btxdqb-7e0f1b` pane `%101`). The launch observation is not a terminal result. The actual original producer hook is preserved; five direct wrapper refusals and fresh station/unrelated CPU, disk, memory and idle-daemon checks passed. Direct compilation/index uses 3 CPU/5 GiB plus idle BuildKit 1 CPU/5 GiB; packaging uses the owned 4 CPU/10 GiB BuildKit only, always no swap and cpuset 0-3. The owned ARM daemon is absent with state retained; no ARM work was launched.

The boot-tools default recipe is also recorded as an unresolved Phase1 route: `pkgs/mos-boot/build-tools.sh` invokes a Dockerfile whose shared tools stage copies the changed initramfs before unconditional x64 and ARM loader/BusyBox compilation. It has not been executed under an x64-only grant. An exact existing-input reuse or bounded x64 production route must precede that producer; it does not block the independent deploy job.

Phase1 remains x64 software/image/runtime acceptance. Phase2 virt-arm64/CX images and equal-input cold roots are deferred until the separately approved actual main merge, with original ARM identities retained and no PASS claim. Root/image/guest/API/lifecycle/storage/service/capacity/RSS and physical evidence remain outstanding. No successful unrelated producer or kernel, B3 source suite, original root or historical target-Python test was replayed. No main, push, publication, done transition, sibling or parent progress notification occurred. Actual native terminal and deploy gate-start reports were accepted by the sole B endpoint with HTTP success and `success=true`.

The deploy producer and original index have now completed successfully at 20:41:10 UTC. The new archive is `mos-deploy_0.1.0+gitfb6c4597bb90-1_amd64.deb`, 757,444 bytes, SHA256 `5c86a35df5ce3a495fdd8390f40a6e3d099fac4f10346e53783481ccda281168`. Its actual compiled and archived `/usr/bin/mos-deploy` is 2,631,888 bytes, SHA256 `20217cdc353dcc57e7d6fb07a4b0d62a09c87ee0b49ff0a595d3943ed22c0528`, mode 0755 and uid/gid 0. `P/metadata/deploy-v1/archive-payload-proof.json` joins archive/control/owner bytes to the real new target. Package-tool diversion warnings are retained. No producer replay was needed; all original-J archives and the newly completed native outputs still match their hashes.

A separate diagnostic checkout at the same frozen combined source contains exactly 14 unchanged original-J archives plus the new deploy archive, indexed by the unchanged production `repo.sh` and fixed bounded Debian tool. The actual `bash rootfs/build.sh` caller then refuses before any root/container build: `manifest.txt carries more than one git stamp: gite176876b733d-1 gitfb6c4597bb90-1`. `P/metadata/mixed-caller-v1/result.json` records successful reproduction of this expected exit 1, actual archive/index bytes, clean source identity and rootBuildStarted=false. No simulated package, modified stamp, ignored check or production-root fallback was used. `P/metadata/consumer-identity-proposal-v1.json` SHA256 `6ecf69b3dfda4c8916556566b4211e33dbae8010e2d1eb1de8e51f0bf3285e1a` binds the exact four consumer/gate paths and direct regression surfaces requiring technical disposition; compose capture/installed joins and package release identity must remain strict. Both producer jobs are settled. Root production remains blocked only by the identified source/consumer identity contract, with the x64 boot-tools input/route assessment separate. These terminal results supersede the earlier gate-start observation without overwriting it.


### Phase1 boot-tool input assessment and resource allocation

Campaign `mos-open-plans-20260910-100408`: the later B resource assignment reserves this executor's aggregate 4 CPU/10 GiB/no-swap envelope on CPUs 0-3, including its daemon/child split. Worker 347 separately owns 2 CPU/4 GiB on CPUs 4-5. The old conditional 8 CPU/20 GiB concentration is unavailable while that assignment remains. No other worker source, resource or gate was imported, changed or awaited; production identity remains the clean frozen `fb6c4597bb902f69d528bcdc3c8372f310c322b1`. The completed native/deploy results and prior mixed-source refusal were not replayed.

The bounded read-only tool inspection ran at 20:52:53-20:52:54 UTC in persistent pane %111 (PID 2726592). `P/metadata/boot-tools-input-v1/result.json` SHA256 `80ab0cb1883b4bf07a15e7afefbef09fac49db46f8c6a2f10cf8fee552e3192d` records 16 timed steps, immutable image identity, exact copied inputs and cleanup. The task-labelled, mount-free container was created with 1 CPU/256 MiB/no-swap and read-only/no-new-privileges/cap-drop controls, but never started; it was confirmed in created/stopped state before removal. No target executable, ARM code or build ran. Audit success means evidence collection completed, not producer reuse.

The existing production tag resolves to amd64 image `sha256:4cac4ecfca71752a5012b09d6fc5e4e89d064afc56568f703b8c04244cd53631`. Its initramfs script differs from the frozen source, and its required x64 startup BusyBox directory, BusyBox copyright and pinned source archive are absent. Exact docker-copy refusals are retained. The matching kernel/ELF helper scripts and retained x64 loader bytes do not make this image a complete current producer; a script-only overlay cannot supply the missing authenticated startup payload and provenance. B3's fixture image is not promoted to production.

`P/metadata/boot-tools-input-v1/route-proposal.json` SHA256 `c56d536d28aca9cb494038d474ff7dff7785b6a37665b7ff5034588969af4317` requests the narrow architecture-selective production route in `pkgs/mos-boot/build-tools.sh` and its Dockerfile, with direct existing caller/producer tests. The current recipe unconditionally acquires/builds both x64 and ARM loader/BusyBox inputs, so it cannot be launched as an x64-only Phase1 job. The proposal preserves pinned sources/configuration/patches/compiler flags, x64 paths/license/provenance, task-owned tags and explicit later ARM selection. No recipe, composition-only policy, pin or production source was changed; B receives this concrete scope/input mismatch alongside the already submitted mixed-package consumer contract.

`P/metadata/kernel-x64-reuse-v1.json` SHA256 `6ff78030ecd962762d9be3bb147400e3430878b056cefbf77c3be418405e0b42` proves unchanged relevant BSP/resolver/trust contexts, all 12 recorded input mode/blob/hash identities, pinned base/tool/public-cert identities and all four original output digests. The original J Linux 6.12.107 image, config, modules and release are reusable with their original source identity; no kernel was rebuilt or relabeled. New native/root/support/signed-envelope inputs remain separate. This input proof supplies no root, image, guest, teardown, RSS or capacity qualification. Both identified consumer/tool source boundaries remain open, while all successful component evidence is preserved.


### Approved bounded producer join implementation

Campaign `mos-open-plans-20260910-100408`: L1-PRODUCER-JOIN-20260911-2052 approves the exact existing-consumer correction in source-lineage.py, rootfs/build.sh, release-manifest.ts and tests/deb-package-gate.sh, with their direct existing tests and these records. The sole added fixed composition-consumer path is tests/deb-package-gate.sh, subject to real producer/PREPARE context exclusion. No producer path, selector, capture/install transport, package selection, pin or signing policy is added to that scope. Previous same-source/composition-only modes and refusals remain strict.

The joined x64 pool retains exactly 14 original-J archives and replaces only mos-deploy with its actual successful fb6c archive; native mos-init/mos-shutdown use their successful fb6c witness. Original mos-system version/date, mos-podman dependency and embedded mosd identity remain J. Both source delta legs, full source mode/blob/bytes, primary/named contexts, PREPARE/transitive workspace hooks, lock/tool/flag identities, actual archive/control/index/native bytes and successful evidence must validate before explicit join mode bypasses any one-stamp shortcut. Default invocation still refuses mixed pools. Root epoch remains 1577836800; regenerated merged indexes are new outputs.

Implementation will retain the existing pool capture shape and bind a strict canonical join to release/capture and source roles. Direct RED/GREEN covers actual shell consumers, replacement/source/receipt/tool/native mutations, unexpected producers and dependencies, missing release/capture binding and default refusal. Existing producer/kernel/input successes are not replayed; two clean final consumer checkouts must derive identical join bytes before B review and root production. The separate x64-only boot-tool route proposal remains outside this consumer grant. Resource allocation stays 4 CPU/10 GiB/no swap on 0-3; worker347 remains independent.


### Producer join source checkpoint

The implementation now uses an explicitly requested `mos/producer-join-inputs/v1` input and deterministic `mos/source-lineage/join-v1` capture. Fixed reviewed source/receipt anchors are checked against actual clean Git objects, all 37 original-to-rebuilt delta entries, 15 producer/PREPARE input proofs, actual successful commands/logs/tools and archive/native bytes. A separate consumer-only delta binds the real composition successor. The complete joined pool has 15 archives: 14 original J outputs plus the witnessed fb6c deploy output. Its regenerated indexes keep their own bytes; original pools and producer outputs were not modified. No caller-supplied path set or additional producer authorization exists.

The default root caller still refuses the real mixed stamps. The explicit caller reaches the isolated resolver boundary with the original J mos-system version/date; exit 79 is only an input-boundary fixture, not root production. The real pinned x64 package input mode passed 140 checks over 15 archives, 600 paths, three scripts and seven frozen Architecture:all witnesses. Cross-architecture and repeat-build claims remain deferred. The actual child had 3 CPU/5 GiB/no-swap on CPUs 0-3 alongside the verified idle 1 CPU/5 GiB owned daemon, with read-only pool/template mounts and unchanged resource refusals. Its source/wrapper/container/log identities are in `P/metadata/join-v1/actual-callers-result.json` and `package-container.json`.

Focused final checks: 28 source-lineage tests, 30 exact-file release tests/68 assertions, two capture/transport tests and TypeScript passed. Real release-side validation used the actual 15-package canonical join plus both new native outputs, with 25 checks including source/mapping/control/archive/tool/PREPARE/capture/native mutations. The joined release path also verifies all three native entries in the authenticated x64 UKI initrd (init, sbin/mos-shutdown and exitrd/shutdown), rather than trusting a path list. The real-byte UKI test is a bounded fixture, not a signed final image or guest result. `P/metadata/join-v1` and `P/logs/join-v1` retain source-bound gates and direct real-input results.

Original helper and mixed-stamp RED remain. Additional self-review reproduced a joined-index extra dependency/multiline control mismatch, then required exact complete control/index fields; the real unchanged pool passed that stricter check. Earlier test-policy alias mistakes, diagnostic Python bytecode dirtiness and a fixture recorder's native-v3 path typo remain failed setup/test evidence; the native-v2 success and all frozen inputs are unchanged. No failed check, zero-test result or fixture boundary is a production PASS.

The clean commit and two independent exact-source canonical outputs are recorded in the external final delivery after commit creation. B performs the required independent review before any affected root. The boot-tools x64 route is a separately submitted exact caller/input issue; no default ARM-producing tool recipe ran and it was not added to this join scope. Phase1 remains x64, and no unrelated package/native/kernel/ARM suite was rebuilt or relabeled. This checkpoint does not qualify root, image, guest, lifecycle, RSS, capacity or physical behavior.


### Producer join frozen candidate and final input delivery

The isolated consumer correction is `fdf8a480057b64073c9b9e15e399fca1b38d607d` / tree `7eed91c48aa9a00fc75d8661260aac78a004c00e` / Git epoch 1789162665; its parent is `e2b832e79fabdcdfcfc78595a3ea98a642ab3f3f`. The final candidate changes exactly eight files in the authorized scope. No producer, selector, capture/install transport, package pin or boot-tools source changed. Source and component identities remain separate from this later tracking record.

`P/Consumer-fdf8a480057b64073c9b9e15e399fca1b38d607d/sources/verification-1` and `verification-2` are clean independent checkouts of that exact commit. Both actual helper invocations generated byte-identical canonical joined lineage SHA256 `f6ea92cdf5778a78b43214ac664428dd9ac45a7afc90c1aaa6ab64eb65bb97a1` against the original J receipt/pool and successful fb6c native/deploy witnesses. The actual final root caller preserves default mixed-stamp refusal, then reaches only the explicit input boundary at exit 79 with the original J package release version/date. The final real x64 package input gate again reports 140 passed checks, 15 archives, 600 paths, three scripts and seven original Architecture:all witnesses. The final source's real-record/native release fixture passes 25 checks. No root or image build ran.

Final input metadata SHA256 `394f715893881b2f84588c536b219f287a88392d24eb3b657abbfe8f53d1fd07` records all ten steps, both source copies, canonical lineage, original and rebuilt sources and unchanged joined-pool bytes. The temporary archive-checking child exited 0 and was confirmed removed; its actual bounded create/inspect/start resource evidence and eight wrapper forwarding/refusal/cleanup controls are in `P/metadata/join-final`. No shared daemon or active worker was modified.

Review delivery `P/metadata/join-final/delivery-v2.json` SHA256 `68dc4e550088670ab023f73063ba7e5655c42a7bf1763e081e6f99fa0d6d4c95` binds all eight committed file modes/blobs/bytes, six ancestry anchors, 22 gate/log pairs and the complete external evidence. Execution readiness is `P/Consumer-fdf8a480057b64073c9b9e15e399fca1b38d607d/metadata/execution-readiness-v2.json` SHA256 `4b37fc8d3452a979e76241b2b82c08f6515b0b9f597152b492f269a82e7af05a`. It explicitly names the owned x64 builder and planned fresh production checkout/wrapper; previous readiness bytes remain preserved. B's independent source review precedes root execution. The already submitted x64-only boot-tools route correction remains a separate technical dependency for its dependent assembly, with no generic approval request, ARM work or producer/kernel replay.


### Approved single-target boot-tools route

Campaign `mos-open-plans-20260910-100408`, L1-BOOT-TOOLS-TARGET-ROUTE-20260911-2145: implement the exact target-selective producer in `pkgs/mos-boot/build-tools.sh` and `pkgs/mos-boot/Dockerfile`. The direct existing test is `tests/boot-busybox-package-test.sh`; it will exercise the real launcher with only Docker isolated and the actual recipe's selected command branches with acquisition/compiler boundaries isolated. Omitted target defaults to x64; explicit empty, invalid, repeated or conflicting target inputs refuse before resolution. The Dockerfile also validates its target before acquisition. The x64 branch must perform no ARM foreign-package, cross-compiler, loader, BusyBox or emulator work. Explicit aa64 is inspected with command fixtures only. Original pins/config/patches/applets/epochs and source/license output paths remain unchanged.

This is real boot-tools producer attribution, not a composition-only exception. Neither producer path enters COMPOSITION_PATHS or JOIN_CONSUMERS. The completed fdf8a480 join source and fb6c native/deploy outputs remain preserved. Source-only route review will precede the real x64 producer; its successful output/tool receipt is an output of that build. The already granted join consumers then bind that exact named boot-tools role and final caller use, with both original J and fb6c input legs still verified. Missing future tool hashes cannot delay the producer's source review or authorized execution. The minimum next delta and its actual producer/PREPARE non-overlap will be recorded, without a generic producer engine.

B7 owns only the aggregate 4 CPU/10 GiB/no-swap allocation on CPUs 0-3. Worker347's later separate allocation is 4 CPU/10 GiB/no swap on 4-7; its source and results are independent. No eight-CPU concentration, ARM execution, worker import, producer/kernel replay, shared resource mutation or new task is authorized here. B performs the required bounded review and local integration before the real corrected tool build and dependent final input/Phase1 root acceptance.


The target route now has source-bound RED/GREEN. The original launcher accepted an explicitly empty `--target` and called the recorded Docker boundary; that semantic RED remains. The corrected launcher validates CLI/environment target agreement before invoking the resolver, defaults to x64, uses an explicit amd64 producer platform and an architecture-specific target tag. The Dockerfile rejects invalid target arguments in its first RUN before acquisition. Its x64 command path performs no foreign architecture registration, ARM package acquisition, cross-compiler/emulator installation or ARM compilation; only one loader and BusyBox output directory reaches final COPY. Selected loader Ninja concurrency is two, alongside the existing two-worker BusyBox limit and the external aggregate job cap. Original compiler/config/source/patch/epoch flags and required helpers, licensing and source archive outputs remain.

`P/metadata/boot-route-v1/target-final.json` binds the actual source bytes and passing existing package/target-route test: ten real launcher argument cases, three direct Dockerfile target refusals and two isolated recipe branch/provenance cases. Existing wrong/missing BusyBox, wrong architecture, missing applet, dynamic linkage and digest controls pass. The original optional unsupplied-payload notices remain explicitly unqualified. The first branch-fixture attempt had a shell-function-name/path-redirection setup error, retained separately and corrected only in the fixture. No Docker build or target execution occurred in these source tests; explicit aa64 remains inspection only.

The bounded actual context proof covers all 19 boot-tools context entries, 13 protected source/config/resolver inputs and all 15 unchanged package producer/PREPARE input maps. The complete pkgs/mos-deploy, pkgs/mosd and build-env trees equal the existing fb6c producer source, so the successful deploy/native witnesses remain their original inputs and identities. The two producer files and this one direct test remain absent from both composition-only sets. After the required source review, build the corrected x64 tool once, then bind its real immutable image and selected payload/license/source hashes in the already-authorized named boot-tools join role. This is the explicit producer-output predecessor for the final join/root consumer, not a demand for future output hashes before launching the producer. No unrelated source or successful package/native/kernel gate was replayed.


### Boot-tools route source handoff

The exact route source is `4716a2b2020737559fa8798c01fb37e3900ec6e6` / tree `cf419477827eb9441ad9c26eb4d18cbd5b303b30` / epoch 1789163851, parent `884e542f6456d845e6ba10f91c5230c6b8acf23a`. It changes only the two granted producer files, `tests/boot-busybox-package-test.sh` and these two records. Final `target-final-v2`, syntax/whitespace and clean-source proof gates pass. Loader staging uses `cp -p` to retain the produced file's mode/timestamps. The earlier direct source-test identity remains preserved separately.

`P/BootTools-4716a2b2020737559fa8798c01fb37e3900ec6e6/metadata/source-readiness.json` SHA256 `c861ea8848863efabb86286f13df2fb55700b20eab5ded7eb02179f551ee4579` records the clean immutable verification checkout, all 19 actual boot-tool context identities, 13 unchanged protected inputs, all 15 unchanged local producer/PREPARE input maps, the pinned amd64 base resolver and the exact planned x64 invocation/tag/resource envelope. Existing joined-consumer verification intentionally refuses this unwitnessed producer delta at `pkgs/mos-boot/Dockerfile`; no producer path was hidden in a composition-only set and no root ran. This expected refusal waits for the newly authorized tool output witness, not another product scope decision. fb6c remains the actual deploy/native source with its original epoch/version/receipts, and J retains unrelated package/kernel identities.

Review delivery `P/metadata/boot-route-v1/delivery.json` SHA256 `defc9e018130359e235a7c03941841930d6ad8e88ffc19954deeb5bf4e470c72` binds five committed files, four ancestry anchors, 8 gate/log pairs and 30 evidence files. B reviews this stable route before the actual tool producer. Then the already granted named boot-tools role binds that reviewed source, successful recipe/tool/output witness and actual caller/release use; only after those actual inputs pass can the affected root/signed-image successors run. The tool image, loader and BusyBox production hashes remain outputs to create. No production, ARM target run, kernel/native/package replay, shared-tag replacement, sibling source import or main/publication action occurred in this source handoff.


### Reviewed join and boot producer invocation preparation

B independently accepted consumer `fdf8a480057b64073c9b9e15e399fca1b38d607d` and its original-J/fb6c inputs in B-JOIN-REVIEW-PASS-20260911-2158. Local integration `78e3b5c08767656f0b17491dce7a53e6b37803e7` is a tracking/integration identity; it does not replace the frozen producer or composition identities. The accepted canonical lineage remains `f6ea92cdf5778a78b43214ac664428dd9ac45a7afc90c1aaa6ab64eb65bb97a1`. No accepted join suite, native, deploy or kernel producer was repeated. The separate boot route `4716a2b2020737559fa8798c01fb37e3900ec6e6` remains in B's existing source-review handoff; no root-only retry from fdf8 was launched.

The new task-local producer runner and wrapper are confined to `P/tools/boot-producer-v1`. At 22:14:19-22:14:20 UTC, pane %101/PID 2800286 prepared a separate clean 1831-entry production checkout at exact `4716a2b2`, checked its actual boot context against the source-readiness record, and exercised the real launcher with only Docker replaced by an argument recorder. All 12 wrapper checks passed: exact pinned x64 arguments, private tag mapping, explicit owned builder/load/metadata outputs, and refusal of altered platform/target/base/snapshot/context/tag or extra/alternate commands. This is invocation preparation, not a Docker build, resource transition, target execution or successful tool witness.

Preparation metadata `P/metadata/boot-producer-preparation-v1/result.json` SHA256 `08ec3028db88082cfe1782c8767685fbf1e1935b933e58c633ff662de75e81ef` and forwarding record SHA256 `a90474d4c2d5d36d64621c0c83052e85a00a340be09e44dee8aa02b3326b98d8` bind the exact runner/wrapper bytes. The source remains `4716a2b2` / tree `cf419477827eb9441ad9c26eb4d18cbd5b303b30` / epoch 1789163851. The planned image tag is `ai-agent/mos-75btxdqb-boot-x64-4716a2b20207`; shared tags are never replaced. The immutable previous envelope helper supplies the owned-daemon quiescence and 4 CPU/10 GiB/no-swap transition, with no direct child during compilation and at most four BuildKit workers. The runner repeats full fresh CPU/memory/disk/input checks at actual launch, retains worker347's separate 4 CPU/10 GiB reservation and refuses without retry if a condition fails. No live resource was changed by preparation.

The actual x64 boot producer starts only after the already-requested bounded B route review. Its resulting immutable image, BuildKit metadata and payload/license/source bytes are generated outputs. The separately granted named boot-tools join role then binds those real outputs, source/context and actual caller/release use; it remains unfinished until that evidence exists. Producer paths remain excluded from both composition-only sets. No future output digest is requested as permission to build the tool, and no unwitnessed tool is admitted to a root. The final combined consumer/source/input proof and affected x64 acceptance remain pending under the existing automatic grant.


### Actual boot-tools start and bounded transport recovery

B-BOOT-TOOLS-SOURCE-REVIEW-PASS-20260911-2206 independently accepted the exact route `4716a2b2020737559fa8798c01fb37e3900ec6e6` / tree `cf419477827eb9441ad9c26eb4d18cbd5b303b30` / epoch 1789163851. Its local integration `85c54845976c7b9c02cf223419d56e950e1b38da` is not the producer source. The prepared clean production checkout and immutable recipe/inputs were reused. No source suite, native, deploy or kernel producer was repeated.

The first actual invocation ran at 22:18:04.560049-22:18:24.800720 UTC, runner 2802774/build timeout 2803048/adapter 2803062, and exited 1 while BuildKit waited for connection: `context deadline exceeded`. No Dockerfile stage or compiler started. Terminal collection `P/metadata/boot-producer-launch-v1/terminal-collection.json` SHA256 `26a12bd629d80f50df70ab120024d2be0fb1771171638076084035ca334b8a4b` preserves all nine step/log bindings, absent processes and the original invocation/resource identity. Build log SHA256 `614da669ffd6a29c2a072c4426646bde48a9fc97552e96a7d9d729c9fee07fc4` remains unchanged. The first start recorder crossed that fast terminal and failed its running-state assertion; its files with historical running-snapshot names contain terminal metadata and are not counted as live evidence.

The bounded read-only reproduction captured the remote driver's exact internal `docker exec -i ai-agent-mos-wave-75btxdqb-x64 buildctl dial-stdio` call through PATH. The strict task wrapper had refused that necessary connection command. Plain remote inspection and direct owned buildctl were healthy, so no daemon restart, cache deletion, binfmt or source correction was needed. Original wrapped inspection returned an inactive status (its CLI exit 0 is not a successful connection). A separate `tools/boot-producer-v2` permits only that exact owned-container stdio command, retaining every other strict argv refusal and the immutable v1 bytes. All 19 forwarding/refusal checks and actual corrected-PATH remote inspection passed. Proof SHA256 `e8eb26680b9c90712f88ca132918689eb78097e93db710e8e9e01428e6a334af` binds wrapper `435eee63d49d12ef70b09c6f42ab1921affb6b2c78a4076174698aceb8d86152` and runner `a098fafdd111e7293c3eec8c0c8dcb8f61045654adda467009fccda1a2cfa972`. This is execution-adapter recovery, not another product-code repair round.

After fresh capacity/CPU/memory/disk/headroom and owned-quiescence checks, the unchanged reviewed launcher started again at 2026-09-11T22:23:41.930939+00:00, runner 2803900/build timeout 2804182/adapter 2804196, persistent tmux `75btxdqb-7e0f1b` pane %101. This continuation reached real Dockerfile package acquisition/installation, resolving the connection failure. Immutable start snapshot `P/metadata/boot-transport-v1/v2-startup.json` SHA256 `e4889a131eafd458e8fc717a20d8004db26c25fc6bd7d6ccbb770e06c603545e` records exact source, environment, actual buildx argv and limits. The sole owned daemon remains 4 CPU/10 GiB/no-swap on 0-3 with worker parallelism four; worker347's independent 4 CPU/10 GiB on 4-7 stays reserved. No additional B7 heavy child or ARM producer runs. Build-time ukify/compiler Python is existing tool-container content, not target-root Python.

The live gate writes `P/BootTools-4716a2b2020737559fa8798c01fb37e3900ec6e6/metadata/production-v2/result.json` and `logs/production-v2/boot-tools-build.log`. Actual-start handoff `01M2995PVX7CK8ND704G3647RC` went to B. The private tool tag is unchanged and the old shared tag remains untouched. At the recorded snapshot the producer is running, with no final tool/root/image/guest PASS. Its terminal will be collected once; actual loader/BusyBox/helpers/license/source/image identities then feed the already-granted named boot-tools join and final consumer/input review. All original component identities and automatic x64 successors remain in effect; no producer path enters composition-only policy.


### Boot output collection and named producer join

The real `4716a2b2020737559fa8798c01fb37e3900ec6e6` x64 tool build completed at 22:28:10.387591 UTC with exit 0, followed by successful immutable image inspection. The original production-v2 aggregate remains exit 1: its recorder requested the absent `containerimage.config.digest` metadata key after import. Its result SHA256 `d7acc26c71a82faf763e7fa36e564184cb5b95027a2a059af688746f709319b2`, build log and all ten step records remain unchanged. No producer was replayed.

Separate task-local `boot-output-v2` collection verified the canonical OCI manifest `sha256:28164316a7d6d6c04cdbbec7c654be7b1ee83e61e680ae1872804e3f6bfb496c`, its distinct config `sha256:58c3ff0bf4198c236f289846e0bbdb7ce3dbef732e4ecba584ed2b83135b274e`, all nine compressed/uncompressed layer identities, actual immutable Docker lookup, source/target labels and recipe/frontend/base/snapshot provenance. The old config lookup failure is an address distinction, not a product failure. The first collection setup errors (inspect has no Descriptor; host Python lacks hashlib.file_digest) are retained in boot-output-v1, with the exact correction in a separate collector. No generic optional-field bypass or target execution was added.

Output witness `P/metadata/boot-output-v2/output-witness.json` SHA256 `af5bc012346a99d360612a1340df58de35265b9a7cc638d2286401b2a3ab7112` binds 15 payload files. Both EFI members are AMD64. Startup BusyBox is static, 1,213,152 bytes, SHA256 `c48d13f5cc6f68e5ef897de4c04f85cb0d8af510ff1af0256490b37029fa6c4a`, with the exact 19 required/available applets, reviewed config, original 1.36.1 source archive and copyright. The actual initramfs/kernel/closure scripts equal the frozen source; required tool packages and licenses are retained. BuildKit reports incomplete materials/reproducible=false; collection preserves that limitation rather than claiming reproducibility. Twelve focused collector tests pass, including wrong/missing metadata, manifest/config conflict, corrupted layer, wrong source/target/owner and missing/mutated required payload controls. No ARM payload, container or root was produced during collection.

The granted named join now separates J -> fb6c native/deploy attribution, fb6c -> 4716 boot producer attribution, and 4716 -> the actual clean consumer successor. The exact reviewed 11-entry boot leg and 22 context/protected inputs are bound separately; all 15 local producer/PREPARE maps remain equal to fb6c. Neither boot producer path nor its direct test enters either composition-only set. The immutable canonical boot role SHA256 is `a893b517c2a249afed8d34d323e6f5148aa55ec353c9956f5e422766d516b664`. Creation verifies actual source Git objects/modes/bytes, ancestry, immutable producer/output evidence, all original step logs and current image/payload identities. Only the specific preserved recorder terminal is distinguished from its successful producer command; failed or incomplete production remains refused.

The root caller consumes the verified immutable tool identity before resolving or building containers and rejects a conflicting supplied identity. The unchanged capture shape carries the strict named role. Release validation binds the same role, receipts and captured bytes, records LOCAL_BOOT_TOOLS_X64 by manifest identity, and checks the authenticated UKI's actual startup BusyBox bytes in addition to all three native entries. Missing/changed BusyBox and missing tool records refuse. A source-bound downgrade RED demonstrated that removing the tool role and selecting the old join schema needed an explicit guard: old schema acceptance is now pinned to the already-reviewed fdf8 composition; a successor cannot remove its tool obligations by relabeling its schema. Same-source/composition-only defaults and original J package/control/version/date identities are unchanged.

The initial source-bound REDs cover the old helper's missing tool receipt contract and the old native-only archive checker accepting missing/changed BusyBox. Focused GREEN covered eight joined helper tests, 31 exact-one-file release/lineage tests (72 assertions), types and shell syntax; the final downgrade guard and clean final input checks are recorded separately in the following handoff. Actual helper validation already reproduces the canonical tool role from the frozen source/output bytes. A clean candidate, two disjoint equal-input lineages and actual root/package/release consumer boundaries are required before B reviews readiness; boundary exit 79 is never root acceptance. Only the existing authorized x64 successors follow that review. Original J/fb6 native/package/kernel artifacts, no-Python/routel-only selection and failed root histories remain unchanged. Latest worker347 reservation is 2 CPU/4 GiB on 4-5; B7 retains aggregate 4 CPU/10 GiB on 0-3. No shared resources, main, publication, cron or parent progress actions occurred.


Final pre-commit source checks passed: eight joined-helper cases, 31 exact-file release/lineage cases with 72 assertions, two capture/lineage cases, TypeScript, shell syntax and docs/scoped whitespace. The added missing-role/schema-downgrade control has its own real RED and final GREEN; original fdf8 legacy join remains accepted only at its actual reviewed composition identity. PMA-CR self-review covers all five changed implementation/test files and their callers; no remaining introduced finding was identified. This is self-review pending B's independent review.

The task-local final test recorder reused `first-green.json`. Its final seven-step content was preserved byte-for-byte as `final-green.json`; the original first four-step summary is no longer available. All original four logs and observed exit codes remain, and no original timing was fabricated. `P/metadata/boot-join-v1/summary-path-collision.json` records the limitation explicitly. Final checks carry their own current source hashes and timing; no check was replayed solely to reconstruct the lost summary. This evidence-recorder error does not change product bytes, successful producer outputs or test results.


### Clean named-tool consumer and final input handoff

The isolated consumer is `fbd700480ec3eb32f40c493056aa2557f8015129` / tree `d504aba7490ad975d08df36c9fabb574eafef4b0` / epoch 1789167736, parent `94ad24ac3ab1822d35fe3901af2f3ab1b21f7b65`. Its seven files are the three granted production consumers, two direct tests and these original two records. Tool producer/source remains 4716; native/deploy remain fb6; unrelated packages/kernel remain J. No producer, consumer-selection, pin, no-Python/routel, signature or composition-only path-set change is included. A generated untracked source-lineage bytecode cache was moved into scoped evidence before clean freeze; it was not committed or used as a source input.

`P/BootConsumer-fbd700480ec3eb32f40c493056aa2557f8015129/metadata/final-input-validation.json` SHA256 `33bfaa0febe352c5d12d5365a394b5e0170554eb73bd2429be66e2e217dfb068` records 13 actual steps ending 23:03:00.050981 UTC. Two clean disjoint checkouts each verify all 1,831 mode/blob/byte entries and generate byte-identical canonical lineage SHA256 `aadcadcb30bf3e05473253255d4d9b376b8f538ea23f35c4b25eae0965a62eb5`. The exact boot producer leg has 11 entries; the final consumer leg has seven. Actual native/deploy receipts, tool image, boot payloads and every reused pool/control/index byte were verified without rebuilding them.

The actual root caller retains its default mixed-stamp refusal, passes the explicit joined-input path to the isolated resolver boundary (exit 79), emits the original J package version/date and exact immutable tool manifest, and refuses the config digest supplied as a conflicting tool identity (exit 1). No production BASH_ENV/DEBUG injection is proposed. The input-only package gate passes 140 checks over 15 archives, 600 paths, three scripts and seven frozen all-architecture witnesses. Its actual container used 3 CPU/5 GiB/no swap alongside the quiescent owned daemon at 1 CPU/5 GiB after positive-headroom checks; the daemon's original 4 CPU/10 GiB envelope was restored after the child exited. Both lifecycle records and actual create/inspect/start/exit proof remain under `P/metadata/boot-join-final`. No other daemon or worker allocation changed.

The exact final-source release consumer passes 35 checks with actual native/BusyBox bytes in a bounded UKI/cpio fixture. Thirty-three refusals include removed/downgraded tool roles, source/context/recipe/manifest/payload/receipt changes, capture/installed archive mapping changes, wrong caller identity and changed actual boot bytes. It is an input/fixture gate, not a signed final artifact, root or guest result. Readiness `metadata/successor-readiness.json` in that same immutable consumer directory has SHA256 `26c496ae0ca3f55d3589a85275aca90c44e591f950381d142e0365e301ac2996`. It binds source roles, public metadata, kernel reuse, actual producer receipts and the planned x64 no-cache=0 environment without boundary fixtures.

B's independent bounded review/integration remains the next source-quality gate. After its actual input review passes, the existing automatic x64 root/support/signed-image and real Phase1 lifecycle/API/authentication/storage/update/fallback/reset/service/size successors proceed. No future root/image output hash is required before its authorized producer. The final two-architecture/physical obligations remain deferred until approved main integration, never counted as passed. The original boot production recorder failure, collection setup errors and overwritten initial test-summary limitation remain explicitly preserved alongside their valid final evidence.


### Reviewed boot join: actual x64 root start

B accepted the exact `fbd700480ec3eb32f40c493056aa2557f8015129` composition / tree `d504aba7490ad975d08df36c9fabb574eafef4b0` / epoch 1789167736 and actual joined inputs. B's newer integration also carries the independent startup worker, so it was not synchronized into this candidate. This original worktree advances records only; the new clean `BootConsumer-fbd700480ec3eb32f40c493056aa2557f8015129/sources/production-x64-run1` freezes all 1,831 tracked entries at the reviewed source.

The normal x64 root command `timeout --signal=TERM --kill-after=30s 10800 bash rootfs/build.sh` actually started at 2026-09-11T23:29:07.576599+00:00. Orchestrator 2842349 and root timeout 2843152 were live in persistent tmux `75btxdqb-7e0f1b`, pane %101, at the immutable startup observation. The environment selects x64/dev, mosd and containers, no-cache=0, root epoch 1577836800 and the explicit verified join; no BASH_ENV/DEBUG fixture is present. The 15-archive/18-file joined pool and 163 fixed cached inputs were verified in the new directory; canonical lineage remains `aadcadcb30bf3e05473253255d4d9b376b8f538ea23f35c4b25eae0965a62eb5`. J package/mos-system/mosd identity, fb6 native/deploy and 4716 boot-tool manifest identity remain separate. No producer/native/kernel/tool was rebuilt.

Fresh capacity, unrelated CPU below 50%, memory/disk, owned quiescence/builder and positive-headroom checks passed. Free disk was 323474878464 bytes; unrelated working memory was 3210990616 bytes. The sole B7 slot remains aggregate 4 CPU/10 GiB/no swap on 0-3, with the existing verified 3 CPU/5 GiB direct child plus 1 CPU/5 GiB idle-daemon transition when required. The separate worker allocation is not consumed or changed. The versioned root-v2 wrapper preserves original resource and OCI integrity refusals, bounds compiler workers at four, forwards the exact owned BuildKit stdio route, maps only the reviewed boot-tool request to its immutable manifest and refuses tool rebuilding/unassigned FIT production. A later component caller must still prove actual use; the environment alone is not that evidence.

The first root-v1 preparation copied old binary test fixtures and text rewriting stopped with UnicodeDecodeError before any runner or root started. Its partial files remain preserved. Root-v2 copies only the named execution scripts; focused forwarding/headroom/tool-mapping checks passed. Runner SHA256 `17bd5448dd36b68dc97b10e59d48e49b9a1212d8080ef69bfe88a6245618d633`, wrapper `8074c37449658589cb8a58463f04929d5e4c86621e91cc6d0689826c54d802eb`, execution patch `bad1c2695b115dc0d3f71d54ae236760aea46d4e6a54fc0a951b1c6207b36a21`. Original frozen source/wrapper/output and all historical failures remain unchanged.

Immutable actual-start snapshot `D/metadata/root-x64-start-v1.json` SHA256 `1e5329f363427e8fdbad70cc3157c98956ead54f6fbcb2d2d23d9c947dca1489` binds the actual source, input, environment, process and resource observations; D is the BootConsumer directory above under the existing Phase1 directory. The live gate records `D/metadata/W2/x64-run1.json`, log `D/logs/W2/x64-run1/root-build.log`, and outputs `D/sources/production-x64-run1/_out/x64`. Actual-start handoff `01M29CX5ZX6MA9C83X9Z3DYR9X` went to B. This is gate-pending, not root/image/guest acceptance. Collect its actual terminal once, then automatically advance only eligible affected x64 successors. No ARM, sibling-source import, main, publication or cron action occurred.


The root's terminal supersedes the live startup observation above. It failed at 2026-09-11T23:30:12.430561 UTC (aggregate 23:30:12.431727 UTC), exit 1, in `90-pack` pack 11/19: `runtime composition refused: unsupported node: /rootfs/dev/null`. The log records 11 local packages and 173 installed packages before that refusal. Debug export completed (134,009,869 -> 95,227,256 bytes); it is not a final packed-root measurement. Both original runner/root PIDs are absent. All 14 completed step/log hashes verify; the actual 1,831-entry source, all 18 joined-pool files and both native exports remain unchanged.

Terminal `D/metadata/root-x64-terminal-v1.json` SHA256 `c6467d5ff8f84d338b3efdd6bfca88d17e7095c1539ff9fb4340e52cf23ab007` binds metadata `b62c1c046179ba045015eea6a775e1935a8a04429dae02e3ccd6483027c40e5f` and root log `a62807b8b8d43d920592306d3128ea5441b820500e0647dd52ef2edd1cf95a79`. B received the concrete terminal in `01M29D25G7A8M5Q6NFR55AK7K5`. The selected origin that reaches `/dev/null` remains unestablished; existing bootstrap-device capture and explicitly named runtime-link rules do not authorize a blanket special-node exception. No product hunk or unchanged-root retry was applied. The affected composition stage and its descendants remain blocked by this actual refusal; all successful producer/kernel inputs and independent worker work remain preserved. This attempt provides no successful root, verity image, signed image or guest result. B7 has no active heavy child after collection.


### Read-only diagnosis: systemd masks reached the disposable null device

The deduplicated failed fbd root remains unchanged; its 14-log terminal collection was reused. The actual 10-compose OCI manifest `3abdf8ca36ba4373dbb7d84da8d7955d9cc3a4cb6649969b6cdd417e6fc7440b`, all four compressed/diff layers and captured ownership inputs were checked. Layer `dd7c7862f3fea696729e2524362ff0107e9eda9cd9d43519267f22aaae03ed65` already contains `/dev/null` as a character device 1:3, mode 0666, uid/gid 0. The owned BuildKit's cached pack-transfer snapshot 484 has the same device and the exact canonical fbd lineage `aadcadcb30bf3e05473253255d4d9b376b8f538ea23f35c4b25eae0965a62eb5`. Its original closed/configured snapshots retain nanosecond timestamps and security.selinux xattrs. Narrow read-only export `diagnostics/dev-null-v1/actual-transfer-capture.tar` SHA256 `b59d6067132d8099473e438f19677814eeddbe7449b2fda7dd24e7b0080b551d` preserves the relevant cache inputs. No daemon, cache, source or producer was rebuilt or changed.

The first concrete selected route is `/usr/lib/systemd/system/cryptdisks-early.service -> /dev/null`. The systemd-owned resource rule matches this mask; `Selector.add` follows the undeclared ordinary symlink, then `retain`/`metadata` correctly refuse its special-node target. The same actual systemd 257.13-1~deb13u1 archive SHA256 `ee81302a1d5b7434762b6e784a572854d4b6cf6235e33e2d104ad4e1cae71ab4` supplies four masks: `cryptdisks-early.service`, `cryptdisks.service`, `hwclock.service` and `x11-common.service`, all under `/usr/lib/systemd/system`. Each is already a root-owned symlink to `/dev/null`; none is a new package or generator. Existing declarations cover six other installed null masks. A bounded audit accounts for 24 related captured endpoints, including eight bootstrap devices, all ten null masks and the relative `/etc/mtab -> /proc/self/mounts` link (not a selected root). The initial 23-entry audit is preserved; v2 adds that normalized relative mount endpoint without replaying the root.

Eight external source-bound fixtures use the unchanged frozen production selector and actual cached device/link/unit/ownership inputs. Original RED follows the exact cryptdisks-early chain. Adding the four explicit runtime-link declarations in an external rules fixture passes actual select/copy/verify with 14 retained paths and a nonempty original `basic.target`; it also passes when disposable `/dev/null` is absent. Wrong link target, missing owner, missing required unit, undeclared mask and a selected device remain refused. These are focused subset fixtures, not a full composed root or target service execution. Original source metadata/xattrs are recorded; the host fixtures preserve mode, owner, target, device numbers, nanosecond timestamps and regular bytes but do not reproduce security.selinux. The difference is explicit in `fixture-metadata-comparison.json` and is not a full metadata-transfer PASS. The exited RUN mount namespace is unavailable; original mount arguments and OCI/cache identity establish the image-owned device provenance.

The minimal external proposal changes `consumers.json` only by adding the four exact runtime links with the existing kernel-devtmpfs generator/order contract. It needs no selector/compose algorithm change, device whitelist, broad /dev exclusion, package/pin change or producer replay. One additional existing consumer-policy boundary is real: `consumers.json` already belongs to COMPOSITION_PATHS, but not the stricter JOIN_CONSUMERS set. An actual canonical-validator fixture refuses that delta. The proposal therefore requests only that exact path in Python and release JOIN_CONSUMERS, with direct existing composition/helper/release tests. No producer path or test-directory allowance is proposed. Final clean successor/context/receipt/tool/capture validation remains required after source review; original J/fb6/4716 component identities stay unchanged.

Proposal `D/diagnostics/dev-null-v1/proposal.json` SHA256 `9077c0cd58373cd32cc6b01bce96282961ada3dccd1219e7f764a8cd8c7a52a6` and delivery `2cb51b7949e91f758b2d9aa1d8438b645def83cad6aaf024da358e1d5cc3ac0d` were sent to B in `01M29E46XTG08EBB9NXM2WYWH0`, starting its existing execution `39f82831-a851-4efc-9ba4-3cc268ddadf1`. The exact product hunk awaits that technical disposition; none is applied. This bounded round used no new container, root, kernel, native/deploy/tool build, sibling wake, main/publication or cron action. No successful root/image/guest/cold/physical result is claimed.

### 2026-09-12 four-mask implementation grant

L1-FOUR-SYSTEMD-MASKS-20260912-0005, delivered by the 00:33 transport recovery, approves the four exact existing systemd mask declarations and the matching `rootfs/runtime/consumers.json` JOIN_CONSUMERS entry. Implement on the current B7 branch; reuse dev-null-v1 evidence and original J/fb6/4716 outputs. Direct source-bound composition/lineage checks and two clean final input copies precede B review and any root successor. No selector algorithm, producer, unrelated source, index, or status change.

Source-bound RED reaches the original `/dev/null` special-node refusal and both joined-path refusals. The exact approved production patches are applied. Final composition tests retain all four systemd links plus an ordinary required unit, with and without disposable null; wrong target/origin/required unit/undeclared mask and direct selected device still refuse. The final actual cached-input select/copy/verify has seven cases. Original SELinux-xattr fixture limitations remain explicit; this is not a full root result.

Evidence under `Phase1-fb6c4597bb902f69d528bcdc3c8372f310c322b1/FourMasks-v1`: direct composition GREEN, joined helper plus final context negative, capture lineage, exact single-file release tests and types pass. Two fixture preparation failures (parent ownership, then preserving existing fixture runtime links) remain separately recorded; production checks were not relaxed. Self-review confirms only the four declared rows and the one matching path in each JOIN_CONSUMERS set; no producer/pin/selector/compose algorithm change. Clean successor two-copy actual-input proof and B review are the remaining source handoff gates; no root or producer replay is claimed.

### 2026-09-12 four-mask clean candidate and actual input handoff

Composition candidate `f4c1c4c44a64f7cda00afe5b6c74e611c440c5dd` / tree `164725070bac579b771ba137b13cbe36a6c3678a` / epoch `1789173629` is the isolated eight-file correction. Two independent clean1831-entry copies produce identical canonical lineage `e4e8e56c0cbf15d5fe1d9b3b12567212b2f7326bffcb452e9fa8f38ad414f91b` against the unchanged actual J14 archives, fb6 deploy/native and4716 tool witnesses. The final helper verifies all15 actual producer/PREPARE maps and the full nine-path consumer-only delta from4716; the present correction has eight files relative to its own parent. Pool/control/index/native/tool bytes retain their original identities; root epoch remains1577836800.

Direct gates: three composition tests (two positive cases and four refusal subcases), direct selected-device refusal, eight joined helper tests plus the separately final-bound context-negative test, two capture/lineage tests, exact single-file32 release tests/76 assertions and type/docs/diff checks. The final actual cached-node select/copy/verify has seven source-bound cases. Three original source REDs and two fixture setup failures remain historical evidence. The final shell caller keeps default mixed-pool refusal1, verified join boundary79, and wrong tool refusal1; the final release input validator checks the actual new lineage with33 total positive/negative cases. These are source/input fixtures, not a real root/image/guest result.

Evidence: `_out/wave/e176876b733d675d1e20b40b42628cd4e18b197d/Phase1-fb6c4597bb902f69d528bcdc3c8372f310c322b1/FourMasks-f4c1c4c44a64f7cda00afe5b6c74e611c440c5dd/metadata/final-input-validation.json` and `successor-readiness-v2.json`; implementation gates, source bindings, self-review and retained failures are in `_out/wave/e176876b733d675d1e20b40b42628cd4e18b197d/Phase1-fb6c4597bb902f69d528bcdc3c8372f310c322b1/FourMasks-v1`. Readiness preparation v1 compared the two different delta bases and refused; v2 checks both exact Git bases, without rerunning input gates. No producer/kernel/native/tool or unchanged140-check package-gate replay. B independent review/local integration is next; no later347 source was imported. The previous fbd root remains failed and immutable.

### 2026-09-12 reviewed four-mask root command and environment terminal

B independent review/input PASS is consumed; frozen composition stays `f4c1c4c44a64f7cda00afe5b6c74e611c440c5dd`, not B's later integration. Actual x64 root command started at `2026-09-12T00:51:54.238828+00:00` after 14 preflight checks, then exited1 at `2026-09-12T00:51:59.167224+00:00` before any root stage/direct validation child. Orchestrator2889090/root timeout2889904 are absent. Exact refusal: `W2 execution envelope: Auto-removed daemon still exists; refuse replacement`. The idle daemon held5157154816 bytes; the unchanged 1GiB positive-headroom requirement triggered orderly owned-daemon stop, whose immediate removal check refused during the asynchronous transition. A later single read-only observation finds the daemon absent and its labelled state volume retained. No forced shrink, shared/cache change, source defect or root PASS.

All15 completed step/log identities and absent processes are bound by `_out/wave/e176876b733d675d1e20b40b42628cd4e18b197d/Phase1-fb6c4597bb902f69d528bcdc3c8372f310c322b1/FourMasks-f4c1c4c44a64f7cda00afe5b6c74e611c440c5dd/metadata/root-run1-terminal.json` SHA256`50fe8163a53478d152f7c5b2f92a41fe3b3355cba37b671ac93266ce20446ff4`. New tools under `tools/root-v1` preserve the original envelope and immutable4716 image, with separate source/tag/output paths and explicit cgroup checks. Runner `a6086c36...` and wrapper `89486dc5...` are fully bound in metadata. Original J/fb6/4716 source roles and verified pools/native/tool/kernel/cache remain unchanged. The startup recorder observed the quick terminal instead of a still-running process; its failed assertion/HTTP400 transport is retained, not a delivered notice. Actual start+terminal handoff to B is `01M29HSC690ESC4K0JFHNPKT1J`.

Next: existing same-node environment recovery may recreate only the now-absent owned pinned daemon with retained state after fresh capacity and create/inspect/start proof, then resume the never-executed producer using versioned attempt records. No product re-review, producer/kernel/native/tool replay, root success, main action or retry loop follows from this failure.


### 2026-09-12 exact daemon recovery and resumed root stages

B's explicit environment continuation was consumed without reopening the reviewed f4 source/input gate. The absent owned daemon was recreated exactly once with the retained labelled `ai-agent-mos-wave-75btxdqb-x64-state-w0-20260911` volume (creation 2026-09-11T09:04:20Z), pinned BuildKit image and unchanged config `6d07b01f...`. The create/inspect-before-start/start/actual-cgroup/worker/private-transport receipt `_out/wave/e176876b733d675d1e20b40b42628cd4e18b197d/Phase1-fb6c4597bb902f69d528bcdc3c8372f310c322b1/FourMasks-f4c1c4c44a64f7cda00afe5b6c74e611c440c5dd/metadata/daemon-recreate-v2/result.json` SHA256 `e624623b8b6a24c8cf56dc393cd2c1d534ccef2208e22f471bdd02b5f80acab6` passes 23 recorded expected outcomes, including the intentional absent-object inspect exit1. New daemon `e7da1887391e765034cc5492a0847155a9615e161e4d720372b2a3797e3f9b35` keeps 4 CPU/10 GiB/no swap on 0-3; initial actual charged memory 17362944 bytes allows the unchanged 1 GiB headroom and 1 CPU/5 GiB daemon plus 3 CPU/5 GiB direct-child transition. No shared resource, cache, binfmt or other worker allocation changed.

The separate resume-v2 runner stopped before any root command because its new preparation assertion incorrectly required `verify/node_modules`, absent in both the original and prepared inputs. Its terminal metadata/log and exact runner bytes remain immutable. Resume-v3 corrects only that execution assertion to compare optional-cache presence with the original input; package/lock equality remains required. No host installation, producer replay, source edit, resource threshold change or second daemon recreation occurred. Exact old/new runner and wrapper substitutions are recorded in `_out/wave/e176876b733d675d1e20b40b42628cd4e18b197d/Phase1-fb6c4597bb902f69d528bcdc3c8372f310c322b1/FourMasks-f4c1c4c44a64f7cda00afe5b6c74e611c440c5dd/metadata/root-resume-v3-preparation.json`. Original run1 wrappers, short-terminal notifier error and all preceding failures remain intact.

The actual normal root command `timeout --signal=TERM --kill-after=30s 10800 bash rootfs/build.sh` started `2026-09-12T01:07:49.642855+00:00` after 12 successful immediate checks. Runner 2899709 and root timeout 2900658 were live in `75btxdqb-7e0f1b` pane %101 at the start observation. Immutable snapshot `_out/wave/e176876b733d675d1e20b40b42628cd4e18b197d/Phase1-fb6c4597bb902f69d528bcdc3c8372f310c322b1/FourMasks-f4c1c4c44a64f7cda00afe5b6c74e611c440c5dd/metadata/root-resume-v3-started.json` SHA256 `046cc9511ca63eab406016dfcf2179cb4281852dfd41495b0e4b2a4e4034fc56` binds source f4c1c4c44a64f7cda00afe5b6c74e611c440c5dd/tree164725070bac579b771ba137b13cbe36a6c3678a/epoch1789173629, all 1,831 source entries, 18 joined pool files, 163 existing cached archives, actual boot image and exact input environment. Root epoch remains1577836800, x64/dev/no-cache0, with no BASH_ENV/DEBUG fixture. Original J package identity, fb6 native/deploy and4716 tools/kernel reuse evidence are unchanged.

The existing production-x64-run1 checkout is reused. Its fixed caller output initially contained only the byte-identical canonical lineage; that preflight-only output is independently preserved in `artifacts/x64/root-run1-preflight-preserved`. New root-stage bytes are associated with the new `root-resume-v3` artifact link, logs, OCI tag and metadata, not a successful original attempt. Canonical lineage remains `e4e8e56c0cbf15d5fe1d9b3b12567212b2f7326bffcb452e9fa8f38ad414f91b`. Live gate metadata is `_out/wave/e176876b733d675d1e20b40b42628cd4e18b197d/Phase1-fb6c4597bb902f69d528bcdc3c8372f310c322b1/FourMasks-f4c1c4c44a64f7cda00afe5b6c74e611c440c5dd/metadata/W2/x64-resume-v3.json`; log is `_out/wave/e176876b733d675d1e20b40b42628cd4e18b197d/Phase1-fb6c4597bb902f69d528bcdc3c8372f310c322b1/FourMasks-f4c1c4c44a64f7cda00afe5b6c74e611c440c5dd/logs/W2/x64-resume-v3/root-build.log`. B received the actual execution handoff as `01M29JHNJFYAQF1VPQW2GDKV4Y` (queued at its normal boundary). This is gate-pending, not root/image/guest acceptance. Collect the real terminal once and continue only eligible affected successors under the existing grant.


The actual terminal supersedes the preceding live start: root ended `2026-09-12T01:09:22.672968+00:00`, aggregate `2026-09-12T01:09:22.674910+00:00`, exit1; runner/root PIDs [2899709, 2900658] are absent. Installation reached 11 local packages and 173 total, then 90-pack pack11/19 refused `runtime composition refused: operator executable omitted: /usr/bin/docker`. The previous null-device refusal is no longer the stopping error. No root, final image or guest PASS follows, and the cause of this newly reached operator assertion has not yet been diagnosed.

Terminal `_out/wave/e176876b733d675d1e20b40b42628cd4e18b197d/Phase1-fb6c4597bb902f69d528bcdc3c8372f310c322b1/FourMasks-f4c1c4c44a64f7cda00afe5b6c74e611c440c5dd/metadata/root-resume-v3-terminal.json` SHA256 `78f312ff44b6650fcc8aae10a4b11066d83001d03096b13171462fb7cf2671a2` verifies all13 completed step/log hashes, four wrapper execution records, actual clean1831-entry source, all18 joined-pool files and both native outputs. Root log SHA256 `41bf0b99c835a95eb6de90958fff9985eca2cf8c3b6d81f43d3ee33e75d06538`, metadata `789bdff0e30e708c4a0bec8c2b51cca81145a45cd65742fdb8542adbe2121158`. Daemon recovery remains successful; only the owned bounded daemon remains after terminal collection. New root failure and prior runner preparation failure remain separate. B terminal handoff is `01M29JPTRAF0KPZRGJ06KAJ4WX`. Preserve exact installed/stage evidence for one bounded read-only discrepancy diagnosis; no unchanged root, producer, native, tool, kernel or source suite was replayed. Strict missing/omitted-resource checks remain unchanged.


### 2026-09-12 read-only docker operator diagnosis

The f4 terminal and completed recreation checks were reused. Current task-cache snapshot514 binds the exact canonical f4 lineage, configured ownership and closed installation; `/usr/bin/docker` is the unchanged uniquely `mos-podman`-owned symlink to `podman`, mode0777, uid/gid0, with the original J epoch. The real archive `mos-podman_5.8.6+gite176876b733d-1_amd64.deb` SHA256 `3385040b78388bc31c942b89c0e11897c338f670b43f69334f1c7239f7e47209`, payload manifest and producer recipe all agree. The original Podman bytes are `d797bc3a...`; actual current debug-export snapshot523 records the stripped target SHA256 `4b5e4a489f09165b3cdbebe60d9ca1876ffbcba2530dd379dcb7b806937cccaf`. Debug transformation does not rewrite the alias. This is not missing package input.

The exact consumer root list retains `/usr/bin/podman` and private helpers but omits `/usr/bin/docker`. `Selector.add` follows a selected symlink forward; selecting a target does not select every alias pointing to it. The unchanged compose surviving-operator assertion therefore refuses correctly. The minimal external patch adds one exact executable root for the existing alias, bound to `mos-podman` and expected target/mode/uid/gid. No selector/compose algorithm, producer, pin or lineage-set expansion is needed; direct regression cases fit the existing composition test file. No production patch was applied.

Six diagnostic cases bind actual source selection/copy/CLI verification and the exact AST-extracted production operator loop: original omission RED, proposed owner-bound alias with82 retained paths, missing owner, changed target, missing target and an unrelated omitted alias. The focused input includes 19 actual ELF objects; no target command/service or full root was executed. These pre-strip package/closed-input fixtures do not reproduce security.selinux and are not final metadata-transfer or full compose acceptance. Two preparation failures remain distinct: omitted existing generated loader-cache origin, then an incorrect local verify function signature. The valid RED and already-copied output were reused; actual CLI verification and remaining negatives completed without replaying them.

A single bounded current-view operator pass accounts for523 entries:490 direct roots,17 captured alternatives, the sole approved routel omission, and15 owned entries lacking direct/generated roots. The other14 are systemd-sysv's halt/init/poweroff/reboot/runlevel/shutdown/telinit, systemd-resolved's resolvectl/resolvconf, init-system-helpers' invoke-rc.d/service, and dpkg's dpkg-realpath/update-alternatives/start-stop-daemon. Their exact metadata, ownership, target and pinned upstream rows are retained. They are eight aliases and six regular commands, not another generic symlink class exemption. The three dpkg helpers survive the current named purge; retaining or removing them must agree with the existing operator and no-package-manager contracts, without restoring a database or silently pruning tools. These14 are not folded into the one-row Docker proposal, and another root must not serve as their inventory query.

Proposal `_out/wave/e176876b733d675d1e20b40b42628cd4e18b197d/Phase1-fb6c4597bb902f69d528bcdc3c8372f310c322b1/FourMasks-f4c1c4c44a64f7cda00afe5b6c74e611c440c5dd/diagnostics/docker-operator-v1/proposal.json` SHA256 `01c579b5db8fa98c6d3cebcb5f2f46101fcf4551331d666f17ff2f6ce34ec5a3`, external patch `ba0b58045f9dfc5f3bbafe744b72c65d52529ff1fdab1d2729781acde089608e`, and72-binding delivery `e36fb014181b2e623570e5edeace113d697b7f99eabe82e11eb49f7888afe9a6` were handed to B as `01M29KN969MDY7P78ADVX2GA4V` on its existing execution. The exact production boundary is consumers.json plus direct composition tests and these two records; any companion14-row reconciliation needs the concrete L1 source disposition. No new container/daemon, source write, J/fb6/4716 producer/native/tool/kernel replay, cache mutation, source synchronization, parent notification, main action or cron change occurred. Source/input quality evidence remains separate from the failed root and unexecuted guest acceptance.


### 2026-09-12 approved package-owned Docker entry correction

L1-DOCKER-ENTRY-20260912-0133 authorizes exactly one mos-podman root for the existing docker -> podman symlink with its actual owner and target/mode/uid/gid. Implementation remains in the original B7 branch; existing selection, compose algorithms and joined path sets stay unchanged. Direct production composition RED/GREEN and final two-copy source/input proof precede B review. The fourteen companion entries remain separately attributed, unapproved source proposals; they prevent a premature expensive root. Historical diagnostic and failed-root evidence are preserved.

The direct production compose RED reproduces the actual omitted Docker entry. The approved one-row change passes the existing target/helper fixture plus eight refusal cases (missing/wrong package owner, changed target, conflicting mode, absent target/interpreter/library, unrelated omitted operator). The actual captured pre-strip Podman input now passes the unmodified compose/copy/verify CLI with84 paths and eight matching negative cases; its source/archive/capture identities are bound. This is a scoped real-input composition fixture, not complete root or final stripped/SELinux transfer acceptance. The fixture preserves the actual captured join; subset inventory preparation initially omitted the mosd name distinction and failed, then was corrected without weakening production checks.

The fourteen companion entries are now separately attributed: production add(/sbin/init) already retains /usr/sbin/init and its47-path current-equivalent systemd graph. The external proposal retains eleven runtime entries, with their existing service/init-script/default/LSB resources and nine captured native rc links, and extends the installation-only purge by only dpkg-realpath/update-alternatives. start-stop-daemon has actual runtime callers in the retained service scripts; its dpkg package owner alone is not a reason to remove it. This companion patch and exact additional lineage-path request remain unapplied, pending technical disposition through B. B received this substantive packet as01M29MYNTATEKEQVNK9PXD9P00. No complete root was launched.

Evidence and source-bound self-review are under Phase1-fb6c4597bb902f69d528bcdc3c8372f310c322b1/DockerEntry-v1. Original root/setup failures and discarded proposals remain immutable. Only consumers.json, its existing composition tests and these two original records are changed. Final clean candidate/two-copy joined input and capture/release proof follow before B review.


### 2026-09-12 Docker entry clean candidate and exact input handoff

Composition `e1c84ed054329410d19201131bfebacd05554e09` / tree `e8eacf2bccff7b53319bfd251a90b3b37ae33eec` / epoch `1789177973`, parent `1e1bf96ce9e6cb463aa3cc495ab6c8d6a78a7a5c`, contains exactly the one approved consumer row, direct existing composition tests and these two records. Self-review has zero introduced findings. Both clean1831-entry copies verify all tracked modes/blobs/bytes and produce identical canonical lineage `bc49ae17e6be4f7bbfc0a988cc5e3a280d5c1f8eff94da31e6497ccb00cd3452`. The complete nine-path cumulative consumer delta, all15 producer/PREPARE maps, actual18 joined-pool files, J14 archives, fb6 deploy/native and4716 tool remain bound under their original identities. No producer, native, tool, kernel or140-check package-gate replay.

Final input steps: default mixed-source refusal1, explicit joined caller fixture boundary79, wrong immutable-tool refusal1, and33 actual joined release-input checks pass. The exact one-file release test has1 pass/4 assertions; current consumer-context refusal, types, docs and scoped diff also pass. The actual production compose/copy/verify fixture runs again only to bind the final canonical lineage:84 paths, exact existing Docker symlink and target bytes, final capture SHA joined to the actual new composition source by release sourceLineage. Earlier eight real-input negatives remain source-bound; no extracted AST loop is counted as complete compose. This limited captured-input result does not claim final stripped/Selinux metadata, packed geometry, full root or guest acceptance.

Readiness `_out/wave/e176876b733d675d1e20b40b42628cd4e18b197d/Phase1-fb6c4597bb902f69d528bcdc3c8372f310c322b1/DockerEntry-e1c84ed054329410d19201131bfebacd05554e09/metadata/successor-readiness.json` SHA256 `7d2fdcba75d2091ddf065217694487d01e5d2dc8e69192af73fc0ee1dbff2c8a` references the two copies, unchanged public/input/tool witnesses, final capture/release report and separate companion prerequisite. The candidate is ready for B's bounded source/input review. The known companion proposal remains unapplied and prevents another expensive whole-root attempt until its exact technical disposition/input proof; the sole Docker correction is not permission to prune other operators. All prior root failures remain failures.

Preparation failures remain preserved: original missing-mosd subset inventory; initial init proof omitted captured library symlinks; external proposal recorder syntax error; and a tmux launch path typo before its corrected command ran. None is product RED, a successful root, or an assertion waiver. Final direct checks use final relevant source bytes; historical metadata and wrappers were not overwritten. No B/main/347 synchronization, new node, parent notification, resource recreation or cron change.


Final evidence-reference correction: the companion proposal runner and gate wrapper reused metadata names. The initial SyntaxError gate metadata was overwritten by the v2 proposal payload; the original exact gate metadata/start timestamp is not recoverable and is not claimed as a verified binding. Original failed script/stderr remain. The v3 proposal payload was then replaced by its wrapper gate metadata, so the earlier B pointer identified a successful proposal-generation gate rather than its payload. This is disclosed in DockerEntry-v1/metadata/proposal-recorder-collision.json. The external patch was retained. A separately named v4 payload/gate generated from clean candidate e1c84ed0 resolves the reference without replaying tests/producers/root.

Authoritative companion payload is DockerEntry-v1/metadata/companion-proposal-v4-payload.json SHA256 `2f8ddb053ec64fd8e428369ae82197e76ac5adfc906a9a011770ca83f7630baa`; corrected execution-readiness reference is `_out/wave/e176876b733d675d1e20b40b42628cd4e18b197d/Phase1-fb6c4597bb902f69d528bcdc3c8372f310c322b1/DockerEntry-e1c84ed054329410d19201131bfebacd05554e09/metadata/successor-readiness-v2.json` SHA256 `eea1b98ed33284bd09571c295d345ebdf8309d3c2ea0d7bbdc2e827070a730a7`. Its only changes from readiness-v1 are that reference and this history. Candidate source/tree/epoch, both identical lineage records, real caller/capture/release checks and original producer witnesses remain unchanged. Prior general immutability wording is qualified by this explicit recorder failure. The generated selector .pyc from the scoped inline fixture was moved into DockerEntry-v1/preserved-generated-pycache, preserving bytes and restoring a clean original worktree.


### 2026-09-12 companion producer-attribution review correction

B-EXACT-COMPANION-REVIEW-FINDINGS-20260912-0158 establishes that package-manager-purge.sh is an actual frozen ca-trust producer input: full438 proof SHA25693902df4c3351b3d3e2c3ca3977f6b4bbd07fb2361c2f0aedc1f0c1c3d1b87ba, mode100755/blobd751770e7fdf8cbb113f224bdf2f6fe5120ac64a. Withdraw the earlier external proposal to edit this file or admit it into either consumer-only set. Neither proposal was applied. B instead proposes the same two exact removals after the existing purge in90-pack.Dockerfile, with only its exact JOIN_CONSUMERS additions; this remains pending L1 technical disposition, not implementation authority. No source/producer-input scan or gate was replayed for this record.

The v3 proposal/gate collision was already disclosed and recovered before this follow-up in the distinct v4 payload/gate and handoff01M29NHQP3F5JZXAWGJC0TGV07. Preserve those original bytes; no regeneration or test replay is needed. The v4 payload remains a historical proposal whose purge-path attribution is now superseded. The count remains11 new retained entries,1 already retained init,2 proposed installer removals, with9 native rc links. B is reconciling the remaining exact quota helper/default/state-directory inputs; no complete companion readiness or new root is claimed. Record: DockerEntry-v1/metadata/B-companion-findings-consumed.json. Frozen Docker composition e1c84ed0 and all source/input receipts stay unchanged; current B review continues independently.
