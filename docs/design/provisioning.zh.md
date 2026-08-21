# 设计：无网络时的配置处理（配网/供给模型）

> [English](provisioning.md) | 中文
>
> **过期警告（2026-08-21，RFCT-082）**：本译文已落后于英文版，且未逐条对齐；
> 冲突时以英文版为准（docs/README.md 的双语规则）。是否恢复中文文档的同步维护
> 仍是搁置中的用户决定（docs/task/RFCT-045.md）；在该决定作出前，请以
> provisioning.md 为准。
>
> 在不能假设有网络的前提下，设备如何获得并修改 machine 配置。2026-08-17
> 批准。配套 access.md §7 与 connd（PLAN-008 Part D）。

## 1. 与上游的分野

上游 Talos metal 无配置时进 maintenance mode **等网络推送**——数据中心假设。
mos appliance 必须在零外部输入下达到完整可用。分三层：

## 2. 第一层——首启自供给（产品行为）

STATE 无配置时，machined（TypeAppliance）自行生成：

- 默认配置：全以太网口 DHCP、apid 开、Talos apid / SSH 关、hostname 为
  `mos-<序列号后缀>`；
- **每设备独立 PKI**，首启在设备端生成——禁止把全线共享秘钥烤进镜像；
- 结果持久化到 STATE；恢复出厂（清 STATE）自然回到此状态。

归属：访问层 campaign（与 apid 首启设置、默认密码方案本是一体特性）。

## 3. 第二层——本地配置通道

所有通道最终都经 machined API 写配置文档——一条信任路径，按优先级
（细节见 access.md §7）：

1. BOOT 分区配置文件（产线/现场离线预置）；
2. USB 签名配置投放（udev 触发，厂商公钥校验）；
3. AP 强制门户（connd，PLAN-008）与 HDMI kiosk 向导（display.md）；
4. 有任何网络后经局域网 apid；
5. tty2 串口向导兜底。

## 4. 第三层——bring-up 过渡（仅 dev 镜像）

第一层落地前，cx3576 dev 镜像经 imager 嵌入式配置机制内置静态配置
（rootfs `/usr/local/etc/talos/`，由 config.AcquireController 加载）：

- 位于 `talos/hack/cx3576/dev-config/config.yaml`，由
  `BSP_VARIANT=cx3576` 门控；
- 携带入库的一次性 CA——**仅因这是 dev 镜像**才可接受，文件标注
  DO NOT SHIP；
- 退役标准：交付第一层的同一 campaign 中删除。生产镜像 profile 必须
  断言嵌入式配置目录不存在（CI 检查）。

## 5. 安全不变式

- 任何出货镜像不含全线共享凭据/密钥（第三层是显式的 dev 专属例外）。
- 配置通道不得绕过配置验证与审计日志。
- 清 STATE 重置配置，但绝不清除 META lockdown（access.md §5）。
