import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main } from '../../packages/cloud/src/functions/learning/activateCourse'

// activateCourse 闸门：一码一用（条件更新抢占）+ 他人占用拒绝 + 本人重扫状态。
beforeEach(() => {
  control.reset()
  control.setOpenId('user-A')
  control.seed('qrcodes', [
    { _id: 'LDCODE1', code: 'LDCODE1', courseId: 'course-duck', status: 'unused', activatedBy: null, activatedAt: null },
  ])
})

describe('activateCourse 闸门', () => {
  it('NO_OPENID：未登录拒绝', async () => {
    control.setOpenId('')
    expect((await main({ code: 'LDCODE1' })).error).toBe('NO_OPENID')
  })

  it('INVALID_CODE：码不存在', async () => {
    expect((await main({ code: 'NOPE' })).error).toBe('INVALID_CODE')
  })

  it('首次激活：码翻 activated + 建 activation 行 + state=activated', async () => {
    const res = await main({ code: 'LDCODE1' })
    expect(res).toMatchObject({ ok: true, state: 'activated', courseId: 'course-duck' })
    const qr = control.dump('qrcodes')[0]
    expect(qr.status).toBe('activated')
    expect(qr.activatedBy).toBe('user-A')
    const acts = control.dump('activations')
    expect(acts).toHaveLength(1)
    expect(acts[0]).toMatchObject({ _openid: 'user-A', code: 'LDCODE1', enteredAt: null })
  })

  it('本人重扫未确认：仍 activated（不重复建行）', async () => {
    await main({ code: 'LDCODE1' })
    const res = await main({ code: 'LDCODE1' })
    expect(res.state).toBe('activated')
    expect(control.dump('activations')).toHaveLength(1)
  })

  it('本人已确认（enteredAt 非空）：state=mine', async () => {
    await main({ code: 'LDCODE1' })
    // 模拟已确认进课
    const acts = control.dump('activations')
    control.reset()
    control.setOpenId('user-A')
    control.seed('qrcodes', [{ _id: 'LDCODE1', code: 'LDCODE1', courseId: 'course-duck', status: 'activated', activatedBy: 'user-A' }])
    control.seed('activations', [{ ...acts[0], enteredAt: Date.now() }])
    expect((await main({ code: 'LDCODE1' })).state).toBe('mine')
  })

  it('他人扫已用码：CODE_TAKEN', async () => {
    await main({ code: 'LDCODE1' }) // user-A 激活
    control.setOpenId('user-B')
    expect((await main({ code: 'LDCODE1' })).error).toBe('CODE_TAKEN')
  })
})
