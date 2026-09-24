// 夜间审计 2026-09-12 mp slice：订单/详情 data.missing 是死字段；详情 loadRecs/loadRating 过期回包未认代次。
// 源码扫描（同 home-reload-failsoft·mp tsconfig 无 node:fs·E1 剥注释防假绿）。
import { describe, it, expect } from 'vitest'
import detailSrc from '../pages/detail/detail.ts?raw'

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').replace(/<!--[\s\S]*?-->/g, '')
}

function methodBody(rawSrc: string, name: string): string {
  const src = stripComments(rawSrc)
  const start = new RegExp(`(?:async\\s+)?${name}\\s*\\([^)]*\\)\\s*(?::\\s*[^{]+)?\\{`).exec(src)
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

describe('订单/详情死字段 + 推荐评分过期回包', () => {

  it('大白话：推荐和评分回包若这一趟已经过期，就丢掉不写到已经离开的页', () => {
    for (const name of ['loadRecs', 'loadRating']) {
      const body = methodBody(detailSrc, name)
      const seqAt = body.search(/seq\s*!==\s*this\._seq|this\._seq\s*!==\s*seq/)
      const setAt = body.search(/this\.setData/)
      expect(seqAt, `${name} 须认代次`).toBeGreaterThanOrEqual(0)
      expect(setAt, `${name} 过期须先于写入丢掉`).toBeGreaterThan(seqAt)
    }
  })
})
