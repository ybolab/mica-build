# 安全

本页陈述一台 mos 设备出厂时的安全姿态：什么受保护、由什么机制、针对什么
攻击者——以及缺口，用同样的精度点名。贯穿全页要记住的威胁模型边界：
**物理持有启动介质即意味着完全控制。**握有硬件的人可以重刷它；下面的
保护针对的是其他所有人。

## 1. 运行时完整性：只读 verity 根

根文件系统是带 dm-verity 哈希树的 squashfs，运行时逐块验证；根哈希随内核
命令行传递。设备无法被修改为运行被篡改的系统代码，除非替换整个槽；每个
服务，包括管理面，都从那个密封的根运行。写入只去向声明的数据层级
（[storage.md](storage.md)）。

本节**不**声明的东西：端到端安全启动。在 cx3576 上，构建过程不签名 SPL
或 U-Boot，因此内核以下的链条未经认证；许多客户自选板卡使用不透明的启动
阶段，rootfs 完整性不得被曲解为启动链完整性。这里记录为缺口，不假装
不存在。

> status: shipped — evidence: `docs/design/ro-root.md`, `docs/design/uboot-ab-handshake.md`

## 2. 更新真实性

一次更新由两个互不相关的体系签名两次：RAUC bundle 的 CMS 签名在设备上
对照其密钥环验证；主机侧 TUF 元数据（四个 ed25519 角色，root 离线）固定
bundle 的摘要、长度和 verity 根哈希。密钥仪式、保管与轮换程序写成了可
执行的 runbook，
[../design/release-signing.md](../design/release-signing.md)。

镜像如何自述，以及可以问设备什么：

- **镜像自带信任等级，设备会如实报告。**未提供材料的构建生成开发级签名
  材料并打上标记，该标记会被烘焙进镜像。用 `GET /api/v1/system/info` 问
  设备：`trust.grade` 为 `development` 或 `production`；开发级镜像还会
  说明是哪一半材料是开发级的——RAUC 密钥环、软件包签名密钥，或两者。
- **开发级镜像无法发布给客户。**发布闸门会拒绝镜像带该标记的
  `candidate` 或 `stable` 发布，并点名它找到的文件。不作任何承诺的
  `development` 渠道仍然接受。这在此前只是惯例，现在是一次拒绝。

已点名的缺口：

- **还没有任何地方配备生产密钥。**产出它们的仪式已经写下
  （[../design/release-signing.md](../design/release-signing.md)），但尚未
  执行。本仓库至今构建的每个镜像都是开发级的，并且如实这么说。
- **已部署设备上没有密钥环轮换渠道**——替换在役设备上的信任锚，目前
  意味着一个由正被替换的那把密钥签名的镜像。错过轮换重叠窗口的设备，
  以及从已被攻陷的 CA 轮换出去，仍然需要物理重刷。
- **镜像预置了软件包信任锚；已发布的客户端还没有读它。**烘焙进去的更新
  配置携带受信任的软件包签名密钥，构建会拒绝产出没有它的镜像。但镜像里的
  `rauc-verify` 与 `rauc-update` 仍然从带外提供的固定根验证 TUF 元数据，
  而没有任何镜像预置那样一个根
  （[update-rollback.md](update-rollback.md)）。

> status: shipped — evidence: `docs/design/release-signing.md`, `pkgs/rauc-sign/`

## 3. 访问与凭据

- **每设备凭据，在设备上铸造。**没有任何秘密烘焙进镜像——镜像在全机群
  字节相同，烘焙进去的凭据就是全机群共享的秘密。如果工厂 shadow 文件带
  可用的密码哈希，构建会*失败*，两个 profile 都是。
- **管理 API 是大门。**仅 HTTPS；浏览器用密码登录加签名会话和 CSRF
  保护，自动化用 bearer token；持久化的登录退避计数器，以及对登录、
  初始设置、电源动作和临时密码事件的有边界、fsync 落盘的审计轨迹。
- **两个 profile 都默认关闭 SSH。**持久访问只凭公钥，且每个授权密钥都是
  root 密钥——UI 里原话如此声明。临时 root 密码（由经过认证的管理员
  设置，下次启动自动清除）覆盖操作员在台架前的情形，而不产生长寿命
  密码。
- **锁死是真实的。**丢失管理员凭据和所有密钥后没有软件路径可进
  （[recovery.md](recovery.md)）——这是刻意的取舍：凭据在更新中保留，
  意味着更新不是后门。

审计轨迹尚未记录会话生命周期事件，也没有任何东西上传它；没有硬性锁定
阈值（刻意如此，直到存在物理在场的解锁路径）。

> status: shipped — evidence: `docs/design/access.md`, `docs/design/provisioning.md`

## 4. 应用

容器以 root 运行（rootless 模式没有构建），随附策略不验证容器镜像签名——
保护是 registry TLS 和摘要固定，语境是受信任集成商的威胁模型。管理面与
应用的边界是结构性的：MQTT 桥只能到达精确登记的应用服务，永远无法寻址
管理守护进程。见 [applications.md](applications.md)。

> status: shipped — evidence: `docs/design/containers.md`, `docs/design/bus.md`

## 5. 网络暴露

一台原装设备的入站面是 443 上的 apid（加 80 上的重定向）——没有别的东西
为管理而监听，没有东西向外拨号，不存在机群或云通道。静态 UI 资源是公开
的；每一项设备数据和操作都在 API 凭据边界之后。

> status: shipped — evidence: `docs/design/remote-management.md`

### 5.1 防火墙工具，以及并不存在的那道防火墙

每一个镜像都**同时**随附 `nft` 和 `iptables`。两者都是基座包的依赖，所以即使
一次构建放弃了容器，它们也都在。**镜像交付的是工具，不是策略：没有默认规则集，
没有放行或拒绝清单，也没有任何东西替你管理规则。**它们没有 API，也没有控制台
界面；`ssh` 加上这两条命令就是全部。

**优先用 `nft`。**它是设备实际行为的完整视图，也是本产品将来一旦交付策略时所
使用的语汇。`iptables` 在这里是兼容路径——给那些不会说 nft 的第三方工具和既有
脚本用的——而不是与前者对等的另一个选择。

关于它们有五件事，因为每一件不说清楚都会让人意外。

**`nft list ruleset` 是完整视图，`iptables -S` 不是。**两个工具编程的是同一套
内核子系统 `nf_tables`。`nft list ruleset` 打印其中的全部：你通过任一工具添加的
规则，以及容器网络驱动为自己写下的表。`iptables -S` 只打印经由 `iptables` 前端
进来的东西，范围是该前端自己拥有的那几张表。在一台跑着容器的设备上，把
`iptables -S` 读作"这台机器上的防火墙"是错的——而且用它找不到的规则，并不能作为
该规则不存在的证据。

**这里的 `iptables` 是 `iptables-nft`。**在 Debian trixie 上，`iptables` 命令是
同一套 `nf_tables` 子系统之上的翻译层，不是旧的 xtables 路径，也不是第二道防火
墙；`iptables --version` 自己会说：它打印 `(nf_tables)`。它创建的规则是真正的
`nf_tables` 规则，落在它自己的表里。旧版二进制（`iptables-legacy` 及其
save/restore 一对，背后是 `xtables-legacy-multi`）确实在镜像里，因为同一个
Debian 包就带着它们，而**镜像里没有任何东西选中它们**：alternatives 组保持在
auto 模式，其中 nft 前端的优先级高于旧版，并且这里没有任何单元、脚本或 postinst
运行 `update-alternatives`。手工切到旧版，会把你的规则放进第二套、更老的内核规则
存储里，而设备上没有别的东西会去读它——`nft` 不会，容器驱动也不会。

**容器驱动的表属于容器驱动。**它们通过 `nft` 可见，通过 `iptables` 不可见，而且
驱动会持续调谐这些表：你手工改动其中的规则，就是在和一个调谐器较劲，改动会被
重写。要加规则，请加在你自己的链里。

**两个工具都不会持久化任何东西。**运行时添加的规则只活在内核里，下次重启就没了。
镜像里没有 `netfilter-persistent`，没有 `iptables-save` 单元，也没有任何东西会在
启动时载入一份规则集。有一个文件看起来像：`nftables` 包带来了
`/etc/nftables.conf` 和 `nftables.service`，而**本镜像刻意让那个单元保持禁用**，
用的是自己拥有的一份 preset，而不是靠"少放一个符号链接"。这一点在两个方向上都
重要——那个单元的 `ExecStart` 是 `nft -f /etc/nftables.conf`，而该配置以
`flush ruleset` 开头，所以一旦启用，它会在每次启动时清空容器网络的规则。而且那个
文件位于只读根上，所以它也不是你能放自己规则的地方。

**如果你要让一条规则熬过一次断电**，今天的路径是你自己的单元：写一个重新施加
规则的服务，像任何原生应用那样装进可写的单元目录
`/usr/local/lib/systemd/system`（[applications.md](applications.md)）。这是对
产品当下行为的陈述，不是关于该如何运行防火墙的建议。

> status: shipped — evidence: `rootfs/packages-src/system/control/mos-system.control`, `verify/src/checks-firewall.ts`

## 6. 安全生命周期

生命周期如今被写了下来：产品里的每一份凭据，连同它的负责角色与轮换程序；
发布渠道与签名程序；带分诊与修复目标的严重级别；公告发布；事件响应；以及
支持窗口与生命周期终止。每一节都写明自己的成熟度，而不是暗示它已被强制。
板卡在一份提交进仓库的证据文件里携带启动保障声明，发布门禁读的是那份文件，
不允许一个发布版自称等级。

> status: shipped — evidence: `docs/design/security-lifecycle.md`, `boards/cx3576/evidence.json`

**其中没有任何一条响应渠道已经存在，这一点应当直接告诉审计者。**仓库根目录
没有公开的安全联系方式与披露政策，没有公告源，没有事件通知路径，也没有任何
工具强制支持窗口或修复目标——今天的报告私下抵达维护者，逐案处理。工厂身份
注入、工厂记录与调试/熔丝策略同样是"已设计、未构建"
（[manufacturing.md](manufacturing.md)）。官方站点的公告简报是
[../../website/security.md](../../website/security.md)；本页就是诚实的清单。

> status: unsupported
