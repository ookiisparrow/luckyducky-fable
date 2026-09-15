// 2026-09-13 mp 审计：评价列表/播放页装课/编辑资料过期回包可写脏页；售后空图占位永不填。
// 源码扫描（同 order-detail-stale / home-reload-failsoft·mp tsconfig 无 node:fs·E1 剥注释防假绿）。
import { describe, it, expect } from 'vitest'
import reviewsSrc from '../pages/reviews/reviews.ts?raw'
import playerSrc from '../pages/player/player.ts?raw'
import profileSrc from '../pages/profile-edit/profile-edit.ts?raw'
import aftersalesWxml from '../pages/aftersales/aftersales.wxml?raw'
import aftersalesWxss from '../pages/aftersales/aftersales.wxss?raw'

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

const SEQ_RE = /seq\s*!==\s*this\._seq|this\._seq\s*!==\s*seq/

describe('评价/播放/资料过期回包 + 售后空图', () => {
  it('大白话：评价列表刷新或上拉翻页，这一趟已经过期就丢掉，不写到新列表上', () => {
    const reload = methodBody(reviewsSrc, 'reload')
    expect(reload, 'reload 须自增代次').toMatch(/\+\+this\._seq/)
    const reloadSeq = reload.search(SEQ_RE)
    const reloadSet = reload.search(/this\.setData/)
    expect(reloadSeq, 'reload 须认代次').toBeGreaterThanOrEqual(0)
    expect(reloadSet, 'reload 过期须先于写入丢掉').toBeGreaterThan(reloadSeq)

    const more = methodBody(reviewsSrc, 'onReachBottom')
    expect(more, '翻页不另起代次（同 aftersales：期间 reload 递增则本次作废）').not.toMatch(/\+\+this\._seq/)
    const moreSeq = more.search(SEQ_RE)
    const moreSet = more.search(/this\.setData/)
    expect(moreSeq, 'onReachBottom 须认代次').toBeGreaterThanOrEqual(0)
    expect(moreSet, '翻页过期须先于写入丢掉').toBeGreaterThan(moreSeq)
  })

  it('大白话：播放页装课回包时人已走或又点了重试，旧课丢掉不写', () => {
    const body = methodBody(playerSrc, 'initCourse')
    const awaitAt = body.indexOf('await')
    const unloadedAt = body.search(/this\??\.unloaded/)
    const seqAt = body.search(SEQ_RE)
    const setAt = body.search(/this\.setData/)
    expect(awaitAt, 'initCourse 须等目录回包').toBeGreaterThanOrEqual(0)
    expect(body, 'initCourse 须自增代次').toMatch(/\+\+this\._seq/)
    expect(unloadedAt, 'initCourse 须认已退页').toBeGreaterThan(awaitAt)
    expect(seqAt, 'initCourse 须认代次').toBeGreaterThan(awaitAt)
    expect(setAt, '退页/过期须先于写入丢掉').toBeGreaterThan(Math.max(unloadedAt, seqAt))
  })

  it('大白话：编辑资料页 login 回来发现人走了，就不把旧资料写上去', () => {
    const body = methodBody(profileSrc, 'onLoad')
    const awaitAt = body.indexOf('await')
    const unloadedAt = body.search(/this\??\.unloaded/)
    const setAt = body.search(/this\.setData/)
    expect(awaitAt, 'onLoad 须等 login').toBeGreaterThanOrEqual(0)
    expect(unloadedAt, 'onLoad 须认已退页').toBeGreaterThan(awaitAt)
    expect(setAt, '退页须先于写入丢掉').toBeGreaterThan(unloadedAt)
  })

  it('大白话：售后单永远没有商品图，空灰块连样式一起删掉', () => {
    expect(stripComments(aftersalesWxml)).not.toMatch(/coas-order-img/)
    expect(stripComments(aftersalesWxss)).not.toMatch(/coas-order-img/)
  })
})
