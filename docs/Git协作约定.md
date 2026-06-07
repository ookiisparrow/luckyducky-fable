# Git 协作约定

> 2026-06-07 立、2026-06-07 重写为「教学型」。远程：`https://github.com/ookiisparrow/luckyducky-miniprogram`（私有）。
>
> 这份文档分两半：**前半讲清 git 名词到底是什么**（给新手），**后半是本项目怎么用**（照着做）。
> 末尾有一张「速查卡」，平时只看那一张就够。

---

## 1. 一句话心智模型

- **git** = 给代码装了个「带时间机器的存档系统」：每次存档都能回去，能开平行草稿线试错。
- **GitHub** = 把存档放到云端的那一份「主档」。你的电脑、别的电脑、网页，都能和这份主档同步。
- 本项目的规矩一句话：**云端（GitHub）是唯一权威，本地只是工作副本；任何改动都先开一条短命草稿线，弄好再通过「合并请求」并回主线。**

---

## 2. 名词扫盲（看不懂流程时回这里查）

每条格式：**名词** = 大白话 ·（类比）· 在本项目里是什么。

- **仓库 / repo** = 装着这个项目所有文件 + 全部历史的盒子。·（一个项目文件夹的「完整档案」）· 就是 `luckyducky-miniprogram/`。
- **工作区 working tree** = 你此刻在电脑上看到、能编辑的那份文件。·（桌上摊开的稿子）
- **暂存区 staging area** = 「准备存档」的待命区。改完文件要先 `git add` 放进暂存区，才能存档。·（把要归档的纸先放进收件篮）
- **commit（提交）** = 一个**存档点**，附一句话说明这次干了啥。·（游戏存档）· 例：`feat：商品数据上云`。随时能回到任何一个 commit。
- **本地 local / 远程 remote** = 本地=你电脑上的副本；远程=云端 GitHub 上那份。·（本地草稿 vs 云端正本）
- **origin** = 「远程」的默认名字，就指我们这个 GitHub 仓库。·（云端正本的代号）
- **branch（分支）** = 一条**平行草稿线**。在主线旁边拉一条，改坏了不影响主线。·（平行宇宙 / 另存一个草稿）
- **main（主线 / 主干）** = 唯一长期分支，代表「当前正式版本」。·（正本）· 只通过合并进东西，不在上面直接乱改。
- **feature 分支** = 为做某一件事临时拉的**短命草稿线**，做完合并回 main 就删掉。·（一次性草稿纸）· 例：`feature/cloud-products`。
- **HEAD** = 「我现在站在哪条线上」的指针。·（你当前打开的是哪个草稿）· `git status` 第一行会告诉你。
- **push（推）** = 把本地的 commit 上传到云端。·（把草稿同步到云盘）
- **pull（拉）** = 把云端最新的 commit 下载并合进本地。·（从云盘拉最新）· = fetch + merge。
- **fetch（取）** = 只下载云端最新、先不合并，让你看看。·（先下载、不覆盖）
- **merge（合并）** = 把一条分支的改动并进另一条。·（把草稿的修改誊进正本）
- **merge commit** = 合并时自动生成的一个「汇合点」提交。本项目**不用**这种（见第 3 节选了 squash）。
- **squash（压扁合并）** = 把一条分支里的好几个 commit **压成一个**再并进 main。·（把草稿上零碎的十次涂改，誊成正本上工整的一条）· 好处：main 历史干净、一件事一行。
- **PR（Pull Request / 合并请求）** = 在 GitHub 上提一张「请把我这条草稿线并进 main」的单子。能看到这次改了哪些行（diff），是合并前的检查闸门。·（提交审核单）
- **diff（差异）** = 两个版本之间「增删了哪些行」的对照。·（修订痕迹）
- **conflict（冲突）** = 两条线改了同一处、git 不知道听谁的，要你手动选。·（两人改同一句话）· 本项目单人开发、分支短命，基本不会遇到；真遇到再说。
- **tag（标签）** = 给某个 commit 钉一个「里程碑书签」，通常是版本号。·（书里夹的标签纸）· 例：`v0.1`。
- **`.gitignore`** = 「不入库清单」，列在里面的文件 git 直接无视。·（碎纸机清单）· 如 `dist/`、`node_modules/`。
- **clone（克隆）** = 把云端整个仓库（文件+全部历史）下载到一台新电脑。·（换电脑时把档案整盒搬过来）

---

## 3. 本项目的策略（四条已定决策）

1. **个人学习仓**：只有我（用户）+ AI 协作，真实开发团队另有并行推进，不共用此仓 → 保持轻量，**不开 main 分支保护**。
2. **走 GitHub PR 流**：合并都经 PR，在 GitHub 上看 diff、留检查闸门（用已登录的 `gh` CLI）。
3. **一律走短分支**：**任何改动**（哪怕改一行文档）都先开一条短命分支，绝不直接在 main 上改。规则零歧义。
4. **squash 合并**：每条分支合进 main 时压成**一条**提交 → main 历史线性、好读，「项目怎么一步步走的」一目了然。

> 只有 `main` 一条长期分支，其余都是短命分支（这套叫 **GitHub Flow**）。不搞 `develop` 之类的多长期分支。

---

## 4. 日常工作流（照着走）

每做一件事（无论多小）：

```bash
# 1) 回主线、同步云端最新（开工前必做，保证从最新开分支）
git switch main
git pull

# 2) 开一条短命分支（命名见第 5 节）
git switch -c feature/做什么

# 3) 改文件 → 存档（可以存好几次，反正最后会 squash 压成一条）
git add -A
git commit -m "type：这次干了啥"

# 4) 把分支推上云
git push -u origin feature/做什么

# 5) 开 PR（然后在 GitHub 看 diff，AI 帮 review）
gh pr create

# 6) squash 合并 + 自动删远程分支
gh pr merge --squash --delete-branch

# 7) 回主线、同步、删掉本地这条已合并的分支
git switch main
git pull
git branch -d feature/做什么
```

**版本里程碑**（到一个阶段节点时）：

```bash
git tag -a v0.2 -m "里程碑说明"
git push origin v0.2
```

---

## 5. 命名 + 提交信息规范

**分支名**：`类型/简短英文或拼音`

- `feature/xxx`：新功能（如 `feature/cloud-products`）
- `fix/xxx`：修 bug
- `docs/xxx`：改文档（如 `docs/git-strategy`）
- `chore/xxx`：杂项 / 配置 / 依赖

**提交信息**：`type：中文说明`（**全角冒号**，沿用本项目既有风格）

- type ∈ `feat` / `fix` / `docs` / `refactor` / `chore` / `test`
- 例：`feat：商品数据上云`、`fix：购物车 qty 契约`、`docs：重写 Git 协作约定`

---

## 6. 不入库（见 `.gitignore`）

- `dist/`（编译产物）、`node_modules/`（依赖）、`*.log`、`.DS_Store`。
- 微信开发者工具在根目录生成的本地配置：`project.config.json`、`project.private.config.json`。
- 历史归档放 `docs/archive/`（如外部审核原始报告），**会入库**，只是和现行文档分开放。

---

## 7. 当前状态

- 主线 `main` 已含：前端主干 + 质量体系 + 云开发 P0 + **商品数据上云**（PR #1，squash 合入）。
- 版本 tag：`v0.1`（接后端前的前端 demo 节点）。
- 下一步业务（课程 / 订单上云等）继续按本流程：开 `feature/` 分支 → PR → squash 合并；到阶段节点再打新 tag。

---

## 8. 速查卡（平时只看这张）

```bash
# 开工
git switch main && git pull
git switch -c feature/做什么

# 干活（可重复）
git add -A
git commit -m "feat：说明"

# 收工合并
git push -u origin feature/做什么
gh pr create
gh pr merge --squash --delete-branch
git switch main && git pull && git branch -d feature/做什么

# 看状态
git status              # 我现在在哪条线、改了啥
git log --oneline -10   # 最近的存档点
git branch -a           # 有哪些分支
```

> 卡壳了：先 `git status` 看「我在哪、改了啥」，再回第 2 节查名词。
