import { createHash, createHmac, randomBytes } from 'crypto'
import https from 'https'
import { getSecureConfigFields } from './secureConfig'
import { alert } from './observe'

// ────────────────────────────────────────────────────────────────────────────
// 腾讯云点播（VOD）平台接缝单点（根因#12·决策§31 转码管线批1·镜像 kit/flow.ts 之于支付工作流）：
// 与 VOD 的全部平台触点——Key 防盗链签名算法、（批2 起）服务端 API 域名与 TC3 签名——收口本文件，
// 平台规则单方变化只改这一点。配置单源 DB secureConfig/vod（admin /config-checklist 填即生效，
// kit/secureConfig.ts 读取；字段 secretId/secretKey/playKey/procedure——批1 只用 playKey）。
// 守卫：rw-vod-seam-single（接缝单点+前缀分流）/ rw-vod-sign-fail-closed（签名 fail-closed）。
// ────────────────────────────────────────────────────────────────────────────

// FileId 判据单源在 @ldrw/shared（批2 提升：admin「转码中」显示与云端分流同判据·病根#5），此处再导出
// 保持 kit 调用面不变（learning.ts / cleanupEvents 均经 kit 取用）。
export { isVodFileId } from '@ldrw/shared'

// 签名有效期 6h：显式覆盖「mp 端 25min 地址缓存 TTL（rewrite/mp/lib/player.ts createPlaybackCache）
// + 最长课时 + 余量」——短于缓存 TTL 会让缓存命中返回已过期签名（分片 403 只能靠失速兜底恢复）；
// 仍 < 发布 GC 24h 缓期（adminApi/actions/courses.ts GC_GRACE_MS），换源删除时在播学员手里的签名
// 不会晚于缓期还活着。
const SIGN_TTL_SEC = 6 * 3600

/**
 * Key 防盗链签名播放地址（官方算法 cloud.tencent.com/document/product/266/14047）：
 * sign = md5(KEY + Dir + t + exper + rlimit + us)；本实现不用试看 exper / IP 上限 rlimit（拼接处为
 * 空串、URL 不携带该参），t = 过期时刻十六进制 Unix 秒，us = 随机 nonce。纯本地计算、零网络往返。
 * fail-closed（病根#1/#14）：playKey 未配置 → 告警 VOD_KEY_MISSING + 返回 null——绝不裸发未签名
 * 地址（防盗链已开则裸地址必 403；未开则付费内容裸奔，两头都不该发）；vodUrl 形态异常同口径。
 */
export async function signVodPlayUrl(db: any, rawUrl: string) {
  if (!rawUrl) return null
  const { playKey } = await getSecureConfigFields(db, 'vod', ['playKey'])
  if (!playKey) {
    alert('security', 'vod', 'VOD_KEY_MISSING', { url: String(rawUrl).slice(0, 80) })
    return null
  }
  let dir = ''
  try {
    const path = new URL(rawUrl).pathname
    dir = path.slice(0, path.lastIndexOf('/') + 1)
  } catch {
    alert('security', 'vod', 'VOD_BAD_URL', { url: String(rawUrl).slice(0, 80) })
    return null
  }
  const t = Math.floor(Date.now() / 1000 + SIGN_TTL_SEC).toString(16)
  const us = randomBytes(4).toString('hex')
  const sign = createHash('md5')
    .update(playKey + dir + t + us)
    .digest('hex')
  return `${rawUrl}?t=${t}&us=${us}&sign=${sign}`
}

// ── 批2：上传签名 + 服务端 API（决策§31 转码管线批2）─────────────────────────

// 最小 fetch 形状 + https 兜底（照抄 kit/wecom.ts 口径：测试经 globalThis.fetch 桩、运行时无全局 fetch 走 https）
type FetchFn = (url: string, init?: { method?: string; body?: string; headers?: Record<string, string> }) => Promise<{ json: () => Promise<any> }>
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
const doFetch: FetchFn = (url, init) =>
  typeof (globalThis as any).fetch === 'function' ? (globalThis as any).fetch(url, init) : httpsFetch(url, init)

/**
 * UGC 客户端上传签名（官方 266/9221·纯本地 HMAC-SHA1，不调任何 API）：admin 浏览器 vod-js-sdk-v6
 * 直传 VOD 用。procedure（任务流模板名·secureConfig/vod.procedure）随签名下发——上传完成即自动
 * 触发转码+截图任务流，无需服务端再调 ProcessMedia。有效期 2h（批量百段的上传会话窗足够；admin
 * 侧另有 5min 签名缓存）。未配置（secretId/secretKey 空）返回 null——调用方回 VOD_NOT_CONFIGURED，
 * admin 借此回退云存储直传老路（迁移期不断档），不告警（未配置是预期中的过渡态，非故障）。
 */
export async function makeVodUploadSignature(db: any) {
  const { secretId, secretKey, procedure } = await getSecureConfigFields(db, 'vod', ['secretId', 'secretKey', 'procedure'])
  if (!secretId || !secretKey) return null
  const now = Math.floor(Date.now() / 1000)
  const p = new URLSearchParams({
    secretId,
    currentTimeStamp: String(now),
    expireTime: String(now + 2 * 3600),
    random: String(Math.floor(Math.random() * 0x7fffffff)),
  })
  if (procedure) p.set('procedure', procedure)
  const orig = p.toString()
  const mac = createHmac('sha1', secretKey).update(orig).digest()
  return Buffer.concat([mac, Buffer.from(orig)]).toString('base64')
}

const sha256hex = (s: string) => createHash('sha256').update(s).digest('hex')
const hmac256 = (key: Buffer | string, s: string) => createHmac('sha256', key).update(s).digest()

/**
 * VOD 服务端 API 单点（TC3-HMAC-SHA256 手签·官方签名方法 v3；不引 tencentcloud-sdk（几 MB 包体
 * 只为两个调用不值当·云函数包越小冷启动越快））。批2 调用面：DescribeMediaInfos（转码状态同步）、
 * DeleteMedia（GC 删除）。注意：函数运行时临时密钥（TENCENTCLOUD_SECRETID）权限域限云开发资源、
 * 签不了 VOD——须 secureConfig/vod 独立密钥（控制台子账号·仅授 VOD 权限）。
 * 返回 Response 对象（语义错误时含 .Error{Code,Message}，调用方按需分辨——如 GC 把 ResourceNotFound
 * 视作删除成功）；传输/配置失败返回 null。两类失败均已告警（病根#14 动作类失败禁静默）。
 */
export async function callVodApi(db: any, action: string, payload: Record<string, unknown>) {
  const { secretId, secretKey } = await getSecureConfigFields(db, 'vod', ['secretId', 'secretKey'])
  if (!secretId || !secretKey) {
    alert('anomaly', 'vod', 'VOD_NOT_CONFIGURED', { action })
    return null
  }
  const host = 'vod.tencentcloudapi.com'
  const service = 'vod'
  const timestamp = Math.floor(Date.now() / 1000)
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10)
  const body = JSON.stringify(payload || {})
  // TC3 规范拼接（2026-07-24 修：官方规范=六段以 \n 相接，CanonicalHeaders 段自身以 \n 结尾，
  // 两者叠加后 host 行与 SignedHeaders 之间必须有一个空行——官方文档示例串可证。原实现少这个 \n，
  // 任何真实调用必 AuthFailure.SignatureFailure（变异分诊立案实锤·真机验签随 VOD E2E 待办）
  const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${host}\n`
  const canonical = `POST\n/\n\n${canonicalHeaders}\ncontent-type;host\n${sha256hex(body)}`
  const scope = `${date}/${service}/tc3_request`
  const stringToSign = `TC3-HMAC-SHA256\n${timestamp}\n${scope}\n${sha256hex(canonical)}`
  const kSigning = hmac256(hmac256(hmac256(Buffer.from('TC3' + secretKey), date), service), 'tc3_request')
  const signature = hmac256(kSigning, stringToSign).toString('hex')
  const auth = `TC3-HMAC-SHA256 Credential=${secretId}/${scope}, SignedHeaders=content-type;host, Signature=${signature}`
  try {
    const res = await doFetch(`https://${host}`, {
      method: 'POST',
      body,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Host: host,
        Authorization: auth,
        'X-TC-Action': action,
        'X-TC-Version': '2018-07-17',
        'X-TC-Timestamp': String(timestamp),
      },
    })
    const json = await res.json()
    const resp = json && json.Response
    if (!resp || resp.Error) alert('anomaly', 'vod', 'VOD_API_ERROR', { action, code: (resp && resp.Error && resp.Error.Code) || 'NO_RESPONSE' })
    return resp || null
  } catch (e) {
    alert('anomaly', 'vod', 'VOD_API_FAIL', { action, error: String(e instanceof Error ? e.message : e).slice(0, 200) })
    return null
  }
}
