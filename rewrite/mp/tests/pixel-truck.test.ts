// 像素小货车一族（v5 设计稿 pixel-truck.js 移植）行为冒烟：停车静止可停帧、go() 开走再开回、加箱子会掉落、
// 金币/蛋有动画、纸箱/蛋壳静止。组件层（canvas/方法转发）靠开发者工具截图走查。
import { describe, it, expect } from 'vitest'
import { createTruck, createGround, PX_ROWS } from '../lib/pixelTruck'

const COLS = 90 // 约 360px 宽 / 4px 一格

function run(scene: { draw: (t: number, P: (x: number, y: number, c: string) => void, cols: number) => boolean }, until: number, from = 0) {
  let last = true
  let pts: [number, number, string][] = []
  for (let t = from; t <= until; t += 16) {
    pts = []
    last = scene.draw(t, (x, y, c) => pts.push([Math.round(x), Math.round(y), c]), COLS)
  }
  return { live: last, pts }
}
const bodyX = (pts: [number, number, string][]) => {
  const xs = pts.filter(([, , c]) => c === '#1c1c1a').map(([x]) => x)
  return xs.length ? Math.min(...xs) : null
}

describe('小货车', () => {
  it('大白话：停着的车画面静止（返回 false 可停帧），车身居中、落在 17 格里', () => {
    const tr = createTruck({ cargo: 2 })
    const { live, pts } = run(tr, 200)
    expect(live).toBe(false)
    const x = bodyX(pts)!
    expect(Math.abs(x - Math.round((COLS - 24) / 2))).toBeLessThanOrEqual(1)
    for (const [, y] of pts) expect(y).toBeLessThan(PX_ROWS)
  })

  it('大白话：go() 让车开出画面、过一会儿再开回原位；开走中不能再 go', () => {
    const tr = createTruck({ cargo: 1 })
    run(tr, 100)
    expect(tr.go()).toBe(600)
    expect(tr.go()).toBe(0)
    const mid = run(tr, 1100, 116)
    const away = bodyX(mid.pts)
    expect(away === null || away < -20 || away > COLS - 4).toBe(true) // 开出右侧后停在左侧屏外等开回
    const end = run(tr, 4000, 1116)
    expect(Math.abs(bodyX(end.pts)! - Math.round((COLS - 24) / 2))).toBeLessThanOrEqual(1)
  })

  it('大白话：go({back:false}) 开走就不回来', () => {
    const tr = createTruck({ cargo: 1 })
    run(tr, 100)
    tr.go({ back: false })
    const end = run(tr, 4000, 116)
    expect(bodyX(end.pts)).toBeNull()
  })

  it('大白话：停车时加箱子，箱子从天上掉进车斗（掉落中画面在动）', () => {
    const tr = createTruck({ cargo: 0 })
    run(tr, 100)
    tr.setCargo(2)
    expect(run(tr, 150, 116).live).toBe(true)
    const settled = run(tr, 1500, 166)
    expect(settled.pts.filter(([, , c]) => c === '#F2D27A').length).toBeGreaterThan(0)
  })
})

describe('地面场景', () => {
  it('大白话：纸箱、定位针、蛋壳是静止画面', () => {
    for (const [k, o] of [
      ['box', {}],
      ['pin', {}],
      ['egg', { shell: true }],
    ] as const) {
      const s = createGround(k, o)!
      expect(run(s, 50).live).toBe(false)
    }
  })

  it('大白话：支付金币一直在动（落地、翻转、扫高光），画面在 17 格内', () => {
    const s = createGround('pay')!
    const r = run(s, 3000)
    expect(r.live).toBe(true)
    for (const [, y] of r.pts) expect(y).toBeLessThan(PX_ROWS)
  })

  it('大白话：孵化过的蛋（同一 key 第二次）直接是小鸭在走', () => {
    createGround('egg', { hatched: true, hatchKey: 'k1' })
    const s = createGround('egg', { hatched: true, hatchKey: 'k1' })!
    const r = run(s, 600)
    expect(r.pts.some(([, , c]) => c === '#F2D27A')).toBe(true)
  })

  it('大白话：不认识的名字返回空', () => {
    expect(createGround('nope')).toBeNull()
  })
})
