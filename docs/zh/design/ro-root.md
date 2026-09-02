# 只读根：cx3576 上的 squashfs + dm-verity

> [English](../../design/ro-root.md) | 中文

## 1. 根文件系统镜像是什么

构建产出一个裸文件：

```
+---------------------------+ 0
| squashfs (zstd -19)       |  SQUASHFS_BYTES，4096 的整数倍
+---------------------------+ SQUASHFS_BYTES == 哈希偏移
| dm-verity 哈希树           |  只有哈希树本身——没有 verity 超级块
+---------------------------+
| 零填充                     |  补齐到下一个整 MiB
+---------------------------+ IMAGE_BYTES
```

**哈希树与它所覆盖的数据在同一个文件里。** 一个文件意味着：一个待签名的产物、
一次裸 `dd` 写入槽位、一个槽位一个 RAUC 镜像。尾部填充的存在是因为装配器按 MiB 边界写入。

打包时使用 `veritysetup --no-superblock`：这样哈希偏移处就是哈希树的**顶层**，而不是描述树的
元数据。第 2 节的 `dm-mod.create=` 是 verity v1 target，根本没有超级块这个概念——内核把
`<HASH_START_BLOCK>` 处的块直接当作树的顶层读。带超级块打包会把 8 字节的 `verity\0\0` 正好
放在那里，并把整棵树往后推一个哈希块，于是两块板（两种 bootloader 拼出同一张表）都会以
`device-mapper: verity: metadata block <n> is corrupted` 启动失败。`veritysetup verify` 看不见
这个问题，因为它按写入时的同一套约定把超级块读回来；verify 的
`verity-hash-start-no-superblock` 检查读的是字节本身。

重建 verity target 所需的参数写在旁边的 `.env` 文件里（`VERITY_ROOT_HASH`、`VERITY_SALT`、
块大小、块数等）。其中**没有** `VERITY_UUID`：UUID 是超级块的字段，而这个镜像没有超级块。

### 确定性

**根哈希就是一次发布的身份**，所以打包必须是其内容的纯函数。每一处变异源都被钉死：

| 变异源 | 钉法 |
|---|---|
| mksquashfs 线程数 | `-processors 1`——多线程打包不是字节可复现的 |
| 超级块与 inode 时间戳 | `-mkfs-time` / `-all-time` 设为固定值（2020-01-01T00:00:00Z） |
| 文件属主 | **不强制**。它来自固定的基础镜像与固定的包集合，并由断言把关 |
| verity 超级块 UUID | 不需要钉——`--no-superblock` 之后这个字段根本不存在，也就无从随机 |

## 2. 决策：只用命令行的 `dm-mod.create=`，不要 initramfs

verity 设备**完全由内核命令行描述**，按槽位从该槽的 verity 参数和板级 cmdline 拼出。
理由是不为 cpio 花掉常驻 RAM，也不引入一个必须与根同步签名的第二产物。

## 3. squashfs 扩展属性

## 4. 写入去哪里

`/` 是受 verity 保护的 squashfs，**永远不可写**。数据分区吸收一切：

| 路径 | 后端 | 选项 |
|---|---|---|
| `/` | rootfs-a / rootfs-b（`/dev/dm-0`） | squashfs，`ro` |
| `/srv` | DATA | ext4，`noatime,x-systemd.growfs` |
| `/mnt/state` | STATE | ext4，`noatime` |
| `/mnt/meta` | META | ext4，`noatime` |
| `/var` | EPHEMERAL | ext4，`noatime`——**没有** growfs |
| `/tmp` | tmpfs | `mode=1777` |
| `/var/lib/mos` | bind 自 `/mnt/state/mos` | mosd 设置、apid 凭据、**每设备密钥**、**shadow 文件** |
| `/var/lib/bluetooth` | bind 自 `/mnt/state/bluetooth` | 配对密钥 |
| `/etc/ssh` | bind 自 `/mnt/state/ssh` | sshd 配置、主机密钥、mosd 渲染的 drop-in |
| `/etc/hostname` | bind 自 `/mnt/state/hostname` | **文件** bind，不是目录 |
| `/etc/wpa_supplicant`、`/etc/hostapd` | bind 自 STATE | 协调器渲染的配置 |
| `/usr/local/lib/systemd/system` | bind 自 `/mnt/state/systemd-units` | 集成商装的第三方 unit。**`/usr` 内唯一的 bind 目标** |
| `/home`、`/root` | bind 自 `/mos/home`、`/mos/root` | 家目录，在 **DATA** 上 |
| **`/etc/shadow`** | **符号链接 → `/var/lib/mos/shadow`** | 不再是只读的 |
| `/run`、`/run/lock`、`/dev/shm` | tmpfs | systemd API 挂载 |

四层存储回答的是同一个问题——**「这份数据丢了会怎样」**：
STATE 是配置与身份，DATA 是应用数据与家目录，META 是更新元数据，EPHEMERAL 是可丢弃残留。

> **分区号在 M5 之后移动过。** Rockchip loader 区变成了真实的 GPT 分区 p1，
> 其后每个分区号加一。但**分区 GUID 没有移动**——GUID 里的身份数字按分区加入顺序分配、
> 一经分配就冻结。这正是为什么 verity cmdline、`/etc/fstab`、`/etc/fw_env.config`
> 和 RAUC 槽位设备都钉在 PARTUUID 上，因而无需改动。

## 5. `/etc/machine-id` —— 通过 U-Boot 环境解决

## 6. 运行时对 `/etc` 的写入者 —— 审计

## 7. 本文不覆盖的部分
