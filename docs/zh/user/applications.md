# 应用

mos 支持两条应用交付路径，区别在于谁发布、何时发布：

1. **原生应用**在构建时以 Debian 包的形式组合进签名系统镜像。它们与操作
   系统一起更新和回滚，在同一个签名 A/B bundle 里，并且是集成商能力——
   没有设备上的软件包安装，设备上永远没有 `apt`。
2. **容器**是独立发布的路径：由 podman 通过 systemd 的 Quadlet 生成器运行
   的固定摘要 OCI 镜像，按集成商自己的节奏交付与更新，在 OS 更新中原样
   保留。

两条路径的默认客户都是受信任的产品集成商，不是不受信任的应用市场——
其安全后果在下文直白陈述。

## 1. 原生应用：镜像里的软件包

根文件系统由本地 Debian 包池在固定基底上以一次 APT 事务组合而成。集成商
的原生服务就是包池里多出的一个 producer：一个 `.deb`，携带二进制、其加固
的 systemd 单元、以及自己的启用符号链接。依赖顺序用 `Depends` 表达；添加
组件是添加一个 producer，不是编辑构建阶段。结果封在 verity 密封的根里，
只能通过发布新的签名镜像来更新。

> status: shipped — evidence: `docs/design/build.md`, `build-env/deb/`, `rootfs/packages/`

这条路径的简明且经过测试的集成商指南——打包约定、专用用户、可写路径选择、
设备访问、资源限制——已在计划中但尚未写出；在它落地之前，上面的构建设计
记录和 `rootfs/packages-src/` 下的现有 producer 就是可用的样例。

> status: proposed — evidence: `docs/plan/PLAN-051.md`

TODO(PLAN-051): revisit after this plan merges

## 2. 容器：podman 与 Quadlet

镜像随附引擎（podman、crun、conmon、netavark、aardvark-dns、Quadlet
生成器），从固定版本的上游源码构建。mos 不做容器编排：你用 systemd 的
语言描述工作负载——`.container`、`.network`、`.volume` 文件——由 Quadlet
把它们变成单元。带测试样例的集成商指南是
[../design/containers.md](../design/containers.md)；其中每个样例都由测试
套件送进随附的生成器（`make os-quadlet-doc-test`），因此失效的样例会让
构建变红，而不是留在文档里。

操作员需要的运行事实：

- **一个开关。**设置树中的 `container.enabled`，默认 `false`。它为 false
  时什么都不运行，也不存在任何容器单元。通过认证 API 或 UI 的 Services
  页面设置。
- **定义放哪。**`/etc/containers/systemd`，它绑定到一个 STATE 支持的
  目录——定义在重启和 A/B 更新中保留。添加或修改文件后：
  `systemctl daemon-reload`，然后启动单元。
- **数据放哪。**命名卷落在 DATA 上的 `/srv/containers/storage`；bind mount
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
  和摘要引用。能分发密钥的部署可以收紧策略——容器指南写明了机制。

> status: shipped — evidence: `docs/design/containers.md`

## 3. 总线上的应用，与 MQTT

管理面与应用数据由契约分离。想发布实时数据的应用在众所周知的名字
`com.mos.<class>[.<suffix>]` 下暴露 `com.mos.Item1` 接口，`mos-mqttd` 桥
**只**把由其软件包登记、按精确名字匹配的服务镜像到本地 MQTT broker，使用
`N/R/W/<deviceId>/<class>/<instance>/<path>` 语法。管理关注点——网络、
SSH、凭据、更新、电源、容器启用——永远不是 MQTT item，桥在结构上无法
寻址管理守护进程。完整契约，含登记、D-Bus 策略、冲突处理与默认只读桥
模式，见 [../design/bus.md](../design/bus.md)。

> status: shipped — evidence: `docs/design/bus.md`, `pkgs/mosd/mqttd/`

## 4. 应用 UI

apid 可以用集成商的 Web UI 替代内置 UI 提供服务：安装在 DATA 上 `/srv/ui`
下的自定义 bundle 在 `/` 提供，而无论自定义 bundle 状态如何，内置 UI 始终
在 `/ui` 可达——坏掉的自定义 UI 永远不会把你锁在管理面之外。选择是一个
API 动作；见 [api.md](api.md)。

> status: shipped — evidence: `docs/design/api.md`, `pkgs/mosd/apid/openapi.json`

在外接屏幕上渲染同一 UI 的专用 HDMI kiosk 是一份设计，本仓库中没有已发布
的实现。

> status: unsupported
