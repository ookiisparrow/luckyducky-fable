// 内容组映射（守卫 rw-admin-content-ui-golden）：首页模型往返（旧单串值归一/空课行剔除）/
// 直传表单字段构造（调试日志 G 固化：key 截取·字段名精确·凭证不齐不发）/课程视频统计脏档安全。
import { describe, it, expect } from 'vitest'
import { normalizeHome, homePayload, uploadFormFields, courseVideoStats, normalizeHelpItems } from '../src/lib/mapContent'

describe('首页模型往返', () => {
  it('大白话：旧存档「按课单串值」归一成欢迎图；编辑后空课行剔除、空态字段不进载荷', () => {
    const m = normalizeHome({
      hero: { title: '创造幸运', tagline: 'x' },
      activationBgByCourse: { 'course-a': 'cloud://old-style.jpg', 'course-b': { welcome: 'cloud://w.jpg', taken: 'cloud://t.jpg' } },
    })
    expect(m.byCourse).toEqual([
      { courseId: 'course-a', welcome: 'cloud://old-style.jpg', welcomeBack: '', taken: '' },
      { courseId: 'course-b', welcome: 'cloud://w.jpg', welcomeBack: '', taken: 'cloud://t.jpg' },
    ])
    m.byCourse.push({ courseId: '  ', welcome: 'cloud://x.jpg', welcomeBack: '', taken: '' }) // 空课行
    const payload = homePayload(m) as Record<string, any>
    expect(Object.keys(payload.activationBgByCourse)).toEqual(['course-a', 'course-b']) // 空课剔除
    expect(payload.activationBgByCourse['course-b']).toEqual({ welcome: 'cloud://w.jpg', taken: 'cloud://t.jpg' }) // 空态不进
    expect(normalizeHome(null).heroTitle).toBe('') // 缺档全默认
  })
})

describe('直传表单字段（调试日志 G：错一个字段云存储 403）', () => {
  it('大白话：key 从 fileId 截路径；三个 x-cos/Signature 字段名一字不差；凭证缺任一不发', () => {
    const fields = uploadFormFields({
      fileId: 'cloud://env-id.bucket-123/videos/c1/seg-1.mp4',
      authorization: 'q-sign-xxx',
      token: 'tok-yyy',
      cosFileId: 'cos-zzz',
    })!
    expect(fields).toEqual({
      key: 'videos/c1/seg-1.mp4', // cloud://<env>.<bucket>/ 后的对象路径
      Signature: 'q-sign-xxx',
      'x-cos-security-token': 'tok-yyy',
      'x-cos-meta-fileid': 'cos-zzz',
    })
    expect(uploadFormFields({ fileId: 'cloud://a/b.mp4', authorization: 'x', token: 'y' })).toBeNull() // 缺 cosFileId 不发
    expect(uploadFormFields({})).toBeNull()
  })
})

describe('课程视频统计与帮助视频归一', () => {
  it('大白话：已传/总段数统计；缺层脏档不崩；帮助视频两级归一非数组安全', () => {
    expect(
      courseVideoStats({
        chapters: [
          { lessons: [{ segments: [{ videoFileId: 'cloud://a' }, { videoFileId: '' }] }] },
          { lessons: null },
          null,
        ],
      })
    ).toEqual({ total: 2, done: 1 })
    expect(courseVideoStats(null)).toEqual({ total: 0, done: 0 })
    const help = normalizeHelpItems([{ title: 't', segments: [{ name: 's', videoFileId: 'cloud://v' }] }, null])
    expect(help).toHaveLength(1) // null 项剔除
    expect(help[0].segments[0].videoFileId).toBe('cloud://v')
    expect(normalizeHelpItems('garbage')).toEqual([])
  })
})
