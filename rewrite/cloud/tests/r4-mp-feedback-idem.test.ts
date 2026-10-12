// 意见反馈是非幂等写：小程序等不到回包（超时）解锁后用户再点一次，云端其实已经写过——同一次提交的重交
// 必须只落一条。小程序每次提交带一个幂等键（内容不变的重交复用同一个），云端按它算确定性 _id 去重。
import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main as app } from '../src/functions/app/index'

const submit = (data: Record<string, unknown>) => app({ action: 'submitFeedback', data }) as Promise<any>

beforeEach(() => {
  control.reset()
  control.setOpenId('oME')
})

describe('submitFeedback 幂等键去重', () => {
  it('大白话：同一个键重交两次——都回成功，库里只有一条', async () => {
    expect(await submit({ content: '按钮点不动', idempotencyKey: 'k1' })).toEqual({ ok: true })
    expect(await submit({ content: '按钮点不动', idempotencyKey: 'k1' })).toEqual({ ok: true })
    expect(control.dump('feedback')).toHaveLength(1)
  })

  it('大白话：换了键（改了内容再交）——各算一条', async () => {
    await submit({ content: '按钮点不动', idempotencyKey: 'k1' })
    await submit({ content: '按钮还是点不动', idempotencyKey: 'k2' })
    expect(control.dump('feedback').map((d: any) => d.content)).toEqual(['按钮点不动', '按钮还是点不动'])
  })

  it('大白话：别人用同一个键不会被当成我的重交', async () => {
    await submit({ content: '我的反馈', idempotencyKey: 'k1' })
    control.setOpenId('oOther')
    await submit({ content: '别人的反馈', idempotencyKey: 'k1' })
    expect(control.dump('feedback')).toHaveLength(2)
  })

  it('大白话：集合还没建时带键写——建集合后照样落一条', async () => {
    control.markUncreated('feedback')
    expect(await submit({ content: '按钮点不动', idempotencyKey: 'k1' })).toEqual({ ok: true })
    expect(control.dump('feedback')).toHaveLength(1)
  })

  it('大白话：带键但写不进去——回 INTERNAL，不装成功', async () => {
    control.setBeforeAdd(({ coll }: any) => {
      if (coll === 'feedback') throw new Error('MOCK_ADD_FAIL')
    })
    expect(await submit({ content: '按钮点不动', idempotencyKey: 'k1' })).toEqual({ ok: false, error: 'INTERNAL' })
    expect(control.dump('feedback')).toEqual([])
  })

  it('大白话：旧版小程序不带键——照旧每次各写一条', async () => {
    await submit({ content: '按钮点不动' })
    await submit({ content: '按钮点不动' })
    expect(control.dump('feedback')).toHaveLength(2)
  })
})
