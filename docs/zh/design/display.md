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

- **启动画面**：U-Boot 显示板级 splash，内核以 `quiet` 让 fbcon 不出现在生产环境的 HDMI 上，
  kiosk 服务启动时接管 DRM master。目标是**客户屏幕上永不闪过任何文本**。
  - cx3576 的 splash 母版目前是**只有源资产、还没有消费者**：没有构建步骤读取它，
    而 U-Boot 的 splash 路径要 BMP，所以格式转换属于下面的阶段 1。母版是 76 KB 的 PNG，
    1920x1080，每通道 16 位。
- **控制台通道**：向导 tty2 / 调试 shell tty3 都在**串口**上；生产镜像中禁用从 kiosk 切换 VT。
- **kiosk 崩溃策略**：带退避重启；连续失败 N 次后回退到一张静态的"服务不可用 + 支持网址"
  DRM 画面，而**不是**回退到控制台。

## 5. 板卡要求（在 boards.md 第 4 节之上追加）

`board.env` 里**没有显示能力这个键**，所以目前没有任何板卡声明这项特性。产品带 HDMI 输出的
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
