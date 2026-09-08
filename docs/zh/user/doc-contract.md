# mos 用户文档契约

本页是 `docs/user/` 之下一切内容背后的契约：这些页面为谁而写、每页拥有
什么、关于产品的声明如何标注并给出证据、这套文档如何版本化、以及英文树
与中文树的关系。本集内的页面遵循此契约；做不到的页面是页面的缺陷，不是
放松契约的许可。

## 1. 读者

mos 是嵌入式一体机操作系统。用户文档服务三类读者，按此顺序：

1. **设备操作员**——站在已部署设备前的人：安装、配置、更新、恢复，以及
   决定告诉支持什么。
2. **产品集成商**——基于 mos 构建产品的团队：组合镜像、交付应用、选择
   并认证板卡。
3. **支持工程师**——故障报告到达的人，需要设备的身份，以及已发布行为与
   路线图之间诚实的边界。

工程设计记录保留在 [`docs/design/`](../README.md) 和
[`docs/architecture.md`](../architecture.md)。用户页面陈述当前受支持的
行为并链接回设计记录以获得理由；它们不复述设计历史，设计理由也不在这里
重复。

## 2. 信息架构

客户旅程从发布版选择贯穿安装、运维、应用、更新、恢复、故障排查与支持。
每个阶段由一页拥有；一个事实出现在拥有它的那一页上，并从其他所有地方
链接过去。

| 页面 | 拥有 |
|---|---|
| [quickstart.md](quickstart.md) | 通往运行中 mos 系统的最短且诚实的路径 |
| [download.md](download.md) | 发布版选择与镜像获取 |
| [install.md](install.md) | 把镜像写到板卡并到达首次启动 |
| [first-run.md](first-run.md) | 首次启动、离线配置文档、认领设备 |
| [manufacturing.md](manufacturing.md) | 批量装机：身份与凭据的归属、工厂记录、隔离 |
| [configuration.md](configuration.md) | 配置模型与改变设置的每种受支持方式 |
| [applications.md](applications.md) | 交付与运行应用：原生软件包与容器 |
| [update-rollback.md](update-rollback.md) | A/B 更新路径、健康确认与回滚 |
| [recovery.md](recovery.md) | 设备无法启动时怎么办，以及恢复的代价 |
| [storage.md](storage.md) | 存储层级、什么在什么之后幸存、数据属于哪里 |
| [troubleshooting.md](troubleshooting.md) | 诊断：访问通道、要读的证据、要解读的拒绝 |
| [security.md](security.md) | 安全姿态：什么受保护、由什么保护、以及点名的缺口 |
| [release-notes.md](release-notes.md) | 发布版如何标识、发布事实来自哪里 |
| [api.md](api.md) | 编程面及其机器可读契约 |
| [support.md](support.md) | 支持层级、生命周期归属、支持工单需要什么 |

官方网站内容简报在 `docs/website/` 之下，BSP 移植与认证集在 `docs/bsp/`
之下；用户页面在旅程与之相交处（硬件选择、下载、支持层级）链接进两者。

## 3. 真实状态分类法——规范性

本文档集中的每个能力声明都携带一个状态。这是契约的核心：文档本身可以
弥合易用性缺口，但绝不能声称尚不存在的机制已经发布。

四个状态：

- **shipped**——该能力存在于本仓库中，并被构建或其检查所验证。声明它
  需要确实存在的证据。
- **board-dependent**——该能力至少在一块板卡上发布，其有无或形态是板卡
  事实（在 `boards/<board>/` 中或由板卡的 BSP 声明）。
- **proposed**——该能力已列入 `docs/plan/` 下已批准或草案状态的计划，
  且未发布。描述一个提案中的契约是允许的；把它呈现为当前行为则不允许。
- **unsupported**——该能力不存在且当前无计划，或明确在产品契约之外。

### 语法

状态行是恰好如下形状的 Markdown 引用块——状态如上，分隔符是带空格的
em dash，每个证据引用放在反引号里，多个引用以 `, ` 分隔：

```
> status: shipped — evidence: `pkgs/mosd/apid/openapi.json`
> status: board-dependent — evidence: `boards/cx3576/board.env`
> status: proposed — evidence: `docs/plan/PLAN-054.md`
> status: unsupported
```

### 证据规则

- `shipped` 与 `board-dependent` 必须引用一个存在的仓库路径（文件或
  目录），或顶层 `Makefile` 中存在的 `make <target>`。
- `proposed` 必须引用 `docs/plan/` 下一个存在的计划记录——该目录下任一
  记录文件，无论是 `<timestamp>-<feature-slug>.md` 还是较早的编号
  `PLAN-NNN.md`；索引不算记录。
- `unsupported` 不携带证据；缺席本身就是声明。
- 证据在被引用之前先验证其存在。死掉的证据引用是坏掉的声明，不是外观
  缺陷。
- 本集内任何地方都不使用 `path:line` 引用。与行号耦合的文档会被那些
  并未改变其含义的编辑证伪。需要精确契约时，改为点名承载它的产物——
  例如，HTTP 接口面就是 `pkgs/mosd/apid/openapi.json`。

### 提案内容与 TODO 标记

当一页描述某个计划仍在构建的能力时，它陈述计划中的契约，以该计划为证据
标注 `proposed`，并用一行 `TODO(<plan record>): revisit after
this plan merges` 形式的标记标出该节，以便计划落地时清扫并重新标注。每节至多一个
此类标记。

## 4. 版本化

用户文档集随它所属的 mos 发布版一起版本化。一页描述的是它被检出时所在的
发布版；没有独立的文档版本号，也没有任何一页描述比包含它的树更新或更旧
的发布版。绑定到特定板卡或 profile 的陈述会明确说明。

> status: shipped — evidence: `docs/user/`

## 5. 英文与中文

`docs/user/` 下的英文是权威。一套受跟踪的中文用户文档集位于 `docs/zh/`
之下，由 `docs/zh/README.md` 索引，并带有一张逐页覆盖表，为本集内每一页
记录：源页面、翻译所依据的源版本、以及取值为 `current`、`lagging` 或
`not-translated` 之一的状态。任何冲突以英文页面为准。

中文文档集位于 `docs/zh/` 之下，保持覆盖表诚实的检查是
`docs/zh/verify-coverage.sh`，由 `make docs-verify` 运行：它在两个方向上
对照两棵树核对这张表，并要求 `current` 的页面携带与其英文源页面相同、
且顺序相同的 status 行。

> status: shipped — evidence: `docs/zh/README.md`, `docs/zh/verify-coverage.sh`

## 6. 风格规则

- 每页以一个 H1 开头。内部链接使用相对路径。
- 克制的行文；没有营销腔。局限性写在原本会夸大其词的那个句子里，而不是
  脚注里。
- 展示的命令是真实的命令，对照 `Makefile` 和它们点名的脚本验证过。
- 用户页面不叙述实现。设计记录拥有"为什么"；这些页面拥有操作员或集成商
  今天能做什么。
