# 安装

安装 mos 就是把一个完整磁盘镜像写到设备的存储上。镜像携带全部分区——
引导加载区、两个 A/B 槽，以及全新的 META、STATE 和 DATA 文件系统——因此
**安装是破坏性的：它替换目标磁盘上的一切**，包括之前的所有配置和数据。
如果设备之前扩展过 DATA 分区，在把硬件转交他人之前请注意
[recovery.md](recovery.md) 中的处置警告。

镜像如何到达磁盘是板卡事实。下面覆盖两块随附板卡；自带硬件的集成商应从
移植手册 [../../bsp/porting.md](../../bsp/porting.md) 和板卡契约
[../design/boards.md](../design/boards.md) 开始。

## 1. x64（通用 UEFI）

x64 镜像是面向任何 UEFI x86_64 机器的普通 GPT 磁盘镜像。用任何原始镜像
工具把它写到目标磁盘（例如从 live 系统里用 `dd`），或直接在 QEMU 里启动——
[quickstart.md](quickstart.md) 中的 QEMU 路径是经过测试的那条。固件找到
ESP，GRUB 选择活动槽；没有板卡侧烧写工具，因为没有任何板卡特定的东西
需要烧写。

> status: board-dependent — evidence: `boards/x64/board.env`, `boards/x64/grub.cfg`

## 2. cx3576（CX3576-Z，Rockchip RK3576）

cx3576 从 eMMC 启动，镜像通过 USB 走 Rockchip loader（"rockusb"）路径写入：

1. 让板卡进入 loader 模式——上电时按住 recovery 键，或者在已经运行 mos
   U-Boot 的设备上，启动失败会自动落入 rockusb。
2. 板卡通过 USB 连接后，用 Rockchip 主机烧写工具把
   `cx3576-mos-<epoch>.img` 写入 eMMC。
3. 重新上电。U-Boot 从扇区 64 启动，运行 A/B 启动脚本，引导槽 A。

这同一路径也是该板卡的最后手段恢复：它位于操作系统之下，在其他一切都不可
达时仍然可达。之前刷过 pre-A/B 镜像的板卡可能需要一次 maskrom 级重刷；
[../design/uboot-ab-handshake.md](../design/uboot-ab-handshake.md) 中的
bring-up 笔记覆盖了该情形。

> status: board-dependent — evidence: `boards/cx3576/board.env`, `docs/design/uboot-ab-handshake.md`

## 3. 刷写后的第一次启动做了什么

- **DATA 扩展到占满磁盘。**镜像只保留一小段尾部；`systemd-repart` 在首次
  启动时把 DATA 分区边界外移，文件系统随之扩展。有一个专门的测试
  （`make os-repart-test`）覆盖这件事，正因为扩展绝不能触碰引导加载区。
- **设备完成自我配置**——身份、主机名、每设备密钥、SSH 主机密钥——不需要
  网络。[first-run.md](first-run.md) 负责讲这件事。

> status: shipped — evidence: `make os-repart-test`, `docs/design/provisioning.md`

## 4. 尚不存在的东西

每个已发布板卡/profile 一条经过验证的客户安装旅程——前置条件、介质选择与
验证、状态指示、以及作为一个被测试过程的回到恢复路径——已在计划中但未
发布；上面的步骤是当前受支持的操作方法，不是那条完成的旅程。工厂侧安装
（预配置镜像、注入配置）属于同一份计划。

> status: proposed — evidence: `docs/plan/PLAN-046.md`

TODO(PLAN-046): revisit after this plan merges
