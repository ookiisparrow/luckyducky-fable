import { createSign, randomBytes } from 'crypto'
import { request } from 'https'

/**
 * 微信支付 APIv3 商户接缝（根因#12 平台接缝单点·S16 外部对账 Batch 2）。
 *
 * 与 `kit/flow.ts` 并列、职责不同：flow.ts 走【云开发支付工作流】收/退款（凭证由工作流持有）；本文件走
 * 【商户 API v3 直连】拉**交易账单**（云开发支付未封装账单下载·只能商户 API 直取），出站 GET
 * `api.mch.weixin.qq.com`、用**商户私钥 RSA-SHA256** 签名（APIv3 鉴权方案）。
 *
 * 凭证（敏感·非 git/非 DB·根因#9）：商户私钥 + 证书序列号读**云开发环境变量**
 * `WXPAY_MCH_PRIVATE_KEY` / `WXPAY_MCH_SERIAL`；mchid 取 `config.pay.subMchId`（自有商户号 1113881793）。
 * 出站 + 解析单点收口此处（守卫 wxpay-seam-single）；业务码不直拼签名/不直调商户 API。
 *
 * fail-soft 铁律：缺凭证 / 网络 / 状态码非 200 / 解析失败 → `{ ok:false, error }`，绝不抛错反噬调用方。
 *
 * ⚠️ 真账单可行性（靠人·根因#8 拿到≠用通）：若商户号是「服务商-子商户」模式，账单 API 须服务商凭证
 * + `sub_mchid` 参数（云开发持有·未必可取）——故 Batch 2 第一步＝拉一天真账单 spike 验通才继续 Batch 3。
 */

const WXPAY_HOST = 'https://api.mch.weixin.qq.com'

export type WxFetch = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string }
) => Promise<{ status: number; text: () => Promise<string> }>

const httpsFetch: WxFetch = (url, init) =>
  new Promise((resolve, reject) => {
    const u = new URL(url)
    const req = request(
      { method: init?.method || 'GET', hostname: u.hostname, path: u.pathname + u.search, headers: init?.headers },
      (res) => {
        let body = ''
        res.on('data', (c) => (body += c))
        res.on('end', () => resolve({ status: res.statusCode || 0, text: async () => body }))
      }
    )
    req.on('error', reject)
    if (init?.body) req.write(init.body)
    req.end()
  })

const defaultFetch: WxFetch = (url, init) =>
  typeof (globalThis as any).fetch === 'function'
    ? (globalThis as any)
        .fetch(url, init)
        .then((r: any) => ({ status: r.status, text: () => r.text() }))
    : httpsFetch(url, init)

export interface SignOpts {
  method: string
  urlPath: string // path + query（被签内容·须与请求一致）
  body: string // GET 为空串
  mchid: string
  serial: string
  privateKey: string
  timestamp?: string // 默认当前秒（测试可注入固定值）
  nonce?: string
}

/** APIv3 Authorization 头：message=METHOD\nURL\nTS\nNONCE\nBODY\n → 商户私钥 RSA-SHA256 → base64。 */
export function wxpaySign(opts: SignOpts): string {
  const timestamp = opts.timestamp || Math.floor(Date.now() / 1000).toString()
  const nonce = opts.nonce || randomBytes(16).toString('hex')
  const message = `${opts.method}\n${opts.urlPath}\n${timestamp}\n${nonce}\n${opts.body}\n`
  const signature = createSign('RSA-SHA256').update(message).sign(opts.privateKey, 'base64')
  return `WECHATPAY2-SHA256-RSA2048 mchid="${opts.mchid}",nonce_str="${nonce}",signature="${signature}",timestamp="${timestamp}",serial_no="${opts.serial}"`
}

export interface BillRow {
  tradeTime: string
  outTradeNo: string // 商户订单号（= order.id·对账主键）
  transactionId: string // 微信订单号
  orderAmount: number // 订单金额（元）
  refundAmount: number // 退款金额（元）
  tradeState: string // SUCCESS / REFUND / …
}

// 交易账单 CSV：首行表头（中文列名）；数据行每字段反引号前缀（防 Excel 数字格式化）；末两行汇总（非反引号·跳过）。
// 按**表头名**定位列（不靠固定列序·健壮于列序变化）；只取对账所需列（均在 商品名称 等含逗号列之前·朴素逗号切安全）。
const COLS: Record<keyof BillRow, string> = {
  tradeTime: '交易时间',
  outTradeNo: '商户订单号',
  transactionId: '微信订单号',
  orderAmount: '订单金额',
  refundAmount: '退款金额',
  tradeState: '交易状态',
}
const unq = (s: string) => String(s || '').replace(/^`/, '').trim() // 去字段前导反引号

export function parseTradeBill(csv: string): BillRow[] {
  const lines = String(csv || '')
    .split(/\r?\n/)
    .filter((l) => l.trim())
  if (lines.length < 2) return []
  const header = lines[0].split(',').map(unq)
  const idx = (name: string) => header.indexOf(name)
  const iTime = idx(COLS.tradeTime)
  const iOut = idx(COLS.outTradeNo)
  const iTxn = idx(COLS.transactionId)
  const iAmt = idx(COLS.orderAmount)
  const iRef = idx(COLS.refundAmount)
  const iState = idx(COLS.tradeState)
  if (iOut < 0 || iTxn < 0) return [] // 表头缺主键列＝非预期格式
  const rows: BillRow[] = []
  for (const line of lines.slice(1)) {
    if (line.startsWith('总交易单数')) break // 汇总区头：其后是汇总（含反引号数据行），非交易，停
    if (!line.startsWith('`')) continue // 仅交易数据行（反引号开头）
    const f = line.split(',').map(unq)
    rows.push({
      tradeTime: iTime >= 0 ? f[iTime] || '' : '',
      outTradeNo: f[iOut] || '',
      transactionId: f[iTxn] || '',
      orderAmount: iAmt >= 0 ? Number(f[iAmt]) || 0 : 0,
      refundAmount: iRef >= 0 ? Number(f[iRef]) || 0 : 0,
      tradeState: iState >= 0 ? f[iState] || '' : '',
    })
  }
  return rows
}

export interface FetchBillOpts {
  date: string // 'YYYY-MM-DD'
  mchid: string
  serial: string
  privateKey: string
  billType?: string // 默认 ALL
  subMchId?: string // 服务商-子商户模式才带（普通商户留空）
}

// 出站请求统一头（含签名）。WeChat 要求带 User-Agent，否则可能拒。
function signedHeaders(method: string, urlPath: string, o: FetchBillOpts): Record<string, string> {
  return {
    Authorization: wxpaySign({ method, urlPath, body: '', mchid: o.mchid, serial: o.serial, privateKey: o.privateKey }),
    Accept: 'application/json',
    'User-Agent': 'luckyducky-recon/1.0',
  }
}

/**
 * 拉一天交易账单 → 解析成行。两段：① GET /v3/bill/tradebill 取 download_url；② 签名 GET 下载 CSV。
 * fetchImpl 默认走 https（真出站·凭证 spike 验）；测试注入 mock。**fail-soft·绝不抛错**。
 */
export async function fetchTradeBill(
  o: FetchBillOpts,
  fetchImpl: WxFetch = defaultFetch
): Promise<{ ok: boolean; rows?: BillRow[]; error?: string }> {
  try {
    const sub = o.subMchId ? `&sub_mchid=${o.subMchId}` : ''
    const queryPath = `/v3/bill/tradebill?bill_date=${o.date}&bill_type=${o.billType || 'ALL'}${sub}`
    const q = await fetchImpl(WXPAY_HOST + queryPath, { method: 'GET', headers: signedHeaders('GET', queryPath, o) })
    if (q.status !== 200) {
      // 带回微信错误码/消息（非敏感·诊断用）：区分 NO_STATEMENT_EXIST(auth 通·无账单) vs SIGN_ERROR(签名/服务商问题)
      const b = await q.text().catch(() => '')
      return { ok: false, error: `BILL_QUERY_${q.status}` + (b ? ':' + b.slice(0, 300) : '') }
    }
    const meta = JSON.parse((await q.text()) || '{}')
    if (!meta.download_url) return { ok: false, error: 'NO_DOWNLOAD_URL' }
    const dl = new URL(meta.download_url)
    const dlPath = dl.pathname + dl.search
    const d = await fetchImpl(meta.download_url, { method: 'GET', headers: signedHeaders('GET', dlPath, o) })
    if (d.status !== 200) {
      const b = await d.text().catch(() => '')
      return { ok: false, error: `BILL_DOWNLOAD_${d.status}` + (b ? ':' + b.slice(0, 300) : '') }
    }
    return { ok: true, rows: parseTradeBill(await d.text()) }
  } catch (e: any) {
    return { ok: false, error: 'WXPAY_FETCH_FAIL:' + (e?.message || 'unknown') }
  }
}
