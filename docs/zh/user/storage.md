# 存储

Mica OS 使用三个分区：UEFI 板为 ESP/SYSTEM/DATA，U-Boot 板（cx3576、s905x5m）为 FIRMWARE/SYSTEM/DATA。
只有 DATA 随介质扩容。SYSTEM 存放不可变签名部署文件；固件独立于普通系统更新。

> status: shipped — evidence: `boards/x64/board.env`, `boards/virt-arm64/board.env`, `boards/cx3576/board.env`

## 文件放在哪里

| 路径 | 用途 |
|---|---|
| `/mos/config` | 通过 API 管理的设备配置 |
| `/mos/apps`、`/mos/containers` | 托管应用和容器数据 |
| `/srv` | 操作者文件与应用数据 |
| `/home`、`/root` | 由 `/mos` 支撑的持久用户目录 |
| 明确列出的 `/var/lib` 叶目录 | DATA 上的持久服务状态 |
| `/var/tmp` | 有配额的磁盘临时数据 |
| `/run`、`/tmp` | 本次启动的易失数据 |

身份、凭据和服务状态位于物理 DATA/state，更新和生命周期记录位于 DATA/meta。
这些目录由系统管理，配置应使用 API，不要手动编辑内部记录。
`/var` 父目录树只读，只有明确支持的叶目录可写；任意新建目录会以 EROFS 失败。
日志为易失内容，关闭测试设备前先保存诊断证据。

> status: shipped — evidence: `docs/design/storage.md`, `rootfs/overlay/etc/systemd/system/`

## 容量和清理

所有 DATA 绑定共享一个文件系统，存储 API 只统计一次总容量，并报告目录/项目用量
和挂载就绪情况。大容量及可丢弃写入者有字节和 inode 配额，为关键状态、元数据保留
已测量空间。普通服务不能用 `CAP_SYS_RESOURCE` 绕过限制。

目录重置只清除允许的指定范围，保留身份和部署/生命周期记录。系统回滚不撤销应用
数据写入。完整重刷替换镜像内容，并不安全擦除镜像范围之外的每个物理扇区。

> status: shipped — evidence: `pkgs/mosd/mosd/src/storage_status.rs`, `pkgs/mosd/mosd/src/reset.rs`, `rootfs/overlay/usr/lib/mos/mos-data-layout`

## 故障

DATA/SYSTEM 缺失、只读或损坏会停止受影响启动路径，等待显式恢复。系统不会在
不可变根上创建默认凭据、重置耗尽计数或静默挂载替代状态目录。报告故障时保存串口
日志和镜像/组件身份。物理 eMMC 持久性及板级恢复依赖 cx3576 台架测试，QEMU 与
离线检查只证明各自明确覆盖的软件行为。

> status: board-dependent — evidence: `docs/design/uboot-ab-handshake.md`
