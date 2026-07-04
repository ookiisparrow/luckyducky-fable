# 钱链与订单域 · 黄金用例（行为断言基准）

> 提炼自旧线 tests/（2026-07-04·M0）。用法：新系统对应域重写时逐条转成新测试。剔除口径：精确错误码字符串、微信支付/账单协议字段形态、确定性 `_id` 拼法、测试桩形状、内部机制名——不入基准，但行为本质以栈无关表述保留；具体数值（15 分钟窗等）只作说明性举例，不作硬约束。

## createOrder（下单）

- 价格一律以云端商品表为准计算，前端传的价一律忽略——传伪造低价不生效，成交额恒按云端价×数量。 — `tests/cloud/createOrder.test.js`、`propertyInvariants.test.js`
- 库内脏价 fail-closed：主商品价 ≤0 或 SKU 价超合理上限，作为交易最终关口必须拒单，不放行。 — `tests/cloud/createOrder.test.js`
- 金额全程按最小货币单位（分）整数运算，元浮点求和的漂移不得出现。 — `tests/cloud/createOrder.test.js`、`propertyInvariants.test.js`
- 未登录（无身份）必须拒单。 — `tests/cloud/createOrder.test.js`
- 空条目、非整数或 ≤0 的数量一律拒单。 — `tests/cloud/createOrder.test.js`
- 单品数量与单内条目数有硬上限，超大单必须被拦。 — `tests/cloud/createOrder.test.js`
- 只买搭配购/配件、无主商品的整单必须拒（前端守卫的云端对等物）。 — `tests/cloud/createOrder.test.js`
- 商品不在云端商品表、或传了云端不存在的规格，整单必须拒。 — `tests/cloud/createOrder.test.js`
- 命中 SKU 时价格取云端 SKU 价、规格名进订单快照；搭配购价取云端表，均不信前端。 — `tests/cloud/createOrder.test.js`
- 已停售（软下架）商品必须在下单入口拒单：不建单、不扣库存；夹带在多条目里也整单拒。 — `tests/cloud/createOrder.test.js`
- 收货地址四要素缺一即拒、手机号过短即拒（服务端必填校验）。 — `tests/cloud/createOrder.test.js`
- 地址只入库白名单字段、多余字段丢弃；超长字段云端截断到上限（不信前端长度）。 — `tests/cloud/createOrder.test.js`
- 订单号库级唯一，撞号绝不覆盖已存在订单；重试耗尽则拒单、旧单原封不动。 — `tests/cloud/createOrder.test.js`
- 支付未真实配置时 fail-closed：生产缺支付配置、或仅凭可篡改的库内配置声称"mock"，都不得伪造"已付"订单，必须拒单且不落任何单——安全闸只认环境级开关，不认数据配置。 — `tests/cloud/createOrder.test.js`
- 真实支付模式下下单落"待支付"态、不记支付时间，等回调置付；仅 mock/开发态可直接落已付。 — `tests/cloud/createOrder.test.js`

## pay（发起支付）

- 未登录、缺订单号必须拒；只能支付本人订单，他人订单表现为"不存在"。 — `tests/cloud/pay.test.js`
- 只有待支付订单能发起支付，已付订单不得再次发起。 — `tests/cloud/pay.test.js`
- 支付通道未真实启用（mock 模式或缺工作流配置）一律不放行发起。 — `tests/cloud/pay.test.js`
- 发起支付时若订单已超时，须惰性关单并拒付，不得对超时单发起收款。 — `tests/cloud/pay.test.js`
- 发起支付传给支付通道的金额取库内订单金额（换算为分），并透传本单号与本人身份，不信前端金额。 — `tests/cloud/pay.test.js`
- 券抵扣到 0 元的单不走外部支付通道，直接置已付；置已付前若被并发关单抢先，以并发结果为准、不得谎报支付成功（须校验状态确已翻转）。 — `tests/cloud/pay.test.js`
- 外部通道未返回可用预付单或调用异常时，订单须留在待支付态、不误置其他态。 — `tests/cloud/pay.test.js`

## payCallback（支付回调 / 收款入账）

- 回调只接受可信来源：无用户上下文的服务端调用才放行；带用户身份的伪造回调一律不改任何钱状态，且静默确认、不回泄露探测信号。 — `tests/cloud/payCallback.test.js`、`moneychainAlert.test.js`
- 成功回调把待支付单置已付、留存支付时间与交易凭证号，只生效一次；重复成功通知不改写（幂等）。 — `tests/cloud/payCallback.test.js`
- 非成功通知（失败/未支付/关闭等）不改订单状态。 — `tests/cloud/payCallback.test.js`
- 回调金额与库内不符时：仍照常入账置已付（钱已收），但必须留可对账痕并打钱链告警供人工对账，不静默。 — `tests/cloud/payCallback.test.js`、`moneychainAlert.test.js`
- 收到未知订单号的成功通知（收钱无单）仍须幂等确认不抛，并打钱链告警；缺单号的通知须确认不抛。 — `tests/cloud/payCallback.test.js`
- 已关单后才到的成功回调（钱已收）须复活订单；复活置已付前必须重抢库存——抢到才置已付并扣减，抢不到进"待退款"态、不超卖、留收款时间待人工退款；无实物预留则直接复活。 — `tests/cloud/payCallback.test.js`
- 关单回补造成的瞬时"抢不到库存"窗口须带重试缓冲：回补落定后重试即成功不误判售罄；真售罄重试到上限仍失败才进待退款。 — `tests/cloud/payCallback.test.js`
- 新旧两种回调协议形态都须支持，"成功入账/非成功不改/金额不符留痕/幂等"行为一致（协议字段细节剔除）。 — `tests/cloud/payCallback.test.js`

## applyRefund（申请退款）

- 未登录、缺参数必须拒；只能对本人订单申请，他人订单表现为不存在。 — `tests/cloud/applyRefund.test.js`
- 只有已付/已发货/已完成的订单可申请退款，待支付单不可。 — `tests/cloud/applyRefund.test.js`
- 只能退单内存在的商品；进课已失退货权的条目必须拒。 — `tests/cloud/applyRefund.test.js`
- 退款额由云端按券比例分摊到各商品算出（不信前端金额）；单品订单退额=全额实付；同单多商品按各自金额占比分摊，同单累计退款不得超过实付。 — `tests/cloud/applyRefund.test.js`
- 一单一行一售后、库级唯一防重复申请；同商品不同 SKU/行各自可独立申请。 — `tests/cloud/applyRefund.test.js`
- 数量级退款：买 N 进 M 只退剩余 N−M 件、金额按剩余件数摊；整行全部进课则不可退；退款额度用尽后不可再退。 — `tests/cloud/applyRefund.test.js`

## refundCallback（退款回调）

- 回调只接受可信来源：带用户身份的伪造回调一律不改状态。 — `tests/cloud/refundCallback.test.js`
- 成功回调把已批准售后置已退款、留存退款交易凭证号与订单留痕，只生效一次；重复通知不改写。 — `tests/cloud/refundCallback.test.js`
- 核验 fail-closed：回调的订单号或退款金额与售后单不符时，不得置已退款，须留可对账痕并打钱链告警。 — `tests/cloud/refundCallback.test.js`
- 非成功退款状态留痕、不翻状态；未知售后单/缺单号仍须确认不抛。 — `tests/cloud/refundCallback.test.js`
- 退款成功后：订单未发货则回补对应条目库存；已发货则实物已出库不回补（防幻影库存超卖）。 — `tests/cloud/refundCallback.test.js`

## 后台审批退款 / 打款

- 后台钱相关动作须鉴权，口令错误直接拒、不进任何业务分支。 — `tests/cloud/adminRefundActions.test.js`
- 同意退款须原子抢占置"已批准"并触发外部退款打款，打款额取售后单分摊额（换算为分）；重复审批被状态闸拒，外部退款只触发一次（不二次打款）。 — `tests/cloud/adminRefundActions.test.js`
- 触发退款工作流未受理时须回滚为可重试态；但回滚必须条件化——若退款回调已抢先置"已退款"，回滚不得把它打回（防二次退款）。 — `tests/cloud/adminRefundActions.test.js`
- 申请后又确认进课的单，同意时须按当下重算封顶：全部进课则拒绝退款，部分进课则按剩余件数降级金额打款并留降级痕。 — `tests/cloud/adminRefundActions.test.js`
- 拒绝退款必须填原因、原因落库；拒绝须原子化——若已被"同意"抢先（钱已进退款通道），状态不得倒回"已拒绝"。 — `tests/cloud/adminRefundActions.test.js`
- 金额异常（对账不符）的订单必须挡住发货，人工解除异常标记后方可发货。 — `tests/cloud/adminRefundActions.test.js`、`shipOrder.test.js`

## 确认收货 / 超时关单

- 确认收货：未登录/缺单号拒；只能确认本人订单；只有已发货订单能确认收货并置完成，越状态或重复确认拒。 — `tests/cloud/confirmReceive.test.js`
- 超时关单只关超过下单超时窗的待支付单并记关单时间，新单与其他状态单不动，返回关单数。 — `tests/cloud/closeExpiredOrders.test.js`
- 超时关单只允许服务端（定时器）调用；客户端带身份的调用一律拒、不关任何单。 — `tests/cloud/closeExpiredOrders.test.js`
- 关单须回补该单预留库存，且幂等——已关单不重复回补。 — `tests/cloud/inventory.test.js` 等

## 订单/售后查询（用户端）

- 均须登录，未登录 fail-closed 拒；只能看本人订单/售后，按时间倒序；列表接口须游标分页。 — `tests/cloud/getMyOrders.test.js`、`getMyAfterSales.test.js`
- 按 ID 查订单：本人可查，他人订单与不存在订单都表现为"不存在"，不泄露存在性。 — `tests/cloud/getOrderById.test.js`

## 后台订单/退款列表与详情

- 按状态的标签计数须服务端全量精确统计，不得从"已加载页"推断——分页后计数不得少算。 — `tests/cloud/orderCounts.test.js`、`refundCounts.test.js`
- 按状态筛选须在服务端完成，只返回该状态数据、翻页能拿全不漏，不同状态不混入。 — 同上
- 按单号搜索须服务端精确，无视当前状态标签搜全部状态；不存在返回空。 — 同上
- 订单/退款详情的"是否已激活/已进课"判据须查真实数据链算出（不伪造徽章）；判据须区分"已激活未进课"与"已激活已进课"；未激活者退货权未失、可退。 — `tests/cloud/orderDetail.test.js`、`refundDetail.test.js`
- 商品无对应课程时判据课程标识按同一确定性口径回退（与发码同口径，不落空）。 — `tests/cloud/refundDetail.test.js`

## 对账（内部 + 外部逐笔）

- 累计总额走全量精确聚合（不封顶），收入口径=已付，净额=收入−退款。 — `tests/cloud/reconciliation.test.js`
- 支持按日期范围汇总，并按自然日（固定时区）分桶出每日流水（收入/退款/净额/笔数），累计值不受范围影响。 — `tests/cloud/reconciliation.test.js`
- 内部异常复用单一数据源汇总：金额不符单、退款不符单、超时未回调的卡单。 — `tests/cloud/reconciliation.test.js`、`dashboard.test.js`
- 每日明细超出有界拉取上限时须如实标"近似"，不把截断当完整。 — `tests/cloud/reconciliation.test.js`
- 我方已付款单与外部账单按交易凭证号逐笔勾对，显形四类差异：已平 / 外部有我方无（收钱无单，最危险）/ 我方有外部无 / 金额不符。 — `tests/cloud/bill-match.test.js`
- "我方有外部无"只在该日账单已拉取时才判定为差异——账单未拉的日期只是没数据、不得误报；未拉任何账单时全部计 0；比对面触达上限时标"近似"。 — `tests/cloud/bill-match.test.js`
- 对账单出站请求须用商户私钥做密码学签名，且签名真能被对应公钥验证通过（拿到密钥≠用通，验密码学正确性）。 — `tests/cloud/wxpay-bill.test.js`
- 外部账单解析须正确识别数据行、剔除汇总等非交易行；空/异常输入返回空不抛。 — `tests/cloud/wxpay-bill.test.js`
- 拉账单为多段请求，网络/状态异常须 fail-soft；账单落库幂等（同日重跑不重复）；缺对账凭证时返明确错误、不抛、不落库。 — `tests/cloud/wxpay-bill.test.js`

## 金额/价格/limit 属性不变量

- 元↔分转换 round-trip 无浮点漂移；两位小数元价转分恒为整数分；非整数分是脏数据，转换闸当场抛错不入库；金额转换单调不减。 — `tests/cloud/propertyInvariants.test.js`
- 价格校验：≤0、无穷大、NaN、超上限一律拒；合法区间 (0, 上限] 一律放行。 — 同上
- 分页 limit 对任意标量垃圾输入永远钳在 [1,200]；空游标一律归一为空。 — 同上

## 钱链可观测告警

- 钱链/安全的语义级"静默失败"必须主动打出统一可告警信号（不能只依赖平台通用指标）：金额不符、收钱无单、退款与单不符、爆破锁定、伪造回调命中——每类都要有可被告警识别的信号，且区分严重级别（钱/安全）。 — `tests/cloud/moneychainAlert.test.js`

## 发货 / 合规上报

- 发货向外部平台上传发货信息是接缝，须 fail-soft：上传失败绝不反噬本地发货（本地照样置已发货）、须留痕并打告警。 — `tests/cloud/shipOrder.test.js`
- 缺支付交易凭证号时不调用外部上传、留痕，本地仍可发货；改运单号的二次发货同样触发合规上报。 — `tests/cloud/shipOrder.test.js`
- 物流公司名映射到外部平台编码，未登记的映射到"其他"（编码表剔除，保留"须映射且有兜底"）。 — `tests/cloud/shipOrder.test.js`
- 批量发货逐单独立：成功/金额异常挡/坏状态/缺单各自回报，一单失败不影响其余；逐单可覆盖整批快递公司。 — `tests/cloud/shipOrders.test.js`

## 跨域子集（收录口径）

- 库存防超卖/回补的钱链子集见 `inventory-scm.md`（同源不复抄）；进课→退货权失效见 `learning-content.md` §二；GMV 口径（只计已付、精确聚合恒不标近似、未付/关闭不计钱）与钱链异常定向精确查询（不从抽样过滤，防老单漏报）收录于此。 — `tests/cloud/dashboard.test.js`
- 订单状态机底座（条件流转+幂等）见 `kit-security.md` §A——是 pending/paid/shipped/done/closed/refund_required 所有钱状态翻转的共性守卫。

## 覆盖清点

**完整在域 23 文件**（createOrder/pay/payCallback/applyRefund/refundCallback/closeExpiredOrders/confirmReceive/getMyOrders/getOrderById/getMyAfterSales/reconciliation/bill-match/wxpay-bill/propertyInvariants/moneychainAlert/orderCounts/orderDetail/refundCounts/refundDetail/adminRefundActions/shipOrder/shipOrders/kit-transition）+ **部分在域 3 文件**（inventory/confirmEnter/dashboard 只收钱链子集）≈ 181 个旧用例通读。
**收录 107 条**栈无关行为基准（21 个函数/主题分节）。
**剔除类别（未静默丢弃）**：精确错误码串 / 微信支付回调双协议字段 / APIv3 账单与凭证格式 / 确定性 `_id` 拼法 / 内部机制与字段名（版本位、异常标记名、预留字段）/ 测试夹具数值——行为语义均已保留。未发明任何测试中不存在的断言。
