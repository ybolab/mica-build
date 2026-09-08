# RFCT-915 Register SSH logins with logind and audit omitted recommends

- **status**: in_progress
- **priority**: P1
- **owner**: implementation/plan-911-m3-m3a-20260831
- **createdAt**: 2026-08-31 04:00 UTC
- **plan**: PLAN-911 M3 and M3a

## Description

Repair missing logind registration for SSH logins by explicitly installing
`libpam-systemd`, which makes Debian's `libpam-runtime` register PAM sessions
with logind. This independently restores session tracking, user slices, and
`loginctl` management; it is not a prerequisite for rootful podman. Do not
hand-edit PAM files: the module is absent without the package and package
installation owns the generated `common-session` entry.

Audit every package in the base rootfs install list for recommendations omitted
by `--no-install-recommends`. Record an explicit keep or omit decision beside
each list entry, retaining the strict allowlist and adding only dependencies
that carry a demonstrated mos function.

## Acceptance

- An SSH login appears in `loginctl list-sessions` and is in a
  `session-*.scope`.
- Key-based SSH and the transient root-password SSH path both still work.
- `libpam-systemd` is explicitly installed and image verification asserts its
  presence.
- Every package in `10-base.Dockerfile`'s install list has an explicit
  recommendation decision recorded beside it.

## ActiveForm

Registering SSH sessions with logind and recording every omitted base-package
recommendation decision.

## Dependencies

- **deployment owner**: RFCT-917 / PLAN-911 M5 (issue `lsw8ihi2`) owns the
  single coordinated inactive-A deployment, reboot, and combined M2/M3/M5
  hardware acceptance. This task must not write a slot or reboot the board;
  it will review and record the M3 evidence reported from that boot.
- **independent runtime repair**: M5's systemd-enabled crun is the sole repair
  for the historical `crun: systemd not supported` podman error. It is required
  for M5's podman acceptance, but it is not a dependency of M3's logind-session
  function.
- **blocks**: PLAN-911 M4 hardware smoke check

## Notes

- The user dispatch is explicit approval to implement the already-approved M3
  and M3a scope in PLAN-911.
- M1 is concurrently changing the same install list for `systemd-timesyncd`.
  All non-Dockerfile investigation and audit work must precede the shared edit;
  do not absorb or revert another worker's uncommitted change.
- Heavy builds run on `192.168.27.200`; no mos content is pushed remotely.
- At 2026-08-31 05:58 UTC, that host's `/` filesystem had only 368 MB free
  (100% used), while `/backup` had 411 GB free. At 06:15 UTC the owner reclaimed
  Docker storage: `/` then had 299 GB free and `/backup` had 410 GB free, so the
  ENOSPC blocker is cleared. The reclaimed Docker cache makes a cold first build
  (including the roughly ten-minute emulated crun rebuild) expected rather than
  a regression. Check `df -h /` before diagnosing a future failure, use
  `/backup` for bulk scratch when useful, and never delete another worker's
  artifacts to make space.
- eMMC, its boot areas, and `bootloader_a` are out of scope.

## Investigation

At 2026-08-31 05:44:41 UTC, after physical recovery, the board clock was set
manually from the build host before any certificate- or expiry-sensitive work.
The read-only pre-deployment check found slot A booted (`root=/dev/dm-0`,
`rauc.slot=A`), with `/boot` on `/dev/mmcblk1p5`; slot B is inactive. The SD
device is `/dev/mmcblk1` and has no boot-area devices, while eMMC is
`/dev/mmcblk0` and exposes `mmcblk0boot0` and `mmcblk0boot1`. Only the inactive
SD slot is eligible for this task; no eMMC path, boot area, or `bootloader_a`
will be written.

At 2026-08-31 06:08 UTC, after a physical SD-card swap, the current card was
identified as Linux `/dev/mmcblk1`, `type=SD`, `name=SC16G`, 15,193 MiB, CID
`03534453433136478082885ad3018c00`, with no hardware boot-area nodes. The
earlier card was a distinct `SR64G`, 59.5 GiB device with CID
`03534453523634478664e2c850019500`; measurements that name that CID describe
the earlier card and are not silently rewritten as measurements of this one.
The safety predicate for any future write is the measured `type=SD` plus no
hardware boot areas, contrasted with `/dev/mmcblk0` as the `AT3SFA` eMMC with
`boot0` and `boot1`; neither historical CID authorizes a write. Linux numbering
remains `/dev/mmcblk1` for SD and `/dev/mmcblk0` for eMMC, while vendor U-Boot
continues to use `mmc 0` for SD and `mmc 1` for eMMC. The replacement card's
partition table places DATA at 13.5 GiB, so an image must be size-checked
against its 16 GB capacity before any future deployment.
The currently running slot-B M1 payload remains a valid software-state
measurement; the card swap changes only which physical medium a CID-specific
observation describes.

The combined M1/M2/M3 artifact is available on the build host as
`s905x5m-mos-v2-sd-1788154541.img`, SHA-256
`a2506c1be72381e05d930994effcdb73f6b244e68d16415615503b7c5a81d6c3`.
It contains a valid B boot payload and the 117,440,512-byte verity rootfs
payload, but the factory assembler writes that rootfs only to ROOTFS-A and
renders the shared p1 cfgload bridge for slot A. The live p1 `boot.ini` confirms
`setenv partition 5` and `rauc.slot=A`. Vendor U-Boot does not consume the RAUC
handoff variables, and the board has neither a `kexec` program nor a kernel
kexec interface. Therefore writing p6/p8 alone cannot boot B; switching to B
also requires changing shared SD p1, which has no automatic fallback if B fails.
No slot, p1 bridge, eMMC path, boot area, or bootloader was written or rebooted
in this investigation. An explicit recovery/rollback plan and approval are
required before that deployment step.

The subsequent separately coordinated time-source deployment booted slot B and
passed its time acceptance, but it did not carry M3. At 2026-08-31 05:50:49 UTC
a key-authenticated SSH login on B proved key access, `rauc.slot=B`, dm-verity
root, and `NTPSynchronized=yes`; it found no `pam_systemd.so` under `/usr/lib`
or `/lib`, no `pam_systemd.so` line in `common-session`, zero `loginctl`
sessions, and `0::/system.slice/ssh.service` for the SSH process. The local
Alpine image is cached and podman selects its `systemd` cgroup manager, but this
is a pre-M3 deployment observation, not a passing M3 session-scope or
container result. The board-side `crun --version` feature line also lacks
`+SYSTEMD`, independently confirming the runtime blocker.

At 2026-08-31 05:58 UTC, the coordinator remeasured the running B slot and
confirmed it is M1-only: `systemd-timesyncd` was active with
`NTPSynchronized=yes` and a correct clock, but the kernel still lacked
`CONFIG_NFT_FIB_INET`, `pam_systemd.so` was absent, and `loginctl` still had
zero sessions. A default-bridge `podman run` still failed during netavark
nftables setup. This contradicts the earlier claimed RFCT-916 board acceptance;
RFCT-915 must not use that claim as M2 evidence. Neither M2 nor M3 is deployed
on B, so no M3 key-authentication, transient-password, session-scope, or
interactive-container acceptance has been measured on the current board.

At 2026-08-31 06:42 UTC, the coordinator again reported B as the running slot
with synchronized time, absent `pam_systemd.so`, and zero
`CONFIG_NFT_FIB_INET` matches. That is reference state only. RFCT-917 now owns
the next deployment and reboot so M2, M3, and M5 can be accepted in one boot;
RFCT-915 will not initiate a separate slot write, card write, or reboot.

A newer clean Git-backed M1/M2/M3 artifact is available at
`/tmp/mos-plan035-combined-git.90l5To/work/_out/s905x5m/` on the approved
build host: `s905x5m-mos-v2-sd-1788155717.img`, SHA-256
`8d6d13d6770d8ab4bbc7ff3072ef24b1a6f88c3952a7634af6693a0f40f18df3`.
Its source boundary is `cb1656fd14a4ef9fb4e9a98fd0f323ac0f009ce4`, its
rootfs report includes `libpam-systemd`, and its packed-root verifier passes
both PAM checks. It remains undeployed: its crun has no `+SYSTEMD`, so writing
it would require a second shared-bridge slot flip before the separately built
runtime fix could be tested.

The pre-change s905x5m measurement was made through a key-authenticated SSH
login. `loginctl list-sessions` returned zero rows, the login's cgroup was
`0::/system.slice/ssh.service`, neither `/lib` nor `/usr/lib` contained a
`pam_systemd*.so` module, and `common-session` had no `pam_systemd` entry.
`podman run --rm --network=none docker.io/library/alpine:3.22 true` failed
with `crun: systemd not supported: Operation not supported`.

The earlier causal account was corrected by a 2026-08-31 08:29 UTC probe on
slot A:

```
systemd-run --quiet --wait --pipe --collect \
  podman run --rm --network=none docker.io/library/alpine:3.22 echo NO-SESSION-OK
```

It returned `NO-SESSION-OK`. A `systemd-run` scope is in `system.slice` and has
no user login session, so this proves rootful podman does not require an SSH
session scope. The historical `crun: systemd not supported: Operation not
supported` error had one cause: `os/pkgs/podman/Dockerfile` configured crun
with `./configure --disable-systemd`. At pinned crun 1.29.1 that withholds
`HAVE_SYSTEMD`, and its fallback systemd cgroup functions return `ENOTSUP` with
that exact text. M5's `a0ddb9f` repairs this compile-time capability removal.

`libpam-systemd` remains a necessary but separate repair: it creates logind
sessions for SSH users, restores their session/user-slice placement, and makes
them manageable through `loginctl`. It did not cause, and is not evidence for a
fix of, the podman runtime error.

The unqualified default-network probe instead stopped in netavark's nftables
setup. That is the independent M2 missing-kernel-symbol failure already
recorded in PLAN-911. A `--network=none` podman invocation isolates M5's crun
runtime acceptance from M2 networking; it is not an M3 session-scope test.

Before subsequent hardware work the board clock was set manually to
`2026-08-31T03:54:58Z`. No M3 acceptance probe pulls an image or otherwise
depends on certificate or expiry validation; the cached Alpine image is used.

On current trixie arm64 metadata, the direct base package list has the
following `Recommends` audit. “Omit” is an explicit decision, not an implicit
result of `--no-install-recommends`.

| Direct package | Recommends omitted or satisfied | Decision |
| --- | --- | --- |
| `systemd` | `default-dbus-system-bus \| dbus-system-bus`; `linux-sysctl-defaults`; `systemd-timesyncd \| time-daemon`; `systemd-cryptsetup` | `dbus` is already explicit and provides the system-bus virtual packages. Add `systemd-timesyncd` for M1. Omit `linux-sysctl-defaults`: its generic sysctls include unrelated desktop/server policy such as a Windows-emulation mapping limit, and no mos feature requires one; mos-owned sysctls must be explicit. Omit `systemd-cryptsetup`: mos has no `crypttab`; dm-verity is opened by the kernel or the x64 initramfs, not a runtime unlock service. |
| `systemd-sysv` | `libpam-systemd`; `libnss-systemd` | Add `libpam-systemd`: SSH needs logind session scopes. Omit `libnss-systemd`: mos uses static service identities and ships no `DynamicUser=yes` unit. |
| `libpam-systemd` | `dbus-user-session` | Add: its PAM module registers SSH logins with logind. Omit `dbus-user-session`: registration and a session scope use the system bus; mos does not support a per-user D-Bus or `systemd --user` session. |
| `systemd-resolved` | `libnss-myhostname`; `libnss-resolve`; `libidn2-0` | Omit all three. The image uses `hosts: files dns` and the resolved stub `resolv.conf`; hardware resolves `localhost` to `::1` without either NSS module. Mos has no IDNA/Unicode hostname contract; its known service endpoints are ASCII. |
| `systemd-repart` | none | Explicit package split from `systemd`; retain it for repartitioning and its asserted enablement symlink. |
| `systemd-timesyncd` | none | Add for M1; it has no omitted recommendation. |
| `udev` | none | No recommendation was dropped. |
| `dbus` | none | No recommendation was dropped; it also satisfies `systemd`'s system-bus virtual alternative. |
| `kmod` | none | No recommendation was dropped. |
| `openssh-server` | `default-logind \| logind \| libpam-systemd`; `ncurses-term`; `xauth` | Add `libpam-systemd`; it satisfies the logind alternative. Omit `ncurses-term`: no supported shell contract requires extra terminfo beyond the base set. Omit `xauth`: X11 forwarding is not a mos access path. |
| `iproute2` | none | No recommendation was dropped. |
| `libubootenv-tool` | none | No recommendation was dropped. |
| `curl` | `bash-completion` | Omit: completion is interactive convenience, not the health probe's runtime dependency. |
| `libglib2.0-0t64` | `libglib2.0-data`; `shared-mime-info`; `xdg-user-dirs` | Omit: rauc needs the library, not translated GLib messages, a desktop MIME database, or per-user desktop directories. |
| `libjson-glib-1.0-0` | none | No recommendation was dropped. |
| `libfdisk1` | none | No recommendation was dropped. |

An isolated trixie package install confirmed that `libpam-systemd` installs
`/usr/lib/<multiarch>/security/pam_systemd.so` and that its package integration
adds `session optional pam_systemd.so` to `/etc/pam.d/common-session`.

The exact arm64 package payload was checked as well: the module path is
`/usr/lib/aarch64-linux-gnu/security/pam_systemd.so`, so the verifier derives
the multiarch directory from each board rather than hard-coding arm64.

## Proposal

- Add only `libpam-systemd` to the explicit base allowlist, alongside the
  systemd packages, and retain `--no-install-recommends`. This establishes the
  logind prerequisite; it does not silently expand the task to rebuild crun.
- Make every direct base-package decision visible immediately beside its install
  line, including M1's `systemd-timesyncd` line and this task's new package.
- Keep `os/rootfs/README.md`'s package allowlist aligned and document that the
  package-managed PAM integration, rather than an edited PAM file, owns the
  SSH-to-logind path.
- Add image checks for the architecture-correct PAM module and the generated
  `common-session` entry, with failing-side fixture coverage.
- Read the resulting `rootfs-report-v2.txt` after the clean build and update
  the documented installed-size figure only from that measured artifact.
- Review M5's coordinated board result for key authentication,
  transient-password authentication, and an SSH session scope without writing
  eMMC. M5 separately owns podman's default systemd-cgroup acceptance.

## Verification

- The focused verifier typecheck and `src/checks-system.test.ts` completed in
  the repository-pinned Bun 1.4.0 container: 71 passing tests, 0 failures.
- With M1's in-progress fixture additions present, the combined
  `src/checks-root.test.ts` and `src/checks-system.test.ts` run also passed:
  115 tests, 0 failures. This exercises both the time-wait enablement fixture
  and the two PAM assertions without a shared-fixture collision.
- A direct list-to-comment audit confirmed that all 16 install-list package
  names have their own `# - <package>:` decision in `10-base.Dockerfile`;
  `git diff --check` is clean.
- The direct host route could not use its Bun 1.3.12 because that binary rejects
  the committed lockfile version. The standard mounted-container route also
  cannot start on this host because Docker does not share `/workspace`; the
  successful run instead streamed the minimal source closure into the same
  pinned container without a host bind mount.
- At 2026-08-31 04:20 UTC M1's `10-base.Dockerfile` edit was still uncommitted,
  but its precise diff had been stable for more than twenty minutes after two
  BKD hand-off requests. M3 then appended only the disjoint
  `libpam-systemd` line and audit block, preserving M1's timesyncd line,
  rationale and enablement command byte-for-byte. M1 subsequently committed
  its named paths as `501c389`; the M3 hunk remains cleanly separate and is
  not absorbed by that commit.
- The later build audit found `./configure --disable-systemd` in the crun
  build. At 08:29 UTC, the slot-A `systemd-run` probe corrected the prior
  two-halves causal claim: that compile-time flag was the sole cause of the
  crun error, while M3 independently repairs SSH logind registration. Final M3
  hardware acceptance remains pending M5's coordinated report.
