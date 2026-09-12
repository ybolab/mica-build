# Update and rollback

An Mica OS deployment selects an independently signed kernel/support component and
an independently signed root filesystem. A release can change the root, the
kernel, or both. The device stages verified objects while the current system
runs, then starts the candidate on reboot. Firmware maintenance is separate.

> status: shipped — evidence: `pkgs/mos-deploy/`, `pkgs/mosd/apid/src/update_api.rs`

## Install an update

The System page shows the running deployment, component identities, candidate,
retained fallback, acquisition progress and reboot verdict. Configure the update
source, channel and automatic/manual policy through the authenticated settings
surface. A source distributes the signed `/v1/manifest.json` catalog. Source
settings cannot add signing keys.

Online acquisition downloads only missing objects and verifies their signed
lengths and digests. Offline `.mosupd` archives carry the same signed deployment
and component bytes. Installation accepts the resulting verified deployment ID.
Insufficient space, invalid metadata or incomplete objects prevent activation.

A reboot is a separate action subject to the reboot gate. After boot, health
checks confirm the candidate. An unconfirmed candidate has three attempts;
failed trials select the retained usable deployment. A shared storage failure
requires recovery instead of repeatedly blaming a root deployment.

> status: shipped — evidence: `pkgs/mos-deploy/src/acquisition.rs`, `pkgs/mos-deploy/src/deployments.rs`, `rootfs/overlay/usr/lib/mos/mos-health`

## Rollback

Manual rollback is available only when the running deployment is confirmed,
there is no pending candidate and a usable fallback is retained. The UI shows
the backend's verdict and target. A successful request retires the running
record and reports that a reboot is needed to run the fallback.

Rollback changes the OS deployment. It does not reverse arbitrary configuration,
database or application writes on DATA. All releases in this development phase
use the current data policy; there are no old-layout migrations.

Failed deployment IDs and the monotonic generation floor prevent automatically
reinstalling a known failed release. A corrected release uses a newly signed
higher generation; clearing a display record cannot bypass this constraint.

> status: shipped — evidence: `pkgs/mosd/apid/src/update_api.rs`, `pkgs/mosd/mosd/src/deployment.rs`

## Firmware and recovery

Normal OS updates never replace the loader or enroll platform keys. Firmware
packages are published separately and require the explicit offline maintenance
and readback workflow. Preserve its signed recovery package outside the ESP.
All development acceptance starts from a complete current image; no earlier
package or partition format is accepted.

QEMU boot/update evidence is recorded separately from cx3576 hardware evidence.
Physical watchdog, storage power-cut and USB maintenance acceptance remain board
work; see the [support tiers](../boards/support-tiers.md#current-boards).

> status: board-dependent — evidence: `docs/design/release-signing.md`
