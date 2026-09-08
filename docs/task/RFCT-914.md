# RFCT-914 Ship a system time source with systemd-timesyncd

- **status**: completed
- **priority**: P1
- **owner**: implementation/plan-911-m1-20260831
- **createdAt**: 2026-08-31 03:47 UTC
- **plan**: PLAN-911 M1

## Description

Ship `systemd-timesyncd` as the device time source. Add the explicit Debian
package, persist NTP configuration through the settings schema and a mosd
reconciler, gate TLS-dependent services on synchronized time, and assert the
installed enablement and hardware synchronization behaviour.

The owner selected `systemd-timesyncd`; authenticated time, chrony, NTS, eMMC,
boot areas, and `bootloader_a` are out of scope.

## Acceptance

- A booted s905x5m reports `System clock synchronized: yes`.
- After a reboot, its clock is correct rather than the build-time date.
- The rootfs verifier asserts the `systemd-time-wait-sync.service` enablement
  symlink using the same convention as `systemd-repart`.

## ActiveForm

Completed the systemd-timesyncd time source and proved it on the s905x5m.

## Dependencies

- **blocked by**: (none)
- **blocks**: PLAN-911 M4 hardware smoke check

## Notes

- The user dispatch is explicit approval to implement the already-approved M1
  scope in PLAN-911.
- Heavy builds run on `192.168.27.200`; no mos content is pushed remotely.
- Before certificate- or expiry-sensitive hardware measurements, set the
  board clock by hand and record that action.

## Investigation

- The current settings schema is v8 and registers seven reconcilers. Its
  migration registry ends at `MigrateV7ToV8`; v9 must retain the normal
  additive-upgrade and remove-on-downgrade contract so a persisted time key
  cannot make an older slot reject `access.webAdmin` or the rest of the tree.
- The trixie package was inspected in the exact pinned base image. It installs
  `systemd-timesyncd.service` enabled, but
  `systemd-time-wait-sync.service` needs explicit enablement; `systemctl
  --root=/ enable` creates
  `/etc/systemd/system/sysinit.target.wants/systemd-time-wait-sync.service`.
  The wait service is `Before=time-sync.target` and the package configuration
  recommends `/etc/systemd/timesyncd.conf.d` drop-ins.
- `/etc` is the read-only verity root. The sshd pattern works only because
  `etc-ssh.mount` binds a STATE directory before sshd starts. A timesyncd
  drop-in therefore needs the equivalent STATE-backed directory mount and a
  convergent `mos-seed-state` source directory; otherwise a production mosd
  write fails with EROFS.
- RAUC is installed as an upstream-built unit at image assembly time, so a
  static rootfs drop-in is the narrow way to order it. apid and the MQTT bridge
  have tracked unit files and can express the same time target ordering there.

## Proposal

- Add `time.ntpServers`, defaulting to `time.cloudflare.com` and
  `pool.ntp.org`, and migrate schema v8 to v9. The migration's upward step
  changes only the version stamp; serde supplies the default. Its downward
  step removes `time`, while preserving every existing sibling including
  `access.webAdmin`.
- Add a `TimeReconciler` that validates each server token, renders the sole
  `10-mos.conf` drop-in, avoids writes when its bytes already match, and
  restarts timesyncd only when the configuration changes.
- Bind `/mnt/state/timesyncd.conf.d` onto
  `/etc/systemd/timesyncd.conf.d` before the time service starts. Add
  `Wants=time-sync.target` and `After=time-sync.target` to RAUC, apid and the
  MQTT bridge, then enable the wait service at image build time.
- Add the wait-service enablement assertion and focused migration, reconciler,
  unit-ordering and rootfs-shape tests before building and booting an SD image.

## Result

Commit `501c389` ships the selected `systemd-timesyncd` time source. It names
the separate trixie package explicitly, renders the sole
`/etc/systemd/timesyncd.conf.d/10-mos.conf` drop-in from the version-9
`time.ntpServers` setting, and keeps its mutable directory on STATE. The
default servers are `time.cloudflare.com` and `pool.ntp.org`. The time
reconciler is idempotent and only restarts timesyncd after a changed render.

The v8-to-v9 migration remains additive on upgrade and removes only `time` on
downgrade, preserving the previously introduced `access.webAdmin` sibling.
RAUC, apid and the MQTT bridge each want and start after `time-sync.target`.
The rootfs explicitly enables `systemd-time-wait-sync.service`, and the
verifier asserts its `sysinit.target.wants` symlink using the
`systemd-repart` convention.

The M1-only SD artifact was built from an isolated source tree at `501c389` on
the approved build host. Its rootfs package report contains
`systemd-timesyncd` version 255. It was deployed only to inactive slot B:
`/dev/mmcblk1p6` (boot), `/dev/mmcblk1p8` (rootfs), and the SD cfgload bridge
on `/dev/mmcblk1p1`. The running A slot, every eMMC partition and both eMMC
boot areas were excluded. Each written B payload was read back with its
expected SHA-256 before boot.

Before the first time-sensitive measurement, the board clock was manually set
to `2026-08-31 05:46:26 UTC`, as required because the old image started at
`2026-04-13`. The first B boot reached `NTPSynchronized=yes`, contacted
`time.cloudflare.com`, and rendered the expected managed NTP drop-in. A second
B reboot was then performed without manually setting time. At
`2026-08-31 05:49:23 UTC`, it again reported `NTPSynchronized=yes` and active
NTP. The boot journal records that timesyncd first advanced the clock to the
recorded timestamp, then completed initial synchronization with
`time.cloudflare.com`; its recorded-clock file is on persistent `/var`
(`/dev/mmcblk1p11`, ext4). This proves the acceptance behavior on hardware,
not merely the installed configuration.

## Verification

- On the approved build host, `cargo test -p mosd-settings --locked` passed 68
  unit and 58 integration tests. `cargo test -p mosd reconciler::time --locked`
  passed 6 tests, and the apid schema-root test passed.
- The M1 rootfs-shape verifier passed 44/44 checks. The M1-only SD image build
  passed its rooted smoke check (12/12). The full image verifier reported 361
  passing assertions, 9 named skips and 11 pre-existing PLAN-910
  vendor-U-Boot `boot.scr` failures; none concern M1.
- The first B boot showed `systemd-timesyncd.service` active, the wait service
  `enabled`, `systemd-time-wait-sync.service` `Result=success` and
  `time-sync.target` active. The managed drop-in contained
  `NTP=time.cloudflare.com pool.ntp.org`, mounted from persistent STATE. The
  `After` and `Wants` properties of `rauc.service`, `apid.service` and
  `mos-mqttd.service` each included `time-sync.target`.
- The second B boot retained `rauc.slot=B`, loaded the B root PARTUUID, reported
  `System clock synchronized: yes`, `NTP service: active`, and
  `NTPSynchronized=yes`. Its journal recorded the persisted-clock advance and
  a fresh Cloudflare synchronization.

## Card chronology and deployment note

RFCT-913's SD-media measurement predates M1. It described the deliberately
installed `SR64G` card (59.5 GiB, CID
`03534453523634478664e2c850019500`), and remains the record for that card.
That card was deliberately physically replaced. The M1 pre-write identity check
and every B-slot result in this task instead use the current `SC16G` card
(15,193 MiB, CID `03534453433136478082885ad3018c00`). This is a media change,
not a stale label or a contradiction in the earlier result.

For the M1 deployment, the current card identified as `/dev/mmcblk1`, type
`SD`, with no hardware boot areas; its capacity was checked before writing. The
eMMC separately identified as `/dev/mmcblk0`, type `MMC`, name `AT3SFA`, with
`boot0` and `boot1`. A CID records which physical card supplied a measurement;
neither CID authorizes a write. The target decision always required the `SD`
type, absence of hardware boot areas, capacity check and explicit exclusion of
eMMC.

The shared SD cfgload partition (`/dev/mmcblk1p1`) unexpectedly mounted
read-only even though its block-device read-only flags were clear. A copied
`boot.ini` therefore could not be written. After backing up the full partition
to persistent SD DATA and confirming its `Image` payload was byte-identical,
the verified B cfgload image was written as a whole. This was an SD-only bridge
write needed to select inactive B; it did not alter the eMMC, its boot areas or
`bootloader_a`. B remains the currently running, hardware-proven slot.
