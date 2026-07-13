// 黄金 cs-agent §二（RBAC 批量导出洞）/§六（质检报表口径）/§七（CSAT 报表）/§十三（客户 360 聚合）
// + admin-misc（kb/checkpoints 策展）（守卫 rw-admin5-golden）。
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { control } from 'wx-server-sdk'
import { main as adminApi } from '../src/functions/adminApi/index'
import { sha } from '../src/functions/adminApi/lib'
import { getDb } from '../src/kit'

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

  it('大白话：学习完成度不被 stale done 键顶爆——doneCount 与课程真实段集取交集·percent 封顶 100（与 C 端 mapMyCourses 同口径）', async () => {
    control.seed('courses', [
      { _id: 'c1', id: 'c1', title: '钩织入门', chapters: [{ id: 'ch1', lessons: [{ id: 'l1', segments: [{ id: 's1' }, { id: 's2' }] }] }] },
    ])
    control.seed('progress', [
      { _id: 'pg1', _openid: 'oU1', courseId: 'c1', done: { s1: true, s2: true, sGhost: true, sDeleted: true }, last: {} }, // 含已删/改名段 stale 键
    ])
    const r = await post('getCustomer360', SUPER, { openid: 'oU1' })
    const learning = r.panels.find((p: any) => p.key === 'learning').data
    const pos = learning.positions.find((x: any) => x.courseId === 'c1')
    expect(pos.totalSegments).toBe(2)
    expect(pos.doneCount).toBe(2) // sGhost/sDeleted 不在段集·剔除（交集）
    expect(pos.percent).toBe(100) // 不顶爆 >100（坐席不见「200% 完成」·两端口径不分叉）
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

  it('大白话：DB 查询异常不再被并入「真无档」——单独回 ok:false USER_LOOKUP_FAIL；真查无结果仍 ok:true+user:null 不变', async () => {
    control.setBeforeGet(({ coll }: any) => {
      if (coll === 'users') throw new Error('MOCK_DB_FAIL')
    })
    const r = await post('getUser', SUPER, { openid: 'oA' })
    control.setBeforeGet(null as never)
    expect(r.ok).toBe(false) // 原代码 .catch(() => ({data:[]})) 把异常也回成 {ok:true,user:null}——批D 的
    // userLoadFailed 前端分支因此永远命中不到——改后 DB 异常单独识别
    expect(r.error).toBe('USER_LOOKUP_FAIL')
    // 真查无结果（无异常注入）：保持 ok:true+user:null 不变
    expect((await post('getUser', SUPER, { openid: 'oNobody' })).ok).toBe(true)
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

describe('CSAT 明细钻取（批 B6·cursor 分页·[from,to) 含界·maxScore 过滤）', () => {
  it('大白话：[from,to) 含起不含止——起点那条在窗内、止点那条被剔除，窗外记录不进列表；明细行回 externalUserId', async () => {
    control.seed('csat', [
      { _id: 'e-out-low', score: 3, note: '', externalUserId: 'euF', createdAt: 500 }, // <from·窗外
      { _id: 'e1', score: 1, note: '差评理由', externalUserId: 'euD', createdAt: 1000 }, // =from·含界
      { _id: 'e2', score: 4, externalUserId: 'euC', createdAt: 3000 },
      { _id: 'e3', score: 5, externalUserId: 'euE', createdAt: 5000 }, // =to·被剔除（不含止）
    ])
    const r = await post('listCsatEntries', SUPER, { from: 1000, to: 5000 })
    expect(r.ok).toBe(true)
    expect(r.entries.map((e: any) => e.at)).toEqual([3000, 1000]) // 倒序·窗内两条
    expect(r.hasMore).toBe(false)
    expect(r.entries[1].score).toBe(1)
    expect(r.entries[1].note).toBe('差评理由')
    expect(r.entries[1].externalUserId).toBe('euD') // 回 externalUserId 供「查会话」定位
    expect(r.entries.map((e: any) => e.id)).toEqual(['e2', 'e1']) // 行级唯一键回传（确定性 _id）·供前端翻页按 id 去重
  })

  it('大白话：翻页途中撞到 from 下界——那一页只取窗内前缀、当场收口不再续页（不把窗外记录误判成「还有更多」）', async () => {
    control.seed('csat', [
      { _id: 'r1', score: 5, externalUserId: 'eu1', createdAt: 6000 },
      { _id: 'r2', score: 4, externalUserId: 'eu2', createdAt: 5000 },
      { _id: 'r3', score: 3, externalUserId: 'eu3', createdAt: 4000 }, // from 边界前最后一条（在窗内）
      { _id: 'r4', score: 2, externalUserId: 'eu4', createdAt: 3000 }, // < from·窗外
      { _id: 'r5', score: 1, externalUserId: 'eu5', createdAt: 2000 }, // < from·窗外
    ])
    const p1 = await post('listCsatEntries', SUPER, { from: 3500, limit: 2 })
    expect(p1.entries.map((e: any) => e.at)).toEqual([6000, 5000])
    expect(p1.hasMore).toBe(true) // 本页未触边界·仍有更多
    const p2 = await post('listCsatEntries', SUPER, { from: 3500, limit: 2, cursor: p1.nextCursor })
    expect(p2.entries.map((e: any) => e.at)).toEqual([4000]) // 本页原生多拉一条(3000)被 from 砍掉
    expect(p2.hasMore).toBe(false) // 撞边界·当场收口
    expect(p2.nextCursor).toBe(null)
  })

  it('大白话：maxScore 过滤（score 是 1-5 整数·≤N 语义，如「仅差评 ≤3」）——超过阈值的分不进列表', async () => {
    control.seed('csat', [
      { _id: 'm1', score: 5, externalUserId: 'euA', createdAt: 3000 },
      { _id: 'm2', score: 3, externalUserId: 'euB', createdAt: 2000 },
      { _id: 'm3', score: 1, externalUserId: 'euC', createdAt: 1000 },
    ])
    const r = await post('listCsatEntries', SUPER, { maxScore: 3 })
    expect(r.entries.map((e: any) => e.score)).toEqual([3, 1]) // 5 分被剔除
  })

  it('大白话：无参数=全量倒序首页；空集不崩', async () => {
    const zero = await post('listCsatEntries', SUPER, {})
    expect(zero.ok).toBe(true)
    expect(zero.entries).toEqual([])
    expect(zero.hasMore).toBe(false)
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

  it('大白话：精选(featured)白名单字段round trip——存 true 读回 true，旧条目/未传字段默认 false（R37b·公开读 getPublicFaq 的策展面）', async () => {
    const save = await post('saveKb', SUPER, {
      entries: [
        { key: 'faq1', question: '怎么激活', answer: '扫码', category: 'activation', order: 1, featured: true },
        { key: 'faq2', question: '怎么退货', answer: '联系客服', category: 'aftersale', order: 2 }, // 未传 featured
      ],
    })
    expect(save.count).toBe(2)
    const list = (await post('listKb', SUPER, {})).list
    expect(list.find((e: any) => e.key === 'faq1').featured).toBe(true)
    expect(list.find((e: any) => e.key === 'faq2').featured).toBe(false)
  })

  it('大白话：order=0（第一条）不被 `Number(e.order)||i` 的 falsy 吞掉换成序号（P3·item10）', async () => {
    // order:0 放在第 2 条（i=1）——旧写法 `Number(e.order)||i` 会把 0 当 falsy 换成 i=1，本测试要逮住这点
    const save = await post('saveKb', SUPER, {
      entries: [
        { key: 'faq1', question: 'q1', answer: 'a1', category: 'other', order: 5 },
        { key: 'faq2', question: 'q2', answer: 'a2', category: 'other', order: 0 },
      ],
    })
    expect(save.count).toBe(2)
    const list = await post('listKb', SUPER, {})
    const e2 = list.list.find((e: any) => e.key === 'faq2')
    expect(e2.order).toBe(0) // 不被吞成 i=1
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

  it('大白话：courseId/nodeId 含冒号一律拒（fail-closed·P3·item11：防 def:courseId:nodeId 拼接跨课撞键）', async () => {
    const r1 = await post('saveCheckpoints', SUPER, { courseId: 'c1:evil', nodes: [{ nodeId: 'n1', title: 't' }] })
    expect(r1.error).toBe('BAD_ARGS:COLON_IN_ID')
    const r2 = await post('saveCheckpoints', SUPER, { courseId: 'c2', nodes: [{ nodeId: 'n1:evil', title: 't' }] })
    expect(r2.error).toBe('BAD_ARGS:COLON_IN_ID')
    expect(control.dump('checkpoints')).toEqual([]) // 拒绝时不写半份数据（先整体校验再落库）
  })

  it('大白话：空 nodeId 整批拒且既有 def 不被删（D3·fail-closed：空 nodeId 原会静默不进 keepIds、随后被当「已移除」真删）', async () => {
    control.seed('checkpoints', [{ _id: 'def:c3:n1', type: 'def', courseId: 'c3', nodeId: 'n1', title: '旧节点' }])
    const r = await post('saveCheckpoints', SUPER, { courseId: 'c3', nodes: [{ nodeId: '', title: '空 id 节点' }] })
    expect(r.error).toBe('BAD_ARGS:EMPTY_NODE_ID')
    const ids = control.dump('checkpoints').map((d: any) => d._id)
    expect(ids).toContain('def:c3:n1') // 既有节点未被误删
  })

  it('大白话：saveKb GC 删除失败不再吞（H2·同批F F1 判例）——新内容已 upsert 成功、旧条目删不掉即 ok:false + 留痕，不再假装「已保存」', async () => {
    control.seed('kb', [{ _id: 'faq-old', question: '旧条目', answer: '将被删但删不掉', category: 'other' }])
    // 注入旧条目那一步 remove 失败（模拟真机偶发写失败）——spy 挂在共享 DocRef 原型上（同 app-admin2.test.ts F1 范式）
    const docProto = Object.getPrototypeOf(getDb().collection('kb').doc('faq-old'))
    const spy = vi.spyOn(docProto, 'remove').mockImplementationOnce(() => Promise.reject(new Error('MOCK_REMOVE_FAIL')))
    // try/finally（I3·防线）：post 若抛异常，finally 仍保证 spy.mockRestore()——spy 挂在共享 DocRef 原型上，
    // 裸写「await post()→mockRestore()」中途一抛就残留，污染后续用例（同 remove 方法被别的用例复用时全部误伪装失败）。
    let r: any
    try {
      r = await post('saveKb', SUPER, { entries: [{ key: 'faq-new', question: '新条目', answer: '已存', category: 'other', order: 0 }] })
    } finally {
      spy.mockRestore()
    }
    expect(r.ok).toBe(false) // 原代码 .catch(()=>{}) 全吞会恒回 ok:true——前端误显「已保存」
    expect(r.error).toBe('GC_REMOVE_FAIL')
    expect(r.failedIds).toEqual(['faq-old'])
    const keys = control.dump('kb').map((d: any) => d._id)
    expect(keys).toContain('faq-new') // upsert 已成功的部分保留（数据是新的）
    expect(keys).toContain('faq-old') // GC 真失败·旧条目未被静默当「已删」
    const anomalies = control.dump('anomalies')
    expect(anomalies.some((a: any) => a.code === 'GC_REMOVE_FAIL')).toBe(true) // 真留痕（病根14）
    // 重试：不再注入失败·GC 应真收敛
    const ok = await post('saveKb', SUPER, { entries: [{ key: 'faq-new', question: '新条目', answer: '已存', category: 'other', order: 0 }] })
    expect(ok.ok).toBe(true)
    expect(control.dump('kb').map((d: any) => d._id)).toEqual(['faq-new'])
  })

  it('大白话：saveCheckpoints GC 删除失败不再吞（H2·同批F F1 判例）——新节点已 upsert 成功、旧节点删不掉即 ok:false + 留痕', async () => {
    control.seed('checkpoints', [{ _id: 'def:c4:old', type: 'def', courseId: 'c4', nodeId: 'old', title: '旧节点·删不掉' }])
    const docProto = Object.getPrototypeOf(getDb().collection('checkpoints').doc('def:c4:old'))
    const spy = vi.spyOn(docProto, 'remove').mockImplementationOnce(() => Promise.reject(new Error('MOCK_REMOVE_FAIL')))
    // try/finally（I3·防线）：同上一条·post 若抛异常，finally 仍保证 spy.mockRestore()，防共享原型污染后续用例。
    let r: any
    try {
      r = await post('saveCheckpoints', SUPER, { courseId: 'c4', nodes: [{ nodeId: 'new', title: '新节点', order: 0 }] })
    } finally {
      spy.mockRestore()
    }
    expect(r.ok).toBe(false) // 原代码 .catch(()=>{}) 全吞会恒回 ok:true——坐席误以为「已整课覆盖」
    expect(r.error).toBe('GC_REMOVE_FAIL')
    expect(r.failedIds).toEqual(['def:c4:old'])
    const ids = control.dump('checkpoints').map((d: any) => d._id)
    expect(ids).toContain('def:c4:new') // upsert 已成功的部分保留
    expect(ids).toContain('def:c4:old') // GC 真失败·旧节点未被静默当「已删」
    const anomalies = control.dump('anomalies')
    expect(anomalies.some((a: any) => a.code === 'GC_REMOVE_FAIL')).toBe(true)
    const ok = await post('saveCheckpoints', SUPER, { courseId: 'c4', nodes: [{ nodeId: 'new', title: '新节点', order: 0 }] })
    expect(ok.ok).toBe(true)
    expect(control.dump('checkpoints').map((d: any) => d._id)).toEqual(['def:c4:new'])
  })
})
