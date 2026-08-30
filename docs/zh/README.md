# mos 中文文档

> [English](../README.md) | 中文

本目录是 mos 的中文文档，按**当前版本**重写，不是英文文档的逐行翻译。

- [`architecture.md`](architecture.md) — 系统架构总览与组件地图（从这里开始）
- `design/` — 子系统设计（**覆盖全部 16 篇**）
  - [`api.md`](design/api.md) — API 优先的 apid：表面、认证、静态托管、可替换界面
  - [`access.md`](design/access.md) — 调试与运维通道：入口、认证、分层关闭
  - [`boards.md`](design/boards.md) — BSP 契约：产物、内核断言、新板卡清单
  - [`bsp-cx3576-sync.md`](design/bsp-cx3576-sync.md) — cx3576 上游 BSP 同步记录与偏离登记
  - [`build-harness.md`](design/build-harness.md) — 本仓库的检查怎么跑：固定容器、临时空间、文档门禁
  - [`bus.md`](design/bus.md) — 系统管理与应用数据边界、扩展 `com.mos.Item1` 契约、MQTT topic 与迁移
  - [`connd.md`](design/connd.md) — 连接性关注点：WiFi station/AP 的两个协调器
  - [`containers.md`](design/containers.md) — 集成商指南：Quadlet unit、互联、持久化
  - [`dashboard.md`](design/dashboard.md) — 仪表盘提案：着陆页、信息架构、技术姿态
  - [`display.md`](design/display.md) — HDMI kiosk 界面
  - [`mosd.md`](design/mosd.md) — 管理面：设置树、协调器、D-Bus 接口
  - [`provisioning.md`](design/provisioning.md) — 无网络配置：三层模型与凭据模型
  - [`release-signing.md`](design/release-signing.md) — 生产密钥仪式：TUF root、RAUC CA、签名 runbook
  - [`remote-management.md`](design/remote-management.md) — 远程管理的现状与缺口
  - [`ro-root.md`](design/ro-root.md) — 只读根：squashfs + dm-verity，以及写入去哪里
  - [`uboot-ab-handshake.md`](design/uboot-ab-handshake.md) — U-Boot / RAUC / 健康闸之间的 A/B 启动契约

## 与英文文档的关系

英文文档是**权威**。两边冲突时以英文为准，中文这边按缺陷处理。

`docs/design/` 下的每一篇都有中文对应。中文版是**面向当前版本的概览**，
不是逐行翻译：英文版里可直接执行的命令序列、完整配置清单和逐块数据来源表格不在这里重复，
需要照着做的时候请看英文版。

## 文档不解释代码

这些文档描述**设计与行为**，不引用代码行号，也不逐句注解实现——被行号绑住的文档，
会被那些并未改变设计的编辑证伪。需要精确契约时，直接指向承载它的产物：HTTP 接口面
由 `os/pkgs/mosd/apid/openapi.json` 规定，CI 保证它与实际运行的二进制一致。
