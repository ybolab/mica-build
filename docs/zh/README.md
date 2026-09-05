# mos 中文文档

> [English](../README.md) | 中文

本目录是 mos 的中文文档，按**当前版本**重写，不是英文文档的逐行翻译。

- [`architecture.md`](architecture.md) — 系统架构总览与组件地图（从这里开始）
- `user/` — 用户文档（**覆盖全部 16 篇**，含文档契约本身）
  - [`quickstart.md`](user/quickstart.md) — 快速上手：QEMU 里的 x64 基线
  - [`download.md`](user/download.md) — 发布版组成与镜像获取（今天：自己构建）
  - [`install.md`](user/install.md) — 把镜像写到板卡并到达首次启动
  - [`first-run.md`](user/first-run.md) — 首次启动、离线配置文档、认领设备
  - [`manufacturing.md`](user/manufacturing.md) — 批量装机：谁生成身份与首个凭据、工厂记录、失败与重复配置的隔离
  - [`configuration.md`](user/configuration.md) — 设置树模型与今天可配置什么
  - [`applications.md`](user/applications.md) — 原生软件包与容器两条交付路径
  - [`update-rollback.md`](user/update-rollback.md) — A/B 更新、健康门与回滚
  - [`recovery.md`](user/recovery.md) — 从自动回滚到整盘重刷的恢复阶梯
  - [`storage.md`](user/storage.md) — 四个存储层级与数据归属规则
  - [`troubleshooting.md`](user/troubleshooting.md) — 诊断顺序：访问、识别、证据
  - [`security.md`](user/security.md) — 安全姿态与点名的缺口
  - [`release-notes.md`](user/release-notes.md) — 发布版标识与发布说明政策
  - [`api.md`](user/api.md) — 管理 API：一份机器可读契约
  - [`support.md`](user/support.md) — 支持层级与生命周期归属
  - [`doc-contract.md`](user/doc-contract.md) — 用户文档契约（读者、真实状态分类法、中英规则）
- `design/` — 子系统设计与专项开发指南
  - [`api.md`](design/api.md) — API 优先的 apid：表面、认证、静态托管、可替换界面
  - [`applications.md`](design/applications.md) — 计划中的托管应用：精选 OCI 优先目录、签名 manifest、生命周期、信任与 API 边界
  - [`access.md`](design/access.md) — 调试与运维通道：入口、认证、分层关闭
  - [`boards.md`](design/boards.md) — BSP 契约：产物、内核断言、新板卡清单
  - [`bsp-cx3576-sync.md`](design/bsp-cx3576-sync.md) — cx3576 上游 BSP 同步记录与偏离登记
  - [`build-harness.md`](design/build-harness.md) — 本仓库的检查怎么跑：固定容器、临时空间、文档门禁
  - [`build.md`](design/build.md) — 镜像构建指南：产物、x64 与 cx3576 的构建序列、哪些步骤交叉编译/在 buildkit 内模拟/需要主机 binfmt、如何读懂构建拒绝
  - [`bus.md`](design/bus.md) — 系统管理与应用数据边界、按包登记的 `com.mos.Item1` 应用契约、D-Bus 策略与 MQTT topic 语法
  - [`connd.md`](design/connd.md) — 连接性关注点：WiFi station/AP 的两个协调器
  - [`containers.md`](design/containers.md) — 集成商指南：Quadlet unit、互联、持久化
  - [`dashboard.md`](design/dashboard.md) — 仪表盘提案：着陆页、信息架构、技术姿态
  - [`display.md`](design/display.md) — HDMI kiosk 界面
  - [`mosd.md`](design/mosd.md) — 管理面：设置树、协调器、D-Bus 接口
  - [`native-applications.md`](../design/native-applications.md) — 原生交付路径的集成商指南：`.deb` producer、单元与启动、专用账户、可写状态、健康闸、具名设备、资源上限（仅英文）
  - [`provisioning.md`](design/provisioning.md) — 无网络配置：三层模型与凭据模型
  - [`release-signing.md`](design/release-signing.md) — 生产密钥仪式：TUF root、RAUC CA、签名 runbook
  - [`remote-management.md`](design/remote-management.md) — 远程管理的现状与缺口
  - [`ro-root.md`](design/ro-root.md) — 只读根：squashfs + dm-verity，以及写入去哪里
  - [`uboot-ab-handshake.md`](design/uboot-ab-handshake.md) — U-Boot / RAUC / 健康闸之间的 A/B 启动契约
  - [`built-in-ui-development-guide.md`](design/built-in-ui-development-guide.md) — 内置 UI 的自包含开发、交互、API 映射与分阶段交付指南
  - [`built-in-ui-design.md`](design/built-in-ui-design.md) — 面向产品/UI 设计师的完整功能、页面、流程、状态与原型指南
- `research/` — 调研笔记:作为基准阅读的外部产品,不属于设计记录
  - [`venus-gui-v2.md`](research/venus-gui-v2.md) — Venus OS gui-v2 功能参考,源码通读,映射到 apid/dashboard 归属

## 与英文文档的关系

英文文档是**权威**。两边冲突时以英文为准，中文这边按缺陷处理。

## 覆盖表

按 [`user/doc-contract.md`](user/doc-contract.md) 第 5 节的规则，下表为
`docs/user/`、`docs/website/` 和 `docs/bsp/` 下的每一个英文页面各记录一行：
源页面（相对本目录的路径）、翻译所依据的源版本（git 短提交号）、以及覆盖
状态（`current` | `lagging` | `not-translated`）。`docs/zh/verify-coverage.sh`
（挂在 `make docs-verify` 上）保证这张表与两边的文件树一致。

`docs/website/` 与 `docs/bsp/` 整树标记 `not-translated`，这是政策而非
欠账：两者面向集成商与工程读者，英文是其工作语言；doc-contract.md 管辖
这条规则，规则若变，先改契约再改表。

| 源页面 | 源版本 | 覆盖状态 |
|---|---|---|
| `../user/api.md` | db66fc02 | current |
| `../user/applications.md` | 965de492 | current |
| `../user/configuration.md` | 9243aeea | current |
| `../user/doc-contract.md` | 00a5147d | current |
| `../user/download.md` | 00a5147d | current |
| `../user/first-run.md` | 00a5147d | current |
| `../user/install.md` | 00a5147d | current |
| `../user/manufacturing.md` | 00a5147d | current |
| `../user/quickstart.md` | db66fc02 | current |
| `../user/recovery.md` | 9243aeea | current |
| `../user/release-notes.md` | 00a5147d | current |
| `../user/security.md` | 9243aeea | current |
| `../user/storage.md` | 00a5147d | current |
| `../user/support.md` | 00a5147d | current |
| `../user/troubleshooting.md` | 50b85a5e | current |
| `../user/update-rollback.md` | 9243aeea | current |
| `../website/contract.md` | db66fc02 | not-translated |
| `../website/documentation.md` | db66fc02 | not-translated |
| `../website/downloads.md` | db66fc02 | not-translated |
| `../website/embedded.md` | db66fc02 | not-translated |
| `../website/hardware.md` | db66fc02 | not-translated |
| `../website/licensing.md` | db66fc02 | not-translated |
| `../website/product.md` | db66fc02 | not-translated |
| `../website/security.md` | db66fc02 | not-translated |
| `../website/support.md` | db66fc02 | not-translated |
| `../bsp/assurance.md` | db66fc02 | not-translated |
| `../bsp/board-env.md` | db66fc02 | not-translated |
| `../bsp/board-template.md` | db66fc02 | not-translated |
| `../bsp/cx3576-example.md` | db66fc02 | not-translated |
| `../bsp/intake.md` | db66fc02 | not-translated |
| `../bsp/porting.md` | db66fc02 | not-translated |
| `../bsp/qualification.md` | db66fc02 | not-translated |
| `../bsp/support-tiers.md` | db66fc02 | not-translated |

`docs/design/` 下的每一篇都有中文对应。中文版是**面向当前版本的概览**，
不是逐行翻译：英文版里可直接执行的命令序列、完整配置清单和逐块数据来源表格不在这里重复，
需要照着做的时候请看英文版。

## 文档不解释代码

这些文档描述**设计与行为**，不引用代码行号，也不逐句注解实现——被行号绑住的文档，
会被那些并未改变设计的编辑证伪。需要精确契约时，直接指向承载它的产物：HTTP 接口面
由 `pkgs/mosd/apid/openapi.json` 规定，CI 保证它与实际运行的二进制一致。
