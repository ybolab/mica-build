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
