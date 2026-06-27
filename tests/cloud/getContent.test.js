import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main } from '../../packages/cloud/src/functions/catalog/getContent'

// getContent（catalog 域）：只读公开首页内容；无记录返回 null（前端回退默认文案）。
// 系统事实登记此函数原「未见独立测试」，本用例补齐契约锁。
beforeEach(() => control.reset())

describe('getContent', () => {
  it('无 content/home 记录：返回 home:null（前端回退默认）', async () => {
    const res = await main()
    expect(res.ok).toBe(true)
    expect(res.home).toBe(null)
  })

  it('有记录：返回 home 文档', async () => {
    control.seed('content', [{ _id: 'home', hero: { title: '小棉鸭' }, faq: [] }])
    const res = await main()
    expect(res.ok).toBe(true)
    expect(res.home).toMatchObject({ _id: 'home', hero: { title: '小棉鸭' } })
  })
})
