# 应用

Mica OS 支持两条应用交付路径，区别在于谁发布、何时发布：

1. **原生应用**在构建时以 Debian 包的形式组合进签名系统镜像。它们与操作
   系统一起更新和回滚，在同一个签名 A/B bundle 里，并且是集成商能力——
   没有设备上的软件包安装，设备上永远没有 `apt`。
2. **容器**是独立发布的路径：由 podman 通过 systemd 的 Quadlet 生成器运行
   的固定摘要 OCI 镜像，按集成商自己的节奏交付与更新，在 OS 更新中原样
   保留。

两条路径的默认客户都是受信任的产品集成商，不是不受信任的应用市场——
其安全后果在下文直白陈述。

## 1. 怎么选

决定它的问题不是代码怎么写，而是：**这段代码可以比操作系统落后一个
发布吗？**如果答案是不行，它就是原生的。其余一切都由这一个答案推出，
下表每一行都是设备的事实，而不是偏好：

| | 原生软件包 | 容器 |
|---|---|---|
| 谁决定它何时发布 | OS 发布决定 | 你自己独立决定 |
| 是否在签名镜像里 | 是 | 否——镜像在运行时拉取 |
| 谁为它签名 | 签名部署记录，以及内核验证的 dm-verity 根哈希签名 | 今天没有任何东西 |
| OS 回滚会不会把它带回去 | 会，与 OS 一起原子回滚 | 不会——它跨过回滚继续运行 |
| 它的失败会不会让 OS 回滚 | 不会——失败的 unit 只被上报，不致命；只有健康闸**要求**的成员才会让 OS 回滚，而任何应用都不在那个集合里 | 不会——没有东西盯着它 |
| 代码放在哪 | 只读 verity 根 | DATA 上的 `/mos/containers/storage` |
| 运行中的设备上能否更改 | 不能 | 能——`/etc/containers/systemd` 里的一个文件 |
| 是否需要打开容器开关 | 不需要 | 需要 |

有两条后果值得读两遍。两条路径的失败本身都不会让 OS 回滚：健康闸只要求
一个点名的小集合——启动事务已完成、mosd 应答、apid 应答——应用的 unit 不在
其中，所以更新后的崩溃循环留给你的是一台还能跑的设备加一个坏掉的应用，
而不是一次回滚。这是有意的；被回滚进一个未必能跑的部署，比留下一台你能连上、
能修的设备更糟。而容器会原样跨过 OS 回滚，这在两者按不同节奏发布时是
特性，在应用依赖旧 OS 没有的东西时是隐患。

两条路径都不会回滚应用的**数据**。那是第 6 节。

各自的集成商指南是
[../../design/native-applications.md](../../design/native-applications.md) 与
[../design/containers.md](../../design/containers.md)（前者目前只有英文）。

> status: shipped — evidence: `docs/design/native-applications.md`, `docs/design/containers.md`

## 2. 原生应用：镜像里的软件包

根文件系统由本地 Debian 包池在固定基底上以一次 APT 事务组合而成。集成商
的原生服务就是包池里多出的一个 producer：一个 `.deb`，携带二进制、其加固
的 systemd 单元、以及自己的启用符号链接。依赖顺序用 `Depends` 表达；添加
组件是添加一个 producer，不是编辑构建阶段。结果封在 verity 密封的根里，
只能通过发布新的签名镜像来更新。

> status: shipped — evidence: `docs/design/build.md`, `build-env/deb/`, `rootfs/packages/`, `make os-debs`

集成商指南——[../../design/native-applications.md](../../design/native-applications.md)——
覆盖 producer 约定、专用服务账户、可写状态归属、健康与日志、按名字的设备
访问，以及 CPU、内存、PID 和 I/O 上限。它的样例就是本仓库真正构建的软件
包，它指向源码树的引用由 `make docs-verify` 解析，所以它点名的文件不可能
悄悄消失。

> status: shipped — evidence: `docs/design/native-applications.md`, `make docs-verify`

## 3. 容器：podman 与 Quadlet

镜像随附引擎（podman、crun、conmon、netavark、aardvark-dns、Quadlet
生成器），从固定版本的上游源码构建。Mica OS 不做容器编排：你用 systemd 的
语言描述工作负载——`.container`、`.network`、`.volume` 文件——由 Quadlet
把它们变成单元。带测试样例的集成商指南是
[../design/containers.md](../../design/containers.md)；其中每个样例都由测试
套件送进随附的生成器（`make os-quadlet-doc-test`），因此失效的样例会让
构建变红，而不是留在文档里。

操作员需要的运行事实：

- **一个开关。**设置树中的 `container.enabled`，默认 `false`。它为 false
  时什么都不运行，也不存在任何容器单元。通过认证 API 或 UI 的 Services
  页面设置。
- **定义放哪。**`/etc/containers/systemd`，它绑定到一个 DATA/state 支持的
  目录——定义在重启和 A/B 更新中保留。添加或修改文件后：
  `systemctl daemon-reload`，然后启动单元。
- **数据放哪。**命名卷落在 DATA 上的 `/mos/containers/storage`；bind mount
  主机路径放在 `/srv` 下。绝不要用 `/var`——它小、可丢弃、按设计会被清空
  （[storage.md](storage.md)）。
- **日志**进 journal（`journalctl -u <name>.service`），它是易失的。
- **没有自动镜像更新。**没有 auto-update 定时器；拉取新镜像并决定何时
  重启是安全的，属于集成商——理由与 OS 更新采用 A/B 且刻意为之相同。

> status: shipped — evidence: `docs/design/containers.md`, `make os-quadlet-doc-test`, `pkgs/podman/versions.env`

两条安全事实，按设计记录的原话陈述：

- **容器以 root 运行。**rootless 模式没有构建。任何能写 Quadlet 文件的
  东西都能以 root 的能力运行代码；这正是那个开关所把守的，也是它默认
  关闭的原因。
- **镜像签名不做验证。**随附策略接受一切；保护一次拉取的是 registry TLS
  和摘要引用。收紧它是构建时的改动，因为策略文件在只读根里——容器指南
  写明了机制，以及它必须从哪里进来。

> status: shipped — evidence: `docs/design/containers.md`

### 安全地发布一个容器版本

集成商在这条路径上要做的四个决定，容器指南里都有经过测试的样例：

- **按摘要固定，并从你验证过的东西启动。**tag 是别人可以移动的指针；
  `Image=...@sha256:...` 是内容本身。再加上 `Pull=never`，单元要么运行
  设备上已有的镜像，要么根本不启动，而不是在启动时无人值守地去找
  registry。
- **registry 凭据由你放置和轮换。**`podman login --authfile` 写到你指定的
  位置；把那个路径放在 DATA/state 上，让它挺过更新，因为 podman 对 root 的
  默认位置在 tmpfs 上。该文件是编码的，不是加密的，Mica OS 不管理它。
- **回滚是手工的，并且需要旧镜像。**把 `Image=` 改回上一个摘要再重启。
  这只在旧镜像还留在设备上时有效——`podman image prune` 会删掉它，之后
  回滚就需要 registry。
- **数据兼容性归你。**见第 6 节。

> status: shipped — evidence: `docs/design/containers.md`, `make os-quadlet-doc-test`

## 4. 总线上的应用，与 MQTT

管理面与应用数据由契约分离。想发布实时数据的应用在众所周知的名字
`com.mos.<class>[.<suffix>]` 下暴露 `com.mos.Item1` 接口，`mos-mqttd` 桥
**只**把由其软件包登记、按精确名字匹配的服务镜像到本地 MQTT broker，使用
`N/R/W/<deviceId>/<class>/<instance>/<path>` 语法。管理关注点——网络、
SSH、凭据、更新、电源、容器启用——永远不是 MQTT item，桥在结构上无法
寻址管理守护进程。完整契约，含登记、D-Bus 策略、冲突处理与默认只读桥
模式，见 [../design/bus.md](../../design/bus.md)。

> status: shipped — evidence: `docs/design/bus.md`, `pkgs/mosd/mqttd/`

## 5. 应用 UI

apid 可以用集成商的 Web UI 替代内置 UI。在内置界面的 System → UI 版本页上传由
`mos-ui-pack` 生成的 `.mos-ui.zip`；系统校验后把它作为未激活版本保留在 DATA 的
`/mos/ui`。可以保留多个版本、精确选择一个在 `/` 提供、回到内置 UI，并删除 inactive
版本。无论自定义 bundle 状态如何，内置 UI 始终在 `/_ui/` 可达——坏掉的自定义 UI
永远不会把你锁在管理面之外。见 [api.md](api.md)。

> status: shipped — evidence: `docs/design/api.md`, `pkgs/mosd/apid/openapi.json`

在外接屏幕上渲染同一 UI 的专用 HDMI kiosk 是一份设计，本仓库中没有已发布
的实现。

> status: unsupported

## 6. Mica OS 不强制什么

上面的一切，对一个受信任的产品集成商来说，都是文档与经过测试的约定。
它们都不是能拒绝一个发布的机制，而这个区别对要决定向客户承诺什么的人
最重要。

一个受管应用平台会有、而这个平台没有的四项控制：**镜像签名准入**——
随附的容器策略接受任何镜像，启动时不检查任何签名；**强制资源上限**——
CPU、内存、PID 和 I/O 限制在两条路径上都有文档和测试，但没有任何东西
要求它们，所以一个不带任何上限的单元照样被启动；**密钥存储**——
registry 凭据和应用密钥都是有人放在 DATA/state 上、root 可读的文件，Mica OS 不
创建、不轮换、不托管、不审计它们；以及**自动应用回滚**——两条路径上
都没有健康闸盯着一次应用更新。

> status: unsupported

最后一条在原生侧有一个限定，往哪个方向读过头都不对，而且它比过去更窄了。
原生代码继承整个部署的 A/B 回滚，但健康闸不会因为一个应用失败就触发它：健康闸
只要求这个部署还能被**恢复**——启动事务已完成、mosd 应答、apid 应答——其余
一律只上报。一个把设备彻底赶下网的应用会让健康闸失败；一个只是崩溃的应用
不会。回滚真的发生时，它不是按应用的——它一次搬动设备上的每一个应用，而且
一个应用的**数据**都不搬。DATA/state 和其他 DATA 命名空间按设计在 A/B 部署之外，这正是它们能
挺过更新的原因；后果是：一个在更新后首次启动时迁移了自己 schema 的应用，
在任何回滚之后都是旧版本指着新数据。那份契约由集成商自己写、自己测，
两条路径都一样。

> status: shipped — evidence: `rootfs/overlay/usr/lib/mos/mos-health`, `docs/design/native-applications.md`

受管与不受信任应用的控制——独立签名的应用 bundle、可分发的容器信任
策略、能拒绝一个发布的准入、受保护的密钥存储、审计轨迹，以及按应用的
健康闸回滚——是另一个产品，另一份成本。其设计见
[托管应用](../../design/applications.md)；尚未实现，也不在上面的指南里描述。

> status: proposed — evidence: `docs/task/20260912-2058-managed-applications.md`
