# mos 内置 UI 设计指南

> 文档版本：1.1
> 基线日期：2026-09-02
> 读者：产品设计师、UI/UX 设计师、交互原型设计师、产品负责人
> 交付形式：单一 Markdown 设计源
> 范围：远程浏览器中的设备管理界面，以及未来复用同一界面的本地触屏/kiosk

本文定义 mos 内置 UI 应该成为怎样的产品：有哪些功能、如何组织、关键任务怎样完成、每个页面需要
覆盖哪些状态、原型如何表达当前与未来能力。本文不是开发说明，不要求设计师理解代码、接口、构建或
设备内部实现。

设计工作可以覆盖尚未实现的功能，并应当提前完成关键流程与异常状态。进入开发时，再按照目标设备
实际具备的 capability 隐藏未交付入口和动作。**设计完整度与软件交付状态是两条独立轴线。**

---

## 1. 设计目标

mos 是一台可长期无人值守的边缘设备。内置 UI 的首要任务不是展示尽可能多的数据，而是帮助一个对
设备负责的管理员可靠地完成以下事情：

1. 看懂设备现在是否可用、信息是否新鲜、哪些部分正在降级；
2. 建立和恢复网络连接，区分“保存了什么”和“设备当前看到什么”；
3. 管理 mos 自身服务与安装在本机的应用；
4. 管理 Web、API 和维护访问，不意外泄露秘密或授予 root 权限；
5. 识别版本、安装更新、等待验证，并在失败时知道能否回滚；
6. 看懂存储、时间、硬件和运行状态，生成可安全分享的支持材料；
7. 在忘记凭据、系统无法启动或数据异常时，从低风险恢复逐步走向不可逆操作；
8. 在桌面浏览器和本地触屏上使用同一套概念，不学习两套产品。

界面应当让用户感到这是一台边界清楚、诚实报告状态的设备，而不是一个把 systemd、容器或配置文件
原样暴露出来的通用 Linux 控制台。

## 2. 设计原则

### 2.1 状态必须可证明

- “已保存”只表示期望值已记录；
- “已应用”只表示一次执行成功；
- “运行中/在线/健康”必须来自当前观测；
- “签名已验证”“时钟已同步”“更新已通过启动验证”比笼统的“安全”“正常”更可信；
- 信息过期、局部探测失败和整台设备离线必须是不同状态。

### 2.2 风险越高，后果越靠前

改变网络、轮换 WireGuard key、开放 root 访问、更新、回滚、重置和清除应用数据，都要在确认之前展示
目标、影响、可能失联、保留内容和恢复路径。危险操作不能藏在普通 toast 里，也不能只靠红色表达。

### 2.3 一个概念只放在一个产品区域

- Services 管 mos 自身的全局运行能力；
- Applications 管第三方/附加应用的身份、版本、权限、数据和生命周期；
- Access 管进入设备的凭据与维护通道；
- System 管设备本身的身份、时间、更新、存储、诊断和恢复。

相同底层技术不等于相同产品概念。例如 Container runtime 是 Services 的系统开关，具体 OCI 应用则在
Applications 管理。

### 2.4 先设计完整任务，再裁剪交付

设计稿和原型可以完整表现规划中的页面、错误和恢复分支。交给开发时，每个 frame 都带成熟度与依赖；
运行中的产品只显示真实可用能力。不要为了匹配当前开发进度把未来流程拆成互不兼容的临时页面。

### 2.5 本地与远程共用产品语义

同一路由、信息模型、权限和文案在远程浏览器与本地 kiosk 中保持一致；只因屏幕宽度、触控、软键盘和
物理在场性调整排布。不得让本地界面绕过远程界面的确认和安全边界。

## 3. 功能成熟度与设计标记

成熟度标记用于设计文件、原型目录和评审说明，不一定作为面向用户的 badge 出现在产品中。

| 标记 | 名称 | 含义 | 设计要求 | 进入生产 UI |
|---|---|---|---|---|
| **L** | 已上线 | 当前页面和动作已存在 | 完善流程、状态和一致性 | 默认可见 |
| **R** | 接口就绪 | 设备能力存在，产品界面未完成 | 可做可交付高保真设计 | capability 确认后可见 |
| **P** | 已规划 | 产品方向已定义，底层能力尚未完整交付 | 完成 IA、流程、异常和原型 | 默认隐藏，依赖落地后开放 |
| **X** | 条件/待决策 | 依赖产品、硬件、安全或运营决策 | 只做探索或概念验证 | 不进入默认导航 |
| **N** | 明确不做 | 不属于内置 UI 或风险不可接受 | 不画成可执行产品功能 | 永不显示 |

每个设计 frame 至少标注：`L/R/P/X`、目标屏幕类别、主任务、依赖能力、是否包含示例数据。成熟度变化
只需要改标记和交付说明，不应迫使整体信息架构重画。

### 3.1 功能全景

| 领域 | 功能 | 成熟度 |
|---|---|---:|
| 会话 | 首次设置、登录、登出、修改管理员密码 | L |
| 会话 | 安装后认领、工厂/离线 provisioning、凭据恢复 | P |
| Overview | 健康、设备摘要、网络摘要、运行时间、最近任务 | L |
| Overview | 更新提醒、存储告警、通知历史、支持入口 | P |
| Network | configured/observed 总览 | L |
| Network | 物理口、VLAN、Bridge、WireGuard 配置 | R |
| Network | 已知 Wi-Fi、WireGuard peer、key rotation | R |
| Network | Wi-Fi 扫描/即时连接、热点、蜂窝管理 | X |
| Services | Container runtime、MQTT 全局开关与观测 | L |
| Applications | 清单、精选目录、安装/更新/回滚/移除 | P |
| Access | API token、SSH key/开关、临时 root 密码 | L |
| System | hostname、UI ZIP 上传/多版本选择、内置恢复、重启、关机 | L |
| System | 版本/板卡/slot/软件清单 | P |
| System | timezone、NTP 与同步状态 | P |
| System | 签名系统更新、维护窗口、验证与回滚 | P |
| System | 存储容量、健康、reservation 与数据生命周期 | P |
| System | 诊断快照、脱敏 support bundle | P |
| System | rollback、reset、wipe、物理恢复 | P |
| System | 本地显示状态与触屏体验 | X |
| Help | 版本匹配的官方文档和 context help | P |
| Fleet | 多设备 inventory、策略、批量更新、远程支持 | X，独立产品 |
| 紧急工具 | BusyBox、终端、任意文件/分区管理 | N，非正常 UI |

## 4. 产品结构与导航

### 4.1 一级结构

认证后的本地设备界面使用六个一级区域：

1. **Overview** — 设备现在怎样，是否需要处理；
2. **Network** — 如何连接，以及期望与观测是否一致；
3. **Services** — mos 自身运行能力；
4. **Applications** — 本机应用、精选目录和生命周期；
5. **Access** — 管理员、API 与维护入口；
6. **System** — 设备身份、时间、更新、存储、诊断和恢复。

Applications 的产品位置已经确定，但在 manager 和完整安全能力交付前，生产导航仍隐藏该入口。Fleet 不
作为第七个入口；如果未来成立，它是独立的多设备产品，通过 device detail 深链进入单机界面。

### 4.2 页面树

```text
Setup / Claim / Login                       会话外流程

Overview
Network
├── Interface detail
├── Known Wi-Fi
└── WireGuard tunnel / peers
Services
Applications
├── Installed
├── Catalog
├── Activity
└── Application detail
    ├── Overview
    ├── Configuration
    ├── Permissions
    ├── Logs
    └── Versions
Access
├── Web administrator
├── API tokens
├── SSH
└── Transient root password
System
├── General
├── Information
├── Time
├── Update
├── Storage
├── Diagnostics
└── Recovery
```

页面树是长期设计所有权。生产版本可以因 capability 少显示部分节点，但不能把缺失节点临时塞入其他区域。

### 4.3 导航行为

- Desktop：左侧常驻一级导航，当前区域清楚高亮；二级导航放在内容区；
- Medium：一级导航移到顶部，可横向滚动但不能截断当前入口；
- Compact：优先保证当前任务与主动作，导航可以折叠或横向滚动；
- 详情页始终能回到所属集合，并保留搜索/filter 上下文；
- 后端能力不存在时隐藏入口；已经声明支持但暂时故障时保留入口并展示错误；
- 不使用大量 disabled 菜单宣传未来功能；产品路线图不等于设备导航。

## 5. 全局 shell 与共同状态

### 5.1 页面骨架

所有管理页按同一阅读顺序组织：

1. 所属领域或 breadcrumb；
2. 页面标题与一句结果导向说明；
3. 主要动作或整体状态；
4. 页面级 offline/degraded/error banner；
5. 摘要与主工作区；
6. 最近活动、说明或支持详情。

标题不做大面积宣传 hero。设备管理界面应把空间留给状态、任务和决定。

### 5.2 全局连接状态

设计至少覆盖：

- Connected：最近读取成功；
- Reconnecting：已有缓存但当前请求失败，显示最后成功时间；
- Offline：管理面不可达，所有 mutation 停止；
- Session expired：保留当前页面目标，登录后可安全返回；
- Device rebooting：普通页面退出，显示断开、探测和恢复；
- Manager degraded：单个领域不可用，其他区域继续工作。

连接状态不能用每秒 toast 刷屏。短暂问题在页头/状态条合并显示；恢复后给一次明确反馈。

### 5.3 Configured / Applied / Observed

影响设备的页面都使用同一三层语言：

| 层 | 设计文案 | 例子 |
|---|---|---|
| Configured | Saved / 已保存 | MQTT 期望开启；接口配置了静态地址 |
| Applied | Applied / Apply failed | 一次协调任务成功或失败 |
| Observed | Running / Link down / Unknown | 服务真实 active；网口实际无 carrier |

一个开关可以显示“Enabled · not running”，而不是强行合成一种状态。用户修复问题时，优先展示三层之间的
差异和原因。

### 5.4 任务与活动

长操作使用持久 Task Progress，而不是只用 toast：queued、running、succeeded、failed、result unknown。
Task 展示动作、目标、当前阶段、可确定/不确定进度、开始时间和安全的错误信息。离开页面再回来，任务仍可
通过 Overview、Applications Activity 或对应详情继续观察。

toast 只负责短反馈，例如复制成功、非关键保存成功。错误、一次性秘密、危险后果和需继续处理的任务必须
有页面内持久位置。

### 5.5 信息新鲜度

任何 live state 都需要 freshness：刚更新、具体最后更新时间、正在刷新、已过期、来源失败。设备时钟尚未
可信时，使用“约 3 分钟前”或 device uptime 语义，不假装提供准确的日历时间。

## 6. Setup、Claim 与 Login

### 6.1 First setup `[L]`

**目标：** 在没有默认密码的设备上建立唯一管理员。

**内容与动作：** 设备身份摘要、新密码、确认密码、提交。成功后一次性展示 automation token，要求立即
保存，并明确关闭后无法再次查看。

**必须设计的状态：** 初始化检查中、尚未设置、已设置冲突、密码不合规、频率限制、提交结果未知、token
已复制、离开 token 前确认。

### 6.2 Install / onboarding / claim `[P]`

**目标：** 支持不同板卡的安装后首次启动、离线或无网络 provisioning，以及有界的设备认领。

原型至少探索：

1. 验证设备/镜像身份和当前模式；
2. 显示会被覆盖的数据与物理操作；
3. 设置设备名称、网络、timezone/NTP 和管理员；
4. 可选导入已验证 provisioning document；
5. 应用过程能在断电后安全重试；
6. 已认领设备给出清楚的拒绝和恢复路径。

不要假定有 Internet、云账号、SSH 或物理键盘。工厂注入、现场离线和浏览器认领可以共享步骤模型，但
不能强行设计成一种入口。

### 6.3 Login / logout `[L]`

Login 只需要 Password，不虚构 username、email、角色或“记住我”。设计频率限制、错误凭据、服务忙、
session 已存在和 session 过期。Logout 清除页面中的设备数据，并回到 login。

## 7. Overview

### 7.1 页面目标

Overview 回答三个问题：设备是谁、现在能否工作、最需要处理什么。它不是所有数据的缩略版。

### 7.2 当前内容 `[L]`

- 设备健康摘要：管理面与核心状态是否可读；
- identity：hostname、机器标识的安全摘要；
- network：主要接口、地址、carrier/观测异常；
- uptime；
- 最近任务及失败结果。

### 7.3 规划内容 `[P]`

- system release/board/active slot；
- 系统更新 ready/reboot-required/rolled-back；
- storage warning/critical；
- time unsynchronized；
- application degraded/update available；
- 安全或 support 生命周期提示；
- 通知/告警历史入口。

只把需要处理的异常提升到页面顶部。健康状态不能因为未知字段而显示绿色；未知、unsupported、not tested
需要各自语义。

### 7.4 关键状态

正常、首次无任务、部分数据过期、network observer 失败、核心管理面 degraded、更新进行中、需要重启、
空间不足、设备完全离线。摘要卡必须能进入问题所属页面，而不是只能看到颜色。

## 8. Network

### 8.1 Network overview `[L]`

**目标：** 同时看懂配置拓扑与实时连接。

每个接口行展示 type、configured intent、observed link/carrier、addresses 和上次观测。详情优先使用结构化
字段，不把原始数据作为正常路径。拓扑复杂时可以提供关系图，但列表仍是可访问的主表达。

### 8.2 Interface detail/edit `[R]`

覆盖 Physical、VLAN、Bridge 和 WireGuard：

- Overview：类型、父/成员关系、MAC、MTU、当前 link/address；
- Addressing：DHCP 或 static、address/prefix、gateway、DNS；
- Relationships：VLAN parent、Bridge members；
- Danger zone：删除 logical interface。

保存前给出“当前远程会话可能断开”的影响预览；保存后展示 Saved、Applying、Reconnecting、Applied but not
observed 和 Failed。跨接口依赖错误要指出相关接口，不能只显示通用失败。

### 8.3 Known Wi-Fi `[R]`

这是“已知网络”管理，不是 Wi-Fi 扫描器：列表显示 SSID、凭据已保存状态和配置属性；Add 输入 SSID 与
secret；Forget 只删除保存配置。已保存 secret 永不回显，也不能被占位字符串再次提交。

即时扫描、当前连接选择、热点/AP mode 与蜂窝管理属于 `[X]`，只有硬件和产品契约确定后才进入主原型。

### 8.4 WireGuard `[R]`

详情展示 tunnel 地址、listen port、设备 public key 和 peers。Peer 行展示 public key 指纹摘要、allowed IPs、
endpoint、keepalive；支持 Add/Remove。Rotate key 是高风险流程：明确会改变本机 public key、远端可能全部
失联，成功后只展示新的 public half 和远端更新指引，绝不出现 private key。

### 8.5 Operational network `[P]`

规划的诊断状态包括 DHCP lease、default route、DNS reachability、Wi-Fi association，以及 radio/modem 是否
unsupported。设计上把“配置不正确”“物理 link down”“有地址但 DNS 失败”区分开，并提供问题到证据的
逐层展开，不做一个模糊的 Internet 灯。

## 9. Services

### 9.1 页面目标 `[L]`

Services 管理 mos 系统级运行能力，当前是 Container runtime 与 MQTT。每一行包含名称、影响说明、期望
开关、Observed 状态和最近 task。

切换后的可见过程是：用户意图 → Applying → Applied → Observed running/stopped，或 Apply failed。开关在
任务结束前不重复提交。容器提示当前 rootful 风险与全局影响；MQTT 提示它是应用消息能力，而非网络 broker
的通用配置中心。

### 9.2 边界

- 不在这里列出每个容器或应用；
- 不提供任意 service start/stop、systemd unit 编辑或通用 settings；
- Container runtime 关闭时，Applications 中 OCI 应用统一显示 prerequisite/Blocked；
- Applications 不得为了安装一个应用而静默打开全局 runtime。

## 10. Applications `[P]`

Applications 是第六个一级区域，管理应用产品而非 unit/container。设计可以完整开展；生产入口等待应用
管理器、签名准入、资源限制、秘密和回滚能力一起交付。

### 10.1 应用来源与类型

每个应用同时显示 **来源** 和 **运行类型**：

| 来源 | 用户含义 | 可用动作 |
|---|---|---|
| System · OS verified | 随系统镜像交付 | 只读；随系统更新 |
| Catalog verified | mos 精选签名目录 | 安装、运行、更新、回滚、移除 |
| Local signer | 设备登记的可信集成商 | 与目录分开标识；入口默认关闭 |
| External · unmanaged | 发现到但不由 mos 管理 | 只读诊断，不接管 |

运行类型是 OCI 或 Native。第一阶段只交付精选 OCI。Native 后续使用声明式权限和启动描述，由系统生成
受限 unit；目录不接收任意 systemd unit 或 shell script。设计文案不能把“已签名”写成“绝对安全”。

### 10.2 Installed

**目标：** 找到应用、看懂状态、执行当前最合理的动作。

页面包括搜索、source/kind/state filter，以及 card/list view。每项显示名称、publisher、version、source、kind、
desired、runtime、health、更新时间、活动 task 和一个主动作。不要把三条状态压成一个圆点：应用可以是
“Enabled · stopped · health unknown”或“Disabled · data retained”。

空态区分：没有托管应用、只有 System app、只有 unmanaged evidence、manager 不可用、数据仍在但应用已移除。

### 10.3 Catalog

**目标：** 理解一个经过精选的应用是否适合这台设备，再决定安装。

目录 card 展示 publisher/signature 身份、version、kind、兼容结论、下载大小、持久空间、权限摘要、license/
support 和 Install/Update。目录离线时可以显示带时间的缓存，但不能把网络失败显示为“没有应用”，也不能在
缺少在线验证时继续安装。

Native 尚未开放时，条目显示明确原因和阶段，而不是普通 disabled Install。公开评分、支付、评论和任意
第三方上传不属于当前精选目录。

### 10.4 Install / Update flow

原型必须覆盖四个步骤：

1. **Compatibility** — 精确版本、publisher、artifact 摘要、设备/系统兼容、下载大小；
2. **Access & storage** — ports、network、devices、bus/topic、mount、secret、CPU/memory/PIDs/I/O、持久空间；
3. **Confirm** — 将安装/停止/改变什么，精确版本，权限 delta，数据与回滚限制；
4. **Progress** — Downloading、Verifying、Installing、Health check、Running / Rolled back / Failed。

冲突在确认前显示具体资源和占用者。不能提供“忽略并继续”。Container runtime 关闭时显示 Blocked 与
Open Services。更新并列展示 current/target version、release notes、新增权限、data migration、空间和 code/
data rollback 能力。

### 10.5 Application detail

**Overview**：identity、source/kind/trust、desired/runtime/health、current version、resource usage、storage、最近
任务和允许动作。主操作随状态变化，不同时堆叠 Start/Stop/Restart/Update/Rollback。

**Configuration**：只展示应用声明的 typed field。Secret 只显示 Configured/Missing，替换后不回显。不提供
任意环境变量、命令或 host path 输入框。

**Permissions**：按 Network、Devices、Data、Messaging、System resources 分组，对比 requested 与 granted。
权限变化作为一次新版本/preflight 处理，不直接编辑运行中 unit。

**Logs**：当前有界时间窗、时间/stream/filter、暂停滚动、复制和经过脱敏的 bounded export。清楚说明不是
永久日志，不让日志占满页面或 DATA。

**Versions**：current、last-known-good、available、compatibility 和 release notes。Rollback 只有确实 eligible
时出现，并重复说明代码回滚不一定恢复数据。

### 10.6 Start、Stop、Remove 与 Purge

- Start/Restart/Stop 都绑定任务，runtime/health 以真实观测更新；
- Remove 默认保留应用数据，说明会停止应用、删除 runtime/artifact，但保留多少数据与在哪里使用；
- 移除后保留 Data retained 记录，提供兼容版本 Reinstall；
- Purge retained data 是独立危险流程，要求名称/challenge，展示数据量和不可逆影响；
- System 与 External/unmanaged 不显示 Remove/Purge。

### 10.7 必须原型化的异常

catalog offline、container runtime off、manager degraded、signature/revocation failure、insufficient space、port/
device conflict、OS rollback 后不兼容、update health gate 失败并回滚、数据 migration 阻止 rollback、task result
unknown、remove 成功但 GC 延迟、日志被截断。

## 11. Access

Access 按从日常到高权限排列，并持续说明每种凭据能做什么。

### 11.1 Web administrator `[L]`

修改管理员密码需要 current/new/confirm。成功后清空所有密码字段，并说明当前 session 是否继续。单管理员
模型下不设计 users、roles、email、邀请或 SSO 占位。

### 11.2 API tokens `[L]`

列表显示 label/id、created 和 revoke，不回显 token。Mint 后明文只出现一次：有 Copy、已复制反馈、关闭前
确认；一旦离开，页面和历史都不能恢复。Token 当前没有自动 expiry，不画假的有效期控件。

### 11.3 SSH `[L]`

总开关与已保存 key 分开：SSH 关闭时仍可管理 key。每个 key 都清楚提示授予 root shell。Add 允许粘贴 key
并显示解析结果；fingerprint 以设备确认结果为准。Remove 显示 fingerprint/comment 和影响。

### 11.4 Transient root password `[L]`

独立高权限卡片，说明密码只到重启有效、不是 Web 密码、不会回显。设置前再次确认；成功后只显示已设置与
失效条件。

### 11.5 Credential recovery `[P]`

恢复旧 secret 永不显示；流程依赖物理在场或工厂 authority，完成后轮换凭据并留下审计结果。设计必须解释
当前设备是否支持、需要什么物理动作、哪些会话会失效，以及没有 recovery 时只能重刷的真实限制。

## 12. System

### 12.1 General `[L]`

- Hostname：Saved、Applying、Applied/Failed；
- UI selection：首页显示 built-in/custom 摘要并始终显示 `/_ui/` 恢复入口；“管理 UI 版本”进入专页；
- UI versions：上传一个 `.mos-ui.zip`、观察传输与验证阶段、查看全部保留版本、精确 Activate、Return to
  built-in、删除 inactive 版本；上传成功不自动激活，活动版本不能删除，系统不自动淘汰旧版本；
- 版本行至少表现产品名、版本、generation、兼容/验证结论和 active 状态。拒绝原因区分格式错误、重复包、
  同名版本冲突、不兼容、版本上限、空间不足和网络中断；可恢复错误后保留已选择文件；
- 自定义 UI 与设备管理 API 同源运行，上传区域必须解释其管理员权限影响，并要求只安装可信包；
- Power：Reboot、Power off 使用专用确认，显示 hostname、活动任务、会话将断开和重新上电要求。

### 12.2 Information `[P]`

只读展示 machine id（默认遮挡）、board/revision/qualification、kernel、system release、git/build identity、
installed package manifest、active/alternate slot、uptime、boot assurance 和已知硬件限制。

信息按 Identity、Software、Boot & hardware 分组；可复制 support-safe 摘要。Pass、Fail、N/A、Not tested、
Unsupported 必须分开，不能把缺失数据画成绿勾。

### 12.3 Time `[P]`

展示 local time、UTC、timezone、synchronized/synchronizing/offline/degraded、last successful sync、source 和 NTP
servers。只允许编辑 timezone 与 servers；系统持续同步，不设计 Pause NTP 或让浏览器手动调时。板卡无 RTC
时显示限制与离线启动影响。

### 12.4 Update `[P]`

完整状态机：Idle → Checking → Downloading → Ready → Installing → Reboot required → Validating → Succeeded，
失败可进入 Rolled back 或 Failed。

页面展示 current/target release、channel、兼容性、签名/验证结论、download size、空间、release notes、active
slot、maintenance window、metered/offline policy、应用 safe-to-reboot interlock。只有 Ready 才提供 Install；
Installing 期间明确不可断电；Reboot required 展示阻塞应用和有界 override；Validating 说明系统仍可能自动
回到旧 slot。

需要原型：无更新、检查失败、下载暂停/恢复、空间不足、目标不兼容、签名失败、安装中断、重启后验证、自动
rollback、offline bundle import。系统更新是整套系统，不设计单个 `.deb` 安装器。

### 12.5 Storage `[P]`

展示固定 storage tiers 和物理介质：role、size、used/free/reserved、mount/read-only/error、health、last check/
repair。可用时展示 eMMC lifetime/EOL、NVMe/SATA SMART 的归一化状态，并保留 support details；不支持必须直说。

设计 warning/critical + hysteresis，区分系统 update workspace、Applications、custom UI 和用户数据占用。
Backup/export/restore、repair、media replacement、encryption、removable media 只有契约确定后才出现。正常界面不
提供任意 repartition、format、mount 或文件浏览。

### 12.6 Diagnostics `[P]`

一个动作生成有界 diagnostic snapshot：release/board、boot/slot/reset、核心失败、storage、time、thermal/
watchdog、observed network 和 bounded journal。收集过程显示阶段、大小和取消/失败；结果展示包含范围、时间、
脱敏说明和 Download support bundle。

设计必须覆盖：敏感内容被移除、部分 probe unsupported、收集超时、空间不足、离线仍可生成、bundle 过期。
不要用“Download all logs”，也不要把 SSH 当成获取诊断的前提。

### 12.7 Recovery `[P]`

从保留数据到不可逆依次排列：

1. 重启/重新应用；
2. 选择已验证 alternate slot rollback；
3. credential recovery；
4. configuration reset；
5. application-data reset；
6. full factory reset；
7. secure wipe / physical reflash。

每项展示 eligibility、会保留/删除什么、需要 physical presence 与否、中断能否继续、完成后的下一步。Reset
不能只叫“Factory reset”而不解释 identity、calibration、STATE、DATA、META 和系统 slots 的变化。正常管理面
不可达时，给出板卡对应的物理 recovery 决策树，而不是假装 Web 仍可执行。

### 12.8 Security & lifecycle `[P/X]`

系统信息或 Security 子区可以报告可证明事实：runtime root integrity、update authenticity、boot assurance
等级、data-at-rest 状态、container policy、debug/serial policy、support/EOL、最近 manufacturing result。它是
事实报告，不是营销评分。不能把 verity、signed update、secure boot、encryption 合成一个“Secure”开关。

## 13. Help、本地显示与 Fleet

### 13.1 Context help `[P]`

每个复杂页可以进入与当前版本匹配的官方文档：安装、first run、网络、应用、update/rollback、recovery、
storage、troubleshooting、安全、release notes、API 和支持。网站或版本目标尚不存在时，不放死链接。Help
应该保留当前页面和设备版本上下文。

### 13.2 Local display `[X]`

未来 kiosk 与远程浏览器复用相同页面。设计要预先满足触控、软键盘、200% zoom、短时空闲和断网，但只有
板卡明确支持显示输出/输入且完成验收时才能声称已交付。本地物理在场可以成为 recovery 条件，不能自动
绕过管理员认证。

### 13.3 Fleet `[X · 独立产品]`

如果未来决定提供 fleet，需要另行设计 enrollment/revocation、outbound mutual auth、inventory、policy
targeting、staged update、command audit、break-glass support、roles、tenant isolation、离线容忍与数据驻留。
单机 UI 只作为设备 detail 深链，不在本地侧边栏预留 Fleet。

## 14. 关键用户旅程

设计交付至少包含以下端到端可点击旅程；不能只有彼此孤立的静态页面。

### Journey A — 新设备投入使用

识别设备与安装状态 → Setup/Claim → 管理员与一次性 token → Network → Time → Overview healthy。覆盖无
Internet、密码错误、提交结果未知、重启后继续和已认领冲突。

### Journey B — 远程修改网络

Network overview → Interface detail → 修改配置 → 失联预警 → Applying → Reconnecting → 新地址恢复，或失败后
返回旧配置/给出物理恢复。覆盖 VLAN/Bridge 依赖错误。

### Journey C — 安装目录应用

Catalog → compatibility → permissions/storage → confirm exact version → download/verify/install → health gate →
Running → Detail。覆盖 Container runtime off、signature failure、space/conflict、health failure rollback。

### Journey D — 更新应用并处理数据风险

Update available → 比较 current/target → permission/data migration delta → update task → health gate → success；或
rollback eligible / blocked。明确 code 与 data rollback 差异。

### Journey E — 系统更新

Check → release detail → download → ready → safe-to-reboot interlock → install → reboot → validating → success/
rolled back。覆盖应用阻塞、空间不足、断电和目标不兼容。

### Journey F — 支持与诊断

Overview 异常 → Diagnostics → 收集有界 snapshot → 检查隐私/脱敏 → 下载 bundle → 进入版本匹配文档。覆盖
partial/unsupported probe 和收集失败。

### Journey G — 恢复访问或系统

Login 失败/系统异常 → 从数据保留方案开始的 decision tree → physical presence/credential rotation 或 slot
rollback → 最后才是 reset/wipe/reflash。每一步都确认保留与删除内容。

## 15. 组件与交互词汇

设计库至少包含以下可复用模式。名称用于跨页面沟通，不要求绑定某个前端组件实现。

| 模式 | 用途 | 必须包含 |
|---|---|---|
| Page header | 建立任务上下文 | eyebrow/breadcrumb、标题、说明、主动作、整体状态 |
| Global status | 连接/维护 | connected/reconnecting/offline、freshness、正在重启 |
| Status summary | 一组可行动状态 | 状态、证据、更新时间、进入详情 |
| Settings row | 单项期望配置 | 名称、影响、configured、observed、控件、task |
| Resource row/card | 接口、应用、token、storage | identity、摘要状态、主动作、详情 |
| Filter/search bar | 大集合 | query、filter、result count、clear、empty distinction |
| Query boundary | 数据页状态 | loading、refresh、stale、empty、error、unsupported |
| Task progress | 长 mutation | target、阶段、进度、结果、safe next action |
| Confirm action | 有风险操作 | target、影响、保留/删除、恢复、challenge |
| Sensitive reveal | 一次性秘密 | shown once、copy、copied、close warning、立即丢弃 |
| Preflight review | 安装/更新 | compatibility、permissions、storage、conflicts、exact target |
| Activity timeline | 最近任务 | action、actor、time、phase、result、详情 |
| Log viewer | 有界日志 | window、filter、pause、truncation、redaction、export |
| Developer/support details | 次要技术证据 | 默认收起、可复制、脱敏；不是完成任务的唯一方式 |

### 15.1 Query 状态

每个集合/详情原型必须包含：initial loading、data、empty、refreshing with data、stale/degraded、error with data、
error without data、offline、unsupported。Empty、unsupported 和 error 不能共用同一插图/文案。

### 15.2 Mutation 状态

每个动作必须包含：idle、client validation、confirm、pending、success、field error、conflict、rate limited、
service unavailable、result unknown。Pending 时防重复；result unknown 时让用户检查状态，不自动重做危险动作。

### 15.3 确认强度

1. 普通可撤销：按钮直接执行，成功反馈；
2. 有影响但可恢复：确认 dialog，显示 target 与影响；
3. 高风险/可能失联：专用 review，说明恢复路径；
4. 不可逆：输入设备/app 名或服务端 challenge，保留与删除逐项列出。

## 16. 视觉方向

延续 mos 安静、工具型的产品气质，以 Adobe Spectrum 2 作为视觉、状态、密度、动效和无障碍设计系统。
这是设计语言的一致化，不是复制 Adobe 产品外壳：mos 的信息结构、品牌名称和设备语义保持独立。

### 16.1 基础色

| 角色 | 参考值 | 用法 |
|---|---|---|
| Canvas | `#f8f8f8` | 浅色页面背景 |
| Surface | `#ffffff` | 主工作区、dialog、列表表面 |
| Text | `#292929` | 主要文字 |
| Muted | `#5c5c5c` | 次要说明、时间 |
| Border | `#d5d5d5` | 分组与边界 |
| Action blue | `#0265dc` | 主动作、选择和当前导航 |
| Focus blue | `#1473e6` | 键盘 focus 指示，不与状态混用 |
| Success | `#12805c` | 有证据的成功/健康 |
| Warning | `#7a5200` | 需注意/降级 |
| Danger | `#c9252d` | 失败与破坏性动作 |
| mos marker | `#d8ff4f` | 仅作少量非交互品牌标记 |

浅色和深色不是简单反相，必须分别检查背景层、文字层级、边界、focus、hover、disabled 和语义状态。状态不能
只靠颜色；始终配文字、图标或结构。卡片只在确有分组/交互意义时使用，避免每个字段一个圆角容器。

### 16.2 字体、密度与层级

- 使用系统字体，离线可用；技术标识/日志使用等宽字体；
- 页面标题克制，信息层级由位置、字重、间距建立，不依赖超大字号；
- 主要工作区保持 12/16/24/32 px 一致节奏；
- 普通控件和触控目标至少 44×44 CSS px；
- 大表格在桌面保持高信息密度，在窄屏转换成摘要卡或明确横向滚动；
- badge 只用于短状态/source/kind，不把长句塞入 pill。

### 16.3 Motion

动画只解释状态变化：drawer/dialog 进入、task progress、状态更新。遵守 reduced motion；不做装饰性循环动画。
离线/reconnecting 不闪烁，不用持续抖动吸引注意。

## 17. 响应式与本地触屏

| 屏幕类别 | 宽度参考 | 设计重点 |
|---|---:|---|
| Compact | 320–580 | 单列；主操作不丢失；表单全宽；软键盘不遮挡提交 |
| Medium | 581–860 | 顶部一级导航；摘要 1–2 列；tabs 可滚动 |
| Wide | 861–1440 | 238 px 左侧导航；主内容约 1100 px；可用双列 master-detail |
| Very wide | >1440 | 不无限拉长表单；用辅助 panel/诊断上下文利用空间 |

每个关键旅程至少验证 320 px、860 px、常规桌面与 200% zoom。本地触屏额外验证：无 hover、软键盘、
长按不作为唯一入口、焦点不被系统 UI 吞掉、10 分钟空闲后 session/secret 的行为清楚。

## 18. Accessibility 与语言

### 18.1 Accessibility

- 所有动作可键盘完成，focus 顺序符合视觉顺序；
- dialog/drawer 打开后 focus 进入，关闭后回到触发控件；
- switch 读出名称、on/off、pending/disabled 和原因；
- task 更新使用节制的 live region，只播报阶段变化；
- chart/topology 必须有等价列表或文本；
- error 摘要可跳到字段，字段同时有 label、说明和错误；
- 对比、200% zoom、reduced motion、屏幕阅读器名称都要进入原型评审。

### 18.2 English / 简体中文

设计稿必须支持 English 与简体中文，不把短英文宽度当成固定事实。SSID、hostname、interface、version、
error code、address、key fingerprint 不翻译。危险动作采用动词 + target，例如 “Revoke token”“清除 Edge
Telemetry 数据”，避免只有 “OK/确定”。

英文文案使用 sentence case；中文不用多余空格。时间、数值和复数使用 locale；容量统一使用 IEC（MiB/GiB）。
秘密文案应直接：“此 token 仅显示一次，请立即保存。”

设计稿同时覆盖 English / 简体中文和 Light / Dark。全局偏好提供“语言”和“外观”两个选择；外观包含
跟随系统、浅色、深色，且在登录/首次设置和登录后的 shell 中始终可达。语言切换不能依赖读懂当前语言；
选项名称分别自称 “English”“简体中文”。设计验收至少组合检查：英文浅色、英文深色、中文浅色、中文深色，
以及系统主题在运行期间变化的状态。

## 19. 原型工作要求

### 19.1 原型覆盖层级

设计师可以在后端之前完成全功能原型。每个一级区域至少需要：

1. **结构原型**：导航、页面层级、主要任务；
2. **核心高保真**：正常数据与主旅程；
3. **状态原型**：loading/empty/stale/degraded/offline/error/unsupported；
4. **风险原型**：确认、权限、失联、回滚、保留/删除；
5. **响应式原型**：Compact、Medium、Wide；
6. **双语验证**：关键页面 English/简体中文。

### 19.2 Frame 命名

推荐：`[成熟度] / [区域] / [页面或旅程] / [状态] / [屏幕]`，例如：

- `P / Applications / Install / Permission conflict / Wide`
- `R / Network / Interface edit / Reconnecting / Compact`
- `P / Update / Validate / Rolled back / Wide`

原型中的 sample data 明确标注，不伪装成真实设备截图。技术标识使用安全的虚构值，不放真实 token、Wi-Fi、
key、serial 或客户数据。

### 19.3 设计评审问题

- 用户是否能说出当前在管理“系统能力、应用还是访问凭据”？
- 页面是否区分期望、执行结果和当前事实？
- 网络断开或 manager 故障后，用户是否知道发生了什么和下一步？
- 高风险动作是否在确认前展示保留/删除与恢复？
- 一次性秘密关闭后是否真的消失？
- planned frame 是否有成熟度和依赖，不会被误读为已上线？
- Compact/触屏是否仍能完成主任务，而不是只能浏览？
- 错误、unsupported、empty 是否被正确区分？
- 应用签名、系统完整性等安全文案是否只陈述可证明事实？

## 20. 交给开发时如何裁剪

设计师交付完整产品流；开发根据目标 release 的 capability matrix 决定开放范围：

1. **L** 页面按当前能力实现/维护；
2. **R** 页面在接口和目标设备 capability 通过时开放；
3. **P** 页面保留 route ownership、设计与测试用例，但生产不注册导航；
4. **X** 页面不进入本地产品，除非单独产品/硬件决策转为 P/R；
5. 已开放页面暂时故障时展示 degraded/error，不能反过来隐藏并假装 unsupported。

开发裁剪的是“当前显示哪些能力”，不是重写产品结构。禁止用以下方式交付未来功能：

- 一排永远 disabled 的菜单或按钮；
- 假数据、固定绿色状态或只播放成功动画；
- 通用 settings 表单、命令输入、unit 编辑、任意 host path；
- 在浏览器里判断签名、安全、回滚 eligibility 或存储冲突；
- 把 Services 临时改造成 Applications，或把 Fleet 塞入本地导航；
- 省略原型中已经定义的 offline、result unknown 和危险确认状态。

## 21. 分阶段设计与交付建议

设计可并行推进，开发按依赖逐步开放：

1. **现有表面统一**：shell、状态、错误、确认、双语、触控和 accessibility；
2. **Network 完整管理**：interface、Wi-Fi known networks、WireGuard；
3. **Applications / curated OCI**：inventory、catalog、preflight、生命周期、日志和回滚；
4. **Identity / diagnostics**：System Information、operational network、support bundle；
5. **Time / system update**：同步状态、更新、maintenance、验证与 rollback；
6. **Native applications / storage / recovery**：更严格的安全与不可逆语义；
7. **条件产品**：local display、local signed import、fleet、公开 marketplace，只在单独决策后进入。

## 22. 明确不设计成正常产品功能

- 通用 shell/terminal、任意命令执行、默认 packet capture；
- systemd unit、Quadlet 或任意配置文件编辑器；
- 任意 partition/format/mount/file manager；
- on-device APT 或单个系统 `.deb` 更新；
- 未签名 artifact、可变 image tag、任意 host path 的 marketplace 安装；
- 用一个绿色“Secure”覆盖 root integrity、update trust、boot trust、encryption 与 container isolation；
- 多用户/角色、email/SSO、公开 app 评分/支付等当前不存在的产品模型；
- 把 BusyBox emergency tooling 暴露为普通页面；
- 复制 Venus 的能源领域 IA、产品文案、源码、assets 或视觉品牌。

## 23. 追溯与维护

本文已经包含设计工作所需的功能、结构和状态。需要了解设计依据时：

- Venus 研究只贡献本地/远程共用信息模型、freshness、configured/observed、quick control、一致 settings row、
  screen class 等抽象模式；
- Applications 的信任、manifest、存储和生命周期边界由 `docs/design/applications.md` 定义；
- 当前实现与开发裁剪规则由 `docs/zh/design/built-in-ui-development-guide.md` 维护；
- 安装、release、time、update、recovery、storage、diagnostics、安全、fleet 等路线图分别由 PLAN-042～057
  记录。

当功能从 P 进入 R/L 时，先更新本指南的成熟度和相关原型状态，再交付生产入口。若产品结构、危险语义或
关键旅程改变，设计指南与开发指南必须在同一批次同步；不要只改高保真画面。
