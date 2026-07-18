# 视频点播 VOD 控制台资产正册（决策§31 转码管线·根因账本 #9 + #12）

> 课程视频主路径 2026-07-18 起升级为「admin 直传腾讯云点播 VOD + 任务流自动转码 + Key 防盗链签名播放」。VOD 侧的**开通状态、子账号密钥、任务流模板、播放域名、防盗链 Key 都住在腾讯云控制台、不在 git**——本文件是其正册。**变更纪律：先改本文件、再动控制台**（同 README 总纪律）。
> 与代码的接缝：`secureConfig` 集合 `vod` 文档（admin /config-checklist 填即生效）+ `kit/vod.ts` 平台接缝单点（守卫 `rw-vod-seam-single`）。**凭证值一律 REDACTED 不入 git**。

## 资产清单（勿删）

| # | 资产 | 标识 / 期望值 | 作用 |
|---|---|---|---|
| 1 | 云点播服务开通 | 主应用（不启用子应用） | 媒资存储 + 转码 + 分发的载体；按量后付费需账户预充值 |
| 2 | CAM 子账号 + API 密钥 | 子账号名建议 `ld-vod`（仅授 `QcloudVODFullAccess`）| `secureConfig/vod.secretId/secretKey`——上传签名派发 + DescribeMediaInfos/DeleteMedia。**函数运行时临时密钥签不了 VOD，必须独立子账号** |
| 3 | 任务流模板 | 名称 = `secureConfig/vod.procedure` 所填（建议 `LuckyDuckyVod`）| 上传完成自动触发：转码（首选 H.264 720p 单档·教学视频量级够用成本最低）+ 雪碧图（R36 拖动预览·建议每 2s 一帧）+ 封面截图（poster 缺口）|
| 4 | 播放域名 | 自有已备案域名（建议 `vod.luckyducky.cn`·CNAME 指 VOD）| 默认分发域名官方定位「仅用于测试」，线上必须自有域名（同 `kf.luckyducky.cn` 备案先例）|
| 5 | Key 防盗链 | 在播放域名上开启；Key = `secureConfig/vod.playKey` | `getPlaybackUrl` 鉴权后本地 md5 签名（有效期 6h·kit/vod.ts SIGN_TTL_SEC）；**Key 未配则 VOD 段一律 url:null（fail-closed）** |
| 6 | 事件通知模式 | **不配置回调 URL**（拉模式·刻意）| 转码完成感知走 admin「同步转码状态」按钮 on-demand 查询（DescribeMediaInfos）——云函数无公网回调入口，不为此开 HTTP 访问服务 |

## 重建手册（新环境 / 误删后照做）

> 顺序不可跳：**阶段 0 部署 → 1 锁库权限 → 2 控制台四步 → 3 填清单页 → 4 真实视频验收**。控制台菜单名以腾讯云现版为准（改版较频繁，按含义找）。

### 阶段 0 · 让代码上线（前置，否则清单页看不到 VOD 组）

改动面＝云函数 `adminApiV2`/`app`/`cleanupEvents` + admin 静态托管。照运维手册 §① 部署（险级顺序：定时器 → adminApiV2 → app 最后·`app` 先读 §1.4 stale 陷阱）：

```bash
npm run build:rw-cloud
tcb fn deploy cleanupEvents --dir rewrite/cloud/dist/cleanupEvents --force -e cloudbase-d4gcssqbv06865479
echo y | tcb fn deploy adminApiV2 --dir rewrite/cloud/dist/adminApi --force -e cloudbase-d4gcssqbv06865479   # ⚠️ 云端名≠目录名
echo y | tcb fn deploy app --dir rewrite/cloud/dist/app --force -e cloudbase-d4gcssqbv06865479
npm run build:rw-admin
tcb hosting delete admin --dir --yes -e cloudbase-d4gcssqbv06865479
tcb hosting deploy rewrite/admin/dist admin -e cloudbase-d4gcssqbv06865479
```
`echo y |` 不可省（带 config.json 的函数弹确认框，不答＝假部署·运维手册 §1.1）。**上线自证**：`/admin` → 配置清单页出现「视频点播 VOD」组 5 项（4 项 missing + 1 项 check）＝前后端都真上线了；看不到就别往下走。

### 阶段 1 · 锁 secureConfig 集合权限（密钥要进这个抽屉·前置硬闸）

```bash
echo y | tcb permission set collection:secureConfig --level adminonly -e cloudbase-d4gcssqbv06865479
tcb permission get collection:secureConfig -e cloudbase-d4gcssqbv06865479   # 应回 adminonly
```
报「集合不存在」＝先在云开发控制台建 `secureConfig` 集合再锁（运维手册 §3.6 同条·待办与债最高优先项）。

### 阶段 2 · 腾讯云控制台四步

1. **开通 + 充值**：console.cloud.tencent.com/vod → 开通（按量后付费）→ **确认账户有余额**（欠费即停服、播放全断）。用主应用，**不启用子应用**（代码未传 vodSubAppId）。
2. **CAM 子账号 + 密钥**：console.cloud.tencent.com/cam → 新建用户 `ld-vod` → 勾「编程访问」→ 权限**只授 `QcloudVODFullAccess`**（最小权限）→ 创建完成页的 **SecretKey 只显示一次**，当场抄下。
3. **任务流模板**：任务流设置 → 新建，名 `LuckyDuckyVod`（与清单页 VOD_PROCEDURE 一致即可，自取名亦可），内含三任务：
   - **转码（必需·缺它段永远「转码中」发不了）**：H.264、**720P**（教学视频够用、成本最低）、GOP/关键帧间隔 **2 秒**（决定拖动跟手与 seek 落点精度）
   - **雪碧图**：采样间隔 2 秒、10×10（R36 拖动预览窗素材·批3 消费）
   - **封面截图**：默认（补 poster 缺口）
4. **播放域名 + 防盗链**：分发播放设置 → 域名管理 → 添加 `vod.luckyducky.cn` → 按提示到域名解析商加 **CNAME** → 生效后该域名「访问控制」→ **开启 Key 防盗链** → 抄下 Key。备案：`luckyducky.cn` 主域已备案（`kf.luckyducky.cn` 在用），子域通常继承；控制台若提示未备案则先处理备案/接入商。**默认域名 `*.vod2.myqcloud.com` 官方仅限测试，线上必须自有域名。**

### 阶段 3 · 四个值填进 admin

`/admin` → 配置清单 → 「视频点播 VOD」组：SecretId / SecretKey（阶段 2.2）· 播放 Key（2.4）· 任务流模板名（2.3）。**四个一次填全**（缺 procedure＝传上去不转码；缺 playKey＝播放一律拒发）。填完刷新，四项应转绿。输入框恒显示空白是**零回显设计**，以状态灯为准。

### 阶段 4 · 真实视频验收（验收终点信号·「拿到」≠「用通」·根因#8）

**先用一段 1–2 分钟短视频试，别一次传 100 段。** admin 课程编排传一段 → 段显橙色「转码中」+ 页头出现「同步转码状态」→ 等 2–5 分钟点同步 → 提示「就绪 1 段」橙标消失 → 发布 → **真机**小程序进课播放。逐项确认：能播 / 清晰度合理 / 拖动松手能跳 / 退出重进能续播。TC3 手签与防盗链签名对真实平台的正确性只有这一步证得了（自动化测试证的是算法自洽与行为契约，不是平台联通）。

## 运维坑册

- **帮助视频线恒走云存储、不迁 VOD**（守卫 `rw-admin-help-video-stays-cos` 焊死）：admin 的 `uploadVideo` 是课程/帮助两线**共用**函数，走 VOD 须显式 `allowVod`（默认老路·fail-safe）。求助面板视频的播放侧 `getHelpVideos` 只认云存储 fileID（无 vodUrl 字段、无转码同步、无发布闸兜底），误传进 VOD 会换不到地址、**静默全哑**——批2 初版正是漏了这条调用面，机器闸与测试对跨线影响全绿（根因#8），加守卫自纠。
- **上传后「传完 ≠ 可播」**：转码是异步的（短段几十秒到几分钟），发布被云端闸（VOD_PROCESSING）拦到全部就绪——这是刻意设计不是故障。
- **VOD 任务记录只保留 72h**：转码结果核对别拖过 3 天（admin 同步按钮随点随查，正常节奏碰不到）。
- **播放域名换了 = 已回写的 vodUrl 全部失效**：段上存的是完整播放 URL；换域名后须对全部课程重跑「同步转码状态」前先清空 vodUrl（或另立迁移批）。轻易别换域名。
- **防盗链 Key 轮换**：控制台换 Key → 立即填 /config-checklist 新值（填即生效·无需部署）；旧签名 URL 最长 6h 内自然过期，期间学员端靠失速重取址自愈。
- **删媒资走发布 GC**：admin 替换视频→发布后自动进 24h 缓期队列→cleanupEvents 每日 DeleteMedia；控制台手工删媒资会让队列条目按 ResourceNotFound 出队（幂等安全）但别养成习惯。

## drift-checklist（并入 README 总单）

- [ ] VOD 服务开通、账户余额 > 0（按量欠费即停服，播放全断）。
- [ ] 子账号 `ld-vod` 存在、密钥未泄露轮换记录正常；权限仍仅 `QcloudVODFullAccess`。
- [ ] 任务流 `LuckyDuckyVod` 存在，含 转码+雪碧图+封面 三任务；模板名 == `secureConfig/vod.procedure`。
- [ ] 播放域名 CNAME 解析正常、SSL 未过期、Key 防盗链开启且 Key == `secureConfig/vod.playKey`。
- [ ] admin /config-checklist 页 VOD 组 4 项全绿。
