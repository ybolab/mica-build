# RFCT-142 Reading the U-Boot boot credits races a writer that no lock orders

- **status**: completed
- **priority**: P1
- **owner**: bkd/nlijystw
- **createdAt**: 2026-08-26
- **completedAt**: 2026-08-27

Two processes write the redundant U-Boot environment, and the file that
configures access to it says what protects them from each other:

```
# Two writers exist for this environment (RAUC slot marking and the first-boot
# machine-id oneshot), and libubootenv gives no cross-process locking, so their
# writes must never overlap.
```

at `os/rootfs/overlay-v2/etc/fw_env.config.in:23-25`. What keeps those two
apart is boot-time systemd ordering, not a lock: the machine-id oneshot runs
`After=local-fs.target` and is deliberately ordered before no target at all
(`os/rootfs/overlay-v2/usr/lib/systemd/system/mos-machine-id.service:6-8`),
and RAUC writes `BOOT_A_LEFT`/`BOOT_B_LEFT` through `fw_setenv` as part of slot
marking (`os/pkgs/rauc/system.conf.in:35`). Ordering that holds during boot
says nothing about two processes that meet afterwards.

A dashboard that polls `BOOT_A_LEFT`/`BOOT_B_LEFT` is a reader with no
ordering relationship to either writer. A UI-triggered `rauc install` is worse:
it is a writer created on operator demand, outside any boot sequence, so the
ordering that separates the two existing writers does not reach it either. The
redundant pair exists so a torn write leaves one good copy, and a reader that
lands mid-write reads whichever copy the tool selects — which is a correctness
question nobody in this tree has answered.

What a resolution owes: whether `fw_printenv` against the redundant pair is
safe to run concurrently with `fw_setenv` at all, and if it is not, what
serialises them — a lock file both writers take, a single owning process, or a
mosd-side cache that is the only reader.

`docs/design/dashboard.md` section 8.2 phase 4d gates the boot-credits work on
this hazard and must keep doing so until it has an answer.

## Resolution

**Decision: a lock file every fw_printenv/fw_setenv user takes — and the tools
already take it.** The premise this task inherited ("libubootenv gives no
cross-process locking") is false for the libubootenv this image ships, so the
serialisation rule is: every access to the redundant environment goes through
`fw_printenv`/`fw_setenv`, which serialise themselves; nothing may read the
UENV partitions directly. Both existing writers already comply — the
machine-id oneshot calls the tools (`os/rootfs/overlay-v2/usr/lib/mos/mos-machine-id:43,52`),
and RAUC's uboot backend execs them (recorded at
`os/rootfs/stages/40-board.Dockerfile:50` and cited from `rauc`'s own
`uboot.c` in `os/pkgs/rauc/system.conf.in`) — so implementing the rule for
today's writers is proving the lock exists and pinning the rule where every
future reader/writer will look.

What was verified, all on the exact pinned base image
(`debian:trixie-slim@sha256:d7e12182...`, the digest in
`os/build-env/images.env:52`, which installs `libubootenv-tool 0.3.5-0.1+b2`):

- **The lock is real and covers reads.** strace of `fw_setenv` and of
  `fw_printenv` both show
  `openat("/var/lock/fw_printenv.lock", O_WRONLY|O_CREAT|O_TRUNC, 0666)` then
  `flock(LOCK_EX) = 0` before either env copy is opened. In the 0.3.5 source
  (Debian `apt-get source libubootenv`) the lock is the library's, not the
  tools': `libuboot_lock` at `src/uboot_env.c:114-128`
  (default `/var/lock/fw_printenv.lock`), taken in `libuboot_open`
  (`:2059`) and released in `libuboot_close`, so the exclusive lock spans the
  whole open-read-modify-write and readers cannot observe a torn write —
  which answers the task's correctness question: concurrent
  `fw_printenv`/`fw_setenv` is safe.
- **Caveat 1: lock failure is silently ignored.** `libuboot_open` discards
  `libuboot_lock`'s return; with `/var/lock` removed, strace shows the
  `openat` fail `ENOENT` and the write proceed with **no flock at all**
  (exit 0). The lock therefore depends on `/var/lock -> /run/lock`, which
  systemd-tmpfiles recreates every boot (`legacy.conf`: `d /run/lock`,
  `L /var/lock`) at sysinit. Every env user must keep
  `DefaultDependencies=yes`; both existing writers do (verified: neither unit
  sets `DefaultDependencies=no`; `rauc.service` and `mos-machine-id.service`
  are ordinary services, so the implicit `After=sysinit.target` holds).
- **Caveat 2: the flock spans one invocation, not a check-then-set**, so the
  rule keeps the existing single-owner split per variable: `machine_id` is
  the oneshot's, `BOOT_ORDER`/`BOOT_A_LEFT`/`BOOT_B_LEFT` are RAUC's, readers
  unrestricted.

What changed:

- `os/rootfs/overlay-v2/etc/fw_env.config.in:23-47` — the hazard paragraph
  replaced by the rule, its evidence and both caveats (device lines moved to
  `:49-51`).
- `os/rootfs/overlay-v2/usr/lib/systemd/system/mos-machine-id.service` —
  comment: ordering is no longer the only protection; the unit must keep
  `DefaultDependencies=yes` for the lock to be real. No functional change.
- `os/pkgs/rauc/system.conf.in` — the boot-credits paragraph now records that
  `fw_setenv` self-serialises and who owns which variable.
- `docs/design/dashboard.md` 8.2 phase 4d — the gate is now the rule (exec
  `fw_printenv` only, default dependencies, read-only), not the open
  question.

Checks: `bash os/pkgs/rauc/render-config.sh --check`,
`bash docs/verify-citations.sh`, `bash docs/verify-index.sh` all green;
`mos-machine-id.service` re-read carefully (comment-only change,
`systemd-analyze verify` unavailable). Known residue: `docs/design/dashboard.md:787`
(section 5 gap table, outside this task's edit scope) still describes the
hazard as unanswered; its `:23-25`/`:27-29` shorthands still resolve
mechanically.
