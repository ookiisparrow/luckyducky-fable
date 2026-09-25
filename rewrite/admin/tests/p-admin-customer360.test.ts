// @vitest-environment happy-dom
// Customer360.vue 挂载测试：搜客户成败/无结果三态分开；点开全景成败；档案读失败≠无档；
// 看 A 的全景还没回包就切到 B，A 的数据不能落到 B 的头下（隐私错配）。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const api = vi.hoisted(() => ({ searchCustomer: vi.fn(), getCustomer360: vi.fn(), getUser: vi.fn() }))
vi.mock('../src/api/cs', () => api)

import Customer360 from '../src/pages/Customer360.vue'

// 形状照云端 searchCustomer / getCustomer360（orchestrator panels）/ getUser
const hit = (openid: string, nickname: string) => ({ openid, nickname, phone: '13800001111', avatar: '', createdAt: 1_700_000_000_000, matchedBy: ['phone'] })
const pano = (openid: string, note: string) => ({ ok: true, openid, panels: [{ key: 'orders', label: '订单', order: 1, data: { note } }] })
const user = (nickname: string) => ({ ok: true, user: { openid: 'o', nickname, avatar: '', phone: '13900002222', bio: '', createdAt: null, updatedAt: null } })
beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset()
  api.searchCustomer.mockResolvedValue({ ok: true, count: 2, customers: [hit('oA', '阿花'), hit('oB', '阿草')] })
  api.getCustomer360.mockImplementation(async (id: string) => pano(id, id + '的订单'))
  api.getUser.mockImplementation(async (id: string) => user(id === 'oA' ? '阿花' : '阿草'))
})
const mountAndSearch = async () => {
  const w = mount(Customer360)
  await w.find('input').setValue('138')
  await w.find('input').trigger('keyup.enter')
  await flushPromises()
  return w
}
type W = Awaited<ReturnType<typeof mountAndSearch>>
const statuses = (w: W) => w.findAll('.ld-status').map((p) => p.text())
const back = (w: W) => w.findAll('button').find((b) => b.text() === '返回结果')!

describe('Customer360.vue 搜索', () => {
  it('大白话：命中列表显昵称、掩码手机、命中方式', async () => {
    const w = await mountAndSearch()
    expect(api.searchCustomer).toHaveBeenCalledWith('138')
    const rows = w.findAll('.hit-row')
    expect(rows).toHaveLength(2)
    expect(rows[0].text()).toContain('阿花')
    expect(rows[0].text()).toContain('138****1111')
    expect(rows[0].text()).not.toContain('13800001111')
    expect(statuses(w)).toEqual([])
  })

  it('大白话：搜索失败说失败，不说「没找到」', async () => {
    api.searchCustomer.mockResolvedValue({ ok: false, status: 200, error: 'USER_LOOKUP_FAIL' })
    const w = await mountAndSearch()
    expect(statuses(w)).toEqual(['搜索失败：USER_LOOKUP_FAIL'])
  })

  it('大白话：真没人才说「没找到匹配的客户」', async () => {
    api.searchCustomer.mockResolvedValue({ ok: true, count: 0, customers: [] })
    const w = await mountAndSearch()
    expect(statuses(w)).toEqual(['没找到匹配的客户'])
  })
})

describe('Customer360.vue 全景', () => {
  it('大白话：点开客户——身份头与面板都渲染', async () => {
    const w = await mountAndSearch()
    await w.findAll('.hit-row')[0].trigger('click')
    await flushPromises()
    expect(api.getCustomer360).toHaveBeenCalledWith('oA')
    expect(w.find('.p-name').text()).toBe('阿花')
    expect(w.find('.p-meta').text()).toContain('139****2222')
    expect(w.text()).toContain('oA的订单')
    expect(statuses(w)).toEqual([])
  })

  it('大白话：全景取数失败——显原因，留「返回结果」出口', async () => {
    api.getCustomer360.mockResolvedValue({ ok: false, status: 500, error: 'X1' })
    const w = await mountAndSearch()
    await w.findAll('.hit-row')[0].trigger('click')
    await flushPromises()
    expect(statuses(w)).toContain('加载失败：X1')
    await back(w).trigger('click')
    expect(w.findAll('.hit-row')).toHaveLength(2)
  })

  it('大白话：档案读失败说读失败，不说「暂无档案」；真无档才说暂无', async () => {
    api.getUser.mockResolvedValue({ ok: false, status: 200, error: 'USER_LOOKUP_FAIL' })
    const w = await mountAndSearch()
    await w.findAll('.hit-row')[0].trigger('click')
    await flushPromises()
    expect(statuses(w)).toEqual(['用户档案加载失败，请刷新重试'])

    api.getUser.mockResolvedValue({ ok: true, user: null })
    await w.findAll('button').find((b) => b.text() === '刷新')!.trigger('click')
    await flushPromises()
    expect(statuses(w)).toEqual(['该客户暂无用户档案（可能仅有订单/会话记录）'])
  })

  it('大白话：A 的全景没回包就切到 B——A 的数据不落到 B 头下', async () => {
    let releaseA: (v: unknown) => void = () => {}
    api.getCustomer360.mockImplementationOnce(() => new Promise((r) => (releaseA = r)))
    const w = await mountAndSearch()
    await w.findAll('.hit-row')[0].trigger('click')
    await back(w).trigger('click')
    await w.findAll('.hit-row')[1].trigger('click')
    await flushPromises()
    releaseA(pano('oA', 'oA的订单'))
    await flushPromises()
    expect(w.find('code.cur').text()).toBe('oB')
    expect(w.text()).toContain('oB的订单')
    expect(w.text()).not.toContain('oA的订单')
  })
})
