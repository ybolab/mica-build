# Design: Board Support (BSP) Contract

> English | [中文](../zh/design/boards.md)
>
> How a board joins mos: what it must produce, what the OS build consumes, and
> the hard assertions between them. Reference implementation: `boards/cx3576/bsp`.

## 1. Separation rule

BSP layers produce **artifacts**; the OS build consumes **artifacts**. Neither
side reaches into the other's build. Yocto is permitted only inside a board
directory (when a vendor ships BSP solely as Yocto layers, run
`bitbake virtual/kernel virtual/bootloader` and export the deploy dir) — never
in the OS build chain.

## 2. Board directory layout

A board is a directory under `boards/`. `board.env` is the definition and the
only member every board has; the rest appear when the board needs them.

```
boards/<name>/
├── board.env          # partition layout, MOS_ARCH, console and cmdline extras,
│                      #   RAUC backend, firmware / radio / hwinit lists
├── overlay/           # files this board adds to the image root
├── boot.cmd           # U-Boot boot script source      (uboot-chain boards)
├── grub.cfg           # ESP GRUB configuration         (UEFI boards)
├── hwinit/            # the board's systemd hardware-init units
└── bsp/               # only where the board builds its own boot chain
    ├── Makefile       # make uboot | uboot-mos | kernel | rootfs | image
    ├── uboot/Dockerfile    # -> bootloader binary (u-boot-rockchip.bin)
    ├── kernel/             # -> Image, modules.tar, *.dtb
    │   ├── Dockerfile
    │   ├── config/         # kernel config baseline (vendor ikconfig + mos additions)
    │   ├── dts/            # in-tree board dts (open-source route, no overlay stacking)
    │   └── patches/        # ordered *.patch series
    ├── init/               # board hardware facts the hwinit units read
    └── rootfs/             # firmware drop + demo/smoke-test rootfs (NOT the product)
```

Boards with an upstream-supported boot chain (`boards/x64`, UEFI) compile no
bootloader: "a UEFI machine's firmware provides the boot chain, so nothing here
compiles one" (`boards/x64/board.env`). They still build a KERNEL. x64's
`bsp/` has exactly one target — mainline pinned by tag and source hash,
configured by a fragment merged over `x86_64_defconfig` and recorded resolved
(`boards/x64/bsp/kernel/`) — and it is packaged as `mos-kernel-x64`, which
`mos-board-x64` depends on. It replaced Debian's `linux-image-amd64`, whose
kernel has no `CONFIG_DM_INIT` and therefore ignored this board's own
`dm-mod.create=` verity table (PLAN-074).

## 3. Artifact interface into the OS image

| Artifact | Producer | Consumer |
|---|---|---|
| `Image` + `modules.tar` + `*.dtb` | `boards/<name>/bsp/kernel` | `boards/<name>/deb/board-<name>/render.sh` stages them and the board package unpacks `modules.tar` into `/usr/lib/modules`, refusing an unpack that yields no module; `build/src/mkimage-cx3576.ts` writes `Image` and the dtb into each boot slot, requiring each because "it is a BSP artifact" (`build/src/mkimage-cx3576.ts`) |
| bootloader binary | `boards/<name>/bsp/uboot` | `build/src/mkimage-cx3576.ts`: raw write at the board's `UBOOT_SEEK_SECTOR`, and it refuses the v1 debug blob — "A mos image must carry the uboot-mos variant" (`build/src/mkimage-cx3576.ts`) |
| `board.env` | `boards/<name>/` | every consumer: both assemblers, the rootfs driver, RAUC's config renderer, verify. Read as data, never sourced — "Nothing here ever hands the file to a shell" (`verify/src/board-env.ts`) |
| firmware blobs | `boards/<name>/bsp/rootfs/firmware` | `rootfs/build.sh` stages only what `BOARD_FIRMWARE_FILES` names, because "only the confirmed runtime set may enter a signed root" (`rootfs/build.sh`) |

Modules/kernel version coupling is absolute: the modules tree inside the rootfs
MUST match the BSP kernel release, asserted at image assembly.

## 4. Kernel config assertions (CI gate per board)

Vendor defconfigs never ship these correctly; every board kernel build must
assert (grep on the final .config, fail the build otherwise):

- Boot path: `DM_INIT=y`, `DM_VERITY=y`, `BLK_DEV_DM=y`, `SQUASHFS=y` (+zstd),
  storage controller built-in, `OVERLAY_FS=y` — no-initramfs verity boot
 cannot load modules before root is mounted.
- Runtime: cgroup v2 set, containerd/netfilter prerequisites (the docker set
  already asserted in cx3576's Dockerfile), seccomp.
- Shared baseline fragment: maintained once for all boards at
  `boards/common/mos-required.fragment` (buildx named context `mos-common`),
  merged before olddefconfig — the source of truth for the list above plus the
  pseudo filesystems and security options it also asserts (hugetlbfs, tracing,
  SELinux + LSM boot list). Board-specific requirements stay in the board's own
  config baseline.

**A common requirement must be satisfiable by BOTH kernels, or it is not
common.** x64 builds no kernel: it installs Debian's `linux-image-amd64` whole,
and that config is not this project's to change. So every symbol below was
measured against the config Debian actually ships — `/boot/config-*` in a
composed x64 root — before it entered the fragment, and the x64 half of the same
guarantee is read back off the built artefact by
`verify/src/checks-kernel.ts` (`=y` **or** `=m` there, because x64 ships `kmod`
and a full module set, plus a second check that the `.ko` the `=m` promises was
actually packed). A symbol only one board could satisfy is not dropped into the
fragment and quietly enforced on one board; by
`docs/design/security-model.md` §4 it would become a per-board capability that
the flows needing it refuse — visibly — where it is absent. Nothing in the two
groups below needed that: Debian satisfies all fifteen.

### 4.1 eBPF runtime

Not diagnostics. `crun` programs the cgroup v2 device controller as a
`BPF_PROG_TYPE_CGROUP_DEVICE` program — crun 1.29.1
`src/libcrun/ebpf.c:490,496` (load), `:423` (attach),
`src/libcrun/cgroup-systemd.c:1482,1501` (the caller, per container) — and on
cgroup v2 that program *is* the device policy; there is no `devices` controller
file to write instead. All four are bools with no module of their own.

| Symbol | What it buys | Debian |
|---|---|---|
| `CONFIG_BPF` | the eBPF core every program runs on | `=y` |
| `CONFIG_BPF_SYSCALL` | the `bpf(2)` syscall, without which no program can be loaded at all | `=y` |
| `CONFIG_BPF_JIT` | native compilation of those programs instead of interpretation | `=y` |
| `CONFIG_CGROUP_BPF` | crun's cgroup v2 device filter, which is the device policy there | `=y` |

`CONFIG_BPF_JIT` was the one gap: cx3576 shipped `# CONFIG_BPF_JIT is not set`.
It `depends on MODULES` and on `HAVE_CBPF_JIT || HAVE_EBPF_JIT` (v6.1
`kernel/bpf/Kconfig`); the board has both.

**`CONFIG_DEBUG_INFO_BTF` is deliberately NOT in the floor, and the price was
measured rather than estimated.** Debian sets it `=y`, so it is free on x64 and
not free on cx3576: it `depends on !DEBUG_INFO_SPLIT && !DEBUG_INFO_REDUCED`
(v6.1 `lib/Kconfig.debug`) and the board config sets
`CONFIG_DEBUG_INFO_REDUCED=y`, so adopting it means compiling the whole tree
with full DWARF and adding `dwarves` (pahole) to
`boards/cx3576/bsp/kernel/Dockerfile`. Both kernels were built and compared:

| | floor as shipped | with BTF | delta |
|---|---|---|---|
| `Image` | 44,493,312 B (42.4 MiB) | 52,554,240 B (50.1 MiB) | **+7.7 MiB, +18.1%** |
| `modules.tar` | 5,529,600 B | 6,010,880 B | +470 KiB, +8.7% |
| `make Image modules` | 683 s | 1366 s | **2.0×** |
| builder packages | `libssl-dev libelf-dev python3 kmod patch` | + `dwarves` (pahole 1.25) | one package |

The `Image` figure is the one that binds. It is `=y` payload — permanent kernel
RAM on a 
device, in **both** A/B boot slots, against a `BOOT_SIZE_MIB=64` partition
(`boards/cx3576/board.env`): headroom drops from about 21 MiB to about 13 MiB.
The 2.0× build time was measured while the package pools were building on the
same host, so part of it is contention; the direction and the order of magnitude
are the claim, not the second digit.

Without BTF a device runs everything the image ships — crun's device filter,
systemd's cgroup BPF programs, and any program compiled against this exact
kernel's headers. What it cannot run is a CO-RE binary: `bpftrace`, `bcc`,
anything built on libbpf's `vmlinux.h`, all of which relocate against the running
kernel's BTF. The image ships none of them. Adopting it later is three edits —
drop `DEBUG_INFO_REDUCED`, add `CONFIG_DEBUG_INFO_BTF=y`, add `dwarves` — and
belongs with whatever first ships a CO-RE tool.

### 4.2 Firewall back-end

The kernel side of an nftables front-end, with `iptables-nft` as the reference
because that is the compatibility surface Debian's `iptables` package provides
(trixie ships 1.8.11). Citations are into the upstream 1.8.11 tarball.

| Symbol | What it buys | Debian |
|---|---|---|
| `CONFIG_NF_TABLES` | the nf_tables core every rule is programmed into (`nft.c:440` `xtables_ipv4[]`) | `=m` `nf_tables` |
| `CONFIG_NF_TABLES_INET` | the inet family netavark puts its whole table in | `=y` |
| `CONFIG_NF_TABLES_IPV4` | the ip family `iptables-nft` builds its five builtin tables in (`nft.c:898` `builtin_tables_lookup`) | `=y` |
| `CONFIG_NF_TABLES_IPV6` | the ip6 family `ip6tables-nft` builds them in (same lookup, `AF_INET6`) | `=y` |
| `CONFIG_NFT_COMPAT` | the xt match and target expressions the front-end emits for everything with no native form (`nft.c:1502` `"match"`, `:1557` `"target"`), and what its revision probe queries (`nft.c:3658`, `NFNL_SUBSYS_NFT_COMPAT`) | `=m` `nft_compat` |
| `CONFIG_NETFILTER_XTABLES` | the x_tables core `NFT_COMPAT` `depends on` (v6.1 `net/netfilter/Kconfig`) | `=m` `x_tables` |
| `CONFIG_NF_CONNTRACK` | connection tracking, the state stateful filtering matches on | `=m` `nf_conntrack` |
| `CONFIG_NFT_CT` | the `ct` expression that reads that state | `=m` `nft_ct` |
| `CONFIG_NF_NAT` | the NAT core | `=m` `nf_nat` |
| `CONFIG_NFT_NAT` | the snat and dnat expressions | `=m` `nft_nat` |
| `CONFIG_NFT_MASQ` | the masquerade expression | `=m` `nft_masq` |

Two things are deliberately absent. The **legacy `IP_NF_*` / `IP6_NF_*`
back-end** — §4.2.1 measures it unreachable through anything the image selects.
And `NF_NAT_MASQUERADE`, which `NFT_MASQ` selects, so a line for it would state
a consequence rather than a requirement.

The two floors overlap: `tests/netavark-kernel-config-test.sh` asserts that
every symbol it cites which the fragment also states is stated there as `=y`,
so a weaker statement in the shared file cannot hide behind cx3576's own
Dockerfile loop.

#### 4.2.1 The x_tables extensions, and why they are floor and not policy

The table above is the front-end's *core*. It is not enough to run the
front-end, and the reason was measured rather than reasoned about (RFCT-304).

**`iptables-nft` does not translate extensions natively.** Read the rule the
kernel actually stored, through `nft --json`, and every extension the front-end
was asked for comes back as an `nft_compat` `xt` expression:

| what was asked for | what the kernel stored |
|---|---|
| `-j MASQUERADE`, `-j REDIRECT`, `-j DNAT` | `xt target` MASQUERADE / REDIRECT / DNAT |
| `-j CHECKSUM`, `-j CT` (`--notrack` included), `-j MARK` | `xt target` CHECKSUM / CT / MARK |
| `-m addrtype`, `-m conntrack` | `xt match` addrtype / conntrack |
| `-t raw -j ACCEPT`, `-m mark`, `-p tcp --dport` | native — verdict and builtin matches only |

**Read `--json`, not `nft list ruleset`.** The text renderer runs an `xt`
expression back through libxtables' `xlate` callback and prints the
*translation*, so a compat rule prints as `masquerade` or `fib daddr type
local` exactly as a native one would. Classifying from the text output gets
every row of that table wrong.

`nft_compat` resolves an `xt` expression by loading the `xt_*` module by name.
With the module absent the rule is **refused**, on the x64 kernel this tree
builds:

```
# iptables -t nat -A PREROUTING -p tcp --dport 80 -j REDIRECT --to-ports 8080
Warning: Extension REDIRECT revision 0 not supported, missing kernel module?
```

So these eight are floor, not policy — they decide whether the tool §4.2 exists
for actually runs:

| Symbol | Module | Reaches it |
|---|---|---|
| `CONFIG_NETFILTER_XT_MARK` | `xt_mark` | `-j MARK` |
| `CONFIG_NETFILTER_XT_NAT` | `xt_nat` | `-j SNAT`, `-j DNAT` |
| `CONFIG_NETFILTER_XT_MATCH_ADDRTYPE` | `xt_addrtype` | `-m addrtype` |
| `CONFIG_NETFILTER_XT_MATCH_CONNTRACK` | `xt_conntrack` | `-m conntrack` |
| `CONFIG_NETFILTER_XT_TARGET_CHECKSUM` | `xt_CHECKSUM` | `-j CHECKSUM`; no native form exists at all |
| `CONFIG_NETFILTER_XT_TARGET_CT` | `xt_CT` | `-j CT`, `--notrack` included |
| `CONFIG_NETFILTER_XT_TARGET_MASQUERADE` | `xt_MASQUERADE` | `-j MASQUERADE` |
| `CONFIG_NETFILTER_XT_TARGET_REDIRECT` | `xt_REDIRECT` | `-j REDIRECT` |

**This is a chosen subset and cannot be anything else.** Any of the ~60 xt
extensions an operator names needs its own module and the image will not carry
all of them. These eight are the symbols the operator-visible split was *made
of* — and not, which would sound tidier and be false, "everything both boards
already had": three of them (`CHECKSUM`, `CT`, `REDIRECT`) were absent on x64,
so adopting them added capability there.

**Eight, and PLAN-074 §7h listed eleven — the two lists are not the same list.**
That one was derived from the symbols an earlier floor swap dropped; this one
from running the rules. Five of the eleven are the legacy tables of §4.2.2 and
leave by that route instead. `NETFILTER_XT_MATCH_CONNTRACK` is here because
cx3576's board loop stopped restating it and the assertion had to land
somewhere. And `NETFILTER_XT_NAT` is on this list without being on that one: it
is `=y` on cx3576 and `=m` on x64, the same split as `TARGET_MASQUERADE` beside
it, and a nat compatibility path that answers `-j MASQUERADE` but leaves
`-j DNAT` one class weaker would keep the defect this section closes.

**What it cost**, measured by building each kernel twice:

| | before | after | delta |
|---|---|---|---|
| x64 `bzImage` | 14,971,904 B | 14,980,096 B | **+8,192 B, +0.055 %** |
| x64 `modules.tar` | 337,920 B | 286,720 B | −51,200 B |
| x64 loadable modules | 8 | 4 | −4 |
| cx3576 `Image` | 44,493,312 B | 44,493,312 B | **0 B** |

cx3576 is zero because its committed vendor config already set all eight `=y`,
so the fragment merges values that are already there. Both kernels were built
from this tree with only the fragment differing, to show that rather than
assert it. **The comparison was by size, not by hash, and the reason is worth
keeping now that it has been repaired:** at the time
`boards/cx3576/bsp/kernel/Dockerfile` pinned none of `KBUILD_BUILD_TIMESTAMP`,
`_USER` or `_HOST`, which x64's did, so two builds of one unchanged tree already
differed — the two `Image` files here have equal size and different sha256, and
that difference was the build clock rather than this change.

RFCT-320 added those three pins and RFCT-343 then ran the experiment nobody had:
two `--no-cache` builds of the kernel target, same tree, back to back. **The
Image still differed, by 24 bytes at equal size.** Five of them were `__DATE__`
and `__TIME__` compiled into the vendor Mali driver, which no `KBUILD_BUILD_*`
reaches — they are cpp builtins reading the wall clock, and mainline's
`-Werror=date-time` does not cover a vendor tree. The other nineteen were the
GNU build-id, a hash OF the linked image, which moved only because the five did.
`modules.tar` differed for an unrelated reason: every member was byte-identical
and every tar header carried the build's mtime, a packaging defect the same line
gave x64 and virt-arm64. `SOURCE_DATE_EPOCH` pins the first and
`--sort=name --mtime --numeric-owner` the second; **all three boards' kernels are
byte-reproducible now and may be compared by sha256.**
The x64 figure is `=y` payload — permanent kernel RAM, in both A/B slots,
against `BOOT_SIZE_MIB` — and 8 KiB against a 96 MiB boot partition is not a
number that constrains anything. The four `.ko` that stopped being built are
the same four symbols moving from `=m` to `=y`, so the modules half of
`verify/src/checks-kernel.ts` keeps four subjects rather than none.

#### 4.2.2 The legacy back-end, measured

`IP_NF_RAW`, `IP6_NF_RAW`, `IP6_NF_NAT`, `IP6_NF_TARGET_MASQUERADE` and
`IP_NF_NAT` are a **separate question** from the `xt_*` modules above, and the
answer is the other way.

`iptables-nft` builds its `raw`, `nat`, `mangle` and `filter` tables **in
nf_tables**, not in the legacy table store. On the x64 kernel, which sets
`# CONFIG_IP_NF_RAW is not set`:

```
# iptables -t raw -A PREROUTING -j ACCEPT      →  accepted, stored native
# iptables-legacy -t raw -L -n
iptables v1.8.11 (legacy): can't initialize iptables table `raw':
Table does not exist (do you need to insmod?)
```

The only front-end that needs those symbols is `iptables-legacy`, and
**nothing in this tree selects it**: the alternatives group is left in auto
mode, where the nft front-end outranks the legacy one, and `update-alternatives`
is run nowhere here. So cx3576's board loop no longer asserts the ten legacy
entries it carried. That is not a config change on cx3576 — the vendor config
still sets them and they stay `=y` — it is the removal of an assertion that
made a leftover look like a requirement. x64 keeps whatever `x86_64_defconfig`
resolves (a partial legacy surface: `filter` and `mangle` in both families,
`nat` in ip only, `raw` in neither), because trimming it is a subtraction with
its own size argument and no consumer asking for it either way.

#### 4.2.3 Four differences of the same class, measured and NOT closed

Running the wider extension set against the rebuilt x64 kernel found four more
board differences of exactly the shape §4.2.1 closes. They are recorded here
rather than fixed, because each needs a **direction chosen** and that is a
decision about what the product's compatibility path guarantees, not a
measurement:

| Extension | Symbol | x64 | cx3576 |
|---|---|---|---|
| `-m multiport` | `NETFILTER_XT_MATCH_MULTIPORT` | refused | works |
| `-m comment` | `NETFILTER_XT_MATCH_COMMENT` | refused | works |
| `-j CT --zone` | `NF_CONNTRACK_ZONES` | refused | works |
| `-j LOG` | `NETFILTER_XT_TARGET_LOG` | works (`=m`) | **refused** |

`-j LOG` is the one to read twice: it runs the *other* way, so the board with
the weaker firewall surface is not the same board for every rule. `-j CT
--zone` is also not an xt module — the `CT` target itself is floor now and
`--notrack` works on both; `--zone` needs a conntrack feature that widens the
conntrack tuple and is priced separately.

Closing any of them means either adding capability to the board that lacks it
or taking it from the board that has it. Both are product decisions about the
guaranteed compatibility surface, and the tail behind them is long
(`-m limit` and `-m iprange` are refused on **both** boards today, and there
are ~50 more). A floor that grew by whichever extension was tried most recently
would be the policy PLAN-073 rightly refused to write by accident.

### 4.3 Bridge filtering

podman puts every container's veth on one Linux bridge, and traffic between two
containers on that bridge is **switched at layer 2** — it never reaches the
ip-family hooks, so a host firewall cannot see it. Three symbols are what make
it visible at all.

| Symbol | What it buys | Debian |
|---|---|---|
| `CONFIG_BRIDGE_NETFILTER` | bridged IP and ARP frames reaching the ip-family hooks, so one firewall covers container-to-container traffic ("let arptables resp. iptables see bridged ARP resp. IP traffic", `net/Kconfig`) | `=m` `br_netfilter` |
| `CONFIG_NF_TABLES_BRIDGE` | the nf_tables `bridge` family — filtering a bridged frame at layer 2 without redirecting it into the ip hooks | `=m` |
| `CONFIG_NF_CONNTRACK_BRIDGE` | conntrack and IP defragmentation for bridged traffic, without which `ct state` is not answerable there; its own Kconfig calls it "a replacement for the `br_netfilter` infrastructure" | `=m` `nf_conntrack_bridge` |

`CONFIG_NF_TABLES_BRIDGE` builds no object of its own: it is a tristate
`menuconfig` whose family compiles into `nf_tables.ko` and whose submenu holds
the per-expression modules (`nft_meta_bridge`, `nft_reject_bridge`), which are
policy. It takes the same module-less shape in `verify/src/checks-kernel.ts` as
the inet/ip/ip6 family bools.

**What an operator observes, and it is not the same on both boards.**
`br_netfilter` defaults every one of its `call-iptables` / `call-ip6tables` /
`call-arptables` switches to 1 (`net/bridge/br_netfilter_hooks.c:1255-1257`),
and its hooks register once a bridge exists. Built in — as it is on an in-tree
board kernel — that happens at the first bridge; as a module, as on Debian's,
only once something loads it. So on cx3576 an ip-family FORWARD policy applies
to same-bridge container traffic from the moment podman creates its network,
and on x64 today it does not. The capability is common; the default state is
not, and a DROP policy written against one board will not behave the same on
the other. Anyone writing that policy has to decide the `bridge-nf-call-*`
sysctls explicitly rather than inherit them.

Three bridge symbols the cx3576 vendor config carries are deliberately **not**
in the floor, all three of which both kernels already have — so this is a
choice on merit, not a constraint:

- `CONFIG_BRIDGE_NF_EBTABLES` — the legacy ebtables front-end, held to the same
  test as legacy xtables. Nothing in the image ships `ebtables`, and the
  modern front-end does not need it: `ebtables-nft` programs the bridge family
  through the nf_tables compat expression (iptables 1.8.11 `nft.c:898`,
  `NFPROTO_BRIDGE` → `xtables_bridge`), which `NF_TABLES_BRIDGE` and
  `NFT_COMPAT` above already cover.
- `CONFIG_BRIDGE_VLAN_FILTERING` — VLAN-aware bridging. mosd renders a plain
  `Kind=bridge` netdev with no `VLANFiltering=`
  (`pkgs/mosd/mosd/src/reconciler/network.rs:569`) and delivers VLANs as
  separate `Kind=vlan` netdevs (`:566`), so nothing in the image asks a bridge
  to be VLAN-aware. Both kernels have it today, so adopting it later costs a
  fragment line and nothing else.
- `CONFIG_BRIDGE_IGMP_SNOOPING` — multicast snooping, and not a neutral
  addition: built, it is on by default per bridge, and with no querier on the
  segment a bridge stops forwarding multicast to ports that sent no report,
  which is how mDNS and SSDP discovery inside a container network breaks.
  Nothing in the image needs snooping, so the floor does not require the
  behaviour change.

### 4.4 Measured against Debian: what is required, deferred and dropped

x64 will eventually build its own kernel, at which point "Debian must satisfy
it" stops being a constraint. So every candidate was measured against Debian's
shipped config and put in one of three buckets, and the middle one is a list
the later task consumes rather than re-derives.

**Required now** — both kernels satisfy it. All eighteen symbols in §4.1–§4.3.
Verified against the config the cx3576 build actually produces (exported after
`olddefconfig`, not the committed input): every one comes out `=y`.

**Deferred to the x64 kernel** — cx3576 has it, Debian does not. **Measured
empty.** Of the 101 symbols the built cx3576 kernel sets in the
BPF / netfilter / bridge / VLAN / veth namespaces, exactly two are not satisfied
by Debian's `6.12.107+deb13-amd64`, and neither is a capability worth carrying
forward:

| Symbol | cx3576 | Debian | Why not deferred |
|---|---|---|---|
| `CONFIG_NETFILTER_XTABLES_COMPAT` | `=y` | not set | the 32-bit compat layer for x_tables ioctls on a 64-bit kernel; the image has no 32-bit userspace. Dropped on merit |
| `CONFIG_DEBUG_INFO_REDUCED` | `=y` | not set | a build-cost knob, not a capability — and Debian's "off" is *more* debug information, not less |

So the x64-kernel task inherits **no backlog of symbols** from this one. What it
inherits is the removal of the constraint: a future addition to the floor no
longer has to clear Debian's config first.

**Dropped on merit** — both kernels could satisfy it and the floor does not ask
for it: the legacy `IP_NF_*` back-end (§4.2.2 measures why),
`CONFIG_NF_NAT_MASQUERADE` (a `select` of `NFT_MASQ`), the three bridge symbols
in §4.3, and `CONFIG_DEBUG_INFO_BTF` (§4.1, priced). The per-extension xt
matches and targets were on this list when it was written and are not any more:
§4.2.1 measured seven of them load-bearing for the front-end §4.2 exists for,
and they are floor now.

**Owed, and named rather than rounded up.** The floor's own
`CONFIG_LSM="…,bpf"` names an LSM cx3576 does not build. On 6.1
`BPF_LSM depends on BPF_EVENTS && BPF_SYSCALL && SECURITY && BPF_JIT`
(`kernel/bpf/Kconfig`); the board already had the first three, and
`CONFIG_BPF_JIT=y` in §4.1 removed the fourth — so `CONFIG_BPF_LSM` is now
*available* on cx3576 and is simply left at its default of `n`. On x64 the
`bpf` entry is real (Debian sets `CONFIG_BPF_LSM=y`), so the boot list means
different things on the two boards. Nothing in the image uses a BPF LSM hook,
so this task does not enable it; closing the gap is now one config line, and
the alternative — dropping `bpf` from the boot list — is a security-posture
change that belongs with `docs/design/security-model.md`.

## 5. U-Boot requirements (uboot-chain boards)

The A/B design requires: `CONFIG_BOOTCOUNT_LIMIT`, redundant env
(`CONFIG_ENV_OFFSET_REDUND`), `CONFIG_FIT` + `CONFIG_FIT_SIGNATURE`,
`CONFIG_SYS_BOOTM_LEN ≥ 0x8000000`, RAUC BOOT_ORDER handshake script, and a
rescue path (cx3576: recovery-key → rockusb, boot-failure → rockusb fallback).
The boot script and RAUC `system.conf` are generated from one source — the
board definition, since "the template plus boards/cx3576/board.env are the
single source of truth" (`pkgs/rauc/render-config.sh`) — to prevent
drift.

## 6. Kernel support policy

The boot path sets the floor. The root is a squashfs carrying its own dm-verity
hash tree, described by one `dm-mod.create=` table on the kernel command line —
"one boot contract, written once by rootfs/build.sh, read by the kernel's
dm-init on a board whose kernel has it and by this script on a board whose kernel
does not" — above a userland that
is "Debian trixie + systemd" — the digest-pinned base
`rootfs/compose/10-compose.Dockerfile` installs onto, with systemd arriving
as `mos-system`'s `Depends`. Every board therefore
has to carry the §4 assertion set built in — `=y`, never `=m`, because nothing
can load a module before the root is there. Both shipped boards do, and both
merge the same shared fragment before `olddefconfig`. Board intake tiers:

| Tier | Kernel | Support |
|---|---|---|
| 1 | >= 5.10 LTS | Full support (mainstream vendor BSPs: RK 5.10/6.1, NXP 5.15/6.6, TI 6.1) |
| 2 | 5.4 | Per-board evaluation; small shims expected, no structural work |
| — | 4.x | **Out of support.** Options in order: (a) uplift the vendor kernel, or mainline the SoC; (b) a separate profile for that board on a smaller base with the mos services as containers, which gives up the signed A/B verity root the rest of this document assumes |

## 7. Adding a new board — checklist

1. Create `boards/<name>/` with a `board.env`, plus a `bsp/` only if the
   board builds its own boot chain. The definition must first pass
   `bash verify/run.sh --lint boards/<name>/board.env`,
   "the board-definition schema lint" (`verify/run.sh`).
2. Kernel: vendor tree + `boards/common/mos-required.fragment` merged before
   olddefconfig, every `=y` line then asserted against the built `.config` — a
   "missing mos-required option" (`boards/cx3576/bsp/kernel/configure.sh`)
   fails the build.
3. U-Boot: §5 config; verified boot keys enrolled. A UEFI board has none of it
   and ships a `grub.cfg` for the ESP instead.
4. Smoke path first — a stock or vendor image — to validate hardware bring-up
   before the full image is worth building.
5. Rootfs composed from the package pool (`rootfs/compose/`, sequenced by
   `build/src/stages-cli.ts`, which "decides the order and the tags"
   (`build/src/stages-cli.ts`)); the board's own content ships as
   `mos-board-<name>`. Image assembled by
   `bash build/run.sh --mkimage-cx3576` or `--mkimage-uefi --board x64`, green against
   `bash verify/run.sh --verify --board <name>`, then apid liveness on
   hardware — `/healthz`, which proves only that the apid process is listening,
   not that mosd or any other service on the board is healthy.
6. Power-cut rig run before the board is called supported.

## 8. Current boards

| Board | Arch | Boot chain | Status |
|---|---|---|---|
| cx3576 (CX3576-Z, RK3576) | arm64 ("MOS_ARCH=arm64", `boards/cx3576/board.env`) | U-Boot at eMMC sector 64 -> `boot.scr` -> `booti` on `Image` + `rk3576-src.dtb` (`boards/cx3576/boot.cmd`) | BSP builds `uboot-mos` and the kernel; the §4 assertion set is enforced in the kernel build, and the RAUC `BOOT_ORDER` handshake is implemented in `boards/cx3576/boot.cmd`. `CONFIG_FIT_SIGNATURE` (§5) is configured nowhere in the tree |
| x64 (generic UEFI) | amd64 ("MOS_ARCH=amd64", `boards/x64/board.env`) | UEFI firmware -> GRUB from one static ESP -> the slot's own boot partition (`boards/x64/grub.cfg`) | QEMU/CI baseline. `bsp/` builds the kernel and nothing else; no bootloader is compiled, because the firmware is one |
