import { describe, it, expect, beforeEach } from 'vitest'
import cloud, { control } from 'wx-server-sdk'
import { main } from '../../packages/cloud/src/functions/cs/dataConsent'
import { assertDataShareConsent } from '../../packages/cloud/src/kit/csAccess'

// 数据共享告知同意写侧（B3.3·承面C 车道 C·守卫 cs-data-share-consented）：用户同意 + 可撤回·只写本人。
const db = cloud.database()
beforeEach(() => {
  control.reset()
  control.setOpenId('user-A')
})

describe('dataConsent 同意/撤回写侧', () => {
  it('NO_OPENID：无身份拒（withOpenId fail-closed·根因#3）', async () => {
    control.setOpenId('')
    expect((await main({ agree: true })).error).toBe('NO_OPENID')
  })
  it('同意 → 首次建档写 users.csDataShare.agreed=true（确定性 _id=openid）', async () => {
    const r = await main({ agree: true })
    expect(r.ok).toBe(true)
    expect(r.agreed).toBe(true)
    const u = control.dump('users').find((x) => x._openid === 'user-A')
    expect(u.csDataShare.agreed).toBe(true)
    expect(u.csDataShare.at).toBeGreaterThan(0)
  })
  it('撤回（agree:false）→ agreed=false（可撤回）', async () => {
    await main({ agree: true })
    const r = await main({ agree: false })
    expect(r.agreed).toBe(false)
    const u = control.dump('users').find((x) => x._openid === 'user-A')
    expect(u.csDataShare.agreed).toBe(false)
  })
  it('已有 users 档 → 更新该档、不重复建档、保留原字段', async () => {
    control.seed('users', [{ _id: 'rnd-1', _openid: 'user-A', nickname: '小棉' }])
    await main({ agree: true })
    const us = control.dump('users').filter((x) => x._openid === 'user-A')
    expect(us.length).toBe(1) // 不重复建档
    expect(us[0].csDataShare.agreed).toBe(true)
    expect(us[0].nickname).toBe('小棉') // 原字段保留
  })
  it('缺 agree → 默认撤回（fail-safe：未显式同意即视为未同意）', async () => {
    expect((await main({})).agreed).toBe(false)
  })
  it('端到端：同意后 assertDataShareConsent 放行、撤回后拒（写侧 ⟷ 读闸一致）', async () => {
    await main({ agree: true })
    expect((await assertDataShareConsent(db, 'user-A')).ok).toBe(true)
    await main({ agree: false })
    expect((await assertDataShareConsent(db, 'user-A')).ok).toBe(false)
  })
})
