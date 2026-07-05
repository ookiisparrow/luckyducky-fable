// 黄金 观测-地基 §A：bug 收集器地基「记录不符合预期的行为」（守卫 rw-anomaly-record-golden）。
// 北极星＝防治静默 bug：把没抛异常/没告警/没人投诉的失败留成痕。recordAnomaly 是四路来源
// （服务端异常/不变量违反/关键流程失败/客户端错误）统一落库口——指纹去重防刷屏、高危去重感知告警、
// fail-soft 不反噬主流程、对业务集合零写入（「现在就只读看护线上」的安全铁律）。
import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { recordAnomaly, notifyAlert } from '../src/kit'
import { COLLECTIONS, anomalyFingerprint } from '@ldrw/shared'

// 捕获 notifyAlert 的 [LD_ALERT] 结构化行（现落 console.error·观测批接企微推送时签名不变）
function captureAlerts(fn: () => Promise<void>): Promise<string[]> {
  const seen: string[] = []
  const orig = console.error
  console.error = (...a: unknown[]) => {
    seen.push(String(a[0]))
  }
  return fn()
    .then(() => seen)
    .finally(() => {
      console.error = orig
    })
}

beforeEach(() => control.reset())

describe('recordAnomaly（bug 收集器地基·防治静默 bug）', () => {
  it('大白话：同一指纹反复记只落一条·count 累加·firstSeen 不动 lastSeen 更新（去重·不刷屏）', async () => {
    await recordAnomaly('invariant-violation', 'MONEY_NOT_CONSERVED', { fp: 'order_A', orderId: 'A' }, 'high')
    await recordAnomaly('invariant-violation', 'MONEY_NOT_CONSERVED', { fp: 'order_A', orderId: 'A' }, 'high')
    const rows = control.dump(COLLECTIONS.anomalies)
    expect(rows.length).toBe(1)
    expect(rows[0].count).toBe(2)
    expect(rows[0]._id).toBe(anomalyFingerprint('invariant-violation', 'MONEY_NOT_CONSERVED', 'order_A'))
    expect(rows[0].firstSeen).toBeLessThanOrEqual(rows[0].lastSeen)
    expect(rows[0].resolved).toBe(false)
  })

  it('大白话：不同 fp 分别落条（同类 bug 按受影响实体各一条·知道是哪些订单卡了）', async () => {
    await recordAnomaly('invariant-violation', 'STUCK_ORDER', { fp: 'A' }, 'high')
    await recordAnomaly('invariant-violation', 'STUCK_ORDER', { fp: 'B' }, 'high')
    expect(control.dump(COLLECTIONS.anomalies).length).toBe(2)
  })

  it('大白话：敏感字段绝不入库（openid/口令/凭证剥离）·长串截断（账本可广读·不泄密不膨胀）', async () => {
    await recordAnomaly(
      'server-exception',
      'BOOM',
      { openid: 'oSENSITIVE123', key: 'topsecret', orderId: 'A', note: 'x'.repeat(500) },
      'low',
    )
    const doc = control.dump(COLLECTIONS.anomalies)[0]
    const blob = JSON.stringify(doc)
    expect(blob).not.toContain('oSENSITIVE123')
    expect(blob).not.toContain('topsecret')
    expect(doc.ctx.orderId).toBe('A')
    expect(String(doc.ctx.note).length).toBeLessThanOrEqual(120)
  })

  it('大白话：高危首次出现即推告警·重复出现不再刷（去重感知告警·防告警疲劳）', async () => {
    const alerts = await captureAlerts(async () => {
      await recordAnomaly('flow-failure', 'REFUND_STUCK', { fp: 'A' }, 'high')
      await recordAnomaly('flow-failure', 'REFUND_STUCK', { fp: 'A' }, 'high') // 重复=去重·不再告警
    })
    expect(alerts.filter((s) => s.includes('[LD_ALERT]') && s.includes('REFUND_STUCK')).length).toBe(1)
  })

  it('大白话：低危只落库不告警（不打扰·人去控制台看）', async () => {
    const alerts = await captureAlerts(() => recordAnomaly('client-error', 'JS_ERR', { fp: 'x' }, 'low'))
    expect(alerts.filter((s) => s.includes('[LD_ALERT]')).length).toBe(0)
    expect(control.dump(COLLECTIONS.anomalies).length).toBe(1)
  })

  it('大白话：写库失败绝不反噬调用方（fail-soft·可观测性不吃掉主流程）', async () => {
    await recordAnomaly('server-exception', 'BOOM', { fp: 'A' }, 'low') // 先种→触后续 update 路径
    control.setBeforeUpdate(() => {
      throw new Error('DB_DOWN')
    })
    await expect(recordAnomaly('server-exception', 'BOOM', { fp: 'A' }, 'low')).resolves.toBeUndefined()
  })

  it('大白话：只写异常账本·绝不碰业务集合（对业务集合零写入·只读看护铁律）', async () => {
    control.seed('orders', [{ _id: 'A', status: 'paid' }])
    await recordAnomaly('invariant-violation', 'STUCK_ORDER', { fp: 'A', orderId: 'A' }, 'high')
    expect(control.dump('orders')).toEqual([{ _id: 'A', status: 'paid' }]) // 业务集合原样未动
    expect(control.dump(COLLECTIONS.anomalies).length).toBe(1)
  })
})

describe('notifyAlert→recordAnomaly 桥（批4·动作失败自动进 bug 账本·零逐函数改造）', () => {
  it('大白话：任一 notifyAlert 告警自动落一条 anomaly（收钱无单/退款异常/探针故障…持久可查）', async () => {
    await notifyAlert('money', 'payCallback', 'UNKNOWN_ORDER', { id: 'o1' })
    const an = control.dump(COLLECTIONS.anomalies)
    expect(an.length).toBe(1)
    expect(an[0].code).toBe('UNKNOWN_ORDER')
    expect(an[0].severity).toBe('high') // 告警＝值得注意＝高危
  })

  it('大白话：同一告警反复→账本去重不刷屏（count 累加·一条）', async () => {
    await notifyAlert('security', 'kfHealthProbe', 'KF_TOKEN_FAILED', {})
    await notifyAlert('security', 'kfHealthProbe', 'KF_TOKEN_FAILED', {})
    const an = control.dump(COLLECTIONS.anomalies)
    expect(an.length).toBe(1)
    expect(an[0].count).toBe(2)
  })

  it('大白话：桥不无限递归（notifyAlert→record→不再回调 notifyAlert·跑得完·fail-soft）', async () => {
    await expect(notifyAlert('money', 'pay', 'X', {})).resolves.toBeUndefined()
  })
})
