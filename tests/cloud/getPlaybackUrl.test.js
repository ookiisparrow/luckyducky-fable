import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main as getCourses } from '../../packages/cloud/src/functions/learning/getCourses'
import { main as getPlaybackUrl } from '../../packages/cloud/src/functions/learning/getPlaybackUrl'

// 课程视频服务端保护（审计 P1）：目录不漏 fileID；播放地址一律须本人已确认进课。
// 试看（segment.free）已整条撤除（用户拍板 2026-07-03·守卫 free-trial-extinct）：
// 不再有「免费段登录即看」通道；旧库文档残留的 free:true 也不放行（stale 字段不构成授权）。
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
            // free:true = 模拟撤除前发布的旧库残留字段——授权闸必须无视它
            { id: 'l1-s1', name: '旧免费段', dur: '00:40', free: true, videoFileId: 'cloud://free.mp4' },
            { id: 'l1-s2', name: '正常段', dur: '00:40', videoFileId: 'cloud://paid.mp4' },
            { id: 'l1-s3', name: '未剪段', dur: '00:40', videoFileId: null },
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
  it('段只返回 id/name/dur/hasVideo，不含 videoFileId 也不含 free；全返回无 cloud:// fileID', async () => {
    const res = await getCourses()
    const segs = res.list[0].chapters[0].lessons[0].segments
    expect(segs[0]).toMatchObject({ id: 'l1-s1', hasVideo: true })
    expect(segs[0].videoFileId).toBeUndefined()
    expect(segs[0].free).toBeUndefined() // 试看已撤除：旧库残留 free 不再出公开目录
    expect(segs[2]).toMatchObject({ hasVideo: false }) // 未剪段
    expect(JSON.stringify(res)).not.toContain('cloud://')
  })
})

describe('getPlaybackUrl 鉴权（审计 P1·试看撤除后全段需进课）', () => {
  it('未确认进课：任何段一律 NOT_ENTITLED（含旧库残留 free:true 的段·stale 字段不构成授权）', async () => {
    expect((await getPlaybackUrl({ courseId: 'course-duck', segmentId: 'l1-s1' })).error).toBe('NOT_ENTITLED')
    expect((await getPlaybackUrl({ courseId: 'course-duck', segmentId: 'l1-s2' })).error).toBe('NOT_ENTITLED')
  })

  it('已确认进课：放行发地址（含旧 free 段）', async () => {
    control.seed('activations', [{ _openid: 'user-A', courseId: 'course-duck', code: 'X', enteredAt: Date.now() }])
    const r1 = await getPlaybackUrl({ courseId: 'course-duck', segmentId: 'l1-s1' })
    expect(r1.ok).toBe(true)
    expect(r1.url).toContain('tmp')
    const r2 = await getPlaybackUrl({ courseId: 'course-duck', segmentId: 'l1-s2' })
    expect(r2.ok).toBe(true)
    expect(r2.url).toBeTruthy()
  })

  it('仅激活未确认（enteredAt=null）：仍 NOT_ENTITLED', async () => {
    control.seed('activations', [{ _openid: 'user-A', courseId: 'course-duck', code: 'X', enteredAt: null }])
    expect((await getPlaybackUrl({ courseId: 'course-duck', segmentId: 'l1-s2' })).error).toBe('NOT_ENTITLED')
  })

  it('未剪段（videoFileId 空）：已进课取 url=null', async () => {
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
