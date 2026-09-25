// @vitest-environment happy-dom
// Audit.vue 挂载测试：审计记录加载成败（失败≠「没有匹配的记录」）、按操作人/前缀筛选、加载更多成败、快切区间不串。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const api = vi.hoisted(() => ({ listAudit: vi.fn() }))
vi.mock('../src/api/ops', () => api)

import Audit from '../src/pages/Audit.vue'

// 形状照云端 listAudit.entries
const entry = (id: string, action: string, ok = true) => ({ id, action, operator: 'boss', ip: '1.2.3.4', ok, error: ok ? '' : 'BAD_STATUS', summary: { orderId: 'o1' }, ts: 1_700_000_000_000 })
beforeEach(() => {
  api.listAudit.mockReset().mockResolvedValue({ ok: true, entries: [entry('a1', 'shipOrder'), entry('a2', 'approveRefund', false)], nextCursor: 'c1', hasMore: true })
})
const mountPage = async () => {
  const w = mount(Audit)
  await flushPromises()
  return w
}
type W = Awaited<ReturnType<typeof mountPage>>
const status = (w: W) => (w.find('.ld-status').exists() ? w.find('.ld-status').text() : '')
const actions = (w: W) => w.findAll('.ld-tbody .ld-tr').map((r) => r.findAll('.ld-td')[2].text())
const btn = (w: W, text: string) => w.findAll('button').find((b) => b.text() === text)!

describe('Audit.vue 加载', () => {
  it('大白话：默认近 7 天；列出每条操作，失败的标红带原因码，摘要逐项展开', async () => {
    const w = await mountPage()
    const arg = api.listAudit.mock.calls[0][0]
    expect(arg.to - arg.from).toBe(7 * 86400_000)
    expect(status(w)).toBe('')
    expect(actions(w)).toEqual(['shipOrder', 'approveRefund'])
    const bad = w.find('.ld-tr.bad').text()
    expect(bad).toContain('失败')
    expect(bad).toContain('BAD_STATUS')
    expect(w.find('.ld-tbody .ld-tr').text()).toContain('orderId: o1')
  })

  it('大白话：加载失败显原因，不说「没有匹配的记录」也不显空态', async () => {
    api.listAudit.mockResolvedValue({ ok: false, status: 500, error: 'X1' })
    const w = await mountPage()
    expect(status(w)).toBe('加载失败：X1')
    expect(w.text()).not.toContain('还没有操作记录')
  })

  it('大白话：真没记录才说「没有匹配的记录」', async () => {
    api.listAudit.mockResolvedValue({ ok: true, entries: [], nextCursor: null, hasMore: false })
    const w = await mountPage()
    expect(status(w)).toBe('没有匹配的记录')
  })
})

describe('Audit.vue 筛选与翻页', () => {
  it('大白话：按操作人与 action 前缀筛选（去空格）', async () => {
    const w = await mountPage()
    await w.find('input[placeholder="操作人（精确匹配）"]').setValue(' boss ')
    await w.find('input[placeholder="action 前缀（如 save）"]').setValue('ship')
    await btn(w, '筛选').trigger('click')
    await flushPromises()
    expect(api.listAudit.mock.lastCall![0]).toMatchObject({ operator: 'boss', actionPrefix: 'ship' })
  })

  it('大白话：加载更多接着同一筛选往下翻、去重追加；失败留原因不清已有行', async () => {
    const w = await mountPage()
    api.listAudit.mockResolvedValueOnce({ ok: true, entries: [entry('a2', 'approveRefund', false), entry('a3', 'saveDraft')], nextCursor: 'c2', hasMore: true })
    await btn(w, '加载更多').trigger('click')
    await flushPromises()
    expect(api.listAudit.mock.lastCall![0]).toMatchObject({ cursor: 'c1' })
    expect(actions(w)).toEqual(['shipOrder', 'approveRefund', 'saveDraft'])

    api.listAudit.mockResolvedValueOnce({ ok: false, status: 500, error: 'X2' })
    await btn(w, '加载更多').trigger('click')
    await flushPromises()
    expect(status(w)).toBe('加载更多失败：X2')
    expect(actions(w)).toHaveLength(3)
  })

  it('大白话：快切区间，先发的后回包不覆盖当前区间', async () => {
    const w = await mountPage()
    let releaseOld: (v: unknown) => void = () => {}
    api.listAudit.mockReturnValueOnce(new Promise((r) => (releaseOld = r))).mockResolvedValueOnce({ ok: true, entries: [entry('a9', 'allView')], hasMore: false })
    await btn(w, '近 30 天').trigger('click')
    await btn(w, '全部').trigger('click')
    await flushPromises()
    releaseOld({ ok: true, entries: [entry('a8', 'thirtyDays')], hasMore: false })
    await flushPromises()
    expect(actions(w)).toEqual(['allView'])
  })
})
