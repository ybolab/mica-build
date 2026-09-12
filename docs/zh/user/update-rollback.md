# 更新与回滚

一个 Mica OS 部署选择独立签名的 kernel/support 和 root 组件。发布可只改 root、只改
kernel，或同时改变二者。设备运行时暂存已验证对象，重启后尝试候选部署；固件维护
是独立操作。

> status: shipped — evidence: `pkgs/mos-deploy/`, `pkgs/mosd/apid/src/update_api.rs`

## 安装更新

System 页面展示运行部署、组件身份、候选、保留的回退部署、获取进度及重启判定。
通过认证设置配置更新源、渠道和自动/手动策略。更新源提供签名 `/v1/manifest.json`
目录；修改源设置不能增加签名密钥。

在线获取只下载缺失对象，按签名长度和摘要验证。离线 `.mosupd` 携带相同的签名
部署及组件对象。安装接收已验证部署 ID；空间不足、无效元数据或不完整对象均阻止
激活。重启为独立动作，受重启门禁约束。

健康检查确认候选。未确认候选有三次尝试，失败耗尽后选择保留的可用部署。
共享存储故障需要恢复，不能反复归咎于某个 root 部署。

> status: shipped — evidence: `pkgs/mos-deploy/src/acquisition.rs`, `pkgs/mos-deploy/src/deployments.rs`, `rootfs/overlay/usr/lib/mos/mos-health`

## 回滚

只有当前部署已确认、没有待处理候选且存在可用回退部署时，才能手动回滚。界面展示
后端判定及目标。成功请求淘汰当前运行记录，并明确提示需要重启才能运行回退部署。

回滚改变系统部署，不会撤销 DATA 上的配置、数据库或应用写入。当前开发阶段只用
当前数据策略，不做旧布局迁移。失败部署 ID 和单调代次下限阻止自动重装已失败发布；
修正发布必须重新签名且具有更高代次，清除显示记录不能绕过这一约束。

> status: shipped — evidence: `pkgs/mosd/apid/src/update_api.rs`, `pkgs/mosd/mosd/src/deployment.rs`

## 固件与恢复

普通系统更新不替换 loader，也不注册平台密钥。固件包单独发布，必须走显式离线
维护及回读流程，恢复包保存在 ESP 外。所有开发验收从完整当前镜像开始，不接受
以前的软件包或分区格式。

QEMU 启动/更新证据与 cx3576 硬件证据分别记录。物理看门狗、存储断电和 USB 维护
验收仍属于板级工作，见[板卡状态表](../../boards/support-tiers.md#current-boards)。

> status: board-dependent — evidence: `docs/design/release-signing.md`
