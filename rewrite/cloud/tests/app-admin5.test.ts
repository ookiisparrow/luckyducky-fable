// 黄金 cs-agent §二（RBAC 批量导出洞）/§六（质检报表口径）/§七（CSAT 报表）/§十三（客户 360 聚合）
// + admin-misc（kb/checkpoints 策展）（守卫 rw-admin5-golden）。
import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main as adminApi } from '../src/functions/adminApi/index'
import { sha } from '../src/functions/adminApi/lib'

const SUPER = 'super-secret-key'
const A1 = 'outsourced-key-1'

const post = (action: string, key: string, data: Record<string, unknown> = {}, ip = '1.1.1.1') =>
  adminApi({
    httpMethod: 'POST',
    headers: { 'x-forwarded-for': ip },
    body: JSON.stringify({ action, key, data }),
  }).then((r: any) => ({ status: r.statusCode, ...JSON.parse(r.body) }))

beforeEach(() => {
  control.reset()
  control.setOpenId('')
  control.seed('adminConfig', [
    { _id: 'auth', keyHash: sha(SUPER), role: 'superadmin' },
    { _id: 'agent-1', keyHash: sha(A1), role: 'outsourced', name: '外包一号' },
  ])
})

describe('360 读 RBAC（黄金 §二：批量导出洞闭合 + 强制留痕）', () => {
  it('大白话：外包只有「接待」权——直调 360 读/客户检索/画像/会话检索一律 403；超管过闸且查询被强制留痕', async () => {
    for (const action of ['getCustomer360', 'searchCustomer', 'getUser', 'searchConversations']) {
      const r = await post(action, A1, { openid: 'oU1', q: 'x' })
      expect(r.status, action).toBe(403)
      expect(r.error).toBe('FORBIDDEN')
    }
    const ok = await post('getCustomer360', SUPER, { openid: 'oU1' })
    expect(ok.ok).toBe(true)
    // FORCE_AUDIT：查询类本会被 ^get 降噪跳过，360 读破例留痕「查了谁」
    const log = control.dump('auditLog').find((l: any) => l.action === 'getCustomer360')
    expect(log.ok).toBe(true)
    expect(log.summary.openid).toBe('oU1')
  })
})

describe('客户 360 聚合（黄金 §十三：只本人·钱链口径·错误隔离·开关）', () => {
  it('大白话：画像总消费只计已付款订单且分级累加不漂；面板按序齐全；他人数据不混入；空客人结构齐全不报错', async () => {
    control.seed('users', [{ _id: 'u1', _openid: 'oU1', nickname: '鸭鸭' }])
    control.seed('orders', [
      { _id: 'o1', _openid: 'oU1', status: 'paid', amount: 100.1, createdAt: 1 },
      { _id: 'o2', _openid: 'oU1', status: 'done', amount: 50.2, createdAt: 2 },
      { _id: 'o3', _openid: 'oU1', status: 'pending', amount: 999, createdAt: 3 }, // 未付不计
      { _id: 'ox', _openid: 'oOther', status: 'paid', amount: 777, createdAt: 4 }, // 他人不混入
    ])
    control.seed('activations', [
      { _id: 'a1', _openid: 'oU1', enteredAt: 1 },
      { _id: 'a2', _openid: 'oU1' },
    ])
    const r = await post('getCustomer360', SUPER, { openid: 'oU1' })
    expect(r.ok).toBe(true)
    expect(r.openid).toBe('oU1')
    expect(r.panels.map((p: any) => p.key)).toEqual(['profile', 'orders', 'activation', 'learning', 'checkpoints'])
    const profile = r.panels[0].data
    expect(profile.orderCount).toBe(3)
    expect(profile.paidCount).toBe(2)
    expect(profile.totalSpent).toBe(150.3) // 元浮点直加会漂（100.1+50.2=150.29999…）·分级累加钉住
    expect(profile.activatedCount).toBe(2)
    expect(profile.enterRate).toBe(50)
    // 空客人：面板结构齐全、不报错（错误隔离）
    const empty = await post('getCustomer360', SUPER, { openid: 'oNobody' })
    expect(empty.ok).toBe(true)
    expect(empty.panels.length).toBe(5)
  })

  it('大白话：面板开关按配置生效——关掉的板块不进聚合；缺客户标识拒', async () => {
    control.seed('config', [{ _id: 'csModules', modules: { learning: { enabled: false } } }])
    const r = await post('getCustomer360', SUPER, { openid: 'oU1' })
    expect(r.panels.map((p: any) => p.key)).toEqual(['profile', 'orders', 'activation', 'checkpoints'])
    expect((await post('getCustomer360', SUPER, {})).status).toBe(400)
  })
})

describe('客户检索与画像（黄金 §十三）', () => {
  it('大白话：按 openid/手机/昵称/订单号精确命中并给出命中依据；缺词拒；无匹配空列表不报错', async () => {
    control.seed('users', [
      { _id: 'u1', _openid: 'oA', nickname: '鸭鸭', phone: '13800000001' },
      { _id: 'u2', _openid: 'oB', nickname: '鹅鹅', phone: '13800000002' },
    ])
    control.seed('orders', [{ _id: 'ORD1', _openid: 'oB', status: 'paid', amount: 1 }])
    const byPhone = await post('searchCustomer', SUPER, { q: '13800000001' })
    expect(byPhone.count).toBe(1)
    expect(byPhone.customers[0].openid).toBe('oA')
    expect(byPhone.customers[0].matchedBy).toContain('phone')
    const byOrder = await post('searchCustomer', SUPER, { q: 'ORD1' })
    expect(byOrder.customers[0].openid).toBe('oB')
    expect(byOrder.customers[0].matchedBy).toContain('orderId')
    expect((await post('searchCustomer', SUPER, {})).status).toBe(400)
    expect((await post('searchCustomer', SUPER, { q: '不存在' })).count).toBe(0)
  })

  it('大白话：单客户画像走白名单字段，不回原始档内部字段；无档回空不报错', async () => {
    control.seed('users', [{ _id: 'u1', _openid: 'oA', nickname: '鸭鸭', internalNote: '内部字段' }])
    const r = await post('getUser', SUPER, { openid: 'oA' })
    expect(r.user.nickname).toBe('鸭鸭')
    expect(JSON.stringify(r.user)).not.toContain('内部字段')
    expect((await post('getUser', SUPER, { openid: 'oNobody' })).user).toBeNull()
  })
})

describe('质检报表与会话检索（黄金 §六）', () => {
  it('大白话：会话量/首响均值/答复率/SLA 按口径算——入站配其后首个出站，未答复也如实计；无数据全 0 不报错', async () => {
    control.seed('conversations', [
      { _id: 'c1', channel: 'wxkf', direction: 'in', externalUserId: 'euA', text: '在吗', at: 1000 },
      { _id: 'c2', channel: 'wxkf', direction: 'out', externalUserId: 'euA', text: '在的', at: 61_000 }, // 60s 后答复
      { _id: 'c3', channel: 'wxkf', direction: 'in', externalUserId: 'euB', text: '退货', at: 2000 }, // 无人答复
    ])
    const r = await post('conversationsReport', SUPER, {})
    expect(r.ok).toBe(true)
    expect(r.volume).toEqual({ messages: 3, inbound: 2, outbound: 1, customers: 2 })
    expect(r.response.avgResponseMs).toBe(60_000)
    expect(r.response.answered).toBe(1)
    expect(r.response.unanswered).toBe(1)
    expect(r.response.answeredRate).toBe(50)
    expect(r.approx).toBe(false)
    // SLA 阈值可传：30s 阈下这次 60s 答复算超时
    const tight = await post('conversationsReport', SUPER, { slaMs: 30_000 })
    expect(tight.sla.breaches).toBe(1)
    expect(tight.sla.breachRate).toBe(100)
    control.reset()
    control.seed('adminConfig', [{ _id: 'auth', keyHash: sha(SUPER), role: 'superadmin' }])
    const zero = await post('conversationsReport', SUPER, {})
    expect(zero.volume.messages).toBe(0)
    expect(zero.response.answeredRate).toBe(0)
  })

  it('大白话：会话检索按客户倒序翻页、关键词页内过滤、按渠道叠加筛选；无匹配空列表', async () => {
    control.seed('conversations', [
      { _id: 'c1', channel: 'wxkf', direction: 'in', openid: 'oA', externalUserId: 'euA', text: '想退货', at: 1000 },
      { _id: 'c2', channel: 'wxkf', direction: 'out', openid: 'oA', externalUserId: 'euA', text: '好的帮你办', at: 2000 },
      { _id: 'c3', channel: 'web', direction: 'in', openid: 'oA', externalUserId: 'euA', text: '网页来的', at: 3000 },
      { _id: 'c4', channel: 'wxkf', direction: 'in', openid: 'oB', externalUserId: 'euB', text: '别人的', at: 4000 },
    ])
    const r = await post('searchConversations', SUPER, { openid: 'oA' })
    expect(r.messages.map((m: any) => m.id)).toEqual(['c3', 'c2', 'c1']) // 按 at 倒序·只 oA
    const kw = await post('searchConversations', SUPER, { openid: 'oA', keyword: '退货' })
    expect(kw.messages.map((m: any) => m.id)).toEqual(['c1'])
    const ch = await post('searchConversations', SUPER, { openid: 'oA', channel: 'web' })
    expect(ch.messages.map((m: any) => m.id)).toEqual(['c3'])
    expect((await post('searchConversations', SUPER, { openid: 'oNobody' })).messages).toEqual([])
  })
})

describe('CSAT 报表（黄金 §七）', () => {
  it('大白话：均分+1-5 分布+总数+带备注数，越界分忽略不脏分；空集全 0 不崩', async () => {
    control.seed('csat', [
      { _id: 's1', score: 5, note: '很好' },
      { _id: 's2', score: 4 },
      { _id: 's3', score: 5 },
      { _id: 's4', score: 9 }, // 越界·忽略
    ])
    const r = await post('getCsatReport', SUPER, {})
    expect(r.total).toBe(3)
    expect(r.avg).toBe(4.67)
    expect(r.dist[5]).toBe(2)
    expect(r.dist[4]).toBe(1)
    expect(r.withNote).toBe(1)
    control.reset()
    control.seed('adminConfig', [{ _id: 'auth', keyHash: sha(SUPER), role: 'superadmin' }])
    const zero = await post('getCsatReport', SUPER, {})
    expect(zero.total).toBe(0)
    expect(zero.avg).toBe(0)
  })
})

describe('知识库与节点策展（kb=公司 FAQ·checkpoints=课程节点定义）', () => {
  it('大白话：外包可读 FAQ（快捷回复要用）但不能改；超管整体覆盖保存——删掉的条目真删', async () => {
    control.seed('kb', [{ _id: 'faq0', question: '旧条目', answer: '将被删', category: 'other' }])
    expect((await post('listKb', A1)).ok).toBe(true) // 外包可读（cap agent:handle）
    expect((await post('saveKb', A1, { entries: [] })).status).toBe(403) // 外包不能改（默认拒）
    const save = await post('saveKb', SUPER, {
      entries: [
        { key: 'faq1', question: '怎么激活', answer: '扫码', category: 'activation', order: 1 },
        { key: 'faq2', question: '怎么退货', answer: '联系客服', category: 'aftersale', order: 2 },
      ],
    })
    expect(save.count).toBe(2)
    const list = await post('listKb', SUPER, {})
    expect(list.list.map((e: any) => e.key).sort()).toEqual(['faq1', 'faq2']) // faq0 已真删
    expect(list.list.every((e: any) => e.enabled)).toBe(true)
  })

  it('大白话：节点定义整课覆盖保存——只动本课 def、不碰用户拍照提交；外包无权维护', async () => {
    control.seed('checkpoints', [
      { _id: 'def:c1:n1', type: 'def', courseId: 'c1', nodeId: 'n1', title: '旧节点' },
      { _id: 'sub:c1:u1', type: 'sub', courseId: 'c1', nodeId: 'n1', photo: '用户提交' },
    ])
    expect((await post('saveCheckpoints', A1, { courseId: 'c1', nodes: [] })).status).toBe(403)
    const save = await post('saveCheckpoints', SUPER, {
      courseId: 'c1',
      nodes: [{ nodeId: 'n2', title: '第二段收口', remedy: '拆回上一行重钩', order: 1 }],
    })
    expect(save.count).toBe(1)
    const list = await post('listCheckpoints', SUPER, { courseId: 'c1' })
    expect(list.list.map((n: any) => n.nodeId)).toEqual(['n2']) // n1 已删·整课覆盖
    const ids = control.dump('checkpoints').map((d: any) => d._id)
    expect(ids).toContain('sub:c1:u1') // 用户 sub 提交不受影响
    expect(ids).not.toContain('def:c1:n1')
  })
})
