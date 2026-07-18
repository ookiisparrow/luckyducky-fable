import crypto from 'crypto'
import { str, notifyAlert } from '../../kit'
import { PAID_ORDER_STATUSES } from '@ldrw/shared'
export { str } // 供 action 模块复用（saveCard / saveHomeContent 等截断）

// 账号有界扫描命中上限告警（P2 评审·根因#7 分页协议纪律的账号扫描版）：keyHash 加盐后多账号查找从
// 「等值精确查询」退化为「limit(N) 有界扫描 + 客户端逐条比对」（checkKey 多账号分支、createAgent 撞口令
// 预检①/写后复核②，见 keyMatches 单源三处调用点）——一旦 adminConfig 带 keyHash 的账号总数超过扫描上限，
// 候选窗口可能装不下目标账号，导致合法口令静默登录失败 / 撞口令回滚安全网形同虚设，且此前无任何信号。
// fail-soft：只在命中上限时留痕告警，不改变扫描本身的返回值/控制流。
export function alertIfScanAtCap(rows: any[], limit: number, fn: string): void {
  if (Array.isArray(rows) && rows.length >= limit) {
    // fp:fn 细分去重键（recordAnomaly 契约·见 kit/anomaly.ts）——三处调用点各自留痕，不被同 kind+code
    // 的指纹去重合并成一条（否则只看得到「某处顶到上限」，看不出是哪个扫描点）。
    // 兜底（根因#14）：notifyAlert 本身走 try/catch 已经很难失败，但一旦失败（如 recordAnomaly/db 抛出
    // 未被内部吞掉的异常）绝不能悄悄丢——告警系统自己失效却没人知道，比原始异常本身更危险。
    notifyAlert('security', fn, 'ACCOUNT_SCAN_AT_CAP', { limit, fp: fn }).catch((e) => {
      console.error(`[LD_ALERT_FAIL] alertIfScanAtCap 告警发送失败 fn=${fn} err=${String(e)}`)
    })
  }
}

// adminApi 共享件（HTTP 响应 / 口令 / 白名单清洗 / 云存储 / manager-node）。
// 各 action 收 Ctx（db/cloud/data/drafts），不各自 init——db 由 index.ts 经 kit.getDb 提供。
export interface Ctx {
  db: any
  cloud: any
  data: any
  drafts: any
  // 承面 C 坐席台（B6·§1.5·根因#3 不信前端）：认证主体身份，由 index.ts 分发处从 checkKey 结果贯入（非 data）。
  agentId?: string // 认证坐席身份＝账号 _id（外包 adminConfig._id / 超管 'admin'）·claim/scope/agentState 用
  caps?: string[] // 认证主体能力位（'*'=超管全量·坐席台分配 scope 判超管用）
}

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
}
export const reply = (statusCode: number, data: any) => ({
  statusCode,
  headers: CORS,
  body: JSON.stringify(data),
})
export const sha = (s: any) => crypto.createHash('sha256').update(String(s)).digest('hex')

// 口令加盐 KDF（批6·根因：sha 无盐口令可离线彩虹表还原·钱/权限承重批）：新写入口令一律 salt+scrypt；
// 存量 sha 账号 legacy 校验通过后 best-effort 就地升级（见 checkKey/createAgent）。scrypt 默认参数
// N=16384（~16MB/数十 ms）：登录端点已有频控、建号为管理端低频操作，最坏扫描 ≤50 行也在可接受范围。
export const newSalt = () => crypto.randomBytes(16).toString('hex')
export const kdf = (key: string, salt: string) =>
  crypto.scryptSync(String(key), salt, 32).toString('hex')

// 盐感知口令比对单源（根因#5·防漂移）：有 keySalt 走 scrypt 比对（新写入/已升级口令）；无则 legacy
// sha 比对（存量未升级账号）。checkKey 的多账号扫描、createAgent 的撞口令预检①与写后复核②全部改走
// 它——一份比对逻辑，杜绝三处各写一份、盐语义漂移（预审咬中项）。
export function keyMatches(row: any, key: string): boolean {
  if (!row) return false
  return row.keySalt ? kdf(key, row.keySalt) === row.keyHash : sha(key) === row.keyHash
}

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
  const prod = await db
    .collection('products')
    .doc(pid)
    .get()
    .catch(() => null)
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
// 真正单源在 @ldrw/shared order.ts 的 PAID_ORDER_STATUSES（与订单状态机声明同处·P2 顺手改批收口——此前本文件
// /dashboard.ts /reconciliation.ts /customer360 profile.ts 各自手抄同一份数组，这里保留 PAID_STATUSES 这个
// 名字只做转发，dashboard.ts/reconciliation.ts 既有 `import { PAID_STATUSES } from '../lib'` 不用改）。
export const PAID_STATUSES: readonly string[] = PAID_ORDER_STATUSES

// 钱链内部异常（txAlerts·债#23 单源）：金额不符单 / 退款金额不符 / 审批超 1h 未到回调的卡单。
// 看板（dashboard）与财务对账（reconciliation·S16）共用此单源——同 activationFor 范式，防两处漂移
// （钱链异常是 money 正确性判据，散两份易一处改漏）。各项走定向 where 精确（稀少·小集合·不从样本 filter）。
// P2→修（批1 bug sweep）：三路裸 .get() 命中服务端默认 100 条截断，与「精确不漏老单」的注释矛盾——
// 显式 .limit(1000)（云函数端上限）。钱链异常超 1000 条属灾难态，看板计数意义已失真，如实 cap 不强求无界。
export async function getTxAlerts(
  db: any
): Promise<{
  feeMismatch: string[]
  refundMismatch: string[]
  stuckRefunds: string[]
  partial: boolean
}> {
  const _ = db.command
  const HOUR = 3600_000
  const CAP = 1000
  // 任一路查询失败（深审 P1·病根#14）：钱链异常（金额不符/退款不符/卡单）是 money 正确性判据，
  // 静默 .catch(()=>[]) 降级为「零异常」会让看板/对账把「没查到」当「没异常」（假 all-clear）。改：
  // 失败置 partial + 告警，回传 partial 让消费方标注「异常数据不可信」，绝不假装全清。
  let partial = false
  const rows = (q: any) =>
    q
      .limit(CAP)
      .get()
      .then((r: any) => r.data)
      .catch(() => {
        partial = true
        return []
      })
  const [feeMismatch, refundMismatch, stuckRefunds] = await Promise.all([
    rows(db.collection('orders').where({ feeMismatch: true }).field({ id: true })),
    rows(db.collection('afterSales').where({ refundMismatch: true }).field({ _id: true })),
    rows(
      db
        .collection('afterSales')
        .where({ status: 'approved', approvedAt: _.lt(Date.now() - HOUR) })
        .field({ _id: true })
    ),
  ])
  if (partial) await notifyAlert('money', 'getTxAlerts', 'TXALERTS_QUERY_FAIL', {}).catch(() => {})
  return {
    feeMismatch: feeMismatch.map((o: any) => o.id),
    refundMismatch: refundMismatch.map((a: any) => a._id),
    stuckRefunds: stuckRefunds.map((a: any) => a._id),
    partial,
  }
}

// 口令校验。首次初始化（债#15 关抢占窗口）：须 bootstrap 且本次口令匹配**部署密钥**环境变量
// ADMIN_BOOTSTRAP_KEY——杜绝「空库谁先登录谁就占管理员」。未设该环境变量＝禁 bootstrap。
// 设密钥流程：部署时设云环境变量 ADMIN_BOOTSTRAP_KEY＝期望口令 → 首登用该口令 → 设定后可移除。
// 坐席 RBAC 角色→能力位单源（§1.5·B5.2·别让单超管裸奔）：superadmin 全能力；outsourced 外包最小权
// （只 agent:handle·余皆默认拒·防越权动钱/状态/导出）。中间角色（如内部坐席）按需扩——加新角色 + 给对应 action 标 cap 即可。
export const ROLES: Record<string, string[]> = {
  superadmin: ['*'],
  // 外包最小权（§1 定稿·根因#3·master 整合收窄）：**仅 agent:handle**——承面C 坐席台（查 listQueue/getThread + 回复 send +
  // 认领/放手/升级/结束 + 快捷回复读 kb·**不含**动钱/动状态/退款·留商户超管）。**刻意去掉裸 customer:view**：
  // 否则外包一建号即可调 getCustomer360/searchCustomer 遍历全量客户＝批量导出（车道 C 报的洞·§1 定稿「分配制·只看自己 claim 的会话+对应360」）。
  // 外包看客户 360 只能经「自己 claim 的会话」的 scoped 路径（assertOwnedByAgent + assertDataShareConsent·scoped-360 follow-up 落地·见 承面C工单）。
  outsourced: ['agent:handle'],
}
export const capsForRole = (role: string): string[] => ROLES[role] || []

// 会话令牌（深审 P1·根因#3 口令不落盘）：口令登录与企微免登共用一套签发/解析——登录成功签发高熵令牌，
// 前端只存令牌不存口令原文（口令是可复用主凭证，落在外包机器上=失守；令牌 12h 自灭 + 停号即拒）。
// 存储形状：账号 doc.sessions = [{ hash, exp, via, at }]（sha 入库·绝不存明文）；数组容多设备
// （商户同时登控制台+坐席台不互踢），签发时剪过期、超容剪最旧。守卫 admin-session-token-not-password。
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000 // 12h·一个工作班次；过期重登（企微内静默 OAuth 无感）
const SESSION_MAX = 8 // 单账号并存会话上限（多设备够用·防 sessions 数组无界膨胀）

/** 签发会话令牌：写进账号 doc.sessions（剪过期/超容），返回令牌明文（只此一次·不再可取回）。 */
export async function issueSession(db: any, docId: string, via: 'pwd' | 'wecom'): Promise<string> {
  const token = crypto.randomBytes(32).toString('hex')
  const now = Date.now()
  const got = await db
    .collection('adminConfig')
    .doc(docId)
    .get()
    .catch(() => null)
  const prev: any[] = (got && got.data && Array.isArray(got.data.sessions) ? got.data.sessions : [])
    .filter((s: any) => s && typeof s.exp === 'number' && s.exp > now) // 剪过期
    .slice(-(SESSION_MAX - 1)) // 超容剪最旧（保留末 N-1 + 新签 1）
  const sessions = [...prev, { hash: sha(token), exp: now + SESSION_TTL_MS, via, at: now }]
  await db
    .collection('adminConfig')
    .doc(docId)
    .update({ data: { sessions, updatedAt: now } })
  return token
}

// 会话令牌解析（fail-closed）：key=登录签发的 sessionToken（非口令）。在账号 doc.sessions 里命中 sha 且
// 未过期未停用 → 解析身份（同口令分支形状：超管 auth→agentId 'admin'·外包→_id）；否则 BAD_KEY /
// SESSION_EXPIRED / ACCOUNT_DISABLED（不放行）。账号 doc 个位数（bounded 扫描·不依赖数组嵌套查询语义），
// 令牌 sha 撞不上口令 keyHash，故只在口令全未命中后 fallback 到此。
async function resolveSession(db: any, hash: string) {
  const _ = db.command
  const s = await db
    .collection('adminConfig')
    .where({ sessions: _.exists(true) })
    .limit(50)
    .get()
    .catch(() => ({ data: [] }))
  const rows: any[] = (s && s.data) || []
  const a =
    rows.find(
      (acc) => Array.isArray(acc.sessions) && acc.sessions.some((x: any) => x && x.hash === hash)
    ) || null
  if (!a) return { ok: false as const, error: 'BAD_KEY' }
  if (a.disabled) return { ok: false as const, error: 'ACCOUNT_DISABLED' }
  const hit = a.sessions.find((x: any) => x && x.hash === hash)
  if (!hit || typeof hit.exp !== 'number' || hit.exp < Date.now())
    return { ok: false as const, error: 'SESSION_EXPIRED' }
  const isSuper = a._id === 'auth'
  return {
    ok: true as const,
    operator: a.name || (isSuper ? 'admin' : a._id),
    agentId: isSuper ? 'admin' : a._id,
    caps: a.role ? capsForRole(a.role) : Array.isArray(a.caps) ? a.caps : isSuper ? ['*'] : [],
  }
}

// 能力位（§1.5 RBAC·B5.2 多账号/角色）：caps 来源优先级 role 派生（ROLES 单源）＞显式 caps 字段＞回退 ['*']
// （向后兼容旧超管 'auth' doc·无 role/caps 字段·现网单超管不变）。disabled=账号开停（外包可停·B5.2）。
// operator＝真实操作者账号身份（B5.4·§1.5 可追溯）：随 caps 一起返回，供 adminApi 分发处贯入操作审计
// 留痕「谁查/改了谁」（多账号上线后不再糊成单口令 admin）；超管 doc 无 name 时回退 'admin'、外包回退其 _id。
export async function checkKey(db: any, key: any, bootstrap: boolean) {
  if (!key || String(key).length < 6) return { ok: false, error: 'KEY_TOO_SHORT' }
  await ensure(db, 'adminConfig')
  const keyStr = String(key)
  const got = await db
    .collection('adminConfig')
    .doc('auth')
    .get()
    .catch(() => null)
  if (!got || !got.data) {
    // 首登 bootstrap（债#15 关抢占）：无超管 doc 时·须 bootstrap + 部署密钥 ADMIN_BOOTSTRAP_KEY → 建首个超管。
    // 批6：bootstrap 建号即带盐（新写入一律 salt+scrypt·不再落无盐 sha）。
    const secret = process.env.ADMIN_BOOTSTRAP_KEY || ''
    if (!bootstrap || !secret || keyStr !== secret) return { ok: false, error: 'BAD_KEY' }
    const salt = newSalt()
    await db
      .collection('adminConfig')
      .add({
        data: {
          _id: 'auth',
          keySalt: salt,
          keyHash: kdf(keyStr, salt),
          role: 'superadmin',
          caps: ['*'],
          createdAt: Date.now(),
        },
      })
    return {
      ok: true,
      bootstrapped: true,
      caps: ['*'] as string[],
      operator: 'admin',
      agentId: 'admin',
    }
  }
  // ① 超管 'auth' doc 命中（盐感知比对·keyMatches 单源：有 keySalt 走 scrypt，legacy 无盐走 sha·
  // 向后兼容：无 role 取 caps 字段·旧 ['*']）。legacy 命中即 best-effort 就地升级为带盐（批6·存量账号
  // 无感迁移·升级失败 `.catch` 吞掉、不反噬本次登录——下次登录 legacy 分支仍能兜底）。
  if (keyMatches(got.data, keyStr)) {
    if (got.data.disabled) return { ok: false, error: 'ACCOUNT_DISABLED' }
    if (!got.data.keySalt) {
      const salt = newSalt()
      await db
        .collection('adminConfig')
        .doc('auth')
        .update({ data: { keySalt: salt, keyHash: kdf(keyStr, salt) } })
        .catch(() => {})
    }
    // 超管 agentId 固定 'admin'（商户本人·承面C 可 claim/setAgentStatus·稳定可读·§1.5）
    return {
      ok: true,
      operator: got.data.name || 'admin',
      agentId: 'admin',
      caps: got.data.role
        ? capsForRole(got.data.role)
        : Array.isArray(got.data.caps)
          ? got.data.caps
          : ['*'],
    }
  }
  // ② B5.2 多账号：非超管·有界扫描（手法同 resolveSession）按盐感知比对查 agent/外包 账号 doc
  // （均有 role；disabled 即停）。最坏 ≤50 行 scrypt 比对，登录端点已有频控、可接受。
  const _ = db.command
  const scan = await db
    .collection('adminConfig')
    .where({ keyHash: _.exists(true) })
    .limit(50)
    .get()
    .catch(() => ({ data: [] }))
  alertIfScanAtCap((scan && scan.data) || [], 50, 'checkKey')
  const acct =
    ((scan && scan.data) || []).find((r: any) => r._id !== 'auth' && keyMatches(r, keyStr)) || null
  if (!acct) return resolveSession(db, sha(keyStr)) // 口令全未命中 → fallback 会话令牌（口令登录/企微免登共用·深审 P1）
  if (acct.disabled) return { ok: false, error: 'ACCOUNT_DISABLED' }
  if (!acct.keySalt) {
    const salt = newSalt()
    await db
      .collection('adminConfig')
      .doc(acct._id)
      .update({ data: { keySalt: salt, keyHash: kdf(keyStr, salt) } })
      .catch(() => {})
  }
  // 外包/坐席 agentId＝账号 _id（承面C claim 绑定/分配 scope/agentState 键·§1.5·根因#3 取认证主体非前端）
  return {
    ok: true,
    operator: acct.name || acct._id,
    agentId: acct._id,
    caps: acct.role ? capsForRole(acct.role) : Array.isArray(acct.caps) ? acct.caps : [],
  }
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
          // VOD 转码产物（决策§31 批2·syncVodMedia 服务端回写；此处入白名单让 admin 草稿保存的
          // 往返不抹掉它们）。学员端不泄露：publicSegment/getCourses 逐层白名单不含这些字段，
          // 播放地址只经 getPlaybackUrl 鉴权后签名下发（守卫 rw-learning-golden 断言不漏）。
          vodUrl: str(sg?.vodUrl, 500),
          vodPoster: str(sg?.vodPoster, 500),
          vodSpriteVtt: str(sg?.vodSpriteVtt, 500),
        })),
      })),
    })),
    updatedAt: Date.now(),
  }
}

// base64 → 云存储 products/<pid>/，返回 fileID + 临时展示 URL
export async function storeImage(cloud: any, b64: string, data: any) {
  const ext = ['png', 'jpg', 'mp4', 'mov'].includes(data.ext) ? data.ext : 'jpg'
  // 消毒（深审 P3·同 getVideoUploadMeta）：客户端串直接拼云存储对象键，'../' 类字符不入路径
  const pid =
    String(data.pid || 'misc')
      .replace(/[^\w-]/g, '')
      .slice(0, 40) || 'misc'
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
