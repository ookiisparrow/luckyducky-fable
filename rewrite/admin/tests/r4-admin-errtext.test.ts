// @vitest-environment happy-dom
// 后台页面实际会碰到的云端码要有中文，不落「操作失败（CODE）」「操作没成功（CODE）」兜底；
// 橱窗保存失败要说原因，部分写入要说清「有几个没存上、其余已存」。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { orderErrorText } from '../src/lib/mapMoney'
import { scmErrorText } from '../src/lib/mapScm'
import { launchErrorText } from '../src/lib/mapSystem'

const api = vi.hoisted(() => ({ listShowcase: vi.fn(), saveShowcase: vi.fn() }))
vi.mock('../src/api/products', () => api)
import Showcase from '../src/pages/Showcase.vue'

describe('钱页码表', () => {
  it.each(['DOC_READ_FAIL', 'BAD_DATE', 'NO_DOWNLOAD_URL', 'BILL_FETCH_FAIL', 'BILL_QUERY_401:{"code":"SIGN_ERROR"}', 'BILL_DOWNLOAD_500', 'WXPAY_FETCH_FAIL:ECONNRESET'])(
    '大白话：%s 有中文，不落「操作失败（…）」',
    (code) => {
      const t = orderErrorText(code)
      expect(t).toMatch(/^[一-鿿]/)
      expect(t.startsWith('操作失败')).toBe(false)
    }
  )

  it('大白话：拉账单的失败把微信回的原文挂在括号里，给技术排查', () => {
    expect(orderErrorText('BILL_QUERY_401:{"code":"SIGN_ERROR"}')).toContain('（BILL_QUERY_401:{"code":"SIGN_ERROR"}）')
  })

  it('大白话：DOC_READ_FAIL 在退款里也会因售后单、支付配置读失败回——不说成「订单数据」，和全后台同一句', () => {
    expect(orderErrorText('DOC_READ_FAIL')).not.toContain('订单')
    expect(orderErrorText('DOC_READ_FAIL')).toBe(launchErrorText('DOC_READ_FAIL'))
  })

  it('大白话：微信说这天没有账单，直说「这天还没有账单」，不吓人说拉取出错', () => {
    const t = orderErrorText('BILL_QUERY_400:{"code":"NO_STATEMENT_EXIST","message":"要申请的账单不存在"}')
    expect(t).toContain('这天还没有账单')
  })
})

describe('进销存码表', () => {
  it.each(['NO_NAME', 'BAD_CATEGORY', 'BAD_TIER', 'BAD_FORM', 'BAD_THRESHOLD', 'BAD_ADJUST', 'FG_NOT_ADJUSTABLE', 'BAD_MOVE', 'CONTENTION', 'LEDGER_WRITE_FAILED', 'PRODUCE_FAIL', 'BAD_LINES', 'BAD_ID', 'NO_PURCHASE', 'NO_OUTWORK', 'NO_WORKER'])(
    '大白话：%s 有中文，不落「操作没成功（…）」',
    (code) => {
      expect(scmErrorText(code).startsWith('操作没成功')).toBe(false)
    }
  )
})

describe('进销存 BAD_LINES', () => {
  it('大白话：同一料号重复、数量不是正整数也回 BAD_LINES——文案把这些原因都说到，不只说「空的或太多」', () => {
    const t = scmErrorText('BAD_LINES')
    expect(t).toContain('重复')
    expect(t).toContain('正整数')
  })
})

describe('Showcase.vue 保存失败说原因', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    api.listShowcase.mockReset().mockResolvedValue({ ok: true, list: [{ _id: 'p1', name: '小鸭', sort: 1, featured: true, listed: true, price: '99' }], urls: {} })
    api.saveShowcase.mockReset()
  })
  afterEach(() => {
    vi.useRealTimers()
  })
  const toggleAndSave = async () => {
    const w = mount(Showcase)
    await flushPromises()
    await w.find('.panel .switch').trigger('click')
    await vi.advanceTimersByTimeAsync(700)
    await flushPromises()
    return w
  }

  it('大白话：部分写入（PARTIAL_WRITE:2），说清「2 个没存上、其余已存」', async () => {
    api.saveShowcase.mockResolvedValue({ ok: false, status: 400, error: 'PARTIAL_WRITE:2' })
    const w = await toggleAndSave()
    const t = w.find('.ld-status').text()
    expect(t).toContain('2 个商品')
    expect(t).toContain('其余已存')
  })

  it('大白话：部分写入别叫人刷新（刷新会丢这次的排序）；点「重存」把整表再发一遍，成功后提示收掉', async () => {
    api.saveShowcase.mockResolvedValueOnce({ ok: false, status: 400, error: 'PARTIAL_WRITE:1' }).mockResolvedValueOnce({ ok: true })
    const w = await toggleAndSave()
    expect(w.find('.ld-status').text()).toContain('别刷新')
    await w.findAll('button').find((b) => b.text() === '重存')!.trigger('click')
    await flushPromises()
    expect(api.saveShowcase).toHaveBeenCalledTimes(2)
    expect(api.saveShowcase.mock.calls[1][0]).toEqual(api.saveShowcase.mock.calls[0][0])
    expect(api.listShowcase).toHaveBeenCalledTimes(1)
    expect(w.find('.ld-status').exists()).toBe(false)
  })

  it('大白话：保存超时，只说「可能已经生效」，不冠「保存失败」', async () => {
    api.saveShowcase.mockResolvedValue({ ok: false, status: 0, error: 'CALL_TIMEOUT' })
    const w = await toggleAndSave()
    expect(w.find('.ld-status').text()).toBe('服务器太久没回话。如果刚才是提交操作，可能已经生效——先刷新看看，再决定要不要重试。')
    expect(w.text()).not.toContain('保存失败') // 徽标不再和这句打架
  })

  it('大白话：再存成功，失败原因收掉', async () => {
    api.saveShowcase.mockResolvedValueOnce({ ok: false, status: 400, error: 'PARTIAL_WRITE:1' }).mockResolvedValueOnce({ ok: true })
    const w = await toggleAndSave()
    expect(w.find('.ld-status').exists()).toBe(true)
    await w.find('.panel .switch').trigger('click')
    await vi.advanceTimersByTimeAsync(700)
    await flushPromises()
    expect(w.find('.ld-status').exists()).toBe(false)
  })
})
