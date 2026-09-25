// 读失败≠空态（根因#14）：巡检主扫描、召回进度读失败时，不许把「读不到」当「没有」。
//   巡检：主扫描炸 → 该检查项红/high「检查自身异常」并落 anomaly，不再假报全绿；
//         afterSales 集合还没建（首次售后才建）＝真没有退款，钱守恒仍绿，不误报。
//   召回：progress 分块读炸 → 不判「开了没学」，不把整批已进课学员误推运营群。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { control } from 'wx-server-sdk'
import { runInspection } from '../src/kit'
import { main as recallScan } from '../src/functions/timers/recallScan'
import { COLLECTIONS } from '@ldrw/shared'

const HOUR = 3600 * 1000

beforeEach(() => control.reset())
afterEach(() => vi.restoreAllMocks())

function entry(run: Awaited<ReturnType<typeof runInspection>>, id: string) {
  const r = run.results.find((x) => x.id === id)
  expect(r, `检查项 ${id} 必须在报告里`).toBeTruthy()
  return r!
}

function expectSelfFault(r: ReturnType<typeof entry>, code: string) {
  expect(r.status).toBe('red')
  expect(r.severity).toBe('high')
  expect(r.detail).toBe('检查自身异常：Error: boom')
  expect(control.dump(COLLECTIONS.anomalies).some((a: any) => a.code === code)).toBe(true)
}

describe('巡检主扫描读失败→红（不假报全绿）', () => {
  it('大白话：钱守恒的售后扫描炸→红·落账', async () => {
    control.seed(COLLECTIONS.afterSales, [{ _id: 'A__l1', orderId: 'A', status: 'refunded', refundAmount: 999 }])
    control.setBeforeGet(({ coll, filter }: any) => {
      if (coll === COLLECTIONS.afterSales && filter && filter.status === 'refunded' && !filter.orderId) throw new Error('boom')
    })
    expectSelfFault(entry(await runInspection('timer'), 'money-conserved'), 'INSPECT_MONEY_CONSERVED')
  })

  it('大白话：钱守恒的订单分块读炸→红（读不到实付≠没超退）', async () => {
    control.seed(COLLECTIONS.orders, [{ _id: 'A', status: 'done', amount: 100 }])
    control.seed(COLLECTIONS.afterSales, [{ _id: 'A__l1', orderId: 'A', status: 'refunded', refundAmount: 999 }])
    control.setBeforeGet(({ coll, filter }: any) => {
      if (coll === COLLECTIONS.orders && filter && filter._id) throw new Error('boom')
    })
    expectSelfFault(entry(await runInspection('timer'), 'money-conserved'), 'INSPECT_MONEY_CONSERVED')
  })

  it('大白话：afterSales 集合还没建→钱守恒照绿（首次售后才建集合·不是读失败）', async () => {
    control.setBeforeGet(({ coll, filter }: any) => {
      if (coll === COLLECTIONS.afterSales && filter && filter.status === 'refunded' && !filter.orderId)
        throw new Error('DATABASE_COLLECTION_NOT_EXIST: afterSales')
    })
    const money = entry(await runInspection('timer'), 'money-conserved')
    expect(money.status).toBe('green')
    expect(money.scanned).toBe(0)
  })

  it('大白话：权限拒绝即便文案带 collection 字样也不当集合未建→红', async () => {
    control.setBeforeGet(({ coll, filter }: any) => {
      if (coll === COLLECTIONS.afterSales && filter && filter.status === 'refunded' && !filter.orderId)
        throw Object.assign(new Error('permission denied: collection does not exist or no access'), { errCode: -502003 })
    })
    expect(entry(await runInspection('timer'), 'money-conserved').status).toBe('red')
  })

  for (const status of ['paid', 'refund_required', 'payment_exception']) {
    it(`大白话：卡单的 ${status} 扫描炸→红·落账（真卡单不许被读失败洗绿）`, async () => {
      control.seed(COLLECTIONS.orders, [{ _id: 'S', status: 'paid', amount: 100, transactionId: 'wxS', paidAt: Date.now() - 80 * HOUR }])
      control.setBeforeGet(({ coll, filter }: any) => {
        if (coll === COLLECTIONS.orders && filter && filter.status === status) throw new Error('boom')
      })
      expectSelfFault(entry(await runInspection('timer'), 'stuck-order'), 'INSPECT_STUCK_ORDER')
    })
  }
})

describe('召回 progress 读失败→不判「开了没学」', () => {
  it('大白话：进度分块读炸→unfinished=0、未进课照报、打 PROGRESS_READ_FAILED 告警', async () => {
    control.setOpenId('')
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const now = Date.now()
    control.seed(COLLECTIONS.activations, [
      { _id: 'a0', _openid: 'oNEW', courseId: 'c1', enteredAt: null },
      { _id: 'a1', _openid: 'oLEARN', courseId: 'c1', enteredAt: now - 1000 },
    ])
    control.seed(COLLECTIONS.progress, [{ _id: 'p1', _openid: 'oLEARN', courseId: 'c1', done: {} }])
    control.setBeforeGet(({ coll }: any) => {
      if (coll === COLLECTIONS.progress) throw new Error('boom')
    })
    const r: any = await recallScan()
    expect(r.unfinished).toBeUndefined() // 不写 0：0 读起来像「真没人开了没学」
    expect(r.unfinishedSkipped).toBe(1)
    expect(r.unstarted).toBe(1)
    expect(errSpy.mock.calls.some((c) => String(c[0]).includes('code=PROGRESS_READ_FAILED'))).toBe(true)
  })

  it('大白话：多块里只有第 2 块炸→照样整轮跳过，且跳过标记推到运营群（别的候选为 0 也推）', async () => {
    control.setOpenId('')
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const now = Date.now()
    const ids = Array.from({ length: 150 }, (_, i) => 'o' + i)
    control.seed(
      COLLECTIONS.activations,
      ids.map((o, i) => ({ _id: 'a' + i, _openid: o, courseId: 'c1', enteredAt: now - i * 1000 })),
    )
    control.seed(
      COLLECTIONS.progress,
      ids.map((o, i) => ({ _id: 'p' + i, _openid: o, courseId: 'c1', done: {} })),
    )
    control.setBeforeGet(({ coll, filter }: any) => {
      const inIds = coll === COLLECTIONS.progress && filter && filter._openid && filter._openid.val
      if (Array.isArray(inIds) && inIds.includes('o120')) throw new Error('boom') // 只炸第 2 块
    })
    const r: any = await recallScan()
    expect(r.unfinished).toBeUndefined()
    expect(r.unfinishedSkipped).toBe(1)
    const lines = errSpy.mock.calls.map((c) => String(c[0]))
    expect(lines.some((l) => l.includes('code=PROGRESS_READ_FAILED'))).toBe(true)
    expect(lines.some((l) => l.startsWith('[LD_RECALL]') && l.includes('"unfinishedSkipped":1'))).toBe(true)
  })
})
