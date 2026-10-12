// @vitest-environment happy-dom
// 坐席台新错误码人话：超时/认证库故障/怪回包/网络错不能裸显 CODE，登录页也不能说成「登录被拒」。
import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const { loginMock, wecomMock } = vi.hoisted(() => ({ loginMock: vi.fn(), wecomMock: vi.fn() }))
vi.mock('../src/api/client', async (orig) => ({
  ...(await orig<typeof import('../src/api/client')>()),
  login: loginMock,
  loginByWecomCode: wecomMock,
  hasSession: () => false,
}))

import { deskErrorText } from '../src/lib/desk'
import Login from '../src/Login.vue'
import App from '../src/App.vue'

describe('deskErrorText 新码', () => {
  it('大白话：超时提醒可能已生效、先刷新；认证库故障提示稍后；怪回包/网络错有人话', () => {
    expect(deskErrorText('CALL_TIMEOUT')).toMatch(/刷新/)
    expect(deskErrorText('CALL_TIMEOUT')).toMatch(/如果刚才是提交/) // 后台刷列表也会显这句，「可能已生效」不能无条件说
    expect(deskErrorText('AUTH_UNAVAILABLE')).toMatch(/稍后/)
    expect(deskErrorText('BAD_JSON_RESPONSE')).toMatch(/回包读不懂/)
    expect(deskErrorText('NETWORK:fetch failed')).toMatch(/网络不通/)
    for (const c of ['CALL_TIMEOUT', 'AUTH_UNAVAILABLE', 'BAD_JSON_RESPONSE', 'NETWORK:fetch failed']) {
      expect(deskErrorText(c)).not.toMatch(/[A-Z]{4,}/)
    }
  })
})

describe('坐席登录页', () => {
  it.each([
    ['AUTH_UNAVAILABLE', 503],
    ['CALL_TIMEOUT', 0],
    ['BAD_JSON_RESPONSE', 200],
    ['SERVER_ERROR', 500],
  ])('大白话：%s 不说成「登录被拒」', async (code, status) => {
    loginMock.mockReset().mockResolvedValue({ ok: false, status, error: code })
    const w = mount(Login)
    await w.find('input').setValue('pw')
    await w.find('button').trigger('click')
    await flushPromises()
    const msg = w.find('.error').text()
    expect(msg).not.toMatch(/登录被拒/)
    expect(msg).toMatch(/稍后|刷新/)
  })
})

describe('坐席登录页断网', () => {
  it('大白话：断网只说网络不通，不把 NETWORK:Failed to fetch 原样甩出来', async () => {
    loginMock.mockReset().mockResolvedValue({ ok: false, status: 0, error: 'NETWORK:Failed to fetch' })
    const w = mount(Login)
    await w.find('input').setValue('pw')
    await w.find('button').trigger('click')
    await flushPromises()
    expect(w.find('.error').text()).toBe('网络不通，请检查网络后重试')
  })
})

describe('坐席台云端码补中文', () => {
  it.each(['ESCALATED_SUPER_ONLY', 'NO_AGENT', 'BAD_ARGS', 'SERVER_ERROR', 'TOO_MANY_ATTEMPTS'])(
    '大白话：%s 有人话，不落「操作没成功（…）」',
    (code) => {
      const t = deskErrorText(code)
      expect(t).not.toMatch(/操作没成功|[A-Z]{4,}/)
    }
  )

  it.each([
    ['BAD_KEY', /口令不对/],
    ['KEY_TOO_SHORT', /6 位/],
    ['ACCOUNT_DISABLED', /停用/],
    ['NO_SESSION_TOKEN', /不是口令的问题/],
  ])('大白话：口令登录回 %s 说人话，不挂码', async (code, meaning) => {
    loginMock.mockReset().mockResolvedValue({ ok: false, status: 401, error: code })
    const w = mount(Login)
    await w.find('input').setValue('abcdef')
    await w.find('button').trigger('click')
    await flushPromises()
    const msg = w.find('.error').text()
    expect(msg).toMatch(meaning)
    expect(msg).not.toContain(code)
  })

  it.each(['BAD_CODE', 'NO_BOUND_ACCOUNT', 'WECOM_ID_TAKEN', 'ACCOUNT_DISABLED', 'KF_TOKEN_UNAVAILABLE', 'WECOM_ID_LOOKUP_FAIL', 'TOO_MANY_ATTEMPTS'])(
    '大白话：企微免登回 %s——落到口令登录页时说清为什么没免登，不挂码',
    async (code) => {
      wecomMock.mockReset().mockResolvedValue({ ok: false, status: 403, error: code })
      history.replaceState(null, '', '/agent/?code=c1')
      try {
        const w = mount(App)
        await flushPromises()
        expect(wecomMock).toHaveBeenCalledWith('c1')
        const msg = w.find('.error').text()
        expect(msg).toMatch(/^[一-鿿]/)
        expect(msg).not.toContain(code)
      } finally {
        history.replaceState(null, '', '/')
      }
    }
  )
})
