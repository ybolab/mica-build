# PLAN-919 Investigate s905x5m Wi-Fi acceptance-evidence gap

- **status**: completed — investigation-only; no Phase 3 change
- **createdAt**: 2026-09-01 03:35 UTC
- **approvedAt**: not applicable — no product change
- **completedAt**: 2026-09-01 04:26 UTC
- **relatedTask**: [RFCT-937](../task/RFCT-937.md)

## Context

RFCT-913 records a 38-AP scan on the same board during the SD phase. The
apparent eMMC regression is corrected: the deployed image does not ship `iw`,
and every reported `iw` command exited 127 with `command not found`. Stderr had
been redirected away, so empty output was misread as a silent nl80211 response.
No listing or scan ran on either `wlan0` or `p2p0`; the purported `p2p0`
countertest is withdrawn. No Wi-Fi regression or nl80211 anomaly is established.

The exact control is
`_out/s905x5m/s905x5m-mos-v2-sd-1788124881.img` (SHA-256
`82f922650b3c7141fa9a10441c7a82030d7e667f3541bb62aad9bb5713c12205`). The
control, later SD image, and deployed eMMC root all lack a shipped `iw` binary.
The final kernel-config difference is only `NFT_FIB_INET=y` and
`NFT_FIB_IPV6=y`; Wi-Fi-path settings, relevant module and firmware bytes, DTB,
and loading inputs are identical. Literal boot-script differences are only
verity values and ordering. These observations do not prove radio operation,
but none supports the alleged rebuild, bootargs, or image-staging regression.

The delivered image does contain `/usr/sbin/wpa_supplicant` and
`/usr/sbin/wpa_cli` (v2.10). The generic service is masked, while the
per-interface `wpa_supplicant@.service` template is delivered for mosd to
manage. First boot intentionally leaves Wi-Fi at schema defaults when no network
is configured; no supplicant process or control socket is therefore expected.
This follows the documented provisioning and rootfs design. The known control
interface is `p2p0`, whereas the default product client configuration uses
`wlan0`. The matched measurement used `p2p0`; no conclusion about interface
selection is needed to resolve the false regression premise.

The sole remaining Phase 1 question is whether the 38-AP control can be
reproduced with an image-shipped, bounded instrument. `wpa_supplicant` uses
nl80211 directly and `wpa_cli` asks that supplied daemon to scan, so together
they are the appropriate runtime instrument. They avoid treating an unshipped
diagnostic binary as a product capability.

## Proposal

Remain in Phase 1 and make no product edit. Run exactly one transient matched
scan on `p2p0` using the shipped binaries:

1. before launch, log the action and create only a named empty temporary
   supplicant configuration with `update_config=0` and a private named `/run`
   control directory;
2. launch `/usr/sbin/wpa_supplicant -Dnl80211` directly on `p2p0`, without
   enabling a unit, altering `/etc`, changing mosd settings, or associating to a
   network;
3. invoke `/usr/sbin/wpa_cli` through that private control directory for one
   scan, wait at most 30 seconds for a scan-completed or scan-failure event, and
   only then collect `scan_results`, preserving stdout, stderr, and exit status
   in the task record;
4. stop only the recorded daemon PID and remove only the named temporary files
   and directory, then record the cleanup outcome.

If a scan produces BSS entries, close the alleged eMMC regression as not
reproduced and record the diagnostic reproducibility gap. If the shipped tool
cannot start or a real scan completes with no BSS entries, retain the exact
result as new evidence and continue investigation; do not trial a fix.

## Result

The shipped-tool measurement succeeded. A temporary empty-config
`wpa_supplicant -Dnl80211 -i p2p0` instance accepted `wpa_cli scan` with exit 0
and `OK`. Its driver log records a 39-channel scan beginning at 04:22:49 UTC and
completing at 04:22:52 UTC as `inst: 3, aborted: 0, scan result: 34`. Source
inspection establishes the exact meaning: `skw_scan()` resets
`nr_scan_results` immediately before it issues `SKW_CMD_START_SCAN`, and the
scan-report handler increments it only after `cfg80211_inform_bss_frame()`
returns a BSS. The completed result therefore represents 34 reported BSS frames.
The first calibration request completed 31 by the same count. The original
38-AP control is thus reproduced qualitatively on eMMC; its exact RF count need
not match a later scan.

The short-lived direct instance was stopped by its recorded PID, and a
post-run check found no supplicant and no named temporary configuration, log,
PID, or control-directory path. No service was enabled and no persistent
configuration or board boot state changed. The userland event collector did not
retain a `wpa_cli scan_results` table, so this record does not mislabel it as a
direct CLI row count; the driver-count evidence is what establishes the result.

`iw` omission is intentional at the image-composition level: it is absent from
the explicit package allowlist and from both SD artifacts as well as eMMC, while
`wpasupplicant` is the documented station-role runtime. Do not add `iw` to the
sealed image for this test. Record the acceptance method as the shipped
temporary-supplicant workflow; only a separately approved dev-profile proposal
should add `iw` if its display is specifically required.

## Risks

- A scan temporarily uses the radio on a board in active use. The action is
  limited to one control-interface scan, contains no network credentials, and
  leaves no enabled unit or persistent configuration.
- Adding `iw` merely to make a test convenient would expand the sealed rootfs
  without establishing a runtime requirement.
- Treating the absence of an unshipped diagnostic as a kernel failure would
  repeat the corrected evidence error.

## Scope

Continued Phase 1 evidence collection only. Excludes trial fixes, image rebuilds,
kernel/fragment edits, bootargs edits, firmware or module restaging, further
raw-netlink probing, external `iw` probes, board reboot/slot changes, eMMC
boot-area writes, `bootloader_a`, and Bluetooth peer validation.

## Alternatives

- Add `iw` to the product image: not authorized and not proposed as a test
  convenience. It may later be considered for a dev profile only if acceptance
  needs it and a separate proposal supplies that justification.
- Use the masked generic `wpa_supplicant.service`: rejected because documented
  lifecycle ownership is per-interface mosd control, not an always-running
  generic daemon.
- Treat `wlan0` or `p2p0` zero-BSS reports as evidence: rejected; both commands
  exited 127 and no scan request occurred.

## Annotations

- Phase 1 opened on 2026-09-01. No corrective change is authorized.
- 2026-09-01 04:17 UTC: corrected the evidence record after direct confirmation
  that the supplied `iw` commands fail with exit 127. Prior empty-list and
  zero-BSS claims, including the `p2p0` countertest, are invalid and withdrawn.
- Before the correction, temporary raw-netlink and external-`iw` listing probes
  occurred and their named artifacts were removed. They are not needed for the
  remaining question; no further probes of those kinds will run.
- 2026-09-01 04:21 UTC: an initial transient shipped-tool run established that
  `wpa_supplicant` starts on p2p0 and accepts `SCAN`, but its immediately read
  empty cache preceded any scan-complete event. It is explicitly not a zero-BSS
  result. PID and all named artifacts were removed and cleanup was verified; the
  remaining matched scan will wait for completion before reading results.
- 2026-09-01 04:26 UTC: the corrected p2p0 request completed without abort and
  reported 34 BSS frames through the driver counter. The alleged regression is
  not reproduced; no corrective implementation or image change is proposed.
