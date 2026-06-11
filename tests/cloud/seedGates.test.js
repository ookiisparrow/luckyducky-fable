import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main as seedProducts } from '../../cloudfunctions/seedProducts/index.js'
import { main as seedCourses } from '../../cloudfunctions/seedCourses/index.js'
import { main as initDb } from '../../cloudfunctions/initDb/index.js'

// 锁定定向审核修复（A-1）：seed/init 客户端须 isAdmin，CLI/控制台无 openid 放行。
// 防任意登录用户 callFunction 覆盖生产商品/课程数据。
beforeEach(() => control.reset())

describe('seed/init 管理闸（审计修复 A-1 回归锁）', () => {
  it('seedProducts：无 openid 放行、非管理员拒、管理员放行', async () => {
    control.setOpenId('')
    expect((await seedProducts({})).ok).toBe(true)
    expect(control.dump('products').length).toBeGreaterThan(0)

    control.reset()
    control.setOpenId('user-A')
    control.seed('users', [{ _id: 'u1', _openid: 'user-A', isAdmin: false }])
    expect((await seedProducts({})).error).toBe('ADMIN_ONLY')
    expect(control.dump('products')).toHaveLength(0) // 没写库

    control.reset()
    control.setOpenId('admin-1')
    control.seed('users', [{ _id: 'u2', _openid: 'admin-1', isAdmin: true }])
    expect((await seedProducts({})).ok).toBe(true)
  })

  it('seedCourses：非管理员客户端拒', async () => {
    control.setOpenId('user-A')
    control.seed('users', [{ _id: 'u1', _openid: 'user-A', isAdmin: false }])
    expect((await seedCourses({})).error).toBe('ADMIN_ONLY')
    expect(control.dump('courses')).toHaveLength(0)
  })

  it('initDb：无 openid 放行、非管理员拒', async () => {
    control.setOpenId('')
    expect((await initDb({})).ok).toBe(true)

    control.reset()
    control.setOpenId('user-A')
    control.seed('users', [{ _id: 'u1', _openid: 'user-A', isAdmin: false }])
    expect((await initDb({})).error).toBe('ADMIN_ONLY')
  })
})
