# 发布签名：生产密钥仪式

> [English](../../design/release-signing.md) | 中文
>
> 状态：**runbook**。工具链已能接受真实密钥。英文版含可直接执行的完整命令序列；
> **真要做仪式请照英文版执行**，本文是它的中文说明。

## 0. 怎么读这份文档

标了 **[runbook]** 的章节是可执行的步骤序列。其中有一处**已点名的缺口**（见第 2 节）。

## 1. TUF root 仪式

四把 ed25519 角色密钥，**root 离线**。元数据锁定 bundle 的 sha256、长度与 verity 根哈希。

- **轮换**：新密钥接管期间，**两把密钥同时签名**。
- **年度续期**：同一把密钥，更晚的过期时间，**信任锚不变**。
- **轮换之后最要紧的一条**：**旧的信任锚必须仍能走到仓库**，自行前滚到 root v\<n\>。
  这就是重叠窗口。同时也要为此后配备的设备准备新锚。

## 2. RAUC 生产 CA —— 仪式是 runbook，但有一处已点名的缺口

- **CA**：RSA（PKCS#1 v1.5 确定性签名），**4096 位**——这把密钥必须比它签过的每一台设备活得久。
  `CA:TRUE pathlen:0`，它只签签名者证书，不签更下面的东西。
  **有效期 15 年**：烤进现场设备的 keyring 在缺少配备通道的情况下现实中永不更换，
  所以 CA 必须比整个机队活得久——**一个过期的烤入 keyring 会同时让每一台设备的更新变砖**。
- **签名者**：短有效期（2 年），因为重签一个签名者很便宜——它只需要 CA 密钥，
  不需要一次机队更新：设备信任的是 CA，所以新签名者的链不必碰任何 keyring。
- **刻意不设 `extendedKeyUsage`**：RAUC 通过 OpenSSL 的 S/MIME 用途检查来验证，
  该检查接受「无 EKU」，却**拒绝**「有 codeSigning 而无 emailProtection」。
  要收紧就得同时改 `system.conf` 的 `[keyring] check-purpose=`，两者必须**同一个提交**。

**信任根入口**：仓库根目录的 `meta/rauc/` 是 CA 进入构建的唯一入口（`meta/`
已 gitignore）。把这份 runbook 产出的 CA 放进 `meta/rauc/` 再构建，`build`
就用它签 bundle，`rootfs/build.sh` 把 `meta/rauc/ca.cert.pem` 放进镜像的
`/etc/rauc/keyring.pem`。`meta/` 为空时构建会自动生成一套开发级信任根并留下
`meta/GENERATED` 标记（其中写明生成了哪些域），构建据此发出醒目警告；生产材料
不带这个标记。

**算法是声明出来的值**：每个密钥角色用什么签名算法写在
`pkgs/rauc/key-algorithms.env` 里，仪式与生成器需要一致的是**允许集合**而不是
默认值——RAUC 两个角色的集合是 `ecdsa-p256`、`ecdsa-p384`、`rsa-3072`、
`rsa-4096`，由 RAUC 自己的验证器（OpenSSL 的 CMS 实现）界定。`rootfs/build.sh`
会拒绝集合以外的声明值，也会拒绝 `meta/` 里超出集合的材料。

**缺口**：没有把新信任锚配备到**已部署**设备的通道。`/etc` 是只读 squashfs，
轮换 keyring 目前只能靠重新刷写镜像。

## 3. 签名一次发布

1. 构建 prod profile 的根文件系统与镜像输入。
2. 构建并对 bundle 做 **CMS 签名**。调用方提供的 CERT/KEY/KEYRING 在主机与容器两条构建路径上
   **都优先于**开发密钥默认值——在此修复之前两条分支都硬编码了 `.devkeys`，
   导致**根本无法构建任何生产 bundle**。KEYRING 也用于脚本自身的回读验证，
   所以在这里传入生产 `ca.cert.pem`，同时就是对整条链的第一次端到端检查。
3. 用在线密钥发布进 TUF 仓库。verity 根哈希是 bundle 自己的（verity 格式）根哈希，
   按 `rauc info` 报告的值**显式传入**——签名工具从不去 shell 调用 rauc。
4. **像客户端那样**验证已发布的仓库：对着第 1.5 节的仪式信任锚，
   **绝不对着仓库自己的 `root.json`**。`--datastore` 会持久化已信任的元数据，
   于是**下一次**发布的验证同时也证明了两次之间没有发生回滚。

### 3.1 设备侧更新客户端 —— **[runbook]**；已随镜像交付并由 mosd 驱动

`rauc-update`（同一 crate）消费第 3 节发布的内容。它沿用
`rauc-verify` 的验证流程——固定的 root、持久化的回滚状态——并在其上增加传输与策略；
任何子命令都没有跳过元数据或摘要验证的选项。设备上的操作顺序（也可用于工作台 shell）如下：

```sh
# 1. 通过普通 HTTP 镜像元数据（也可用 rsync 同步仓库并跳过此步）。
#    镜像内容是不可信输入；第 2 步负责信任或拒绝它。
rauc-update sync --url http://mirror.example/tuf --repo /var/lib/mos/tuf-mirror

# 2. 从固定的信任锚验证，并选择最新的兼容目标：
#    board+profile（身份见下文）、channel（默认 stable）、manifest
#    schema floor（必须等于 1）、版本必须严格高于正在运行的版本。
#    每个被拒绝的候选都会打印原因；没有候选时以 2 退出。
#    降级必须传 --allow-downgrade，并记录到 stderr。
rauc-update check \
  --repo /var/lib/mos/tuf-mirror --root <pinned root.json> --state <state.json>

# 3. 探测 /mos/updates 工作区（DATA 已挂载、可写且未耗尽；否则以 3 退出，
#    并输出一行 `<status> <kind>: ...`），然后用 HTTP range request 断点续传到
#    /mos/updates/downloads。完成后的总大小与工作区已有内容之和绝不超过
#    --max-bytes；摘要不匹配会删除部分文件；验证后的 bundle 会重命名到
#    /mos/updates/verified，且其路径是 stdout 的最后一行。不存在改用其他暂存位置的选项。
rauc-update fetch \
  --repo /var/lib/mos/tuf-mirror --root <pinned root.json> --state <state.json> \
  --url http://mirror.example/tuf --max-bytes <n>

# 4. 交接安装。编排路径是 mosd 的 D-Bus 成员：
busctl call com.mos.mosd /com/mos/mosd com.mos.mosd1 InstallUpdate s <path>
#    直接回退路径（也是 `rauc-update fetch --install` 执行的命令）：
rauc install <path>
```

两个二进制都随镜像交付。`mos-rauc-update` 包
（`pkgs/rauc-sign/deb/rauc-update`）通过 `feature-rauc.pkgs` 在两个板型上安装
`/usr/bin/rauc-update` 和 `/usr/bin/rauc-verify`；因此，关闭 `rauc` 功能时，
客户端也会与其所调用的安装器一并关闭。发布侧的 `rauc-sign` 不在这个包里，
以后也不会加入：它加载离线密钥，并在第 1 节所述环境中运行。

设备身份来自 `/usr/share/mos/release-identity.env`
（`BOARD=`/`PROFILE=`/`VERSION=`）或显式的
`--board`/`--profile`/`--current-version` 参数。镜像流水线会写入该文件：
`rootfs/compose/compose-install.sh` 使用板型、profile 和组合时传入的 pool version
生成这三行。它们都只来自构建参数，因此同一源码树的两次构建会各自写入对应文件。
verify 的 `packed-release-identity` 会拒绝其中内容与镜像板型、profile 标记或
`/usr/share/mos/manifest.tsv` 不一致的镜像。

这里的 `VERSION` 是 **pool version**——
`<workspace version>+git<commit>[.dirty]-1`，即 `build-env/deb/version.sh`
打印的字符串——不是市场发布版本。它是镜像构建能够测量的自身版本；第 3 节签名
manifest 中的发布版本在构建 bundle 时才选定，镜像输入中没有它。因此，版本选择中的
`compare_versions` 按 `.` 分段，在两侧都能解析时按数值比较；发布为 `1.0.0` 的版本会高于
`0.1.0+git…-1` 并被提供，而同一个 workspace version 的不同提交构建会比较为相等——
这样的 bundle 除非传入 `--allow-downgrade`，否则会被当成降级。把设备身份绑定到真正的
发布版本仍有待完成，并且与决定发布版本从哪里进入镜像构建是同一个问题。

以上流程已不再等待操作员触发：mosd 驱动该客户端。更新生命周期以有界子进程执行
`rauc-update probe`/`sync`/`check`/`fetch`，策略文件
`/var/lib/mos/update-policy.toml` 设置自动检查周期（`docs/design/updates.md`）。
数据去向不是可选参数，而是 PLAN-061 在 PLAN-063 布局上的约定：部分下载只能位于
`/mos/updates/downloads`，完整验证的 bundle 通过同文件系统的一次重命名进入
`/mos/updates/verified`，事务临时文件位于 `/mos/updates/staging`，RAUC 只能接收
`verified/` 中的路径。`mos-data-layout` 在 DATA pool 上创建工作区；客户端会在写入第一个
字节前探测它（挂载源解析到 `/mnt/data`、无符号链接替换、非只读、私有探测文件完成写入
和删除、pool 空间满足预算），不满足时返回具名的 `unavailable`/`degraded` 结论，
绝不写入其他位置（`updates.md` §1.1）。镜像侧仍欠三项契约：没有机制配备固定的
`root.json`（见 §2.5 最后一段）；没有机制配备策略默认用于元数据镜像和回滚状态的
`/var/lib/mos/update/` 树；`mos-health` 尚未报告 `health.boot`，所以生命周期无法越过
`validating`。`--max-bytes` 能从 pool 承诺多少空间属于 PLAN-049 的存储策略决策；客户端
只负责拒绝超过预算或 pool 明显无法容纳的下载。

传输刻意采用普通 HTTP：完整性与真实性来自签名元数据（恶意镜像只会导致拒绝），
不提供机密性；若需要机密性，应在本地代理终止 TLS，或通过带外方式同步仓库。

### 3.2 离线 lockbox —— **[runbook]**

用于没有网络路径的设备。在发布主机上，把完整元数据集和指定 bundle 及其固定的
manifest 写入 USB/SD；未指定目标时包含所有目标。此命令只复制文件，不读取任何密钥：

```sh
rauc-sign lockbox --repo <repo> --out /media/usb/lockbox \
  --target mos-cx3576-<epoch>.raucb
```

在设备上挂载介质后执行：

```sh
rauc-update import \
  --lockbox /media/usb/lockbox --root <pinned root.json> --state <state.json> \
  --max-bytes <n>
```

`import` 与在线路径执行完全相同的验证——同一个固定信任锚、同一个回滚状态、
同一套目标选择、摘要门和工作区探测——然后经 `/mos/updates/staging` 复制 bundle，
再放入 `/mos/updates/verified`；后者才是可安装路径，绝不直接安装介质上的文件。
携带陈旧元数据的 lockbox 会被状态文件拒绝，遭篡改的 bundle 会被摘要拒绝，
不存在绕过任一检查的导入方式。lockbox 中的元数据按原样携带，不会让任何密钥离开
第 1.5 节的保管边界；因此，部分 lockbox 会列出它未携带的目标：`import` 验证它实际
选择的目标，只有完整 lockbox 才能整体通过 `rauc-sign verify`。

## 4. 绝不发生的事

一次发布由**两套互不相关的体系各签一次**，这种分离正是要点：
**TUF 的在线密钥签不了 bundle，bundle 的密钥也签不了元数据。**
