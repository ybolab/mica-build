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
| 整套 Yocto（自建 mini-Torizon） | 运行时控制面为空：没有 COSI 等价物，配置漂移卷土重来；构建时长与专职技能成本。**2026-08-23 以"包选择/脱离发行版"这一不同论点被重提，实测后再次否决，见 §3.1** |
| 用 `debootstrap --variant=minbase` 取代 `debian:*-slim` | **2026-08-23 实测：包集合完全相同，磁盘占用严格更差**，见 §3.1 |
| 以 Photon OS 为基座 | 它本身就是一个发行版，不是脱离发行版的途径：VMware 在 `vmware/photon/SPECS` 里自维护约 1000 个 RPM spec，最后一个正式版 5.0 停在 2023-04。采用它等于把对 Debian 的依赖换成一个更小、节奏更慢、且已归 Broadcom 的依赖 |
| 以 balenaOS 为基座 | supervisor/云耦合；无声明式 machine config；管理面含 AGPL/闭源件 |
| 以 Torizon 为基座 | Toradex SoM 引力；OSTree 与我们的 verity/squashfs 身份模型冲突；云闭源 |
| PLAN-005（FIT 驻 RAM 单文件 + 自研 Go updater） | ~130MB RAM 常驻；重造 RAUC 已锤炼的领域；需要按版本对的差分服务端。被 PLAN-006 取代 |
| OCI/registry 作为升级传输 | 静态 HTTP + lockbox 无论如何都要存在；registry 徒增一个有状态服务、零收益 |
| 维持删除式派生 | 401 commit 的漂移已证明不可合并；上游 k8s-less 门控（9ffa772ba）使其失去存在意义 |

### 3.1 附录：「自建用户空间」的重新审视（2026-08-23 实测）

上面对 Yocto 的否决讲的是**管理面**——从零构建的 OS 没有 COSI 等价物。它没有
回答重提时依据的两个论点：自建可以精确挑选需要的包，以及可以不绑定发行版。
这里用数字回答，免得这个问题第三次出现。

**发行版税是真实的，而且量过了。** `debian:trixie-slim` 一上来就带 **78 个包
/ 117 MB，全都不是我们选的**；mos 只报了 15 个包名，最终装成 161 个包 /
199 MB。所以前提成立：镜像的大部分不是 mos 的决定。

**但其中几乎没有可回收的部分，而可回收的那部分已经回收了。** RFCT-099 删掉了
包管理器——apt、dpkg、perl-base、debconf、gpgv——省下 24 MB。78 个包里剩下的
是 glibc 用户空间的地板：`coreutils` 17.6 MB、`libc6` 12.7 MB、`bash` 7.0 MB、
`util-linux` 4.9 MB、`libssl3` 5.9 MB。留着它们不是 Debian 的决定；替换它们
意味着改用 musl + busybox，那是换基座而不是精简基座。依赖闭包也不是被 systemd
主导的——实测 systemd + udev + dbus 拉入 25 个包，而功能集（openssh、bluez、
wpasupplicant、hostapd、curl、rauc）拉入 88 个。

乐观估计，从零构建用户空间能省 **40–60 MB**。rootfs 现为 210 MB，预算 400 MB。
**这些空间买不到任何东西。**

**`debootstrap --variant=minbase` 被直接实测，结论是严格更差。** 它产出的是
*同样的 78 个包*——两份包清单做 `comm`，minbase 没有任何 slim 缺少的条目——
因为官方 `-slim` 镜像由 debuerreotype 生成，而它*就是* minbase 加上剥离文档
与 locale 的步骤。差别在磁盘上：minbase 带着 33 MB 的 `/usr/share/locale`、
8 MB 的 `/usr/share/doc`、5 MB 的 `/usr/share/man`，而 slim 分别是 1 + 2 + 1。
换过去等于先接收 42 MB 额外内容，再写代码把它删掉，回到原点。

**Photon OS 究竟是什么（既然它被当作范本提出）。** 它的架构是在仓库内自维护
约 1000 个 RPM spec 文件（`vmware/photon`，分支 `5.0`，`SPECS/`），包管理器是
`tdnf`。这就是认真做「自建用户空间」的样子，而维护成本体现在发布节奏上：
5.0-GA 的日期是 2023-04-28。Bottlerocket（§4）是同一模式更好的实现，且已评估过。

**成立的结论，以及它背后的原则。** 独立性是**按组件**买的，不是按发行版买的，
而 mos 已经在要紧的地方买到了：内核与 U-Boot 在 `board/cx3576/` 下从钉死的源码
构建，管理面是我们自己的 Rust，PLAN-012 的容器引擎静态链接因而在构造上就与基座
无关。留在 Debian 上的那些——glibc、coreutils、systemd、bluez、wpa_supplicant、
openssh——恰恰是差异化价值最低、而最需要别人来做安全响应的一组。

## 4. 附录：Bottlerocket（2026-08-17 评估）

AWS 从零自研的不可变 OS：上游 LTS 内核 + glibc + **systemd** + 打补丁的
GRUB（signpost 的 GPT 优先级位 A/B），管理用户态全 Rust（apiserver、
updog/TUF、migrator），主机访问经 admin/control 容器，dm-verity rootfs，
SELinux enforcing。构建体系：Rust `buildsys` 驱动内部 RPM spec（运行时无
包管理器）。

结论：**与 mos 独立收敛出的架构模式相同**（不可变 + verity + A/B + TUF +
受控访问 + 镜像变体）；不作为基座采用，因为 signpost 不支持 U-Boot、其
settings 树没有协调回路（撑不起 connd 级网络）、AWS 耦合的构建体系加上
薄弱的非 AWS 社区使派生比 Talos 路线更贵。其 init 选择（无聊的 systemd、
Rust 只在边缘）已记录为 research/init-strategy.md 的 Plan B。

无论如何吸收的部分：**tough**（Rust TUF 库）用于 `update/sign`、
**migrator** 模式用于配置 schema 迁移、**admin 容器**模式作为 `sealed`
profile 的访问选项、**waves** 用于机队灰度。

## 5. 定位

balenaOS 赢在云管容器机队；Torizon 赢在工业 SoM 与升级标准；Talos 赢在
不可变性与声明式纯粹。mos 以 Talos 架构为差异化根基，回补其数据中心出身
所缺的现场工程——同时让每一个借来的机制（Uptane、RAUC、SideroLink）保持
上游维护形态，而不是吸收成私有分叉。
