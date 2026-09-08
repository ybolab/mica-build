# 设计：本地显示（HDMI Kiosk 界面）

> [English](../../design/display.md) | 中文
>
> HDMI 输出上的产品界面——状态面板、初始化向导、以及外接屏幕上的应用界面，
> 可选支持触摸/USB 输入。

## 1. 原则：只有一套界面代码

本地显示渲染的就是**远程浏览器所用的那套 apid 界面**，跑在一个指向 `https://127.0.0.1`
的 kiosk 会话里。**不维护第二套界面技术栈**；apid 的每个功能（向导、状态、更新）在屏幕上
自动可用。仅本地才有的行为（例如未配置时自动弹出初始化向导）是 kiosk 选择的 apid 路由，
而不是另写的代码。

## 2. 组件栈

```
apid（现有 HTTPS 界面）
  ▲ localhost
kiosk 会话：cage（Wayland kiosk 合成器）+ WPE WebKit 浏览器
  ▲ DRM/KMS + GPU 驱动          ▲ libinput（触摸 / USB 键鼠）
板级图形栈（BSP：内核 DRM + HDMI + GPU 驱动/固件）
```

- **`mos-gui` 容器**：cog（WPE WebKit）经 GBM 直接持有 DRM/KMS——无 X、无
  Wayland、无合成器。整个显示层（容器镜像、systemd/Quadlet 编排、HDMI 探测）
  在独立仓库 `bkhq/mos-gui`（git.ds.cc）；基础镜像只用它已带的 podman/Quadlet
  机制运行它。无头部署直接不部署该容器。它与页面之间的唯一接口是一个 URL。
  （两个早期交付方案均已废弃：sysext 层与宿主包——容器不需要第二套机制。）
  和设备上其他服务一样，作为 systemd unit 运行。
- 选 WPE WebKit 是因为它面向嵌入式（比 Chromium 小，WPE/cage 的上游配对是 kiosk 的标准做法）。
  若缺某个必需的 Web 特性，回退方案是 Chromium `--kiosk`。
- **刻意不规划** LVGL/Flutter 原生路线，除非出现无 GPU 的板卡——那会变成第二套界面代码。

## 3. 配置

```yaml
apiVersion: v1alpha1
kind: DisplayConfig
kiosk:
  enabled: true
  url: ""                  # 空 = apid 本地界面；可设为自定义应用界面
  rotation: 0              # 0|90|180|270
  blankAfter: 10m          # 息屏；0 = 永不
  showWizardWhenUnprovisioned: true
```

`DisplayConfig` → 控制器 → `DisplayStatus` 资源 → mos-gui 容器的启停/重启，**无需重启系统**。
`url` 让产品构建可以把屏幕指向某个应用界面（由应用容器提供），而不是 apid。

## 4. 启动观感与 tty 策略

由 PLAN-088 在 cx3576 上落地。本节已按照固定版本源码的实际行为重写；此前的三条说法
经测量为错误，下面保留纠正而非直接删除，因为每一条都是从外部观察最容易得出的结论。

- **画面由内核绘制，而不是 U-Boot。** `CONFIG_LOGO` + `CONFIG_LOGO_LINUX_CLUT224`，
  板级 224 色 PPM 在构建时从 `boards/cx3576/bsp/rootfs/assets/splash.png` 派生 ——
  该母版不再是"没有消费者的源资产"。**U-Boot 什么也不显示**，这不是排期问题：
  固定版本是上游 u-boot `ece349ade`，其 Rockchip 显示驱动只有 VOP1 时代的
  RK3288/RK3328/RK3399，整棵树里没有 VOP2 驱动、没有任何 RK3576 显示支持，
  因此在那里打开 `SPLASH_SCREEN` 只会编出一个无驱动可绑定的 video 核心。
  所以 HDMI **从复位到 DRM 探测之间都是黑的**，无缝开机画面被 U-Boot 分支选型问题挡住。
  证据与替代方案的代价见 PLAN-088 第 1 节。
- **不使用也不允许使用 `quiet`。** 只有当 `console_loglevel` 大于
  `CONFIG_CONSOLE_LOGLEVEL_QUIET`（本内核为 4）时 fbcon 才绘制 logo
  （`fbcon.c:1009-1010`），而 `quiet` 恰好把它设成 4 —— 它挡住文本的同时也挡住了
  **logo**。本板使用 `loglevel=5`：既是显示 logo 的下限，又安静到正常启动只打印
  warning 及以上，并且非零，所以 oops 时 `console_verbose()` 仍会抬高等级。
  `loglevel=0` 会让 panic 在包括串口在内的所有 console 上都不可见，已被镜像契约拒绝。
- **HDMI 有意保留在 console 列表中。** 命令行是
  `console=tty1 console=ttyFIQ0,1500000`，**顺序就是设计本身**：每个 `console=`
  都接收 printk，但 `/dev/console` 是最后一个，因此用户态输出留在串口线上，
  而内核 panic 仍会占据屏幕。对于没有接串口线的设备，这是唯一的诊断通路。
- **`getty@tty1` 由 preset 关闭**（`mos-board-cx3576` 中的 `50-mos-getty.preset`），
  而不是靠"缺少软链接" —— 未被任何规则匹配的单元 preset 结果是 ENABLE，
  而 `90-systemd.preset` 写的正是 `enable getty@.service`。它仍然可以随时启动：
  `systemctl start getty@tty1` 让屏幕在运行时变成登录终端，无需第二条启动路径、无需重新构建。
- **不引入 plymouth，也不引入任何用户态开机动画。** kiosk 在 `mos-gui` 启动时接管
  DRM master；除此之外没有别的东西绘制屏幕。
- **控制台通道**：向导 tty2 / 调试 shell tty3 都在**串口**上；生产镜像中禁用从 kiosk 切换 VT。
- **kiosk 崩溃策略**：带退避重启；连续失败 N 次后回退到一张静态的"服务不可用 + 支持网址"
  DRM 画面，而**不是**回退到控制台。

## 5. 板卡要求（在 boards.md 第 4 节之上追加）

`board.env` 带有 **`BOARD_HAS_DISPLAY`**（`0` 或 `1`，PLAN-088 加入）：cx3576 声明 `1`，
两块 QEMU 板声明 `0`。它约束的是上面第 4 节的启动观感，而不是 kiosk。产品带 HDMI 输出的
板卡必须提供：

- **内核**：SoC 显示管线与 HDMI 编码器的 DRM/KMS `=y`；GPU 驱动
  （cx3576/RK3576：走主线 panfrost 的 Mali，或以厂商 blob 驱动兜底——在板卡带起阶段决定）；
  `CONFIG_DRM_FBDEV_EMULATION` 已在断言集中。
- GPU 用户态（mesa）进 **mos-gui 容器镜像**；内核 DRM 与 GPU 固件留在板侧（内核 + 板卡包）。
- 输出口与默认旋转角。目前这两项只是板卡定义里的一条注释而非配置键
  （记录为：输出是 hdmi，默认旋转为 0）。因此 DisplayConfig 目前**没有**来自板卡的默认值，
  等有了配置键才会有。

## 6. 安全说明

- kiosk 浏览器是一大片攻击面，但默认只渲染 localhost；指向非 apid 的 `url` 是一个显式的
  配置决定，并且会记入审计日志。
- kiosk 会话以非特权身份运行（容器里没有 shell，无 VT 访问）；浏览器被攻破所得到的位置，
  等同于一个未认证的 apid 局域网客户端。
- 物理接触 HDMI/USB 本身已经落入威胁模型的物理访问层级，kiosk 不会削弱它。

## 7. 分期

| 阶段 | 范围 |
|---|---|
| 1 | mos-gui 容器（cog/WPE）、DisplayConfig 与控制器、apid 本地向导路由、cx3576 上 splash 到 kiosk 的交接 |
| 2 | 触摸输入打磨、旋转、息屏、崩溃画面 |
| 3 | 自定义应用 `url` 模式 + 按应用划分的界面容器（与工作负载/副 ECU 设计相衔接） |

阶段 1 在 cx3576 显示带起之后并入访问层的工作（GPU 驱动的选型在板卡工作中决定）。
