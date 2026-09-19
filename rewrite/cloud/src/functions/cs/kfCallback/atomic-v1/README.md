# atomic-v1 · 收到后·包装 原子库（测版挂接）

可挂测版的原子话术目录：每个 `.txt` 内容 = 发出全文，每文件一句，运行时原样发送、不现编。

## 目录约定

```
atomic-v1/
  README.md
  route.json                          # 本线路由：业务库 + 情绪库
  lib/business/packaging/             # 业务原子（合照 / 产品没事 / 产品有事 / 同理）
  lib/emotion/surprise/               # 情绪原子（本线先只做惊讶）
  sequences/
    packaging_damage_first_touch.json # 首次破损进线发送顺序
```

- `lib/business/packaging/`：`ask_photo_*`、`product_ok_*`、`product_hurt_*`、`empathy_*`
- `lib/emotion/surprise/`：`01-啊.txt` 等，内容仅短句（如「啊？」）
- `route.json`：`emotionAlways: true`；惊讶信号走 `emotion/surprise`
- `sequences/`：编排「先情绪、再业务」的固定序列

## 与旧 Pack 差异

| | 旧 Pack（scripts 整段） | atomic-v1 |
|---|---|---|
| 粒度 | 一条脚本多句/整段 | 一文件一句，可多气泡 |
| 合照 | 易夹杂订单号等 | 权威三句只要合照，禁订单号 |
| 情绪 | 常写死在业务文案里 | 独立 `emotion/*`，始终先抽再拼 |
| 发送 | 一次拼好再发 | 按 sequence：情绪 → 同理 → 合照×3 |
| 来源 | Pack 内嵌/覆盖 | 话术 md + OVERRIDE_packaging 拆出 |

旧 Pack「请先发订单号」对本线作废；权威合照见 `OVERRIDE_packaging.md` / `ask_photo_01~03`。

## 测法

1. 刷新测版会话（清会话 / epoch++，当新客）。
2. 顾客侧发：「包裹被摔坏了」。
3. 预期出泡：先惊讶短句（如「啊？」）→ 再同理一句 → 再三条合照权威句（三气泡依次发）。

来源：`topics/收到后-包装.md`、`docs/04` 惊讶段、`OVERRIDE_packaging.md`。测版已挂进 kfCallback（`bundle-cs-atomic.mjs` 打进资产，运行时不拉 GitHub）。正式线不动。
