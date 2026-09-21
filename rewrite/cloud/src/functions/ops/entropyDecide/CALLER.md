# entropy_decide 调用说明（测版）

给**项目降熵**用：提案前对**一条**候选做 Jev 快判。这是测版骨架，**不是**正式线，也**不是**企微客服分流。

协调侧会合入后部署到测试云 `yaliceshi`。本仓不自动部署。

## 入口

| 项 | 值 |
|---|---|
| 云函数名 | `entropyDecide` |
| 源码 | `rewrite/cloud/src/functions/ops/entropyDecide/` |
| 调用 | `tcb fn invoke entropyDecide`（或 CloudBase HTTP 访问服务，若已绑路由） |
| 模型 | `jev-latest` · `POST https://api.typesafe.ai/v1/systemone` |
| 一次 | **一个** `candidate`。不要传 `candidates` 数组。 |

与客服的隔离：不要走 `kfCallback`，不要设 `JEV_CS_ROUTE`。本函数不读那道闸。

鉴权：`withAdminGate`——控制台 / CLI 无 openid 可调；小程序端须管理员。测版不要对公网裸挂 HTTP。

## 环境变量（函数 env 或库）

| 名 | 默认 | 含义 |
|---|---|---|
| `TYPESAFE_API_KEY` | （空） | TypeSafe 密钥。也可写库 `secureConfig/typesafe` 的 `TYPESAFE_API_KEY` 或 `apiKey`。**env 优先。** |
| `ENTROPY_DECIDE_HIGH_MIN` | `0.7` | Choice `confidence` ≥ 此值记 `high`，否则 `low` |
| `ENTROPY_DECIDE_NOUL_HIGH_MIN` | `0.7` | Noul `high_confidence` ≥ 此值记 `true` |
| `ENTROPY_DECIDE_TIMEOUT_MS` | `8000` | 打 TypeSafe 的超时 |

**禁止**把真实 key 写进聊天、仓库、PR、日志、截图。盒文件自行保管。轮换：TypeSafe 控制台作废旧 key → 更新盒文件 → 同步改本函数 env 或库文档。

无 key / 超时 / 5xx 或解析失败：不抛密钥，回 `choice=suspect` + `fallback=no_key|timeout|error`。

## 请求

`schema_version` 必须是 `"0.1"`。`intent.statement` 必填（空则不要调 Jev，本函数直接 `INVALID_REQUEST`）。

```json
{
  "schema_version": "0.1",
  "intent": {
    "statement": "把仓库里对当前意图没有贡献的死代码清出去",
    "source": "user",
    "repo": "ookiisparrow/luckyducky-fable"
  },
  "candidate": {
    "id": "dead-util-1",
    "kind": "dead_code",
    "locator": { "path": "rewrite/cloud/src/lib/unused.ts", "range": { "start_line": 1, "end_line": 20 } },
    "excerpt": "export function unusedHelper() { return 1 }",
    "hard_signals": [
      { "type": "no_references", "detail": "grep 全仓零命中，测试也没覆盖这个入口" }
    ]
  },
  "constraints": { "forbid_auto_delete": true, "production_touch": false }
}
```

`excerpt` 超过 2KB 会被截断。`hard_signals` 可以是 0 条——0 条时实现方**不会**给出可删的 `strip`（提示词 + 门控都偏向 `suspect`）。

校验失败（版本不对 / 缺 statement / 传了 `candidates`）返回：

```json
{ "ok": false, "error": "INVALID_REQUEST", "detail": "intent.statement" }
```

HTTP 触发时这类回 400；`callFunction` 直接回这个对象。

## 响应

```json
{
  "schema_version": "0.1",
  "candidate_id": "dead-util-1",
  "choice": "keep",
  "confidence": "high",
  "reason": "相对意图仍有贡献",
  "contributes_to_intent": true,
  "noul": { "high_confidence": true },
  "fallback": null
}
```

| choice | 降熵怎么用 |
|---|---|
| `keep` | 不进删除提案 |
| `strip` | **仅当** `confidence=high` 且 `noul.high_confidence=true` 才进「可删提案」。实现方已门控：模型松口也会被改写成 `suspect` |
| `suspect` | 待确认，禁止当确定删除 |

`reason` 是短码映射（≤40 字），不是模型自由发挥。门控改写时为「strip 未过置信门控」；Jev 不可用时为 `jev_unavailable`。

无 key 示例：

```json
{
  "schema_version": "0.1",
  "candidate_id": "dead-util-1",
  "choice": "suspect",
  "confidence": "low",
  "reason": "jev_unavailable",
  "contributes_to_intent": null,
  "noul": { "high_confidence": false },
  "fallback": "no_key"
}
```

## 配额建议（测版）

- 一次调用 = 一个 candidate。汇总提案必须逐条带上 `choice/confidence/reason`。
- 一轮批次建议 **≤20** 次。要并行扇出请自己限流（官方 429/529 会落到 `fallback=error`）。
- 超时默认 8 秒，比客服聊天那条 2.5 秒宽；仍超时就 `fallback=timeout`，不要重试打爆配额。
- 本函数**不会**自动删代码、关 Issue、合 PR。

## 部署（人工）

1. `npm run build:rw-cloud` 得到 `rewrite/cloud/dist/entropyDecide/`
2. 部署到测试云 `yaliceshi`（`npm run env:resolve -- --target test`），**不要**默认打生产
3. 只在 `entropyDecide` 函数 env 填 `TYPESAFE_API_KEY`（或库 `secureConfig/typesafe`）
4. 改 env 后要重新部署本函数才进进程
