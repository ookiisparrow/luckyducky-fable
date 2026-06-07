# Git 协作约定

> 2026-06-07 立。远程:`https://github.com/ookiisparrow/luckyducky-miniprogram`(私有)。

## 原则
- **GitHub(`origin`)为唯一中心**:所有分支、历史、版本都在云端;本地只是工作副本。
- **本地保持单一最新工作区**:不在本地囤多版本文件夹副本、不留长期本地分支;要旧版本就从 GitHub 取(tag/分支)。
- **版本里程碑用 tag**(`v0.1` / `v0.2`…),**不用复制文件夹**做版本。

## 日常流程
- **开工前同步**:`git pull`。
- **提交**:`git add … && git commit -m "type：说明"`(type:feat/fix/docs/refactor…,沿用现有中文风格)。
- **推送**:`git push`。
- **新功能 / 较大改动走分支**:
  1. `git switch -c feature/xxx`(从最新 main 开)
  2. 开发 + commit + `git push -u origin feature/xxx`(分支推云)
  3. GitHub 上开 PR → 合并到 `main`
  4. `git switch main && git pull && git branch -d feature/xxx`(删本地分支,云端历史留着)
- **版本节点**:`git tag -a vX.Y -m "…" && git push origin vX.Y`。

## 当前状态
- 主版本 **v0.1** 已打 tag(前端 demo + 质量体系 + 云开发设计规格,接后端前的节点)。
- 下一步云开发(P0–P5)建议走 `feature/` 分支,合并回 main 后到阶段里程碑再打 tag。

## 不入库(见 `.gitignore`)
- `dist/`、`node_modules/`、微信工具本地配置(`project.config.json` / `project.private.config.json`)。
- 3 个外部审核报告 `.md` 暂未跟踪(临时,归档另说)。
