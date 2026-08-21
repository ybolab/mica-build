# 设计：本地显示（HDMI Kiosk UI）

> [English](display.md) | 中文
>
> HDMI 输出上的专属产品 UI——状态面板、设置向导与应用界面显示在外接屏幕上，
> 支持可选的触摸/USB 输入。

## 1. 原则：一套 UI 代码

本地屏幕渲染的就是远程浏览器所用的**同一个 apid UI**，以 kiosk 会话指向
`https://127.0.0.1`。不维护第二套 UI 栈；apid 的每个功能（向导、状态、升级）
自动出现在屏幕上。本地特有的行为（如未配网时自动进入设置向导）是 kiosk
选择的 apid 路由，不是独立代码。

## 2. 组件栈

```
apid（现有 HTTPS UI）
  ▲ localhost
kiosk 会话：cage（Wayland kiosk 合成器）+ WPE WebKit 浏览器
  ▲ DRM/KMS + GPU 驱动            ▲ libinput（触摸 / USB 键鼠）
板级图形栈（BSP：内核 DRM + HDMI + GPU 驱动/固件）
```

- **`kiosk` system extension**：cage + WPE WebKit（+ mesa/GPU 用户态）。重量
  级 C 栈，因此按镜像 profile 以 extension 装配——无头部署直接不带，基础
  rootfs 不受影响。作为 extension service 由 machined 监督运行。
- WPE WebKit 是嵌入式首选（比 Chromium 小，WPE/cage 组合是上游标准 kiosk
  实践）；若缺少所需 Web 特性，以 Chromium `--kiosk` 为备选。
- 原生 LVGL/Flutter 路线**有意不规划**，除非出现无 GPU 的板卡——那是第二套
  UI 代码。

## 3. 配置

```yaml
apiVersion: v1alpha1
kind: DisplayConfig
kiosk:
  enabled: true
  url: ""                  # 空 = apid 本地 UI；可指向定制应用 UI
  rotation: 0              # 0|90|180|270
  blankAfter: 10m          # 屏幕休眠；0 = 永不
  showWizardWhenUnprovisioned: true
```

`DisplayConfig` → controller → `DisplayStatus` 资源 → kiosk extension 服务
起停/重启，无需重启系统。`url` 允许产品构建把屏幕指向应用容器提供的界面而
非 apid。

## 4. 启动体验与 tty 策略

- 开机画面：U-Boot 显示板卡 splash（cx3576 的母版是
  `board/cx3576/rootfs/assets/splash.png`），prod 内核 `quiet`
  且 fbcon 不上 HDMI；kiosk 服务启动时接管 DRM master。目标：客户屏幕上
  永远不闪过文本。
  - 该母版**目前没有消费方**：没有任何构建步骤读它，而 U-Boot 的 splash 通路要
    的是 BMP，格式转换归下面的阶段 1。它是 1920x1080 的 16-bit RGB，且已从原先
    12MB 的未压缩 P6 PPM 换成 PNG——像素逐字节比对一致，体积从占仓库三分之二
    降到 76KB。
- 上游 Talos dashboard 保持关闭（`talos.dashboard.disabled`，PLAN-007
  决策）——kiosk 取代它成为本地存在。
- Console 通道（access.md）：向导 tty2 / 调试 shell tty3 走**串口**；prod
  镜像禁用从 kiosk 的 VT 切换。
- kiosk 崩溃策略：退避重启；连续 N 次失败后回落到静态的"服务不可用 + 支持
  地址" DRM 画面，而不是暴露 console。

## 5. 板卡要求（扩展 boards.md §4）

`board.yaml` features 声明 `display` 的板卡必须提供：

- 内核：SoC 显示管线 + HDMI 编码器的 DRM/KMS `=y`；GPU 驱动（cx3576/RK3576：
  Mali，优先 mainline panfrost，厂商 blob 驱动兜底——板级启动阶段定）；
  `CONFIG_DRM_FBDEV_EMULATION` 已在断言集内。
- GPU 固件/用户态进 kiosk extension（不进基础 rootfs）。
- `board.yaml` 增加 `display:` 段（输出口、默认旋转），作为 DisplayConfig
  的默认值来源。

## 6. 安全说明

- kiosk 浏览器是较大攻击面，但默认只渲染 localhost；指向非 apid 的 `url`
  是显式配置决策并记入审计日志。
- kiosk 会话非特权运行（容器内无 shell、无 VT 访问）；攻破浏览器所得地位
  等同于一个未认证的 apid 局域网客户端。
- 能物理接触 HDMI/USB 本就落入威胁模型的物理接触层（access.md §2 的
  rescue/factory 行）；kiosk 不使其恶化。

## 7. 分期

| 阶段 | 范围 |
|---|---|
| 1 | kiosk extension（cage+WPE）、DisplayConfig/controller、apid 本地向导路由、cx3576 上 splash→kiosk 交接 |
| 2 | 触摸输入打磨、旋转、休眠、崩溃回落画面 |
| 3 | 定制应用 `url` 模式 + 按应用 UI 容器（衔接 workload/secondary-ECU 设计） |

Campaign 映射：阶段 1 并入访问层/apid campaign，排在 cx3576 显示启动之后
（GPU 驱动选型在板级 campaign 内完成）。
