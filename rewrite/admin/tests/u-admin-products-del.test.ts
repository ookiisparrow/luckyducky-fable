// @vitest-environment happy-dom
// Products.vue 编辑器各列表的删除按钮：删的就是被点的那一行，别的行原样留着。
import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'

vi.mock('../src/api/products', () => ({
  listDrafts: vi.fn().mockResolvedValue({
    ok: true,
    list: [
      {
        id: 'p1',
        name: '材料包',
        price: '99',
        images: ['f1', 'f2'],
        skus: [{ name: 'A', price: '1' }, { name: 'B', price: '2' }],
        params: [['k1', 'v1'], ['k2', 'v2']],
        detailSections: [{ lead: 'L1', body: '' }, { lead: 'L2', body: '' }],
        kit: [{ icon: 'circle', name: 'N1', qty: '' }, { icon: 'circle', name: 'N2', qty: '' }],
      },
    ],
    urls: {},
    listed: {},
  }),
  saveDraft: vi.fn().mockResolvedValue({ ok: true }),
  deleteDraft: vi.fn(),
  uploadImage: vi.fn(),
  publishProduct: vi.fn(),
  unpublishProduct: vi.fn(),
  republishProduct: vi.fn(),
}))

import Products from '../src/pages/Products.vue'

async function mountSlice(wizardSlice: 2 | 3) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div/>' } }] })
  await router.push('/')
  await router.isReady()
  const w = mount(Products, { props: { embed: true, wizardProductId: 'p1', wizardSlice }, global: { plugins: [router] } })
  await flushPromises()
  return w
}
const vals = (w: Awaited<ReturnType<typeof mountSlice>>, sel: string) => w.findAll(sel).map((e) => (e.element as HTMLInputElement).value)

describe('Products.vue 编辑器删除行', () => {
  it('大白话：相册点第一张的 ✕，只剩第二张', async () => {
    const w = await mountSlice(2)
    expect(w.findAll('.g-item')).toHaveLength(2)
    await w.find('.g-item .g-del').trigger('click')
    expect(w.findAll('.g-item')).toHaveLength(1)
  })

  it('大白话：规格/参数/段落/材料各删第一行，留下的都是第二行', async () => {
    const w = await mountSlice(3)
    await w.find('button[title="删除该规格"]').trigger('click')
    await w.find('button[title="删除该参数"]').trigger('click')
    await w.find('button[title="删除该段落"]').trigger('click')
    await w.find('button[title="删除该材料"]').trigger('click')
    expect(vals(w, '.skurow input[placeholder="规格名"]')).toEqual(['B'])
    expect(vals(w, '.kvrow input[placeholder="参数名（如 适用年龄）"]')).toEqual(['k2'])
    expect(vals(w, '.secrow input[placeholder="小标题"]')).toEqual(['L2'])
    expect(vals(w, '.kvrow input[placeholder="物品名"]')).toEqual(['N2'])
  })
})
