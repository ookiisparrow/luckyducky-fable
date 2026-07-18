// 首页定格动画测试版守卫（测试分支·worktree-stopmotion-home-test）。三件事：
// ① WXS/TS 两处 frameForRatio 数学逐点对拍（WXS 是 ES5 独立运行时进不了 TS 编译面，抄式子必然
//    双源——本测试抽取 wxs 函数体真跑，防两处漂移·病根#5）；
// ② 素材在位 + wxml/ts 接线成对（错题本 E2：wxml 绑定与 ts 方法是一对，抄一半真机才炸）；
// ③ dragTick 单源行为（翻帧才嗒 + 40ms 钳制跳齿·配方数值用户真机拍板版，不许静默变）。
// rewrite/mp/tsconfig.json 无 @types/node，不走 node:fs+import.meta.url，改走 `?raw` 原文导入（见 raw-imports.d.ts）。
import { describe, it, expect, vi, afterEach } from 'vitest'
import { frameForRatio, FLIP_N, FLIP_ZERO } from '../lib/flipLever'
import { dragTick, DRAG_TICK_GAP_MS } from '../lib/haptics'
import wxsSrc from '../pages/home/stopmotion.wxs?raw'
import wxmlSrc from '../pages/home/home.wxml?raw'
import tsSrc from '../pages/home/home.ts?raw'
// 素材在位 spot-check（?raw 只能静态导入、37 张逐一枚举不值当）：36 帧同一脚本同批 cp 原子落位，
// 单帧独缺不可达——钉两端边界 + 静止帧 + 高清层四个点即够；成对接线由下方 wxml 断言兜。
// 本地包内素材＝JPEG（微信 <image> 不解析本地 WebP·见 home.wxml 注释），正式版 CDN 走 WebP。
import fr00 from '../static/stopmotion/fr-00.jpg?raw'
import fr17 from '../static/stopmotion/fr-17.jpg?raw'
import fr35 from '../static/stopmotion/fr-35.jpg?raw'
import hi17 from '../static/stopmotion/hi-17.jpg?raw'

describe('WXS/TS frameForRatio 同构（双源数学对拍）', () => {
  it('大白话：wxs 里 N/ZERO 常量与 flipLever 单源一致', () => {
    expect(wxsSrc).toMatch(new RegExp(`var N = ${FLIP_N}\\b`))
    expect(wxsSrc).toMatch(new RegExp(`var ZERO = ${FLIP_ZERO}\\b`))
  })

  it('大白话：抽出 wxs 的 frameForRatio 真跑，-1.2…1.2 全程逐点与 TS 版一致（含钳制越界）', () => {
    const m = wxsSrc.match(/function frameForRatio\(ratio\) \{([\s\S]*?)\n\}/)
    expect(m).toBeTruthy()
    const wxsFn = new Function('ratio', `var N=${FLIP_N};var ZERO=${FLIP_ZERO};${m![1]}`) as (r: number) => number
    for (let r = -1.2; r <= 1.201; r += 0.005) {
      expect(wxsFn(r)).toBe(frameForRatio(r))
    }
  })
})

describe('素材在位 + wxml/ts 接线成对（E2）', () => {
  it('大白话：素材在位——两端边界帧 + 静止帧 + 高清定格帧非空（同批原子生成·spot-check 见文件头注）', () => {
    for (const f of [fr00, fr17, fr35, hi17]) {
      expect(f.length).toBeGreaterThan(100)
    }
  })

  it('大白话：wxml 挂 wxs 模块、帧叠层 wx:for + 加载门闸、滑轨四通道 + 四个 catch 触摸绑定齐全', () => {
    expect(wxmlSrc).toContain('<wxs module="sm" src="./stopmotion.wxs" />')
    expect(wxmlSrc).toContain('wx:for="{{smFrames}}"')
    expect(wxmlSrc).toContain('id="sm-f{{index}}"')
    expect(wxmlSrc).toContain('src="/static/stopmotion/fr-{{item}}.jpg"')
    expect(wxmlSrc).toContain('bindload="onSmFrameLoad"')
    expect(wxmlSrc).toContain('binderror="onSmFrameError"')
    for (const ch of ['maxj', 'ready', 'settlex', 'phase']) {
      expect(wxmlSrc).toContain(`change:${ch}="{{sm.`)
    }
    for (const ev of ['catchtouchstart', 'catchtouchmove', 'catchtouchend', 'catchtouchcancel']) {
      expect(wxmlSrc).toContain(`${ev}="{{sm.on`)
    }
  })

  it('大白话：wxs callMethod 指名的逻辑层方法在 home.ts 都有定义（抄一半真机才炸·E2）', () => {
    for (const fn of ['onSmFrameLoad', 'onSmFrameError', 'onSmDragState', 'onSmFrameTick', 'onSmRelease']) {
      expect(tsSrc).toMatch(new RegExp(`${fn}\\(`))
    }
  })
})

describe('dragTick（拖动逐格「嗒」单源·配方真机拍板版）', () => {
  afterEach(() => vi.useRealTimers())

  it('大白话：没翻帧不嗒；翻帧且距上次 ≥40ms 才嗒；快扫 40ms 内跳齿不嗒', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    expect(dragTick(17, 17)).toBe(false) // 没翻帧
    expect(dragTick(17, 18)).toBe(true) // 翻帧 → 嗒
    vi.setSystemTime(1_000_000 + DRAG_TICK_GAP_MS - 1)
    expect(dragTick(18, 19)).toBe(false) // 40ms 内快扫 → 跳齿
    vi.setSystemTime(1_000_000 + DRAG_TICK_GAP_MS + 1)
    expect(dragTick(18, 19)).toBe(true) // 过钳制窗 → 补嗒
  })
})
