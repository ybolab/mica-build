# 快速上手

通往一个运行中的 mos 系统最短且诚实的路径是 x64 板卡——一个通用的 UEFI
x86_64 目标，在 QEMU 里就能启动，不需要硬件、不需要烧写工具、也不需要交叉
工具链。它是 CI 基线，它对系统核心、管理面和 API 所证明的一切，与真实板卡上
发布的是同一份代码。它刻意不覆盖的是引导加载程序：A/B U-Boot 握手是 cx3576
的板卡事实，一次绿色的 QEMU 运行对它什么也说明不了。

目前没有托管下载服务，所以快速上手从源码构建镜像。一个发布版由哪些产物组成
见 [download.md](download.md)，真实硬件的安装见 [install.md](install.md)。

## 1. 前置条件

一台 amd64 Linux 主机，装有 docker（带 buildx）、bash、make 和 git。仅此而已：
主机上不安装任何工具链，每个编译器都来自按摘要固定的构建器镜像。

> status: shipped — evidence: `docs/design/build.md`, `build-env/images.env`

## 2. 构建镜像

在仓库根目录下按顺序执行：

```sh
MOS_BUILD_PLATFORM=linux/amd64 bash build-env/build.sh   # builder images
make os-debs                                             # the package pool
MOS_BOARD=x64 bash rootfs/build.sh                       # the rootfs slot
bash build/run.sh --mkimage-x64                          # the A/B disk image
bash verify/run.sh --verify --board x64                  # the image contract
```

第一次运行前值得知道的事：

- `make os-debs` 构建所有 mos Debian 包。`rauc` 和 `podman` 两个 producer
  首次运行时会编译各自的上游源码；仅 podman 一项就大约需要三刻钟。之后的
  运行会复用构建缓存。
- 找不到签名材料的构建会在仓库根目录的 `ca/` 目录下生成一个开发信任根，
  并大声说明这一点。这样的镜像信任的是开发密钥环，校验器会在判定里写明
  这一点。
- 每一步都会点名拒绝缺失或过期的输入，而不是悄悄重建它们；拒绝信息会
  写明该运行的命令。

结果是 `_out/x64/x64-mos-latest.img`，一个完整磁盘的 A/B 镜像。

> status: shipped — evidence: `make os-debs`, `make os-rootfs-x64-composed`, `docs/design/build.md`

## 3. 在 QEMU 里启动

`pkgs/mosd/tests/apid-api/` 下的 QEMU 测试装置会启动构建出的镜像，转发
apid 的 HTTPS 端口，并通过真实的套接字驱动管理 API——它既是启动 x64 镜像
的受支持方式，也是 API 验收套件。它不构建任何东西，并会点名拒绝缺失的镜像：

```sh
bash pkgs/mosd/tests/apid-api/run.sh --dry-run   # check preconditions, boot nothing
bash pkgs/mosd/tests/apid-api/run.sh             # boot and run the API suite
```

要在启动前把配置预置进镜像的 STATE 分区——例如一个 Quadlet 容器定义——使用
`bash tools/qemu-seed-state.sh`；其文件头注释记录了操作顺序。

> status: shipped — evidence: `pkgs/mosd/tests/apid-api/run.sh`, `tools/qemu-seed-state.sh`

## 4. 初次接触

设备在首次启动时无需任何网络输入即可完成自我配置：铸造自己的身份，把自己
命名为 `mos-` 加设备 id 的前八个十六进制字符，并在有线接口上启用 DHCP。
管理面是走 HTTPS 的 apid；内置 UI 在 `/_ui/`，第一次访问会进入初始设置——
创建管理员凭据。SSH 默认关闭。

完整的首次启动过程见 [first-run.md](first-run.md)，之后可以配置什么见
[configuration.md](configuration.md)。

> status: shipped — evidence: `docs/design/provisioning.md`, `pkgs/mosd/apid/openapi.json`

## 5. 下一步去哪

- 真实硬件：[install.md](install.md)；mos 未随附支持的板卡，见移植手册
  [../../bsp/porting.md](../../bsp/porting.md)。
- 更新一台运行中的设备：[update-rollback.md](update-rollback.md)。
- 运行应用：[applications.md](applications.md)。
