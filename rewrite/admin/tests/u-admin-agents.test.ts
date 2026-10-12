// @vitest-environment happy-dom
// Agents.vue 停用/恢复成功提示不被随后的 reload 抹掉，且显示为成功色而非红色。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { transportErrorText } from '../src/lib/mapSystem'

const { listAgentsMock, disableAgentMock, getCsatReportMock } = vi.hoisted(() => ({ listAgentsMock: vi.fn(), disableAgentMock: vi.fn(), getCsatReportMock: vi.fn() }))
vi.mock('../src/api/system', () => ({
  listAgents: listAgentsMock,
  createAgent: vi.fn(),
  disableAgent: disableAgentMock,
  setAgentWecomUserId: vi.fn(),
}))
vi.mock('../src/api/cs', () => ({ getCsatReport: getCsatReportMock }))

import Agents from '../src/pages/Agents.vue'

beforeEach(() => {
  getCsatReportMock.mockReset().mockResolvedValue({ ok: true, total: 0, dist: {} })
})

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

describe('Agents.vue 满意度均分', () => {
  it('大白话：满意度报表只算了样本（approx）——均分旁要写近似，不装成全量精确', async () => {
    listAgentsMock.mockResolvedValue({ ok: true, agents: [{ id: 'a1', name: '外包一号', disabled: false }] })
    getCsatReportMock.mockResolvedValue({ ok: true, total: 1000, avg: 4.6, dist: {}, withNote: 0, approx: true })
    const w = mount(Agents)
    await flushPromises()
    const kpi = w.findAll('.kpi-note').map((n) => n.text())
    expect(kpi.some((t) => t.includes('触样本顶·近似'))).toBe(true)
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
    expect(w.find('.ld-status').text()).toBe('停用失败：操作没成功。请稍后重试，反复失败请找技术。（技术编号 NO_AGENT）')
  })
})

describe('Agents.vue 满意度报表读失败', () => {
  it('大白话：坐席列表读到了、满意度报表挂了——点名报表加载失败，均分写「加载失败」不写「—」冒充还没人评', async () => {
    listAgentsMock.mockResolvedValue({ ok: true, agents: [{ id: 'a1', name: '外包一号', disabled: false }] })
    getCsatReportMock.mockResolvedValue({ ok: false, status: 500, error: 'X1' })
    const w = mount(Agents)
    await flushPromises()
    expect(w.find('.ld-status').text()).toBe('满意度报表加载失败')
    expect(w.find('.ld-kpi-grid').text()).toContain('加载失败')
  })
})
