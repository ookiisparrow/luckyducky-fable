import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main } from '../../packages/cloud/src/functions/catalog/getHelpVideos'

// getHelpVideos（catalog 域·公开读，求助面板「辅助视频」全局共用）：审计 P1 契约锁——
// videoFileId 不出接口，服务端按 fileID 换短时效临时 URL（url）下发；无记录 → 空列表；某条无视频 → url:null。
beforeEach(() => {
  control.reset()
  control.setOpenId('user-1') // withOpenId 从云上下文取 OPENID
})

describe('getHelpVideos', () => {
  it('无 content/helpVideos 记录：返回空列表', async () => {
    const res = await main({})
    expect(res.ok).toBe(true)
    expect(res.items).toEqual([])
  })

  it('有记录：换临时 URL 下发，且不漏 videoFileId（审计 P1）', async () => {
    control.seed('content', [
      {
        _id: 'helpVideos',
        items: [
          { id: 'h1', title: '起手结', sub: '第一针', desc: '示范', dur: '01:00', videoFileId: 'cloud://v1' },
          { id: 'h2', title: '拆线重来', sub: '', desc: '', dur: '', videoFileId: '' }, // 无视频
        ],
      },
    ])
    const res = await main({})
    expect(res.ok).toBe(true)
    expect(res.items).toHaveLength(2)
    // 第一条：换成临时 URL（mock 桩 https://tmp/<fileId>），且不含 videoFileId 字段（fileID 不出接口）
    expect(res.items[0].url).toBe('https://tmp/cloud://v1')
    expect(res.items[0]).not.toHaveProperty('videoFileId')
    expect(res.items[0]).toMatchObject({ id: 'h1', title: '起手结', sub: '第一针', dur: '01:00' })
    // 第二条无视频：url 为 null（前端显占位）
    expect(res.items[1].url).toBe(null)
  })
})
