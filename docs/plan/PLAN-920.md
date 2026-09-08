# PLAN-920 Build a booted-board runtime acceptance suite

- **status**: completed
- **createdAt**: 2026-09-01 04:54 UTC
- **approvedAt**: 2026-09-01 06:53 UTC
- **completedAt**: 2026-09-01 07:26 UTC
- **relatedTask**: RFCT-938

## Context

`os/verify` is a Bun/TypeScript image-contract suite. Its `--verify` runner
reads an assembled image and deliberately never runs on a device. It shares a
single runner, structured check register, `PASS:` / `FAIL:` / `SKIP:` lines,
and a non-vacuous `RESULT:` convention with the rest of `os/`.

The existing `os/tests/hardware-smoke.sh` is a host-side Bash SSH probe with a
fake-SSH negative harness. It already proves the narrow PLAN-911 M1/M2/M3/M5
runtime paths: time synchronization, logind registration, default bridge
networking, and an interactive default-cgroup Podman start. It does not cover
the later campaign findings: stable board identity, deployed-image identity,
A/B observability, reboot persistence, MQTT, or the shipped wireless path.

The original campaign records are now branch-owned RFCT-913 through RFCT-934:
RFCT-914 (time), RFCT-915 (logind), RFCT-916 (netavark kernel surface),
RFCT-917 (crun systemd support), RFCT-930 (A/B boot script), RFCT-932 (MQTT
reference application), RFCT-934 (watchdog proof), and RFCT-937 (wireless
instrument correction). PLAN-910 and PLAN-911 hold the supporting hardware
observations.

The direct-host property remains necessary: caller SSH keys and host-key policy
must not be copied into a verifier container. This is compatible with placing a
new runtime mode in `os/verify`; its process still runs on the caller's host.

### Read-only board findings

The current booted board identifies itself as `mos-7f600267`; `/etc/hostname`
is a bind from the `state` filesystem rather than an IP-derived name. Its root
is `/dev/dm-0` over `mmcblk0p7`, `rauc status --output-format=json` reports
booted slot A and both rootfs/boot slot pairs, and the live U-Boot environment
reports `BOOT_ORDER=A B` with both credits present. Both redundant U-Boot
environment partitions contain non-zero bytes. `mos-health.service` is the
expected completed oneshot (`Result=success`, exit status zero), not an active
daemon.

The board's mounted active boot slot supplies an `Image`, DTB, and `boot.scr`.
The current local `s905x5m-mos-v2-sd-latest.img` has a different `Image` and
does not carry that `boot.scr`. A runtime checker must therefore require the
operator to name the exact deployed image; silently choosing a local `latest`
would make a stale-artifact comparison look authoritative.

`mos-mqtt-broker`, `mos-mqttd`, and the selected reference application are
currently active. The current bridge invocation logs only its read filter.
`wpa_cli` is delivered while `iw` is absent with exit 127, as RFCT-937
recorded. The DRM HDMI connector is connected and advertises `1080p60hz`.

The existing `emmc-probe` Quadlet is generated from the STATE-backed Quadlet
directory and owns a named volume with `heartbeat.log`. It will be reused, not
removed. A reboot check can prove persistence by retaining the pre-reboot byte
prefix of that file and requiring it to remain intact before a new heartbeat is
appended.

## Proposal

Add `--runtime HOST` as an `os/verify` mode, rather than a sibling package or
another shell harness. It reuses the package's TypeScript tests, result
vocabulary, refusal of empty conclusions, and `run.sh` mode dispatch without
turning a live-board probe into an image-container operation. This does not
contradict PLAN-911's direct-host boundary: the new mode will invoke the
caller's `ssh` on the host, honor its configured key and host-key policy, and
will explicitly refuse the Bun-container fallback because that container cannot
safely inherit those credentials or the private-board route.

The first register is intentionally scoped to the campaign's `s905x5m` U-Boot
A/B layout. It will refuse another board name rather than assuming that another
storage layout has this board's redundant uenv partitions.

The invocation will require a transport host, board, expected hostname, and
exact deployed image:

```text
bash os/verify/run.sh --runtime HOST --board s905x5m \
  --expect-hostname mos-7f600267 --image /path/to/deployed.img
```

`HOST` is only transport. The check will fail when the returned hostname or
STATE identity does not match the supplied identity, so an address change cannot
silently retarget the acceptance record. The active boot slot selects the
corresponding local boot partition; the checker compares its kernel bytes and
release to the live booted slot and live `uname`, rather than comparing against
whatever image happens to be newest in `_out/`.

Implement a typed remote snapshot and a narrow SSH transport. The remote probe
will emit only values needed for decisions and will preserve each command's
exit status. It will never stream a settings document, environment, Wi-Fi
configuration, or credential file back to the caller. In particular, a command
that exits 127 is a named failure, never an empty result.

The default mode is read-only and covers these checks:

| Group | Runtime assertion |
|---|---|
| Identity and boot | Expected hostname plus STATE bind; `dm-0` root and its backing partition agree with the booted RAUC slot; active boot `Image` and kernel release match the named image. |
| Display | The production HDMI boot arguments are present; with `--expect-hdmi`, DRM reports a connected HDMI connector and expected mode. |
| Time | `NTPSynchronized=yes` and the board clock is within an explicit bounded skew of the caller clock, which catches the fixed build-date reset. |
| A/B | `fw_printenv` succeeds; `BOOT_ORDER` and both credits are valid; both uenv partitions are non-zero; RAUC JSON lists two slots with exactly one activated/booted slot; `mos-health` completed successfully. |
| Containers | The parsed `container.enabled` value agrees with the actual STATE-backed Quadlet mount. |
| MQTT | When `mqtt.enabled`, broker and bridge are active; the current bridge invocation in read-only mode records only `R/<deviceId>/#` subscriptions. |
| Wireless | When the station role is enabled, `wpa_cli` reports an associated `COMPLETED` state for its configured interface. No check invokes `iw`. |

Active probes are deliberately opt-in and print their intended action before
starting:

- `--allow-container-probes` creates and removes uniquely named transient
  Podman containers. It proves default bridge address, route and TCP egress,
  plus an interactive default invocation with neither network nor cgroup
  override. It requires the cached `docker.io/library/alpine:3.22` probe image
  and fails rather than pulling one during an acceptance run.
- `--allow-mqtt-probe` opens an SSH `-W` stream to the loopback broker and uses
  a small typed MQTT 3.1.1 client. It sends a non-retained read keepalive only.
  When the reference application is selected, it requires an item tree, the
  device-wide heartbeat topic, and exactly one device-wide full-publish
  completion topic for that keepalive.
- `--allow-wifi-association --wifi-interface IFACE` starts a private,
  temporary shipped `wpa_supplicant -Dnl80211` on the named interface and uses
  `wpa_cli` through its private `/run` control directory. It works even when
  mosd's normal station role is intentionally off. `MOS_RUNTIME_WIFI_SSID` and
  `MOS_RUNTIME_WIFI_PSK`, or a mode-0600 local credentials file, are accepted
  into memory and sent only over SSH stdin. Neither value is placed in an argv,
  log, result, fixture, or record. The exact temporary process and `/run` files
  are removed, and `save_config` is never called.
- `--reboot` says that it will request one normal reboot, waits for the expected
  hostname to return, and repeats time, A/B, and health observations. A correct
  post-reboot clock is required, not merely a correct clock before it.
  `--quadlet-persistence emmc-probe` is valid only with this flag and reuses the
  existing probe/volume; it neither creates nor deletes a Quadlet.

Any active group omitted for safety prints a named `SKIP:`. Like the image
verifier, a default read-only run can pass only its asserted checks, while the
skipped actions remain visible on the `RESULT:` line; an empty or malformed
runtime register is always a failure. No mode writes an eMMC boot area or
`bootloader_a`; no mode changes a slot. The destructive watchdog test remains
RFCT-934-only and is never automated here.

Replace the duplicated shell hardware-smoke path after feature parity: retain
the Make target name as a compatibility alias to `os/verify --runtime`, add a
clear `os-runtime-acceptance` target, and move its fake-SSH negative coverage
into the Bun test suite.

### Failure-direction evidence

| Checks | Demonstration method |
|---|---|
| SSH/hostname/STATE/root/slot/image/kernel/display/time | Typed snapshot fixtures mutate one fact at a time: wrong hostname, wrong STATE source, wrong dm slave or RAUC slot, mismatched image hash/release, absent display argument/connector/mode, `NTPSynchronized=no`, excessive skew, and a post-reboot build-date reset. |
| U-Boot/RAUC/health | Typed fact fixtures make `fw_printenv` exit 243, omit or corrupt each required variable, report all-zero uenv data, omit an RAUC slot or activated slot, and report an unfinished health unit. |
| Quadlet and Podman | Typed facts drive mount/switch disagreement, netavark setup failure, non-bridge mode, missing address/route/egress, cgroupfs default, and crun's `systemd not supported` result. The static active-probe fixture also proves the interactive call has no forbidden network or cgroup-manager override. |
| Quadlet persistence | Constructed before/after volume snapshots cover lost prefix, no post-reboot heartbeat, and wrong generated unit. A real reboot remains an explicitly gated hardware execution. |
| MQTT | Constructed service/filter facts and scripted MQTT packet observations drive inactive units, a write or foreign subscription filter, missing item publications, duplicate completion, and non-device-wide heartbeat/completion topics. The wire client is exercised without a real broker. |
| Wireless | Scripted `wpa_cli`/`wpa_supplicant` output covers disconnected state, malformed status, and exit 127. The last case must name the missing command rather than treating stderr suppression as empty Wi-Fi output. A constructed active result proves the private association row rejects failure even while mosd station mode is off. Real RF association remains hardware-gated. |

### Per-row evidence register

`runtime.test.ts` asserts that this complete list is equal to the implemented
register and supplies a false construction for every row. The method column is
the additional, more specific proof where a row initiates an active operation.

| Runtime row | Failure-direction method |
|---|---|
| `identity.hostname-state` | fixture: wrong hostname or non-STATE bind |
| `boot.root-slot` | fixture: slot/root/backing-partition disagreement |
| `boot.deployed-kernel` | fixture: named-image hash or release mismatch |
| `display.boot-arguments` | fixture: missing required Amlogic argument |
| `display.connector` | fixture: disconnected connector or missing mode; visible pixels remain hardware-only |
| `time.ntp-and-clock` | fixture: `NTPSynchronized=no`, fixed-past epoch, or excessive skew |
| `time.after-reboot` | fixture: unchanged boot ID or fixed-past post-reboot clock; real reboot is opt-in hardware |
| `ab.fw-printenv` | fixture: exit 243 or missing order/credit |
| `ab.redundant-uenv` | fixture: all-zero A or B result |
| `ab.rauc-status` | fixture: malformed/missing slot or activated-root disagreement |
| `ab.mos-health` | fixture: non-success oneshot result/status |
| `logind.ssh-session` | fixture: zero sessions or non-session cgroup |
| `containers.quadlet-state` | fixture: enabled-setting / STATE-mount disagreement |
| `containers.default-bridge` | construction: failed probe fact plus static assertion of no network override; live run is opt-in |
| `containers.interactive-default-cgroup` | construction: crun failure fact plus static assertion of no cgroup override; live run is opt-in |
| `containers.quadlet-persistence` | construction: lost volume prefix or stalled heartbeat; real reboot is opt-in hardware |
| `mqtt.services` | fixture: inactive broker or bridge while enabled |
| `mqtt.read-only-filter` | fixture: full/write or foreign subscription filter |
| `mqtt.reference-application` | fixture: selected-but-inactive reference service |
| `mqtt.reference-publication` | construction: incomplete scripted packet set, retained heartbeat, or wrong completion count; live broker run is opt-in |
| `wireless.wpa-cli` | fixture: exit 127, preserving the missing-command status |
| `wireless.association` | fixture: non-`COMPLETED` wpa_supplicant state |
| `wireless.explicit-association` | construction: failed private-probe fact; real access-point association is opt-in hardware |

The physical fact that a monitor emitted visible pixels cannot be established by
software alone; the runtime suite can prove the boot arguments and DRM
connector/mode contract, while a connected display is required for the final
light-output observation. Likewise, actual RF association and a real reboot
are not faked as hardware claims; fixtures prove the checker can reject their
reported bad states, and the opt-in live paths supply the hardware evidence.

## Risks

- The direct-host mode needs a host Bun installation. Falling back to a Bun
  container would weaken the SSH credential/route boundary, so it will refuse
  with an actionable error instead.
- A normal reboot decrements a boot credit before `mos-health` refills it. The
  reboot path therefore observes and validates the ordinary health handshake;
  it never suppresses the health gate, modifies environment credits, or forces
  a slot.
- Transient container, MQTT, and Wi-Fi probes have observable runtime effects.
  Their separate opt-in flags avoid making a nominal read-only acceptance run
  change board state. Cleanup failures are failures, not ignored leftovers.
- The selected image must be the one deployed. Requiring `--image` prevents a
  stale local artifact from creating a false mismatch or false pass.
- A broker configured to require credentials or a Wi-Fi interface already
  owned by a service needs the operator's explicit secret/interface contract;
  the suite will refuse or skip with the reason rather than expose a secret or
  disrupt an existing association.

## Scope

In scope: new TypeScript runtime transport, check register, CLI, fixtures and
unit tests under `os/verify/src`; `os/verify/run.sh`, README/HARNESS and Make
targets; retirement or delegation of the duplicate shell hardware-smoke entry;
and RFCT-938 / PLAN-920 tracking updates.

Out of scope: building or deploying an image, changing board settings,
installing Wi-Fi tools, changing the MQTT reference application, modifying
Quadlet content, flashing eMMC, writing eMMC boot areas or `bootloader_a`,
changing slots, and RFCT-934's destructive watchdog test.

## Alternatives

- **Sibling runtime package or another shell script:** rejected. It would
  duplicate `os/verify`'s runner/output/failure semantics and leave two paths
  to maintain. A direct-host `--runtime` mode keeps the needed SSH boundary
  without claiming the device probe is image verification.
- **Default to `_out/<board>/*-latest.img`:** rejected. The live read showed
  that local latest can be a different deployment; an exact image is evidence,
  a convenient filename is not.
- **Use `iw` for wireless status:** rejected. It is intentionally absent from
  the shipped image, and RFCT-937 proved that swallowing its exit 127 produces
  fictional empty results. `wpa_supplicant` and `wpa_cli` are the shipped
  station control path.
- **Create a fresh Quadlet persistence probe:** rejected. Reusing the existing
  `emmc-probe` avoids adding or removing userland and directly proves the
  installed volume's reboot behavior.

## Annotations

(User annotations and responses. Keep all history.)

- Approved on 2026-09-01. The implementation remained confined to the runtime
  verifier and its local documentation/tests; it did not build, deploy, or
  mutate a board image.
- Completed on 2026-09-01. The default board run collected read-only facts
  only. The owner-installed `emmc-probe` is reused by design for the opt-in
  reboot persistence assertion and was neither removed nor rewritten.

## Implementation

- Added the `--runtime HOST` mode to `os/verify/run.sh`, with a direct-host
  SSH collector, a typed 23-row s905x5m register, `PASS:` / `FAIL:` / `SKIP:`
  output, and a non-vacuous `RESULT:` line. It rejects the Bun-container route,
  requires a named deployed image, and uses hostname plus the STATE bind—not an
  address—as identity.
- Added host-only boot-image inspection, command-status-preserving facts, and
  checks for time, slot/root/kernel identity, display setup, U-Boot/RAUC/health,
  logind, STATE-backed Quadlets, MQTT, and shipped wireless control paths.
- Added opt-in actions for transient default-bridge/interactive Podman probes,
  a local-broker MQTT keepalive observer, a private temporary
  `wpa_supplicant` association on an explicit interface, and reboot/persistence
  proof using the existing `emmc-probe`. No action can write an eMMC boot area,
  `bootloader_a`, or a RAUC slot.
- Replaced the duplicate shell hardware-smoke implementation with a compatible
  wrapper and Make aliases pointing to the one runtime mode.

## Verification

- `make os-hardware-smoke-test`: 21 pass, 0 fail. Its constructed snapshots
  make every register row fail; additional constructions cover the historical
  fixed-past clock, `fw_printenv` exit 243, netavark FIB failure, and crun
  systemd-support failure.
- `sudo -n env PATH="$PATH" bash os/verify/run.sh`: 1137 pass, 0 fail.
  The ordinary unprivileged full run cannot seed the repository's pre-existing
  root-owned packed-root fixture; the root-capable run is the intended complete
  fixture environment.
- A read-only run against `192.168.27.62` with expected hostname
  `mos-7f600267` passed 15 asserted board checks and named 7 opt-in skips. It
  intentionally failed the named-image row because the local `latest` image
  does not equal the deployed kernel bytes; no latest-artifact substitution was
  made. No reboot, container, MQTT keepalive, Wi-Fi association, slot, or boot
  area action was executed.
- A separate read-only `emmc-probe` preflight confirmed the expected active
  unit and named-volume heartbeat are available for a future explicitly gated
  persistence reboot. It did not create, remove, or rewrite that probe.
