# 存储

mos 管理一套固定的、由板卡声明的分区布局；它不提供分区编辑器，并用四个
层级回答"我的数据放哪里"，每个层级都由"丢了它意味着什么"来定义。理解这
四个层级，就是操作员或集成商需要从本页获得的大部分内容。

## 1. 四个层级

| 层级 | 挂载点 | 存放 | 会扩展吗 | 何时丢失 |
|---|---|---|---|---|
| **STATE** | `/mnt/state`（绑定进 `/etc` 与 `/var/lib`） | 配置与身份：设置、凭据、SSH 主机密钥、WiFi 配置、配对 | 否——小且固定 | 仅重刷 |
| **DATA** | `/srv`（`/home` 与 `/root` 绑定其上） | 应用数据、容器存储、操作员文件 | **是**——首次启动时占满磁盘 | 仅重刷 |
| **META** | `/mnt/meta` | 更新与设备元数据（RAUC 槽状态） | 否 | 仅重刷 |
| **EPHEMERAL** | `/var` | 可丢弃的运行时残留：日志、缓存 | 否——固定大小 | 重刷，**以及**例行清理 |

根文件系统本身是固定 A/B 槽中只读、受 dm-verity 保护的 squashfs；它从不
被写入，从不被调整大小。一次 A/B 更新只写 rootfs 和 boot 槽——上面的每个
层级都在更新中保留。

> status: shipped — evidence: `docs/design/ro-root.md`, `boards/cx3576/board.env`

## 2. 由此得出的规则

- **数据放 DATA。**集成商文件、脚本、应用状态和容器卷属于 `/srv`（或
  同在 DATA 上的 `/home` 与 `/root`）。它们在重启和更新中保留。
- **想保留的东西绝不要放 `/var`。**它刻意小、被每日清理规则老化、按契约
  可丢弃——构建在有贵重物落到那里时会失败。"用了几个月然后没了"的存储，
  正是这条规则防止的失败。
- **DATA 是共享的。**容器镜像与卷、自定义 UI bundle 和应用数据用的是同
  一个分区。不做轮转就写日志的应用会饿死它的邻居；`podman system df`
  显示容器占的份额。
- **随意编辑 `/etc` 不会持久。**受支持的持久化路径是设置树
  （[configuration.md](configuration.md)）；刻意保留的 STATE 支持例外在
  设计记录中逐一列出。
- **首次启动的扩展是单向的。**DATA 在首次启动时扩展到占满磁盘；没有任何
  东西把它缩回去。重刷之后，镜像范围之外的块是不可达而非被抹除——见
  [recovery.md](recovery.md) 中的处置警告。

可写文件系统启用了周期性 TRIM，启动时的文件系统检查覆盖它们。

> status: shipped — evidence: `docs/design/ro-root.md`, `make os-repart-test`

## 3. 今天可以观察到什么

还没有存储状态 API。在设备上，常规工具可以回答：`df` 看每层容量，
`podman system df` 看容器在 DATA 中的份额，journal 看文件系统检查结果。
介质健康（eMMC 磨损、SMART）完全没有暴露。

> status: shipped — evidence: `docs/design/containers.md`

## 4. 计划中的东西

存储生命周期计划将加入本页目前无法描述的操作员侧子系统：一个
`StorageStatus` 模型（身份、角色、大小、已用/空闲/保留、挂载与错误状态、
最近一次检查/修复结果）、按板卡与介质类型归一化的介质健康信号、带迟滞的
低空间阈值与受保护的更新工作区、离线修复与保数据的更换流程，以及先发布
后声明的版本化备份/导出与恢复契约。加密姿态和可移动介质契约是该计划内部
的决定；在它落地之前，两者都不存在。

> status: proposed — evidence: `docs/plan/PLAN-049.md`

TODO(PLAN-049): revisit after this plan merges
