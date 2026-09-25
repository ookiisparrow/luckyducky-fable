// @vitest-environment happy-dom
// Inspect.vue 挂载测试：最新体检报告加载成败（失败不装「还没跑过巡检」）、立即巡检成败、未处理异常入口。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import type { InspectRunRecord } from '@ldrw/shared'

const api = vi.hoisted(() => ({ getInspectStatus: vi.fn(), runInspect: vi.fn(), push: vi.fn() }))
vi.mock('../src/api/ops', () => ({ getInspectStatus: api.getInspectStatus, runInspect: api.runInspect }))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: api.push }) }))

import Inspect from '../src/pages/Inspect.vue'

// 形状照 shared InspectRunRecord（云端 getInspectStatus.latest / runInspect.run）
const run = (trigger: 'timer' | 'manual', redTitle: string): InspectRunRecord => ({
  _id: `inspect_${trigger}_1`,
  startedAt: 1_700_000_000_000,
  finishedAt: 1_700_000_001_000,
  trigger,
  summary: { green: 1, yellow: 0, red: 1 },
  results: [
    { id: 'db-reachable', title: '数据库可达', layer: 'infra', status: 'green', detail: '正常', severity: 'high' },
    { id: 'stuck-order', title: redTitle, layer: 'invariant', status: 'red', detail: '有 3 单', severity: 'high', count: 3, samples: ['o1', 'o2'] },
  ],
})
beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset()
  api.getInspectStatus.mockResolvedValue({ ok: true, latest: run('timer', '付了钱没发货'), openAnomalies: 2 })
})
const mountPage = async () => {
  const w = mount(Inspect)
  await flushPromises()
  return w
}
type W = Awaited<ReturnType<typeof mountPage>>
const status = (w: W) => (w.find('.ld-status').exists() ? w.find('.ld-status').text() : '')

describe('Inspect.vue 加载', () => {
  it('大白话：按两层分组列检查项，红项带样本和「等 N 条」，未处理异常可点去账本', async () => {
    const w = await mountPage()
    expect(status(w)).toBe('')
    expect(w.find('.summary').text()).toContain('1 正常')
    expect(w.find('.summary').text()).toContain('定时')
    const red = w.find('.check.red').text()
    expect(red).toContain('付了钱没发货')
    expect(red).toContain('o1')
    expect(red).toContain('等 3 条')
    await w.find('.alert').trigger('click')
    expect(api.push).toHaveBeenCalledWith('/anomalies')
  })

  it('大白话：加载失败显原因，不装成「还没跑过巡检」', async () => {
    api.getInspectStatus.mockResolvedValue({ ok: false, status: 500, error: 'X1' })
    const w = await mountPage()
    expect(status(w)).toBe('加载失败：X1')
    expect(w.text()).not.toContain('还没跑过巡检')
  })
})

describe('Inspect.vue 立即巡检', () => {
  it('大白话：跑完显示这一轮，再拉一次最新状态', async () => {
    const w = await mountPage()
    api.runInspect.mockResolvedValue({ ok: true, run: run('manual', '多退钱') })
    api.getInspectStatus.mockResolvedValue({ ok: true, latest: run('manual', '多退钱'), openAnomalies: 0 })
    await w.findAll('button').find((b) => b.text() === '立即巡检')!.trigger('click')
    await flushPromises()
    expect(api.runInspect).toHaveBeenCalledTimes(1)
    expect(api.getInspectStatus).toHaveBeenCalledTimes(2)
    expect(w.find('.summary').text()).toContain('手动')
    expect(w.find('.check.red').text()).toContain('多退钱')
    expect(w.find('.alert').exists()).toBe(false)
  })

  it('大白话：巡检失败显原因，不重载冲掉它、旧报告留着', async () => {
    const w = await mountPage()
    api.runInspect.mockResolvedValue({ ok: false, status: 500, error: 'X2' })
    await w.findAll('button').find((b) => b.text() === '立即巡检')!.trigger('click')
    await flushPromises()
    expect(status(w)).toBe('巡检失败：X2')
    expect(api.getInspectStatus).toHaveBeenCalledTimes(1)
    expect(w.find('.check.red').text()).toContain('付了钱没发货')
  })
})
