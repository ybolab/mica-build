# 20260910-0517-writable-var-regdb Writable var with bounded DATA storage and matching regdb

- **status**: completed
- **createdAt**: 2026-09-10 05:17
- **approvedAt**: 2026-09-10 05:17
- **relatedTask**: 20260910-0517-writable-var-regdb

## Context

The latest CX3576 log reaches management health but systemd-rfkill cannot obtain
writable state under the immutable /var skeleton. The user explicitly replaces
that policy with a writable whole-/var namespace. Existing DATA ext4 project
quotas already protect a 128 MiB / 2048 inode state/meta reserve from bulk and
disposable writers. The existing regdb package selects a Debian signer absent
from the running kernel's regulatory trust store; the same pinned package's
upstream pair passes offline verification with the kernel's public certificates.

## Proposal

1. Bind DATA/var over /var, initialize its packaged skeleton before the mount,
   preserve permissions and symlinks, and order early state consumers correctly.
   Remove systemd leaf mounts and the separate /var/tmp mount. Retain protected
   mosd and Bluetooth credential binds plus early device-identity storage.
2. Include /var in the bounded project budget with explicit byte/inode limits
   established before seeding or starting consumers. Size the budget to DATA
   with a cap and preserve the existing state/meta reserve. Update physical
   storage accounting and tests. The default is one eighth of DATA, bounded to 32–256 MiB and
   2048–16384 inodes, shared by var/cache/tmp.
3. Select the matching upstream regdb/signature pair in authenticated support,
   with a packaging trust gate and regression coverage. Do not disable signature
   validation or introduce compatibility keys.
4. Build updated signed components and prove x64 and ARM64 startup, state persistence,
   service StateDirectory creation, quota enforcement and shutdown. Check
   CX3576 packaging offline; physical radio validation requires a board log.

## Risks

Early DefaultDependencies=no services must not race /var initialization or
create a dependency cycle. Quota setup must precede copied/new inodes so they
inherit the intended project. Full /var exhaustion must not consume protected
state/meta reserve. Preserve factory defaults without copying over runtime
state after updates. Generic DATA/var service state is persistent and remains
outside existing application/configuration reset allowlists.

## Scope

Rootfs system package, DATA layout/seeding/mount units, affected board packages,
regdb packager, build/verification tests, storage observation and current docs.
No unrelated BSP cleanup, BusyBox conversion, commits or pushes.

## Alternatives

Another rfkill-specific mount would retain the user-rejected per-directory
policy. A separate loop filesystem duplicates space management and shutdown
dependencies. Existing ext4 project quotas provide the required containment.

## Annotations

The user's implementation request satisfies the approval gate; continue without
requesting repeated authorization. Preserve the unrelated analysis documents.
