# 首次启动与初始设置

一台 mos 设备必须在零外部输入的情况下到达完全可用的状态——没有 DHCP
服务器、没有 DNS、可能连网线都没有。这一性质是设计出来的，不是偶然的。
本页描述首次启动时实际发生了什么，以及之后你如何认领这台设备。

## 1. 设备自己做了什么

从空 STATE 的首次启动开始，管理守护进程一次性、原子地播种设备配置，
先于任何消费它的东西：

- 一个**设备 id**——从系统 CSPRNG 取出的 32 个十六进制字符；
- 一个**主机名**——`mos-` 加设备 id 的前八个十六进制字符。它派生自身份
  而不是网络，因此跨子网、跨租约续期、跨网卡更换都保持稳定，并且短到
  可以印在标签上；
- 每设备密钥，在设备上铸造——绝不烘焙进镜像，因为同一发布版的镜像在
  每台设备上字节相同；
- **SSH 关闭**，两个镜像 profile 都是如此；
- **没有网络配置**——这是有意的。镜像内置一条针对有线 `eth*` 接口的静态
  DHCP 匹配，所以一台新设备在任何 DHCP 网络上都能获得地址，mosd 不必
  猜测接口名。

播种失败会大声中止，下一次启动从头重试；一台看起来配置好了其实只配置了
一半的设备，正是这个设计拒绝的失败。SSH 主机密钥在首次启动时于设备上
生成，DATA 扩展到占满磁盘（见 [install.md](install.md)）。

> status: shipped — evidence: `docs/design/provisioning.md`, `rootfs/overlay/usr/lib/mos/mos-seed-state`

在 cx3576 上，设备还会在首次启动时把 machine id 持久化到冗余的 U-Boot
环境中，因此从第二次启动起 `/etc/machine-id` 保持稳定；在没有可写引导
加载环境的板卡上该单元不生效，machine id 每次启动都是临时的。

> status: board-dependent — evidence: `rootfs/overlay/usr/lib/mos/mos-machine-id`, `boards/cx3576/boot.cmd`

## 2. 找到设备

- 在 DHCP 网络上：设备在其有线接口上请求地址，并向 DHCP 服务器通告
  `mos-xxxxxxxx` 主机名。无论 DNS 如何，它自己的名字在设备本地总能解析。
- 管理面是设备地址上**走 HTTPS 的 apid**（端口 443，端口 80 重定向）。
  TLS 证书按设备生成，所以第一次访问会出现自签名证书警告——这是预期的，
  值得向操作员解释清楚，而不是训练他们在别处也忽略警告。

> status: shipped — evidence: `pkgs/mosd/apid/`, `docs/design/remote-management.md`

## 3. 认领设备：初始设置

第一次访问内置 UI 的 `/ui`（或 `GET /api/v1/session`，它向 API 客户端报告
设置状态）会进入**初始设置**：你创建管理员凭据。设置过程建立一个浏览器
会话，并为纯 API 客户端返回一次性 bearer token。从这一刻起，每一次管理
读写都需要认证；会话与 token 模型见 [api.md](api.md)，接下来配置什么见
[configuration.md](configuration.md)。

初始设置不是的两样东西：

- 它不是 SSH 凭据。SSH 保持关闭，直到经过认证的管理员启用它并安装密钥——
  访问模型见 [security.md](security.md)。
- 它不可由设备找回。丢失管理员凭据和所有已授权 SSH 密钥后，**没有任何
  软件路径可以回到设备里**；[recovery.md](recovery.md) 写明了这要付出
  什么代价。请相应地保管凭据。

> status: shipped — evidence: `pkgs/mosd/apid/openapi.json`, `docs/design/access.md`

## 4. 工厂与离线接入

今天，改变配置的唯一方式是在既有网络上走认证 API（另加物理控制台上的
临时 root 密码，用于 SSH 级访问建立之后）。离线配置*通道*——启动介质上的
配置文件、签名 USB 配置投放、AP 强制门户、HDMI 设置向导、串口向导——是
一份经过设计、排好顺序的清单，带一条不变式（每个通道都汇聚到同一条经过
校验的设置写入路径），但没有一个已实现。初始配置的工厂注入和一个有边界
的设备认领流程属于同一份计划。

在那落地之前，工厂/离线的现实是：设备离线自我配置到可用状态（第 1 节），
而认领和配置它需要把它放到一个你控制的网络上。

> status: proposed — evidence: `docs/plan/PLAN-046.md`, `docs/design/provisioning.md`

TODO(PLAN-046): revisit after this plan merges
