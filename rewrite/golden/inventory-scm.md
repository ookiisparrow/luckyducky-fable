# 实物库存与进销存（SCM）域 · 黄金用例（行为断言基准）

> 提炼自旧线 tests/（2026-07-04·M0）。进销存经用户确认**尚未投产**，但其行为规格系拍板需求 R31，完整保留。每条为栈无关行为断言 + 源文件；实现细节（幂等键格式/错误码/响应形状/守卫名/测试桩）已剔除，行为本质保留（见文末剔除清单）。

## A. 下单即预留与乐观 CAS 防超卖

- 下单时即从库存扣减预留量（下单预留，不等到支付），扣减成功的量记入订单的预留清单。 — `tests/cloud/inventory.test.js`
- 库存扣减走乐观 CAS：最后一件被两笔并发预留争抢时，只有一笔成功、另一笔失败，绝不两笔都成功（防超卖的根本保证）。 — `tests/cloud/inventory.test.js`
- 商品无库存文档（未建库存记录）＝不限量，预留一律放行、不阻拦下单（不限量商品安全迁移）。 — `tests/cloud/inventory.test.js`
- 多条目预留中任一条目库存不足，则整单预留失败、已扣的其他条目全部回滚复原（不锁死库存），并指明是哪个商品短缺。 — `tests/cloud/inventory.test.js`
- 管理端直接写库存（设绝对值）走版本校验：保存携带的期望版本与库存现值版本不符（期间有并发预留推进过）→ 冲突拒写、不覆盖并发预留扣减的结果（防旧页面覆盖、防超卖窗口）。 — `tests/cloud/inventory.test.js`
- 管理端写库存版本相符时落库生效；对全新/首设的库存（无并发可踩）无条件写入。 — `tests/cloud/inventory.test.js`

## B. 售罄整单拒

- 下单时库存为 0 → 拒单并提示售罄，不建单。 — `tests/cloud/inventory.test.js`
- 下单命中已停售商品 → 整单拒、不建单、不扣任何库存；停售品夹带在多条目里也整单拒（不放过夹带）。 — `tests/cloud/createOrder.test.js`
- 支付回调复活已关闭订单前必须重抢库存：库存已被别人买走、重抢失败 → 不翻已支付、不扣穿库存，转入待退款态（钱已收、人工退款），坚持宁缺勿超卖。 — `tests/cloud/payCallback.test.js`
- 预留重试竞态缓冲：首次预留失败若恰逢「关单回补尚未落定」的瞬时窗，重试即成功、不误判售罄；真售罄则重试到上限仍失败，上层走退款、不超卖；首次即成功则不重试（常态零额外开销）。 — `tests/cloud/payCallback.test.js`

## C. 回补规则（超时 / 退款 / 复活）

- 订单超时关单时把该单预留量加回库存（回补），且回补幂等——再次跑关单不重复回补。 — `tests/cloud/inventory.test.js`
- 回补原语把指定量加回库存（供超时/退款场景复用）。 — `tests/cloud/inventory.test.js`
- 退款成功且订单未发货（已支付态）→ 回补退款条目对应的库存数量。 — `tests/cloud/refundCallback.test.js`
- 退款成功但订单已发货 → 退款照常完成，但实物已出库，**不**回补库存（防幻影库存超卖）。 — `tests/cloud/refundCallback.test.js`
- 支付回调复活已关闭订单：库存仍在→重抢成功、复活已支付并扣回库存；预留为空（不限量/无实物）→ 直接复活已支付、不涉及库存。 — `tests/cloud/payCallback.test.js`

## D. 原料账唯一入出账口（门1）

- 所有原料出入库都经唯一入出账口：改余额的同时写一条流水，流水带确定性幂等键。 — `tests/cloud/kit/scmStock.test.js`
- 同一单据重放不双记账：撞上已存在的幂等键即视为已应用、跳过，余额与流水都不再变。 — `tests/cloud/kit/scmStock.test.js`
- 入参 fail-closed：非整数/零变动量、空料号、缺单据号一律拒，分毫不动账。 — `tests/cloud/kit/scmStock.test.js`
- 余额不为负：扣超库存直接拒，流水零残留。 — `tests/cloud/kit/scmStock.test.js`
- 多行「全有或全无」：一行失败则已应用的其他行全部回滚（余额复原、流水删净）。 — `tests/cloud/kit/scmStock.test.js`
- 料号主档不存在则拒（不静默建档）。 — `tests/cloud/kit/scmStock.test.js`
- 成品行只在流水留痕、不改原料主档余额（成品账另在实物库存账本）。 — `tests/cloud/kit/scmStock.test.js`
- 查账按料号过滤、按上限封顶（有界读）。 — `tests/cloud/kit/scmStock.test.js`

## E. 物料主档与计量单位

- 计量单位只收「件|克」两种，其他一律拒。 — `tests/cloud/scmMaterials.test.js`、`tests/cloud/kit/scmStock.test.js`
- 计量单位建档即锁死：已建档料号再改单位一律拒，防混账。 — `tests/cloud/scmMaterials.test.js`、`tests/cloud/kit/scmStock.test.js`
- 毛线料号按命名契约推导（颜色×档位×形态）；带结形态只允许最大团（L 档），非 L 档带结拒（用户拍板）。 — `tests/cloud/scmMaterials.test.js`
- 专属件料号挂产品 ID（包装、卡片各有前缀），缺产品 ID 拒。 — `tests/cloud/scmMaterials.test.js`
- 辅料 slug 须小写合法，脏 slug 拒（防脏主键）。 — `tests/cloud/scmMaterials.test.js`
- 建档初始化库存为 0；后续更新主档字段（如改名）不动库存余额。 — `tests/cloud/kit/scmStock.test.js`
- 库存调整必留原因；调整量必须为非零整数（克/件整数纪律）。 — `tests/cloud/scmMaterials.test.js`
- 库存调整同一调整 ID 重放幂等（不双记账），流水记录操作者与原因。 — `tests/cloud/scmMaterials.test.js`
- 库存调整扣超余额拒（余额不为负）。 — `tests/cloud/scmMaterials.test.js`
- 供应商类型只收「厂家|织女」，可建/改/列，改不存在的供应商拒。 — `tests/cloud/scmMaterials.test.js`

## F. 采购入库幂等（车道 A）

- 采购单校验 fail-closed：数量须正整数、单价须非负整数分，违反即拒、分毫不入库。 — `tests/cloud/scmPurchase.test.js`
- 采购单拒空行、拒不在主档的料号、拒同料重复行（重复行会撞入库幂等键）。 — `tests/cloud/scmPurchase.test.js`
- 采购单供应商必须存在且是厂家；织女或不存在的供应商拒（采购只向厂家）。 — `tests/cloud/scmPurchase.test.js`
- 采购单总价服务端按 Σ数量×单价 自算，前端传的假总价一律无视。 — `tests/cloud/scmPurchase.test.js`
- 采购单只有草稿态可改；已下单后改拒，改不存在的单报不存在。 — `tests/cloud/scmPurchase.test.js`
- 采购状态机正向流转 草稿→已下单→已收货；收货首次流转才把各行数量入库（绑门1）。 — `tests/cloud/scmPurchase.test.js`
- 收货幂等：重复收货不双入库，流水每料号仍只一条。 — `tests/cloud/scmPurchase.test.js`
- 非法流转拒：草稿直接收货拒（未下单不可能到货），账分毫不动。 — `tests/cloud/scmPurchase.test.js`
- 已收货的单不能取消（入库后走调整单）；草稿/已下单可取消；取消不存在的单报不存在。 — `tests/cloud/scmPurchase.test.js`
- 采购列表按创建时间倒序、可按状态过滤、有界读。 — `tests/cloud/scmPurchase.test.js`

## G. 外协发收结算与损耗（车道 B）

- 外协单的织女必须存在且是织女档，厂家/不存在的一律拒。 — `tests/cloud/scmOutwork.test.js`
- 外协发料行只收最大团原团，中团/带结/未建档/非正整数一律拒。 — `tests/cloud/scmOutwork.test.js`
- 计件单价须非负整数分，浮点/负数/字符串（不隐式转）一律拒（金额分纪律）。 — `tests/cloud/scmOutwork.test.js`
- 外协单只有草稿态可改，发料后改行拒；改不存在的单报不存在。 — `tests/cloud/scmOutwork.test.js`
- 发料首次流转（草稿→已发）绑出库扣账，流水带确定性键与操作者。 — `tests/cloud/scmOutwork.test.js`
- 发料库存不足则整单拒，状态补偿回滚回草稿、足量行也不动账（全有或全无），补货后可重发。 — `tests/cloud/scmOutwork.test.js`
- 收货入的是同色带结团；收货数量与状态同一次条件更新一起定格：应付＝收货数×计件单价、损耗＝发出数−收回数（不可分两步）。 — `tests/cloud/scmOutwork.test.js`
- 收货重放幂等：重复收货不双入库、定格金额不变。 — `tests/cloud/scmOutwork.test.js`
- 收货 fail-closed：收比发多拒、非发料颜色拒、非带结料号拒、带结料号未建档拒（不静默建档、提示先建档），拒时状态不动。 — `tests/cloud/scmOutwork.test.js`
- 未发料先收货拒；收货行为空/浮点拒。 — `tests/cloud/scmOutwork.test.js`
- 结算只允许 已收货→已结算 并记结算时间；未收货结算/重复结算拒。 — `tests/cloud/scmOutwork.test.js`
- 外协单只有草稿可取消，已发料后取消拒（异常走物料页调整单）。 — `tests/cloud/scmOutwork.test.js`
- 外协列表按状态/织女过滤、按创建时间倒序、非法状态拒、有界读。 — `tests/cloud/scmOutwork.test.js`

## H. 配方解析与快照冻结（门3 + 组装配方管理）

- 配方解析（模板×差异位×套数）纯函数：展开共用料/三色毛线/专属件，各料数量＝每套用量×套数。 — `tests/cloud/scmBom.test.js`
- 配方解析同料号合并累加（共用料与专属件撞料号时不重复出行）。 — `tests/cloud/scmBom.test.js`
- 配方解析 fail-closed：套数非正整数、模板坏行、带结非 L 档、差异位缺色 一律拒。 — `tests/cloud/scmBom.test.js`
- 毛线料号命名契约与建档推导同源（颜色×档位×形态）。 — `tests/cloud/scmBom.test.js`
- 配方模板/差异位管理走白名单+契约校验：带结槽只允许 L 档、每套用量非正整数拒；差异位三色与专属件必填，保存后可读回。 — `tests/cloud/scmAssembly.test.js`
- 组装执行时把当时的配方（模板+差异位）快照冻结进单据；之后改模板，历史组装单的快照与已耗用清单**不追新**（同单快照原则）。 — `tests/cloud/scmAssembly.test.js`

## I. 组装扣料入成品（门3→门1→门4）

- 组装执行＝解析配方→按配方各料出账扣原料→入成品（成品库存无文档则建、有则累加）→留组装入库痕，单据存快照+用料清单+操作者。 — `tests/cloud/scmAssembly.test.js`
- 组装幂等：同组装 ID 重放拒，不双扣、不双入。 — `tests/cloud/scmAssembly.test.js`
- 组装料不足→拒并指出短缺料号，全单回滚（原料/成品/单据/流水全不动，占用撤回可重试），坚持宁不动账勿错账。 — `tests/cloud/scmAssembly.test.js`
- 组装入成品：已有库存则累加；不限量成品（库存为空）保持不限量、不翻成限量。 — `tests/cloud/scmAssembly.test.js`
- 组装 fail-closed：无差异位/无模板/套数非正整数一律拒。 — `tests/cloud/scmAssembly.test.js`
- 组装预演只读：用料需求×库存对照给出短缺，不动账。 — `tests/cloud/scmAssembly.test.js`
- 组装列表按时间倒序、有界读。 — `tests/cloud/scmAssembly.test.js`

## J. 发货核销流水幂等（车道 D）

- 发货首次 已支付→已发货 流转逐行落发货核销流水；成品行只留痕、不动原料账、也不动成品预留账（成品扣账已在下单预留完成）。 — `tests/cloud/scmShipLedger.test.js`
- 改单号/重试发货不双记账，每行流水仍只一条（幂等）。 — `tests/cloud/scmShipLedger.test.js`
- 批量发货与单笔发货共用同一发货逻辑，同样逐行留痕。 — `tests/cloud/scmShipLedger.test.js`
- 旧单无明细/行残缺照常发货、不落假流水、不崩。 — `tests/cloud/scmShipLedger.test.js`
- 发货核销流水记录操作者身份（谁发的可溯源，不糊成通用 admin）。 — `tests/cloud/scmShipLedger.test.js`

## K. 备货计算器与产销统计（只读·门3 共用）

- 备货计算器（只读）：目标套数×配方对比库存算外协缺口——带结不外购，缺口＝应送同色 L 原团数，并把派生的原团需求叠进采购口径。 — `tests/cloud/scmPlanner.test.js`
- 备货采购缺口按供应商分列，够扣的料不出行，未建档料点名并进「未挂供应商」组按需全采；带结料号绝不出现在采购缺口（外协产出·不外购）。 — `tests/cloud/scmPlanner.test.js`
- 备货全部够 → 外协缺口/采购缺口/缺料 三空，不造缺口。 — `tests/cloud/scmPlanner.test.js`
- 备货 fail-closed：坏目标、无差异位、无模板 一律拒。 — `tests/cloud/scmPlanner.test.js`
- 产销统计（只读）按 产品+规格 分桶求和：打包（组装入库）累计、发货累计（负转正），同产品多次求和、不同产品互不串账、非成品流水不混入、无流水返回两空数组。 — `tests/cloud/scmPlanner.test.js`

## L. 库存有界读

- 库存 SKU 超 100 条不被静默截断，分页取齐全量返回。 — `tests/cloud/adminInventoryBounded.test.js`
- 触扫描封顶时如实报「已截断」，不假装全量。 — `tests/cloud/adminInventoryBounded.test.js`
- 按精确料号读的路径不受分页影响；入参料号列表超长被封顶（防超长 in 查询、不炸）。 — `tests/cloud/adminInventoryBounded.test.js`

## M. 备货→开单一次性预填中转（前端 store）

- 备货计算器联动开采购/外协单的预填是一次性消费：取到原值后再取变空，避免回退到开单页时被陈旧缺口重复预填。 — `tests/admin/scmHandoff.test.js`
- 采购与外协的预填互不干扰；未设置过直接消费返回空、不影响两页正常进入。 — `tests/admin/scmHandoff.test.js`

## N. RBAC 默认拒（贯穿 SCM 各线）

- SCM 各线（物料/采购/外协/配方组装/备货计算/产销统计）的写与读 action 对外包账号默认拒（403）、仅超管过闸——未登记的 action 默认按最高写权限收口。 — `tests/cloud/scmMaterials.test.js` 等五文件

## 剔除清单（绑实现断言 → 行为本质已保留）

- 流水确定性 `_id` 字符串格式（`purchase_in:<单>:<料号>` 等）→ 「同单同料只一条流水、重放不双记账」已收入 D/F/G/I/J。
- 具体错误码 token（售罄/单位非法/非草稿/收超发 等）→ 「在该条件下拒绝」已按条件收录。
- 响应字段形状（moved/applied/entVer/conflict/truncated）→ 「首次生效/重放不再生效」「冲突不覆盖」「如实报截断」已收。
- CI 守卫名（order-reserves-stock 等）→ 流水线设施，非产品行为，整体剔除。
- 测试桩细节（control.seed/dump、100 条封顶注释）→ 「超 100 条不静默截断」已抽象收入 L。
- 库存文档主键拼接（`产品__规格`）→ 「成品按 产品+规格 建账/累加」已收入 A/I。

## 覆盖清点

**核心收录 11 文件**：inventory / kit/scmStock / scmMaterials / scmPurchase / scmBom / scmOutwork / scmAssembly / scmShipLedger / scmPlanner / adminInventoryBounded / admin/scmHandoff。
**跨域切片收录 3 文件**：payCallback（复活重抢/重试缓冲）、createOrder（停售拒单）、refundCallback（回补规则）——其余断言归钱链域。
**读过并明确排除 10 文件**（无实物库存行为，各归其域）：confirmEnter / confirmReceive / closeExpiredOrders / shipOrder / shipOrders / kit/audit / adminRbac / propertyInvariants / reconciliation 等。
**统计**：约 85 条永恒行为断言（A–N 十四节）；6 类实现绑定断言已转写；无静默丢弃。
