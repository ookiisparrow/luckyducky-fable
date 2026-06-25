import crypto from 'crypto'
import { str } from '../../../kit'
export { str } // 供 action 模块复用（saveCard / saveHomeContent 等截断）

// adminApi 共享件（HTTP 响应 / 口令 / 白名单清洗 / 云存储 / manager-node）。
// 各 action 收 Ctx（db/cloud/data/drafts），不各自 init——db 由 index.ts 经 kit.getDb 提供。
export interface Ctx {
  db: any
  cloud: any
  data: any
  drafts: any
}

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
}
export const reply = (statusCode: number, data: any) => ({ statusCode, headers: CORS, body: JSON.stringify(data) })
export const sha = (s: any) => crypto.createHash('sha256').update(String(s)).digest('hex')

export async function ensure(db: any, coll: string) {
  try {
    await db.createCollection(coll)
  } catch {
    /* 已存在 */
  }
}

// 激活码状态数据链（退款判据 + 订单详情共用·根因#8 真数据不伪造）：买家对某商品对应课程是否
// 已激活/已进课。courseId＝products.courseId·回退 course-<productId>（与 genQrcodes/StepBatch 同口径）；
// 查 activations（activateCourse 写的 {_openid, courseId, enteredAt}）。
export async function activationFor(db: any, openid: string, productId: string) {
  const pid = String(productId || '')
  const prod = await db.collection('products').doc(pid).get().catch(() => null)
  const courseId = (prod && prod.data && prod.data.courseId) || 'course-' + pid
  const acts = openid
    ? await db
        .collection('activations')
        .where({ _openid: openid, courseId })
        .get()
        .then((r: any) => r.data)
        .catch(() => [])
    : []
  const act = acts[0] || null
  return {
    courseId,
    activated: !!act,
    entered: !!(act && act.enteredAt),
    code: act ? act.qrcodeId || act.code || act._id : '',
    enteredAt: act ? act.enteredAt || null : null,
  }
}

// 已付营收口径（GMV / 财务对账单源·债#32）：pending/closed 未付不计。看板与 S16 对账共用·防口径漂移。
export const PAID_STATUSES = ['paid', 'shipped', 'done']

// 钱链内部异常（txAlerts·债#23 单源）：金额不符单 / 退款金额不符 / 审批超 1h 未到回调的卡单。
// 看板（dashboard）与财务对账（reconciliation·S16）共用此单源——同 activationFor 范式，防两处漂移
// （钱链异常是 money 正确性判据，散两份易一处改漏）。各项走定向 where 精确（稀少·小集合·不从样本 filter）。
export async function getTxAlerts(db: any): Promise<{ feeMismatch: string[]; refundMismatch: string[]; stuckRefunds: string[] }> {
  const _ = db.command
  const HOUR = 3600_000
  const rows = (q: any) =>
    q
      .get()
      .then((r: any) => r.data)
      .catch(() => [])
  const [feeMismatch, refundMismatch, stuckRefunds] = await Promise.all([
    rows(db.collection('orders').where({ feeMismatch: true }).field({ id: true })),
    rows(db.collection('afterSales').where({ refundMismatch: true }).field({ _id: true })),
    rows(db.collection('afterSales').where({ status: 'approved', approvedAt: _.lt(Date.now() - HOUR) }).field({ _id: true })),
  ])
  return {
    feeMismatch: feeMismatch.map((o: any) => o.id),
    refundMismatch: refundMismatch.map((a: any) => a._id),
    stuckRefunds: stuckRefunds.map((a: any) => a._id),
  }
}

// 口令校验。首次初始化（债#15 关抢占窗口）：须 bootstrap 且本次口令匹配**部署密钥**环境变量
// ADMIN_BOOTSTRAP_KEY——杜绝「空库谁先登录谁就占管理员」。未设该环境变量＝禁 bootstrap。
// 设密钥流程：部署时设云环境变量 ADMIN_BOOTSTRAP_KEY＝期望口令 → 首登用该口令 → 设定后可移除。
export async function checkKey(db: any, key: any, bootstrap: boolean) {
  if (!key || String(key).length < 6) return { ok: false, error: 'KEY_TOO_SHORT' }
  await ensure(db, 'adminConfig')
  const got = await db.collection('adminConfig').doc('auth').get().catch(() => null)
  if (!got || !got.data) {
    const secret = process.env.ADMIN_BOOTSTRAP_KEY || ''
    if (!bootstrap || !secret || String(key) !== secret) return { ok: false, error: 'BAD_KEY' }
    await db.collection('adminConfig').add({ data: { _id: 'auth', keyHash: sha(key), createdAt: Date.now() } })
    return { ok: true, bootstrapped: true }
  }
  return got.data.keyHash === sha(key) ? { ok: true } : { ok: false, error: 'BAD_KEY' }
}

// 草稿白名单字段（防杂字段入库）
export function cleanProduct(p: any) {
  if (!p || typeof p !== 'object' || !p.id) return null
  return {
    id: String(p.id).slice(0, 40),
    cover: str(p.cover, 300),
    images: (Array.isArray(p.images) ? p.images : []).slice(0, 20).map((u: any) => str(u, 300)),
    name: str(p.name, 60),
    price: str(String(p.price ?? ''), 12),
    was: str(String(p.was ?? ''), 12),
    tag: str(p.tag, 20),
    brief: str(p.brief, 120),
    skus: (Array.isArray(p.skus) ? p.skus : [])
      .slice(0, 30)
      .map((s: any) => ({ name: str(s?.name, 30), price: str(String(s?.price ?? ''), 12) })),
    params: (Array.isArray(p.params) ? p.params : [])
      .slice(0, 8)
      .map((kv: any) => [str(kv?.[0], 10), str(kv?.[1], 40)]),
    detailSections: (Array.isArray(p.detailSections) ? p.detailSections : [])
      .slice(0, 4)
      .map((d: any) => ({ lead: str(d?.lead, 30), body: str(d?.body, 200) })),
    kit: (Array.isArray(p.kit) ? p.kit : [])
      .slice(0, 8)
      .map((k: any) => ({ icon: str(k?.icon, 24), name: str(k?.name, 14), qty: str(k?.qty, 14) })),
    courseId: str(p.courseId, 40),
    cardStatus: p.cardStatus === 'final' ? 'final' : p.cardStatus === 'draft' ? 'draft' : '',
    batchCount: Number(p.batchCount) || 0,
    videoStats:
      p.videoStats && typeof p.videoStats === 'object'
        ? { total: Number(p.videoStats.total) || 0, done: Number(p.videoStats.done) || 0 }
        : null,
    status: p.status === 'onsale' ? 'onsale' : 'preparing',
    createdAt: Number(p.createdAt) || Date.now(),
    updatedAt: Date.now(),
  }
}

// 课程草稿白名单（三层结构，与小程序 courses 同形；字段截断防杂数据）
export function cleanCourse(c: any) {
  if (!c || typeof c !== 'object' || !c.id) return null
  return {
    id: String(c.id).slice(0, 40),
    title: str(c.title, 60),
    sort: Number(c.sort) || 0,
    chapters: (Array.isArray(c.chapters) ? c.chapters : []).slice(0, 30).map((ch: any) => ({
      id: str(ch?.id, 40) || 'c' + Math.random().toString(36).slice(2, 8),
      title: str(ch?.title, 60),
      lessons: (Array.isArray(ch?.lessons) ? ch.lessons : []).slice(0, 50).map((l: any) => ({
        id: str(l?.id, 40) || 'l' + Math.random().toString(36).slice(2, 8),
        name: str(l?.name, 60),
        dur: str(l?.dur, 10),
        segments: (Array.isArray(l?.segments) ? l.segments : []).slice(0, 30).map((sg: any) => ({
          id: str(sg?.id, 40) || 's' + Math.random().toString(36).slice(2, 8),
          name: str(sg?.name, 60),
          dur: str(sg?.dur, 10),
          videoFileId: str(sg?.videoFileId, 300),
          free: !!sg?.free,
        })),
      })),
    })),
    updatedAt: Date.now(),
  }
}

// base64 → 云存储 products/<pid>/，返回 fileID + 临时展示 URL
export async function storeImage(cloud: any, b64: string, data: any) {
  const ext = ['png', 'jpg', 'mp4', 'mov'].includes(data.ext) ? data.ext : 'jpg'
  const pid = String(data.pid || 'misc').slice(0, 40)
  const prefix = data.kind === 'video' ? 'videos' : 'products'
  const cloudPath = `${prefix}/${pid}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  const up = await cloud.uploadFile({ cloudPath, fileContent: Buffer.from(b64, 'base64') })
  const r = await cloud.getTempFileURL({ fileList: [up.fileID] })
  return { ok: true, fileID: up.fileID, url: r.fileList[0]?.tempFileURL || '' }
}

// manager-node：用函数运行时临时密钥初始化（签发直传凭证用）
let _manager: any = null
export function manager() {
  if (_manager) return _manager
  const Manager = require('@cloudbase/manager-node')
  _manager = new Manager({
    secretId: process.env.TENCENTCLOUD_SECRETID,
    secretKey: process.env.TENCENTCLOUD_SECRETKEY,
    token: process.env.TENCENTCLOUD_SESSIONTOKEN,
    envId: process.env.TCB_ENV || process.env.SCF_NAMESPACE,
  })
  return _manager
}
