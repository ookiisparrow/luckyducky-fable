// @vitest-environment happy-dom
// Anomalies.vue 挂载测试：异常账本加载成败（失败不装「没有未处理异常」）、标记已处理两步确认与失败留原因、快切筛选不串。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const api = vi.hoisted(() => ({ listAnomalies: vi.fn(), resolveAnomaly: vi.fn() }))
vi.mock('../src/api/ops', () => api)

import Anomalies from '../src/pages/Anomalies.vue'

// 形状照云端 listAnomalies（异常账本文档）
const anomaly = (id: string, code: string, extra: Record<string, unknown> = {}) => ({ _id: id, kind: 'flow-failure', code, severity: 'high', count: 3, ctx: { orderId: 'o1', fp: 'x' }, lastSeen: 1_700_000_000_000, resolved: false, ...extra })
beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset()
  api.listAnomalies.mockResolvedValue({ ok: true, list: [anomaly('a1', 'PAY_FAIL')], limit: 50, total: 1 })
  api.resolveAnomaly.mockResolvedValue({ ok: true, id: 'a1' })
})
const mountPage = async () => {
  const w = mount(Anomalies)
  await flushPromises()
  return w
}
type W = Awaited<ReturnType<typeof mountPage>>
const statuses = (w: W) => w.findAll('.ld-status').map((p) => p.text())
const codes = (w: W) => w.findAll('.row .code').map((c) => c.text())
const btn = (w: W, text: string) => w.findAll('button').find((b) => b.text() === text)!

describe('Anomalies.vue 加载', () => {
  it('大白话：默认只看未处理；行里有类型、原因码、次数、上下文（不含指纹）', async () => {
    const w = await mountPage()
    expect(api.listAnomalies).toHaveBeenCalledWith({ resolved: false })
    expect(statuses(w)).toEqual([])
    const row = w.find('.row').text()
    expect(row).toContain('关键流程失败')
    expect(row).toContain('PAY_FAIL')
    expect(row).toContain('×3')
    expect(row).toContain('orderId: o1')
    expect(row).not.toContain('fp:')
  })

  it('大白话：加载失败显原因，不装成「没有未处理异常」', async () => {
    api.listAnomalies.mockResolvedValue({ ok: false, status: 500, error: 'X1' })
    const w = await mountPage()
    expect(statuses(w)).toEqual(['加载失败：X1'])
    expect(w.text()).not.toContain('没有未处理异常')
  })

  it('大白话：快切筛选，先发的后回包不覆盖当前筛选', async () => {
    const w = await mountPage()
    let releaseOld: (v: unknown) => void = () => {}
    api.listAnomalies.mockReturnValueOnce(new Promise((r) => (releaseOld = r))).mockResolvedValueOnce({ ok: true, list: [anomaly('a9', 'ALL_VIEW')], total: 1 })
    await btn(w, '已处理').trigger('click')
    await btn(w, '全部').trigger('click')
    await flushPromises()
    releaseOld({ ok: true, list: [anomaly('a5', 'RESOLVED_VIEW', { resolved: true })], total: 1 })
    await flushPromises()
    expect(codes(w)).toEqual(['ALL_VIEW'])
  })
})

describe('Anomalies.vue 标记已处理', () => {
  it('大白话：第一次只武装，第二次才标记，成功后重载', async () => {
    const w = await mountPage()
    await btn(w, '标记已处理').trigger('click')
    expect(api.resolveAnomaly).not.toHaveBeenCalled()
    api.listAnomalies.mockResolvedValue({ ok: true, list: [], total: 0 })
    await btn(w, '确认已处理？').trigger('click')
    await flushPromises()
    expect(api.resolveAnomaly).toHaveBeenCalledWith('a1')
    expect(codes(w)).toEqual([])
    expect(w.text()).toContain('没有未处理异常')
  })

  it('大白话：标记失败留原因，不重载冲掉它', async () => {
    api.resolveAnomaly.mockResolvedValue({ ok: false, status: 200, error: 'BAD_ARGS' })
    const w = await mountPage()
    await btn(w, '标记已处理').trigger('click')
    await btn(w, '确认已处理？').trigger('click')
    await flushPromises()
    expect(statuses(w)).toContain('标记失败：BAD_ARGS')
    expect(api.listAnomalies).toHaveBeenCalledTimes(1)
  })
})
