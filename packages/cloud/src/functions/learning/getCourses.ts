import { getDb, ok } from '../../kit'

// 取课程目录（三层，按 sort 升序）。只读、公开——但**剥除 videoFileId**（审计 P1：付费课视频
// 白嫖防护）：段只暴露 hasVideo 布尔 + free 标记；真实播放地址经 getPlaybackUrl 服务端鉴权后
// 发短时效临时 URL。
function publicSegment(s: any) {
  return { id: s.id, name: s.name, dur: s.dur, free: !!s.free, hasVideo: !!s.videoFileId }
}
function publicCourse(c: any) {
  return {
    ...c,
    chapters: (c.chapters || []).map((ch: any) => ({
      ...ch,
      lessons: (ch.lessons || []).map((l: any) => ({
        ...l,
        segments: (l.segments || []).map(publicSegment),
      })),
    })),
  }
}

export const main = async () => {
  const db = getDb()
  const res = await db.collection('courses').orderBy('sort', 'asc').get()
  return ok({ list: res.data.map(publicCourse) })
}
