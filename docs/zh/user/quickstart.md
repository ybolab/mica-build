# 快速上手

先用 QEMU 验证 x64。完整的当前系统通过 UEFI Secure Boot、systemd-boot 和签名
内核包启动。virt-arm64 使用同一流程及 ARM64 产物；cx3576 实机验收单独进行。

## 1. 准备环境

需要 Docker/buildx、Bash、Make 和 git。编译器、签名工具及文件系统工具运行在
固定版本的构建容器里；Bun 驱动也支持固定容器。当前没有公开镜像下载服务。

> status: shipped — evidence: `docs/design/build.md`, `build-env/images.env`

## 2. 构建完整镜像

按[构建指南](../../design/build.md)依次准备软件包池、BSP 内核、原生 init、用户态根、
kernel/support 包、固件包以及两个签名部署记录，再组装全新工厂镜像。
启动、内容、元数据三个签名域分别提供显式输入；公开出厂默认值独立传入根构建。
缺少输入会失败，构建不会隐式生成密钥或转换已有系统。

```sh
MOS_BUILD_PLATFORM=linux/amd64 bash build-env/build.sh
make os-deb-preflight
bash build/run.sh --components --help
```

`disk.img` 包含 ESP、SYSTEM、DATA。保留签名部署记录、元数据公钥、启动公钥证书
和组件目录，供验证及追溯使用。每次验收从完整最新版镜像开始。

> status: shipped — evidence: `build/src/component-cli.ts`, `docs/design/build.md`

## 3. 执行 QEMU API 验收

```sh
MOS_BOARD=x64 MOS_QEMU_IMAGE=/path/to/image/disk.img \
MOS_QEMU_BOOT_CERT=/path/to/public-boot.cert.pem \
  bash pkgs/mosd/tests/apid-api/run.sh
```

测试复制完整镜像，在 DATA 中准备测试服务，并注册一次性的 Secure Boot 变量，
随后经固件启动并验证 HTTPS API。镜像和公钥证书路径必须显式提供；用相同输入加
`--dry-run` 可检查前置条件。ARM64 使用 `MOS_BOARD=virt-arm64` 及对应产物。

`tools/qemu-seed-data.ts` 只为尚未启动的一次性镜像准备受限 `/state` 普通文件，
需要启用服务时显式指定 unit。它不是运行中设备的配置接口。

> status: shipped — evidence: `pkgs/mosd/tests/apid-api/run.sh`, `tools/qemu-seed-data.ts`

## 4. 首次访问

服务启动前，原生 init 在 DATA 上建立机器身份。mosd 初始化设备身份和配置，
有线网络使用 DHCP，apid 提供 HTTPS；`/_ui/` 引导管理员设置。SSH 默认关闭。
见[首次启动](first-run.md)和[配置](configuration.md)。

> status: shipped — evidence: `pkgs/mos-deploy/src/bin/mos-init.rs`, `docs/design/provisioning.md`, `pkgs/mosd/apid/openapi.json`

继续阅读[安装](install.md)、[更新与回滚](update-rollback.md)及[应用](applications.md)。
