# 设计：板卡支持（BSP）契约

> [English](boards.md) | 中文
>
> 一块板卡如何接入 mos：它必须产出什么、OS 构建消费什么、两者之间的硬性
> 断言。参考实现：`board/cx3576`。

## 1. 分离规则

BSP 层产出 **artifacts**；OS 构建消费 **artifacts**。任何一侧不得伸手进对方
的构建过程。Yocto 只允许出现在板卡目录内部（当厂商只以 Yocto layer 形式发布
BSP 时，跑 `bitbake virtual/kernel virtual/bootloader` 并导出 deploy 目录）
——绝不进入 talos/OS 构建链。

## 2. 板卡目录布局

```
board/<name>/
├── board.yaml          # 镜像组装消费的元数据（arch、console、存储、
│                       #   cmdline 附加项、引导链、features）
├── Makefile            # make uboot | kernel | rootfs | image（仅 buildkit）
├── uboot/Dockerfile    # -> bootloader 二进制（如 u-boot-rockchip.bin）
├── kernel/             # -> Image、modules.tar、dtb
│   ├── Dockerfile
│   ├── config/         # 内核配置基线（厂商 ikconfig + mos 增量）
│   ├── dts/            # 入树板卡 dts（全开源路线，不玩 overlay 叠加）
│   └── patches/        # 按序补丁系列 *.patch
└── rootfs/             # 可选的演示/冒烟 rootfs（不是产品）
```

引导链有上游支持的板卡（如 `board/x64`，UEFI）只需 `board.yaml` + README——
内核与 bootloader 来自 talos 构建。

## 3. 进入 OS 镜像的产物接口

| 产物 | 生产方 | 消费方 |
|---|---|---|
| `Image` + `modules.tar` + `*.dtb` | `board/<n>/kernel` | talos Dockerfile：替换 `modules-arm64` stage（`ARG BSP_KERNEL_IMAGE`）；modules 落 `/usr/lib/modules/<ver>`，固件落 `/usr/lib/firmware` |
| bootloader 二进制 | `board/<n>/uboot` | imager overlay 的 `Install` 步骤（按 `board.yaml` 偏移裸写） |
| `board.yaml` | 板卡目录 | imager profile / overlay 的 `GetOptions`：kernel args、console、分区偏移 |
| 固件 blob | 板卡目录 | rootfs 固件注入，按板裁剪 |

modules 与内核版本的耦合是绝对的：rootfs 内的 modules 树**必须**与 BSP 内核
release 一致，镜像组装期断言。

## 4. 内核配置断言（每板 CI 门禁）

厂商 defconfig 从来不会把这些配对；每个板卡内核构建必须断言（对最终
.config 做 grep，不满足即构建失败）：

- 启动路径：`DM_INIT=y`、`DM_VERITY=y`、`BLK_DEV_DM=y`、`SQUASHFS=y`
  （+zstd）、存储控制器 built-in、`OVERLAY_FS=y` —— 无 initramfs 的 verity
  启动（PLAN-006 Part D）在挂根之前没有加载模块的机会。
- 运行时：cgroup v2 全套、containerd/netfilter 前置（cx3576 Dockerfile 已
  断言的 docker 集合）、seccomp。
- Talos 基线片段：全板共享、只维护一份，位于
  `board/common/mos-required.fragment`（buildx 命名 context `mos-common`），
  在 olddefconfig 之前合入——上述清单及 machined 必需伪文件系统（hugetlbfs、
  tracing、SELinux + LSM 启动列表）的唯一权威来源。板级特有需求留在各板
  自己的配置基线里。

## 5. U-Boot 要求（uboot 引导链板卡）

依 PLAN-006 Part E：`CONFIG_BOOTCOUNT_LIMIT`、冗余 env
（`CONFIG_ENV_OFFSET_REDUND`）、`CONFIG_FIT` + `CONFIG_FIT_SIGNATURE`、
`CONFIG_SYS_BOOTM_LEN ≥ 0x8000000`、RAUC BOOT_ORDER 握手脚本、以及救援路径
（cx3576：recovery 按键 → rockusb，启动失败兜底 → rockusb）。启动脚本与
RAUC `system.conf` 由同一来源（`GenerateAssets`）生成，杜绝漂移。

## 6. 内核支持政策（2026-08-17 决策）

Talos 基座有硬性内核下限（fsopen/fsconfig 挂载 API = 5.2；`dm-mod.create=`
verity = 5.1；< 6.7 已内置 overlay 旧语法回退）。板卡准入分档：

| 档 | 内核 | 支持 |
|---|---|---|
| 1 | >= 5.10 LTS | 完整支持（主流厂商 BSP：RK 5.10/6.1、NXP 5.15/6.6、TI 6.1） |
| 2 | 5.4 | 按板评估；预期小 shim，无结构性工作 |
| — | 4.x | **Talos 基座不支持。**按序评估：(a) 厂商内核升级 / SoC 主线化；(b) 该板走 "mos-lite" 形态（Alpine 级底座 + mos 服务容器化）；(c) 若 4.x 板成为主力需求，触发 init 战略 Plan B（research/init-strategy.md） |

## 7. 新板接入 checklist

1. 建 `board/<name>/`，写 board.yaml（非 UEFI 另加 kernel/uboot 目录）。
2. 内核：厂商树 + mos-required 片段合入；断言全绿。
3. U-Boot：§5 配置；verified boot 密钥烧录。
4. 先走冒烟路径（Alpine 或原厂镜像）验证硬件——这正是 cx3576 的 Alpine
   演示扮演的角色——再上 Talos 镜像。
5. 消费 BSP 产物的 Talos 镜像在真机启动到 webd healthz。
6. 拔电压测台跑过，板卡才算 supported。

## 8. 现有板卡

| 板卡 | 架构 | 引导链 | 状态 |
|---|---|---|---|
| cx3576（CX3576-Z，RK3576） | arm64 | U-Boot @ eMMC 扇区 64，FIT | BSP 产物可构建；Talos 启动 = 下一个 campaign。缺口见板卡 README：verity 内核项、FIT 签名、RAUC env 握手 |
| x64（通用 UEFI） | amd64 | 上游 Talos（sd-boot/GRUB） | QEMU/CI 基线 |
