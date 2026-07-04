// 进销存映射（纯函数·守卫 rw-admin-scm-ui-golden）：料号人话/计量中文/状态中文/
// 元→分整数闸（超两位小数拒——分整数纪律的输入侧半边）/SCM 错误码人话（原文兜底）。
import { yuan } from './format'

const TIER_CN: Record<string, string> = { L: '大团', M: '中团', S: '小团' }
const FORM_CN: Record<string, string> = { raw: '原团', knotted: '带结' }

/** 料号 → 人话：yarn:pink:L:knotted → 「毛线·pink·大团·带结」；pkg:/card: 挂产品；其余为辅料 slug。 */
export function materialHuman(id: unknown): string {
  const s = String(id || '')
  if (!s) return ''
  const y = /^yarn:([a-z0-9-]+):([LMS]):(raw|knotted)$/.exec(s)
  if (y) return `毛线·${y[1]}·${TIER_CN[y[2]]}·${FORM_CN[y[3]]}`
  if (s.startsWith('pkg:')) return `包装·${s.slice(4)}`
  if (s.startsWith('card:')) return `卡片·${s.slice(5)}`
  if (s.startsWith('fg:')) return `成品·${s.slice(3).replace('__', ' ')}`
  return `辅料·${s}`
}

export const uomLabel = (u: unknown): string => (String(u) === 'gram' ? '克' : '件')

const PURCHASE_CN: Record<string, string> = { draft: '草稿', ordered: '已下单', received: '已收货', cancelled: '已取消' }
export const purchaseStatusLabel = (s: unknown): string => PURCHASE_CN[String(s)] || String(s || '')

const OUTWORK_CN: Record<string, string> = { draft: '草稿', issued: '已发料', delivered: '已收货', settled: '已结算', cancelled: '已取消' }
export const outworkStatusLabel = (s: unknown): string => OUTWORK_CN[String(s)] || String(s || '')

/** 元输入 → 分整数（输入侧钱闸）：非负、最多两位小数；空串/超两位/非数/负 → null（拒·不静默取整）。
 *  空串显式拒：Number('')===0 会把「没填」静默当 0 元——必须让用户明确填 0 才算 0。 */
export function yuanToFen(v: unknown): number | null {
  if (v === '' || v == null) return null
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0) return null
  const fen = Math.round(n * 100)
  if (Math.abs(n * 100 - fen) > 1e-6) return null // 超两位小数=输入错·拒
  return fen
}

export const fenLabel = (fen: unknown): string => {
  if (fen == null || fen === '') return '' // 无值不显 ¥0.00（Number(null)=0 的坑·同「不限量不显 0」精神）
  const n = Number(fen)
  return Number.isFinite(n) ? yuan(n / 100) : ''
}

/** SCM 错误码人话（原文兜底不吞）。 */
export function scmErrorText(e: unknown): string {
  const code = String(e || '')
  const MAP: Record<string, string> = {
    BAD_UOM: '计量只能选「件」或「克」',
    UOM_LOCKED: '建档后计量方式不能改（改了会混账）——需要改请新建料号',
    KNOT_ONLY_L: '带结只有大团（业务定稿：起手结做在最大团上）',
    BAD_COLOR: '颜色要用小写英文（如 pink）',
    BAD_SLUG: '辅料名要用小写英文/数字/短横线',
    NO_PRODUCT: '专属件（包装/卡片）要填所属产品 id',
    BAD_TYPE: '供应商类型只能是「厂家」或「织女」',
    NO_SUPPLIER: '找不到这个供应商',
    NO_REASON: '库存调整必须写原因（审计要看）',
    BAD_DELTA: '调整量要是非零整数',
    INSUFFICIENT: '库存不够扣——整单已拒、账一分没动',
    BAD_SUPPLIER: '采购只能向「厂家」下单（织女走外协）',
    NOT_OUTWORKER: '外协单只能发给「织女」',
    DUP_LINE: '同一料号出现了两行——合并后再提交',
    NO_MATERIAL: '有料号还没建档——先去物料页建档',
    BAD_QTY: '数量要是正整数',
    BAD_PRICE: '单价不合法',
    BAD_RATE: '计件单价不合法（元·最多两位小数）',
    NOT_DRAFT: '只有草稿能改/取消（已流转的单据是账目依据）',
    BAD_STATUS: '单据状态不允许这个操作',
    ISSUE_L_RAW_ONLY: '发料只能发「大团原团」',
    RECEIVE_L_KNOTTED_ONLY: '收货只能收「大团带结」',
    COLOR_NOT_ISSUED: '收货颜色必须是发过料的颜色',
    RECEIVE_EXCEEDS_ISSUE: '收货数不能超过发料数',
    NOT_ISSUED: '还没发料（或已收过货）',
    NOT_DELIVERED: '还没收货（或已结算）',
    NO_TEMPLATE: '还没配全局配方模板',
    NO_PROFILE: '这个产品还没配差异位（三色+专属件）',
    BAD_TEMPLATE: '模板行不合法（用量正整数·带结槽只能大团）',
    BAD_SETS: '套数要是正整数',
    DUPLICATE: '这单组装已经执行过了（不会双扣）',
    BAD_TARGETS: '备货目标不合法',
    STOCK_APPLY_FAIL: '入库异常——状态已翻但账未动，请查流水并人工调整',
  }
  const hit = MAP[code] || MAP[code.split(':')[0]]
  return hit || '操作没成功（' + code + '）' // 原文兜底
}

export interface LedgerRow {
  id: string
  material: string
  delta: number
  docType: string
  operator: string
  reason: string
  at: number
}

const DOC_CN: Record<string, string> = {
  purchase_in: '采购入库',
  outwork_issue: '外协发料',
  outwork_receive: '外协收货',
  assembly_out: '组装扣料',
  assembly_in: '组装入成品',
  adjust: '人工调整',
  ship: '发货核销',
}
export const docTypeLabel = (t: unknown): string => DOC_CN[String(t)] || String(t || '')

export function mapLedger(list: unknown): LedgerRow[] {
  if (!Array.isArray(list)) return []
  return (list as Record<string, any>[]).filter(Boolean).map((l) => ({
    id: String(l._id || ''),
    material: materialHuman(l.itemKey),
    delta: Number(l.delta) || 0,
    docType: docTypeLabel(l.docType),
    operator: String(l.operator || ''),
    reason: String(l.reason || ''),
    at: Number(l.at) || 0,
  }))
}
