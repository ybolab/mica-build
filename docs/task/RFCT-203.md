# RFCT-203 PLAN-022 M4: VLAN and bridge reconcile

- **status**: completed
- **priority**: P1
- **owner**: bkd/we7lz3of
- **createdAt**: 2026-08-27
- **claimedAt**: 2026-08-27
- **completedAt**: 2026-08-27
- **plan**: PLAN-022 (M4)
- **design**: RFCT-200 section 3 (the unit shapes and the teardown), section 2.2 (the cross-field rules), section 8 (the M4 cut)

M4 is the half of native networking that makes a v7 entry do something. The
kinds RFCT-202 gave the schema were inert: the reconciler read `dhcp` and
`static` and ignored the rest, so a declared VLAN was a `.network` unit
matching a device nothing created. This milestone renders the `.netdev` that
creates the device, names each VLAN child in its parent's unit and each bridge
port's unit as a port, enforces the cross-field rules the schema shape cannot,
and deletes the kernel devices whose units it takes away.

WireGuard stays inert, and deliberately: its `.netdev` carries a
`PrivateKeyFile=` path that has no keystore behind it until M5, and half a
tunnel is a link that claims to exist and cannot come up.

## Scope

| file | change |
| --- | --- |
| `os/pkgs/mosd/mosd/src/reconciler/network.rs` | `LinkDelete` and `IpLink`; `validate_network`, `validate_kind_blocks`, `kind_name`; `bridge_ports`, `vlan_children`, `render_netdev`; `render_unit` gains the master and the VLAN children; the sweep and `apply` rewritten around both extensions; twelve tests |
| `os/pkgs/mosd/mosd/Cargo.toml` | tokio `process`, for the teardown command |
| `os/pkgs/mosd/mosd/src/reconciler/wifi_ap.rs`, `wifi_client.rs` | the one test each that runs the real network reconciler passes the new deleter |
| `docs/task/RFCT-200.md`, `RFCT-201.md`, `docs/design/api.md`, `docs/design/dashboard.md` | citation re-anchor (below) |

## The units

A `kind != physical` entry gets a `50-mos-<iface>.netdev` beside the
`50-mos-<iface>.network` the reconciler already wrote, in the same directory,
under the same prefix, swept by the same pass:

```
# 50-mos-eth0.100.netdev        # 50-mos-br0.netdev
[NetDev]                        [NetDev]
Name=eth0.100                   Name=br0
Kind=vlan                       Kind=bridge

[VLAN]
Id=100
```

The netdev alone creates nothing. networkd builds a VLAN only when the
*parent's* `.network` names it, so the child's existence is a fact recorded in
the parent's unit, and a bridge takes its ports the same way -- from each
port's own unit, not from the bridge's:

```
# 50-mos-eth0.network           # 50-mos-eth1.network
[Match]                         [Match]
Name=eth0                       Name=eth1

[Network]                       [Network]
DHCP=yes                        Bridge=br0
VLAN=eth0.100
```

That asymmetry is the whole reason the cross-field rules are fail-closed. A
VLAN whose parent is not a declared entry has no unit to carry its `VLAN=`
line, so it would be a device the settings tree claims and networkd never
builds; refusing it says so at apply time rather than at debug time. A bridge
port's unit is `Bridge=br0` and nothing else, which is why a port carrying
`dhcp` or a `static` block is refused rather than silently stripped: the render
has no line for an address on a port, and a value the render drops is a lie
about the link.

The physical path is byte-identical. `GOLDEN_DHCP`, `GOLDEN_STATIC` and
`GOLDEN_EMPTY` are the fixtures M2 and M3 left, and they pass unchanged: an
entry that is not a port and has no VLAN children renders exactly what it
rendered before.

## The rules, and the one that is not here

Enforced in `validate_network`, before the first file is written, so a rejected
tree leaves the directory as it found it:

- **kind/block agreement.** A block belonging to another kind is refused, in
  both directions: `kind = "physical"` with a `bridge` block, `kind = "vlan"`
  with a `wireguard` block. A `vlan` or `bridge` entry with no block of its own
  is refused too -- a link with no parameters.
- **Declared references.** A VLAN `parent` and every bridge `port` must be a
  `network.*` entry of its own.
- **Port addressing.** A port must carry neither `dhcp = true` nor a `static`
  block.
- **One master per port.** Two bridges claiming one port would race for one
  `Bridge=` line in one file, and the winner would be whichever the map
  iteration reached last. It is an error instead. This rule is not in the list
  RFCT-202 bequeathed; it is here because the render is single-valued and the
  settings tree has to be too.

Not here: the rule that a `kind = "wireguard"` entry must CARRY its
`wireguard` block. That rule belongs with the code that renders the tunnel,
which is M5's; this milestone renders no tunnel, so it refuses only a wireguard
entry's foreign blocks and otherwise leaves the entry as inert as it is today.

All of it sits in the reconciler rather than in apid for the reason the address
validation next to it already gives: *"apid validates the address on its write
path, but the settings file is writable without apid, so the boundary must hold
here"* (`os/pkgs/mosd/mosd/src/reconciler/network.rs:294-296`). The readable
form error apid shows for the same rules is M6's, and it is an echo, not the
boundary.

## The teardown

systemd-networkd creates virtual devices and never reaps them. Removing a
`.netdev` and reloading leaves the device in the kernel, so a deleted VLAN
keeps passing traffic until the next boot, and a VLAN whose id changed keeps
the old id, because netdev properties are applied at device creation only. Both
need the device gone first.

So the sweep, extended from `.network` to `.netdev` under the same `50-mos-`
prefix, now yields two things: the files it deleted and -- from their names --
the exact set of virtual devices this reconciler has given up. Those, plus any
device whose netdev content the pass just rewrote, are deleted with `ip link
del dev <iface>` through the new `LinkDelete` port, before the reload, so
networkd rebuilds the recreated ones on the same pass that dropped them.
The base image installs `iproute2`
(`os/rootfs/stages/10-base.Dockerfile:122`), so this is a tool the appliance
already carries.

Three properties the tests pin, because each one is a way this could go wrong:

- The delete is requested **before** the reload, and a swept `.network` on its
  own requests nothing -- only netdevs name devices this reconciler created.
- An unchanged VLAN re-applied deletes nothing. A reconcile that tore its own
  link down on every pass would drop the VLAN on every settings write anywhere
  in the tree.
- A failed delete is logged, not returned. The unit file is already gone, the
  usual cause is a device that was never created, and failing the apply there
  would report every interface that did converge as unconverged. The journal
  is the channel for it, the same way the hostname reconciler reports the path
  that cannot work.

## Live state is unchanged

Section 3's blast-radius paragraph says live state per interface gains `kind`.
No section 8 milestone claims it, and the M4 bullet is a list of four rendering
and teardown items that does not include it, so this milestone leaves the
per-interface object exactly as M2 and M3 left it -- `file` and `dhcp` -- and
the addition goes with the apid surface in M6, where the readers of it are.
Flagged rather than assumed: it is the one design sentence in section 3 that
M4 does not implement.

## The tests

Twelve added, all in the reconciler's own module, all against a temp directory
and a recording reload/delete pair that share one call log so their ordering is
assertable:

| test | what it pins |
| --- | --- |
| `renders_a_vlan_netdev_and_names_the_child_in_its_parent` | golden netdev, golden parent with `VLAN=`, golden child |
| `renders_a_bridge_netdev_and_gives_its_port_only_the_master` | golden netdev, port unit is `Bridge=br0` alone, bridge keeps the addressing |
| `deletes_the_kernel_device_of_a_removed_vlan` | the M4 teardown test: delete requested, before the reload, once |
| `recreates_a_vlan_whose_id_changed` | changed netdev properties delete the device, not just the file |
| `reapplying_an_unchanged_vlan_deletes_nothing` | no delete/recreate flap |
| `sweeps_a_stale_netdev_but_spares_a_foreign_one` | the widened sweep keeps its own namespace |
| `leaves_a_wireguard_entry_inert` | no netdev, no delete, no error, the same `.network` as today |
| `rejects_a_kind_whose_own_block_is_missing` | kind/block agreement, nothing rendered |
| `rejects_a_block_that_does_not_match_the_kind` | the other direction of it |
| `rejects_a_vlan_parent_that_is_not_declared` | fail-closed references |
| `rejects_a_bridge_port_that_is_not_declared` | fail-closed references |
| `rejects_a_bridge_port_that_carries_its_own_addressing` | port addressing |
| `rejects_a_port_two_bridges_both_claim` | one master per port |

Each rejection asserts the directory is still empty and the reload was never
called, which is what makes "validated before any I/O" a checked claim rather
than a described one. The M2 and M3 fixtures pass unchanged; the suite went
from 617 tests to 630.

## The citation re-anchor

The new code sits between the reconciler's name validator and its `apply`, so
every line below `MAX_IFACE_LEN` moved. Sixteen citations naming those
constructs were re-pointed at the same constructs' new offsets, in their own
commit, with no prose and no quotation touched: eleven in RFCT-200, one in
RFCT-201, one in `docs/design/api.md`, one in `docs/design/dashboard.md`, plus
the `:213-214` shorthand RFCT-200 hangs off its `network.rs:13` citation. Two
forced value changes are worth naming: `:204-233` became `:440-500` because
`apply` itself grew, and `:184-192` became `:408-417` because the sweep
predicate's doc comment gained the sentence about `.netdev`.

Left alone: `docs/design/dashboard.md`'s two `network.rs:115-118` citations and
`docs/research/mos-ui-inventory.md`'s. They name the live-state `json!` object,
which those numbers stopped pointing at before this milestone -- re-pointing a
citation that was already aimed elsewhere is a content fix, not a re-anchor,
and the inventory is a dated record besides.

## Verification

| gate | result |
| --- | --- |
| `bash os/pkgs/mosd/hack/check.sh` | `Summary [ 49.839s] 630 tests run: 630 passed, 0 skipped`, doctests ok, `advisories ok, bans ok, licenses ok`, `ALL CHECKS PASSED` |
| `bash os/pkgs/rauc-sign/hack/check.sh` | `ALL CHECKS PASSED` |
| `make docs-verify` | `docs/verify-index.sh: 1 FAILED, 711 passed` -- the one failure is RFCT-200's `review` status head, present at the merge base |
| `make docs-verify-citations` | `14 FAILED (0 resolution, 12 content, 0 census, 2 ratchet), 1223 citations passed` -- all fourteen present at the merge base |

Both docs gates are red on arrival, and both reproduce on a clean export of
this branch's merge commit before any M4 change:

- `verify-index.sh` fails on one thing, RFCT-200's status head reading `review`
  rather than a vocabulary word, which is what that record says it is while it
  waits at the PLAN-022 M1 user gate. `707 passed` at the merge base, `711
  passed` here: the four added are this milestone's record and its row.
- `verify-citations.sh` fails on the same fourteen: twelve content failures in
  RFCT-200 against `model.rs`, `routes.rs`, `bus_client.rs`, `migration.rs` and
  `api.md`, and the two unquoted-count ratchets for RFCT-200 and RFCT-201. The
  passing count is 1221 at the merge base and 1221 after the code change and
  the re-anchor; the 1223 this record's run reports is that plus its own two
  citations.

Neither belongs to this milestone, and both live in records M4 does not own, so
this milestone re-anchored what it moved and left what it did not.

Rust gates run in the `localhost/mos-build-rust` container against the 1.98
toolchain, with `cargo nextest` 0.9.133 and `dbus-daemon` installed in the
container for the bus round-trip test.
