# 恢复

本页从自动发生的恢复排到代价最高的恢复，并对缺口直言不讳：一台设备终究
会需要的几条恢复流程已经设计但尚未构建，假装它们存在比缺口本身更糟。

## 1. 自动：坏槽回滚

失败的更新从不需要操作员。无法启动、或无法通过启动健康门的槽会耗尽其
启动额度，引导加载程序回到之前的槽——这是正常的、经过测试的路径，在
[update-rollback.md](update-rollback.md) 中描述。

> status: shipped — evidence: `docs/design/uboot-ab-handshake.md`, `rootfs/overlay/usr/lib/mos/mos-health`

## 2. 两个槽都失败：设备持续循环

当两个槽都没有剩余额度时，cx3576 启动脚本补满所有计数器并复位，设备
反复重启而不是彻底停摆。两个槽都坏掉的设备在操作员眼里的症状正是这个
重启循环，它的含义是：走下面的物理恢复路径。

> status: board-dependent — evidence: `boards/cx3576/boot.cmd`

## 3. 物理：整盘重刷

最后手段位于操作系统之下，在其他一切都不可达时仍然可达。在 cx3576 上
它是 Rockchip loader 路径（rockusb）——上电时按 recovery 键，或启动失败
时的自动落入——随后按 [install.md](install.md) 通过 USB 写入完整磁盘
镜像。在 x64 上，启动任意 live 介质并重写磁盘。

一次重刷付出什么，精确陈述：

- **STATE 被替换**——设置、管理员凭据、SSH 主机密钥、设备身份和密钥。
  设备回到首次启动并铸造新身份（[first-run.md](first-run.md)）。
- **DATA 被替换**——应用数据和 home 目录。
- **META 被替换**——更新簿记。
- **扩展出的 DATA 块是不可达，不是被抹除。**刷入的镜像比磁盘小；重刷
  只写镜像自身的范围，之外的块保留旧内容且无人引用。要处置或转交给
  他人的设备需要的是介质擦除，不是重刷。

> status: board-dependent — evidence: `docs/design/access.md`, `boards/cx3576/board.env`

## 4. 凭据丢失：没有软件路径可以回去

同时丢失管理员（Web）凭据**和**所有已授权 SSH 密钥的操作员，无法通过
软件回到设备里。API 是唯一能重新启用访问的东西，而它需要凭据；SSH 关闭
或没有密钥；串口控制台显示登录提示，但没有任何账户接受密码。这是凭据
模型的刻意性质——凭据在更新中保留，因此更新不是后门——其代价是：从凭据
全部丢失中恢复，就是上面的整盘重刷，连同它的一切成本。

带物理在场的管理员凭据恢复——一个轮换而非泄露的设计流程——已在计划中，
尚未构建。

> status: shipped — evidence: `docs/design/access.md`

## 5. 恢复出厂设置：未实现

今天没有恢复出厂设置操作——没有按钮，没有 API 动作，没有控制台咒语。
擦除 STATE 会让设备回到首次启动（配置设计就是这样写的），但已发布系统中
没有任何东西执行那次擦除。最接近的真实操作是第 3 节的整盘重刷，它严格
更具破坏性。

规划中的恢复工作显式定义缺失的层级——作为有防护操作员动作的手动槽回滚、
带最小故障记录收集的每板卡恢复 runbook、凭据恢复、配置重置、应用数据
重置、完整出厂重置与安全擦除，每一项都写明确切影响——并让被打断的恢复
可以重放。

> status: proposed — evidence: `docs/plan/PLAN-048.md`

TODO(PLAN-048): revisit after this plan merges

## 6. 恢复之前：先收集证据

如果设备还能启动进任一槽，在重刷之前先捕获
[troubleshooting.md](troubleshooting.md) 列出的东西（journal、更新状态、
`/usr/share/mos/manifest.tsv` 中的设备身份）——重刷会把证据连同故障一起
销毁。
