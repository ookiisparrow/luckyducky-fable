// 黄金 orderCounts/refundCounts partial（守卫 rw-counts-partial-golden·bug sweep Round1 item7·病根#14）：
// 服务端两个计数 action 原先 `.count().catch(()=>0)` 把「查询失败」静默兜成「真为 0」，前端据此测不出
// partial——本文件直接调用纯 action 函数（同 ops-console.test.ts 范式，不经 adminApi 鉴权层），用自造的
// 假 db（wx-server-sdk 内存桩 count() 从不失败、无法在桩层制造失败）模拟「某状态 count() 失败」，
// 断言回包带 partial:true；全路成功时 partial:false（不误报）。
import { describe, it, expect } from 'vitest'
import { orderCounts } from '../src/functions/adminApi/actions/orders'
import { refundCounts } from '../src/functions/adminApi/actions/refunds'

// 造一个最小 db：collection().where(cond).count() 按 shouldFail(cond) 决定成功/失败；createCollection 空操作。
function fakeCountDb(shouldFail: (filter: any) => boolean, total = 2) {
  return {
    collection: (_name: string) => {
      const q: any = {
        _filter: null,
        where(cond: any) {
          q._filter = cond
          return q
        },
        count: async () => {
          if (shouldFail(q._filter)) throw new Error('MOCK_COUNT_FAIL')
          return { total }
        },
      }
      return q
    },
    createCollection: async () => {},
  }
}

const body = (res: any) => JSON.parse(res.body)

describe('orderCounts partial（P1·item7：后端别把「查失败」悄悄兜成 0 骗前端）', () => {
  it('大白话：某个状态的 count() 失败——回包仍是 ok:true（不拖累整包），但带 partial:true，该状态计数占位 0 不可信', async () => {
    const r = body(await orderCounts({ db: fakeCountDb((f) => f && f.status === 'shipped') } as any))
    expect(r.ok).toBe(true)
    expect(r.partial).toBe(true)
    expect(r.counts.shipped).toBe(0) // 失败路占位 0——但 partial 已标记「不可信」，前端不得当真值显示
    expect(r.counts.all).toBe(2) // 其余路仍是真值
  })

  it('大白话：全部状态 count() 都成功时 partial:false（不误报·真没问题就该显真待办）', async () => {
    const r = body(await orderCounts({ db: fakeCountDb(() => false) } as any))
    expect(r.ok).toBe(true)
    expect(r.partial).toBe(false)
  })
})

describe('refundCounts partial（P1·item7：同 orderCounts 治法）', () => {
  it('大白话：某个状态的 count() 失败——partial:true', async () => {
    const r = body(await refundCounts({ db: fakeCountDb((f) => f && f.status === 'applied') } as any))
    expect(r.ok).toBe(true)
    expect(r.partial).toBe(true)
  })

  it('大白话：全部成功时 partial:false', async () => {
    const r = body(await refundCounts({ db: fakeCountDb(() => false) } as any))
    expect(r.partial).toBe(false)
  })
})
