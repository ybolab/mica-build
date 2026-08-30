# RFCT-268 Close the six defects found in the MQTT decoupling review

- **status**: completed
- **priority**: P1
- **owner**: roy/mqtt-review-fixes-20260830
- **createdAt**: 2026-08-30 12:00
- **plan**: [PLAN-033](../plan/PLAN-033.md)

## Description

A review of PLAN-031/PLAN-032 as merged found that the bridge still treats
its D-Bus peers as if they were mosd, while the new architecture makes those
peers unprivileged third-party applications. Six defects, by severity:

1. `mos-mqttd` calls `GetItems` and `SetValue` on applications with no
   timeout (zbus has none by default), so one hung application stops the
   heartbeat and every other application for good; the process never exits,
   so `Restart=on-failure` never fires.
2. The runtime's inbound channel and rumqttc's request channel are both
   bounded at 64 and each side awaits the other, so a burst of requests
   during a large full publish deadlocks the bridge.
3. The application policy template in `docs/design/bus.md` grants only
   `mos-mqttd`. The stock system bus denies method calls by default and
   root has no exemption, so mosd's registry probe is refused and every
   correctly packaged application is reported non-conforming.
4. An activation that fails once (an application that claims its name before
   registering `/`, or a malformed `ItemsChanged`) is never retried while
   the owner stays on the bus.
5. The MQTT reconciler renders the bridge identity before the off path, so a
   device identity that fails validation stops `mqtt.enabled = false` from
   stopping the units.
6. A read request for a path no application publishes creates a retained
   `{"value": null}` topic named by the remote client and grows the
   bridge's published set without bound.

## Acceptance

- Every bridge call into an application is bounded by a timeout; a hung
  application is recorded as unreachable and the bridge keeps serving the
  others.
- The rumqttc event-loop task never awaits the runtime; requests that arrive
  while the runtime is busy are dropped with a warning, and a reconnect is
  never dropped.
- The documented application policy grants root `GetItems`, the verifier
  requires that grant for every enrollment, and the fixture carries it.
- A failed activation or a stopped watcher schedules a re-sweep of the bus so
  an application still owning its name is re-activated without a restart.
- `mqtt.enabled = false` stops both units regardless of the identity
  render; an identity that fails validation skips only the bridge start.
- A read of an unknown item path publishes nothing.
- Focused tests, the Rust workspace gates, the image verifier suite, and the
  documentation checks pass.

## ActiveForm

Closing the six MQTT bridge review defects.

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

Defects 2 and 6 predate PLAN-031; they are fixed here because the new
architecture puts a network-facing daemon on the other side of them.

- complete: mqttd 29 tests, mosd reconciler 20, apid 358 (with dbus-daemon provisioned in the builder container), Rust workspace 358/358, os/verify 1064/1064, docs-verify and its 4 negative cases pass; clippy and rustfmt could not run locally (no rustup in localhost/mos-build-rust) and remain on CI.
