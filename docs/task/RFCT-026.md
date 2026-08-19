# RFCT-026 WiFi access-point reconciler in mosd (hostapd, provisioning AP)

- **status**: implementation complete
- **priority**: P1
- **owner**: ai-agent
- **createdAt**: 2026-08-19 00:23
- **claimedAt**: 2026-08-19 05:05
- **completedAt**: 2026-08-19 06:10

## Description

`docs/plan/PLAN-008.md` Part D defines the provisioning access point: with no
usable uplink the device raises an AP of its own, webd serves the setup UI on
it, and the operator hands the device a network. RFCT-021 made the settings
tree able to *hold* that configuration (`wifi.ap`, schema v3); RFCT-025 gave
the station role its reconciler. Nothing turned `wifi.ap` into anything the
radio does. This task is that step.

`mosd/mosd/src/reconciler/wifi_ap.rs` is the whole feature, modelled
line-for-line on its station sibling: pure render, compare-before-write, atomic
0600 write, read-live-state-before-acting, restart-on-config-change, named
outcomes rather than booleans, and zero bus calls on a converged system.

**Automatic STA/AP arbitration is not in this task.** `holdDownSeconds` and
`graceSeconds` are read by nothing here — see "The single-radio conflict"
below.

### The three system effects, and why in this order

1. **`/etc/hostapd/<interface>.conf`** is rendered from `wifi.ap`. Mode 0600,
   because it carries the WPA2 pre-shared key in the clear — hostapd has no
   other way to be given one.
2. **A networkd `.network` unit** carrying the AP-side address and
   `DHCPServer=yes`. An access point clients can associate with but which hands
   out no address is an access point nothing can reach, the setup UI included —
   precisely the M4 defect shape ("the component is present and the integration
   does not work"), so it is part of this reconciler rather than left to be
   noticed on hardware.
3. **`hostapd@<interface>.service`** is brought to the state `wifi.ap.mode`
   asks for.

Configuration before unit, deliberately: hostapd reads its configuration once
at start, so a unit started against a stale file beacons the previous SSID with
the previous key.

**systemd-networkd's own DHCP server, not dnsmasq.** No extra package, nothing
to add to the signed rootfs, and the server's lifecycle is the same networkd
reload the address already needs.

### Rendering, and the injection surface

Pure function of (`wifi.ap`, resolved SSID, resolved key), byte-identical for
identical inputs — which is what makes the compare-before-write meaningful.
`the_render_matches_the_golden_file` pins the exact bytes:

```
# Managed by mosd from wifi.ap. Do not edit.
interface=wlan0
driver=nl80211
ssid=mos-lab
country_code=DE
ieee80211d=1
hw_mode=g
channel=11
auth_algs=1
ignore_broadcast_ssid=0
wmm_enabled=1
wpa=2
wpa_key_mgmt=WPA-PSK
rsn_pairwise=CCMP
wpa_passphrase=labsecret1
```

- **WPA2-PSK, never open.** `wpa=2` + `wpa_key_mgmt=WPA-PSK` +
  `rsn_pairwise=CCMP`, asserted as a set (M29). The settings model cannot
  express an open AP, and an AP that carries the path to a device's
  configuration must not become one by accident.
- **`ieee80211d=1` is what makes `country_code` more than a comment.** Without
  it hostapd carries the code and does not advertise the regulatory domain
  (M28).
- **`hw_mode=g`** is fixed because `wifi.ap.channel` is documented as a 2.4 GHz
  channel. The channel is validated to 1..=14 in both directions; hostapd
  refuses to start on anything else, so an out-of-band value would be an AP
  that never appears with no obvious reason why.

**SSID escaping — hostapd's rules are not wpa_supplicant's, and this was
checked rather than assumed.** wpa_supplicant's `ssid=` takes a double-quoted
string, so the station reconciler escapes *into* quotes. hostapd's `ssid=`
takes the bytes after the `=` **literally to the end of the line**: there is no
quoting to escape into, a `"` is an ordinary character, and a newline simply
starts the next directive. Reusing the station's quoted form here would have
emitted a literal pair of quotes as part of the SSID — a working AP with the
wrong name, which no unit test comparing "is the SSID in the file" would catch.

What hostapd does offer is a second key: **`ssid2=` accepts a hexdump of the
SSID bytes.** So the *discipline* is the station's, spelled hostapd's way:

- an SSID that can be carried raw is emitted as `ssid=<value>`, which is what
  an operator reading the file on device expects;
- anything else is emitted as `ssid2=<hex>`, whose alphabet is `0-9a-f`.
  Injection is not merely escaped there — it is not expressible.

The two keys are not interchangeable spellings of one directive (`ssid=` has no
hex form, `ssid2=` has no raw form), so the key moves with the encoding.

The accepted "raw" set is the station's `is_quotable` set — printable ASCII,
no `"`, no `\` — **plus** a rejection of leading and trailing spaces. The extra
rule is because hostapd's line reader is not documented to preserve edge
whitespace, and an SSID silently trimmed to a different name is an AP the
operator cannot find. `"` and `\` are harmless in a raw hostapd value and are
excluded anyway, so that one character set governs both files rather than two
that have to be reasoned about separately; the cost is that a handful of legal
SSIDs take the hex form and stay just as correct.

The hostile case: `a_hostile_ssid_cannot_inject_configuration` drives
`evil\nssid=pwned\nwpa=0\n#` — an SSID that ends the directive, sets a second
SSID, and turns the AP open. The test asserts `pwned` appears nowhere, `wpa=0`
appears nowhere, exactly one SSID directive is emitted, and the render is the
golden file with **only** the SSID line changed.
`every_unrepresentable_ssid_goes_to_hex_and_plain_ones_stay_readable` covers
each dangerous shape on its own (newline, tab, NUL, quote, backslash, non-ASCII,
leading space, trailing space) plus five plain SSIDs that must stay readable.
The second test is not redundant: M2 (dropping only the edge-whitespace rule)
is invisible to the hostile-SSID test and is caught only by the per-character
one.

`country_code` is the other free-form value rendered raw, so its validator is
an injection guard as much as a validity check: exactly two ASCII letters
cannot carry a newline (M5). `interface` is validated as an interface name, and
`address` is parsed and re-rendered from its parsed parts, so neither can carry
anything into the file either.

**Regulatory correctness is not something this repo can verify.** `country_code`
is passed through to hostapd and advertised; whether the resulting channel and
transmit power are legal where the device is deployed depends on the regulatory
database in the image, the driver, and the operator setting the right code.
mosd validates the *shape* of the value and nothing about its truth.

**Key encoding.** A 64-character hex string is a raw 256-bit PMK and is emitted
as `wpa_psk=`; anything else is a passphrase and is emitted as
`wpa_passphrase=`. Using the wrong key name makes hostapd reject the whole file
(M7). A passphrase outside 8..=63 characters, or one that cannot be carried
unambiguously, is an **error**: bare hex already means a raw PMK, so there is
no hex fallback to take, and deriving a PMK from a passphrase would need
PBKDF2 (a dependency this task may not add). The error names neither the key
nor its length-in-context (M8, M9).

### Where the SSID and the key come from

**SSID.** `wifi.ap.ssid` when set; otherwise derived from
`provisioning.deviceId` as `mos-<first 8 hex>` — the same prefix and the same
identifier length the derived hostname uses, so a device advertising
`mos-1a2b3c4d` is recognisably the device called `mos-1a2b3c4d`. Same deviceId
gives the same SSID, different deviceIds give different SSIDs, and both
directions are tested (M23). It is derived from the identity and never from a
secret. A device with neither a configured SSID nor an identity is a hard error
rather than a guess — it can only happen on an unprovisioned tree.

**Key.** `wifi.ap.psk` when set; otherwise `identity::read_ap_psk`, the
per-device key generated on STATE at first boot (RFCT-024). There is
deliberately **no constant fallback** (M24): the signed rootfs is byte-identical
on every device, so a baked default would be one WiFi key for the entire fleet
— and this AP is the path to a device's configuration. A device with no key in
either place refuses to raise the AP and says why.

`a_configured_key_wins_over_the_state_secret` pins the precedence with both
keys present, so neither source can quietly shadow the other.

### `mode: off` renders nothing — a deliberate difference from the station

The station reconciler renders its configuration even while the supplicant is
kept down, so adding the first network is an ordinary change against a known
file. This reconciler does **not**, because its key comes from STATE: on a
device that has not been provisioned yet there is no key to render, and
`mode: off` is the *default* setting. Rendering unconditionally would make the
default tree fail on every reconcile. So `off` writes no configuration, removes
the networkd unit, stops and disables the unit (M27).

A configuration left over from a previous `always` is not deleted. It is 0600
and inert — nothing starts that unit but mosd, and mosd only starts it when the
mode says so.

### The single-radio conflict — reported, never fought over

STA and AP cannot both own one radio. Two reconcilers each starting and
stopping units on the same interface would flap forever, each undoing the other
every cycle, and the device would be neither a station nor an access point.

> **When `wifi.ap.mode != off` and `wifi.client.enabled` is true and both name
> the same interface, the live state reports `accessPoint: "conflict"` and the
> reconciler does nothing at all** — no unit call, no configuration write, no
> networkd unit. It returns before any I/O.

In particular it does **not** stop the supplicant. That unit belongs to the
station reconciler, which would start it again on its next pass; M20 models
exactly that tempting fix and is caught by
`a_conflict_does_not_stop_the_station_s_unit`, which sets the mock up with the
station's unit already `active`/`enabled` and asserts the recorded call list is
empty.

The guard is negative-tested in every direction it can be wrong in:

| Case | Expected | Test |
|---|---|---|
| AP on, station enabled, same interface | `conflict`, nothing touched | `an_access_point_on_the_station_s_radio_reports_conflict_and_touches_nothing` |
| …and the station's unit is running | still nothing touched | `a_conflict_does_not_stop_the_station_s_unit` |
| AP on, station enabled, **different** interface | `applied` | `a_station_on_a_different_radio_is_not_a_conflict` |
| AP on, station **disabled**, same interface | `applied` | `a_disabled_station_on_the_same_radio_is_not_a_conflict` |
| AP **off**, station enabled, same interface | `stopped` | `an_access_point_that_is_off_never_conflicts_with_the_station` |

M17 (guard removed), M18 (interfaces no longer compared) and M19
(`enabled` ignored) are each caught by a different row: a check that fires on a
healthy two-radio system is as broken as one that misses the real conflict.

The conflict is decided on `wifi.client.enabled` alone, not on whether the
station has any networks to join. A station the operator switched on is a
station that owns the radio as far as configuration is concerned, and reporting
it is the point.

**Automatic arbitration is PLAN-008 Part D's later phase and is explicitly not
here.** `wifi.ap.holdDownSeconds` and `wifi.ap.graceSeconds` are in the schema
and are consumed by nothing in this reconciler: raising the AP on loss of
carrier after a hold-down, and dropping it a grace period after the uplink
returns, need a carrier watcher and a state machine that outlive a single
`apply`. Until that lands, `provisioning` behaves exactly like `always` — the
mode is recorded in live state so a UI can tell them apart, and
`provisioning_mode_starts_the_access_point_exactly_as_always_does` pins that
this is the decided behaviour rather than an oversight.

### The DHCP pool is derived from the address, not configured beside it

`wifi.ap.address` (default `192.168.4.1/24`) is parsed, and the pool is
computed from it:

```
[Match]
Name=wlan0

[Network]
Address=192.168.4.1/24
DHCPServer=yes

[DHCPServer]
PoolOffset=2
PoolSize=253
```

The pool starts one address above the access point and runs to the last address
before the broadcast address. One source of truth, deliberately: an operator
who changes the address must not have to change a second setting to keep the
pool consistent, and networkd accepts a pool outside the subnet without
complaint — it simply hands out addresses no client can use, which looks like a
working AP with broken clients.

`PoolOffset`/`PoolSize` are emitted explicitly rather than left to networkd's
default. The default happens to be the same rule today, but "the same rule"
that lives in another project's release notes is not a property this repo can
assert; an explicit value is one a golden test pins.

Both failure directions are guarded and tested: a pool that would include the
AP's own address (M21) and a pool that would run past the broadcast address
(M22) each fail six or seven tests, including
`the_pool_always_lies_inside_the_subnet_and_excludes_the_host`, which checks
the invariant arithmetically across several prefixes rather than comparing
against a second copy of the formula. Addresses that cannot carry a pool at all
— no prefix, `/31`, `/32`, the subnet address, the broadcast address, an
address so high nothing is left to hand out, and an address with a newline in
it — are rejected before anything is written or started.

### Sharing a directory with the network reconciler (R3)

`network.rs` **deletes every `*-mos-*.network` it did not itself render**. A
unit named `50-mos-wlan0.network` is therefore swept away on the network
reconciler's next pass — component present, tests green, AP with no address and
no DHCP server on device. The station L3 found this the hard way; this task did
not have to.

The prefix is `90-wifi-ap-`, chosen for the same two properties the station's
`90-wifi-client-` has:

- it does **not** contain `-mos-`, so the sweep does not match it;
- `90-` sorts after `50-mos-…` and after the image's `80-dhcp.network`, and
  networkd applies the first matching unit in lexical order, so an interface
  the operator configured explicitly under `network.<iface>` keeps winning.

`the_rendered_networkd_unit_survives_the_network_reconcilers_sweep` is not a
name check: it renders the unit, then runs the **real** `NetworkReconciler`
over the same tempdir and asserts the file is still there with its contents
intact. M14 (moving the prefix into the swept pattern) fails it along with six
others. `the_networkd_unit_sorts_after_the_units_it_must_not_override` asserts
the second property directly.

This reconciler sweeps its own namespace in turn — every `90-wifi-ap-*.network`
that is not the wanted one is removed — which is what makes an interface rename
converge instead of leaving an AP address and a DHCP server on a link mosd no
longer manages (M15).

### Convergence

- **Read before acting.** `apply_unit` reads `unit_file_state` and
  `active_state` first and issues only the calls that change something. An
  already-correct system produces **zero** bus calls
  (`an_already_converged_access_point_needs_no_calls_at_all`).
- **Skip the write when the bytes match** (M12). Proved the non-tautological
  way: `reapplying_identical_settings_is_a_no_op_with_zero_bus_calls` chmods
  the file to 0644 between the two applies and asserts it is *still* 0644,
  because the renderer only ever produces 0600.
- **Reload networkd only when a networkd file actually changed** (M16).
- **Restart a running hostapd whose configuration changed** (M13). hostapd
  reads its configuration once at start; without the restart the radio keeps
  beaconing the previous SSID with the previous key while the settings tree,
  the live state and the file on disk all agree it should not.
- **`off -> always -> off` in one test**, asserting the exact call sequence
  (`enable`, `start`, `stop`, `disable`), that the already-off first pass makes
  **zero** calls, and that the configuration and the networkd unit appear and
  disappear with it.

**Outcomes are named, never boolean** — `applied`, `unchanged`, `stopped`,
`conflict`.

### Secret hygiene

The pre-shared key reaches exactly one place: the 0600 configuration file.

- **The live-state tree carries no key.** It publishes `secured: true` — that a
  key exists, never what it is. This matters because the tree is served over
  D-Bus to webd and anything else on the bus (M25).
- **The module contains no logging statement at all** — no `tracing`, no
  `println!`, no `dbg!`. Mechanically checked, output in Verification.
- **No error names the key**, including the one raised when the key cannot be
  rendered at all.

`the_key_reaches_the_config_file_and_nothing_else` drives a distinctive canary
through the STATE-secret path and asserts it is absent from the serialised live
state, from the networkd unit and from the recorded unit calls. Its first
assertion is the anti-tautology guard: the key **must** be present in the
configuration file, or every absence below it would be vacuous.

### Atomic write, and the mode set before the rename

Temp file in the same directory, written, flushed, mode set, then renamed. Same
directory because `rename` is only atomic within one filesystem. The mode is
applied to the **temporary** file, before the rename that makes it visible under
its real name — a file carrying the AP key must never exist at the target path
with a umask-derived mode, not even for an instant.

Two mode calls, not one: `OpenOptions::mode()` applies only when the temporary
file is *created* and is masked by the umask even then, so an explicit
`set_permissions` follows, still before the rename.
`a_leftover_temporary_file_does_not_widen_the_mode` sets up the case that makes
the difference observable — a 0666 temporary file left by an interrupted run —
and M11 fails it and nothing else.

Both mode assertions compare against the **literal** `0o600`, not against
`CONFIG_MODE`. M10 confirms it: widening the constant fails the tests instead
of silently moving the expectation with it.

## Image requirements — recorded here, NOT implemented (R6)

`os/**` is untouched by this task. The image L3 owns the following and can
assert each one directly:

| Requirement | Exact value |
|---|---|
| Package | `hostapd` (Debian), providing `/usr/sbin/hostapd` |
| Unit template | `hostapd@.service`, instantiated by mosd as `hostapd@<interface>.service` (default interface `wlan0`). Its `ExecStart` **must** read `/etc/hostapd/%i.conf`. Debian is expected to ship this template; if it does not, or if its config path differs, the image L3 must provide or override the unit so the path matches — the file name is a contract between the unit and mosd, and mosd's side of it is `MOSD_HOSTAPD_DIR` plus `<interface>.conf`. Verify with `systemctl cat hostapd@wlan0.service` on the built rootfs. |
| Config directory | `/etc/hostapd` must be **writable at runtime**, STATE-backed, exactly as `/etc/ssh/sshd_config.d` already is (`etc-ssh.mount`). The v2 root is a read-only dm-verity squashfs and offers nothing else. Mode 0700 is appropriate: the directory holds the AP key. |
| Config file | `/etc/hostapd/<interface>.conf`, written 0600 by mosd. The path is the template's own argument; changing either side breaks the other. |
| Plain `hostapd.service` | Debian's `hostapd` package is expected to also ship a **non-templated** `hostapd.service` reading `/etc/hostapd/hostapd.conf`. If it carries an `[Install]` section and the package enables it, it must be **masked** in the image (`systemctl mask hostapd.service`, or an `/etc/systemd/system/hostapd.service -> /dev/null` symlink baked into the rootfs). Left enabled it starts a second hostapd on the same radio at boot against a file mosd does not write — the AP comes up with the wrong configuration, or not at all, while `hostapd@wlan0.service` reports healthy. **Not verified here** (no hostapd package in this build environment); the image L3 must check `dpkg -L hostapd` and `systemctl is-enabled hostapd.service` in the built rootfs and act on what it finds. |
| networkd dir | `/run/systemd/network` (already used by the network and station reconcilers) |
| networkd DHCP server | `systemd-networkd` must be the network manager; the DHCP server is `DHCPServer=yes` in the rendered unit. **No dnsmasq package is needed or wanted.** |
| Firmware | the board's WiFi firmware blob must be in the image's firmware directory, and the driver must support AP mode, or the interface never becomes an access point. On CX3576-Z the AP6275S vendor driver is the known risk (PLAN-008 Risks). |

The mosd side takes both directory paths from the environment
(`MOSD_HOSTAPD_DIR`, `MOSD_NETWORK_DIR`) and falls back to the values above, so
the image can relocate them without a code change.

**No secret enters the image.** The AP key is either in the settings tree on
STATE or in `/var/lib/mos/secrets/ap-psk`, both born at runtime. Nothing here is
baked into the signed rootfs.

## Scope

Owned here:

- `mosd/mosd/src/reconciler/wifi_ap.rs` — the feature and its 45 tests.
- `mosd/mosd/src/reconciler/mod.rs` — the `mod` line and one registration.
- `docs/task/RFCT-026.md`.

Not touched: `mosd/mosd/src/reconciler/systemd.rs` (`UnitControl` is **consumed
unchanged**, so the station sibling sees no collision), `network.rs`
(`NetworkReload` and `Networkd` likewise), `wifi_client.rs`, `sshd.rs`,
`identity.rs` (`read_ap_psk` is called, never edited), `mosd/Cargo.lock` (no
dependency change; the hex encoder is the workspace's existing `hex` crate),
`os/**`, `mosd/webd/**`.

## Known limitations, stated rather than hidden

- **`holdDownSeconds` and `graceSeconds` are unconsumed.** Automatic
  arbitration is PLAN-008 Part D's later phase; see above. `provisioning`
  currently behaves as `always`.
- **The conflict is reported, not resolved.** An operator who configures both
  roles on one radio gets `accessPoint: "conflict"` and a station. Resolving it
  — deciding which role wins, and when — is the same later phase.
- **5 GHz is not expressible.** `hw_mode=g` is fixed and the channel is
  validated to the 2.4 GHz band, because `wifi.ap.channel` is documented as a
  2.4 GHz channel and the settings model has no band field. A schema change,
  not a renderer change.
- **WPA3-SAE is not expressible**, for the same reason: `wpa_key_mgmt=WPA-PSK`
  is what the model can ask for.
- **No `ieee80211n`/`ac` and no HT capabilities are emitted**, so the AP is
  802.11g rates only. For a setup UI on a handful of clients that is adequate;
  raising it needs per-driver capability knowledge this repo cannot verify.
- **`EmitDNS`/`EmitRouter` are left at networkd's defaults** (both on). A
  provisioning AP with no uplink therefore advertises itself as a router and a
  resolver it cannot be. Whether that helps a captive-portal flow or hurts it
  is a decision for the webd setup-UI task, which is where the captive
  behaviour is being designed; it is a one-line change to the rendered unit
  when that lands.
- **`ConfigureWithoutCarrier` is not set.** If a driver does not report carrier
  in AP mode, networkd will not configure the address and the DHCP server will
  not start. Whether that happens is a per-driver fact that only hardware can
  settle; if it does, the fix is one line in `render_networkd`.
- **A stale `<old-interface>.conf` and its unit are not swept on an interface
  rename.** The networkd side *is* swept. The hostapd side is not, for the same
  reason the station reconciler gives: stopping units for interfaces mosd was
  never told about is a broader claim of ownership than `wifi.ap` grants. Unit
  enablement is runtime-scoped, so a reboot clears it.
- **`write_atomically` is duplicated** from `wifi_client.rs`, which duplicated
  it from `sshd.rs`. Lifting it into a shared helper means editing files this
  task is forbidden to touch; it is now worth doing, and this is the third
  copy.
- **The state directory is derived from `MOSD_SETTINGS_PATH` inside
  `production()`**, duplicating `main.rs`'s `state_dir_for`. `reconciler::all()`
  takes no arguments and `main.rs` is out of scope, so threading the path in
  would have meant editing it. Worth collapsing when the daemon loop lands.
- **On-device behaviour is the user's acceptance and is not claimed here.**
  Every test runs against a mock `UnitControl`, a mock `NetworkReload` and a
  tempdir. Nothing has been near a radio.

## Work checklist

- [x] R1 hostapd config rendered from `wifi.ap`, 0600, atomic, mode before rename
- [x] R1 pure and deterministic; golden-file test
- [x] R1 SSID escaping checked against hostapd's actual rules, hostile case tested
- [x] R1 derived SSID and per-device key; no fleet-wide constant anywhere
- [x] R1 WPA2-PSK, `country_code` emitted and advertised; regulatory caveat recorded
- [x] R2 `mode` drives `hostapd@<interface>.service` in both directions
- [x] R2 networkd unit with address + `DHCPServer=yes`, no dnsmasq
- [x] R2 DHCP pool derived from `wifi.ap.address`, guarded both directions
- [x] R3 prefix outside the swept pattern and sorting late, proved with the real
      `NetworkReconciler`
- [x] R4 SSID derived from `provisioning.deviceId`, stable and distinct, tested
      both directions
- [x] R5 same-interface conflict reports `conflict` and touches nothing; both
      directions and the different-interface case tested
- [x] R5 `holdDownSeconds`/`graceSeconds` left unconsumed and documented
- [x] R6 image requirements recorded above, including the plain `hostapd.service`
      that must be masked; `os/**` untouched
- [x] R7 45 tests, all against mocks and tempdirs; no host hostapd, no host
      `/etc`, no real bus
- [x] `UnitControl` and `NetworkReload` consumed unchanged
- [x] No new third-party crate; `mosd/Cargo.lock` unchanged
- [x] `bash mosd/hack/check.sh` prints `ALL CHECKS PASSED`

## Verification (2026-08-19)

Command:

```
bash mosd/hack/check.sh
```

Result:

```
     Summary [  31.070s] 203 tests run: 203 passed, 0 skipped
ALL CHECKS PASSED
```

203 tests, 203 passed, 0 skipped — `cargo fmt --all --check`, `cargo clippy
--workspace --all-targets --locked -- -D warnings`, `cargo nextest run
--workspace --locked` and `cargo deny check licenses bans advisories` all
clean. This task adds 45 of those tests; the suite was at 158 before it.

The 45:

```
     Starting 45 tests across 9 binaries (158 tests skipped)
        PASS ( 1/45) reconciler::wifi_ap::tests::a_channel_outside_the_two_point_four_gigahertz_band_is_rejected
        PASS ( 2/45) reconciler::wifi_ap::tests::a_device_with_no_identity_and_no_ssid_refuses_to_start_the_radio
        PASS ( 3/45) reconciler::wifi_ap::tests::a_country_code_that_is_not_a_regulatory_domain_is_rejected
        PASS ( 4/45) reconciler::wifi_ap::tests::a_hostile_ssid_cannot_inject_configuration
        PASS ( 5/45) reconciler::wifi_ap::tests::a_key_hostapd_cannot_carry_is_an_error_that_does_not_name_it
        PASS ( 6/45) reconciler::wifi_ap::tests::a_device_with_no_key_anywhere_refuses_rather_than_using_a_constant
        PASS ( 7/45) reconciler::wifi_ap::tests::a_conflict_does_not_stop_the_station_s_unit
        PASS ( 8/45) reconciler::wifi_ap::tests::a_key_that_cannot_be_rendered_leaks_nothing_and_starts_nothing
        PASS ( 9/45) reconciler::wifi_ap::tests::a_sixty_four_character_hex_key_is_emitted_as_a_raw_pmk
        PASS (10/45) reconciler::wifi_ap::tests::a_traversing_interface_name_writes_nothing_anywhere
        PASS (11/45) reconciler::wifi_ap::tests::a_configured_ssid_is_used_verbatim_and_never_derived
        PASS (12/45) reconciler::wifi_ap::tests::an_access_point_on_the_station_s_radio_reports_conflict_and_touches_nothing
        PASS (13/45) reconciler::wifi_ap::tests::a_configured_key_wins_over_the_state_secret
        PASS (14/45) reconciler::wifi_ap::tests::a_disabled_station_on_the_same_radio_is_not_a_conflict
        PASS (15/45) reconciler::wifi_ap::tests::an_address_that_cannot_carry_a_pool_is_rejected
        PASS (16/45) reconciler::wifi_ap::tests::an_ssid_ieee_802_11_cannot_carry_is_rejected
        PASS (17/45) reconciler::wifi_ap::tests::an_access_point_that_is_off_never_conflicts_with_the_station
        PASS (18/45) reconciler::wifi_ap::tests::a_leftover_temporary_file_does_not_widen_the_mode
        PASS (19/45) reconciler::wifi_ap::tests::a_running_access_point_gets_an_address_and_a_dhcp_server
        PASS (20/45) reconciler::wifi_ap::tests::an_already_converged_access_point_needs_no_calls_at_all
        PASS (21/45) reconciler::wifi_ap::tests::a_station_on_a_different_radio_is_not_a_conflict
        PASS (22/45) reconciler::wifi_ap::tests::an_absent_key_comes_from_the_per_device_state_secret
        PASS (23/45) reconciler::wifi_ap::tests::every_unrepresentable_ssid_goes_to_hex_and_plain_ones_stay_readable
        PASS (24/45) reconciler::wifi_ap::tests::interface_names_that_are_not_names_are_rejected
        PASS (25/45) reconciler::wifi_ap::tests::changing_the_address_of_a_running_access_point_reloads_networkd_once
        PASS (26/45) reconciler::wifi_ap::tests::an_absent_ssid_is_derived_from_the_device_identity
        PASS (27/45) reconciler::wifi_ap::tests::apply_leaves_no_temporary_file_behind
        PASS (28/45) reconciler::wifi_ap::tests::an_unusable_address_stops_the_apply_before_the_unit_is_started
        PASS (29/45) reconciler::wifi_ap::tests::the_country_code_is_emitted_and_advertised
        PASS (30/45) reconciler::wifi_ap::tests::apply_writes_the_golden_config_at_0600_creating_its_directory
        PASS (31/45) reconciler::wifi_ap::tests::changing_the_config_of_a_running_access_point_restarts_it
        PASS (32/45) reconciler::wifi_ap::tests::the_derived_ssid_is_stable_and_distinct_per_device
        PASS (33/45) reconciler::wifi_ap::tests::off_to_always_enables_then_starts_and_back_to_off_stops_then_disables
        PASS (34/45) reconciler::wifi_ap::tests::every_path_the_reconciler_writes_stays_inside_the_tempdir
        PASS (35/45) reconciler::wifi_ap::tests::provisioning_mode_starts_the_access_point_exactly_as_always_does
        PASS (36/45) reconciler::wifi_ap::tests::reapplying_identical_settings_is_a_no_op_with_zero_bus_calls
        PASS (37/45) reconciler::wifi_ap::tests::the_dhcp_pool_is_derived_from_the_access_point_address
        PASS (38/45) reconciler::wifi_ap::tests::the_render_is_deterministic
        PASS (39/45) reconciler::wifi_ap::tests::the_render_matches_the_golden_file
        PASS (40/45) reconciler::wifi_ap::tests::the_render_is_wpa2_psk_and_never_open
        PASS (41/45) reconciler::wifi_ap::tests::the_pool_always_lies_inside_the_subnet_and_excludes_the_host
        PASS (42/45) reconciler::wifi_ap::tests::the_rendered_networkd_unit_survives_the_network_reconcilers_sweep
        PASS (43/45) reconciler::wifi_ap::tests::renaming_the_interface_removes_the_previous_networkd_unit
        PASS (44/45) reconciler::wifi_ap::tests::the_key_reaches_the_config_file_and_nothing_else
        PASS (45/45) reconciler::wifi_ap::tests::the_networkd_unit_sorts_after_the_units_it_must_not_override
     Summary [   0.443s] 45 tests run: 45 passed, 158 skipped
```

### The no-logging check, mechanically

```
$ grep -vE "^\s*(//|///|//!)" mosd/mosd/src/reconciler/wifi_ap.rs \
    | grep -nE "tracing|println!|eprintln!|dbg!"
$ echo $?
1
```

No hit on any non-comment line: the module emits nothing to a log, so the AP
key cannot reach one.

### Mutation testing

Twenty-nine guards were removed or inverted one at a time and the wifi_ap suite
re-run with `--no-fail-fast`, to prove each test fails for the reason it claims
rather than passing for an unrelated one. **Every mutation was caught; there
were no survivors.** All were reverted, and the check run above is on the
reverted tree (`diff` against the pre-mutation copy is empty).

| # | Mutation | Tests that FAILED (passed/failed of 45) |
|---|---|---|
| M1 | `is_plain` accepts non-printable bytes | `a_hostile_ssid_cannot_inject_configuration`, `every_unrepresentable_ssid_…`, `a_key_hostapd_cannot_carry_…`, `a_key_that_cannot_be_rendered_…` (41/4) |
| M2 | `is_plain` drops the leading/trailing-space guard | `every_unrepresentable_ssid_…`, `a_key_hostapd_cannot_carry_…` (43/2) |
| M3 | `ssid_directive` always emits the raw form; hex fallback removed | `a_hostile_ssid_cannot_inject_configuration`, `every_unrepresentable_ssid_…` (43/2) |
| M4 | `validate_ssid` drops the 32-byte cap | `an_ssid_ieee_802_11_cannot_carry_is_rejected` (44/1) |
| M5 | `validate_country_code` accepts anything | `a_country_code_that_is_not_a_regulatory_domain_is_rejected` (44/1) |
| M6 | channel range check removed | `a_channel_outside_the_two_point_four_gigahertz_band_is_rejected` (44/1) |
| M7 | raw-PMK branch removed (a 64-hex key becomes a passphrase) | `a_sixty_four_character_hex_key_is_emitted_as_a_raw_pmk` (44/1) |
| M8 | passphrase length check removed | `a_key_hostapd_cannot_carry_…` (44/1) |
| M9 | passphrase representability check removed | `a_key_hostapd_cannot_carry_…`, `a_key_that_cannot_be_rendered_…` (43/2) |
| M10 | `CONFIG_MODE` widened to `0o644` | `apply_writes_the_golden_config_at_0600_…`, `a_leftover_temporary_file_does_not_widen_the_mode` (43/2) |
| M11 | explicit `set_permissions` before the rename removed | `a_leftover_temporary_file_does_not_widen_the_mode` (44/1) |
| M12 | unchanged-bytes skip removed | `an_already_converged_…`, `reapplying_identical_settings_…` (43/2) |
| M13 | restart-on-config-change removed | `changing_the_config_of_a_running_access_point_restarts_it` (44/1) |
| M14 | networkd prefix moved into the swept pattern (`50-mos-wifi-ap-`) | `the_rendered_networkd_unit_survives_the_network_reconcilers_sweep` + 6 others (38/7) |
| M15 | stale-networkd sweep removed | `renaming_the_interface_…`, `off_to_always_…` (43/2) |
| M16 | networkd reloaded unconditionally | `an_already_converged_…`, `reapplying_identical_settings_…`, `off_to_always_…` (42/3) |
| M17 | conflict check removed entirely | `an_access_point_on_the_station_s_radio_…`, `a_conflict_does_not_stop_the_station_s_unit` (43/2) |
| M18 | conflict no longer compares interfaces | `a_station_on_a_different_radio_is_not_a_conflict` (44/1) |
| M19 | conflict ignores `wifi.client.enabled` | `a_disabled_station_on_the_same_radio_is_not_a_conflict` + 21 others (23/22) |
| M20 | conflict stops the station's unit instead of touching nothing | `a_conflict_does_not_stop_the_station_s_unit`, `an_access_point_on_the_station_s_radio_…` (43/2) |
| M21 | DHCP pool starts at the access point's own address | `the_dhcp_pool_is_derived_…`, `the_pool_always_lies_inside_the_subnet_…` + 5 (38/7) |
| M22 | DHCP pool runs past the broadcast address | `the_dhcp_pool_is_derived_…`, `the_pool_always_lies_inside_the_subnet_…` + 4 (39/6) |
| M23 | derived SSID no longer depends on the device identity | `the_derived_ssid_is_stable_and_distinct_per_device`, `an_absent_ssid_is_derived_from_the_device_identity` (43/2) |
| M24 | a fleet-wide constant key is used when STATE has none | `a_device_with_no_key_anywhere_refuses_rather_than_using_a_constant` (44/1) |
| M25 | the key is published in the live-state tree | `the_key_reaches_the_config_file_and_nothing_else` (44/1) |
| M26 | interface validation removed | `a_traversing_interface_name_writes_nothing_anywhere` (44/1) |
| M27 | the configuration is rendered even while the AP is off | `off_to_always_enables_then_starts_and_back_to_off_stops_then_disables` (44/1) |
| M28 | `ieee80211d=1` dropped (country code carried, not advertised) | `the_country_code_is_emitted_and_advertised` + 6 (38/7) |
| M29 | the access point is rendered open (`wpa=0`) | `the_render_is_wpa2_psk_and_never_open` + 6 (38/7) |

Four rows deserve comment.

**M2 is why there are two SSID-escaping tests.** The hostile-SSID test drives an
SSID containing a newline, so removing only the edge-whitespace rule still
sends it to hex and the test still passes. Only the per-character test, which
drives `" leading"` and `"trailing "` on their own, detects it. A single
"hostile input" test would have left that hole invisible.

**M10 is the tautology check.** Both mode assertions compare against the literal
`0o600` rather than against `CONFIG_MODE`, so widening the constant fails them.
Had they compared against the constant, M10 would have passed silently — the
exact hole a previous L3 in this campaign found in its own mode assertions.

**M14 is the M4-lesson check.** It models the real integration failure: an AP
networkd unit named so that the *other* reconciler deletes it. Seven tests
fail, led by the one that runs the real `NetworkReconciler` over the same
directory. Asserting the file merely *exists* after this reconciler's own
`apply` would have caught none of it.

**M17/M18/M19/M20 are the four ways the conflict guard can be wrong**, and each
is caught by a different test: not firing at all, firing on a healthy two-radio
system, firing on a switched-off station, and firing correctly but then
stopping a unit it does not own. A guard tested in one direction only would
have survived three of them.

## ActiveForm

Implementing the WiFi access-point reconciler so `wifi.ap` becomes hostapd
configuration, an addressed AP link with a DHCP server, and a safe answer to
the single-radio conflict.

## Dependencies

- **blocked by**: RFCT-021 (settings schema v3, `wifi.ap`), RFCT-023
  (`UnitControl`), RFCT-024 (`identity::read_ap_psk`, the per-device AP key),
  RFCT-025 (the station sibling this one is modelled on)
- **blocks**: the image task that must ship `hostapd`, provide
  `hostapd@.service`, mask the plain `hostapd.service` and make `/etc/hostapd`
  writable and STATE-backed (see the table above); the webd setup-UI task that
  serves the provisioning portal on the AP address
- **follow-on**: automatic STA/AP arbitration (`holdDownSeconds`,
  `graceSeconds`, carrier watching) — PLAN-008 Part D's later phase
