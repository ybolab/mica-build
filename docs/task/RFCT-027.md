# RFCT-027 Image + verifier integration for the M5 access, provisioning and connd features

- **status**: completed — implementation complete, both verifiers green, on-device behaviour is the user's acceptance
- **priority**: P1
- **owner**: ai-agent
- **createdAt**: 2026-08-19 00:23
- **claimedAt**: 2026-08-19 03:30
- **completedAt**: 2026-08-19 04:55

## Description

PLAN-010 M5 landed four mosd features that only exist as code: the sshd
reconciler (RFCT-023), the per-device secrets (RFCT-024), the WiFi station
reconciler (RFCT-025) and the WiFi access-point reconciler (RFCT-026). Each of
them renders configuration for a daemon the image did not carry, drives a unit
the image did not install, or reads a file the image did not ship. This task is
the image half, plus the verifier assertions that prove the two halves agree.

It also fixes a pre-existing defect the loader-partition task found and
correctly declined to fix in someone else's area: the v2 repart definitions
could not drive a successful run at all, so `/srv` never grew on a real device.

## What shipped

### R1 — the connd userland, both pipelines

`wpasupplicant` and `hostapd` are added to the allowlist in **both**
Dockerfiles, documented in `os/rootfs/README.md` with the reason each is there.
`dnsmasq` is deliberately absent and its absence is now asserted: the AP's DHCP
server is systemd-networkd's built-in `DHCPServer=yes`.

The two reconcilers each tabulated the exact paths and unit names they depend
on. The image satisfies those tables literally, and the verifiers read the
values back out of the reconcilers rather than restating them (see R3).

| RFCT-025 / RFCT-026 asked for | Image provides | Asserted by |
|---|---|---|
| `wpasupplicant`, `/usr/sbin/wpa_supplicant` | yes | both verifiers |
| `wpa_supplicant@.service`, `-c/etc/wpa_supplicant/wpa_supplicant-%I.conf` | yes, Debian's own template | ExecStart cross-check against `wifi_client.rs` |
| `hostapd`, `/usr/sbin/hostapd` | yes | both verifiers |
| `hostapd@.service`, `… /etc/hostapd/%i.conf` | yes, Debian's own template | ExecStart cross-check against `wifi_ap.rs` |
| `/etc/wpa_supplicant` writable at runtime | v1: writable ext4 root, mode 0700. v2: `etc-wpa_supplicant.mount`, `/mnt/state/wpa_supplicant` | both verifiers; v2 asserts the BACKING |
| `/etc/hostapd` writable at runtime | v1: as above. v2: `etc-hostapd.mount`, `/mnt/state/hostapd` | both verifiers |
| no dnsmasq | absent | both verifiers |

### The KNOWN-OPEN question from RFCT-026 is now CLOSED, and the answer was yes

RFCT-026 could not settle whether Debian ships an enabled `hostapd.service`,
because its build environment had no `hostapd` package. It recorded the
expectation and declined to claim verification. This task has the image build,
so it was measured — an arm64 probe image built from the same base and package
set, `dpkg -L` plus the postinst's enablement links:

```
== versions ==
hostapd 2:2.10-12+deb12u3 arm64
wpasupplicant 2:2.10-12+deb12u3 arm64

== enablement symlinks under /etc/systemd ==
/etc/systemd/system/dbus-fi.w1.wpa_supplicant1.service
/etc/systemd/system/multi-user.target.wants/hostapd.service
/etc/systemd/system/multi-user.target.wants/wpa_supplicant.service
```

**RFCT-026's expectation was right, and its reconciler's unit name is right.**
There is no blocking finding to report:

- `hostapd@.service` exists, and its `ExecStart` is
  `/usr/sbin/hostapd -B -P /run/hostapd.%i.pid $DAEMON_OPTS /etc/hostapd/%i.conf`
  — exactly the path `wifi_ap.rs` renders. It also carries
  `ConditionFileNotEmpty=/etc/hostapd/%i.conf`, so an instance mosd has not
  configured yet cannot start.
- `wpa_supplicant@.service` exists with
  `-c/etc/wpa_supplicant/wpa_supplicant-%I.conf` — exactly what `wifi_client.rs`
  renders.
- a non-templated `hostapd.service` exists, carries `[Install]
  WantedBy=multi-user.target`, and **is enabled by the postinst**, exactly as
  RFCT-026 predicted.

**One finding RFCT-025 did not predict:** `wpasupplicant` also ships an enabled
`wpa_supplicant.service`. It is worse than the hostapd one in two ways. It has
**no condition at all**, so it does start; and it carries
`RuntimeDirectory=wpa_supplicant`, which means systemd **deletes
`/run/wpa_supplicant` when it stops** — taking the control socket of the
templated instance mosd started with it. `hostapd.service` is condition-gated on
a file mosd never writes, so today it does not actually start; that is one
operator `cp` away from a second hostapd fighting the reconciler for the radio
while `hostapd@wlan0.service` still reports healthy.

Both are **masked**, and so is the `Alias=` link
`dbus-fi.w1.wpa_supplicant1.service`. Masked rather than disabled because
`wpasupplicant` ships
`/usr/share/dbus-1/system-services/fi.w1.wpa_supplicant1.service`: a plain
`systemctl disable` leaves the D-Bus activation path open and masking does not.
The build asserts the masks and asserts that neither template is statically
enabled; both verifiers assert the same against the packed artifact.

### R1b — the image's networkd namespace cannot collide with mosd's

`network.rs` deletes every `*-mos-*.network` it did not render, and the two WiFi
reconcilers deliberately sit outside that pattern. Both verifiers now enumerate
every `.network` file the image ships and assert none of them falls in a
reconciler-owned namespace, and that `80-dhcp.network` sorts before both WiFi
prefixes so a reconciler-rendered unit is never shadowed by the image's
fallback. On v2 that enumeration covers systemd's own
`/usr/lib/systemd/network` set (eight files, including `80-wifi-adhoc.network`),
so the check is not vacuous.

The two prefixes are compared with the image's file **independently**. They have
no ordering requirement between themselves — they never match the same
interface — so asserting that the three sort as one list would have been a check
about the wrong property.

### R2 — `/usr/lib/mos/profile.conf`

`MOS_PROFILE=dev` by default, selectable with `MOS_PROFILE=prod bash
os/rootfs/build.sh` (or `build-v2.sh`), mode 0444. The build **rejects** any
value that is not exactly `dev` or `prod` in lowercase.

The file is load-bearing in a way that is invisible when it is wrong. mosd reads
it once on first boot to seed `access.ssh.enabled` and **fails closed**: a file
that is missing, unreadable, misspelt in the key, or carrying an unrecognised
value all resolve to `prod`, and the comparison is case-sensitive so `DEV` does
too. Every one of those mistakes produces an image where all the checks are
green and the dev SSH path has simply disappeared.

So `ssh.service`'s **static enablement in the image now follows the profile**,
and both verifiers assert the agreement in both directions. That is a deliberate
change to the prod image: before it, a prod image would have had sshd listening
from early boot until mosd's reconciler got around to stopping it. The
pre-existing unconditional "ssh.service is enabled" check is **replaced** by the
profile-conditional pair rather than kept alongside it — one check, more precise
— which is why the counts below show one check removed.

`/usr/lib` and not `/etc`, because it describes the image rather than the
device; on v2 that also puts it inside the read-only verity root, where a
production device cannot be edited into a development one.

### R2b — the v2 repart definitions could not grow anything (FIXED)

`systemd-repart` refuses to claim an **existing** partition smaller than the
definition's minimum size, and that minimum defaults to 10 MiB. `uenv-a` and
`uenv-b` are 64 KiB linux-generic partitions, so `10-uenv-a.conf` and
`20-uenv-b.conf` could not pair with them. repart concluded it had to CREATE two
new partitions, could not place them, and aborted the whole run before touching
anything. Reproduced here on the v2 image as built, with the definitions the
image ships:

```
=== DATA size BEFORE ===
1048576 sectors (512.0 MiB)          <- (p10 ephemeral; DATA is p11, 131072 sectors)
Can't fit requested partitions into available free space (6.7G), refusing.
Automatically determined minimal disk image size as 1.3G, current image size is 8.0G.
```

The consequence was that v2's `/srv` **never grew** on a real device, and a
refusal looks exactly like a clean exit. The fix is `SizeMinBytes=0` in both
placeholder definitions. Verified before applying, not taken on faith: the same
run with the directive added grows DATA from 131072 to 14217176 sectors
(64 MiB → 6.8 GiB) and leaves the loader magic at LBA 64 intact.

**Order matters and this must not be back-ported in isolation.** While it was
broken, this defect *masked* the loader-wipe hazard on v2: repart aborted before
it ever reached the discard. Fixing the definitions on a layout **without** the
loader partition entry would have un-masked a bootloader wipe. The loader
partition is merged (RFCT-031), so the fix is safe here — but the two changes
travel together or not at all. The same note is in both `.conf` files.

`os/repart-loader-test.sh` gained a section that runs the definitions
**unpacked out of the packed root**, not a synthesised set, and asserts the
outcome that matters — DATA is bigger afterwards. "repart did not error" would
not have been enough: that is exactly what the refusal already looked like. Its
negative direction removes `SizeMinBytes=0` again and asserts the run refuses
and DATA stays put.

### R3 — the verifier assertions

Every path, prefix and unit name in the new sections is **read out of the mosd
source that owns it** instead of restated. A constant restated in two places can
drift, and this drift is invisible from the code side: mosd's tests all pass
against a mock. Each extraction is checked for emptiness, so a rename in mosd
breaks the verifier loudly rather than turning an assertion into a comparison
against `""` — demonstrated in the negative tests.

The two assertions no Rust test can make, because the test host is x86 and the
artifact is an arm64 object inside the image:

**(a) The image's libcrypt implements the format the shadow field uses.**
RFCT-023 shipped bcrypt (`$2b$`); Argon2id was never an option, because Debian
bookworm's libxcrypt has no argon2 support at all. Measured on the library
**packed in this image**: zero `argon2` strings, and it carries `$1$ $2a$ $2b$
$2x$ $2y$ $3$ $5$ $6$ $7$ $gy$ $sha1$ $y$`. The prefix is read from the
assertion `sshd.rs` pins on its own output, and the verifier requires that
source to be unambiguous (exactly one prefix) before the comparison means
anything.

**(b) profile.conf agrees with ssh.service enablement**, both directions —
`dev` implies enabled, `prod` implies not.

Plus, for connd: the units the reconcilers name exist in the image, their
ExecStart config path is the one the reconciler renders, the config directories
are writable at runtime with the **backing** asserted rather than just the
directory, and no unit the reconcilers own is statically enabled.

### R3c — nothing the shadow task already shipped was re-added

Both verifiers were read first. The `/etc/shadow` symlink and its target, the
factory copy and its mode/ownership, the reconcile unit's enablement and its
`After=`/`Before=` ordering including that each named unit exists — all of that
is RFCT-029's and is untouched.

## Counts

Measured on this base **before** the change, not assumed:

| Verifier | Before | After | Added | Removed |
|---|---|---|---|---|
| `os/verify-image.sh` | **99** | **126** | 28 | 1 |
| `os/verify-image-v2.sh` | **264** | **293** | 30 | 1 |
| `os/repart-loader-test.sh` | 11 | 18 | 7 | 0 |

The one removed check in each is the unconditional "ssh.service is enabled",
replaced by the profile-conditional assertion that covers both directions.

## Files changed

- `os/rootfs/Dockerfile`, `os/rootfs/Dockerfile.v2` — packages, masking, config
  directories, `ARG MOS_PROFILE` + profile.conf, profile-driven ssh enablement
- `os/rootfs/build.sh`, `os/rootfs/build-v2.sh` — forward `MOS_PROFILE`
- `os/rootfs/overlay-v2/etc/systemd/system/etc-wpa_supplicant.mount` (new)
- `os/rootfs/overlay-v2/etc/systemd/system/etc-hostapd.mount` (new)
- `os/rootfs/overlay-v2/usr/lib/mos/mos-seed-state` — seed both STATE dirs at 0700
- `os/rootfs/overlay-v2/etc/repart.d/10-uenv-a.conf`, `20-uenv-b.conf` — `SizeMinBytes=0`
- `os/rootfs/README.md` — the allowlist entries, the masking table, the profile
- `os/verify-image.sh`, `os/verify-image-v2.sh` — the new assertions
- `os/repart-loader-test.sh` — the shipped-definition growth section
- `Makefile` — help/comment for `os-repart-test`
- `docs/task/RFCT-027.md` (this file)

`board/**` is untouched. No board change was needed.

## Known limitations, stated rather than hidden

- **A device already seeded by an older image will not get the two new STATE
  directories.** `mos-seed-state` is gated on `/mnt/state/.mos-state-seeded` by
  a `ConditionPathExists` on its unit, so the whole oneshot is skipped on a
  seeded device and `etc-wpa_supplicant.mount` / `etc-hostapd.mount` would have
  no source. This is the pre-existing shape of STATE seeding (`/etc/ssh` has the
  same property), not something this task introduced, and redesigning it means
  changing a mechanism three other tasks depend on. It is harmless today because
  nothing has been field-seeded, but an image that adds a STATE directory after
  devices exist needs a seed-generation bump. Recorded, not implemented.
- **`hostapd.service` is masked as defence in depth, not because it starts
  today.** Its `ConditionFileNotEmpty=/etc/hostapd/hostapd.conf` is not
  satisfied on a mos image. The mask is there because mosd owns the lifecycle
  and because the condition is one file away from being satisfied.
- **The regulatory correctness of the AP is not something the image can
  assert.** `hostapd` is installed; whether the resulting channel and transmit
  power are legal where a device is deployed depends on the regulatory database,
  the driver and the operator's `country_code`.
- **Whether the AP6275S vendor driver supports AP mode at all is hardware.** The
  image ships the firmware and the daemon; PLAN-008 records the driver as the
  known risk and only a radio can settle it.
- **`os/verify-image.sh` cannot assert the STATE backing of the config
  directories**, because v1 has no STATE partition. It asserts what is true
  there instead: the directories exist, mode 0700, on a writable ext4 root.
- **On-device behaviour is the user's acceptance and is not claimed here.**
  Nothing in this task has been near a radio, and no assertion in it observes a
  running system. Every check reads a packed artifact or a source file.

## Dependencies

- **blocked by**: RFCT-023 (sshd reconciler, the `$2b$` shadow format),
  RFCT-025 (station reconciler's path/unit table), RFCT-026 (AP reconciler's
  path/unit table), RFCT-029 (the shadow-on-STATE verifier checks this task must
  not duplicate), RFCT-031 (the loader partition, without which R2b's fix would
  un-mask a bootloader wipe)
- **closes**: RFCT-026's KNOWN-OPEN question about Debian's `hostapd.service`
- **closes**: the v2 repart growth defect RFCT-031 recorded and declined to fix

## Verification (2026-08-19)

All mandatory checks, on the tree as delivered:

```
===== make os-image-cx3576 ===== / bash os/verify-image.sh
RESULT: PASS (126/126 checks)
===== make os-image-cx3576-v2 ===== / bash os/verify-image-v2.sh
RESULT: PASS (293/293 checks)
===== make os-health-test =====
RESULT: PASS (54/54 checks)
===== bash os/mkimage-v2-selftest.sh =====
RESULT: PASS
===== bash mosd/hack/check.sh =====
ALL CHECKS PASSED
===== make os-devkeys / make os-bundle-cx3576 =====
built _out/cx3576/mos-cx3576-1787112902.raucb
===== make os-repart-test =====
RESULT: PASS (18/18 checks)
```

### Negative tests

Every added guard was seen to FAIL against a broken artifact and to PASS again
once restored. Three mechanisms, chosen per guard by what actually breaks it:

**A. Source-of-truth drift** — one mosd constant mutated, both verifiers run
against the UNCHANGED images. This is the failure mode the extraction exists to
catch, and it fires on both pipelines at once.

| Mutation | FAILs |
|---|---|
| `wifi_client.rs` `NETWORKD_PREFIX` -> `80-` | image `.network` files collide with the station namespace (v1: 1 file, v2: 8) |
| `wifi_ap.rs` `NETWORKD_PREFIX` -> `10-wifi-ap-` | `80-dhcp.network` does not sort before `10-wifi-ap-` |
| `network.rs` sweep marker -> `-dhcp` | `80-dhcp.network(swept-by-network.rs)` |
| `wifi_client.rs` `DEFAULT_CONFIG_DIR` -> `/etc/wpa_supplicant2` | station ExecStart mismatch; v1: not a directory, v2: `etc-wpa_supplicant2.mount` does not exist |
| `wifi_ap.rs` config name -> `hostapd-{interface}.conf` | AP ExecStart mismatch |
| `wifi_ap.rs` unit name -> `hostapd2@` | unit missing; "mosd would drive a unit that does not exist" |
| `NETWORKD_PREFIX` **renamed** (extraction returns "") | "could not read the connd contract out of …", plus the two downstream checks fail rather than passing vacuously |
| `provisioning.rs` `PROFILE_KEY` renamed | profile resolves to `''`; ssh enablement cannot be judged |
| `provisioning.rs` `DEFAULT_PROFILE_PATH` -> `/etc/mos/profile.conf` | "mosd reads its profile from '/etc/mos/profile.conf' … but the image ships /usr/lib/mos/profile.conf" |
| `sshd.rs` pinned prefix -> `$argon2id$` | "the libcrypt packed in this image does NOT implement `$argon2id$` … Formats it does carry: `$1$ $2a$ $2b$ …`" |
| `sshd.rs` pins two prefixes | "pins 2 distinct crypt(3) prefixes (`$2b$ $6$`); … the libcrypt check below cannot mean anything" |

**B. v1 image mutation** — a COPY of the assembled image, p3 extracted, mutated
with `debugfs -w`, written back, verifier run on the copy.

| Mutation | FAIL |
|---|---|
| remove the `hostapd.service` mask symlink | "hostapd.service is not masked" |
| restore the postinst wants link for `wpa_supplicant.service` | "still carries the package's multi-user.target.wants enablement symlink" |
| statically enable `hostapd@.service` | "mosd owns that lifecycle and would race the image's own instance" |
| remove `/usr/sbin/wpa_supplicant` | "missing or not a regular file" |
| remove `wpa_supplicant@.service` | unit missing + "mosd would drive a unit that does not exist" |
| `chmod 0755 /etc/hostapd` | "is a directory but mode 0755, expected 0700" |
| add `/usr/sbin/dnsmasq` | "dnsmasq ships in the image" |
| add `50-mos-eth0.network` | "collide with a reconciler-owned namespace: 50-mos-eth0.network(swept-by-network.rs)" |
| remove `profile.conf` | not a regular file + resolves to `''` + ssh cannot be judged |
| write `MOS_PROFILE=DEV` | "resolves to 'DEV', which mosd does not recognise… FAILS CLOSED" |
| `chmod 0644 profile.conf` | "is mode 0644, expected 0444" |
| dev profile, ssh.service wants link removed | "profile is dev but ssh.service is NOT enabled in the image" |
| remove the libcrypt SONAME symlink | "does not resolve to a regular file… pam_unix cannot verify any password at all" |
| swap in a libcrypt with no bcrypt | "does NOT implement `$2b$` … Formats it does carry: `$6$ $sha1$ $y$`" |
| remove the only `.network` file | "the image ships no .network file at all, so this namespace check would pass vacuously" |

**C. v2 image mutation** — a deliberately broken v2 image built from a mutated
`Dockerfile.v2` and `mos-seed-state` (masking block removed, both templates
statically enabled, the two mount units dropped from the enable loop, the seed
loop emptied, `profile.conf` widened to 0644, `/usr/sbin/hostapd` removed,
`/usr/sbin/dnsmasq` added). Fourteen distinct guards fired, one per broken
property, and nothing else:

```
FAIL: /usr/sbin/hostapd missing or not a regular file
FAIL: wpa_supplicant@.service is statically enabled in the image; mosd owns that lifecycle and would race the image's own instance
FAIL: hostapd@.service is statically enabled in the image; mosd owns that lifecycle and would race the image's own instance
FAIL: hostapd.service is not masked (it is 'not a symlink to /dev/null'). ...
FAIL: hostapd.service still carries the package's *.wants enablement symlink
FAIL: wpa_supplicant.service is not masked (it is 'not a symlink to /dev/null'). ...
FAIL: wpa_supplicant.service still carries the package's *.wants enablement symlink
FAIL: dbus-fi.w1.wpa_supplicant1.service is not masked (it is '/lib/systemd/system/wpa_supplicant.service'). ...
FAIL: etc-wpa_supplicant.mount exists but is not enabled; /etc/wpa_supplicant would stay on the read-only squashfs
FAIL: mos-seed-state does not create /mnt/state/wpa_supplicant (0700); the bind would have no source on first boot ...
FAIL: etc-hostapd.mount exists but is not enabled; /etc/hostapd would stay on the read-only squashfs
FAIL: mos-seed-state does not create /mnt/state/hostapd (0700); the bind would have no source on first boot ...
FAIL: dnsmasq ships in the image; the provisioning AP hands out addresses through systemd-networkd's DHCPServer=yes ...
FAIL: /usr/lib/mos/profile.conf is mode 644, expected 444
RESULT: FAIL (279/293 checks)
```

**D. The other direction, on real images.** `MOS_PROFILE=prod` builds of BOTH
pipelines were built and verified end to end — not a mutation, the prod artifact
the tree can actually produce:

```
### PROD IMAGE (v1) ###
PASS: /usr/lib/mos/profile.conf carries exactly one MOS_PROFILE=prod line, an exact lowercase value mosd recognises
PASS: profile is prod and ssh.service is NOT enabled in the image, so sshd never listens before mosd has decided
RESULT: PASS (126/126 checks)
### PROD IMAGE (v2) ###
PASS: profile is prod and ssh.service is NOT enabled in the image, so sshd never listens before mosd has decided
RESULT: PASS (293/293 checks)
```

A guard that fails on a healthy image is as bad as one that never fires, so the
prod run matters as much as the broken one: 126/126 and 293/293 on an image
whose ssh.service is deliberately not enabled.

**E. The build-time profile guard.** `MOS_PROFILE=DEV bash os/rootfs/build.sh`
fails the build rather than shipping an image that silently self-provisions to
prod:

```
#11 0.378 error: MOS_PROFILE is 'DEV'; it must be exactly 'dev' or 'prod' in lowercase.
          mosd's comparison is case-sensitive and every other value resolves to prod,
          which silently disables SSH
ERROR: failed to build ... exit code: 1
```

**F. R2b, both directions, inside the harness.** `os/repart-loader-test.sh` now
carries the growth proof and its own negative case permanently, so it cannot
regress silently:

```
PASS: read 8 repart definitions out of the PACKED root (rootfs-verity.img), so what follows tests the image's own set and not a synthesised one
PASS: v2 DATA (p11) is 131072 sectors in the image as built
PASS: the shipped v2 definitions drive systemd-repart to completion (exit 0) on an 8G medium
PASS: DATA actually GREW: 131072 -> 14217176 sectors (64 MiB -> 6941 MiB). /srv scales with the medium
PASS: the growing run left LBA 64 intact — growth and loader protection hold together, not one at the cost of the other
PASS: the negative case has something to remove: 2 shipped definition(s) carry SizeMinBytes=0
PASS: with SizeMinBytes=0 removed the SAME run refuses (exit 1) and DATA stays at 131072 sectors — the defect is real,
      the fix is what closes it, and this check can fire: Can't fit requested partitions into available free space (6.7G), refusing.
```

### What could NOT be asserted

- **Nothing on hardware.** No radio, no association, no DHCP lease, no SSH
  login. Every assertion reads a packed artifact or a source file.
- **That mosd's first boot actually seeds `access.ssh.enabled` from this file.**
  The verifier proves the image and mosd agree about the path, the key and the
  value, and that the static enablement matches. The seeding itself is
  `provisioning.rs`'s own unit tests plus a real boot.
- **That `/etc/wpa_supplicant` is writable at runtime**, only that it is a
  STATE-backed bind that is enabled and whose source the seed script creates.
  Whether the mount actually comes up is a boot-time fact.
- **v1 cannot assert STATE backing at all** — it has no STATE partition. It
  asserts what is true there instead.
- **The build-time gate that rejects a statically enabled template** was not
  negative-tested: the v2 broken build removed that gate along with the masking
  block it lives in, so the run demonstrated the verifier catching it rather
  than the build. The verifier is the guard that ships.
