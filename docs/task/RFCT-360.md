# RFCT-360 PLAN-089: the boot health gate requires core function instead of forbidding every failure

- **status**: completed
- **priority**: P1
- **owner**: bkd/irc15xki
- **createdAt**: 2026-09-08 15:03
- **relatedPlans**: PLAN-089

> The index line in `docs/task/index.md` is written by L1, not by this task.

## Description

`mos-regdb-reload.service` failed on a cx3576 on 2026-09-08. On that board's SKU
the unit governs nothing — the phy is `REGULATORY_WIPHY_SELF_MANAGED` — and the
failure still cost the slot a boot credit on every boot, because the health gate
refuses to confirm the booted slot when **any** unit is failed and not named in
`/etc/mos/health.conf`'s `tolerate-failed` allowlist, and that allowlist ships
empty. Three boots and the U-Boot handshake falls to slot B, zero-filled on a
freshly flashed device; `boot.cmd` refills the counters and returns to A, so the
device loops rather than bricking. Root cause of the unit's failure is RFCT-361.

Invert the criterion. The gate asserts a **required** set — the device is
maintainable: the boot transaction finished, mosd answers (the only path to a
RAUC install), apid answers (the only network route in, since the `prod` profile
seeds SSH off) — and everything else it observes is reported rather than fatal.
PLAN-089 carries the set, the justification for each member, the price of each
member's absence, and the argument for what is *not* in it.

Two vacuity guards, because an empty required set is "always mark good" and that
is the same defect read from the other side: an empty `require=` set is a
refusal, and so is an unrecognised member name. A required member the gate
cannot probe — `require=apid` on an image with no `apid.service`, or with no
HTTP client — is a refusal too, not the silent `SKIP` it is today.

Failed units keep a surface: `ReportHealth("units", …)` into live-state
`health.units`, which is readable at `GET /api/v1/state/health` and ships in the
diagnostic snapshot under `failures.health` with no redaction-allowlist change.

## ActiveForm

Inverting the boot health gate to a required set, wiring the failed-unit report,
and moving every A/B contract claim that said a failed unit rolls the device back

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

Out of scope by dispatch: `boards/cx3576/hwinit/` (RFCT-359), the regdb unit
itself (RFCT-361), and `docs/plan/index.md` / `docs/task/index.md` /
`docs/changelog.md` (L1 owns those).

Verified: `tests/health-test.sh` 57 -> 94 checks, green; `verify/run.sh`
1428 -> 1431 tests, green; `make docs-verify` green from a `git archive` into
an empty directory.

`verify/run.sh --verify --board cx3576` moves 449 -> 450: the register gains
`health-gate-required-set-not-empty`, which fails a build whose packed
`/etc/mos/health.conf` carries no `require=` line. It reports **449/450** here,
and the one failure is that check reading the only cx3576 image on this host —
built from `main` before this change, so its conf has no `require=` line. That
is the sentence the check exists to print. No board and no way to rebuild a
cx3576 image without contending for the shared deb pool, so the red is reported
rather than hidden; the check's own verdicts are driven both ways against a
fixture root in `verify/src/checks-system.test.ts`.
