# 故障排查

mos 上的诊断遵循一个顺序：获得访问，精确识别正在运行的是什么，读取系统
已经保留的证据，然后才行动。本页按这个顺序展开，最后是把那些证据带进支持
工单的那份有边界、经过脱敏的快照。

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

`GET /api/v1/system/info` 用一次认证读取回答设备身份：machine id、板卡型号
及其读自哪一处固件来源、内核版本、`os-release` 各字段、携带包池 git 标记的
系统版本与构建日期、守护进程自身版本、已安装软件包集合、已启动的 RAUC 槽
（含 bundle 版本与启动状态），以及运行时长。每个成员都会说明它是否可用、不
可用时的原因——一份 mos 行彼此不一致的软件包清单会把这个不一致连同它找到的
所有标记一起报出来，而不是从中挑一个。在每个支持工单中引用这次读取。

`GET /api/v1/system/telemetry` 再加上板卡的温度区、看门狗设备，以及一个由
通用内核证据分类出的复位原因；`GET /api/v1/network/status` 加上 networkd、
wpa_supplicant 与 resolved 此刻实际观察到的状态，也就是"设备认为自己的网络
是什么样"的答案。在 shell 里，`/usr/share/mos/manifest.tsv` 就是 API 读的
同一份物料清单，`hostnamectl` 给出主机名（编码了设备 id 的前八个十六进制
字符）和 machine id。

**依赖硬件，且未经验证。**温度、看门狗与复位原因这三个适配器实际报出什么，
是对着夹具目录树证明的，不是对着 cx3576 或 x64 板卡。那里出现缺失或不合理
的读数，是一次带上板卡身份的升级，绝不是一个"绿色"结果。

> status: shipped — evidence: `docs/design/diagnostics.md`, `pkgs/mosd/apid/openapi.json`

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

## 5. 支持快照

`POST /api/v1/diagnostics/snapshots` 采集一份有边界、经过脱敏的 JSON 文档——
发布版与系统信息、启动与更新状态、本次启动 warning 及以上的 journal 摘录、
失败的单元与任务、存储与时间状态、遥测与观察到的网络——`GET
/api/v1/diagnostics/snapshots/{id}` 把它作为附件下载。内置 UI 的诊断面板做的
是同样这两步。

把它附到工单之前值得知道：

- **它有边界，并且会说明自己在哪里被截断。**整次采集上限 20 秒，单个来源
  6 秒；没有应答的来源会作为一个带原因的"缺失对象"出现。先读采集结果：一个
  不可用的小节是证据，不是一次通过的检查。
- **脱敏是一条有测试的边界。**凭据、令牌、私钥、Wi-Fi 秘密、SSID、MAC 与
  BSSID、journal 行里的主机名会被丢弃或替换为占位符，`/srv` 与 `/home` 下的
  内容根本不会被读取。IP 地址、路由、DNS 服务器和 machine id 是刻意保留的——
  它们正是这份快照存在的意义——所以导出的文件仍然能标识这台设备和它的网络。
  请据此处理。
- **设备从不上传它。**导出是由已认证客户端发起的一次下载，采集本身也不需要
  上游连通性。存储最多保留 8 份快照、共 16 MiB，超出时先删最旧的；没有基于
  时间的过期：工单关闭时请自己删除。
- **上一次采集还在进行时的第二次采集会被拒绝**，而不是排队。

设计记录里有本页顺序所隐含的那几棵决策树——没有网络、时间不对、DATA 写满、
更新或回滚失败、意外重启——每一棵都按决定分支的那个快照成员展开。

> status: shipped — evidence: `docs/design/diagnostics.md`, `pkgs/mosd/apid/openapi.json`

## 6. 何时停止诊断

两个槽都耗尽、陷入重启循环的设备，或凭据已丢失的设备，已经超出故障排查
的范围：去 [recovery.md](recovery.md)，并先捕获你还能拿到的证据。
