# 配置

mos 的配置是一棵单一的类型化设置树，由管理守护进程（`mosd`）拥有，持久化
在 STATE 分区上，并由驱动底层系统服务的协调器（reconciler）应用。每一种
受支持的改变设备的方式都汇聚到一条经过校验的写入路径；没有任何东西绕过
守护进程改文件。本页覆盖模型、通道、今天可配置什么，以及——在一个不可变
系统上同样重要的——什么不可配置。

## 1. 模型：三层

配置设计（其记录是 [../design/provisioning.md](../design/provisioning.md)）
把配置组织为三层：

1. **第 1 层——首次启动自我配置。**从空 STATE 出发，设备离线、恰好一次地
   播种身份、主机名、密钥和默认值。已发布；见 [first-run.md](first-run.md)。
2. **第 2 层——本地配置通道。**操作员改变设置的途径。今天恰好实现了一个：
   认证 HTTPS API（内置 UI 是它的客户端）。设计中的离线通道（启动介质
   配置文件、签名 USB 投放、强制门户、HDMI 向导、串口向导）是排好序的
   意图，不是代码。
3. **第 3 层——构建时嵌入配置。**不存在，且是有意的：没有机制把机群配置
   或凭据烘焙进镜像，构建会对其中凭据的那一半做断言。

> status: shipped — evidence: `docs/design/provisioning.md`, `pkgs/mosd/mosd/`

## 2. 存在的那个通道：API 与内置 UI

所有配置读写都通过 HTTPS 到达 apid——经由 `/ui` 的内置 UI，或 `/api/v1`
下的 JSON API（契约：`pkgs/mosd/apid/openapi.json`，见 [api.md](api.md)）。
apid 自身不持有状态；它通过本地系统总线转发给 mosd，写入在那里对照类型化
schema 校验。被拒绝的写入不会触碰设置树，而一次设置写入会返回一个任务，
你可以观察它直到对应的协调器完成应用。

设置持久化在 STATE 上，因此重启和 A/B 更新都不会丢失。

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
- **电源动作与更新动作**——不是设置，但通过同一认证面可达。

权威清单是 API 契约，不是这段散文：`pkgs/mosd/apid/openapi.json` 接受什么，
设备就支持什么。

> status: shipped — evidence: `pkgs/mosd/apid/openapi.json`, `pkgs/mosd/mosd-settings/`

WiFi 的有无取决于板卡：cx3576 带 WiFi 和蓝牙；x64 QEMU 基线没有无线电。

> status: board-dependent — evidence: `boards/cx3576/board.env`

## 4. 未建模的设置就是不受支持的设置

根文件系统是受 verity 保护的只读 squashfs。没有 `/etc` overlay，将来也不会
有：对 `/etc` 的编辑要么直接失败，要么落在内存里并在重启时消失。任何必须
持久化的东西都必须在设置树中建模并由 API 暴露——如果 API 设置不了它，
这台设备就不支持持久化它。刻意的例外（绑定到 STATE 或 DATA 上的路径，例如
`/etc/ssh` 或 Quadlet 目录）在设计记录中逐一列出；集成商的文件、脚本和
数据属于 DATA（[storage.md](storage.md)）。

> status: shipped — evidence: `docs/design/access.md`, `docs/design/ro-root.md`

## 5. 已知缺口

### 5.1 时间

今天没有受支持的 NTP 服务器或时区运行时配置，rootfs 中也没有启用的网络
时间服务。计划将加入常开的 `systemd-timesyncd`、类型化的
`time.ntp.servers` 与 `time.timezone` 设置，以及通过 API 的同步状态。

> status: proposed — evidence: `docs/plan/PLAN-044.md`

TODO(PLAN-044): revisit after this plan merges

### 5.2 离线配置通道与可重复配置

第 1 节中的离线配置通道与工厂注入，以及一份可以跨设备幂等应用的、带版本
且经过校验的配置文档，规划在安装/接入计划之下。今天，配置是在既有网络上
通过一次次 API 写入来应用的。

> status: proposed — evidence: `docs/plan/PLAN-046.md`

TODO(PLAN-046): revisit after this plan merges
