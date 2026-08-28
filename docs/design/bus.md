# Device bus v2 — the `com.mos.*` item-tree contract

> **Status:** partly implemented. This document is the M1 deliverable of
> `docs/plan/PLAN-011.md` and records decisions D1 (one item interface), D2
> (service naming, mandatory paths, class registry) and D3's item semantics as
> a bus-level contract, plus the D6 Sparkplug B evaluation. PLAN-011 M1 landed
> the **read-only** half — `GetItems`, the coalesced `ItemsChanged`, the
> invalid-value convention and structural redaction, all in
> `os/pkgs/mosd/mosd/src/tree.rs` — and those statements now read **[implemented]**.
> **M2 landed the write half**: `GetValue`/`SetValue` on per-item object
> paths, the five platform-config subtrees writable, and `/Actions/reboot`
> and `/Actions/poweroff` as action items (`os/pkgs/mosd/mosd/src/tree.rs`,
> `os/pkgs/mosd/mosd/src/actions.rs`), consumed by apid's power pane
> (`os/pkgs/mosd/apid/src/bus_client.rs`) — so the statements that needed it now read
> **[implemented]** too: §1.1's interface, §3's SetValue-failure rule, §4's
> object paths and all four of D3's (§7). §11 records what the shipped tree is
> known **not** to do. **M3 landed the bridge** this tree was shaped for:
> `mos-mqttd` (`os/pkgs/mosd/mqttd/`) publishes it over MQTT in the mos-native grammar
> §10 chose, so §10.1's grammar, payload, liveness and mode statements now read
> **[implemented]** with paths into `os/pkgs/mosd/mqttd/src/`. **M5 landed extension
> enablement** (D5, revised): one `com.mos.*` naming rule, in which an
> extension's class is the fourth dotted component and a system service's the
> third (`os/pkgs/mosd/busname/src/lib.rs`, consumed by `os/pkgs/mosd/mqttd/src/topic.rs` and
> `os/pkgs/mosd/mosd/src/scan.rs`); the `com.mos.ext` policy grant
> (`os/pkgs/mosd/dist/com.mos.ext.conf`); and the `NameOwnerChanged` scan that
> publishes a service registry carrying a `conformance` field
> (`os/pkgs/mosd/mosd/src/scan.rs`). So §5's grammar and class derivation, and §6's
> handling of non-conformance, now read **[implemented]**. What is still
> **[proposed]** is what needs services that do not exist yet — D2's class
> registry, which nothing in the tree enumerates, and §6's mandatory paths,
> which no shipped service publishes: the registry checks for them and names
> their absence, and checking a contract is not the same as meeting it. Later
> tasks keep flipping markers section by section, with paths.

## 0. How to read this document

**Status markers.** The discipline is `docs/design/api.md` §0's, which is in
turn `docs/design/access.md` §0's: every statement that describes a
**mechanism** carries a marker, so a reader can tell what can be checked
against the tree from what is only being asked for.

- **[implemented]** — code exists and is named, by path.
- **[proposed]** — no code; this document is asking for it.

access.md's reason applies unchanged: a contract that exists only as prose has
no mechanism that will ever notice it is absent. What PLAN-011 M1 and M2
shipped is **[implemented]** and named by path; the rest of this document is
**[proposed]** today, and marking the split rather than the intent is the
point. Sections 0 and 10 carry no marker where they record evaluation and
history rather than mechanism — the same exemption api.md and access.md
state. §10.1 is the one part of §10 that outgrew that exemption: since M3 the
grammar it describes is shipped code, not a candidate, so it carries markers
and paths like every other mechanism here.

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

### 1.1 Interface definition [implemented]

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

- **[implemented]** `GetValue() -> v` and `SetValue(v) -> i` exist on **every
  item object path** — one D-Bus object per item, registered before the
  well-known name is claimed and kept in step with the tree by the same change
  watcher that drives `ItemsChanged` (`os/pkgs/mosd/mosd/src/tree.rs`), so the members
  exist exactly where an item does. `SetValue` returns `0` on success and a
  **negative error code** on failure; positive return values are reserved and
  must not be produced. A path with **no** item behind it is not a return code
  at all — it answers with the D-Bus `UnknownObject` error, which is decided
  rather than incidental and is recorded as §11's first known limit.
- **[implemented]** The **result-code vocabulary**, one code per outcome
  (`os/pkgs/mosd/mosd/src/tree.rs`):

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
  (`os/pkgs/mosd/mosd/src/tree.rs`, served at `ROOT_PATH`, projecting the settings
  tree and the live-state tree as one flat map). The outer key is the item's
  **absolute slash path** (`/network/eth0/dhcp`); the inner dict carries
  `value` (`v`), `writable` (`b`), and optionally `min` (`v`), `max` (`v`),
  `unit` (`s`). `value` and `writable` are emitted; the optional three are
  omitted, neither tree carrying them today. **M2 gave `writable` its
  meaning**: `true` on the five platform-config subtrees (`hostname`,
  `network`, `wifi.client`, `wifi.ap`, `access.ssh`) and on the `/Actions/*`
  items, `false` on everything else including all of live state.
- **[implemented]** `ItemsChanged` is **coalesced per event-loop turn**:
  changes accumulate during a turn and flush as one signal at its end (the
  veutil pattern, `ve_qitem_exported_dbus_service.cpp:241`). A burst of N item
  changes in one turn produces exactly one signal carrying N entries, never N
  signals. `tree::run` (`os/pkgs/mosd/mosd/src/tree.rs`) diffs successive projections
  behind a watch channel that collapses marks arriving mid-projection into one
  wake; the live-bus test
  `os/pkgs/mosd/mosd/tests/tree.rs::a_burst_of_changes_coalesces_into_one_items_changed`
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

**[implemented]** The façade half of that is in place: `os/pkgs/mosd/mosd/src/tree.rs`
only *observes* — `MosdService` remains the single writer, and the tree learns
about mutations through its change marker rather than by writing anything
itself.

**[implemented]** M2 added the write path without adding a second one.
`SetValue` hands the value to the same `MosdService::write_setting`
(`os/pkgs/mosd/mosd/src/bus.rs`) that `SetSettings` calls — validate against the typed
tree, persist through the store, re-apply the reconcilers whose subtree
overlaps the path — so the divergence this section names as a bug class is not
merely tested against, it is **unrepresentable**: there is one write path with
two spellings. Reconcilers are unchanged. The same holds for the action items,
which dispatch through the existing `request_reboot`/`request_power_off`
rather than restating them (§7). What remains open is only the *deprecation*
decision: `Reboot` and `PowerOff` are still served, and apid no longer calls
them (`os/pkgs/mosd/apid/src/bus_client.rs`), which is the condition this section
names for taking that decision — it is not taken here.

## 2. No `GetText` — a deliberate deviation [implemented]

**[implemented]** `com.mos.Item1` has **no `GetText` member** — the shipped
interface (`os/pkgs/mosd/mosd/src/tree.rs`) declares `GetItems` and `ItemsChanged` and
nothing else — and no service may add one. Venus's
`com.victronenergy.BusItem` carries `GetText` (a server-formatted display
string per item); Venus's own gui-v2 declines to use it and formats
client-side. Formatting is a client concern — locale, unit
preference and precision belong to the consumer — and the metadata a
formatter needs (`unit`, `min`, `max`) already travels in `GetItems`.
Shipping a server-side display string would bake one client's formatting into
every service and every bridge payload. Rationale recorded in PLAN-011 D1;
this closes the corresponding entry in the deviation register (§9).

## 3. The invalid-value convention [implemented]

Stated once, here, for the whole contract — every service and every consumer
follows it, and no other document restates it normatively:

- **[implemented]** An item whose value is currently **invalid** (unknown,
  not-yet-read, hardware absent) is an **absent key in `GetItems`** and in
  `ItemsChanged` payloads. Absence of the key *is* the invalid marker; there
  is no null sentinel value. In mosd (`tree::flatten`,
  `os/pkgs/mosd/mosd/src/tree.rs`) a JSON `null` leaf projects as no key at all.
- **[implemented]** On the wire, an item that must transition **to** invalid
  in an `ItemsChanged` payload, or answer `GetValue` while invalid, carries
  the **empty-array sentinel** `[]` (D-Bus type `av`, zero elements) as its
  value. A consumer must treat that sentinel exactly as it treats an absent
  key. `tree::invalid_sentinel` (`os/pkgs/mosd/mosd/src/tree.rs`) is what a vanished
  path carries in an `ItemsChanged` batch, and — since M2 — what `GetValue`
  answers on an item object whose leaf has gone invalid under it.
- **[implemented]** `SetValue` failures are reported **only** through the
  negative integer return code (§1.1); a failed write never changes the
  item's value, and error *text* is not part of the contract
  (`os/pkgs/mosd/mosd/src/tree.rs` — the reason a write was refused is logged on the
  device and does not travel).

This is Venus's convention stated explicitly instead of implied — one of the
things the plan's source study found documented nowhere in Venus itself.

## 4. Path mapping: dot-paths and slash paths [implemented]

- **[implemented]** The **internal dot-path** (`network.eth0.dhcp`) remains
  the **canonical address** of a setting or state item, exactly as
  `docs/design/mosd.md` §5.1 and `docs/design/api.md` §2 use it. apid and the
  `/api/v1` surface need no renaming: the façade (`os/pkgs/mosd/mosd/src/tree.rs`)
  converts at the bus edge and nothing upstream of it moved.
- **[implemented]** The bus object path is the **slash form** of the dot-path
  with a leading slash: `network.eth0.dhcp` ↔ `/network/eth0/dhcp`, and
  `os/pkgs/mosd/mosd/src/tree.rs` serves one object at exactly that path per item. The
  mapping is mechanical in both directions and total over dot-paths whose
  segments are also valid **D-Bus object-path elements**; a segment that is
  not gets no object, which is §11's second known limit.
- **[implemented]** `GetItems` keys and `ItemsChanged` keys use the absolute
  slash form (`tree::flatten`, `os/pkgs/mosd/mosd/src/tree.rs`; asserted by
  `os/pkgs/mosd/mosd/tests/tree.rs::get_items_projects_both_trees_as_slash_paths`). A
  consumer converting back to dot-paths strips the leading slash and replaces
  `/` with `.`.
- **[implemented]** The dot-path model's known limit — a segment containing a
  literal dot cannot be addressed (`docs/design/api.md` §2's VLAN case) — is
  inherited by the slash form unchanged; the bus does not add an escape
  syntax. The object layer adds a second, narrower limit of the same family
  (D-Bus restricts what characters a path element may contain), recorded in
  §11 rather than here because it costs an item its object without costing it
  its addressability.

## 5. D2 — Service naming and the class registry [implemented]

- **[implemented]** Bus names follow `com.mos.<class>[.<suffix>]` for a system
  service and **`com.mos.ext.<class>[.<suffix>]`** for an extension, one
  service per functional device instance. The `<suffix>` distinguishes
  instances of a class (typically the driver or transport, e.g.
  `com.mos.sensor.abc123`, `com.mos.ext.sensor.abc123`). Both grammars are
  parsed by `mos_busname::parse` (`os/pkgs/mosd/busname/src/lib.rs`) and consumed by
  the MQTT bridge (`os/pkgs/mosd/mqttd/src/topic.rs`). The extension half is the half
  PLAN-011 D5's `own_prefix="com.mos.ext"` grant makes ownable
  (`os/pkgs/mosd/dist/com.mos.ext.conf`); every other name under `com.mos.` is the
  system's and stays closed by D-Bus's default `<deny own="*"/>`.
- **[implemented]** **A service's class is the FOURTH dotted component of an
  extension name and the THIRD of a system name** — `com.mos.ext.sensor.abc123`
  publishes under `sensor`, `com.mos.sensor.abc123` under `sensor`, and no
  extension ever publishes under `ext` (`os/pkgs/mosd/busname/src/lib.rs`,
  `os/pkgs/mosd/mqttd/src/topic.rs`). The rule is one function with two callers — the
  bridge's `topic::class_of` and mosd's service registry
  (`os/pkgs/mosd/mosd/src/scan.rs`) — rather than two copies that can drift; an
  extension published under the class `ext` is the defect the single copy
  exists to prevent.
- **[implemented]** `ext` is a namespace **only as a whole dotted component**:
  `com.mos.extra` is an ordinary system name whose class is `extra`, not an
  extension (`os/pkgs/mosd/busname/src/lib.rs`). The D-Bus policy draws the boundary in
  the same place — `own_prefix` requires the next character to be a `.`, so it
  refuses `com.mos.extra` (measured, `docs/task/RFCT-093.md` §"Investigation —
  `own_prefix` semantics (measured 2026-08-22)"). Parser and policy agree on
  one rule, which is what makes the agreement checkable.
- **[implemented]** **`com.mos.ext` — the bare namespace, with nothing under
  it — classifies as extension-origin with NO class, and never as
  system-origin** (`os/pkgs/mosd/busname/src/lib.rs`, consumed by
  `os/pkgs/mosd/mqttd/src/topic.rs`). The reason is measured, not reasoned: an
  unprivileged uid can own that exact name, because `own_prefix` matches the
  bare prefix itself (uid 65534, `OWNED`, dbus-daemon 1.12.20 —
  `docs/task/RFCT-093.md` §"Investigation — `own_prefix` semantics (measured
  2026-08-22)"), so classifying it as system-origin would let any third party
  present itself to operators, to the dashboard and to the bridge **as the
  system**. It has no fourth component, so there is no class to read and none
  is invented — `ext` or an empty segment would put a service on the bridge
  under a class nobody chose. A consumer that needs a class to address a
  service refuses instead of substituting one; the registry records the same
  condition as its `no_class` conformance gap (`os/pkgs/mosd/mosd/src/scan.rs`).
- **[implemented]** mosd keeps **`com.mos.mosd`** — the management core is a
  class of its own, owned at `os/pkgs/mosd/mosd/src/bus.rs` and read as the class
  `mosd` by the same one rule (`os/pkgs/mosd/busname/src/lib.rs`).
- **[proposed]** The **class registry** is this list, in this document.
  Growing it is a **doc change, not a code change** — no consumer may
  hard-code the closed set, and nothing in the tree enumerates it:

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
  | `/DeviceInstance` | integer instance number, unique within the class. **The service publishes its own** — there is no allocator, no registration call and nothing to ask; a service that publishes none is recorded under `0` |
  | `/ProductId` | numeric product identifier |
  | `/ProductName` | human-readable product name |
  | `/Connected` | `1` when the backing device is reachable, `0` when not |

  A service missing any of these is **non-conforming**. That is not licence for
  a consumer to ignore it: the registry (PLAN-011 D5) publishes it anyway,
  best-effort, and **names the gap** in a `conformance` field, so what a
  consumer sees is the service *and* what it is missing.
- **[implemented]** **The registry publishes non-conformance rather than
  refusing it** (`os/pkgs/mosd/mosd/src/scan.rs`, published into live state under
  `services`). Four properties, each asserted there:
  - A service that is missing mandatory paths, or answers no `com.mos.Item1`
    at all, is still published, with a `conformance` object naming exactly
    what is missing and exactly one `WARN`. An empty `conformance` object is a
    fully conforming service, so a reader needs no vocabulary to read one.
  - **`/DeviceInstance` absent falls back to `0`** — a real value rather than
    `null`, because consumers key on the instance and a service with none
    still has to be addressable. The gap is recorded in `conformance`, not
    hidden by the fallback.
  - **A `/DeviceInstance` collision within a class marks BOTH sides.** Two
    connected services of one class on one instance each carry
    `instance_collision`, because neither is the one at fault and reporting
    only the second would depend on scan order.
  - **A service that leaves the bus is retained** with `connected: false`
    under its cached name, and is removed only by an explicit `ForgetService`
    (`os/pkgs/mosd/mosd/src/bus.rs`) — which refuses a service that is still
    connected. A device that unplugs is a fact worth keeping, not an absence.
- **[proposed]** **Alarms** are items under `/Alarms/<name>`, integer-valued:
  `0` = ok, `1` = warning, `2` = alarm. No other alarm encoding is permitted
  on the bus.

## 7. D3 — Actions are writable items [implemented]

- **[implemented]** An action is an item under `/Actions/<verb>`. Its value
  **always reads `0`** — a constant, not a stored value. `/Actions/reboot` and
  `/Actions/poweroff` are served as one object per path exactly like a
  settings item (`os/pkgs/mosd/mosd/src/actions.rs` owns the verbs;
  `os/pkgs/mosd/mosd/src/tree.rs` projects and dispatches them). Writability is an
  explicit three-way `Access` on each projected leaf — read-only, setting,
  action — so an action is a case of its own rather than an entry bolted onto
  the writable-subtree list. **[proposed]** RFCT-084's update verbs arrive
  under this same rule as they land.
- **[implemented]** `SetValue` on an action item **triggers the action**, and
  **any** written value triggers it: the write *is* the trigger, so the value
  is accepted and ignored. The service forces the value back to `0` after the
  write and **emits a change signal even on the `0 -> 0` edge** — the forced
  re-zero is observable, so a subscriber sees the consumption edge of every
  trigger (the `VeQItemAction` semantics,
  `veutil ve_qitem_utils.hpp:146-162`). Because the value is constant, no diff
  of two projections can ever carry that edge; `os/pkgs/mosd/mosd/src/tree.rs` injects
  it into the **same coalesced `ItemsChanged` batch** as the live-state record
  of the request, so the edge costs no second signal and §1.1's coalescing
  guarantee is not spent on it.
- **[implemented]** The `SetValue` **return code is the dispatch result**: `0`
  means the action was accepted and dispatched, a negative code means it was
  not — §1.1's table says *which* negative code, and `-5` exists precisely so
  that "accepted and would not dispatch" is not confused with a settings write
  that did not persist. Completion and progress, where they exist, are
  ordinary items elsewhere in the tree — the action item itself carries no
  state.
- **[implemented]** Existing safety properties are preserved unchanged, and
  preserved by **reuse** rather than by restatement: dispatch calls the
  existing `MosdService::request_reboot` / `request_power_off`
  (`os/pkgs/mosd/mosd/src/bus.rs`), so `note_power_request` still writes the tracing
  line and the live-state power record **before** the power call — the current
  `Reboot` contract, which a second implementation of it could have drifted
  from. The trigger is attributed to its caller through the message header
  (`bus::sender_of`), so a reboot through the item is logged exactly as one
  through the method. apid's confirm-token gate stays in apid. The bus remains
  root-only by policy until PLAN-011 D5 lands, so the bus-side gate *is* the
  policy. What this ordering cannot promise on a real reboot is §11's fourth
  known limit.

This is what makes a value-only remote bridge sufficient: Venus's MQTT bridge
carries only `SetValue` (`dbus-flashmq/src/state.cpp:317-354`) and that is
enough to reboot, update and reconfigure a remote device. It resolves the
actions-as-items-vs-methods fork recorded in `docs/research/venus-os-ui.md`
§7 item 2 and left open in `docs/design/api.md`'s research appendix — in
favor of items. `POST /api/v1/actions/<verb>` becomes a thin mapping onto
these items with no HTTP-visible change.

**[implemented]** apid's power pane is that mapping today: `reboot()` and
`power_off()` write `/Actions/reboot` and `/Actions/poweroff` through
`com.mos.Item1` (`os/pkgs/mosd/apid/src/bus_client.rs`), and only the code `0` is read
as success — apid names no failure code, so mosd's failure vocabulary can grow
without it. The switch sits **below** the `SettingsApi` trait and
`os/pkgs/mosd/apid/src/routes.rs` was not modified, so the routes, the confirm-token
gate and the `202 Accepted` are byte-for-byte what they were. The
`com.mos.mosd1` `Reboot` and `PowerOff` methods are **still served** and are
neither deprecated nor removed (§1.2); apid simply no longer calls them.
`docs/task/RFCT-090.md` §"The D3 fork, resolved in writing" records the
same resolution from the API side; api.md's §10 register, where it was first
written, was deleted whole (RFCT-122).

## 8. Structural redaction is a bus-level contract [implemented]

**[implemented]** The rule `docs/design/api.md` states for `/api/v1/settings/`
(around `docs/design/api.md:1286`) applies to the bus itself: **the value of
any key named `password_hash`, `passwordHash`, `psk`, or `hash` — anywhere in
the tree, at any depth — never appears on the bus.** Not in `GetItems`, not
in `ItemsChanged`, not through `GetValue`. The redaction is **structural** (a
match on the key name at any depth), not a list of dot-paths, because the
`psk` fields sit inside arrays that the dot-path syntax cannot name. In mosd
this is `tree::redact` (`os/pkgs/mosd/mosd/src/tree.rs`), one function that every
projection passes through — including inside arrays.

Consequences, stated once:

- **[implemented]** Redaction happens in the publishing service, **before**
  serialization — a bus consumer, including the M3 MQTT bridge, never holds
  the secret and needs no masking logic of its own. The bridge's
  publish-side masking (PLAN-011 D6) is defense in depth, not the primary
  control; it shipped in `os/pkgs/mosd/mqttd/src/payload.rs`, applies this same
  structural rule to every payload leaving that process, and should find
  nothing to mask.
- **[implemented]** The residual risk is api.md's, inherited: this is a
  denylist, so a future secret-bearing field under a name not on the list is
  exposed by default. The mitigation is a test asserting the redacted tree,
  not a hope — `os/pkgs/mosd/mosd/tests/tree.rs::secret_values_appear_in_no_get_items_and_no_signal`
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
the M3 bridge implements from, and what M3 implemented.

### 10.1 The mos-native grammar, as shipped in `mos-mqttd` [implemented]

The M3 bridge (`mos-mqttd`, the `os/pkgs/mosd/mqttd/` workspace crate) speaks the
dbus-flashmq-shaped protocol, field-proven for a decade against exactly this
tree shape. It was a candidate when this section was written and it is code
now, so each statement names where it lives:

- **[implemented]** Topic grammar:
  `N|R|W/<deviceId>/<class>/<instance>/<path>` — `N` (notification,
  device→broker), `R` (read request, broker→device), `W` (write request,
  broker→device). Building and parsing are one module,
  `os/pkgs/mosd/mqttd/src/topic.rs`, so the two cannot drift apart.
- **[implemented]** Payloads: `{"value": ...}` JSON, optional `min`/`max`
  alongside; an invalid item publishes `{"value": null}` (the §3 convention
  crossing to JSON, where `null` is expressible) —
  `os/pkgs/mosd/mqttd/src/payload.rs`. The **zero-length** payload is a different
  thing and deliberately so: it is the *retained* clear published per known
  topic when the device vanishes, which deletes the retained message, where
  `{"value": null}` says the item is present and currently invalid.
- **[implemented]** Liveness: a keepalive request arms a **60 s** window and
  triggers a **rate-limited full republish** of the tree, terminated by
  exactly one `full_publish_completed` carrying the item count; the device
  emits a **3 s** heartbeat carrying its monotonic uptime —
  `os/pkgs/mosd/mqttd/src/bridge.rs`, timings in `os/pkgs/mosd/mqttd/src/config.rs`. The
  keepalive itself is never throttled — it always renews the window — but the
  republish it asks for is, behind a **5 s** floor that collapses a keepalive
  storm into at most one immediate plus one deferred republish. The republish
  is served from the bridge's own mirror of the tree (seeded by `GetItems`,
  maintained by `ItemsChanged`), so a keepalive storm cannot become a
  `GetItems` storm against mosd. Publication uses QoS 0 throughout, because
  the protocol's recovery mechanism *is* the keepalive-triggered republish.
- **[implemented]** The window is a **publishing** gate, not a control gate:
  an `N`, an answer to an `R`, the heartbeat, a republish and a vanished
  device's clears are all silent outside it, while a `W` is carried through
  whether or not anyone is listening. Clears owed while the bridge is silent
  survive until it is alive again (`os/pkgs/mosd/mqttd/src/bridge.rs`).
- **[implemented]** Modes: **read-only** — the default, so a bridge nobody
  configured cannot become a control path — versus **full**
  (`os/pkgs/mosd/mqttd/src/config.rs`). Read-only publishes `N` and answers `R`, and
  refuses `W`: it does not subscribe to the `W` filter and refuses a `W` that
  arrives anyway. Full carries `W` through to `SetValue`, which is sufficient
  for all control, by §7. (While the mode was a proposal this document said
  *"N only; R/W ignored"*; the shipped rule is the narrower one stated here,
  because an `R` is a read and the gate that governs it is the alive window,
  not the mode.)
- **[implemented]** No acknowledgement: the grammar has no result topic and
  the bridge invents none. A `W` becomes a `SetValue` and stops there, so a
  subscriber observes success as the `N` that the resulting `ItemsChanged`
  produces — for an action, the forced re-zero of §7 — and a refusal is
  precisely the absence of it. The distinction a remote client actually needs,
  a settings write that did not persist being safe to retry where a dispatched
  action is not (§1.1's `-4`/`-5`), is drawn from the **path** rather than the
  code, in `os/pkgs/mosd/mqttd/src/source.rs`, so it stays correct however the
  negative vocabulary grows.

### 10.1a How the bridge is installed, and what that cost [implemented]

M3 shipped the crate, the unit file and fourteen protocol tests, and shipped
them nowhere: nothing installed `mos-mqttd` into the image. The wiring is
`os/rootfs/build-v2.sh` (staging), `os/rootfs/scripts/mosd-install.sh` (install and
enable) and `os/pkgs/mosd/hack/build-aarch64.sh` (cross-build), and it is asserted by
the MQTT bridge checks in `os/verify/src/checks-mqtt.ts`, driven offline from
fixtures by `checks-mqtt.test.ts`. (Both were `check_mqttd` in
`os/verify-image-v2.sh` and `os/tests/ui-location-test.sh` until RFCT-110 M4e
ported them and deleted those two files.) Three properties are worth stating here rather than
leaving in the unit, because each was a defect the wiring exposed and none of
them is visible from the code side.

- **[implemented]** The bridge runs as the **static system account
  `mos-mqttd`** (uid/gid pinned to 990 in `os/rootfs/scripts/account-mos-mqttd.sh`), not
  under `DynamicUser=yes` as M3's unit did. `com.mos.mosd` is a root-only bus
  name, so a non-root bridge needs an explicit grant, and `<policy user=>`
  resolves its user when dbus-daemon reads the file at startup — before any
  dynamic user for the unit exists. The rule would have loaded and matched
  nothing, and the bridge would have connected to the broker and published
  nothing, with no error at the point of cause.
- **[implemented]** That grant is `os/pkgs/mosd/dist/mos-mqttd.conf`, and it is
  **per-member**: `GetItems` and `SetValue` sent, `ItemsChanged` received, and
  nothing else. This is the split `com.mos.mosd.conf` recorded as deferred
  until "a non-root client needs GetSettings and GetState and must NOT reach
  Reboot or SetTransientRootPassword". The bridge is the only daemon in the
  image holding a network socket, so a blanket `send_destination` would have
  made a compromise of it into `Reboot`, `PowerOff`, `SetSettings` and
  `SetTransientRootPassword`. `os/pkgs/mosd/hack/dbus-policy-test.sh` §6 drives the
  grant on a real dbus-daemon loading both shipped files, in both directions
  and against a second unprivileged uid.
- **[implemented]** The bridge's broker **address** is not in the image. The
  root is an immutable dm-verity squashfs, so a literal `--broker-host` would be
  the same host on every device flashed with it, and `systemctl edit` has
  nowhere to write. `ExecStart` takes `${MOS_MQTT_BROKER_HOST}`,
  `${MOS_MQTT_BROKER_PORT}`, `${MOS_MQTT_CLIENT_ID}` and `${MOS_MQTT_MODE}` from
  an optional `EnvironmentFile=-/var/lib/mos/mqttd.env`, which sits on a
  STATE-backed bind (`var-lib-mos.mount`) and therefore survives a reboot and an
  A/B update. An unconfigured device runs on the unit's `Environment=` defaults
  rather than failing to start. (Until RFCT-104 this bullet read *"The broker
  address is **not in the image**"* without qualification, and that sentence was
  doing two jobs at once. The address is still not in the image, for exactly the
  reasons above, and none of that reasoning has changed. **A broker now is** —
  §10.1b — so the default those variables fall back to, `localhost:1883`,
  resolves to something real for the first time. The unqualified statement was
  written on an image where it did not, and read as though the absence of a
  configured address also settled the absence of a broker. It did not; those are
  two decisions, and only one of them was ever made here.)

**Reconnect backoff, and why it belongs to this crate.** `rumqttc` 0.25's
`EventLoop::poll` reconnects with no delay of its own, and its
`connection_timeout` bounds a connect that hangs, not one that is *refused* —
which returns immediately, and is the default case on a device whose operator
has not configured a broker yet. The bridge therefore backs off itself, 1s
doubling to a 30s ceiling and reset by any successful poll
(`os/pkgs/mosd/mqttd/src/runtime.rs`). Without it the event loop spins as fast as the
kernel returns ECONNREFUSED, pegging a core and writing a warning per
iteration into a journal on the STATE partition. The upstream premise is held
by a test that fails if rumqttc ever grows a backoff of its own.

### 10.1b The broker the bridge connects to [implemented]

§10.1a's bridge was installed, enabled and pointed at `localhost:1883` by
default, and no shipped image carried anything listening there. The bridge had
therefore never once connected — it had only ever retried, warning every 30s
against a broker that was not in the image. RFCT-104 put one there and gave the
pair a switch.

- **[implemented]** A broker **is** in the image: `/usr/bin/mos-mqtt-broker`,
  installed by `os/rootfs/scripts/mosd-install.sh` from `os/pkgs/mosd/broker/`, which is rumqttd
  0.20 used as a **library** with `default-features = false`. It runs as the
  static system account `mos-mqtt-broker` (uid = gid = 969, created in the same
  Dockerfile), for the reason the bridge's account is static but not the same
  one: the broker reads a credentials file on STATE, and a uid allocated at
  start names nobody on the next boot.
- **[implemented]** It ships **inert**. `os/rootfs/scripts/mosd-install.sh` installs
  `mos-mqtt-broker.service` and deliberately does not create the
  `multi-user.target.wants` symlink, so nothing starts it at boot;
  `os/pkgs/mosd/broker/dist/mos-mqtt-broker.service` keeps its `[Install]` section
  anyway, so `systemctl enable` stays meaningful to anyone debugging. The image
  assertion is the broker family in `os/verify/src/checks-mqtt.ts`, driven
  offline from fixtures by `checks-mqtt.test.ts` — including the fixture that
  creates the symlink and requires the check to fail.
- **[implemented]** `mqtt.enabled` starts it. `MqttReconciler`
  (`os/pkgs/mosd/mosd/src/reconciler/mqtt.rs`, `name()` and `subtree()` both `"mqtt"`)
  enables and starts `mos-mqtt-broker.service` and then `mos-mqttd.service` on
  true, and stops the bridge before the broker on false — the client before the
  server it talks to, so a deliberate shutdown does not read as a connection
  failure in the bridge's journal.
- **[implemented]** The broker's **own** listen address, port and auth flag are
  not in the image either, and for the same dm-verity reason as the bridge's
  broker address. mosd renders all three into `/run/mos/mqtt-broker.toml` from
  the `mqtt` settings subtree before it starts the unit; the unit's `ExecStart`
  is `/usr/bin/mos-mqtt-broker --config /run/mos/mqtt-broker.toml` and it
  carries `ConditionPathExists` on that file, so "mosd has not configured me" is
  a skipped start rather than a failed one.
- **[implemented]** No credential is in the settings tree. `MqttAuthSettings`
  carries `enabled` and nothing else. mosd publishes the settings tree over
  `com.mos.Item1` (§1), so a password under `mqtt.auth` would be a published
  password and would need a new entry in §8's structural redaction
  (`os/pkgs/mosd/mosd/src/tree.rs`) — this contract's territory, and an escalation
  rather than something a settings key may assume. The broker reads its accounts
  from
  `/var/lib/mos/mqtt-broker-users.toml` on STATE instead, which is how the
  device password is already handled: the tree carries the policy, the STATE
  file carries the secret.
- **[implemented]** `mqtt` is **not** in `WRITABLE_SUBTREES`, matching
  `container`. The switch is reachable from apid's `/mqtt` pane
  (`os/pkgs/mosd/apid/src/routes.rs`) and not over the item tree; bus writability is
  unchanged by this work.

The switch is a **master switch and nothing else**: `mqtt.listen` and
`mqtt.auth` are deliberately not coupled to it, and nothing refuses to start on
any combination of them. A broker bound off-host with authentication disabled
earns a WARN from the reconciler and an `error_box` notice on the pane; it does
not earn a gate. The full reasoning, the measured cost of rumqttd against mosquitto, and
the supply-chain decision that came with it are in RFCT-104 and PLAN-011 D7.

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

## 11. Known limits of the shipped item tree

Five properties of what M1 and M2 shipped that a reader would otherwise
discover by hitting them. Each is a **decision with a reason**, recorded here
so it is a documented decision rather than tribal knowledge, and each names
what would change it. They are limits of the implementation, not exceptions to
the contract above.

1. **[implemented]** **An unknown object path answers with the D-Bus
   `UnknownObject` error, not `-1`** (`os/pkgs/mosd/mosd/src/tree.rs`). This is not a
   gap in §1.1's vocabulary; it is where the vocabulary stops being reachable.
   zbus dispatches by **exact** object path with no subtree or fallback
   handler, so answering a return code at an arbitrary path would mean
   registering an object at every path a client might guess — an unbounded
   set. And because the `SetValue` contract *is* a method return code, there
   is no method to return one from when no object exists. The error is also
   the more informative answer: every D-Bus client library surfaces
   `UnknownObject` distinctly, while `-1` is an integer a caller must know to
   interpret. The façade's internal `-1` branch **stays** — it is the answer
   to the real race, a path that existed when the client read the tree and did
   not when it wrote — and is asserted in both directions.

2. **[implemented]** **A settings key that is not a valid D-Bus object-path
   element gets no item object, and that is handled and expected, not open.**
   The realistic cases are `network.br-lan` — a D-Bus path element admits
   `[A-Za-z0-9_]` only, so the hyphen has no spelling — and, since M5, every
   entry of the service registry, which is keyed by bus name and a bus name
   always contains dots. Such a key is **not lost** — it still reads through
   `GetItems`, it still changes through `ItemsChanged`, and it is still
   writable through `SetSettings` — it is only unaddressable as an object, so
   `GetValue` and `SetValue` cannot reach it. Because the registry makes the
   condition certain at every boot rather than possible, it is logged as the
   expected case it is: `sync_objects` records a key that cannot be a path
   element at DEBUG and keeps `WARN` for a registration failure at a path
   that IS valid — a warning that fires during correct operation warns
   nobody (RFCT-094). Asserted against the daemon's own log by
   `os/pkgs/mosd/mosd/tests/tree.rs::a_dotted_key_syncs_through_get_items_without_a_warn`.
   The tree keeps refusing such keys rather than escaping them; this is §4's
   dot-path limit's sibling one layer down, and the bus adds no escape syntax
   for either.

3. **[implemented]** **A reconciler's live-state key can shadow a settings
   top-level key, and the projection is ambiguous at that path.** The two
   trees flatten into one map (§1.1), so a live-state key that collides with a
   settings key produces one path whose origin a reader cannot tell. It is not
   reachable in dry-run, and the collision cannot *widen* anything: live state
   is never writable, so a shadowed path is read-only whichever side wins and
   no shadow can make a read-only item writable by accident. A future
   reconciler naming a top-level key after a settings subtree is what would
   make this real.

4. **[implemented]** **On a real reboot there is no guarantee the forced
   re-zero signal reaches a subscriber before the process is torn down.** The
   `0 -> 0` consumption edge (§7) is emitted, but systemd stops mosd on the
   way down and a subscriber may never be scheduled to read it. This is
   inherent to rebooting rather than a defect in the signal path, and it is
   the reason the request is logged and recorded in live state **before**
   dispatch: the durable record of a trigger is the live-state record, which
   survives the reboot, and the signal is best-effort on top of it. Ordering
   the record first is what makes the signal as likely to arrive as it can be.

5. **[implemented]** **The item façade redacts secrets and `GetSettings` does
   not. This divergence is deliberate, and harmonising the two in either
   direction breaks something.** `tree::redact` strips every key named
   `password_hash`, `passwordHash`, `psk` or `hash` at any depth
   (`os/pkgs/mosd/mosd/src/tree.rs:43`) and every projection passes through it
   (`os/pkgs/mosd/mosd/src/tree.rs:217`), so no `GetValue` reply and no `ItemsChanged`
   payload can carry a secret (§8). `GetSettings` applies no redaction at all —
   it returns the requested subtree verbatim (`os/pkgs/mosd/mosd/src/bus.rs:282-286`).
   The façade redacts because it is the surface that leaves the device: the M3
   MQTT bridge publishes from the item tree (§8), so a secret that reached an
   item would reach a broker. `GetSettings` **cannot** redact, because apid
   authenticates against a value it reads through it — `login_submit` calls
   `get_settings("access")` (`os/pkgs/mosd/apid/src/routes.rs:4337`) and lifts
   `webAdmin.password_hash` out of the reply (`os/pkgs/mosd/apid/src/routes.rs:4313`,
   helper at `:3194-3199`) to verify the submitted password against the stored
   argon2id hash. Redacting that key from `GetSettings` would harden nothing
   reachable from the bus — the façade already covers that surface — and would
   lock every operator out of the dashboard. What keeps a verbatim
   `GetSettings` from being a disclosure is that `com.mos.mosd` is root-only in
   both directions (`docs/design/api.md` §1.3), not that its callers are
   trusted to be careful. What would change this is a verification method on
   mosd — a `VerifyAdminPassword(password) -> bool` that moves the comparison
   behind the bus — after which `GetSettings` could redact like the façade
   does. Until that exists the asymmetry is the design, and a change that
   "harmonises" it is a change that breaks login.
