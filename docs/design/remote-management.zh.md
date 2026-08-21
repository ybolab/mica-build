# 设计：远程管理与 API 面

> [English](remote-management.md) | 中文
>
> **过期警告（2026-08-21，RFCT-082）**：本译文已落后于英文版，且未逐条对齐；
> 冲突时以英文版为准（docs/README.md 的双语规则）。是否恢复中文文档的同步维护
> 仍是搁置中的用户决定（docs/task/RFCT-045.md）；在该决定作出前，请以
> remote-management.md 为准。
>
> 谁通过什么协议、以何种信任与设备对话。关于保留 Talos apid（上游机器 API）与
> apid（产品 UI）并存的决策记录。

## 1. 双前端，一个 machined

| | apid | Talos apid + talosctl |
|---|---|---|
| 受众 | 终端用户 / 设备所有者 | 运维、自动化、未来机队管理面 |
| 协议 | HTTPS + 会话认证（首启设置） | gRPC :50000，双向 TLS（talosconfig） |
| 范围 | 设置向导、状态、网络、升级 UI | 完整机器 API：apply-config、upgrade、日志、事件、reset |
| 维护方 | 我们 | **上游 Talos**（保留它的决定性理由） |
| 默认 | 开 | **关**（或仅绑管理网段）；按部署启用 |

两者都是 `/run/machined.sock` 之上的薄前端，都不持有状态。trustd 保持关闭
（节点间信任在单机 appliance 上没有角色）；appliance 的 Talos apid 使用本地签发
PKI（controlplane 式），已在基线切换 campaign 中实现并有测试覆盖。

## 2. 触达 NAT 后的设备

采纳上游方案作为规划中的机队路径：**SideroLink** —— 设备主动向管理端拨出
WireGuard 隧道，Talos apid 经隧道可达（Omni 的底层机制；协议与配置类型均在树内）。
拓扑上等价于 balena 的 VPN 回连，但由上游持续维护。

除 API 触达外，siderolink 协议还承载设备→服务端的事件流与内核日志推送——
管理与遥测共用同一条设备发起的隧道。机队 profile 下 Talos apid 仅绑定隧道接口
（LAN 上不可见）；消费级部署两者都不配置。

尚未排期；落地时的前置决策：管理端托管方式、设备注册（join token vs 预置）、
以及 ECU 版本清单（PLAN-006 phase 2 director）如何复用该通道。

## 3. 升级控制流

第一阶段（day-1）：设备拉取——updater 按 `UpdateConfig` 策略检查静态 Uptane
仓库；apid 提供手动检查/应用；lockbox 覆盖离线。此阶段不存在管理服务器，
服务端除静态内容托管外无任何可运维/可攻破的组件。

机队阶段（phase 2）：director 仓库增加按设备定向；Talos apid/SideroLink 提供指令
式触达（触发升级、取日志）。apid 在任何阶段都是本地兜底。

**Talos apid 作为远程升级入口（2026-08-17 决策）。**`MachineService.Upgrade` RPC
保留为 PLAN-006 updater 状态机的*触发入口*，绝不是它的旁路：

- RPC 参数语义从"installer 容器镜像"改为"升级 target/版本"；updater 在
  RAUC 触碰任何槽之前仍执行完整的 TUF 元数据验证与 hash 钉住。管理端被
  攻破也产不出能安装的载荷（TUF 在线密钥签不了 bundle）。
- 三种触发、一条信任路径：策略拉取（`UpdateConfig`）、远程触发（经
  SideroLink 的 Upgrade RPC）、本地触发（apid 按钮 / lockbox）——全部汇入
  同一个 updater 状态机、健康门与回滚逻辑。

## 4. 安全姿态

- Talos apid 默认关闭 ⇒ 消费级部署在局域网上只暴露 apid。
- talosconfig 客户端证书是运维凭据——绝不下发到终端用户设备的所有者手里。
- SideroLink 隧道由设备侧发起；设备不开任何入站端口。
- 三个平面（apid 会话、Talos apid mTLS、SideroLink WG）是独立凭据域；攻破其一
  不授予其余。
