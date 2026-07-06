// 乱序响应守卫 useLatest（守卫 rw-admin-latest-golden·治 async-race 类·根因#8「构建过≠真能用」——
// 单测/类型查不出、并发真用才现）：页面用共享 ref 承接可被多次触发的异步取数（reload/筛选/翻页/抽屉详情），
// 旧请求后到会覆盖新结果 → 标签/抽屉头与内容错配。用法：进函数 begin() 取号，await 后 isStale(号) 则丢弃。
import { describe, it, expect } from 'vitest'
import { useLatest } from '../src/lib/latest'

describe('useLatest（乱序响应守卫·只认最新一次·根因#8）', () => {
  it('大白话：第二次 begin 后，第一次的号变过期、第二次的号仍最新——旧请求后到必被丢弃', () => {
    const g = useLatest()
    const a = g.begin() // 请求 A 发起
    const b = g.begin() // 请求 B 发起（更晚）
    expect(g.isStale(a)).toBe(true) // A 后到也丢弃·不覆盖 B
    expect(g.isStale(b)).toBe(false) // B 是最新·采用
  })

  it('大白话：只有一次在途时不判过期', () => {
    const g = useLatest()
    const t = g.begin()
    expect(g.isStale(t)).toBe(false)
  })

  it('大白话：两个独立 useLatest 实例互不干扰（不同操作各自计数）', () => {
    const list = useLatest()
    const drawer = useLatest()
    const l = list.begin()
    drawer.begin() // 抽屉发起不该让列表的号过期
    expect(list.isStale(l)).toBe(false)
  })
})
