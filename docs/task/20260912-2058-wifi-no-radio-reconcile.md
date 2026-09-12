# 20260912-2058-wifi-no-radio-reconcile Wi-Fi reconcilers fail on images without a radio

- **status**: pending
- **priority**: P2
- **owner**: (unassigned)
- **createdAt**: 2026-09-12 20:58

## Description

The clean x64 diagnosis observed `wifiClient` failing while creating
`/etc/wpa_supplicant` and `wifiAp` reporting D-Bus `FileNotFound` on a
device with no radio. `wifi_client.rs` renders configuration even while the
station is disabled.

Acceptance: a failing no-radio regression test first; disabled Wi-Fi on a
radio-less x64 image reports no reconciler error; a radio-enabled case still
applies.

## ActiveForm

Fixing Wi-Fi reconciliation without a radio.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

- Created by 20260912-2049-docs-restructure from the 2026-09-12 plan and task audit.
