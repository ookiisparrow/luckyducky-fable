# 进销存 ERP（供应链）

> **这是什么**：本文件夹 = 「进销存 ERP」子项目的**活文档家**。用户 2026-07-02 从需求出发逐条拍板后确立本线；范围＝**进销存最小闭环**（采购/外协→原料账→按模板组装→成品账→发货核销），非全套 ERP（财务凭证/多仓/批次效期 明确不做·防过度工程）。
> 需求登记：`../需求清单.md` R31。**当前状态：建成上线·挂起按需**（终态见下）。施工蓝图已退役（2026-08-02 文档大清理批·仍准的两块并入本文·git 历史即归档）。

## 一句话

把「备货」从拍脑袋变成两本账一张模板：**采购/外协进原料账 → 按全局唯一配方模板打包（原料账−·成品账+）→ 订单发货核销留痕**。成品账/防超卖/RBAC/审计/后台骨架全复用现有，新建的只有「原料侧」。

## 需求定稿（用户 2026-07-02 会话逐条拍板·provenance=会话记录，勿再猜）

- **物料与计量**：每料号建档锁死计量方式（件 或 克·**一律正整数**）。毛线＝**颜色×量级（三档克重 大/中/小）×形态（原团/带结）** 按团数记账，**仅最大团有带结形态**；填充棉按克；其余（外包装/二维码卡片/钩针/记号扣/缝针/钥匙扣/玩偶眼睛）按件。外包装与卡片印刷随产品变＝每产品专属料号。
- **外协（管到发料领用·三档里最完整档）**：织女每人一档；发**最大团原团**（按色）→ 收**带结团**（同色同量级入库）→ 损耗=发−收可见 → 计件工钱应付（收回数×单价）→ 结算销账。
- **配方（BOM）**：所有产品构成几乎一致、数量重量完全相同 → **全局一张模板** + 每产品三个填空（三个量级各选颜色 + 专属包装料号 + 专属卡片料号）。最大团用带结、中/小团用原团（模板里标）。组装单存**模板快照**、不回读（历史单不追新）。
- **核销**：沿用「下单即扣成品库存防超卖」现有机制（不改钱链热路径）；发货动作核对实发=订单数并写流水留痕——「如实核销」靠流水可查兑现。
- **激活码交叉核对（可选后置）**：卡片入库数 ↔ 该产品激活码池 unused 数对账（印错/漏印可见·复用现有 qrcodes 线）。

## 料号命名契约（配方解析依赖·代码即真值 `rewrite/shared/src/scmKey.ts`）

毛线 `yarn:<color>:<L|M|S>:<raw|knotted>`（knotted 仅 L 档）；产品专属件 `pkg:<productId>` / `card:<productId>`；共用辅料语义名（`stuffing` 填充棉/`hook` 钩针/`marker` 记号扣/`needle` 缝针/`keyring` 钥匙扣/`eyes` 眼睛）。建档程序生成、不手拼。

## 业务动线与对账公式（配方解析单源 `rewrite/shared/src/scmBom.ts` `resolveBom`·纯函数）

```
采购单 received ──purchase_in──▶ 原料账（materials.stock）
最大团原团(按色) ──issued:outwork_issue──▶ 织女在制 ──delivered:outwork_receive──▶ 带结团入库 + payableFen 应付 ──▶ settled 销账
组装单（产品×N套） ──assembly_out（按 bomSnapshot 扣料）──▶ assembly_in ──▶ 成品账（inventory·现有）
订单下单即扣（现有防超卖·热路径不加写） ──▶ shipOrder 首次 shipped 流转落 ship 流水核销留痕
备货计算器（只读）：目标套数 × resolveBom → 对比库存 → 采购缺口（按供应商分列）+ 外协缺口
```

对账公式：原料侧 Σ流水 ⇄ `materials.stock`；成品侧 Σ(assembly_in/ship/adjust 流水) + orders 预留 ⇄ `inventory.stock`（下单预留**刻意不写**流水——钱链热路径不加写，orders 本身即那笔账的单据）。

## 终态（建成上线·挂起按需）

- **SCM 全线已在 `rewrite/` 线重建为生产源**：原料账单点 `rewrite/cloud/src/kit/scmStock.ts`（确定性流水幂等+CAS）· action 面 `actions/scmMaterials|scmPurchase|scmOutwork|scmBom|scmAssembly|scmPlanner|scmOverview.ts` · admin「供应链」组页面（含批量盘点模式）· 状态机声明 `rewrite/shared/src/scm.ts`（手改单源）· 守卫 `rw-scm-transitions-declared` / `rw-scm-ledger-idempotent` / `rw-scm-golden` 在册。
- **未闭环（靠人）**：SCM-Z 真单验收（一单真采购→入库→发料→收带结→打包→下单→发货，全链流水对得上才算通·根因#8）+ **期初盘点录入**（不录=账实必偏·工具已备）+ 模板数值/单价由用户在 admin 填。
- 建设过程账（旧线五车道 2026-07-02 全完工与新线迁建明细）见 git 历史。

## 指针（单源·不重抄）

- **需求正册**：`../需求清单.md` R31 · **接口/集合**：代码即真值（钥匙卡 `../系统事实.md`）
- **成品账现有实现（原料账的镜像先例）**：`rewrite/cloud/src/kit/inventory.ts`（守卫 `rw-scm-ledger-idempotent` + 黄金测试 `app-scm.test.ts`）
- **多 CC 并行机制**：已并入 `.claude/skills/workflow-fanout/SKILL.md` 模式C
