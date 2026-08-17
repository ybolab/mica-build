# 调研：Init 与核心战略（Plan A / B / C）

> [English](init-strategy.md) | 中文
>
> 2026-08-17 评估的合并决策记录：保留 Talos 核心、还是转 systemd + Rust
> 用户态（Bottlerocket 模型）、还是 Rust 重写 PID 1。含实测数据、行业调研
> 与改变决策的具体触发器。

## 1. "Talos 提供了什么"的量化（非测试 Go LOC）

| 子系统 | LOC |
|---|---|
| machined 全体（PID 1、序列器、监督、controllers） | 100k |
| — 全部 controllers | 64k |
| — 仅网络栈（声明式 netlink：link/bond/vlan/route/DNS/DHCP/nftables/wireguard/时间） | 18k |
| machinery/config（多文档 schema、验证、patch） | 51k |
| 全仓库 | 515k |

忠实还原 mos 实际使用的部分 ≈ 80–120k LOC 等价物；网络栈与 COSI 运行时是
多年积累的边角案例集。

## 2. 行业调研：Rust PID 1

不存在可采用的生产级 Rust Linux init。最近的先例：**Bottlerocket**（AWS：
Rust 用户态、但 init 是 systemd——恰是支持混合模式的最强数据点）、
**Northstar**（汽车嵌入式 Rust 容器运行时）、**Aurae**（Rust PID 1，已停滞）、
rustysd/Horust/rinit（实验级）。积木真实存在（rustix、rtnetlink——netavark
在生产使用；containerd rust-extensions），但 Rust init 是开荒，不是组装。

## 3. 三个方案

### Plan A（现行）：Talos 核心 + 独立进程服务

machined 保持 PID 1；mos 的每个新增件（webd、connd、updater、kioskd）都是
独立进程，只经 COSI 资源与 `/run/machined.sock` 交互。新独立服务**可以用
Rust 写**——接口是 gRPC/COSI，语言自由。这是 strangler 形态：核心始终可
替换，但产品不押注在替换上。

### Plan B（指定后备）：systemd + Rust 用户态（Bottlerocket 模型）

可行性**高**——这就是嵌入式主流路线（Torizon、Venus、balena 皆 systemd
系），Bottlerocket 在规模上验证了这个形态。与 Plan A 对比：

| 维度 | Plan A（Talos） | Plan B（systemd + Rust） |
|---|---|---|
| 内核下限 | 硬性 5.2（fsopen）；政策 Tier 1 = 5.10 | 约 4.15（经典挂载）——**对老厂商内核板的决定性优势** |
| C 用户态集成（RAUC、wpa_supplicant、bluez、cage/kiosk、ModemManager） | 每个都要定制监督接线 | **原生**：这些全都自带 systemd unit；RAUC 的主场就是 systemd/D-Bus |
| 声明式运行时 | COSI 收敛（我们的差异化；connd/access/display 全按它建模） | 失去——换成 settings→模板→重启（Bottlerocket 式）或自建 Rust 迷你协调器（Rust 志向的一个**有边界的**正当落点：对 systemd/networkd 做协调器，而非 PID 1 + 挂载 + netlink） |
| 配置机制、机器 API（apid/talosctl）、上游安全流 | 继承自 Talos | 自建 / 失去 |
| Extensions | Talos system extensions | systemd-sysext（近似物，甚至更简单） |
| 从今天迁移的成本 | 零——真机 bring-up 已过 /etc overlay | 战略重置，约 3–6 个月；BSP 层（kernel/uboot/板卡产物）原样复用 |

### Plan C：从零 Rust PID 1

达到 Talos 级可靠性需 12–24 工程师月（§1），永久独扛维护，无基座可继承
（§2）。唯一胜出场景：必须支持低于 systemd 下限的内核且 init 需求已冻结。
降级到 Plan B 之后。

## 4. 触发器（到点重评，不凭感觉漂移）

以下任意两条成立即启动 Plan B 评估：

1. 上游 Talos 合并成本连续两个季度超过约每季度一人周。
2. 出现门控无法容纳的结构性上游不兼容（如彻底放弃 6.x 前内核挂载兼容），
   或 4.x/<5.2 内核板成为主力业务需求（boards.md §6）。
3. mos 的 init 级需求冻结满 6 个月。

在此之前：Plan A，独立进程纪律作为常备逃生门。Rust 投入直接落在产品层
服务与 `update/sign` 工具（tough）。

## 5. 无论哪个方案都从 Bottlerocket 吸收的部分

见 os-comparison.md 附录：tough（Rust TUF）用于发布签名、migrator 模式用于
配置 schema 迁移、admin 容器模式作为 `sealed` profile 的访问选项、wave 分批
推送用于机队阶段。
