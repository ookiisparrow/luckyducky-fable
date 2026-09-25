// @vitest-environment happy-dom
// Agents.vue 停用/恢复成功提示不被随后的 reload 抹掉，且显示为成功色而非红色。
import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { transportErrorText } from '../src/lib/mapSystem'

const { listAgentsMock, disableAgentMock } = vi.hoisted(() => ({ listAgentsMock: vi.fn(), disableAgentMock: vi.fn() }))
vi.mock('../src/api/system', () => ({
  listAgents: listAgentsMock,
  createAgent: vi.fn(),
  disableAgent: disableAgentMock,
  setAgentWecomUserId: vi.fn(),
}))
vi.mock('../src/api/cs', () => ({ getCsatReport: vi.fn().mockResolvedValue({ ok: true, total: 0, dist: {} }) }))

import Agents from '../src/pages/Agents.vue'

describe('Agents.vue 停用成功提示留得住', () => {
  it('大白话：两步确认停用成功后，刷新列表回来提示仍是「已停用」，且不是红色', async () => {
    listAgentsMock.mockResolvedValue({ ok: true, agents: [{ id: 'a1', name: '外包一号', disabled: false }] })
    disableAgentMock.mockResolvedValue({ ok: true })
    const w = mount(Agents)
    await flushPromises()
    expect(w.find('.ld-status').exists()).toBe(false)
    const stopBtn = () => w.findAll('button').find((b) => b.text().includes('停用'))!
    await stopBtn().trigger('click')
    await stopBtn().trigger('click')
    await flushPromises()
    expect(disableAgentMock).toHaveBeenCalledWith('a1', true)
    expect(listAgentsMock).toHaveBeenCalledTimes(2)
    const st = w.find('.ld-status')
    expect(st.text()).toContain('已停用 外包一号')
    expect(st.classes()).not.toContain('is-err')
  })
})

describe('Agents.vue 失败提示', () => {
  it('大白话：坐席列表超时说人话，不甩 CALL_TIMEOUT', async () => {
    listAgentsMock.mockResolvedValue({ ok: false, status: 0, error: 'CALL_TIMEOUT' })
    const w = mount(Agents)
    await flushPromises()
    expect(w.find('.ld-status').text()).toBe('加载失败：' + transportErrorText('CALL_TIMEOUT'))
  })

  it('大白话：停用失败说中文带码', async () => {
    listAgentsMock.mockResolvedValue({ ok: true, agents: [{ id: 'a1', name: '外包一号', disabled: false }] })
    disableAgentMock.mockResolvedValue({ ok: false, status: 400, error: 'NO_AGENT' })
    const w = mount(Agents)
    await flushPromises()
    const stopBtn = () => w.findAll('button').find((b) => b.text().includes('停用'))!
    await stopBtn().trigger('click')
    await stopBtn().trigger('click')
    await flushPromises()
    expect(w.find('.ld-status').text()).toBe('操作失败（NO_AGENT）')
  })
})
