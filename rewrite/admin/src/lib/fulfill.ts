// 发货工作台纯逻辑单源（换皮回归还原批·1:1 移植旧线 packages/admin/src/utils/fulfill.js·TS 化）。
// 不 import Vue——tests/fulfill.test.ts 直测。守卫 rw-admin-fulfill-golden。
//
// 现实约束：无电子面单 API，快递运单号在快递员上门逐箱贴条码面单那一刻才产生。所以流程是
// 「打自家内部标签贴箱（QR=订单id）→ 装货 → 快递员贴他们的条码 → 扫内部码选单 + 扫快递码发货」。
// 扫码枪 = 键盘模拟 + 回车后缀，一个输入框收两种码，classifyScan 负责分拣。

export const FULFILL_STEP_NAMES = ['拣货备货', '打印标签', '扫码发货']

// 物流公司单源（Orders 抽屉/批量面板与本工作台共用，防两处漂移）
export const COMPANIES = ['顺丰速运', '中通快递', '圆通速递', '韵达快递', '申通快递', '邮政 EMS', '京东物流']

// 标签纸预设（面单纸订单打印机·空白面单常见两档·w/h 单位 mm）
export const PAPER_PRESETS = [
  { key: '100x180', w: 100, h: 180, label: '100×180mm 面单纸' },
  { key: '76x130', w: 76, h: 130, label: '76×130mm 面单纸' },
]
export type PaperPreset = (typeof PAPER_PRESETS)[number]

export interface FulfillItem {
  name?: string
  qty?: number
}
export interface FulfillOrder {
  id?: string
  createdAt?: number
  feeMismatch?: boolean
  items?: FulfillItem[]
  address?: { name?: string; phone?: string; region?: string; detail?: string }
}

// 订单 id 形状（createOrder orderNo 口径）：北京时间 yyyyMMddHHmm(12 位) + 随机段 1000-9999(4 位)。
// 用于识别「长得像订单 id 但不在队列」的扫描——形状校到月/日/时/分/随机段首位。
const ORDER_ID_RE = /^20\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])([01]\d|2[0-3])[0-5]\d[1-9]\d{3}$/

/** 16 位订单 id → 人眼短编号「MMdd-随机段」（条码扫不出时人工核对用）；其余原样返回。 */
export function shortCode(id: unknown): string {
  const s = String(id || '')
  return /^\d{16}$/.test(s) ? `${s.slice(4, 8)}-${s.slice(12)}` : s
}

export interface PickSummary {
  orderCount: number
  totalQty: number
  mismatchCount: number
  earliestCreatedAt: number | null
  products: Array<{ name: string; qty: number }>
}

/** 拣货汇总：全部待发货订单 → 按产品名合并数量（不分规格——产品都是封装成品）。 */
export function pickSummary(orders: unknown): PickSummary {
  const list = Array.isArray(orders) ? (orders as FulfillOrder[]) : []
  const byName = new Map<string, number>()
  let totalQty = 0
  let mismatchCount = 0
  let earliest: number | null = null
  for (const o of list) {
    if (o && o.feeMismatch) mismatchCount++
    if (o && Number.isFinite(o.createdAt)) earliest = earliest == null ? (o.createdAt as number) : Math.min(earliest, o.createdAt as number)
    for (const it of o && Array.isArray(o.items) ? o.items : []) {
      const name = String((it && it.name) || '').trim()
      const qty = Number(it && it.qty) || 0
      if (!name || qty <= 0) continue
      byName.set(name, (byName.get(name) || 0) + qty)
      totalQty += qty
    }
  }
  const products = [...byName.entries()]
    .map(([name, qty]) => ({ name, qty }))
    .sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name))
  return { orderCount: list.length, totalQty, mismatchCount, earliestCreatedAt: earliest, products }
}

export interface LabelData {
  id: string
  shortCode: string
  name: string
  phone: string
  addressText: string
  lines: Array<{ name: string; qty: number }>
  totalQty: number
}

/** 标签数据派生（纸标签与步3 核对卡共用同一口径）。只含发货字段——不带金额/openid/支付流水（标签外人可见）。 */
export function labelData(order: FulfillOrder | null | undefined): LabelData {
  const o = order || {}
  const a = o.address || {}
  const byName = new Map<string, number>()
  for (const it of Array.isArray(o.items) ? o.items : []) {
    const name = String((it && it.name) || '').trim()
    const qty = Number(it && it.qty) || 0
    if (!name || qty <= 0) continue
    byName.set(name, (byName.get(name) || 0) + qty)
  }
  const lines = [...byName.entries()].map(([name, qty]) => ({ name, qty }))
  return {
    id: String(o.id || ''),
    shortCode: shortCode(o.id),
    name: String(a.name || ''),
    phone: String(a.phone || ''),
    addressText: [a.region, a.detail].filter(Boolean).join(' '),
    lines,
    totalQty: lines.reduce((s, l) => s + l.qty, 0),
  }
}

export type ScanResult =
  | { type: 'empty' }
  | { type: 'order'; id: string }
  | { type: 'order-not-in-queue'; id: string }
  | { type: 'tracking'; trackingNo: string }

/** 扫码分类（安全判序，勿调换）：空→empty；在待发货队列→order；id 形状但不在队列→order-not-in-queue（挡误发）；其余→tracking。 */
export function classifyScan(text: unknown, paidIdSet?: Set<string>): ScanResult {
  const t = String(text || '').trim()
  if (!t) return { type: 'empty' }
  if (paidIdSet && paidIdSet.has(t)) return { type: 'order', id: t }
  if (ORDER_ID_RE.test(t)) return { type: 'order-not-in-queue', id: t }
  return { type: 'tracking', trackingNo: t }
}

const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)

export interface PrintLabel extends LabelData {
  qrDataUrl: string
}

/** 打印页完整 HTML（window.open document.write）：每标签一页（@page=预设尺寸），头部 QR+大号短编号，
 * 中部收件人（不打码——贴箱与快递员填面单都要看），清单区产品名×数量（>6 行 dense 缩字号），底部共 N 件。
 * 纯黑白（热敏/针打无彩色·独立文档无法引 CSS 变量·字面色刻意）。 */
export function buildLabelHtml(labels: PrintLabel[], preset?: PaperPreset): string {
  const p = preset || PAPER_PRESETS[0]
  const qrMm = p.w <= 80 ? 24 : 30
  const cards = (Array.isArray(labels) ? labels : [])
    .map((l) => {
      const dense = l.lines.length > 6
      const rows = l.lines
        .map((ln) => `<div class="line"><span class="ln-name">${esc(ln.name)}</span><span class="ln-qty">× ${esc(ln.qty)}</span></div>`)
        .join('')
      return `<div class="label${dense ? ' dense' : ''}">
  <div class="head">
    <img class="qr" src="${l.qrDataUrl}" alt="qr" />
    <div class="code">
      <div class="short">${esc(l.shortCode)}</div>
      <div class="full">${esc(l.id)}</div>
    </div>
  </div>
  <div class="who">
    <div class="who-name">${esc(l.name)}&nbsp;&nbsp;${esc(l.phone)}</div>
    <div class="who-addr">${esc(l.addressText)}</div>
  </div>
  <div class="goods">${rows}</div>
  <div class="total">共 ${esc(l.totalQty)} 件</div>
</div>`
    })
    .join('\n')
  // 打印文档独立窗口·无法引 CSS 变量·热敏/针打黑白纸用纯黑 #000（主题守卫放行纯黑白）
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>内部发货标签</title>
<style>
  @page { size: ${p.w}mm ${p.h}mm; margin: 0; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif; color: #000; }
  .label { width: ${p.w}mm; height: ${p.h}mm; padding: 6mm; page-break-after: always; overflow: hidden;
           display: flex; flex-direction: column; }
  .head { display: flex; align-items: center; gap: 4mm; }
  .qr { width: ${qrMm}mm; height: ${qrMm}mm; }
  .code { min-width: 0; }
  .short { font-size: 22pt; font-weight: 800; letter-spacing: 1px; }
  .full { font-size: 8.5pt; color: #000; word-break: break-all; }
  .who { margin-top: 3mm; border-top: 0.4mm solid #000; padding-top: 2.5mm; }
  .who-name { font-size: 13pt; font-weight: 700; }
  .who-addr { font-size: 10.5pt; margin-top: 1mm; line-height: 1.45; }
  .goods { margin-top: 2.5mm; border-top: 0.3mm dashed #000; padding-top: 2mm; flex: 1; min-height: 0; }
  .line { display: flex; justify-content: space-between; gap: 3mm; font-size: 11.5pt; padding: 0.8mm 0; }
  .dense .line { font-size: 9pt; padding: 0.3mm 0; }
  .ln-name { min-width: 0; }
  .ln-qty { font-weight: 700; white-space: nowrap; }
  .total { border-top: 0.4mm solid #000; padding-top: 2mm; font-size: 12.5pt; font-weight: 800; text-align: right; }
</style>
</head>
<body>
${cards}
</body>
</html>`
}
