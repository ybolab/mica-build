# RFCT-202 PLAN-022 M3: schema v7 - interface kinds

- **status**: completed
- **priority**: P1
- **owner**: bkd/82rmbnr6
- **createdAt**: 2026-08-27
- **claimedAt**: 2026-08-27
- **completedAt**: 2026-08-27
- **plan**: PLAN-022 (M3)
- **design**: RFCT-200 section 2.2 (the shape), section 7 (the migration), section 8 (the M3 cut)

M3 is the schema half of native networking: a `network` entry can now say what
kind of link it is and carry the parameters that kind needs. Nothing renders
anything yet. No `.netdev` is written, no `VLAN=` line is injected, no key is
generated, no form is added; a v7 tree of VLANs, bridges and WireGuard tunnels
loads, round-trips, migrates and rolls back, and the reconciler ignores every
field of it that M4 has not learned to read.

## Scope

| file | change |
| --- | --- |
| `os/pkgs/mosd/mosd-settings/src/model.rs` | `SCHEMA_VERSION` 6 -> 7; `IfaceKind`; `IfaceSettings.kind` and the `vlan`/`bridge`/`wireguard` blocks; `VlanConfig`, `BridgeConfig`, `WireguardConfig`, `WireguardPeer` |
| `os/pkgs/mosd/mosd-settings/src/migration.rs` | `MigrateV6ToV7`, registered; five tests |
| `os/pkgs/mosd/mosd-settings/src/store.rs` | one unit test: the rollback strip reduced to a v6 body |
| `os/pkgs/mosd/mosd-settings/src/lib.rs` | the five new types and `MigrateV6ToV7` exported |
| `os/pkgs/mosd/mosd-settings/tests/settings.rs` | six tests; the two rollback fixtures re-stamped 7 -> 8 |
| `os/pkgs/mosd/mosd/src/reconciler/network.rs` | test helpers spell `..IfaceSettings::default()` |
| `docs/design/api.md`, `docs/design/dashboard.md` | citation re-anchor (below) |

## The shape

```toml
[network.eth0]                    # kind absent = "physical" (default)
dhcp = true

[network."eth0.100"]
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
[network.wg0.wireguard]
listenPort = 51820
[[network.wg0.wireguard.peers]]
publicKey = "<base64 x25519 public key>"
allowedIps = ["10.8.0.0/24"]
endpoint = "vpn.example.net:51820"     # optional
persistentKeepalive = 25               # optional, seconds
```

A `kind` field plus three optional blocks, not a serde-tagged enum, for the
reason section 2.2 gives: serde does not enforce `deny_unknown_fields` through
internal tagging, and that attribute is this tree's validation mechanism. Every
new struct carries it, so `[network.wg0.wireguard]` refuses a key it does not
know exactly the way `[network.eth0.static]` always has.

Every added field is defaulted and `skip_serializing_if`, `kind` included: a
physical entry writes no `kind` key, so a v6 tree and its v7 form differ by the
schema version integer alone. That is not a nicety, it is what makes the bump
additive and the A/B rollback survivable, so it is asserted on the serialized
bytes rather than inferred from the attributes.

`IfaceSettings` gains `Default`, which is how the eight existing struct
literals across the two crates absorb four new fields without spelling them.

**No secret is in this schema.** There is no private-key field and no peer
pre-shared key. The subtree is served over the bus and over
`GET /api/v1/settings/...`, so a field here is a value handed to every client;
the private key lives in a mode-0640 file on STATE (M5) and only its public
half is ever surfaced. Peer pre-shared keys are out of v7 per Amendment 1, and
so are bridge STP, VLAN egress/ingress maps and per-peer routing metrics. A
test asserts the absence rather than trusting the review.

### Two judgement calls, recorded

- **`listenPort` is optional.** Section 2.2's example carries it and section 3
  says the netdev renders `ListenPort=`, but neither states it is required, and
  requiring it would make every WireGuard interface a listener. A client that
  only ever initiates has no port to choose, so the field is
  `Option<u16>` and an absent one lets the kernel pick.
- **`bridge.ports` and `wireguard.peers` default to empty** rather than being
  required, following `StaticConfig.dns`. A bridge declared before its ports
  and a tunnel declared before its peers are both states an operator passes
  through while filling in a form.

## Cross-field consistency is not here

That `kind = "vlan"` carries a `vlan` block and no other, that `kind =
"physical"` carries none, that a bridge port declares no addressing of its own,
that a `parent` or a `port` names a declared entry: all of it is M4's, enforced
in the network reconciler, because that is where the boundary for a file
anything with STATE write access can edit already sits. The schema shape is
what lands here, plus the one write-time rule section 2.1 assigns to the
settings layer -- the `network` key charset -- which RFCT-201 already landed and
this milestone does not touch.

## The migration

`up` stamps `schema_version = 7` and does nothing else. There is nothing to
seed: every new field is optional with a serialization-skipping default, and
the key-charset rule is a property of the write path rather than of the
document, so no existing loadable tree is rejected.

`down` stamps 6, removes `kind`, `vlan`, `bridge` and `wireguard` from every
entry, and **removes entirely** every entry whose `kind` was not physical. The
precedent is v3 -> v2's, and it applies twice over. v6's `IfaceSettings` carries
`deny_unknown_fields`, so a leftover `vlan` block does not merely mislead -- it
makes the whole document unloadable, taking the hostname and the admin
credential with it. And a v6 reconciler handed a bare `wg0` entry would render
a `.network` unit matching no device: the tree would claim a tunnel the device
has no code to create. A stripped stub is not a degraded tunnel, it is a lie in
unit form, so the entry goes. An entry spelled `kind = "physical"` is a v7
spelling of a v6 entry and survives with the key removed.

The key files (`wg-*.key`) are left on STATE, unreferenced -- 0640 in a
root-owned directory, reused if the device rolls forward, the same posture as a
secret whose first-boot write was interrupted.

## Rollback, the unregistered path

An A/B rollback runs *old code against a new document*, so no down-migration
exists to help: the store's tolerant path strips the keys serde names, by name,
recursively, until the document parses. Against v6's `IfaceSettings` those
names are `kind`, `vlan`, `bridge` and `wireguard`, and the fixed point of
stripping them is what section 7 promises: every entry survives as a *physical
stub*, a body v6 deserializes, rather than the whole document failing to load.
The stub's rendered `.network` matches no device -- its `.netdev` lived in
`/run` and is gone at reboot -- so the device falls back to the image default on
its physical NICs. Degraded to the pre-PLAN-022 feature set, and reachable.

This is provable only at the mechanism, not through `Store::load_with_report`:
what gets stripped is decided by the serde errors of *this* binary's `Settings`,
and this binary's `Settings` is v7. So the coverage sits in `store.rs`'s own
test module, where `strip_key` lives, and the v6 entry shape is declared in the
test -- `dhcp`, an optional `static`, `deny_unknown_fields` -- because the type
it mirrors no longer exists in the crate. Each stripped entry is deserialized
into that mirror, which is the real question: would the old struct have taken
this body.

## Tests

`src/migration.rs`:

- **byte-identity across `up`** -- a v6 document of physical interfaces is
  serialized before and after; the two differ by the version integer and by
  nothing else. `up` over its own output changes nothing.
- `down` over a document of all three kinds keeps only `eth0`, with no `kind`
  and no block left on it;
- `down` keeps an explicitly `kind = "physical"` entry and strips just the key;
- v6 -> v7 -> v6 returns the document it started from.

`src/store.rs`: the four strips over a v7 tree of all three kinds leave four
entries, each a body the v6 mirror deserializes; `publicKey`, `listenPort`,
`ports` and `parent` are gone with their blocks; a second pass finds nothing.

`tests/settings.rs`, section *Interface kinds (schema v7)*:

- a physical tree writes no trace of the four new fields, and an absent `kind`
  reads back as physical;
- all three kinds round-trip through the store -- loaded typed, saved, reloaded
  equal;
- dot-paths reach every new leaf, quoted segment included
  (`network."eth0.100".vlan.parent`, `network.wg0.wireguard.peers`); a physical
  entry has no node at `network.eth0.kind`, because absent *is* physical and the
  accessor does not invent a default the file does not carry;
- `set` writes a whole VLAN entry, and still refuses both an unknown key inside
  a block and a `kind` the schema does not name;
- the WireGuard subtree holds no secret;
- **`load_newer` over a v7 tree of all three kinds** -- a document stamped one
  schema ahead carrying an unknown block: the unknown key goes, every v7
  interface survives intact, blocks and peers included.

The two pre-existing rollback fixtures move from `schema_version = 7` to 8.
Their own doc comment predicted this: left behind, they stop being "newer", the
strip path stops running, and the tests go on passing while asserting nothing.
The `SCHEMA_VERSION + 1` assertion that guards them moved with them.

## Citation re-anchor

`model.rs` grew 116 lines and `migration.rs` 212, so the design documents'
`path:line` citations into them shifted. 21 tokens were re-anchored across
`api.md` and `dashboard.md`, line numbers only, computed by diffing each source
against its pre-image -- chained `:N` references included, since a chained
number is as wrong as a spelled-out one even though the checker does not read
it.

One exception, and it is a value rather than a line: `api.md` quotes
`pub const SCHEMA_VERSION: u32 = 6;` twice, directly against its citation, so
the quote check reads the constant's text. The value had to move with the code
or the gate would fail on a quote that no longer exists anywhere; the two
sentences that spell the number in prose carry it too. Nothing else in either
document was retouched.

**Reported, not fixed.** Two drifts this milestone shifted faithfully rather
than repaired, on RFCT-201's reasoning that fixing someone else's drift inside a
mechanical rewrite makes the rewrite unreviewable:

- `api.md:1204-1207` still describes `network.eth0.100` landing as a field named
  `100` and quotes the old error text *"expected `dhcp` or `static`"*. The
  first half stopped being true in M2 and the field list stopped being true
  here. Rewriting that entry is M8/RFCT-207's assigned work; its
  `deny_unknown_fields` citation was re-pointed at the new `IfaceSettings`
  range so it names the struct the sentence is about.
- `api.md:571`'s list of `deny_unknown_fields` examples ends with a citation
  that already pointed at `const MAX_IFACE_NAME_LEN` rather than at a serde
  attribute. It carries no quote, so the gate does not catch it; it was shifted
  as it was.

## Not touched, deliberately

- **The network reconciler** reads `dhcp` and `static` and nothing else, so a
  v7 tree of VLANs renders exactly the `.network` files v6 would have. That is
  M4's work, and until it lands a non-physical entry is inert rather than
  half-applied. Only the module's test helpers changed, to spell the new fields'
  defaults.
- **apid** needs no change: `/network` writes `dhcp` and `static` leaves through
  a path RFCT-201 already taught to quote, and `GET /api/v1/meta` reads
  `SCHEMA_VERSION` at request time rather than copying it. The typed per-kind
  forms and `openapi.json` are M6's.
- **`redact.rs`** gains nothing, because this schema adds no secret-named field
  to redact. `privateKey` joins the denylist in M5, with the file that holds it.

## Verification

| gate | result |
| --- | --- |
| `bash os/pkgs/mosd/hack/check.sh` | `Summary [61.244s] 617 tests run: 617 passed, 0 skipped`, doctests ok, `advisories ok, bans ok, licenses ok`, `ALL CHECKS PASSED` |
| `bash os/pkgs/rauc-sign/hack/check.sh` | `ALL CHECKS PASSED` |
| `make docs-verify docs-verify-citations` | `docs/verify-index.sh: 531/531 PASS`; `docs/verify-citations.sh: 902/902 PASS` |

Rust gates run in the `localhost/mos-build-rust` container against the 1.98
toolchain, with `cargo nextest` 0.9.133. The suite grew from 606 tests to 617.
