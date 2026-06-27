import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main } from '../../packages/cloud/src/functions/catalog/submitReview'

// submitReview 闸门：openid + 订单归属 + 已完成 + 商品在单内 + 一单一品一评 + 昵称快照/匿名。
beforeEach(() => {
  control.reset()
  control.setOpenId('user-A')
  control.seed('orders', [
    { _id: 'o1', id: 'o1', _openid: 'user-A', status: 'done', items: [{ productId: 'prod-1', name: '小棉鸭', spec: '雾霭蓝' }] },
  ])
  control.seed('users', [{ _id: 'u1', _openid: 'user-A', nickname: '圆圆' }])
})

const base = { orderId: 'o1', productId: 'prod-1', rating: 5, tags: ['很可爱'], text: '好评' }

describe('submitReview 闸门', () => {
  it('NO_OPENID / BAD_RATING', async () => {
    control.setOpenId('')
    expect((await main(base)).error).toBe('NO_OPENID')
    control.setOpenId('user-A')
    expect((await main({ ...base, rating: 6 })).error).toBe('BAD_RATING')
    expect((await main({ ...base, rating: 0 })).error).toBe('BAD_RATING')
  })

  it('NOT_FOUND：他人订单不可评', async () => {
    control.setOpenId('user-B')
    expect((await main(base)).error).toBe('NOT_FOUND')
  })

  it('NOT_DONE：订单未完成不可评', async () => {
    control.reset()
    control.setOpenId('user-A')
    control.seed('orders', [{ _id: 'o1', id: 'o1', _openid: 'user-A', status: 'paid', items: [{ productId: 'prod-1' }] }])
    expect((await main(base)).error).toBe('NOT_DONE')
  })

  it('NOT_IN_ORDER：商品不在该订单条目内', async () => {
    expect((await main({ ...base, productId: 'prod-9' })).error).toBe('NOT_IN_ORDER')
  })

  it('成功：昵称取云端快照，评价落库', async () => {
    expect(await main(base)).toEqual({ ok: true })
    const reviews = control.dump('reviews')
    expect(reviews).toHaveLength(1)
    expect(reviews[0]).toMatchObject({ productId: 'prod-1', name: '圆圆', rating: 5, spec: '雾霭蓝' })
  })

  it('一单一品一评：重复提交 REVIEWED（库级唯一约束）', async () => {
    expect(await main(base)).toEqual({ ok: true })
    expect((await main(base)).error).toBe('REVIEWED')
    expect(control.dump('reviews')).toHaveLength(1)
  })

  it('匿名：昵称存「匿名钩友」', async () => {
    await main({ ...base, anon: true })
    expect(control.dump('reviews')[0].name).toBe('匿名钩友')
  })

  it('同商品多 SKU：两行按 lineId 各自评价（外审 P1.1·不再 REVIEWED 撞）', async () => {
    control.reset()
    control.setOpenId('user-A')
    control.seed('users', [{ _id: 'u1', _openid: 'user-A', nickname: '圆圆' }])
    control.seed('orders', [
      {
        _id: 'o5', id: 'o5', _openid: 'user-A', status: 'done',
        items: [
          { productId: 'kit-1', lineId: 'kit-1__红', name: '材料包', spec: '红' },
          { productId: 'kit-1', lineId: 'kit-1__蓝', name: '材料包', spec: '蓝' },
        ],
      },
    ])
    expect(await main({ orderId: 'o5', lineId: 'kit-1__红', rating: 5, text: '红款好' })).toEqual({ ok: true })
    expect(await main({ orderId: 'o5', lineId: 'kit-1__蓝', rating: 4, text: '蓝款也好' })).toEqual({ ok: true }) // 旧版同 productId 会 REVIEWED
    const reviews = control.dump('reviews').filter((r) => r.orderId === 'o5')
    expect(reviews.map((r) => r._id).sort()).toEqual(['o5__kit-1__红', 'o5__kit-1__蓝'])
    expect(reviews.every((r) => r.productId === 'kit-1' && r.lineId)).toBe(true)
  })
})
