   接进入 payment_exception 且不做任何库
   存操作。
      - 更关键的是：在 closed 路径中
   ，transition 成功后没有 restoreStock，
   但 p.doc（closed 状态）可能还持有
   reserved。如果 closeExpiredOrders 已经
   restore 过了，那 reserved 字段仍存在但
   库存已释放。transition 只是改状态，不
   动 reserved 字段。这会导致 reserved 字
   段残留在 payment_exception 单上。
      - 这个 reserved 残留会在后续
   refundCallback 或进一步处理中被误用吗
   ？refundCallback 目前只回补库存一次，
   如果 reserved 字段还在但库存已释放，不
   会二次扣减。但如果 closeExpiredOrders
   还没来得及 restore，payCallback 进入
   payment_exception 后也不 restore，那库
   存就永远被占了。
      - 等等，让我再看 payCallback 的
   closed 路径逻辑：当第一次 transition
   pending→payment_exception 失败后，读取
   fresh status。如果 status ===
   'closed'，进入 closed 路径。
      - 如果是 closeExpiredOrders 把订单
   从 pending 关到 closed，它会
   restoreStock。所以 reserved 已释放。
      - 但竞态情况：payCallback 先读取
   initial（pending），然后 transition
   pending→payment_exception 失败（因为并
   发关单已经把它变成 closed）。如果关单
   流程还没来得及 restoreStock，而
   payCallback 又进入
   closed→payment_exception 也不
   restore，那库存就泄漏了。
      - 不过 closeExpiredOrders 里是
   transition 成功后再 restoreStock。
   transition 是原子的，一旦 transition
   成功，订单就是 closed。如果
   payCallback 看到 closed，说明
   transition 已经成功，restoreStock 可能
   已经执行也可能正在执行。如果
   closeExpiredOrders 的 restoreStock 抛
   错或还没执行，payCallback 进入
   payment_exception 不 restore，确实会泄
   漏库存。
      - 这是一个严重问题。

   2. **严重：applyRefund 未放行
   payment_exception，但
   payment_exception 订单客户可能想要自助
   退款**
      - 用户重点提到"各端状态标签/按钮是
   否有漏归类或绕过路径"。当前
   applyRefund 只允许 paid/shipped/done，
   不包含 payment_exception。这意味着客户
   不能在小程端申请退款，只能联系客服。
      - 这看起来是设计决策（见 refunds.ts
   注释："客户自助面 applyRefund 不扩"）
   。但这是一个审查点，需要指出这是有意识
   的限制，但客服端是否完备？
      - 不，这不是一个 bug，是设计决策。
   但我需要指出其影响。

   3. **中等：shipOrder 只检查
   feeMismatch 标志，不检查 status ===
   'payment_exception'**
      - 在 orders.ts shipOne 函数中：`if
   (got.data.feeMismatch) return { ok:
   false, error: 'FEE_MISMATCH_HOLD' }`。
      - payment_exception 单 feeMismatch
   一定为 true 吗？在 payCallback 中，进
   入 payment_exception 时设置了
   feeMismatch=true。但 recordPaidFee 不
   修改 feeMismatch。
      - 假设未来某个路径产生
   payment_exception 但未设
   feeMismatch，shipOrder 就不会拦截。但
   现在所有 payment_exception 都设了
   feeMismatch，所以暂时安全。
      - 但 clearFeeMismatch 明确拒绝
   payment_exception，所以 feeMismatch 会
   一直保持 true。这是安全的，但属于"靠副
   作用拦"而非"靠状态拦"，不够 robust。

   4. **中等：overrideRefund 中 paidFee
   分母与行分摊的守恒性**
      - `const amountFen = order.status
   === 'payment_exception' ?
   asFen(actualPaidFen) :
   toFen(Number(order.amount))`
      - actualPaidFen =
   Number(order.paidFee)，paidFee 是分
   ，asFen 断言整数分，正确。
      - 但 `goodsFen =
   toFen(Number(order.goods))`，goods 是
   商品总额（元）。对于
   payment_exception，如果多付或少付
   ，goods 仍然按商品标价计算，行分摊
   refundShareFen(amountFen, goodsFen,
   itemFen, used) 仍然按商品比例分摊，这
   是合理的。
      - 但是：如果 paidFee >
   order.amount（多付），amountFen 变大
   ，goodsFen 不变，每行分摊上限可能增加
   ，但总和不超过 amountFen。这是合理的，
   因为多付的钱按商品比例退。
      - 如果 paidFee < order.amount（少付
   ），amountFen 变小，每行分摊上限变小。
   合理。
      - 问题：payment_exception 状态下申
   请 overrideRefund 时，used 计算基于
   afterSales 中已有的退款。但如果之前已
   经按 order.amount 口径申请过退款（旧数
   据），现在按 paidFee 口径可能会出错。
   不过 payment_exception 是新增状态，旧
   数据不会有 payment_exception 单，所以
   安全。
      - 另一个问题：overrideRefund 中
   `const itemFen =
   asFen(toFen(line.price) * (line.qty ||
   1))`，line 来自 order.items。这是对的
   。
      - 还有一个问题：当 order.status ===
   'payment_exception' 且 actualPaidFen
   不合法时，返回 PAYMENT_AMOUNT_MISSING
   。但如果 order.paidFee 是 0（比如 0元
   单？不会，0元单直接 paid）。如果
   paidFee 是 null 或 undefined，返回
   PAYMENT_AMOUNT_MISSING，正确。

   5. **中等：recordPaidFee 可以被滥用**
      - recordPaidFee 只检查 status ===
   'payment_exception' 和 paidFee 是正整
   数分，不检查与 expectedFee 的关系，也
   不检查与 order.amount 的关系。
      - 这意味着管理员可以补录任意正整数
   分，包括比 expectedFee 大得多或小得多
   的值。
      - 但这是管理员核对流水后的操作，属
   于授权范围（cap refund:manage）。不过
   缺乏二次确认或审计之外的上限检查，存在
   一定资损风险。
      - 更严重的是：如果管理员补录错误，
   没有 undo 入口。 paidFeePrev 只是记录
   ，但没有撤销/回滚机制。
      - 还有一个问题：recordPaidFee 没有
   通知或触发后续退款，只是补录。如果补录
   后管理员不操作 overrideRefund，订单仍
   然是 payment_exception。
      - 这是设计问题，不算严重 bug，但值
   得指出。

   6. **中等：inspect 中
   exceptionRefundScanCapped 的处理**
      - 当 afterSales 查询命中 SCAN_CAP
   时，exceptionRefundScanCapped = true，
   但代码没有用它来决定是否将某些订单标记
   为异常。它只是作为 capped 标志返回。
      - 这是合理的，因为 capped 表示"可能
   没扫全"，会体现在巡检结果中。但如果某
   payment_exception 单的 afterSales 退款
   记录超过 SCAN_CAP，exceptionRefunded
   只累计了前 500 条，可能导致误判为未退
   清。
      - 对于售后退款单，一个订单不太可能
   有 500 条退款记录，所以风险较低。

   7. **轻微：transition 早退改动对调用方
   的影响**
      - 现在 transition 在状态不匹配时返
   回 `{
   Interrupted by user

 ✨ 1

 ● 用户输入了一个"1"，可能是误触，也可能
   是让我继续。我需要继续完成审查任务。我
   之前在整理审查意见，现在需要输出完整结
   论。

   我需要继续我的分析并输出结构化审查结论
   。由于这是只读审查，我不需要修改文件。

   让我再检查一下 shipOrder 的完整逻辑，
   以及 closeExpiredOrders 的库存回补逻辑
   ，确认我关于 closed→payment_exception
   库存泄漏的怀疑。

 ● Used Grep (export async function
 shipOrder|export const shipOrder|fu...)
 · 77 matches

 rewrite/cloud/src/functions/adminApi/act
 ions/orders.ts:106,
 rewrite/cloud/src/functions/adminApi/act
 ions/orders.ts-107-  const id =
 String(idRaw || ''),
 rewrite/cloud/src/functions/adminApi/act
 ions/orders.ts-108-  const company =
 String(companyRaw || '').trim().slice(0,
 30), +74 more
     rewrite/cloud/src/functions/admi
     nApi/actions/orders.ts:106:async
     function shipOne(db: any, idRaw:
     any, companyRaw: any,
     trackingRaw: any, operator:
     string) {
     rewrite/cloud/src/functions/admi
     nApi/actions/orders.ts-107-
     const id = String(idRaw || '')
     rewrite/cloud/src/functions/admi
     nApi/actions/orders.ts-108-
     const company =
     String(companyRaw ||
     '').trim().slice(0, 30)
     rewrite/cloud/src/functions/admi
     nApi/actions/orders.ts-109-
     const trackingNo =
     String(trackingRaw ||
     '').trim().slice(0, 40)
     rewrite/cloud/src/functions/admi
     nApi/actions/orders.ts-110-  if
     (!id || !company || !trackingNo)
     return { ok: false, error:
     'BAD_ARGS' }
     rewrite/cloud/src/functions/admi
     nApi/actions/orders.ts-111-
     const got = await
     db.collection('orders').doc(id).
     get().catch(() => null)
     rewrite/cloud/src/functions/admi
     nApi/actions/orders.ts-112-  if
     (!got || !got.data) return { ok:
     false, error: 'NO_ORDER' }
     rewrite/cloud/src/functions/admi
     nApi/actions/orders.ts-113-
     const cur = got.data.status
     rewrite/cloud/src/functions/admi
     nApi/actions/orders.ts-114-  //
     paid = 首次发货；shipped = 改单
     号。其余状态不允许动。
     rewrite/cloud/src/functions/admi
     nApi/actions/orders.ts-115-  if
     (cur !== 'paid' && cur !==
     'shipped') return { ok: false,
     error: buildBadStatus(cur) }
     rewrite/cloud/src/functions/admi
     nApi/actions/orders.ts-116-  //
     金额异常单（feeMismatch 留痕）须
     先「解除」后才能发货（审核批次A
     折中）
     rewrite/cloud/src/functions/admi
     nApi/actions/orders.ts:117:  if
     (got.data.feeMismatch) return {
     ok: false, error:
     'FEE_MISMATCH_HOLD' }
     rewrite/cloud/src/functions/admi
     nApi/actions/orders.ts-118-  //
     退款↔履约状态同步闸（P0·根因
     ：afterSales 与 orders 是两套各
     自实现的状态机，互不知晓对方——
     rewrite/cloud/src/functions/admi
     nApi/actions/orders.ts-119-  //
     approveRefund/overrideRefund 只
     改 afterSales、refundCallback 退
     款成功只翻 afterSales→refunded，
     均从不碰
     rewrite/cloud/src/functions/admi
     nApi/actions/orders.ts-120-  //
     orders；此前 shipOne 唯一放行条
     件是 cur∈{paid,shipped}+非
     feeMismatch，完全不查该单是否已
     有行在退款/已退款。
     rewrite/cloud/src/functions/admi
     nApi/actions/orders.ts-121-  //
     已退款/退款在途的单一旦照发，就
     是钱货两空的资损洞。现场直读
     afterSales（不走派生/缓存字段，
     钱链闸子必须
     rewrite/cloud/src/functions/admi
     nApi/actions/orders.ts-122-  //
     读最新态）：该订单存在
     status∈{applied,approved,refunde
     d}（申请中/已批/已退款——合流并集
     ：#16 深审 P1 挡
     rewrite/cloud/src/functions/admi
     nApi/actions/orders.ts-123-  //
     applied 在途 + main PR20 P0 挡
     approved/refunded 并返回命中行）
     的记录即挡，返回命中的 lineId 供
     前端定位展示，
     rewrite/cloud/src/functions/admi
     nApi/actions/orders.ts-124-  //
     不笼统吞错；rejected（客服拒绝、
     未受理、无钱路径）不挡、自然解闸
     。
     rewrite/cloud/src/functions/admi
     nApi/actions/orders.ts-125-  //
     残余竞态窗口（P2·已收窄+对称可观
     测，非重型锁）：这段读到下方条件
     更新之间仍有一个物理上无法用
     rewrite/cloud/src/functions/admi
     nApi/actions/orders.ts-126-  //
     简单闸子消除的窗口——若
     approveRefund/overrideRefund 恰
     好在这两步之间才把 afterSales 抢
     占成
     rewrite/cloud/src/functions/admi
     nApi/actions/orders.ts-127-  //
     approved，本次 heldLines 读不到
     、会照常放行发货。分布式锁/事务
     模拟不是本仓既有模式、过度工程，
     rewrite/cloud/src/functions/admi
     nApi/actions/orders.ts-128-  //
     故不在此引入；对称收口在
     refunds.ts 的
     approveRefund/overrideRefund：退
     款批准落库后回读一次订单，
     rewrite/cloud/src/functions/admi
     nApi/actions/orders.ts-129-  //
     若发现订单在批准执行期间已变
     shipped（即本窗口被命中），触发
     notifyAlert('money', …,
     'SHIP_REFUND_RACE', …)
     rewrite/cloud/src/functions/admi
     nApi/actions/orders.ts-130-  //
     留高危信号供人工核实——钱货两空的
     窗口从「完全不可见」变成「可观测
     、可人工介入」。
     rewrite/cloud/src/functions/admi
     nApi/actions/orders.ts-131-
     const heldLines = await db
     rewrite/cloud/src/functions/admi
     nApi/actions/orders.ts-132-
     .collection('afterSales')
     rewrite/cloud/src/functions/admi
     nApi/actions/orders.ts-133-
     .where({ orderId: id, status:
     db.command.in(['applied',
     'approved', 'refunded']) })
     rewrite/cloud/src/functions/admi
     nApi/actions/orders.ts-134-
     .field({ lineId: true,
     productId: true, status: true })
     rewrite/cloud/src/functions/admi
     nApi/actions/orders.ts-135-
     .get()
     rewrite/cloud/src/functions/admi
     nApi/actions/orders.ts-136-
     .catch(() => ({ data: [] }))
     rewrite/cloud/src/functions/admi
     nApi/actions/orders.ts-137-  if
     (heldLines.data &&
     heldLines.data.length) {
     rewrite/cloud/src/functions/admi
     nApi/actions/orders.ts-138-
     const lines =
     heldLines.data.map((a: any) =>
     String(a.lineId || a.productId
     || ''))
     rewrite/cloud/src/functions/admi
     nApi/actions/orders.ts-139-
     return { ok: false, error:
     'REFUND_HOLD', lines }
     rewrite/cloud/src/functions/admi
     nApi/actions/orders.ts-140-  }
     rewrite/cloud/src/functions/admi
     nApi/actions/orders.ts-141-  //
     条件更新（审核批次A-6 + 批P 并发
     互斥闸续）：仍是 paid/shipped 才
     写——防与确认收货并发把 done 回滚
     ；
     rewrite/cloud/src/functions/admi
     nApi/actions/orders.ts-142-  //
     同一次写里叠加抢占
     shipUploadLock（CAS neq 'busy'，
     非「一次性 exists」范式——本闸是
     「进行中」busy/idle
     rewrite/cloud/src/functions/admi
     nApi/actions/orders.ts-143-  //
     二态、可反复抢占，不是只能成功一
     次的既有 exists(false) 惯用法，
     因为「改单号」场景要求同单可合法
     地
     rewrite/cloud/src/functions/admi
     nApi/actions/orders.ts-144-  //
     再次触发上传）。根因：两个几乎同
     时到达的并发 shipOne 调用可能都
     读到 cur=paid、都通过上方状态闸
     ——
     rewrite/cloud/src/functions/admi
     nApi/actions/orders.ts-145-  //
     若只闸
     status（'shipped'→'shipped' 对二
     次调用天然放行，不是能拦并发的
     CAS），两次调用会各自独立
     rewrite/cloud/src/functions/admi
     nApi/actions/orders.ts-146-  //
     触发一次微信发货上传，后写入的
     wxShipUploaded/wxShipError 无条
     件覆盖前一次结果（可能把合规上传
     成功
     rewrite/cloud/src/functions/admi
     nApi/actions/orders.ts-147-  //
     覆盖成误报失败，或反过来盖掉真实
     失败）。shipUploadLock 抢占失败
     不代表状态真的不合法，故失败后二
     次读判：
     --
     rewrite/cloud/src/functions/admi
     nApi/actions/orders.ts:232:expor
     t async function shipOrder({ db,
     data, agentId }: Ctx) {
     rewrite/cloud/src/functions/admi
     nApi/actions/orders.ts-233-
     const r = await shipOne(db,
     data.id, data.company,
     data.trackingNo, agentId ||
     'admin')
     rewrite/cloud/src/functions/admi
     nApi/actions/orders.ts-234-
     return reply(r.ok ? 200 : 400,
     r)
     rewrite/cloud/src/functions/admi
     nApi/actions/orders.ts-235-}
     rewrite/cloud/src/functions/admi
     nApi/actions/orders.ts-236-
     rewrite/cloud/src/functions/admi
     nApi/actions/orders.ts-237-// 批
     量发货（P1·上量瓶颈）：多选订单
     一次发，逐单走 shipOne（串行·各
     自独立·一单失败不拖累其余），
     rewrite/cloud/src/functions/admi
     nApi/actions/orders.ts-238-//
     per-order 回报。company 可整批共
     用或逐单覆盖。电子面单取号/打印
     需快递 API 账号·诚实延后（不在此
     造·根因#8）。
     rewrite/cloud/src/functions/admi
     nApi/actions/orders.ts:239:expor
     t async function shipOrders({
     db, data, agentId }: Ctx) {
     rewrite/cloud/src/functions/admi
     nApi/actions/orders.ts-240-
     const items = Array.isArray(data
     && data.items) ? data.items : []
     rewrite/cloud/src/functions/admi
     nApi/actions/orders.ts-241-  if
     (!items.length) return
     reply(400, { ok: false, error:
     'BAD_ARGS' })
     rewrite/cloud/src/functions/admi
     nApi/actions/orders.ts-242-  if
     (items.length > 100) return
     reply(400, { ok: false, error:
     'TOO_MANY' }) // 单批上限·防滥用
     /超时
     rewrite/cloud/src/functions/admi
     nApi/actions/orders.ts-243-
     const batchCompany =
     String((data && data.company) ||
     '')
     rewrite/cloud/src/functions/admi
     nApi/actions/orders.ts-244-
     const results: any[] = []
     rewrite/cloud/src/functions/admi
     nApi/actions/orders.ts-245-  for
     (const it of items) {
     rewrite/cloud/src/functions/admi
     nApi/actions/orders.ts-246-
     const id = String((it && it.id)
     || '')
     rewrite/cloud/src/functions/admi
     nApi/actions/orders.ts-247-
     const r = await shipOne(db, id,
     (it && it.company) ||
     batchCompany, it &&
     it.trackingNo, agentId ||
     'admin')
     rewrite/cloud/src/functions/admi
     nApi/actions/orders.ts-248-
     results.push({ id, ...r })
     rewrite/cloud/src/functions/admi
     nApi/actions/orders.ts-249-  }
     rewrite/cloud/src/functions/admi
     nApi/actions/orders.ts-250-
     const okCount =
     results.filter((r) =>
     r.ok).length
     rewrite/cloud/src/functions/admi
     nApi/actions/orders.ts-251-
     return reply(200, { ok: true,
     okCount, failCount:
     results.length - okCount,
     results })
     rewrite/cloud/src/functions/admi
     nApi/actions/orders.ts-252-}
     rewrite/cloud/src/functions/admi
     nApi/actions/orders.ts-253-
     rewrite/cloud/src/functions/admi
     nApi/actions/orders.ts-254-// 金
     额异常单人工复核解除
     （feeMismatch 单禁发货，核实流水
     后在此解除）
     rewrite/cloud/src/functions/admi
     nApi/actions/orders.ts-255-expor
     t async function
     clearFeeMismatch({ db, data }:
     Ctx) {
     rewrite/cloud/src/functions/admi
     nApi/actions/orders.ts-256-
     const id = String(data.id || '')
     rewrite/cloud/src/functions/admi
     nApi/actions/orders.ts-257-  if
     (!id) return reply(400, { ok:
     false, error: 'BAD_ARGS' })
     rewrite/cloud/src/functions/admi
     nApi/actions/orders.ts-258-
     const got = await
     db.collection('orders').doc(id).
     get().catch(() => null)
     rewrite/cloud/src/functions/admi
     nApi/actions/orders.ts-259-  if
     (!got || !got.data) return
     reply(400, { ok: false, error:
     'NO_ORDER' })
     rewrite/cloud/src/functions/admi
     nApi/actions/orders.ts-260-  //
     payment_exception 是金额不符后的
     待处理终态，不能被旧的「解除
     feeMismatch」按钮
     rewrite/cloud/src/functions/admi
     nApi/actions/orders.ts-261-  //
     误清成看似正常；它必须走人工退款
     /补差后的明确处理流程。
     rewrite/cloud/src/functions/admi
     nApi/actions/orders.ts-262-  if
     (got.data.status ===
     'payment_exception') return
     reply(400, { ok: false, error:
     buildBadStatus(got.data.status)
     })
     rewrite/cloud/src/functions/admi
     nApi/actions/orders.ts-263-
     await
     db.collection('orders').doc(id).
     update({ data: { feeMismatch:
     false, feeMismatchClearedAt:
     Date.now() } })
     rewrite/cloud/src/functions/admi
     nApi/actions/orders.ts-264-
     return reply(200, { ok: true })
     rewrite/cloud/src/functions/admi
     nApi/actions/orders.ts-265-}

 ● Used Grep (export async function
 closeExpiredOrders|export const clo...)
 · 1 match

 rewrite/cloud/src/functions/timers/close
 ExpiredOrders.ts
     rewrite/cloud/src/functions/time
     rs/closeExpiredOrders.ts

 ● 我已完成对关键改动的独立审阅。下面按严
   重程度从高到低输出结构化审查意见。

   ──────────────────────────────────────

   审查结论：不通过（共 5 条：严重 2 / 中
   等 2 / 轻微 1）

   ──────────────────────────────────────

   1. 严重：关单后金额不符路径存在库存泄
   漏竞态

   • 位置
     ：rewrite/cloud/src/functions/callba
     cks/payCallback.ts:75-84
   • 复现：
       1. 订单处于 pending 且已
          reserveStock；
       2. closeExpiredOrders 与用户支付成
          功回调几乎同时到达；
       3. 关单流程先把状态 pending→closed
           并成功 restoreStock（正常）；
       4. 但考虑另一种时序：payCallback
          先读到 initial = pending，随后
          transition(['pending'],
          payment_exception) 因并发关单而
          CAS 失败；
       5. 此时 payCallback 进入
          closed→payment_exception 分支，
          该分支只改状态，不调用
          restoreStock。
   • 证据：
       • pending→payment_exception 路径显
         式 await
         restoreStock(p.doc.reserved)（第
         50-51 行）；
       • closed→payment_exception 分支仅
         做 transition(...) 与告警，无任
         何库存操作（第 75-84 行）；
       • closeExpiredOrders 是先
         transition pending→closed、再
         restoreStock，两者非原子。若
         payCallback 在 restoreStock 尚未
         执行或失败时读到 closed 并进入异
         常态，库存将永远被该异常单持有，
         既不发商品也不释放。
   • 影响：支付异常单在特定并发时造成库存
     虚锁，可发展为热销 SKU 长期无货可卖
     ，且异常单本身无自动回补机制。
   • 置信度：高

   ──────────────────────────────────────

   2. 严重：shipOne 发货闸依赖
   feeMismatch 标志而非状态
   ，payment_exception 存在绕过发货的理论
   路径

   • 位置
     ：rewrite/cloud/src/functions/adminA
     pi/actions/orders.ts:113-117
   • 复现：
       • shipOne 先判断 cur !== 'paid' &&
         cur !== 'shipped'，再判断
         got.data.feeMismatch === true 才
         拦截；
       • payment_exception 不是
         paid/shipped，因此第一闸已拒绝。
         但如果未来出现：
           1. 某条新路径把
              payment_exception 误流转到
              paid 而未清 feeMismatch；或
           2. 管理员/脚本直接改库把
              status 写成 paid 但保留
              feeMismatch=false；
       • 则 shipOne 会放行发货。
   • 证据：
       • 当前代码：if (cur !== 'paid' &&
         cur !== 'shipped') return ... 后
         才是 if (got.data.feeMismatch)
         return FEE_MISMATCH_HOLD；
       • payment_exception 在
         shared/order.ts 已被声明为终态，
         但 shipOne 的"金额异常"拦截仍只
         依赖 feeMismatch 派生字段，未对
         payment_exception 状态做显式拒绝
         ；
       • clearFeeMismatch 已显式拒绝
         payment_exception，说明开发者意
         识到该状态不应被"解除
         feeMismatch"操作，但发货闸没有对
         称加固。
   • 影响：一旦状态/脏数据异常
     ，payment_exception 单可能被发货，导
     致"钱没对清货已发"的资损。
   • 置信度：中（当前主路径不会触发，但
     robustness 不足）

   ──────────────────────────────────────

   3. 中等：recordPaidFee 缺乏金额上界/下
   界与审计外约束，补录错误可直接扩大退款
   额

   • 位置
     ：rewrite/cloud/src/functions/adminA
     pi/actions/refunds.ts:178-215
   • 复现：
       1. 管理员在 Orders.vue 点击"补录实
          付"，输入任意正整数分（如把少付
          99 元补录成 9999 元）；
       2. recordPaidFee 只校验
          Number.isInteger(paidFee) &&
          paidFee > 0，不校验 paidFee <=
          expectedFee 或 paidFee 与微信流
          水标识的绑定；
       3. 补录成功后，该单即可按补录金额
          走 overrideRefund 退款。
   • 证据：
       • recordPaidFee 服务端校验：if
         (!id ||
         !Number.isInteger(paidFee) ||
         paidFee <= 0)；
       • 前端 Orders.vue 仅校验
         Number.isFinite(yuan) &&
         Number.isInteger(fen) && fen >
         0；
       • 无任何与 expectedFee 或
         transactionId 的交叉校验，也没有
         "补录金额不能超过应付/实付流水"
         的硬限制。
   • 影响：高权限管理员误操作或账号被盗用
     时，可能把退款分母放大，导致超额退款
     。paidFeePrev 只能事后追溯，不能事前
     阻止。
   • 置信度：高

   ──────────────────────────────────────

   4. 中等：payCallback 中 initial 读与后
   续 p.doc 读可能不一致，导致 mismatch
   计算基于过期快照

   • 位置
     ：rewrite/cloud/src/functions/callba
     cks/payCallback.ts:43-75
   • 复现：
       1. payCallback 第 43 行先 get() 得
          到 initial 并计算 expectedFee
          与 mismatch；
       2. 随后 transition 内部会再次读取
          当前文档做 CAS；
       3. 如果在这两次读取之间订单金额被
          其他流程修改（理论上订单创建后
          金额不应改，但无法从本次 diff
          中确认全局约束），则 mismatch
          判断与真正写入的
          expectedFee/paidFee 可能基于不
          同版本。
   • 证据：
       • const initial = await
         getDb().collection(...).doc(id).
         get() 在 transition 之外；
       • transition 内部也有自己的
         .doc(id).get()（见
         transition.ts:25-31）；
       • 两次读取之间无锁/无事务，在极端
         并发下可能读到不同 amount。
   • 影响：低概率导致异常单/正常单判断依
     据与写入记录不一致，但金额字段在业务
     上通常是 immutable，所以实际风险有限
     。
   • 置信度：低

   ──────────────────────────────────────

   5. 轻微：applyRefund 客户端自助退款未
   覆盖 payment_exception，但客服/小程序
   端未给出明确引导

   • 位置
     ：rewrite/cloud/src/functions/app/ac
     tions/orders.ts:416
   • 复现：
       • 客户端 applyRefund 仅允许
         ['paid', 'shipped',
         'done']，payment_exception 被
         buildBadStatus 拒绝；
       • 这是设计决策（注释明确"客户自助
         面 applyRefund 不扩"），但小程序
         order.ts 的 BANNER 仅提示"请联系
         客服处理退款"，未提供一键转客服/
         工单入口，运营依赖用户主动联系。
   • 证据：
       • applyRefund 状态白名单：if
         (!['paid', 'shipped',
         'done'].includes(order.status))
         return err(...)；
       • order.ts
         BANNER：payment_exception: {
         head: '支付异常，待人工处理',
         sub: '...请联系客服处理退款' }。
   • 影响：不是安全漏洞，但可能增加客服人
     工成本；属于产品/体验层面，按审查纪
     律记为轻微。
   • 置信度：高

   ──────────────────────────────────────

   总体评价

   本次改动在金额异常态引入、退款分母切换
   、巡检 fail-closed、状态标签穷举等方面
   方向正确，测试覆盖也较完整。但
   closed→payment_exception 路径的库存处
   理 与 发货闸对 payment_exception 状态
   的显式拦截 存在可导致生产资损或库存泄
   漏的缺陷，建议修复后再合并。
   recordPaidFee 建议补充分录金额上界校验
   （如 paidFee <= expectedFee * (1 + 合
   理阈值) 或至少与 expectedFee 同级审计
   校验），以降低人工误操作风险。

 ✨ 2

  🌓
 ────────────────────────────────────────
   ❯ 请立即输出你目前已形成的全部审查意…
   ❯ 停止思考。现在把你已形成的全部审查…
   ↑ to edit · ctrl-s to steer immediate…
 ╭──────────────────────────────────────╮
 │ >                                    │
 ╰──────────────────────────────────────╯
 K2.7 Coding thinking  ~/luckyducky-fabl…
                context: 36% (91.6k/256k)