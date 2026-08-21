# Device bus v2 — the `com.mos.*` item-tree contract

> **Status:** partly implemented. This document is the M1 deliverable of
> `docs/plan/PLAN-011.md` and records decisions D1 (one item interface), D2
> (service naming, mandatory paths, class registry) and D3's item semantics as
> a bus-level contract, plus the D6 Sparkplug B evaluation. PLAN-011 M1 landed
> the **read-only** half — `GetItems`, the coalesced `ItemsChanged`, the
> invalid-value convention and structural redaction, all in
> `mosd/mosd/src/tree.rs` — and those statements now read **[implemented]**.
> Everything the write path, the action items and extension services need is
> still **[proposed]**; later tasks keep flipping markers section by section,
> with paths.

## 0. How to read this document

**Status markers.** The discipline is `docs/design/api.md` §0's, which is in
turn `docs/design/access.md` §0's: every statement that describes a
**mechanism** carries a marker, so a reader can tell what can be checked
against the tree from what is only being asked for.

- **[implemented]** — code exists and is named, by path.
- **[proposed]** — no code; this document is asking for it.

access.md's reason applies unchanged: a contract that exists only as prose has
no mechanism that will ever notice it is absent. What PLAN-011 M1 shipped is
**[implemented]** and named by path; the rest of this document is
**[proposed]** today, and marking the split rather than the intent is the
point. Sections 0 and 10 carry no marker where they record evaluation and
history rather than mechanism — the same exemption api.md and access.md
state.

**Authority.** Where this document and `docs/plan/PLAN-011.md` disagree, the
plan's decision record wins and the disagreement is a defect in this document.
Venus OS citations reuse the source study anchors recorded in the plan and in
`docs/research/venus-os-ui.md`.

## 1. D1 — One item interface: `com.mos.Item1` [proposed]

Every `com.mos.*` service — mosd first, extension services later — speaks a
single D-Bus interface for addressable values. There is no other data-plane
interface: a consumer that can read, write and subscribe to items can consume
every service on the bus, which is the property that makes the M3 MQTT bridge
a pure edge component.

### 1.1 Interface definition [proposed]

```xml
<node>
  <interface name="com.mos.Item1">
    <!-- On every item object path -->
    <method name="GetValue">
      <arg direction="out" name="value" type="v"/>
    </method>
    <method name="SetValue">
      <arg direction="in" name="value" type="v"/>
      <arg direction="out" name="result" type="i"/>
    </method>
    <!-- On the service root object path ("/") only -->
    <method name="GetItems">
      <arg direction="out" name="items" type="a{sa{sv}}"/>
    </method>
    <signal name="ItemsChanged">
      <arg name="items" type="a{sa{sv}}"/>
    </signal>
  </interface>
</node>
```

- **[proposed]** `GetValue() -> v` and `SetValue(v) -> i` exist on **every
  item object path**. `SetValue` returns `0` on success and a **negative
  error code** on failure; positive return values are reserved and must not
  be produced.
- **[implemented]** The **result-code vocabulary**, one code per outcome
  (`mosd/mosd/src/tree.rs`):

  | Code | Meaning |
  |---|---|
  | `0` | the settings write was applied, or the action dispatched |
  | `-1` | no item at that path — including one redacted out of the tree (§8) |
  | `-2` | the item exists but is not writable |
  | `-3` | the value does not fit the item's type |
  | `-4` | a settings write that **validated and would not persist** |
  | `-5` | an action that was **accepted and would not dispatch** |

  `-4` and `-5` are deliberately distinct and a consumer must not collapse
  them, because they differ in **whether the request already exists**. A
  settings write that did not persist took effect nowhere, so retrying it is
  safe. An action that did not dispatch was already logged and recorded in
  live state *before* the dispatch (§7), so the request exists either way — a
  client that cannot tell the two apart cannot choose a safe retry policy for
  a reboot. Merging named outcomes is precisely the failure mode
  `docs/design/mosd.md` §5.3 names for the reconciler vocabulary; the wire
  vocabulary is the same class of contract, so it gets the same treatment.
- **[implemented]** `GetItems() -> a{sa{sv}}` and the signal
  `ItemsChanged(a{sa{sv}})` exist on the **service root only**
  (`mosd/mosd/src/tree.rs`, served at `ROOT_PATH`, projecting the settings
  tree and the live-state tree as one flat map). The outer key is the item's
  **absolute slash path** (`/network/eth0/dhcp`); the inner dict carries
  `value` (`v`), `writable` (`b`), and optionally `min` (`v`), `max` (`v`),
  `unit` (`s`). M1 emits `value` and `writable` — the latter `false` on every
  item until the write path lands — and omits the optional three, which
  neither tree carries today.
- **[implemented]** `ItemsChanged` is **coalesced per event-loop turn**:
  changes accumulate during a turn and flush as one signal at its end (the
  veutil pattern, `ve_qitem_exported_dbus_service.cpp:241`). A burst of N item
  changes in one turn produces exactly one signal carrying N entries, never N
  signals. `tree::run` (`mosd/mosd/src/tree.rs`) diffs successive projections
  behind a watch channel that collapses marks arriving mid-projection into one
  wake; the live-bus test
  `mosd/mosd/tests/tree.rs::a_burst_of_changes_coalesces_into_one_items_changed`
  asserts it. It is the designed mitigation for signal fan-out cost on a busy
  tree.

### 1.2 Relationship to the existing `com.mos.mosd1` methods [proposed]

The item tree is a **façade over the same store** (single writer inside
mosd). The existing methods
(`GetSettings`/`SetSettings`/`GetState`/`Reboot`/`PowerOff`/…,
`docs/design/mosd.md` §5.4) are not removed by this contract; they become
thin wrappers over the same code paths. Their deprecation is a later
decision, taken only once apid consumes the tree. Divergence between the two
write paths is a bug class the live-bus test must cover.

**[implemented]** The façade half of that is in place: `mosd/mosd/src/tree.rs`
only *observes* — `MosdService` remains the single writer, and the tree learns
about mutations through its change marker rather than by writing anything
itself. The wrapper half waits on M1's successor: there is no second write
path to diverge yet.

## 2. No `GetText` — a deliberate deviation [implemented]

**[implemented]** `com.mos.Item1` has **no `GetText` member** — the shipped
interface (`mosd/mosd/src/tree.rs`) declares `GetItems` and `ItemsChanged` and
nothing else — and no service may add one. Venus's
`com.victronenergy.BusItem` carries `GetText` (a server-formatted display
string per item); Venus's own gui-v2 declines to use it and formats
client-side. Formatting is a client concern — locale, unit
preference and precision belong to the consumer — and the metadata a
formatter needs (`unit`, `min`, `max`) already travels in `GetItems`.
Shipping a server-side display string would bake one client's formatting into
every service and every bridge payload. Rationale recorded in PLAN-011 D1;
this closes the corresponding entry in the deviation register (§9).

## 3. The invalid-value convention [proposed]

Stated once, here, for the whole contract — every service and every consumer
follows it, and no other document restates it normatively:

- **[implemented]** An item whose value is currently **invalid** (unknown,
  not-yet-read, hardware absent) is an **absent key in `GetItems`** and in
  `ItemsChanged` payloads. Absence of the key *is* the invalid marker; there
  is no null sentinel value. In mosd (`tree::flatten`,
  `mosd/mosd/src/tree.rs`) a JSON `null` leaf projects as no key at all.
- **[implemented]** On the wire, an item that must transition **to** invalid
  in an `ItemsChanged` payload, or answer `GetValue` while invalid, carries
  the **empty-array sentinel** `[]` (D-Bus type `av`, zero elements) as its
  value. A consumer must treat that sentinel exactly as it treats an absent
  key. `tree::invalid_sentinel` (`mosd/mosd/src/tree.rs`) is what a vanished
  path carries in an `ItemsChanged` batch; the `GetValue` half arrives with
  the write path.
- **[proposed]** `SetValue` failures are reported **only** through the
  negative integer return code (§1.1); a failed write never changes the
  item's value, and error *text* is not part of the contract.

This is Venus's convention stated explicitly instead of implied — one of the
things the plan's source study found documented nowhere in Venus itself.

## 4. Path mapping: dot-paths and slash paths [proposed]

- **[implemented]** The **internal dot-path** (`network.eth0.dhcp`) remains
  the **canonical address** of a setting or state item, exactly as
  `docs/design/mosd.md` §5.1 and `docs/design/api.md` §2 use it. apid and the
  `/api/v1` surface need no renaming: the façade (`mosd/mosd/src/tree.rs`)
  converts at the bus edge and nothing upstream of it moved.
- **[proposed]** The bus object path is the **slash form** of the dot-path
  with a leading slash: `network.eth0.dhcp` ↔ `/network/eth0/dhcp`. The
  mapping is mechanical in both directions and total over valid dot-paths.
- **[implemented]** `GetItems` keys and `ItemsChanged` keys use the absolute
  slash form (`tree::flatten`, `mosd/mosd/src/tree.rs`; asserted by
  `mosd/mosd/tests/tree.rs::get_items_projects_both_trees_as_slash_paths`). A
  consumer converting back to dot-paths strips the leading slash and replaces
  `/` with `.`.
- **[proposed]** The dot-path model's known limit — a segment containing a
  literal dot cannot be addressed (`docs/design/api.md` §2's VLAN case) — is
  inherited by the slash form unchanged; the bus does not add an escape
  syntax.

## 5. D2 — Service naming and the class registry [proposed]

- **[proposed]** Bus names follow `com.mos.<class>[.<suffix>]`, one service
  per functional device instance. The `<suffix>` distinguishes instances of
  a class (typically the driver or transport, e.g. `com.mos.sensor.abc123`).
- **[proposed]** mosd keeps **`com.mos.mosd`** — the management core is a
  class of its own.
- **[proposed]** The **class registry** is this list, in this document.
  Growing it is a **doc change, not a code change** — no consumer may
  hard-code the closed set:

  | Class | Meaning |
  |---|---|
  | `io` | digital / analog I/O |
  | `serial` | serial-attached device services |
  | `can` | CAN-attached device services |
  | `sensor` | measurement producers (temperature, pressure, …) |
  | `meter` | accumulating / billing-grade measurement |
  | `gps` | position sources |

- **[proposed]** **Energy-domain classes are explicitly out of scope**
  (battery, solarcharger, inverter, vebus, …) until a product need exists.
  The registry starting small and industrial is the fence against Venus's
  breadth (PLAN-011 "Risks": scope creep).

## 6. Mandatory paths and the alarm convention [proposed]

- **[proposed]** Every `com.mos.*` service publishes, from the moment it
  claims its name:

  | Path | Meaning |
  |---|---|
  | `/Mgmt/ProcessName` | executable name of the publishing process |
  | `/Mgmt/ProcessVersion` | version of the publishing process |
  | `/Mgmt/Connection` | human-readable transport description (e.g. `ttyUSB0`, `can0`) |
  | `/DeviceInstance` | integer instance number, unique within the class (allocated per PLAN-011 D5's `RegisterInstance` once it lands) |
  | `/ProductId` | numeric product identifier |
  | `/ProductName` | human-readable product name |
  | `/Connected` | `1` when the backing device is reachable, `0` when not |

  A service missing any of these is malformed; consumers may ignore it and
  the registry (PLAN-011 D5) will surface it as such.
- **[proposed]** **Alarms** are items under `/Alarms/<name>`, integer-valued:
  `0` = ok, `1` = warning, `2` = alarm. No other alarm encoding is permitted
  on the bus.

## 7. D3 — Actions are writable items [proposed]

- **[proposed]** An action is an item under `/Actions/<verb>`
  (`/Actions/reboot`, `/Actions/poweroff`, and RFCT-084's update verbs as
  they land). Its value **always reads `0`**.
- **[proposed]** `SetValue` on an action item **triggers the action**. The
  service forces the value back to `0` after the write and **emits a change
  signal even on the `0 -> 0` edge** — the forced re-zero is observable, so
  a subscriber sees the consumption edge of every trigger (the
  `VeQItemAction` semantics, `veutil ve_qitem_utils.hpp:146-162`).
- **[proposed]** The `SetValue` **return code is the dispatch result**: `0`
  means the action was accepted and dispatched, a negative code means it was
  not. Completion and progress, where they exist, are ordinary items
  elsewhere in the tree — the action item itself carries no state.
- **[proposed]** Existing safety properties are preserved unchanged: the
  action is logged and recorded in live-state *before* the power call (the
  current `Reboot` contract), and apid's confirm-token gate stays in apid.
  The bus remains root-only by policy until PLAN-011 D5 lands, so the
  bus-side gate *is* the policy.

This is what makes a value-only remote bridge sufficient: Venus's MQTT bridge
carries only `SetValue` (`dbus-flashmq/src/state.cpp:317-354`) and that is
enough to reboot, update and reconfigure a remote device. It resolves the
actions-as-items-vs-methods fork recorded in `docs/research/venus-os-ui.md`
§7 item 2 and left open in `docs/design/api.md`'s research appendix — in
favor of items. `POST /api/v1/actions/<verb>` becomes a thin mapping onto
these items with no HTTP-visible change.

## 8. Structural redaction is a bus-level contract [implemented]

**[implemented]** The rule `docs/design/api.md` states for `/api/v1/settings/`
(around `docs/design/api.md:789`) applies to the bus itself: **the value of
any key named `password_hash`, `passwordHash`, `psk`, or `hash` — anywhere in
the tree, at any depth — never appears on the bus.** Not in `GetItems`, not
in `ItemsChanged`, not through `GetValue`. The redaction is **structural** (a
match on the key name at any depth), not a list of dot-paths, because the
`psk` fields sit inside arrays that the dot-path syntax cannot name. In mosd
this is `tree::redact` (`mosd/mosd/src/tree.rs`), one function that every
projection passes through — including inside arrays.

Consequences, stated once:

- **[implemented]** Redaction happens in the publishing service, **before**
  serialization — a bus consumer, including the M3 MQTT bridge, never holds
  the secret and needs no masking logic of its own. The bridge's
  publish-side masking (PLAN-011 D6) is defense in depth, not the primary
  control.
- **[implemented]** The residual risk is api.md's, inherited: this is a
  denylist, so a future secret-bearing field under a name not on the list is
  exposed by default. The mitigation is a test asserting the redacted tree,
  not a hope — `mosd/mosd/tests/tree.rs::secret_values_appear_in_no_get_items_and_no_signal`
  seeds secrets into both trees and requires them in neither `GetItems` nor
  any `ItemsChanged` payload.

## 9. Recorded deviations from Venus OS

This contract copies Venus's *shape* — one tiny interface, one value tree,
actions as items, mandatory paths — and deliberately not its permissiveness.
Per PLAN-011 "What we deliberately do not copy" (each confirmed in Venus
source during the 2026-08-21 study), the following are **rejected**, not
deferred:

1. **The fleet-wide `"ZZZ"` client-side access password.** mos access
   control is real authentication (`docs/design/access.md`), never a shared
   constant in the client.
2. **`GetText`** — see §2. gui-v2 itself declines the server-formatted
   string.
3. **Root-password-change via a bus item** shelling to `chpasswd` on a
   remounted rootfs. mos root stays read-only; credential changes go through
   the typed settings tree and its reconcilers.
4. **daemontools supervision.** mos services are systemd units with the
   hardening defaults PLAN-011 D5 specifies.
5. **Dynamic settings registration into the core schema.** localsettings has
   no schema, no migration, and factory-resets on a corrupt file
   (`localsettings.py:890-894`). mos keeps the typed core schema with priced
   migrations; extension settings are namespaced and separately stored
   (PLAN-011 D4), so a corrupt extension file resets only that extension.

Additionally, conventions Venus leaves implicit are stated here explicitly:
the invalid-value convention (§3) and the coalescing guarantee (§1.1) are
normative in mos, not folklore.

## 10. D6 — The Sparkplug B evaluation

Recorded during M1 so the M3 bridge milestone starts unblocked. This section
is an evaluation and a decision record; the **OUTCOME** at its end is what
the M3 bridge implements from.

### 10.1 The mos-native grammar under evaluation

The M3 bridge (`mos-mqttd`) as planned speaks the dbus-flashmq-shaped
protocol, field-proven for a decade against exactly this tree shape:

- Topic grammar: `N|R|W/<deviceId>/<class>/<instance>/<path>` —
  `N` (notification, device→broker), `R` (read request, broker→device),
  `W` (write request, broker→device).
- Payloads: `{"value": ...}` JSON; an invalid item publishes
  `{"value": null}` (the §3 convention crossing to JSON, where `null` is
  expressible).
- Liveness: a 60 s keepalive request triggers a **rate-limited full
  republish** of the tree, terminated by a `full_publish_completed` marker;
  the device emits a 3 s heartbeat.
- Modes: **read-only** (N only; R/W ignored) vs **full** (W carried through
  to `SetValue` — sufficient for all control, by §7).

### 10.2 Sparkplug B, compared

Sparkplug B (Eclipse Tahu, ISO/IEC 20237) is the industrial-IoT MQTT
convention: `spBv1.0/<group>/<message_type>/<edge_node>/[device]` topics,
Protobuf-encoded payloads, birth/death certificates (`NBIRTH`/`NDEATH` via
MQTT last-will), metric aliases, sequence numbers, and a primary-host
"rebirth" request mechanism.

| Aspect | mos-native (dbus-flashmq shape) | Sparkplug B |
|---|---|---|
| Envelope | JSON `{"value": ...}`, topic carries the path | Protobuf metric batch, metrics carry names/aliases |
| Data model | mirrors the item tree 1:1 — zero impedance | flat metric namespace; the tree must be flattened into metric names |
| State/liveness | 3 s heartbeat + keepalive→full republish + `full_publish_completed` | NBIRTH/NDEATH + seq numbers + rebirth — richer, host-arbitrated |
| Writes | `W/` topic → `SetValue`, return code is the result | NCMD/DCMD metrics — equivalent power |
| Interop | mos tooling and anything Venus-shaped | SCADA/IIoT platforms (Ignition, etc.) consume it natively |
| Cost to mos | none beyond M3 as planned | Protobuf dep, birth-certificate lifecycle, metric-alias state, a second full protocol surface to test |

The two differ **mainly in envelope**, as PLAN-011 D6 observed: both are
value-oriented, both carry writes as value publishes, and the item tree
(D1–D3) supports either. Nothing in this contract forecloses Sparkplug.

### 10.3 Decision

Native-only now. The arguments:

- The product need on record (PLAN-011, user annotation 2026-08-21) is MQTT
  **data publishing**, which the native grammar satisfies with the least
  code, the least dependency surface, and 1:1 fidelity to the tree.
- No consumer requiring Sparkplug exists in the product today; building it
  now would be speculative interop, and speculative surfaces rot untested.
- Because Sparkplug differs in envelope, a later `spBv1.0` mapper is an
  additive edge component over the same item tree — adopting it later costs
  no migration of the native grammar, the bus contract, or any service.

**Revisit trigger:** a concrete customer or product integration that
requires Sparkplug B (e.g. an Ignition/SCADA deployment consuming
`spBv1.0`). When it fires, the outcome is *Sparkplug-also* — a second
publisher beside the native grammar, never a replacement for it — designed
as its own task against this contract.

**OUTCOME: the M3 bridge implements the mos-native grammar only
(`N|R|W/<deviceId>/<class>/<instance>/<path>` with `{"value": ...}`
payloads, keepalive-triggered rate-limited full republish with
`full_publish_completed`, 3 s heartbeat, read-only and full modes); Sparkplug
B is not implemented now and is adopted, if ever, only as an additional
mapper when a named integration requires it.**
