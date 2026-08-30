# 设备总线与 MQTT 应用数据契约

本文描述已经发布的系统管理面、应用服务与 MQTT 之间的边界：

- `com.mos.mosd1` 是本地系统管理接口，由 APID 调用；启动健康门禁是另一个获准的
  本地调用者；
- 所有服务统一使用 `com.mos.<class>[.<suffix>]` 名称。mosd 本身也是一个应用，
  名称本身不授予 MQTT 资格；
- `mos-mqttd` 只桥接由应用包按准确服务名登记的 `com.mos.Item1`，绝不调用或监听
  `com.mos.mosd`。

旧版 `com.mos.mosd` 根路径上的 `com.mos.Item1` 投影已经删除。它把系统设置、
运行状态和动作混入应用数据面，不适合作为 MQTT 数据源。

## 1. 系统功能不进入 MQTT

MQTT 不发布、读取或控制以下系统功能：SSH 配置和密钥、主机名、以太网与
Wi-Fi、DNS、设备配网与凭据、控制台与 Web 管理凭据、容器管理、MQTT 自身的
配置与凭据、健康与服务状态、软件更新、重启和关机。

APID 直接调用 `com.mos.mosd1` 的 `GetSettings`、`SetSettings`、`GetState`、
`Reboot` 和 `PowerOff` 等管理方法，不通过 MQTT 或应用 item 转发。

桥接器对 mosd 没有任何 D-Bus 调用。mosd 在启动桥接器前，把已配网的 topic
设备标识写入 `/run/mos/mqttd-device.env`，systemd 再通过 `--device-id` 显式传入。
这个文件只承载一个运行时值，不是通用设置导出。

mosd 保留 D-Bus 是因为 mosd 与 APID 是两个本地进程：APID 需要一个有类型、受策略
约束的 IPC 边界来请求系统操作。这个本地管理接口不是 MQTT 数据源；本地 IPC 与
远程发布是两项独立决定。

准入规则是正向白名单。`/usr/lib/mos/mqtt-applications.d` 中必须存在以准确、合法
D-Bus 服务名命名的普通文件。加载后还会再次硬性拒绝 `com.mos.mosd`。同名前缀下
未登记的兄弟服务、通配符和命名空间外名称都不能成为 MQTT 读写目标。

## 2. 应用 Item1 契约

每个可见应用拥有：

```text
com.mos.<class>[.<suffix>]
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

桥接器先加载准确登记集合，再安装匹配 `com.mos` 命名空间的
`NameOwnerChanged` 规则，然后执行 `ListNames` 初始扫描。较宽的信号匹配只用于
发现；在查询 owner、创建 proxy、调用方法或订阅信号之前，都会先检查准确登记。
它为每个通过准入的应用读取 `GetItems`、监听
`ItemsChanged`，并把 `SetValue` 绑定到准确的知名名称。所有者消失后会停止
监听并清除该应用已经发布的 retained topic；代际编号会阻止旧所有者的迟到信号
重新填充状态。

系统不再提供全局 `own_prefix` 策略，也没有中央 mqttd 策略。每个接入 MQTT 的
应用包必须同时安装：

1. `/usr/lib/mos/mqtt-applications.d/<准确服务名>` 空登记文件；
2. 只允许应用拥有该准确名称、并只允许 `mos-mqttd` 访问该名称 `com.mos.Item1`
   成员的 D-Bus 策略。

只读应用向 `mos-mqttd` 授权 `GetItems` 和 `ItemsChanged`；允许远程写入时才授权
`SetValue`。策略还要向 root 授权 `GetItems`：mosd 服务注册表（第 6 节）以 root
身份用这一调用探测服务，而系统总线默认拒绝方法调用，root 没有豁免。
禁止 destination 通配符、前缀拥有授权或只按接口授权。登记和策略缺少任一侧都会
失败关闭：未登记的目标不会创建 proxy，缺少策略的登记会收到 `AccessDenied` 并且
不发布数据。镜像校验要求登记文件、按用户限定的拥有授权、桥接器的 `GetItems`
与 `ItemsChanged` 授权、以及 root 的 `GetItems` 授权指向同一个准确服务名。
`com.mos.mosd` 在两侧都禁止。

桥接器对应用的每次调用都有 5 秒上限：接受 `GetItems` 或 `SetValue` 却不应答的
应用会被记为不可达，其它应用不受影响。仍持有名称但激活失败的应用（例如先认领
名称、后注册 `/` 对象）会在 5 秒后由总线重扫再次激活，两侧都不需要重启。

## 4. MQTT 协议

```text
N/<deviceId>/<class>/<instance>/<path>  设备到 broker 的通知
R/<deviceId>/<class>/<instance>/<path>  broker 发起的读取
W/<deviceId>/<class>/<instance>/<path>  broker 发起的写入
```

payload 为 `{"value":...}`，应用提供范围时还包含 `min`、`max`。读取会重新发布
当前 `N` 值，应用未发布的路径会被忽略而不是应答，客户端无法借此创建任意 retained
topic；写入只在 `full` 模式下转成唯一目标应用的 `SetValue`。协议没有写
确认 topic，成功变更通过应用后续的 `ItemsChanged` 体现。默认 `read-only` 模式
既不订阅也不执行 `W`；无论哪种模式，未登记服务都不可寻址。

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

## 5. 生命周期

mosd 的 MQTT 协调器根据系统设置 `mqtt.enabled` 管理 broker 和 bridge 单元，
但该设置本身不进入 MQTT。bridge 在镜像中默认禁用，以静态非特权用户运行，
默认模式为 `read-only`。

## 6. mosd 服务注册表

mosd 另行观察其他 `com.mos.*` 服务，供运维诊断使用。注册表不是 MQTT 数据源，
也不会授予 MQTT 资格；它只记录名称、class、连接状态、实例、冲突和合规
缺口，绝不把第三方服务的任意 item 值复制到系统状态。

合规服务从认领名称起就在 `/` 提供 `GetItems`，并包含
`/Mgmt/ProcessName`、`/Mgmt/ProcessVersion`、`/Mgmt/Connection`、
`/DeviceInstance`、`/ProductId`、`/ProductName`、`/Connected`。缺少接口、路径、
有效实例时只记录 `conformance`，不会丢弃条目；断开的条目保留到运维人员调用
`ForgetService`。注册表描述所有 `com.mos.*` 服务，而 MQTT 仍只接纳准确登记的
应用服务。

## 7. Sparkplug B

Sparkplug B 当前未实现。未来若增加独立发布器，也必须复用同一套“准确登记、明确
授权、硬性排除 mosd”准入边界，不能重新引入系统管理树。
