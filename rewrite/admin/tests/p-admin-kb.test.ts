// @vitest-environment happy-dom
// Kb.vue 挂载测试：FAQ 整册加载成败（失败不装「暂无 FAQ」、不放开保存——空表整册覆盖会删光）、
// 保存成败与保存后刷新失败、键为空/重复拦下。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { transportErrorText } from '../src/lib/mapSystem'

const api = vi.hoisted(() => ({ listKb: vi.fn(), saveKb: vi.fn() }))
vi.mock('../src/api/cs', () => api)

import Kb from '../src/pages/Kb.vue'

// 形状照云端 listKb / saveKb
const faq = (key: string, question: string) => ({ key, question, answer: '答', category: 'logistics', enabled: true, order: 0, featured: false })
const LIST = { ok: true, list: [faq('logistics:eta', '多久到？'), faq('logistics:track', '怎么查单号？')] }
beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset()
  api.listKb.mockResolvedValue(LIST)
  api.saveKb.mockResolvedValue({ ok: true, count: 2 })
})
const mountPage = async () => {
  const w = mount(Kb)
  await flushPromises()
  return w
}
type W = Awaited<ReturnType<typeof mountPage>>
const status = (w: W) => (w.find('.ld-status').exists() ? w.find('.ld-status').text() : '')
const keys = (w: W) => w.findAll('input.kb-key').map((i) => (i.element as HTMLInputElement).value)
const save = async (w: W) => {
  await w.findAll('button').find((b) => b.text() === '保存整册')!.trigger('click')
  await flushPromises()
}

describe('Kb.vue 加载', () => {
  it('大白话：按回包渲染每条 FAQ', async () => {
    const w = await mountPage()
    expect(status(w)).toBe('')
    expect(keys(w)).toEqual(['logistics:eta', 'logistics:track'])
  })

  it('大白话：加载失败显原因，不显「暂无 FAQ」引导；点保存不发请求', async () => {
    api.listKb.mockResolvedValue({ ok: false, status: 200, error: 'DOC_READ_FAIL' })
    const w = await mountPage()
    expect(status(w)).toBe('加载失败（DOC_READ_FAIL）')
    expect(w.text()).not.toContain('暂无 FAQ')
    await save(w)
    expect(api.saveKb).not.toHaveBeenCalled()
    expect(status(w)).toBe('知识库未成功载入，暂不能保存（避免覆盖并删光已有 FAQ·请刷新重试）')
  })

  it('大白话：真空册才显「暂无 FAQ」引导', async () => {
    api.listKb.mockResolvedValue({ ok: true, list: [] })
    const w = await mountPage()
    expect(w.text()).toContain('暂无 FAQ')
  })
})

describe('Kb.vue 保存整册', () => {
  it('大白话：去掉首尾空格后整册保存，成功后重拉并报条数', async () => {
    const w = await mountPage()
    await w.findAll('input.kb-q')[0].setValue('  多久能到？ ')
    await save(w)
    expect(api.saveKb.mock.calls[0][0][0]).toMatchObject({ key: 'logistics:eta', question: '多久能到？' })
    expect(api.listKb).toHaveBeenCalledTimes(2)
    expect(status(w)).toBe('已保存 2 条（整册覆盖·被删的行已真删）')
  })

  it('大白话：保存失败显原因、不重拉', async () => {
    api.saveKb.mockResolvedValue({ ok: false, status: 0, error: 'NETWORK:Failed to fetch' })
    const w = await mountPage()
    await save(w)
    expect(status(w)).toBe(transportErrorText('NETWORK:Failed to fetch'))
    expect(api.listKb).toHaveBeenCalledTimes(1)
  })

  it('大白话：保存成功但重拉失败——说清已保存、让人重开确认', async () => {
    const w = await mountPage()
    api.listKb.mockResolvedValue({ ok: false, status: 500, error: 'X' })
    await save(w)
    expect(status(w)).toBe('已保存 2 条，但列表刷新失败，请重开本页确认')
  })

  it('大白话：键为空或重复都拦下不发', async () => {
    const w = await mountPage()
    await w.findAll('input.kb-key')[1].setValue('logistics:eta')
    await save(w)
    expect(status(w)).toBe('键重复：「logistics:eta」——键必须唯一，否则 bot 命中会互相覆盖')
    await w.findAll('input.kb-key')[1].setValue(' ')
    await save(w)
    expect(status(w)).toContain('每条 FAQ 都要填「键」')
    expect(api.saveKb).not.toHaveBeenCalled()
  })
})
