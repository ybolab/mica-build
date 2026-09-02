# apid：API 优先的管理守护进程与可替换界面

> [English](../../design/api.md) | 中文
>
> 英文版 4,500 余行，逐节标注了「已实现 / 已提案」。本文是中文概览。
> **接口的权威规格是 `pkgs/mosd/apid/openapi.json`**，不是任何一份散文。

## 0. 怎么读这份文档

每一节都带 **[已实现]** 或 **[已提案]** 标记。这套纪律的理由与
[access.md](access.md) 第 0 节相同：**一个只以文字形式存在的机制，没有任何东西会发现它不在。**

## 1. 今天的表面 —— [已实现]

apid 是一个 Rust crate，终结 TLS、认证运维、并通过 D-Bus 调用 mosd 来读写设备状态。
**它不持有系统状态的真相。** 唯一新增的内存状态是由 `TaskChanged` 信号喂入的任务镜像；
订阅不再可证明存活时，它不会提供内存副本，而会回退到 `GetTask`。

**API 就是认证边界。** `/_ui/` 始终提供编译进 `apid` 的 React SPA；`/` 在有效自定义 UI
存在时提供它，否则跳转到 `/_ui/`。静态代码本身不需要认证，所有设备数据、写入、认证操作和动作
都位于 `/api`。`/healthz` 只回答监听器是否存活。

**声明顺序就是优先级规则。** 路由与嵌套按声明顺序匹配，静态资源服务是 `.fallback`。
因此**一个在 `api/v1/settings` 位置携带文件的 bundle 无法劫持 API 流量**——
路由器对一个已经匹配上的路径根本不会去查兜底。这条规则由派发机制强制，
而不是靠某个人记得去写一个检查。

**路由清单不在文档里复述。** `/api` 下的表面由 `openapi.json` 规定，
CI 保证它等于实际发布的二进制所打印的内容，并对基线分支做破坏性变更比对。
**一份散文路由表是会漂移的第二份副本；schema 是那份不会漂移的。**

## 2. API 表面

### 2.1 版本与路径形状

### 2.2 资源模型 —— 四个根，执行记录不属于设置、实时状态或动作

设置树、实时状态树、动作、应用任务。四者语义不同，不应被压进同一个根。

设置写入现在把“持久化”和“应用”拆成两个生命周期：`SetSettings` 校验并原子保存，
把按 dot-path 限定范围的协调工作放入单 worker 队列，然后立即返回任务 id。待执行任务按
子树包含关系折叠，因此两次快速的相同提交只运行一次，并在 `foldedCount` 中留下记录。
`PUT /api/v1/settings/{path}` 与临时 root 口令动作返回 **202** 和
`{"taskId":"..."}`；`GET /api/v1/tasks` 与 `GET /api/v1/tasks/{id}`
读取有界任务历史。返回 202 只承诺“已经持久化并排队”，不再承诺“已经应用”。

apid 用独立连接订阅 `TaskChanged`。记录为 queued/running 时，零 JavaScript 的 SSH
页面通过 `<meta http-equiv="refresh">` 刷新；succeeded、failed、interrupted 或历史中已无
此 id 时停止。mosd 重启后，直接 `GetTask` 确认旧 running 记录已不存在，apid 将它终结为
`interrupted`，不会让页面无限刷新。

四者都通过 `com.mos.mosd1` 管理接口到达 mosd。重启和关机分别调用专用的
`Reboot`、`PowerOff` 方法；APID 不声明 `com.mos.Item1` 代理，也不通过 MQTT
读写系统功能。应用 Item1 可以使用直接的 `com.mos.<class>[.<suffix>]` 名称，但只有
应用包按准确服务名登记后才进入 MQTT 数据面；`com.mos.mosd` 不具备 MQTT 权限。

### 2.3 操作清单 —— 已被已发布的 schema 取代

这一小节曾经是一张「每条服务端表单对应哪条 API 路由」的清单，
写的时候接口面只有四条 `GET`，所以每一格「API 等价物」点的都是不存在的路由。
**树的现状已经不是这样了**：`openapi.json` 规定了 23 条路径。

schema 不承载、因而本文保留的，是**表面为什么长这样**：

- **动作不是资源。** 三个操作是动词，没有状态可 `GET`，也没有幂等性可承诺：
  `reboot`、`poweroff`、`transient-root-password`。它们位于 `/api/v1/actions/<verb>`，
  **只接受 `POST`**，而这个命名空间之所以叫 `actions`，正是为了让没有读者期待 `GET` 在那里能用。
  这与 HTML 路由器里已经做出的决定一致：那里对两个电源动作和所有 SSH 变更操作都**不存在
  `GET` 处理器**，好让浏览器预取、爬虫或误点的链接**无法把这台一体机关机**。
- **UI 上传使用有界 raw ZIP。** `POST /api/v1/ui/bundles` 接收
  `Content-Type: application/zip`，浏览器 session 还必须携带 CSRF；bearer token 沿用自动化认证。
  ZIP 必须有 schema 1 `mos-ui.json` 和根 `index.html`，服务端流式写入 `/mos/ui` 的私有 staging，
  在阻塞线程中做路径、类型、大小、展开比、清单、摘要和 API 兼容校验，再原子安装。
- **安装与选择分离。** 上传成功返回 201，但不会改变 `/`。`GET /api/v1/ui/bundles` 列出所有版本；
  `PUT /api/v1/ui/active` 接受 `{ "generation": N }` 精确选择；删除只允许 inactive generation。
  系统不自动清理旧版本，达到 32 个版本或 128 MiB 余量边界时显式拒绝。
- **一处刻意的行为变更**：用一个匹配不到任何东西的标识符删除 SSH 密钥，
  在 HTML 路径上回 **422**。对集合资源的 `DELETE` 而言那是 **404**——被指名的条目不存在——
  所以 **API 用 404**。HTML 路径不因本文而改变。

### 2.4 错误形状

统一信封：`error` 下的 `code`（稳定机器令牌，**开集**）、`message`（给人看的，**不要拿来匹配**）、
`source`（`"apid"` 或 `"mosd"`）、可选的 `path`。

**分类被翻译，消息不被翻译**——mosd 的消息原样透传，而始终说明它来自哪一侧。
所有 apid→mosd 调用都有五秒上界：连接/调用失败是带 `Retry-After` 的
`mosd_unreachable`（503）；越过时间上界是无 `Retry-After` 的 `mosd_timeout`（504），
消息明确说明写操作可能仍在运行。未知任务 id 是 `task_not_found`（404）。

## 3. 浏览器与程序化客户端认证 —— [已实现]

程序化客户端继续使用可撤销 bearer token。内建或自定义 SPA 使用签名的 HttpOnly 会话 cookie：
`GET /api/v1/session` 查询初始化/登录状态，`POST` 登录，`DELETE` 登出。浏览器会话发起
`POST`、`PUT`、`PATCH` 或 `DELETE` 时还必须提供该会话随机生成的 `X-CSRF-Token`；
bearer 客户端不需要 CSRF。初始化接口在返回一次性 bearer token 的同时建立同样的浏览器会话。

## 4. 静态托管 —— [已实现]

`/_ui` 及其资源树只能提供内建 SPA，自定义 bundle 无法遮蔽它。有效自定义 UI 占据 `/`，
没有时 `/` 跳到 `/_ui/`。其余 GET/HEAD 才进入自定义资源与自定义 SPA 兜底；`/api` 的
JSON 404/405 永远先匹配。内建资源来自 verity 覆盖的二进制，不依赖 `/mos/ui`。

## 5. 自定义界面放在哪

它**不能放在根文件系统里**（根是只读且被签名的）。规范位置是 `/mos/ui`，其后端为
DATA 上的 `/mnt/data/mos/ui`。DATA 只直接挂载到内部路径 `/mnt/data`；`/mnt/data/mos`
绑定到系统专用的 `/mos`，`/mnt/data/srv` 绑定到用户专用的 `/srv`。开发阶段不保留
迁移链接或兼容布局。包保存在 `bundles/<generation>/`，`current` 只指向活动 generation，
上传 staging 永不对外服务。

## 6. 安全要求：内建界面与恢复路径 —— [已实现]

**`/_ui` 是永久保留前缀**，无论 bundle 处于什么状态都可达；`/ui` 归自定义 UI 使用。停用自定义 UI 走
`DELETE /api/v1/ui/active`，不删除已安装文件。旧 `/builtin` 和所有服务端表单路由已经移除。

## 7. 信任：谁可以安装界面 —— [已实现]

只有通过现有管理员 session+CSRF 或 bearer token 的请求可以上传。UI 包不签名；当前信任主体是本机
管理员。界面明确提示自定义 UI 是同源管理客户端，可以代表管理员调用 API。RAUC 系统更新的签名策略
与 UI 包完全分离，不存在“忽略签名继续安装”的共用路径。

## 8. 迁移与分期 —— [已提案]

## 9. API 优先排除了什么 —— [已提案]
