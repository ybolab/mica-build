# 设计：镜像构建指南 —— x64 与 cx3576

> [English](../../design/build.md) | 中文
>
> 构建指南：一次完整构建产出什么、按什么顺序跑、哪些步骤是交叉编译、哪些
> 需要模拟器，以及在相信一条报错之前如何区分 arm64 的三种能力。
> `build-harness.md` 讲的是*检查*怎么跑；本页讲的是*产物*怎么来。

所有步骤都在 docker 里执行。主机只需要带 buildx 的 docker、bash、make 和
git；主机上不安装任何工具链，每个编译器都来自 `os/build-env/images.env`
里按 digest 固定的 builder 镜像。

## 1. 一次构建产出什么

一块板子的构建最终在 `_out/<board>/` 下留下三样东西：

| 产物 | 由谁生成 | 是什么 |
|---|---|---|
| `<board>-mos-v2-<epoch>.img` 与 `<board>-mos-v2-latest.img` | `bash os/build/run.sh --mkimage-v2`（cx3576）或 `--mkimage-x64` | 可直接烧写的整盘 A/B 镜像 |
| `rootfs-verity.img` + `rootfs-verity.env` | `os/rootfs/build-v2.sh` | 一个 rootfs 槽：squashfs 加 dm-verity 哈希树，以及内核命令行需要的参数 |
| RAUC 更新包 | `bash os/build/run.sh --bundle --board <board>` | 给已经在跑 mos 的设备用的签名更新 |

镜像文件名来自板卡定义（`os/boards/<board>/board.env` 里的
`IMAGE_NAME_PREFIX`、`IMAGE_LATEST_NAME`），脚本里不写死。

rootfs 能开始构建之前，四样编译输入必须先存在。它们都不会按需构建：各有
自己的入口和输出目录，rootfs 构建会点名缺哪一个：

| 输入 | 由谁构建 | 落在哪 |
|---|---|---|
| builder 镜像 `localhost/mos-build-{base,c,go,rust}:<arch>` | `os/build-env/build.sh` | 本地 docker 镜像库 |
| RAUC | `os/pkgs/rauc/build.sh` | `os/pkgs/rauc/out-<arch>/` |
| podman 及其六个配套二进制 | `os/pkgs/podman/build.sh` | `os/pkgs/podman/out-<arch>/` |
| mosd、apid、mos-mqttd、mos-mqtt-broker | `os/pkgs/mosd/hack/build-target.sh` | `_out/<board>/mosd/`（这一项由 rootfs 构建自己调用） |

cx3576 还需要它的 BSP：内核（`Image`、`modules.tar`、`rk3576-src.dtb`）和
A/B 版 U-Boot（`u-boot-rockchip.bin`），由 `os/boards/cx3576/bsp/Makefile`
构建到 `os/boards/cx3576/bsp/out/`。x64 没有 BSP：UEFI 固件负责引导，内核
是 rootfs 链安装的 Debian `linux-image-amd64`。

输出目录名里带架构（`out-amd64`、`out-arm64`、`:amd64`、`:arm64`），两块板
的输入可以共存，构建一块板不会覆盖另一块的。

## 2. 一次性准备

**按架构准备 builder 镜像。** 每个组件构建都 `FROM` 一个
`localhost/mos-build-*:<arch>` 标签，标签里的架构是*目标*的架构：

```sh
MOS_BUILD_PLATFORM=linux/amd64 bash os/build-env/build.sh   # 给 x64
MOS_BUILD_PLATFORM=linux/arm64 bash os/build-env/build.sh   # 给 cx3576
```

`make build-env` 构建的是主机自己架构的那一族。另一架构是另一组标签；组件
构建发现自己那一族不在时会点名拒绝（`LOCAL_MOS_BUILD_BASE resolves to
localhost/mos-build-base:amd64, which is not in the local docker image
store`），而不是去一个叫 `localhost` 的 registry 拉取。

**签名密钥。** `make os-devkeys` 在 `os/pkgs/rauc/.devkeys/`（已 gitignore）
生成开发用 CA 和签名证书，bundle 步骤用它们签名。镜像*不会*信任这套密钥，
除非把 keyring 复制到 `os/rootfs/overlay-v2/etc/rauc/keyring.pem` 并以
`MOS_EXPECT_DEV_KEYRING=1` 构建 rootfs——只对需要安装本地签名更新包的台架
设备这么做，任何要离开台架的东西都不要。

## 3. x64 全流程

在 amd64 主机上每一步都是原生执行。按顺序：

```sh
MOS_BUILD_PLATFORM=linux/amd64 bash os/build-env/build.sh
bash os/pkgs/rauc/gen-dev-keys.sh
MOS_BOARD=x64 bash os/pkgs/rauc/build.sh
MOS_ARCH=amd64 bash os/pkgs/podman/build.sh
MOS_BOARD=x64 bash os/rootfs/build-v2.sh
bash os/build/run.sh --mkimage-x64
bash os/verify/run.sh --verify --board x64
bash os/build/run.sh --bundle --board x64
```

大多数步骤有 `make` 写法（`make os-rauc`、`make podman`、
`make os-verify-cx3576-v2`），但它们的默认值是 cx3576 和 arm64，所以给 x64
构建时环境变量不能省。rootfs 构建的最后一步是 smoke：在刚打包好的根里执行
新编出来的二进制；x64 上这是原生 `docker run`，不需要额外准备。

产物用 `os/pkgs/mosd/tests/apid-api/` 下的 QEMU 台架启动，它以
`_out/x64/x64-mos-v2-latest.img` 为输入，自己不构建任何东西。

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
| arm64 builder 镜像族 | `MOS_BUILD_PLATFORM=linux/arm64 bash os/build-env/build.sh` | buildkit 内模拟 | 否 |
| U-Boot 两个变体 | `make cx3576-uboot cx3576-uboot-mos` | 交叉编译（amd64 Ubuntu 阶段里 `CROSS_COMPILE=aarch64-linux-gnu-`）；镜像用 `uboot-mos`，校验器拿 debug 变体与之比对以证明配对 | 否 |
| 内核 | `make cx3576-kernel` | 交叉编译，同一套工具链 | 否 |
| RAUC | `make os-rauc`（默认 `MOS_BOARD=cx3576`） | 主机有 binfmt 用 `default`，否则用 `mos-arm64` 并把 builder 镜像以 OCI layout 交给它 | 否 |
| podman | `make podman`（默认 `MOS_ARCH=arm64`） | 同 RAUC；源码阶段在构建平台上用 amd64 基础镜像运行 | 否 |
| mosd 一族 | rootfs 构建通过 `os/pkgs/mosd/hack/build-aarch64.sh` 自行调用 | 交叉编译：`mos-build-rust:amd64` 里 cargo target `aarch64-unknown-linux-gnu` | 否 |
| rootfs 链 | `bash os/rootfs/build-v2.sh`（默认 `MOS_BOARD=cx3576`） | 主机有 binfmt 用 `default`，否则用 `mos-arm64` 并以 OCI layout 串接各 stage（4.1 节） | 否 |
| smoke | rootfs 构建的最后一步 | daemon 能执行 arm64 就 `docker run`，否则在 `mos-arm64` 上每个二进制做一次一次性构建 | 否 |
| 磁盘镜像 | `bash os/build/run.sh --mkimage-v2` | 纯文件拼装 | 否 |
| 镜像校验 | `make os-verify-cx3576-v2` | 只从镜像里读文件 | 否 |
| 更新包 | `make os-bundle-cx3576` | 在 amd64 容器里跑 `rauc bundle` | 否 |

也就是说，cx3576 的全部内容都能在没有任何主机级模拟的 amd64 主机上构建。
按顺序：

```sh
MOS_BUILD_PLATFORM=linux/arm64 bash os/build-env/build.sh
bash os/pkgs/rauc/gen-dev-keys.sh
make cx3576-uboot cx3576-uboot-mos
make cx3576-kernel
make os-rauc
make podman
bash os/rootfs/build-v2.sh
bash os/build/run.sh --mkimage-v2
make os-verify-cx3576-v2
make os-bundle-cx3576
```

`BOARD_DIR=/path/to/bsp` 可以让 rootfs 构建和拼装器使用预构建的 BSP 产物
（目录下有 `out/kernel/` 和 `out/uboot-mos/`），内核编一次就能服务多次
rootfs 构建。

### 4.1 rootfs 链如何不靠主机到达 arm64

rootfs 不是一个 Dockerfile 而是一条链：`os/rootfs/stages/` 每个阶段一个文件，
第一个之后的每个阶段都以 `FROM ${MOS_STAGE_PREV}` 开头。stage 驱动
（`os/build/src/stages-cli.ts`）按 builder 的驱动类型从两种方式里选一种串链：

- **tag 模式**，`docker` 驱动：每个 stage 是 daemon 镜像库里的一个 tag，下一段
  的 `FROM` 在那里找到它。这个驱动执行 arm64 只能靠主机 `binfmt_misc`，所以这是
  原生构建的路线，也是已注册模拟器的主机的路线。
- **layout 模式**，`docker-container` builder：每个 stage 导出为
  `_out/<board>/stages/` 下的一个 OCI layout，并以下一段 `FROM` 所写的那个 tag
  为名作为命名 build context 交给下一段。全程不碰 daemon 的镜像库，arm64 步骤由
  builder 自带的 QEMU 执行。

`build-v2.sh` 像 RAUC 和 podman 一样选 builder——`default` 够得着目标平台就用它，
否则用 `mos-<arch>`；最后的 smoke 在 daemon 无法执行该根时改为在同一个 builder 里
执行寄存器中的每一项，每个二进制一次一次性构建，寄存器和判定逻辑不变。
`os/rootfs/stages/README.md` 记录了实测和代价：每一段要把根的各层经 docker
socket 复制一次。

layout 模式出现之前，驱动拒绝 `docker` 之外的任何 builder，交叉构建因此需要主机
binfmt；stage 拆分拿掉了单 Dockerfile 时代回退到容器 builder 的能力。layout
模式在不往构建路径里放 registry 的前提下把这个能力还了回来。

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

**在主机上注册模拟器**是可选的：注册后 rootfs 链会在 `default` builder 上走
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
`build-v2.sh` 用的判断。撤销用 `--uninstall arm64` 或卸载软件包。

**完全不需要模拟器的事。** 从 arm64 镜像里读字节——
`docker create --platform linux/arm64 ... && docker cp`——在任何主机上都行，
这就是镜像校验和更新包构建能在任何主机上跑的原因。

## 6. 读懂报错

| 报错 | 含义 | 处理 |
|---|---|---|
| `LOCAL_MOS_BUILD_BASE resolves to localhost/mos-build-base:<arch>, which is not in the local docker image store` | 那个架构的 builder 镜像族没构建过，或是用旧的不带架构的标签构建的 | `MOS_BUILD_PLATFORM=linux/<arch> bash os/build-env/build.sh` |
| `note: the 'default' builder cannot reach linux/arm64 on this host; using the docker-container builder 'mos-arm64'` | 不是错误：rootfs 链正在走 layout 模式 | 不用处理；想要更快的 tag 模式再在主机上注册模拟器（第 5 节） |
| 构建过程中的 `exec /bin/sh: exec format error` | 要么没有模拟器，**要么**在 `--platform` 下用了单架构的 `localhost/` 基础镜像（标签没有索引可选，buildkit 直接用它持有的那份且不套模拟器） | 先检查 daemon（第 5 节）；能执行的话就是该阶段的基础镜像架构不对——见 `build-harness.md` 5.1 节 |
| `docker-container` builder 报 `pull access denied ... localhost/...` | 把本地标签交给了读不到镜像库的 builder | 改用 `default` builder，或把镜像以 OCI layout 交过去（`os/build-env/from.sh --contexts=`） |
| `modules.tar not found` | cx3576 内核没构建，或 `BOARD_DIR` 指错了 | `make cx3576-kernel`，或设置 `BOARD_DIR` |
| `os/pkgs/rauc/out-<arch>/rauc not found` / `os/pkgs/podman/out-<arch>/podman not found` | 组件构建的是另一架构，或根本没构建 | `MOS_BOARD=<board> make os-rauc`、`MOS_ARCH=<arch> make podman` |
| 校验器报 `mqttd: the unit runs as 'mos-mqttd' and no such account` | 拒绝了 `mqtt` 特性阶段但单元文件仍然装进去了 | 带上该阶段构建，或连 mosd 一起拒绝 |

停在上述任一报错的构建不会在 `_out/<board>/` 留下任何它以后会信任的东西：
每个消费者都按名字重新检查自己的输入。

## 7. 验证

*2026-08-30 在本机测得。* 第 3 节的 x64 序列按原样在一个 shell 里跑通，主机为
amd64、docker 28、没有主机 binfmt。同一主机上
`docker run --rm --platform linux/arm64 alpine:3.21 uname -m` 回答
`exec /bin/uname: exec format error`，而从构建容器内部无法注册模拟器，所以
cx3576 的 rootfs 链没有在这里跑；第 4 节中交叉编译和 buildkit 内模拟的各行
取自脚本自身的 builder 选择逻辑，以及 `build-harness.md` 第 5 节记录的
2026-08-28 buildkit 实测。
