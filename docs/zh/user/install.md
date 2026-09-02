# 安装

安装 mos 就是把一个完整磁盘镜像写到设备的存储上。镜像携带全部分区——引导
加载区、两个 A/B 槽，以及全新的 META、STATE 和 DATA 文件系统——因此
**安装是破坏性的：它替换目标磁盘上的一切**，包括之前的配置、凭据和应用
数据。不存在从运行中的系统就地升级到全新安装的路径；已经在跑 mos 的设备
走的是 [update-rollback.md](update-rollback.md)，不是本页。

本页是按板卡和 profile 划分的安装旅程：选择产物、验证它、烧写它、抵达首次
启动、识别"它成功了"，以及在它没成功时如何回到恢复路径。本页只写这个仓库
能证明的东西。**本页没有任何一次安装是在物理硬件上执行过的**——cx3576
板卡档案里每一条依赖硬件的验收行都是 `not tested`，x64 的证据只有 QEMU 和
CI。第 7 节会按步骤把这条边界再讲一遍，好让略读的读者也不会误解。

## 1. 选择产物

三个维度，都在构建时固定，之后都不可选：

- **板卡**——一个镜像只为一块板卡构建，在别的板卡上不会启动。现有两块板卡：
  `cx3576`（CX3576-Z，Rockchip RK3576，arm64）和 `x64`（通用 UEFI
  x86_64）。
- **Profile**——`dev` 或 `prod`，不可变地写进 verity 根。两者都默认关闭
  SSH；prod 镜像还不带控制台 shell。
- **版本**——镜像以构建 epoch 命名。发布版的选择与组成由
  [download.md](download.md) 负责。

你要的产物是 `_out/<board>/<board>-mos-<epoch>.img`，或旁边的
`<board>-mos-latest.img` 符号链接。

> status: board-dependent — evidence: `boards/cx3576/board.env`, `boards/x64/board.env`, `rootfs/packages-src/profile`

## 2. 写入之前先验证

今天没有随镜像发布的校验和或签名文件（[download.md](download.md) 第 4 节
点名了这个缺口）。存在并且应该跑的是镜像契约检查：它打开装配好的镜像，
逐项断言分区表、槽内载荷、verity 参数和信任材料，红的那一项会说明它读到了
什么、期望什么。

```sh
make os-verify-cx3576                        # cx3576
bash verify/run.sh --verify --board x64      # x64
```

不要跳过 keyring 的判定。构建时找不到签名材料会生成开发信任根，验证器会
报出它读到的等级；**开发 keyring 的镜像是台架镜像，不得烧进任何会离开你
桌面的设备**（`docs/design/manufacturing.md` 第 1 节把这条写成了工厂规则）。

> status: shipped — evidence: `make os-verify-cx3576`, `verify/run.sh`

## 3. 明白这次写入会毁掉什么

在任何板卡上写下第一个字节之前：

- **目标磁盘上的每个分区都会被替换。**设置、管理员凭据、SSH 主机密钥、
  设备身份和每设备密钥都在 STATE 上，没了。应用数据和操作者文件在 DATA
  上，没了。更新记账在 META 上，没了。
- **设备会拿到一个新身份。**身份是首次启动时在设备上抽取的，永不重新签发，
  所以回来的这台是另一台设备，任何按 `deviceId` 记录它的系统都对不上了
  （`docs/design/manufacturing.md` 第 5 节）。车队侧记录必须人工重新关联。
- **重刷不等于擦除。**上一次首次启动时 DATA 已经扩展到镜像范围之外；把
  镜像写回去只覆盖它自己的范围，超出部分的块保留原内容，只是新文件系统
  不再引用它们。要处置、转售或退回的设备需要销毁介质，而不是重刷——
  [recovery.md](recovery.md) 第 6 节是这条规则的正文，这里只是指路。
- **先收集证据。**如果设备还能启动，先按
  [troubleshooting.md](troubleshooting.md) 收集，再烧写；烧写会把故障连同
  其他一切一起销毁。

> status: shipped — evidence: `docs/design/access.md`, `docs/design/manufacturing.md`

## 4. x64（通用 UEFI）

x64 镜像是面向任何 UEFI x86_64 机器的普通 GPT 磁盘镜像。固件找到 ESP，
GRUB 选择活动槽；没有板卡侧烧写工具，因为没有任何板卡特定的东西需要烧写。

**在 QEMU 里——经过测试的那条路。**测试装置启动构建出的镜像，转发 apid 的
HTTPS 端口，通过真实套接字驱动管理 API。它既是启动 x64 镜像的受支持方式，
也是 API 验收套件：

```sh
bash pkgs/mosd/tests/apid-api/run.sh --dry-run   # 只检查前置条件
bash pkgs/mosd/tests/apid-api/run.sh             # 启动并跑套件
```

> status: shipped — evidence: `pkgs/mosd/tests/apid-api/run.sh`, `boards/x64/grub.cfg`

**在物理 UEFI 机器上。**在目标机上启动任意 live 介质，用原始镜像工具
（`dd` 或等价物）把镜像写到整盘，然后重新上电从内置磁盘启动。mos 既不配置
固件也不配置它的启动菜单：机器从哪个设备启动、Secure Boot 是否接受这个
镜像，都是平台所有者的设置，mos 对此不作任何声明。**这条路径从本仓库出发
从未在物理机器上跑过**；它就是 QEMU 那条路换了介质位置，没有任何板卡档案
记录过它在哪台机器上成功过。

> status: board-dependent — evidence: `boards/x64/board.env`

## 5. cx3576（CX3576-Z，Rockchip RK3576）

cx3576 从 eMMC 启动，镜像通过 USB 走 Rockchip loader（"rockusb"）路径写入：

1. **进入 loader 模式。**上电时按住 recovery 键。在已经运行 mos U-Boot 的
   板卡上，找不到可用槽的启动会自己落入 rockusb。
2. **写入镜像。**板卡通过 USB 连接后，用 `rkdeveloptool` 把
   `cx3576-mos-<epoch>.img` 写入 eMMC；BSP Makefile 里的 flash 目标是这一步
   的驱动形式。
3. **重新上电。**U-Boot 从扇区 64 启动，带着每槽尝试计数器走 `BOOT_ORDER`，
   引导槽 A。

如果 loader 区本身不可启动——刷过 pre-A/B 镜像的板卡，或一次被打断的 loader
写入——BootROM 会通过 USB 呈现 **maskrom**，`rkdeveloptool` 从那里重刷。
这是最后手段，也是工厂烧写路径。

两种进入 loader 模式的入口都在树里，也都没有在台架单元上作为安装流程被
执行过：板卡档案的 Recovery method 一节描述了它们，而它的验收矩阵里
`Recovery` 一行是 `not tested`。

> status: board-dependent — evidence: `boards/cx3576/bsp/Makefile`, `boards/cx3576/boot.cmd`, `docs/bsp/cx3576-example.md`

## 6. 首次启动，以及"它成功了"长什么样

从空 STATE 的首次启动在没有任何网络的情况下做三件事：

- **DATA 扩展到占满磁盘。**镜像只保留一小段尾部；`systemd-repart` 把 DATA
  边界外移，文件系统随之扩展。扩展是单向的，没有东西会把它缩回去。
- **设备完成自我配置**——设备 id、主机名、每设备密钥、SSH 主机密钥——全都
  在设备上生成，没有一样烤进镜像。[first-run.md](first-run.md) 负责讲这件
  事，包括可以在这一步之前预置配置的离线配置文档。
- **健康闸运行。**它探测 systemd、mosd 和 apid，全部通过时才确认已启动的槽
  并给它重新充满启动信用。

一次成功的安装是可观察的，按这个顺序：

| 检查 | 在哪看 | 好的结果是什么 |
|---|---|---|
| 引导加载器选了一个槽 | 串口控制台（cx3576）或外接显示器（x64） | 一行 `mos: booting slot …`，没有反复复位 |
| 这次启动被确认了 | `journalctl -u mos-health` | 每一项探测都通过，确认动作跑了 |
| 设备给自己命名了 | DHCP 服务器的租约列表，或控制台上的 `hostnamectl` | 形如 `mos-xxxxxxxx` 的主机名 |
| 管理面在应答 | `https://<address>/api/v1/session` | 尚未被认领的设备返回 `state: "setup"` |
| 控制台可达 | `https://<address>/_ui/` | 设置界面，前面挡着一个首次访问必然出现的自签名证书警告 |

一直复位而没有稳定下来的设备并没有装好：去
[recovery.md](recovery.md) 第 2 节，那里解读这个症状。

> status: shipped — evidence: `make os-repart-test`, `rootfs/overlay/usr/lib/mos/mos-health`, `pkgs/mosd/apid/openapi.json`

## 7. 如何回到恢复路径，以及哪些没有被证明

**每块板卡的退路**就是你安装时用的那条传输通道，它位于操作系统之下：

- **cx3576**——上电时按 recovery 键，或者没有槽能启动时自动落入 rockusb；
  loader 区也没了时用 maskrom。这些能挺过死掉的 rootfs 和损坏的引导环境。
- **x64**——没有带内 loader 模式。退路是平台自己的启动菜单加另一份介质，
  或者把磁盘拿到另一台机器上。

**上面没有一步在硬件上做过。**这条安装旅程是从代码树和 QEMU 写出来的：
x64 的 QEMU 启动和它的 API 套件在 CI 里跑，repart 扩展逻辑和 U-Boot 握手
脚本各有一个主机侧测试，这些都不是一台烧过的板子。没有任何板卡档案的行
记录过在物理硬件上执行的安装、首次启动或恢复入口。请把本页每一步都当作
等待在第一台台架单元上验证的流程，并把结果记进板卡档案
（`docs/bsp/qualification.md` 第 12 行是恢复入口的落点）。

> status: board-dependent — evidence: `docs/bsp/qualification.md`, `docs/bsp/cx3576-example.md`

## 8. 工厂侧安装

在制造环节注入配置不是上面步骤的一个变体：它是配置文档，在烧写后的首次
启动时应用，由 [first-run.md](first-run.md) 第 3 节负责。围绕它的归属规则
——谁生成身份、工厂保留哪些记录、过站失败的单元怎么办——在
[manufacturing.md](manufacturing.md)。

> status: shipped — evidence: `pkgs/mosd/mosd/src/provisioning_doc.rs`, `docs/design/manufacturing.md`
