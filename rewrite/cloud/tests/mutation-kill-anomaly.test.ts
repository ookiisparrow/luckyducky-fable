// 变异分诊：kit/anomaly.ts 存活变异的杀手测试（上下文脱敏后的形状、默认级别、集合未建时首见仍告警、计数真丢要留痕）。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { control } from 'wx-server-sdk'
import { COLLECTIONS } from '@ldrw/shared'
import { recordAnomaly } from '../src/kit'

let lines: string[] = []
beforeEach(() => {
  control.reset()
  lines = []
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => void lines.push(String(a[0])))
})
afterEach(() => vi.restoreAllMocks())

describe('recordAnomaly 杀手测试', () => {
  it('上下文里的数组只留长度、对象只留占位；不传级别默认 low', async () => {
    await recordAnomaly('client-error', 'SHAPE', { list: [1, 2, 3], obj: { a: 1 }, n: 7 })
    const [row] = control.dump(COLLECTIONS.anomalies)
    expect(row.ctx).toEqual({ list: '[3]', obj: '{…}', n: '7' })
    expect(row.severity).toBe('low')
  })

  it('凭证与隐私字段逐个剥掉，只留普通字段（异常账本人人可读）', async () => {
    const keys = ['openid', 'unionid', 'phone', 'mobile', 'key', 'password', 'pwd', 'secret', 'token', 'alertWebhook', 'webhook']
    for (const k of keys) await recordAnomaly('client-error', 'PII_' + k, { [k]: 'LEAK', orderId: 'A' })
    const rows = control.dump(COLLECTIONS.anomalies)
    expect(rows).toHaveLength(keys.length)
    for (const row of rows) expect(row.ctx).toEqual({ orderId: 'A' })
  })

  it('值为空（null/undefined）的字段不入账；fp 不是字符串就不参与去重键', async () => {
    await recordAnomaly('client-error', 'NULLS', { orderId: 'A', error: undefined, note: null, fp: 7 })
    const [row] = control.dump(COLLECTIONS.anomalies)
    expect(row._id).toBe('anom_client-error_NULLS')
    expect(row.ctx).toEqual({ orderId: 'A', fp: '7' })
  })

  it('首次写入瞬时失败、自增也没命中：补写一次，照样算首见并告警', async () => {
    let failed = false
    control.setBeforeAdd(async ({ coll }: any) => {
      if (coll === COLLECTIONS.anomalies && !failed) {
        failed = true
        throw new Error('MOCK_ADD_BLIP')
      }
    })
    await recordAnomaly('flow-failure', 'BLIP', {}, 'high')
    expect(control.dump(COLLECTIONS.anomalies).map((r: any) => [r._id, r.count])).toEqual([['anom_flow-failure_BLIP', 1]])
    expect(lines).toEqual(['[LD_ALERT] sev=anomaly fn=flow-failure code=BLIP ctx={"fp":"anom_flow-failure_BLIP"}'])
  })

  it('集合还没建：建完补写成功也算首见，高危照样告警一次（行内容逐字固定）', async () => {
    control.markUncreated(COLLECTIONS.anomalies)
    await recordAnomaly('flow-failure', 'FIRST', { orderId: 'o1' }, 'high')
    expect(control.dump(COLLECTIONS.anomalies)).toHaveLength(1)
    expect(lines).toEqual(['[LD_ALERT] sev=anomaly fn=flow-failure code=FIRST ctx={"fp":"anom_flow-failure_FIRST","orderId":"o1"}'])
  })

  it('新建和自增都失败（计数真丢）：留一行 countIncrementLost，不抛错', async () => {
    control.setBeforeAdd(async ({ coll }: any) => {
      if (coll === COLLECTIONS.anomalies) throw new Error('MOCK_ADD_FAIL')
    })
    control.setBeforeUpdate(async ({ coll }: any) => {
      if (coll === COLLECTIONS.anomalies) throw new Error('MOCK_UPDATE_FAIL')
    })
    await recordAnomaly('flow-failure', 'LOST', {}, 'high')
    expect(lines).toEqual(['[LD_ALERT] sev=anomaly fn=recordAnomaly code=countIncrementLost ctx={"kind":"flow-failure","code":"LOST"}'])
  })
})
