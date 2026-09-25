// @vitest-environment happy-dom
// 后台登录页：认证库故障 / 超时 / 回包读不懂 / 服务端 5xx 不能说成「口令不对」——否则老板会去反复试口令、把自己锁在门外。
import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const { loginMock } = vi.hoisted(() => ({ loginMock: vi.fn() }))
vi.mock('../src/api', () => ({ client: { login: loginMock } }))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))

import Login from '../src/pages/Login.vue'

describe('后台登录页错误提示', () => {
  it.each([
    ['AUTH_UNAVAILABLE', 503],
    ['CALL_TIMEOUT', 0],
    ['BAD_JSON_RESPONSE', 200],
    ['SERVER_ERROR', 500],
  ])('大白话：%s 不说成「口令不对」', async (code, status) => {
    loginMock.mockReset().mockResolvedValue({ ok: false, status, error: code })
    const w = mount(Login)
    await w.find('input').setValue('pw')
    await w.find('button').trigger('click')
    await flushPromises()
    const msg = w.find('.error').text()
    expect(msg).not.toMatch(/口令不对/)
    expect(msg).toMatch(/稍后|刷新/)
  })
})
