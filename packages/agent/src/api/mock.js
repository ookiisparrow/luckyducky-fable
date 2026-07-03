/**
 * 承面 C 坐席台 · mock 层（车道 B 对 mock 建·**全站唯一假数据源**）。
 *
 * 按 `@luckyducky/shared` 的 `csAgentDesk.ts` 契约 mock 10 个坐席 action + listKb 的响应，
 * 让全套 UI 先跑起来。**组件/页面绝不直接引本文件**——只经 api/agentApi.js 调用（单点接缝·守卫
 * agent-api-single-seam 焊之）；master 整合车道 A 真接口时，只改 agentApi.js 的路由、组件零改。
 *
 * 语义尽量贴真后端（根因#8「假样本别失真」）：
 *  - 会话状态机 pending→active→closed(+escalated)（shared/cs.spec.ts）；claim 绑 agentId（服务端从登录态取·
 *    不信前端传身份·§1.5 信任边界）；release 退回 pending；escalate 甩商户超管；close 触 CSAT。
 *  - getThread cursor 增量：只回 at > cursor 的新消息 + nextCursor（前端轮询合并·logic/thread.js）。
 *  - sendAgentMessage 出站落会话·回 errcode:0；客户随时间「续说」（脚本化入站·让轮询有真增量）。
 *  - listQueue 只回 pending（待接）·cursor/limit 分页（根因#7 bounded）。
 */

const OPEN_KF = 'wkMockOpenKfIdAAAAAAAAAAAAAAAAA' // 迁企业微信内 open_kfid 全程不变（此为 mock 占位）
const MIN_KEY = 6

const now = () => Date.now()
const sid = (ext) => `wxkf:${OPEN_KF}:${ext}` // 会话 _id = 确定性 wxkf:<openKfId>:<externalUserId>

// ── 登录态（mock 内部维护·claim/setAgentStatus 用·不由前端传身份·§1.5）─────────
let _agentId = 'agent_demo'
export function login(key) {
  if (!key || String(key).length < MIN_KEY) return { ok: false, error: 'KEY_TOO_SHORT' }
  // mock：任意 ≥6 位口令即视为一名外包坐席，权限＝外包最小权（§1 定稿·收窄后仅 agent:handle·同 ROLES.outsourced）。
  _agentId = 'agent_demo'
  // sessionToken 与真后端同形（深审 P1·前端一律只存令牌不存口令原文）
  return { ok: true, operator: '外包坐席·演示', caps: ['agent:handle'], sessionToken: 'mock-session-token' }
}
// 刷新页面后 agentApi 用 localStorage 恢复登录态时同步 mock 内部 agentId（保 claim 归属一致）。
export function resume(agentId) {
  if (agentId) _agentId = agentId
}

// ── 内存态 ────────────────────────────────────────────────────────────────
// 每个会话：csSession 文档字段 + conversations 消息 + 脚本化未来入站（afterMs 相对认领时刻）。
function seed() {
  const t0 = now()
  const min = 60_000
  return [
    {
      // ① 身份未桥接（openid=null）：360 侧栏应显「未建身份桥接」（真实存在的状态·根因#8）
      externalUserId: 'wmMockExtAAA_fengfeng',
      display: '微信用户_峰峰',
      openid: null,
      status: 'pending',
      createdAt: t0 - 4 * min,
      updatedAt: t0 - 4 * min,
      agentId: null,
      claimedAt: null,
      messages: [
        { direction: 'in', msgtype: 'text', text: '在吗？我买的材料包还没发货', at: t0 - 4 * min },
        { direction: 'in', msgtype: 'text', text: '订单号 LD20260701008', at: t0 - 4 * min + 3_000 },
      ],
      script: [
        { afterMs: 4_000, text: '麻烦帮我看下要几天到' },
        { afterMs: 12_000, text: '我这周末想开工，急用😥' },
      ],
      revealed: 0,
    },
    {
      // ② 已桥接（有 openid）：360 侧栏可拉全貌
      externalUserId: 'wmMockExtBBB_zhouzhou',
      display: '小棉鸭_周周',
      openid: 'oMockUser_zhouzhou',
      status: 'pending',
      createdAt: t0 - 2 * min,
      updatedAt: t0 - 2 * min,
      agentId: null,
      claimedAt: null,
      messages: [
        { direction: 'in', msgtype: 'text', text: '老师，这个第 3 步的枣形针我总是钩得松松垮垮的', at: t0 - 2 * min },
      ],
      script: [
        { afterMs: 5_000, text: '是不是我线拉太松了？' },
        { afterMs: 14_000, text: '[图片]' },
      ],
      revealed: 0,
    },
    {
      externalUserId: 'wmMockExtCCC_lili',
      display: '钩织新手_丽丽',
      openid: 'oMockUser_lili',
      status: 'pending',
      createdAt: t0 - 30_000,
      updatedAt: t0 - 30_000,
      agentId: null,
      claimedAt: null,
      messages: [{ direction: 'in', msgtype: 'text', text: '激活码提示已被使用是怎么回事呀', at: t0 - 30_000 }],
      script: [{ afterMs: 6_000, text: '我是刚扫的码，第一次用' }],
      revealed: 0,
    },
  ]
}

let SESSIONS = seed()

// mock 客户 360（openid → panels·形状严格贴 customer360 各 provider 的 data·admin 通用渲染器可直接吃）
const CUSTOMER360 = {
  oMockUser_zhouzhou: [
    {
      key: 'profile', label: '画像', order: 5,
      data: { orderCount: 3, ordersCapped: false, paidCount: 2, totalSpent: 236, activatedCount: 2, enteredCount: 1, enterRate: 50, lastActiveAt: now() - 90_000 },
    },
    {
      key: 'orders', label: '订单', order: 10,
      data: {
        count: 2, capped: false,
        orders: [
          { id: 'LD20260628002', status: 'shipped', amount: 128, createdAt: now() - 3 * 86400_000, itemCount: 2, trackingNo: 'SF1234567890' },
          { id: 'LD20260701011', status: 'paid', amount: 108, createdAt: now() - 40_000, itemCount: 1, trackingNo: '' },
        ],
      },
    },
    {
      key: 'activation', label: '激活/课程', order: 20,
      data: {
        count: 2, capped: false,
        activations: [
          { courseId: 'course_bear', code: 'BEAR-9F2K', activated: true, entered: true, enteredAt: now() - 2 * 86400_000 },
          { courseId: 'course_flower', code: 'FLWR-3H7M', activated: true, entered: false, enteredAt: null },
        ],
      },
    },
  ],
  oMockUser_lili: [
    {
      key: 'profile', label: '画像', order: 5,
      data: { orderCount: 1, ordersCapped: false, paidCount: 1, totalSpent: 88, activatedCount: 1, enteredCount: 0, enterRate: 0, lastActiveAt: now() - 30_000 },
    },
    {
      key: 'activation', label: '激活/课程', order: 20,
      data: { count: 1, capped: false, activations: [{ courseId: 'course_bear', code: 'BEAR-2Z8Q', activated: true, entered: false, enteredAt: null }] },
    },
  ],
}

const KB = [
  { id: 'kb1', question: '多久发货', answer: '亲，现货订单我们 48 小时内发出哦，发出后会短信通知运单号～预售款以商品页标注为准。' },
  { id: 'kb2', question: '激活码提示已被使用', answer: '这个码如果是您首次使用，请提供订单号，我帮您核实下是否被重复扫描，稍等～' },
  { id: 'kb3', question: '枣形针松垮', answer: '枣形针钩松通常是抽线力度不均，建议每钩完一个泡针稍收一下线；可以看第 3 步的辅助视频 02:15 处的慢动作示范。' },
  { id: 'kb4', question: '退换货政策', answer: '材料包未拆封 7 天可退；课程激活后不支持退款哦。需要的话我帮您登记，商户会跟进～' },
  { id: 'kb5', question: '转人工/升级', answer: '您的问题我帮您升级给专属老师处理，稍后会有老师联系您，请留意消息～' },
]

// ── 视图投影（严格贴契约）────────────────────────────────────────────────
const toQueueItem = (s) => ({
  sessionId: sid(s.externalUserId),
  externalUserId: s.externalUserId,
  openKfId: OPEN_KF,
  status: s.status,
  createdAt: s.createdAt,
  updatedAt: s.updatedAt,
  // 契约外附加字段（TS 结构化子类型兼容·前端展示用·真后端可无·UI 有回退）：客户昵称 + 未读估计
  display: s.display,
  waitingMs: now() - s.createdAt,
})
const toSessionView = (s) => ({
  ...toQueueItem(s),
  openid: s.openid,
  agentId: s.agentId,
  claimedAt: s.claimedAt,
})
const find = (sessionId) => SESSIONS.find((s) => sid(s.externalUserId) === sessionId)

// 认领后按 afterMs 释放脚本化入站（模拟客户续说·让轮询有真增量）
function revealDue(s) {
  if (!s.claimedAt || s.status !== 'active') return
  const elapsed = now() - s.claimedAt
  while (s.revealed < s.script.length && s.script[s.revealed].afterMs <= elapsed) {
    const item = s.script[s.revealed++]
    const at = s.claimedAt + item.afterMs
    s.messages.push({ direction: 'in', msgtype: 'text', text: item.text, at })
    s.updatedAt = at
  }
}

// ── 8 个 action 实现（返回形状 = csAgentDesk.ts 的 *Res）────────────────────
function listQueue(data = {}) {
  const limit = Math.min(Math.max(Number(data.limit) || 20, 1), 50)
  const start = Number(data.cursor) || 0
  const pending = SESSIONS.filter((s) => s.status === 'pending').sort((a, b) => a.createdAt - b.createdAt)
  const page = pending.slice(start, start + limit)
  const res = { ok: true, items: page.map(toQueueItem) }
  if (start + limit < pending.length) res.nextCursor = String(start + limit)
  return res
}
function claimConversation(data = {}) {
  const s = find(data.sessionId)
  if (!s) return { ok: false, error: 'NOT_FOUND' }
  if (s.status === 'active' && s.agentId === _agentId) return { ok: true, session: toSessionView(s) } // 幂等
  if (s.status !== 'pending') return { ok: false, error: 'NOT_CLAIMABLE' } // 已被他人接/已关
  s.status = 'active'
  s.agentId = _agentId
  s.claimedAt = now()
  s.updatedAt = s.claimedAt
  return { ok: true, session: toSessionView(s) }
}
function releaseConversation(data = {}) {
  const s = find(data.sessionId)
  if (!s) return { ok: false, error: 'NOT_FOUND' }
  s.status = 'pending'
  s.agentId = null
  s.claimedAt = null
  s.revealed = 0 // 退回后重置脚本（下个坐席重新体验）
  s.updatedAt = now()
  return { ok: true }
}
function sendAgentMessage(data = {}) {
  const s = find(data.sessionId)
  if (!s) return { ok: false, error: 'NOT_FOUND' }
  if (s.status !== 'active') return { ok: false, error: 'NOT_ACTIVE' }
  const text = String(data.text || '').trim()
  if (!text) return { ok: false, error: 'EMPTY' }
  s.messages.push({ direction: 'out', msgtype: 'text', text, at: now() })
  s.updatedAt = now()
  return { ok: true, errcode: 0 }
}
function getThread(data = {}) {
  const s = find(data.sessionId)
  if (!s) return { ok: false, error: 'NOT_FOUND' }
  revealDue(s)
  const cursor = Number(data.cursor) || 0
  const messages = s.messages.filter((m) => m.at > cursor).sort((a, b) => a.at - b.at)
  const res = { ok: true, session: toSessionView(s), messages }
  const last = messages.length ? messages[messages.length - 1].at : cursor
  if (last) res.nextCursor = String(last)
  return res
}
function setAgentStatus(data = {}) {
  const ok = ['online', 'busy', 'offline'].includes(data.status)
  return ok ? { ok: true } : { ok: false, error: 'BAD_STATUS' }
}
function escalateToMerchant(data = {}) {
  const s = find(data.sessionId)
  if (!s) return { ok: false, error: 'NOT_FOUND' }
  if (s.status !== 'active') return { ok: false, error: 'NOT_ACTIVE' }
  s.status = 'escalated'
  s.updatedAt = now()
  return { ok: true }
}
function closeConversation(data = {}) {
  const s = find(data.sessionId)
  if (!s) return { ok: false, error: 'NOT_FOUND' }
  s.status = 'closed'
  s.updatedAt = now()
  return { ok: true }
}
// ⑨ 本坐席在接会话（刷新恢复·claimedAt 升序·贴真后端 listMyActive）
function listMyActive() {
  const mine = SESSIONS.filter((s) => s.status === 'active' && s.agentId === _agentId).sort((a, b) => (a.claimedAt || 0) - (b.claimedAt || 0))
  return { ok: true, sessions: mine.map(toSessionView) }
}

// ── 侧栏 360（scoped 版·按会话经双闸·贴真后端 getSessionCustomer360）+ 快捷回复 ──
function getSessionCustomer360(data = {}) {
  const s = find(data.sessionId)
  if (!s) return { ok: false, error: 'NOT_FOUND' }
  if (!s.openid) return { ok: false, error: 'NO_BRIDGE' } // 身份桥接未建（同真后端·前端有提示）
  return { ok: true, openid: s.openid, panels: CUSTOMER360[s.openid] || [] }
}
function listKb() {
  return { ok: true, list: KB.map((e) => ({ ...e })) }
}

// ── 统一分发（与真 adminApi 按 action 分发同构·agentApi 的 mock 分支调此）──
const HANDLERS = {
  listQueue,
  claimConversation,
  releaseConversation,
  sendAgentMessage,
  getThread,
  setAgentStatus,
  escalateToMerchant,
  closeConversation,
  listMyActive,
  getSessionCustomer360,
  listKb,
}
export function handle(action, data = {}) {
  const fn = HANDLERS[action]
  // 模拟网络异步（贴真接口的 await 语义·让 UI 的 loading 态真实可见）
  return Promise.resolve(fn ? fn(data) : { ok: false, error: 'UNKNOWN_ACTION' })
}

// 测试/演示复位
export function reset() {
  SESSIONS = seed()
  _agentId = 'agent_demo'
}
