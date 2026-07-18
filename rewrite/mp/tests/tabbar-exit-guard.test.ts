// tabBar 栈底页误触退出提醒（决策§30 落地·2026-07-18）：三页（首页/购物车/我）是页面栈底，安卓返回键＝
// 直接退出小程序。机制＝隐形 <page-container> 武装拦第一次返回 →「再点一次退出」，2s 内再按放行、2s 后重新武装。
// 前身 wx.enableAlertBeforeUnload 已判废（对栈底页永远不弹·双死因见 utils/exitGuard 头注），本测试连同
// 结构守卫 rw-mp-tabbar-exit-guard 一起焊死不许回潮。
// 本测试钉三条行为不变量：① arm 武装、beforeleave 解武装并提示、2s 后自动重新武装；② release 清定时器
// （切页后不再回调已隐藏页的 setData）；③ app.json 每个 tabBar 页都在源码接线三件套 + wxml 挂了 page-container。
// 真机覆盖边界（安卓返回键可靠·iOS 侧滑未证实·胶囊 X/home 键/鸿蒙永远拦不到）属根因#8·机器守不了，见 utils/exitGuard 头注。
import { describe, it, expect, vi, afterEach } from 'vitest'
// app.json 走 ?raw + JSON.parse（rewrite/mp tsconfig 未开 resolveJsonModule·同 home-cards 的 ?raw 范式）
import appJsonRaw from '../app.json?raw'
import homeRaw from '../pages/home/home.ts?raw'
import cartRaw from '../pages/cart/cart.ts?raw'
import meRaw from '../pages/me/me.ts?raw'
import homeWxml from '../pages/home/home.wxml?raw'
import cartWxml from '../pages/cart/cart.wxml?raw'
import meWxml from '../pages/me/me.wxml?raw'
import { armExitGuard, releaseExitGuard, onExitGuardBeforeLeave } from '../utils/exitGuard'

/** 剥注释（块 + 行·行注释避开 `://`）——防注释掉的接线假命中（同 E1/E10 病根）。 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/** 末次 setData 的 patch（不用 Array.prototype.at——本仓 tsconfig lib 目标低于 es2022）。 */
function lastPatch(patches: Record<string, unknown>[]): Record<string, unknown> | undefined {
  return patches[patches.length - 1]
}

/** 页面替身：记录每次 setData 的 patch（真页面由微信运行时提供）。 */
function fakePage() {
  const patches: Record<string, unknown>[] = []
  return {
    patches,
    setData(p: Record<string, unknown>) {
      patches.push(p)
    },
    _exitGuardTimer: null as ReturnType<typeof setTimeout> | null,
  }
}

afterEach(() => {
  vi.useRealTimers()
  delete (globalThis as any).wx
})

describe('tabBar 栈底页误触退出提醒（page-container「再点一次退出」·决策§30）', () => {
  it('大白话：进页面武装拦返回；第一次返回被拦下并提示「再点一次退出」，2 秒后自动恢复保护', () => {
    vi.useFakeTimers()
    const toast = vi.fn()
    ;(globalThis as any).wx = { showToast: toast }
    const page = fakePage()

    armExitGuard(page)
    expect(lastPatch(page.patches)).toEqual({ exitGuardArmed: true }) // 武装＝page-container 上场拦返回

    onExitGuardBeforeLeave(page) // 用户按了第一次返回
    expect(lastPatch(page.patches)).toEqual({ exitGuardArmed: false }) // 解武装＝2s 内再按即放行退出
    expect(toast).toHaveBeenCalledTimes(1)
    expect(String(toast.mock.calls[0][0].title)).toContain('再点一次')

    vi.advanceTimersByTime(2000)
    expect(lastPatch(page.patches)).toEqual({ exitGuardArmed: true }) // 没等到第二次返回＝误触，保护恢复
    expect(page._exitGuardTimer).toBeNull()
  })

  it('大白话：切走页面后不再有延时回调打到已隐藏的页面上（定时器被清干净）', () => {
    vi.useFakeTimers()
    ;(globalThis as any).wx = { showToast: vi.fn() }
    const page = fakePage()

    armExitGuard(page)
    onExitGuardBeforeLeave(page)
    const before = page.patches.length
    releaseExitGuard(page) // onHide/onUnload
    vi.advanceTimersByTime(5000)
    expect(page.patches.length).toBe(before) // 重武装回调没再落地
    expect(page._exitGuardTimer).toBeNull()

    // 幂等：重复 arm 会清掉在途重武装定时器，不留悬挂回调
    armExitGuard(page)
    onExitGuardBeforeLeave(page)
    armExitGuard(page)
    const n = page.patches.length
    vi.advanceTimersByTime(5000)
    expect(page.patches.length).toBe(n)
  })

  it('大白话：app.json 里每个 tabBar 页都真接上了退出提醒（新增/改 tab 页漏接即红）', () => {
    const appJson = JSON.parse(appJsonRaw) as { tabBar?: { list?: { pagePath: string }[] } }
    const paths = (appJson.tabBar?.list ?? []).map((t) => t.pagePath).sort()
    expect(paths).toEqual(['pages/cart/cart', 'pages/home/home', 'pages/me/me'])
    const byPath: Record<string, { ts: string; wxml: string }> = {
      'pages/home/home': { ts: homeRaw, wxml: homeWxml },
      'pages/cart/cart': { ts: cartRaw, wxml: cartWxml },
      'pages/me/me': { ts: meRaw, wxml: meWxml },
    }
    for (const p of paths) {
      // 剥注释后再剥 import 语句：否则删了调用点、光留 import 也算绿（同守卫 rw-mp-tabbar-exit-guard 的教训）
      const ts = stripComments(byPath[p].ts).replace(/^\s*import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '')
      for (const fn of ['armExitGuard(', 'releaseExitGuard(', 'onExitGuardBeforeLeave(']) {
        expect(ts, `${p} 未接线 ${fn}——tabBar 页退出提醒缺武装/清理/消费其一`).toContain(fn)
      }
      // 判废机制不许回潮（决策§30·双死因：page-return-only 语义 + navigationStyle:custom 藏掉原生返回按钮）
      expect(ts, `${p} 回潮了已判废的 enableAlertBeforeUnload`).not.toContain('enableAlertBeforeUnload')
      expect(byPath[p].wxml, `${p} 未挂 <page-container bindbeforeleave>`).toContain('bindbeforeleave')
      // 武装态 page-container 冻结页面级滚动 → 内容必须套纵向 scroll-view（不套即真机整页滚不动·根因#8）
      expect(byPath[p].wxml, `${p} 内容未套纵向 <scroll-view scroll-y>`).toMatch(/<scroll-view[^>]*scroll-y/)
    }
  })
})
