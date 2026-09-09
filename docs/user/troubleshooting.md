# Troubleshooting

Diagnosis on mos follows one order: get access, identify exactly what is
running, read the evidence the system already keeps, and only then act. This
page follows that order, and ends with the bounded, redacted snapshot that
carries that evidence into a support case.

## 1. Getting access

In order of preference:

1. **The API and built-in UI** — HTTPS to the device, `/_ui/`. Live network
   observation (carrier, addresses, DNS, routes per interface) is part of the
   API surface, which makes "the device thinks its network is X" readable
   without a shell.
2. **SSH** — off by default; an authenticated administrator enables it and
   installs a key through the API. Every authorized key is a root key. For an
   operator standing at a device with no key installed, the transient root
   password (set through the UI, valid until the next boot) is the intended
   one-session path.
3. **The serial console** — present on cx3576 (`ttyFIQ0`, 1500000 baud) and
   shows a login prompt, but no account accepts a credential until a transient
   root password has been set. It is primarily useful for *reading* the boot:
   firmware deployment decisions and kernel output appear there.

The full access model, including what each channel can and cannot do, is
[../design/access.md](../design/access.md).

> status: shipped — evidence: `docs/design/access.md`, `pkgs/mosd/apid/openapi.json`

> status: board-dependent — evidence: `boards/cx3576/board.env`

## 2. Identifying the device and release

`GET /api/v1/system/info` answers the device's identity in one authenticated
read: machine id, board model and the firmware source it was read from,
kernel release, the `os-release` fields, the system version carrying the
package pool's git stamp and the build date, the daemon's own version, the
installed package set, the running signed deployment with its component identities and boot
status, and uptime. Every member says whether it was available and, when it
was not, why — a package manifest whose mos rows disagree reports the
disagreement and every stamp it found rather than picking one. Quote that read
in every support case.

`GET /api/v1/system/telemetry` adds the board's thermal zones, watchdog
devices and a reset reason classified from generic kernel evidence;
`GET /api/v1/network/status` adds what networkd, wpa_supplicant and resolved
observe right now, which is the answer to "the device thinks its network is
X". In a shell, `/usr/share/mos/manifest.tsv` is the same bill of materials
the API reads, and `hostnamectl` gives the hostname (which encodes the first
eight hex characters of the device id) and the machine id.

**Hardware-dependent, and unvalidated.** What the thermal, watchdog and
reset-cause adapters report has been proven against fixture trees, not against
the cx3576 or x64 boards. An absent or implausible reading there is an
escalation carrying the board identity, never a green result.

> status: shipped — evidence: `docs/design/diagnostics.md`, `pkgs/mosd/apid/openapi.json`

## 3. Reading the evidence

- **Service state:** `systemctl status <unit>`, `systemctl is-system-running`,
  and `journalctl -u <unit>`. The journal is volatile — it does not survive a
  reboot, so capture it before power-cycling a sick device.
- **Boot health:** the health gate logs its required set, each member's
  verdict, and every failed unit it saw (`journalctl -u mos-health`). A slot
  that keeps rolling back after an update failed one of the required members —
  the boot transaction settling, mosd answering, or apid listening — and the
  log names which. A failed unit on its own does **not** roll a slot back; it
  is reported at live-state `health.units` and read with `GET
  /api/v1/state/health` or out of a diagnostic snapshot. What the gate requires
  is `/etc/mos/health.conf`, inside the read-only root.
- **Update state:** `mos-deploy status` reports current/candidate/fallback
  deployments, attempt state, component verification and failed deployments.
  Capture `GET /api/v1/update` for the management view as well.

- **Containers:** the failure table in
  [../design/containers.md](../design/containers.md) covers the common cases —
  unit missing after adding a file (`systemctl daemon-reload`; the Quadlet
  generator's `--dryrun` prints parse errors), unit never starting (no
  `[Install]` section), names not resolving (not on the same network),
  storage full (`podman system df`).
- **Configuration writes:** a settings write returns a task; its outcome
  (applied, unchanged, failed and why) is observable through the API rather
  than guessed from behaviour.

> status: shipped — evidence: `rootfs/overlay/usr/lib/mos/mos-health`, `docs/design/containers.md`, `pkgs/mosd/apid/openapi.json`

## 4. When a normal command is missing or broken

The image carries one emergency binary, `/usr/bin/busybox`, and it changes
nothing else: there are no applet links anywhere in the image, no PATH entry was
added, and every GNU command resolves exactly where it did before. Reach an
applet by naming it —

```sh
busybox sh
busybox ls -l /mos
busybox mount
busybox --list          # every applet this build offers
```

— and that is the whole interface. If a repair genuinely needs the applets to
look like ordinary commands (a script that calls `ls` when coreutils is the
thing that is broken), create the links **transiently** and put only that
directory on that one shell's PATH:

```sh
mkdir -p /run/mos-toolbox
busybox --install -s /run/mos-toolbox
PATH=/run/mos-toolbox:$PATH busybox sh
```

`/run` is tmpfs, so the links are gone at the next boot and nothing outside that
shell ever sees them.

**Never build a persistent link farm.** The root is a read-only dm-verity
squashfs, so writing one into `/usr/bin` fails anyway; it is refused where it
would succeed because an applet name in PATH silently re-decides what `ls`,
`tar`, `mount` and `sh` mean for every script on the device, and BusyBox applets
take fewer options and differ in behaviour from their GNU counterparts.

**Diagnostic only, and not a rescue environment.** These applets are not a
supported command API: no unit, script or automation on the device may depend on
them, and the image verification asserts that none does. The binary is
dynamically linked against the same libc as everything else, so a system damaged
badly enough to lose `/lib` has lost this too — at that point the answer is
[recovery.md](recovery.md), not a shell.

> status: shipped — evidence: `rootfs/packages-src/busybox`, `verify/src/checks-busybox.ts`, `docs/design/recovery.md`

## 5. Reading build and verify refusals

A field operator meets the build system in two places: producing a bench image
and verifying a flashed one. mos tooling refuses loudly and by name instead of
degrading, so the refusal text is the diagnosis:

- A missing or stale package pool, a missing BSP artifact, or a pool built
  from a different commit each name the exact `make` target to run; the
  build-failure table in [../design/build.md](../design/build.md) maps the
  common messages to actions.
- `make os-verify` (and the x64 equivalent) checks an assembled image
  against the image contract check by check; a red check names what it read
  and what it expected. An image built on a generated trust root verifies like
  any other; the keyring check states which grade of material it read, and that
  sentence is what to quote when the grade is not the one expected.

The rule of thumb: a mos refusal is designed to be quoted verbatim to support
or into an issue; do not work around it, because the checks exist to stop
artifacts that pass everything and fail on hardware.

> status: shipped — evidence: `docs/design/build.md`, `make os-verify`

## 6. The support snapshot

`POST /api/v1/diagnostics/snapshots` collects one bounded, redacted JSON
document — release and system information, boot and update state, this boot's
warning-and-worse journal excerpt, failed units and tasks, storage and time
status, telemetry and the observed network — and `GET
/api/v1/diagnostics/snapshots/{id}` downloads it as an attachment. The
built-in UI's diagnostics panel does the same two steps.

What to know before attaching one to a case:

- **It is bounded, and it says where it was cut.** Collection stops at 20
  seconds and each source at 6; a source that did not answer is present as an
  absent object carrying its reason. Read the collection result first: an
  unavailable section is evidence, not a check that passed.
- **Redaction is a tested boundary.** Credentials, tokens, private keys, Wi-Fi
  secrets, SSIDs, MAC and BSS addresses and the hostname in journal lines are
  dropped or replaced by a sentinel, and nothing under `/srv` or `/home` is
  read at all. IP addresses, routes, DNS servers and the machine id are kept
  deliberately — they are the evidence the snapshot exists to carry — so an
  exported file still identifies the device and its network. Handle it
  accordingly.
- **The device never uploads it.** Export is a download by an authenticated
  client, and collection needs no upstream connectivity. The store keeps at
  most 8 snapshots and 16 MiB, dropping the oldest first, and has no
  time-based expiry: delete one when its case closes.
- **A second collection while one is running is refused**, not queued.

The design record carries the decision trees this page's order implies — no
network, wrong time, DATA full, a failed update or rollback, an unexpected
reboot — each branching on the snapshot member that decides it.

> status: shipped — evidence: `docs/design/diagnostics.md`, `pkgs/mosd/apid/openapi.json`

## 7. When to stop diagnosing

A device in a reboot loop with all deployments exhausted, or one whose credentials
are lost, is past troubleshooting: go to [recovery.md](recovery.md), and
capture what evidence you can first.
