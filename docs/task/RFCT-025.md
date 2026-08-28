# RFCT-025 WiFi station reconciler in mosd (wpa_supplicant, uplink only)

- **status**: completed — implementation complete
- **priority**: P1
- **owner**: (bkd campaign)
- **createdAt**: 2026-08-19 00:23
- **claimedAt**: 2026-08-19 03:10
- **completedAt**: 2026-08-19 04:05

## Description

`docs/plan/PLAN-008.md` Part B defines the WiFi station model: a list of known
networks, each with an SSID, an optional pre-shared key, a hidden flag and a
selection priority. RFCT-021 made the settings tree able to *hold* that list
(`wifi.client`, schema v3). Nothing turned it into anything the radio does.
This task is that step.

`mosd/mosd/src/reconciler/wifi_client.rs` is the whole feature. It is modelled
line-for-line on `sshd.rs`: pure render, compare-before-write, atomic write,
read-live-state-before-acting, restart-on-config-change, and a named outcome
rather than a boolean.

**Access-point mode is not in this task.** `wifi.ap` belongs to a sibling
reconciler; nothing here reads it.

### The three system effects, and why in this order

1. **`/etc/wpa_supplicant/wpa_supplicant-<interface>.conf`** is rendered from
   `wifi.client`. That exact path is not a preference: Debian's
   `wpa_supplicant@.service` template has
   `-c/etc/wpa_supplicant/wpa_supplicant-%I.conf` baked into its `ExecStart`,
   so the file name is a contract with the unit. Mode 0600, because it carries
   PSKs in the clear — wpa_supplicant has no other way to be given a
   passphrase.
2. **A networkd `.network` unit** for the interface, `DHCP=yes`, in the same
   shape `network.rs` renders today. Association without addressing is a link
   that reports carrier and moves no traffic — precisely the M4 defect shape
   ("the component is present and the integration does not work"), so it is
   part of this reconciler rather than left to be noticed later.
3. **`wpa_supplicant@<interface>.service`** is brought to the state
   `wifi.client.enabled` asks for.

Configuration before unit, deliberately: a supplicant started against a stale
or absent configuration associates with the previous network, or with none.

### Rendering, and the injection surface

The render is a pure function of `wifi.client` and is byte-identical for
identical settings, which is what makes the compare-before-write in step 1
meaningful. `multi_network_render_matches_the_golden_file` pins the exact
bytes:

```
# Managed by mosd from wifi.client. Do not edit.
ctrl_interface=/run/wpa_supplicant
update_config=0

network={
	ssid="hidden-lab"
	scan_ssid=1
	priority=20
	key_mgmt=WPA-PSK
	psk="labsecret1"
}

network={
	ssid="office"
	priority=10
	key_mgmt=WPA-PSK
	psk="officepass"
}

network={
	ssid="guest-wifi"
	priority=5
	key_mgmt=NONE
}
```

- **Ordered by `priority`, highest first, and every block states its own
  `priority=`.** Both, not either: emitting the blocks in order alone would
  leave wpa_supplicant free to select by its own default priority of 0, and
  emitting `priority=` alone would make the file read in an order that is not
  the order it behaves in. Equal priorities keep their settings order, because
  the sort is stable.
- **`update_config=0` is stated rather than left to the default.** The file is
  mosd's render of the settings tree; a `wpa_cli save_config` that rewrote it
  would be silently reverted on the next reconcile, and being explicit is what
  makes that impossible rather than merely unlikely.
- **`psk: None` is an open network -> `key_mgmt=NONE`, and a PSK present is a
  WPA-PSK block.** Getting this backwards downgrades a protected network to
  open while every file, unit and status still looks healthy, so it is tested
  in both directions: an open network must emit `key_mgmt=NONE` and **no**
  `psk=` line, and a PSK network must emit a key and must **never** contain
  `key_mgmt=NONE`. Mutation M3 confirms the pair is real.
- **`hidden: true` -> `scan_ssid=1`, and nothing else emits it** (M6).

**SSID escaping.** An SSID is operator-supplied text that lands inside a
`network={…}` block. A newline in it would close the block and let the
remainder be read as directives of its own. So:

- an SSID that is printable ASCII and contains no `"` and no `\` is emitted
  quoted, which is what an operator reading the file on device expects;
- **anything else is emitted in wpa_supplicant's unquoted hex form**, whose
  alphabet is `0-9a-f`. Injection is not merely escaped there, it is not
  expressible.

`a_hostile_ssid_cannot_inject_configuration` drives the full escape —
`evil"` + newline + `}` + a whole second `network={…}` block + a trailing `#` —
and asserts the render is *exactly* one well-formed block, that `pwned` does
not appear anywhere in the output, and that the `ssid=` value is the hex of the
input bytes. `every_unquotable_ssid_shape_goes_to_hex_and_plain_ones_stay_
quoted` covers each dangerous character on its own (`"`, `\`, newline, tab,
NUL, non-ASCII) plus five plain SSIDs that must stay readable — including
`with#hash` and `with'quote`, which are safe inside a quoted wpa_supplicant
string and must not be pushed to hex for nothing.

The second test is not redundant with the first: mutation M1 (dropping only
the `"` exclusion from the quotable predicate) is invisible to the hostile-SSID
test, because that SSID also contains a newline and goes to hex either way.
Only the per-character test catches it.

**PSK encoding.** A 64-character hex string is a raw 256-bit PMK and is emitted
unquoted; quoting it would make wpa_supplicant read it as a 64-character
passphrase, which exceeds the 63-character maximum and makes it reject the
**whole file**, taking every other network down with it (M17). Anything else is
a passphrase and is quoted. A passphrase that cannot be quoted is an **error**,
not a hex fallback: bare hex means a raw PMK, so there is nothing to fall back
to. The error names the SSID and never the key (M18, and see secret hygiene
below).

### `enabled: true` with an empty `networks` list — the decided behaviour

This is a state a UI produces in one click, so it is defined rather than left
to fall out of the code:

> **The configuration is still rendered (header only, deterministic), and the
> supplicant is kept down.** The live state reports `station: "idle"`, which is
> deliberately distinct from `"disabled"`.

Two reasons, one of them a real conflict rather than tidiness:

- a running wpa_supplicant **claims the radio**. It puts the interface into
  managed mode and holds it. A radio claimed by a station role that can never
  associate is a radio the access-point role cannot use — and the AP role is
  exactly what a device with no configured network needs in order to be given
  one. Starting an idle supplicant would break the provisioning path it is
  supposed to be waiting for.
- `"idle"` and `"disabled"` must not read the same. The operator asked for the
  station role and simply has not finished configuring it; the UI needs to be
  able to say so.

The configuration is nevertheless rendered while the station is down, so that
adding the first network is an ordinary configuration change against a known
file rather than a first render (M20). The networkd unit is *not* rendered
while the station is down — nothing will associate, and a DHCP unit on a link
that never comes up is a link stuck in `configuring`.

### Sharing a directory with the network reconciler

Both reconcilers render into networkd's runtime drop-in directory. `network.rs`
**deletes every `*-mos-*.network` it did not itself render**. A station unit
named `50-mos-wlan0.network` would therefore be swept away on the network
reconciler's next pass — the component present, every unit test green, and WiFi
without an address on device.

So the prefix is `90-wifi-client-`, chosen for two independent properties:

- it does **not** contain `-mos-`, so the network reconciler's sweep does not
  match it;
- `90-` sorts after `50-mos-…` and after the image's `80-dhcp.network`, and
  networkd applies the first matching unit in lexical order. An interface the
  operator configured explicitly under `network.<iface>` therefore keeps
  winning over this reconciler's implicit DHCP default, whatever the interface
  is called.

`the_rendered_networkd_unit_survives_the_network_reconcilers_sweep` is not a
name check: it renders the unit, then runs the **real** `NetworkReconciler`
over the same directory and asserts the file is still there with its contents
intact. Mutation M14 (moving the prefix into the swept pattern) fails it along
with six others.

This reconciler sweeps its own namespace in turn — every
`90-wifi-client-*.network` that is not the wanted one is removed — which is
what makes an interface rename converge instead of leaving networkd running
DHCP on a link mosd no longer manages (M15).

### Convergence

Copied from `sshd.rs` rather than re-invented:

- **Read before acting.** `apply_unit` reads `unit_file_state` and
  `active_state` first and issues only the calls that change something. An
  already-correct system produces **zero** bus calls —
  `an_already_converged_enabled_station_needs_no_calls_at_all` and its disabled
  twin assert exactly that, on the mock's recorded call list.
- **Skip the write when the bytes match.** The configuration lives on STATE;
  a rewrite that changes nothing still costs a flash write on every reconcile.
  `reapplying_identical_settings_is_a_no_op_with_zero_bus_calls` proves it the
  non-tautological way: it chmods the file to 0644 between the two applies and
  asserts it is *still* 0644 afterwards, because the renderer only ever
  produces 0600 (M9).
- **Reload networkd only when a networkd file actually changed** (M16).
- **Restart a running supplicant whose configuration changed.**
  wpa_supplicant reads its configuration once at start. A rewritten file that
  nothing re-reads leaves the device associated with the previous network while
  the settings tree, the live state and the file on disk all agree it should
  not be. `changing_the_config_of_a_running_supplicant_restarts_it` (M10).
  The negative direction is covered too: a config change on a **stopped**
  supplicant must not start it.

**Outcomes are named, never boolean** — `applied`, `unchanged`, `idle`,
`disabled`. `applied` covers a change to any of the three effects (config
bytes, networkd unit, unit state).

### Secret hygiene

A PSK reaches exactly one place: the 0600 configuration file. It reaches
nothing else.

- **The live-state tree carries no key.** Per network it publishes `ssid`,
  `hidden`, `priority` and `secured` (a bool: does a key exist). SSIDs are
  broadcast over the air and are not secrets; the key is. This matters because
  the live-state tree is served over D-Bus to webd and anything else on the
  bus.
- **The module contains no logging statement at all** — no `tracing`, no
  `println!`, no `dbg!`. Mechanically checked, output in Verification.
- **Error messages name the SSID, never the key.** The one error that can be
  raised by key handling says only that the key contains a character the
  configuration format cannot carry, and how to fix it.

`the_psk_reaches_the_config_file_and_nothing_else` drives a distinctive canary
key and asserts it is absent from the serialised live-state tree, from the
networkd unit and from the recorded unit calls. Its first assertion is the
anti-tautology guard: the key **must** be present in the configuration file, or
every absence below it would be vacuous. Mutation M12 (publishing the key in
the live state) fails it.

### Atomic write, and the mode that is set before the rename

Temp file in the same directory, written, flushed, mode set, then renamed.
Same directory because `rename` is only atomic within one filesystem. The mode
is applied to the **temporary** file, before the rename that makes it visible
under its real name — a file full of PSKs must never exist at the target path
with a umask-derived mode, not even for an instant.

Two mode calls, not one: `OpenOptions::mode()` applies only when the temporary
file is *created* and is masked by the umask even then, so an explicit
`set_permissions` follows — still before the rename.
`a_leftover_temporary_file_does_not_widen_the_mode` sets up the case that makes
the difference observable: a 0666 temporary file left behind by an interrupted
run, which the open-time mode cannot fix. M8 (removing the explicit
`set_permissions`) fails it and nothing else.

Both mode assertions compare against the **literal** `0o600`, not against
`CONFIG_MODE`. M7 confirms it: widening the constant fails the tests instead of
silently moving the expectation with it. (A previous L3 in this campaign was
bitten by exactly that tautology.)

### Interface-name validation

`wifi.client.interface` is free-form operator input that ends up inside a file
name (`wpa_supplicant-<iface>.conf`) and inside a systemd unit instance name.
`../../etc/passwd` in that field would make the reconciler write outside its
own directory. So the name is validated first: non-empty, at most 15 bytes
(`IFNAMSIZ` minus the terminator), not `.` or `..`, and ASCII alphanumerics
plus `.`, `-`, `_`, `:` only. Both directions are tested — ten rejected shapes
including the traversal, a space, a newline and a shell metacharacter, and five
accepted real interface names (`wlan0`, `wlp2s0`, `wlan0.1`, `wl-an_0`,
`eth0:1`), because a validator that rejects `wlp2s0` is as broken as one that
accepts `../../evil`. Validation runs before any I/O:
`a_traversing_interface_name_writes_nothing_anywhere` asserts neither directory
is even created and no unit call is made (M13).

## Image requirements — recorded here, NOT implemented (R6)

`os/**` is untouched by this task. The image L3 owns the following, and can
assert each one directly:

| Requirement | Exact value |
|---|---|
| Package | `wpasupplicant` (Debian), which ships `/lib/systemd/system/wpa_supplicant@.service` |
| Unit template | `wpa_supplicant@.service`, instantiated by mosd as `wpa_supplicant@<interface>.service` (default interface `wlan0`) |
| Config directory | `/etc/wpa_supplicant` must be **writable at runtime**, STATE-backed, exactly as `/etc/ssh/sshd_config.d` already is (`etc-ssh.mount`). The v2 root is a read-only dm-verity squashfs and offers nothing else. |
| Config file | `/etc/wpa_supplicant/wpa_supplicant-<interface>.conf`, written 0600 by mosd. The path is the `wpa_supplicant@.service` template's own `-c` argument; changing either side breaks the other. |
| Control socket dir | `/run/wpa_supplicant` — the rendered `ctrl_interface`. On tmpfs, created by wpa_supplicant itself. |
| networkd dir | `/run/systemd/network` (already used by the network reconciler) |
| Firmware | the board's WiFi firmware blob must be in the image's firmware directory, or the interface never appears at all |

The mosd side takes both directory paths from the environment
(`MOSD_WPA_SUPPLICANT_DIR`, `MOSD_NETWORK_DIR`) and falls back to the values
above, so the image can relocate them without a code change.

**No secret enters the image.** Every PSK in the rendered file comes from the
settings tree on STATE, which is born at runtime. Nothing here is baked into
the signed rootfs.

## Scope

Owned here:

- `mosd/mosd/src/reconciler/wifi_client.rs` — the feature and its 31 tests.
- `mosd/mosd/src/reconciler/mod.rs` — the `mod` line and one registration.
- `docs/task/RFCT-025.md`.

Not touched: `mosd/mosd/src/reconciler/systemd.rs` (the `UnitControl` trait is
**consumed unchanged** — no additive extension was needed, so the AP sibling
sees no collision), `network.rs` (its `NetworkReload` trait and `Networkd`
executor are likewise consumed unchanged), `identity.rs`, `mosd/Cargo.lock`
(no dependency change; the hex encoder is the workspace's existing `hex`
crate), `os/**`, `mosd/webd/**`.

## Known limitations, stated rather than hidden

- **Passphrase length is not validated.** wpa_supplicant requires 8–63
  characters; a shorter one makes it reject the entire file, taking every
  network down. Rejecting it belongs in `mosd-settings` validation, with the
  rest of the settings schema, not in the renderer. Recorded, not implemented.
- **WPA3-SAE is not expressible.** `key_mgmt=WPA-PSK` covers WPA2-PSK and
  WPA/WPA2 mixed mode. An SAE-only access point needs `key_mgmt=SAE` and
  `ieee80211w`, and the settings model (`WifiNetwork`) has no field to ask for
  it. A schema change, not a renderer change.
- **A stale `wpa_supplicant-<old>.conf` and its unit are not swept on an
  interface rename.** The networkd side *is* swept (above). The wpa_supplicant
  side is not, because stopping units for interfaces mosd was never told about
  is a broader claim of ownership than `wifi.client` grants, and the AP
  reconciler may legitimately want another instance. The blast radius is
  bounded: unit enablement is runtime-scoped (see `systemd.rs`), the stale file
  is inert unless something starts that instance, and mosd only ever starts the
  configured one — so a reboot clears it.
- **`write_atomically` is duplicated from `sshd.rs`** (minus its ownership
  parameter, which only the shadow file needs). Lifting it into a shared helper
  means editing `sshd.rs`, which this task is explicitly forbidden to touch;
  worth doing once the campaign's reconcilers have all landed.
- **On-device behaviour is the user's acceptance and is not claimed here.**
  Every test in this task runs against a mock `UnitControl`, a mock
  `NetworkReload` and a tempdir. Nothing has been near a radio.

## Work checklist

- [x] R1 wpa_supplicant config rendered from `wifi.client` at the template's path
- [x] R1 ordered by priority, explicit `priority=`, `key_mgmt=NONE` for open,
      `scan_ssid=1` for hidden, SSID escaping proof against injection
- [x] R1 path is a parameter; render pure and deterministic; golden-file test
- [x] R1 0600, atomic write, mode set on the temp file before the rename
- [x] R2 `enabled` drives `wpa_supplicant@<interface>.service` in both directions
- [x] R2 networkd `.network` rendered for the interface, DHCP, network.rs shape
- [x] R3 read-before-act, skip-unchanged-write, restart-on-change, named outcomes
- [x] R4 no PSK in any log line, error message or live-state value
- [x] R5 31 tests, all against mocks and tempdirs; no host wpa_supplicant, no
      host `/etc`, no real bus
- [x] R5 empty `networks` with `enabled: true` decided, documented and tested
- [x] R6 image requirements recorded above; `os/**` untouched
- [x] `UnitControl` consumed unchanged — no edit to `systemd.rs`
- [x] No new third-party crate; `mosd/Cargo.lock` unchanged
- [x] `bash mosd/hack/check.sh` prints `ALL CHECKS PASSED`

## Verification (2026-08-19)

Command:

```
bash mosd/hack/check.sh
```

Result:

```
     Summary [  28.512s] 158 tests run: 158 passed, 0 skipped
ALL CHECKS PASSED
```

158 tests, 158 passed, 0 skipped — `cargo fmt --all --check`, `cargo clippy
--workspace --all-targets --locked -- -D warnings`, `cargo nextest run
--workspace --locked` and `cargo deny check licenses bans advisories` all
clean. This task adds 31 of those tests; the suite was at 127 before it.

The 31:

```
    Starting 31 tests across 9 binaries (127 tests skipped)
        PASS ( 1/31) reconciler::wifi_client::tests::a_psk_network_emits_a_key_and_never_key_mgmt_none
        PASS ( 2/31) reconciler::wifi_client::tests::a_passphrase_that_cannot_be_quoted_is_an_error_that_does_not_name_it
        PASS ( 3/31) reconciler::wifi_client::tests::a_traversing_interface_name_writes_nothing_anywhere
        PASS ( 4/31) reconciler::wifi_client::tests::a_sixty_four_character_hex_key_is_emitted_as_a_raw_pmk
        PASS ( 5/31) reconciler::wifi_client::tests::a_hostile_ssid_cannot_inject_configuration
        PASS ( 6/31) reconciler::wifi_client::tests::an_already_converged_enabled_station_needs_no_calls_at_all
        PASS ( 7/31) reconciler::wifi_client::tests::an_open_network_emits_key_mgmt_none_and_no_psk
        PASS ( 8/31) reconciler::wifi_client::tests::an_already_stopped_disabled_station_needs_no_calls_at_all
        PASS ( 9/31) reconciler::wifi_client::tests::an_unrenderable_key_fails_before_anything_is_written_or_started
        PASS (10/31) reconciler::wifi_client::tests::a_leftover_temporary_file_does_not_widen_the_mode
        PASS (11/31) reconciler::wifi_client::tests::apply_leaves_no_temporary_file_behind
        PASS (12/31) reconciler::wifi_client::tests::an_enabled_station_gets_a_networkd_unit_that_addresses_the_link
        PASS (13/31) reconciler::wifi_client::tests::changing_the_config_of_a_running_supplicant_restarts_it
        PASS (14/31) reconciler::wifi_client::tests::disabled_to_enabled_enables_then_starts
        PASS (15/31) reconciler::wifi_client::tests::apply_writes_the_golden_config_at_0600_creating_its_directory
        PASS (16/31) reconciler::wifi_client::tests::changing_the_config_of_a_stopped_supplicant_does_not_start_it
        PASS (17/31) reconciler::wifi_client::tests::every_unquotable_ssid_shape_goes_to_hex_and_plain_ones_stay_quoted
        PASS (18/31) reconciler::wifi_client::tests::equal_priorities_keep_their_settings_order
        PASS (19/31) reconciler::wifi_client::tests::an_open_network_is_reported_unsecured
        PASS (20/31) reconciler::wifi_client::tests::hidden_is_the_only_thing_that_emits_scan_ssid
        PASS (21/31) reconciler::wifi_client::tests::interface_names_that_are_not_names_are_rejected
        PASS (22/31) reconciler::wifi_client::tests::networks_are_ordered_by_priority_with_an_explicit_priority_line
        PASS (23/31) reconciler::wifi_client::tests::multi_network_render_matches_the_golden_file
        PASS (24/31) reconciler::wifi_client::tests::enabled_to_disabled_stops_then_disables_and_drops_the_networkd_unit
        PASS (25/31) reconciler::wifi_client::tests::render_is_deterministic
        PASS (26/31) reconciler::wifi_client::tests::every_path_the_reconciler_writes_stays_inside_the_tempdir
        PASS (27/31) reconciler::wifi_client::tests::reapplying_identical_settings_is_a_no_op_with_zero_bus_calls
        PASS (28/31) reconciler::wifi_client::tests::enabled_with_no_networks_stays_down_and_reports_idle
        PASS (29/31) reconciler::wifi_client::tests::the_rendered_networkd_unit_survives_the_network_reconcilers_sweep
        PASS (30/31) reconciler::wifi_client::tests::the_psk_reaches_the_config_file_and_nothing_else
        PASS (31/31) reconciler::wifi_client::tests::renaming_the_interface_removes_the_previous_networkd_unit
     Summary [   0.254s] 31 tests run: 31 passed, 127 skipped
```

### The no-logging check, mechanically

```
$ grep -vE "^\s*(//|///|//!)" mosd/mosd/src/reconciler/wifi_client.rs \
    | grep -nE "tracing|println!|eprintln!|dbg!"
$ echo $?
1
```

No hit on any non-comment line: the module emits nothing to a log, so a PSK
cannot reach one.

### Mutation testing

Twenty guards were removed or inverted one at a time and the suite re-run with
`--no-fail-fast`, to prove each test fails for the reason it claims rather than
passing for an unrelated one. **Every mutation was caught; there were no
survivors.** All were reverted, and the check run above is on the reverted tree
(`diff` against the pre-mutation copy is empty).

| # | Mutation | Tests that FAILED |
|---|---|---|
| M1 | `is_quotable` no longer excludes the closing `"` | `every_unquotable_ssid_shape_goes_to_hex_and_plain_ones_stay_quoted` (30 passed, 1 failed) |
| M2 | `encode_ssid` always quotes; hex fallback removed | `a_hostile_ssid_cannot_inject_configuration`, `every_unquotable_ssid_shape_…` (29/2) |
| M3 | open/PSK inverted: a PSK network emits `key_mgmt=NONE` | `a_psk_network_emits_a_key_and_never_key_mgmt_none`, `multi_network_render_matches_the_golden_file`, `apply_writes_the_golden_config_at_0600_…`, `an_already_converged_…`, `reapplying_identical_settings_…` (26/5) |
| M4 | priority sort removed | `networks_are_ordered_by_priority_…`, `multi_network_render_…`, `apply_writes_the_golden_config_…`, `an_already_converged_…`, `reapplying_identical_settings_…` (26/5) |
| M5 | explicit `priority=` line removed | the five above plus `a_hostile_ssid_cannot_inject_configuration` (25/6) |
| M6 | `scan_ssid=1` emitted for every network | `hidden_is_the_only_thing_that_emits_scan_ssid` + 5 (25/6) |
| M7 | `CONFIG_MODE` widened to `0o644` | `apply_writes_the_golden_config_at_0600_…`, `a_leftover_temporary_file_does_not_widen_the_mode` (29/2) |
| M8 | explicit `set_permissions` before the rename removed | `a_leftover_temporary_file_does_not_widen_the_mode` (30/1) |
| M9 | unchanged-bytes skip removed (rewrite every reconcile) | `an_already_converged_…`, `reapplying_identical_settings_is_a_no_op_with_zero_bus_calls` (29/2) |
| M10 | restart-on-config-change removed | `changing_the_config_of_a_running_supplicant_restarts_it` (30/1) |
| M11 | empty `networks` no longer keeps the station down | `enabled_with_no_networks_stays_down_and_reports_idle` (30/1) |
| M12 | the PSK is published in the live-state tree | `the_psk_reaches_the_config_file_and_nothing_else` (30/1) |
| M13 | interface validation removed | `a_traversing_interface_name_writes_nothing_anywhere` (30/1) |
| M14 | networkd prefix moved into the network reconciler's swept pattern (`50-mos-wifi-client-`) | `the_rendered_networkd_unit_survives_the_network_reconcilers_sweep` + 6 others (24/7) |
| M15 | stale-networkd sweep removed | `renaming_the_interface_removes_the_previous_networkd_unit`, `enabled_to_disabled_…`, `enabled_with_no_networks_…` (28/3) |
| M16 | networkd reloaded unconditionally | `an_already_converged_…`, `an_already_stopped_disabled_…`, `reapplying_identical_settings_…` (28/3) |
| M17 | raw-PMK path removed (a 64-hex key gets quoted) | `a_sixty_four_character_hex_key_is_emitted_as_a_raw_pmk` (30/1) |
| M18 | unquotable passphrase accepted instead of rejected | `a_passphrase_that_cannot_be_quoted_is_an_error_that_does_not_name_it`, `an_unrenderable_key_fails_before_anything_is_written_or_started` (29/2) |
| M19 | `Station::Idle` folded into `Disabled` | `enabled_with_no_networks_stays_down_and_reports_idle` (30/1) |
| M20 | config no longer rendered while the station is kept down | `enabled_with_no_networks_stays_down_and_reports_idle` (30/1) |

Three rows deserve comment.

**M1 is why there are two SSID-escaping tests.** The hostile-SSID test drives an
SSID containing a newline *and* a quote, so removing only the quote exclusion
still sends it to hex and the test still passes. Only the per-character test,
which drives `has"quote` on its own, detects it. A single "hostile input" test
would have left that hole invisible.

**M7 is the tautology check.** Both mode assertions compare against the literal
`0o600` rather than against `CONFIG_MODE`, so widening the constant fails them.
Had they compared against the constant, M7 would have passed silently — which
is the exact hole a previous L3 in this campaign found in its own mode
assertions.

**M14 is the M4-lesson check.** It is the mutation that models the real
integration failure: a station networkd unit named so that the *other*
reconciler deletes it. Seven tests fail, led by the one that runs the real
`NetworkReconciler` over the same directory. Asserting the file merely *exists*
after this reconciler's own `apply` would have caught none of it.

## ActiveForm

Implementing the WiFi station reconciler so `wifi.client` becomes
wpa_supplicant configuration and a running, addressed uplink.

## Dependencies

- **blocked by**: RFCT-021 (settings schema v3, `wifi.client`), RFCT-023
  (`UnitControl` and the sshd reconciler this one is modelled on)
- **blocks**: the image task that must ship `wpasupplicant`, the unit template
  and a writable STATE-backed `/etc/wpa_supplicant` (see the table above)
- **sibling, no overlap**: the `wifi.ap` reconciler — it consumes the same
  `UnitControl` trait, which this task left unchanged
