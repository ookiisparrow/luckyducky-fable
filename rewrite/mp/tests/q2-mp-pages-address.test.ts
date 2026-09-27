// 地址列表页 + 地址编辑页行为（v5：删除收进编辑页、按住删除）：管理/结算选址两种模式的点选；编辑页回填、
// 页名、保存按钮亮暗、四要素校验（toast）与电话校验（输入框下方提示）、保存参数去空白、保存防双击、按住删除。
// 地址簿 lib/address 用真的（wx 存储桩），只桩震感。Page 桩同 p-mp-order-page.test.ts（setData 补回调）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../lib/haptics', () => ({ tapHaptic: vi.fn(), keyHaptic: vi.fn() }))

let pageOpts: Record<string, any> = {}
;(globalThis as any).Page = (o: unknown) => {
  pageOpts = o as Record<string, any>
}

const KEY = 'ld:address'
let storage: Record<string, unknown>
let wxMock: Record<string, any>

const A1 = { id: 1, name: '鸭', phone: '13800000000', region: '上海 上海市 浦东新区', detail: '1 号', isDefault: true }
const A2 = { id: 2, name: '鹅', phone: '13900000000', region: '浙江省 杭州市 西湖区', detail: '2 号', isDefault: false }
const saved = () => (storage[KEY] as { list: Record<string, unknown>[] }).list
const tap = (id: number) => ({ currentTarget: { dataset: { id: String(id) } } })

async function mount(path: 'address' | 'address-edit', query: Record<string, string> = {}): Promise<Record<string, any>> {
  vi.resetModules()
  await import(`../pages/${path}/${path}.ts`)
  const page = Object.create(pageOpts) as Record<string, any>
  page.data = { ...pageOpts.data }
  page.setData = function (patch: Record<string, unknown>, cb?: () => void) {
    Object.assign(this.data as Record<string, unknown>, patch)
    cb?.()
  }
  page.onLoad(query)
  return page
}

beforeEach(() => {
  storage = { [KEY]: { list: [A1, A2] } }
  wxMock = {
    getStorageSync: (k: string) => storage[k],
    setStorageSync: (k: string, v: unknown) => (storage[k] = JSON.parse(JSON.stringify(v))),
    showToast: vi.fn(),
    showModal: vi.fn(),
    navigateTo: vi.fn(),
    navigateBack: vi.fn(),
    setNavigationBarTitle: vi.fn(),
  }
  ;(globalThis as any).wx = wxMock
})

describe('地址列表：管理态', () => {
  it('大白话：进页列出本机地址；点一行或点笔进编辑页，点「新增」进空白编辑页', async () => {
    const page = await mount('address')
    page.onShow()
    expect(page.data.picking).toBe(false)
    expect(page.data.list.map((a: any) => a.id)).toEqual([1, 2])
    page.onTapRow(tap(2))
    page.onEdit(tap(1))
    page.onAdd()
    expect(wxMock.navigateTo.mock.calls.map((c: any[]) => c[0].url)).toEqual([
      '/pages/address-edit/address-edit?id=2',
      '/pages/address-edit/address-edit?id=1',
      '/pages/address-edit/address-edit',
    ])
    expect(wxMock.navigateBack).not.toHaveBeenCalled()
  })
})

describe('地址列表：结算选址态（?pick=1）', () => {
  it('大白话：点一行——设成默认并退回结算页（结算页回来读默认地址）', async () => {
    const page = await mount('address', { pick: '1' })
    expect(page.data.picking).toBe(true)
    page.onTapRow(tap(2))
    expect(saved().find((a) => a.isDefault)?.id).toBe(2)
    expect(wxMock.navigateBack).toHaveBeenCalledTimes(1)
    expect(wxMock.navigateTo).not.toHaveBeenCalled()
  })

  it('大白话：选址态点笔只是去编辑，不改默认也不退回', async () => {
    const page = await mount('address', { pick: '1' })
    page.onEdit(tap(2))
    expect(wxMock.navigateTo).toHaveBeenCalledWith({ url: '/pages/address-edit/address-edit?id=2' })
    expect(saved().find((a) => a.isDefault)?.id).toBe(1)
    expect(wxMock.navigateBack).not.toHaveBeenCalled()
  })
})

describe('地址编辑：进页', () => {
  it('大白话：带 id 进来——回填四项和默认开关，地区拆成选择器初值，保存按钮亮；页名「编辑收货地址」', async () => {
    const page = await mount('address-edit', { id: '1' })
    expect(page.data).toMatchObject({ id: 1, name: '鸭', phone: '13800000000', region: A1.region, detail: '1 号', isDefault: true, valid: true })
    expect(page.data.regionArr).toEqual(['上海', '上海市', '浦东新区'])
    expect(page.data.title).toBe('编辑收货地址')
  })

  it('大白话：新增进来——页名「新增收货地址」，表单空、保存按钮暗；填齐四项才亮', async () => {
    const page = await mount('address-edit')
    expect(page.data.title).toBe('新增收货地址')
    expect(page.data).toMatchObject({ id: null, name: '', valid: false })
    page.onInput({ currentTarget: { dataset: { field: 'name' } }, detail: { value: '鸡' } })
    page.onInput({ currentTarget: { dataset: { field: 'phone' } }, detail: { value: '13700000000' } })
    page.onInput({ currentTarget: { dataset: { field: 'detail' } }, detail: { value: '3 号' } })
    expect(page.data.valid).toBe(false)
    page.onRegionChange({ detail: { value: ['北京市', '北京市', '朝阳区'] } })
    expect(page.data).toMatchObject({ region: '北京市 北京市 朝阳区', valid: true })
    page.onInput({ currentTarget: { dataset: { field: 'name' } }, detail: { value: '  ' } })
    expect(page.data.valid).toBe(false)
  })
})

describe('地址编辑：保存', () => {
  const fillNew = (page: Record<string, any>, over: Record<string, string> = {}) => {
    const v = { name: ' 鸡 ', phone: ' 137-0000-0000 ', detail: ' 3 号 ', ...over }
    for (const field of Object.keys(v)) page.onInput({ currentTarget: { dataset: { field } }, detail: { value: v[field as keyof typeof v] } })
    page.onRegionChange({ detail: { value: ['北京市', '北京市', '朝阳区'] } })
  }

  it('大白话：缺一项提示「四项都要填哦」；电话不足 7 位数字在输入框下方提示「电话号码不太对」；都不落库不退回；改电话提示消失', async () => {
    const page = await mount('address-edit')
    page.onSave()
    fillNew(page, { phone: '12-34-56' })
    page.onSave()
    expect(wxMock.showToast.mock.calls.map((c: any[]) => c[0].title)).toEqual(['四项都要填哦'])
    expect(page.data.phoneErr).toBe('电话号码不太对')
    expect(saved()).toHaveLength(2)
    expect(wxMock.navigateBack).not.toHaveBeenCalled()
    expect(page.data.saving).toBe(false)
    page.onInput({ currentTarget: { dataset: { field: 'phone' } }, detail: { value: '1370000000' } })
    expect(page.data.phoneErr).toBe('')
  })

  it('大白话：电话恰好 7 位数字（座机）能保存并退回——云端下单也收 7 位，前端不能更严', async () => {
    const page = await mount('address-edit')
    fillNew(page, { phone: '1234567' })
    page.onSave()
    expect(wxMock.showToast).not.toHaveBeenCalled()
    expect(saved()).toHaveLength(3)
    expect(saved()[2].phone).toBe('1234567')
    expect(wxMock.navigateBack).toHaveBeenCalledTimes(1)
  })

  it('大白话：新增保存——去掉首尾空格后落库一条并退回；连点保存只存一条', async () => {
    const page = await mount('address-edit')
    fillNew(page)
    page.onToggleDefault()
    page.onSave()
    page.onSave()
    expect(saved()).toHaveLength(3)
    expect(saved()[2]).toEqual({ id: 3, name: '鸡', phone: '137-0000-0000', region: '北京市 北京市 朝阳区', detail: '3 号', isDefault: true })
    expect(saved().filter((a) => a.isDefault)).toHaveLength(1)
    expect(wxMock.navigateBack).toHaveBeenCalledTimes(1)
  })

  it('大白话：编辑保存——改的是原来那条，不新增', async () => {
    const page = await mount('address-edit', { id: '2' })
    page.onInput({ currentTarget: { dataset: { field: 'detail' } }, detail: { value: '2 号 301' } })
    page.onSave()
    expect(saved()).toHaveLength(2)
    expect(saved()[1]).toMatchObject({ id: 2, name: '鹅', detail: '2 号 301', isDefault: false })
    expect(wxMock.navigateBack).toHaveBeenCalledTimes(1)
  })
})

describe('地址编辑：按住删除', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('大白话：编辑态按住 0.7 秒才删并退回；松手太快不删、提示按住', async () => {
    const page = await mount('address-edit', { id: '2' })
    page.onDelHoldStart()
    vi.advanceTimersByTime(200)
    page.onDelHoldEnd()
    vi.advanceTimersByTime(1000)
    expect(saved()).toHaveLength(2)
    expect(wxMock.showToast).toHaveBeenCalledWith(expect.objectContaining({ title: '按住删除这个地址' }))

    page.onDelHoldStart()
    vi.advanceTimersByTime(700)
    expect(saved().map((a) => a.id)).toEqual([1])
    expect(wxMock.navigateBack).toHaveBeenCalledTimes(1)
  })

  it('大白话：新增态没有东西可删，按住无反应', async () => {
    const page = await mount('address-edit')
    page.onDelHoldStart()
    vi.advanceTimersByTime(1000)
    expect(saved()).toHaveLength(2)
    expect(wxMock.navigateBack).not.toHaveBeenCalled()
  })
})
