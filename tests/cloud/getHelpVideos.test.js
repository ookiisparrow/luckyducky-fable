import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main } from '../../packages/cloud/src/functions/catalog/getHelpVideos'

// getHelpVideos（catalog 域·公开读，求助面板「辅助视频」全局共用·两级：主题→小段）：
// 审计 P1 契约锁——videoFileId 不出接口，每个小段按 fileID 换短时临时 URL（url）下发；
// 无记录 → 空列表；某小段无视频 → url:null。
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

  it('有记录：两级（主题→小段）；小段换临时 URL 下发，不漏 videoFileId（审计 P1）', async () => {
    control.seed('content', [
      {
        _id: 'helpVideos',
        items: [
          {
            id: 'h1',
            title: '如何制作一个开始结',
            sub: '第一针的滑结',
            desc: '示范',
            segments: [
              { id: 's1', name: '滑结', dur: '00:30', videoFileId: 'cloud://v1' },
              { id: 's2', name: '收紧', dur: '00:20', videoFileId: '' }, // 无视频
            ],
          },
        ],
      },
    ])
    const res = await main({})
    expect(res.ok).toBe(true)
    expect(res.items).toHaveLength(1)
    const topic = res.items[0]
    // 主题层：原样下发文案，不含 videoFileId
    expect(topic).toMatchObject({ id: 'h1', title: '如何制作一个开始结', sub: '第一针的滑结' })
    expect(topic).not.toHaveProperty('videoFileId')
    // 小段层：换临时 URL（mock 桩 https://tmp/<fileId>），且不含 videoFileId 字段
    expect(topic.segments).toHaveLength(2)
    expect(topic.segments[0]).toMatchObject({ id: 's1', name: '滑结', dur: '00:30' })
    expect(topic.segments[0].url).toBe('https://tmp/cloud://v1')
    expect(topic.segments[0]).not.toHaveProperty('videoFileId')
    expect(topic.segments[1].url).toBe(null) // 无视频小段
  })
})
