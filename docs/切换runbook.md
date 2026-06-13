# 切换上线 Runbook（B9）—— 把重构样板房切成生产

> 重构最后一批的产物。**切换动作（真部署 + 真机验收）须用户专门拍板某一天执行**；本文件让那一天可逐步照做、可回滚。
> 切换模型：样板房 `luckyducky-next` 的重构代码部署到**共用云环境** `cloudbase-d4gcssqbv06865479`，覆盖现网旧函数（重构后共 28 个：含审计 P1 新增 getPlaybackUrl，原 getOpenId 已删）。小程序端与控制台改用重构后的 `packages/miniapp` / `packages/admin` 构建。**数据库、云存储、控制台支付资产原地不动**（共用）。

## 〇、为什么这次切换是安全的（先读这条）

**数据零迁移**——这是切换最大的风险点，已查证排除：
- 重构后函数的 `_id` 方案与现网**逐一致**：createOrder（`_id`=订单号）、genQrcodes（`_id`=兑换码）、applyRefund/submitReview（`_id`=`订单__商品`）——与生产 `cloudfunctions/` 同款。
- activateCourse：审计 P2 修复后改为**惰性迁移**——现网随机 `_id` 旧激活命中即用、不重建；新激活用确定性 `_id`=code（幂等自愈半步失败）。故现网激活数据仍兼容、无需搬迁。
- 仍「先查后建」的 login/trackEvent（users/progress）是**忠实迁移**，与现网写法一致。
- 故现网既有订单/兑换码/评价/售后/用户数据，重构后函数读写**完全兼容**，无需任何数据搬迁。
- 债#14（users/progress 升确定性 `_id`）是**切换后**的改进项，不是切换前提；做时再按根因#1 的「命中新 id 用之、未命中原子搬迁」惰性迁移。

## 一、切换前体检

```bash
cd /Users/sparrow/luckyducky-next
node scripts/preflight.mjs      # 机器体检：质量闸/27 产物/console-assets/manifest/cloudbaserc
```

机器体检全过后，**人工核以下 4 项**（机器够不到）：
1. **console-assets drift-checklist**（见 `console-assets/README.md`）：对照线上控制台逐项核——连接器 `wxpay_33nb7su`、3 个工作流已发布、paynotify/refundnotify 的 `forward-node.js` 逐字一致、`config.pay` 文档、16 集合权限档位。**有出入以线上为准校正副本**。
2. **验收单 X**（`验收手册.md` / `02-库权限期望表.md`）：16 集合 + 云存储权限档位，绝无「所有人可读写」。
3. **小程序/控制台构建**：`npm run build:mp-weixin` + `npm run build:admin` 均 DONE。
4. **回滚预案就位**（见六）：确认生产仓 `cloudfunctions/` 旧代码仍在 git，可一键回部。

## 二、部署序（deploy-fns 真跑全量 28）

切换日在**生产仓或样板房**执行（共用云环境，部署目标一致）：

```bash
DEPLOY_ALLOWED=1 node scripts/deploy-fns.mjs     # 首跑：manifest 空 → 部署全量 28
```

- 敏感函数（钱/权限/状态）会被 **guard-deploy 逐个弹二次确认**：createOrder · pay · payCallback · applyRefund · refundCallback · closeExpiredOrders · adminApi · genQrcodes · activateCourse · confirmEnter · confirmReceive · submitReview · login · updateProfile · trackEvent · seedProducts · seedCourses · initDb。逐个确认放行。
- 只读函数（get*：getProducts/getCourses/getContent/getMyOrders/getMyCourses/getMyProgress/getMyAfterSales/getOrderById/getReviews）无副作用，安全。
- ⚠️ **seedProducts / seedCourses / initDb 只部署、切勿调用**——现网数据已存在，调用会把商品/课程表重置回种子（根因#3 A-1 的原灾难）。它们已加 `withAdminGate`，但纪律上切换日不触发。
- `closeExpiredOrders` 的定时触发器随 cloudbaserc 部署；确认其 cron 仍在。
- 部署后 `.deploy-manifest.json` 自动记录 28 个 hash —— **提交入 git**（下次只部署变更）。

## 三、切换步骤（编号照做）

1. 体检（一）全绿 + 人工 4 项核完。
2. 低峰期开始（避开下单高峰）。
3. `DEPLOY_ALLOWED=1 node scripts/deploy-fns.mjs` → 逐个确认敏感函数 → 等全部 DONE。
4. 提交更新后的 `.deploy-manifest.json`。
5. 发布小程序新版（`build:mp-weixin` → 微信开发者工具上传 → 提交审核/发布）。
6. 控制台发布（`build:admin` → 部署静态托管，仍走部署闸二次确认）。
7. 立即验收（四）。

## 四、切换后验收（真机，非模拟器）

- **验收单 Y 支付黄金路径**：真机下一笔小额真单 → 拉起微信收银台 → 付 → paynotify 回调 → 订单转 paid。
- **验收单 Z 退款黄金路径**：对该单申请售后 → 控制台审批 → 退款工作流 → refundnotify 回调 → 售后转 refunded、原路退到账。
- **冒烟**：登录、看商品/课程、下单、扫码激活课、看自己的课/订单、提交评价——各走一遍，对照 `验收手册.md` 黄金路径清单。
- **课程视频保护（审计 P1）**：① 已购并确认进课的账号能正常播放付费段、免费段任何人可看；② 用**未购该课**的账号——目录看不到 videoFileId、付费段取不到播放地址（NOT_ENTITLED）。视频存储须设私有读（见 `console-assets/02-库权限期望表.md` 云存储节）。
- 任一不过 → 进六回滚，不带病上线。

## 五、回滚预案

数据双向兼容（`_id` 方案两版一致），故**回滚只回函数代码，数据不动**：
1. 生产仓 `cloudfunctions/` 旧代码仍在 git 历史（切换前的 main）。
2. 回滚 = 用旧代码重部署受影响函数（`tcb fn deploy <name> --dir cloudfunctions/<name>`，或旧版 cloudbaserc 全量）。
3. 小程序：微信后台「版本回退」到切换前线上版。
4. 控制台：重部署切换前的静态包。
5. 控制台支付资产（连接器/工作流）全程未动，无需回滚。
> 回滚边界：切换后若已发生新交易，其数据用的是同款 `_id`，旧代码照样读写——不会因回滚丢单。

## 六、切换后收尾（非阻塞，另行排期）

1. **CLAUDE 本体 reconcile**：§2 命令、§5 目录（`src/`→`packages/`）、§7 数据（删「data/catalog 单一来源」「api/shop H5 回退」旧述）、§3 闸数（四道→八闸 + deploy-fns），改到与重构后架构一致。`docs-budget` 守卫保其仍 ≤180 行。
2. **债#14**：users/progress 升确定性 `_id`（kit 提取 `ids.ts`）+ 惰性迁移，补测试，关账根因#1 最后一环。**切换后做更安全**（忠实先查后建与现网兼容，确定性 _id 的惰性迁移宜上线后单独观察）。
3. ~~前端分页「加载更多」~~ ✅ 已接（小程序 order-list/aftersales + 控制台订单/售后四处全接游标）。残留低优先：状态角标按已载列表计，超首页需服务端计数。
4. **依赖安全升级（另开分支，低优先）**：`npm audit` 51 项**全在构建工具链**（@dcloudio/vite/esbuild/jimp/postcss/ws/express/qs）——不随云函数/小程序产物上线、**运行时暴露近零**。非破坏性 `audit fix` 不减项（反引入 rolldown），未采纳；根治须主版本升级 uni 栈、单开分支验三端构建（勿盲跑 `--force`）。
5. **后台账号体系 v2（产品级，另议）**：现 v1 单口令 + localStorage 是刻意简化（bootstrap 抢占窗口已关，债#15）；升级到 session token / 多账号属账号体系决策，需产品拍板。
6. **观察期**：盯交易异常工作台（adminApi getDashboard 的 feeMismatch/refundMismatch/退款卡单）、云函数日志，确认无回归。

> **管理员口令（债#15 已关抢占窗口）**：现网 `adminConfig.auth` 已存在，切换不受影响、照旧用现口令登录。**仅当迁新环境 / 重置口令**时，须先设云环境变量 `ADMIN_BOOTSTRAP_KEY`＝期望口令，再用该口令首登（无此变量则禁止 bootstrap，杜绝抢占）；设定后可移除该变量。
