import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main } from '../../packages/cloud/src/functions/learning/getMyCourses'

// getMyCourses（进课唯一闸 + 同课去重，learning 域）。
beforeEach(() => {
  control.reset()
  control.setOpenId('u1')
})

describe('getMyCourses', () => {
  it('NO_OPENID（fail-closed）', async () => {
    control.setOpenId('')
    expect((await main({})).error).toBe('NO_OPENID')
  })

  it('只返回已确认（enteredAt 非空）的课，同课多码取最早 enteredAt，他人不返回', async () => {
    control.seed('activations', [
      { _openid: 'u1', courseId: 'course-duck', enteredAt: 200 },
      { _openid: 'u1', courseId: 'course-duck', enteredAt: 100 }, // 同课更早
      { _openid: 'u1', courseId: 'course-bear', enteredAt: null }, // 未确认，不返回
      { _openid: 'u2', courseId: 'course-duck', enteredAt: 50 }, // 他人，不返回
    ])
    const res = await main({})
    expect(res.list).toHaveLength(1)
    expect(res.list[0]).toEqual({ courseId: 'course-duck', enteredAt: 100 })
  })
})
