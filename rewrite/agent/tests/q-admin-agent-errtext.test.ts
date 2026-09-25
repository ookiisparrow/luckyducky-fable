// @vitest-environment happy-dom
// 坐席台新错误码人话：超时/认证库故障/怪回包/网络错不能裸显 CODE，登录页也不能说成「登录被拒」。
import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const { loginMock } = vi.hoisted(() => ({ loginMock: vi.fn() }))
vi.mock('../src/api/client', () => ({ login: loginMock }))

import { deskErrorText } from '../src/lib/desk'
import Login from '../src/Login.vue'

describe('deskErrorText 新码', () => {
  it('大白话：超时提醒可能已生效、先刷新；认证库故障提示稍后；怪回包/网络错有人话', () => {
    expect(deskErrorText('CALL_TIMEOUT')).toMatch(/刷新/)
    expect(deskErrorText('CALL_TIMEOUT')).toMatch(/如果刚才是提交/) // 后台刷列表也会显这句，「可能已生效」不能无条件说
    expect(deskErrorText('AUTH_UNAVAILABLE')).toMatch(/稍后/)
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
