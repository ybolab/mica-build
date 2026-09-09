# 获取并识别镜像

从源码构建当前系统，或向集成商获取完整镜像。本仓库没有公开托管的下载服务。

## 1. 选择目标

当前系统镜像目标为 `x64`、`virt-arm64`、`cx3576`。产物绑定确切板卡和架构，
用户态 profile（`dev` 或 `prod`）记录在已验证根中。所有验收都刷完整最新版工厂
镜像，不支持旧布局安装或迁移。

> status: shipped — evidence: `boards/x64/board.env`, `boards/virt-arm64/board.env`, `boards/cx3576/board.env`, `build/src/file-layout.ts`

## 2. 保留完整产物集合

| 产物 | 用途 |
|---|---|
| `disk.img` | 带两个已认证部署记录的完整工厂镜像 |
| 签名部署信封 | 绑定板卡、代次及 kernel/root 组合 |
| kernel 包 | 签名 UKI/FIT 和匹配的 verity support 数据 |
| root 组件 | 用户态映像、verity 参数和独立根哈希签名 |
| 固件包 | 独立签名、独立维护的启动固件 |
| `.mosupd` | 有边界的离线部署更新，携带所需对象 |

开发验收刷完整镜像。组件更新用于已经运行当前系统的设备，只改变指定组件；
普通系统更新操作不会安装引导固件。

> status: shipped — evidence: `build/src/component-cli.ts`, `build/src/file-image.ts`, `build/src/component-archive.ts`

## 3. 构建和验证

按[快速上手](quickstart.md)及[构建指南](../../design/build.md)操作。元数据公钥必须
来自独立的可信交付渠道，不能只相信与下载文件放在一起的密钥或校验和。

```sh
bash verify/run.sh --verify --board x64 \
  --image /path/to/image/disk.img --public-key /path/to/metadata-public.key
```

离线验证认证签名记录并检查内容、几何、固件回执和根策略。启动验收另外证明选定
启动锚下的 UEFI/FIT 强制验证行为。

> status: shipped — evidence: `verify/src/file-image.ts`, `verify/run.sh`, `docs/design/release-signing.md`

## 4. 发布和证据

更新服务器接收独立组件对象和签名元数据，验证发布条件并提供选定渠道；固件维护
产物单独发布。服务器及其目录由操作者管理，工具存在不意味着公共托管已提供。
交付镜像时保留软件包清单、BSP 标识、组件摘要、源码提交、发布说明和确切测试日志。
实机能力必须附对应硬件证据，见[发布标识](release-notes.md)及
[发布产物](../../design/release-artifacts.md)。

> status: shipped — evidence: `update-server/src`, `docs/design/updates.md`
