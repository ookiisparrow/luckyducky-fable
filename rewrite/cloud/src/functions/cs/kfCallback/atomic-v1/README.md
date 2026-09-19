# atomic-v1 · 收到后·包装 原子库（测版挂接）

可挂测版的原子话术目录：每个 `.txt` 内容 = 发出全文，每文件一句，运行时原样发送、不现编。

## 目录约定

```
atomic-v1/
  README.md
  route.json                          # 本线路由：业务库 + 情绪库 + 查单门闩
  lib/business/packaging/             # 业务原子（合照 / 产品没事 / 产品有事 / 同理）
  lib/business/claim/                 # 理赔原子（P3，严重/运输损坏才挂）
  lib/emotion/surprise|apology|try_hard
  lib/gate/no_order/                  # 无近期订单：澄清 / 转人工
  sequences/
    packaging_damage_priority_short.json  # 有单短句默认序
    packaging_damage_no_order.json        # 无单：只澄清，不发合照
    packaging_damage_first_touch.json     # 旧首次序（兼容留档）
```

- `route.json`：`emotionAlways` + 门闩 `recentOrderRequiredForBusiness`；默认句型 `short`
- 权威合照只要 `ask_photo_01~03`，禁订单号

## 流水线（测版）

1. 拼句窗：同会话连续短输入可拼（最小 debounce）
2. 查单门闩：无近期订单只跑 `packaging_damage_no_order`，后面合照/理赔不发。yaliceshi/develop 默认 `CS_TEST_ASSUME_ORDER` 开（缺省或 `1`），没绑号也走有单短句；`0`/`false` 恢复真查单。正式 release / 生产云硬关。
3. 一问多面：外包装破损→合照；物流/运输严重→理赔；负面→惊讶→道歉/共情→尽力
4. 优先级：P0 门闩 → P1 情绪 → P2 要图 → P3 理赔（条件）→ P4 收尾（本批空）
5. 装完后压到 ≤`CS_MAX_BUBBLES`（默认 3）：P1 惊讶/道歉/共情/尽力并 1 条；P2 只发权威合照 `ask_photo_01`（long 同优先并 1 条）；P3 理赔可留第 3 泡，超顶则并进业务条
6. 句型：会话级 `short|long`，不足默认 short。总泡同样 ≤3

## 测法

刷新后发「我的包裹被压烂了」：

- **有单短句**（测版默认）：情绪综合 → 合照请求（`ask_photo_01`）→（可选）理赔/收尾；约 3 泡内，不要 6 连发
- **无单**：只澄清/转人工，无合照（测版须 `CS_TEST_ASSUME_ORDER=0`）

测版 yaliceshi only；正式闸关路径不走这里。构建打进 kfCallback（`bundle-cs-atomic.mjs`），运行时不拉 GitHub。
