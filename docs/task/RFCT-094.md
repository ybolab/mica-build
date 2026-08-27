# RFCT-094 Dotted keys have no item object, and M5 makes that certain rather than theoretical

- **status**: completed
- **priority**: P2
- **owner**: ai-agent
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

## Resolution

Decision (made here): **the tree keeps refusing dotted keys as item objects —
no path escaping, no synthetic child level** — and `sync_objects` now tells
the two failure kinds apart. A key that cannot be a D-Bus path element (the
expected case: `network.br-lan`, every bus-name-keyed registry entry) is
detected up front via `ObjectPath::try_from` and logged at **DEBUG**; **WARN**
remains for a registration failure at a path that IS valid, which is a real
fault. Nothing is lost either way: the key still reads through `GetItems`,
changes through `ItemsChanged`, and writes through `SetSettings`.

Answers to the open questions, in order:

- No object paths for dotted keys: escaping would add a second spelling for
  every path and an escape syntax §4 deliberately refused one layer up.
- Yes, the two cases are distinguished, and the expected one logs at DEBUG
  (not silence: the condition stays discoverable on a device with RUST_LOG).
- Consumers were not audited here; `GetItems`/`GetState` remain the contract
  for such keys, exactly as §11 item 2 records.

Asserted as observable behaviour by
`mosd/mosd/tests/tree.rs::a_dotted_key_syncs_through_get_items_without_a_warn`:
the harness now captures the daemon's log off its stdout, writes
`network.br-lan`, asserts the leaf arrives in `ItemsChanged` and reads back
through `GetItems`, and asserts no "no item object" WARN was emitted. Run
against the pre-fix `sync_objects` the test fails on exactly that WARN
(`WARN mosd::tree: no item object for this path
path="/network/br-lan/dhcp"`), so it pins the branch, not a tautology.

`docs/design/bus.md` §11 item 2 is updated: the limit is recorded as
handled-and-expected rather than open, with the registry case named and the
test cited.
