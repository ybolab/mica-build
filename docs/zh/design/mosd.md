# 设计：mosd（管理面）

> [English](../../design/mosd.md) | 中文
>
> 本文按**当前代码**（schema v8）写。英文侧那份保留了 M2 以来的分期决策记录与逐次修订说明，
> 篇幅更长；两边冲突时以英文为准。

## 1. mosd 是什么

**唯一那个掌管一体机状态的 Rust 服务**：一棵中心化的设置/状态树、在 STATE 上的持久化、
把设置施加到执行层（systemd unit、networkd、RAUC、容器引擎）的协调器，
以及供界面（apid/kiosk）和未来远程通道消费的桥梁。

一句话概括其定位：Venus OS 的 D-Bus 树 + Bottlerocket 的 apiserver，收进一个有边界的服务里。

## 2. 决策一 —— IPC 协议

候选：D-Bus（zbus）/ varlink / gRPC。**结论：用纯 Rust 的 `zbus` 走 D-Bus。**

**决定性事实：mosd 无论如何都必须去消费 D-Bus** —— systemd（unit、主机名）、networkd、
RAUC、wpa_supplicant、bluez 全都以 D-Bus 暴露接口。两边说同一条总线，
就省掉了一整层协议转换。

## 3. 决策二 —— 设置的 schema 与持久化

设置以 TOML 持久化在 STATE 上，按**点路径**寻址。所有写入都经由类型化的设置树，
**被拒绝的写入不会改动树**。

三条承重性质：

- **可选值是"缺席"，不是"空"。** 密钥类字段带 `skip_serializing_if = "Option::is_none"`，
  所以未设置的密钥是一个**不存在的键**，而不是空字符串。
  **没有任何密钥有非 `None` 的默认值**——这是承重的，不是整洁问题。
- **每个结构体都开了 `deny_unknown_fields`。** 携带本版本不认识的键的文档会**加载失败**，
  而不是把它悄悄丢掉。
- **点路径就是接口。** apid 通过总线按点路径读写，所以路径的稳定性是对外契约的一部分。

## 4. 设置树（schema v8）

顶层分支及其归属：

| 子树 | 内容 | 参见 |
|---|---|---|
| `hostname` | 主机名 | 首次启动时由 deviceId 派生 |
| `network` | 按接口名索引的条目，每条声明一个 **kind** | 第 5 节 |
| `access.ssh` | `enabled`、`port`、`permitRootLogin`、`passwordAuthentication`、`listenAddresses`、`authorizedKeys` | [access.md](access.md) |
| `access.console` | `shellEnabled` —— **只有 schema，没有协调器消费** | [access.md](access.md) |
| `access.device` | 凭据**元数据**（`generation`），**绝不是凭据本身** | [provisioning.md](provisioning.md) |
| `access.webAdmin` | apid 管理员口令哈希 | apid 按此点路径读写 |
| `provisioning` | `state`（pending / complete）、`deviceId`、`seededGeneration` | [provisioning.md](provisioning.md) |
| `wifi.client` | 客户端模式：`enabled`、`interface`、`networks` | —— |
| `wifi.ap` | AP 模式：`mode`（off / provisioning / always）、信道、国家码、地址等 | —— |
| `container` | 容器开关，**默认关闭** | —— |
| `mqtt` | MQTT 桥接 | —— |

`listenAddresses = []` 的含义是**监听全部地址**，不是"不监听"。

## 5. 今天注册的协调器

`reconciler::all()` 返回**七个**，按此顺序：

| 协调器 | 子树 | 执行者 |
|---|---|---|
| `HostnameReconciler` | `hostname` | systemd-hostnamed |
| `NetworkReconciler` | `network` | `/run/systemd/network` 下的 networkd unit |
| `SshdReconciler` | **仅** `access.ssh` | sshd drop-in + 每个受管账户一个 authorized-keys 文件 + `ssh.service` |
| `WifiClientReconciler` | `wifi.client` | wpa_supplicant 配置 + networkd + `wpa_supplicant@<if>.service` |
| `WifiApReconciler` | `wifi.ap`（读 `wifi.client` 做冲突检查） | hostapd 配置 + networkd + `hostapd@<if>.service` |
| `ContainerReconciler` | `container` | podman / Quadlet unit |
| `MqttReconciler` | `mqtt` | `mos-mqttd` |

**`SshdReconciler` 不再驱动 `/etc/shadow`**，它只看 `access.ssh`。

### 5.1 网络协调器：kind、netdev 与拆除

物理接口的处理一如既往：渲染一个 `.network` 文件，比对，清扫。`kind` 带来了三件
单靠 `.network` 表达不了的事：

**虚拟链路还需要一个 `.netdev`。** 物理条目不需要——内核已经有那个设备了。
VLAN 的 netdev 带 `Kind=vlan` 和 `[VLAN] Id=`，桥带 `Kind=bridge`，
隧道带 `Kind=wireguard` 以及 `[WireGuard]` / `[WireGuardPeer]` 段。

**挂接关系写在"对端"接口的 unit 上。** networkd **只有在父接口的 `.network` 点了名之后
才会创建 VLAN**，所以子接口的存在必须由**父接口**的 unit 来陈述。桥端口自身不携带地址：
**端口的地址就是桥的地址**，校验阶段已经拒绝了那些想自己留地址的条目。
两种关系都在写第一个文件之前就**失败即关闭**——一个未声明的父接口意味着一个永远起不来的 VLAN。

**清扫长出了拆除动作，因为删文件不等于删设备。** 清扫仍然删除本轮没有写过的每个 `50-mos-` unit
（现在覆盖 `.network` 和 `.netdev` 两种后缀），然后**还要请内核把设备摘掉**。

**WireGuard 隧道的私钥在设备上生成**，落在设置文件旁的 `networkd-secrets/` 目录里，
**绝不进入设置树**。

## 6. 总线接口

`com.mos.mosd1` 提供：

| 成员 | 类型 |
|---|---|
| `GetSettings` / `SetSettings` | 方法 |
| `GetTask` | 方法 |
| `GetState` | 方法 |
| `SettingsChanged` | 信号 |
| `TaskChanged` | 信号 |
| `ReportHealth` | 方法 |
| `Reboot` / `PowerOff` | 方法 |
| `SetTransientRootPassword` | 方法 |
| `ForgetService` | 方法 |
| `InstallUpdate` / `GetUpdateState` / `MarkUpdate` | 方法 |
| `RotateWireguardKey` | 方法 |

mosd 刻意不再导出 `com.mos.Item1` 门面。系统设置、实时状态和动作都留在管理接口，
不属于 MQTT 应用数据。`mos-mqttd` 对 `com.mos.mosd` 没有任何策略权限；APID 以
root 身份通过仅限 root 的本地策略访问它。mosd 在启动桥接器前，把已经配网的 topic 标识写入
专用的 `/run/mos/mqttd-device.env` 运行时文件。

`SetSettings` 现在在“持久化并入队”后返回任务 id。一个 worker 串行执行协调；等待中的任务按
dot-path 子树包含关系折叠。有界历史同时发布在实时状态的 `tasks`、`GetTask` 和每次状态迁移都
触发的 `TaskChanged` 中。设置与实时状态由 `RwLock` 保护，另一个 apply mutex 保留协调、
临时 shadow 写入和 WireGuard 密钥轮换所需的串行性，却不再阻塞读取。临时口令只排入
`access.ssh`，WireGuard 轮换只应用 `network`，两者都不再重跑整棵树。

## 7. 边界

- **apid 从不派生进程，也从不自己与 systemd 对话。** 它是 mosd 的客户端。
- **mosd 启停并重新渲染 unit，而不是自己监管进程。** PID 1 是 systemd。
- **每条配置通道都汇聚到这一个经过校验的写入路径**，没有任何一条绕到守护进程背后改文件。
