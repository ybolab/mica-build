# 调研:面向 SigmaStar SSD202D 的轻量版 mos —— 可行性草案

> **性质与意图。**这是草案,不是设计记录,也不是已批准的计划。文中没有任何
> 内容已实现,没有建立分支,也没有开出任务或计划记录。它的用途是被反驳:
> 它写明一个 mos 衍生系统在 SSD202D 上必须放弃什么、能保留什么,以及哪些
> 硬件事实决定它。
>
> **测量基础。**第 2、3 节的每一个尺寸都读自 `5d0dca57` 时的当前树,取自
> `_out/s905x5m-current` 与 `_out/boards` 的构建产物 —— 已出货的四块板里
> 最小的一块,这样选是为了让数字站在反对本文的一侧。遵循本仓库的文档纪律:
> 指名文件,不引行号。
>
> **硬件基础。**没有。第 1 节列出本文假设的 SSD202D 事实;其中没有一条经过
> datasheet、SigmaStar SDK 或实板的确认。第 1 节之后的一切,可靠性不会超过
> 第 1 节。
>
> **请先读第 3 节。**flash 器件不是本设计的一个参数,它是选择哪一套设计的
> 那个岔口。

## 1. 未经核实的前提

| # | 前提 | 假设为 | 若不成立 |
|---|---|---|---|
| 1.1 | 核心 | 双核 Cortex-A7,**ARMv7 32 位** | mos 没有 32 位目标,`MOS_ARCH` 只有 `amd64`/`arm64` |
| 1.2 | 内存 | **封装内 128 MB**,还要扣除 MMA/VPU 保留 | **在 128 MiB flash 下这是决定性前提** —— 见 3.5 节 |
| 1.3 | Flash | 16 MiB SPI-NOR **或** 128 MiB SPI-NAND | **选择整个方案** —— 见第 3 节 |
| 1.4 | SDK 内核 | 4.9.84(infinity2m) | 改变 6.2 节的 backport |
| 1.5 | eFuse 安全启动锁定后,ROM 下载模式仍可进入,且只接受签名镜像 | **在 16 MiB 下这是生死攸关的** —— 见 5.1 节。在 128 MiB 下它只是常规维护。 |

哪一条前提是决定性的,取决于 1.3,且只取决于 1.3:

| Flash | 决定性前提 | 原因 |
|---|---|---|
| 16 MiB | **1.5** | 内核无法做 A/B,所以一次失败的内核更新没有回退,恢复契约是唯一的兜底。若 ROM 下载路径在 eFuse 锁定后关闭,就没有兜底。 |
| 128 MiB | **1.2** | flash 不再是约束。MMA 保留之后剩下的 DRAM 能否装下 Debian 与 systemd,变成了决定第 3 节那条便宜路线是否存在的问题。 |

对 16 MiB 的情形,1.5 的三种结果各自强制什么:

| eFuse 锁定后的 ROM 下载模式 | 后果 |
|---|---|
| 可进入,且只接受签名镜像 | 恢复通道既可用又安全。第 4 节成立。 |
| 完全关闭 | 没有恢复。内核必须 A/B,代价见 5.1 节。 |
| 可进入,但接受任意镜像 | 恢复可用,但它同时是一个面向物理接触者的安全启动绕过。威胁模型必须显式接受。 |

## 2. 为什么现有 mos 镜像不是起点

实测,arm64,dev 配置:

| 产物 | 大小 | 对照 16 MiB |
|---|---|---|
| `root/rootfs.img`(squashfs + verity) | 76.6 MiB | 整块 flash 的 4.8 倍 |
| `kernel/support.img`(模块、固件、regdb) | 14.2 MiB | 整块 flash 的 89% |
| `kernel/boot.itb`(签名 FIT) | 63.7 MiB | 4.0 倍 |
| ├ 内核 `Image`,在 FIT 内未压缩 | 31.5 MiB(gzip 后 12.5 MiB) | |
| └ `initramfs.cpio`,未压缩 | 32.1 MiB | |
| 单个部署(`.mosupd`) | 154.5 MiB | 9.7 倍 |

根在 squashfs 之前的实际占盘是 260 MiB。三个最大贡献者是:`mos-podman`
83.5 MiB —— 占整个镜像三分之一、五个 mos Rust 二进制合计 40.1 MiB、以及
systemd 栈(`systemd`、`udev`、`libsystemd-shared`)30.9 MiB。

由此得到两条结论,其中只有第二条与 Debian 有关:

1. **仅 `support.img` 与内核就是 26.7 MiB。**两者都是 BSP 产出。更换用户态
   发行版不会让其中任何一个变小。因此 16 MiB 目标首先是一个内核配置问题,
   其次才是 rootfs 问题。
2. Debian 用户态缩不到 16 MiB 这一档。`dpkg`、`perl-base`、完整
   `coreutils`、`bash` 和 `passwd` 是约 48 MiB 安装态,busybox 用约 1 MiB
   全部替代。这确实支持 Buildroot —— 但 Buildroot 动不了结论 1,单靠它也
   放不进 16 MiB。

但这**不**意味着 Debian 在这颗芯片上不可用。第 3 节测量那条线实际落在哪里。

## 3. 岔口:16 MiB 还是 128 MiB

### 3.1 门槛在于 Debian 与 systemd 能否存活

由同一份尺寸报告推导,用到其中观测到的两个系数:dpkg 声明 365.3 MiB 安装态
的那棵树,实际占盘 260 MiB(**0.712** —— 硬链接、去重、去文档),而那棵树
打包成 76.6 MiB 的 squashfs(**3.39×**)。

砍掉 podman、只为 podman 与 netavark 存在的 netfilter 集、以及 MQTT 对,
保留 Debian、systemd、mosd 与 apid:

| 组合 | dpkg | 实际占盘 | squashfs |
|---|---|---|---|
| 无 podman / netfilter / MQTT | 245.1 MiB | 174.4 | **51.4 MiB** |
| + Rust `strip` 与 LTO(mosd/apid/deploy 的 27.0 MiB 减约 50%) | 231.6 MiB | 164.8 | **48.6 MiB** |
| + armv7 相对 arm64(小约 12%) | | | **~42.7 MiB** |

**一个携带 systemd、mosd 与 apid 的 Debian armv7 只读根,大约 43–50 MiB。**
128 MiB 装得下它的两份;16 MiB 装不下它的十分之一。这就是门槛,本文其余
内容都动不了它。

### 3.2 这个岔口真正的代价

| | 16 MiB | 128 MiB |
|---|---|---|
| 用户态 | Buildroot + musl + busybox | **Debian armhf 不变** —— deb 池、解析器与 APT 组合全部存活 |
| init | finit 或 s6;reconciler 层重写 | **systemd 不变**;reconciler 原样 |
| mosd / apid / deploy | 合成单一 multi-call 二进制 | 三个二进制照旧 |
| mos 主线上的 `ServiceManager` 接缝 | 必须开,否则两棵树永久分叉 | 不需要 |
| 组织形式 | 一条永久分叉的分支 | **`boards/ssd202d/` 加一个 profile** |
| 179 份 pin 死的包描述、约 3,900 行 deb 形态构建代码、约 20 个产出者 | 丢弃 | 保留 |

16 MiB 那条路是在造一个借用 mos 契约的新操作系统。128 MiB 这条路是给 mos
加一块板。差的不是 8 倍 flash,是一个数量级的工程量,以及维护两棵树的全部
长期成本。

在 128 MiB 上,工作收缩为四项:一个 armv7 目标(`MOS_ARCH=armhf` 加 Rust
`armv7-unknown-linux-gnueabihf`)、`boards/ssd202d/`、一套 MTD/UBI 存储布局,
以及一个排除 podman 与 MQTT 的 profile。

有一件事要核实而不是假定:armhf 是 Debian trixie 的发布架构,但它在 trixie
之后的支持期限在 Debian 内部一直是个开放问题。对一个现场寿命很长的产品,
这值得在钉住包池之前弄清楚,而不是之后。

### 3.3 128 MiB 意味着 SPI-NAND,而这是好事

128 MiB 即 1 Gbit,是 SPI-NAND 的标准容量;NOR 到这个容量不是一个合理的
BOM。后果大多是有利的:

- UBI 变成必需的,用于坏块管理与磨损均衡,但 `ubiblock` 把静态 UBI 卷暴露
  为只读块设备,而 squashfs + dm-verity 叠在 `ubiblock` 之上是成熟组合。
- UBI 卷更新是原子的,比在裸 NOR 偏移上做 A/B 干净。
- DATA 跑 UBIFS,而不是 NOR 上的 JFFS2。
- 它离 mos 的模型**更近**而不是更远:过了 `ubiblock` 之后又是块设备,不再是
  裸偏移。

它带来的新工作:NAND 出厂即带坏块并会新增,UBI 的开销占容量的百分之几;
IPL/SPL 所在区域必须能被 ROM 带坏块跳过地读取,这是 SigmaStar 的 bring-up
细节。

如果器件是 128 MiB eMMC 而非 NAND,GPT 直接适用,mos 的分区模型几乎原样
转移 —— 但 128 MiB 的 eMMC 很罕见,所以本文按 NAND 假设。

### 3.4 128 MiB 的布局,以及它作废了什么

| 方案 | 构成 | DATA |
|---|---|---|
| A —— mos 原生的三组件 | boot 1.5 + FIT 2×3 + support 2×8 + root 2×48 = 119.5 | **8.5 MiB** |
| B —— 模块内建,去掉 support 镜像 | boot 1.5 + FIT 2×5 + root 2×48 = 107.5 | **20.5 MiB** |
| C —— B 再精简根(去 bluez/alsa,用 dropbear 替 OpenSSH) | boot 1.5 + FIT 2×5 + root 2×40 = 91.5 | **36.5 MiB** |

方案 A 的 DATA 不可用,因此 **6.4 节的模块内建在 128 MiB 上依然成立**:
去掉 support 镜像在这里同样买回 12 MiB。

第二份 FIT 约 5 MiB,即**器件的 3.9%**。用 3.9% 换回完整的内核回退不是一个
接近的决定,而它作废了 16 MiB 设计的大部分:

| 在 128 MiB 上作废 | 原在 |
|---|---|
| 单内核、内核不可回退 | 第 4 节 |
| 每槽一份的签名 `mos_rootfs_desc`,以及 U-Boot 那次额外的 `rsa_verify()` | 6.3 节 |
| 把离线刷新当作恢复契约 | 第 4 节、7.3 节 |
| **回退进未测组合这个风险** | 7.2 节 —— 内核做 A/B 时它不可能发生 |

roothash 回到签名 FIT 的 cmdline,这是最简形式:一把签名同时认证内核、dtb
与 roothash。

### 3.5 在 128 MiB 上依然成立的

- **前提 1.2 变成决定性的那一条。**systemd、journald、udev、dbus、mosd 与
  apid 合计常驻粗估 60–80 MiB。若 MMA 保留 32 MiB,还剩 96 MiB,紧但可信;
  若保留 64 MiB,只剩 64 MiB,大概率不行。flash 不再是约束,DRAM 接手。
- **模块内建**(6.4 节),理由是上面的预算。
- **流式安装。**mos 原生的采集会把整个部署暂存在 DATA 的
  `/mos/updates/{staging,downloads,verified}` 下。这里一份部署是 FIT 5 +
  root 48 = **53 MiB**,而 DATA 只有 20–36 MiB。装不下。安装路径必须流式写进
  非活跃槽并就地校验,内核暂存在 RAM —— 7.3 节的顺序不是 16 MiB 的权宜,
  它在两种容量下都是约束。

第 4 到 10 节描述的是 **16 MiB 方案**。凡是同时管辖 128 MiB 情形的章节,
都会写明。

## 4. 16 MiB 模型

一个内核、两个根,以及一种被允许不可逆的更新。

| | 用户态更新 | 内核更新 |
|---|---|---|
| 写入 | 非活跃 rootfs 槽 | 内核区**以及**一个 rootfs 槽 |
| 回退 | 有 —— 三次试启动,保留回退项 | **无** |
| 失败时 | 自动回退到另一槽 | **离线刷新** |
| 频次 | 常规 | 少见,灰度发布 |

这是对[部署生命周期](../../design/updates.md)的有意背离 —— 后者基于独立签名的
kernel/support/root 组件,发布 root-only、kernel-only 和 combined 三种更新。
这里没有独立组件,也没有对象复用:内核变更即整机变更。收益不是"为简化而简化",
而是 16 MiB 器件上的 2.5 MiB,以及删掉 `deployments.rs` 里最难的一块 ——
判定退役部署与新进部署之间还共享哪些对象的那部分。

在 128 MiB 上这一整节都不适用,见 3.4 节。

### 4.1 这比 mos 当前多付出的代价

- 每次内核更新都是全量下载,因为没有东西可复用。差分传输能挽回带宽,挽回
  不了 flash 写入 —— 写入永远是整个槽。
- 内核更新之后、下一次用户态更新之前,设备处于**单槽运行、完全没有回退**
  的状态(7.2 节会作废另一槽)。7.4 节给出低成本的收口办法。
- 一次失败的内核更新等于一次上门。只有在内核更新做灰度、绝不整批推送的
  前提下,这才可以接受。

## 5. 16 MiB Flash 布局

| 区域 | 大小 | 说明 |
|---|---|---|
| IPL | 64 KiB | 由 mask ROM 加载 |
| IPL_CUST | 64 KiB | 签名 |
| U-Boot | 384 KiB | 签名;携带 FIT 与描述符的公钥 |
| uenv A/B | 2 × 64 KiB | 冗余引导记录,带 CRC |
| rootfs 描述符 A/B | 2 × 4 KiB | 签名,见 6.3 节 |
| FIT | 2,560 KiB | **单份**:内核 + dtb,RSA-2048 |
| rootfs A | 5,120 KiB | squashfs-xz + verity 哈希树 |
| rootfs B | 5,120 KiB | |
| DATA | 2,936 KiB | UBIFS 或 JFFS2 |
| | **16,384 KiB** | |

5.0 MiB 的 rootfs 是本节其余部分必须活在里面的那个数字。最小可用根的估算是
4.0–4.5 MiB,余量约 0.5 MiB,而它取决于一个决定:**mosd、apid 与部署代理
必须构建成单一的 multi-call 二进制。**三个独立 Rust 二进制各自带一份 std 和
共享依赖图;今天出货的五个二进制合计 40.1 MiB 安装态正是这个原因。一个带子
命令的二进制,交叉编译到 armv7 并链接 musl,开 `lto = "fat"`、
`opt-level = "z"`、`panic = "abort"` 与 `strip = true`,估算 squashfs 后
2.0–2.5 MiB。

这个估算是本文最弱的数字,应当是 P1 第一个用实测替换掉的东西。

当前树的两个事实与它相关:`pkgs/mosd/Cargo.toml` 没有声明
`[profile.release]`,deb 产出者跑的是不带 strip 步骤的裸 `cargo build
--release`,因此出货二进制带着符号表 —— `mosd` 的 x86_64 版实测 8.93 MB,
`strip` 后 6.77 MB。这部分收缩不需要本项目,mos 主线今天就能拿,而 3.1 节
已经把它算进去了。

### 5.1 若前提 1.5 不成立

内核回到 A/B。第二份 FIT 要 2,560 KiB,只能从两个 rootfs 槽和 DATA 里出:
rootfs 各降到 4,096 KiB,DATA 降到 2,432 KiB。用 4.0 MiB 的槽去装
4.0–4.5 MiB 的估算,那不是预算,是掷硬币 —— 此时 128 MiB SPI-NAND 不再是
"更可取"而是答案本身,这正是第 3 节的论证从第二条路径再次抵达。

## 6. 启动链

```
IPL(mask ROM)
 └─ IPL_CUST                     签名;公钥哈希在 eFuse             [前提 1.5]
     └─ U-Boot                   签名;内嵌 FIT 与描述符公钥
         ├─ 读冗余 uenv 记录,选择 rootfs 槽
         ├─ 加载前递减并持久化试启动计数
         ├─ 验证该槽的 rootfs 描述符,取出 roothash
         └─ 验证并引导那份唯一的 FIT
             └─ bootargs = 固定部分 + dm-mod.create=<描述符给出的 verity 表>
                 └─ root=/dev/dm-0,squashfs,只读
                     └─ finit 或 s6 之下的单一 multi-call Rust 二进制
```

无 initramfs、无 support 分区、无 `/lib/modules`、无 systemd。

在 128 MiB 上最后两行变化 —— systemd 与三个二进制回来 —— 且 6.3 节退出,
但 6.1、6.2 与 6.4 节在两种容量下都成立。

### 6.1 不要 initramfs

`dm-mod.create=` 在内核内建立 verity 映射并直接引导 `root=/dev/dm-0`。这
去掉了 32.1 MiB 的 initramfs、`pkgs/mos-boot/initramfs.sh` 组装的那份早期
用户态 ELF 闭包,以及 `mos-init` 本身。在一颗 128 MB 的器件上,这不是优化,
而是启动路径能装下的前提。

### 6.2 只做一个内核 backport,不是两个

`dm-init.c` 属于 Linux 5.1,是一个自包含文件。backport 到 4.9 的工作量很小。

另一条路 —— 用 `DM_VERITY_VERIFY_ROOTHASH_SIG` 在内核内认证 roothash ——
属于 Linux 5.4,会牵进 keyring 与 PKCS#7 一整套。6.3 节使它在 16 MiB 上不必要;
而把 roothash 放回签名 FIT 的 cmdline,使它在 128 MiB 上也不必要。

### 6.3 roothash 从哪里来 —— 仅 16 MiB

一个内核配两个根,意味着一份 FIT cmdline 对应两个 roothash,所以 roothash
不能签进 FIT。它走一个独立的、每槽一份的描述符,由 U-Boot 在构造 bootargs
之前验证:

```c
struct mos_rootfs_desc {
    u32  magic, version;
    char id[65];          /* rootfs 内容 ID */
    char roothash[65];
    u64  generation;      /* 防回滚下限 */
    u32  data_blocks, hash_offset;
    u8   signature[256];  /* RSA-2048,覆盖以上全部 */
};
```

`rsa_verify()` 已经因 `CONFIG_FIT_SIGNATURE` 被链接进来,所以这里增加的是
一个结构体和一次调用,不是一份密码学实现。认证点仍停在 mos 放它的位置:
在 Linux 之前,在固件已经认证过的代码里。

在 128 MiB 上这整套机制都不必要:内核是 A/B 的,每份 FIT 配一个根,roothash
就签在那份 FIT 的 cmdline 里。

### 6.4 模块必须内建

这不是建议,也不是 16 MiB 专有。在单内核模型里 rootfs 与内核不再互相版本
锁定 —— 7.2 节的存在正是因为一次回退可能把新内核和较旧的根配成一对 ——
所以携带 `/lib/modules/<release>` 的 rootfs 就是一枚等待那次配对的故障。
在 128 MiB 上版本锁定回来了,但去掉 support 镜像依然买回 12 MiB(3.4 节),
而且把驱动集内建同时从两种预算里都删掉了 kmod、modprobe 和 depmod。

## 7. 风险

### 7.1 密钥集在出厂时被冻结

两把公钥都住在 U-Boot 的 control DTB 里,而 U-Boot 只经维护通道重写。只烧
一把密钥,意味着这条产品线的签名密钥在不召回每一台设备的前提下永远无法轮换。

**在第一台设备出货之前,预置 2–3 把公钥作为 overlap 集。**mos 对元数据锚点
已经持有这个形状,见[安全生命周期](../../design/security-lifecycle.md) ——
只要还有已发布产物依赖某个锚点,发布方就拒绝移除它。这件事事后加不了,而且
在两种容量下都适用。

### 7.2 会引导出未测组合的那次回退 —— 仅 16 MiB

单内核模型招来的故障,按顺序:

1. 运行中:内核 K1 配 rootfs A,均为 v1。
2. 内核更新把 K2 写在唯一的内核区上,把 v2 写进 rootfs B。K1 在任何地方都
   不再存在。
3. rootfs B 三次健康确认失败。
4. A/B 机制尽职尽责,回退到 rootfs A。
5. 设备此刻运行的是 **K2 配为 K1 构建的 v1 根** —— 一个从未构建过、从未
   测试过、从未发布过的组合。

它很可能能跑;Linux 用户态通常向前兼容。但这不是重点。重点是没有人知道,
而且是在现场被发现的。

**因此内核更新事务必须在激活新槽的同一次持久化写入中作废另一个槽。**记录
格式不需要改:`boards/common/mos-records.h` 里 `tries = 0` 本来就表示
"不可选"。漏掉这一步不会大声失败 —— 它产出的是一台安静地引导了从未被测试过
的组合的设备。

在 128 MiB 上这个风险不可能发生:内核与根成对替换,两半一起回退。

### 7.3 砖窗口 —— 仅 16 MiB,但那个顺序是通用的

单份内核区无法给自己做暂存。在它被擦除和重写期间,不存在可引导的内核。这是
真实的,无法消除,只能收窄和隔离:

1. **先 rootfs。**把新根流式写进非活跃槽并完整校验。这是耗时长的那次写入,
   在此期间中断是无害的。
2. **内核暂存在 RAM。**把 FIT 下载进 tmpfs,完整验证签名与摘要,之后才动
   第一次擦除。不要放 DATA:DATA 是 2,936 KiB 而 FIT 是 2,560 KiB,放那里
   等于要求每次内核更新时 DATA 几乎为空,这个约束在现场守不住。
3. **擦除并写入内核区。**这一段就是砖窗口。
4. **一次持久化记录写入**,激活新槽并作废另一槽。

第 3 步掉电按设计不可恢复,交给前提 1.5。第 1、2、4 步都可恢复。窗口必须在
真实器件上实测,不能估算 —— NOR 的擦除与编程时间决定它有多宽。

**第 1、2 步在 128 MiB 上依然成立**,理由是 3.5 节的容量账:DATA 20–36 MiB
对一份 53 MiB 的部署,所以流式写进非活跃槽在两种容量下都是安装路径。只有
第 3 步的砖窗口是单内核特有的。

### 7.4 内核更新后恢复双槽 —— 仅 16 MiB

第 4 步之后,设备单槽运行、没有回退,直到下一次用户态更新。在新内核确认健康
之后,把运行中的 rootfs 复制进被作废的那个槽并标记为可用。两槽此时版本相同,
回退只等于一次重启 —— 但 rootfs 损坏重新变得可救。这是一次槽到槽的 flash
复制,在确认之后异步执行,失败了什么也不改变。

## 8. 继承

从 mos 转移过来的东西,以及以什么形式转移。16 MiB 那一列是苛刻的那列;在
128 MiB 上多数行变成"不变"。

| 资产 | 转移形式 |
|---|---|
| `boards/common/mos-records.h` | 近乎原样。纯 ANSI C,只用 `stdio.h`/`string.h`,不含 U-Boot 头文件。16 MiB 下删掉 `kernel[65]`:没有独立内核组件,就没有第二个身份需要绑定;128 MiB 下该字段保留。 |
| `mos-file-boot.c`(cx3576) | 形状,205 行。块设备读改为 MTD 或 `ubiblock` 读,FIT 路径查找改为固定偏移或一个 UBI 卷。冗余副本选择、CRC、加载前递减、持久化失败即拒绝,全部沿用。 |
| `deployments.rs` | 事务纪律 —— 代次下限、失败 ID 抑制、持久化顺序。16 MiB 下对象复用是删除而非移植;128 MiB 下它随组件一起回来。 |
| `mosd-settings` 模型 | 直接复用。 |
| reconciler 的配置渲染 | 16 MiB 下只有 `wpa_supplicant.conf`、`hostapd.conf` 和 `sshd_config` 的渲染可以转移,unit 渲染与服务控制不行。128 MiB 下整层转移。 |
| 设计契约 | [更新](../../design/updates.md)、[引导握手](../../design/uboot-ab-handshake.md)、[只读根](../../design/ro-root.md)、[存储](../../design/storage.md)、[安全生命周期](../../design/security-lifecycle.md) —— 作为规格继承,再在第 4 节背离它们的地方修订。 |

两种容量下都砍掉的:podman 与 Quadlet、`mos-mqttd` 与 broker、React 控制台。
只在 16 MiB 下砍掉的:systemd、journald、udev、OpenSSH,以及 Debian 与 APT
构建模型 —— 179 份 pin 死的包描述、约 3,900 行 deb 形态构建代码、约 20 个
产出者。

在 16 MiB 下**不能**转移的最大一块,是 reconciler 层与 systemd 的关系。
`pkgs/mosd/mosd/src/reconciler/` 下一万行是针对 systemd unit 写的;适配本身
集中在一个文件里,但 `network.rs`、`wifi_ap.rs`、`wifi_client.rs` 和
`sshd.rs` 每一个都在渲染 unit 文件的同时渲染那些确实能转移的守护进程配置。
要让 mos 与一个 16 MiB 变体共享这一层,需要在 mos 主线上开一道
`ServiceManager` 接缝。没有它,两棵树从第一个提交起就永久分叉。**在 128 MiB
上这道接缝完全不需要**,而这正是 3.2 节论证的主体。

## 9. 分期

每一期以一次检查收尾,而不是以一个状态收尾。

| 期 | 工作 | 验证方式 |
|---|---|---|
| **P0** | 回答第 1 节:先是 flash 器件,然后是 eFuse 与 ROM 下载行为、MMA 保留后剩余 DRAM、4.9 SDK 是否强制、预置几把公钥,以及 armhf 在 Debian 的支持期限 | 全部书面回答。1.3 选择方案,其余卡住其后的内容。 |
| **P1** | Buildroot 树或 Debian armhf 包池、U-Boot、只读 squashfs + dm-verity 根,不签名 | 板子进入 shell;`/` 只读;verity target 报告有效映射;用实测的 rootfs 尺寸替换 3.1 节或第 5 节的估算 |
| **P2** | `dm-init` backport、签名 FIT、记录、试启动计数,以及 16 MiB 下的签名 rootfs 描述符 | 故意破坏 B 槽:三次失败后回退到 A,且记录没有被重新填满 |
| **P3** | 管理二进制(一个或多个):设置树、reconciler、部署代理、API;健康确认 | 一次完整的用户态 A/B 更新并回退;在 7.3 节的每一步中断它并恢复 |
| **P4** | 安全:IPL_CUST 签名、eFuse、防回滚,以及 16 MiB 下的离线刷新通道 | 更低代次的镜像被拒绝;16 MiB 下离线通道救回一台被故意做砖的设备 |

在 16 MiB 下,P3 同时也是证明 7.2 节的地方:执行一次内核更新,强制新根健康
失败,断言设备**没有**引导旧根。

## 10. 待决

按阻塞顺序:

1. **前提 1.3 —— flash 器件。**它不是一个尺寸细节,它在"给 mos 加一块板"
   和"造一个新操作系统"之间做选择(3.2 节)。在它被回答之前不应承诺任何
   其他内容;若答案是 128 MiB,是 SPI-NAND 还是 eMMC 紧随其后(3.3 节)。
2. **前提 1.2 —— MMA 保留后剩余的 DRAM。**在 128 MiB 下,它决定 Debian 与
   systemd 是否真的可用,因而决定那条便宜路线是不是真的(3.5 节)。
3. **前提 1.5 —— eFuse 锁定后的 ROM 下载模式。**在 16 MiB 下生死攸关,
   在 128 MiB 下是常规维护。
4. **7.1 节 —— 预置几把公钥。**不阻塞设计;在两种容量下都永久性地阻塞第一次
   量产烧录。

不阻塞、但值得在 P1 之前定下来的:mos 主线要不要长出一道 `ServiceManager`
接缝(第 8 节)。现在做便宜,等两棵树都动过之后就贵了 —— 而它只在 1.3 的
答案是 16 MiB 时才需要。
