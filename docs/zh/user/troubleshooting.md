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
   *读取*启动过程：固件的部署决策和内核输出会出现在那里。

完整的访问模型，含每个通道能做什么、不能做什么，见
[../design/access.md](../design/access.md)。

> status: shipped — evidence: `docs/design/access.md`, `pkgs/mosd/apid/openapi.json`

> status: board-dependent — evidence: `boards/cx3576/board.env`

## 2. 识别设备与发布版

`GET /api/v1/system/info` 用一次认证读取回答设备身份：machine id、板卡型号
及其读自哪一处固件来源、内核版本、`os-release` 各字段、携带包池 git 标记的
系统版本与构建日期、守护进程自身版本、已安装软件包集合、运行的签名部署及组件身份
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
- **启动健康：**健康门记录它所需的集合、每个成员的裁决，以及它看到的每一个
  失败 unit（`journalctl -u mos-health`）。更新后持续回退的部署，失败在所需成员
  之一：启动事务稳定、mosd 应答、apid 监听——日志会点名是哪一项。单个失败的
  unit **不会**让部署回滚；它被上报到 live-state 的 `health.units`，用
  `GET /api/v1/state/health` 或从一份诊断快照里读。健康门要求什么写在只读根里的
  `/etc/mos/health.conf`。
- **更新状态：**`mos-deploy status` 报告 current/candidate/fallback 部署、尝试次数、
  组件验证及失败部署。另保存 `GET /api/v1/update` 的管理视图。

- **容器：**[../design/containers.md](../design/containers.md) 中的故障表
  覆盖常见情形——添加文件后单元不存在（`systemctl daemon-reload`；
  Quadlet 生成器的 `--dryrun` 打印解析错误）、单元从不启动（缺
  `[Install]` 节）、名字解析不了（不在同一网络）、存储满
  （`podman system df`）。
- **配置写入：**一次设置写入返回一个任务；其结果（已应用、无变化、失败
  及原因）通过 API 可观察，而不是从行为里猜。

> status: shipped — evidence: `rootfs/overlay/usr/lib/mos/mos-health`, `docs/design/containers.md`, `pkgs/mosd/apid/openapi.json`

## 4. 当某个正常命令缺失或损坏时

镜像里带了一个应急二进制 `/usr/bin/busybox`，除此之外什么都没变：镜像中
任何位置都没有 applet 链接，没有新增 PATH 条目，每个 GNU 命令都仍然解析到
它原来的位置。用点名的方式调用 applet——

```sh
busybox sh
busybox ls -l /mos
busybox mount
busybox --list          # 本构建提供的全部 applet
```

——这就是全部接口。如果某次修复确实需要 applet 表现得像普通命令（比如脚本
调用 `ls`，而坏掉的正是 coreutils），那就**临时**创建这些链接，并且只把那个
目录加进那一个 shell 的 PATH：

```sh
mkdir -p /run/mos-toolbox
busybox --install -s /run/mos-toolbox
PATH=/run/mos-toolbox:$PATH busybox sh
```

`/run` 是 tmpfs，所以这些链接在下次启动时消失，那个 shell 之外的任何东西都
看不到它们。

**永远不要建立持久的链接农场。**根是只读的 dm-verity squashfs，往 `/usr/bin`
里写本来就会失败；而在能写成功的地方同样拒绝，是因为 PATH 里的 applet 名字
会悄悄重新决定 `ls`、`tar`、`mount`、`sh` 对设备上每个脚本意味着什么，而
BusyBox 的 applet 选项更少、行为也与 GNU 版本不同。

**仅用于诊断，也不是救援环境。**这些 applet 不是受支持的命令 API：设备上的
单元、脚本和自动化都不得依赖它们，镜像验证会断言确实没有依赖。该二进制与其他
一切动态链接到同一个 libc，所以一个坏到连 `/lib` 都没了的系统同样失去了它——
到那一步答案是 [recovery.md](recovery.md)，而不是一个 shell。

> status: shipped — evidence: `rootfs/packages-src/busybox`, `verify/src/checks-busybox.ts`, `docs/design/recovery.md`

## 5. 读懂构建与验证的拒绝

现场操作员会在两个地方遇到构建系统：产出台架镜像，和验证已刷写的镜像。
mos 工具链选择大声、点名地拒绝而不是降级运行，所以拒绝文本就是诊断：

- 缺失或过期的包池、缺失的 BSP 产物、或从不同 commit 构建的池，都会点名
  要运行的确切 `make` 目标；[../design/build.md](../../design/build.md) 中的
  构建失败表把常见信息映射到动作。
- `make os-verify`（及 x64 等价物）逐项对照镜像契约检查组装好的
  镜像；红色的检查会写明它读到了什么、期望什么。用生成的信任根构建的镜像
  和其他镜像一样通过校验；keyring 检查会写明它读到的材料是哪一种等级，
  当等级不是预期的那一种时,要引用的就是这句话。

经验法则：mos 的拒绝信息就是设计来逐字引用给支持或写进 issue 的；不要
绕过它，因为这些检查的存在正是为了拦下那些通过了一切、却在硬件上失败的
产物。

> status: shipped — evidence: `docs/design/build.md`, `make os-verify`

## 6. 支持快照

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

## 7. 何时停止诊断

所有部署都耗尽、陷入重启循环的设备，或凭据已丢失的设备，已经超出故障排查
的范围：去 [recovery.md](recovery.md)，并先捕获你还能拿到的证据。
