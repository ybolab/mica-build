# 调研：OS 方案对比（决策依据）

> [English](os-comparison.md) | 中文
>
> 浓缩自 2026-08 对 balenaOS、Talos、Torizon OS、Venus OS 与整套 Yocto 自建
> 的评估。记录"从谁那里拿了什么、否决了什么及其理由"——避免未来重新争论
> 已定结论。

## 1. 对比矩阵

| 维度 | balenaOS | Torizon OS | Talos | Yocto 自建 | **mos 选择** |
|---|---|---|---|---|---|
| 构建 | Yocto（Poky+BSP+meta-balena） | Yocto（meta-toradex） | buildkit + Go pkgs | Yocto | **buildkit**（Yocto 仅在板卡目录内、且仅在别无选择时） |
| rootfs 不可变性 | 只读分区 A/B | OSTree 硬链接树 | squashfs（initramfs 内） | 自行拼装 | **Talos squashfs，磁盘承载 + dm-verity**（PLAN-006） |
| OS 升级 | HUP 整分区 A/B | OSTree 提交 + aktualizr | 整镜像 A/B | RAUC/swupdate layer | **RAUC 槽 + machined 内建 Uptane 客户端** |
| 升级安全 | TLS + 私有协议 | **Uptane** | 镜像签名 | 自行拼装 | **Uptane**（Torizon 已验证） |
| 差分升级 | 二进制差分（10-70x） | OSTree 按对象拉取 | 无 | casync 等 | **RAUC adaptive 按块哈希，纯静态 HTTP** |
| 应用交付 | supervisor + docker-compose | compose 作为 Uptane secondary | Kubernetes | 自行拼装 | 未来：**compose bundle 作为 Uptane secondary ECU** |
| 声明式运行时配置 | 无（target state 只管应用） | 无（/etc + 脚本） | **COSI machine config** | 无 | **COSI** —— 选 Talos 作核心的根本原因 |
| 现场配网 | boot 分区 config.json、AP 工具 | Toradex 工具链 | 无（须先能推配置） | 无 | **balena 模式**：BOOT 文件、USB、AP 门户（access.md §7） |
| 远程触达（NAT） | VPN 回连 + 云 | Torizon Cloud | SideroLink（Omni） | 无 | **SideroLink**（规划中） |
| Shell/SSH | 有（dev 开放，prod 需密钥） | 有（常规 Linux） | 无 | 有 | **门控 + 变体分离**（access.md） |
| 硬件覆盖 | 90+ 设备型号（Yocto BSP） | Toradex SoM 优先 | UEFI 为主 + overlay | 什么都行、代价自付 | 每板 artifact 目录（boards.md） |
| 许可 | OS Apache-2 / openBalena AGPL / 云闭源 | OS 开源 / 云闭源 | MPL-2.0 | n/a | MPL-2.0（talos fork）+ Apache-2 工具 |

## 2. 从谁那里拿了什么

- **Talos**：核心。COSI 声明式收敛、machined 监督、不可变 squashfs rootfs、
  单镜像思维、machine config 模型、上游维护的 apid/talosctl。通过上游
  k8s-less 门控（PLAN-007）保留，而非删除式分叉。
- **Torizon**：升级信任架构（Uptane、lockbox 式离线包、面向未来应用/
  bootloader 更新的多 ECU 模型）。其 OSTree 被否决：内容寻址 rootfs 会替换
  Talos 的 squashfs 身份模型，并扩大运行期攻击面。
- **RAUC**（Yocto 生态）：槽安装器。在磁盘承载 rootfs 使"单 FIT 文件"的
  优雅性论据消失之后，胜过用 Go 重造槽写入/bootcount/掉电安全（PLAN-005，
  已被取代）。以仅 CLI 方式集成，无 D-Bus，machined 仍是唯一编排者。
- **balenaOS / Venus OS**：现场工程模式——离线配网介质、SD/USB 升级体验、
  dev/prod 镜像双变体、"boot 分区放配置文件"的零网络引导。其云中心化的
  设备 supervisor 未采纳（webd + updater 在本地补位）。
- **Yocto**：仅作板卡目录内的受控 BSP 工具；其包生态与许可合规工具链是
  唯一实质损失，由 CI 中的 SBOM 扫描补偿（列为待办义务）。

## 3. 被否决的方案（附一句话死因）

| 方案 | 否决理由 |
|---|---|
| 整套 Yocto（自建 mini-Torizon） | 运行时控制面为空：没有 COSI 等价物，配置漂移卷土重来；构建时长与专职技能成本 |
| 以 balenaOS 为基座 | supervisor/云耦合；无声明式 machine config；管理面含 AGPL/闭源件 |
| 以 Torizon 为基座 | Toradex SoM 引力；OSTree 与我们的 verity/squashfs 身份模型冲突；云闭源 |
| PLAN-005（FIT 驻 RAM 单文件 + 自研 Go updater） | ~130MB RAM 常驻；重造 RAUC 已锤炼的领域；需要按版本对的差分服务端。被 PLAN-006 取代 |
| OCI/registry 作为升级传输 | 静态 HTTP + lockbox 无论如何都要存在；registry 徒增一个有状态服务、零收益 |
| 维持删除式派生 | 401 commit 的漂移已证明不可合并；上游 k8s-less 门控（9ffa772ba）使其失去存在意义 |

## 4. 定位

balenaOS 赢在云管容器机队；Torizon 赢在工业 SoM 与升级标准；Talos 赢在
不可变性与声明式纯粹。mos 以 Talos 架构为差异化根基，回补其数据中心出身
所缺的现场工程——同时让每一个借来的机制（Uptane、RAUC、SideroLink）保持
上游维护形态，而不是吸收成私有分叉。
