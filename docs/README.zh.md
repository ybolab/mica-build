# mos 文档

> [English](README.md) | 中文
>
> **过期警告（2026-08-21，RFCT-082）**：本译文已落后于英文版，且未逐条对齐；
> 冲突时以英文版为准（docs/README.md 的双语规则）。是否恢复中文文档的同步维护
> 仍是搁置中的用户决定（docs/task/RFCT-045.md）；在该决定作出前，请以
> README.md 为准。

- `architecture.md` / `architecture.zh.md` — 顶层系统架构与组件地图（从这里读起）
- `design/` — 子系统设计记录（中英双份，`*.zh.md` 为中文版）
  - `access.md` — 调试/维护访问：通道、认证阶段、分层禁用
  - `boards.md` — BSP 契约：产物接口、内核断言、新板接入 checklist
  - `remote-management.md` — apid（产品）与 Talos apid 分工、SideroLink 机队路径
  - `display.md` — HDMI kiosk UI：cage+WPE 本地渲染 apid
  - `provisioning.md` — 无网配置：三层供给模型
  - `mosd.md` — 管理平面设计简报：D-Bus 树、设置 schema、协调器
- `research/` — 决策依据研究
  - `os-comparison.md` — balena/Torizon/Talos/Yocto 评估与被否决方案
  - `init-strategy.md` — init 核心战略：Plan A Talos / Plan B systemd+Rust / Plan C Rust PID1 与触发器
- `plan/` — PMA 计划（编号 + 状态索引；仅英文）
- `task/` — PMA 任务跟踪（仅英文）

规则：架构/设计/调研文档维护中英双份，英文版为基准（内容冲突时以英文版为
准），修改时两份同步更新；plan/ 与 task/ 为 PMA 过程文档，仅英文。
