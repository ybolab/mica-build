# 设计：mosd（管理平面）—— M2 设计简报

> [English](mosd.md) | 中文
>
> 状态：提案 —— PLAN-010 M2 的两个待决设计点及推荐方案。裁决后即成为
> mosd 设计记录。

## 1. mosd 是什么

拥有设备状态的唯一 Rust 服务：中央设置/状态树、STATE 分区持久化、把设置
应用到执行层（systemd unit、networkd、RAUC、balena-engine）的协调器，以及
供 UI（webd/kiosk）与未来远程通道消费的桥接。一句话：Venus OS 的 D-Bus
树 + Bottlerocket 的 apiserver，收敛为一个边界清晰的服务。

## 2. 待决点一 —— IPC 协议

候选：D-Bus（zbus）/ varlink / gRPC。

**推荐：D-Bus，经纯 Rust 的 `zbus` crate。**决定性事实：mosd 反正必须
**消费** D-Bus——systemd（unit/hostname）、networkd、RAUC、wpa_supplicant、
bluez 的 API 全是 D-Bus。一条总线双向使用（消费系统服务，同时像 Venus 的
`com.victronenergy.*` 一样暴露 `com.mos.*`），避免养第二套 IPC 生态。webd
为浏览器做 HTTP/WebSocket ↔ D-Bus 桥；gRPC/MQTT 式远程桥后续挂在边缘而非
核心（Venus gui-v2 模式：本地走总线、远程走桥）。varlink 优雅但生态太薄，
背不动 D-Bus 免费解决的那些集成。

## 3. 待决点二 —— 设置 schema 与持久化

**推荐：**

- 设置建模为带类型的 Rust 树（serde），点路径寻址（`network.eth0.dhcp`、
  `access.ssh.enabled`）——Venus 式寻址，对 UI 绑定自说明。
- 以带版本的 TOML 持久化于 STATE（`/state/mos/settings.toml` +
  `schema_version`）；原子提交（写临时文件 + rename）。
- 迁移：Bottlerocket migrator 模式——每个发布随带**双向**迁移单元
  （PLAN-006 Part I 要求回滚方向必须可用）。
- 协调器契约：每个子系统协调器监听一棵子树、负责渲染到其执行器
  （networkd unit、sshd drop-in、RAUC 调用）；状态回发到总线树上
  （settings 与实时 state 分离，如 Venus 的 settings 与 service 路径）。

## 4. M2 范围护栏

M2 只交付：workspace（pma-rust 基线）、带 `com.mos.*` 树的总线服务、设置
持久化 + 迁移骨架、**仅两个**协调器（hostname、network/networkd）。其余
（升级、访问、connd 集成）各自在后续里程碑按此契约落地。
