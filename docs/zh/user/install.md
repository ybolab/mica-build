# 安装当前开发镜像

使用刚构建的完整 MOS 镜像，目标为 x64、virt-arm64 或 cx3576。不提供旧分区布局
转换或升级路径。完整写入替换镜像覆盖范围内的系统及数据，需要保留的文件先另存。

> status: shipped — evidence: `build/src/file-image.ts`, `boards/x64/board.env`, `boards/virt-arm64/board.env`, `boards/cx3576/board.env`

## 准备并识别

刷机文件名为 `mos-BOARD-YYYYMMDD-HHmmss.img`，使用精确到秒的 UTC 构建时间
区分版本。下列命令中的文件名需要替换为实际交付文件。

使用确切板卡的镜像，通过可信交付取得元数据公钥，再验证：

```sh
bash verify/run.sh --verify --board x64 \
  --image /path/to/image/mos-x64-20260909-164233.img --public-key /path/to/metadata-public.key
```

只为对应板卡的产物替换 `--board`。该检查验证签名对象和布局，不注册平台启动密钥。
启动签名者必须被该 UEFI 平台或强制 FIT 签名的 U-Boot 接受；开发密钥不代表生产信任。

> status: shipped — evidence: `verify/src/file-image.ts`, `docs/design/key-delivery.md`

## x64 与 virt-arm64

使用平台写盘工具向明确识别的一次性目标介质写入完整镜像，刷新缓存并回读比较后
启动。UEFI 使用可移动介质 EFI 入口。磁盘包含 ESP/SYSTEM/DATA，仅 DATA 扩容。

```sh
MOS_BOARD=x64 MOS_QEMU_IMAGE=/path/to/image/mos-x64-20260909-164233.img \
MOS_QEMU_BOOT_CERT=/path/to/boot-signer.cert.pem \
  bash pkgs/mosd/tests/apid-api/run.sh
```

虚拟验收使用全新副本和显式启动公钥证书。ARM64 改为 `MOS_BOARD=virt-arm64` 并使用
对应产物；物理 PC 的平台密钥注册由平台操作者管理。

> status: board-dependent — evidence: `pkgs/mosd/tests/apid-api/src/qemu.ts`, `docs/design/release-signing.md`

## cx3576

通过本地台架板的 RockUSB loader/maskrom 接口操作，写入前识别所连接设备。

```sh
make -C boards/cx3576/bsp flash-mos MOS_IMAGE=/path/to/image/mos-cx3576-20260909-164233.img
```

不指定 `MOS_IMAGE` 时，默认选择 `_out/cx3576/image/` 中时间最新的 cx3576 镜像。
需要指定版本时，显式传入 `MOS_IMAGE`。

预检先检查当前 GPT 和 loader 位置。写入后比较全部镜像字节，回读不符时保持恢复
接口而不复位。固件从 LBA 64 开始，其保留分区还包含两份启动尝试记录。

实际 loader/maskrom 进入、刷写、启动、看门狗和断电恢复仍需台架验收。主机桩测试
只证明预检及回读控制流程，不能作为某块实物板已刷写或启动的证据。

> status: board-dependent — evidence: `boards/cx3576/bsp/Makefile`, `boards/cx3576/bsp/scripts/verify-flash.py`

## 首次启动及恢复

正常启动认证部署并挂载匹配的签名 root/support，在 DATA 上建立持久身份、扩容
DATA 并启动管理服务。健康确认保留可用回退部署，后续操作见[更新](update-rollback.md)。

共享存储缺失或损坏、启动记录全部耗尽时必须显式恢复。不会无签名重试、读取旧布局、
重建默认凭据或悄悄补充尝试次数。见[恢复](recovery.md)及[存储](storage.md)。

> status: shipped — evidence: `pkgs/mos-deploy/src/bin/mos-init.rs`, `rootfs/overlay/usr/lib/mos/mos-health`
