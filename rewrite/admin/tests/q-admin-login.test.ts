// @vitest-environment happy-dom
// 后台登录页：认证库故障 / 超时 / 回包读不懂 / 服务端 5xx 不能说成「口令不对」——否则老板会去反复试口令、把自己锁在门外；
// 登成功进首页并清掉输入框；真口令错才说口令不对；在途不重复提交。
import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const { loginMock, pushMock } = vi.hoisted(() => ({ loginMock: vi.fn(), pushMock: vi.fn() }))
vi.mock('../src/api', () => ({ client: { login: loginMock } }))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: pushMock }) }))

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

describe('后台登录页提交', () => {
  const submit = async (pw: string) => {
    const w = mount(Login)
    await w.find('input').setValue(pw)
    await w.find('input').trigger('keyup.enter')
    await flushPromises()
    return w
  }

  it('大白话：登录成功进首页、清掉口令框，不留错误', async () => {
    loginMock.mockReset().mockResolvedValue({ ok: true, status: 200, sessionToken: 't' })
    pushMock.mockReset()
    const w = await submit('pw')
    expect(loginMock).toHaveBeenCalledWith('pw')
    expect(pushMock).toHaveBeenCalledWith('/')
    expect((w.find('input').element as HTMLInputElement).value).toBe('')
    expect(w.find('.error').exists()).toBe(false)
  })

  it('大白话：口令真错（4xx）才说口令不对，并带上原因码', async () => {
    loginMock.mockReset().mockResolvedValue({ ok: false, status: 401, error: 'BAD_KEY' })
    pushMock.mockReset()
    const w = await submit('wrong')
    expect(w.find('.error').text()).toBe('口令不对或登录被拒（BAD_KEY）')
    expect(pushMock).not.toHaveBeenCalled()
  })

  it('大白话：试错太多次，告诉要等几秒', async () => {
    loginMock.mockReset().mockResolvedValue({ ok: false, status: 429, error: 'TOO_MANY_ATTEMPTS', retryAfter: 30 })
    const w = await submit('wrong')
    expect(w.find('.error').text()).toBe('试错太多次，先歇 30 秒')
  })

  it('大白话：没填口令不发请求；登录在途再按回车不重复提交', async () => {
    loginMock.mockReset().mockReturnValue(new Promise(() => {}))
    const w = mount(Login)
    await w.find('input').trigger('keyup.enter')
    expect(loginMock).not.toHaveBeenCalled()
    await w.find('input').setValue('pw')
    await w.find('input').trigger('keyup.enter')
    await w.find('input').trigger('keyup.enter')
    expect(loginMock).toHaveBeenCalledTimes(1)
    expect(w.find('button').text()).toBe('登录中…')
  })
})
