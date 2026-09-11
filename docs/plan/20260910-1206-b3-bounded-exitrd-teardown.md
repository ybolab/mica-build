# 20260910-1206-b3-bounded-exitrd-teardown B3 bounded exitrd teardown

- **status**: implementing
- **createdAt**: 2026-09-10 12:06
- **approvedAt**: 2026-09-10 12:06 (prior user approval)
- **relatedTask**: 20260910-1206-b3-bounded-exitrd-teardown

## Initial context (before the accepted partial delivery)

Approved B0 design: [lifecycle closure](20260910-1013-b0-lifecycle-rootfs-audit.md).
B1 supplies static BusyBox 1.36.1 with explicit applets; B2 preserves authenticated
startup and validates loop associations and target init. The current exitrd still
contains systemd-shutdown. copy_exitrd validates leaf regular files and totals,
but not empty/duplicate/canonical names or ancestor symlinks before copying.

## Proposal

1. Verify pure-shell watchdog/child supervision feasibility against the pinned
   tool source; supply concrete failure evidence and escalate a necessary native
   helper before extending scope.
2. Establish RED cases for copy preflight, path escapes, duplicate/empty manifests,
   unsafe destination nodes and permissions. Implement minimal GREEN hardening
   independently of the supervisor decision.
3. Replace the shutdown payload only after the complete approved state machine
   and focused failure fixtures pass; preserve systemd shutdown until then.
4. Run focused Rust gates, package fixtures, shell/host lints and docs verification;
   review security/storage behavior with pma-cr and record actual limitations.

## Risks

A shell foreground child can prevent watchdog/deadline enforcement; a detached
feeder can continue after the cleanup owner dies. Loop autoclear success is not
release. Device names and backing paths alone do not establish current ownership.
Fail closed and request the specified scope decision where needed.

## Scope

Only B3 authorized boot scripts/wiring, boot.rs and narrow mos-init contract,
focused Rust/shutdown tests, and these task/plan records with their own index rows.
No main-system package changes or S5 reduction. No image/kernel/rootfs/QEMU build.

## Alternatives

A small native watchdog and operation supervisor may be required. Its exact
contract and files must be approved through L2 before implementation. Retaining
systemd-shutdown is the approved staging boundary, not final B3 acceptance.

## Annotations

- 2026-09-10 12:06: Prior user approval recorded. Current signed boot, watchdog,
  recovery, storage quotas, tty2 authentication and branding remain invariant.

## Initial partial implementation and decision history

The independent copy preflight is implemented in `pkgs/mos-deploy/src/boot.rs`.
All names, conflicts, permissions and sizes are checked before creating anything.
The destination must be the fresh empty tmpfs already supplied by mos-init.
Source and destination roots reject symlink ancestors with openat2; member reads
and exclusive creates stay beneath held directory descriptors without following
links. Input descriptors remain open through copying; copying checks the actual
byte count against the preflight length. Generated runtime paths are reserved.
This assumes the existing private PID-1 source/destination lifetime; it does not
claim snapshot consistency against a concurrent writer to the signed payload.
The 8 KiB / 128 member / 32 MiB ceilings remain unchanged.

No shutdown script/helper, payload wiring, manifest member allowlist, measured
allocation budget or partial-startup cleanup was changed. The retained
systemd-shutdown closure remains in place as explicitly required until replacement
closure tests pass. This is partial B3 delivery, not completed shutdown acceptance.

### Native supervision decision sent to L2

At 2026-09-10 12:09 UTC the guarded L2 follow-up accepted the scope request with
HTTP success and `success=true`; receipt is in `scope-response.json` below.
At that historical handoff no decision had been received; the 12:21 approval below resolves it. The exact pinned source archive was fetched
from the [official BusyBox release](https://busybox.net/downloads/busybox-1.36.1.tar.bz2)
and verified against the committed pin:
`b8cc24c9574d809e7279c3be349795c5d5ceb6fdf19ca709f80cde50e47de314`.
Source-only evidence, extracted outside the repository:

- `shell/ash.c:5381-5417`: foreground wait defers trapped-signal handling until
  the command finishes. A trap around foreground umount/sync is not a deadline
  supervisor for a stalled operation.
- `miscutils/watchdog.c:68-79,140-162`: fatal signal handling writes magic-close
  `V`; SETTIMEOUT is warning-only, GETTIMEOUT is compiled out, keepalive write
  errors are ignored, and the feeder has no absolute deadline or owner-lifetime
  check. Enabling this currently unselected applet is not the B0 supervisor.
- `libbb/loop.c:50-78`: the query exposes offset and configured filename, not
  backing device/inode; detach returns the LOOP_CLR_FD result without proving
  that the association has disappeared. B3 cannot use these results as release
  proof or let stale pathname records authorize detaching a reused loop.
- The [Linux watchdog API](https://docs.kernel.org/watchdog/watchdog-api.html)
  distinguishes actual timeout queries and driver-specific close behavior.
  These findings disqualify those simple shell/feeder approaches; they are not
  a claim that every possible shell supervisor is mathematically impossible.

Proposed extension, not implemented: a narrow native `mos-shutdown` PID-1
supervisor, with `src/bin/mos-shutdown.rs` and `src/boot/shutdown.rs`, sharing
its lifecycle contract with partial-startup mos-init refusal. It owns the
monotonic deadline, validated watchdog FD and actual timeout/keepalive checks,
fixed allowed operation children, TERM/KILL/nonblocking reap and bounded output.
No generic arbitrary-command service, unbounded feeder or environment bypass.
Live loop inspection must expose backing dev/inode/flags from the held device
FD and verify release after detachment; any required unsafe ioctl boundary or
new dependency needs explicit L1 scope approval and review. A separate binary
also needs narrow export wiring in `pkgs/mos-deploy/hack/build-deb.sh`
(`ALL_BINARIES`) and `build/src/kernel-package.ts` (boot input copy); these
paths were identified from the existing mos-init producer but not modified.
An approved reuse of the mos-init binary could avoid new export wiring at the
cost of a larger retained payload. The final contract and measured size decide
that tradeoff, not an assumed historical size.

### Historical remaining rows at the partial handoff

| Row | State |
|---|---|
| Watchdog/deadline/child supervisor scope | L2/L1 decision pending; no helper added |
| Three exact verbs, live mount/DM/loop/backing state machine, partial-startup cleanup | Not implemented; existing lifecycle retained |
| Deterministic nested/moved/busy/refused/reused-device/sync/deadline fixtures | Pending approved supervisor contract; no simulated success claimed |
| Strict selected script/BusyBox/dmsetup member layout and interpreter validation | Pending coherent replacement; structural preflight is delivered |
| Archive bytes / retained file bytes / derived tmpfs budget | Pending replacement component artifact; no new archive built or size reduction claimed |
| Runtime tmpfs allocation / peak working memory / RSS | Pending B7 guest evidence |
| Full signed-image PID1/storage/watchdog/action behavior | B7, explicit L1 job grant required; current expensive grant zero |
| Physical board halt/NOWAYOUT and power-cut behavior | Separate hardware evidence pending |

## Preserved partial-delivery verification

Evidence: `/tmp/mos-b3-checks.hMNe51/`; persistent-shell tmux
`8ezwxfy2-2f3c00`. Each gate JSON records the exact command, source commit,
working patch hash, untracked file hashes, UTC start/end, log and exitCode.
Checks ran against approved merge `d3ce3acdc6883c0843e5d7e16110477efa7102d0`
plus the recorded owned changes. No detached gate remains at this handoff.

- RED: `timeout 120 cargo test --locked --test exitrd` in the repository-resolved
  Rust image: exit 101, 1 passed / 5 failed. Empty/duplicate/noncanonical
  manifest, source ancestors, unsafe permissions, reserved-node conflicts and
  destination overwrite test groups expose missing rejection. The baseline
  panic includes `called Result::unwrap_err() on an Ok value: ()` (the exact
  backtick-formatted compiler output is preserved in `red-copy.log`).
- GREEN: `timeout 120 cargo test --locked --test exitrd --test boot --test startup`:
  exit 0, 19 passed, none ignored; six new tests include multiple mutations.
- `timeout 180 bash hack/check.sh`, unchanged, in the image resolved by
  `build-env/from.sh --arch=amd64 --ref LOCAL_MOS_BUILD_RUST_CHECK`: exit 0;
  fmt, clippy, nextest, doctests and cargo-deny pass. 61 tests passed; two
  pre-existing IO-fault tests skipped and not counted as passes. As recorded
  by B2, the existing runner has warning CLI policy and lacks separate
  shear/typos/MSRV verification. No unrelated workspace policy was modified.
- Rust image: `sha256:f962663a6b90735118eb2ce954d3a457e1ba784b023fc346469927b5ecc3f0a1`.
  All owned containers used `--rm`, `--label ai-agent=true`, `--network traefik`,
  unique names and only worktree-scoped mounts; sources read-only for gates.
- `timeout 120 bash tests/boot-busybox-package-test.sh`: exit 0 for the fixture
  portion; actual x64 and aa64 payload checks explicitly report SKIP because
  neither binary was supplied. Those skips are pending evidence, not passes.
- `timeout 120 make os-host-toolchain-lint`: exit 0, 409/409 clean.
- `timeout 120 make docs-verify`: exit 0, index 195/195, links 509/509,
  status 724/724, translations 249/249, board dossiers 131/131.
- `timeout 120 make os-shell-pipefail-lint`: exit 2, 154/155 clean. Sole accepted
  unrelated baseline, reproduced verbatim:
  `FAIL: pkgs/mosd/apid/ui/verify-ui-policy.sh:82: an early-exiting grep on the right of a pipe, in a file that sets pipefail: the pipeline reports failure when the pattern IS found. Use 'grep -c ... >/dev/null'`.
- `timeout 120 bash tests/boot-shutdown-test.sh`: exit 127, verbatim:
  `bash: tests/boot-shutdown-test.sh: No such file or directory`.
  This harness is an unimplemented B3 row, not behavioral RED or passed evidence.
- pma-rust acceptance and pma-cr local security/storage review cover the two
  changed Rust files and the direct mos-init copy caller. PASS for this partial
  diff, zero introduced findings: all preflight rejection tests leave the target
  empty; symlink/hardlink overwrite refusals preserve outside content; existing
  signed boot/selection tests remain green. This does not approve an absent
  shutdown implementation. `git diff --check` passes.

At the partial handoff the task stayed claimed/in_progress and the plan implementing
while the scope decision was pending. Neither was completed or closed; subsequent
task transitions use the serializer. No sibling status, main, global changelog, push, issue
transition, orchestration wait, subagent or expensive build was performed.

## Approved native continuation (2026-09-10 12:21 UTC)

L1 approved the exact bounded native/FFI/partial-startup scope through L2 B for
campaign `mos-open-plans-20260910-100408`. This continues the same claim and
preserves partial commit `60d5a411488b048ed0b748182854592cf6d42090` and all RED
logs. Clean branch/HEAD and approved upstream ancestry were rechecked before
continuation. The prior helper hold is resolved; no additional approval is needed.

### Exact permitted implementation paths

- `pkgs/mos-deploy/src/bin/mos-shutdown.rs`, `src/boot/shutdown.rs` and the module
  declaration in `src/boot.rs`; existing `src/bin/mos-init.rs` only for bounded
  command supervision, incremental acquisition, retained payload and refusal.
- `pkgs/mos-deploy/lifecycle-sys/Cargo.toml`, `lifecycle-sys/src/lib.rs` and optional
  `lifecycle-sys/tests/ioctl.rs`; necessary member/path dependency/rustix feature
  and lock edits in `pkgs/mos-deploy/Cargo.toml` and `Cargo.lock` only.
- `docs/decisions/2026-09-10-bounded-lifecycle-ioctl.md`, owner `B/lifecycle`, review
  sunset `2026-12-10` or earlier equivalent pinned safe wrapper availability.
- `pkgs/mos-deploy/hack/build-deb.sh` only explicit new-binary build/export checks;
  `pkgs/mos-boot/initramfs.sh` and `Dockerfile` only authenticated same-architecture
  native/BusyBox/dmsetup closure and retained manifest/budget wiring. A redundant
  shutdown shell state machine will not be introduced.
- `build/src/kernel-package.ts` only required KernelInputs validation, fingerprint
  and input-copy blocks; `build/src/component-cli.ts` matching input/help/call
  plumbing; new `build/src/kernel-payload.test.ts` focused fixtures. Shutdown
  binary bytes must enter kernel build identity; missing/old inputs must refuse.
- Focused `pkgs/mos-deploy/tests/shutdown.rs`, existing `tests/exitrd.rs`, new
  `tests/boot-shutdown-test.sh`, fixtures under `tests/boot-shutdown/`, and
  `tests/file-ab-x64/shutdown-check.sh` plus `shutdown-check-test.sh`.
- This existing task/plan and their own index rows. No signing/trust/firmware or
  update format changes, release-cli/release-manifest/toolbox/public-meta changes,
  rootfs selectors, new tracking node or sibling/global status edits.

### Safe interface and ownership contract

The native supervisor owns watchdog FD, monotonic deadline, child process groups,
nonblocking bounded output and reaping, graph snapshots, phase verification and
terminal-action permission. Public verbs are exactly reboot/poweroff/halt with
bounded recognized systemd metadata. Child work is fixed typed lifecycle work,
not an arbitrary command runner, daemon, IPC service or environment bypass.
The same safe module serves mos-init refusal; no duplicate cleanup policy.
Incremental intended/acquired identities cover loop, DM, mounts/binds/moves and
verified /boot-state retirement. A failed tool can have mutated storage: compare
fresh kernel identity before adoption/release. Keep B2 checks intact and never
adopt/detach a competitor. Retire only the selected authenticated record while
its dependencies remain available; cleanup failure must not retire another entry.

Only the FFI member may opt out of workspace unsafe inheritance. It has
`deny(unsafe_code)` and `deny(unsafe_op_in_unsafe_fn)` with narrowly allowed,
SAFETY-documented wrappers using pinned rustix/Linux UAPI, initialized typed
buffers and borrowed descriptor lifetimes. Business code remains forbid.
Initially needed typed operations: watchdog GETSUPPORT/GETTIMEOUT/KEEPALIVE,
loop GET_STATUS64 and same-descriptor CLR_FD. SETTIMEOUT or enable-only SETOPTIONS
may be added only if actually needed; never watchdog magic close/disable, loop
creation/reconfiguration, exported raw pointers or a general ioctl API.
All inspection/detach FDs close before association/holder disappearance checks.

### Non-extending time budget

Read actual watchdog timeout after opening; never change board settings to make
cleanup fit. Reserve 10 seconds hardware margin and 2 seconds diagnostic time
inside the total supervisor budget `min(60 seconds, actual timeout - 10 seconds)`.
Require at least 10 seconds total budget; shorter devices fail explicitly.
The cleanup deadline excludes the final 2 seconds reserved for diagnostics.
Each operation includes TERM/KILL/reap within at most 5 seconds, additionally
clamped to the remaining cleanup deadline; at most 12 cleanup passes. Kicks are
at most 1 second apart (and at most timeout/4). Retry/TERM/diagnostics never reset
an absolute deadline. Fixtures cover 120 seconds -> 60 total/58 cleanup,
60 -> 50/48, clamped 30 -> 20/18, minimum 20 -> 10/8, and inadequate <20.
These are API-readback cases, not unmeasured board timeout claims.
D-state or otherwise unreaped work forbids success/action. After bounded failure
feeding stops; an armed watchdog reset is failed graceful shutdown. An unavailable
or never-armed device is not claimed to provide watchdog recovery.

### Verification sequence

1. RED typed ABI/errno and safe policy tests; implement wrappers and deadline/action
   parsing, then GREEN. Check x64/aa64 layouts/request codes with pinned headers.
2. RED deterministic live-graph transition/refusal and partial acquisition fixtures;
   implement bounded ordinary unmount, verified holder-first MOS DM removal,
   same-identity loop release and backing unmount; require two fresh empty scans
   plus bounded successful sync before the requested final action.
3. RED required new kernel input/fingerprint and exact exitrd layout; implement
   same-architecture payload export and measured retained budget, then GREEN.
4. Run focused Rust/Bun/package/shell/docs gates, native component/ABI/container
   fixtures and pma-cr storage/FFI review. Preserve existing unrelated failures.
   Quantify produced component/archive/retained bytes with exact identities;
   runtime allocation/RSS and actual PID1/systemd/board outcomes remain B7.

Native component builds and harmless task-owned ABI/container fixtures are
approved; expensive grant remains zero. No full root/kernel/image/QEMU guest,
cold build, management watchdog/disk or physical hardware action is authorized.
Only L2 B receives reports at the original guarded follow-up endpoint.

- Native ownership also records Linux sysfs `diskseq` for backings, MOS mappings
  and active loops. A reattachment of the same backing dev/inode is still a new
  generation and is refused. Loop inspection retries at most three times if
  closing its descriptor completes autoclear; there is no new ioctl or old-input
  fallback. Linux 5.15 and 6.12 loop/genhd sources expose this generation contract.


## Implemented continuation and review

The approved native implementation now replaces the retained systemd-shutdown
closure. The main system still uses systemd and its normal service shutdown and
pivot. No duplicate shell policy is needed. All 23 source/test files in the
continuation are within the approved paths, including the direct `tests/boot.rs`
fixture adaptation. The existing Dockerfile already copies `initramfs.sh`; no
Dockerfile or main-system package change is necessary.

The fixed native API consists of Action/Request, Budget, Ownership/Snapshot,
Operation, Supervisor/SystemIo and a private Released token. A fresh successful
release proof is the only route to the requested kernel action. Safe business
logic retains unsafe_code=forbid. The internal FFI member has exactly five typed
wrappers: GETSUPPORT, GETTIMEOUT, KEEPALIVE, LOOP_GET_STATUS64 and LOOP_CLR_FD.
No SETTIMEOUT, SETOPTIONS, watchdog disable, raw-pointer export or generic ioctl
was added. Existing dependency versions, MSRV and workspace lint policy stay fixed.

Storage scans preserve live mount IDs, parents, propagation, aliases, block
holders/slaves, DM UUID/table/generation, and loop generation/backing dev/inode/
flags/offset/sizelimit. Descriptor closure precedes the next release observation.
Foreign, reused, ambiguous or unsupported block layers and swaps fail explicitly.
Ordinary unmount follows bounded per-filesystem syncfs (which can report EIO),
then holder-first verified MOS DM removal, released loops and final backing
filesystems. Needed backing mounts can move into the private exitrd. Every
operation return or refusal triggers a new scan, including mutate-then-fail
results. Two fresh empty observations bracket bounded sync; dirty I/O, residual
users, unreaped children, failed diagnostics or returned actions forbid success.
No lazy unmount, deferred DM removal or standalone forced reboot is present.

The same supervisor handles incremental startup acquisition and refusal. B2
loop validation and target-init preflight remain intact. Failed attachment with
ambiguous ownership is not adopted from a filename. /dev, /proc and /sys can be
restored after partial moves, after first making propagation private. Quiescence
and a fresh process scan precede the existing authenticated selected-record
retirement transaction while its verified SYSTEM/boot dependencies still exist.
SharedSystemFailure/SharedDataFailure retain recovery classification. The one
watchdog descriptor is CLOEXEC, never inherited by a feeder or operation child;
systemd handoff and exitrd reopen preserve NOWAYOUT. Unknown early state, refused
cleanup or returned terminal calls remain explicit failure.

Platform timeout fixtures exercise actual readback values 120, 60, 30 and 20
seconds and refuse inadequate values below 20. The repository systemd policy
requests RuntimeWatchdogSec=90s/RebootWatchdogSec=120s; s905x5m's signed DT fixes
60 seconds. x64 and virt-arm64 use i6300ESB, cx3576 uses DesignWare and s905x5m
uses Meson. The implementation never assumes these requests equal hardware
readback: all platforms use the same margin-adjusted clamp and refusal policy.
Driver-specific actual/clamped readbacks and physical halt behavior remain B7/A
measurements, not proven by the parameterized fixtures.

### Continuation RED and GREEN evidence

All logs, patches, commands and JSON metadata remain in
`/tmp/mos-b3-checks.hMNe51/`, including the original partial failures. The gate
source is preserved partial HEAD `60d5a411488b048ed0b748182854592cf6d42090` plus
recorded patch and file hashes; `final-focused` through `final-docs` share patch
SHA256 `d497b0d07ab211c071f1070095e5b367c7dc0ed209c060a2ec0e064c5b421911`.
Later staged lint runs include new files. External command scripts are copied
with hashes into each final gate's `.commands` directory. No hidden skip is a pass.

| RED gate (exit) | Demonstrated failure | GREEN evidence |
|---|---|---|
| red-native-policy / red-ffi-api (101) | Required safe lifecycle and typed ioctl APIs absent | green-native-api (0) |
| red-native-graph (101) | Foreign mapping names accepted by the early policy | green-native-worker (0) |
| red-native-supervisor-behavior (101) | Exited parent with a live output writer incorrectly completed | green-native-supervisor (0) |
| red-native-unknown-storage (101) | Unrecorded active foreign loop accepted | green-native-unknown-storage (0) |
| red-loop-generation (101) | Same-inode reattachment accepted despite new generation | green-loop-generation (0) |
| red-systemd-argv (101) | Pinned systemd microsecond timeout/separate metadata rejected | green-systemd-argv (0) |
| red-kernel-mountinfo-root (101) | Valid initial namespace self-parent root rejected | green-kernel-storage-model (0) |
| red-native-moved-api (1) | Real moved /dev made child startup fail with ENOENT | green-native-moved-api (0), actual isolated tmpfs |
| red-exitrd-native-layout (101) | Obsolete/incomplete retained layout accepted | green-exitrd-native-layout (0) |
| red-kernel-native-input (1) | Required native input/fingerprint API absent | green-kernel-native-input-elf (0) |
| red-shutdown-evidence (1) | Old text-only checker rejected the native contract | green-shutdown-evidence (0) |

Initial lock/API setup errors, the too-short ELF fixture mismatch in
`green-kernel-native-input` (exit 1), intermediate clippy findings, and assembly
fixture setup failures remain preserved. They are not mislabeled behavioral RED.
Real source behavior informed the corrected fixtures: systemd v257.13 argv,
Linux mountinfo self-parent root, partition holders without a slaves directory,
and loop diskseq changes on reassociation. The native moved-API failure was
reproduced with actual tools before fixing inherited stdin and private-before-move.

### Final software gates

| Command / recorded gate | Result |
|---|---|
| `timeout 120 bash tests/boot-shutdown-test.sh` (`final-focused`) | PASS: 44 Rust tests across lifecycle/boot/exitrd/startup/FFI, none ignored; x64/aa64 C UAPI compile assertions |
| Repository image runner: `timeout 180 bash hack/check.sh` (`final-rust`) | PASS: fmt, clippy, nextest 86 passed, doctests, cargo-deny; 2 pre-existing ignored IO-fault tests remain unrun |
| `timeout 120 bash build/run.sh src/kernel-payload.test.ts` (`final-bun`) | PASS: TypeScript noEmit and Bun 2 tests / 15 assertions |
| `timeout 120 bash tests/boot-busybox-package-test.sh` with both actual binaries (`final-busybox.commands/actual-busybox.sh`) | PASS: actual x64/aa64 plus all packaging refusals, no skipped architecture |
| `timeout 120 bash tests/file-ab-x64/shutdown-check-test.sh` (`final-log-check`) | PASS: ordered positive evidence and nine negative mutations; external action proof stays pending |
| `final-mounts.commands/mount-fixture.sh` | PASS: native fixed workers, moved APIs, shared propagation, busy bind, mount move/stale identity and syncfs using owned tmpfs only |
| `final-native-source.commands/component-native-gates.sh` | PASS: x64/aa64 native builds and ABI test executables; no root/kernel/image job |
| `native-package-export.commands/packaged-native.sh` | PASS: production build-deb explicit mos-init/mos-shutdown export on amd64/arm64; hashes match component builds |
| `final-assembly.commands/assembly.sh` | PASS: both actual native ELFs load/refuse non-PID1 against selected runtime; harmless ioctl errno tests run natively/x64 and under aa64 user-mode emulation; actual copy_exitrd validates/copies both complete closures |
| `timeout 120 make os-shell-pipefail-lint` (`staged-shell`) | Existing UI baseline only, exit 2; 157/158 clean including all new scripts |
| `timeout 120 make os-host-toolchain-lint` (`staged-host`) | PASS: 413/413 files, zero findings, including new scripts |
| `timeout 120 make docs-verify` (`final-docs`, repeated after tracking) | PASS: index, links, status, translations and board dossiers |

The unchanged Rust gate uses rustc 1.98 from the approved image against declared
MSRV 1.96; separate MSRV/shear/typos checks are absent in that runner, and its
existing CLI warning policy is unchanged. These are recorded limitations, not a
workspace-wide waiver. The unrelated UI failure is preserved verbatim in the
partial verification section and `staged-shell.log`; no UI source was edited.

PMA-CR Rust/shared/storage and TypeScript-backend review found no remaining
introduced issue in the scoped diff. Review covered all five SAFETY sites, ABI
layout/requests, bounded output and diagnostics, child/FD lifetimes, generation
reuse refusal, graph transitions, successful syncfs before release, authorization
of the final action, strict ELF closure copying and authenticated record handling.
All business code remains safe Rust. L2 must independently review this actual API
and unsafe boundary before merging; this is local review, not L2 acceptance.

### Measured component and retained payload

Artifact root: `_out/b3-artifacts-final/{x64,aa64}/`. Production binaries are also
in `_out/b3-package/{amd64,arm64}/`. `continuation-artifacts.json` contains every
member's bytes/hash/mode, source file hashes, unique inode sums, host allocation,
archive/manifest identity and component image identity; SHA256
`2065b79920fc73104252f6445272acfe0e538ad3c10dfec593bcace29b304ced`.
These are same-runtime assembly fixtures with synthetic boot.json, not signed
kernel/full-image or PID1 guest evidence. Loader aliases are separate regular
files and counted separately; there are no hardlink savings or symlinks.

| Bytes unless noted | x64 | aa64 |
|---|---:|---:|
| Native mos-init | 1,691,784 | 1,734,584 |
| Native mos-shutdown | 1,333,152 | 1,360,848 |
| Selected retained payload (13 regular files) | 8,010,008 | 7,316,928 |
| Required retained ELF library union (10 paths) | 5,297,616 | 4,700,392 |
| Copied retained regular data (14 files, includes 14-byte initrd-release) | 8,010,022 | 7,316,942 |
| Host allocated retained file bytes (not guest tmpfs pages) | 8,044,544 | 7,352,320 |
| Manifest | 421 | 430 |
| Derived tmpfs capacity | 10,551,296 | 10,223,616 |
| Startup unpacked regular data (39 files, embedded exitrd included once) | 26,553,991 | 25,135,593 |
| Uncompressed cpio | 26,563,072 | 25,144,320 |
| Same-runtime systemd-shutdown reference closure (20 files) | 17,943,384 | 17,253,688 |
| Retained payload delta against that reference | -9,933,376 | -9,936,760 |

The capacity rounds each selected file to 64 KiB, budgets directory pages plus
four metadata pages, and adds 1 MiB for the bounded ownership record (64 KiB),
backing move directories and runtime scratch. The 32 MiB raw ceiling and 128
member limit are not raised. A capacity is not allocated memory. The native
executable is larger than the small dynamically linked systemd entrypoint;
the removed systemd dependency closure produces the measured net retained
reduction. There is no previous actual B2 native mos-init artifact to support an
init-size delta. B0's historical ARM64 archive is sizing context without an
exact artifact identity; no current archive/RSS reduction is inferred from it.
Runtime tmpfs pages/inodes, peak working allocations/process tree and RSS remain
unmeasured B7 rows. Startup includes two copies of mos-shutdown (early worker
and retained entry), both included in the archive figures.

- x64 mos-shutdown SHA256: `426903654074de89d6fb821bc6a446bdc45bebbb4d57b965d173b10f2056b410`.
- aa64 mos-shutdown SHA256: `c4f1581a37143025ad4c4989738d2dcc779e02ba8e8244ba639f95b7fba3ccf7`.
- x64 cpio SHA256: `b4f60478fb27d761108527384448126ccded0213249fb97cc07ca138f5de1dc5`.
- aa64 cpio SHA256: `14619be630e11425f4033e614c6c52ed01cdc3533c7953e449928400422b7f34`.
- Pinned header evidence: linux-libc-dev 6.12.107-1 / arm64-cross 6.12.38-1cross1;
  header hashes and both compiler versions are recorded in `final-focused.log`.
- BusyBox bytes/hashes match B1 exactly; the actual component and reference
  systemd closures use the task-owned image identified in the artifact report.

### B7 handoff and remaining external rows

KernelInputs now requires `shutdown: string`; component CLI requires
`--shutdown PATH` alongside `--init PATH`. Both exact ELF byte identities enter
buildId; copied input hashes must still match. Missing, wrong-architecture,
non-ELF or unsafe input refuses without old-format fallback. Producers must
explicitly request `--bins "mos-init mos-shutdown"` and pass each architecture's
export into kernel packaging. The authenticated initramfs contains the helper.

B7 owns the existing integration callers in
`tests/file-ab-x64/build.ts`, `update.ts` and `trust-rotation.ts`, which still need
the new required input. They are outside this exact implementation grant and
were not changed. B7 must wire its final image caller and producer before any
full image acceptance; the deliberate required-input break is not compatibility
support and is not hidden as a passing integration build.

| Remaining row | Owner / evidence needed |
|---|---|
| New required input in final image/test callers | B7, narrow caller integration |
| Actual PID1/systemd shutdown and partial-startup release of ext4/DM/loop users | B7, exact authenticated image and granted guest job |
| Actual reboot/poweroff/halt, watchdog unavailable/clamped/D-state outcomes | B7 guest plus A physical board qualification |
| Runtime tmpfs allocation/inodes, shutdown peak memory and RSS | B7 guest measurements |
| Physical halt/NOWAYOUT and power-cut/storage integrity | A, distinct board/power-cut evidence |

B3's authorized software implementation and focused gates are complete for L2
review. No heavy grant was used and no issue done transition, main merge, push,
new workflow/subagent or sibling communication is performed. D owns final
campaign indexes/changelog reconciliation. Owned resources and exact committed
source verification are recorded in the guarded L2 delivery.


## Current static refinement (2026-09-11, explicitly approved)

The earlier HYBRID implementation and its completed evidence above remain
historical delivered work. They do not satisfy this new single-static-executable
refinement. L1 decision `01M28Y5AV9CZR3QMH27NAZBX55`, relayed in the complete B
handoff for campaign `mos-open-plans-20260910-100408`, authorizes implementation
without another generic approval checkpoint. Same B3 issue/branch/owner; B7 alone
owns subsequent combined image acceptance.

Clean `c6eb729cf4ef18f32540bd882651aa3f2d8c1583` was synchronized with exact reviewed
B ref `da65dd92ed4680531e0a065f05da24e59dd94866`, tree
`dc4fc6998508b23d74f3c43425bc0a1eab287971`, by authorized no-ff merge
`31e7d98896541b3e571462a307772b7a4f96a56f`. No conflicts or unknown changes.
The accepted no-Python composition remains `ce361585dc6971ad42bae870e590a1dbebb38b82`,
tree `186b1dea92b61bee0dda22394c33a702d44cf272`, epoch `1789153454`. It is not
reidentified as this merge. No runtime selection/Python pin or allowance changes.

### Executable scope and interface

1. Reuse `src/boot/shutdown.rs` and `src/bin/mos-shutdown.rs`: replace external
   BusyBox propagation/move/unmount/sync with pinned safe rustix mount/sync calls
   inside the existing fixed same-executable worker. Keep blocking operations
   away from the PID1 supervisor. Preserve all existing Action/Request, watchdog,
   Budget, child/FD lifetime, identity graph, syncfs and release-token contracts.
2. Extend only `lifecycle-sys/src/lib.rs` (and Cargo.toml if needed) with typed
   DM_DEV_STATUS, DM_TABLE_STATUS plus DM_STATUS_TABLE_FLAG, and DM_DEV_REMOVE.
   Use an identity-verified held control FD, checked initialized aligned UAPI
   buffers, bounded size/count/retry policy, exact name/UUID/dev/table identity,
   complete target coverage and response-relative next offsets. No generic
   ioctl, new C library, removal-all/force/deferred bypass, or business unsafe.
3. `src/boot.rs`, `pkgs/mos-boot/initramfs.sh` and necessary existing payload wiring
   accept exactly one static `/shutdown` member plus generated metadata/empty
   runtime directories and the private authenticated storage record. Reject
   loaders, libraries, BusyBox/dmsetup and every extra member together. Keep
   source/destination descriptor preflight, owner/mode/link/path/size checks.
   Startup retains BusyBox, blkid, veritysetup, dmsetup and mos-init setup.
4. Modify the actual native export `hack/build-deb.sh` and required
   `build/src/kernel-package.ts`/direct payload tests. Existing B7 callers already
   pass explicit mos-init/mos-shutdown paths and use build-deb with both bins;
   do not introduce an unused parallel producer. Direct signed-boot-lab scripts
   were inspected: they package their older lab guest, not this native export;
   change them only if an actual consumer assertion requires it.
5. Preserve pinned Cargo versions/workspace unsafe forbid and lock. Only necessary
   rustix features or demonstrated static inputs may change. A missing required
   static input may change existing `build-env/rust/Dockerfile`, filtered Rust
   images.env entries and directly affected identity/check plumbing. No global
   tool install, toolchain refresh or unrelated runtime/producer change.

### Ordered static-input preflight

Inspect exact `localhost/mos-build-rust:amd64` image identity, rustc/cargo, target
std, GNU linker/compiler and static archives. First build existing GNU x64/aa64
shutdown targets with explicit target-only `-C target-feature=+crt-static`,
private per-architecture target/output directories, unchanged lock and <=4
workers. Prove actual ELF machine/type/no PT_INTERP/no DT_NEEDED and run benign
refusal/fixed worker cases in otherwise empty userspace. A linker flag is not
static proof. Do not apply flags to mos-init, mos-deploy or host build scripts.

If the GNU route fails its full contract, preserve the failure once, then prepare
pinned supported musl target/std/linker/libc inputs at the SAME Rust 1.98.0;
record exact upstream URLs, digests, licenses and image identity before use.
Workspace rust-version=1.96 remains an MSRV, not the current compiler. Report an
irreducible missing input precisely while continuing independent source work.
Selected route/result must be recorded here before final source freeze.

### RED, GREEN and direct gates

- First capture actual current dynamic artifacts, three-executable retained
  manifest and external fixed-tool dependency as RED. Preserve all old wave and
  setup failures without replaying unrelated no-Python/runtime/ELF suites.
- Typed DM tests: both ABI layouts/request codes and harmless errno/FD behavior;
  malformed/truncated/oversized/unterminated buffers, count/flags/version/offset/
  overflow, DM_TABLE_STATUS absolute-from-first-target next semantics, provider/
  table/name/UUID/dev mismatch, busy/race/reuse and post-remove proof failures.
- Existing state-machine/watchdog/deadline tests plus syscall failure/order cases,
  partial-startup shared backend, mount ID/propagation/move/ordinary unmount and
  syncfs refusal. Privileged fixtures use only task-owned mounts, never shared
  disks/watchdogs; actual DM/hardware remains separate when unavailable.
- Actual x64 and aa64 static artifacts: real ELF parser, otherwise empty root
  execution (aa64 user-mode emulator clearly labeled), one-member copied exitrd,
  negative dynamic/extra library/executable/architecture/owner/mode/link/path/
  manifest/partial-copy cases. Adapt existing fixtures; no new framework.
- Focused Rust fmt/clippy/nextest/doctest/deny via repository image; relevant Bun
  kernel/native-input checks, boot-shutdown harness, shell/host/docs checks and
  PMA-CR safe/FFI/storage/build review. Existing unrelated limitations persist.
- Measure binary and retained metadata/page/alignment/scratch capacity, actual
  assembled cpio and input identities. 1-2 MiB is a target, not an assumed pass.
  Final guest working allocation/RSS and physical watchdog/power-cut remain B7/A.

### Producer identity and resource discipline

Changes to the native workspace/backend/build flags change producer contexts.
Rebuild affected native/deploy/component producers and consumers with new actual
identities. Never extend composition-only lineage allowances or reuse original-J
native bytes as static evidence. Report required B7 successor inputs and exact
source/version/epoch/tool/lock/flag/artifact bindings. Keep other accepted inputs
only under their original relevant-input proof; no broad freshness bypass.

One active B L3, global at most two heavy jobs, each <=4 CPU/10 GiB/no swap,
separate outputs and fresh resource checks. Existing B7 builder containers are
idle buildkitd-only, not active compile jobs; do not change those shared resources.
B3 uses its own bounded component/fixture containers and persistent tmux, no full
root/kernel/image/guest/cold run. All reports go only to B8t4ghqi6.

Historical tracking issue detected before implementation: the existing serializer has no
reopen action; claim on this completed task returns verbatim
`task-state: claim requires pending status, found completed`. Preserve historical
completion and the existing owner; report this exact format gap to B, do not
silently bypass the serializer. This refinement is explicitly implementing in
this plan, not completed by the historical task marker.

Primary contracts: [Rust linkage](https://doc.rust-lang.org/reference/linkage.html#static-and-dynamic-c-runtimes),
[systemd initrd interface](https://systemd.io/INITRD_INTERFACE/), and
[Linux 6.12 DM UAPI](https://raw.githubusercontent.com/torvalds/linux/v6.12/include/uapi/linux/dm-ioctl.h).
These sources define interfaces; only actual artifacts/fixtures establish results.

### Selected static input route and initial software evidence

- GNU target-only `+crt-static` succeeded with the existing Rust 1.98.0 producer
  image `sha256:b13d4a7b877c9d6dd9a2766c4e80f1fd020218715d62877c69ce0dc2abe4fc12`.
  No musl, new package pin, lock resolution or build-environment change is needed.
  The production shutdown route additionally strips symbols, uses its own
  `target-deb/<producer>/shutdown-static` cache, and validates actual program and
  dynamic headers. Host build scripts and `mos-init` keep their existing route.
- Evidence root: `/tmp/mos-b3-static.3ttniist`. `preflight-{x64,aa64}.json/log`
  bind source `31e7d98896541b3e571462a307772b7a4f96a56f` plus recorded patch,
  compiler/std/linker/static archive identities and linker maps. The preliminary
  hybrid-backend static executables are 2,463,720 / 2,303,720 bytes, SHA-256
  `01d7b88b6c7663d1d84094909814325a01c33a29c2b60c7825444bbebccbb87c` /
  `d95a7bdf1417ebbe52d257f094a3a4422d5309179c8776a5fcb08a2b9f2adedc`.
  These are preflight inputs, not the final direct-backend producer outputs.
- Both preflight executables loaded inside empty chroots. Their historical
  external-tool worker then failed, as required by the dependency RED fixture.
  The x64 ELF is static PIE (relocation-only PT_DYNAMIC is allowed); aa64 is
  ET_EXEC. Neither has PT_INTERP or DT_NEEDED.
- ARM fixture execution uses the existing approved BuildKit emulator extracted
  read-only from `moby/buildkit@sha256:28a898719c18a33f4e8000685287fa36fd0dd9560c6440227d3a732d79bb41d8`,
  executable SHA-256 `239ff153cde81b6a6ab2c48eef9cff234751caa8e9d841363eace8db51e000e8`.
  This is userspace emulation, not a guest, hardware or native ARM result; no
  binfmt/shared-builder changes were made.
- Meaningful RED: `red-dm` (missing typed API), `red-manifest` (single static
  layout rejected), `red-hybrid-artifact` (actual old dynamic ELF),
  `red-empty-protocol-{x64,aa64}` (external lifecycle tool unavailable), and
  `red-kernel-static` (dynamic shutdown input accepted). Initial empty-fixture
  missing-Python setup failures remain separate, as do compile/obsolete-hybrid
  positive/clippy failures while implementing; none is relabeled as a pass.
- Necessary direct-consumer adjustments also include
  `pkgs/mos-deploy/tests/boot.rs` and
  `tests/boot-busybox-startup-package-test.sh`: their old three-executable
  positive expectations must follow the new manifest. They preserve startup
  BusyBox/operator assembly and all path/permission/identity refusal checks.
- `green-source2` passes typed ioctl tests, the unchanged bounded supervisor and
  storage state-machine tests, the strict copier and partial-startup tests, plus
  Bun typecheck and four direct native-input tests. Final source-bound gates and
  actual component/retained/archive measurements follow before delivery.

### Current acceptance schedule: x64 first (user amendment, 2026-09-11)

This explicit user amendment supersedes the preceding dual-architecture delivery
matrix. Phase 1 qualifies the current source and single-static exitrd on x64.
B3 preserves its dirty implementation and passed source gates; no further ARM
compiler, container/emulator or guest run is authorized before main integration.
A one-time check found no active B3 ARM container or detached build. The pending
native producer had not started, so no process needed interruption.

B3 owns x64 native/static/ABI/empty-userspace/retained fixtures and source review;
B7 alone owns the final combined x64 root, signed image and real guest acceptance.
ARM source/UAPI alignment is reviewed without cross-compilation. The focused
shutdown runner defaults to x64; its explicit `--arm-abi` option is deferred until
the actual approved main merge. Earlier ARM static preflight results remain
historical inputs with their original identities, not validation of this backend.

Phase 2 freezes that future merged commit/tree for one consolidated virt-arm64
and CX3576 wave, including the required pair of independent equal-input virt
cold roots. ARM rows are deferred-by-user, not passed, removed or prerequisites
for current x64 caller readiness. No new S905 installer/full image is added.
Main merge/push still requires the later concrete user decision. No main, sibling
record or shared resource is modified here. B must relay this schedule to B7.

### X64 source and artifact delivery

The current x64 static implementation is ready for B independent source review.
The tracking limitation is resolved by the authorized same-owner reopen below.
The task remains in progress for B independent review; x64 caller readiness and
all existing source/artifact evidence are unchanged. No new ARM execution
occurred after the user scheduling amendment.

| Item | Measured result / identity |
| --- | --- |
| `mos-shutdown` | 2,047,144 bytes; SHA-256 `d2c5c9a6e2473c0125670031c79014c6ee946b834e2e26f32a65f38939e68b35` |
| `mos-init` | 1,673,848 bytes; SHA-256 `738391aa650a58fb3819f52831f6affd57ddd17e357c2a161faaf39d800ec642` |
| Retained executable layout | Exactly `shutdown`; root-owned mode 0755, static x64 ET_DYN PIE, no PT_INTERP/DT_NEEDED/RPATH/RUNPATH |
| Materialized retained files | 2,047,158 bytes: executable plus 14-byte `etc/initrd-release`; seven empty runtime directories; authenticated `storage.json` is supplied by unchanged startup handoff later |
| Measured tmpfs limit | 3,866,624 bytes: executable rounded to 2,097,152 at 64 KiB/page, 11 directory/metadata pages (720,896), plus 1,048,576 for the bounded 65,536-byte record and scratch/headroom |
| Packed initramfs fixture | 21,293,056 bytes; SHA-256 `3cbfb7d5af5ebb66ecbbd51fc26fe0091b60dfb1e95a34e091a772cf8865ffd0` |
| Historical hybrid selected payload | 8,010,008 bytes; current selected payload is 5,962,864 bytes smaller |
| Historical hybrid packed fixture | 26,563,072 bytes; its old source/tool identity is preserved, not relabeled as an equal-input reproducibility comparison |

The executable is about 1.95 MiB; the 1–2 MiB binary target is measured here,
not a guest memory claim. Native/ELF/unpacked/host-allocation/file hashes are in
`/tmp/mos-b3-static.3ttniist/measurements.json`. Actual guest working allocation,
RSS, final signed-image size, hardware watchdog and power-cut proof remain pending.
Assembly used the fixed existing tool image
`sha256:4cac4ecfca71752a5012b09d6fc5e4e89d064afc56568f703b8c04244cd53631`
with the current `initramfs.sh` and the exact unchanged B1 x64 BusyBox bytes
`c48d13f5cc6f68e5ef897de4c04f85cb0d8af510ff1af0256490b37029fa6c4a`.
This image lacked the BusyBox payload, so the first assembly setup failure is
preserved; the successful fixture explicitly mounted that verified existing
payload. It is not a newly built production boot-tools image or a signed image.
B7 must rebuild the changed boot-tools/native/component contexts on its reviewed
combined source, without original-J or composition-only native reuse.

Verification retained in the same external evidence directory:

- `rust-gates3`: repository fmt/clippy/nextest/doctest/deny gate passed 94 tests;
  two pre-existing IO-fault tests remain skipped, not passes. Existing duplicate
  dependency/license warnings remain; no shear/typos/separate MSRV claim.
- Local review then found a too-permissive DM status response length. The added
  `red-status-length` fails at 306 bytes; `final-dm` passes fmt/clippy and all six
  DM parser groups plus two harmless real-descriptor tests after the exact
  305-byte guard. Only this affected source was rechecked; the passed unrelated
  suites were not replayed. The final native producer was rebuilt for this guard.
- `native-x64-reviewed`: actual `build-deb.sh --producer b3-static-amd64 --bins
  "mos-init mos-shutdown" --arch amd64` succeeds with private outputs, pinned
  Rust 1.98/GNU static route, unchanged lock digest
  `816a21311421587b088bc65239c1489998db43421e458d2f163a180af13a049e`,
  4 CPUs, cpuset 0–3, 10 GiB/no swap and four compiler jobs. Earlier native
  outputs remain historical. Linker warnings about glibc `getaddrinfo` and
  `getpwuid_r` are preserved together with the linker's garbage-collection note;
  no allowed lifecycle path performs NSS/network/name lookup. Actual empty-root
  and mount-worker execution below passed without any loader/library closure.
- `x64-fixture-tools3`: compile-only x64 UAPI assertions against pinned
  linux-libc-dev 6.12.107-1 passed; header digests and actual request/offset/size
  checks are logged. The copy fixture links the exact final producer library.
  Initial fixture-library selection and missing host proc-macro dependency setup
  failures are retained, not software/hardware pass evidence.
- `x64-artifacts2`: actual single-payload materialization, unchanged startup
  BusyBox/blkid/veritysetup/dmsetup, empty-userspace loader/protocol/EPERM worker,
  private propagation/API restoration, nested/busy tmpfs, ordinary unmount,
  moved-mount stale identity refusal and syncfs fixtures pass. These containers
  use only owned tmpfs and no physical/DM/loop/watchdog devices. This is not PID1
  systemd or actual DM/watchdog guest acceptance.
- `actual-negatives`: nine actual-copy refusals (extra executable/library,
  dynamic binary, foreign architecture, wrong owner/mode, symlink, traversal,
  missing later member) leave the destination empty. The real kernel-input
  consumer accepts the final x64 bytes and rejects the historical dynamic ELF.
  BusyBox package contract and actual unchanged x64 payload pass; its explicit
  absent ARM payload line is deferred-by-user, not an ARM pass. The four Bun
  native-input tests/24 assertions and typecheck already passed in `green-source2`.
- `shell-final`: 161/162 files clean; the only failure is the preserved unrelated
  `pkgs/mosd/apid/ui/verify-ui-policy.sh:82` pipefail baseline. The new producer's
  flagged grep form was corrected without weakening the checker. Host tooling,
  documentation and ordered shutdown log checker passed; final record checks
  follow the scoped commit. All command/source/patch/time/log/exit-code records
  remain inspectable. No failure or discarded fixture is renamed to GREEN.

PMA-CR local review of safe API, all six unsafe sites (one added fixed DM block),
worker/FD lifetimes, identity/race/refusal transitions, authenticated startup and
record preservation, strict ELF copying and actual build consumers has no
remaining introduced finding. `review-source.json` binds each changed production
and test file and unchanged startup/authentication/lock inputs. B owns independent
review, B7 owns final combined x64 guest acceptance, and ARM is deferred-by-user.
Main merge, push, issue done, shared resource changes and physical actions were
not performed. At source delivery 36866b47, the historical completed task marker remained
because `task-state.sh` could not reopen it; the exact preparation failure was
reported to B twice. The authorized resolution below supersedes that limitation.


### Tracking-only same-owner reopen (2026-09-11)

B relayed explicit user/L1 authorization for the missing unsupported reopen
operation on this SAME task. Under the serializer's exclusive docs/task directory
inode flock, the task's completed status, b3/8ezwxfy2 owner and unique [x] index
row were re-read and asserted. Paired detail/index changes were staged with
rollback and committed as in_progress/[-], preserving the owner, HYBRID history
and verbatim `/tmp/mos-b3-static.3ttniist/serializer-claim.log` preparation failure.
No shared skill/serializer or sibling status changed. The current plan and its
one index row remain implementing/[-]; all later supported task transitions use
`task-state.sh`.

Evidence: `/tmp/mos-b3-reopen.gc9d6pdo/reopen.json` and `reopen.log`, with before/
after detail/index snapshots, locked directory identity and exact source/time.
The x64 implementation commit `36866b47f2647e778ef33d7183fbba88a81a494e`, original
source-bound gates and artifact identities remain valid and unchanged. Only
tracking/document checks run for this follow-up. B independent review, B7 x64
signed-image acceptance and the user-deferred post-merge ARM wave remain separate;
this transition neither closes the static refinement nor marks the campaign done.
