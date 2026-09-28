// 地址列表页 + 地址编辑页行为（v5：删除收进编辑页、按住删除）：管理/结算选址两种模式的点选；编辑页回填、
// 页名、保存按钮亮暗、四要素校验（提示）与手机号严格 11 位（老板拍板 6·输入框下方「少了 N 位」）、保存参数去空白、
// 保存防双击、按住删除、放弃编辑确认（dirty）。
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

describe('手机号打码与位数（lib/address）', () => {
  it('大白话：正好 11 位数字打成「138 **** 0428」；不是 11 位数字的（旧座机、带横杠）原样显示，不瞎打码', async () => {
    const { maskPhone } = await import('../lib/address')
    expect(maskPhone('13800000428')).toBe('138 **** 0428')
    expect(maskPhone('1234567')).toBe('1234567')
    expect(maskPhone('137-0000-000')).toBe('137-0000-000')
    expect(maskPhone('')).toBe('')
  })

  it('大白话：正好 11 位数字才算手机号；不够时算出还差几位（空的不算「少了」）', async () => {
    const { phoneOk, phoneShort } = await import('../lib/address')
    expect(phoneOk('13800000428')).toBe(true)
    expect(phoneOk('1380000042')).toBe(false)
    expect(phoneOk('138000004281')).toBe(false)
    expect(phoneOk('137-0000-00')).toBe(false)
    expect(phoneShort('138')).toBe(8)
    expect(phoneShort('1380000042')).toBe(1)
    expect(phoneShort('13800000428')).toBe(0)
    expect(phoneShort('')).toBe(0)
  })
})

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
  it('大白话：进页列出本机地址（手机号打码）；点一行或点笔进编辑页，点「新增」进空白编辑页', async () => {
    const page = await mount('address')
    page.onShow()
    expect(page.data.picking).toBe(false)
    expect(page.data.list.map((a: any) => a.id)).toEqual([1, 2])
    expect(page.data.list[0].phoneMasked).toBe('138 **** 0000')
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
  it('大白话：点一行——设成默认、紫点先跳到这行，停 140ms 让人看见再退回结算页；连点只退一次', async () => {
    vi.useFakeTimers()
    try {
      const page = await mount('address', { pick: '1' })
      page.onShow()
      expect(page.data.picking).toBe(true)
      page.onTapRow(tap(2))
      page.onTapRow(tap(1))
      expect(saved().find((a) => a.isDefault)?.id).toBe(2)
      expect(page.data.list.find((a: any) => a.isDefault).id).toBe(2)
      vi.advanceTimersByTime(139)
      expect(wxMock.navigateBack).not.toHaveBeenCalled()
      vi.advanceTimersByTime(1)
      expect(wxMock.navigateBack).toHaveBeenCalledTimes(1)
      vi.advanceTimersByTime(1000)
      expect(wxMock.navigateBack).toHaveBeenCalledTimes(1)
      expect(wxMock.navigateTo).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
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
    const v = { name: ' 鸡 ', phone: '13700000000', detail: ' 3 号 ', ...over }
    for (const field of Object.keys(v)) page.onInput({ currentTarget: { dataset: { field } }, detail: { value: v[field as keyof typeof v] } })
    page.onRegionChange({ detail: { value: ['北京市', '北京市', '朝阳区'] } })
  }

  it('大白话：缺一项提示「四项都要填哦」；不落库不退回', async () => {
    const page = await mount('address-edit')
    page.onSave()
    expect(wxMock.showToast.mock.calls.map((c: any[]) => c[0].title)).toEqual(['四项都要填哦'])
    expect(saved()).toHaveLength(2)
    expect(wxMock.navigateBack).not.toHaveBeenCalled()
    expect(page.data.saving).toBe(false)
  })

  it('大白话（拍板 6）：手机号不够 11 位保存键是灰的；点灰键——框下提示「手机号少了 N 位」并亮黄框，边打边更新，打够就消失', async () => {
    const page = await mount('address-edit')
    fillNew(page, { phone: '1234567' }) // 7 位座机也不行了
    expect(page.data.valid).toBe(false)
    expect(page.data.phoneLack).toBe(0) // 没点保存前不吓人
    page.onSave()
    expect(page.data.phoneLack).toBe(4) // 框下「手机号少了 4 位」+ 黄框
    expect(wxMock.showToast).not.toHaveBeenCalled()
    expect(saved()).toHaveLength(2)
    expect(wxMock.navigateBack).not.toHaveBeenCalled()
    page.onInput({ currentTarget: { dataset: { field: 'phone' } }, detail: { value: '1370000000' } })
    expect(page.data.phoneLack).toBe(1)
    page.onInput({ currentTarget: { dataset: { field: 'phone' } }, detail: { value: '13700000000' } })
    expect(page.data.phoneLack).toBe(0)
    expect(page.data.valid).toBe(true)
  })

  it('大白话：四项都填了但手机号是 11 位却夹着别的符号（旧数据）——提示「手机号不太对」，不存', async () => {
    const page = await mount('address-edit')
    fillNew(page, { phone: '137-0000-00' })
    page.onSave()
    expect(wxMock.showToast).toHaveBeenCalledWith({ title: '手机号不太对', icon: 'none' })
    expect(saved()).toHaveLength(2)
  })

  it('大白话：新增保存——去掉首尾空格后落库一条并退回；连点保存只存一条', async () => {
    const page = await mount('address-edit')
    fillNew(page)
    page.onToggleDefault()
    page.onSave()
    page.onSave()
    expect(saved()).toHaveLength(3)
    expect(saved()[2]).toEqual({ id: 3, name: '鸡', phone: '13700000000', region: '北京市 北京市 朝阳区', detail: '3 号', isDefault: true })
    expect(saved().filter((a) => a.isDefault)).toHaveLength(1)
    expect(wxMock.navigateBack).toHaveBeenCalledTimes(1)
    // 退回后本页没了，自绘提示会跟着消失——用原生带勾提示（跨页还在）；退回前先撤掉「放弃修改」拦截
    expect(wxMock.showToast).toHaveBeenCalledWith({ title: '已保存', icon: 'success' })
    expect(page.data.dirty).toBe(false)
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

describe('从结算页选址时新增地址（UX 修复）', () => {
  const fill = (page: Record<string, any>) => {
    for (const [field, value] of [['name', '鸡'], ['phone', '13700000000'], ['detail', '3 号']]) page.onInput({ currentTarget: { dataset: { field } }, detail: { value } })
    page.onRegionChange({ detail: { value: ['北京市', '北京市', '朝阳区'] } })
  }

  it('大白话：选址列表里点「新增」——带上回退层数进新增页（新增完直接回结算页）', async () => {
    const page = await mount('address', { pick: '1' })
    page.onAdd()
    expect(wxMock.navigateTo).toHaveBeenCalledWith({ url: '/pages/address-edit/address-edit?pick=2' })
  })

  it('大白话：选址时新增保存——没拨默认开关也自动设为默认，一口气退两页直接回到结算页', async () => {
    const page = await mount('address-edit', { pick: '2' })
    expect(page.data.pick).toBe(2)
    fill(page)
    page.onSave()
    expect(saved().find((a) => a.isDefault)?.id).toBe(3)
    expect(saved().filter((a) => a.isDefault)).toHaveLength(1)
    expect(wxMock.navigateBack).toHaveBeenCalledWith({ delta: 2 })
  })

  it('大白话：地址簿空时从结算页直接进新增（pick=1）——保存后设默认、退一页回结算页', async () => {
    storage = {}
    const page = await mount('address-edit', { pick: '1' })
    fill(page)
    page.onSave()
    expect(saved()).toEqual([expect.objectContaining({ id: 1, isDefault: true })])
    expect(wxMock.navigateBack).toHaveBeenCalledWith({ delta: 1 })
  })

  it('大白话：管理态新增照旧退一页，不改默认', async () => {
    const page = await mount('address-edit')
    fill(page)
    page.onSave()
    expect(saved().find((a) => a.isDefault)?.id).toBe(1)
    expect(wxMock.navigateBack).toHaveBeenCalledWith({ delta: 1 })
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

    page.onInput({ currentTarget: { dataset: { field: 'detail' } }, detail: { value: '改了' } })
    page.onDelHoldStart()
    vi.advanceTimersByTime(700)
    expect(saved().map((a) => a.id)).toEqual([1])
    expect(wxMock.navigateBack).toHaveBeenCalledTimes(1)
    expect(wxMock.showToast).toHaveBeenLastCalledWith({ title: '已删除', icon: 'none' })
    expect(page.data.dirty).toBe(false)
  })

  it('大白话：按住时手指滑开超过 10px——作废，不删', async () => {
    const page = await mount('address-edit', { id: '2' })
    const t = (x: number, y: number) => ({ touches: [{ clientX: x, clientY: y }] })
    page.onDelHoldStart(t(100, 100))
    page.onDelHoldMove(t(100, 130))
    vi.advanceTimersByTime(1000)
    expect(saved()).toHaveLength(2)
    expect(wxMock.navigateBack).not.toHaveBeenCalled()
  })

  it('大白话：新增态没有东西可删，按住无反应', async () => {
    const page = await mount('address-edit')
    page.onDelHoldStart()
    vi.advanceTimersByTime(1000)
    expect(saved()).toHaveLength(2)
    expect(wxMock.navigateBack).not.toHaveBeenCalled()
  })
})

describe('地址编辑：放弃修改确认（dirty）', () => {
  const input = (page: Record<string, any>, field: string, value: string) => page.onInput({ currentTarget: { dataset: { field } }, detail: { value } })

  it('大白话：编辑态刚进来没改——不拦；改了任一项才拦；改回原样（只差首尾空格也算原样）又不拦；拨默认开关也算改动', async () => {
    const page = await mount('address-edit', { id: '2' })
    expect(page.data.dirty).toBe(false)
    input(page, 'name', '鹅鹅')
    expect(page.data.dirty).toBe(true)
    input(page, 'name', ' 鹅 ')
    expect(page.data.dirty).toBe(false)
    page.onRegionChange({ detail: { value: ['北京市', '北京市', '朝阳区'] } })
    expect(page.data.dirty).toBe(true)
    page.onRegionChange({ detail: { value: ['浙江省', '杭州市', '西湖区'] } })
    expect(page.data.dirty).toBe(false)
    page.onToggleDefault()
    expect(page.data.dirty).toBe(true)
    page.onToggleDefault()
    expect(page.data.dirty).toBe(false)
  })

  it('大白话：新增态空表单不拦，填了字就拦', async () => {
    const page = await mount('address-edit')
    expect(page.data.dirty).toBe(false)
    input(page, 'phone', '1')
    expect(page.data.dirty).toBe(true)
  })

  it('大白话：点自绘返回键——交给放弃确认半屏（它自己判有没有改动）', async () => {
    const page = await mount('address-edit', { id: '2' })
    const ask = vi.fn()
    page.selectComponent = (sel: string) => (sel === '#leave' ? { ask } : null)
    page.onBack()
    expect(ask).toHaveBeenCalledTimes(1)
    expect(wxMock.navigateBack).not.toHaveBeenCalled()
  })
})
