# 20260910-0350-cx3576-latest-boot-review Analyze the latest CX3576 boot log

- **status**: completed
- **priority**: P1
- **owner**: worker/tio-review-20260910
- **createdAt**: 2026-09-10 03:50

## Description

Analyze `_out/tio.log`, bind the observed boot to delivered components, and
prioritize remaining failures against the existing boot-log cleanup proposal.
This task delivers evidence and repair recommendations; it does not implement
the separately owned cleanup plan or mark physical acceptance complete.

## ActiveForm

Completed the component-bound log assessment and prioritized repair recommendations.

## Dependencies

- **blocked by**: (none for log analysis)
- **blocks**: (none)

## Notes

- Input: 95,919 bytes, 1,384 lines; SHA-256
  `f614fb0c15e5263a2f3262b65cefcd3d6305d2544dcacc0b684c452e73adab8f`.
- The source tree was clean at the start, at `d64b23a7`.
- Record this new evidence independently of the existing cleanup task owner.
- Relevant proposal: [boot-log cleanup](../plan/20260910-0029-cx3576-boot-log-cleanup.md).
- The user has been asked for the rfkill/regdb service journals; serial-only
  observations must not be presented as complete service error diagnostics.

## Artifact identity and boot result

The log selects deployment
`2ea26ab97532cc841ad810d16b6dc2d52f9e8b2ba8b4f413b772c07e463d4a98`
(lines 90 and 926). This is generation 8 in the integrated image
`_out/cx3576-integrated-20260910/image/mos-cx3576-20260910-030308.img`.
Its decoded, canonical signed payload has that SHA-256 and names kernel
`5d85c3ebe6874aa87d820f35a3653776372a4e79c18f4e333fec4da35c35e7cc`
and root `f43688c5c345c3ef3e570498d6163e135e35e1770a1f5dbbcdb84da6e82b4409`.
The logged kernel, DTB and initramfs hashes each match the delivered artifacts:

- Kernel: `c3953f7a7ab0a2ab181d20fdc568b341d7481bab7653eaea101a52d38ee25fcc`.
- DTB: `83b0c364f7824b4abd424371250613f53c3cb51b75f66d8e7bb0fad9b6d3b6e2`.
- Initramfs: `56e760118410f33ced8632f1dec7ba50a9c03554b77aa99e511230fd8627192c`.

This establishes the executed component baseline, not complete flash readback.
The log contains one boot, no kernel panic/Oops, and these positive observations:

- Native one-second U-Boot countdown and required FIT signature verification
  (87-90, 93 and subsequent FIT sections).
- Firmware watchdog armed; `mos-init` reopens it; systemd takes over at 90 seconds
  (81, 89, 924, 965-966). Actual expiry/reset and prolonged servicing are untested.
- Verified root/support handoff and persistent DATA identity (926-948).
- HDMI is connected in this capture: 1920x1080p60 mode, locked PHY and fb0
  registration (800-819). The repaired logo/cursor arguments are active (176).
  These messages do not independently establish the final visible artwork.
- mosd and apid start, multi-user/graphical targets are reached, mos-health and
  the ready-state LED service finish (1371-1379). A serial login prompt follows.

`mos-health` deliberately confirms recoverable deployments after its required
management/API probes and reports other failed units as degraded. Its completion
therefore does not contradict the two failed radio-related services below.
See `rootfs/overlay/usr/lib/mos/mos-health:205` and `etc/mos/health.conf`.

## P1: systemd-rfkill state storage is missing

**Observed:** six service-failure messages at log lines 1211, 1221, 1239, 1262, 1267
and 1269, after the hardware-driven rfkill socket appears. Radio device discovery
is working; the persistence service repeatedly fails.

**Confirmed artifact defect:** the shipped Debian unit declares
`StateDirectory=systemd/rfkill` and `DefaultDependencies=no`. The actual signed
root image contains neither `/var/lib/systemd/rfkill` nor an rfkill-specific DATA
mount/drop-in. The immutable root cannot supply a newly created writable state
leaf. `mos-seed-state` and the system package's mount list also omit rfkill.
The earlier writable-path audit already reproduced exit 238 for this missing
StateDirectory; the current board's precise exit status is absent from the
serial capture and still needs its journal.

**Repair:** package the immutable mountpoint, seed a dedicated DATA state
subdirectory, mount it at `/var/lib/systemd/rfkill`, and explicitly order the
socket-activated service after that state is available. Verify first startup
with real rfkill devices and saved/restored radio state across reboot. Do not
make all of `/var/lib/systemd` writable or mask the service merely to clear red
status. Reuse the existing leaf-mount pattern and add a focused regression.

## P1: packaged regulatory database uses the wrong signing authority

**Observed:** built-in cfg80211 cannot find regulatory.db before userspace
(904-905); the later `mos-regdb-reload.service` fails (1319). The early ENOENT
alone is expected for a database carried in the later-mounted support image;
the failed reload leaves the intended recovery incomplete.

**Confirmed artifact defect:** both database files exist in the actual signed
support image, and the root contains the expected unit and `/usr/sbin/iw`.
`build/src/kernel-package.ts:79` explicitly copies the `-debian` pair from the
pinned wireless-regdb package. Its PKCS#7 signer is `CN=benh@debian.org`.
The running kernel requires signed regdb and loads the `sforshee` and `wens`
certificates (902-903), not that Debian certificate.

Read-only verification extracted the shipped database/signature and the two
certificates from the exact pinned kernel source. Signature mathematics pass,
but trust validation against those two kernel certificates fails:

```text
CMS Verification failure
Verify error: self-signed certificate
```

The same already-pinned Debian package also contains the `-upstream` database
and signature pair. That pair passes trust validation against the exact same
kernel certificate set (`CMS Verification successful`). This supplies a concrete
repair without a new dependency version or additional trust authority.

The pinned kernel's `reg_reload_regdb()` returns `-ENODATA` when signature or
format validation fails. This explains why the reload can fail without printing
the asynchronous boot-time malformed-database message. The board service journal
is still needed to establish its exact exit code; the trust mismatch is already
proven independently.

**Repair:** package the matching upstream pair and add an actual signed-database
verification gate against the kernel's regdb trust set. Rebuild and sign support,
FIT and dependent deployment metadata. Confirm reload success, `iw reg get`,
country application, association and traffic. Retain signature enforcement.

## Remaining board and configuration work

| Priority | Evidence in tio.log | Disposition |
|---|---|---|
| P2 | Orphan CSI/CIF sensor routes: 571-585, 721-725, 1169-1199 | Retire the unused EVB camera graph and dependent enabled routes together. Preserve shared accelerators and USB cameras. |
| P2 | No OP-TEE in BL31: 68-69; Linux UID mismatch/probe failure: 672-674 | Remove unused Linux OP-TEE declarations/options after checking SCMI consumers. Vendor BL31 diagnostics require a matching firmware configuration, not a Linux log-level change. |
| P2 | Zero-sized DRM logo/LUT reservations: 152-153; loader-memory parsing failure: 792 | Remove unused provider/consumer pairs while preserving the functioning Linux HDMI path. |
| P2 | GPU uppercase IRQ lookup errors: 822-824; successful mali0 probe: 861 | The pinned driver tries uppercase and then lowercase names; the compiled DT uses lowercase. Align board names with the driver's preferred form, preserving IRQ numbers/order. This is not evidence of a GPU probe failure. Disable the unrelated MALI400 driver, which also initializes at 912-914. |
| P2, functional qualification | NPU resource requests: 887-888; initialization continues at 889 | DT NPU windows cover 0x27700000-0x27707fff and 0x27708000-0x2770ffff; their IOMMU subregions lie inside these ranges. The pinned driver handles EBUSY with a nonexclusive mapping. Confirm live ownership in /proc/iomem and run checked inference before declaring a functional failure or changing ownership. |
| P2, functional qualification | Decoder reset resources/devfreq: 745-750; both encoder OPP/devfreq paths: 762-771 | Determine intentional fixed-rate behavior versus missing required resources, then run encode/decode/reset workloads. Completed probes do not prove usable media acceleration; do not invent voltage/OPP values to suppress errors. |
| P2 | Missing autofs4: 957 | Enable the supported AUTOFS_FS symbol and assert it in the resolved board config; validate the corresponding systemd automount surface. |
| P2/P3 | SELinux policy absent: 956; BPF LSM unavailable: 964 | The shared floor explicitly enables permissive SELinux, while the packaged root has no policy. BPF appears in the LSM list but CONFIG_BPF_LSM is disabled. Reconcile intentionally used security features and packaging; these diagnostics did not block this boot. |
| P3 | FIT Description unavailable: 95, 111, 128 | Add image/configuration descriptions in the producer and re-sign. Unavailable entry points for non-executable data images are expected. |
| P3 / verify consumers | CPU cache topology, optional IRQ/clock/regulator properties, SCMI 17/22, MTD vendor-storage deferral | Triage against actual board consumers. eMMC vendor storage already succeeds at 813; do not conflate the deferred MTD backend with failure of all vendor storage. |

GPU and NPU conclusions above refine the earlier proposal: both have explicit
source-level continuation paths, so the error wording alone must not be used to
claim dead hardware or justify disabling functional devices.

## Expected messages and qualification limits

- `watchdog did not stop!` at 950 occurs between the required watchdog opens;
  systemd takes over shortly afterward. This is consistent with NOWAYOUT.
- `tries left -1` is a confirmed deployment, not a negative remaining trial count.
- UEFI/DMI absence, skipped TPM/EFI units, disabled unused LCD supply and the
  reproducible 2020 build timestamp are not failures in this FIT boot.
- PCIe BARs are reassigned at 621-625 and the NIC registers. The initial invalid
  MAC is replaced by `mos-mac` before network configuration; this capture alone
  does not establish multi-boot stability, DHCP or working Ethernet traffic.
- AIC's `bus down` message precedes phy0 registration; Bluetooth later reaches
  its service/target. Verify association and a Bluetooth peer exchange rather
  than declaring either successful or broken from that intermediate message.
- DATA journal recovery completes at 944 without an ext4 error. Growth reports
  the same old/new size at 1136: DATA is already expanded in this capture. It is
  not evidence of this boot performing initial expansion. Repeated recovery
  after known clean shutdowns would need separate investigation.
- The last kernel timestamp is 38.370685 seconds. There is no 180-second stable
  capture, actual reboot/poweroff, power-cut test, watchdog expiry, network
  traffic or accelerator workload result. Physical P10 is not complete.
- The original initramfs archive is released at 361 (32828K). `mos-init` reports
  902 ms and 2280 KiB peak RSS at 949. Neither number is the retained exitrd's
  tmpfs allocation; BusyBox minimization remains a separate draft proposal.

## Recommended order

1. Fix the missing rfkill DATA state contract and the confirmed regdb signer
   mismatch. Extend first-boot/radio acceptance to cover both service results.
2. Apply the board/configuration/description cleanup, including camera graph,
   unused OP-TEE, DRM reservations, IRQ names, MALI400 and autofs. Resolve the
   shared SELinux/BPF configuration deliberately rather than silently broadening
   the board repair.
3. Qualify accelerator workloads, network/radio traffic and repeated clean
   startup/shutdown on a complete newly signed image. Preserve failure details
   and leave unavailable tests untested. Keep BusyBox size work separate.

## Sources and verification evidence

- Input and artifacts were inspected without touching a live device or changing
  implementation files. All investigation containers completed with --rm.
- Extracted units, root/support inventories, database/signatures and CMS results:
  `.tmp/tio-log-review-20260910/`.
- [Pinned regulatory loader](https://github.com/armbian/linux-rockchip/blob/c6157104418d012823413c02f9222f3fe123dd25/net/wireless/reg.c): separate regulatory trust keyring, signature check, synchronous reload return value.
- [Pinned GPU IRQ lookup](https://github.com/armbian/linux-rockchip/blob/c6157104418d012823413c02f9222f3fe123dd25/drivers/gpu/arm/bifrost/mali_kbase_core_linux.c): uppercase/lowercase lookup sequence.
- [Pinned NPU mapping](https://github.com/armbian/linux-rockchip/blob/c6157104418d012823413c02f9222f3fe123dd25/drivers/rknpu/rknpu_drv.c): EBUSY mapping continuation.
- Compiled DT: `.tmp/cx3576-integrated-20260910/inspection/resolved.dts`.
- This analysis does not alter the existing cleanup plan's owner, approval or
  completion status. No replacement image was built for this assessment.

- complete: Component-bound analysis and offline regdb trust checks completed; runtime implementation and board-specific journals remain separate.
