// 黄金 cs-agent §一（会话状态机与认领互斥）/§二（scoped 360 双闸）/§四（坐席发送与归档）/§七（关单触 CSAT）
// /§十（企微免登与外包账号管理）（守卫 rw-admin6-golden）。
import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main as adminApi } from '../src/functions/adminApi/index'
import { sha } from '../src/functions/adminApi/lib'

const SUPER = 'super-secret-key'
const A1 = 'outsourced-key-1'
const A2 = 'outsourced-key-2'

const post = (action: string, key: string, data: Record<string, unknown> = {}, ip = '1.1.1.1') =>
  adminApi({
    httpMethod: 'POST',
    headers: { 'x-forwarded-for': ip },
    body: JSON.stringify({ action, key, data }),
  }).then((r: any) => ({ status: r.statusCode, ...JSON.parse(r.body) }))

// 会话种子（csSession·确定性 _id 形状不入断言）
const S = (id: string, status: string, extra: Record<string, unknown> = {}) => ({
  _id: id,
  status,
  externalUserId: 'eu-' + id,
  openKfId: 'kf1',
  createdAt: 100,
  updatedAt: 100,
  ...extra,
})

beforeEach(() => {
  control.reset()
  control.setOpenId('')
  control.seed('adminConfig', [
    { _id: 'auth', keyHash: sha(SUPER), role: 'superadmin' },
    { _id: 'agent-1', keyHash: sha(A1), role: 'outsourced', name: '外包一号', wecomUserId: 'w1' },
    { _id: 'agent-2', keyHash: sha(A2), role: 'outsourced', name: '外包二号' },
  ])
})

describe('待接队列（黄金 §一：FIFO·escalated 只商户可见·有界翻页）', () => {
  it('大白话：外包只看见待接、先到先接；被甩回商户的会话只有超管看得见；逐页可取全', async () => {
    control.seed('csSession', [
      S('s1', 'pending', { createdAt: 100 }),
      S('s2', 'pending', { createdAt: 200 }),
      S('s3', 'escalated', { createdAt: 150, agentId: 'agent-2' }),
      S('s4', 'active', { agentId: 'agent-2' }),
      S('s5', 'closed'),
    ])
    const agent = await post('listQueue', A1)
    expect(agent.items.map((i: any) => i.sessionId)).toEqual(['s1', 's2']) // FIFO·不含 escalated
    const boss = await post('listQueue', SUPER)
    expect(boss.items.map((i: any) => i.sessionId)).toEqual(['s1', 's3', 's2']) // 超管另见 escalated
    // 有界翻页：limit 1 逐页取全
    const p1 = await post('listQueue', A1, { limit: 1 })
    expect(p1.items.map((i: any) => i.sessionId)).toEqual(['s1'])
    const p2 = await post('listQueue', A1, { limit: 1, cursor: p1.nextCursor })
    expect(p2.items.map((i: any) => i.sessionId)).toEqual(['s2'])
  })
})

describe('认领/放手/升级/结束（黄金 §一：互斥·上限·归属·终态幂等）', () => {
  it('大白话：认领绑定本坐席；已被接走的再认领被拒；接待上限满额拒；商户可重接升级来的会话；不存在回未找到', async () => {
    control.seed('csSession', [S('s1', 'pending'), S('s2', 'pending'), S('s3', 'escalated', { agentId: 'agent-2' })])
    control.seed('agentState', [{ _id: 'agent-1', status: 'online', limit: 1 }])
    const r = await post('claimConversation', A1, { sessionId: 's1' })
    expect(r.ok).toBe(true)
    expect(r.session.status).toBe('active')
    expect(r.session.agentId).toBe('agent-1')
    // 互斥：他人再认领被拒·归属不被抢
    const steal = await post('claimConversation', A2, { sessionId: 's1' })
    expect(steal.ok).toBe(false)
    expect(steal.error).toBe('NOT_CLAIMABLE')
    expect(control.dump('csSession').find((s: any) => s._id === 's1').agentId).toBe('agent-1')
    // 接待上限（limit 1 已满）：新认领拒·会话保持待接
    const cap = await post('claimConversation', A1, { sessionId: 's2' })
    expect(cap.error).toBe('AT_CAPACITY')
    expect(control.dump('csSession').find((s: any) => s._id === 's2').status).toBe('pending')
    // 商户重接升级会话：escalated→active·归属改到重接人
    const retake = await post('claimConversation', SUPER, { sessionId: 's3' })
    expect(retake.ok).toBe(true)
    expect(retake.session.agentId).toBe('admin')
    expect((await post('claimConversation', A2, { sessionId: 'nope' })).status).toBe(404)
  })

  it('大白话：放手退回队列并清归属；升级甩回商户并留升级人；均只有所属坐席能操作；对非服务中会话是幂等拒绝', async () => {
    control.seed('csSession', [S('s1', 'active', { agentId: 'agent-1' }), S('s2', 'active', { agentId: 'agent-1' })])
    expect((await post('releaseConversation', A2, { sessionId: 's1' })).status).toBe(403) // 非所属拒
    const rel = await post('releaseConversation', A1, { sessionId: 's1' })
    expect(rel.ok).toBe(true)
    const s1 = control.dump('csSession').find((s: any) => s._id === 's1')
    expect(s1.status).toBe('pending')
    expect(s1.agentId).toBeNull() // 清归属·重回可认领
    expect((await post('releaseConversation', SUPER, { sessionId: 's1' })).error).toBe('NOT_ACTIVE') // 幂等拒
    expect((await post('escalateToMerchant', A2, { sessionId: 's2' })).status).toBe(403) // 非所属拒
    const esc = await post('escalateToMerchant', A1, { sessionId: 's2' })
    expect(esc.ok).toBe(true)
    const s2 = control.dump('csSession').find((s: any) => s._id === 's2')
    expect(s2.status).toBe('escalated')
    expect(s2.agentId).toBe('agent-1') // 保留＝记录谁升的
    expect((await post('escalateToMerchant', SUPER, { sessionId: 's2' })).error).toBe('NOT_ACTIVE')
  })

  it('大白话：结束服务中会话→终态并触发满意度提示（发提示+立评分标记+归档提示文字）；关从未接待的不触发；重复关是幂等拒绝', async () => {
    control.seed('csSession', [S('s1', 'active', { agentId: 'agent-1' }), S('s2', 'pending')])
    control.setCallFunctionResult({ result: { ok: true } })
    const r = await post('closeConversation', A1, { sessionId: 's1' })
    expect(r.ok).toBe(true)
    expect(control.dump('csSession').find((s: any) => s._id === 's1').status).toBe('closed')
    const call = control.callFunctionCalls()[0]
    expect(call.name).toBe('kfSend') // 满意度提示经统一发送接缝
    expect(call.data.text).toContain('1-5')
    expect(control.dump('kfState').find((d: any) => d._id === 'csatask:eu-s1')).toBeTruthy() // 评分标记（时窗内回数字才算分）
    const archived = control.dump('conversations').find((m: any) => m.direction === 'out' && m.externalUserId === 'eu-s1')
    expect(archived.text).toContain('1-5') // 提示归档·质检能回看「我们问了什么」
    expect((await post('closeConversation', SUPER, { sessionId: 's1' })).error).toBe('ALREADY_CLOSED')
    // 关从未接待过的（pending）：不发提示、不立标记、不归档
    const before = control.callFunctionCalls().length
    const r2 = await post('closeConversation', SUPER, { sessionId: 's2' })
    expect(r2.ok).toBe(true)
    expect(control.callFunctionCalls().length).toBe(before)
    expect(control.dump('kfState').find((d: any) => d._id === 'csatask:eu-s2')).toBeFalsy()
  })
})

describe('坐席回复与会话流（黄金 §四：接缝发送·归档·失败不吞·scope）', () => {
  beforeEach(() => {
    control.seed('csSession', [S('s1', 'active', { agentId: 'agent-1' }), S('s2', 'pending')])
    control.seed('kfIdentity', [{ _id: 'ext:eu-s1', openid: 'oU1' }])
  })

  it('大白话：回复经统一接缝发出并归档（带坐席身份和桥接 openid）；发送失败回失败且不归档——绝不把失败当成功吞掉', async () => {
    control.setCallFunctionResult({ result: { ok: true, errcode: 0 } })
    const r = await post('sendAgentMessage', A1, { sessionId: 's1', text: '帮你查一下' })
    expect(r.ok).toBe(true)
    expect(control.callFunctionCalls()[0].name).toBe('kfSend')
    const msg = control.dump('conversations').find((m: any) => m.direction === 'out')
    expect(msg.text).toBe('帮你查一下')
    expect(msg.agentId).toBe('agent-1') // 出站坐席身份·质检可溯
    expect(msg.openid).toBe('oU1') // 身份桥接补齐
    // 失败：如实回错并不归档
    const countBefore = control.dump('conversations').length
    control.setCallFunctionResult({ result: { errcode: 95018 } })
    const fail = await post('sendAgentMessage', A1, { sessionId: 's1', text: '这条发不出去' })
    expect(fail.ok).toBe(false)
    expect(fail.error).toBe('SEND_FAIL')
    expect(fail.errcode).toBe(95018)
    expect(control.dump('conversations').length).toBe(countBefore) // 失败消息不归档
  })

  it('大白话：callFunction 整体失败（reject/网络异常）不能被误判为发送成功——绝不假成功归档（B1）', async () => {
    control.setCallFunctionFail(true) // callFunction 抛错 → sendAgentMessage 内 .catch(() => null)：res=null
    const countBefore = control.dump('conversations').length
    const r = await post('sendAgentMessage', A1, { sessionId: 's1', text: '这条也发不出去' })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('SEND_FAIL')
    expect(control.dump('conversations').length).toBe(countBefore) // res=null 不得假成功归档
  })

  it('大白话：非所属外包发消息被拒且无副作用；对非服务中会话不发（接待窗口）', async () => {
    const r = await post('sendAgentMessage', A2, { sessionId: 's1', text: '越权' })
    expect(r.status).toBe(403)
    expect(control.callFunctionCalls().length).toBe(0) // 无副作用·没碰发送接缝
    expect((await post('sendAgentMessage', SUPER, { sessionId: 's2', text: 'x' })).error).toBe('NOT_ACTIVE')
  })

  it('大白话：会话流按时间升序、平台事件不混入、带桥接 openid；非所属拒；「我在接」只回自己服务中的', async () => {
    control.seed('conversations', [
      { _id: 'm1', direction: 'in', externalUserId: 'eu-s1', openKfId: 'kf1', msgtype: 'text', text: '在吗', at: 1000 },
      { _id: 'm2', direction: 'out', externalUserId: 'eu-s1', openKfId: 'kf1', msgtype: 'text', text: '在的', at: 1500 },
      { _id: 'm3', direction: 'in', externalUserId: 'eu-s1', openKfId: 'kf1', msgtype: 'event', text: '', at: 1200 }, // 平台事件·过滤
    ])
    const r = await post('getThread', A1, { sessionId: 's1' })
    expect(r.messages.map((m: any) => m.text)).toEqual(['在吗', '在的']) // 升序·事件不混入
    expect(r.session.openid).toBe('oU1')
    expect((await post('getThread', A2, { sessionId: 's1' })).status).toBe(403)
    const mine = await post('listMyActive', A1, {})
    expect(mine.sessions.map((s: any) => s.sessionId)).toEqual(['s1'])
    expect((await post('listMyActive', A2, {})).sessions).toEqual([])
  })
})

describe('scoped 360 双闸（黄金 §二：归属 + 数据共享同意·超管数据控制者）', () => {
  beforeEach(() => {
    control.seed('csSession', [
      S('s1', 'active', { agentId: 'agent-1' }),
      S('s9', 'active', { agentId: 'agent-2' }),
      S('sx', 'active', { agentId: 'agent-1' }), // 未桥接（无 kfIdentity 映射）
    ])
    control.seed('kfIdentity', [
      { _id: 'ext:eu-s1', openid: 'oU1' },
      { _id: 'ext:eu-s9', openid: 'oU9' },
    ])
    control.seed('users', [
      { _id: 'u1', _openid: 'oU1', nickname: '鸭鸭', csDataShare: { agreed: true } },
      { _id: 'u9', _openid: 'oU9', nickname: '未同意者' }, // 未同意数据共享
    ])
  })

  it('大白话：外包看 360 只能走「自己在接的会话」且客户已同意——所属+同意出面板并强制留痕；未同意拒；非所属拒；未桥接如实说', async () => {
    const ok = await post('getSessionCustomer360', A1, { sessionId: 's1' })
    expect(ok.ok).toBe(true)
    expect(ok.openid).toBe('oU1')
    expect(ok.panels.length).toBeGreaterThan(0)
    expect(control.dump('auditLog').find((l: any) => l.action === 'getSessionCustomer360')).toBeTruthy() // 破例强制留痕
    expect((await post('getSessionCustomer360', A1, { sessionId: 's9' })).status).toBe(403) // 非所属（agent-2 的会话）
    expect((await post('getSessionCustomer360', A1, { sessionId: 'sx' })).error).toBe('NO_BRIDGE') // 未桥接如实回
    // 未同意：agent-2 看自己在接、但客户未同意 → 拒（fail-closed）
    const noConsent = await post('getSessionCustomer360', A2, { sessionId: 's9' })
    expect(noConsent.status).toBe(403)
    expect(noConsent.error).toBe('NO_CONSENT')
    // 超管＝数据控制者：越「归属」与「同意」两闸（非其会话+客户未同意）也能看
    const boss = await post('getSessionCustomer360', SUPER, { sessionId: 's9' })
    expect(boss.ok).toBe(true)
    expect(boss.openid).toBe('oU9')
  })
})

describe('外包账号管理（黄金 §十：口令哈希·停用即时·白名单·企微 userid 唯一）', () => {
  it('大白话：建号口令只存哈希；新号立即能登录并派生最小权；短口令/撞口令拒；外包自己不能建号', async () => {
    const r = await post('createAgent', SUPER, { name: '外包三号', key: 'brand-new-key-3' })
    expect(r.ok).toBe(true)
    const doc = control.dump('adminConfig').find((a: any) => a._id === r.agent.id)
    expect(doc.keyHash).toBe(sha('brand-new-key-3'))
    expect(JSON.stringify(doc)).not.toContain('brand-new-key-3') // 明文不落盘
    const login = await post('login', 'brand-new-key-3')
    expect(login.status).toBe(200)
    expect(login.caps).toEqual(['agent:handle']) // 角色派生最小权
    expect((await post('listQueue', 'brand-new-key-3')).ok).toBe(true) // 新号可干活
    expect((await post('createAgent', SUPER, { name: 'x', key: 'abc' })).error).toBe('KEY_TOO_SHORT')
    expect((await post('createAgent', SUPER, { name: 'x', key: A1 })).status).toBe(409) // 撞口令登录会串号·拒
    expect((await post('createAgent', A1, { name: 'x', key: 'whatever-key' })).status).toBe(403) // 外包不能自扩权
  })

  it('大白话：停用即时生效（连登录都不行）；不许停超管；列表只列外包、不回口令哈希；企微 userid 全局唯一防登错身份', async () => {
    const off = await post('disableAgent', SUPER, { id: 'agent-1', disabled: true })
    expect(off.ok).toBe(true)
    expect((await post('login', A1, {}, '5.5.5.5')).status).toBe(401) // 停用即时·登录拒
    expect((await post('disableAgent', SUPER, { id: 'auth', disabled: true })).status).toBe(400) // 不许停超管
    expect((await post('disableAgent', SUPER, { id: 'ghost', disabled: true })).status).toBe(404)
    const list = await post('listAgents', SUPER, {})
    expect(list.agents.map((a: any) => a.id).sort()).toEqual(['agent-1', 'agent-2']) // 排除超管
    expect(JSON.stringify(list.agents)).not.toContain(sha(A1)) // 白名单·不回口令哈希
    // 企微 userid 唯一：agent-1 已绑 w1 → agent-2 再绑 w1 拒；改绑自身不算撞；超管也可绑
    expect((await post('setAgentWecomUserId', SUPER, { id: 'agent-2', wecomUserId: 'w1' })).status).toBe(409)
    expect((await post('setAgentWecomUserId', SUPER, { id: 'agent-1', wecomUserId: 'w1' })).ok).toBe(true)
    expect((await post('setAgentWecomUserId', SUPER, { id: 'auth', wecomUserId: 'wboss' })).ok).toBe(true)
  })

  it('大白话：先查后写竞态（P2·根因#1）——createAgent 建号窗口内被并发方撞同一 keyHash，写后复核揪出、回滚自己那份并回 409（不留串号双凭证）', async () => {
    control.setBeforeUpdate(async ({ coll, data }: any) => {
      if (coll === 'adminConfig' && data && data.keyHash === sha('race-key')) {
        // 「先查」时并发方尚未落库（预检通过）；在本次真正写入前，并发方抢先建号——模拟先查后写窗口
        control.seed('adminConfig', [{ _id: 'agent-race', role: 'outsourced', keyHash: sha('race-key'), createdAt: 1 }])
      }
    })
    const r = await post('createAgent', SUPER, { name: '并发号', key: 'race-key' })
    control.setBeforeUpdate(null as never)
    expect(r.status).toBe(409)
    expect(r.error).toBe('KEY_TAKEN')
    // 自己刚建的那份已回滚删除，只剩并发方那一份——绝不留两账号共享同一 keyHash
    expect(control.dump('adminConfig').filter((a: any) => a.keyHash === sha('race-key')).length).toBe(1)
  })

  it('大白话：先查后写竞态（P2·根因#1）——setAgentWecomUserId 改绑窗口内被并发方撞同一 wecomUserId，写后复核回滚字段并回 409', async () => {
    control.setBeforeUpdate(async ({ coll, data }: any) => {
      if (coll === 'adminConfig' && data && data.wecomUserId === 'w-race') {
        control.seed('adminConfig', [{ _id: 'agent-race', role: 'outsourced', keyHash: sha('other-key'), wecomUserId: 'w-race' }])
      }
    })
    const r = await post('setAgentWecomUserId', SUPER, { id: 'agent-2', wecomUserId: 'w-race' })
    control.setBeforeUpdate(null as never)
    expect(r.status).toBe(409)
    expect(r.error).toBe('WECOM_ID_TAKEN')
    // 刚写的字段已回滚复原（agent-2 种子无 wecomUserId，回滚后应是空）——绝不留两账号共享同一企微 userid
    expect(control.dump('adminConfig').find((a: any) => a._id === 'agent-2').wecomUserId).toBe('')
  })
})

describe('企微免登（黄金 §十：code 换身份→签发令牌·fail-closed 全链）', () => {
  const seedToken = () => control.seed('kfState', [{ _id: 'token', accessToken: 'TKN', expireAt: Date.now() + 3600_000 }])
  const withFetch = async (impl: (url: string) => any, fn: () => Promise<void>) => {
    const saved = globalThis.fetch
    ;(globalThis as any).fetch = async (url: any) => ({ json: async () => impl(String(url)) })
    try {
      await fn()
    } finally {
      globalThis.fetch = saved
    }
  }

  it('大白话：有效 code→换到企微身份→查到绑定账号→签发高熵令牌（哈希入库·令牌即凭据可干活）', async () => {
    seedToken()
    await withFetch(
      (url) => (url.includes('auth/getuserinfo') ? { errcode: 0, userid: 'w1' } : { errcode: 0 }),
      async () => {
        const r = await post('loginByWecomCode', '', { code: 'good-code' })
        expect(r.status).toBe(200)
        expect(r.agentId).toBe('agent-1') // w1 绑定的账号
        expect(r.caps).toEqual(['agent:handle'])
        expect(r.sessionToken.length).toBe(64) // 高熵
        const doc = control.dump('adminConfig').find((a: any) => a._id === 'agent-1')
        expect(JSON.stringify(doc)).not.toContain(r.sessionToken) // 明文不落盘
        expect(doc.sessions[0].hash).toBe(sha(r.sessionToken))
        expect((await post('listQueue', r.sessionToken)).ok).toBe(true) // 令牌即凭据
      }
    )
  })

  it('大白话：免登全链 fail-closed——无 code 拒（不触外部调用）、无缓存令牌拒、code 失效拒、身份未绑账号拒、账号停用拒且不签发', async () => {
    let fetchHits = 0
    await withFetch(
      () => {
        fetchHits++
        return { errcode: 40029 } // code 失效
      },
      async () => {
        expect((await post('loginByWecomCode', '', {}, '2.2.2.2')).status).toBe(400) // 无 code
        expect(fetchHits).toBe(0) // 未触外部调用
        expect((await post('loginByWecomCode', '', { code: 'c' }, '3.3.3.3')).status).toBe(503) // 无缓存令牌
        seedToken()
        expect((await post('loginByWecomCode', '', { code: 'c' }, '4.4.4.4')).status).toBe(401) // BAD_CODE
      }
    )
    await withFetch(
      (url) => (url.includes('auth/getuserinfo') ? { errcode: 0, userid: 'w-unknown' } : { errcode: 0 }),
      async () => {
        expect((await post('loginByWecomCode', '', { code: 'c' }, '5.5.5.5')).error).toBe('NO_BOUND_ACCOUNT')
      }
    )
    // 停用账号：拒且不签发令牌
    control.reset()
    control.seed('adminConfig', [{ _id: 'agent-1', keyHash: sha(A1), role: 'outsourced', wecomUserId: 'w1', disabled: true }])
    seedToken()
    await withFetch(
      (url) => (url.includes('auth/getuserinfo') ? { errcode: 0, userid: 'w1' } : { errcode: 0 }),
      async () => {
        const r = await post('loginByWecomCode', '', { code: 'c' }, '6.6.6.6')
        expect(r.status).toBe(403)
        expect(r.error).toBe('ACCOUNT_DISABLED')
        expect(control.dump('adminConfig').find((a: any) => a._id === 'agent-1').sessions).toBeFalsy() // 未签发
      }
    )
  })
})
