// 订单详情页主路径行为：加载成功/失败/查无此单、过期回包、复制与物流、取消、继续支付、确认收货、写评价、申请售后。
// 只桩云调用（callApp），api/映射/支付结果判定都用真的。Page 桩同 me-cont-failed.test.ts。
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { callAppMock } = vi.hoisted(() => ({ callAppMock: vi.fn() }))
vi.mock('../utils/cloud', () => ({ callApp: callAppMock }))
vi.mock('../lib/haptics', () => ({ tapHaptic: vi.fn() }))

let pageOpts: Record<string, any> = {}
;(globalThis as any).Page = (o: unknown) => {
  pageOpts = o as Record<string, any>
}

async function mount(id = 'o1'): Promise<Record<string, any>> {
  vi.resetModules()
  await import('../pages/order/order')
  const page = Object.create(pageOpts) as Record<string, any>
  page.data = { ...pageOpts.data }
  page.setData = function (patch: Record<string, unknown>) {
    Object.assign(this.data as Record<string, unknown>, patch)
  }
  page.onLoad({ id })
  return page
}

const ORDER = (over: Record<string, unknown> = {}) => ({
  _id: 'o1',
  status: 'pending',
  amount: 128,
  items: [{ lineId: 'L1', name: '小鸭', price: 128, qty: 1 }],
  shipping: { company: '顺丰速运', trackingNo: 'SF123' },
  ...over,
})
const PAYMENT = { timeStamp: '1', nonceStr: 'n', package: 'prepay_id=x', signType: 'RSA', paySign: 's' }

let handlers: Record<string, (data: Record<string, any>) => unknown>
let wxMock: Record<string, any>
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve()
}
const toastTitles = () => wxMock.showToast.mock.calls.map((c: any[]) => c[0].title)
const modal = (n = 0) => wxMock.showModal.mock.calls[n][0]

beforeEach(() => {
  handlers = { getOrderById: () => ({ ok: true, order: ORDER() }) }
  callAppMock.mockReset().mockImplementation(async (action: string, data: Record<string, any>) =>
    handlers[action] ? handlers[action](data) : { ok: false, error: 'UNEXPECTED' }
  )
  wxMock = {
    showToast: vi.fn(),
    showModal: vi.fn(),
    showLoading: vi.fn(),
    hideLoading: vi.fn(),
    showActionSheet: vi.fn(),
    setClipboardData: vi.fn(),
    navigateTo: vi.fn(),
    redirectTo: vi.fn(),
    requestPayment: vi.fn(),
  }
  ;(globalThis as any).wx = wxMock
  ;(globalThis as any).getCurrentPages = () => [{}]
})

describe('订单详情：加载', () => {
  it('大白话：待支付单——横幅「等待付款」、金额纯数字、不出售后入口；查的是 query 里的单号', async () => {
    const page = await mount()
    page.onShow()
    await flush()
    expect(callAppMock).toHaveBeenCalledWith('getOrderById', { id: 'o1' })
    expect(page.data).toMatchObject({ loading: false, loadFailed: false, amountNum: '128.00', canAfterSale: false })
    expect(page.data.banner.head).toBe('等待付款')
    expect(page.data.vm.id).toBe('o1')
  })

  it('大白话：已付/已发货/已完成才出售后入口；未知状态横幅落中性样式并显示状态原文', async () => {
    for (const status of ['paid', 'shipped', 'done']) {
      handlers.getOrderById = () => ({ ok: true, order: ORDER({ status }) })
      const page = await mount()
      await page.reload()
      expect(page.data.canAfterSale, status).toBe(true)
    }
    handlers.getOrderById = () => ({ ok: true, order: ORDER({ status: 'weird' }) })
    const page = await mount()
    await page.reload()
    expect(page.data.banner).toEqual({ icon: 'info', tint: 'muted', head: 'weird', sub: '' })
    expect(page.data.canAfterSale).toBe(false)
  })

  it('大白话：首次加载网络失败——亮重试态，不弹提示；点重试回到加载中并重新拉取', async () => {
    handlers.getOrderById = () => ({ ok: false, error: 'CALL_TIMEOUT' })
    const page = await mount()
    await page.reload()
    expect(page.data).toMatchObject({ loading: false, loadFailed: true, vm: null })
    expect(wxMock.showToast).not.toHaveBeenCalled()

    handlers.getOrderById = () => ({ ok: true, order: ORDER() })
    page.onRetryLoad()
    expect(page.data).toMatchObject({ loading: true, loadFailed: false })
    await flush()
    expect(page.data).toMatchObject({ loading: false, loadFailed: false })
    expect(page.data.vm.id).toBe('o1')
  })

  it('大白话：查无此单（NOT_FOUND / NO_ID）——不亮重试，落「订单不存在」空态', async () => {
    for (const error of ['NOT_FOUND', 'NO_ID']) {
      handlers.getOrderById = () => ({ ok: false, error })
      const page = await mount()
      await page.reload()
      expect(page.data, error).toMatchObject({ loading: false, loadFailed: false, vm: null })
    }
    expect(wxMock.showToast).not.toHaveBeenCalled()
  })

  it('大白话：已显示订单时刷新失败——内容不动，只轻提示；单据刚被删则提示「这单已经不在了」', async () => {
    const page = await mount()
    await page.reload()
    handlers.getOrderById = () => ({ ok: false, error: 'CALL_FAIL' })
    await page.reload()
    expect(page.data.vm.id).toBe('o1')
    expect(page.data.loadFailed).toBe(false)
    handlers.getOrderById = () => ({ ok: false, error: 'NOT_FOUND' })
    await page.reload()
    expect(page.data.vm.id).toBe('o1')
    expect(toastTitles()).toEqual(['刷新失败，请稍后重试', '这单已经不在了'])
  })

  it('大白话：两次刷新并发、先发的后回——旧回包丢掉，横幅停在新状态', async () => {
    let releaseOld!: (v: unknown) => void
    handlers.getOrderById = () => new Promise((r) => (releaseOld = r))
    const page = await mount()
    const old = page.reload()
    handlers.getOrderById = () => ({ ok: true, order: ORDER({ status: 'closed' }) })
    await page.reload()
    releaseOld({ ok: true, order: ORDER({ status: 'pending' }) })
    await old
    expect(page.data.vm.status).toBe('closed')
    expect(page.data.banner.head).toBe('订单已关闭')
  })
})

describe('订单详情：复制与物流', () => {
  it('大白话：复制单号 / 运单号，复制成功各有提示；没有运单号不动作', async () => {
    const page = await mount()
    await page.reload()
    page.onCopyOrderNo()
    expect(wxMock.setClipboardData.mock.calls[0][0].data).toBe('o1')
    wxMock.setClipboardData.mock.calls[0][0].success()
    page.onCopyTracking()
    expect(wxMock.setClipboardData.mock.calls[1][0].data).toBe('SF123')
    wxMock.setClipboardData.mock.calls[1][0].success()
    expect(toastTitles()).toEqual(['已复制单号', '已复制运单号'])

    page.data.vm = { ...page.data.vm, trackingNo: '' }
    page.onCopyTracking()
    page.onViewLogistics()
    expect(wxMock.setClipboardData).toHaveBeenCalledTimes(2)
    expect(wxMock.navigateTo).not.toHaveBeenCalled()
  })

  it('大白话：没有单号（缺 id 进页）时复制单号不动作', async () => {
    const page = await mount('')
    page.onCopyOrderNo()
    expect(wxMock.setClipboardData).not.toHaveBeenCalled()
  })

  it('大白话：查看物流打开快递100（带快递公司编码）；插件打不开就退回复制运单号', async () => {
    const page = await mount()
    await page.reload()
    page.onViewLogistics()
    const opts = wxMock.navigateTo.mock.calls[0][0]
    expect(opts.url).toBe('plugin://kuaidi100/index?num=SF123&appName=' + encodeURIComponent('小棉鸭') + '&com=shunfeng')
    opts.fail()
    expect(wxMock.setClipboardData.mock.calls[0][0].data).toBe('SF123')

    page.data.vm = { ...page.data.vm, shipCompany: '不认识的快递' }
    page.onViewLogistics()
    expect(wxMock.navigateTo.mock.calls[1][0].url).not.toContain('&com=')
  })
})

describe('订单详情：取消订单', () => {
  it('大白话：只有待支付单弹确认；确认后取消成功提示并刷新，失败提示稍后再试；点了「再想想」什么都不做', async () => {
    const page = await mount()
    await page.reload()
    handlers.cancelOrder = () => ({ ok: true })
    page.onCancel()
    expect(modal().title).toBe('取消订单')
    await modal().success({ confirm: false })
    expect(callAppMock).not.toHaveBeenCalledWith('cancelOrder', expect.anything())

    handlers.getOrderById = () => ({ ok: true, order: ORDER({ status: 'closed' }) })
    await modal().success({ confirm: true })
    await flush()
    expect(callAppMock).toHaveBeenCalledWith('cancelOrder', { id: 'o1' })
    expect(wxMock.showToast).toHaveBeenLastCalledWith({ title: '订单已取消', icon: 'success' })
    expect(page.data.banner.head).toBe('订单已关闭')

    page.onCancel() // 已关闭：不再出确认框
    expect(wxMock.showModal).toHaveBeenCalledTimes(1)

    handlers.getOrderById = () => ({ ok: true, order: ORDER() })
    await page.reload()
    handlers.cancelOrder = () => ({ ok: false, error: 'BAD_STATUS' })
    page.onCancel()
    await modal(1).success({ confirm: true })
    expect(wxMock.showToast).toHaveBeenLastCalledWith({ title: '取消没成功，稍后再试', icon: 'none' })
  })

  it('大白话：取消请求在途时退出了详情页——回包后不再弹提示', async () => {
    const page = await mount()
    await page.reload()
    handlers.cancelOrder = () => ({ ok: true })
    page.onCancel()
    const done = modal().success({ confirm: true })
    page.onUnload()
    await done
    expect(wxMock.showToast).not.toHaveBeenCalled()
  })
})

describe('订单详情：继续支付', () => {
  it('大白话：云端说已付——提示「已支付」并刷新，按钮解锁', async () => {
    const page = await mount()
    handlers.pay = () => ({ ok: false, error: 'BAD_STATUS:paid' })
    await page.onPay()
    expect(callAppMock).toHaveBeenCalledWith('pay', { id: 'o1' })
    expect(wxMock.showToast).toHaveBeenCalledWith({ title: '已支付', icon: 'success' })
    expect(page.data.paying).toBe(false)
    expect(wxMock.requestPayment).not.toHaveBeenCalled()
  })

  it('大白话：拉起收银台付成功——提示「支付成功」并刷新', async () => {
    const page = await mount()
    handlers.pay = () => ({ ok: true, payment: PAYMENT })
    await page.onPay()
    const opts = wxMock.requestPayment.mock.calls[0][0]
    expect(opts).toMatchObject(PAYMENT)
    expect(page.data.paying).toBe(true) // 收银台开着仍锁
    callAppMock.mockClear()
    opts.success()
    expect(wxMock.showToast).toHaveBeenCalledWith({ title: '支付成功', icon: 'success' })
    expect(page.data.paying).toBe(false)
    expect(callAppMock).toHaveBeenCalledWith('getOrderById', { id: 'o1' })
  })

  it('大白话：云端拒绝——如实提示原因（订单已关闭）并解锁', async () => {
    const page = await mount()
    handlers.pay = () => ({ ok: false, error: 'ORDER_CLOSED' })
    await page.onPay()
    expect(wxMock.showToast).toHaveBeenCalledWith({ title: '订单已超时关闭，请重新下单', icon: 'none' })
    expect(page.data.paying).toBe(false)
  })

  it('大白话：发起支付在途时退出了详情页——不拉收银台，只提示订单已保留', async () => {
    const page = await mount()
    let release!: (v: unknown) => void
    handlers.pay = () => new Promise((r) => (release = r))
    const p = page.onPay()
    page.onUnload()
    release({ ok: true, payment: PAYMENT })
    await p
    expect(wxMock.requestPayment).not.toHaveBeenCalled()
    expect(toastTitles()).toEqual(['订单已保留，可到订单列表继续支付'])
  })
})

describe('订单详情：确认收货与写评价', () => {
  it('大白话：确认收货——成功提示并刷新；失败提示稍后再试；取消确认不发请求', async () => {
    const page = await mount()
    handlers.confirmReceive = () => ({ ok: true })
    page.onConfirm()
    await modal().success({ confirm: false })
    expect(callAppMock).not.toHaveBeenCalledWith('confirmReceive', expect.anything())
    await modal().success({ confirm: true })
    expect(callAppMock).toHaveBeenCalledWith('confirmReceive', { id: 'o1' })
    expect(wxMock.showToast).toHaveBeenLastCalledWith({ title: '已确认收货', icon: 'success' })

    handlers.confirmReceive = () => ({ ok: false, error: 'BAD_STATUS' })
    page.onConfirm()
    await modal(1).success({ confirm: true })
    expect(wxMock.showToast).toHaveBeenLastCalledWith({ title: '操作没成功，稍后再试', icon: 'none' })
  })

  it('大白话：确认收货请求在途时退出了详情页——回包后不再弹提示', async () => {
    const page = await mount()
    handlers.confirmReceive = () => ({ ok: true })
    page.onConfirm()
    const done = modal().success({ confirm: true })
    page.onUnload()
    await done
    expect(wxMock.showToast).not.toHaveBeenCalled()
  })

  it('大白话：写评价跳评价页，行号和商品名都做 URL 编码（含 & 也不截断）', async () => {
    const page = await mount()
    page.onWriteReview({ currentTarget: { dataset: { lineid: 'p&1', name: '小鸭 #1' } } })
    expect(wxMock.navigateTo).toHaveBeenCalledWith({
      url: '/pages/review/review?orderId=o1&lineId=' + encodeURIComponent('p&1') + '&name=' + encodeURIComponent('小鸭 #1'),
    })
  })
})

describe('订单详情：申请售后', () => {
  const doneVm = () => ({ id: 'o1', status: 'done', items: [{ lineId: 'L1', name: '小鸭', spec: '黄', priceLabel: '', qty: 1, enteredQty: 0, refundable: true, cover: '' }] })

  it('大白话：还没加载出订单时点售后不动作；全部行都申请过——提示没有可申请的条目', async () => {
    const page = await mount()
    await page.onAfterSale()
    expect(callAppMock).not.toHaveBeenCalled()

    handlers.getMyAfterSales = () => ({ ok: true, list: [{ _id: 'a1', orderId: 'o1', lineId: 'L1', appliedAt: 1 }] })
    page.data.vm = doneVm()
    await page.onAfterSale()
    expect(callAppMock).toHaveBeenCalledWith('getMyAfterSales', { cursor: undefined, limit: 100 })
    expect(wxMock.showActionSheet).not.toHaveBeenCalled()
    expect(toastTitles()).toEqual(['没有可申请售后的条目'])
  })

  it('大白话：选中一行、填原因提交——成功提示并跳我的售后；点了取消不提交', async () => {
    handlers.getMyAfterSales = () => ({ ok: true, list: [] })
    handlers.applyRefund = () => ({ ok: true })
    const page = await mount()
    page.data.vm = doneVm()
    await page.onAfterSale()
    expect(wxMock.showActionSheet.mock.calls[0][0].itemList).toEqual(['小鸭（黄）'])
    wxMock.showActionSheet.mock.calls[0][0].success({ tapIndex: 0 })
    await modal().success({ confirm: false })
    expect(callAppMock).not.toHaveBeenCalledWith('applyRefund', expect.anything())
    await modal().success({ confirm: true, content: '颜色不对' })
    expect(callAppMock).toHaveBeenCalledWith('applyRefund', { orderId: 'o1', lineId: 'L1', reason: '颜色不对' })
    expect(wxMock.showToast).toHaveBeenCalledWith({ title: '已提交申请', icon: 'success' })
    expect(wxMock.navigateTo.mock.calls[0][0].url).toBe('/pages/aftersales/aftersales')
  })

  it('大白话：云端拒绝申请——按原因说人话（已申请过/已开课不可退/额度用完/其它稍后再试），不跳页', async () => {
    const cases: Array<[string, string]> = [
      ['ALREADY_APPLIED', '这条已申请过了'],
      ['NOT_REFUNDABLE', '该条目不可退（已开课）'],
      ['NOTHING_LEFT', '本单可退额度已用完'],
      ['INTERNAL', '申请没成功，稍后再试'],
    ]
    const page = await mount()
    for (const [error, msg] of cases) {
      handlers.applyRefund = () => ({ ok: false, error })
      wxMock.showModal.mockClear()
      page.applyFor('o1', 'L1')
      await modal().success({ confirm: true })
      expect(wxMock.showToast).toHaveBeenLastCalledWith({ title: msg, icon: 'none' })
    }
    expect(wxMock.navigateTo).not.toHaveBeenCalled()
  })

  it('大白话：申请或拉售后记录在途时退出了详情页——回包后不提示、不跳页、不弹选择', async () => {
    const page = await mount()
    page.data.vm = doneVm()
    handlers.getMyAfterSales = () => ({ ok: true, list: [] })
    const p = page.onAfterSale()
    page.onUnload()
    await p
    expect(wxMock.showActionSheet).not.toHaveBeenCalled()

    handlers.applyRefund = () => ({ ok: true })
    page.applyFor('o1', 'L1')
    await modal().success({ confirm: true })
    expect(wxMock.showToast).not.toHaveBeenCalled()
    expect(wxMock.navigateTo).not.toHaveBeenCalled()
  })
})
