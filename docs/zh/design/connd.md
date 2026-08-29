# 设计：connd —— systemd/mosd 基座上的 WiFi station 与 AP

> [English](../../design/connd.md) | 中文

## 1. 实际发布的是什么

**没有 `connd` 进程。** 这个名字保留给**关注点**，不是进程，镜像里没有任何东西叫 connd。

这个关注点由这些部分承担：

- **两个 mosd 协调器**，由设置子树 `wifi.client` 和 `wifi.ap` 驱动；
- **systemd**，它拥有 unit 的生命周期——**mosd 从不把守护进程作为自己的子进程监管**，
  只通过系统总线驱动 unit；
- 来自基础根文件系统包白名单的 **`wpasupplicant` 与 `hostapd`**，不是来自单独的系统扩展；
- **systemd-networkd 内建的 `DHCPServer=yes`**，与 hostapd 并列，所以 AP **不需要 dnsmasq**，
  也不需要单独的 DHCP 守护进程；
- **mosd 的实时状态树**，经 D-Bus 供给 apid，作为**唯一**的状态出口。

这些部件实现的模型：一份带优先级的已知网络声明式列表、一个具备 `off` / `provisioning` /
`always` 三种模式的 AP、单射频问题的唯一归属者，以及**不得存在任何机队级凭据**这条规则。

**CAN 和蓝牙不归 mosd。** 它们留在板级 hwinit unit（`hwinit-can`、`hwinit-bt`）里，
那些 unit 已经是只读根安全的、已经能工作；把它们折进 mosd 是在重写一个没坏的东西，没有收益。
所以边界是：`wifi.client` / `wifi.ap` 归 mosd，CAN 与 BT 归板级层。

## 2. 设置模型

`wifi.client`（`enabled`、`interface`、`networks`）与 `wifi.ap`（`mode`、`interface`、
`channel`、`countryCode`、`address` 等）。`ssid` 和 `psk` 是可选的，默认**缺席**而非空串。

## 3. Station 协调器（`wifi.client`）

渲染 wpa_supplicant 配置 + networkd 单元，并驱动 `wpa_supplicant@<if>.service`。

## 4. AP 协调器（`wifi.ap`）

渲染 hostapd 配置 + networkd 单元，并驱动 `hostapd@<if>.service`。DHCP 由 networkd 自带。

## 5. 单射频冲突 —— 按现状报告，不做仲裁

同一块射频不能同时做 station 和 AP。当前实现**如实报告这个冲突**，而**不替用户仲裁**谁让位。
AP 协调器会读 `wifi.client` 来做冲突检查。

## 6. networkd 的命名约束 —— 写下一个协调器之前先读这节

networkd 对 unit 文件名与匹配规则有约束，会影响任何渲染 `.network` / `.netdev` 的协调器。

## 7. 凭据

AP 的 PSK 在设备上从系统 CSPRNG 生成，明文存放在 `/var/lib/mos/secrets/ap-psk`
（0700 目录下的 0600 文件）。**它与设备口令是两次独立抽取**，理由见
[provisioning.md](provisioning.md) 3.2：WPA2 PSK 紧邻广播且可离线爆破，
若它同时是设备口令，破出 WiFi 密钥就等于交出 root shell。

## 8. 镜像集成 —— Debian 的打包在跟协调器对着干

Debian 的 `wpasupplicant` / `hostapd` 包自带 unit 与默认配置，会与协调器渲染的内容冲突。
镜像构建必须处理这一点，否则发行版的默认值会在协调器背后生效。

## 9. 已知限制（保留而非丢弃）

## 10. 不主张的部分

关于某些 WiFi 芯片的厂商驱动是否真的支持 AP 模式，本文**不做主张**——那是一条记录在案的风险。
