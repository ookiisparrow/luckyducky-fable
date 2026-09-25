// @vitest-environment happy-dom
// Csat.vue 挂载测试：满意度报表与评价明细的加载成败（失败不装「还没有评价」）、筛差评、差评跳会话。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const api = vi.hoisted(() => ({ getCsatReport: vi.fn(), listCsatEntries: vi.fn(), push: vi.fn() }))
vi.mock('../src/api/cs', () => ({ getCsatReport: api.getCsatReport, listCsatEntries: api.listCsatEntries }))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: api.push }) }))

import Csat from '../src/pages/Csat.vue'

// 形状照云端 getCsatReport / listCsatEntries
const REPORT = { ok: true, total: 4, avg: 3.75, dist: { 5: 2, 4: 1, 3: 0, 2: 0, 1: 1 }, withNote: 1, approx: false }
const entry = (id: string, score: number, externalUserId = '') => ({ id, at: 1_700_000_000_000, score, note: score <= 2 ? '太慢' : '', externalUserId })
beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset()
  api.getCsatReport.mockResolvedValue(REPORT)
  api.listCsatEntries.mockResolvedValue({ ok: true, entries: [entry('e1', 5), entry('e2', 1, 'wm-u1')], nextCursor: null, hasMore: false })
})
const mountPage = async () => {
  const w = mount(Csat)
  await flushPromises()
  return w
}
type W = Awaited<ReturnType<typeof mountPage>>
const statuses = (w: W) => w.findAll('.ld-status').map((p) => p.text())
const btn = (w: W, text: string) => w.findAll('button').find((b) => b.text() === text)!

describe('Csat.vue 报表', () => {
  it('大白话：均分、好评率、差评数、分布都按回包算', async () => {
    const w = await mountPage()
    expect(statuses(w)).toEqual([])
    const kpi = w.find('.ld-kpi-grid').text()
    expect(kpi).toContain('3.75')
    expect(kpi).toContain('75%')
    expect(w.findAll('.dist-row').map((r) => r.find('.n').text())).toEqual(['250%', '125%', '00%', '00%', '125%'])
  })

  it('大白话：报表挂了——显原因，不装成「还没有顾客评价」', async () => {
    api.getCsatReport.mockResolvedValue({ ok: false, status: 500, error: 'X1' })
    const w = await mountPage()
    expect(statuses(w)).toContain('加载失败：X1')
    expect(w.text()).not.toContain('还没有顾客评价')
  })
})

describe('Csat.vue 评价明细', () => {
  it('大白话：列出每条评价，差评标红并能跳去它的会话', async () => {
    const w = await mountPage()
    const rows = w.findAll('.ld-tbody .ld-tr')
    expect(rows.map((r) => r.classes().includes('bad'))).toEqual([false, true])
    await btn(w, '查会话').trigger('click')
    expect(api.push).toHaveBeenCalledWith({ path: '/conversations', query: { externalUserId: 'wm-u1' } })
  })

  it('大白话：明细挂了——显原因，不说「这个区间没有评价」', async () => {
    api.listCsatEntries.mockResolvedValue({ ok: false, status: 500, error: 'X2' })
    const w = await mountPage()
    expect(statuses(w)).toContain('加载失败：X2')
    expect(w.text()).not.toContain('这个区间没有评价')
  })

  it('大白话：点「仅差评」按 ≤2 分重查', async () => {
    const w = await mountPage()
    api.listCsatEntries.mockResolvedValue({ ok: true, entries: [entry('e2', 1, 'wm-u1')], nextCursor: null, hasMore: false })
    await btn(w, '仅差评 ≤2').trigger('click')
    await flushPromises()
    expect(api.listCsatEntries.mock.lastCall![0]).toMatchObject({ maxScore: 2 })
    expect(w.findAll('.ld-tbody .ld-tr')).toHaveLength(1)
  })

  it('大白话：切区间重查失败——显原因、清掉旧区间的行', async () => {
    const w = await mountPage()
    api.listCsatEntries.mockResolvedValue({ ok: false, status: 500, error: 'X3' })
    await btn(w, '全部').trigger('click')
    await flushPromises()
    expect(api.listCsatEntries.mock.lastCall![0]).toEqual({ from: undefined, to: undefined, maxScore: undefined })
    expect(statuses(w)).toContain('加载失败：X3')
    expect(w.findAll('.ld-tbody .ld-tr')).toHaveLength(0)
  })
})
