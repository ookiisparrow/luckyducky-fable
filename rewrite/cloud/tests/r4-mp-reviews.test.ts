// 写评价的两处收口：
// ① 文字没过内容安全要回和图片不同的码——否则小程序把它说成「图片没检查成功，稍后再试」，没传图的用户只会反复重试；
// ② 晒图只收本人这张订单目录下的文件（小程序上传到 reviews/<订单号>/，订单归属云端已核）——否则填一个别处的
//    fileID（付费视频、别人的节点照片、商品图），服务端会用管理权限整个下载去审，被挑上墙时还会换成公开地址。
import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main as app } from '../src/functions/app/index'

const call = (data: Record<string, unknown>) => app({ action: 'submitReview', data }) as Promise<any>
const base = { orderId: 'o1', lineId: 'p1__红', rating: 5 }
const own = (name: string) => `cloud://env.x/reviews/o1/${name}`

beforeEach(() => {
  control.reset()
  control.setOpenId('oME')
  control.seed('orders', [
    { _id: 'o1', id: 'o1', _openid: 'oME', status: 'done', items: [{ productId: 'p1', lineId: 'p1__红', spec: '红', qty: 1 }] },
    { _id: 'oOther', id: 'oOther', _openid: 'oOTHER', status: 'done', items: [{ productId: 'p1', lineId: 'p1__红', spec: '红', qty: 1 }] },
  ])
})

describe('submitReview：文字与图片审核失败分开报', () => {
  // 待 kit/contentsec msgSecCheck 违规分支改回 TEXT_RISKY（现在违规和接口抖动都回 SEC_CHECK_FAIL，reviews 分不开）：
  // kit 改完这条会「意外通过」而红，届时把 it.fails 换成 it。
  it.fails('大白话：文字含违规内容——回 TEXT_RISKY，不是图片那两个码；一条不落', async () => {
    control.setOpenapiFail(true, 87014)
    const r = await call({ ...base, text: '违规文字' })
    expect(r).toEqual({ ok: false, error: 'TEXT_RISKY' })
    expect(control.dump('reviews')).toEqual([])
  })

  it('大白话：文字审核接口抖动/能力没开——回 SEC_CHECK_FAIL（稍后再试），不说文字不合适让人白改；一条不落', async () => {
    control.setOpenapiFail(true)
    const r = await call({ ...base, text: '很可爱的小鸭' })
    expect(r).toEqual({ ok: false, error: 'SEC_CHECK_FAIL' })
    expect(control.dump('reviews')).toEqual([])
  })

  it('大白话：只传图、图违规——仍回 IMG_RISKY；图校不了——仍回 SEC_CHECK_FAIL', async () => {
    control.setOpenapiFail(true, 87014)
    expect((await call({ ...base, photos: [own('a.jpg')] })).error).toBe('IMG_RISKY')
    control.setOpenapiFail(true)
    expect((await call({ ...base, photos: [own('a.jpg')] })).error).toBe('SEC_CHECK_FAIL')
    expect(control.dump('reviews')).toEqual([])
  })
})

describe('submitReview：晒图只收本人这张订单目录下的文件', () => {
  it('大白话：本单目录下的图——照收', async () => {
    expect((await call({ ...base, photos: [own('a.jpg'), own('b.jpg')] })).ok).toBe(true)
    expect(control.dump('reviews')[0].photos).toEqual([own('a.jpg'), own('b.jpg')])
  })

  it('大白话：混进一张别处的文件——整条拒 FILE_NOT_OWNED，一张都不去下载审核，也不落库', async () => {
    const outside = [
      'cloud://env.x/videos/course1/seg1.mp4', // 付费视频
      'cloud://env.x/checkpoints/oOTHER/x.jpg', // 别人的节点照片
      'cloud://env.x/products/p1.jpg', // 商品图
      'cloud://env.x/reviews/oOther/a.jpg', // 别人订单目录
      'cloud://env.x/reviews/a.jpg', // 不带订单号的旧平铺路径
      'cloud://env.x/reviews/o1/sub/a.jpg', // 本单目录下再套一层
      'cloud://env.x/reviews/o1/', // 只有目录
      'https://evil.example/reviews/o1/a.jpg', // 不是云存储
    ]
    for (const bad of outside) {
      const r = await call({ ...base, photos: [own('a.jpg'), bad] })
      expect(r, bad).toEqual({ ok: false, error: 'BAD_ARGS:FILE_NOT_OWNED' })
    }
    expect(control.openapiCalls()).toEqual([])
    expect(control.dump('reviews')).toEqual([])
  })

  it('大白话：拿别人的订单号当目录也没用——那张单不是我的，照样查无此单', async () => {
    const r = await call({ orderId: 'oOther', lineId: 'p1__红', rating: 5, photos: ['cloud://env.x/reviews/oOther/a.jpg'] })
    expect(r.error).toBe('NOT_FOUND')
    expect(control.openapiCalls()).toEqual([])
  })
})
