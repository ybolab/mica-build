# 发布版与镜像获取

本页说明一个 mos 发布版由什么组成、如何为板卡选择发布版、以及如何获取产物。
先把诚实的结论放在最前面：**目前没有托管下载服务。**发布版从本仓库构建——
由你自己，或由交付你产品的集成商——而已发布版本、渠道和下载元数据的路线图
是一份计划，不是已发布的服务。

## 1. 一个发布版由什么组成

一次板卡构建在 `_out/<board>/` 下产出三类产物：

| 产物 | 是什么 |
|---|---|
| `<board>-mos-<epoch>.img`（以及 `<board>-mos-latest.img` 符号链接） | 刷写到新设备上的完整磁盘 A/B 镜像 |
| `rootfs-verity.img` + `rootfs-verity.env` | 一个 rootfs 槽——带 dm-verity 哈希树的 squashfs——以及标识它的参数 |
| RAUC bundle（`.raucb`） | 面向已运行 mos 的设备的签名更新包 |

`rootfs-verity.env` 中的 dm-verity 根哈希是一个发布版根文件系统的身份：
两次构建若哈希相同，则字节相同。镜像的完整软件包清单随镜像一起发布，位于
`/usr/share/mos/manifest.tsv`，含每个包的版本和源码树的 git 标记。

> status: shipped — evidence: `docs/design/build.md`, `rootfs/compose/90-pack.Dockerfile`

## 2. 选择发布版

三个维度选定一个产物：

- **板卡。**一个镜像只为一块板卡构建，不能在另一块上启动。现有两块板卡：
  `cx3576`（CX3576-Z，Rockchip RK3576，arm64）和 `x64`（通用 UEFI x86_64，
  QEMU 与 CI 基线）。支持的硬件及其地位见 [support.md](support.md) 和硬件
  页面 [../../website/hardware.md](../../website/hardware.md)。
- **Profile。**`dev` 或 `prod`，在构建时选定并不可变地写入镜像。两个
  profile 都默认关闭 SSH；profile 记录在 verity 根内部，因此一台生产设备
  无法被改成开发设备。
- **版本。**镜像以构建 epoch 命名；更新 bundle 携带构建时给定的版本字符串。
  发布版如何标识见 [release-notes.md](release-notes.md)。

> status: board-dependent — evidence: `boards/cx3576/board.env`, `boards/x64/board.env`, `rootfs/packages-src/profile`

## 3. 今天获取镜像的方式：自己构建

受支持的获取路径是源码构建。构建完全在 docker 里进行，点名拒绝过期输入，
并有端到端的文档——x64 序列见 [quickstart.md](quickstart.md)，cx3576 序列
（在 amd64 主机上交叉编译，不需要主机级模拟）见构建指南。

```sh
# cx3576, end to end — see docs/design/build.md for each step's role
MOS_BUILD_PLATFORM=linux/arm64 bash build-env/build.sh
make cx3576-uboot cx3576-uboot-mos
make cx3576-kernel
make os-debs
bash rootfs/build.sh
bash build/run.sh --mkimage-cx3576
make os-verify-cx3576
```

如果你是基于 mos 构建的产品的最终客户，你的镜像来自你的产品集成商，而不是
本仓库；你收到哪个 mos 发布版由集成商的发布流程决定。

> status: shipped — evidence: `make os-image-cx3576`, `docs/design/build.md`

## 4. 验证你拿到的东西

对更新 bundle 而言，验证链在主机侧今天就真实可用：bundle 带 CMS 签名并在
安装时对照密钥环验证，TUF 工具（`rauc-sign verify`，对照一个带外持有的信任
锚）验证已发布的仓库元数据。签名 runbook——密钥仪式、保管、轮换——是
[../design/release-signing.md](../design/release-signing.md)。

尚不存在的东西：随镜像发布的逐产物校验和与签名文件、命名兼容性与摘要的
机器可读发布清单、SBOM，以及可以获取这一切的下载渠道。在那落地之前，可信
的陈述更窄：你自己构建的镜像与你的源码树产出的完全一致，而
`make os-verify-cx3576`（或 `bash verify/run.sh --verify --board x64`）
逐项对照镜像契约检查组装好的镜像。

> status: shipped — evidence: `pkgs/rauc-sign/README.md`, `make os-verify-cx3576`

## 5. 已发布版本、渠道与下载元数据

发布身份计划覆盖：每个发布版一份签名的机器可读发布清单（版本、渠道、
板卡/profile 兼容性、产物摘要与大小、构建与源码身份）、逐产物校验和与签名、
SPDX/CycloneDX SBOM 与源码提供清单，以及带发布门禁的
development/candidate/stable 晋级流程。官方站点的下载页简报是
[../../website/downloads.md](../../website/downloads.md)。

> status: proposed — evidence: `docs/plan/PLAN-043.md`

TODO(PLAN-043): revisit after this plan merges
