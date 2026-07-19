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

  it('大白话：心跳档（startedAt:0）不污染体检读路径——只有心跳档时 latest:null（无真巡检记录）', async () => {
    control.seed(COLLECTIONS.inspectRuns, [{ _id: 'hb:20260719', startedAt: 0, summary: { green: 0, red: 0 }, results: [] }])
    const r = body(await getInspectStatus(ctx()))
    expect(r.latest).toBe(null) // 心跳档被 startedAt>0 过滤·不当最新体检（读侧意图显式）
  })

  it('大白话：心跳档与真巡检混存→取真巡检（心跳不挤占最新体检位）', async () => {
    control.seed(COLLECTIONS.inspectRuns, [
      { _id: 'hb:20260719', startedAt: 0, summary: { green: 0, red: 0 }, results: [] },
      { _id: 'inspect_timer_5', startedAt: 5, summary: { green: 3, red: 0 }, results: [] },
    ])
    const r = body(await getInspectStatus(ctx()))
    expect(r.latest._id).toBe('inspect_timer_5')
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

  it('大白话：异常列表补总数 total（N2）——同 filter .count()，与 list.length 不同步暴露「视图未覆盖账本全部」', async () => {
    control.seed(
      COLLECTIONS.anomalies,
      Array.from({ length: 3 }, (_, i) => ({ _id: 'b' + i, kind: 'invariant-violation', resolved: false, lastSeen: i }))
    )
    const r = body(await listAnomalies(ctx({ resolved: false, limit: 2 })))
    expect(r.list.length).toBe(2) // 分页语义不变：仍按 limit 截断
    expect(r.total).toBe(3) // total 是同 filter 下的真实总数，不受 limit 影响
  })

  it('大白话：total 的 count() 失败——回 total:null，不砸主查询（list 仍照常返回）', async () => {
    control.seed(COLLECTIONS.anomalies, [{ _id: 'c1', resolved: false, lastSeen: 1 }])
    const fakeDb: any = {
      collection: (name: string) => {
        const q: any = {
          _filter: null,
          where(cond: any) {
            q._filter = cond
            return q
          },
          orderBy: () => q,
          limit: () => q,
          get: async () => ({ data: control.dump(name).filter((d: any) => !q._filter || d.resolved === q._filter.resolved) }),
          count: async () => {
            throw new Error('MOCK_COUNT_FAIL')
          },
        }
        return q
      },
    }
    const r = body(await listAnomalies({ db: fakeDb, data: { resolved: false } } as any))
    expect(r.ok).toBe(true)
    expect(r.list.length).toBe(1) // 主查询不受 count 失败牵连
    expect(r.total).toBe(null)
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
