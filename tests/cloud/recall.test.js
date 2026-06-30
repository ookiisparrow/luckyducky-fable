import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { recallCandidates } from '../../packages/cloud/src/functions/cs/recallScan/rules'
import { main } from '../../packages/cloud/src/functions/cs/recallScan/index'

// 后台360工作站 B4.4 主动召回：纯决策 recallCandidates（四类·根因#8 决策与 I/O 分离）+ 定时扫描 main
// （isServerCall 闸·bounded 读·经 botpush 唯一接缝 notifyRecall 推送·守卫 recall-via-bot-seam）。
const NOW = 1_000_000_000_000
const MIN = 60_000
const DAY = 86400_000
const PAY = 15 * MIN
const base = { now: NOW, payWindowMs: PAY, pendingOrders: [], shippedOrders: [], activations: [], progress: [] }

describe('recallCandidates 纯决策（四类召回）', () => {
  it('催付：pending 在 5min~支付窗口内才算（太新/已过窗不算）', () => {
    const r = recallCandidates({
      ...base,
      pendingOrders: [
        { id: 'p-fresh', status: 'pending', createdAt: NOW - 2 * MIN }, // 太新·不催
        { id: 'p-due', status: 'pending', createdAt: NOW - 6 * MIN }, // 命中
        { id: 'p-expired', status: 'pending', createdAt: NOW - 20 * MIN }, // 过窗（将被关单）·不催
      ],
    })
    expect(r.unpaid).toEqual(['p-due'])
  })

  it('物流：shipped 超 7 天未签收才算（无 shippedAt 不算）', () => {
    const r = recallCandidates({
      ...base,
      shippedOrders: [
        { id: 's-stuck', status: 'shipped', shippedAt: NOW - 8 * DAY }, // 命中
        { id: 's-recent', status: 'shipped', shippedAt: NOW - 3 * DAY }, // 未到阈
        { id: 's-nodate', status: 'shipped' }, // 无 shippedAt·不算
      ],
    })
    expect(r.logistics).toEqual(['s-stuck'])
  })

  it('未用（激活未进课）/ 未完（进课无进度）分流；有进度不召回', () => {
    const r = recallCandidates({
      ...base,
      activations: [
        { _openid: 'A', courseId: 'k1', enteredAt: null }, // 未进课 → unstarted
        { _openid: 'B', courseId: 'k1', enteredAt: 123 }, // 进课·无进度 → unfinished
        { _openid: 'C', courseId: 'k1', enteredAt: 123 }, // 进课·有进度 → 不召回
      ],
      progress: [{ _openid: 'C', courseId: 'k1' }],
    })
    expect(r.unstarted).toEqual(['A'])
    expect(r.unfinished).toEqual(['B'])
  })

  it('total = 四类之和；空输入安全（不崩）', () => {
    expect(recallCandidates({ ...base }).total).toBe(0)
  })
})

describe('recallScan main（定时触发·isServerCall 闸·bounded·fail-soft）', () => {
  beforeEach(() => control.reset())

  it('客户端带身份调用 → skipped（根因#3 防滥调·不扫不推）', async () => {
    control.setOpenId('user-X')
    expect(await main()).toMatchObject({ skipped: true })
  })

  it('服务端触发 → 读数据算召回 + 返回各类计数（无 webhook 配置·fail-soft 不推不崩）', async () => {
    control.setOpenId('') // 定时器：无 openid → isServerCall
    control.seed('orders', [
      { _id: 'p1', id: 'p1', status: 'pending', createdAt: Date.now() - 6 * MIN },
      { _id: 's1', id: 's1', status: 'shipped', shippedAt: Date.now() - 9 * DAY },
    ])
    control.seed('activations', [{ _openid: 'A', courseId: 'k1', enteredAt: null }])
    const r = await main()
    expect(r.ok).toBe(true)
    expect(r.unpaid).toBe(1)
    expect(r.logistics).toBe(1)
    expect(r.unstarted).toBe(1)
    expect(r.total).toBe(3)
  })
})
