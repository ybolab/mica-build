# 20260910-1142-b2-busybox-startup B2 explicit BusyBox startup semantics

- **status**: implementing
- **createdAt**: 2026-09-10 11:42
- **approvedAt**: 2026-09-10 11:42 (prior user approval)
- **relatedTask**: 20260910-1142-b2-busybox-startup

## Context

B0 specifies explicit `/bin/busybox APPLET` invocation. B1 provides pinned
static BusyBox 1.36.1 for x64 and aa64. Current mos-init uses util-linux mount,
losetup `--read-only --find --show`, and switch_root. The existing systemd
shutdown closure remains until B3. Approved L2 source and #313 changes were
merged and inspected before implementation; no main contents were consumed.

## Proposal

1. Add meaningful RED tests for mount/bind/move/switch_root commands and loop
   selection, read-only association and refusal behavior; use the existing
   pinned Rust runner and exact B1 binary for argument parsing where possible.
2. Adapt startup calls minimally; query a free loop, validate its numeric device
   identity, explicitly bind read-only, verify the actual association and ro
   state, and refuse malformed, raced or mismatched devices safely.
3. Wire only BusyBox into startup in place of util-linux mount/losetup/switch_root;
   retain util-linux blkid, veritysetup/dmsetup and the unchanged exitrd manifest.
4. Verify focused RED/GREEN, existing Rust package and supply-chain gates,
   BusyBox package fixtures, shell/host-toolchain lint and docs verification;
   perform pma-cr and commit only owned scoped files.

## Risks

Free loop selection is not reservation. Never detach a raced device. Bind and
move flags must retain kernel mount semantics and all API/run mounts, support
and identity. Guest mount behavior, initramfs release and hardware evidence
remain B7 grant-only checks and cannot be inferred from fixtures.

## Scope

`pkgs/mos-deploy/src/bin/mos-init.rs`, narrow startup helpers/tests in that
package, `pkgs/mos-boot/initramfs.sh` and startup Dockerfile wiring, focused
startup fixtures in `tests/`, and these records with their own index rows only.
B3 shutdown, copy/manifest hardening, C metadata, UI and global tracking remain
outside this node. No new dependency or workspace-policy refactor is proposed.

## Verification

Evidence directory: `/tmp/mos-b2-checks.FCEP0k/`; persistent shell tmux session
`js1slhab-358534`. Each gate has a command, log, source patch and JSON metadata
with source commit, UTC start/end and exit code. The initial source commit is
`ef28a3ec82ef1a4a0cc027c605fb1fa2c991e114`; precommit runs include this node's
working changes. A final committed-source run follows the implementation commit.

- RED `timeout 120 cargo test --locked --test startup`: exit 101, unresolved
  `mos_deploy::boot::startup`. The tests specify full argv, binding sequence,
  selected device return, bounded races, invalid device names, absent/wrong/
  writable/offset/limited associations and kernel-state parsing.
- RED target-init preflight: exit 101 for missing validation functions. GREEN
  `timeout 120 cargo test --locked --test startup --test boot`: 13 passed,
  none ignored. Absolute init symlinks resolve within the authenticated root;
  missing/nonexecutable targets and an ordinary old-root directory refuse.
- RED startup package fixture: exit 2, `cmp: .../x64/bin/busybox: No such file
  or directory`. GREEN `tests/boot-busybox-startup-package-test.sh`: both target
  architectures pass, missing/wrong-architecture BusyBox refuses, retained
  systemd shutdown manifest and unchanged /init bytes verified. This is an
  assembly fixture using a same-architecture ELF stand-in for mos-init, not a
  bootable signed image.
- `tests/boot-busybox-startup-tools-test.sh`: actual B1 x64 and aa64 binaries
  pass. aa64 uses qemu-user, not a guest. Real isolated devtmpfs/proc/sysfs/tmpfs
  and SquashFS mounts verify flags, loop identity/read-only/offset/size, occupied
  loop and unsupported --show refusal, executable support binds, nonexecutable
  read-only machine-id, API mount ID preservation and retained child tmpfs.
  Non-PID-1/ordinary-directory switch_root refuses. Owned mounts and loops were
  explicitly released before each test container exited.
- The real binary disproved an initial assumption that a single-target remount
  must refuse with fstab disabled: it still looks up /proc/mounts. That incorrect
  negative test was removed based on executable/source evidence. The production
  two-operand form avoids that lookup and its effective flags are verified.
- Existing `pkgs/mos-deploy/hack/check.sh` in the image resolved by
  `build-env/from.sh --arch=amd64 --ref LOCAL_MOS_BUILD_RUST_CHECK`: exit 0.
  fmt, clippy, nextest, doctests and cargo-deny pass; 55 tests pass. Two existing
  ignored io_faults tests remain unrun: `transactions_survive_each_boundary`
  requires its isolated IO fault shim; `replacement_capacity_uses_reclaimed_blocks_without_a_third_version`
  requires its bounded tmpfs runner. These are not startup tests or passed evidence.
  Signature/tampering/corruption/fallback tests remain in the passing suite.
- Rust gate image is `sha256:f962663a6b90735118eb2ce954d3a457e1ba784b023fc346469927b5ecc3f0a1`:
  rustc/clippy 1.98.0, rustfmt 1.9.0-stable, nextest 0.9.143, cargo-deny 0.19.9.
  Existing `-- -D warnings` CLI policy, absent shear/typos/MSRV verification and
  MSRV 1.96 versus gate compiler 1.98 remain repository baseline gaps; no
  workspace-policy rewrite or new tool installation belongs to B2.
- `timeout 120 bash tests/boot-busybox-package-test.sh`: fixture passes. A second
  run supplies both actual binaries and qemu-aarch64; both pass with no payload
  skip. B1 source/config remained unchanged. A needed component-only build
  produced image `sha256:43b7c468f2ba8217d13727a8887731c93a2eee87acde104476a06c9de75b9493`.
  Its first invocation refused unsupported BuildKit network mode `traefik`;
  the normal existing Docker build route passed. All test containers used
  `ai-agent=true`, `traefik`, unique names, `--rm` and narrow source mounts.
- Actual BusyBox identities match B1: x64
  `c48d13f5cc6f68e5ef897de4c04f85cb0d8af510ff1af0256490b37029fa6c4a`
  (1,213,152 bytes); aa64
  `d32412a3ebd0997df9917995c3df54dc93c7bdbc18d0e08e331c24fbfcdc7f2a`
  (1,056,896 bytes); 19 applets each.
- `timeout 120 make os-host-toolchain-lint`: 409/409 pass after staging the new
  fixtures. `timeout 120 make docs-verify`: pass. Shell syntax and diff checks pass.
- `timeout 120 make os-shell-pipefail-lint`: exit 2, 154/155 clean. The sole
  accepted unrelated baseline is reproduced verbatim:
  `FAIL: pkgs/mosd/apid/ui/verify-ui-policy.sh:82: an early-exiting grep on the right of a pipe, in a file that sets pipefail: the pipeline reports failure when the pattern IS found. Use 'grep -c ... >/dev/null'`.
  Both new scripts and modified initramfs.sh pass. UI source is untouched.
- pma-cr local review: PASS, zero unresolved in-scope findings. The source,
  callers, new fixtures and unchanged signature/manifest protections were reviewed.

## Remaining acceptance

B3 owns safe shutdown and partial-startup cleanup plus exitrd manifest hardening;
no shutdown code or exitrd manifest policy changed. B7 must prove actual PID-1
switch_root, startup payload release, main systemd handoff, complete signed-image
boot/fallback/wrong-disk/watchdog behavior and real ext4 mounts. No full rootfs,
kernel, image, QEMU guest or cold build ran; these require an explicit L1 grant
relayed through L2. Physical boards and power-cut evidence remain separate.
D owns final campaign/global tracking and changelog reconciliation.

## Alternatives

The approved explicit applet design removes ambiguity without adding an applet
symlink farm. Keeping systemd-shutdown is the agreed staging boundary until B3.

## Annotations

- Prior full-tier user approval recorded on 2026-09-10; compatibility is
  unnecessary unless explicitly requested later.
- Task transitions use task-state.sh; its documented interface supports tasks
  only. Plans use the canonical draft/implementing/completed format, consistent
  with the accepted B0/B1 tracking records.
