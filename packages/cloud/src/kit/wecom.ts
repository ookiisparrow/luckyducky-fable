import crypto from 'crypto'
import https from 'https'
import { getDb } from './db'
import { COLLECTIONS } from './collections'
import { alert } from './observe'

/**
 * 企业微信「微信客服」平台接缝（根因#12 平台规则外部风险：与企业微信的接缝收口一处）。
 * 收编三块：① 回调验签 + AES 解密（WXBizMsgCrypt·根因#3 fail-closed 由 defineKfCallback 强制）
 * ② access_token 取用 + 缓存（DB·类比 kit/throttle 的 DB 模式·7200s）③ 客服 API 调用
 * （sync_msg / send_msg / unionid→external_userid 身份转换）。消费者：cs/kfCallback、cs/kfBind。
 *
 * 出网用全局 fetch（node18+ 自带），运行时低于 18 回退内置 https（杜绝「Node<18 下 fetch undefined」——
 * 验签只做加密会照样过、真消息进来调 access_token 才崩的根因#8 隐患）；fetchImpl 可注入便于单测打桩。
 * 密钥一律走云函数环境变量（corpid/secret/token/aeskey），不入库不入日志（CLAUDE §7 敏感信息不进日志）。
 */

const QY = 'https://qyapi.weixin.qq.com/cgi-bin'

// 最小 fetch 形状（不依赖 DOM lib·tsconfig types 只含 node）
type FetchFn = (url: string, init?: { method?: string; body?: string; headers?: Record<string, string> }) => Promise<{ json: () => Promise<any> }>

// 内置 https 兜底（运行时无全局 fetch 时用·形状对齐上面 FetchFn 的 .json()）
const httpsFetch: FetchFn = (url, init) =>
  new Promise((resolve, reject) => {
    const u = new URL(url)
    const req = https.request(
      { method: init?.method || 'GET', hostname: u.hostname, path: u.pathname + u.search, headers: init?.headers },
      (res) => {
        let body = ''
        res.on('data', (c) => (body += c))
        res.on('end', () => resolve({ json: async () => JSON.parse(body || '{}') }))
      }
    )
    req.on('error', reject)
    if (init?.body) req.write(init.body)
    req.end()
  })

const defaultFetch: FetchFn = (url, init) =>
  typeof (globalThis as any).fetch === 'function' ? (globalThis as any).fetch(url, init) : httpsFetch(url, init)

// ───────────────────────── 验签 + 解密（WXBizMsgCrypt） ─────────────────────────

/** msg_signature = sha1(sort(token, timestamp, nonce, encrypt))。企业微信回调验签算法。 */
export function kfSignature(token: string, timestamp: string, nonce: string, encrypt: string): string {
  const arr = [token, timestamp, nonce, encrypt].sort()
  return crypto.createHash('sha1').update(arr.join('')).digest('hex')
}

/** 验签（根因#3）：签名不符即不可信。常量时间比较防时序侧信道。 */
export function verifyKfSignature(
  token: string,
  timestamp: string,
  nonce: string,
  encrypt: string,
  signature: string
): boolean {
  const expect = kfSignature(token, timestamp, nonce, encrypt)
  const a = Buffer.from(expect)
  const b = Buffer.from(String(signature || ''))
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

/** EncodingAESKey(43 字符) → 32 字节 AES key。 */
function aesKeyOf(encodingAESKey: string): Buffer {
  return Buffer.from(encodingAESKey + '=', 'base64')
}

/**
 * AES-256-CBC 解密回调密文（WXBizMsgCrypt 格式）：
 * 明文 = random(16) | msgLen(4·网络序) | msg(msgLen) | receiveId。去 PKCS7 padding。
 * 返回 { message, receiveId }；receiveId 应等于自己的 corpid（调用方可校验）。
 */
export function decryptKfMessage(encodingAESKey: string, encrypted: string): { message: string; receiveId: string } {
  const key = aesKeyOf(encodingAESKey)
  const iv = key.subarray(0, 16)
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv)
  decipher.setAutoPadding(false)
  const buf = Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64')), decipher.final()])
  // 去 PKCS7：末字节 = padding 长度（WXBizMsgCrypt 块 32）。边界纵深（审计 P1）：验签虽在前，仍兜
  // 非法 pad/msgLen 即抛、不返回错位切片——防签名异常路径吐出越界数据（调用方 try/catch 转告警）。
  const pad = buf[buf.length - 1]
  if (!(pad >= 1 && pad <= 32) || pad > buf.length) throw new Error('BAD_PADDING')
  const data = buf.subarray(16, buf.length - pad) // 去前 16 字节随机 + 尾 padding
  if (data.length < 4) throw new Error('BAD_PLAINTEXT')
  const msgLen = data.readUInt32BE(0)
  if (msgLen < 0 || 4 + msgLen > data.length) throw new Error('BAD_MSGLEN')
  const message = data.subarray(4, 4 + msgLen).toString('utf8')
  const receiveId = data.subarray(4 + msgLen).toString('utf8')
  return { message, receiveId }
}

// 从回调密文事件 XML 里抽字段（不引 XML 库·只取需要的标签）
function xmlTag(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`))
  return m ? m[1] : ''
}

export interface KfTrustedEvent {
  /** 客服事件里的 Token，调 sync_msg 拉消息用（与回调验签的 token 不是一回事）。 */
  syncToken: string
  /** 指定客服帐号 open_kfid。 */
  openKfId: string
  /** 解密后的原始 XML（兜底/排查用）。 */
  raw: string
}

/** HTTP 访问服务统一响应（纯文本 body·企业微信 GET 验 URL 要回明文 echostr）。 */
const httpReply = (statusCode: number, body: string) => ({
  statusCode,
  headers: { 'Content-Type': 'text/plain' },
  body,
})

function readQuery(event: any): Record<string, string> {
  return event.queryStringParameters || event.queryString || event.query || {}
}
function readBody(event: any): string {
  const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString() : event.body
  return raw || ''
}

/**
 * 客服回调外壳（根因#3 fail-closed by construction·类比 defineNotifyCallback）：
 * GET 验 URL（验签 → 解密 echostr → 回明文）；POST 收事件（验签 → 解密 → 解析 → onEvent）。
 * 验签不过 = 不可信：GET 回空、POST 回空 + 告警，**绝不调 onEvent**（防伪不给处理通道）。
 * 任何客服回调经此外壳才写得出业务，杜绝「忘记验签」。token/aesKey 由调用方从 env 注入（懒读便于测试）。
 */
export function defineKfCallback(opts: {
  token: () => string
  aesKey: () => string
  /** 自己的 corpid（企业内部单 corp）：解密后 receiveId 须等于它，否则拒（WXBizMsgCrypt 验签三要素之一·
   * 防跨 corp 共享 key 的合法签名消息被本应用处理）。未配置（空）时跳过校验，配齐即 fail-closed。 */
  corpid?: () => string
  onEvent: (e: KfTrustedEvent) => Promise<void>
}) {
  // receiveId 绑定校验：配了 corpid 才生效（配置就绪即 fail-closed·未配不阻断现网）
  const receiveIdOk = (receiveId: string): boolean => {
    const want = opts.corpid ? opts.corpid() : ''
    return !want || receiveId === want
  }
  return async (event: any) => {
    const token = opts.token()
    const aesKey = opts.aesKey()
    const q = readQuery(event)
    const method = String(event.httpMethod || 'POST').toUpperCase()

    if (method === 'GET') {
      // URL 验证：echostr 是密文，验签后解密回明文
      const { msg_signature, timestamp, nonce, echostr } = q
      if (!token || !aesKey || !verifyKfSignature(token, timestamp, nonce, echostr, msg_signature)) {
        return httpReply(200, '') // 验签不过：回空（多为配置期口令不符，非运行时探测）
      }
      try {
        const dec = decryptKfMessage(aesKey, echostr)
        if (!receiveIdOk(dec.receiveId)) return httpReply(200, '') // receiveId 非本 corp：验 URL 失败
        return httpReply(200, dec.message)
      } catch {
        return httpReply(200, '')
      }
    }

    // POST：事件密文在 body 的 <Encrypt> 里；验签覆盖该密文
    const body = readBody(event)
    const encrypt = xmlTag(body, 'Encrypt')
    const { msg_signature, timestamp, nonce } = q
    if (!token || !aesKey || !encrypt || !verifyKfSignature(token, timestamp, nonce, encrypt, msg_signature)) {
      // 运行时验签不过 = 伪造/探测（根因#3 全场最关键）：静默回空 + 告警，不进 onEvent
      alert('security', 'kfCallback', 'FORGED_CALLBACK', {})
      return httpReply(200, '')
    }
    let dec: { message: string; receiveId: string }
    try {
      dec = decryptKfMessage(aesKey, encrypt)
    } catch {
      alert('security', 'kfCallback', 'DECRYPT_FAILED', {})
      return httpReply(200, '')
    }
    // receiveId 须本 corp（验签三要素之三）：跨 corp 合法签名消息也拒，不进 onEvent（审计 P1·根因#3）
    if (!receiveIdOk(dec.receiveId)) {
      alert('security', 'kfCallback', 'RECEIVEID_MISMATCH', {})
      return httpReply(200, '')
    }
    const xml = dec.message
    await opts.onEvent({ syncToken: xmlTag(xml, 'Token'), openKfId: xmlTag(xml, 'OpenKfId'), raw: xml })
    return httpReply(200, '') // 客服回调回空即可，消息经 send API 异步推送
  }
}

// ───────────────────────── access_token（DB 缓存·7200s） ─────────────────────────

const TOKEN_ID = 'token'
const TOKEN_SKEW_MS = 5 * 60_000 // 提前 5 分钟视为过期，避免边界用到将失效 token

/**
 * 取 access_token：DB 缓存未过期直接用，否则用微信客服 Secret 重新 gettoken 并回写缓存。
 * best-effort 缓存：写缓存失败不阻断（下次再取）。token 不进日志。
 */
export async function getAccessToken(
  cfg: { corpid: string; secret: string },
  fetchImpl: FetchFn = defaultFetch
): Promise<string> {
  const db = getDb()
  const now = Date.now()
  const got = await db.collection(COLLECTIONS.kfState).doc(TOKEN_ID).get().catch(() => null)
  const rec = got && got.data ? got.data : null
  if (rec && typeof rec.expireAt === 'number' && rec.expireAt - TOKEN_SKEW_MS > now && rec.accessToken) {
    return rec.accessToken as string
  }
  const r = await fetchImpl(`${QY}/gettoken?corpid=${encodeURIComponent(cfg.corpid)}&corpsecret=${encodeURIComponent(cfg.secret)}`)
  const j = await r.json()
  if (j.errcode || !j.access_token) {
    alert('security', 'wecom', 'GETTOKEN_FAILED', { errcode: j.errcode })
    throw new Error('GETTOKEN_FAILED:' + j.errcode)
  }
  const expireAt = now + (Number(j.expires_in) || 7200) * 1000
  await db
    .collection(COLLECTIONS.kfState)
    .doc(TOKEN_ID)
    .set({ data: { _id: TOKEN_ID, accessToken: j.access_token, expireAt, updatedAt: now } })
    .catch(() => {})
  return j.access_token as string
}

// ───────────────────────── 客服 API（sync_msg / send_msg / idconvert） ─────────────────────────

async function post(path: string, accessToken: string, payload: any, fetchImpl: FetchFn): Promise<any> {
  const r = await fetchImpl(`${QY}/${path}?access_token=${encodeURIComponent(accessToken)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return r.json()
}

/** 拉取客服消息：传上次 cursor（首次空）+ 事件里的 syncToken；返回 { next_cursor, has_more, msg_list }。 */
export async function syncMsg(
  accessToken: string,
  args: { cursor?: string; token: string; openKfId?: string; limit?: number },
  fetchImpl: FetchFn = defaultFetch
): Promise<{ next_cursor: string; has_more: number; msg_list: any[]; errcode?: number }> {
  const j = await post(
    'kf/sync_msg',
    accessToken,
    { cursor: args.cursor || '', token: args.token, limit: args.limit || 1000, open_kfid: args.openKfId },
    fetchImpl
  )
  return { next_cursor: j.next_cursor || '', has_more: Number(j.has_more) || 0, msg_list: j.msg_list || [], errcode: j.errcode }
}

/** 发客服消息（msgmenu / miniprogram / text…）：payload 须含 touser + open_kfid + msgtype + 对应体。 */
export async function sendMsg(accessToken: string, payload: any, fetchImpl: FetchFn = defaultFetch): Promise<any> {
  return post('kf/send_msg', accessToken, payload, fetchImpl)
}

/**
 * 转人工（同会话转接待人员·item 6）：把会话服务状态置 3（人工接待）并指定 servicer。
 * 超范围/拿不准/承诺（退款金额/特批/赔偿）一律转人工，机器人不拍板。
 */
export async function transferToServicer(
  accessToken: string,
  args: { openKfId: string; externalUserId: string; servicerUserId: string },
  fetchImpl: FetchFn = defaultFetch
): Promise<any> {
  return post(
    'kf/service_state/trans',
    accessToken,
    { open_kfid: args.openKfId, external_userid: args.externalUserId, service_state: 3, servicer_userid: args.servicerUserId },
    fetchImpl
  )
}

/**
 * unionid → external_userid 转换（身份桥接·限频：5万/时·24万/天·禁批量·须用户主动触发）。
 * openid 用于绑定主体确认（同一微信开放平台主体下小程序 openid）。返回 external_userid 或 ''。
 */
export async function unionidToExternalUserid(
  accessToken: string,
  unionid: string,
  openid: string,
  fetchImpl: FetchFn = defaultFetch
): Promise<string> {
  const j = await post('idconvert/unionid_to_external_userid', accessToken, { unionid, openid }, fetchImpl)
  if (j.errcode) {
    alert('security', 'wecom', 'IDCONVERT_FAILED', { errcode: j.errcode })
    return ''
  }
  return j.external_userid || ''
}
