// E2E·播放授权矩阵（跨身份 × 跨函数）：钉「未激活 / 已激活未进课 / 进的是别的课」三种身份取播放地址一律拒，
// 且被拒响应绝不携带任何视频源痕迹（fileId/videoFileId/cloud://）；公开目录 getCourses 递归无视频源（防白名单回归）。
import { describe, it, expect, beforeEach } from 'vitest'
import { control } from 'wx-server-sdk'
import { main as app } from '../src/functions/app/index'

const call = (action: string, data: Record<string, unknown> = {}) => app({ action, data }) as Promise<any>

const mkCourse = (id: string) => ({
  _id: id, id, title: '课-' + id, sort: 1,
  chapters: [
    {
      id: 'ch1', title: '第一章',
      lessons: [
        {
          id: 'l1', name: '第一节', dur: '10:00',
          segments: [
            { id: 's1', name: '起针', dur: '5:00', videoFileId: 'cloud://v/' + id + '-s1.mp4', free: true },
            { id: 's2', name: '长针', dur: '5:00', videoFileId: 'cloud://v/' + id + '-s2.mp4' },
          ],
        },
      ],
    },
  ],
})

const hasVideoTrace = (r: unknown) => {
  const raw = JSON.stringify(r)
  return raw.includes('videoFileId') || raw.includes('cloud://') || raw.includes('fileId')
}

beforeEach(() => {
  control.reset()
  control.seed('courses', [mkCourse('c1'), mkCourse('c2')])
  control.seed('qrcodes', [
    { _id: 'CODE1', status: 'unused', courseId: 'c1' },
    { _id: 'CODE2', status: 'unused', courseId: 'c2' },
  ])
})

describe('播放授权矩阵（E2E·三种无权身份均拒且不漏源）', () => {
  it('大白话：未激活任何课——取播放地址拒 NOT_ENTITLED，响应不含任何视频源痕迹', async () => {
    control.setOpenId('oNONE')
    const r = await call('getPlaybackUrl', { courseId: 'c1', segmentId: 's1' })
    expect(r.error).toBe('NOT_ENTITLED')
    expect(hasVideoTrace(r)).toBe(false)
  })

  it('大白话：已激活但未确认进课——仍拒 NOT_ENTITLED（残留 free 标记不构成授权），不漏源', async () => {
    control.setOpenId('oACT')
    await call('activateCourse', { code: 'CODE1' }) // 激活 c1·未 confirmEnter
    const r = await call('getPlaybackUrl', { courseId: 'c1', segmentId: 's1' })
    expect(r.error).toBe('NOT_ENTITLED')
    expect(hasVideoTrace(r)).toBe(false)
  })

  it('大白话：进的是别的课（已进 c2 取 c1）——拒 NOT_ENTITLED，不因「进过某课」放行别课，不漏源', async () => {
    control.setOpenId('oC2')
    await call('activateCourse', { code: 'CODE2' })
    await call('confirmEnter', { code: 'CODE2' }) // 真进 c2
    const r = await call('getPlaybackUrl', { courseId: 'c1', segmentId: 's1' })
    expect(r.error).toBe('NOT_ENTITLED')
    expect(hasVideoTrace(r)).toBe(false)
    // 反证授权矩阵成立：同一身份取本人已进的 c2 放行短时地址（授权闸只对无权者关）
    const ok = await call('getPlaybackUrl', { courseId: 'c2', segmentId: 's1' })
    expect(ok.url).toContain('cloud://v/c2-s1.mp4') // 已授权者才拿到源
  })

  it('大白话：公开目录 getCourses 整份响应递归无视频源（防白名单回归·任何身份都不下发源）', async () => {
    control.setOpenId('oNONE')
    const r = await call('getCourses')
    expect(r.ok).toBe(true)
    expect(hasVideoTrace(r)).toBe(false) // videoFileId/cloud:// 一律不出现
    const segs = r.list[0].chapters[0].lessons[0].segments
    expect(segs[0].hasVideo).toBe(true) // 只暴露「有无视频」布尔·不暴露源
    expect(segs[0].free).toBeUndefined() // 残留 free 标记也不外泄
  })
})
