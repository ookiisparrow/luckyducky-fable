import { describe, it, expect, beforeEach } from 'vitest'
import { createHash } from 'node:crypto'
import cloud, { control } from 'wx-server-sdk'
import { archiveInbound, archiveOutbound, incomingText, payloadText } from '../../packages/cloud/src/functions/cs/kfCallback/archive'
import { searchConversations, conversationsReport } from '../../packages/cloud/src/functions/admin/adminApi/actions/conversations'
import { shouldAudit } from '../../packages/cloud/src/kit/audit'
import { main } from '../../packages/cloud/src/functions/admin/adminApi'

// 后台360工作站 B5.1：客服会话归档 + 检索（板块#9·外包管控底座·车道 E）。
// 归档：入站客户消息/出站回复落 conversations（确定性 _id 幂等·resolve openid·fail-soft）；
// 检索：cursor 分页 bounded + keyword 页内过滤 + §1.5 越权读能力闸 + 留痕。
const db = cloud.database()
const ctx = (data) => ({ db, cloud, data, drafts: {} })
const parse = (res) => JSON.parse(res.body)
const sha = (s) => createHash('sha256').update(String(s)).digest('hex')
const KEY = 'test-admin-key-123'
const call = (action, key, data = {}) =>
  main({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ action, key, data }) }).then((res) => ({
    status: res.statusCode,
    ...JSON.parse(res.body),
  }))

beforeEach(() => control.reset())

describe('会话归档 archiveInbound（B5.1·确定性 _id 幂等·resolve openid·fail-soft）', () => {
  it('入站客户文本：落档 direction=in·_id=wxkf:in:<msgid>·resolve openid·at=send_time*1000', async () => {
    control.seed('kfIdentity', [{ _id: 'ext:wmAAA', openid: 'openidA' }])
    await archiveInbound(db, { msgid: 'm1', msgtype: 'text', external_userid: 'wmAAA', text: { content: '我的订单到哪了' }, send_time: 1700 }, 'kf1')
    const rows = control.dump('conversations')
    expect(rows.length).toBe(1)
    const d = rows[0]
    expect(d._id).toBe('wxkf:in:m1')
    expect(d.direction).toBe('in')
    expect(d.channel).toBe('wxkf')
    expect(d.externalUserId).toBe('wmAAA')
    expect(d.openid).toBe('openidA') // 经 kfIdentity 桥接（不信前端·根因#3）
    expect(d.text).toBe('我的订单到哪了')
    expect(d.at).toBe(1700 * 1000) // send_time 秒→毫秒
    expect(d.openKfId).toBe('kf1')
  })

  it('幂等：同 msgid 重投只一档（确定性 _id 撞号即 no-op·同 seen 去重）', async () => {
    const msg = { msgid: 'm1', msgtype: 'text', external_userid: 'wmAAA', text: { content: 'hi' } }
    await archiveInbound(db, msg, 'kf1')
    await archiveInbound(db, msg, 'kf1') // 重拉重投
    expect(control.dump('conversations').length).toBe(1)
  })

  it('无 msgid（事件/无幂等键）不归档', async () => {
    await archiveInbound(db, { msgtype: 'event', event: { event_type: 'enter_session', external_userid: 'wmAAA' } }, 'kf1')
    expect(control.dump('conversations').length).toBe(0)
  })

  it('未绑定 openid（无 kfIdentity）：仍落档·openid 空（按 externalUserId 仍可检索·best-effort）', async () => {
    await archiveInbound(db, { msgid: 'm9', msgtype: 'text', external_userid: 'wmZZZ', text: { content: 'x' } }, 'kf1')
    const d = control.dump('conversations')[0]
    expect(d.openid).toBe('')
    expect(d.externalUserId).toBe('wmZZZ')
  })

  it('fail-soft：归档绝不抛错（即使入参畸形也不反噬消息处理）', async () => {
    await expect(archiveInbound(db, null, 'kf1')).resolves.toBeUndefined()
    await expect(archiveInbound(db, { msgid: 'm1' }, 'kf1')).resolves.toBeUndefined()
  })
})

describe('会话归档 archiveOutbound（B5.1·出站回复落档·resolve openid·文本提取）', () => {
  it('出站文本：direction=out·resolve openid by touser·text 取 content', async () => {
    control.seed('kfIdentity', [{ _id: 'ext:wmAAA', openid: 'openidA' }])
    await archiveOutbound(db, { touser: 'wmAAA', open_kfid: 'kf1', msgtype: 'text', text: { content: '现货 48 小时内发货' } }, 'kf1')
    const d = control.dump('conversations')[0]
    expect(d.direction).toBe('out')
    expect(d.openid).toBe('openidA')
    expect(d.externalUserId).toBe('wmAAA')
    expect(d.text).toBe('现货 48 小时内发货')
  })

  it('出站菜单/卡片：文本可检索（msgmenu head+选项 / miniprogram 标题）', async () => {
    await archiveOutbound(db, { touser: 'wmAAA', msgtype: 'msgmenu', msgmenu: { head_content: '想咨询什么', list: [{ click: { content: '查订单' } }, { click: { content: '转人工' } }] } }, 'kf1')
    await archiveOutbound(db, { touser: 'wmAAA', msgtype: 'miniprogram', miniprogram: { title: '我的课程' } }, 'kf1')
    const texts = control.dump('conversations').map((d) => d.text)
    expect(texts).toContain('想咨询什么 / 查订单 / 转人工')
    expect(texts).toContain('[小程序卡片] 我的课程')
  })

  it('fail-soft：出站归档绝不抛错', async () => {
    await expect(archiveOutbound(db, null, 'kf1')).resolves.toBeUndefined()
  })
})

describe('纯函数 incomingText / payloadText', () => {
  it('incomingText：文本取 content·非文本回占位', () => {
    expect(incomingText({ msgtype: 'text', text: { content: '退款' } })).toBe('退款')
    expect(incomingText({ msgtype: 'image' })).toBe('[image]')
  })
  it('payloadText：text/msgmenu/miniprogram 各取人话', () => {
    expect(payloadText({ msgtype: 'text', text: { content: 'a' } })).toBe('a')
    expect(payloadText({ msgtype: 'miniprogram', miniprogram: { title: 'b' } })).toBe('[小程序卡片] b')
  })
})

describe('会话检索 searchConversations（B5.1·cursor 分页 bounded + keyword 页内过滤）', () => {
  beforeEach(() => {
    control.seed('conversations', [
      { _id: 'c1', channel: 'wxkf', direction: 'in', openid: 'A', externalUserId: 'wmA', msgtype: 'text', text: '物流到哪了', at: 1000 },
      { _id: 'c2', channel: 'wxkf', direction: 'out', openid: 'A', externalUserId: 'wmA', msgtype: 'text', text: '48 小时内发货', at: 2000 },
      { _id: 'c3', channel: 'wxkf', direction: 'in', openid: 'A', externalUserId: 'wmA', msgtype: 'text', text: '想退款', at: 3000 },
      { _id: 'c4', channel: 'wxkf', direction: 'in', openid: 'B', externalUserId: 'wmB', msgtype: 'text', text: '别人的会话', at: 5000 },
    ])
  })

  it('按 openid：只返该客户会话·按 at 倒序（最新在前）', async () => {
    const r = parse(await searchConversations(ctx({ openid: 'A' })))
    expect(r.ok).toBe(true)
    expect(r.messages.map((m) => m.id)).toEqual(['c3', 'c2', 'c1']) // at desc·不含 B 的 c4
    expect(r.messages[0].direction).toBe('in')
  })

  it('cursor 分页有界（limit + nextCursor + hasMore·续页接上·paging-contract）', async () => {
    const p1 = parse(await searchConversations(ctx({ openid: 'A', limit: 2 })))
    expect(p1.messages.map((m) => m.id)).toEqual(['c3', 'c2'])
    expect(p1.hasMore).toBe(true)
    expect(p1.nextCursor).toBe(2000)
    const p2 = parse(await searchConversations(ctx({ openid: 'A', limit: 2, cursor: p1.nextCursor })))
    expect(p2.messages.map((m) => m.id)).toEqual(['c1'])
    expect(p2.hasMore).toBe(false)
  })

  it('keyword 页内子串过滤（命中 text）', async () => {
    const r = parse(await searchConversations(ctx({ openid: 'A', keyword: '退款' })))
    expect(r.messages.map((m) => m.id)).toEqual(['c3'])
  })

  it('按 externalUserId（未绑定 openid 时仍可检索）', async () => {
    const r = parse(await searchConversations(ctx({ externalUserId: 'wmB' })))
    expect(r.messages.map((m) => m.id)).toEqual(['c4'])
  })

  it('channel 可叠加筛选', async () => {
    const r = parse(await searchConversations(ctx({ openid: 'A', channel: 'wxkf' })))
    expect(r.count).toBe(3)
    const none = parse(await searchConversations(ctx({ openid: 'A', channel: 'faceC' })))
    expect(none.count).toBe(0)
  })

  it('无匹配 → 空列表（不报错）', async () => {
    const r = parse(await searchConversations(ctx({ openid: 'nobody' })))
    expect(r.ok).toBe(true)
    expect(r.count).toBe(0)
  })
})

describe('§1.5 信任边界：searchConversations＝越权读他人会话（B5.1·根因#3）', () => {
  it('conversations-pii-gated：无 customer:view 能力 → 403 FORBIDDEN', async () => {
    control.seed('adminConfig', [{ _id: 'auth', keyHash: sha(KEY), caps: ['products:edit'] }])
    const r = await call('searchConversations', KEY, { openid: 'A' })
    expect(r.status).toBe(403)
    expect(r.error).toBe('FORBIDDEN')
  })

  it('超管 caps=[*] 过闸（200·读到结果）', async () => {
    control.seed('adminConfig', [{ _id: 'auth', keyHash: sha(KEY), caps: ['*'] }])
    control.seed('conversations', [{ _id: 'c1', channel: 'wxkf', direction: 'in', openid: 'A', text: 'hi', at: 1 }])
    const r = await call('searchConversations', KEY, { openid: 'A' })
    expect(r.status).toBe(200)
    expect(r.ok).toBe(true)
  })

  it('审计：shouldAudit 默认覆盖 searchConversations（search* 非 ^get·自动留痕）', () => {
    expect(shouldAudit('searchConversations')).toBe(true)
  })

  it('经 main 分发留痕 auditLog（查了谁的会话·防 PII 0 痕）', async () => {
    control.seed('adminConfig', [{ _id: 'auth', keyHash: sha(KEY), caps: ['*'] }])
    await call('searchConversations', KEY, { openid: 'A' })
    const log = await db.collection('auditLog').where({ action: 'searchConversations' }).get()
    expect(log.data.length).toBeGreaterThanOrEqual(1)
    expect(log.data[0].summary.openid).toBe('A') // 留痕查了谁
  })
})

// ── B5.3 质检报表 + SLA（板块#11·依赖归档·bounded 聚合）──
describe('会话质检报表 conversationsReport（B5.3·会话量/首响/SLA/答复率）', () => {
  beforeEach(() => {
    control.seed('conversations', [
      // 客户 A：两轮·各有回复（首响 300/500ms）
      { _id: 'a1', channel: 'wxkf', direction: 'in', externalUserId: 'wmA', openid: 'A', text: 'q1', at: 1000 },
      { _id: 'a2', channel: 'wxkf', direction: 'out', externalUserId: 'wmA', openid: 'A', text: 'r1', at: 1300 },
      { _id: 'a3', channel: 'wxkf', direction: 'in', externalUserId: 'wmA', openid: 'A', text: 'q2', at: 2000 },
      { _id: 'a4', channel: 'wxkf', direction: 'out', externalUserId: 'wmA', openid: 'A', text: 'r2', at: 2500 },
      // 客户 B：一条入站·无回复（未答复）
      { _id: 'b1', channel: 'wxkf', direction: 'in', externalUserId: 'wmB', openid: 'B', text: 'q', at: 5000 },
    ])
  })

  it('会话量：消息/入站/出站/客户数', async () => {
    const r = parse(await conversationsReport(ctx({})))
    expect(r.ok).toBe(true)
    expect(r.volume).toEqual({ messages: 5, inbound: 3, outbound: 2, customers: 2 })
  })

  it('首次响应：入站→其后首个出站配对·avg/max·未答复计入', async () => {
    const r = parse(await conversationsReport(ctx({})))
    expect(r.response.answered).toBe(2) // 300 + 500
    expect(r.response.avgResponseMs).toBe(400)
    expect(r.response.maxResponseMs).toBe(500)
    expect(r.response.unanswered).toBe(1) // 客户 B 无回复
    expect(r.response.answeredRate).toBe(66.7) // 2/3
  })

  it('SLA：slaMs 阈值下超时数 + 占比（首响 500 > 400ms 阈→1 违约）', async () => {
    const r = parse(await conversationsReport(ctx({ slaMs: 400 })))
    expect(r.slaMs).toBe(400)
    expect(r.sla.breaches).toBe(1) // 仅 500ms 那条超 400
    expect(r.sla.breachRate).toBe(50) // 1/2 已答复
    expect(r.sla.unanswered).toBe(1)
  })

  it('channel 筛选：非 wxkf 渠道无数据 → 全 0（不报错）', async () => {
    const r = parse(await conversationsReport(ctx({ channel: 'faceC' })))
    expect(r.volume.messages).toBe(0)
    expect(r.response.avgResponseMs).toBe(0)
    expect(r.response.answeredRate).toBe(0)
  })

  it('bounded：sampleSize 反映样本量·approx 触顶才 true（本例未触顶）', async () => {
    const r = parse(await conversationsReport(ctx({})))
    expect(r.sampleSize).toBe(5)
    expect(r.approx).toBe(false)
  })

  it('报表管理侧·默认拒（B5.2 RBAC 细化后）：限权账号 403·超管 200（质检 oversight 非外包可见）+ 默认审计', async () => {
    // 原车道E假设「不设 cap 闸」已被 B5.2 默认拒覆盖：未登记 ACTION_CAPS 的 action 需高权默认 cap。
    // 质检报表是管理 oversight（看外包的会话量/响应/SLA），不该被外包/限权账号自己拉——默认拒正确。
    control.reset()
    control.seed('adminConfig', [{ _id: 'auth', keyHash: sha(KEY), caps: ['products:edit'] }])
    expect((await call('conversationsReport', KEY, {})).status).toBe(403) // 限权账号默认拒
    control.reset()
    control.seed('adminConfig', [{ _id: 'auth', keyHash: sha(KEY), caps: ['*'] }])
    const r = await call('conversationsReport', KEY, {})
    expect(r.status).toBe(200) // 超管过
    expect(r.ok).toBe(true)
    expect(shouldAudit('conversationsReport')).toBe(true) // 默认留痕（非 ^get/list/upload）
  })
})
