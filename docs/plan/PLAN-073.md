# PLAN-073 Add the eBPF, firewall and bridge kernel floor, and bring both boards to it

- **status**: completed
- **createdAt**: 2026-09-03 19:22
- **approvedAt**: 2026-09-03 19:22
- **relatedTask**: RFCT-294

## Context

### The approval

The user asked for this work directly, as implementation rather than design:
add eBPF and firewall symbols to the COMMON kernel requirement, make the
verifier able to assert them, and bring both boards' kernels up to it. That
request is the approval; this record exists so the reasoning behind each symbol
is written down somewhere a later reader can find it, not to ask a question
that has already been answered.

Extended mid-flight, same standing, by three further decisions from the user:
the **bridge** side of the same floor is in scope; `boards/common/mos-required.fragment`
is confirmed as the home for all of it; and **x64 will get its own kernel in a
separate task**. That last one retires the "Debian must satisfy it" constraint,
so every candidate is filed into one of three buckets — required now, deferred
to the x64 kernel, or dropped on merit — and the deferred list is a deliverable
the later task consumes rather than re-derives. Starting the x64 kernel is
explicitly NOT this task.

### What the floor is, and what it can express today

`boards/common/mos-required.fragment` is the board-independent runtime
baseline. cx3576 merges it before `olddefconfig` and then greps every `=y` line
against the built `.config`, failing the image build otherwise
(`boards/cx3576/bsp/kernel/Dockerfile`). x64 builds no kernel at all -- it
installs Debian's `linux-image-amd64` whole -- so the same guarantee is read
off the built artefact by `verify/src/checks-kernel.ts`, which accepts `=y`
OR `=m` there and additionally resolves each symbol's module against the packed
root's own `modules.builtin`/`modules.dep`.

That check's `REQUIRED` list pairs **every** symbol with a module name. The
shape does not fit what this task adds: `CONFIG_BPF`, `CONFIG_BPF_SYSCALL`,
`CONFIG_BPF_JIT`, `CONFIG_CGROUP_BPF`, `CONFIG_NF_TABLES_INET`,
`CONFIG_NF_TABLES_IPV4` and `CONFIG_NF_TABLES_IPV6` are bool symbols with no
object file of their own -- three of them compile *into* `nf_tables.ko`, the
other four into the kernel image. A symbol with no module has to be assertable
by the config half and skipped by the modprobe half.

The only BPF-adjacent line in the fragment today is the `bpf` entry in
`CONFIG_LSM=`. That names the BPF LSM, not the eBPF runtime, and on cx3576
`CONFIG_BPF_LSM` is not built at all (see *Left owed* below).

### The constraint that decides the list

A common requirement must be satisfiable by BOTH kernels or it is not common.
x64's kernel is Debian's and is not ours to change, so every candidate symbol
was measured against the config Debian actually ships, read from a composed
x64 root -- `/boot/config-6.12.107+deb13-amd64` in
`_out/verify/x64/root-rootfs-a-*`, which the verify extraction produces.

Measured, Debian trixie `linux-image-6.12.107+deb13-amd64`:

| Symbol | Debian | cx3576 (committed config) |
|---|---|---|
| `CONFIG_BPF` | `=y` | `=y` |
| `CONFIG_BPF_SYSCALL` | `=y` | `=y` |
| `CONFIG_BPF_JIT` | `=y` | **`# ... is not set`** |
| `CONFIG_CGROUP_BPF` | `=y` | `=y` |
| `CONFIG_DEBUG_INFO_BTF` | `=y` | absent (`DEBUG_INFO_REDUCED=y`) |
| `CONFIG_NF_TABLES` | `=m` (`nf_tables`) | `=y` |
| `CONFIG_NF_TABLES_INET` | `=y` | `=y` |
| `CONFIG_NF_TABLES_IPV4` | `=y` | `=y` |
| `CONFIG_NF_TABLES_IPV6` | `=y` | `=y` |
| `CONFIG_NFT_COMPAT` | `=m` (`nft_compat`) | `=y` |
| `CONFIG_NETFILTER_XTABLES` | `=m` (`x_tables`) | `=y` |
| `CONFIG_NF_CONNTRACK` | `=m` (`nf_conntrack`) | `=y` |
| `CONFIG_NFT_CT` | `=m` (`nft_ct`) | `=y` |
| `CONFIG_NF_NAT` | `=m` (`nf_nat`) | `=y` |
| `CONFIG_NFT_NAT` | `=m` (`nft_nat`) | `=y` |
| `CONFIG_NFT_MASQ` | `=m` (`nft_masq`) | `=y` |
| `CONFIG_BRIDGE_NETFILTER` | `=m` (`br_netfilter`) | `=y` |
| `CONFIG_NF_TABLES_BRIDGE` | `=m` | `=y` |
| `CONFIG_NF_CONNTRACK_BRIDGE` | `=m` (`nf_conntrack_bridge`) | `=y` |

Every module named above resolves in that root: its object is present under
`/lib/modules/<release>` and so is every object its `modules.dep` line names.
So Debian satisfies the whole list, and the only cx3576 gap is `CONFIG_BPF_JIT`.

This measurement is now also a **handoff**, not just a gate: see *The three
buckets, measured* below.

### Why eBPF is a floor and not a nicety

The evidence is in the shipping image, not in a plan. `crun` 1.29.1 --
`pkgs/podman/versions.env`, and `usr/bin/crun` in the composed root, whose
strings include `+EBPF`, `bpf create`, `bpf attach` and
`systemd failed to install eBPF device filter on cgroup` -- programs the
cgroup-v2 device controller as a BPF program:
`src/libcrun/ebpf.c:490` sets `attr.prog_type = BPF_PROG_TYPE_CGROUP_DEVICE`,
`:496` calls `bpf(BPF_PROG_LOAD, ...)`, `:423` calls `bpf(BPF_PROG_ATTACH, ...)`,
and `src/libcrun/cgroup-systemd.c:1482,1501` is the caller that runs it for a
container's cgroup. On cgroup v2 there is no `devices` controller file to write
instead; the BPF program *is* the device policy. So `CONFIG_BPF_SYSCALL` and
`CONFIG_CGROUP_BPF` are what makes `podman run` able to restrict devices at
all.

### Why these bridge symbols

podman puts every container's veth on one bridge, and same-bridge traffic is
switched at layer 2 — it never reaches the ip-family hooks, so a host firewall
cannot see it. Three symbols change that and are in the floor:
`BRIDGE_NETFILTER` (bridged IP/ARP frames reach the ip-family hooks),
`NF_TABLES_BRIDGE` (the nf_tables `bridge` family, i.e. layer-2 filtering
without that redirection) and `NF_CONNTRACK_BRIDGE` (conntrack and IP defrag for
bridged traffic; its Kconfig calls it "a replacement for the `br_netfilter`
infrastructure"). `NF_TABLES_BRIDGE` is a tristate `menuconfig` that builds no
object of its own, so it takes the module-less shape.

Three the cx3576 vendor config carries stay out, all of which BOTH kernels
already have — a choice on merit, not a constraint. `BRIDGE_NF_EBTABLES` is the
legacy front-end and fails the same test as legacy xtables: nothing ships
`ebtables`, and `ebtables-nft` reaches the bridge family through the compat
expression instead (iptables 1.8.11 `nft.c:898`, `NFPROTO_BRIDGE` →
`xtables_bridge`). `BRIDGE_VLAN_FILTERING` has no consumer: mosd renders a plain
`Kind=bridge` netdev with no `VLANFiltering=`
(`pkgs/mosd/mosd/src/reconciler/network.rs:569`) and delivers VLANs as separate
`Kind=vlan` netdevs (`:566`). `BRIDGE_IGMP_SNOOPING` is not a neutral addition:
built, snooping is on by default per bridge, and with no querier on the segment
the bridge stops forwarding multicast to ports that sent no report, which is how
mDNS and SSDP discovery inside a container network breaks.

**The operator-observable asymmetry, which the record must carry.**
`br_netfilter` defaults `call-iptables` / `call-ip6tables` / `call-arptables` to
1 (`net/bridge/br_netfilter_hooks.c:1255-1257`) and registers its hooks once a
bridge exists. Built in (cx3576) that is the first bridge podman creates; as a
module (Debian) only once something loads it. So an ip-family FORWARD policy
reaches same-bridge container traffic on cx3576 and not on x64 today. The
capability is common; the default state is not, and policy has to set the
`bridge-nf-call-*` sysctls explicitly rather than inherit them.

### Why these firewall symbols

`iptables-nft` is the reference front-end: it is what Debian's `iptables`
package provides (trixie ships 1.8.11-2), and the kernel surface it needs is
the surface any nftables front-end needs plus one module. Read from the
upstream 1.8.11 tarball:

- `iptables/nft.c:440` -- `xtables_ipv4[]`, the builtin tables `raw`, `mangle`,
  `filter`, `security`, `nat`; `:898` `builtin_tables_lookup()` returns that
  table set for `AF_INET` and `AF_INET6`. So the front-end programs nf_tables
  in the **ip and ip6 families**: `NF_TABLES`, `NF_TABLES_IPV4`,
  `NF_TABLES_IPV6`.
- `iptables/nft.c:1502` -- `nftnl_expr_alloc("match")`, reached for every match
  with no native fast path, and `:1557` `nftnl_expr_alloc("target")`, reached
  for every target except `TRACE`. Both are `nft_compat` expressions.
- `iptables/nft.c:3658` -- `nft_compatible_revision()` asks the kernel over
  `NFNL_SUBSYS_NFT_COMPAT` which revision of a match or target it supports,
  before a rule can be built at all. Without `nft_compat` loaded, that probe
  answers nothing.
- `NFT_COMPAT` `depends on NETFILTER_XTABLES` (linux v6.1
  `net/netfilter/Kconfig`), so the `x_tables` core comes with it.

Stateful filtering and NAT are the second half of the request:
`NF_CONNTRACK` (the tracker), `NFT_CT` (the `ct` expression that reads it),
`NF_NAT` (the NAT core), `NFT_NAT` (snat/dnat) and `NFT_MASQ` (masquerade).
`NF_NAT_MASQUERADE` is deliberately NOT listed: `NFT_MASQ` `select`s it, so a
line for it would state a consequence rather than a requirement.

No legacy xtables symbol is listed. `IP_NF_IPTABLES` and its `IP_NF_*` tables
are the *other* back-end, and nothing in the image uses them --
`_out/x64/rootfs-packages.txt` ships no `iptables` and no `nftables` package,
and netavark 2.x "programs nftables and ships no iptables driver"
(`tests/netavark-kernel-config-test.sh`).

## Proposal

1. **`boards/common/mos-required.fragment`** gains three commented groups —
   four eBPF lines, eleven firewall lines and three bridge lines — each group
   carrying why it is floor and pointing at `docs/design/boards.md` §4 for the
   per-symbol table, the same division of labour the netavark block already
   uses.
2. **`verify/src/checks-kernel.ts`** gets a `module` that may be absent.
   `REQUIRED` becomes symbol + optional module + what it buys; the config check
   reads every entry, the modprobe check reads only the entries that name a
   module, and the message shape says which symbols carry no module rather than
   reporting them as resolved.
3. **`verify/src/checks-kernel.test.ts`** drives the new shape red: a
   module-less symbol removed from `/boot/config-*` must fail the config check
   by name, and the modprobe check must not conjure a module for it. Plus an
   agreement test: every symbol in `REQUIRED` is pinned `=y` in the fragment.
4. **`verify/src/checks-fixture.ts`** seeds the new symbols and modules, still
   as independent literals.
5. **`tests/netavark-kernel-config-test.sh`** gains assertion 4: every symbol
   it cites that the common fragment ALSO pins must be pinned there as `=y`,
   with a non-empty overlap required so the assertion cannot pass vacuously.
6. **cx3576**: `CONFIG_BPF_JIT=y` in the committed config, then rebuild the BSP
   kernel. `BPF_JIT` `depends on MODULES` and on `HAVE_CBPF_JIT || HAVE_EBPF_JIT`
   (v6.1 `kernel/bpf/Kconfig`); the board has `CONFIG_MODULES=y` and
   `CONFIG_HAVE_EBPF_JIT=y`, so the dependency is met.
7. **x64**: measured, not changed.
8. **Docs**: `docs/design/boards.md` gains §4.1 (eBPF), §4.2 (firewall),
   §4.3 (bridge) and §4.4 (the three buckets, measured);
   `docs/zh/design/boards.md` mirrors all four.

### `CONFIG_DEBUG_INFO_BTF` -- priced, and NOT adopted

Recommendation: leave it out of the floor for now.

- **It is free on x64** (`=y` in Debian's config) and **not free on cx3576**.
  `DEBUG_INFO_BTF` `depends on !DEBUG_INFO_SPLIT && !DEBUG_INFO_REDUCED`
  (v6.1 `lib/Kconfig.debug`), and the board config sets
  `CONFIG_DEBUG_INFO_REDUCED=y`. Adopting BTF means turning that off, i.e.
  compiling the whole tree with full DWARF, and adding `dwarves` (pahole) to
  `boards/cx3576/bsp/kernel/Dockerfile`, which installs only
  `libssl-dev libelf-dev python3 kmod patch` today.
- **What a device can do without it**: everything the image ships. crun's
  cgroup device filter, systemd's cgroup BPF programs, and any BPF program
  compiled against this exact kernel's headers all work with no BTF.
- **What it cannot do**: run a CO-RE binary -- `bpftrace`, `bcc`, anything
  built on libbpf's `vmlinux.h` -- because those relocate against the running
  kernel's BTF. The image ships none of them, and shipping one is a separate
  decision.
- **Measured, both kernels built and compared** (`make Image modules` on the
  same builder): `Image` 44,493,312 B -> 52,554,240 B, **+7.7 MiB (+18.1%)**;
  `modules.tar` 5,529,600 B -> 6,010,880 B (+8.7%); build step 683 s -> 1366 s
  (**2.0x**, measured while the package pools built on the same host, so part is
  contention); builder gains one package, `dwarves` (pahole 1.25). The `Image`
  number is what binds: it is permanent kernel RAM and it lands in BOTH A/B boot
  slots against `BOOT_SIZE_MIB=64` (`boards/cx3576/board.env`), taking headroom
  from about 21 MiB to about 13 MiB.

Adopting it later is two edits: drop `CONFIG_DEBUG_INFO_REDUCED`, add
`CONFIG_DEBUG_INFO_BTF=y`, and add `dwarves` to the kernel builder.

### The three buckets, measured

**Required now** — 18 symbols, §4.1–§4.3 of `docs/design/boards.md`. Checked
against the config the cx3576 build actually produces, exported after
`olddefconfig` rather than read off the committed input: all 18 come out `=y`.

**Deferred to the x64 kernel** — cx3576 has it, Debian does not. **Measured
empty.** Of the 101 symbols the built cx3576 kernel sets across the
BPF / netfilter / bridge / VLAN / veth namespaces, exactly two are not satisfied
by Debian's `6.12.107+deb13-amd64`:

- `CONFIG_NETFILTER_XTABLES_COMPAT` (cx3576 `=y`, Debian not set) — the 32-bit
  compat layer for x_tables ioctls; the image has no 32-bit userspace. Dropped
  on merit, not deferred.
- `CONFIG_DEBUG_INFO_REDUCED` (cx3576 `=y`, Debian not set) — a build-cost knob,
  and Debian's "off" is *more* debug information, not less capability.

So the x64-kernel task inherits no backlog of symbols from this one. What it
inherits is the removal of the constraint.

**Dropped on merit** — the legacy `IP_NF_*` back-end, the per-extension xt
matches and targets, `NF_NAT_MASQUERADE`, the three bridge symbols above, and
`DEBUG_INFO_BTF`.

**Owed, named rather than rounded up.** The floor's own `CONFIG_LSM="…,bpf"`
names an LSM cx3576 does not build. On 6.1
`BPF_LSM depends on BPF_EVENTS && BPF_SYSCALL && SECURITY && BPF_JIT`; the board
already had the first three (`UPROBE_EVENTS=y`, `PERF_EVENTS=y`, `SECURITY=y`),
and this task's `CONFIG_BPF_JIT=y` removed the fourth — so `CONFIG_BPF_LSM` is
now *available* on cx3576 and merely left at its default `n`, while on x64
Debian sets it `=y`. The same boot list therefore means different things on the
two boards. Nothing in the image uses a BPF LSM hook, so this task does not
enable it; the fix is one config line, and the alternative (dropping `bpf` from
the list) is a security-posture change belonging to
`docs/design/security-model.md`.

## Risks

- **The fragment is merged into a vendor tree.** A new `=y` line whose
  dependencies are unmet is dropped silently by `olddefconfig`; the Dockerfile's
  post-merge grep loop is what turns that into a build failure, and it already
  covers every fragment `=y` line. The cx3576 rebuild is the proof.
- **x64 is asserted, not built.** If a future Debian point release drops one of
  these to `is not set`, the image build still succeeds and only
  `bash verify/run.sh --verify` goes red. That is the intended failure mode and
  the reason the check exists.
- **A module-less symbol is invisible to the modprobe check by design.** The
  agreement test and the negative test are what keep "no module" from becoming
  "not checked".

## Scope

`boards/common/mos-required.fragment` (18 new `=y` lines),
`boards/cx3576/bsp/kernel/config/kernel-cx3576z.config` (one line),
`verify/src/checks-kernel.ts`, `verify/src/checks-kernel.test.ts`,
`verify/src/checks-fixture.ts`, `tests/netavark-kernel-config-test.sh`,
`docs/design/boards.md`, `docs/zh/design/boards.md`. Plus a cx3576 BSP kernel
rebuild and both boards' images composed and verified.

## Alternatives

- **Require the per-extension xt symbols** (`xt_conntrack`, `xt_MASQUERADE`,
  `ipt_REJECT`, ...) so that a concrete `iptables-nft` rule set works
  end-to-end. Rejected: which extensions a rule set names is policy, policy is
  out of scope, and `ipt_REJECT` lives under `IP_NF_IPTABLES` -- the legacy
  back-end nothing in the image uses.
- **Give eBPF a per-board declaration instead of a floor** (the
  `docs/design/security-model.md` §4 rule for board-specific capability).
  Rejected because it does not apply: both kernels can satisfy the eBPF floor,
  so the capability is board-neutral and belongs in the shared fragment. That
  rule would only bind if Debian refused a symbol, which the measurement shows
  it does not.
- **Adopt BTF now.** Rejected on evidence; see above.

## Outcome

Gates, all run on this branch at `abd5e727`:

- `(cd verify && bun test)` 1224/1224; `(cd build && bun test)` 869/869;
  `make docs-verify` green; `bash tests/netavark-kernel-config-test.sh` 51/51
  including the new assertion 4.
- The new module-less shape was driven RED twice by mutating the implementation,
  not only the fixture: making the config reader skip module-less symbols turns
  3 cases red, and making the modprobe check invent a module name for them turns
  17 red.
- **x64**: pool rebuilt at the commit stamp, image composed and assembled,
  `bash verify/run.sh --verify --board x64` **PASS 307/307**. The config check
  read all 25 symbols out of `/boot/config-6.12.107+deb13-amd64`, the modprobe
  check resolved all 17 modules, and its message names the 8 module-less symbols
  it deliberately skipped.
- **cx3576**: BSP kernel rebuilt twice (once per fragment revision), rootfs
  composed against it, image assembled,
  `bash verify/run.sh --verify --board cx3576` **PASS 410/410**.
- **The RTC bench item**: `CONFIG_RTC_DRV_HYM8563=y` **passes**. The kernel
  Dockerfile's config step is one `&&` chain, so the build could not have
  reached `make` with that grep failing; it did, twice
  (`#15 DONE 3.9s`, `#16 DONE 823.9s`).

## Left owed

- `CONFIG_BPF_LSM` on cx3576 — now unblocked by this task's `BPF_JIT`, still off
  by default, while the fragment's `CONFIG_LSM` names `bpf`. Not enabled here;
  see *The three buckets, measured*.
- Nothing was verified on hardware. Both boards are green against the image
  contract, which reads the assembled artefact; no device booted this kernel.

## Annotations

- 2026-09-03 -- user request recorded as the approval; implementation record,
  not a design gate.
- 2026-09-03 -- extended by the user: bridge symbols in scope, the fragment
  confirmed as the home, and x64's own kernel dispatched as a separate task.
  The three-bucket classification and the (measured empty) deferred list were
  added for that task to consume. Building the x64 kernel is not this task.
