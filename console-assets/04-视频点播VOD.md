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

1. 开通云点播（cloud.tencent.com/vod）→ 账户充值（按量后付费）。
2. CAM 新建子账号 `ld-vod`，只授 `QcloudVODFullAccess`，生成 API 密钥（一次性展示，当场填 admin /config-checklist 的 VOD_SECRET_ID / VOD_SECRET_KEY）。
3. 任务流设置 → 新建任务流 `LuckyDuckyVod`：转码模板（H.264 720p，GOP 建议 2s——seek 落点精度与拖动响应的决定项）+ 雪碧图模板（采样间隔 2s）+ 封面截图模板；模板名填 /config-checklist 的 VOD_PROCEDURE。
4. 分发播放设置 → 添加自有域名 `vod.luckyducky.cn`（域名服务商处按提示加 CNAME）→ 开启 Key 防盗链 → Key 填 /config-checklist 的 VOD_PLAY_KEY。
5. 验证终点信号（「拿到」≠「用通」·根因#8）：admin 课程编排传一段真实视频 → 段显示「转码中」→ 几分钟后点「同步转码状态」转就绪 → 发布 → 真机小程序能播且拖动/重试正常。TC3 手签与防盗链签名的正确性只有这一步证得了。

## 运维坑册

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
