// @vitest-environment happy-dom
// Batches.vue 失败≠空态（病根#14）：取码失败/翻页失败/读设置失败都要如实可见，不伪装成「无码」或「没配置」。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const { listBatchesMock, createBatchMock, listBatchCodesMock, getSettingsMock, routeQuery } = vi.hoisted(() => ({
  listBatchesMock: vi.fn(),
  createBatchMock: vi.fn(),
  listBatchCodesMock: vi.fn(),
  getSettingsMock: vi.fn(),
  routeQuery: { courseId: 'course-p1' } as Record<string, string>,
}))
vi.mock('../src/api/system', () => ({
  listBatches: listBatchesMock,
  createBatch: createBatchMock,
  listBatchCodes: listBatchCodesMock,
  getSettings: getSettingsMock,
}))
vi.mock('../src/api/products', () => ({ getCard: vi.fn() }))
vi.mock('vue-router', () => ({ useRoute: () => ({ query: routeQuery }), useRouter: () => ({ push: vi.fn() }) }))

import Batches from '../src/pages/Batches.vue'

const batch = { _id: 'b1', batchId: 'b1', courseId: 'course-p1', total: 120, activated: 3, createdAt: Date.now() }

beforeEach(() => {
  listBatchesMock.mockReset().mockResolvedValue({ ok: true, list: [batch] })
  getSettingsMock.mockReset().mockResolvedValue({ ok: true, settings: { urlPrefix: 'https://x.test/a?c=' } })
  listBatchCodesMock.mockReset()
})

async function openFirstBatch() {
  const w = mount(Batches)
  await flushPromises()
  const open = w.findAll('button').find((b) => b.text() === '打开这批')
  expect(open).toBeTruthy()
  await open!.trigger('click')
  await flushPromises()
  return w
}
const btn = (w: ReturnType<typeof mount>, text: string) => w.findAll('.code-pager button').find((b) => b.text() === text)!

describe('Batches.vue 取码失败不伪装成「无码」', () => {
  it('大白话：打开一批取码失败，抽屉显示取码失败原因，不显示「无码」', async () => {
    listBatchCodesMock.mockResolvedValue({ ok: false, status: 0, error: 'NETWORK:boom' })
    const w = await openFirstBatch()
    const list = w.find('.code-list').text()
    expect(list).toContain('取码失败')
    expect(list).not.toContain('无码')
  })

  it('大白话：翻下一页失败，页码不前进、已有码不清、下一页仍可点重试', async () => {
    listBatchCodesMock
      .mockResolvedValueOnce({ ok: true, codes: ['C1', 'C2'], nextCursor: 'k1', hasMore: true })
      .mockResolvedValueOnce({ ok: false, status: 500, error: 'DB_READ_FAIL' })
      .mockResolvedValueOnce({ ok: true, codes: ['C3'], nextCursor: null, hasMore: false })
    const w = await openFirstBatch()
    await btn(w, '下一页').trigger('click')
    await flushPromises()
    expect(w.find('.code-pager').text()).toContain('第 1 页')
    expect(w.findAll('.code-row').map((r) => r.text())).toEqual(['C1', 'C2'])
    expect(w.find('.code-list').text()).toContain('取码失败')
    expect(btn(w, '下一页').attributes('disabled')).toBeUndefined()

    await btn(w, '下一页').trigger('click') // 重试用的仍是同一游标
    await flushPromises()
    expect(listBatchCodesMock.mock.calls[2][1]).toMatchObject({ cursor: 'k1' })
    expect(w.find('.code-pager').text()).toContain('第 2 页')
    expect(w.find('.code-list').text()).not.toContain('取码失败')
  })
})

describe('Batches.vue 读设置失败不误报成「没配置前缀」', () => {
  it('大白话：getSettings 失败后点导出，提示读取失败，而不是让操作员去设置页配前缀', async () => {
    getSettingsMock.mockResolvedValue({ ok: false, status: 0, error: 'NETWORK:boom' })
    listBatchCodesMock.mockResolvedValue({ ok: true, codes: ['C1'], nextCursor: null, hasMore: false })
    const w = await openFirstBatch()
    const csv = w.findAll('button').find((b) => b.text().includes('导出 CSV'))!
    await csv.trigger('click')
    await flushPromises()
    const msg = w.find('.export-blocked').text()
    expect(msg).toContain('读取失败')
    expect(msg).not.toContain('先在「设置」配置')
  })

  it('大白话：带课程号进来时，批次列表不用等读设置回包就先发', async () => {
    getSettingsMock.mockReturnValue(new Promise(() => {}))
    mount(Batches)
    await flushPromises()
    expect(listBatchesMock).toHaveBeenCalledWith('course-p1')
  })
})

describe('Batches.vue 计数触顶不静默（#389）', () => {
  it('大白话：listBatches 回 truncated，页面写明计数可能不全；没触顶不提示', async () => {
    listBatchesMock.mockResolvedValue({ ok: true, list: [batch], truncated: true })
    const w = mount(Batches)
    await flushPromises()
    expect(w.text()).toContain('码量超上限，计数可能不全')
    listBatchesMock.mockResolvedValue({ ok: true, list: [batch], truncated: false })
    const w2 = mount(Batches)
    await flushPromises()
    expect(w2.text()).not.toContain('计数可能不全')
  })
})

describe('Batches.vue 载入课程乱序（G1）', () => {
  it('大白话：先发的载入后回包，不把列表和「已载入课程」改回旧课', async () => {
    let releaseOld: (v: unknown) => void = () => {}
    listBatchesMock
      .mockReturnValueOnce(new Promise((r) => (releaseOld = r)))
      .mockResolvedValueOnce({ ok: true, list: [{ ...batch, _id: 'b2', batchId: 'b2', courseId: 'course-p2' }] })
    const w = mount(Batches)
    await w.find('.course-picker input').setValue('course-p2')
    await w.findAll('button').find((b) => b.text() === '载入课程')!.trigger('click')
    await flushPromises()
    releaseOld({ ok: true, list: [batch] })
    await flushPromises()
    expect(listBatchesMock.mock.calls).toEqual([['course-p1'], ['course-p2']])
    expect(w.text()).toContain('（课程 course-p2）')
    expect(w.text()).not.toContain('course-p1')
  })
})
