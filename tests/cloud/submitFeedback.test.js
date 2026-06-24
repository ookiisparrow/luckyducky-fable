import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main } from '../../packages/cloud/src/functions/feedback/submitFeedback'

// submitFeedback（feedback 域·运营钩子①·待办#23）：用户意见反馈写 feedback 集合。
// 行为不变量：写库过闸（withOpenId fail-closed·根因#3）+ 限频（withRateLimit·根因#13）+ 白名单/截断（不信前端）。
beforeEach(() => {
  control.reset()
  control.setOpenId('u1')
})

describe('submitFeedback', () => {
  it('NO_OPENID（无可信身份 fail-closed·根因#3 反向自检）', async () => {
    control.setOpenId('')
    expect((await main({ content: 'x' })).error).toBe('NO_OPENID')
  })

  it('EMPTY_FEEDBACK（content 空 / 非串 / 仅空白都拒）', async () => {
    expect((await main({})).error).toBe('EMPTY_FEEDBACK')
    expect((await main({ content: '   ' })).error).toBe('EMPTY_FEEDBACK')
    expect((await main({ content: 123 })).error).toBe('EMPTY_FEEDBACK')
    expect(control.dump('feedback')).toHaveLength(0) // 一条都没落库
  })

  it('正常反馈落库 feedback（绑本人 _openid + 字段白名单 + 默认分类 other）', async () => {
    const r = await main({ content: '播放卡顿', contact: 'wx123' })
    expect(r.ok).toBe(true)
    const f = control.dump('feedback')
    expect(f).toHaveLength(1)
    expect(f[0]._openid).toBe('u1') // 云端写本人 openid，不信前端
    expect(f[0].content).toBe('播放卡顿')
    expect(f[0].contact).toBe('wx123')
    expect(f[0].category).toBe('other') // 未传 → other
    expect(typeof f[0].createdAt).toBe('number')
  })

  it('category 白名单：枚举内保留、越界归 other', async () => {
    await main({ content: 'a', category: 'bug' })
    await main({ content: 'b', category: '注入' })
    const f = control.dump('feedback')
    expect(f.find((x) => x.content === 'a').category).toBe('bug')
    expect(f.find((x) => x.content === 'b').category).toBe('other') // 越界归 other
  })

  it('content 超长截断到 500（不信前端·不撑爆库）', async () => {
    await main({ content: 'x'.repeat(600) })
    expect(control.dump('feedback')[0].content).toHaveLength(500)
  })

  it('限频：单用户超 10 次/分即 RATE_LIMITED（根因#13·withRateLimit）', async () => {
    for (let i = 0; i < 10; i++) {
      expect((await main({ content: 'spam' })).error).toBeUndefined()
    }
    expect((await main({ content: 'spam' })).error).toBe('RATE_LIMITED')
    expect(control.dump('feedback')).toHaveLength(10) // 第 11 条被频控挡、未落库
  })
})
