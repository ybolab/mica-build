# 更新与回滚

mos 的更新是整镜像、事务性的：操作系统、其服务和所有原生应用是一个签名
产物，在设备持续运行时安装进不活动的 A/B 槽，通过重启激活，新槽无法证明
自己健康时自动回滚。没有设备上的包管理器，没有部分更新——这是设计立场，
不是缺失的功能。

配置和数据从不属于更新的一部分：设置树在 STATE 上，应用数据在 DATA 上，
安装器只写 rootfs 和 boot 槽（[storage.md](storage.md)）。

## 1. 组成部分

- **Bundle。**一个 RAUC 更新 bundle（`.raucb`）：新的 rootfs（squashfs +
  dm-verity 哈希树）和新的 boot 槽载荷，带 CMS 签名。设备在安装前对照
  自己的密钥环验证签名。由 `make os-bundle-cx3576` 构建（GRUB 分支用
  `bash build/run.sh --bundle --board x64`）。
- **槽选择。**在 cx3576 上，U-Boot 依次遍历 `BOOT_ORDER`，在冗余环境中
  维护每槽尝试计数；每次启动尝试都在内核加载*之前*扣除一次额度，因此无法
  启动的槽会在有限次复位内耗尽额度，引导加载程序回落到另一个槽。这个状态
  机由 `make os-uboot-handshake-test` 针对真实 U-Boot 二进制验证。在 x64
  上，GRUB 从 ESP 上的 `grubenv` 读取等价状态。
- **健康门。**每次启动时，`mos-health` 探测 systemd 总体状态、mosd 和
  apid，只有全部通过才执行为已启动槽补满额度的确认。失败时它刻意什么都
  不做：不确认、不补救——回滚属于引导加载程序的计数器，一个自己重启设备
  的健康门会破坏那个契约。容忍失败与阈值策略是一个配置文件，
  `/etc/mos/health.conf`。

> status: shipped — evidence: `make os-bundle-cx3576`, `make os-uboot-handshake-test`, `rootfs/overlay/usr/lib/mos/mos-health`

> status: board-dependent — evidence: `boards/cx3576/boot.cmd`, `boards/x64/grub.cfg`

## 2. 今天如何安装更新

先说诚实的范围：**设备不获取更新。**没有更新发现客户端，没有渠道订阅，
UI 和 HTTP API 里没有检查/应用控制。已发布的是安装那一半：

1. Bundle 由集成商用自己的方式放到设备上（通过 SSH，或由某个应用）。
2. 管理守护进程的 `InstallUpdate` 操作把 bundle 交给 RAUC，后者验证签名
   并写入不活动的槽组；安装状态、每槽状态和错误在设备实时状态中可观察。
3. 一次重启引导新槽。健康门确认它，或者引导加载程序在失败尝试用尽后
   回滚到之前的槽。

更新流程——什么触发它、什么验证它、什么确认它——记录在
[../design/remote-management.md](../design/remote-management.md)；未来落地
的任何触发方式都会汇聚到这同一条经过验证的路径。

> status: shipped — evidence: `pkgs/mosd/mosd/`, `docs/design/remote-management.md`

## 3. 回滚

- **自动。**启动失败、或启动了但没过健康门的槽，其额度永远不会被补满；
  接下来的复位会把额度耗尽，引导加载程序回到之前的槽。当两个槽都耗尽时，
  cx3576 的引导加载程序补满所有计数器并复位——设备持续循环而不是变砖，
  出路是恢复路径（[recovery.md](recovery.md)）。
- **手动。**管理守护进程暴露一个有防护的手动标记操作（对已启动槽或另一
  槽标记 `good`/`bad`），用于健康门无法裁决的情形——例如操作员已判定可以
  接受的失败单元。它是本地管理动作；今天 UI 里没有回滚按钮。

一个值得知道的代价：只有较新发布版才认识的设置 schema 键，在较旧发布版
启动时会被丢弃——设置存储通过剥掉不认识的部分来容忍较新的文档。宁可及时
确认或及时回滚，也不要让旧槽长时间运行在新 schema 的设置上。

> status: shipped — evidence: `docs/design/uboot-ab-handshake.md`, `docs/design/mosd.md`

## 4. 更新信任链是什么、不是什么

一个发布版由两个互不相关的体系签名两次：RAUC bundle 携带 CMS 签名，在
设备上对照 `/etc/rauc/keyring.pem` 验证；主机侧 TUF 仓库元数据在四个角色
密钥（root 离线）下固定 bundle 的摘要、长度和 verity 根哈希。仪式与保管
规则是签名 runbook，
[../design/release-signing.md](../design/release-signing.md)。

已点名的缺口：还没有任何镜像随附生产密钥环（未提供材料的构建会生成一个
高调标记的开发级信任根），已部署设备上没有密钥环轮换渠道，也没有任何
东西把 TUF 验证器发布到设备上。见 [security.md](security.md)。

> status: shipped — evidence: `docs/design/release-signing.md`, `pkgs/rauc-sign/`

## 5. 更新故事的其余部分

发现、带认证的可续传下载、对照发布元数据的兼容性门禁、维护窗口、可安全
重启的联锁，以及 API 与 UI 中的显式更新状态，作为"认证系统更新"工作规划
在已发布的安装路径之上。

> status: proposed — evidence: `docs/plan/PLAN-047.md`

TODO(PLAN-047): revisit after this plan merges
