# 安全

当前系统用启动、不可变内容、发布元数据三个独立信任域进行认证。开发镜像显式
使用测试密钥；不宣称硬件根信任链或 DATA 加密。

## 1. 运行时完整性

原生 init 认证选定部署，内核要求 root 和 support 的 verity 根哈希签名。
读取时逐块校验，尚未读取的潜在损坏在访问时发现；匹配模块在服务启动前只读挂载。
根及 `/var` 父目录骨架保持只读，只有明确允许的叶目录绑定 DATA 或有边界的易失存储。

在对应强制验证固件和锚可信时，UEFI Secure Boot 或必需的 FIT 签名保护内核和早期
策略。这与认证硬件的每一个可变启动阶段是不同的保证。

> status: shipped — evidence: `pkgs/mos-deploy/src/bin/mos-init.rs`, `docs/design/ro-root.md`, `docs/design/release-signing.md`

## 2. 更新真实性及密钥生命周期

更新器在暂存前检查签名部署/目录、板卡身份和确切对象字节，保留当前与回退对象，
持久化写入后才发布候选，并通过健康门确认。引导固件是独立签名维护产物。
目录有效期约束获取，不使已安装部署的离线启动失效。

元数据锚嵌入已认证内核策略，修改更新源或渠道不能替换它们。内容锚的重叠或移除
通过新内核包交付；启动密钥轮换属于启动信任/固件域。每次轮换必须保留可用组合。
不保留历史格式读取器或旧布局迁移。

`GET /api/v1/system/info` 报告出厂开发标记及其域，这是来源信息，不证明活动固件
正在强制验证。更新状态另报启动/内容验证回执。构建不会隐式生成密钥，签名输入
必须显式提供。

> status: shipped — evidence: `pkgs/mos-deploy/src/acquisition.rs`, `pkgs/mos-deploy/src/deployments.rs`, `docs/design/release-signing.md`

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

关于它们有六件事，因为每一件不说清楚都会让人意外。

**`iptables` 的扩展集合是有界的，而且每块板子都一样。**一条规则若点名了内核未
编入的匹配或目标，会被直接拒绝，并且指名道姓：

```
# iptables -t nat -A PREROUTING -p tcp --dport 80 -j REDIRECT --to-ports 8080
Warning: Extension REDIRECT revision 0 not supported, missing kernel module?
```

这不是翻译失败，重试也没有用——该扩展根本不在这个内核里；新增一个是内核改动，
不是装个包。

**每块板子都保证可用**，因为共享内核下限把它们钉住了：目标 `MASQUERADE`、
`REDIRECT`、`SNAT`、`DNAT`、`MARK`、`CHECKSUM`、`CT --notrack`；匹配
`addrtype`、`conntrack`、`state`、`mark`；纯裁决（`ACCEPT`、`DROP`、`RETURN`、
跳转）与内建匹配（`-p`、`--dport`、`-i`、`-o`、`--tcp-flags`）；以及两个地址族
各自的四张表 `filter`、`nat`、`mangle`、`raw`。在 2026-09-04 之前，`REDIRECT`、
`CHECKSUM` 和 `CT` 在 arm64 板上可用、在 x64 上被拒绝——下限取代的正是那种不
对称。

**这个集合之外的东西，依赖它之前请先问，并且不要假设两块板子答得一样。**
2026-09-04 实测，仍有四个扩展存在差异，而且方向并不一致：

| | x64 | arm64（cx3576） |
|---|---|---|
| `-m multiport`、`-m comment`、`-j CT --zone` | 拒绝 | 可用 |
| `-j LOG` | 可用 | **拒绝** |

`-m limit` 与 `-m iprange` 在**两块板子上都**被拒绝。`-j REJECT` 与 `-j TCPMSS`
今天在两块板上都可用，但下限并没有钉住它们，所以请当作惯例而非契约。如果你的
脚本需要其中任何一个，请提出来——产品究竟保证哪些，是一个尚待决定的问题，不是
疏漏。

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

> status: shipped — evidence: `rootfs/packages-src/system/control/mos-system.control`, `boards/common/mos-required.fragment`, `verify/src/checks-firewall.ts`

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
