# 设计：构建与检查工具链 —— 本仓库的检查是怎么跑的

> [English](../../design/build-harness.md) | 中文
>
> 这一页是给准备动手跑东西的人看的。本树里多数检查跑在一个命令行没有提及的容器里，
> 而「绿色运行」与「令人困惑的红色」之间的差别，此前只存在于任务记录和运维的脑子里。

**标注为「测量」的断言，是对这台主机在给定日期上的观察。** 没有门禁能检查它，
它会在你脚下变旧，所以它带日期。

## 1. bun 跑在一个固定的容器里，这是一个决定

所有 bun 入口都从 `build-env/images.env` 里锁定的 `IMAGE_BUN_1` 摘要解析运行时。QEMU 验证与
APID API 套件在这个基础上构造带 docker 客户端的镜像；`pkgs/mosd/apid/ui/build.sh` 直接使用
原始锁定镜像，并把 UI 源码只读挂载进去，没有本机运行时或镜像覆盖分支。

**固定的是摘要而不是 `oven/bun:1` 标签**，因为那个标签在上游每个 1.x 发布时都会被重新指向，
而这套工具链是判定 apid 的 API 是否合规的东西。

**这个容器是一个「钉」，不是一个「绕路」。** 这台主机确实有可用的 bun，也确实能跑通；
主机路线在这里是**可能的，但仍然不被采用**，理由记录在决定作出的地方：
其他 bun 调用点都没有主机路线，为三个调用方中的一个开一条主机路线，
等于引入了没人要求的可配置性。**看到绿色运行时，把容器理解成钉在起作用，而不是一个回退。**

## 2. 固定的 bun 镜像里没有 docker 客户端

`IMAGE_BUN_1` 只有 bun，所以任何在它内部驱动 docker 的路线都会死在一句关于 docker 的报错上，
而不是关于你正在做的事。**挂载守护进程套接字没有用，因为缺的是客户端，不是套接字。**

`verify/Dockerfile` 存在的唯一目的就是补上这个缺口——**要复用它，不要另写一个**。
它是两个摘要 `FROM` 加一次 COPY，并在构建时用 `RUN docker --version && bun --version` 断言结果，
所以一个上游挪了位置的 COPY 会在**构建时**失败，而不是在三步之后的 verify 运行里失败。

## 3. Rust 门禁

两个脚本，每个 Rust workspace 一个，各五条命令、顺序相同：`cargo fmt --all --check`、
`cargo clippy --workspace --all-targets --locked -- -D warnings`、
`cargo nextest run --workspace --locked`、`cargo test --doc --workspace --locked`、
`cargo deny check licenses bans advisories`。**照原样运行它们**——
工具链是它们所运行的那个容器，而不是对脚本的修改。

之所以是两个：`pkgs/rauc-sign` 自成一个 `[workspace]`，自那次拆分之后，
在 `pkgs/mosd` 下运行的 `cargo clippy --workspace` 就再也够不到那个 crate 了。
孪生脚本的存在，是为了让这个遗漏成为一个看得见的文件，而不是一个没人看得见的缺口。

    make os-rust-gate              两个 workspace
    bash tests/rust-gate.sh mosd   只跑一个

这就是调用方式的全部。本节此前关于 PATH 顺序、`/tools` 挂载、以及「两套工具链取哪一套」
的四十行，描述的是一个已经不存在的安排。

### 3.1 它跑在 `localhost/mos-build-rust-check` 里，以及这个镜像为什么存在

`mos-build-rust` 里只有 `cargo` 和 `rustc`，没有 clippy、rustfmt、nextest、cargo-deny——
这是刻意的：它是每个 Rust deb producer 的 `FROM`，装在那里的东西**每次构建都要拉**。
`build-env/rust-check/Dockerfile` 从它派生，加上那四个工具和 `dbus-daemon`；
除了这个门禁，没有别的东西拉这个镜像。*2026-09-04 测量：*
`mos-build-rust` 1.83 GB，`mos-build-rust-check` 1.92 GB——90 MB，由一个 target 承担。

**clippy 与 rustfmt 不需要新的钉。** 它们就在 `RUST_SHA256_<arch>` 已经点名的那个
`rust-${RUST_VERSION}` tarball 里，派生镜像通过同一个下载缓存重新取那份已记录的字节，
再向 `install.sh` 多要两个组件名。*2026-09-04 测量：* 在刚构建过 `mos-build-rust` 的主机上，
该阶段打印 `using the cached ... which already matches the recorded hash`——同样的字节，
没有第二次下载。**不要去找 `CLIPPY_SHA256`，它不存在，也不该存在。**

`cargo-nextest` 与 `cargo-deny` 不在任何 Rust tarball 里，因此被完整钉住：
`build-env/images.env` 里的 `RUSTCHECK_NEXTEST_*` 和 `RUSTCHECK_DENY_*`，每个架构一组
URL 与 sha256，走与其他所有钉相同的 PENDING 流程。前缀是 `RUSTCHECK_` 而不是
`RUST_CHECK_`：lock 的过滤是 `RUST_[A-Za-z0-9_]*`，后一种拼法会把门禁的钉塞进
「每次构建都要拉的那个镜像」的缓存键里。

镜像在构建时断言自己持有什么，并记录在 `/etc/mos-build/rust-check.env`；
`tests/rust-gate.sh` 每次运行都会先把它打印出来，所以门禁日志能回答
「是哪个 clippy 说的」，而不需要谁去记当时是哪个镜像。

**为什么是镜像而不是目录。** 到 2026-08-29 为止，那四个工具来自 `/srv/mos-rust-tools`——
一个被挂到 `/tools` 的主机目录，没有 Makefile target 点它的名，也没有脚本引用它，
`grep -rn 'mos-rust-tools'` 在全树一个都不匹配。它被清空了，而**什么都没有失败**。

**这句话要读得准确**，因为有用的版本比「没人跑过这个门禁」更窄：CI 一直在每次推送时跑这两个脚本
（见 3.5），所以 workspace 并没有失去检查。丢掉的是**在这里**、
对着眼前这棵树、在推送之前把门禁跑一遍的能力——而因为没有任何 target 点过那个目录的名，
它的消失在任何地方都不是一次失败。bind mount 可以在构建脚下被清空，镜像不能；
而一个 `make` target 的缺席，是有人会注意到的东西。

### 3.2 内置 UI 资源树要先构建，而且是在容器之外

`MOS_APID_UI_DIST_DIR` 缺席时，`check.sh` 会去跑 `apid/ui/build.sh`，而那个脚本驱动 docker——
Rust 镜像里没有 docker 客户端，所以这条回退路线在门禁自己的容器里根本点不着。
`tests/rust-gate.sh` 因此做 `pkgs/mosd/hack/build-target.sh` 做的事：在主机上用锁定的 bun
容器构建资源树，只读挂到 `/build/apid-ui`，再传入 `MOS_APID_UI_DIST_DIR`。
仓库自身以只读方式挂在固定路径 `/src`，并给一个独立的可写 `CARGO_TARGET_DIR`——
**一个能修改自己所审视之树的门禁，是一个能把自己发现的问题改掉的门禁。**

### 3.3 绝不要在这个容器里用 `bash -lc`

`-l` 会 source `/etc/profile`，它覆盖 PATH 并把 `/opt/rust/bin` 一起带走，
于是 cargo 和每个工具同时消失。这个陷阱在搬离 `/tools` 之后原样幸存——
**它是关于 shell 的，不是关于挂载的**——而且现在被丢弃的是镜像**自己的** `ENV PATH`，
不再是通过 `docker -e` 传进去的那个。*2026-09-04 测量，*同一个镜像，完全没有 `-e PATH`：

| 调用 | 容器内 `$PATH` | `command -v cargo` |
| --- | --- | --- |
| `bash -c 'echo $PATH'` | `/opt/rust/bin:/usr/local/cargo/bin:/usr/local/sbin:...` | `/opt/rust/bin/cargo` |
| `bash -lc 'echo $PATH'` | `/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin` | 什么都没有 |

这个失败**看起来完全像镜像坏了**。用 `bash -c`，也就是 `tests/rust-gate.sh` 用的那个。

### 3.4 `dbus-daemon` 现在在镜像里，而且这是承重的

mosd 与 apid 的若干测试在私有 session bus 上断言真实行为，并且被写成
**没有 daemon 就失败而不是跳过**（`pkgs/mosd/apid/tests/e2e.rs`、
`pkgs/mosd/mosd/tests/scan.rs` 里是同一句拒绝）。在这个镜像存在之前，
它是每次运行前手动 `apt-get` 装进容器的——*2026-08-28 在旧基底上测量*，
少装这一个包，nextest 报的是 `57/705 tests run: 56 passed, 1 failed`、
`error: test run failed`、`rc=100`，读起来像 workspace 坏了。

**哪个测试先暴露它是调度而非信号**：`bus.rs` 的 `bus_roundtrip` 有同样的要求，
而 nextest 在第一个失败处取消其余。把 `rc=100` 和 `dbus-daemon was not found` 一起读作一个事实——
而如果你现在还看到它，那说明你不在这个镜像里。

### 3.5 CI 跑的是同样两个脚本，但编译器是刻意不同的

`.github/workflows/check.yml` 的 `rust` job 在每次推 `main` 和每个 PR 上运行
`pkgs/mosd/hack/check.sh` 与 `pkgs/rauc-sign/hack/check.sh`。它**不用**这个镜像，也用不了：
GitHub runner 的镜像库里没有 `localhost/mos-build-*`。它用 rustup 安装两个 manifest 都声明的
MSRV，加上 rustfmt 与 clippy，并用 apt 装上 3.4 所说的 `dbus-daemon`。

那两个既不在 Rust tarball 里、也不在 apt 里的工具——`cargo-nextest` 与 `cargo-deny`——
现在**只钉一次**：`build-env/images.env` 里的 `RUSTCHECK_*`，由那个 workflow **source** 而非重复。
它此前自带四个字面量；从这个镜像开始安装同样两个工具的那天起，那就变成了「一个工具、两处钉、
可以自由地互相矛盾」。现在一次 bump 同时移动 CI 和这个镜像。

**编译器则是刻意仍然不同的，这是两个问题，而不是一次漂移。** CI 在 MSRV 上检查——
「这棵树所承诺的版本是否仍能编译并通过 lint」；这个镜像在 `RUST_VERSION` 上检查——
「实际用来构建出货二进制的那个版本是否仍能通过 lint」。一条只在其中一边触发的 clippy lint
是完全可能的，而且两种情况下都是一个发现，不是任何一边的故障。
**不要靠把两者统一来「修」它**：本地门禁绿不代表 MSRV 没问题，CI 绿也不代表出货编译器没问题。

## 4. 临时空间：`tmp/`，以及为什么绝不用系统的 `/tmp`

仓库根目录下的 `tmp/` 是暂存根，已被 gitignore。要与容器交换的临时路径必须落在
`<repo>/tmp/<issue-id>/` 下——**不要用系统的 `/tmp`**：docker 守护进程不共享本会话的 `/tmp`，
对它做 bind mount 会**成功但交付一个空目录**，于是运行在几步之后报「文件不存在」，
而文件其实在那儿，空的是挂载。

**这个目录叫 `tmp/` 而不是 `runtime/`。** 旧名字撞车两次：仓库里若真有一个 `runtime/` 目录，
会被静默忽略；而本页的测量里还引用着 `/srv/bkd/runtime/bun` 这类无关路径，读者得先分辨是哪个 runtime。

## 5. 这台主机上的 arm64：能构建，不能执行

没有 binfmt，所以 arm64 产物可以被**构建**，但不能在本机被**执行**。

## 6. 镜像是输入，「没有镜像」应当读作工具链故障

`pkgs/mosd/tests/apid-api/run.sh` **什么都不构建**。镜像缺席时它按名字拒绝，并打印出构建它的两条命令。
那两条命令是一条更长的链的最后两环，前面几环失败时的表现是一样的——**看起来像工具链坏了**。

顺序是：包（rauc、podman）→ 根文件系统 → 镜像 → 运行。
`bash pkgs/mosd/tests/apid-api/run.sh --dry-run` 只做前置条件与网络发现、不启动任何东西，
是几秒钟内检查工具链的方法。

**这个套件在 CI 里哪儿都不跑，这是既定决定而非疏漏。** 它要在 QEMU 里启动一个 x64 镜像，
放进每次推送会显著拉长反馈环，而且它依赖一个自己并不构建的镜像。
CI 检查的是更窄也更便宜的一条：`make os-apid-api-spec-pins` 断言套件的期望仍与提交的
OpenAPI 文档一致。**apid 表面改动之后，请手动跑这个套件。**

## 7. 文档门禁

**一个脚本**，只读，除 bash 和 coreutils 之外别无依赖。

`bash docs/verify-index.sh` **双向**断言 `docs/design/*.md` 与 `docs/README.md` 一致——
它就是为抓住重命名而写的，因为只做正向的检查会在一个满是指向已不存在文件的索引上愉快通过。
所以新增一篇设计文档，必须在**同一个提交**里补上 `docs/README.md` 的那一行。

**`docs/plan/` 与 `docs/task/` 刻意不设门禁。** 它们是 PMA 的流程跟踪而非产品的一部分，
而且记录一关闭就被删除——所以索引检查要断言的集合是空的或接近空的，
而**一个对空集合的检查会在什么都没检查的情况下报绿**。

**刻意没有引用门禁。** `docs/verify-citations.sh` 及其三份基线，
连同它们所维护的那种耦合一起被移除了：文档不再用 `path:line` 引用代码，
也就没有引用需要保持可解析。需要精确契约时，文档点名承载它的产物——
HTTP 表面是 `pkgs/mosd/apid/openapi.json`，CI 保证它等于发布的二进制所打印的内容。

## 8. 验证

### 8.1 当前基底 —— 2026-09-04 测量

在这台主机、这个 worktree 上运行；Rust 门禁跑在 `localhost/mos-build-rust-check:amd64` 里，
任何地方都不再有 `/tools` 挂载。

| 命令 | 末行 |
| --- | --- |
| `make build-env` | 六个镜像被打标签，新的那个记录 `MOS_BUILD_RUSTC=1.98.0`、`MOS_BUILD_CLIPPY=1.98.0`、`MOS_BUILD_NEXTEST=0.9.143`、`MOS_BUILD_DENY=0.19.9`、`MOS_BUILD_DBUS=1.16.2` |
| `make os-rust-gate` | 每个 workspace 各一次 `ALL CHECKS PASSED`，然后 `RUST GATE PASSED (mosd rauc-sign)` |
| `cargo fmt --all --check`，两个 workspace | 干净——diff 是 **0 字节**，没有为了这次而格式化任何东西 |
| 门禁那条 clippy 行（`-D warnings`），两个 workspace | **0 条发现**，七个 crate 那个 `Finished dev profile in 38.88s` |
| `cargo nextest run --workspace --locked` | mosd `1023 tests run: 1023 passed`；rauc-sign `62 tests run: 62 passed` |
| `cargo deny check licenses bans advisories` | 两个都是 `advisories ok, bans ok, licenses ok` |
| `cargo test --locked -p mosd -p apid` | `823 passed`，dbus-daemon 来自镜像本身 |
| `make docs-verify` | `183`、`448`、`734`、`231`、`43` 全 PASS |
| `(cd verify && bun test)` / `(cd build && bun test)` | `1268 pass` / `889 pass`，均 0 fail |

**一个一周没跑过的门禁给出零条 clippy 发现，这是需要被打破的断言，而不是值得庆祝的结果。**
它被打破过了：把两个 workspace 复制到 `tmp/` 下，每个 crate 追加一个
`pub fn probe(v: &Vec<u8>)`（`clippy::ptr_arg`，属于 workspace 设为 `warn` 的 `clippy::all`），
再用门禁自己的 clippy 行去跑那份副本——**八个 crate 全部变红**，`rc=101`。
cargo 在第一个失败的 crate 处停下，所以成员是被逐个驱动的，才证明每一个都真的被分析到了。
原树未被修改，副本已丢弃。

### 8.2 旧基底 —— 2026-08-28 测量，作为基线保留

**这些数字描述的是一个已经不存在的安排：** 门禁跑在 `localhost/mos-build-rust` 里，
`/srv/mos-rust-tools` 挂在 `/tools`，而那个目录在 2026-08-29 被清空。
保留它们，是因为这是那之前门禁最后一次运行所发现之物的**唯一记录**，
也因为其中两行刻意的红色至今仍然可达。

| 命令 | 末行 |
| --- | --- |
| `bash hack/check.sh`（`pkgs/mosd`，装了 dbus） | `705 tests run: 705 passed`、`advisories ok, bans ok, licenses ok`、`ALL CHECKS PASSED` |
| 同一条 nextest 行，**没有** `dbus-daemon` | `57/705 tests run: 56 passed, 1 failed`、`error: test run failed`、`rc=100` |
| 门禁那条 clippy 行，`/tools/rust96/bin` 排在前面 | `error[E0463]: can't find crate for 'std'`、`rc=101` |

两张表对读：**在这里没人能跑这个门禁的那一周里，测试数从 `705` 长到了 `1023`。**
那一周合入的东西在本地只被 `cargo test --locked` 检查过——没有 clippy、没有 `cargo deny`、
没有 doctest——其余部分由 CI 在 MSRV 上检查；上面 2026-09-04 那一轮，
是工具链目录消失之后这台主机上第一次跑完整个门禁。它什么都没查出来。
这是一个关于「活是怎么干的」的事实，而不是一个「本地那条路线本来就不必存在」的论据。
