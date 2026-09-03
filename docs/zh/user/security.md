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

已点名的缺口：

- **还没有任何地方配备生产密钥。**未提供材料的构建生成开发级信任根并
  打上标记；镜像验证器会让开发密钥环镜像失败，除非显式豁免为台架镜像。
  任何带开发密钥环的镜像都不应离开工作台。
- **已部署设备上没有密钥环轮换渠道**——替换在役设备上的信任锚，目前
  意味着一个由正被替换的那把密钥签名的镜像。
- **设备侧 TUF 验证器已发布，它的信任锚没有。**`rauc-verify` 与
  `rauc-update` 在镜像里，从一个固定的根开始走发布元数据；但没有任何镜像
  预置那个根，所以在操作员补上它之前，这条验证路径没有起点
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

每一个镜像都随附 `iptables`。它是基座包的依赖，所以即使一次构建放弃了容器，
它也在。此前并非如此：镜像里唯一的防火墙前端是 `nft`，而那是随容器引擎一起
到来的。**镜像交付的是工具，不是策略：没有默认规则集，没有放行或拒绝清单，
也没有任何东西替你管理规则。**它没有 API，也没有控制台界面；`ssh` 加上这条
命令就是全部。

关于它有三件事，因为每一件不说清楚都会让人意外。

**它是 `iptables-nft`。**在 Debian trixie 上，`iptables` 命令是同一套
`nf_tables` 内核子系统之上的前端——容器网络驱动编程的也是这套子系统——而不是
旧的 xtables 路径。`iptables --version` 自己会说：它打印 `(nf_tables)`。旧版
二进制（`iptables-legacy` 及其 save/restore 一对，背后是
`xtables-legacy-multi`）确实在镜像里，因为同一个 Debian 包就带着它们，而
**镜像里没有任何东西选中它们**：alternatives 组保持在 auto 模式，其中 nft 前端
的优先级高于旧版，并且这里没有任何单元、脚本或 postinst 运行
`update-alternatives`。手工切到旧版，会把你的规则放进第二套、更老的内核规则
存储里，而设备上没有别的东西会去读它。

**有容器时，两个前端写同一个后端——而它们互相看到的并不一样。**`iptables -S`
列出 `iptables` 前端所创建的东西，范围是它自己拥有的那几张表。`nft list
ruleset` 列出整个 `nf_tables` 子系统，包括容器网络驱动写入的 `netavark` 表。
**`nft list ruleset` 才是完整视图**；`iptables -S` 不是，用前者找不到的规则并
不能作为它不存在的证据。容器驱动的表属于容器驱动：它会持续调谐这些表，所以你
手工改动其中的规则，就是在和一个调谐器较劲，改动会被重写。要加规则，请加在你
自己的链里。（`nft` 本身只随容器引擎进入镜像，所以在没有容器的设备上，
`iptables -S` 就是你拥有的视图。）

**没有任何东西会被持久化。**运行时添加的规则只活在内核里，下次重启就没了。
镜像里没有 `netfilter-persistent`，没有 `iptables-save` 单元，没有任何规则
文件，而且根文件系统本来就是只读的。如果今天你要让一条规则熬过一次断电，路径
是你自己的单元：写一个重新施加规则的服务，像任何原生应用那样装进可写的单元
目录 `/usr/local/lib/systemd/system`（[applications.md](applications.md)）。
这是对产品当下行为的陈述，不是关于该如何运行防火墙的建议。

> status: shipped — evidence: `rootfs/packages-src/system/control/mos-system.control`, `verify/src/checks-iptables.ts`

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
