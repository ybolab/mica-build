# PLAN-011 Device bus v2 - com.mos.* item tree, actions as items, and extension service lifecycle

- **status**: implementing
- **createdAt**: 2026-08-21 14:25
- **approvedAt**: 2026-08-21 14:58 (user directive: dispatch via BKD L1)
- **completedAt**: -
- **relatedTask**: RFCT-089 (M1, complete 2026-08-21), RFCT-090 (M2, complete 2026-08-21), RFCT-091 (M3, complete 2026-08-21) — campaign 1; M4–M6 tasks created on their dispatch
- **milestones**: M1 **complete 2026-08-21** — `docs/design/bus.md` records the D1/D2/D3 contract and the D6 Sparkplug B evaluation (native grammar only), and the read-only `com.mos.Item1` façade (`GetItems`, coalesced `ItemsChanged`, redaction) ships in `mosd/mosd/src/tree.rs`; M2 **complete 2026-08-21** — the write half ships: `GetValue`/`SetValue` on per-item object paths with the five platform-config subtrees writable and `/Actions/reboot` + `/Actions/poweroff` as action items (`mosd/mosd/src/tree.rs`, `mosd/mosd/src/actions.rs`), apid's power pane driving them with HTTP byte-for-byte unchanged (`mosd/apid/src/bus_client.rs`), and D3's actions-as-items fork resolved in `docs/design/api.md` §10.3; M3 **complete 2026-08-21** — the bridge ships: `mos-mqttd` (`mosd/mqttd/`, a new workspace crate plus `dist/mos-mqttd.service`) publishes the item tree in the mos-native grammar D6 chose, with the protocol as a pure state machine (`mosd/mqttd/src/bridge.rs`) tested against an in-memory transport double rather than a broker in CI, and `docs/design/bus.md` §10.1 flipped to `[implemented]` with paths; image wiring, multi-service publication (D5's registry) and TLS are recorded as deferred in RFCT-091; M4–M6 outstanding

## Context

### Where this plan comes from

A source-level study of Venus OS's control layer was completed on 2026-08-21
(shallow read-only clones under `/srv/tmp/venus-src/`: gui-v2 + veutil,
venus-platform, localsettings, velib_python, dbus-flashmq, dbus-systemcalc-py,
dbus_modbustcp). It extends the 2026-08-19 studies
(`docs/research/venus-os-ui.md`, `docs/research/venus-os-access.md`) from
"what the UI does" down to "how the control plane is built". The findings that
drive this plan:

1. **Venus's control layer is one value tree, not an API.** Every producer —
   drivers, the platform daemon, the settings store — publishes a
   `com.victronenergy.*` service speaking one tiny interface
   (`GetValue/SetValue/GetItems/ItemsChanged`); every consumer — the on-device
   UI, the remote WASM UI, the MQTT bridge, the Modbus server, the system
   aggregator — is a client of the same tree. One contract carries the whole
   product.
2. **Actions are writable items, not methods** (`veutil
   ve_qitem_utils.hpp:146-162`: value always 0, a write triggers the side
   effect, the value is forced back to 0). Consequence: the MQTT bridge
   (`dbus-flashmq/src/state.cpp:317-354`) carries *only* `SetValue` — and that
   is sufficient to reboot, update, and reconfigure a remote device. A
   value-forwarding bridge cannot carry a D-Bus method; Venus never needs it
   to.
3. **Third-party services self-register.** A driver publishes its own
   `com.victronenergy.<class>.<suffix>` name with mandatory paths
   (`/Mgmt/*`, `/DeviceInstance`, `/ProductId`, `/Connected`); consumers
   discover it via `NameOwnerChanged` on the name prefix; instance collision
   is resolved server-side in the settings store
   (`localsettings.py:612-664`); serial-attached drivers are started by
   udev-driven probing (serial-starter), and optional services are
   materialized from templates on demand (`svectl`).
4. **What we deliberately do not copy** (confirmed in source): the fleet-wide
   `"ZZZ"` client-side access password, `GetText` (gui-v2 itself declines the
   server-formatted string), root-password-change via a bus item shelling to
   `chpasswd` on a remounted rootfs, daemontools supervision, and dynamic
   settings registration *into the core schema* (localsettings has no schema,
   no migration, and factory-resets on a corrupt file —
   `localsettings.py:890-894`).

### What mos has today

- One management service, `com.mos.mosd1`, with **six methods**
  (`GetSettings/SetSettings/GetState/Reboot/PowerOff/SetTransientRootPassword`)
  and one signal (`SettingsChanged`) — `mosd/mosd/src/bus.rs`,
  `docs/design/mosd.md` §5.4. RFCT-084 (in progress) is adding update
  orchestration members to the same surface.
- A typed settings tree (schema v4, TOML on STATE, forward migrations,
  `deny_unknown_fields`) and a live-state tree fed by five reconcilers with
  the named-outcome contract — `docs/design/mosd.md` §5.1–5.3. The
  settings/live-state split was borrowed from Venus by design.
- apid as the only bus client; the proposed HTTP API (`docs/design/api.md`,
  all `[proposed]`) models actions as verbs (`POST /api/v1/actions/<verb>`).
  api.md's own research appendix records the actions-as-items-vs-methods fork
  as unresolved.
- A written D-Bus policy extension recipe (grant a future non-root identity
  its own `<policy user>` block; never reopen the default context) —
  `mosd/dist/com.mos.mosd.conf`.
- No third-party service story at all: `extensions/` is a historical
  placeholder; the only extension points are UI bundles (`/srv/ui`), new
  in-tree reconcilers, and the not-yet-built PLAN-010 M6 container workload
  layer. Nothing today lets a customer's daemon publish data or persist
  settings.

### Why now

The product is an industrial appliance base (CX3576: CAN, serial, WiFi/BT).
An industrial-IoT deployment needs exactly the three things Venus proves out:
a uniform device data model that one remote bridge can carry, a way for
integrators to add device drivers without forking the OS, and
settings/telemetry conventions that field tools can rely on. The design cost
of these decisions is front-loaded: the `/api/v1` surface, the RFCT-084 bus
additions, and any remote bridge all hard-code the answer to "are actions
items or methods". Deciding once, now, is cheaper than migrating three
surfaces later.

## Proposal

Six decisions (D1–D6), then six milestones (M1–M6). The core rule carried
throughout: **mosd's discipline is not negotiable** — typed core schema with
priced migrations, read-only root, runtime-scoped units, named outcomes,
secrets never on the bus. Venus contributes the *shape* of the contract, not
its permissiveness.

### D1 — One item interface: `com.mos.Item1`

A single D-Bus interface for addressable values, spoken by every `com.mos.*`
service (mosd first, extensions later):

- `GetValue() -> v`, `SetValue(v) -> i` (0 ok, negative error codes), on every
  item object path.
- On the service root only: `GetItems() -> a{sa{sv}}` (bulk read: absolute
  path → `{value, writable, min?, max?, unit?}`) and signal
  `ItemsChanged(a{sa{sv}})`, coalesced per event-loop turn (the veutil
  pattern: accumulate, flush once — `ve_qitem_exported_dbus_service.cpp:241`).
- **No `GetText`.** Formatting is a client concern; metadata (`unit`,
  min/max) travels in `GetItems`. This is a deliberate deviation, justified
  by Venus's own UI declining GetText.
- Invalid value = absent key in `GetItems` / empty-array sentinel on
  `SetValue`, documented once in the contract (Venus's convention, stated
  instead of implied).
- Bus object paths are the slash form of the internal dot-paths
  (`network.eth0.dhcp` ↔ `/network/eth0/dhcp`); the dot-path remains the
  canonical internal address, so apid and `/api/v1` need no renaming.

mosd's existing methods are **not removed** in this plan: the item tree is a
façade over the same store (single writer), the methods become thin wrappers,
and their deprecation is a later decision once apid consumes the tree.

### D2 — Service naming, mandatory paths, and the class registry

- Names: `com.mos.<class>[.<suffix>]`, one service per functional instance.
  `mosd` keeps `com.mos.mosd` (management core is a class of its own).
- Mandatory paths on every service: `/Mgmt/ProcessName`,
  `/Mgmt/ProcessVersion`, `/Mgmt/Connection`, `/DeviceInstance`,
  `/ProductId`, `/ProductName`, `/Connected`. Alarm convention:
  `/Alarms/<name>` with 0=ok, 1=warning, 2=alarm.
- A **class registry** lives in the design doc (M1), starting deliberately
  small and industrial: `io` (digital/analog I/O), `serial`, `can`, `sensor`,
  `meter`, `gps`. Growing the registry is a doc change, not a code change.
  Energy-domain classes are explicitly out of scope until a product need
  exists.

### D3 — Actions are writable items

`/Actions/<verb>` items (`/Actions/reboot`, `/Actions/poweroff`, RFCT-084's
update verbs as they land): value always reads 0; `SetValue` triggers the
action and forces the value back to 0; the `SetValue` return code is the
dispatch result. Semantics copied from `VeQItemAction`, including the
force-emit on 0→0 so observers see the consumption edge.

- Existing safety properties are preserved: the action is logged and recorded
  in live-state *before* the power call (current `Reboot` contract), and
  apid's confirm-token gate stays in apid — the bus remains root-only until
  D5's policy lands, so the bus-side gate is the policy itself.
- `docs/design/api.md` §2's `POST /api/v1/actions/<verb>` becomes a thin
  mapping onto these items — no HTTP-visible change.
- This closes the fork recorded in `venus-os-ui.md` §7 item 2 in favor of
  items, with the rationale: it is the property that makes M3's value-only
  remote bridge sufficient.

**Platform-configuration coverage (user directive, 2026-08-21).** All
platform configuration goes over the bus as writable items: the existing
subtrees — `hostname`, `network` (wired), `wifi.client`, `wifi.ap`,
`access.ssh` — become writable through `com.mos.Item1` in M2, applied by
their existing reconcilers exactly as today (the tree is a façade over the
same store; reconcilers do not change). **Bluetooth** is the one platform
subsystem with no settings subtree and no reconciler yet (only board-level
bring-up, `mos-bt.service`); it remains PLAN-008's outstanding scope — a
`bluetooth` settings subtree plus a bluez-backed reconciler — and the moment
that subtree exists it surfaces through this tree and the M3 bridge with
zero bus-side work. PLAN-011 deliberately does not duplicate that work; it
provides the surface PLAN-008 plugs into.

### D4 — Extension settings: dynamic registration outside the core schema

Venus's `AddSettings` is the right *API* and the wrong *storage*. Split them:

- New interface on mosd, `com.mos.Settings1`:
  `RegisterSettings(aa{sv}) -> aa{sv}` (per entry: `path`, `default`, type
  inferred, optional `min`/`max`; idempotent; re-registration updates
  attributes but **preserves the current value** — localsettings'
  load-bearing behavior, `localsettings.py:504-509`).
- Registration is namespaced: only `ext/<service-name>/...` paths are
  accepted, where `<service-name>` is the caller's registered extension
  identity. The **core schema is untouched** — no dynamic keys, migrations
  and rollback pricing unchanged.
- Storage: one TOML per extension at `/var/lib/mos/ext/<name>/settings.toml`,
  atomic write, short debounce (flash discipline), loaded lazily. A rollback
  of the OS never migrates these files; an absent consumer simply leaves its
  file unread. Corrupt file = that extension's settings reset, never the
  core's (the blast-radius fix for localsettings' factory-reset-on-corrupt).
- Extension settings appear in the item tree under `/ext/<name>/...`, with
  the same redaction rule api.md mandates (`psk`/`password_hash`/etc.
  structurally masked).

### D5 — Extension service lifecycle: startup and registration (the svectl / serial-starter analog, systemd-native)

The user-facing capability: an integrator drops a service bundle on DATA and
the platform runs it, supervises it, and lets it publish on the bus — no
image rebuild, no forking mosd.

- **Bundle**: `/srv/ext/<name>/` with `manifest.toml` — `name`, `version`,
  `class` (from D2's registry), `exec`, optional `device` match rules
  (M6), optional description of the bus names it will claim
  (`com.mos.<class>.<name>`). Same DATA-mountpoint reasoning as the `/srv/ui`
  bundle store; absence of `/srv/ext` is a defined state.
- **Lifecycle owner**: a new `ExtensionReconciler` in mosd watching a new
  `extensions` settings subtree (`extensions.<name>.enabled`, schema bump
  with priced rollback: rolling back to v4 forgets which extensions were
  enabled — they stop; data and settings files remain). It renders a
  hardened systemd unit `mos-ext-<name>.service` into `/run/systemd/system`
  (runtime-scoped enable, pure render → compare → write, restart on change,
  named outcomes — the existing five-reconciler contract, stated as binding).
  Unit hardening defaults: dedicated per-extension user, `ProtectSystem=strict`,
  writable only its own `/srv/ext/<name>/data`, no new privileges.
- **Bus admission**: one shipped D-Bus policy file granting extension users
  `own`-rights to their declared `com.mos.<class>.<name>` names, following
  the recipe already written in `com.mos.mosd.conf` (never reopen the default
  context). The dbus-policy live test grows assertions for both grant and
  denial.
- **Registry**: mosd watches `NameOwnerChanged` (arg0namespace `com.mos`) and
  publishes live-state `services/<class>/<instance>` → bus name, `Connected`
  state, and last-seen identity. Disconnected services are retained with
  their cached name plus an explicit remove action (the Venus device-list
  behavior `venus-os-ui.md` §7 item 9 — a vanished driver is a diagnosis, not
  an absence).
- **Instance allocation**: `com.mos.Settings1.RegisterInstance(class,
  uniqueKey) -> u` — persisted map, server-side next-free-instance on
  collision (ClassAndVrmInstance semantics), so two CAN sensors never fight
  over instance 0.
- **Trust, phase 1**: installing a bundle requires root (SSH or the update
  channel) — the same honest baseline api.md §7 records for UI bundles.
  Bundle signing (reusing the CMS infrastructure) is designed in M5's doc as
  an upgrade path, not built in this plan.
- **Relationship to PLAN-010 M6**: container workloads are a second
  *execution backend* for the same registry — when balena lands, a
  containerized service registers on the bus identically. This plan
  implements only the native systemd backend and keeps the registry
  backend-agnostic.

### D6 — The MQTT data-publishing bridge (a primary deliverable)

MQTT data publishing is a stated product need (user annotation, 2026-08-21),
so the bridge is built as soon as its substrate exists — immediately after
M1/M2 — not at the end. D1+D3 are what make it a pure edge component.
`mos-mqttd`: topic grammar `N|R|W/<deviceId>/<class>/<instance>/<path>` with
`{"value": ...}` payloads, 60 s keepalive → full republish (rate-limited),
3 s heartbeat, secret masking at publish, and a read-only vs full mode —
the dbus-flashmq protocol shape, which venus-html5-app and field tooling
have validated for a decade. Extension services (D5) need no bridge-side
work when they arrive: any `com.mos.*` service the registry sees is
published through the same grammar automatically — that is the point of the
shared item contract. Before the bridge freezes, one recorded evaluation:
whether to *also* (or instead) map to **Sparkplug B** for industrial-IoT
interop — the mos-native grammar and Sparkplug differ mainly in envelope,
and the item tree supports either. The evaluation happens during M1 (contract
design) so the bridge milestone starts unblocked. Modbus TCP register
façade: noted as feasible (dbus_modbustcp pattern), out of this plan.

### Milestones

| M | Deliverable | Verify |
|---|---|---|
| M1 | `docs/design/bus.md`: the D1/D2 contract (interface XML, class registry, mandatory paths, alarm + invalid-value conventions, deviations from Venus recorded) **including the recorded Sparkplug B evaluation for D6**; mosd publishes the **read-only** item tree façade (`GetItems`/`ItemsChanged` over settings+state, redaction applied) | live-bus test: `GetItems` shape, signal coalescing, redaction; `mosd/hack/check.sh` green; coordinate with RFCT-084 so update state is in the tree from day one |
| M2 | Writable items + `/Actions/*` (D3): every platform-config subtree (`hostname`, `network`, `wifi.client`, `wifi.ap`, `access.ssh`) writable through `com.mos.Item1`; apid power pane consumes action items; api.md §10.3 fork entry resolved with citation | route tests unchanged in behavior; live-bus test: a `SetValue` on a settings item persists and schedules the owning reconciler (mock executors); action write triggers exactly once (mock power), value reads 0, log-before-call preserved |
| M3 | `mos-mqttd` (D6) — the MQTT data-publishing bridge over the M1/M2 tree | protocol tests covering N/R/W, keepalive republish, masking and read-only mode — **against an in-memory transport double, not a local broker**: M3 changed this cell deliberately, because a broker-backed test skips (and so reports green while asserting nothing) wherever no broker exists, and what it would add below the double is rumqttc's TCP client, which upstream tests. Rationale and the resulting gap — `runtime::run`'s wiring, which wants an on-device smoke test — recorded in RFCT-091 |
| M4 | `com.mos.Settings1`: `RegisterSettings` + per-extension persistence + `/ext/` tree projection (D4) | unit tests: idempotent re-register preserves value; corrupt ext file resets only that extension; rollback leaves core schema untouched |
| M5 | Extension lifecycle (D5): manifest, `ExtensionReconciler`, per-extension users + D-Bus policy, registry live-state, `RegisterInstance`; bundle-signing design recorded | reconciler tests (mock `UnitControl`); negative manifest tests; dbus-policy test asserts grant *and* denial; image verifier asserts policy file + unit template; **bridge test: a registered extension service's items appear on MQTT with no bridge change** |
| M6 | Device attach: udev rule → `mos-ext@<dev>` template instance from manifest `device` rules (serial-starter analog); `serial`/`can` classes exercised | offline: udev rule + unit rendering asserted by verifier; hardware claims explicitly **not** made (repo discipline) |

Each milestone dispatches its own RFCT tasks on approval (PLAN-010
convention). M1+M2 are the decision-critical pair and should land before the
`/api/v1` implementation freezes. M3 (the bridge) is deliberately early —
data publishing is a primary product need — and depends only on M1/M2;
M4–M6 are sequential but individually shippable, and M5 plugs into the
already-running bridge for free.

## Risks

- **Two write paths during transition.** Methods and items over one store:
  mitigated by making items the façade and methods wrappers (single writer
  inside mosd); divergence is a bug class the live-bus test must cover.
- **RFCT-084 collision.** It is extending `com.mos.mosd1` methods right now.
  M1 must rebase on its landed state and project its update state into the
  tree; sequencing noted in the milestone table.
- **D-Bus policy widening.** Today the bus is root-only by policy (RFCT-048).
  D5 grants extension users their own names only; the policy test must prove
  an extension user cannot own `com.mos.mosd` nor talk to it beyond the
  public interface. Getting this wrong reopens the hole RFCT-048 closed.
- **Flash wear** from chatty extension settings: debounced saves; the
  reconciler write-if-changed discipline applies to `/var/lib/mos/ext` too.
- **Signal fan-out cost** on a busy tree (zbus): coalescing per turn is the
  designed mitigation; M1's test asserts it.
- **Schema bump** (`extensions` subtree) prices a new rollback loss
  (enabled-set forgotten); must follow the additive-bump rule from
  RFCT-082's tolerant-load contract.
- **Scope creep** toward Venus's breadth (30 systemcalc delegates, energy
  classes): the class registry and the "no energy classes without a product
  need" line are the fence.
- **Unverifiable-on-hardware claims** (M6): kept offline-verifiable;
  hardware acceptance stays explicitly unclaimed, as everywhere in this
  repo.

## Scope

- New: `docs/design/bus.md`; item-tree façade + `Settings1` + registry +
  `ExtensionReconciler` in `mosd/mosd/src/`; one D-Bus policy file; unit
  template; `mos-mqttd` crate (M3); tests per milestone.
- Touched: `mosd-settings` (schema bump for `extensions`, ext-settings
  store), `bus.rs` (façade), apid power pane (M2), `docs/design/api.md`
  (§10.3 fork resolution), image verifiers (policy/unit assertions),
  `com.mos.mosd.conf` siblings.
- Untouched: core settings schema semantics, the five existing reconcilers,
  the update trust chain, `/srv/ui`, PLAN-010 M6's container backend.

## Alternatives

- **Keep methods, add gRPC/varlink for extensions** — rejected: a second IPC
  ecosystem, and it forecloses the value-only remote bridge (the single
  strongest property Venus demonstrates).
- **Adopt `com.victronenergy.BusItem` verbatim for wire-level Venus
  compatibility** — rejected for the core (drags in GetText, untyped
  settings, and their conventions wholesale); a separate
  compatibility-projection bridge remains possible later precisely because
  D1 is shape-compatible.
- **Dynamic settings in the core schema (full localsettings model)** —
  rejected: destroys migration pricing and `deny_unknown_fields`; the
  namespaced split (D4) keeps both worlds.
- **Static drop-in systemd units on DATA, no mosd mediation** — rejected:
  violates "an unmodelled setting is an unsupported setting", bypasses the
  registry, policy, and named outcomes.
- **Sparkplug B as the native bridge protocol** — deferred to the recorded
  M1 evaluation rather than rejected; the dbus-flashmq grammar is adopted
  first because it is field-proven against this exact tree shape.

## Annotations

- **2026-08-21 (user)**: "我们需要用mqtt之类的做数据发布、因此采用类似venuos类似比较好"
  — MQTT-style data publishing is a product need, so the Venus-like approach
  is the right one. **Response**: direction confirmed as the plan's basis;
  the MQTT bridge was re-sequenced from last (old M6) to immediately after
  the tree lands (new M3), the Sparkplug B evaluation was moved into M1's
  design doc so the bridge starts unblocked, and D6 was retitled from
  "design now, build last" to a primary deliverable. Extension services
  (M5) inherit bridge publication automatically via the shared item
  contract.
- **2026-08-21 (user)**: "平台配置，包括Wi-Fi和蓝牙 和有线网络配置，系统配置都可以走dbus"
  — platform configuration (Wi-Fi, Bluetooth, wired network, system config)
  all goes over D-Bus. **Response**: recorded as the coverage statement in
  D3's "Platform-configuration coverage" paragraph and in M2's deliverable:
  the existing subtrees (hostname, wired network, Wi-Fi STA/AP, SSH) become
  writable items in M2 with their reconcilers unchanged; Bluetooth has no
  settings subtree or reconciler yet — that is PLAN-008's outstanding scope,
  and it plugs into this tree and the M3 MQTT bridge with no bus-side work
  once it lands. PLAN-011 does not duplicate PLAN-008.
