// 自绘 seek 条拖动几何 WXS 化（批5·根因#15：60Hz touchmove 每帧 5 字段 setData 双向过桥＝跟手延迟/掉帧源；
// #5：拖动秒/磁吸数学在 seek.wxs（ES5 独立运行时）与 lib/player.ts 双源，须对拍钉死不漂）。三件事：
// ① clampSeek/nearestMark 数学逐点对拍——抽 seek.wxs 函数体真跑（new Function），与 lib/player.ts 单源版逐点比对
//    （WXS 进不了 tsc 编译面，抄式子必然双源·病根#5·覆盖边界 0/负值/超 dur/磁吸半径内外/marks 空）；
// ② wxml/ts/wxs 接线成对（错题本 E2：wxml 绑定与逻辑层方法是一对，抄一半真机才炸）——wxs 标签+sk.* 绑定+
//    change:cfg 在场、player.ts onSeekTick/onSeekCommit 方法在场、onSeekCommit 体内真 .seek(；
// ③ WXS 源两段式纪律——onMove 函数体内无 onSeekCommit 字面（拖动中绝不提交·松手才 commit）。
// rewrite/mp/tsconfig.json 无 @types/node，走 vitest 的 Vite `?raw` 原文导入（见 tests/raw-imports.d.ts）。
import { describe, it, expect } from 'vitest'
import { clampSeek, nearestMark } from '../lib/player'
import seekWxsRaw from '../pages/player/seek.wxs?raw'
import playerWxmlRaw from '../pages/player/player.wxml?raw'
import playerTsRaw from '../pages/player/player.ts?raw'

// 抽 seek.wxs 顶层 `function name(args) { ... \n}` 的函数体（顶层闭合 } 在行首·内部 } 均缩进·非贪婪到首个行首 }）。
function extractWxsFn(src: string, sig: string, args: string): (...a: unknown[]) => unknown {
  const re = new RegExp('function ' + sig.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([\\s\\S]*?)\\n\\}')
  const m = src.match(re)
  if (!m) throw new Error('seek.wxs 抽不出函数：' + sig)
  // eslint-disable-next-line no-new-func
  return new Function(...args.split(',').map((s) => s.trim()), m[1]) as (...a: unknown[]) => unknown
}

const wxsClampSeek = extractWxsFn(seekWxsRaw, 'clampSeek(value, durSec)', 'value, durSec') as (v: number, d: number) => number
const wxsNearestMark = extractWxsFn(seekWxsRaw, 'nearestMark(sec, marks, windowSec)', 'sec, marks, windowSec') as (
  s: number,
  m: { at: number; name: string }[],
  w: number
) => { at: number; name: string } | null

describe('seek.wxs clampSeek 与 lib/player.ts 逐点对拍（双源数学·病根#5）', () => {
  it('大白话：抽出 wxs 的 clampSeek 真跑，各类脏值/边界与 TS 单源版逐点一致', () => {
    const values = [-100, -5, -0.4, 0, 0.9, 30, 30.9, 59.5, 119, 120, 121, 200, NaN, Infinity]
    const durs = [0, 1, 120, 3600]
    for (const v of values) {
      for (const d of durs) {
        expect(wxsClampSeek(v, d)).toBe(clampSeek(v, d))
      }
    }
  })
})

describe('seek.wxs nearestMark 与 lib/player.ts 逐点对拍（磁吸·病根#5·半径内外/等距/空表）', () => {
  const MARKS = [
    { at: 10, name: 'A' },
    { at: 20, name: 'B' },
    { at: 30, name: 'C' },
  ]
  const grids: { marks: { at: number; name: string }[]; window: number }[] = [
    { marks: MARKS, window: 3 },
    { marks: MARKS, window: 5 },
    { marks: MARKS, window: 0 }, // 非正窗口 → null
    { marks: MARKS, window: -1 },
    { marks: [], window: 5 }, // 空表 → null
    { marks: [{ at: 15, name: 'M' }], window: 5 },
  ]
  it('大白话：sec 从 0 扫到 40（含磁吸半径边界与等距点），wxs 版与 TS 单源版命中的节点逐点一致', () => {
    for (const g of grids) {
      for (let sec = 0; sec <= 40; sec++) {
        expect(wxsNearestMark(sec, g.marks, g.window)).toEqual(nearestMark(sec, g.marks, g.window))
      }
    }
  })
  it('大白话：等距取 at 较小者——sec=15 在 [10,20] 正中，两版都取 at=10', () => {
    expect(wxsNearestMark(15, MARKS, 10)).toEqual({ at: 10, name: 'A' })
    expect(wxsNearestMark(15, MARKS, 10)).toEqual(nearestMark(15, MARKS, 10))
  })
})

describe('wxml/ts/wxs 接线成对（E2：抄一半真机才炸）', () => {
  const stripWxml = (s: string) => s.replace(/<!--[\s\S]*?-->/g, '')
  const stripTs = (s: string) => s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
  it('大白话：wxml 挂 <wxs src="./seek.wxs">、seek 容器四触摸绑定 + change:cfg 下发几何', () => {
    const wxml = stripWxml(playerWxmlRaw)
    expect(wxml).toMatch(/<wxs\s+[^>]*src\s*=\s*"\.\/seek\.wxs"/)
    expect(wxml).toMatch(/bind:touchstart\s*=\s*"\{\{\s*sk\.onStart\s*\}\}"/)
    expect(wxml).toMatch(/catch:touchmove\s*=\s*"\{\{\s*sk\.onMove\s*\}\}"/)
    expect(wxml).toMatch(/bind:touchend\s*=\s*"\{\{\s*sk\.onEnd\s*\}\}"/)
    expect(wxml).toMatch(/change:cfg\s*=\s*"\{\{\s*sk\.onCfg\s*\}\}"/)
    expect(wxml).toMatch(/cfg\s*=\s*"\{\{\s*seekCfg\s*\}\}"/)
  })
  it('大白话：player.ts 定义 onSeekTick / onSeekCommit（WXS callMethod 指名的逻辑层落点·抄一半真机才炸）', () => {
    const ts = stripTs(playerTsRaw)
    expect(ts).toMatch(/\bonSeekTick\s*\(/)
    expect(ts).toMatch(/\bonSeekCommit\s*\(/)
  })
  it('大白话：seek.wxs module.exports 暴露四个 sk.* 处理器', () => {
    for (const fn of ['onStart', 'onMove', 'onEnd', 'onCfg']) {
      expect(seekWxsRaw).toMatch(new RegExp(fn + '\\s*:\\s*' + fn))
    }
  })
})

describe('两段式铁律：seek.wxs onMove 拖动中绝不提交（源码扫描）', () => {
  // 抽 onMove 函数体（顶层 function·非贪婪到行首 }），断言体内无 onSeekCommit 字面、无 .seek(——
  // 提交只许在 onEnd（callMethod onSeekCommit），拖动帧绝不触碰真 seek（否则被 timeupdate/卡顿顶回去）。
  it('大白话：onMove 体内既无 onSeekCommit 也无 .seek(，提交动作只在松手（onEnd）', () => {
    const m = seekWxsRaw.match(/function onMove\([^)]*\)\s*\{([\s\S]*?)\n\}/)
    expect(m).toBeTruthy()
    const body = m![1]
    expect(body).not.toMatch(/onSeekCommit/)
    expect(body).not.toMatch(/\.seek\s*\(/)
  })
  it('大白话：onEnd 体内经 callMethod onSeekCommit 提交（松手才真 seek 的渲染层出口）', () => {
    const m = seekWxsRaw.match(/function onEnd\([^)]*\)\s*\{([\s\S]*?)\n\}/)
    expect(m).toBeTruthy()
    expect(m![1]).toMatch(/callMethod\(\s*['"]onSeekCommit['"]/)
  })
})
