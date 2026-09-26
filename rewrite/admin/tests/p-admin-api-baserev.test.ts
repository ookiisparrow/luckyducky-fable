// 乐观并发的版本号必须真的发到后端：api 层丢了 baseRev，云端就不做版本比对，两个窗口会互相静默覆盖。
import { describe, it, expect, vi } from 'vitest'

const { postMock } = vi.hoisted(() => ({ postMock: vi.fn().mockResolvedValue({ ok: true }) }))
vi.mock('../src/api/index', () => ({ client: { post: postMock } }))

import { saveHelpVideos } from '../src/api/content'
import { saveCheckpoints } from '../src/api/cs'

describe('api 层透传 baseRev', () => {
  it('大白话：保存帮助视频、保存节点都把拉取时的版本号带上', async () => {
    await saveHelpVideos([{ id: 't1' }], 3)
    expect(postMock).toHaveBeenLastCalledWith('saveHelpVideos', { items: [{ id: 't1' }], baseRev: 3 })
    await saveCheckpoints('course-duck', [{ nodeId: 'n1' }], 7)
    expect(postMock).toHaveBeenLastCalledWith('saveCheckpoints', { courseId: 'course-duck', nodes: [{ nodeId: 'n1' }], baseRev: 7 })
  })
})
