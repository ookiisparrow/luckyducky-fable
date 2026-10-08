// 货车巡航预渲染（lib/truckBaked + truck-baked.wxss）：产物必须与生成器一致；巡航循环首尾无缝；idle 判定只在纯时间循环里成立。
// 改了 pixelTruck 的巡航画面/节拍却没重跑 `node scripts/gen-truck-bake.mjs`，这里就红。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as bake from '../../scripts/lib/bake-truck.mjs'
import * as T from '../../rewrite/mp/lib/pixelTruck'
import { layerOf } from '../../rewrite/mp/lib/truckLayer'
import { TRUCK_FRAMES, TRUCK_SPRITES } from '../../rewrite/mp/lib/truckBaked'

const ROOT = join(__dirname, '../..')

describe('货车巡航预渲染', () => {
  it('大白话：落盘的精灵图/动画样式和生成器现算的一模一样（没重跑生成器就红）', () => {
    const out = bake.buildTruckOutputs(T)
    expect(readFileSync(join(ROOT, 'rewrite/mp/lib/truckBaked.ts'), 'utf8')).toBe(out.ts)
    expect(readFileSync(join(ROOT, 'rewrite/mp/components/px-truck/truck-baked.wxss'), 'utf8')).toBe(out.wxss)
    expect(Object.keys(TRUCK_SPRITES)).toHaveLength(16)
  })

  it.each([false, true])('大白话：慢速=%s 的巡航，隔一个周期画面完全相同（循环首尾无缝），且一个周期里车确实在动', (slow) => {
    const period = slow ? T.IDLE_PERIOD.slow : T.IDLE_PERIOD.cruise
    expect(TRUCK_FRAMES[slow ? 's' : 'c']).toBe(period / T.SPR_STEP)
    for (const mir of [false, true])
      for (let t = 0; t < period; t += T.SPR_STEP) {
        expect(bake.frameAt(T, slow, 2, mir, t + period), `slow=${slow} mir=${mir} t=${t}`).toEqual(bake.frameAt(T, slow, 2, mir, t))
      }
    const first = bake.frameAt(T, slow, 2, false, 0).join('|')
    const seen = new Set()
    for (let t = 0; t < period; t += T.SPR_STEP) seen.add(bake.frameAt(T, slow, 2, false, t).join('|'))
    expect(seen.size).toBeGreaterThan(3)
    expect(seen.has(first)).toBe(true)
  })

  it('大白话：车只有巡航/慢速且没在掉箱、盖章时才交给烘焙层；一开走就收回', () => {
    const tr = T.createTruck({ pose: 'drive', cargo: 2 })
    const P = () => {}
    tr.draw(0, P, 93)
    tr.draw(16, P, 93)
    expect(tr.view()).toMatchObject({ slow: false, shown: 2, mir: false })
    expect(T.createTruck({ pose: 'slow', cargo: 1 }).view()).toMatchObject({ slow: true })
    expect(T.createTruck({ pose: 'park', cargo: 1 }).view()).toBeNull()
    tr.stamp()
    expect(tr.view()).toBeNull()
    const go = T.createTruck({ pose: 'park', cargo: 1 })
    go.draw(0, P, 93)
    go.go() // 停着的车先起步抖动（逐行画），不交烘焙层
    expect(go.view()).toBeNull()
  })

  it('大白话：巡航中开走→烘焙层按「移动」接手，车从屏内一路开出屏外；开回时又从屏外滑回原位再转回静止循环', () => {
    const tr = T.createTruck({ pose: 'drive', cargo: 1 })
    const P = () => {}
    tr.draw(0, P, 93)
    const home = tr.view().home
    expect(tr.view().move).toBe(false)
    tr.go()
    let t = 16
    let maxX = home
    const kinds = new Set()
    for (; t < 4000; t += 16) {
      tr.draw(t, P, 93, () => 0)
      const v = tr.view()
      if (!v) continue
      kinds.add(v.move ? 'move' : 'idle')
      if (v.move) maxX = Math.max(maxX, v.x)
    }
    expect(maxX).toBeGreaterThan(93) // 开出了屏
    expect([...kinds]).toContain('move')
    expect(tr.view()).toMatchObject({ move: false, home }) // 开回后又是静止巡航，回到原位
    expect(tr.view().x).toBe(home)
  })

  it('大白话：draw 的 skip 答 Still 时这一帧不落笔并摘出调度；答 Moving 时不落笔但调度继续', () => {
    const tr = T.createTruck({ pose: 'drive', cargo: 1 })
    let plotted = 0
    const P = () => plotted++
    expect(tr.draw(0, P, 93)).toBe(true)
    expect(plotted).toBeGreaterThan(0)
    plotted = 0
    expect(tr.draw(16, P, 93, () => T.Take.Still)).toBe(false)
    expect(tr.draw(32, P, 93, () => T.Take.Moving)).toBe(true) // 巡航本就一直在动（spd>0）
    expect(plotted).toBe(0)
  })

  it('大白话：生产用的货车不带烘焙专用的 sprite；烘焙器拿到的才有', () => {
    expect('sprite' in T.createTruck()).toBe(false)
    expect(typeof T.createTruckForBake().sprite).toBe('function')
  })

  it('大白话：图层数据——静止循环给相位与偏移，移动给每帧位置；镜像的地面起点取补数；没烘的箱数返回 null', () => {
    const still = layerOf({ move: false, slow: false, shown: 2, mir: false, home: 35, x: 35, ground: 5.4 })
    expect(still).toMatchObject({ mv: false, s: 'c', k: 'c', tx: (35 - T.SPR_ORG) * T.TRUCK_CELL, gd: 1 * T.groundCellMs(false) })
    const mir = layerOf({ move: false, slow: true, shown: 1, mir: true, home: 35, x: 35, ground: 5.4 })
    expect(mir).toMatchObject({ k: 'sm', s: 's', gd: 3 * T.groundCellMs(true) })
    const mv = layerOf({ move: true, slow: false, shown: 1, mir: false, home: 35, x: 60.5, ground: 12.2 })
    expect(mv).toMatchObject({ mv: true, tx: Math.round(60.5 * T.TRUCK_CELL - T.SPR_ORG * T.TRUCK_CELL), gp: -12 * T.TRUCK_CELL })
    expect(layerOf({ move: false, slow: false, shown: 9, mir: false, home: 35, x: 35, ground: 0 })).toBeNull()
  })

  it('大白话：把地面相位交还时按速度/方向补，慢速只补 0.4 倍、倒车反向', () => {
    const a = T.createTruck({ pose: 'drive' })
    a.draw(0, () => {}, 93)
    const g0 = a.view().ground
    a.syncIdle(400)
    expect(a.view().ground - g0).toBeCloseTo(10)
    const s = T.createTruck({ pose: 'slow' })
    s.draw(0, () => {}, 93)
    const s0 = s.view().ground
    s.syncIdle(400)
    expect(s.view().ground - s0).toBeCloseTo(4)
    const m = T.createTruck({ pose: 'reverse' })
    m.draw(0, () => {}, 93)
    const m0 = m.view().ground
    m.syncIdle(400)
    expect(m.view().ground - m0).toBeCloseTo(-10)
  })
})
