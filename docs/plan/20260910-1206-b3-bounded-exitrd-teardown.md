# 20260910-1206-b3-bounded-exitrd-teardown B3 bounded exitrd teardown

- **status**: implementing
- **createdAt**: 2026-09-10 12:06
- **approvedAt**: 2026-09-10 12:06 (prior user approval)
- **relatedTask**: 20260910-1206-b3-bounded-exitrd-teardown

## Context

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

## Implementation and remaining decision

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
No decision has yet been received. The exact pinned source archive was fetched
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

### Remaining rows

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

## Verification

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

The task stays claimed/in_progress and the plan implementing while the specified
scope decision is pending. Neither is completed or closed; any future transition
will use the serializer. No sibling status, main, global changelog, push, issue
transition, orchestration wait, subagent or expensive build was performed.
