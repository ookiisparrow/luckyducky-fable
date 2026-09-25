# atomic-v1 · 收到后·包装 原子库（测版挂接）

可挂测版的原子话术目录：每个 `.txt` 内容 = 发出全文，每文件一句，运行时原样发送、不现编。

## 目录约定

```
atomic-v1/
  README.md
  route.json                          # 本线路由：业务库 + 情绪库
  lib/business/packaging/             # 合照三句 + 短序列共情三句
  lib/business/claim/                 # 理赔口径
  lib/gate/no_order/                  # 无单门闩
  lib/emotion/                        # 情绪二级档（见下表）
  sequences/
    packaging_damage_*.json           # 先情绪、再业务的固定序列
```

- `lib/business/packaging/`：`ask_photo_01`～`03`、`empathy_01`～`03`（短序列共情池读这三份，见该目录 README）
- `route.json`：`emotionAlways: true`；按信号键抽对应 `emotion/*`
- `sequences/`：编排「先情绪、再业务」的固定序列

## 情绪节点表（二级档）

| signal key | 目录 | 中文 | 何时用 | 条数（种子） |
|---|---|---|---|---|
| `surprise` | `emotion/surprise` | 惊讶 | 负面首次或事件变化/升级各触发1次；未升级不重复 | 22 |
| `empathy` | `emotion/empathy` | 共情 | 非我方责任也能体谅情绪（从 packaging 迁出） | 3 |
| `soothe` | `emotion/soothe` | 安抚 | 能处理时先稳住，别着急 | 5 |
| `apology` | `emotion/apology` | 道歉 | **仅**已确认我方失职（不做单独「歉意升级」档） | 3 |
| `awkward` | `emotion/awkward` | 尴尬 | 同事件未升级的再次负面；事件升级则再惊讶 | 5 |
| `ack` | `emotion/ack` | 确认收到 | 收到 / 我看着了 / 图收到了 | 5 |
| `neutral` | `emotion/neutral` | 中性承接 | 平静接话，不升温不降温 | 5 |
| `celebrate` | `emotion/celebrate` | 祝贺/开心 | 问题解决、好评、顺利签收 | 5 |
| `boundary` | `emotion/boundary` | 边界礼貌拒绝 | 超范围要求，礼貌稳住不硬答应 | 5 |
| `default` | → surprise | — | 未识别信号时回落惊讶 | — |

### 程度循环（≤3 步）

同会话负面情绪表演最多串 **3** 档，顺序：

1. **惊讶**（按事件版本：首次/升级才触发）→  
2. **共情 / 安抚 / 道歉**（三选一或短串，按事实边界）→  

之后同会话再来负面 → 改走 **尴尬**（或 ack/neutral），**禁止再抽惊讶**。不另建「歉意升级」档。

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

来源：`topics/收到后-包装.md`、`docs/04` 惊讶段、`OVERRIDE_packaging.md`。不改仓库代码、不部署；仅供测版挂接读盘/打进资产。

## 演进 · 查单门闩 + 优先级组装（2026-09-19）

- 有近期订单 + short：`sequences/packaging_damage_priority_short.json`  
  预期：惊讶 → 道歉/共情 → 合照（≤3气泡）（严重可再挂理赔 P3）
- 无近期订单：`sequences/packaging_damage_no_order.json`  
  预期：澄清（可选转人工），**不发合照**
- 新增原子：`lib/emotion/apology`、`lib/business/claim`、`lib/gate/no_order`

## 演进 · 情绪二级六档 + 共情独立（2026-09-19）

- 新增：`soothe` / `awkward` / `ack` / `neutral` / `celebrate` / `boundary`（各 ≥5 种子）
- `empathy` 信号表在 `lib/emotion/empathy/`；有单短句共情池仍读 `business/packaging/empathy_01`～`03`（见该目录 README）
- `route.json` `emotionLibBySignal` 已挂齐上表全部 key
