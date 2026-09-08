# RFCT-923 Add a board runtime smoke check for time and Podman

- **status**: completed
- **priority**: P1
- **owner**: implementation/plan-911-m4-20260831
- **createdAt**: 2026-08-31 07:24 UTC
- **plan**: PLAN-911 M4

## Description

Add a direct-host hardware smoke check for a booted s905x5m. It must prove the
runtime facts that the image verifier cannot: `NTPSynchronized=yes`, a
default-bridge container with an address and external HTTP connectivity, and
an interactive default-cgroup-manager container start over SSH. It must not
write a slot, reboot the board, write eMMC or its boot areas, or write
`bootloader_a`.

## Acceptance

- The check passes against the good slot-A board using root key-authenticated
  SSH.
- The Podman invocation omits both `--network` and
  `--cgroup-manager=cgroupfs`, requires Podman's default manager to be
  `systemd`, proves `NetworkMode=bridge`, observes an IPv4 address and default
  route, and completes an HTTP request from the container.
- The check also asserts a non-empty logind session list and that its own SSH
  session is a `session-*.scope`, so M3 has a direct diagnostic assertion.
- Offline fixtures execute the real streamed probe body and direct interactive
  exec, and make each assertion fail in its defect direction.

## ActiveForm

Completed the direct SSH hardware smoke check and its live slot-A acceptance.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

- The user dispatch is explicit approval to implement the already-approved M4
  scope in PLAN-911.
- Heavy builds belong on `192.168.27.200`; this task adds no build and never
  pushes mos content remotely.
- The board is shared. The probe may create and remove one named transient
  container only; it must not alter persistent board or storage state.

## Investigation

- `os/verify`'s existing smoke modes run artifact binaries in a container. Its
  fallback container cannot safely inherit the host SSH key or private-LAN
  route, so it is the wrong execution boundary for a booted-board probe.
- `timedatectl show --property=NTPSynchronized --value` is the selected clock
  query. It reads the same `org.freedesktop.timedate1` D-Bus property while
  returning one machine-readable scalar, avoiding locale-sensitive parsing of
  `timedatectl status` and a direct `busctl` type/value parser.
- Logind belongs in the check. The successful Podman run would normally catch
  M3 after M5 is fixed, but a direct session-scope assertion is cheap, isolates
  its cause, and still diagnoses M3 if a container image or network failure
  masks the later run.
- A read-only SSH preflight at 2026-08-31 07:23 UTC returned connection
  refused. No conclusion about the board image follows from that transport
  result, and no write, reboot, or deployment was attempted.

## Proposal

- Add a host-side Bash entry point under `os/tests/`, plus a Make target. It
  will stream the clock, logind and bridge assertions through non-PTY root SSH,
  then use a separate forced-TTY root SSH exec for the interactive Podman
  start. Both retain the caller's normal key and host-key policy.
- Assert the cached image and default cgroup manager, then start one named
  default-bridge transient for inspection. Assert `NetworkMode=bridge`, an
  address and a default route, make an HTTP request to `1.1.1.1`, and remove
  the named container through an exit trap.

## Implementation

- Added `os/tests/hardware-smoke.sh` and the explicit
  `make os-hardware-smoke HOST=<address>` entry point. Its streamed half uses
  `ssh -T` and proves ordinary SSH still produces a logind session scope; the
  interactive Podman invocation is a separate `ssh -tt` direct exec, so it
  owns the remote TTY without consuming streamed probe source.
- The clock test uses `timedatectl show --property=NTPSynchronized --value`.
  The session test reads both `loginctl list-sessions` and the active shell's
  cgroup. The container tests require the default cgroup manager to be
  `systemd` and use no network or cgroup-manager override.
- Added `os/tests/hardware-smoke-test.sh`, wired it into the offline CI suite,
  and made its fake SSH execute the production remote body rather than a
  reimplementation. The fixture additionally records the SSH and Podman
  arguments so a lost TTY or an added override turns the green control red.

## Verification

- `make os-hardware-smoke-test` passed 37/37 assertions at 2026-08-31 07:31
  UTC. It drives `NTPSynchronized=no`, zero sessions, an `ssh.service`
  cgroup, a cgroupfs default, netavark failure, host and none network modes,
  no address, no connectivity, and crun without systemd support.
- `bash -n` passed for both scripts. The pipefail-pattern scan found no
  early-exiting `grep -q` pipeline in either new script. `make
  os-hardware-smoke` without `HOST` exited 2 before opening SSH.
- A focused local review after the fixture run found no high-confidence
  correctness or security issue in the new host/board boundary. In particular,
  host input is restricted to a bare address/name, the caller's host-key policy
  is preserved, and cleanup is restricted to the run's timestamp-and-PID name.
- Before the board returned, read-only SSH attempts at 07:23, 07:27,
  07:29, two bounded attempts at 07:30, and a final preflight at 07:33 UTC
  returned connection refused or timed out; no board state, container, slot,
  eMMC, boot area, or bootloader was changed by those attempts.
- After the board became reachable at 08:29 UTC, the first live probe passed
  its clock, logind, and default-cgroup-manager assertions but hung before the
  bridge assertion. Its remote `sh -s` reads the probe source from SSH stdin,
  and the interactive Podman start could consume that remaining source. No
  named container had been created; the owned SSH process was interrupted and
  `podman ps` confirmed no `mos-hardware-smoke-*` container remained. A
  `/dev/null` workaround then ran every assertion but exposed the second PTY
  issue: `sh -s` did not exit after its streamed source ended. Its exact named
  transient was force-removed and absence confirmed. The production probe now
  uses `ssh -T` for its streamed shell, which independently measured as a
  `session-*.scope`, then ends that shell explicitly and runs
  `--interactive --tty` as a separate direct SSH exec with its own allocated
  TTY; the fixture exercises both SSH forms and verifies that interactive
  Podman cannot consume probe source.
- The final offline suite passed 40/40 assertions. In addition to the original
  failing directions, it proves the streamed probe uses `-T`, the interactive
  run uses its own `-tt` direct exec, and that the interactive fake receives no
  probe source on stdin.
- At 2026-08-31 08:43 UTC, `make os-hardware-smoke HOST=192.168.27.55` passed
  on `rootfs.0 (A)`: `NTPSynchronized=yes`; two logind sessions with the probe
  in `session-29.scope`; `CgroupManager=systemd`; a default bridge address of
  `10.88.0.10`, default route and HTTP request to `1.1.1.1`; and a default
  `--interactive --tty` Podman start without either forbidden override. A
  read-only post-run `podman ps` found no `mos-hardware-smoke-*` container. No
  slot, boot state, eMMC, boot area or `bootloader_a` write occurred.
