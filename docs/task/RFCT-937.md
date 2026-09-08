# RFCT-937 Investigate s905x5m Wi-Fi acceptance-evidence gap

- **status**: completed — investigation concluded; no corrective change proposed
- **priority**: P1
- **owner**: l2-wifi-emmc-investigation
- **createdAt**: 2026-09-01 03:35 UTC
- **plan**: [PLAN-919](../plan/PLAN-919.md)

## Description

Correct a false eMMC Wi-Fi regression premise. Every reported `iw` invocation
on the deployed image exited 127 because the image does not ship `iw`; stderr
was redirected away. Consequently, neither the empty `iw dev` output nor either
reported zero-BSS scan was a measurement: no `iw` listing or scan ran. No Wi-Fi
regression is established.

Determine whether RFCT-913's reported 38-AP control can be repeated using an
instrument shipped by the image, and document whether omitting `iw` is an
intentional sealed-appliance choice or an acceptance-evidence gap. The candidate
instrument is the delivered `wpa_supplicant` and `wpa_cli`, using a transient,
empty configuration against the control interface. No product change is in
scope.

## Result

No eMMC Wi-Fi regression was reproduced. A transient instance of the shipped
`wpa_supplicant` bound to control interface `p2p0`; its `wpa_cli scan` command
exited 0 and returned `OK`. At 04:22:49 UTC the driver started a 39-channel
scan, and at 04:22:52 UTC it completed with `aborted: 0, scan result: 34`.
The loaded driver resets `nr_scan_results` before `SKW_CMD_START_SCAN` and
increments it only after a BSS frame is successfully handed to
`cfg80211_inform_bss_frame`; this is evidence of 34 reported BSS frames, not
the previous fictitious zero-BSS outcome. The earlier calibration scan similarly
completed 31 BSS frames. RFCT-913's exact count of 38 is not expected to be
stable across RF conditions, but the material property — a successful nonzero
scan on the eMMC image — is reproduced.

`iw` is absent by intended image composition: the documented rootfs allowlist
contains `wpasupplicant` and `hostapd` but not `iw`, and the SD control lacks it
too. It is not a runtime Wi-Fi dependency. No production `iw` addition is
proposed. The acceptance gap is procedural: RFCT-913 relied on an unrecorded,
unshipped `iw`; future shipped-image acceptance should use the documented
temporary `wpa_supplicant`/`wpa_cli` method or define an explicitly separate dev
profile if `iw` output is required.

## Acceptance

- Record the correction, including the failed-command exit status and why the
  previous listings and scans are invalid evidence.
- Establish whether a bounded `wpa_supplicant`/`wpa_cli` scan is the correct
  shipped instrument, then record one matched result with stdout, stderr, exit
  status, interface, and cleanup outcome.
- Explain the inactive `wpa_supplicant` service from the product lifecycle and
  distinguish it from a broken Wi-Fi stack.
- Assess the absence of `iw` from the image and SD control without adding it;
  record the resulting acceptance-evidence gap or an approved future proposal.
- Make no corrective image, kernel, bootargs, firmware, module, Bluetooth, slot,
  or boot-area change during Phase 1.

## ActiveForm

Completed the shipped-tool reproduction; no eMMC regression is established.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

- The board at `192.168.27.61` is in use by active work. Before any reboot or
  slot change, record that action here. No reboot or slot change is authorized
  for this task.
- Do not write eMMC boot areas or `bootloader_a`. Do not change a slot as a
  diagnostic shortcut.
- Heavy builds run on `192.168.27.200`. Stage named paths only; mos is never
  pushed.
- Bluetooth's soft block is excluded; RFCT-922 owns peer validation.
- 2026-09-01 03:35 UTC: claimed after confirming RFCT-936 and PLAN-918 were
  the current highest records and RFCT-937 / PLAN-919 were free. No board or
  image state had been changed.
- 2026-09-01 04:17 UTC: operator correction recorded. The eMMC image has no
  `iw`; `iw dev`, `iw phy`, `iw list`, and the reported interface scans printed
  `command not found` and exited 127. Redirecting stderr made those failures
  look like empty command output. Thus the claimed empty nl80211 listing and
  zero-BSS results are withdrawn, including the purported `p2p0` countertest.
  RFCT-913's 38-AP result remains a reported control observation, but it has not
  yet been reproduced on this image.
- `/usr/sbin/wpa_supplicant` and `/usr/sbin/wpa_cli` are delivered (both v2.10).
  The generic `wpa_supplicant.service` is masked by design; the
  `wpa_supplicant@.service` template is present for the product-managed
  per-interface lifecycle. At capture time no supplicant process or control
  socket existed. `/etc/wpa_supplicant/wpa_supplicant-wlan0.conf` contains only
  the managed control-interface and `update_config=0` settings; no `p2p0`
  configuration exists. This agrees with the documented default of no configured
  Wi-Fi client on first boot, rather than demonstrating a failure.
- A transient calibration check launched the shipped `wpa_supplicant -Dnl80211`
  on `p2p0` (the RFCT-913 control interface) with an empty named `/tmp`
  configuration, private named `/run` control directory, and `update_config=0`.
  `wpa_cli status` returned `DISCONNECTED` and `wpa_cli scan` returned `OK`.
  The immediate `scan_results` table was read before scan completion. That table
  is an initially empty cache, not a completed scan or an AP count, and must not
  be used as zero-BSS evidence. PID 3766 and all named paths were removed; a
  post-cleanup check found no supplicant or named leftovers.
- 2026-09-01 04:22 UTC: the corrected transient run used fresh named paths,
  PID 3917, the same empty configuration, and `p2p0`. `wpa_cli status` returned
  `DISCONNECTED`; `wpa_cli scan` exited 0 and returned `OK`. The userland event
  wait did not retain a `wpa_cli scan_results` table, so no CLI table is claimed
  as the count. The driver log is conclusive for the request: at 04:22:49 UTC it
  began a 39-channel scan and at 04:22:52 UTC completed `inst: 3, aborted: 0,
  scan result: 34`. In this source `nr_scan_results` is reset before scan start
  and incremented after each successful `cfg80211_inform_bss_frame`, establishing
  34 reported BSS frames. The earlier 04:20:54 UTC calibration request completed
  at 04:20:58 UTC with the same non-aborted path and 31 frames.
- The corrected run stopped only PID 3917 and removed only its named paths.
  A 04:23:31 UTC post-run check found no `wpa_supplicant` process and no
  `/tmp/rfct937-wpa-p2p0-0421.{conf,log}` or
  `/run/rfct937-wpa-p2p0-0421{,.pid}` remnants. Neither run enabled a service,
  changed `/etc` or mosd settings, associated to a network, rebooted, changed a
  slot, or wrote an eMMC boot area or bootloader.
- RFCT-913's exact control is
  `_out/s905x5m/s905x5m-mos-v2-sd-1788124881.img`, SHA-256
  `82f922650b3c7141fa9a10441c7a82030d7e667f3541bb62aad9bb5713c12205`.
  The mutable `-sd-latest.img` symlink points to a later rebuild and is not the
  control anchor. The control, later SD image, and deployed eMMC root each lack
  a shipped `iw` executable.
- The control final `.config` SHA-256 is
  `e96789ee3e2a56f447ef99d233720d96b95870df520a0d2110f51948f770d66f`; the
  running eMMC Image's is
  `b1483e16fd340182f615c26fdbbbe76be541d6fb4d0238d3c7775b7a18409bd4`.
  Their complete diff has exactly two changes: `NFT_FIB_INET=y` and
  `NFT_FIB_IPV6=y`; Wi-Fi-path configuration is unchanged. Relevant Wi-Fi
  modules, firmware, loading inputs, and DTB are byte-identical. The literal SD
  bridge and eMMC boot-script differences are only rootfs verity values and
  ordering, with no Wi-Fi-path argument. These comparisons supply no regression
  evidence, but they also cannot substitute for an actual scan.
- Before the correction, a temporary raw-netlink query and a temporary external
  `iw` listing query were run and their named files removed. They are now
  nonessential historical observations; no further raw-netlink or externally
  supplied `iw` probe will be run for this task.
- Rootfs packaging and provisioning documentation describe `wpa_supplicant` as
  the runtime station client managed by mosd, with no client started when no
  network is configured. The documented minimal rootfs package set does not
  include `iw`. That makes `iw` absence consistent with the sealed appliance
  design, but RFCT-913 used it as acceptance evidence, leaving a reproducibility
  gap unless acceptance uses a shipped instrument or a separately defined dev
  profile.
- 2026-09-01 04:19 UTC: immediately before the one permitted transient scan,
  preflight found `p2p0` already administratively UP and `NO-CARRIER`, with no
  running `wpa_supplicant`, no existing p2p0 control socket, and no collision at
  the named paths `/tmp/rfct937-wpa-p2p0-0417.{conf,log,results}` or
  `/run/rfct937-wpa-p2p0-0417{,.pid}`. The next action is limited to that named
  empty configuration, private control directory, one scan request, bounded
  result polling, exact-PID stop, and named-file cleanup. No reboot, slot, eMMC
  boot area, bootloader, service enablement, or persistent configuration action
  will occur.
- 2026-09-01 04:21 UTC: preflight for the corrected run found `p2p0` already
  UP/`NO-CARRIER`, no running supplicant or p2p0 control socket, and no collision
  at the fresh named paths. It made no change to the interface's pre-existing
  administrative state.
