# mos 内置 UI 开发指南

> 文档版本：1.4
> 基线日期：2026-09-02
> 状态：已批准的 UI 开发与交付基线
> 适用范围：`mos-apid` 随系统镜像交付的内置 Web UI，以及未来复用同一 UI 的本地触屏/kiosk

本文给 UI 设计、前端开发、后端开发、测试和产品评审使用。阅读本文不需要预先了解 mos
代码库。本文同时描述当前产品、已经具备 API 但尚未完成 UI 的功能，以及以明确“模拟界面”边界呈现的
路线图原型；真实设备操作与临时内存状态不会混写。

本文中的“必须”“不得”“应当”是实现约束；“建议”是默认选择，偏离时应在变更说明中给出
理由。

## 1. 一页结论

mos 内置 UI 是设备管理面，不是独立控制平面。浏览器或本地 kiosk 只访问同源
`/api/v1/...`，由 `mos-apid` 转给 `mosd`；UI 不直接执行命令、不访问 systemd、不读写设备
文件，也不另建表单接口。

开发按以下六条原则进行：

1. **使用六个一级入口。** 一级导航为 Overview、Network、Services、Applications、Access、System。
   Services 只管理 mos 系统能力；Applications 独立承载第三方应用清单、目录与生命周期。
2. **一个 UI，两个使用环境。** 远程桌面浏览器与未来本地触屏使用相同路由、数据模型和权限
   语义，只按屏幕类别调整密度、导航和输入方式。
3. **明确区分三种设备状态。** Configured 是已保存的期望配置，Applied 是协调器执行结果，
   Observed 是当前观测事实；不得用配置值冒充设备在线或服务健康。
4. **没有契约就不伪装成真实操作。** 后端 API 尚不存在的计划能力可以在当前开发阶段实现完整可交互
   原型，但只能修改页面内存状态，不能发出 API mutation；受影响页面底部必须显示“模拟界面”说明，
   明确操作不会改变设备且刷新后复位。进入生产交付前可按 capability 屏蔽。
5. **安全操作显式且可恢复。** 一次性秘密只展示一次；危险操作显示影响范围；不可逆操作需要
   专用确认流程；所有 mutation 都正确处理 CSRF、任务进度和 API 错误。
6. **内置交付约束优先。** 运行时不得依赖 CDN；构建阶段生成且不纳入版本控制的 `_out/apid-ui/dist` 完整
   文件树必须以编译期虚拟文件系统嵌入 `mos-apid`，入口以外的构建资源使用内容哈希，并通过路由
   与语言包懒加载减少首次下载。

推荐路线不是重做现有界面，而是先统一状态、错误、表单和响应式规范，再完成已经具备 API 的
网络管理，最后随各后端计划获批和落地逐项开放系统页面。

## 2. 事实来源与成熟度

### 2.1 冲突时采用的事实顺序

当代码、旧设计文档、研究材料和计划互相矛盾时，按以下顺序判断：

1. 当前工作树中的实际实现和生成的 `pkgs/mosd/apid/openapi.json`；
2. 设计文档顶部明确标出的“当前已交付契约”；
3. 未完成计划 PLAN-042～PLAN-054，只用于描述未来意图；
4. `docs/research/venus-gui-v2.md`，只用于抽象交互模式参考。

旧文档中关于 Maud、服务端渲染、无 JavaScript 页面或“网络观测尚未实现”的历史描述，不代表
当前产品。当前产品已经是 React SPA，并已经显示 systemd-networkd 的观测状态。

### 2.2 成熟度标签

本文所有页面和功能使用以下标签。标签属于交付契约，不是视觉状态徽章。

| 标签 | 含义 | UI 开发可以做什么 |
|---|---|---|
| **S · 已上线 UI** | 当前代码、API 和产品路径均存在 | 修复、统一和扩展测试；不得无故改变语义 |
| **A · API 就绪** | 类型化 API 已存在，产品 UI 尚未覆盖 | 可以实施 UI；必须以 OpenAPI 和实际错误为准 |
| **P · 草案规划** | 只有草案计划或后端局部 seam | 可实现交互原型；必须走隔离的内存模拟层并在页底标注，不能调用不存在的 API |
| **C · 条件/范围外** | 需要产品决策、硬件能力或不属于本地 UI | 不进入当前开发排期和默认导航 |

“能力不存在”和“能力调用失败”必须分开：能力探测确认不存在时隐藏入口；已声明存在但请求失败时
保留入口并显示错误。不得把 500、503 或超时解释成“此设备不支持”。

### 2.3 当前能力总表

| 领域 | 成熟度 | 当前事实 | 下一步 |
|---|---:|---|---|
| 首次设置、登录、登出 | S | 基于浏览器 session 和内存 CSRF | 补齐双语、错误聚焦和端到端测试 |
| Overview | S | 健康、元数据、网络摘要、运行时间、最近任务 | 增加统一新鲜度和降级状态 |
| 网络只读总览 | S | 同时显示 configured 与 observed | 用结构化详情替代正常路径中的原始 JSON |
| 物理/VLAN/Bridge/WireGuard 配置 | A | 整体和单接口 typed API 已存在 | 增加编辑器、依赖校验和失联保护 |
| Wi-Fi 已知网络 | A | 列表、添加、忘记 API 已存在 | 不得扩展成扫描、启停或热点控制 |
| WireGuard peer 与密钥轮换 | A | peer 集合和 rotate API 已存在 | 私钥永不进入 UI |
| Container、MQTT 开关 | S | typed settings 写入和 live state | 统一 task progress；保留安全提示 |
| API token | S | 列表、签发、吊销；明文只返回一次 | 增加复制反馈和离开前确认 |
| SSH key、SSH 开关 | S | root key 管理和开关 | 持续显示“密钥授予 root”警告 |
| 临时 root 密码 | S | 到重启失效 | 保持二次确认，不与 Web 密码混淆 |
| Web 管理密码 | S | 已有修改动作 | 修改成功后说明 session 行为 |
| 主机名 | S | typed setting + apply task | 显示 saved/applied 状态 |
| 自定义 UI 包与版本选择 | S | 浏览器上传 ZIP、保留多版本、精确激活/停用/删除 | 补齐拖放与更完整的版本详情测试 |
| 重启、关机 | S | 异步接受 | 用专用确认对话框替换 `window.confirm` |
| System Information、诊断 | P | 仅有健康、meta 和零散系统 seam | 等 PLAN-052 的聚合 API |
| 时间、NTP、时区 | P | PLAN-044 草案 | 不显示“暂停时间”或不存在的轮询控件 |
| 系统更新 | A/P | `/api/v1/update` 已提供状态和 check/fetch/install 动作；自动策略与完整恢复交互仍在规划 | 真实动作使用 API，规划部分使用模拟层 |
| 恢复、回滚、凭据恢复 | P | PLAN-048 草案 | 等专用 challenge 与不可逆语义 |
| 存储状态和生命周期 | P | 布局存在，无 operator API | 只规划健康/容量，不做分区编辑器 |
| 安装、认领、工厂 onboarding | P | PLAN-046 草案 | 扩展 setup 状态机前先定设备生命周期 |
| 本地显示 | C | 架构设想复用同一 `/_ui/`，暂无板卡声明支持 | 先保证触控规范，不宣称已交付 |
| Fleet 管理 | C | PLAN-054 为条件设计，当前只有入站 LAN HTTPS | 不把 fleet 菜单放进本地 UI |
| 托管应用清单与精选目录 | P | PLAN-056 已批准设计；当前 UI 已提供隔离模拟，仍没有 app API/manager | OCI 与声明式 native bundle 均先完成交互原型 |
| 公开开放市场/通用编排 | C | 没有运营、隔离、计费或第三方准入能力 | 不进入当前本地 UI 或对外承诺 |
| 通知中心、告警历史 | P | 当前只有 apply task 历史，没有通知模型 | toast 与活动记录分开；等待后端模型 |

## 3. 产品与系统边界

### 3.1 运行链路

```text
远程浏览器 ─┐
            ├─ HTTPS / 同源 ─> mos-apid ─> versioned API ─> mosd
本地 kiosk ─┘          │                         │
                       ├─ /_ui/ 内置 SPA         ├─ settings + tasks
                       └─ / 自定义 UI 或跳转 /_ui/ └─ reconcilers ─> OS/services
```

- `/_ui/` 永远指向内置恢复界面；`/ui` 可由自定义 UI 使用。
- `/` 根据 UI 状态选择已激活的自定义 bundle；无可用 bundle 时回到内置 UI。
- `/api` 是唯一管理协议；listener 健康检查 `/healthz` 是部署例外，不是产品管理接口。
- SPA 的无扩展名路径可以回退到 `index.html`；类似文件名的缺失资源应返回 404。
- 自定义 UI 保存在 DATA 的 `/mos/ui`，能跨重启与 A/B；内置 UI 位于受保护系统镜像中。
- `/`、`/_ui`、`/api` 是相互隔离的三个所有权域；一个域内资源缺失或路径非法时不得去另一个域查找。

### 3.2 安全边界

- 浏览器登录使用 `HttpOnly`、`Secure`、`SameSite=Lax` cookie。
- 登录成功后返回的 CSRF token 只保存在 JS 内存中；每个 session mutation 都携带它。
- bearer token 面向自动化客户端，不复用浏览器 CSRF 机制。
- API 错误统一读取 `{ "error": { "code", "message", "source", "path?" } }`。
- UI 不缓存管理员密码、Wi-Fi PSK、API token 明文或 WireGuard 私钥。
- 读取到 `"<redacted>"` 表示设备持有秘密，不是一个可回写的值；将该字符串回写会被 422 拒绝。
- SSH authorized key 授予 root 权限。界面必须在添加区和列表区都保持此风险可见。
- console shell 设置虽然存在于 schema，但当前没有协调器，不能显示为可用开关。
- 资源路径只解码一次；重复分隔符、`.`、`..`、编码分隔符、反斜杠、控制字符、残留 `%`，以及编码后的
  根级 `api`/`_ui` 的重复分隔符或编码别名都返回 404，不做归一化或跨域重试。`/ui`、`/apiary`、`/_uikit` 等普通名称不受影响。
- `/api` 下的未声明请求始终返回 JSON API 404；`/_ui` 下的资源只来自内置 VFS；其余路径只访问当前
  自定义 bundle。`/healthz` 是显式运行状态探针，不进入任何资源解析器。

### 3.3 CSP 与离线资产

当前 CSP 的产品含义是：脚本、样式、连接和字体默认都只能来自本机；图片只额外允许 `data:`。
因此：

- 禁止 Google Fonts、图标 CDN、远程分析脚本和运行时下载的 UI 组件；
- 继续使用 Lucide 和本地构建产物；新增字体必须随 bundle 自托管，否则使用系统字体；
- 当前字体栈包含 `Inter` 名称但没有随包提供，实际可能回退到 Aptos、Segoe UI 或系统字体；设计
  不得依赖 Inter 独有字宽；
- 不接入运行时遥测 SDK，除非 CSP、隐私和产品契约在同一提案中获批。

### 3.4 单管理员模型

当前只有 setup、unauthenticated、authenticated 三种浏览器会话状态，没有角色、团队、只读用户
或 RBAC。设计不得创建看似可用的角色选择器。未来若增加全局只读模式，必须由后端 capability/
permission 明确返回，而不是只在前端隐藏按钮。

## 4. 前端工程基线

### 4.1 当前栈

| 项目 | 当前选择 |
|---|---|
| Runtime/package manager | Bun |
| View | React 19 |
| Build | Vite 8 |
| Language | TypeScript 7（typescript-eslint 暂由 TypeScript 6 兼容别名驱动） |
| Routing | TanStack Router，文件路由 |
| Server state | TanStack Query |
| Styling | Tailwind CSS v4 + `src/styles.css` tokens |
| Components | shadcn/ui `base-nova` primitives，底层固定为 `@base-ui/react` |
| Design system | Adobe Spectrum 2 视觉、状态、主题与无障碍规则，映射为本地语义 token |
| Icons | Lucide React |
| Test | Vitest + Testing Library + Playwright |

当前目录：

```text
pkgs/mosd/apid/ui/
├── src/app/routes/           # 文件路由；页面入口保持薄
├── src/app/routeTree.gen.ts  # TanStack Router 自动生成，不手改
├── src/features/             # 页面、领域交互与壳层
├── src/shared/components/ui/ # shadcn CLI 拥有的 base-nova primitives
├── src/shared/simulation/    # 无网络访问的临时模拟状态与统一页底标注
├── src/components/           # 迁移期兼容组合组件与 Preferences
├── src/i18n/                 # English fallback、懒加载中文、检测与格式化
├── src/theme/                # light/dark/system 偏好与文档根同步
├── src/shared/lib/http.ts    # 唯一 HTTP/CSRF transport
├── src/lib/                  # 公共类型、领域辅助函数和迁移期 transport 转发
├── src/styles.css            # 全局 token 与当前布局
├── vite.config.ts            # /_ui/ base、路由拆分与内容哈希输出
└── dist/                     # 被 gitignore 的临时生产产物；Rust 构建前生成
```

新增复杂领域按功能切片组织：

```text
src/features/<domain>/
├── api.ts                    # typed calls、query keys、invalidation
├── model.ts                  # view model 与纯校验
├── components/               # 领域组件
└── *.test.tsx
```

路由只负责 URL 参数、页面组合和权限入口；运输层固定在 `src/shared/lib/http.ts`；服务端状态继续由
TanStack Query 管理。表单草稿和模拟能力使用组件/Provider 内存状态，不为简单设置引入全局 store。

### 4.2 构建硬约束

Vite base 是 `/_ui/`。`dist/index.html` 是唯一稳定的启动文件；其余 Vite 产物位于 `dist/assets/`，
文件名包含内容哈希。路由页面、中文 message catalog 和 vendor/app 代码可以形成独立 chunk，文件数量和
名称不是后端源代码的一部分。例如当前输出形态是：

```text
dist/index.html
dist/assets/index-<hash>.css
dist/assets/index-<hash>.js
dist/assets/vendor-<hash>.js
dist/assets/<route>-<hash>.js
dist/assets/zh-cn-<hash>.js
```

`pkgs/mosd/apid/ui/build.sh` 始终使用仓库锁定的 Bun 容器，生成完整的 `_out/apid-ui/dist`，宿主机
不需要安装 Bun。脚本只读挂载 `apid/ui` 源码，把它复制到 `_out/apid-ui/work` 后执行冻结安装、
TanStack 路由生成、TypeScript 检查和 Vite 构建；因此依赖、编译元数据和生成文件都不会写回源码树。
`pkgs/mosd/hack/check.sh`、`build-target.sh` 和 `build-deb.sh` 均先完成前端构建，再通过绝对路径环境变量
`MOS_APID_UI_DIST_DIR` 把产物交给 Rust。Rust 构建容器把源码挂载为只读，把前端产物挂载到
`/build/apid-ui:ro`，并使用独立可写的 `CARGO_TARGET_DIR`；它本身不运行 Bun 或 Vite。

`pkgs/mosd/apid/build.rs` 递归扫描传入的生成目录，拒绝符号链接、不安全名称和非普通文件，要求
`index.html` 存在，按逻辑路径排序，把通过检查的字节复制到 Cargo `OUT_DIR`，再生成 `include_bytes!`
资产表。`assets::builtin` 对该表做二分查找，所以添加、删除或重命名 chunk 不需要修改 Rust 路由；
缺少变量、入口文件或资源树非法会直接使构建失败。直接运行 Cargo 时必须先执行 `build.sh` 并传入绝对路径：

```bash
cd pkgs/mosd
bash apid/ui/build.sh
MOS_APID_UI_DIST_DIR="$PWD/../../_out/apid-ui/dist" cargo check -p apid
```

缓存规则固定如下：`index.html` 和所有 SPA fallback 使用 `no-store`；由 Vite 生成的 `assets/` 内容哈希
资源使用 `public, max-age=31536000, immutable`；其他嵌入文件默认 `no-cache`。所有响应继续使用固定 MIME
allowlist、`nosniff`、CSP 和 `Referrer-Policy`。安全的无扩展路径才允许 SPA fallback；文件型 miss 和敌意
路径必须返回空 404。

构建文件数量不固定；字体、路由、中文 message catalog、组件和运行时代码均可独立形成内容哈希资源。
每个 PR 都应同时报告首屏引用集合与完整资源树的 raw/gzip 变化；任一指标增长超过 10% 时说明原因和
替代方案。不得只比较最大的单个 chunk，也不得为了减少文件数量关闭路由、locale 或组件懒加载。

#### 自定义 UI 包

自定义 UI 不复制进内置 `dist`，而是打成 `.mos-ui.zip` 后由浏览器或 API 上传。包根必须直接包含
`index.html` 和以下 schema 1 清单；`immutableDir` 通常是 Vite 的 `assets`：

```json
{
  "schemaVersion": 1,
  "name": "example-console",
  "version": "1.4.0",
  "immutableDir": "assets",
  "apiVersions": ["v1"]
}
```

仓库提供与服务端共享校验代码的 `mos-ui-pack`。它生成排序、固定时间戳和权限的可复现 ZIP，并可在
上传前检查清单、条目数、压缩/展开大小和 SHA-256：

```bash
cd pkgs/mosd
bash apid/ui/build.sh
cargo run -p mos-ui-bundle --bin mos-ui-pack -- \
  pack ../../_out/apid-ui/dist --name example-console --version 1.4.0 \
  --api-version v1 -o example-console-1.4.0.mos-ui.zip
cargo run -p mos-ui-bundle --bin mos-ui-pack -- \
  inspect example-console-1.4.0.mos-ui.zip
```

上传上限为 64 MiB 压缩文件、256 MiB 总展开内容、32 MiB 单文件、4,096 条目、32 层路径和
100:1 总展开比。包不得包含绝对/父级/空路径、反斜杠、重复名称、非 UTF-8 名称、加密条目、符号链接
或其他特殊文件。服务端仍会独立执行全部检查；本地工具不是信任边界。

### 4.3 本地开发与质量门禁

```bash
cd pkgs/mosd/apid/ui
bun install --frozen-lockfile
bun run dev
bun run lint
bun run typecheck
bun run test
bun run coverage
bash build.sh
bash run.sh
```

`bun run dev` 通过 nsl 启动 Vite；API 页面仍需要可访问的真实 `mos-apid` 或受控测试 stub。
仓库当前没有可以擅自假定的同源后端代理流程，实现新的 API 页面前应把本地 API 连接方式写入该
包 README 或开发脚本。

`build.sh` 是唯一生产资源构建入口：它没有本机 Bun 分支，也不接受可变输出路径，固定在锁定容器内
从只读源码生成 `_out/apid-ui/dist`。`run.sh` 只是该入口的检查模式，依次执行冻结安装、lint、
typecheck、test 和生产构建。`tests/apid-ui-build-contract-test.sh` 另外保证源码内 `dist/` 未被 Git
跟踪，检查唯一容器路径、只读挂载和所有仓库维护的 APID Cargo 入口是否显式传入隔离后的生成目录。

测试数量和覆盖率以当前 `bun run test`/`bun run coverage` 报告为准。门禁通过只能证明已覆盖的逻辑，
不代表页面状态已经完整；新增交互仍须按第 15 节补齐状态矩阵。

## 5. 推荐信息架构与路由

### 5.1 路由树

`/_ui/` 是 Overview，不另增 `/overview` 作为主路径。推荐树如下：

```text
/_ui/                             Overview                         [S]
├── network                       Network 总览（接口 / Wi-Fi / WireGuard 三个页内 tab） [S]
│   └── :name                     接口详情：概览 / 寻址 / 危险操作 [S]
├── services                      Container / MQTT / Web 终端       [S]
│   └── :service                  服务详情与配置                   [S]
├── applications                  Applications 交互模拟            [P]
│   ├── catalog                   精选应用目录                     [P]
│   ├── activity                  安装与生命周期任务               [P]
│   └── :appId                    应用详情                         [P]
│       ├── configuration         声明式配置                       [P]
│       ├── permissions           权限与资源                       [P]
│       ├── logs                  有界日志                         [P]
│       └── versions              更新与回滚                       [P]
├── access                        Web / token / SSH                [S]
└── system                        System 总览与通用设置            [S]
    ├── info                      设备与版本信息                   [P]
    ├── time                      NTP / timezone                   [P]
    ├── update                    更新状态机                       [P]
    ├── storage                   存储健康与容量                   [P]
    └── diagnostics               诊断快照、support bundle 与技术支持 [P]
```

System 只有六个页内 tab（常规 / 信息 / 时间 / 更新与恢复 / 存储 / 诊断），与已批准原型一致。
原先的 recovery tab 已拆分：重置分级并入常规的电源区块，配置备份并入更新与恢复，支持访问并入
诊断。`/_ui/system#recovery` 锚点解析到更新与恢复，不会落回第一个 tab。


冒号参数必须使用路由库编码；SSID、WireGuard public key 等包含特殊字符的路径参数还必须经过
`encodeURIComponent`，尤其 public key 可包含 `/`。

### 5.2 导航规则

- 桌面与中屏：56 px Klein 蓝横向一级导航常驻（窄屏 52 px）；二级导航使用页面内 tabs。
- 导航项在可用宽度降低时先隐藏图标；进入窄屏后改为右侧抽屉，不做第二套页面结构。
- 手机/窄触屏（≤580 px）：一级导航收进右侧抽屉，标题和主操作纵向排列；表格允许带提示的横向滚动，主要表单单列。中屏（581–1099 px）导航只保留图标。
- 二级页面的 active 状态归属一级父项，例如 `/_ui/system/ui` 仍高亮 System。
- Setup 和 Login 由 session 状态决定，不暴露为可收藏的独立管理路径。
- 当前开发版本将 Applications 和 System 规划页加入导航以评审完整交互；它们只使用模拟层并在页底
  标注。生产阶段由 capability 屏蔽，不得仅删除标注后把模拟状态当成真实能力。
- Fleet 永远不是此本地 shell 的入口；未来 fleet 是独立产品表面。

### 5.3 页面骨架

所有 authenticated 页面遵循同一顺序：

1. Eyebrow：所属领域，不承担关键信息；
2. 页面标题和一句结果导向的说明；
3. 右上主操作或整体状态，窄屏下换行；
4. 页面级错误/降级/离线 banner；
5. 摘要与主要工作区；
6. 辅助信息、最近活动或可展开 support detail。

正常 operator 路径不直接展示 JSON。原始响应只能放在明确标记的 “Developer details” 折叠区，
默认收起、可复制、遵守秘密脱敏，并且不能成为完成任务的唯一方式。

## 6. 全局启动、会话与 shell

### 6.1 启动状态机 `[S]`

```text
加载 SPA
  └─ GET /api/v1/session
       ├─ pending            -> Connecting to device
       ├─ request failed     -> Management API unavailable + Retry
       ├─ state=setup        -> Setup
       ├─ unauthenticated    -> Login
       └─ authenticated      -> AppShell + requested route
```

改进要求：

- 启动错误必须提供 Retry，不要求整页刷新；
- 401 使 query cache 清空并回到 Login，同时保留安全的 return path；
- 403 显示权限/CSRF 错误，不误报密码错误；
- 429 在 Login 显示限速，并尊重服务端可用的重试信息；
- 503 若带 `Retry-After`，倒计时后允许自动或手动重试；
- session CSRF 只放在内存，刷新后重新读取 session；不得写 localStorage。

### 6.2 Setup `[S]`

当前输入：可选 hostname、管理员密码、确认密码。API 要求密码至少 8 bytes；UI 校验必须按 UTF-8
byte length 与服务端保持一致，不能只数 JavaScript code units。提交
`POST /api/v1/setup` 后返回 API token 和 CSRF；token 只显示一次。

页面必须：

- 在提交前就近显示 hostname、密码和确认错误；后端 422 的 `path` 聚焦对应字段；
- 明确区分 Web 管理员密码与稍后可设置的临时 root 密码；
- token 区使用一次性秘密组件，提供 Copy、复制成功反馈和“我已保存”确认；
- 用户未确认保存 token 前不得悄悄进入 Overview；离开或刷新前给出明确警告；
- 不在当前 setup 中展示尚未获批的 claim、恢复或完整网络向导。

PLAN-046 获批后，Setup 可以升级为可恢复的分步状态机，但必须继续支持离线工厂路径，并明确
设备处于 factory、unclaimed、claimed 中的哪个生命周期状态。

### 6.3 Login 与 logout `[S]`

- Login 只要求管理员密码，不出现用户名或不存在的 SSO。
- submit pending 时锁定重复提交，保留按钮尺寸，显示文本与 spinner。
- 错误摘要不泄露设备是否存在其他凭据。
- logout 使用 `DELETE /api/v1/session`；成功后清除除 session 外的 query cache。
- logout 失败不得留在模糊状态：401 可视为已退出，其余错误提供重试。

### 6.4 全局连接状态

当前没有 WebSocket；页面使用 query polling。Shell 顶层应聚合“管理 API 可达性”，页面自行显示
领域数据的新鲜度。建议状态：

| 状态 | 判定 | 呈现 |
|---|---|---|
| Live | 最近一次请求成功，未超过该 query 的 freshness window | 正常内容，可显示“刚刚更新” |
| Refreshing | 有旧数据，同时后台请求进行中 | 保留旧数据，小型非阻塞进度 |
| Stale | 有旧数据，但超过两个正常轮询周期 | 时间戳 + warning，不清空页面 |
| Degraded | API 可达，但某个 observer/reconciler 明确失败 | 保留配置，指出失败来源 |
| Offline | session/health 连续失败，无法确认管理面 | 顶层 banner；mutation 禁用并说明原因 |
| Unsupported | 后端明确声明设备无该能力 | 隐藏入口或显示不可用原因，不当作错误 |

Overview 当前轮询：health 15 秒、network 10 秒、tasks 5 秒；TaskProgress 每 1 秒查询接受的任务直至
结束。轮询暂停和恢复应遵循 TanStack Query 的窗口/网络策略，不增加无依据的“暂停设备时间”概念。

## 7. 页面开发说明

### 7.1 Overview `/_ui/` `[S]`

**目标：** 十秒内回答“设备管理面是否可用、网络边缘是否正常、最近配置是否成功”。

**当前数据：**

- `/api/v1/health`：apid、mosd、uptime；
- `/api/v1/meta`：API 版本、settings schema、daemon；
- `/api/v1/network`：configured count 和 observed interfaces；
- `/api/v1/tasks`：本次启动内有界的 apply task 历史。

**推荐布局：**

1. 页面级管理状态和最后成功时间；
2. 三个摘要卡：Management、Network、Uptime；
3. Network edge：最多 5 个接口，展示 observed 状态并进入详情；
4. Recent activity：最近 5 个 task，按新到旧；
5. Architecture boundary 说明移入帮助/详情，不长期占据高频工作区。

**规则：**

- `checkedAt` 是启动后的秒数，可用作 uptime，不是 UTC 时间戳；
- `configuredCount > 0` 不代表接口已连接；
- mosd unreachable 时，apid 仍可能是 ok，应显示“管理 API 在线，设备状态不可达”；
- task finished + succeeded 才使用 success；queued/running 使用 neutral/progress；failed 显示 message；
- 没有 task 是正常 empty state：“本次启动尚无配置任务”，不能显示 warning；
- 未来 update、storage 等摘要只有在相应 capability 存在时才加入，最多保持 3～4 个首屏指标。

### 7.2 Network 总览 `/_ui/network` `[S]`

**目标：** 并排呈现声明配置与实际网络事实，快速定位“未配置、已配置未应用、已应用未连通”。

**当前页面：** Observed/Configured/Observer 三个摘要，接口表，observer 错误，configured map 原始 JSON。

**改进后的行模型：**

| 区域 | 内容 |
|---|---|
| Identity | interface name、kind、index、driver、MAC（可按隐私策略部分遮挡） |
| Configured | DHCP/static/unaddressed、VLAN parent/id、bridge members、WG listen port |
| Observed | operational、carrier、address state、addresses、MTU |
| Reconcile | 与最近任务相关的 queued/running/succeeded/failed；没有任务时不虚构 |
| Actions | View/Edit；删除只在 typed API 和依赖检查通过时出现 |

observed provider 失败时必须继续显示 configured 数据和最后一次成功数据，并在表头明确 “Live state
unavailable”。正常 operator 视图用字段与摘要替代 configured JSON；原始 JSON 移到折叠详情。

### 7.3 接口编辑 `/_ui/network/interfaces/:iface` `[A]`

**API：** `PUT /api/v1/network/{iface}`、`DELETE /api/v1/network/{iface}`，必要时读取
`GET /api/v1/network`。整体替换 `PUT /api/v1/network` 只用于确有跨接口原子编辑的高级流程，普通
表单优先单接口 API。

**支持类型：** physical、vlan、bridge、wireguard。接口名不是类型声明，`eth0.100` 只是惯例；
kind 和对应参数块才是事实。

**表单结构：**

- Identity：name（创建时）、kind；编辑现有接口时 name 默认不可原地重命名；
- Addressing：DHCP；关闭 DHCP 后选择 static 或 no addressing；
- Static：address/prefix、gateway、DNS，以 OpenAPI/后端 schema 为准；
- VLAN：parent、id；
- Bridge：`ports`（成员接口）；bridge port 必须 no addressing；
- WireGuard：listen port、peer 摘要，peer 详情进入专页。

**关系和安全：**

- 前端做即时友好校验，后端做最终整树校验；422 `path` 映射到字段或关系错误摘要；
- 删除 parent、bridge 或被依赖接口前先展示依赖，不能仅靠 confirm 后等待后端拒绝；
- 修改当前管理链路可能让浏览器失联。提交前显示“当前会话可能断开”、新地址和恢复步骤；
- 204 只表示写入接受完成，不等于链路已工作。随后刷新 configured 和 observed，明确显示差异；
- 不提供未经后端支持的自动回滚倒计时。若产品需要“失联自动回滚”，先设计后端事务契约。

### 7.4 Wi-Fi 已知网络 `/_ui/network/wifi` `[A]`

**当前 API 能力只包括：** 列表、添加、忘记 known network。它不等于扫描附近 AP、启用/停用 station、
立即 connect、显示信号强度或配置 AP 模式。

**列表字段：** SSID、security（根据 PSK 是否存在推导为 protected/open）、hidden、priority。PSK 永不
回显；`<redacted>` 显示为 “Password saved”。

**添加表单：**

- SSID；
- Open network 开关；关闭时输入 PSK；
- Hidden；
- Priority，说明“数值越大越优先”。

PSK 接受 8～63 个可打印 ASCII 字符（不含双引号和反斜杠），或 64 位十六进制 PMK。前端可帮助
校验但不修改、trim 或规范化用户秘密。不得把 `<redacted>` 放入 input value，也不得回写。

“Forget” 是破坏性操作，确认框显示 SSID 和影响：设备以后不会再自动使用该已知网络。SSID 进入
URL 前必须编码。没有 observed association API 时不要显示 “Connected”。

### 7.5 WireGuard `/_ui/network/wireguard/:iface` `[A]`

**能力：** 列出、添加、删除 peer；轮换本机 tunnel private key；读取到的设置中永远没有私钥。

**页面：**

- tunnel 摘要：interface、configured address、listen port、设备 public key（仅在 state API 真实提供时）；
- peer 列表：public key 指纹化摘要、allowed IPs、endpoint、persistent keepalive；
- Add peer drawer/dialog；
- Rotate key 危险区。

public key 是 32-byte X25519 padded base64；删除 path 中必须 percent-encode。allowed IPs 是 CIDR
列表；endpoint 是 `host:port`；keepalive 是非负秒数。

Rotate key 会改变本机公钥并可能使所有远端 peer 失联。确认对话框必须列出影响、要求再次确认，
成功后只展示 API 返回的新 public half 和需要更新远端的说明。UI、日志、错误和剪贴板都不得出现
设备 private key。

### 7.6 Services `/_ui/services` `[S]`

当前只管理两个系统级能力：Container runtime 和 MQTT。开关分别通过 typed settings 路径写入，
页面读取 live state，并用 TaskProgress 跟踪 202 返回的任务。

**设置行模式：** 名称 + 一句影响说明 + observed 状态 + switch。切换后：

```text
本地 optimistic intent -> 202 TaskAccepted -> queued/running
  -> finished/succeeded -> invalidate setting + state
  -> finished/failed    -> 恢复已确认值 + 显示 message
```

不得在 task 成功前把服务标为 running。快速重复切换时禁用控件或折叠到最后一个有意图的值，并显示
服务端 `foldedCount`（如果与用户理解有关）。

当前 typed generic write 只允许以下四个 dot-path：

- `hostname`（string）；
- `access.ssh.enabled`（boolean）；
- `container.enabled`（boolean）；
- `mqtt.enabled`（boolean）。

MQTT listen/auth 虽存在于 settings schema，但没有可用 typed product write；Container 也不是应用市场。
不得用 generic settings UI 绕过这条白名单。

浏览器 Terminal 当前只实现交互模拟：开关与终端输出不发起 shell、systemd 或 WebSocket 请求，刷新后
复位，页面底部持续标注“模拟界面”。真实终端能力若未来获批，必须先定义受约束会话、审计、超时、
并发与命令权限协议，不能把通用 root shell 直接接到现有 HTTP transport。

### 7.7 Applications `/_ui/applications` `[P · PLAN-056 · 当前为模拟]`

Applications 是独立于 Services 的第六个产品区域。它管理“一个可安装产品”的身份、来源、版本、
权限、数据和生命周期；Services 继续只管理 `container.enabled`、`mqtt.enabled` 等 mos 系统能力。
当前设备没有 `/api/v1/apps`、应用目录或 `mos-appd`，所以本节是已批准的产品与接口设计，**不是当前
已交付设备能力**。内置 UI 已注册完整交互原型：安装、启动/停止、更新、保留数据移除、详情和 Activity
只写入 `SimulationProvider` 的内存状态，不导入 HTTP transport；页面底部固定说明刷新后复位。生产阶段
在 capability 可用前屏蔽该入口。

#### 应用类型与信任标签

列表和详情必须同时显示应用类型与来源，不能只写一个模糊的 “Installed”。

| 来源 | UI 标签 | 可执行动作 | 更新所有者 |
|---|---|---|---|
| System | System · OS verified | 查看状态和详情；不可单独删除/更新 | RAUC 系统更新 |
| Curated catalog | Catalog verified | 安装、启动、停止、更新、回滚、移除 | `mos-appd` |
| Local trusted | Local signer | 同托管应用，但持续显示本地信任来源 | `mos-appd`；默认关闭入口 |
| External/unmanaged | External · unmanaged | 只读观测和诊断；不得接管、更新或移除 | 原集成商/管理员 |

托管 artifact 支持两种 kind：

- **OCI**：第一阶段；只接受目录签名且以 digest 锁定的完整镜像引用，由 manager 生成受管 Quadlet；
- **Native**：后续阶段；目录 bundle 包含程序和声明式 runtime manifest，由 manager 生成受限、命名空间化
  的 `mos-app-<id>.service`。目录不得接受任意 systemd unit 或 shell 启动脚本；
- 原始 unit/脚本只能作为明确标注的 trusted-integrator/local 安装，签名只证明发布者身份，不证明权限安全。

每个托管应用的签名 manifest 至少携带：稳定 app id、名称/vendor/version、kind、artifact digest 与签名
身份、architecture/board/profile/mos API/schema/system-version 兼容范围、端口/网络/设备节点/D-Bus/MQTT/
mount/持久存储/秘密声明、CPU/memory/PIDs/I/O 与 Linux capability 请求、entrypoint/restart/health、
数据 schema 与回滚兼容性、license、SBOM/provenance 和支持身份。UI 只渲染后端已经验证和归一化后的
manifest；不得在浏览器中自行判断签名可信或将原始 bundle 当作 JSON 解析。

#### 页面结构

`/_ui/applications` 默认进入 **Installed**；同一级 tab 为 **Catalog** 和 **Activity**。

- **Installed**：搜索、来源/kind/state filter、应用卡或摘要表。卡片显示名称、版本、kind、信任来源、
  desired/runtime/health、更新时间和一个主动作；系统应用和 unmanaged 应用清楚标为只读；
- **Catalog**：只显示设备当前兼容或可解释不兼容原因的精选条目。卡片显示 publisher、verified 状态、
  kind、版本、下载/空间要求、权限摘要和 Install/Update；目录离线时保留缓存并显示新鲜度；
- **Activity**：列出有界的 install/update/remove/start/stop/rollback task，显示 target、阶段、进度、结果、
  发起者和时间；它不是长期审计日志的替代品；
- **Detail**：Overview、Configuration、Permissions、Logs、Versions 五个 tab。详情页主操作由当前状态决定，
  不堆叠一排彼此冲突的 Start/Stop/Update/Rollback。

应用列表使用三层运行状态，不能合成一个含糊的绿色圆点：

| 层 | 示例 | UI 用途 |
|---|---|---|
| Desired | installed + enabled / disabled | 用户期望；由 registry 提供 |
| Runtime | running / stopped / activating / failed / blocked | systemd/Podman 归一化事实 |
| Health | healthy / degraded / unhealthy / unknown | manifest health check 的有界结果 |

安装生命周期统一为 `absent -> staging -> verifying -> installed -> activating -> running`，任何执行阶段都
可进入 `failed`；更新先保留 last-known-good artifact，健康闸失败则进入 `rolling-back`，最终回到旧版本或
`blocked`。`blocked` 必须携带机器可读 reason，例如 containers disabled、incompatible OS、signature revoked、
port conflict、device unavailable 或 insufficient space。

#### 安装与更新流程

Install/Update 使用四步流程，所有权限与空间来自服务端 preflight：

1. **Review compatibility**：版本、publisher/signature、kind、设备/架构/系统兼容性、下载大小；
2. **Review access and storage**：host ports、networks、device nodes、bus/topic、mount、secret、capabilities、
   CPU/memory/PIDs/I/O ceiling、持久数据预留；高风险权限单独解释；
3. **Confirm**：显示将安装的精确版本与 digest、会启动/停止什么、已有数据与回滚限制；
4. **Progress**：绑定一个 task，依次显示 downloading、verifying、installing、health check 和 terminal result。

前端不能让用户修改目录声明来“解决”权限冲突。preflight 返回冲突时，UI 指向冲突应用/端口/设备，允许
取消或进入相关配置页面；不能忽略继续。OCI 应用在 `container.enabled=false` 时显示 Blocked 和 “Open
Services”，安装流程不得静默打开全局 runtime。Native 入口只有设备声明支持 managed native sandbox 时
才出现；不得因为下载包后缀看起来正确就开放。

更新需要并列显示 current 与 target version、release notes、权限 delta、数据 migration、所需空间、能否
code rollback 和能否 data rollback。自动更新若未来开放，必须是每应用策略并服从系统 update maintenance
interlock；本指南不默认开启。

#### 配置、秘密、日志与版本

- Configuration 只渲染 manifest 指定、后端提供 schema 的 typed field；保存生成 task。不能展示任意 env、
  host path 或命令输入框；
- Secret field 始终是 write-only reference。已保存状态显示“Configured”，不回显值；更新秘密走专用 action，
  manager 以 systemd credential/file 交付，不放环境变量；
- Permissions 显示请求值、实际授予值和来源。变更权限等价于一次新 revision/preflight，不直接编辑运行中 unit；
- Logs 只读当前有界 journal window，默认脱敏、支持时间/stream/filter 和下载经过审核的 bounded export；
  不承诺永久历史；
- Versions 显示 current、last-known-good、available 和 compatibility。Rollback 只有后端返回 eligible 时可用，
  并明确“回滚代码不一定回滚数据”。

#### 停止、移除与清除数据

Stop 是可恢复的普通确认；Restart 在应用正在运行且没有冲突 task 时提供。Remove 默认 **Keep application
data**，先停止并移除受管 runtime definition/artifact，保留 `/mos/apps/<id>/data/` 与 registry retention
记录，允许兼容版本重新安装。Purge data 是独立高风险动作，必须再次显示 app id、路径类别、数据量与不可逆
影响，并要求输入应用名称或后端 challenge。System 和 External/unmanaged 不显示 Remove。

#### 后端所有权与存储边界

未来 `mos-appd` 位于 mosd 后面，负责有界 staging、签名/摘要/兼容验证、registry、受管 runtime definition、
systemd 操作、健康闸、回滚和 GC。artifact acquisition 应在无特权上下文完成；特权 activation 必须重新验证
同一 digest。APID 仍只访问 mosd；UI、APID 和 mosd 都不得直接拼接 shell 或写 unit。

```text
Browser / kiosk -> APID -> mosd -> mos-appd -> verified OCI/native adapter -> systemd
                         |          |              |                       |
                         |          |              +-- generated runtime --+
                         |          +-- registry / task / audit
                         +-- typed app state; never raw unit or command
```

小型 registry/active revision 元数据放 STATE：`/mnt/state/mos/apps/`；下载 staging、artifact cache 和应用
持久数据放 DATA：`/mos/apps/`。日志位于有界、易失 journal；秘密进入新的受保护 per-app store。不得把
大型 image/bundle 写入 STATE，也不得把持久数据写入 `/var`。应用和系统更新共享 maintenance interlock；
启动时必须重新校验 active revision 与当前 OS 的兼容性，不能只在安装时检查。

#### 必须设计的空态、降级与错误

- 首次进入没有应用：说明 System/managed/external 三类，不用“去商店”掩盖目录不可用；
- catalog offline：显示缓存新鲜度，禁止需要在线验证的安装，不把网络失败说成“无应用”；
- containers disabled：所有 OCI 项展示同一 prerequisite，不逐卡给出互相矛盾的状态；
- task result unknown：先按 task id/应用状态读取，不自动重复 install/remove；
- signature/revocation failure：停止在 verified staging 之前，显示 publisher/digest/reason，不提供 bypass；
- low space/conflict：preflight 阶段失败，显示 staging、artifact、data reservation 各自需求；
- OS rollback incompatibility：应用 safe-disable 为 Blocked，保留数据和诊断，不反复 crash-loop；
- manager unavailable：Applications 保留入口和缓存，但所有 mutation disabled；这不是 unsupported。

### 7.8 Access `/_ui/access` `[S]`

按风险从日常到高权限分为四组，而不是按 API 顺序堆放。

#### Web administrator

- 修改管理员密码需要当前密码、新密码、确认；
- 新密码规则与后端保持一致；422 聚焦字段；
- 成功后清空所有 password input；说明当前 session 是否继续有效，以实际 API 行为为准；
- 不提供用户名、角色或 email，因为模型中不存在。

#### API tokens

- 列表只显示 id、`name`（产品文案可称 label）和服务端提供的 `created`；设备时钟可能未同步，
  `created=0` 或异常时间只能作为标签，不能推导有效期；token 当前不会自动过期；
- Mint 需要清楚 `name`；明文 token 使用一次性秘密组件，只展示一次；
- 用户关闭一次性面板后，前端立即丢弃明文；
- Revoke 确认显示 label/id，成功后从列表移除；当前 session 不应因为其他 token 被吊销而退出。

#### SSH

- 总开关由 `access.ssh.enabled` + apply task 控制；
- 列表和添加表单持续显示“每个 authorized key 都授予 root shell”；
- 新 key 提交前可解析注释用于确认，但 fingerprint 以服务端返回为准；
- 删除按 fingerprint，确认显示 fingerprint 与 comment；
- SSH 关闭时仍可管理已保存 keys，但需要清楚说明“已保存、当前不接受 SSH”。

#### Transient root password

- 密码仅到重启有效；它不是 Web 管理员密码；
- 输入要求 8～72 bytes，且不得含 NUL、换行或回车；按 UTF-8 bytes 校验；
- 设置前要求明确确认，成功后不回显、不持久化、不放剪贴板；
- 与 SSH 面板放在同一高权限区域是当前信息架构选择；视觉上仍应独立成卡片；
- 设备没有凭据恢复机制时，界面必须坦率说明：忘记管理员凭据可能只能整盘重刷。

### 7.9 System `/_ui/system` `[S]`

当前 System 首页包含三组；自定义 UI 的完整生命周期进入 `/_ui/system/ui` 专页，首页只保留状态摘要与
管理入口。

#### General / hostname

编辑 `hostname`，202 后跟踪 apply task。保存成功与应用成功分开；失败保留用户草稿，并提供恢复到已
确认值的操作。

#### UI selection

`GET /api/v1/ui` 返回当前 mode 和紧凑候选摘要；`GET /api/v1/ui/bundles` 返回全部保留版本。

- built-in 永远可恢复；
- 上传只安装为 inactive，不改变 `/`；进度区分传输与服务端验证/安装；
- Activate 发送精确 generation，并由服务端重新执行安全、摘要与 API 兼容检查；
- Deactivate 回到 built-in；
- 版本表显示 name、version、generation、可用性和 active 状态；活动版本不得删除；
- 相同包、同名同版本不同摘要、版本数量已满或不兼容均以 409 的服务端原因为准；
- ZIP 拒绝、空间不足和上传中断保留已选择文件，允许修正后重试；
- 系统不自动清理旧版本；达到 32 个版本或空间余量不足时要求用户显式删除 inactive 版本；
- 切换后解释 `/` 的选择变化，并始终提供 `/_ui/` 恢复地址。

#### Power

Reboot 和 Power off 使用专用 ConfirmDialog，不再使用浏览器 `window.confirm`。确认内容必须包括：

- 动作名称和设备身份（至少 hostname）；
- 当前可能运行的 apply task；
- 会话将断开；
- Power off 之后需要物理或外部方式重新上电。

202 表示设备接受动作。之后进入 “Rebooting”/“Powering off” 全页状态，停止普通 mutation；重启可
周期性探测 session 恢复，关机不承诺自动恢复。

### 7.10 System Information `/_ui/system/info` `[P · PLAN-052/043]`

当前作为 System 页内 tab 显示模拟硬件身份，并将真实 `/api/v1/meta` 与 `/api/v1/health` 字段清楚分开；
页底标注模拟边界。聚合、版本化 API 可用后再替换示例字段。目标字段：machine id（默认部分遮挡）、board、kernel、系统镜像
版本及 git stamp、build date、安装包 manifest、active RAUC slot、uptime。

- 页面只读，可复制 support-safe 摘要；
- package manifest 默认折叠、可搜索；
- “未知/未提供”与空字符串分开；
- 不把 `/api/v1/meta` 的 daemon/schema 当作完整系统版本；
- release identity 必须来自 PLAN-043 定义的产物，不能由前端拼接猜测。

### 7.11 Time `/_ui/system/time` `[P · PLAN-044]`

目标页面包含当前本地时间、UTC、时区、同步状态、NTP servers、last successful sync 和 source。
保存时明确哪些值立即应用，哪些需要等待 timesyncd。草案要求系统持续校时，因此不设计“暂停 NTP”
或 GUI 自己轮询修改系统时间。当前 tab 是只修改内存的交互模拟；不得导入 HTTP transport。

### 7.12 Update `/_ui/system/update` `[A/P · PLAN-047]`

必须以完整后端状态机为前提：

```text
idle -> checking -> downloading -> ready -> installing
     -> reboot-required -> validating -> succeeded
                                  └────> rolled-back / failed
```

每个状态定义：允许动作、进度是否确定、可否离开页面、是否安全重启、错误是否可重试。更新来源、签名/
认证、maintenance window、slot 和 rollback 结果由后端提供。当前状态读取以及 check/fetch/install 使用
`/api/v1/update` 产品 API；自动更新策略仍为模拟状态。UI 不得直接接 D-Bus，也不得让模拟设置进入 API。

### 7.13 Storage `/_ui/system/storage` `[P · PLAN-049]`

只规划 operator 需要的状态：system/data/media tiers、容量、使用率、健康、只读/降级、阈值、数据生命周期
说明。不得做通用 partition editor、任意 mount 或文件浏览器。清理/格式化等动作必须有独立 API、影响
预览和不可逆确认。当前容量与分配视图是模拟数据，页底统一标注。

### 7.14 Diagnostics `/_ui/system/diagnostics` `[P · PLAN-052]`

页面以一次版本化、大小和时间均有界的诊断快照为数据源。内容包括 release/board、启动槽、reset cause、
服务/协调器失败、存储、时间、thermal/watchdog 和 observed network。Support bundle 必须按已审核 schema
脱敏并显示大小、包含范围和隐私说明。当前收集、下载就绪和临时支持访问均为内存模拟；没有经过测试
的脱敏边界前不得连接真实下载或远程访问。

### 7.15 Recovery `/_ui/system/recovery` `[P · PLAN-048]`

按风险从低到高排列：restart service（若未来有 typed action）、rollback、credential recovery、reset、wipe。
每个动作都需要后端返回 eligibility、影响范围和 challenge；前端不能自行推断可恢复性。不可逆动作采用
设备名/挑战短语确认，说明保留与删除的数据，并在执行后提供明确的终态或物理恢复步骤。当前备份、
恢复和 factory reset 只展示交互与确认，不执行设备 mutation。

### 7.16 不进入本地导航的规划项

- PLAN-042 官方文档：未来可以提供 context help link，但网站存在前不放死链接；
- PLAN-045 BusyBox emergency binary：紧急维护能力，不是正常 UI 应用；
- PLAN-050 BSP qualification：只通过 capability/system information 体现，不做 BSP 管理页；
- PLAN-051 应用交付：仍是可信集成商直接交付指南；PLAN-056 单独定义 managed applications；
- 公开开放市场、评分/支付、第三方自由发布和 fleet 批量 rollout 不进入本地导航；
- PLAN-053 制造/安全生命周期：只呈现后端可证明的安全状态，不能画假的 secure-boot 绿勾；
- PLAN-054 fleet：条件设计，若获批应形成独立远程产品，而非本地设备页。

## 8. 状态、反馈与错误规范

### 8.1 Configured / Applied / Observed

所有会改变设备的页面先回答“这个值属于哪一层”。统一用词：

| 层 | 中文含义 | 数据来源 | 示例 |
|---|---|---|---|
| Configured | 已保存的期望状态 | settings/typed configuration read | `mqtt.enabled = true` |
| Applied | 协调器尝试执行后的结果 | TaskRecord 或专用 operation state | task succeeded / failed |
| Observed | 系统此刻真实看到的状态 | `/state`、network observer、专用 status API | service active、carrier off |

一个控件的典型显示可以是：

```text
MQTT                         Configured: On
Publish and subscribe...     Observed: Stopped
                              Apply failed · View details
```

不得把 optimistic toggle 当成 Configured 已确认，不得把 task succeeded 自动等同于业务可达。例如网络
文件应用成功后，carrier 仍可能 off；服务启动成功后，外部 broker 仍可能不可达。

### 8.2 Query 状态模板

每个 query 必须实现以下渲染分支：

1. **Initial loading：** 无旧数据，使用与最终布局接近的 skeleton；短启动页可用 spinner + 文本。
2. **Success with data：** 正常内容，记录最后成功时间。
3. **Success empty：** 解释为什么为空，给出用户有权限执行的下一步；空不是错误。
4. **Background refresh：** 保留内容，不用全页 spinner；只在页头或局部显示 refreshing。
5. **Error with cached data：** 保留旧值，标为 stale，显示错误和 retry。
6. **Error without data：** 页面级错误块，包含可操作的 retry；认证错误交给 session 层。
7. **Unsupported：** 由明确 capability 得出，隐藏导航或解释 unavailable reason。

页面不能用 `data?.x ?? false` 把“还没加载”显示成 off，也不能把 `undefined` 显示成 healthy。

### 8.3 Mutation 状态模板

```text
idle -> validating -> submitting -> accepted/applying -> succeeded
                                  └─> failed
```

- validating：字段错误就近显示，并有页面级摘要供屏幕阅读器导航；
- submitting：禁用重复提交，但允许复制/阅读非冲突内容；
- 201/204：按 endpoint 语义刷新 query；不凭空创建 apply task；
- 202 TaskAccepted：立即呈现 TaskProgress，按 id 每秒读取，直到 finished；
- failed：保留用户输入；错误 message 做可读摘要，code/source/path 放详情；
- succeeded：更新 query cache 后给短 toast；重要的一次性结果留在页面，不只发 toast；
- 离开页面时：已由服务端接受的 task 继续存在，返回后可从 task history 找到。

### 8.4 Toast、活动与未来通知

- **Toast：** 用户刚触发动作的短反馈，例如“已复制”“已保存”；可自动消失，不承载秘密或唯一错误。
- **Activity：** 本次启动内的 apply task 记录；当前可由 `/tasks` 支持，可在 Overview 或全局 drawer 展示。
- **Notification/Alarm：** 需要确认、历史、严重级别和后端生命周期；当前没有模型，不创建假通知中心。

### 8.5 API 错误到 UI 的映射

| HTTP | 默认含义 | UI 行为 |
|---:|---|---|
| 400 | 请求格式错误 | 保留表单；错误摘要；开发详情显示 code |
| 401 | session 无效或未认证 | 清理敏感 cache，回到 Login |
| 403 | CSRF/权限拒绝 | 不重复提交；重新读取 session；显示安全错误 |
| 404 | 资源或 path 不存在 | 行级 not found；刷新集合；不泛化成整页 404 |
| 405 | 方法不允许 | 产品缺陷；显示通用失败并记录开发详情 |
| 409 | 状态冲突/重复资源 | 保留输入；解释冲突；刷新服务端当前值 |
| 422 | 语义/字段校验失败 | 用 `path` 定位字段，无法定位则放页面摘要 |
| 429 | 登录/请求限速 | 显示等待时间；禁用自动快速重试 |
| 500 | apid 内部错误 | 保留已知数据；提供 retry 和 support code |
| 503 | mosd/能力暂不可达 | 显示 degraded；尊重 `Retry-After` |
| 504 | 下游超时 | 结果可能未知；先刷新状态，不盲目重复 mutation |

错误文案不直接把服务端字符串当 HTML；使用纯文本渲染。错误详情可复制，但必须经过与页面数据相同的
秘密脱敏。

## 9. 组件规范

### 9.1 组件分层

```text
Primitives                    Product patterns                 Feature components
Button / Field / Switch       PageHeader                       NetworkInterfaceEditor
Card / Status                 SettingsRow                      WifiKnownNetworkForm
Dialog / Tabs / Table         QueryBoundary                    WireGuardPeerList
                              TaskProgress                     UpdateStatePanel
                              SensitiveReveal
                              ConfirmAction
```

`src/components/ui` 只放无领域知识的 primitive。带 API 状态或产品语义的模式放共享 components 或
feature 目录。不要把每个页面的专用 prop 不断塞进 Button/Card。

### 9.2 必备共享模式

| 组件 | 要求 |
|---|---|
| `PageHeader` | eyebrow、title、description、primary action、freshness/status slot |
| `SettingsRow` | label、description、configured value、observed value、control、pending/error |
| `StatusBadge` | icon + 文本 + tone；颜色不是唯一线索 |
| `QueryBoundary` | initial/empty/stale/error/retry，允许保留 cached children |
| `TaskProgress` | task id、operation、queued/running/finished、outcome、message |
| `SensitiveReveal` | 一次性内容、copy、copied、离开确认、主动清除 |
| `ConfirmAction` | action、target、impact、challenge、pending、API error |
| `FieldErrorSummary` | 收集字段错误，点击/键盘跳到对应 field |
| `Freshness` | 最后成功时间、refreshing、stale、manual refresh |
| `CapabilityGate` | 只基于明确 capability；error 不等于 absent |

### 9.3 表单

- 每个 input 有可见 label；placeholder 不是 label。
- description 在输入前解释格式和影响，error 在输入后；`aria-describedby` 同时关联。
- 必填/可选用文字标识，不只使用星号。
- submit 前不 trim 密码、PSK、token、公钥、SSID 或 hostname；hostname API 明确保存客户端选择的
  bytes，格式是否合法由同一前后端校验规则决定。
- field error 出现后保持 focus；提交时第一个错误获得 focus，页面级 summary 获得可编程焦点。
- switch 只用于立即表达二元设置；打开 dialog 或执行一次性动作使用 Button。
- 保存按钮采用 “Save hostname”“Add peer” 等具体动词，不统一写模糊的 “Submit”。
- mutation pending 时禁止双击；失败后按钮恢复，不清空输入。

### 9.4 表格与集合

- 桌面表格 `<thead>`、row header 和 actions 列语义完整；操作菜单可键盘访问。
- 窄屏优先转为卡片化 key/value，不隐藏关键字段；数据特别宽时允许横向滚动并给出视觉提示。
- 空集合显示领域含义，例如“No authorized keys”并附 root 风险说明，而不是只显示“No data”。
- 列表更新使用稳定服务端 id/fingerprint/public key，不用数组 index。
- 一次删除只影响一个明确资源；批量操作需要另行定义 selection、partial failure 和审计语义。

### 9.5 确认级别

| 级别 | 示例 | 交互 |
|---|---|---|
| L0 可撤销/低风险 | 手动 refresh、复制 | 直接执行 + toast |
| L1 普通配置 | hostname、service toggle | 明确按钮；失败可恢复 |
| L2 可能中断访问 | 网络修改、SSH disable、forget Wi-Fi | 对话框列影响和恢复方式 |
| L3 高风险/不可逆 | reboot、poweroff、key rotate、revoke token | 对话框 + target；不可回退时二次确认 |
| L4 擦除/恢复 | factory reset、wipe、credential recovery | 后端 challenge + 输入设备身份 + 完整影响清单 |

只有 L0/L1 的成功适合仅用 toast。L2 以上必须在页面内留下明确终态。

## 10. 视觉与响应式规范

### 10.1 Spectrum 2 与本地 token

组件实现与视觉规范分层：React 控件只使用项目拥有的 shadcn `base-nova` primitives，交互底层只使用
Base UI；Adobe Spectrum 2 是颜色层级、控件状态、focus、密度、motion 与可访问性的设计依据。不得在同一
页面再引入 React Spectrum、Spectrum Web Components、旧版 Spectrum CSS 或另一套 primitive runtime。

当前浅色 token：

| Token | 值 | 用途 |
|---|---|---|
| background | `oklch(.961 .011 95)` | 暖灰应用背景 |
| surface / popover | `oklch(1 0 0)` | 卡片、菜单、面板 |
| foreground | `oklch(.17 .075 270)` | 主文本 |
| muted | `oklch(.923 .026 270)` | 次级表面与 hover |
| muted foreground | `oklch(.44 .075 270)` | 次级文本 |
| border / input | `oklch(.75 .055 270)` / `oklch(.68 .055 270)` | 分组与控件边界 |
| primary / ring | `oklch(.36 .205 264)` / `oklch(.42 .2 264)` | Klein 蓝主动作、选择和 focus |
| accent | `oklch(.895 .052 270)` | 当前导航等低强调选择面 |
| success | `oklch(.45 .13 150)` | 已证实成功 |
| warning | `oklch(.46 .105 80)` | 风险/降级 |
| danger | `oklch(.47 .19 27)` | 失败/危险动作 |

深色主题使用 `.dark` 的独立 Spectrum-aligned 角色，不通过 alpha 反转浅色值。`ThemeProvider` 支持
`system`、`light`、`dark`，默认跟随系统，并以 `mos.ui.theme` 保存用户明确选择；system 模式才监听
`prefers-color-scheme`。根元素 class、`color-scheme` 和 `theme-color` 必须同步。

success、warning、danger 必须使用各自 token，并同时提供 icon/文本。项目没有可再分发的 Adobe Clean，
因此自托管 Barlow 与 Barlow Condensed 并为中文使用系统无衬线回退；图标继续使用 Lucide，不声称嵌入
Adobe 产品组件或字体。

### 10.2 尺寸和密度

- body 建议 14～16 px，说明文字最小 12 px；不得用 10 px 承载关键操作或状态。
- 精确指针的普通控件高 38 px，紧凑表格动作最小 32 px；粗指针/触屏目标强制至少 44×44 CSS px。
- 页面最大内容宽度为 1280 px；桌面页边距 24 px，窄屏至少 16 px。
- 卡片间距采用 14/16 px 节奏；卡片内部 20～24 px；相关 label 与 control 间距小于卡片间距。
- 状态和数值使用 tabular figures 或等宽数字，接口名、公钥、地址使用系统 monospace。

### 10.3 屏幕类别

| 类别 | 参考宽度 | 行为 |
|---|---:|---|
| Compact | 320～580 | 单列；标题换行；bottom/顶部导航可横滚；表单全宽 |
| Medium | 581～860 | 顶部一级导航；摘要 1～2 列；dialog 宽度受限 |
| Desktop | 861～1439 | 顶部横向导航；2～4 列摘要；标准表格 |
| Wide | ≥1440 | 内容仍限制 1180～1280；不无限拉伸行长 |
| Local touch | 由板卡声明 | 强制 ≥44 px；无 hover-only；虚拟键盘不遮挡提交/错误 |

断点是当前 CSS 基线，不等于设备能力。未来本地显示应通过 screen class/capability 调整密度与 idle
行为，不复制一个独立 UI 代码库。

### 10.4 Motion 与 idle

- 已有 `prefers-reduced-motion` 必须保留；所有新动画也遵守。
- spinner 只表示活动，不表示成功；超过数秒时附文本。
- 不用循环装饰动画表现设备“活着”。
- kiosk idle/blanking 只有在板卡显示能力落地后实现；危险 dialog 和一次性秘密展示期间不得自动轮播。

## 11. Accessibility、键盘与本地触屏

最低目标 WCAG 2.2 AA。每个新页面验收：

- 完整键盘路径；focus 可见且不被 sticky header 遮挡；
- sidebar/nav 使用 `<nav>` 与可读 `aria-label`；active link 使用 `aria-current="page"`；
- dialog 有标题、描述、初始 focus、focus trap、Escape 规则和关闭后 focus return；
- table header、field label、error relationship 和 live region 语义完整；
- 状态不只依赖颜色、位置或动画；
- 文本与背景、控件边界达到 AA 对比；accent 上使用 `accent-foreground`；
- 200% zoom、320 px 宽度不丢失内容或操作；
- 屏幕阅读器能获知 mutation accepted、task progress 和 finished outcome，但轮询不每秒播报；
- copy icon、eye icon 等必须有可翻译 accessible name；纯装饰 icon `aria-hidden`；
- touch 不依赖 hover；长按不是唯一入口；软键盘打开后当前 field 和按钮仍可滚动到。

未来 rotary/硬键输入若由本地产品选定，必须映射到同一 focus 顺序和 activate/back 语义，不另建不可
测试的导航状态机。

## 12. 国际化与文案

### 12.1 目标

当前内置 UI 已交付 English + 简体中文。所有前端拥有的可见文字、accessible name、确认文本、日期与
运行时长必须进入 message catalog；新页面不得新增裸产品字符串。

当前目录：

```text
src/i18n/
├── i18n.ts                   # i18next 实例、异步初始化、持久化与 document 同步
├── locale.ts                 # en/zh-CN 检测和归一化
├── resources.ts              # English fallback 与 catalog shape
├── zh-cn.ts                  # 与 English 同 shape 的简体中文 catalog
├── load.ts                   # 静态 locale loader map；中文动态 import
└── format.ts                 # 已知状态的本地化，未知值原样保留
```

运行时采用 `i18next` + `react-i18next`。English 编译进入初始 entry 并始终作为 fallback；简体中文由静态
动态 import 生成内容哈希 chunk，只在初始检测选择中文或用户切换语言时加载。初始语言为中文时，React 在
catalog 加载完成后再 mount，避免首帧闪现英文；加载失败则保持可用的 English fallback。不得改为运行时
locale JSON、远程 endpoint 或 CDN。English 与简体中文 key shape 由类型和测试保持一致。

默认语言优先 `mos.ui.locale` 中的用户明确选择，其次浏览器语言，最后 English；所有中文浏览器变体归一为
`zh-CN`。语言偏好是浏览器本地状态，只有后端明确提供共享偏好后才变成设备级设置。

### 12.2 文案规则

- 标签简短稳定，说明句讲“结果/风险”，不复述字段名。
- 使用真实动词：Add、Forget、Revoke、Rotate、Reboot；避免 OK/Submit。
- “Offline” 只用于管理面不可达；单个 observer 失败使用 “Live state unavailable”。
- “Saved” 表示 Configured 已确认；“Applied” 表示 task 成功；“Online/Running” 必须来自 Observed。
- interface name、SSID、hostname、error code、版本、地址和密钥不翻译。
- 时间、数值和复数使用 locale formatter；字节采用一致 IEC/SI 选择，本文建议容量使用 IEC（KiB/GiB）。
- 对一次性秘密使用明确句子：“This token is shown once. Save it now.” / “此 token 仅显示一次，请立即保存。”
- 不使用“安全”“健康”绝对词，除非数据契约证明；优先写“签名已验证”“mosd 可达”等可验证事实。

## 13. API 集成规范

### 13.1 Transport

- 所有路径使用 root-relative `/api/...`，同源 credentials；不从构建时写死设备 host。
- transport 只负责 JSON、空 body、CSRF、error envelope、timeout/cancel 等通用逻辑。
- mutation 自动添加当前 session CSRF；GET 不添加；token automation 不经过 SPA transport。
- AbortSignal 从 TanStack Query 传入 fetch，页面卸载或新查询时取消可取消 read。
- 不对 mutation 做通用自动重试；504/断线后先读取资源或 task，确认结果再决定。
- 503 的 `Retry-After` 进入 error metadata，供 QueryBoundary/登录倒计时使用。

### 13.2 Query key 与失效

使用领域 key factory，避免散落字符串：

```ts
const networkKeys = {
  all: ['network'] as const,
  overview: () => [...networkKeys.all, 'overview'] as const,
  peers: (iface: string) => [...networkKeys.all, 'peers', iface] as const,
}
```

- 改单接口后 invalidate network overview 和该接口相关 peer；
- 添加/删除 Wi-Fi 后 invalidate known networks，不假装 association 已变化；
- settings task 成功后 invalidate setting、对应 state、tasks；
- logout 清除所有设备数据 cache，防止下一 session 看到前一用户内容；
- 一次性 token 不进入 query cache。

### 13.3 Schema 与秘密

- OpenAPI 是 HTTP 契约事实。TypeScript 类型必须从它生成或有自动测试证明同步；手写类型漂移视为缺陷。
- 未知字段默认忽略以保持前向兼容；未知 enum 显示原值/Unsupported，而不是崩溃。
- secret redaction sentinel 在 model 层建模为 `saved: true`，不在 input 中传播原字符串。
- console log、query devtools、error report、toast 和剪贴板不能输出 password/PSK/token/private key。
- 任何 debug/raw JSON 面板先做递归脱敏，不能假设后端已经覆盖所有未来字段。

### 13.4 Capability discovery

当前 `/api/versions` 只列 API major，不是完整 feature map。短期使用以下规则：

1. 对本文标为 S/A 的 v1 endpoint 按当前 contract 实现；
2. 对 P 页面保持未注册路由或不加入 navigation；
3. 每个计划后端在开放 UI 前增加明确 capability/status 契约，或通过一个稳定版本的资源存在性声明；
4. 不能通过先发请求、收到 500/503 后隐藏页面；明确 404/unsupported reason 才能表示 absence。

## 14. 完整 API—UI 映射

以下清单覆盖当前生成 OpenAPI 的全部路由，足以让 UI 开发判断绑定范围。

| Method + path | 页面/用途 | UI 状态 | 关键说明 |
|---|---|---:|---|
| `GET /api/versions` | 启动兼容性/支持详情 | A | 无需登录；不是 feature map |
| `GET /api/v1/session` | Root session gate | S | setup/unauthenticated/authenticated + CSRF |
| `POST /api/v1/session` | Login | S | 201；可能 401/409/422/429 |
| `DELETE /api/v1/session` | Logout | S | 204 |
| `POST /api/v1/setup` | First-run setup | S | 201；token 只显示一次 |
| `GET /api/v1/health` | Overview/global connection | S | apid 与 mosd 分开；checkedAt 是 uptime |
| `GET /api/v1/meta` | Overview/support detail | S | API、schema、daemon，不是系统 release |
| `GET /api/v1/network` | Network/Overview | S | configured + observed；observer 可显式失败 |
| `PUT /api/v1/network` | 跨接口原子高级编辑 | A | 204；整体替换，慎用 |
| `PUT /api/v1/network/{iface}` | Interface create/replace | A | 204；按整树校验 |
| `DELETE /api/v1/network/{iface}` | Interface remove | A | 204；依赖可能 422 |
| `GET /api/v1/network/{iface}/peers` | WireGuard peers | A | iface 必须是 WG tunnel |
| `POST /api/v1/network/{iface}/peers` | Add peer | A | 201；重复可 409 |
| `DELETE /api/v1/network/{iface}/peers/{publicKey}` | Remove peer | A | publicKey 必须 URL encode |
| `POST /api/v1/actions/wireguard/{iface}/rotate-key` | Rotate WG key | A | 200；只返回 public half |
| `GET /api/v1/wifi/client/networks` | Known Wi-Fi list | A | PSK 读取为 `<redacted>` |
| `POST /api/v1/wifi/client/networks` | Add known Wi-Fi | A | 201；不能回写 sentinel |
| `DELETE /api/v1/wifi/client/networks/{ssid}` | Forget Wi-Fi | A | SSID 必须 URL encode |
| `GET /api/v1/settings/{path}` | Services/Access/System settings | S | 只读可访问 schema 中的有效路径 |
| `PUT /api/v1/settings/{path}` | 四个 scalar settings | S | 202 TaskAccepted；写入白名单仅四项 |
| `GET /api/v1/state/{path}` | live reconciler state | S/局部 | 只读；不要生成通用 debug UI |
| `GET /api/v1/tasks` | Overview/Activity | S | 本次启动、有界、oldest first |
| `GET /api/v1/tasks/{id}` | TaskProgress | S | 每秒直到 finished |
| `GET /api/v1/tokens` | Access tokens | S | 不返回 token 明文 |
| `POST /api/v1/tokens` | Mint token | S | 201；明文只在响应出现一次 |
| `DELETE /api/v1/tokens/{id}` | Revoke token | S | 204 |
| `GET /api/v1/ssh/authorized-keys` | SSH key list | S | 每个 key 授予 root |
| `POST /api/v1/ssh/authorized-keys` | Add SSH key | S | 201；fingerprint 以服务端为准 |
| `DELETE /api/v1/ssh/authorized-keys/{fingerprint}` | Remove SSH key | S | 204；fingerprint URL encode |
| `POST /api/v1/actions/change-password` | Web admin password | S | 204 |
| `POST /api/v1/actions/transient-root-password` | 临时 root 密码 | S | 202 TaskAccepted；到重启失效 |
| `POST /api/v1/actions/reboot` | Reboot | S | 202；随后会断开 |
| `POST /api/v1/actions/poweroff` | Power off | S | 202；不承诺自动恢复 |
| `GET /api/v1/ui` | UI mode/紧凑候选摘要 | S | builtIn/custom + unavailable reason |
| `GET /api/v1/ui/bundles` | 全部保留 UI 版本 | S | generation、清单、摘要、兼容/active 状态 |
| `POST /api/v1/ui/bundles` | 上传并安装 UI ZIP | S | raw `application/zip`；201；不自动激活 |
| `PUT /api/v1/ui/active` | 精确激活自定义 UI | S | JSON `{ "generation": N }`；重新校验后 200 |
| `DELETE /api/v1/ui/active` | Return to built-in UI | S | 200；`/_ui/` 始终可用 |
| `DELETE /api/v1/ui/bundles/{generation}` | 删除 inactive 版本 | S | 204；active 返回 409 |

泛型 settings 页面是明确禁止项。当前 generic PUT 只写 hostname、SSH enabled、container enabled、
MQTT enabled；Network/Wi-Fi/SSH key/token/UI/power 等必须走各自 typed route。

以下是 PLAN-056 的 **计划契约**，不属于当前生成 OpenAPI。在 `mos-appd`、mosd adapter、安全门禁和
OpenAPI 同时实现前，前端不得调用、mock 成生产数据或探测式猜测这些路径。

| Method + planned path | 页面/用途 | 关键约束 |
|---|---|---|
| `GET /api/v1/apps/capabilities` | 路由与 kind gate | 返回 manager/catalog/OCI/native/local-import 能力和 unavailable reason |
| `GET /api/v1/apps` | Installed | 统一返回 System/Catalog/Local/External inventory 和 desired/runtime/health |
| `GET /api/v1/apps/{appId}` | Detail | manifest 摘要、active revision、权限、storage、allowed actions |
| `GET /api/v1/app-catalog` | Catalog | cursor/filter；每项带缓存新鲜度、兼容结论和签名身份 |
| `GET /api/v1/app-catalog/{appId}` | Catalog detail | 精确 version/digest、release notes、权限和空间摘要 |
| `POST /api/v1/app-catalog/{appId}/preflight` | Install/Update review | 无副作用；返回 conflict、permission delta、reservation、rollback 能力 |
| `POST /api/v1/apps` | Install | 只接受 catalog id + exact version/digest + preflight token；返回 202 task |
| `POST /api/v1/apps/{appId}/actions/start` | Start | 返回 202；blocked reason 使用结构化 error |
| `POST /api/v1/apps/{appId}/actions/stop` | Stop | 返回 202；幂等结果由后端定义，UI 不重复提交 |
| `POST /api/v1/apps/{appId}/actions/restart` | Restart | 返回 202；只在 allowed actions 中出现 |
| `POST /api/v1/apps/{appId}/actions/update` | Update | exact target revision + fresh preflight token；返回 202 |
| `POST /api/v1/apps/{appId}/actions/rollback` | Rollback | 仅对服务端声明 eligible 的 last-known-good revision |
| `PATCH /api/v1/apps/{appId}/configuration` | Typed config | 只接受 manifest schema 字段；不得接受 env/command/host path |
| `PUT /api/v1/apps/{appId}/secrets/{name}` | Secret replace | write-only；响应不返回明文；返回 202 |
| `GET /api/v1/apps/{appId}/logs` | Logs | 必须有 since/cursor/limit 与服务端大小上限，默认脱敏 |
| `GET /api/v1/apps/{appId}/versions` | Versions | current/last-known-good/available/compatibility |
| `GET /api/v1/apps/activity` | Activity | 有界 task/audit projection；不等同永久日志 |
| `DELETE /api/v1/apps/{appId}?retainData=true` | Remove | 默认且推荐保留数据；System/External 返回 409/不允许 |
| `POST /api/v1/apps/{appId}/actions/purge-data` | Irreversible purge | 需要服务端 challenge；与 Remove 分开 |

所有 `appId` 都是 manifest 中稳定、经过规范化的标识，不是 systemd unit 名或 image ref。API 不接受原始
unit、任意 shell command、不带 digest 的 image tag、绝对 host path 或由浏览器提交的信任结论。

## 15. 测试与验收

### 15.1 每个页面的测试矩阵

每个新 query 页面至少覆盖：initial loading、data、empty、refresh with cache、error with cache、error without
data、401 session expiry、unsupported（如适用）。每个 mutation 至少覆盖：client validation、pending 防重复、
success、422 field path、409 conflict、503/504 unknown result、cache invalidation。

高风险专项：

- Setup/token mint：一次性秘密不会进入 cache，关闭后消失；
- Wi-Fi：`<redacted>` 永不回写，各 PSK 边界；
- WireGuard：包含 `/` 的 public key URL 编码，private key 不出现在任何 fixture snapshot；
- Network：configured/observed 相互独立，observer error 不清空配置；
- Settings：202 task 的 queued/running/succeeded/failed；
- Power：确认、202 后全页状态、session 恢复；
- Logout：跨 session cache 清空；
- i18n：English/zh-CN 不出现 raw key，长中文/英文不截断操作；
- accessibility：keyboard、focus return、live region 限流、axe 等价检查。

### 15.2 测试层级

| 层 | 内容 |
|---|---|
| Pure unit | validation、format、redaction、query keys、network view model |
| Component | 所有状态分支、表单、dialog、TaskProgress |
| Route integration | session gate、route params、query invalidation、API fixture |
| Browser smoke | setup/login、service toggle、token one-time、logout、navigation、responsive |
| Backend contract | OpenAPI 与 binary 输出一致；UI fixture 可被当前 schema 解析 |
| Asset delivery | `/_ui` VFS 全树、路由域隔离、fallback、CSP、MIME、缓存、敌意路径 404、ignored dist/build-entry contract |

测试数据不得使用真实 token、Wi-Fi 或设备密钥。错误 fixture 要覆盖 `code/message/source/path`，不要只 mock
HTTP status。

### 15.3 Definition of Done

一个 UI slice 只有同时满足以下条件才完成：

- 对应成熟度是 S 或 A，或它依赖的计划/API 已正式获批和落地；
- 页面所有 query/mutation 状态有实现和测试；
- Configured/Applied/Observed 标签与数据源正确；
- 320 px、860 px、桌面和 200% zoom 人工验收；
- 键盘、屏幕阅读器名称、focus 和对比通过；
- English/zh-CN 文案完整，无 hard-coded 产品字符串；
- 秘密、错误和 debug detail 通过脱敏测试；
- lint、typecheck、tests、coverage 和 `run.sh` 通过；
- `dist/` 未被 Git 跟踪，标准构建入口可从当前源代码生成它，gzip 变化已记录；
- 用户文档/帮助链接只指向真实存在且版本匹配的内容；
- 本指南中的页面状态或 API 映射如有变化，在同一变更中更新。

## 16. 分阶段开发顺序

阶段编号表示 UI 依赖关系，不自动批准对应后端计划。

### Phase 0 — 固化现有产品表面

- 建立 message catalog（English/zh-CN）并迁移当前硬编码字符串；
- 增加 QueryBoundary、PageHeader、SettingsRow、ConfirmAction、SensitiveReveal、Freshness；
- 用结构化 network detail 替代正常路径 raw JSON；
- 为启动、session、当前五页补全错误/empty/stale 状态；
- 替换 `window.confirm`；将触控目标提升到 44 px；
- 建立 API fixture 和 route integration 测试，提高关键 workflow coverage；
- 记录/解决本地 Vite 到真实 apid 的开发连接方式。

### Phase 1 — 完成已经 API 就绪的网络管理

1. interface detail/edit（先 physical/static/DHCP）；
2. VLAN/Bridge 关系表单和依赖错误；
3. known Wi-Fi 管理；
4. WireGuard peer 管理；
5. WireGuard key rotation 和失联警告；
6. 跨接口整体编辑仅在确有产品用例后增加。

每一步可独立交付，并保持只读 Network 总览可用。

### Phase 2 — 精选 OCI Applications

等待 PLAN-056 的 manager、签名准入、manifest、资源 ceiling、secret store、storage reservation、health gate
和 typed API 实现后，按以下顺序交付：

1. 只读 inventory（包含 System 与 External/unmanaged 的清楚边界）；
2. curated catalog 与 compatibility/preflight；
3. OCI install/start/stop/restart/remove（默认 retain data）；
4. update、last-known-good rollback、bounded logs 和 Activity；
5. local trusted import 仍保持关闭，直到 developer key enrollment 与撤销流程另行批准。

Applications 不能只做卡片和 Install 动画；没有准入、任务恢复和启动时重验就不开放导航。

### Phase 3 — 设备身份与诊断

等待 PLAN-043/052 获批并提供聚合 API 后：System Information、observed network 深化、diagnostic snapshot、
redacted support bundle。先只读，再增加导出。

### Phase 4 — 时间与更新

等待 PLAN-044/047 的状态和 action API。Time 可以独立交付；Update 必须一次实现完整错误/rollback/reboot
状态机，不能只做“Install”按钮。

### Phase 5 — Native Applications、存储与恢复

Managed native app 只有非 root identity、systemd sandbox profile、声明式 unit 生成器、OS rollback
compatibility 和数据迁移策略通过安全验收后才开放。随后再交付 PLAN-049/048 的存储与恢复：Storage 先只读
健康，破坏性 action 最后；Recovery 需要单独安全评审和真实设备验收。

### Conditional — 安装生命周期、本地显示、fleet

PLAN-046 的 onboarding 可能重构 Setup；本地显示需要板卡 capability 和 kiosk 验收；fleet 必须先有产品
决策和设备主动连接架构。这些不阻塞 Phase 0/1，也不在当前 shell 留占位菜单。

## 17. 明确不做

- 不复制 Venus 的代码、assets、文案、视觉品牌或能源领域页面；
- 不用 settings schema 自动生成一个“能改所有字段”的万能控制台；
- 不从 desired settings 推断 live health；
- 不让 UI 直连 D-Bus、systemd、shell 或设备文件；
- 不显示 Wi-Fi 扫描、连接、AP mode 开关等当前 API 不具备的动作；
- 不把 update、recovery、storage、fleet 的模拟状态描述为真实设备状态；开发期原型必须页底标注，生产期按 capability 屏蔽；
- 不把 Services 做成 Docker/应用 marketplace；Applications 是独立、带信任边界的模块；
- 不把精选目录宣称为公开市场，不接受未签名 artifact、不带 digest 的 image、任意 unit/script 或 host path；
- 不因应用签名通过就宣称其“安全”，也不在当前 rootful runtime 上宣称 hostile multi-tenant isolation；
- 不提供真实通用 partition editor、文件管理器、root 终端或默认 packet capture；开发期 Terminal 仅可使用无网络访问的模拟层；
- 不把 console shell 的 inert setting 暴露给用户；
- 不持久化浏览器 CSRF、一次性 token 或设备秘密；
- 不依赖 CDN、remote font、第三方运行时或在线图标；
- 不关闭现有 Vite 路由/locale code splitting 或恢复固定文件名；不得让懒加载资源脱离内置 VFS；
- 不用 toast 作为一次性秘密、高风险动作或唯一错误的唯一载体；
- 不用接口配置成功、task succeeded 或绿色图标冒充端到端连通性。

## 18. Venus 研究如何影响本指南

`venus-gui-v2.md` 只提供模式参考。本指南采用：

- 本地/远程复用一个 UI 与数据模型；
- 显式连接状态、数据陈旧和 configured/observed 区分；
- 高频操作靠近状态，不把所有操作藏入深层 settings；
- settings row、device row、unsupported fallback 的一致词汇；
- toast 与持久通知分离；
- 按 screen class 调整几何、触控与导航；
- 为 i18n、access level、read-only 和扩展点预留明确契约。

本指南没有采用 Venus 的能源领域导航、设备模型、源码、assets 或原文产品字符串。mos 的六区 IA、
单管理员模型、API 边界、嵌入构建和路线图均由 mos 自身事实决定。

## 19. 交付检查清单

UI 开发在提交前逐项确认：

- [ ] S/A 功能使用真实 typed API；P 功能只使用隔离模拟层、页底标注且可在生产构建按 capability 屏蔽；
- [ ] 使用 typed endpoint，没有绕过为 generic settings；
- [ ] 能指出每个状态来自 Configured、Applied 还是 Observed；
- [ ] loading、empty、stale、degraded、offline、error 均有设计；
- [ ] 401/403/409/422/429/503/504 中适用的分支已测试；
- [ ] mutation 不通用自动重试，结果未知时先读取；
- [ ] 一次性秘密不会进入 cache/log/toast；redacted sentinel 不回写；
- [ ] 危险动作展示 target、影响和恢复方式；
- [ ] Applications 同时显示 kind、trust、desired/runtime/health、精确 version/digest 和 allowed action；
- [ ] 安装/更新使用服务端 preflight，权限 delta、空间、冲突、健康闸和回滚限制已验收；
- [ ] Remove 默认保留数据，Purge 是独立 challenge；原始 unit/command/host path 永不进入 API；
- [ ] 所有控件可键盘使用，触控目标至少 44 px；
- [ ] 320 px 和 200% zoom 不丢失任务；
- [ ] English/zh-CN 文案和 accessible name 完整；
- [ ] 不含外部 runtime dependency，CSP 下可运行；
- [ ] `dist` 完整树可递归嵌入，`index.html` 及其引用资源可访问，哈希资源缓存规则正确；
- [ ] `/`、`/_ui`、`/api` 的资源、miss、SPA fallback 和敌意路径不会跨所有权域；
- [ ] lint/typecheck/test/coverage/`run.sh` 通过；
- [ ] `dist/` 未被 Git 跟踪，标准构建入口可从当前源代码生成它，bundle delta 已记录；
- [ ] 本文、OpenAPI 和实现没有互相冲突。

## 20. 追溯位置

本文已包含开发所需信息。需要核对事实时，使用以下仓库产物：

- 当前 SPA：`pkgs/mosd/apid/ui/`
- HTTP 契约：`pkgs/mosd/apid/openapi.json`
- 内置资产服务与 CSP：`pkgs/mosd/apid/src/assets/builtin.rs`
- 内置资产清单生成：`pkgs/mosd/apid/build.rs`
- API 与 replaceable UI 设计：`docs/design/api.md`
- 管理面和 settings/reconciler：`docs/design/mosd.md`
- 当前 dashboard 设计记录：`docs/design/dashboard.md`
- 本地显示架构：`docs/design/display.md`
- 访问与 root 权限：`docs/design/access.md`
- 外部比较研究：`docs/research/venus-gui-v2.md`
- Applications 权威设计：`docs/design/applications.md`
- 面向设计师的产品/原型指南：`docs/zh/design/built-in-ui-design.md`
- 未完成路线图：`docs/plan/` 目录下的未完成计划

当这些产物变化时，优先更新实现和 OpenAPI，再同步本指南的成熟度、页面状态与 API 表；不要只改
高保真设计稿或脱离仓库的临时说明。
