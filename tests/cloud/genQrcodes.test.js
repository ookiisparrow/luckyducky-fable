import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main } from '../../cloudfunctions/genQrcodes/index.js'

// genQrcodes 闸门：管理通道判定（无 openid=CLI/控制台放行；客户端须 isAdmin）+ 防废码 + 码唯一。
beforeEach(() => {
  control.reset()
  control.seed('courses', [{ _id: 'course-duck', id: 'course-duck', title: '小鸭课' }])
})

describe('genQrcodes 闸门', () => {
  it('管理通道（无 openid）：放行生成', async () => {
    control.setOpenId('')
    const res = await main({ courseId: 'course-duck', count: 3 })
    expect(res.ok).toBe(true)
    expect(res.count).toBe(3)
    expect(control.dump('qrcodes')).toHaveLength(3)
  })

  it('客户端非管理员：ADMIN_ONLY', async () => {
    control.setOpenId('user-A')
    control.seed('users', [{ _id: 'u1', _openid: 'user-A', isAdmin: false }])
    expect((await main({ courseId: 'course-duck', count: 3 })).error).toBe('ADMIN_ONLY')
    expect(control.dump('qrcodes')).toHaveLength(0)
  })

  it('客户端管理员：放行生成', async () => {
    control.setOpenId('admin-1')
    control.seed('users', [{ _id: 'u2', _openid: 'admin-1', isAdmin: true }])
    expect((await main({ courseId: 'course-duck', count: 2 })).ok).toBe(true)
  })

  it('BAD_ARGS / UNKNOWN_COURSE（防废码）', async () => {
    control.setOpenId('')
    expect((await main({ courseId: '', count: 3 })).error).toBe('BAD_ARGS')
    expect((await main({ courseId: 'course-x', count: 3 })).error).toBe('UNKNOWN_COURSE:course-x')
  })

  it('count 钳制上限 500，码 _id 唯一', async () => {
    control.setOpenId('')
    const res = await main({ courseId: 'course-duck', count: 9999 })
    expect(res.count).toBe(500)
    const ids = control.dump('qrcodes').map((q) => q._id)
    expect(new Set(ids).size).toBe(500) // 全唯一
  })
})
