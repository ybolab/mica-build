# RFCT-204 PLAN-022 M5: WireGuard keystore and tunnel reconcile

- **status**: completed
- **priority**: P1
- **owner**: bkd/hh9nmf8j
- **createdAt**: 2026-08-27
- **claimedAt**: 2026-08-27
- **completedAt**: 2026-08-27
- **plan**: PLAN-022 (M5)
- **design**: RFCT-200 section 4 (the key lifecycle), section 3 (the unit shapes and the teardown), section 8 (the M5 cut); PLAN-022 Amendment 1 (peer pre-shared keys excluded, the key-file pattern ratified)

M4 rendered the two virtual kinds whose parameters are all public and left the
third alone, deliberately: *"this milestone renders no tunnel"*
(`docs/task/RFCT-203.md:96-100`), because a WireGuard netdev names a private
key file and there was no key file to name. M5 is that keystore, the tunnel
rendering that stands on it, and the rotation that replaces a key without ever
handing one out.

The private key never leaves the module that draws it. It is not in the
settings tree, not in live state, not in an error, not in a log line, and there
is no accessor to read it back with — the design's rule, *"no read-back route
for the private key, ever"* (`docs/task/RFCT-200.md:408-409`), is enforced by
there being no function that returns one.

## Scope

| file | change |
| --- | --- |
| `os/pkgs/mosd/mosd/src/wgkeys.rs` | new: the keystore — `Keystore`, lazy generation, atomic group-readable writes, public-key derivation, key and group parsing; eleven tests |
| `os/pkgs/mosd/mosd/src/reconciler/network.rs` | `render_wireguard`, `render_netdev` extended, `validate_wireguard`, `is_host_port`, the wireguard block rule, `kind` and `publicKey` in live state, `WireguardRotate` and `KeyRotation`; twelve tests |
| `os/pkgs/mosd/mosd/src/bus.rs` | `RotateWireguardKey`, the `NoRotation` default, `with_wireguard`; three tests |
| `os/pkgs/mosd/mosd/src/main.rs`, `reconciler/mod.rs` | the module, and the production rotation attached outside dry run |
| `os/pkgs/mosd/mosd/src/reconciler/wifi_ap.rs`, `wifi_client.rs` | the one test each that runs the real network reconciler passes a key store in its own temporary tree |
| `os/pkgs/mosd/Cargo.toml`, `mosd/Cargo.toml`, `Cargo.lock` | `x25519-dalek` pinned at `=3.0.0`, `base64` |

## The keystore

One file per interface at `<state>/networkd-secrets/wg-<iface>.key`, holding
the base64 private key `PrivateKeyFile=` wants: `"networkd-secrets"`
(`os/pkgs/mosd/mosd/src/wgkeys.rs:45`) at `0o750`
(`os/pkgs/mosd/mosd/src/wgkeys.rs:48`), files at `0o640`
(`os/pkgs/mosd/mosd/src/wgkeys.rs:51`), both owned `root:systemd-network` —
the ratified pattern, and the one systemd.netdev(5) documents. Import
credentials stay parked where PLAN-022 Amendment 1 put them: they are the
fallback if the on-image check fails, and nothing here forecloses them.

**The one deviation from the ratified text, and why it is forced.** PLAN-022
Amendment 1 and RFCT-200 section 4 spell the directory `secrets/networkd/` — a
sub-directory of the one the device password and the AP PSK live in. That
spelling cannot work, and the measurement is in the tree the design cites for
everything else: reaching a file needs execute on every directory above it, and
`identity::ensure_secrets_dir` pins `secrets/` to `SECRETS_DIR_MODE`, which is
`0o700` (`os/pkgs/mosd/mosd/src/identity.rs:46`), on every pass and
unconditionally — *"a directory left behind by an older or interrupted run gets
tightened"* (`os/pkgs/mosd/mosd/src/identity.rs:268-271`). So a key file
anywhere below `secrets/` is a file the `systemd-network` user cannot reach
whatever mode this module puts on its own directory and on the key, and
`PrivateKeyFile=` would be `EACCES` on every real image with every mode
assertion still green. The FILE PATTERN the amendment ratified is kept exactly
— 0750 directory, 0640 file, both `root:systemd-network`, atomic writes — and
only the PATH SPELLING is corrected, to a true sibling one component under the
state directory. This is a deviation from ratified text, recorded here rather
than made quietly: an amendment that says `secrets/networkd/` and a tree that
pins `secrets/` to 0700 cannot both be satisfied, and the mode contract is the
half that carries the security property.

The write is `identity.rs`'s, quoted rather than reinvented: `fn write_secret`
(`os/pkgs/mosd/mosd/src/identity.rs:282`) opens a temp file beside the target,
pins the mode on it, writes, fsyncs, renames and fsyncs the directory. The one
addition is the group, set on the open handle before the rename —
`fchown(&file, None, Some(group))` (`os/pkgs/mosd/mosd/src/wgkeys.rs:185`) —
for the same reason the mode is: the key is never reachable under its final
name owned by a wider group than it will end up with.

The gid is read out of `/etc/group` rather than looked up through `getgrnam`
because `unsafe_code = "forbid"` (`os/pkgs/mosd/Cargo.toml:11`) means there is
no FFI call to make and no crate that would make one without it. A store built
with no group writes `root:root` at 0640, which is tighter than intended and
never laxer; that is the state a device without a `systemd-network` group would
be in, and it is left to the on-image check rather than made a hard failure,
because refusing there would abort the whole network reconcile — every physical
interface with it — over one tunnel that could not have come up either way.

Generation is lazy and idempotent: the first reconcile that sees a
`kind = "wireguard"` entry with no key draws 32 bytes from `SystemRandom::new()`
(`os/pkgs/mosd/mosd/src/identity.rs:176`), the CSPRNG this daemon already draws
the device password and the AP PSK from, and clamps them per RFC 7748; every
later pass finds that key and keeps it. The design's argument for inventing a
value the AP reconciler would refuse to invent is the one implemented here: a
WireGuard private key *"is machine-only and must never be given to anyone, so
inventing it is the only correct behaviour"*
(`docs/task/RFCT-200.md:393-396`).

The public half is derived in process by `x25519-dalek`, pinned at `=3.0.0` the
way `tough` is pinned: a key-derivation dependency is one whose version bump is
read before it is taken. Pure Rust, so it links no C, and no `wg` binary is
shelled out to because the images ship none.

## The units

A tunnel's netdev names the key file and never carries it — networkd's runtime
directory is world-readable and the key file is not:

```
# 50-mos-wg0.netdev
[NetDev]
Name=wg0
Kind=wireguard

[WireGuard]
PrivateKeyFile=/var/lib/mos/networkd-secrets/wg-wg0.key
ListenPort=51820

[WireGuardPeer]
PublicKey=<base64>
AllowedIPs=10.8.0.0/24
Endpoint=vpn.example.net:51820
PersistentKeepalive=25
```

An absent optional renders no line rather than an empty one: a tunnel that only
initiates has no `ListenPort=`, because a port networkd picks is what a client
wants and an empty directive is still a directive. The `.network` beside it is
the same addressing unit every other kind gets, and the tunnel joins M4's
mechanism unchanged — a changed netdev is a recreated device, a swept netdev is
a deleted one, both through `ip link del` before the reload.

Every peer value is parsed rather than filtered, the discipline the address
validation next to it already applies: a public key must decode to exactly 32
bytes — `decode_key(value).is_some()` (`os/pkgs/mosd/mosd/src/wgkeys.rs:290`)
— an allowed IP must parse as an address or CIDR, and an endpoint must parse as
`host:port` with a bracketed
IPv6 literal or a DNS-charset host. A newline in any of the three would
otherwise land on a directive line and start another one.

A rejected peer is named by its index and never by its value. A public key is
public by definition, but the field is a text box: an operator who pasted a
private key into it would find it in a bus error and in the journal, and the
peer's position identifies it just as well.

## The rule M4 left here

*"the rule that a `kind = "wireguard"` entry must CARRY its `wireguard` block"*
(`docs/task/RFCT-203.md:97-98`) is now the same rule the other two kinds have:
`cfg.wireguard.is_none()` (`os/pkgs/mosd/mosd/src/reconciler/network.rs:358`)
refuses it. The justification is no longer "M5 owns it" but the block's
content: the peers live there, so a tunnel with no block is a link that could
never carry a packet.

## Rotation

`RotateWireguardKey` on `com.mos.mosd1`, implemented as
`async fn rotate_wireguard_key` (`os/pkgs/mosd/mosd/src/bus.rs:770`), checks
that the named interface is a declared tunnel, draws a new key over the old
one, deletes the device holding the old one, re-runs the reconcilers and
returns the new public key. It is not
a settings write in either direction: the tree holds no key to change, so
nothing is persisted and no `SettingsChanged` is emitted.

The delete is the whole point of the method rather than an implementation
detail. networkd reads `PrivateKeyFile=` when it creates the device and never
again, so a rotation that only rewrote the file would change what the public
key says without changing what the tunnel does; the reconcile that follows
re-renders the unit and reloads, and networkd builds the device back around the
key now on disk. `self.deleter.delete_link(iface).await?;`
(`os/pkgs/mosd/mosd/src/reconciler/network.rs:226`) is fatal here, unlike the
sweep's best-effort delete, which is *"logged, not returned"*
(`docs/task/RFCT-203.md:134`): a sweep's failed delete is usually a device that
never existed, while a rotation's means the key on disk and the key in the
kernel have diverged and the caller is about to be handed a public key the
tunnel is not using.

The old key is gone on success — one path, written by rename, no history beside
it, which is the design's *"there is no key history and no export"*
(`docs/task/RFCT-200.md:417-418`). The HTTP route in front of this method is
M6's, and so is the `privateKey` redaction entry.

## Live state

The per-interface object gains two fields, both written here:
`entry["publicKey"] = json!(self.keys.ensure(iface)?)`
(`os/pkgs/mosd/mosd/src/reconciler/network.rs:670`) for a tunnel, and `kind`
for every entry. M4 flagged `kind` as the one section 3 sentence it did not
implement; it lands here because it is the same recording line as the public
key, and one field beside the other is one change to review rather than two.
The readers — the pane, the OpenAPI document — stay M6's.

## The tests

Twenty-seven written and twenty-six added: eleven in the keystore's own module,
thirteen in the reconciler's, three on the bus, against M4's
`leaves_a_wireguard_entry_inert`, which is gone because the tunnel it asserted
was inert is the thing this milestone renders. The hygiene ones are the point
of the milestone.

| test | what it pins |
| --- | --- |
| `generates_a_key_lazily_and_then_reuses_it` | one key per interface, drawn once, never rotated by a reconcile |
| `the_key_directory_is_0750_and_the_key_file_0640` | the mode assertions section 4 asks for |
| `no_component_of_a_key_path_is_traversable_only_by_root` | the property the mode assertions cannot see: a 0700 `secrets/` is planted beside the store, and the key path avoids it, creates nothing under it, and every component it does create is group-readable and traversable |
| `a_pre_existing_directory_is_tightened_before_a_key_lands_in_it` | a 0777 directory from an older run is fixed before it holds a key |
| `the_key_file_and_its_directory_take_the_group_they_are_given` | the chown actually happens, against a real non-zero gid |
| `rotation_replaces_the_key_and_its_public_half` | new key, new public half, no second file left behind, mode still 0640 |
| `a_stored_key_is_32_clamped_bytes_and_is_not_its_public_half` | RFC 7748 clamping, and that the file is not the published value |
| `two_interfaces_get_two_keys` | no shared key across tunnels |
| `a_key_file_that_is_not_a_key_is_an_error_that_does_not_echo_it` | leak canary on the error path: a planted canary never reaches the message |
| `a_key_of_the_wrong_length_is_not_a_key` | the peer-key predicate, both directions |
| `a_group_file_gives_up_its_gid_and_nothing_else` | the group parse, including a missing file and a missing group |
| `renders_a_wireguard_netdev_naming_its_key_file_and_its_peers` | the golden netdev, whole |
| `renders_a_tunnel_that_only_initiates_without_a_listen_port` | absent optionals render nothing; several allowed IPs are one directive |
| `generates_the_key_once_and_publishes_only_its_public_half` | leak canary on live state AND on every rendered file; the state object, whole |
| `live_state_names_the_kind_of_every_entry` | the `kind` writer, all four kinds |
| `recreates_a_tunnel_whose_peers_changed_and_tears_down_a_removed_one` | the tunnel joins M4's recreate and teardown mechanism |
| `rejects_a_wireguard_entry_that_carries_no_wireguard_block` | the rule M4 left here |
| `rejects_a_peer_whose_public_key_is_not_a_key` | injection refused, and the value not echoed back |
| `rejects_a_peer_allowed_ip_and_endpoint_that_are_not_what_they_claim` | the other two peer fields |
| `an_endpoint_is_a_host_and_a_port_or_it_is_nothing` | the endpoint parse, nine cases |
| `rotation_draws_a_new_key_deletes_the_device_and_never_logs_the_key` | the rotation test section 8 asks for: new public key, device deleted, old key gone |
| `a_rotation_that_cannot_delete_the_device_is_an_error_that_names_no_key` | the fatal delete, and its error carries no key |
| `a_rotation_refuses_a_name_that_would_escape_the_key_directory` | the name is validated on this path too |
| `the_only_log_line_a_tunnel_can_produce_carries_no_key` | leak canary against captured tracing output |
| `a_rotation_returns_the_new_public_key_and_writes_no_key_into_the_tree` | the bus method rotates, and the settings tree is untouched and unpersisted |
| `a_rotation_refuses_an_interface_that_is_not_a_tunnel` | a physical entry and an undeclared one, both refused before the key store |
| `a_daemon_with_no_key_store_rotates_nothing` | the dry-run default has nowhere to put a key and says so |

The log canary is the one that needed new machinery: a `MakeWriter` capturing
into a buffer, installed as the default subscriber around one apply. The
reconciler has exactly one logging statement a tunnel can reach — the sweep's
failed delete — so the test forces it and asserts the captured output names the
interface and not the key. The keystore module has none at all, which is the
property `wifi_ap.rs` states for the AP PSK: *"never published in the
live-state tree (which is served over D-Bus), never named in an error, and this
module contains no logging statement at all"*
(`os/pkgs/mosd/mosd/src/reconciler/wifi_ap.rs:22-25`), and which
`wgkeys.rs`'s own header repeats: *"this module contains no logging statement
at all"* (`os/pkgs/mosd/mosd/src/wgkeys.rs:22`).

No test draws a key anywhere but a `tempfile` directory. The key store is a
required constructor parameter of the reconciler rather than a defaulted one
for exactly that reason: a default would be a real path on the host, and a test
that reconciled a tunnel against it would leave a real private key on the
machine running the suite.

## Decisions worth naming

1. **The key outlives the entry.** Deleting `network.wg0` deletes the unit and
   the kernel device, not the key file. A re-declared `wg0` keeps the identity
   the far end already trusts, which is the behaviour an operator editing a
   settings file expects; the alternative — reaping the key with the entry —
   would mean a typo in an interface name silently discards a key that cannot
   be recovered. The stale file stays unreadable to everything but networkd.
   Section 4 does not decide this either way, so it is decided here.
2. **No in-memory zeroization.** The key bytes live in an `x25519-dalek`
   `StaticSecret`, which zeroizes on drop, but the base64 string written to the
   file does not. Section 4's list of hygiene properties does not include it,
   and adding a `Zeroizing` wrapper over one string while the same daemon holds
   an unzeroized device password would be theatre rather than a boundary.
   Named rather than done.
3. **A rotation that cannot delete is an error, and the key has already
   changed.** The operator sees the failure and can retry; live state keeps the
   old public key until a reconcile republishes it. The alternative, swallowing
   the delete failure, hands out a public key whose private half the tunnel is
   not using and says nothing.
4. **The rotation is its own port, not the reconciler.** `KeyRotation` holds a
   key store and a device deleter and nothing else, so the bus method does not
   need a handle on the reconciler instance in the daemon's list, and both are
   built from `production_keystore` (`os/pkgs/mosd/mosd/src/reconciler/network.rs:156`)
   so they cannot end up reading different key files.

## Out of scope, and untouched

apid: no route, no pane, no `openapi.json`, no `privateKey` entry in the
redaction denylist — all M6. Kernel and image proof is M7, design prose is M8,
and peer pre-shared keys are excluded from schema v7 by PLAN-022 Amendment 1,
so `WireguardConfig` grew no field here. No other task or plan file was edited
and no citation was re-anchored: the code added in this milestone sits below
the constructs earlier records cite in `wgkeys.rs` (a new file) and above none
of them in `network.rs` that any document names by line.

## Verification

| gate | result |
| --- | --- |
| `bash os/pkgs/mosd/hack/check.sh` | `Summary [ 44.982s] 656 tests run: 656 passed, 0 skipped`, doctests ok, `advisories ok, bans ok, licenses ok`, `ALL CHECKS PASSED` |
| `bash os/pkgs/rauc-sign/hack/check.sh` | `15 tests run: 15 passed`, `ALL CHECKS PASSED` |
| `bash docs/verify-citations.sh` | `1257/1257 PASS`, RFCT-204 at 0 unquoted citations |
| `bash docs/verify-index.sh` | `720/720 PASS` |

The suite went from 630 tests to 656, the twenty-six this milestone adds; the
merged branch arrived green at 630 and both docs gates arrived green, so every
red in between was this milestone's own and is accounted for above. `cargo
deny` is green with the new crates: `x25519-dalek`, `curve25519-dalek` and
`fiat-crypto` are BSD-3-Clause or MIT, none carries an advisory, and `base64`
resolved to the 0.22 already in the graph, so the duplicate-version warnings
are the ones that were there before.

One red was neither a line shift nor a test: zbus copies a method's doc comment
into the interface XML, so an intra-doc link to the transient-password method
put its snake_case spelling in front of every client and tripped the bus
round-trip test that exists to forbid exactly that. The link is now prose. It
is recorded here because the trap is invisible in review — a doc comment on a
`#[zbus::interface]` method is a wire artefact.

Rust gates run in the `localhost/mos-build-rust` container against the 1.98
toolchain, with `cargo nextest` 0.9.133 and `dbus-daemon` installed in the
container for the bus round-trip test.
