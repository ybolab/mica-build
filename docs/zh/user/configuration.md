# 配置

Mica OS 的配置是一棵单一的类型化设置树，由管理守护进程（`mosd`）拥有，以 JSON
文档的形式存放在数据分区的 `/mos/config/` 下，并由驱动底层系统服务的协调器
（reconciler）应用。每一种
受支持的配置方式都使用类型化 schema：在线修改通过认证 API，离线文件在启动时校验。本页覆盖模型、通道、今天可配置什么，以及——在一个不可变
系统上同样重要的——什么不可配置。

## 1. 模型：三层

配置设计（其记录是 [../design/provisioning.md](../../design/provisioning.md)）
把配置组织为三层：

1. **第 1 层——首次启动自我配置。**从空的 DATA/state 出发，设备离线、恰好一次地
   播种身份、主机名、密钥和默认值。已发布；见 [first-run.md](first-run.md)。
2. **第 2 层——本地配置通道。**认证 HTTPS API 与内置 UI 支持在线修改；
   启动介质或可移动介质上的配置文档可离线配置尚未认领的设备。集成商也可在
   设备停止运行时准备规定的 `/mos/config/` 文件，启动时先校验再应用。
3. **第 3 层——构建时默认值。**镜像清单提供更新、机群配置的默认值和固定的
   信任材料。操作员文档可以覆盖受支持的配置键，但不能替换签名密钥。
   这不是一套通用的工厂凭据注入工具链。

> status: shipped — evidence: `docs/design/provisioning.md`, `pkgs/mosd/mosd/`

## 2. 在线配置：API 与内置 UI

在线配置读写通过 HTTPS 到达 apid——经由 `/_ui/` 的内置 UI，或 `/api/v1`
下的 JSON API（契约：`pkgs/mosd/apid/openapi.json`，见 [api.md](api.md)）。
apid 持有浏览器会话和 API 支持状态；设置修改通过本地系统总线转发给 mosd，写入在那里对照类型化
schema 校验。被拒绝的写入不会触碰设置树，而一次设置写入会返回一个任务，
你可以观察它直到对应的协调器完成应用。

**设置存在哪里，以及这对复位意味着什么。**系统配置——hostname、网络、WiFi、
SSH、MQTT、时间、容器开关和更新设置——按子系统各写成一个 JSON 文档，放在数据
分区的 `/mos/config/` 下。设备关于*自身*铸出或观测到的东西留在 DATA/state 上：设备
身份、管理员凭据、API token。两者都能挺过重启和 A/B 更新，因为一次更新只写 SYSTEM
上的部署。

这个划分是复位边界，而不是一个存储细节：**一次配置重置会把 `/mos/config/` 下
的一切还原成镜像构建时的取值**，并保留管理员凭据——这正是那一层属于设置动作而
不是锁死的原因。动手之前请读 [recovery.md](recovery.md) 第 3 步：更新服务器地
址也会一起还原，而当镜像本身没有指定服务器时，这会让设备从此没有服务器。

> status: shipped — evidence: `pkgs/mosd/apid/openapi.json`, `docs/design/mosd.md`

## 3. 今天可以配置什么

设置树目前按子树建模：

- **hostname**；
- **network**——按名字列出的有线接口，各自声明一种类型：物理、`vlan`、
  `bridge` 或 `wireguard`，渲染成 systemd-networkd 单元。WireGuard 隧道的
  私钥在设备上生成，永不进入设置树；轮换是一个显式的 API 动作；
- **wifi.client** 与 **wifi.ap**——WiFi station 和接入点角色，驱动
  wpa_supplicant 和 hostapd（AP 为配置接入和产品用途而存在；无线电是
  板卡事实）；
- **access.ssh**——SSH 启用、端口、监听地址、授权密钥，以及围绕临时 root
  密码的策略（见 [security.md](security.md)）；
- **container.enabled**——控制容器运行时的单一开关
  （[applications.md](applications.md)）；
- **mqtt**——本地 MQTT broker 与应用数据桥
  （[applications.md](applications.md)）；
- **time**——时间来源与同步策略（第 5.1 节）；
- **电源动作与更新动作**——不是设置，但通过同一认证面可达。

**更新设置不在这棵树里。**更新模式、渠道、服务器地址、维护窗口和网络模式住在
它们自己的文档 `/mos/config/updates.json` 里，与上面那些并列，而不在设置 schema
之内。它们有自己的路由——`POST /api/v1/update/config`，只收你要改的那些键——内置
UI 的自动更新面板就是驱动它的。
[update-rollback.md](update-rollback.md) 讲每一项各自做什么。

权威清单是 API 契约，不是这段散文：`pkgs/mosd/apid/openapi.json` 接受什么，
设备就支持什么。

> status: shipped — evidence: `pkgs/mosd/apid/openapi.json`, `pkgs/mosd/mosd-settings/`

WiFi 的有无取决于板卡：cx3576 带 WiFi 和蓝牙；x64 QEMU 基线没有无线电。

> status: board-dependent — evidence: `boards/cx3576/board.env`

## 4. 未建模的设置就是不受支持的设置

根文件系统是受 verity 保护的只读 squashfs。没有 `/etc` overlay，将来也不会
有：对 `/etc` 的编辑要么直接失败，要么落在内存里并在重启时消失。任何必须
持久化的东西都必须在设置树中建模并由 API 暴露——如果 API 设置不了它，
这台设备就不支持持久化它。刻意的例外（绑定到 DATA/state 或 DATA 上的路径，例如
`/etc/ssh` 或 Quadlet 目录）在设计记录中逐一列出；集成商的文件、脚本和
数据属于 DATA（[storage.md](storage.md)）。

> status: shipped — evidence: `docs/design/access.md`, `docs/design/ro-root.md`

## 5. 刻意的限制，以及还缺什么

### 5.1 时间

网络时间已经不再是缺口，但关于它有两件事是刻意的限制，而不是遗漏。

`systemd-timesyncd` 已安装并静态启用，因此始终在跑：**没有任何启用、停用或
暂停控制**——设置树里没有，API 里没有，UI 里也没有。设置只有两个，且只有两个：
`time.ntp.servers`（一个经过校验的列表；留空表示使用镜像内置的备用池）和
`time.timezone`。`GET /api/v1/time/status` 报告内核是否已把时钟误差限定在界内
（`synchronized`），还是仅仅有服务器在应答（`polling`）；报告那是哪台服务器，
以及最近一次校正是阶跃还是缓变。

**机器的时间永远是 UTC，时区只用于呈现。**`time.timezone` 从不被写入
`/etc/localtime`——镜像不烘焙任何时区，构建也会拒绝一个——因为那个符号链接会
被每一个 UTC 消费者读到，journald 也在内。时区作为一个运行时值发布，供 UI
格式化使用，仅此而已。

网络时间之下还有一层时钟下界，因此一台没有 RTC 或 RTC 电池已耗尽的设备，
启动后的时间也不会早于它上一次被确知在运行的那一分钟：保存的时钟在 DATA/state 上，
跨重启与 A/B 更新都保留。PTP、NTS 和可配置的轮询周期不在范围内。

**未在硬件上验证：**cx3576 的设备树声明了一个 RTC，其驱动与备用电源都没有在
台架板卡上验证过。本页没有任何内容依赖 RTC 存在——那正是时钟下界的用途——但
"跨长时间断电仍保持时间"这件事没有被演示过。

> status: shipped — evidence: `docs/design/time.md`, `pkgs/mosd/mosd/src/time_status.rs`

> status: board-dependent — evidence: `boards/cx3576/bsp/kernel/dts/rk3576-cx3576z.dts`

### 5.2 离线配置通道与工厂注入

一份带版本、经过校验的配置文档如今已经存在，并在网络上还没有任何东西监听
之前就从介质上被应用：固定文件名的一个 TOML 文件、整份文档一起校验、应用一次
并记录下来，走两条离线传输（[first-run.md](first-run.md)）。它就是为一台从未
联过网的设备做配置的可重复路径。

> status: shipped — evidence: `docs/design/provisioning.md`, `pkgs/mosd/mosd/src/provisioning_doc.rs`

**设计列出的五条通道里有三条不存在**，而且每一条都是需要绕开的缺失，而不是
在做的工作：AP 强制门户只有传输、没有门户本身；HDMI 本地设置向导只有浏览器
客户端，没有能把它跑在设备自己屏幕上的 kiosk 与输入链路；串口控制台向导从未被
构建。已发布的可移动介质路径也既不验签名、也不在热插拔时导入——介质只在启动时
被读取一次。工厂注入同样没有——带版本的输入、注入时验证与每设备记录写在
[manufacturing.md](manufacturing.md) 里，没有任何工具支撑。离线准备规定的
`/mos/config/` 文件需要先停止设备；在线修改通过既有网络上的认证 API 完成。

> status: unsupported
