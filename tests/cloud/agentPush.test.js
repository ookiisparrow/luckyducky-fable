import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import cloud, { control } from 'wx-server-sdk'
import { sendAppMessage, sendAgentCard } from '../../packages/cloud/src/kit'
import { enqueueSession } from '../../packages/cloud/src/functions/cs/kfCallback/dispatch'

// M⑦ 承面C 增强·推送线（应用消息主动推坐席手机）：
//  - sendAppMessage = 原始单接缝（message/send·守卫 app-message-single-seam）；
//  - sendAgentCard = fail-soft 编排（取缓存令牌 + agentid·未配/无令牌/无收件人静默跳过）；
//  - enqueueSession 真正新入队 → notifyOnlineAgents 推在线坐席（fail-soft·不反噬入队·守卫 enqueue-push-fail-soft）。
const db = cloud.database()
const seedToken = () =>
  control.seed('kfState', [{ _id: 'token', accessToken: 'TKN', expireAt: Date.now() + 3600_000 }])
const onlineAgent = (id, wecomUserId) => {
  control.seed('agentState', [{ _id: id, status: 'online' }])
  control.seed('adminConfig', [{ _id: id, role: 'outsourced', wecomUserId }])
}

let savedFetch
beforeEach(() => {
  control.reset()
  savedFetch = globalThis.fetch
  process.env.WXKF_AGENTID = '1000002'
})
afterEach(() => {
  globalThis.fetch = savedFetch
  delete process.env.WXKF_AGENTID
})

describe('sendAppMessage 原始接缝（应用消息 payload）', () => {
  it('touser 用 | 连接·msgtype=textcard·带 agentid·默认 btntxt', async () => {
    let captured = null
    const fetchImpl = async (url, opts) => {
      captured = { url, body: JSON.parse(opts.body) }
      return { json: async () => ({ errcode: 0 }) }
    }
    await sendAppMessage(
      'TKN',
      { agentid: '1000002', touser: ['LiSi', 'WangWu'], textcard: { title: 'T', description: 'D', url: 'https://x/agent/?session=s1' } },
      fetchImpl,
    )
    expect(captured.url).toContain('/message/send?access_token=TKN')
    expect(captured.body.touser).toBe('LiSi|WangWu')
    expect(captured.body.msgtype).toBe('textcard')
    expect(captured.body.agentid).toBe('1000002')
    expect(captured.body.textcard.btntxt).toBe('接待') // 默认按钮文案
  })
})

describe('sendAgentCard fail-soft 编排', () => {
  it('无收件人 / 无 agentid / 无缓存令牌 → 静默跳过（不发·不抛）', async () => {
    let called = 0
    globalThis.fetch = async () => {
      called++
      return { json: async () => ({ errcode: 0 }) }
    }
    seedToken()
    await sendAgentCard(db, [], { title: 't', description: 'd', url: 'u' }) // 无收件人
    delete process.env.WXKF_AGENTID
    await sendAgentCard(db, ['LiSi'], { title: 't', description: 'd', url: 'u' }) // 无 agentid
    process.env.WXKF_AGENTID = '1000002'
    control.reset() // 清掉令牌
    await sendAgentCard(db, ['LiSi'], { title: 't', description: 'd', url: 'u' }) // 无缓存令牌
    expect(called).toBe(0)
  })
  it('有令牌 + agentid + 收件人 → 发出', async () => {
    let sentTo = null
    globalThis.fetch = async (url, opts) => {
      if (String(url).includes('/message/send')) sentTo = JSON.parse(opts.body).touser
      return { json: async () => ({ errcode: 0 }) }
    }
    seedToken()
    await sendAgentCard(db, ['LiSi'], { title: 't', description: 'd', url: 'u' })
    expect(sentTo).toBe('LiSi')
  })
})

describe('enqueueSession 推送在线坐席（M⑦）', () => {
  it('新入队 → 推在线坐席的 wecomUserId', async () => {
    let sentTo = null
    globalThis.fetch = async (url, opts) => {
      if (String(url).includes('/message/send')) sentTo = JSON.parse(opts.body).touser
      return { json: async () => ({ errcode: 0 }) }
    }
    seedToken()
    onlineAgent('agent:1', 'LiSi')
    await enqueueSession(db, 'KF-1', 'EXT-9')
    // 会话已入队
    const s = control.dump('csSession').find((x) => x._id === 'wxkf:KF-1:EXT-9')
    expect(s.status).toBe('pending')
    // 推给了在线坐席
    expect(sentTo).toBe('LiSi')
  })
  it('已 pending/active 的会话再来消息 → 不重复推（不骚扰坐席）', async () => {
    let calls = 0
    globalThis.fetch = async (url) => {
      if (String(url).includes('/message/send')) calls++
      return { json: async () => ({ errcode: 0 }) }
    }
    seedToken()
    onlineAgent('agent:1', 'LiSi')
    await enqueueSession(db, 'KF-1', 'EXT-9') // 首次入队 → 推 1 次
    await enqueueSession(db, 'KF-1', 'EXT-9') // 已 pending → 撞 id → 不推
    expect(calls).toBe(1)
  })
  it('fail-soft：推送发送抛错 → enqueueSession 仍完成 + 会话已入队（不反噬转人工·守卫 enqueue-push-fail-soft）', async () => {
    globalThis.fetch = async () => {
      throw new Error('network down')
    }
    seedToken()
    onlineAgent('agent:1', 'LiSi')
    await expect(enqueueSession(db, 'KF-1', 'EXT-FAIL')).resolves.toBeUndefined() // 不抛
    const s = control.dump('csSession').find((x) => x._id === 'wxkf:KF-1:EXT-FAIL')
    expect(s.status).toBe('pending') // 入队照常
  })
})
