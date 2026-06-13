import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main as getCourses } from '../../packages/cloud/src/functions/learning/getCourses'
import { main as getPlaybackUrl } from '../../packages/cloud/src/functions/learning/getPlaybackUrl'

// 课程视频服务端保护（审计 P1）：目录不漏 fileID；播放地址须 free 或已确认进课。
const COURSE = {
  _id: 'course-duck',
  id: 'course-duck',
  title: '小鸭',
  sort: 0,
  chapters: [
    {
      id: 'c1',
      title: 'ch',
      lessons: [
        {
          id: 'l1',
          name: 'lesson',
          dur: '03:20',
          segments: [
            { id: 'l1-s1', name: '免费段', dur: '00:40', free: true, videoFileId: 'cloud://free.mp4' },
            { id: 'l1-s2', name: '付费段', dur: '00:40', free: false, videoFileId: 'cloud://paid.mp4' },
            { id: 'l1-s3', name: '未剪段', dur: '00:40', free: false, videoFileId: null },
          ],
        },
      ],
    },
  ],
}

beforeEach(() => {
  control.reset()
  control.setOpenId('user-A')
  control.seed('courses', [COURSE])
})

describe('getCourses 目录不漏 videoFileId（审计 P1）', () => {
  it('段只返回 hasVideo/free，不含 videoFileId；全返回无 cloud:// fileID', async () => {
    const res = await getCourses()
    const segs = res.list[0].chapters[0].lessons[0].segments
    expect(segs[0]).toMatchObject({ id: 'l1-s1', free: true, hasVideo: true })
    expect(segs[0].videoFileId).toBeUndefined()
    expect(segs[2]).toMatchObject({ free: false, hasVideo: false }) // 未剪段
    expect(JSON.stringify(res)).not.toContain('cloud://')
  })
})

describe('getPlaybackUrl 鉴权（审计 P1）', () => {
  it('免费段：任何登录用户可取地址', async () => {
    const res = await getPlaybackUrl({ courseId: 'course-duck', segmentId: 'l1-s1' })
    expect(res.ok).toBe(true)
    expect(res.url).toContain('tmp')
  })

  it('付费段 + 未确认进课：NOT_ENTITLED（白嫖被挡）', async () => {
    expect((await getPlaybackUrl({ courseId: 'course-duck', segmentId: 'l1-s2' })).error).toBe('NOT_ENTITLED')
  })

  it('付费段 + 已确认进课：放行发地址', async () => {
    control.seed('activations', [{ _openid: 'user-A', courseId: 'course-duck', code: 'X', enteredAt: Date.now() }])
    const res = await getPlaybackUrl({ courseId: 'course-duck', segmentId: 'l1-s2' })
    expect(res.ok).toBe(true)
    expect(res.url).toBeTruthy()
  })

  it('付费段 + 仅激活未确认（enteredAt=null）：仍 NOT_ENTITLED', async () => {
    control.seed('activations', [{ _openid: 'user-A', courseId: 'course-duck', code: 'X', enteredAt: null }])
    expect((await getPlaybackUrl({ courseId: 'course-duck', segmentId: 'l1-s2' })).error).toBe('NOT_ENTITLED')
  })

  it('未剪段（videoFileId 空）：url=null', async () => {
    control.seed('activations', [{ _openid: 'user-A', courseId: 'course-duck', code: 'X', enteredAt: Date.now() }])
    const res = await getPlaybackUrl({ courseId: 'course-duck', segmentId: 'l1-s3' })
    expect(res.ok).toBe(true)
    expect(res.url).toBe(null)
  })

  it('NO_OPENID / BAD_ARGS / NO_SEGMENT', async () => {
    control.setOpenId('')
    expect((await getPlaybackUrl({ courseId: 'course-duck', segmentId: 'l1-s1' })).error).toBe('NO_OPENID')
    control.setOpenId('user-A')
    expect((await getPlaybackUrl({ courseId: 'course-duck' })).error).toBe('BAD_ARGS')
    expect((await getPlaybackUrl({ courseId: 'course-duck', segmentId: 'nope' })).error).toBe('NO_SEGMENT')
  })
})
