// 自动保存串行化 serialSave（守卫 rw-admin-serialsave-golden·治 autosave 乱序覆盖·根因#8「构建过≠真能用」）：
// 防抖 autosave 的整档 POST 无序号，慢网下两次保存乱序完成会用旧快照覆盖新内容。串行化不变量：
// 在途再触发不并发（只标脏），当前保存完成后若期间有新编辑则用最新快照补存一次（latest-wins）。
import { describe, it, expect } from 'vitest'
import { serialSave, hasPendingSaves } from '../src/lib/serialSave'

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

describe('serialSave.settled（批3 规格新增·危险动作发起前排空在途 autosave·不额外多发一次·根因#8）', () => {
  it('大白话：idle 时调 settled() 不触发新的一次 run（区别于 trigger() 恒至少跑一次）', async () => {
    let n = 0
    const trigger = serialSave(async () => {
      n++
    })
    await trigger.settled() // 从未触发过 trigger()——idle
    expect(n).toBe(0) // 没有被迫多打一次 POST
  })

  it('大白话：有在途链时·settled() 等到链彻底排空（含尾随补存）再回', async () => {
    const seen: number[] = []
    let n = 0
    let releaseFirst!: () => void
    const state = { v: 1 }
    const run = () => {
      const started = ++n
      seen.push(state.v)
      return started === 1 ? new Promise<void>((r) => (releaseFirst = r)) : Promise.resolve()
    }
    const trigger = serialSave(run)
    void trigger() // 第一次·挂起中
    state.v = 2 // 期间又编辑了一次
    void trigger() // 标脏（不并发）
    let settledResolved = false
    const p = trigger.settled().then(() => (settledResolved = true))
    expect(settledResolved).toBe(false) // 在途没排空前不提前回
    releaseFirst() // 放行第一次·loop 见 dirty 再补跑一次
    await p
    expect(settledResolved).toBe(true)
    expect(seen).toEqual([1, 2]) // 补存看到最新快照·未被排空动作打断
    expect(n).toBe(2) // settled() 本身没有额外触发第三次 run（只等在途、不强推新一轮）
  })
})

describe('serialSave(run, key)：跨组件实例共享槽位（批D·P1·治「快速切走再切回」乱序覆盖）', () => {
  it('大白话：同 key 的新实例接管旧实例仍在途的补存链——尾随补存用新实例的 run，不用旧实例的旧快照', async () => {
    const key = 'k-' + Math.random() // 每个用例独立 key·防跨用例串槽位
    let releaseOld!: () => void
    const oldSnapshot = { savedWith: 'old' }
    const newSnapshot = { savedWith: 'new' }
    const written: string[] = []

    // 旧实例（如 Products 页第一次挂载）：卸载那一刻触发补存·请求挂起（模拟慢网）
    const oldTrigger = serialSave(() => {
      written.push(oldSnapshot.savedWith)
      return new Promise<void>((r) => (releaseOld = r))
    }, key)
    const oldFlush = oldTrigger() // 旧实例 onBeforeUnmount 发起·还没回包

    // 新实例（用户快速切回本页·Vue 建出全新组件，重新调用 serialSave(newRun, 同 key)）
    const newTrigger = serialSave(async () => {
      written.push(newSnapshot.savedWith)
    }, key)
    // 新实例自己也编辑触发了一次自动保存——此时旧请求仍在途，应标脏加入同一条链，不并发起第二条
    const newFlush = newTrigger()
    expect(newFlush).toBe(oldFlush) // 共享同一条链（同一个 Promise）

    releaseOld() // 旧实例的慢请求终于回包
    await oldFlush
    await newFlush
    // 关键断言：链上第二轮（dirty 补存）用的是*新实例*的 run，不是旧实例卸载时的旧快照——
    // 旧快照写一次、随后用新实例的当前状态补写一次，新实例的编辑最终生效（不被旧快照覆盖）
    expect(written).toEqual(['old', 'new'])
  })

  it('大白话：旧实例的补存请求仍在途时，即便旧实例自身晚一点也触发了 trigger()，也不会把槽位的 run 抢回旧闭包', async () => {
    const key = 'k-' + Math.random()
    let release!: () => void
    const seen: string[] = []
    const oldTrigger = serialSave(() => {
      seen.push('old')
      return new Promise<void>((r) => (release = r))
    }, key)
    void oldTrigger() // 旧实例挂起
    serialSave(async () => {
      seen.push('new')
    }, key) // 新实例接管（仅构造，不必真的调用它的 trigger）
    void oldTrigger() // 旧实例自己又调了一次 trigger（如重复的 onBeforeUnmount 触发）——不该把 run 抢回旧闭包
    release()
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))
    expect(seen).toEqual(['old', 'new']) // 补存那一轮用的仍是新实例的 run
  })

  it('大白话：不同 key 互不干扰（不同商品/不同页签各自一条链）', async () => {
    const keyA = 'ka-' + Math.random()
    const keyB = 'kb-' + Math.random()
    let nA = 0, nB = 0
    const triggerA = serialSave(async () => { nA++ }, keyA)
    const triggerB = serialSave(async () => { nB++ }, keyB)
    await triggerA()
    expect(nB).toBe(0) // A 触发不影响 B
    await triggerB()
    expect(nA).toBe(1)
    expect(nB).toBe(1)
  })

  it('大白话：不传 key 仍是原纯组件实例级队列（向后兼容·不同调用互不共享）', async () => {
    let n1 = 0, n2 = 0
    const t1 = serialSave(async () => { n1++ })
    const t2 = serialSave(async () => { n2++ })
    await t1()
    expect(n2).toBe(0)
    await t2()
    expect(n1).toBe(1)
  })
})

describe('hasPendingSaves（批D·根因2·会话过期跳登录前的未保存编辑探测）', () => {
  it('大白话：无任何在途/待补存的共享槽位时返回 false', async () => {
    const key = 'hp-idle-' + Math.random()
    const trigger = serialSave(async () => {}, key)
    await trigger() // 跑完即归于 idle
    expect(hasPendingSaves()).toBe(false)
  })

  it('大白话：有共享槽位在途（未落盘的自动保存请求）时返回 true', async () => {
    const key = 'hp-running-' + Math.random()
    let release!: () => void
    const trigger = serialSave(() => new Promise<void>((r) => (release = r)), key)
    const p = trigger()
    expect(hasPendingSaves()).toBe(true) // 请求还没回包
    release()
    await p
    expect(hasPendingSaves()).toBe(false) // 回包且无补存后归于 idle
  })

  it('大白话：有共享槽位标脏（排队等补存）时也算「有未保存编辑」', async () => {
    const key = 'hp-dirty-' + Math.random()
    let release!: () => void
    const trigger = serialSave(() => new Promise<void>((r) => (release = r)), key)
    void trigger()
    void trigger() // 在途再触发·标脏
    expect(hasPendingSaves()).toBe(true)
    release()
    await new Promise((r) => setTimeout(r, 0))
  })
})
