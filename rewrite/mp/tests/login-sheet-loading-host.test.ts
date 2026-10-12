// 登录半屏「登录中」加载框挂在发起登录的那页，回包后收的也必须是那一页（#482）：
// 在途时按安卓返回键关掉半屏、再点底栏切 tab，栈顶已经换了——按「此刻栈顶」去收会收错页，
// 原页的 px-fx 挡板（全屏、挡点按）就永远留着，切回来整页点不动。
import { it, expect, vi, beforeEach } from 'vitest'

const { loginMock } = vi.hoisted(() => ({ loginMock: vi.fn() }))
vi.mock('../api/user', () => ({ login: loginMock }))
vi.mock('../lib/loginGate', () => ({ loginGate: { visible: () => true, subscribe: () => () => undefined, close: vi.fn(), markAgreed: vi.fn() } }))
vi.mock('../lib/haptics', () => ({ tapHaptic: vi.fn() }))
vi.mock('../lib/keyFx', () => ({ keyDown: vi.fn(), keyUp: vi.fn() }))

let opts: Record<string, any> = {}
;(globalThis as any).Component = (o: unknown) => {
  opts = o as Record<string, any>
}

const fxPage = () => {
  const fx = { loading: vi.fn(), loaded: vi.fn(), toast: vi.fn(), confirm: vi.fn() }
  return { fx, page: { selectComponent: (sel: string) => (sel === '#fx' ? fx : null) } }
}

let stack: unknown[] = []
beforeEach(() => {
  loginMock.mockReset()
  ;(globalThis as any).getCurrentPages = () => stack
  ;(globalThis as any).wx = { showToast: vi.fn(), showLoading: vi.fn(), hideLoading: vi.fn() }
})

it('大白话：登录在途时切到别的 tab——回包后收的仍是首页那层「登录中」，首页不会被挡板盖死；「登录成功」落在眼下这页', async () => {
  vi.resetModules()
  await import('../components/login-sheet/login-sheet')
  const c: Record<string, any> = { data: { ...opts.data, agreed: true }, ...opts.methods, triggerEvent: vi.fn() }
  c.setData = function (patch: Record<string, unknown>) {
    Object.assign(this.data, patch)
  }
  const home = fxPage()
  const cart = fxPage()
  stack = [home.page]
  let resolve!: (v: unknown) => void
  loginMock.mockReturnValue(new Promise((r) => (resolve = r)))
  const p = c.onLogin()
  expect(home.fx.loading).toHaveBeenCalledWith('登录中')
  stack = [cart.page] // 安卓返回键关掉半屏 → 点底栏切到购物车
  resolve({ ok: true })
  await p
  expect(home.fx.loaded).toHaveBeenCalledTimes(1)
  expect(cart.fx.loaded).not.toHaveBeenCalled()
  expect(cart.fx.toast).toHaveBeenCalledWith('登录成功', true, undefined, undefined)
})
