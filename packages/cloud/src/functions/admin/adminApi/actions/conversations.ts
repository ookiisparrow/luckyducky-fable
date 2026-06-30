import { reply, type Ctx } from '../lib'
import { pageQuery, COLLECTIONS } from '../../../../kit'

// 客服会话检索（后台360工作站 B5.1·板块#9·外包管控底座）：坐席按客户（openid / externalUserId）+ 渠道筛选 →
// cursor 翻页拉会话时间轴（归档单源 conversations·由 cs/kfCallback 落档）。供坐席查历史 + 质检取证（B5.3 依赖）。
//
// 越权读他人会话全文（§1.5·根因#3·同 360 读）：index.ts ACTION_CAPS['searchConversations']='customer:view' 能力闸
// + shouldAudit 默认留痕（search* 非 ^get·自动记「查了谁的会话」）——闸均在分发处收口（守卫 conversations-pii-gated），
// 本 action 只取参→分页→回结果、不自己碰审计/能力。
//
// bounded（守卫 conversations-search-bounded·根因#7）：一律经 kit pageQuery 游标分页（limit 钳 [1,200]·desc by at）——
// 杜绝裸 .get() 一次拉爆某客户长会话/全量会话拖垮工作台（同订单/评价分页·paging-contract）。
// keyword＝「当前页内」子串过滤（坐席沿时间轴翻页检索）；真全文检索须真 sdk db.RegExp + 索引（内存桩不复现·
// 根因#8 桩≠真）——故先页内过滤、不造不可测的全库模糊分支（防过度工程·留真机后升级）。
const DEFAULT_LIMIT = 30

export async function searchConversations({ db, data }: Ctx) {
  const d = data || {}
  // 客户范围（可选）：优先 openid（kfBind 绑定后稳定），否则 externalUserId；渠道可叠加（wxkf/未来承面C）。
  const openid = String(d.openid || '').trim()
  const externalUserId = String(d.externalUserId || '').trim()
  const channel = String(d.channel || '').trim()
  const filter: Record<string, any> = {}
  if (openid) filter.openid = openid
  else if (externalUserId) filter.externalUserId = externalUserId
  if (channel) filter.channel = channel
  // cursor 分页（bounded·d 携 cursor/limit）：按 at 倒序翻页，nextCursor 续取更早消息
  const paged = await pageQuery(db, COLLECTIONS.conversations, filter, 'at', d, DEFAULT_LIMIT)
  const keyword = String(d.keyword || '').trim().slice(0, 64)
  const rows = keyword ? paged.list.filter((m: any) => String(m.text || '').includes(keyword)) : paged.list
  const messages = rows.map((m: any) => ({
    id: m._id,
    channel: m.channel || '',
    direction: m.direction || '', // 'in'=客户·'out'=客服/机器人
    openid: m.openid || '',
    externalUserId: m.externalUserId || '',
    msgtype: m.msgtype || '',
    text: m.text || '',
    at: m.at || null,
  }))
  return reply(200, {
    ok: true,
    messages,
    count: messages.length,
    nextCursor: paged.nextCursor, // 续页游标（基于原始页·keyword 过滤不影响翻页继续找）
    hasMore: paged.hasMore,
  })
}
