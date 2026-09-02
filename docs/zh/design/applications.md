# 托管应用

> [English](../../design/applications.md) | 中文

本文定义 mos 计划中的本机应用产品边界。它是已批准设计，**不代表当前已经交付**：现有 OpenAPI
没有 `/api/v1/apps` 或 `/api/v1/app-catalog`，系统镜像中也没有 `mos-appd`。

第一阶段目标是厂商维护、签名的精选 OCI 目录；受管 native 程序是后续阶段。公开发布市场、fleet
批量 rollout 和任意本地 root workload 均不在范围内。完整页面交互、状态和开发检查表见
[`built-in-ui-development-guide.md`](built-in-ui-development-guide.md)。

## 1. 产品边界

Services 管理 mos 自身的全局 Container/MQTT 能力；Applications 管理一个产品的身份、来源、版本、
权限、数据和生命周期。应用清单区分四种来源：

| 来源 | 含义 | 管理器权限 |
|---|---|---|
| System | 只读根中的系统原生应用 | 只观测；随 RAUC 更新/回滚 |
| Catalog | 厂商精选签名目录 | 完整托管生命周期 |
| Local trusted | 由设备登记的集成商 key 签名 | 只有 opt-in capability 存在时托管 |
| External/unmanaged | 发现的 service、手写 Quadlet/unit | 只观测，不接管、更新或移除 |

托管 artifact 的 kind 可以是 `oci` 或 `native`。类型不等于来源，也不等于安全等级。

## 2. 安全与 manifest

当前容器 runtime 是 rootful，systemd unit 也可请求接近 root 的主机权限。签名只能证明 publisher 与
精确 digest，不能把任意运行声明变成 sandbox。因此：

- 目录 release 必须签名并锁定 digest，不接受不完整镜像名或可变 tag；
- API/UI 不接受原始 systemd unit、Quadlet、shell command 或任意绝对 host path；
- native 目录 bundle 只带声明式 manifest，由 manager 生成命名空间化、加固的
  `mos-app-<id>.service`；
- raw unit 只属于 trusted-integrator 范围，不因为签名就获得“marketplace safe”标签；
- acquisition 以无 activation 权限的上下文完成，特权 activation 对同一 digest、签名、manifest 和
  staged tree 再验证；
- native 目录在非 root identity、systemd sandbox profile 和启动时 OS compatibility 未落地前保持关闭；
- UI 不在当前 rootful OCI 上声称 hostile multi-tenant isolation。

一个版本化签名 manifest 同时描述 OCI 与 native：app id/name/vendor/version、kind/artifact digest/signature、
architecture/board/profile/API/schema/system-version 兼容范围、ports/networks/devices/D-Bus/MQTT/mounts、
storage/secrets、CPU/memory/PIDs/I/O/capabilities、entrypoint/restart/health、data schema/rollback、license、
SBOM/provenance/support。一个应用可拥有多个 unit 或 `com.mos.*` service；发现到的 service 不能反推为
installed app。

## 3. 生命周期

每个应用同时暴露三条状态：

- desired：absent / installed-disabled / installed-enabled；
- runtime：stopped / activating / running / failed / blocked；
- health：unknown / healthy / degraded / unhealthy。

```text
absent -> staging -> verifying -> installed -> activating -> running
             |           |            |             |
             +-----------+------------+-------------+-> failed

updating -> health-gate -> running (new revision)
                      \-> rolling-back -> running (last known good) / blocked
```

每个 operation 有稳定 task id。HTTP 响应丢失时，客户端先读取 task/app，不得自动重发 install/update/remove。
`blocked` 携带结构化原因，例如 containers disabled、OS incompatible、signature revoked、resource conflict、
device unavailable 或空间不足。应用兼容性在每次启动和 OS rollback 后重新验证。

更新保留 last-known-good artifact 直到新版本通过有界健康闸。Code rollback 与 data rollback 是两个独立
承诺；发生不可逆 data migration 后，UI 不得把代码回滚描述成数据恢复。

## 4. 管理器、存储与秘密

```text
Browser / kiosk -> APID -> mosd -> mos-appd -> OCI/native adapter -> systemd
```

未来 `mos-appd` 负责有界 staging、签名/摘要/manifest/路径/大小验证、registry、受管 runtime definition、
systemd 操作、health gate、last-known-good rollback、资源冲突和 GC。APID 只访问 mosd；HTTP handler 不直接
调用 Podman、拼接 shell 或写 unit。manager private IPC 不占用 `com.mos.*` 应用数据命名空间；Item1/MQTT
永不承载应用生命周期控制。

| 数据 | 位置/所有者 | 语义 |
|---|---|---|
| registry、active revision、小型 activation metadata | `/mnt/state/mos/apps/` | STATE，跨重启/A-B |
| download staging/artifact cache | `/mos/apps/.staging/` 和 manager cache | DATA，有界清理 |
| app data | `/mos/apps/<app-id>/data/` | DATA，Remove 默认保留 |
| runtime definitions | manager-owned STATE-backed 目录 | 原子发布 |
| secret | 新的 per-app protected store | API write-only，以 credential file 交付 |
| log | 有界 journal 查询/导出 | EPHEMERAL，不是永久审计 |

preflight 分别计算 staging、last-known-good、持久数据 reservation 和安全余量。大型 bundle 不进 STATE，
持久数据不进 `/var`。应用 storage 与 custom UI、system update workspace 共享 DATA，需要统一 reservation。

## 5. 计划 HTTP 契约

以下路径只有进入 `pkgs/mosd/apid/openapi.json` 并通过 binary contract gate 后才算当前 API。

| Method + planned path | 用途 |
|---|---|
| `GET /api/v1/apps/capabilities` | manager/catalog、OCI/native/local-import 能力与 unavailable reason |
| `GET /api/v1/apps` / `GET /api/v1/apps/{appId}` | inventory 与 detail |
| `GET /api/v1/app-catalog` / `GET /api/v1/app-catalog/{appId}` | 精选目录与精确 release/digest |
| `POST /api/v1/app-catalog/{appId}/preflight` | 无副作用兼容、冲突、权限、空间和 rollback 检查 |
| `POST /api/v1/apps` | exact release/digest + fresh preflight token；202 task |
| `POST /api/v1/apps/{appId}/actions/{start,stop,restart}` | 服务端 allowed-actions 控制的 lifecycle task |
| `POST /api/v1/apps/{appId}/actions/{update,rollback}` | 精确 revision；202 task |
| `PATCH /api/v1/apps/{appId}/configuration` | 只接受 signed schema 中的 typed field |
| `PUT /api/v1/apps/{appId}/secrets/{name}` | write-only secret replace |
| `GET /api/v1/apps/{appId}/logs` | since/cursor/limit 有界且默认脱敏 |
| `GET /api/v1/apps/{appId}/versions` | current/last-known-good/available/compatibility |
| `GET /api/v1/apps/activity` | 有界 task/audit projection |
| `DELETE /api/v1/apps/{appId}?retainData=true` | 默认保留数据的 Remove |
| `POST /api/v1/apps/{appId}/actions/purge-data` | 独立不可逆 challenge |

preflight token 绑定 app/action/exact digest/manifest/device compatibility/permissions/reservation 且会过期；
它不是授权绕过。System/External 没有 mutation allowed action；signature/revocation failure 没有 bypass。

## 6. UI 与交付顺序

Applications 是 Services 与 Access 之间的第六个一级入口：Installed、Catalog、Activity，以及包含 Overview、
Configuration、Permissions、Logs、Versions 的详情页。capability 可用前生产路由隐藏；交付后 manager 故障
属于 degraded，不是 unsupported。

Install/Update 固定经过 compatibility、access/storage、exact confirmation、task progress 四步。OCI 在全局
runtime 关闭时显示 Blocked 和 Open Services，不能静默打开它。Remove 默认 Keep data；Purge 独立 challenge。

交付顺序是：只读 inventory → curated OCI → managed native → opt-in local trusted import。公开市场只有在
publisher operations、vulnerability response、policy、support 和 isolation 单独完成后才可能评估，不由前四
阶段自然推出。
