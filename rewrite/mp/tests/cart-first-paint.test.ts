// 购物车首屏：本地已有行时不得先画「这里还没有东西」。
// 根因：items 起笔空数组 + onShow 等 ready + onLoad 先 await 云目录再 refresh。
// 锁：data 从 cart.getItems() 起笔；onLoad 在 getAllProducts 之前先 refresh。
import { describe, it, expect } from 'vitest'
import cartSrc from '../pages/cart/cart.ts?raw'
import cartWxml from '../pages/cart/cart.wxml?raw'

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

function methodBody(rawSrc: string, name: string): string {
  const src = stripComments(rawSrc)
  const start = new RegExp(`(?:export\\s+)?(?:async\\s+)?(?:function\\s+)?${name}\\s*\\([^)]*\\)\\s*(?::\\s*[^{]+)?\\{`).exec(src)
  if (!start) throw new Error(`未找到方法 ${name}`)
  let depth = 0
  let i = start.index + start[0].length - 1
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') {
      depth--
      if (depth === 0) break
    }
  }
  return src.slice(start.index, i + 1)
}

describe('购物车首屏本地先上屏（伪空态）', () => {
  it('大白话：进购物车时，车上已有的东西立刻出现，不等云端商品目录回来', () => {
    const src = stripComments(cartSrc)
    expect(src).toMatch(/items:\s*cart\.getItems\(\)/)
    expect(src).toMatch(/allSelected:\s*cart\.allSelected\(\)/)
    expect(src).toMatch(/selectedCount:\s*cart\.selectedCount\(\)/)
    expect(src).toMatch(/totalLabel:\s*cart\.selectedTotalLabel\(\)/)
    expect(src).not.toMatch(/items:\s*\[\s*\]\s*as\s+ReturnType/)
  })

  it('大白话：拉云目录之前先按本地车刷新一屏，封面和推荐等目录回来再补', () => {
    const body = methodBody(cartSrc, 'onLoad')
    const localPaint = body.indexOf('this.refresh()')
    const cloud = body.indexOf('getAllProducts')
    expect(localPaint).toBeGreaterThanOrEqual(0)
    expect(cloud).toBeGreaterThan(localPaint)
  })

  it('大白话：空态那句「这里还没有东西」只在车上真没行时才画', () => {
    const src = cartWxml.replace(/<!--[\s\S]*?-->/g, '')
    expect(src).toMatch(/wx:if="\{\{items\.length\}\}"[\s\S]*wx:else[\s\S]*这里还没有东西/)
  })
})
