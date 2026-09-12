# Research: the root filesystem closure — what can go, what Rust could take over, and what the floor is

> **Status and intent.** This is a measurement report, not a design record and
> not an approved plan. Nothing here is implemented and no branch exists. The
> plan record that takes an authorized subset of section 8, with corrections
> to this document, is
> [20260912-1347-root-closure-reduction](../plan/20260912-1347-root-closure-reduction.md).
> It exists to put numbers under three questions: which packages can be deleted outright, which are held in the
> image only by code that Rust could own instead, and what is left when both
> are done.
>
> **Measurement basis.** Every figure below was read off the tree at
> `677d326f` from the built `_out/cx3576` outputs — the composed factory root
> exported by the pack stage, the `arm64` archives under `_out/debian-base`,
> and the packed `rootfs.img`. The profile measured is **cx3576, dev, with
> containers, Wi-Fi, AP and Bluetooth all present**, which is the largest
> shipped configuration and therefore the one that argues against this
> document rather than for it. Following this repository's documentation
> discipline, files are named and lines are not cited.
>
> **Read section 1 first.** It is the one that decides how every other number
> should be ranked, and ranking by the obvious quantity gives the wrong answer.

---

## 1. The unit of account is the compressed byte

The SYSTEM slot holds a squashfs, not an unpacked tree. The pack stage builds
it with `mksquashfs -comp zstd -Xcompression-level 19`, and the measured
result for this profile is:

| | |
|---|---|
| Composed root, unpacked | **242.7 MB** over 207 packages |
| `rootfs.img` as shipped | **74 MB** |

Flash occupancy, update download size and the bytes hashed at boot are all the
second number. Unpacked size matters for page cache under load and for the
factory-root export, not for the slot.

The two orderings disagree sharply. `iptables` and its four libraries are
8.35 MB unpacked and **0.53 MB** compressed, because the 150 `xtables` plugin
objects are near-identical and zstd eats them. Conversely `podman` is dense Go
and gives up little. Any reduction programme ranked on unpacked size would
start in the wrong place.

Compressed figures in this document are `gzip -6` over a tar of the named
files. That is a deliberately **conservative proxy**: zstd-19 does better, so
each compressed number here is an upper bound on what the file actually costs
in `rootfs.img`.

### 1.1 Where the 74 MB goes

| Group | Unpacked | Compressed | Share of image |
|---|---:|---:|---:|
| podman family (`podman`, `netavark`, `aardvark-dns`, `quadlet`, `conmon`, `crun`, `catatonit`) | 55.6 MB | **21.1 MB** | 28% |
| mos's own five Rust binaries (`apid`, `mosd`, `mos-mqttd`, `mos-mqtt-broker`, `mos-deploy`) | 27.6 MB | **11.5 MB** | 16% |
| `libc6` — of which `gconv` alone is 19.0 MB / 3.35 MB | 22.8 MB | 4.76 MB | |
| `bluez` + `wpasupplicant` + `hostapd` | 8.6 MB | 3.5 MB | |
| `libssl3t64` | 7.3 MB | 3.00 MB | |
| `coreutils` | 9.1 MB | 2.84 MB | |
| openssh (client + server) | 6.4 MB | 2.58 MB | |
| `libsystemd-shared` | 6.7 MB | 2.46 MB | |
| `systemd` | 10.4 MB | 2.17 MB | |
| `util-linux` | 6.7 MB | 1.87 MB | |
| `libglib2.0-0t64` (reached only through `bluez`) | 4.4 MB | 1.48 MB | |
| `iproute2` | 3.7 MB | 1.30 MB | |
| `libgnutls30t64` | 2.3 MB | 0.98 MB | |
| `libdb5.3t64` (reached only through `iproute2` and `libsasl2-modules-db`) | 1.7 MB | 0.79 MB | |
| `passwd` | 2.4 MB | 0.69 MB | |
| iptables family (5 packages) | 8.35 MB | 0.53 MB | |
| `e2fsprogs` | 1.8 MB | 0.50 MB | |
| `quota` | 1.6 MB | 0.44 MB | |
| `libcurl4t64` + `curl` | 1.4 MB | 0.62 MB | |

### 1.2 What is already done, and is not restated below

The tree already performs most of the obvious slimming, and none of it is a
finding. `dpkg` and `apt` are purged at pack time together with the units they
enabled; `perl-base` goes with them; `/usr/share/{locale,man,info,lintian}` is
excluded by a `dpkg.cfg.d` fragment and then deleted from what debootstrap's
first stage had already unpacked; `/usr/share/doc` is reduced to copyright
files, which are kept deliberately to satisfy redistribution terms and are
asserted to number at least 100; udev's compiled hardware database and its
34 sources are removed with an assertion for each path; sshd host keys and
`policy-rc.d` are stripped. `podman` is built with a trimmed `BUILDTAGS` set
and every large binary in the root is stripped.

---

## 2. Deletable outright

### 2.1 `gconv` — 19.0 MB unpacked, 3.35 MB compressed

`libc6` ships 250-odd charset conversion modules under
`/usr/lib/<triplet>/gconv`. The image's locale is C.UTF-8, and the UTF-8 and
ASCII converters are compiled into glibc rather than loaded from that
directory.

Measured against the composed root, exactly fourteen objects in the whole tree
reference `iconv_open`: `printf`, `diff`, `diff3`, `sdiff`, `cmp`, `tar`,
`bash`, `iconv` itself, and the libraries `libc`, `libglib-2.0`, `libgio-2.0`,
`libunistring`, `libpsl` and `libidn2`. Every one of them converts to or from
the locale charset; none names a legacy code page.

The removal mechanism already exists in this tree — `hwdb-remove.sh` is the
pattern: delete at the pack stage, assert each path is gone, and print what
was removed. The assertion that matters here is not "the directory is gone"
but "the converters the image actually opens still resolve", because the first
form passes over a root where `iconv_open` was never going to be called at
all.

This is the largest single deletion available and the one with the clearest
evidence behind it.

### 2.2 The iptables family — 8.35 MB unpacked, 0.53 MB compressed

`iptables`, `libip4tc2`, `libip6tc2`, `libnetfilter-conntrack3` and
`libnfnetlink0` form a closure nothing else in the image reaches.
`mos-system`'s own control file already states why they are there: operator
habit and third-party tooling that cannot speak nft. The real front-end is
`nft` — netavark execs it off PATH, and `nft list ruleset` is the only
complete view of the subsystem, since `iptables -S` shows only what came
through the iptables front-end.

Half a megabyte of the slot is a weak argument on its own. The stronger one is
that the image currently ships two front-ends onto one backend, one of which
is documented as being for habits rather than for any code in the tree.

### 2.3 Package-manager residue the purge did not catch

`package-manager-purge.sh` removes apt and dpkg, then asserts the outcome by
checking five binary names: `dpkg`, `dpkg-query`, `apt`, `apt-get`, `perl`.
Files that belong to those packages under other names survive both the removal
and the assertion. Measured in the composed root:

- `/usr/bin/dpkg-realpath`
- `/usr/libexec/dpkg/dpkg-db-backup` and `/usr/libexec/dpkg/dpkg-db-keeper`
- `/etc/cron.daily/dpkg` and `/etc/logrotate.d/dpkg`
- `/usr/share/dpkg`
- `/usr/share/lintian/profiles/dpkg`, on a root whose `configure.sh` deletes
  `/usr/share/lintian`
- `/var/lib/systemd/deb-systemd-helper-enabled/timers.target.wants/dpkg-db-backup.timer`

The bytes are negligible. The finding is not about bytes: this is precisely
the class of object that purge claims to have removed, and the by-name
assertion reports green over all of it. The last entry is only
`deb-systemd-helper` bookkeeping and not a path systemd reads, so nothing
starts — but the purge's own comment explains at length that it removes
enablement *by package ownership rather than by name*, and this residue is
what a name-shaped check leaves behind.

### 2.4 `e2scrub`

`e2scrub_all.timer`, `e2scrub_all.service`, `e2scrub_reap.service`,
`e2scrub@.service` and `e2scrub_fail@.service` are present in the composed
root, together with the helper scripts under `/usr/libexec/e2fsprogs`. They
are ext4 online-fsck machinery, aimed at LVM snapshots, on a system whose root
is a verity-sealed squashfs. Whether they are wanted on DATA is a decision;
today the image carries them without one having been recorded.

### 2.5 What is *not* a finding

Feature and radio packages — `bluez`, `wpasupplicant`, `hostapd`,
`alsa-utils`, `mos-podman` — are already declinable, per board or per build.
A board without a radio does not install them. There is nothing to delete;
there is only the question of whether a given board should be declining more,
and that is board policy rather than closure policy.

---

## 3. Held in the image by a shell script

Sixteen shell scripts under `/usr/lib/mos` carry the seed, reconcile, health,
data-layout and hwinit paths. They are the reason a large part of the Debian
userland is in the image at all: matched against the file lists of the
installed packages, they reach `coreutils` (about 25 applets), `findutils`,
`grep`, `sed`, `curl`, `setquota`, `chattr`, `blkid`, `findmnt`, `ip`,
`bridge`, `mount`, `umount`, `modprobe`, `busctl`, `systemctl` and
`systemd-repart`.

Three of those are worth naming individually, because in each case a single
call site is holding a whole closure.

### 3.1 `curl` — one call site, fifteen packages

`mos-health` probes apid exactly once, with
`curl -sS -k -o /dev/null -f https://127.0.0.1/healthz`. That is the only use
of curl anywhere in the image.

Behind it sit `curl`, `libcurl4t64`, `libgnutls30t64`, `libp11-kit0`,
`libunistring5`, `libidn2-0`, `libtasn1-6`, `libnettle8t64`,
`libhogweed6t64`, `libpsl5t64`, `librtmp1`, `libssh2-1t64`, `libnghttp2-14`,
`libnghttp3-9` and `libbrotli1` — 10.4 MB unpacked, and a second TLS
implementation in an image that already carries OpenSSL for systemd. A
loopback GET with the certificate check disabled needs none of it, and the
workspace already has an HTTP client.

The health gate's own design makes this awkward rather than trivial: it
degrades to SKIP when curl is absent, so an image that simply dropped curl
would report green over two of three components. Removing the package and
removing the probe's escape hatch have to be the same change.

### 3.2 `setquota` — the `quota` package for one syscall

`mos-data-layout` applies project quotas by execing `setquota`. The `quota`
package plus `libext2fs2t64` is 2.09 MB unpacked; the operation is
`quotactl(2)`.

### 3.3 `ssh-keygen` — `openssh-client` for host-key generation

`mos-seed-state` generates the sshd host keys on first boot with `ssh-keygen`.
That is the only use of the ssh *client* package; nothing in the image
originates an SSH connection. `openssh-client` is 4.93 MB unpacked, and it
also drags `passwd` and `adduser` into the closure as its own dependencies.

Generating OpenSSH-format ed25519 and RSA host keys is a bounded, testable
piece of Rust with an established crate. This is not the same proposition as
reimplementing SSH, and section 5 says so explicitly.

---

## 4. The cheapest reduction is in mos's own binaries

The five Rust binaries are 27.6 MB unpacked and **11.5 MB compressed** — the
second-largest group in the image after podman, and the only one this
repository fully controls. Two levers apply and neither touches a Debian
package.

**The release profile is not set.** `pkgs/mosd/Cargo.toml` declares no
`[profile.release]` section at all, so the shipped binaries are built with
cargo's defaults: `lto = false`, `codegen-units = 16`, `panic = "unwind"`.
Setting `lto = "fat"`, `codegen-units = 1` and `panic = "abort"` is a
four-line change. (`strip` is already effective — every binary in the composed
root measures as stripped.)

**Five binaries are five copies of one dependency graph.** `mosd`, `apid`,
`mos-mqttd`, `mos-mqtt-broker` and `mos-deploy` are members of one cargo
workspace and share tokio, serde, zbus and the settings crate. A multicall
binary dispatching on `argv[0]`, with symlinks or `Exec=` lines naming the
subcommands, collapses that to one copy.

For scale: `apid` is 11 MB, and the UI it embeds is 1.3 MB of that — the rest
is Rust, chiefly the axum and utoipa surfaces. `mos-mqttd` and
`mos-mqtt-broker` are 4.6 and 4.3 MB and both exist only because mosd exists.

The expected saving is 30–50% of the group. **That figure is an expectation
from the shape of the change, not a measurement**; it is the first thing any
plan built on this section should measure rather than assume, and it is cheap
to measure — build once with the profile set and compare.

---

## 5. What should not be rewritten

- **`bluez`, `wpa_supplicant`, `hostapd`.** Protocol and certification
  surface. `connd.md` already places them correctly: mosd drives their unit
  lifecycles and owns the settings, and the daemons stay upstream.
- **openssh-server.** Keep. Only the client and the sftp server are in
  question, and only because of one keygen call.
- **systemd, udev, `libsystemd-shared`.** The boot order, the mount topology,
  verity activation, `systemd-repart` growth and the unit lifecycles mosd
  drives are all systemd's. This is the floor, not a candidate.
- **podman.** 21.1 MB compressed is 28% of the image and by far the largest
  single item — but it is the price of a capability that `containers.md`
  documents as a product feature, the build is already trimmed by
  `BUILDTAGS`, and the lever that exists is the `WITH_CONTAINERS=0` switch a
  board or a build can already throw. A board that does not run containers
  should decline them; a board that does runs an engine.

---

## 6. The floor

Computed as a dependency closure over the installed set, Debian side only
(mos's own packages excluded):

| Configuration | Packages | Unpacked |
|---|---:|---:|
| Floor: systemd + udev + dbus + networking + filesystems; no ssh, curl, quota, iptables, radios or containers | 84 | 87.6 MB |
| …after the `gconv` trim | 84 | ~69 MB |
| + GNU userland (`bash`, `coreutils`, `findutils`, `grep`, `sed`, `tar`, `gzip`, `diffutils`, `dash`, `login`) | 100 | 102.0 MB |
| + `openssh-server`, `curl`, `quota`, `passwd` | 142 | 128.1 MB |
| + iptables and the radios — the configuration measured in section 1 | 164 | 156.0 MB |

The floor's contents: glibc; systemd with `systemd-sysv`, `systemd-resolved`,
`systemd-repart`, `systemd-timesyncd`, `udev`, `libsystemd-shared` and
`libsystemd0`; dbus; `libssl3t64`; `util-linux` with `mount`, `libblkid1`,
`libmount1` and `libfdisk1`; `e2fsprogs`; `kmod`; the nftables family;
`libpam-*` with `passwd` and `login`; ncurses and `libtinfo6`; `tzdata`;
`libselinux1`, `libsepol2` and `libsemanage2`; `libcap2`; `libzstd1`,
`liblzma5` and `zlib1g`; `libpcre2-8-0`; `libgcc-s1` and `gcc-14-base`;
`base-files` and `base-passwd`. On top of that sit mos's own packages, of
which `mos-ca-trust` and `mos-busybox` are unconditional.

Two entries in the floor are there for reasons worth knowing. `libdb5.3t64`
(1.72 MB) and the `libtirpc3t64` → `libgssapi-krb5-2` → `libkrb5-3` chain
(about 1.6 MB) are reached **only through `iproute2`** — Kerberos in the image
because `ip` links libtirpc. And `passwd` is reached through PAM and through
`openssh-client`. Neither is an independent cost; both move if their puller
moves.

---

## 7. Network configuration: could mosd own it directly?

### 7.1 What the coupling is today

mosd does not configure the network; it renders files that something else
reads. The network reconciler writes `.network` and `.netdev` units into
`/run/systemd/network`, calls `org.freedesktop.network1.Manager.Reload` over
the system bus, and reads state back through the same manager's `Describe`
method. Where reload is not enough — deleting a virtual device, because
networkd creates them and does not reap them — it execs `ip link del`.

The generated surface is small and fully enumerable. Across the network and
AP reconcilers the rendered directives are:

| Section | Directives emitted |
|---|---|
| `[Match]` | `Name=` |
| `[Network]` | `DHCP=yes`, `Address=`, `Gateway=`, `DNS=`, `VLAN=`, `Bridge=`, `DHCPServer=yes` |
| `[NetDev]` | `Name=`, `Kind=vlan\|bridge\|wireguard` |
| `[VLAN]` | `Id=` |
| `[WireGuard]` / `[WireGuardPeer]` | `ListenPort=`, `PrivateKeyFile=`, `PublicKey=`, `AllowedIPs=`, `Endpoint=`, `PersistentKeepalive=` |
| `[DHCPServer]` | `PoolOffset=`, `PoolSize=` |

Everything else that touches the network is already elsewhere: the interface
naming `.link` file is udev's, `wpa_supplicant` and `hostapd` are driven as
units, DNS resolution is `systemd-resolved`, and the observed-state surface
mosd serves to apid is assembled from networkd's `Describe`, sysfs, the
wpa_supplicant control socket and one bounded DNS lookup.

### 7.2 The size argument does not exist

`systemd-networkd`, `systemd-networkd-wait-online` and `networkctl` ship
**inside the `systemd` package**, which section 6 puts in the floor. Measured:

| | Unpacked | Compressed |
|---|---:|---:|
| The three networkd binaries | 2.01 MB | **0.61 MB** |

Removing networkd removes **zero packages** and about 0.6 MB of a 74 MB
image. Anyone proposing this change on footprint grounds is proposing it on
the wrong grounds.

### 7.3 The arguments that do exist

- **One owner instead of three hops.** Today a settings change becomes text
  in `/run`, then a D-Bus reload, then — maybe — a kernel change, and the only
  way to learn what happened is to ask `Describe` afterwards. A netlink write
  returns an error for the operation that failed. Desired-versus-applied stops
  being an inference.
- **A class of defect disappears rather than an instance of one.** The
  reconciler already carries an explicit workaround for networkd creating
  virtual devices but never reaping them, which is why `ip link del` is
  shelled out at all. That workaround exists because the interface is a
  directory of files rather than a set of operations; it is not the last one
  of its kind that interface can produce.
- **A group-readable secret leaves the image.** The WireGuard private key is
  written group-readable specifically so networkd's unprivileged user can open
  it via `PrivateKeyFile=`, and that mode is asserted by a guest test. If
  mosd programs WireGuard through the kernel's generic-netlink family, the key
  never leaves mosd's address space and the file, the group and the assertion
  all go.
- **It removes part of section 3's case for `iproute2`.** `ip link del` is
  one of the calls holding `iproute2` — and therefore `libdb5.3t64` and the
  Kerberos chain — in the closure.

### 7.4 What would have to be reimplemented

The directive table in 7.1 is not the work. The work is what networkd does
underneath it:

| Function | What it takes | Risk |
|---|---|---|
| Links, addresses, routes, bridge enslavement, VLAN create/delete | `rtnetlink`, an established pure-Rust crate | Low — this is the part the crate ecosystem covers well |
| WireGuard device and peer programming | the kernel's generic-netlink `wireguard` family | Low–medium; removes the key-file exposure as a side effect |
| **DHCPv4 client** | DISCOVER/OFFER/REQUEST/ACK, T1/T2 renew and rebind, lease persistence across reboot, decline and ARP probe, and option handling — classless static routes, MTU, DNS, NTP, hostname | **High. This is the whole proposal's risk.** Wire-format crates exist; a field-proven client state machine is a different thing from a codec |
| **DHCPv4 server** for AP mode | pool allocation, lease table, ACK/NAK, persistence | Medium — bounded: one interface, one /24, no relay, no failover |
| IPv6 | `DHCP=yes` in networkd means v4 **and** v6, and `IPv6AcceptRA` defaults on, so today's images do RA/SLAAC and DHCPv6 whether or not anything asked for them | Medium–high, and it is a **decision before it is work**: reimplement, or drop IPv6 autoconfiguration deliberately and write that down |
| Handing DNS servers to `systemd-resolved` | `org.freedesktop.resolve1` `SetLinkDNS` | Low |
| `network-online.target` and `systemd-networkd-wait-online` | mosd becomes a boot-ordering barrier for anything that waits on the network | Medium — an architectural consequence, not a coding one |
| The `Describe` surface | mosd's own rtnetlink dump replaces it | Low, and arguably an improvement: the observed-state module already renders rtnetlink enumerations by name |

Two workspace constraints apply and neither blocks it: `unsafe_code` is
`forbid`, so raw socket work must go through a crate rather than inline; and
`deny.toml` bans C-building dependencies, which the pure-Rust netlink crates
satisfy.

### 7.5 Prior art: Bottlerocket

Bottlerocket — AWS's immutable, Rust-first container host — faced this exact
question and answered it, so its answer is worth reading before ours. The
observations below were read off the `bottlerocket-os/bottlerocket-core-kit`
and `bottlerocket-os/bottlerocket` repositories in September 2026.

**The shape is a Rust generator in front of an upstream backend.** `netdog` is
a Rust **one-shot CLI, not a daemon**, with five subcommands:
`generate-net-config` builds interface configuration from a `net.toml` file or
from a `netdog.default-interface=` kernel argument; `write-resolv-conf` writes
`/etc/resolv.conf` with API settings taking priority and DHCP as the fallback;
`set-hostname` and `generate-hostname` handle the name, falling back to the IP
when lookup fails; `node-ip` publishes the current address as JSON for other
components. Its own README calls it "a small helper program for
systemd-networkd, to apply network settings received from DHCP". DHCP, RA,
addresses and routes are networkd's.

**There is no netlink in it.** The source tree under `sources/netdog/src` is
`addressing/`, `cli/`, `net_config/`, `networkd/`, plus `bonding.rs`,
`dns.rs`, `interface_id.rs`, `networkd_status.rs` and `vlan_id.rs`. No
rtnetlink module, no DHCP state machine. `net.toml` carries three schema
versions; v3 covers plain devices, VLANs and bonds, and marks one interface
primary — the same class of surface as this repository's own interface
settings.

**The direction of travel is the opposite of the one this section is
considering.** Bottlerocket did not move from systemd-networkd to its own
implementation; it moved *to* systemd-networkd, from `wicked`. The proposal
was opened in September 2022 and argued on streamlining dependencies and
giving users a familiar stack; release 1.15 in 2023 made systemd-networkd and
systemd-resolved the default for new variants while existing ones stayed on
wicked; the current core-kit tree carries a `networkd/` module and no `wicked/`
module at all. A Rust-first immutable OS considerably larger than this one
deliberately retired a network daemon it maintained in favour of networkd.

**On the read path, mos is already the more direct of the two.**
`networkd_status.rs` obtains state by running `networkctl status --json=pretty`
and parsing stdout. mosd calls `org.freedesktop.network1.Manager.Describe` over
the system bus. Whatever else changes, that is not a place to move toward the
prior art.

**The seams in this architecture are visible in their tracker too.** "DHCP
leases lost when netdog writes resolv.conf" is the failure mode of a generator
and a backend sharing a file, which is the same class of defect §7.3 names.
Bottlerocket carries it rather than restructuring around it.

**Where the comparison stops.** Bottlerocket's surface is narrower than this
one's in the two places §7.3's argument actually rests. It has **no
WireGuard**, so no private key has to be made readable by an unprivileged
network daemon; and its virtual devices are VLANs and bonds that networkd both
creates and keeps, so it never needed a deletion path and never met the
netdev-reaping problem that put `ip link del` into this tree. Copying
Bottlerocket therefore amounts to keeping today's arrangement — and today's
arrangement has two concrete defects that Bottlerocket does not have.

The honest conclusion is that this raises the burden of proof on §7.7's first
half without removing it. A larger project weighed the same trade and chose
the other side; so the case for owning the programming half has to rest on
the WireGuard key and the netdev reaping specifically, and not on a general
preference for owning one's own stack.

### 7.6 Prior art: Venus OS

Venus OS — Victron's appliance OS for GX energy-monitoring devices, already
read in this tree as a benchmark by
[venus-gui-v2.md](venus-gui-v2.md) — lands on the same side of the
protocol question by a different route, and it supplies a cost that
Bottlerocket's example hides. Read from `victronenergy/meta-victronenergy`,
`victronenergy/venus` and the project wiki in September 2026.

**A different stack, so read it for the shape and not for the parts.** Venus
manages the network with **ConnMan**, driven over the `net.connman` system-bus
API — `Manager.GetProperties`, `Technology.SetProperty` on
`/net/connman/technology/wifi`. Service supervision is daemontools (`svstat`,
`svc -d`, `svc -u`), not systemd. ConnMan's remit is also wider than
networkd's: it carries the DNS proxy and the clock, so Venus sets its timezone
through `net.connman.Clock.SetProperty`. For a system optimising a closure,
networkd's narrower boundary is the better one, and this is the main reason
Venus is a weaker analogue than Bottlerocket.

**Adopting an upstream manager did not mean not maintaining network code.**
`meta-venus`'s `connman_%.bbappend` applies **31 patches** on top of the
OpenEmbedded recipe, plus a `main.conf` and a `connmand-watch.sh`. The patch
titles are the field-failure list:

| Area | What they had to add |
|---|---|
| Routing and gateways | do not set a default route without a gateway; preserve the default gateway when a new link lacks one; increase the metric for Wi-Fi routes |
| Features invented locally | `AlwaysConnectedTechnologies` (four patches); `GatewayEnabled` per technology (three patches) |
| DNS | fix nameserver and search-domain ordering; stop exporting duplicates; do not add `0.0.0.0` as a nameserver |
| Wi-Fi reliability | make max connection retries configurable; remove the load-shaping retry counter; **restart the daemon on Wi-Fi failure** |
| Other | make IPv4LL fallback configurable; set the hwclock when time is decoded; really ignore blacklisted and non-ethernet interfaces; remove the special route setup for VPNs |

`connmand-watch.sh` is an unbounded restart loop around `connmand` — no
backoff — that exits only at runlevel 6.

This is the bill for the option §7.7 recommends, and it is the thing
Bottlerocket's example does not show. Keeping an upstream network manager does
not remove network maintenance; it changes its form from writing an
implementation to carrying a patch queue against someone else's. **This tree's
current patch count against networkd is zero**, and that — not the 0.6 MB of
§7.2 — is what "keep networkd" is actually buying.

One clean illustration of how much the backend choice decides that bill: the
"choose which interface reaches the internet" capability Venus shipped in 3.70
required inventing a `GatewayEnabled` technology property inside ConnMan,
across three patches. The same requirement against networkd is route metric
and `DefaultRouteOnDevice=` in a `.network` file. Not a capability difference —
a maintenance-surface difference.

**Their UI evolution independently reproduces mosd's shape.** Venus issue 1215
records that gui-v1 spoke to ConnMan directly, and that gui-v2 will not: it
requires the network settings to be exposed on Venus's own D-Bus, with
`venus-platform` as the intermediary that drives ConnMan underneath. That is
the arrangement this tree already has — a settings tree, a bus surface, and
reconcilers over an upstream daemon. At the time of reading the issue was
still open, assigned, marked high priority and scheduled for v3.90, with no
pull request.

**One correction worth recording, because it is an easy mistake.** The
standalone `victronenergy/connman` repository is a fork at branch
`b1.33_venus`; upstream ConnMan 1.33 dates from July 2016 and that repository
has not moved since 2019. It is a legacy artifact, **not** what current builds
use: `meta-venus` declares `LAYERSERIES_COMPAT = "scarthgap"` and takes
meta-networking's ConnMan 1.42, with the bbappend above layered on top.
Concluding "Venus ships a ten-year-old network manager" from the fork's branch
name would be wrong.

### 7.7 Assessment

Split the question, because the two halves have opposite risk profiles.

**The programming half is worth doing.** Links, addresses, routes, VLANs,
bridges and WireGuard through rtnetlink and genetlink reimplements no
protocol. It replaces file rendering, a reload call and a shell-out with
operations that succeed or fail, deletes the netdev-reaping workaround, and
takes the WireGuard key out of a group-readable file.

**The protocol half is the whole risk.** A DHCP client is exactly the kind of
surface section 5 declines to rewrite for `wpa_supplicant` and openssh: long
tail, adversarial peers, failure modes that appear in the field and not on the
bench. Doing it because networkd is "systemd" and not because anything is
wrong with it would be trading a mature implementation for an immature one and
recovering 0.6 MB.

A hybrid is available but is not free. `[Match]` scopes networkd per
interface, so networkd could be left owning only DHCP-configured links while
mosd owns static, VLAN, bridge and WireGuard ones. The cost is that two
writers now touch one kernel, and networkd's foreign-address and
foreign-route handling becomes load-bearing configuration rather than a
default nobody reads. If the hybrid is chosen, that partition is the first
thing that needs a test, not a comment.

Both prior-art systems land on the same side of the protocol question, from
different stacks and for different reasons:

| | Upper layer, written in-house | Network backend | Implements DHCP itself |
|---|---|---|---|
| Bottlerocket | `netdog`, a Rust one-shot CLI | systemd-networkd, migrated from wicked | no |
| Venus OS | `venus-platform`, in progress | ConnMan, plus 31 local patches | no |
| mos today | `mosd`, shipped | systemd-networkd | no |

**Recommendation.** Keep networkd for DHCP and RA, and treat "no systemd
network at all" as a separate question that must arrive with a DHCP
conformance suite before it is worth asking. The boundary between the two is
clean, and the first half does not commit to the second. Three appliance
operating systems, two of them Rust-first, reached the same answer
independently.

**What would overturn that, and it is worth writing down rather than
rediscovering.** §7.6 shows that keeping an upstream manager is not free — it
is paid in patches rather than in implementation, and Venus pays 31 of them
plus a restart loop. This recommendation rests on a number that is currently
zero: this tree carries no patch against networkd. The first time a defect in
networkd has to be patched rather than configured around, that number stops
being zero and the comparison has to be redone with the new figure, because
the argument was never "networkd is upstream" — it was "networkd is upstream
*and costs nothing to keep*".

Take the programming half only against the two defects §7.5 isolates. After
the Bottlerocket comparison, "mosd should own its own network programming"
is no longer sufficient warrant on its own: a larger Rust-first immutable OS
weighed the same trade and moved the other way. What survives that comparison
is narrower and should be stated as the acceptance criterion rather than as a
preference — the WireGuard private key stops being readable by a second
unprivileged process, and deleting a virtual device stops needing a shell-out
because networkd will not reap what it created. If a proposal cannot show
both, it is asking to rewrite a working thing.

---

## 8. Suggested order

Ranked by compressed bytes recovered against work and risk. Every figure is
the conservative `gzip -6` proxy from section 1.

| # | Change | Compressed | Touches |
|---|---|---:|---|
| 1 | `[profile.release]` in the mosd workspace, then the multicall merge | 3–5 MB *(expected, unmeasured)* | one repository |
| 2 | Trim `gconv` at the pack stage, with an assertion on what still resolves | 3.35 MB | one pack script |
| 3 | `mos-health`'s curl probe in Rust; drop the 15-package closure and the probe's SKIP path | ~1.7 MB | mosd/apid, `mos-system` depends, health gate |
| 4 | Host-key generation in Rust; drop `openssh-client` and `openssh-sftp-server` | ~1.5 MB | seed script, `mos-system` depends |
| 5 | Network programming via rtnetlink (§7.7); drop the `ip link del` shell-out and, with §3, `iproute2` | ~2.6 MB | mosd, and it is the largest piece of work here |
| 6 | Delete the iptables family, the dpkg residue, and decide on `e2scrub` | ~0.6 MB | `mos-system` depends, purge script |

Items 1, 2 and 6 are independent of everything else. Items 3 and 4 are two
instances of the same move — retire a shell script's exec and the package
behind it — and share a mechanism. Item 5 stands alone and should be argued on
section 7's grounds rather than on its byte count.

This document does not overlap
[the boot artifact record](../task/20260911-1925-boot-artifact-size.md), which
owns the initramfs and FIT payloads; this one owns the read-only root itself.

## Related

- [containers.md](../design/containers.md) — what the container engine is for
- [connd.md](../design/connd.md) — the Wi-Fi station and AP model §7 sits under
- [ro-root.md](../design/ro-root.md) — the read-only root this closure fills
- [build.md](../design/build.md) — the compose and pack stages every deletion above would live in

- [venus-gui-v2.md](venus-gui-v2.md) — the other Venus OS benchmark read in this tree

External, for §7.5:

- `bottlerocket-os/bottlerocket-core-kit`, `sources/netdog/` — the generator, its
  subcommands and its `net.toml` schema versions
- `bottlerocket-os/bottlerocket` issue 2449 — the wicked to systemd-networkd
  proposal and its reasoning
- `bottlerocket-os/bottlerocket` issue 3417 — "DHCP leases lost when netdog
  writes resolv.conf", the generator/backend seam in their tracker

External, for §7.6:

- `victronenergy/meta-victronenergy`, `meta-venus/recipes-connectivity/connman/` —
  the bbappend, its 31 patches, `main.conf` and `connmand-watch.sh`
- `victronenergy/meta-victronenergy`, `meta-venus/conf/layer.conf` — the
  `scarthgap` series declaration that fixes which upstream ConnMan is patched
- `victronenergy/venus` issue 1215 — "Add network control to Venus-platform",
  the gui-v1 direct-to-ConnMan to gui-v2 over-D-Bus move
- `victronenergy/venus` wiki, "commandline / development" — the daemontools
  supervision commands and the `net.connman` D-Bus calls
- `victronenergy/connman`, branch `b1.33_venus` — the legacy fork, recorded here
  only because mistaking it for the shipped version is the easy error
