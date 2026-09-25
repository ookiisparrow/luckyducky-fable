// 锁现行为：意见反馈写库——集合未建先建再写；首写失败重试一次；重试也失败如实回 INTERNAL（反馈须失败可见）。
import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main as app } from '../src/functions/app/index'

const submit = () => app({ action: 'submitFeedback', data: { content: '按钮点不动' } }) as Promise<any>

beforeEach(() => {
  control.reset()
  control.setOpenId('oME')
})

describe('submitFeedback 写库', () => {
  it('集合未建：建集合后写入成功', async () => {
    control.markUncreated('feedback')
    expect(await submit()).toEqual({ ok: true })
    expect(control.dump('feedback')).toHaveLength(1)
  })

  it('首写失败：重试一次写入成功', async () => {
    let n = 0
    control.setBeforeAdd(({ coll }: any) => {
      if (coll === 'feedback' && n++ === 0) throw new Error('MOCK_ADD_FAIL')
    })
    expect(await submit()).toEqual({ ok: true })
    expect(n).toBe(2)
    expect(control.dump('feedback')).toHaveLength(1)
  })

  it('重试也失败：回 INTERNAL，不装成功', async () => {
    control.setBeforeAdd(({ coll }: any) => {
      if (coll === 'feedback') throw new Error('MOCK_ADD_FAIL')
    })
    expect(await submit()).toEqual({ ok: false, error: 'INTERNAL' })
    expect(control.dump('feedback')).toEqual([])
  })
})
