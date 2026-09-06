// 系统组+钱组补齐映射（纯函数·守卫 rw-admin-system-ui-golden）：外包账号行/批次激活率/
// 对账日表与勾对差异（approx 诚实透传·wxOnly=最危险标红）/库存冲突 409 人话/webhook 形态前端预检。
// 上新五步/批次/课程操作者可见错误码 → 中文大白话（UNKNOWN_COURSE 等·编号只作次要信息）。
import { yuan, dateTime } from './format'

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
  // 窗内合计（所选区间真值·后端 summary 就绪·换皮误用全时 cumulative 致口径错乱：窗内订单数与全时钱额混排、tfoot 穿帮）
  summary: { income: string; refund: string; net: string; orders: number; refunds: number }
  range: { from: string; to: string }
  daily: Array<{ day: string; income: string; refund: string; net: string; orders: number; refunds: number }>
  approxNote: string
  partial: boolean // 累计聚合/异常查询降级：数据不可信（后端 cumDegraded·前端须警告操作员别当真 0）
  // 内部异常明细（bug B2 修：后端 getTxAlerts 返回 {feeMismatch,refundMismatch,stuckRefunds} 三数组对象·
  // 换皮误当数组取 .length 恒 0、明细永不渲染。改按对象结构化·有则渲染带单号、无则空数组不吓人）
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

// B2：后端 exceptions＝{feeMismatch,refundMismatch,stuckRefunds} 三 id 数组·结构化成带单号明细块（有则渲染·空不吓人）
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
  stock: number | null
  stockLabel: string
  threshold: number // per-SKU 低库存阈值（0=无·前端退默认·换皮硬编码 10 丢了 per-SKU·后端 saveStock 早支持）
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
        stockLabel: stock == null ? '不限量' : String(stock), // null=不限量·不显 0
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

const LAUNCH_ERR: Record<string, string> = {
  UNKNOWN_COURSE: UNKNOWN_COURSE_HINT,
  NO_COURSE_ID: '还没有课程编号。请先完成前面步骤，或从商品页进入上新。',
  NO_DRAFT: '还没有可发布的课程草稿。请先到第 4 步保存课程，再点「发布课程」。',
  BAD_COURSE: '课程内容不完整，保存没成功。请检查章节、课时是否填好。',
  BAD_ARGS: '填写的数量或编号不对。数量要是正整数，课程号不能空。',
  NO_BATCH: '找不到这个批次。请刷新后再打开。',
  GEN_FAIL: '生成二维码没成功。请稍后重试；若反复出现，先确认第 4 步已经发布课程。',
  VOD_NOT_CONFIGURED: '视频点播还没配好。请稍后重试；若反复失败，请找技术看点播配置。',
  VOD_PROCESSING: '还有视频在转码，现在不能发布。请点「同步转码状态」，全部就绪后再发布。',
  META_UNAVAILABLE: '上传通道暂时不可用。请稍后重试。',
  BAD_CHUNK: '视频分片上传失败。请换网络或换小一点的文件再试。',
  BAD_FINISH: '视频合并失败。请重新上传。',
  CHUNKS_MISSING: '视频分片不完整，合并失败。请重新上传。',
  DRAFT_CONFLICT: '草稿在别处被改过（另一个页签或窗口）。本次未保存以免互相覆盖；请点「载入」取最新后再编辑。',
  SESSION_LOST: '登录已过期。请重新登录后再试。',
  NO_PRODUCT: '找不到这个商品。请刷新后重试。',
  BAD_CARD: '卡片信息不完整，保存没成功。请检查卡面是否上传。',
  BAD_IMAGE: '图片太大或格式不对。请换一张再传。',
  BAD_PRODUCT: '商品信息不完整，保存没成功。请检查名称、价格和规格。',
  NO_ID: '缺少商品编号。请从商品列表重新进入。',
  NO_ENDPOINT: '后台还没接上服务器地址。请找技术看配置。',
  BAD_JSON_RESPONSE: '服务器回包读不懂。请刷新后再试。',
  NETWORK: '网络不通，请检查网络后重试。',
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
  const mapped = head ? LAUNCH_ERR[head] : ''
  if (mapped) {
    if (rest && /^[\w./-]+$/.test(rest) && rest.length <= 80) return `${mapped}（编号 ${rest}）`
    return mapped
  }
  if (!original) return '操作没成功。请稍后重试。'
  if (/[\u4e00-\u9fff]/.test(original)) return original
  return `操作没成功。请先检查前面步骤是否都做完，再重试。（技术编号 ${original}）`
}

/** 库存保存错误人话（409 版本冲突=有人先改过/顾客下单占用——刷新重试而不是覆盖）。 */
export function stockErrorText(e: unknown, status?: number): string {
  const code = String(e || '')
  if (code === 'STOCK_CONFLICT' || status === 409) return '这行库存刚被改过（可能是顾客下单占用）——已拒绝覆盖，刷新后再改'
  if (code === 'BAD_STOCK') return '库存数不合法（须为非负整数，或留空表示不限量）'
  return '保存没成功（' + code + '）'
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

/** 审计日志行归一（批 B6·listAudit）：ok 归一中文徽章（成功绿/失败红）、operator/ip/摘要缺省显 '—'、
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
