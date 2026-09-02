# 故障排查

mos 上的诊断遵循一个顺序：获得访问，精确识别正在运行的是什么，读取系统
已经保留的证据，然后才行动。本页按这个顺序展开，最后诚实交代尚不存在的
诊断面。

## 1. 获得访问

按优先顺序：

1. **API 与内置 UI**——HTTPS 到设备，`/_ui/`。实时网络观察（每接口的
   载波、地址、DNS、路由）是 API 面的一部分，这让"设备认为自己的网络是
   什么样"不需要 shell 就能读到。
2. **SSH**——默认关闭；经过认证的管理员通过 API 启用它并安装密钥。每个
   授权密钥都是 root 密钥。对于站在设备前、没有安装密钥的操作员，临时
   root 密码（通过 UI 设置，到下次启动前有效）是设计中的单次会话路径。
3. **串口控制台**——cx3576 上存在（`ttyFIQ0`，1500000 波特），显示登录
   提示，但在设置临时 root 密码之前没有任何账户接受凭据。它主要用于
   *读取*启动过程：U-Boot 的槽决策和内核输出会出现在那里。

完整的访问模型，含每个通道能做什么、不能做什么，见
[../design/access.md](../design/access.md)。

> status: shipped — evidence: `docs/design/access.md`, `pkgs/mosd/apid/openapi.json`

> status: board-dependent — evidence: `boards/cx3576/board.env`

## 2. 识别设备与发布版

镜像内的 `/usr/share/mos/manifest.tsv` 列出每个已安装软件包及其版本，外加
包池的 git 标记——在每个支持工单中引用它。`hostnamectl` 给出设备的主机名
（编码了设备 id 的前八个十六进制字符）和 machine id。

一个聚合的系统信息面（板卡、镜像版本、内核、构建日期、软件包集合在一次
API 读取中）已在计划中，未发布。

> status: shipped — evidence: `rootfs/compose/90-pack.Dockerfile`

## 3. 读取证据

- **服务状态：**`systemctl status <unit>`、`systemctl is-system-running`、
  `journalctl -u <unit>`。journal 是易失的——它不跨重启保留，所以在给
  故障设备断电之前先捕获它。
- **启动健康：**健康门记录每个探测及其裁决（`journalctl -u mos-health`）。
  更新后持续回滚的槽，失败在这三项之一：systemd 稳定、mosd 应答、apid
  监听——日志会点名是哪一项。你已判定可接受的单元可以通过
  `/etc/mos/health.conf` 容忍。
- **更新状态：**RAUC 的槽状态（已启动槽、每槽状态、最近一次安装错误）
  可通过管理守护进程的状态读到，也可在 shell 里用 `rauc status`。
- **容器：**[../design/containers.md](../design/containers.md) 中的故障表
  覆盖常见情形——添加文件后单元不存在（`systemctl daemon-reload`；
  Quadlet 生成器的 `--dryrun` 打印解析错误）、单元从不启动（缺
  `[Install]` 节）、名字解析不了（不在同一网络）、存储满
  （`podman system df`）。
- **配置写入：**一次设置写入返回一个任务；其结果（已应用、无变化、失败
  及原因）通过 API 可观察，而不是从行为里猜。

> status: shipped — evidence: `rootfs/overlay/usr/lib/mos/mos-health`, `docs/design/containers.md`, `pkgs/mosd/apid/openapi.json`

## 4. 读懂构建与验证的拒绝

现场操作员会在两个地方遇到构建系统：产出台架镜像，和验证已刷写的镜像。
mos 工具链选择大声、点名地拒绝而不是降级运行，所以拒绝文本就是诊断：

- 缺失或过期的包池、缺失的 BSP 产物、或从不同 commit 构建的池，都会点名
  要运行的确切 `make` 目标；[../design/build.md](../design/build.md) 中的
  构建失败表把常见信息映射到动作。
- `make os-verify-cx3576`（及 x64 等价物）逐项对照镜像契约检查组装好的
  镜像；红色的检查会写明它读到了什么、期望什么。用生成的信任根构建的镜像
  和其他镜像一样通过校验；keyring 检查会写明它读到的材料是哪一种等级，
  当等级不是预期的那一种时,要引用的就是这句话。

经验法则：mos 的拒绝信息就是设计来逐字引用给支持或写进 issue 的；不要
绕过它，因为这些检查的存在正是为了拦下那些通过了一切、却在硬件上失败的
产物。

> status: shipped — evidence: `docs/design/build.md`, `make os-verify-cx3576`

## 5. 尚不存在的东西

没有有边界、经过脱敏的支持包导出，UI 里没有故障排查决策树，也没有聚合
诊断面（存储健康、温度、看门狗、复位原因）。诊断计划将加入这些，外加
第 2 节的一次读取系统信息面。

> status: proposed — evidence: `docs/plan/PLAN-052.md`

TODO(PLAN-052): revisit after this plan merges

## 6. 何时停止诊断

两个槽都耗尽、陷入重启循环的设备，或凭据已丢失的设备，已经超出故障排查
的范围：去 [recovery.md](recovery.md)，并先捕获你还能拿到的证据。
