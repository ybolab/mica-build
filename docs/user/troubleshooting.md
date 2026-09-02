# Troubleshooting

Diagnosis on mos follows one order: get access, identify exactly what is
running, read the evidence the system already keeps, and only then act. This
page follows that order, and ends with the honest state of the diagnostic
surfaces that do not exist yet.

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
   U-Boot's slot decisions and kernel output appear there.

The full access model, including what each channel can and cannot do, is
[../design/access.md](../design/access.md).

> status: shipped — evidence: `docs/design/access.md`, `pkgs/mosd/apid/openapi.json`

> status: board-dependent — evidence: `boards/cx3576/board.env`

## 2. Identifying the device and release

`/usr/share/mos/manifest.tsv` inside the image lists every installed package
with its version, plus the package pool's git stamp — quote it in every
support case. `hostnamectl` gives the device's hostname (which encodes the
first eight hex characters of the device id) and machine id.

A single aggregated system-information surface (board, image version, kernel,
build date, package set in one API read) is planned, not shipped.

> status: shipped — evidence: `rootfs/compose/90-pack.Dockerfile`

## 3. Reading the evidence

- **Service state:** `systemctl status <unit>`, `systemctl is-system-running`,
  and `journalctl -u <unit>`. The journal is volatile — it does not survive a
  reboot, so capture it before power-cycling a sick device.
- **Boot health:** the health gate logs each probe and its verdict
  (`journalctl -u mos-health`). A slot that keeps rolling back after an
  update failed one of: systemd settling, mosd answering, or apid listening —
  the log names which. A unit you have judged acceptable can be tolerated via
  `/etc/mos/health.conf`.
- **Update state:** RAUC's slot status (booted slot, per-slot state, last
  install error) is readable through the management daemon's state and with
  `rauc status` in a shell.
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

## 4. Reading build and verify refusals

A field operator meets the build system in two places: producing a bench image
and verifying a flashed one. mos tooling refuses loudly and by name instead of
degrading, so the refusal text is the diagnosis:

- A missing or stale package pool, a missing BSP artifact, or a pool built
  from a different commit each name the exact `make` target to run; the
  build-failure table in [../design/build.md](../design/build.md) maps the
  common messages to actions.
- `make os-verify-cx3576` (and the x64 equivalent) checks an assembled image
  against the image contract check by check; a red check names what it read
  and what it expected. A development-keyring image needs
  `MOS_EXPECT_DEV_KEYRING=1` to verify — that is a bench waiver, and its
  absence on an unexpected image is itself a finding.

The rule of thumb: a mos refusal is designed to be quoted verbatim to support
or into an issue; do not work around it, because the checks exist to stop
artifacts that pass everything and fail on hardware.

> status: shipped — evidence: `docs/design/build.md`, `make os-verify-cx3576`

## 5. What does not exist yet

There is no bounded, redacted support bundle to export, no troubleshooting
decision tree in the UI, and no aggregated diagnostics surface (storage
health, thermal, watchdog, reset cause). The diagnostics plan adds those, plus
the one-read system-information surface of section 2.

> status: proposed — evidence: `docs/plan/PLAN-052.md`

TODO(PLAN-052): revisit after this plan merges

## 6. When to stop diagnosing

A device in a reboot loop with both slots exhausted, or one whose credentials
are lost, is past troubleshooting: go to [recovery.md](recovery.md), and
capture what evidence you can first.
