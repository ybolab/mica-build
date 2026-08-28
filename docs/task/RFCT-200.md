# RFCT-200 PLAN-022 M1: native networking design — VLAN, bridge, WireGuard

- **status**: completed — design ratified by the user as PLAN-022 Amendment 1 (on main), which cleared the PLAN-022 M1 gate; M2-M4 are built on it
- **priority**: P1
- **owner**: bkd/dpbhjzx5
- **createdAt**: 2026-08-27
- **plan**: PLAN-022 (M1)
- **supersedes, once ratified**: the apid-side framing of RFCT-135 (that file is history and is not edited)

PLAN-022 M1 is the user-gated design for native networking: VLAN interfaces,
bridges and WireGuard, managed like everything else — settings tree → mosd
reconciler → apid forms/API. Nothing is implemented here. Every claim below is
either a `path:line` citation into the tree at the head of this branch or a
quoted measurement from a throwaway program run against the tree's own crates;
where a fact cannot be measured in-tree (the x64 kernel config), that is said
and a verification step is designed instead of an assumption.

Note on citations: RFCT-135 and PLAN-022 cite `mosd/...` paths from before
PLAN-019 moved the workspace; every equivalent fact below is re-measured at its
current `os/pkgs/mosd/...` location, and line numbers differ from RFCT-135's.

---

## 1. The current model, measured end to end

### 1.1 The settings model

The tree is schema v6 (`os/pkgs/mosd/mosd-settings/src/model.rs:11`). Network
configuration is a map keyed by interface name: *"Per-interface network
configuration, keyed by interface name."* (`os/pkgs/mosd/mosd-settings/src/model.rs:21-22`),
typed `BTreeMap<String, IfaceSettings>`. `IfaceSettings` carries
`#[serde(deny_unknown_fields)]` and exactly two fields, `dhcp: bool` and an
optional `static` block (`os/pkgs/mosd/mosd-settings/src/model.rs:405-413`);
`StaticConfig` is `address` (CIDR), optional `gateway`, and `dns`
(`os/pkgs/mosd/mosd-settings/src/model.rs:562-574`). There is no interface
type, no parent/child relation, and no tunnel anywhere in the model.

Writes go through `Settings::set` — `pub fn set(&mut self, path: &str, value: Value)`
(`os/pkgs/mosd/mosd-settings/src/model.rs:602`):
the path is split, the JSON tree is patched, and the whole candidate is
re-deserialized into `Settings` — `deny_unknown_fields` everywhere makes that
the validation step (`os/pkgs/mosd/mosd-settings/src/model.rs:465-469`).
`split_path` splits on `.` unconditionally
(`os/pkgs/mosd/mosd-settings/src/path.rs:26-32`), and the read side
`json_path_get` does the same (`os/pkgs/mosd/mosd-settings/src/path.rs:11-23`).

### 1.2 The dot-path collision, re-measured live

Run against the tree's own `mosd-settings` crate (throwaway crate in a scratch
directory, path-dependency on `os/pkgs/mosd/mosd-settings`, `cargo run`;
nothing left behind):

```text
SET network.eth0.100 -> Validation { path: "network.eth0.100", message: "unknown field `100`, expected `dhcp` or `static`" }
TOML: [network."eth0.100"]
ROUNDTRIP network keys = ["eth0.100"]
GET network.eth0.100 -> Err(NotFound("network.eth0.100"))
```

Four facts in one run:

1. The dot-path write of a VLAN name fails exactly as RFCT-135 and
   `docs/design/api.md:1199-1210` describe.
2. **The persistence layer already spells the key correctly**: serializing a
   tree that structurally contains the key `eth0.100` writes
   `[network."eth0.100"]` — TOML quoted-key syntax, produced by the `toml`
   crate the store already uses (`os/pkgs/mosd/mosd-settings/src/store.rs:244-245`).
3. Such a tree round-trips: load accepts it (the map takes any string key).
4. Only the dot-path accessor cannot address it, on the read side as well as
   the write side.

So a hand-edited `settings.toml` carrying `[network."eth0.100"]` loads and
reconciles **today** — the reconciler's own validator accepts `.` in a name
(`os/pkgs/mosd/mosd/src/reconciler/network.rs:166-173`) — and the only broken
layer is the path syntax. That is RFCT-135's conclusion, now measured: *"it is
the settings dot-path syntax, and the same limit blocks any key with a dot in
it"* (`docs/task/RFCT-135.md:28-29`).

### 1.3 apid: forms and write path

The `/network` pane is `.route("/network", get(network_form).post(network_submit))`
(`os/pkgs/mosd/apid/src/routes.rs:156`). `valid_iface_name` accepts 1–15 bytes
of alphanumerics plus `.`, `_`, `-` (`os/pkgs/mosd/apid/src/routes.rs:905-910`),
and the pane's error text advertises the dot
(`os/pkgs/mosd/apid/src/routes.rs:949`). `network_submit` builds the value
(`os/pkgs/mosd/apid/src/routes.rs:967-983`) and writes it as a dot-path,
`set_settings(&format!("network.{iface}"), &value)` (measured at `4580dfb` in
`os/pkgs/mosd/apid/src/routes.rs`, where the composition was unconditional;
RFCT-201 has since moved it into `iface_settings_path`), over D-Bus:
`fn set_settings(&self, path: &str, value_json: &str)` on `com.mos.mosd`
(`os/pkgs/mosd/apid/src/bus_client.rs:15-22`). The read-only API mirrors the
same dot-path at `GET /api/v1/settings/{*path}` (`docs/design/api.md:230`).

### 1.4 mosd: reconcile

`write_setting` is *"The ONE settings-write path inside the daemon"*
(`os/pkgs/mosd/mosd/src/bus.rs:453`): validate against the typed tree, persist
atomically (`os/pkgs/mosd/mosd-settings/src/store.rs:238-253` — temp file,
fsync, rename, directory fsync), then re-apply every reconciler whose subtree
overlaps the written path (`os/pkgs/mosd/mosd/src/bus.rs:430-446`,
`paths_overlap` at `:32-47`). `apply_all` runs at daemon start
(`os/pkgs/mosd/mosd/src/main.rs:244`), which is what makes rendering into a
tmpfs directory converge after boot.

The network reconciler renders **systemd-networkd** units — *"renders
systemd-networkd `.network` units and reloads networkd"*
(`os/pkgs/mosd/mosd/src/reconciler/network.rs:1-2`) — one
`50-mos-<iface>.network` per map entry into `/run/systemd/network`
(`os/pkgs/mosd/mosd/src/reconciler/network.rs:14`, `:451-458`), sweeps stale
units it owns by exact prefix (`:190-192`, `:221-230`), and reloads via the
`org.freedesktop.network1` `Manager.Reload` D-Bus call (`:33-45`). It is not
`ip`/netlink; there is no direct interface manipulation anywhere in the daemon.
The reconciler treats itself as the security boundary because *"The settings
file is editable by anything that can write STATE"*
(`os/pkgs/mosd/mosd/src/reconciler/network.rs:238-242`), re-validating names
(IFNAMSIZ 15, `os/pkgs/mosd/mosd/src/reconciler/network.rs:137`) and addresses
(`os/pkgs/mosd/mosd/src/reconciler/network.rs:194-200`) independently of apid.

### 1.5 The images

systemd-networkd is present and enabled on **every** image of **both** boards:
the shared install stage bind-mounts `os/rootfs/scripts` and runs
`sh /mos-scripts/network-and-ssh-units.sh`
(`os/rootfs/stages/20-install.Dockerfile:37-38`), which writes the image default
`80-dhcp.network`, runs `systemctl enable systemd-networkd systemd-resolved`,
force-creates the `multi-user.target.wants` symlinks and asserts them
(`os/rootfs/scripts/network-and-ssh-units.sh:6-21`). The base package set
installs `systemd` and `iproute2` on every board
(`os/rootfs/stages/10-base.Dockerfile:113-128`); the base image is Debian
trixie (`os/rootfs/stages/10-base.Dockerfile:64`). There is no
`wireguard-tools` anywhere in the stage chain (measured: `grep -rin wireguard
os/` matches only the kernel fragment and the cx3576 kernel config; see §5).
`hostapd`/`wpasupplicant` are installed only on boards that declare a radio
(`os/rootfs/stages/30-feature-radios.Dockerfile:32-33`), so nothing about this
design may depend on the radio userland.

### 1.6 Data-flow narrative

Form input (`NetworkForm`, `os/pkgs/mosd/apid/src/routes.rs:1792-1849`) →
apid validation (`:841-849`) → D-Bus `SetSettings("network.<iface>", json)`
(`:1527`, `os/pkgs/mosd/apid/src/bus_client.rs:22`) → `write_setting`
validates against the typed tree and saves TOML atomically
(`os/pkgs/mosd/mosd/src/bus.rs:430-435`) → overlapping reconcilers re-apply
(`:437-441`) → `NetworkReconciler::apply` re-validates, renders
`50-mos-<iface>.network`, sweeps, reloads networkd
(`os/pkgs/mosd/mosd/src/reconciler/network.rs:440-500`) → the apply result is
recorded in the live-state tree per reconciler name and served over D-Bus and
`GET /api/v1/state/network` (`docs/design/api.md:1337`).

---

## 2. The extended model

### 2.1 The dot-path fix: TOML-style quoted segments

**Decision: the dot-path syntax adopts TOML quoted-key spelling.** A path
segment is either *bare* (as today: no `.`, no `"`) or *double-quoted*, in
which `.` is literal: `network."eth0.100".dhcp`. Reads and writes share one
segment lexer in `mosd-settings` (`split_path`, `json_path_get`); apid's
writers quote any segment that contains a dot when composing paths such as
`format!("network.{}", quote_path_segment(iface))`
(`os/pkgs/mosd/apid/src/routes.rs:971`); paths the daemon
emits (validation errors, the `SettingsChanged` signal) use the canonical
spelling — quoted only when required.

Why this spelling and not another:

- **The tree already writes it.** The measured round-trip in §1.2 shows the
  persistence format spelling the key `[network."eth0.100"]` with no code
  change at all. An operator reading `settings.toml` on STATE and an operator
  typing an API path see the same syntax; the design adds zero new notation to
  the system, it teaches the accessor the notation the store already uses.
- **Rejected: backslash escaping** (`network.eth0\.100`). It stacks a second
  escaping layer under JSON (`"network.eth0\\.100"`) and URLs (`%5C`), it has
  no precedent anywhere in the tree, and a path that reaches the daemon
  through three transports (URL → JSON → D-Bus string) should not need
  transport-aware escaping to survive.
- **Rejected: bracket indexing** (`network[eth0.100]`). New grammar with no
  in-tree precedent, and it occupies the syntax a future array-index feature
  would want; the model explicitly documents that arrays are written whole
  (`os/pkgs/mosd/mosd-settings/src/model.rs:310-311`), and this design should
  not pre-empt that decision.
- **Rejected: structural dodge only** (never key by a dotted name; give VLANs
  synthetic keys). It leaves the path syntax broken for the general case,
  which RFCT-135 names as the real problem — the same limit blocks *any*
  dotted key, not just VLANs (`docs/task/RFCT-135.md:27-29`).

**Grammar edge, stated.** A key containing `"` becomes inexpressible, and a
bare segment beginning with `"` changes meaning. Measured mitigation: no
validated writer can produce such a key — apid rejects it
(`os/pkgs/mosd/apid/src/routes.rs:905-910`), the reconciler rejects it
(`os/pkgs/mosd/mosd/src/reconciler/network.rs:166-173`) — so only a whole-tree
root write or a hand edit could. Schema v7 (§7) adds model-level validation:
a `network` map key must be a valid interface name (non-empty, ≤15 bytes,
alphanumerics plus `. - _ :`), making the quote character structurally
impossible in a key rather than merely unaddressable.

**deny_unknown_fields consequences.** The map itself never denied anything —
`BTreeMap<String, _>` accepts any key — so quoting changes *addressability*,
not validation. The value at the quoted key is still deserialized into
`IfaceSettings` under `deny_unknown_fields`
(`os/pkgs/mosd/mosd-settings/src/model.rs:440-442`), so `network."eth0.100"`
must hold a valid interface body, and the whole-candidate re-deserialization
in `Settings::set` — `serde_json::from_value(root)`
(`os/pkgs/mosd/mosd-settings/src/model.rs:614`) — is untouched. The failure mode RFCT-135 describes — a *key* misread as a *field*
— becomes unrepresentable, because the quoted segment never reaches the struct
namespace.

### 2.2 Interface types and schema shape (schema v7)

`IfaceSettings` grows a discriminant and three optional blocks, all defaulted
and all `skip_serializing_if` so an existing tree serializes byte-identically
(this is load-bearing for rollback, §7):

```toml
[network.eth0]                    # kind absent = "physical" (default)
dhcp = true

[network."eth0.100"]              # the RFCT-135 case, now first-class
kind = "vlan"
dhcp = false
[network."eth0.100".static]
address = "192.168.100.2/24"
[network."eth0.100".vlan]
parent = "eth0"
id = 100

[network.br0]
kind = "bridge"
dhcp = true
[network.br0.bridge]
ports = ["eth1", "eth2"]

[network.wg0]
kind = "wireguard"
dhcp = false
[network.wg0.static]
address = "10.8.0.2/24"
[network.wg0.wireguard]
listenPort = 51820
[[network.wg0.wireguard.peers]]
publicKey = "<base64 x25519 public key>"
allowedIps = ["10.8.0.0/24"]
endpoint = "vpn.example.net:51820"     # optional
persistentKeepalive = 25               # optional, seconds
```

Rust shape: `kind: IfaceKind` (`physical | vlan | bridge | wireguard`,
`#[serde(default, rename_all = "lowercase")]`), `vlan: Option<VlanConfig>`,
`bridge: Option<BridgeConfig>`, `wireguard: Option<WireguardConfig>`; every
struct keeps `deny_unknown_fields`. **There is no private-key field anywhere
in the schema** — see §4; the absence follows the `MqttAuthSettings` argument
that a field in this tree is a value published to every bus client: *"There is
no username and no password here, and that absence is the point"*
(`os/pkgs/mosd/mosd-settings/src/model.rs:131-137`). Peer pre-shared keys are
deliberately **out of scope** for this schema revision: adding one later means
adding a secret-bearing field name to apid's redaction denylist
(`os/pkgs/mosd/apid/src/redact.rs:33`) in the same change, and the design
prefers to ship no secret field over shipping one more redaction obligation.

**Why a `kind` field plus optional blocks, not a serde-tagged enum.** An
internally tagged enum forfeits `deny_unknown_fields` (serde does not enforce
it through internal tagging), and that attribute is the tree's validation
mechanism (§1.1). Cross-field consistency — `kind = "vlan"` requires a `vlan`
block and forbids `bridge`/`wireguard` blocks; `kind = "physical"` forbids all
three; a bridge port must not carry `dhcp`/`static` of its own — is enforced
in the reconciler, where the tree's security boundary already sits and for the
already-recorded reason: *"apid validates the address on its write path, but
the settings file is writable without apid, so the boundary must hold here"*
(`os/pkgs/mosd/mosd/src/reconciler/network.rs:294-296`). apid enforces the
same rules earlier for a readable form error.

**Naming rules.** The map key **is** the kernel interface name, exactly as
today (`render_unit` interpolates it into `Name=`,
`os/pkgs/mosd/mosd/src/reconciler/network.rs:383-384`). `parent.id` as a VLAN
name (`eth0.100`) is convention, not requirement — the name is free within
IFNAMSIZ and the reconciler's charset (`:95-116`); the `vlan` block, not the
name, is authoritative for parent and id. A VLAN's `parent` and every bridge
`port` must itself be a declared `network.*` entry; the reconciler errors
otherwise (fail-closed, consistent with `:209` running validation before any
I/O). The wifi radios stay out of `network.*`: `wifi.client`/`wifi.ap` keep
their own reconcilers and their own `90-*` networkd namespace
(`os/pkgs/mosd/mosd/src/reconciler/wifi_ap.rs:70`), and the existing
sweep-prefix separation (`os/pkgs/mosd/mosd/src/reconciler/network.rs:408-417`)
is unchanged.

---

## 3. Reconciler mechanism: systemd-networkd, extended

**Decision: stay on systemd-networkd; add `.netdev` rendering to the existing
network reconciler.** Evidence:

- networkd is already the only engine: mosd renders units and reloads via
  `org.freedesktop.network1` (§1.4); it is enabled on every image of both
  boards (§1.5); the AP reconciler already leans on networkd's built-in DHCP
  server precisely to avoid a second daemon
  (`os/rootfs/stages/10-base.Dockerfile:110-112`).
- VLAN, bridge and WireGuard are native networkd netdev kinds
  (systemd.netdev(5) of the shipped trixie systemd; the M2 e2e suite must
  exercise all three on a real image rather than trusting this sentence —
  §5.2's verification step covers the kernel half, RFCT-203/204's tests the
  networkd half).
- **Rejected: direct `ip`/netlink management.** It would be a second engine
  racing the first — networkd still owns every link its units match — and it
  discards the declarative render-sweep-reload model whose convergence
  properties the tree already tests
  (`os/pkgs/mosd/mosd/src/reconciler/network.rs:702-730`). It would also pull
  WireGuard key handling into hand-rolled netlink code, the worst place for it.

**Mechanics.** For an entry with `kind != physical` the reconciler renders a
`50-mos-<iface>.netdev` beside the `.network` it already renders, and the
stale-file sweep (`os/pkgs/mosd/mosd/src/reconciler/network.rs:475-487`)
extends to the `.netdev` extension under the same `50-mos-` prefix. Kind
specifics:

- **vlan**: `.netdev` carries `Kind=vlan` + `Id=`; the *parent's* rendered
  `.network` gains one `VLAN=<child>` line per declared child (networkd
  creates a VLAN only when the parent's network unit names it) — which is why
  the parent must be a declared entry.
- **bridge**: `.netdev` carries `Kind=bridge`; each declared port's rendered
  `.network` becomes `Bridge=<br>` instead of an address block, and the
  reconciler rejects a port that carries `dhcp = true` or a `static` block.
- **wireguard**: `.netdev` carries `Kind=wireguard`,
  `PrivateKeyFile=<secrets path>` (§4), `ListenPort=`, and one `[WireGuardPeer]`
  per peer. Every peer value is re-validated by parse-and-re-render, the
  injection discipline the renderer already applies to addresses
  (`os/pkgs/mosd/mosd/src/reconciler/network.rs:195-198`): base64-decode the
  public key to exactly 32 bytes, parse `allowedIps` as CIDRs, parse
  `endpoint` as host:port.

**Teardown, stated honestly.** Removing a `.netdev` file and reloading does
not delete the kernel device networkd created; that is networkd behaviour, and
without handling it a deleted VLAN would keep passing traffic until reboot.
The reconciler therefore deletes the kernel device for exactly the virtual
devices whose `50-mos-*.netdev` files its sweep just removed (the swept file
names give the exact set), using `ip link del` — `iproute2` is in the base
image (`os/rootfs/stages/10-base.Dockerfile:122`). The same recreate path
serves key rotation (§4) and a changed VLAN id, since netdev properties apply
only at device creation.

**Blast radius.** The physical path is untouched: same file names, same golden
renders, same sweep prefix, same single reload per apply. The changes are
additive rendering (netdev files, `VLAN=`/`Bridge=` lines) plus the teardown
step, each behind `kind != physical`. Live state per interface gains `kind`
and, for WireGuard, `publicKey` — public by definition, matching the AP
precedent that live state carries only what is already public
(`os/pkgs/mosd/mosd/src/reconciler/wifi_ap.rs:759-761`).

---

## 4. WireGuard key lifecycle

The standard to meet is the AP PSK's, measured:

- Plaintext secrets live in `<state>/secrets/` — directory mode 0700
  (`os/pkgs/mosd/mosd/src/identity.rs:46`), file mode 0600 (`:49`), written
  atomically with mode applied to the temp file before the rename
  (`os/pkgs/mosd/mosd/src/identity.rs:282-311`), state dir
  `/var/lib/mos` on STATE (`:33`).
- The consuming config file is 0600
  (`os/pkgs/mosd/mosd/src/reconciler/wifi_ap.rs:57`), and the reconciler's
  contract is explicit: *"the pre-shared key reaches exactly one place, the
  0600 configuration file. It is never published in the live-state tree (which
  is served over D-Bus), never named in an error, and this module contains no
  logging statement at all"*
  (`os/pkgs/mosd/mosd/src/reconciler/wifi_ap.rs:22-25`).
- The API redacts secret-named fields structurally
  (`os/pkgs/mosd/apid/src/redact.rs:19`, `:25`).

**Design.**

1. **Storage.** One private key per WireGuard interface at
   `/var/lib/mos/secrets/wg-<iface>.key`, base64 (the `PrivateKeyFile`
   format), written by the same atomic secret writer
   (`os/pkgs/mosd/mosd/src/identity.rs:282-311`). One deviation from the AP
   PSK, forced and named: hostapd runs as root and reads its 0600 config, but
   systemd-networkd runs as its own user, so the key file is owned
   `root:systemd-network` mode **0640** — the ownership pattern
   systemd.netdev(5) documents for `PrivateKeyFile`. Never world-readable;
   the secrets directory stays 0700-root... which would block the group read,
   so `wg-*.key` files live in a sibling `secrets/networkd/` directory of mode
   0750 `root:systemd-network`. RFCT-204 must assert both modes in tests, and
   the M2 on-image check must confirm the `systemd-network` user reads it
   (alternative if it cannot: systemd import credentials
   `network.wireguard.private.*`; parked, more moving parts).
2. **Generation.** mosd generates the key lazily on the first reconcile of a
   `kind = "wireguard"` entry whose key file is absent: 32 bytes from the
   tree's CSPRNG (`ring`'s `SystemRandom`, already the identity generator's
   source, `os/pkgs/mosd/mosd/src/identity.rs:174-178`), clamped per X25519.
   Lazy-generate differs from the AP PSK's refuse-if-absent
   (`os/pkgs/mosd/mosd/src/reconciler/wifi_ap.rs:561-573`) for a stated
   reason: the AP PSK must match a value a human was given out-of-band, so
   inventing one silently would strand the operator; a WireGuard private key
   is machine-only and *must never* be given to anyone, so inventing it is the
   only correct behaviour. The fleet-wide-constant hazard the AP code guards
   against cannot arise: nothing is baked, every key is drawn on-device.
3. **Public key.** Derived in-process from the private key via `x25519-dalek`
   (one new pure-Rust dependency; the image ships no `wireguard-tools` to
   shell out to — measured in §1.5 — and the workspace's no-C posture rules
   out linking a C helper). Published in live state and therefore over
   `GET /api/v1/state/network` — it is the one thing the far end needs and is
   public by definition.
4. **API exposure.** The settings tree carries no key field, so `GET
   /api/v1/settings/...` has nothing to leak and nothing new to redact; the
   name `privateKey` is added to `SECRET_FIELDS`
   (`os/pkgs/mosd/apid/src/redact.rs:33`) anyway as a fail-closed guard
   against a future field. There is **no read-back route for the private key,
   ever** — not redacted-on-read; nonexistent.
5. **Rotation.** A new mosd bus method surfaced as
   `POST /api/v1/actions/wireguard/{iface}/rotate-key`: draw a new key, write
   it atomically over the old (same temp-and-rename, so no instant with a
   widened mode — the property the AP code states at
   `os/pkgs/mosd/mosd/src/reconciler/wifi_ap.rs:522-526`), then re-run the
   network reconciler, which recreates the device (§3 teardown path) because
   networkd reads the key only at netdev creation. Response carries the new
   public key. The old key is gone from disk on success; there is no key
   history and no export.
6. **Hygiene tests** (RFCT-204): the leak-canary pattern the AP tests already
   use — a distinctive secret asserted absent from live state, errors and
   rendered non-secret files
   (`os/pkgs/mosd/mosd/src/reconciler/wifi_ap.rs:816-817`) — plus mode
   assertions on directory and file, and a no-logging-statement rule for the
   keystore module.

---

## 5. Kernel config deltas, per board

### 5.1 cx3576 (vendor 6.1 tree, config in-repo)

Measured in `os/boards/cx3576/bsp/kernel/config/kernel-cx3576z.config`:

```text
1244:CONFIG_BRIDGE=y
1246:CONFIG_BRIDGE_VLAN_FILTERING=y
1250:CONFIG_VLAN_8021Q=y
1976:# CONFIG_BONDING is not set
1978:# CONFIG_WIREGUARD is not set
1982:CONFIG_MACVLAN=y
```

(`os/boards/cx3576/bsp/kernel/config/kernel-cx3576z.config:1244`, `:1246`,
`:1250`, `:1976`, `:1978`, `:1982`; WireGuard's crypto dependencies are also
"not set" in the vendor file — `:7424` CURVE25519, `:7455` CHACHA20,
`:7649-7654` the CRYPTO_LIB_* set.)

The vendor file is **not** the shipped config. The kernel build copies it to
`.config` (`os/boards/cx3576/bsp/kernel/Dockerfile:48`), merges the shared
fragment (`:52`, `:66`), runs `olddefconfig`, and then **asserts every `=y`
line of the fragment against the final `.config`, failing the build otherwise**
(`os/boards/cx3576/bsp/kernel/Dockerfile:100-105`). The fragment already
carries WireGuard: *"Fleet remote-management tunnel (systemd-networkd native
netdev support)."* followed by `CONFIG_WIREGUARD=y`
(`os/boards/common/mos-required.fragment:37-38`). `CONFIG_WIREGUARD=y` also
pulls its crypto library dependencies via Kconfig `select` during
`olddefconfig`; if it could not be enabled, the assertion loop exits 1. BRIDGE
is additionally asserted in the Dockerfile's own required list
(`os/boards/cx3576/bsp/kernel/Dockerfile:85`).

**Delta for cx3576: none required for function.** VLAN and bridge are `=y` in
the vendor config; WireGuard is `=y` in every built kernel by fragment
assertion. One hardening delta is proposed: add `CONFIG_VLAN_8021Q=y` (and
`CONFIG_BRIDGE=y`, currently asserted only in the board Dockerfile) to
`os/boards/common/mos-required.fragment`, so a future vendor-config
regeneration cannot silently drop them — the fragment is the shared,
per-board-asserted floor (`os/boards/common/mos-required.fragment:3-5`), and
after PLAN-022 these symbols are product requirements, not vendor defaults.

### 5.2 x64 (Debian stock kernel, config not in-tree)

Provenance of every x64 kernel claim: *"There is no BSP build behind this
board and no vendor kernel tree"* (`os/boards/x64/board.env:201-205`); the kernel is
Debian's `linux-image-6.12.101+deb13-amd64`, kept whole because *"Debian's
generic kernel carries a module set for all hardware"*
(`os/boards/x64/board.env:222-225`), installed with its initramfs and modules
as one package (`os/rootfs/stages/40-board.Dockerfile:79-81`); `kmod` is in
the image (`os/rootfs/stages/10-base.Dockerfile:120`), so `=m` is loadable at
runtime — unlike cx3576, whose fragment requires `=y` for the verity boot path
(`os/boards/common/mos-required.fragment:3-5`).

**The Debian config is not present in this repository, and nothing in-tree
proves what it sets.** No availability of `8021q`, `bridge` or `wireguard`
modules is assumed here. The verification step M2 must run on a real built
image (RFCT-206):

```sh
# on the built x64 image (chroot into the squashfs or the booted QEMU guest)
grep -E '^CONFIG_(VLAN_8021Q|BRIDGE|WIREGUARD)=' /boot/config-6.12.101+deb13-amd64
modprobe -n 8021q && modprobe -n bridge && modprobe -n wireguard   # dry-run resolve
```

plus a booted-image `ip link add` smoke of each kind. If any symbol is absent
(the expectation is `=m` for all three, but expectation is not measurement),
the fallback is a documented x64 limitation gate in the reconciler, not a
silent failure. os/verify gains an assertion so the check cannot rot.

---

## 6. API surface classification

Rules applied, quoted from `docs/design/api.md:978-984`: breaking is
*"removing a route; removing a response field; narrowing a field's type or its
accepted value set; adding a required request field; changing the success
status code of an existing outcome; changing which `error.code` (§2.4) an
existing failure emits"*; additive is *"a new route; a new response field; a
new optional request field; a new `error.code` for a failure that previously
had no distinct code; a new value in an enum the client was told to treat as
open"*.

| Addition | Class | Which rule |
|---|---|---|
| `kind`, `vlan`, `bridge`, `wireguard` fields in `IfaceSettings` bodies | additive | new *optional* request field; new response field (`docs/design/api.md:982-984`) |
| `kind` values as an enum in responses | additive | open-enum rule; clients must ignore unknowns (`docs/design/api.md:986-989`) |
| Quoted-segment path syntax under `/api/v1/settings/{*path}` | additive, one stated edge | no route, method, status or field changes; a previously-failing path starts succeeding. The edge — a segment beginning with `"` is reinterpreted — narrows nothing any validated writer could produce (§2.1), and v7's key validation closes the hand-edit hole |
| `publicKey`, `kind`, netdev file name in `GET /api/v1/state/network` entries | additive | new response field |
| `POST /api/v1/actions/wireguard/{iface}/rotate-key` | additive | new route |
| New validation `error.code`s (vlan parent missing, bridge port addressed, bad peer key) | additive | new `error.code` for a previously undistinguished failure |
| `privateKey` joining the redaction denylist | additive | no shipped response carries such a field to remove |

Nothing on the breaking list is touched; **no `/api/v2` is required.** This
also discharges the debt api.md records at `docs/design/api.md:4217-4222`
— the dot-path fix reaches the published contract as an additive change, not
a versioned one.

---

## 7. Migration

Schema v6 → v7, one registered migration appended to the chain
(`os/pkgs/mosd/mosd-settings/src/migration.rs:75-83`).

**Forward (`up`).** Stamp `schema_version = 7`; nothing else. Every new field
is optional with a serialization-skipping default (§2.2), so a v6 tree of
physical interfaces differs from its v7 form by the version integer alone.
New key-charset validation (§2.1) applies to writes, not loads, so no existing
loadable tree is rejected.

**Deliberate downgrade (`down`).** Stamp 6; remove `kind`, `vlan`, `bridge`
and `wireguard` from every `network` entry; **remove entirely** every entry
whose `kind` was not physical. Precedent and reasoning are v3→v2's: keeping
keys v6 cannot deserialize would leave a document `deny_unknown_fields`
refuses, while *"dropping them costs nothing v2 could have acted on"*
(`os/pkgs/mosd/mosd-settings/src/migration.rs:164-169`) — a v6 reconciler
given a stub named `wg0` would render a `.network` matching no device, a lie
in unit form. Key files (`wg-*.key`) are left on STATE: 0640 in a root-owned
directory, reused on the next upgrade, same posture as an interrupted
first-boot secret (`os/pkgs/mosd/mosd/src/identity.rs:88-92`).

**A/B rollback (v7 tree read by v6 software, no registered migration).** The
store's tolerant path strips unknown keys by name until the document parses
and reports what it dropped (`os/pkgs/mosd/mosd-settings/src/store.rs:182-228`):
`kind` and the three blocks are stripped; a VLAN/bridge/WireGuard entry
survives as a physical stub whose rendered unit matches nothing (its `.netdev`
was in `/run`, gone at reboot), and the device falls back to the image default
`80-dhcp.network` on its physical NICs — degraded to exactly the pre-PLAN-022
feature set, but reachable. The next v6 save persists the stripped tree
(`os/pkgs/mosd/mosd-settings/src/store.rs:124-126`); rolling forward again
re-enters v7 with those entries gone, which is the documented
defaults-restored cost (`os/pkgs/mosd/mosd-settings/src/store.rs:135-137`).
This is an additive bump, the kind the store's own doctrine asks for
(*"prefer additive bumps"*, `os/pkgs/mosd/mosd-settings/src/store.rs:136`).

**Existing damage.** None can exist through mosd: the v6 write path rejects
`network.eth0.100` before anything persists (measured, §1.2;
`os/pkgs/mosd/mosd/src/bus.rs:423-424` — on error nothing is stored). A
hand-edited `[network."eth0.100"]` tree loads and reconciles today and simply
becomes addressable under v7. No repair step is required.

---

## 8. M2+ milestone proposal (RFCT-201..209 reserved)

Each milestone lands alone and green; order is dependency order.

- **M2 / RFCT-201 — quoted-segment path syntax.** `split_path` /
  `json_path_get` learn quoted segments; apid writers quote dotted segments;
  v7 key-charset validation for `network` keys. *Verify:* new unit tests
  including the §1.2 probe as a fixture (the RFCT-135 reproduction must pass);
  workspace `cargo nextest` green.
- **M3 / RFCT-202 — schema v7.** Extended `IfaceSettings`, `MigrateV6ToV7`
  up/down, rollback-strip coverage. *Verify:* byte-identity test for a
  physical-only tree across up; `load_newer` test for a v7 tree with all
  three kinds; nextest green.
- **M4 / RFCT-203 — VLAN + bridge reconcile.** `.netdev` rendering, parent
  `VLAN=` / port `Bridge=` injection, cross-field validation, sweep + `ip
  link del` teardown. *Verify:* golden-unit tests per kind; teardown test
  proving a removed VLAN's device deletion is requested; nextest green.
- **M5 / RFCT-204 — WireGuard.** Keystore (lazy keygen, 0750/0640
  `root:systemd-network`, atomic writes), `x25519-dalek` public-key
  derivation, netdev + peers rendering, rotation bus method. *Verify:*
  leak-canary tests (key absent from live state, errors, logs), mode
  assertions, rotation-recreates-device test; `cargo deny` green with the new
  crate.
- **M6 / RFCT-205 — apid surface.** Typed pane forms for the three kinds,
  rotate-key route, `privateKey` redaction entry, `openapi.json`. *Verify:*
  `test/apid-api` e2e suite extended and green.
- **M7 / RFCT-206 — kernel + image proof.** `CONFIG_VLAN_8021Q=y` (and
  `CONFIG_BRIDGE=y`) added to `os/boards/common/mos-required.fragment`; x64
  on-image config/modprobe checks (§5.2) wired into os/verify; booted-image
  `ip link add` smoke for vlan/bridge/wireguard on both boards' images.
  *Verify:* both image builds green; os/verify assertions green; the x64
  measurement recorded in the task file.
- **M8 / RFCT-207 — documentation.** api.md §2.2's collision entry updated to
  the shipped fix, mosd.md reconciler section, architecture notes.
  *Verify:* `bash docs/verify-citations.sh && bash docs/verify-index.sh`.
- **RFCT-208, RFCT-209** — reserved for findings at the user gate or during
  M2..M8.

## Open questions for the gate

1. Peer pre-shared keys (WireGuard `PresharedKeyFile=`) are excluded from v7
   (§2.2). Acceptable, or must the first cut carry them?
2. The 0640 `root:systemd-network` key-file compromise (§4.1) versus systemd
   import credentials — is the documented-pattern file acceptable, or should
   RFCT-204 prototype credentials first?
3. Bridge STP, VLAN egress/ingress maps, per-peer routing metrics: all
   deliberately absent from v7. Confirm minimal surface is the intent.
