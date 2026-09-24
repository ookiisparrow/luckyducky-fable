// 首页 toast 关定时器（模块级 toastTimer）：切走/卸载必须清掉，否则 1.6s 后迟到 setData
// 打到已隐藏的 tab（同 exit guard「不回调已隐藏页」）。源码扫描钉 onHide/onUnload 方法体。
import { describe, it, expect } from 'vitest'
import homeSrc from '../pages/home/home.ts?raw'

/** 剥单行注释与块注释（E1 教训：裸写正则会被注释文本假命中）。 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

/** 截取方法体（剥注释后·同 home-reload-failsoft.test.ts helper）。 */
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

describe('home toastTimer 离页清理', () => {
  it('大白话：切走或卸载首页时清掉 toast 关定时器，不再回头改已隐藏的页', () => {
    for (const name of ['onHide', 'onUnload'] as const) {
      const body = methodBody(homeSrc, name)
      expect(body, `${name} 未 clearTimeout(toastTimer)`).toMatch(/clearTimeout\s*\(\s*toastTimer\s*\)/)
      expect(body, `${name} 未把 toastTimer 置空`).toMatch(/toastTimer\s*=\s*null/)
    }
  })
})
