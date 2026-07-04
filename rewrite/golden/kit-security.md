# kit 横切原语与安全域 · 黄金用例（行为断言基准）

> 提炼自旧线 tests/（2026-07-04·M0）。本域是 13 病根教训的核心锁：状态机/身份闸/回调防伪/频控/分页/审计/金额分。每条为栈无关行为断言 + 源文件（根目录 `tests/cloud/`）；绑实现细节的剥离见文末清单。

## A. 状态机原子流转与幂等

- 当前态落在允许的 from 集合内 → 翻到目标态并回报「已流转」，同时把 patch 落到单据上。 — `kit/transition.test.js`
- 当前态不在 from 集合 → 原地不动、回报「未流转」；绝不跳级、不倒退。 — `kit/transition.test.js`
- 目标单据不存在 → 视为「未流转」，不新建。 — `kit/transition.test.js`
- patch 允许是函数 → 回调拿到「流转前」的单据快照，可据旧值算出要写入的新值。 — `kit/transition.test.js`
- 重复流转同一单据 → 第二次是空操作，不覆盖第一次已写入的值（幂等）。 — `kit/transition.test.js`

## B. 库存/流水账门（原子·幂等·不为负）

- 一次出入库同时改余额并写一条流水，流水按「单据类型+单据号+料号」确定性成键（同源单据的同一料号恒对应唯一流水条目）。 — `kit/scmStock.test.js`
- 幂等：同一单据重放不双记账——第二次一行都不再应用，余额不变、流水仍只一条。 — `kit/scmStock.test.js`
- fail-closed 入参：非整数/零数量、空料号、缺单据号一律拒，余额和流水分毫不动。 — `kit/scmStock.test.js`
- 余额永不为负：扣超库存被拒，流水零残留。 — `kit/scmStock.test.js`
- 全有或全无：一张多行单据里后行失败，前面已应用的行整体回滚（余额复原、流水删净）。 — `kit/scmStock.test.js`
- 料号主档不存在 → 拒，绝不静默自动建档。 — `kit/scmStock.test.js`
- 成品行只记流水、不动原料主档（成品账与原料账分账）。 — `kit/scmStock.test.js`
- 新建料号主档库存初始化为 0；之后编辑主档字段（如改名）永不改动库存余额。 — `kit/scmStock.test.js`
- 计量单位建档即锁死，事后改单位被拒（防混单位记账）。 — `kit/scmStock.test.js`
- 主档列表与流水查询都是有界的（流水可按料号过滤，封顶上限条数）。 — `kit/scmStock.test.js`

## C. fail-closed 身份闸（用户态入口 + 管理端会话）

- 用户态函数无登录身份 → 直接拒，fail-closed，绝不默认放行。 — `kit/gate.test.js`
- 有登录身份 → handler 带着调用者身份（及其数据库/入参上下文）执行。 — `kit/gate.test.js`
- 登录成功签发一枚高熵会话令牌；库里只存令牌哈希，明文令牌绝不落盘。 — `adminSession.test.js`
- 会话令牌可当后续请求凭据，解析回签发它的账号身份，且仍受 RBAC 约束（令牌 ≠ 提权）。 — `adminSession.test.js`
- 过期令牌 → 拒，fail-closed。 — `adminSession.test.js`
- 账号被停用 → 其存活令牌立即失效，不等到过期。 — `adminSession.test.js`
- 多设备会话并存，互不踢下线。 — `adminSession.test.js`
- 会话列表有界：超容量时剪掉最旧的一枚（最旧令牌随即失效，防会话无界膨胀）。 — `adminSession.test.js`
- 明文口令仍可直接当凭据用（向后兼容已部署的旧前端）。 — `adminSession.test.js`

## D. 权限闸 · 默认拒 · 最小权（坐席 RBAC）

- 最小权定义：外包坐席只有「处理分配给自己的会话」这一项能力，明确不含读客户 360（堵批量导出洞）；超管为通配全权。 — `adminRbac.test.js`
- 超管对所有钱/状态类 action（发货/退款/改库存/上架/看板）都过闸。 — `adminRbac.test.js`
- 外包直接调客户 360 读取/检索类 action → 拒（批量读客户洞已闭合）。 — `adminRbac.test.js`
- 外包对坐席台 action 过能力闸，但会话归属在 handler 内二次校验（过闸 ≠ 可越权处理他人会话）。 — `adminRbac.test.js`
- 默认拒：未登记授权的钱/状态/管理 action 对外包一律拒。 — `adminRbac.test.js`
- 被停用的账号在口令闸即被拒，早于能力闸/handler。 — `adminRbac.test.js`
- 向后兼容：旧超管账号文档无角色字段（仅通配能力）仍判为全权。 — `adminRbac.test.js`
- 错误口令在多账号查找下仍查不命中 → 拒，不误放行。 — `adminRbac.test.js`

## E. 回调防伪（服务端调用判定 + 回调框架）

- 「服务端调用」的判定标准是「没有用户身份」——工作流服务端调用（无用户身份）判为真。 — `kit/gate.test.js`
- 带用户身份的调用（客户端伪造）判为假——客户端永远伪装不成服务端调用。 — `kit/gate.test.js`
- 回调请求若带着用户身份 → 判为伪造：不触发业务回调，但仍照常向调用方返回 ack（不给探测信号）。 — `kit/notify.test.js`
- 回调解析不出单号（缺引用 id）→ 空操作、返回 ack，不触发业务回调。 — `kit/notify.test.js`
- 合法回调 → 带解析出的单号触发业务回调，并始终向调用方返回 ack。 — `kit/notify.test.js`

## F. 频控与锁定（认证防爆破 + 用户限频 + 并发正确性）

- 连续 N 次错误口令后锁定：锁定窗口内即便递上正确口令也拒。 — `adminThrottle.test.js`
- 一次成功登录清零失败计数（窗口重置）。 — `adminThrottle.test.js`
- 认证频控按 IP 隔离：一个 IP 被锁不影响另一个。 — `adminThrottle.test.js`
- 不止登录——所有管理端 action 都受同一认证频控约束。 — `adminThrottle.test.js`
- 全局失败计数兜底：攻击者轮换伪造来源 IP 让 per-IP 永不达阈，跨所有 IP 累计仍触顶全局锁。 — `adminThrottle.test.js`
- 全局阈值高于 per-IP 阈值：单 IP 正常触发的是 per-IP 锁，不会误锁到别的 IP。 — `adminThrottle.test.js`
- 用户端写函数按用户身份限频，超阈拒。 — `userRateLimit.test.js`
- 用户频控按身份隔离：一个用户被限不影响另一个。 — `userRateLimit.test.js`
- 突发并发计数不丢更新：N 个并发命中恰好放行 max 个、计数精确等于 N（并发下限额不漏）。 — `throttleConcurrency.test.js`
- 突发并发的失败尝试仍触发锁定（爆破不能靠并发钻缝）。 — `throttleConcurrency.test.js`
- 限频计数与锁定计数即便共用同一条存储记录也彼此独立：任一系列在自己窗口字段缺失时按「首次」正确初始化，绝不踩坏另一系列的计数/窗口。 — `throttleDefenseBranch.test.js`

## G. 分页协议（游标式 · limit 钳制 · 属主隔离）

- 无参即首页取默认每页条数；每页条数钳在 [1,200]，非法值回默认；游标透传，空串游标视同无游标。 — `kit/paging.test.js`
- 首页按排序键降序取 limit 条，多查一条判定「还有更多」，下一页游标 = 本页末条的排序值。 — `kit/paging.test.js`
- 拿上一页返回的游标取下一页：只返回游标之后的剩余记录，取空时判「无更多」、下一页游标为空。 — `kit/paging.test.js`
- 查询按属主过滤：只返回本人记录、绝不含他人（无参兼容旧前端时亦然）。 — `kit/paging.test.js`
- 前端把每页条数传成任意标量（负数/超大/小数/数字串/垃圾串/null/布尔/缺失），每页条数永远落在 [1,200]。 — `propertyInvariants.test.js`
- 空游标（''/null/undefined）一律归一成 null，下游「首页」口径一致。 — `propertyInvariants.test.js`

## H. 审计留痕与可观测 fail-soft

- 只对动钱/改状态的操作留审计痕（发货/退款/改库存/上架/改配置/建批次等）。 — `kit/audit.test.js`
- 只读/上传/认证类操作跳过审计（免噪声）。 — `kit/audit.test.js`
- 每条审计留痕记操作/成败/操作者，且剥除凭证类敏感字段（webhook 密钥、口令等），非敏感字段保留。 — `kit/audit.test.js`
- 传入真实操作者身份则如实记录（多账号可追溯「谁改了谁」，不糊成单一管理员）；未传操作者时回退默认（fail-soft 向后兼容）。 — `kit/audit.test.js`
- 审计写入 fail-soft：出错绝不向上抛，不反噬业务主流程。 — `kit/audit.test.js`
- 合法告警 webhook → 告警被投递，载荷带上出问题的函数名/错误码/严重级。 — `kit/botpush.test.js`
- 告警只发往形态合法的目标 webhook；非法/非白名单 URL 直接拒、一个网络请求都不发（防 SSRF/凭证乱发）。 — `kit/botpush.test.js`
- 告警投递 fail-soft：投递抛异常时返回失败、绝不向上抛（可观测性不反噬主流程）。 — `kit/botpush.test.js`
- provider 返回非零错误码 → 判为失败上报，不把 provider 报错静默当成功。 — `kit/botpush.test.js`

## I. 金额分整数（钱不浮点）

- 整分金额经「分 → 元 → 分」往返恒回原值（无浮点漂移）。 — `propertyInvariants.test.js`
- 两位小数元价转分恒为整数分（库里永远是整分）。 — `propertyInvariants.test.js`
- 分闸是脏数据闸：整数放行、非整数当场抛错（绝不悄悄入库）。 — `propertyInvariants.test.js`
- 金额转换单调不减（钱越多分越多，不把大小关系搞反）。 — `propertyInvariants.test.js`

## J. 输入边界 · 上传路径消毒 · 价格校验（不信前端）

- 客户端传来的对象键片段先消毒：`../`、斜杠等路径字符剥净，越不出既定存储前缀（防路径穿越）。 — `adminUploadPath.test.js`
- 全非法的片段回退到安全默认段（不产生空段路径）；不同媒体类型路由到对应前缀。 — `adminUploadPath.test.js`
- 攻击类价格输入（≤0 / Infinity / NaN）一律拒（曾穿透下单）。 — `propertyInvariants.test.js`
- 超上限价一律拒；合法区间 (0, 上限] 一律放行。 — `propertyInvariants.test.js`

## 剥离清单（绑实现细节 → 行为本质已保留）

- 结果信封形状（ok/err 结构）→ 属线格约定；「统一成功/失败信封」内含于各闸断言。（2 条整体剔除）
- 具体阈值/容量常量（5 次锁定、60 次/分、[1,200]、全局阈值、会话上限 8）→ 只锁「有阈即锁/有界/剪最旧」行为，不锁数字。
- 确定性流水键格式、成品前缀 → 只锁「同源恒唯一、幂等去重、分账」。
- 令牌编码（hex64/sha256）与 session 字段名 → 只锁「高熵令牌、明文不落盘、只存哈希」。
- 告警载荷格式/错误码串/中文标签 → 只锁「载荷带来源/代码/严重级、provider 错误不静默」。
- 错误常量串（TOO_MANY_ATTEMPTS/FORBIDDEN 等）→ 锁「拒/回退」语义不锁码字。
- RBAC 能力表常量结构 → 提炼为「最小权/默认拒」策略行为。
- 频控字段级断言（hits/fails/windowStart 不互踩）→ 合并为「两系列计数彼此独立」。

## 覆盖清点

**读 15 文件全收**：kit 原语 7（transition/gate/notify/paging/audit/botpush/scmStock）+ 安全横切 8（adminThrottle/adminSession/adminRbac/adminUploadPath/userRateLimit/throttleConcurrency/throttleDefenseBranch/propertyInvariants）。
**核对**：76 源用例 = 72 条黄金 + 2 整体剔除（信封形状）+ 2 合并抵消。
**域边界说明**：kit/validate（`str`）无独立云测试——其行为分散在本册 J/B/G 节，无遗漏独立用例；`packages/miniapp/tests/validate.test.js` 属前端域另册；seedGates 属 seed/catalog 功能域（底层原语行为已由本册 C/E 节覆盖）。
