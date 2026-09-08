# RFCT-938 Build a booted-board runtime acceptance suite

- **status**: completed
- **priority**: P1
- **owner**: runtime-acceptance
- **createdAt**: 2026-09-01 04:54 UTC
- **completedAt**: 2026-09-01 07:26 UTC
- **plan**: [PLAN-920](../plan/PLAN-920.md)

## Description

Build a Bun/TypeScript acceptance suite for a booted board. It must reuse the
`os/verify` result vocabulary and runner conventions while checking runtime
facts that an assembled-image verifier cannot observe. It is read-only by
default; any reboot or other state-changing probe must require an explicit
flag, state its action first, and never write an eMMC boot area or
`bootloader_a`.

The campaign evidence is the renumbered RFCT-913 through RFCT-934 records and
PLAN-910 / PLAN-911. The suite must cover boot identity, time, A/B state,
containers, MQTT, and the shipped wireless control path. Every check needs a
demonstrated failing direction through a fixture or construction, with any
hardware-only limitation recorded explicitly.

## Acceptance

- Decide and document whether the runtime suite is an `os/verify` mode or a
  sibling entry point, preserving caller-controlled SSH credentials and host
  key policy.
- Produce one `PASS:` / `FAIL:` / `SKIP:` conclusion per runtime check and a
  non-vacuous `RESULT:` line.
- Keep credentials out of source, fixtures, output, and records; document the
  Wi-Fi environment/file contract without logging its contents.
- Add executable negative coverage for every check that can be made false
  without a board, and name any remaining live-hardware-only direction.
- Gate writes, reboots, and persistence testing behind explicit flags; never
  target eMMC boot areas or `bootloader_a`.

## ActiveForm

Completed the `os/verify --runtime HOST` acceptance mode and its constructed
failure-direction evidence.

## Dependencies

- **blocked by**: (none)
- **blocks**: repeatable board-runtime acceptance evidence

## Notes

- The branch reservation maps the campaign's original RFCT-273 through
  RFCT-294 records to RFCT-913 through RFCT-934. PLAN-034 / PLAN-035 map to
  PLAN-910 / PLAN-911.
- The present board address is only a transport endpoint. The suite must prove
  hostname and persistent STATE identity after connecting rather than treating
  an IP address as the board identity.
- Read-only investigation observed the expected hostname on the STATE-backed
  hostname bind, active A root over `mmcblk0p7`, successful U-Boot environment
  reads, RAUC JSON for both slots, and a completed `mos-health` oneshot.
- The local latest image does not match the board's active kernel bytes, so the
  proposal requires an explicit deployed-image path rather than a default.
- `emmc-probe` is active and will be reused only for the explicitly gated
  reboot persistence check; it will not be removed or rewritten.
- `wpa_cli` is shipped and `iw` is absent with exit 127. No secret-bearing
  settings, Wi-Fi configuration, or credential material was read or recorded.
- No board mutation has been performed during investigation.
- Completed on 2026-09-01. The implementation uses the requested `--runtime`
  mode inside `os/verify`, never a container fallback. The old
  `hardware-smoke` names now delegate to it.
- The full root-capable verifier suite passed 1137/1137 tests; the dedicated
  runtime failing-side suite passed 21/21. The local board read-only run passed
  all available runtime facts except the deliberately strict named-image match:
  the only local `latest` image is not the deployed image, so it produced the
  expected explicit failure rather than a substituted result.
- Active container, MQTT, Wi-Fi, reboot, and persistence probes were not
  invoked. `emmc-probe` remains installed and is reused only when the caller
  explicitly combines `--reboot --quadlet-persistence emmc-probe`; it was not
  removed or rewritten. No slot, eMMC boot area, or `bootloader_a` write was
  performed.
- A read-only preflight verified the active `emmc-probe` unit and its named
  volume heartbeat are available for that future gated check. It did not start
  a persistence action or change the probe.
- Implementation approval was recorded on 2026-09-01.
