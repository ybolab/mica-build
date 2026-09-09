# 发布标识与发布说明

用已认证部署 ID、代次、板卡、kernel 组件 ID 和 root 组件 ID 识别运行系统。
`mos-deploy status` 和更新 API 提供这些关联；文件名或时间戳不能单独标识内容。

## 1. 产物身份

签名部署信封绑定确切 kernel/root 组合以及产物大小和摘要。root/support 根哈希具有
内核可验证的独立签名，kernel 包携带匹配模块和启动策略。固件有独立签名身份和维护
回执。镜像还带 `/usr/share/mos/manifest.tsv` 和不可变构建标识。
开发构建的 dirty 标记保持可见，它不能证明干净源码提交可重现这些字节。

> status: shipped — evidence: `build/src/components.ts`, `pkgs/mos-deploy/src/deployments.rs`, `rootfs/compose/90-pack.Dockerfile`

## 2. 发布说明需要记录的事实

从产物记录目标、profile、部署 ID、组件变化、源码身份及软件包差异，明确写出信任
锚、启动策略、访问默认值和持久化策略变化。验证结果与限制绑定到确切测试镜像。
只改 root 的发布必须标识未变的 kernel/support，只改 kernel 的发布必须标识未变的
root。回退部署共享 DATA，不撤销应用数据。当前契约为 `dataPolicy: unchanged`，
没有破坏性迁移路径。

> status: shipped — evidence: `docs/user/doc-contract.md`, `build/src/components.ts`, `docs/design/updates.md`

## 3. 发布状态

服务器向指定渠道发布已认证组件并支持撤回。目录有效期约束获取过程，已安装的
认证部署仍可离线启动。渠道发布不能替代板卡验收或产品支持承诺。

> status: shipped — evidence: `update-server/src`, `pkgs/mos-deploy/src/acquisition.rs`

本页不承诺公开发布历史、支持期限或停服政策。当前源码构建路径见[获取镜像](download.md)，
交付记录见[发布产物](../../design/release-artifacts.md)。

> status: unsupported
