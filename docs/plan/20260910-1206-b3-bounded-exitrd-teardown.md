# 20260910-1206-b3-bounded-exitrd-teardown B3 bounded exitrd teardown

- **status**: completed
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
