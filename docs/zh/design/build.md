# 设计：镜像构建指南 —— x64 与 cx3576

> [English](../../design/build.md) | 中文
>
> 构建指南：一次完整构建产出什么、按什么顺序跑、哪些步骤是交叉编译、哪些
> 需要模拟器，以及在相信一条报错之前如何区分 arm64 的三种能力。
> `build-harness.md` 讲的是*检查*怎么跑；本页讲的是*产物*怎么来。

所有步骤都在 docker 里执行。主机只需要带 buildx 的 docker、bash、make 和
git；主机上不安装任何工具链，每个编译器都来自 `build-env/images.env`
里按 digest 固定的 builder 镜像。

## 1. 一次构建产出什么

一块板子的构建最终在 `_out/<board>/` 下留下三样东西：

| 产物 | 由谁生成 | 是什么 |
|---|---|---|
| `<board>-mos-<epoch>.img` 与 `<board>-mos-latest.img` | `bash build/run.sh --mkimage-cx3576`（cx3576）或 `--mkimage-x64` | 可直接烧写的整盘 A/B 镜像 |
| `rootfs-verity.img` + `rootfs-verity.env` | `rootfs/build.sh` | 一个 rootfs 槽：squashfs 加 dm-verity 哈希树，以及内核命令行需要的参数 |
| RAUC 更新包 | `bash build/run.sh --bundle --board <board>` | 给已经在跑 mos 的设备用的签名更新 |

镜像文件名来自板卡定义（`boards/<board>/board.env` 里的
`IMAGE_NAME_PREFIX`、`IMAGE_LATEST_NAME`），脚本里不写死。

rootfs 能开始构建之前，必须先存在**一样**东西：`_out/debs/<arch>/` 下的本地
Debian 包仓库，由 `make os-debs` 构建并建立索引。rootfs 构建只从这个仓库安装、
自己不编译任何组件，所以仓库不存在、没建索引、索引与旁边的存档对不上、或者
版本号打的是另一个提交，都会得到一条点名 `make os-debs` 的拒绝——而不是一次
悄悄变慢、然后装进别的树的包的构建。

编译出来的组件是**打包 producer** 的输入，比 rootfs 构建更外一层：

| 输入 | 由谁构建 | 落在哪 |
|---|---|---|
| builder 镜像 `localhost/mos-build-{base,c,go,rust}:<arch>` | `build-env/build.sh` | 本地 docker 镜像库 |
| APID 内置 UI 资源树 | `pkgs/mosd/apid/ui/build.sh`，以只读源码挂载在锁定的 Bun 容器中运行，并由仓库维护的每个 APID Cargo 构建入口预先调用 | 被忽略的 `_out/apid-ui/dist/`，只读挂载进 Rust 构建容器，传给 `apid/build.rs` 后嵌入二进制 |
| RAUC | `pkgs/rauc/build.sh`，由 `rauc` producer 的 `PREPARE` 钩子驱动 | `pkgs/rauc/out-<arch>/`，打包成 `mos-rauc` |
| podman 及其六个配套二进制 | `pkgs/podman/build.sh`，由 `podman` producer 的钩子驱动 | `pkgs/podman/out-<arch>/`，打包成 `mos-podman` |
| mosd、apid、mos-mqttd、mos-mqtt-broker | `pkgs/mosd/hack/build-deb.sh`，由 `mosd` 和 `mqtt` 两个 producer 驱动 | `target-deb/<producer>/`，打包成 `mosd`、`mos-apid`、`mos-mqttd`、`mos-mqtt-broker` |

钩子能自己构建输入的 producer 会自己构建而不是停下来，而这个代价值得放在看得见
的地方付：`make os-deb-preflight` 在 `os-debs` 启动第一个容器之前，一次性列出
所有 producer 缺的全部输入，并说明其中哪些会由这次运行自己补上。

两块板都还需要各自的 BSP 构建。cx3576 的产出内核（`Image`、`modules.tar`、
`rk3576-src.dtb`）和 A/B 版 U-Boot（`u-boot-rockchip.bin`）到
`boards/cx3576/bsp/out/`，由 `board-cx3576` producer staged 进
`mos-board-cx3576`。x64 的只产出内核——UEFI 固件就是它的启动链，没有引导程序要编
——到 `boards/x64/bsp/out/kernel/`，由 `kernel-x64` producer 打包为
`mos-kernel-x64`。缺了任何一个，对应的包仓库都无法建成，而
`make os-deb-preflight` 会在任何东西开跑之前把缺失的那个点名。

输出目录名里带架构（`out-amd64`、`out-arm64`、`:amd64`、`:arm64`），两块板
的输入可以共存，构建一块板不会覆盖另一块的。

### 1.1 rootfs 是组合出来的，不是串出来的

根文件系统不再是一串按固定顺序改同一个镜像的 Dockerfile，而是**一次 APT
事务**——基底是 `build-env/images.env` 里按 digest 固定的 Debian 镜像——
再加**一个收尾器**。`rootfs/compose/` 下正好就这两个文件：

| 文件 | 做什么 |
|---|---|
| `10-compose.Dockerfile` | 以 `$TARGETPLATFORM` `FROM` 固定的 trixie 基底；在一次 `apt` 事务里把解析出来的包集合从 `_out/debs/<arch>/` 装进去。包仓库是 bind mount，解析结果是 COPY 进去的；这个 Dockerfile 自己不做任何选择 |
| `90-pack.Dockerfile` | 收尾：封根（清单、包管理器日志抓取、清除包管理、构建报告），做 `/var`、machine-id、resolver 和 shadow 的树手术，跑整树断言，做 squashfs，追加 dm-verity 树，导出两个交付面 |

过去分别是底座阶段、只读根接线阶段、四个特性阶段和板卡阶段的东西，现在都是包
元数据：`mos-system`、`mos-ca-trust`、`mos-profile-{dev,prod}` 二选一、
`mos-wifi`、`mos-wifi-ap`、`mos-bluetooth`、`mos-podman`、`mos-rauc`、`mosd`、
`mos-apid`、`mos-mqttd`、`mos-mqtt-broker`，再加一个 `mos-board-<board>`。
**决定配置顺序的是 `Depends`，不是文件名里的数字**——而一次 apt 事务在构造上
就是原子的，所以已经没有任何东西需要一条阶段边界把它们隔开。

`build/src/stages-cli.ts` 仍然原封不动地串这两个文件：它在被指向的目录里
发现 `<数字>-<名字>.Dockerfile`，按数字顺序构建，把上一个的镜像交给下一个，
并导出最后一个的 `artifact` 和 `factory-root` 目标。它完全不知道自己被指向的
是哪个目录，所以组合路径不需要第二个驱动。

**选择是一次解析。** `rootfs/packages/resolve.sh` 把板卡、profile、射频集合
和拒绝列表全部作为参数接收，然后打印包名；四个输入都由
`rootfs/build.sh` 决定，解析器一个都不自己重新推导。拒绝一个特性就是
*少点几个包*——`MOS_ROOTFS_WITHOUT`，`WITH_CONTAINERS=0` 和 `WITH_MOSD=0` 折进
同一个列表——而一个匹配不到任何东西的特性名会被拒绝，不会悄悄构建出完整镜像。

**让 dev 镜像保持 dev 的，只有这次显式的 profile 选择**，所以解析器**拒绝任何
没有恰好点到一个 profile 包的解析结果**。两种失败在下游都看不见：一个都没有
时，mosd 大小写敏感的 `read_profile` fail-closed，镜像按生产行为跑而所有 gate
全绿；有两个时，`mos-profile-dev` 和 `mos-profile-prod` 按名字 `Conflict`，
APT 直接拒绝这次事务。这个计数是在*解析出来的集合*上做的，而不是从
"`--profile` 已经挑了一个 manifest" 推出来的——因为任何一个 manifest 都可以
点名一个 profile 包。

**启用是包自带的符号链接载荷。** 这条路径上没有任何东西调用
`systemctl enable`——组合器不调，脚本不调，maintainer script 也不调。每个包
自己带 `multi-user.target.wants/` 符号链接，并在自己的 `producer.env`
`ENABLEMENT` 字段里声明带了几个。这个理由来自那次退役旧链的比对，并且比它
活得更久：*一个未被批准的 `removed`，说的是旧链会装、而没有任何包认领的文件，
修法是找一个 owner，不是写一条豁免条款。* 一种"缺席"——"这里故意没有
`ssh.service` 链接"——扛不住另一个包的 postinst；只有载荷扛得住。

**板卡 drop-in 是派生集合，而且这种跟踪是静默的。** 一块板要改*通用*单元时，
把这个改动记成 overlay 内容，`mos-board-<board>` 会把该板 overlay
`etc/systemd/system/` 下每一个 `*.d` drop-in 目录整个装进去，而不是一个个点名
——和旁边 repart 定义同一条派生规则，而且这个 glob 只取 drop-in 目录，绝不会
取到单元文件本身。后果要直说：**板卡载荷会静默地跟随 overlay 的 `*.d` 内容。**
往板卡 overlay 里加一个 drop-in 就会把它装进镜像，别处不用改一行，也没有任何
一行 diff 会说某个包变大了。

#### keyring 是例外，而且它不是 CA 信任库

两条读者一定会混淆的接缝，除非文字把它们分开。本次迁移中就混淆过一次，并被
纠正：

| 接缝 | 归谁 | 决定什么 |
|---|---|---|
| `/etc/ssl/certs/ca-certificates.crt`、`/usr/share/ca-certificates` 下的锚点、`/etc/ca-certificates.conf` | `mos-ca-trust`——**包载荷** | **TLS 信任库**：设备向外发起连接时相信哪些证书颁发机构 |
| `/etc/rauc/keyring.pem` | **不归任何包**；由 `rootfs/build.sh` 从 `meta/rauc/ca.cert.pem` staged 进去 | **RAUC 信任根**：这台设备愿意安装谁签名的更新包 |

keyring 是任何包都不可以携带的、每次构建各自的信任材料：一个包是一份产物、装进
很多个镜像，而操作者放进仓库根 `meta/rauc/` 的那个 CA 是关于*这一次*构建的决定。
所以 `build.sh` 自己把它复制进组合上下文，并**拒绝**留在
`rootfs/overlay/etc/rauc/keyring.pem` 的 keyring——overlay 会被整份复制
进每一个镜像，留在那里的文件就是一个没人选择过的信任根——而当材料旁边的
`meta/GENERATED` 标记它是开发级时发出警告。校验期读的是同一个标记，并把读到的
等级写进判定。

#### 两条路径不一致的地方，对的是组合这一条

这不是被删除动作随手打破的一个平局。下面每一条都是实测的：

- **账号 last-change 日期。** `10-compose` 声明了 `ARG SOURCE_DATE_EPOCH`，
  所以整个 apt 事务都在它之下运行，`useradd` 给 `messagebus`、`sshd`、
  `systemd-network`、`systemd-resolve` 四个账号写进去的是 `18262`
  （2020-01-01）——落在 `/etc/shadow-` 和 `/usr/share/factory/etc/shadow`。
  旧链的 postinst 看到的是墙上时钟，把构建日期写进了一个签名根。这是实测而
  非推理：在固定的基底镜像里，`useradd -r probe` 在设了变量时给出
  `SOURCE_DATE_EPOCH / 86400`，没设时给出当天的天数。
- **随依赖进出的库。** 拒绝 `rauc` 拿掉的是一组**包**，不是一组库：
  `mos-rauc` 本身，加上只有它的 `${shlibs:Depends}` 会拉进来的 `libjson-glib`
  系列包——`libjson-glib-1.0-0`，而它自己又 `Depends: libjson-glib-1.0-common`。
  旧链是无条件安装这些的。一个库跟着它的使用者一起来、一起走，正是依赖系统在
  正常工作，所以这条被裁定为*记录，不设 gate*。这条裁定附带一个条件：任何其他
  依赖这些库的组件都必须自己声明依赖，而完整根查不出来——`mos-rauc` 装着的时候，
  不管包有没有声明，每个 ELF 都能解析。`tests/install-closure-gate.sh` 正是
  为此单独构建一个拒绝了 rauc 的根，每次运行都打印两个根实际相差的包集合；
  如果某次运行里只有 `mos-rauc` 一个包离开，它会把这次报成*空搜索空间*，而不是
  拿来当证明引用。
- **构建残留。** `/run/crun` 出现在旧链的根里，是因为旧链在装配期间会实际
  跑一次容器引擎。这不是签名根该带的东西，也不该由任何包认领。

删除旧链背后完整的书面推理——每一条被判过的差异，包括那些被消除而不是被批准的
——在 `tests/dual-build-sanctions.md`。

## 2. 一次性准备

**按架构准备 builder 镜像。** 每个组件构建都 `FROM` 一个
`localhost/mos-build-*:<arch>` 标签，标签里的架构是*目标*的架构：

```sh
MOS_BUILD_PLATFORM=linux/amd64 bash build-env/build.sh   # 给 x64
MOS_BUILD_PLATFORM=linux/arm64 bash build-env/build.sh   # 给 cx3576
```

`make build-env` 构建的是主机自己架构的那一族。另一架构是另一组标签；组件
构建发现自己那一族不在时会点名拒绝（`LOCAL_MOS_BUILD_BASE resolves to
localhost/mos-build-base:amd64, which is not in the local docker image
store`），而不是去一个叫 `localhost` 的 registry 拉取。

**信任根：`meta/rauc/`。** 仓库根目录下的 `meta/` 存放一次发布所需的全部配置与
签名材料，已 gitignore；其中 `meta/rauc/` 是签名 CA 进入构建的唯一入口。
`build/run.sh --bundle` 用 `meta/rauc/signer.cert.pem` 和
`meta/rauc/signer.key.pem` 签名；`rootfs/build.sh` 把 `meta/rauc/ca.cert.pem`
放进镜像的 `/etc/rauc/keyring.pem`——镜像因此能安装同一批构建出来的 bundle。

离开 `meta/` 进入镜像的只有 `rootfs/build.sh` 里允许清单点名的文件：上面那份
证书和 `meta/updates/manifest.json`，两者都是必需的；再加上按条件暂存的
`meta/GENERATED`——当且仅当它存在时才进镜像，好让镜像自己说明所用材料是不是
开发级的。所有私钥都留在构建主机上，并由两道检查守住——构建拒绝暂存清单以外的
路径、以及任何带私钥材料的文件；镜像校验器则拒绝一个含有私钥的成品镜像（无论它
是从哪条路径进去的），也拒绝标记与树中状态两个方向上任一不一致的镜像。

不需要先跑任何东西。构建发现 `meta/` 不存在、或四个 RAUC 文件缺了任何一个时，会
在那里生成一套开发级信任根，打印一条醒目的通知，然后继续。`make os-devkeys` 是
同一件事的手动入口，可以在构建前先做；`bash pkgs/rauc/gen-dev-keys.sh --force`
用于轮换，代价是所有已用旧密钥签名的 bundle 都会验签失败。更新包签名密钥属于另一
个域，**需要显式开启**：`bash pkgs/rauc/gen-dev-keys.sh --domain updates`——一把
没有任何已发布仓库用它签过东西的开发密钥，锚定不了任何信任关系。

生成器铸造的每一把密钥用什么签名算法，是 `pkgs/rauc/key-algorithms.env` 里声明
的值，每一行旁边写着理由；`rootfs/build.sh` 拒绝角色允许集合以外的声明值，也拒绝
`meta/` 里超出该集合的材料。改算法是改那个文件的一行；放宽集合是改代码，并且是对
某个验证器作出的断言。

生成器会在材料旁边留下 `meta/GENERATED`，并在其中写明它生成了哪些域。这个标记让
"生成的材料"和"提供的生产材料"在此后每一次构建里都可区分，而不只是在生成它的那
一次。`rootfs/build.sh` 的"镜像信任的是开发 RAUC keyring"警告就以它为唯一依据:
没有任何构建期变量可以声明一个台架镜像。生产发布把真实材料放进 `meta/`，
并且不带这个标记。

有两条规则没变。`CERT`/`KEY`/`KEYRING` 仍然优先于约定——三个都设置时不会生成
任何东西，也不会读 `meta/rauc/` 里的任何文件。放在
`rootfs/overlay/etc/rauc/keyring.pem` 的 keyring 仍然被拒绝，而且现在是
无条件拒绝：overlay 会被整份复制进每一个镜像，留在那里的文件就是一个没人选择过
的 CA，而 `meta/rauc/` 是唯一被认可的来源。由于现在每个镜像都带 keyring，
`make os-verify-<board>` 对两种等级的材料都通过，并在判定里写明它读到的是哪一种。

keyring 是 mos 根里唯一**不是**包载荷的路径，而且它和 `mos-ca-trust` 提供的
TLS 信任库是两条不同的接缝——1.1 节把两者并排列出。

## 3. x64 全流程

在 amd64 主机上每一步都是原生执行。按顺序：

```sh
MOS_BUILD_PLATFORM=linux/amd64 bash build-env/build.sh
bash pkgs/rauc/gen-dev-keys.sh   # 可选：meta/ 不存在时构建会自己生成
MOS_BOARD=x64 bash pkgs/rauc/build.sh
MOS_ARCH=amd64 bash pkgs/podman/build.sh
make os-debs                                   # 包仓库，以及它的索引
MOS_BOARD=x64 bash rootfs/build.sh       # 等价于 make os-rootfs-x64-composed
bash build/run.sh --mkimage-x64
bash verify/run.sh --verify --board x64
bash build/run.sh --bundle --board x64
```

大多数步骤有 `make` 写法（`make os-rauc`、`make podman`、
`make os-verify-cx3576`），但它们的默认值是 cx3576 和 arm64，所以给 x64
构建时环境变量不能省。rootfs 构建的最后一步是 smoke：在刚打包好的根里执行
新编出来的二进制；x64 上这是原生 `docker run`，不需要额外准备。

包仓库上面那两步组件构建在一个意义上是可选的：`rauc` 和 `podman` 两个 producer
在自己的输出目录为空时会从 `PREPARE` 钩子里把它们跑起来——但 podman 那一次大约
是四十五分钟、跨四套语言工具链编译六个上游克隆，所以先跑一遍，是把这个代价付在
看得见的地方，而不是付在一个打包钩子内部。`make os-debs` 必须在它们**之后**、
在 rootfs 构建**之前**跑：`build.sh` 会拒绝一个版本号不等于本树版本号的仓库，
包括未提交改动给任何一侧加上的 `.dirty` 后缀。

产物用 `pkgs/mosd/tests/apid-api/` 下的 QEMU 台架启动，它以
`_out/x64/x64-mos-latest.img` 为输入，自己不构建任何东西。

## 4. cx3576：哪些交叉编译、哪些模拟、哪些要主机配合

amd64 主机有三条路到达 arm64，下面每一步恰好用其中一条：

- **交叉编译** —— 编译器以主机架构运行，输出 arm64 代码。除 docker 外什么都不需要。
- **buildkit 内模拟** —— `docker-container` 驱动的 builder 自带 QEMU，能执行
  arm64 的 `RUN` 步骤。主机同样不需要任何东西；builder 首次使用时自动创建，
  名为 `mos-arm64`。
- **daemon 内模拟** —— `docker run --platform linux/arm64` 和 `default`
  builder 通过主机内核的 `binfmt_misc` 执行 arm64。需要**在主机上**做一次注册。

| 步骤 | 命令 | 路径 | 需要主机 binfmt |
|---|---|---|---|
| arm64 builder 镜像族 | `MOS_BUILD_PLATFORM=linux/arm64 bash build-env/build.sh` | buildkit 内模拟 | 否 |
| U-Boot 两个变体 | `make cx3576-uboot cx3576-uboot-mos` | 交叉编译（amd64 Ubuntu 阶段里 `CROSS_COMPILE=aarch64-linux-gnu-`）；镜像用 `uboot-mos`，校验器拿 debug 变体与之比对以证明配对 | 否 |
| 内核 | `make cx3576-kernel` | 交叉编译，同一套工具链 | 否 |
| RAUC | `make os-rauc`（默认 `MOS_BOARD=cx3576`） | 主机有 binfmt 用 `default`，否则用 `mos-arm64` 并把 builder 镜像以 OCI layout 交给它 | 否 |
| podman | `make podman`（默认 `MOS_ARCH=arm64`） | 同 RAUC；源码阶段在构建平台上用 amd64 基础镜像运行 | 否 |
| mosd 一族 | `mosd` 与 `mqtt` 两个 producer 通过 `pkgs/mosd/hack/build-deb.sh` 调用 | 交叉编译：`mos-build-rust:amd64` 里 cargo target `aarch64-unknown-linux-gnu` | 否 |
| 包仓库 | `make os-debs` | 各 producer 各走上面自己那一条；打包阶段本身只是带 `Architecture` 标记的文件复制 | 否 |
| rootfs 组合 | `bash rootfs/build.sh`（默认 `MOS_BOARD=cx3576`） | 主机有 binfmt 用 `default`，否则用 `mos-arm64` 并以 OCI layout 串接那两个文件（4.1 节） | 否 |
| smoke | rootfs 构建的最后一步 | daemon 能执行 arm64 就 `docker run`，否则在 `mos-arm64` 上每个二进制做一次一次性构建 | 否 |
| 磁盘镜像 | `bash build/run.sh --mkimage-cx3576` | 纯文件拼装 | 否 |
| 镜像校验 | `make os-verify-cx3576` | 只从镜像里读文件 | 否 |
| 更新包 | `make os-bundle-cx3576` | 在 amd64 容器里跑 `rauc bundle` | 否 |

也就是说，cx3576 的全部内容都能在没有任何主机级模拟的 amd64 主机上构建。
按顺序：

```sh
MOS_BUILD_PLATFORM=linux/arm64 bash build-env/build.sh
bash pkgs/rauc/gen-dev-keys.sh   # 可选：meta/ 不存在时构建会自己生成
make cx3576-uboot cx3576-uboot-mos
make cx3576-kernel
make os-rauc
make podman
make os-debs
bash rootfs/build.sh
bash build/run.sh --mkimage-cx3576
make os-verify-cx3576
make os-bundle-cx3576
```

`BOARD_DIR=/path/to/bsp` 可以让 rootfs 构建和拼装器使用预构建的 BSP 产物
（目录下有 `out/kernel/` 和 `out/uboot-mos/`），内核编一次就能服务多次
rootfs 构建。

### 4.1 rootfs 组合如何不靠主机到达 arm64

组合是两个 Dockerfile（1.1 节），第二个以 `FROM ${MOS_STAGE_PREV}` 开头。
`build/src/stages-cli.ts` 按 builder 的驱动类型从两种方式里选一种把它们连起来：

- **tag 模式**，`docker` 驱动：第一个文件的产物是 daemon 镜像库里的一个 tag，
  收尾器的 `FROM` 在那里找到它。这个驱动执行 arm64 只能靠主机 `binfmt_misc`，
  所以这是原生构建的路线，也是已注册模拟器的主机的路线。
- **layout 模式**，`docker-container` builder：产物导出为 `_out/<board>/stages/`
  下的一个 OCI layout，并以下一段 `FROM` 所写的那个 tag 为名作为命名 build
  context 交出去。全程不碰 daemon 的镜像库，arm64 步骤由 builder 自带的 QEMU
  执行。

`build.sh` 像 RAUC 和 podman 一样选 builder——`default` 够得着目标平台就用它，
否则用 `mos-<arch>`；最后的 smoke 在 daemon 无法执行该根时改为在同一个 builder 里
执行寄存器中的每一项，每个二进制一次一次性构建，寄存器和判定逻辑不变。layout
模式的代价是每一次交接都要把根的各层经 docker socket 复制一遍，而组合把交接次数
从八次降到了一次。

两种模式都早于组合，也都不是组合专有的：驱动拿到的只是一个装着编号 Dockerfile
的目录，此外一无所知。layout 模式出现之前，驱动拒绝 `docker` 之外的任何 builder，
交叉构建因此需要主机 binfmt。layout 模式在不往构建路径里放 registry 的前提下，
把走容器 builder 这条路还了回来。

## 5. amd64 主机上的 arm64：靠执行来判断，不靠查看

三个问题、三条命令，任何一个的答案都不能推出另一个。`docker buildx ls` 和
`docker buildx inspect` 在有些主机上会少报——一个明明能执行 arm64 的 builder
被列成 `linux/amd64 (+3), linux/386`——所以这些问题都不能靠看表格来定。

**buildkit 能模拟吗？** 在容器 builder 上做一次一次性构建：

```sh
printf 'FROM alpine:3.21\nRUN uname -m\n' | \
  docker buildx build --builder mos-arm64 --platform linux/arm64 --no-cache --progress=plain -
```

`RUN` 输出里出现 `aarch64`，说明 RAUC、podman 和 arm64 builder 镜像族都能构建。
如果 `docker buildx ls` 里没有这个 builder，先创建：
`docker buildx create --name mos-arm64 --driver docker-container`。

**daemon 能执行吗？** 这是 tag 模式和 `docker run` 问的问题；layout 模式和
buildkit smoke 执行器不需要它：

```sh
docker run --rm --platform linux/arm64 alpine:3.21 uname -m
```

`aarch64` 表示能；`exec /bin/uname: exec format error` 表示不能。旁边再跑一条
`docker run --rm alpine:3.21 uname -m` 做对照：主机负载高时创建容器会超时，
`context canceled` 看起来像 arm64 的结论，其实只是 daemon 忙。

**在主机上注册模拟器**是可选的：注册后 rootfs 组合会在 `default` builder 上走
tag 模式，比 layout 模式快。下面任一种，都要**在主机上**执行，而不是在一个只挂载
了 docker socket 的容器里——在容器里做的注册曾被观察到报告成功却对 daemon
毫无影响：

```sh
# 任何发行版，通过 docker 本身
docker run --privileged --rm tonistiigi/binfmt --install arm64

# Fedora / RHEL 系，重启后仍然有效
sudo dnf install -y qemu-user-static
sudo systemctl restart systemd-binfmt
```

然后重跑上面的 daemon 检查；`default` builder 的平台列表
（`docker buildx inspect default`）会同时多出 `linux/arm64`，这正是
`build.sh` 用的判断。撤销用 `--uninstall arm64` 或卸载软件包。

**完全不需要模拟器的事。** 从 arm64 镜像里读字节——
`docker create --platform linux/arm64 ... && docker cp`——在任何主机上都行，
这就是镜像校验和更新包构建能在任何主机上跑的原因。

## 6. 读懂报错

| 报错 | 含义 | 处理 |
|---|---|---|
| `LOCAL_MOS_BUILD_BASE resolves to localhost/mos-build-base:<arch>, which is not in the local docker image store` | 那个架构的 builder 镜像族没构建过，或是用旧的不带架构的标签构建的 | `MOS_BUILD_PLATFORM=linux/<arch> bash build-env/build.sh` |
| `note: the 'default' builder cannot reach linux/arm64 on this host; using the docker-container builder 'mos-arm64'` | 不是错误：rootfs 组合正在走 layout 模式 | 不用处理；想要更快的 tag 模式再在主机上注册模拟器（第 5 节） |
| 构建过程中的 `exec /bin/sh: exec format error` | 要么没有模拟器，**要么**在 `--platform` 下用了单架构的 `localhost/` 基础镜像（标签没有索引可选，buildkit 直接用它持有的那份且不套模拟器） | 先检查 daemon（第 5 节）；能执行的话就是该阶段的基础镜像架构不对——见 `build-harness.md` 5.1 节 |
| `docker-container` builder 报 `pull access denied ... localhost/...` | 把本地标签交给了读不到镜像库的 builder | 改用 `default` builder，或把镜像以 OCI layout 交过去（`build-env/from.sh --contexts=`） |
| `modules.tar not found` | cx3576 内核没构建，或 `BOARD_DIR` 指错了 | `make cx3576-kernel`，或设置 `BOARD_DIR` |
| `pkgs/rauc/out-<arch>/rauc not found` / `pkgs/podman/out-<arch>/podman not found` | 组件构建的是另一架构，或根本没构建 | `MOS_BOARD=<board> make os-rauc`、`MOS_ARCH=<arch> make podman` |
| `_out/debs/<arch> does not exist` / `... holds no .deb at all` / `... carries no usable index` | 那个架构没有包仓库，或者 `repo.sh` 从没为它建过索引 | `make os-debs` |
| `the <arch> pool was built at version '...' and this tree is '...'` | 仓库是另一个提交的，或者某一侧因为有未提交改动带上了 `.dirty` | 先提交，再重跑 `make os-debs`——否则会把另一棵树的包装进一个之后每项检查都会算在本树头上的镜像 |
| `the resolution names package(s) the <arch> pool does not contain` | 解析结果里的某个 producer 没为这个架构构建过；报错会为每个包点名对应的 `make os-deb-<producer>` | 跑掉它们，然后 `make os-debs` 重建索引 |
| 校验器报 `mqttd: the unit runs as 'mos-mqttd' and no such account` | MQTT 的单元进了根，但它们的包该建的账号没建 | 去看 `mqtt` producer 的账号处理。这不是"拒绝 mosd 却保留 mqtt"的症状：`mos-mqttd` 依赖 `mosd`，那种组合会被 APT 按名字拒绝 |

停在上述任一报错的构建不会在 `_out/<board>/` 留下任何它以后会信任的东西：
每个消费者都按名字重新检查自己的输入。

## 7. 验证

**下面两次运行都早于旧链的删除。** 当时 rootfs 还是那条九文件的 stage 链装出来
的，所以它们确立的是第 4 节的 arm64 路由——builder 选择、layout 模式和 buildkit
smoke 执行器——而不是 1.1 节的组合路径。它们作为那条路由的记录保留；组合路径
自己的验收是 PLAN-036 的 dual-build gate 以及它写下的账本
`tests/dual-build-sanctions.md`。

*2026-08-30 与 2026-08-31 在本机测得。* 第 3 节的 x64 序列按原样在一个 shell
里跑通，主机为 amd64、docker 28、没有主机 binfmt。同一主机上
`docker run --rm --platform linux/arm64 alpine:3.21 uname -m` 回答
`exec /bin/uname: exec format error`。x64 镜像通过
`bash verify/run.sh --verify --board x64` 292/292（22 项 skip，x64/grub），
并构建了签名的 RAUC bundle。

第 4 节的 cx3576 序列此后在同一台无 binfmt 的主机上端到端跑通，两天各一次，
走的是 4.1 节的 layout 模式：rootfs 链在 `mos-arm64` builder 上构建、每级以
OCI layout 交接；smoke 通过 buildkit 执行器运行打包根内的自建二进制，报告
`11 pass, 1 executor-limited (crun), 0 fail`——crun 的 memfd 重执行是模拟器
的已记录限制，作为独立判定而非通过上报；组装出的镜像通过
`make os-verify-cx3576` 395/395，并构建且回读验签了 RAUC bundle。全程无
tag 进入镜像存储，也未注册任何 binfmt。

2026-08-31 之前那次报的 394 是还没有 `verity-hash-start-no-superblock`
（见 `ro-root.md` 第 1 节）的检查表。两个数字都是绿的，但只有后一个说的是一个
能启动的镜像：当天新增的这项检查读的是 `hash_start_block` 处到底是什么，而
那些 394 绿过的镜像那里放的都是 verity 超级块。拿其中一个重跑，检查表会以
FAIL 报出它读到的 magic。
