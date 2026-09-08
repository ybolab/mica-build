# RFCT-943 Adapt the device initialization helper to current mainline

- **status**: completed
- **priority**: P1
- **owner**: device-initialization-adaptation
- **createdAt**: 2026-09-08 08:00 UTC
- **completedAt**: 2026-09-08 08:18 UTC
- **plan**: [PLAN-923](../plan/PLAN-923.md)

## Description

Locate the previously used device initialization helper and compare its setup,
authentication, SSH and configuration operations with the current mainline API.
Prepare an adaptation that can establish operator access for the newly installed
S905X5M device and enable the pending read-only eMMC runtime inspection.

## Acceptance

- Identify the old helper and its actual behavior before changing it.
- Record the current first-run setup, session, task and access contracts.
- Preserve existing device identity, unrelated settings and authorized keys.
- Keep credentials out of repository files, command logs and diagnostic output.
- Propose the implementation and focused verification before changing code.

## ActiveForm

Completed the JSON API helper and the requested SD runtime inspection.

## Dependencies

- **blocked by**: (none for investigation)
- **blocks**: authenticated read-only eMMC runtime inspection

## Notes

- The delivery branch is `board/s905x5m-mainline` at `f3102e46`.
- The reported device endpoint is `192.168.27.71`; HTTPS `/healthz` answers
  200, `/api/v1/session` reports `setup`, and TCP port 22 refuses connections.
- Serial console on `n100:/dev/ttyUSB0` at 921600 8N1 shows the Linux login
  prompt for `mos-89dea6b4`. No root login or boot-source read has succeeded.
- This investigation has not changed the board's settings or credentials.
- Tracking uses the repository task and plan files.
- Located `/workspace/miehq/.local/mos-setup.sh`. It is a local helper outside
  the MOS checkout; no implementation changes have been made to it.
- The old redirect/form flow is incompatible with the running image:
  `/` redirects to `/_ui/`, `/setup` returns 404, and state is now returned by
  `/api/v1/session`. Bash syntax validation of the original helper passed.
- Traced setup/session authentication, CSRF, additive SSH key operations,
  scalar setting writes and asynchronous task completion. PLAN-923 records
  the proposed implementation and target validation.
- Implementation approved on 2026-09-08 08:04 UTC. The device now reports
  `unauthenticated`; existing administrator credentials are required for live
  validation. No reset or repeated claim is authorized or needed.
- The user subsequently changed the live target to the SD-booted device at
  `192.168.27.72`. Serial shows `mos-490fab24`, and this endpoint reports
  `setup`. Initialize this fresh SD installation and inspect its functions;
  leave the previous eMMC endpoint unchanged.
- Mainline adaptation commit `f3102e46` was pushed successfully to
  `origin/board/s905x5m-mainline` on the user's explicit request. The helper
  and its incomplete follow-up records were not included in that push.

## Delivery

- Updated `/workspace/miehq/.local/mos-setup.sh` in place; the original is
  retained as `mos-setup.sh.before-json-api`. These local files are outside
  the MOS Git checkout.
- Added `/workspace/miehq/.local/mos-setup-test.py`: 15 isolated HTTPS/SSH
  cases passed in 15 seconds. Coverage includes fresh setup, existing login,
  CSRF, additive/duplicate keys, task failure and deadline, readback failure,
  wrong device, root-policy refusal, SSH failure and host-key mismatch.
- The tests assert private credential permissions, secret-free stdout/stderr
  and subprocess arguments, session revocation, and scratch-file cleanup.
- The live fresh setup and a second authenticated run both passed. SSH and
  MQTT are enabled, the supplied key is present once, and the device remains
  `mos-490fab24`. Generated credentials are held in a mode-0600 local file
  under `.local/mos-setup-state/`; no secret is copied into this record.
- No firmware rebuild or board source changes were needed for initialization.

## SD runtime evidence

Evidence files are under the delivery worktree's `tmp/`. The inspected device
is `192.168.27.72`, hostname `mos-490fab24`, kernel `6.12.38-m100-arm64`.

| Area | Observed result | Evidence |
| --- | --- | --- |
| Initialization and repeat run | Both passed; existing identity/key/settings preserved on retry | `setup-device-sd.log`, `setup-device-sd-repeat.log` |
| Boot source | `/dev/dm-0` is read-only squashfs over SD `mmcblk1p7`, slot A; eMMC is `mmcblk0` | `sd-runtime-basic.log`, `sd-runtime-failures.log` |
| Image identity | Both 64-MiB SD boot partitions match the named built SD image; running verity root hash matches RFCT-942 | `sd-integrity.log`, serial command line |
| Persistence/storage | STATE, META, EPHEMERAL and DATA are mounted from SD; DATA grew to 58.2 GiB | `sd-runtime-basic.log`, `sd-api-inspect.json` |
| Ethernet and time | 1000/full link, DHCP, DNS and TCP egress work; NTP synchronized | `sd-runtime-extra.log`, `sd-api-inspect.json` |
| Management API | Six health/info/telemetry/network/storage/time reads returned HTTP 200; apid and mosd report ok | `sd-api-inspect.log`, `sd-api-inspect.json` |
| MQTT | Local broker and bridge active; 9 Item1 topics, 2 heartbeats and exactly 1 completion observed | `sd-mqtt-probe.log` |
| Containers | Alpine 3.22.5 pulled; default bridge allocated 10.88.0.2, HTTP egress and interactive crun/systemd execution passed | `sd-container-probe.log` |
| Wi-Fi | Temporary unmanaged scan returned 39 BSS entries; station remains disabled afterward | `sd-radio-audio-check.log` |
| Bluetooth | Controller powered and vHCI bridge active; discovery found 18 new devices and stopped afterward | `sd-radio-audio-check.log` |
| HDMI/audio | Connected/enabled connector; one second of 48-kHz stereo PCM silence through HDMI succeeded | `sd-runtime-peripherals.log`, `sd-radio-audio-check.log` |
| USB | Keyboard receiver, mouse receiver and USB hub enumerated | `sd-runtime-extra.log` |
| Thermal | SoC readings approximately 46–47.3 C during the short run | `sd-api-inspect.json`, `sd-final-readback.log` |
| Front panel | **Failed:** both entry scripts have mode 0644, so systemd exits 203/EXEC | `sd-runtime-failures.log` |
| Boot confirmation | **Failed:** mos-health refuses the failed front-panel unit; system state is degraded | `sd-runtime-failures.log`, `sd-final-readback.log` |

Boot partition hashes, read directly from the card and compared with offsets
134217728 and 201326592 in `s905x5m-mos-sd-1788850800.img`:

- BOOT-A: `fe80c8aaf6743b5d87e3217546eb8496304d271307d2dc6e22badaba2d4627b1`
- BOOT-B: `3950b6290e1e875af5744aecf9865360fe61519cfc540968845327a4b5d44957`
- Verity root: `402e60bc5d8d73d5278bc1b88867c7a64cceca9f43e07a27f00690041a33757c`

The container setting was temporarily enabled for functional checks and
restored to its original `false`. No containers remain. The temporary Wi-Fi
process was removed, wlan0 is down again, and Bluetooth discovery is off.
SSH/MQTT enablement is the intended persistent initialization result.
The newly pulled test image was removed after testing; no test containers
remain in the device's container store.

Local helper SHA-256:
`2704ddd39958573b4fbb2f257d74b7842b80911b0ac93c531b613cf3b7a566b4`.
Local test helper SHA-256:
`76d8681e32780bdf3538f48bb7d645cefc309d419674b3fc64f03bc4c787891f`.

Final documentation checks passed: 491 link checks, 760 status checks and
145 board-dossier checks; authored whitespace also passed. Local review
covered secret handling, authentication retries, duplicate-key semantics,
task completion and failure propagation. The initial dossier update used
unsupported partial-result labels; these were replaced with exact allowed
results and separate rows for the narrower checks actually performed.

Wi-Fi association, Bluetooth pairing/profiles, visible HDMI output, audible
sound, USB input events, reboot persistence, RAUC installation/rollback and
long-duration thermal/storage behavior were not proven by these checks.
No reboot, flash, boot-area write or slot-marking action was requested.

The front-panel blocker and additional EFI/model/verifier observations are
tracked in [RFCT-944](RFCT-944.md). This task completes the requested helper
and inspection, not hardware qualification of the whole image.
