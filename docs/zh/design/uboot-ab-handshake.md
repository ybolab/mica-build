# 设计：U-Boot A/B 握手 —— 定制主线 U-Boot 的契约

> [English](../../design/uboot-ab-handshake.md) | 中文
>
> systemd 基座上的 A/B 更新契约。英文版篇幅很大，含完整的 defconfig 清单、
> `boot.cmd` 全文与验收清单；本文是它的中文概览。

## 0. 范围与证据规则

英文版对每条断言标注了它是**测量得来**还是**推理得来**。这条纪律是本文的基础：
一段没有日期的设计文字并不构成机制存在的证据。

## 1. 现状基线

厂商 U-Boot 的默认配置**不满足** A/B 所需：环境不持久（`ENV_IS_NOWHERE`），
没有冗余环境，没有 bootcount 限制。这些都必须由 mos 的构建补上。

## 2. 主线 RK3576 支持状况

## 3. 存储契约 —— 不可协商

**持久环境是 eMMC 用户区里的一对冗余副本**：`uenv-a` 在 16 MiB（GPT p1），
`uenv-b` 在 17 MiB（GPT p2），各 64 KiB。这里的偏移是**进入 mmc 0 用户区的绝对字节偏移**，
恰好就是 A/B-layout 放置 p1/p2 的位置。

Linux 侧通过 `/etc/fw_env.config` 访问同一份环境，该文件**由板卡定义生成，不得手改**。
**两行设备记录 == 冗余环境**，两个副本都必须列出。

有几个配置项必须**保持关闭**，否则会把环境从 `ENV_OFFSET` 挪走：
`CONFIG_ENV_MMC_USE_DT`、`CONFIG_ENV_MMC_USE_SW_PARTITION`、`CONFIG_PARTITION_TYPE_GUID`。

## 4. 环境变量契约

`BOOT_ORDER` 加上每槽位的 `BOOT_<slot>_LEFT` 计数。**`setexpr` 是十六进制的**，
而这也正是 RAUC 用于 `BOOT_x_LEFT` 的基数；把 `boot-attempts` 保持在 1..9 以内。

## 5. 槽位选择逻辑

`boot.cmd` 编译成 `boot.scr`，由装配器写入**两个** boot 分区，两份完全相同——
因为跑起来的那一份可能要引导任一槽位。流程：

1. 只在环境是全新的时候套用默认值。
2. 在 `BOOT_ORDER` 里挑**最左边仍有额度**的槽位。
3. **哪里都没额度**：重新灌满、持久化、重启。
4. **在引导之前持久化这次递减** —— 这才是让它成为看门狗的关键。
   一次未持久化的递减会把整个方案悄悄降级成「永远重试」：每次复位都从旧计数开始，
   于是一个永远到不了 mark-good 的槽位会被无休止地重试，而不是回滚。
   `saveenv` 的结果改变不了接下来发生什么（内核要么起来要么不起来），
   但**一次失败的环境写入绝不能是静默的**——那是看门狗在给自己卸弹，而控制台那行是唯一的目击者。
5. 从所选槽位的 boot 分区读取该槽的 verity 参数（`mos-verity-<slot>.env`）。
   **文件名带槽位**，因为一个 RAUC boot 载荷可以被装进任一 boot 分区。
6. `rauc.slot=` 是 RAUC 识别自己跑在哪个槽位的方式。**它无法从 `root=` 推导**：
   verity 设计让根成为一个 device-mapper 节点，而 RAUC 靠 bootname、槽位名或
   `realpath(device)` 匹配，`/dev/dm-0` 永远不可能是其中之一。
   **少了这一项**：`rauc status` 失败 → 健康闸永不执行 `mark-good` →
   U-Boot 在额度耗尽时回滚新槽位 —— 一次**在设备看起来健康的情况下自我回退**的更新。
7. `booti` 只在失败时返回：烧掉本槽剩余额度，让下次复位换一个槽位，
   而不是重试一个已知起不来的槽位。

**刻意不放 `extlinux/extlinux.conf`**：U-Boot 会先试 extlinux，放一个在那里就会绕过握手。

## 6. 经 U-Boot 环境传递 machine-id

## 7. 内核命令行 / dm-verity 启动契约

## 8. 验收与带机清单

## 9. 开放问题与风险

## 10. 需求汇总

两处**记录在案**的缺口：构建过程不签 SPL 和 U-Boot；镜像里不带生产 keyring。
`CONFIG_FIT_SIGNATURE` 在整棵树里没有任何地方被配置。
