# 设计：调试与维护访问

> [English](access.md) | 中文
>
> 不可变 appliance 上的 shell/SSH/console 访问——配置驱动、可审计、可锁死、
> 且在生产镜像中彻底不存在。配套 architecture.md §5。实现分阶段；阶段一
> 交付一机一密默认密码，后续阶段升级认证但模型不变。

## 1. 原则

- 访问通道是 **COSI 模型下的一等公民服务**（配置文档 → controller → 服务），
  绝不是绕过模型的侧门。
- **配网和调试是两个问题。**弱认证 + 资源白名单的向导解决"现场无网"；强认证
  完整 shell 解决深度排障。用一个万能 shell 兼顾两者，认证强度必然被可用性
  拖垮。
- "关闭"必须存在三个强度（见 §5）；最强的一档是编译期不存在。

## 2. 通道

| 通道 | 能力 | 认证 | 存在范围 |
|---|---|---|---|
| 配网向导（tty2 TUI；AP 强制门户；kiosk 的 HDMI 本地向导） | 仅白名单网络 COSI 资源；无 secrets、无命令执行、无原始日志 | 一机一密 PIN | 全部变体 |
| SSH（Go sshd + busybox） | root | 阶段一：一机一密默认密码；阶段二+：离线挑战-响应 | **prod 与 debug**（默认关闭；仅 `sealed` profile 不包含） |
| Console shell（tty3） | root | 同 SSH | 仅 debug 变体 |
| Rescue（`talos.rescue=1` / 全槽失败 FIT 条目） | chroot 修复环境 | 物理接触（cmdline/启动失败） | 全部变体 |
| 工厂（rockusb / SoC loader 模式） | 完整重刷 | 物理接触 + recovery 按键 | 硬件级 |

SSH 服务端用 Go 实现（`x/crypto/ssh` + pty），编入 machined 多调用二进制，
与 apid 同款监督方式，策略直接读 COSI——无 OpenSSH、无独立 C daemon、无配置
文件漂移。busybox 提供 `/bin/sh` 与基础工具（约 1MB），仅进 debug 变体。

## 3. 配置模型

```yaml
apiVersion: v1alpha1
kind: DebugAccessConfig
console:
  networkWizard: { enabled: true, tty: tty2, auth: { mode: derivedPIN, keyGeneration: 1 } }
  shell:        { enabled: false, tty: tty3, auth: { mode: staticPassword } }   # 阶段一模式
ssh:
  enabled: false
  port: 22
  listenAddresses: []          # 空 = 不监听；建议仅绑管理网段
  auth: { mode: staticPassword }   # 后续阶段 -> publicKey / challengeResponse
  idleTimeout: 15m
  autoDisableAfter: 2h         # 打开的通道自动回落关闭
bruteForce: { backoffBase: 1s, backoffMax: 300s, lockoutThreshold: 20 }
lockdown: false                # 单向；见 §5
```

链路：`DebugAccessConfig` → DebugAccessController → `DebugAccessStatus` 资源
→ 服务起停，无需重启。apid 从同一资源渲染状态（"调试通道已开启，剩余
1h23m"）。

## 4. 认证阶段

- **阶段一（当前）**：一机一密静态密码（产线烧录，hash 以 Argon2id 存
  STATE——参数按目标硬件实测确定）。禁止全线统一密码；UX 参照 Victron 的
  "密码 + UI 开关"模式。
- **阶段二**：向导用派生式一机一密 PIN：
  `PIN = base32(HMAC(K_vendor[gen], device_id))[:8]`；厂商密钥离线保存，
  技术支持凭标签即可算出；设备只存 hash。
- **阶段三**：完整 shell 用离线挑战-响应：console 显示
  `device_id‖nonce‖counter`；运维工具用授权私钥（Ed25519）签名；设备用编译
  进镜像的公钥验证（被 FIT 签名覆盖）。天然获得：有效期、权限范围、按工程师
  吊销、无共享秘密、设备全程离线可用。
- 任意阶段可选：`requirePhysicalPresence`（GPIO/跳线/上电时间窗）——因为
  "本地 console" 经常被串口服务器桥接到网络。

## 5. 分层禁用

1. **运行期**：`enabled: false` → controller 停服务（可逆）。
2. **META lockdown**：META 分区单向置位；置位后 machined 无视配置、根本不
   注册这些服务。只有整机 wipe 才能清除——但恢复出厂（仅清 STATE/EPHEMERAL）
   **有意不清它**："忘记密码"可现场自助，"解锁 shell"不可以。
3. **镜像变体**：三个构建 profile（2026-08-17 决策——prod 内置 SSH）：
   - `prod`（默认）：包含 sshd + busybox，**SSH 默认关闭**；开启需经认证的
     管理操作（apid / Talos apid 配置写入）。不包含 console shell。
   - `debug`：增加 tty3 console shell 与面向开发的宽松默认值。
   - `sealed`（可选）：完全无 shell 的构建，供高安全部署——只有此 profile
     中"无 shell"仍是签名镜像身份的一部分。
   随 prod 决策接受的取舍：对 `prod` 而言，编译期不存在这层防线不再覆盖
   SSH；实际防线为默认关闭配置、认证强度（§4）、META lockdown（§5.2）与
   审计（§6）。

## 6. 防爆破与审计

- 失败计数与退避状态持久化在 **META** 而非内存——拔电重启不得清零（嵌入式
  最经典的绕过手法）。
- 指数退避直至硬锁定（`lockoutThreshold`），仅物理在场可解。
- 每次尝试/会话（开、关、来源、时长、在场校验结果）→ syslogd + 限额持久
  ring buffer；联网后上报。没有审计就没有 shell——这是该通道能通过安全评审
  的前提。

## 7. 配网路径（按优先级）

1. BOOT 分区 provisioning 文件（任意读卡器可编辑；物理持有启动介质本就
   意味着完全控制）。
2. USB 签名配置投放（udev 触发导入；厂商密钥签名校验）。
3. AP 模式强制门户设置（connd + apid；PLAN-008 Part D）。
4. HDMI 本地设置：kiosk 显示渲染 apid 向导，USB 键盘/触摸输入
   （design/display.md）。
5. Console 向导（tty2），无显示器、无 WiFi 时的兜底。

## 8. 分期与 campaign 映射

| 阶段 | 范围 | Campaign |
|---|---|---|
| 1 | DebugAccessConfig + controller；Go sshd + busybox（debug 变体）；tty3 shell；一机一密静态密码；META 计数；审计接线 | 访问层 campaign（板级启动之后） |
| 2 | 向导 TUI + 派生 PIN + provisioning 文件/USB 导入 | 随 connd P2 |
| 3 | 挑战-响应、物理在场、CI 强制变体分离 | 加固 campaign |
