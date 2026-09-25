# console-assets · 控制台资产正册（根因账本 #9）

系统的真实形态＝git 内代码 + git 外配置。后者（云开发控制台里的连接器、工作流、库权限、触发器等）没有版本管理，误删即支付/退款/安全瘫痪。本目录把它们正册化：副本（密钥 REDACTED）+ 重建手册 + 核对清单。

## 目录

- `01-支付退款工作流.md` — 支付/退款资产（连接器、3 条工作流、转发节点、`config/pay`、商户号）+ 30 分钟重建手册。
- `forward-node.js` — paynotify / refundnotify 转发节点代码副本。
- `02-库权限期望表.md` — 集合与云存储权限期望档位。
- `03-复合索引期望表.md` — 全部 where+orderBy 复合查询的建索引靶（`npm run db:check-indexes` 对照）。
- `04-视频点播VOD.md` — VOD 转码管线资产（子账号、任务流模板、播放域名、防盗链 Key）+ 重建手册。
- 云函数的超时与内存以仓根 `cloudbaserc.json` 为准（缺 `memorySize` 会在下次应用配置时把现网内存打回默认）；只在控制台、不在 `cloudbaserc.json` 里的见下节。

## 云函数：只在控制台的配置

**定时触发器**（`cloudbaserc.json` 刻意不写 `triggers`：写了会在下次应用配置时碰线上触发器）：

| 函数 | 触发器名 | cron | 含义 |
|---|---|---|---|
| `billReconcile` | `billReconcileTimer` | `0 0 11 * * * *` | 每天 11 点 |
| `cleanupEvents` | `cleanupEventsTimer` | `0 0 3 * * * *` | 每天 3 点 |
| `closeExpiredOrders` | `closeExpiredTimer` | `0 */5 * * * * *` | 每 5 分钟 |
| `inspect` | `inspectTimer` | `0 0 */2 * * * *` | 每 2 小时 |
| `kfHealthProbe` | `kfProbeTimer` | `0 */30 * * * * *` | 每 30 分钟 |
| `recallScan` | `recallTimer` | `0 0 9 * * * *` | 每天 9 点 |

`feedbackNotify` 部署后另配定时触发（建议每日 09:00）。

**其他**：`kfCallback` 的 HTTP 自定义路由是 `/kfcallback`；`initDb` 现网运行时是 Node 16.13（其余 Node 18.15），要升级先改本文件再动控制台，不在 `cloudbaserc.json` 里偷加 `runtime`。环境变量不入 git。

## 变更纪律：先 repo 后控制台

控制台资产要改时，先改本目录的副本，再动控制台，让正册永远领先或同步于线上。

## 核对清单（上线前 / 迁移后 / 定期人工对照一次）

- [ ] 连接器 `wxpay_33nb7su` 存在，凭证未过期（证书序列号无空格）。
- [ ] 主支付工作流 `sywxzfapifqzf_nncvqss2` 存在且**已发布**；入参表达式含 notify_url + payer.openid。
- [ ] 退款工作流 `kbgzl_n8gojr3a` 存在且已发布；方法＝申请退款，数据源＝`wxpay_33nb7su`。
- [ ] paynotify（正册 URL 含 `2065345255437447170`）与 refundnotify（尾号 `1863425`）的 script 节点代码 == `forward-node.js`（核对 name/functionName/FunctionName 三键、OUTER+resource merge、camelCase alias）。本副本据记录重建，首次须与线上逐字校正。
- [ ] `config/pay` 文档 == `01-支付退款工作流.md` 所列 mode / subMchId / flowId / refundFlowId（`tcb db` 可读核对）。
- [ ] 集合与云存储权限档位 == `02-库权限期望表.md`（绝无「所有人可读写」）。
- [ ] VOD 各项 == `04-视频点播VOD.md` 的核对清单。
- [ ] 现网仍是 `cloudbaserc.json` 里的那些函数，超时/内存一致；上表 6 个触发器仍挂、cron 一致；`kfCallback` 路由仍是 `/kfcallback`。
- [ ] 小程序 downloadFile 合法域名（见 `docs/外部配置手册.md`「小程序后台」）。

控制台资产在 git 外，本目录没有机器可验项，验证＝照清单对照线上。
