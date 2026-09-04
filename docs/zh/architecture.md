# mos 系统架构

> [English](../architecture.md) | 中文

顶层地图。每节都指向它所概括的设计文档。

---

## 1. mos 是什么

一个嵌入式一体机操作系统：systemd 之下的只读 Debian 根文件系统，以 A/B 槽位整体更新，
由一个小型 Rust 管理面掌管设备设置并驱动 systemd 与之对齐。

| 层 | 是什么 | 位置 |
|---|---|---|
| 系统内核层 | Debian trixie，systemd 作 PID 1，打包为 squashfs 并附加 dm-verity 哈希树 | `rootfs/` |
| 管理面 | `mosd` — 设置树、驱动 unit 的协调器、D-Bus 接口 | `pkgs/mosd/mosd/`，[`design/mosd.md`](design/mosd.md) |
| API | `apid` — HTTPS 守护进程；仪表盘只是它所服务 API 的一个客户端 | `pkgs/mosd/apid/`，`../design/api.md` |
| 应用数据 | `mos-mqttd` 只把应用包按准确名称登记的 `com.mos.<class>[.<suffix>]` item 树桥接到 MQTT；`com.mos.mosd` 被硬性排除 | `pkgs/mosd/mqttd/`、`pkgs/mosd/broker/`、[`design/bus.md`](design/bus.md) |
| A/B 安装器 | RAUC；cx3576 上配合 U-Boot 的 `BOOT_ORDER` 握手，x64 上用 GRUB | `pkgs/rauc/`，`../design/uboot-ab-handshake.md` |
| 更新信任 | TUF 元数据锁定一个 CMS 签名的 RAUC bundle | `pkgs/rauc-sign/`，`../design/release-signing.md` |
| BSP 产物 | 每块板一套 buildkit Dockerfile，产出内核、设备树与引导程序 | `boards/`，[`design/boards.md`](design/boards.md) |
| 工作负载 | podman 加 Quadlet systemd 生成器，默认关闭 | `pkgs/podman/`，`../design/containers.md` |

## 2. 运行时组件

```
                  设置树（TOML，STATE 分区）
                              |
                 mosd  --  com.mos.mosd1，系统总线
     _________________________|________________________
    |          |            |          |       |
  apid     协调器      RAUC 控制      sshd   podman
  HTTPS    wifi/sshd  InstallUpdate  OpenSSH  Quadlet
  API +    hostname   GetUpdateState  由 mosd  unit
  仪表盘   network    MarkUpdate      驱动    默认关
           mqtt/container
                 |
      /run/mos/mqttd-device.env -> mos-mqttd -> MQTT
                                          |
                           准确登记的 com.mos.* 应用
```

- **systemd 是 PID 1。** 上面每个部件都是一个 unit。mosd 启停并重新渲染这些 unit，
  而不是自己去监管进程。
- **`mosd`** 掌管持久化在 STATE 上的设置树，以 `com.mos.mosd` 暴露到系统总线，
  每个关注点跑一个协调器。它的 unit 是 `Type=dbus`。
- **`apid`** 终结 TLS、认证操作者，并通过总线调用 mosd 来读写设备状态。它的 TLS 材料、
  登录退避计数和审计环存放在 `/var/lib/mos/apid`。仪表盘是它的客户端之一，
  `pkgs/mosd/apid/openapi.json` 由处理函数生成。
- **网络**是 mosd 的 `network`、`wifi.client`、`wifi.ap` 三棵子树，协调进
  systemd-networkd、wpa_supplicant 与 hostapd 的 unit。无线那半以 `connd` 之名记录，
  但它是**一对协调器，不是一个进程**。
- **接口种类。** 一条 `network` 条目声明一个**种类**——物理、`vlan`、`bridge` 或
  `wireguard`——以及与之配套的那一个可选块。**块是权威的，接口名不是**：`eth0.100`
  是约定而非声明。物理条目渲染一个 `.network` 文件；另外三种还会额外渲染一个
  `.netdev` 来创建设备，而挂接关系写在**对端**接口的 unit 上（父接口上的 `VLAN=`、
  端口上的 `Bridge=`）。被移除的虚拟条目会被拆除，而不只是取消链接。WireGuard 隧道的
  私钥在设备上生成，落在设置文件旁的 `networkd-secrets/` 目录里，**绝不进入设置树**。
- **`mos-mqttd`** 只动态发布应用包按准确名称登记的
  `com.mos.<class>[.<suffix>]` item 树；full 模式的写入也只发往准确的应用服务。
  它对 `com.mos.mosd` 没有任何 D-Bus 权限；mosd 通过一个专用 `/run` 文件传入 topic
  标识。SSH、网络、凭据、容器、MQTT 配置、健康、更新和电源都留在管理面，
  不会成为 MQTT item。`mos-mqtt-broker` 是基于 `rumqttd` 的本地 broker。
- **容器**经 podman 与 Quadlet 生成器运行。只要 `container.enabled` 为假（默认），
  `/etc/containers/systemd` 就不挂载，也不存在任何容器 unit。

## 3. 存储与启动

整盘一张 GPT，分区集合由每块板的 `boards/<board>/board.env` 声明。cx3576 上：

```
loader | uenv-a | uenv-b | boot-a | boot-b | rootfs-a | rootfs-b | meta | state | ephemeral | data
```

x64 则用一个 ESP 取代 loader 和两个 U-Boot 环境分区。

- **根是只读的。** 每个 `rootfs-` 槽位放一个 squashfs 镜像，并附加它的 dm-verity 哈希树。
- **正常启动路径上没有 initramfs。** verity 设备完全由内核命令行上的 `dm-mod.create=`
  描述，按槽位从该槽的 verity 参数和板级 `BOARD_CMDLINE_ARGS` 拼出。
- **每个 boot 槽位携带** `Image`、设备树、共用的 `boot.scr`，以及一个存放该槽 verity
  参数的 `mos-verity-<slot>.env`。**刻意不放** `extlinux/extlinux.conf`——U-Boot 会先试
  extlinux，放一个在那里就会绕过握手。
- **握手**是 `BOOT_ORDER` 加上冗余 U-Boot 环境（`uenv-a` / `uenv-b`）里的按槽尝试计数。
  启动失败的槽位烧掉自己的额度，下次复位就轮到另一个。
- **四层存储**回答"这份数据丢了会怎样"：STATE（`/mnt/state`，配置与身份）、
  DATA（`/mnt/data`，对外分为系统使用的 `/mos` 与用户使用的 `/srv`）、META（`/mnt/meta`，更新元数据）、
  EPHEMERAL（`/var`，可丢弃的残留）。

## 4. 信任链

```
内核命令行上的 dm-verity 根哈希 -> 运行时逐块校验根文件系统
RAUC bundle -> CMS 签名，对 /etc/rauc/keyring.pem 验证
TUF 元数据  -> 四把 ed25519 角色密钥，root 离线；锁定 bundle 的 sha256、
               长度与 verity 根哈希
```

一次发布由**两套互不相关的体系各签一次**，这种分离正是要点：TUF 的在线密钥签不了
bundle，bundle 的密钥也签不了元数据。

有两处缺口是**记录在案**而非默认成立的：构建过程不签 SPL 和 U-Boot；镜像里不带生产
keyring。

## 5. 访问模型

**配置下发和调试是两个不同的问题，mos 不用同一个 shell 去回答两者。** 目前有三条路进去：

1. **API**，走 HTTPS，由设置树里的 argon2id 口令哈希认证，带持久化的登录退避计数和审计环。
2. **SSH** —— OpenSSH，配置它的那一个文件由 mosd 渲染。两种 profile 都发布，
   两种都默认关闭；持久访问靠公钥，root 口令是临时性的例外。
3. **物理恢复** —— RockUSB loader 路径与整盘重刷，位于操作系统之下，在其他手段都不通时可用。

关闭是**分层**的，已发布两层：运行时开关（`enabled: false` 会停止并禁用 `ssh.service`），
以及构建期镜像 profile（`dev` 或 `prod`，写在 verity 根内的 `/usr/lib` 里，所以生产设备
无法被改成开发设备）。两者之间的单向 META 锁定**已设计但未实现**。

## 6. 仓库结构

```
mos/
├── docs/          计划（plan/）、任务（task/）、设计（design/）、中文（zh/）
├── boards/    每板一个 board.env——分区几何与全部布局常量——外加该板 BSP
├── build/     TypeScript：镜像装配器、bundle 构建器、工具封装
├── build-env/ 每个组件构建所 FROM 的固定构建器镜像
├── pkgs/      本仓库编译成发布产物的源码：podman/、rauc/、rauc-sign/、
│              以及 mosd/ Rust 工作区（mosd、apid、mos-mqttd、
│              mos-mqtt-broker、mosd-settings）；工作区级黑盒测试统一放在 mosd/tests/
├── rootfs/    根文件系统：compose/（两个组合 Dockerfile）、packages/（清单与解析器）、
│              packages-src/（system、profile、射频、CA 信任库四个 producer），加 build.sh
├── tests/     针对已构建镜像的 shell 套件
├── tools/     QEMU 辅助脚本
├── verify/    TypeScript：板卡模型，以及装配后镜像必须通过的检查
└── Makefile       顶层路由；`make help` 列出全部目标
```

根文件系统是**组合**出来的：一次 APT 事务把解析出来的一组 mos `.deb` 包从本地包仓库
`_out/debs/<arch>/` 装到一个按 digest 固定的 Debian 基底上，再由一个收尾器封根并打包
（`rootfs/compose/`，两个文件）。**镜像里有什么就是一份包清单**，而决定配置顺序的是
`Depends`——新增一个组件是新增一个 producer，不是新增一个阶段。完整模型见
`docs/design/build.md` 1.1 节。

## 7. 板卡

- **`cx3576`** —— CX3576-Z，Rockchip RK3576，arm64。厂商内核树，U-Boot 用主线源码在
  `boards/cx3576/bsp/uboot/` 构建，带 WiFi 和蓝牙。它的 RAUC 引导后端是 `uboot`，
  `BOOT_ORDER` 握手就是为这块板做的。
- **`x64`** —— 通用 UEFI x86_64，QEMU 与 CI 的基准。它的 `bsp/` 只构建一个主线内核：
  固件本身就是启动链，没有引导程序要编。引导后端是 `grub`。

**板卡产出产物，操作系统构建消费产物**，两边都不伸手进对方的构建里。内核配置必须满足
`boards/common/mos-required.fragment` 里的共享断言集。

## 8. 接着读什么

| 问题 | 文档 |
|---|---|
| mosd 掌管什么？设置树里有什么？ | [`design/mosd.md`](design/mosd.md) |
| 设备怎么拿到第一份凭据？ | [`design/provisioning.md`](design/provisioning.md) |
| 怎么进设备做调试？ | [`design/access.md`](design/access.md) |
| 新增一块板要做什么？ | [`design/boards.md`](design/boards.md) |
| 总线上有什么？ | `../design/bus.md` |
| HTTPS API 提供什么？ | `../design/api.md` |
| 根为什么只读？写去哪了？ | `../design/ro-root.md` |
| 更新怎么到另一个槽位并提交？ | `../design/uboot-ab-handshake.md` |
| 发布怎么签名，由谁签？ | `../design/release-signing.md` |
