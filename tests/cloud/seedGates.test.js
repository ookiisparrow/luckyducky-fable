import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main as seedProducts } from '../../packages/cloud/src/functions/catalog/seedProducts'
import { main as seedCourses } from '../../packages/cloud/src/functions/learning/seedCourses'
import { main as initDb } from '../../packages/cloud/src/functions/system/initDb'
import { COLLECTIONS } from '../../packages/cloud/src/kit'

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

  it('initDb：清单＝kit COLLECTIONS 单源全量（根因#5·防老清单漂移致新集合「动态建→控制台锁不了」窗口）', async () => {
    control.setOpenId('')
    const r = await initDb({})
    const names = Object.keys(r.result)
    expect(names.sort()).toEqual(Object.values(COLLECTIONS).sort()) // 全量对齐单源·加集合不用改 initDb
    expect(names).toContain('csSession') // 承面C 两新集合在册（本 bug 的直接回归锁）
    expect(names).toContain('agentState')
  })
})
