# mos 文档

> [English](README.md) | 中文

- `architecture.md` / `architecture.zh.md` — 顶层系统架构与组件地图（从这里读起）
- `design/` — 子系统设计记录（中英双份，`*.zh.md` 为中文版）
  - `access.md` — 调试/维护访问：通道、认证阶段、分层禁用
  - `boards.md` — BSP 契约：产物接口、内核断言、新板接入 checklist
  - `remote-management.md` — webd 与 apid 分工、SideroLink 机队路径
  - `display.md` — HDMI kiosk UI：cage+WPE 本地渲染 webd
- `research/` — 决策依据研究
  - `os-comparison.md` — balena/Torizon/Talos/Yocto 评估与被否决方案
- `plan/` — PMA 计划（编号 + 状态索引；仅英文）
- `task/` — PMA 任务跟踪（仅英文）

规则：架构/设计/调研文档维护中英双份，英文版为基准（内容冲突时以英文版为
准），修改时两份同步更新；plan/ 与 task/ 为 PMA 过程文档，仅英文。
