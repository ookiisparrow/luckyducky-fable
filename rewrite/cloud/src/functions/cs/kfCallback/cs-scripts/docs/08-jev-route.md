# Jev 主分流（本仓落地）

源仓 `docs/08-Jev主分流.md` 仍写三类桶（订单/情绪/需求）。**选句优先级以老板拍板为准，勿反：**

1. 订单状态 orderStatus（最高）
2. 情绪状态 emotionStatus
3. 情况严重程度 severity
4. 责任归属 responsibility（最后）

需求 need 仍要识别（含超出预期 → 犹豫；要图 → 拍照），但**决定走哪一节点时按 1→4**，需求只给主题池和犹豫/拍照，不抢前四步。

## 枚举（对齐 jev.ts）

- orderStatus: pre_order | ordering | pre_ship | shipped | delivered | unknown
- emotionStatus: calm | anxious | upset | angry | disappointed | confused | embarrassed | hesitant | curious | other
- severity: low | medium | high
- responsibility: customer | merchant | logistics | unclear | n/a
- needStatus: logistics | packaging | missing | course | discount | rush | exceeds | photo_needed | greeting | other

## 情绪两层（不可混）

- 顾客情绪 = Jev 输入（emotionStatus）
- bot 表演 = 输出（安抚/同理/道歉/犹豫/澄清/平稳/轻松/惊讶尴尬）
- 顾客激动 ≠ 客服激动；道歉仅 responsibility=merchant
- 每句回复都带表演；表演由 Jev 的情绪+严重程度+责任选，不扫原文猜

## 不做什么（源仓硬规则）

- Jev 只出路由信号，不写长回复、不编政策
- 不替代「请求拍照」等必须顾客提供的信息
- 不在业务侧本地扫原文猜题
