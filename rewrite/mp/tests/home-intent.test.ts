// 「继续观看」兜底落首页回顶（mp-7fixes 批3）：我页无课兜底 / welcome「先逛逛」落 tab 页时，
// tab 页实例常驻保留的上次滚动位置可能恰好停在首页 FAQ 板块，落地视口顶部观感=「弹出大家都在问」。
// homeIntent 是这两处兜底跳转与首页 onShow 之间的一次性标记：request 置位、home onShow consume 读即清。
//
// 批3b（评审扩线）：意图性回首页出口过了 Rule of Three（me/welcome/paysuccess/checkout×2 共五处）——
// 收敛成统一出口 goHomeTab()（置位+switchTab 配对收口在 lib/homeIntent.ts），本文件同步扩接线断言：
// 五处调用点改为断言含 goHomeTab()，另加 goHomeTab 自身方法体断言（防拆开成两半的重构悄悄漏调）。
//
// 接线断言（源码扫描式，同 home-cards.test.ts 范式）：读源文件文本 → 剥注释（防注释文本假命中，E1 教训）→
// 按方法声明做花括号配平切片 → 断言目标方法体内确实调了 requestHomeTop/consumeHomeTop/goHomeTab，防将来重构
// （比如把 else 分支改写/挪走置位调用）静默断线。
import { describe, it, expect } from 'vitest'
import { requestHomeTop, consumeHomeTop } from '../lib/homeIntent'
// rewrite/mp/tsconfig.json 是小程序端 CommonJS 严格配置、无 @types/node/import.meta，
// 故不走 node:fs+import.meta.url，改走 vitest 的 Vite 管线 `?raw` 原文导入（类型声明见 raw-imports.d.ts）。
import homeIntentSrc from '../lib/homeIntent.ts?raw'
import meSrc from '../pages/me/me.ts?raw'
import welcomeSrc from '../pages/welcome/welcome.ts?raw'
import homeSrc from '../pages/home/home.ts?raw'
import paysuccessSrc from '../pages/paysuccess/paysuccess.ts?raw'
import checkoutSrc from '../pages/checkout/checkout.ts?raw'

describe('homeIntent 纯逻辑：读即清，只消费一次', () => {
  it('大白话：默认未置位 → consume 返回 false', () => {
    expect(consumeHomeTop()).toBe(false)
  })

  it('大白话：request 后 consume 一次 true，第二次读回 false（标记已清）', () => {
    requestHomeTop()
    expect(consumeHomeTop()).toBe(true)
    expect(consumeHomeTop()).toBe(false)
  })

  it('大白话：连续 request 两次仍只消费一次（读即清语义·不累加）', () => {
    requestHomeTop()
    requestHomeTop()
    expect(consumeHomeTop()).toBe(true)
    expect(consumeHomeTop()).toBe(false)
  })
})

describe('接线断言：置位点/消费点/统一出口没被静默断线', () => {
  /** 剥单行注释与块注释（E1 教训：裸写正则会被注释文本假命中）。 */
  function stripComments(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  }

  /** 截取「从某方法声明起、花括号配平到该方法体结束」的源码片段（剥注释后）——
   *  防同文件其余方法被误扫进本方法的断言范围。方法写法为对象字面量简写 `name(...) {`，
   *  也兼容顶层具名函数声明 `export function name(...): T {`（如 goHomeTab，带返回类型注解）。 */
  function methodBody(rawSrc: string, name: string): string {
    const src = stripComments(rawSrc)
    const start = new RegExp(`(?:export\\s+)?(?:async\\s+)?(?:function\\s+)?${name}\\s*\\([^)]*\\)\\s*(?::\\s*[^{]+)?\\{`).exec(src)
    if (!start) throw new Error(`未找到方法 ${name}`)
    let depth = 0
    let i = start.index + start[0].length - 1 // 落在起始 `{`
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++
      else if (src[i] === '}') {
        depth--
        if (depth === 0) break
      }
    }
    return src.slice(start.index, i + 1)
  }

  it('大白话：goHomeTab() 统一出口方法体内同时置位与 switchTab（收敛后不许拆散两半）', () => {
    const body = methodBody(homeIntentSrc, 'goHomeTab')
    expect(body).toContain('requestHomeTop()')
    expect(body).toContain("wx.switchTab({ url: '/pages/home/home' })")
  })

  it('大白话：me.ts onContinue 无课兜底分支调了统一出口 goHomeTab（有课分支逐字未动·仍是 navigateTo 播放器）', () => {
    const body = methodBody(meSrc, 'onContinue')
    expect(body).toContain('goHomeTab()')
    expect(body).toContain('navigateTo') // 有课分支（进播放器）保留
    expect(body).toContain('/pages/player/player')
  })

  it('大白话：welcome.ts onGoHome（先逛逛）调了统一出口 goHomeTab', () => {
    const body = methodBody(welcomeSrc, 'onGoHome')
    expect(body).toContain('goHomeTab()')
  })

  it('大白话：paysuccess.ts onGoHome 调了统一出口 goHomeTab', () => {
    const body = methodBody(paysuccessSrc, 'onGoHome')
    expect(body).toContain('goHomeTab()')
  })

  it('大白话：checkout.ts startPay 两处 showModal success 回调都改走统一出口 goHomeTab（不少于两处）', () => {
    const body = methodBody(checkoutSrc, 'startPay')
    const count = (body.match(/goHomeTab\(\)/g) || []).length
    expect(count).toBeGreaterThanOrEqual(2)
  })

  it('大白话：home.ts onShow 消费标记并在 true 时回顶（pageScrollTo scrollTop:0）', () => {
    const body = methodBody(homeSrc, 'onShow')
    expect(body).toContain('consumeHomeTop()')
    expect(body).toContain('wx.pageScrollTo')
    expect(body).toContain('scrollTop: 0')
  })
})
