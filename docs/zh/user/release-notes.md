# 发布版标识与发布说明政策

本页定义 mos 发布版如何命名、哪些产物携带其身份、以及发布说明中的事实
允许来自哪里。它不包含发布历史：**还没有发布过任何公开的 mos 发布版**，
本文档集不会捏造一个。

## 1. 今天如何标识一个发布版

构建把身份盖进产物，而不是写进手工维护的 changelog：

- **磁盘镜像**命名为 `<board>-mos-<epoch>.img`；epoch 是构建的时间戳
  身份，`<board>-mos-latest.img` 指向最新的那个。
- **更新 bundle** 携带发布负责人在构建时传入的版本字符串
  （`bash build/run.sh --bundle 1.2.3`）。
- **rootfs 身份**是它的 dm-verity 根哈希：打包是确定性的，所以哈希是
  发布内容的纯函数，同一棵树的两次构建产生相同的哈希。它记录在产物旁的
  `rootfs-verity.env` 里，并在 bundle 发布时被 TUF 元数据再次固定。
- **软件包清单**随镜像发布于 `/usr/share/mos/manifest.tsv`：每个已安装
  软件包、其版本，以及包池构建自的源码树 git 标记。来自未提交源码树的
  构建被标记为 `.dirty` 并被后续步骤拒绝，因此发布出去的身份总是指向
  一个真实的 commit。

一个支持工单引用 bundle 版本、verity 根哈希和清单的 git 标记；三者合起来
无歧义地标识一个发布版。

> status: shipped — evidence: `docs/design/build.md`, `rootfs/compose/90-pack.Dockerfile`, `docs/design/ro-root.md`

## 2. 发布说明中的事实来自哪里

对任何发布发布版的人都有约束力的政策：

- **事实来自产物。**版本、板卡与 profile 兼容性、摘要和软件包增量来自
  构建输出和清单——绝不手工重打，因为手抄的摘要就是无人复核过的摘要。
- **能力声明遵循文档契约。**发布说明只以与本文档集相同的证据纪律声明
  已发布行为（[doc-contract.md](doc-contract.md)）；路线图条目要么如实
  标注，要么省略。
- **安全相关的变更要点名。**改变了信任链、访问模型或默认值的发布版，
  不得被概括为"杂项修复"。
- **不捏造发布历史。**没有已发布版本这一事实，就照实陈述为没有。

> status: shipped — evidence: `docs/user/doc-contract.md`

## 3. 渠道、晋级与门禁发布

把发布版命名进渠道（development、candidate、stable）、一份签名的机器可读
发布清单、以及一个拒绝缺少产物、schema 有效清单、受支持板卡证据**或其
发布说明**的发布版的发布门禁，由发布身份计划定义。它落地后，本页将获得
渠道词汇，清单将成为本页散文所服从的机器可读来源；官方站点的下载简报是
[../../website/downloads.md](../../website/downloads.md)。

> status: proposed — evidence: `docs/plan/PLAN-043.md`

TODO(PLAN-043): revisit after this plan merges
