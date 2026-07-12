// 黄金 cs-agent §一（会话状态机与认领互斥）/§二（scoped 360 双闸）/§四（坐席发送与归档）/§七（关单触 CSAT）
// /§十（企微免登与外包账号管理）（守卫 rw-admin6-golden）。
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { control } from 'wx-server-sdk'
import { main as adminApi } from '../src/functions/adminApi/index'
import { sha, kdf, keyMatches } from '../src/functions/adminApi/lib'
import { getDb } from '../src/kit'

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

  it('大白话：Round8——同 createdAt 撞分页边界不丢条不重复（listQueue 接 pageQuery 复合游标 tiebreaker）', async () => {
    control.seed('csSession', [
      S('t1', 'pending', { createdAt: 100 }),
      S('t2', 'pending', { createdAt: 100 }),
      S('t3', 'pending', { createdAt: 100 }),
      S('t4', 'pending', { createdAt: 200 }),
    ])
    const seen: string[] = []
    let cursor: unknown
    for (let round = 0; round < 5; round++) {
      const p = await post('listQueue', A1, cursor === undefined ? { limit: 2 } : { limit: 2, cursor })
      for (const it of p.items) {
        expect(seen.includes(it.sessionId)).toBe(false) // 旧手写 gt(createdAt) bug：同值记录会被跳过或漏
        seen.push(it.sessionId)
      }
      if (p.nextCursor === undefined) break
      cursor = p.nextCursor
    }
    expect(seen).toEqual(['t1', 't2', 't3', 't4']) // FIFO 全量、逐页不丢不重
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

describe('坐席在线状态（F2·写失败不再吞）', () => {
  it('大白话：写库失败即 ok:false（不再无条件 ok:true）——前端锚不会信一个其实没写进去的状态；写成功仍 ok:true', async () => {
    // 注入 agentState.doc().set() 失败（DocRef.set() 复用 beforeUpdate 钩子·同既有 saveShowcase 范式）
    control.setBeforeUpdate(({ coll }: any) => {
      if (coll === 'agentState') throw new Error('MOCK_SET_FAIL')
    })
    const bad = await post('setAgentStatus', A1, { status: 'busy' })
    control.setBeforeUpdate(null as never)
    expect(bad.ok).toBe(false) // 原代码 .catch(()=>{}) 吞错会恒回 ok:true——坐席状态与库脱节
    expect(bad.error).toBe('WRITE_FAIL')
    const anomalies = control.dump('anomalies')
    expect(anomalies.some((a: any) => a.code === 'WRITE_FAIL')).toBe(true) // 真留痕（病根14）
    const ok = await post('setAgentStatus', A1, { status: 'busy' })
    expect(ok.ok).toBe(true)
    expect(control.dump('agentState').find((s: any) => s._id === 'agent-1').status).toBe('busy')
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

  it('大白话：入站消息投影带 msgid（从确定性 _id 剥出，供坐席台去重·bug sweep II L1）；出站消息无 msgid', async () => {
    control.seed('conversations', [
      { _id: 'wxkf:in:msg-a', direction: 'in', externalUserId: 'eu-s1', openKfId: 'kf1', msgtype: 'image', text: '[image]', mediaId: 'media-a', at: 2000 },
      { _id: 'wxkf:in:msg-b', direction: 'in', externalUserId: 'eu-s1', openKfId: 'kf1', msgtype: 'image', text: '[image]', at: 2000 }, // 同秒同占位文·不同 msgid·无 mediaId
      { _id: 'out-auto-1', direction: 'out', externalUserId: 'eu-s1', openKfId: 'kf1', msgtype: 'text', text: '收到', at: 2500 },
    ])
    const r = await post('getThread', A1, { sessionId: 's1' })
    const [a, b, c] = r.messages
    expect(a.msgid).toBe('msg-a')
    expect(b.msgid).toBe('msg-b') // 同秒不同 msgid·各自可辨，不被坐席台去重键误杀
    expect(c.msgid).toBeUndefined() // 出站消息无 msgid 语义·原样回空
    expect(a.hasMedia).toBe(true) // B5：有 mediaId → 坐席台渲染图片气泡
    expect(b.hasMedia).toBe(false) // 无 mediaId/fileId → 不渲染
  })
})

describe('顾客发图坐席可见（B5·图片消息下载延迟到坐席首次请求·平台接缝单点#12）', () => {
  beforeEach(() => {
    control.seed('csSession', [S('s1', 'active', { agentId: 'agent-1' }), S('s9', 'active', { agentId: 'agent-2' })])
    control.seed('conversations', [
      // s1 自己会话内的图（未下载·只有 mediaId）
      { _id: 'wxkf:in:img-1', direction: 'in', externalUserId: 'eu-s1', openKfId: 'kf1', msgtype: 'image', text: '[image]', mediaId: 'media-1', at: 1000 },
      // s1 自己会话内已下载过的图（有 fileId 缓存）
      { _id: 'wxkf:in:img-2', direction: 'in', externalUserId: 'eu-s1', openKfId: 'kf1', msgtype: 'image', text: '[image]', mediaId: 'media-2', fileId: 'cloud://test/cs-media/img-2', at: 1100 },
      // s9（agent-2 的会话）里的图——用来验证「借自己会话号偷看别会话的图」被拒
      { _id: 'wxkf:in:img-9', direction: 'in', externalUserId: 'eu-s9', openKfId: 'kf1', msgtype: 'image', text: '[image]', mediaId: 'media-9', at: 1200 },
    ])
  })

  it('大白话：缓存命中直接换临时 URL，不再触发下载接缝', async () => {
    const r = await post('getMediaUrl', A1, { sessionId: 's1', msgId: 'img-2' })
    expect(r.ok).toBe(true)
    expect(r.cached).toBe(true)
    expect(r.url).toContain('cs-media/img-2')
    expect(control.callFunctionCalls().length).toBe(0) // 缓存命中不碰下载接缝
  })

  it('大白话：未下载过的图经 cs/kfMedia 接缝下载并落云存储缓存，回写 fileId 供下次命中缓存', async () => {
    control.setCallFunctionResult({ result: { ok: true, base64: Buffer.from('fake-image-bytes').toString('base64') } })
    const r = await post('getMediaUrl', A1, { sessionId: 's1', msgId: 'img-1' })
    expect(r.ok).toBe(true)
    expect(r.cached).toBe(false)
    expect(control.callFunctionCalls()[0].name).toBe('kfMedia') // 经服务端接缝、非直连微信 API（平台接缝单点#12）
    expect(control.callFunctionCalls()[0].data.mediaId).toBe('media-1')
    const row = control.dump('conversations').find((m: any) => m._id === 'wxkf:in:img-1')
    expect(row.fileId).toBeTruthy() // 回写缓存·下次命中缓存分支
  })

  it('大白话：media_id 过期（3 天有效）如实回 EXPIRED，不当成普通下载失败', async () => {
    control.setCallFunctionResult({ result: { ok: false, expired: true, errcode: 40007 } })
    const r = await post('getMediaUrl', A1, { sessionId: 's1', msgId: 'img-1' })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('EXPIRED')
  })

  it('大白话：下载/上传失败留痕告警且如实返错——不重试风暴（前端手动重试）', async () => {
    control.setCallFunctionResult({ result: { ok: false, expired: false, errcode: 40014 } })
    const r = await post('getMediaUrl', A1, { sessionId: 's1', msgId: 'img-1' })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('DOWNLOAD_FAILED')
    expect(control.dump('anomalies').some((a: any) => a.code === 'MEDIA_DOWNLOAD_FAILED')).toBe(true) // 动作类失败禁静默（根因#14）
  })

  it('大白话：非所属会话一律拒（分配 scope）；非本会话的消息即便自己会话号也拒（防跨会话拉图）', async () => {
    expect((await post('getMediaUrl', A1, { sessionId: 's9', msgId: 'img-9' })).status).toBe(403) // 非所属会话·scope 闸拒
    // 借自己在接的 s1 号，但传别会话（s9）的 msgId——消息归属校验须拒，即便 scope 闸对 s1 本身放行
    const cross = await post('getMediaUrl', A1, { sessionId: 's1', msgId: 'img-9' })
    expect(cross.ok).toBe(false)
    expect(cross.error).toBe('NOT_IN_SESSION')
    expect(control.callFunctionCalls().length).toBe(0) // 无副作用·没碰下载接缝
  })

  it('大白话：消息不存在/非图片消息如实回；参数缺失拒', async () => {
    expect((await post('getMediaUrl', A1, { sessionId: 's1', msgId: 'nope' })).error).toBe('MSG_NOT_FOUND')
    expect((await post('getMediaUrl', A1, { sessionId: 's1' })).error).toBe('BAD_ARGS')
    control.seed('conversations', [{ _id: 'wxkf:in:txt-1', direction: 'in', externalUserId: 'eu-s1', openKfId: 'kf1', msgtype: 'text', text: '在吗', at: 900 }])
    expect((await post('getMediaUrl', A1, { sessionId: 's1', msgId: 'txt-1' })).error).toBe('NO_MEDIA') // 文本消息无 mediaId
  })

  it('大白话：增量轮询回退一秒重查——坐席回复后同秒（秒级截断）晚到的顾客消息不被 gt 游标永久跳过（深审 P2）', async () => {
    // 出站回复 ms 级 at=3400 把 cursor 推到 3400；顾客同秒消息归档 at=3000（send_time*1000 秒级截断·<cursor）
    control.seed('conversations', [
      { _id: 'wxkf:in:early', direction: 'in', externalUserId: 'eu-s1', openKfId: 'kf1', msgtype: 'text', text: '问题', at: 3000 },
      { _id: 'out-reply', direction: 'out', externalUserId: 'eu-s1', openKfId: 'kf1', msgtype: 'text', text: '在的', at: 3400 },
    ])
    const first = await post('getThread', A1, { sessionId: 's1' })
    expect(first.nextCursor).toBe(3400) // 游标推到出站 ms 级 at
    // 顾客在同一秒又发一条（晚到·秒级截断 at=3000·< cursor 3400）
    control.seed('conversations', [
      { _id: 'wxkf:in:late', direction: 'in', externalUserId: 'eu-s1', openKfId: 'kf1', msgtype: 'text', text: '补充', at: 3000 },
    ])
    const second = await post('getThread', A1, { sessionId: 's1', cursor: first.nextCursor })
    // 回退一秒重查窗命中晚到消息（旧 gt(3400) 会永久跳过它·坐席看漏顾客消息）；重复项交客户端 msgid 去重
    expect(second.messages.some((m: any) => m.msgid === 'late')).toBe(true)
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
  it('大白话：建号口令加盐存哈希（批6·scrypt，非裸 sha）；新号立即能登录并派生最小权；短口令/撞口令（legacy 存量与带盐新号两种在场形态）拒；外包自己不能建号', async () => {
    const r = await post('createAgent', SUPER, { name: '外包三号', key: 'brand-new-key-3' })
    expect(r.ok).toBe(true)
    const doc = control.dump('adminConfig').find((a: any) => a._id === r.agent.id)
    expect(doc.keySalt).toBeTruthy() // 批6：新建账号带盐
    expect(keyMatches(doc, 'brand-new-key-3')).toBe(true) // 盐感知比对认得出真口令
    expect(doc.keyHash).not.toBe(sha('brand-new-key-3')) // 裸 sha 值不再等于 keyHash（已加盐·非无盐 sha256）
    expect(JSON.stringify(doc)).not.toContain('brand-new-key-3') // 明文不落盘
    const login = await post('login', 'brand-new-key-3')
    expect(login.status).toBe(200)
    expect(login.caps).toEqual(['agent:handle']) // 角色派生最小权
    expect((await post('listQueue', 'brand-new-key-3')).ok).toBe(true) // 新号可干活
    expect((await post('createAgent', SUPER, { name: 'x', key: 'abc' })).error).toBe('KEY_TOO_SHORT')
    expect((await post('createAgent', SUPER, { name: 'x', key: A1 })).status).toBe(409) // 撞 legacy 存量口令（无 keySalt）登录会串号·拒
    expect((await post('createAgent', SUPER, { name: 'y', key: 'brand-new-key-3' })).status).toBe(409) // 撞已带盐新账号口令同样拒（盐感知比对两形态都认得出）
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

  it('大白话：先查后写竞态（P2·根因#1）——createAgent 建号窗口内被并发方撞同一口令（legacy 存量形态），写后复核揪出、回滚自己那份并回 409（不留串号双凭证）', async () => {
    control.setBeforeUpdate(async ({ coll, data }: any) => {
      // 触发标记改用与哈希算法无关的确定性字段（批6·name）——本批把 keyHash 从裸 sha 换成加盐 scrypt 后，
      // 写入的 data.keyHash 不再等于 sha('race-key')，原「按哈希值触发」的写法会失真、mock 永不触发（假绿）。
      if (coll === 'adminConfig' && data && data.name === '并发号') {
        // 「先查」时并发方尚未落库（预检通过）；在本次真正写入前，并发方抢先建号——模拟先查后写窗口
        // （并发方是 legacy 存量账号形态：无 keySalt，keyHash 是裸 sha——keyMatches 单源两种形态都认得出）
        control.seed('adminConfig', [{ _id: 'agent-race', role: 'outsourced', keyHash: sha('race-key'), createdAt: 1 }])
      }
    })
    const r = await post('createAgent', SUPER, { name: '并发号', key: 'race-key' })
    control.setBeforeUpdate(null as never)
    expect(r.status).toBe(409)
    expect(r.error).toBe('KEY_TAKEN')
    // 自己刚建的那份已回滚删除，只剩并发方那一份——绝不留两账号共享同一口令（用 keyMatches 而非裸 keyHash
    // 字符串比对，因为自己那份原会是加盐 kdf 值、并发方是裸 sha 值，两者字面不等但代表同一口令）
    expect(control.dump('adminConfig').filter((a: any) => keyMatches(a, 'race-key')).length).toBe(1)
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

  it('大白话（N3·bug 清除战役II 遗留·病根14）：口令竞态回滚若也失败（撞的是带盐新账号形态）——双凭证残留是身份安全面，必须留痕；409 回复不变', async () => {
    control.setBeforeUpdate(async ({ coll, data }: any) => {
      // 触发标记改用与哈希算法无关的确定性字段（批6·name，同上一用例）
      if (coll === 'adminConfig' && data && data.name === '并发号二') {
        // 撞口令用例覆盖两种在场形态：上一用例是 legacy（无 keySalt），本用例并发方是已带盐新账号形态。
        control.seed('adminConfig', [{ _id: 'agent-race-2', role: 'outsourced', keySalt: 'race-salt-2', keyHash: kdf('race-key-2', 'race-salt-2'), createdAt: 1 }])
      }
    })
    // spy 挂在共享 DocRef 原型上（同 app-admin2.test.ts REMOVE_FAIL 范式·任意已存在 doc 取原型即可）
    const docProto = Object.getPrototypeOf(getDb().collection('adminConfig').doc('auth'))
    const spy = vi.spyOn(docProto, 'remove').mockImplementationOnce(() => Promise.reject(new Error('MOCK_REMOVE_FAIL')))
    let r: any
    try {
      r = await post('createAgent', SUPER, { name: '并发号二', key: 'race-key-2' })
    } finally {
      spy.mockRestore()
      control.setBeforeUpdate(null as never)
    }
    expect(r.status).toBe(409) // 回滚失败不改变返回语义
    expect(r.error).toBe('KEY_TAKEN')
    // 双凭证真残留了（回滚没能撤掉自己那份）——正是要留痕的场景（用 keyMatches 而非裸 keyHash 字符串比对，
    // 因为自己那份是加盐 kdf 值、并发方也是带盐值但盐不同，两者字面不等但都代表同一口令）
    expect(control.dump('adminConfig').filter((a: any) => keyMatches(a, 'race-key-2')).length).toBe(2)
    const anomalies = control.dump('anomalies')
    expect(anomalies.some((a: any) => a.code === 'ROLLBACK_FAIL' && a.ctx && a.ctx.which === 'keyHash')).toBe(true)
  })

  it('大白话（批 B6）：listAgents 看板扩展字段——status/stateUpdatedAt 取 agentState（无档兜底 offline/null）；activeCount/todayClosed 分坐席各算；[今日零点,明天零点) 含起——今日零点整那条算今日、昨天最后一刻的不算', async () => {
    const CST = 8 * 3600_000
    const todayStart = Date.parse(new Date(Date.now() + CST).toISOString().slice(0, 10) + 'T00:00:00+08:00')
    control.seed('agentState', [{ _id: 'agent-1', status: 'online', updatedAt: 999 }]) // agent-2 无档
    control.seed('csSession', [
      { _id: 'act1', agentId: 'agent-1', status: 'active', createdAt: 1, updatedAt: 1 },
      { _id: 'act2', agentId: 'agent-1', status: 'active', createdAt: 1, updatedAt: 1 },
      { _id: 'act3', agentId: 'agent-2', status: 'active', createdAt: 1, updatedAt: 1 },
      { _id: 'clA', agentId: 'agent-1', status: 'closed', createdAt: 1, updatedAt: todayStart + 1000 }, // 今日内
      { _id: 'clB', agentId: 'agent-1', status: 'closed', createdAt: 1, updatedAt: todayStart - 1 }, // 昨天最后一刻·不算
      { _id: 'clC', agentId: 'agent-2', status: 'closed', createdAt: 1, updatedAt: todayStart }, // 今日零点整·含界
    ])
    const r = await post('listAgents', SUPER, {})
    const a1 = r.agents.find((a: any) => a.id === 'agent-1')
    const a2 = r.agents.find((a: any) => a.id === 'agent-2')
    expect(a1.status).toBe('online')
    expect(a1.stateUpdatedAt).toBe(999)
    expect(a1.activeCount).toBe(2)
    expect(a1.todayClosed).toBe(1) // clA 算·clB（昨天）不算
    expect(a2.status).toBe('offline') // 无 agentState 档兜底
    expect(a2.stateUpdatedAt).toBeNull()
    expect(a2.activeCount).toBe(1)
    expect(a2.todayClosed).toBe(1) // clC 今日零点整含界
  })

  it('大白话（N3）：wecomUserId 竞态回滚若也失败——双凭证残留同样留痕；409 回复不变', async () => {
    control.setBeforeUpdate(async ({ coll, data }: any) => {
      if (coll === 'adminConfig' && data && data.wecomUserId === 'w-race-2') {
        control.seed('adminConfig', [{ _id: 'agent-race-3', role: 'outsourced', keyHash: sha('other-key-2'), wecomUserId: 'w-race-2' }])
      }
    })
    const docProto = Object.getPrototypeOf(getDb().collection('adminConfig').doc('auth'))
    const spy = vi.spyOn(docProto, 'remove').mockImplementationOnce(() => Promise.reject(new Error('MOCK_REMOVE_FAIL')))
    let r: any
    try {
      r = await post('createAgent', SUPER, { name: '并发号三', key: 'brand-new-key-4', wecomUserId: 'w-race-2' })
    } finally {
      spy.mockRestore()
      control.setBeforeUpdate(null as never)
    }
    expect(r.status).toBe(409)
    expect(r.error).toBe('WECOM_ID_TAKEN')
    expect(control.dump('adminConfig').filter((a: any) => a.wecomUserId === 'w-race-2').length).toBe(2)
    const anomalies = control.dump('anomalies')
    expect(anomalies.some((a: any) => a.code === 'ROLLBACK_FAIL' && a.ctx && a.ctx.which === 'wecomUserId')).toBe(true)
  })
})

describe('账号扫描上限告警（P2 评审·keyHash 加盐后有界扫描退化为有界候选窗口的可观测性兜底）', () => {
  // adminConfig 带 keyHash 的账号超过扫描上限时，checkKey/createAgent 的有界扫描候选窗口可能装不下
  // 目标账号（合法口令静默登录失败/撞口令回滚安全网形同虚设）——本组只验「命中上限时留痕告警」，
  // 不验「真的漏掉某账号」（后者需要构造超过 50 条+特定顺序才能稳定复现，超出本条留痕修复的范围）。
  const seedManyAccounts = (n: number) => {
    const rows = []
    for (let i = 0; i < n; i++) rows.push({ _id: 'bulk-' + i, role: 'outsourced', keyHash: sha('bulk-key-' + i), createdAt: i })
    control.seed('adminConfig', rows)
  }

  it('大白话：checkKey 多账号扫描命中上限时留痕告警；登录返回语义不变', async () => {
    seedManyAccounts(50) // + beforeEach 的 auth/agent-1/agent-2 共 53 行带 keyHash，必过扫描上限
    const r = await post('login', 'no-such-key')
    expect(r.status).toBe(401) // 未命中口令仍如实拒——告警不改变控制流
    const anomalies = control.dump('anomalies')
    expect(anomalies.some((a: any) => a.code === 'ACCOUNT_SCAN_AT_CAP' && a.ctx && a.ctx.fn === 'checkKey')).toBe(true)
  })

  it('大白话：createAgent 撞口令预检/写后复核扫描命中上限时同样留痕告警；建号本身不受影响', async () => {
    seedManyAccounts(50)
    const r = await post('createAgent', SUPER, { name: '批量后建号', key: 'brand-new-bulk-key' })
    expect(r.ok).toBe(true)
    const anomalies = control.dump('anomalies')
    expect(anomalies.some((a: any) => a.code === 'ACCOUNT_SCAN_AT_CAP' && a.ctx && a.ctx.fn === 'createAgent.dupScan')).toBe(true)
    expect(anomalies.some((a: any) => a.code === 'ACCOUNT_SCAN_AT_CAP' && a.ctx && a.ctx.fn === 'createAgent.keyDupScan')).toBe(true)
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
