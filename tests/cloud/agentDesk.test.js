import { describe, it, expect, beforeEach } from 'vitest'
import cloud, { control } from 'wx-server-sdk'
import {
  listQueue,
  claimConversation,
  releaseConversation,
  sendAgentMessage,
  getThread,
  setAgentStatus,
  escalateToMerchant,
  closeConversation,
} from '../../packages/cloud/src/functions/admin/adminApi/actions/agentDesk'
import { ROLES } from '../../packages/cloud/src/functions/admin/adminApi/lib'

// 承面 C 外包会话工作台·坐席台后端（B6.1–6.3·契约 shared/csAgentDesk.ts）。行为锁：
//   状态流转走声明流转（守卫 order-transitions-declared）+ 分配 scope（外包只操作自己 claim·守卫 outsourced-reads-scoped
//   待车道C合并）+ 接待窗口/上限 + 发送经 kfSend 接缝（守卫 kf-send-server-gated）+ bounded 读（capacity-reads-bounded）。
const db = cloud.database()
const OUT = { agentId: 'agent:out1', caps: ['customer:view', 'agent:handle'] } // 外包坐席1
const OUT2 = { agentId: 'agent:out2', caps: ['customer:view', 'agent:handle'] } // 外包坐席2（越权对照）
const SUPER = { agentId: 'admin', caps: ['*'] } // 商户超管
const ctx = (data, who = OUT) => ({ db, cloud, data, drafts: {}, agentId: who.agentId, caps: who.caps })
const parse = (res) => ({ status: res.statusCode, ...JSON.parse(res.body) })
const sid = (kf, euid) => 'wxkf:' + kf + ':' + euid
// 会话种子：确定性 _id=wxkf:<kf>:<euid>·状态机字段
const seedSession = (euid, status, extra = {}) =>
  control.seed('csSession', [
    { _id: sid('wk1', euid), status, externalUserId: euid, openKfId: 'wk1', createdAt: extra.createdAt || 1000, updatedAt: extra.updatedAt || 1000, ...extra },
  ])

beforeEach(() => {
  control.reset()
  control.setOpenId('') // 服务端上下文（callFunction 到 kfSend 走 isServerCall）
  control.setCallFunctionResult({ result: { ok: true, sent: true, errcode: 0, msgid: 'm1' } }) // kfSend 默认成功
})

describe('cap wire（§1 定稿·外包最小权 agent:handle）', () => {
  it('ROLES.outsourced=仅 agent:handle（master 整合收窄·去裸 customer:view 闭合批量导出·不含全权 *）', () => {
    expect(ROLES.outsourced).toContain('agent:handle')
    expect(ROLES.outsourced).not.toContain('customer:view') // 外包看 360 只走 claim 会话 scoped 路径·不能直调 getCustomer360 遍历
    expect(ROLES.outsourced).not.toContain('*')
  })
})

describe('① listQueue：待接队列（pending·FIFO·bounded cursor/limit）', () => {
  it('只列 pending·按 createdAt 升序（FIFO·先到先接）', async () => {
    seedSession('eA', 'pending', { createdAt: 3000 })
    seedSession('eB', 'pending', { createdAt: 1000 })
    seedSession('eC', 'active', { createdAt: 2000, agentId: 'agent:out1' }) // active 不进待接队列
    const r = parse(await listQueue(ctx({})))
    expect(r.ok).toBe(true)
    expect(r.items.map((i) => i.externalUserId)).toEqual(['eB', 'eA']) // 1000<3000·FIFO
    expect(r.items.every((i) => i.status === 'pending')).toBe(true)
  })

  it('cursor 分页：limit=1 逐页取全（bounded·不静默挤出）', async () => {
    seedSession('e1', 'pending', { createdAt: 1000 })
    seedSession('e2', 'pending', { createdAt: 2000 })
    const p1 = parse(await listQueue(ctx({ limit: 1 })))
    expect(p1.items).toHaveLength(1)
    expect(p1.items[0].externalUserId).toBe('e1')
    expect(p1.nextCursor).toBe(1000)
    const p2 = parse(await listQueue(ctx({ limit: 1, cursor: p1.nextCursor })))
    expect(p2.items[0].externalUserId).toBe('e2')
  })
})

describe('② claimConversation：pending/escalated→active·绑 agentId·接待上限', () => {
  it('pending→active·绑本坐席 agentId + claimedAt·返 SessionView', async () => {
    seedSession('e1', 'pending')
    const r = parse(await claimConversation(ctx({ sessionId: sid('wk1', 'e1') })))
    expect(r.ok).toBe(true)
    expect(r.session.status).toBe('active')
    expect(r.session.agentId).toBe('agent:out1')
    expect(r.session.claimedAt).toBeGreaterThan(0)
    expect(control.dump('csSession')[0].status).toBe('active')
  })

  it('escalated→active：商户重新接手升级会话', async () => {
    seedSession('e1', 'escalated', { agentId: 'agent:out1' })
    const r = parse(await claimConversation(ctx({ sessionId: sid('wk1', 'e1') }, SUPER)))
    expect(r.ok).toBe(true)
    expect(r.session.status).toBe('active')
    expect(r.session.agentId).toBe('admin') // 重认领改归属
  })

  it('并发/非可接态：已 active 再 claim → NOT_CLAIMABLE（幂等·不重复认领）', async () => {
    seedSession('e1', 'active', { agentId: 'agent:out2' })
    const r = parse(await claimConversation(ctx({ sessionId: sid('wk1', 'e1') })))
    expect(r.ok).toBe(false)
    expect(r.error).toBe('NOT_CLAIMABLE')
  })

  it('接待上限：activeCount≥limit → AT_CAPACITY（派生计数·B6.3）', async () => {
    control.seed('agentState', [{ _id: 'agent:out1', status: 'online', limit: 1, updatedAt: 1 }])
    seedSession('busy1', 'active', { agentId: 'agent:out1' }) // 已接 1 通（满额）
    seedSession('e1', 'pending')
    const r = parse(await claimConversation(ctx({ sessionId: sid('wk1', 'e1') })))
    expect(r.ok).toBe(false)
    expect(r.error).toBe('AT_CAPACITY')
    expect(control.dump('csSession').find((s) => s.externalUserId === 'e1').status).toBe('pending') // 未被接
  })

  it('无认证坐席身份 → NO_AGENT（不信前端·不认领）', async () => {
    seedSession('e1', 'pending')
    const r = parse(await claimConversation({ db, cloud, data: { sessionId: sid('wk1', 'e1') }, drafts: {} }))
    expect(r.status).toBe(403)
    expect(r.error).toBe('NO_AGENT')
  })

  it('会话不存在 → NOT_FOUND', async () => {
    const r = parse(await claimConversation(ctx({ sessionId: 'wxkf:wk1:nope' })))
    expect(r.status).toBe(404)
  })
})

describe('③ releaseConversation：active→pending 退回·清归属·分配 scope', () => {
  it('owner 放手：active→pending·清 agentId（重回队列）', async () => {
    seedSession('e1', 'active', { agentId: 'agent:out1', claimedAt: 5 })
    const r = parse(await releaseConversation(ctx({ sessionId: sid('wk1', 'e1') })))
    expect(r.ok).toBe(true)
    const s = control.dump('csSession')[0]
    expect(s.status).toBe('pending')
    expect(s.agentId).toBeNull()
  })

  it('非 owner 外包放手他人会话 → FORBIDDEN（分配 scope·根因#3）', async () => {
    seedSession('e1', 'active', { agentId: 'agent:out1' })
    const r = parse(await releaseConversation(ctx({ sessionId: sid('wk1', 'e1') }, OUT2)))
    expect(r.status).toBe(403)
    expect(r.error).toBe('FORBIDDEN')
  })

  it('超管可放手任意会话（全量·isSuper）', async () => {
    seedSession('e1', 'active', { agentId: 'agent:out1' })
    expect(parse(await releaseConversation(ctx({ sessionId: sid('wk1', 'e1') }, SUPER))).ok).toBe(true)
  })

  it('非 active → NOT_ACTIVE（幂等）', async () => {
    seedSession('e1', 'pending')
    expect(parse(await releaseConversation(ctx({ sessionId: sid('wk1', 'e1') }, SUPER))).error).toBe('NOT_ACTIVE')
  })
})

describe('④ sendAgentMessage：坐席回复·经 kfSend·出站落 conversations·越权/越窗闸', () => {
  it('owner 对 active 会话发：经 kfSend 发 + 出站归档 conversations', async () => {
    seedSession('e1', 'active', { agentId: 'agent:out1', openid: 'openid-1' })
    const r = parse(await sendAgentMessage(ctx({ sessionId: sid('wk1', 'e1'), text: '你好~' })))
    expect(r.ok).toBe(true)
    expect(r.errcode).toBe(0)
    // 经 cs/kfSend 服务端接缝发（参数正确）
    const calls = control.callFunctionCalls()
    expect(calls.some((c) => c.name === 'kfSend' && c.data.text === '你好~' && c.data.externalUserId === 'e1' && c.data.openKfId === 'wk1')).toBe(true)
    // 出站落档（direction:out·带坐席身份·可检索/质检）
    const out = control.dump('conversations').find((m) => m.direction === 'out')
    expect(out).toMatchObject({ direction: 'out', text: '你好~', externalUserId: 'e1', openid: 'openid-1', agentId: 'agent:out1', channel: 'wxkf' })
  })

  it('非 owner 外包发他人会话 → FORBIDDEN·不发（分配 scope·§1.5）', async () => {
    seedSession('e1', 'active', { agentId: 'agent:out1' })
    const r = parse(await sendAgentMessage(ctx({ sessionId: sid('wk1', 'e1'), text: 'x' }, OUT2)))
    expect(r.status).toBe(403)
    expect(control.callFunctionCalls()).toHaveLength(0)
  })

  it('会话非 active（接待窗口外）→ NOT_ACTIVE·不发（防越窗发已结束/未接会话）', async () => {
    seedSession('e1', 'pending')
    const r = parse(await sendAgentMessage(ctx({ sessionId: sid('wk1', 'e1'), text: 'x' }, SUPER)))
    expect(r.error).toBe('NOT_ACTIVE')
    expect(control.callFunctionCalls()).toHaveLength(0)
  })

  it('kfSend 失败（errcode 非0·如 95018 窗外）→ 带回 errcode·不归档', async () => {
    control.setCallFunctionResult({ result: { ok: true, sent: false, errcode: 95018 } })
    seedSession('e1', 'active', { agentId: 'agent:out1' })
    const r = parse(await sendAgentMessage(ctx({ sessionId: sid('wk1', 'e1'), text: 'x' })))
    expect(r.ok).toBe(true)
    expect(r.errcode).toBe(95018)
    expect(control.dump('conversations').filter((m) => m.direction === 'out')).toHaveLength(0)
  })

  it('空文本 → BAD_ARGS', async () => {
    seedSession('e1', 'active', { agentId: 'agent:out1' })
    expect(parse(await sendAgentMessage(ctx({ sessionId: sid('wk1', 'e1'), text: '' }))).status).toBe(400)
  })
})

describe('⑤ getThread：会话消息流·cursor 增量·分配 scope·bounded', () => {
  it('owner 读本通会话消息（asc·scope 到会话建起）+ openid 桥接', async () => {
    seedSession('e1', 'active', { agentId: 'agent:out1', createdAt: 1000 })
    control.seed('kfIdentity', [{ _id: 'ext:e1', openid: 'openid-1' }])
    control.seed('conversations', [
      { _id: 'old', externalUserId: 'e1', openKfId: 'wk1', direction: 'in', text: '会话前的历史', at: 500 }, // < createdAt·排除
      { _id: 'c1', externalUserId: 'e1', openKfId: 'wk1', direction: 'in', text: '在吗', at: 1200 },
      { _id: 'c2', externalUserId: 'e1', openKfId: 'wk1', direction: 'out', text: '在的', at: 1300 },
    ])
    const r = parse(await getThread(ctx({ sessionId: sid('wk1', 'e1') })))
    expect(r.ok).toBe(true)
    expect(r.messages.map((m) => m.text)).toEqual(['在吗', '在的']) // 排除会话建起前的历史·asc
    expect(r.session.openid).toBe('openid-1') // 身份桥接补 openid（供 360 侧栏）
    expect(r.nextCursor).toBe(1300)
  })

  it('cursor 增量：只取游标之后的新消息（前端轮询）', async () => {
    seedSession('e1', 'active', { agentId: 'agent:out1', createdAt: 1000 })
    control.seed('conversations', [
      { _id: 'c1', externalUserId: 'e1', openKfId: 'wk1', direction: 'in', text: '旧', at: 1200 },
      { _id: 'c2', externalUserId: 'e1', openKfId: 'wk1', direction: 'in', text: '新', at: 1400 },
    ])
    const r = parse(await getThread(ctx({ sessionId: sid('wk1', 'e1'), cursor: 1300 })))
    expect(r.messages.map((m) => m.text)).toEqual(['新'])
  })

  it('非 owner 外包读他人会话 → FORBIDDEN（分配 scope·防批量导出·§1.5）', async () => {
    seedSession('e1', 'active', { agentId: 'agent:out1' })
    expect(parse(await getThread(ctx({ sessionId: sid('wk1', 'e1') }, OUT2))).status).toBe(403)
  })
})

describe('⑥ setAgentStatus：写 agentState（online/busy/offline）', () => {
  it('写本坐席在线态（首次建 doc·默认上限）', async () => {
    const r = parse(await setAgentStatus(ctx({ status: 'online' })))
    expect(r.ok).toBe(true)
    const st = control.dump('agentState').find((a) => a._id === 'agent:out1')
    expect(st).toMatchObject({ status: 'online', limit: 5 })
  })

  it('保留已配接待上限（切态不重置 limit）', async () => {
    control.seed('agentState', [{ _id: 'agent:out1', status: 'online', limit: 3, updatedAt: 1 }])
    await setAgentStatus(ctx({ status: 'busy' }))
    const st = control.dump('agentState').find((a) => a._id === 'agent:out1')
    expect(st).toMatchObject({ status: 'busy', limit: 3 })
  })

  it('非法态 → BAD_ARGS；无坐席身份 → NO_AGENT', async () => {
    expect(parse(await setAgentStatus(ctx({ status: 'ghost' }))).status).toBe(400)
    expect(parse(await setAgentStatus({ db, cloud, data: { status: 'online' }, drafts: {} })).error).toBe('NO_AGENT')
  })
})

describe('⑦ escalateToMerchant：active→escalated·甩回商户（外包最小权只能升）', () => {
  it('owner 升级：active→escalated·保留 agentId（记谁升的）', async () => {
    seedSession('e1', 'active', { agentId: 'agent:out1' })
    const r = parse(await escalateToMerchant(ctx({ sessionId: sid('wk1', 'e1') })))
    expect(r.ok).toBe(true)
    const s = control.dump('csSession')[0]
    expect(s.status).toBe('escalated')
    expect(s.agentId).toBe('agent:out1')
  })

  it('非 owner → FORBIDDEN；非 active → NOT_ACTIVE', async () => {
    seedSession('e1', 'active', { agentId: 'agent:out1' })
    expect(parse(await escalateToMerchant(ctx({ sessionId: sid('wk1', 'e1') }, OUT2))).status).toBe(403)
    seedSession('e2', 'pending')
    expect(parse(await escalateToMerchant(ctx({ sessionId: sid('wk1', 'e2') }, SUPER))).error).toBe('NOT_ACTIVE')
  })
})

describe('⑧ closeConversation：→closed（终态·触 CSAT）', () => {
  it('owner 结束 active → closed + 发 CSAT 评分提示', async () => {
    seedSession('e1', 'active', { agentId: 'agent:out1' })
    const r = parse(await closeConversation(ctx({ sessionId: sid('wk1', 'e1') })))
    expect(r.ok).toBe(true)
    expect(control.dump('csSession')[0].status).toBe('closed')
    // 触 CSAT：best-effort 经 kfSend 发评分提示（顾客回复 1-5 由 kfCallback recordCsat 归档）
    const csat = control.callFunctionCalls().find((c) => c.name === 'kfSend' && /满意/.test(c.data.text))
    expect(csat).toBeTruthy()
  })

  it('超管关 pending（弃排队）→ closed·不发 CSAT（未接待过）', async () => {
    seedSession('e1', 'pending')
    const r = parse(await closeConversation(ctx({ sessionId: sid('wk1', 'e1') }, SUPER)))
    expect(r.ok).toBe(true)
    expect(control.dump('csSession')[0].status).toBe('closed')
    expect(control.callFunctionCalls().filter((c) => c.name === 'kfSend')).toHaveLength(0)
  })

  it('非 owner → FORBIDDEN；已 closed 再关 → ALREADY_CLOSED（幂等终态）', async () => {
    seedSession('e1', 'active', { agentId: 'agent:out1' })
    expect(parse(await closeConversation(ctx({ sessionId: sid('wk1', 'e1') }, OUT2))).status).toBe(403)
    seedSession('e2', 'closed', { agentId: 'agent:out1' })
    expect(parse(await closeConversation(ctx({ sessionId: sid('wk1', 'e2') }))).error).toBe('ALREADY_CLOSED')
  })
})
