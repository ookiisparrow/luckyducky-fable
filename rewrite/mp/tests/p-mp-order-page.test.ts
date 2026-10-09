// 订单详情页主路径行为：加载成功/失败/查无此单、过期回包、复制与物流、取消、继续支付、确认收货、写评价、申请售后。
// 只桩云调用（callApp），api/映射/支付结果判定都用真的。Page 桩同 me-cont-failed.test.ts。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { callAppMock } = vi.hoisted(() => ({ callAppMock: vi.fn() }))
vi.mock('../utils/cloud', () => ({ callApp: callAppMock }))
vi.mock('../lib/haptics', () => ({ tapHaptic: vi.fn() }))
const { kefuMock } = vi.hoisted(() => ({ kefuMock: vi.fn() }))
vi.mock('../utils/customerService', () => ({ openCustomerService: kefuMock }))

let pageOpts: Record<string, any> = {}
;(globalThis as any).Page = (o: unknown) => {
  pageOpts = o as Record<string, any>
}

async function mount(id = 'o1', extra: Record<string, string> = {}): Promise<Record<string, any>> {
  vi.resetModules()
  await import('../pages/order/order')
  const page = Object.create(pageOpts) as Record<string, any>
  page.data = { ...pageOpts.data }
  page.setData = function (patch: Record<string, unknown>) {
    Object.assign(this.data as Record<string, unknown>, patch)
  }
  page.onLoad({ id, ...extra })
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
  kefuMock.mockReset()
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
  it('大白话：待支付单——状态卡「待支付」+ 右侧倒计时琥珀小字、金额纯数字、不出售后入口；查的是 query 里的单号', async () => {
    handlers.getOrderById = () => ({ ok: true, order: ORDER({ createdAt: Date.now() - 60_000 }) })
    const page = await mount()
    page.onShow()
    await flush()
    page.onHide()
    expect(callAppMock).toHaveBeenCalledWith('getOrderById', { id: 'o1' })
    expect(page.data).toMatchObject({ loading: false, loadFailed: false, canAfterSale: false, head: '待支付', truckPose: 'park' })
    expect(page.data.vm.amountLabel.replace(/[^0-9.]/g, '')).toBe('128.00') // 底部合计显示的金额
    expect(page.data.sub.text).toMatch(/^1[34]:\d{2} 后自动取消，请尽快支付$/)
    expect(page.data.sub.tone).toBe('warn')
    expect(page.data.steps.map((x: { state: string }) => x.state)).toEqual(['cur', 'todo', 'todo', 'todo'])
    expect(page.data.vm.id).toBe('o1')
  })

  it('大白话：小货车姿态——待发货开着走、待收货开着走、待退款倒车、完成卸货；待退款/支付异常说明句写原因 + 底部联系客服；已关闭不出底部栏（UI 审查 15 问 6a）', async () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ['paid', { truckPose: 'drive', head: '待发货', help: false, dock: true }],
      ['shipped', { truckPose: 'drive', head: '待收货', help: false, dock: true }],
      ['refund_required', { truckPose: 'reverse', head: '待退款', help: true, dock: true }],
      ['payment_exception', { truckPose: 'park', head: '支付异常', help: true, dock: true }],
      ['done', { truckPose: 'unload', help: false, dock: true }],
      ['closed', { truckPose: 'park', help: false, dock: false }],
    ]
    for (const [status, want] of cases) {
      handlers.getOrderById = () => ({ ok: true, order: ORDER({ status }) })
      const page = await mount()
      await page.reload()
      expect(page.data, status).toMatchObject(want)
    }
    handlers.getOrderById = () => ({ ok: true, order: ORDER({ status: 'refund_required' }) })
    const page = await mount()
    await page.reload()
    expect(page.data.sub).toEqual({ text: '需人工退款，请联系客服处理', tone: '' })
    expect(page.data.asLed).toEqual({ tone: 'var(--v5-warn)', halo: '' })
    page.onKefu()
    expect(kefuMock).toHaveBeenCalledTimes(1)
    // 带上下文：订单号 + 商品 + 原因先复制，客服那边直接粘贴
    const [copy, onCopied] = kefuMock.mock.calls[0]
    expect(copy).toContain('o1')
    expect(copy).toContain('小鸭')
    expect(copy).toContain('待退款')
    onCopied()
    expect(toastTitles()).toContain('已复制订单信息，粘贴给客服')
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
    expect(page.data.head).toBe('weird')
    expect(page.data.sub).toEqual({ text: '', tone: '' })
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
    expect(page.data.head).toBe('已关闭')
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

  it('大白话：点物流卡进物流页（带订单号）；没有运单号不动作', async () => {
    const page = await mount()
    await page.reload()
    page.onViewLogistics()
    expect(wxMock.navigateTo).toHaveBeenCalledWith({ url: '/pages/logistics/logistics?id=o1' })
  })
})

describe('订单详情：按住取消订单（拍板 7·按住 700ms）', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('大白话：只有待支付单能按；按满 700ms 取消成功提示并刷新，没按满松手提示「按住取消订单」；失败提示稍后再试', async () => {
    const page = await mount()
    await page.reload()
    handlers.cancelOrder = () => ({ ok: true })
    page.onCancelStart()
    expect(page.data.holding).toBe(true)
    vi.advanceTimersByTime(200)
    page.onCancelEnd()
    expect(page.data.holding).toBe(false)
    expect(callAppMock).not.toHaveBeenCalledWith('cancelOrder', expect.anything())
    expect(wxMock.showToast).toHaveBeenLastCalledWith({ title: '按住取消订单', icon: 'none' })

    handlers.getOrderById = () => ({ ok: true, order: ORDER({ status: 'closed' }) })
    page.onCancelStart()
    await vi.advanceTimersByTimeAsync(700)
    expect(callAppMock).toHaveBeenCalledWith('cancelOrder', { id: 'o1' })
    expect(wxMock.showToast).toHaveBeenLastCalledWith({ title: '订单已取消', icon: 'success' })
    expect(page.data.head).toBe('已关闭')
    expect(wxMock.showModal).not.toHaveBeenCalled()

    callAppMock.mockClear()
    page.onCancelStart() // 已关闭：按住也不取消
    await vi.advanceTimersByTimeAsync(700)
    expect(callAppMock).not.toHaveBeenCalledWith('cancelOrder', expect.anything())

    handlers.getOrderById = () => ({ ok: true, order: ORDER() })
    await page.reload()
    handlers.cancelOrder = () => ({ ok: false, error: 'BAD_STATUS' })
    page.onCancelStart()
    await vi.advanceTimersByTimeAsync(700)
    expect(wxMock.showToast).toHaveBeenLastCalledWith({ title: '取消没成功，稍后再试', icon: 'none' })
  })

  it('大白话：取消请求在途时退出了详情页——回包后不再弹提示', async () => {
    const page = await mount()
    await page.reload()
    handlers.cancelOrder = () => ({ ok: true })
    page.onCancelStart()
    vi.advanceTimersByTime(700)
    page.onUnload()
    await vi.advanceTimersByTimeAsync(0)
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
    expect(toastTitles()).toEqual(['订单已保留，可在订单详情继续支付'])
  })
})

describe('订单详情：确认收货与写评价', () => {
  // 页面桩没挂 px-fx：确认半屏/提示走 utils/sysUi 的原生兜底，断言原生调用即可（自绘本身见 sys-ui-9c.test）
  it('大白话：确认收货——成功提示并刷新；失败提示稍后再试；取消确认不发请求', async () => {
    const page = await mount()
    handlers.confirmReceive = () => ({ ok: true })
    page.onConfirm()
    expect(modal()).toMatchObject({ title: '确认收货', confirmText: '确认收货', showCancel: true })
    modal().success({ confirm: false })
    await flush()
    expect(callAppMock).not.toHaveBeenCalledWith('confirmReceive', expect.anything())
    page.onConfirm()
    modal(1).success({ confirm: true })
    await flush()
    expect(callAppMock).toHaveBeenCalledWith('confirmReceive', { id: 'o1' })
    expect(wxMock.showToast).toHaveBeenLastCalledWith({ title: '已确认收货', icon: 'success' })

    handlers.confirmReceive = () => ({ ok: false, error: 'BAD_STATUS' })
    page.onConfirm()
    modal(2).success({ confirm: true })
    await flush()
    expect(wxMock.showToast).toHaveBeenLastCalledWith({ title: '操作没成功，稍后再试', icon: 'none' })
  })

  it('大白话：确认收货请求在途时退出了详情页——回包后不再弹提示', async () => {
    const page = await mount()
    handlers.confirmReceive = () => ({ ok: true })
    page.onConfirm()
    modal().success({ confirm: true })
    page.onUnload()
    await flush()
    expect(wxMock.showToast).not.toHaveBeenCalled()
  })

  it('大白话：写评价跳评价页，行号/商品名/规格/封面都做 URL 编码（含 & 也不截断）', async () => {
    const page = await mount()
    page.data.vm = { id: 'o1', items: [{ lineId: 'p&1', name: '小鸭 #1', spec: '黄', cover: 'https://x/a.jpg?s=1' }] }
    page.onWriteReview({ currentTarget: { dataset: { i: 0 } } })
    expect(wxMock.navigateTo).toHaveBeenCalledWith({
      url:
        '/pages/review/review?orderId=o1&lineId=' + encodeURIComponent('p&1') + '&name=' + encodeURIComponent('小鸭 #1') +
        '&spec=' + encodeURIComponent('黄') + '&cover=' + encodeURIComponent('https://x/a.jpg?s=1'),
    })
  })
})

describe('订单详情：申请售后（拍板 7·自绘底部弹层）', () => {
  const line = (lineId: string, name: string, spec = '') => ({ lineId, name, spec, priceLabel: '', qty: 1, enteredQty: 0, refundable: true, cover: '' })
  const doneVm = (n = 1) => ({ id: 'o1', status: 'done', items: n === 1 ? [line('L1', '小鸭', '黄')] : Array.from({ length: n }, (_, i) => line('L' + (i + 1), '鸭' + (i + 1))) })
  const tapV = (v: string) => ({ currentTarget: { dataset: { v } } })

  it('大白话：还没加载出订单时点售后不动作；全部行都申请过——弹层照开，「退款」置灰写原因、默认落「换货」', async () => {
    const page = await mount()
    await page.onAfterSale()
    expect(callAppMock).not.toHaveBeenCalled()

    handlers.getMyAfterSales = () => ({ ok: true, list: [{ _id: 'a1', orderId: 'o1', lineId: 'L1', appliedAt: 1 }] })
    page.data.vm = doneVm()
    await page.onAfterSale()
    expect(callAppMock).toHaveBeenCalledWith('getMyAfterSales', { cursor: undefined, limit: 100, orderId: 'o1' }) // 只拉本单售后（#443）
    expect(page.data).toMatchObject({ asOpen: true, asType: '换货', asBlock: '这件已申请过' })
    expect(wxMock.showToast).not.toHaveBeenCalled()
  })

  it('大白话：激活过课程（不可退）——弹层照开；点「退款」选不上并提示原因，提交也不调退款；换货/补发走联系客服', async () => {
    handlers.getMyAfterSales = () => ({ ok: true, list: [] })
    const page = await mount()
    page.data.vm = { id: 'o1', status: 'done', items: [{ ...line('L1', '小鸭', '黄'), refundable: false }] }
    await page.onAfterSale()
    expect(page.data).toMatchObject({ asOpen: true, asType: '换货', asBlock: '已开课的商品不支持退款', asLine: 'L1' })
    page.onAsType(tapV('退款'))
    expect(page.data.asType).toBe('换货')
    expect(toastTitles()).toContain('已开课的商品不支持退款')
    page.data.asType = '退款' // 就算绕过置灰硬塞退款，提交也不调退款接口
    await page.onAsSubmit()
    expect(callAppMock).not.toHaveBeenCalledWith('applyRefund', expect.anything())
    page.onAsType(tapV('补发'))
    await page.onAsSubmit()
    expect(kefuMock).toHaveBeenCalledTimes(1)
    expect(kefuMock.mock.calls[0][0]).toContain('补发')
  })

  it('大白话：拉售后记录在途时连点「申请售后」——只拉一次，并显示加载中', async () => {
    let release!: (v: unknown) => void
    handlers.getMyAfterSales = () => new Promise((r) => (release = r))
    const page = await mount()
    page.data.vm = doneVm()
    const a = page.onAfterSale()
    const b = page.onAfterSale()
    release({ ok: true, list: [] })
    await Promise.all([a, b])
    expect(callAppMock.mock.calls.filter((c: unknown[]) => c[0] === 'getMyAfterSales')).toHaveLength(1)
    expect(wxMock.showLoading).toHaveBeenCalledTimes(1)
    expect(wxMock.hideLoading).toHaveBeenCalledTimes(1)
    expect(page.data.asOpen).toBe(true)
  })

  it('大白话：弹层默认「退款 + 无理由」（拍板 3）；选「退款」提交才调退款接口，原因带上所选标签；成功提示并跳我的售后', async () => {
    handlers.getMyAfterSales = () => ({ ok: true, list: [] })
    handlers.applyRefund = () => ({ ok: true })
    const page = await mount()
    page.data.vm = doneVm()
    await page.onAfterSale()
    expect(page.data).toMatchObject({ asOpen: true, asType: '退款', asReason: '无理由', asLine: 'L1' })
    expect(page.data.asLines).toEqual([{ lineId: 'L1', name: '小鸭', spec: '黄' }]) // 规格单独一行，同款不同色分得清
    page.onAsReason(tapV('少件'))
    await page.onAsSubmit()
    expect(callAppMock).toHaveBeenCalledWith('applyRefund', { orderId: 'o1', lineId: 'L1', reason: '少件' })
    expect(wxMock.showToast).toHaveBeenCalledWith({ title: '已提交申请', icon: 'success' })
    expect(wxMock.navigateTo.mock.calls[0][0].url).toBe('/pages/aftersales/aftersales')
    expect(page.data.asOpen).toBe(false)
  })

  it('大白话：选「换货」或「补发」——提交键改「联系客服办理」，走客服入口，绝不调退款接口', async () => {
    handlers.getMyAfterSales = () => ({ ok: true, list: [] })
    for (const t of ['换货', '补发']) {
      const page = await mount()
      page.data.vm = doneVm()
      await page.onAfterSale()
      page.onAsType(tapV(t))
      expect(page.data.asType).toBe(t)
      await page.onAsSubmit()
    }
    expect(callAppMock).not.toHaveBeenCalledWith('applyRefund', expect.anything())
    expect(kefuMock).toHaveBeenCalledTimes(2)
    // 打开客服前把「订单号 + 商品 + 原因」交给客服入口去复制
    expect(kefuMock.mock.calls[0][0]).toBe('订单号：o1\n商品：小鸭 · 黄\n售后：换货 · 无理由')
  })

  it('大白话：多件单——弹层里列出全部可退商品（8 件也都选得到），选第 7 件提交的就是第 7 件', async () => {
    handlers.getMyAfterSales = () => ({ ok: true, list: [] })
    handlers.applyRefund = () => ({ ok: true })
    const page = await mount()
    page.data.vm = doneVm(8)
    await page.onAfterSale()
    expect(page.data.asLines.map((l: { name: string }) => l.name)).toEqual(['鸭1', '鸭2', '鸭3', '鸭4', '鸭5', '鸭6', '鸭7', '鸭8'])
    page.onAsLine({ currentTarget: { dataset: { v: 'L7' } } })
    await page.onAsSubmit()
    expect(callAppMock).toHaveBeenCalledWith('applyRefund', { orderId: 'o1', lineId: 'L7', reason: '无理由' })
  })

  it('大白话：点「取消」或遮罩——收起弹层，什么都不提交', async () => {
    vi.useFakeTimers()
    handlers.getMyAfterSales = () => ({ ok: true, list: [] })
    const page = await mount()
    page.data.vm = doneVm()
    await page.onAfterSale()
    page.onAsClose()
    expect(page.data.asOut).toBe(true)
    vi.advanceTimersByTime(240)
    expect(page.data.asOpen).toBe(false)
    vi.useRealTimers()
    expect(callAppMock).not.toHaveBeenCalledWith('applyRefund', expect.anything())
  })

  it('大白话：云端拒绝申请——按原因说人话（已申请过/已开课不可退/额度用完/其它稍后再试），不跳页；提交在途连点只发一次', async () => {
    const cases: Array<[string, string]> = [
      ['ALREADY_APPLIED', '这条已申请过了'],
      ['NOT_REFUNDABLE', '该条目不可退（已开课）'],
      ['NOTHING_LEFT', '本单可退额度已用完'],
      ['INTERNAL', '申请没成功，稍后再试'],
    ]
    handlers.getMyAfterSales = () => ({ ok: true, list: [] })
    const page = await mount()
    page.data.vm = doneVm()
    await page.onAfterSale()
    for (const [error, msg] of cases) {
      handlers.applyRefund = () => ({ ok: false, error })
      await Promise.all([page.onAsSubmit(), page.onAsSubmit()])
      expect(wxMock.showToast).toHaveBeenLastCalledWith({ title: msg, icon: 'none' })
      expect(page.data.asBusy).toBe(false)
    }
    expect(callAppMock.mock.calls.filter((c: unknown[]) => c[0] === 'applyRefund')).toHaveLength(4)
    expect(wxMock.navigateTo).not.toHaveBeenCalled()
  })

  it('大白话：申请或拉售后记录在途时退出了详情页——回包后不提示、不跳页、不开弹层', async () => {
    const page = await mount()
    page.data.vm = doneVm()
    handlers.getMyAfterSales = () => ({ ok: true, list: [] })
    const p = page.onAfterSale()
    page.onUnload()
    await p
    expect(page.data.asOpen).toBe(false)

    const page2 = await mount()
    page2.data.vm = doneVm()
    await page2.onAfterSale()
    handlers.applyRefund = () => ({ ok: true })
    const sub = page2.onAsSubmit()
    page2.onUnload()
    await sub
    expect(wxMock.showToast).not.toHaveBeenCalled()
    expect(wxMock.navigateTo).not.toHaveBeenCalled()
  })
})

describe('订单详情：UX 修复轮', () => {
  afterEach(() => vi.useRealTimers())
  const touch = (x: number, y: number) => ({ touches: [{ clientX: x, clientY: y }] })

  it('大白话：确认收货在途连点——只发一次请求，期间显示加载中', async () => {
    let release!: (v: unknown) => void
    handlers.confirmReceive = () => new Promise((r) => (release = r))
    const page = await mount()
    page.onConfirm()
    modal().success({ confirm: true })
    await flush()
    page.onConfirm() // 在途再点：_busy 挡住，连确认都不再弹
    expect(wxMock.showModal).toHaveBeenCalledTimes(1)
    release({ ok: true })
    await flush()
    expect(callAppMock.mock.calls.filter((c: unknown[]) => c[0] === 'confirmReceive')).toHaveLength(1)
    expect(wxMock.showLoading).toHaveBeenCalledWith({ title: '正在确认', mask: true })
    expect(wxMock.hideLoading).toHaveBeenCalledTimes(1)
  })

  it('大白话：取消订单在途再触发——只发一次请求', async () => {
    let release!: (v: unknown) => void
    handlers.cancelOrder = () => new Promise((r) => (release = r))
    const page = await mount()
    await page.reload()
    const a = page.cancelNow()
    const b = page.cancelNow()
    release({ ok: true })
    await Promise.all([a, b])
    expect(callAppMock.mock.calls.filter((c: unknown[]) => c[0] === 'cancelOrder')).toHaveLength(1)
    expect(wxMock.showLoading).toHaveBeenCalledWith({ title: '正在取消', mask: true })
  })

  it('大白话：按住取消时手指挪开超过 10px——作废，不取消', async () => {
    vi.useFakeTimers()
    handlers.cancelOrder = () => ({ ok: true })
    const page = await mount()
    await page.reload()
    page.onCancelStart(touch(100, 100))
    page.onCancelMove(touch(100, 130))
    await vi.advanceTimersByTimeAsync(800)
    expect(callAppMock).not.toHaveBeenCalledWith('cancelOrder', expect.anything())
    expect(page.data.holding).toBe(false)
  })

  it('大白话：倒计时走到 0——先藏「去支付」显示「已超时」，自动刷新一次（只一次）', async () => {
    vi.useFakeTimers()
    const T = Date.now()
    handlers.getOrderById = () => ({ ok: true, order: ORDER({ createdAt: T - 15 * 60_000 + 1500 }) })
    const page = await mount()
    await page.reload()
    expect(page.data.expired).toBe(false)
    callAppMock.mockClear()
    vi.setSystemTime(T + 2000)
    page.tick()
    expect(page.data.expired).toBe(true)
    expect(page.data.sub.text).toBe('15 分钟内未支付，订单已关闭')
    expect(page.data).toMatchObject({ head: '已超时', asLed: { tone: 'rgba(17,17,17,.28)', halo: 'none' } })
    await flush()
    expect(callAppMock.mock.calls.filter((c: unknown[]) => c[0] === 'getOrderById')).toHaveLength(1)
    expect(page.data.expired).toBe(true) // 云端还没关单：仍按超时展示，不回显去支付
    page.tick()
    page.tick()
    await flush()
    expect(callAppMock.mock.calls.filter((c: unknown[]) => c[0] === 'getOrderById')).toHaveLength(1)
  })

  it('大白话：从列表点多件单「写评价」进来——提示「选一件来评价」（只提示一次）', async () => {
    handlers.getOrderById = () => ({ ok: true, order: ORDER({ status: 'done' }) })
    const page = await mount('o1', { pick: 'review' })
    await page.reload()
    await page.reload()
    expect(toastTitles().filter((t: string) => t === '选一件来评价')).toHaveLength(1)
  })
})
