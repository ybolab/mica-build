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

启动链由上游支持的板卡（`boards/x64`，UEFI）**不编译引导程序**：UEFI 机器的固件就提供了
启动链。但它仍然构建**内核**——x64 的 `bsp/` 只有这一个目标：主线内核，用 tag 和源码
sha256 双重钉住，配置由一个 fragment 合并到 `x86_64_defconfig` 之上、解析结果记录在树内
（`boards/x64/bsp/kernel/`），打包为 `mos-kernel-x64`，由 `mos-board-x64` 依赖。它取代了
Debian 的 `linux-image-amd64`——那个内核没有 `CONFIG_DM_INIT`，会静默忽略本板自己的
`dm-mod.create=` verity 表（PLAN-074）。

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
| x64（通用 UEFI） | amd64 | UEFI 固件 -> 单一静态 ESP 上的 GRUB -> 该槽位自己的 boot 分区 | QEMU/CI 基准。`bsp/` 只构建内核；不编译引导程序，因为固件就是引导程序 |
