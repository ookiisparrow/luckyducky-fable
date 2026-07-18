import { createHash, randomBytes } from 'crypto'
import { getSecureConfigFields } from './secureConfig'
import { alert } from './observe'

// ────────────────────────────────────────────────────────────────────────────
// 腾讯云点播（VOD）平台接缝单点（根因#12·决策§29 转码管线批1·镜像 kit/flow.ts 之于支付工作流）：
// 与 VOD 的全部平台触点——Key 防盗链签名算法、（批2 起）服务端 API 域名与 TC3 签名——收口本文件，
// 平台规则单方变化只改这一点。配置单源 DB secureConfig/vod（admin /config-checklist 填即生效，
// kit/secureConfig.ts 读取；字段 secretId/secretKey/playKey/procedure——批1 只用 playKey）。
// 守卫：rw-vod-seam-single（接缝单点+前缀分流）/ rw-vod-sign-fail-closed（签名 fail-closed）。
// ────────────────────────────────────────────────────────────────────────────

/** VOD FileId（纯数字长串，如 5285890784246869296）vs 云开发 fileID（cloud:// 前缀）——
 *  getPlaybackUrl 播放与 GC 删除按此分流新旧双线（存量 cloud:// 课程与新转码课程混跑零停机）。 */
export const isVodFileId = (id: string): boolean => /^\d{8,32}$/.test(id)

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
