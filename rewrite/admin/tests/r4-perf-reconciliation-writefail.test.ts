// @vitest-environment happy-dom
// #400-35（对账页）：拉账单超时不能说成「拉取失败：……可能已经生效」——自相矛盾，还诱人重复拉。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const api = vi.hoisted(() => ({ getReconciliation: vi.fn(), getBillMatch: vi.fn(), downloadBill: vi.fn() }))
vi.mock('../src/api/system', () => api)

import Reconciliation from '../src/pages/Reconciliation.vue'
import { transportErrorText } from '../src/lib/mapSystem'
import CONTRACT from '../../../tests/contracts/admin-money.json'

const sample = (name: string) => structuredClone((CONTRACT.cases as unknown as Record<string, { sample: any }>)[name].sample)

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset()
  api.getReconciliation.mockResolvedValue(sample('getReconciliation'))
  api.getBillMatch.mockResolvedValue(sample('getBillMatch'))
})

describe('Reconciliation.vue 拉账单写失败文案', () => {
  it('大白话：拉账单超时——只说「可能已生效、先刷新看看」，不冠「拉取失败」', async () => {
    api.downloadBill.mockResolvedValue({ ok: false, status: 0, error: 'CALL_TIMEOUT' })
    const w = mount(Reconciliation)
    await flushPromises()
    await w.find('input[placeholder="拉某日账单 YYYY-MM-DD"]').setValue('2026-09-01')
    await w.findAll('button').find((b) => b.text() === '拉单日')!.trigger('click')
    await flushPromises()
    const text = w.find('.ld-status').text()
    expect(text).toBe(transportErrorText('CALL_TIMEOUT'))
    expect(text).not.toContain('失败')
  })
})
