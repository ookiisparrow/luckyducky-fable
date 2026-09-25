// 首响配对口径锁：conversationsReport 与 sampleQc 的按客户聚合共用「入站配其后首个出站」。
import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main as adminApi } from '../src/functions/adminApi/index'
import { sha } from '../src/functions/adminApi/lib'

const SUPER = 'super-secret-key'
const post = (action: string, data: Record<string, unknown> = {}) =>
  adminApi({
    httpMethod: 'POST',
    headers: { 'x-forwarded-for': '1.1.1.1' },
    body: JSON.stringify({ action, key: SUPER, data }),
  }).then((r: any) => ({ status: r.statusCode, ...JSON.parse(r.body) }))

const m = (id: string, euid: string, direction: string, at: number) => ({ _id: id, channel: 'wxkf', direction, externalUserId: euid, at })

beforeEach(() => {
  control.reset()
  control.seed('adminConfig', [{ _id: 'auth', keyHash: sha(SUPER), role: 'superadmin' }])
  control.seed('conversations', [
    // A：连发两条后一并答复、再问再答、最后一条没人回
    m('a1', 'euA', 'in', 1000),
    m('a2', 'euA', 'in', 3000),
    m('a3', 'euA', 'out', 7000),
    m('a4', 'euA', 'in', 8000),
    m('a5', 'euA', 'out', 8500),
    m('a6', 'euA', 'in', 9000),
    // B：只有入站之前的出站——未答复
    m('b1', 'euB', 'out', 500),
    m('b2', 'euB', 'in', 1000),
    // C：入站 at=0 也照常配对
    m('c1', 'euC', 'in', 0),
    m('c2', 'euC', 'out', 2000),
  ])
})

describe('首响配对口径', () => {
  it('大白话：报表——每条入站配其后首个出站；其后无出站记未答复', async () => {
    const r = await post('conversationsReport', { slaMs: 3000 })
    expect(r.volume).toEqual({ messages: 10, inbound: 6, outbound: 4, customers: 3 })
    expect(r.response).toEqual({ avgResponseMs: 3125, maxResponseMs: 6000, answered: 4, unanswered: 2, answeredRate: 66.7 })
    expect(r.sla).toEqual({ slaMs: 3000, breaches: 2, breachRate: 50, unanswered: 2 })
  })

  it('大白话：抽检行按客户聚合——消息数与首响均值同口径', async () => {
    control.seed('csSession', [{ _id: 'wxkf:kf1:euA', status: 'closed', externalUserId: 'euA', updatedAt: 1 }])
    const r = await post('sampleQc', { count: 1 })
    expect(r.sampled[0]).toMatchObject({ messageCount: 6, avgResponseMs: 3500 })
  })
})
