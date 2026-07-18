// 品牌 splash 撤场判定 shouldLeave 纯函数直测（丝滑战役批2·min-hold + 数据就绪 race）。
// brand-splash.ts 顶层调用 Component()（mp 全局·node 测试环境无）——桩成 no-op 让模块顶层求值通过，
// 只为直测导出的纯函数（同 cart/catalog 内存桩家风·桩全局不 mock 模块）。用动态 import（非顶层 await·
// rewrite/mp tsconfig 为 CommonJS）在桩就位后再求值该组件模块。
import { describe, it, expect, beforeAll } from 'vitest'

let shouldLeave: (now: number, t0: number, ready: boolean) => boolean

beforeAll(async () => {
  ;(globalThis as any).Component = () => {}
  ;({ shouldLeave } = await import('../components/brand-splash/brand-splash'))
})

const T0 = 1_000_000 // 任取的 attached 锚点时刻

describe('shouldLeave（撤场判定·min-hold + 数据就绪 race）', () => {
  it('大白话：过了最短停留（≥800ms）且 ready=true 才放行离场', () => {
    expect(shouldLeave(T0 + 800, T0, true)).toBe(true) // 恰到 min-hold 边界
    expect(shouldLeave(T0 + 2000, T0, true)).toBe(true)
  })

  it('大白话：min-hold 未到——哪怕 ready=true 也不走（防一闪而过）', () => {
    expect(shouldLeave(T0 + 799, T0, true)).toBe(false)
    expect(shouldLeave(T0 + 100, T0, true)).toBe(false)
  })

  it('大白话：过了 min-hold 但数据未就绪（ready=false）不走——等 ready 或硬上限兜底', () => {
    expect(shouldLeave(T0 + 5000, T0, false)).toBe(false)
  })
})
