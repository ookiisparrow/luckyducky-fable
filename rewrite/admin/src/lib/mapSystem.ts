// 系统组+钱组补齐映射（纯函数）：外包账号行/批次激活率/
// 对账日表与勾对差异（approx 诚实透传·wxOnly=最危险标红）/库存冲突 409 人话/webhook 形态前端预检。
// 上新五步/批次/课程操作者可见错误码 → 中文大白话（UNKNOWN_COURSE 等·编号只作次要信息）。
import { yuan, dateTime } from './format'
import type { ErrCode } from '@ldrw/shared'

export interface AgentRow {
  id: string
  name: string
  disabled: boolean
  wecomUserId: string
  createdAt: string
  status: 'online' | 'busy' | 'offline'
  statusLabel: string
  statusTone: 'green' | 'amber' | 'neutral'
  activeCount: number
  todayClosed: number
}

const AGENT_STATUS_LABEL: Record<string, string> = { online: '在线', busy: '忙碌', offline: '离线' }
const AGENT_STATUS_TONE: Record<string, 'green' | 'amber' | 'neutral'> = { online: 'green', busy: 'amber', offline: 'neutral' }

export function mapAgents(list: unknown): AgentRow[] {
  if (!Array.isArray(list)) return []
  return (list as Record<string, any>[]).filter((a) => a && a.id).map((a) => {
    // status 兜底 offline（后端无 agentState 档时已回退·这里再兜一层防未知值）
    const status: AgentRow['status'] = a.status === 'online' || a.status === 'busy' ? a.status : 'offline'
    return {
      id: String(a.id),
      name: String(a.name || ''),
      disabled: a.disabled === true,
      wecomUserId: String(a.wecomUserId || ''),
      createdAt: dateTime(a.createdAt),
      status,
      statusLabel: AGENT_STATUS_LABEL[status],
      statusTone: AGENT_STATUS_TONE[status],
      activeCount: Number(a.activeCount) || 0,
      todayClosed: Number(a.todayClosed) || 0,
    }
  })
}

export interface BatchRow {
  batchId: string
  total: number
  activated: number
  rateLabel: string
  createdAt: string
}

export function mapBatches(list: unknown): BatchRow[] {
  if (!Array.isArray(list)) return []
  return (list as Record<string, any>[]).filter((b) => b && b.batchId).map((b) => {
    const total = Number(b.total) || 0
    const act = Number(b.activated) || 0
    return {
      batchId: String(b.batchId),
      total,
      activated: act,
      rateLabel: total ? Math.round((act / total) * 100) + '%' : '—', // 空批不除零
      createdAt: dateTime(b.createdAt),
    }
  })
}

/** 企微群机器人 webhook 形态预检（与云端同一正则·省一次白发请求；空=清除合法）。 */
export const webhookOk = (w: string): boolean => !w || /^https:\/\/qyapi\.weixin\.qq\.com\/cgi-bin\/webhook\/send\?key=[\w-]+$/.test(w)

export interface ReconVM {
  cumulative: Array<{ label: string; value: string }>
  // 窗内合计（所选区间真值·别用全时 cumulative：窗内订单数与全时钱额混排会口径错乱、tfoot 穿帮）
  summary: { income: string; refund: string; net: string; orders: number; refunds: number }
  range: { from: string; to: string }
  daily: Array<{ day: string; income: string; refund: string; net: string; orders: number; refunds: number }>
  approxNote: string
  partial: boolean // 累计聚合/异常查询降级：数据不可信（后端 degraded：任一路读失败·前端须警告操作员别当真 0）
  // 内部异常明细（后端 getTxAlerts 返回 {feeMismatch,refundMismatch,stuckRefunds} 三数组对象·
  // 当数组取 .length 恒 0、明细永不渲染，故按对象结构化·有则渲染带单号、无则空数组不吓人）
  exceptions: Array<{ label: string; ids: string[] }>
}

export function mapRecon(r: unknown): ReconVM | null {
  const d = (r && typeof r === 'object' ? r : {}) as Record<string, any>
  if (d.ok !== true || !d.cumulative) return null
  const c = d.cumulative
  const sm = (d.summary && typeof d.summary === 'object' ? d.summary : {}) as Record<string, any>
  const rg = (d.range && typeof d.range === 'object' ? d.range : {}) as Record<string, any>
  return {
    cumulative: [
      { label: '累计收入', value: yuan(c.income) },
      { label: '累计退款', value: yuan(c.refund) },
      { label: '净额', value: yuan(c.net) },
    ],
    summary: {
      income: yuan(Number(sm.income) || 0),
      refund: yuan(Number(sm.refund) || 0),
      net: yuan(Number(sm.net) || 0),
      orders: Number(sm.orders) || 0,
      refunds: Number(sm.refunds) || 0,
    },
    range: { from: String(rg.from || ''), to: String(rg.to || '') },
    daily: (Array.isArray(d.daily) ? d.daily : []).map((b: Record<string, any>) => ({
      day: String(b.day || ''),
      income: yuan(b.income),
      refund: yuan(b.refund),
      net: yuan(b.net),
      orders: Number(b.orders) || 0,
      refunds: Number(b.refunds) || 0,
    })),
    approxNote: d.approx ? '窗内明细触上限·近似（累计不受影响）' : '', // 诚实透传
    partial: d.partial === true,
    exceptions: mapExceptions(d.exceptions),
  }
}

// 后端 exceptions＝{feeMismatch,refundMismatch,stuckRefunds} 三 id 数组·结构化成带单号明细块（有则渲染·空不吓人）
function mapExceptions(ex: unknown): Array<{ label: string; ids: string[] }> {
  const o = (ex && typeof ex === 'object' ? ex : {}) as Record<string, any>
  const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : [])
  return [
    { label: '金额不符单（先核对流水；支付异常走退款处理）', ids: list(o.feeMismatch) },
    { label: '退款金额不符', ids: list(o.refundMismatch) },
    { label: '审批后卡单（死信·退款未走通）', ids: list(o.stuckRefunds) },
  ].filter((e) => e.ids.length)
}

export interface BillMatchVM {
  summary: Array<{ label: string; value: number; danger?: boolean }>
  wxOnly: Array<{ transactionId: string; amount: string; date: string }>
  oursOnly: Array<{ id: string; amount: string }>
  amountMismatch: Array<{ id: string; ours: string; wx: string }>
  approxNote: string
}

export function mapBillMatch(r: unknown): BillMatchVM | null {
  const d = (r && typeof r === 'object' ? r : {}) as Record<string, any>
  if (d.ok !== true || !d.summary) return null
  const s = d.summary
  const dis = d.discrepancies || {}
  return {
    summary: [
      { label: '已平', value: Number(s.matched) || 0 },
      { label: '微信有我方无（最危险）', value: Number(s.wxOnly) || 0, danger: (Number(s.wxOnly) || 0) > 0 }, // 收钱无单标红
      { label: '我方有微信无', value: Number(s.oursOnly) || 0 },
      { label: '金额不符', value: Number(s.amountMismatch) || 0, danger: (Number(s.amountMismatch) || 0) > 0 },
    ],
    wxOnly: (Array.isArray(dis.wxOnly) ? dis.wxOnly : []).map((w: Record<string, any>) => ({ transactionId: String(w.transactionId || ''), amount: yuan(w.amount), date: String(w.date || '') })),
    oursOnly: (Array.isArray(dis.oursOnly) ? dis.oursOnly : []).map((o: Record<string, any>) => ({ id: String(o.id || o.outTradeNo || ''), amount: yuan(o.amount) })),
    amountMismatch: (Array.isArray(dis.amountMismatch) ? dis.amountMismatch : []).map((m: Record<string, any>) => ({ id: String(m.id || m.outTradeNo || ''), ours: yuan(m.ours ?? m.ourAmount), wx: yuan(m.wx ?? m.wxAmount) })),
    approxNote: d.approx ? '比对窗触上限·更早的单未进比对面（近似）' : '',
  }
}

export interface StockRow {
  key: string
  productId: string
  spec: string
  stock: number | null // null=不限量（页面用状态徽章，不当成 0）
  threshold: number // per-SKU 低库存阈值（0=无·前端退默认）
  updatedAt: number
}

export function mapStock(list: unknown, truncated: unknown): { rows: StockRow[]; truncNote: string } {
  const rows: StockRow[] = []
  if (Array.isArray(list)) {
    for (const it of list as Record<string, any>[]) {
      if (!it || !it.productId) continue
      const stock = it.stock == null ? null : Number(it.stock)
      rows.push({
        key: String(it._id || it.productId + '__' + (it.spec || '')),
        productId: String(it.productId),
        spec: String(it.spec || ''),
        stock,
        threshold: Math.max(0, Number(it.threshold) || 0),
        updatedAt: Number(it.updatedAt) || 0,
      })
    }
  }
  return { rows, truncNote: truncated === true ? '已触扫描上限·列表非全量（如实标注）' : '' }
}

/** 未发布课程就生成二维码（第 5 步常见拒因）——提示与拦截共用这一句。 */
export const UNKNOWN_COURSE_HINT =
  '还没有发布课程，不能生成二维码。请先到第 4 步保存并点「发布课程」，再回来生成。'

// 按冒号前的主码查：UNKNOWN_COURSE 云端只以 UNKNOWN_COURSE:<课程号> 发出
const LAUNCH_ERR: Partial<Record<ErrCode | 'UNKNOWN_COURSE', string>> = {
  UNKNOWN_COURSE: UNKNOWN_COURSE_HINT,
  NO_COURSE_ID: '还没有课程编号。请先完成前面步骤，或从商品页进入上新。',
  NO_DRAFT: '还没有可发布的课程草稿。请先到第 4 步保存课程，再点「发布课程」。',
  BAD_COURSE: '课程内容不完整，保存没成功。请检查章节、课时是否填好。',
  BAD_ARGS: '填写的数量或编号不对。数量要是正整数，课程号不能空。',
  NO_BATCH: '找不到这个批次。请刷新后再打开。',
  VOD_NOT_CONFIGURED: '视频点播还没配好。请稍后重试；若反复失败，请找技术看点播配置。',
  VOD_PROCESSING: '还有视频在转码，现在不能发布。请点「同步转码状态」，全部就绪后再发布。',
  META_UNAVAILABLE: '上传通道暂时不可用。请稍后重试。',
  DRAFT_CONFLICT: '草稿在别处被改过（另一个页签或窗口）。本次未保存以免互相覆盖；请点「载入」取最新后再编辑。',
  NO_PRODUCT: '找不到这个商品。请刷新后重试。',
  BAD_CARD: '卡片信息不完整，保存没成功。请检查卡面是否上传。',
  BAD_IMAGE: '图片太大或格式不对。请换一张再传。',
  BAD_PRODUCT: '商品信息不完整，保存没成功。请检查名称、价格和规格。',
  NO_ID: '缺少商品编号。请从商品列表重新进入。',
  DOC_READ_FAIL: '云端数据暂时读不出来。请稍后重试。',
  REMOVE_FAIL: '删除没成功。请刷新后再删一次。',
  GC_DELETE_FAIL: '商品已删掉，只是有几张图片没清理干净（已留记录给技术）。请刷新列表。',
  // 外包账号页（Agents）：LOOKUP_FAIL 在写后复核读失败时也回，云端已回滚，所以能说「没建成/没生效」
  BAD_NAME: '名字不能空。',
  KEY_TOO_SHORT: '口令至少 6 位。',
  KEY_TAKEN: '这个口令已被占用（撞口令会串号），请换一个。',
  KEY_LOOKUP_FAIL: '查口令有没有撞号时读库失败，这次没建成。请稍后重试。',
  WECOM_ID_TAKEN: '这个企微 userid 已绑在别的账号。',
  WECOM_ID_LOOKUP_FAIL: '查企微 userid 有没有被别的账号占用时读库失败，这次没生效。请稍后重试。',
  AGENT_NOT_FOUND: '找不到这个坐席账号（可能已被删）。请刷新后再试。',
}

// 任何 action 都可能回的码（client.ts 传输层与 adminApi/index.ts 网关产出）：各业务映射自己的表查不到时先问这里，文案单源。
// 读写共用：failText 前面冠「X失败：」、writeFailText 原样用，所以每句都要自成一句。
// 进这张表不代表「可能已生效」：只有 CALL_TIMEOUT / SERVER_ERROR 可能已写，句子里自己讲明；FORBIDDEN 等在 action 执行前就拒了。
const TRANSPORT_ERR: Record<string, string> = {
  NO_ENDPOINT: '后台还没接上服务器地址。请找技术看配置。',
  BAD_JSON_RESPONSE: '服务器回包读不懂。请刷新后再试。',
  NETWORK: '网络不通，请检查网络后重试。',
  CALL_TIMEOUT: '服务器太久没回话。如果刚才是提交操作，可能已经生效——先刷新看看，再决定要不要重试。',
  AUTH_UNAVAILABLE: '登录校验服务暂时不可用。请稍后再试。',
  SESSION_LOST: '登录已过期。请重新登录后再试。',
  FORBIDDEN: '当前账号没有这项操作的权限。需要的话请找管理员开通。',
  TOO_MANY_ATTEMPTS: '这个网络下口令试错太多次，已被暂时锁定。请过几分钟再试。',
  // action 执行中抛异常：抛之前可能已写了一部分，不能说成没成功
  SERVER_ERROR: '服务器处理时出错了。如果刚才是提交操作，可能已部分生效——先刷新看看，再决定要不要重试；反复出现请找技术。',
  UNKNOWN_ACTION: '云端还不认识这个操作，多半是云端版本没跟上后台。请找技术更新云端。',
}
export function transportErrorText(code: unknown): string | undefined {
  const s = String(code || '')
  return TRANSPORT_ERR[s.startsWith('NETWORK:') ? 'NETWORK' : s]
}

/** 剥 `Error:` 前缀，取 `CODE` / `CODE:detail` 的主码。已是中文则原样。 */
function launchErrHead(raw: unknown): { head: string; rest: string; original: string } {
  let s = String(raw ?? '').trim()
  s = s.replace(/^Error:\s*/i, '')
  const m = /^([A-Z][A-Z0-9_]{1,})(?::(.*))?$/.exec(s)
  if (!m) return { head: '', rest: '', original: s }
  return { head: m[1], rest: (m[2] || '').trim(), original: s }
}

/** 上新五步 / 批次 / 课程给操作者看的错误：主句人话，编号只挂括号里。无映射也不裸甩 CODE。 */
export function launchErrorText(e: unknown): string {
  const { head, rest, original } = launchErrHead(e)
  const transport = transportErrorText(original)
  if (transport) return transport
  const mapped = head ? LAUNCH_ERR[head as keyof typeof LAUNCH_ERR] : ''
  if (mapped) {
    if (rest && /^[\w./-]+$/.test(rest) && rest.length <= 80) return `${mapped}（编号 ${rest}）`
    return mapped
  }
  if (!original) return '操作没成功。请稍后重试。'
  if (/[\u4e00-\u9fff]/.test(original)) return original
  // 卡片/帮助视频/首页内容页也走这里，兜底不提「前面步骤」；步骤指引只写在向导步骤自己的码上（NO_COURSE_ID 等）
  return `操作没成功。请稍后重试，反复失败请找技术。（技术编号 ${original}）`
}

/** 库存保存错误人话（409 版本冲突=有人先改过/顾客下单占用——刷新重试而不是覆盖）。 */
export function stockErrorText(e: unknown, status?: number): string {
  const code = String(e || '')
  const is = (c: ErrCode) => code === c
  if (is('STOCK_CONFLICT') || status === 409) return '这行库存刚被改过（可能是顾客下单占用）——已拒绝覆盖，刷新后再改'
  if (is('BAD_STOCK')) return '库存数不合法（须为非负整数，或留空表示不限量）'
  return transportErrorText(code) || '保存没成功（' + code + '）' // 超时可能已存上，不能说成没成功
}

export interface AuditEntryVM {
  id: string
  timeLabel: string
  operator: string
  action: string
  ok: boolean
  statusLabel: string
  statusTone: 'green' | 'red'
  ip: string
  error: string
  summaryText: string
}

/** 审计日志行归一（listAudit）：ok 归一中文徽章（成功绿/失败红）、operator/ip/摘要缺省显 '—'、
 *  summary 对象拼成 `k: v · k: v` 展示串（同 Anomalies.vue 内联 ctxPairs 的精神，落成可单测的纯函数）。 */
export function mapAuditEntries(list: unknown): AuditEntryVM[] {
  if (!Array.isArray(list)) return []
  return (list as Record<string, any>[]).filter(Boolean).map((e) => {
    const ok = e.ok === true
    const summary = e.summary && typeof e.summary === 'object' ? e.summary : {}
    const summaryText = Object.entries(summary).map(([k, v]) => `${k}: ${v}`).join(' · ')
    return {
      id: String(e.id || ''),
      timeLabel: dateTime(e.ts),
      operator: String(e.operator || '') || '—',
      action: String(e.action || ''),
      ok,
      statusLabel: ok ? '成功' : '失败',
      statusTone: ok ? 'green' : 'red',
      ip: String(e.ip || '') || '—',
      error: String(e.error || ''),
      summaryText: summaryText || '—',
    }
  })
}
