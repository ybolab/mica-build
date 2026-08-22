# RFCT-094 Dotted keys have no item object, and M5 makes that certain rather than theoretical

- **status**: pending
- **priority**: P2
- **owner**: (unclaimed)
- **createdAt**: 2026-08-22 17:10

Raised by PLAN-011 M5 (RFCT-093), deliberately not fixed there.

`docs/design/bus.md` §11 item 2 records a known limit: a settings key that is
not a valid D-Bus path element gets no item object, though it still reads
through `GetItems` and writes through `SetSettings`. The named example is
`network.br-lan`, and until M5 the limit was **possible but not certain** — it
needed an operator to name an interface with a dot or dash.

M5 makes it certain. The service registry the scan publishes is keyed by **bus
name**, and a bus name always contains dots (`com.mos.ext.sensor.fake`). So
`tree.rs`'s `sync_objects` emits

    WARN ... no item object for this path path="/services/com.mos.ext.sensor.fake/name"

for **every field of every registered service**, at every startup, on any
device that has extensions. Nothing is lost — the registry still reads through
`GetItems`/`GetState` — but a device with several extensions emits a burst of
WARNs at boot for a condition that is normal and expected.

The operational cost is not the log volume. It is that a WARN which fires
during correct operation teaches an operator to ignore WARNs, which is the
same false-signal family this campaign spent its length removing: an assertion
that cannot fail proves nothing, and a warning that always fires warns nobody.

Open questions for whoever claims this, none of them settled here:

- Should dotted keys get object paths at all — by escaping (systemd's
  `systemd-escape` idiom), by a synthetic child level, or by some other
  encoding — or should the tree keep refusing them?
- If they keep being refused, should `sync_objects` distinguish "this key
  cannot be a path element, which is expected" from "this path failed for a
  reason worth a WARN", and log the former at DEBUG or not at all?
- Does anything depend on registry entries being reachable as individual
  items, or is `GetItems`/`GetState` sufficient for every consumer including
  the M3 bridge?

Related: `docs/design/bus.md` §11, RFCT-093 (M5's registry), RFCT-091 (the
bridge that consumes the tree).
