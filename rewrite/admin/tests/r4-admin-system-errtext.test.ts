// @vitest-environment happy-dom
// 系统/客服页的云端码要说中文，不落「X失败（CODE）」：知识库、坐席账号、登录、质检评分。
// 知识库另有一处语义坑：saveKb 的 DOC_READ_FAIL 发生在新内容已写入之后（扫旧条目失败），不能说成「保存失败」。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const cs = vi.hoisted(() => ({
  listKb: vi.fn(),
  saveKb: vi.fn(),
  getCsatReport: vi.fn(),
  conversationsReport: vi.fn(),
  searchConversations: vi.fn(),
  sampleQc: vi.fn(),
  saveQcMark: vi.fn(),
  listQcSampled: vi.fn(),
  getTrialRefreshGate: vi.fn(),
  refreshTrialSession: vi.fn(),
  searchCustomer: vi.fn(),
  getCustomer360: vi.fn(),
  getUser: vi.fn(),
  listCheckpoints: vi.fn(),
  saveCheckpoints: vi.fn(),
}))
const sys = vi.hoisted(() => ({ listAgents: vi.fn(), createAgent: vi.fn(), disableAgent: vi.fn(), setAgentWecomUserId: vi.fn() }))
const client = vi.hoisted(() => ({ login: vi.fn() }))
vi.mock('../src/api/cs', () => cs)
vi.mock('../src/api/system', () => sys)
vi.mock('../src/api', () => ({ client }))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }), useRoute: () => ({ query: {} }) }))

import Kb from '../src/pages/Kb.vue'
import Agents from '../src/pages/Agents.vue'
import Login from '../src/pages/Login.vue'
import Conversations from '../src/pages/Conversations.vue'
import Customer360 from '../src/pages/Customer360.vue'
import Checkpoints from '../src/pages/Checkpoints.vue'
import { csErrorText } from '../src/lib/mapCs'

beforeEach(() => {
  for (const f of [...Object.values(cs), ...Object.values(sys), client.login]) f.mockReset()
})
const btn = (w: any, text: string) => w.findAll('button').find((b: any) => b.text() === text)

describe('Kb.vue', () => {
  it('大白话：保存时云端扫旧条目读失败——新内容其实已存上，不说「保存失败」，提示重存一次收敛', async () => {
    cs.listKb.mockResolvedValue({ ok: true, list: [{ key: 'logistics:eta', question: '多久到？', answer: '答', category: 'logistics', enabled: true, order: 0 }] })
    cs.saveKb.mockResolvedValue({ ok: false, status: 200, error: 'DOC_READ_FAIL' })
    const w = mount(Kb)
    await flushPromises()
    await btn(w, '保存整册').trigger('click')
    await flushPromises()
    const t = w.find('.ld-status').text()
    expect(t).toContain('已保存新内容')
    expect(t).toContain('重存一次')
    expect(t).not.toContain('DOC_READ_FAIL')
  })
})

describe('Agents.vue', () => {
  beforeEach(() => {
    cs.getCsatReport.mockResolvedValue({ ok: true, total: 0, dist: {} })
    sys.listAgents.mockResolvedValue({ ok: true, agents: [{ id: 'a1', name: '外包一号', disabled: false }] })
  })

  it('大白话：建号时查撞号读库失败，说中文「这次没建成」，不甩 KEY_LOOKUP_FAIL', async () => {
    sys.createAgent.mockResolvedValue({ ok: false, status: 503, error: 'KEY_LOOKUP_FAIL' })
    const w = mount(Agents)
    await flushPromises()
    await w.find('input[placeholder="名字（如 外包一号）"]').setValue('外包二号')
    await w.find('input[type=password]').setValue('abcdef')
    await btn(w, '建号').trigger('click')
    await flushPromises()
    const t = w.find('.ld-status').text()
    expect(t).toMatch(/^建号失败：[一-鿿]/)
    expect(t).toContain('没建成')
    expect(t).not.toContain('KEY_LOOKUP_FAIL')
  })

  it('大白话：停用时账号已不在，说「找不到这个坐席账号」', async () => {
    sys.disableAgent.mockResolvedValue({ ok: false, status: 404, error: 'AGENT_NOT_FOUND' })
    const w = mount(Agents)
    await flushPromises()
    await btn(w, '停用').trigger('click')
    await btn(w, '确认停用？即时生效').trigger('click')
    await flushPromises()
    const t = w.find('.ld-status').text()
    expect(t).toContain('找不到这个坐席账号')
    expect(t).not.toContain('AGENT_NOT_FOUND')
  })

  it('大白话：停用时云端说账号编号不对（BAD_ID），说中文，不甩码', async () => {
    sys.disableAgent.mockResolvedValue({ ok: false, status: 400, error: 'BAD_ID' })
    const w = mount(Agents)
    await flushPromises()
    await btn(w, '停用').trigger('click')
    await btn(w, '确认停用？即时生效').trigger('click')
    await flushPromises()
    const t = w.find('.ld-status').text()
    expect(t).toMatch(/^停用失败：[一-鿿]/)
    expect(t).not.toContain('BAD_ID')
  })

  it('大白话：改绑时查 userid 占用读库失败，说中文，不甩 WECOM_ID_LOOKUP_FAIL', async () => {
    sys.setAgentWecomUserId.mockResolvedValue({ ok: false, status: 503, error: 'WECOM_ID_LOOKUP_FAIL' })
    const w = mount(Agents)
    await flushPromises()
    await btn(w, '改绑').trigger('click')
    await w.find('input.inline-in').setValue('wx-1')
    await btn(w, '存').trigger('click')
    await flushPromises()
    const t = w.find('.ld-status').text()
    expect(t).toMatch(/^绑定失败：[一-鿿]/)
    expect(t).not.toContain('WECOM_ID_LOOKUP_FAIL')
  })
})

describe('Login.vue', () => {
  const submit = async () => {
    const w = mount(Login)
    await w.find('input').setValue('abcdef')
    await w.find('button').trigger('click')
    await flushPromises()
    return w.find('.error').text()
  }

  it('大白话：账号被停用，直说已停用、找超管，不说「口令不对」诱人换口令重试', async () => {
    client.login.mockResolvedValue({ ok: false, status: 401, error: 'ACCOUNT_DISABLED' })
    const t = await submit()
    expect(t).toContain('停用')
    expect(t).not.toContain('口令不对')
  })

  it('大白话：口令错（BAD_KEY）直说口令不对，口令太短（KEY_TOO_SHORT）说至少 6 位，都不挂码', async () => {
    client.login.mockResolvedValue({ ok: false, status: 401, error: 'BAD_KEY' })
    let t = await submit()
    expect(t).toContain('口令不对')
    expect(t).not.toContain('BAD_KEY')
    client.login.mockResolvedValue({ ok: false, status: 401, error: 'KEY_TOO_SHORT' })
    t = await submit()
    expect(t).toContain('6 位')
    expect(t).not.toContain('KEY_TOO_SHORT')
  })

  it('大白话：口令对了但云端没签出令牌，不说「口令不对」', async () => {
    client.login.mockResolvedValue({ ok: false, status: 200, error: 'NO_SESSION_TOKEN' })
    const t = await submit()
    expect(t).not.toContain('口令不对')
    expect(t).toContain('不是口令的问题')
  })
})

describe('Conversations.vue 质检评分', () => {
  it('大白话：评分时这条会话已不在，说「找不到这条会话」，不甩 NOT_FOUND', async () => {
    cs.conversationsReport.mockResolvedValue({ ok: false, error: 'CALL_TIMEOUT' })
    cs.getTrialRefreshGate.mockResolvedValue({ ok: true, enabled: false })
    cs.listQcSampled.mockResolvedValue({ ok: true, list: [{ sessionKey: 'wxkf:k:wm-123456789', externalUserId: 'wm-123456789', qcSampledAt: Date.now() }] })
    cs.saveQcMark.mockResolvedValue({ ok: false, status: 404, error: 'NOT_FOUND' })
    const w = mount(Conversations)
    await flushPromises()
    await w.find('select.qc-score-sel').setValue('4')
    await btn(w, '保存').trigger('click')
    await flushPromises()
    const t = w.find('.qc-row-err').text()
    expect(t).toContain('找不到这条会话')
    expect(t).not.toContain('NOT_FOUND')
  })
})

describe('客服页云端码（mapCs csErrorText）', () => {
  it.each(['USER_LOOKUP_FAIL', 'BAD_ARGS', 'BAD_ARGS:SCORE_RANGE', 'BAD_ARGS:COLON_IN_ID', 'BAD_ARGS:EMPTY_NODE_ID', 'REASON_REQUIRED'])('大白话：%s 有中文，不落「X失败（CODE）」', (code) => {
    const t = csErrorText(code)
    expect(t).toMatch(/^[一-鿿]/)
    expect(t).not.toMatch(/[A-Z]{4,}/)
  })

  it('大白话：搜客户时读库失败，说「没查全、稍后重试」，不甩 USER_LOOKUP_FAIL', async () => {
    cs.searchCustomer.mockResolvedValue({ ok: false, status: 200, error: 'USER_LOOKUP_FAIL' })
    const w = mount(Customer360)
    await w.find('input').setValue('138')
    await w.find('input').trigger('keyup.enter')
    await flushPromises()
    const t = w.find('.ld-status').text()
    expect(t).toMatch(/^搜索失败：[一-鿿]/)
    expect(t).not.toContain('USER_LOOKUP_FAIL')
  })

  it('大白话：保存节点时有节点没填编号，说中文、说清整批没存，不甩 BAD_ARGS', async () => {
    cs.listCheckpoints.mockResolvedValue({ ok: true, list: [{ nodeId: 'n1', title: '起针', remedy: '', order: 0 }], rev: 1 })
    cs.saveCheckpoints.mockResolvedValue({ ok: false, status: 400, error: 'BAD_ARGS:EMPTY_NODE_ID' })
    const w = mount(Checkpoints)
    await flushPromises()
    await btn(w, '保存整课').trigger('click')
    await flushPromises()
    const t = w.findAll('.ld-status').map((p) => p.text()).join(' | ')
    expect(t).toContain('没存')
    expect(t).not.toContain('BAD_ARGS')
  })
})
