# 设计：板级支持（BSP）契约

> [English](../../design/boards.md) | 中文
>
> 一块板如何接入 mos：它必须产出什么、操作系统构建消费什么、以及两者之间的硬性断言。
> 参考实现：`boards/cx3576/bsp`。

## 1. 分离规则

**BSP 层产出产物，操作系统构建消费产物。两边都不伸手进对方的构建里。**

Yocto 只允许出现在板卡目录内部（当厂商只以 Yocto layer 的形式提供 BSP 时，跑
`bitbake virtual/kernel virtual/bootloader` 并导出 deploy 目录），**绝不进入操作系统构建链**。

## 2. 板卡目录结构

一块板就是 `boards/` 下的一个目录。`board.env` 是它的定义，也是每块板唯一都有的成员；
其余按需出现。

```
boards/<name>/
├── board.env          # 分区布局、MOS_ARCH、console 与 cmdline 附加项、
│                      #   RAUC 后端、固件 / 射频 / hwinit 清单
├── overlay/           # 这块板往镜像根里追加的文件
├── boot.cmd           # U-Boot 启动脚本源码       （uboot 链板卡）
├── grub.cfg           # ESP 的 GRUB 配置          （UEFI 板卡）
├── hwinit/            # 该板的 systemd 硬件初始化 unit
└── bsp/               # 仅当这块板自己构建启动链时才有
    ├── Makefile       # make uboot | uboot-mos | kernel | rootfs | image
    ├── uboot/         # -> 引导程序二进制（u-boot-rockchip.bin）
    ├── kernel/        # -> Image、modules.tar、*.dtb
    │   ├── config/    # 内核配置基线（厂商 ikconfig + mos 追加项）
    │   ├── dts/       # in-tree 板级 dts（开源路线，不做 overlay 堆叠）
    │   └── patches/   # 有序的 *.patch 系列
    ├── init/          # hwinit unit 读取的板级硬件事实
    └── rootfs/        # 固件投放 + 演示/冒烟测试根文件系统（**不是**产品根）
```

启动链由上游支持的板卡（`boards/x64`，UEFI）**根本没有 `bsp/`**：只有 board.env、
grub.cfg 和一个 overlay，没有任何编译引导程序的东西——UEFI 机器的固件就提供了启动链，
内核直接用 Debian 的 `linux-image-amd64`，它作为 `mos-board-x64` 的 `Depends` 进入镜像。

## 3. 进入镜像的产物接口

| 产物 | 生产者 | 消费者 |
|---|---|---|
| `Image` + `modules.tar` + `*.dtb` | `bsp/kernel` | 板卡 producer 的 `render.sh` 把它们 staged 进 `mos-board-<name>`，包把 `modules.tar` 解到 `/usr/lib/modules`；镜像装配器把 `Image` 和 dtb 写进每个 boot 槽位，**两者都必须有** |
| 引导程序二进制 | `bsp/uboot` | 镜像装配器在板卡的 `UBOOT_SEEK_SECTOR` 处裸写；**拒绝调试 blob**——mos 镜像必须带 uboot-mos 变体 |
| `board.env` | `boards/<name>/` | 所有消费者：两个装配器、根文件系统驱动、RAUC 配置渲染器、verify。**当作数据读取，绝不 source**——没有任何环节把这个文件交给 shell |
| 固件 blob | `bsp/rootfs/firmware` | 只暂存 `BOARD_FIRMWARE_FILES` 点名的那些，因为**只有确认在运行时用到的集合才可以进入签名根** |

**模块与内核版本的耦合是绝对的**：根文件系统里的模块树必须匹配 BSP 内核版本，在镜像装配时断言。

## 4. 内核配置断言（每板一道 CI 门禁）

厂商 defconfig 从来不会把这些配对，所以每块板的内核构建都必须断言（对最终 `.config` 做
grep，不满足就让构建失败）：

- **启动路径**：`DM_INIT=y`、`DM_VERITY=y`、`BLK_DEV_DM=y`、`SQUASHFS=y`（含 zstd）、
  存储控制器编进内核、`OVERLAY_FS=y`。无 initramfs 的 verity 启动**在根挂载之前无法加载模块**，
  所以只能 `=y`，不能 `=m`。
- **运行时**：cgroup v2、containerd/netfilter 前置项、seccomp。
- **共享基线**：`boards/common/mos-required.fragment` 为所有板卡统一维护，
  在 olddefconfig 之前合并。上面这份清单，以及它同时断言的伪文件系统与安全选项
  （hugetlbfs、tracing、SELinux + LSM 启动列表），都以它为准。板卡特有的要求留在板卡自己的配置基线里。

**共同要求必须是两块板的内核都能满足的，否则它就不是共同要求。** x64 不构建内核：
它整包安装 Debian 的 `linux-image-amd64`，那份配置不归本项目管。所以下面每个符号在进入
fragment 之前，都先对着 Debian 实际发布的配置量过——组合出来的 x64 根里的 `/boot/config-*`；
同一份保证的 x64 那一半，由 `verify/src/checks-kernel.ts` 从构建产物上读回来
（那边 `=y` **或** `=m` 都算，因为 x64 带 `kmod` 和完整模块集，另有一道检查确认 `=m` 承诺的
`.ko` 真的被打进了根）。只有一块板能满足的符号不会被塞进 fragment 里在单板上偷偷生效；
按 `docs/design/security-model.md` 第 4 节，它应该变成**逐板声明的能力**，用到它的流程在缺失的板上
**显式拒绝**。下面两组都不需要走那条路：Debian 十五个全都满足。

### 4.1 eBPF 运行时

这不是诊断用的可选项。`crun` 把 cgroup v2 的设备控制器实现为一个
`BPF_PROG_TYPE_CGROUP_DEVICE` 程序——crun 1.29.1 `src/libcrun/ebpf.c:490,496`（加载）、
`:423`（attach）、`src/libcrun/cgroup-systemd.c:1482,1501`（每个容器的调用方）——
而在 cgroup v2 上，**那个程序就是设备策略本身**，没有 `devices` 控制器文件可写。
这四个都是没有自己模块的 bool。

| 符号 | 买到了什么 | Debian |
|---|---|---|
| `CONFIG_BPF` | 所有程序运行其上的 eBPF 内核 | `=y` |
| `CONFIG_BPF_SYSCALL` | `bpf(2)` 系统调用；没有它任何程序都装载不进去 | `=y` |
| `CONFIG_BPF_JIT` | 把这些程序编成本地代码，而不是解释执行 | `=y` |
| `CONFIG_CGROUP_BPF` | crun 的 cgroup v2 设备过滤器，也就是那里的设备策略 | `=y` |

唯一的缺口是 `CONFIG_BPF_JIT`：cx3576 原本是 `# CONFIG_BPF_JIT is not set`。它
`depends on MODULES` 且 `depends on HAVE_CBPF_JIT || HAVE_EBPF_JIT`（v6.1
`kernel/bpf/Kconfig`），这块板两个都有。

**`CONFIG_DEBUG_INFO_BTF` 是刻意不放进下限的，而且价钱是实测的、不是估的。** Debian 设为 `=y`，
所以在 x64 上是白送的，在 cx3576 上不是：它 `depends on !DEBUG_INFO_SPLIT && !DEBUG_INFO_REDUCED`
（v6.1 `lib/Kconfig.debug`），而板卡配置里是 `CONFIG_DEBUG_INFO_REDUCED=y`，所以采纳它意味着
整棵树带完整 DWARF 编译，并且要给 `boards/cx3576/bsp/kernel/Dockerfile` 加上 `dwarves`（pahole）。
两个内核都构建出来对比过：

| | 当前下限 | 开 BTF | 差值 |
|---|---|---|---|
| `Image` | 44,493,312 B（42.4 MiB） | 52,554,240 B（50.1 MiB） | **+7.7 MiB，+18.1%** |
| `modules.tar` | 5,529,600 B | 6,010,880 B | +470 KiB，+8.7% |
| `make Image modules` | 683 s | 1366 s | **2.0×** |
| 构建容器包 | `libssl-dev libelf-dev python3 kmod patch` | 再加 `dwarves`（pahole 1.25） | 一个包 |

真正有约束力的是 `Image` 那一行。它是 `=y` 的负载——设备上**常驻内核内存**，而且在 A/B **两个**
启动槽里各占一份，对应 `BOOT_SIZE_MIB=64` 的分区（`boards/cx3576/board.env`）：余量从大约 21 MiB
掉到大约 13 MiB。2.0× 的构建时间是在同一台机器同时构建包仓库时测的，其中有一部分是资源争抢；
这里主张的是方向和量级，不是第二位有效数字。

没有 BTF，设备照样能跑镜像里发布的一切——crun 的设备过滤器、systemd 的 cgroup BPF 程序，
以及任何按这个内核的头文件编出来的程序。跑不了的是 CO-RE 二进制：`bpftrace`、`bcc`，
以及一切建立在 libbpf 的 `vmlinux.h` 之上、要按运行中内核的 BTF 做重定位的东西。
镜像一个都没带。以后要采纳是三处改动——去掉 `DEBUG_INFO_REDUCED`、加
`CONFIG_DEBUG_INFO_BTF=y`、加 `dwarves`——应该和第一个真正发布 CO-RE 工具的改动一起做。

### 4.2 防火墙后端

一个 nftables 前端所需要的内核侧，参照物取 `iptables-nft`，因为那是 Debian 的 `iptables`
包提供的兼容面（trixie 发布 1.8.11）。引用都指向上游 1.8.11 的源码包。

| 符号 | 买到了什么 | Debian |
|---|---|---|
| `CONFIG_NF_TABLES` | 所有规则写进去的 nf_tables 内核（`nft.c:440` `xtables_ipv4[]`） | `=m` `nf_tables` |
| `CONFIG_NF_TABLES_INET` | netavark 把整张表放进去的 inet 族 | `=y` |
| `CONFIG_NF_TABLES_IPV4` | `iptables-nft` 建立五张内建表所用的 ip 族（`nft.c:898` `builtin_tables_lookup`） | `=y` |
| `CONFIG_NF_TABLES_IPV6` | `ip6tables-nft` 建表所用的 ip6 族（同一处查找，`AF_INET6`） | `=y` |
| `CONFIG_NFT_COMPAT` | 前端为一切没有原生形式的匹配/目标所发出的 xt 表达式（`nft.c:1502` `"match"`、`:1557` `"target"`），以及它的 revision 探测所查询的对象（`nft.c:3658`，`NFNL_SUBSYS_NFT_COMPAT`） | `=m` `nft_compat` |
| `CONFIG_NETFILTER_XTABLES` | `NFT_COMPAT` 所 `depends on` 的 x_tables 内核（v6.1 `net/netfilter/Kconfig`） | `=m` `x_tables` |
| `CONFIG_NF_CONNTRACK` | 连接跟踪，有状态过滤匹配的那个状态 | `=m` `nf_conntrack` |
| `CONFIG_NFT_CT` | 读取该状态的 `ct` 表达式 | `=m` `nft_ct` |
| `CONFIG_NF_NAT` | NAT 内核 | `=m` `nf_nat` |
| `CONFIG_NFT_NAT` | snat 与 dnat 表达式 | `=m` `nft_nat` |
| `CONFIG_NFT_MASQ` | masquerade 表达式 | `=m` `nft_masq` |

有三样是刻意不列的。**遗留的 `IP_NF_*` 后端**——镜像里没有任何东西用它；镜像既不带
`iptables` 也不带 `nftables` 包，而 netavark 2.x 直接编程 nftables、根本没有 iptables 驱动
（`tests/netavark-kernel-config-test.sh`）。**逐个扩展的 xt 匹配与目标**
（`xt_conntrack`、`xt_MASQUERADE`、`ipt_REJECT` 等）——规则集点名哪些扩展属于**策略**，
这道下限只让内核**有能力**，不替它决定强制什么；cx3576 为 docker 选项集所需的那些，
仍旧断言在它自己的 Dockerfile 里。以及 `NF_NAT_MASQUERADE`，它由 `NFT_MASQ` `select`，
写一行只是在陈述后果而不是要求。

两道下限是有交集的：`tests/netavark-kernel-config-test.sh` 会断言它引用的每个符号，
只要 fragment 也提到，就必须在那里写成 `=y`——这样共享文件里的弱化说法就无法躲在
cx3576 自己的 Dockerfile 循环后面。

### 4.3 网桥过滤

podman 把每个容器的 veth 都挂在同一座 Linux 网桥上，而同一座桥上两个容器之间的流量是
**在二层被交换的**——它根本到不了 ip 族的钩子，所以主机防火墙看不见它。有三个符号是让它
可见的前提。

| 符号 | 买到了什么 | Debian |
|---|---|---|
| `CONFIG_BRIDGE_NETFILTER` | 让被桥接的 IP 与 ARP 帧进入 ip 族钩子，于是一套防火墙同时覆盖容器间流量（`net/Kconfig`：“let arptables resp. iptables see bridged ARP resp. IP traffic”） | `=m` `br_netfilter` |
| `CONFIG_NF_TABLES_BRIDGE` | nf_tables 的 `bridge` 族——在二层直接过滤桥接帧，不必把它重定向进 ip 钩子 | `=m` |
| `CONFIG_NF_CONNTRACK_BRIDGE` | 桥接流量的连接跟踪与 IP 分片重组，没有它 `ct state` 在那里无法回答；它自己的 Kconfig 称之为“br_netfilter 基础设施的替代品” | `=m` `nf_conntrack_bridge` |

`CONFIG_NF_TABLES_BRIDGE` 没有自己的目标文件：它是一个 tristate 的 `menuconfig`，族本身编进
`nf_tables.ko`，子菜单里放的是逐表达式的模块（`nft_meta_bridge`、`nft_reject_bridge`），那些属于策略。
它在 `verify/src/checks-kernel.ts` 里和 inet/ip/ip6 族的 bool 取同一种「无模块」形状。

**操作者会观察到什么，而且两块板并不一样。** `br_netfilter` 把它的
`call-iptables` / `call-ip6tables` / `call-arptables` 开关**默认全置 1**
（`net/bridge/br_netfilter_hooks.c:1255-1257`），而它的钩子在出现第一座网桥时才注册。
编进内核时——板卡自建内核就是这样——那发生在第一座桥建立的瞬间；作为模块时（Debian 那样），
只有某个东西加载了它才发生。所以在 cx3576 上，从 podman 建出网络那一刻起，ip 族的 FORWARD
策略就作用于同桥容器流量，而在今天的 x64 上不会。**能力是共同的，默认状态不是**：针对一块板
写的 DROP 策略，在另一块板上行为不同。要写这类策略的人必须显式决定 `bridge-nf-call-*` 这几个
sysctl，而不是继承它们。

cx3576 厂商配置里另外三个网桥符号**刻意不进下限**，而且这三个两块板都已经有——所以这是**按理据
取舍**，不是被约束逼的：

- `CONFIG_BRIDGE_NF_EBTABLES`——遗留的 ebtables 前端，适用与遗留 xtables 相同的检验。镜像不带
  `ebtables`，而且现代前端不需要它：`ebtables-nft` 通过上面的 nf_tables compat 表达式来编程
  bridge 族（iptables 1.8.11 `nft.c:898`，`NFPROTO_BRIDGE` → `xtables_bridge`），这已经由
  `NF_TABLES_BRIDGE` 与 `NFT_COMPAT` 覆盖。
- `CONFIG_BRIDGE_VLAN_FILTERING`——VLAN 感知网桥。mosd 渲染的是不带 `VLANFiltering=` 的纯
  `Kind=bridge` netdev（`pkgs/mosd/mosd/src/reconciler/network.rs:569`），VLAN 走的是独立的
  `Kind=vlan` netdev（`:566`），镜像里没有任何东西要求网桥感知 VLAN。两块板今天都有它，
  所以以后要采纳只需加一行 fragment，别无成本。
- `CONFIG_BRIDGE_IGMP_SNOOPING`——组播侦听，而且它**不是**一个中性的增项：一旦编进去，它对每座
  桥默认开启；网段上没有 querier 时，网桥会停止把组播转发给没有发过 report 的端口——容器网络里
  mDNS 与 SSDP 发现失效通常就是这么来的。镜像不需要侦听，所以下限不要求这个行为变更。

### 4.4 对着 Debian 量出来的三档：要求、推迟、放弃

x64 以后会自建内核，届时「Debian 必须能满足」这条约束就不再成立。所以每个候选符号都对着
Debian 实际发布的配置量过，并归入三档之一；中间那一档是**给后续任务直接消费的清单**，
免得它把这些测量重做一遍。

**现在就要求**——两块板都满足。第 4.1–4.3 节的全部十八个符号。是对着 cx3576 构建**实际产出**的
配置验证的（在 `olddefconfig` 之后导出，而不是提交进去的输入）：十八个全部为 `=y`。

**推迟到 x64 自建内核**——cx3576 有、Debian 没有。**实测为空。** 在 BPF / netfilter / bridge /
VLAN / veth 这几个命名空间里，cx3576 构建产物设置的 101 个符号中，只有两个不被 Debian 的
`6.12.107+deb13-amd64` 满足，而且都不是值得带走的能力：

| 符号 | cx3576 | Debian | 为什么不推迟 |
|---|---|---|---|
| `CONFIG_NETFILTER_XTABLES_COMPAT` | `=y` | 未设置 | 64 位内核上 x_tables ioctl 的 32 位兼容层；镜像没有 32 位用户态。按理据放弃 |
| `CONFIG_DEBUG_INFO_REDUCED` | `=y` | 未设置 | 一个构建成本开关，不是能力——而且 Debian 的「关」意味着调试信息**更多**，不是能力更少 |

所以 x64 自建内核那个任务**不从本任务继承任何符号积压**。它继承到的是约束的解除：以后往下限里
加符号，不必再先过 Debian 那一关。

**按理据放弃**——两块板都能满足，但下限不要求：遗留的 `IP_NF_*` 后端、逐扩展的 xt 匹配与目标、
`CONFIG_NF_NAT_MASQUERADE`（`NFT_MASQ` 的 `select`）、第 4.3 节那三个网桥符号，以及
`CONFIG_DEBUG_INFO_BTF`（第 4.1 节，已定价）。

**欠账，点名而不是四舍五入。** 下限自己的 `CONFIG_LSM="…,bpf"` 点名了一个 cx3576 并没有构建的
LSM。在 6.1 上 `BPF_LSM depends on BPF_EVENTS && BPF_SYSCALL && SECURITY && BPF_JIT`
（`kernel/bpf/Kconfig`）；这块板前三个本来就有，而第 4.1 节的 `CONFIG_BPF_JIT=y` 拿掉了第四个——
所以 `CONFIG_BPF_LSM` 现在在 cx3576 上**已经可选**，只是停留在默认的 `n`。在 x64 上那个 `bpf`
条目是真的（Debian 设了 `CONFIG_BPF_LSM=y`），于是同一份启动列表在两块板上含义不同。镜像里没有
任何东西用到 BPF LSM 钩子，所以本任务不打开它；补上这个缺口现在只是一行配置，而另一条路——
把 `bpf` 从启动列表里去掉——是安全姿态的改动，属于 `docs/design/security-model.md`。

## 5. U-Boot 要求（uboot 链板卡）

`CONFIG_BOOTCOUNT_LIMIT`、冗余环境（`CONFIG_ENV_OFFSET_REDUND`）、
`CONFIG_FIT` + `CONFIG_FIT_SIGNATURE`、`CONFIG_SYS_BOOTM_LEN ≥ 0x8000000`、
RAUC BOOT_ORDER 握手脚本，以及一条救援路径（cx3576：恢复键 → rockusb，启动失败 → rockusb 回退）。

启动脚本和 RAUC 的 `system.conf` 由**同一个源**生成——模板加上板卡定义是唯一真源——以防漂移。

## 6. 内核支持策略

启动路径决定了下限。根是一个自带 dm-verity 哈希树的 squashfs，由内核命令行上的一张
`dm-mod.create=` 表描述，其上是 Debian trixie + systemd 的用户态。

| 层级 | 内核 | 支持程度 |
|---|---|---|
| 1 | >= 5.10 LTS | 完整支持（主流厂商 BSP：RK 5.10/6.1、NXP 5.15/6.6、TI 6.1） |
| 2 | 5.4 | 逐板评估；预期需要少量补丁，但没有结构性工作 |
| — | 4.x | **不支持。** 可选方案依次是：(a) 抬升厂商内核，或把该 SoC 主线化；(b) 为该板另开一套 profile，跑在更小的基座上、mos 服务以容器形式运行——**这等于放弃本文其余部分所假定的签名 A/B verity 根** |

## 7. 新增一块板的清单

1. 建 `boards/<name>/` 和 `board.env`；只有当这块板自己构建启动链时才加 `bsp/`。
   定义必须先通过板卡定义 schema lint：
   `bash verify/run.sh --lint boards/<name>/board.env`
2. **内核**：厂商树 + `mos-required.fragment`，在 olddefconfig 之前合并，
   然后对构建出的 `.config` 逐条断言每个 `=y`。缺少 mos-required 选项就让构建失败。
3. **U-Boot**：第 5 节的配置；烧录验证启动密钥。UEFI 板卡这些全都不需要，
   改为为 ESP 提供一份 `grub.cfg`。
4. **先走冒烟路径**——用现成或厂商镜像——把硬件带起来验证过，再去做完整镜像。
5. 根文件系统从包仓库组合出来（`rootfs/compose/`），板卡自己的内容作为
   `mos-board-<name>` 交付；镜像用 `bash build/run.sh --mkimage-cx3576`（或 `--mkimage-x64`）装配，
   对 `bash verify/run.sh --verify --board <name>` 跑绿，然后在硬件上验 apid 存活。
   注意 `/healthz` **只证明 apid 进程在监听**，不证明 mosd 或板上任何其他服务是健康的。
6. **断电试验台跑过之后**，这块板才能被称为受支持。

## 8. 当前板卡

| 板卡 | 架构 | 启动链 | 状态 |
|---|---|---|---|
| cx3576（CX3576-Z，RK3576） | arm64 | eMMC 扇区 64 上的 U-Boot -> `boot.scr` -> 对 `Image` + `rk3576-src.dtb` 执行 `booti` | BSP 构建 `uboot-mos` 与内核；第 4 节断言集在内核构建中强制执行，RAUC `BOOT_ORDER` 握手已在 `boot.cmd` 中实现。**`CONFIG_FIT_SIGNATURE`（第 5 节）在整棵树里没有任何地方配置** |
| x64（通用 UEFI） | amd64 | UEFI 固件 -> 单一静态 ESP 上的 GRUB -> 该槽位自己的 boot 分区 | QEMU/CI 基准。没有 `bsp/`，**这是设计如此，不是遗漏** |
