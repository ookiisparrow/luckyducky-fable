// @vitest-environment happy-dom
// Batches.vue 失败≠空态（病根#14）：取码失败/翻页失败/读设置失败都要如实可见，不伪装成「无码」或「没配置」。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const { listBatchesMock, createBatchMock, listBatchCodesMock, getSettingsMock, saveBlobMock, routeQuery } = vi.hoisted(() => ({
  listBatchesMock: vi.fn(),
  createBatchMock: vi.fn(),
  listBatchCodesMock: vi.fn(),
  getSettingsMock: vi.fn(),
  saveBlobMock: vi.fn(),
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
vi.mock('../src/lib/saveBlob', () => ({ saveBlob: saveBlobMock }))

import Batches from '../src/pages/Batches.vue'
import { UNKNOWN_COURSE_HINT, launchErrorText } from '../src/lib/mapSystem'

const batch = { _id: 'b1', batchId: 'b1', courseId: 'course-p1', total: 120, activated: 3, createdAt: Date.now() }

beforeEach(() => {
  listBatchesMock.mockReset().mockResolvedValue({ ok: true, list: [batch] })
  getSettingsMock.mockReset().mockResolvedValue({ ok: true, settings: { urlPrefix: 'https://x.test/a?c=' } })
  listBatchCodesMock.mockReset()
  createBatchMock.mockReset().mockResolvedValue({ ok: true, batchId: 'b9', codes: ['C1', 'C2'] })
  saveBlobMock.mockReset()
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

describe('Batches.vue 生成批次按钮：courseReady 没传不能当成「课程没发布」', () => {
  const byText = (w: ReturnType<typeof mount>, t: string) => w.findAll('button').find((b) => b.text().includes(t))

  it('大白话：独立页（不传 courseReady）载入课程后，能点「确认生成」，按已载入课程生成', async () => {
    const w = mount(Batches)
    await flushPromises()
    await byText(w, '生成新批次')!.trigger('click')
    const confirm = byText(w, '确认生成')!
    expect(confirm.attributes('disabled')).toBeUndefined()
    await confirm.trigger('click')
    await flushPromises()
    expect(createBatchMock).toHaveBeenCalledWith('course-p1', 50)
    expect(w.text()).toContain('已生成批次 b9（2 张码）')
  })

  it('大白话：向导里课程没发布，「生成新批次」置灰并提示先发布，不发 createBatch', async () => {
    const w = mount(Batches, { props: { embed: true, wizardCourseId: 'course-p1', courseReady: false } })
    await flushPromises()
    expect(byText(w, '生成新批次')!.attributes('disabled')).toBeDefined()
    expect(w.text()).toContain(UNKNOWN_COURSE_HINT)
    expect(createBatchMock).not.toHaveBeenCalled()
  })

  it('大白话：向导里课程已发布，能生成并通知向导刷新', async () => {
    const w = mount(Batches, { props: { embed: true, wizardCourseId: 'course-p1', courseReady: true } })
    await flushPromises()
    await byText(w, '生成新批次')!.trigger('click')
    await byText(w, '确认生成')!.trigger('click')
    await flushPromises()
    expect(createBatchMock).toHaveBeenCalledWith('course-p1', 50)
    expect(w.emitted('saved')).toHaveLength(1)
  })
})

describe('Batches.vue 码表翻页与导出', () => {
  const codeRows = (w: ReturnType<typeof mount>) => w.findAll('.code-row').map((r) => r.text())

  it('大白话：翻到第 2 页再点上一页——回到第 1 页的码，不是一次铺开整批', async () => {
    listBatchCodesMock
      .mockResolvedValueOnce({ ok: true, codes: ['C1', 'C2'], nextCursor: 'k1', hasMore: true })
      .mockResolvedValueOnce({ ok: true, codes: ['C3'], nextCursor: null, hasMore: false })
      .mockResolvedValueOnce({ ok: true, codes: ['C1', 'C2'], nextCursor: 'k1', hasMore: true })
    const w = await openFirstBatch()
    expect(listBatchCodesMock.mock.calls[0]).toEqual(['b1', { limit: 50 }])
    await btn(w, '下一页').trigger('click')
    await flushPromises()
    expect(codeRows(w)).toEqual(['C3'])
    await btn(w, '上一页').trigger('click')
    await flushPromises()
    expect(listBatchCodesMock.mock.calls[2][1]).toEqual({ cursor: undefined, limit: 50 })
    expect(codeRows(w)).toEqual(['C1', 'C2'])
    expect(w.find('.code-pager').text()).toContain('第 1 页')
  })

  it('大白话：导出 CSV 另取齐整批（不止当前这页），每行带落地网址，文件开头带 BOM 防 Excel 乱码', async () => {
    listBatchCodesMock
      .mockResolvedValueOnce({ ok: true, codes: ['C1'], nextCursor: 'k1', hasMore: true })
      .mockResolvedValueOnce({ ok: true, codes: ['C1', 'C2'], nextCursor: 'e1', hasMore: true })
      .mockResolvedValueOnce({ ok: true, codes: ['C3'], nextCursor: null, hasMore: false })
    const w = await openFirstBatch()
    await w.findAll('button').find((b) => b.text().includes('导出 CSV'))!.trigger('click')
    await flushPromises()
    expect(listBatchCodesMock.mock.calls.slice(1).map((c) => c[1])).toEqual([
      { cursor: undefined, limit: 200 },
      { cursor: 'e1', limit: 200 },
    ])
    const [blob, name] = saveBlobMock.mock.calls[0]
    expect(name).toBe('b1-codes.csv')
    const bytes = new Uint8Array(await (blob as Blob).arrayBuffer())
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    expect(new TextDecoder().decode(bytes.slice(3))).toBe('激活码,网址\nC1,https://x.test/a?c=C1\nC2,https://x.test/a?c=C2\nC3,https://x.test/a?c=C3')
  })

  it('大白话：A 批翻页没回来就打开 B 批——A 的第 2 页不写进 B 的抽屉', async () => {
    listBatchesMock.mockResolvedValue({ ok: true, list: [batch, { ...batch, _id: 'b2', batchId: 'b2' }] })
    let releaseA: (v: unknown) => void = () => {}
    listBatchCodesMock
      .mockResolvedValueOnce({ ok: true, codes: ['A1'], nextCursor: 'ka', hasMore: true })
      .mockReturnValueOnce(new Promise((r) => (releaseA = r)))
      .mockResolvedValueOnce({ ok: true, codes: ['B1'], nextCursor: null, hasMore: false })
    const w = await openFirstBatch()
    await btn(w, '下一页').trigger('click')
    await w.findAll('button').filter((b) => b.text() === '打开这批')[1].trigger('click')
    await flushPromises()
    releaseA({ ok: true, codes: ['A2'], nextCursor: null, hasMore: false })
    await flushPromises()
    expect(codeRows(w)).toEqual(['B1'])
    expect(w.find('.code-pager').text()).toContain('第 1 页')
  })

  it('大白话：A 批下一页没回来就重开 A 批——旧的第 2 页不写进重开后的第 1 页', async () => {
    let releaseA: (v: unknown) => void = () => {}
    listBatchCodesMock
      .mockResolvedValueOnce({ ok: true, codes: ['A1'], nextCursor: 'ka', hasMore: true })
      .mockReturnValueOnce(new Promise((r) => (releaseA = r)))
      .mockResolvedValueOnce({ ok: true, codes: ['A1'], nextCursor: 'ka', hasMore: true })
    const w = await openFirstBatch()
    await btn(w, '下一页').trigger('click')
    await w.findAll('button').find((b) => b.text() === '打开这批')!.trigger('click')
    await flushPromises()
    releaseA({ ok: true, codes: ['A2'], nextCursor: null, hasMore: false })
    await flushPromises()
    expect(codeRows(w)).toEqual(['A1'])
    expect(w.find('.code-pager').text()).toContain('第 1 页')
  })

  it('大白话：A 批上一页没回来就重开 A 批——旧回包的失败不盖掉重开后取到的码', async () => {
    let releaseA: (v: unknown) => void = () => {}
    listBatchCodesMock
      .mockResolvedValueOnce({ ok: true, codes: ['A1'], nextCursor: 'ka', hasMore: true })
      .mockResolvedValueOnce({ ok: true, codes: ['A2'], nextCursor: null, hasMore: false })
      .mockReturnValueOnce(new Promise((r) => (releaseA = r)))
      .mockResolvedValueOnce({ ok: true, codes: ['A1'], nextCursor: 'ka', hasMore: true })
    const w = await openFirstBatch()
    await btn(w, '下一页').trigger('click')
    await flushPromises()
    await btn(w, '上一页').trigger('click')
    await w.findAll('button').find((b) => b.text() === '打开这批')!.trigger('click')
    await flushPromises()
    releaseA({ ok: false, status: 500, error: 'DB_READ_FAIL' })
    await flushPromises()
    expect(codeRows(w)).toEqual(['A1'])
    expect(w.find('.code-list').text()).not.toContain('取码失败')
  })
})

describe('Batches.vue 报错说人话', () => {
  it('大白话：批次列表读失败、生成失败都走上新组人话，不甩英文码', async () => {
    listBatchesMock.mockResolvedValueOnce({ ok: false, status: 0, error: 'NETWORK:fetch failed' })
    const w = mount(Batches)
    await flushPromises()
    expect(w.find('.ld-status').text()).toBe(launchErrorText('NETWORK:fetch failed'))
    expect(w.text()).not.toContain('NETWORK:')

    createBatchMock.mockResolvedValue({ ok: false, status: 400, error: 'UNKNOWN_COURSE:course-p1' })
    const w2 = mount(Batches)
    await flushPromises()
    await w2.findAll('button').find((b) => b.text().includes('生成新批次'))!.trigger('click')
    await w2.findAll('button').find((b) => b.text().includes('确认生成'))!.trigger('click')
    await flushPromises()
    expect(w2.find('.ld-status').text()).toBe(UNKNOWN_COURSE_HINT + '（编号 course-p1）')
  })
})
