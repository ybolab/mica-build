# API 参考

mos 管理 API 由一份机器可读契约规定：**`pkgs/mosd/apid/openapi.json`**。
它从服务这些路由的同一份代码生成，CI 保证它与随附二进制报告的内容一致——
因此它不会像手写端点清单那样偏离设备。本页刻意不复制端点清单；它告诉你
契约在哪里，并陈述 schema 本身表达不了的事实。

> status: shipped — evidence: `pkgs/mosd/apid/openapi.json`

## 1. 一段话说清这个面

apid 在 443 端口提供 HTTPS（80 端口重定向），`/api` 是完整的管理协议：
带版本的设置与状态读取、类型化写入、排队的任务记录、初始设置与会话生命
周期、UI 选择、实时网络观察、更新状态和系统动作。错误是 JSON 信封。
`/healthz` 是 `/api` 之外唯一的运维例外，它只证明 apid 进程在监听——
不证明 mosd 或其他任何东西健康。`/_ui/` 上的内置浏览器 UI 是同一 API 的
普通客户端，没有特权旁路。

> status: shipped — evidence: `pkgs/mosd/apid/openapi.json`, `docs/design/remote-management.md`

## 2. 认证

两种凭据形态，都定义在契约里：

- **浏览器会话**——在会话路由用密码登录，得到一个签名的
  `HttpOnly; Secure` cookie 加每会话 CSRF token；基于会话的变更操作必须
  在 `X-CSRF-Token` 里携带该 token。
- **Bearer token**——面向自动化；存储的 token 认证 API 调用，无需 CSRF。
  初始设置为纯 API 客户端返回一次性 token。

设置状态发现与会话状态（`GET /api/v1/session`）是仅有的免认证操作；读取
或改变设备状态的一切都需要上述凭据之一。登录尝试有持久退避的限速并被
审计（[security.md](security.md)）。

> status: shipped — evidence: `pkgs/mosd/apid/openapi.json`, `docs/design/access.md`

## 3. 版本化

API 在路径中带版本（`/api/v1/...`），仓库中的 OpenAPI 文档在 CI 里与基线
分支做 diff，因此破坏性变更是一个可见的行为而不是意外。从你所面向的
发布版消费契约；该文档与树一起版本化，如同其他所有产物
（[doc-contract.md](doc-contract.md)）。

> status: shipped — evidence: `pkgs/mosd/apid/openapi.json`, `docs/design/api.md`

## 4. 什么不是公开 API

- **D-Bus 接口 `com.mos.mosd1`** 是 apid 与 mosd（以及启动健康门）之间的
  本地 IPC 边界。它在设备上按策略仅 root 可用，不是受支持的集成面；请
  通过 HTTPS 集成。
- **MQTT** 是应用数据面，不是管理通道：只有由软件包登记的应用服务被
  桥接，管理状态与动作在结构上被排除。语法与登记契约见
  [../design/bus.md](../design/bus.md)。
- **`/_ui` 与自定义 UI 资源**是静态内容，不是契约；自定义 bundle 无法
  遮蔽 `/api` 路由。

> status: shipped — evidence: `docs/design/bus.md`, `pkgs/mosd/dist/`

## 5. 试一试

API 验收套件在 QEMU 里启动 x64 镜像，通过真实套接字驱动契约的每个阶段——
它也是这个面端到端行为（包括 TLS、重定向与认证门控）的参考：

```sh
bash pkgs/mosd/tests/apid-api/run.sh
```

> status: shipped — evidence: `pkgs/mosd/tests/apid-api/run.sh`
