# 设备总线与 MQTT 应用数据契约

本文描述已经发布的系统管理面、应用服务与 MQTT 之间的边界：

- `com.mos.mosd1` 是系统管理接口，由 APID 调用；
- `com.mos.ext.<class>[.<suffix>]` 是可以提供 `com.mos.Item1` 的应用服务；
- `mos-mqttd` 只发现并桥接第二类服务。

旧版 `com.mos.mosd` 根路径上的 `com.mos.Item1` 投影已经删除。它把系统设置、
运行状态和动作混入应用数据面，不适合作为 MQTT 数据源。

## 1. 系统功能不进入 MQTT

MQTT 不发布、读取或控制以下系统功能：SSH 配置和密钥、主机名、以太网与
Wi-Fi、DNS、设备配网与凭据、控制台与 Web 管理凭据、容器管理、MQTT 自身的
配置与凭据、健康与服务状态、软件更新、重启和关机。

APID 直接调用 `com.mos.mosd1` 的 `GetSettings`、`SetSettings`、`GetState`、
`Reboot` 和 `PowerOff` 等管理方法，不通过 MQTT 或应用 item 转发。

桥接器对系统管理服务只有一个只读调用：
`com.mos.mosd1.GetDeviceId`。返回值只用作 MQTT topic 的设备地址段，不作为
item 发布；D-Bus 策略不向桥接器开放 mosd 的其他成员。

准入规则是正向白名单。只有共享名称解析器判断为扩展来源且包含非空 class 的
`com.mos.ext.<class>[.<suffix>]` 才能进入桥接状态。因此 `com.mos.mosd`、其他
系统名称、mos 命名空间外的名称，以及没有 class 的 `com.mos.ext` 都不能成为
MQTT 读写目标。

## 2. 应用 Item1 契约

每个可见应用拥有：

```text
com.mos.ext.<class>[.<suffix>]
```

`<class>` 成为 MQTT class。应用通过 `/DeviceInstance` 提供数字实例号；缺失或
无效时暂按 `0` 处理，以便发现不合规服务。应用在根路径 `/` 提供 `GetItems` 和
`ItemsChanged`，在每个 item 对象路径提供 `SetValue`。item 字典包含 `value`、
`writable`，以及可选的 `min`、`max`。

空数组是 D-Bus 的无效/删除哨兵，在 MQTT 中编码为 `{"value":null}`。它与
零长度 retained payload 不同：后者用于删除 broker 上的 retained 记录。

应用必须在源头排除凭据。桥接器还会递归遮蔽 `password_hash`、`passwordHash`、
`psk` 和 `hash` 等常见秘密字段；这是纵深防御，不代表应用可以发布秘密。

## 3. 动态发现与 D-Bus 策略

桥接器先安装只匹配 `com.mos.ext` 命名空间的 `NameOwnerChanged` 规则，再执行
`ListNames` 初始扫描。它为每个通过准入的应用读取 `GetItems`、监听
`ItemsChanged`，并把 `SetValue` 绑定到准确的知名名称。所有者消失后会停止
监听并清除该应用已经发布的 retained topic；代际编号会阻止旧所有者的迟到信号
重新填充状态。

`com.mos.ext.conf` 只允许扩展进程拥有扩展名称，不允许客户端访问全部扩展。
系统所用 dbus-daemon 1.12 不能安全表达 destination 前缀授权，所以每个要接入
MQTT 的应用包必须为 `mos-mqttd` 提供准确名称、准确成员的策略：只读应用授权
`GetItems`；允许远程写入时才授权 `SetValue`。禁止使用 destination 通配符或
只按接口授权，否则网络侧桥接器可能访问无关系统服务。缺少准确授权的应用会因
`AccessDenied` 拒绝读取，并且不会发布任何数据。

## 4. MQTT 协议

```text
N/<deviceId>/<class>/<instance>/<path>  设备到 broker 的通知
R/<deviceId>/<class>/<instance>/<path>  broker 发起的读取
W/<deviceId>/<class>/<instance>/<path>  broker 发起的写入
```

payload 为 `{"value":...}`，应用提供范围时还包含 `min`、`max`。读取会重新发布
当前 `N` 值；写入只在 `full` 模式下转成唯一目标应用的 `SetValue`。协议没有写
确认 topic，成功变更通过应用后续的 `ItemsChanged` 体现。默认 `read-only` 模式
既不订阅也不执行 `W`；无论哪种模式，系统服务都不可寻址。

设备级 topic 为：

```text
R/<deviceId>/keepalive
N/<deviceId>/heartbeat
N/<deviceId>/full_publish_completed
```

keepalive 打开 60 秒发布窗口并请求全量发布；窗口内每 3 秒发一次 heartbeat；
全量发布最短间隔为 5 秒。多个应用共享一套设备级心跳和完成标记。

`<class>/<instance>` 必须唯一。发生冲突时双方都不发布，读写都不路由，并删除
之前为冲突地址发布的 retained 记录；冲突解除后剩余应用在下一次全量发布恢复。

## 5. 生命周期与升级清理

mosd 的 MQTT 协调器根据系统设置 `mqtt.enabled` 管理 broker 和 bridge 单元，
但该设置本身不进入 MQTT。bridge 在镜像中默认禁用，以静态非特权用户运行，
默认模式为 `read-only`。

旧版本可能在 broker 中留下：

```text
N/<deviceId>/mosd/#
```

新桥接器无法得知旧 topic，MQTT 也不支持通配符删除 retained 消息。因此升级后，
运维人员必须枚举准确的 `N/<deviceId>/mosd/` 前缀，通过逐条发送零长度 retained
消息或 broker 管理工具删除；执行 broker 范围维护前先备份状态。不要删除
`N/<deviceId>/<application-class>/...`。这是连接过旧版系统树桥接器的 broker
所需的一次性迁移；全新安装不会发布 `mosd` class。

## 6. mosd 服务注册表

mosd 另行观察其他 `com.mos.*` 服务，供运维诊断使用。注册表不是 MQTT 数据源，
也不会授予 MQTT 资格；它只记录名称、来源、class、连接状态、实例、冲突和合规
缺口，绝不把第三方服务的任意 item 值复制到系统状态。

合规服务从认领名称起就在 `/` 提供 `GetItems`，并包含
`/Mgmt/ProcessName`、`/Mgmt/ProcessVersion`、`/Mgmt/Connection`、
`/DeviceInstance`、`/ProductId`、`/ProductName`、`/Connected`。缺少接口、路径、
class 或有效实例时只记录 `conformance`，不会丢弃条目；断开的条目保留到运维人员
调用 `ForgetService`。注册表描述系统和扩展服务，而 MQTT 仍只接纳带 class 的
扩展服务。

## 7. Sparkplug B

Sparkplug B 当前未实现。未来若增加独立发布器，也必须复用同一套“仅扩展应用”
准入边界，不能重新引入系统管理树。
