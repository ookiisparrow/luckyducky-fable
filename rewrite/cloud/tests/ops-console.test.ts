// 黄金 观测-控制台 §D：运行期观测控制台数据层（守卫 rw-ops-console-golden·批3·治病根#14 告警进人眼）。
// 体检面板 + 异常账本的 adminApi 数据层：立即巡检 / 最新体检 / 异常列表(筛+有界) / 标记已处理(写+审计)。
// 只读业务数据——只碰 inspectRuns/anomalies 两 ops 集合。
import { describe, it, expect, beforeEach } from 'vitest'
import cloud, { control } from 'wx-server-sdk'
import { runInspect, getInspectStatus, listAnomalies, resolveAnomaly } from '../src/functions/adminApi/actions/ops'
import { COLLECTIONS } from '@ldrw/shared'

const HOUR = 3600 * 1000
const ctx = (data?: any, agentId = 'admin') => ({ db: cloud.database(), cloud, data, drafts: {}, agentId }) as any
const body = (res: any) => JSON.parse(res.body)

beforeEach(() => control.reset())

describe('运行期观测控制台数据层（批3·rw-ops-console-golden）', () => {
  it('大白话：立即巡检→跑一轮·回报体检·写 inspectRuns（卡单被逮）', async () => {
    control.seed(COLLECTIONS.orders, [{ _id: 'A', status: 'paid', amount: 100, transactionId: 'wxA', paidAt: Date.now() - 80 * HOUR }])
    const r = body(await runInspect(ctx()))
    expect(r.ok).toBe(true)
    expect(r.run.summary.red).toBeGreaterThanOrEqual(1)
    expect(control.dump(COLLECTIONS.inspectRuns).length).toBe(1)
  })

  it('大白话：最新体检（startedAt 最大）+ 未处理异常计数', async () => {
    control.seed(COLLECTIONS.inspectRuns, [
      { _id: 'r1', startedAt: 1, summary: { red: 2 } },
      { _id: 'r2', startedAt: 9, summary: { red: 0 } },
    ])
    control.seed(COLLECTIONS.anomalies, [
      { _id: 'a1', resolved: false },
      { _id: 'a2', resolved: true },
    ])
    const r = body(await getInspectStatus(ctx()))
    expect(r.latest._id).toBe('r2')
    expect(r.openAnomalies).toBe(1)
  })

  it('大白话：异常列表按 lastSeen 倒序·筛未处理/kind·有界分页', async () => {
    control.seed(COLLECTIONS.anomalies, [
      { _id: 'a1', kind: 'invariant-violation', resolved: false, lastSeen: 1 },
      { _id: 'a2', kind: 'flow-failure', resolved: false, lastSeen: 9 },
      { _id: 'a3', kind: 'invariant-violation', resolved: true, lastSeen: 5 },
    ])
    const open = body(await listAnomalies(ctx({ resolved: false })))
    expect(open.list.map((x: any) => x._id)).toEqual(['a2', 'a1'])
    const byKind = body(await listAnomalies(ctx({ kind: 'flow-failure' })))
    expect(byKind.list.length).toBe(1)
    const capped = body(await listAnomalies(ctx({ limit: 9999 })))
    expect(capped.limit).toBeLessThanOrEqual(200) // 有界·不封顶静默挤出
  })

  it('大白话：标记已处理→写 resolved/resolvedBy(真实操作者)·无 id 拒·业务数据不碰', async () => {
    control.seed(COLLECTIONS.anomalies, [{ _id: 'a1', resolved: false }])
    control.seed(COLLECTIONS.orders, [{ _id: 'O', status: 'paid' }])
    const r = body(await resolveAnomaly(ctx({ id: 'a1' }, 'superadmin')))
    expect(r.ok).toBe(true)
    const doc = control.dump(COLLECTIONS.anomalies)[0]
    expect(doc.resolved).toBe(true)
    expect(doc.resolvedBy).toBe('superadmin')
    expect(body(await resolveAnomaly(ctx({}))).ok).toBe(false) // 无 id 拒
    expect(control.dump(COLLECTIONS.orders)).toEqual([{ _id: 'O', status: 'paid' }]) // 业务集合原样
  })
})
