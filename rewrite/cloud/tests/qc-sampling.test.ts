// 质检抽检（批 B7·板块#11 续）：sampleQc/saveQcMark/listQcSampled 三 action。
// 鉴权：均超管默认（未登记 ACTION_CAPS→ADMIN_DEFAULT_CAP='admin:write'）·坐席（cap 仅 agent:handle）403 不可达。
// 审计：sampleQc/saveQcMark 走 shouldAudit 现行装置自动留痕（非 list/get/upload 起首）。
import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { getDb } from '../src/kit/db'
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

describe('sampleQc（候选池=closed 会话·内存过滤未质检·随机抽样并标记）', () => {
  it('大白话：只从 closed 且无 qc/qcSampledAt 的会话里抽；已评/已抽过的不再进候选；抽中即写 qcSampledAt', async () => {
    control.seed('csSession', [
      { _id: 'wxkf:kf1:eu1', status: 'closed', externalUserId: 'eu1', updatedAt: 5000 },
      { _id: 'wxkf:kf1:eu2', status: 'closed', externalUserId: 'eu2', updatedAt: 4000, qc: { score: 5, note: '', by: 'admin', at: 1 } }, // 已评·不该再抽
      { _id: 'wxkf:kf1:eu3', status: 'closed', externalUserId: 'eu3', updatedAt: 3000, qcSampledAt: 999 }, // 已抽过·不该再抽
      { _id: 'wxkf:kf1:eu4', status: 'active', externalUserId: 'eu4', updatedAt: 2000 }, // 非 closed·不进候选池
    ])
    const r = await post('sampleQc', SUPER, { count: 10 })
    expect(r.ok).toBe(true)
    expect(r.sampled.map((s: any) => s.sessionKey)).toEqual(['wxkf:kf1:eu1']) // 唯一符合条件的候选
    expect(r.count).toBe(1)
    const doc = control.dump('csSession').find((d: any) => d._id === 'wxkf:kf1:eu1')
    expect(doc.qcSampledAt).toBeGreaterThan(0) // 真写入标记
    // 再抽一次：候选池已耗尽（eu1 已标记·其余不合格）
    const r2 = await post('sampleQc', SUPER, { count: 10 })
    expect(r2.sampled).toEqual([])
  })

  it('大白话：候选池为空（无 closed 会话）不报错·空结果', async () => {
    const r = await post('sampleQc', SUPER, {})
    expect(r.ok).toBe(true)
    expect(r.sampled).toEqual([])
    expect(r.count).toBe(0)
  })

  it('大白话：count 默认 10、可传更小值只抽指定条数', async () => {
    control.seed(
      'csSession',
      Array.from({ length: 5 }, (_, i) => ({ _id: `wxkf:kf1:eu${i}`, status: 'closed', externalUserId: `eu${i}`, updatedAt: 1000 + i })),
    )
    const r = await post('sampleQc', SUPER, { count: 2 })
    expect(r.sampled.length).toBe(2)
  })

  it('大白话：抽中会话按客户聚合消息数/首响（复用 conversationsReport 配对口径）；无消息数据时字段省略不编数', async () => {
    control.seed('csSession', [{ _id: 'wxkf:kf1:euA', status: 'closed', externalUserId: 'euA', updatedAt: 1000 }])
    control.seed('conversations', [
      { _id: 'c1', direction: 'in', externalUserId: 'euA', at: 1000 },
      { _id: 'c2', direction: 'out', externalUserId: 'euA', at: 11_000 }, // 10s 后答复
    ])
    const r = await post('sampleQc', SUPER, { count: 10 })
    expect(r.sampled[0].messageCount).toBe(2)
    expect(r.sampled[0].avgResponseMs).toBe(10_000)

    control.reset()
    control.seed('adminConfig', [{ _id: 'auth', keyHash: sha(SUPER), role: 'superadmin' }])
    control.seed('csSession', [{ _id: 'wxkf:kf1:euB', status: 'closed', externalUserId: 'euB', updatedAt: 1000 }])
    const r2 = await post('sampleQc', SUPER, { count: 10 })
    // 该客户无任何 conversations 记录：agg.messageCount=0 仍是合法数据（非「查询失败」）——只有查询真失败才省略字段
    expect(r2.sampled[0].messageCount).toBe(0)
  })

  it('大白话：sampleQc 会被现行审计装置留痕（写类 action 非 list/get 起首）', async () => {
    control.seed('csSession', [{ _id: 'wxkf:kf1:eu1', status: 'closed', externalUserId: 'eu1', updatedAt: 1000 }])
    await post('sampleQc', SUPER, { count: 1 })
    const log = control.dump('auditLog').find((l: any) => l.action === 'sampleQc')
    expect(log).toBeTruthy()
    expect(log.ok).toBe(true)
  })
})

describe('saveQcMark（评分 1-5 整数校验·拒二次覆盖·note 截断）', () => {
  it('大白话：正常评分写入 qc；score 非整数/越界拒；note 超长截断不整条拒绝', async () => {
    control.seed('csSession', [{ _id: 'wxkf:kf1:eu1', status: 'closed', externalUserId: 'eu1', updatedAt: 1000, qcSampledAt: 1000 }])
    const longNote = 'x'.repeat(600)
    const r = await post('saveQcMark', SUPER, { sessionKey: 'wxkf:kf1:eu1', score: 4, note: longNote })
    expect(r.ok).toBe(true)
    const doc = control.dump('csSession').find((d: any) => d._id === 'wxkf:kf1:eu1')
    expect(doc.qc.score).toBe(4)
    expect(doc.qc.note.length).toBe(500) // 截断不拒绝
    expect(doc.qc.by).toBe('admin')
    expect(doc.qc.at).toBeGreaterThan(0)

    control.seed('csSession', [{ _id: 'wxkf:kf1:eu2', status: 'closed', externalUserId: 'eu2', updatedAt: 1000, qcSampledAt: 1000 }])
    expect((await post('saveQcMark', SUPER, { sessionKey: 'wxkf:kf1:eu2', score: 0 })).error).toBe('BAD_ARGS:SCORE_RANGE')
    expect((await post('saveQcMark', SUPER, { sessionKey: 'wxkf:kf1:eu2', score: 6 })).error).toBe('BAD_ARGS:SCORE_RANGE')
    expect((await post('saveQcMark', SUPER, { sessionKey: 'wxkf:kf1:eu2', score: 3.5 })).error).toBe('BAD_ARGS:SCORE_RANGE')
  })

  it('大白话：目标会话不存在→404；缺 sessionKey→400', async () => {
    expect((await post('saveQcMark', SUPER, { sessionKey: 'wxkf:kf1:nobody', score: 5 })).status).toBe(404)
    expect((await post('saveQcMark', SUPER, { score: 5 })).status).toBe(400)
  })

  it('大白话：已评过的会话（qc 已存在）二次保存拒——409 ALREADY_MARKED（拒覆盖·不吞前一评审员的结论）', async () => {
    control.seed('csSession', [
      { _id: 'wxkf:kf1:eu1', status: 'closed', externalUserId: 'eu1', updatedAt: 1000, qcSampledAt: 1000, qc: { score: 5, note: '首评', by: 'admin', at: 1 } },
    ])
    const r = await post('saveQcMark', SUPER, { sessionKey: 'wxkf:kf1:eu1', score: 1, note: '想改评' })
    expect(r.status).toBe(409)
    expect(r.error).toBe('ALREADY_MARKED')
    const doc = control.dump('csSession').find((d: any) => d._id === 'wxkf:kf1:eu1')
    expect(doc.qc.score).toBe(5) // 原评分未被覆盖
    expect(doc.qc.note).toBe('首评')
  })

  it('大白话：saveQcMark 写类 action 被审计留痕', async () => {
    control.seed('csSession', [{ _id: 'wxkf:kf1:eu1', status: 'closed', externalUserId: 'eu1', updatedAt: 1000, qcSampledAt: 1000 }])
    await post('saveQcMark', SUPER, { sessionKey: 'wxkf:kf1:eu1', score: 5 })
    const log = control.dump('auditLog').find((l: any) => l.action === 'saveQcMark')
    expect(log).toBeTruthy()
    expect(log.ok).toBe(true)
  })

  it('大白话：原子抢占——读检查后被并发方抢先写入 qc（同 approveRefund 既有 CAS 范式），绝不无条件覆盖前一评审员的结论', async () => {
    control.seed('csSession', [{ _id: 'wxkf:kf1:eu1', status: 'closed', externalUserId: 'eu1', updatedAt: 1000, qcSampledAt: 1000 }])
    // TOCTOU 窗：saveQcMark 读到 qc 为空之后、条件写之前，「并发评审员」抢先落库了自己的评分
    let flipped = false
    control.setBeforeUpdate(async ({ coll }: any) => {
      if (coll === 'csSession' && !flipped) {
        flipped = true
        await getDb().collection('csSession').doc('wxkf:kf1:eu1').update({ data: { qc: { score: 5, note: '先到评审员', by: 'agent-1', at: 1 } } })
      }
    })
    const r = await post('saveQcMark', SUPER, { sessionKey: 'wxkf:kf1:eu1', score: 1, note: '后到评审员' })
    control.setBeforeUpdate(null as never)
    expect(r.status).toBe(409) // 抢不到写入权，如实报 409，不是静默成功
    expect(r.error).toBe('ALREADY_MARKED')
    const doc = control.dump('csSession').find((d: any) => d._id === 'wxkf:kf1:eu1')
    expect(doc.qc.score).toBe(5) // 先到评审员的结论未被后到请求 clobber
    expect(doc.qc.note).toBe('先到评审员')
  })
})

describe('listQcSampled（cursor 分页取已抽样会话·onlyPending 过滤）', () => {
  it('大白话：只列有 qcSampledAt 的会话；未抽样的不进列表', async () => {
    control.seed('csSession', [
      { _id: 'wxkf:kf1:eu1', status: 'closed', externalUserId: 'eu1', updatedAt: 1000, qcSampledAt: 3000 },
      { _id: 'wxkf:kf1:eu2', status: 'closed', externalUserId: 'eu2', updatedAt: 2000 }, // 未抽样·不进列表
    ])
    const r = await post('listQcSampled', SUPER, {})
    expect(r.ok).toBe(true)
    expect(r.list.map((x: any) => x.sessionKey)).toEqual(['wxkf:kf1:eu1'])
  })

  it('大白话：onlyPending=true 只看未评的（qc 不存在）；已评行被过滤掉', async () => {
    control.seed('csSession', [
      { _id: 'wxkf:kf1:eu1', status: 'closed', externalUserId: 'eu1', updatedAt: 1000, qcSampledAt: 3000 },
      { _id: 'wxkf:kf1:eu2', status: 'closed', externalUserId: 'eu2', updatedAt: 1000, qcSampledAt: 2000, qc: { score: 5, note: '', by: 'admin', at: 1 } },
    ])
    const all = await post('listQcSampled', SUPER, {})
    expect(all.list.length).toBe(2)
    const pending = await post('listQcSampled', SUPER, { onlyPending: true })
    expect(pending.list.map((x: any) => x.sessionKey)).toEqual(['wxkf:kf1:eu1'])
  })

  it('大白话：cursor 翻页——首页 hasMore + nextCursor，续页取剩余、到底 hasMore=false', async () => {
    control.seed(
      'csSession',
      Array.from({ length: 3 }, (_, i) => ({
        _id: `wxkf:kf1:eu${i}`,
        status: 'closed',
        externalUserId: `eu${i}`,
        updatedAt: 1000,
        qcSampledAt: 1000 + i, // eu0=1000 eu1=1001 eu2=1002
      })),
    )
    const p1 = await post('listQcSampled', SUPER, { limit: 2 })
    expect(p1.list.map((x: any) => x.sessionKey)).toEqual(['wxkf:kf1:eu2', 'wxkf:kf1:eu1']) // desc
    expect(p1.hasMore).toBe(true)
    const p2 = await post('listQcSampled', SUPER, { limit: 2, cursor: p1.nextCursor })
    expect(p2.list.map((x: any) => x.sessionKey)).toEqual(['wxkf:kf1:eu0'])
    expect(p2.hasMore).toBe(false)
  })

  it('大白话：行内带按客户聚合的消息数/首响，与 sampleQc 同口径（加载更多列齐全一致）', async () => {
    control.seed('csSession', [{ _id: 'wxkf:kf1:euA', status: 'closed', externalUserId: 'euA', updatedAt: 1000, qcSampledAt: 1000 }])
    control.seed('conversations', [
      { _id: 'c1', direction: 'in', externalUserId: 'euA', at: 1000 },
      { _id: 'c2', direction: 'out', externalUserId: 'euA', at: 6000 },
    ])
    const r = await post('listQcSampled', SUPER, {})
    expect(r.list[0].messageCount).toBe(2)
    expect(r.list[0].avgResponseMs).toBe(5000)
  })
})

describe('坐席不可达（cap 仅 agent:handle·三 action 均未登记 ACTION_CAPS→默认 admin:write）', () => {
  it('大白话：外包直调 sampleQc/saveQcMark/listQcSampled 一律 403', async () => {
    for (const action of ['sampleQc', 'saveQcMark', 'listQcSampled']) {
      const r = await post(action, A1, { sessionKey: 'x', score: 5, count: 1 })
      expect(r.status, action).toBe(403)
      expect(r.error).toBe('FORBIDDEN')
    }
  })
})

// 跨文件不变量守卫（批 B7 评审 P1·源码扫描型·先例同 scm-paging-bounded）：csSession 按客户确定性 _id
// 复用，closed→pending 重开若不清 qc/qcSampledAt，回头客永远进不了质检候选池、旧评分被误当现役评价。
describe('重开清质检标记（dispatch.ts closed→pending patch 必含 qc/qcSampledAt 置空）', () => {
  it('大白话：老客重新转人工时，上一轮的质检标记必须被清掉', async () => {
    const src = require('node:fs').readFileSync(
      require('node:path').join(__dirname, '../src/functions/cs/kfCallback/dispatch.ts'),
      'utf8'
    )
    const m = src.match(/transition\('csSession', id, \['closed'\], 'pending', \{[\s\S]*?\}\)/)
    expect(m, '重开 transition 调用应存在').toBeTruthy()
    expect(m![0]).toMatch(/qc:\s*null/)
    expect(m![0]).toMatch(/qcSampledAt:\s*null/)
  })
})
