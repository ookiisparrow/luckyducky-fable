// 自动保存串行化 serialSave（守卫 rw-admin-serialsave-golden·治 autosave 乱序覆盖·根因#8「构建过≠真能用」）：
// 防抖 autosave 的整档 POST 无序号，慢网下两次保存乱序完成会用旧快照覆盖新内容。串行化不变量：
// 在途再触发不并发（只标脏），当前保存完成后若期间有新编辑则用最新快照补存一次（latest-wins）。
import { describe, it, expect } from 'vitest'
import { serialSave } from '../src/lib/serialSave'

describe('serialSave（autosave 串行化·latest-wins·根因#8）', () => {
  it('大白话：在途再触发不并发·只标脏·完成后用最新快照补存一次', async () => {
    const seen: number[] = []
    let n = 0
    let releaseFirst!: () => void
    const state = { v: 1 }
    const run = () => {
      const started = ++n
      seen.push(state.v) // 记录本次保存看到的状态快照
      return started === 1 ? new Promise<void>((r) => (releaseFirst = r)) : Promise.resolve()
    }
    const trigger = serialSave(run)
    const p1 = trigger() // 第一次·挂起中
    state.v = 2 // 期间用户改了内容
    const p2 = trigger() // 在途再触发：应标脏、不并发启动第二次
    expect(n).toBe(1) // 没有并发的第二次 run

    releaseFirst() // 放行第一次
    await p1
    await p2
    expect(seen).toEqual([1, 2]) // 补存看到最新 2·不会用旧快照覆盖新内容
    expect(n).toBe(2) // 恰补存一次（不无限）
  })

  it('大白话：无并发时就是普通串行执行·每次都跑', async () => {
    let n = 0
    const trigger = serialSave(async () => {
      n++
    })
    await trigger()
    await trigger()
    expect(n).toBe(2)
  })

  it('大白话：run 抛错也解锁·不永久卡住后续保存', async () => {
    let n = 0
    const trigger = serialSave(async () => {
      n++
      if (n === 1) throw new Error('boom')
    })
    await trigger().catch(() => {}) // 第一次抛错
    await trigger() // 仍能再保存（未被锁死）
    expect(n).toBe(2)
  })
})
