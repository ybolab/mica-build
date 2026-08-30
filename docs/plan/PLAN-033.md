# PLAN-033 Close the six defects found in the MQTT decoupling review

- **status**: completed
- **createdAt**: 2026-08-30 12:00
- **approvedAt**: 2026-08-30 12:00
- **relatedTask**: [RFCT-268](../task/RFCT-268.md)

## Context

`os/pkgs/mosd/mqttd/src/runtime.rs` drives one `tokio::select!` loop.
`activate_application` awaits `source.get_items` inline and `apply` awaits
`source.set_value`; both go through `BusSource` on a zbus connection built
with the default `method_timeout: None`. mosd's own registry probe
(`mosd/src/scan.rs`) wraps the same call in a five-second timeout for exactly
the reason the bridge now needs one: the peer is a third-party process.

The rumqttc event loop runs in a spawned task that forwards every inbound
publish through `mpsc::channel(64)` with `send().await`; `MqttTransport::publish`
awaits rumqttc's request channel, also bounded at 64. When the runtime is
inside `apply` publishing more than 64 items and more than 64 requests arrive,
each side waits on the other.

`docs/design/bus.md` section 3 shows an application policy that grants only
`mos-mqttd`. `os/pkgs/mosd/tests/dbus-policy-test.sh` reproduces the stock
default context (`deny send_type="method_call"`) and has to add an explicit
allow for root to reach the control name: root has no exemption. mosd's
registry therefore gets `AccessDenied` on `GetItems` and records
`conformance.item1 = false` for a package that follows the document. The
verifier's pairing check (`os/verify/src/checks-mqtt.ts`,
`mqttd-exact-application-grants`) requires only the `mos-mqttd` grants.

Activation runs from the startup `ListNames` sweep and from
`NameOwnerChanged`. A failed `get_items` or a stopped watcher leaves the name
inactive with no later trigger while the owner is unchanged.

`MqttReconciler::apply` calls `apply_identity` with `?` before branching on
`mqtt.enabled`, so an identity that fails validation returns early before the
off path.

`Bridge::on_request` answers a read of an absent item with
`payload::invalid()` and records the topic in `service.published`.

## Proposal

1. `source.rs`: add `Bounded<S>`, an `ItemSource` wrapper applying
   `APPLICATION_CALL_TIMEOUT` (5 s) to `get_items` and `set_value`; a timeout
   is an error for `get_items` and `WriteOutcome::Unreachable` for
   `set_value`. `runtime::run` wraps `BusSource` in it.
2. `runtime.rs`: the event-loop task forwards messages with `try_send` and
   drops on a full channel with a warning; a connection is signalled through
   a `tokio::sync::watch` counter so it can never be dropped or block.
3. `runtime.rs`: factor the startup sweep into `sweep`; when any activation
   fails, or a watcher stops, arm a re-sweep after `ACTIVATION_RETRY` (5 s)
   from the select loop. `handle_application_event` reports whether a
   re-sweep is wanted.
4. `docs/design/bus.md` and `docs/zh/design/bus.md`: the template grants
   root `GetItems` for the registry; `checks-mqtt.ts` requires a root
   `GetItems` grant per enrollment; the test fixture carries it.
5. `reconciler/mqtt.rs`: render the identity into a `Result`; the off path
   ignores it, the on path starts the broker and skips the bridge with a
   warning when it failed.
6. `bridge.rs`: a read of an absent item publishes nothing.

## Risks

- A 5 s bound on `SetValue` means a slow application's accepted write can be
  logged as unreachable; the value still lands and is observed through
  `ItemsChanged`, which is the protocol's only acknowledgement anyway.
- Dropping inbound requests under pressure loses reads; the protocol is
  QoS 0 and a keepalive re-requests everything, so nothing is lost for good.
- The existing reconciler test that expected an invalid identity to fail the
  whole apply changes meaning: the bridge is now the only unit withheld.
- The verifier change makes an already-installed application policy without
  the root grant fail image verification; that is the intent.

## Scope

`os/pkgs/mosd/mqttd/src/{source,runtime,bridge}.rs`, their tests,
`os/pkgs/mosd/mosd/src/reconciler/mqtt.rs`, `os/verify/src/checks-mqtt.ts`
and its test, `docs/design/bus.md`, `docs/zh/design/bus.md`, the changelog
and these records.

## Alternatives

### Re-sweep on every keepalive instead of a timer

Rejected: a keepalive storm would turn into a `GetItems` storm against a
failing application, and an application that fails at boot would wait for
the first client rather than for five seconds.

### An unbounded inbound channel

Rejected: it trades a deadlock for unbounded memory growth under the same
flood.

## Annotations

- The findings were delivered to the user as a code review on 2026-08-30;
  the user replied "start fixing these", which approves this plan as written.
- Completed on 2026-08-30. Rust workspace 358/358 (apid's four private-bus tests ran with dbus-daemon provisioned in a throwaway builder container), os/verify 1064/1064, docs-verify 48 plus four negative cases. clippy and rustfmt are not in the builder image and were left to CI.
