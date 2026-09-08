# RFCT-359 cx3576's stable MAC came from the interface name, and never reached the port that probes late

- **status**: in-progress
- **priority**: P1
- **owner**: bkd/dx1t7076
- **createdAt**: 2026-09-08 15:00
- **relatedPlans**: (none)

> The index line in `docs/task/index.md` is written by L1, not by this task.

## Description

`boards/cx3576/hwinit/hwinit-mac` derived each Ethernet port's address from
`md5(seed + ifname)`. The seed is right — `/etc/mos/mac.conf` names the eMMC
CID, a read-only chip register — but this board boots `net.ifnames=0`, so
`eth0`/`eth1` carry no hardware identity at all. They are the order the two NICs
registered in, and on the first hardware boot that order was decided by 4.5 ms.

Two defects, in one file:

1. **The discriminator is not hardware.** A reboot that reorders the probes
   exchanges the two addresses.
2. **A one-shot pass cannot reach a port that appears later.** `mos-mac.service`
   is a `Type=oneshot` with a single sweep of `/sys/class/net/eth*`; the bench
   saw `eth1` carrying `be:26:d1:8c:b0:2a`, with no `02:` prefix, so nothing in
   mos had written it.

Nothing tested any of it: `grep -rn 'hwinit-mac\|addr_assign_type' tests/
verify/src/` returned nothing.

## ActiveForm

Deriving the address from the port's place in the bus topology, covering the
ports that appear after boot is under way, and taking the assignment back from
systemd

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Acceptance

- The derivation keyed on hardware topology, with the no-`device`-link case
  decided in writing.
- Late-appearing interfaces covered, with the proof stated for a task that has
  no board.
- A test that fails under the old derivation, and the suite count it moved to.
- The fleet-visible MAC change stated here and wherever a user would look.
- `verify/run.sh --verify --board cx3576` at 449 or the move explained;
  `make docs-verify` green from a `git archive` into an empty directory.
- `docs/plan/index.md`, `docs/task/index.md` and `docs/CHANGELOG.md` untouched;
  `rootfs/overlay/usr/lib/mos/mos-health` and `health.conf` untouched.

## Notes

### 1. The derivation: the port's own path under `/sys/devices`

`/sys/class/net/<iface>/device` resolves to the device the port belongs to, and
the path it lands on is where the silicon is attached rather than when it was
found:

| port | topology |
| --- | --- |
| on-board GMAC | `platform/2a220000.ethernet` |
| RTL8168 behind PCIe | `platform/22000000.pcie/pci0000:00/0000:00:00.0/0000:01:00.0` |

The address is `02:` + the first five bytes of `md5(seed + '-' + topology)` —
the same shape as before, with the one substitution. The seed is untouched.

**Read out of sysfs rather than out of udev's `ID_PATH`, which is the same
idea.** Two reasons, and both are structural. `ID_PATH` is set by the `path_id`
builtin in `80-net-setup-link.rules`, which is *after* the point this program
runs on the udev path; and the two entry points below have to compute one
answer, so neither may depend on a database only one of them can see.

**The `/sys/devices/` prefix is stripped**, so the discriminator is the topology
and not also the mount point of sysfs. It is what lets the test pin the exact
address a given (seed, topology) pair produces instead of only asserting that
two runs agree.

**No `device` link: skipped, and it says so on stderr.** A virtual interface — a
bridge, a veth, a tunnel — has no place in the bus topology. The two
alternatives are both worse than leaving the kernel's address alone: falling
back to the interface name is the defect being removed, and falling back to a
constant gives every such interface on the board one address. It is a
diagnostic rather than a silent `continue` because a silent skip is how the
original defect stayed invisible.

### 2. `net.ifnames=0` is not the whole reason the names are unusable

The names would be a bad discriminator anyway, but the boot log says how bad.
`_out/cx3576/a.txt`, the first hardware boot:

```
[   11.665665] 8021q: adding VLAN 0 to HW filter on device eth0
[   11.671074] eth1: 0xffffffc00b453000, 06:c9:38:02:af:9c, IRQ 82
```

**4.5 ms apart.** Not "the PCIe part probes seconds later, so the order is
stable in practice" — the order is a scheduling outcome. The same log also shows
where `eth1`'s address comes from, and it is not the part:

```
[    7.396875] r8168 0000:01:00.0 (unnamed net_device) (uninitialized): Invalid ether addr 00:00:00:00:00:00
[    7.396896] r8168 0000:01:00.0 (unnamed net_device) (uninitialized): Random ether addr 66:d7:a5:07:0d:73
```

`eth_hw_addr_random()`, which sets `addr_assign_type = NET_ADDR_RANDOM`. That
matters for section 4.

### 3. Coverage of a late port: a udev rule, and how it was proved without a board

`60-mos-mac-stable.rules`:

```
ACTION=="add", SUBSYSTEM=="net", KERNEL=="eth*", RUN+="/usr/lib/mos/hwinit-mac %k"
```

`hwinit-mac` now takes optional interface names; with none it does the sweep it
always did. The scope (`eth*`) lives in the program so the two callers cannot
disagree about what it is for; the rule's `KERNEL=="eth*"` is a pre-filter that
keeps udev from spawning a process for `lo`, `can0`, `wlan0` and the gadget
port.

**`mos-mac.service` stays**, as the cold-plug backstop, with its ordering
unchanged. It is also what the board package requires: the producer refuses an
hwinit fact whose program has no unit.

**The ordering claim, and it is the one that needed proving.** "It must still
run before the interface is configured, which is what `network-pre.target` was
for." For a per-device rule that guarantee is systemd 257.13's own, in
`src/udev/udev-worker.c`:

```c
/* apply rules, create node, symlinks */
r = udev_event_execute_rules(udev_event, worker->rules);
/* Process RUN=. */
udev_event_execute_run(udev_event);
...
r = device_update_db(dev);
...
r = device_monitor_send(monitor, NULL, dev);   /* udev_broadcast_result() */
```

The device database — which is where `sd_device`'s "is initialised" lives — is
written **after** `RUN`, and the event is broadcast to libudev listeners after
that. `systemd-networkd` will not configure a link it has not seen initialised,
so it cannot reach the port before `hwinit-mac` has returned. That is a source
fact about the shipped version, not an inference from timing, and it is why no
`After=`/`Before=` is needed on the udev path.

The same two lines are what makes section 4 unavoidable.

### 4. systemd was already assigning these addresses, and it would have won

**This is the finding that decided the shape of the fix, and without it the
change in section 1 would have been a no-op on the device.**

The image ships `/usr/lib/systemd/network/99-default.link` — systemd's own,
unmodified — and it ends:

```
MACAddressPolicy=persistent
```

That is not inert on a board whose NICs have no address in hardware.
`src/udev/net/link-config.c`, `link_generate_new_hw_addr()`:

```c
switch (link->addr_assign_type) {
case NET_ADDR_SET:    log_link_debug(link, "MAC address on the device already set by userspace."); goto finalize;
case NET_ADDR_STOLEN: ... goto finalize;
case NET_ADDR_RANDOM:
case NET_ADDR_PERM:   break;
}
if ((link->config->mac_address_policy == MAC_ADDRESS_POLICY_RANDOM) == (link->addr_assign_type == NET_ADDR_RANDOM)) {
        log_link_debug(link, "MAC address on the device already matches policy \"%s\".", ...);
        goto finalize;
}
```

- `PERSISTENT` + `NET_ADDR_PERM` → `false == false` → left alone. That is the
  protection the policy is usually understood by.
- `PERSISTENT` + `NET_ADDR_RANDOM` → `false == true` is false → **it generates
  one**, from `net_get_unique_predictable_data(device, /* use_sysname = */
  naming_scheme_has(NAMING_STABLE_VIRTUAL_MACS), &result)`, which is
  `siphash24(machine-id ++ name)` where `name` is the first of
  `ID_NET_NAME_ONBOARD`, `ID_NET_NAME_SLOT`, `ID_NET_NAME_PATH`,
  `ID_NET_NAME_MAC` — **and, when there is none, the interface's own sysname.**
  `NAMING_STABLE_VIRTUAL_MACS` is in the scheme from `NAMING_V241`, so the
  sysname fallback is on.

Both cx3576 ports are `NET_ADDR_RANDOM` (section 2 for the RTL8168; the GMAC's
dts node carries neither `mac-address` nor `nvmem-cells`). So systemd assigns
both, from the machine ID rather than from the eMMC CID and — for any port with
no `ID_NET_NAME_*` — keyed on `eth0`/`eth1`, which is the same defect this task
exists to remove, with a different hash.

And then it is locked in. The pinned vendor kernel
(`armbian/linux-rockchip@c6157104`, 6.1.115), `net/core/dev.c`:

```c
	err = ops->ndo_set_mac_address(dev, sa);
	if (err)
		return err;
	dev->addr_assign_type = NET_ADDR_SET;
```

`hwinit-mac`'s `addr_assign_type == 1` filter — which the task says to keep, and
which is right — then reads `3` and stands down. **The write mos intends never
happens, on either port, and nothing logs an error.** That is consistent with
what the bench saw: `be:26:d1:8c:b0:2a` on `eth1` is neither the driver's
`06:c9:38:02:af:9c` nor a `02:` address of ours.

**No rule number fixes this.** `net_setup_link` is a builtin, evaluated inline
while the rules are matched at 80; `RUN+=` is deferred until every rule of the
event has been processed (section 3). A rule at 85 loses, and so does one at 60.

So `60-mos-mac-stable.link` ships beside the rule:

```
[Match]
OriginalName=eth*

[Link]
NamePolicy=keep kernel database onboard slot path
AlternativeNamesPolicy=database onboard slot path mac
MACAddressPolicy=none
```

`none` with no `MACAddress=` is a true no-op, checked rather than assumed:
`link_generate_new_hw_addr()` takes the static branch with a zero-length
address, `net_verify_hardware_address()` returns 0 on `length == 0`, and
`rtnl_set_link_properties()` sends no message when every property is unset.

**The two naming policies are a verbatim copy of `99-default.link`'s, and that
is deliberate.** A matched `.link` file replaces the default wholesale rather
than layering over it, so omitting them would have dropped this board's
alternative interface names as a side effect of a change about MAC addresses. A
copy is only correct while it matches, so `mac-link-keeps-default-name-policies`
asserts it does — a systemd upgrade that moves those lines is a red check.

**60, and what it sorts before.** Ahead of `99-default.link`, which is the
point, and ahead of `73-usb-net-by-mac.link`, which is not: that file's only
setting is `NamePolicy=mac`, which `net.ifnames=0` disables on this board, and
its subject is a USB NIC with a permanent address, which nothing here writes to.

**The other two boards are not exposed.** x64 and virt-arm64 declare
`BOARD_HWINIT_CONFS=""`, their NICs (virtio, e1000) carry permanent addresses,
and `PERSISTENT` + `NET_ADDR_PERM` is the branch that leaves them alone. The
file is board payload for that reason, not `mos-system` payload.

### 5. What this costs, in the words a release note would use

**Changing the derivation changes the MAC addresses of every already-deployed
unit.** DHCP reservations, switch port allowlists, firewall rules and anything
else keyed on the old addresses stop matching the moment a device takes an image
built after this change; the new addresses have to be read off the device and
re-keyed. This tree makes no compatibility promise before 1.0 and the change
stands — a discriminator that is decided by a 4.5 ms race is not something to
preserve — but it is visible across a whole fleet at once and is stated as such
in `docs/user/first-run.md` §2 (and its Chinese translation) and in
`rootfs/README.md`, not only here.

Section 4 makes the size of the change larger than "the second half of a hash
moved": the addresses that are actually on deployed units today are systemd's,
not this program's, so what a fleet sees is a move from a machine-id-derived
address to an eMMC-CID-derived one.

### 6. The test, and which case is the acceptance case

`tests/mac-stable-test.sh`, `make os-mac-test`. A fake sysfs — the
`/sys/class/net/<iface>` symlink and the `device` symlink inside it, both real
links, because the derivation is exactly what that pair resolves to — a seed
file, and a stub `ip` on `PATH`, so the real script's real command line is what
is read back. Nine cases:

| # | case |
| --- | --- |
| 1 | the same port gets the same address under either name — **the acceptance case** |
| 2 | the by-name derivation fails case 1, and the mutant is made from the shipped file |
| 3 | two ports never collide |
| 4 | the derivation itself, pinned to two recorded addresses |
| 5 | `NET_ADDR_PERM` and `NET_ADDR_SET` are both left alone |
| 6 | no `device` link: skipped, with the reason on stderr |
| 7 | the udev path assigns the named port and only it, at the sweep's address |
| 8 | the rule really invokes `hwinit-mac %k`, and the `eth*` scope holds |
| 9 | a refused `ip link set` is reported rather than swallowed |

**Driven from the failing side, and the failing side is the real file.** Case 2
produces the old derivation by `sed`-ing the one expression that changed —
`"$seed" "$topology"` back to `"$seed" "$iface"` — out of the shipped script,
and refuses to run if that edit changed nothing. A hand-written copy of the old
one-liner would only have tested the copy.

**And the mutation reddens the right test.** Restoring the by-name derivation in
`boards/cx3576/hwinit/hwinit-mac` itself fails case 1 first, by name:

```
FAIL the GMAC at platform/2a220000.ethernet got 02:6f:84:7d:f2:0d when it was
called eth0 and 02:06:05:e4:15:24 when it was called eth1; the address follows
the name, not the hardware
```

### 7. The image contract, and the four checks it gained

Four, all scoped to a board that declares `mac` in `BOARD_HWINIT_CONFS`, plus
one skip owner for the boards that do not:

| id | asserts |
| --- | --- |
| `mac-udev-rule` | `/usr/lib/udev/rules.d/60-mos-mac-stable.rules` is a regular file |
| `mac-udev-rule-runs-hwinit` | it carries `RUN+="/usr/lib/mos/hwinit-mac %k"` |
| `mac-link-precedes-default-policy` | ours sets `MACAddressPolicy=none` and sorts before every `.link` that assigns one |
| `mac-link-keeps-default-name-policies` | the two copied policy lines still equal `99-default.link`'s |
| `mac-stable-assignment-skipped` | the skip on x64 and virt-arm64, with its own sentence |

`mac-link-precedes-default-policy` is the one worth arguing for. The failure it
catches is a rename — the same bytes in a file that sorts one place later — and
its consequence is silent on the device: systemd paints its address first, the
kernel records `NET_ADDR_SET`, `hwinit-mac` correctly stands down, and the board
runs with an identity mos did not choose while every other check stays green.
Its test plants a `50-vendor.link` with `MACAddressPolicy=persistent`, requires
red, then rewrites the same file to `none` and requires green — so what the
check keys on is *assignment*, not the mere presence of an earlier file.

`mac-link-keeps-default-name-policies` **throws** rather than failing when
`99-default.link` is absent, following `hwinit-reconciler-owned-skipped`:
systemd not shipping its own default is a change in the package, and answering
it as a verdict would put a statement about systemd into a report about the
board.

### 8. Evidence

(pending)
