# mos 系统架构

> [English](architecture.md) | 中文
>
> 状态：持续更新的文档。详细设计见 `design/` 与 `plan/`；本文是顶层地图。
> 最后更新：2026-08-17。

## 1. mos 是什么

一个嵌入式 appliance 操作系统：面向 ARM SoC 板卡与通用 x86_64 设备的不可变、
声明式管理的 OS，具备 A/B 升级、本地 Web 管理面和现场级配网能力。它组合业界
已验证的组件，而非重新发明：

| 层 | 来源 | 理由 |
|---|---|---|
| OS 核心（rootfs、PID 1、声明式运行时） | **Talos fork**（`talos/`） | COSI controller 收敛、不可变 squashfs rootfs、单二进制 Go 用户态 |
| 升级安全 | **Uptane/TUF** | 角色分离签名、离线 root 密钥、防回滚/防冻结（Torizon 已验证） |
| A/B 槽安装器 | **RAUC**（仅 CLI） | 量产验证的槽写入、U-Boot 握手、adaptive（差分）流式安装 |
| BSP 产物 | 每板独立的 buildkit Dockerfile（`board/`） | 厂商 kernel/U-Boot 钉版容器化；OS 构建链中不出现 Yocto |
| 现场工程模式 | 参照 balenaOS / Venus OS | 离线配网、SD/USB 升级、dev/prod 双变体 |

## 2. 运行时组件全景

```
                   machine config（多文档 YAML，STATE 分区）
                                     |
                          machined（PID 1，COSI 运行时）
     ______________________________________|________________________________
    |          |           |            |           |            |          |
  webd       connd       sshd*      console*     updater      apid       containerd
  本地       WiFi/AP     Go SSH     tty2 向导    Uptane +     上游       仅 workload：
  HTTPS     BT/CAN      + busybox   tty3 shell   RAUC CLI     管理 gRPC  extension 服务、
  UI/API   (PLAN-008)   （debug     （debug     (PLAN-006)   （默认     未来应用容器
                         变体）      变体）                    关闭）
```

\* 仅 debug 变体存在；prod 镜像在构建期即不包含。

- **machined** — Talos PID 1：服务监督、COSI controller、启动序列。appliance
  机型（`TypeAppliance`）门控关闭 k8s/etcd/trustd/CRI/dashboard（PLAN-007）。
- **webd** — 终端用户管理面（HTTPS）：首启设置、状态、网络配置、升级 UI。
  经 `/run/machined.sock` 与 machined 通信。
- **connd** — 统一连接服务：WiFi STA/AP、蓝牙、CAN（design/PLAN-008）。
- **updater** — machined 内建编排：Uptane 元数据验证、策略门、RAUC 调用、
  健康门确认（PLAN-006）。
- **apid + talosctl** — 上游持续维护的机器 API，保留用于运维与未来机队管理
  （SideroLink）；默认关闭/仅绑管理网（design/remote-management.md）。
- **containerd** — 仅作 workload 层；永不参与升级路径。

## 3. 存储与启动（依 PLAN-006）

- 分区：U-Boot 裸区 | BOOT-A/B（FIT：kernel+dtb）| ROOTFS-A/B（squashfs +
  dm-verity）| UENV-A/B（冗余 env）| META | STATE | EPHEMERAL。
- **正常启动路径无 initramfs**：由签名 FIT cmdline 上的 `dm-mod.create=`
  组装 verity 设备；rootfs 由磁盘承载，OS 镜像零不可回收 RAM 占用
  （256MB 板可行）。
- Rescue：FIT 第三配置项携带 micro-initramfs，仅在全部槽失败或
  `talos.rescue=1` 时加载；再往下是 rockusb/工厂重刷。
- 不变式：**任意时刻掉电，设备必能启动到某一可用槽**（矩阵见 PLAN-006
  Part F；200 次拔电压测台是验收门）。

## 4. 信任链

```
工厂密钥 ─ 签名 ─> U-Boot verified boot ─> FIT（kernel+dtb+cmdline）
                                              └─ cmdline 携带 dm-verity root hash
                                                    └─ rootfs 运行期逐块校验
升级路径：TUF root（离线）─> targets/snapshot/timestamp ─> RAUC bundle（CMS，独立密钥）
Lockbox： 介质携带同套元数据；有效期使过期的现场介质自动作废
变体：    prod 镜像不含 shell/sshd —— "有没有 shell"是镜像哈希的一部分
```

两套签名体系是有意为之：TUF 在线密钥不能签 bundle，bundle CMS 密钥不能签
元数据；root 轮换列为验收演练项。

## 5. 访问模型（design/access.md）

三条通道、三种强度——绝不用一个万能 shell 包打天下：

1. **配网向导**（tty2 TUI / AP 强制门户）：资源白名单、弱认证（一机一密
   PIN），覆盖"现场无网"。
2. **完整 shell**（tty3 / SSH）：仅 debug 变体；阶段一为一机一密默认密码，
   后续离线挑战-响应；META 持久化防爆破计数；审计入 syslogd。
3. **Rescue**：物理接触级恢复，位于 OS 之下。

分层禁用：配置开关（运行期）→ META lockdown（不 wipe 不可逆）→ prod 镜像
变体（编译期不存在）。

## 6. 仓库与目录地图

```
mos/                 本仓库：文档、板卡、extensions、升级工具、Makefile
├── talos/           独立 git 仓库 —— OS fork（上游：siderolabs/talos）
├── board/<name>/    每板 BSP：board.yaml + buildkit Dockerfile -> 产物
├── extensions/      system extensions（connectivity、rescue），按镜像 profile 装配
└── update/          发布签名（TUF+CMS）与 lockbox 构建；服务端只是静态文件
```

派生策略（PLAN-007）：talos fork 通过**上游 k8s-less 门控 + 增量层**跟踪
上游——绝不删除——上游合并保持常规操作。当前基线：v1.14.0-rc.1 时代。

## 7. 板卡

- `board/cx3576` — CX3576-Z（RK3576，arm64）：厂商 6.1.115 内核树、mainline
  U-Boot、WiFi/BT/CAN。第一个硬件目标。
- `board/x64` — 通用 UEFI x86_64：无 BSP 构建，上游 Talos 引导链；QEMU/CI
  基线（"x64 绿而 cx3576 红 ⇒ 板级问题"）。

BSP 契约（design/boards.md）：板卡产出 artifacts（kernel Image + modules +
dtb、U-Boot 二进制），talos 镜像构建经 stage 替换消费；内核配置必须通过 mos
断言集（verity、squashfs、containerd 前置）。

## 8. 路线图 ↔ 文档

| 阶段 | 内容 | 文档 |
|---|---|---|
| 已完成 | 上游基线切换 + 门控策略 | PLAN-007 |
| 下一步 | 板级启动（cx3576 可刷 Talos 镜像） | 计划待立（campaign L2-B） |
| 之后 | A/B 升级栈（RAUC+Uptane） | PLAN-006 |
| 之后 | 访问层（webd 补齐、sshd/console、认证） | design/access.md → 计划待立 |
| 之后 | 连接服务（connd） | PLAN-008 |
| 更远 | 应用 workload 作为 Uptane secondary ECU、机队管理（SideroLink）、BLE 配网 | design/remote-management.md、PLAN-008 P3 |
