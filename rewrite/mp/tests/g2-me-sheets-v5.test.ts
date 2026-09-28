// v5 设计稿第 3 轮对齐（G2）：「我」页继续学习卡/订单格、底部 TabBar 重点/弹跳、登录与隐私半屏的提示与收起动画。
// Component/Page 桩同 leave-sheet.test.ts；wxml 走 ?raw 静态断言（wxml 无运行时）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import meWxml from '../pages/me/me.wxml?raw'
import { mapMe, contMainLine } from '../lib/mapMe'

const { loginMock } = vi.hoisted(() => ({ loginMock: vi.fn() }))
vi.mock('../api/user', () => ({ login: loginMock }))
vi.mock('../lib/haptics', () => ({ tapHaptic: vi.fn(), keyHaptic: vi.fn() }))
vi.mock('../lib/keyFx', () => ({ keyDown: vi.fn(), keyUp: vi.fn(), keyPress: vi.fn() }))

let opts: Record<string, any> = {}
;(globalThis as any).Component = (o: unknown) => {
  opts = o as Record<string, any>
}

async function mountComp(path: string): Promise<Record<string, any>> {
  vi.resetModules()
  await import(path)
  const c: Record<string, any> = { data: { ...opts.data }, ...opts.methods }
  c.setData = function (patch: Record<string, unknown>) {
    Object.assign(this.data, patch)
  }
  opts.lifetimes?.attached?.call(c)
  return c
}

let wxMock: Record<string, any>
let host: Record<string, any>
const toasts = () => wxMock.showToast.mock.calls.map((c: any[]) => c[0].title)

beforeEach(() => {
  vi.useFakeTimers()
  loginMock.mockReset()
  wxMock = {
    showToast: vi.fn(),
    showLoading: vi.fn(),
    hideLoading: vi.fn(),
    switchTab: vi.fn(),
    navigateTo: vi.fn(),
    getStorageSync: () => undefined,
    setStorageSync: vi.fn(),
    removeStorageSync: vi.fn(),
  }
  ;(globalThis as any).wx = wxMock
  host = {}
  ;(globalThis as any).getCurrentPages = () => [host]
})
afterEach(() => vi.useRealTimers())

describe('「我」页 D1', () => {
  it('大白话：订单第四格叫「全部订单」', () => {
    expect(mapMe(null).entries.orders.label).toBe('全部订单')
  })

  it('大白话：没登录时继续学习卡（有卡/失败/空/骨架）一律不画', () => {
    const block = meWxml.match(/<block wx:if="\{\{loggedIn\}\}">([\s\S]*?)<\/block>/)
    expect(block).not.toBeNull()
    const total = (meWxml.match(/class="me-card"/g) || []).length
    const inside = (block![1].match(/class="me-card"/g) || []).length
    expect(total).toBeGreaterThan(0)
    expect(inside).toBe(total)
  })

  it('大白话：待支付/待发货/待收货三格有单都亮紫灯', () => {
    for (const k of ['pending', 'paid', 'shipped']) {
      expect(meWxml).toContain(`<px-i wx:if="{{counts.${k} && counts.${k} !== '0'}}" name="led"`)
    }
  })

  it('大白话：继续学习卡下行带节号「1.2 鸭嘴收针」；整课学完写「全部学完 · 可以重看」；课程还没拉到只写课时名', () => {
    const course = {
      id: 'c1',
      chapters: [
        { lessons: [{ id: 'l1', name: '起针' }] },
        { lessons: [{ id: 'l2', name: '短针' }, { id: 'l3', name: '鸭嘴收针' }] },
      ],
    }
    expect(contMainLine({ lessonId: 'l3', lessonName: '鸭嘴收针' }, course, false)).toBe('2.2 鸭嘴收针')
    expect(contMainLine({ lessonId: 'l1', lessonName: '起针' }, course, false)).toBe('1.1 起针')
    expect(contMainLine({ lessonId: 'l1', lessonName: '起针' }, course, true)).toBe('全部学完 · 可以重看')
    expect(contMainLine({ lessonId: 'lx', lessonName: '旧课时' }, course, false)).toBe('旧课时')
    expect(contMainLine({ lessonId: 'l1', lessonName: '起针' }, null, false)).toBe('起针')
  })
})

describe('底部 TabBar', () => {
  it('大白话：点当前已选中的 tab——不跳转，交给当前页 onTabReselect（首页回顶）', async () => {
    const c = await mountComp('../custom-tab-bar/index')
    host.onTabReselect = vi.fn()
    c.onTap({ currentTarget: { dataset: { id: 'home', path: '/pages/home/home' } } })
    expect(wxMock.switchTab).not.toHaveBeenCalled()
    expect(host.onTabReselect).toHaveBeenCalledTimes(1)
    delete host.onTabReselect
    expect(() => c.onTap({ currentTarget: { dataset: { id: 'home', path: '/pages/home/home' } } })).not.toThrow()
    c.onTap({ currentTarget: { dataset: { id: 'cart', path: '/pages/cart/cart' } } })
    expect(wxMock.switchTab).toHaveBeenCalledWith({ url: '/pages/cart/cart' })
  })

  it('大白话：加购后 bump()——购物车数字刷新并弹一下（320ms 后复位）', async () => {
    const c = await mountComp('../custom-tab-bar/index')
    c.bump()
    expect(c.data.bump).toBe(true)
    vi.advanceTimersByTime(320)
    expect(c.data.bump).toBe(false)
  })
})

describe('登录半屏', () => {
  it('大白话：没勾协议点登录——协议行抖一下（360ms）并提示「请先勾选同意协议」，不发登录', async () => {
    const c = await mountComp('../components/login-sheet/login-sheet')
    await c.onLogin()
    expect(c.data.shake).toBe(true)
    expect(toasts()).toEqual(['请先勾选同意协议'])
    expect(loginMock).not.toHaveBeenCalled()
    vi.advanceTimersByTime(360)
    expect(c.data.shake).toBe(false)
  })

  it('大白话：登录中挂「登录中」加载框；成功提示「登录成功」带 ✓；失败收加载框再提示', async () => {
    const c = await mountComp('../components/login-sheet/login-sheet')
    c.triggerEvent = vi.fn()
    c.onToggleAgree()
    loginMock.mockResolvedValueOnce({ ok: false })
    await c.onLogin()
    expect(wxMock.showLoading).toHaveBeenCalledWith({ title: '登录中', mask: true })
    expect(wxMock.hideLoading).toHaveBeenCalledTimes(1)
    expect(toasts()).toEqual(['网络不太好，请重试'])

    loginMock.mockResolvedValueOnce({ ok: true })
    await c.onLogin()
    expect(wxMock.hideLoading).toHaveBeenCalledTimes(2)
    expect(wxMock.showToast).toHaveBeenLastCalledWith({ title: '登录成功', icon: 'success' })
    expect(c.triggerEvent).toHaveBeenCalledWith('login')
  })

  it('大白话：关半屏——先下滑淡出（加 out），240ms 后才撤掉', async () => {
    const c = await mountComp('../components/login-sheet/login-sheet')
    const gate = (await import('../lib/loginGate')).loginGate // resetModules 后与组件同一个单例
    gate.open()
    expect(c.data.visible).toBe(true)
    gate.close()
    expect(c.data.out).toBe(true)
    expect(c.data.visible).toBe(true)
    vi.advanceTimersByTime(240)
    expect(c.data.visible).toBe(false)
    expect(c.data.out).toBe(false)
  })
})

describe('隐私授权半屏', () => {
  it('大白话：点「拒绝」——半屏收起并提示「未同意，暂时用不了这个功能」', async () => {
    const c = await mountComp('../components/privacy-sheet/privacy-sheet')
    const { privacyGate } = await import('../lib/privacyGate')
    privacyGate.open(() => {})
    expect(c.data.visible).toBe(true)
    c.onDisagree()
    expect(c.data.out).toBe(true)
    expect(toasts()).toEqual(['未同意，暂时用不了这个功能'])
    vi.advanceTimersByTime(240)
    expect(c.data.visible).toBe(false)
  })
})
