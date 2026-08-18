# RFCT-015 Health gate + machine-id oneshot (PLAN-010 M4)

- **status**: implementation complete — pending integration with RFCT-013/RFCT-014
  and user hardware acceptance
- **priority**: P1
- **owner**: ai-agent
- **createdAt**: 2026-08-18 03:39
- **claimedAt**: 2026-08-18 03:39
- **completedAt**: -

## Description

The Linux side of the PLAN-006 Part E `PENDING_CONFIRM -> CONFIRMED` edge, plus
the first-boot machine-id persistence the read-only root needs.

Two board-agnostic oneshots live in `os/health/`, mirroring the `os/hwinit/`
pattern (a plain POSIX `sh` executable installed to `/usr/lib/mos`, plus its
`.service`):

1. `mos-health` / `mos-health.service` — probes the system and, only on a clean
   result, confirms the booted A/B slot with `rauc status mark-good`.
2. `mos-machine-id` / `mos-machine-id.service` — generates the device machine id
   once and stores it in the redundant U-Boot environment with
   `fw_setenv machine_id <32 hex>`.

Both are staged into the v2 rootfs, enabled, through the `os/rootfs/overlay-v2`
mirror tree.

### State-machine mapping (PLAN-006 Part E)

| Code path | Transition |
|---|---|
| `mos-health` gate 0: `rauc` absent, or no `RAUC_SYSTEM_BOOTED_SLOT` | not in the state machine — v1 image or container, exit 0 |
| `mos-health` probes a/b/c all clean, then `rauc status mark-good` | `PENDING_CONFIRM -> CONFIRMED` |
| `mos-health` any probe fails: log, exit non-zero, no side effect | stays in `PENDING_CONFIRM`; U-Boot `BOOT_x_LEFT` decrements on the next boot |
| `mos-health` re-run on a confirmed slot | `CONFIRMED -> CONFIRMED` (mark-good is idempotent) |
| `mos-machine-id` | outside Part E; device identity for the read-only root |

Not implemented here, by design: the `PENDING_CONFIRM -> ROLLED_BACK` edge. That
belongs to U-Boot's `BOOT_x_LEFT` counter (PLAN-006 Part F). The health gate
deliberately performs **no** remediation — no reboot, no slot flip, no counter
write — because taking the rollback decision away from the bootloader would
break the power-loss guarantee that the counter provides.

### The health probes

Ordered, each bounded by `probe-timeout-sec` (default 10s) via `timeout`:

- **a. systemd.** Polls `systemctl is-system-running` until it leaves
  `initializing`/`starting`, bounded by `settle-sec` (default 60s). `running`
  passes. `degraded` passes only if every unit in
  `systemctl list-units --state=failed` appears in the `tolerate-failed=`
  allowlist; a failed unit outside the allowlist is a health FAILURE. Any other
  state (`maintenance`, `stopping`, `offline`, `unknown`) is a FAILURE.
- **b. mosd.** `busctl --system call com.mos.mosd /com/mos/mosd com.mos.mosd1
  GetState s ""` — the cheapest call that already exists on the interface. No new
  ping/health method was needed for reachability. Skipped when `mosd.service` is
  not installed.
- **c. webd.** `curl -k -f https://127.0.0.1/healthz` (or `wget` when curl is
  absent) against webd's existing endpoint, which bypasses its auth gate. `-k`
  because webd serves a self-signed certificate. Skipped when `webd.service` is
  not installed or when the image ships neither client — no new HTTP surface was
  invented.

### /var pressure is reported, never fatal

Under the ten-partition layout, `/var` (p9 `ephemeral`, fixed 512 MiB) is
**disposable runtime residue**: STATE is configuration and identity, DATA
(`/srv`, p10) is application data, `/var` is neither. The gate therefore reads
`df -P /var` and reports the result to mosd, but **never fails mark-good on
`/var` pressure**. A log flood must not turn a cosmetic problem into a reverted
release. This is a standing criterion, not a tuning knob: do not "tighten" it
later into a fatal check.

The gate also does not look at `/srv` at all. A fresh device has an empty DATA
partition and that is the normal, healthy first-boot state.

Reporting goes through one new, narrow mosd bus method — the only Rust change in
this task:

    ReportHealth(component: s, status: s, detail: s) -> ()

which records `{"status": ..., "detail": ...}` in mosd's live-state tree at
`health.<component>`, readable through the existing `GetState`. `mos-health`
calls it with `var` / `degraded` (or `ok`) and a human-readable detail string.
The call is best-effort: a failure to report is logged and never fails the gate.

### U-Boot environment ownership

| Variable | Owner |
|---|---|
| `machine_id` | `mos-machine-id.service` (this task) |
| `BOOT_ORDER`, `BOOT_A_LEFT`, `BOOT_B_LEFT` | RAUC (RFCT-014) |

No two writers may run at once. Two mechanisms enforce it: `libubootenv` locks
the environment for the duration of a write, and `mos-health.service` (the only
unit here that makes RAUC touch the environment, via `mark-good`) carries
`After=mos-machine-id.service`, so the two are strictly sequential within a boot.

### machine-id specifics

- Gated by `ConditionKernelCommandLine=!systemd.machine_id`: once U-Boot supplies
  the id there is nothing to generate and the unit does not run.
- The generated value is 32 lowercase hex characters with **no dashes**, the form
  `systemd.machine_id=` requires; a sample from the test run is
  `04d5e5ace1614619bf2139a9843898d1`.
- Clean no-op (exit 0, one log line) when `fw_setenv`/`fw_printenv` are missing or
  the environment is unreadable. That is the state on **every build today**,
  because the custom U-Boot has not landed: the unit is INERT on hardware until
  it does, and that is expected, not a bug.
- Idempotent: an already-valid `machine_id` in the environment is left alone.
- The stored id takes effect from the **NEXT** boot, not the current one. The log
  line says so, so the behaviour is not mistaken for a failure during bring-up.

### Boot safety

`mos-health.service` is `WantedBy=multi-user.target` and `After=multi-user.target`:
pulled in by the target but ordered after it, so the target is reached without
waiting for the gate. Nothing else orders itself after the gate, and
`TimeoutStartSec=180` caps it. `mos-machine-id.service` is deliberately not
`Before=` any target, since writing the environment touches storage.

`After=multi-user.target` was chosen over a timer or a fixed `ExecStartPre` sleep:
the target is the natural settle point (every boot service has been started), and
the residual `starting`/`initializing` window is absorbed by the bounded poll in
the script — which costs nothing on a healthy boot, unlike a blind delay.

## Work checklist

- [x] `os/health/mos-health` + `mos-health.service` + `health.conf`
- [x] `os/health/mos-machine-id` + `mos-machine-id.service`
- [x] mosd `ReportHealth` bus method + private-session-bus test
- [x] `os/health/test.sh` offline tests (fakes on a `$TMPDIR` PATH)
- [x] `os/rootfs/overlay-v2` staging + drift check + `make os-health-test`
- [x] Task record

## Testing

`os/health/test.sh` (`make os-health-test`) is table-driven over faked probe
results. Every external command the scripts call — `rauc`, `systemctl`, `busctl`,
`curl`, `df`, `fw_setenv`, `fw_printenv` — is a stub in a `$TMPDIR` directory
prepended to `PATH`, and the scripts run under `env -i`. The real `rauc`,
`systemctl` and `fw_setenv` are never invoked, so no host state and no U-Boot
environment is ever touched. Cases cover: rauc absent, no booted slot, the happy
path, a second run (idempotency), `degraded` with and without an allowlisted
failed unit, `maintenance`, mosd unreachable and mosd absent, webd unhealthy and
webd absent, `/var` over and under threshold, and the four machine-id paths
(no tool, unreadable env, generate, already set). The last five cases assert the
staged overlay copies have not drifted from the `os/health/` sources.

The mosd `ReportHealth` method is covered in `mosd/mosd/tests/bus.rs` on a
private `dbus-daemon --session`, exactly like the existing round-trip test.

## Acceptance

- `bash mosd/hack/check.sh` green (54 tests).
- `make os-health-test` green.
- `make os-image-cx3576` + `make os-verify-cx3576` (v1) still green.
- `make os-image-cx3576-v2` with both units present and enabled: **cannot be run
  from this task's base**, which carries no `os/rootfs/Dockerfile.v2` and no v2
  target (RFCT-013 is in flight). The units and their enablement symlinks are
  staged in `os/rootfs/overlay-v2`; verifying them in an assembled v2 image is an
  integration step for whoever merges RFCT-013 and RFCT-015.
- On-device confirm/rollback behaviour — a bad slot booting, failing the gate and
  being rolled back by `BOOT_x_LEFT` — is the **user's hardware acceptance**. It is
  not claimed done here and no agent may claim it.

## ActiveForm

Adding the boot health gate and the first-boot machine-id oneshot.

## Dependencies

- **blocked by**: RFCT-013 (v2 rootfs and its overlay mechanism), RFCT-014 (RAUC
  config, `/etc/fw_env.config`, `libubootenv-tool` in the v2 rootfs)
- **blocks**: -
