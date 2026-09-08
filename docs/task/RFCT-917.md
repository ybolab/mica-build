# RFCT-917 Rebuild crun with systemd support

- **status**: complete
- **priority**: P1
- **owner**: implementation/plan-911-m5-20260831
- **createdAt**: 2026-08-31 05:46 UTC
- **plan**: PLAN-911 M5

## Description

Rebuild the self-built crun runtime with its default systemd support enabled.
This completes the runtime half of PLAN-911 gap 3: M3 supplies an SSH logind
session scope, while crun must retain the code path that asks systemd to create
the container's transient scope. The resulting image is held as a complete
M1/M2/M3/M5 source-and-artifact hand-off: the M1/M2/M3 base is `cb1656f` and
the checksum-matched M5 inputs are from `a0ddb9f`.

## Acceptance

- [x] `c-build` retains its existing `libsystemd-dev` dependency and crun links
  `libsystemd.so.0` after the rebuild.
- [x] The rebuilt artifact's generated `NEEDED.txt` is re-derived, and every
  soname resolves in the assembled rootfs under its real loader.
- [x] Build output shows only the C build path recompiles; Rust and Go artifacts
  remain cached.
- [x] On the s905x5m over key-authenticated SSH, default-argument `podman run`
  starts a container without `--cgroup-manager=cgroupfs`.
- [x] The existing `mos-podman-test.service` Quadlet probe still succeeds.

## ActiveForm

Completed the crun rebuild, inactive-A deployment, and combined hardware acceptance.

## Dependencies

- **blocked by**: none
- **blocks**: PLAN-911 M4 hardware smoke check

## Notes

- The owner decided on 2026-08-31 to rebuild crun; this task does not revisit
  that decision or substitute `--cgroup-manager=cgroupfs` as acceptance.
- Heavy builds run on `192.168.27.200`; mos content is never pushed remotely.
- Before a reboot or slot write, record the target-device preflight here. Only
  the inactive SD slot may be written; eMMC, its boot areas, and
  `bootloader_a` are out of scope.
- At 2026-08-31 06:43 UTC, the coordinator explicitly assigned this task the
  one inactive-A deployment, reboot, and combined M2/M3/M5 acceptance. That
  authorization was consumed exactly once; no further board write or reboot is
  implied by this completed task.

## Investigation

- `os/pkgs/podman/Dockerfile` currently invokes
  `./configure --disable-systemd` for crun. At the same stage,
  `libsystemd-dev` is already installed beside the C components' other
  headers, so this is a capability change rather than a new build dependency.
- The artifact's `NEEDED.txt` is emitted from the rebuilt ELF files, and
  `os/rootfs/scripts/podman-assert.sh` runs `ldd` against those files in the
  assembled root. It already separately asserts `libsystemd.so.0` for
  podman's journald dlopen path; the rebuilt crun must be measured rather than
  relying on that prior reason for the library's presence. The final artifact
  adds that soname directly to crun's own NEEDED entries, so the rootfs
  assertion must test the positive link as well as generic loader resolution.
- C, Rust, and Go have separate builder stages. Changing crun's configure
  command affects `c-build` and the final collection stage, while the source,
  Rust, and Go stage inputs are unchanged. The build log will verify that
  scope rather than infer it from the Dockerfile layout.

## Proposal

- Leave `libsystemd-dev` in the existing C-stage package list and invoke
  crun's default `./configure` detection instead of passing
  `--disable-systemd`.
- Add a C-stage assertion that the rebuilt crun links `libsystemd`, matching
  the existing conmon journald assertion and preventing a future header or
  configure change from silently restoring the disabled runtime.
- Rebuild the artifact on the dedicated build host, inspect its newly emitted
  `NEEDED.txt`, then assemble a rootfs and use the existing loader assertion to
  decide whether the feature-stage package list needs a change.

## Implementation

- Prepared an isolated, non-Git source snapshot on `192.168.27.200` from
  local source commit `cb1656fd14a4ef9fb4e9a98fd0f323ac0f009ce4`, which has
  M1 `501c389`, M2 `84b9c1c`, and M3 `cb65301` as verified ancestors. The
  snapshot overlays the M5 inputs from local commit `a0ddb9f`; it is therefore
  the M1/M2/M3/M5 source boundary for this hand-off. The final local and
  build-snapshot Dockerfiles have matching SHA-256
  `d64eaf0f26bc9ba7e6c4879a1028523aec17629a9fd31b6742b4e78dc56f9517`.
- Independent key-auth SSH at 2026-08-31 05:50:49 UTC established that the
  running board is `rauc.slot=B` on `/dev/dm-0`. On this vendor-SD path, p1
  `boot.ini` selects p6 for B's kernel and DTB while the generated
  `boot.automount` / `boot.mount` mounts `mmcblk1p5` (`BOOT-A`) at `/boot` with
  `TimeoutIdleSec=120`. `/boot=BOOT-A` must therefore never be used to infer
  the booted slot. B makes A (`p5`/`p7` plus the A p1 cfgload bridge) the only
  future inactive target. No reboot, mount change, slot write, eMMC write,
  boot-area write, or `bootloader_a` write has occurred in this task.
- The physical SD was deliberately replaced after earlier campaign evidence.
  The current card is `mmcblk1`, type SD, `SC16G`, 15,193 MiB, CID
  `03534453433136478082885ad3018c00`, and has no hardware boot areas. The
  current eMMC is `mmcblk0`, type MMC, `AT3SFA`, 14,912 MiB, CID
  `ec290041543353464130229911cf2c00`, and exposes `mmcblk0boot0` and
  `mmcblk0boot1`. The older SR64G CID evidence remains historical evidence for
  that card; it is not rewritten to describe the SC16G. The task will not
  touch the eMMC or its boot areas.
- The board's compact production root does not contain `dpkg`, so a package
  database query is not a valid live presence check. Direct checks show M1's
  `systemd-timesyncd.service` active and `NTPSynchronized=yes`. The B rootfs
  remains M1-only with respect to M3/M5: there is no `pam_systemd.so` below
  `/usr/lib` or `/lib`, no `pam_systemd.so` entry in `common-session`, zero
  `loginctl` sessions, and the key-auth SSH process is in
  `0::/system.slice/ssh.service`. The installed crun 1.29.1 feature line lacks
  `+SYSTEMD`. RFCT-916 separately records the scoped M2 kernel/bridge result;
  this task does not infer kernel payload from `/boot` or rootfs contents. The
  existing `mos-podman-test.service` Quadlet probe is generated and active
  (started at 05:48 UTC), providing the required pre-change baseline.
- The board clock read `2026-08-31T06:06:05+00:00` under the active,
  synchronized M1 time service. This task did not set it by hand because it
  made no certificate- or expiry-sensitive measurement; a later task must
  record any manual clock setting before making one.
- The dedicated arm64 artifact build completed successfully. Crun's configure
  probe found `systemd/sd-bus.h` and `-lsystemd`; it compiled
  `cgroup-systemd`, linked successfully, and passed the new direct-ELF
  positive link assertion. The rebuilt crun SHA-256 is
  `c4f32120cc0499b65459c2b1f586db4a1d668b5271cbe2b1addb280fcf4bc145`.
- Re-derived `NEEDED.txt` adds exactly `crun: libsystemd.so.0`; its remaining
  crun sonames are unchanged. The final build ran the C stage (crun 170.5s)
  and exported the artifact, while every Rust and Go step was `CACHED`; no
  Rust or Go component recompiled. No dependency list was merged or expanded.
- The feature-stage rootfs assertion now requires crun's positive
  `libsystemd.so.0` link in addition to checking that all referenced sonames
  resolve. `libsystemd0` is intentionally not added to that stage's apt list:
  it is already supplied by the explicit base `systemd` package. The completed
  rootfs loader assertion and the board's real loader both measure that fact.
- At the first rootfs attempt the build host had only about 314 MiB free, so
  the task did not start a build and removed only its own failed, regenerable
  inputs: a 266 MiB partial cache, a 102 MiB migrated snapshot, and a 205 MiB
  failed cache copy. Later capacity was restored by external shared-host work;
  no task command deleted Docker images, containers, or caches. Verified
  kernel, board-userland and mosd incremental inputs were copied read-only
  from the clean `cb1656` M1/M2/M3 artifact into this task's `/backup`
  snapshot, with the kernel/module SHA-256 values checked on both sides.
- The shared-host capacity blocker is now cleared. The owner measured 299 GiB
  free on `/` and 410 GiB on `/backup` at 06:15 UTC; a later read-only hand-off
  check measured 298 GiB and 408 GiB respectively. Docker cache was reclaimed,
  so a cold rebuild is expected to take the documented crun-build time rather
  than indicate a source failure. No other worker's artifact was removed.
- The initial rootfs invocation stopped before the Docker chain because the
  host had no `bun` on PATH. It was retried with the existing, matching Bun
  1.4.0 binary at
  `/tmp/mos-plan035-combined-git.90l5To/work/.build-tools/bun` (SHA-256
  `33d56b070be6a9e3da0ab013038b43d1645d0534ca811ecdba4472599117eb4b`).
  This is a host-tool routing correction, not a source or package change.
- A provenance audit after the first build found that the snapshot's
  `31-feature-containers.Dockerfile` was an intermediate version: its executed
  assertion script already matched M5, but its top-level assertion-count
  comment did not. The Dockerfile, assertion script, stage Dockerfile, and
  stage README were then all checksum-matched to `a0ddb9f` and the rootfs and
  image were rebuilt. The final s905x5m rootfs stage-31 log says
  `podman: no units, every soname resolves, crun systemd support present`; the
  packed root has `libsystemd0`, `libpam-systemd`, and `systemd-timesyncd` in
  its package report, is 370 MiB against a 400 MiB budget, and produced a
  117,440,512-byte verity root with hash
  `42a0429e2e795b6b1d4d8d59fed23230ddd4a0e20537553818fcad61856b2a5a`.
  Its compulsory ARM64 factory-root smoke passed all 12/12 self-built
  artifacts. A read-only execution of its shipped crun reports
  `+SYSTEMD +SELINUX +APPARMOR +CAP +SECCOMP +EBPF +JSON_C`; read-only is
  necessary under qemu-user because crun otherwise attempts a memfd re-exec
  that the emulator cannot follow.
- The final SD-only image assembler produced
  `/backup/mos-plan035-m5.upjEbe/_out/s905x5m/s905x5m-mos-v2-sd-1788157504.img`,
  1,494,220,800 bytes, SHA-256
  `a21e95238791e06b62d4dc74bb8ce813c13249a8cf52ae67651c8d2b8d416c08`.
  A post-build read-only checksum recheck on `192.168.27.200` returned the
  same SHA-256. This is the exact artifact hash for the inactive-A hand-off;
  it has not been copied to the board or written to any block device.
- The image verifier's host-Bun/container-tool route first reached 144/157
  checks, then reported `EACCES` while cleaning a root-owned temporary
  unpacked tree. Re-running through the verifier's supported container-Bun
  route against the default `latest` symlink reached 363/374 checks with nine
  named s905x5m/U-Boot skips. The checksum-matched final image was verified by
  that same route with the same result. Its only eleven failures are the
  already-recorded PLAN-910 vendor `boot.scr` / RAUC-slot checks; no additional
  M5 check failed. In particular, the verifier passed the container engine,
  `libsystemd.so.0`, `pam_systemd.so`, and `common-session` checks. The sole
  370 MiB root-owned task verifier temporary was then removed at its exact
  path; no image or shared cache was removed.
- Runtime dependency measurement used the actual, assembled root of the
  running s905x5m B image. The final rebuilt crun was copied temporarily to
  `/tmp`, checksum-verified, and evaluated by that root's `ldd`; it resolved
  `libsystemd.so.0` to `/lib/aarch64-linux-gnu/libsystemd.so.0` (whose resolved
  target is `/usr/lib/aarch64-linux-gnu/libsystemd.so.0.40.0`), plus every
  other NEEDED soname. The temporary candidate was removed under a shell trap
  and its absence was verified afterward. Therefore no runtime package is
  missing and no apt-list addition is justified.
- That final checksum-verified temporary execution reports
  `+SYSTEMD +SELINUX +APPARMOR +CAP +SECCOMP +EBPF +JSON_C` from crun 1.29.1.
  The installed crun reports the same feature list without `+SYSTEMD`. This
  proves the compiled capability itself before the M3-dependent
  interactive-SSH acceptance is attempted.
- The untouched pre-change Quadlet probe remains `active` / `running` and is
  loaded from `/run/systemd/generator/mos-podman-test.service`. This is a
  baseline only; its required post-deployment verification remains pending
  with the default interactive-SSH check.
- The source and rootfs-assertion change is committed locally as
  `a0ddb9f5c1b1f61b793085953dab920a24cc9f62`
  (`fix(podman): enable crun systemd support`); no remote push occurred. PMA
  code review found no high-confidence correctness or security finding.
- Deployment hand-off only: before a future A write, RFCT-915 must first
  confirm the raw current p1 matches
  `/srv/RFCT-274-M1-20260831/cfgload-p1-b.img`, retain or refresh that B
  fallback, explicitly stop the generated `boot.automount` and `boot.mount`,
  and verify p5 is unmounted. Only then may its coordinated procedure write
  p5, p7, and the verified A cfgload bridge, followed by readback and
  re-enabling the mount units. The supplied 64 MiB A-before bridge backup is
  `/srv/RFCT-274-M1-20260831/cfgload-p1-A-before.img`. These are future
  recovery conditions, not actions performed by this task.
- At 2026-08-31 06:43 UTC, the coordinator assigned RFCT-917 as the sole
  deployment owner and authorized one combined inactive-A deployment. Execution
  now begins: before any write, this task will re-identify `mmcblk1` as SD with
  no hardware boot areas, verify the final image hash and its A-partition
  sources, confirm p1 still matches the preserved B bridge, stop and verify the
  p5 automount is unmounted, then write only A p5, p7, and the A p1 cfgload
  bridge with readback verification. It will reboot only after those checks,
  preserve B untouched, not mark A good, and run the M2, M3, and M5 acceptance
  probes in that one A boot. A failed boot or probe will be recorded by its
  owning milestone without changing another milestone's code.
- At 2026-08-31 06:49 UTC, the pre-write predicate passed on the running B
  system: `mmcblk1` was type SD with no boot-area nodes, while `mmcblk0` was
  type MMC with both boot areas; p1 still exactly matched the preserved B
  bridge backup. `boot.automount` and `boot.mount` were explicitly stopped and
  `/boot` was absent from mountinfo. From the checksum-verified final image,
  the staged A p5, p7, and p1 images had SHA-256 respectively
  `4c9b402427e419ed07e4714dfe5d24b542fd906619e7942e562e3b22de722adc`,
  `4b9618aa200624c9b1a5e97dc40e69005cddcceb805245a24537ae9638e595bf`, and
  `45e9686760bd8698360ef95ce491ee16088e3ff7a006fcffb813010b764c92f0`.
  They were written in that order, with p1 last, and an independent full
  readback matched all three hashes. B p6/p8 were not written, the B p1 backup
  remains intact, and no mark-good operation was issued. The next action is to
  re-enable the automount and reboot once into A for the combined acceptances.

## Verification

- At 2026-08-31 06:51 UTC the board returned over key-authenticated SSH on
  `rauc.slot=A`, `/dev/dm-0`, with the A PARTUUID and the assembled verity root
  hash `42a0429e2e795b6b1d4d8d59fed23230ddd4a0e20537553818fcad61856b2a5a`
  in its kernel command line. M1 time synchronization remained healthy
  (`NTPSynchronized=yes`).
- **M2 — pass.** The running kernel is `6.12.38-m100-arm64` (`#1 SMP PREEMPT
  Mon Aug 31 04:17:04 UTC 2026`), and the full `/proc/config.gz` stream reports
  `CONFIG_NFT_FIB_INET=y`. An initial short-circuit `grep -q` result was a
  false negative caused by `pipefail` observing zcat's SIGPIPE; the recorded
  full-stream check is the result used here. A key-authenticated, TTY-backed
  `podman run --rm -it docker.io/library/alpine:3.22 ...` with no `--network`,
  cgroup-manager, or capability override used the default bridge, obtained
  `10.88.0.4/16`, installed default route `10.88.0.1`, and received
  `HTTP/1.1 301 Moved Permanently` from `1.1.1.1:80`. The first ICMP attempt
  failed only because the default container lacks `NET_RAW`; TCP/HTTP proved
  real default-bridge connectivity without changing capabilities.
- **M3 — pass.** Key-authenticated SSH produced `session-14.scope` and the
  later final key check produced `session-27.scope`; `loginctl list-sessions`
  listed the live SSH user sessions. A newly generated test password was passed
  to mosd only on standard input through `SetTransientRootPassword`; its
  plaintext was not logged. Pure password SSH, with public-key authentication
  disabled, succeeded as `session-22.scope`, and a subsequent key-auth login
  succeeded as `session-23.scope`. The temporary password remains active until
  the next reboot by its documented contract.
- **M5 — pass.** The same interactive default `podman run --rm -it` command
  exited zero without `--cgroup-manager=cgroupfs`; `/usr/bin/crun --version`
  reports `+SYSTEMD` and `podman info` reports `systemd` as the cgroup manager.
  The existing `mos-podman-test.service` Quadlet is `active` with MainPID 658,
  so the systemd-owned-unit path did not regress.
- The system is `degraded` only because `mos-health.service` automatically
  attempted `rauc status mark-good` at boot and the vendor path rejected it.
  This is the known PLAN-910 RAUC/cfgload limitation, not an M2, M3, or M5
  failure. No manual mark-good operation was issued; B remains preserved as
  the rollback slot.
