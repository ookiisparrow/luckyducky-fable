// @vitest-environment happy-dom
// #386 设置页按新契约：getSettings 不回显 webhook，只给 alertWebhookSet/alertWebhookTail。
// 页面据此显示「已配置·尾号」、推送徽标与事件开关；输入框留空＝保持原值；清除走显式按钮（发 null）。
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const { getSettingsMock, saveSettingsMock } = vi.hoisted(() => ({ getSettingsMock: vi.fn(), saveSettingsMock: vi.fn() }))
vi.mock('../src/api/system', () => ({ getSettings: getSettingsMock, saveSettings: saveSettingsMock }))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))

import Settings from '../src/pages/Settings.vue'

const loadWith = (settings: Record<string, unknown>) => getSettingsMock.mockResolvedValue({ ok: true, settings })
const btn = (w: any, text: string) => w.findAll('button').find((b: any) => b.text().includes(text))

beforeEach(() => {
  getSettingsMock.mockReset()
  saveSettingsMock.mockReset().mockResolvedValue({ ok: true })
})

describe('Settings.vue webhook 不回显', () => {
  it('大白话：已配置时显示尾号、徽标是已开启、事件开关能点', async () => {
    loadWith({ alertWebhookSet: true, alertWebhookTail: 'wxyz' })
    const w = mount(Settings)
    await flushPromises()
    expect(w.text()).toContain('已配置 · 尾号 wxyz')
    expect(w.text()).toContain('已开启推送')
    expect(w.find('.switch').attributes('disabled')).toBeUndefined()
  })

  it('大白话：输入框留空点保存＝保持原值（不带 webhook 字段），徽标不掉', async () => {
    loadWith({ alertWebhookSet: true, alertWebhookTail: 'wxyz', urlPrefix: 'https://p/' })
    const w = mount(Settings)
    await flushPromises()
    await btn(w, '保存').trigger('click')
    await flushPromises()
    expect(saveSettingsMock.mock.calls[0][0]).toMatchObject({ urlPrefix: 'https://p/' })
    expect(saveSettingsMock.mock.calls[0][0]).not.toHaveProperty('alertWebhook')
    expect(w.text()).toContain('已开启推送')
  })

  it('大白话：点两下「清除」才发 null；清完徽标变仅记日志、开关置灰', async () => {
    loadWith({ alertWebhookSet: true, alertWebhookTail: 'wxyz' })
    const w = mount(Settings)
    await flushPromises()
    await btn(w, '清除').trigger('click')
    expect(saveSettingsMock).not.toHaveBeenCalled()
    await btn(w, '确认清除').trigger('click')
    await flushPromises()
    expect(saveSettingsMock).toHaveBeenCalledWith({ alertWebhook: null })
    expect(w.text()).toContain('未推送·仅记日志')
    expect(w.text()).not.toContain('尾号 wxyz')
    expect(w.find('.switch').attributes('disabled')).toBeDefined()
  })

  it('大白话：没配置时没有清除按钮，徽标是仅记日志', async () => {
    loadWith({})
    const w = mount(Settings)
    await flushPromises()
    expect(btn(w, '清除')).toBeUndefined()
    expect(w.text()).toContain('未推送·仅记日志')
  })

  it('大白话：保存/清除超时不甩英文码、不说成失败（可能已生效）；载入断网也说人话', async () => {
    loadWith({ alertWebhookSet: true, alertWebhookTail: 'wxyz' })
    saveSettingsMock.mockResolvedValue({ ok: false, status: 0, error: 'CALL_TIMEOUT' })
    const w = mount(Settings)
    await flushPromises()
    await btn(w, '保存').trigger('click')
    await flushPromises()
    expect(w.text()).toContain('如果刚才是提交操作')
    expect(w.text()).not.toMatch(/CALL_TIMEOUT|保存失败/)
    await btn(w, '清除').trigger('click')
    await btn(w, '确认清除').trigger('click')
    await flushPromises()
    expect(w.text()).toContain('如果刚才是提交操作')
    expect(w.text()).not.toMatch(/CALL_TIMEOUT|清除失败/)

    getSettingsMock.mockResolvedValue({ ok: false, status: 0, error: 'NETWORK:Failed to fetch' })
    const w2 = mount(Settings)
    await flushPromises()
    expect(w2.text()).toContain('加载失败：网络不通')
  })
})

describe('Settings.vue webhook 输入框不明文常驻', () => {
  it('大白话：新地址默认按密码框显示、不让浏览器自动填；点眼睛才明文，再点又藏回去', async () => {
    loadWith({ alertWebhookSet: false })
    const w = mount(Settings)
    await flushPromises()
    const input = () => w.find('.secret-row input')
    expect(input().attributes('type')).toBe('password')
    expect(input().attributes('autocomplete')).toBe('new-password')
    await w.find('.eye-btn').trigger('click')
    expect(input().attributes('type')).toBe('text')
    await w.find('.eye-btn').trigger('click')
    expect(input().attributes('type')).toBe('password')
  })
})

describe('Settings.vue 载入与保存参数', () => {
  it('大白话：载入失败时点保存被拦下、不发请求（防空表单盖掉已存的告警地址和网址前缀）', async () => {
    getSettingsMock.mockResolvedValue({ ok: false, status: 500, error: 'X' })
    const w = mount(Settings)
    await flushPromises()
    await btn(w, '保存').trigger('click')
    await flushPromises()
    expect(saveSettingsMock).not.toHaveBeenCalled()
    expect(w.text()).toContain('设置未成功载入，暂不能保存')
  })

  it('大白话：填了不像企微机器人的地址，本地就拦、不发请求', async () => {
    loadWith({})
    const w = mount(Settings)
    await flushPromises()
    await w.find('.secret-row input').setValue('https://evil.example/hook')
    await btn(w, '保存').trigger('click')
    await flushPromises()
    expect(saveSettingsMock).not.toHaveBeenCalled()
    expect(w.text()).toContain('webhook 形态不对')
  })

  it('大白话：填新地址、改前缀、关一个事件后保存——参数带齐；成功后显示新尾号、输入框清空', async () => {
    loadWith({ urlPrefix: 'https://old/', alertEvents: { MISMATCH: false } })
    const w = mount(Settings)
    await flushPromises()
    const hook = 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=abcd-9876'
    await w.find('.secret-row input').setValue(hook)
    await w.find('input[placeholder="https://…"]').setValue(' https://new/ ')
    await w.findAll('.switch')[0].trigger('click')
    await btn(w, '保存').trigger('click')
    await flushPromises()
    expect(saveSettingsMock).toHaveBeenCalledWith({ alertWebhook: hook, urlPrefix: 'https://new/', alertEvents: { MISMATCH: false, UNKNOWN_ORDER: false } })
    expect(w.text()).toContain('已保存')
    expect(w.text()).toContain('已配置 · 尾号 9876')
    expect((w.find('.secret-row input').element as HTMLInputElement).value).toBe('')
  })
})

describe('Settings.vue 没有中文映射的码挂括号', () => {
  it('大白话：载入、保存、清除被拒都写「X失败（码）」，不写成「X失败：码」', async () => {
    getSettingsMock.mockResolvedValue({ ok: false, status: 200, error: 'DOC_READ_FAIL' })
    const w = mount(Settings)
    await flushPromises()
    expect(w.text()).toContain('加载失败（DOC_READ_FAIL）')

    loadWith({ alertWebhookSet: true, alertWebhookTail: 'wxyz' })
    saveSettingsMock.mockResolvedValue({ ok: false, status: 200, error: 'DOC_READ_FAIL' })
    const w2 = mount(Settings)
    await flushPromises()
    await btn(w2, '保存').trigger('click')
    await flushPromises()
    expect(w2.text()).toContain('保存失败（DOC_READ_FAIL）')
    await btn(w2, '清除').trigger('click')
    await btn(w2, '确认清除').trigger('click')
    await flushPromises()
    expect(w2.text()).toContain('清除失败（DOC_READ_FAIL）')
  })
})
