# 客服话术库（打包进 kfCallback）

源仓：`ookiisparrow/luckyducky-cs-scripts`（构建/提交时拷入，**运行时不拉 GitHub**）。

格式：Markdown 短句池（节点下编号行）；占位如【地点】【天数】【需求】【结论】。
硬规则：纯对话，禁止气泡选项。

改话术：先改本目录 `.md`，再跑 `node rewrite/cloud/scripts/bundle-cs-scripts.mjs`（`build:rw-cloud` 会再跑一遍）。
