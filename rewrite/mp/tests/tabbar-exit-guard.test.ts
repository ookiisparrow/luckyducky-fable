// tabBar 页误触退出提醒（2026-07-13 用户反馈·反转旧线「平台不可能」误判）：tabBar 根页（页面栈=1）「返回=退出
// 小程序」，误触安卓返回键/侧滑易误退。wx.enableAlertBeforeUnload 是官方唯一「返回时弹原生确认框」机制。
// 本守卫钉两条不变量：① armExitAlert 真调该 API 带非空 message、老版本无此 API 时静默降级不抛；
// ② app.json 声明的每个 tabBar 页都在源码里挂了 armExitAlert（新增/改 tab 页漏挂即红·同 home-cards 源扫范式）。
// 真机覆盖边界（安卓返回键最可靠·iOS 侧滑随版本·胶囊 X/home 键无钩子永远拦不到）属根因#8·机器守不了，见 utils/exitGuard.ts 头注。
import { describe, it, expect, vi, afterEach } from 'vitest'
// app.json 走 ?raw + JSON.parse（rewrite/mp tsconfig 未开 resolveJsonModule·同 home-cards 的 ?raw 范式）
import appJsonRaw from '../app.json?raw'
import homeRaw from '../pages/home/home.ts?raw'
import cartRaw from '../pages/cart/cart.ts?raw'
import meRaw from '../pages/me/me.ts?raw'

/** 剥注释（块 + 行·行注释避开 `://`）——防注释掉的 armExitAlert 调用假命中（同 E1/E10 病根）。 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

afterEach(() => {
  delete (globalThis as any).wx
})

describe('tabBar 页误触退出提醒（wx.enableAlertBeforeUnload·2026-07-13 用户反馈）', () => {
  it('大白话：armExitAlert 调 wx.enableAlertBeforeUnload 带非空 message；老版本无此 API 时静默降级不抛', async () => {
    const enableMock = vi.fn()
    ;(globalThis as any).wx = { enableAlertBeforeUnload: enableMock }
    const { armExitAlert } = await import('../utils/exitGuard')
    armExitAlert()
    expect(enableMock).toHaveBeenCalledTimes(1)
    expect(String(enableMock.mock.calls[0][0].message).length).toBeGreaterThan(0)
    // 基础库 <2.12.0 无该 API：typeof 兜底·静默降级不抛（老机型不报错、不提醒·可接受）
    ;(globalThis as any).wx = {}
    expect(() => armExitAlert()).not.toThrow()
  })

  it('大白话：app.json 每个 tabBar 页都在源码挂 armExitAlert（清单锁死·新增/改 tab 页须同步本测试+挂钩）', () => {
    const appJson = JSON.parse(appJsonRaw) as { tabBar?: { list?: { pagePath: string }[] } }
    const paths = (appJson.tabBar?.list ?? []).map((t) => t.pagePath).sort()
    expect(paths).toEqual(['pages/cart/cart', 'pages/home/home', 'pages/me/me'])
    const byPath: Record<string, string> = {
      'pages/home/home': homeRaw,
      'pages/cart/cart': cartRaw,
      'pages/me/me': meRaw,
    }
    for (const p of paths) {
      expect(stripComments(byPath[p]), `${p} 未调用 armExitAlert——tabBar 页缺误触退出提醒`).toContain('armExitAlert(')
    }
  })
})
