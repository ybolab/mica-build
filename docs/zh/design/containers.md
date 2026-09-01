# 在 mos 上跑容器

> [English](../../design/containers.md) | 中文

**mos 不编排容器。** 它提供一个容器引擎，把 `.container` 文件变成 systemd unit，
并给你一个开关把整套能力关掉。什么在跑、按什么顺序、容器之间怎么互相找到、
更新之后什么留下来——这些由你来描述，**用 systemd 的语言，而不是某种 mos 专有格式**。

英文版里的每个示例都由 `tests/quadlet-doc-test.sh` 抽取出来、
喂给镜像里实际发布的那个 Quadlet 生成器，所以一个失效的示例会让测试套件变红，
而不是留在文档里看着像对的。**要抄示例请看英文版**，那里的才是被测试的。

## 1. 设备上有什么

| 二进制 | 路径 | 是什么 |
|---|---|---|
| `podman` | `/usr/bin/podman` | 引擎。无守护进程——`podman run` fork 出 `conmon`，后者 exec `crun` |
| `crun` | `/usr/bin/crun` | OCI 运行时 |
| `conmon` | `/usr/libexec/podman/conmon` | 每容器监视器 |
| `quadlet` | `/usr/libexec/podman/quadlet` | systemd 生成器 |
| `netavark` | `/usr/libexec/podman/netavark` | 网络 |
| `aardvark-dns` | `/usr/libexec/podman/aardvark-dns` | 容器间名字解析 |
| `catatonit` | `/usr/libexec/podman/catatonit` | 容器 init，供 `--init` 用 |

版本锁定在 `pkgs/podman/versions.env`，**从上游源码构建，不取 Debian 的包**。
设备上 `podman --version` 的输出是权威。

**没有 `podman.socket`，也没有 `podman.service`。** 这个镜像没有构建 REST API，
所以**不存在需要加固的引擎套接字**——如果你在找一个可以连的套接字，它不存在。

## 2. 那个开关

管理设置树里的 `container.enabled`，**默认 `false`**。它只通过 APID 读取和写入，
APID 调用 mosd 已校验的 `GetSettings` / `SetSettings` 方法。mosd 不再导出系统
Item1 投影，`mos-mqttd` 也只接纳应用包按准确 `com.mos.<class>[.<suffix>]` 名称登记
的应用，并硬性排除 `com.mos.mosd`，因此容器开关没有任何 MQTT 读写路径。
`mqtt.enabled` 同样留在管理面：系统生命周期开关不属于应用数据。

`false` 意味着**什么都不跑**：`/etc/containers/systemd` 不被挂载，
所以它就是只读根里的一个空目录，生成器找不到文件，也就不存在任何容器 unit。

> **这台设备上的容器以 root 运行。** rootless 模式没有构建，所以容器**没有**被约束到非特权用户。
> 任何能往 Quadlet 目录写入 `.container` 文件的东西，都能在这台一体机上以 root 的能力执行代码。
> 这正是那个开关所守护的，也是它默认关闭的原因。

## 3. 文件放哪

`/etc/containers/systemd` —— 它是 STATE 分区上 `/mnt/state/quadlet` 的一个 bind，
所以你放进去的东西**能挺过重启，也能挺过一次 A/B 更新**。

这个路径不是选择，而是 Quadlet 查找的地方。改动文件后：

```
systemctl daemon-reload      # 重跑生成器
```

## 4–5. 单容器 / 两个互相通信的容器

## 6. 持久化

## 7. 日志

## 8. 镜像

## 9. 起不来时检查什么

## 10. mos 不会替你做的事

不编排、不做健康策略、不做滚动更新、不做服务发现。这些如果需要，**用 systemd 表达**。
